import assert = require('node:assert/strict');
import { AsyncLocalStorage } from 'node:async_hooks';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import type { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

// AUTHOR UNRUN. Actual full service; synthetic rows, authorization and mutex only.
const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const ARTIST = '44444444-4444-4444-8444-444444444444';
const OLD = new Date('2026-10-16T00:00:00.123Z');
const OPERATOR: AuthUser = { id: ACTOR, adminRole: 'super_admin' };
const INCLUDE = { artist: { select: { id: true, slug: true, displayName: true, status: true } } };
const POLICY = { cashLike: false, luminaAmount: 0, settlementEligible: false, transferable: false };
type Row = Prisma.FanMissionGetPayload<{ include: typeof INCLUDE }>;
type Tx = { active: boolean; locked: boolean; work: Row | null; audits: Record<string, unknown>[]; release: (() => void) | null };
type Failure = 'transaction' | 'lock' | 'read' | 'update' | 'commit' | 'audit';

function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(item => clone(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  }
  return value;
}

function row(status = 'active', id = ID): Row {
  return {
    id, artistId: ARTIST, slug: id === ID ? 'synthetic-mission' : 'untouched-mission',
    missionType: 'daily_signal', status, surfaces: ['home'], resetPolicy: 'once',
    actionType: 'mission_participation', actionTargetId: null,
    rewardPolicy: { points: 3, marker: 'synthetic-policy' },
    copy: { titleKey: 'synthetic.title', descriptionKey: 'synthetic.description' },
    startsAt: new Date('2026-10-15T00:00:00.000Z'), endsAt: new Date('2026-10-20T00:00:00.000Z'),
    createdAt: new Date(OLD.getTime()), updatedAt: new Date(OLD.getTime()),
    artist: { id: ARTIST, slug: 'synthetic-artist', displayName: 'Synthetic artist', status: 'active' },
  };
}

function projection(value: Row) {
  return {
    id: value.id, slug: value.slug, missionType: value.missionType, status: value.status,
    statusKey: 'fanMission.status.' + value.status, surfaces: clone(value.surfaces),
    resetPolicy: value.resetPolicy, action: { type: value.actionType, targetId: value.actionTargetId },
    artist: clone(value.artist), rewardPolicy: { points: 3, marker: 'synthetic-policy', policy: { ...POLICY } },
    copy: clone(value.copy), startsAt: value.startsAt, endsAt: value.endsAt,
    createdAt: value.createdAt, updatedAt: value.updatedAt, policy: { ...POLICY },
  };
}

// Audit JSON conversion is the existing service contract, not a row equality shortcut.
function auditProjection(value: Row) {
  return {
    ...projection(value), startsAt: value.startsAt?.toISOString() ?? null,
    endsAt: value.endsAt?.toISOString() ?? null, createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(initial: Row | null = row()) {
  let committed = clone(initial);
  const untouched = row('archived', OTHER), originalOther = clone(untouched);
  const context = new AsyncLocalStorage<Tx>();
  const faults: string[] = [], events: string[] = [];
  const audits: Record<string, unknown>[] = [];
  const lockWaiters: Array<() => void> = [];
  let held = false, failure: Failure | null = null;
  const failureValue = new Error('SYNTHETIC_MISSION_DB_OR_AUDIT_ERROR');
  let updateHook: (() => Promise<void>) | null = null;
  const waiting = deferred();
  const stats = { attempted: 0, rootReads: 0, rootUpdates: 0, txReads: 0, txUpdates: 0,
    txStarts: 0, commits: 0, rollbacks: 0, lockAttempts: 0, lockAcquired: 0,
    activeTransactions: 0, auditAttempts: 0, unexpected: 0 };

  function admit<T>(tx: Tx | null, name: string, validate: () => T): T {
    stats.attempted++; events.push((tx ? 'tx:' : 'root:') + name);
    try {
      assert.equal(context.getStore() ?? null, tx, 'Root delegates cannot be used inside a transaction');
      if (tx) assert.equal(tx.active, true);
      return validate();
    } catch (error) { faults.push(name); throw error; }
  }

  function failAt(stage: Failure) { if (failure === stage) throw failureValue; }

  function deny(name: string): never {
    stats.attempted++; stats.unexpected++; faults.push(name);
    throw new Error('SYNTHETIC_MISSION_UNADMITTED_DEPENDENCY');
  }

  function closed<T extends object>(target: T, name: string): T {
    return new Proxy(target, {
      get(object, key, receiver) {
        if (typeof key === 'symbol' || Object.prototype.hasOwnProperty.call(object, key)) {
          return Reflect.get(object, key, receiver);
        }
        return deny(name + '.' + String(key));
      },
    });
  }

  async function acquire(): Promise<() => void> {
    if (held) {
      waiting.resolve();
      await new Promise<void>(resolve => { lockWaiters.push(resolve); });
    } else held = true;
    let released = false;
    return () => {
      assert.equal(released, false); released = true;
      const next = lockWaiters.shift();
      if (next) next();
      else held = false;
    };
  }

  function delegate(tx: Tx | null) {
    return closed({
      findUnique: async (args: unknown) => {
        if (tx) stats.txReads++; else stats.rootReads++;
        admit(tx, 'findUnique', () => {
          assert.deepEqual(args, { where: { id: ID }, include: INCLUDE });
          if (tx) assert.equal(tx.locked, true, 'Current row read must follow the lock');
        });
        failAt('read');
        return clone(tx ? tx.work : committed);
      },
      update: async (args: unknown) => {
        if (tx) stats.txUpdates++; else stats.rootUpdates++;
        const data = admit(tx, 'update', () => {
          assert(args && typeof args === 'object');
          const value = args as { where: unknown; data: { status: string; updatedAt: Date }; include: unknown };
          assert.deepEqual(Object.keys(value).sort(), ['data', 'include', 'where']);
          assert.deepEqual(value.where, { id: ID }); assert.deepEqual(value.include, INCLUDE);
          assert.deepEqual(Object.keys(value.data).sort(), ['status', 'updatedAt']);
          assert(['inactive', 'archived'].includes(value.data.status));
          assert(value.data.updatedAt instanceof Date && Number.isFinite(value.data.updatedAt.getTime()));
          if (tx) assert.equal(tx.locked, true);
          return value.data;
        });
        failAt('update');
        const current = tx ? tx.work : committed;
        assert(current, 'Admitted fixture update must target an existing row');
        const changed = { ...clone(current), status: data.status, updatedAt: new Date(data.updatedAt.getTime()) };
        if (tx) tx.work = changed;
        else committed = changed;
        const hook = updateHook; updateHook = null;
        if (hook) await hook();
        return clone(changed);
      },
    }, tx ? 'tx.fanMission' : 'root.fanMission');
  }

  function auditDelegate(tx: Tx | null) {
    return closed({ create: async (args: unknown) => {
      stats.auditAttempts++;
      const data = admit(tx, 'audit', () => {
        assert(args && typeof args === 'object');
        const value = args as { data: Record<string, unknown> };
        assert.deepEqual(Object.keys(value), ['data']);
        assert.deepEqual(Object.keys(value.data).sort(),
          ['actorType', 'actorUserId', 'action', 'afterData', 'beforeData', 'metadata', 'targetId', 'targetType'].sort());
        assert.equal(value.data.actorUserId, ACTOR); assert.equal(value.data.actorType, 'admin');
        assert.equal(value.data.action, 'fan_mission.archive');
        assert.equal(value.data.targetType, 'fan_mission'); assert.equal(value.data.targetId, ID);
        // Audit writes must use this caller's transaction context.
        return clone(value.data);
      });
      failAt('audit');
      const target = tx ? tx.audits : audits;
      target.push(data);
      return { id: 'synthetic-audit-' + target.length, ...data };
    } }, tx ? 'tx.auditEvent' : 'root.auditEvent');
  }

  const prisma = closed({
    fanMission: delegate(null),
    auditEvent: auditDelegate(null),
    $transaction: async <T>(work: (tx: unknown) => Promise<T>, options?: unknown): Promise<T> => {
      stats.txStarts++;
      admit(null, 'transaction', () => {
        assert.equal(typeof work, 'function');
        assert.deepEqual(options, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      });
      failAt('transaction');
      const tx: Tx = { active: true, locked: false, work: null, audits: [], release: null };
      stats.activeTransactions++;
      const client = closed({
        fanMission: delegate(tx),
        auditEvent: auditDelegate(tx),
        $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          stats.lockAttempts++;
          admit(tx, 'lock', () => {
            assert(Array.isArray(strings));
            assert.equal(strings.join('?').replace(/\s+/g, ' ').trim(),
              'SELECT id FROM fan_missions WHERE id=?::uuid FOR UPDATE');
            assert.deepEqual(values, [ID]); assert.equal(tx.locked, false);
          });
          failAt('lock');
          tx.release = await acquire(); tx.locked = true; stats.lockAcquired++;
          tx.work = clone(committed);
          events.push('tx:locked-current');
          return tx.work ? [{ id: ID }] : [];
        },
      }, 'tx');
      try {
        return await context.run(tx, async () => {
          const value = await work(client);
          assert.equal(tx.locked, true);
          failAt('commit');
          committed = clone(tx.work); audits.push(...clone(tx.audits)); stats.commits++; events.push('tx:commit');
          return value;
        });
      } catch (error) { stats.rollbacks++; events.push('tx:rollback'); throw error; }
      finally {
        tx.active = false; stats.activeTransactions--;
        if (tx.release) tx.release();
      }
    },
  }, 'root');
  const config = closed({ get: () => deny('config.get') }, 'config');
  const service = new AdminService(prisma as unknown as PrismaService, config as unknown as ConfigService);

  function check() {
    assert.deepEqual(faults, [], 'Fixture admission faults cannot be hidden by product catches');
    assert.equal(stats.unexpected, 0); assert.deepEqual(untouched, originalOther);
  }

  return {
    service, stats, audits, events, failureValue, waiting: waiting.promise,
    snapshot: () => clone(committed), other: () => clone(untouched),
    fail: (stage: Failure) => { failure = stage; },
    afterNextUpdate: (hook: () => Promise<void>) => { assert.equal(updateHook, null); updateHook = hook; },
    check,
    finish: () => {
      check(); assert.equal(stats.activeTransactions, 0); assert.equal(held, false);
      assert.equal(lockWaiters.length, 0);
    },
  };
}

type Fixture = ReturnType<typeof fixture>;

function currentOnly(f: Fixture, expectedTransactions: number) {
  assert.equal(f.stats.rootReads, 0); assert.equal(f.stats.rootUpdates, 0);
  assert.equal(f.stats.txStarts, expectedTransactions); assert.equal(f.stats.lockAttempts, expectedTransactions);
  assert.equal(f.stats.lockAcquired, expectedTransactions);
}

function receipt(value: Awaited<ReturnType<AdminService['archiveBackstageFanMission']>>, saved: Row) {
  assert.deepEqual(Object.keys(value).sort(), ['archived', 'deactivated', 'mission', 'policy']);
  assert.deepEqual(value.mission, projection(saved)); assert.deepEqual(value.policy, POLICY);
  assert.equal(value.archived, saved.status === 'archived');
  assert.equal(value.deactivated, saved.status === 'inactive');
}

function audit(f: Fixture, before: Row, after: Row, reason: string | null, index = 0) {
  assert.deepEqual(f.audits[index], {
    actorUserId: ACTOR, actorType: 'admin', action: 'fan_mission.archive', targetType: 'fan_mission', targetId: ID,
    beforeData: auditProjection(before), afterData: auditProjection(after), metadata: { reason, policy: POLICY },
  });
}

describe('AdminService mission archive retention focused', () => {
  it('01 an archived mission cannot be downgraded by a fresh inactive request', async () => {
    const f = fixture(row('archived'));
    try {
      const before = f.snapshot(); assert(before);
      const result = await f.service.archiveBackstageFanMission(OPERATOR, ID, { status: 'inactive', reason: 'synthetic-floor' });
      f.check();
      assert.equal(f.snapshot()?.status, 'archived', 'FAN_MISSION_ARCHIVE_RETENTION_LOST');
      const saved = f.snapshot(); assert(saved);
      receipt(result, saved); audit(f, before, saved, 'synthetic-floor');
      currentOnly(f, 1); assert.equal(f.stats.commits, 1); assert.equal(f.stats.auditAttempts, 1);
      for (const input of [{}, { status: 'archived' }, { status: 'inactive' }]) {
        const prior = f.snapshot(); assert(prior);
        const replay = await f.service.archiveBackstageFanMission(OPERATOR, ID, input);
        const latest = f.snapshot(); assert(latest);
        assert.equal(latest.status, 'archived'); receipt(replay, latest);
        audit(f, prior, latest, null, f.audits.length - 1);
      }
      currentOnly(f, 4); assert.equal(f.stats.commits, 4); assert.equal(f.stats.auditAttempts, 4);
    } finally { f.finish(); }
  });

  it('02 normal deactivation archive and replay preserve exact projections independent rows and audit arguments', async () => {
    for (const [status, requested, expected] of [
      ['active', 'inactive', 'inactive'], ['draft', 'inactive', 'inactive'],
      ['inactive', 'archived', 'archived'], ['active', undefined, 'archived'],
      ['draft', 'archived', 'archived'], ['inactive', 'inactive', 'inactive'],
    ] as const) {
      const f = fixture(row(status));
      try {
        const before = f.snapshot(); assert(before);
        const principal = status === 'draft' ? { id: ACTOR, adminPermissions: ['*'] } : OPERATOR;
        const input = requested === undefined ? {} : { status: requested, reason: ' synthetic-reason ' };
        const result = await f.service.archiveBackstageFanMission(principal, ID, input);
        const saved = f.snapshot(); assert(saved);
        assert.equal(saved.status, expected);
        assert.deepEqual({ ...saved, status: before.status, updatedAt: before.updatedAt }, before);
        receipt(result, saved); audit(f, before, saved, requested === undefined ? null : 'synthetic-reason');
        currentOnly(f, 1); assert.equal(f.stats.txUpdates, 1); assert.equal(f.stats.commits, 1);
        assert.equal(f.stats.auditAttempts, 1); assert.equal(f.stats.rollbacks, 0);
        assert(f.events.indexOf('tx:audit') < f.events.indexOf('tx:commit'));
        assert(!f.events.includes('root:audit'));
      } finally { f.finish(); }
    }
  });

  it('03 a queued deactivation rereads the actual competing archive and cannot downgrade its winner', async () => {
    const f = fixture(), entered = deferred(), release = deferred();
    type PendingCall = Promise<Awaited<ReturnType<AdminService['archiveBackstageFanMission']>>>;
    let first: PendingCall | null = null;
    let second: PendingCall | null = null;
    try {
      f.afterNextUpdate(async () => { entered.resolve(); await release.promise; });
      first = f.service.archiveBackstageFanMission(OPERATOR, ID, { status: 'archived', reason: 'archive-B' });
      await Promise.race([entered.promise, first.then(() => { throw new Error('Archive finished before the admitted barrier'); })]);
      assert.equal(f.snapshot()?.status, 'active', 'First transaction has not published its staged row');
      second = f.service.archiveBackstageFanMission(OPERATOR, ID, { status: 'inactive', reason: 'stale-A' });
      await Promise.race([f.waiting, second.then(() => { throw new Error('Queued caller bypassed the synthetic mutex'); })]);
      assert.equal(f.stats.txReads, 1); assert.equal(f.stats.txUpdates, 1); assert.equal(f.stats.auditAttempts, 0);
      release.resolve();
      const [archived, deactivated] = await Promise.all([first, second]);
      assert.equal(archived.mission.status, 'archived'); assert.equal(deactivated.mission.status, 'archived');
      assert.equal(deactivated.archived, true); assert.equal(deactivated.deactivated, false);
      const saved = f.snapshot(); assert(saved); assert.equal(saved.status, 'archived');
      currentOnly(f, 2); assert.equal(f.stats.txReads, 2); assert.equal(f.stats.txUpdates, 2);
      assert.equal(f.stats.commits, 2); assert.equal(f.stats.rollbacks, 0); assert.equal(f.audits.length, 2);
      const byReason = (reason: string) => f.audits.find(value =>
        (value.metadata as { reason: string }).reason === reason);
      const winner = byReason('archive-B'), late = byReason('stale-A'); assert(winner && late);
      assert.equal((winner.beforeData as { status: string }).status, 'active');
      assert.equal((winner.afterData as { status: string }).status, 'archived');
      assert.equal((late.beforeData as { status: string }).status, 'archived');
      assert.equal((late.afterData as { status: string }).status, 'archived');
    } finally {
      release.resolve();
      await Promise.allSettled([...(first ? [first] : []), ...(second ? [second] : [])]);
      f.finish();
    }
  });

  it('04 authority input missing and failures preserve precedence identity and transactional audit failure semantics', async () => {
    for (const principal of [{ id: ACTOR }, { id: ACTOR, adminRole: 'viewer' }]) {
      const f = fixture();
      try {
        await assert.rejects(f.service.archiveBackstageFanMission(principal, 'invalid', { status: 'active' }), ForbiddenException);
        assert.equal(f.stats.attempted, 0);
      } finally { f.finish(); }
    }
    {
      const f = fixture();
      try {
        await assert.rejects(f.service.archiveBackstageFanMission(OPERATOR, 'invalid', { status: 'active' }), error =>
          error instanceof BadRequestException && (error.getResponse() as { code: string }).code === 'FAN_MISSION_INVALID_ID');
        assert.equal(f.stats.attempted, 0);
      } finally { f.finish(); }
    }
    for (const status of [null, 'active', 'archived'] as const) {
      const f = fixture(status === null ? null : row(status));
      try {
        await assert.rejects(f.service.archiveBackstageFanMission(OPERATOR, ID, { status: 'active' }), error => {
          if (status === null) return error instanceof NotFoundException && (error.getResponse() as { code: string }).code === 'FAN_MISSION_NOT_FOUND';
          return error instanceof BadRequestException && (error.getResponse() as { code: string }).code === 'FAN_MISSION_INVALID_ARCHIVE_STATUS';
        });
        currentOnly(f, 1); assert.equal(f.stats.txReads, 1); assert.equal(f.stats.txUpdates, 0);
        assert.equal(f.stats.auditAttempts, 0); assert.equal(f.stats.rollbacks, 1);
      } finally { f.finish(); }
    }
    for (const stage of ['transaction', 'lock', 'read', 'update', 'commit', 'audit'] as const) {
      const f = fixture(), before = f.snapshot();
      try {
        f.fail(stage);
        await assert.rejects(f.service.archiveBackstageFanMission(OPERATOR, ID, { status: 'archived' }), error => error === f.failureValue);
        assert.equal(f.stats.txStarts, 1, 'No transaction retry');
        assert.equal(f.stats.rootReads, 0); assert.equal(f.stats.rootUpdates, 0);
        if (stage === 'audit' || stage === 'commit') {
          assert.equal(f.stats.commits, 0); assert.equal(f.stats.rollbacks, 1);
          assert.deepEqual(f.snapshot(), before, 'Audit or commit rejection publishes neither staged row nor audit');
          assert.equal(f.stats.auditAttempts, 1); assert.equal(f.audits.length, 0);
        } else {
          assert.deepEqual(f.snapshot(), before, 'Synthetic failed transaction publishes no staged state');
          assert.equal(f.stats.commits, 0); assert.equal(f.stats.auditAttempts, 0);
          assert.equal(f.stats.rollbacks, stage === 'transaction' ? 0 : 1);
        }
        assert(f.stats.lockAttempts <= 1 && f.stats.txReads <= 1 && f.stats.txUpdates <= 1);
      } finally { f.finish(); }
    }
  });
});

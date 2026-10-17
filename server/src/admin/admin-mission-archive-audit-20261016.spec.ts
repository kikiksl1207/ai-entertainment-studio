import assert = require('node:assert/strict');
import { AsyncLocalStorage } from 'node:async_hooks';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import type { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

// AUTHOR UNRUN. Real full class and helpers; synthetic ORM staging is not SQL proof.
const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const ARTIST = '44444444-4444-4444-8444-444444444444';
const OLD = new Date('2026-10-16T00:00:00.123Z');
const OPERATOR: AuthUser = { id: ACTOR, adminRole: 'super_admin' };
const INCLUDE = { artist: { select: { id: true, slug: true, displayName: true, status: true } } };
const POLICY = { cashLike: false, luminaAmount: 0, settlementEligible: false, transferable: false };
type Row = Prisma.FanMissionGetPayload<{ include: typeof INCLUDE }>;
type Audit = Record<string, unknown>;
type Tx = { active: boolean; locked: boolean; before: Row | null; work: Row | null; audits: Audit[] };
type Failure = 'transaction' | 'lock' | 'read' | 'update' | 'audit' | 'commit';

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

function auditProjection(value: Row) {
  return {
    ...projection(value), startsAt: value.startsAt?.toISOString() ?? null,
    endsAt: value.endsAt?.toISOString() ?? null, createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}

function expectedAudit(before: Row, after: Row, reason: string | null): Audit {
  return {
    actorUserId: ACTOR, actorType: 'admin', action: 'fan_mission.archive', targetType: 'fan_mission', targetId: ID,
    beforeData: auditProjection(before), afterData: auditProjection(after), metadata: { reason, policy: POLICY },
  };
}

function fixture(initial: Row | null = row()) {
  let committed = clone(initial), lastTx: Tx | null = null;
  const other = row('archived', OTHER), otherBefore = clone(other);
  const context = new AsyncLocalStorage<Tx>();
  const faults: string[] = [], events: string[] = [], audits: Audit[] = [];
  let failure: Failure | null = null, reason: string | null = null;
  const error = new Error('SYNTHETIC_MISSION_AUDIT_OR_DB_FAILURE');
  const stats = { attempts: 0, unexpected: 0, transactions: 0, active: 0, locks: 0,
    reads: 0, updates: 0, rootAudits: 0, txAudits: 0, commits: 0, rollbacks: 0 };

  function admit<T>(tx: Tx | null, name: string, extra: unknown[], validate: () => T): T {
    stats.attempts++; events.push((tx ? 'tx:' : 'root:') + name);
    try {
      assert.deepEqual(extra, [], 'Unknown extra delegate arguments are forbidden');
      assert.equal(context.getStore() ?? null, tx, 'Root delegate cannot run inside a transaction');
      if (tx) assert.equal(tx.active, true);
      return validate();
    } catch (caught) { faults.push(name); throw caught; }
  }
  function failAt(stage: Failure) { if (failure === stage) throw error; }
  function deny(name: string): never {
    stats.attempts++; stats.unexpected++; faults.push(name);
    throw new Error('MISSION_AUDIT_FIXTURE_UNADMITTED_DEPENDENCY');
  }
  function closed<T extends object>(target: T, name: string): T {
    return new Proxy(target, { get(object, key, receiver) {
      if (typeof key === 'symbol' || Object.prototype.hasOwnProperty.call(object, key)) {
        return Reflect.get(object, key, receiver);
      }
      return deny(name + '.' + String(key));
    } });
  }
  function auditDelegate(tx: Tx | null) {
    return closed({ create: async (args: unknown, ...extra: unknown[]) => {
      if (tx) stats.txAudits++; else stats.rootAudits++;
      const data = admit(tx, 'audit', extra, () => {
        assert(args && typeof args === 'object');
        const value = args as { data: Audit };
        assert.deepEqual(Object.keys(value), ['data']);
        const source = tx ?? lastTx; assert(source?.before && source.work);
        assert.deepEqual(value.data, expectedAudit(source.before, source.work, reason));
        assert.equal(Object.keys(value.data).length, 8);
        if (tx) assert.equal(tx.locked, true);
        return clone(value.data);
      });
      // Planned failures are outside admission validation, and remain the original error object.
      failAt('audit');
      (tx ? tx.audits : audits).push(data);
      return { id: 'synthetic-audit', ...clone(data) };
    } }, tx ? 'tx.auditEvent' : 'root.auditEvent');
  }
  const prisma = closed({
    auditEvent: auditDelegate(null),
    $transaction: async <T>(work: (tx: unknown) => Promise<T>, options: unknown, ...extra: unknown[]): Promise<T> => {
      stats.transactions++;
      admit(null, 'transaction', extra, () => {
        assert.equal(typeof work, 'function');
        assert.deepEqual(options, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      });
      failAt('transaction');
      const tx: Tx = { active: true, locked: false, before: null, work: null, audits: [] };
      lastTx = tx; stats.active++;
      const client = closed({
        auditEvent: auditDelegate(tx),
        $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          stats.locks++;
          admit(tx, 'lock', [], () => {
            assert(Array.isArray(strings));
            assert.equal(strings.join('?').replace(/\s+/g, ' ').trim(),
              'SELECT id FROM fan_missions WHERE id=?::uuid FOR UPDATE');
            assert.deepEqual(values, [ID]); assert.equal(tx.locked, false);
          });
          failAt('lock'); tx.locked = true; tx.before = clone(committed); tx.work = clone(committed);
          return tx.work ? [{ id: ID }] : [];
        },
        fanMission: closed({
          findUnique: async (args: unknown, ...extra: unknown[]) => {
            stats.reads++;
            admit(tx, 'read', extra, () => {
              assert.equal(tx.locked, true);
              assert.deepEqual(args, { where: { id: ID }, include: INCLUDE });
            });
            failAt('read'); return clone(tx.work);
          },
          update: async (args: unknown, ...extra: unknown[]) => {
            stats.updates++;
            const data = admit(tx, 'update', extra, () => {
              assert.equal(tx.locked, true); assert(tx.work);
              assert(args && typeof args === 'object');
              const value = args as { where: unknown; data: { status: string; updatedAt: Date }; include: unknown };
              assert.deepEqual(Object.keys(value).sort(), ['data', 'include', 'where']);
              assert.deepEqual(value.where, { id: ID }); assert.deepEqual(value.include, INCLUDE);
              assert.deepEqual(Object.keys(value.data).sort(), ['status', 'updatedAt']);
              assert(['inactive', 'archived'].includes(value.data.status));
              assert(value.data.updatedAt instanceof Date && Number.isFinite(value.data.updatedAt.getTime()));
              return value.data;
            });
            failAt('update'); assert(tx.work);
            tx.work = { ...clone(tx.work), status: data.status, updatedAt: new Date(data.updatedAt.getTime()) };
            return clone(tx.work);
          },
        }, 'tx.fanMission'),
      }, 'tx');
      try {
        return await context.run(tx, async () => {
          const result = await work(client); assert.equal(tx.locked, true);
          failAt('commit');
          committed = clone(tx.work); audits.push(...clone(tx.audits));
          stats.commits++; events.push('tx:commit'); return result;
        });
      } catch (caught) { stats.rollbacks++; events.push('tx:rollback'); throw caught; }
      finally { tx.active = false; stats.active--; }
    },
  }, 'root');
  const config = closed({ get: () => deny('config.get') }, 'config');
  const service = new AdminService(prisma as unknown as PrismaService, config as unknown as ConfigService);
  function check() {
    assert.deepEqual(faults, [], 'Fixture admission failures cannot be swallowed by the product');
    assert.equal(stats.unexpected, 0); assert.deepEqual(other, otherBefore);
  }
  return { service, stats, audits, events, error, snapshot: () => clone(committed),
    fail: (stage: Failure) => { failure = stage; }, expectReason: (value: string | null) => { reason = value; },
    check, finish: () => { check(); assert.equal(stats.active, 0); } };
}

type Fixture = ReturnType<typeof fixture>;
function transactionOnly(f: Fixture) {
  assert.equal(f.stats.rootAudits, 0); assert.equal(f.stats.transactions, 1);
  assert.equal(f.stats.locks, 1); assert.equal(f.stats.reads, 1);
}

describe('AdminService mission archive audit focused', () => {
  it('01 audit rejection cannot leave a committed mission transition', async () => {
    const f = fixture(), before = f.snapshot();
    try {
      f.fail('audit');
      await assert.rejects(f.service.archiveBackstageFanMission(OPERATOR, ID, { status: 'archived' }), caught => caught === f.error);
      f.check();
      assert.deepEqual(f.snapshot(), before, 'FAN_MISSION_ARCHIVE_AUDIT_PARTIAL_COMMIT');
      assert.deepEqual(f.audits, []); transactionOnly(f);
      assert.equal(f.stats.updates, 1); assert.equal(f.stats.txAudits, 1);
      assert.equal(f.stats.commits, 0); assert.equal(f.stats.rollbacks, 1);
    } finally { f.finish(); }
  });

  it('02 successful archival keeps exact data status floor projection and one audit before commit', async () => {
    for (const [status, requested, expected] of [
      ['active', 'inactive', 'inactive'], ['archived', 'inactive', 'archived'], ['inactive', undefined, 'archived'],
    ] as const) {
      const initial = row(status);
      if (status === 'inactive') { initial.artist = null; initial.artistId = null; }
      const f = fixture(initial), before = f.snapshot(); assert(before);
      try {
        f.expectReason('synthetic-reason');
        const principal = status === 'inactive' ? { id: ACTOR, adminPermissions: ['*'] } : OPERATOR;
        const result = await f.service.archiveBackstageFanMission(principal, ID,
          { ...(requested === undefined ? {} : { status: requested }), reason: ' synthetic-reason ' });
        f.check(); const saved = f.snapshot(); assert(saved);
        assert.equal(saved.status, expected);
        assert.deepEqual({ ...saved, status: before.status, updatedAt: before.updatedAt }, before);
        assert.deepEqual(result, { mission: projection(saved), archived: expected === 'archived',
          deactivated: expected === 'inactive', policy: POLICY });
        assert.deepEqual(f.audits, [expectedAudit(before, saved, 'synthetic-reason')]);
        transactionOnly(f); assert.equal(f.stats.updates, 1); assert.equal(f.stats.txAudits, 1);
        assert.equal(f.stats.commits, 1); assert.equal(f.stats.rollbacks, 0);
        assert(f.events.indexOf('tx:update') < f.events.indexOf('tx:audit'));
        assert(f.events.indexOf('tx:audit') < f.events.indexOf('tx:commit'));
      } finally { f.finish(); }
    }
  });

  it('03 the unchanged audit helper preserves its default root client and JSON conversion', async () => {
    for (const failAudit of [false, true]) {
      const faults: string[] = [], events: string[] = [], audits: Audit[] = [];
      let attempts = 0, creates = 0, auditAttempts = 0;
      const error = new Error('SYNTHETIC_DEFAULT_ROOT_AUDIT_ERROR');
      const data = { keyword: 'Synthetic phrase', normalizedKeyword: 'synthetic phrase', searchType: 'text',
        language: 'en', status: 'active', reason: null, createdByUserId: ACTOR, updatedByUserId: ACTOR };
      const created = { id: OTHER, ...data, createdAt: new Date(OLD.getTime()), updatedAt: new Date(OLD.getTime()) };
      function admit<T>(name: string, extra: unknown[], validate: () => T): T {
        attempts++; events.push(name);
        try { assert.deepEqual(extra, []); return validate(); }
        catch (caught) { faults.push(name); throw caught; }
      }
      function closed<T extends object>(target: T, label: string): T {
        return new Proxy(target, { get(object, key, receiver) {
          if (typeof key === 'symbol' || Object.prototype.hasOwnProperty.call(object, key)) return Reflect.get(object, key, receiver);
          attempts++; faults.push(label + '.' + String(key)); throw new Error('DEFAULT_AUDIT_UNADMITTED_DEPENDENCY');
        } });
      }
      const prisma = closed({
        feedSearchBlockedTerm: closed({ create: async (args: unknown, ...extra: unknown[]) => {
          creates++; admit('root:create', extra, () => assert.deepEqual(args, { data })); return clone(created);
        } }, 'root.feedSearchBlockedTerm'),
        auditEvent: closed({ create: async (args: unknown, ...extra: unknown[]) => {
          auditAttempts++;
          const actual = admit('root:audit', extra, () => {
            assert(args && typeof args === 'object');
            const value = args as { data: Audit };
            assert.deepEqual(Object.keys(value), ['data']);
            assert.deepEqual(value.data, {
              actorUserId: ACTOR, actorType: 'admin', action: 'feed_search_blocked_term.create',
              targetType: 'feed_search_blocked_term', targetId: OTHER, beforeData: Prisma.JsonNull,
              afterData: { ...created, createdAt: OLD.toISOString(), updatedAt: OLD.toISOString() },
              metadata: { keyword: 'Synthetic phrase', normalizedKeyword: 'synthetic phrase', searchType: 'text', language: 'en', status: 'active' },
            });
            return value.data;
          });
          if (failAudit) throw error;
          audits.push(actual); return { id: 'synthetic-default-audit', ...actual };
        } }, 'root.auditEvent'),
      }, 'root');
      const config = closed({}, 'config');
      const service = new AdminService(prisma as unknown as PrismaService, config as unknown as ConfigService);
      try {
        const recordAudit = (service as unknown as {
          recordAudit: (...args: unknown[]) => Promise<unknown>;
        }).recordAudit;
        assert.equal(typeof recordAudit, 'function');
        const call = recordAudit.call(service, OPERATOR, 'feed_search_blocked_term.create',
          'feed_search_blocked_term', OTHER, null, created,
          { keyword: 'Synthetic phrase', normalizedKeyword: 'synthetic phrase', searchType: 'text', language: 'en', status: 'active' });
        if (failAudit) await assert.rejects(call, caught => caught === error);
        else {
          const result = await call;
          assert.deepEqual(result, { id: 'synthetic-default-audit', ...audits[0] });
          assert.equal(audits.length, 1);
        }
        assert.equal(creates, 0); assert.equal(auditAttempts, 1); assert.equal(attempts, 1);
        assert.deepEqual(events, ['root:audit']);
        if (failAudit) assert.deepEqual(audits, []);
      } finally { assert.deepEqual(faults, [], 'Default-client faults cannot hide inside the consumer catch'); }
    }
  });

  it('04 authority missing invalid and transaction failures retain precedence identity and no partial evidence', async () => {
    for (const principal of [{ id: ACTOR }, { id: ACTOR, adminRole: 'viewer' }]) {
      const f = fixture();
      try {
        await assert.rejects(f.service.archiveBackstageFanMission(principal, 'invalid', { status: 'active' }), ForbiddenException);
        assert.equal(f.stats.attempts, 0);
      } finally { f.finish(); }
    }
    {
      const f = fixture();
      try {
        await assert.rejects(f.service.archiveBackstageFanMission(OPERATOR, 'invalid', { status: 'active' }), caught =>
          caught instanceof BadRequestException && (caught.getResponse() as { code: string }).code === 'FAN_MISSION_INVALID_ID');
        assert.equal(f.stats.attempts, 0);
      } finally { f.finish(); }
    }
    for (const missing of [true, false]) {
      const f = fixture(missing ? null : row()), before = f.snapshot();
      try {
        await assert.rejects(f.service.archiveBackstageFanMission(OPERATOR, ID, { status: 'active' }), caught =>
          missing ? caught instanceof NotFoundException && (caught.getResponse() as { code: string }).code === 'FAN_MISSION_NOT_FOUND'
            : caught instanceof BadRequestException && (caught.getResponse() as { code: string }).code === 'FAN_MISSION_INVALID_ARCHIVE_STATUS');
        transactionOnly(f); assert.equal(f.stats.updates, 0); assert.equal(f.stats.txAudits, 0);
        assert.equal(f.stats.rollbacks, 1); assert.deepEqual(f.snapshot(), before); assert.deepEqual(f.audits, []);
      } finally { f.finish(); }
    }
    for (const stage of ['transaction', 'lock', 'read', 'update', 'commit'] as const) {
      const f = fixture(), before = f.snapshot();
      try {
        f.fail(stage);
        await assert.rejects(f.service.archiveBackstageFanMission(OPERATOR, ID, {}), caught => caught === f.error);
        assert.equal(f.stats.transactions, 1, 'No automatic transaction retry');
        assert.deepEqual(f.snapshot(), before); assert.deepEqual(f.audits, []);
        assert.equal(f.stats.commits, 0); assert.equal(f.stats.rollbacks, stage === 'transaction' ? 0 : 1);
        assert.equal(f.stats.rootAudits, 0); assert.equal(f.stats.txAudits, stage === 'commit' ? 1 : 0);
        assert(f.stats.locks <= 1 && f.stats.reads <= 1 && f.stats.updates <= 1);
      } finally { f.finish(); }
    }
  });
});

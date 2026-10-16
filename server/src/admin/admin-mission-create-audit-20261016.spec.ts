import assert = require('node:assert/strict');
import { AsyncLocalStorage } from 'node:async_hooks';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import type { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

// AUTHOR UNRUN. Actual full service/helpers; synthetic ORM staging, not SQL proof.
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
type Tx = { active: boolean; row: Row | null; audits: Audit[] };
type Failure = 'artist' | 'preflight' | 'transaction' | 'create' | 'audit' | 'commit';

function clone<T>(value: T): T {
  // This fixture records Prisma INSERT arguments, retaining the actual JSON-null sentinel.
  if (value === Prisma.JsonNull) return value;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(item => clone(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  }
  return value;
}
function input(status = 'active', artist = false) {
  return {
    slug: ' Synthetic-Create ', missionType: 'daily_signal', status,
    surface: 'home', surfaces: ['home'], resetPolicy: 'once',
    actionType: 'mission_participation', actionTargetId: undefined, artistId: artist ? ARTIST : undefined,
    rewardPolicy: { points: 0, marker: 'synthetic' },
    copy: { titleKey: 'synthetic.title', descriptionKey: 'synthetic.description',
      ctaKey: 'synthetic.cta', statusKey: 'synthetic.status' },
    startsAt: '2020-01-01T00:00:00.000Z', endsAt: '2099-01-01T00:00:00.000Z',
  };
}
function createData(status = 'active', artist = false) {
  const value = input(status, artist);
  return { artistId: value.artistId, slug: 'synthetic-create', missionType: value.missionType, status,
    surfaces: ['home'], resetPolicy: 'once', actionType: value.actionType, actionTargetId: undefined,
    rewardPolicy: clone(value.rewardPolicy), copy: clone(value.copy),
    startsAt: new Date(value.startsAt), endsAt: new Date(value.endsAt) };
}
function createdRow(status = 'active', artist = false): Row {
  return { id: ID, ...createData(status, artist), artistId: artist ? ARTIST : null, actionTargetId: null,
    createdAt: new Date(OLD.getTime()), updatedAt: new Date(OLD.getTime()),
    artist: artist ? { id: ARTIST, slug: 'synthetic-artist', displayName: 'Synthetic artist', status: 'active' } : null };
}
function projection(value: Row) {
  return { id: value.id, slug: value.slug, missionType: value.missionType, status: value.status,
    statusKey: 'fanMission.status.' + value.status, surfaces: clone(value.surfaces), resetPolicy: value.resetPolicy,
    action: { type: value.actionType, targetId: value.actionTargetId }, artist: clone(value.artist),
    rewardPolicy: { points: 0, marker: 'synthetic', policy: { ...POLICY } }, copy: clone(value.copy),
    startsAt: value.startsAt, endsAt: value.endsAt, createdAt: value.createdAt, updatedAt: value.updatedAt,
    policy: { ...POLICY } };
}
function auditData(value: Row): Audit {
  return { actorUserId: ACTOR, actorType: 'admin', action: 'fan_mission.create', targetType: 'fan_mission',
    targetId: ID, beforeData: Prisma.JsonNull,
    afterData: { ...projection(value), startsAt: value.startsAt?.toISOString() ?? null,
      endsAt: value.endsAt?.toISOString() ?? null, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() },
    metadata: { policy: POLICY } };
}

function fixture(status = 'active', artist = false) {
  let committed: Row | null = null;
  const audits: Audit[] = [], faults: string[] = [], events: string[] = [];
  const unrelated = { ...createdRow('archived'), id: OTHER, slug: 'untouched-mission' }, beforeOther = clone(unrelated);
  const context = new AsyncLocalStorage<Tx>();
  const expectedData = createData(status, artist), expectedRow = createdRow(status, artist);
  let duplicate = false, artistExists = true;
  let failure: { stage: Failure; error: unknown } | null = null;
  const error = new Error('SYNTHETIC_CREATE_AUDIT_OR_DB_ERROR');
  const stats = { attempts: 0, unexpected: 0, artistReads: 0, slugReads: 0,
    rootCreates: 0, txCreates: 0, rootAudits: 0, txAudits: 0,
    transactions: 0, active: 0, commits: 0, rollbacks: 0 };
  function admit<T>(tx: Tx | null, label: string, extra: unknown[], check: () => T): T {
    stats.attempts++; events.push((tx ? 'tx:' : 'root:') + label);
    try {
      assert.deepEqual(extra, [], 'No extra delegate arguments admitted');
      assert.equal(context.getStore() ?? null, tx, 'All delegates must use their exact calling context');
      if (tx) assert.equal(tx.active, true);
      return check();
    } catch (caught) { faults.push(label); throw caught; }
  }
  function failAt(stage: Failure) { if (failure?.stage === stage) throw failure.error; }
  function deny(label: string): never {
    stats.attempts++; stats.unexpected++; faults.push(label);
    throw new Error('MISSION_CREATE_FIXTURE_UNADMITTED_DEPENDENCY');
  }
  function closed<T extends object>(target: T, label: string): T {
    return new Proxy(target, { get(object, key, receiver) {
      if (typeof key === 'symbol' || Object.prototype.hasOwnProperty.call(object, key)) return Reflect.get(object, key, receiver);
      return deny(label + '.' + String(key));
    } });
  }
  function missions(tx: Tx | null) {
    const create = async (args: unknown, ...extra: unknown[]) => {
      if (tx) stats.txCreates++; else stats.rootCreates++;
      admit(tx, 'create', extra, () => {
        assert.equal(stats.rootCreates + stats.txCreates, 1);
        assert.deepEqual(args, { data: expectedData, include: INCLUDE });
        assert.equal(tx ? tx.row : committed, null);
      });
      failAt('create');
      if (tx) tx.row = clone(expectedRow); else committed = clone(expectedRow);
      return clone(expectedRow);
    };
    if (tx) return closed({ create }, 'tx.fanMission');
    return closed({ create, findUnique: async (args: unknown, ...extra: unknown[]) => {
      stats.slugReads++;
      admit(null, 'slug', extra, () => {
        assert.equal(stats.slugReads, 1);
        assert.deepEqual(args, { where: { slug: expectedData.slug }, select: { id: true } });
      });
      failAt('preflight'); return duplicate ? { id: OTHER } : null;
    } }, 'root.fanMission');
  }
  function auditDelegate(tx: Tx | null) {
    return closed({ create: async (args: unknown, ...extra: unknown[]) => {
      if (tx) stats.txAudits++; else stats.rootAudits++;
      const value = admit(tx, 'audit', extra, () => {
        assert.equal(stats.rootAudits + stats.txAudits, 1);
        const mission = tx ? tx.row : committed; assert(mission);
        const data = auditData(mission);
        assert.equal(Object.keys(data).length, 8);
        assert.deepEqual(args, { data }); return clone(data);
      });
      // Intentionally injected errors must not be mislabeled as fixture admission faults.
      failAt('audit'); (tx ? tx.audits : audits).push(value);
      return { id: 'synthetic-audit', ...clone(value) };
    } }, tx ? 'tx.auditEvent' : 'root.auditEvent');
  }
  const prisma = closed({
    artist: closed({ findUnique: async (args: unknown, ...extra: unknown[]) => {
      stats.artistReads++;
      admit(null, 'artist', extra, () => {
        assert.equal(stats.artistReads, 1); assert.equal(artist, true);
        assert.deepEqual(args, { where: { id: ARTIST }, select: { id: true } });
      });
      failAt('artist'); return artistExists ? { id: ARTIST } : null;
    } }, 'root.artist'),
    fanMission: missions(null), auditEvent: auditDelegate(null),
    $transaction: async <T>(work: (tx: unknown) => Promise<T>, options: unknown, ...extra: unknown[]): Promise<T> => {
      stats.transactions++;
      admit(null, 'transaction', extra, () => {
        assert.equal(stats.transactions, 1);
        assert.equal(typeof work, 'function');
        assert.deepEqual(options, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      });
      failAt('transaction');
      const tx: Tx = { active: true, row: null, audits: [] }; stats.active++;
      const client = closed({ fanMission: missions(tx), auditEvent: auditDelegate(tx) }, 'tx');
      try {
        return await context.run(tx, async () => {
          const value = await work(client); failAt('commit');
          committed = clone(tx.row); audits.push(...clone(tx.audits));
          stats.commits++; events.push('tx:commit'); return value;
        });
      } catch (caught) { stats.rollbacks++; events.push('tx:rollback'); throw caught; }
      finally { tx.active = false; stats.active--; }
    },
  }, 'root');
  const config = closed({ get: () => deny('config.get') }, 'config');
  const service = new AdminService(prisma as unknown as PrismaService, config as unknown as ConfigService);
  function check() {
    assert.deepEqual(faults, [], 'Fixture faults cannot be swallowed by the product or its duplicate catch');
    assert.equal(stats.unexpected, 0); assert.deepEqual(unrelated, beforeOther);
  }
  return { service, stats, audits, events, error, check,
    snapshot: () => ({ mission: clone(committed), audits: clone(audits) }),
    fail: (stage: Failure, injected: unknown = error) => { failure = { stage, error: injected }; },
    duplicate: () => { duplicate = true; }, missingArtist: () => { artistExists = false; },
    finish: () => { check(); assert.equal(stats.active, 0); } };
}
type Fixture = ReturnType<typeof fixture>;
function noWrites(f: Fixture) {
  assert.equal(f.stats.rootCreates, 0); assert.equal(f.stats.txCreates, 0);
  assert.equal(f.stats.rootAudits, 0); assert.equal(f.stats.txAudits, 0);
  assert.deepEqual(f.snapshot(), { mission: null, audits: [] });
}
function known(code: string) {
  return new Prisma.PrismaClientKnownRequestError('Synthetic SDK error', {
    code, clientVersion: 'synthetic-sdk174', meta: { target: ['slug'] },
  });
}
function conflict(caught: unknown) {
  return caught instanceof ConflictException && (caught.getResponse() as { code: string }).code === 'FAN_MISSION_SLUG_EXISTS';
}

describe('AdminService mission create audit focused', () => {
  it('01 audit rejection cannot leave a committed mission creation', async () => {
    const f = fixture(), before = f.snapshot();
    try {
      f.fail('audit');
      await assert.rejects(f.service.createBackstageFanMission(OPERATOR, input()), caught => caught === f.error);
      f.check();
      assert.deepEqual(f.snapshot(), before, 'FAN_MISSION_CREATE_AUDIT_PARTIAL_COMMIT');
      assert.equal(f.stats.slugReads, 1); assert.equal(f.stats.transactions, 1);
      assert.equal(f.stats.txCreates, 1); assert.equal(f.stats.txAudits, 1);
      assert.equal(f.stats.rootCreates, 0); assert.equal(f.stats.rootAudits, 0);
      assert.equal(f.stats.commits, 0); assert.equal(f.stats.rollbacks, 1);
    } finally { f.finish(); }
  });

  it('02 successful create preserves complete data response readiness and one transaction-local audit', async () => {
    for (const [status, artist] of [['active', true], ['draft', false]] as const) {
      const f = fixture(status, artist);
      try {
        const principal = artist ? { id: ACTOR, adminPermissions: ['*'] } : OPERATOR;
        const result = await f.service.createBackstageFanMission(principal, input(status, artist));
        f.check(); const saved = f.snapshot(); assert(saved.mission);
        assert.deepEqual(saved.mission, createdRow(status, artist));
        assert.deepEqual(result, { mission: projection(saved.mission), publicReadiness: {
          publicListEndpoint: 'GET /api/v1/fan-engagement/missions?surface=home&scope=today&take=3',
          homeTodayEligible: status === 'active', warningKey: status === 'active' ? null : 'admin.fanEngagement.mission.notHomeTodayEligible',
          policy: POLICY }, policy: POLICY });
        assert.deepEqual(f.audits, [auditData(saved.mission)]);
        assert.equal(f.stats.artistReads, artist ? 1 : 0); assert.equal(f.stats.slugReads, 1);
        assert.equal(f.stats.transactions, 1); assert.equal(f.stats.txCreates, 1); assert.equal(f.stats.txAudits, 1);
        assert.equal(f.stats.rootCreates, 0); assert.equal(f.stats.rootAudits, 0);
        assert.equal(f.stats.commits, 1); assert.equal(f.stats.rollbacks, 0);
        assert.deepEqual(f.events, [...(artist ? ['root:artist'] : []), 'root:slug', 'root:transaction', 'tx:create', 'tx:audit', 'tx:commit']);
      } finally { f.finish(); }
    }
  });

  it('03 only create P2002 becomes duplicate while audit P2002 and other errors retain identity with rollback', async () => {
    for (const [stage, error, duplicate] of [
      ['create', known('P2002'), true], ['audit', known('P2002'), false],
      ['create', known('P2025'), false], ['create', new Error('Synthetic unknown create failure'), false],
    ] as const) {
      const f = fixture();
      try {
        f.fail(stage, error);
        await assert.rejects(f.service.createBackstageFanMission(OPERATOR, input()), caught => duplicate ? conflict(caught) : caught === error);
        f.check(); assert.deepEqual(f.snapshot(), { mission: null, audits: [] });
        assert.equal(f.stats.transactions, 1); assert.equal(f.stats.txCreates, 1);
        assert.equal(f.stats.txAudits, stage === 'audit' ? 1 : 0);
        assert.equal(f.stats.rootCreates, 0); assert.equal(f.stats.rootAudits, 0);
        assert.equal(f.stats.commits, 0); assert.equal(f.stats.rollbacks, 1);
      } finally { f.finish(); }
    }
  });

  it('04 authority validation artist duplicate preflight and commit failures preserve precedence and bounded attempts', async () => {
    for (const principal of [{ id: ACTOR }, { id: ACTOR, adminRole: 'viewer' }]) {
      const f = fixture();
      try {
        await assert.rejects(f.service.createBackstageFanMission(principal, {}), ForbiddenException);
        assert.equal(f.stats.attempts, 0); noWrites(f);
      } finally { f.finish(); }
    }
    for (const malformed of [{ ...input(), artistId: 'not-a-uuid' }, { ...input(), endsAt: '2019-01-01T00:00:00.000Z' },
      { ...input(), rewardPolicy: { points: -1 } }]) {
      const f = fixture();
      try {
        await assert.rejects(f.service.createBackstageFanMission(OPERATOR, malformed), BadRequestException);
        assert.equal(f.stats.attempts, 0); noWrites(f);
      } finally { f.finish(); }
    }
    {
      const f = fixture('active', true);
      try {
        f.missingArtist();
        await assert.rejects(f.service.createBackstageFanMission(OPERATOR, input('active', true)), caught =>
          caught instanceof NotFoundException && (caught.getResponse() as { code: string }).code === 'FAN_MISSION_ARTIST_NOT_FOUND');
        assert.equal(f.stats.artistReads, 1); assert.equal(f.stats.slugReads, 0); assert.equal(f.stats.transactions, 0); noWrites(f);
      } finally { f.finish(); }
    }
    {
      const f = fixture();
      try {
        f.duplicate();
        await assert.rejects(f.service.createBackstageFanMission(OPERATOR, input()), conflict);
        assert.equal(f.stats.slugReads, 1); assert.equal(f.stats.transactions, 0); noWrites(f);
      } finally { f.finish(); }
    }
    for (const stage of ['artist', 'preflight', 'transaction', 'commit'] as const) {
      const withArtist = stage === 'artist', f = fixture('active', withArtist);
      try {
        f.fail(stage);
        await assert.rejects(f.service.createBackstageFanMission(OPERATOR, input('active', withArtist)), caught => caught === f.error);
        f.check(); assert.deepEqual(f.snapshot(), { mission: null, audits: [] });
        assert.equal(f.stats.transactions, stage === 'transaction' || stage === 'commit' ? 1 : 0);
        assert.equal(f.stats.rootCreates, 0); assert.equal(f.stats.rootAudits, 0); assert.equal(f.stats.commits, 0);
        assert.equal(f.stats.txCreates, stage === 'commit' ? 1 : 0); assert.equal(f.stats.txAudits, stage === 'commit' ? 1 : 0);
        assert.equal(f.stats.rollbacks, stage === 'commit' ? 1 : 0);
        assert(f.stats.artistReads <= 1 && f.stats.slugReads <= 1);
      } finally { f.finish(); }
    }
  });
});

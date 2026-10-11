import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FanMission, FanMissionParticipation, Prisma } from '@prisma/client';
import { FanEngagementService } from '../src/fan-engagement/fan-engagement.service';

// Actual complete service + synthetic delegates only; no SQL locks or physical rollback proof.
const userId = '00000000-0000-4000-8000-000000000001';
const missionId = '00000000-0000-4000-8000-000000000101';
const otherMissionId = '00000000-0000-4000-8000-000000000102';
const artistId = '00000000-0000-4000-8000-000000000201';
const otherArtistId = '00000000-0000-4000-8000-000000000202';
const sourceId = 'aaaaaaaa-0000-4000-8000-000000000203';
const otherSourceId = 'bbbbbbbb-0000-4000-8000-000000000204';
const participationId = '00000000-0000-4000-8000-000000000301';
const now = new Date('2026-10-05T14:59:59.000Z');
const midnight = new Date('2026-10-05T15:00:00.000Z');
const body = { action: 'complete', idempotencyKey: 'synthetic-release-admission-key' };
const nonCash = { cashLike: false, luminaAmount: 0, settlementEligible: false, transferable: false };
const options = { concurrency: false, timeout: 2000 };

function mission(overrides: Partial<FanMission> = {}): FanMission {
  return {
    id: missionId, artistId: null, slug: 'synthetic-release-admission', missionType: 'daily_signal',
    status: 'active', surfaces: ['home'], resetPolicy: 'daily', actionType: 'mission_participation',
    actionTargetId: null, rewardPolicy: { points: 1 }, copy: {}, startsAt: null, endsAt: null,
    createdAt: now, updatedAt: now, ...overrides,
  };
}

function participation(overrides: Partial<FanMissionParticipation> = {}): FanMissionParticipation {
  const request = { action: 'complete', sourceType: null, sourceId: null };
  return {
    id: participationId, missionId, userId, artistId: null, participationType: 'daily_signal',
    status: 'accepted', moderationStatus: 'not_required', resetBucket: '2026-10-05',
    sourceType: null, sourceId: null, idempotencyKey: body.idempotencyKey,
    metadata: { idempotency: { requestFingerprint: JSON.stringify(request), request } },
    createdAt: now, updatedAt: now, ...overrides,
  };
}

type Stage = 'share' | 'mission' | 'participation' | 'ledger-read' | 'ledger-write';
type FixtureOptions = {
  current?: FanMission | null;
  outer?: FanMission | null;
  receipt?: FanMissionParticipation;
  duplicate?: FanMissionParticipation;
  existingLedger?: boolean;
  failure?: { stage: Stage; error: Error };
  share?: () => Promise<void>;
  afterLedgerRead?: () => void;
  afterLedgerWrite?: () => void;
};

function fixture(config: FixtureOptions = {}) {
  const current = config.current === undefined ? mission() : config.current;
  const outer = config.outer === undefined ? current : config.outer;
  const calls: string[] = [];
  const rawCalls: Array<{ strings: TemplateStringsArray; values: unknown[] }> = [];
  const missionReads: Prisma.FanMissionFindUniqueArgs[] = [];
  const rootReads: Prisma.FanMissionParticipationFindUniqueArgs[] = [];
  const participationAttempts: Prisma.FanMissionParticipationCreateArgs[] = [];
  const ledgerAttempts: Prisma.FanEngagementPointLedgerCreateArgs[] = [];

  function step(stage: Stage) {
    calls.push('tx:' + stage);
    if (config.failure?.stage === stage) throw config.failure.error;
  }

  const tx = {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      rawCalls.push({ strings, values });
      step('share');
      await config.share?.();
      return [{ id: missionId }];
    },
    fanMission: {
      async findUnique(args: Prisma.FanMissionFindUniqueArgs) {
        missionReads.push(args); step('mission'); return current;
      },
    },
    fanMissionParticipation: {
      async create(args: Prisma.FanMissionParticipationCreateArgs) {
        participationAttempts.push(args); step('participation');
        return { ...participation(), ...args.data };
      },
    },
    fanEngagementPointLedger: {
      async findUnique() {
        step('ledger-read'); config.afterLedgerRead?.();
        return config.existingLedger ? { id: 'synthetic-existing-ledger' } : null;
      },
      async create(args: Prisma.FanEngagementPointLedgerCreateArgs) {
        ledgerAttempts.push(args); step('ledger-write'); config.afterLedgerWrite?.();
        return { id: 'synthetic-release-admission-ledger' };
      },
    },
  };
  const prisma = {
    fanMission: {
      async findUnique() { calls.push('root:mission'); return outer; },
    },
    fanMissionParticipation: {
      async findUnique(args: Prisma.FanMissionParticipationFindUniqueArgs) {
        rootReads.push(args);
        if (args.where.userId_idempotencyKey) {
          calls.push('root:receipt'); return config.receipt ?? null;
        }
        calls.push('root:bucket'); return config.duplicate ?? null;
      },
    },
    async $transaction(callback: (client: typeof tx) => Promise<unknown>) {
      calls.push('tx:start');
      try {
        const result = await callback(tx); calls.push('tx:resolved'); return result;
      } catch (error) {
        // Attempted writes remain visible: callback rejection is not a database rollback simulation.
        calls.push('tx:rejected'); throw error;
      }
    },
  };
  return {
    service: new FanEngagementService(prisma as never), calls, rawCalls, missionReads,
    rootReads, participationAttempts, ledgerAttempts, current, outer,
  };
}

type Fixture = ReturnType<typeof fixture>;

function noWrites(f: Fixture) {
  assert.equal(f.participationAttempts.length, 0);
  assert.equal(f.ledgerAttempts.length, 0);
  assert.equal(f.calls.includes('tx:ledger-read'), false);
}

function noAdmission(f: Fixture) {
  assert.equal(f.calls.includes('root:mission'), false);
  assert.equal(f.calls.includes('root:bucket'), false);
  assert.equal(f.calls.includes('tx:start'), false);
  assert.equal(f.rawCalls.length, 0);
  assert.equal(f.missionReads.length, 0);
  noWrites(f);
}

function codeError(code: string, expected?: { messageKey: string; details?: Record<string, unknown> }) {
  return (error: unknown) => {
    const exception = error as { getStatus?: () => number; getResponse?: () => unknown };
    assert.equal(exception.getStatus?.(), 400);
    const response = exception.getResponse?.() as {
      code?: string; messageKey?: string; details?: Record<string, unknown>;
    };
    assert.equal(response.code, code);
    if (expected) {
      assert.equal(response.messageKey, expected.messageKey);
      assert.deepEqual(response.details, expected.details);
    }
    return true;
  };
}

function currentRead(f: Fixture) {
  assert.equal(f.rawCalls.length, 1);
  assert.deepEqual(f.rawCalls[0].values, [missionId]);
  assert.equal(f.rawCalls[0].strings.join('?'),
    'SELECT id FROM public.fan_missions WHERE id = ?::uuid FOR SHARE');
  assert.deepEqual(f.missionReads, [{ where: { id: missionId } }]);
  assert.deepEqual(f.calls.slice(0, 6),
    ['root:receipt', 'root:mission', 'root:bucket', 'tx:start', 'tx:share', 'tx:mission']);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function withClock(run: (clock: { value: number }) => Promise<void>) {
  const OriginalDate = globalThis.Date;
  const clock = { value: now.getTime() };
  class SyntheticDate extends OriginalDate {
    constructor(value?: string | number) { super(value === undefined ? clock.value : value); }
    static now() { return clock.value; }
  }
  // Only this serial synthetic test process changes its clock; always restore it.
  globalThis.Date = SyntheticDate as unknown as DateConstructor;
  try { await run(clock); } finally { globalThis.Date = OriginalDate; }
}

test('01 accepts daily/once and preserves source metadata and non-cash rewards', options, () => withClock(async () => {
  for (const resetPolicy of ['daily', 'once']) {
    const f = fixture({ current: mission({ resetPolicy }) });
    const request = { action: 'complete', sourceType: 'synthetic-reference', sourceId };
    const result = await f.service.createMissionParticipation(userId, missionId, { ...body, ...request });
    currentRead(f);
    assert.equal(result.idempotentReplay, false);
    assert.deepEqual(result.rewards, { pointsGranted: 1, achievementsGranted: [], titlesGranted: [], ...nonCash });
    assert.equal(result.participation.id, participationId);
    assert.equal(result.participation.status, 'accepted');
    assert.equal(f.participationAttempts.length, 1);
    const data = f.participationAttempts[0].data;
    assert.equal(data.participationType, 'daily_signal');
    assert.equal(data.resetBucket, resetPolicy === 'once' ? 'once' : '2026-10-05');
    assert.equal(data.sourceType, request.sourceType);
    assert.equal(data.sourceId, request.sourceId);
    assert.deepEqual(data.metadata, { idempotency: { requestFingerprint: JSON.stringify(request), request } });
    assert.equal(f.ledgerAttempts.length, 1);
    assert.deepEqual(f.ledgerAttempts[0].data, {
      userId, points: 1, direction: 'earn', ledgerType: 'mission_reward',
      referenceType: 'fan_mission_participation', referenceId: participationId, metadata: nonCash,
    });
    assert.equal(f.calls[f.calls.length - 1], 'tx:resolved');
  }
}));

test('02 preserves ROOT input guards before reads and nullable/omitted compatibility', options, () => withClock(async () => {
  for (const invalid of [undefined, null, [], ['complete'], 'complete', 0, true]) {
    const f = fixture();
    await assert.rejects(f.service.createMissionParticipation(userId, missionId, invalid as never),
      codeError('INVALID_REQUEST', { messageKey: 'fanEngagement.validation.invalidRequest' }));
    assert.deepEqual(f.calls, []); noAdmission(f);
  }
  for (const field of ['action', 'sourceType', 'sourceId', 'idempotencyKey']) {
    for (const value of [0, false, {}, []]) {
      const f = fixture();
      await assert.rejects(f.service.createMissionParticipation(userId, missionId, { ...body, [field]: value }),
        codeError('INVALID_FIELD_TYPE', {
          messageKey: 'fanEngagement.validation.invalidFieldType', details: { field },
        }));
      assert.deepEqual(f.calls, []); noAdmission(f);
    }
  }
  for (const valid of [{}, { action: null, sourceType: null, sourceId: null, idempotencyKey: null }]) {
    const f = fixture();
    const result = await f.service.createMissionParticipation(userId, missionId, valid);
    assert.equal(result.idempotentReplay, false);
    assert.equal(f.participationAttempts.length, 1);
    assert.equal(f.participationAttempts[0].data.sourceType, null);
    assert.equal(f.participationAttempts[0].data.sourceId, null);
  }
}));

test('03 rejects exact unsupported combinations and untrusted source evidence', options, () => withClock(async () => {
  const unsupported: Partial<FanMission>[] = [
    { missionType: 'vote_concept', actionType: 'concept_vote', actionTargetId: sourceId },
    { missionType: 'read_story' }, { missionType: 'chat' }, { missionType: 'qa_submit_smoke' },
    { missionType: 'unknown' }, { actionType: null }, { actionType: 'one_tap' },
    { actionType: 'concept_vote' }, { actionType: 'source_evidence' }, { actionTargetId: sourceId },
    { resetPolicy: 'weekly' }, { resetPolicy: 'season:synthetic' },
    { resetPolicy: 'daily:synthetic' }, { resetPolicy: 'once:synthetic' },
  ];
  for (const config of unsupported) {
    const f = fixture({ current: mission(config) });
    await assert.rejects(f.service.createMissionParticipation(userId, missionId, body),
      codeError('MISSION_REQUIRES_VERIFIED_ACTIVITY'));
    currentRead(f); noWrites(f);
    assert.equal(f.calls[f.calls.length - 1], 'tx:rejected');
  }
  for (const source of [{ sourceType: 'concept_vote' }, { sourceId }, { sourceType: 'concept_vote', sourceId }]) {
    const f = fixture({ current: mission(unsupported[0]) });
    await assert.rejects(f.service.createMissionParticipation(userId, missionId, { ...body, ...source }),
      codeError('MISSION_REQUIRES_VERIFIED_ACTIVITY'));
    currentRead(f); noWrites(f);
  }
  for (const config of [{ missionType: 'read_story' }, { actionType: 'source_evidence' },
    { actionTargetId: sourceId }, { resetPolicy: 'season:synthetic' }]) {
    const f = fixture({ current: mission(config), outer: mission() });
    await assert.rejects(f.service.createMissionParticipation(userId, missionId, body),
      codeError('MISSION_REQUIRES_VERIFIED_ACTIVITY'));
    currentRead(f); noWrites(f);
  }
}));

test('04 waits for SHARE before rereading a now-closed current mission', options, () => withClock(async () => {
  const entered = deferred(); const release = deferred();
  const current = mission();
  const f = fixture({ current, outer: mission(), share: async () => {
    entered.resolve(); await release.promise;
  } });
  const outcome = f.service.createMissionParticipation(userId, missionId, body).then(
    value => ({ kind: 'success' as const, value }),
    error => ({ kind: 'failure' as const, error }),
  );
  try {
    await Promise.race([entered.promise, outcome.then(() => {
      throw new Error('Synthetic admission settled before reaching SHARE');
    })]);
    assert.deepEqual(f.calls, ['root:receipt', 'root:mission', 'root:bucket', 'tx:start', 'tx:share']);
    assert.equal(f.missionReads.length, 0); noWrites(f);
    current.status = 'closed';
  } finally { release.resolve(); }
  const result = await outcome;
  assert.equal(result.kind, 'failure');
  if (result.kind !== 'failure') throw new Error('Synthetic admission unexpectedly succeeded');
  codeError('MISSION_NOT_ACTIVE')(result.error);
  currentRead(f); noWrites(f);
  assert.equal(f.calls[f.calls.length - 1], 'tx:rejected');
}));

test('05 uses current reward policy rather than stale outer or client points', options, () => withClock(async () => {
  const f = fixture({ outer: mission({ rewardPolicy: { points: 1 } }),
    current: mission({ rewardPolicy: { points: 2 } }) });
  const result = await f.service.createMissionParticipation(userId, missionId, { ...body, points: 999 });
  currentRead(f);
  assert.equal(result.rewards.pointsGranted, 2);
  assert.equal(f.ledgerAttempts.length, 1);
  assert.equal(f.ledgerAttempts[0].data.points, 2);
  assert.equal(f.calls[f.calls.length - 1], 'tx:resolved');
}));

test('06 uses current reset/artist and post-wait KST day instead of the outer snapshot', options, () => withClock(async clock => {
  for (const resetPolicy of ['daily', 'once']) {
    clock.value = now.getTime();
    const f = fixture({
      outer: mission({ artistId: otherArtistId, missionType: 'vote_concept', actionType: 'concept_vote',
        actionTargetId: sourceId, resetPolicy: 'daily' }),
      current: mission({ artistId, resetPolicy }),
      share: async () => { clock.value = midnight.getTime(); },
    });
    await f.service.createMissionParticipation(userId, missionId, body);
    currentRead(f);
    assert.equal(f.rootReads[1].where.missionId_userId_resetBucket?.resetBucket, '2026-10-05');
    assert.equal(f.participationAttempts[0].data.resetBucket, resetPolicy === 'once' ? 'once' : '2026-10-06');
    assert.equal(f.participationAttempts[0].data.artistId, artistId);
    assert.equal(f.participationAttempts[0].data.participationType, 'daily_signal');
  }
}));

test('07 preserves window boundaries and rejects final expiry after attempted point work', options, () => withClock(async clock => {
  const open = fixture({ current: mission({ startsAt: now }) });
  await open.service.createMissionParticipation(userId, missionId, body);
  assert.equal(open.participationAttempts.length, 1);
  for (const window of [{ startsAt: new Date(now.getTime() + 1) }, { endsAt: now }]) {
    const f = fixture({ current: mission(window) });
    await assert.rejects(f.service.createMissionParticipation(userId, missionId, body), codeError('MISSION_NOT_ACTIVE'));
    assert.equal(f.rawCalls.length, 0); noWrites(f);
  }
  for (const stage of ['afterLedgerRead', 'afterLedgerWrite'] as const) {
    clock.value = now.getTime();
    const f = fixture({ current: mission({ endsAt: midnight }),
      [stage]: () => { clock.value = midnight.getTime(); } });
    await assert.rejects(f.service.createMissionParticipation(userId, missionId, body), codeError('MISSION_NOT_ACTIVE'));
    currentRead(f);
    assert.equal(f.participationAttempts.length, 1);
    assert.equal(f.ledgerAttempts.length, 1);
    assert.equal(f.calls[f.calls.length - 1], 'tx:rejected');
  }
}));

test('08 replays stored unsupported/closed/missing receipts with zero new rewards', options, () => withClock(async () => {
  const request = { action: 'complete', sourceType: 'read_story', sourceId };
  for (const current of [null, mission({ status: 'closed' }), mission({ missionType: 'read_story', actionType: 'source_evidence' })]) {
    for (const metadata of [{}, { idempotency: { requestFingerprint: JSON.stringify(request), request } }]) {
      const f = fixture({ current, receipt: participation({ participationType: 'read_story',
        sourceType: request.sourceType, sourceId, metadata }) });
      const result = await f.service.createMissionParticipation(userId, missionId, { ...body, ...request });
      assert.equal(result.idempotentReplay, true);
      assert.equal(result.participation.id, participationId);
      assert.deepEqual(result.rewards, { pointsGranted: 0, achievementsGranted: [], titlesGranted: [], ...nonCash });
      assert.deepEqual(f.calls, ['root:receipt']);
      noAdmission(f);
    }
  }
}));

test('09 preserves stored-key body and mission mismatch errors without admission', options, () => withClock(async () => {
  const receipt = participation({ sourceType: 'read_story', sourceId, metadata: {} });
  const f = fixture({ receipt });
  await assert.rejects(f.service.createMissionParticipation(userId, missionId,
    { ...body, sourceType: 'read_story', sourceId: otherSourceId }), codeError('IDEMPOTENCY_BODY_MISMATCH'));
  assert.deepEqual(f.calls, ['root:receipt']); noAdmission(f);
  const g = fixture({ receipt });
  await assert.rejects(g.service.createMissionParticipation(userId, otherMissionId,
    { ...body, sourceType: 'read_story', sourceId }), codeError('IDEMPOTENCY_KEY_REUSED'));
  assert.deepEqual(g.calls, ['root:receipt']); noAdmission(g);
}));

test('10 preserves duplicate precheck and transaction unique-error rejection', options, () => withClock(async () => {
  const duplicate = fixture({ duplicate: participation() });
  await assert.rejects(duplicate.service.createMissionParticipation(userId, missionId, body),
    codeError('ALREADY_PARTICIPATED'));
  assert.deepEqual(duplicate.calls, ['root:receipt', 'root:mission', 'root:bucket']);
  assert.equal(duplicate.rawCalls.length, 0); noWrites(duplicate);
  const unique = Object.assign(new Error('Synthetic unique constraint'), { code: 'P2002' });
  const f = fixture({ failure: { stage: 'participation', error: unique } });
  await assert.rejects(f.service.createMissionParticipation(userId, missionId, body), codeError('ALREADY_PARTICIPATED'));
  currentRead(f);
  assert.equal(f.participationAttempts.length, 1);
  assert.equal(f.ledgerAttempts.length, 0);
  assert.equal(f.calls[f.calls.length - 1], 'tx:rejected');
}));

test('11 propagates SHARE/read/participation/ledger failures without fake rollback', options, () => withClock(async () => {
  for (const stage of ['share', 'mission', 'participation', 'ledger-read', 'ledger-write'] as const) {
    const failure = new Error('Synthetic failure at ' + stage);
    const f = fixture({ failure: { stage, error: failure } });
    await assert.rejects(f.service.createMissionParticipation(userId, missionId, body), error => {
      assert.equal(error, failure); return true;
    });
    assert.equal(f.calls[f.calls.length - 1], 'tx:rejected');
    assert.equal(f.participationAttempts.length, stage === 'share' || stage === 'mission' ? 0 : 1);
    assert.equal(f.ledgerAttempts.length, stage === 'ledger-write' ? 1 : 0);
  }
}));

test('12 retains configured zero and existing-ledger zero without re-awarding', options, () => withClock(async () => {
  const zero = fixture({ current: mission({ rewardPolicy: { points: 0 } }) });
  const zeroResult = await zero.service.createMissionParticipation(userId, missionId, body);
  currentRead(zero);
  assert.equal(zeroResult.rewards.pointsGranted, 0);
  assert.equal(zero.participationAttempts.length, 1);
  assert.equal(zero.calls.includes('tx:ledger-read'), false);
  assert.equal(zero.ledgerAttempts.length, 0);
  const existing = fixture({ existingLedger: true });
  const existingResult = await existing.service.createMissionParticipation(userId, missionId, body);
  currentRead(existing);
  assert.equal(existingResult.rewards.pointsGranted, 0);
  assert.equal(existing.participationAttempts.length, 1);
  assert.equal(existing.calls.includes('tx:ledger-read'), true);
  assert.equal(existing.ledgerAttempts.length, 0);
}));

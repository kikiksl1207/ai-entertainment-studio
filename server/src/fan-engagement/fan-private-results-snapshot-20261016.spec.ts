import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { FanEngagementService } from './fan-engagement.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const VOTE = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const OPTION = '55555555-5555-4555-8555-555555555555';
const SECOND = '66666666-6666-4666-8666-666666666666';
const BALLOT = '77777777-7777-4777-8777-777777777777';
const ARTIST = '88888888-8888-4888-8888-888888888888';
const KEY = 'synthetic-private-results-replay';
const CREATED = new Date('2026-01-02T03:04:05.000Z');
function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(item => clone(item)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  }
  return value;
}
type Row = { optionId: string | null; ballotCount: bigint };
type Preview = { visible: boolean; totalBallots: number;
  options: Array<{ id: string; ballotCount: number; ratio: number }> } | null;
type Plan = { id: string; rows: Row[]; error?: Error };
const SQL_HEAD = '\n      SELECT b.option_id AS "optionId", count(b.id)::bigint AS "ballotCount"\n' +
  '      FROM public.concept_votes v\n' +
  '      LEFT JOIN public.concept_vote_ballots b ON b.vote_id = v.id\n' +
  '      WHERE v.id = ';
const SQL_TAIL = "::uuid AND v.visibility = 'public'\n      GROUP BY b.option_id\n      ORDER BY b.option_id\n    ";

function fixture(input: { plan?: Plan; current?: 'public' | 'private' | 'missing'; withdrawAfterList?: boolean } = {}) {
  let current = input.current ?? 'private';
  const plan = input.plan ?? { id: VOTE, rows: [] };
  const vote = { id: VOTE, status: 'closed', visibility: 'public', startsAt: null,
    endsAt: new Date('2020-01-01T00:00:00.000Z'),
    artist: { id: ARTIST, slug: 'synthetic-artist', displayName: 'Synthetic artist' },
    copy: {}, options: [
      { id: OPTION, optionKey: 'first', copy: {}, sortOrder: 0 },
      { id: SECOND, optionKey: 'second', copy: {}, sortOrder: 1 },
    ] };
  const stored = { id: BALLOT, voteId: VOTE, optionId: OPTION, userId: A,
    idempotencyKey: KEY, missionId: null, createdAt: CREATED, vote: clone(vote), option: clone(vote.options[0]) };
  const before = clone(stored);
  const attempts: Record<string, number> = {};
  const calls: Array<{ kind: string; value: unknown }> = [];
  const faults: string[] = [];
  function attempt(kind: string) { attempts[kind] = (attempts[kind] ?? 0) + 1; }
  function admit<T>(run: () => T): T {
    try { return run(); } catch (error) { faults.push('Synthetic admission failure'); throw error; }
  }
  function invoke<T>(kind: string, value: unknown, run: () => T): T {
    attempt(kind);
    return admit(() => { const result = run(); calls.push({ kind, value: clone(value) }); return result; });
  }
  function deny(kind: string): never {
    attempt(kind); return admit(() => { throw new Error('Unadmitted synthetic dependency'); });
  }
  const ballot = new Proxy({}, { get(_target, field) {
    if (field === 'findUnique') return async (args: unknown) => invoke('receipt', args, () => {
      assert.equal(attempts.receipt, 1);
      const query = args as { where: { userId_idempotencyKey: { userId: string; idempotencyKey: string } }; include: unknown };
      const caller = query.where.userId_idempotencyKey.userId;
      assert([A, B].includes(caller));
      assert.deepEqual(args, { where: { userId_idempotencyKey: { userId: caller, idempotencyKey: KEY } },
        include: { vote: { include: { artist: true, options: true } }, option: true } });
      return caller === A ? clone(stored) : null;
    });
    if (field === 'findMany') return async (args: unknown) => invoke('ownBallots', args, () => {
      assert.equal(attempts.ownBallots, 1);
      assert.deepEqual(args, { where: { userId: A, voteId: { in: [VOTE] } } });
      if (input.withdrawAfterList) current = 'private';
      return [clone(stored)];
    });
    if (field === 'groupBy') return async (args: unknown) => invoke('legacyGroupBy', args, () => {
      assert.equal(attempts.legacyGroupBy, 1);
      assert.deepEqual(args, { by: ['optionId'], where: { voteId: VOTE }, _count: { _all: true } });
      // Only the old service calls this visibility-blind ORM seam. It is not a SQL implementation.
      return [{ optionId: OPTION, _count: { _all: 2 } }, { optionId: SECOND, _count: { _all: 1 } }];
    });
    return deny('ballot.' + String(field));
  } });
  const votes = new Proxy({}, { get(_target, field) {
    if (field === 'findMany') return async (args: unknown) => invoke('list', args, () => {
      assert.equal(attempts.list, 1); assert.equal(current, 'public');
      assert.deepEqual(args, { where: { status: 'closed', visibility: 'public' },
        include: { artist: { select: { id: true, slug: true, displayName: true } },
          options: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
        orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }], take: 20 });
      return [clone(vote)];
    });
    if (field === 'findUnique') return async (args: unknown) => invoke('currentVote', args, () => {
      assert.equal(attempts.currentVote, 1);
      assert.deepEqual(args, { where: { id: VOTE },
        include: { artist: { select: { id: true, slug: true, displayName: true } }, options: true } });
      return current === 'missing' ? null : { ...clone(vote), visibility: current };
    });
    return deny('vote.' + String(field));
  } });
  const missions = new Proxy({}, { get(_target, field) {
    if (field === 'findMany') return async (args: unknown) => invoke('missionList', args, () => {
      assert.equal(attempts.missionList, 1);
      assert.deepEqual(args, { where: { status: 'active', missionType: 'vote_concept',
        actionType: 'concept_vote', actionTargetId: { in: [VOTE] } } });
      return [];
    });
    return deny('mission.' + String(field));
  } });
  const db = new Proxy({}, { get(_target, field) {
    if (field === 'conceptVoteBallot') return ballot;
    if (field === 'conceptVote') return votes;
    if (field === 'fanMission') return missions;
    if (field === '$queryRaw') return async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const selected = invoke('aggregate', { values, current }, () => {
        assert.equal(attempts.aggregate, 1);
        assert(Array.isArray(strings)); assert.deepEqual([...strings], [SQL_HEAD, SQL_TAIL]);
        assert.deepEqual([...strings.raw], [SQL_HEAD, SQL_TAIL]);
        assert.deepEqual(values, [plan.id]);
        assert(/^[a-f0-9-]{36}$/.test(plan.id));
        assert(!strings.join('').includes(plan.id), 'Only a bound vote parameter');
        return plan;
      });
      // Scripted database failure is outside admission: original identity must propagate.
      if (selected.error) throw selected.error;
      return clone(selected.rows);
    };
    return deny('root.' + String(field));
  } });
  const service = new FanEngagementService(db as PrismaService);
  function check() {
    assert.deepEqual(faults, [], 'Product catches cannot swallow fixture admission faults');
    for (const [kind, count] of Object.entries(attempts)) {
      assert.equal(count, calls.filter(row => row.kind === kind).length, 'Every invocation must be admitted');
    }
    assert.deepEqual(stored, before, 'The saved receipt must remain byte-value equivalent');
  }
  const count = (kind: string) => attempts[kind] ?? 0;
  function noWrites() {
    check();
    assert(Object.keys(attempts).every(kind =>
      ['receipt', 'ownBallots', 'legacyGroupBy', 'list', 'currentVote', 'missionList', 'aggregate'].includes(kind)));
  }
  function currentOnlyAggregate() {
    check(); assert.equal(count('aggregate'), 1); assert.equal(count('legacyGroupBy'), 0);
  }
  const replay = (userId = A, body: Record<string, unknown> = { optionId: OPTION, idempotencyKey: KEY }, id = VOTE) =>
    service.submitConceptVoteBallot(userId, id, body);
  // Explicit direct invocation of the actual private helper is used only for impossible zero/missing receipt states.
  const direct = () => (service as unknown as { resultsPreview(id: string): Promise<Preview> }).resultsPreview(plan.id);
  return { service, replay, direct, check, noWrites, currentOnlyAggregate, count, calls,
    receipt: { id: BALLOT, voteId: VOTE, optionId: OPTION, createdAt: CREATED } };
}
function assertReplay(result: Awaited<ReturnType<FanEngagementService['submitConceptVoteBallot']>>,
  receipt: { id: string; voteId: string; optionId: string; createdAt: Date }) {
  assert.deepEqual(result.ballot, receipt);
  assert.deepEqual(result.viewer, { hasVoted: true, selectedOptionId: OPTION });
  assert.equal(result.idempotentReplay, true); assert.equal(result.missionParticipation, null);
  assert.deepEqual(result.rewards, { pointsGranted: 0, achievementsGranted: [], titlesGranted: [],
    cashLike: false, luminaAmount: 0, settlementEligible: false, transferable: false });
}

describe('FanEngagementService private results snapshot focused', () => {
  it('01 an owned committed private ballot replays its receipt without exposing a current aggregate', async () => {
    const f = fixture({ current: 'private', plan: { id: VOTE, rows: [] } });
    try {
      const result = await f.replay(); f.check(); assertReplay(result, f.receipt);
      assert.equal(result.resultsPreview, null,
        'FAN_PRIVATE_RESULTS_CURRENT_SNAPSHOT: owned private replay must suppress the current aggregate');
      f.currentOnlyAggregate();
      assert.equal(f.count('receipt'), 1); assert.equal(f.count('currentVote'), 0);
      assert.equal(f.count('list'), 0); f.noWrites();
    } finally { f.check(); }
  });

  it('02 public closed counts and zero remain visible while missing and withdrawn list aggregates are null', async () => {
    const expected = { visible: true, totalBallots: 3, options: [
      { id: OPTION, ballotCount: 2, ratio: 66.7 }, { id: SECOND, ballotCount: 1, ratio: 33.3 },
    ] };
    const publicReplay = fixture({ current: 'public',
      plan: { id: VOTE, rows: [{ optionId: OPTION, ballotCount: BigInt(2) }, { optionId: SECOND, ballotCount: BigInt(1) }] } });
    try {
      const result = await publicReplay.replay(); assertReplay(result, publicReplay.receipt);
      assert.deepEqual(result.resultsPreview, expected); publicReplay.currentOnlyAggregate(); publicReplay.noWrites();
    } finally { publicReplay.check(); }
    for (const state of ['public', 'missing', 'private'] as const) {
      const zero = fixture({ current: state, plan: { id: OTHER,
        rows: state === 'public' ? [{ optionId: null, ballotCount: BigInt(0) }] : [] } });
      try {
        assert.deepEqual(await zero.direct(), state === 'public'
          ? { visible: true, totalBallots: 0, options: [] } : null);
        zero.currentOnlyAggregate(); assert.equal(zero.count('receipt'), 0); zero.noWrites();
      } finally { zero.check(); }
    }
    const withdrawn = fixture({ current: 'public', withdrawAfterList: true, plan: { id: VOTE, rows: [] } });
    try {
      const result = await withdrawn.service.getConceptVotes({ status: 'closed' }, A);
      assert.equal(result.items.length, 1);
      assert.deepEqual(result.items[0].viewer, { hasVoted: true, selectedOptionId: OPTION });
      assert.equal(result.items[0].resultsPreview, null);
      withdrawn.currentOnlyAggregate();
      assert.deepEqual(withdrawn.calls.find(row => row.kind === 'aggregate')?.value, { values: [VOTE], current: 'private' });
      assert.equal(withdrawn.count('list'), 1); assert.equal(withdrawn.count('ownBallots'), 1);
      assert.equal(withdrawn.count('missionList'), 1); withdrawn.noWrites();
    } finally { withdrawn.check(); }
  });

  it('03 query failures propagate and caller or intent mismatches cannot read aggregates or create rewards', async () => {
    for (const mode of ['replay', 'direct', 'list'] as const) {
      const failure = new Error('Synthetic aggregate read failure');
      const f = fixture({ current: 'public', plan: { id: VOTE, rows: [], error: failure } });
      try {
        const call = mode === 'replay' ? f.replay() : mode === 'direct'
          ? f.direct() : f.service.getConceptVotes({ status: 'closed' }, A);
        await assert.rejects(call, error => error === failure);
        f.currentOnlyAggregate(); f.noWrites();
      } finally { f.check(); }
    }
    for (const variant of ['body', 'key', 'foreign'] as const) {
      const f = fixture({ current: 'private' });
      try {
        const call = variant === 'body' ? f.replay(A, { optionId: SECOND, idempotencyKey: KEY })
          : variant === 'key' ? f.replay(A, { optionId: OPTION, idempotencyKey: KEY }, OTHER)
          : f.replay(B);
        const code = variant === 'body' ? 'IDEMPOTENCY_BODY_MISMATCH'
          : variant === 'key' ? 'IDEMPOTENCY_KEY_REUSED' : 'VOTE_NOT_ACTIVE';
        await assert.rejects(call, error => error instanceof BadRequestException
          && (error.getResponse() as { code: string }).code === code);
        assert.equal(f.count('receipt'), 1); assert.equal(f.count('aggregate'), 0);
        assert.equal(f.count('legacyGroupBy'), 0); f.noWrites();
      } finally { f.check(); }
    }
    // Pinned SDK implementation is loaded, not a fake financial conversion.
    assert.equal(new Prisma.Decimal('1.25').toString(), '1.25');
  });
});

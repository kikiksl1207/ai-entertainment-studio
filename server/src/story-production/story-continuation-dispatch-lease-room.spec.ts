import { ConflictException } from '@nestjs/common';
import { StoryContinuationExecutor } from './story-continuation.executor';
import {
  PrismaStoryContinuationQueueRepository,
  StoryContinuationDispatchAuthorizationChanged,
  StoryContinuationDispatchLeaseInsufficient,
  type StoryContinuationClaim,
  type StoryContinuationQueueRepository,
} from './story-continuation.repository';
import {
  StoryContinuationProviderError,
  type StoryContinuationProviderResult,
} from './story-continuation.provider';
import { readStoryContinuationTimingPolicy } from './story-continuation-timing.config';
import {
  createStoryContinuationTimingPolicy,
  type StoryContinuationTimingPolicy,
} from './story-continuation-timing.policy';
import {
  STORY_CONTINUATION_PROMPT_VERSION,
  STORY_CONTINUATION_SCHEMA_VERSION,
} from './story-continuation-openai.schema';

const CLAIM: StoryContinuationClaim = {
  continuationId: '00000000-0000-4000-8000-000000000071',
  leaseToken: 'independent-synthetic-lease',
  attemptCount: 1,
  maxAttempts: 3,
  request: {
    operationId: '00000000-0000-4000-8000-000000000071',
    locale: 'en', contextFingerprint: 'independent-synthetic-context',
    promptVersion: STORY_CONTINUATION_PROMPT_VERSION,
    outputSchemaVersion: STORY_CONTINUATION_SCHEMA_VERSION,
    inputTokenLimit: 1000, outputTokenLimit: 500,
  },
};
const NARRATIVE = 'The guard waited beside the gate and heard a quiet knock.';
const RESULT: StoryContinuationProviderResult = {
  title: { en: 'The Quiet Gate' },
  beats: [{ beatType: 'paragraph', content: { en: NARRATIVE } }],
  visualManifest: {
    sceneKey: `ai-${CLAIM.continuationId}`,
    background: { state: 'fallback', altKey: 'story.visual.generated' },
    characters: [],
    fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' },
  },
  nextChoices: [
    { choiceKey: 'wait', label: { en: 'Wait by the gate' } },
    { choiceKey: 'open', label: { en: 'Open the gate' } },
    { choiceKey: 'leave', label: { en: 'Leave the courtyard' } },
  ],
  usage: { inputTokens: 10, outputTokens: 20, cachedInputTokens: 0, imageUnits: 0 },
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type SqlBoundary = { text: string; values: unknown[] };
type BoundaryOptions = {
  rows?: unknown[];
  updated?: number;
  acknowledgement?: ReturnType<typeof deferred<void>>;
  commitError?: unknown;
};

// These are Prisma transaction boundaries, not a SQL engine. SQL predicates are
// asserted separately; the parent owns PostgreSQL execution and concurrency proof.
function repositoryFixture(options: BoundaryOptions = {}) {
  const events: string[] = [];
  const callbackCompleted = deferred<unknown>();
  const tx = {
    $queryRaw: jest.fn(async (_sql: SqlBoundary): Promise<unknown[]> => {
      events.push('room');
      return options.rows ?? [{ lease_has_room: true }];
    }),
    $executeRaw: jest.fn(async (_sql: SqlBoundary) => {
      events.push('fence');
      return options.updated ?? 1;
    }),
  };
  const prisma = {
    $queryRaw: jest.fn(async () => { throw new Error('Query escaped transaction'); }),
    $executeRaw: jest.fn(async () => { throw new Error('Fence escaped transaction'); }),
    $transaction: jest.fn(async (operation: (client: typeof tx) => Promise<unknown>) => {
      events.push('begin');
      const marker = await operation(tx);
      events.push('callback-complete');
      callbackCompleted.resolve(marker);
      if (options.acknowledgement) await options.acknowledgement.promise;
      if (options.commitError) {
        events.push('ack-lost');
        throw options.commitError;
      }
      events.push('ack');
      return marker;
    }),
  };
  const repository = new PrismaStoryContinuationQueueRepository(prisma as never);
  const authorize = jest.fn(async (client: unknown) => {
    expect(client).toBe(tx);
    events.push('authorize');
    return true;
  });
  return { repository, prisma, tx, events, authorize, callbackCompleted, options };
}

function assertSqlScope(sql: SqlBoundary, kind: 'select' | 'update', minimum: number) {
  const text = sql.text.replace(/\s+/g, ' ').trim();
  expect(text).toContain("status = 'processing'");
  expect(text).toContain("request_kind = 'recommended_choice'");
  expect(text).toContain('dispatch_started_at IS NULL');
  expect(text).toContain('lease_expires_at > clock_timestamp()');
  expect(text).not.toMatch(/CURRENT_TIMESTAMP|\bNOW\s*\(/i);
  const offset = kind === 'select' ? 2 : 1;
  expect(text).toContain(`id = $${offset}::uuid`);
  expect(text).toContain(`lease_token = $${offset + 1}`);
  expect(text).toContain(`attempt_count = $${offset + 2}`);
  const minimumSlot = kind === 'select' ? 1 : 4;
  expect(text).toContain(`lease_expires_at >= clock_timestamp() + ($${minimumSlot}::double precision * INTERVAL '1 millisecond')`);
  expect(sql.values).toEqual(kind === 'select'
    ? [minimum, CLAIM.continuationId, CLAIM.leaseToken, CLAIM.attemptCount]
    : [CLAIM.continuationId, CLAIM.leaseToken, CLAIM.attemptCount, minimum]);
  if (kind === 'select') {
    expect(text).toMatch(/^SELECT /);
    expect(text).toContain('AS lease_has_room');
    expect(text).toMatch(/FOR UPDATE$/);
  } else {
    expect(text).toMatch(/^UPDATE story_ai_continuations SET dispatch_started_at = clock_timestamp\(\)/);
  }
}

function executorFixture(options: BoundaryOptions = {}, timing?: StoryContinuationTimingPolicy) {
  const f = repositoryFixture(options);
  const queue: StoryContinuationQueueRepository = f.repository;
  const claimExpiredTerminal = jest.spyOn(queue, 'claimExpiredTerminal').mockResolvedValue(null);
  const claimNext = jest.spyOn(queue, 'claimNext').mockResolvedValue(CLAIM);
  const markDispatched = jest.spyOn(queue, 'markDispatched');
  const releaseForRetry = jest.spyOn(queue, 'releaseForRetry');
  const releaseNotAcceptedForRetry = jest.spyOn(queue, 'releaseNotAcceptedForRetry');
  const provider = {
    readiness: jest.fn().mockResolvedValue({ enabled: true }),
    preflight: jest.fn(async () => {
      f.events.push('preflight');
      return { supported: true };
    }),
    generate: jest.fn(async () => {
      f.events.push('generate');
      return RESULT;
    }),
  };
  const economics = {
    continuationExecutionAuthorization: jest.fn().mockResolvedValue({ allowed: true }),
    continuationDispatchAuthorization: jest.fn(f.authorize),
    settleClaimedContinuation: jest.fn().mockResolvedValue({ status: 'completed' }),
    failClaimedContinuation: jest.fn().mockResolvedValue(undefined),
  };
  const contextAssembler = { assemble: jest.fn().mockResolvedValue({
    sourceScene: { title: 'The Gate', beats: [{ beatType: 'paragraph', content: NARRATIVE }] },
    selectedChoice: { label: 'Wait by the gate' }, path: [], memories: [],
  }) };
  const moderation = { preview: jest.fn().mockReturnValue({ decision: 'allow' }) };
  const executor = new StoryContinuationExecutor(queue, provider as never, economics as never,
    contextAssembler as never, moderation as never, undefined, undefined, timing);
  return { ...f, queue, claimExpiredTerminal, claimNext, markDispatched, releaseForRetry,
    releaseNotAcceptedForRetry, provider, economics, contextAssembler, moderation, executor };
}

function assertNoRetry(f: ReturnType<typeof executorFixture>) {
  expect(f.releaseForRetry).not.toHaveBeenCalled();
  expect(f.releaseNotAcceptedForRetry).not.toHaveBeenCalled();
}

function assertNoSend(f: ReturnType<typeof executorFixture>) {
  expect(f.provider.generate).not.toHaveBeenCalled();
  expect(f.economics.settleClaimedContinuation).not.toHaveBeenCalled();
  expect(f.moderation.preview).not.toHaveBeenCalled();
  assertNoRetry(f);
}

type SyntheticLeaseRow = {
  id: string; status: string; requestKind: string; token: string; attempt: number;
  remainingMs: number | null; fenced: boolean;
};
const CURRENT_LEASE_ROW: SyntheticLeaseRow = {
  id: CLAIM.continuationId, status: 'processing', requestKind: 'recommended_choice',
  token: CLAIM.leaseToken, attempt: CLAIM.attemptCount, remainingMs: 110_000, fenced: false,
};
const OWNERSHIP_CASES: Array<{ name: string; row: SyntheticLeaseRow | null }> = [
  { name: 'missing', row: null },
  { name: 'wrong id', row: { ...CURRENT_LEASE_ROW, id: 'different-id' } },
  { name: 'wrong request kind', row: { ...CURRENT_LEASE_ROW, requestKind: 'other' } },
  { name: 'not processing', row: { ...CURRENT_LEASE_ROW, status: 'retry_wait' } },
  { name: 'stale token', row: { ...CURRENT_LEASE_ROW, token: 'different-lease' } },
  { name: 'changed attempt', row: { ...CURRENT_LEASE_ROW, attempt: 2 } },
  { name: 'expired at DB clock', row: { ...CURRENT_LEASE_ROW, remainingMs: 0 } },
  { name: 'expired before DB clock', row: { ...CURRENT_LEASE_ROW, remainingMs: -1 } },
  { name: 'missing expiry', row: { ...CURRENT_LEASE_ROW, remainingMs: null } },
  { name: 'already fenced', row: { ...CURRENT_LEASE_ROW, fenced: true } },
];

function syntheticScopedRows(row: SyntheticLeaseRow | null, sql: SqlBoundary) {
  const [minimum, id, token, attempt] = sql.values;
  if (!row || row.id !== id || row.token !== token || row.attempt !== attempt ||
      row.status !== 'processing' || row.requestKind !== 'recommended_choice' ||
      row.fenced || row.remainingMs === null || row.remainingMs <= 0) return [];
  return [{ lease_has_room: row.remainingMs >= Number(minimum) }];
}

let network: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers();
  network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Independent QA prohibits network'));
});
afterEach(() => {
  try {
    expect(network).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.restoreAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

describe('independent dispatch lease room: actual repository with synthetic Prisma boundaries', () => {
  it('exports a distinct typed insufficiency with the stable public code', () => {
    const error = new StoryContinuationDispatchLeaseInsufficient();
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(StoryContinuationDispatchAuthorizationChanged);
    expect(error.code).toBe('dispatch_lease_insufficient');
  });

  it.each([
    -1, 300_001, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1,
    null, '110000', true,
  ])('rejects invalid minimum %# before authorization or any transaction', async minimum => {
    const f = repositoryFixture();
    await expect(f.repository.markDispatched(CLAIM, f.authorize, minimum as number)).rejects.toBeInstanceOf(RangeError);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
    expect(f.tx.$executeRaw).not.toHaveBeenCalled();
  });

  it.each([undefined, 0])('preserves legacy/default-zero dispatch without the room SELECT (%s)', async minimum => {
    const f = repositoryFixture();
    if (minimum === undefined) await f.repository.markDispatched(CLAIM, f.authorize);
    else await f.repository.markDispatched(CLAIM, f.authorize, minimum);
    expect(f.events).toEqual(['begin', 'authorize', 'fence', 'callback-complete', 'ack']);
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
    expect(f.tx.$executeRaw).toHaveBeenCalledTimes(1);
    assertSqlScope(f.tx.$executeRaw.mock.calls[0][0], 'update', 0);
    expect(f.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it.each([1, 110_000, 200_000, 300_000])('authorizes, locks, then fences with DB-clock minimum %i in the same transaction', async minimum => {
    const f = repositoryFixture();
    await expect(f.repository.markDispatched(CLAIM, f.authorize, minimum)).resolves.toBeUndefined();
    expect(f.events).toEqual(['begin', 'authorize', 'room', 'fence', 'callback-complete', 'ack']);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(f.authorize).toHaveBeenCalledTimes(1);
    expect(f.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(f.tx.$executeRaw).toHaveBeenCalledTimes(1);
    assertSqlScope(f.tx.$queryRaw.mock.calls[0][0], 'select', minimum);
    assertSqlScope(f.tx.$executeRaw.mock.calls[0][0], 'update', minimum);
    expect(f.prisma.$queryRaw).not.toHaveBeenCalled();
    expect(f.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('waits for asynchronous approval before querying the current lease', async () => {
    const f = repositoryFixture();
    const approval = deferred<boolean>();
    const entered = deferred<void>();
    f.authorize.mockImplementation(async client => {
      expect(client).toBe(f.tx);
      entered.resolve();
      return approval.promise;
    });
    const pending = f.repository.markDispatched(CLAIM, f.authorize, 110_000);
    await entered.promise;
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
    expect(f.tx.$executeRaw).not.toHaveBeenCalled();
    approval.resolve(true);
    await pending;
    expect(f.tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('checks room only after acknowledged authorization passes', async () => {
    const f = repositoryFixture({ rows: [{ lease_has_room: false }] });
    f.authorize.mockResolvedValue(false);
    await expect(f.repository.markDispatched(CLAIM, f.authorize, 110_000))
      .rejects.toBeInstanceOf(StoryContinuationDispatchAuthorizationChanged);
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
    expect(f.tx.$executeRaw).not.toHaveBeenCalled();
    expect(f.events).toEqual(['begin', 'callback-complete', 'ack']);
  });

  it('propagates an authorization exception without marking definite insufficiency', async () => {
    const f = repositoryFixture();
    const failure = { code: '40001' };
    f.authorize.mockRejectedValue(failure);
    await expect(f.repository.markDispatched(CLAIM, f.authorize, 110_000)).rejects.toBe(failure);
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
    expect(f.tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('throws typed insufficiency only after the no-fence transaction acknowledgement', async () => {
    const acknowledgement = deferred<void>();
    const f = repositoryFixture({ rows: [{ lease_has_room: false }], acknowledgement });
    let observed = false;
    const pending = f.repository.markDispatched(CLAIM, f.authorize, 110_000)
      .then(() => { observed = true; return undefined; }, error => { observed = true; return error; });
    const marker = await f.callbackCompleted.promise;
    expect(marker).not.toBeInstanceOf(Error);
    expect(observed).toBe(false);
    expect(f.events).not.toContain('ack');
    expect(f.tx.$executeRaw).not.toHaveBeenCalled();
    acknowledgement.resolve();
    await expect(pending).resolves.toBeInstanceOf(StoryContinuationDispatchLeaseInsufficient);
    expect(f.events.at(-1)).toBe('ack');
  });

  it.each(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', '40001', '40P01'])
  ('keeps lost acknowledgement %s conservative even after a false room marker', async code => {
    const failure = Object.assign(new Error('Synthetic commit acknowledgement loss'), { code });
    const f = repositoryFixture({ rows: [{ lease_has_room: false }], commitError: failure });
    await expect(f.repository.markDispatched(CLAIM, f.authorize, 110_000)).rejects.toBe(failure);
    expect(f.tx.$executeRaw).not.toHaveBeenCalled();
    expect(f.events.at(-1)).toBe('ack-lost');
  });

  it.each([
    { name: 'missing row', rows: [] },
    { name: 'duplicate rows', rows: [{ lease_has_room: false }, { lease_has_room: false }] },
    { name: 'null boolean', rows: [{ lease_has_room: null }] },
    { name: 'absent boolean', rows: [{}] },
    { name: 'string boolean', rows: [{ lease_has_room: 'false' }] },
    { name: 'numeric boolean', rows: [{ lease_has_room: 0 }] },
  ])('rejects $name conservatively, not as definite no-send insufficiency', async ({ rows }) => {
    const f = repositoryFixture({ rows });
    await expect(f.repository.markDispatched(CLAIM, f.authorize, 110_000)).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.$executeRaw).not.toHaveBeenCalled();
    expect(f.events).not.toContain('ack');
  });

  it('propagates room-query failure instead of constructing a no-send marker', async () => {
    const f = repositoryFixture();
    const failure = { code: 'P1008' };
    f.tx.$queryRaw.mockRejectedValue(failure);
    await expect(f.repository.markDispatched(CLAIM, f.authorize, 110_000)).rejects.toBe(failure);
    expect(f.tx.$executeRaw).not.toHaveBeenCalled();
  });

  it.each([0, 2])('keeps fence CAS %i conservative after a successful room check', async updated => {
    const f = repositoryFixture({ updated });
    await expect(f.repository.markDispatched(CLAIM, f.authorize, 110_000)).rejects.toBeInstanceOf(ConflictException);
    assertSqlScope(f.tx.$executeRaw.mock.calls[0][0], 'update', 110_000);
    expect(f.events).not.toContain('ack');
  });

  it('does not recast a fence execution error as insufficient room', async () => {
    const f = repositoryFixture();
    const failure = { code: 'P1017' };
    f.tx.$executeRaw.mockRejectedValue(failure);
    await expect(f.repository.markDispatched(CLAIM, f.authorize, 110_000)).rejects.toBe(failure);
  });

  it('preserves acknowledgement loss after an apparently successful fence', async () => {
    const failure = { code: 'P1001' };
    const f = repositoryFixture({ commitError: failure });
    await expect(f.repository.markDispatched(CLAIM, f.authorize, 110_000)).rejects.toBe(failure);
    expect(f.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(f.events.at(-1)).toBe('ack-lost');
  });

  it('rejects a duplicate dispatch through the scoped no-fence row boundary', async () => {
    const f = repositoryFixture();
    f.tx.$queryRaw.mockResolvedValueOnce([{ lease_has_room: true }]).mockResolvedValueOnce([]);
    await f.repository.markDispatched(CLAIM, f.authorize, 110_000);
    await expect(f.repository.markDispatched(CLAIM, f.authorize, 110_000)).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
});

describe('independent dispatch lease room: actual executor and repository together', () => {
  it.each([
    { name: 'legacy constructor', preset: undefined, inject: false, minimum: 110_000, lease: 125_000 },
    { name: 'absent preset', preset: undefined, inject: true, minimum: 110_000, lease: 125_000 },
    { name: 'explicit default', preset: 'default', inject: true, minimum: 110_000, lease: 125_000 },
    { name: 'extended opt-in', preset: 'extended-180s', inject: true, minimum: 200_000, lease: 215_000 },
  ])('passes the complete post-preparation minimum for $name', async ({ preset, inject, minimum, lease }) => {
    const timing = inject ? readStoryContinuationTimingPolicy({
      get: <T = string>(key: string) => (key === 'STORY_CONTINUATION_TIMING_PRESET' ? preset : undefined) as T | undefined,
    }) : undefined;
    const f = executorFixture({}, timing);
    await expect(f.executor.executeOne('independent-worker')).resolves.toEqual({
      status: 'completed', continuationId: CLAIM.continuationId,
    });
    expect(f.claimExpiredTerminal).toHaveBeenCalledWith('independent-worker', lease);
    expect(f.claimNext).toHaveBeenCalledWith('independent-worker', lease);
    expect(f.markDispatched).toHaveBeenCalledWith(CLAIM, expect.any(Function), minimum);
    assertSqlScope(f.tx.$queryRaw.mock.calls[0][0], 'select', minimum);
    assertSqlScope(f.tx.$executeRaw.mock.calls[0][0], 'update', minimum);
    expect(f.economics.continuationDispatchAuthorization).toHaveBeenCalledWith(f.tx, CLAIM);
    expect(f.events).toEqual(['preflight', 'begin', 'authorize', 'room', 'fence', 'callback-complete', 'ack', 'generate']);
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
    expect(f.economics.settleClaimedContinuation).toHaveBeenCalledTimes(1);
    expect(f.economics.failClaimedContinuation).not.toHaveBeenCalled();
    assertNoRetry(f);
  });

  it('derives the minimum from all three injected terms rather than a preset constant', async () => {
    const timing = createStoryContinuationTimingPolicy({
      providerDeadlineMs: 120_000, executorDeadlineMs: 126_000, preparationMs: 20_000,
      settlementMs: 12_000, clockMarginMs: 6_000, drainMs: 45_000,
    });
    const f = executorFixture({}, timing);
    await expect(f.executor.executeOne('independent-worker')).resolves.toMatchObject({ status: 'completed' });
    expect(f.markDispatched).toHaveBeenCalledWith(CLAIM, expect.any(Function), 144_000);
    expect(f.claimNext).toHaveBeenCalledWith('independent-worker', 164_000);
  });

  it.each([
    { minimum: 110_000, providerMs: 90_000, remaining: 1 },
    { minimum: 110_000, providerMs: 90_000, remaining: 109_999 },
    { minimum: 110_000, providerMs: 90_000, remaining: 110_000 },
    { minimum: 110_000, providerMs: 90_000, remaining: 110_001 },
    { minimum: 200_000, providerMs: 180_000, remaining: 199_999 },
    { minimum: 200_000, providerMs: 180_000, remaining: 200_000 },
    { minimum: 200_000, providerMs: 180_000, remaining: 200_001 },
  ])('handles synthetic DB-clock room $remaining against policy minimum $minimum', async ({ minimum, providerMs, remaining }) => {
    const enough = remaining >= minimum;
    const f = executorFixture({ rows: [{ lease_has_room: enough }] },
      createStoryContinuationTimingPolicy({ providerDeadlineMs: providerMs }));
    jest.spyOn(Date, 'now').mockReturnValue(9_000_000_000_000);
    await expect(f.executor.executeOne('independent-worker')).resolves.toMatchObject({ status: enough ? 'completed' : 'failed' });
    assertSqlScope(f.tx.$queryRaw.mock.calls[0][0], 'select', minimum);
    if (enough) {
      expect(f.provider.generate).toHaveBeenCalledTimes(1);
      expect(f.economics.failClaimedContinuation).not.toHaveBeenCalled();
    } else {
      expect(f.tx.$executeRaw).not.toHaveBeenCalled();
      expect(f.economics.failClaimedContinuation).toHaveBeenCalledTimes(1);
      expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(
        CLAIM, 'dispatch_lease_insufficient', 'failed', undefined, true,
      );
      assertNoSend(f);
    }
    assertNoRetry(f);
  });

  it('never generates or settles while an adequate fence commit is unacknowledged', async () => {
    const acknowledgement = deferred<void>();
    const f = executorFixture({ acknowledgement });
    const pending = f.executor.executeOne('independent-worker');
    await f.callbackCompleted.promise;
    expect(f.tx.$executeRaw).toHaveBeenCalledTimes(1);
    assertNoSend(f);
    expect(f.economics.failClaimedContinuation).not.toHaveBeenCalled();
    acknowledgement.resolve();
    await expect(pending).resolves.toMatchObject({ status: 'completed' });
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
  });

  it('waits for acknowledged no-fence insufficiency before recording definite no-send', async () => {
    const acknowledgement = deferred<void>();
    const f = executorFixture({ rows: [{ lease_has_room: false }], acknowledgement });
    const pending = f.executor.executeOne('independent-worker');
    await f.callbackCompleted.promise;
    expect(f.economics.failClaimedContinuation).not.toHaveBeenCalled();
    assertNoSend(f);
    acknowledgement.resolve();
    await expect(pending).resolves.toMatchObject({ status: 'failed' });
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(
      CLAIM, 'dispatch_lease_insufficient', 'failed', undefined, true,
    );
    await jest.advanceTimersByTimeAsync(300_000);
    expect(f.claimNext).toHaveBeenCalledTimes(1);
    assertNoSend(f);
  });

  it.each(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', '40001', '40P01'])
  ('records outcome_unknown, not free no-send, on insufficient-marker ack loss %s', async code => {
    const f = executorFixture({ rows: [{ lease_has_room: false }], commitError: { code } });
    await expect(f.executor.executeOne('independent-worker')).resolves.toMatchObject({ status: 'failed' });
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(CLAIM, 'provider_outcome_unknown', 'failed');
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledTimes(1);
    expect(f.tx.$executeRaw).not.toHaveBeenCalled();
    assertNoSend(f);
  });

  it.each(OWNERSHIP_CASES)('preserves unknown outcome when scoped current ownership is lost: $name', async ({ row }) => {
    const f = executorFixture();
    f.tx.$queryRaw.mockImplementation(async sql => syntheticScopedRows(row, sql));
    await expect(f.executor.executeOne('independent-worker')).resolves.toMatchObject({ status: 'failed' });
    assertSqlScope(f.tx.$queryRaw.mock.calls[0][0], 'select', 110_000);
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(CLAIM, 'provider_outcome_unknown', 'failed');
    expect(f.tx.$executeRaw).not.toHaveBeenCalled();
    assertNoSend(f);
  });

  it('preserves uncertainty when the positive SELECT is followed by fence CAS zero', async () => {
    const f = executorFixture({ updated: 0 });
    await expect(f.executor.executeOne('independent-worker')).resolves.toMatchObject({ status: 'failed' });
    assertSqlScope(f.tx.$executeRaw.mock.calls[0][0], 'update', 110_000);
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(CLAIM, 'provider_outcome_unknown', 'failed');
    assertNoSend(f);
  });

  it('preserves uncertainty on acknowledgement loss after an apparent fence success', async () => {
    const f = executorFixture({ commitError: { code: 'P1001' } });
    await expect(f.executor.executeOne('independent-worker')).resolves.toMatchObject({ status: 'failed' });
    expect(f.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(CLAIM, 'provider_outcome_unknown', 'failed');
    assertNoSend(f);
  });

  it.each([
    { name: 'plain code object', error: { code: 'dispatch_lease_insufficient' } },
    { name: 'same-code Error', error: Object.assign(new Error('Synthetic private details'), { code: 'dispatch_lease_insufficient' }) },
    { name: 'retryable provider error', error: new StoryContinuationProviderError('dispatch_lease_insufficient', true) },
    { name: 'permanent provider error', error: new StoryContinuationProviderError('dispatch_lease_insufficient', false) },
    { name: 'same-name Error', error: Object.assign(new Error('dispatch_lease_insufficient'), { name: 'StoryContinuationDispatchLeaseInsufficient' }) },
  ])('does not grant typed no-send evidence to $name from dispatch', async ({ error }) => {
    const f = executorFixture();
    f.markDispatched.mockRejectedValue(error);
    await expect(f.executor.executeOne('independent-worker')).resolves.toMatchObject({ status: 'failed' });
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(CLAIM, 'provider_outcome_unknown', 'failed');
    assertNoSend(f);
  });

  it('does not send a second generation for a duplicate claim with an existing fence', async () => {
    const f = executorFixture();
    f.tx.$queryRaw.mockResolvedValueOnce([{ lease_has_room: true }]).mockResolvedValueOnce([]);
    await expect(f.executor.executeOne('first-worker')).resolves.toMatchObject({ status: 'completed' });
    await expect(f.executor.executeOne('duplicate-worker')).resolves.toMatchObject({ status: 'failed' });
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
    expect(f.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(f.economics.settleClaimedContinuation).toHaveBeenCalledTimes(1);
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(CLAIM, 'provider_outcome_unknown', 'failed');
    assertNoRetry(f);
  });

  it.each([
    { name: 'failure commit acknowledgement loss', error: { code: 'P1001' } },
    { name: 'failure settlement stale-lease CAS', error: new ConflictException('Synthetic stale settlement') },
  ])('does not claim successful no-send settlement on $name', async ({ error }) => {
    const f = executorFixture({ rows: [{ lease_has_room: false }] });
    f.economics.failClaimedContinuation.mockRejectedValue(error);
    await expect(f.executor.executeOne('independent-worker')).rejects.toBe(error);
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledTimes(1);
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(
      CLAIM, 'dispatch_lease_insufficient', 'failed', undefined, true,
    );
    await jest.advanceTimersByTimeAsync(300_000);
    expect(f.claimNext).toHaveBeenCalledTimes(1);
    assertNoSend(f);
  });

  it('awaits the definite-no-send failure settlement acknowledgement', async () => {
    const f = executorFixture({ rows: [{ lease_has_room: false }] });
    const settlement = deferred<undefined>();
    const entered = deferred<void>();
    f.economics.failClaimedContinuation.mockImplementation(() => {
      entered.resolve();
      return settlement.promise;
    });
    let returned = false;
    const pending = f.executor.executeOne('independent-worker').then(value => { returned = true; return value; });
    await entered.promise;
    expect(returned).toBe(false);
    assertNoSend(f);
    settlement.resolve(undefined);
    await expect(pending).resolves.toMatchObject({ status: 'failed' });
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledTimes(1);
  });

  it.each(['P1001', '40001', '40P01'])('retains measured usage and never grants free no-send after paid settlement error %s', async code => {
    const f = executorFixture();
    f.economics.settleClaimedContinuation.mockRejectedValue({ code });
    await expect(f.executor.executeOne('independent-worker')).resolves.toMatchObject({ status: 'failed' });
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
    expect(f.economics.settleClaimedContinuation).toHaveBeenCalledTimes(1);
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledTimes(1);
    const args = f.economics.failClaimedContinuation.mock.calls[0];
    expect(args).toHaveLength(4);
    expect(args[0]).toBe(CLAIM);
    expect(args[1]).not.toBe('dispatch_lease_insufficient');
    expect(args[2]).toBe('failed');
    expect(args[3]).toEqual(RESULT.usage);
    assertNoRetry(f);
  });
});

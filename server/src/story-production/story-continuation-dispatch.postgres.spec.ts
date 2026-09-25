import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaStoryContinuationQueueRepository, type StoryContinuationClaim } from './story-continuation.repository';
import { StoryContinuationExecutor } from './story-continuation.executor';
import { StoryContinuationProviderError } from './story-continuation.provider';

const databaseUrl = process.env.STORY_PROVIDER_TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres('durable provider dispatch fence: real PostgreSQL workers', () => {
  let dbA: PrismaClient;
  let dbB: PrismaClient;
  let a: PrismaStoryContinuationQueueRepository;
  let b: PrismaStoryContinuationQueueRepository;
  const ids: string[] = [];

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/dblumina_provider_qa') {
      throw new Error('Dedicated local provider QA database required');
    }
    dbA = new PrismaClient({ datasourceUrl: databaseUrl });
    dbB = new PrismaClient({ datasourceUrl: databaseUrl });
    await dbA.$connect(); await dbB.$connect();
    a = new PrismaStoryContinuationQueueRepository(dbA as never);
    b = new PrismaStoryContinuationQueueRepository(dbB as never);
  });

  afterEach(async () => {
    if (!ids.length) return;
    await dbA.$transaction(async (tx) => {
      // Fixtures omit unrelated ownership graphs; only seed/cleanup disables FK triggers.
      // All claims, dispatch CAS, retries and recovery run with normal DB triggers/constraints.
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.storyAiContinuation.deleteMany({ where: { id: { in: ids } } });
    });
    ids.length = 0;
  });
  afterAll(async () => { await dbA?.$disconnect(); await dbB?.$disconnect(); });

  async function seed() {
    const id = randomUUID(); ids.push(id);
    await dbA.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.storyAiContinuation.create({ data: {
        id, userId: randomUUID(), workId: randomUUID(), releaseId: randomUUID(), progressId: randomUUID(),
        requestKind: 'recommended_choice', recommendedChoiceId: randomUUID(), rateCardId: randomUUID(),
        styleConsentId: randomUUID(), capabilityRevision: 1, idempotencyKey: `dispatch-test:${id}`,
        sourcePartId: randomUUID(), sourceSceneId: randomUUID(), sourceProgressRevision: 1,
        manuscriptVersionId: randomUUID(), analysisJobId: randomUUID(), analysisVersion: 1,
        rightsContractId: randomUUID(), rightsContractVersionId: randomUUID(), releaseChecksum: 'qa',
        locale: 'ko', contextFingerprint: 'qa', promptVersion: 'story-continuation-v4',
        outputSchemaVersion: 'story-continuation-output-v1', estimatedCostKrw: 1, hardBudgetKrw: 100,
        inputTokenLimit: 8192, outputTokenLimit: 500,
      } });
    });
    return id;
  }

  async function expire(id: string) {
    await dbA.$executeRaw(Prisma.sql`UPDATE story_ai_continuations
      SET lease_expires_at = clock_timestamp() - INTERVAL '1 second' WHERE id = ${id}::uuid`);
  }

  function executor(queue: PrismaStoryContinuationQueueRepository, fail: (claim: StoryContinuationClaim) => Promise<void>) {
    const generate = jest.fn().mockRejectedValue(new StoryContinuationProviderError('provider_outcome_unknown', false));
    const provider = { readiness: async () => ({ enabled: true }), generate };
    const economics = { continuationExecutionAuthorization: async () => ({ allowed: true }),
      failClaimedContinuation: jest.fn(fail), settleClaimedContinuation: jest.fn() };
    return { generate, economics, runner: new StoryContinuationExecutor(queue, provider as never, economics as never,
      { assemble: async () => ({}) } as never, {} as never) };
  }

  it('atomically allows only one cross-worker claim and one dispatch CAS', async () => {
    await seed();
    const claims = await Promise.all([a.claimNext('a', 60_000), b.claimNext('b', 60_000)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const claim = claims.find(Boolean)!;
    const marked = await Promise.allSettled([a.markDispatched(claim), b.markDispatched(claim)]);
    expect(marked.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    expect((await dbB.storyAiContinuation.findUniqueOrThrow({ where: { id: claim.continuationId } })).dispatchStartedAt).not.toBeNull();
  });

  it('never reclaims a dispatched expired lease for generation, even below max attempts', async () => {
    const id = await seed();
    const claim = (await a.claimNext('a', 60_000))!;
    await a.markDispatched(claim); await expire(id);
    expect(await b.claimNext('b', 60_000)).toBeNull();
    const recovered = (await b.claimExpiredTerminal('b', 60_000))!;
    expect(recovered.dispatchStartedAt).toBeInstanceOf(Date);
    expect(recovered.attemptCount).toBe(1);
    await expect(a.markDispatched(claim)).rejects.toThrow();
    await expect(a.releaseNotAcceptedForRetry(claim, new Date())).rejects.toThrow();
    await expect(b.markDispatched(recovered)).rejects.toThrow();
    expect(await a.claimExpiredTerminal('a', 60_000)).toBeNull();
  });

  it('reclaims a pre-dispatch process death with a new lease and rejects the stale owner', async () => {
    const id = await seed();
    const claim = (await a.claimNext('a', 60_000))!;
    await expire(id);
    expect(await b.claimExpiredTerminal('b', 60_000)).toBeNull();
    const replacement = (await b.claimNext('b', 60_000))!;
    expect(replacement.attemptCount).toBe(2);
    expect(replacement.leaseToken).not.toBe(claim.leaseToken);
    await expect(a.markDispatched(claim)).rejects.toThrow();
    await b.markDispatched(replacement);
  });

  it('generic retry cannot clear a fence; explicit 429 releases and clears atomically', async () => {
    await seed();
    const claim = (await a.claimNext('a', 60_000))!;
    await a.markDispatched(claim);
    await expect(a.releaseForRetry(claim, 'provider_cancelled', new Date())).rejects.toThrow();
    await a.releaseNotAcceptedForRetry(claim, new Date());
    const row = await dbB.storyAiContinuation.findUniqueOrThrow({ where: { id: claim.continuationId } });
    expect(row).toMatchObject({ status: 'retry_wait', dispatchStartedAt: null, leaseToken: null, lastErrorCode: 'provider_rate_limited' });
    const next = (await b.claimNext('b', 60_000))!;
    await expect(a.releaseNotAcceptedForRetry(claim, new Date())).rejects.toThrow();
    await b.markDispatched(next);
  });

  it('expired current lease cannot mark dispatch or clear a fence, even before another worker claims', async () => {
    const id = await seed();
    const claim = (await a.claimNext('a', 60_000))!;
    await expire(id);
    await expect(a.markDispatched(claim)).rejects.toThrow();
    await expect(a.releaseForRetry(claim, 'provider_cancelled', new Date())).rejects.toThrow();
    const next = (await b.claimNext('b', 60_000))!;
    await b.markDispatched(next); await expire(id);
    await expect(b.releaseNotAcceptedForRetry(next, new Date())).rejects.toThrow();
  });

  it('failed failure-persistence after dispatch recovers outcome_unknown without another provider call', async () => {
    const id = await seed();
    const first = executor(a, async () => { throw new Error('simulated database write failure'); });
    await expect(first.runner.executeOne('a')).rejects.toThrow('simulated database write failure');
    expect(first.generate).toHaveBeenCalledTimes(1);
    expect((await dbB.storyAiContinuation.findUniqueOrThrow({ where: { id } })).dispatchStartedAt).not.toBeNull();
    await expire(id);
    const second = executor(b, async (claim) => {
      const count = await dbB.storyAiContinuation.updateMany({
        where: { id, leaseToken: claim.leaseToken, status: 'processing' },
        data: { status: 'failed', failureCode: 'provider_outcome_unknown', leaseToken: null, leaseOwner: null, leaseExpiresAt: null },
      });
      expect(count.count).toBe(1);
    });
    await expect(second.runner.executeOne('b')).resolves.toMatchObject({ status: 'recovered_outcome_unknown' });
    expect(second.economics.failClaimedContinuation).toHaveBeenCalledWith(expect.anything(), 'provider_outcome_unknown', 'failed');
    expect(second.generate).not.toHaveBeenCalled();
    await expect(first.runner.executeOne('a')).resolves.toMatchObject({ status: 'idle' });
    expect(first.generate).toHaveBeenCalledTimes(1);
    expect((await dbA.storyAiContinuation.findUniqueOrThrow({ where: { id } })).actualCostKrw).toBeNull();
  });
});

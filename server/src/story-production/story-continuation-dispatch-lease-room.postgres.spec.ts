import { ConflictException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { activationFixture } from './story-ai-activation.postgres-fixture';
import { createStoryRouteRoot } from './story-route-identity.store';
import { StoryProductionService } from './story-production.service';
import { StoryEconomicsService } from './story-economics.service';
import { StoryAuthorBodyTrialCostService } from './story-author-body-trial-cost.service';
import { StoryAuthorBodyTrialService } from './story-author-body-trial.service';
import { PersistedStoryContinuationLegalActivationGate } from './story-continuation-legal-activation.gate';
import { PrismaStoryContinuationQueueRepository, StoryContinuationDispatchAuthorizationChanged,
  StoryContinuationDispatchLeaseInsufficient } from './story-continuation.repository';
import { StoryContinuationExecutor } from './story-continuation.executor';
import { createStoryContinuationTimingPolicy } from './story-continuation-timing.policy';

const databaseUrl = process.env.STORY_TEST_DATABASE_URL;
const postgres = databaseUrl ? describe : describe.skip;

postgres('remaining dispatch lease (dedicated PostgreSQL, synthetic author trial, no AI)', () => {
  let db: PrismaClient;
  let network: jest.SpyInstance;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55432' ||
        url.username !== 'lumina_qa' || url.password || url.search || url.hash ||
        !/^\/lumina_lease_room_20261007_[a-f0-9]{12}$/.test(url.pathname)) {
      throw new Error('New dedicated loopback lease QA database required');
    }
    network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No real provider'));
    db = new PrismaClient({ datasourceUrl: databaseUrl });
    await db.$connect();
  });
  afterAll(async () => {
    expect(network).not.toHaveBeenCalled();
    network?.mockRestore();
    await db?.$disconnect();
  });

  async function prepared(remainingMs = 125_000) {
    const f = await activationFixture(db);
    const progress = await db.storyReaderProgress.create({ data: { userId: f.owner.id, workId: f.work.id,
      currentSceneId: f.scene.id, checkpointSceneId: f.scene.id, activeReleaseId: f.release.id,
      aiRateCardId: f.rate.id, capabilityRevision: 1 } });
    const routeNodeId = await createStoryRouteRoot(db, progress, f.scene.id, f.part.actNumber);
    await db.storyReaderProgress.update({ where: { id: progress.id }, data: { routeNodeId } });
    const analysis = await db.storyAnalysisJob.findFirstOrThrow({ where: { workId: f.work.id } });
    const approval = await db.storyAuthorBodyTrialApproval.create({ data: { userId: f.owner.id, workId: f.work.id,
      releaseId: f.release.id, manuscriptVersionId: f.manuscript.id, releaseChecksum: f.release.checksum,
      capabilityRevision: 1, styleConsentId: f.consent.id, styleConsentRevision: f.consent.revision,
      analysisJobId: analysis.id, analysisVersion: analysis.analysisVersion, approvedBudgetKrw: '10000',
      approvalReference: `synthetic-lease-room:${randomUUID()}`, expiresAt: new Date(Date.now() + 3600000) } });
    const costs = new StoryAuthorBodyTrialCostService(db as never);
    const trial = new StoryAuthorBodyTrialService(costs);
    const legal = new PersistedStoryContinuationLegalActivationGate(f.activation);
    const provider = { ...f.provider, preflight: jest.fn().mockResolvedValue({ supported: true, inputTokenUpperBound: 100 }) };
    const economics = new StoryEconomicsService(db as never, legal, provider as never, f.approval, undefined, trial);
    const stories = new StoryProductionService(db as never, economics, provider as never, legal,
      undefined, undefined, undefined, undefined, undefined, trial);
    jest.spyOn(stories, 'currentProgress').mockRejectedValue(new Error('No public image projection'));
    const receipt = await stories.selectAuthorBodyTrialChoice(f.owner.id, f.work.id, f.choice.id,
      { approvalId: approval.id, progressId: progress.id, expectedRevision: 1, locale: 'ko' },
      `synthetic-lease:${randomUUID()}`) as { continuationId: string };
    const leaseToken = randomUUID();
    const stored = await db.storyAiContinuation.update({ where: { id: receipt.continuationId }, data: {
      status: 'processing', leaseToken, leaseOwner: 'offline-lease-room', attemptCount: 1,
      leaseExpiresAt: new Date(Date.now() + remainingMs),
    } });
    await db.$executeRaw(Prisma.sql`UPDATE story_ai_continuations SET lease_expires_at = clock_timestamp() +
      (${remainingMs}::double precision * INTERVAL '1 millisecond') WHERE id = ${stored.id}::uuid`);
    const claim = { continuationId: stored.id, leaseToken, attemptCount: 1, maxAttempts: 1,
      request: { operationId: stored.id, locale: stored.locale, contextFingerprint: stored.contextFingerprint,
        promptVersion: stored.promptVersion, outputSchemaVersion: stored.outputSchemaVersion,
        inputTokenLimit: stored.inputTokenLimit, outputTokenLimit: stored.outputTokenLimit } };
    const repository = new PrismaStoryContinuationQueueRepository(db as never);
    const authorize = (tx: Prisma.TransactionClient) => economics.continuationDispatchAuthorization(tx, claim);
    return { ...f, approval, costs, economics, provider, progress, claim, repository, authorize };
  }
  type Fixture = Awaited<ReturnType<typeof prepared>>;
  const stored = (f: Fixture) => db.storyAiContinuation.findUniqueOrThrow({ where: { id: f.claim.continuationId } });
  function executor(f: Fixture, repository = f.repository, extended = false) {
    return new StoryContinuationExecutor({ claimExpiredTerminal: async () => null, claimNext: async () => f.claim,
      markDispatched: repository.markDispatched.bind(repository), releaseForRetry: jest.fn(),
      releaseNotAcceptedForRetry: jest.fn() } as never, f.provider as never, f.economics, {
      assemble: async () => ({ sourceScene: { beats: [{ beatType: 'paragraph', content: 'Synthetic prose.' }] } }),
    } as never, {} as never, undefined, undefined,
    createStoryContinuationTimingPolicy(extended ? { providerDeadlineMs: 180_000 } : {}));
  }

  it.each([[125_000, 110_000], [215_000, 200_000]])('fences when %i ms has enough room for %i ms', async (remaining, minimum) => {
    const f = await prepared(remaining);
    await f.repository.markDispatched(f.claim, f.authorize, minimum);
    expect((await stored(f)).dispatchStartedAt).toBeInstanceOf(Date);
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it.each([false, true])('actual executor rejects insufficient lease with confirmed zero cost, extended=%s', async extended => {
    const f = await prepared(extended ? 190_000 : 100_000);
    expect(await executor(f, f.repository, extended).executeOne('offline-lease')).toMatchObject({ status: 'failed' });
    expect(await stored(f)).toMatchObject({ status: 'failed', failureCode: 'dispatch_lease_insufficient',
      dispatchStartedAt: null, actualCostKrw: new Prisma.Decimal(0),
      contextReferences: expect.objectContaining({ noProviderDispatchEvidence: {
        kind: 'lease_insufficient_before_dispatch_v1', continuationId: f.claim.continuationId,
        attemptCount: 1, failureCode: 'dispatch_lease_insufficient' } }) });
    expect(await f.costs.current(f.owner.id, f.work.id)).toMatchObject({ knownActualCostKrw: '0.000000',
      reservedMaximumCostKrw: '0.000000', unknownCostCount: 0 });
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('uses advancing DB clock after slow authorization, not transaction start time', async () => {
    const f = await prepared(111_000);
    await expect(f.repository.markDispatched(f.claim, async tx => {
      const allowed = await f.authorize(tx);
      await tx.$queryRaw`SELECT 1 AS slept FROM pg_sleep(1.4)`;
      return allowed;
    }, 110_000)).rejects.toBeInstanceOf(StoryContinuationDispatchLeaseInsufficient);
    expect((await stored(f)).dispatchStartedAt).toBeNull();
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it.each(['token', 'attempt', 'expired', 'fenced'] as const)('never certifies stale %s as a no-send room rejection', async kind => {
    const f = await prepared(100_000);
    if (kind === 'token') await db.storyAiContinuation.update({ where: { id: f.claim.continuationId }, data: { leaseToken: randomUUID() } });
    if (kind === 'attempt') f.claim.attemptCount = 2;
    if (kind === 'expired') await db.$executeRaw(Prisma.sql`UPDATE story_ai_continuations SET lease_expires_at =
      clock_timestamp() - INTERVAL '1 second' WHERE id = ${f.claim.continuationId}::uuid`);
    if (kind === 'fenced') await db.storyAiContinuation.update({ where: { id: f.claim.continuationId }, data: { dispatchStartedAt: new Date() } });
    const before = await stored(f);
    await expect(f.repository.markDispatched(f.claim, f.authorize, 110_000)).rejects.toBeInstanceOf(ConflictException);
    expect(await stored(f)).toEqual(before);
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('preserves revoked authorization before checking lease room', async () => {
    const f = await prepared(100_000);
    await db.storyAuthorBodyTrialApproval.update({ where: { id: f.approval.id }, data: { status: 'revoked' } });
    await expect(f.repository.markDispatched(f.claim, f.authorize, 110_000))
      .rejects.toBeInstanceOf(StoryContinuationDispatchAuthorizationChanged);
    expect((await stored(f)).dispatchStartedAt).toBeNull();
  });

  it('only one concurrent dispatch commits; duplicate keeps the original fence', async () => {
    const f = await prepared();
    const other = new PrismaStoryContinuationQueueRepository(db as never);
    const outcomes = await Promise.allSettled([f.repository.markDispatched(f.claim, f.authorize, 110_000),
      other.markDispatched(f.claim, f.authorize, 110_000)]);
    expect(outcomes.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    const before = await stored(f);
    await expect(other.markDispatched(f.claim, f.authorize, 110_000)).rejects.toBeInstanceOf(ConflictException);
    expect(await stored(f)).toEqual(before);
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('lost transaction acknowledgement is still unknown even when the no-fence transaction ran', async () => {
    const f = await prepared(100_000);
    const ambiguous = new PrismaStoryContinuationQueueRepository({
      $transaction: async (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
        await db.$transaction(operation);
        throw Object.assign(new Error('Synthetic acknowledgement loss'), { code: 'P1001' });
      },
    } as never);
    expect(await executor(f, ambiguous).executeOne('offline-ack')).toMatchObject({ status: 'failed' });
    expect(await stored(f)).toMatchObject({ failureCode: 'provider_outcome_unknown', dispatchStartedAt: null, actualCostKrw: null });
    expect(await f.costs.current(f.owner.id, f.work.id)).toMatchObject({ unknownCostCount: 1 });
    expect(f.provider.generate).not.toHaveBeenCalled();
  });
});

import { PrismaClient } from '@prisma/client';
import { activationFixture } from './story-ai-activation.postgres-fixture';
import { StoryContinuationProviderError } from './story-continuation.provider';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
jest.setTimeout(30000);

postgres('rejected body usage persistence on isolated PostgreSQL (synthetic, no AI)', () => {
  let db: PrismaClient;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
        parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash ||
        !/^\/lumina_failed_cost_qa_[a-f0-9]{12}$/.test(parsed.pathname)) throw new Error('Dedicated loopback QA database required');
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
  });
  afterAll(async () => { await db?.$disconnect(); });

  it.each(['provider_incomplete_output', 'provider_output_token_limit', 'provider_refusal'])
  ('records measured synthetic cost for %s once without scene, image, or route advancement', async code => {
    const f = await activationFixture(db);
    await db.storyAiRateCard.update({ where: { id: f.rate.id }, data: {
      inputCostPerMillion: 1125, cachedInputCostPerMillion: 112.5, outputCostPerMillion: 6750,
    } });
    const receipt = await f.request();
    const row = await db.storyAiContinuation.update({ where: { id: receipt.continuationId }, data: {
      status: 'processing', leaseToken: 'isolated-cost-lease', leaseOwner: 'isolated-qa',
      leaseExpiresAt: new Date(Date.now() + 60000), attemptCount: 1, dispatchStartedAt: new Date(),
    } });
    const claim = { continuationId: row.id, leaseToken: row.leaseToken!, attemptCount: 1, maxAttempts: row.maxAttempts,
      request: { operationId: row.id, locale: row.locale, contextFingerprint: row.contextFingerprint,
        promptVersion: row.promptVersion, outputSchemaVersion: row.outputSchemaVersion,
        inputTokenLimit: row.inputTokenLimit, outputTokenLimit: row.outputTokenLimit } };
    const error = new StoryContinuationProviderError(code, false,
      { inputTokens: 120, outputTokens: 100, cachedInputTokens: 30, imageUnits: 0 });
    const before = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: row.progressId } });
    await f.economics.failClaimedContinuation(claim, error.code, 'failed', error.usage);
    const recovered = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: row.progressId } });
    await f.economics.failClaimedContinuation(claim, error.code, 'failed', error.usage);
    const saved = await db.storyAiContinuation.findUniqueOrThrow({ where: { id: row.id } });
    const costs = await db.storyAiUsageLedger.findMany({ where: { continuationId: row.id, eventKind: 'new_route_failed' } });
    expect(saved.status).toBe('failed');
    expect(saved.actualCostKrw?.toFixed(6)).toBe('0.779625');
    expect(costs).toHaveLength(1);
    expect(costs[0]).toMatchObject({ inputTokens: 120, outputTokens: 100, cachedInputTokens: 30,
      imageUnits: 0, progressApplied: false, allowanceDelta: 0 });
    expect(costs[0].actualCostKrw?.toFixed(6)).toBe('0.779625');
    expect(before.status).toBe('ai_pending');
    expect(recovered).toEqual({ ...before, status: 'active', progressRevision: before.progressRevision + 1,
      updatedAt: expect.any(Date) });
    expect(await db.storyReaderProgress.findUniqueOrThrow({ where: { id: row.progressId } })).toEqual(recovered);
    expect(await db.storyAiGeneratedScene.count({ where: { continuationId: row.id } })).toBe(0);
    expect(await db.storyVisualGeneration.count({ where: { workId: f.work.id } })).toBe(0);
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('retains unknown cost when the provider did not return verifiable usage', async () => {
    const f = await activationFixture(db);
    const receipt = await f.request();
    const row = await db.storyAiContinuation.update({ where: { id: receipt.continuationId }, data: {
      status: 'processing', leaseToken: 'isolated-unknown-lease', leaseOwner: 'isolated-qa',
      leaseExpiresAt: new Date(Date.now() + 60000), attemptCount: 1, dispatchStartedAt: new Date(),
    } });
    const claim = { continuationId: row.id, leaseToken: row.leaseToken!, attemptCount: 1, maxAttempts: row.maxAttempts,
      request: { operationId: row.id, locale: row.locale, contextFingerprint: row.contextFingerprint,
        promptVersion: row.promptVersion, outputSchemaVersion: row.outputSchemaVersion,
        inputTokenLimit: row.inputTokenLimit, outputTokenLimit: row.outputTokenLimit } };
    await f.economics.failClaimedContinuation(claim, 'provider_outcome_unknown', 'failed');
    expect((await db.storyAiContinuation.findUniqueOrThrow({ where: { id: row.id } })).actualCostKrw).toBeNull();
    expect((await db.storyAiUsageLedger.findFirstOrThrow({ where: { continuationId: row.id,
      eventKind: 'new_route_failed' } })).actualCostKrw).toBeNull();
    expect(f.provider.generate).not.toHaveBeenCalled();
  });
});

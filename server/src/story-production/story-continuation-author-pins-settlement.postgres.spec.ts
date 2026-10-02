import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { activationFixture, postgresClient } from './story-ai-activation.postgres-fixture';
import { StoryContinuationContextAssembler } from './story-continuation-context.assembler';
import { StoryContinuationExecutor } from './story-continuation.executor';
import { PrismaStoryContinuationQueueRepository, StoryContinuationDispatchAuthorizationChanged } from './story-continuation.repository';
import { StoryContinuationProviderError } from './story-continuation.provider';
import { StoryGenerationProfileService } from './story-generation-profile.service';
import { StoryEconomicsService } from './story-economics.service';
import { PersistedStoryContinuationLegalActivationGate } from './story-continuation-legal-activation.gate';
import { creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile,
  STORY_PROFILE_SECTION_KEYS, stableJson } from '../generation-profile/creator-generation-profile.policy';

const postgres = process.env.STORY_TEST_DATABASE_URL ? describe : describe.skip;

postgres('author pins at dispatch and settlement (dedicated PostgreSQL, no paid AI)', () => {
  let db: PrismaClient;
  const originalRegion = process.env.STORY_AI_REGION;

  beforeAll(async () => {
    const url = new URL(process.env.STORY_TEST_DATABASE_URL!);
    if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55432' ||
        url.username !== 'lumina_qa' || url.pathname !== '/lumina_author_pins_settlement_qa' || url.search || url.hash) {
      throw new Error('Dedicated author-pins settlement QA database required');
    }
    process.env.STORY_AI_REGION = 'KR';
    db = postgresClient();
    await db.$connect();
  });

  beforeEach(() => { jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network prohibited')); });
  afterEach(() => {
    try { expect(globalThis.fetch).not.toHaveBeenCalled(); } finally { jest.restoreAllMocks(); }
  });
  afterAll(async () => {
    if (originalRegion === undefined) delete process.env.STORY_AI_REGION;
    else process.env.STORY_AI_REGION = originalRegion;
    await db?.$disconnect();
  });

  async function prepared() {
    const f = await activationFixture(db);
    await db.storyReleaseCapability.update({ where: { releaseId: f.release.id }, data: { aiInputTokenLimit: 8192 } });
    const analysis = await db.storyAnalysisJob.findFirstOrThrow({ where: { workId: f.work.id } });
    await db.storyAnalysisJob.update({ where: { id: analysis.id }, data: {
      pipeline: 'semantic_extraction_v1', sourceContentHash: f.manuscript.contentHash,
      actorUserId: f.owner.id, rateCardId: f.rate.id, sourceLocale: 'ko',
      sourceDigest: f.manuscript.contentHash, configHash: 'd'.repeat(64),
      totalParts: 1, totalParagraphs: 1, plannedParagraphs: 1, completedParagraphs: 1,
    } });
    const settings = normalizeCreatorGenerationProfile('story', {
      schemaVersion: 'creator-generation-profile-v1', kind: 'story',
      sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
        key, decision: 'accepted', value: { summary: `${key} approved author constraint` }, evidence: [],
      })),
    });
    const sourceFingerprint = 'c'.repeat(64);
    const profile = await db.storyWorkGenerationProfile.create({ data: {
      workId: f.work.id, ownerUserId: f.owner.id, manuscriptVersionId: f.manuscript.id,
      analysisJobId: analysis.id, sourceFingerprint, reviewRevision: 1, status: 'approved',
      draftSettings: settings as never, approvedSettings: settings as never,
      approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings),
      approvedByUserId: f.owner.id, approvedAt: new Date(),
    } });
    const memory = await db.storyMemoryRecord.create({ data: {
      workId: f.work.id, manuscriptVersionId: f.manuscript.id, analysisJobId: analysis.id,
      memoryType: 'style', memoryKey: 'author-style', content: { ko: 'Approved author voice.' },
    } });
    const receipt = await f.request();
    expect(receipt.status).toBe('queued');
    const leaseToken = randomUUID();
    const continuation = await db.storyAiContinuation.update({ where: { id: receipt.continuationId }, data: {
      status: 'processing', leaseToken, leaseOwner: 'author-pins-settlement-test',
      leaseExpiresAt: new Date(Date.now() + 60_000), attemptCount: 1,
    } });
    const claim = { continuationId: continuation.id, leaseToken, attemptCount: 1, maxAttempts: 3, request: {
      operationId: continuation.id, locale: continuation.locale!,
      contextFingerprint: continuation.contextFingerprint!, promptVersion: continuation.promptVersion!,
      outputSchemaVersion: continuation.outputSchemaVersion!, inputTokenLimit: continuation.inputTokenLimit!,
      outputTokenLimit: continuation.outputTokenLimit!,
    } };
    const assembled = await new StoryContinuationContextAssembler(db as never).assemble(claim);
    expect(assembled.generationProfile?.sections.find(section => section.key === 'writing_style')?.value.summary)
      .toBe('writing_style approved author constraint');
    expect(assembled.memories).toEqual(expect.arrayContaining([expect.objectContaining({ content: 'Approved author voice.' })]));
    const provider = { ...f.provider, preflight: jest.fn().mockResolvedValue({ supported: true }) };
    return { ...f, provider, profile, memory, settings, continuation, claim };
  }

  function runner(f: Awaited<ReturnType<typeof prepared>>) {
    const repository = new PrismaStoryContinuationQueueRepository(db as never);
    const queue = {
      claimExpiredTerminal: jest.fn().mockResolvedValue(null), claimNext: jest.fn().mockResolvedValue(f.claim),
      markDispatched: repository.markDispatched.bind(repository),
      releaseForRetry: jest.fn(), releaseNotAcceptedForRetry: jest.fn(),
    };
    return new StoryContinuationExecutor(queue, f.provider as never, f.economics,
      new StoryContinuationContextAssembler(db as never), { preview: () => ({ decision: 'allow' }) } as never);
  }

  async function editAuthor(f: Awaited<ReturnType<typeof prepared>>) {
    const changed = normalizeCreatorGenerationProfile('story', f.settings);
    changed.sections[0].decision = 'edited';
    changed.sections[0].value.summary = 'Later creator edit';
    return new StoryGenerationProfileService(db as never).update(f.owner.id, f.work.id, { settings: changed as never });
  }

  async function legacyDuringFirstReview() {
    const f = await activationFixture(db);
    await db.storyReleaseCapability.update({ where: { releaseId: f.release.id }, data: { aiInputTokenLimit: 8192 } });
    const legacy = await db.storyAnalysisJob.findFirstOrThrow({ where: { workId: f.work.id } });
    const analysis = await db.storyAnalysisJob.create({ data: {
      workId: f.work.id, manuscriptVersionId: f.manuscript.id, analysisVersion: 2,
      idempotencyKey: randomUUID(), status: 'completed', pipeline: 'semantic_extraction_v1',
      sourceContentHash: f.manuscript.contentHash, actorUserId: f.owner.id, rateCardId: f.rate.id,
      sourceLocale: 'ko', sourceDigest: f.manuscript.contentHash, configHash: 'd'.repeat(64),
      totalParts: 1, totalParagraphs: 1, plannedParagraphs: 1, completedParagraphs: 1,
    } });
    const settings = normalizeCreatorGenerationProfile('story', {
      schemaVersion: 'creator-generation-profile-v1', kind: 'story',
      sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
        key, decision: 'accepted', value: { summary: `${key} first semantic review` }, evidence: [],
      })),
    });
    const sourceFingerprint = createHash('sha256').update(stableJson({
      workId: f.work.id, manuscriptVersionId: f.manuscript.id, contentHash: f.manuscript.contentHash,
      analysisJobId: analysis.id, analysisVersion: 2, analysisConfigHash: analysis.configHash,
    })).digest('hex');
    const profile = await db.storyWorkGenerationProfile.create({ data: {
      workId: f.work.id, ownerUserId: f.owner.id, manuscriptVersionId: f.manuscript.id,
      analysisJobId: analysis.id, sourceFingerprint, status: 'needs_review',
      draftSettings: settings as never, draftFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings),
    } });
    const memory = await db.storyMemoryRecord.create({ data: {
      workId: f.work.id, manuscriptVersionId: f.manuscript.id, analysisJobId: legacy.id,
      memoryType: 'style', memoryKey: 'legacy-author-style', content: { ko: 'Legacy approved style.' },
    } });
    const receipt = await f.request();
    const leaseToken = randomUUID();
    const continuation = await db.storyAiContinuation.update({ where: { id: receipt.continuationId }, data: {
      status: 'processing', leaseToken, leaseOwner: 'legacy-author-dispatch-test',
      leaseExpiresAt: new Date(Date.now() + 60_000), attemptCount: 1,
    } });
    expect(continuation.analysisJobId).toBe(legacy.id);
    expect((continuation.contextReferences as Record<string, unknown>).generationProfilePin).toBeUndefined();
    const claim = { continuationId: continuation.id, leaseToken, attemptCount: 1, maxAttempts: 3, request: {
      operationId: continuation.id, locale: continuation.locale!,
      contextFingerprint: continuation.contextFingerprint!, promptVersion: continuation.promptVersion!,
      outputSchemaVersion: continuation.outputSchemaVersion!, inputTokenLimit: continuation.inputTokenLimit!,
      outputTokenLimit: continuation.outputTokenLimit!,
    } };
    return { ...f, profile, settings, memory, continuation, claim };
  }

  it('keeps a real legacy fallback eligible only while its first semantic review is pending', async () => {
    const f = await legacyDuringFirstReview();
    const repository = new PrismaStoryContinuationQueueRepository(db as never);
    await repository.markDispatched(f.claim, tx => f.economics.continuationDispatchAuthorization(tx, f.claim));
    await expect(f.economics.settleContinuation(null, f.continuation.id, result(f.continuation.id),
      randomUUID(), f.claim.leaseToken)).resolves.toMatchObject({ status: 'completed' });
    expect(f.provider.generate).not.toHaveBeenCalled();
  }, 90_000);

  it.each(['dispatch', 'settlement', 'edited_after_approval'])
  ('does not bypass the real creator approval with an older unpinned legacy context: %s', async stage => {
    const f = await legacyDuringFirstReview();
    const profiles = new StoryGenerationProfileService(db as never);
    await profiles.approve(f.owner.id, f.work.id, { expectedDraftFingerprint: f.profile.draftFingerprint! });
    expect(await db.storyMemoryRecord.findUnique({ where: { id: f.memory.id } })).toMatchObject({ status: 'approved' });
    expect(await db.storyStyleProfileConsent.findUnique({ where: { id: f.consent.id } }))
      .toMatchObject({ revision: f.consent.revision, status: 'active' });
    if (stage === 'edited_after_approval') {
      const changed = normalizeCreatorGenerationProfile('story', f.settings);
      changed.sections[0].decision = 'edited';
      changed.sections[0].value.summary = 'Revised first semantic approval';
      await profiles.update(f.owner.id, f.work.id, { settings: changed as never });
      expect(await db.storyWorkGenerationProfile.findFirst({ where: { workId: f.work.id },
        orderBy: { profileVersion: 'desc' } })).toMatchObject({ status: 'needs_review', profileVersion: 2 });
    }
    if (stage !== 'settlement') {
      const repository = new PrismaStoryContinuationQueueRepository(db as never);
      await expect(repository.markDispatched(f.claim, tx => f.economics.continuationDispatchAuthorization(tx, f.claim)))
        .rejects.toBeInstanceOf(StoryContinuationDispatchAuthorizationChanged);
      expect(await db.storyAiContinuation.findUnique({ where: { id: f.continuation.id } }))
        .toMatchObject({ dispatchStartedAt: null });
    }
    await expect(f.economics.settleContinuation(null, f.continuation.id, result(f.continuation.id),
      randomUUID(), f.claim.leaseToken)).resolves.toMatchObject({ status: 'failed', failureCode: 'generation_authorization_changed' });
    expect(await db.storyAiGeneratedScene.count({ where: { continuationId: f.continuation.id } })).toBe(0);
    expect(f.provider.generate).not.toHaveBeenCalled();
  }, 90_000);

  it.each(['author_draft', 'memory_status', 'invalid_memory_id', 'analysis_failed'])
  ('blocks a provider call when approval changes during preflight: %s', async change => {
    const f = await prepared();
    f.provider.preflight = jest.fn().mockImplementation(async () => {
      if (change === 'author_draft') await editAuthor(f);
      if (change === 'memory_status') await db.storyMemoryRecord.update({ where: { id: f.memory.id },
        data: { status: 'superseded' } });
      if (change === 'analysis_failed') await db.storyAnalysisJob.update({ where: { id: f.profile.analysisJobId },
        data: { status: 'failed' } });
      if (change === 'invalid_memory_id') {
        const references = f.continuation.contextReferences as Record<string, Prisma.JsonValue>;
        (references.memoryPins as Array<Record<string, Prisma.JsonValue>>)[0].id = 'not-a-uuid';
        await db.storyAiContinuation.update({ where: { id: f.continuation.id }, data: { contextReferences: references } });
      }
      return { supported: true };
    });
    await expect(runner(f).executeOne('author-dispatch-test')).resolves.toMatchObject({ status: 'failed' });
    expect(f.provider.preflight).toHaveBeenCalledTimes(1);
    expect(f.provider.generate).not.toHaveBeenCalled();
    expect(await db.storyAiContinuation.findUnique({ where: { id: f.continuation.id } }))
      .toMatchObject({ status: 'failed', failureCode: 'generation_authorization_changed', dispatchStartedAt: null });
    expect(await db.storyReaderProgress.findUnique({ where: { id: f.continuation.progressId } }))
      .toMatchObject({ currentSceneId: f.scene.id, currentGeneratedSceneId: null, status: 'active' });
    expect(await db.storyAiAllowanceBucket.findUnique({ where: { userId_releaseId: {
      userId: f.reader.id, releaseId: f.release.id,
    } } })).toMatchObject({ reservedCount: 0, consumedCount: 0 });
    expect(await db.storyAiUsageLedger.findFirst({ where: { continuationId: f.continuation.id, eventKind: 'new_route_failed' } }))
      .toMatchObject({ status: 'failed', inputTokens: 0, outputTokens: 0, actualCostKrw: null });
  }, 90_000);

  it('releases author locks before entering the provider and permits a creator edit during its await', async () => {
    const f = await prepared();
    f.provider.preflight = jest.fn().mockResolvedValue({ supported: true });
    f.provider.generate.mockImplementation(async () => {
      expect(await db.storyAiContinuation.findUnique({ where: { id: f.continuation.id } }))
        .toMatchObject({ dispatchStartedAt: expect.any(Date) });
      await editAuthor(f);
      throw new StoryContinuationProviderError('qa_provider_not_called_externally', false);
    });
    await expect(runner(f).executeOne('author-dispatch-test')).resolves.toMatchObject({ status: 'failed' });
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
    expect(await db.storyWorkGenerationProfile.findFirst({ where: { workId: f.work.id },
      orderBy: { profileVersion: 'desc' } })).toMatchObject({ status: 'needs_review', profileVersion: 2 });
    expect(await db.storyAiContinuation.findUnique({ where: { id: f.continuation.id } }))
      .toMatchObject({ failureCode: 'qa_provider_not_called_externally' });
  }, 90_000);

  it('rejects a different claim fingerprint without writing a dispatch fence', async () => {
    const f = await prepared();
    const claim = { ...f.claim, request: { ...f.claim.request, contextFingerprint: '0'.repeat(64) } };
    const repository = new PrismaStoryContinuationQueueRepository(db as never);
    await expect(repository.markDispatched(claim, tx => f.economics.continuationDispatchAuthorization(tx, claim)))
      .rejects.toThrow('dispatch lease is stale');
    expect(await db.storyAiContinuation.findUnique({ where: { id: claim.continuationId } }))
      .toMatchObject({ dispatchStartedAt: null });
  }, 90_000);

  it('waits for an author edit before dispatch and rejects the old approval after the edit commits', async () => {
    const f = await prepared();
    const gate = barrier();
    const writer = db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${f.work.id}::uuid FOR UPDATE`);
      await tx.storyWorkGenerationProfile.update({ where: { id: f.profile.id }, data: { reviewRevision: 2 } });
      await gate.pause();
    }, { timeout: 20_000 });
    await gate.held;
    const repository = new PrismaStoryContinuationQueueRepository(db as never);
    const dispatch = repository.markDispatched(f.claim, tx => f.economics.continuationDispatchAuthorization(tx, f.claim));
    const rejection = expect(dispatch).rejects.toBeInstanceOf(StoryContinuationDispatchAuthorizationChanged);
    try { await expectWorkLockWait('SHARE'); } finally { gate.release(); }
    await writer;
    await rejection;
    expect(await db.storyAiContinuation.findUnique({ where: { id: f.claim.continuationId } }))
      .toMatchObject({ dispatchStartedAt: null });
  }, 90_000);

  it('commits the approved fence before a concurrent creator edit can replace its profile', async () => {
    const f = await prepared();
    const gate = barrier();
    const repository = new PrismaStoryContinuationQueueRepository(db as never);
    const dispatch = repository.markDispatched(f.claim, async tx => {
      const allowed = await f.economics.continuationDispatchAuthorization(tx, f.claim);
      await gate.pause();
      return allowed;
    });
    await gate.held;
    const writer = editAuthor(f);
    try { await expectWorkLockWait('UPDATE'); } finally { gate.release(); }
    await dispatch;
    await writer;
    expect(await db.storyAiContinuation.findUnique({ where: { id: f.claim.continuationId } }))
      .toMatchObject({ dispatchStartedAt: expect.any(Date) });
    expect(await db.storyWorkGenerationProfile.findFirst({ where: { workId: f.work.id },
      orderBy: { profileVersion: 'desc' } })).toMatchObject({ status: 'needs_review', profileVersion: 2 });
    expect(f.provider.generate).not.toHaveBeenCalled();
  }, 90_000);

  it('allows only one dispatch across two repository instances with real approved author pins', async () => {
    const f = await prepared();
    const a = new PrismaStoryContinuationQueueRepository(db as never);
    const b = new PrismaStoryContinuationQueueRepository(db as never);
    const authorize = (tx: Prisma.TransactionClient) => f.economics.continuationDispatchAuthorization(tx, f.claim);
    const dispatched = await Promise.allSettled([a.markDispatched(f.claim, authorize), b.markDispatched(f.claim, authorize)]);
    expect(dispatched.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.storyAiContinuation.findUnique({ where: { id: f.claim.continuationId } }))
      .toMatchObject({ dispatchStartedAt: expect.any(Date) });
  }, 90_000);

  function result(id: string) {
    return {
      status: 'completed' as const, moderationDecision: 'allow' as const, actualCostKrw: 0,
      inputTokens: 10, outputTokens: 20, cachedInputTokens: 0, imageUnits: 0,
      resultTitle: { ko: 'Offline author-bound result' },
      resultBeats: [{ beatType: 'paragraph', content: { ko: 'Synthetic continuation, not an AI quality proof.' } }],
      resultVisualManifest: {
        sceneKey: `ai-${id}`, background: { state: 'fallback', altKey: 'story.visual.fallback' }, characters: [],
        fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' },
      },
      nextChoices: [{ choiceKey: 'next', label: { ko: 'Continue' } }],
    };
  }

  function barrier() {
    let entered!: () => void;
    let release!: () => void;
    const held = new Promise<void>(resolve => { entered = resolve; });
    const opened = new Promise<void>(resolve => { release = resolve; });
    return { held, release, pause: async () => { entered(); await opened; } };
  }

  async function expectWorkLockWait(mode: 'SHARE' | 'UPDATE') {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const rows = await db.$queryRaw<Array<{ waiting: number }>>(Prisma.sql`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query ILIKE '%story_works%' AND query ILIKE ${`%FOR ${mode}%`}
          AND cardinality(pg_blocking_pids(pid)) > 0
      `);
      if (rows[0]?.waiting) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Expected author work ${mode} lock wait not observed`);
  }

  it('waits for an overlapping author transaction and rejects its old approval after commit', async () => {
    const f = await prepared();
    const gate = barrier();
    const writer = db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${f.work.id}::uuid FOR UPDATE`);
      await tx.storyWorkGenerationProfile.update({ where: { id: f.profile.id }, data: { reviewRevision: 2 } });
      await gate.pause();
    }, { timeout: 20_000 });
    await gate.held;
    const settlement = f.economics.settleContinuation(null, f.continuation.id,
      result(f.continuation.id), randomUUID(), f.claim.leaseToken);
    try { await expectWorkLockWait('SHARE'); } finally { gate.release(); }
    await writer;
    await expect(settlement).resolves.toMatchObject({ status: 'failed', failureCode: 'generation_authorization_changed' });
    expect(await db.storyAiGeneratedScene.count({ where: { continuationId: f.continuation.id } })).toBe(0);
  }, 90_000);

  it('finishes an approved settlement before a simultaneous creator edit can replace its profile', async () => {
    const f = await prepared();
    const gate = barrier();
    const legal = new PersistedStoryContinuationLegalActivationGate(f.activation);
    const economics = new StoryEconomicsService(db as never, { authorize: async (...args: Parameters<typeof legal.authorize>) => {
      const authorized = await legal.authorize(...args);
      await gate.pause();
      return authorized;
    } } as never, f.provider as never, f.approval);
    const settlement = economics.settleContinuation(null, f.continuation.id,
      result(f.continuation.id), randomUUID(), f.claim.leaseToken);
    await gate.held;
    const changed = normalizeCreatorGenerationProfile('story', f.settings);
    changed.sections[0].decision = 'edited';
    changed.sections[0].value.summary = 'Later creator edit';
    const writer = new StoryGenerationProfileService(db as never)
      .update(f.owner.id, f.work.id, { settings: changed as never });
    try { await expectWorkLockWait('UPDATE'); } finally { gate.release(); }
    await expect(settlement).resolves.toMatchObject({ status: 'completed' });
    await writer;
    expect(await db.storyWorkGenerationProfile.findFirst({ where: { workId: f.work.id },
      orderBy: { profileVersion: 'desc' } })).toMatchObject({ status: 'needs_review', profileVersion: 2 });
    expect(await db.storyAiGeneratedScene.findFirst({ where: { continuationId: f.continuation.id } }))
      .toMatchObject({ status: 'ready' });
    expect(f.provider.generate).not.toHaveBeenCalled();
  }, 90_000);

  it.each(['profile_revision', 'author_draft', 'memory_content', 'memory_status', 'invalid_memory_id'])
  ('does not save or consume a reader use after author context changed: %s', async change => {
    const f = await prepared();
    if (change === 'profile_revision') {
      await db.storyWorkGenerationProfile.update({ where: { id: f.profile.id }, data: { reviewRevision: 2 } });
    }
    if (change === 'author_draft') {
      const changed = normalizeCreatorGenerationProfile('story', f.settings);
      changed.sections[0].decision = 'edited';
      changed.sections[0].value.summary = 'A newly edited author voice';
      await new StoryGenerationProfileService(db as never).update(f.owner.id, f.work.id, { settings: changed as never });
      expect(await db.storyWorkGenerationProfile.findFirst({ where: { workId: f.work.id },
        orderBy: { profileVersion: 'desc' } })).toMatchObject({ status: 'needs_review', profileVersion: 2 });
      // Rights consent is unchanged: the profile guard, not a legal revocation, must reject it.
      expect(await db.storyStyleProfileConsent.findUnique({ where: { id: f.consent.id } }))
        .toMatchObject({ revision: f.consent.revision, status: 'active' });
    }
    if (change === 'memory_content') await db.storyMemoryRecord.update({ where: { id: f.memory.id },
      data: { content: { ko: 'Unapproved changed voice.' } } });
    if (change === 'memory_status') await db.storyMemoryRecord.update({ where: { id: f.memory.id },
      data: { status: 'superseded' } });
    if (change === 'invalid_memory_id') {
      const references = f.continuation.contextReferences as Record<string, Prisma.JsonValue>;
      const pins = references.memoryPins as Array<Record<string, Prisma.JsonValue>>;
      pins[0].id = 'not-a-uuid';
      await db.storyAiContinuation.update({ where: { id: f.continuation.id }, data: {
        contextReferences: references,
      } });
    }
    await expect(f.economics.settleContinuation(null, f.continuation.id, result(f.continuation.id),
      `author-pins-${f.continuation.id}`, f.claim.leaseToken)).resolves.toMatchObject({ status: 'failed' });
    const settled = await db.storyAiContinuation.findUniqueOrThrow({ where: { id: f.continuation.id } });
    expect(settled).toMatchObject({ failureCode: 'generation_authorization_changed', resultGeneratedSceneId: null });
    expect(await db.storyAiGeneratedScene.count({ where: { continuationId: f.continuation.id } })).toBe(0);
    expect(await db.storyReaderProgress.findUnique({ where: { id: f.continuation.progressId } }))
      .toMatchObject({ currentSceneId: f.scene.id, currentGeneratedSceneId: null, status: 'active' });
    expect(await db.storyAiAllowanceBucket.findUnique({ where: { userId_releaseId: {
      userId: f.reader.id, releaseId: f.release.id,
    } } })).toMatchObject({ reservedCount: 0, consumedCount: 0 });
    expect(await db.storyAiUsageLedger.findFirst({ where: { continuationId: f.continuation.id, eventKind: 'new_route_failed' } }))
      .toMatchObject({ status: 'failed', inputTokens: 10, outputTokens: 20, allowanceDelta: 0, progressApplied: false });
    expect(await db.auditEvent.findFirst({ where: { targetId: f.continuation.id,
      action: 'story_ai_continuation.settle' } })).toMatchObject({
      metadata: expect.objectContaining({ failureCode: 'generation_authorization_changed' }),
    });
    const ledgerCount = await db.storyAiUsageLedger.count({ where: { continuationId: f.continuation.id } });
    await expect(f.economics.settleContinuation(null, f.continuation.id, result(f.continuation.id),
      `author-pins-${f.continuation.id}`, f.claim.leaseToken)).resolves.toMatchObject({ status: 'failed', idempotentReplay: true });
    expect(await db.storyAiUsageLedger.count({ where: { continuationId: f.continuation.id } })).toBe(ledgerCount);
    expect(f.provider.generate).not.toHaveBeenCalled();
  }, 90_000);

  it('saves an unchanged approved result but leaves shared reuse pending review', async () => {
    const f = await prepared();
    await expect(f.economics.settleContinuation(null, f.continuation.id, result(f.continuation.id),
      randomUUID(), f.claim.leaseToken)).resolves.toMatchObject({ status: 'completed' });
    expect(await db.storyAiGeneratedScene.findFirst({ where: { continuationId: f.continuation.id } }))
      .toMatchObject({ status: 'ready', userId: f.reader.id });
    expect(await db.storyAiAllowanceBucket.findUnique({ where: { userId_releaseId: {
      userId: f.reader.id, releaseId: f.release.id,
    } } })).toMatchObject({ reservedCount: 0, consumedCount: 1 });
    expect(await db.storyAiReusableResult.findUnique({ where: { id: f.continuation.sharedResultId! } }))
      .toMatchObject({ status: 'pending' });
    expect(f.provider.generate).not.toHaveBeenCalled();
  }, 90_000);
});

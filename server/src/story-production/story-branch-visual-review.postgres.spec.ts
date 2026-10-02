import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { activationFixture, postgresClient } from './story-ai-activation.postgres-fixture';
import { normalizeCreatorGenerationProfile } from '../generation-profile/creator-generation-profile.policy';
import { StoryGenerationProfileService } from './story-generation-profile.service';
import { StoryBranchVisualReviewService } from './story-branch-visual-review.service';
import { StoryArtistParticipantService } from './story-artist-participant.service';
import { StoryVisualGenerationService } from './story-visual-generation.service';
import { StoryProductionService } from './story-production.service';
import { StoryContinuationProviderResult } from './story-continuation.provider';
import { ConflictException, NotFoundException } from '@nestjs/common';

const postgres = process.env.STORY_TEST_DATABASE_URL ? describe : describe.skip;

postgres('Shared branch scene approval (isolated PostgreSQL, synthetic quality evidence)', () => {
  let db: PrismaClient;
  const region = process.env.STORY_AI_REGION;
  beforeAll(async () => {
    const url = new URL(process.env.STORY_TEST_DATABASE_URL!);
    if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55432' ||
      url.username !== 'lumina_qa' || url.pathname !== '/lumina_story_qa' || url.search || url.hash || process.env.NODE_ENV !== 'test') {
      throw new Error('Dedicated story QA database required');
    }
    process.env.STORY_AI_REGION = 'KR'; db = postgresClient(); await db.$connect();
  });
  beforeEach(() => jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Paid/provider calls forbidden')));
  afterEach(() => { try { expect(globalThis.fetch).not.toHaveBeenCalled(); } finally { jest.restoreAllMocks(); } });
  afterAll(async () => {
    if (region === undefined) delete process.env.STORY_AI_REGION; else process.env.STORY_AI_REGION = region;
    await db?.$disconnect();
  });

  async function fixture(sharedApproval = true) {
    const f = await activationFixture(db);
    await db.storyStyleProfileConsent.update({ where: { id: f.consent.id }, data: { imageTransformationAllowed: true } });
    await db.storyAnalysisJob.create({ data: { workId: f.work.id, manuscriptVersionId: f.manuscript.id,
      analysisVersion: 2, idempotencyKey: randomUUID(), status: 'completed', pipeline: 'semantic_extraction_v1',
      sourceContentHash: f.manuscript.contentHash, sourceLocale: 'ko', actorUserId: f.owner.id, rateCardId: f.rate.id,
      sourceDigest: f.manuscript.contentHash, configHash: f.manuscript.contentHash, totalParagraphs: 1,
      completedParagraphs: 1, plannedParagraphs: 1 } });
    const analysis = await db.storyAnalysisJob.findFirstOrThrow({ where: { workId: f.work.id, analysisVersion: 2 } });
    await db.storyAnalysisEvidence.create({ data: { analysisJobId: analysis.id, provenance: 'semantic_candidate', sequence: 1,
      evidenceType: 'style', sourcePartKey: 'part-1', sourceParagraphIndex: 0,
      payload: { title: 'Synthetic style evidence', observation: 'Short first-person sentences.', styleCategory: 'narration' } } });
    const profiles = new StoryGenerationProfileService(db as never);
    const draft = await profiles.getOrCreate(f.owner.id, f.work.id);
    const settings = normalizeCreatorGenerationProfile('story', draft.profile.draftSettings);
    const edited = await profiles.update(f.owner.id, f.work.id, { settings: { ...settings,
      sections: settings.sections.map(section => ({ ...section, decision: 'accepted' as const })) } });
    await profiles.approve(f.owner.id, f.work.id, { expectedDraftFingerprint: edited.profile.draftFingerprint! });
    await db.storyReleaseCapability.update({ where: { releaseId: f.release.id }, data: { aiInputTokenLimit: 12000 } });
    const continuation = await f.generatePersonal();
    const result = await db.storyAiReusableResult.findFirstOrThrow({ where: { workId: f.work.id } });
    if (sharedApproval) await f.approve(result);
    const config = { get: (key: string): string | undefined => key === 'STORY_BRANCH_VISUAL_REVIEW_ENABLED' ? 'true' : undefined };
    const participants = new StoryArtistParticipantService(db as never, config as never);
    const service = new StoryBranchVisualReviewService(db as never, config as never, f.approval, participants);
    const visuals = new StoryVisualGenerationService(db as never, config as never, undefined, participants, undefined, undefined, service);
    return { ...f, continuation, result, service, config, profiles, visuals };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function input(f: Fixture) {
    const view = await f.service.review(f.owner.id, f.work.id, f.result.id);
    return { expectedSourceChecksum: view.sourceChecksum, expectedProfilePinHash: view.profilePinHash,
      idempotencyKey: randomUUID(), promptText: 'Reviewed portrait scene. Preserve the same archivist, room and time.' };
  }
  async function approve(f: Fixture, data: Awaited<ReturnType<typeof input>>, batch: Awaited<ReturnType<StoryBranchVisualReviewService['save']>>) {
    return f.service.approve(f.owner.id, f.work.id, f.result.id, batch.batchId, { ...data,
      expectedBatchChecksum: batch.batchChecksum, expectedRevision: batch.revision, sceneReviewed: true });
  }
  async function register(f: Fixture, continuation = f.continuation) {
    const scene = await db.storyAiGeneratedScene.findUniqueOrThrow({ where: { id: continuation.resultGeneratedSceneId! } });
    const beats = await db.storyAiGeneratedBeat.findMany({ where: { sceneId: scene.id }, orderBy: { position: 'asc' } });
    const result: Pick<StoryContinuationProviderResult, 'title' | 'beats'> = { title: scene.title as Record<string, string>,
      beats: beats.map(beat => ({ beatType: beat.beatType as 'paragraph', content: beat.content as Record<string, string> })) };
    await f.visuals.registerGeneratedContinuationPrompt(continuation.id, result);
    const prompt = await db.storyVisualPrompt.findFirstOrThrow({ where: { workId: f.work.id, sourceSceneKey: scene.sceneKey } });
    return { scene, prompt };
  }
  async function approvedSource(f: Fixture, sceneKey: string, promptSha256: string) {
    return db.$transaction(tx => f.service.approvedForGeneratedSource(tx, f.work.id, f.release.id, f.release.checksum, sceneKey, promptSha256));
  }

  it('does not expose unapproved private results or another author work', async () => {
    const f = await fixture(false);
    await expect(f.service.review(f.owner.id, f.work.id, f.result.id)).rejects.toMatchObject({ status: 404 });
    await f.approve(f.result);
    await expect(f.service.review(f.second.id, f.work.id, f.result.id)).rejects.toMatchObject({ status: 404 });
    await expect(f.service.review(f.owner.id, f.work.id, f.continuation.resultGeneratedSceneId!)).rejects.toMatchObject({ status: 404 });
    expect(await db.storyBranchVisualReviewBatch.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it('reads shared prose without private reader context and never implicitly approves or generates', async () => {
    const f = await fixture(), view = await f.service.review(f.owner.id, f.work.id, f.result.id);
    expect(view).toMatchObject({ prose: 'Synthetic generated continuation.', proposalApproved: false,
      currentBatch: null, generationStarted: false, published: false });
    const json = JSON.stringify(view);
    for (const forbidden of [f.reader.id, f.continuation.progressId, f.continuation.id, 'contextReferences', 'memoryPins', 'participantPin']) {
      expect(json).not.toContain(forbidden);
    }
    expect(await db.storyBranchVisualReviewBatch.count({ where: { workId: f.work.id } })).toBe(0);
    expect(await db.storyVisualGeneration.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it('stores an exact draft, explicitly approves once and preserves original prose and prompt', async () => {
    const f = await fixture(), data = await input(f), source = await register(f);
    const original = await db.storyAiGeneratedScene.findUniqueOrThrow({ where: { id: source.scene.id } });
    const batch = await f.service.save(f.owner.id, f.work.id, f.result.id, data);
    expect(batch).toMatchObject({ status: 'draft', revision: 1, approvedAt: null, promptText: data.promptText });
    await expect(approvedSource(f, source.scene.sceneKey, source.prompt.promptSha256))
      .rejects.toMatchObject({ response: { code: 'STORY_BRANCH_VISUAL_REVIEW_APPROVAL_REQUIRED' } });
    await expect(approve(f, data, batch)).resolves.toMatchObject({ status: 'approved', revision: 2 });
    await expect(approve(f, data, batch)).resolves.toMatchObject({ batchId: batch.batchId, status: 'approved' });
    await expect(approvedSource(f, source.scene.sceneKey, source.prompt.promptSha256)).resolves.toMatchObject({
      batchId: batch.batchId, promptText: data.promptText, sourceChecksum: data.expectedSourceChecksum });
    expect(await db.storyAiGeneratedScene.findUniqueOrThrow({ where: { id: source.scene.id } })).toEqual(original);
    expect(await db.storyVisualPrompt.findUniqueOrThrow({ where: { id: source.prompt.id } })).toEqual(source.prompt);
    expect(await db.auditEvent.count({ where: { targetId: batch.batchId, action: 'story_branch_visual_review.explicitly_approved' } })).toBe(1);
    expect(await db.storyVisualGeneration.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it('uses canonical stored UUIDs for source and approval identity regardless of caller letter casing', async () => {
    const f = await fixture(), data = await input(f);
    const ids = [f.owner.id, f.work.id, f.result.id].map(id => id.toUpperCase());
    const view = await f.service.review(ids[0], ids[1], ids[2]);
    expect(view).toMatchObject({ workId: f.work.id, sharedResultId: f.result.id,
      sourceChecksum: data.expectedSourceChecksum, profilePinHash: data.expectedProfilePinHash });
    const batch = await f.service.save(ids[0], ids[1], ids[2], { ...data, idempotencyKey: data.idempotencyKey.toUpperCase() });
    await expect(f.service.approve(ids[0], ids[1], ids[2], batch.batchId.toUpperCase(), { ...data,
      expectedBatchChecksum: batch.batchChecksum, expectedRevision: batch.revision, sceneReviewed: true }))
      .resolves.toMatchObject({ status: 'approved', workId: f.work.id, sharedResultId: f.result.id });
    await expect(f.service.list(ids[0], ids[1], {})).resolves.toMatchObject({ workId: f.work.id,
      items: [{ sharedResultId: f.result.id, status: 'approved', sourceChecksum: data.expectedSourceChecksum }] });
  });

  it('reuses approval only for a checked shared clone with the same source and exact text', async () => {
    const f = await fixture(), data = await input(f), batch = await f.service.save(f.owner.id, f.work.id, f.result.id, data);
    await approve(f, data, batch);
    const receipt = await f.request(1);
    const continuation = await db.storyAiContinuation.findUniqueOrThrow({ where: { id: receipt.continuationId } });
    const source = await register(f, continuation);
    const review = await approvedSource(f, source.scene.sceneKey, source.prompt.promptSha256);
    expect(review).toMatchObject({ batchId: batch.batchId, promptText: data.promptText, sourceSceneKey: `ai-reuse-${continuation.id}` });
    const effective = await (f.visuals as any).effectiveVisualPrompt(f.work.id, f.release.id, f.release.checksum, source.prompt.promptText, source.scene.sceneKey);
    expect(effective.review.batchId).toBe(batch.batchId);
    expect(effective.prompt).toContain(data.promptText);
    await db.storyAiGeneratedBeat.updateMany({ where: { sceneId: source.scene.id }, data: { content: { ko: 'Altered clone prose.' } } });
    await expect(approvedSource(f, source.scene.sceneKey, source.prompt.promptSha256)).rejects.toMatchObject({ status: 409 });
  });

  it('a later draft immediately supersedes old approval, including idempotent replay attempts', async () => {
    const f = await fixture(), data = await input(f), batch = await f.service.save(f.owner.id, f.work.id, f.result.id, data);
    const source = await register(f); await approve(f, data, batch);
    const next = await f.service.save(f.owner.id, f.work.id, f.result.id, { ...data, idempotencyKey: randomUUID(), promptText: 'Revised scene.' });
    expect(next.batchVersion).toBe(2);
    await expect(approve(f, data, batch)).rejects.toMatchObject({ response: { code: 'STORY_BRANCH_VISUAL_REVIEW_BATCH_SUPERSEDED' } });
    await expect(approvedSource(f, source.scene.sceneKey, source.prompt.promptSha256)).rejects.toMatchObject({ response: { code: 'STORY_BRANCH_VISUAL_REVIEW_APPROVAL_REQUIRED' } });
    await expect(f.service.save(f.owner.id, f.work.id, f.result.id, data)).resolves.toMatchObject({ batchId: batch.batchId });
    expect((await f.service.review(f.owner.id, f.work.id, f.result.id)).currentBatch?.batchId).toBe(next.batchId);
  });

  it.each(['source', 'profile', 'checksum', 'explicit'])('rejects changed or missing %s confirmation', async field => {
    const f = await fixture(), data = await input(f), batch = await f.service.save(f.owner.id, f.work.id, f.result.id, data);
    const approval = { ...data, expectedBatchChecksum: batch.batchChecksum, expectedRevision: 1, sceneReviewed: true };
    if (field === 'source') approval.expectedSourceChecksum = 'a'.repeat(64);
    if (field === 'profile') approval.expectedProfilePinHash = 'a'.repeat(64);
    if (field === 'checksum') approval.expectedBatchChecksum = 'a'.repeat(64);
    if (field === 'explicit') approval.sceneReviewed = false;
    await expect(f.service.approve(f.owner.id, f.work.id, f.result.id, batch.batchId, approval)).rejects.toBeDefined();
    expect((await db.storyBranchVisualReviewBatch.findUniqueOrThrow({ where: { id: batch.batchId } })).status).toBe('draft');
  });

  it('keeps approved shared body and reviewed origin immutable without weakening DB protection', async () => {
    const f = await fixture(), data = await input(f);
    await expect(db.storyAiReusableBeat.updateMany({ where: { sharedResultId: f.result.id }, data: { content: { ko: 'Different approved shared prose.' } } }))
      .rejects.toThrow('immutable');
    await expect(db.storyAiGeneratedBeat.updateMany({ where: { sceneId: f.continuation.resultGeneratedSceneId! }, data: { content: { ko: 'Different private origin prose.' } } }))
      .rejects.toThrow('immutable');
    await expect(f.service.save(f.owner.id, f.work.id, f.result.id, data)).resolves.toMatchObject({ status: 'draft' });
    expect(await db.storyBranchVisualReviewBatch.count({ where: { workId: f.work.id } })).toBe(1);
  });

  it('revoked reuse evidence invalidates read, approval and generation source', async () => {
    const f = await fixture(), data = await input(f), source = await register(f);
    const batch = await f.service.save(f.owner.id, f.work.id, f.result.id, data); await approve(f, data, batch);
    await f.activation.revokeResult(f.owner.id, f.result.id, 'e'.repeat(64));
    await expect(f.service.review(f.owner.id, f.work.id, f.result.id)).rejects.toMatchObject({ status: 404 });
    await expect(approvedSource(f, source.scene.sceneKey, source.prompt.promptSha256)).rejects.toMatchObject({
      response: { code: 'STORY_BRANCH_VISUAL_REVIEW_APPROVAL_REQUIRED' } });
  });

  it('audit failure rolls back draft and explicit approval atomically', async () => {
    const f = await fixture(), data = await input(f);
    const transaction = db.$transaction.bind(db);
    const mocked = jest.spyOn(db, '$transaction').mockImplementation(((action: (tx: Prisma.TransactionClient) => unknown, options: unknown) =>
      transaction(async tx => { tx.auditEvent.create = jest.fn().mockRejectedValue(new Error('offline audit unavailable')); return action(tx); }, options as never)) as never);
    await expect(f.service.save(f.owner.id, f.work.id, f.result.id, data)).rejects.toMatchObject({ response: { code: 'STORY_BRANCH_VISUAL_REVIEW_SAVE_UNCONFIRMED' } });
    mocked.mockRestore();
    expect(await db.storyBranchVisualReviewBatch.count({ where: { workId: f.work.id } })).toBe(0);
    const batch = await f.service.save(f.owner.id, f.work.id, f.result.id, data);
    const failApproval = jest.spyOn(db, '$transaction').mockImplementation(((action: (tx: Prisma.TransactionClient) => unknown, options: unknown) =>
      transaction(async tx => { tx.auditEvent.create = jest.fn().mockRejectedValue(new Error('offline audit unavailable')); return action(tx); }, options as never)) as never);
    await expect(approve(f, data, batch)).rejects.toMatchObject({ response: { code: 'STORY_BRANCH_VISUAL_REVIEW_SAVE_UNCONFIRMED' } });
    failApproval.mockRestore();
    expect((await db.storyBranchVisualReviewBatch.findUniqueOrThrow({ where: { id: batch.batchId } })).status).toBe('draft');
  });

  it('concurrent same-key saves create one draft and retries recover it without implicit approval', async () => {
    const f = await fixture(), data = await input(f);
    const outcomes = await Promise.allSettled([f.service.save(f.owner.id, f.work.id, f.result.id, data),
      f.service.save(f.owner.id, f.work.id, f.result.id, data)]);
    expect(outcomes.some(outcome => outcome.status === 'fulfilled')).toBe(true);
    const batch = await f.service.save(f.owner.id, f.work.id, f.result.id, data);
    expect(batch.status).toBe('draft');
    expect(await db.storyBranchVisualReviewBatch.count({ where: { workId: f.work.id } })).toBe(1);
    expect(await db.auditEvent.count({ where: { targetId: batch.batchId, action: 'story_branch_visual_review.draft_saved' } })).toBe(1);
  });

  it.each(['manuscript', 'profile', 'consent'])('does not reuse author approval after current %s changes', async change => {
    const f = await fixture(), data = await input(f), source = await register(f);
    const batch = await f.service.save(f.owner.id, f.work.id, f.result.id, data); await approve(f, data, batch);
    if (change === 'manuscript') await db.storyManuscriptVersion.create({ data: { ownerUserId: f.owner.id, workId: f.work.id,
      version: 2, locale: 'ko', contentHash: 'c'.repeat(64), structuredBody: {} } });
    if (change === 'profile') {
      const view = await f.profiles.getOrCreate(f.owner.id, f.work.id);
      await f.profiles.update(f.owner.id, f.work.id, { settings: normalizeCreatorGenerationProfile('story', view.profile.draftSettings) });
    }
    if (change === 'consent') await db.storyStyleProfileConsent.update({ where: { id: f.consent.id }, data: { imageTransformationAllowed: false } });
    await expect(approvedSource(f, source.scene.sceneKey, source.prompt.promptSha256)).rejects.toMatchObject({ status: 409 });
  });

  it.each(['', ' ', '\0', '\ud800', 'x'.repeat(32001)])('rejects invalid text without saving', async text => {
    const f = await fixture(), data = await input(f);
    await expect(f.service.save(f.owner.id, f.work.id, f.result.id, { ...data, promptText: text })).rejects.toMatchObject({ status: 400 });
    expect(await db.storyBranchVisualReviewBatch.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it('disabled review API never queries data and enabled generation without its service fails closed', async () => {
    const service = new StoryBranchVisualReviewService({} as never, { get: () => undefined } as never, {} as never, {} as never);
    await expect(service.review(randomUUID(), randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'STORY_BRANCH_VISUAL_REVIEW_DISABLED' } });
    const visuals = new StoryVisualGenerationService({} as never, { get: () => 'true' } as never);
    await expect((visuals as any).reviewedScenePrompt({}, randomUUID(), randomUUID(), 'a'.repeat(64), `ai-${randomUUID()}`, 'original', {}))
      .rejects.toMatchObject({ response: { code: 'STORY_BRANCH_VISUAL_REVIEW_APPROVAL_REQUIRED' } });
  });

  it.each([undefined, 'false'])('preserves pre-rollout legacy behavior when the new review flag is %s', async flag => {
    const visuals = new StoryVisualGenerationService({} as never, { get: () => flag } as never);
    await expect((visuals as any).reviewedScenePrompt({}, randomUUID(), randomUUID(), 'a'.repeat(64), `ai-${randomUUID()}`, 'original', {}))
      .resolves.toBeNull();
  });

  it('lists current authorized results only, with no private source fields, and enforces ownership', async () => {
    const f = await fixture(false);
    await expect(f.service.list(f.owner.id, f.work.id, {})).resolves.toMatchObject({ items: [], nextCursor: null });
    await f.approve(f.result);
    const page = await f.service.list(f.owner.id, f.work.id, { limit: 1 });
    expect(page).toMatchObject({ contract: 'story-shared-branch-visual-list-v1', releaseId: f.release.id,
      releaseChecksum: f.release.checksum, items: [{ sharedResultId: f.result.id, status: 'unreviewed' }], nextCursor: null });
    for (const forbidden of [f.reader.id, f.continuation.id, f.continuation.progressId, 'prose', 'contextReferences', 'participantPin']) {
      expect(JSON.stringify(page)).not.toContain(forbidden);
    }
    await expect(f.service.list(f.second.id, f.work.id, {})).rejects.toMatchObject({ status: 404 });
    const data = await input(f), batch = await f.service.save(f.owner.id, f.work.id, f.result.id, data);
    expect((await f.service.list(f.owner.id, f.work.id, {})).items[0].status).toBe('draft');
    await approve(f, data, batch);
    expect((await f.service.list(f.owner.id, f.work.id, {})).items[0].status).toBe('approved');
    await f.activation.revokeResult(f.owner.id, f.result.id, 'e'.repeat(64));
    expect((await f.service.list(f.owner.id, f.work.id, {})).items).toEqual([]);
  });

  it.each([new ConflictException({ code: 'UNEXPECTED_DEPENDENCY_CONFLICT' }), new NotFoundException('Unexpected dependency lookup failure')])(
    'does not hide unknown dependency failure as a successful empty list', async failure => {
      const f = await fixture();
      jest.spyOn(f.approval, 'authorizeResult').mockRejectedValueOnce(failure);
      await expect(f.service.list(f.owner.id, f.work.id, {})).rejects.toBe(failure);
    });

  it('connects exact author-approved guidance through dispatch, asset persistence and same-scene reuse without provider network', async () => {
    const f = await fixture(), data = await input(f), source = await register(f);
    const values: Record<string, string> = { STORY_BRANCH_VISUAL_REVIEW_ENABLED: 'true', STORY_IMAGE_GENERATION_ENABLED: 'true',
      OPENAI_API_KEY: 'synthetic-not-a-key', OBJECT_STORAGE_PROVIDER: 'r2', OBJECT_STORAGE_BUCKET: 'fixture',
      OBJECT_STORAGE_ACCESS_KEY_ID: 'synthetic', OBJECT_STORAGE_SECRET_ACCESS_KEY: 'synthetic', OBJECT_STORAGE_ENDPOINT: 'https://storage.example.test' };
    jest.spyOn(f.config, 'get').mockImplementation(key => values[key]);
    jest.spyOn(Reflect.get(f.visuals, 'logger'), 'log').mockImplementation();
    jest.spyOn(Reflect.get(f.visuals, 'logger'), 'warn').mockImplementation();
    const draw = jest.spyOn(f.visuals as any, 'generateImage').mockImplementation(async (...args: any[]) => {
      await args[6](async () => ({ ok: true }) as Response, new AbortController().signal);
      return Buffer.from('synthetic-branch-image-not-quality-evidence');
    });
    const upload = jest.spyOn(f.visuals as any, 'uploadImage').mockResolvedValue({ provider: 'r2',
      key: `story-visuals/${f.work.id}/${f.release.id}/${source.scene.sceneKey}/synthetic.webp` });
    const request = { releaseId: f.release.id, releaseChecksum: f.release.checksum, sourceSceneKey: source.scene.sceneKey };
    await expect(f.visuals.generateSample(f.work.id, request)).rejects.toMatchObject({ response: { code: 'STORY_BRANCH_VISUAL_REVIEW_APPROVAL_REQUIRED' } });
    expect(draw).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
    const batch = await f.service.save(f.owner.id, f.work.id, f.result.id, data); await approve(f, data, batch);
    await expect(f.visuals.generateSample(f.work.id, request)).resolves.toMatchObject({ status: 'ready', reused: false });
    expect(draw).toHaveBeenCalledTimes(1); expect(draw.mock.calls[0][0]).toContain(data.promptText);
    const generation = await db.storyVisualGeneration.findFirstOrThrow({ where: { workId: f.work.id } });
    const asset = await db.asset.findUniqueOrThrow({ where: { id: generation.assetId! } });
    expect((asset.metadata as any).storyVisual.sceneGuidanceApproval).toMatchObject({ batchId: batch.batchId, batchChecksum: batch.batchChecksum });
    await expect(f.visuals.generateSample(f.work.id, request)).resolves.toMatchObject({ status: 'ready', reused: true });
    expect(draw).toHaveBeenCalledTimes(1);
    await f.service.save(f.owner.id, f.work.id, f.result.id, { ...data, idempotencyKey: randomUUID(), promptText: 'New unapproved guide.' });
    await expect(f.visuals.generateSample(f.work.id, request)).rejects.toMatchObject({ response: { code: 'STORY_BRANCH_VISUAL_REVIEW_APPROVAL_REQUIRED' } });
    await expect(f.visuals.readyVisuals(f.work.id, f.release.id, [source.scene.sceneKey])).resolves.toEqual(new Map());
    expect(draw).toHaveBeenCalledTimes(1);
    expect(await db.storyVisualGeneration.findUniqueOrThrow({ where: { id: generation.id } })).toEqual(generation);
  });

  it.each(['before_dispatch', 'after_upload'])('does not accept superseded branch approval at %s', async phase => {
    const f = await fixture(), data = await input(f), source = await register(f);
    const batch = await f.service.save(f.owner.id, f.work.id, f.result.id, data); await approve(f, data, batch);
    const values: Record<string, string> = { STORY_BRANCH_VISUAL_REVIEW_ENABLED: 'true', STORY_IMAGE_GENERATION_ENABLED: 'true',
      OPENAI_API_KEY: 'synthetic-not-a-key', OBJECT_STORAGE_PROVIDER: 'r2', OBJECT_STORAGE_BUCKET: 'fixture',
      OBJECT_STORAGE_ACCESS_KEY_ID: 'synthetic', OBJECT_STORAGE_SECRET_ACCESS_KEY: 'synthetic', OBJECT_STORAGE_ENDPOINT: 'https://storage.example.test' };
    jest.spyOn(f.config, 'get').mockImplementation(key => values[key]);
    jest.spyOn(Reflect.get(f.visuals, 'logger'), 'log').mockImplementation();
    jest.spyOn(Reflect.get(f.visuals, 'logger'), 'warn').mockImplementation();
    const supersede = () => f.service.save(f.owner.id, f.work.id, f.result.id,
      { ...data, idempotencyKey: randomUUID(), promptText: 'New unapproved branch guidance during generation.' });
    const dispatch = jest.fn(async () => ({ ok: true }) as Response);
    const draw = jest.spyOn(f.visuals as any, 'generateImage').mockImplementation(async (...args: any[]) => {
      if (phase === 'before_dispatch') await supersede();
      await args[6](dispatch, new AbortController().signal);
      return Buffer.from('synthetic-branch-image-not-quality-evidence');
    });
    const upload = jest.spyOn(f.visuals as any, 'uploadImage').mockImplementation(async () => {
      if (phase === 'after_upload') await supersede();
      return { provider: 'r2', key: `story-visuals/${f.work.id}/${f.release.id}/${source.scene.sceneKey}/synthetic.webp` };
    });
    await expect(f.visuals.generateSample(f.work.id, { releaseId: f.release.id,
      releaseChecksum: f.release.checksum, sourceSceneKey: source.scene.sceneKey }))
      .resolves.toMatchObject({ status: 'failed', retryable: phase === 'before_dispatch' });
    expect(draw).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(phase === 'before_dispatch' ? 0 : 1);
    expect(upload).toHaveBeenCalledTimes(phase === 'before_dispatch' ? 0 : 1);
    const row = await db.storyVisualGeneration.findFirstOrThrow({ where: { workId: f.work.id } });
    expect(row).toMatchObject({ status: 'failed', assetId: null, attemptCount: phase === 'before_dispatch' ? 0 : 1 });
    expect(await db.asset.count({ where: { storageKey: { startsWith: `story-visuals/${f.work.id}/` } } })).toBe(0);
    await expect(f.visuals.readyVisuals(f.work.id, f.release.id, [source.scene.sceneKey])).resolves.toEqual(new Map());
  });

  async function sharedImageFixture(registerOrigin = true) {
    const f = await fixture(), data = await input(f);
    const source = registerOrigin ? await register(f) : { scene: await db.storyAiGeneratedScene.findUniqueOrThrow({
      where: { id: f.continuation.resultGeneratedSceneId! } }), prompt: null };
    const batch = await f.service.save(f.owner.id, f.work.id, f.result.id, data); await approve(f, data, batch);
    const receipt = await f.request(1);
    const continuation = await db.storyAiContinuation.findUniqueOrThrow({ where: { id: receipt.continuationId } });
    const clone = await register(f, continuation);
    const values: Record<string, string> = { STORY_BRANCH_VISUAL_REVIEW_ENABLED: 'true', STORY_SHARED_BRANCH_VISUAL_REUSE_ENABLED: 'true',
      STORY_IMAGE_GENERATION_ENABLED: 'true', OPENAI_API_KEY: 'synthetic-not-a-key', OBJECT_STORAGE_PROVIDER: 'r2',
      OBJECT_STORAGE_BUCKET: 'fixture', OBJECT_STORAGE_ACCESS_KEY_ID: 'synthetic', OBJECT_STORAGE_SECRET_ACCESS_KEY: 'synthetic',
      OBJECT_STORAGE_ENDPOINT: 'https://storage.example.test' };
    jest.spyOn(f.config, 'get').mockImplementation(key => values[key]);
    jest.spyOn(Reflect.get(f.visuals, 'logger'), 'log').mockImplementation();
    jest.spyOn(Reflect.get(f.visuals, 'logger'), 'warn').mockImplementation();
    const draw = jest.spyOn(f.visuals as any, 'generateImage').mockImplementation(async (...args: any[]) => {
      await args[6](async () => ({ ok: true }) as Response, new AbortController().signal);
      return Buffer.from('synthetic-shared-branch-image-not-quality-evidence');
    });
    const upload = jest.spyOn(f.visuals as any, 'uploadImage').mockResolvedValue({ provider: 'r2',
      key: `story-visuals/${f.work.id}/${f.release.id}/${source.scene.sceneKey}/synthetic.webp` });
    const request = (sourceSceneKey: string) => ({ releaseId: f.release.id, releaseChecksum: f.release.checksum, sourceSceneKey });
    return { ...f, data, source, clone, values, draw, upload, request };
  }

  it('shares one canonical image with a checked second reader without copying private progress or another provider request', async () => {
    const f = await sharedImageFixture();
    const original = await f.visuals.generateSample(f.work.id, f.request(f.source.scene.sceneKey));
    expect(original).toMatchObject({ status: 'ready', reused: false });
    f.values.STORY_IMAGE_GENERATION_ENABLED = 'false';
    const reused = await f.visuals.generateSample(f.work.id, f.request(f.clone.scene.sceneKey));
    expect(reused).toMatchObject({ status: 'ready', reused: true, sourceSceneKey: f.clone.scene.sceneKey,
      publicAssetPath: (original as { publicAssetPath: string }).publicAssetPath });
    const ready = await f.visuals.readyVisuals(f.work.id, f.release.id, [f.clone.scene.sceneKey]);
    expect(ready.get(f.clone.scene.sceneKey)?.publicAssetPath).toBe((original as { publicAssetPath: string }).publicAssetPath);
    expect(f.draw).toHaveBeenCalledTimes(1); expect(f.upload).toHaveBeenCalledTimes(1);
    expect(await db.storyVisualGeneration.count({ where: { workId: f.work.id } })).toBe(1);
    expect(await db.storyVisualGeneration.count({ where: { workId: f.work.id, sourceSceneKey: f.clone.scene.sceneKey } })).toBe(0);
    expect(JSON.stringify(reused)).not.toContain(f.continuation.progressId);
    expect(JSON.stringify(reused)).not.toContain(f.source.scene.sceneKey);
  });

  it('lets the later reader request the first image but charges only the canonical generation claim', async () => {
    const f = await sharedImageFixture();
    await expect(f.visuals.generateSample(f.work.id, f.request(f.clone.scene.sceneKey)))
      .resolves.toMatchObject({ status: 'ready', reused: false, sourceSceneKey: f.clone.scene.sceneKey });
    await expect(f.visuals.generateSample(f.work.id, f.request(f.source.scene.sceneKey)))
      .resolves.toMatchObject({ status: 'ready', reused: true });
    expect(f.draw).toHaveBeenCalledTimes(1);
    const jobs = await db.storyVisualGeneration.findMany({ where: { workId: f.work.id } });
    expect(jobs).toHaveLength(1); expect(jobs[0]).toMatchObject({ sourceSceneKey: f.source.scene.sceneKey, attemptCount: 1 });
  });

  it('does not share an image after clone text or the author guidance changes', async () => {
    const f = await sharedImageFixture();
    await f.visuals.generateSample(f.work.id, f.request(f.source.scene.sceneKey));
    await db.storyAiGeneratedBeat.updateMany({ where: { sceneId: f.clone.scene.id }, data: { content: { ko: 'Changed private clone.' } } });
    await expect(f.visuals.generateSample(f.work.id, f.request(f.clone.scene.sceneKey))).rejects.toMatchObject({ status: 409 });
    await expect(f.visuals.readyVisuals(f.work.id, f.release.id, [f.clone.scene.sceneKey])).resolves.toEqual(new Map());
    expect(f.draw).toHaveBeenCalledTimes(1);
  });

  it('keeps an attempted legacy clone image job separate and never reroutes an unknown paid outcome', async () => {
    const f = await sharedImageFixture();
    await f.visuals.generateSample(f.work.id, f.request(f.source.scene.sceneKey));
    const existing = await db.storyVisualGeneration.create({ data: { workId: f.work.id, releaseId: f.release.id,
      releaseChecksum: f.release.checksum, sourceSceneKey: f.clone.scene.sceneKey, promptSha256: f.clone.prompt.promptSha256,
      status: 'failed', attemptCount: 1, lastErrorCode: 'PROVIDER_OUTCOME_UNKNOWN' } });
    await expect(f.visuals.generateSample(f.work.id, f.request(f.clone.scene.sceneKey))).resolves.toMatchObject({ status: 'failed' });
    expect(f.draw).toHaveBeenCalledTimes(1);
    expect(await db.storyVisualGeneration.findUniqueOrThrow({ where: { id: existing.id } })).toEqual(existing);
  });

  it('concurrent origin and clone requests share one provider claim while the first request is in progress', async () => {
    const f = await sharedImageFixture();
    f.values.STORY_IMAGE_QUEUE_RELEASES = JSON.stringify([{ workId: f.work.id, releaseId: f.release.id, releaseChecksum: f.release.checksum }]);
    let started!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    f.draw.mockImplementation(async (...args: any[]) => {
      await args[6](async () => ({ ok: true }) as Response, new AbortController().signal);
      started(); await blocked;
      return Buffer.from('synthetic-shared-branch-image-not-quality-evidence');
    });
    const first = f.visuals.generateSample(f.work.id, f.request(f.clone.scene.sceneKey));
    try {
      await entered;
      await expect(Reflect.get(f.visuals, 'queue').sync(f.work.id)).resolves.toMatchObject({ eligibleWorkCount: 1, queuedCount: 0 });
      expect(await db.storyVisualGeneration.count({ where: { workId: f.work.id, sourceSceneKey: f.clone.scene.sceneKey } })).toBe(0);
      await expect(f.visuals.generateSample(f.work.id, f.request(f.source.scene.sceneKey)))
        .resolves.toMatchObject({ status: 'processing', sourceSceneKey: f.source.scene.sceneKey });
      expect(f.draw).toHaveBeenCalledTimes(1);
    } finally { release(); }
    await expect(first).resolves.toMatchObject({ status: 'ready', sourceSceneKey: f.clone.scene.sceneKey });
    expect(await db.storyVisualGeneration.count({ where: { workId: f.work.id } })).toBe(1);
  });

  it('blocks cached shared artwork after a new draft or revoked quality evidence without automatic redraw', async () => {
    const f = await sharedImageFixture();
    const original = await f.visuals.generateSample(f.work.id, f.request(f.source.scene.sceneKey));
    await f.service.save(f.owner.id, f.work.id, f.result.id, { ...f.data, idempotencyKey: randomUUID(), promptText: 'New draft.' });
    await expect(f.visuals.generateSample(f.work.id, f.request(f.clone.scene.sceneKey))).rejects.toMatchObject({ status: 409 });
    await expect(f.visuals.readyVisuals(f.work.id, f.release.id, [f.clone.scene.sceneKey])).resolves.toEqual(new Map());
    await db.storyReaderProgress.update({ where: { id: f.progresses[1].id }, data: { currentSceneId: null, currentGeneratedSceneId: f.clone.scene.id } });
    const stories = new StoryProductionService(db as never, f.economics, undefined, undefined, undefined, f.visuals);
    await expect(stories.currentProgress(f.second.id, f.progresses[1].id, 'ko')).resolves.toMatchObject({
      scene: { deliveryState: 'artwork_unavailable', visualGenerationAvailable: false, beats: [] }, choices: [],
    });
    await f.activation.revokeResult(f.owner.id, f.result.id, 'e'.repeat(64));
    const asset = await db.asset.findFirstOrThrow({ where: { storageKey: { startsWith: `story-visuals/${f.work.id}/` } } });
    await expect(f.visuals.publicVisualAsset(asset.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(original.status).toBe('ready'); expect(f.draw).toHaveBeenCalledTimes(1);
  });

  it('rechecks clone source after canonical generation rather than returning artwork for modified prose', async () => {
    const f = await sharedImageFixture();
    f.upload.mockImplementation(async () => {
      await db.storyAiGeneratedBeat.updateMany({ where: { sceneId: f.clone.scene.id }, data: { content: { ko: 'Changed while image was being stored.' } } });
      return { provider: 'r2', key: `story-visuals/${f.work.id}/${f.release.id}/${f.source.scene.sceneKey}/synthetic.webp` };
    });
    await expect(f.visuals.generateSample(f.work.id, f.request(f.clone.scene.sceneKey))).rejects.toMatchObject({ status: 409 });
    await expect(f.visuals.readyVisuals(f.work.id, f.release.id, [f.clone.scene.sceneKey])).resolves.toEqual(new Map());
    expect(f.draw).toHaveBeenCalledTimes(1);
    const generation = await db.storyVisualGeneration.findFirstOrThrow({ where: { workId: f.work.id } });
    expect(generation).toMatchObject({ sourceSceneKey: f.source.scene.sceneKey, status: 'ready', attemptCount: 1 });
  });

  it('connects shared artwork to the current reader scene without allowing another progress or source scene', async () => {
    const f = await sharedImageFixture();
    await f.visuals.generateSample(f.work.id, f.request(f.source.scene.sceneKey));
    await db.storyReaderProgress.update({ where: { id: f.progresses[1].id }, data: {
      currentSceneId: null, currentGeneratedSceneId: f.clone.scene.id } });
    await expect(f.visuals.requestForProgress(f.reader.id, f.progresses[1].id, f.clone.scene.sceneKey)).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.visuals.requestForProgress(f.second.id, f.progresses[1].id, f.source.scene.sceneKey)).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.visuals.requestForProgress(f.second.id, f.progresses[1].id, f.clone.scene.sceneKey))
      .resolves.toMatchObject({ status: 'ready', sourceSceneKey: f.clone.scene.sceneKey, reused: true });
    const stories = new StoryProductionService(db as never, f.economics, undefined, undefined, undefined, f.visuals);
    await expect(stories.currentProgress(f.second.id, f.progresses[1].id, 'ko')).resolves.toMatchObject({
      progressId: f.progresses[1].id, scene: { id: f.clone.scene.id, sceneKey: f.clone.scene.sceneKey,
        deliveryState: 'ready', visualGenerationAvailable: false,
        beats: [{ content: { value: 'Synthetic generated continuation.', locale: 'ko' } }],
        visualManifest: { background: { state: 'ready' } } },
    });
    await expect(f.visuals.readyVisuals(f.work.id, f.release.id, [f.clone.scene.sceneKey], `artist:${'f'.repeat(64)}`))
      .resolves.toEqual(new Map());
    expect(f.draw).toHaveBeenCalledTimes(1);
  });

  it('fails closed when shared routing is enabled without author branch review and keeps opt-out legacy generation unchanged', async () => {
    const f = await sharedImageFixture();
    f.values.STORY_BRANCH_VISUAL_REVIEW_ENABLED = 'false';
    await expect(f.visuals.generateSample(f.work.id, f.request(f.clone.scene.sceneKey)))
      .rejects.toMatchObject({ response: { code: 'STORY_BRANCH_VISUAL_REVIEW_APPROVAL_REQUIRED' } });
    expect(f.draw).not.toHaveBeenCalled();
    f.values.STORY_BRANCH_VISUAL_REVIEW_ENABLED = 'true';
    f.values.STORY_SHARED_BRANCH_VISUAL_REUSE_ENABLED = 'false';
    await expect(f.visuals.generateSample(f.work.id, f.request(f.clone.scene.sceneKey))).resolves.toMatchObject({ status: 'ready', reused: false });
    const jobs = await db.storyVisualGeneration.findMany({ where: { workId: f.work.id } });
    expect(jobs).toHaveLength(1); expect(jobs[0].sourceSceneKey).toBe(f.clone.scene.sceneKey);
  });

  it('repairs a missing origin prompt only on a checked generation request, not on reader projection', async () => {
    const f = await sharedImageFixture(false);
    const projected = await f.visuals.sharedBranchManifest(f.work.id, f.release.id, f.clone.scene.sceneKey, f.clone.scene.visualManifest);
    expect(projected).toMatchObject({ sceneKey: f.clone.scene.sceneKey });
    expect(await db.storyVisualPrompt.count({ where: { workId: f.work.id, sourceSceneKey: f.source.scene.sceneKey } })).toBe(0);
    await expect(f.visuals.sharedBranchManifest(f.work.id, f.release.id, f.clone.scene.sceneKey,
      { ...(f.clone.scene.visualManifest as Prisma.JsonObject), background: { state: 'ready', publicAssetPath: '/forged.webp' } }))
      .resolves.toBeNull();
    await expect(f.visuals.generateSample(f.work.id, f.request(f.clone.scene.sceneKey)))
      .resolves.toMatchObject({ status: 'ready', reused: false, sourceSceneKey: f.clone.scene.sceneKey });
    const restored = await db.storyVisualPrompt.findFirstOrThrow({ where: { workId: f.work.id, sourceSceneKey: f.source.scene.sceneKey } });
    await expect(db.$transaction(tx => f.service.approvedForGeneratedSource(tx, f.work.id, f.release.id,
      f.release.checksum, f.source.scene.sceneKey, restored.promptSha256))).resolves.toMatchObject({ promptText: f.data.promptText });
    expect(f.draw).toHaveBeenCalledTimes(1);
  });

  it('projects the first shared clone read before its prompt exists and lets the existing recovery prepare it', async () => {
    const f = await fixture(), data = await input(f), source = await register(f);
    const batch = await f.service.save(f.owner.id, f.work.id, f.result.id, data); await approve(f, data, batch);
    const receipt = await f.request(1);
    const clone = await db.storyAiGeneratedScene.findUniqueOrThrow({ where: { continuationId: receipt.continuationId } });
    const values: Record<string, string> = { STORY_BRANCH_VISUAL_REVIEW_ENABLED: 'true', STORY_SHARED_BRANCH_VISUAL_REUSE_ENABLED: 'true' };
    jest.spyOn(f.config, 'get').mockImplementation(key => values[key]);
    expect(await db.storyVisualPrompt.count({ where: { workId: f.work.id, sourceSceneKey: clone.sceneKey } })).toBe(0);
    await expect(f.visuals.sharedBranchManifest(f.work.id, f.release.id, clone.sceneKey, clone.visualManifest))
      .resolves.toMatchObject({ sceneKey: clone.sceneKey });
    expect(await db.storyVisualPrompt.count({ where: { workId: f.work.id, sourceSceneKey: clone.sceneKey } })).toBe(0);
    await db.storyReaderProgress.update({ where: { id: f.progresses[1].id }, data: { currentSceneId: null, currentGeneratedSceneId: clone.id } });
    const stories = new StoryProductionService(db as never, f.economics, undefined, undefined, undefined, f.visuals);
    await expect(stories.currentProgress(f.second.id, f.progresses[1].id, 'ko')).resolves.toMatchObject({
      scene: { sceneKey: clone.sceneKey, deliveryState: 'artwork_pending', visualGenerationAvailable: true },
    });
    expect(await db.storyVisualPrompt.count({ where: { workId: f.work.id, sourceSceneKey: clone.sceneKey } })).toBe(1);
    expect(await db.storyVisualGeneration.count({ where: { workId: f.work.id } })).toBe(0);
    expect((await db.storyAiGeneratedScene.findUniqueOrThrow({ where: { id: clone.id } })).visualManifest).toEqual(source.scene.visualManifest);
  });
});

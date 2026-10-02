import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import * as sharp from 'sharp';
import { normalizeCreatorGenerationProfile } from '../generation-profile/creator-generation-profile.policy';
import { StoryPublicationIntakeService } from './story-publication-intake.service';
import { preparePastedManuscript, storedManuscriptBody } from './story-manuscript-file.policy';
import { StoryProductionService } from './story-production.service';
import { StoryGenerationProfileService } from './story-generation-profile.service';
import { StoryStudioChoicePreparationService } from './story-studio-choice-preparation.service';
import { StoryStudioLinearService } from './story-studio-linear.service';
import { StoryStudioChoiceJobService } from './story-studio-choice-job.service';
import { StoryLifecycleService } from './story-lifecycle.service';
import { FIXED_ROUTE_STORIES } from './story-fixed-route-markdown.policy';
import { StoryVisualGenerationService } from './story-visual-generation.service';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

postgres('Private approved-source handoff (isolated PostgreSQL, synthetic AI)', () => {
  let db: PrismaClient;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
        parsed.username !== 'lumina_qa' || parsed.pathname !== '/lumina_chat_memory_qa' || parsed.search || parsed.hash) {
      throw new Error('Dedicated publication QA database required');
    }
    db = new PrismaClient({ datasources: { db: { url } } }); await db.$connect();
  });
  beforeEach(() => jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No provider network allowed')));
  afterEach(() => { try { expect(globalThis.fetch).not.toHaveBeenCalled(); } finally { jest.restoreAllMocks(); } });
  afterAll(async () => { await db?.$disconnect(); });

  async function fixture(submission = false) {
    const owner = await db.user.create({ data: {} });
    const texts = ['Private packaging notes.\r\n# Part 01. The ledger\r\nThe archivist opened a ledger.\r\n\r\n',
      '# Part 02. The door\r\nScene directions: no lettering.\r\nShe opened a door.\r\n'];
    const raw = texts.join('');
    const prepared = preparePastedManuscript(Buffer.from(raw), JSON.stringify({ locale: 'ko', confirmed: true,
      parts: texts.map((text, index) => ({ partKey: `part-${index + 1}`, title: ['The ledger', 'The door'][index],
        start: index ? texts[0].length : 0, end: index ? raw.length : text.length })) }));
    const receipt = submission ? await db.storyUploadSubmission.create({ data: {
      userId: owner.id, title: 'Private source', originalLocale: 'ko', sourceClass: 'new_manuscript',
      submissionType: 'novel', requestKeyHash: createHash('sha256').update(randomUUID()).digest('hex'),
      requestFingerprint: createHash('sha256').update(randomUUID()).digest('hex'),
      status: 'received', totalBytes: BigInt(Buffer.byteLength(raw)),
    } }) : null;
    const plan = { storyKey: 'monster', slug: `writer-intake-${randomUUID()}`, title: 'The private archive',
      summary: 'The archive story', coverPath: '/assets/story/monster.webp',
      sourceBindingSha256: createHash('sha256').update(randomUUID()).digest('hex'),
      writerIntakeWorkflow: 'writer_review_before_choices_v1', submissionId: receipt?.id,
      visualBible: { era: 'A modern Korean archive', artStyle: 'Original painted-ink style', palette: 'Gray and green',
        characters: [{ name: 'Archivist', appearance: 'Adult woman, black hair, green jacket' }], prohibited: ['poster montage'] },
      manuscript: { locale: prepared.locale, contentHash: prepared.contentHash, structuredBody: storedManuscriptBody(prepared) },
      parts: prepared.parts.map((part, index) => ({ partKey: part.partKey, title: part.title, actNumber: 1,
        position: index + 1, beats: [{ text: index ? 'She opened a door.' : 'The archivist opened a ledger.',
          sourceSceneKey: `${part.partKey}-main` }], choices: [{ choiceKey: 'next', position: 1,
          label: 'Follow the original', routeKind: 'writer_original', targetPartKey: index ? null : 'part-2',
          targetEndingKey: index ? 'author_main' : null }] })), prompts: [] };
    const service = new StoryPublicationIntakeService(db as never, {} as never);
    const job = await db.storyPublicationImportJob.create({ data: {
      actorUserId: owner.id, storyKey: 'monster', sourceBindingSha256: plan.sourceBindingSha256,
      planSnapshot: (service as any).storedPlan(plan),
    } });
    const provider = jest.spyOn(service as any, 'choiceProvider');
    return { owner, prepared, plan, job, service, provider, receipt };
  }

  it('stores source/intents/job atomically and exposes only the owner catalog, not the public catalog', async () => {
    const f = await fixture(true);
    const received = await f.service.processApprovedJob(f.owner.id, f.job.id);
    expect(received.status).toBe('awaiting_author_review');
    const work = await db.storyWork.findUniqueOrThrow({ where: { id: received.workId! } });
    expect(work).toMatchObject({ status: 'draft', activeReleaseId: null, publishedAt: null, ownerUserId: f.owner.id });
    const manuscript = await db.storyManuscriptVersion.findFirstOrThrow({ where: { workId: work.id } });
    expect(manuscript.structuredBody).toMatchObject({ intake: { source: { rawText: f.prepared.source.rawText } } });
    const intents = await db.storyBranchPreparationJob.findMany({ where: { workId: work.id }, orderBy: { partIndex: 'asc' } });
    expect(intents.map(row => row.status)).toEqual(['awaiting_author_consent', 'awaiting_author_consent']);
    expect(await db.storyRelease.count({ where: { workId: work.id } })).toBe(0);
    expect(await db.storyPart.count({ where: { workId: work.id } })).toBe(0);
    expect(await db.storyAnalysisJob.count({ where: { workId: work.id } })).toBe(0);
    expect(await db.storyStyleProfileConsent.findUnique({ where: { workId: work.id } })).toBeNull();
    expect(await db.storyWorkGenerationProfile.count({ where: { workId: work.id } })).toBe(0);
    expect(await db.storyUploadSubmission.findUniqueOrThrow({ where: { id: f.receipt!.id } }))
      .toMatchObject({ status: 'author_review', promotedWorkId: work.id });
    const production = new StoryProductionService(db as never);
    const own = await production.creatorCatalog(f.owner.id, { locale: 'ko', limit: 30 });
    expect(own.items).toEqual(expect.arrayContaining([expect.objectContaining({ workId: work.id })]));
    const other = await db.user.create({ data: {} });
    expect((await production.creatorCatalog(other.id, { locale: 'ko', limit: 30 })).items).toHaveLength(0);
    expect((await production.catalog(undefined, { locale: 'ko', limit: 30, q: work.slug })).items).toHaveLength(0);
    expect(f.provider).not.toHaveBeenCalled();
  }, 60000);

  it('replays without new versions and does not allow another administrator to acquire author ownership', async () => {
    const f = await fixture();
    const first = await f.service.processApprovedJob(f.owner.id, f.job.id);
    await expect(f.service.processApprovedJob(f.owner.id, f.job.id)).resolves.toEqual(first);
    await expect(f.service.processApprovedJob(randomUUID(), f.job.id)).rejects.toBeDefined();
    expect(await db.storyManuscriptVersion.count({ where: { workId: first.workId! } })).toBe(1);
    expect(await db.auditEvent.count({ where: { targetId: first.workId!, action: 'story_publication.private_writer_intake' } })).toBe(1);
    expect(f.provider).not.toHaveBeenCalled();
  }, 60000);

  it('cannot materialize choices without real completed analysis and author review', async () => {
    const f = await fixture(); const received = await f.service.processApprovedJob(f.owner.id, f.job.id);
    const manuscript = await db.storyManuscriptVersion.findFirstOrThrow({ where: { workId: received.workId! } });
    const choices = new StoryStudioChoicePreparationService(db as never);
    const studio = new StoryStudioLinearService(db as never, choices);
    const generate = jest.spyOn(choices as any, 'provider');
    await expect(studio.materialize(f.owner.id, received.workId!, {
      manuscriptVersionId: manuscript.id, expectedManuscriptHash: manuscript.contentHash,
      originalRoutesReviewed: true, originalRoutes: f.prepared.parts.map(part => ({ partKey: part.partKey })),
    })).rejects.toMatchObject({ response: { code: 'STUDIO_LINEAR_FINAL_REVIEW_REQUIRED' } });
    expect(await db.storyPart.count({ where: { workId: received.workId! } })).toBe(0);
    expect(generate).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
  }, 60000);

  it('rolls back work/manuscript/intents when a stale submission cannot be bound', async () => {
    const f = await fixture(true);
    await db.storyUploadSubmission.update({ where: { id: f.receipt!.id }, data: { userId: (await db.user.create({ data: {} })).id } });
    await expect(f.service.processApprovedJob(f.owner.id, f.job.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_PUBLICATION_SUBMISSION_CHANGED' }) });
    expect(await db.storyWork.findUnique({ where: { slug: f.plan.slug } })).toBeNull();
    expect(await db.storyPublicationImportJob.findUniqueOrThrow({ where: { id: f.job.id } }))
      .toMatchObject({ status: 'queued', workId: null, releaseId: null });
    expect(await db.storyBranchPreparationJob.count({ where: { ownerUserId: f.owner.id } })).toBe(0);
    expect(f.provider).not.toHaveBeenCalled();
  }, 60000);

  it('does not create duplicate work during overlapping processing', async () => {
    const f = await fixture();
    const first = f.service.processApprovedJob(f.owner.id, f.job.id);
    const second = f.service.processApprovedJob(f.owner.id, f.job.id);
    const results = await Promise.allSettled([first, second]);
    expect(results.some(result => result.status === 'fulfilled')).toBe(true);
    const replay = await f.service.processApprovedJob(f.owner.id, f.job.id);
    expect(replay.status).toBe('awaiting_author_review');
    expect(await db.storyWork.count({ where: { slug: f.plan.slug } })).toBe(1);
    expect(await db.storyManuscriptVersion.count({ where: { workId: replay.workId! } })).toBe(1);
    expect(f.provider).not.toHaveBeenCalled();
  }, 60000);

  async function laterReceiptFixture() {
    const f = await fixture(true);
    delete f.plan.submissionId;
    await db.storyPublicationImportJob.update({ where: { id: f.job.id },
      data: { planSnapshot: (f.service as any).storedPlan(f.plan) } });
    await db.storyUploadSubmissionFile.createMany({ data: [FIXED_ROUTE_STORIES.monster.manuscriptSha256,
      FIXED_ROUTE_STORIES.monster.promptSha256].map((checksumSha256, position) => ({
        submissionId: f.receipt!.id, category: 'manuscript', position, extension: 'md',
        clientFileNameHash: 'a'.repeat(64), mimeType: 'text/markdown', fileSizeBytes: BigInt(32),
        checksumSha256, storageProvider: 'local', storageKey: `qa-only/${randomUUID()}`,
      })) });
    const first = await f.service.processApprovedJob(f.owner.id, f.job.id);
    return { ...f, first };
  }

  it('links a later matching source receipt atomically and keeps the private work and manuscript unchanged', async () => {
    const f = await laterReceiptFixture();
    await expect((f.service as any).stagePrivateIntake(f.owner.id, f.job.id, f.receipt!.id)).resolves.toEqual(f.first);
    await expect((f.service as any).stagePrivateIntake(f.owner.id, f.job.id, f.receipt!.id)).resolves.toEqual(f.first);
    expect(await db.storyUploadSubmission.findUniqueOrThrow({ where: { id: f.receipt!.id } })).toMatchObject({
      promotedWorkId: f.first.workId, status: 'author_review' });
    const job = await db.storyPublicationImportJob.findUniqueOrThrow({ where: { id: f.job.id } });
    expect((f.service as any).readStoredPlan(job.planSnapshot).submissionId).toBe(f.receipt!.id);
    expect(await db.storyManuscriptVersion.count({ where: { workId: f.first.workId! } })).toBe(1);
    expect(await db.auditEvent.count({ where: { targetId: f.first.workId!,
      action: 'story_publication.private_submission_attached' } })).toBe(1);
    expect(f.provider).not.toHaveBeenCalled();
  }, 60000);

  it('rolls a later receipt attachment back if manuscript binding validation fails afterward', async () => {
    const f = await laterReceiptFixture();
    await db.storyManuscriptVersion.updateMany({ where: { workId: f.first.workId! }, data: { contentHash: 'f'.repeat(64) } });
    await expect((f.service as any).stagePrivateIntake(f.owner.id, f.job.id, f.receipt!.id)).rejects.toBeDefined();
    expect(await db.storyUploadSubmission.findUniqueOrThrow({ where: { id: f.receipt!.id } })).toMatchObject({
      promotedWorkId: null, status: 'received' });
    const job = await db.storyPublicationImportJob.findUniqueOrThrow({ where: { id: f.job.id } });
    expect((f.service as any).readStoredPlan(job.planSnapshot).submissionId).toBeUndefined();
    expect(await db.auditEvent.count({ where: { targetId: f.first.workId!,
      action: 'story_publication.private_submission_attached' } })).toBe(0);
    expect(f.provider).not.toHaveBeenCalled();
  }, 60000);

  it('keeps original packaging private through approved settings, three choices and writer publication', async () => {
    const f = await fixture(); const received = await f.service.processApprovedJob(f.owner.id, f.job.id);
    const workId = received.workId!;
    const manuscript = await db.storyManuscriptVersion.findFirstOrThrow({ where: { workId } });
    const rate = await db.storyAiRateCard.create({ data: { version: `offline-private-${randomUUID()}`,
      provider: 'offline', model: 'synthetic', status: 'active', inputCostPerMillion: 0,
      outputCostPerMillion: 0, createdByUserId: f.owner.id } });
    const analysis = await db.storyAnalysisJob.create({ data: { workId, manuscriptVersionId: manuscript.id,
      actorUserId: f.owner.id, analysisVersion: 1, idempotencyKey: randomUUID(), status: 'completed',
      pipeline: 'semantic_extraction_v1', sourceContentHash: manuscript.contentHash, sourceLocale: 'ko',
      sourceDigest: manuscript.contentHash, configHash: manuscript.contentHash, rateCardId: rate.id,
      totalParagraphs: f.prepared.paragraphCount, plannedParagraphs: f.prepared.paragraphCount,
      completedParagraphs: f.prepared.paragraphCount } });
    await db.storyAnalysisEvidence.create({ data: { analysisJobId: analysis.id, provenance: 'semantic_candidate',
      sequence: 1, evidenceType: 'style', sourcePartKey: 'part-1', sourceParagraphIndex: 0,
      payload: { title: 'Narration', observation: 'Restrained third-person archive narration.', styleCategory: 'narration' } } });
    const profiles = new StoryGenerationProfileService(db as never);
    const draft = await profiles.getOrCreate(f.owner.id, workId);
    const settings = normalizeCreatorGenerationProfile('story', draft.profile.draftSettings);
    const direction = settings.sections.find(section => section.key === 'visual_direction')!;
    expect(direction.value.visualBible).toMatchObject({ artStyle: 'Original painted-ink style' });
    direction.value.visualBible = { ...(direction.value.visualBible as Record<string, unknown>), artStyle: 'Author revised charcoal illustration' };
    direction.value.visualReviewVersion = 'story-visual-review-v1';
    const reviewed = await profiles.update(f.owner.id, workId, { settings: {
      ...settings, sections: settings.sections.map(section => ({ ...section, decision: 'accepted' as const })) } });
    await profiles.approve(f.owner.id, workId, { expectedDraftFingerprint: reviewed.profile.draftFingerprint! });
    const review = await db.storyWriterReview.create({ data: { workId, ownerUserId: f.owner.id,
      manuscriptVersionId: manuscript.id, analysisJobId: analysis.id, state: 'submitted' } });
    await db.storyFinalSubmission.create({ data: { reviewId: review.id, manuscriptVersionId: manuscript.id,
      idempotencyKey: randomUUID(), checksum: manuscript.contentHash } });
    await db.storyStyleProfileConsent.create({ data: { workId, ownerUserId: f.owner.id,
      manuscriptVersionId: manuscript.id, rightsConfirmed: true, aiBranchAllowed: true, imageTransformationAllowed: true,
      allowedLocales: ['ko'], startsAt: new Date(0) } });
    const choices = new StoryStudioChoicePreparationService(db as never);
    const studio = new StoryStudioLinearService(db as never, choices);
    const candidate = await studio.materialize(f.owner.id, workId, {
      manuscriptVersionId: manuscript.id, expectedManuscriptHash: manuscript.contentHash,
      originalRoutesReviewed: true, originalRoutes: f.prepared.parts.map(part => ({ partKey: part.partKey })),
    });
    const prompts = await db.storyVisualPrompt.findMany({ where: { workId, releaseId: candidate.releaseId }, orderBy: { sourceSceneKey: 'asc' } });
    expect(prompts).toHaveLength(2);
    expect(prompts.map(prompt => prompt.sourceSceneKey)).toEqual(['part-1-main', 'part-2-main']);
    expect(prompts.every(prompt => prompt.sourceKind === 'studio_reviewed')).toBe(true);
    expect(prompts.map(prompt => prompt.promptText).join('')).not.toMatch(/Private packaging notes|Scene directions|Part 0/);
    expect(await db.storyVisualGeneration.count({ where: { workId } })).toBe(0);

    const generate = jest.fn(async (input: { generationProfile: { sections: unknown[] };
      parts: Array<{ partKey: string; context: string; nextPartExcerpt: string }> }) => {
      expect(input.generationProfile.sections.length).toBeGreaterThan(0);
      expect(JSON.stringify(input.parts)).not.toMatch(/packaging|Scene directions|Part 0/);
      return input.parts.map(part => ({ partKey: part.partKey, originalChoiceLabel: 'Follow the original',
        alternatives: ['Hide the ledger', 'Reveal the ledger'] }));
    });
    jest.spyOn(choices as any, 'provider').mockReturnValue({ generate });
    const worker = new StoryStudioChoiceJobService(db as never, choices);
    jest.spyOn(worker as any, 'claim').mockImplementation(async () => {
      const job = await db.storyStudioChoiceJob.findUniqueOrThrow({ where: { releaseId: candidate.releaseId } });
      const leaseToken = randomUUID();
      const changed = await db.storyStudioChoiceJob.updateMany({ where: { id: job.id, status: 'queued' },
        data: { status: 'processing', leaseToken, leaseExpiresAt: new Date(Date.now() + 300000) } });
      return changed.count === 1 ? { id: job.id, leaseToken } : null;
    });
    expect(await worker.executeOne()).toBe('progress'); expect(await worker.executeOne()).toBe('progress');
    expect(await worker.executeOne()).toBe('completed');
    expect(await studio.finish(f.owner.id, workId, candidate.releaseId)).toMatchObject({ ready: true });
    const lifecycle = new StoryLifecycleService(db as never);
    for (const toStatus of ['intake_received', 'reviewing', 'release_ready', 'published']) {
      const current = await db.storyWork.findUniqueOrThrow({ where: { id: workId } });
      await lifecycle.transitionPublication(f.owner.id, workId, { toStatus, expectedRevision: current.releaseRevision,
        ...(toStatus === 'published' ? { releaseId: candidate.releaseId } : {}) }, randomUUID());
    }
    const beats = await db.storyBeat.findMany({ where: { sceneId: { in: candidate.scenes.map(scene => scene.sceneId) } },
      orderBy: [{ sceneId: 'asc' }, { position: 'asc' }] });
    expect(beats.map(beat => (beat.content as { ko: string }).ko).sort()).toEqual([
      'The archivist opened a ledger.', 'She opened a door.' ].sort());
    expect(await db.storyChoice.count({ where: { sceneId: { in: candidate.scenes.map(scene => scene.sceneId) } } })).toBe(6);
    expect((await db.storyManuscriptVersion.findUniqueOrThrow({ where: { id: manuscript.id } })).structuredBody)
      .toMatchObject({ intake: { source: { rawText: f.prepared.source.rawText } } });
    expect(await db.storyWork.findUniqueOrThrow({ where: { id: workId } })).toMatchObject({ status: 'published' });
    const visualConfig: Record<string, string> = {
      STORY_IMAGE_GENERATION_ENABLED: 'true', OPENAI_API_KEY: 'synthetic-no-network',
      OPENAI_STORY_SCENE_IMAGE_SIZE: '1024x1536', OBJECT_STORAGE_PROVIDER: 'r2',
      OBJECT_STORAGE_BUCKET: 'synthetic-bucket', OBJECT_STORAGE_ACCESS_KEY_ID: 'synthetic-key',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'synthetic-secret', OBJECT_STORAGE_ENDPOINT: 'https://storage.example.invalid',
    };
    const visuals = new StoryVisualGenerationService(db as never, { get: (key: string) => visualConfig[key] } as never);
    const activeRelease = await db.storyRelease.findUniqueOrThrow({ where: { id: candidate.releaseId } });
    const bible = await (visuals as any).visualBible(workId, activeRelease.id, activeRelease.checksum);
    expect(bible.privatePrompt).toContain('Author revised charcoal illustration');
    expect(bible.privatePrompt).toContain('Archivist: Adult woman, black hair, green jacket');
    expect(bible.privatePrompt).not.toContain('Original painted-ink style');
    expect(bible.approvalFingerprint).toMatch(/^[a-f0-9]{64}$/);
    const image = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#456745' } }).webp().toBuffer();
    jest.spyOn(visuals as any, 'approvedStoryCoverReference').mockResolvedValue({ image,
      checksum: createHash('sha256').update(image).digest('hex'), mimeType: 'image/webp', filename: 'synthetic-cover.webp' });
    const imageProvider = jest.spyOn(visuals as any, 'generateImage').mockResolvedValue(image);
    const imageStorage = jest.spyOn(visuals as any, 'uploadImage').mockResolvedValue({
      provider: 'database', key: 'synthetic-image', inlineBase64: image.toString('base64'),
    });
    const rendered = await (visuals as any).generate(workId, activeRelease.id, activeRelease.checksum, 'part-1-main');
    expect(rendered).toMatchObject({ status: 'ready', reused: false });
    expect(String(imageProvider.mock.calls[0][0])).toContain('Author revised charcoal illustration');
    expect(String(imageProvider.mock.calls[0][0])).toContain('Archivist: Adult woman, black hair, green jacket');
    const ready = await visuals.readyVisuals(workId, activeRelease.id, ['part-1-main']);
    expect(ready.get('part-1-main')).toMatchObject({ publicAssetPath: rendered.publicAssetPath });
    await expect((visuals as any).generate(workId, activeRelease.id, activeRelease.checksum, 'part-1-main'))
      .resolves.toMatchObject({ status: 'ready', reused: true });
    expect(imageProvider).toHaveBeenCalledTimes(1); expect(imageStorage).toHaveBeenCalledTimes(1);
    const visualRow = await db.storyVisualGeneration.findFirstOrThrow({ where: { workId, sourceSceneKey: 'part-1-main' } });
    expect(await visuals.publicVisualAsset(visualRow.assetId!)).toMatchObject({ kind: 'inline', mimeType: 'image/webp', image });
    imageStorage.mockImplementationOnce(async () => {
      await db.storyStyleProfileConsent.update({ where: { workId }, data: { imageTransformationAllowed: false, revision: { increment: 1 } } });
      return { provider: 'database', key: 'synthetic-image', inlineBase64: image.toString('base64') };
    });
    await expect((visuals as any).generate(workId, activeRelease.id, activeRelease.checksum, 'part-2-main'))
      .resolves.toMatchObject({ status: 'failed', retryable: false });
    expect(await db.storyVisualGeneration.findFirstOrThrow({ where: { workId, sourceSceneKey: 'part-2-main' } }))
      .toMatchObject({ status: 'failed', assetId: null, attemptCount: 1, lastErrorCode: 'STORY_VISUAL_PROFILE_CHANGED' });
    expect(await db.asset.count({ where: { metadata: { path: ['storyVisual', 'workId'], equals: workId } } })).toBe(1);
    expect(imageProvider).toHaveBeenCalledTimes(2); expect(imageStorage).toHaveBeenCalledTimes(2);
    await expect(visuals.readyVisuals(workId, activeRelease.id, ['part-1-main'])).resolves.toEqual(new Map());
    await expect(visuals.promptKeys(workId, activeRelease.id, ['part-1-main', 'part-2-main'])).resolves.toEqual(new Set());
    await expect((visuals as any).visualBible(workId, activeRelease.id, activeRelease.checksum))
      .rejects.toMatchObject({ response: { code: 'STORY_VISUAL_PROFILE_CHANGED' } });
    await expect(f.service.processApprovedJob(f.owner.id, f.job.id)).resolves.toMatchObject({
      status: 'published', workId, releaseId: candidate.releaseId });
    expect(await db.storyPublicationImportJob.findUniqueOrThrow({ where: { id: f.job.id } })).toMatchObject({
      status: 'published', planSnapshot: null });
    expect(generate).toHaveBeenCalledTimes(2); expect(f.provider).not.toHaveBeenCalled();
  }, 60000);
});

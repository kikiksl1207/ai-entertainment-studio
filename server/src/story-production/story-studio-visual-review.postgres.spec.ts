import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { normalizeCreatorGenerationProfile } from '../generation-profile/creator-generation-profile.policy';
import { StoryGenerationProfileService } from './story-generation-profile.service';
import { releaseChecksum } from './story-lifecycle.policy';
import { preparePastedManuscript, storedManuscriptBody } from './story-manuscript-file.policy';
import { publicationReaderProjection } from './story-publication-reader-projection.policy';
import { publicationVisualSceneBindings } from './story-publication-visual-binding.policy';
import { StoryStudioChoicePreparationService } from './story-studio-choice-preparation.service';
import { StoryStudioVisualReviewService } from './story-studio-visual-review.service';
import { StoryVisualGenerationService } from './story-visual-generation.service';
import { linearPartPlan, sourceOf } from './story-studio-linear.service';
import { studioSceneVisualPrompt } from './story-approved-visual.policy';
import { studioManuscriptVisualReviewSource } from './story-studio-visual-source.policy';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

postgres('Author scene guidance batches (isolated PostgreSQL, no provider)', () => {
  let db: PrismaClient;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
        parsed.username !== 'lumina_qa' || parsed.pathname !== '/lumina_story_qa' || parsed.search || parsed.hash) {
      throw new Error('Dedicated story QA database required');
    }
    expect(process.env.NODE_ENV).toBe('test');
    db = new PrismaClient({ datasources: { db: { url } } }); await db.$connect();
  });
  beforeEach(() => jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Paid/provider calls are forbidden in this QA')));
  afterEach(() => { try { expect(globalThis.fetch).not.toHaveBeenCalled(); } finally { jest.restoreAllMocks(); } });
  afterAll(async () => { await db?.$disconnect(); });

  async function fixture(importGuides = true, retainSceneMarkers = false) {
    const owner = await db.user.create({ data: {} });
    const work = await db.storyWork.create({ data: { ownerUserId: owner.id, slug: `scene-review-qa-${randomUUID()}`,
      title: { ko: '격리 검증 장면' }, summary: {} } });
    const texts = [retainSceneMarkers ? '[장면 1]\n주인공은 봉인된 기록을 펼쳤다.' : '주인공은 봉인된 기록을 펼쳤다.',
      '주인공은 기록을 지닌 채 마지막 방에 들어갔다.'];
    const raw = texts.join('\n\n'), split = texts[0].length + 2;
    const prepared = preparePastedManuscript(Buffer.from(raw), JSON.stringify({ locale: 'ko', confirmed: true,
      parts: [{ partKey: 'part-1', title: '기록', start: 0, end: split }, { partKey: 'part-2', title: '방', start: split, end: raw.length }] }));
    const planned = prepared.parts.map((part, index) => ({ partKey: part.partKey, title: part.title,
      beats: [{ text: texts[index], sourceSceneKey: `source-${index}` }] }));
    const projection = publicationReaderProjection(prepared.contentHash, prepared.parts, planned);
    const prompts = texts.map((_, index) => {
      const promptText = `PRIVATE ORIGINAL ${index}: the same archivist opens a sealed ledger in the archive.`;
      return { sourceSceneKey: `source-${index}`, promptText, promptSha256: createHash('sha256').update(promptText).digest('hex') };
    });
    const reference = { contract: 'publication-visual-source-v1', approvalState: 'reference_only', sourceBindingSha256: 'f'.repeat(64),
      prompts, sceneBindings: publicationVisualSceneBindings(prepared.contentHash, prepared.parts, projection, planned, prompts) };
    const structuredBody = importGuides ? { ...storedManuscriptBody(prepared),
      publicationReaderProjection: projection, publicationVisualSource: { ...reference, checksum: releaseChecksum(reference) } }
      : storedManuscriptBody(prepared);
    const visualView = studioManuscriptVisualReviewSource(structuredBody, prepared.contentHash,
      sourceOf({ locale: 'ko', contentHash: prepared.contentHash, structuredBody }));
    const checksum = visualView.reference.checksum;
    const reviewPrompts = (visualView.body as any).publicationVisualSource.prompts;
    const manuscript = await db.storyManuscriptVersion.create({ data: { workId: work.id, ownerUserId: owner.id,
      version: 1, locale: 'ko', contentHash: prepared.contentHash, structuredBody } });
    const rateCard = await db.storyAiRateCard.create({ data: { version: `offline-scene-review-${randomUUID()}`, provider: 'offline',
      model: 'fixture', status: 'active', inputCostPerMillion: 0, outputCostPerMillion: 0, createdByUserId: owner.id } });
    const analysis = await db.storyAnalysisJob.create({ data: { workId: work.id, manuscriptVersionId: manuscript.id,
      analysisVersion: 1, idempotencyKey: randomUUID(), status: 'completed', pipeline: 'semantic_extraction_v1',
      sourceContentHash: prepared.contentHash, sourceLocale: 'ko', actorUserId: owner.id, rateCardId: rateCard.id,
      sourceDigest: prepared.contentHash, configHash: prepared.contentHash, totalParagraphs: prepared.paragraphCount,
      completedParagraphs: prepared.paragraphCount, plannedParagraphs: prepared.paragraphCount } });
    await db.storyAnalysisEvidence.create({ data: { analysisJobId: analysis.id, provenance: 'semantic_candidate', sequence: 1,
      evidenceType: 'style', sourcePartKey: 'part-1', sourceParagraphIndex: 0,
      payload: { title: '문체', observation: '담담한 1인칭 서술.', styleCategory: 'narration' } } });
    const profiles = new StoryGenerationProfileService(db as never);
    const draft = await profiles.getOrCreate(owner.id, work.id);
    const settings = normalizeCreatorGenerationProfile('story', draft.profile.draftSettings);
    const reviewed = await profiles.update(owner.id, work.id, { settings: { ...settings,
      sections: settings.sections.map(section => ({ ...section, decision: 'accepted' as const })) } });
    await profiles.approve(owner.id, work.id, { expectedDraftFingerprint: reviewed.profile.draftFingerprint! });
    const service = new StoryStudioVisualReviewService(db as never, new StoryStudioChoicePreparationService(db as never));
    const readIdentity = { expectedManuscriptHash: prepared.contentHash, expectedSourceChecksum: checksum };
    const context = await service.review(owner.id, work.id, manuscript.id, 0, readIdentity);
    const identity = { ...readIdentity, expectedProfilePinHash: context.profilePinHash };
    const input = { ...identity, idempotencyKey: randomUUID(), entries: [{ referenceIndex: 0, sourceSceneKey: reviewPrompts[0].sourceSceneKey,
      originalPromptSha256: reviewPrompts[0].promptSha256, promptText: '작가가 직접 수정한 세로 장면. 같은 인물과 방, 시간대를 유지한다.' }] };
    return { owner, work, manuscript, profiles, service, readIdentity, identity, input, importGuides };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const save = (f: Fixture, input = f.input) => f.service.save(f.owner.id, f.work.id, f.manuscript.id, input);
  const approve = (f: Fixture, batch: Awaited<ReturnType<typeof save>>) => f.service.approve(f.owner.id, f.work.id, f.manuscript.id, batch.batchId,
    { ...f.identity, expectedBatchChecksum: batch.batchChecksum, expectedRevision: batch.revision, scenesReviewed: true });

  it('stores draft, approves explicitly and reuses exact saved text without changing original source or publishing', async () => {
    const f = await fixture(), saved = await save(f);
    expect(saved).toMatchObject({ status: 'draft', revision: 1, approvedAt: null, generationStarted: false, published: false });
    await expect(f.service.approvedForReference(f.owner.id, f.work.id, f.manuscript.id, 0, f.identity))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_APPROVAL_REQUIRED' } });
    expect((await approve(f, saved)).status).toBe('approved');
    expect(await f.service.approvedForReference(f.owner.id, f.work.id, f.manuscript.id, 0, f.identity))
      .toMatchObject({ promptText: f.input.entries[0].promptText, batchId: saved.batchId, approvedByUserId: f.owner.id });
    expect((await db.storyManuscriptVersion.findUniqueOrThrow({ where: { id: f.manuscript.id } })).structuredBody).toEqual(f.manuscript.structuredBody);
    expect(await db.storyVisualGeneration.count({ where: { workId: f.work.id } })).toBe(0);
    expect(await db.storyRelease.count({ where: { workId: f.work.id } })).toBe(0);
    expect((await db.storyWork.findUniqueOrThrow({ where: { id: f.work.id } })).status).toBe('draft');
    expect(await db.storyStyleProfileConsent.count({ where: { workId: f.work.id } })).toBe(0);
    const audits = await db.auditEvent.findMany({ where: { targetId: saved.batchId } });
    expect(audits).toHaveLength(2); expect(JSON.stringify(audits)).not.toContain(f.input.entries[0].promptText);
  });

  it('concurrent duplicate saves/approvals leave one batch, one version and exactly two audit events', async () => {
    const f = await fixture();
    const saves = await Promise.allSettled([save(f), save(f)]);
    expect(saves.some(result => result.status === 'fulfilled')).toBe(true);
    const saved = await save(f);
    expect(await db.storySceneVisualReviewBatch.count({ where: { workId: f.work.id } })).toBe(1);
    const approvals = await Promise.allSettled([approve(f, saved), approve(f, saved)]);
    expect(approvals.some(result => result.status === 'fulfilled')).toBe(true);
    await approve(f, saved);
    expect(await db.auditEvent.count({ where: { targetId: saved.batchId } })).toBe(2);
    expect(await db.storySceneVisualReviewBatch.findUnique({ where: { id: saved.batchId } }))
      .toMatchObject({ batchVersion: 1, revision: 2, status: 'approved' });
  });

  it('a newer draft blocks older approval and reuse but leaves the original immutable approved batch intact', async () => {
    const f = await fixture(), old = await save(f); await approve(f, old);
    const latest = await save(f, { ...f.input, idempotencyKey: randomUUID(), entries: [{ ...f.input.entries[0], promptText: '다음 수정안' }] });
    expect(latest.batchVersion).toBe(2);
    await expect(approve(f, old)).rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_BATCH_SUPERSEDED' } });
    await expect(f.service.approvedForReference(f.owner.id, f.work.id, f.manuscript.id, 0, f.identity))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_APPROVAL_REQUIRED' } });
    expect((await f.service.review(f.owner.id, f.work.id, f.manuscript.id, 0, f.readIdentity)).batch?.batchId).toBe(latest.batchId);
    expect((await db.storySceneVisualReviewBatch.findUniqueOrThrow({ where: { id: old.batchId } })).status).toBe('approved');
  });

  it('same settings reapproved under a new profile identity cannot approve/reuse the old saved guidance', async () => {
    const f = await fixture(), saved = await save(f);
    const current = await f.profiles.getOrCreate(f.owner.id, f.work.id);
    const settings = normalizeCreatorGenerationProfile('story', current.profile.draftSettings);
    const revised = await f.profiles.update(f.owner.id, f.work.id, { settings });
    await f.profiles.approve(f.owner.id, f.work.id, { expectedDraftFingerprint: revised.profile.draftFingerprint! });
    const context = await f.service.review(f.owner.id, f.work.id, f.manuscript.id, 0, f.readIdentity);
    expect(context.profilePinHash).not.toBe(f.identity.expectedProfilePinHash); expect(context.batch).toBeNull();
    await expect(approve(f, saved)).rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_PROFILE_CHANGED' } });
    await expect(f.service.approvedForReference(f.owner.id, f.work.id, f.manuscript.id, 0, f.identity))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_PROFILE_CHANGED' } });
  });

  it('the SQL state constraint rejects claimed approval without an approving owner', async () => {
    const f = await fixture(), saved = await save(f);
    await expect(db.storySceneVisualReviewBatch.update({ where: { id: saved.batchId },
      data: { status: 'approved', revision: 2, approvedAt: new Date() } })).rejects.toBeDefined();
    expect((await db.storySceneVisualReviewBatch.findUniqueOrThrow({ where: { id: saved.batchId } })).status).toBe('draft');
  });

  it('an audit write failure rolls back the newly saved batch and allows the same request to retry', async () => {
    const f = await fixture();
    const failingDb = new Proxy(db, { get(target, key) {
      if (key !== '$transaction') return Reflect.get(target, key);
      return (callback: (tx: unknown) => Promise<unknown>, options: any) => db.$transaction(tx => callback(new Proxy(tx, {
        get(source, field) { return field === 'auditEvent' ? { create: async () => { throw new Error('synthetic audit failure'); } } : Reflect.get(source, field); },
      })), options);
    } });
    const failing = new StoryStudioVisualReviewService(failingDb as never, new StoryStudioChoicePreparationService(db as never));
    await expect(failing.save(f.owner.id, f.work.id, f.manuscript.id, f.input))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_SAVE_UNCONFIRMED' } });
    expect(await db.storySceneVisualReviewBatch.count({ where: { workId: f.work.id } })).toBe(0);
    expect((await save(f)).batchVersion).toBe(1);
  });

  async function publishFixture(f: Fixture, studio = false) {
    const release = await db.storyRelease.create({ data: { workId: f.work.id, version: 1, status: 'active',
      manuscriptVersionId: f.manuscript.id, branchGraphSnapshot: studio ? { contract: 'studio-linear-v1',
        parts: sourceOf(f.manuscript).parts.map(part => ({ partKey: part.partKey })) } : {}, endingSetSnapshot: {}, sceneAssetManifest: {},
      localizedDisplaySnapshot: {}, checksum: 'a'.repeat(64), createdByUserId: f.owner.id } });
    await db.storyWork.update({ where: { id: f.work.id }, data: { status: 'published', fixtureSource: false, activeReleaseId: release.id } });
    const original = (f.manuscript.structuredBody as any).publicationVisualSource.prompts[0];
    const prompt = await db.storyVisualPrompt.create({ data: { workId: f.work.id, releaseId: release.id, releaseChecksum: release.checksum,
      sourceSceneKey: original.sourceSceneKey, promptText: original.promptText, promptSha256: original.promptSha256,
      sourceKind: 'admin_verified', sourceBindingSha256: f.readIdentity.expectedSourceChecksum } });
    return { release, prompt };
  }

  async function publishPartFixture(f: Fixture, partKey = 'part-1') {
    const published = await publishFixture(f, true), prepared = sourceOf(f.manuscript);
    const part = linearPartPlan(prepared, prepared.parts.map(part => ({ partKey: part.partKey }))).find(part => part.partKey === partKey)!;
    const promptText = studioSceneVisualPrompt(part.title, part.text);
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');
    const prompt = await db.storyVisualPrompt.create({ data: { workId: f.work.id, releaseId: published.release.id,
      releaseChecksum: published.release.checksum, sourceSceneKey: `${partKey}-main`, promptText, promptSha256: sha(promptText),
      sourceKind: 'studio_reviewed', sourceBindingSha256: releaseChecksum({ manuscriptId: f.manuscript.id,
        manuscriptHash: f.manuscript.contentHash, partKey, textSha256: sha(part.text) }) } });
    return { ...published, prompt };
  }

  const selectInput = (f: Fixture, batch: Awaited<ReturnType<typeof save>>, version = 0) => ({ ...f.identity,
    mode: 'select' as const, idempotencyKey: randomUUID(), expectedSelectionVersion: version,
    batchId: batch.batchId, expectedBatchChecksum: batch.batchChecksum, representativeReviewed: true });

  async function publishOrdinaryFixture(f: Fixture) {
    const prepared = sourceOf(f.manuscript), parts = linearPartPlan(prepared, prepared.parts.map(part => ({ partKey: part.partKey })));
    const release = await db.storyRelease.create({ data: { workId: f.work.id, version: 1, status: 'active',
      manuscriptVersionId: f.manuscript.id, branchGraphSnapshot: { contract: 'studio-linear-v1', parts: parts.map(part => ({ partKey: part.partKey })) },
      endingSetSnapshot: {}, sceneAssetManifest: {}, localizedDisplaySnapshot: {}, checksum: 'a'.repeat(64), createdByUserId: f.owner.id } });
    await db.storyWork.update({ where: { id: f.work.id }, data: { status: 'published', fixtureSource: false, activeReleaseId: release.id } });
    const part = parts[0], promptText = studioSceneVisualPrompt(part.title, part.text);
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');
    const prompt = await db.storyVisualPrompt.create({ data: { workId: f.work.id, releaseId: release.id,
      releaseChecksum: release.checksum, sourceSceneKey: `${part.partKey}-main`, promptText, promptSha256: sha(promptText),
      sourceKind: 'studio_reviewed', sourceBindingSha256: releaseChecksum({ manuscriptId: f.manuscript.id,
        manuscriptHash: f.manuscript.contentHash, partKey: part.partKey, textSha256: sha(part.text) }) } });
    return { release, prompt };
  }

  async function bookingFixture(part = true, importGuides = true) {
    const f = await fixture(importGuides), saved = await save(f); await approve(f, saved);
    const { release, prompt } = !importGuides ? await publishOrdinaryFixture(f) : part ? await publishPartFixture(f) : await publishFixture(f);
    await db.storyStyleProfileConsent.create({ data: { workId: f.work.id, ownerUserId: f.owner.id, manuscriptVersionId: f.manuscript.id,
      rightsConfirmed: true, aiBranchAllowed: true, imageTransformationAllowed: true, allowedLocales: ['ko'], startsAt: new Date(0) } });
    const config: Record<string, string> = { STORY_IMAGE_GENERATION_ENABLED: 'true', OPENAI_API_KEY: 'synthetic-not-a-key',
      STORY_IMAGE_QUEUE_RELEASES: JSON.stringify([{ workId: f.work.id, releaseId: release.id, releaseChecksum: release.checksum }]),
      OBJECT_STORAGE_PROVIDER: 'r2', OBJECT_STORAGE_BUCKET: 'fixture', OBJECT_STORAGE_ACCESS_KEY_ID: 'synthetic',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'synthetic', OBJECT_STORAGE_ENDPOINT: 'https://storage.example.test', OPENAI_STORY_SCENE_IMAGE_SIZE: '1024x1536' };
    const visuals = new StoryVisualGenerationService(db as never, { get: (key: string) => config[key] } as never, undefined, undefined, undefined, f.service);
    jest.spyOn(Reflect.get(visuals, 'logger'), 'log').mockImplementation();
    jest.spyOn(Reflect.get(visuals, 'logger'), 'warn').mockImplementation();
    const draw = jest.spyOn(visuals as any, 'generateImage').mockImplementation(async (...args: any[]) => {
      await args[6]?.(async () => ({ ok: true }) as Response, new AbortController().signal);
      return Buffer.from('synthetic-booked-image-not-quality-verification');
    });
    const upload = jest.spyOn(visuals as any, 'uploadImage').mockResolvedValue({ provider: 'r2',
      key: `story-visuals/${f.work.id}/${release.id}/${prompt.sourceSceneKey}/synthetic.webp` });
    const queue = Reflect.get(visuals, 'queue');
    return { ...f, saved, release, prompt, visuals, queue, draw, upload, config,
      visualInput: { releaseId: release.id, releaseChecksum: release.checksum, sourceSceneKey: prompt.sourceSceneKey } };
  }

  it('prepares and approves a plain manuscript guide, explicitly selects it, freezes a booking and reuses the generated asset without source edits', async () => {
    const f = await bookingFixture(true, false), original = JSON.stringify(f.manuscript.structuredBody);
    expect(f.manuscript.structuredBody).not.toHaveProperty('publicationVisualSource');
    expect(await f.visuals.syncQueue(f.work.id)).toMatchObject({ queuedCount: 0, blockedCount: 1 });
    expect(await db.storyVisualGeneration.count({ where: { workId: f.work.id } })).toBe(0);
    await f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, selectInput(f, f.saved));
    expect(await f.visuals.syncQueue(f.work.id)).toMatchObject({ queuedCount: 1, blockedCount: 0 });
    const candidate = await f.queue.next(f.work.id);
    expect(candidate).toMatchObject({ workId: f.work.id, releaseId: f.release.id, sourceSceneKey: 'part-1-main' });
    const booked = await db.storyVisualGeneration.findFirstOrThrow({ where: { workId: f.work.id } });
    expect((booked.bookingIdentity as any).sceneGuidanceApprovalSha256).toMatch(/^[a-f0-9]{64}$/);
    const result = await Reflect.get(f.visuals, 'generate').call(f.visuals, candidate.workId, candidate.releaseId,
      candidate.releaseChecksum, candidate.sourceSceneKey, undefined, false, undefined, candidate.bookingIdentity);
    expect(result).toMatchObject({ status: 'ready', reused: false }); expect(f.draw).toHaveBeenCalledTimes(1);
    const effective = f.draw.mock.calls[0][0];
    expect(effective).toContain(f.input.entries[0].promptText);
    expect(await f.visuals.generateSample(f.work.id, f.visualInput)).toMatchObject({ status: 'ready', reused: true });
    expect(f.draw).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((await db.storyManuscriptVersion.findUniqueOrThrow({ where: { id: f.manuscript.id } })).structuredBody)).toBe(original);
    expect((await db.storyVisualGeneration.findUniqueOrThrow({ where: { id: booked.id } })).bookingIdentity).toEqual(booked.bookingIdentity);
  });

  it('keeps plain-manuscript approval audit failure transactional and a newer draft blocks the old frozen booking', async () => {
    const f = await bookingFixture(true, false);
    await f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, selectInput(f, f.saved));
    await f.visuals.syncQueue(f.work.id);
    const row = await db.storyVisualGeneration.findFirstOrThrow({ where: { workId: f.work.id } });
    const newest = await save(f, { ...f.input, idempotencyKey: randomUUID(), entries: [{ ...f.input.entries[0], promptText: '아직 승인되지 않은 새 장면 지침' }] });
    expect(newest.status).toBe('draft');
    await expect(f.visuals.generateSample(f.work.id, f.visualInput)).resolves.toMatchObject({ status: 'unavailable', reason: 'visual_booking_changed' });
    expect(await f.queue.next(f.work.id)).toBeNull();
    const auditFailure = new Proxy(db, { get(target, key) {
      if (key !== '$transaction') return Reflect.get(target, key);
      return (callback: (tx: unknown) => Promise<unknown>, options: any) => db.$transaction(tx => callback(new Proxy(tx, {
        get(source, field) { return field === 'auditEvent' ? { create: async () => { throw new Error('synthetic audit failure'); } } : Reflect.get(source, field); },
      })), options);
    } });
    const failing = new StoryStudioVisualReviewService(auditFailure as never, new StoryStudioChoicePreparationService(db as never));
    await expect(failing.approve(f.owner.id, f.work.id, f.manuscript.id, newest.batchId,
      { ...f.identity, expectedBatchChecksum: newest.batchChecksum, expectedRevision: newest.revision, scenesReviewed: true }))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_SAVE_UNCONFIRMED' } });
    expect((await db.storySceneVisualReviewBatch.findUniqueOrThrow({ where: { id: newest.batchId } })).status).toBe('draft');
    expect((await db.storyVisualGeneration.findUniqueOrThrow({ where: { id: row.id } })).bookingIdentity).toEqual(row.bookingIdentity);
    expect(f.draw).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
  });

  it.each([true, false])('keeps marker-retaining prose exact and fails closed on an inconsistent graph; approved=%s', async approved => {
    const f = await fixture(false, true), original = JSON.stringify(f.manuscript.structuredBody);
    const { release, prompt } = await publishOrdinaryFixture(f);
    expect(prompt.promptText).toContain('[장면 1]');
    if (approved) {
      const saved = await save(f); await approve(f, saved);
      await f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, selectInput(f, saved));
      expect(await f.service.approvedForPublishedSource(db as never, f.work.id, release.id, release.checksum, prompt.sourceSceneKey, prompt.promptSha256))
        .toMatchObject({ batchId: saved.batchId, sourceSceneKey: 'part-1-main', partSelection: { partKey: 'part-1' } });
    } else {
      expect(await db.storySceneVisualReviewBatch.count({ where: { workId: f.work.id } })).toBe(0);
      expect(await db.storyPartVisualSelection.count({ where: { workId: f.work.id } })).toBe(0);
      await expect(f.service.approvedForPublishedSource(db as never, f.work.id, release.id, release.checksum, prompt.sourceSceneKey, prompt.promptSha256))
        .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_REPRESENTATIVE_REQUIRED' } });
    }
    await db.storyRelease.update({ where: { id: release.id }, data: { branchGraphSnapshot: {} } });
    await expect(f.service.approvedForPublishedSource(db as never, f.work.id, release.id, release.checksum, prompt.sourceSceneKey, prompt.promptSha256))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_SOURCE_CHANGED' } });
    expect(await db.storyVisualGeneration.count({ where: { workId: f.work.id } })).toBe(0);
    expect(JSON.stringify((await db.storyManuscriptVersion.findUniqueOrThrow({ where: { id: f.manuscript.id } })).structuredBody)).toBe(original);
  });

  async function recoveryFixture(part = false) {
    const f = await bookingFixture(part);
    const row = await db.storyVisualGeneration.create({ data: { workId: f.work.id, releaseId: f.release.id,
      releaseChecksum: f.release.checksum, sourceSceneKey: f.prompt.sourceSceneKey, promptSha256: f.prompt.promptSha256 } });
    const input = async () => {
      const review = await f.visuals.bookingReview(f.work.id, undefined, f.owner.id);
      const item = review.items.find((entry: any) => entry.generationId === row.id)!;
      return { ...f.visualInput, generationId: row.id, promptSha256: f.prompt.promptSha256,
        expectedReviewSha256: item.reviewSha256!, expectedCurrentBookingIdentitySha256: item.currentBookingIdentitySha256!, confirmedResume: true as const };
    };
    return { ...f, row, reprepareInput: input };
  }

  it('requires explicit exact additional scope in real queries and never follows a replacement release automatically', async () => {
    const f = await bookingFixture(false), configured = f.config.STORY_IMAGE_QUEUE_RELEASES;
    const consent = await db.storyStyleProfileConsent.findUniqueOrThrow({ where: { workId: f.work.id } });
    f.config.STORY_IMAGE_QUEUE_RELEASES = '[]';
    await expect(f.visuals.syncQueue(f.work.id)).resolves.toMatchObject({ eligibleWorkCount: 0, queuedCount: 0 });
    expect(await f.visuals.bookingReview(f.work.id, undefined, f.owner.id)).toMatchObject({ eligible: false, items: [] });
    f.config.STORY_IMAGE_QUEUE_RELEASES = JSON.stringify([{ workId: f.work.id, releaseId: f.release.id, releaseChecksum: 'f'.repeat(64) }]);
    await expect(f.visuals.syncQueue(f.work.id)).resolves.toMatchObject({ eligibleWorkCount: 0, queuedCount: 0 });
    f.config.STORY_IMAGE_QUEUE_RELEASES = configured;
    await expect(f.visuals.syncQueue(f.work.id)).resolves.toMatchObject({ eligibleWorkCount: 1, queuedCount: 1 });
    const row = await db.storyVisualGeneration.findFirstOrThrow({ where: { workId: f.work.id } });
    const replacement = await db.storyRelease.create({ data: { workId: f.work.id, version: 2, status: 'active',
      manuscriptVersionId: f.manuscript.id, branchGraphSnapshot: {}, endingSetSnapshot: {}, sceneAssetManifest: {},
      localizedDisplaySnapshot: {}, checksum: 'b'.repeat(64), createdByUserId: f.owner.id } });
    await db.storyWork.update({ where: { id: f.work.id }, data: { activeReleaseId: replacement.id } });
    await expect(f.visuals.syncQueue(f.work.id)).resolves.toMatchObject({ eligibleWorkCount: 0, queuedCount: 0 });
    expect(await f.queue.next(f.work.id)).toBeNull(); expect((await f.visuals.queueStatus(f.work.id)).works).toEqual([]);
    expect(await db.storyVisualGeneration.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
    expect(await db.storyStyleProfileConsent.findUniqueOrThrow({ where: { workId: f.work.id } })).toEqual(consent);
    expect(f.draw).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
  });

  it('does not replace absent current rights or scene approval with configured queue eligibility', async () => {
    const f = await bookingFixture(false);
    await db.storyStyleProfileConsent.delete({ where: { workId: f.work.id } });
    await expect(f.visuals.syncQueue(f.work.id)).resolves.toMatchObject({ eligibleWorkCount: 1, queuedCount: 0, blockedCount: 1 });
    expect(await db.storyStyleProfileConsent.count({ where: { workId: f.work.id } })).toBe(0);
    expect(await db.storyVisualGeneration.count({ where: { workId: f.work.id } })).toBe(0);
    const other = await bookingFixture(false);
    await save(other, { ...other.input, idempotencyKey: randomUUID(), entries: [{ ...other.input.entries[0], promptText: '아직 승인되지 않은 최신 수정안' }] });
    await expect(other.visuals.syncQueue(other.work.id)).resolves.toMatchObject({ eligibleWorkCount: 1, queuedCount: 0, blockedCount: 1 });
    expect(await db.storyVisualGeneration.count({ where: { workId: other.work.id } })).toBe(0);
    expect(other.draw).not.toHaveBeenCalled(); expect(f.draw).not.toHaveBeenCalled();
  });

  it('blocks a configured fixture or inactive release and preserves pending rows on target withdrawal', async () => {
    const f = await bookingFixture(false);
    await db.storyWork.update({ where: { id: f.work.id }, data: { fixtureSource: true } });
    await expect(f.visuals.syncQueue(f.work.id)).resolves.toMatchObject({ eligibleWorkCount: 0, queuedCount: 0 });
    await db.storyWork.update({ where: { id: f.work.id }, data: { fixtureSource: false } });
    await db.storyRelease.update({ where: { id: f.release.id }, data: { status: 'superseded' } });
    await expect(f.visuals.syncQueue(f.work.id)).resolves.toMatchObject({ eligibleWorkCount: 0, queuedCount: 0 });
    await db.storyRelease.update({ where: { id: f.release.id }, data: { status: 'active' } });
    await f.visuals.syncQueue(f.work.id);
    const row = await db.storyVisualGeneration.findFirstOrThrow({ where: { workId: f.work.id } });
    f.config.STORY_IMAGE_QUEUE_RELEASES = '[]';
    await expect(f.visuals.generateSample(f.work.id, f.visualInput)).resolves.toMatchObject({ reason: 'visual_queue_scope_unavailable' });
    expect(await db.storyVisualGeneration.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
    expect(f.draw).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
  });

  it('pauses an unspent booking after the dispatch claim lock, then selects it again only after exact target restoration', async () => {
    const f = await bookingFixture(false); await f.visuals.syncQueue(f.work.id);
    const row = await db.storyVisualGeneration.findFirstOrThrow({ where: { workId: f.work.id } });
    const configured = f.config.STORY_IMAGE_QUEUE_RELEASES;
    const claim = (f.visuals as any).assertGenerationClaim.bind(f.visuals);
    jest.spyOn(f.visuals as any, 'assertGenerationClaim').mockImplementationOnce(async (...args: any[]) => {
      await claim(...args); f.config.STORY_IMAGE_QUEUE_RELEASES = '[]';
    });
    const dispatch = jest.fn(async () => ({ ok: true }) as Response);
    f.draw.mockImplementation(async (...args: any[]) => { await args[6](dispatch, new AbortController().signal); return Buffer.from('synthetic-result'); });
    await expect(f.visuals.generateSample(f.work.id, f.visualInput)).resolves.toMatchObject({ status: 'failed', retryable: true });
    const paused = await db.storyVisualGeneration.findUniqueOrThrow({ where: { id: row.id } });
    expect(paused).toMatchObject({ status: 'pending', attemptCount: 0, provider: null, model: null, quality: null, size: null,
      assetId: null, startedAt: null, lastErrorCode: null, bookingIdentity: row.bookingIdentity });
    expect(dispatch).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled(); expect(await f.queue.next(f.work.id)).toBeNull();
    f.config.STORY_IMAGE_QUEUE_RELEASES = configured;
    const candidate = await f.queue.next(f.work.id);
    expect(candidate?.bookingIdentity).toEqual(row.bookingIdentity);
    await expect((f.visuals as any).generate(candidate.workId, candidate.releaseId, candidate.releaseChecksum,
      candidate.sourceSceneKey, undefined, false, undefined, candidate.bookingIdentity)).resolves.toMatchObject({ status: 'ready', reused: false });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((await db.storyVisualGeneration.findUniqueOrThrow({ where: { id: row.id } })).attemptCount).toBe(1);
  });

  it('rolls back asset creation and ready promotion when an additional target is withdrawn during asset writes', async () => {
    const f = await bookingFixture(false); await f.visuals.syncQueue(f.work.id);
    const row = await db.storyVisualGeneration.findFirstOrThrow({ where: { workId: f.work.id } });
    const withdrawingDb = new Proxy(db, { get(target, key) {
      if (key !== '$transaction') return Reflect.get(target, key);
      return (callback: (tx: unknown) => Promise<unknown>, options: any) => db.$transaction(tx => callback(new Proxy(tx, {
        get(source, field) {
          if (field !== 'asset') return Reflect.get(source, field);
          return new Proxy(source.asset, { get(model, action) {
            if (action !== 'create') return Reflect.get(model, action);
            return async (input: any) => { const asset = await model.create(input); f.config.STORY_IMAGE_QUEUE_RELEASES = '[]'; return asset; };
          } });
        },
      })), options);
    } });
    Reflect.set(f.visuals, 'prisma', withdrawingDb);
    await expect(f.visuals.generateSample(f.work.id, f.visualInput)).resolves.toMatchObject({ status: 'failed', retryable: false });
    expect(await db.asset.count({ where: { metadata: { path: ['storyVisual', 'workId'], equals: f.work.id } } })).toBe(0);
    expect(await db.storyVisualGeneration.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'failed', attemptCount: 1,
      assetId: null, lastErrorCode: 'STORY_VISUAL_QUEUE_SCOPE_UNAVAILABLE', bookingIdentity: row.bookingIdentity });
    expect(f.draw).toHaveBeenCalledTimes(1); expect(f.upload).toHaveBeenCalledTimes(1);
  });

  it('reprepares a specifically reviewed unbound booking once under concurrent author commands without generating or granting rights', async () => {
    const f = await recoveryFixture(), beforeConsent = await db.storyStyleProfileConsent.findUniqueOrThrow({ where: { workId: f.work.id } });
    const input = await f.reprepareInput();
    expect((await db.storyVisualGeneration.findUniqueOrThrow({ where: { id: f.row.id } })).bookingIdentity).toBeNull();
    expect(await db.auditEvent.count({ where: { targetId: f.row.id } })).toBe(0);
    const attempts = await Promise.allSettled([f.visuals.reprepareBooking(f.owner.id, f.work.id, input, true),
      f.visuals.reprepareBooking(f.owner.id, f.work.id, input, true)]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const row = await db.storyVisualGeneration.findUniqueOrThrow({ where: { id: f.row.id } });
    expect(row).toMatchObject({ status: 'pending', attemptCount: 0, startedAt: null, assetId: null });
    expect((row.bookingIdentity as any).identitySha256).toBe(input.expectedCurrentBookingIdentitySha256);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { targetId: row.id } });
    expect(audit).toMatchObject({ action: 'story_visual_booking.reprepared', actorType: 'user' });
    expect(JSON.stringify(audit.metadata)).not.toContain(f.input.entries[0].promptText);
    expect(await db.auditEvent.count({ where: { targetId: row.id } })).toBe(1);
    expect(await db.storyStyleProfileConsent.findUniqueOrThrow({ where: { workId: f.work.id } })).toEqual(beforeConsent);
    expect(f.draw).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
    expect((await f.queue.next(f.work.id))?.bookingIdentity).toEqual(row.bookingIdentity);
  });

  it('rejects cross-account review/resume and a changed row since review in PostgreSQL', async () => {
    const f = await recoveryFixture(), input = await f.reprepareInput();
    await expect(f.visuals.bookingReview(f.work.id, undefined, randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(f.visuals.reprepareBooking(randomUUID(), f.work.id, input, true)).rejects.toMatchObject({ status: 404 });
    await db.storyVisualGeneration.update({ where: { id: f.row.id }, data: { updatedAt: new Date() } });
    await expect(f.visuals.reprepareBooking(f.owner.id, f.work.id, input, true))
      .rejects.toMatchObject({ response: { code: 'STORY_VISUAL_BOOKING_REVIEW_CHANGED' } });
    expect((await db.storyVisualGeneration.findUniqueOrThrow({ where: { id: f.row.id } })).bookingIdentity).toBeNull();
    expect(await db.auditEvent.count({ where: { targetId: f.row.id } })).toBe(0);
  });

  it('stops a pre-recovery direct reader from claiming or charging the newly pinned reservation', async () => {
    const f = await recoveryFixture();
    const ensure = (f.visuals as any).ensureGeneration.bind(f.visuals);
    jest.spyOn(f.visuals as any, 'ensureGeneration').mockImplementationOnce(async (...args: any[]) => {
      const unbound = await ensure(...args);
      await f.visuals.reprepareBooking(f.owner.id, f.work.id, await f.reprepareInput(), true);
      return unbound;
    });
    await expect(f.visuals.generateSample(f.work.id, f.visualInput)).resolves.toMatchObject({ status: 'processing' });
    const row = await db.storyVisualGeneration.findUniqueOrThrow({ where: { id: f.row.id } });
    expect(row).toMatchObject({ status: 'pending', attemptCount: 0, provider: null, assetId: null });
    expect(row.bookingIdentity).not.toBeNull(); expect(f.draw).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
    await expect(f.visuals.generateSample(f.work.id, f.visualInput)).resolves.toMatchObject({ status: 'ready', reused: false });
    expect(f.draw).toHaveBeenCalledTimes(1);
  });

  it('requires a fresh review after a new explicit representative and then stores that exact new approval', async () => {
    const f = await recoveryFixture(true);
    await f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, selectInput(f, f.saved));
    const first = await f.reprepareInput(); await f.visuals.reprepareBooking(f.owner.id, f.work.id, first, true);
    await f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, {
      ...f.identity, mode: 'clear', idempotencyKey: randomUUID(), expectedSelectionVersion: 1 });
    await f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, selectInput(f, f.saved, 2));
    const review = await f.reprepareInput();
    await f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, {
      ...f.identity, mode: 'clear', idempotencyKey: randomUUID(), expectedSelectionVersion: 3 });
    await f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, selectInput(f, f.saved, 4));
    await expect(f.visuals.reprepareBooking(f.owner.id, f.work.id, review, true))
      .rejects.toMatchObject({ response: { code: 'STORY_VISUAL_BOOKING_REVIEW_CHANGED' } });
    await expect(f.visuals.generateSample(f.work.id, f.visualInput)).resolves.toMatchObject({ reason: 'visual_booking_changed' });
    const next = await f.reprepareInput(); await f.visuals.reprepareBooking(f.owner.id, f.work.id, next, true);
    expect((await db.storyVisualGeneration.findUniqueOrThrow({ where: { id: f.row.id } })).attemptCount).toBe(0);
    expect(f.draw).not.toHaveBeenCalled();
    await expect(f.visuals.generateSample(f.work.id, f.visualInput)).resolves.toMatchObject({ status: 'ready', reused: false });
    await expect(f.visuals.generateSample(f.work.id, f.visualInput)).resolves.toMatchObject({ status: 'ready', reused: true });
    expect(f.draw).toHaveBeenCalledTimes(1);
  });

  it('never rebooks uncertain or previously dispatched work even after attempt bookkeeping was reduced', async () => {
    const f = await recoveryFixture(), input = await f.reprepareInput();
    for (const change of [{ status: 'failed', attemptCount: 1, lastErrorCode: 'STORY_VISUAL_BOOKING_CHANGED' },
      { status: 'failed', attemptCount: 0, lastErrorCode: 'PROVIDER_OUTCOME_UNKNOWN' },
      { status: 'failed', attemptCount: 0, lastErrorCode: 'STORY_VISUAL_BOOKING_CHANGED', provider: 'openai' }]) {
      await db.storyVisualGeneration.update({ where: { id: f.row.id }, data: change });
      expect((await f.visuals.bookingReview(f.work.id)).items[0].canReprepare).toBe(false);
      await expect(f.visuals.reprepareBooking(f.owner.id, f.work.id, input, true))
        .rejects.toMatchObject({ response: { code: 'STORY_VISUAL_BOOKING_REPREPARE_UNAVAILABLE' } });
    }
    expect(f.draw).not.toHaveBeenCalled(); expect(await db.auditEvent.count({ where: { targetId: f.row.id } })).toBe(0);
  });

  it('rolls back booking rebind when the audit fails and permits only a newly verified retry', async () => {
    const f = await recoveryFixture(), input = await f.reprepareInput();
    const failingDb = new Proxy(db, { get(target, key) {
      if (key !== '$transaction') return Reflect.get(target, key);
      return (callback: (tx: unknown) => Promise<unknown>, options: any) => db.$transaction(tx => callback(new Proxy(tx, {
        get(source, field) { return field === 'auditEvent' ? { create: async () => { throw new Error('synthetic audit failure'); } } : Reflect.get(source, field); },
      })), options);
    } });
    Reflect.set(f.queue, 'prisma', failingDb);
    await expect(f.visuals.reprepareBooking(f.owner.id, f.work.id, input, true)).rejects.toThrow('synthetic audit failure');
    expect(await db.storyVisualGeneration.findUniqueOrThrow({ where: { id: f.row.id } })).toEqual(f.row);
    Reflect.set(f.queue, 'prisma', db);
    await expect(f.visuals.reprepareBooking(f.owner.id, f.work.id, await f.reprepareInput(), true)).resolves.toMatchObject({ status: 'pending' });
    expect(f.draw).not.toHaveBeenCalled();
  });

  it('persists one frozen booking per scene under concurrent sync, requires explicit representative and reuses matching generated assets', async () => {
    const f = await bookingFixture();
    await expect(f.visuals.syncQueue(f.work.id)).resolves.toMatchObject({ queuedCount: 1, blockedCount: 1 });
    expect(await db.storyVisualGeneration.findFirst({ where: { workId: f.work.id, sourceSceneKey: f.prompt.sourceSceneKey } })).toBeNull();
    await f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, selectInput(f, f.saved));
    const syncs = await Promise.all([f.visuals.syncQueue(f.work.id), f.visuals.syncQueue(f.work.id)]);
    expect(syncs.reduce((count, result) => count + result.queuedCount, 0)).toBe(1);
    const reserved = await db.storyVisualGeneration.findFirstOrThrow({ where: { workId: f.work.id, sourceSceneKey: f.prompt.sourceSceneKey } });
    expect((reserved.bookingIdentity as any).contract).toBe('story-visual-booking-v1');
    expect(JSON.stringify(reserved.bookingIdentity)).not.toContain(f.input.entries[0].promptText);
    expect(f.draw).not.toHaveBeenCalled();
    await expect(f.visuals.generateSample(f.work.id, f.visualInput)).resolves.toMatchObject({ status: 'ready', reused: false });
    const ready = await db.storyVisualGeneration.findUniqueOrThrow({ where: { id: reserved.id } });
    const asset = await db.asset.findUniqueOrThrow({ where: { id: ready.assetId! } });
    expect((asset.metadata as any).storyVisual.bookingIdentitySha256).toBe((reserved.bookingIdentity as any).identitySha256);
    await expect(f.visuals.generateSample(f.work.id, f.visualInput)).resolves.toMatchObject({ status: 'ready', reused: true });
    await expect(f.visuals.publicVisualAsset(asset.id)).resolves.toMatchObject({ kind: 'redirect' });
    expect(ready.bookingIdentity).toEqual(reserved.bookingIdentity); expect(f.draw).toHaveBeenCalledTimes(1);
  });

  it('does not rebind a queued operation after explicit representative clear/reselect even when guide text is identical', async () => {
    const f = await bookingFixture();
    await f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, selectInput(f, f.saved));
    await f.visuals.syncQueue(f.work.id);
    const reserved = await db.storyVisualGeneration.findFirstOrThrow({ where: { workId: f.work.id, sourceSceneKey: f.prompt.sourceSceneKey } });
    await f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, {
      ...f.identity, mode: 'clear', idempotencyKey: randomUUID(), expectedSelectionVersion: 1 });
    await f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, selectInput(f, f.saved, 2));
    await expect(f.visuals.generateSample(f.work.id, f.visualInput)).resolves.toEqual({ status: 'unavailable', reason: 'visual_booking_changed' });
    expect(await db.storyVisualGeneration.findUniqueOrThrow({ where: { id: reserved.id } }))
      .toMatchObject({ status: 'failed', attemptCount: 0, bookingIdentity: reserved.bookingIdentity, lastErrorCode: 'STORY_VISUAL_BOOKING_CHANGED' });
    expect(f.draw).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
  });

  it('never fabricates a historical booking for an unbound automatic pending row', async () => {
    const f = await bookingFixture(false);
    const row = await db.storyVisualGeneration.create({ data: { workId: f.work.id, releaseId: f.release.id,
      releaseChecksum: f.release.checksum, sourceSceneKey: f.prompt.sourceSceneKey, promptSha256: f.prompt.promptSha256 } });
    await expect(f.visuals.syncQueue(f.work.id)).resolves.toMatchObject({ queuedCount: 0 });
    await expect(f.queue.next(f.work.id)).resolves.toBeNull();
    expect((await f.visuals.queueStatus(f.work.id)).totals.unboundPending).toBe(1);
    expect((await db.storyVisualGeneration.findUniqueOrThrow({ where: { id: row.id } })).bookingIdentity).toBeNull();
    expect(f.draw).not.toHaveBeenCalled();
  });

  it('retires a changed expired claim without spending another attempt and leaves other current queue work selectable', async () => {
    const f = await bookingFixture();
    await f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, selectInput(f, f.saved));
    await f.visuals.syncQueue(f.work.id);
    const row = await db.storyVisualGeneration.findFirstOrThrow({ where: { workId: f.work.id, sourceSceneKey: f.prompt.sourceSceneKey } });
    await db.storyVisualGeneration.update({ where: { id: row.id }, data: { status: 'generating', attemptCount: 1,
      startedAt: new Date(0), updatedAt: new Date(0) } });
    await f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, {
      ...f.identity, mode: 'clear', idempotencyKey: randomUUID(), expectedSelectionVersion: 1 });
    await f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, selectInput(f, f.saved, 2));
    await expect(f.visuals.generateSample(f.work.id, f.visualInput)).resolves.toMatchObject({ status: 'unavailable', reason: 'visual_booking_changed' });
    expect(await db.storyVisualGeneration.findUniqueOrThrow({ where: { id: row.id } }))
      .toMatchObject({ status: 'failed', attemptCount: 1, bookingIdentity: row.bookingIdentity });
    const next = await f.queue.next(f.work.id);
    expect(next).not.toBeNull(); expect(next.sourceSceneKey).not.toBe(f.prompt.sourceSceneKey);
    expect(f.draw).not.toHaveBeenCalled();
  });

  it('does not overwrite an uncertain failed claim with a late storage completion in PostgreSQL', async () => {
    const f = await bookingFixture(false); await f.visuals.syncQueue(f.work.id);
    const row = await db.storyVisualGeneration.findFirstOrThrow({ where: { workId: f.work.id } });
    f.upload.mockImplementation(async () => {
      await db.storyVisualGeneration.update({ where: { id: row.id }, data: {
        status: 'failed', lastErrorCode: 'PROVIDER_OUTCOME_UNKNOWN', startedAt: null } });
      return { provider: 'r2', key: `story-visuals/${f.work.id}/${f.release.id}/${f.prompt.sourceSceneKey}/synthetic.webp` };
    });
    await expect(f.visuals.generateSample(f.work.id, f.visualInput)).resolves.toMatchObject({ status: 'failed', retryable: false });
    expect(await db.storyVisualGeneration.findUniqueOrThrow({ where: { id: row.id } }))
      .toMatchObject({ status: 'failed', assetId: null, attemptCount: 1, lastErrorCode: 'PROVIDER_OUTCOME_UNKNOWN' });
    expect(f.draw).toHaveBeenCalledTimes(1);
  });

  it('rolls back admission on binding storage failure and rejects malformed booking JSON in PostgreSQL', async () => {
    const f = await bookingFixture(false);
    const candidate = { workId: f.work.id, releaseId: f.release.id, releaseChecksum: f.release.checksum,
      sourceSceneKey: f.prompt.sourceSceneKey, promptSha256: f.prompt.promptSha256, priority: 'authored_remaining' };
    await expect(db.$transaction(async tx => {
      const identity = await (f.visuals as any).bookQueuedVisual(candidate, tx);
      await tx.storyVisualGeneration.create({ data: { workId: f.work.id, releaseId: f.release.id,
        releaseChecksum: f.release.checksum, sourceSceneKey: f.prompt.sourceSceneKey,
        promptSha256: f.prompt.promptSha256, bookingIdentity: identity } });
      throw new Error('synthetic admission failure');
    })).rejects.toThrow('synthetic admission failure');
    expect(await db.storyVisualGeneration.count({ where: { workId: f.work.id } })).toBe(0);
    const row = await db.storyVisualGeneration.create({ data: { workId: f.work.id, releaseId: f.release.id,
      releaseChecksum: f.release.checksum, sourceSceneKey: f.prompt.sourceSceneKey, promptSha256: f.prompt.promptSha256 } });
    for (const invalid of [{}, { contract: 'story-visual-booking-v1' },
      { contract: 'other', identitySha256: 'a'.repeat(64) },
      { contract: 'story-visual-booking-v1', identitySha256: 'a'.repeat(64), extra: 'x'.repeat(8192) }]) {
      await expect(db.$executeRaw(Prisma.sql`UPDATE story_visual_generations SET booking_identity = ${JSON.stringify(invalid)}::jsonb WHERE id = ${row.id}::uuid`)).rejects.toThrow();
    }
    expect((await db.storyVisualGeneration.findUniqueOrThrow({ where: { id: row.id } })).bookingIdentity).toBeNull();
  });

  it('resolves the exact published source inside the caller transaction and blocks the next unapproved draft', async () => {
    const f = await fixture(), saved = await save(f); await approve(f, saved);
    const { release, prompt } = await publishFixture(f);
    const read = () => db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM story_works WHERE id = ${f.work.id}::uuid FOR SHARE`;
      return f.service.approvedForPublishedSource(tx as never, f.work.id, release.id, release.checksum, prompt.sourceSceneKey, prompt.promptSha256);
    });
    expect(await read()).toMatchObject({ batchId: saved.batchId, manuscriptVersionId: f.manuscript.id, promptText: f.input.entries[0].promptText });
    await save(f, { ...f.input, idempotencyKey: randomUUID(), entries: [{ ...f.input.entries[0], promptText: '아직 승인하지 않은 변경안' }] });
    await expect(read()).rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_APPROVAL_REQUIRED' } });
    expect(await db.storyVisualGeneration.count({ where: { workId: f.work.id } })).toBe(0);
    expect(await db.storyVisualPrompt.findUniqueOrThrow({ where: { id: prompt.id } })).toEqual(prompt);
  });

  it('connects an approved guide through image generation storage and current-cache reuse in PostgreSQL using only synthetic provider/storage results', async () => {
    const f = await fixture(), saved = await save(f); await approve(f, saved);
    const { release, prompt } = await publishFixture(f);
    await db.storyStyleProfileConsent.create({ data: { workId: f.work.id, ownerUserId: f.owner.id,
      manuscriptVersionId: f.manuscript.id, rightsConfirmed: true, aiBranchAllowed: true, imageTransformationAllowed: true,
      allowedLocales: ['ko'], startsAt: new Date(0) } });
    const config: Record<string, string> = { STORY_IMAGE_GENERATION_ENABLED: 'true', OPENAI_API_KEY: 'synthetic-not-a-key',
      OBJECT_STORAGE_PROVIDER: 'r2', OBJECT_STORAGE_BUCKET: 'fixture', OBJECT_STORAGE_ACCESS_KEY_ID: 'synthetic',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'synthetic', OBJECT_STORAGE_ENDPOINT: 'https://storage.example.test',
      OPENAI_STORY_SCENE_IMAGE_SIZE: '1024x1536' };
    const visuals = new StoryVisualGenerationService(db as never, { get: (key: string) => config[key] } as never,
      undefined, undefined, undefined, f.service);
    const draw = jest.spyOn(visuals as any, 'generateImage').mockImplementation(async (...args: any[]) => {
      await args[6]?.(async () => ({ ok: true }) as Response, new AbortController().signal);
      return Buffer.from('synthetic-image-no-quality-verdict');
    });
    const upload = jest.spyOn(visuals as any, 'uploadImage').mockResolvedValue({ provider: 'r2',
      key: `story-visuals/${f.work.id}/${release.id}/${prompt.sourceSceneKey}/synthetic.webp` });
    const input = { releaseId: release.id, releaseChecksum: release.checksum, sourceSceneKey: prompt.sourceSceneKey };
    await expect(visuals.generateSample(f.work.id, input)).resolves.toMatchObject({ status: 'ready', reused: false });
    expect(draw.mock.calls[0][0]).toContain(f.input.entries[0].promptText);
    const generation = await db.storyVisualGeneration.findFirstOrThrow({ where: { workId: f.work.id } });
    const asset = await db.asset.findUniqueOrThrow({ where: { id: generation.assetId! } });
    expect((asset.metadata as any).storyVisual.sceneGuidanceApproval).toMatchObject({ batchId: saved.batchId });
    expect(JSON.stringify(asset.metadata)).not.toContain(f.input.entries[0].promptText);
    await expect(visuals.generateSample(f.work.id, input)).resolves.toMatchObject({ status: 'ready', reused: true });
    expect(draw).toHaveBeenCalledTimes(1); expect(upload).toHaveBeenCalledTimes(1);
    await expect(visuals.publicVisualAsset(asset.id)).resolves.toMatchObject({ kind: 'redirect' });
    await save(f, { ...f.input, idempotencyKey: randomUUID(), entries: [{ ...f.input.entries[0], promptText: '다음 미승인 장면 지침' }] });
    await expect(visuals.readyVisuals(f.work.id, release.id, [prompt.sourceSceneKey])).resolves.toEqual(new Map());
    await expect(visuals.promptKeys(f.work.id, release.id, [prompt.sourceSceneKey])).resolves.toEqual(new Set());
    await expect(visuals.publicVisualAsset(asset.id)).rejects.toMatchObject({ status: 404 });
    expect(draw).toHaveBeenCalledTimes(1);
    expect(await db.storyVisualPrompt.findUniqueOrThrow({ where: { id: prompt.id } })).toEqual(prompt);
  });

  it('persists explicit representative selection once under concurrent retry, then clears it without falling back to an old row', async () => {
    const f = await fixture(), saved = await save(f); await approve(f, saved);
    const { release, prompt } = await publishPartFixture(f);
    const resolve = () => f.service.approvedForPublishedSource(db as never, f.work.id, release.id, release.checksum, prompt.sourceSceneKey, prompt.promptSha256);
    await expect(resolve()).rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_REPRESENTATIVE_REQUIRED' } });
    const input = selectInput(f, saved);
    const attempts = await Promise.allSettled([f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, input),
      f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, input)]);
    expect(attempts.some(attempt => attempt.status === 'fulfilled')).toBe(true);
    const selected = await f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, input);
    expect(selected!.selection).toMatchObject({ current: true, referenceIndex: 0, batchId: saved.batchId, selectionVersion: 1 });
    expect(await db.storyPartVisualSelection.count({ where: { workId: f.work.id } })).toBe(1);
    expect(await db.auditEvent.count({ where: { targetId: selected!.selection!.id } })).toBe(1);
    expect(await resolve()).toMatchObject({ batchId: saved.batchId, partSelection: { id: selected!.selection!.id, selectionVersion: 1 } });
    const clear = { ...f.identity, mode: 'clear' as const, idempotencyKey: randomUUID(), expectedSelectionVersion: 1 };
    await f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, clear);
    await f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, clear);
    expect(await db.storyPartVisualSelection.count({ where: { workId: f.work.id } })).toBe(2);
    await expect(resolve()).rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_REPRESENTATIVE_REQUIRED' } });
    await expect(f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, input))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_REPRESENTATIVE_CHANGED' } });
    expect(await db.storyVisualPrompt.findUniqueOrThrow({ where: { id: prompt.id } })).toEqual(prompt);
    expect(await db.storyVisualGeneration.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it('rolls back representative selection if its audit cannot be saved and allows a safe identical retry', async () => {
    const f = await fixture(), saved = await save(f); await approve(f, saved);
    const input = selectInput(f, saved);
    const failingDb = new Proxy(db, { get(target, key) {
      if (key !== '$transaction') return Reflect.get(target, key);
      return (callback: (tx: unknown) => Promise<unknown>, options: any) => db.$transaction(tx => callback(new Proxy(tx, {
        get(source, field) { return field === 'auditEvent' ? { create: async () => { throw new Error('synthetic audit failure'); } } : Reflect.get(source, field); },
      })), options);
    } });
    const failing = new StoryStudioVisualReviewService(failingDb as never, new StoryStudioChoicePreparationService(db as never));
    await expect(failing.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, input))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_SAVE_UNCONFIRMED' } });
    expect(await db.storyPartVisualSelection.count({ where: { workId: f.work.id } })).toBe(0);
    expect((await f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, input))!.selectionVersion).toBe(1);
  });

  it('requires current part selection through generated image reuse and rejects direct image delivery after clearing it', async () => {
    const f = await fixture(), saved = await save(f); await approve(f, saved);
    const { release, prompt } = await publishPartFixture(f);
    await db.storyStyleProfileConsent.create({ data: { workId: f.work.id, ownerUserId: f.owner.id, manuscriptVersionId: f.manuscript.id,
      rightsConfirmed: true, aiBranchAllowed: true, imageTransformationAllowed: true, allowedLocales: ['ko'], startsAt: new Date(0) } });
    const config: Record<string, string> = { STORY_IMAGE_GENERATION_ENABLED: 'true', OPENAI_API_KEY: 'synthetic-not-a-key',
      OBJECT_STORAGE_PROVIDER: 'r2', OBJECT_STORAGE_BUCKET: 'fixture', OBJECT_STORAGE_ACCESS_KEY_ID: 'synthetic',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'synthetic', OBJECT_STORAGE_ENDPOINT: 'https://storage.example.test', OPENAI_STORY_SCENE_IMAGE_SIZE: '1024x1536' };
    const visuals = new StoryVisualGenerationService(db as never, { get: (key: string) => config[key] } as never, undefined, undefined, undefined, f.service);
    const draw = jest.spyOn(visuals as any, 'generateImage').mockImplementation(async (...args: any[]) => {
      await args[6]?.(async () => ({ ok: true }) as Response, new AbortController().signal);
      return Buffer.from('synthetic-part-image-not-a-quality-verdict');
    });
    jest.spyOn(visuals as any, 'uploadImage').mockResolvedValue({ provider: 'r2', key: `story-visuals/${f.work.id}/${release.id}/part-1-main/synthetic.webp` });
    const input = { releaseId: release.id, releaseChecksum: release.checksum, sourceSceneKey: prompt.sourceSceneKey };
    await expect(visuals.promptKeys(f.work.id, release.id, [prompt.sourceSceneKey])).resolves.toEqual(new Set());
    const selected = await f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, selectInput(f, saved));
    await expect(visuals.generateSample(f.work.id, input)).resolves.toMatchObject({ status: 'ready', reused: false });
    const generation = await db.storyVisualGeneration.findFirstOrThrow({ where: { workId: f.work.id } });
    const asset = await db.asset.findUniqueOrThrow({ where: { id: generation.assetId! } });
    expect((asset.metadata as any).storyVisual.sceneGuidanceApproval.partSelection.id).toBe(selected!.selection!.id);
    await expect(visuals.generateSample(f.work.id, input)).resolves.toMatchObject({ status: 'ready', reused: true });
    await expect(visuals.publicVisualAsset(asset.id)).resolves.toMatchObject({ kind: 'redirect' });
    await f.service.selectRepresentative(f.owner.id, f.work.id, f.manuscript.id, 0, {
      ...f.identity, mode: 'clear', idempotencyKey: randomUUID(), expectedSelectionVersion: 1 });
    await expect(visuals.readyVisuals(f.work.id, release.id, [prompt.sourceSceneKey])).resolves.toEqual(new Map());
    await expect(visuals.promptKeys(f.work.id, release.id, [prompt.sourceSceneKey])).resolves.toEqual(new Set());
    await expect(visuals.publicVisualAsset(asset.id)).rejects.toMatchObject({ status: 404 });
    expect(draw).toHaveBeenCalledTimes(1);
  });
});

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { normalizeCreatorGenerationProfile } from '../generation-profile/creator-generation-profile.policy';
import { activationFixture } from './story-ai-activation.postgres-fixture';
import { StoryGenerationProfileService } from './story-generation-profile.service';
import { StoryPublicationChoiceProfileService } from './story-publication-choice-profile.service';
import { StoryPublicationIntakeService } from './story-publication-intake.service';
import { INHERITOR_STORY } from './story-inheritor-publication.policy';
import { prepareManuscript } from './story-manuscript-file.policy';
import { readPublishedChoicePreparationContext } from './story-publication-choice-context.policy';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

postgres('Publication choices with approved author settings (isolated PostgreSQL)', () => {
  let db: PrismaClient;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
        parsed.username !== 'lumina_qa' || parsed.pathname !== '/lumina_chat_memory_qa' || parsed.search || parsed.hash) {
      throw new Error('Dedicated publication QA database required');
    }
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
  });
  beforeEach(() => jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No provider network allowed')));
  afterEach(() => {
    try { expect(globalThis.fetch).not.toHaveBeenCalled(); } finally { jest.restoreAllMocks(); }
  });
  afterAll(async () => { await db?.$disconnect(); });

  async function fixture() {
    const f = await activationFixture(db, false);
    await db.storyPart.update({ where: { id: f.part.id }, data: { title: { ko: 'The ledger' } } });
    await db.storyChoice.update({ where: { id: f.choice.id }, data: {
      routeKind: 'writer_original', choiceKey: 'author-original', label: { ko: 'Preserve the ledger' },
      targetSceneId: null, targetEndingKey: 'author_main',
    } });
    const analysis = await db.storyAnalysisJob.create({ data: {
      workId: f.work.id, manuscriptVersionId: f.manuscript.id, analysisVersion: 2,
      idempotencyKey: randomUUID(), status: 'completed', pipeline: 'semantic_extraction_v1',
      actorUserId: f.owner.id, sourceContentHash: f.manuscript.contentHash, sourceLocale: 'ko',
      rateCardId: f.rate.id,
      sourceDigest: f.manuscript.contentHash, configHash: f.manuscript.contentHash,
      totalParagraphs: 1, plannedParagraphs: 1, completedParagraphs: 1,
    } });
    await db.storyAnalysisEvidence.create({ data: {
      analysisJobId: analysis.id, provenance: 'semantic_candidate', sequence: 1,
      evidenceType: 'style', sourcePartKey: 'part-1', sourceParagraphIndex: 0,
      payload: { title: 'Narration', observation: 'Restrained first-person observations.', styleCategory: 'narration' },
    } });
    const profiles = new StoryGenerationProfileService(db as never);
    const draft = await profiles.getOrCreate(f.owner.id, f.work.id);
    const settings = normalizeCreatorGenerationProfile('story', draft.profile.draftSettings);
    const reviewed = await profiles.update(f.owner.id, f.work.id, { settings: {
      ...settings, sections: settings.sections.map(section => ({ ...section, decision: 'accepted' as const })),
    } });
    await profiles.approve(f.owner.id, f.work.id, { expectedDraftFingerprint: reviewed.profile.draftFingerprint! });
    const service = new StoryPublicationIntakeService(db as never, {} as never);
    const status = { workId: f.work.id, slug: f.work.slug, releaseId: f.release.id, totalParts: INHERITOR_STORY.partCount,
      preparedParts: 0, status: 'preparing_choices', preparationBatch: null,
      pending: [{ partId: f.part.id, partKey: 'part-1', sceneId: f.scene.id, title: 'The ledger', choiceCount: 1 }] };
    jest.spyOn(service, 'publishedInheritorChoiceStatus').mockResolvedValue(status);
    const generate = jest.fn(async (_input: unknown) => [{ partKey: 'part-1', alternatives: ['Hide the ledger', 'Reveal the ledger'] }]);
    jest.spyOn(service as any, 'choiceProvider').mockReturnValue({ generate });
    return { ...f, profiles, analysis, service, generate, status };
  }

  const operatorReview = { outcome: 'no_reusable_response_confirmed' as const,
    reviewNote: 'Provider response and billing records checked; no reusable response exists.' };

  async function interruptedNoncontiguous() {
    const f = await fixture();
    const additional = [];
    for (const position of [2, 9, 17]) {
      const part = await db.storyPart.create({ data: { workId: f.work.id, position,
        title: { ko: `Ledger ${position}` }, status: 'published' } });
      const scene = await db.storyScene.create({ data: { partId: part.id, sceneKey: 'source', position: 1,
        title: {}, status: 'published' } });
      await db.storyBeat.create({ data: { sceneId: scene.id, position: 1, beatType: 'paragraph',
        content: { ko: `The archivist opens ledger ${position}.` } } });
      await db.storyChoice.create({ data: { sceneId: scene.id, choiceKey: 'author-original', position: 1,
        label: { ko: `Preserve ledger ${position}` }, routeKind: 'writer_original', targetEndingKey: 'author_main' } });
      additional.push({ partId: part.id, partKey: `part-${position}`, sceneId: scene.id,
        title: `Ledger ${position}`, choiceCount: 1 });
    }
    const neighbor = additional[0];
    await db.storyChoice.createMany({ data: ['Neighbor left', 'Neighbor right'].map((label, index) => ({
      sceneId: neighbor.sceneId, choiceKey: index ? 'branch-c' : 'branch-b', position: index + 2,
      label: { ko: label }, routeKind: 'generation_required',
    })) });
    f.status.pending.push(...additional.slice(1));
    f.generate.mockImplementationOnce(async () => { throw new Error('Synthetic provider interruption'); });
    await expect(f.service.preparePublishedInheritorChoices(f.second.id)).rejects.toThrow('Synthetic provider interruption');
    const batch = await db.storyPublicationChoiceBatch.findFirstOrThrow({ where: { workId: f.work.id } });
    expect(batch.status).toBe('review_required');
    expect(readPublishedChoicePreparationContext(batch).parts.map(part => part.partKey))
      .toEqual(['part-1', 'part-9', 'part-17']);
    return { ...f, batch, neighbor };
  }

  async function addPreparedAlternatives(sceneIds: string[]) {
    await db.storyChoice.createMany({ data: sceneIds.flatMap(sceneId => ['A separate path', 'A different path'].map((label, index) => ({
      sceneId, choiceKey: index ? 'branch-c' : 'branch-b', position: index + 2,
      label: { ko: label }, routeKind: 'generation_required',
    }))) });
  }

  it('recovers exactly non-contiguous parts 1, 9 and 17, then retries separately without touching readers or prepared neighbors', async () => {
    const f = await interruptedNoncontiguous();
    const readersBefore = await db.storyReaderProgress.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } });
    const neighborBefore = await db.storyChoice.findMany({ where: { sceneId: f.neighbor.sceneId }, orderBy: { id: 'asc' } });
    await expect(f.service.reviewPublishedInheritorChoiceBatch(f.second.id, f.batch.id, operatorReview))
      .resolves.toMatchObject({ status: 'retry_authorized', retryRequiresSeparateRequest: true });
    expect(f.generate).toHaveBeenCalledTimes(1);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { targetId: f.work.id, action: 'story_public_beta.ai_choices.reviewed' } });
    expect(audit.metadata).toMatchObject({ partKeys: ['part-1', 'part-9', 'part-17'],
      preparationContextSha256: f.batch.preparationContextSha256 });
    f.generate.mockImplementationOnce(async () => f.status.pending.map(part => ({ partKey: part.partKey,
      alternatives: ['A separate path', 'A different path'] })));
    await f.service.preparePublishedInheritorChoices(f.second.id);
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(await db.storyPublicationChoiceBatch.count({ where: { workId: f.work.id } })).toBe(1);
    expect(await db.storyPublicationChoiceBatch.findUniqueOrThrow({ where: { id: f.batch.id } }))
      .toMatchObject({ status: 'completed', preparationContextSha256: f.batch.preparationContextSha256 });
    for (const part of f.status.pending) expect(await db.storyChoice.count({ where: { sceneId: part.sceneId } })).toBe(3);
    expect(await db.storyChoice.findMany({ where: { sceneId: f.neighbor.sceneId }, orderBy: { id: 'asc' } })).toEqual(neighborBefore);
    expect(await db.storyReaderProgress.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } })).toEqual(readersBefore);
  }, 60000);

  it.each(['partial', 'complete'] as const)('reviews the exact interrupted scope with %s persisted alternatives without generating again', async state => {
    const f = await interruptedNoncontiguous();
    await addPreparedAlternatives(state === 'complete' ? f.status.pending.map(part => part.sceneId) : [f.scene.id]);
    const review = f.service.reviewPublishedInheritorChoiceBatch(f.second.id, f.batch.id, operatorReview);
    if (state === 'partial') {
      await expect(review).rejects.toMatchObject({ response: expect.objectContaining({ code: 'STORY_CHOICE_PREPARATION_PARTIAL_RESULT' }) });
      expect(await db.auditEvent.count({ where: { targetId: f.work.id, action: 'story_public_beta.ai_choices.reviewed' } })).toBe(0);
    } else await expect(review).resolves.toMatchObject({ status: 'completed', retryRequiresSeparateRequest: false });
    expect(f.generate).toHaveBeenCalledTimes(1);
  }, 60000);

  it.each(['prose', 'title', 'mapping', 'profile', 'consent', 'release'] as const)
    ('does not authorize retry when %s changes after an interrupted provider attempt', async change => {
      const f = await interruptedNoncontiguous();
      if (change === 'prose') await db.storyBeat.updateMany({ where: { sceneId: f.status.pending[1].sceneId }, data: { content: { ko: 'Edited prose' } } });
      if (change === 'title') await db.storyPart.update({ where: { id: f.status.pending[1].partId }, data: { title: { ko: 'Edited title' } } });
      if (change === 'mapping') await db.storyScene.update({ where: { id: f.status.pending[1].sceneId },
        data: { partId: f.status.pending[2].partId, sceneKey: 'moved', position: 2 } });
      if (change === 'profile') await db.storyWorkGenerationProfile.updateMany({ where: { workId: f.work.id },
        data: { approvedAt: new Date(Date.now() + 1000), reviewRevision: { increment: 1 } } });
      if (change === 'consent') await db.storyStyleProfileConsent.update({ where: { workId: f.work.id }, data: { status: 'revoked', revision: { increment: 1 } } });
      if (change === 'release') await db.storyWork.update({ where: { id: f.work.id }, data: { activeReleaseId: null } });
      await expect(f.service.reviewPublishedInheritorChoiceBatch(f.second.id, f.batch.id, operatorReview)).rejects.toBeDefined();
      expect(await db.storyPublicationChoiceBatch.findUniqueOrThrow({ where: { id: f.batch.id } })).toMatchObject({ status: 'review_required' });
      expect(await db.auditEvent.count({ where: { targetId: f.work.id, action: 'story_public_beta.ai_choices.reviewed' } })).toBe(0);
      expect(f.generate).toHaveBeenCalledTimes(1);
    }, 60000);

  it.each(['scope', 'prose', 'profile'] as const)('does not transfer a retry authorization when %s changes before the separate generation request', async change => {
    const f = await interruptedNoncontiguous();
    await f.service.reviewPublishedInheritorChoiceBatch(f.second.id, f.batch.id, operatorReview);
    if (change === 'scope') f.status.pending.splice(1, 1);
    if (change === 'prose') await db.storyBeat.updateMany({ where: { sceneId: f.scene.id }, data: { content: { ko: 'Edited after review' } } });
    if (change === 'profile') await db.storyWorkGenerationProfile.updateMany({ where: { workId: f.work.id },
      data: { approvedAt: new Date(Date.now() + 1000), reviewRevision: { increment: 1 } } });
    await expect(f.service.preparePublishedInheritorChoices(f.second.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_CHOICE_PREPARATION_CONTEXT_CHANGED' }),
    });
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(await db.storyPublicationChoiceBatch.findUniqueOrThrow({ where: { id: f.batch.id } })).toMatchObject({ status: 'retry_authorized' });
  }, 60000);

  it('rechecks the original scene before dispatch even when the source changes while acquiring the first claim', async () => {
    const f = await fixture();
    const create = db.storyPublicationChoiceBatch.create.bind(db.storyPublicationChoiceBatch);
    jest.spyOn(db.storyPublicationChoiceBatch, 'create').mockImplementationOnce((async args => {
      const batch = await create(args);
      await db.storyBeat.updateMany({ where: { sceneId: f.scene.id }, data: { content: { ko: 'Changed before dispatch' } } });
      return batch;
    }) as typeof db.storyPublicationChoiceBatch.create);
    await expect(f.service.preparePublishedInheritorChoices(f.second.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_PUBLICATION_CHOICE_SOURCE_CHANGED' }),
    });
    expect(f.generate).not.toHaveBeenCalled();
    expect(await db.storyPublicationChoiceBatch.findFirstOrThrow({ where: { workId: f.work.id } }))
      .toMatchObject({ status: 'review_required' });
  }, 60000);

  it('allows only one concurrent review transition and one permanent audit', async () => {
    const f = await interruptedNoncontiguous();
    const outcomes = await Promise.allSettled([
      f.service.reviewPublishedInheritorChoiceBatch(f.second.id, f.batch.id, operatorReview),
      f.service.reviewPublishedInheritorChoiceBatch(f.second.id, f.batch.id, operatorReview),
    ]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
    expect(await db.auditEvent.count({ where: { targetId: f.work.id, action: 'story_public_beta.ai_choices.reviewed' } })).toBe(1);
    expect(f.generate).toHaveBeenCalledTimes(1);
  }, 60000);

  it.each(['prose', 'profile', 'alternatives'] as const)('does not consume a reviewed retry when %s changes at the claim boundary', async change => {
    const f = await interruptedNoncontiguous();
    await f.service.reviewPublishedInheritorChoiceBatch(f.second.id, f.batch.id, operatorReview);
    const original = db.storyPublicationChoiceBatch.findFirst.bind(db.storyPublicationChoiceBatch);
    jest.spyOn(db.storyPublicationChoiceBatch, 'findFirst').mockImplementationOnce((async args => {
      const batch = await original(args);
      if (change === 'prose') await db.storyBeat.updateMany({ where: { sceneId: f.scene.id }, data: { content: { ko: 'A concurrent edit' } } });
      if (change === 'profile') await db.storyWorkGenerationProfile.updateMany({ where: { workId: f.work.id },
        data: { approvedAt: new Date(Date.now() + 1000), reviewRevision: { increment: 1 } } });
      if (change === 'alternatives') await addPreparedAlternatives([f.scene.id]);
      return batch;
    }) as typeof db.storyPublicationChoiceBatch.findFirst);
    await expect(f.service.preparePublishedInheritorChoices(f.second.id)).rejects.toBeDefined();
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(await db.storyPublicationChoiceBatch.findUniqueOrThrow({ where: { id: f.batch.id } }))
      .toMatchObject({ status: 'retry_authorized', claimToken: f.batch.claimToken,
        preparationContextSha256: f.batch.preparationContextSha256 });
  }, 60000);

  it('blocks provider dispatch if an alternative appears after acquiring a first claim without changing the original digest', async () => {
    const f = await fixture();
    const original = db.storyPublicationChoiceBatch.create.bind(db.storyPublicationChoiceBatch);
    jest.spyOn(db.storyPublicationChoiceBatch, 'create').mockImplementationOnce((async args => {
      const batch = await original(args);
      await addPreparedAlternatives([f.scene.id]);
      return batch;
    }) as typeof db.storyPublicationChoiceBatch.create);
    await expect(f.service.preparePublishedInheritorChoices(f.second.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_CHOICE_PREPARATION_CONCURRENT_UPDATE' }),
    });
    expect(f.generate).not.toHaveBeenCalled();
    expect(await db.storyChoice.count({ where: { sceneId: f.scene.id } })).toBe(3);
  }, 60000);

  it('does not complete a recovered batch whose alternatives declare a forced rejoin', async () => {
    const f = await interruptedNoncontiguous();
    await addPreparedAlternatives(f.status.pending.map(part => part.sceneId));
    await db.storyChoice.update({ where: { sceneId_choiceKey: { sceneId: f.scene.id, choiceKey: 'branch-b' } },
      data: { declaredRejoinSceneId: f.scene.id } });
    await expect(f.service.reviewPublishedInheritorChoiceBatch(f.second.id, f.batch.id, operatorReview)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_CHOICE_PREPARATION_PARTIAL_RESULT' }),
    });
    expect(await db.storyPublicationChoiceBatch.findUniqueOrThrow({ where: { id: f.batch.id } })).toMatchObject({ status: 'review_required' });
    expect(await db.auditEvent.count({ where: { targetId: f.work.id, action: 'story_public_beta.ai_choices.reviewed' } })).toBe(0);
  }, 60000);

  it.each(['before', 'after'] as const)('rolls back a timed-out old response returned %s the new result and claims only one retry', async timing => {
    const f = await fixture();
    let oldStarted!: () => void, newStarted!: () => void;
    const oldEntered = new Promise<void>(resolve => { oldStarted = resolve; });
    const newEntered = new Promise<void>(resolve => { newStarted = resolve; });
    let finishOld!: (value: Array<{ partKey: string; alternatives: string[] }>) => void;
    let finishNew!: (value: Array<{ partKey: string; alternatives: string[] }>) => void;
    f.generate.mockImplementationOnce(async () => {
      oldStarted();
      return new Promise(resolve => { finishOld = resolve; });
    });
    const oldOutcome = f.service.preparePublishedInheritorChoices(f.second.id).then(
      result => ({ result, error: null }), error => ({ result: null, error }));
    await oldEntered;
    const batch = await db.storyPublicationChoiceBatch.findFirstOrThrow({ where: { workId: f.work.id } });
    await db.storyPublicationChoiceBatch.update({ where: { id: batch.id }, data: { updatedAt: new Date(Date.now() - 11 * 60_000) } });
    await f.service.reviewPublishedInheritorChoiceBatch(f.second.id, batch.id, operatorReview);
    f.generate.mockImplementationOnce(async () => {
      newStarted();
      return new Promise(resolve => { finishNew = resolve; });
    });
    const newOutcome = f.service.preparePublishedInheritorChoices(f.second.id);
    await newEntered;
    await expect(f.service.preparePublishedInheritorChoices(f.owner.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_CHOICE_PREPARATION_IN_PROGRESS_OR_REVIEW' }),
    });
    const oldResult = [{ partKey: 'part-1', alternatives: ['Old left', 'Old right'] }];
    const newResult = [{ partKey: 'part-1', alternatives: ['New left', 'New right'] }];
    if (timing === 'before') {
      finishOld(oldResult);
      expect((await oldOutcome).error).toBeDefined();
      expect(await db.storyChoice.count({ where: { sceneId: f.scene.id } })).toBe(1);
      expect(await db.storyPublicationChoiceBatch.findUniqueOrThrow({ where: { id: batch.id } })).toMatchObject({ status: 'in_progress' });
      finishNew(newResult);
      await newOutcome;
    } else {
      finishNew(newResult);
      await newOutcome;
      finishOld(oldResult);
      expect((await oldOutcome).error).toBeDefined();
    }
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(await db.storyChoice.findFirstOrThrow({ where: { sceneId: f.scene.id, position: 2 } })).toMatchObject({ label: { ko: 'New left' } });
    expect(await db.storyPublicationChoiceBatch.findUniqueOrThrow({ where: { id: batch.id } })).toMatchObject({ status: 'completed' });
    expect(await db.auditEvent.count({ where: { targetId: f.work.id, action: 'story_public_beta.ai_choices.prepared' } })).toBe(1);
  }, 60000);

  it('records the owner-approved style and adds alternatives without altering either reader route', async () => {
    const f = await fixture();
    const readersBefore = await db.storyReaderProgress.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } });
    const originalBefore = await db.storyChoice.findUniqueOrThrow({ where: { id: f.choice.id } });
    await f.service.preparePublishedInheritorChoices(f.second.id);
    expect(f.generate).toHaveBeenCalledTimes(1);
    const input = f.generate.mock.calls[0][0] as { generationProfile: { sections: unknown[] } };
    expect(input.generationProfile.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'writing_style', value: expect.objectContaining({
        summary: 'Restrained first-person observations.', referenceScope: 'production_constraint',
      }) }),
    ]));
    expect(await db.storyChoice.findUniqueOrThrow({ where: { id: f.choice.id } })).toEqual(originalBefore);
    expect(await db.storyReaderProgress.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } })).toEqual(readersBefore);
    const choices = await db.storyChoice.findMany({ where: { sceneId: f.scene.id }, orderBy: { position: 'asc' } });
    expect(choices).toHaveLength(3);
    expect(choices.slice(1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ routeKind: 'generation_required', targetSceneId: null, declaredRejoinSceneId: null }),
    ]));
    const audit = await db.auditEvent.findFirstOrThrow({ where: { targetId: f.work.id, action: 'story_public_beta.ai_choices.prepared' } });
    expect(audit.metadata).toMatchObject({ generationProfileBinding: {
      workId: f.work.id, manuscriptVersionId: f.manuscript.id,
      generationProfilePin: { approvedByUserId: f.owner.id, analysisJobId: f.analysis.id },
    } });
  }, 60000);

  it.each(['profile', 'consent', 'prose'] as const)('rolls back alternatives when %s changes during generation', async change => {
    const f = await fixture();
    const originalBefore = await db.storyChoice.findUniqueOrThrow({ where: { id: f.choice.id } });
    f.generate.mockImplementationOnce(async () => {
      if (change === 'profile') await db.storyWorkGenerationProfile.updateMany({ where: { workId: f.work.id },
        data: { approvedAt: new Date(Date.now() + 1000), reviewRevision: { increment: 1 } } });
      if (change === 'consent') await db.storyStyleProfileConsent.update({ where: { workId: f.work.id },
        data: { status: 'revoked', revision: { increment: 1 } } });
      if (change === 'prose') await db.storyBeat.updateMany({ where: { sceneId: f.scene.id },
        data: { content: { ko: 'An edited source scene.' } } });
      return [{ partKey: 'part-1', alternatives: ['Hide the ledger', 'Reveal the ledger'] }];
    });
    await expect(f.service.preparePublishedInheritorChoices(f.second.id)).rejects.toBeDefined();
    expect(await db.storyChoice.count({ where: { sceneId: f.scene.id } })).toBe(1);
    expect(await db.storyChoice.findUniqueOrThrow({ where: { id: f.choice.id } })).toEqual(originalBefore);
    expect(await db.storyPublicationChoiceBatch.findFirstOrThrow({ where: { workId: f.work.id } })).toMatchObject({ status: 'review_required' });
    expect(await db.auditEvent.count({ where: { targetId: f.work.id, action: 'story_public_beta.ai_choices.prepared' } })).toBe(0);
  }, 60000);

  it('checks full settings at final publication and does not accept older unbound prepared choices', async () => {
    const f = await fixture();
    const policy = new StoryPublicationChoiceProfileService(db as never);
    const profile = await policy.forWork(db as never, f.work.id, { releaseId: f.release.id });
    expect(profile).not.toBeNull();
    const plan = { slug: f.work.slug, manuscript: { contentHash: f.manuscript.contentHash },
      choicePreparation: { version: 'authored-context-two-alternatives-v1', preparedPartKeys: ['part-1'], profileBinding: profile!.binding } };
    await expect(db.$transaction(tx => (f.service as any).assertChoiceProfileTx(tx, plan))).resolves.toBeUndefined();
    await expect(db.$transaction(tx => (f.service as any).assertChoiceProfileTx(tx, { ...plan,
      choicePreparation: { ...plan.choicePreparation, profileBinding: null } }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_PUBLICATION_CHOICE_SETTINGS_CHANGED' }),
    });
    expect(f.generate).not.toHaveBeenCalled();
  }, 60000);

  it('preserves a conflicting valid alternative pair rather than attributing it to the new provider result', async () => {
    const f = await fixture();
    f.generate.mockImplementationOnce(async () => {
      await db.storyChoice.createMany({ data: ['branch-b', 'branch-c'].map((choiceKey, index) => ({
        sceneId: f.scene.id, choiceKey, position: index + 2, label: { ko: `An earlier alternative ${index + 1}` },
        routeKind: 'generation_required',
      })) });
      return [{ partKey: 'part-1', alternatives: ['Hide the ledger', 'Reveal the ledger'] }];
    });
    await expect(f.service.preparePublishedInheritorChoices(f.second.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_CHOICE_PREPARATION_CONCURRENT_UPDATE' }),
    });
    expect(await db.storyChoice.count({ where: { sceneId: f.scene.id } })).toBe(3);
    expect(await db.storyChoice.findFirstOrThrow({ where: { sceneId: f.scene.id, position: 2 } })).toMatchObject({
      label: { ko: 'An earlier alternative 1' },
    });
    expect(await db.storyPublicationChoiceBatch.findFirstOrThrow({ where: { workId: f.work.id } })).toMatchObject({ status: 'review_required' });
    expect(await db.auditEvent.count({ where: { targetId: f.work.id, action: 'story_public_beta.ai_choices.prepared' } })).toBe(0);
  }, 60000);

  it.each(['key', 'rejoin'])('does not save alternatives after an original %s changes without changing its text', async field => {
    const f = await fixture();
    f.generate.mockImplementationOnce(async () => {
      await db.storyChoice.update({ where: { id: f.choice.id }, data: field === 'key'
        ? { choiceKey: 'replacement-original' } : { declaredRejoinSceneId: f.scene.id } });
      return [{ partKey: 'part-1', alternatives: ['Hide the ledger', 'Reveal the ledger'] }];
    });
    await expect(f.service.preparePublishedInheritorChoices(f.second.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_PUBLICATION_CHOICE_SOURCE_CHANGED' }),
    });
    expect(await db.storyChoice.count({ where: { sceneId: f.scene.id } })).toBe(1);
    expect(await db.storyPublicationChoiceBatch.findFirstOrThrow({ where: { workId: f.work.id } })).toMatchObject({ status: 'review_required' });
  }, 60000);

  it('links an already public source with no prepared alternatives without any regeneration or reader changes', async () => {
    const f = await fixture();
    const sourceBindingSha256 = randomUUID().replace(/-/g, '').repeat(2);
    await db.storyWork.update({ where: { id: f.work.id }, data: {
      slug: `${INHERITOR_STORY.slug}-old-${sourceBindingSha256.slice(0, 12)}`,
    } });
    await db.storyRelease.update({ where: { id: f.release.id }, data: { diffSummary: { sourceBindingSha256 } } });
    const plan = { storyKey: 'inheritor', slug: `${INHERITOR_STORY.slug}-${sourceBindingSha256.slice(0, 32)}`,
      title: 'Test', summary: 'Test', coverPath: '/cover.webp', sourceBindingSha256,
      manuscript: { locale: 'ko', contentHash: f.manuscript.contentHash, structuredBody: {} },
      parts: [{ partKey: 'part-1', title: 'The ledger', actNumber: 1, position: 1, beats: [], choices: [{
        choiceKey: 'author-original', label: 'Preserve the ledger', position: 1, routeKind: 'writer_original',
        targetPartKey: null, targetEndingKey: 'author_main',
      }] }], prompts: [] };
    const job = await db.storyPublicationImportJob.create({ data: {
      actorUserId: f.second.id, storyKey: 'inheritor', sourceBindingSha256, status: 'queued',
      planSnapshot: (f.service as any).storedPlan(plan),
    } });
    const readersBefore = await db.storyReaderProgress.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } });
    await expect(f.service.processApprovedJob(f.second.id, job.id)).resolves.toMatchObject({
      status: 'published', workId: f.work.id, releaseId: f.release.id,
    });
    expect(f.generate).not.toHaveBeenCalled();
    expect(await db.storyChoice.count({ where: { sceneId: f.scene.id } })).toBe(1);
    expect(await db.storyReaderProgress.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } })).toEqual(readersBefore);
  }, 60000);

  async function stagedImport() {
    const owner = await db.user.create({ data: {} });
    const service = new StoryPublicationIntakeService(db as never, {} as never);
    const manuscript = prepareManuscript(Buffer.from(JSON.stringify({ locale: 'ko', parts: Array.from({ length: 7 }, (_, index) => ({
      partKey: `part-${index + 1}`, title: `Chapter ${index + 1}`,
      paragraphs: [{ kind: 'paragraph', text: `The archivist opens ledger ${index + 1}.` }],
    })) })));
    const plan = { storyKey: 'monster', slug: `publication-stored-validation-${randomUUID()}`, title: 'The ledgers', summary: 'Offline QA',
      coverPath: '/cover.webp', sourceBindingSha256: randomUUID().replace(/-/g, '').repeat(2), manuscript,
      parts: manuscript.parts.map((part, index) => ({ partKey: part.partKey, title: part.title, position: index + 1, actNumber: 1,
        beats: [{ text: part.paragraphs[0].text, sourceSceneKey: `${part.partKey}-scene-01` }], choices: [
          { choiceKey: 'author-original', label: `Preserve ledger ${index + 1}`, position: 1, routeKind: 'writer_original',
            targetPartKey: manuscript.parts[index + 1]?.partKey ?? null, targetEndingKey: index === 6 ? 'author_main' : null },
          { choiceKey: 'branch-b', label: `Hide ledger ${index + 1}`, position: 2, routeKind: 'generation_required',
            targetPartKey: null, targetEndingKey: null },
          { choiceKey: 'branch-c', label: `Reveal ledger ${index + 1}`, position: 3, routeKind: 'generation_required',
            targetPartKey: null, targetEndingKey: null },
        ] })), prompts: [], choicePreparation: { version: 'authored-context-two-alternatives-v1',
        preparedPartKeys: manuscript.parts.map(part => part.partKey), profileBinding: null } };
    const job = await db.storyPublicationImportJob.create({ data: {
      actorUserId: owner.id, storyKey: 'monster', sourceBindingSha256: plan.sourceBindingSha256,
      planSnapshot: (service as any).storedPlan(plan),
    } });
    const provider = jest.spyOn(service as any, 'choiceProvider').mockImplementation(() => { throw new Error('No new provider request allowed'); });
    for (let attempt = 0; attempt < 10; attempt++) {
      const current = await db.storyPublicationImportJob.findUniqueOrThrow({ where: { id: job.id } });
      if (current.status === 'finalizing') {
        const parts = await db.storyPart.findMany({ where: { workId: current.workId! }, orderBy: { position: 'asc' } });
        const firstScene = await db.storyScene.findFirstOrThrow({ where: { partId: parts[0].id } });
        return { owner, service, job: current, plan, parts, firstScene, provider };
      }
      await service.processApprovedJob(owner.id, job.id);
    }
    throw new Error('The synthetic import did not reach final publication review');
  }

  it('compares persisted seven-part prose and routing in bounded batches before publishing and keeps permanent proof', async () => {
    const f = await stagedImport();
    const readBeats = jest.spyOn(db.storyBeat, 'findMany');
    await (f.service as any).assertStoredPublicationTx(db, f.job.workId, f.plan);
    expect(readBeats.mock.calls.map(([input]) => input?.take)).toEqual([7, 2]);
    const result = await f.service.processApprovedJob(f.owner.id, f.job.id);
    expect(result).toMatchObject({ status: 'published', workId: f.job.workId, releaseId: f.job.releaseId });
    expect(f.provider).not.toHaveBeenCalled();
    const audit = await db.auditEvent.findFirstOrThrow({ where: {
      targetId: f.job.workId!, action: 'story_approved_source.public_beta_published',
    } });
    expect(audit.metadata).toMatchObject({ generationProfileBinding: null,
      choicePreparationVersion: 'authored-context-two-alternatives-v1', choicePlanDigest: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(await db.storyPublicationImportJob.findUniqueOrThrow({ where: { id: f.job.id } })).toMatchObject({ planSnapshot: null });
  }, 60000);

  it.each(['missing_choice', 'different_choice', 'different_prose', 'different_route'] as const)(
    'blocks final publication when actual storage has %s', async change => {
      const f = await stagedImport();
      if (change === 'missing_choice') await db.storyChoice.deleteMany({ where: { sceneId: f.firstScene.id, position: 3 } });
      if (change === 'different_choice') await db.storyChoice.updateMany({ where: { sceneId: f.firstScene.id, position: 2 },
        data: { label: { ko: 'A valid but unrelated alternative' } } });
      if (change === 'different_prose') await db.storyBeat.updateMany({ where: { sceneId: f.firstScene.id },
        data: { content: { ko: 'A valid but unrelated paragraph' } } });
      if (change === 'different_route') {
        const target = await db.storyScene.findFirstOrThrow({ where: { partId: f.parts[2].id } });
        await db.storyChoice.updateMany({ where: { sceneId: f.firstScene.id, position: 1 }, data: { targetSceneId: target.id } });
      }
      await expect(f.service.processApprovedJob(f.owner.id, f.job.id)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'STORY_PUBLICATION_STORED_PLAN_MISMATCH' }),
      });
      expect(await db.storyWork.findUniqueOrThrow({ where: { id: f.job.workId! } })).toMatchObject({
        status: 'release_ready', activeReleaseId: null, publishedAt: null,
      });
      expect(await db.storyPublicationImportJob.findUniqueOrThrow({ where: { id: f.job.id } })).toMatchObject({ status: 'finalizing' });
      expect(await db.storyPublicationTransition.count({ where: { workId: f.job.workId!, toStatus: 'published' } })).toBe(0);
      expect(f.provider).not.toHaveBeenCalled();
    }, 60000);
});

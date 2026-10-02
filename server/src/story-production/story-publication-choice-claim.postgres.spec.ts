import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { activationFixture } from './story-ai-activation.postgres-fixture';
import { INHERITOR_STORY } from './story-inheritor-publication.policy';
import { StoryPublicationIntakeService } from './story-publication-intake.service';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

postgres('approved publication choice claim on isolated PostgreSQL', () => {
  let db: PrismaClient;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' ||
        parsed.port !== '55432' || parsed.username !== 'lumina_qa' ||
        parsed.pathname !== '/lumina_chat_memory_qa' || parsed.search || parsed.hash) {
      throw new Error('Dedicated QA database required');
    }
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
  });

  afterAll(async () => { await db?.$disconnect(); });

  it('persists one claim before the paid provider can be called twice', async () => {
    const f = await activationFixture(db, false);
    const service = new StoryPublicationIntakeService(db as never, {} as never);
    const plan = {
      storyKey: 'inheritor', slug: 'choice-claim-test', title: '시험 작품', summary: '검증용',
      coverPath: '/cover.webp', sourceBindingSha256: 'a'.repeat(64),
      manuscript: { locale: 'ko', contentHash: 'b'.repeat(64), structuredBody: {} },
      parts: [{ partKey: 'part-1', title: '첫 장', actNumber: 1, position: 1,
        beats: [{ text: '첫 장면이다.', sourceSceneKey: 'part-1-scene-01' }],
        choices: [{ choiceKey: 'next', label: '다음 장으로', position: 1,
          routeKind: 'writer_original', targetPartKey: 'part-2', targetEndingKey: null }] }],
      prompts: [],
    };
    const job = await db.storyPublicationImportJob.create({ data: {
      actorUserId: f.owner.id, storyKey: 'inheritor', sourceBindingSha256: plan.sourceBindingSha256,
      status: 'queued', planSnapshot: (service as any).storedPlan(plan),
    } });
    let finish!: (value: unknown) => void;
    const generate = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
    jest.spyOn(service as any, 'choiceProvider').mockReturnValue({ generate });

    const first = (service as any).prepareApprovedChoices(f.owner.id, job.id);
    for (let attempt = 0; attempt < 30 && !generate.mock.calls.length; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(generate).toHaveBeenCalledTimes(1);
    await expect((service as any).prepareApprovedChoices(f.owner.id, job.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_CHOICE_PREPARATION_IN_PROGRESS' }),
    });
    finish([{ partKey: 'part-1', alternatives: ['문서를 찾는다', '사람을 구한다'] }]);
    await expect(first).resolves.toMatchObject({ status: 'preparing_choices', processedParts: 1 });
    expect(generate).toHaveBeenCalledTimes(1);

    const saved = await db.storyPublicationImportJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(saved.errorCode).toBeNull();
    const savedPlan = (service as any).readStoredPlan(saved.planSnapshot);
    expect(savedPlan.parts[0].choices).toHaveLength(3);
  }, 60_000);

  it('reuses a previously published copy of the same source for a second operator', async () => {
    const f = await activationFixture(db, false);
    const sourceBindingSha256 = createHash('sha256').update(randomUUID()).digest('hex');
    await db.storyWork.update({ where: { id: f.work.id }, data: {
      slug: `${INHERITOR_STORY.slug}-old-${sourceBindingSha256.slice(0, 12)}`,
    } });
    await db.storyRelease.update({ where: { id: f.release.id }, data: {
      diffSummary: { sourceBindingSha256 },
    } });
    const service = new StoryPublicationIntakeService(db as never, {} as never);
    const plan = {
      storyKey: 'inheritor', slug: `${INHERITOR_STORY.slug}-${sourceBindingSha256.slice(0, 32)}`,
      title: '시험 작품', summary: '검증용', coverPath: '/cover.webp', sourceBindingSha256,
      manuscript: { locale: 'ko', contentHash: 'd'.repeat(64), structuredBody: {} },
      parts: [{ partKey: 'part-1', title: '첫 장', actNumber: 1, position: 1, beats: [], choices: [
        { choiceKey: 'next', label: '다음 장으로', position: 1, routeKind: 'writer_original',
          targetPartKey: 'part-2', targetEndingKey: null },
        { choiceKey: 'branch-b', label: '문서를 찾는다', position: 2, routeKind: 'generation_required',
          targetPartKey: null, targetEndingKey: null },
        { choiceKey: 'branch-c', label: '사람을 구한다', position: 3, routeKind: 'generation_required',
          targetPartKey: null, targetEndingKey: null },
      ] }],
      prompts: [], choicePreparation: { version: 'authored-context-two-alternatives-v1',
        preparedPartKeys: ['part-1'] },
    };
    const job = await db.storyPublicationImportJob.create({ data: {
      actorUserId: f.second.id, storyKey: 'inheritor', sourceBindingSha256,
      status: 'queued', planSnapshot: (service as any).storedPlan(plan),
    } });
    const publishedBefore = await db.storyWork.count({ where: {
      slug: { startsWith: `${INHERITOR_STORY.slug}-` }, status: 'published',
    } });

    await expect(service.processApprovedJob(f.second.id, job.id)).resolves.toMatchObject({
      status: 'published', workId: f.work.id, releaseId: f.release.id,
    });
    expect(await db.storyWork.count({ where: {
      slug: { startsWith: `${INHERITOR_STORY.slug}-` }, status: 'published',
    } })).toBe(publishedBefore);
    const saved = await db.storyPublicationImportJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(saved.workId).toBe(f.work.id);
    expect(saved.releaseId).toBe(f.release.id);
  }, 60_000);

  it('uniquely reserves one published-work batch across operators', async () => {
    const f = await activationFixture(db, false);
    const firstPartPosition = 1;
    const first = await db.storyPublicationChoiceBatch.create({ data: {
      workId: f.work.id, releaseId: f.release.id, firstPartPosition,
      status: 'in_progress', claimToken: randomUUID(),
    } });
    await expect(db.storyPublicationChoiceBatch.create({ data: {
      workId: f.work.id, releaseId: f.release.id, firstPartPosition,
      status: 'in_progress', claimToken: randomUUID(),
    } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(db.storyPublicationChoiceBatch.create({ data: {
      workId: f.work.id, releaseId: f.release.id, firstPartPosition: 9,
      status: 'in_progress', claimToken: randomUUID(),
    } })).rejects.toMatchObject({ code: 'P2002' });
    await db.storyPublicationChoiceBatch.update({ where: { id: first.id }, data: {
      status: 'review_required', errorCode: 'PROVIDER_OUTCOME_UNCERTAIN',
    } });
    await expect(db.storyPublicationChoiceBatch.create({ data: {
      workId: f.work.id, releaseId: f.release.id, firstPartPosition,
      status: 'in_progress', claimToken: randomUUID(),
    } })).rejects.toMatchObject({ code: 'P2002' });
    const service = new StoryPublicationIntakeService(db as never, {} as never);
    await db.storyChoice.update({ where: { id: f.choice.id }, data: { routeKind: 'writer_original',
      targetEndingKey: 'author_main', label: { ko: 'The authored ending' } } });
    await db.storyChoice.createMany({ data: ['Left alternative', 'Right alternative'].map((label, index) => ({
      sceneId: f.scene.id, choiceKey: `legacy-alt-${index}`, position: index + 2,
      label: { ko: label }, routeKind: 'generation_required',
    })) });
    await expect(service.reviewPublishedInheritorChoiceBatch(f.owner.id, first.id, {
      outcome: 'no_reusable_response_confirmed',
      reviewNote: 'Provider attempt checked; no reusable result was returned.',
    })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'STORY_CHOICE_PREPARATION_CONTEXT_REQUIRED' }) });
    expect(await db.storyPublicationChoiceBatch.findUniqueOrThrow({ where: { id: first.id } }))
      .toMatchObject({ status: 'review_required', preparationContext: null });
    await expect(db.storyPublicationChoiceBatch.create({ data: {
      workId: f.work.id, releaseId: f.release.id, firstPartPosition: 9,
      status: 'in_progress', claimToken: randomUUID(),
    } })).rejects.toMatchObject({ code: 'P2002' });
    expect(await db.storyPublicationChoiceBatch.count({ where: {
      workId: f.work.id, releaseId: f.release.id, firstPartPosition,
    } })).toBe(1);
  }, 60_000);

  it('audits all 265 published parts by route shape, not merely three-row counts', async () => {
    const f = await activationFixture(db, false);
    await db.storyWork.update({ where: { id: f.work.id }, data: {
      slug: `${INHERITOR_STORY.slug}-${randomUUID()}`, publishedAt: new Date(),
    } });
    const additionalParts = Array.from({ length: INHERITOR_STORY.partCount - 1 }, (_, index) => ({
      id: randomUUID(), workId: f.work.id, position: index + 2,
      title: { ko: `파트 ${index + 2}` }, status: 'published',
    }));
    await db.storyPart.createMany({ data: additionalParts });
    const additionalScenes = additionalParts.map((part) => ({
      id: randomUUID(), partId: part.id, sceneKey: 'source', position: 1,
      title: { ko: `장면 ${part.position}` }, status: 'published',
    }));
    await db.storyScene.createMany({ data: additionalScenes });
    const sceneIds = [f.scene.id, ...additionalScenes.map((scene) => scene.id)];
    await db.storyChoice.update({ where: { id: f.choice.id }, data: {
      choiceKey: 'original', routeKind: 'writer_original',
      targetSceneId: sceneIds[1], label: { ko: '원작을 따른다' },
    } });
    await db.storyChoice.createMany({ data: sceneIds.flatMap((sceneId, index) => [
      ...(index === 0 ? [] : [{ sceneId, choiceKey: 'original', position: 1,
        label: { ko: '원작을 따른다' }, routeKind: 'writer_original',
        targetSceneId: sceneIds[index + 1] ?? null,
        targetEndingKey: index === sceneIds.length - 1 ? 'author-ending' : null }]),
      ...(index < 2 ? [] : [
        { sceneId, choiceKey: 'branch-b', position: 2, label: { ko: '비밀을 밝힌다' },
          routeKind: 'generation_required', targetSceneId: null, targetEndingKey: null },
        { sceneId, choiceKey: 'branch-c', position: 3, label: { ko: '증인을 구한다' },
          routeKind: 'generation_required', targetSceneId: null, targetEndingKey: null },
      ]),
    ]) });
    const service = new StoryPublicationIntakeService(db as never, {} as never);
    const source = { workId: f.work.id, releaseId: f.release.id };
    await expect(service.publishedInheritorChoiceStatus(source)).resolves.toMatchObject({
      totalParts: INHERITOR_STORY.partCount, preparedParts: INHERITOR_STORY.partCount - 2,
      pending: [{ partKey: 'part-1', choiceCount: 1 }, { partKey: 'part-2', choiceCount: 1 }],
    });
    await db.storyChoice.createMany({ data: sceneIds.slice(0, 2).flatMap((sceneId) => [
      { sceneId, choiceKey: 'branch-b', position: 2, label: { ko: '비밀을 밝힌다' },
        routeKind: 'generation_required' },
      { sceneId, choiceKey: 'branch-c', position: 3, label: { ko: '증인을 구한다' },
        routeKind: 'generation_required' },
    ]) });
    await expect(service.publishedInheritorChoiceStatus(source)).resolves.toMatchObject({
      status: 'ready', preparedParts: INHERITOR_STORY.partCount,
    });
    await db.storyChoice.update({ where: { sceneId_choiceKey: {
      sceneId: sceneIds[2], choiceKey: 'branch-c',
    } }, data: { label: { ko: '비밀을 밝힌다' } } });
    await expect(service.publishedInheritorChoiceStatus(source)).resolves.toMatchObject({
      status: 'preparing_choices', preparedParts: INHERITOR_STORY.partCount - 1,
      pending: [{ partKey: 'part-3', choiceCount: 3 }],
    });
    await db.storyChoice.update({ where: { sceneId_choiceKey: { sceneId: sceneIds[2], choiceKey: 'branch-c' } },
      data: { label: { ko: '증인을 구한다' } } });
    const pendingScenes = [sceneIds[0], sceneIds[8], sceneIds[16]];
    await db.storyChoice.deleteMany({ where: { sceneId: { in: pendingScenes }, position: { gt: 1 } } });
    await db.storyBeat.createMany({ data: pendingScenes.slice(1).map(sceneId => ({ sceneId,
      position: 1, beatType: 'paragraph', content: { ko: 'A synthetic source scene with its own decision.' } })) });
    const peer = await activationFixture(db, false);
    await db.storyWork.update({ where: { id: peer.work.id }, data: {
      slug: `${INHERITOR_STORY.slug}-${randomUUID()}`, publishedAt: new Date(),
    } });
    const readerBefore = await db.storyReaderProgress.findMany({ where: { workId: { in: [f.work.id, peer.work.id] } }, orderBy: { id: 'asc' } });
    const peerChoicesBefore = await db.storyChoice.findMany({ where: { sceneId: peer.scene.id } });
    const actualStatus = service.publishedInheritorChoiceStatus.bind(service);
    const generate = jest.fn(async () => { throw new Error('Synthetic provider timeout'); });
    jest.spyOn(service as any, 'choiceProvider').mockReturnValue({ generate });
    await expect(service.preparePublishedInheritorChoices(f.owner.id)).rejects.toMatchObject({ response: {
      code: 'STORY_PUBLICATION_SOURCE_SELECTION_REQUIRED',
    } });
    await expect(service.preparePublishedInheritorChoices(f.owner.id, { ...source, releaseId: peer.release.id }))
      .rejects.toMatchObject({ response: { code: 'STORY_PUBLICATION_CHOICE_SOURCE_CHANGED' } });
    await expect(service.preparePublishedInheritorChoices(f.owner.id, { workId: randomUUID(), releaseId: source.releaseId }))
      .rejects.toMatchObject({ status: 404 });
    expect(generate).not.toHaveBeenCalled();
    expect(await db.storyPublicationChoiceBatch.count({ where: { workId: f.work.id } })).toBe(0);
    await expect(service.preparePublishedInheritorChoices(f.owner.id, source)).rejects.toThrow('Synthetic provider timeout');
    const batch = await db.storyPublicationChoiceBatch.findFirstOrThrow({ where: { workId: f.work.id } });
    await expect(actualStatus(source)).resolves.toMatchObject({
      preparedParts: INHERITOR_STORY.partCount - 3,
      pending: [{ partKey: 'part-1' }, { partKey: 'part-9' }, { partKey: 'part-17' }],
      preparationBatch: { id: batch.id, reviewContextReady: true, partKeys: ['part-1', 'part-9', 'part-17'] },
    });
    await db.storyChoice.createMany({ data: pendingScenes.flatMap(sceneId => [
      { sceneId, choiceKey: 'branch-b', position: 2, label: { ko: '비밀을 밝힌다' }, routeKind: 'generation_required' },
      { sceneId, choiceKey: 'branch-c', position: 3, label: { ko: '증인을 구한다' }, routeKind: 'generation_required' },
    ]) });
    await expect(actualStatus(source)).resolves.toMatchObject({ status: 'ready',
      preparationBatch: { id: batch.id, status: 'review_required', reviewContextReady: true,
        partKeys: ['part-1', 'part-9', 'part-17'] } });
    await expect(service.reviewPublishedInheritorChoiceBatch(f.owner.id, batch.id, {
      outcome: 'no_reusable_response_confirmed', reviewNote: 'Provider records verified and stored routes reconciled.',
    })).resolves.toMatchObject({ status: 'completed', retryRequiresSeparateRequest: false });
    await expect(actualStatus(source)).resolves.toMatchObject({ status: 'ready', preparationBatch: null });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await db.storyChoice.findMany({ where: { sceneId: peer.scene.id } })).toEqual(peerChoicesBefore);
    expect(await db.storyPublicationChoiceBatch.count({ where: { workId: peer.work.id } })).toBe(0);
    expect(await db.storyReaderProgress.findMany({ where: { workId: { in: [f.work.id, peer.work.id] } }, orderBy: { id: 'asc' } }))
      .toEqual(readerBefore);
  }, 90_000);
});

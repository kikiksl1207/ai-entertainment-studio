import { StoryPublicationIntakeService } from './story-publication-intake.service';
import { Prisma } from '@prisma/client';
import { StoryChoicePreparationError } from './story-choice-preparation.provider';
import { brotliCompressSync, brotliDecompressSync, gzipSync } from 'zlib';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { INHERITOR_STORY } from './story-inheritor-publication.policy';
import { releaseChecksum } from './story-lifecycle.policy';

const inheritorSourceDir = process.env.INHERITOR_TEST_SOURCE_DIR;
const inheritorSourceTest = inheritorSourceDir &&
  existsSync(join(inheritorSourceDir, '01_전체_원고_통합본.md')) &&
  existsSync(join(inheritorSourceDir, '02_배경_이미지_지시_통합본.md')) ? it : it.skip;

describe('StoryPublicationIntakeService queue projection', () => {
  it('prepares two distinct AI routes for a legacy job already bound to a work', async () => {
    const prisma = {
      storyPublicationImportJob: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new StoryPublicationIntakeService(prisma as never, {} as never);
    const plan = {
      storyKey: 'inheritor', slug: 'test-inheritor', title: '살인자는 죽은 자의 능력을 계승한다',
      summary: '검증용', coverPath: '/cover.webp', sourceBindingSha256: 'a'.repeat(64),
      manuscript: { locale: 'ko', contentHash: 'b'.repeat(64), structuredBody: {} },
      parts: [{
        partKey: 'part-1', title: '첫 추적', actNumber: 1, position: 1,
        beats: [{ text: '태하는 기차 테러를 조사하다 정부의 비밀 문서 앞에 섰다.', sourceSceneKey: 'part-1-scene-01' }],
        choices: [{ choiceKey: 'next', label: '원작의 다음 장으로 간다', position: 1,
          routeKind: 'writer_original', targetPartKey: 'part-2', targetEndingKey: null }],
      }],
      prompts: [],
    };
    const job = {
      id: 'job-id', actorUserId: 'owner-id', status: 'queued', batchCursor: 0,
      workId: 'legacy-work-id', releaseId: null, errorCode: null, updatedAt: new Date('2026-09-25T00:00:00Z'),
      planSnapshot: (service as any).storedPlan(plan),
    };
    prisma.storyPublicationImportJob.findUnique.mockResolvedValue(job);
    const generate = jest.fn().mockResolvedValue([{ partKey: 'part-1', alternatives: [
      '비밀 문서를 훔쳐 정부의 배후를 직접 확인한다',
      '수사를 멈추고 테러 생존자를 먼저 보호한다',
    ] }]);
    jest.spyOn(service as any, 'choiceProvider').mockReturnValue({ generate });

    const result = await (service as any).prepareApprovedChoices('owner-id', 'job-id');
    expect(result).toMatchObject({ status: 'preparing_choices', processedParts: 1, totalParts: 1 });
    expect(generate).toHaveBeenCalledTimes(1);
    const savedCall = prisma.storyPublicationImportJob.updateMany.mock.calls.find(([input]) => input.data.planSnapshot);
    const saved = (service as any).readStoredPlan(savedCall![0].data.planSnapshot);
    expect(saved.parts[0].choices).toMatchObject([
      { routeKind: 'writer_original', position: 1 },
      { routeKind: 'generation_required', position: 2 },
      { routeKind: 'generation_required', position: 3 },
    ]);
    expect(() => (service as any).assertThreeChoicePlan(saved)).not.toThrow();
    expect(() => (service as any).assertThreeChoicePlan(plan)).toThrow('Every published part must have one original');

    generate.mockRejectedValueOnce(new StoryChoicePreparationError('provider_timeout') as never);
    await expect((service as any).prepareApprovedChoices('owner-id', 'job-id')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_CHOICE_PREPARATION_REVIEW_REQUIRED' }),
    });
    const reviewMarker = prisma.storyPublicationImportJob.updateMany.mock.calls.at(-1)![0].data.errorCode;
    expect(reviewMarker).toMatch(/^choice_review_required:/);
    prisma.storyPublicationImportJob.findUnique.mockResolvedValueOnce({ ...job, errorCode: reviewMarker });
    await expect((service as any).prepareApprovedChoices('owner-id', 'job-id')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_CHOICE_PREPARATION_REVIEW_REQUIRED' }),
    });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('claims a choice batch before contacting the provider so concurrent processing calls cannot both generate', async () => {
    const service = new StoryPublicationIntakeService({} as never, {} as never);
    const plan = {
      storyKey: 'inheritor', slug: 'test-inheritor', title: '시험 작품', summary: '검증용',
      coverPath: '/cover.webp', sourceBindingSha256: 'a'.repeat(64),
      manuscript: { locale: 'ko', contentHash: 'b'.repeat(64), structuredBody: {} },
      parts: [{ partKey: 'part-1', title: '첫 장', actNumber: 1, position: 1,
        beats: [{ text: '첫 장면이다.', sourceSceneKey: 'part-1-scene-01' }],
        choices: [{ choiceKey: 'next', label: '다음 장으로', position: 1,
          routeKind: 'writer_original', targetPartKey: 'part-2', targetEndingKey: null }] }],
      prompts: [],
    };
    let row = {
      id: 'job-id', actorUserId: 'owner-id', status: 'queued', batchCursor: 0,
      workId: 'legacy-work-id', releaseId: null, errorCode: null as string | null,
      updatedAt: new Date('2026-09-25T00:00:00Z'),
      planSnapshot: (service as any).storedPlan(plan),
    };
    const prisma = {
      storyPublicationImportJob: {
        findUnique: jest.fn(async () => ({ ...row })),
        updateMany: jest.fn(async ({ where, data }: { where: any; data: any }) => {
          if (where.status !== row.status || where.errorCode !== row.errorCode ||
              (where.updatedAt && where.updatedAt.getTime() !== row.updatedAt.getTime())) return { count: 0 };
          row = { ...row, ...data, updatedAt: new Date(row.updatedAt.getTime() + 1000) };
          return { count: 1 };
        }),
      },
    };
    (service as any).prisma = prisma;
    let complete!: (value: unknown) => void;
    const generate = jest.fn(() => new Promise((resolve) => { complete = resolve; }));
    jest.spyOn(service as any, 'choiceProvider').mockReturnValue({ generate });

    const first = (service as any).prepareApprovedChoices('owner-id', 'job-id');
    await new Promise((resolve) => setImmediate(resolve));
    await expect((service as any).prepareApprovedChoices('owner-id', 'job-id')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_CHOICE_PREPARATION_IN_PROGRESS' }),
    });
    expect(generate).toHaveBeenCalledTimes(1);
    complete([{ partKey: 'part-1', alternatives: ['문서를 찾는다', '사람을 구한다'] }]);
    await expect(first).resolves.toMatchObject({ status: 'preparing_choices', processedParts: 1 });
    expect(row.errorCode).toBeNull();
  });

  it('links a second operator job to the already published source instead of creating a duplicate work', async () => {
    const existingWork = { id: 'existing-work', slug: `${INHERITOR_STORY.slug}-old-random`,
      activeReleaseId: 'existing-release', status: 'published' };
    const plan = {
      storyKey: 'inheritor', slug: `${INHERITOR_STORY.slug}-${'a'.repeat(32)}`,
      title: '시험 작품', summary: '검증용', coverPath: '/cover.webp',
      sourceBindingSha256: 'a'.repeat(64),
      manuscript: { locale: 'ko', contentHash: 'b'.repeat(64), structuredBody: {} },
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
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'job-id' }]),
      storyPublicationImportJob: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'job-id', status: 'published', batchCursor: 1,
          workId: existingWork.id, releaseId: existingWork.activeReleaseId, errorCode: null }),
      },
      storyRelease: { findMany: jest.fn().mockResolvedValue([
        { id: existingWork.activeReleaseId, workId: existingWork.id },
      ]) },
      storyWork: { findMany: jest.fn().mockResolvedValue([existingWork]), findUnique: jest.fn() },
    };
    const prisma = { $transaction: jest.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) };
    const service = new StoryPublicationIntakeService(prisma as never, {} as never);
    tx.storyPublicationImportJob.findUnique.mockResolvedValue({
      id: 'job-id', actorUserId: 'second-operator', status: 'queued', batchCursor: 0,
      planSnapshot: (service as any).storedPlan(plan), workId: null, releaseId: null,
    });
    jest.spyOn(service as any, 'prepareApprovedChoices').mockResolvedValue(null);

    await expect(service.processApprovedJob('second-operator', 'job-id')).resolves.toMatchObject({
      status: 'published', workId: existingWork.id, releaseId: existingWork.activeReleaseId,
    });
    expect(tx.storyRelease.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { diffSummary: { path: ['sourceBindingSha256'], equals: plan.sourceBindingSha256 } },
    }));
    expect(tx.storyWork.findUnique).not.toHaveBeenCalled();
  });

  it('backfills the existing published inheritor in bounded batches without replacing the authored route', async () => {
    const parts = Array.from({ length: INHERITOR_STORY.partCount }, (_, index) => ({
      id: `part-${index + 1}`, position: index + 1, title: { ko: `파트 ${index + 1}` },
    }));
    const scenes = parts.map((part) => ({ id: `scene-${part.position}`, partId: part.id }));
    let inserted = false;
    const readChoices = jest.fn().mockImplementation(async ({ where }: { where: { routeKind?: string } }) =>
      scenes.slice(0, 8).flatMap((scene, index) => {
        const original = { sceneId: scene.id, position: 1, label: { ko: '원작의 다음 장으로 간다' },
          routeKind: 'writer_original', targetSceneId: `scene-${index + 2}`, targetEndingKey: null };
        return where.routeKind === 'writer_original' || !inserted ? [original] : [
          original,
          { sceneId: scene.id, choiceKey: 'branch-b', position: 2, label: { ko: `문서의 진위를 공개한다 part-${index + 1}` },
            routeKind: 'generation_required', targetSceneId: null, targetEndingKey: null },
          { sceneId: scene.id, choiceKey: 'branch-c', position: 3, label: { ko: `생존자를 먼저 대피시킨다 part-${index + 1}` },
            routeKind: 'generation_required', targetSceneId: null, targetEndingKey: null },
        ];
      }));
    const prisma = {
      storyPublicationChoiceBatch: {
        create: jest.fn().mockResolvedValue({ id: 'batch-id' }),
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      storyWork: { findFirst: jest.fn().mockResolvedValue({ id: 'work-id', slug: `${INHERITOR_STORY.slug}-test`, activeReleaseId: 'release-id' }) },
      storyPart: { findMany: jest.fn().mockResolvedValue(parts) },
      storyScene: { findMany: jest.fn().mockResolvedValue(scenes) },
      storyChoice: {
        groupBy: jest.fn().mockImplementation(async () => scenes.map((scene, index) => ({
          sceneId: scene.id, _count: { _all: inserted && index < 8 ? 3 : 1 },
        }))),
        findMany: readChoices,
      },
      storyBeat: { findMany: jest.fn().mockImplementation(async () => scenes.slice(0, 8).map((scene) => ({
        sceneId: scene.id, content: { ko: '태하는 정부의 비밀 기록을 발견하고 문을 열었다.' },
      }))) },
      $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback({
        storyPublicationChoiceBatch: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        storyChoice: { createMany: jest.fn().mockImplementation(async ({ data }: { data: unknown[] }) => {
          expect(data).toHaveLength(16);
          expect(data).toEqual(expect.arrayContaining([expect.objectContaining({ routeKind: 'generation_required' })]));
          inserted = true;
        }), findMany: readChoices },
        auditEvent: { create: jest.fn().mockResolvedValue({}) },
      })),
    };
    const service = new StoryPublicationIntakeService(prisma as never, {} as never);
    jest.spyOn(service as any, 'choiceProvider').mockReturnValue({
      generate: jest.fn().mockImplementation(async ({ parts }: { parts: Array<{ partKey: string }> }) =>
        parts.map((part) => ({ partKey: part.partKey, alternatives: [
          `문서의 진위를 공개한다 ${part.partKey}`, `생존자를 먼저 대피시킨다 ${part.partKey}`,
        ] }))),
    });

    const result = await service.preparePublishedInheritorChoices('admin-id');
    expect(result).toMatchObject({ status: 'preparing_choices', preparedParts: 8, totalParts: 265 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does not complete a paid batch when persisted choices conflict with the generated alternatives', async () => {
    const batchCompleted = jest.fn();
    const batchReview = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      storyBeat: { findMany: jest.fn().mockResolvedValue([{ sceneId: 'scene-id',
        content: { ko: '주인공은 기록을 읽고 다음 행동을 선택했다.' } }]) },
      storyChoice: { findMany: jest.fn().mockResolvedValue([{
        sceneId: 'scene-id', position: 1, label: { ko: '원작을 따른다' },
        routeKind: 'writer_original', targetSceneId: 'next-scene', targetEndingKey: null,
      }]) },
      storyPublicationChoiceBatch: {
        create: jest.fn().mockResolvedValue({ id: 'batch-id' }), updateMany: batchReview,
      },
      $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback({
        storyChoice: { createMany: jest.fn().mockResolvedValue({ count: 1 }),
          findMany: jest.fn().mockResolvedValue([
            { sceneId: 'scene-id', position: 1, label: { ko: '원작을 따른다' },
              routeKind: 'writer_original', targetSceneId: 'next-scene', targetEndingKey: null },
            { sceneId: 'scene-id', position: 2, label: { ko: '다른 작업자가 넣은 선택' },
              routeKind: 'branch', targetSceneId: null, targetEndingKey: null },
            { sceneId: 'scene-id', position: 3, label: { ko: '기다린다' },
              routeKind: 'generation_required', targetSceneId: null, targetEndingKey: null },
          ]) },
        storyPublicationChoiceBatch: { updateMany: batchCompleted },
        auditEvent: { create: jest.fn() },
      })),
    };
    const service = new StoryPublicationIntakeService(prisma as never, {} as never);
    jest.spyOn(service, 'publishedInheritorChoiceStatus').mockResolvedValue({
      status: 'preparing_choices', workId: 'work-id', releaseId: 'release-id',
      pending: [{ partKey: 'part-1', sceneId: 'scene-id', title: '첫 장', choiceCount: 1 }],
    } as never);
    jest.spyOn(service as any, 'choiceProvider').mockReturnValue({
      generate: jest.fn().mockResolvedValue([
        { partKey: 'part-1', alternatives: ['문을 연다', '기다린다'] },
      ]),
    });

    await expect(service.preparePublishedInheritorChoices('admin-id')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_CHOICE_PREPARATION_CONCURRENT_UPDATE' }),
    });
    expect(batchCompleted).not.toHaveBeenCalled();
    expect(batchReview).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'review_required', errorCode: 'PROVIDER_OUTCOME_UNCERTAIN' },
    }));
  });

  it('claims a published choice batch before another operator can call the provider', async () => {
    const parts = Array.from({ length: INHERITOR_STORY.partCount }, (_, index) => ({
      id: `part-${index + 1}`, position: index + 1, title: { ko: `파트 ${index + 1}` },
    }));
    const scenes = parts.map((part) => ({ id: `scene-${part.position}`, partId: part.id }));
    let claimed = false;
    const prisma = {
      storyPublicationChoiceBatch: { create: jest.fn().mockImplementation(async () => {
        if (claimed) throw new Prisma.PrismaClientKnownRequestError('duplicate batch', {
          code: 'P2002', clientVersion: '6.19.3',
        });
        claimed = true;
        return { id: 'batch-id' };
      }), findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      storyWork: { findFirst: jest.fn().mockResolvedValue({
        id: 'work-id', slug: `${INHERITOR_STORY.slug}-test`, activeReleaseId: 'release-id',
      }) },
      storyPart: { findMany: jest.fn().mockResolvedValue(parts) },
      storyScene: { findMany: jest.fn().mockResolvedValue(scenes) },
      storyChoice: { groupBy: jest.fn().mockResolvedValue(scenes.map((scene) => ({
        sceneId: scene.id, _count: { _all: 1 },
      }))), findMany: jest.fn().mockResolvedValue(scenes.slice(0, 8).map((scene) => ({
        sceneId: scene.id, position: 1, label: { ko: '원작의 다음 장으로 간다' },
        routeKind: 'writer_original', targetSceneId: 'next-scene', targetEndingKey: null,
      }))) },
      storyBeat: { findMany: jest.fn().mockResolvedValue(scenes.slice(0, 8).map((scene) => ({
        sceneId: scene.id, content: { ko: '주인공은 기록을 읽고 다음 행동을 선택했다.' },
      }))) },
    };
    const service = new StoryPublicationIntakeService(prisma as never, {} as never);
    let finish!: (value: unknown) => void;
    const generate = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
    jest.spyOn(service as any, 'choiceProvider').mockReturnValue({ generate });

    const first = service.preparePublishedInheritorChoices('first-operator');
    for (let attempt = 0; attempt < 30 && !generate.mock.calls.length; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(generate).toHaveBeenCalledTimes(1);
    await expect(service.preparePublishedInheritorChoices('second-operator')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_CHOICE_PREPARATION_IN_PROGRESS_OR_REVIEW' }),
    });
    finish([]);
    await expect(first).rejects.toThrow();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(prisma.storyPublicationChoiceBatch.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'review_required', errorCode: 'PROVIDER_OUTCOME_UNCERTAIN' },
    }));
  });

  it('rejects malformed published choices before reserving a paid batch', async () => {
    const prisma = { storyPublicationChoiceBatch: { create: jest.fn() } };
    const service = new StoryPublicationIntakeService(prisma as never, {} as never);
    jest.spyOn(service, 'publishedInheritorChoiceStatus').mockResolvedValue({
      status: 'preparing_choices', workId: 'work-id', releaseId: 'release-id',
      pending: [{ partKey: 'part-1', sceneId: 'scene-id', title: '첫 장', choiceCount: 2 }],
    } as never);

    await expect(service.preparePublishedInheritorChoices('admin-id')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_CHOICE_PREPARATION_REVIEW_REQUIRED' }),
    });
    expect(prisma.storyPublicationChoiceBatch.create).not.toHaveBeenCalled();
  });

  it('rejects a missing Korean manuscript before claiming a paid batch', async () => {
    const prisma = {
      storyPublicationChoiceBatch: { create: jest.fn() },
      storyBeat: { findMany: jest.fn().mockResolvedValue([{ sceneId: 'scene-id', content: { ko: '  ' } }]) },
      storyChoice: { findMany: jest.fn().mockResolvedValue([{
        sceneId: 'scene-id', position: 1, label: { ko: '원작을 따른다' },
        routeKind: 'writer_original', targetSceneId: 'next-scene', targetEndingKey: null,
      }]) },
    };
    const service = new StoryPublicationIntakeService(prisma as never, {} as never);
    jest.spyOn(service, 'publishedInheritorChoiceStatus').mockResolvedValue({
      status: 'preparing_choices', workId: 'work-id', releaseId: 'release-id',
      pending: [{ partKey: 'part-1', sceneId: 'scene-id', title: '첫 장', choiceCount: 1 }],
    } as never);
    const provider = jest.spyOn(service as any, 'choiceProvider');

    await expect(service.preparePublishedInheritorChoices('admin-id')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_CHOICE_PREPARATION_REVIEW_REQUIRED' }),
    });
    expect(provider).not.toHaveBeenCalled();
    expect(prisma.storyPublicationChoiceBatch.create).not.toHaveBeenCalled();
  });

  it('rejects a published 265-part sequence with a missing position', async () => {
    const parts = Array.from({ length: INHERITOR_STORY.partCount }, (_, index) => ({
      id: `part-${index + 1}`, position: index === INHERITOR_STORY.partCount - 1 ? 266 : index + 1,
      title: { ko: `파트 ${index + 1}` },
    }));
    const prisma = {
      storyWork: { findFirst: jest.fn().mockResolvedValue({
        id: 'work-id', slug: `${INHERITOR_STORY.slug}-test`, activeReleaseId: 'release-id',
      }) },
      storyPart: { findMany: jest.fn().mockResolvedValue(parts) },
      storyScene: { findMany: jest.fn().mockResolvedValue(parts.map((part) => ({
        id: `scene-${part.id}`, partId: part.id,
      }))) },
      storyChoice: { groupBy: jest.fn() },
    };
    const service = new StoryPublicationIntakeService(prisma as never, {} as never);

    await expect(service.publishedInheritorChoiceStatus()).rejects.toThrow('Published story parts are incomplete');
    expect(prisma.storyChoice.groupBy).not.toHaveBeenCalled();
  });

  it.each([
    { position: 2, label: { ko: '다음 장으로' }, targetSceneId: 'next-scene', targetEndingKey: null },
    { position: 1, label: { ko: '   ' }, targetSceneId: 'next-scene', targetEndingKey: null },
    { position: 1, label: { ko: '다음 장으로' }, targetSceneId: null, targetEndingKey: null },
  ])('rejects an invalid authored route before claiming a paid batch: %j', async (invalid) => {
    const prisma = {
      storyPublicationChoiceBatch: { create: jest.fn() },
      storyBeat: { findMany: jest.fn().mockResolvedValue([{ sceneId: 'scene-id',
        content: { ko: '주인공은 기록을 읽고 다음 행동을 선택했다.' } }]) },
      storyChoice: { findMany: jest.fn().mockResolvedValue([
        { sceneId: 'scene-id', routeKind: 'writer_original', ...invalid },
      ]) },
    };
    const service = new StoryPublicationIntakeService(prisma as never, {} as never);
    jest.spyOn(service, 'publishedInheritorChoiceStatus').mockResolvedValue({
      status: 'preparing_choices', workId: 'work-id', releaseId: 'release-id',
      pending: [{ partKey: 'part-1', sceneId: 'scene-id', title: '첫 장', choiceCount: 1 }],
    } as never);
    const provider = jest.spyOn(service as any, 'choiceProvider');

    await expect(service.preparePublishedInheritorChoices('admin-id')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_CHOICE_PREPARATION_REVIEW_REQUIRED' }),
    });
    expect(provider).not.toHaveBeenCalled();
    expect(prisma.storyPublicationChoiceBatch.create).not.toHaveBeenCalled();
  });

  it('authorizes a separate retry after an interrupted batch is reviewed and audited', async () => {
    const beats = [{ sceneId: 'scene-id', content: { ko: '첫 장면' } }];
    const choices = [{ sceneId: 'scene-id', position: 1, label: { ko: '원작을 따른다' },
      routeKind: 'writer_original', targetSceneId: 'next-scene', targetEndingKey: null }];
    const preparationContext = { version: 'published-choice-exact-scope-v1', workId: 'work-id', releaseId: 'release-id',
      parts: [{ partId: 'part-id', partKey: 'part-1', sceneId: 'scene-id', title: '첫 장' }],
      sourceDigest: releaseChecksum({ beats, choices }), generationProfileBinding: null };
    const batch = { id: 'batch-id', workId: 'work-id', releaseId: 'release-id',
      firstPartPosition: 1, status: 'in_progress', claimToken: 'claim-id',
      preparationContext, preparationContextSha256: releaseChecksum(preparationContext),
      updatedAt: new Date(Date.now() - 11 * 60_000) };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const auditCreate = jest.fn().mockResolvedValue({});
    const transaction = {
      storyPublicationChoiceBatch: { findUnique: jest.fn().mockResolvedValue(batch), updateMany },
      storyWork: { findFirst: jest.fn().mockResolvedValue({ id: 'work-id' }) },
      storyPart: { findMany: jest.fn().mockResolvedValue([{ id: 'part-id', position: 1, title: { ko: '첫 장' } }]) },
      storyScene: { findMany: jest.fn().mockResolvedValue([{ id: 'scene-id', partId: 'part-id' }]) },
      storyBeat: { findMany: jest.fn().mockResolvedValue(beats) },
      storyChoice: { findMany: jest.fn().mockResolvedValue(choices) },
      auditEvent: { create: auditCreate },
    };
    const prisma = { $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback(transaction)) };
    const service = new StoryPublicationIntakeService(prisma as never, {} as never);
    const result = await service.reviewPublishedInheritorChoiceBatch('admin-id', batch.id, {
      outcome: 'no_reusable_response_confirmed', reviewNote: 'Provider logs checked; no reusable output exists.',
    });

    expect(result).toMatchObject({ status: 'retry_authorized', retryRequiresSeparateRequest: true });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'retry_authorized', errorCode: null },
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      actorUserId: 'admin-id', action: 'story_public_beta.ai_choices.reviewed',
    }) }));
  });

  it('reuses a reviewed claim for a separate request without opening a second batch row', async () => {
    const pending = [{ partId: 'part-id', partKey: 'part-1', sceneId: 'scene-id', title: '첫 장', choiceCount: 1 }];
    const beats = [{ sceneId: 'scene-id', content: { ko: '첫 장면' } }];
    const choices = [{ sceneId: 'scene-id', position: 1, label: { ko: '원작을 따른다' },
      routeKind: 'writer_original', targetSceneId: 'next-scene', targetEndingKey: null }];
    const preparationContext = { version: 'published-choice-exact-scope-v1', workId: 'work-id', releaseId: 'release-id',
      parts: pending.map(({ partId, partKey, sceneId, title }) => ({ partId, partKey, sceneId, title })),
      sourceDigest: releaseChecksum({ beats, choices }), generationProfileBinding: null };
    const retried = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      storyBeat: { findMany: jest.fn().mockResolvedValue(beats) },
      storyChoice: { findMany: jest.fn().mockResolvedValue(choices) },
      storyPublicationChoiceBatch: {
        create: jest.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('existing batch', {
          code: 'P2002', clientVersion: '6.19.3',
        })),
        findFirst: jest.fn().mockResolvedValue({ id: 'batch-id', status: 'retry_authorized', claimToken: 'old-token',
          workId: 'work-id', releaseId: 'release-id', firstPartPosition: 1, updatedAt: new Date(0),
          preparationContext, preparationContextSha256: releaseChecksum(preparationContext) }),
        updateMany: retried,
      },
      $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback({
        storyPublicationChoiceBatch: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        storyChoice: { createMany: jest.fn().mockResolvedValue({ count: 2 }),
          findMany: jest.fn().mockResolvedValue([
            { sceneId: 'scene-id', position: 1, label: { ko: '원작을 따른다' },
              routeKind: 'writer_original', targetSceneId: 'next-scene', targetEndingKey: null },
            { sceneId: 'scene-id', choiceKey: 'branch-b', position: 2, label: { ko: '문을 연다' },
              routeKind: 'generation_required', targetSceneId: null, targetEndingKey: null },
            { sceneId: 'scene-id', choiceKey: 'branch-c', position: 3, label: { ko: '기다린다' },
              routeKind: 'generation_required', targetSceneId: null, targetEndingKey: null },
          ]) },
        auditEvent: { create: jest.fn().mockResolvedValue({}) },
      })),
    };
    const service = new StoryPublicationIntakeService(prisma as never, {} as never);
    jest.spyOn(service, 'publishedInheritorChoiceStatus')
      .mockResolvedValueOnce({ status: 'preparing_choices', workId: 'work-id', releaseId: 'release-id', pending } as never)
      .mockResolvedValueOnce({ status: 'ready', workId: 'work-id', releaseId: 'release-id' } as never);
    jest.spyOn(service as any, 'choiceProvider').mockReturnValue({
      generate: jest.fn().mockResolvedValue([{ partKey: 'part-1', alternatives: ['문을 연다', '기다린다'] }]),
    });

    await expect(service.preparePublishedInheritorChoices('admin-id')).resolves.toMatchObject({ status: 'ready' });
    expect(retried).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'batch-id', status: 'retry_authorized', claimToken: 'old-token',
        preparationContextSha256: releaseChecksum(preparationContext) }),
      data: expect.objectContaining({ status: 'in_progress' }),
    }));
  });

  it('routes a one-choice stored submission through the resumable choice-preparation job', async () => {
    const buffer = Buffer.from('approved manuscript');
    const checksumSha256 = createHash('sha256').update(buffer).digest('hex');
    const prisma = { storyUploadSubmission: { findUnique: jest.fn().mockResolvedValue({
      id: 'submission-id', userId: 'owner-id', promotedWorkId: null,
      files: [{ checksumSha256, storageProvider: 'local', storageKey: 'source', fileSizeBytes: BigInt(buffer.length) }],
    }) } };
    const service = new StoryPublicationIntakeService(prisma as never, {
      getObject: jest.fn().mockResolvedValue(buffer),
    } as never);
    jest.spyOn(service as any, 'detectStoryKey').mockReturnValue('inheritor');
    jest.spyOn(service as any, 'storageProvider').mockReturnValue('local');
    jest.spyOn(service as any, 'approvedPlan').mockReturnValue({
      storyKey: 'inheritor', parts: [{ partKey: 'part-1', choices: [{ routeKind: 'writer_original' }] }],
    });
    const queue = jest.spyOn(service, 'publishApproved').mockResolvedValue({ jobId: 'job-id', status: 'queued' } as never);

    await expect(service.promote('owner-id', 'submission-id', {
      storyKey: 'inheritor', finalManuscriptConfirmed: true, rightsConfirmed: true,
      publicReleaseConfirmed: true,
    })).resolves.toMatchObject({ jobId: 'job-id', status: 'queued' });
    expect(queue).toHaveBeenCalledWith('owner-id', expect.objectContaining({ storyKey: 'inheritor' }),
      expect.objectContaining({ manuscripts: [expect.objectContaining({ buffer })] }), 'submission-id');
  });

  it('limits adult-rated listing to the approved inheritor public test', () => {
    const service = new StoryPublicationIntakeService({} as never, {} as never);
    expect(() => (service as any).assertPublicRatingReady({ contentRating: 'adults_only' }))
      .toThrow('Adult identity verification must be enforced');
    expect(() => (service as any).assertPublicRatingReady({
      contentRating: 'adults_only', catalogVisibility: 'unlisted',
    })).not.toThrow();
    expect(() => (service as any).assertPublicRatingReady({
      storyKey: 'inheritor', contentRating: 'adults_only', catalogVisibility: 'public_test',
    })).not.toThrow();
    expect(() => (service as any).assertPublicRatingReady({
      storyKey: 'monster', contentRating: 'adults_only', catalogVisibility: 'public_test',
    })).toThrow('Adult identity verification must be enforced');
    expect(() => (service as any).assertPublicRatingReady({})).not.toThrow();
  });

  it.each([
    ['gzip', gzipSync],
    ['brotli', brotliCompressSync],
  ])('restores the exact approved source bytes from a %s bundle', (_, compress) => {
    const service = new StoryPublicationIntakeService({} as never, {} as never);
    const analysis = Buffer.from('{"analysis":true}');
    const sourceMap = Buffer.from('{"sourceMap":true}');
    const firstLength = Buffer.allocUnsafe(4);
    const secondLength = Buffer.allocUnsafe(4);
    firstLength.writeUInt32BE(analysis.length);
    secondLength.writeUInt32BE(sourceMap.length);
    const bundle = Buffer.concat([
      Buffer.from('LUMINA_NORSE_BUNDLE_V1\0', 'ascii'),
      firstLength,
      analysis,
      secondLength,
      sourceMap,
    ]);

    expect((service as any).unpackNorseBundle(compress(bundle))).toEqual([
      analysis,
      sourceMap,
    ]);
  });

  it('round-trips publication plans through compressed database storage', () => {
    const service = new StoryPublicationIntakeService({} as never, {} as never);
    const plan = {
      storyKey: 'norse',
      slug: 'norse-test',
      title: '북유럽 신화',
      summary: '검증용 요약',
      coverPath: '/cover.webp',
      manuscript: {
        locale: 'ko',
        contentHash: 'a'.repeat(64),
        legacyHash: 'c'.repeat(64),
        parts: [{ partKey: 'part-1', title: '첫 장', paragraphs: ['승인 원고 본문'] }],
        source: {
          kind: 'utf8_paste',
          rawText: '승인 원고 본문',
          sha256: 'a'.repeat(64),
          byteLength: 22,
        },
        paragraphCount: 1,
      },
      sourceBindingSha256: 'b'.repeat(64),
      parts: [{
        partKey: 'part-1',
        title: '첫 장',
        actNumber: 1,
        position: 1,
        beats: [{ text: '첫 장면', sourceSceneKey: 'scene-1' }],
        choices: [],
      }],
      prompts: [],
    };

    const stored = (service as any).storedPlan(plan);
    expect(stored.storageContract).toBe('story-publication-plan-br-base64-v1');
    expect(JSON.stringify(stored)).not.toContain('승인 원고 본문');
    const restored = (service as any).readStoredPlan(stored);
    expect(restored).toMatchObject({
      storyKey: 'norse',
      slug: 'norse-test',
      parts: [{ partKey: 'part-1' }],
    });
    const archived = (service as any).archivedManuscriptBody(
      restored,
      '00000000-0000-0000-0000-000000000001',
    );
    expect(archived).toMatchObject({
      format: 'approved-source-archive-reference-v1',
      archive: {
        storage: 'story_publication_source_chunks',
        bundleContract: 'norse-approved-bundle-v1',
      },
      materialized: { partCount: 1 },
    });
    expect(JSON.stringify(archived)).not.toContain('승인 원고 본문');
  });

  inheritorSourceTest('stores a compact plan and archives both approved source files exactly', () => {
    const service = new StoryPublicationIntakeService({} as never, {} as never);
    const manuscript = readFileSync(join(inheritorSourceDir!, '01_전체_원고_통합본.md'));
    const directions = readFileSync(join(inheritorSourceDir!, '02_배경_이미지_지시_통합본.md'));
    const buffers = new Map([
      [INHERITOR_STORY.manuscriptSha256, manuscript],
      [INHERITOR_STORY.promptSha256, directions],
    ]);
    const plan = (service as any).inheritorPlan(buffers);
    const stored = (service as any).storedPlan(plan);
    const restored = (service as any).readStoredPlan(stored);
    expect(restored.parts).toHaveLength(265);
    expect(restored.manuscript.structuredBody).toMatchObject({
      format: 'approved-source-plan-reference-v1',
    });
    expect(JSON.stringify(restored.manuscript.structuredBody)).not.toContain('스물일곱 번째 남자');
    const archived = (service as any).archivedManuscriptBody(restored, 'job-id');
    expect(archived.archive.bundleContract).toBe('inheritor-approved-bundle-v1');
    expect(archived.archive.publicationJobId).toBe('job-id');

    const chunks = (service as any).inheritorSourceChunks(buffers);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((chunk: { totalChunks: number }) => chunk.totalChunks === chunks.length)).toBe(true);
    const bundle = brotliDecompressSync(Buffer.concat(chunks.map((chunk: { payload: Uint8Array }) => Buffer.from(chunk.payload))));
    const magic = Buffer.from('LUMINA_INHERITOR_BUNDLE_V1\0', 'ascii');
    expect(bundle.subarray(0, magic.length)).toEqual(magic);
    let cursor = magic.length;
    for (const original of [manuscript, directions]) {
      const length = bundle.readUInt32BE(cursor);
      cursor += 4;
      expect(length).toBe(original.length);
      const restoredHash = createHash('sha256').update(bundle.subarray(cursor, cursor + length)).digest('hex');
      const originalHash = createHash('sha256').update(original).digest('hex');
      expect(restoredHash).toBe(originalHash);
      cursor += length;
    }
    expect(cursor).toBe(bundle.length);
  });

  it('detects only the exact approved source hashes and omits private storage keys', async () => {
    const prisma = {
      storyUploadSubmission: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'submission',
            title: 'Final Norse manuscript',
            status: 'received',
            originalLocale: 'ko',
            sourceClass: 'original',
            totalBytes: BigInt(27),
            createdAt: new Date('2026-09-22T00:00:00.000Z'),
            promotedWorkId: null,
            files: [
              {
                category: 'manuscript', position: 0, extension: '.json', fileSizeBytes: BigInt(11),
                checksumSha256: '74462e693982cbb72733b3db465e435c008309dbcb76c603b908ed1369cb37f8',
                storageKey: 'private/never-expose-this',
              },
              {
                category: 'manuscript', position: 1, extension: '.json', fileSizeBytes: BigInt(16),
                checksumSha256: 'f6482c710acbc7b63f98783f3ca7f06ebc37d22f5566deb51e719f438eae6bc5',
                storageKey: 'private/never-expose-this-either',
              },
            ],
          },
        ]),
      },
      storyWork: {
        findMany: jest.fn().mockResolvedValue([{ id: 'published-work', slug: 'norse-myth-loki-crossroads',
          title: { ko: '실제 저장된 작품 이름' }, activeReleaseId: 'published-release', status: 'published' }]),
      },
    };
    const service = new StoryPublicationIntakeService(prisma as never, {} as never);
    const result = await service.submissions();
    expect(result.items[0]).toMatchObject({
      id: 'submission',
      totalBytes: 27,
      detectedStoryKey: 'norse',
      promotedWorkId: null,
    });
    expect(JSON.stringify(result)).not.toContain('storageKey');
    expect(JSON.stringify(result)).not.toContain('never-expose');
    expect(result.publishedWorks[0]).toMatchObject({ title: { ko: '실제 저장된 작품 이름' } });
    expect(prisma.storyWork.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: { id: true, slug: true, title: true, activeReleaseId: true, status: true },
    }));
  });
});

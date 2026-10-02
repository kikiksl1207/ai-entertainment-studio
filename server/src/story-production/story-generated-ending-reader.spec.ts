import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { StoryAiGeneratedScene, StoryReaderProgress, StoryWork } from '@prisma/client';
import { StoryProductionService } from './story-production.service';

describe('generated ending reader projection', () => {
  it.each(['default', null])('projects ending delivery safely for artwork variant %s', async variant => {
    const progress = {
      id: 'progress-id', userId: 'reader-id', workId: 'work-id',
      activeReleaseId: 'release-id', currentSceneId: null,
      currentGeneratedSceneId: 'ending-scene-id', currentBeatPosition: 0,
      currentAct: 1, progressRevision: 7, storyVersion: 1,
      pathSummary: [], status: 'completed', capabilityRevision: null,
    };
    const prisma = {
      storyReaderProgress: { findFirst: jest.fn().mockResolvedValue(progress) },
      storyAiGeneratedScene: { findFirst: jest.fn().mockResolvedValue({
        id: 'ending-scene-id', progressId: 'progress-id', workId: 'work-id',
        releaseId: 'release-id', sourcePartId: 'part-id', sceneKey: 'ai-ending-scene',
        title: { ko: '함께 맞은 결말' }, endingType: 'ai_generated', status: 'ready',
        visualManifest: {
          sceneKey: 'ai-ending-scene',
          background: { state: 'fallback', altKey: 'story.visual.fallback' },
          characters: [],
          fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' },
        },
      }) },
      storyPart: { findFirst: jest.fn().mockResolvedValue({
        id: 'part-id', workId: 'work-id', status: 'published', fixtureSource: false,
        seasonKey: 'season-1', actNumber: 1, position: 1, title: { ko: '첫 장' },
      }) },
      storyWork: { findFirst: jest.fn().mockResolvedValue({
        id: 'work-id', status: 'published', fixtureSource: false, defaultLocale: 'ko',
      }) },
      storyAiGeneratedBeat: { findMany: jest.fn().mockResolvedValue([{
        id: 'ending-beat-id', position: 1, beatType: 'paragraph',
        content: { ko: '함께 여기까지 왔다.' },
      }]) },
      storyAiGeneratedChoice: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const visualGeneration = {
      variantKeyForProgress: jest.fn().mockResolvedValue(variant),
      readyVisuals: jest.fn().mockResolvedValue(new Map([['ai-ending-scene', {
        sourceSceneKey: 'ai-ending-scene', publicAssetPath: '/assets/story/ending.webp',
      }]])),
      promptKeys: jest.fn().mockResolvedValue(new Set(['ai-ending-scene'])),
    };
    const service = new StoryProductionService(
      prisma as never, undefined, undefined, undefined, undefined, visualGeneration as never,
    );

    if (variant === null) {
      await expect(service.currentProgress('reader-id', 'progress-id', 'ko')).resolves.toMatchObject({
        status: 'completed', scene: { id: 'ending-scene-id', beats: [],
          deliveryState: 'artwork_unavailable', visualGenerationAvailable: false }, choices: [],
      });
      expect(visualGeneration.readyVisuals).not.toHaveBeenCalled();
      expect(visualGeneration.promptKeys).not.toHaveBeenCalled();
      return;
    }
    await expect(service.currentProgress('reader-id', 'progress-id', 'ko')).resolves.toMatchObject({
      status: 'completed',
      scene: {
        id: 'ending-scene-id', title: { value: '함께 맞은 결말', locale: 'ko' },
        endingType: 'ai_generated',
        beats: [{ content: { value: '함께 여기까지 왔다.', locale: 'ko' } }],
      },
      choices: [],
    });
  });
});

type EndingReadProgress = Pick<StoryReaderProgress,
  'id' | 'userId' | 'workId' | 'activeReleaseId' | 'currentSceneId' | 'currentGeneratedSceneId' |
  'currentBeatPosition' | 'progressRevision' | 'status' | 'routeNodeId' | 'pathSummary' |
  'visitedEndingKeys' | 'updatedAt'>;
type EndingReadScene = Pick<StoryAiGeneratedScene,
  'id' | 'userId' | 'progressId' | 'workId' | 'releaseId' | 'sourcePartId' |
  'endingType' | 'status' | 'provenance' | 'sharedResultId'>;
type EndingReadState = {
  progress: EndingReadProgress | null;
  scene: EndingReadScene | null;
  work: Pick<StoryWork, 'id' | 'activeReleaseId' | 'status'> | null;
};

function endingReadFixture(provenance = 'ai_generated') {
  const state: EndingReadState = {
    progress: {
      id: 'progress-id', userId: 'reader-id', workId: 'work-id', activeReleaseId: 'release-id',
      currentSceneId: null, currentGeneratedSceneId: 'ending-scene-id', currentBeatPosition: 0,
      progressRevision: 7, status: 'completed', routeNodeId: 'ending-route-id',
      pathSummary: [{ sourceSceneId: 'source-scene-id', generatedSceneId: 'ending-scene-id',
        readBeatPosition: 3, provenance }],
      visitedEndingKeys: ['ai-ending-key'], updatedAt: new Date('2026-10-01T06:21:00Z'),
    },
    scene: {
      id: 'ending-scene-id', userId: 'reader-id', progressId: 'progress-id', workId: 'work-id',
      releaseId: 'release-id', sourcePartId: 'part-id', endingType: 'ai_generated', status: 'ready',
      provenance, sharedResultId: provenance === 'ai_reused' ? 'shared-result-id' : null,
    },
    work: { id: 'work-id', activeReleaseId: 'release-id', status: 'published' },
  };
  // These delegates honor scalar lookup/CAS predicates, rather than always returning an owned row.
  const matches = (row: object | null, where: Record<string, unknown>) => row !== null &&
    Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value);
  const find = <T extends object>(row: T | null, where: Record<string, unknown>) =>
    row && matches(row, where) ? { ...row } : null;
  const beat = { id: 'ending-beat-id', sceneId: 'ending-scene-id', position: 2,
    beatType: 'paragraph', content: { ko: 'The ending was read.' } };
  const prisma = {
    storyReaderProgress: {
      findFirst: jest.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        find(state.progress, where)),
      updateMany: jest.fn().mockImplementation(async ({ where, data }: {
        where: Record<string, unknown>;
        data: { currentBeatPosition: number; progressRevision: { increment: number }; updatedAt: Date };
      }) => {
        if (!state.progress || !matches(state.progress, where)) return { count: 0 };
        state.progress = { ...state.progress, ...data,
          progressRevision: state.progress.progressRevision + data.progressRevision.increment };
        return { count: 1 };
      }),
    },
    storyAiGeneratedScene: {
      findFirst: jest.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        find(state.scene, where)),
    },
    storyWork: {
      findFirst: jest.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        find(state.work, where)),
    },
    storyAiGeneratedBeat: {
      findUnique: jest.fn().mockImplementation(async ({ where }: {
        where: { sceneId_position: { sceneId: string; position: number } };
      }) => where.sceneId_position.sceneId === beat.sceneId &&
        where.sceneId_position.position === beat.position ? { ...beat } : null),
    },
    storyBeat: { findUnique: jest.fn().mockResolvedValue({ ...beat, sceneId: 'canonical-scene-id' }) },
  };
  const service = new StoryProductionService(prisma as never);
  const projection = jest.spyOn(service, 'currentProgress').mockImplementation(async () => ({
    progressId: state.progress?.id, status: state.progress?.status,
    revision: state.progress?.progressRevision, choices: [],
  }) as never);
  const update = (position = 2, expectedRevision = 7) => service.updateBeatProgress(
    'reader-id', 'progress-id', { position, expectedRevision }, 'ko',
  );
  return { state, prisma, service, projection, update, beat };
}

function expectNoEndingReadWrite(f: ReturnType<typeof endingReadFixture>) {
  expect(f.prisma.storyReaderProgress.updateMany).not.toHaveBeenCalled();
  expect(f.projection).not.toHaveBeenCalled();
}

describe('generated ending read cursor guards and mutation', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['ai_generated', 'ai_reused'])('stores an owned completed %s ending cursor without reopening its route', async provenance => {
    const f = endingReadFixture(provenance);
    const before = { ...f.state.progress! };
    const sceneBefore = { ...f.state.scene! };

    await expect(f.update()).resolves.toMatchObject({ status: 'completed', revision: 8, choices: [] });

    expect(f.prisma.storyReaderProgress.findFirst).toHaveBeenCalledWith({
      where: { id: 'progress-id', userId: 'reader-id' },
    });
    expect(f.prisma.storyAiGeneratedScene.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'ending-scene-id', userId: 'reader-id',
        progressId: 'progress-id', workId: 'work-id', releaseId: 'release-id',
        status: 'ready', endingType: 'ai_generated' }),
    }));
    expect(f.prisma.storyWork.findFirst).toHaveBeenCalledWith({
      where: { id: 'work-id', status: 'published', activeReleaseId: 'release-id' }, select: { id: true },
    });
    expect(f.prisma.storyAiGeneratedBeat.findUnique).toHaveBeenCalledWith({
      where: { sceneId_position: { sceneId: 'ending-scene-id', position: 2 } },
    });
    expect(f.prisma.storyBeat.findUnique).not.toHaveBeenCalled();
    expect(f.prisma.storyReaderProgress.updateMany).toHaveBeenCalledTimes(1);
    expect(f.prisma.storyReaderProgress.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'progress-id', userId: 'reader-id', progressRevision: 7,
        status: 'completed', currentSceneId: null, currentGeneratedSceneId: 'ending-scene-id',
        activeReleaseId: 'release-id' }),
      data: { currentBeatPosition: 2, progressRevision: { increment: 1 }, updatedAt: expect.any(Date) },
    });
    expect(f.state.progress).toEqual({ ...before, currentBeatPosition: 2, progressRevision: 8,
      updatedAt: expect.any(Date) });
    expect(f.state.scene).toEqual(sceneBefore);
    expect(f.projection).toHaveBeenCalledWith('reader-id', 'progress-id', 'ko');
  });

  it.each([
    { source: 'canonical', activeReleaseId: 'release-id' },
    { source: 'generated', activeReleaseId: 'release-id' },
    { source: 'canonical', activeReleaseId: null },
    { source: 'generated', activeReleaseId: null },
  ])('preserves active $source reads with release $activeReleaseId and their CAS fence', async ({ source, activeReleaseId }) => {
    const f = endingReadFixture();
    Object.assign(f.state.progress!, { status: 'active', activeReleaseId,
      currentSceneId: source === 'canonical' ? 'canonical-scene-id' : null,
      currentGeneratedSceneId: source === 'generated' ? 'ending-scene-id' : null });
    f.state.scene!.endingType = null;

    await expect(f.update()).resolves.toMatchObject({ status: 'active', revision: 8 });

    expect(f.prisma.storyReaderProgress.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ progressRevision: 7, status: 'active',
        currentSceneId: source === 'canonical' ? 'canonical-scene-id' : null,
        currentGeneratedSceneId: source === 'generated' ? 'ending-scene-id' : null,
        activeReleaseId }),
      data: { currentBeatPosition: 2, progressRevision: { increment: 1 }, updatedAt: expect.any(Date) },
    });
    const selected = source === 'canonical' ? f.prisma.storyBeat : f.prisma.storyAiGeneratedBeat;
    const other = source === 'canonical' ? f.prisma.storyAiGeneratedBeat : f.prisma.storyBeat;
    expect(selected.findUnique).toHaveBeenCalledWith({ where: { sceneId_position: {
      sceneId: source === 'canonical' ? 'canonical-scene-id' : 'ending-scene-id', position: 2,
    } } });
    expect(other.findUnique).not.toHaveBeenCalled();
    expect(f.prisma.storyAiGeneratedScene.findFirst).not.toHaveBeenCalled();
    expect(f.prisma.storyWork.findFirst).not.toHaveBeenCalled();
    expect(f.state.progress!.status).toBe('active');
  });

  it('keeps position zero valid without inventing a beat or reopening a completed ending', async () => {
    const f = endingReadFixture();
    await expect(f.update(0)).resolves.toMatchObject({ status: 'completed', revision: 8 });
    expect(f.state.progress).toMatchObject({ currentBeatPosition: 0, status: 'completed',
      currentSceneId: null, currentGeneratedSceneId: 'ending-scene-id' });
    expect(f.prisma.storyReaderProgress.updateMany).toHaveBeenCalledTimes(1);
  });

  it.each(['ai_pending', 'paused', 'failed', 'reset_pending', 'unknown_future_status'])('rejects progress status %s even with a ready generated ending', async status => {
    const f = endingReadFixture();
    f.state.progress!.status = status;
    await expect(f.update()).rejects.toBeInstanceOf(ConflictException);
    expectNoEndingReadWrite(f);
  });

  it.each([
    { label: 'canonical completed', currentSceneId: 'canonical-scene-id', currentGeneratedSceneId: null },
    { label: 'mixed canonical and generated references', currentSceneId: 'canonical-scene-id', currentGeneratedSceneId: 'ending-scene-id' },
  ])('rejects $label rather than turning it active', async refs => {
    const f = endingReadFixture();
    Object.assign(f.state.progress!, { currentSceneId: refs.currentSceneId,
      currentGeneratedSceneId: refs.currentGeneratedSceneId });
    await expect(f.update()).rejects.toBeInstanceOf(ConflictException);
    expect(f.state.progress!.status).toBe('completed');
    expectNoEndingReadWrite(f);
  });

  it.each(['missing progress', 'foreign reader', 'missing scene references'])('rejects %s before mutation', async condition => {
    const f = endingReadFixture();
    if (condition === 'missing progress') f.state.progress = null;
    else if (condition === 'foreign reader') f.state.progress!.userId = 'other-reader-id';
    else Object.assign(f.state.progress!, { currentSceneId: null, currentGeneratedSceneId: null });
    await expect(f.update()).rejects.toBeInstanceOf(NotFoundException);
    expectNoEndingReadWrite(f);
  });

  it('rejects a completed generated ending without an active release binding', async () => {
    const f = endingReadFixture();
    f.state.progress!.activeReleaseId = null;
    await expect(f.update()).rejects.toBeInstanceOf(ConflictException);
    expectNoEndingReadWrite(f);
  });

  it.each(['id', 'userId', 'progressId', 'workId', 'releaseId'] as const)('rejects a generated ending with mismatched %s ownership', async field => {
    const f = endingReadFixture();
    f.state.scene![field] = `foreign-${field}`;
    await expect(f.update()).rejects.toBeInstanceOf(ConflictException);
    expectNoEndingReadWrite(f);
  });

  it.each([null, 'author_main', 'author_sub'])('rejects completed generated content with ending type %s', async endingType => {
    const f = endingReadFixture();
    f.state.scene!.endingType = endingType;
    await expect(f.update()).rejects.toBeInstanceOf(ConflictException);
    expectNoEndingReadWrite(f);
  });

  it.each(['draft', 'queued', 'processing', 'failed'])('rejects a generated ending that is %s instead of ready', async status => {
    const f = endingReadFixture();
    f.state.scene!.status = status;
    await expect(f.update()).rejects.toBeInstanceOf(ConflictException);
    expectNoEndingReadWrite(f);
  });

  it.each([
    'missing scene', 'missing work', 'private work', 'suspended work',
    'foreign work', 'changed published release',
  ])('rejects %s even when an ending beat exists', async condition => {
    const f = endingReadFixture();
    if (condition === 'missing scene') f.state.scene = null;
    else if (condition === 'missing work') f.state.work = null;
    else if (condition === 'private work') f.state.work!.status = 'draft';
    else if (condition === 'suspended work') f.state.work!.status = 'sale_suspended';
    else if (condition === 'foreign work') f.state.work!.id = 'other-work-id';
    else f.state.work!.activeReleaseId = 'other-release-id';
    await expect(f.update()).rejects.toBeInstanceOf(ConflictException);
    expectNoEndingReadWrite(f);
  });

  it('rejects a stale revision before reading or writing the requested beat', async () => {
    const f = endingReadFixture();
    await expect(f.update(2, 6)).rejects.toMatchObject({
      response: { code: 'STORY_PROGRESS_STALE_REVISION', currentRevision: 7 },
    });
    expect(f.prisma.storyAiGeneratedBeat.findUnique).not.toHaveBeenCalled();
    expectNoEndingReadWrite(f);
  });

  it.each(['canonical active', 'generated active', 'generated completed'])('rejects a nonexistent nonzero beat for %s', async source => {
    const f = endingReadFixture();
    if (source === 'canonical active') Object.assign(f.state.progress!, { status: 'active',
      currentSceneId: 'canonical-scene-id', currentGeneratedSceneId: null });
    else if (source === 'generated active') f.state.progress!.status = 'active';
    f.prisma.storyBeat.findUnique.mockResolvedValueOnce(null);
    await expect(f.update(17)).rejects.toBeInstanceOf(BadRequestException);
    expectNoEndingReadWrite(f);
  });

  it.each([
    { status: 'active' }, { currentSceneId: 'other-canonical-scene-id' },
    { currentGeneratedSceneId: 'other-generated-scene-id' }, { activeReleaseId: 'other-release-id' },
    { progressRevision: 8 },
  ])('rejects a concurrent progress change %j without writing to the changed route', async change => {
    const f = endingReadFixture();
    f.prisma.storyAiGeneratedBeat.findUnique.mockImplementationOnce(async () => {
      Object.assign(f.state.progress!, change);
      return { ...f.beat };
    });
    await expect(f.update()).rejects.toMatchObject({ response: { code: 'STORY_PROGRESS_STALE_REVISION' } });
    expect(f.prisma.storyReaderProgress.updateMany).toHaveBeenCalledTimes(1);
    expect(f.state.progress).toMatchObject({ ...change, currentBeatPosition: 0 });
    expect(f.projection).not.toHaveBeenCalled();
  });

  it.each([0, 2])('rejects a cursor CAS result of %s rows without reporting success', async count => {
    const f = endingReadFixture();
    f.prisma.storyReaderProgress.updateMany.mockResolvedValueOnce({ count });
    await expect(f.update()).rejects.toMatchObject({ response: { code: 'STORY_PROGRESS_STALE_REVISION' } });
    expect(f.state.progress).toMatchObject({ currentBeatPosition: 0, progressRevision: 7, status: 'completed' });
    expect(f.projection).not.toHaveBeenCalled();
  });

  it.each(['progress', 'scene', 'work', 'beat'] as const)('does not turn a %s lookup failure into a cursor write', async stage => {
    const f = endingReadFixture();
    const error = new Error(`${stage} lookup unavailable`);
    const reads = { progress: f.prisma.storyReaderProgress.findFirst,
      scene: f.prisma.storyAiGeneratedScene.findFirst, work: f.prisma.storyWork.findFirst,
      beat: f.prisma.storyAiGeneratedBeat.findUnique };
    reads[stage].mockRejectedValueOnce(error);
    await expect(f.update()).rejects.toBe(error);
    expectNoEndingReadWrite(f);
  });

  it('propagates a cursor storage failure without returning a completed projection', async () => {
    const f = endingReadFixture();
    const error = new Error('cursor storage unavailable');
    f.prisma.storyReaderProgress.updateMany.mockRejectedValueOnce(error);
    await expect(f.update()).rejects.toBe(error);
    expect(f.state.progress).toMatchObject({ currentBeatPosition: 0, progressRevision: 7, status: 'completed' });
    expect(f.projection).not.toHaveBeenCalled();
  });

  it('does not claim a projection failure rolled back the completed ending cursor', async () => {
    const f = endingReadFixture();
    const error = new Error('reader projection unavailable');
    f.projection.mockRejectedValueOnce(error);
    await expect(f.update()).rejects.toBe(error);
    expect(f.prisma.storyReaderProgress.updateMany).toHaveBeenCalledTimes(1);
    expect(f.state.progress).toMatchObject({ currentBeatPosition: 2, progressRevision: 8, status: 'completed' });
  });
});

import { randomUUID } from 'crypto';
import { StoryGeneratedEndingReadService } from './story-generated-ending-read.service';
import { StoryProductionService } from './story-production.service';

type Artwork = 'ready' | 'pending' | 'missing';

function recoveryFixture(artwork: Artwork, variant: string | null = 'default') {
  const userId = randomUUID(), progressId = randomUUID(), workId = randomUUID();
  const releaseId = randomUUID(), partId = randomUUID(), sceneId = randomUUID();
  const sceneKey = `ai-${randomUUID()}`;
  const progress = {
    id: progressId, userId, workId, activeReleaseId: releaseId,
    currentSceneId: null, currentGeneratedSceneId: sceneId, currentBeatPosition: 0,
    currentAct: 1, progressRevision: 7, storyVersion: 1, capabilityRevision: null,
    pathSummary: [], status: 'completed',
  };
  const scene = {
    id: sceneId, userId, progressId, workId, releaseId, sourcePartId: partId,
    sceneKey, title: { en: 'Stored ending' }, endingType: 'ai_generated', status: 'ready',
    visualManifest: {
      sceneKey, background: { state: 'fallback', altKey: 'story.visual.fallback' },
      characters: [],
      fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' },
    },
  };
  const part = {
    id: partId, workId, status: 'published', fixtureSource: false,
    seasonKey: 'season-1', actNumber: 1, position: 1, title: { en: 'Final act' },
  };
  const work = {
    id: workId, status: 'published', fixtureSource: false, defaultLocale: 'en',
    activeReleaseId: releaseId, publishedVersion: 1,
  };
  const release = { id: releaseId, workId, status: 'active', version: 1 };
  const beats = [{ id: randomUUID(), sceneId, position: 1, beatType: 'paragraph',
    content: { en: 'This is the stored ending.' } }];
  const find = <T extends object>(row: T) => jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
    Object.entries(where).every(([key, value]) => row[key as keyof T] === value) ? { ...row } : null);
  const prisma = {
    storyReaderProgress: { findFirst: find(progress) },
    storyAiGeneratedScene: { findFirst: find(scene) },
    storyPart: { findFirst: find(part) },
    storyWork: { findFirst: find(work) },
    storyRelease: { findFirst: find(release) },
    storyAiGeneratedBeat: { findMany: jest.fn(async ({ where }: { where: { sceneId: string } }) =>
      where.sceneId === sceneId ? beats : []) },
    storyAiGeneratedChoice: { findMany: jest.fn(async ({ where }: { where: { sceneId: string } }) => {
      if (where.sceneId !== sceneId) throw new Error('Unexpected generated choice scope');
      return [];
    }) },
    $transaction: jest.fn(async () => { throw new Error('Unavailable delivery must not enter a receipt transaction'); }),
  };
  const promptWriteAttempt = jest.fn();
  const visualGeneration = {
    variantKeyForProgress: jest.fn(async (id: string) => id === progressId ? variant : null),
    readyVisuals: jest.fn(async (id: string, pinnedRelease: string, keys: string[], pinnedVariant: string) => {
      if (id !== workId || pinnedRelease !== releaseId || keys.length !== 1 || keys[0] !== sceneKey ||
          pinnedVariant !== variant) throw new Error('Unexpected ready visual scope');
      const ready = new Map<string, { sourceSceneKey: string; publicAssetPath: string }>();
      if (artwork === 'ready') ready.set(sceneKey, {
        sourceSceneKey: sceneKey, publicAssetPath: '/assets/story/ending.webp',
      });
      return ready;
    }),
    // A missing-prompt lookup simulates the persistence that read-only delegation must avoid.
    promptKeys: jest.fn(async (id: string, pinnedRelease: string, keys: string[]) => {
      if (id !== workId || pinnedRelease !== releaseId || keys.length !== 1 || keys[0] !== sceneKey) {
        throw new Error('Unexpected prompt scope');
      }
      if (artwork === 'missing') promptWriteAttempt({ workId, releaseId, sourceSceneKey: sceneKey });
      return new Set([sceneKey]);
    }),
  };
  const production = new StoryProductionService(
    prisma as never, undefined, undefined, undefined, undefined, visualGeneration as never,
  );
  return { userId, progressId, workId, releaseId, sceneId, sceneKey, progress, prisma,
    visualGeneration, promptWriteAttempt, production };
}

function expectNoRecovery(f: ReturnType<typeof recoveryFixture>) {
  expect(f.visualGeneration.promptKeys).not.toHaveBeenCalled();
  expect(f.promptWriteAttempt).not.toHaveBeenCalled();
  expect(f.progress).toMatchObject({ status: 'completed', currentBeatPosition: 0, progressRevision: 7 });
}

describe('generated ending read non-repairing production delegation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps ready paired delivery and current variant checks when recovery is false', async () => {
    const f = recoveryFixture('ready');
    await expect(f.production.currentProgress(f.userId, f.progressId, 'en', false)).resolves.toMatchObject({
      progressId: f.progressId, workId: f.workId, status: 'completed', revision: 7,
      scene: { id: f.sceneId, deliveryState: 'ready', endingType: 'ai_generated',
        beats: [{ position: 1, content: { value: 'This is the stored ending.', locale: 'en' } }],
        visualManifest: { background: { state: 'ready', publicAssetPath: '/assets/story/ending.webp' } } },
      choices: [],
    });
    expect(f.prisma.storyReaderProgress.findFirst).toHaveBeenCalledWith({ where: { id: f.progressId, userId: f.userId } });
    expect(f.prisma.storyAiGeneratedScene.findFirst).toHaveBeenCalledWith({ where: {
      id: f.sceneId, progressId: f.progressId, workId: f.workId, releaseId: f.releaseId,
      status: 'ready', userId: f.userId, endingType: 'ai_generated',
    } });
    expect(f.visualGeneration.variantKeyForProgress).toHaveBeenCalledWith(f.progressId);
    expect(f.visualGeneration.readyVisuals).toHaveBeenCalledWith(f.workId, f.releaseId, [f.sceneKey], 'default');
    expectNoRecovery(f);
  });

  it.each(['pending', 'missing'] as const)('does not look up or repair %s prompts when recovery is false', async artwork => {
    const f = recoveryFixture(artwork);
    await expect(f.production.currentProgress(f.userId, f.progressId, 'en', false)).resolves.toMatchObject({
      status: 'completed', scene: { id: f.sceneId, deliveryState: 'artwork_unavailable',
        visualGenerationAvailable: false, endingType: null, beats: [] }, choices: [],
    });
    expect(f.visualGeneration.variantKeyForProgress).toHaveBeenCalledWith(f.progressId);
    expect(f.visualGeneration.readyVisuals).toHaveBeenCalledWith(f.workId, f.releaseId, [f.sceneKey], 'default');
    expectNoRecovery(f);
  });

  it('does not substitute ready artwork when the current variant is unavailable', async () => {
    const f = recoveryFixture('ready', null);
    await expect(f.production.currentProgress(f.userId, f.progressId, 'en', false)).resolves.toMatchObject({
      scene: { deliveryState: 'artwork_unavailable', endingType: null, beats: [] },
    });
    expect(f.visualGeneration.variantKeyForProgress).toHaveBeenCalledWith(f.progressId);
    expect(f.visualGeneration.readyVisuals).not.toHaveBeenCalled();
    expectNoRecovery(f);
  });

  it('preserves recovery for ordinary currentProgress calls that omit the fourth argument', async () => {
    const f = recoveryFixture('missing');
    await expect(f.production.currentProgress(f.userId, f.progressId, 'en')).resolves.toMatchObject({
      scene: { deliveryState: 'artwork_pending', visualGenerationAvailable: true, endingType: null, beats: [] },
    });
    expect(f.visualGeneration.promptKeys).toHaveBeenCalledTimes(1);
    expect(f.visualGeneration.promptKeys).toHaveBeenCalledWith(f.workId, f.releaseId, [f.sceneKey]);
    expect(f.promptWriteAttempt).toHaveBeenCalledTimes(1);
  });

  it('delegates preview through the real production projection with recovery disabled before rejecting missing artwork', async () => {
    const f = recoveryFixture('missing');
    const delegation = jest.spyOn(f.production, 'currentProgress');
    const reads = new StoryGeneratedEndingReadService(f.prisma as never, f.production);
    await expect(reads.preview(f.userId, f.progressId, { locale: 'en', fromPosition: 1 })).rejects.toMatchObject({
      response: { code: 'STORY_GENERATED_ENDING_READ_DELIVERY_UNAVAILABLE' },
    });
    expect(delegation).toHaveBeenCalledWith(f.userId, f.progressId, 'en', false);
    expect(f.prisma.storyAiGeneratedScene.findFirst).toHaveBeenCalledTimes(1);
    expect(f.visualGeneration.readyVisuals).toHaveBeenCalledTimes(1);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expectNoRecovery(f);
  });
});

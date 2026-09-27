import { StoryProductionService } from './story-production.service';

describe('generated ending reader projection', () => {
  it('returns the ending prose and no choices after the reader reloads', async () => {
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
      variantKeyForProgress: jest.fn().mockResolvedValue('default'),
      readyVisuals: jest.fn().mockResolvedValue(new Map([['ai-ending-scene', {
        sourceSceneKey: 'ai-ending-scene', publicAssetPath: '/assets/story/ending.webp',
      }]])),
      promptKeys: jest.fn().mockResolvedValue(new Set(['ai-ending-scene'])),
    };
    const service = new StoryProductionService(
      prisma as never, undefined, undefined, undefined, undefined, visualGeneration as never,
    );

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

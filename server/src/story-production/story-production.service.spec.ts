import 'reflect-metadata';
import { Decimal } from '@prisma/client/runtime/library';
import { StoryCatalogQueryDto } from './dto/story-production.dto';
import { StoryProductionService } from './story-production.service';

describe('StoryProductionService', () => {
  const prisma = {
    storyWork: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    storyPart: { findMany: jest.fn(), findUnique: jest.fn() },
    storyScene: { findFirst: jest.fn(), findMany: jest.fn() },
    storyBeat: { findMany: jest.fn() },
    storyChoice: { findMany: jest.fn() },
    storyReaderProgress: { findFirst: jest.fn() },
    storyRelease: { findMany: jest.fn(), findFirst: jest.fn() },
    userEntitlement: { findMany: jest.fn() },
    walletAccount: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const service = new StoryProductionService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('excludes production rows whose public manifest still points at a fixture', async () => {
    prisma.storyWork.findMany.mockResolvedValue([
      {
        id: '00000000-0000-0000-0000-000000000001',
        slug: 'fixture-story',
        defaultLocale: 'ko',
        title: { ko: 'Blocked' },
        summary: { ko: 'Blocked' },
        coverManifest: { url: '/public/story/blocked.webp' },
        priceLumina: new Decimal(10),
        fixtureSource: false,
        publishedAt: new Date(),
        activeReleaseId: '00000000-0000-0000-0000-000000000011',
      },
      {
        id: '00000000-0000-0000-0000-000000000002',
        slug: 'safe-story',
        defaultLocale: 'ko',
        title: { ko: 'Safe' },
        summary: { ko: 'Safe' },
        coverManifest: { url: '/fixtures/story/blocked.webp' },
        priceLumina: new Decimal(10),
        fixtureSource: false,
        publishedAt: new Date(),
        activeReleaseId: '00000000-0000-0000-0000-000000000012',
      },
    ]);
    prisma.storyRelease.findMany.mockResolvedValue([
      { id: '00000000-0000-0000-0000-000000000011' },
      { id: '00000000-0000-0000-0000-000000000012' },
    ]);

    const result = await service.catalog(undefined, new StoryCatalogQueryDto());

    expect(result.items).toEqual([]);
    expect(prisma.storyWork.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'published', fixtureSource: false }),
      }),
    );
  });

  it('does not enter a wallet transaction when an active work entitlement exists', async () => {
    const workId = '00000000-0000-0000-0000-000000000010';
    prisma.storyWork.findFirst.mockResolvedValue({
      id: workId,
      slug: 'paid-story',
      status: 'published',
      fixtureSource: false,
      coverManifest: { url: '/public/story/cover.webp' },
      priceLumina: new Decimal(100),
      activeReleaseId: '00000000-0000-0000-0000-000000000030',
    });
    prisma.storyRelease.findFirst.mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000030',
    });
    prisma.userEntitlement.findMany.mockResolvedValue([{ referenceId: workId }]);

    await expect(
      service.purchaseWork('00000000-0000-0000-0000-000000000020', workId, 'purchase-key-123'),
    ).resolves.toEqual({ entitled: true, charged: false, idempotentReplay: true });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.walletAccount.findUnique).not.toHaveBeenCalled();
  });

  it('returns a localized bounded graph and user-safe release warnings', async () => {
    prisma.storyWork.findFirst.mockResolvedValue({
      id: 'work-1',
      ownerUserId: 'owner-1',
      defaultLocale: 'ko',
      activeReleaseId: 'release-1',
    });
    prisma.storyPart.findMany.mockResolvedValue([
      {
        id: 'part-1',
        seasonKey: 'season-1',
        actNumber: 1,
        position: 1,
        status: 'published',
        title: { ko: '첫 장', en: 'Part One' },
      },
    ]);
    prisma.storyScene.findFirst.mockResolvedValue({
      id: 'scene-1',
      partId: 'part-1',
      sceneKey: 'opening',
      position: 1,
      status: 'published',
      title: { ko: '시작', en: 'Opening' },
      endingType: null,
    });
    prisma.storyChoice.findMany
      .mockResolvedValueOnce([
        {
          id: 'choice-1',
          choiceKey: 'advance',
          label: { ko: '전진', en: 'Advance' },
          targetSceneId: 'scene-2',
          targetEndingKey: null,
          routeKind: 'branch',
          declaredRejoinSceneId: null,
        },
      ])
      .mockResolvedValueOnce([]);
    prisma.storyScene.findMany
      .mockResolvedValueOnce([
        {
          id: 'scene-2',
          partId: 'part-1',
          sceneKey: 'advance',
          position: 2,
          status: 'published',
          title: { ko: '전진', en: 'Advance' },
          endingType: null,
        },
      ])
      .mockResolvedValueOnce([]);
    prisma.storyRelease.findFirst.mockResolvedValue({
      validationSummary: {
        ready: false,
        blockingIssueCount: 1,
        violationCodes: ['graph_cycle:internal-scene-id'],
      },
    });

    const result = await service.graph('owner-1', 'work-1', 'scene-1', 'en');

    expect(result.part.title).toEqual({
      value: 'Part One',
      locale: 'en',
      fallback: false,
    });
    expect(result.choices[0]).toMatchObject({
      label: { value: 'Advance', locale: 'en', fallback: false },
      nextScene: {
        id: 'scene-2',
        title: { value: 'Advance', locale: 'en', fallback: false },
      },
    });
    expect(result.validation).toEqual({
      status: 'needs_attention',
      blockingIssueCount: 1,
      warnings: [
        {
          code: 'graph_cycle',
          severity: 'error',
          messageKey: 'story.graph.warning.cycle',
        },
      ],
    });
    expect(JSON.stringify(result.validation)).not.toContain('internal-scene-id');
    expect(result.page).toEqual({
      bounded: true,
      maxChoices: 20,
      fullGraphIncluded: false,
    });
  });

  it('projects only safe visual manifest fields for current and next scenes', async () => {
    prisma.storyReaderProgress.findFirst.mockResolvedValue({
      id: 'progress-1',
      userId: 'reader-1',
      currentSceneId: 'scene-1',
      currentBeatPosition: 0,
      currentAct: 1,
      progressRevision: 2,
      storyVersion: 3,
      activeReleaseId: 'release-1',
      capabilityRevision: null,
      pathSummary: [],
      status: 'active',
    });
    prisma.storyScene.findFirst.mockResolvedValue({
      id: 'scene-1',
      partId: 'part-1',
      sceneKey: 'opening',
      title: { en: 'Opening' },
      status: 'published',
      fixtureSource: false,
      endingType: null,
      visualManifest: {
        sceneKey: 'opening',
        background: {
          publicAssetPath: '/assets/story/opening.webp',
          altKey: 'story.visual.opening',
          state: 'ready',
          storageKey: 'private/opening.webp',
        },
        characters: [],
        fallback: {
          publicAssetPath: '/assets/story/fallback.webp',
          altKey: 'story.visual.fallback',
        },
        providerPayload: { private: true },
      },
    });
    prisma.storyPart.findUnique.mockResolvedValue({
      id: 'part-1',
      workId: 'work-1',
      seasonKey: 'season-1',
      actNumber: 1,
      position: 1,
      status: 'published',
      title: { en: 'Part One' },
    });
    prisma.storyWork.findUnique.mockResolvedValue({
      id: 'work-1',
      status: 'published',
      defaultLocale: 'en',
    });
    prisma.storyBeat.findMany.mockResolvedValue([
      { id: 'beat-1', position: 1, beatType: 'narration', content: { en: 'Begin' } },
    ]);
    prisma.storyChoice.findMany.mockResolvedValue([
      {
        id: 'choice-1',
        label: { en: 'Continue' },
        targetSceneId: 'scene-2',
        routeKind: 'branch',
        declaredRejoinSceneId: null,
      },
    ]);
    prisma.storyScene.findMany.mockResolvedValue([
      {
        id: 'scene-2',
        sceneKey: 'next',
        title: { en: 'Next' },
        visualManifest: {
          sceneKey: 'next',
          background: { state: 'missing' },
          characters: [],
          fallback: {
            publicAssetPath: '/assets/story/fallback.webp',
            altKey: 'story.visual.fallback',
          },
        },
      },
    ]);

    const result = await service.currentProgress(
      'reader-1',
      'progress-1',
      'en',
    );

    expect(result).toMatchObject({
      part: {
        id: 'part-1',
        title: { value: 'Part One', locale: 'en', fallback: false },
      },
      scene: {
        visualManifest: {
          sceneKey: 'opening',
          background: {
            publicAssetPath: '/assets/story/opening.webp',
            state: 'ready',
          },
        },
      },
      choices: [
        {
          nextHint: {
            visualManifest: {
              sceneKey: 'next',
              background: {
                publicAssetPath: '/assets/story/fallback.webp',
                state: 'fallback',
              },
            },
          },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/storageKey|providerPayload/);
    expect(prisma.storyBeat.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 40 }),
    );
    expect(prisma.storyChoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 12 }),
    );
  });
});

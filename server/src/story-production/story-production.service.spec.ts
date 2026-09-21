import 'reflect-metadata';
import { Decimal } from '@prisma/client/runtime/library';
import { StoryCatalogQueryDto } from './dto/story-production.dto';
import { StoryProductionService } from './story-production.service';
import { firstReleaseChoiceCapability } from './story-progress-control.policy';

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
    storyReaderProgress: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    storyQualityEvent: { upsert: jest.fn() },
    storyRelease: { findMany: jest.fn(), findFirst: jest.fn() },
    userEntitlement: { findMany: jest.fn() },
    walletAccount: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const service = new StoryProductionService(prisma as never);

  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  const mockExistingStartContext = (storyVersion: number) => {
    const workId = '00000000-0000-0000-0000-000000000010';
    prisma.storyWork.findFirst.mockResolvedValue({
      id: workId,
      slug: 'imjin-war',
      status: 'published',
      fixtureSource: false,
      coverManifest: { url: '/public/story/imjin-war.webp' },
      priceLumina: new Decimal(0),
      publishedVersion: 1,
      activeReleaseId: '00000000-0000-0000-0000-000000000030',
    });
    prisma.storyRelease.findFirst.mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000030',
    });
    prisma.storyPart.findMany.mockResolvedValue([
      { id: 'part-1', actNumber: 1 },
      { id: 'part-66', actNumber: 4 },
    ]);
    prisma.storyReaderProgress.findUnique.mockResolvedValue({
      id: 'progress-1',
      storyVersion,
    });
    prisma.storyScene.findFirst.mockResolvedValue(null);
    return workId;
  };

  it('starts a new reader on the first scene of the first published part', async () => {
    const workId = '00000000-0000-0000-0000-000000000010';
    prisma.storyWork.findFirst.mockResolvedValue({
      id: workId,
      slug: 'imjin-war',
      status: 'published',
      fixtureSource: false,
      coverManifest: { url: '/public/story/imjin-war.webp' },
      priceLumina: new Decimal(0),
      publishedVersion: 1,
      activeReleaseId: '00000000-0000-0000-0000-000000000030',
    });
    prisma.storyRelease.findFirst.mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000030',
    });
    prisma.storyPart.findMany.mockResolvedValue([
      { id: 'part-1', actNumber: 1 },
      { id: 'part-66', actNumber: 4 },
    ]);
    prisma.storyScene.findFirst.mockResolvedValue({
      id: 'part-1-main',
      partId: 'part-1',
    });
    prisma.storyReaderProgress.findUnique.mockResolvedValue(null);
    prisma.storyReaderProgress.create.mockResolvedValue({
      id: 'progress-1',
      activeReleaseId: '00000000-0000-0000-0000-000000000030',
      storyVersion: 1,
    });
    prisma.storyQualityEvent.upsert.mockResolvedValue({});
    const currentProgress = jest
      .spyOn(service, 'currentProgress')
      .mockResolvedValue({ progressId: 'progress-1' } as never);

    await service.startProgress('reader-1', workId, { mode: 'continue', locale: 'ko' });

    expect(prisma.storyPart.findMany).toHaveBeenCalledWith({
      where: { workId, status: 'published', fixtureSource: false },
      select: { id: true, actNumber: true },
      orderBy: { position: 'asc' },
    });
    expect(prisma.storyScene.findFirst).toHaveBeenCalledWith({
      where: { partId: 'part-1', status: 'published', fixtureSource: false },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    expect(prisma.storyReaderProgress.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        currentSceneId: 'part-1-main',
        checkpointSceneId: 'part-1-main',
        seenSceneIds: ['part-1-main'],
        currentAct: 1,
      }),
    });
    expect(currentProgress).toHaveBeenCalledWith('reader-1', 'progress-1', 'ko');
  });

  it('continues existing progress before resolving the first published scene', async () => {
    const workId = mockExistingStartContext(1);
    const currentProgress = jest
      .spyOn(service, 'currentProgress')
      .mockResolvedValue({ progressId: 'progress-1' } as never);

    await expect(
      service.startProgress('reader-1', workId, { mode: 'continue', locale: 'ko' }),
    ).resolves.toEqual({ progressId: 'progress-1' });

    expect(currentProgress).toHaveBeenCalledWith('reader-1', 'progress-1', 'ko');
    expect(prisma.storyScene.findFirst).not.toHaveBeenCalled();
    expect(prisma.storyReaderProgress.create).not.toHaveBeenCalled();
  });

  it.each([
    ['restart', 'story.progress.reset.previewRequired'],
    ['checkpoint', 'story.progress.checkpoint.confirmRequired'],
  ] as const)(
    'requires the progress control command for existing %s mode before resolving a scene',
    async (mode, messageKey) => {
      const workId = mockExistingStartContext(1);

      await expect(
        service.startProgress('reader-1', workId, { mode, locale: 'ko' }),
      ).rejects.toMatchObject({
        response: {
          code: 'STORY_PROGRESS_CONTROL_COMMAND_REQUIRED',
          messageKey,
          retryable: true,
        },
      });

      expect(prisma.storyScene.findFirst).not.toHaveBeenCalled();
      expect(prisma.storyReaderProgress.create).not.toHaveBeenCalled();
    },
  );

  it('reports an existing progress version mismatch before resolving a scene', async () => {
    const workId = mockExistingStartContext(2);

    await expect(
      service.startProgress('reader-1', workId, { mode: 'continue', locale: 'ko' }),
    ).rejects.toMatchObject({
      response: {
        code: 'STORY_PROGRESS_VERSION_MISMATCH',
        messageKey: 'story.progress.status.versionMismatch',
        retryable: false,
      },
    });

    expect(prisma.storyScene.findFirst).not.toHaveBeenCalled();
    expect(prisma.storyReaderProgress.create).not.toHaveBeenCalled();
  });

  it('fails closed for new progress when the first published part has no scene', async () => {
    const workId = mockExistingStartContext(1);
    prisma.storyReaderProgress.findUnique.mockResolvedValue(null);

    await expect(
      service.startProgress('reader-1', workId, { mode: 'continue', locale: 'ko' }),
    ).rejects.toThrow('Published story scene not found');

    expect(prisma.storyScene.findFirst).toHaveBeenCalledWith({
      where: { partId: 'part-1', status: 'published', fixtureSource: false },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    expect(prisma.storyReaderProgress.create).not.toHaveBeenCalled();
  });

  it('returns only authenticated owner works as title-centered selector items', async () => {
    prisma.storyWork.findMany.mockResolvedValue([
      {
        id: '00000000-0000-0000-0000-000000000001',
        slug: 'owner-story',
        status: 'reviewing',
        defaultLocale: 'ko',
        title: { ko: 'Owner story' },
        summary: { ko: 'Summary' },
        activeReleaseId: null,
        publishedAt: null,
        updatedAt: new Date('2026-07-18T00:00:00.000Z'),
      },
    ]);

    const result = await service.creatorCatalog(
      '00000000-0000-0000-0000-000000000099',
      new StoryCatalogQueryDto(),
    );

    expect(result.items).toEqual([
      expect.objectContaining({
        workId: '00000000-0000-0000-0000-000000000001',
        slug: 'owner-story',
        title: expect.objectContaining({ value: 'Owner story' }),
        permissions: expect.objectContaining({
          createManuscript: true,
          publish: false,
        }),
      }),
    ]);
    expect(prisma.storyWork.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerUserId: '00000000-0000-0000-0000-000000000099',
          fixtureSource: false,
        },
      }),
    );
  });

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

  it('projects free catalog access as startable without a purchase action', async () => {
    prisma.storyWork.findMany.mockResolvedValue([
      {
        id: '00000000-0000-0000-0000-000000000001',
        slug: 'free-story',
        defaultLocale: 'ko',
        title: { ko: 'Free story' },
        summary: { ko: 'Summary' },
        coverManifest: { url: '/public/story/free.webp' },
        priceLumina: new Decimal(0),
        fixtureSource: false,
        publishedAt: new Date(),
        activeReleaseId: '00000000-0000-0000-0000-000000000011',
      },
    ]);
    prisma.storyRelease.findMany.mockResolvedValue([
      { id: '00000000-0000-0000-0000-000000000011' },
    ]);
    prisma.userEntitlement.findMany.mockResolvedValue([]);
    prisma.storyReaderProgress.findMany.mockResolvedValue([]);

    const result = await service.catalog(
      '00000000-0000-0000-0000-000000000099',
      new StoryCatalogQueryDto(),
    );

    expect(result.items[0].access).toMatchObject({
      status: 'free',
      entitled: true,
      entitlementGranted: false,
      priceLumina: null,
      purchaseAction: null,
      actions: { primary: 'start', canStart: true, canPurchase: false },
    });
  });

  it('returns a read-only reader access projection with price and replay state', async () => {
    const workId = '00000000-0000-0000-0000-000000000010';
    prisma.storyWork.findFirst.mockResolvedValue({
      id: workId,
      slug: 'paid-story',
      status: 'published',
      defaultLocale: 'ko',
      title: { ko: 'Paid story' },
      fixtureSource: false,
      coverManifest: { url: '/public/story/cover.webp' },
      priceLumina: new Decimal(120),
      activeReleaseId: '00000000-0000-0000-0000-000000000030',
      publishedAt: new Date(),
    });
    prisma.storyRelease.findFirst.mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000030',
    });
    prisma.userEntitlement.findMany.mockResolvedValue([{ referenceId: workId }]);
    prisma.storyReaderProgress.findUnique.mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000040',
      currentSceneId: '00000000-0000-0000-0000-000000000050',
      checkpointSceneId: null,
      visitedEndingKeys: ['ending-a'],
    });

    const result = await service.readerAccess(
      '00000000-0000-0000-0000-000000000099',
      workId,
      { locale: 'ko' },
    );

    expect(result).toMatchObject({
      workId,
      access: {
        status: 'entitled',
        pricing: { amountLumina: '120', currencyCode: 'LUMINA', free: false },
        actions: { primary: 'continue', canReset: true, canViewEndings: true },
      },
      replay: { continue: true, reset: true, endingCount: 1 },
      aiCapability: firstReleaseChoiceCapability(),
    });
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
    expect(prisma.storyScene.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'scene-1',
          partId: { in: ['part-1'] },
          fixtureSource: false,
        },
      }),
    );
  });

  it('opens the first scene of the first work-ordered part when no focus is provided', async () => {
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
        title: { ko: '첫 장' },
      },
      {
        id: 'part-14',
        seasonKey: 'season-1',
        actNumber: 1,
        position: 14,
        status: 'published',
        title: { ko: '열네 번째 장' },
      },
    ]);
    prisma.storyScene.findFirst.mockResolvedValue({
      id: 'part-1-main',
      partId: 'part-1',
      sceneKey: 'part-1-main',
      position: 1,
      status: 'published',
      title: { ko: '첫 장면' },
      endingType: null,
    });
    prisma.storyChoice.findMany.mockResolvedValue([]);
    prisma.storyScene.findMany.mockResolvedValue([]);
    prisma.storyRelease.findFirst.mockResolvedValue({ validationSummary: null });

    const result = await service.graph('owner-1', 'work-1');

    expect(result).toMatchObject({
      part: { id: 'part-1' },
      focus: { id: 'part-1-main' },
    });
    expect(prisma.storyScene.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { partId: 'part-1', fixtureSource: false },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('keeps the graph not-found response when the first part has no scene', async () => {
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
        title: { ko: '첫 장' },
      },
    ]);
    prisma.storyScene.findFirst.mockResolvedValue(null);

    await expect(service.graph('owner-1', 'work-1')).rejects.toThrow('Story scene not found');
    expect(prisma.storyScene.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { partId: 'part-1', fixtureSource: false },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      }),
    );
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
      expect.objectContaining({ take: 4 }),
    );
  });
});

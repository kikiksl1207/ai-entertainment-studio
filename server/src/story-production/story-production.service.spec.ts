import 'reflect-metadata';
import { Decimal } from '@prisma/client/runtime/library';
import { StoryCatalogQueryDto } from './dto/story-production.dto';
import { StoryProductionService } from './story-production.service';

describe('StoryProductionService', () => {
  const prisma = {
    storyWork: { findMany: jest.fn(), findFirst: jest.fn() },
    storyRelease: { findMany: jest.fn(), findFirst: jest.fn() },
    storyReaderProgress: { findMany: jest.fn(), findUnique: jest.fn() },
    userEntitlement: { findMany: jest.fn() },
    walletAccount: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const service = new StoryProductionService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

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
      aiCapability: null,
    });
  });
});

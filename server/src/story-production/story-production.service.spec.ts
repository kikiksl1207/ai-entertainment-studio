import 'reflect-metadata';
import { Decimal } from '@prisma/client/runtime/library';
import { StoryCatalogQueryDto } from './dto/story-production.dto';
import { StoryProductionService } from './story-production.service';

describe('StoryProductionService', () => {
  const prisma = {
    storyWork: { findMany: jest.fn(), findFirst: jest.fn() },
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
});

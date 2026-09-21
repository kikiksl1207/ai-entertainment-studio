import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PurchaseStoryWorkDto } from './dto/story-production.dto';
import { StoryProductionController } from './story-production.controller';
import { StoryProductionService } from './story-production.service';
import { Decimal } from '@prisma/client/runtime/library';

describe('Story purchase confirmation contract', () => {
  const confirmation = {
    confirmedPriceLumina: '120.50',
    expectedReleaseId: '00000000-0000-4000-8000-000000000030',
    expectedReleaseRevision: 3,
  };

  it('passes the body and key through the existing purchase endpoint', async () => {
    const purchaseWork = jest.fn().mockResolvedValue({ charged: true });
    const controller = new StoryProductionController({ purchaseWork } as never, {} as never);
    await controller.purchase({ id: 'reader' } as never, 'work', 'key', confirmation);
    expect(purchaseWork).toHaveBeenCalledWith('reader', 'work', 'key', confirmation);
  });

  it('allows absent confirmation for the service to decide free/owned/replay versus 409', async () => {
    expect(await validate(plainToInstance(PurchaseStoryWorkDto, {}))).toEqual([]);
    expect(await validate(plainToInstance(PurchaseStoryWorkDto, confirmation))).toEqual([]);
  });

  it.each([
    { confirmedPriceLumina: 120 }, { confirmedPriceLumina: '-1' },
    { confirmedPriceLumina: '1e2' }, { confirmedPriceLumina: '1.001' },
    { confirmedPriceLumina: '10000000000000000' }, { expectedReleaseId: 'bad' },
    { expectedReleaseRevision: 0 }, { expectedReleaseRevision: 1.2 },
    { expectedReleaseRevision: '3' },
  ])('rejects malformed confirmation %j', async (change) => {
    expect((await validate(plainToInstance(PurchaseStoryWorkDto, { ...confirmation, ...change }))).length)
      .toBeGreaterThan(0);
  });

  it('exposes the exact quoted price and work release revision on reader access', async () => {
    const prisma = {
      storyWork: { findFirst: jest.fn().mockResolvedValue({
        id: 'work', slug: 'purchase-story', title: { ko: 'Story' }, defaultLocale: 'ko',
        fixtureSource: false, coverManifest: {}, priceLumina: new Decimal('120.50'),
        activeReleaseId: confirmation.expectedReleaseId, releaseRevision: 3,
      }) },
      storyRelease: { findFirst: jest.fn().mockResolvedValue({ id: confirmation.expectedReleaseId }) },
      userEntitlement: { findMany: jest.fn().mockResolvedValue([]) },
      storyReaderProgress: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new StoryProductionService(prisma as never);
    const result = await service.readerAccess('reader', 'work', { locale: 'ko' });
    expect(result.access.purchaseConfirmation).toEqual({
      priceLumina: '120.5', releaseId: confirmation.expectedReleaseId, releaseRevision: 3,
    });
    expect(prisma.userEntitlement.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ revokedAt: null, startsAt: { lte: expect.any(Date) },
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] }),
    }));
  });
});

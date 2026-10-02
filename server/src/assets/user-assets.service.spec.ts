import { NotFoundException } from '@nestjs/common';
import { UserAssetsService } from './user-assets.service';

describe('UserAssetsService public delivery', () => {
  const assetId = '00000000-0000-4000-8000-000000000006';

  function fixture(metadata: Record<string, unknown>) {
    const prisma = { asset: { findFirst: jest.fn().mockResolvedValue({
      id: assetId,
      assetType: 'image',
      visibility: 'public',
      storageProvider: 'database',
      storageKey: 'public/regular.webp',
      metadata,
    }) } };
    const config = { get: jest.fn().mockReturnValue(undefined) };
    return { service: new UserAssetsService(prisma as never, config as never), prisma };
  }

  it.each(['original', 'display', 'thumbnail'])(
    'rejects story visual assets through the generic %s route', async variant => {
      const { service, prisma } = fixture({ storyVisual: { workId: 'work-id' } });
      await expect(service.getPublicAssetDeliveryUrl(assetId, variant))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.asset.findFirst).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects even a malformed story visual tag rather than falling back to public delivery', async () => {
    const { service } = fixture({ storyVisual: null });
    await expect(service.getPublicAssetDeliveryUrl(assetId))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('continues delivering an ordinary public image', async () => {
    const { service } = fixture({ lifecycle: { status: 'active' } });
    await expect(service.getPublicAssetDeliveryUrl(assetId))
      .resolves.toBe('public/regular.webp');
  });
});

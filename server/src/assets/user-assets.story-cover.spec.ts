import { BadRequestException } from '@nestjs/common';
import { UserAssetsService } from './user-assets.service';

describe('Story cover asset retention', () => {
  const assetId = '00000000-0000-4000-8000-000000000006';
  const userId = '00000000-0000-4000-8000-000000000007';

  function fixture(storyStatus: string, activeReleaseId: string | null) {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: assetId }]),
      asset: { findFirst: jest.fn().mockResolvedValue({ id: assetId,
        metadata: { uploadIntent: { createdByUserId: userId, status: 'uploaded' } } }),
        update: jest.fn() },
      userProfile: { findFirst: jest.fn().mockResolvedValue(null) },
      communityPostAsset: { findMany: jest.fn().mockResolvedValue([]) },
      storyWork: { findMany: jest.fn().mockResolvedValue([{
        id: 'story-id', status: storyStatus, activeReleaseId,
      }]), findFirst: jest.fn().mockResolvedValue(
        storyStatus === 'published' && activeReleaseId ? { id: 'story-id' } : null,
      ) },
      creatorImageRequest: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma = { ...tx, $transaction: jest.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)) };
    const service = new UserAssetsService(prisma as never, { get: jest.fn() } as never);
    return { prisma, service };
  }

  it('blocks even forced archive while a published story uses the cover', async () => {
    const { prisma, service } = fixture('published', 'release-id');
    await expect(service.archiveAsset(userId, assetId, { force: true }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.storyWork.findMany).toHaveBeenCalledWith({
      where: { ownerUserId: userId, coverManifest: { path: ['assetId'], equals: assetId } },
      select: { id: true, status: true, activeReleaseId: true }, take: 20,
    });
    expect(prisma.asset.update).not.toHaveBeenCalled();
  });

  it('finds a published cover beyond the capped usage list', async () => {
    const { prisma, service } = fixture('draft', null);
    prisma.storyWork.findMany.mockResolvedValue(Array.from({ length: 20 }, (_, index) => ({
      id: `draft-${index}`, status: 'draft', activeReleaseId: null,
    })));
    prisma.storyWork.findFirst.mockResolvedValue({ id: 'published-story' });
    await expect(service.archiveAsset(userId, assetId, { force: true }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.storyWork.findFirst).toHaveBeenCalledWith({
      where: { ownerUserId: userId, coverManifest: { path: ['assetId'], equals: assetId },
        status: 'published', activeReleaseId: { not: null } }, select: { id: true },
    });
    expect(prisma.asset.update).not.toHaveBeenCalled();
  });

  it('blocks ordinary archive for a draft cover too', async () => {
    const { prisma, service } = fixture('draft', null);
    await expect(service.archiveAsset(userId, assetId, {}))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.asset.update).not.toHaveBeenCalled();
  });
});

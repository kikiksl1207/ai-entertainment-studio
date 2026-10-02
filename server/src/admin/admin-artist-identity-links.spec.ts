import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

const artistId = '00000000-0000-4000-8000-000000000251';
const assetId = '00000000-0000-4000-8000-000000000252';
const userId = '00000000-0000-4000-8000-000000000253';

function fixture(size: bigint | null = 128n) {
  const asset = { id: assetId, assetType: 'image', visibility: 'public',
    fileSizeBytes: size, mimeType: 'image/webp', metadata: { lifecycle: { status: 'active' } } };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: artistId }]),
    artistAsset: { updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      upsert: jest.fn().mockResolvedValue({ id: 'link', artistId, assetId, usageType: 'cover', asset }) },
    auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit' }) },
  };
  const prisma = { artist: { findUnique: jest.fn().mockResolvedValue({ id: artistId }) },
    asset: { findUnique: jest.fn().mockResolvedValue(asset) },
    auditEvent: { create: jest.fn() },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)) };
  return { tx, prisma, service: new AdminService(prisma as unknown as PrismaService,
    new ConfigService({})) };
}

describe('Admin artist identity reference links', () => {
  it.each([null, 128n, 9007199254740993n])('audits and returns the exact %s byte count as JSON-safe decimal text', async size => {
    const f = fixture(size);
    const result = await f.service.linkArtistAsset({ id: userId }, artistId, {
      assetId, usageType: 'cover', isPrimary: true,
    });
    expect(result.asset.fileSizeBytes).toBe(size?.toString() ?? null);
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      actorType: 'admin', actorUserId: userId, action: 'artist_asset.link', targetId: artistId,
      afterData: expect.objectContaining({ asset: expect.objectContaining({ fileSizeBytes: size?.toString() ?? null }) }),
    }) }));
    expect(f.prisma.auditEvent.create).not.toHaveBeenCalled();
    expect(f.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(f.tx.artistAsset.updateMany.mock.invocationCallOrder[0]);
    expect(f.tx.artistAsset.upsert.mock.invocationCallOrder[0]).toBeLessThan(f.tx.auditEvent.create.mock.invocationCallOrder[0]);
  });

  it('does not return successful attachment data when its in-transaction audit fails', async () => {
    const f = fixture();
    f.tx.auditEvent.create.mockRejectedValue(new Error('Audit unavailable'));
    await expect(f.service.linkArtistAsset({ id: userId }, artistId, { assetId, isPrimary: true }))
      .rejects.toThrow('Audit unavailable');
    expect(f.prisma.auditEvent.create).not.toHaveBeenCalled();
  });
});

import { ForbiddenException } from '@nestjs/common';
import { CreatorStudioService } from './creator-studio.service';

const userId = '00000000-0000-4000-8000-000000000220';
const artistId = '00000000-0000-4000-8000-000000000221';
const period = '2026-05';

function serviceWithPrisma() {
  const prisma = {
    artistOperator: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    chatFeatureOrder: { findMany: jest.fn().mockResolvedValue([]) },
    giftOrder: { findMany: jest.fn().mockResolvedValue([]) },
    artistBoostEvent: { findMany: jest.fn().mockResolvedValue([]) },
    userPremiumVideoUnlock: { findMany: jest.fn().mockResolvedValue([]) },
    fanLetter: { findMany: jest.fn().mockResolvedValue([]) },
    settlementLuminaConversionRequest: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    },
  };
  const service = new CreatorStudioService(
    prisma as never,
    { get: jest.fn() } as never,
  );

  return { service, prisma };
}

const settlementPermission = { has: 'settlement:read' };

describe('CreatorStudioService settlement access', () => {
  it('excludes operators without owner settlement permission from the financial preview', async () => {
    const { service, prisma } = serviceWithPrisma();

    const result = await service.getSettlementPreview(userId, { period });

    expect(prisma.artistOperator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId,
          status: 'active',
          revokedAt: null,
          role: 'owner',
          permissions: settlementPermission,
        },
      }),
    );
    expect(result.items).toEqual([]);
    expect(result.totals.grossRevenueKrw.toString()).toBe('0');
    expect(prisma.chatFeatureOrder.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['artist', `artist:${artistId}:${period}`, artistId],
    ['partner', `partner:${userId}:${period}`, undefined],
  ])('rejects an unauthorized %s conversion before replay or creation', async (_, settlementKey, scopedArtistId) => {
    const { service, prisma } = serviceWithPrisma();

    await expect(
      service.createSettlementConversion(userId, {
        settlementKey,
        amountKrw: '1000',
        idempotencyKey: 'existing-request',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.artistOperator.findFirst).toHaveBeenCalledWith({
      where: {
        userId,
        ...(scopedArtistId ? { artistId: scopedArtistId } : {}),
        status: 'active',
        revokedAt: null,
        role: 'owner',
        permissions: settlementPermission,
      },
      select: { id: true },
    });
    expect(prisma.settlementLuminaConversionRequest.findFirst).not.toHaveBeenCalled();
    expect(prisma.settlementLuminaConversionRequest.create).not.toHaveBeenCalled();
  });

  it('keeps historical conversion lookup on general Creator Studio access', async () => {
    const { service, prisma } = serviceWithPrisma();
    prisma.artistOperator.findFirst.mockResolvedValue({ id: 'operator-without-settlement-read' });

    const result = await service.getSettlementConversions(userId, { period });

    expect(result.items).toEqual([]);
    expect(prisma.artistOperator.findFirst).toHaveBeenCalledWith({
      where: { userId, status: 'active', revokedAt: null },
      select: { id: true },
    });
    expect(prisma.settlementLuminaConversionRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { requesterUserId: userId, period } }),
    );
  });
});

import { BadRequestException, ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { FanLettersService } from '../fan-letters/fan-letters.service';
import { GiftsService } from '../gifts/gifts.service';
import { PremiumVideosService } from '../premium-videos/premium-videos.service';
import { UserGiftsService } from '../user-gifts/user-gifts.service';

const userId = '00000000-0000-4000-8000-000000000001';
const recipientUserId = '00000000-0000-4000-8000-000000000002';
const artistId = '00000000-0000-4000-8000-000000000003';
const productId = '00000000-0000-4000-8000-000000000004';

function basePrismaMock() {
  const tx = {
    fanLetter: {
      findUnique: jest.fn(),
    },
    giftOrder: {
      findUnique: jest.fn(),
    },
    premiumVideoProduct: {
      findFirst: jest.fn(),
    },
    userGiftTransfer: {
      findUnique: jest.fn(),
    },
    userPremiumVideoUnlock: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    walletAccount: {
      updateMany: jest.fn(),
    },
    walletLedger: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  const prisma = {
    artist: {
      findFirst: jest.fn(),
    },
    giftProduct: {
      findFirst: jest.fn(),
    },
    premiumVideoProduct: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };

  return { prisma, tx };
}

describe('paid wallet action idempotency safety', () => {
  it('requires idempotency before creating gift orders', async () => {
    const { prisma } = basePrismaMock();
    const service = new GiftsService(prisma as never);

    await expect(
      service.createGiftOrder(userId, {
        artistId,
        giftProductId: productId,
        quantity: 1,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'WALLET_MUTATION_IDEMPOTENCY_REQUIRED',
        messageKey: 'wallet.mutation.idempotencyRequired',
        walletMutation: false,
      },
    });
    expect(prisma.giftProduct.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects gift order key reuse with a different body before debit', async () => {
    const { prisma, tx } = basePrismaMock();
    const service = new GiftsService(prisma as never);
    prisma.giftProduct.findFirst.mockResolvedValue({
      id: productId,
      name: 'Gift',
      giftKind: 'instant',
      priceLumina: new Decimal(10),
      progressAmount: new Decimal(1),
      targetAmount: null,
      unlockAssetId: null,
      reactionAssetId: null,
    });
    tx.giftOrder.findUnique.mockResolvedValue({
      userId,
      artistId,
      giftProductId: productId,
      quantity: 2,
      totalLumina: new Decimal(20),
    });

    await expect(
      service.createGiftOrder(userId, {
        artistId,
        giftProductId: productId,
        quantity: 1,
        idempotencyKey: 'gift-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.walletAccount.updateMany).not.toHaveBeenCalled();
  });

  it('requires idempotency before creating fan letters', async () => {
    const { prisma } = basePrismaMock();
    const service = new FanLettersService(prisma as never, {} as never);
    prisma.artist.findFirst.mockResolvedValue({ id: artistId, displayName: 'Artist' });

    await expect(
      service.createFanLetter(userId, {
        artistId,
        body: 'This is a safe fan letter body.',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects fan letter key reuse with a different body before debit', async () => {
    const { prisma, tx } = basePrismaMock();
    const service = new FanLettersService(prisma as never, {} as never);
    prisma.artist.findFirst.mockResolvedValue({ id: artistId, displayName: 'Artist' });
    tx.fanLetter.findUnique.mockResolvedValue({
      senderUserId: userId,
      artistId,
      title: null,
      body: 'A different fan letter body.',
    });

    await expect(
      service.createFanLetter(userId, {
        artistId,
        body: 'This is a safe fan letter body.',
        idempotencyKey: 'fan-letter-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.walletAccount.updateMany).not.toHaveBeenCalled();
  });

  it('requires idempotency before premium video unlocks', async () => {
    const { prisma } = basePrismaMock();
    const service = new PremiumVideosService(prisma as never);

    await expect(service.unlock(userId, productId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.premiumVideoProduct.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects premium video key reuse for another product before debit', async () => {
    const { prisma, tx } = basePrismaMock();
    const service = new PremiumVideosService(prisma as never);
    prisma.premiumVideoProduct.findFirst.mockResolvedValue({
      id: productId,
      title: 'Video',
      priceLumina: new Decimal(50),
    });
    tx.walletLedger.findUnique.mockResolvedValue({
      id: 'ledger-1',
      walletAccountId: 'wallet-1',
      ledgerType: 'premium_video_spend',
      referenceType: 'premium_video_product',
      referenceId: '00000000-0000-4000-8000-000000000099',
      amount: new Decimal(50),
    });

    await expect(
      service.unlock(userId, productId, 'premium-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.walletAccount.updateMany).not.toHaveBeenCalled();
  });

  it('requires idempotency before user gift transfers', async () => {
    const { prisma } = basePrismaMock();
    const service = new UserGiftsService(prisma as never);

    await expect(
      service.createTransfer(userId, {
        recipientUserId,
        amountLumina: '10',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects user gift key reuse with a different body before debit', async () => {
    const { prisma, tx } = basePrismaMock();
    const service = new UserGiftsService(prisma as never);
    tx.userGiftTransfer.findUnique.mockResolvedValue({
      senderUserId: userId,
      recipientUserId,
      amountLumina: new Decimal(20),
      message: null,
    });

    await expect(
      service.createTransfer(userId, {
        recipientUserId,
        amountLumina: '10',
        idempotencyKey: 'user-gift-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.walletAccount.updateMany).not.toHaveBeenCalled();
  });
});

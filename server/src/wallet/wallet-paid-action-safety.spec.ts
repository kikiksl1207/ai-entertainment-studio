import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
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
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    artistReactionEvent: {
      create: jest.fn(),
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
      findUnique: jest.fn(),
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
    userBlock: {
      findFirst: jest.fn().mockResolvedValue(null),
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

  it('ignores client-submitted balance and price fields when debiting gift orders', async () => {
    const { prisma, tx } = basePrismaMock();
    const service = new GiftsService(prisma as never);
    prisma.giftProduct.findFirst.mockResolvedValue({
      id: productId,
      name: 'Server Gift',
      giftKind: 'instant',
      priceLumina: new Decimal(10),
      progressAmount: new Decimal(1),
      targetAmount: null,
      unlockAssetId: null,
      reactionAssetId: null,
    });
    tx.giftOrder.findUnique.mockResolvedValue(null);
    tx.walletAccount.findUnique.mockResolvedValue({
      id: 'wallet-1',
      status: 'active',
      cachedBalance: new Decimal(20),
    });
    tx.walletAccount.updateMany.mockResolvedValue({ count: 1 });
    tx.walletLedger.create.mockResolvedValue({ id: 'ledger-1' });
    tx.giftOrder.create.mockResolvedValue({
      id: 'order-1',
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
        quantity: 2,
        idempotencyKey: 'gift-server-price-1',
        balanceLumina: '999999',
        cachedBalance: '999999',
        priceLumina: '0',
        amountLumina: '0',
      } as any),
    ).resolves.toMatchObject({
      idempotentReplay: false,
    });

    expect(tx.walletAccount.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'wallet-1',
        cachedBalance: { gte: new Decimal(20) },
      },
      data: {
        cachedBalance: { decrement: new Decimal(20) },
      },
    });
    expect(tx.walletLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: new Decimal(20),
          ledgerType: 'gift_spend',
          idempotencyKey: 'wallet:gift-order:gift-server-price-1',
        }),
      }),
    );
  });

  it('fails closed on insufficient gift balance before ledger or order creation', async () => {
    const { prisma, tx } = basePrismaMock();
    const service = new GiftsService(prisma as never);
    prisma.giftProduct.findFirst.mockResolvedValue({
      id: productId,
      name: 'Server Gift',
      giftKind: 'instant',
      priceLumina: new Decimal(10),
      progressAmount: new Decimal(1),
      targetAmount: null,
      unlockAssetId: null,
      reactionAssetId: null,
    });
    tx.giftOrder.findUnique.mockResolvedValue(null);
    tx.walletAccount.findUnique.mockResolvedValue({
      id: 'wallet-1',
      status: 'active',
      cachedBalance: new Decimal(5),
    });
    tx.walletAccount.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.createGiftOrder(userId, {
        artistId,
        giftProductId: productId,
        quantity: 1,
        idempotencyKey: 'gift-insufficient-1',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'WALLET_MUTATION_INSUFFICIENT_BALANCE',
        messageKey: 'wallet.mutation.insufficientBalance',
        walletMutation: false,
      },
    });

    expect(tx.walletLedger.create).not.toHaveBeenCalled();
    expect(tx.giftOrder.create).not.toHaveBeenCalled();
    expect(tx.artistReactionEvent.create).not.toHaveBeenCalled();
  });

  it('replays duplicate gift order requests without a second debit', async () => {
    const { prisma, tx } = basePrismaMock();
    const service = new GiftsService(prisma as never);
    prisma.giftProduct.findFirst.mockResolvedValue({
      id: productId,
      name: 'Server Gift',
      giftKind: 'instant',
      priceLumina: new Decimal(10),
      progressAmount: new Decimal(1),
      targetAmount: null,
      unlockAssetId: null,
      reactionAssetId: null,
    });
    tx.giftOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      userId,
      artistId,
      giftProductId: productId,
      quantity: 2,
      totalLumina: new Decimal(20),
      walletLedger: { id: 'ledger-1' },
    });

    await expect(
      service.createGiftOrder(userId, {
        artistId,
        giftProductId: productId,
        quantity: 2,
        idempotencyKey: 'gift-replay-1',
      }),
    ).resolves.toMatchObject({
      idempotentReplay: true,
    });
    expect(tx.walletAccount.findUnique).not.toHaveBeenCalled();
    expect(tx.walletAccount.updateMany).not.toHaveBeenCalled();
    expect(tx.walletLedger.create).not.toHaveBeenCalled();
    expect(tx.giftOrder.create).not.toHaveBeenCalled();
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

  it('blocks user gift transfers between blocked users before wallet lookup', async () => {
    const { prisma, tx } = basePrismaMock();
    const service = new UserGiftsService(prisma as never);
    prisma.userBlock.findFirst.mockResolvedValue({ id: 'block-row' });

    await expect(
      service.createTransfer(userId, {
        recipientUserId,
        amountLumina: '10',
        idempotencyKey: 'user-gift-blocked',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'USER_GIFT_BLOCKED',
        messageKey: 'social.gift.blocked',
        walletMutation: false,
        luminaMutation: false,
        paymentMutation: false,
        settlementMutation: false,
      },
    });
    await expect(
      service.createTransfer(userId, {
        recipientUserId,
        amountLumina: '10',
        idempotencyKey: 'user-gift-blocked',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.walletAccount.findUnique).not.toHaveBeenCalled();
    expect(tx.walletAccount.updateMany).not.toHaveBeenCalled();
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

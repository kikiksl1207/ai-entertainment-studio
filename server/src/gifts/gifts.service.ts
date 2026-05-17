import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  requireWalletMutationIdempotencyKey,
  throwWalletMutationIdempotencyConflict,
} from '../common/wallet-mutation-safety';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_CURRENCY = 'LUMINA';

@Injectable()
export class GiftsService {
  constructor(private readonly prisma: PrismaService) {}

  getGiftProducts(artistId: string) {
    return this.prisma.giftProduct.findMany({
      where: {
        status: 'active',
        OR: [{ artistId }, { artistId: null }],
      },
      orderBy: [{ priceLumina: 'asc' }, { name: 'asc' }],
    });
  }

  async createGiftOrder(
    userId: string,
    input: {
      artistId: string;
      giftProductId: string;
      quantity?: number;
      idempotencyKey?: string;
    },
  ) {
    const quantity = this.parseQuantity(input.quantity);
    const idempotencyKey = requireWalletMutationIdempotencyKey(input.idempotencyKey);
    const giftProduct = await this.prisma.giftProduct.findFirst({
      where: {
        id: input.giftProductId,
        status: 'active',
        OR: [{ artistId: input.artistId }, { artistId: null }],
      },
    });

    if (!giftProduct) {
      throw new NotFoundException('Gift product not found');
    }

    const totalLumina = giftProduct.priceLumina.mul(quantity);

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existingOrder = await tx.giftOrder.findUnique({
        where: { idempotencyKey },
        include: { walletLedger: true },
      });

      if (existingOrder) {
        this.assertGiftOrderIdempotentReplay(existingOrder, {
          userId,
          artistId: input.artistId,
          giftProductId: giftProduct.id,
          quantity,
          totalLumina,
        });

        return { order: existingOrder, idempotentReplay: true };
      }

      const wallet = await tx.walletAccount.findUnique({
        where: {
          userId_currencyCode: {
            userId,
            currencyCode: DEFAULT_CURRENCY,
          },
        },
      });

      if (!wallet || wallet.status !== 'active') {
        throw new BadRequestException('Active wallet not found');
      }

      const updatedWallet = await tx.walletAccount.updateMany({
        where: {
          id: wallet.id,
          cachedBalance: { gte: totalLumina },
        },
        data: {
          cachedBalance: { decrement: totalLumina },
        },
      });

      if (updatedWallet.count !== 1) {
        throw new BadRequestException('Insufficient Lumina balance');
      }

      const ledger = await tx.walletLedger.create({
        data: {
          walletAccountId: wallet.id,
          direction: 'debit',
          amount: totalLumina,
          ledgerType: 'gift_spend',
          referenceType: 'gift_product',
          referenceId: giftProduct.id,
          idempotencyKey: `wallet:gift-order:${idempotencyKey}`,
          memo: `Gift order: ${giftProduct.name}`,
        },
      });

      const order = await tx.giftOrder.create({
        data: {
          userId,
          artistId: input.artistId,
          giftProductId: giftProduct.id,
          walletLedgerId: ledger.id,
          quantity,
          totalLumina,
          status: 'completed',
          idempotencyKey,
        },
        include: { walletLedger: true },
      });

      const progress = await this.applyGiftResult(tx, input.artistId, giftProduct, order.id, quantity);

      return {
        order,
        progress,
        idempotentReplay: false,
      };
    });
  }

  getGiftProgress(artistId: string) {
    return this.prisma.artistGiftProgress.findMany({
      where: { artistId },
      include: { giftProduct: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  getReactionEvents(artistId: string) {
    return this.prisma.artistReactionEvent.findMany({
      where: { artistId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  getEquippedItems(artistId: string) {
    return this.prisma.artistEquippedItem.findMany({
      where: { artistId, status: 'equipped' },
      orderBy: { equippedAt: 'desc' },
    });
  }

  private async applyGiftResult(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    artistId: string,
    giftProduct: {
      id: string;
      name: string;
      giftKind: string;
      progressAmount: Decimal;
      targetAmount: Decimal | null;
      unlockAssetId: string | null;
      reactionAssetId: string | null;
    },
    giftOrderId: string,
    quantity: number,
  ) {
    if (giftProduct.giftKind === 'instant') {
      await tx.artistReactionEvent.create({
        data: {
          artistId,
          giftOrderId,
          reactionType: 'gift_instant',
          assetId: giftProduct.reactionAssetId,
          message: `${giftProduct.name} gift received`,
        },
      });

      return null;
    }

    if (!giftProduct.targetAmount) {
      throw new BadRequestException('Progressive gift product is missing target amount');
    }

    const progressAmount = giftProduct.progressAmount.mul(quantity);
    const progress = await tx.artistGiftProgress.upsert({
      where: {
        artistId_giftProductId: {
          artistId,
          giftProductId: giftProduct.id,
        },
      },
      update: {
        currentAmount: { increment: progressAmount },
      },
      create: {
        artistId,
        giftProductId: giftProduct.id,
        currentAmount: progressAmount,
        targetAmount: giftProduct.targetAmount,
      },
    });

    const unlocked = !progress.unlockedAt && progress.currentAmount.gte(progress.targetAmount);

    if (unlocked) {
      await tx.artistGiftProgress.update({
        where: { id: progress.id },
        data: { unlockedAt: new Date() },
      });
    }

    await tx.artistReactionEvent.create({
      data: {
        artistId,
        giftOrderId,
        reactionType: unlocked ? 'gift_unlock' : 'gift_progress',
        assetId: unlocked ? giftProduct.unlockAssetId : giftProduct.reactionAssetId,
        message: unlocked
          ? `${giftProduct.name} unlocked`
          : `${giftProduct.name} progress increased`,
      },
    });

    return tx.artistGiftProgress.findUnique({
      where: { id: progress.id },
    });
  }

  private parseQuantity(value?: number) {
    const quantity = value ?? 1;

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new BadRequestException('quantity must be an integer between 1 and 99');
    }

    return quantity;
  }

  private assertGiftOrderIdempotentReplay(
    order: {
      userId: string;
      artistId: string;
      giftProductId: string;
      quantity: number;
      totalLumina: Decimal;
    },
    expected: {
      userId: string;
      artistId: string;
      giftProductId: string;
      quantity: number;
      totalLumina: Decimal;
    },
  ) {
    if (
      order.userId === expected.userId &&
      order.artistId === expected.artistId &&
      order.giftProductId === expected.giftProductId &&
      order.quantity === expected.quantity &&
      order.totalLumina.equals(expected.totalLumina)
    ) {
      return;
    }

    throwWalletMutationIdempotencyConflict();
  }
}

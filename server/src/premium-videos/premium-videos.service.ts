import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_CURRENCY = 'LUMINA';

@Injectable()
export class PremiumVideosService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.premiumVideoProduct.findMany({
      where: { status: 'active' },
      include: {
        artist: {
          select: { id: true, slug: true, displayName: true },
        },
        assets: {
          where: { role: { in: ['thumbnail', 'preview'] } },
          include: { asset: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(productId: string) {
    const product = await this.prisma.premiumVideoProduct.findFirst({
      where: { id: productId, status: 'active' },
      include: {
        artist: {
          select: { id: true, slug: true, displayName: true },
        },
        assets: {
          where: { role: { in: ['thumbnail', 'preview'] } },
          include: { asset: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Premium video product not found');
    }

    return product;
  }

  async unlock(userId: string, productId: string, idempotencyKey?: string) {
    const product = await this.prisma.premiumVideoProduct.findFirst({
      where: { id: productId, status: 'active' },
    });

    if (!product) {
      throw new NotFoundException('Premium video product not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const existingUnlock = await tx.userPremiumVideoUnlock.findUnique({
        where: {
          userId_premiumVideoProductId: {
            userId,
            premiumVideoProductId: product.id,
          },
        },
      });

      if (existingUnlock) {
        return { unlock: existingUnlock, idempotentReplay: true };
      }

      if (idempotencyKey) {
        const existingLedger = await tx.walletLedger.findUnique({
          where: { idempotencyKey: `premium-video:${idempotencyKey}` },
        });

        if (existingLedger) {
          const replayedUnlock = await tx.userPremiumVideoUnlock.findFirst({
            where: { walletLedgerId: existingLedger.id },
          });
          return { unlock: replayedUnlock, idempotentReplay: true };
        }
      }

      const wallet = await tx.walletAccount.findUnique({
        where: {
          userId_currencyCode: { userId, currencyCode: DEFAULT_CURRENCY },
        },
      });

      if (!wallet || wallet.status !== 'active') {
        throw new BadRequestException('Active wallet not found');
      }

      const updatedWallet = await tx.walletAccount.updateMany({
        where: { id: wallet.id, cachedBalance: { gte: product.priceLumina } },
        data: { cachedBalance: { decrement: product.priceLumina } },
      });

      if (updatedWallet.count !== 1) {
        throw new BadRequestException('Insufficient Lumina balance');
      }

      const ledger = await tx.walletLedger.create({
        data: {
          walletAccountId: wallet.id,
          direction: 'debit',
          amount: product.priceLumina,
          ledgerType: 'premium_video_spend',
          referenceType: 'premium_video_product',
          referenceId: product.id,
          idempotencyKey: idempotencyKey
            ? `premium-video:${idempotencyKey}`
            : undefined,
          memo: `Premium video unlock: ${product.title}`,
        },
      });

      const unlock = await tx.userPremiumVideoUnlock.create({
        data: {
          userId,
          premiumVideoProductId: product.id,
          walletLedgerId: ledger.id,
        },
      });

      await tx.userEntitlement.create({
        data: {
          userId,
          entitlementType: 'premium_video',
          referenceType: 'premium_video_product',
          referenceId: product.id,
          grantedByReferenceType: 'wallet_ledger',
          grantedByReferenceId: ledger.id,
        },
      });

      return { unlock, idempotentReplay: false };
    });
  }

  findMyUnlocks(userId: string) {
    return this.prisma.userPremiumVideoUnlock.findMany({
      where: { userId },
      include: {
        premiumVideoProduct: {
          include: {
            artist: {
              select: { id: true, slug: true, displayName: true },
            },
            assets: {
              include: { asset: true },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
      orderBy: { unlockedAt: 'desc' },
    });
  }
}

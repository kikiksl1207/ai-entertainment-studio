import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_CURRENCY = 'LUMINA';
const MIN_USER_GIFT_LUMINA = new Decimal(10);
const MAX_USER_GIFT_LUMINA = new Decimal(100000);

@Injectable()
export class UserGiftsService {
  constructor(private readonly prisma: PrismaService) {}

  async createTransfer(
    senderUserId: string,
    input: {
      recipientUserId: string;
      amountLumina: string;
      message?: string;
      idempotencyKey?: string;
    },
  ) {
    const amount = this.parseAmount(input.amountLumina);

    if (senderUserId === input.recipientUserId) {
      throw new BadRequestException('Cannot send Lumina to yourself');
    }

    return this.prisma.$transaction(async (tx) => {
      if (input.idempotencyKey) {
        const existingTransfer = await tx.userGiftTransfer.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });

        if (existingTransfer) {
          return {
            transfer: existingTransfer,
            idempotentReplay: true,
          };
        }
      }

      const [senderWallet, recipientWallet, recipientUser] = await Promise.all([
        tx.walletAccount.findUnique({
          where: {
            userId_currencyCode: {
              userId: senderUserId,
              currencyCode: DEFAULT_CURRENCY,
            },
          },
        }),
        tx.walletAccount.findUnique({
          where: {
            userId_currencyCode: {
              userId: input.recipientUserId,
              currencyCode: DEFAULT_CURRENCY,
            },
          },
        }),
        tx.user.findFirst({
          where: {
            id: input.recipientUserId,
            status: 'active',
            deletedAt: null,
          },
          select: { id: true },
        }),
      ]);

      if (!recipientUser) {
        throw new NotFoundException('Recipient user not found');
      }

      if (!senderWallet || senderWallet.status !== 'active') {
        throw new BadRequestException('Active sender wallet not found');
      }

      if (!recipientWallet || recipientWallet.status !== 'active') {
        throw new BadRequestException('Active recipient wallet not found');
      }

      const transfer = await tx.userGiftTransfer.create({
        data: {
          senderUserId,
          recipientUserId: input.recipientUserId,
          amountLumina: amount,
          message: input.message || undefined,
          status: 'pending',
          idempotencyKey: input.idempotencyKey,
        },
      });

      const debitResult = await tx.walletAccount.updateMany({
        where: {
          id: senderWallet.id,
          status: 'active',
          cachedBalance: { gte: amount },
        },
        data: {
          cachedBalance: { decrement: amount },
        },
      });

      if (debitResult.count !== 1) {
        throw new BadRequestException('Insufficient Lumina balance');
      }

      await tx.walletAccount.update({
        where: { id: recipientWallet.id },
        data: {
          cachedBalance: { increment: amount },
        },
      });

      const [senderLedger, recipientLedger] = await Promise.all([
        tx.walletLedger.create({
          data: {
            walletAccountId: senderWallet.id,
            direction: 'debit',
            amount,
            ledgerType: 'user_gift_send',
            referenceType: 'user_gift_transfer',
            referenceId: transfer.id,
            idempotencyKey: input.idempotencyKey
              ? `wallet:user_gift_send:${input.idempotencyKey}`
              : undefined,
            memo: 'User gift sent',
          },
        }),
        tx.walletLedger.create({
          data: {
            walletAccountId: recipientWallet.id,
            direction: 'credit',
            amount,
            ledgerType: 'user_gift_receive',
            referenceType: 'user_gift_transfer',
            referenceId: transfer.id,
            idempotencyKey: input.idempotencyKey
              ? `wallet:user_gift_receive:${input.idempotencyKey}`
              : undefined,
            memo: 'User gift received',
          },
        }),
      ]);

      const completedTransfer = await tx.userGiftTransfer.update({
        where: { id: transfer.id },
        data: {
          senderLedgerId: senderLedger.id,
          recipientLedgerId: recipientLedger.id,
          status: 'completed',
        },
      });

      return {
        transfer: completedTransfer,
        senderLedger,
        recipientLedger,
        idempotentReplay: false,
      };
    });
  }

  getSentTransfers(userId: string) {
    return this.prisma.userGiftTransfer.findMany({
      where: { senderUserId: userId },
      include: {
        recipient: {
          select: {
            id: true,
            profile: { select: { displayName: true, avatarAssetId: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  getReceivedTransfers(userId: string) {
    return this.prisma.userGiftTransfer.findMany({
      where: { recipientUserId: userId },
      include: {
        sender: {
          select: {
            id: true,
            profile: { select: { displayName: true, avatarAssetId: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  private parseAmount(value: string) {
    const amount = new Decimal(value);

    if (!amount.isFinite()) {
      throw new BadRequestException('amountLumina must be a valid number');
    }

    const normalizedAmount = amount.toDecimalPlaces(2);

    if (normalizedAmount.lt(MIN_USER_GIFT_LUMINA)) {
      throw new BadRequestException('amountLumina must be at least 10');
    }

    if (normalizedAmount.gt(MAX_USER_GIFT_LUMINA)) {
      throw new BadRequestException('amountLumina must be at most 100000');
    }

    return normalizedAmount;
  }
}

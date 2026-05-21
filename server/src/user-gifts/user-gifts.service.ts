import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  assertAtomicWalletDebitSucceeded,
  requireWalletMutationIdempotencyKey,
  throwWalletMutationIdempotencyConflict,
} from '../common/wallet-mutation-safety';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_CURRENCY = 'LUMINA';
const MIN_USER_GIFT_LUMINA = new Decimal(10);
const MAX_USER_GIFT_LUMINA = new Decimal(100000);
const DAILY_USER_GIFT_COUNT_LIMIT = 20;
const DAILY_USER_GIFT_LUMINA_LIMIT = new Decimal(100000);
const MONTHLY_USER_GIFT_LUMINA_LIMIT = new Decimal(1000000);

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
    const idempotencyKey = requireWalletMutationIdempotencyKey(input.idempotencyKey);

    if (senderUserId === input.recipientUserId) {
      throw new BadRequestException('Cannot send Lumina to yourself');
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existingTransfer = await tx.userGiftTransfer.findUnique({
        where: { idempotencyKey },
      });

      if (existingTransfer) {
        this.assertUserGiftIdempotentReplay(existingTransfer, {
          senderUserId,
          recipientUserId: input.recipientUserId,
          amountLumina: amount,
          message: input.message || null,
        });

        return {
          transfer: existingTransfer,
          idempotentReplay: true,
        };
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

      await this.enforceSenderLimits(tx, senderUserId, amount);

      const transfer = await tx.userGiftTransfer.create({
        data: {
          senderUserId,
          recipientUserId: input.recipientUserId,
          amountLumina: amount,
          message: input.message || undefined,
          status: 'pending',
          idempotencyKey,
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

      assertAtomicWalletDebitSucceeded(debitResult);

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
            idempotencyKey: `wallet:user_gift_send:${idempotencyKey}`,
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
            idempotencyKey: `wallet:user_gift_receive:${idempotencyKey}`,
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
            profile: {
              select: {
                displayName: true,
                publicHandle: true,
                avatarAssetId: true,
              },
            },
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
            profile: {
              select: {
                displayName: true,
                publicHandle: true,
                avatarAssetId: true,
              },
            },
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

  private assertUserGiftIdempotentReplay(
    transfer: {
      senderUserId: string;
      recipientUserId: string;
      amountLumina: Decimal;
      message: string | null;
    },
    expected: {
      senderUserId: string;
      recipientUserId: string;
      amountLumina: Decimal;
      message: string | null;
    },
  ) {
    if (
      transfer.senderUserId === expected.senderUserId &&
      transfer.recipientUserId === expected.recipientUserId &&
      transfer.amountLumina.equals(expected.amountLumina) &&
      (transfer.message ?? null) === expected.message
    ) {
      return;
    }

    throwWalletMutationIdempotencyConflict();
  }

  private async enforceSenderLimits(
    tx: Prisma.TransactionClient,
    senderUserId: string,
    amount: Decimal,
  ) {
    const [dailySent, monthlySent] = await Promise.all([
      tx.userGiftTransfer.aggregate({
        where: {
          senderUserId,
          status: 'completed',
          createdAt: { gte: this.startOfKoreanDay() },
        },
        _count: { _all: true },
        _sum: { amountLumina: true },
      }),
      tx.userGiftTransfer.aggregate({
        where: {
          senderUserId,
          status: 'completed',
          createdAt: { gte: this.startOfKoreanMonth() },
        },
        _sum: { amountLumina: true },
      }),
    ]);

    if ((dailySent._count._all ?? 0) >= DAILY_USER_GIFT_COUNT_LIMIT) {
      throw new BadRequestException('Daily user gift count limit exceeded');
    }

    const dailyTotal = new Decimal(dailySent._sum.amountLumina ?? 0).plus(amount);
    if (dailyTotal.gt(DAILY_USER_GIFT_LUMINA_LIMIT)) {
      throw new BadRequestException('Daily user gift Lumina limit exceeded');
    }

    const monthlyTotal = new Decimal(monthlySent._sum.amountLumina ?? 0).plus(amount);
    if (monthlyTotal.gt(MONTHLY_USER_GIFT_LUMINA_LIMIT)) {
      throw new BadRequestException('Monthly user gift Lumina limit exceeded');
    }
  }

  private startOfKoreanDay() {
    return this.koreanDateBoundary({ day: '2-digit' });
  }

  private startOfKoreanMonth() {
    return this.koreanDateBoundary({ day: undefined });
  }

  private koreanDateBoundary(options: { day?: '2-digit' }) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      ...(options.day ? { day: options.day } : {}),
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = options.day
      ? parts.find((part) => part.type === 'day')?.value
      : '01';

    return new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  }
}

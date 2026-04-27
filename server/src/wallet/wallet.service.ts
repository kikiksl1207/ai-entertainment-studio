import { BadRequestException, Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_CURRENCY = 'LUMINA';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateWallet(userId: string) {
    await this.ensureActiveUser(userId);

    return this.prisma.walletAccount.upsert({
      where: {
        userId_currencyCode: {
          userId,
          currencyCode: DEFAULT_CURRENCY,
        },
      },
      update: {},
      create: {
        userId,
        currencyCode: DEFAULT_CURRENCY,
      },
    });
  }

  async getLedger(userId: string, takeQuery?: string) {
    const wallet = await this.getOrCreateWallet(userId);
    const take = this.parseTake(takeQuery);

    return this.prisma.walletLedger.findMany({
      where: { walletAccountId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async grantForLocalTesting(
    userId: string,
    input: {
      amount?: number | string;
      memo?: string;
      idempotencyKey?: string;
    },
  ) {
    const amount = this.parseAmount(input.amount);
    const wallet = await this.getOrCreateWallet(userId);

    return this.prisma.$transaction(async (tx) => {
      if (input.idempotencyKey) {
        const existingLedger = await tx.walletLedger.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });

        if (existingLedger) {
          return {
            wallet: await tx.walletAccount.findUniqueOrThrow({
              where: { id: wallet.id },
            }),
            ledger: existingLedger,
            idempotentReplay: true,
          };
        }
      }

      const updatedWallet = await tx.walletAccount.update({
        where: { id: wallet.id },
        data: {
          cachedBalance: {
            increment: amount,
          },
        },
      });

      const ledger = await tx.walletLedger.create({
        data: {
          walletAccountId: wallet.id,
          direction: 'credit',
          amount,
          ledgerType: 'event_grant',
          referenceType: 'local_test',
          idempotencyKey: input.idempotencyKey,
          memo: input.memo ?? 'Local test Lumina grant',
        },
      });

      return {
        wallet: updatedWallet,
        ledger,
        idempotentReplay: false,
      };
    });
  }

  private async ensureActiveUser(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        status: 'active',
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!user) {
      throw new BadRequestException('Active user not found');
    }
  }

  private parseAmount(value: number | string | undefined) {
    const amount = new Decimal(value ?? 0);

    if (!amount.isFinite() || amount.lte(0)) {
      throw new BadRequestException('amount must be greater than 0');
    }

    return amount.toDecimalPlaces(2);
  }

  private parseTake(value?: string) {
    if (!value) {
      return 50;
    }

    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      throw new BadRequestException('take must be an integer between 1 and 100');
    }

    return parsed;
  }
}

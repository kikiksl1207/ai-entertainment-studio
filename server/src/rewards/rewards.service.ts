import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_CURRENCY = 'LUMINA';
const DAILY_ATTENDANCE_REWARD_LUMINA = new Decimal(100);

@Injectable()
export class RewardsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateReferralCode(userId: string) {
    await this.ensureActiveUser(userId);

    const existingCode = await this.prisma.userReferralCode.findUnique({
      where: { userId },
    });

    if (existingCode) {
      return existingCode;
    }

    return this.prisma.userReferralCode.create({
      data: {
        userId,
        code: await this.generateReferralCode(),
      },
    });
  }

  getReferralRewards(userId: string) {
    return this.prisma.referralReward.findMany({
      where: { referrerUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async claimDailyAttendance(userId: string) {
    await this.ensureActiveUser(userId);
    const serviceDate = this.getKoreanServiceDate();
    const idempotencyKey = `daily_attendance:${userId}:${this.formatServiceDate(serviceDate)}`;

    return this.prisma.$transaction(async (tx) => {
      const existingReward = await tx.dailyAttendanceReward.findUnique({
        where: {
          userId_serviceDate: {
            userId,
            serviceDate,
          },
        },
      });

      if (existingReward) {
        return {
          reward: existingReward,
          idempotentReplay: true,
        };
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

      const ledger = await tx.walletLedger.create({
        data: {
          walletAccountId: wallet.id,
          direction: 'credit',
          amount: DAILY_ATTENDANCE_REWARD_LUMINA,
          ledgerType: 'daily_attendance',
          referenceType: 'user',
          referenceId: userId,
          idempotencyKey,
          memo: 'Daily attendance reward',
        },
      });

      await tx.walletAccount.update({
        where: { id: wallet.id },
        data: {
          cachedBalance: {
            increment: DAILY_ATTENDANCE_REWARD_LUMINA,
          },
        },
      });

      const reward = await tx.dailyAttendanceReward.create({
        data: {
          userId,
          serviceDate,
          rewardLumina: DAILY_ATTENDANCE_REWARD_LUMINA,
          walletLedgerId: ledger.id,
          idempotencyKey,
        },
      });

      return {
        reward,
        ledger,
        idempotentReplay: false,
      };
    });
  }

  getDailyAttendanceHistory(userId: string) {
    return this.prisma.dailyAttendanceReward.findMany({
      where: { userId },
      orderBy: { serviceDate: 'desc' },
      take: 31,
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

  private async generateReferralCode() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = `LS-${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
      const existingCode = await this.prisma.userReferralCode.findUnique({
        where: { code },
        select: { id: true },
      });

      if (!existingCode) {
        return code;
      }
    }

    throw new BadRequestException('Failed to generate referral code');
  }

  private getKoreanServiceDate() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;

    return new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  }

  private formatServiceDate(value: Date) {
    return value.toISOString().slice(0, 10);
  }
}

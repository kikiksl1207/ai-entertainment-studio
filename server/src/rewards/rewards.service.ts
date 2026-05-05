import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_CURRENCY = 'LUMINA';
const DAILY_ATTENDANCE_REWARD_SCHEDULE = [10, 10, 20, 20, 20, 20, 50] as const;
const DAILY_ATTENDANCE_POLICY_STARTED_AT = '2026-05-05';

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
    const priorConsecutiveDays = await this.countPriorConsecutiveAttendanceDays(
      userId,
      serviceDate,
    );
    const streakDay = priorConsecutiveDays + 1;
    const cycleDay = ((streakDay - 1) % DAILY_ATTENDANCE_REWARD_SCHEDULE.length) + 1;
    const rewardAmount = new Decimal(DAILY_ATTENDANCE_REWARD_SCHEDULE[cycleDay - 1]);

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
          policy: this.getDailyAttendancePolicy(),
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
          amount: rewardAmount,
          ledgerType: 'daily_attendance',
          referenceType: 'user',
          referenceId: userId,
          idempotencyKey,
          memo: `Daily attendance reward day ${cycleDay}`,
        },
      });

      await tx.walletAccount.update({
        where: { id: wallet.id },
        data: {
          cachedBalance: {
            increment: rewardAmount,
          },
        },
      });

      const reward = await tx.dailyAttendanceReward.create({
        data: {
          userId,
          serviceDate,
          rewardLumina: rewardAmount,
          walletLedgerId: ledger.id,
          idempotencyKey,
        },
      });

      return {
        reward,
        ledger,
        idempotentReplay: false,
        streak: {
          day: streakDay,
          cycleDay,
          cycleLength: DAILY_ATTENDANCE_REWARD_SCHEDULE.length,
        },
        policy: this.getDailyAttendancePolicy(),
      };
    });
  }

  getDailyAttendancePolicy() {
    const schedule = DAILY_ATTENDANCE_REWARD_SCHEDULE.map((amount, index) => ({
      day: index + 1,
      rewardLumina: amount,
      rewardKrwEquivalent: amount * 10,
    }));

    return {
      currencyCode: DEFAULT_CURRENCY,
      unitPriceKrw: 10,
      startedAt: DAILY_ATTENDANCE_POLICY_STARTED_AT,
      resetTimezone: 'Asia/Seoul',
      schedule,
      cycleLength: schedule.length,
      cycleTotalLumina: schedule.reduce((sum, item) => sum + item.rewardLumina, 0),
      cycleTotalKrwEquivalent: schedule.reduce(
        (sum, item) => sum + item.rewardKrwEquivalent,
        0,
      ),
      antiAbuse: {
        oneClaimPerServiceDate: true,
        serviceDateTimezone: 'Asia/Seoul',
        promoLedgerReason: 'daily_attendance',
      },
      note:
        'Attendance rewards are small promo rewards for activation, not creator settlement revenue.',
    };
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

  private async countPriorConsecutiveAttendanceDays(userId: string, serviceDate: Date) {
    const rewards = await this.prisma.dailyAttendanceReward.findMany({
      where: {
        userId,
        serviceDate: { lt: serviceDate },
      },
      orderBy: { serviceDate: 'desc' },
      take: 30,
    });
    let cursor = this.addServiceDays(serviceDate, -1);
    let count = 0;

    for (const reward of rewards) {
      if (this.formatServiceDate(reward.serviceDate) !== this.formatServiceDate(cursor)) {
        break;
      }

      count += 1;
      cursor = this.addServiceDays(cursor, -1);
    }

    return count;
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

  private addServiceDays(value: Date, days: number) {
    const next = new Date(value);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  }
}

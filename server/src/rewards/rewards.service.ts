import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_CURRENCY = 'LUMINA';
const DAILY_ATTENDANCE_REWARD_SCHEDULE = [10, 10, 20, 20, 20, 20, 50] as const;
const DAILY_ATTENDANCE_POLICY_STARTED_AT = '2026-05-05';
const LUMINA_UNIT_PRICE_KRW = 10;
const FREE_PROMO_REWARD_CAP_LUMINA = 3000;
const PAID_BONUS_CAP_RATE = 0.2;
const PROMO_REWARD_LEDGER_TYPES = [
  'signup_bonus',
  'referral_reward',
  'daily_attendance',
  'identity_verification_bonus',
  'birthday_bonus',
  'achievement_reward',
  'quest_reward',
  'profile_completion_reward',
] as const;

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

  getActivationPolicy() {
    const dailyAttendance = this.getDailyAttendancePolicy();

    return {
      currencyCode: DEFAULT_CURRENCY,
      unitPriceKrw: LUMINA_UNIT_PRICE_KRW,
      launchCaps: {
        freePromoRewardCapLumina: FREE_PROMO_REWARD_CAP_LUMINA,
        freePromoRewardCapKrwEquivalent:
          FREE_PROMO_REWARD_CAP_LUMINA * LUMINA_UNIT_PRICE_KRW,
        paidBonusCapRate: PAID_BONUS_CAP_RATE,
        paidBonusCapPercent: PAID_BONUS_CAP_RATE * 100,
        refundPolicy: 'Promotional bonuses are excluded from cash refunds.',
      },
      dailyAttendance,
      rewardGroups: [
        {
          key: 'onboarding',
          title: 'Onboarding rewards',
          capScope: 'free_promo',
          quests: [
            {
              code: 'signup_bonus',
              title: 'Sign up',
              rewardLumina: 300,
              status: 'live',
              grantMode: 'automatic_on_signup',
            },
            {
              code: 'identity_verification_bonus',
              title: 'Verify identity',
              rewardLumina: 100,
              status: 'planned',
              grantMode: 'after_real_identity_provider',
            },
            {
              code: 'birthday_verified_annual',
              title: 'Verified birthday reward',
              rewardLumina: 1000,
              status: 'planned',
              grantMode: 'annual_after_verified_birthdate',
            },
          ],
        },
        {
          key: 'daily_retention',
          title: 'Daily attendance',
          capScope: 'free_promo',
          quests: dailyAttendance.schedule.map((item) => ({
            code: `attendance_day_${item.day}`,
            title: `Attendance day ${item.day}`,
            rewardLumina: item.rewardLumina,
            status: 'live',
            grantMode: 'claim_daily_attendance',
          })),
        },
        {
          key: 'social_activation',
          title: 'Feed and follow activation',
          capScope: 'free_promo',
          quests: [
            {
              code: 'first_feed_post',
              title: 'Write first Lumina Feed post',
              rewardLumina: 20,
              status: 'planned',
              grantMode: 'future_idempotent_claim',
            },
            {
              code: 'first_feed_like',
              title: 'Like first Lumina Feed post',
              rewardLumina: 10,
              status: 'planned',
              grantMode: 'future_idempotent_claim',
            },
            {
              code: 'first_follow',
              title: 'Follow first artist or user',
              rewardLumina: 10,
              status: 'planned',
              grantMode: 'future_idempotent_claim',
            },
            {
              code: 'first_reply',
              title: 'Write first feed reply',
              rewardLumina: 20,
              status: 'planned',
              grantMode: 'future_idempotent_claim',
            },
          ],
        },
        {
          key: 'paid_activation',
          title: 'Paid Lumina activation',
          capScope: 'paid_bonus',
          quests: [
            {
              code: 'first_charge_bonus',
              title: 'First Lumina charge bonus',
              bonusRate: 0.1,
              status: 'planned',
              grantMode: 'payment_fulfillment_bonus',
            },
            {
              code: 'paid_loyalty_bonus_pool',
              title: 'Paid loyalty bonus pool',
              maxBonusRateIncludingFirstCharge: PAID_BONUS_CAP_RATE,
              status: 'planned',
              grantMode: 'payment_or_campaign_bonus',
            },
          ],
        },
      ],
      antiAbuse: {
        signupOpen: true,
        identityVerificationGate:
          'Signup remains open. Referral, creator settlement, and high-value bonuses require identity verification.',
        maxAccountsPerVerifiedIdentity: 3,
        freeLikeSettlementEligible: false,
        creatorSettlementExcludesFreePromoSignalAbuse: true,
        ledgerIdempotencyRequired: true,
      },
      note:
        'This endpoint is a product policy contract. Only live grantMode entries currently grant Lumina.',
    };
  }

  async getActivationProgress(userId: string) {
    await this.ensureActiveUser(userId);
    const [user, promoLedger, paidOrders, counts, attendanceRewards] =
      await Promise.all([
        this.prisma.user.findUniqueOrThrow({
          where: { id: userId },
          include: {
            profile: true,
            identityVerification: true,
            walletAccounts: true,
          },
        }),
        this.prisma.walletLedger.aggregate({
          where: {
            direction: 'credit',
            ledgerType: { in: [...PROMO_REWARD_LEDGER_TYPES] },
            walletAccount: {
              userId,
              currencyCode: DEFAULT_CURRENCY,
            },
          },
          _sum: { amount: true },
        }),
        this.prisma.paymentOrder.findMany({
          where: { userId, status: 'paid' },
          include: { luminaProduct: true, refunds: true },
          orderBy: { createdAt: 'asc' },
        }),
        this.activationCounts(userId),
        this.prisma.dailyAttendanceReward.findMany({
          where: { userId },
          orderBy: { serviceDate: 'desc' },
          take: 7,
        }),
      ]);
    const promoEarnedLumina = new Decimal(promoLedger._sum.amount ?? 0);
    const paidBaseLumina = paidOrders.reduce(
      (sum, order) => sum.plus(order.luminaProduct.luminaAmount),
      new Decimal(0),
    );
    const paidBonusLumina = paidOrders.reduce(
      (sum, order) => sum.plus(order.luminaProduct.bonusAmount),
      new Decimal(0),
    );
    const paidBonusCapLumina = paidBaseLumina.mul(PAID_BONUS_CAP_RATE);
    const identityVerified =
      user.identityVerification?.status === 'verified' || Boolean(user.phoneNumber);

    return {
      userId,
      generatedAt: new Date(),
      caps: {
        freePromo: {
          capLumina: FREE_PROMO_REWARD_CAP_LUMINA.toString(),
          earnedLumina: promoEarnedLumina.toString(),
          remainingLumina: Decimal.max(
            0,
            new Decimal(FREE_PROMO_REWARD_CAP_LUMINA).minus(promoEarnedLumina),
          ).toString(),
          usedRate: promoEarnedLumina
            .div(FREE_PROMO_REWARD_CAP_LUMINA)
            .mul(100)
            .toDecimalPlaces(2)
            .toString(),
        },
        paidBonus: {
          capRate: PAID_BONUS_CAP_RATE,
          basePaidLumina: paidBaseLumina.toString(),
          grantedBonusLumina: paidBonusLumina.toString(),
          capLumina: paidBonusCapLumina.toString(),
          remainingBonusLumina: Decimal.max(
            0,
            paidBonusCapLumina.minus(paidBonusLumina),
          ).toString(),
        },
      },
      progress: {
        identityVerified,
        hasProfileBio: Boolean(user.profile?.bio),
        hasAvatar: Boolean(user.profile?.avatarAssetId),
        hasCover: Boolean(user.profile?.coverAssetId),
        counts,
        attendance: {
          recent: attendanceRewards,
          claimedToday: attendanceRewards.some(
            (reward) =>
              this.formatServiceDate(reward.serviceDate) ===
              this.formatServiceDate(this.getKoreanServiceDate()),
          ),
        },
        firstCharge: {
          completed: paidOrders.length > 0,
          firstPaidAt: paidOrders[0]?.updatedAt ?? null,
        },
      },
      milestoneStatus: this.activationMilestoneStatus({
        identityVerified,
        hasProfileBio: Boolean(user.profile?.bio),
        hasAvatar: Boolean(user.profile?.avatarAssetId),
        hasCover: Boolean(user.profile?.coverAssetId),
        counts,
        paidOrdersCount: paidOrders.length,
      }),
      policy: this.getActivationPolicy(),
    };
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

  private async activationCounts(userId: string) {
    const [
      feedPosts,
      feedLikes,
      feedReplies,
      artistFollows,
      userFollows,
      fanLetters,
      paidLikes,
    ] = await Promise.all([
      this.prisma.communityPost.count({
        where: { authorUserId: userId, deletedAt: null },
      }),
      this.prisma.communityReaction.count({
        where: { userId, reactionType: 'like' },
      }),
      this.prisma.communityReply.count({
        where: { authorUserId: userId, deletedAt: null },
      }),
      this.prisma.artistFollow.count({
        where: { userId, status: 'active', deletedAt: null },
      }),
      this.prisma.userFollow.count({
        where: { followerUserId: userId, status: 'active', deletedAt: null },
      }),
      this.prisma.fanLetter.count({
        where: { senderUserId: userId },
      }),
      this.prisma.artistBoostEvent.count({
        where: { userId, boostType: 'lumina_boost' },
      }),
    ]);

    return {
      feedPosts,
      feedLikes,
      feedReplies,
      artistFollows,
      userFollows,
      followsTotal: artistFollows + userFollows,
      fanLetters,
      paidLikes,
    };
  }

  private activationMilestoneStatus(input: {
    identityVerified: boolean;
    hasProfileBio: boolean;
    hasAvatar: boolean;
    hasCover: boolean;
    counts: Awaited<ReturnType<RewardsService['activationCounts']>>;
    paidOrdersCount: number;
  }) {
    return [
      {
        code: 'identity_verification_bonus',
        completed: input.identityVerified,
        claimStatus: 'planned_not_claimable',
        rewardLumina: 100,
      },
      {
        code: 'profile_basic_setup',
        completed: input.hasProfileBio || input.hasAvatar || input.hasCover,
        claimStatus: 'planned_not_claimable',
        rewardLumina: 30,
      },
      {
        code: 'first_feed_post',
        completed: input.counts.feedPosts > 0,
        claimStatus: 'planned_not_claimable',
        rewardLumina: 20,
      },
      {
        code: 'first_feed_like',
        completed: input.counts.feedLikes > 0,
        claimStatus: 'planned_not_claimable',
        rewardLumina: 10,
      },
      {
        code: 'first_follow',
        completed: input.counts.followsTotal > 0,
        claimStatus: 'planned_not_claimable',
        rewardLumina: 10,
      },
      {
        code: 'first_reply',
        completed: input.counts.feedReplies > 0,
        claimStatus: 'planned_not_claimable',
        rewardLumina: 20,
      },
      {
        code: 'first_charge_bonus',
        completed: input.paidOrdersCount > 0,
        claimStatus: 'planned_payment_policy',
        bonusRate: 0.1,
      },
    ];
  }
}

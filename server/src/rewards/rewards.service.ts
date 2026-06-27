import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_CURRENCY = 'LUMINA';
const DAILY_ATTENDANCE_REWARD_SCHEDULE = [10, 10, 20, 20, 20, 20, 50] as const;
const DAILY_ATTENDANCE_POLICY_STARTED_AT = '2026-05-05';
const LUMINA_UNIT_PRICE_KRW = 10;
const FREE_PROMO_REWARD_CAP_LUMINA = 3000;
const PAID_BONUS_CAP_RATE = 0.2;
const FIRST_CHARGE_BONUS_RATE = 0.1;
const IDENTITY_VERIFICATION_REWARD_LUMINA = 100;
const BIRTHDAY_REWARD_LUMINA = 500;
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
const CLAIMABLE_ACTIVATION_QUESTS = {
  profile_basic_setup: {
    rewardLumina: 30,
    ledgerType: 'profile_completion_reward',
    memo: 'Profile basic setup reward',
  },
  first_feed_post: {
    rewardLumina: 20,
    ledgerType: 'quest_reward',
    memo: 'First Lumina Feed post reward',
  },
  first_feed_like: {
    rewardLumina: 10,
    ledgerType: 'quest_reward',
    memo: 'First Lumina Feed like reward',
  },
  first_follow: {
    rewardLumina: 10,
    ledgerType: 'quest_reward',
    memo: 'First follow reward',
  },
  first_reply: {
    rewardLumina: 20,
    ledgerType: 'quest_reward',
    memo: 'First feed reply reward',
  },
} as const;
type ClaimableActivationQuestCode = keyof typeof CLAIMABLE_ACTIVATION_QUESTS;
const ACHIEVEMENT_TITLE_LEDGER_SKELETON = [
  {
    code: 'profile_basic_setup',
    achievementCode: 'profile.basic_setup',
    titleCode: 'profile_starter',
    rewardLumina: 30,
    ledgerType: 'profile_completion_reward',
    grantMode: 'idempotent_activation_quest',
    status: 'live',
    claimEndpoint: '/api/v1/rewards/activation-quests/profile_basic_setup/claim',
  },
  {
    code: 'first_feed_post',
    achievementCode: 'feed.first_post',
    titleCode: 'feed_first_spark',
    rewardLumina: 20,
    ledgerType: 'quest_reward',
    grantMode: 'idempotent_activation_quest',
    status: 'live',
    claimEndpoint: '/api/v1/rewards/activation-quests/first_feed_post/claim',
  },
  {
    code: 'first_feed_like',
    achievementCode: 'feed.first_like',
    titleCode: 'warm_signal',
    rewardLumina: 10,
    ledgerType: 'quest_reward',
    grantMode: 'idempotent_activation_quest',
    status: 'live',
    claimEndpoint: '/api/v1/rewards/activation-quests/first_feed_like/claim',
  },
  {
    code: 'first_follow',
    achievementCode: 'social.first_follow',
    titleCode: 'first_connection',
    rewardLumina: 10,
    ledgerType: 'quest_reward',
    grantMode: 'idempotent_activation_quest',
    status: 'live',
    claimEndpoint: '/api/v1/rewards/activation-quests/first_follow/claim',
  },
  {
    code: 'first_reply',
    achievementCode: 'feed.first_reply',
    titleCode: 'first_responder',
    rewardLumina: 20,
    ledgerType: 'quest_reward',
    grantMode: 'idempotent_activation_quest',
    status: 'live',
    claimEndpoint: '/api/v1/rewards/activation-quests/first_reply/claim',
  },
  {
    code: 'identity_verification_bonus',
    achievementCode: 'account.identity_verified',
    titleCode: 'verified_fan',
    rewardLumina: IDENTITY_VERIFICATION_REWARD_LUMINA,
    ledgerType: 'identity_verification_bonus',
    grantMode: 'fail_closed_provider_event',
    status: 'planned_after_real_identity_provider',
    claimEndpoint: null,
  },
  {
    code: 'birthday_verified_annual',
    achievementCode: 'account.verified_birthday',
    titleCode: 'birthday_star',
    rewardLumina: BIRTHDAY_REWARD_LUMINA,
    ledgerType: 'birthday_bonus',
    grantMode: 'annual_claim_on_verified_birthday',
    status: 'ready_after_identity_birthdate_provider',
    claimEndpoint: '/api/v1/rewards/birthday/claim',
  },
  {
    code: 'attendance_streak_7',
    achievementCode: 'attendance.streak_7',
    titleCode: 'seven_day_starter',
    rewardLumina: 0,
    ledgerType: 'achievement_reward',
    grantMode: 'policy_only_no_public_grant',
    status: 'planned_fail_closed',
    claimEndpoint: null,
  },
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

      const promoLedger = await tx.walletLedger.aggregate({
        where: this.promoRewardLedgerWhere(userId),
        _sum: { amount: true },
      });
      const promoEarnedLumina = new Decimal(promoLedger._sum.amount ?? 0);
      const remainingPromoLumina = new Decimal(FREE_PROMO_REWARD_CAP_LUMINA).minus(
        promoEarnedLumina,
      );

      if (remainingPromoLumina.lessThan(rewardAmount)) {
        throw new BadRequestException({
          code: 'FREE_PROMO_REWARD_CAP_EXCEEDED',
          message: 'Free promotional reward cap would be exceeded',
          details: {
            capLumina: FREE_PROMO_REWARD_CAP_LUMINA.toString(),
            earnedLumina: promoEarnedLumina.toString(),
            remainingLumina: Decimal.max(0, remainingPromoLumina).toString(),
            requestedLumina: rewardAmount.toString(),
            ledgerType: 'daily_attendance',
          },
        });
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
        freePromoRewardCapLumina: FREE_PROMO_REWARD_CAP_LUMINA,
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
              rewardLumina: IDENTITY_VERIFICATION_REWARD_LUMINA,
              status: 'planned',
              grantMode: 'after_real_identity_provider',
            },
            {
              code: 'birthday_verified_annual',
              title: 'Verified birthday reward',
              rewardLumina: BIRTHDAY_REWARD_LUMINA,
              status: 'ready_after_identity_birthdate_provider',
              grantMode: 'annual_claim_on_birthday',
              statusEndpoint: '/api/v1/rewards/birthday',
              claimEndpoint: '/api/v1/rewards/birthday/claim',
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
              status: 'live',
              grantMode: 'idempotent_claim',
              claimEndpoint: '/api/v1/rewards/activation-quests/first_feed_post/claim',
            },
            {
              code: 'first_feed_like',
              title: 'Like first Lumina Feed post',
              rewardLumina: 10,
              status: 'live',
              grantMode: 'idempotent_claim',
              claimEndpoint: '/api/v1/rewards/activation-quests/first_feed_like/claim',
            },
            {
              code: 'first_follow',
              title: 'Follow first artist or user',
              rewardLumina: 10,
              status: 'live',
              grantMode: 'idempotent_claim',
              claimEndpoint: '/api/v1/rewards/activation-quests/first_follow/claim',
            },
            {
              code: 'first_reply',
              title: 'Write first feed reply',
              rewardLumina: 20,
              status: 'live',
              grantMode: 'idempotent_claim',
              claimEndpoint: '/api/v1/rewards/activation-quests/first_reply/claim',
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
              bonusRate: FIRST_CHARGE_BONUS_RATE,
              status: 'live',
              grantMode: 'payment_fulfillment_bonus',
              ledgerType: 'first_charge_bonus',
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
      achievementTitleLedgerSkeleton: this.achievementTitleLedgerSkeleton(),
      note:
        'This endpoint is a product policy contract. Only live grantMode entries currently grant Lumina.',
    };
  }

  getRewardLedgerPolicy() {
    return {
      generatedAt: new Date(),
      currencyCode: DEFAULT_CURRENCY,
      unitPriceKrw: LUMINA_UNIT_PRICE_KRW,
      capScopes: {
        freePromo: {
          capLumina: FREE_PROMO_REWARD_CAP_LUMINA,
          capKrwEquivalent: FREE_PROMO_REWARD_CAP_LUMINA * LUMINA_UNIT_PRICE_KRW,
          ledgerTypes: [...PROMO_REWARD_LEDGER_TYPES],
          includedSources: [
            'signup',
            'referral',
            'daily_attendance',
            'identity_verification',
            'birthday',
            'achievement',
            'quest',
            'profile_completion',
          ],
        },
        paidBonus: {
          capRate: PAID_BONUS_CAP_RATE,
          capPercent: PAID_BONUS_CAP_RATE * 100,
          ledgerTypes: ['first_charge_bonus'],
          separatedFromFreePromoCap: true,
          firstChargeBonus: {
            bonusRate: FIRST_CHARGE_BONUS_RATE,
            bonusPercent: FIRST_CHARGE_BONUS_RATE * 100,
            basisField: 'lumina_products.lumina_amount',
            packageBonusIncluded: false,
            grantTrigger: 'first_successful_paid_lumina_order_only',
            failedProviderEventsLockEligibility: false,
            idempotencyKeyPattern: 'first_charge_bonus:<userId>',
            duplicateBehavior:
              'wallet_ledger_upsert_replay_without_second_bonus_credit',
            auditReadModel: {
              packageBonusField: 'lumina_products.bonus_amount',
              packageBonusLedgerType: 'purchase',
              firstChargeBonusLedgerType: 'first_charge_bonus',
              firstChargeBonusBasisField: 'lumina_products.lumina_amount',
              firstChargeBonusRateBps: 1000,
              packageBonusAndFirstChargeShareAuditRow: false,
              packageBonusAndFirstChargeShareLedgerType: false,
            },
          },
        },
      },
      ledgerRules: {
        walletMutationRequired: true,
        walletAndLedgerSameTransaction: true,
        clientProvidedAmountAccepted: false,
        duplicateProtection: {
          walletLedgerIdempotencyKey: true,
          patterns: [
            'signup_bonus:<userId>',
            'referral:<role>:<rewardId>',
            'daily_attendance:<userId>:<YYYY-MM-DD>',
            'activation_quest:<userId>:<code>',
            'first_charge_bonus:<userId>',
            'birthday_bonus:<identitySubjectHash>:<year>',
            'achievement_reward:<userId>:<code>',
          ],
        },
        freePromoCapCheckBeforeCredit: true,
        settlementEligible: false,
        cashRefundable: false,
      },
      publicMutation: {
        arbitraryLuminaGrant: false,
        achievementRewardGrant: false,
        titleGrant: false,
        identityVerificationRewardGrant: false,
      },
      skeleton: this.achievementTitleLedgerSkeleton(),
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
          where: this.promoRewardLedgerWhere(userId),
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
    const firstChargeBonusLedger = await this.prisma.walletLedger.aggregate({
      where: {
        direction: 'credit',
        ledgerType: 'first_charge_bonus',
        walletAccount: {
          userId,
          currencyCode: DEFAULT_CURRENCY,
        },
      },
      _sum: { amount: true },
    });
    const paidProductBonusLumina = paidOrders.reduce(
      (sum, order) => sum.plus(order.luminaProduct.bonusAmount),
      new Decimal(0),
    );
    const firstChargeBonusLumina = new Decimal(firstChargeBonusLedger._sum.amount ?? 0);
    const paidBonusLumina = paidProductBonusLumina.plus(firstChargeBonusLumina);
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
          productBonusLumina: paidProductBonusLumina.toString(),
          firstChargeBonusLumina: firstChargeBonusLumina.toString(),
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
          bonusRate: FIRST_CHARGE_BONUS_RATE,
          bonusGrantedLumina: firstChargeBonusLumina.toString(),
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

  async getBirthdayRewardStatus(userId: string) {
    await this.ensureActiveUser(userId);
    const currentYear = this.getKoreanServiceDate().getUTCFullYear();
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        identityVerification: true,
      },
    });
    const identity = user.identityVerification;
    const identityVerified = identity?.status === 'verified';
    const identitySubjectHash = identity?.identitySubjectHash ?? null;
    const birthDate = identity?.birthDate ?? null;
    const idempotencyKey = identitySubjectHash
      ? this.birthdayRewardIdempotencyKey(identitySubjectHash, currentYear)
      : null;
    const existingLedger = idempotencyKey
      ? await this.prisma.walletLedger.findUnique({ where: { idempotencyKey } })
      : null;
    const birthdayToday = birthDate ? this.isKoreanServiceBirthday(birthDate) : false;
    const blockingReasons = [
      !identityVerified ? 'identity_verification_required' : null,
      !birthDate ? 'verified_birthdate_required' : null,
      !identitySubjectHash ? 'identity_subject_hash_required' : null,
      birthDate && !birthdayToday ? 'not_birthday_today' : null,
      existingLedger ? 'already_claimed_this_year' : null,
    ].filter(Boolean);

    return {
      generatedAt: new Date(),
      reward: {
        code: 'birthday_verified_annual',
        rewardLumina: BIRTHDAY_REWARD_LUMINA,
        ledgerType: 'birthday_bonus',
        claimEndpoint: '/api/v1/rewards/birthday/claim',
      },
      eligibility: {
        identityVerified,
        hasVerifiedBirthDate: Boolean(birthDate),
        hasIdentitySubjectHash: Boolean(identitySubjectHash),
        birthdayToday,
        currentYear,
        claimable: blockingReasons.length === 0,
        blockingReasons,
      },
      claimed: existingLedger
        ? {
            ledgerId: existingLedger.id,
            claimedAt: existingLedger.createdAt,
          }
        : null,
      policy: this.birthdayRewardPolicy(),
    };
  }

  async claimBirthdayReward(userId: string) {
    const status = await this.getBirthdayRewardStatus(userId);

    if (!status.eligibility.claimable) {
      throw new BadRequestException({
        code: 'BIRTHDAY_REWARD_NOT_CLAIMABLE',
        message: 'Birthday reward is not claimable',
        details: status.eligibility,
      });
    }

    const identity = await this.prisma.userIdentityVerification.findUniqueOrThrow({
      where: { userId },
    });
    const identitySubjectHash = identity.identitySubjectHash;

    if (!identitySubjectHash) {
      throw new BadRequestException('Verified identity subject hash is required');
    }

    const currentYear = this.getKoreanServiceDate().getUTCFullYear();
    const idempotencyKey = this.birthdayRewardIdempotencyKey(
      identitySubjectHash,
      currentYear,
    );
    const progress = await this.getActivationProgress(userId);
    const rewardAmount = new Decimal(BIRTHDAY_REWARD_LUMINA);
    const remainingPromoLumina = new Decimal(progress.caps.freePromo.remainingLumina);

    if (remainingPromoLumina.lessThan(rewardAmount)) {
      throw new BadRequestException({
        code: 'FREE_PROMO_REWARD_CAP_EXCEEDED',
        message: 'Free promotional reward cap would be exceeded',
        details: {
          capLumina: progress.caps.freePromo.capLumina,
          earnedLumina: progress.caps.freePromo.earnedLumina,
          remainingLumina: progress.caps.freePromo.remainingLumina,
          requestedLumina: rewardAmount.toString(),
          ledgerType: 'birthday_bonus',
        },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const existingLedger = await tx.walletLedger.findUnique({
        where: { idempotencyKey },
      });

      if (existingLedger) {
        return {
          ledger: existingLedger,
          idempotentReplay: true,
          walletCredited: false,
          policy: this.birthdayRewardPolicy(),
        };
      }

      const wallet = await tx.walletAccount.upsert({
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
      const ledger = await tx.walletLedger.create({
        data: {
          walletAccountId: wallet.id,
          direction: 'credit',
          amount: rewardAmount,
          ledgerType: 'birthday_bonus',
          referenceType: 'user',
          referenceId: userId,
          idempotencyKey,
          memo: `Verified birthday reward ${currentYear}`,
        },
      });
      const updatedWallet = await tx.walletAccount.update({
        where: { id: wallet.id },
        data: {
          cachedBalance: {
            increment: rewardAmount,
          },
        },
      });

      return {
        ledger,
        wallet: {
          id: updatedWallet.id,
          currencyCode: updatedWallet.currencyCode,
          cachedBalance: updatedWallet.cachedBalance,
          status: updatedWallet.status,
        },
        reward: {
          code: 'birthday_verified_annual',
          rewardLumina: BIRTHDAY_REWARD_LUMINA,
          year: currentYear,
        },
        idempotentReplay: false,
        walletCredited: true,
        policy: this.birthdayRewardPolicy(),
      };
    });
  }

  async claimActivationQuest(userId: string, code: string) {
    await this.ensureActiveUser(userId);
    const questCode = this.claimableQuestCode(code);
    const quest = CLAIMABLE_ACTIVATION_QUESTS[questCode];
    const idempotencyKey = `activation_quest:${userId}:${questCode}`;

    const [existingLedger, progress] = await Promise.all([
      this.prisma.walletLedger.findUnique({
        where: { idempotencyKey },
      }),
      this.getActivationProgress(userId),
    ]);

    if (existingLedger) {
      return {
        quest: this.activationQuestStatusFromProgress(questCode, progress),
        ledger: existingLedger,
        idempotentReplay: true,
        walletCredited: false,
        caps: progress.caps,
        policy: this.activationQuestClaimPolicy(),
      };
    }

    const questStatus = this.activationQuestStatusFromProgress(questCode, progress);

    if (!questStatus.completed) {
      throw new BadRequestException({
        code: 'ACTIVATION_QUEST_NOT_COMPLETED',
        message: 'Activation quest condition is not completed yet',
        details: {
          quest: questStatus,
        },
      });
    }

    const rewardAmount = new Decimal(quest.rewardLumina);
    const remainingPromoLumina = new Decimal(progress.caps.freePromo.remainingLumina);

    if (remainingPromoLumina.lessThan(rewardAmount)) {
      throw new BadRequestException({
        code: 'FREE_PROMO_REWARD_CAP_EXCEEDED',
        message: 'Free promotional reward cap would be exceeded',
        details: {
          capLumina: progress.caps.freePromo.capLumina,
          earnedLumina: progress.caps.freePromo.earnedLumina,
          remainingLumina: progress.caps.freePromo.remainingLumina,
          requestedLumina: rewardAmount.toString(),
        },
      });
    }

    return this.prisma.$transaction(async (tx) => {
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
          ledgerType: quest.ledgerType,
          referenceType: 'user',
          referenceId: userId,
          idempotencyKey,
          memo: quest.memo,
        },
      });

      const updatedWallet = await tx.walletAccount.update({
        where: { id: wallet.id },
        data: {
          cachedBalance: {
            increment: rewardAmount,
          },
        },
      });

      return {
        quest: {
          ...questStatus,
          claimStatus: 'claimed',
        },
        ledger,
        wallet: {
          id: updatedWallet.id,
          currencyCode: updatedWallet.currencyCode,
          cachedBalance: updatedWallet.cachedBalance,
          status: updatedWallet.status,
        },
        idempotentReplay: false,
        walletCredited: true,
        caps: {
          ...progress.caps,
          freePromo: {
            ...progress.caps.freePromo,
            earnedLumina: new Decimal(progress.caps.freePromo.earnedLumina)
              .plus(rewardAmount)
              .toString(),
            remainingLumina: remainingPromoLumina.minus(rewardAmount).toString(),
          },
        },
        policy: this.activationQuestClaimPolicy(),
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
        claimStatus: 'claimable_when_completed',
        rewardLumina: 30,
      },
      {
        code: 'first_feed_post',
        completed: input.counts.feedPosts > 0,
        claimStatus: 'claimable_when_completed',
        rewardLumina: 20,
      },
      {
        code: 'first_feed_like',
        completed: input.counts.feedLikes > 0,
        claimStatus: 'claimable_when_completed',
        rewardLumina: 10,
      },
      {
        code: 'first_follow',
        completed: input.counts.followsTotal > 0,
        claimStatus: 'claimable_when_completed',
        rewardLumina: 10,
      },
      {
        code: 'first_reply',
        completed: input.counts.feedReplies > 0,
        claimStatus: 'claimable_when_completed',
        rewardLumina: 20,
      },
      {
        code: 'first_charge_bonus',
        completed: input.paidOrdersCount > 0,
        claimStatus: 'automatic_on_first_paid_order',
        bonusRate: FIRST_CHARGE_BONUS_RATE,
      },
    ];
  }

  private claimableQuestCode(code: string): ClaimableActivationQuestCode {
    if (Object.prototype.hasOwnProperty.call(CLAIMABLE_ACTIVATION_QUESTS, code)) {
      return code as ClaimableActivationQuestCode;
    }

    throw new BadRequestException({
      code: 'ACTIVATION_QUEST_NOT_CLAIMABLE',
      message: 'Activation quest is not claimable',
      details: {
        claimableCodes: Object.keys(CLAIMABLE_ACTIVATION_QUESTS),
      },
    });
  }

  private activationQuestStatusFromProgress(
    code: ClaimableActivationQuestCode,
    progress: Awaited<ReturnType<RewardsService['getActivationProgress']>>,
  ) {
    const milestone = progress.milestoneStatus.find((item) => item.code === code);

    if (!milestone) {
      throw new BadRequestException('Activation quest status not found');
    }

    return {
      ...milestone,
      claimEndpoint: `/api/v1/rewards/activation-quests/${code}/claim`,
    };
  }

  private activationQuestClaimPolicy() {
    return {
      claimableCodes: Object.keys(CLAIMABLE_ACTIVATION_QUESTS),
      oneTimePerUser: true,
      idempotencyKeyPattern: 'activation_quest:<userId>:<code>',
      capScope: 'free_promo',
      freePromoRewardCapLumina: FREE_PROMO_REWARD_CAP_LUMINA,
      refundPolicy: 'Promotional quest rewards are excluded from cash refunds.',
      excludedCodes: {
        identity_verification_bonus: 'planned_after_real_identity_provider',
        birthday_verified_annual: 'planned_after_verified_birthdate',
        first_charge_bonus: 'automatic_payment_fulfillment_bonus',
      },
    };
  }

  private achievementTitleLedgerSkeleton() {
    return {
      status: 'skeleton',
      publicRewardGrantOpen: false,
      titleEquipDomain: 'fan_engagement_non_cash',
      luminaRewardDomain: 'wallet_free_promo',
      items: ACHIEVEMENT_TITLE_LEDGER_SKELETON.map((item) => ({
        ...item,
        capScope: 'free_promo',
        cashLike: false,
        settlementEligible: false,
        transferable: false,
        titleGrantPublicMutationOpen: false,
        keys: {
          achievementNameKey: `achievement.${item.achievementCode}.name`,
          achievementDescriptionKey: `achievement.${item.achievementCode}.description`,
          titleNameKey: `fanTitle.${item.titleCode}.name`,
          titleDescriptionKey: `fanTitle.${item.titleCode}.description`,
          statusKey: `reward.status.${item.status}`,
        },
      })),
      grantSafety: {
        requiresServerVerifiedCondition: true,
        requiresWalletLedgerIdempotencyKey: true,
        requiresFreePromoCapCheck: true,
        noClientSuppliedAmount: true,
      },
    };
  }

  private birthdayRewardPolicy() {
    return {
      rewardLumina: BIRTHDAY_REWARD_LUMINA,
      oneClaimPerVerifiedIdentityPerYear: true,
      requiresVerifiedBirthDateFromProvider: true,
      requiresIdentitySubjectHash: true,
      serviceTimezone: 'Asia/Seoul',
      idempotencyKeyPattern: 'birthday_bonus:<identitySubjectHash>:<year>',
      capScope: 'free_promo',
      freePromoRewardCapLumina: FREE_PROMO_REWARD_CAP_LUMINA,
      refundPolicy: 'Birthday rewards are promotional rewards and excluded from cash refunds.',
    };
  }

  private birthdayRewardIdempotencyKey(identitySubjectHash: string, year: number) {
    return `birthday_bonus:${identitySubjectHash}:${year}`;
  }

  private isKoreanServiceBirthday(birthDate: Date) {
    const today = this.formatServiceDate(this.getKoreanServiceDate()).slice(5);
    const birthday = this.formatServiceDate(birthDate).slice(5);
    return today === birthday;
  }

  private promoRewardLedgerWhere(userId: string): Prisma.WalletLedgerWhereInput {
    return {
      direction: 'credit',
      walletAccount: {
        userId,
        currencyCode: DEFAULT_CURRENCY,
      },
      OR: [
        {
          ledgerType: { in: [...PROMO_REWARD_LEDGER_TYPES] },
        },
        {
          ledgerType: 'event_grant',
          OR: [
            { idempotencyKey: { startsWith: 'signup_bonus:' } },
            { idempotencyKey: { startsWith: 'referral:referrer:' } },
            { idempotencyKey: { startsWith: 'referral:referred:' } },
          ],
        },
      ],
    };
  }
}

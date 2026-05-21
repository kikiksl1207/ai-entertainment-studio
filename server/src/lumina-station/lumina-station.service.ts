import { BadRequestException, Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_CURRENCY = 'LUMINA';
const PRICE_UNIT_KRW = new Decimal(10);
const FIRST_CHARGE_BONUS_RATE = new Decimal('0.1');
const FIRST_CHARGE_BONUS_BASIS = 'base_lumina_only';
const CHARGE_POLICY_VERSION = '2026-05-21.charge-policy-v2';
const ACTIVE_CHARGE_PRICE_AMOUNTS_KRW = [1000, 3000, 5000, 10000, 50000, 100000];
const WEB_PAID_BONUS_MAX_RATE = 0.2;
const AD_REWARD_MAX_REVENUE_SHARE_RATE = 0.5;
const AD_REWARD_DAILY_LIMIT = 50;
type ChargeProduct = {
  priceAmount: Decimal;
  luminaAmount: Decimal;
  bonusAmount: Decimal;
};
const APP_CHARGE_PACKAGES = [
  { sku: 'APP_LUMINA_70', priceKrw: 1000, luminaAmount: 70 },
  { sku: 'APP_LUMINA_210', priceKrw: 3000, luminaAmount: 210 },
  { sku: 'APP_LUMINA_350', priceKrw: 5000, luminaAmount: 350 },
  { sku: 'APP_LUMINA_700', priceKrw: 10000, luminaAmount: 700 },
  { sku: 'APP_LUMINA_3750', priceKrw: 50000, luminaAmount: 3750 },
  { sku: 'APP_LUMINA_8000', priceKrw: 100000, luminaAmount: 8000 },
] as const;
const DEFERRED_APP_CHARGE_PACKAGES: ReadonlyArray<{
  priceKrw: number;
  status: 'deferred_after_launch';
}> = [];
const CREATOR_REQUEST_PRODUCTS = [
  {
    sku: 'CREATOR_GALLERY_VIEW',
    requestType: 'gallery_view',
    displayNameKo: '공식 갤러리 보기',
    priceLumina: 0,
    descriptionKo: '공식 갤러리와 기존 사진 보기는 무료입니다.',
  },
  {
    sku: 'CREATOR_IMAGE_BASIC',
    requestType: 'basic_image',
    displayNameKo: '기본 이미지 요청',
    priceLumina: 30,
    descriptionKo: '단일 콘셉트의 기본 이미지 요청입니다.',
  },
  {
    sku: 'CREATOR_IMAGE_PREMIUM',
    requestType: 'premium_image',
    displayNameKo: '고급 이미지 요청',
    priceLumina: 100,
    descriptionKo: '더 높은 디테일의 이미지 요청입니다.',
  },
  {
    sku: 'CREATOR_VIDEO_SHORT',
    requestType: 'short_video',
    displayNameKo: '짧은 영상 요청',
    priceLumina: 300,
    descriptionKo: '3~5초, 1캐릭터, 단일 콘셉트 기준의 영상 요청입니다.',
  },
] as const;

@Injectable()
export class LuminaStationService {
  constructor(private readonly prisma: PrismaService) {}

  getChargePolicy() {
    return {
      policyVersion: CHARGE_POLICY_VERSION,
      currency: {
        code: DEFAULT_CURRENCY,
        displayName: 'Lumina',
        displayNameKo: '루미나',
        unitPriceKrw: PRICE_UNIT_KRW.toNumber(),
        unitLabelKo: '1L = 10원',
      },
      webCharge: {
        platform: 'web',
        baseUnitPriceKrw: PRICE_UNIT_KRW.toNumber(),
        paidBonusMaxRate: WEB_PAID_BONUS_MAX_RATE,
        paidBonusMaxPercent: WEB_PAID_BONUS_MAX_RATE * 100,
        paymentProviderStatus: 'pg_pending',
        createOrderEndpoint: '/api/v1/payments/orders',
        orderHistoryEndpoint: '/api/v1/payments/orders',
        walletMutation: false,
        orderMutationEnabled: false,
        displayCopyKo: {
          unitPrice: '1L = 10원',
          bonusCap: '웹 유료 보너스는 최대 20%까지 적용됩니다.',
          pendingPayment: '결제 기능은 PG 승인 후 열립니다.',
        },
      },
      appCharge: {
        platform: 'app',
        storePaymentStatus: 'iap_pending',
        mutationEnabled: false,
        packages: APP_CHARGE_PACKAGES.map((product) => ({
          ...product,
          bonusLumina: 0,
          totalLumina: product.luminaAmount,
          labelKo: `${product.priceKrw.toLocaleString('ko-KR')}원 = ${product.luminaAmount.toLocaleString('ko-KR')}L`,
          iapProductId: null,
        })),
        deferredPackages: DEFERRED_APP_CHARGE_PACKAGES.map((product) => ({
          ...product,
          labelKo: `${product.priceKrw.toLocaleString('ko-KR')}원 패키지는 2차 이후 검토`,
        })),
        displayCopyKo: {
          launchSet: '앱 1차 패키지 6종',
          pendingStorePayment: '스토어 결제는 앱 심사와 IAP 계약 이후 연결됩니다.',
        },
      },
      bonusPolicy: {
        packageBonus: {
          repeatable: true,
          sourceField: 'lumina_products.bonus_amount',
          includedInProductTotal: true,
          firstChargeBonusAppliesAgain: false,
        },
        firstChargeBonus: {
          oneTimePerUser: true,
          appliesTo: 'first_paid_order_per_user',
          rate: FIRST_CHARGE_BONUS_RATE.toString(),
          percent: FIRST_CHARGE_BONUS_RATE.times(100).toNumber(),
          basis: FIRST_CHARGE_BONUS_BASIS,
          basisField: 'lumina_products.lumina_amount',
          packageBonusIncluded: false,
          ledgerType: 'first_charge_bonus',
          idempotencyKeyPattern: 'first_charge_bonus:<userId>',
          examples: [
            {
              priceKrw: 50000,
              baseLumina: 5000,
              packageBonusLumina: 800,
              firstChargeBonusLumina: 500,
              firstPurchaseTotalLumina: 6300,
            },
            {
              priceKrw: 100000,
              baseLumina: 10000,
              packageBonusLumina: 2000,
              firstChargeBonusLumina: 1000,
              firstPurchaseTotalLumina: 13000,
            },
          ],
        },
      },
      freeAdCharge: {
        status: 'planned',
        userFacingLabelKo: '오늘의 무료 루미나 받기',
        maxRevenueShareRate: AD_REWARD_MAX_REVENUE_SHARE_RATE,
        maxRevenueSharePercent: AD_REWARD_MAX_REVENUE_SHARE_RATE * 100,
        dailyLimit: AD_REWARD_DAILY_LIMIT,
        ledgerSourcePlanned: 'ad_reward',
        sdkConfigured: false,
        walletMutation: false,
        claimMutationEnabled: false,
        displayCopyKo: {
          summary: '광고/오퍼월 수익의 최대 50% 상당 루미나를 지급할 예정입니다.',
          limit: '하루 최대 50회까지 참여할 수 있습니다.',
          pendingSdk: '광고 SDK 연결 전까지 실제 지급은 열리지 않습니다.',
        },
      },
      creatorRequests: {
        walletMutation: false,
        orderMutationEnabled: false,
        products: CREATOR_REQUEST_PRODUCTS,
        videoPolicy: {
          durationSeconds: { min: 3, max: 5 },
          characterCount: 1,
          conceptCount: 1,
          displayCopyKo: '영상 기준: 3~5초, 1캐릭터, 단일 콘셉트',
        },
      },
      safety: {
        readOnly: true,
        secretsReturned: false,
        walletMutation: false,
        paymentOrderMutation: false,
        adSdkMutation: false,
        frontendMayRenderPolicyOnly: true,
      },
    };
  }

  async getStation(userId: string, takeQuery?: string) {
    const take = this.parseTake(takeQuery);

    const [wallet, products, recentOrders, paidOrderCount] = await this.prisma.$transaction([
      this.prisma.walletAccount.upsert({
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
      }),
      this.prisma.luminaProduct.findMany({
        where: {
          status: 'active',
          priceAmount: { in: ACTIVE_CHARGE_PRICE_AMOUNTS_KRW },
        },
        orderBy: [{ priceAmount: 'asc' }, { luminaAmount: 'asc' }],
      }),
      this.prisma.paymentOrder.findMany({
        where: { userId },
        include: {
          luminaProduct: true,
          transactions: true,
          refunds: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.paymentOrder.count({
        where: { userId, status: 'paid' },
      }),
    ]);
    const firstChargeEligible = paidOrderCount === 0;

    return {
      wallet,
      products: products.map((product: ChargeProduct) => {
        const totalLumina = product.luminaAmount.plus(product.bonusAmount);
        const firstChargeBonusLumina = firstChargeEligible
          ? product.luminaAmount.mul(FIRST_CHARGE_BONUS_RATE).toDecimalPlaces(2)
          : new Decimal(0);
        const expectedPrice = totalLumina.times(PRICE_UNIT_KRW);
        const discountAmount = Decimal.max(expectedPrice.minus(product.priceAmount), 0);

        return {
          ...product,
          totalLumina,
          unitPriceKrw: product.priceAmount.div(totalLumina).toDecimalPlaces(2),
          packageBonusLumina: product.bonusAmount,
          firstChargeBonusBasisLumina: product.luminaAmount,
          firstChargeBonusLumina,
          firstChargeTotalLumina: totalLumina.plus(firstChargeBonusLumina),
          bonusRate:
            product.luminaAmount.gt(0) && product.bonusAmount.gt(0)
              ? product.bonusAmount.div(product.luminaAmount).times(100).toDecimalPlaces(2)
              : new Decimal(0),
          discountAmount,
          isBestValue: discountAmount.gt(0),
        };
      }),
      recentOrders,
      payment: {
        provider: process.env.PAYMENT_PROVIDER ?? 'mock',
        status: 'pg_pending',
        createOrderEndpoint: '/api/v1/payments/orders',
        orderHistoryEndpoint: '/api/v1/payments/orders',
      },
      policy: {
        currencyCode: DEFAULT_CURRENCY,
        displayName: 'Lumina',
        unitPriceKrw: PRICE_UNIT_KRW,
        signupBonusLumina: 300,
        referralBonusLumina: 500,
        paidLikeUnitPriceLumina: 10,
        paidLikeDailyLimit: 20,
        firstChargeBonus: {
          eligible: firstChargeEligible,
          rate: FIRST_CHARGE_BONUS_RATE.toString(),
          percent: FIRST_CHARGE_BONUS_RATE.times(100).toString(),
          basis: FIRST_CHARGE_BONUS_BASIS,
          basisField: 'lumina_products.lumina_amount',
          packageBonusIncluded: false,
          packageBonusRepeatable: true,
          appliesTo: 'first_paid_order_per_user',
          ledgerType: 'first_charge_bonus',
          oneTimePerUser: true,
          idempotencyKeyPattern: 'first_charge_bonus:<userId>',
        },
        fulfillment:
          'Paid Lumina is credited only after the payment provider confirms a paid transaction.',
      },
    };
  }

  private parseTake(value?: string) {
    if (!value) {
      return 5;
    }

    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
      throw new BadRequestException('take must be an integer between 1 and 20');
    }

    return parsed;
  }
}

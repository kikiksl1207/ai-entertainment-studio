import { Decimal } from '@prisma/client/runtime/library';
import { LuminaStationService } from './lumina-station.service';

describe('LuminaStationService.getChargePolicy', () => {
  it('returns read-only web, app, ad, and creator request policy', () => {
    const service = new LuminaStationService({} as never);

    const policy = service.getChargePolicy();

    expect(policy).toMatchObject({
      policyVersion: '2026-05-21.charge-policy-v2',
      currency: {
        code: 'LUMINA',
        unitPriceKrw: 10,
        unitLabelKo: '1L = 10원',
      },
      webCharge: {
        baseUnitPriceKrw: 10,
        paidBonusMaxRate: 0.2,
        paidBonusMaxPercent: 20,
        walletMutation: false,
        orderMutationEnabled: false,
      },
      freeAdCharge: {
        userFacingLabelKo: '오늘의 무료 루미나 받기',
        maxRevenueShareRate: 0.5,
        maxRevenueSharePercent: 50,
        dailyLimit: 50,
        ledgerSourcePlanned: 'ad_reward',
        walletMutation: false,
        claimMutationEnabled: false,
      },
      safety: {
        readOnly: true,
        secretsReturned: false,
        walletMutation: false,
        paymentOrderMutation: false,
        adSdkMutation: false,
      },
    });
    expect(policy.bonusPolicy).toMatchObject({
      packageBonus: {
        repeatable: true,
        sourceField: 'lumina_products.bonus_amount',
        includedInProductTotal: true,
        firstChargeBonusAppliesAgain: false,
      },
      firstChargeBonus: {
        oneTimePerUser: true,
        appliesTo: 'first_paid_order_per_user',
        rate: '0.1',
        percent: 10,
        basis: 'base_lumina_only',
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
    });
    expect(policy.appCharge.packages).toEqual([
      expect.objectContaining({
        sku: 'APP_LUMINA_100',
        priceKrw: 1000,
        luminaAmount: 100,
        bonusLumina: 0,
        totalLumina: 100,
      }),
      expect.objectContaining({
        sku: 'APP_LUMINA_300',
        priceKrw: 3000,
        luminaAmount: 300,
        bonusLumina: 0,
        totalLumina: 300,
      }),
      expect.objectContaining({
        sku: 'APP_LUMINA_500',
        priceKrw: 5000,
        luminaAmount: 500,
        bonusLumina: 0,
        totalLumina: 500,
      }),
      expect.objectContaining({
        sku: 'APP_LUMINA_1000',
        priceKrw: 10000,
        luminaAmount: 1000,
        bonusLumina: 0,
        totalLumina: 1000,
      }),
      expect.objectContaining({
        sku: 'APP_LUMINA_5800',
        priceKrw: 50000,
        luminaAmount: 5000,
        bonusLumina: 800,
        totalLumina: 5800,
      }),
      expect.objectContaining({
        sku: 'APP_LUMINA_12000',
        priceKrw: 100000,
        luminaAmount: 10000,
        bonusLumina: 2000,
        totalLumina: 12000,
      }),
    ]);
    expect(policy.appCharge.packages).toHaveLength(6);
    expect(policy.appCharge.packages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ priceKrw: 20000 }),
        expect.objectContaining({ priceKrw: 30000 }),
      ]),
    );
    expect(policy.appCharge.deferredPackages).toEqual([]);
    expect(policy.creatorRequests.products).toEqual([
      expect.objectContaining({ requestType: 'gallery_view', priceLumina: 0 }),
      expect.objectContaining({ requestType: 'basic_image', priceLumina: 30 }),
      expect.objectContaining({ requestType: 'premium_image', priceLumina: 100 }),
      expect.objectContaining({ requestType: 'short_video', priceLumina: 300 }),
    ]);
  });
});

describe('LuminaStationService.getStation', () => {
  it('separates repeatable package bonus from one-time first-charge bonus math', async () => {
    const prisma = {
      walletAccount: {
        upsert: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000401',
          cachedBalance: new Decimal(0),
        }),
      },
      luminaProduct: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: '00000000-0000-4000-8000-000000000501',
            sku: 'LUMINA_5800',
            name: 'Lumina 5,000 + bonus 800',
            priceAmount: new Decimal(50000),
            luminaAmount: new Decimal(5000),
            bonusAmount: new Decimal(800),
          },
          {
            id: '00000000-0000-4000-8000-000000000502',
            sku: 'LUMINA_12000',
            name: 'Lumina 10,000 + bonus 2,000',
            priceAmount: new Decimal(100000),
            luminaAmount: new Decimal(10000),
            bonusAmount: new Decimal(2000),
          },
        ]),
      },
      paymentOrder: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
      ),
    };
    const service = new LuminaStationService(prisma as never);

    const station = await service.getStation('00000000-0000-4000-8000-000000000001');

    const fiftyKProduct = station.products.find((product: { priceAmount: Decimal }) =>
      product.priceAmount.equals(50000),
    );
    const hundredKProduct = station.products.find((product: { priceAmount: Decimal }) =>
      product.priceAmount.equals(100000),
    );
    expect(fiftyKProduct).toMatchObject({
      sku: 'LUMINA_5800',
    });
    expect(fiftyKProduct?.totalLumina.toString()).toBe('5800');
    expect(fiftyKProduct?.packageBonusLumina.toString()).toBe('800');
    expect(fiftyKProduct?.firstChargeBonusBasisLumina.toString()).toBe('5000');
    expect(fiftyKProduct?.firstChargeBonusLumina.toString()).toBe('500');
    expect(fiftyKProduct?.firstChargeTotalLumina.toString()).toBe('6300');
    expect(hundredKProduct?.totalLumina.toString()).toBe('12000');
    expect(hundredKProduct?.packageBonusLumina.toString()).toBe('2000');
    expect(hundredKProduct?.firstChargeBonusBasisLumina.toString()).toBe('10000');
    expect(hundredKProduct?.firstChargeBonusLumina.toString()).toBe('1000');
    expect(hundredKProduct?.firstChargeTotalLumina.toString()).toBe('13000');
    expect(station.policy.firstChargeBonus).toMatchObject({
      eligible: true,
      rate: '0.1',
      percent: '10',
      basis: 'base_lumina_only',
      basisField: 'lumina_products.lumina_amount',
      packageBonusIncluded: false,
      packageBonusRepeatable: true,
      appliesTo: 'first_paid_order_per_user',
      ledgerType: 'first_charge_bonus',
      oneTimePerUser: true,
      idempotencyKeyPattern: 'first_charge_bonus:<userId>',
    });
  });
});

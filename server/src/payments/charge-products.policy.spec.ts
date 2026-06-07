import { Decimal } from '@prisma/client/runtime/library';
import {
  ACTIVE_CHARGE_PRICE_AMOUNTS_KRW,
  ACTIVE_CHARGE_PRODUCT_SPECS,
  APP_CHARGE_PRODUCT_SPECS,
  CHARGE_PRODUCT_POLICY_READ_MODEL,
  activeChargeProductWhere,
  isActiveChargeProduct,
} from './charge-products.policy';

describe('charge products server policy', () => {
  it('fixes the six server-authoritative web charge packages', () => {
    expect(ACTIVE_CHARGE_PRICE_AMOUNTS_KRW).toEqual([
      1000,
      3000,
      5000,
      10000,
      50000,
      100000,
    ]);
    expect(ACTIVE_CHARGE_PRODUCT_SPECS).toEqual([
      expect.objectContaining({
        sku: 'LUMINA_100',
        priceAmount: 1000,
        luminaAmount: 100,
        bonusAmount: 0,
      }),
      expect.objectContaining({
        sku: 'LUMINA_300',
        priceAmount: 3000,
        luminaAmount: 300,
        bonusAmount: 0,
      }),
      expect.objectContaining({
        sku: 'LUMINA_500',
        priceAmount: 5000,
        luminaAmount: 500,
        bonusAmount: 0,
      }),
      expect.objectContaining({
        sku: 'LUMINA_1000',
        priceAmount: 10000,
        luminaAmount: 1000,
        bonusAmount: 0,
      }),
      expect.objectContaining({
        sku: 'LUMINA_5800',
        priceAmount: 50000,
        luminaAmount: 5000,
        bonusAmount: 800,
      }),
      expect.objectContaining({
        sku: 'LUMINA_12000',
        priceAmount: 100000,
        luminaAmount: 10000,
        bonusAmount: 2000,
      }),
    ]);
  });

  it('builds the active product query from exact SKU, price, base, and bonus', () => {
    expect(activeChargeProductWhere({ id: 'product-id' })).toMatchObject({
      id: 'product-id',
      status: 'active',
      OR: expect.arrayContaining([
        {
          sku: 'LUMINA_100',
          priceAmount: 1000,
          priceCurrency: 'KRW',
          luminaAmount: 100,
          bonusAmount: 0,
        },
        {
          sku: 'LUMINA_12000',
          priceAmount: 100000,
          priceCurrency: 'KRW',
          luminaAmount: 10000,
          bonusAmount: 2000,
        },
      ]),
    });
  });

  it('separates web and app SKU read models on the same six price tiers', () => {
    expect(CHARGE_PRODUCT_POLICY_READ_MODEL).toMatchObject({
      version: '2026-06-08.charge-sku-policy-read-model.v1',
      sourceOfTruth: 'server_charge_product_policy',
      priceCurrency: 'KRW',
      priceAmountsKrw: [1000, 3000, 5000, 10000, 50000, 100000],
      packageCountPerChannel: 6,
      channels: {
        web: {
          channel: 'web',
          feePolicyKey: 'web_pg_fee_reflected',
          checkoutEndpoint: 'POST /api/v1/payments/checkout',
          providerReceiptRequired: false,
        },
        app: {
          channel: 'app',
          feePolicyKey: 'app_store_fee_reflected',
          fulfillmentEndpoint: 'POST /api/v1/payments/app-store/fulfill',
          providerReceiptRequired: true,
        },
      },
      serverAuthority: {
        clientSubmittedSkuTrusted: false,
        clientSubmittedPriceTrusted: false,
        clientSubmittedLuminaAmountTrusted: false,
        clientSubmittedBonusAmountTrusted: false,
        providerReceiptRequiredForApp: true,
        walletLedgerSourceOfTruth: true,
        settlementMutation: false,
        payoutMutation: false,
      },
    });
    expect(
      CHARGE_PRODUCT_POLICY_READ_MODEL.channels.web.products.map(
        (product) => product.priceAmount,
      ),
    ).toEqual(ACTIVE_CHARGE_PRICE_AMOUNTS_KRW);
    expect(APP_CHARGE_PRODUCT_SPECS.map((product) => product.priceAmount)).toEqual(
      ACTIVE_CHARGE_PRICE_AMOUNTS_KRW,
    );
    expect(APP_CHARGE_PRODUCT_SPECS).toHaveLength(6);
    expect(APP_CHARGE_PRODUCT_SPECS.map((product) => product.sku)).toEqual([
      'APP_LUMINA_100',
      'APP_LUMINA_300',
      'APP_LUMINA_500',
      'APP_LUMINA_1000',
      'APP_LUMINA_5800',
      'APP_LUMINA_12000',
    ]);
    expect(activeChargeProductWhere().OR).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sku: 'APP_LUMINA_100' }),
      ]),
    );
  });

  it('rejects same-price tampered active products', () => {
    expect(
      isActiveChargeProduct({
        sku: 'LUMINA_100',
        priceAmount: new Decimal(1000),
        priceCurrency: 'KRW',
        luminaAmount: new Decimal(999999),
        bonusAmount: new Decimal(0),
      }),
    ).toBe(false);
    expect(
      isActiveChargeProduct({
        sku: 'LUMINA_5800',
        priceAmount: new Decimal(50000),
        priceCurrency: 'KRW',
        luminaAmount: new Decimal(5000),
        bonusAmount: new Decimal(800),
      }),
    ).toBe(true);
  });
});

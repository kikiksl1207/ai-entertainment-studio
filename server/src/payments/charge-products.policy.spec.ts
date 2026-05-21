import { Decimal } from '@prisma/client/runtime/library';
import {
  ACTIVE_CHARGE_PRICE_AMOUNTS_KRW,
  ACTIVE_CHARGE_PRODUCT_SPECS,
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

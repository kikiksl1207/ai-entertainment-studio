import { Decimal } from '@prisma/client/runtime/library';

export type ActiveChargeProductSpec = {
  sku: string;
  name: string;
  priceAmount: number;
  priceCurrency: 'KRW';
  luminaAmount: number;
  bonusAmount: number;
};

export const ACTIVE_CHARGE_PRODUCT_SPECS = [
  {
    sku: 'LUMINA_100',
    name: 'Lumina 100',
    priceAmount: 1000,
    priceCurrency: 'KRW',
    luminaAmount: 100,
    bonusAmount: 0,
  },
  {
    sku: 'LUMINA_300',
    name: 'Lumina 300',
    priceAmount: 3000,
    priceCurrency: 'KRW',
    luminaAmount: 300,
    bonusAmount: 0,
  },
  {
    sku: 'LUMINA_500',
    name: 'Lumina 500',
    priceAmount: 5000,
    priceCurrency: 'KRW',
    luminaAmount: 500,
    bonusAmount: 0,
  },
  {
    sku: 'LUMINA_1000',
    name: 'Lumina 1,000',
    priceAmount: 10000,
    priceCurrency: 'KRW',
    luminaAmount: 1000,
    bonusAmount: 0,
  },
  {
    sku: 'LUMINA_5800',
    name: 'Lumina 5,000 + bonus 800',
    priceAmount: 50000,
    priceCurrency: 'KRW',
    luminaAmount: 5000,
    bonusAmount: 800,
  },
  {
    sku: 'LUMINA_12000',
    name: 'Lumina 10,000 + bonus 2,000',
    priceAmount: 100000,
    priceCurrency: 'KRW',
    luminaAmount: 10000,
    bonusAmount: 2000,
  },
] as const satisfies readonly ActiveChargeProductSpec[];

export const ACTIVE_CHARGE_PRODUCT_SKUS = ACTIVE_CHARGE_PRODUCT_SPECS.map(
  (product) => product.sku,
);

export const ACTIVE_CHARGE_PRICE_AMOUNTS_KRW = ACTIVE_CHARGE_PRODUCT_SPECS.map(
  (product) => product.priceAmount,
);

export const ACTIVE_CHARGE_PRODUCT_BY_SKU =
  ACTIVE_CHARGE_PRODUCT_SPECS.reduce<Record<string, ActiveChargeProductSpec>>(
    (acc, product) => {
      acc[product.sku] = product;
      return acc;
    },
    {},
  );

export function activeChargeProductWhere(
  extra: Record<string, unknown> = {},
) {
  return {
    ...extra,
    status: 'active',
    OR: ACTIVE_CHARGE_PRODUCT_SPECS.map((product) => ({
      sku: product.sku,
      priceAmount: product.priceAmount,
      priceCurrency: product.priceCurrency,
      luminaAmount: product.luminaAmount,
      bonusAmount: product.bonusAmount,
    })),
  };
}

export function isActiveChargeProduct(product: {
  sku?: string | null;
  priceAmount: Decimal.Value;
  priceCurrency?: string | null;
  luminaAmount: Decimal.Value;
  bonusAmount: Decimal.Value;
}) {
  if (!product.sku) {
    return false;
  }

  const expected = ACTIVE_CHARGE_PRODUCT_BY_SKU[product.sku];

  if (!expected) {
    return false;
  }

  return (
    product.priceCurrency === expected.priceCurrency &&
    new Decimal(product.priceAmount).equals(expected.priceAmount) &&
    new Decimal(product.luminaAmount).equals(expected.luminaAmount) &&
    new Decimal(product.bonusAmount).equals(expected.bonusAmount)
  );
}

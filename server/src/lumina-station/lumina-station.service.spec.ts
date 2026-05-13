import { LuminaStationService } from './lumina-station.service';

describe('LuminaStationService.getChargePolicy', () => {
  it('returns read-only web, app, ad, and creator request policy', () => {
    const service = new LuminaStationService({} as never);

    const policy = service.getChargePolicy();

    expect(policy).toMatchObject({
      policyVersion: '2026-05-13.charge-policy-v1',
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
    expect(policy.appCharge.packages).toEqual([
      expect.objectContaining({ priceKrw: 1000, luminaAmount: 70 }),
      expect.objectContaining({ priceKrw: 5000, luminaAmount: 350 }),
      expect.objectContaining({ priceKrw: 10000, luminaAmount: 700 }),
      expect.objectContaining({ priceKrw: 20000, luminaAmount: 1400 }),
      expect.objectContaining({ priceKrw: 50000, luminaAmount: 3750 }),
      expect.objectContaining({ priceKrw: 100000, luminaAmount: 8000 }),
    ]);
    expect(policy.appCharge.deferredPackages).toEqual([
      expect.objectContaining({ priceKrw: 30000 }),
      expect.objectContaining({ priceKrw: 70000 }),
    ]);
    expect(policy.creatorRequests.products).toEqual([
      expect.objectContaining({ requestType: 'gallery_view', priceLumina: 0 }),
      expect.objectContaining({ requestType: 'basic_image', priceLumina: 30 }),
      expect.objectContaining({ requestType: 'premium_image', priceLumina: 100 }),
      expect.objectContaining({ requestType: 'short_video', priceLumina: 300 }),
    ]);
  });
});

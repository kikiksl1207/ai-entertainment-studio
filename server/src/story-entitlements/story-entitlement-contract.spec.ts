import {
  STORY_ENTITLEMENT_PURCHASE_TYPES,
  STORY_ENTITLEMENT_STATUSES,
  STORY_STAGE_ENTITLEMENT_ADMIN_AUDIT_PROJECTION,
} from './story-entitlement-contract';

describe('STORY_STAGE_ENTITLEMENT_ADMIN_AUDIT_PROJECTION', () => {
  it('defines a read-only admin audit projection for chapter and season entitlements', () => {
    const projection = STORY_STAGE_ENTITLEMENT_ADMIN_AUDIT_PROJECTION;

    expect(projection).toMatchObject({
      version: '2026-06-18.story-entitlement-admin-audit-projection.v1',
      feature: 'story_stage_entitlement_admin_audit_projection',
      status: 'read_model_contract_only',
      audience: 'admin_story_entitlement_operator',
      readOnly: true,
      enabled: false,
      mutationEnabled: false,
      paymentMutationEnabled: false,
      refundMutationEnabled: false,
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      paidLikeMutationEnabled: false,
      sourceTables: {
        futureEntitlementTable: 'story_entitlements',
        futureAuditTable: 'story_entitlement_audit_events',
        existingWalletLedgerJoin: false,
        existingSettlementJoin: false,
        existingPayoutJoin: false,
      },
    });
    expect(STORY_ENTITLEMENT_PURCHASE_TYPES).toEqual([
      'chapter_single',
      'season_bundle',
      'free_prologue',
      'operator_adjustment',
    ]);
    expect(STORY_ENTITLEMENT_STATUSES).toEqual([
      'active',
      'revoked',
      'expired',
      'refunded',
    ]);
  });

  it('keeps chapter choice access non-billable and video generation separately consented', () => {
    const projection = STORY_STAGE_ENTITLEMENT_ADMIN_AUDIT_PROJECTION;

    expect(projection.entitlementKinds.chapterSingle).toMatchObject({
      purchaseType: 'chapter_single',
      grantsOneChapter: true,
      grantsWholeSeason: false,
      choiceBillingSeparate: false,
    });
    expect(projection.entitlementKinds.seasonBundle).toMatchObject({
      purchaseType: 'season_bundle',
      grantsOneChapter: false,
      grantsWholeSeason: true,
      choiceBillingSeparate: false,
    });
    expect(projection.videoGenerationPolicy).toMatchObject({
      separateConsentChargeException: true,
      entitlementImpliesVideoGenerationAccess: false,
      videoGenerationConsentRequired: true,
      videoGenerationWalletMutationInThisProjection: false,
      videoGenerationSettlementMutationInThisProjection: false,
    });
    expect(projection.projectionFields).toMatchObject({
      choiceBillingSeparate: false,
      videoGenerationConsentChargeSeparate: true,
      purchaseType: STORY_ENTITLEMENT_PURCHASE_TYPES,
      status: STORY_ENTITLEMENT_STATUSES,
    });
  });

  it('does not join wallet, settlement, payout, or paid-like flows', () => {
    const projection = STORY_STAGE_ENTITLEMENT_ADMIN_AUDIT_PROJECTION;
    const serialized = JSON.stringify(projection);

    expect(
      Object.values(projection.forbiddenSideEffects).every(
        (enabled) => enabled === false,
      ),
    ).toBe(true);
    expect(projection.privacy).toMatchObject({
      rawEmailReturned: false,
      rawPaymentProviderIdReturned: false,
      rawPaymentPayloadReturned: false,
      walletLedgerIdReturned: false,
      settlementIdReturned: false,
      payoutIdReturned: false,
      tokenReturned: false,
      cookieReturned: false,
    });
    expect(serialized).toContain('story_entitlements');
    expect(serialized).not.toMatch(
      /wallet_accounts|wallet_ledgers|settlementId":true|payoutId":true/,
    );
  });
});

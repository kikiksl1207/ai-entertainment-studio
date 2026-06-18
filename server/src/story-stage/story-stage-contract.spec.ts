import {
  STORY_STAGE_CONTRACT,
  STORY_STAGE_FREE_PROLOGUE_ENTITLEMENT_GUARD,
  STORY_STAGE_PURCHASE_LEDGER_SKELETON,
} from './story-stage-contract';

describe('Story Stage contract skeleton', () => {
  it('guards the free prologue entitlement as one use per platform account', () => {
    const guard = STORY_STAGE_FREE_PROLOGUE_ENTITLEMENT_GUARD;

    expect(STORY_STAGE_CONTRACT.freePrologueEntitlementGuard).toBe(guard);
    expect(guard).toMatchObject({
      version: '2026-06-18.story-stage-free-prologue-entitlement-guard.v1',
      status: 'contract_only',
      entitlement: {
        type: 'story_stage_free_prologue',
        platformAccountLimit: 1,
        uniquenessScope: ['userId', 'story_stage_free_prologue'],
        sourceOfTruth: 'user_entitlements',
        replayBehavior: 'return_existing_entitlement_without_new_session_charge',
      },
      companionPolicy: {
        allowedModes: ['self', 'ai_artist_companion'],
        maxAiArtistCompanions: 1,
        userSelfIncluded: true,
        artistSource: 'server_resolved_active_ai_artist',
        clientSubmittedArtistTrusted: false,
      },
      responsePolicy: {
        stableCodeRequired: true,
        messageKeyRequired: true,
        rawUserFacingEnglishCopy: false,
        walletLedgerIdReturned: false,
        settlementIdReturned: false,
      },
      mutationPolicy: {
        freeEntitlementMutation: true,
        storySessionMutation: true,
        paymentMutation: false,
        walletMutation: false,
        walletDebit: false,
        settlementMutation: false,
        payoutMutation: false,
        providerCall: false,
      },
    });
    expect(guard.validationOrder).toEqual([
      'authenticate_platform_account',
      'resolve_story_pack_and_prologue_chapter',
      'verify_prologue_is_free_and_active',
      'verify_user_has_no_prior_free_prologue_entitlement',
      'resolve_optional_ai_artist_companion',
      'enforce_max_one_ai_artist_companion',
      'create_free_prologue_session_and_entitlement_in_same_transaction',
    ]);
    expect(Object.values(guard.failureCodes)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_FREE_PROLOGUE_ALREADY_USED',
          messageKey: 'storyStage.prologue.alreadyUsed',
        }),
        expect.objectContaining({
          code: 'STORY_PROLOGUE_INVALID_COMPANION',
          messageKey: 'storyStage.prologue.invalidCompanion',
        }),
      ]),
    );
  });

  it('separates chapter and season purchase ledger skeletons without choice-level billing', () => {
    const skeleton = STORY_STAGE_PURCHASE_LEDGER_SKELETON;

    expect(STORY_STAGE_CONTRACT.purchaseLedgerSkeleton).toBe(skeleton);
    expect(skeleton).toMatchObject({
      version: '2026-06-18.story-stage-purchase-ledger-skeleton.v1',
      status: 'contract_only',
      purchaseTypes: ['chapter_single', 'season_bundle'],
      ledgerSourceOfTruth: 'story_purchase_ledger',
      productAuthority: {
        chapterPriceSource: 'story_chapters.server_price_lumina',
        seasonPriceSource: 'story_seasons.server_bundle_price_lumina',
        clientSubmittedPriceTrusted: false,
        clientSubmittedPurchaseTypeTrusted: false,
      },
      chapterSingle: {
        purchaseType: 'chapter_single',
        entitlementType: 'story_chapter_access',
        referenceType: 'story_chapter',
        idempotencyScope: ['userId', 'chapterId', 'purchaseType'],
        grants: ['chapter_read_access', 'choice_access_within_chapter'],
      },
      seasonBundle: {
        purchaseType: 'season_bundle',
        entitlementType: 'story_season_access',
        referenceType: 'story_season',
        idempotencyScope: ['userId', 'seasonId', 'purchaseType'],
      },
      choicePolicy: {
        choiceLevelBilling: false,
        choicesIncludedInChapterPrice: true,
        choicePriceFieldAllowed: false,
        premiumChoiceSurchargeAllowed: false,
        ledgerLinePerChoice: false,
      },
      mutationPolicy: {
        contractAddsEndpoint: false,
        paymentProviderCall: false,
        walletCredit: false,
        walletDebit: false,
        walletLedgerMutation: false,
        refundMutation: false,
        settlementMutation: false,
        payoutMutation: false,
      },
    });
    expect(skeleton.ledgerLineShape).toMatchObject({
      purchaseType: 'chapter_single|season_bundle',
      amountLumina: 'server_calculated_integer_lumina',
      idempotencyKey: 'story_stage:<purchaseType>:<userId>:<referenceId>',
    });
  });
});

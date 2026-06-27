import {
  STORY_STAGE_AI_ARTIST_SETTLEMENT_SPLIT_SKELETON,
  STORY_STAGE_AUTHOR_REVENUE_READ_MODEL_CONTRACT,
  STORY_STAGE_AUTHOR_INTERRUPTION_REFUND_PENALTY_READ_MODEL,
  STORY_STAGE_COMPANION_BILLING_PROJECTION_CONTRACT,
  STORY_STAGE_COMPANION_SWAP_COST_PROJECTION_CONTRACT,
  STORY_STAGE_AUTHOR_SETTLEMENT_REFUND_READ_MODEL,
  STORY_STAGE_CONTRACT,
  STORY_STAGE_FREE_PROLOGUE_ENTITLEMENT_GUARD,
  STORY_STAGE_PACK_CHAPTER_SESSION_CONTRACT,
  STORY_STAGE_PURCHASE_LEDGER_SKELETON,
  STORY_STAGE_SESSION_RETENTION_POLICY_CONTRACT,
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

  it('defines AI artist companion settlement split as a read-only skeleton', () => {
    const skeleton = STORY_STAGE_AI_ARTIST_SETTLEMENT_SPLIT_SKELETON;

    expect(STORY_STAGE_CONTRACT.aiArtistSettlementSplitSkeleton).toBe(skeleton);
    expect(skeleton).toMatchObject({
      version: '2026-06-18.story-stage-ai-artist-settlement-split.v1',
      status: 'read_model_skeleton_only',
      readModel: 'story_stage_settlement_preview',
      aiArtistParticipation: {
        appliesWhenAiArtistCompanionPresent: true,
        aiParticipationCostRateBps: 5000,
        aiCreatorSettlementRateBps: 5000,
        sourceAmount: 'gross_story_purchase_amount_lumina',
        settlementBucket: 'ai_creator_participation_cost',
      },
      storyAuthorSettlement: {
        remainingBasisAfterAiCost: true,
        maxAuthorSettlementRateBps: 5000,
        sourceAmount: 'gross_minus_ai_participation_cost',
        settlementBucket: 'story_author_share',
      },
      mutationPolicy: {
        contractAddsSettlementEndpoint: false,
        settlementMutation: false,
        payoutMutation: false,
        walletMutation: false,
        walletLedgerMutation: false,
        paymentMutation: false,
      },
      responsePolicy: {
        readOnly: true,
        stableCodeRequired: true,
        messageKeyRequired: true,
        rawUserFacingEnglishCopy: false,
        privateUserIdentifierReturned: false,
      },
    });
    expect(skeleton.splitOrder).toEqual([
      'load_granted_story_purchase',
      'detect_ai_artist_companion_participation',
      'reserve_ai_participation_cost_first',
      'calculate_story_author_share_from_remaining_basis',
      'publish_read_only_preview_without_mutation',
    ]);
    expect(skeleton.projectionFields).toEqual(
      expect.arrayContaining([
        'grossAmountLumina',
        'aiParticipationCostLumina',
        'storyAuthorBasisLumina',
        'storyAuthorMaxShareLumina',
        'platformRemainderLumina',
      ]),
    );
  });

  it('separates story entry and AI companion roster billing as read-only preview', () => {
    const projection = STORY_STAGE_COMPANION_BILLING_PROJECTION_CONTRACT;

    expect(STORY_STAGE_CONTRACT.companionBillingProjection).toBe(projection);
    expect(projection).toMatchObject({
      version: '2026-06-27.story-companion-billing-projection.v1',
      status: 'read_model_contract_only',
      readModel: 'story_companion_billing_preview',
      storyEntryCharge: {
        source: 'story_purchase_ledger.chapter_single_or_season_bundle',
        amountField: 'storyEntryCostLumina',
        alreadyEntitledAmountLumina: 0,
        clientSubmittedEntryCostTrusted: false,
      },
      companionRosterPolicy: {
        freePrologue: {
          maxAiCompanions: 1,
          paidExpansionAllowed: false,
          companionCostLumina: 0,
        },
        paidStory: {
          maxAiCompanions: 5,
          firstCompanionFree: true,
          paidCompanionSlots: 4,
          addOrSwapCostSource: 'server_story_product_policy',
          clientSubmittedCompanionCostTrusted: false,
        },
      },
      costSeparation: {
        storyEntryAndCompanionCostSameField: false,
        storyEntryCostField: 'storyEntryCostLumina',
        companionCostField: 'companionRosterCostLumina',
        doubleChargeAllowed: false,
      },
      rosterChangeStates: {
        add: {
          action: 'add_companion',
          costSource: 'server_story_product_policy',
          preservesChapterEntitlement: true,
        },
        swap: {
          action: 'swap_companion',
          costSource: 'server_story_product_policy',
          preservesChapterEntitlement: true,
        },
        leave: {
          action: 'leave_companion',
          costLumina: 0,
          refundPreviewOnly: true,
          preservesPurchasedStoryAccess: true,
        },
      },
      privacy: {
        rawPaymentLedgerIdReturned: false,
        rawWalletLedgerIdReturned: false,
        privateArtistNotesReturned: false,
        providerPromptReturned: false,
      },
    });
    expect(
      Object.values(projection.mutationPolicy).every(
        (enabled) => enabled === false,
      ),
    ).toBe(true);
    expect(projection.projectionFields).toEqual(
      expect.arrayContaining([
        'storyEntryCostLumina',
        'companionRosterCostLumina',
        'freeCompanionCount',
        'paidCompanionCount',
        'totalPreviewLumina',
        'rosterChangeState',
      ]),
    );
  });

  it('separates companion swap cost preview from story entry and mutations', () => {
    const projection = STORY_STAGE_COMPANION_SWAP_COST_PROJECTION_CONTRACT;

    expect(STORY_STAGE_CONTRACT.companionSwapCostProjection).toBe(projection);
    expect(projection).toMatchObject({
      version: '2026-06-28.story-companion-swap-cost-projection.v1',
      status: 'read_model_contract_only',
      readModel: 'story_companion_swap_cost_preview',
      sourceOfTruth: {
        currentRoster: 'story_session_companions.confirmed',
        storyPolicy: 'server_story_product_policy',
        entitlements: 'user_entitlements.story_chapter_or_season_access',
      },
      actionStates: {
        keep: {
          action: 'keep_existing_companion',
          costLumina: 0,
          preservesCurrentContext: true,
          refundPreview: false,
        },
        add: {
          action: 'add_companion',
          costSource: 'server_story_product_policy',
          preservesPurchasedStoryAccess: true,
        },
        swap: {
          action: 'swap_companion',
          costSource: 'server_story_product_policy',
          previousCompanionContextArchived: true,
          preservesPurchasedStoryAccess: true,
        },
        leave: {
          action: 'leave_companion',
          costLumina: 0,
          refundPreviewOnly: true,
          preservesPurchasedStoryAccess: true,
        },
      },
      separationPolicy: {
        storyEntryCostSeparate: true,
        companionChangeCostSeparate: true,
        clientSubmittedCompanionCostTrusted: false,
        clientSubmittedRosterTrusted: false,
        leaveDoesNotRefundWallet: true,
        keepDoesNotCreateLedger: true,
        swapDoesNotRevokePurchasedStoryAccess: true,
      },
    });
    expect(projection.projectionFields).toEqual(
      expect.arrayContaining([
        'storySessionId',
        'currentCompanionArtistId',
        'targetCompanionArtistId',
        'actionState',
        'companionChangeCostLumina',
        'totalPreviewLumina',
        'messageKey',
      ]),
    );
    expect(
      Object.values(projection.mutationPolicy).every(
        (enabled) => enabled === false,
      ),
    ).toBe(true);
    expect(projection.privacy).toMatchObject({
      rawPaymentLedgerIdReturned: false,
      rawWalletLedgerIdReturned: false,
      privateArtistNotesReturned: false,
      providerPromptReturned: false,
      adminMemoReturned: false,
    });
  });

  it('separates author revenue read model buckets from AI participation and payout mutation', () => {
    const readModel = STORY_STAGE_AUTHOR_REVENUE_READ_MODEL_CONTRACT;

    expect(STORY_STAGE_CONTRACT.authorRevenueReadModel).toBe(readModel);
    expect(readModel).toMatchObject({
      version: '2026-06-23.story-stage-author-revenue-read-model.v1',
      status: 'read_model_contract_only',
      readModel: 'story_author_revenue_preview',
      sourceLedgers: {
        chapterPurchaseLedger: 'story_purchase_ledger.chapter_single',
        seasonBundleLedger: 'story_purchase_ledger.season_bundle',
        entitlementLedger: 'user_entitlements.story_chapter_or_season_access',
        aiArtistParticipation: 'story_sessions.ai_artist_id',
      },
      revenueBuckets: {
        chapterGrossRevenue: {
          source: 'granted_chapter_single_purchase',
          amountField: 'chapterGrossLumina',
          refundAdjusted: true,
        },
        seasonDiscountAllocation: {
          source: 'season_bundle_allocated_per_chapter',
          amountField: 'seasonDiscountLumina',
          discountIsSeparateFromRefund: true,
        },
        aiArtistParticipationCost: {
          source: 'ai_artist_companion_participation',
          amountField: 'aiParticipationCostLumina',
          deductedBeforeAuthorShare: true,
        },
        storyAuthorShare: {
          source: 'chapter_net_after_discount_refund_and_ai_participation',
          amountField: 'authorShareLumina',
          payoutEligible: false,
        },
      },
      separationPolicy: {
        chapterRevenueAndSeasonDiscountSameField: false,
        aiArtistParticipationIncludedInAuthorShare: false,
        authorShareIncludesUnsettledOnly: true,
        clientSubmittedRevenueTrusted: false,
        clientSubmittedDiscountTrusted: false,
        clientSubmittedShareTrusted: false,
      },
      allocationSkeleton: {
        version: '2026-06-23.story-author-revenue-bucket-allocation.v1',
        chapterRevenue: {
          bucket: 'chapter_direct_revenue',
          source: 'completed_chapter_single_purchase',
          grossField: 'chapterGrossLumina',
          refundAdjustmentField: 'refundAdjustedLumina',
          seasonBundleRevenueIncluded: false,
        },
        seasonRevenue: {
          bucket: 'season_bundle_allocated_revenue',
          source: 'completed_season_bundle_purchase_allocated_per_chapter',
          allocatedField: 'seasonAllocatedGrossLumina',
          discountField: 'seasonDiscountLumina',
          chapterDirectRevenueIncluded: false,
        },
        aiCompanionCost: {
          bucket: 'ai_character_companion_participation_cost',
          source: 'story_session_companion_roster_confirmed_by_server',
          amountField: 'aiParticipationCostLumina',
          deductedBeforeAuthorShare: true,
          providerCostPayloadReturned: false,
        },
        authorPreview: {
          basisField: 'authorShareBasisLumina',
          previewField: 'authorShareLumina',
          finalSettlementAuthority: false,
          payoutEligible: false,
        },
      },
      noMutationPolicy: {
        contractAddsEndpoint: false,
        paymentMutation: false,
        refundMutation: false,
        settlementMutation: false,
        payoutMutation: false,
        walletMutation: false,
        walletLedgerMutation: false,
      },
      responsePolicy: {
        readOnly: true,
        rawUserFacingEnglishCopy: false,
        privateReaderIdentifierReturned: false,
        payoutAccountReturned: false,
        internalFormulaReturned: false,
      },
    });
    expect(readModel.projectionFields).toEqual(
      expect.arrayContaining([
        'chapterGrossLumina',
        'seasonDiscountLumina',
        'aiParticipationCostLumina',
        'authorShareBasisLumina',
        'authorShareLumina',
        'payoutEligible',
      ]),
    );
    expect(readModel.allocationSkeleton.calculationOrder).toEqual([
      'load_completed_chapter_purchase_revenue',
      'allocate_completed_season_bundle_revenue_to_chapter',
      'subtract_refund_or_chargeback_adjustment',
      'reserve_ai_character_companion_participation_cost',
      'calculate_story_author_share_preview',
      'return_read_only_projection_without_settlement_or_payout_mutation',
    ]);
  });

  it('keeps continue-session retention separate from purchase history', () => {
    const policy = STORY_STAGE_SESSION_RETENTION_POLICY_CONTRACT;

    expect(STORY_STAGE_CONTRACT.sessionRetentionPolicy).toBe(policy);
    expect(policy).toMatchObject({
      version: '2026-06-18.story-stage-session-retention-policy.v1',
      status: 'contract_only',
      sessionStatuses: ['active', 'paused', 'archived_inactive'],
      archivePolicy: {
        inactivityDays: 30,
        clockSource: 'server_time',
        trigger: 'no_user_progress_for_30_days',
        action: 'mark_session_archived_inactive',
        hardDeleteSession: false,
        deleteChoices: false,
        deleteProgress: false,
      },
      cleanupReadModel: {
        version: '2026-06-23.story-continuation-expiry-cleanup-read-model.v1',
        readModel: 'story_continuation_expiry_cleanup_preview',
        endpoint: 'GET /api/v1/me/story-stage/sessions/continuation-cleanup',
        enabled: false,
        readOnly: true,
        inactivityThresholdDays: 30,
        staleSessionStatusKey: 'archived_inactive',
        projectionFields: expect.arrayContaining([
          'sessionId',
          'lastProgressAt',
          'inactiveDays',
          'expiryCandidate',
          'dropAvailability',
          'entitlementRetention',
          'companionRetention',
        ]),
        stateSeparation: {
          sessionArchivedInactive: true,
          chapterEntitlementDeleted: false,
          seasonEntitlementDeleted: false,
          purchasedHistoryDeleted: false,
          companionRosterDeleted: false,
          refundCandidateCreated: false,
        },
        dropAvailability: {
          userCanDropArchivedSession: true,
          dropDoesNotCancelEntitlement: true,
          dropDoesNotRefundWallet: true,
          messageKey: 'storyStage.session.archive.dropAvailable',
        },
        companionRetention: {
          selectedAiCompanionRetained: true,
          companionContextMayBeSummarized: true,
          paidCompanionAccessCanceled: false,
        },
      },
      purchaseHistoryPolicy: {
        purchaseHistoryRetained: true,
        chapterEntitlementsRetained: true,
        seasonEntitlementsRetained: true,
        archivedSessionCancelsPurchase: false,
        archivedSessionRefundsPurchase: false,
        restoreRequiresNewPurchase: false,
      },
      copyAndStatusPolicy: {
        rawStatusAsCopy: false,
        rawUserFacingEnglishCopy: false,
        titleKey: 'storyStage.session.archive.title',
        bodyKey: 'storyStage.session.archive.body',
        ctaKey: 'storyStage.session.archive.continueCta',
        statusKey: 'storyStage.session.status.archivedInactive',
        copyMustExplainPurchaseHistoryRetained: true,
      },
      inactivityExpirationBackendGuard: {
        version: '2026-06-24.story-inactivity-expiration-backend-guard.v1',
        status: 'read_model_contract_only',
        readOnly: true,
        inactivityThresholdDays: 30,
        serverClockAuthoritative: true,
        candidateStatusFrom: ['active', 'paused'],
        expiredStatusKey: 'archived_inactive',
        retentionPolicy: {
          hardDeleteSession: false,
          deleteChoices: false,
          deleteProgress: false,
          cancelPurchase: false,
          revokeChapterEntitlement: false,
          revokeSeasonEntitlement: false,
        },
      },
      mutationPolicy: {
        contractAddsArchiveJob: false,
        userProgressMutation: false,
        hardDeleteMutation: false,
        purchaseCancellationMutation: false,
        walletMutation: false,
        refundMutation: false,
        settlementMutation: false,
        payoutMutation: false,
      },
    });
    expect(policy.inactivityExpirationBackendGuard.decisionOrder).toEqual([
      'load_owner_session',
      'calculate_inactive_days_from_last_progress_at',
      'mark_candidate_when_inactive_days_gte_30',
      'return_read_model_without_session_delete',
      'preserve_purchase_and_entitlement_history',
    ]);
    expect(
      Object.values(
        policy.inactivityExpirationBackendGuard.mutationPolicy,
      ).every((enabled) => enabled === false),
    ).toBe(true);
  });

  it('models author interruption refund and settlement penalty without mutations', () => {
    const readModel = STORY_STAGE_AUTHOR_INTERRUPTION_REFUND_PENALTY_READ_MODEL;

    expect(STORY_STAGE_CONTRACT.authorInterruptionRefundPenaltyReadModel).toBe(
      readModel,
    );
    expect(readModel).toMatchObject({
      version: '2026-06-18.story-stage-author-interruption-refund-penalty.v1',
      status: 'read_model_contract_only',
      readModel: 'story_author_interruption_refund_penalty_preview',
      triggerPolicy: {
        events: ['long_hiatus', 'author_discontinued'],
        longHiatusThresholdSource: 'story_stage_policy.author_inactivity_days',
        authorDiscontinuedSource: 'story_packs.publication_status',
        manualOperatorReviewRequired: true,
      },
      refundCandidatePolicy: {
        completedChaptersRefundEligible: false,
        completedChaptersReason: 'reader_already_completed_chapter',
        incompleteStartedChaptersPartialRefundCandidate: true,
        unpublishedPurchasedChaptersPartialRefundCandidate: true,
        futureSeasonChaptersCandidate: true,
        refundAmountSource: 'server_calculated_unconsumed_chapter_value_lumina',
        clientSubmittedRefundAmountTrusted: false,
      },
      settlementPenaltyPreview: {
        penaltyAppliesTo: 'future_unsettled_story_author_share_only',
        alreadySettledPayoutsReopened: false,
        authorRateChangeMutation: false,
        payoutHoldMutation: false,
        requiresOperatorDecision: true,
      },
      readOnlyAuditGuard: {
        version: '2026-06-22.story-refund-penalty-read-only-audit-guard.v1',
        status: 'read_model_contract_only',
        conflictPolicy: 'separate_refund_candidates_from_author_penalty_preview',
        chapterBuckets: {
          completed: {
            refundEligible: false,
            authorPenaltyApplies: false,
            settlementRateLocked: true,
            reasonKey: 'reader_already_completed_chapter',
          },
          incompleteStarted: {
            refundEligible: true,
            authorPenaltyApplies: false,
            settlementRateLocked: false,
            reasonKey: 'unconsumed_started_chapter',
          },
          discontinuedFuture: {
            refundEligible: true,
            authorPenaltyApplies: true,
            settlementRateLocked: false,
            reasonKey: 'author_discontinued_future_chapter',
          },
        },
      },
      mutationPolicy: {
        contractAddsRefundEndpoint: false,
        refundMutation: false,
        walletCredit: false,
        walletDebit: false,
        walletLedgerMutation: false,
        settlementRateMutation: false,
        settlementMutation: false,
        payoutMutation: false,
      },
    });
    expect(readModel.projectionFields).toEqual(
      expect.arrayContaining([
        'completedChapterIdsExcluded',
        'partialRefundCandidateChapterIds',
        'estimatedRefundLumina',
        'authorPenaltyPreview',
        'reviewRequired',
      ]),
    );
    expect(readModel.readOnlyAuditGuard.auditProjectionFields).toEqual([
      'chapterBucket',
      'refundCandidateState',
      'authorPenaltyState',
      'settlementRateLocked',
      'refundMutationAllowed',
      'settlementMutationAllowed',
      'payoutMutationAllowed',
    ]);
    expect(readModel.readOnlyAuditGuard.forbiddenMergedStates).toEqual([
      'completed_chapter_refund_and_penalty_same_row',
      'wallet_refund_and_settlement_rate_update_same_action',
      'payout_hold_and_user_refund_credit_same_action',
    ]);
  });

  it('separates story author settlement and refund read model buckets without payout mutation', () => {
    const readModel = STORY_STAGE_AUTHOR_SETTLEMENT_REFUND_READ_MODEL;

    expect(STORY_STAGE_CONTRACT.authorSettlementRefundReadModel).toBe(readModel);
    expect(readModel).toMatchObject({
      version: '2026-06-27.story-author-settlement-refund-read-model.v1',
      status: 'read_model_contract_only',
      readModel: 'story_author_settlement_refund_preview',
      endpoint:
        'GET /api/v1/creator-studio/story-packs/:packId/settlement-refunds',
      ownerScope: {
        authorOnly: true,
        backstageRequiresPermission: 'story:settlement:read',
        nonOwnerResponse: '403_or_404_without_identity_leak',
      },
      sourceLedgers: {
        purchaseLedger: 'story_purchase_ledger.granted',
        refundLedger: 'story_purchase_ledger.refunded_or_chargeback',
        entitlementLedger: 'user_entitlements.story_chapter_or_season_access',
        authorRevenuePreview: 'story_author_revenue_preview',
      },
      buckets: {
        grossStoryRevenue: {
          source: 'granted_chapter_or_season_purchase',
          amountField: 'grossLumina',
        },
        refundAdjustment: {
          source: 'refunded_or_chargeback_purchase_rows',
          amountField: 'refundAdjustedLumina',
          deductedBeforeAuthorShare: true,
        },
        aiCompanionCost: {
          source: 'server_confirmed_ai_companion_participation',
          amountField: 'aiCompanionCostLumina',
          deductedBeforeAuthorShare: true,
        },
        authorSharePreview: {
          source: 'gross_minus_refund_and_ai_companion_cost',
          amountField: 'authorSharePreviewLumina',
          payoutEligible: false,
        },
      },
      separationPolicy: {
        grossAndRefundSameField: false,
        refundAdjustmentCanIncreaseAuthorShare: false,
        aiCompanionCostIncludedInAuthorShare: false,
        payoutMutationFromRead: false,
        clientSubmittedRevenueTrusted: false,
        clientSubmittedRefundTrusted: false,
        clientSubmittedShareTrusted: false,
      },
      privacy: {
        rawBuyerUserIdReturned: false,
        rawPaymentLedgerIdReturned: false,
        rawWalletLedgerIdReturned: false,
        rawRefundReasonReturned: false,
        privateAuthorNotesReturned: false,
        adminMemoReturned: false,
      },
    });
    expect(
      Object.values(readModel.mutationPolicy).every(
        (enabled) => enabled === false,
      ),
    ).toBe(true);
    expect(readModel.projectionFields).toEqual(
      expect.arrayContaining([
        'grossLumina',
        'refundAdjustedLumina',
        'aiCompanionCostLumina',
        'authorSharePreviewLumina',
        'payoutEligible',
      ]),
    );
  });
});

describe('Story stage pack chapter session contract skeleton', () => {
  it('publishes StoryPack StoryChapter StorySession and StoryChoice skeletons without enabling mutations', () => {
    expect(STORY_STAGE_PACK_CHAPTER_SESSION_CONTRACT).toMatchObject({
      version: '2026-06-18.story-stage-pack-chapter-session-skeleton.v1',
      status: 'backend_contract_skeleton_only',
      scope: {
        surfaces: [
          'story_pack',
          'story_chapter',
          'story_session',
          'story_choice',
        ],
        implementationReady: false,
        readModelOnly: true,
        publicMutationEnabled: false,
      },
      apiContracts: {
        storyPackList: {
          method: 'GET',
          path: '/api/v1/story-packs',
          enabled: false,
          authRequired: false,
        },
        storySessionCreate: {
          method: 'POST',
          path: '/api/v1/story-packs/:packSlug/sessions',
          enabled: false,
          authRequired: true,
          idempotencyRequired: true,
        },
        storyChoiceList: {
          method: 'GET',
          path: '/api/v1/story-sessions/:sessionId/choices',
          enabled: false,
          authRequired: true,
        },
      },
      storyPack: {
        pricingModes: ['free', 'paid', 'mixed'],
        lifecycleStatuses: [
          'draft',
          'serializing',
          'completed',
          'hiatus',
          'season_ended',
          'archived',
        ],
        publicListStatuses: [
          'serializing',
          'completed',
          'hiatus',
          'season_ended',
        ],
        privateFieldsReturned: false,
      },
      storyChapter: {
        pricingModes: ['free', 'paid'],
        lifecycleStatuses: [
          'draft',
          'scheduled',
          'published',
          'paused',
          'season_finale',
          'archived',
        ],
        publicReadableStatuses: ['published', 'paused', 'season_finale'],
        paidAccessPolicy: {
          freeChapterReadableWithoutPurchase: true,
          paidChapterRequiresEntitlement: true,
          lockedBodyReturned: false,
        },
      },
      storySession: {
        lifecycleStatuses: [
          'active',
          'paused',
          'completed',
          'abandoned',
          'expired',
        ],
        source: 'server_created_story_session_after_entitlement_check',
        replaySameRequest: true,
        conflictOnChangedFingerprint: true,
        aiProviderCallOnCreate: false,
        walletMutationOnCreate: false,
        imageVideoGenerationOnCreate: false,
      },
      storyChoice: {
        defaultCount: 3,
        maxCount: 5,
        choiceTypes: ['dialogue', 'action', 'investigate', 'travel', 'wait'],
        rawModelPromptReturned: false,
        providerPayloadReturned: false,
      },
    });
    expect(
      STORY_STAGE_PACK_CHAPTER_SESSION_CONTRACT.validationOrder,
    ).toEqual([
      'auth_optional_for_public_pack_reads',
      'validate_pack_slug',
      'load_public_story_pack',
      'validate_chapter_identifier_when_present',
      'load_public_or_entitled_chapter_projection',
      'require_auth_for_session_or_choice_reads',
      'check_paid_chapter_entitlement_before_body_projection',
      'validate_idempotency_key_for_session_create',
      'return_contract_projection_without_mutation',
    ]);
    expect(
      Object.values(
        STORY_STAGE_PACK_CHAPTER_SESSION_CONTRACT.noMutationPolicy,
      ).every((enabled) => enabled === false),
    ).toBe(true);
  });

  it('keeps paid chapter body locked until entitlement and hides private backend material', () => {
    const storyChapter = STORY_STAGE_PACK_CHAPTER_SESSION_CONTRACT.storyChapter;

    expect(
      storyChapter.paidAccessPolicy,
    ).toMatchObject({
      previewFieldsForLockedPaidChapter: [
        'id',
        'chapterNo',
        'title',
        'summary',
        'pricingMode',
        'priceLumina',
        'locked',
      ],
      lockedBodyReturned: false,
    });
    expect(storyChapter.paidEntitlementServerGuard).toMatchObject({
      version: '2026-06-24.story-paid-chapter-entitlement-server-guard.v1',
      status: 'read_model_contract_only',
      readOnly: true,
      sourceOfTruth: {
        chapterEntitlement: 'user_entitlements.story_chapter_access',
        seasonEntitlement: 'user_entitlements.story_season_access',
        purchaseLedger: 'story_purchase_ledger.granted',
      },
      entitlementScopes: {
        chapterSingle: {
          entitlementType: 'story_chapter_access',
          grantsBodyAccessTo: 'exact_chapter_only',
        },
        seasonBundle: {
          entitlementType: 'story_season_access',
          grantsBodyAccessTo: 'published_chapters_in_season',
        },
      },
      clientTrustPolicy: {
        clientSubmittedPurchasedTrusted: false,
        clientSubmittedEntitlementTrusted: false,
        clientSubmittedWalletBalanceTrusted: false,
        clientSubmittedPriceTrusted: false,
      },
      responsePolicy: {
        lockedBodyReturned: false,
        entitlementIdReturnedToReader: false,
        purchaseLedgerIdReturned: false,
        walletLedgerIdReturned: false,
        stableMessageKeyRequired: true,
        lockedMessageKey: 'storyStage.chapter.locked',
      },
    });
    expect(storyChapter.paidEntitlementServerGuard.serverDecisionOrder).toEqual([
      'load_chapter_by_pack_slug_and_chapter_no',
      'return_body_when_chapter_is_free',
      'require_authenticated_reader_for_paid_chapter_body',
      'load_user_chapter_entitlement',
      'load_user_season_entitlement_for_chapter',
      'verify_purchase_ledger_status_granted',
      'return_locked_preview_when_entitlement_missing',
    ]);
    expect(
      Object.values(
        storyChapter.paidEntitlementServerGuard.mutationPolicy,
      ).every((enabled) => enabled === false),
    ).toBe(true);
    expect(STORY_STAGE_PACK_CHAPTER_SESSION_CONTRACT.privacy).toMatchObject({
      rawUserEmailReturned: false,
      rawPaymentLedgerIdReturned: false,
      providerPromptReturned: false,
      providerResponseReturned: false,
      adminMemoReturned: false,
      internalModerationNoteReturned: false,
    });
  });
});

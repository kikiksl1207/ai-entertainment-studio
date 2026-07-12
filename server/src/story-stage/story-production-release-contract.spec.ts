import { STORY_PRODUCTION_RELEASE_CONTRACT } from './story-production-release-contract';

describe('Story production release contract', () => {
  it('keeps price inputs replaceable and separates owned-story replay from new AI routes', () => {
    const contract = STORY_PRODUCTION_RELEASE_CONTRACT;

    expect(contract.initialPricePolicy).toMatchObject({
      priceAuthority: 'server_story_product_policy',
      rateCardInputs: {
        authorAndRightsCostPerSale: null,
        includedNewAiRouteCount: null,
        averageAiRouteCost: null,
      },
      calculator: {
        modelRateCardReplaceable: true,
        priceMustBeApprovedBeforeSale: true,
        clientSubmittedPriceTrusted: false,
      },
      productBoundary: {
        workEntitlementProduct: 'story_scope_access',
        newAiRouteCreditProduct: 'story_new_ai_route_credit',
        workRepurchaseRequiredForOwnedScope: false,
      },
    });
  });

  it('limits public discovery to published releases and pins sessions to immutable versions', () => {
    const contract = STORY_PRODUCTION_RELEASE_CONTRACT;

    expect(contract.publicationLifecycle.publicRoutePolicy).toMatchObject({
      catalogSearchRecommendationStates: ['published'],
      draftOrReviewVisibleToPublic: false,
      releaseReadyVisibleToPublic: false,
    });
    expect(contract.immutableReleaseVersion).toMatchObject({
      activationPolicy: {
        currentPublishedReleaseStaysActiveOnCandidateFailure: true,
        activeReleaseSwitchIsAtomic: true,
        rollbackEditsPublishedReleaseInPlace: false,
      },
      readerSessionPolicy: {
        sessionPinsReleaseVersionAtStart: true,
        activeSessionSwitchesGraphMidPlay: false,
      },
    });
  });

  it('keeps replay progress separate from entitlement and usage charges tied to provenance', () => {
    const contract = STORY_PRODUCTION_RELEASE_CONTRACT;

    expect(contract.replayAndEndingGallery).toMatchObject({
      saveSlots: {
        minimumPerReaderAndStoryScope: 3,
        overwriteRequiresExplicitConfirmation: true,
      },
      endingGallery: {
        existingGeneratedRouteReplayIsFree: true,
        generatedRouteProvenanceRequired: true,
      },
      entitlementBoundary: {
        progressDeletionRevokesEntitlement: false,
        newAiRouteCreditSeparateFromStoryEntitlement: true,
      },
    });
    expect(contract.aiUsageLedger.chargePolicy).toMatchObject({
      existingGeneratedRouteRead: 'no_charge',
      authorWrittenEndingRead: 'no_charge',
      authorWrittenEndingCreation: 'not_ai_usage',
      retryWithoutCompletion: 'no_duplicate_charge',
    });
  });

  it('uses bounded writer context and keeps every side effect disabled', () => {
    const contract = STORY_PRODUCTION_RELEASE_CONTRACT;

    expect(contract.writerPasteAnalysisMemory).toMatchObject({
      immutableInputs: {
        manuscriptVersionRequired: true,
        aiMayRewriteSourceManuscript: false,
        writerApprovalStoredSeparatelyFromAiSuggestion: true,
      },
      analysisCadence: {
        fullManuscriptResendForEveryPart: false,
      },
      mobileReviewPolicy: {
        mobile390And400ReviewDialog: 'full_screen_single_dialog',
        nestedDialogAllowed: false,
      },
    });
    expect(Object.values(contract.mutationPolicy).every((value) => value === false)).toBe(true);
    expect(Object.values(contract.privacy).every((value) => value === false)).toBe(true);
  });
});

import {
  AI_PREMIUM_CONTENT_BRIEF_API_SKELETON,
  AI_PREMIUM_CONTENT_MODERATION_STATUSES,
  AI_PREMIUM_CONTENT_OUTPUT_CLASSES,
  AI_PREMIUM_CONTENT_PRECHECK_FAILURE_POLICY,
  AI_PREMIUM_CONTENT_REQUEST_QUEUE_SKELETON,
  AI_PREMIUM_CONTENT_REQUEST_STATUSES,
  AI_PREMIUM_CONTENT_REQUEST_TYPE_POLICY,
  AI_PREMIUM_CONTENT_REQUEST_TYPES,
  AI_PREMIUM_CONTENT_SAFETY_PRECHECK_CONTRACT,
  AI_PREMIUM_CONTENT_SAFETY_PRECHECK_RISK_CATEGORIES,
  AI_PREMIUM_CONTENT_SAFETY_PRECHECK_STATUSES,
  AI_PREMIUM_CONTENT_SAFETY_STATUSES,
  AI_PREMIUM_CONTENT_STATE_API_CONTRACT,
  AI_PREMIUM_CONTENT_STATUS_COPY_KO,
  resolveAiPremiumContentCostPrecheck,
  resolveAiPremiumContentSafetyPrecheck,
} from './ai-premium-content-state-contract';

describe('AI_PREMIUM_CONTENT_STATE_API_CONTRACT', () => {
  it('defines a disabled image/video common request state API skeleton', () => {
    const contract = AI_PREMIUM_CONTENT_STATE_API_CONTRACT;

    expect(contract).toMatchObject({
      version: '2026-06-02.ai-premium-content-request-state-api-skeleton.v1',
      status: 'skeleton_ready_mutation_blocked',
      readOnly: true,
      providerCallEnabled: false,
      walletMutationEnabled: false,
      orderMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      paidLikeMutationEnabled: false,
      publicPublishMutationEnabled: false,
    });
    expect(contract.requestTypes).toEqual([
      'image_single',
      'image_variation',
      'image_reference',
      'video_clip',
      'video_loop',
      'premium_pack',
    ]);
    expect(contract.outputClasses).toEqual(['image', 'video', 'mixed']);
    expect(contract.statuses).toEqual([
      'draft',
      'submitted',
      'safety_blocked',
      'needs_more_info',
      'queued',
      'generating',
      'provider_failed',
      'awaiting_review',
      'approved',
      'rejected',
      'archived',
    ]);
    expect(contract.moderationStatuses).toEqual([
      'pending',
      'cleared',
      'blocked',
      'needs_review',
    ]);
    expect(contract.briefApiSkeleton).toBe(AI_PREMIUM_CONTENT_BRIEF_API_SKELETON);
    expect(contract.requestQueueSkeleton).toBe(
      AI_PREMIUM_CONTENT_REQUEST_QUEUE_SKELETON,
    );
  });

  it('keeps current image/video queues unchanged while future storage is blocked', () => {
    const contract = AI_PREMIUM_CONTENT_STATE_API_CONTRACT;

    expect(contract.sourceQueues).toMatchObject({
      currentImageQueue: {
        table: 'creator_image_requests',
        mode: 'legacy_image_queue_bridge_candidate',
        liveMutationChangedByThisContract: false,
      },
      currentPremiumVideoCatalog: {
        table: 'premium_video_products',
        mode: 'unlock_catalog_only_not_generation_queue',
        liveMutationChangedByThisContract: false,
      },
      futureUnifiedQueue: {
        table: 'ai_premium_content_requests',
        migrationRequired: true,
        storageEnabled: false,
      },
    });
  });

  it('keeps all planned state endpoints and mutations disabled', () => {
    const { apiContracts, mutationGates } = AI_PREMIUM_CONTENT_STATE_API_CONTRACT;

    expect(apiContracts.myRequestList).toMatchObject({
      method: 'GET',
      path: '/api/v1/me/ai-premium-content/requests',
      enabled: false,
      authRequired: true,
      ownerOnly: true,
      mutation: false,
    });
    expect(apiContracts.myRequestDetail).toMatchObject({
      method: 'GET',
      path: '/api/v1/ai-premium-content/requests/:requestId',
      enabled: false,
      authRequired: true,
      ownerOrArtistOperatorOnly: true,
      mutation: false,
    });
    expect(apiContracts.adminRequestList).toMatchObject({
      method: 'GET',
      path: '/admin/api/v1/ai-premium-content/requests',
      enabled: false,
      adminRequired: true,
      requiredPermission: 'assets:read',
      mutation: false,
    });
    expect(apiContracts.adminRequestDetail).toMatchObject({
      method: 'GET',
      path: '/admin/api/v1/ai-premium-content/requests/:requestId',
      enabled: false,
      adminRequired: true,
      requiredPermission: 'assets:read',
      mutation: false,
    });
    expect(apiContracts.createRequest).toMatchObject({
      method: 'POST',
      enabled: false,
      submitEnabled: false,
      idempotencyRequired: true,
      mutation: false,
    });
    expect(apiContracts.costPrecheck).toMatchObject({
      method: 'POST',
      path: '/api/v1/ai-premium-content/requests/precheck',
      enabled: false,
      submitEnabled: false,
      mutation: false,
      providerCallEnabled: false,
    });
    expect(apiContracts.safetyPrecheck).toBe(
      AI_PREMIUM_CONTENT_SAFETY_PRECHECK_CONTRACT,
    );
    expect(apiContracts.regenerateRequest).toMatchObject({
      method: 'POST',
      enabled: false,
      submitEnabled: false,
      idempotencyRequired: true,
      mutation: false,
    });
    expect(apiContracts.adminUpdateRequest).toMatchObject({
      method: 'PATCH',
      enabled: false,
      mutation: false,
      idempotencyRequiredForReviewDecisions: true,
    });
    expect(Object.values(mutationGates).every((enabled) => enabled === false)).toBe(
      true,
    );
  });

  it('defines provider-free safety precheck statuses and risk categories before generation', () => {
    const { apiContracts } = AI_PREMIUM_CONTENT_STATE_API_CONTRACT;
    const contract = apiContracts.safetyPrecheck;

    expect(contract).toMatchObject({
      version: '2026-06-08.ai-premium-content-safety-precheck.v1',
      enabled: false,
      submitEnabled: false,
      mutation: false,
      providerCallEnabled: false,
      allowedStatuses: ['safe', 'review_required', 'blocked'],
      riskCategories: [
        'minor',
        'real_person_similarity',
        'sexual_content',
        'copyright',
        'platform_policy',
      ],
      noMutation: {
        providerAttempt: true,
        imageGeneration: true,
        videoGeneration: true,
        walletDebit: true,
        settlementAccrual: true,
        payoutAccrual: true,
        paidLike: true,
      },
    });
    expect(AI_PREMIUM_CONTENT_SAFETY_PRECHECK_STATUSES).toEqual([
      'safe',
      'review_required',
      'blocked',
    ]);
    expect(AI_PREMIUM_CONTENT_SAFETY_PRECHECK_RISK_CATEGORIES).toEqual([
      'minor',
      'real_person_similarity',
      'sexual_content',
      'copyright',
      'platform_policy',
    ]);
    expect(contract.privacy).toMatchObject({
      rawPromptReturned: false,
      referenceAssetBytesReturned: false,
      providerPayloadReturned: false,
      realPersonIdentityGuessReturned: false,
      tokenReturned: false,
      cookieReturned: false,
    });
  });

  it('resolves safe, review-required, and blocked safety precheck decisions before provider calls', () => {
    const safe = resolveAiPremiumContentSafetyPrecheck({});
    const reviewRequired = resolveAiPremiumContentSafetyPrecheck({
      realPersonSimilarityRisk: true,
      copyrightRisk: true,
    });
    const blocked = resolveAiPremiumContentSafetyPrecheck({
      minorRisk: true,
      sexualContentRisk: true,
      platformPolicyRisk: true,
    });

    expect(safe).toMatchObject({
      status: 'safe',
      code: 'AI_PREMIUM_CONTENT_SAFETY_SAFE',
      messageKey: 'aiPremiumContent.safetyPrecheck.safe',
      risks: [],
      providerCallEnabled: false,
      providerCallBeforeDecision: false,
      walletMutationEnabled: false,
    });
    expect(reviewRequired).toMatchObject({
      status: 'review_required',
      code: 'AI_PREMIUM_CONTENT_SAFETY_REVIEW_REQUIRED',
      messageKey: 'aiPremiumContent.safetyPrecheck.reviewRequired',
      providerCallEnabled: false,
      walletMutationEnabled: false,
      risks: expect.arrayContaining([
        expect.objectContaining({
          category: 'real_person_similarity',
          severity: 'review_required',
          providerCallBeforeDecision: false,
        }),
        expect.objectContaining({
          category: 'copyright',
          severity: 'review_required',
          providerCallBeforeDecision: false,
        }),
      ]),
    });
    expect(blocked).toMatchObject({
      status: 'blocked',
      code: 'AI_PREMIUM_CONTENT_SAFETY_BLOCKED',
      messageKey: 'aiPremiumContent.safetyPrecheck.blocked',
      providerCallEnabled: false,
      walletMutationEnabled: false,
      orderMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      paidLikeMutationEnabled: false,
      risks: expect.arrayContaining([
        expect.objectContaining({ category: 'minor', severity: 'blocked' }),
        expect.objectContaining({
          category: 'sexual_content',
          severity: 'blocked',
        }),
        expect.objectContaining({
          category: 'platform_policy',
          severity: 'blocked',
        }),
      ]),
    });
  });

  it('defines a disabled cost precheck contract without provider secrets or cash mutation', () => {
    const { apiContracts, mutationGates } = AI_PREMIUM_CONTENT_STATE_API_CONTRACT;
    const contractText = JSON.stringify(apiContracts.costPrecheck);

    expect(apiContracts.costPrecheck.response).toMatchObject({
      code: '<stable precheck code>',
      messageKey: '<stable localized message key>',
      allowed: '<boolean>',
      failurePolicy: AI_PREMIUM_CONTENT_PRECHECK_FAILURE_POLICY,
    });
    expect(apiContracts.costPrecheck.response.modelRoutingCandidates[0]).toEqual({
      providerRouteAlias: '<server provider route alias>',
      capability: '<server capability alias>',
      aliasType: 'server_capability_alias',
      providerKeyReturned: false,
      modelKeyReturned: false,
    });
    expect(apiContracts.costPrecheck.response.estimatedCost).toMatchObject({
      currency: 'KRW_MICROS',
      estimateSource: 'server_policy_estimate_not_provider_quote',
    });
    expect(Object.values(mutationGates).every((enabled) => enabled === false)).toBe(
      true,
    );
    expect(contractText).not.toMatch(/apiKey|secret|token|password|credential/i);
  });

  it('keeps Korean fallback copy separate from raw state enums', () => {
    const contract = AI_PREMIUM_CONTENT_STATE_API_CONTRACT;

    expect(Object.keys(AI_PREMIUM_CONTENT_STATUS_COPY_KO)).toEqual(
      AI_PREMIUM_CONTENT_REQUEST_STATUSES,
    );
    expect(contract.statusCopy).toMatchObject({
      locale: 'ko-KR',
      rawEnumAsCopy: false,
      rawProviderStatusAsCopy: false,
      neutralFallbackCopy: '상태를 확인 중이에요',
    });
    expect(AI_PREMIUM_CONTENT_STATUS_COPY_KO.provider_failed).toBe(
      '생성에 실패했어요',
    );
    expect(contract.projection.requestItem.status.rawEnumAsCopy).toBe(false);
    expect(contract.projection.requestItem.moderationStatus.rawEnumAsCopy).toBe(
      false,
    );
  });

  it('maps request type policy across image, video, and mixed outputs', () => {
    expect(AI_PREMIUM_CONTENT_REQUEST_TYPES).toEqual(
      AI_PREMIUM_CONTENT_STATE_API_CONTRACT.requestTypes,
    );
    expect(AI_PREMIUM_CONTENT_OUTPUT_CLASSES).toEqual(
      AI_PREMIUM_CONTENT_STATE_API_CONTRACT.outputClasses,
    );
    expect(AI_PREMIUM_CONTENT_MODERATION_STATUSES).toEqual(
      AI_PREMIUM_CONTENT_STATE_API_CONTRACT.moderationStatuses,
    );
    expect(AI_PREMIUM_CONTENT_REQUEST_TYPE_POLICY.image_single).toMatchObject({
      outputClass: 'image',
      providerRouteAlias: 'ai_premium_content.image.text_to_image',
      defaultCapability: 'text_to_image',
      humanReviewRequired: true,
    });
    expect(AI_PREMIUM_CONTENT_REQUEST_TYPE_POLICY.video_clip).toMatchObject({
      outputClass: 'video',
      providerRouteAlias: 'ai_premium_content.video.text_to_video',
      defaultCapability: 'text_to_video',
      humanReviewRequired: true,
    });
    expect(AI_PREMIUM_CONTENT_REQUEST_TYPE_POLICY.premium_pack).toMatchObject({
      outputClass: 'mixed',
      providerRouteAlias: 'ai_premium_content.mixed.generation_pack',
      defaultCapability: 'mixed_generation_pack',
      humanReviewRequired: true,
    });
    expect(
      Object.values(AI_PREMIUM_CONTENT_REQUEST_TYPE_POLICY).every(
        (policy) =>
          policy.providerRouteAlias.startsWith('ai_premium_content.') &&
          !/openai|seedance|stable_diffusion|model|vendor/i.test(
            policy.providerRouteAlias,
          ),
      ),
    ).toBe(true);
  });

  it('defines the disabled brief submit skeleton with request type, artist slug, safety, and estimated cost tracking', () => {
    const skeleton = AI_PREMIUM_CONTENT_BRIEF_API_SKELETON;

    expect(skeleton).toMatchObject({
      version: '2026-06-05.ai-premium-content-brief-api-skeleton.v1',
      method: 'POST',
      path: '/api/v1/ai-premium-content/requests',
      enabled: false,
      submitEnabled: false,
      mutation: false,
      authRequired: true,
      artistOperatorRequired: true,
      providerCallEnabled: false,
      walletDebitEnabled: false,
      settlementAccrualEnabled: false,
      publicPublishEnabled: false,
    });
    expect(skeleton.trackedFields.requestType).toEqual(
      AI_PREMIUM_CONTENT_REQUEST_TYPES,
    );
    expect(skeleton.trackedFields.artistSlug).toMatchObject({
      required: true,
      serverResolvedArtistId: true,
    });
    expect(skeleton.trackedFields.safetyStatus).toMatchObject({
      allowed: AI_PREMIUM_CONTENT_SAFETY_STATUSES,
      initial: 'pending',
      serverOwned: true,
      clientSubmittedTrusted: false,
    });
    expect(skeleton.trackedFields.estimatedCost).toMatchObject({
      tracked: true,
      amountTrustedFromClient: false,
      walletDebitOnSubmit: false,
      finalCostComputedLater: true,
    });
    expect(skeleton.responseProjection.policy).toMatchObject({
      canSubmit: false,
      canGenerate: false,
      canDebitWallet: false,
      canPublish: false,
    });
    expect(Object.values(skeleton.forbiddenSideEffects).every((enabled) => enabled === false)).toBe(
      true,
    );
  });

  it('defines a provider-neutral request queue skeleton without opening generation or paid mutations', () => {
    const skeleton = AI_PREMIUM_CONTENT_REQUEST_QUEUE_SKELETON;
    const serialized = JSON.stringify(skeleton);

    expect(skeleton).toMatchObject({
      version: '2026-06-08.ai-premium-content-request-queue-skeleton.v1',
      feature: 'ai_premium_content_request_queue',
      status: 'skeleton_ready_mutation_blocked',
      enabled: false,
      storageEnabled: false,
      providerCallEnabled: false,
      queueMutationEnabled: false,
      walletMutationEnabled: false,
      orderMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      paidLikeMutationEnabled: false,
    });
    expect(skeleton.currentBridge).toMatchObject({
      imageQueue: 'creator_image_requests',
      videoSource: 'premium_video_products_unlock_catalog_only',
      futureUnifiedTable: 'ai_premium_content_requests',
      currentLiveMutationChangedByThisContract: false,
    });
    expect(skeleton.normalizedFields).toMatchObject({
      requestType: {
        allowed: AI_PREMIUM_CONTENT_REQUEST_TYPES,
        providerSpecificTypeTrusted: false,
      },
      artistSlug: {
        required: true,
        serverResolvedArtistId: true,
      },
      safetyStatus: {
        allowed: AI_PREMIUM_CONTENT_SAFETY_STATUSES,
        serverOwned: true,
        initial: 'pending',
        clientSubmittedTrusted: false,
      },
      estimatedCost: {
        currency: 'KRW_MICROS',
        source: 'server_policy_estimate_not_provider_quote',
        amountTrustedFromClient: false,
        walletDebitOnQueue: false,
      },
      providerRouteAlias: {
        source: 'server_capability_alias',
        prefix: 'ai_premium_content.',
        vendorProviderKeyReturned: false,
        vendorModelKeyReturned: false,
      },
    });
    expect(skeleton.queueItemProjection).toMatchObject({
      requestType:
        '<image_single|image_variation|image_reference|video_clip|video_loop|premium_pack>',
      artistSlug: '<artist slug>',
      artistId: '<server resolved artist id>',
      safetyStatus: 'pending',
      providerRouteAlias: '<server provider route alias>',
      providerCallEnabled: false,
    });
    expect(Object.values(skeleton.forbiddenSideEffects).every((enabled) => enabled === false)).toBe(
      true,
    );
    expect(serialized).not.toMatch(/gpt image|stable diffusion|seedance/i);
    expect(skeleton.sensitiveDataPolicy).toMatchObject({
      sensitiveAuthMaterialReturned: false,
      databaseConnectionMaterialReturned: false,
    });
  });

  it('resolves image and video precheck from server policy aliases only', () => {
    const imagePrecheck = resolveAiPremiumContentCostPrecheck({
      requestType: 'image_single',
      artistSlug: 'aria',
      userEntitled: true,
      regenerationCount: 1,
      failureCount: 0,
    });
    const videoPrecheck = resolveAiPremiumContentCostPrecheck({
      requestType: 'video_clip',
      artistSlug: 'aria',
      userEntitled: true,
    });

    expect(imagePrecheck).toMatchObject({
      allowed: true,
      precheckOnly: true,
      code: 'AI_PREMIUM_CONTENT_PRECHECK_READY',
      messageKey: 'aiPremiumContent.precheck.ready',
      requestType: 'image_single',
      artistSlug: 'aria',
      outputClass: 'image',
      providerCallEnabled: false,
      walletMutationEnabled: false,
      orderMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      paidLikeMutationEnabled: false,
    });
    expect(imagePrecheck.modelRoutingCandidates).toEqual([
      {
        providerRouteAlias: 'ai_premium_content.image.text_to_image',
        capability: 'text_to_image',
        aliasType: 'server_capability_alias',
        providerKeyReturned: false,
        modelKeyReturned: false,
      },
    ]);
    expect(imagePrecheck.estimatedCost).toMatchObject({
      currency: 'KRW_MICROS',
      estimateSource: 'server_policy_estimate_not_provider_quote',
    });
    expect(videoPrecheck).toMatchObject({
      allowed: true,
      requestType: 'video_clip',
      outputClass: 'video',
      modelRoutingCandidates: [
        {
          providerRouteAlias: 'ai_premium_content.video.text_to_video',
          capability: 'text_to_video',
        },
      ],
    });
  });

  it('returns stable precheck denial codes before provider or wallet work', () => {
    expect(
      resolveAiPremiumContentCostPrecheck({
        requestType: 'unknown',
        artistSlug: 'aria',
        userEntitled: true,
      }),
    ).toMatchObject({
      allowed: false,
      code: 'AI_PREMIUM_CONTENT_REQUEST_TYPE_INVALID',
      messageKey: 'aiPremiumContent.precheck.invalidRequestType',
      httpStatus: 400,
      providerCallEnabled: false,
      walletMutationEnabled: false,
    });
    expect(
      resolveAiPremiumContentCostPrecheck({
        requestType: 'image_single',
        artistSlug: 'aria',
        userEntitled: false,
      }),
    ).toMatchObject({
      allowed: false,
      code: 'AI_PREMIUM_CONTENT_ENTITLEMENT_REQUIRED',
      messageKey: 'aiPremiumContent.precheck.entitlementRequired',
      httpStatus: 403,
      providerCallEnabled: false,
      walletMutationEnabled: false,
    });
    expect(
      resolveAiPremiumContentCostPrecheck({
        requestType: 'image_single',
        artistSlug: 'aria',
        userEntitled: true,
        regenerationCount:
          AI_PREMIUM_CONTENT_PRECHECK_FAILURE_POLICY.maxRegenerationCount,
      }),
    ).toMatchObject({
      allowed: false,
      code: 'AI_PREMIUM_CONTENT_REGENERATION_LIMIT_REACHED',
      messageKey: 'aiPremiumContent.precheck.regenerationLimitReached',
      httpStatus: 409,
      providerCallEnabled: false,
      walletMutationEnabled: false,
    });
  });

  it('keeps state projection private and server-authoritative', () => {
    const contract = AI_PREMIUM_CONTENT_STATE_API_CONTRACT;

    expect(contract.validationOrder).toEqual([
      'auth_required',
      'request_id_valid',
      'request_exists',
      'owner_or_artist_operator_access',
      'status_filter_valid',
      'safe_projection_only',
    ]);
    expect(contract.serverAuthority).toMatchObject({
      clientSubmittedStatusTrusted: false,
      clientSubmittedModerationStatusTrusted: false,
      clientSubmittedProviderStatusTrusted: false,
      clientSubmittedCostTrusted: false,
      clientSubmittedResultAssetUrlsTrusted: false,
      serverBuildsContextSnapshot: true,
      serverOwnsSafetyGate: true,
    });
    expect(contract.privacy).toMatchObject({
      rawProviderPayloadReturned: false,
      rawPromptReturned: false,
      rawPrivateReferenceMaterialReturned: false,
      signedUrlsReturned: false,
      sensitiveAuthMaterialReturned: false,
      privateConnectionMaterialReturned: false,
      rawEmailReturned: false,
    });
  });

  it('separates owner and admin request projections without exposing raw or internal fields', () => {
    const { surfaces } = AI_PREMIUM_CONTENT_STATE_API_CONTRACT.projection;

    expect(surfaces.owner).toMatchObject({
      audience: 'request_owner_or_artist_operator',
      statusCopyRequired: true,
      rawEnumAsCopy: false,
      modelKeyReturned: false,
      rawPromptReturned: false,
      providerPayloadReturned: false,
      adminModerationNoteReturned: false,
      internalCostReturned: false,
      internalReviewFieldsReturned: false,
    });
    expect(surfaces.owner.listFields).toEqual(
      expect.arrayContaining([
        'id',
        'requestType',
        'artist',
        'status',
        'moderationStatus',
        'resultAvailability',
        'retryAvailability',
        'publishAvailability',
        'timestamps',
      ]),
    );
    expect(surfaces.owner.detailAdditionalFields).toEqual(
      expect.arrayContaining([
        'briefSummary',
        'referenceAssetPreview',
        'userFacingSafetySummary',
      ]),
    );
    expect(surfaces.admin).toMatchObject({
      audience: 'admin_assets_read_operator',
      statusCopyRequired: true,
      rawEnumAsCopy: false,
      modelRouteAliasReturned: true,
      modelKeyReturned: false,
      rawPromptReturned: false,
      providerPayloadReturned: false,
      rawModerationNoteReturned: false,
      internalCostReturned: false,
      ownerPrivateContactReturned: false,
    });
    expect(surfaces.admin.detailAdditionalFields).toEqual(
      expect.arrayContaining([
        'safetyGateSummary',
        'moderationReasonKey',
        'costPolicySummary',
        'generationAttemptSummary',
      ]),
    );
    expect(surfaces.forbiddenEverywhere).toEqual(
      expect.arrayContaining([
        'modelKey',
        'rawPrompt',
        'providerPayload',
        'rawModerationNote',
        'internalCostBreakdown',
        'walletLedgerId',
        'settlementId',
        'payoutId',
      ]),
    );
  });
});

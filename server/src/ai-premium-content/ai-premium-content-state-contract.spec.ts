import {
  AI_PREMIUM_CONTENT_BRIEF_API_SKELETON,
  AI_PREMIUM_CONTENT_CREATE_STATUS_API_SKELETON,
  AI_PREMIUM_CONTENT_CREATE_STATUS_API_STATUSES,
  AI_PREMIUM_CONTENT_COST_RETRY_READ_MODEL_SKELETON,
  AI_PREMIUM_CONTENT_COST_WALLET_PRECHECK_POLICY,
  AI_PREMIUM_CONTENT_MODERATION_STATUSES,
  AI_PREMIUM_CONTENT_MODEL_ROUTING_API_SKELETON,
  AI_PREMIUM_CONTENT_OUTPUT_CLASSES,
  AI_PREMIUM_CONTENT_PRECHECK_FAILURE_POLICY,
  AI_PREMIUM_CONTENT_PROVIDER_ADAPTER_KEYS,
  AI_PREMIUM_CONTENT_PROVIDER_GUARD_CONTRACT,
  AI_PREMIUM_CONTENT_REQUEST_QUEUE_SKELETON,
  AI_PREMIUM_CONTENT_REQUEST_STATUSES,
  AI_PREMIUM_CONTENT_REQUEST_TYPE_POLICY,
  AI_PREMIUM_CONTENT_REQUEST_TYPES,
  AI_PREMIUM_CONTENT_RESULT_ASSET_REUSE_AUDIT_PROJECTION,
  AI_PREMIUM_CONTENT_RESULT_STATUSES,
  AI_PREMIUM_CONTENT_ROUTING_STATUSES,
  AI_PREMIUM_CONTENT_SAFETY_PRECHECK_CONTRACT,
  AI_PREMIUM_CONTENT_SAFETY_PRECHECK_RISK_CATEGORIES,
  AI_PREMIUM_CONTENT_SAFETY_PRECHECK_STATUSES,
  AI_PREMIUM_CONTENT_SAFETY_STATUSES,
  AI_PREMIUM_CONTENT_STATE_API_CONTRACT,
  AI_PREMIUM_CONTENT_STATUS_PREVIEW_FIXTURE_CONTRACT,
  AI_PREMIUM_CONTENT_STATUS_COPY_KO,
  CHARACTER_CHAT_AI_PREMIUM_CONTENT_HANDOFF_CONTRACT,
  resolveAiPremiumContentCostPrecheck,
  resolveAiPremiumContentProviderGuard,
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
    expect(contract.characterChatHandoff).toBe(
      CHARACTER_CHAT_AI_PREMIUM_CONTENT_HANDOFF_CONTRACT,
    );
    expect(contract.requestQueueSkeleton).toBe(
      AI_PREMIUM_CONTENT_REQUEST_QUEUE_SKELETON,
    );
    expect(contract.costRetryReadModel).toBe(
      AI_PREMIUM_CONTENT_COST_RETRY_READ_MODEL_SKELETON,
    );
    expect(contract.modelRoutingApiSkeleton).toBe(
      AI_PREMIUM_CONTENT_MODEL_ROUTING_API_SKELETON,
    );
    expect(contract.createStatusApiSkeleton).toBe(
      AI_PREMIUM_CONTENT_CREATE_STATUS_API_SKELETON,
    );
    expect(contract.statusPreviewFixture).toBe(
      AI_PREMIUM_CONTENT_STATUS_PREVIEW_FIXTURE_CONTRACT,
    );
    expect(contract.resultAssetReuseAuditProjection).toBe(
      AI_PREMIUM_CONTENT_RESULT_ASSET_REUSE_AUDIT_PROJECTION,
    );
  });

  it('defines a disabled common image video model routing API skeleton', () => {
    expect(AI_PREMIUM_CONTENT_MODEL_ROUTING_API_SKELETON).toMatchObject({
      version: '2026-06-18.ai-premium-content-model-routing-api-skeleton.v1',
      method: 'POST',
      path: '/api/v1/ai-premium-content/requests/model-routing',
      status: 'skeleton_ready_mutation_blocked',
      enabled: false,
      authRequired: true,
      artistOperatorRequired: true,
      providerCallEnabled: false,
      queueMutationEnabled: false,
      walletMutationEnabled: false,
      request: {
        requestType: [
          'image_single',
          'image_variation',
          'image_reference',
          'video_clip',
          'video_loop',
          'premium_pack',
        ],
        artistContext: {
          artistSlugRequired: true,
          serverResolvedArtistId: true,
          clientSubmittedArtistIdTrusted: false,
          personaContextSource: 'approved_artist_profile_projection',
        },
        safetyState: {
          allowed: ['pending', 'needs_review', 'blocked', 'cleared'],
          source: 'server_safety_precheck_projection',
          clientSubmittedSafetyTrusted: false,
        },
        costPolicy: {
          source: 'server_route_cost_policy',
          clientSubmittedCostTrusted: false,
          providerQuoteTrusted: false,
        },
      },
      routingDecision: {
        selectedOutputClassSource: 'request_type_policy',
        selectedRouteAliasSource: 'request_type_policy.providerRouteAlias',
        selectedAdapterKeys: [
          'image_generation_primary',
          'image_generation_diffusion',
          'video_generation_primary',
          'mixed_generation_pack',
        ],
        selectedModelKeyReturned: false,
        vendorModelKeyReturned: false,
        providerPayloadReturned: false,
      },
      privacy: {
        rawPromptReturned: false,
        rawProviderPayloadReturned: false,
        rawSafetyPayloadReturned: false,
        providerSecretReturned: false,
        vendorModelIdentifierReturned: false,
      },
    });
    expect(
      AI_PREMIUM_CONTENT_MODEL_ROUTING_API_SKELETON.validationOrder,
    ).toEqual([
      'require_auth',
      'require_artist_operator',
      'validate_request_type',
      'resolve_artist_context',
      'load_server_safety_state',
      'check_server_cost_policy',
      'select_route_alias_without_provider_call',
      'return_routing_projection_without_mutation',
    ]);
    expect(
      Object.values(
        AI_PREMIUM_CONTENT_MODEL_ROUTING_API_SKELETON.noMutationPolicy,
      ).every((enabled) => enabled === false),
    ).toBe(true);
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
      auditDecisionProjection: {
        actionKey: 'ai_premium_content.safety_decision',
        statuses: ['approved', 'reviewing', 'blocked', 'failed'],
        safetyStatusMapping: {
          safe: 'approved',
          review_required: 'reviewing',
          blocked: 'blocked',
          provider_failed: 'failed',
        },
        userCopy: {
          messageKeyOnly: true,
          rawEnumAsCopy: false,
          internalAdminNoteReturned: false,
        },
        adminAudit: {
          adminNoteSeparatedFromUserCopy: true,
          adminNoteReturnedToUser: false,
          rawPromptReturned: false,
          providerPayloadReturned: false,
          tokenReturned: false,
          cookieReturned: false,
        },
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
      auditDecision: {
        actionKey: 'ai_premium_content.safety_decision',
        statusKey: 'approved',
        userMessageKey: 'aiPremiumContent.safetyPrecheck.safe',
        riskCategoryKeys: [],
        userCopyAndAdminNoteSeparated: true,
        adminNoteReturnedToUser: false,
      },
    });
    expect(reviewRequired).toMatchObject({
      status: 'review_required',
      code: 'AI_PREMIUM_CONTENT_SAFETY_REVIEW_REQUIRED',
      messageKey: 'aiPremiumContent.safetyPrecheck.reviewRequired',
      providerCallEnabled: false,
      walletMutationEnabled: false,
      auditDecision: {
        statusKey: 'reviewing',
        userMessageKey: 'aiPremiumContent.safetyPrecheck.reviewRequired',
        userCopyAndAdminNoteSeparated: true,
        adminNoteReturnedToUser: false,
        rawPromptReturned: false,
        providerPayloadReturned: false,
      },
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
      auditDecision: {
        statusKey: 'blocked',
        userMessageKey: 'aiPremiumContent.safetyPrecheck.blocked',
        riskCategoryKeys: ['minor', 'sexual_content', 'platform_policy'],
        userCopyAndAdminNoteSeparated: true,
        adminNoteReturnedToUser: false,
        rawPromptReturned: false,
        providerPayloadReturned: false,
        tokenReturned: false,
        cookieReturned: false,
      },
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
    expect(apiContracts.costPrecheck.response.costCapGuard).toEqual(
      AI_PREMIUM_CONTENT_COST_WALLET_PRECHECK_POLICY.costCapGuard,
    );
    expect(apiContracts.costPrecheck.response.walletPrecheck).toEqual(
      AI_PREMIUM_CONTENT_COST_WALLET_PRECHECK_POLICY.walletPrecheck,
    );
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
    expect(skeleton.middlewarePipelineLedger).toMatchObject({
      version: '2026-06-17.ai-premium-content-middleware-routing-ledger.v1',
      table: 'future_ai_premium_content_request_events',
      mutationEnabled: false,
      providerCallEnabled: false,
      walletMutationEnabled: false,
      requestTypes: AI_PREMIUM_CONTENT_REQUEST_TYPES,
      artistContext: {
        source: 'server_resolved_artist_profile_and_safe_context',
        rawPrivateProfileReturned: false,
        rawPromptReturned: false,
      },
      modelRoute: {
        source: 'server_capability_alias',
        providerSpecificNameReturned: false,
        providerCredentialReturned: false,
      },
      resultAssetStatus: {
        allowed: ['none', 'pending', 'processing', 'ready', 'failed', 'blocked'],
        signedUrlsReturned: false,
        storageKeyReturned: false,
      },
      retryPolicy: {
        retryCountServerOwned: true,
        retryRequiresFreshSafetyAndCostPrecheck: true,
        retryAfterSafetyBlocked: false,
      },
    });
    expect(skeleton.middlewarePipelineLedger.trackedFields).toEqual([
      'requestType',
      'artistContext',
      'providerRouteAlias',
      'safetyStatus',
      'estimatedCost',
      'retryCount',
      'resultAssetStatus',
    ]);
    expect(skeleton.costRetryReadModel).toBe(
      AI_PREMIUM_CONTENT_COST_RETRY_READ_MODEL_SKELETON,
    );
    expect(Object.values(skeleton.forbiddenSideEffects).every((enabled) => enabled === false)).toBe(
      true,
    );
    expect(serialized).not.toMatch(/gpt image|stable diffusion|seedance/i);
    expect(skeleton.sensitiveDataPolicy).toMatchObject({
      sensitiveAuthMaterialReturned: false,
      databaseConnectionMaterialReturned: false,
    });
  });

  it('defines a provider-agnostic cost and retry read model without paid mutations', () => {
    const readModel = AI_PREMIUM_CONTENT_COST_RETRY_READ_MODEL_SKELETON;
    const serialized = JSON.stringify(readModel);

    expect(readModel).toMatchObject({
      version: '2026-06-18.ai-premium-content-cost-retry-read-model.v1',
      feature: 'ai_premium_content_cost_retry_read_model',
      status: 'read_model_contract_only',
      enabled: false,
      mutationEnabled: false,
      providerCallEnabled: false,
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      paidLikeMutationEnabled: false,
      sourceLedger: {
        table: 'future_ai_premium_content_request_events',
        providerSpecificTableRequired: false,
        rawProviderPayloadStoredInReadModel: false,
      },
      providerAgnosticFields: {
        requestType: AI_PREMIUM_CONTENT_REQUEST_TYPES,
        outputClass: AI_PREMIUM_CONTENT_OUTPUT_CLASSES,
        providerRouteAlias: '<server capability route alias>',
        modelRouteClass: '<server capability class>',
        providerNameReturned: false,
        modelNameReturned: false,
        providerCredentialReturned: false,
      },
      costFields: {
        estimateSource: 'server_policy_estimate_not_provider_quote',
        estimatedCostCurrency: 'KRW_MICROS',
        finalProviderCostReturned: false,
        walletLedgerIdReturned: false,
      },
      retryPolicy: {
        maxRetryCountSource: 'server_policy',
        retryCountServerOwned: true,
        retryRequiresFreshSafetyAndCostCheck: true,
        retryAfterSafetyBlocked: false,
        providerRouteMayChangeByServer: true,
        clientCanForceRetry: false,
      },
    });
    expect(readModel.failureAndRetryFields.lastFailureClass).toEqual([
      'none',
      'safety_blocked',
      'provider_timeout',
      'provider_rate_limited',
      'provider_generation_failed',
      'asset_upload_failed',
      'moderation_failed',
    ]);
    expect(readModel.projection).toMatchObject({
      requestId: '<request uuid>',
      providerRouteAlias: '<server route alias only>',
      modelRouteClass: '<server capability class>',
      estimatedCost: {
        currency: 'KRW_MICROS',
        estimateSource: 'server_policy_estimate_not_provider_quote',
      },
      retryCount: '<integer>',
      lastFailureClass: '<stable failure class>',
    });
    expect(
      Object.values(readModel.forbiddenSideEffects).every(
        (enabled) => enabled === false,
      ),
    ).toBe(true);
    expect(readModel.sensitiveDataPolicy).toMatchObject({
      providerCredentialReturned: false,
      rawPromptReturned: false,
      rawProviderPayloadReturned: false,
      rawProviderErrorReturned: false,
      signedUrlReturned: false,
      storageKeyReturned: false,
    });
    expect(serialized).not.toMatch(/gpt image|stable diffusion|seedance/i);
  });

  it('defines a disabled create/status API skeleton with canonical lifecycle states', () => {
    const skeleton = AI_PREMIUM_CONTENT_CREATE_STATUS_API_SKELETON;

    expect(AI_PREMIUM_CONTENT_CREATE_STATUS_API_STATUSES).toEqual([
      'pending',
      'safety_review',
      'blocked',
      'queued',
      'generating',
      'ready',
      'failed',
    ]);
    expect(skeleton).toMatchObject({
      version: '2026-06-15.ai-premium-content-create-status-api-skeleton.v1',
      status: 'skeleton_ready_submit_blocked',
      enabled: false,
      submitEnabled: false,
      mutation: false,
      authRequired: true,
      artistOperatorRequired: true,
      idempotencyRequired: true,
      endpoints: {
        createRequest: {
          method: 'POST',
          path: '/api/v1/ai-premium-content/requests',
          enabled: false,
          submitEnabled: false,
          mutation: false,
        },
        requestStatus: {
          method: 'GET',
          path: '/api/v1/ai-premium-content/requests/:requestId/status',
          enabled: false,
          mutation: false,
          ownerOrArtistOperatorOnly: true,
        },
      },
      canonicalStatusAxes: {
        requestType: AI_PREMIUM_CONTENT_REQUEST_TYPES,
        safetyStatus: AI_PREMIUM_CONTENT_SAFETY_STATUSES,
        routingStatus: AI_PREMIUM_CONTENT_ROUTING_STATUSES,
        resultStatus: AI_PREMIUM_CONTENT_RESULT_STATUSES,
        rawEnumAsUserCopy: false,
        statusMessageKeyRequired: true,
      },
      providerRouting: {
        adapterKeys: AI_PREMIUM_CONTENT_PROVIDER_ADAPTER_KEYS,
        routeAliasPrefix: 'ai_premium_content.',
        selectedByServer: true,
        clientProviderChoiceTrusted: false,
        vendorProviderNameReturned: false,
        vendorModelNameReturned: false,
        outputClassRoutedFromRequestType: true,
      },
      createRequestShape: {
        requestType: AI_PREMIUM_CONTENT_REQUEST_TYPES,
        artistSlug: {
          required: true,
          serverResolvedArtistId: true,
        },
        userIntentSummary: {
          required: true,
          maxChars: 1000,
          sanitizedServerSide: true,
          rawPromptReturned: false,
        },
      },
      serverOwnedFields: {
        requestType: true,
        artistSlug: true,
        userIntentSummary: true,
        safetyStatus: AI_PREMIUM_CONTENT_SAFETY_STATUSES,
        routingStatus: AI_PREMIUM_CONTENT_ROUTING_STATUSES,
        resultStatus: AI_PREMIUM_CONTENT_RESULT_STATUSES,
      },
      statusProjection: {
        status: AI_PREMIUM_CONTENT_CREATE_STATUS_API_STATUSES,
        rawStatusAsCopy: false,
        rawProviderStatusReturned: false,
        safetyStatus: AI_PREMIUM_CONTENT_SAFETY_STATUSES,
        routingStatus: AI_PREMIUM_CONTENT_ROUTING_STATUSES,
        resultStatus: AI_PREMIUM_CONTENT_RESULT_STATUSES,
      },
      statusMapping: {
        pending: ['draft', 'submitted', 'needs_more_info'],
        safety_review: ['awaiting_review'],
        blocked: ['safety_blocked', 'rejected'],
        queued: ['queued'],
        generating: ['generating'],
        ready: ['approved'],
        failed: ['provider_failed', 'archived'],
      },
    });
    expect(skeleton.serverOwnedFields.providerRouteAlias).toMatchObject({
      source: 'server_capability_alias',
      allowedPrefix: 'ai_premium_content.',
      vendorProviderKeyReturned: false,
      vendorModelKeyReturned: false,
    });
    expect(skeleton.serverOwnedFields.estimatedCost).toMatchObject({
      currency: 'KRW_MICROS',
      source: 'server_policy_estimate_not_provider_quote',
      amountTrustedFromClient: false,
      walletDebitOnCreate: false,
    });
    expect(Object.values(skeleton.noSideEffects).every((blocked) => blocked)).toBe(
      true,
    );
    expect(skeleton.privacy).toMatchObject({
      rawPromptReturned: false,
      rawProviderPayloadReturned: false,
      vendorProviderKeyReturned: false,
      vendorModelKeyReturned: false,
      signedUrlsReturned: false,
      sensitiveAuthMaterialReturned: false,
      privateConnectionMaterialReturned: false,
      rawEmailReturned: false,
    });
  });

  it('defines a public read-only status preview fixture without provider or wallet work', () => {
    const fixture = AI_PREMIUM_CONTENT_STATUS_PREVIEW_FIXTURE_CONTRACT;

    expect(fixture).toMatchObject({
      version: '2026-06-16.ai-premium-content-status-preview-fixture.v1',
      status: 'read_only_fixture_contract',
      enabled: false,
      authRequired: false,
      mutation: false,
      endpoint: {
        method: 'GET',
        path: '/api/v1/ai-premium-content/status-preview-fixture',
        enabled: false,
        authRequired: false,
        mutation: false,
      },
      responseProjection: {
        previewOnly: true,
        statusSheetSurface: 'qa_status_preview',
        locale: 'ko-KR',
        rawStatusAsCopy: false,
        rawEnumAsCopy: false,
        rawProviderStatusReturned: false,
        providerPayloadReturned: false,
        signedUrlsReturned: false,
        rawPromptReturned: false,
      },
    });
    expect(fixture.fixtureStates.map((state) => state.key)).toEqual([
      'reviewing',
      'generating',
      'completed',
      'blocked',
      'failed',
      'regeneratable',
    ]);
    expect(fixture.fixtureStates.map((state) => state.labelKo)).toEqual([
      '검수 중',
      '제작 중',
      '완료',
      '차단',
      '실패',
      '재생성 가능',
    ]);
    expect(
      fixture.fixtureStates.every((state) => state.rawEnumAsCopy === false),
    ).toBe(true);
    expect(Object.values(fixture.noSideEffects).every((blocked) => blocked)).toBe(
      true,
    );
  });

  it('keeps character-chat premium content handoff as a disabled adapter-only product flow', () => {
    const handoff = CHARACTER_CHAT_AI_PREMIUM_CONTENT_HANDOFF_CONTRACT;
    const serialized = JSON.stringify(handoff);

    expect(handoff).toMatchObject({
      version: '2026-06-15.character-chat-ai-premium-content-handoff.v1',
      status: 'contract_ready_submit_blocked',
      sourceSurface: 'character_chat',
      enabled: false,
      submitEnabled: false,
      mutation: false,
      providerCallEnabled: false,
      walletMutationEnabled: false,
      orderMutationEnabled: false,
    });
    expect(handoff.sourceProductFlow).toMatchObject({
      productKind: 'ai_character_chat',
      responseMode: 'ai_character_reply',
      normalTextMessageContinuesCharacterChat: true,
      createsPremiumChatRoom: false,
      createsArtistDirectDm: false,
    });
    expect(handoff.targetProductFlow).toMatchObject({
      productKind: 'ai_premium_content_request',
      responseMode: 'async_ai_content_generation_request',
      targetEndpoint: '/api/v1/ai-premium-content/requests',
      currentStorageEnabled: false,
      currentSubmitEnabled: false,
    });
    expect(handoff.targetProductFlow.requestTypes).toEqual(
      AI_PREMIUM_CONTENT_REQUEST_TYPES,
    );
    expect(handoff.productFlowSeparation).toMatchObject({
      characterChat: {
        productKind: 'ai_character_chat',
        createsAiPremiumContentRequest: false,
        createsPremiumDmRoom: false,
      },
      premiumDirectDm: {
        productKind: 'artist_direct_premium_dm',
        createsCharacterChatMessage: false,
        createsAiPremiumContentRequest: false,
      },
      aiPremiumContent: {
        productKind: 'ai_premium_content_request',
        ownsImageVideoGenerationRequest: true,
        createsCharacterChatAiReply: false,
        createsPremiumDmRoom: false,
      },
    });
    expect(handoff.adapterShape).toMatchObject({
      adapterOnly: true,
      sourceMessageIdReferenceOnly: true,
      requestTypeSource: 'server_classified_content_intent',
      briefSource: 'sanitized_user_intent_summary',
      rawChatTranscriptCopied: false,
      rawUserPromptAsProviderPrompt: false,
      rawProviderPayloadCopied: false,
      providerSpecificModelKeyAccepted: false,
    });
    expect(Object.values(handoff.forbiddenSideEffects).every((enabled) => enabled === false)).toBe(
      true,
    );
    expect(serialized).not.toMatch(/apiKey|secret|token|password|cookie|dbUrl/i);
    expect(handoff.responseProjection).toMatchObject({
      rawIntentEnumAsCopy: false,
      rawRequestTypeAsCopy: false,
      providerNameReturned: false,
      modelNameReturned: false,
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
    expect(imagePrecheck.costCapGuard).toMatchObject({
      capSource: 'server_route_cost_policy',
      providerQuoteTrusted: false,
      providerCallBeforeCapCheck: false,
      walletMutationBeforeCapCheck: false,
    });
    expect(imagePrecheck.walletPrecheck).toMatchObject({
      balanceSource: 'wallet_accounts.cached_balance',
      clientSubmittedBalanceTrusted: false,
      providerCallBeforeWalletPrecheck: false,
      walletDebitOnPrecheck: false,
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

  it('guards provider attempts with request cost caps, timeout policy, and non-billable failures', () => {
    expect(AI_PREMIUM_CONTENT_PROVIDER_GUARD_CONTRACT).toMatchObject({
      version: '2026-06-16.ai-premium-content-provider-cost-timeout-guard.v1',
      status: 'contract_ready_provider_disabled',
      providerAttemptEnabled: false,
      providerRouteAliasOnly: true,
      providerSpecificModelNameTrusted: false,
      requestCostCap: {
        currency: 'KRW_MICROS',
        source: 'server_request_policy_cap',
        clientSubmittedCostTrusted: false,
        failClosedBeforeProviderCall: true,
      },
      timeoutPolicy: {
        providerTimeoutMs: 30000,
        connectTimeoutMs: 5000,
        timeoutStatusKey: 'provider_failed',
        timeoutCode: 'AI_PREMIUM_CONTENT_PROVIDER_TIMEOUT',
        timeoutBillable: false,
      },
      retryPolicy: {
        maxAttempts: 1,
        retryRequiresFreshCostGuard: true,
        retryAfterSafetyBlocked: false,
        duplicateProviderCostRow: false,
      },
      billingPolicy: {
        successOnlyBillable: true,
        safetyBlockedBillable: false,
        timeoutBillable: false,
        providerFailedBillable: false,
        moderationRejectedBillable: false,
        walletMutationEnabled: false,
        orderMutationEnabled: false,
      },
    });
    expect(AI_PREMIUM_CONTENT_PROVIDER_GUARD_CONTRACT.providerRoutes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerRouteAlias: 'ai_premium_content.video.text_to_video',
          costClass: 'high',
          paidRequestRequired: true,
        }),
      ]),
    );
    expect(
      resolveAiPremiumContentProviderGuard({
        providerRouteAlias: 'ai_premium_content.video.text_to_video',
        estimatedCostMicros: 40_000_000,
        requestCostCapMicros: 50_000_000,
        paidRequest: false,
        safetyStatus: 'cleared',
      }),
    ).toMatchObject({
      allowed: false,
      code: 'AI_PREMIUM_CONTENT_PAID_REQUEST_REQUIRED',
      billable: false,
      providerAttemptEnabled: false,
      walletMutationEnabled: false,
    });
    expect(
      resolveAiPremiumContentProviderGuard({
        providerRouteAlias: 'ai_premium_content.image.text_to_image',
        estimatedCostMicros: 6_000_000,
        requestCostCapMicros: 5_000_000,
        paidRequest: true,
        safetyStatus: 'cleared',
      }),
    ).toMatchObject({
      allowed: false,
      code: 'AI_PREMIUM_CONTENT_COST_CAP_EXCEEDED',
      statusKey: 'failed',
      billable: false,
      retryAllowed: false,
    });
    expect(
      resolveAiPremiumContentProviderGuard({
        providerRouteAlias: 'ai_premium_content.image.text_to_image',
        estimatedCostMicros: 3_000_000,
        requestCostCapMicros: 5_000_000,
        paidRequest: true,
        safetyStatus: 'cleared',
        failureCode: 'provider_timeout',
        attempt: 1,
      }),
    ).toMatchObject({
      allowed: false,
      code: 'AI_PREMIUM_CONTENT_PROVIDER_TIMEOUT',
      statusKey: 'failed',
      billable: false,
      retryAllowed: false,
      providerTimeoutMs: 30000,
    });
    expect(
      resolveAiPremiumContentProviderGuard({
        providerRouteAlias: 'ai_premium_content.image.text_to_image',
        estimatedCostMicros: 3_000_000,
        requestCostCapMicros: 5_000_000,
        paidRequest: true,
        safetyStatus: 'blocked',
      }),
    ).toMatchObject({
      allowed: false,
      code: 'AI_PREMIUM_CONTENT_SAFETY_BLOCKED',
      statusKey: 'blocked',
      billable: false,
      retryAllowed: false,
    });
  });

  it('denies cost cap and wallet precheck failures before provider or debit work', () => {
    expect(
      resolveAiPremiumContentCostPrecheck({
        requestType: 'video_clip',
        artistSlug: 'aria',
        userEntitled: true,
        requestCostCapMicros: 1,
      }),
    ).toMatchObject({
      allowed: false,
      code: 'AI_PREMIUM_CONTENT_COST_CAP_EXCEEDED',
      messageKey: 'aiPremiumContent.precheck.costCapExceeded',
      httpStatus: 409,
      outputClass: 'video',
      costCapGuard: {
        providerQuoteTrusted: false,
        providerCallBeforeCapCheck: false,
        walletMutationBeforeCapCheck: false,
      },
      providerCallEnabled: false,
      walletMutationEnabled: false,
      orderMutationEnabled: false,
    });

    expect(
      resolveAiPremiumContentCostPrecheck({
        requestType: 'image_single',
        artistSlug: 'aria',
        userEntitled: true,
        paidRequest: true,
        requiredLumina: 50,
        walletBalanceLumina: 10,
      }),
    ).toMatchObject({
      allowed: false,
      code: 'AI_PREMIUM_CONTENT_WALLET_PRECHECK_INSUFFICIENT',
      messageKey: 'aiPremiumContent.precheck.insufficientBalance',
      httpStatus: 409,
      outputClass: 'image',
      walletPrecheck: {
        paidRequest: true,
        requiredLumina: 50,
        balanceChecked: true,
      },
      providerCallEnabled: false,
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      paidLikeMutationEnabled: false,
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

  it('defines a disabled unified result archive read projection without internal cost exposure', () => {
    const contract = AI_PREMIUM_CONTENT_STATE_API_CONTRACT;

    expect(contract.apiContracts.myResultArchive).toMatchObject({
      method: 'GET',
      path: '/api/v1/me/ai-premium-content/results',
      enabled: false,
      authRequired: true,
      ownerOnly: true,
      query: {
        requestType: AI_PREMIUM_CONTENT_REQUEST_TYPES,
        outputClass: AI_PREMIUM_CONTENT_OUTPUT_CLASSES,
        resultStatus: AI_PREMIUM_CONTENT_RESULT_STATUSES,
        take: { default: 30, max: 100 },
        cursor: 'opaque result archive cursor',
      },
      mutation: false,
    });
    expect(contract.projection.surfaces.resultArchive).toMatchObject({
      audience: 'request_owner_or_artist_operator',
      endpoint: '/api/v1/me/ai-premium-content/results',
      projection: 'aiPremiumContentResultArchiveItem',
      groupsImageVideoAndMixedTogether: true,
      statusBuckets: {
        completed: ['approved'],
        reviewing: ['awaiting_review'],
        blocked: ['blocked', 'rejected'],
        failed: ['provider_failed', 'failed'],
        regeneratable: ['provider_failed', 'rejected'],
      },
      resultAvailability: {
        imageAndVideoAssetIdsAllowed: true,
        publicOriginalUrlsReturned: false,
        signedUrlsReturned: false,
        providerResultUrlsReturned: false,
      },
      regenerationAvailability: {
        canRegenerateField: 'canRegenerate',
        disabledReasonKeyField: 'disabledReasonKey',
        providerCallOnRead: false,
        walletMutationOnRead: false,
      },
      costPrivacy: {
        userFacingPriceLabelAllowed: true,
        internalCostBreakdownReturned: false,
        providerCostReturned: false,
        settlementCostReturned: false,
        payoutCostReturned: false,
      },
      rawEnumAsCopy: false,
      rawPromptReturned: false,
      providerPayloadReturned: false,
      mutation: false,
      resultAssetReuseAudit:
        AI_PREMIUM_CONTENT_RESULT_ASSET_REUSE_AUDIT_PROJECTION,
    });
    expect(contract.projection.surfaces.resultArchive.listFields).toEqual(
      expect.arrayContaining([
        'requestType',
        'outputClass',
        'status',
        'safetyStatus',
        'resultStatus',
        'resultAvailability',
        'regenerationAvailability',
      ]),
    );
  });

  it('defines a read-only result asset reuse audit projection without overclaiming generation freshness', () => {
    const projection = AI_PREMIUM_CONTENT_RESULT_ASSET_REUSE_AUDIT_PROJECTION;

    expect(projection).toMatchObject({
      version: '2026-06-19.ai-premium-content-result-asset-reuse-audit.v1',
      feature: 'ai_premium_content_result_asset_reuse_audit_projection',
      status: 'read_model_contract_only',
      enabled: false,
      mutationEnabled: false,
      providerCallEnabled: false,
      fileUploadEnabled: false,
      paymentMutationEnabled: false,
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      sourceOfTruth: {
        generatedAssetTable: 'future_ai_premium_content_result_assets',
        requestTable: 'future_ai_premium_content_requests',
        artistScope: 'server_resolved_artist_id',
        rawEmbeddingReturned: false,
      },
      reuseCandidatePolicy: {
        artistScopedOnly: true,
        crossArtistReuseAllowed: false,
        userPrivatePromptSimilarityReturned: false,
        reuseRequiresHumanOrServerPolicyApproval: true,
        clientCanForceReuse: false,
        newGenerationClaimWhenReused: false,
      },
      userFacingDisclosure: {
        stableKeyRequired: true,
        displayDisclosureKey: 'aiPremiumContent.result.reuseDisclosure',
        mustNotClaimFreshGenerationWhenReused: true,
        rawInternalReasonReturned: false,
      },
      costControl: {
        intendedUse: 'cost_reduction_audit_only',
        providerCallAvoidedMetricAllowed: true,
        providerCostReturnedToUser: false,
        walletCreditOrDebitAllowed: false,
      },
    });
    expect(projection.projectionFields).toEqual(
      expect.arrayContaining([
        'artistId',
        'sourceResultAssetId',
        'candidateResultAssetId',
        'reuseCandidateScoreBucket',
        'reuseDecisionKey',
        'displayDisclosureKey',
      ]),
    );
    expect(projection.scoreBuckets).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'exact_policy_match',
    ]);
    expect(projection.reuseDecisionKeys).toEqual([
      'new_generation_required',
      'reuse_candidate_review',
      'reuse_allowed_with_disclosure',
      'reuse_rejected',
    ]);
    expect(projection.privacy).toMatchObject({
      rawPromptReturned: false,
      rawReferenceAssetReturned: false,
      rawEmbeddingReturned: false,
      providerPayloadReturned: false,
      signedUrlReturned: false,
      storageKeyReturned: false,
    });
  });
});

import {
  AI_PREMIUM_CONTENT_MODERATION_STATUSES,
  AI_PREMIUM_CONTENT_OUTPUT_CLASSES,
  AI_PREMIUM_CONTENT_REQUEST_STATUSES,
  AI_PREMIUM_CONTENT_REQUEST_TYPE_POLICY,
  AI_PREMIUM_CONTENT_REQUEST_TYPES,
  AI_PREMIUM_CONTENT_STATE_API_CONTRACT,
  AI_PREMIUM_CONTENT_STATUS_COPY_KO,
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
      defaultCapability: 'text_to_image',
      humanReviewRequired: true,
    });
    expect(AI_PREMIUM_CONTENT_REQUEST_TYPE_POLICY.video_clip).toMatchObject({
      outputClass: 'video',
      defaultCapability: 'text_to_video',
      humanReviewRequired: true,
    });
    expect(AI_PREMIUM_CONTENT_REQUEST_TYPE_POLICY.premium_pack).toMatchObject({
      outputClass: 'mixed',
      defaultCapability: 'mixed_generation_pack',
      humanReviewRequired: true,
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
});

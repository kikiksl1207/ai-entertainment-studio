export const AI_PREMIUM_CONTENT_REQUEST_TYPES = [
  'image_single',
  'image_variation',
  'image_reference',
  'video_clip',
  'video_loop',
  'premium_pack',
] as const;

export const AI_PREMIUM_CONTENT_OUTPUT_CLASSES = [
  'image',
  'video',
  'mixed',
] as const;

export const AI_PREMIUM_CONTENT_REQUEST_STATUSES = [
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
] as const;

export const AI_PREMIUM_CONTENT_MODERATION_STATUSES = [
  'pending',
  'cleared',
  'blocked',
  'needs_review',
] as const;

export const AI_PREMIUM_CONTENT_STATUS_COPY_KO = {
  draft: '작성 중',
  submitted: '요청이 접수됐어요',
  safety_blocked: '안전 기준 때문에 진행할 수 없어요',
  needs_more_info: '추가 정보가 필요해요',
  queued: '생성 준비 중이에요',
  generating: '콘텐츠를 만들고 있어요',
  provider_failed: '생성에 실패했어요',
  awaiting_review: '검토 중이에요',
  approved: '콘텐츠가 준비됐어요',
  rejected: '요청이 승인되지 않았어요',
  archived: '보관된 요청이에요',
} as const;

export const AI_PREMIUM_CONTENT_REQUEST_TYPE_POLICY = {
  image_single: {
    outputClass: 'image',
    firstSurface: ['creator_studio', 'backstage'],
    providerRouteAlias: 'ai_premium_content.image.text_to_image',
    defaultCapability: 'text_to_image',
    humanReviewRequired: true,
  },
  image_variation: {
    outputClass: 'image',
    firstSurface: ['creator_studio', 'backstage'],
    providerRouteAlias: 'ai_premium_content.image.image_to_image',
    defaultCapability: 'image_to_image',
    humanReviewRequired: true,
  },
  image_reference: {
    outputClass: 'image',
    firstSurface: ['creator_studio'],
    providerRouteAlias: 'ai_premium_content.image.reference_pack',
    defaultCapability: 'text_to_image',
    humanReviewRequired: true,
  },
  video_clip: {
    outputClass: 'video',
    firstSurface: ['backstage'],
    providerRouteAlias: 'ai_premium_content.video.text_to_video',
    defaultCapability: 'text_to_video',
    humanReviewRequired: true,
  },
  video_loop: {
    outputClass: 'video',
    firstSurface: ['backstage'],
    providerRouteAlias: 'ai_premium_content.video.image_to_video',
    defaultCapability: 'image_to_video',
    humanReviewRequired: true,
  },
  premium_pack: {
    outputClass: 'mixed',
    firstSurface: ['backstage'],
    providerRouteAlias: 'ai_premium_content.mixed.generation_pack',
    defaultCapability: 'mixed_generation_pack',
    humanReviewRequired: true,
  },
} as const;

export const AI_PREMIUM_CONTENT_SAFETY_STATUSES = [
  'pending',
  'needs_review',
  'blocked',
  'cleared',
] as const;

export const AI_PREMIUM_CONTENT_BRIEF_API_SKELETON = {
  version: '2026-06-05.ai-premium-content-brief-api-skeleton.v1',
  feature: 'ai_premium_content_request_brief',
  status: 'skeleton_ready_submit_blocked',
  method: 'POST',
  path: '/api/v1/ai-premium-content/requests',
  enabled: false,
  submitEnabled: false,
  mutation: false,
  authRequired: true,
  artistOperatorRequired: true,
  idempotencyRequired: true,
  providerCallEnabled: false,
  walletDebitEnabled: false,
  orderCreateEnabled: false,
  settlementAccrualEnabled: false,
  payoutAccrualEnabled: false,
  paidLikeMutationEnabled: false,
  publicPublishEnabled: false,
  trackedFields: {
    requestType: AI_PREMIUM_CONTENT_REQUEST_TYPES,
    artistSlug: {
      required: true,
      source: 'path_or_body_artist_slug',
      serverResolvedArtistId: true,
    },
    brief: {
      required: true,
      maxChars: 2000,
      storedAsSanitizedExcerptOnlyUntilImplementation: true,
      rawPrivatePromptReturned: false,
    },
    safetyStatus: {
      allowed: AI_PREMIUM_CONTENT_SAFETY_STATUSES,
      initial: 'pending',
      serverOwned: true,
      clientSubmittedTrusted: false,
    },
    estimatedCost: {
      tracked: true,
      currency: 'provider_internal_or_krw',
      amountTrustedFromClient: false,
      walletDebitOnSubmit: false,
      finalCostComputedLater: true,
    },
  },
  requestBodyShape: {
    requestType: '<image_single|image_variation|image_reference|video_clip|video_loop|premium_pack>',
    artistSlug: '<artist slug>',
    brief: '<sanitized operator brief text>',
    referenceAssetIds: '<optional safe asset uuid array>',
  },
  responseProjection: {
    request: {
      id: '<request uuid or readiness placeholder>',
      requestType: '<request type>',
      artist: {
        slug: '<artist slug>',
        id: '<server resolved artist id>',
      },
      status: 'draft',
      safetyStatus: 'pending',
      estimatedCost: {
        amount: null,
        currency: null,
        final: false,
      },
    },
    policy: {
      canSubmit: false,
      canGenerate: false,
      canDebitWallet: false,
      canPublish: false,
      disabledReasonKey: 'aiPremiumContent.briefSubmit.disabled',
    },
  },
  validationOrder: [
    'auth_required',
    'artist_slug_required',
    'artist_operator_access',
    'request_type_valid',
    'brief_required',
    'brief_length_valid',
    'reference_assets_safe_if_present',
    'safety_status_server_owned',
    'estimated_cost_server_owned',
    'mutation_gate_closed',
  ],
  forbiddenSideEffects: {
    providerAttempt: false,
    walletDebit: false,
    orderCreate: false,
    settlementAccrual: false,
    payoutAccrual: false,
    paidLike: false,
    publicPublish: false,
    equipToProfileOrFeed: false,
  },
  privacy: {
    rawProviderPayloadReturned: false,
    rawPrivatePromptReturned: false,
    signedUrlsReturned: false,
    sensitiveAuthMaterialReturned: false,
    rawEmailReturned: false,
  },
} as const;

export const AI_PREMIUM_CONTENT_COST_PRECHECK_CONTRACT_VERSION =
  '2026-06-05.ai-premium-content-cost-precheck.v1';

const AI_PREMIUM_CONTENT_PRECHECK_COST_POLICY = {
  image: {
    currency: 'KRW_MICROS',
    estimatedCostCeilingMicros: 5_000_000,
    estimateSource: 'server_policy_estimate_not_provider_quote',
  },
  video: {
    currency: 'KRW_MICROS',
    estimatedCostCeilingMicros: 50_000_000,
    estimateSource: 'server_policy_estimate_not_provider_quote',
  },
  mixed: {
    currency: 'KRW_MICROS',
    estimatedCostCeilingMicros: 70_000_000,
    estimateSource: 'server_policy_estimate_not_provider_quote',
  },
} as const;

export const AI_PREMIUM_CONTENT_PRECHECK_FAILURE_POLICY = {
  maxProviderAttempts: 1,
  maxRegenerationCount: 2,
  maxFailureCountBeforeManualReview: 1,
  providerCallBeforePrecheck: false,
  regenerationRequiresFreshPrecheck: true,
} as const;

type AiPremiumContentRequestType =
  (typeof AI_PREMIUM_CONTENT_REQUEST_TYPES)[number];

type AiPremiumContentOutputClass =
  (typeof AI_PREMIUM_CONTENT_OUTPUT_CLASSES)[number];

type AiPremiumContentRequestTypePolicy =
  (typeof AI_PREMIUM_CONTENT_REQUEST_TYPE_POLICY)[AiPremiumContentRequestType];

type AiPremiumContentCostPrecheckInput = {
  requestType?: string | null;
  artistSlug?: string | null;
  userEntitled?: boolean | null;
  regenerationCount?: number | string | null;
  failureCount?: number | string | null;
};

const nonNegativeInteger = (value: number | string | null | undefined) => {
  const parsed =
    typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : typeof value === 'number'
        ? value
        : 0;

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
};

const isAiPremiumContentRequestType = (
  value: string | null | undefined,
): value is AiPremiumContentRequestType =>
  AI_PREMIUM_CONTENT_REQUEST_TYPES.includes(
    value as AiPremiumContentRequestType,
  );

const deniedAiPremiumContentPrecheck = ({
  code,
  messageKey,
  httpStatus,
  requestType,
  artistSlug,
  regenerationCount,
  failureCount,
}: {
  code: string;
  messageKey: string;
  httpStatus: 400 | 403 | 409;
  requestType: string | null;
  artistSlug: string | null;
  regenerationCount: number;
  failureCount: number;
}) =>
  ({
    allowed: false,
    precheckOnly: true,
    code,
    messageKey,
    httpStatus,
    requestType,
    artistSlug,
    outputClass: null,
    modelRoutingCandidates: [],
    estimatedCost: null,
    failurePolicy: {
      ...AI_PREMIUM_CONTENT_PRECHECK_FAILURE_POLICY,
      regenerationCount,
      failureCount,
    },
    providerCallEnabled: false,
    walletMutationEnabled: false,
    orderMutationEnabled: false,
    settlementMutationEnabled: false,
    payoutMutationEnabled: false,
    paidLikeMutationEnabled: false,
  }) as const;

const aiPremiumContentPrecheckSuccess = ({
  requestType,
  artistSlug,
  requestPolicy,
  outputClass,
  regenerationCount,
  failureCount,
}: {
  requestType: AiPremiumContentRequestType;
  artistSlug: string | null;
  requestPolicy: AiPremiumContentRequestTypePolicy;
  outputClass: AiPremiumContentOutputClass;
  regenerationCount: number;
  failureCount: number;
}) =>
  ({
    allowed: true,
    precheckOnly: true,
    code: 'AI_PREMIUM_CONTENT_PRECHECK_READY',
    messageKey: 'aiPremiumContent.precheck.ready',
    httpStatus: 200,
    requestType,
    artistSlug,
    outputClass,
    modelRoutingCandidates: [
      {
        providerRouteAlias: requestPolicy.providerRouteAlias,
        capability: requestPolicy.defaultCapability,
        aliasType: 'server_capability_alias',
        providerKeyReturned: false,
        modelKeyReturned: false,
      },
    ],
    estimatedCost: AI_PREMIUM_CONTENT_PRECHECK_COST_POLICY[outputClass],
    failurePolicy: {
      ...AI_PREMIUM_CONTENT_PRECHECK_FAILURE_POLICY,
      regenerationCount,
      failureCount,
    },
    contextSnapshot: {
      serverOwned: true,
      artistSlugIncluded: Boolean(artistSlug),
      rawPromptStored: false,
      privateReferenceMaterialReturned: false,
    },
    providerCallEnabled: false,
    walletMutationEnabled: false,
    orderMutationEnabled: false,
    settlementMutationEnabled: false,
    payoutMutationEnabled: false,
    paidLikeMutationEnabled: false,
  }) as const;

export const resolveAiPremiumContentCostPrecheck = (
  input: AiPremiumContentCostPrecheckInput,
) => {
  const requestType = input.requestType?.trim() ?? null;
  const artistSlug = input.artistSlug?.trim() || null;
  const regenerationCount = nonNegativeInteger(input.regenerationCount);
  const failureCount = nonNegativeInteger(input.failureCount);

  if (!isAiPremiumContentRequestType(requestType)) {
    return deniedAiPremiumContentPrecheck({
      code: 'AI_PREMIUM_CONTENT_REQUEST_TYPE_INVALID',
      messageKey: 'aiPremiumContent.precheck.invalidRequestType',
      httpStatus: 400,
      requestType,
      artistSlug,
      regenerationCount,
      failureCount,
    });
  }

  if (input.userEntitled !== true) {
    return deniedAiPremiumContentPrecheck({
      code: 'AI_PREMIUM_CONTENT_ENTITLEMENT_REQUIRED',
      messageKey: 'aiPremiumContent.precheck.entitlementRequired',
      httpStatus: 403,
      requestType,
      artistSlug,
      regenerationCount,
      failureCount,
    });
  }

  if (
    regenerationCount >=
    AI_PREMIUM_CONTENT_PRECHECK_FAILURE_POLICY.maxRegenerationCount
  ) {
    return deniedAiPremiumContentPrecheck({
      code: 'AI_PREMIUM_CONTENT_REGENERATION_LIMIT_REACHED',
      messageKey: 'aiPremiumContent.precheck.regenerationLimitReached',
      httpStatus: 409,
      requestType,
      artistSlug,
      regenerationCount,
      failureCount,
    });
  }

  const requestPolicy = AI_PREMIUM_CONTENT_REQUEST_TYPE_POLICY[requestType];
  const outputClass = requestPolicy.outputClass as AiPremiumContentOutputClass;

  return aiPremiumContentPrecheckSuccess({
    requestType,
    artistSlug,
    requestPolicy,
    outputClass,
    regenerationCount,
    failureCount,
  });
};

export const AI_PREMIUM_CONTENT_STATE_API_CONTRACT = {
  version: '2026-06-02.ai-premium-content-request-state-api-skeleton.v1',
  feature: 'ai_premium_content_request_state',
  status: 'skeleton_ready_mutation_blocked',
  readOnly: true,
  providerCallEnabled: false,
  walletMutationEnabled: false,
  orderMutationEnabled: false,
  settlementMutationEnabled: false,
  payoutMutationEnabled: false,
  paidLikeMutationEnabled: false,
  publicPublishMutationEnabled: false,
  sourceQueues: {
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
  },
  requestTypes: AI_PREMIUM_CONTENT_REQUEST_TYPES,
  outputClasses: AI_PREMIUM_CONTENT_OUTPUT_CLASSES,
  statuses: AI_PREMIUM_CONTENT_REQUEST_STATUSES,
  moderationStatuses: AI_PREMIUM_CONTENT_MODERATION_STATUSES,
  requestTypePolicy: AI_PREMIUM_CONTENT_REQUEST_TYPE_POLICY,
  briefApiSkeleton: AI_PREMIUM_CONTENT_BRIEF_API_SKELETON,
  statusCopy: {
    locale: 'ko-KR',
    fallbackMap: AI_PREMIUM_CONTENT_STATUS_COPY_KO,
    rawEnumAsCopy: false,
    rawProviderStatusAsCopy: false,
    neutralFallbackCopy: '상태를 확인 중이에요',
  },
  apiContracts: {
    myRequestList: {
      method: 'GET',
      path: '/api/v1/me/ai-premium-content/requests',
      enabled: false,
      authRequired: true,
      ownerOnly: true,
      query: {
        artistId: 'optional artist uuid',
        status: AI_PREMIUM_CONTENT_REQUEST_STATUSES,
        requestType: AI_PREMIUM_CONTENT_REQUEST_TYPES,
        outputClass: AI_PREMIUM_CONTENT_OUTPUT_CLASSES,
        take: { default: 30, max: 100 },
        cursor: 'opaque request cursor',
      },
      mutation: false,
    },
    myRequestDetail: {
      method: 'GET',
      path: '/api/v1/ai-premium-content/requests/:requestId',
      enabled: false,
      authRequired: true,
      ownerOrArtistOperatorOnly: true,
      mutation: false,
    },
    adminRequestList: {
      method: 'GET',
      path: '/admin/api/v1/ai-premium-content/requests',
      enabled: false,
      adminRequired: true,
      requiredPermission: 'assets:read',
      query: {
        status: AI_PREMIUM_CONTENT_REQUEST_STATUSES,
        moderationStatus: AI_PREMIUM_CONTENT_MODERATION_STATUSES,
        requestType: AI_PREMIUM_CONTENT_REQUEST_TYPES,
        outputClass: AI_PREMIUM_CONTENT_OUTPUT_CLASSES,
        take: { default: 50, max: 100 },
        cursor: 'opaque request cursor',
      },
      mutation: false,
    },
    adminRequestDetail: {
      method: 'GET',
      path: '/admin/api/v1/ai-premium-content/requests/:requestId',
      enabled: false,
      adminRequired: true,
      requiredPermission: 'assets:read',
      mutation: false,
    },
    createRequest: {
      method: 'POST',
      path: '/api/v1/ai-premium-content/requests',
      enabled: false,
      submitEnabled: false,
      idempotencyRequired: true,
      mutation: false,
    },
    costPrecheck: {
      method: 'POST',
      path: '/api/v1/ai-premium-content/requests/precheck',
      enabled: false,
      submitEnabled: false,
      authRequired: true,
      mutation: false,
      providerCallEnabled: false,
      idempotencyRequired: false,
      request: {
        requestType: AI_PREMIUM_CONTENT_REQUEST_TYPES,
        artistSlug: 'required stable artist slug',
        sourceSurface: ['creator_studio', 'backstage'],
        regenerationCount: 'server-derived non-negative integer',
        failureCount: 'server-derived non-negative integer',
      },
      response: {
        code: '<stable precheck code>',
        messageKey: '<stable localized message key>',
        allowed: '<boolean>',
        outputClass: AI_PREMIUM_CONTENT_OUTPUT_CLASSES,
        modelRoutingCandidates: [
          {
            providerRouteAlias: '<server provider route alias>',
            capability: '<server capability alias>',
            aliasType: 'server_capability_alias',
            providerKeyReturned: false,
            modelKeyReturned: false,
          },
        ],
        estimatedCost: {
          currency: 'KRW_MICROS',
          estimatedCostCeilingMicros: '<integer policy ceiling>',
          estimateSource: 'server_policy_estimate_not_provider_quote',
        },
        failurePolicy: AI_PREMIUM_CONTENT_PRECHECK_FAILURE_POLICY,
      },
    },
    regenerateRequest: {
      method: 'POST',
      path: '/api/v1/ai-premium-content/requests/:requestId/regenerations',
      enabled: false,
      submitEnabled: false,
      idempotencyRequired: true,
      mutation: false,
    },
    adminUpdateRequest: {
      method: 'PATCH',
      path: '/admin/api/v1/ai-premium-content/requests/:requestId',
      enabled: false,
      mutation: false,
      idempotencyRequiredForReviewDecisions: true,
    },
  },
  projection: {
    requestItem: {
      id: '<request uuid>',
      requestType: '<image_single|image_variation|image_reference|video_clip|video_loop|premium_pack>',
      outputClass: '<image|video|mixed>',
      sourceSurface: '<creator_studio|backstage|system>',
      artist: {
        id: '<artist uuid>',
        slug: '<artist slug>',
        displayName: '<artist display name>',
      },
      status: {
        key: '<internal status>',
        labelKo: '<localized Korean copy>',
        messageKey: '<stable copy key>',
        rawEnumAsCopy: false,
      },
      moderationStatus: {
        key: '<pending|cleared|blocked|needs_review>',
        labelKo: '<localized Korean copy>',
        rawEnumAsCopy: false,
      },
      resultAvailability: {
        hasResultAssets: '<boolean>',
        resultAssetIds: '<safe asset uuid array>',
        publicOriginalUrlsReturned: false,
        signedUrlsReturned: false,
      },
      retryAvailability: {
        canRegenerate: false,
        disabledReasonKey: 'aiPremiumContent.regeneration.disabled',
      },
      publishAvailability: {
        canPublish: false,
        canEquip: false,
        disabledReasonKey: 'aiPremiumContent.publish.disabled',
      },
      timestamps: {
        createdAt: '<ISO datetime>',
        updatedAt: '<ISO datetime>',
        completedAt: '<ISO datetime or null>',
      },
    },
    surfaces: {
      owner: {
        audience: 'request_owner_or_artist_operator',
        listFields: [
          'id',
          'requestType',
          'outputClass',
          'sourceSurface',
          'artist',
          'status',
          'moderationStatus',
          'resultAvailability',
          'retryAvailability',
          'publishAvailability',
          'timestamps',
        ],
        detailAdditionalFields: [
          'briefSummary',
          'referenceAssetPreview',
          'userFacingSafetySummary',
        ],
        statusCopyRequired: true,
        rawEnumAsCopy: false,
        modelKeyReturned: false,
        rawPromptReturned: false,
        providerPayloadReturned: false,
        adminModerationNoteReturned: false,
        internalCostReturned: false,
        internalReviewFieldsReturned: false,
      },
      admin: {
        audience: 'admin_assets_read_operator',
        listFields: [
          'id',
          'requestType',
          'outputClass',
          'sourceSurface',
          'artist',
          'status',
          'moderationStatus',
          'resultAvailability',
          'timestamps',
          'reviewSummary',
        ],
        detailAdditionalFields: [
          'briefSummary',
          'referenceAssetPreview',
          'safetyGateSummary',
          'moderationReasonKey',
          'costPolicySummary',
          'generationAttemptSummary',
        ],
        statusCopyRequired: true,
        rawEnumAsCopy: false,
        modelRouteAliasReturned: true,
        modelKeyReturned: false,
        rawPromptReturned: false,
        providerPayloadReturned: false,
        rawModerationNoteReturned: false,
        internalCostReturned: false,
        ownerPrivateContactReturned: false,
      },
      forbiddenEverywhere: [
        'providerKey',
        'modelKey',
        'rawPrompt',
        'providerPayload',
        'rawModerationNote',
        'internalCostBreakdown',
        'walletLedgerId',
        'settlementId',
        'payoutId',
      ],
    },
  },
  validationOrder: [
    'auth_required',
    'request_id_valid',
    'request_exists',
    'owner_or_artist_operator_access',
    'status_filter_valid',
    'safe_projection_only',
  ],
  mutationGates: {
    createRequest: false,
    regenerateRequest: false,
    providerAttempt: false,
    walletDebit: false,
    orderCreate: false,
    settlementAccrual: false,
    payoutAccrual: false,
    paidLike: false,
    publicPublish: false,
    equipToProfileOrFeed: false,
    adminReviewDecision: false,
  },
  serverAuthority: {
    clientSubmittedStatusTrusted: false,
    clientSubmittedModerationStatusTrusted: false,
    clientSubmittedProviderStatusTrusted: false,
    clientSubmittedCostTrusted: false,
    clientSubmittedResultAssetUrlsTrusted: false,
    serverBuildsContextSnapshot: true,
    serverOwnsSafetyGate: true,
  },
  privacy: {
    rawProviderPayloadReturned: false,
    rawPromptReturned: false,
    rawPrivateReferenceMaterialReturned: false,
    signedUrlsReturned: false,
    sensitiveAuthMaterialReturned: false,
    privateConnectionMaterialReturned: false,
    rawEmailReturned: false,
  },
} as const;

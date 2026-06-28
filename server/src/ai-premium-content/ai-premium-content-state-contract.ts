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

export const AI_PREMIUM_CONTENT_CREATE_STATUS_API_STATUSES = [
  'pending',
  'safety_review',
  'blocked',
  'queued',
  'generating',
  'ready',
  'failed',
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

export const AI_PREMIUM_CONTENT_ROUTING_STATUSES = [
  'not_routed',
  'route_selected',
  'queued',
  'provider_blocked',
  'provider_failed',
] as const;

export const AI_PREMIUM_CONTENT_RESULT_STATUSES = [
  'not_ready',
  'awaiting_review',
  'approved',
  'blocked',
  'failed',
  'archived',
] as const;

export const AI_PREMIUM_CONTENT_PROVIDER_ADAPTER_KEYS = [
  'image_generation_primary',
  'image_generation_diffusion',
  'video_generation_primary',
  'mixed_generation_pack',
] as const;

export const AI_PREMIUM_CONTENT_SAFETY_PRECHECK_STATUSES = [
  'safe',
  'review_required',
  'blocked',
] as const;

export const AI_PREMIUM_CONTENT_SAFETY_PRECHECK_RISK_CATEGORIES = [
  'minor',
  'real_person_similarity',
  'sexual_content',
  'copyright',
  'platform_policy',
] as const;

type AiPremiumContentSafetyPrecheckStatus =
  (typeof AI_PREMIUM_CONTENT_SAFETY_PRECHECK_STATUSES)[number];

type AiPremiumContentSafetyRiskCategory =
  (typeof AI_PREMIUM_CONTENT_SAFETY_PRECHECK_RISK_CATEGORIES)[number];

type AiPremiumContentSafetyPrecheckInput = {
  minorRisk?: boolean | null;
  realPersonSimilarityRisk?: boolean | null;
  sexualContentRisk?: boolean | null;
  copyrightRisk?: boolean | null;
  platformPolicyRisk?: boolean | null;
};

const safetyPrecheckRisk = (
  category: AiPremiumContentSafetyRiskCategory,
  severity: AiPremiumContentSafetyPrecheckStatus,
  messageKey: string,
) => ({
  category,
  severity,
  messageKey,
  providerCallBeforeDecision: false,
});

export const AI_PREMIUM_CONTENT_SAFETY_PRECHECK_CONTRACT = {
  version: '2026-06-08.ai-premium-content-safety-precheck.v1',
  method: 'POST',
  path: '/api/v1/ai-premium-content/requests/safety-precheck',
  enabled: false,
  submitEnabled: false,
  mutation: false,
  providerCallEnabled: false,
  authRequired: true,
  artistOperatorRequired: true,
  allowedStatuses: AI_PREMIUM_CONTENT_SAFETY_PRECHECK_STATUSES,
  riskCategories: AI_PREMIUM_CONTENT_SAFETY_PRECHECK_RISK_CATEGORIES,
  decisionOrder: [
    'minor',
    'sexual_content',
    'platform_policy',
    'real_person_similarity',
    'copyright',
    'safe',
  ],
  statusDecision: {
    safe: {
      providerCallAllowedAfterPrecheck: false,
      requiresHumanReview: false,
      messageKey: 'aiPremiumContent.safetyPrecheck.safe',
    },
    review_required: {
      providerCallAllowedAfterPrecheck: false,
      requiresHumanReview: true,
      messageKey: 'aiPremiumContent.safetyPrecheck.reviewRequired',
    },
    blocked: {
      providerCallAllowedAfterPrecheck: false,
      requiresHumanReview: false,
      messageKey: 'aiPremiumContent.safetyPrecheck.blocked',
    },
  },
  riskPolicy: {
    minor: {
      status: 'blocked',
      messageKey: 'aiPremiumContent.safetyPrecheck.minorBlocked',
    },
    sexual_content: {
      status: 'blocked',
      messageKey: 'aiPremiumContent.safetyPrecheck.sexualBlocked',
    },
    platform_policy: {
      status: 'blocked',
      messageKey: 'aiPremiumContent.safetyPrecheck.platformBlocked',
    },
    real_person_similarity: {
      status: 'review_required',
      messageKey: 'aiPremiumContent.safetyPrecheck.realPersonReviewRequired',
    },
    copyright: {
      status: 'review_required',
      messageKey: 'aiPremiumContent.safetyPrecheck.copyrightReviewRequired',
    },
  },
  responseProjection: {
    status: '<safe|review_required|blocked>',
    code: '<stable safety precheck code>',
    messageKey: '<stable localized message key>',
    risks: ['<safe risk projection only>'],
    providerCallEnabled: false,
    walletMutationEnabled: false,
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
    riskCategories: AI_PREMIUM_CONTENT_SAFETY_PRECHECK_RISK_CATEGORIES,
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
    noMutation: {
      providerCall: true,
      walletDebit: true,
      orderCreate: true,
      settlementAccrual: true,
      payoutAccrual: true,
    },
  },
  privacy: {
    rawPromptReturned: false,
    referenceAssetBytesReturned: false,
    providerPayloadReturned: false,
    realPersonIdentityGuessReturned: false,
    tokenReturned: false,
    cookieReturned: false,
  },
  noMutation: {
    providerAttempt: true,
    imageGeneration: true,
    videoGeneration: true,
    walletDebit: true,
    orderCreate: true,
    settlementAccrual: true,
    payoutAccrual: true,
    paidLike: true,
  },
} as const;

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

export const CHARACTER_CHAT_AI_PREMIUM_CONTENT_HANDOFF_CONTRACT = {
  version: '2026-06-15.character-chat-ai-premium-content-handoff.v1',
  feature: 'character_chat_ai_premium_content_request_handoff',
  status: 'contract_ready_submit_blocked',
  sourceSurface: 'character_chat',
  enabled: false,
  submitEnabled: false,
  mutation: false,
  providerCallEnabled: false,
  walletMutationEnabled: false,
  orderMutationEnabled: false,
  settlementMutationEnabled: false,
  payoutMutationEnabled: false,
  paidLikeMutationEnabled: false,
  sourceProductFlow: {
    productKind: 'ai_character_chat',
    responseMode: 'ai_character_reply',
    normalTextMessageContinuesCharacterChat: true,
    createsPremiumChatRoom: false,
    createsArtistDirectDm: false,
  },
  targetProductFlow: {
    productKind: 'ai_premium_content_request',
    responseMode: 'async_ai_content_generation_request',
    requestTypes: AI_PREMIUM_CONTENT_REQUEST_TYPES,
    targetEndpoint: '/api/v1/ai-premium-content/requests',
    targetQueue: 'ai_premium_content_requests',
    currentStorageEnabled: false,
    currentSubmitEnabled: false,
  },
  productFlowSeparation: {
    characterChat: {
      productKind: 'ai_character_chat',
      responseMode: 'ai_character_reply',
      ownsNormalTextReply: true,
      ownsStarterPrompts: true,
      ownsOpeningGreeting: true,
      createsAiPremiumContentRequest: false,
      createsPremiumDmRoom: false,
    },
    premiumDirectDm: {
      productKind: 'artist_direct_premium_dm',
      responseMode: 'artist_direct_reply',
      ownsArtistReply: true,
      createsCharacterChatMessage: false,
      createsAiPremiumContentRequest: false,
    },
    aiPremiumContent: {
      productKind: 'ai_premium_content_request',
      responseMode: 'async_ai_content_generation_request',
      ownsImageVideoGenerationRequest: true,
      createsCharacterChatAiReply: false,
      createsPremiumDmRoom: false,
    },
  },
  adapterShape: {
    adapterOnly: true,
    sourceMessageIdReferenceOnly: true,
    artistSlugSource: 'character_chat_session.artist_slug',
    requestTypeSource: 'server_classified_content_intent',
    briefSource: 'sanitized_user_intent_summary',
    maxBriefChars: 1000,
    rawChatTranscriptCopied: false,
    rawUserPromptAsProviderPrompt: false,
    rawProviderPayloadCopied: false,
    providerSpecificModelKeyAccepted: false,
  },
  validationOrder: [
    'auth_required',
    'character_chat_session_exists_and_owned',
    'artist_slug_resolved',
    'content_intent_classified',
    'request_type_valid_for_ai_premium_content',
    'sanitized_brief_built',
    'safety_precheck_pending',
    'submit_gate_closed',
  ],
  responseProjection: {
    mode: 'readiness_only',
    ctaKey: 'characterChat.aiPremiumContent.request',
    disabledReasonKey: 'aiPremiumContent.characterChatHandoff.submitBlocked',
    rawIntentEnumAsCopy: false,
    rawRequestTypeAsCopy: false,
    providerNameReturned: false,
    modelNameReturned: false,
  },
  forbiddenSideEffects: {
    characterChatMessageCreate: false,
    premiumChatRoomCreate: false,
    aiPremiumContentRequestCreate: false,
    providerAttempt: false,
    openAiCall: false,
    gptImageCall: false,
    stableDiffusionCall: false,
    seedanceCall: false,
    walletDebit: false,
    orderCreate: false,
    settlementAccrual: false,
    payoutAccrual: false,
    paidLike: false,
    notificationCreate: false,
  },
  privacy: {
    rawChatTranscriptReturned: false,
    rawProviderPayloadReturned: false,
    rawPromptReturned: false,
    signedUrlsReturned: false,
    sensitiveAuthMaterialReturned: false,
    databaseConnectionMaterialReturned: false,
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

export const AI_PREMIUM_CONTENT_COST_WALLET_PRECHECK_POLICY = {
  costCapGuard: {
    capSource: 'server_route_cost_policy',
    providerQuoteTrusted: false,
    clientSubmittedCapTrusted: false,
    providerCallBeforeCapCheck: false,
    walletMutationBeforeCapCheck: false,
    overCapBehavior:
      'stable_precheck_denial_without_provider_call_or_wallet_mutation',
  },
  walletPrecheck: {
    balanceSource: 'wallet_accounts.cached_balance',
    requiredAmountSource: 'server_price_policy',
    clientSubmittedBalanceTrusted: false,
    providerCallBeforeWalletPrecheck: false,
    walletDebitOnPrecheck: false,
    insufficientBalanceBehavior:
      'stable_precheck_denial_without_provider_call_or_wallet_mutation',
  },
} as const;

export const AI_PREMIUM_CONTENT_COST_RETRY_READ_MODEL_SKELETON = {
  version: '2026-06-18.ai-premium-content-cost-retry-read-model.v1',
  feature: 'ai_premium_content_cost_retry_read_model',
  status: 'read_model_contract_only',
  enabled: false,
  mutationEnabled: false,
  providerCallEnabled: false,
  walletMutationEnabled: false,
  orderMutationEnabled: false,
  settlementMutationEnabled: false,
  payoutMutationEnabled: false,
  paidLikeMutationEnabled: false,
  sourceLedger: {
    table: 'future_ai_premium_content_request_events',
    eventFamily: 'ai_premium_content_generation_pipeline',
    providerSpecificTableRequired: false,
    rawProviderPayloadStoredInReadModel: false,
  },
  providerAgnosticFields: {
    requestType: AI_PREMIUM_CONTENT_REQUEST_TYPES,
    outputClass: AI_PREMIUM_CONTENT_OUTPUT_CLASSES,
    artistContextKey: '<server resolved safe artist context key>',
    providerRouteAlias: '<server capability route alias>',
    modelRouteClass: '<server capability class>',
    providerNameReturned: false,
    modelNameReturned: false,
    providerCredentialReturned: false,
  },
  costFields: {
    estimateSource: 'server_policy_estimate_not_provider_quote',
    estimatedCostUnits: 'integer policy units',
    estimatedCostCurrency: 'KRW_MICROS',
    requestCostCapMicros: 'server-owned optional integer cap',
    finalProviderCostReturned: false,
    walletLedgerIdReturned: false,
  },
  failureAndRetryFields: {
    failureCount: 'server-owned non-negative integer',
    retryCount: 'server-owned non-negative integer',
    lastFailureClass: [
      'none',
      'safety_blocked',
      'provider_timeout',
      'provider_rate_limited',
      'provider_generation_failed',
      'asset_upload_failed',
      'moderation_failed',
    ],
    safetyStatus: AI_PREMIUM_CONTENT_SAFETY_STATUSES,
    costPrecheckStatus: ['not_required', 'pending', 'passed', 'denied'],
    resultAssetStatus: ['none', 'pending', 'processing', 'ready', 'failed', 'blocked'],
  },
  retryPolicy: {
    maxRetryCountSource: 'server_policy',
    retryCountServerOwned: true,
    retryRequiresFreshSafetyAndCostCheck: true,
    retryAfterSafetyBlocked: false,
    providerRouteMayChangeByServer: true,
    clientCanForceRetry: false,
  },
  projection: {
    requestId: '<request uuid>',
    requestType: '<stable request type>',
    outputClass: '<image|video|mixed>',
    providerRouteAlias: '<server route alias only>',
    modelRouteClass: '<server capability class>',
    estimatedCost: {
      currency: 'KRW_MICROS',
      units: '<integer server estimate>',
      estimateSource: 'server_policy_estimate_not_provider_quote',
    },
    failureCount: '<integer>',
    retryCount: '<integer>',
    lastFailureClass: '<stable failure class>',
    resultAssetStatus: '<stable result asset status>',
  },
  forbiddenSideEffects: {
    providerCall: false,
    imageGeneration: false,
    videoGeneration: false,
    walletDebit: false,
    walletCredit: false,
    orderCreate: false,
    settlementAccrual: false,
    payoutAccrual: false,
    paidLike: false,
  },
  sensitiveDataPolicy: {
    providerCredentialReturned: false,
    providerSpecificModelNameReturned: false,
    rawPromptReturned: false,
    rawProviderPayloadReturned: false,
    rawProviderErrorReturned: false,
    signedUrlReturned: false,
    storageKeyReturned: false,
    tokenReturned: false,
    cookieReturned: false,
  },
} as const;

export const AI_PREMIUM_CONTENT_COST_ESTIMATE_PROJECTION_CONTRACT = {
  version: '2026-06-25.ai-content-cost-estimate-projection.v1',
  feature: 'ai_premium_content_cost_estimate_projection',
  status: 'read_model_contract_only',
  enabled: false,
  readOnly: true,
  providerAgnostic: true,
  providerCallEnabled: false,
  paymentMutationEnabled: false,
  walletMutationEnabled: false,
  orderMutationEnabled: false,
  settlementMutationEnabled: false,
  payoutMutationEnabled: false,
  sourceOfTruth: {
    requestTypePolicy: 'AI_PREMIUM_CONTENT_REQUEST_TYPE_POLICY',
    modelRouteSource: 'server_capability_route_alias',
    costSource: 'server_policy_estimate_not_provider_quote',
    paidStateSource: 'server_product_policy_and_wallet_precheck_projection',
    videoConsentSource: 'explicit_user_video_addon_consent_projection',
    clientSubmittedCostTrusted: false,
    providerQuoteTrusted: false,
  },
  projectionFields: [
    'requestType',
    'outputClass',
    'modelRouteClass',
    'providerRouteAlias',
    'estimateSource',
    'estimatedCostMicros',
    'paidRequest',
    'requiredLumina',
    'videoConsentStateKey',
    'ctaMessageKey',
  ],
  freePaidPolicy: {
    freeImageRequestAllowed: true,
    videoOrMixedRequiresPaidRequest: true,
    requiredLuminaSource: 'server_product_policy',
    clientSubmittedRequiredLuminaTrusted: false,
    walletDebitOnEstimate: false,
  },
  videoConsentPolicy: {
    appliesToOutputClasses: ['video', 'mixed'],
    requiredBeforeGeneration: true,
    consentStateKeys: [
      'video_consent_not_required',
      'video_consent_required',
      'video_consent_accepted',
      'video_consent_declined',
    ],
    rawConsentTextReturned: false,
    providerCallBeforeConsent: false,
  },
  routeProjection: {
    requestTypes: AI_PREMIUM_CONTENT_REQUEST_TYPES,
    outputClasses: AI_PREMIUM_CONTENT_OUTPUT_CLASSES,
    providerRouteAliasPrefix: 'ai_premium_content.',
    providerSpecificNameReturned: false,
    modelSpecificNameReturned: false,
    providerPayloadReturned: false,
  },
  noMutationPolicy: {
    providerCall: false,
    imageGeneration: false,
    videoGeneration: false,
    payment: false,
    walletDebit: false,
    orderCreate: false,
    settlement: false,
    payout: false,
  },
} as const;

export const AI_PREMIUM_CONTENT_COST_USAGE_AUDIT_PROJECTION = {
  version: '2026-06-23.ai-content-cost-usage-audit-projection.v1',
  feature: 'ai_premium_content_cost_usage_audit_projection',
  status: 'read_model_contract_only',
  enabled: false,
  readOnly: true,
  providerAgnostic: true,
  mutationEnabled: false,
  providerCallEnabled: false,
  paymentMutationEnabled: false,
  walletMutationEnabled: false,
  orderMutationEnabled: false,
  settlementMutationEnabled: false,
  payoutMutationEnabled: false,
  paidLikeMutationEnabled: false,
  supportedProviderFamilies: [
    'gpt_image',
    'stable_diffusion',
    'seedance',
    'provider_alias',
  ],
  sourceOfTruth: {
    requestEventTable: 'future_ai_premium_content_request_events',
    usageEventTable: 'future_ai_premium_content_usage_events',
    providerRouteSource: 'server_capability_route_alias',
    requestCostSource: 'server_policy_estimate_not_provider_quote',
    providerSpecificTableRequired: false,
    rawProviderPayloadStoredInProjection: false,
  },
  projectionFields: [
    'requestId',
    'requestType',
    'outputClass',
    'providerRouteAlias',
    'modelRouteClass',
    'estimatedCostMicros',
    'costCurrency',
    'attemptCount',
    'failureCount',
    'failureRateBps',
    'lastFailureCodeKey',
    'regenerationCount',
    'createdAt',
    'updatedAt',
  ],
  modelUsage: {
    providerRouteAlias: '<server route alias only>',
    modelRouteClass: '<server capability class>',
    requestType: AI_PREMIUM_CONTENT_REQUEST_TYPES,
    outputClass: AI_PREMIUM_CONTENT_OUTPUT_CLASSES,
    providerKeyReturned: false,
    modelKeyReturned: false,
    rawProviderPayloadReturned: false,
  },
  estimatedCost: {
    currency: 'KRW_MICROS',
    amountMicros: '<integer server estimate>',
    estimateSource: 'server_policy_estimate_not_provider_quote',
    providerQuoteTrusted: false,
    providerCostReturned: false,
    walletDebit: false,
    walletCredit: false,
  },
  failureStats: {
    attemptCount: '<server-owned non-negative integer>',
    failureCount: '<server-owned non-negative integer>',
    failureRateBps: '<server-owned integer basis points>',
    lastFailureCodeKey: '<stable internal-safe failure key>',
    rawProviderErrorReturned: false,
    providerPayloadReturned: false,
  },
  regenerationStats: {
    regenerationCount: '<server-owned non-negative integer>',
    maxRegenerationCountSource: 'server_policy',
    providerCallOnRead: false,
    walletMutationOnRead: false,
    clientCanIncreaseCounter: false,
  },
  mutationGates: {
    liveProviderCall: false,
    paymentCreate: false,
    walletDebit: false,
    walletCredit: false,
    orderCreate: false,
    settlementAccrual: false,
    payoutAccrual: false,
    paidLike: false,
  },
  privacy: {
    rawProviderPayloadReturned: false,
    providerCredentialReturned: false,
    rawPromptReturned: false,
    rawReferenceAssetReturned: false,
    rawProviderErrorReturned: false,
    signedUrlReturned: false,
    storageKeyReturned: false,
    tokenReturned: false,
    cookieReturned: false,
    envValueReturned: false,
  },
} as const;

export const AI_PREMIUM_CONTENT_REQUEST_QUEUE_SKELETON = {
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
  currentBridge: {
    imageQueue: 'creator_image_requests',
    videoSource: 'premium_video_products_unlock_catalog_only',
    futureUnifiedTable: 'ai_premium_content_requests',
    currentLiveMutationChangedByThisContract: false,
  },
  normalizedFields: {
    requestType: {
      allowed: AI_PREMIUM_CONTENT_REQUEST_TYPES,
      providerSpecificTypeTrusted: false,
    },
    artistSlug: {
      required: true,
      serverResolvedArtistId: true,
    },
    outputClass: {
      allowed: AI_PREMIUM_CONTENT_OUTPUT_CLASSES,
      derivedFromRequestType: true,
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
    regenerationCount: {
      serverOwned: true,
      initial: 0,
    },
  },
  queueItemProjection: {
    id: '<server queue request id>',
    requestType: '<image_single|image_variation|image_reference|video_clip|video_loop|premium_pack>',
    artistSlug: '<artist slug>',
    artistId: '<server resolved artist id>',
    outputClass: '<image|video|mixed>',
    status: 'draft',
    safetyStatus: 'pending',
    estimatedCost: {
      currency: 'KRW_MICROS',
      amountMicros: '<server policy ceiling or null>',
      final: false,
    },
    providerRouteAlias: '<server provider route alias>',
    providerCallEnabled: false,
  },
  lifecycle: {
    intake: 'create_disabled_until_backend_storage_opens',
    precheck: 'server_policy_only_without_provider_quote',
    queue: 'disabled_skeleton_only',
    providerAttempt: 'blocked_until_provider_router_is_explicitly_enabled',
    review: 'human_review_required_before_public_use',
  },
  middlewarePipelineLedger: {
    version: '2026-06-17.ai-premium-content-middleware-routing-ledger.v1',
    table: 'future_ai_premium_content_request_events',
    mutationEnabled: false,
    providerCallEnabled: false,
    walletMutationEnabled: false,
    requestTypes: AI_PREMIUM_CONTENT_REQUEST_TYPES,
    trackedFields: [
      'requestType',
      'artistContext',
      'providerRouteAlias',
      'safetyStatus',
      'estimatedCost',
      'retryCount',
      'resultAssetStatus',
    ],
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
  },
  costRetryReadModel: AI_PREMIUM_CONTENT_COST_RETRY_READ_MODEL_SKELETON,
  forbiddenSideEffects: {
    liveProviderCall: false,
    queueRowCreate: false,
    walletDebit: false,
    orderCreate: false,
    settlementAccrual: false,
    payoutAccrual: false,
    paidLike: false,
    publicPublish: false,
    profileOrFeedEquip: false,
  },
  sensitiveDataPolicy: {
    vendorProviderKeyReturned: false,
    vendorModelKeyReturned: false,
    rawProviderPayloadReturned: false,
    rawPromptReturned: false,
    signedUrlsReturned: false,
    sensitiveAuthMaterialReturned: false,
    databaseConnectionMaterialReturned: false,
  },
} as const;

export const AI_PREMIUM_CONTENT_CREATE_STATUS_API_SKELETON = {
  version: '2026-06-15.ai-premium-content-create-status-api-skeleton.v1',
  feature: 'ai_premium_content_create_status_api',
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
  acceptedRequestTypes: AI_PREMIUM_CONTENT_REQUEST_TYPES,
  canonicalStatuses: AI_PREMIUM_CONTENT_CREATE_STATUS_API_STATUSES,
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
    referenceAssetIds: {
      optional: true,
      serverOwnedSafetyCheck: true,
      signedUrlReturned: false,
    },
  },
  serverOwnedFields: {
    requestId: true,
    requestType: true,
    artistSlug: true,
    userIntentSummary: true,
    safetyStatus: AI_PREMIUM_CONTENT_SAFETY_STATUSES,
    routingStatus: AI_PREMIUM_CONTENT_ROUTING_STATUSES,
    resultStatus: AI_PREMIUM_CONTENT_RESULT_STATUSES,
    providerRouteAlias: {
      source: 'server_capability_alias',
      allowedPrefix: 'ai_premium_content.',
      vendorProviderKeyReturned: false,
      vendorModelKeyReturned: false,
    },
    estimatedCost: {
      currency: 'KRW_MICROS',
      source: 'server_policy_estimate_not_provider_quote',
      amountTrustedFromClient: false,
      walletDebitOnCreate: false,
    },
  },
  statusProjection: {
    status: AI_PREMIUM_CONTENT_CREATE_STATUS_API_STATUSES,
    statusMessageKey: '<stable localized message key>',
    rawStatusAsCopy: false,
    rawProviderStatusReturned: false,
    safetyStatus: AI_PREMIUM_CONTENT_SAFETY_STATUSES,
    routingStatus: AI_PREMIUM_CONTENT_ROUTING_STATUSES,
    resultStatus: AI_PREMIUM_CONTENT_RESULT_STATUSES,
    providerRouteAlias: '<server route alias only>',
    estimatedCost: {
      currency: 'KRW_MICROS',
      estimatedCostCeilingMicros: '<integer policy ceiling>',
      final: false,
    },
    result: {
      assetIds: [],
      publicUrlsReturnedBeforeReview: false,
      signedUrlsReturned: false,
    },
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
  noSideEffects: {
    providerCall: true,
    imageGeneration: true,
    videoGeneration: true,
    roomOpen: true,
    walletDebit: true,
    orderCreate: true,
    settlementAccrual: true,
    payoutAccrual: true,
    paidLike: true,
    profileEquip: true,
    feedPublish: true,
  },
  privacy: {
    rawPromptReturned: false,
    rawProviderPayloadReturned: false,
    vendorProviderKeyReturned: false,
    vendorModelKeyReturned: false,
    signedUrlsReturned: false,
    sensitiveAuthMaterialReturned: false,
    privateConnectionMaterialReturned: false,
    rawEmailReturned: false,
  },
} as const;

export const AI_PREMIUM_CONTENT_QUEUE_READ_MODEL_CONTRACT = {
  version: '2026-06-28.ai-premium-content-queue-read-model.v1',
  status: 'read_model_contract_only_mutation_disabled',
  endpoints: {
    userQueue: {
      method: 'GET',
      path: '/api/v1/ai-premium-content/me/requests',
      enabled: false,
      authRequired: true,
      ownerUserOnly: true,
    },
    requestDetail: {
      method: 'GET',
      path: '/api/v1/ai-premium-content/me/requests/:requestId',
      enabled: false,
      authRequired: true,
      ownerUserOnly: true,
    },
  },
  exposedFields: [
    'requestId',
    'requestType',
    'outputClass',
    'status',
    'safetyStatus',
    'moderationStatus',
    'reuseStatus',
    'estimatedCost.amountMicros',
    'estimatedCost.currency',
    'estimatedCost.final',
    'artist.slug',
    'artist.displayName',
    'createdAt',
    'updatedAt',
  ],
  costProjection: {
    source: 'server_policy_estimate_not_provider_quote',
    finalCostReturnedOnlyAfterServerDecision: true,
    internalCostBreakdownReturned: false,
    providerQuoteTrusted: false,
    walletMutationEnabled: false,
  },
  safetyProjection: {
    statuses: AI_PREMIUM_CONTENT_SAFETY_STATUSES,
    moderationStatuses: AI_PREMIUM_CONTENT_MODERATION_STATUSES,
    rawSafetyPayloadReturned: false,
    rawPromptReturned: false,
    providerCallOnRead: false,
  },
  reuseProjection: {
    statuses: ['not_checked', 'candidate', 'reused', 'not_reusable'],
    resultAssetReuseAllowedWhenSafe: true,
    signedUrlReturned: false,
    storageKeyReturned: false,
  },
  privacy: {
    rawPromptReturned: false,
    providerPayloadReturned: false,
    providerCredentialReturned: false,
    apiKeyReturned: false,
    internalCostBreakdownReturned: false,
    rawReferenceAssetReturned: false,
    rawUserEmailReturned: false,
  },
  noMutation: {
    requestCreate: true,
    queueWrite: true,
    providerCall: true,
    imageGenerationCall: true,
    videoGenerationCall: true,
    walletMutation: true,
    orderMutation: true,
    settlement: true,
    payout: true,
    paidLike: true,
  },
} as const;

export const AI_PREMIUM_CONTENT_MODEL_ROUTING_API_SKELETON = {
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
    requestType: AI_PREMIUM_CONTENT_REQUEST_TYPES,
    artistContext: {
      artistSlugRequired: true,
      serverResolvedArtistId: true,
      clientSubmittedArtistIdTrusted: false,
      personaContextSource: 'approved_artist_profile_projection',
    },
    safetyState: {
      allowed: AI_PREMIUM_CONTENT_SAFETY_STATUSES,
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
    selectedAdapterKeys: AI_PREMIUM_CONTENT_PROVIDER_ADAPTER_KEYS,
    selectedModelKeyReturned: false,
    vendorModelKeyReturned: false,
    providerPayloadReturned: false,
  },
  validationOrder: [
    'require_auth',
    'require_artist_operator',
    'validate_request_type',
    'resolve_artist_context',
    'load_server_safety_state',
    'check_server_cost_policy',
    'select_route_alias_without_provider_call',
    'return_routing_projection_without_mutation',
  ],
  noMutationPolicy: {
    gptImageCall: false,
    stableDiffusionCall: false,
    seedanceCall: false,
    openAiProviderCall: false,
    providerCall: false,
    queueCreate: false,
    requestCreate: false,
    walletDebit: false,
    luminaDebit: false,
    paymentOrderCreate: false,
    settlementMutation: false,
    payoutMutation: false,
  },
  privacy: {
    rawPromptReturned: false,
    rawProviderPayloadReturned: false,
    rawSafetyPayloadReturned: false,
    providerSecretReturned: false,
    vendorModelIdentifierReturned: false,
  },
} as const;

export const AI_PREMIUM_CONTENT_MIDDLEWARE_ROUTING_SKELETON = {
  version: '2026-06-23.ai-content-middleware-routing-skeleton.v1',
  status: 'skeleton_ready_mutation_blocked',
  pipelineName: 'ai_middleware_pipeline',
  enabled: false,
  providerAgnostic: true,
  acceptedRequestTypes: AI_PREMIUM_CONTENT_REQUEST_TYPES,
  outputClasses: AI_PREMIUM_CONTENT_OUTPUT_CLASSES,
  routingInputs: {
    requestType: {
      source: 'client_request_validated_against_server_allowlist',
      clientSubmittedTrustedAfterValidation: false,
    },
    characterContext: {
      source: 'server_resolved_character_or_artist_context',
      rawPromptReturned: false,
      providerPayloadReturned: false,
    },
    safetyState: {
      source: 'server_safety_precheck_projection',
      allowedStatuses: AI_PREMIUM_CONTENT_SAFETY_STATUSES,
      providerCallBeforeSafetyClear: false,
    },
    costControl: {
      source: 'server_cost_policy_and_budget_guard',
      clientSubmittedCostTrusted: false,
      providerQuoteTrusted: false,
      walletDebitBeforeFinalApproval: false,
    },
    resultStorage: {
      stateSource: 'ai_premium_content_request_result_projection',
      rawProviderUrlReturned: false,
      signedUrlReturned: false,
      publicAssetProxyRequired: true,
    },
  },
  routeMap: {
    image_single: {
      outputClass: 'image',
      routeAlias: 'ai_premium_content.image.text_to_image',
      capability: 'text_to_image',
    },
    image_variation: {
      outputClass: 'image',
      routeAlias: 'ai_premium_content.image.image_to_image',
      capability: 'image_to_image',
    },
    image_reference: {
      outputClass: 'image',
      routeAlias: 'ai_premium_content.image.reference_pack',
      capability: 'text_to_image',
    },
    video_clip: {
      outputClass: 'video',
      routeAlias: 'ai_premium_content.video.text_to_video',
      capability: 'text_to_video',
      requiresExplicitVideoConsent: true,
    },
    video_loop: {
      outputClass: 'video',
      routeAlias: 'ai_premium_content.video.image_to_video',
      capability: 'image_to_video',
      requiresExplicitVideoConsent: true,
    },
    premium_pack: {
      outputClass: 'mixed',
      routeAlias: 'ai_premium_content.mixed.generation_pack',
      capability: 'mixed_generation_pack',
      requiresExplicitVideoConsentWhenVideoIncluded: true,
    },
  },
  validationOrder: [
    'require_authenticated_request_owner_or_artist_operator',
    'validate_request_type_against_server_allowlist',
    'resolve_character_or_artist_context_on_server',
    'run_safety_precheck_without_provider_call',
    'run_cost_precheck_without_wallet_mutation',
    'select_provider_agnostic_route_alias',
    'create_or_project_request_state_without_provider_call',
    'return_skeleton_projection_without_payment_or_wallet_mutation',
  ],
  failureResponses: {
    invalidRequestType: {
      status: 400,
      code: 'AI_CONTENT_REQUEST_TYPE_INVALID',
      messageKey: 'aiPremiumContent.error.invalidRequestType',
    },
    safetyBlocked: {
      status: 409,
      code: 'AI_CONTENT_SAFETY_BLOCKED',
      messageKey: 'aiPremiumContent.error.safetyBlocked',
    },
    costBlocked: {
      status: 409,
      code: 'AI_CONTENT_COST_BLOCKED',
      messageKey: 'aiPremiumContent.error.costBlocked',
    },
    videoConsentRequired: {
      status: 409,
      code: 'AI_CONTENT_VIDEO_CONSENT_REQUIRED',
      messageKey: 'aiPremiumContent.error.videoConsentRequired',
    },
  },
  noMutationPolicy: {
    providerCall: false,
    gptImageCall: false,
    stableDiffusionCall: false,
    seedanceCall: false,
    openAiCall: false,
    walletDebit: false,
    walletCredit: false,
    paymentOrderCreate: false,
    settlementMutation: false,
    payoutMutation: false,
    publicFeedPublish: false,
    profileEquip: false,
  },
  privacy: {
    rawPromptReturned: false,
    rawProviderPayloadReturned: false,
    providerSecretReturned: false,
    vendorModelIdentifierReturned: false,
    safetyPayloadReturned: false,
    internalCostReturned: false,
    providerCostReturned: false,
    tokenCookieSecretDbUrlLogged: false,
  },
} as const;

export const AI_PREMIUM_CONTENT_STATUS_PREVIEW_FIXTURE_CONTRACT = {
  version: '2026-06-16.ai-premium-content-status-preview-fixture.v1',
  feature: 'ai_premium_content_status_preview_fixture',
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
  fixtureStates: [
    {
      key: 'reviewing',
      requestStatus: 'awaiting_review',
      displayStatus: 'reviewing',
      labelKo: '검수 중',
      messageKey: 'aiPremiumContent.preview.reviewing',
      rawEnumAsCopy: false,
    },
    {
      key: 'generating',
      requestStatus: 'generating',
      displayStatus: 'generating',
      labelKo: '제작 중',
      messageKey: 'aiPremiumContent.preview.generating',
      rawEnumAsCopy: false,
    },
    {
      key: 'completed',
      requestStatus: 'approved',
      resultStatus: 'approved',
      displayStatus: 'completed',
      labelKo: '완료',
      messageKey: 'aiPremiumContent.preview.completed',
      rawEnumAsCopy: false,
    },
    {
      key: 'blocked',
      requestStatus: 'safety_blocked',
      resultStatus: 'blocked',
      displayStatus: 'blocked',
      labelKo: '차단',
      messageKey: 'aiPremiumContent.preview.blocked',
      rawEnumAsCopy: false,
    },
    {
      key: 'failed',
      requestStatus: 'provider_failed',
      resultStatus: 'failed',
      displayStatus: 'failed',
      labelKo: '실패',
      messageKey: 'aiPremiumContent.preview.failed',
      rawEnumAsCopy: false,
    },
    {
      key: 'regeneratable',
      requestStatus: 'provider_failed',
      resultStatus: 'failed',
      displayStatus: 'regeneratable',
      labelKo: '재생성 가능',
      messageKey: 'aiPremiumContent.preview.regeneratable',
      regenerateCtaEnabled: false,
      rawEnumAsCopy: false,
    },
  ],
  responseProjection: {
    previewOnly: true,
    itemsAlwaysArray: true,
    statusSheetSurface: 'qa_status_preview',
    locale: 'ko-KR',
    rawStatusAsCopy: false,
    rawEnumAsCopy: false,
    rawProviderStatusReturned: false,
    providerPayloadReturned: false,
    signedUrlsReturned: false,
    rawPromptReturned: false,
  },
  noSideEffects: {
    requestCreate: true,
    providerCall: true,
    imageGeneration: true,
    videoGeneration: true,
    walletDebit: true,
    orderCreate: true,
    settlementAccrual: true,
    payoutAccrual: true,
    paidLike: true,
    publicPublish: true,
  },
} as const;

export const AI_PREMIUM_CONTENT_VIDEO_CONSENT_EXCEPTION_CONTRACT = {
  version: '2026-06-22.ai-premium-content-video-consent-exception.v1',
  feature: 'ai_premium_content_video_consent_exception',
  status: 'contract_ready_submit_blocked',
  enabled: false,
  readOnly: true,
  mutation: false,
  providerCallEnabled: false,
  paymentMutationEnabled: false,
  walletMutationEnabled: false,
  settlementMutationEnabled: false,
  payoutMutationEnabled: false,
  scope: {
    appliesToOutputClasses: ['video', 'mixed'],
    doesNotApplyToOutputClasses: ['image'],
    existingTextAndImageFlowContinues: true,
    videoResultHiddenWhenConsentDeclined: true,
  },
  stateApi: {
    method: 'GET',
    pathTemplate:
      '/api/v1/ai-premium-content/requests/:requestId/video-consent-state',
    enabled: false,
    readOnly: true,
    ownerOnly: true,
    responseFields: [
      'requestId',
      'outputClass',
      'stateKey',
      'labelKo',
      'helperKo',
      'ctaKey',
      'videoResultVisible',
      'textResultVisible',
      'imageResultVisible',
      'requestContinues',
    ],
    rawEnumAsCopy: false,
    submitEndpointEnabled: false,
  },
  states: [
    {
      stateKey: 'video_consent_not_required',
      appliesToOutputClass: 'image',
      videoResultVisible: false,
      existingTextAndImageFlowContinues: true,
      ctaKey: 'aiPremiumContent.videoConsent.notRequired',
      labelKo: '영상 동의가 필요하지 않아요',
      rawEnumAsCopy: false,
    },
    {
      stateKey: 'video_consent_required',
      appliesToOutputClass: 'video',
      videoResultVisible: false,
      existingTextAndImageFlowContinues: true,
      ctaKey: 'aiPremiumContent.videoConsent.reviewCost',
      labelKo: '영상 제작 비용 동의가 필요해요',
      rawEnumAsCopy: false,
    },
    {
      stateKey: 'video_consent_accepted',
      appliesToOutputClass: 'video',
      videoResultVisible: true,
      existingTextAndImageFlowContinues: true,
      ctaKey: 'aiPremiumContent.videoConsent.accepted',
      labelKo: '영상 제작 비용 동의 완료',
      rawEnumAsCopy: false,
    },
    {
      stateKey: 'video_consent_declined',
      appliesToOutputClass: 'video',
      videoResultVisible: false,
      existingTextAndImageFlowContinues: true,
      ctaKey: 'aiPremiumContent.videoConsent.declined',
      labelKo: '영상 제작은 진행하지 않아요',
      helperKo:
        '영상 비용 동의를 거절해도 기존 텍스트와 이미지 흐름은 계속 확인할 수 있어요.',
      rawEnumAsCopy: false,
    },
  ],
  declinePolicy: {
    hidesVideoResult: true,
    deletesTextResult: false,
    deletesImageResult: false,
    cancelsWholeRequest: false,
    fallbackToImageOnlyAllowed: true,
    rawProviderFailureAsCopy: false,
  },
  copyPolicy: {
    locale: 'ko-KR',
    rawEnumAsCopy: false,
    rawProviderStatusAsCopy: false,
    neutralFallbackCopy: '확인 중',
    requiredFallbacks: {
      reviewCost: '영상 제작 비용을 확인해 주세요',
      accept: '동의하고 진행',
      decline: '영상 없이 계속',
      declined: '영상 제작은 진행하지 않아요',
    },
  },
  noSideEffects: {
    providerCall: true,
    videoGeneration: true,
    imageGeneration: true,
    requestMutation: true,
    paymentOrderCreate: true,
    walletDebit: true,
    settlementAccrual: true,
    payoutAccrual: true,
    paidLike: true,
    publicPublish: true,
  },
  privacy: {
    rawPromptReturned: false,
    providerPayloadReturned: false,
    safetyPayloadReturned: false,
    internalCostReturned: false,
    providerCostReturned: false,
    tokenCookieSecretDbUrlReturned: false,
  },
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
  requestCostCapMicros?: number | string | null;
  paidRequest?: boolean | null;
  walletBalanceLumina?: number | string | null;
  requiredLumina?: number | string | null;
};

type AiPremiumContentProviderGuardInput = {
  providerRouteAlias?: string | null;
  estimatedCostMicros?: number | string | null;
  requestCostCapMicros?: number | string | null;
  paidRequest?: boolean | null;
  safetyStatus?: string | null;
  attempt?: number | string | null;
  failureCode?: string | null;
};

export const AI_PREMIUM_CONTENT_PROVIDER_GUARD_CONTRACT = {
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
  providerRoutes: [
    {
      providerRouteAlias: 'ai_premium_content.image.text_to_image',
      costClass: 'standard',
      estimatedCostCeilingMicros: 5_000_000,
      paidRequestRequired: false,
    },
    {
      providerRouteAlias: 'ai_premium_content.video.text_to_video',
      costClass: 'high',
      estimatedCostCeilingMicros: 50_000_000,
      paidRequestRequired: true,
    },
    {
      providerRouteAlias: 'ai_premium_content.mixed.generation_pack',
      costClass: 'high',
      estimatedCostCeilingMicros: 70_000_000,
      paidRequestRequired: true,
    },
  ],
  timeoutPolicy: {
    providerTimeoutMs: 30_000,
    connectTimeoutMs: 5_000,
    timeoutStatusKey: 'provider_failed',
    timeoutCode: 'AI_PREMIUM_CONTENT_PROVIDER_TIMEOUT',
    timeoutBillable: false,
  },
  retryPolicy: {
    maxAttempts: 1,
    retryOn: ['provider_timeout', 'provider_transient_failure'],
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
  failureStatusMapping: {
    costCapExceeded: 'failed',
    timeout: 'failed',
    providerFailed: 'failed',
    safetyBlocked: 'blocked',
  },
  privacy: {
    providerPayloadReturned: false,
    providerKeyReturned: false,
    modelKeyReturned: false,
    rawPromptReturned: false,
  },
} as const;

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

const nonNegativeNumber = (value: number | string | null | undefined) => {
  const parsed =
    typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : typeof value === 'number'
        ? value
        : 0;

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
};

const isAiPremiumContentRequestType = (
  value: string | null | undefined,
): value is AiPremiumContentRequestType =>
  AI_PREMIUM_CONTENT_REQUEST_TYPES.includes(
    value as AiPremiumContentRequestType,
  );

const normalizeSafetyStatus = (value: string | null | undefined) =>
  AI_PREMIUM_CONTENT_SAFETY_STATUSES.includes(
    value as (typeof AI_PREMIUM_CONTENT_SAFETY_STATUSES)[number],
  )
    ? (value as (typeof AI_PREMIUM_CONTENT_SAFETY_STATUSES)[number])
    : 'unknown';

const deniedAiPremiumContentPrecheck = ({
  code,
  messageKey,
  httpStatus,
  requestType,
  artistSlug,
  regenerationCount,
  failureCount,
  outputClass = null,
  estimatedCost = null,
  walletPrecheck = null,
}: {
  code: string;
  messageKey: string;
  httpStatus: 400 | 403 | 409;
  requestType: string | null;
  artistSlug: string | null;
  regenerationCount: number;
  failureCount: number;
  outputClass?: AiPremiumContentOutputClass | null;
  estimatedCost?:
    | (typeof AI_PREMIUM_CONTENT_PRECHECK_COST_POLICY)[AiPremiumContentOutputClass]
    | null;
  walletPrecheck?: {
    paidRequest: boolean;
    requiredLumina: number;
    balanceChecked: boolean;
  } | null;
}) =>
  ({
    allowed: false,
    precheckOnly: true,
    code,
    messageKey,
    httpStatus,
    requestType,
    artistSlug,
    outputClass,
    modelRoutingCandidates: [],
    estimatedCost,
    costCapGuard: AI_PREMIUM_CONTENT_COST_WALLET_PRECHECK_POLICY.costCapGuard,
    walletPrecheck:
      walletPrecheck ??
      AI_PREMIUM_CONTENT_COST_WALLET_PRECHECK_POLICY.walletPrecheck,
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
    costCapGuard: AI_PREMIUM_CONTENT_COST_WALLET_PRECHECK_POLICY.costCapGuard,
    walletPrecheck: {
      ...AI_PREMIUM_CONTENT_COST_WALLET_PRECHECK_POLICY.walletPrecheck,
      paidRequest: false,
      requiredLumina: 0,
      balanceChecked: false,
    },
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
  const estimatedCost = AI_PREMIUM_CONTENT_PRECHECK_COST_POLICY[outputClass];
  const requestCostCapMicros = nonNegativeInteger(input.requestCostCapMicros);

  if (
    requestCostCapMicros > 0 &&
    estimatedCost.estimatedCostCeilingMicros > requestCostCapMicros
  ) {
    return deniedAiPremiumContentPrecheck({
      code: 'AI_PREMIUM_CONTENT_COST_CAP_EXCEEDED',
      messageKey: 'aiPremiumContent.precheck.costCapExceeded',
      httpStatus: 409,
      requestType,
      artistSlug,
      regenerationCount,
      failureCount,
      outputClass,
      estimatedCost,
    });
  }

  const paidRequest = input.paidRequest === true;
  const requiredLumina = nonNegativeNumber(input.requiredLumina);
  const walletBalanceLumina = nonNegativeNumber(input.walletBalanceLumina);

  if (paidRequest && requiredLumina > 0 && walletBalanceLumina < requiredLumina) {
    return deniedAiPremiumContentPrecheck({
      code: 'AI_PREMIUM_CONTENT_WALLET_PRECHECK_INSUFFICIENT',
      messageKey: 'aiPremiumContent.precheck.insufficientBalance',
      httpStatus: 409,
      requestType,
      artistSlug,
      regenerationCount,
      failureCount,
      outputClass,
      estimatedCost,
      walletPrecheck: {
        paidRequest: true,
        requiredLumina,
        balanceChecked: true,
      },
    });
  }

  return aiPremiumContentPrecheckSuccess({
    requestType,
    artistSlug,
    requestPolicy,
    outputClass,
    regenerationCount,
    failureCount,
  });
};

export const resolveAiPremiumContentProviderGuard = (
  input: AiPremiumContentProviderGuardInput,
) => {
  const route =
    AI_PREMIUM_CONTENT_PROVIDER_GUARD_CONTRACT.providerRoutes.find(
      (candidate) => candidate.providerRouteAlias === input.providerRouteAlias,
    ) ?? null;
  const estimatedCostMicros = nonNegativeInteger(input.estimatedCostMicros);
  const requestCostCapMicros = nonNegativeInteger(input.requestCostCapMicros);
  const attempt = nonNegativeInteger(input.attempt);
  const safetyStatus = normalizeSafetyStatus(input.safetyStatus);
  const failureCode = input.failureCode?.trim() || null;
  const costCapExceeded =
    requestCostCapMicros > 0 && estimatedCostMicros > requestCostCapMicros;
  const retryExhausted =
    attempt >= AI_PREMIUM_CONTENT_PROVIDER_GUARD_CONTRACT.retryPolicy.maxAttempts;

  if (safetyStatus === 'blocked') {
    return providerGuardDecision({
      allowed: false,
      code: 'AI_PREMIUM_CONTENT_SAFETY_BLOCKED',
      reasonKey: 'aiPremiumContent.providerGuard.safetyBlocked',
      statusKey:
        AI_PREMIUM_CONTENT_PROVIDER_GUARD_CONTRACT.failureStatusMapping
          .safetyBlocked,
      estimatedCostMicros,
      requestCostCapMicros,
      billable: false,
      retryAllowed: false,
    });
  }

  if (!route) {
    return providerGuardDecision({
      allowed: false,
      code: 'AI_PREMIUM_CONTENT_PROVIDER_ROUTE_INVALID',
      reasonKey: 'aiPremiumContent.providerGuard.invalidRoute',
      statusKey: 'failed',
      estimatedCostMicros,
      requestCostCapMicros,
      billable: false,
      retryAllowed: false,
    });
  }

  if (route.paidRequestRequired && input.paidRequest !== true) {
    return providerGuardDecision({
      allowed: false,
      code: 'AI_PREMIUM_CONTENT_PAID_REQUEST_REQUIRED',
      reasonKey: 'aiPremiumContent.providerGuard.paidRequestRequired',
      statusKey: 'failed',
      estimatedCostMicros,
      requestCostCapMicros,
      billable: false,
      retryAllowed: false,
    });
  }

  if (costCapExceeded) {
    return providerGuardDecision({
      allowed: false,
      code: 'AI_PREMIUM_CONTENT_COST_CAP_EXCEEDED',
      reasonKey: 'aiPremiumContent.providerGuard.costCapExceeded',
      statusKey:
        AI_PREMIUM_CONTENT_PROVIDER_GUARD_CONTRACT.failureStatusMapping
          .costCapExceeded,
      estimatedCostMicros,
      requestCostCapMicros,
      billable: false,
      retryAllowed: false,
    });
  }

  if (failureCode === 'provider_timeout' || failureCode === 'provider_failed') {
    return providerGuardDecision({
      allowed: false,
      code:
        failureCode === 'provider_timeout'
          ? AI_PREMIUM_CONTENT_PROVIDER_GUARD_CONTRACT.timeoutPolicy.timeoutCode
          : 'AI_PREMIUM_CONTENT_PROVIDER_FAILED',
      reasonKey: `aiPremiumContent.providerGuard.${failureCode}`,
      statusKey: 'failed',
      estimatedCostMicros,
      requestCostCapMicros,
      billable: false,
      retryAllowed:
        failureCode === 'provider_timeout' &&
        !retryExhausted &&
        AI_PREMIUM_CONTENT_PROVIDER_GUARD_CONTRACT.retryPolicy.retryOn.includes(
          failureCode,
        ),
    });
  }

  return providerGuardDecision({
    allowed: true,
    code: 'AI_PREMIUM_CONTENT_PROVIDER_ATTEMPT_ALLOWED',
    reasonKey: 'aiPremiumContent.providerGuard.allowed',
    statusKey: 'queued',
    estimatedCostMicros,
    requestCostCapMicros,
    billable: false,
    retryAllowed: false,
  });
};

export const resolveAiPremiumContentSafetyPrecheck = (
  input: AiPremiumContentSafetyPrecheckInput,
) => {
  const risks = [
    input.minorRisk
      ? safetyPrecheckRisk(
          'minor',
          'blocked',
          AI_PREMIUM_CONTENT_SAFETY_PRECHECK_CONTRACT.riskPolicy.minor.messageKey,
        )
      : null,
    input.sexualContentRisk
      ? safetyPrecheckRisk(
          'sexual_content',
          'blocked',
          AI_PREMIUM_CONTENT_SAFETY_PRECHECK_CONTRACT.riskPolicy.sexual_content
            .messageKey,
        )
      : null,
    input.platformPolicyRisk
      ? safetyPrecheckRisk(
          'platform_policy',
          'blocked',
          AI_PREMIUM_CONTENT_SAFETY_PRECHECK_CONTRACT.riskPolicy.platform_policy
            .messageKey,
        )
      : null,
    input.realPersonSimilarityRisk
      ? safetyPrecheckRisk(
          'real_person_similarity',
          'review_required',
          AI_PREMIUM_CONTENT_SAFETY_PRECHECK_CONTRACT.riskPolicy
            .real_person_similarity.messageKey,
        )
      : null,
    input.copyrightRisk
      ? safetyPrecheckRisk(
          'copyright',
          'review_required',
          AI_PREMIUM_CONTENT_SAFETY_PRECHECK_CONTRACT.riskPolicy.copyright
            .messageKey,
        )
      : null,
  ].filter((risk): risk is NonNullable<typeof risk> => Boolean(risk));
  const status: AiPremiumContentSafetyPrecheckStatus = risks.some(
    (risk) => risk.severity === 'blocked',
  )
    ? 'blocked'
    : risks.some((risk) => risk.severity === 'review_required')
      ? 'review_required'
      : 'safe';
  const decision =
    AI_PREMIUM_CONTENT_SAFETY_PRECHECK_CONTRACT.statusDecision[status];
  const auditDecisionStatus =
    AI_PREMIUM_CONTENT_SAFETY_PRECHECK_CONTRACT.auditDecisionProjection
      .safetyStatusMapping[status];

  return {
    status,
    code:
      status === 'safe'
        ? 'AI_PREMIUM_CONTENT_SAFETY_SAFE'
        : status === 'review_required'
          ? 'AI_PREMIUM_CONTENT_SAFETY_REVIEW_REQUIRED'
          : 'AI_PREMIUM_CONTENT_SAFETY_BLOCKED',
    messageKey: decision.messageKey,
    risks,
    providerCallEnabled: false,
    providerCallBeforeDecision: false,
    walletMutationEnabled: false,
    orderMutationEnabled: false,
    settlementMutationEnabled: false,
    payoutMutationEnabled: false,
    paidLikeMutationEnabled: false,
    auditDecision: {
      actionKey:
        AI_PREMIUM_CONTENT_SAFETY_PRECHECK_CONTRACT.auditDecisionProjection
          .actionKey,
      statusKey: auditDecisionStatus,
      userMessageKey: decision.messageKey,
      riskCategoryKeys: risks.map((risk) => risk.category),
      userCopyAndAdminNoteSeparated: true,
      adminNoteReturnedToUser: false,
      rawPromptReturned: false,
      providerPayloadReturned: false,
      tokenReturned: false,
      cookieReturned: false,
    },
    privacy:
      AI_PREMIUM_CONTENT_SAFETY_PRECHECK_CONTRACT.privacy,
  } as const;
};

const providerGuardDecision = ({
  allowed,
  code,
  reasonKey,
  statusKey,
  estimatedCostMicros,
  requestCostCapMicros,
  billable,
  retryAllowed,
}: {
  allowed: boolean;
  code: string;
  reasonKey: string;
  statusKey: string;
  estimatedCostMicros: number;
  requestCostCapMicros: number;
  billable: boolean;
  retryAllowed: boolean;
}) =>
  ({
    allowed,
    code,
    messageKey: reasonKey,
    statusKey,
    estimatedCostMicros,
    requestCostCapMicros,
    providerTimeoutMs:
      AI_PREMIUM_CONTENT_PROVIDER_GUARD_CONTRACT.timeoutPolicy.providerTimeoutMs,
    billable,
    retryAllowed,
    providerAttemptEnabled:
      AI_PREMIUM_CONTENT_PROVIDER_GUARD_CONTRACT.providerAttemptEnabled,
    walletMutationEnabled: false,
    orderMutationEnabled: false,
    settlementMutationEnabled: false,
    payoutMutationEnabled: false,
  }) as const;

export const AI_PREMIUM_CONTENT_RESULT_ASSET_REUSE_AUDIT_PROJECTION = {
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
    similaritySignalSource: 'server_asset_fingerprint_or_embedding_summary',
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
  projectionFields: [
    'artistId',
    'sourceRequestId',
    'sourceResultAssetId',
    'candidateRequestId',
    'candidateResultAssetId',
    'outputClass',
    'requestType',
    'reuseCandidateScoreBucket',
    'reuseDecisionKey',
    'displayDisclosureKey',
    'createdAt',
  ],
  scoreBuckets: ['none', 'low', 'medium', 'high', 'exact_policy_match'],
  reuseDecisionKeys: [
    'new_generation_required',
    'reuse_candidate_review',
    'reuse_allowed_with_disclosure',
    'reuse_rejected',
  ],
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
  privacy: {
    rawPromptReturned: false,
    rawReferenceAssetReturned: false,
    rawEmbeddingReturned: false,
    providerPayloadReturned: false,
    signedUrlReturned: false,
    storageKeyReturned: false,
    tokenReturned: false,
    cookieReturned: false,
  },
} as const;

export const AI_PREMIUM_CONTENT_REUSE_COST_CACHE_SKELETON = {
  version: '2026-06-27.ai-premium-content-reuse-cost-cache-skeleton.v1',
  feature: 'ai_premium_content_reuse_cost_cache_skeleton',
  status: 'read_model_contract_only',
  providerAgnostic: true,
  enabled: false,
  mutationEnabled: false,
  providerCallEnabled: false,
  walletMutationEnabled: false,
  orderMutationEnabled: false,
  settlementMutationEnabled: false,
  payoutMutationEnabled: false,
  cacheScope: {
    cacheKeySource:
      'server_request_fingerprint_artist_scope_output_class_policy_version',
    artistScopedOnly: true,
    crossArtistReuseAllowed: false,
    userPrivatePromptHashReturned: false,
    rawProviderRequestReturned: false,
  },
  cachePolicy: {
    ttlSeconds: 604800,
    staleWhileRevalidateAllowed: false,
    cacheHitMayAvoidProviderCall: true,
    cacheHitMustDiscloseReuse: true,
    clientCanForceCacheHit: false,
    clientCanForceRegeneration: false,
  },
  costProjection: {
    estimatedCostBucketField: 'estimatedCostBucket',
    providerCostReturned: false,
    internalCostMicrosReturned: false,
    userFacingPriceReturned: true,
    costCapSource: 'server_policy_cost_cap',
    failureRateBucketReturned: true,
    regenerationCountReturned: true,
  },
  reuseDecision: {
    decisionKeys: [
      'cache_miss_generate_required',
      'cache_hit_reuse_allowed',
      'reuse_candidate_review',
      'cache_hit_reuse_rejected',
    ],
    requiresServerOrHumanApproval: true,
    reusedResultMustNotClaimFreshGeneration: true,
  },
  projectionFields: [
    'requestId',
    'requestType',
    'outputClass',
    'artistId',
    'cacheDecisionKey',
    'reuseDecisionKey',
    'estimatedCostBucket',
    'failureRateBucket',
    'regenerationCount',
    'displayDisclosureKey',
    'createdAt',
  ],
  privacy: {
    rawPromptReturned: false,
    rawReferenceAssetReturned: false,
    rawProviderPayloadReturned: false,
    providerCredentialReturned: false,
    providerCostReturned: false,
    internalCostMicrosReturned: false,
    cacheKeyReturned: false,
    tokenReturned: false,
    cookieReturned: false,
    apiKeyReturned: false,
    dbUrlReturned: false,
  },
} as const;

export const AI_PREMIUM_CONTENT_USER_FACING_REQUEST_STATUS_API_SKELETON = {
  version:
    '2026-06-19.ai-premium-content-user-facing-request-status-api-skeleton.v1',
  status: 'skeleton_ready_read_only_mutation_blocked',
  readOnly: true,
  enabled: false,
  providerCallEnabled: false,
  mutation: false,
  endpoints: {
    requestList: {
      method: 'GET',
      path: '/api/v1/me/ai-premium-content/requests',
      enabled: false,
      authRequired: true,
      ownerOnly: true,
      mutation: false,
    },
    requestDetail: {
      method: 'GET',
      path: '/api/v1/ai-premium-content/requests/:requestId',
      enabled: false,
      authRequired: true,
      ownerOrArtistOperatorOnly: true,
      mutation: false,
    },
    resultArchive: {
      method: 'GET',
      path: '/api/v1/me/ai-premium-content/results',
      enabled: false,
      authRequired: true,
      ownerOnly: true,
      mutation: false,
    },
  },
  userFacingStatusBuckets: {
    received: {
      requestStatuses: ['draft', 'submitted', 'needs_more_info'],
      statusKey: 'received',
      labelKey: 'aiPremiumContent.status.received',
      fallbackCopyKo: '\uC811\uC218\uB418\uC5C8\uC5B4\uC694',
    },
    reviewing: {
      requestStatuses: ['awaiting_review'],
      moderationStatuses: ['pending', 'needs_review'],
      statusKey: 'reviewing',
      labelKey: 'aiPremiumContent.status.reviewing',
      fallbackCopyKo: '\uAC80\uC218 \uC911\uC774\uC5D0\uC694',
    },
    producing: {
      requestStatuses: ['queued', 'generating'],
      statusKey: 'producing',
      labelKey: 'aiPremiumContent.status.producing',
      fallbackCopyKo: '\uC81C\uC791 \uC911\uC774\uC5D0\uC694',
    },
    completed: {
      requestStatuses: ['approved'],
      resultStatuses: ['approved'],
      statusKey: 'completed',
      labelKey: 'aiPremiumContent.status.completed',
      fallbackCopyKo: '\uC644\uB8CC\uB418\uC5C8\uC5B4\uC694',
    },
    blocked: {
      requestStatuses: ['safety_blocked', 'rejected'],
      moderationStatuses: ['blocked'],
      resultStatuses: ['blocked'],
      statusKey: 'blocked',
      labelKey: 'aiPremiumContent.status.blocked',
      fallbackCopyKo: '\uC9C4\uD589\uD560 \uC218 \uC5C6\uC5B4\uC694',
    },
    failed: {
      requestStatuses: ['provider_failed'],
      resultStatuses: ['failed'],
      statusKey: 'failed',
      labelKey: 'aiPremiumContent.status.failed',
      fallbackCopyKo: '\uC81C\uC791\uC5D0 \uC2E4\uD328\uD588\uC5B4\uC694',
    },
    regeneratable: {
      requestStatuses: ['provider_failed', 'rejected'],
      resultStatuses: ['failed', 'blocked'],
      statusKey: 'regeneratable',
      labelKey: 'aiPremiumContent.status.regeneratable',
      fallbackCopyKo:
        '\uC7AC\uC0DD\uC131\uC744 \uC694\uCCAD\uD560 \uC218 \uC788\uC5B4\uC694',
      derivedFrom: 'retryAvailability.canRegenerate',
      providerCallOnRead: false,
      walletMutationOnRead: false,
    },
  },
  responseProjection: {
    item: {
      id: '<request uuid>',
      artist: '<safe artist summary>',
      requestType: AI_PREMIUM_CONTENT_REQUEST_TYPES,
      outputClass: AI_PREMIUM_CONTENT_OUTPUT_CLASSES,
      userFacingStatus: {
        statusKey:
          '<received|reviewing|producing|completed|blocked|failed|regeneratable>',
        labelKey: '<stable localized copy key>',
        descriptionKey: '<stable localized copy key>',
        fallbackCopyLocale: 'ko-KR',
        rawEnumAsCopy: false,
        rawProviderStatusAsCopy: false,
      },
      resultAvailability: '<safe result availability summary>',
      retryAvailability: {
        canRegenerate: '<server-derived boolean>',
        disabledReasonKey: '<stable localized copy key or null>',
      },
      timestamps: '<safe created/updated/completed timestamps>',
    },
  },
  rawCopyPolicy: {
    locale: 'ko-KR',
    copyLabelsFirst: true,
    titleKeyFallbackAllowed: true,
    ctaKeyFallbackAllowed: true,
    statusKeyFallbackAllowed: true,
    neutralFallbackCopyKo: '\uD655\uC778 \uC911\uC774\uC5D0\uC694',
    rawEnumAsCopy: false,
    rawEnglishKeyAsCopy: false,
    rawProviderStatusAsCopy: false,
  },
  privacy: {
    providerInternalStatusReturned: false,
    providerRouteAliasReturned: false,
    providerKeyReturned: false,
    modelKeyReturned: false,
    rawPromptReturned: false,
    providerPayloadReturned: false,
    safetyPayloadReturned: false,
    internalCostReturned: false,
    providerCostReturned: false,
    walletLedgerIdReturned: false,
    settlementIdReturned: false,
    payoutIdReturned: false,
    signedUrlsReturned: false,
    sensitiveAuthMaterialReturned: false,
  },
  mutationGates: {
    createRequest: false,
    submitParticipation: false,
    regenerateRequest: false,
    gptImageCall: false,
    stableDiffusionCall: false,
    seedanceCall: false,
    openAiCall: false,
    providerCall: false,
    paymentCreate: false,
    walletDebit: false,
    walletCredit: false,
    orderCreate: false,
    settlementAccrual: false,
    payoutAccrual: false,
    paidLike: false,
    publishToFeed: false,
    equipToProfile: false,
  },
} as const;

export const AI_PREMIUM_CONTENT_SAFETY_MODERATION_QUEUE_SKELETON = {
  version: '2026-06-23.ai-content-safety-moderation-queue-skeleton.v1',
  feature: 'ai_content_safety_moderation_queue',
  status: 'skeleton_ready_mutation_blocked',
  queueEnabled: false,
  providerAgnostic: true,
  providerCallEnabled: false,
  imageGenerationEnabled: false,
  videoGenerationEnabled: false,
  paymentMutationEnabled: false,
  walletMutationEnabled: false,
  settlementMutationEnabled: false,
  payoutMutationEnabled: false,
  sourceRequestClasses: ['image', 'video', 'mixed'],
  reviewStateFields: {
    queueItemId: '<uuid>',
    requestId: '<ai premium content request uuid>',
    outputClass: '<image|video|mixed>',
    moderationStatus: '<pending|needs_review|cleared|blocked>',
    adminReviewStatus: '<unassigned|in_review|cleared|blocked|escalated>',
    assignedReviewerId: '<admin user uuid or null>',
    decisionReasonKey: '<stable localized reason key or null>',
    createdAt: '<ISO datetime>',
    updatedAt: '<ISO datetime>',
  },
  riskFields: {
    minor: {
      field: 'minorRisk',
      source: 'server_safety_precheck_or_admin_review',
      allowedValues: ['none', 'suspected', 'confirmed', 'blocked'],
    },
    realPersonSimilarity: {
      field: 'realPersonSimilarityRisk',
      source: 'server_safety_precheck_or_admin_review',
      allowedValues: ['none', 'suspected', 'confirmed', 'blocked'],
      identityGuessReturnedToUser: false,
    },
    sexualContent: {
      field: 'sexualContentRisk',
      source: 'server_safety_precheck_or_admin_review',
      allowedValues: ['none', 'suggestive', 'explicit', 'blocked'],
    },
    copyright: {
      field: 'copyrightRisk',
      source: 'server_safety_precheck_or_admin_review',
      allowedValues: ['none', 'suspected', 'confirmed', 'blocked'],
    },
  },
  queueOrdering: [
    'blocked_minor_or_explicit_content_first',
    'real_person_similarity_review_required',
    'copyright_review_required',
    'admin_manual_review_oldest_first',
  ],
  adminProjection: {
    listEndpoint: '/admin/api/v1/ai-premium-content/safety-moderation-queue',
    detailEndpoint:
      '/admin/api/v1/ai-premium-content/safety-moderation-queue/:queueItemId',
    enabled: false,
    superAdminOrAssetsModeratorRequired: true,
    mutationEnabled: false,
    returnedFields: [
      'queueItemId',
      'requestId',
      'outputClass',
      'moderationStatus',
      'adminReviewStatus',
      'riskSummary',
      'decisionReasonKey',
      'timestamps',
    ],
    rawPromptReturned: false,
    providerPayloadReturned: false,
    signedUrlsReturned: false,
    privateReferenceBytesReturned: false,
  },
  mutationGates: {
    queueInsert: false,
    adminDecision: false,
    providerAttempt: false,
    imageGeneration: false,
    videoGeneration: false,
    walletDebit: false,
    orderCreate: false,
    settlementAccrual: false,
    payoutAccrual: false,
    paidLike: false,
  },
} as const;

export const AI_PREMIUM_CONTENT_SAFETY_STATE_AUDIT_PROJECTION = {
  version: '2026-06-24.ai-content-safety-state-audit-projection.v1',
  feature: 'ai_premium_content_safety_state_audit_projection',
  status: 'read_model_contract_only',
  enabled: false,
  readOnly: true,
  providerAgnostic: true,
  providerCallEnabled: false,
  moderationDecisionMutationEnabled: false,
  paymentMutationEnabled: false,
  walletMutationEnabled: false,
  settlementMutationEnabled: false,
  payoutMutationEnabled: false,
  sourceOfTruth: {
    requestTable: 'future_ai_premium_content_requests',
    safetyPrecheckProjection: 'server_safety_precheck_projection',
    moderationQueue:
      'future_ai_premium_content_safety_moderation_queue',
    adminDecisionEvents:
      'future_ai_premium_content_safety_decision_events',
    rawPromptStoredInProjection: false,
    rawProviderPayloadStoredInProjection: false,
  },
  projectionFields: [
    'requestId',
    'requestType',
    'outputClass',
    'safetyStatusKey',
    'moderationStatusKey',
    'adminReviewStatusKey',
    'riskCategoryKeys',
    'decisionReasonKey',
    'reviewRequired',
    'blocked',
    'lastDecisionAt',
    'updatedAt',
  ],
  stateSources: {
    safetyStatusKey: AI_PREMIUM_CONTENT_SAFETY_STATUSES,
    safetyPrecheckStatus: AI_PREMIUM_CONTENT_SAFETY_PRECHECK_STATUSES,
    riskCategoryKeys: AI_PREMIUM_CONTENT_SAFETY_PRECHECK_RISK_CATEGORIES,
    moderationQueue:
      AI_PREMIUM_CONTENT_SAFETY_MODERATION_QUEUE_SKELETON.reviewStateFields,
    clientSubmittedSafetyTrusted: false,
    providerSubmittedSafetyTrusted: false,
  },
  adminReadModel: {
    listEndpoint:
      '/admin/api/v1/ai-premium-content/safety-state-audit',
    detailEndpoint:
      '/admin/api/v1/ai-premium-content/safety-state-audit/:requestId',
    enabled: false,
    superAdminOrAssetsModeratorRequired: true,
    mutationEnabled: false,
    stableKeysOnly: true,
    rawEnumAsCopy: false,
    rawPromptReturned: false,
    providerPayloadReturned: false,
    tokenReturned: false,
    apiKeyReturned: false,
    privateNoteReturned: false,
  },
  privacy: {
    rawPromptReturned: false,
    rawProviderPayloadReturned: false,
    rawSafetyPayloadReturned: false,
    rawAdminPrivateNoteReturned: false,
    privateReferenceBytesReturned: false,
    signedUrlReturned: false,
    storageKeyReturned: false,
    tokenReturned: false,
    apiKeyReturned: false,
    cookieReturned: false,
  },
  mutationGates: {
    providerAttempt: false,
    imageGeneration: false,
    videoGeneration: false,
    queueInsert: false,
    adminDecision: false,
    walletDebit: false,
    orderCreate: false,
    settlementAccrual: false,
    payoutAccrual: false,
    paidLike: false,
  },
} as const;

export const AI_PREMIUM_CONTENT_ARTIST_CONTEXT_READ_MODEL = {
  version: '2026-06-28.ai-premium-content-artist-context-read-model.v1',
  feature: 'ai_premium_content_artist_context_read_model',
  status: 'read_model_contract_only',
  enabled: false,
  readOnly: true,
  providerAgnostic: true,
  providerCallEnabled: false,
  imageGenerationEnabled: false,
  videoGenerationEnabled: false,
  walletMutationEnabled: false,
  orderMutationEnabled: false,
  settlementMutationEnabled: false,
  payoutMutationEnabled: false,
  sourceOfTruth: {
    artistProfile: 'artists + artist_public_profiles',
    worldSetting: 'approved_artist_world_setting_projection',
    styleGuide: 'approved_artist_style_guide_projection',
    safetyRules: 'approved_artist_safety_rules_projection',
    forbiddenExpressions: 'approved_artist_forbidden_expression_projection',
    requestPolicy: 'AI_PREMIUM_CONTENT_REQUEST_TYPE_POLICY',
  },
  endpoint: {
    method: 'GET',
    path: '/api/v1/ai-premium-content/artists/:artistSlug/context',
    enabled: false,
    authRequired: true,
    ownerOrArtistOperatorOnly: true,
    mutation: false,
  },
  projectionFields: [
    'artist.id',
    'artist.slug',
    'artist.displayName',
    'artist.publicTagline',
    'worldSetting.summaryKey',
    'styleGuide.visualToneKeys',
    'styleGuide.colorMoodKeys',
    'forbiddenExpressionKeys',
    'safetyRuleKeys',
    'allowedRequestTypes',
    'providerRouteAliases',
    'contextVersion',
    'updatedAt',
  ],
  providerContextBoundary: {
    returnsProviderReadyContext: false,
    providerSpecificPromptReturned: false,
    providerSpecificModelKeyReturned: false,
    rawPromptReturned: false,
    rawProviderPayloadReturned: false,
    privateArtistNotesReturned: false,
    adminMemoReturned: false,
    contextCanBeAdaptedByServerLater: true,
  },
  safetyBoundary: {
    minorCleanRequired: true,
    realPersonSimilarityGuardRequired: true,
    copyrightGuardRequired: true,
    sexualContentGuardRequired: true,
    platformPolicyGuardRequired: true,
    safetyPrecheckRequiredBeforeGeneration: true,
  },
  copyPolicy: {
    rawEnumAsCopy: false,
    stableKeyRequired: true,
    neutralFallbackKey: 'aiPremiumContent.artistContext.checking',
  },
  mutationGates: {
    providerAttempt: false,
    imageGeneration: false,
    videoGeneration: false,
    requestCreate: false,
    walletDebit: false,
    orderCreate: false,
    settlementAccrual: false,
    payoutAccrual: false,
    paidLike: false,
  },
  privacy: {
    rawPromptReturned: false,
    rawProviderPayloadReturned: false,
    rawSafetyPayloadReturned: false,
    privateArtistNotesReturned: false,
    internalStylePromptReturned: false,
    signedUrlsReturned: false,
    tokenReturned: false,
    cookieReturned: false,
    apiKeyReturned: false,
    dbUrlReturned: false,
  },
} as const;

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
  characterChatHandoff: CHARACTER_CHAT_AI_PREMIUM_CONTENT_HANDOFF_CONTRACT,
  requestQueueSkeleton: AI_PREMIUM_CONTENT_REQUEST_QUEUE_SKELETON,
  queueReadModel: AI_PREMIUM_CONTENT_QUEUE_READ_MODEL_CONTRACT,
  costRetryReadModel: AI_PREMIUM_CONTENT_COST_RETRY_READ_MODEL_SKELETON,
  costEstimateProjection: AI_PREMIUM_CONTENT_COST_ESTIMATE_PROJECTION_CONTRACT,
  costUsageAuditProjection: AI_PREMIUM_CONTENT_COST_USAGE_AUDIT_PROJECTION,
  modelRoutingApiSkeleton: AI_PREMIUM_CONTENT_MODEL_ROUTING_API_SKELETON,
  middlewareRoutingSkeleton:
    AI_PREMIUM_CONTENT_MIDDLEWARE_ROUTING_SKELETON,
  createStatusApiSkeleton: AI_PREMIUM_CONTENT_CREATE_STATUS_API_SKELETON,
  statusPreviewFixture: AI_PREMIUM_CONTENT_STATUS_PREVIEW_FIXTURE_CONTRACT,
  videoConsentException:
    AI_PREMIUM_CONTENT_VIDEO_CONSENT_EXCEPTION_CONTRACT,
  safetyModerationQueueSkeleton:
    AI_PREMIUM_CONTENT_SAFETY_MODERATION_QUEUE_SKELETON,
  safetyStateAuditProjection:
    AI_PREMIUM_CONTENT_SAFETY_STATE_AUDIT_PROJECTION,
  resultAssetReuseAuditProjection:
    AI_PREMIUM_CONTENT_RESULT_ASSET_REUSE_AUDIT_PROJECTION,
  reuseCostCacheSkeleton: AI_PREMIUM_CONTENT_REUSE_COST_CACHE_SKELETON,
  artistContextReadModel: AI_PREMIUM_CONTENT_ARTIST_CONTEXT_READ_MODEL,
  userFacingRequestStatusApiSkeleton:
    AI_PREMIUM_CONTENT_USER_FACING_REQUEST_STATUS_API_SKELETON,
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
    myResultArchive: {
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
        costCapGuard:
          AI_PREMIUM_CONTENT_COST_WALLET_PRECHECK_POLICY.costCapGuard,
        walletPrecheck:
          AI_PREMIUM_CONTENT_COST_WALLET_PRECHECK_POLICY.walletPrecheck,
        failurePolicy: AI_PREMIUM_CONTENT_PRECHECK_FAILURE_POLICY,
      },
    },
    safetyPrecheck: AI_PREMIUM_CONTENT_SAFETY_PRECHECK_CONTRACT,
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
      resultArchive: {
        audience: 'request_owner_or_artist_operator',
        endpoint: '/api/v1/me/ai-premium-content/results',
        projection: 'aiPremiumContentResultArchiveItem',
        groupsImageVideoAndMixedTogether: true,
        listFields: [
          'id',
          'requestId',
          'requestType',
          'outputClass',
          'artist',
          'status',
          'safetyStatus',
          'resultStatus',
          'resultAvailability',
          'regenerationAvailability',
          'timestamps',
        ],
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
    safetyPrecheck: false,
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

export const AI_PREMIUM_CONTENT_CONTRACT_VERSION =
  '2026-05-28.ai-premium-content-generation-skeleton.v1';
export const AI_PREMIUM_CONTENT_COST_USAGE_SCHEMA_VERSION =
  '2026-05-28.ai-premium-content-cost-usage.v1';

export const AI_PREMIUM_CONTENT_REQUEST_TYPES = [
  'image_generation',
  'video_generation',
  'premium_content_pack',
] as const;

export const AI_PREMIUM_CONTENT_STATUSES = [
  'submitted',
  'safety_review',
  'provider_disabled',
  'routing_not_ready',
  'generation_pending',
  'generation_failed',
  'delivered',
  'rejected',
  'archived',
] as const;

export const AI_PREMIUM_CONTENT_MODERATION_STATUSES = [
  'pending',
  'cleared',
  'blocked',
  'needs_review',
] as const;

export const AI_PREMIUM_CONTENT_CAPABILITIES = [
  'image_generation',
  'video_generation',
  'image_edit',
  'reference_pack',
] as const;

export const AI_PREMIUM_CONTENT_PROVIDER_FAMILIES = [
  'openai',
  'stable_diffusion',
  'seedance',
  'internal_mock',
  'unknown',
] as const;

export type AiPremiumContentRequestType =
  (typeof AI_PREMIUM_CONTENT_REQUEST_TYPES)[number];
export type AiPremiumContentStatus =
  (typeof AI_PREMIUM_CONTENT_STATUSES)[number];
export type AiPremiumContentCapability =
  (typeof AI_PREMIUM_CONTENT_CAPABILITIES)[number];
export type AiPremiumContentProviderFamily =
  (typeof AI_PREMIUM_CONTENT_PROVIDER_FAMILIES)[number];

export type AiPremiumContentProviderDisabledInput = {
  requestType?: string | null;
  capability?: string | null;
  modelAlias?: string | null;
};

export type AiPremiumContentUsageInput = {
  requestId?: string | null;
  providerFamily?: string | null;
  modelAlias?: string | null;
  capability?: string | null;
  attempt?: number | string | null;
  regenerationCount?: number | string | null;
  estimatedCostMicros?: number | string | null;
  actualCostMicros?: number | string | null;
  inputUnits?: number | string | null;
  outputUnits?: number | string | null;
  failureCode?: string | null;
  vendorPayload?: unknown;
  credential?: unknown;
};

export const AI_PREMIUM_CONTENT_GENERATION_CONTRACT = {
  version: AI_PREMIUM_CONTENT_CONTRACT_VERSION,
  feature: 'ai_premium_content_generation',
  status: 'provider_disabled_skeleton',
  bridge: {
    currentQueue: 'creator_image_requests',
    creatorImageRequestsPreserved: true,
    futureRequestTable: 'ai_premium_content_requests',
    currentImageRequestTypes: [
      'profile_image',
      'content_image',
      'feed_image',
      'shortform_thumbnail',
      'concept_reference',
    ],
  },
  apiContracts: {
    creatorCreate: {
      method: 'POST',
      pathTemplate: '/api/v1/me/creator-studio/ai-premium-content-requests',
      enabled: false,
      disabledCode: 'AI_PREMIUM_CONTENT_PROVIDER_DISABLED',
      messageKey: 'aiPremiumContent.providerDisabled',
    },
    creatorList: {
      method: 'GET',
      pathTemplate: '/api/v1/me/creator-studio/ai-premium-content-requests',
      enabled: false,
      projection: 'aiPremiumContentRequestListItem',
    },
    creatorDetail: {
      method: 'GET',
      pathTemplate:
        '/api/v1/me/creator-studio/ai-premium-content-requests/:requestId',
      enabled: false,
      projection: 'aiPremiumContentRequestDetail',
    },
    adminReview: {
      method: 'POST',
      pathTemplate:
        '/api/v1/admin/api/v1/backstage/ai-premium-content-requests/:requestId/review',
      enabled: false,
      superAdminOnly: true,
      walletMutation: false,
      settlementMutation: false,
      payoutMutation: false,
    },
  },
  requestSchema: {
    requestTypes: AI_PREMIUM_CONTENT_REQUEST_TYPES,
    statuses: AI_PREMIUM_CONTENT_STATUSES,
    moderationStatuses: AI_PREMIUM_CONTENT_MODERATION_STATUSES,
    routingReadiness: [
      'provider_disabled',
      'safety_review_required',
      'model_route_not_ready',
      'ready_after_future_provider_setup',
    ],
    safetyDecisionKeys: [
      'pending',
      'cleared',
      'blocked_policy',
      'needs_human_review',
    ],
  },
  providerRouter: {
    defaultStatus: 'provider_disabled',
    failClosed: true,
    liveProviderCallsEnabled: false,
    gptImageEnabled: false,
    stableDiffusionEnabled: false,
    seedanceEnabled: false,
    responseCode: 'AI_PREMIUM_CONTENT_PROVIDER_DISABLED',
    messageKey: 'aiPremiumContent.providerDisabled',
  },
  costUsageSchema: {
    version: AI_PREMIUM_CONTENT_COST_USAGE_SCHEMA_VERSION,
    fields: [
      'requestId',
      'providerFamily',
      'modelAlias',
      'capability',
      'attempt',
      'regenerationCount',
      'estimatedCostMicros',
      'actualCostMicros',
      'inputUnits',
      'outputUnits',
      'failureCode',
      'recordedAt',
    ],
    placeholderOnlyUntilProviderEnabled: true,
    rawProviderPayloadStored: false,
    vendorCredentialStored: false,
    promptStoredInUsageLog: false,
    walletMutation: false,
    orderMutation: false,
    settlementMutation: false,
    payoutMutation: false,
  },
  sensitiveDataPolicy: {
    vendorCredentialLogged: false,
    vendorTokenLogged: false,
    rawProviderPayloadLogged: false,
    rawPromptLoggedInCostUsage: false,
    rawAssetBytesLogged: false,
    walletLedgerIdLogged: false,
  },
} as const;

export function buildAiPremiumContentProviderDisabledResponse(
  input: AiPremiumContentProviderDisabledInput = {},
) {
  return {
    ok: false,
    status: 'provider_disabled',
    code: 'AI_PREMIUM_CONTENT_PROVIDER_DISABLED',
    messageKey: 'aiPremiumContent.providerDisabled',
    requestAccepted: false,
    providerConfigured: false,
    routingReadiness: 'provider_disabled',
    requestType: normalizeAiPremiumContentRequestType(input.requestType),
    capability: normalizeAiPremiumContentCapability(input.capability),
    modelAlias: normalizeModelAlias(input.modelAlias),
    policy: {
      failClosed: true,
      liveProviderCallsEnabled: false,
      walletMutation: false,
      orderMutation: false,
      settlementMutation: false,
      payoutMutation: false,
      vendorCredentialReturned: false,
      rawProviderPayloadReturned: false,
    },
  } as const;
}

export function buildAiPremiumContentUsagePlaceholder(
  input: AiPremiumContentUsageInput = {},
) {
  return {
    schemaVersion: AI_PREMIUM_CONTENT_COST_USAGE_SCHEMA_VERSION,
    requestId: input.requestId ?? null,
    providerFamily: normalizeProviderFamily(input.providerFamily),
    modelAlias: normalizeModelAlias(input.modelAlias),
    capability: normalizeAiPremiumContentCapability(input.capability),
    attempt: nonNegativeInteger(input.attempt),
    regenerationCount: nonNegativeInteger(input.regenerationCount),
    estimatedCostMicros: nonNegativeInteger(input.estimatedCostMicros),
    actualCostMicros: nonNegativeInteger(input.actualCostMicros),
    inputUnits: nonNegativeInteger(input.inputUnits),
    outputUnits: nonNegativeInteger(input.outputUnits),
    failureCode: normalizeFailureCode(input.failureCode),
    recordedAt: '<server timestamp>',
    placeholderOnly: true,
    rawProviderPayloadStored: false,
    vendorCredentialStored: false,
    walletMutation: false,
    settlementMutation: false,
    payoutMutation: false,
  } as const;
}

function normalizeAiPremiumContentRequestType(
  value: string | null | undefined,
): AiPremiumContentRequestType {
  return (AI_PREMIUM_CONTENT_REQUEST_TYPES as readonly string[]).includes(
    value ?? '',
  )
    ? (value as AiPremiumContentRequestType)
    : 'image_generation';
}

function normalizeAiPremiumContentCapability(
  value: string | null | undefined,
): AiPremiumContentCapability {
  return (AI_PREMIUM_CONTENT_CAPABILITIES as readonly string[]).includes(
    value ?? '',
  )
    ? (value as AiPremiumContentCapability)
    : 'image_generation';
}

function normalizeProviderFamily(
  value: string | null | undefined,
): AiPremiumContentProviderFamily {
  return (AI_PREMIUM_CONTENT_PROVIDER_FAMILIES as readonly string[]).includes(
    value ?? '',
  )
    ? (value as AiPremiumContentProviderFamily)
    : 'unknown';
}

function normalizeModelAlias(value: string | null | undefined) {
  const normalized = value?.trim();

  return normalized ? normalized.slice(0, 80) : null;
}

function normalizeFailureCode(value: string | null | undefined) {
  const normalized = value?.trim();

  return normalized ? normalized.slice(0, 80) : null;
}

function nonNegativeInteger(value: number | string | null | undefined) {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

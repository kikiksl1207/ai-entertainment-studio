export const AI_CONTENT_USAGE_LEDGER_SCHEMA_VERSION =
  '2026-06-02.ai-content-usage-ledger-guard.v1';

export const AI_CONTENT_USAGE_PROVIDER_FAMILIES = [
  'openai',
  'stable_diffusion',
  'seedance',
  'internal_mock',
  'unknown',
] as const;

export const AI_CONTENT_USAGE_CAPABILITIES = [
  'image_generation',
  'video_generation',
  'image_edit',
  'reference_pack',
] as const;

export const AI_CONTENT_USAGE_REQUEST_TYPES = [
  'image_single',
  'image_variation',
  'image_reference',
  'video_clip',
  'video_loop',
  'premium_pack',
  'unknown',
] as const;

export const AI_CONTENT_USAGE_SAFETY_STATUSES = [
  'pending',
  'needs_review',
  'blocked',
  'cleared',
  'unknown',
] as const;

export const AI_CONTENT_USAGE_REUSE_STATES = [
  'none',
  'cache_hit',
  'derived_from_previous',
  'unknown',
] as const;

export type AiContentUsageProviderFamily =
  (typeof AI_CONTENT_USAGE_PROVIDER_FAMILIES)[number];
export type AiContentUsageCapability =
  (typeof AI_CONTENT_USAGE_CAPABILITIES)[number];
export type AiContentUsageRequestType =
  (typeof AI_CONTENT_USAGE_REQUEST_TYPES)[number];
export type AiContentUsageSafetyStatus =
  (typeof AI_CONTENT_USAGE_SAFETY_STATUSES)[number];
export type AiContentUsageReuseState =
  (typeof AI_CONTENT_USAGE_REUSE_STATES)[number];

export type AiContentUsageLedgerInput = {
  requestId?: string | null;
  requestType?: string | null;
  providerFamily?: string | null;
  modelAlias?: string | null;
  modelRouteAlias?: string | null;
  capability?: string | null;
  safetyStatus?: string | null;
  attempt?: number | string | null;
  regenerationCount?: number | string | null;
  reuseState?: string | null;
  reuseSourceRequestId?: string | null;
  estimatedCostMicros?: number | string | null;
  actualCostMicros?: number | string | null;
  inputUnits?: number | string | null;
  outputUnits?: number | string | null;
  failureCode?: string | null;
  vendorPayload?: unknown;
  vendorCredential?: unknown;
  rawPrompt?: unknown;
  rawAssetBytes?: unknown;
};

export type AiContentUsageLedgerRow = ReturnType<
  typeof buildAiContentUsageLedgerRow
>;

export const AI_CONTENT_USAGE_LEDGER_GUARD = {
  schemaVersion: AI_CONTENT_USAGE_LEDGER_SCHEMA_VERSION,
  status: 'skeleton_guard_only',
  providerCallsEnabled: false,
  liveUsageLedgerMutationEnabled: false,
  fields: [
    'requestId',
    'requestType',
    'providerFamily',
    'modelAlias',
    'modelRouteAlias',
    'capability',
    'safetyStatus',
    'attempt',
    'regenerationCount',
    'reuseState',
    'reuseSourceRequestId',
    'estimatedCostMicros',
    'actualCostMicros',
    'inputUnits',
    'outputUnits',
    'failureCode',
    'recordedAt',
  ],
  aggregationFields: [
    'totalAttempts',
    'failedAttempts',
    'failureRate',
    'totalEstimatedCostMicros',
    'totalActualCostMicros',
    'totalInputUnits',
    'totalOutputUnits',
    'maxRegenerationCount',
    'reusedAttemptCount',
  ],
  pipelineLogPolicy: {
    source: 'ai_middleware_pipeline',
    providerCallEnabled: false,
    providerRouteAliasOnly: true,
    vendorProviderKeyStored: false,
    vendorModelKeyStored: false,
    modelRouteAliasPrefix: 'ai_premium_content.',
    requestTypes: AI_CONTENT_USAGE_REQUEST_TYPES,
    safetyStatuses: AI_CONTENT_USAGE_SAFETY_STATUSES,
    requiredBeforeProviderAttempt: [
      'requestType',
      'modelRouteAlias',
      'estimatedCostMicros',
      'safetyStatus',
      'reuseState',
    ],
    safetyBlockedBehavior: 'log_skeleton_only_without_provider_attempt',
  },
  sensitiveDataPolicy: {
    vendorCredentialStored: false,
    vendorCredentialLogged: false,
    rawProviderPayloadStored: false,
    rawProviderPayloadLogged: false,
    rawPromptStored: false,
    rawPromptLogged: false,
    rawAssetBytesStored: false,
    rawAssetBytesLogged: false,
    tokenCookiePasswordStored: false,
    dbUrlStored: false,
  },
  mutationPolicy: {
    walletMutation: false,
    orderMutation: false,
    settlementMutation: false,
    payoutMutation: false,
    revenueShareMutation: false,
  },
  idempotency: {
    futureKeyPattern: 'ai-content-usage:<requestId>:<attempt>',
    duplicateAttemptBehavior: 'upsert_or_replay_without_duplicate_cost_row',
  },
} as const;

export function buildAiContentUsageLedgerRow(
  input: AiContentUsageLedgerInput = {},
) {
  return {
    schemaVersion: AI_CONTENT_USAGE_LEDGER_SCHEMA_VERSION,
    requestId: normalizeText(input.requestId, 80),
    requestType: normalizeRequestType(input.requestType),
    providerFamily: normalizeProviderFamily(input.providerFamily),
    modelAlias: normalizeText(input.modelAlias, 80),
    modelRouteAlias: normalizeModelRouteAlias(input.modelRouteAlias),
    capability: normalizeCapability(input.capability),
    safetyStatus: normalizeSafetyStatus(input.safetyStatus),
    attempt: nonNegativeInteger(input.attempt),
    regenerationCount: nonNegativeInteger(input.regenerationCount),
    reuseState: normalizeReuseState(input.reuseState),
    reuseSourceRequestId: normalizeText(input.reuseSourceRequestId, 80),
    estimatedCostMicros: nonNegativeInteger(input.estimatedCostMicros),
    actualCostMicros: nonNegativeInteger(input.actualCostMicros),
    inputUnits: nonNegativeInteger(input.inputUnits),
    outputUnits: nonNegativeInteger(input.outputUnits),
    failureCode: normalizeText(input.failureCode, 80),
    recordedAt: '<server timestamp>',
    rawProviderPayloadStored: false,
    vendorCredentialStored: false,
    rawPromptStored: false,
    rawAssetBytesStored: false,
    walletMutation: false,
    orderMutation: false,
    settlementMutation: false,
    payoutMutation: false,
  } as const;
}

export function summarizeAiContentUsage(rows: AiContentUsageLedgerRow[]) {
  const totalAttempts = rows.length;
  const failedAttempts = rows.filter((row) => Boolean(row.failureCode)).length;

  return {
    schemaVersion: AI_CONTENT_USAGE_LEDGER_SCHEMA_VERSION,
    totalAttempts,
    failedAttempts,
    failureRate: totalAttempts === 0 ? 0 : failedAttempts / totalAttempts,
    totalEstimatedCostMicros: rows.reduce(
      (total, row) => total + row.estimatedCostMicros,
      0,
    ),
    totalActualCostMicros: rows.reduce(
      (total, row) => total + row.actualCostMicros,
      0,
    ),
    totalInputUnits: rows.reduce((total, row) => total + row.inputUnits, 0),
    totalOutputUnits: rows.reduce((total, row) => total + row.outputUnits, 0),
    maxRegenerationCount: rows.reduce(
      (max, row) => Math.max(max, row.regenerationCount),
      0,
    ),
    reusedAttemptCount: rows.filter((row) => row.reuseState !== 'none').length,
    walletMutation: false,
    settlementMutation: false,
    payoutMutation: false,
  } as const;
}

function normalizeProviderFamily(
  value: string | null | undefined,
): AiContentUsageProviderFamily {
  return (AI_CONTENT_USAGE_PROVIDER_FAMILIES as readonly string[]).includes(
    value ?? '',
  )
    ? (value as AiContentUsageProviderFamily)
    : 'unknown';
}

function normalizeCapability(
  value: string | null | undefined,
): AiContentUsageCapability {
  return (AI_CONTENT_USAGE_CAPABILITIES as readonly string[]).includes(value ?? '')
    ? (value as AiContentUsageCapability)
    : 'image_generation';
}

function normalizeRequestType(
  value: string | null | undefined,
): AiContentUsageRequestType {
  return (AI_CONTENT_USAGE_REQUEST_TYPES as readonly string[]).includes(value ?? '')
    ? (value as AiContentUsageRequestType)
    : 'unknown';
}

function normalizeSafetyStatus(
  value: string | null | undefined,
): AiContentUsageSafetyStatus {
  return (AI_CONTENT_USAGE_SAFETY_STATUSES as readonly string[]).includes(
    value ?? '',
  )
    ? (value as AiContentUsageSafetyStatus)
    : 'unknown';
}

function normalizeReuseState(
  value: string | null | undefined,
): AiContentUsageReuseState {
  if (!value) {
    return 'none';
  }

  return (AI_CONTENT_USAGE_REUSE_STATES as readonly string[]).includes(value)
    ? (value as AiContentUsageReuseState)
    : 'unknown';
}

function normalizeModelRouteAlias(value: string | null | undefined) {
  const normalized = normalizeText(value, 120);

  return normalized?.startsWith('ai_premium_content.') ? normalized : null;
}

function normalizeText(value: string | null | undefined, maxLength: number) {
  const normalized = value?.trim();

  return normalized ? normalized.slice(0, maxLength) : null;
}

function nonNegativeInteger(value: number | string | null | undefined) {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

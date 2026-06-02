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

export type AiContentUsageProviderFamily =
  (typeof AI_CONTENT_USAGE_PROVIDER_FAMILIES)[number];
export type AiContentUsageCapability =
  (typeof AI_CONTENT_USAGE_CAPABILITIES)[number];

export type AiContentUsageLedgerInput = {
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
  aggregationFields: [
    'totalAttempts',
    'failedAttempts',
    'failureRate',
    'totalEstimatedCostMicros',
    'totalActualCostMicros',
    'totalInputUnits',
    'totalOutputUnits',
    'maxRegenerationCount',
  ],
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
    providerFamily: normalizeProviderFamily(input.providerFamily),
    modelAlias: normalizeText(input.modelAlias, 80),
    capability: normalizeCapability(input.capability),
    attempt: nonNegativeInteger(input.attempt),
    regenerationCount: nonNegativeInteger(input.regenerationCount),
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

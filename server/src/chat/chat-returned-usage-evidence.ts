export type ChatReturnedUsageEvidence = Readonly<{
  contract: 'chat-returned-usage-evidence-v1';
  responseStatus: 'completed' | 'unreported' | 'unknown';
  completionVerified: boolean;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: null;
  normalizedUsageOnly: true;
  semanticQualityVerified: false;
  actualProviderCostKrw: null;
  providerInvoiceVerified: false;
  billingStatus: 'unverified';
}>;

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
const tokens = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

export function captureChatReturnedUsageEvidence(value: unknown): ChatReturnedUsageEvidence | null {
  const result = record(value), usage = record(result?.usage), safety = record(result?.safetyMetadata);
  if (usage?.provider !== 'openai') return null;
  const responseStatus = safety?.providerResponseStatus === 'completed' || safety?.providerResponseStatus === 'unreported'
    ? safety.providerResponseStatus : 'unknown';
  const model = typeof usage.model === 'string' && usage.model.length <= 128
    && /^(?:gpt-[a-zA-Z0-9._-]+|o[1-9][a-zA-Z0-9._-]*)$/.test(usage.model) ? usage.model : null;
  return Object.freeze({
    contract: 'chat-returned-usage-evidence-v1', responseStatus,
    completionVerified: responseStatus === 'completed' && safety?.providerCompletionVerified === true,
    model, inputTokens: tokens(usage.inputTokens), outputTokens: tokens(usage.outputTokens),
    cachedInputTokens: null, normalizedUsageOnly: true, semanticQualityVerified: false, actualProviderCostKrw: null,
    providerInvoiceVerified: false, billingStatus: 'unverified',
  });
}

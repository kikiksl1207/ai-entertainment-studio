export const STORY_AI_PUBLIC_CLAIM =
  'writer_approved_manuscript_based_ai_expansion';

export const STORY_AI_CONTINUATION_TERMINAL_STATES = [
  'completed',
  'failed',
  'timeout',
] as const;

export type StoryRateCardNumbers = {
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  cachedInputCostPerMillion: number;
  imageUnitCost: number;
};

export type StoryUsageUnits = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  imageUnits?: number;
};

export function calculateStoryUsageCost(
  rate: StoryRateCardNumbers,
  usage: StoryUsageUnits,
) {
  const input = Math.max(0, usage.inputTokens - (usage.cachedInputTokens ?? 0));
  const cached = Math.max(0, usage.cachedInputTokens ?? 0);
  return roundMoney(
    (input / 1_000_000) * rate.inputCostPerMillion +
      (cached / 1_000_000) * rate.cachedInputCostPerMillion +
      (Math.max(0, usage.outputTokens) / 1_000_000) *
        rate.outputCostPerMillion +
      Math.max(0, usage.imageUnits ?? 0) * rate.imageUnitCost,
  );
}

export function calculateInitialStoryPrice(input: {
  authorRightsCostKrw: number;
  expectedReplayCostKrw: number;
  includedAiRouteCostKrw: number;
  paymentFeeRate: number;
  vatRate: number;
  storageDeliveryCostKrw: number;
  operatingMarginRate: number;
}) {
  const directCost =
    input.authorRightsCostKrw +
    input.expectedReplayCostKrw +
    input.includedAiRouteCostKrw +
    input.storageDeliveryCostKrw;
  const denominator =
    1 - input.paymentFeeRate - input.vatRate - input.operatingMarginRate;
  if (directCost < 0 || denominator <= 0 || denominator > 1) {
    throw new Error('Story pricing inputs are not viable');
  }
  return {
    directCostKrw: roundMoney(directCost),
    recommendedRetailPriceKrw: Math.ceil(directCost / denominator),
    repurchaseRequired: false,
    aiAllowanceSeparateFromEntitlement: true,
  };
}

export function storyAllowanceRemaining(input: {
  includedLimit: number;
  purchasedLimit: number;
  reservedCount: number;
  consumedCount: number;
  compensatedCount: number;
}) {
  return Math.max(
    0,
    input.includedLimit +
      input.purchasedLimit +
      input.compensatedCount -
      input.reservedCount -
      input.consumedCount,
  );
}

export function validateStoryReleaseCapability(input: {
  freeStory: boolean;
  fixedChoiceCount: number;
  customChoiceEnabled: boolean;
  customChoiceMaxLength: number;
  fullResetLimit: number;
  actResetLimit: number;
  includedAiRouteCount: number;
  aiInputTokenLimit: number;
  aiOutputTokenLimit: number;
  warningBudgetKrw: number;
  hardBudgetKrw: number;
}) {
  const errors: string[] = [];
  if (input.fixedChoiceCount !== 3) errors.push('fixed_choice_count_must_be_three');
  if (input.freeStory && input.customChoiceEnabled) {
    errors.push('free_story_custom_choice_must_be_disabled');
  }
  if (!input.freeStory && input.customChoiceEnabled) {
    if (input.customChoiceMaxLength < 1 || input.customChoiceMaxLength > 2000) {
      errors.push('custom_choice_max_length_invalid');
    }
    if (input.includedAiRouteCount < 0) errors.push('included_allowance_invalid');
  }
  if (input.fullResetLimit !== 1) errors.push('full_reset_limit_must_be_one');
  if (input.actResetLimit !== 3) errors.push('act_reset_limit_must_be_three');
  if (input.aiInputTokenLimit < 1 || input.aiOutputTokenLimit < 1) {
    errors.push('ai_token_budget_invalid');
  }
  if (
    input.warningBudgetKrw <= 0 ||
    input.hardBudgetKrw <= 0 ||
    input.warningBudgetKrw > input.hardBudgetKrw
  ) {
    errors.push('ai_cost_budget_invalid');
  }
  return errors;
}

export function estimateHierarchicalMemoryTokens(input: {
  scopeType: 'part' | 'act' | 'volume' | 'work';
  partCount: number;
  currentPartCharacters: number;
  relatedEvidenceCharacters: number;
  outputTokenLimit: number;
}) {
  const boundedParts = Math.min(150, Math.max(1, input.partCount));
  const currentPartTokens = Math.ceil(Math.max(0, input.currentPartCharacters) / 4);
  const evidenceTokens = Math.ceil(
    Math.min(80_000, Math.max(0, input.relatedEvidenceCharacters)) / 4,
  );
  const structuredSummaryTokens =
    input.scopeType === 'work' ? boundedParts * 300 : 0;
  const scopeMultiplier =
    input.scopeType === 'part'
      ? 1
      : input.scopeType === 'act'
        ? Math.min(15, boundedParts)
        : input.scopeType === 'volume'
          ? Math.min(30, boundedParts)
          : 1;
  return {
    inputTokens:
      currentPartTokens * scopeMultiplier +
      evidenceTokens +
      structuredSummaryTokens,
    outputTokens: Math.max(1, input.outputTokenLimit),
    fullManuscriptResent: false,
  };
}

export function storyBudgetDecision(
  estimatedCostKrw: number,
  warningBudgetKrw: number,
  hardBudgetKrw: number,
) {
  if (estimatedCostKrw > hardBudgetKrw) {
    return { decision: 'blocked' as const, reasonCode: 'hard_budget_exceeded' };
  }
  if (estimatedCostKrw > warningBudgetKrw) {
    return { decision: 'reduced' as const, reasonCode: 'warning_budget_exceeded' };
  }
  return { decision: 'approved' as const, reasonCode: 'within_budget' };
}

export function duplicateFixedChoice(input: string, labels: string[]) {
  const normalized = normalize(input);
  return labels.some((label) => normalize(label) === normalized);
}

function normalize(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

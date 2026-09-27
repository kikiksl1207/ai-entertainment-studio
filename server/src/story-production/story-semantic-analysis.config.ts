import { Decimal } from '@prisma/client/runtime/library';
import { manuscriptContentHash } from './story-production.policy';
import { storyContinuationModelEncoding } from './story-continuation-tokenizer';
import { SemanticAnalysisError } from './story-semantic-analysis.types';

export const SEMANTIC_PACKING_PROFILE = 'framed_256_v1' as const;

export type SemanticPins = {
  provider: string; model: string; rateCardId: string; rateCardVersion: string;
  inputKrwPerMillion: string; cachedInputKrwPerMillion: string; outputKrwPerMillion: string;
  inputTokenLimit: number; outputTokenLimit: number;
  maxJobInputTokens: number; maxJobOutputTokens: number; maxJobCostKrw: string;
  packingProfile?: typeof SEMANTIC_PACKING_PROFILE;
};
export type SemanticConfig = SemanticPins & {
  enabled: boolean; workerEnabled: boolean; apiKey: string; timeoutMs: number;
  manuscriptAllowlist: string[];
};
export function semanticConfig(env: NodeJS.ProcessEnv = process.env): SemanticConfig {
  const get = (name: string) => env[`STORY_SEMANTIC_ANALYSIS_${name}`] ?? '';
  return {
    packingProfile: SEMANTIC_PACKING_PROFILE,
    enabled: get('ENABLED') === 'true', workerEnabled: get('WORKER_ENABLED') === 'true',
    manuscriptAllowlist: get('MANUSCRIPT_ID_ALLOWLIST').split(',').map(id => id.trim()).filter(Boolean),
    apiKey: get('API_KEY') || env.OPENAI_API_KEY || '', provider: get('PROVIDER'), model: get('MODEL'),
    rateCardId: get('RATE_CARD_ID'), rateCardVersion: get('RATE_CARD_VERSION'),
    inputKrwPerMillion: get('INPUT_KRW_PER_MILLION'),
    cachedInputKrwPerMillion: get('CACHED_INPUT_KRW_PER_MILLION'),
    outputKrwPerMillion: get('OUTPUT_KRW_PER_MILLION'),
    inputTokenLimit: Number(get('INPUT_TOKEN_LIMIT')),
    outputTokenLimit: Number(get('OUTPUT_TOKEN_LIMIT')),
    maxJobInputTokens: Number(get('MAX_JOB_INPUT_TOKENS')),
    maxJobOutputTokens: Number(get('MAX_JOB_OUTPUT_TOKENS')),
    maxJobCostKrw: get('MAX_JOB_COST_KRW'), timeoutMs: Number(get('TIMEOUT_MS') || 30000),
  };
}
export function semanticPins(config: SemanticPins): SemanticPins {
  const { provider, model, rateCardId, rateCardVersion, inputKrwPerMillion, cachedInputKrwPerMillion,
    outputKrwPerMillion, inputTokenLimit, outputTokenLimit, maxJobInputTokens, maxJobOutputTokens, maxJobCostKrw, packingProfile } = config;
  return { provider, model, rateCardId, rateCardVersion, inputKrwPerMillion, cachedInputKrwPerMillion,
    outputKrwPerMillion, inputTokenLimit, outputTokenLimit, maxJobInputTokens, maxJobOutputTokens, maxJobCostKrw,
    ...(packingProfile === undefined ? {} : { packingProfile }) };
}
export const semanticPinHash = (config: SemanticPins) => manuscriptContentHash(semanticPins(config));
export function semanticPackingProfile(pins: SemanticPins) {
  if (pins.packingProfile === undefined) return 'legacy_32' as const;
  if (pins.packingProfile === SEMANTIC_PACKING_PROFILE) return pins.packingProfile;
  throw new SemanticAnalysisError('analysis_packing_profile_unsupported');
}
export function assertSemanticJobPins(runtime: SemanticPins, saved: SemanticPins, hash: string | null) {
  semanticPackingProfile(saved);
  // Only the planner is selected by the immutable job. Every provider, rate and
  // budget field must still match current server configuration exactly.
  const current = { ...runtime, packingProfile: saved.packingProfile };
  if (hash !== semanticPinHash(saved) || hash !== semanticPinHash(current))
    throw new SemanticAnalysisError('analysis_configuration_changed');
}
export function semanticConfigFailure(config: SemanticConfig): string | undefined {
  if (!config.enabled) return 'semantic_analysis_disabled';
  if (config.packingProfile !== undefined && config.packingProfile !== SEMANTIC_PACKING_PROFILE)
    return 'analysis_packing_profile_unsupported';
  if (!config.apiKey.trim() || config.provider !== 'openai' || !storyContinuationModelEncoding(config.model))
    return 'semantic_provider_configuration_invalid';
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(config.rateCardId) ||
    !/^[a-zA-Z0-9._:-]{1,128}$/.test(config.rateCardVersion)) return 'semantic_rate_configuration_invalid';
  if (!integer(config.inputTokenLimit, 2048, 32000) || !integer(config.outputTokenLimit, 512, 16000) ||
    !integer(config.maxJobInputTokens, config.inputTokenLimit, 100000000) ||
    !integer(config.maxJobOutputTokens, config.outputTokenLimit, 100000000) ||
    !integer(config.timeoutMs, 100, 60000)) return 'semantic_budget_configuration_invalid';
  const rates = [config.inputKrwPerMillion, config.cachedInputKrwPerMillion, config.outputKrwPerMillion, config.maxJobCostKrw];
  if (rates.some(value => !/^\d{1,12}(\.\d{1,6})?$/.test(value))) return 'semantic_rate_configuration_invalid';
  if (new Decimal(config.maxJobCostKrw).lte(0) ||
    new Decimal(config.cachedInputKrwPerMillion).gt(config.inputKrwPerMillion)) return 'semantic_rate_configuration_invalid';
}
export function semanticCost(pins: SemanticPins, input: number, output: number, cached = 0): Decimal {
  // Output includes reasoning; cached input is already a subset of total input.
  return new Decimal(input - cached).mul(pins.inputKrwPerMillion)
    .add(new Decimal(cached).mul(pins.cachedInputKrwPerMillion))
    .add(new Decimal(output).mul(pins.outputKrwPerMillion)).div(1000000);
}
export function semanticReservation(pins: SemanticPins, input: number, output: number, chunks: number): Decimal {
  // Covers per-chunk cost rounding as well as uncached-input worst-case usage.
  return semanticCost(pins, input, output).add(new Decimal(chunks).mul('0.000001')).toDecimalPlaces(6, Decimal.ROUND_CEIL);
}
function integer(value: number, min: number, max: number) { return Number.isSafeInteger(value) && value >= min && value <= max; }

export const STORY_CONTINUATION_TIMING_VERSION = 'continuation-timing-v1';

export type StoryContinuationTimingPolicy = Readonly<{
  version: typeof STORY_CONTINUATION_TIMING_VERSION;
  providerDeadlineMs: number;
  executorDeadlineMs: number;
  preparationMs: number;
  settlementMs: number;
  clockMarginMs: number;
  leaseMs: number;
  abortGraceMs: number;
  failurePersistenceMs: number;
  drainMs: number;
}>;
type TimingOverrides = Partial<Omit<StoryContinuationTimingPolicy, 'version'>>;

const TIMING_KEYS = [
  'providerDeadlineMs', 'executorDeadlineMs', 'preparationMs', 'settlementMs',
  'clockMarginMs', 'leaseMs', 'abortGraceMs', 'failurePersistenceMs', 'drainMs',
];

export class StoryContinuationTimingPolicyError extends Error {
  constructor() { super('continuation_timing_policy_invalid'); }
}

// Pure configuration validation only. Runtime consumers must enforce real DB bounds,
// cancellation and durable dispatch fencing; a timer race alone is not DB cancellation.
export function createStoryContinuationTimingPolicy(overrides: TimingOverrides = {}): StoryContinuationTimingPolicy {
  if (!record(overrides) || Object.keys(overrides).some(key => !TIMING_KEYS.includes(key)) ||
      Object.values(overrides).some(value => typeof value !== 'number' || !Number.isSafeInteger(value))) invalid();
  const providerDeadlineMs = overrides.providerDeadlineMs ?? 90_000;
  const executorDeadlineMs = overrides.executorDeadlineMs ?? providerDeadlineMs + 5_000;
  const preparationMs = overrides.preparationMs ?? 15_000;
  const settlementMs = overrides.settlementMs ?? 10_000;
  const clockMarginMs = overrides.clockMarginMs ?? 5_000;
  const abortGraceMs = overrides.abortGraceMs ?? 5_000;
  const failurePersistenceMs = overrides.failurePersistenceMs ?? 10_000;
  const policy = {
    version: STORY_CONTINUATION_TIMING_VERSION,
    providerDeadlineMs, executorDeadlineMs, preparationMs, settlementMs, clockMarginMs,
    leaseMs: overrides.leaseMs ?? preparationMs + executorDeadlineMs + settlementMs + clockMarginMs,
    abortGraceMs, failurePersistenceMs,
    drainMs: overrides.drainMs ?? Math.max(preparationMs, settlementMs) +
      abortGraceMs + failurePersistenceMs + clockMarginMs,
  };
  assertStoryContinuationTimingPolicy(policy);
  return Object.freeze(policy);
}

export function assertStoryContinuationTimingPolicy(value: unknown): asserts value is StoryContinuationTimingPolicy {
  if (!record(value) || value.version !== STORY_CONTINUATION_TIMING_VERSION ||
      Object.keys(value).length !== TIMING_KEYS.length + 1 ||
      TIMING_KEYS.some(key => !Object.prototype.hasOwnProperty.call(value, key)) ||
      !inRange(value.providerDeadlineMs, 100, 240_000) ||
      !inRange(value.executorDeadlineMs, value.providerDeadlineMs + 1_000, 245_000) ||
      !inRange(value.preparationMs, 100, 30_000) ||
      !inRange(value.settlementMs, 100, 30_000) ||
      !inRange(value.clockMarginMs, 100, 10_000) ||
      !inRange(value.abortGraceMs, 100, 10_000) ||
      !inRange(value.failurePersistenceMs, 100, 30_000) ||
      !inRange(value.leaseMs, value.preparationMs + value.executorDeadlineMs +
        value.settlementMs + value.clockMarginMs, 300_000) ||
      !inRange(value.drainMs, Math.max(value.preparationMs, value.settlementMs) +
        value.abortGraceMs + value.failurePersistenceMs + value.clockMarginMs, 120_000)) invalid();
}

// A failed check is a no-send decision, not permission to clear an existing fence.
export function storyContinuationDispatchFitsLease(
  policy: StoryContinuationTimingPolicy,
  leaseExpiresAtMs: number,
  nowMs: number,
): boolean {
  assertStoryContinuationTimingPolicy(policy);
  if (!Number.isSafeInteger(leaseExpiresAtMs) || !Number.isSafeInteger(nowMs) ||
      leaseExpiresAtMs < 0 || nowMs < 0) return false;
  return leaseExpiresAtMs - nowMs >= policy.executorDeadlineMs + policy.settlementMs + policy.clockMarginMs;
}

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(): never { throw new StoryContinuationTimingPolicyError(); }

import {
  assertStoryContinuationTimingPolicy,
  createStoryContinuationTimingPolicy,
  storyContinuationDispatchFitsLease,
} from './story-continuation-timing.policy';

describe('independent continuation timing policy', () => {
  it('allows long-form story generation while keeping bounded execution and drain timing', () => {
    const policy = createStoryContinuationTimingPolicy();
    expect(policy).toMatchObject({ version: 'continuation-timing-v1', providerDeadlineMs: 90_000,
      executorDeadlineMs: 95_000, leaseMs: 125_000, drainMs: 35_000 });
    expect(Object.isFrozen(policy)).toBe(true);
    expect(policy).not.toHaveProperty('enabled');
  });

  it('coordinates a deliberately longer deadline within existing lease/drain ceilings', () => {
    expect(createStoryContinuationTimingPolicy({ providerDeadlineMs: 240_000 })).toMatchObject({
      providerDeadlineMs: 240_000, executorDeadlineMs: 245_000, leaseMs: 275_000, drainMs: 35_000,
    });
  });

  it('drains bounded outstanding DB work and persistence rather than the whole provider deadline', () => {
    expect(createStoryContinuationTimingPolicy({ preparationMs: 30_000, settlementMs: 25_000 }))
      .toMatchObject({ leaseMs: 155_000, drainMs: 50_000 });
  });

  it.each([
    { providerDeadlineMs: 99 }, { providerDeadlineMs: 240_001 }, { providerDeadlineMs: NaN },
    { providerDeadlineMs: Infinity }, { executorDeadlineMs: 25_999 }, { executorDeadlineMs: 245_001 },
    { preparationMs: 30_001 }, { settlementMs: 0 }, { clockMarginMs: 0 },
    { abortGraceMs: 0 }, { failurePersistenceMs: -1 }, { drainMs: 34_999 },
    { drainMs: 120_001 }, { leaseMs: 124_999 }, { leaseMs: 300_001 }, { leaseMs: 125_000.5 },
    { providerDeadlineMs: 240_000, preparationMs: 30_000, settlementMs: 30_000 },
  ])('rejects incompatible durations instead of silently clamping', overrides => {
    expect(() => createStoryContinuationTimingPolicy(overrides)).toThrow('continuation_timing_policy_invalid');
  });

  it('allows exactly the repository lease ceiling when all margins fit', () => {
    expect(createStoryContinuationTimingPolicy({ providerDeadlineMs: 240_000, preparationMs: 30_000,
      settlementMs: 20_000, leaseMs: 300_000 }).leaseMs).toBe(300_000);
  });

  it.each([null, [], { version: 'unknown' }, { providerDeadlineMs: '25000' }, { surprise: 'private' }].map(value => [value]))(
    'rejects malformed raw configuration without reflecting its payload', value => {
      expect(() => createStoryContinuationTimingPolicy(value as never)).toThrow('continuation_timing_policy_invalid');
    },
  );

  it('never fills missing saved pins with new runtime defaults', () => {
    const { drainMs: _drain, ...partial } = createStoryContinuationTimingPolicy();
    expect(() => assertStoryContinuationTimingPolicy(partial)).toThrow('continuation_timing_policy_invalid');
    expect(() => assertStoryContinuationTimingPolicy({ ...createStoryContinuationTimingPolicy(), version: 'v2' }))
      .toThrow('continuation_timing_policy_invalid');
  });

  it('requires the actual remaining lease to cover execution, settlement and clock margin', () => {
    const policy = createStoryContinuationTimingPolicy();
    const now = 1_000_000;
    expect(storyContinuationDispatchFitsLease(policy, now + 110_000, now)).toBe(true);
    expect(storyContinuationDispatchFitsLease(policy, now + 109_999, now)).toBe(false);
    expect(storyContinuationDispatchFitsLease(policy, now - 1, now)).toBe(false);
  });

  it.each([NaN, Infinity, -1, 1.5])('fails closed for invalid wall-clock/lease values', value => {
    const policy = createStoryContinuationTimingPolicy();
    expect(storyContinuationDispatchFitsLease(policy, value, 1_000)).toBe(false);
    expect(storyContinuationDispatchFitsLease(policy, 100_000, value)).toBe(false);
  });
});

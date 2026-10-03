import { randomUUID } from 'crypto';
import {
  evaluateAuthorBodyTrialBudget,
  StoryAuthorBodyTrialBudgetError,
  summarizeAuthorBodyTrialCosts,
  summarizeApprovedAuthorBodyTrialCosts,
  authorBodyTrialHistoricalSeparationReference,
} from './story-author-body-trial-budget.policy';

type Snapshot = Parameters<typeof summarizeAuthorBodyTrialCosts>[0];
type Continuation = Snapshot['continuations'][number];
type Ledger = Snapshot['ledger'][number];

const userId = randomUUID();
const workId = randomUUID();
const dispatchedAt = new Date('2026-10-01T00:00:00.000Z');

function continuation(overrides: Partial<Continuation> = {}): Continuation {
  return {
    id: randomUUID(),
    userId,
    workId,
    requestKind: 'recommended_choice',
    status: 'queued',
    attemptCount: 0,
    maxAttempts: 1,
    dispatchStartedAt: null,
    estimatedCostKrw: '0.100000',
    hardBudgetKrw: '0.300000',
    actualCostKrw: null,
    sharedResultReused: false,
    sharedResultEvidenceVerified: false,
    sharedResultId: null,
    resultGeneratedSceneId: null,
    ...overrides,
  };
}

function ledger(row: Continuation, overrides: Partial<Ledger> = {}): Ledger {
  return {
    id: randomUUID(),
    continuationId: row.id,
    userId: row.userId,
    workId: row.workId,
    eventKind: 'recommended_route_request',
    status: 'reserved',
    provenance: 'ai_generated',
    estimatedCostKrw: row.estimatedCostKrw,
    actualCostKrw: null,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    imageUnits: 0,
    ...overrides,
  };
}

function snapshot(rows: Continuation[] = [], entries?: Ledger[]): Snapshot {
  return {
    userId,
    workId,
    complete: true,
    continuations: rows,
    ledger: entries ?? rows.map((row) => ledger(row)),
  };
}

describe('confirmed no-provider authorization cancellation costs', () => {
  function cancelled(overrides: Partial<Continuation> = {}, tokens = 0) {
    const row = continuation({ status: 'failed', attemptCount: 1, actualCostKrw: '0.000000',
      confirmedNoProviderDispatch: true, ...overrides });
    return snapshot([row], [ledger(row), ledger(row, { eventKind: 'new_route_failed', status: 'failed',
      actualCostKrw: '0.000000', inputTokens: tokens })]);
  }
  it('allows a new reservation only with a confirmed first-attempt uncharged cancellation', () => {
    expect(evaluateAuthorBodyTrialBudget(cancelled(), '0.300000', '0.300000'))
      .toMatchObject({ knownActualCostKrw: '0.000000', unknownCostCount: 0, mayReserve: true });
  });
  it.each([
    { confirmedNoProviderDispatch: false },
    { attemptCount: 0 }, { attemptCount: 2, maxAttempts: 2 },
  ])('keeps a missing or contradictory cancellation proof unknown: %p', override => {
    expect(summarizeAuthorBodyTrialCosts(cancelled(override))).toMatchObject({ unknownCostCount: 1 });
  });
  it('does not accept nonzero reported provider usage as an uncharged cancellation', () => {
    expect(summarizeAuthorBodyTrialCosts(cancelled({}, 1))).toMatchObject({ unknownCostCount: 1 });
  });
});

function charged(actualCostKrw = '0.200000') {
  const row = continuation({
    status: 'completed',
    attemptCount: 1,
    dispatchStartedAt: dispatchedAt,
    actualCostKrw,
    resultGeneratedSceneId: randomUUID(),
  });
  const request = ledger(row);
  const settlement = ledger(row, {
    eventKind: 'new_route_completed',
    status: 'completed',
    actualCostKrw,
    inputTokens: 10,
    outputTokens: 20,
  });
  return { row, request, settlement, state: snapshot([row], [request, settlement]) };
}

function reused() {
  const row = continuation({
    status: 'completed',
    sharedResultReused: true,
    sharedResultEvidenceVerified: true,
    sharedResultId: randomUUID(),
    resultGeneratedSceneId: randomUUID(),
    estimatedCostKrw: '0.000000',
    actualCostKrw: '0.000000',
  });
  const entry = ledger(row, {
    eventKind: 'shared_route_reused',
    status: 'completed',
    provenance: 'ai_reused',
    estimatedCostKrw: '0.000000',
    actualCostKrw: '0.000000',
  });
  return { row, entry, state: snapshot([row], [entry]) };
}

function expectInvalid(action: () => unknown, rawValues: string[] = []) {
  let error: unknown;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(StoryAuthorBodyTrialBudgetError);
  if (error instanceof Error) {
    for (const value of rawValues) expect(error.message).not.toContain(value);
  }
}

// Unverifiable records may be classified as unknown or rejected as contradictory.
function expectNotFree(state: Snapshot) {
  let result: ReturnType<typeof evaluateAuthorBodyTrialBudget>;
  try {
    result = evaluateAuthorBodyTrialBudget(state, '100', '1');
  } catch (error) {
    expect(error).toBeInstanceOf(StoryAuthorBodyTrialBudgetError);
    return;
  }
  expect(result.mayReserve).toBe(false);
  expect(result.reason).toBe('unknown_cost');
  expect(result.unknownCostCount).toBeGreaterThan(0);
  expect(result.verifiedSharedReuseCount).toBe(0);
}

describe('summarizeAuthorBodyTrialCosts', () => {
  it('summarizes an empty complete snapshot with six-decimal amounts', () => {
    expect(summarizeAuthorBodyTrialCosts(snapshot())).toEqual({
      knownActualCostKrw: '0.000000',
      reservedMaximumCostKrw: '0.000000',
      committedCostKrw: '0.000000',
      requestCount: 0,
      pendingCount: 0,
      unknownCostCount: 0,
      verifiedSharedReuseCount: 0,
    });
  });

  it('reserves hard budget times maximum attempts for every pending status', () => {
    const rows = [
      continuation({ status: 'queued', hardBudgetKrw: '2', maxAttempts: 3 }),
      continuation({ status: 'processing', attemptCount: 1, dispatchStartedAt: dispatchedAt }),
      continuation({ status: 'retry_wait', attemptCount: 1, maxAttempts: 2, dispatchStartedAt: dispatchedAt }),
    ];
    expect(summarizeAuthorBodyTrialCosts(snapshot(rows))).toEqual({
      knownActualCostKrw: '0.000000',
      reservedMaximumCostKrw: '6.900000',
      committedCostKrw: '6.900000',
      requestCount: 3,
      pendingCount: 3,
      unknownCostCount: 0,
      verifiedSharedReuseCount: 0,
    });
  });

  it('counts a completed actual once, without adding its request estimate or hard budget', () => {
    expect(summarizeAuthorBodyTrialCosts(charged().state)).toEqual({
      knownActualCostKrw: '0.200000',
      reservedMaximumCostKrw: '0.000000',
      committedCostKrw: '0.200000',
      requestCount: 1,
      pendingCount: 0,
      unknownCostCount: 0,
      verifiedSharedReuseCount: 0,
    });
  });

  it('combines known actuals and multiple outstanding reservations', () => {
    const done = charged('1.25');
    const pending = [continuation({ maxAttempts: 2 }), continuation({ hardBudgetKrw: '0.4' })];
    const state = snapshot([done.row, ...pending], [done.request, done.settlement, ...pending.map((row) => ledger(row))]);
    expect(summarizeAuthorBodyTrialCosts(state)).toMatchObject({
      knownActualCostKrw: '1.250000',
      reservedMaximumCostKrw: '1.000000',
      committedCostKrw: '2.250000',
      requestCount: 3,
      pendingCount: 2,
      unknownCostCount: 0,
    });
  });

  it('treats failed and timed-out null settlements as unknown even with zero usage', () => {
    for (const status of ['failed', 'timeout'] as const) {
      const row = continuation({ status, attemptCount: 1, dispatchStartedAt: dispatchedAt });
      const state = snapshot([row], [ledger(row), ledger(row, {
        eventKind: status === 'failed' ? 'new_route_failed' : 'new_route_timeout',
        status,
      })]);
      expect(summarizeAuthorBodyTrialCosts(state)).toMatchObject({ unknownCostCount: 1, pendingCount: 0 });
      expect(evaluateAuthorBodyTrialBudget(state, '100', '1')).toMatchObject({ mayReserve: false, reason: 'unknown_cost' });
    }
  });

  it('keeps multiple dispatched attempts unknown despite a matching final actual', () => {
    const done = charged();
    done.row.attemptCount = 2;
    done.row.maxAttempts = 2;
    expect(summarizeAuthorBodyTrialCosts(done.state).unknownCostCount).toBe(1);
    expect(evaluateAuthorBodyTrialBudget(done.state, '100', '1')).toMatchObject({ mayReserve: false, reason: 'unknown_cost' });
  });

  it('treats missing request or settlement evidence as unknown, not free', () => {
    const done = charged();
    for (const entries of [[], [done.request], [done.settlement]]) {
      const state = snapshot([done.row], entries);
      expect(summarizeAuthorBodyTrialCosts(state).unknownCostCount).toBe(1);
      expect(evaluateAuthorBodyTrialBudget(state, '100', '1').mayReserve).toBe(false);
    }
  });

  it('ignores approved compensation without refunding generated cost', () => {
    const done = charged('2');
    done.state.ledger.push(ledger(done.row, {
      eventKind: 'approved_compensation',
      status: 'compensated',
      actualCostKrw: '3',
    }));
    expect(summarizeAuthorBodyTrialCosts(done.state)).toMatchObject({
      knownActualCostKrw: '2.000000', committedCostKrw: '2.000000', unknownCostCount: 0,
    });
    expect(evaluateAuthorBodyTrialBudget(done.state, '2', '0.000001')).toMatchObject({ mayReserve: false, reason: 'budget_exceeded' });
  });

  it('verifies strictly zero-cost shared reuse with exactly one reuse ledger', () => {
    expect(summarizeAuthorBodyTrialCosts(reused().state)).toEqual({
      knownActualCostKrw: '0.000000',
      reservedMaximumCostKrw: '0.000000',
      committedCostKrw: '0.000000',
      requestCount: 1,
      pendingCount: 0,
      unknownCostCount: 0,
      verifiedSharedReuseCount: 1,
    });
  });

  it('does not verify reuse when any required continuation evidence is absent or contradictory', () => {
    const changes: Partial<Continuation>[] = [
      { status: 'failed' }, { attemptCount: 1 }, { dispatchStartedAt: dispatchedAt },
      { sharedResultReused: false }, { sharedResultEvidenceVerified: false },
      { sharedResultId: null }, { resultGeneratedSceneId: null },
      { estimatedCostKrw: '0.000001' }, { actualCostKrw: null }, { actualCostKrw: '0.000001' },
    ];
    for (const change of changes) {
      const reuse = reused();
      Object.assign(reuse.row, change);
      expectNotFree(reuse.state);
    }
  });

  it('requires all reuse ledger monetary and usage values to be zero', () => {
    const changes: Partial<Ledger>[] = [
      { estimatedCostKrw: '0.000001' }, { actualCostKrw: null }, { actualCostKrw: '0.000001' },
      { inputTokens: 1 }, { outputTokens: 1 }, { cachedInputTokens: 1 }, { imageUnits: 1 },
      { provenance: 'ai_generated' }, { status: 'reserved' },
    ];
    for (const change of changes) {
      const reuse = reused();
      Object.assign(reuse.entry, change);
      expectNotFree(reuse.state);
    }
  });

  it('rejects free reuse without its sole ledger or with request/settlement evidence', () => {
    for (const variant of ['missing', 'duplicate', 'request', 'settlement'] as const) {
      const reuse = reused();
      if (variant === 'missing') reuse.state.ledger = [];
      if (variant === 'duplicate') reuse.state.ledger.push({ ...reuse.entry, id: randomUUID() });
      if (variant === 'request') reuse.state.ledger.push(ledger(reuse.row));
      if (variant === 'settlement') reuse.state.ledger.push(ledger(reuse.row, {
        eventKind: 'new_route_completed', status: 'completed', actualCostKrw: '0',
      }));
      expectNotFree(reuse.state);
    }
  });

  it('does not trust contradictory or duplicate completed settlement evidence', () => {
    const mismatch = charged();
    mismatch.settlement.actualCostKrw = '0.250000';
    expectNotFree(mismatch.state);
    const duplicate = charged();
    duplicate.state.ledger.push({ ...duplicate.settlement, id: randomUUID() });
    expectNotFree(duplicate.state);
  });

  it('rejects duplicate continuation and ledger IDs', () => {
    const row = continuation();
    expectInvalid(() => summarizeAuthorBodyTrialCosts(snapshot([row, { ...row }])), [row.id]);
    const done = charged();
    done.settlement.id = done.request.id;
    expectInvalid(() => summarizeAuthorBodyTrialCosts(done.state), [done.request.id]);
  });

  it('rejects out-of-scope continuations, ledger rows, and orphan ledger rows without exposing IDs', () => {
    for (const target of ['continuation', 'ledger'] as const) {
      for (const field of ['userId', 'workId'] as const) {
        const done = charged();
        const foreignId = randomUUID();
        (target === 'continuation' ? done.row : done.request)[field] = foreignId;
        expectInvalid(() => summarizeAuthorBodyTrialCosts(done.state), [foreignId]);
      }
    }
    const done = charged();
    done.request.continuationId = randomUUID();
    expectInvalid(() => summarizeAuthorBodyTrialCosts(done.state), [done.request.continuationId]);
  });

  it('rejects unsupported continuation status/kind and ledger status/kind', () => {
    for (const target of ['continuation', 'ledger'] as const) {
      for (const field of target === 'continuation' ? ['status', 'requestKind'] : ['status', 'eventKind']) {
        const done = charged();
        const record = target === 'continuation' ? done.row : done.request;
        Object.assign(record, { [field]: 'unsupported-private-value' });
        expectInvalid(() => summarizeAuthorBodyTrialCosts(done.state), ['unsupported-private-value']);
      }
    }
  });

  it('rejects malformed monetary values on continuations and ledger entries without leaking them', () => {
    for (const invalid of ['-12345.67', '12345e2', '12345.1234567']) {
      for (const field of ['estimatedCostKrw', 'hardBudgetKrw', 'actualCostKrw'] as const) {
        const done = charged();
        done.row[field] = invalid;
        expectInvalid(() => summarizeAuthorBodyTrialCosts(done.state), [invalid]);
      }
      for (const field of ['estimatedCostKrw', 'actualCostKrw'] as const) {
        const done = charged();
        done.settlement[field] = invalid;
        expectInvalid(() => summarizeAuthorBodyTrialCosts(done.state), [invalid]);
      }
    }
  });

  it('rejects incomplete snapshots in both entry points', () => {
    const state = { ...snapshot(), complete: false };
    expectInvalid(() => summarizeAuthorBodyTrialCosts(state));
    expectInvalid(() => evaluateAuthorBodyTrialBudget(state, '1', '0.1'));
  });
});

describe('evaluateAuthorBodyTrialBudget', () => {
  it('allows a reservation within budget and includes the complete summary', () => {
    const state = charged('1.25').state;
    const result = evaluateAuthorBodyTrialBudget(state, '2', '0.5');
    expect(result).toMatchObject({
      ...summarizeAuthorBodyTrialCosts(state),
      mayReserve: true,
      reason: 'within_budget',
      maximumAfterReservationKrw: '1.750000',
    });
    expect(result.remainingBudgetKrw).toMatch(/^\d+\.\d{6}$/);
  });

  it('uses exact decimal arithmetic at the 0.1 + 0.2 budget boundary', () => {
    const state = charged('0.1').state;
    expect(evaluateAuthorBodyTrialBudget(state, '0.3', '0.2')).toMatchObject({
      mayReserve: true, reason: 'within_budget', maximumAfterReservationKrw: '0.300000',
    });
    expect(evaluateAuthorBodyTrialBudget(state, '0.3', '0.200001')).toMatchObject({
      mayReserve: false, reason: 'budget_exceeded', maximumAfterReservationKrw: '0.300001',
    });
  });

  it('includes existing reservations when refusing an over-budget next maximum', () => {
    const state = snapshot([continuation({ hardBudgetKrw: '0.4', maxAttempts: 2 })]);
    expect(evaluateAuthorBodyTrialBudget(state, '1', '0.3')).toMatchObject({
      mayReserve: false,
      reason: 'budget_exceeded',
      reservedMaximumCostKrw: '0.800000',
      committedCostKrw: '0.800000',
      maximumAfterReservationKrw: '1.100000',
    });
  });

  it('requires positive exact budget and next maximum values without exposing invalid inputs', () => {
    for (const invalid of ['0', '0.000000', '-12345', '12345e2', '12345.1234567', '']) {
      expectInvalid(() => evaluateAuthorBodyTrialBudget(snapshot(), invalid, '1'), invalid ? [invalid] : []);
      expectInvalid(() => evaluateAuthorBodyTrialBudget(snapshot(), '1', invalid), invalid ? [invalid] : []);
    }
  });
});

describe('explicitly pinned historical unknown costs (no reset or rolling exemption)', () => {
  const cutoff = new Date('2026-10-04T00:00:00Z');
  function separated() {
    const old: Continuation[] = [continuation(), continuation()].map(row => ({ ...row, status: 'failed', attemptCount: 1,
      maxAttempts: 3, createdAt: new Date('2026-09-27T00:00:00Z'), authorBodyTrialApprovalId: null,
      dispatchStartedAt: dispatchedAt }));
    const known = charged('45.589500');
    Object.assign(known.row, { createdAt: dispatchedAt, authorBodyTrialApprovalId: null });
    const state = snapshot([...old, known.row], [...old.flatMap(row => [ledger(row),
      ledger(row, { eventKind: 'new_route_failed', status: 'failed' })]), known.request, known.settlement]);
    const approval = { createdAt: cutoff, approvalReference: authorBodyTrialHistoricalSeparationReference(state, cutoff) };
    return { state, approval, old };
  }
  it('keeps all-history GET unknown and known spending while the exact approved pair is separate', () => {
    const { state, approval } = separated();
    const before = JSON.stringify(state);
    expect(summarizeAuthorBodyTrialCosts(state)).toMatchObject({ unknownCostCount: 2, knownActualCostKrw: '45.589500' });
    expect(summarizeApprovedAuthorBodyTrialCosts(state, approval)).toMatchObject({
      requestCount: 1, unknownCostCount: 0, historicalUnknownCostCount: 2,
      costScope: 'approved_historical_unknown_separation', committedCostKrw: '45.589500' });
    expect(JSON.stringify(state)).toBe(before);
    expect(approval.approvalReference.length).toBeLessThanOrEqual(128);
  });
  it('does not automatically apply the policy to old or absent approval references', () => {
    const { state } = separated();
    expect(summarizeApprovedAuthorBodyTrialCosts(state, {})).toMatchObject({ unknownCostCount: 2, historicalUnknownCostCount: 0 });
    expect(summarizeApprovedAuthorBodyTrialCosts(state, { approvalReference: 'user-approved-20261002-monster-body-10000' }))
      .toMatchObject({ unknownCostCount: 2, costScope: 'all_recommended_body_requests_for_author_work' });
  });
  it.each(['reference', 'cutoff', 'missing-date', 'attached-trial', 'ledger', 'new-historical-record'])
    ('fails closed when approved evidence changes: %s', mode => {
      const { state, approval, old } = separated();
      if (mode === 'reference') approval.approvalReference += '0';
      if (mode === 'cutoff') approval.createdAt = new Date(cutoff.getTime() + 1);
      if (mode === 'missing-date') delete old[0].createdAt;
      if (mode === 'attached-trial') old[0].authorBodyTrialApprovalId = randomUUID();
      if (mode === 'ledger') state.ledger[1].outputTokens = 1;
      if (mode === 'new-historical-record') {
        const row = { ...old[0], id: randomUUID() };
        state.continuations.push(row); state.ledger.push(ledger(row), ledger(row, { eventKind: 'new_route_failed', status: 'failed' }));
      }
      expectInvalid(() => summarizeApprovedAuthorBodyTrialCosts(state, approval));
    });
  it('counts new pending maximums and keeps new unknown failures blocking', () => {
    const { state, approval } = separated();
    const row = continuation({ createdAt: new Date(cutoff.getTime() + 1), authorBodyTrialApprovalId: randomUUID(), hardBudgetKrw: '300' });
    state.continuations.push(row); state.ledger.push(ledger(row));
    expect(summarizeApprovedAuthorBodyTrialCosts(state, approval)).toMatchObject({
      reservedMaximumCostKrw: '300.000000', committedCostKrw: '345.589500', pendingCount: 1, unknownCostCount: 0 });
    Object.assign(row, { status: 'failed', attemptCount: 1, dispatchStartedAt: new Date() });
    state.ledger.push(ledger(row, { eventKind: 'new_route_failed', status: 'failed' }));
    expect(summarizeApprovedAuthorBodyTrialCosts(state, approval)).toMatchObject({ unknownCostCount: 1, historicalUnknownCostCount: 2 });
  });
  it('never issues a new separation reference while an additional unknown/pending request exists', () => {
    const { state } = separated(); const row = continuation({ createdAt: cutoff, authorBodyTrialApprovalId: randomUUID() });
    state.continuations.push(row); state.ledger.push(ledger(row));
    expectInvalid(() => authorBodyTrialHistoricalSeparationReference(state, cutoff));
  });
});

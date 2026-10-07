import { randomUUID } from 'crypto';
import {
  authorBodyTrialHistoricalSeparationReference,
  summarizeAuthorBodyTrialCosts,
  type AuthorBodyTrialContinuationCost,
  type AuthorBodyTrialLedgerCost,
} from './story-author-body-trial-budget.policy';
import {
  authorBodyTrialUnknownHoldEvidenceSha256,
  evaluateAuthorBodyTrialUnknownHolds,
  StoryAuthorBodyTrialUnknownHoldError,
  type AuthorBodyTrialUnknownHold,
  type AuthorBodyTrialUnknownHoldApproval,
  type AuthorBodyTrialUnknownHoldInput,
} from './story-author-body-trial-unknown-hold.policy';

function entries(row: AuthorBodyTrialContinuationCost): AuthorBodyTrialLedgerCost[] {
  const reserved: AuthorBodyTrialLedgerCost = {
    id: randomUUID(), continuationId: row.id, userId: row.userId, workId: row.workId,
    eventKind: 'recommended_route_request', status: 'reserved', provenance: 'ai_generated',
    estimatedCostKrw: row.estimatedCostKrw, actualCostKrw: null,
    inputTokens: 17, outputTokens: 9, cachedInputTokens: 2, imageUnits: 0,
  };
  return [reserved, { ...reserved, id: randomUUID(), eventKind: `new_route_${row.status}`,
    status: row.status, actualCostKrw: row.actualCostKrw }];
}

function fixture(actualCostKrw = '9699.000000') {
  const approval: AuthorBodyTrialUnknownHoldApproval = {
    id: randomUUID(), userId: randomUUID(), workId: randomUUID(), releaseId: randomUUID(),
    manuscriptVersionId: randomUUID(), releaseChecksum: 'a'.repeat(64), capabilityRevision: 1,
    styleConsentId: randomUUID(), styleConsentRevision: 1, analysisJobId: randomUUID(), analysisVersion: 1,
    generationProfileId: randomUUID(), generationProfileRevision: 1, generationProfileFingerprint: 'b'.repeat(64),
    approvedBudgetKrw: '10000.000000', approvalReference: 'synthetic-existing-approval', status: 'active',
    createdAt: new Date('2026-01-01T00:00:00Z'), expiresAt: new Date('2026-01-01T02:00:00Z'),
  };
  const unknown: AuthorBodyTrialContinuationCost = {
    id: randomUUID(), userId: approval.userId, workId: approval.workId, requestKind: 'recommended_choice',
    status: 'failed', attemptCount: 1, maxAttempts: 1, dispatchStartedAt: new Date('2026-01-01T00:02:00Z'),
    estimatedCostKrw: '100.000000', hardBudgetKrw: '300.000000', actualCostKrw: null,
    sharedResultReused: false, sharedResultEvidenceVerified: false, confirmedNoProviderDispatch: false,
    sharedResultId: null, resultGeneratedSceneId: null,
    createdAt: new Date('2026-01-01T00:01:00Z'), authorBodyTrialApprovalId: approval.id,
  };
  const known = { ...unknown, id: randomUUID(), status: 'completed', actualCostKrw,
    resultGeneratedSceneId: randomUUID() };
  const input: AuthorBodyTrialUnknownHoldInput = {
    now: new Date('2026-01-01T01:00:00Z'), approval,
    currentAuthorization: { verified: true, checkedAt: new Date('2026-01-01T01:00:00Z'), approval: { ...approval } },
    snapshot: { userId: approval.userId, workId: approval.workId, complete: true,
      continuations: [unknown, known], ledger: [...entries(unknown), ...entries(known)] },
    acknowledgement: {
      id: randomUUID(), trialApprovalId: approval.id, userId: approval.userId, workId: approval.workId,
      status: 'active', createdAt: new Date('2026-01-01T00:03:00Z'), expiresAt: approval.expiresAt,
      originalApprovedBudgetKrw: approval.approvedBudgetKrw, maximumTotalHoldKrw: 300,
      provisionalHoldOnly: true, unknownCostRemainsUnknown: true, notProviderChargeOrLiabilityCeiling: true,
    },
    holdsComplete: true, existingHolds: [], nextMaximumCostKrw: '1.000000',
  };
  const hold: AuthorBodyTrialUnknownHold = {
    id: randomUUID(), continuationId: unknown.id, idempotencyKey: randomUUID(),
    acknowledgementId: input.acknowledgement.id,
    unknownEvidenceSha256: authorBodyTrialUnknownHoldEvidenceSha256(input.snapshot, unknown.id),
    amountKrw: 300, status: 'active', createdAt: new Date('2026-01-01T00:04:00Z'), expiresAt: approval.expiresAt,
  };
  input.requestedHold = hold;
  return { input, approval, unknown, known, hold };
}

function refreshEvidence(f: ReturnType<typeof fixture>) {
  f.hold.unknownEvidenceSha256 = authorBodyTrialUnknownHoldEvidenceSha256(f.input.snapshot, f.unknown.id);
}

describe('provisional unknown holds (pure synthetic evidence only)', () => {
  it('allows the exact original cap without settling, hiding UNKNOWN, or granting generation', () => {
    const f = fixture(), before = JSON.stringify(f.input);
    const result = evaluateAuthorBodyTrialUnknownHolds(f.input);
    expect(result).toMatchObject({ knownActualCostKrw: '9699.000000', committedCostKrw: '9699.000000',
      provisionalHeldAmountKrw: '300.000000', budgetCommittedIncludingHoldsKrw: '9999.000000',
      maximumAfterReservationKrw: '10000.000000', approvedBudgetKrw: '10000.000000',
      remainingBudgetIncludingHoldsKrw: '1.000000', unknownCostCount: 1, provisionalHeldCount: 1,
      unresolvedUnheldCount: 0, unknownCostState: 'UNKNOWN', requestedHoldState: 'new',
      mayReserve: true, generationAuthorized: false, holdIsProviderCharge: false,
      holdIsGuaranteedLiabilityCeiling: false });
    expect(evaluateAuthorBodyTrialUnknownHolds(f.input)).toEqual(result);
    expect(JSON.stringify(f.input)).toBe(before);
    expect(f.unknown.actualCostKrw).toBeNull();
    expect(summarizeAuthorBodyTrialCosts(f.input.snapshot).unknownCostCount).toBe(1);
  });

  it('handles six-decimal boundaries without rounding a micro-won overrun away', () => {
    const f = fixture('9699.999999'); f.input.nextMaximumCostKrw = '0.000001';
    expect(evaluateAuthorBodyTrialUnknownHolds(f.input)).toMatchObject({ mayReserve: true,
      maximumAfterReservationKrw: '10000.000000' });
    f.input.nextMaximumCostKrw = '0.000002';
    expect(evaluateAuthorBodyTrialUnknownHolds(f.input)).toMatchObject({ mayReserve: false,
      reason: 'budget_exceeded', maximumAfterReservationKrw: '10000.000001' });
  });

  it('retains hard-budget times max-attempt pending reservations', () => {
    const f = fixture('9400');
    const pending = { ...f.unknown, id: randomUUID(), status: 'retry_wait', maxAttempts: 3, hardBudgetKrw: '99',
      estimatedCostKrw: '1', actualCostKrw: null };
    f.input.snapshot.continuations.push(pending); f.input.snapshot.ledger.push(entries(pending)[0]);
    expect(evaluateAuthorBodyTrialUnknownHolds(f.input)).toMatchObject({ reservedMaximumCostKrw: '297.000000',
      budgetCommittedIncludingHoldsKrw: '9997.000000', maximumAfterReservationKrw: '9998.000000', mayReserve: true });
    pending.hardBudgetKrw = '100';
    expect(evaluateAuthorBodyTrialUnknownHolds(f.input)).toMatchObject({ maximumAfterReservationKrw: '10001.000000',
      mayReserve: false, reason: 'budget_exceeded' });
  });

  it('blocks every uncovered unknown and never infers a hold from an estimate', () => {
    const f = fixture(); delete f.input.requestedHold;
    expect(evaluateAuthorBodyTrialUnknownHolds(f.input)).toMatchObject({ mayReserve: false, reason: 'unknown_cost',
      provisionalHeldAmountKrw: '0.000000', unknownCostCount: 1, unresolvedUnheldCount: 1 });
    const second = { ...f.unknown, id: randomUUID() };
    f.input.snapshot.continuations.push(second); f.input.snapshot.ledger.push(...entries(second));
    f.input.requestedHold = f.hold;
    expect(evaluateAuthorBodyTrialUnknownHolds(f.input)).toMatchObject({ mayReserve: false, unknownCostCount: 2,
      provisionalHeldCount: 1, unresolvedUnheldCount: 1 });
  });

  it('reuses only the exact persisted per-unknown idempotent record', () => {
    const f = fixture(); f.input.existingHolds = [{ ...f.hold }];
    expect(evaluateAuthorBodyTrialUnknownHolds(f.input)).toMatchObject({ requestedHoldState: 'reused',
      provisionalHeldCount: 1, provisionalHeldAmountKrw: '300.000000', maximumAfterReservationKrw: '10000.000000' });
    delete f.input.requestedHold;
    expect(evaluateAuthorBodyTrialUnknownHolds(f.input)).toMatchObject({ requestedHoldState: 'none', provisionalHeldCount: 1 });
  });

  it.each(['id', 'idempotencyKey', 'amountKrw', 'createdAt', 'expiresAt'] as const)
    ('rejects a changed replay even when one identity still matches: %s', field => {
      const f = fixture(); f.input.existingHolds = [{ ...f.hold }];
      if (field === 'id' || field === 'idempotencyKey') f.hold[field] = randomUUID();
      if (field === 'amountKrw') f.hold.amountKrw = 299;
      if (field === 'createdAt') f.hold.createdAt = new Date(f.hold.createdAt.getTime() + 1);
      if (field === 'expiresAt') f.hold.expiresAt = new Date(f.hold.expiresAt.getTime() - 1);
      expect(() => evaluateAuthorBodyTrialUnknownHolds(f.input)).toThrow(StoryAuthorBodyTrialUnknownHoldError);
    });

  it.each(['same-record', 'same-unknown', 'same-key', 'same-id'])('rejects duplicate stored holds: %s', mode => {
    const f = fixture(), second = { ...f.unknown, id: randomUUID() };
    f.input.snapshot.continuations.push(second); f.input.snapshot.ledger.push(...entries(second));
    const duplicate: AuthorBodyTrialUnknownHold = { ...f.hold, id: randomUUID(), idempotencyKey: randomUUID(), continuationId: second.id,
      unknownEvidenceSha256: authorBodyTrialUnknownHoldEvidenceSha256(f.input.snapshot, second.id), amountKrw: 1 };
    f.hold.amountKrw = 1;
    if (mode === 'same-record') Object.assign(duplicate, f.hold);
    if (mode === 'same-unknown') Object.assign(duplicate, { continuationId: f.hold.continuationId,
      unknownEvidenceSha256: f.hold.unknownEvidenceSha256 });
    if (mode === 'same-key') duplicate.idempotencyKey = f.hold.idempotencyKey;
    if (mode === 'same-id') duplicate.id = f.hold.id;
    f.input.existingHolds = [f.hold, duplicate]; delete f.input.requestedHold;
    expect(() => evaluateAuthorBodyTrialUnknownHolds(f.input)).toThrow(StoryAuthorBodyTrialUnknownHoldError);
  });

  it('caps all unknown holds together at 300 integer won, not 300 per request', () => {
    const f = fixture(), second = { ...f.unknown, id: randomUUID(), status: 'timeout' };
    f.input.snapshot.continuations.push(second); f.input.snapshot.ledger.push(...entries(second));
    f.hold.amountKrw = 150; f.input.existingHolds = [f.hold];
    f.input.requestedHold = { ...f.hold, id: randomUUID(), continuationId: second.id, idempotencyKey: randomUUID(),
      unknownEvidenceSha256: authorBodyTrialUnknownHoldEvidenceSha256(f.input.snapshot, second.id), amountKrw: 150 };
    expect(evaluateAuthorBodyTrialUnknownHolds(f.input)).toMatchObject({ provisionalHeldAmountKrw: '300.000000',
      provisionalHeldCount: 2, mayReserve: true });
    f.input.requestedHold.amountKrw = 151;
    expect(() => evaluateAuthorBodyTrialUnknownHolds(f.input)).toThrow(StoryAuthorBodyTrialUnknownHoldError);
  });

  it.each([0, -1, 0.5, 300.1, 301, NaN, Infinity, Number.MAX_SAFE_INTEGER, '300', null])
    ('rejects non-integer or unbounded won: %p', value => {
      const f = fixture(); f.hold.amountKrw = value as number;
      expect(() => evaluateAuthorBodyTrialUnknownHolds(f.input)).toThrow(StoryAuthorBodyTrialUnknownHoldError);
      f.hold.amountKrw = 1; f.input.acknowledgement.maximumTotalHoldKrw = value as number;
      expect(() => evaluateAuthorBodyTrialUnknownHolds(f.input)).toThrow(StoryAuthorBodyTrialUnknownHoldError);
    });

  it.each(['-1', '1e2', 'NaN', 'Infinity', ' 1', '01', '0.0000001', '10001', '9999999999999'])
    ('rejects invalid structured KRW amounts rather than parsing display text: %s', value => {
      const f = fixture(); f.input.nextMaximumCostKrw = value;
      expect(() => evaluateAuthorBodyTrialUnknownHolds(f.input)).toThrow(StoryAuthorBodyTrialUnknownHoldError);
      f.input.nextMaximumCostKrw = '1'; f.approval.approvedBudgetKrw = value;
      f.input.currentAuthorization.approval.approvedBudgetKrw = value;
      expect(() => evaluateAuthorBodyTrialUnknownHolds(f.input)).toThrow(StoryAuthorBodyTrialUnknownHoldError);
    });

  it('checks an already reserved commitment with no extra reservation and rejects a zero original cap', () => {
    const f = fixture('9700'); f.input.nextMaximumCostKrw = '0.000000';
    expect(evaluateAuthorBodyTrialUnknownHolds(f.input)).toMatchObject({ budgetCheckPassed: true, mayReserve: false,
      reason: 'within_budget', maximumAfterReservationKrw: '10000.000000' });
    f.input.nextMaximumCostKrw = '0.000001';
    expect(evaluateAuthorBodyTrialUnknownHolds(f.input)).toMatchObject({ budgetCheckPassed: false, mayReserve: false,
      reason: 'budget_exceeded' });
    f.approval.approvedBudgetKrw = '0'; f.input.currentAuthorization.approval.approvedBudgetKrw = '0';
    expect(() => evaluateAuthorBodyTrialUnknownHolds(f.input)).toThrow(StoryAuthorBodyTrialUnknownHoldError);
  });

  it('does not expand a smaller original approval or accept an acknowledgement cap change', () => {
    const f = fixture('699');
    f.approval.approvedBudgetKrw = '1000'; f.input.currentAuthorization.approval.approvedBudgetKrw = '1000';
    f.input.acknowledgement.originalApprovedBudgetKrw = '1000';
    expect(evaluateAuthorBodyTrialUnknownHolds(f.input)).toMatchObject({ approvedBudgetKrw: '1000.000000', mayReserve: true });
    f.input.acknowledgement.originalApprovedBudgetKrw = '10000';
    expect(() => evaluateAuthorBodyTrialUnknownHolds(f.input)).toThrow(StoryAuthorBodyTrialUnknownHoldError);
  });

  it('accepts the minimum one-won hold only within the separately acknowledged aggregate bound', () => {
    const f = fixture(); f.hold.amountKrw = 1; f.input.acknowledgement.maximumTotalHoldKrw = 1;
    f.input.nextMaximumCostKrw = '300';
    expect(evaluateAuthorBodyTrialUnknownHolds(f.input)).toMatchObject({ provisionalHeldAmountKrw: '1.000000',
      maximumAfterReservationKrw: '10000.000000', mayReserve: true });
    f.hold.amountKrw = 2;
    expect(() => evaluateAuthorBodyTrialUnknownHolds(f.input)).toThrow(StoryAuthorBodyTrialUnknownHoldError);
  });

  it('bounds the complete stored-hold input before inspecting individual records', () => {
    const f = fixture(); f.input.existingHolds = Array.from({ length: 301 }, () => f.hold);
    expect(() => evaluateAuthorBodyTrialUnknownHolds(f.input)).toThrow(StoryAuthorBodyTrialUnknownHoldError);
  });

  it('supports an explicitly absent generation profile but rejects inconsistent null pins', () => {
    const f = fixture();
    Object.assign(f.approval, { generationProfileId: null, generationProfileRevision: null, generationProfileFingerprint: null });
    f.input.currentAuthorization.approval = { ...f.approval };
    expect(evaluateAuthorBodyTrialUnknownHolds(f.input).mayReserve).toBe(true);
    f.approval.generationProfileRevision = 1;
    expect(() => evaluateAuthorBodyTrialUnknownHolds(f.input)).toThrow(StoryAuthorBodyTrialUnknownHoldError);
  });

  it.each(['revoked-approval', 'negative-clock', 'ack-outlives-approval', 'hold-outlives-ack', 'hold-before-dispatch'])
    ('rejects invalid approval or lifetime ordering: %s', mode => {
      const f = fixture();
      if (mode === 'revoked-approval') f.approval.status = 'revoked';
      if (mode === 'negative-clock') f.input.now = new Date(-1);
      if (mode === 'ack-outlives-approval') f.input.acknowledgement.expiresAt = new Date(f.approval.expiresAt.getTime() + 1);
      if (mode === 'hold-outlives-ack') f.hold.expiresAt = new Date(f.input.acknowledgement.expiresAt.getTime() + 1);
      if (mode === 'hold-before-dispatch') f.unknown.dispatchStartedAt = new Date(f.hold.createdAt.getTime() + 1);
      expect(() => evaluateAuthorBodyTrialUnknownHolds(f.input)).toThrow(StoryAuthorBodyTrialUnknownHoldError);
    });

  it.each(['provisionalHoldOnly', 'unknownCostRemainsUnknown', 'notProviderChargeOrLiabilityCeiling'] as const)
    ('requires explicit recorded acknowledgement of %s', field => {
      const f = fixture(); f.input.acknowledgement[field] = false;
      expect(() => evaluateAuthorBodyTrialUnknownHolds(f.input)).toThrow(StoryAuthorBodyTrialUnknownHoldError);
    });

  it.each(['userId', 'workId', 'releaseId', 'manuscriptVersionId', 'styleConsentId', 'analysisJobId',
    'generationProfileId', 'generationProfileRevision', 'generationProfileFingerprint', 'capabilityRevision'] as const)
    ('fails closed on changed current authorization pin: %s', field => {
      const f = fixture(), current = f.input.currentAuthorization.approval;
      if (field === 'generationProfileRevision' || field === 'capabilityRevision') current[field] = 2;
      else if (field === 'generationProfileFingerprint') current[field] = 'c'.repeat(64);
      else current[field] = randomUUID();
      expect(() => evaluateAuthorBodyTrialUnknownHolds(f.input)).toThrow(StoryAuthorBodyTrialUnknownHoldError);
    });

  it.each(['approval', 'acknowledgement', 'hold', 'stale-check', 'future-check', 'unverified', 'incomplete-holds',
    'incomplete-costs', 'wrong-ack', 'foreign-ack', 'foreign-trial', 'future-hold', 'future-ack', 'invalid-date'])
    ('rejects expired, stale, missing or conflicting evidence: %s', mode => {
      const f = fixture();
      if (mode === 'approval') f.approval.expiresAt = f.input.now;
      if (mode === 'acknowledgement') f.input.acknowledgement.expiresAt = f.input.now;
      if (mode === 'hold') f.hold.expiresAt = f.input.now;
      if (mode === 'stale-check') f.input.currentAuthorization.checkedAt = new Date(f.input.now.getTime() - 1);
      if (mode === 'future-check') f.input.currentAuthorization.checkedAt = new Date(f.input.now.getTime() + 1);
      if (mode === 'unverified') f.input.currentAuthorization.verified = false;
      if (mode === 'incomplete-holds') f.input.holdsComplete = false;
      if (mode === 'incomplete-costs') f.input.snapshot.complete = false;
      if (mode === 'wrong-ack') f.hold.acknowledgementId = randomUUID();
      if (mode === 'foreign-ack') f.input.acknowledgement.userId = randomUUID();
      if (mode === 'foreign-trial') { f.unknown.authorBodyTrialApprovalId = randomUUID(); refreshEvidence(f); }
      if (mode === 'future-hold') f.hold.createdAt = new Date(f.input.now.getTime() + 1);
      if (mode === 'future-ack') f.input.acknowledgement.createdAt = new Date(f.input.now.getTime() + 1);
      if (mode === 'invalid-date') f.input.now = new Date(NaN);
      expect(() => evaluateAuthorBodyTrialUnknownHolds(f.input)).toThrow();
    });

  it.each(['completed', 'queued', 'retry_wait', 'processing', 'settled', 'cancelled', 'revoked'])
    ('rejects inappropriate hold status instead of treating it as active: %s', status => {
      const f = fixture(); f.hold.status = status;
      expect(() => evaluateAuthorBodyTrialUnknownHolds(f.input)).toThrow(StoryAuthorBodyTrialUnknownHoldError);
      f.hold.status = 'active'; f.input.acknowledgement.status = status;
      expect(() => evaluateAuthorBodyTrialUnknownHolds(f.input)).toThrow(StoryAuthorBodyTrialUnknownHoldError);
    });

  it.each(['measured-zero', 'measured-positive', 'completed', 'pending', 'later-attempt', 'reuse', 'no-dispatch',
    'missing-ledger', 'duplicate-ledger', 'usage-changed', 'id-case-alias'])
    ('rejects settled, inappropriate or changed unknown evidence: %s', mode => {
      const f = fixture(), settlement = f.input.snapshot.ledger[1];
      if (mode === 'measured-zero' || mode === 'measured-positive') {
        f.unknown.actualCostKrw = mode === 'measured-zero' ? '0.000000' : '1.000000';
        settlement.actualCostKrw = f.unknown.actualCostKrw;
      }
      if (mode === 'completed') { f.unknown.status = 'completed'; settlement.status = 'completed'; settlement.eventKind = 'new_route_completed'; }
      if (mode === 'pending') { f.unknown.status = 'processing'; f.input.snapshot.ledger.splice(1, 1); }
      if (mode === 'later-attempt') { f.unknown.attemptCount = 2; f.unknown.maxAttempts = 2; }
      if (mode === 'reuse') f.unknown.sharedResultReused = true;
      if (mode === 'no-dispatch') f.unknown.dispatchStartedAt = null;
      if (mode === 'missing-ledger') f.input.snapshot.ledger.splice(1, 1);
      if (mode === 'duplicate-ledger') f.input.snapshot.ledger.push({ ...settlement, id: randomUUID() });
      if (mode === 'usage-changed') settlement.outputTokens++;
      if (mode === 'id-case-alias') f.hold.idempotencyKey = f.hold.idempotencyKey.replace(/^[a-f0-9]{8}/, 'abcdefab').toUpperCase();
      expect(() => evaluateAuthorBodyTrialUnknownHolds(f.input)).toThrow();
    });

  it('hashes equivalent structured amounts and ledger order consistently, without converting USD or inventing usage', () => {
    const f = fixture(), digest = f.hold.unknownEvidenceSha256;
    f.unknown.estimatedCostKrw = '100'; f.unknown.hardBudgetKrw = '300';
    f.input.snapshot.ledger[0].estimatedCostKrw = '100';
    f.input.snapshot.ledger[1].estimatedCostKrw = '100'; f.input.snapshot.ledger.reverse();
    expect(authorBodyTrialUnknownHoldEvidenceSha256(f.input.snapshot, f.unknown.id)).toBe(digest);
    expect(evaluateAuthorBodyTrialUnknownHolds(f.input).mayReserve).toBe(true);
  });

  it('preserves only the existing exact historical excluded pair and never holds that pair', () => {
    const f = fixture(), old = [0, 1].map(() => ({ ...f.unknown, id: randomUUID(), maxAttempts: 3,
      createdAt: new Date('2025-12-31T00:00:00Z'), dispatchStartedAt: new Date('2025-12-31T00:01:00Z'),
      authorBodyTrialApprovalId: null }));
    const historical = { ...f.input.snapshot, continuations: old, ledger: old.flatMap(entries) };
    // Synthetic fixture of a previously recorded reference, not a production approval write.
    f.approval.approvalReference = authorBodyTrialHistoricalSeparationReference(historical, f.approval.createdAt);
    f.input.currentAuthorization.approval.approvalReference = f.approval.approvalReference;
    f.input.snapshot.continuations.push(...old); f.input.snapshot.ledger.push(...historical.ledger);
    expect(evaluateAuthorBodyTrialUnknownHolds(f.input)).toMatchObject({ historicalUnknownCostCount: 2,
      unknownCostCount: 1, provisionalHeldCount: 1, unknownCostState: 'UNKNOWN', mayReserve: true });
    expect(summarizeAuthorBodyTrialCosts(f.input.snapshot).unknownCostCount).toBe(3);
    expect(() => authorBodyTrialUnknownHoldEvidenceSha256(f.input.snapshot, old[0].id)).toThrow(StoryAuthorBodyTrialUnknownHoldError);
    historical.ledger[1].outputTokens++;
    expect(() => evaluateAuthorBodyTrialUnknownHolds(f.input)).toThrow();
  });

  it('does not silently absorb additional historical unknowns or orphan audit rows', () => {
    const f = fixture(), old = { ...f.unknown, id: randomUUID(), maxAttempts: 3,
      createdAt: new Date('2025-12-31T00:00:00Z'), authorBodyTrialApprovalId: null };
    f.input.snapshot.continuations.push(old); f.input.snapshot.ledger.push(...entries(old));
    expect(evaluateAuthorBodyTrialUnknownHolds(f.input)).toMatchObject({ mayReserve: false, unknownCostCount: 2,
      unresolvedUnheldCount: 1, historicalUnknownCostCount: 0 });
    f.input.snapshot.ledger.push({ ...f.input.snapshot.ledger[0], id: randomUUID(), continuationId: randomUUID() });
    expect(() => evaluateAuthorBodyTrialUnknownHolds(f.input)).toThrow();
  });
});

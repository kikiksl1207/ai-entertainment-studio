import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { Prisma, type StoryAuthorBodyTrialApproval } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  authorBodyTrialHistoricalSeparationReference, summarizeAuthorBodyTrialCosts,
  type AuthorBodyTrialCostSnapshot, type AuthorBodyTrialContinuationCost, type AuthorBodyTrialLedgerCost,
} from './story-author-body-trial-budget.policy';
import { authorBodyTrialUnknownHoldEvidenceSha256 } from './story-author-body-trial-unknown-hold.policy';
import {
  AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_ACTION, AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_PROPERTY,
  AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_REFERENCE, decodeAuthorBodyTrialUnknownHoldProof,
} from './story-author-body-trial-unknown-hold-proof';
import {
  StoryAuthorBodyTrialUnknownHoldRegistrationService,
  decodeAuthorBodyTrialUnknownHoldProof as legacyDecode,
  type AuthorBodyTrialUnknownHoldRegistrationCommand,
} from './story-author-body-trial-unknown-hold-registration.service';
import type { AuthorBodyTrialUnknownHoldAuditBinding } from './story-author-body-trial-unknown-hold-proof';

type Raw = {
  id: string; userId: string; workId: string; releaseId: string; releaseChecksum: string;
  manuscriptVersionId: string; styleConsentId: string; styleConsentRevision: number; capabilityRevision: number;
  analysisJobId: string; analysisVersion: number; requestKind: string; authorBodyTrialApprovalId: string | null;
  status: string; failureCode: string; attemptCount: number; maxAttempts: number; actualCostKrw: Prisma.Decimal | null;
  dispatchStartedAt: Date | null; contextReferences: Record<string, any>; createdAt: Date;
};
const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const NOW = new Date('2026-02-01T12:00:00.000Z');

function costRow(row: Raw): AuthorBodyTrialContinuationCost {
  return { id: row.id, userId: row.userId, workId: row.workId, requestKind: row.requestKind, status: row.status,
    attemptCount: row.attemptCount, maxAttempts: row.maxAttempts, actualCostKrw: row.actualCostKrw?.toFixed(6) ?? null,
    dispatchStartedAt: row.dispatchStartedAt, estimatedCostKrw: '100.000000', hardBudgetKrw: '300.000000',
    sharedResultReused: row.contextReferences.sharedResultReused === true, sharedResultEvidenceVerified: false,
    confirmedNoProviderDispatch: false, sharedResultId: null, resultGeneratedSceneId: null,
    createdAt: row.createdAt, authorBodyTrialApprovalId: row.authorBodyTrialApprovalId };
}
function entries(row: Raw): AuthorBodyTrialLedgerCost[] {
  const reserved: AuthorBodyTrialLedgerCost = { id: randomUUID(), continuationId: row.id, userId: row.userId,
    workId: row.workId, eventKind: 'recommended_route_request', status: 'reserved', provenance: 'ai_generated',
    estimatedCostKrw: '100.000000', actualCostKrw: null, inputTokens: 17, outputTokens: 9, cachedInputTokens: 2, imageUnits: 0 };
  return [reserved, { ...reserved, id: randomUUID(), eventKind: `new_route_${row.status}`, status: row.status,
    actualCostKrw: row.actualCostKrw?.toFixed(6) ?? null }];
}

function fixture() {
  const approval: StoryAuthorBodyTrialApproval = { id: randomUUID(), userId: randomUUID(), workId: randomUUID(),
    releaseId: randomUUID(), manuscriptVersionId: randomUUID(), releaseChecksum: 'a'.repeat(64), capabilityRevision: 1,
    styleConsentId: randomUUID(), styleConsentRevision: 1, analysisJobId: randomUUID(), analysisVersion: 1,
    generationProfileId: randomUUID(), generationProfileRevision: 1, generationProfileFingerprint: 'b'.repeat(64),
    approvedBudgetKrw: new Prisma.Decimal('10000'), approvalReference: 'synthetic-before-reference', status: 'active',
    createdAt: new Date(NOW.getTime() - 100_000), expiresAt: new Date(NOW.getTime() + 60_000) };
  const target: Raw = { id: randomUUID(), userId: approval.userId, workId: approval.workId, releaseId: approval.releaseId,
    releaseChecksum: approval.releaseChecksum, manuscriptVersionId: approval.manuscriptVersionId, styleConsentId: approval.styleConsentId,
    styleConsentRevision: 1, capabilityRevision: 1, analysisJobId: approval.analysisJobId, analysisVersion: 1,
    requestKind: 'recommended_choice', authorBodyTrialApprovalId: approval.id, status: 'failed',
    failureCode: 'provider_outcome_unknown', attemptCount: 1, maxAttempts: 1, actualCostKrw: null,
    dispatchStartedAt: new Date(NOW.getTime() - 40_000), createdAt: new Date(NOW.getTime() - 50_000),
    contextReferences: { privateEvidence: { nested: ['synthetic-preserved'] }, failureDetail: 'synthetic-unknown-only' } };
  const old: Raw[] = [0, 1].map(() => ({ ...target, id: randomUUID(), authorBodyTrialApprovalId: null, maxAttempts: 3,
    createdAt: new Date(NOW.getTime() - 200_000), dispatchStartedAt: new Date(NOW.getTime() - 190_000), contextReferences: {} }));
  const historical = { userId: approval.userId, workId: approval.workId, complete: true,
    continuations: old.map(costRow), ledger: old.flatMap(entries) };
  // Previously pinned approval reference is synthetic here; no production approval is written.
  approval.approvalReference = authorBodyTrialHistoricalSeparationReference(historical, approval.createdAt);
  const state = { rows: [...old, target], ledger: [...historical.ledger, ...entries(target)],
    audits: [] as AuthorBodyTrialUnknownHoldAuditBinding[], casCount: 1, events: [] as string[] };
  const snapshot = (): AuthorBodyTrialCostSnapshot => ({ userId: approval.userId, workId: approval.workId, complete: true,
    continuations: state.rows.map(costRow), ledger: state.ledger });
  const command: AuthorBodyTrialUnknownHoldRegistrationCommand = { userId: approval.userId, workId: approval.workId,
    approvalId: approval.id, continuationId: target.id, idempotencyKey: randomUUID(),
    expectedEvidenceSha256: authorBodyTrialUnknownHoldEvidenceSha256(snapshot(), target.id),
    expectedApprovedBudgetKrw: '10000.000000', approvalReference: AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_REFERENCE,
    expiresAt: new Date(approval.expiresAt.getTime() - 1000), provisionalHoldOnly: true,
    unknownCostRemainsUnknown: true, notProviderChargeOrLiabilityCeiling: true };
  const forbidden: jest.Mock[] = [];
  const noWrite = () => {
    const fn = jest.fn(() => { throw new Error('Forbidden synthetic write'); }); forbidden.push(fn); return fn;
  };
  const tx = {
    storyAiContinuation: { create: noWrite(), update: noWrite(), delete: noWrite(),
      findMany: jest.fn(async () => { state.events.push('rows'); return state.rows; }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        state.events.push('cas');
        expect(Object.keys(data)).toEqual(['contextReferences']);
        if (state.casCount !== 1 || where.id !== target.id || where.status !== 'failed' || where.actualCostKrw !== null ||
          JSON.stringify(where.contextReferences.equals) !== JSON.stringify(target.contextReferences)) return { count: state.casCount === 1 ? 0 : state.casCount };
        target.contextReferences = cloneJson(data.contextReferences); return { count: 1 };
      }) },
    auditEvent: { update: noWrite(), updateMany: noWrite(), delete: noWrite(),
      findMany: jest.fn(async () => { state.events.push('audits'); return state.audits; }),
      create: jest.fn(async ({ data }: any) => {
        state.events.push('audit-create');
        const audit: AuthorBodyTrialUnknownHoldAuditBinding = { ...data, metadata: cloneJson(data.metadata), createdAt: new Date(data.createdAt) };
        state.audits.push(audit); return audit;
      }) },
    storyAiUsageLedger: { create: noWrite(), update: noWrite(), updateMany: noWrite(), delete: noWrite() },
    storyAuthorBodyTrialApproval: { create: noWrite(), update: noWrite(), updateMany: noWrite() },
    storyAiAllowanceBucket: { create: noWrite(), update: noWrite(), updateMany: noWrite() },
    storyAuthorBodyReview: { create: noWrite(), update: noWrite(), updateMany: noWrite() },
    storyStyleProfileConsent: { create: noWrite(), update: noWrite(), updateMany: noWrite() },
    contentRightsContract: { create: noWrite(), update: noWrite(), updateMany: noWrite() },
  };
  const trials = { authorizeTx: jest.fn(async (db: unknown, user: string, scope: { workId: string; approvalId: string }) => {
    state.events.push('authorize'); expect(db).toBe(tx); expect(user).toBe(command.userId);
    expect(scope).toEqual({ workId: command.workId, approvalId: command.approvalId });
    if (approval.status !== 'active' || approval.expiresAt <= new Date()) throw new ConflictException('Synthetic authorization blocked');
    return approval;
  }) };
  const costs = { snapshotTx: jest.fn(async () => { state.events.push('snapshot'); return snapshot(); }) };
  const prisma = { $transaction: jest.fn(async (callback: (db: typeof tx) => Promise<unknown>, _options: unknown) => {
    const contexts = state.rows.map(row => cloneJson(row.contextReferences)), audits = [...state.audits];
    try { return await callback(tx); } catch (error) {
      state.rows.forEach((row, index) => { row.contextReferences = contexts[index]; }); state.audits = audits; throw error;
    }
  }) };
  const service = new StoryAuthorBodyTrialUnknownHoldRegistrationService(prisma as never, trials as never, costs as never);
  const persisted = () => target.contextReferences[AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_PROPERTY];
  return { approval, target, old, command, state, snapshot, tx, trials, costs, prisma, service, forbidden, persisted };
}

describe('server-only unknown hold registration (mock DB source, no runtime proof)', () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => { jest.useFakeTimers().setSystemTime(NOW); f = fixture(); });
  afterEach(() => { for (const write of f.forbidden) expect(write).not.toHaveBeenCalled(); jest.useRealTimers(); });

  it('keeps the registration decoder re-export compatible with the pure proof module', () => {
    expect(legacyDecode).toBe(decodeAuthorBodyTrialUnknownHoldProof);
  });

  it('records exactly one system audit and a context-only CAS after current authorization, preserving costs and historical2', async () => {
    const before = JSON.stringify(f.snapshot()), context = cloneJson(f.target.contextReferences), approval = JSON.stringify(f.approval);
    const result = await f.service.registerCurrentUnknown(f.command);
    expect(result).toMatchObject({ registrationState: 'registered', generationAuthorized: false, generationStarted: false,
      budget: { unknownCostCount: 1, historicalUnknownCostCount: 2, provisionalHeldCount: 1,
        provisionalHeldAmountKrw: '300.000000', unresolvedUnheldCount: 0, budgetCheckPassed: true, mayReserve: false } });
    expect(f.state.events).toEqual(['authorize', 'rows', 'snapshot', 'audits', 'audit-create', 'cas']);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1); expect(f.tx.storyAiContinuation.updateMany).toHaveBeenCalledTimes(1);
    expect(f.state.audits[0]).toMatchObject({ actorType: 'system', actorUserId: f.command.userId,
      action: AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_ACTION, targetType: 'story_ai_continuation', targetId: f.target.id });
    expect(f.target.contextReferences).toMatchObject(context); expect(JSON.stringify(f.snapshot())).toBe(before);
    expect(JSON.stringify(f.approval)).toBe(approval); expect(f.target.actualCostKrw).toBeNull();
    expect(summarizeAuthorBodyTrialCosts(f.snapshot()).unknownCostCount).toBe(3);
    expect(new Set([result.proof.auditId, result.proof.hold.id, result.proof.acknowledgement.id]).size).toBe(3);
    expect(f.prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 });
  });

  it('replays identical command/proof/audit once without allocating or writing another record', async () => {
    const first = await f.service.registerCurrentUnknown(f.command), serialized = JSON.stringify(f.persisted());
    jest.setSystemTime(new Date(NOW.getTime() + 1000));
    const second = await f.service.registerCurrentUnknown(f.command);
    expect(second.registrationState).toBe('reused'); expect(second.proof).toEqual(first.proof);
    expect(second.budget.requestedHoldState).toBe('reused'); expect(JSON.stringify(f.persisted())).toBe(serialized);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1); expect(f.tx.storyAiContinuation.updateMany).toHaveBeenCalledTimes(1);
    expect(f.trials.authorizeTx).toHaveBeenCalledTimes(2);
  });

  it.each(['key', 'hash', 'expiry', 'approval', 'unknown', 'cap', 'reference', 'acknowledgement'])
    ('blocks changed registration payload on replay: %s', async mode => {
      await f.service.registerCurrentUnknown(f.command);
      if (mode === 'key') f.command.idempotencyKey = randomUUID();
      if (mode === 'hash') f.command.expectedEvidenceSha256 = 'c'.repeat(64);
      if (mode === 'expiry') f.command.expiresAt = new Date(f.command.expiresAt.getTime() - 1);
      if (mode === 'approval') f.command.approvalId = randomUUID();
      if (mode === 'unknown') f.command.continuationId = f.old[0].id;
      if (mode === 'cap') f.command.expectedApprovedBudgetKrw = '9999.000000';
      if (mode === 'reference') f.command.approvalReference = 'unsupported' as typeof f.command.approvalReference;
      if (mode === 'acknowledgement') f.command.unknownCostRemainsUnknown = false;
      await expect(f.service.registerCurrentUnknown(f.command)).rejects.toThrow();
      expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1); expect(f.tx.storyAiContinuation.updateMany).toHaveBeenCalledTimes(1);
    });

  it.each(['completed', 'timeout', 'queued', 'provider_preflight_failed', 'two-attempts', 'retry-enabled', 'settled-zero',
    'foreign-owner', 'foreign-approval', 'old-manuscript', 'old-analysis', 'old-release', 'wrong-checksum', 'missing-dispatch'])
    ('never registers an inappropriate continuation: %s', async mode => {
      if (['completed', 'timeout', 'queued'].includes(mode)) f.target.status = mode;
      if (mode === 'provider_preflight_failed') f.target.failureCode = mode;
      if (mode === 'two-attempts') f.target.attemptCount = 2;
      if (mode === 'retry-enabled') f.target.maxAttempts = 3;
      if (mode === 'settled-zero') f.target.actualCostKrw = new Prisma.Decimal('0');
      if (mode === 'foreign-owner') f.target.userId = randomUUID();
      if (mode === 'foreign-approval') f.target.authorBodyTrialApprovalId = randomUUID();
      if (mode === 'old-manuscript') f.target.manuscriptVersionId = randomUUID();
      if (mode === 'old-analysis') f.target.analysisJobId = randomUUID();
      if (mode === 'old-release') f.target.releaseId = randomUUID();
      if (mode === 'wrong-checksum') f.target.releaseChecksum = 'd'.repeat(64);
      if (mode === 'missing-dispatch') f.target.dispatchStartedAt = null;
      await expect(f.service.registerCurrentUnknown(f.command)).rejects.toThrow();
      expect(f.tx.auditEvent.create).not.toHaveBeenCalled(); expect(f.tx.storyAiContinuation.updateMany).not.toHaveBeenCalled();
    });

  it.each(['revoked', 'expired', 'pins-rejected'])('honors existing authorizeTx rejection before snapshot or writes: %s', async mode => {
    if (mode === 'revoked') f.approval.status = 'revoked';
    if (mode === 'expired') f.approval.expiresAt = new Date(NOW.getTime());
    if (mode === 'pins-rejected') f.trials.authorizeTx.mockRejectedValueOnce(new ConflictException('Synthetic current pins changed'));
    await expect(f.service.registerCurrentUnknown(f.command)).rejects.toBeInstanceOf(ConflictException);
    expect(f.costs.snapshotTx).not.toHaveBeenCalled(); expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it.each(['expired-command', 'outlives-approval', 'invalid-date', 'cap-expanded', 'cap-zero', 'invalid-key', 'incomplete-snapshot',
    'second-unknown', 'historical-evidence-changed', 'context-array', 'missing-final-ledger'])
    ('blocks invalid bounds or incomplete evidence before writes: %s', async mode => {
      if (mode === 'expired-command') f.command.expiresAt = new Date(NOW);
      if (mode === 'outlives-approval') f.command.expiresAt = new Date(f.approval.expiresAt.getTime() + 1);
      if (mode === 'invalid-date') f.command.expiresAt = new Date(NaN);
      if (mode === 'cap-expanded') { f.approval.approvedBudgetKrw = new Prisma.Decimal('10001'); f.command.expectedApprovedBudgetKrw = '10001.000000'; }
      if (mode === 'cap-zero') f.command.expectedApprovedBudgetKrw = '0.000000';
      if (mode === 'invalid-key') f.command.idempotencyKey = 'invalid';
      if (mode === 'incomplete-snapshot') f.costs.snapshotTx.mockImplementationOnce(async () => ({ ...f.snapshot(), complete: false }));
      if (mode === 'second-unknown') { const row = { ...f.target, id: randomUUID(), contextReferences: {} }; f.state.rows.push(row); f.state.ledger.push(...entries(row)); }
      if (mode === 'historical-evidence-changed') f.state.ledger[1].outputTokens++;
      if (mode === 'context-array') f.target.contextReferences = [] as unknown as Raw['contextReferences'];
      if (mode === 'missing-final-ledger') f.state.ledger.pop();
      await expect(f.service.registerCurrentUnknown(f.command)).rejects.toThrow();
      expect(f.tx.auditEvent.create).not.toHaveBeenCalled(); expect(f.tx.storyAiContinuation.updateMany).not.toHaveBeenCalled();
    });

  it('includes known spending and fails above the original exact cap rather than turning unknown into zero', async () => {
    const known: Raw = { ...f.target, id: randomUUID(), status: 'completed', actualCostKrw: new Prisma.Decimal('9700'), contextReferences: {} };
    f.state.rows.push(known); f.state.ledger.push(...entries(known));
    expect((await f.service.registerCurrentUnknown(f.command)).budget.maximumAfterReservationKrw).toBe('10000.000000');
    known.actualCostKrw = new Prisma.Decimal('9700.000001');
    f.state.ledger[f.state.ledger.length - 1].actualCostKrw = '9700.000001';
    await expect(f.service.registerCurrentUnknown(f.command)).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1); expect(f.tx.storyAiContinuation.updateMany).toHaveBeenCalledTimes(1);
  });

  it('retains pending maximum-attempt reservations inside a smaller original cap with next=0', async () => {
    const pending: Raw = { ...f.target, id: randomUUID(), status: 'queued', attemptCount: 0, maxAttempts: 3,
      dispatchStartedAt: null, contextReferences: {} };
    f.state.rows.push(pending); f.state.ledger.push(entries(pending)[0]);
    f.approval.approvedBudgetKrw = new Prisma.Decimal('1200'); f.command.expectedApprovedBudgetKrw = '1200.000000';
    expect((await f.service.registerCurrentUnknown(f.command)).budget).toMatchObject({
      approvedBudgetKrw: '1200.000000', reservedMaximumCostKrw: '900.000000', provisionalHeldAmountKrw: '300.000000',
      maximumAfterReservationKrw: '1200.000000', budgetCheckPassed: true, mayReserve: false, pendingCount: 1 });
  });

  it.each([0, 2])('rolls the newly added audit back if the context CAS affects %s rows', async count => {
    const original = cloneJson(f.target.contextReferences); f.state.casCount = count;
    await expect(f.service.registerCurrentUnknown(f.command)).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1); expect(f.state.audits).toHaveLength(0);
    expect(f.target.contextReferences).toEqual(original); expect(f.target.actualCostKrw).toBeNull();
  });

  it('does not perform the CAS when audit creation fails', async () => {
    f.tx.auditEvent.create.mockRejectedValueOnce(new Error('Synthetic audit unavailable'));
    await expect(f.service.registerCurrentUnknown(f.command)).rejects.toThrow('Synthetic audit unavailable');
    expect(f.tx.storyAiContinuation.updateMany).not.toHaveBeenCalled(); expect(f.persisted()).toBeUndefined();
  });

  it('rolls back the staged audit and CAS if the explicit expiry is crossed before commit', async () => {
    const original = cloneJson(f.target.contextReferences);
    f.tx.auditEvent.create.mockImplementationOnce(async ({ data }: any) => {
      const audit: AuthorBodyTrialUnknownHoldAuditBinding = { ...data, metadata: cloneJson(data.metadata), createdAt: new Date(data.createdAt) };
      f.state.audits.push(audit); jest.setSystemTime(new Date(f.command.expiresAt.getTime() + 1)); return audit;
    });
    await expect(f.service.registerCurrentUnknown(f.command)).rejects.toBeInstanceOf(ConflictException);
    expect(f.state.audits).toHaveLength(0); expect(f.target.contextReferences).toEqual(original);
  });

  it.each(['missing-audit', 'orphan-audit', 'duplicate-audit', 'duplicate-proof', 'foreign-proof', 'wrong-actor', 'wrong-action',
    'wrong-target', 'wrong-reference', 'audit-payload-mismatch', 'revoked-hold', 'revoked-ack'])
    ('rejects missing, duplicate, revoked or mismatched persisted audit binding: %s', async mode => {
      await f.service.registerCurrentUnknown(f.command);
      const audit = f.state.audits[0];
      if (mode === 'missing-audit') f.state.audits = [];
      if (mode === 'orphan-audit') delete f.target.contextReferences[AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_PROPERTY];
      if (mode === 'duplicate-audit') f.state.audits.push({ ...audit, id: randomUUID() });
      if (mode === 'duplicate-proof') f.old[0].contextReferences[AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_PROPERTY] = cloneJson(f.persisted());
      if (mode === 'foreign-proof') f.persisted().acknowledgement.trialApprovalId = randomUUID();
      if (mode === 'wrong-actor') audit.actorType = 'user';
      if (mode === 'wrong-action') audit.action = 'unrelated';
      if (mode === 'wrong-target') audit.targetId = randomUUID();
      if (mode === 'wrong-reference') (audit.metadata as any).approvalReference = 'unrelated';
      if (mode === 'audit-payload-mismatch') (audit.metadata as any).proof.hold.amountKrw = 299;
      if (mode === 'revoked-hold') f.persisted().hold.status = 'revoked';
      if (mode === 'revoked-ack') f.persisted().acknowledgement.status = 'revoked';
      await expect(f.service.registerCurrentUnknown(f.command)).rejects.toThrow();
      expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1); expect(f.tx.storyAiContinuation.updateMany).toHaveBeenCalledTimes(1);
    });

  it('strictly restores Date values with exact audit binding, without certifying fresh authorization', async () => {
    await f.service.registerCurrentUnknown(f.command);
    const decoded = decodeAuthorBodyTrialUnknownHoldProof(cloneJson(f.persisted()), f.state.audits[0]);
    expect(decoded.hold.createdAt).toBeInstanceOf(Date); expect(decoded.hold.expiresAt).toBeInstanceOf(Date);
    expect(decoded.acknowledgement.createdAt).toEqual(NOW); expect(decoded.acknowledgement.expiresAt).toEqual(f.command.expiresAt);
    jest.setSystemTime(new Date(f.command.expiresAt.getTime() + 1));
    await expect(f.service.registerCurrentUnknown(f.command)).rejects.toThrow();
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it.each(['2026-02-30T12:00:00.000Z', '2026-02-01T12:00:00Z', '2026-02-01T21:00:00.000+09:00',
    'not-a-date', null, 123, new Date(NOW.getTime())])('rejects noncanonical or invalid JSON date: %p', async value => {
      await f.service.registerCurrentUnknown(f.command);
      f.persisted().hold.createdAt = value;
      expect(() => decodeAuthorBodyTrialUnknownHoldProof(f.persisted(), f.state.audits[0])).toThrow();
    });

  it('rejects unsupported proof keys and does not replace malformed evidence with an empty object', async () => {
    await f.service.registerCurrentUnknown(f.command); f.persisted().humanApproval = true;
    expect(() => decodeAuthorBodyTrialUnknownHoldProof(f.persisted(), f.state.audits[0])).toThrow();
    f.target.contextReferences[AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_PROPERTY] = null;
    await expect(f.service.registerCurrentUnknown(f.command)).rejects.toThrow();
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });
});

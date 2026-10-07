import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { StoryAuthorBodyTrialCostService } from './story-author-body-trial-cost.service';
import { StoryAuthorBodyTrialService } from './story-author-body-trial.service';
import { StoryAuthorBodyTrialStateService } from './story-author-body-trial-state.service';
import { StoryAuthorBodyTrialUnknownHoldRegistrationService } from './story-author-body-trial-unknown-hold-registration.service';
import { authorBodyTrialHistoricalSeparationReference } from './story-author-body-trial-budget.policy';
import { authorBodyTrialUnknownHoldEvidenceSha256 } from './story-author-body-trial-unknown-hold.policy';
import { AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_REFERENCE } from './story-author-body-trial-unknown-hold-proof';

const NOW = new Date('2026-10-07T14:00:00.000Z');
function fixture() {
  const owner = randomUUID(), workId = randomUUID(), releaseId = randomUUID(), manuscript = randomUUID();
  const work = { id: workId, ownerUserId: owner, activeReleaseId: releaseId, publishedVersion: 1,
    status: 'published', fixtureSource: false };
  const release = { id: releaseId, workId, status: 'active', version: 1, manuscriptVersionId: manuscript, checksum: 'a'.repeat(64) };
  const capability = { workId, releaseId, status: 'active', revision: 1, hardBudgetKrw: new Prisma.Decimal(300) };
  const consent = { id: randomUUID(), workId, ownerUserId: owner, manuscriptVersionId: manuscript, status: 'active',
    revision: 1, rightsConfirmed: true, aiBranchAllowed: true, startsAt: new Date(0), expiresAt: null };
  const analysis = { id: randomUUID(), workId, manuscriptVersionId: manuscript, status: 'completed', analysisVersion: 1 };
  const approval = { id: randomUUID(), userId: owner, workId, releaseId, status: 'active', manuscriptVersionId: manuscript,
    releaseChecksum: release.checksum, capabilityRevision: 1, styleConsentId: consent.id, styleConsentRevision: 1,
    analysisJobId: analysis.id, analysisVersion: 1, generationProfileId: null, generationProfileRevision: null,
    generationProfileFingerprint: null, approvedBudgetKrw: new Prisma.Decimal(10000), approvalReference: 'synthetic-reference',
    createdAt: new Date(NOW.getTime() - 100000), expiresAt: new Date(NOW.getTime() + 60000) };
  const target: any = { id: randomUUID(), userId: owner, workId, releaseId, releaseChecksum: release.checksum,
    manuscriptVersionId: manuscript, styleConsentId: consent.id, styleConsentRevision: 1, capabilityRevision: 1,
    analysisJobId: analysis.id, analysisVersion: 1, requestKind: 'recommended_choice', authorBodyTrialApprovalId: approval.id,
    status: 'failed', failureCode: 'provider_outcome_unknown', attemptCount: 1, maxAttempts: 1,
    estimatedCostKrw: new Prisma.Decimal(100), hardBudgetKrw: new Prisma.Decimal(300), actualCostKrw: null,
    dispatchStartedAt: new Date(NOW.getTime() - 40000), createdAt: new Date(NOW.getTime() - 50000),
    sharedResultId: null, resultGeneratedSceneId: null, progressId: randomUUID(), contextReferences: { preserved: 'synthetic' } };
  const historical = [0, 1].map(() => ({ ...target, id: randomUUID(), authorBodyTrialApprovalId: null, maxAttempts: 3,
    createdAt: new Date(NOW.getTime() - 200000), dispatchStartedAt: new Date(NOW.getTime() - 190000), contextReferences: {} }));
  const measured = { ...target, id: randomUUID(), actualCostKrw: new Prisma.Decimal('228.132'),
    failureCode: 'quality_rejected', contextReferences: {} };
  const rows: any[] = [...historical, target, measured], audits: any[] = [];
  const ledger: any[] = rows.flatMap(row => {
    const reserved = { id: randomUUID(), continuationId: row.id, userId: owner, workId, eventKind: 'recommended_route_request',
      status: 'reserved', provenance: 'ai_generated', estimatedCostKrw: new Prisma.Decimal(100), actualCostKrw: null,
      inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, imageUnits: 0 };
    return [reserved, { ...reserved, id: randomUUID(), eventKind: 'new_route_failed', status: 'failed', actualCostKrw: row.actualCostKrw }];
  });
  const forbid = jest.fn(() => { throw new Error('Synthetic mutation forbidden'); });
  const tx: any = { $executeRaw: jest.fn(async () => 0), $queryRaw: jest.fn(async () => []),
    storyWork: { findFirst: jest.fn(async ({ where }: any) => where.ownerUserId === owner ? work : null) },
    storyRelease: { findFirst: jest.fn(async () => release) },
    storyReleaseCapability: { findUnique: jest.fn(async () => capability) },
    storyStyleProfileConsent: { findUnique: jest.fn(async () => consent) },
    storyAnalysisJob: { findFirst: jest.fn(async () => analysis) },
    storyWorkGenerationProfile: { findFirst: jest.fn(async () => null) },
    storyAuthorBodyTrialApproval: { findFirst: jest.fn(async ({ where }: any) => approval.status === 'active' &&
      (!where.id || where.id === approval.id) && where.userId === owner ? approval : null), create: forbid, update: forbid },
    storyAiContinuation: { findMany: jest.fn(async () => rows), create: forbid, update: forbid,
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (where.id !== target.id || JSON.stringify(where.contextReferences.equals) !== JSON.stringify(target.contextReferences)) return { count: 0 };
        target.contextReferences = data.contextReferences; return { count: 1 };
      }) },
    storyAiUsageLedger: { findMany: jest.fn(async () => ledger), create: forbid, update: forbid },
    auditEvent: { findMany: jest.fn(async ({ where, take }: any) => audits.filter(row => row.action === where.action &&
      (!where.OR ? row.targetId === where.targetId : where.OR.some((part: any) => {
        if (part.targetId) return part.targetId === row.targetId;
        if (part.actorUserId && part.actorUserId !== row.actorUserId) return false;
        return part.metadata.path.reduce((value: any, key: string) => value?.[key], row.metadata) === part.metadata.equals;
      }))).slice(0, take)), create: jest.fn(async ({ data }: any) => { audits.push(data); return data; }) } };
  const prisma: any = { $transaction: jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx)) };
  const costs = new StoryAuthorBodyTrialCostService(prisma), trials = new StoryAuthorBodyTrialService(costs);
  const state = new StoryAuthorBodyTrialStateService(prisma, costs);
  const registration = new StoryAuthorBodyTrialUnknownHoldRegistrationService(prisma, trials, costs);
  const register = async (expiresAt = approval.expiresAt) => {
    const snapshot = await costs.snapshotTx(tx, owner, workId);
    // Pin the actual service projection, including its original JSON property order.
    const oldIds = new Set(historical.map(row => row.id));
    approval.approvalReference = authorBodyTrialHistoricalSeparationReference({ ...snapshot,
      continuations: snapshot.continuations.filter(row => oldIds.has(row.id)),
      ledger: snapshot.ledger.filter(row => oldIds.has(row.continuationId)) }, approval.createdAt);
    return registration.registerCurrentUnknown({ userId: owner, workId, approvalId: approval.id, continuationId: target.id,
      idempotencyKey: randomUUID(), expectedEvidenceSha256: authorBodyTrialUnknownHoldEvidenceSha256(snapshot, target.id),
      expectedApprovedBudgetKrw: '10000.000000', approvalReference: AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_REFERENCE,
      expiresAt, provisionalHoldOnly: true, unknownCostRemainsUnknown: true, notProviderChargeOrLiabilityCeiling: true });
  };
  return { owner, workId, work, release, capability, consent, analysis, approval, target, historical, measured,
    rows, audits, ledger, tx, prisma, costs, trials, state, registration, register, forbid };
}

describe('provisional hold connected services (synthetic only, no provider)', () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => { jest.useFakeTimers().setSystemTime(NOW); f = fixture(); });
  afterEach(() => { expect(f.forbid).not.toHaveBeenCalled(); jest.useRealTimers(); });
  it('keeps unknown/null/current1/historical2 and exact 300 within the original cap after read-only state', async () => {
    await f.register(); const ledger = JSON.stringify(f.ledger), approval = JSON.stringify(f.approval), rows = JSON.stringify(f.rows);
    f.tx.auditEvent.create.mockClear(); f.tx.storyAiContinuation.updateMany.mockClear();
    const value = await f.state.current(f.owner, f.workId);
    expect(value).toMatchObject({ state: 'approval_recorded_with_provisional_hold', generationAuthorized: false,
      currentAuthorizationVerified: false, readOnly: true, nextCostQuoteState: 'prepared', nextMaximumCostKrw: '300.000000',
      budget: { knownActualCostKrw: '228.132000', committedCostKrw: '228.132000', unknownCostCount: 1,
        historicalUnknownCostCount: 2, remainingBudgetKrw: null, evidenceReadyForBudgetCheck: false,
        provisionalHeldAmountKrw: '300.000000', provisionalHeldCount: 1, unresolvedUnheldCount: 0,
        budgetCommittedIncludingHoldsKrw: '528.132000', remainingBudgetIncludingHoldsKrw: '9471.868000',
        holdIsProviderCharge: false, holdIsGuaranteedLiabilityCeiling: false } });
    expect(JSON.stringify(f.ledger)).toBe(ledger); expect(JSON.stringify(f.approval)).toBe(approval); expect(JSON.stringify(f.rows)).toBe(rows);
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled(); expect(f.tx.storyAiContinuation.updateMany).not.toHaveBeenCalled();
    expect(JSON.stringify(value)).not.toMatch(/auditId|manuscript|releaseChecksum|idempotencyKey|approvalReference/);
    expect(f.target.actualCostKrw).toBeNull();
  });
  it('does not accept an approval-shaped object without authorization in the same transaction', async () => {
    await f.register();
    await expect(f.trials.assertCommittedBudgetTx({ ...f.tx }, f.approval)).rejects.toMatchObject({ response: { code: 'STORY_AUTHOR_BODY_TRIAL_COST_UNKNOWN' } });
    await expect(f.trials.assertCommittedBudgetTx(f.tx, { ...f.approval })).rejects.toMatchObject({ response: { code: 'STORY_AUTHOR_BODY_TRIAL_COST_UNKNOWN' } });
  });
  it('allows only an exact currently verified commitment, with no provider or new reservation', async () => {
    await f.register(); const approval = await f.trials.authorizeTx(f.tx, f.owner, { workId: f.workId, approvalId: f.approval.id });
    expect(await f.trials.assertCommittedBudgetTx(f.tx, approval)).toMatchObject({ unknownCostCount: 1,
      provisional: { budgetCheckPassed: true, mayReserve: false, generationAuthorized: false } });
    jest.setSystemTime(new Date(NOW.getTime() + 10001));
    await expect(f.trials.assertCommittedBudgetTx(f.tx, approval)).rejects.toBeInstanceOf(ConflictException);
  });
  it.each(['consent', 'analysis', 'manuscript', 'profile', 'release', 'expired'])('withholds held-state quote after current pin change: %s', async mode => {
    await f.register();
    if (mode === 'consent') f.consent.revision++;
    if (mode === 'analysis') f.analysis.analysisVersion++;
    if (mode === 'manuscript') f.release.manuscriptVersionId = randomUUID();
    if (mode === 'profile') f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue({ id: randomUUID() });
    if (mode === 'release') f.work.activeReleaseId = randomUUID();
    if (mode === 'expired') jest.setSystemTime(new Date(f.approval.expiresAt));
    expect(await f.state.current(f.owner, f.workId)).toMatchObject({ nextCostQuoteState: 'withheld', nextMaximumCostKrw: null,
      generationAuthorized: false, currentAuthorizationVerified: false });
    await expect(f.trials.authorizeTx(f.tx, f.owner, { workId: f.workId, approvalId: f.approval.id })).rejects.toBeInstanceOf(ConflictException);
  });
  it.each(['missing', 'duplicate', 'wrong-metadata', 'changed-cost-evidence'])('blocks incomplete persisted proof: %s', async mode => {
    await f.register();
    if (mode === 'missing') f.audits.length = 0;
    if (mode === 'duplicate') f.audits.push({ ...f.audits[0], id: randomUUID() });
    if (mode === 'wrong-metadata') f.audits[0].metadata = {};
    if (mode === 'changed-cost-evidence') f.ledger.find(row => row.continuationId === f.target.id).inputTokens++;
    await expect(f.state.current(f.owner, f.workId)).rejects.toBeInstanceOf(ConflictException);
  });
  it('new unknowns remain unheld and block the next request', async () => {
    await f.register(); const row = { ...f.target, id: randomUUID(), contextReferences: {} }; f.rows.push(row);
    f.ledger.push(...f.ledger.filter(entry => entry.continuationId === f.target.id).map(entry => ({ ...entry, id: randomUUID(), continuationId: row.id })));
    expect(await f.state.current(f.owner, f.workId)).toMatchObject({ state: 'cost_unknown', nextCostQuoteState: 'withheld',
      budget: { unknownCostCount: 2, provisionalHeldCount: 1, unresolvedUnheldCount: 1, budgetCheckPassed: false } });
    const approval = await f.trials.authorizeTx(f.tx, f.owner, { workId: f.workId, approvalId: f.approval.id });
    await expect(f.trials.assertCommittedBudgetTx(f.tx, approval)).rejects.toMatchObject({ response: { code: 'STORY_AUTHOR_BODY_TRIAL_COST_UNKNOWN' } });
  });
  it('counts a newly reserved maximum together with the hold, rather than spending the hold twice', async () => {
    await f.register(); f.measured.actualCostKrw = new Prisma.Decimal(9300);
    f.ledger.find(row => row.continuationId === f.measured.id && row.status === 'failed').actualCostKrw = f.measured.actualCostKrw;
    const pending = { ...f.target, id: randomUUID(), status: 'queued', attemptCount: 0, dispatchStartedAt: null,
      hardBudgetKrw: new Prisma.Decimal(401), contextReferences: {} }; f.rows.push(pending);
    const reserved = f.ledger.find(row => row.continuationId === f.target.id && row.status === 'reserved');
    f.ledger.push({ ...reserved, id: randomUUID(), continuationId: pending.id });
    const approval = await f.trials.authorizeTx(f.tx, f.owner, { workId: f.workId, approvalId: f.approval.id });
    await expect(f.trials.assertCommittedBudgetTx(f.tx, approval)).rejects.toMatchObject({ response: { code: 'STORY_AUTHOR_BODY_TRIAL_BUDGET_EXCEEDED' } });
  });
  it('does not silently release a hold when a matching failed amount pair is changed to zero', async () => {
    await f.register(); f.target.actualCostKrw = new Prisma.Decimal(0);
    f.ledger.find(row => row.continuationId === f.target.id && row.status === 'failed').actualCostKrw = f.target.actualCostKrw;
    await expect(f.costs.current(f.owner, f.workId)).rejects.toBeInstanceOf(ConflictException);
    await expect(f.state.current(f.owner, f.workId)).rejects.toBeInstanceOf(ConflictException);
    const approval = await f.trials.authorizeTx(f.tx, f.owner, { workId: f.workId, approvalId: f.approval.id });
    await expect(f.trials.assertCommittedBudgetTx(f.tx, approval)).rejects.toBeInstanceOf(ConflictException);
  });
  it.each(['same-work', 'same-key'])('rejects an orphan cross-target audit conflict: %s', async mode => {
    await f.register(); const original = f.audits[0];
    f.audits.push({ ...original, id: randomUUID(), targetId: randomUUID(),
      actorUserId: mode === 'same-work' ? f.owner : randomUUID(), metadata: { ...original.metadata,
        proof: { ...original.metadata.proof, acknowledgement: { ...original.metadata.proof.acknowledgement,
          workId: mode === 'same-work' ? f.workId : randomUUID() } } } });
    await expect(f.state.current(f.owner, f.workId)).rejects.toBeInstanceOf(ConflictException);
    const approval = await f.trials.authorizeTx(f.tx, f.owner, { workId: f.workId, approvalId: f.approval.id });
    await expect(f.trials.assertCommittedBudgetTx(f.tx, approval)).rejects.toBeInstanceOf(ConflictException);
  });
  it('carries the shorter hold deadline and blocks consumption at that deadline', async () => {
    const deadline = new Date(NOW.getTime() + 10000); await f.register(deadline);
    expect(await f.state.current(f.owner, f.workId)).toMatchObject({ budget: { provisionalHoldExpiresAt: deadline.toISOString() } });
    jest.setSystemTime(deadline);
    await expect(f.state.current(f.owner, f.workId)).rejects.toBeInstanceOf(ConflictException);
    const approval = await f.trials.authorizeTx(f.tx, f.owner, { workId: f.workId, approvalId: f.approval.id });
    await expect(f.trials.assertCommittedBudgetTx(f.tx, approval)).rejects.toBeInstanceOf(ConflictException);
  });
  it('rejects a clock rollback after fresh authorization', async () => {
    await f.register(); const approval = await f.trials.authorizeTx(f.tx, f.owner, { workId: f.workId, approvalId: f.approval.id });
    jest.setSystemTime(new Date(NOW.getTime() - 1));
    await expect(f.trials.assertCommittedBudgetTx(f.tx, approval)).rejects.toBeInstanceOf(ConflictException);
  });
});

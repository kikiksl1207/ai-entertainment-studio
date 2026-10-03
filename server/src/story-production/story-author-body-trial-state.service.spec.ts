import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { StoryAuthorBodyTrialStateService } from './story-author-body-trial-state.service';
import { StoryAuthorBodyTrialBudgetError } from './story-author-body-trial-budget.policy';

const userId = randomUUID(), workId = randomUUID(), releaseId = randomUUID();
function fixture() {
  const write = jest.fn(() => { throw new Error('Unexpected mutation'); });
  const work: any = { id: workId, ownerUserId: userId, activeReleaseId: releaseId, status: 'published', fixtureSource: false };
  const approval: any = { id: randomUUID(), userId, workId, releaseId, status: 'active',
    approvedBudgetKrw: new Prisma.Decimal('10000'), expiresAt: new Date(Date.now() + 60000) };
  const tx = { $executeRaw: jest.fn(async (sql: { strings: string[] }) => {
    expect(sql.strings.join('')).toBe('SET TRANSACTION READ ONLY'); return 0;
  }), storyWork: { findFirst: jest.fn(async ({ where }) =>
    Object.entries(where).every(([key, value]) => work[key] === value) ? work : null), create: write, update: write },
    storyAuthorBodyTrialApproval: { findFirst: jest.fn(async ({ where }) =>
      Object.entries(where).every(([key, value]) => approval[key] === value) ? approval : null), create: write, update: write },
    storyReaderProgress: { update: write }, storyAiContinuation: { create: write }, storyAiUsageLedger: { create: write } };
  const prisma = { $transaction: jest.fn(async (callback: (db: typeof tx) => Promise<unknown>, _options: unknown) => callback(tx)) };
  const snapshot: any = { userId, workId, complete: true, continuations: [], ledger: [] };
  const costs = { snapshotTx: jest.fn(async (_db: unknown, _user: string, _work: string) => snapshot) };
  const service = new StoryAuthorBodyTrialStateService(prisma as never, costs as never);
  return { work, approval, tx, prisma, snapshot, costs, service, write };
}

describe('private author body trial recorded state (no providers)', () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => { f = fixture(); });
  afterEach(() => { expect(f.write).not.toHaveBeenCalled(); });

  it('returns the exact recorded budget in a single read-only snapshot without granting generation', async () => {
    const value = await f.service.current(userId, workId);
    expect(value).toMatchObject({ contract: 'story-author-body-trial-state-v1', state: 'approval_recorded',
      readOnly: true, generationAuthorized: false, currentAuthorizationVerified: false, imageGenerationStarted: false,
      approval: { id: f.approval.id, expiresAt: f.approval.expiresAt.toISOString() },
      budget: { approvedBudgetKrw: '10000.000000', remainingBudgetKrw: '10000.000000', evidenceReadyForBudgetCheck: true } });
    expect(f.prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'RepeatableRead' });
    expect(f.costs.snapshotTx).toHaveBeenCalledWith(f.tx, userId, workId);
    expect(JSON.stringify(value)).not.toMatch(/userId|releaseId|approvalReference|manuscript|styleConsent|fingerprint/);
  });

  it('normalizes UUID case', async () => {
    expect(await f.service.current(userId.toUpperCase(), workId.toUpperCase())).toEqual(await f.service.current(userId, workId));
  });

  it.each([[userId, 'invalid'], ['invalid', workId]])('rejects invalid input before database access', async (user, work) => {
    await expect(f.service.current(user, work)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['foreign', 'unpublished', 'fixture'])('hides unavailable work: %s', async mode => {
    if (mode === 'foreign') f.work.ownerUserId = randomUUID();
    if (mode === 'unpublished') f.work.status = 'draft';
    if (mode === 'fixture') f.work.fixtureSource = true;
    await expect(f.service.current(userId, workId)).rejects.toBeInstanceOf(NotFoundException);
    expect(f.tx.storyAuthorBodyTrialApproval.findFirst).not.toHaveBeenCalled();
    expect(f.costs.snapshotTx).not.toHaveBeenCalled();
  });

  it.each(['revoked', 'missing', 'foreign'])('does not invent a grant or free budget: %s', async mode => {
    if (mode === 'revoked') f.approval.status = 'revoked';
    if (mode === 'foreign') f.approval.userId = randomUUID();
    if (mode === 'missing') f.tx.storyAuthorBodyTrialApproval.findFirst.mockResolvedValueOnce(null);
    expect(await f.service.current(userId, workId)).toMatchObject({ state: 'approval_required', approval: null, budget: null });
    expect(f.costs.snapshotTx).not.toHaveBeenCalled();
  });

  it('shows an expired record without renewing it', async () => {
    f.approval.expiresAt = new Date(0);
    expect(await f.service.current(userId, workId)).toMatchObject({ state: 'approval_expired' });
    expect(f.approval.expiresAt).toEqual(new Date(0));
  });

  it('shows a release change without copying approval to the new manuscript', async () => {
    f.work.activeReleaseId = randomUUID();
    expect(await f.service.current(userId, workId)).toMatchObject({ state: 'release_changed' });
  });

  it.each(['0', '10000.000001'])('rejects an invalid recorded cap: %s', async cap => {
    f.approval.approvedBudgetKrw = new Prisma.Decimal(cap);
    await expect(f.service.current(userId, workId)).rejects.toBeInstanceOf(ConflictException);
    expect(f.costs.snapshotTx).not.toHaveBeenCalled();
  });

  function pending(actual: string | null = null, status = 'queued') {
    const id = randomUUID();
    f.snapshot.continuations.push({ id, userId, workId, requestKind: 'recommended_choice', status, attemptCount: 1,
      maxAttempts: 1, dispatchStartedAt: status === 'queued' ? null : new Date(), estimatedCostKrw: '0.25',
      hardBudgetKrw: '4000', actualCostKrw: actual, sharedResultReused: false, sharedResultEvidenceVerified: false,
      sharedResultId: null, resultGeneratedSceneId: null });
    const reserved = { id: randomUUID(), continuationId: id, userId, workId, eventKind: 'recommended_route_request',
      status: 'reserved', provenance: 'ai_generated', estimatedCostKrw: '0.25', actualCostKrw: null,
      inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, imageUnits: 0 };
    f.snapshot.ledger.push(reserved);
    if (status === 'failed') f.snapshot.ledger.push({ ...reserved, id: randomUUID(), eventKind: 'new_route_failed',
      status: 'failed', actualCostKrw: actual });
  }

  it('subtracts the committed maximum, not a cheap estimate', async () => {
    pending();
    expect(await f.service.current(userId, workId)).toMatchObject({ state: 'approval_recorded', budget: {
      committedCostKrw: '4000.000000', remainingBudgetKrw: '6000.000000' } });
  });

  it('does not report spendable remaining money for unknown provider costs', async () => {
    pending(null, 'failed');
    expect(await f.service.current(userId, workId)).toMatchObject({ state: 'cost_unknown', budget: {
      remainingBudgetKrw: null, unknownCostCount: 1, evidenceReadyForBudgetCheck: false } });
  });

  it('shows an exceeded cap without claiming a negative spendable balance', async () => {
    pending(); f.approval.approvedBudgetKrw = new Prisma.Decimal('3999.999999');
    expect(await f.service.current(userId, workId)).toMatchObject({ state: 'budget_over_limit', budget: { remainingBudgetKrw: '0.000000' } });
  });

  it('keeps a fully reserved cap distinct from invalid approval: zero-cost choices still require POST checks', async () => {
    pending(); f.approval.approvedBudgetKrw = new Prisma.Decimal('4000');
    expect(await f.service.current(userId, workId)).toMatchObject({ state: 'approval_recorded', budget: { remainingBudgetKrw: '0.000000' } });
  });

  it('rejects incomplete evidence without a sample fallback', async () => {
    f.snapshot.complete = false;
    await expect(f.service.current(userId, workId)).rejects.toMatchObject({ response: { code: 'STORY_AUTHOR_BODY_TRIAL_COST_EVIDENCE_INCOMPLETE' } });
    f.costs.snapshotTx.mockRejectedValueOnce(new StoryAuthorBodyTrialBudgetError());
    await expect(f.service.current(userId, workId)).rejects.toBeInstanceOf(ConflictException);
  });

  it('propagates database failure without issuing an approval', async () => {
    f.costs.snapshotTx.mockRejectedValueOnce(new Error('Synthetic database failure'));
    await expect(f.service.current(userId, workId)).rejects.toThrow('Synthetic database failure');
  });
});

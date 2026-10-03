import { ConflictException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { spawnSync } from 'child_process';
import { resolve } from 'path';
import { activationFixture } from './story-ai-activation.postgres-fixture';
import { createStoryRouteRoot } from './story-route-identity.store';
import { StoryAuthorBodyTrialCostService } from './story-author-body-trial-cost.service';
import { StoryAuthorBodyTrialService } from './story-author-body-trial.service';
import { StoryAuthorBodyTrialStateService } from './story-author-body-trial-state.service';
import { StoryEconomicsService } from './story-economics.service';
import { StoryProductionService } from './story-production.service';
import { StoryAiActivationService } from './story-ai-activation.service';
import { PersistedStoryContinuationLegalActivationGate } from './story-continuation-legal-activation.gate';
import { authorBodyTrialHistoricalSeparationReference } from './story-author-body-trial-budget.policy';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
jest.setTimeout(30000);
postgres('approved historical separation on isolated PostgreSQL (synthetic, no AI)', () => {
  let db: PrismaClient;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
      parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash ||
      !/^\/lumina_failed_cost_qa_[a-f0-9]{12}$/.test(parsed.pathname)) throw new Error('Dedicated loopback QA database required');
    db = new PrismaClient({ datasources: { db: { url } } }); await db.$connect();
  });
  afterAll(async () => { await db?.$disconnect(); });

  it('records the operator-approved separation with valid DB status, preserved history and idempotent replay', async () => {
    const f = await prepared();
    await db.storyWork.update({ where: { id: f.work.id }, data: {
      title: { ko: '\uB0B4 \uC774\uB984\uC744 \uBA39\uC9C0 \uC54A\uC740 \uAD34\uBB3C' }, fixtureSource: false,
    } });
    await db.storyAuthorBodyTrialApproval.update({ where: { id: f.approval.id },
      data: { approvalReference: 'user-approved-20261002-monster-body-10000' } });
    const before = JSON.stringify(await f.costs.snapshotTx(db, f.owner.id, f.work.id));
    const invoke = (apply: boolean) => {
      const result = spawnSync(process.execPath, [resolve(__dirname, '../../scripts/separate-approved-monster-body-budget.cjs'),
        ...(apply ? ['--apply'] : [])], { cwd: resolve(__dirname, '../..'), encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: url }, timeout: 30000 });
      if (result.status !== 0) throw new Error(`Isolated operator probe: ${result.stderr.trim()}`);
      expect(result.status).toBe(0);
      return JSON.parse(result.stdout.trim());
    };
    expect(invoke(false)).toMatchObject({ recorded: false, historicalUnknownCostCount: 2, unknownCostCount: 0 });
    expect(await db.storyAuthorBodyTrialApproval.count({ where: { userId: f.owner.id, workId: f.work.id } })).toBe(1);
    expect(invoke(true)).toMatchObject({ recorded: true, reusedApproval: false,
      historicalUnknownCostCount: 2, knownActualCostKrw: '45.589500', oldRequestsAndLedgerModified: false });
    expect(invoke(true)).toMatchObject({ recorded: true, reusedApproval: true });
    const records = await db.storyAuthorBodyTrialApproval.findMany({ where: { userId: f.owner.id, workId: f.work.id } });
    expect(records).toHaveLength(2);
    expect(records.find(row => row.id === f.approval.id)?.status).toBe('revoked');
    expect(records.find(row => row.status === 'active')?.expiresAt).toEqual(f.approval.expiresAt);
    expect(JSON.stringify(await f.costs.snapshotTx(db, f.owner.id, f.work.id))).toBe(before);
  });

  async function prepared(cap = '10000') {
    const f = await activationFixture(db, true, false);
    await db.storyReleaseCapability.update({ where: { releaseId: f.release.id }, data: { includedAiRouteCount: 10 } });
    const progress = await db.storyReaderProgress.create({ data: { userId: f.owner.id, workId: f.work.id,
      currentSceneId: f.scene.id, checkpointSceneId: f.scene.id, activeReleaseId: f.release.id,
      aiRateCardId: f.rate.id, capabilityRevision: 1 } });
    const routeNodeId = await createStoryRouteRoot(db, progress, f.scene.id, f.part.actNumber);
    if (!routeNodeId) throw new Error('Synthetic owner route required');
    const route = await db.storyProgressRouteNode.findUniqueOrThrow({ where: { id: routeNodeId } });
    await db.storyReaderProgress.update({ where: { id: progress.id }, data: { routeNodeId } });
    const receipt = await f.request();
    if (!receipt.continuationId) throw new Error('Synthetic continuation required');
    const { id: _id, ...template } = await db.storyAiContinuation.findUniqueOrThrow({ where: { id: receipt.continuationId } });
    const { id: _ledgerId, ...reserved } = await db.storyAiUsageLedger.findFirstOrThrow({ where: {
      continuationId: receipt.continuationId, eventKind: 'recommended_route_request' } });
    const historicalIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const actualCostKrw = i === 2 ? '45.589500' : null;
      const row = await db.storyAiContinuation.create({ data: { ...template, userId: f.owner.id,
        contextReferences: template.contextReferences ?? Prisma.JsonNull,
        progressId: progress.id, sourceRouteNodeId: route.id, sourceRouteHash: route.routeHash,
        idempotencyKey: `synthetic-legacy:${randomUUID()}`, status: 'failed',
        attemptCount: 1, maxAttempts: 3, dispatchStartedAt: new Date('2026-09-27T00:00:00Z'),
        createdAt: new Date('2026-09-27T00:00:00Z'), completedAt: new Date('2026-09-27T00:01:00Z'), actualCostKrw } });
      historicalIds.push(row.id);
      await db.storyAiUsageLedger.create({ data: { ...reserved, userId: f.owner.id, continuationId: row.id,
        idempotencyKey: `synthetic-reserve:${randomUUID()}` } });
      await db.storyAiUsageLedger.create({ data: { ...reserved, userId: f.owner.id, continuationId: row.id,
        idempotencyKey: `synthetic-failed:${randomUUID()}`, status: 'failed', eventKind: 'new_route_failed',
        actualCostKrw, inputTokens: i === 2 ? 10074 : 0, outputTokens: i === 2 ? 5075 : 0 } });
    }
    const costs = new StoryAuthorBodyTrialCostService(db as never), trial = new StoryAuthorBodyTrialService(costs);
    const createdAt = new Date();
    const reference = await db.$transaction(async tx => authorBodyTrialHistoricalSeparationReference(
      await costs.snapshotTx(tx, f.owner.id, f.work.id), createdAt));
    const analysis = await db.storyAnalysisJob.findFirstOrThrow({ where: { workId: f.work.id } });
    const approval = await db.storyAuthorBodyTrialApproval.create({ data: { userId: f.owner.id, workId: f.work.id,
      releaseId: f.release.id, manuscriptVersionId: f.manuscript.id, releaseChecksum: f.release.checksum,
      capabilityRevision: 1, styleConsentId: f.consent.id, styleConsentRevision: f.consent.revision,
      analysisJobId: analysis.id, analysisVersion: analysis.analysisVersion, approvedBudgetKrw: cap,
      approvalReference: reference, createdAt, expiresAt: new Date(Date.now() + 3600000) } });
    const legal = new PersistedStoryContinuationLegalActivationGate(new StoryAiActivationService(db as never));
    const provider = { ...f.provider, preflight: jest.fn().mockResolvedValue({ supported: true, inputTokenUpperBound: 100 }) };
    const economics = new StoryEconomicsService(db as never, legal, provider as never, f.approval, undefined, trial);
    const stories = new StoryProductionService(db as never, economics, provider as never, legal,
      undefined, undefined, undefined, undefined, undefined, trial);
    const choose = (key: string) => stories.selectAuthorBodyTrialChoice(f.owner.id, f.work.id, f.choice.id,
      { approvalId: approval.id, progressId: progress.id, expectedRevision: 1, locale: 'ko' }, key);
    const history = async () => ({ continuations: await db.storyAiContinuation.findMany({
      where: { id: { in: historicalIds } }, orderBy: { id: 'asc' } }), ledger: await db.storyAiUsageLedger.findMany({
      where: { continuationId: { in: historicalIds } }, orderBy: { id: 'asc' } }) });
    return { ...f, progress, approval, costs, trial, provider, economics, choose, history,
      state: new StoryAuthorBodyTrialStateService(db as never, costs) };
  }

  it('preserves historical rows and strict GET while scoped state subtracts all known spending', async () => {
    const f = await prepared(), before = await f.history();
    expect(await f.costs.current(f.owner.id, f.work.id)).toMatchObject({ unknownCostCount: 2, knownActualCostKrw: '45.589500' });
    expect(await f.state.current(f.owner.id, f.work.id)).toMatchObject({ state: 'approval_recorded', budget: {
      historicalUnknownCostCount: 2, unknownCostCount: 0, remainingBudgetKrw: '9954.410500' } });
    expect(await f.history()).toEqual(before); expect(f.provider.generate).not.toHaveBeenCalled();
  });
  it('queues one single-attempt trial, replays once, and revalidates scoped dispatch', async () => {
    const f = await prepared(), before = await f.history(), key = `synthetic-new-trial:${randomUUID()}`;
    const result = await f.choose(key) as { continuationId: string };
    await f.choose(key);
    const row = await db.storyAiContinuation.findUniqueOrThrow({ where: { id: result.continuationId } });
    expect(row.maxAttempts).toBe(1); expect(row.authorBodyTrialApprovalId).toBe(f.approval.id);
    expect(await db.$transaction(tx => f.trial.authorizeDispatchTx(tx, row))).toBe(true);
    expect(await db.storyAiContinuation.count({ where: { authorBodyTrialApprovalId: f.approval.id } })).toBe(1);
    expect(await f.history()).toEqual(before); expect(f.provider.generate).not.toHaveBeenCalled();
  });
  it('blocks a new unknown failure and never rolls it into the approved historical pair', async () => {
    const f = await prepared(), before = await f.history();
    const receipt = await f.choose(`synthetic-new-unknown:${randomUUID()}`) as { continuationId: string };
    const row = await db.storyAiContinuation.update({ where: { id: receipt.continuationId }, data: {
      status: 'processing', attemptCount: 1, leaseToken: 'synthetic-unknown', leaseOwner: 'isolated-qa',
      leaseExpiresAt: new Date(Date.now() + 60000), dispatchStartedAt: new Date() } });
    const claim = { continuationId: row.id, leaseToken: row.leaseToken!, attemptCount: 1, maxAttempts: 1,
      request: { operationId: row.id, locale: row.locale, contextFingerprint: row.contextFingerprint,
        promptVersion: row.promptVersion, outputSchemaVersion: row.outputSchemaVersion,
        inputTokenLimit: row.inputTokenLimit, outputTokenLimit: row.outputTokenLimit } };
    await f.economics.failClaimedContinuation(claim, 'provider_outcome_unknown', 'failed');
    expect(await f.state.current(f.owner.id, f.work.id)).toMatchObject({ state: 'cost_unknown', budget: {
      historicalUnknownCostCount: 2, unknownCostCount: 1, remainingBudgetKrw: null } });
    await expect(db.$transaction(tx => f.trial.assertCommittedBudgetTx(tx, f.approval))).rejects.toBeInstanceOf(ConflictException);
    expect(await f.history()).toEqual(before); expect(f.provider.generate).not.toHaveBeenCalled();
  });
  it('rolls back an over-budget request including progress, allowance, command and reservation', async () => {
    const f = await prepared('45.590000'), before = await f.history();
    const progress = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progress.id } });
    await expect(f.choose(`synthetic-over-budget:${randomUUID()}`)).rejects.toMatchObject({ response: {
      code: 'STORY_AUTHOR_BODY_TRIAL_BUDGET_EXCEEDED' } });
    expect(await db.storyAiContinuation.count({ where: { authorBodyTrialApprovalId: f.approval.id } })).toBe(0);
    expect(await db.storyAuthorBodyTrialCommand.count({ where: { approvalId: f.approval.id } })).toBe(0);
    expect(await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progress.id } })).toEqual(progress);
    expect(await f.history()).toEqual(before); expect(f.provider.generate).not.toHaveBeenCalled();
  });
});

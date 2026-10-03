'use strict';
const assert = require('node:assert/strict');
const { PrismaClient, Prisma } = require('@prisma/client');
const { StoryAuthorBodyTrialCostService } = require('../dist/story-production/story-author-body-trial-cost.service');
const { StoryAuthorBodyTrialService } = require('../dist/story-production/story-author-body-trial.service');
const { summarizeAuthorBodyTrialCosts, summarizeApprovedAuthorBodyTrialCosts,
  authorBodyTrialHistoricalSeparationReference } = require('../dist/story-production/story-author-body-trial-budget.policy');
const db = new PrismaClient();
const costs = new StoryAuthorBodyTrialCostService(db);
const trial = new StoryAuthorBodyTrialService(costs);
const originalReference = 'user-approved-20261002-monster-body-10000';
const prefix = 'user-approved-20261004-future-body-v1:';

async function run() {
  const apply = process.argv.includes('--apply');
  const result = await db.$transaction(async tx => {
    const works = await tx.storyWork.findMany({ where: {
      title: { path: ['ko'], equals: '\ub0b4 \uc774\ub984\uc744 \uba39\uc9c0 \uc54a\uc740 \uad34\ubb3c' },
      status: 'published', fixtureSource: false,
    }, select: { id: true, ownerUserId: true } });
    assert.equal(works.length, 1);
    const work = works[0];
    assert(work.ownerUserId);
    await trial.lockWorkTx(tx, work.ownerUserId, work.id);
    const recorded = await tx.storyAuthorBodyTrialApproval.findMany({ where: {
      userId: work.ownerUserId, workId: work.id, approvalReference: { startsWith: prefix },
    } });
    assert(recorded.length <= 1, 'Do not reset an existing separated budget');
    const snapshot = await costs.snapshotTx(tx, work.ownerUserId, work.id);
    if (recorded.length) {
      await trial.authorizeTx(tx, work.ownerUserId, { workId: work.id, approvalId: recorded[0].id });
      return { recorded: true, reusedApproval: true, ...summarizeApprovedAuthorBodyTrialCosts(snapshot, recorded[0]) };
    }
    const original = await tx.storyAuthorBodyTrialApproval.findUniqueOrThrow({ where: { approvalReference: originalReference } });
    assert.equal(original.userId, work.ownerUserId); assert.equal(original.workId, work.id);
    assert.equal(original.approvedBudgetKrw.toFixed(6), '10000.000000');
    await trial.authorizeTx(tx, work.ownerUserId, { workId: work.id, approvalId: original.id });
    assert.equal(await tx.storyAuthorBodyTrialApproval.count({ where: {
      userId: work.ownerUserId, workId: work.id, status: 'active',
    } }), 1, 'Exactly one current approval is required');
    const all = summarizeAuthorBodyTrialCosts(snapshot);
    assert.equal(all.requestCount, 3); assert.equal(all.unknownCostCount, 2); assert.equal(all.pendingCount, 0);
    assert.equal(all.knownActualCostKrw, '45.589500'); assert.equal(all.reservedMaximumCostKrw, '0.000000');
    const createdAt = new Date();
    const approvalReference = authorBodyTrialHistoricalSeparationReference(snapshot, createdAt);
    const { id: _id, createdAt: _created, ...pins } = original;
    const next = { ...pins, approvalReference, createdAt };
    const summary = summarizeApprovedAuthorBodyTrialCosts(snapshot, next);
    if (!apply) return { recorded: false, dryRun: true, ...summary };
    assert.equal((await tx.storyAuthorBodyTrialApproval.updateMany({ where: { id: original.id,
      status: 'active', approvalReference: originalReference }, data: { status: 'superseded' } })).count, 1);
    const approval = await tx.storyAuthorBodyTrialApproval.create({ data: next });
    await trial.authorizeTx(tx, work.ownerUserId, { workId: work.id, approvalId: approval.id });
    await trial.assertCommittedBudgetTx(tx, approval);
    return { recorded: true, reusedApproval: false, ...summary };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
  console.log(JSON.stringify({ contract: 'explicit-historical-body-cost-separation-v1', ...result,
    approvedBudgetKrw: '10000.000000', originalKnownCostRetained: true, oldRequestsAndLedgerModified: false,
    originalExpiryRetained: true, generationStarted: false, imageStarted: false }));
}
run().catch(error => { console.error(JSON.stringify({ failed: true, code: error.code ?? 'SEPARATION_PRECONDITION_FAILED' }));
  process.exitCode = 1;
}).finally(() => db.$disconnect());

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { StoryAuthorFinalReviewService } from './story-author-final-review.service';
import { StoryLifecycleService } from './story-lifecycle.service';
import { StoryEconomicsService } from './story-economics.service';
import { createAuthoredImportPgFixture } from './story-authored-import.postgres-fixture';
import type { readActualAuthoredImportFixture } from './story-authored-import.actual-fixture';

export function assertAuthorReviewTestDatabase(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55432' ||
      url.username !== 'lumina_qa' || url.pathname !== '/lumina_author_length_qa' || url.search || url.hash) {
    throw new Error('Dedicated author-review loopback QA database required');
  }
}

export async function authorReviewPgFixture(db: PrismaClient, source?: ReturnType<typeof readActualAuthoredImportFixture>) {
  const imported = await createAuthoredImportPgFixture(db, source);
  // QA-only initial preparation BEFORE import, not a mutation of a retained receipt.
  await db.storyWork.update({ where: { id: imported.work.id }, data: { fixtureSource: false } });
  await imported.apply();
  await db.storyWork.update({ where: { id: imported.work.id }, data: { status: 'release_ready' } });
  const analysis = await db.storyAnalysisJob.create({ data: { workId: imported.work.id,
    manuscriptVersionId: imported.manuscript.id, analysisVersion: 1, idempotencyKey: randomUUID(),
    status: 'completed', pipeline: 'structural_legacy' } });
  const review = await db.storyWriterReview.create({ data: { workId: imported.work.id,
    ownerUserId: imported.owner.id, manuscriptVersionId: imported.manuscript.id,
    analysisJobId: analysis.id, state: 'final_confirmation' } });
  const rate = await db.storyAiRateCard.create({ data: { version: randomUUID(), provider: 'offline-test', model: 'synthetic-v1',
    status: 'active', inputCostPerMillion: 0, outputCostPerMillion: 0, createdByUserId: imported.owner.id } });
  await db.storyReleaseCapability.create({ data: { workId: imported.work.id, releaseId: imported.release.id,
    rateCardId: rate.id, status: 'active', updatedByUserId: imported.owner.id } });
  const service = new StoryAuthorFinalReviewService(db as never);
  const lifecycle = new StoryLifecycleService(db as never, new StoryEconomicsService(db as never), service);
  const body = { releaseId: imported.release.id, expectedRevision: review.revision,
    includeContinuationAnchor: true, minGeneratedSegments: 1 };
  const proposal = await service.propose(imported.owner.id, review.id, body);
  const confirmation = { ...body, proposalHash: proposal.proposalHash, reviewedScopes: proposal.snapshot.reviewedScopes };
  const key = randomUUID();
  const confirm = (overrideKey = key) => lifecycle.submitReview(imported.owner.id, review.id, overrideKey, { authoredReview: confirmation });
  const publish = () => lifecycle.transitionPublication(imported.owner.id, imported.work.id,
    { releaseId: imported.release.id, expectedRevision: imported.work.releaseRevision, toStatus: 'published' }, randomUUID());
  return { ...imported, review, proposal, confirmation, service, lifecycle, confirm, publish, finalKey: key };
}

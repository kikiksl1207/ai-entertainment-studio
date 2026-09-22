import { Prisma } from '@prisma/client';
import { releaseChecksum } from './story-lifecycle.policy';
import { AUTHOR_FINAL_REVIEW_VERSION, AUTHOR_WHOLE_PART_MAPPING, authorReviewConflict, type AuthorReviewSnapshot } from './story-author-final-review.policy';

export async function createAuthorFinalSubmissionTx(tx: Prisma.TransactionClient, input: {
  reviewId: string; manuscriptVersionId: string; idempotencyKey: string; checksum: string;
}) {
  // Keep the server transaction timestamp; Prisma's @default(now()) can supply
  // application time, which is not the proof trigger's same-transaction marker.
  const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>(Prisma.sql`
    INSERT INTO story_final_submissions (review_id, manuscript_version_id, idempotency_key, checksum)
    VALUES (${input.reviewId}::uuid, ${input.manuscriptVersionId}::uuid, ${input.idempotencyKey}, ${input.checksum})
    RETURNING id, status`);
  if (rows.length !== 1) authorReviewConflict('AUTHOR_FINAL_SUBMISSION_CREATE_FAILED');
  return rows[0];
}

export async function authorReviewSnapshotHash(tx: Prisma.TransactionClient, value: unknown): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ hash: string }>>(Prisma.sql`
    SELECT story_author_review_snapshot_hash(${JSON.stringify(value)}::jsonb) AS hash`);
  if (!rows[0]?.hash) authorReviewConflict('AUTHOR_REVIEW_HASH_UNAVAILABLE');
  return rows[0].hash;
}

export async function authorContentChecksum(tx: Prisma.TransactionClient, workId: string): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ hash: string }>>(Prisma.sql`
    SELECT story_author_content_checksum(${workId}::uuid) AS hash`);
  if (!rows[0]?.hash) authorReviewConflict('AUTHOR_REVIEW_HASH_UNAVAILABLE');
  return rows[0].hash;
}

export async function lockAuthorMaterializedRows(tx: Prisma.TransactionClient, workId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${workId}::uuid FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM story_parts WHERE work_id = ${workId}::uuid ORDER BY id FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT s.id FROM story_scenes s JOIN story_parts p ON p.id = s.part_id
    WHERE p.work_id = ${workId}::uuid ORDER BY s.id FOR UPDATE OF s`);
  await tx.$queryRaw(Prisma.sql`SELECT b.id FROM story_beats b JOIN story_scenes s ON s.id = b.scene_id
    JOIN story_parts p ON p.id = s.part_id WHERE p.work_id = ${workId}::uuid ORDER BY b.id FOR UPDATE OF b`);
  await tx.$queryRaw(Prisma.sql`SELECT c.id FROM story_choices c JOIN story_scenes s ON s.id = c.scene_id
    JOIN story_parts p ON p.id = s.part_id WHERE p.work_id = ${workId}::uuid ORDER BY c.id FOR UPDATE OF c`);
}

export async function validAuthorFinalReviewProof(
  tx: Prisma.TransactionClient,
  input: { workId: string; releaseId: string; manuscriptVersionId?: string; scope: 'publication' | 'anchor' },
) {
  const proof = await tx.storyAuthorFinalReviewProof.findUnique({ where: { releaseId: input.releaseId } });
  if (!proof || proof.workId !== input.workId || proof.contractVersion !== AUTHOR_FINAL_REVIEW_VERSION ||
      (input.manuscriptVersionId && proof.manuscriptVersionId !== input.manuscriptVersionId) ||
      (input.scope === 'anchor' && !proof.anchorScope)) authorReviewConflict(input.scope === 'publication'
        ? 'AUTHORED_IMPORT_REVIEW_BINDING_REQUIRED' : 'AUTHOR_FINAL_REVIEW_PROOF_REQUIRED');
  const revoked = await tx.storyAuthorFinalReviewRevocation.findUnique({ where: { proofId: proof.id } });
  if (revoked) authorReviewConflict('AUTHOR_FINAL_REVIEW_PROOF_REVOKED');
  const work = await tx.storyWork.findUnique({ where: { id: proof.workId } });
  const release = await tx.storyRelease.findUnique({ where: { id: proof.releaseId } });
  const manuscript = await tx.storyManuscriptVersion.findUnique({ where: { id: proof.manuscriptVersionId } });
  const receipt = await tx.storyAuthoredImport.findUnique({ where: { id: proof.authoredImportId } });
  const snapshot = proof.bindingSnapshot as unknown as AuthorReviewSnapshot;
  if (!work || !release || !manuscript || !receipt || work.ownerUserId !== proof.ownerUserId ||
      manuscript.ownerUserId !== proof.ownerUserId || manuscript.workId !== proof.workId ||
      release.workId !== proof.workId || release.manuscriptVersionId !== manuscript.id ||
      receipt.ownerUserId !== proof.ownerUserId || receipt.workId !== proof.workId || receipt.releaseId !== release.id ||
      receipt.manuscriptVersionId !== manuscript.id || manuscript.contentHash !== receipt.manuscriptContentHash ||
      snapshot?.version !== AUTHOR_FINAL_REVIEW_VERSION || snapshot.mappingVersion !== AUTHOR_WHOLE_PART_MAPPING ||
      snapshot.receiptId !== receipt.id || snapshot.sourceMapSha256 !== receipt.sourceMapSha256 ||
      snapshot.planChecksum !== receipt.planChecksum || snapshot.draftMaterializedChecksum !== receipt.materializedChecksum ||
      snapshot.contentChecksum !== proof.contentChecksum || snapshot.releaseChecksum !== release.checksum ||
      release.checksum !== receipt.releaseChecksum ||
      releaseChecksum({ manuscriptVersionId: release.manuscriptVersionId, branchGraphSnapshot: release.branchGraphSnapshot,
        endingSetSnapshot: release.endingSetSnapshot, sceneAssetManifest: release.sceneAssetManifest,
        localizedDisplaySnapshot: release.localizedDisplaySnapshot }) !== receipt.releaseChecksum ||
      !Array.isArray(snapshot.parts) || !snapshot.parts.length || snapshot.parts.length > 1000 ||
      await authorContentChecksum(tx, proof.workId) !== proof.contentChecksum ||
      await authorReviewSnapshotHash(tx, snapshot) !== proof.proposalHash ||
      await authorReviewSnapshotHash(tx, { proofId: proof.id, finalSubmissionId: proof.finalSubmissionId,
        proposalHash: proof.proposalHash }) !== proof.proofHash) authorReviewConflict('AUTHOR_FINAL_REVIEW_BINDING_CHANGED');
  return { proof, snapshot, receipt };
}

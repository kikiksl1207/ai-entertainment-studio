import { Prisma } from '@prisma/client';
import { AuthorBodyReviewInput } from './story-author-body-review.policy';

export type BodyReviewRow = {
  id: string; ownerUserId: string; workId: string; locale: string; version: number;
  sourceBindingHash: string; requestHash: string; decision: 'approve' | 'reject';
  styleReviewed: boolean; charactersReviewed: boolean; timelineReviewed: boolean;
  createdAt: Date; withdrawnAt: Date | null;
};

const projection = Prisma.sql`r.id, r.owner_user_id AS "ownerUserId", r.work_id AS "workId",
  r.locale, r.version, r.source_binding_hash AS "sourceBindingHash", r.request_hash AS "requestHash",
  r.decision, r.style_reviewed AS "styleReviewed", r.characters_reviewed AS "charactersReviewed",
  r.timeline_reviewed AS "timelineReviewed", r.created_at AS "createdAt", w.created_at AS "withdrawnAt"`;

export async function latestBodyReview(db: Prisma.TransactionClient, owner: string, work: string) {
  const rows = await db.$queryRaw<BodyReviewRow[]>(Prisma.sql`SELECT ${projection}
    FROM story_author_body_reviews r LEFT JOIN story_author_body_review_withdrawals w ON w.review_id = r.id
    WHERE r.owner_user_id = ${owner}::uuid AND r.work_id = ${work}::uuid ORDER BY r.version DESC LIMIT 1`);
  return rows[0] ?? null;
}

export async function bodyReviewByKey(db: Prisma.TransactionClient, owner: string, work: string, key: string) {
  const rows = await db.$queryRaw<BodyReviewRow[]>(Prisma.sql`SELECT ${projection}
    FROM story_author_body_reviews r LEFT JOIN story_author_body_review_withdrawals w ON w.review_id = r.id
    WHERE r.owner_user_id = ${owner}::uuid AND r.work_id = ${work}::uuid AND r.idempotency_key = ${key}`);
  return rows[0] ?? null;
}

export async function bodyReviewById(db: Prisma.TransactionClient, owner: string, work: string, id: string) {
  const rows = await db.$queryRaw<BodyReviewRow[]>(Prisma.sql`SELECT ${projection}
    FROM story_author_body_reviews r LEFT JOIN story_author_body_review_withdrawals w ON w.review_id = r.id
    WHERE r.owner_user_id = ${owner}::uuid AND r.work_id = ${work}::uuid AND r.id = ${id}::uuid`);
  return rows[0] ?? null;
}

export async function insertBodyReview(db: Prisma.TransactionClient, input: {
  id: string; owner: string; work: string; progress: string; scene: string; continuation: string;
  version: number; binding: Record<string, unknown>; body: AuthorBodyReviewInput; requestHash: string; key: string;
}) {
  const { body } = input;
  await db.$executeRaw(Prisma.sql`INSERT INTO story_author_body_reviews
    (id, owner_user_id, work_id, release_id, progress_id, scene_id, continuation_id, locale, version,
      source_binding_hash, binding_snapshot, request_hash, idempotency_key, decision,
      style_reviewed, characters_reviewed, timeline_reviewed)
    VALUES (${input.id}::uuid, ${input.owner}::uuid, ${input.work}::uuid, ${String(input.binding.releaseId)}::uuid, ${input.progress}::uuid,
      ${input.scene}::uuid, ${input.continuation}::uuid, ${body.locale}, ${input.version},
      ${body.sourceBindingHash}, ${JSON.stringify(input.binding)}::jsonb, ${input.requestHash}, ${input.key},
      ${body.decision}, ${body.styleReviewed}, ${body.charactersReviewed}, ${body.timelineReviewed})`);
  return (await bodyReviewById(db, input.owner, input.work, input.id))!;
}

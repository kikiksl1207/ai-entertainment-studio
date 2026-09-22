import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { StoryAuthorFinalReviewService } from './story-author-final-review.service';
import { authorContentChecksum, validAuthorFinalReviewProof } from './story-author-final-review.store';
import { StoryLifecycleService } from './story-lifecycle.service';
import { readActualAuthoredImportFixture } from './story-authored-import.actual-fixture';
import { assertAuthorReviewTestDatabase, authorReviewPgFixture } from './story-author-final-review.postgres-fixture';

const databaseUrl = process.env.STORY_AUTHOR_REVIEW_TEST_DATABASE_URL;
const pg = databaseUrl ? describe : describe.skip;

pg('initial new final proof, real PostgreSQL (isolated QA, no providers)', () => {
  let db: PrismaClient;
  beforeAll(() => {
    assertAuthorReviewTestDatabase(databaseUrl!);
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });
  afterAll(async () => { await db?.$disconnect(); });

  const fixture = (source?: ReturnType<typeof readActualAuthoredImportFixture>) => authorReviewPgFixture(db, source);

  it('creates one initial proof and submission through the existing submitReview entry point', async () => {
    const f = await fixture();
    const first = await f.confirm();
    expect(first).toMatchObject({ idempotentReplay: false, proofStatus: 'recorded' });
    expect(await f.confirm()).toMatchObject({ idempotentReplay: true });
    expect(await db.storyAuthorFinalReviewProof.count({ where: { reviewId: f.review.id } })).toBe(1);
    expect(await db.storyFinalSubmission.count({ where: { reviewId: f.review.id } })).toBe(1);
    expect(await db.storyWriterReview.findUnique({ where: { id: f.review.id }, select: { state: true, revision: true } }))
      .toEqual({ state: 'submitted', revision: f.review.revision + 1 });
  });

  it('serializes same-key cross-client confirmation into one immutable result', async () => {
    const f = await fixture();
    const other = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const otherLifecycle = new StoryLifecycleService(other as never, undefined, new StoryAuthorFinalReviewService(other as never));
      const results = await Promise.all([f.confirm(), otherLifecycle.submitReview(f.owner.id, f.review.id, f.finalKey,
        { authoredReview: f.confirmation })]);
      expect(results.filter(result => result.idempotentReplay === false)).toHaveLength(1);
      expect(await db.storyAuthorFinalReviewProof.count({ where: { reviewId: f.review.id } })).toBe(1);
    } finally { await other.$disconnect(); }
  });

  it('allows exactly one different-key confirmation without reopening or superseding', async () => {
    const f = await fixture();
    const results = await Promise.allSettled([f.confirm(), f.confirm(randomUUID())]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(await db.storyFinalSubmission.count({ where: { reviewId: f.review.id } })).toBe(1);
    expect(await db.storyAuthorFinalReviewProof.count({ where: { reviewId: f.review.id } })).toBe(1);
  });

  it('preserves the legacy final submission and refuses upgrade with either old or new key', async () => {
    const f = await fixture();
    const legacy = await db.storyFinalSubmission.create({ data: { reviewId: f.review.id,
      manuscriptVersionId: f.manuscript.id,
      idempotencyKey: `story-final-submit:${createHash('sha256').update(f.finalKey).digest('hex')}`,
      checksum: f.manuscript.contentHash } });
    await db.storyWriterReview.update({ where: { id: f.review.id }, data: { state: 'submitted' } });
    const historical = await f.lifecycle.submitReview(f.owner.id, f.review.id, f.finalKey);
    expect(historical).toMatchObject({ idempotentReplay: true });
    expect(historical).not.toHaveProperty('proofId');
    for (const key of [f.finalKey, randomUUID()]) {
      await expect(f.confirm(key)).rejects.toMatchObject({ response: { code: 'AUTHOR_LEGACY_SUBMISSION_PROOF_UNSUPPORTED' } });
    }
    expect((await db.storyFinalSubmission.findUniqueOrThrow({ where: { id: legacy.id } })).checksum).toBe(f.manuscript.contentHash);
    expect(await db.storyAuthorFinalReviewProof.count({ where: { reviewId: f.review.id } })).toBe(0);
  });

  it('checks owner before even a valid historical global-key replay', async () => {
    const f = await fixture();
    await f.confirm();
    const foreign = await db.user.create({ data: {} });
    await expect(f.lifecycle.submitReview(foreign.id, f.review.id, f.finalKey))
      .rejects.toMatchObject({ status: 404 });
    await expect(f.lifecycle.submitReview(foreign.id, f.review.id, f.finalKey, { authoredReview: f.confirmation }))
      .rejects.toMatchObject({ status: 404 });
  });

  it('refuses changed proposal content without any partial submission', async () => {
    const f = await fixture();
    const part = await db.storyPart.findFirstOrThrow({ where: { workId: f.work.id } });
    await db.storyPart.update({ where: { id: part.id }, data: { priceLumina: 38 } });
    await expect(f.confirm()).rejects.toMatchObject({ response: { code: 'AUTHORED_MATERIALIZED_CONTENT_CHANGED' } });
    expect(await db.storyFinalSubmission.count({ where: { reviewId: f.review.id } })).toBe(0);
    expect(await db.storyAuthorFinalReviewProof.count({ where: { reviewId: f.review.id } })).toBe(0);
  });

  it('rolls back the new submission and proof when review CAS fails', async () => {
    const f = await fixture();
    const wrapped = new Proxy(db, { get(target, property) {
      if (property === '$transaction') return (run: (tx: unknown) => Promise<unknown>, options: unknown) =>
        db.$transaction(tx => run(new Proxy(tx, { get(t, p) {
          if (p === 'storyWriterReview') return { ...t.storyWriterReview, updateMany: async () => ({ count: 0 }) };
          return Reflect.get(t, p);
        } })), options as never);
      return Reflect.get(target, property);
    } });
    await expect(new StoryAuthorFinalReviewService(wrapped as never).confirm(f.owner.id, f.review.id, f.confirmation, randomUUID()))
      .rejects.toMatchObject({ response: { code: 'AUTHOR_FINAL_REVIEW_CONFIRMATION_STALE' } });
    expect(await db.storyFinalSubmission.count({ where: { reviewId: f.review.id } })).toBe(0);
    expect(await db.storyAuthorFinalReviewProof.count({ where: { reviewId: f.review.id } })).toBe(0);
  });

  it('keeps both proof and revocation append-only in the database', async () => {
    const f = await fixture();
    await f.confirm();
    const proof = await db.storyAuthorFinalReviewProof.findUniqueOrThrow({ where: { reviewId: f.review.id } });
    await expect(db.storyAuthorFinalReviewProof.update({ where: { id: proof.id }, data: { anchorScope: false } })).rejects.toThrow();
    await expect(db.storyAuthorFinalReviewProof.delete({ where: { id: proof.id } })).rejects.toThrow();
    await f.service.revoke(f.owner.id, proof.id);
    await expect(db.storyAuthorFinalReviewRevocation.delete({ where: { proofId: proof.id } })).rejects.toThrow();
    await expect(db.storyAuthorFinalReviewRevocation.update({ where: { proofId: proof.id }, data: { reasonCode: 'binding_invalid' } })).rejects.toThrow();
    await expect(db.$transaction(tx => validAuthorFinalReviewProof(tx, {
      workId: f.work.id, releaseId: f.release.id, scope: 'anchor',
    }))).rejects.toMatchObject({ response: { code: 'AUTHOR_FINAL_REVIEW_PROOF_REVOKED' } });
    await expect(f.publish()).rejects.toMatchObject({ response: { code: 'AUTHOR_FINAL_REVIEW_PROOF_REVOKED' } });
    expect(await f.confirm()).toMatchObject({ proofStatus: 'revoked', idempotentReplay: true });
  });

  it('retains the receipt draft checksum while the approved content digest survives atomic publication', async () => {
    const f = await fixture();
    const receipt = await db.storyAuthoredImport.findUniqueOrThrow({ where: { workId: f.work.id } });
    await f.confirm();
    const before = await authorContentChecksum(db, f.work.id);
    await f.publish();
    expect(await authorContentChecksum(db, f.work.id)).toBe(before);
    expect((await db.storyAuthoredImport.findUniqueOrThrow({ where: { workId: f.work.id } })).materializedChecksum)
      .toBe(receipt.materializedChecksum);
    expect(await db.storyPart.count({ where: { workId: f.work.id, status: 'published' } })).toBe(3);
    const proof = await db.$transaction(tx => validAuthorFinalReviewProof(tx, {
      workId: f.work.id, releaseId: f.release.id, manuscriptVersionId: f.manuscript.id, scope: 'anchor',
    }));
    expect(proof.snapshot.parts.length).toBe(3);
  });

  it('denies direct publication without proof and preserves capability gates after proof', async () => {
    const f = await fixture();
    await expect(db.storyWork.update({ where: { id: f.work.id }, data: { status: 'published', activeReleaseId: f.release.id } })).rejects.toThrow();
    await f.confirm();
    await db.storyReleaseCapability.update({ where: { releaseId: f.release.id }, data: { status: 'draft' } });
    await expect(f.publish()).rejects.toThrow('Valid release capability and rate card are required');
    expect(await db.storyPart.count({ where: { workId: f.work.id, status: 'published' } })).toBe(0);
    expect((await db.storyRelease.findUniqueOrThrow({ where: { id: f.release.id } })).status).toBe('candidate');
  });

  it('rejects a forged cross-review receipt binding at the database boundary', async () => {
    const f = await fixture();
    const other = await fixture();
    await f.confirm();
    const proof = await db.storyAuthorFinalReviewProof.findUniqueOrThrow({ where: { reviewId: f.review.id } });
    await expect(db.$transaction(async tx => {
      const submission = await tx.storyFinalSubmission.create({ data: { reviewId: other.review.id,
        manuscriptVersionId: other.manuscript.id, idempotencyKey: randomUUID(), checksum: other.manuscript.contentHash } });
      await tx.storyAuthorFinalReviewProof.create({ data: { ...proof, id: randomUUID(), createdAt: undefined,
        finalSubmissionId: submission.id, reviewId: other.review.id, ownerUserId: other.owner.id,
        workId: other.work.id, manuscriptVersionId: other.manuscript.id,
        bindingSnapshot: proof.bindingSnapshot as Prisma.InputJsonValue } });
    })).rejects.toThrow();
    expect(await db.storyFinalSubmission.count({ where: { reviewId: other.review.id } })).toBe(0);
  });

  (process.env.AUTHORED_SOURCE_MAP_PATH && process.env.AUTHORED_ANALYSIS_INPUT_PATH ? it : it.skip)(
    'reviews and publishes the actual 216-part receipt in isolated QA without paid generation', async () => {
      try {
        const f = await fixture(readActualAuthoredImportFixture());
        expect(f.proposal.approval).toBe('proposed');
        expect(f.proposal.snapshot.parts.length).toBe(216);
        expect(f.proposal.snapshot.parts.every(part => part.length !== null && part.sourceSceneKeys.length > 0)).toBe(true);
        const sourceHash = f.manuscript.contentHash;
        await f.confirm();
        await f.publish();
        const checked = await db.$transaction(tx => validAuthorFinalReviewProof(tx, {
          workId: f.work.id, releaseId: f.release.id, manuscriptVersionId: f.manuscript.id, scope: 'anchor',
        }));
        expect(checked.snapshot.parts.length).toBe(216);
        expect(checked.receipt.manuscriptContentHash).toBe(sourceHash);
        expect(await db.storyPart.count({ where: { workId: f.work.id, status: 'published' } })).toBe(216);
        expect(await db.storyAiContinuation.count({ where: { workId: f.work.id } })).toBe(0);
        expect(await db.storyReaderProgress.count({ where: { workId: f.work.id } })).toBe(0);
      } catch (error) {
        const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : 'probe_failed';
        throw new Error(`Private actual-source review probe failed (${code}); no source payload emitted`);
      }
    }, 120000);
});

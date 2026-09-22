import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { StoryAuthorFinalReviewService } from './story-author-final-review.service';
import { verifyAuthoredImportDraftTx } from './story-authored-import.service';
import { authorContentChecksum, authorReviewSnapshotHash, createAuthorFinalSubmissionTx, lockAuthorMaterializedRows } from './story-author-final-review.store';

jest.mock('./story-authored-import.service', () => ({ verifyAuthoredImportDraftTx: jest.fn() }));
jest.mock('./story-author-final-review.store', () => ({
  authorContentChecksum: jest.fn(), authorReviewSnapshotHash: jest.fn(), createAuthorFinalSubmissionTx: jest.fn(), lockAuthorMaterializedRows: jest.fn(),
}));

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('initial new author final review (service boundaries, not PostgreSQL constraints)', () => {
  beforeEach(() => jest.resetAllMocks());

  function fixture() {
    const ownerUserId = randomUUID();
    const work = { id: randomUUID(), ownerUserId };
    const manuscript = { id: randomUUID(), workId: work.id, ownerUserId, contentHash: hash('source') };
    const review = { id: randomUUID(), workId: work.id, ownerUserId, manuscriptVersionId: manuscript.id,
      analysisJobId: randomUUID(), state: 'final_confirmation', revision: 3, decisions: {}, finalSummary: {} };
    const release = { id: randomUUID(), checksum: hash('release') };
    const partId = randomUUID();
    const sceneId = randomUUID();
    const text = 'Synthetic authored narrative, not an actual manuscript.';
    const receipt = { id: randomUUID(), ownerUserId, locale: 'ko', sourceMapSha256: hash('source-map'),
      planChecksum: hash('plan'), materializedChecksum: hash('draft'), endingResolution: { endingKey: 'author_main' },
      provenance: { contract: 'story-authored-source-spans-v1', parts: [{ scenes: [{ sourceSceneKey: 'source-1',
        firstBeatPosition: 1, beatCount: 1, textBytes: Buffer.byteLength(text), textSha256: hash(text) }] }] } };
    const snapshot = { parts: [{ id: partId }], scenes: [{ id: sceneId, partId }], choices: [],
      beats: [{ id: randomUUID(), sceneId, position: 1, beatType: 'narration', sourceSceneKey: 'source-1', content: { ko: text } }] };
    jest.mocked(verifyAuthoredImportDraftTx).mockResolvedValue({ work, manuscript, release, receipt, snapshot } as never);
    jest.mocked(authorContentChecksum).mockResolvedValue(hash('content'));
    // Unit identity only. The separate PostgreSQL suite exercises the real JSONB digest.
    jest.mocked(authorReviewSnapshotHash).mockImplementation(async (_tx, value) => hash(JSON.stringify(value)));
    jest.mocked(createAuthorFinalSubmissionTx).mockImplementation(async (tx, input) => tx.storyFinalSubmission.create({ data: input }));
    const tx = {
      storyWriterReview: { findFirst: jest.fn().mockResolvedValue(review), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      storyWork: { findFirst: jest.fn().mockResolvedValue(work) },
      storyFinalSubmission: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockImplementation(async ({ data }) =>
        ({ id: randomUUID(), status: 'submitted', ...data })) },
      storyAuthorFinalReviewProof: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn(), create: jest.fn().mockResolvedValue({}) },
      storyAuthorFinalReviewRevocation: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      storyAnalysisJob: { findFirst: jest.fn().mockResolvedValue({ id: review.analysisJobId }) },
      storyContinuityIssue: { findMany: jest.fn().mockResolvedValue([]) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const db = { $transaction: jest.fn().mockImplementation(async run => run(tx)) };
    const service = new StoryAuthorFinalReviewService(db as never);
    const body = { releaseId: release.id, expectedRevision: review.revision, includeContinuationAnchor: true, minGeneratedSegments: 1 };
    const key = `story-final:${randomUUID()}`;
    const proposal = () => service.propose(ownerUserId, review.id, body);
    const confirmation = async () => {
      const proposed = await proposal();
      return { ...body, proposalHash: proposed.proposalHash, reviewedScopes: proposed.snapshot.reviewedScopes };
    };
    const savedReplay = async () => {
      const confirmedBody = await confirmation();
      const result = await service.confirm(ownerUserId, review.id, confirmedBody, key);
      const submission = await tx.storyFinalSubmission.create.mock.results[0].value;
      const proof = tx.storyAuthorFinalReviewProof.create.mock.calls[0][0].data;
      tx.storyFinalSubmission.findUnique.mockResolvedValue(submission);
      tx.storyAuthorFinalReviewProof.findUnique.mockResolvedValue(proof);
      review.state = 'submitted';
      review.revision++;
      return { confirmedBody, result, submission, proof };
    };
    return { ownerUserId, work, manuscript, review, release, receipt, tx, db, service, body, key, proposal, confirmation, savedReplay };
  }

  it('projects a bounded proposed profile without approving or submitting it', async () => {
    const f = fixture();
    const result = await f.proposal();
    expect(result).toMatchObject({ approval: 'proposed', snapshot: { reviewRevision: 3,
      anchorPolicy: { minGeneratedSegments: 1 }, parts: [{ length: { profileVersion: 'author-length-80-120-v1' } }] } });
    expect(JSON.stringify(result)).not.toContain('Synthetic authored narrative');
    expect(f.tx.storyFinalSubmission.create).not.toHaveBeenCalled();
    expect(f.tx.storyAuthorFinalReviewProof.create).not.toHaveBeenCalled();
  });

  it('creates a submission and exactly one common proof under one confirmation transaction', async () => {
    const f = fixture();
    const body = await f.confirmation();
    f.db.$transaction.mockClear();
    await expect(f.service.confirm(f.ownerUserId, f.review.id, body, f.key))
      .resolves.toMatchObject({ idempotentReplay: false, proofStatus: 'recorded' });
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable', maxWait: 2000, timeout: 30000,
    });
    expect(f.tx.storyFinalSubmission.create).toHaveBeenCalledTimes(1);
    expect(f.tx.storyAuthorFinalReviewProof.create).toHaveBeenCalledTimes(1);
    expect(f.tx.storyWriterReview.updateMany).toHaveBeenCalledWith({
      where: { id: f.review.id, ownerUserId: f.ownerUserId, revision: 3, state: 'final_confirmation' },
      data: expect.objectContaining({ state: 'submitted', revision: { increment: 1 } }),
    });
    expect(f.tx.storyFinalSubmission.create.mock.invocationCallOrder[0])
      .toBeLessThan(f.tx.storyAuthorFinalReviewProof.create.mock.invocationCallOrder[0]);
    expect(lockAuthorMaterializedRows).toHaveBeenCalledWith(f.tx, f.work.id);
  });

  it.each(['review', 'work'])('checks current %s ownership before global-key or review replay', async missing => {
    const f = fixture();
    if (missing === 'review') f.tx.storyWriterReview.findFirst.mockResolvedValue(null);
    else f.tx.storyWork.findFirst.mockResolvedValue(null);
    await expect(f.service.confirm(f.ownerUserId, f.review.id, { ...f.body, proposalHash: hash('x'),
      reviewedScopes: ['authored_publication', 'continuation_anchor'] }, f.key)).rejects.toMatchObject({ status: 404 });
    expect(f.tx.storyFinalSubmission.findUnique).not.toHaveBeenCalled();
    expect(f.tx.storyAuthorFinalReviewProof.findUnique).not.toHaveBeenCalled();
  });

  it('never upgrades an existing legacy submission, even with a new key', async () => {
    const f = fixture();
    f.tx.storyFinalSubmission.findUnique.mockImplementation(async ({ where }) => where.reviewId
      ? { id: randomUUID(), reviewId: f.review.id, manuscriptVersionId: f.manuscript.id } : null);
    await expect(f.service.confirm(f.ownerUserId, f.review.id, { ...f.body, proposalHash: hash('x'),
      reviewedScopes: ['authored_publication', 'continuation_anchor'] }, f.key))
      .rejects.toMatchObject({ response: { code: 'AUTHOR_LEGACY_SUBMISSION_PROOF_UNSUPPORTED' } });
    expect(f.tx.storyFinalSubmission.create).not.toHaveBeenCalled();
    expect(f.tx.storyAuthorFinalReviewProof.create).not.toHaveBeenCalled();
    expect(f.tx.storyWriterReview.updateMany).not.toHaveBeenCalled();
  });

  it('does not reopen a terminal review without a submission row', async () => {
    const f = fixture();
    f.review.state = 'submitted';
    await expect(f.proposal()).rejects.toMatchObject({ response: { code: 'AUTHOR_NEW_SUBMISSION_REQUIRED' } });
    expect(verifyAuthoredImportDraftTx).not.toHaveBeenCalled();
  });

  it('rejects a foreign global key before projecting its proof', async () => {
    const f = fixture();
    f.tx.storyFinalSubmission.findUnique.mockResolvedValue({ reviewId: randomUUID(), manuscriptVersionId: randomUUID() });
    await expect(f.service.confirm(f.ownerUserId, f.review.id, { ...f.body, proposalHash: hash('x'),
      reviewedScopes: ['authored_publication'] }, f.key))
      .rejects.toMatchObject({ response: { code: 'AUTHOR_FINAL_REVIEW_IDEMPOTENCY_CONFLICT' } });
    expect(f.tx.storyAuthorFinalReviewProof.findUnique).not.toHaveBeenCalled();
  });

  it('replays an identical confirmation historically without creating or approving again', async () => {
    const f = fixture();
    const saved = await f.savedReplay();
    await expect(f.service.confirm(f.ownerUserId, f.review.id, saved.confirmedBody, f.key))
      .resolves.toMatchObject({ proofId: saved.result.proofId, idempotentReplay: true });
    expect(f.tx.storyAuthorFinalReviewProof.create).toHaveBeenCalledTimes(1);
    expect(f.tx.storyWriterReview.updateMany).toHaveBeenCalledTimes(1);
  });

  it('reports a revoked replay as revoked rather than restoring authority', async () => {
    const f = fixture();
    const saved = await f.savedReplay();
    f.tx.storyAuthorFinalReviewRevocation.findUnique.mockResolvedValue({ proofId: saved.result.proofId });
    await expect(f.service.confirm(f.ownerUserId, f.review.id, saved.confirmedBody, f.key))
      .resolves.toMatchObject({ proofStatus: 'revoked', idempotentReplay: true });
    expect(f.tx.storyAuthorFinalReviewProof.create).toHaveBeenCalledTimes(1);
  });

  it.each(['hash', 'release', 'scope', 'ending', 'key'])('rejects changed %s on replay', async changed => {
    const f = fixture();
    const saved = await f.savedReplay();
    const body = { ...saved.confirmedBody };
    if (changed === 'hash') body.proposalHash = hash('changed');
    if (changed === 'release') body.releaseId = randomUUID();
    if (changed === 'scope') body.reviewedScopes = ['authored_publication'];
    if (changed === 'ending') body.minGeneratedSegments = 2;
    await expect(f.service.confirm(f.ownerUserId, f.review.id, body, changed === 'key' ? randomUUID() : f.key))
      .rejects.toMatchObject({ response: { code: 'AUTHOR_FINAL_REVIEW_IDEMPOTENCY_CONFLICT' } });
    expect(f.tx.storyAuthorFinalReviewProof.create).toHaveBeenCalledTimes(1);
  });

  it('rejects stale confirmed hashes before writing, regardless of client summary approval', async () => {
    const f = fixture();
    f.review.finalSummary = { approved: true };
    await expect(f.service.confirm(f.ownerUserId, f.review.id, { ...f.body, proposalHash: hash('stale'),
      reviewedScopes: ['authored_publication', 'continuation_anchor'] }, f.key))
      .rejects.toMatchObject({ response: { code: 'AUTHOR_FINAL_REVIEW_CONFIRMATION_STALE' } });
    expect(f.tx.storyFinalSubmission.create).not.toHaveBeenCalled();
  });

  it.each(['critical', 'warning'])('preserves the unacknowledged %s continuity gate', async severity => {
    const f = fixture();
    const body = await f.confirmation();
    f.tx.storyContinuityIssue.findMany.mockResolvedValue([{ severity }]);
    await expect(f.service.confirm(f.ownerUserId, f.review.id, body, f.key))
      .rejects.toMatchObject({ response: { code: 'AUTHOR_FINAL_REVIEW_CONTINUITY_BLOCKED' } });
    expect(f.tx.storyFinalSubmission.create).not.toHaveBeenCalled();
  });

  it('handles malformed replay scopes as a safe conflict rather than a payload-bearing exception', async () => {
    const f = fixture();
    const saved = await f.savedReplay();
    await expect(f.service.confirm(f.ownerUserId, f.review.id, { ...saved.confirmedBody, reviewedScopes: null as never }, f.key))
      .rejects.toMatchObject({ response: { code: 'AUTHOR_FINAL_REVIEW_CONFIRMATION_INVALID' } });
  });

  it('retries only bounded transaction conflicts', async () => {
    const f = fixture();
    const body = await f.confirmation();
    f.db.$transaction.mockClear();
    f.db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('PRIVATE_DATABASE_PAYLOAD',
      { code: 'P2034', clientVersion: 'qa' }));
    await expect(f.service.confirm(f.ownerUserId, f.review.id, body, f.key)).resolves.toMatchObject({ idempotentReplay: false });
    expect(f.db.$transaction).toHaveBeenCalledTimes(2);
    expect(f.tx.storyAuthorFinalReviewProof.create).toHaveBeenCalledTimes(1);
  });

  it('bounds repeated conflicts to three attempts without exposing the database message', async () => {
    const f = fixture();
    f.db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('PRIVATE_DATABASE_PAYLOAD',
      { code: 'P2034', clientVersion: 'qa' }));
    await expect(f.service.confirm(f.ownerUserId, f.review.id, { ...f.body, proposalHash: hash('x'), reviewedScopes: [] }, f.key))
      .rejects.toMatchObject({ response: { code: 'AUTHOR_FINAL_REVIEW_CONCURRENT_CHANGE',
        message: 'Author review binding is unavailable or changed' } });
    expect(f.db.$transaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry or claim rollback for an unknown database/commit failure', async () => {
    const f = fixture();
    f.db.$transaction.mockRejectedValue(new Error('PRIVATE_DATABASE_PAYLOAD'));
    await expect(f.proposal()).rejects.toMatchObject({ response: {
      code: 'AUTHOR_FINAL_REVIEW_PERSISTENCE_UNKNOWN', message: 'Author review persistence could not be confirmed',
    } });
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('appends owner revocation once and never changes the original proof', async () => {
    const f = fixture();
    const saved = await f.savedReplay();
    f.tx.storyAuthorFinalReviewProof.findFirst.mockResolvedValue(saved.proof);
    await expect(f.service.revoke(f.ownerUserId, saved.proof.id)).resolves.toMatchObject({ proofStatus: 'revoked', idempotentReplay: false });
    f.tx.storyAuthorFinalReviewRevocation.findUnique.mockResolvedValue({ proofId: saved.proof.id });
    await expect(f.service.revoke(f.ownerUserId, saved.proof.id)).resolves.toMatchObject({ proofStatus: 'revoked', idempotentReplay: true });
    expect(f.tx.storyAuthorFinalReviewRevocation.create).toHaveBeenCalledTimes(1);
    expect(f.tx.storyAuthorFinalReviewProof.create).toHaveBeenCalledTimes(1);
  });
});

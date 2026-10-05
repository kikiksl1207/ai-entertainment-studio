import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { brotliCompressSync } from 'zlib';
import {
  CREATOR_GENERATION_PROFILE_SCHEMA,
  STORY_PROFILE_SECTION_KEYS,
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
  stableJson,
  type CreatorGenerationProfileSettings,
} from '../generation-profile/creator-generation-profile.policy';
import { StoryCompanyFinalSubmissionService } from './story-company-final-submission.service';
import { readCompanyFinalSubmissionBinding } from './story-company-final-submission.policy';

const ids = {
  owner: '00000000-0000-4000-8000-000000000701',
  work: '00000000-0000-4000-8000-000000000702',
  manuscript: '00000000-0000-4000-8000-000000000703',
  analysis: '00000000-0000-4000-8000-000000000704',
  profile: '00000000-0000-4000-8000-000000000705',
  intake: '00000000-0000-4000-8000-000000000707',
  intakeAudit: '00000000-0000-4000-8000-000000000708',
  review: '00000000-0000-4000-8000-000000000709',
  submission: '00000000-0000-4000-8000-000000000710',
  receipt: '00000000-0000-4000-8000-000000000711',
  other: '00000000-0000-4000-8000-000000000799',
};
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const timestamp = new Date('2026-10-05T00:00:00.000Z');
const syntheticText = 'Synthetic private company QA source. No real person or manuscript.';

type Submission = {
  id: string; reviewId: string; manuscriptVersionId: string; idempotencyKey: string;
  checksum: string; status: string; createdAt: Date;
};
type Receipt = {
  id: string; actorUserId?: string | null; actorType: string; action: string;
  targetType: string; targetId: string; beforeData?: Record<string, unknown>;
  afterData?: Record<string, unknown>; metadata: Record<string, unknown>;
};

function fixture(withoutReview = false) {
  // Synthetic test-only content models a native intake; fixtureSource=true is ineligible product data.
  const contentHash = sha256(syntheticText);
  const sourceBindingSha256 = sha256('synthetic-private-company-intake-binding');
  const plan = {
    storyKey: 'monster', slug: 'synthetic-private-company-final-qa', sourceBindingSha256,
    writerIntakeWorkflow: 'writer_review_before_choices_v1',
    manuscript: { contentHash }, parts: [{}], prompts: [],
  };
  const work = {
    id: ids.work, ownerUserId: ids.owner, slug: plan.slug, authorDisplayName: '\uB8E8\uBBF8\uB098',
    fixtureSource: false, status: 'draft', activeReleaseId: null as string | null,
    publishedAt: null as Date | null, releaseRevision: 1,
    coverManifest: { privateIntake: { contract: 'publication-writer-intake-v1',
      jobId: ids.intake, sourceBindingSha256, manuscriptHash: contentHash } },
  };
  const manuscript = {
    id: ids.manuscript, workId: ids.work, ownerUserId: ids.owner, version: 1, locale: 'ko', contentHash,
    structuredBody: { parts: [{ paragraphs: [{ text: syntheticText }] }] }, createdAt: timestamp,
  };
  const analysis = {
    id: ids.analysis, workId: ids.work, manuscriptVersionId: ids.manuscript, actorUserId: ids.owner,
    analysisVersion: 1, pipeline: 'semantic_extraction_v1', status: 'completed', phase: 'completed',
    sourceContentHash: contentHash, sourceLocale: 'ko', configHash: sha256('synthetic-analysis-config'),
    totalParts: 1, totalParagraphs: 1, plannedChunks: 1, completedChunks: 1,
    plannedParagraphs: 1, completedParagraphs: 1, errorCode: null as string | null,
    completedAt: timestamp, createdAt: timestamp,
  };
  const settings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({ key, decision: 'accepted',
      value: { summary: `Synthetic QA ${key}` }, evidence: [] })),
  });
  const sourceFingerprint = sha256(stableJson({
    workId: ids.work, manuscriptVersionId: ids.manuscript, contentHash, analysisJobId: ids.analysis,
    analysisVersion: analysis.analysisVersion, analysisConfigHash: analysis.configHash,
  }));
  const approvedFingerprint = creatorGenerationProfileFingerprint(sourceFingerprint, settings);
  const profile = {
    id: ids.profile, workId: ids.work, ownerUserId: ids.owner, manuscriptVersionId: ids.manuscript,
    analysisJobId: ids.analysis, sourceFingerprint, profileVersion: 1, reviewRevision: 1, status: 'approved',
    draftSettings: settings, draftFingerprint: approvedFingerprint,
    approvedSettings: settings as CreatorGenerationProfileSettings | null,
    approvedFingerprint: approvedFingerprint as string | null, approvedByUserId: ids.owner as string | null,
    approvedAt: timestamp as Date | null, analysisErrorCode: null, createdAt: timestamp, updatedAt: timestamp,
  };
  const intake = {
    id: ids.intake, workId: ids.work, actorUserId: ids.owner, status: 'awaiting_author_review',
    releaseId: null as string | null, errorCode: null as string | null, storyKey: plan.storyKey,
    sourceBindingSha256, planSnapshot: plan as unknown,
  };
  const intakeAudit = {
    id: ids.intakeAudit, actorUserId: ids.owner, actorType: 'admin',
    action: 'story_publication.private_writer_intake', targetType: 'story_work', targetId: ids.work,
    metadata: { jobId: ids.intake, manuscriptVersionId: ids.manuscript, manuscriptHash: contentHash,
      sourceBindingSha256, partCount: 1, analysisStarted: false, choicesGenerated: false, published: false },
  };
  const review = {
    id: ids.review, workId: ids.work, ownerUserId: ids.owner, manuscriptVersionId: ids.manuscript,
    analysisJobId: ids.analysis, state: 'analysis_ready', revision: 1,
    decisions: {} as unknown, finalSummary: {} as unknown, submittedAt: null as Date | null,
    createdAt: timestamp, updatedAt: timestamp,
  };
  const persisted = { submission: null as Submission | null, receipts: [] as Receipt[] };
  const reviewPresence = { exists: !withoutReview };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: ids.work }]),
    storyWork: { findFirst: jest.fn().mockResolvedValue(work), updateMany: jest.fn() },
    storyWriterReview: {
      findFirst: jest.fn().mockImplementation(async () => reviewPresence.exists ? { ...review } : null),
      create: jest.fn().mockImplementation(async ({ data }) => {
        Object.assign(review, data); reviewPresence.exists = true; return { ...review };
      }),
      findMany: jest.fn().mockResolvedValue([]),
      findUniqueOrThrow: jest.fn().mockImplementation(async () => ({ ...review })),
      updateMany: jest.fn().mockImplementation(async ({ data }) => {
        Object.assign(review, { ...data, revision: review.revision + (data.revision?.increment ?? 0) });
        return { count: 1 };
      }), update: jest.fn(),
    },
    storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue(manuscript) },
    storyAnalysisJob: { findFirst: jest.fn().mockResolvedValue(analysis), updateMany: jest.fn() },
    storyWorkGenerationProfile: { findFirst: jest.fn().mockResolvedValue(profile), updateMany: jest.fn() },
    storyStyleProfileConsent: {
      findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(), upsert: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
      delete: jest.fn(), deleteMany: jest.fn(),
    },
    storyPublicationImportJob: { findFirst: jest.fn().mockResolvedValue(intake), updateMany: jest.fn() },
    storyAuthoredImport: { findUnique: jest.fn().mockResolvedValue(null) },
    storyContinuityIssue: { findMany: jest.fn().mockResolvedValue([]) },
    storyFinalSubmission: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        const saved = persisted.submission;
        return saved && (where.reviewId === saved.reviewId || where.idempotencyKey === saved.idempotencyKey)
          ? saved : null;
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        persisted.submission = { id: ids.submission, status: 'submitted', createdAt: timestamp, ...data };
        return persisted.submission;
      }),
    },
    auditEvent: {
      findFirst: jest.fn().mockImplementation(async ({ where }) => {
        if (where.action === intakeAudit.action) return intakeAudit;
        return persisted.receipts.find(row => row.action === where.action) ?? null;
      }),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const receipt: Receipt = { id: ids.receipt, ...data };
        persisted.receipts.push(receipt);
        return receipt;
      }),
    },
    storyRelease: { create: jest.fn(), updateMany: jest.fn() },
    storyContinuation: { create: jest.fn(), updateMany: jest.fn() },
    storyChoice: { create: jest.fn(), createMany: jest.fn() },
    storyUsageEvent: { create: jest.fn() },
  };
  const db = {
    ...tx,
    storyWriterReview: { findFirst: jest.fn().mockImplementation(async () => reviewPresence.exists ? { ...review } : null) },
    $transaction: jest.fn().mockImplementation(async (run: (client: typeof tx) => Promise<unknown>) => {
      const before = { ...review };
      const existedBefore = reviewPresence.exists;
      const submissionBefore = persisted.submission;
      const receiptsBefore = persisted.receipts.slice();
      try {
        return await run(tx);
      } catch (error) {
        // Simulate atomic transaction state only; real rollback and locking need PostgreSQL verification.
        Object.assign(review, before);
        reviewPresence.exists = existedBefore;
        persisted.submission = submissionBefore;
        persisted.receipts = receiptsBefore;
        throw error;
      }
    }),
  };
  const service = new StoryCompanyFinalSubmissionService(db as never);
  const submit = (expectedRevision = 1, ownerUserId = ids.owner) =>
    service.autoSubmitReview(ownerUserId, ids.review, expectedRevision);
  return { work, manuscript, analysis, profile, intake, intakeAudit, plan,
    review, reviewPresence, persisted, tx, db, service, submit };
}

type Fixture = ReturnType<typeof fixture>;

function expectNoSubmissionWrites(f: Fixture) {
  expect(f.tx.storyFinalSubmission.create).not.toHaveBeenCalled();
  expect(f.tx.storyWriterReview.updateMany).not.toHaveBeenCalled();
  expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
}

function expectNoUnrelatedWrites(f: Fixture) {
  for (const write of [f.tx.storyWork.updateMany, f.tx.storyAnalysisJob.updateMany,
    f.tx.storyWorkGenerationProfile.updateMany, f.tx.storyStyleProfileConsent.create,
    f.tx.storyStyleProfileConsent.upsert, f.tx.storyStyleProfileConsent.update,
    f.tx.storyStyleProfileConsent.updateMany, f.tx.storyStyleProfileConsent.delete, f.tx.storyStyleProfileConsent.deleteMany,
    f.tx.storyPublicationImportJob.updateMany, f.tx.storyRelease.create, f.tx.storyRelease.updateMany,
    f.tx.storyContinuation.create, f.tx.storyContinuation.updateMany, f.tx.storyChoice.create,
    f.tx.storyChoice.createMany, f.tx.storyUsageEvent.create, f.tx.storyWriterReview.update]) {
    expect(write).not.toHaveBeenCalled();
  }
}

function expectedReceiptBinding(f: Fixture) {
  return {
    contract: 'story-company-final-submission-v1', scope: 'manuscript_submission',
    ownerUserId: ids.owner, workId: ids.work, reviewId: ids.review, manuscriptVersionId: ids.manuscript,
    manuscriptHash: f.manuscript.contentHash, manuscriptLocale: 'ko',
    source: { companyPrivateIntakeJobId: ids.intake, companyPrivateIntakeAuditId: ids.intakeAudit,
      companySourceBindingSha256: f.intake.sourceBindingSha256, companyManuscriptVersionId: ids.manuscript },
    analysisPin: { id: ids.analysis, version: 1, configHash: f.analysis.configHash, totalParagraphs: 1 },
    profilePin: { id: ids.profile, profileVersion: 1, reviewRevision: 1,
      sourceFingerprint: f.profile.sourceFingerprint, approvedFingerprint: f.profile.approvedFingerprint,
      approvedAt: timestamp.toISOString(), approvedByUserId: ids.owner },
    beforeReviewRevision: 1, submittedReviewRevision: 2,
  };
}

function clearSubmissionWrites(f: Fixture) {
  f.tx.storyFinalSubmission.create.mockClear();
  f.tx.storyWriterReview.updateMany.mockClear();
  f.tx.auditEvent.create.mockClear();
}

describe('native private company final submission (synthetic unit fixture, not PostgreSQL)', () => {
  it('submits once with company delegation and an atomic review revision change', async () => {
    const f = fixture();
    const result = await f.submit();
    expect(result).toMatchObject({ approvalBasis: 'company_delegation', idempotentReplay: false,
      review: { id: ids.review, state: 'submitted', revision: 2 },
      submission: { reviewId: ids.review, manuscriptVersionId: ids.manuscript, checksum: f.manuscript.contentHash } });
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable', maxWait: 5000, timeout: 30000,
    });
    expect(f.tx.storyFinalSubmission.create).toHaveBeenCalledTimes(1);
    expect(f.tx.storyFinalSubmission.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      reviewId: ids.review, manuscriptVersionId: ids.manuscript, checksum: f.manuscript.contentHash,
      idempotencyKey: expect.stringMatching(/^story-company-final-v1:/),
    }) });
    expect(f.tx.storyWriterReview.updateMany).toHaveBeenCalledTimes(1);
    expect(f.tx.storyWriterReview.updateMany).toHaveBeenCalledWith({
      where: { id: ids.review, ownerUserId: ids.owner, workId: ids.work,
        manuscriptVersionId: ids.manuscript, analysisJobId: ids.analysis, revision: 1,
        state: 'analysis_ready', submittedAt: null, decisions: { equals: {} }, finalSummary: { equals: {} } },
      data: expect.objectContaining({ state: 'submitted', revision: { increment: 1 }, submittedAt: expect.any(Date) }),
    });
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorType: 'system' }) });
    expect(f.review.decisions).toEqual({});
    expect(f.review.finalSummary).toEqual({});
    expect(JSON.stringify(f.persisted.receipts)).not.toContain(syntheticText);
    expectNoUnrelatedWrites(f);
  });

  it('records the exact native binding and before/after revisions without claiming human or publication approval', async () => {
    const f = fixture();
    const result = await f.submit();
    const binding = expectedReceiptBinding(f);
    const bindingHash = sha256(stableJson(binding));
    expect(result).toMatchObject({ bindingHash, approvalBasis: 'company_delegation', idempotentReplay: false });
    expect(f.persisted.submission?.idempotencyKey).toBe(`story-company-final-v1:${bindingHash}`);
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({ data: {
      actorUserId: ids.owner, actorType: 'system', action: 'story.final_submission.company_delegated',
      targetType: 'story_final_submission', targetId: ids.submission,
      beforeData: { state: 'analysis_ready', revision: 1 }, afterData: { state: 'submitted', revision: 2 },
      metadata: { contract: 'story-company-final-submission-v1', approvalBasis: 'company_delegation',
        scope: 'manuscript_submission', binding, bindingHash,
        humanSemanticReview: false, publication: false, sharedReuse: false },
    } });
  });

  it('submits a new native manuscript without AI consent and does not create or claim consent', async () => {
    const f = fixture();
    expect(await f.submit()).toMatchObject({ approvalBasis: 'company_delegation', idempotentReplay: false });
    expect(f.tx.storyStyleProfileConsent.findFirst).not.toHaveBeenCalled();
    expect(f.tx.storyStyleProfileConsent.findUnique).not.toHaveBeenCalled();
    expect(f.persisted.receipts[0].metadata).toMatchObject({ scope: 'manuscript_submission',
      humanSemanticReview: false, publication: false, sharedReuse: false });
    expect(f.persisted.receipts[0].metadata.binding).not.toHaveProperty('consentPin');
    expect(f.review.decisions).toEqual({});
    expectNoUnrelatedWrites(f);
  });

  it('does not couple manuscript receipt replay to subsequently saved AI rights', async () => {
    const f = fixture();
    const first = await f.submit();
    f.tx.storyStyleProfileConsent.findUnique.mockResolvedValue({ workId: ids.work,
      manuscriptVersionId: ids.manuscript, revision: 1, status: 'active', rightsConfirmed: true, aiBranchAllowed: true });
    expect(await f.submit(2)).toMatchObject({ bindingHash: first!.bindingHash, idempotentReplay: true });
    expect(f.tx.storyStyleProfileConsent.findUnique).not.toHaveBeenCalled();
    expectNoUnrelatedWrites(f);
  });

  it('supports a trusted compressed native intake without using authored-import authority', async () => {
    const f = fixture();
    f.intake.planSnapshot = { storageContract: 'story-publication-plan-br-base64-v1',
      data: brotliCompressSync(Buffer.from(JSON.stringify(f.plan))).toString('base64') };
    expect(await f.submit()).toMatchObject({ approvalBasis: 'company_delegation', idempotentReplay: false });
    expectNoUnrelatedWrites(f);
  });

  it('locks the work and review before any submission write', async () => {
    const f = fixture();
    await f.submit();
    const queries = f.tx.$queryRaw.mock.calls.map(([query], index) => ({
      sql: String(query.sql), order: f.tx.$queryRaw.mock.invocationCallOrder[index], values: query.values,
    }));
    const workLock = queries.find(query => /story_works/.test(query.sql) && /FOR UPDATE/i.test(query.sql));
    const reviewLock = queries.find(query => /story_writer_reviews/.test(query.sql) && /FOR UPDATE/i.test(query.sql));
    expect(workLock).toBeDefined();
    expect(reviewLock).toBeDefined();
    expect(workLock!.values).toContain(ids.work);
    expect(reviewLock!.values).toContain(ids.review);
    expect(workLock!.order).toBeLessThan(reviewLock!.order);
    expect(reviewLock!.order).toBeLessThan(f.tx.storyFinalSubmission.create.mock.invocationCallOrder[0]);
  });

  const ineligible: Array<[string, (f: Fixture) => void]> = [
    ['missing review', f => { f.tx.storyWriterReview.findFirst.mockResolvedValue(null); }],
    ['missing work', f => { f.tx.storyWork.findFirst.mockResolvedValue(null); }],
    ['foreign review owner', f => { f.review.ownerUserId = ids.other; }],
    ['foreign work owner', f => { f.work.ownerUserId = ids.other; }],
    ['ordinary studio display credit only', f => { f.tx.storyPublicationImportJob.findFirst.mockResolvedValue(null); }],
    ['external author', f => { f.work.authorDisplayName = 'Synthetic external author'; }],
    ['product fixture source', f => { f.work.fixtureSource = true; }],
    ['published work', f => { f.work.status = 'published'; }],
    ['active release', f => { f.work.activeReleaseId = ids.other; }],
    ['prior publication', f => { f.work.publishedAt = timestamp; }],
    ['authored import', f => { f.tx.storyAuthoredImport.findUnique.mockResolvedValue({ id: ids.other }); }],
    ['manually transitioned review', f => { f.review.state = 'final_confirmation'; }],
    ['manual decisions', f => { f.review.decisions = { accepted: true }; }],
    ['fake warning acknowledgement', f => { f.review.decisions = { warningAcknowledged: true }; }],
    ['manual final summary', f => { f.review.finalSummary = { approved: true }; }],
    ['null decisions', f => { f.review.decisions = null; }],
    ['array decisions', f => { f.review.decisions = []; }],
    ['string decisions', f => { f.review.decisions = '{}'; }],
    ['null final summary', f => { f.review.finalSummary = null; }],
    ['array final summary', f => { f.review.finalSummary = []; }],
    ['string final summary', f => { f.review.finalSummary = '{}'; }],
    ['prior submission timestamp', f => { f.review.submittedAt = timestamp; }],
    ['new manuscript id with identical hash', f => { f.manuscript.id = ids.other; }],
    ['changed latest manuscript hash', f => { f.manuscript.contentHash = sha256('changed synthetic source'); }],
    ['wrong analysis id', f => { f.analysis.id = ids.other; }],
    ['wrong analysis manuscript', f => { f.analysis.manuscriptVersionId = ids.other; }],
    ['wrong analysis work', f => { f.analysis.workId = ids.other; }],
    ['legacy structural analysis', f => { f.analysis.pipeline = 'structural_legacy'; }],
    ['incomplete analysis', f => { f.analysis.status = 'running'; }],
    ['incomplete planned chunks', f => { f.analysis.completedChunks = 0; }],
    ['incomplete planned paragraphs', f => { f.analysis.completedParagraphs = 0; }],
    ['empty analysis plan', f => { f.analysis.plannedChunks = 0; f.analysis.completedChunks = 0; }],
    ['stale analysis hash', f => { f.analysis.sourceContentHash = sha256('old synthetic source'); }],
    ['wrong analysis locale', f => { f.analysis.sourceLocale = 'en'; }],
    ['unsupported manuscript locale', f => { f.manuscript.locale = 'en'; }],
    ['missing approved profile', f => { f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(null); }],
    ['unapproved latest profile', f => { f.profile.status = 'needs_review'; }],
    ['wrong profile manuscript', f => { f.profile.manuscriptVersionId = ids.other; }],
    ['wrong profile analysis', f => { f.profile.analysisJobId = ids.other; }],
    ['wrong profile work', f => { f.profile.workId = ids.other; }],
    ['foreign profile owner', f => { f.profile.ownerUserId = ids.other; }],
    ['foreign profile approver', f => { f.profile.approvedByUserId = ids.other; }],
    ['missing profile approver', f => { f.profile.approvedByUserId = null; }],
    ['missing profile approval time', f => { f.profile.approvedAt = null; }],
    ['missing approved settings', f => { f.profile.approvedSettings = null; }],
    ['stale profile source fingerprint', f => { f.profile.sourceFingerprint = sha256('old profile source'); }],
    ['corrupt approved profile fingerprint', f => { f.profile.approvedFingerprint = sha256('bad profile'); }],
    ['missing native audit', f => { f.tx.auditEvent.findFirst.mockResolvedValue(null); }],
    ['non-admin native audit', f => { f.intakeAudit.actorType = 'user'; }],
    ['wrong native audit owner', f => { f.intakeAudit.actorUserId = ids.other; }],
    ['wrong native audit manuscript', f => { f.intakeAudit.metadata.manuscriptVersionId = ids.other; }],
    ['wrong native job owner', f => { f.intake.actorUserId = ids.other; }],
    ['wrong native source binding', f => { f.intake.sourceBindingSha256 = sha256('other intake'); }],
    ['wrong native plan workflow', f => { f.plan.writerIntakeWorkflow = 'authored-import'; }],
    ['malformed compressed native plan', f => { f.intake.planSnapshot = {
      storageContract: 'story-publication-plan-br-base64-v1', data: 'invalid',
    }; }],
  ];
  it.each(ineligible)('leaves %s unchanged', async (_name, change) => {
    const f = fixture();
    change(f);
    expect(await f.submit()).toBeNull();
    expectNoSubmissionWrites(f);
    expectNoUnrelatedWrites(f);
  });

  it.each([0, 2, -1, 1.5, Number.NaN])('conflicts on expected revision %s without submission writes', async revision => {
    const f = fixture();
    const attempt = f.submit(revision);
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toMatchObject({ response: { code: 'COMPANY_FINAL_REVIEW_CHANGED' } });
    expectNoSubmissionWrites(f);
  });

  it('does not delegate a manually revised review even when its current revision is supplied', async () => {
    const f = fixture();
    f.review.revision = 2;
    expect(await f.submit(2)).toBeNull();
    expectNoSubmissionWrites(f);
  });

  it('returns null for an unowned initial lookup without opening a transaction', async () => {
    const f = fixture();
    f.db.storyWriterReview.findFirst.mockResolvedValue(null);
    expect(await f.submit(1, ids.other)).toBeNull();
    expect(f.db.storyWriterReview.findFirst).toHaveBeenCalledWith({
      where: { id: ids.review, ownerUserId: ids.other },
    });
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expectNoSubmissionWrites(f);
  });

  it('rechecks the review work binding after acquiring locks', async () => {
    const f = fixture();
    f.tx.storyWriterReview.findFirst.mockResolvedValue({ ...f.review, workId: ids.other });
    expect(await f.submit()).toBeNull();
    expect(f.tx.storyWork.findFirst).not.toHaveBeenCalled();
    expectNoSubmissionWrites(f);
  });

  it.each(['state', 'revision', 'decisions', 'summary', 'timestamp'])('blocks touched %s in another same-manuscript review', async changed => {
    const f = fixture();
    const historical = { ...f.review, id: ids.other };
    if (changed === 'state') historical.state = 'editing';
    if (changed === 'revision') historical.revision = 2;
    if (changed === 'decisions') historical.decisions = { accepted: true };
    if (changed === 'summary') historical.finalSummary = { approved: true };
    if (changed === 'timestamp') historical.submittedAt = timestamp;
    f.tx.storyWriterReview.findMany.mockResolvedValue([historical]);
    expect(await f.submit()).toBeNull();
    expect(f.tx.storyWriterReview.findMany).toHaveBeenCalledWith({ where: {
      workId: ids.work, manuscriptVersionId: ids.manuscript, id: { not: ids.review },
    }, take: 1001 });
    expectNoSubmissionWrites(f);
  });

  it('fails closed when same-manuscript history exceeds the bounded first slice', async () => {
    const f = fixture();
    f.tx.storyWriterReview.findMany.mockResolvedValue(Array.from({ length: 1001 }, () => ({ ...f.review, id: ids.other })));
    expect(await f.submit()).toBeNull();
    expectNoSubmissionWrites(f);
  });

  it('allows an untouched prior analysis review without changing it', async () => {
    const f = fixture();
    const historical = { ...f.review, id: ids.other, analysisJobId: ids.other };
    f.tx.storyWriterReview.findMany.mockResolvedValue([historical]);
    expect(await f.submit()).toMatchObject({ idempotentReplay: false });
    expect(historical).toMatchObject({ state: 'analysis_ready', revision: 1, decisions: {}, finalSummary: {}, submittedAt: null });
  });

  it.each(['critical', 'warning', 'unknown', ''])('blocks open %s without inventing a person acknowledgement', async severity => {
    const f = fixture();
    f.tx.storyContinuityIssue.findMany.mockResolvedValue([{ severity, status: 'open' }]);
    expect(await f.submit()).toBeNull();
    expectNoSubmissionWrites(f);
    expect(f.review.decisions).toEqual({});
  });

  it('permits an open info issue but keeps the query scoped to the current original manuscript analysis', async () => {
    const f = fixture();
    f.tx.storyContinuityIssue.findMany.mockResolvedValue([{ severity: 'info' }]);
    expect(await f.submit()).toMatchObject({ idempotentReplay: false });
    expect(f.tx.storyContinuityIssue.findMany).toHaveBeenCalledWith({ where: {
      workId: ids.work, analysisJobId: ids.analysis, status: 'open',
      pathScope: 'author_original', pathKey: 'author_original',
    }, select: { severity: true }, take: 1001 });
  });

  it('fails closed when open issue evidence exceeds the bounded first slice', async () => {
    const f = fixture();
    f.tx.storyContinuityIssue.findMany.mockResolvedValue(Array.from({ length: 1001 }, () => ({ severity: 'info' })));
    expect(await f.submit()).toBeNull();
    expectNoSubmissionWrites(f);
  });

  it('never reclassifies an existing manual submission as company delegation', async () => {
    const f = fixture();
    f.persisted.submission = { id: ids.submission, reviewId: ids.review,
      manuscriptVersionId: ids.manuscript, idempotencyKey: 'synthetic-manual-final-key',
      checksum: f.manuscript.contentHash, status: 'submitted', createdAt: timestamp };
    f.review.state = 'submitted';
    f.review.revision = 4;
    f.review.submittedAt = timestamp;
    expect(await f.submit(4)).toBeNull();
    expectNoSubmissionWrites(f);
    expect(f.persisted.submission.idempotencyKey).toBe('synthetic-manual-final-key');
  });

  it('replays the same current company submission without duplicate writes', async () => {
    const f = fixture();
    const first = await f.submit();
    expect(first).not.toBeNull();
    expect(await f.submit(2)).toMatchObject({ approvalBasis: 'company_delegation',
      bindingHash: first!.bindingHash, idempotentReplay: true,
      submission: { id: ids.submission }, review: { id: ids.review, state: 'submitted', revision: 2 } });
    expect(f.tx.storyFinalSubmission.create).toHaveBeenCalledTimes(1);
    expect(f.tx.storyWriterReview.updateMany).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('does not reclassify a manual submission even when the review happens to match the company terminal shape', async () => {
    const f = fixture();
    f.persisted.submission = { id: ids.submission, reviewId: ids.review,
      manuscriptVersionId: ids.manuscript, idempotencyKey: 'story-final-submit:synthetic-manual-hash',
      checksum: f.manuscript.contentHash, status: 'submitted', createdAt: timestamp };
    f.review.state = 'submitted';
    f.review.revision = 2;
    f.review.submittedAt = timestamp;
    expect(await f.submit(2)).toBeNull();
    expect(f.tx.auditEvent.findFirst).not.toHaveBeenCalled();
    expectNoSubmissionWrites(f);
  });

  it('returns null rather than rewriting a company submission for a newer manuscript with the same hash', async () => {
    const f = fixture();
    await f.submit();
    f.manuscript.id = ids.other;
    clearSubmissionWrites(f);
    expect(await f.submit(2)).toBeNull();
    expectNoSubmissionWrites(f);
  });

  it('rejects a reserved-key submission without a company audit receipt', async () => {
    const f = fixture();
    await f.submit();
    f.persisted.receipts = [];
    clearSubmissionWrites(f);
    await expect(f.submit(2)).rejects.toMatchObject({ response: { code: 'COMPANY_FINAL_SUBMISSION_CHANGED' } });
    expectNoSubmissionWrites(f);
  });

  const invalidReplay: Array<[string, (f: Fixture) => void]> = [
    ['wrong receipt actor', f => { f.persisted.receipts[0].actorType = 'user'; }],
    ['wrong receipt owner', f => { f.persisted.receipts[0].actorUserId = ids.other; }],
    ['wrong receipt target', f => { f.persisted.receipts[0].targetId = ids.other; }],
    ['wrong receipt target type', f => { f.persisted.receipts[0].targetType = 'story_work'; }],
    ['wrong receipt contract', f => { f.persisted.receipts[0].metadata.contract = 'other'; }],
    ['wrong receipt scope', f => { f.persisted.receipts[0].metadata.scope = 'publication'; }],
    ['wrong approval basis', f => { f.persisted.receipts[0].metadata.approvalBasis = 'human'; }],
    ['claimed human review', f => { f.persisted.receipts[0].metadata.humanSemanticReview = true; }],
    ['claimed publication', f => { f.persisted.receipts[0].metadata.publication = true; }],
    ['claimed shared reuse', f => { f.persisted.receipts[0].metadata.sharedReuse = true; }],
    ['corrupt binding hash', f => { f.persisted.receipts[0].metadata.bindingHash = sha256('wrong binding'); }],
    ['wrong before revision binding', f => {
      const binding = f.persisted.receipts[0].metadata.binding as Record<string, unknown>;
      f.persisted.receipts[0].metadata.binding = { ...binding, beforeReviewRevision: 0 };
    }],
    ['wrong after revision binding', f => {
      const binding = f.persisted.receipts[0].metadata.binding as Record<string, unknown>;
      f.persisted.receipts[0].metadata.binding = { ...binding, submittedReviewRevision: 3 };
    }],
    ['extra receipt authority field', f => { f.persisted.receipts[0].metadata.warningAcknowledged = true; }],
    ['wrong submission checksum', f => { f.persisted.submission!.checksum = sha256('other source'); }],
    ['foreign submission review', f => { f.persisted.submission!.reviewId = ids.other;
      f.tx.storyFinalSubmission.findUnique.mockResolvedValue(f.persisted.submission); }],
    ['wrong submission manuscript', f => { f.persisted.submission!.manuscriptVersionId = ids.other; }],
    ['wrong submission status', f => { f.persisted.submission!.status = 'withdrawn'; }],
    ['wrong reserved key', f => { f.persisted.submission!.idempotencyKey = `story-company-final-v1:${sha256('wrong key')}`; }],
    ['manual review decisions', f => { f.review.decisions = { warningAcknowledged: true }; }],
    ['manual review summary', f => { f.review.finalSummary = { approved: true }; }],
    ['changed submitted review state', f => { f.review.state = 'final_confirmation'; }],
    ['changed manuscript checksum', f => { f.manuscript.contentHash = sha256('changed current manuscript'); }],
    ['changed profile revision', f => { f.profile.reviewRevision++; }],
    ['newer incomplete semantic analysis', f => { f.analysis.id = ids.other; f.analysis.status = 'running'; }],
    ['current warning', f => { f.tx.storyContinuityIssue.findMany.mockResolvedValue([{ severity: 'warning' }]); }],
    ['revoked native admin evidence', f => { f.intakeAudit.actorType = 'user'; }],
  ];
  it.each(invalidReplay)('rejects replay with %s without restoring or rewriting authority', async (_name, change) => {
    const f = fixture();
    expect(await f.submit()).not.toBeNull();
    change(f);
    clearSubmissionWrites(f);
    await expect(f.submit(2)).rejects.toMatchObject({ response: { code: 'COMPANY_FINAL_SUBMISSION_CHANGED' } });
    expectNoSubmissionWrites(f);
    expectNoUnrelatedWrites(f);
  });

  it('conflicts on stale pre-submission revision instead of treating replay as a revision bypass', async () => {
    const f = fixture();
    await f.submit();
    clearSubmissionWrites(f);
    await expect(f.submit(1)).rejects.toMatchObject({ response: { code: 'COMPANY_FINAL_REVIEW_CHANGED' } });
    expectNoSubmissionWrites(f);
  });

  it('rolls back the fixture transaction if the final untouched-review CAS loses', async () => {
    const f = fixture();
    const before = { ...f.review };
    f.tx.storyWriterReview.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(f.submit()).rejects.toMatchObject({ response: { code: 'COMPANY_FINAL_REVIEW_CHANGED' } });
    expect(f.tx.storyFinalSubmission.create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(f.persisted.submission).toBeNull();
    expect(f.review).toEqual(before);
  });

  it.each(['submission', 'review', 'audit'])('does not return success on a %s write failure', async failingWrite => {
    const f = fixture();
    const before = { ...f.review };
    const error = new Error('synthetic transaction write failure');
    if (failingWrite === 'submission') f.tx.storyFinalSubmission.create.mockRejectedValueOnce(error);
    if (failingWrite === 'review') f.tx.storyWriterReview.updateMany.mockRejectedValueOnce(error);
    if (failingWrite === 'audit') f.tx.auditEvent.create.mockRejectedValueOnce(error);
    await expect(f.submit()).rejects.toBeDefined();
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    expect(f.persisted.submission).toBeNull();
    expect(f.persisted.receipts).toEqual([]);
    expect(f.review).toEqual(before);
    expectNoUnrelatedWrites(f);
  });

  it('propagates an unconfirmed transaction failure without returning a receipt or retrying generation', async () => {
    const f = fixture();
    f.db.$transaction.mockRejectedValueOnce(new Error('synthetic commit outcome unknown'));
    await expect(f.submit()).rejects.toBeDefined();
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    expectNoSubmissionWrites(f);
    expectNoUnrelatedWrites(f);
  });
});

describe('read-only current company final submission reconciliation', () => {
  it('returns the current bound receipt without opening another transaction or writing', async () => {
    const f = fixture(); const saved = await f.submit();
    clearSubmissionWrites(f); f.db.$transaction.mockClear();
    const view = await f.service.currentSubmittedReview(ids.owner, ids.review);
    expect(view).toMatchObject({ approvalBasis: 'company_delegation', idempotentReplay: true, bindingHash: saved!.bindingHash });
    expect(f.db.$transaction).not.toHaveBeenCalled(); expectNoSubmissionWrites(f); expectNoUnrelatedWrites(f);
  });
  it('never creates a submission when the review remains pending', async () => {
    const f = fixture(); expect(await f.service.currentSubmittedReview(ids.owner, ids.review)).toBeNull();
    expect(f.db.$transaction).not.toHaveBeenCalled(); expectNoSubmissionWrites(f);
  });
  it('does not turn a legacy manual submission into company authority', async () => {
    const f = fixture(); await f.submit(); f.persisted.submission!.idempotencyKey = 'manual-submission';
    clearSubmissionWrites(f); expect(await f.service.currentSubmittedReview(ids.owner, ids.review)).toBeNull();
    expectNoSubmissionWrites(f);
  });
});

describe('company final submission after completed analysis (synthetic delegates)', () => {
  const complete = (f: Fixture) => f.service.autoSubmitCompletedAnalysis(ids.owner, ids.work, ids.manuscript, ids.analysis);
  const expectNoAutomaticWrites = (f: Fixture) => {
    expect(f.tx.storyWriterReview.create).not.toHaveBeenCalled();
    expectNoSubmissionWrites(f); expectNoUnrelatedWrites(f);
  };

  it('creates and submits a missing review atomically without person checks or generation', async () => {
    const f = fixture(true);
    const result = await complete(f);
    expect(result).toMatchObject({ approvalBasis: 'company_delegation', idempotentReplay: false,
      review: { state: 'submitted', revision: 2, decisions: {}, finalSummary: {} },
      submission: { manuscriptVersionId: ids.manuscript, checksum: f.manuscript.contentHash } });
    expect(f.tx.storyWriterReview.create).toHaveBeenCalledTimes(1);
    expect(f.tx.storyWriterReview.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      workId: ids.work, ownerUserId: ids.owner, manuscriptVersionId: ids.manuscript,
      analysisJobId: ids.analysis, state: 'analysis_ready' }) });
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    expect(f.persisted.receipts).toHaveLength(1);
    expect(f.persisted.receipts[0].metadata).toMatchObject({ scope: 'manuscript_submission',
      humanSemanticReview: false, publication: false, sharedReuse: false });
    expectNoUnrelatedWrites(f);
  });

  it('reuses the current pristine or delegated review without another review or receipt', async () => {
    const f = fixture();
    const first = await complete(f);
    expect(first?.review.id).toBe(ids.review);
    const saved = f.persisted.submission; clearSubmissionWrites(f);
    expect(await complete(f)).toMatchObject({ idempotentReplay: true, submission: saved });
    expect(f.tx.storyWriterReview.create).not.toHaveBeenCalled();
    expectNoSubmissionWrites(f); expectNoUnrelatedWrites(f);
  });

  it.each(['owner', 'work', 'manuscript', 'analysis'])('rejects malformed %s before transactions', async field => {
    const f = fixture(true);
    const args = [ids.owner, ids.work, ids.manuscript, ids.analysis];
    args[['owner', 'work', 'manuscript', 'analysis'].indexOf(field)] = 'malformed';
    expect(await f.service.autoSubmitCompletedAnalysis(args[0], args[1], args[2], args[3])).toBeNull();
    expect(f.db.$transaction).not.toHaveBeenCalled(); expectNoAutomaticWrites(f);
  });

  it.each(['external', 'fixture', 'not draft', 'missing native source', 'wrong manuscript',
    'wrong analysis', 'profile unapproved', 'profile changed', 'incomplete analysis', 'warning',
    'critical', 'manual history', 'revoked history', 'too much history'])('does not create a review for %s', async condition => {
    const f = fixture(true);
    if (condition === 'external') f.work.authorDisplayName = 'External author';
    if (condition === 'fixture') f.work.fixtureSource = true;
    if (condition === 'not draft') f.work.status = 'published';
    if (condition === 'missing native source') f.intake.planSnapshot = null;
    if (condition === 'wrong manuscript') f.manuscript.id = ids.other;
    if (condition === 'wrong analysis') f.analysis.id = ids.other;
    if (condition === 'profile unapproved') f.profile.status = 'needs_review';
    if (condition === 'profile changed') f.profile.approvedFingerprint = sha256('changed');
    if (condition === 'incomplete analysis') f.analysis.completedChunks = 0;
    if (condition === 'warning' || condition === 'critical') f.tx.storyContinuityIssue.findMany.mockResolvedValue([{ severity: condition }]);
    if (condition === 'manual history') f.tx.storyWriterReview.findMany.mockResolvedValue([{ ...f.review, decisions: { read: true } }]);
    if (condition === 'revoked history') f.tx.storyWriterReview.findMany.mockResolvedValue([{ ...f.review, state: 'revoked', revision: 3 }]);
    if (condition === 'too much history') f.tx.storyWriterReview.findMany.mockResolvedValue(Array.from({ length: 1001 }, () => ({ ...f.review })));
    expect(await complete(f)).toBeNull(); expectNoAutomaticWrites(f);
  });

  it('preserves an existing human review and creates no delegated record', async () => {
    const f = fixture(); f.review.decisions = { humanReviewed: true }; f.review.revision = 4;
    expect(await complete(f)).toBeNull(); expectNoAutomaticWrites(f);
  });

  it('does not refresh a stale existing delegated receipt', async () => {
    const f = fixture(); await complete(f);
    const saved = f.persisted.submission;
    f.profile.reviewRevision += 1; clearSubmissionWrites(f);
    await expect(complete(f)).rejects.toBeInstanceOf(ConflictException);
    expect(f.persisted.submission).toBe(saved); expectNoAutomaticWrites(f);
  });

  it('rolls back a newly created automatic review when receipt saving fails (simulated)', async () => {
    const f = fixture(true);
    f.tx.auditEvent.create.mockRejectedValueOnce(new Error('synthetic storage failure'));
    await expect(complete(f)).rejects.toThrow('synthetic storage failure');
    expect(f.reviewPresence.exists).toBe(false);
    expect(f.persisted.submission).toBeNull(); expect(f.persisted.receipts).toEqual([]);
    expect(f.db.$transaction).toHaveBeenCalledTimes(1); expectNoUnrelatedWrites(f);
  });
});

describe('company final submission binding reads (real policy, synthetic delegates)', () => {
  it('uses the latest semantic job regardless of status, not the latest completed job', async () => {
    const f = fixture();
    f.analysis.status = 'running';
    expect(await readCompanyFinalSubmissionBinding(f.tx as never, ids.owner, ids.work, f.review as never)).toBeNull();
    expect(f.tx.storyAnalysisJob.findFirst).toHaveBeenCalledWith({ where: {
      workId: ids.work, manuscriptVersionId: ids.manuscript, pipeline: 'semantic_extraction_v1',
    }, orderBy: { analysisVersion: 'desc' } });
    expectNoSubmissionWrites(f);
  });

  it.each(['chunks incomplete', 'chunks empty', 'chunks over-completed', 'paragraphs incomplete',
    'paragraph plan incomplete', 'paragraph plan empty'])('requires full valid planning and completion: %s', async condition => {
    const f = fixture();
    if (condition === 'chunks incomplete') f.analysis.completedChunks = 0;
    if (condition === 'chunks empty') { f.analysis.plannedChunks = 0; f.analysis.completedChunks = 0; }
    if (condition === 'chunks over-completed') f.analysis.completedChunks = 2;
    if (condition === 'paragraphs incomplete') f.analysis.completedParagraphs = 0;
    if (condition === 'paragraph plan incomplete') f.analysis.plannedParagraphs = 0;
    if (condition === 'paragraph plan empty') {
      f.analysis.totalParagraphs = 0; f.analysis.plannedParagraphs = 0; f.analysis.completedParagraphs = 0;
    }
    expect(await readCompanyFinalSubmissionBinding(f.tx as never, ids.owner, ids.work, f.review as never)).toBeNull();
    expectNoSubmissionWrites(f);
  });
});

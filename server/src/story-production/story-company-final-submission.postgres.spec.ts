import 'reflect-metadata';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import {
  CREATOR_GENERATION_PROFILE_SCHEMA,
  STORY_PROFILE_SECTION_KEYS,
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
  stableJson,
} from '../generation-profile/creator-generation-profile.policy';
import {
  assertCompanyFinalSubmissionCurrent,
  COMPANY_FINAL_SUBMISSION_ACTION,
  COMPANY_FINAL_SUBMISSION_CONTRACT,
} from './story-company-final-submission.policy';
import { StoryCompanyFinalSubmissionService } from './story-company-final-submission.service';
import { resolveCompanyPrivateIntakeSource } from './story-company-source.policy';
import { releaseChecksum } from './story-lifecycle.policy';
import { prepareManuscript, storedManuscriptBody } from './story-manuscript-file.policy';
import { StoryStudioLinearService } from './story-studio-linear.service';
import { StoryStudioChoicePreparationService } from './story-studio-choice-preparation.service';
import { SemanticAnalysisRepository } from './story-semantic-analysis.repository';
import { SemanticAnalysisService, streamedManuscriptHash } from './story-semantic-analysis.service';
import { StoryGenerationProfileService } from './story-generation-profile.service';
import { semanticPinHash, semanticPins } from './story-semantic-analysis.config';
import { semanticTestConfig } from './story-semantic-analysis.test-fixture';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const fixturePrefix = 'qa-company-final-pg-';
const syntheticText = 'Synthetic private company manuscript for isolated QA. No real person or source.';

type OwnedRows = {
  ownerId: string; workId: string; slug: string; rateCardId: string; intakeId: string;
  reviewIds: string[]; manuscriptIds: string[]; analysisIds: string[];
  profileIds: string[]; releaseIds: string[]; transitionIds: string[]; issueIds: string[]; auditIds: string[];
};
type OwnedTrigger = { functionName: string; triggerName: string; functionCreated: boolean; triggerCreated: boolean };

function assertOwnedDatabase(value: string) {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('Owned isolated company-final QA database required'); }
  if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
      parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash ||
      !/^\/lumina_failed_cost_qa_[a-f0-9]{12}$/.test(parsed.pathname)) {
    throw new Error('Owned isolated company-final QA database required');
  }
}

jest.setTimeout(60000);

postgres('native company manuscript final submission (isolated PostgreSQL, no providers)', () => {
  let db: PrismaClient;
  let service: StoryCompanyFinalSubmissionService;
  const ownedRows: OwnedRows[] = [];
  const ownedTriggers: OwnedTrigger[] = [];

  beforeAll(async () => {
    assertOwnedDatabase(url!);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    service = new StoryCompanyFinalSubmissionService(db as never);
  });

  async function dropOwnedTrigger(object: OwnedTrigger) {
    if (object.triggerCreated) {
      await db.$executeRaw(Prisma.raw(`DROP TRIGGER "${object.triggerName}" ON public.audit_events`));
      object.triggerCreated = false;
    }
    if (object.functionCreated) {
      await db.$executeRaw(Prisma.raw(`DROP FUNCTION public."${object.functionName}"()`));
      object.functionCreated = false;
    }
  }

  async function cleanupOwnedRows(scope: OwnedRows) {
    await db.$transaction(async tx => {
      const work = await tx.storyWork.findUnique({ where: { id: scope.workId } });
      if (!work || work.ownerUserId !== scope.ownerId || work.slug !== scope.slug ||
          !work.slug.startsWith(fixturePrefix)) throw new Error('Synthetic company-final fixture ownership changed; cleanup refused');
      const submissions = await tx.storyFinalSubmission.findMany({ where: { reviewId: { in: scope.reviewIds } }, select: { id: true } });
      const targetIds = [scope.workId, ...scope.reviewIds, ...scope.profileIds, ...submissions.map(row => row.id)];
      await tx.auditEvent.deleteMany({ where: { OR: [
        { id: { in: scope.auditIds } },
        { actorUserId: scope.ownerId, targetId: { in: targetIds }, action: COMPANY_FINAL_SUBMISSION_ACTION },
      ] } });
      await tx.storyContinuityIssue.deleteMany({ where: { id: { in: scope.issueIds }, workId: scope.workId } });
      await tx.storyMemoryRecord.deleteMany({ where: { workId: scope.workId, analysisJobId: { in: scope.analysisIds } } });
      await tx.storyFinalSubmission.deleteMany({ where: { reviewId: { in: scope.reviewIds }, manuscriptVersionId: { in: scope.manuscriptIds } } });
      await tx.storyWriterReview.deleteMany({ where: { id: { in: scope.reviewIds }, workId: scope.workId, ownerUserId: scope.ownerId } });
      await tx.storyWorkGenerationProfile.deleteMany({ where: { id: { in: scope.profileIds }, workId: scope.workId, ownerUserId: scope.ownerId } });
      await tx.storyPublicationImportJob.deleteMany({ where: { id: scope.intakeId, workId: scope.workId, actorUserId: scope.ownerId } });
      await tx.storyPublicationTransition.deleteMany({ where: { id: { in: scope.transitionIds } } });
      await tx.storyRelease.deleteMany({ where: { id: { in: scope.releaseIds }, workId: scope.workId, createdByUserId: scope.ownerId } });
      await tx.storyAnalysisChunk.deleteMany({ where: { analysisJobId: { in: scope.analysisIds } } });
      await tx.storyAnalysisEvidence.deleteMany({ where: { analysisJobId: { in: scope.analysisIds } } });
      await tx.storyAnalysisJob.deleteMany({ where: { id: { in: scope.analysisIds }, workId: scope.workId } });
      await tx.storyManuscriptVersion.deleteMany({ where: { id: { in: scope.manuscriptIds }, workId: scope.workId, ownerUserId: scope.ownerId } });
      await tx.storyWork.deleteMany({ where: { id: scope.workId, ownerUserId: scope.ownerId, slug: scope.slug } });
      await tx.storyAiRateCard.deleteMany({ where: { id: scope.rateCardId, createdByUserId: scope.ownerId } });
      await tx.user.deleteMany({ where: { id: scope.ownerId } });
    }, { timeout: 30000 });
  }

  async function cleanup() {
    for (const object of ownedTriggers.slice().reverse()) await dropOwnedTrigger(object);
    ownedTriggers.length = 0;
    while (ownedRows.length) {
      await cleanupOwnedRows(ownedRows[ownedRows.length - 1]);
      ownedRows.pop();
    }
  }

  afterEach(async () => { if (db) await cleanup(); });
  afterAll(async () => {
    if (!db) return;
    try { await cleanup(); } finally { await db.$disconnect(); }
  });

  async function fixture(options: { studioSource?: boolean; recoverySource?: boolean } = {}) {
    const ownerId = randomUUID();
    const workId = randomUUID();
    const manuscriptId = randomUUID();
    const analysisId = randomUUID();
    const profileId = randomUUID();
    const reviewId = randomUUID();
    const intakeId = randomUUID();
    const auditId = randomUUID();
    const rateCardId = randomUUID();
    const slug = `${fixturePrefix}${randomUUID()}`;
    const prepared = options.studioSource ? prepareManuscript(Buffer.from(JSON.stringify({ locale: 'ko', parts: [
      { partKey: 'synthetic-part-1', title: 'Synthetic part', paragraphs: [{ kind: 'paragraph', text: syntheticText }] },
    ] }))) : null;
    const contentHash = prepared?.contentHash ?? sha256(syntheticText);
    const sourceBindingSha256 = sha256(`synthetic-private-intake:${workId}`);
    const recoveryPins = options.recoverySource ? semanticPins(semanticTestConfig()) : null;
    const configHash = recoveryPins ? semanticPinHash(recoveryPins) : sha256(`synthetic-semantic-config:${workId}`);
    const plan = { storyKey: 'monster', slug, sourceBindingSha256,
      writerIntakeWorkflow: 'writer_review_before_choices_v1', manuscript: { contentHash }, parts: [{}], prompts: [] };
    const settings = normalizeCreatorGenerationProfile('story', {
      schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
      sections: STORY_PROFILE_SECTION_KEYS.map(key => ({ key, decision: 'accepted',
        value: { summary: `Synthetic isolated QA ${key}` }, evidence: [] })),
    });
    const sourceFingerprint = sha256(stableJson({ workId, manuscriptVersionId: manuscriptId,
      contentHash, analysisJobId: analysisId, analysisVersion: 1, analysisConfigHash: configHash }));
    const approvedFingerprint = creatorGenerationProfileFingerprint(sourceFingerprint, settings);
    const rows = await db.$transaction(async tx => {
      const owner = await tx.user.create({ data: { id: ownerId } });
      // Test-only content uses the native intake branch, not the product fixtureSource bypass.
      const work = await tx.storyWork.create({ data: { id: workId, ownerUserId: owner.id, slug,
        title: { ko: 'Synthetic private company QA manuscript' }, summary: {},
        authorDisplayName: '\uB8E8\uBBF8\uB098', fixtureSource: false,
        coverManifest: { privateIntake: { contract: 'publication-writer-intake-v1',
          jobId: intakeId, sourceBindingSha256, manuscriptHash: contentHash } } } });
      const manuscript = await tx.storyManuscriptVersion.create({ data: { id: manuscriptId,
        workId: work.id, ownerUserId: owner.id, version: 1, locale: 'ko', contentHash,
        structuredBody: prepared ? storedManuscriptBody(prepared) as Prisma.InputJsonValue
          : { parts: [{ partKey: 'synthetic-part-1', paragraphs: [{ text: syntheticText }] }] } } });
      const rateCard = await tx.storyAiRateCard.create({ data: { id: rateCardId,
        version: `${fixturePrefix}${randomUUID()}`, provider: 'offline-qa', model: 'synthetic-only',
        status: 'active', inputCostPerMillion: 0, outputCostPerMillion: 0, createdByUserId: owner.id } });
      const analysis = await tx.storyAnalysisJob.create({ data: { id: analysisId, workId: work.id,
        manuscriptVersionId: manuscript.id, analysisVersion: 1, actorUserId: owner.id,
        idempotencyKey: `${fixturePrefix}analysis:${randomUUID()}`, pipeline: 'semantic_extraction_v1',
        status: recoveryPins ? 'failed' : 'completed', phase: recoveryPins ? 'finalizing' : 'completed',
        sourceContentHash: contentHash, sourceLocale: 'ko',
        sourceDigest: recoveryPins ? streamedManuscriptHash(manuscript.structuredBody) : contentHash,
        configHash, rateCardId: rateCard.id, totalParts: 1,
        totalParagraphs: 1, plannedParagraphs: 1, completedParagraphs: 1,
        plannedChunks: 1, completedChunks: 1, completedAt: recoveryPins ? null : new Date(),
        ...(recoveryPins ? { configPins: recoveryPins as unknown as Prisma.InputJsonValue,
          reservedInputTokens: 1, reservedOutputTokens: 0, observedCostKrw: 0,
          reservedCostKrw: 0, errorCode: 'analysis_profile_draft_unavailable' } : {}) } });
      await tx.storyAnalysisChunk.create({ data: { analysisJobId: analysis.id, ordinal: 0,
        sourceRefs: [{ partKey: 'synthetic-part-1', paragraphIndex: 0 }], sourceHash: contentHash,
        paragraphCount: 1, inputTokenBudget: 1, status: 'completed', completedAt: new Date(),
        ...(recoveryPins ? { dispatchStartedAt: new Date(), inputTokens: 0, outputTokens: 0,
          cachedInputTokens: 0, reasoningTokens: 0, actualCostKrw: 0 } : {}) } });
      const profile = await tx.storyWorkGenerationProfile.create({ data: { id: profileId,
        workId: work.id, ownerUserId: owner.id, manuscriptVersionId: manuscript.id, analysisJobId: analysis.id,
        sourceFingerprint, profileVersion: 1, reviewRevision: 1, status: 'approved',
        draftSettings: settings as unknown as Prisma.InputJsonValue,
        approvedSettings: settings as unknown as Prisma.InputJsonValue,
        draftFingerprint: approvedFingerprint, approvedFingerprint, approvedByUserId: owner.id, approvedAt: new Date() } });
      const intake = await tx.storyPublicationImportJob.create({ data: { id: intakeId,
        actorUserId: owner.id, workId: work.id, storyKey: plan.storyKey, sourceBindingSha256,
        status: 'awaiting_author_review', planSnapshot: plan } });
      const intakeAudit = await tx.auditEvent.create({ data: { id: auditId, actorUserId: owner.id,
        actorType: 'admin', action: 'story_publication.private_writer_intake', targetType: 'story_work', targetId: work.id,
        metadata: { jobId: intake.id, manuscriptVersionId: manuscript.id, manuscriptHash: contentHash,
          sourceBindingSha256, partCount: 1, analysisStarted: false, choicesGenerated: false, published: false } } });
      const review = await tx.storyWriterReview.create({ data: { id: reviewId, workId: work.id,
        ownerUserId: owner.id, manuscriptVersionId: manuscript.id, analysisJobId: analysis.id, state: 'analysis_ready' } });
      return { owner, work, manuscript, rateCard, analysis, profile, intake, intakeAudit, review };
    }, { timeout: 30000 });
    const scope: OwnedRows = { ownerId, workId, slug, rateCardId, intakeId,
      reviewIds: [reviewId], manuscriptIds: [manuscriptId], analysisIds: [analysisId],
      profileIds: [profileId], releaseIds: [], transitionIds: [], issueIds: [], auditIds: [auditId] };
    ownedRows.push(scope);
    return { ...rows, scope, settings, plan,
      submit: (expectedRevision = 1) => service.autoSubmitReview(ownerId, reviewId, expectedRevision) };
  }

  type Fixture = Awaited<ReturnType<typeof fixture>>;

  async function submissions(f: Fixture) {
    return db.storyFinalSubmission.findMany({ where: { reviewId: f.review.id } });
  }

  async function receipts(f: Fixture) {
    return db.auditEvent.findMany({ where: { actorUserId: f.owner.id,
      action: COMPANY_FINAL_SUBMISSION_ACTION, targetType: 'story_final_submission',
      targetId: { in: (await submissions(f)).map(row => row.id) } }, orderBy: { createdAt: 'asc' } });
  }

  async function currentAuthority(f: Fixture) {
    const review = await db.storyWriterReview.findUniqueOrThrow({ where: { id: f.review.id } });
    const submission = await db.storyFinalSubmission.findUniqueOrThrow({ where: { reviewId: review.id } });
    const manuscript = await db.storyManuscriptVersion.findUniqueOrThrow({ where: { id: review.manuscriptVersionId } });
    return assertCompanyFinalSubmissionCurrent(db, { ownerUserId: f.owner.id, workId: f.work.id, review, manuscript, submission });
  }

  async function unchangedData(f: Fixture) {
    const workId = f.work.id;
    const partIds = (await db.storyPart.findMany({ where: { workId }, select: { id: true } })).map(row => row.id);
    const sceneIds = (await db.storyScene.findMany({ where: { partId: { in: partIds } }, select: { id: true } })).map(row => row.id);
    return {
      work: await db.storyWork.findUniqueOrThrow({ where: { id: workId } }),
      manuscript: await db.storyManuscriptVersion.findUniqueOrThrow({ where: { id: f.manuscript.id } }),
      analysis: await db.storyAnalysisJob.findUniqueOrThrow({ where: { id: f.analysis.id } }),
      chunks: await db.storyAnalysisChunk.findMany({ where: { analysisJobId: f.analysis.id }, orderBy: { ordinal: 'asc' } }),
      profile: await db.storyWorkGenerationProfile.findUniqueOrThrow({ where: { id: f.profile.id } }),
      rateCard: await db.storyAiRateCard.findUniqueOrThrow({ where: { id: f.rateCard.id } }),
      intake: await db.storyPublicationImportJob.findUniqueOrThrow({ where: { id: f.intake.id } }),
      consent: await db.storyStyleProfileConsent.findUnique({ where: { workId } }),
      releases: await db.storyRelease.count({ where: { workId } }),
      publicationTransitions: await db.storyPublicationTransition.count({ where: { workId } }),
      parts: partIds.length,
      scenes: sceneIds.length,
      choices: await db.storyChoice.count({ where: { sceneId: { in: sceneIds } } }),
      branchPreparationJobs: await db.storyBranchPreparationJob.count({ where: { workId } }),
      choiceJobs: await db.storyStudioChoiceJob.count({ where: { workId } }),
      continuations: await db.storyAiContinuation.count({ where: { workId } }),
      generatedScenes: await db.storyAiGeneratedScene.count({ where: { workId } }),
      reusableResults: await db.storyAiReusableResult.count({ where: { workId } }),
      usage: await db.storyAiUsageLedger.findMany({ where: { workId } }),
      memoryBudgetRuns: await db.storyMemoryBudgetRun.count({ where: { workId } }),
    };
  }

  async function createIssue(f: Fixture, severity: 'critical' | 'warning', status = 'open') {
    const id = randomUUID();
    f.scope.issueIds.push(id);
    return db.storyContinuityIssue.create({ data: { id, workId: f.work.id,
      analysisJobId: f.analysis.id, analysisVersion: f.analysis.analysisVersion,
      issueKey: `${fixturePrefix}${randomUUID()}`, severity, status,
      summary: 'Synthetic original-path continuity issue, not manuscript content.' } });
  }

  async function seedPublishedLifecycle(f: Fixture) {
    const id = randomUUID();
    const transitionId = randomUUID();
    const linkedAuditId = randomUUID();
    f.scope.releaseIds.push(id);
    f.scope.transitionIds.push(transitionId);
    f.scope.auditIds.push(linkedAuditId);
    const snapshot = { manuscriptVersionId: f.manuscript.id, branchGraphSnapshot: { contract: 'studio-linear-v1' },
      endingSetSnapshot: {}, sceneAssetManifest: {}, localizedDisplaySnapshot: {} };
    // Synthetic durable lifecycle records only; no real publication, rights, choices or providers are invoked.
    return db.$transaction(async tx => {
      const release = await tx.storyRelease.create({ data: { id, workId: f.work.id, version: 1,
        status: 'active', ...snapshot, checksum: releaseChecksum(snapshot), createdByUserId: f.owner.id,
        activatedAt: new Date(), validationSummary: { ready: true } } });
      const transition = await tx.storyPublicationTransition.create({ data: {
        id: transitionId, workId: f.work.id, releaseId: release.id, actorUserId: f.owner.id,
        idempotencyKey: `${fixturePrefix}transition:${randomUUID()}`, fromStatus: 'release_ready', toStatus: 'published',
        beforeRevision: f.work.releaseRevision, afterRevision: f.work.releaseRevision + 1,
        publicSummary: { syntheticFixture: true },
      } });
      await tx.storyWork.update({ where: { id: f.work.id }, data: {
        status: 'published', activeReleaseId: release.id, publishedAt: new Date(),
        releaseRevision: transition.afterRevision, publishedVersion: release.version } });
      await tx.storyPublicationImportJob.update({ where: { id: f.intake.id }, data: {
        status: 'published', releaseId: release.id, batchCursor: 1, planSnapshot: Prisma.DbNull } });
      const linkedAudit = await tx.auditEvent.create({ data: { id: linkedAuditId, actorUserId: f.owner.id,
        actorType: 'admin', action: 'story_publication.writer_flow_linked', targetType: 'story_work', targetId: f.work.id,
        metadata: { jobId: f.intake.id, releaseId: release.id, manuscriptHash: f.manuscript.contentHash,
          sourceBindingSha256: f.intake.sourceBindingSha256, publicationTransitionId: transition.id,
          releaseChecksum: release.checksum, providerCalled: false },
      } });
      return { ...release, transition, linkedAudit };
    });
  }

  type PublishedLifecycle = Awaited<ReturnType<typeof seedPublishedLifecycle>>;

  async function changeAuditMetadata(id: string, patch: Record<string, unknown>) {
    const audit = await db.auditEvent.findUniqueOrThrow({ where: { id } });
    const metadata = { ...audit.metadata as Record<string, unknown>, ...patch };
    return db.auditEvent.update({ where: { id }, data: { metadata: metadata as Prisma.InputJsonObject } });
  }

  async function installAuditFailure(f: Fixture) {
    const suffix = randomUUID().replace(/-/g, '');
    const object: OwnedTrigger = { functionName: `qa_company_final_failure_${suffix}`,
      triggerName: `qa_company_final_audit_${suffix}`, functionCreated: false, triggerCreated: false };
    if (!/^[a-z_]+[a-f0-9]{32}$/.test(object.functionName) ||
        !/^[a-z_]+[a-f0-9]{32}$/.test(object.triggerName) ||
        !/^[a-f0-9-]{36}$/.test(f.owner.id)) throw new Error('Invalid synthetic trigger identity');
    ownedTriggers.push(object);
    // Identifiers and UUID below are generated by this test, never sourced from environment or users.
    await db.$executeRaw(Prisma.raw(`CREATE FUNCTION public."${object.functionName}"()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.actor_user_id = '${f.owner.id}'::uuid
          AND NEW.action = 'story.final_submission.company_delegated' THEN
          RAISE EXCEPTION 'Synthetic company final audit failure' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$`));
    object.functionCreated = true;
    await db.$executeRaw(Prisma.raw(`CREATE TRIGGER "${object.triggerName}" BEFORE INSERT ON public.audit_events
      FOR EACH ROW EXECUTE FUNCTION public."${object.functionName}"()`));
    object.triggerCreated = true;
    return object;
  }

  it('records one manuscript-only submission and system receipt at revision 2 without consent or public/generation changes', async () => {
    const f = await fixture();
    expect(f.review).toMatchObject({ state: 'analysis_ready', revision: 1, decisions: {}, finalSummary: {}, submittedAt: null });
    const before = await unchangedData(f);
    const result = await f.submit();
    expect(result).toMatchObject({ approvalBasis: 'company_delegation', idempotentReplay: false,
      review: { id: f.review.id, state: 'submitted', revision: 2, decisions: {}, finalSummary: {} },
      submission: { reviewId: f.review.id, manuscriptVersionId: f.manuscript.id, checksum: f.manuscript.contentHash } });
    const saved = await submissions(f);
    expect(saved).toHaveLength(1);
    expect(saved[0].idempotencyKey).toBe(`story-company-final-v1:${result!.bindingHash}`);
    const review = await db.storyWriterReview.findUniqueOrThrow({ where: { id: f.review.id } });
    expect(review).toEqual(result!.review);
    expect(review.submittedAt).toBeInstanceOf(Date);
    const audit = await receipts(f);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorType: 'system', actorUserId: f.owner.id,
      targetType: 'story_final_submission', targetId: saved[0].id,
      beforeData: { state: 'analysis_ready', revision: 1 }, afterData: { state: 'submitted', revision: 2 },
      metadata: { contract: COMPANY_FINAL_SUBMISSION_CONTRACT, scope: 'manuscript_submission',
        approvalBasis: 'company_delegation', bindingHash: result!.bindingHash,
        humanSemanticReview: false, publication: false, sharedReuse: false,
        binding: { ownerUserId: f.owner.id, workId: f.work.id, reviewId: f.review.id,
          manuscriptVersionId: f.manuscript.id, manuscriptHash: f.manuscript.contentHash,
          beforeReviewRevision: 1, submittedReviewRevision: 2,
          source: { companyPrivateIntakeJobId: f.intake.id, companyPrivateIntakeAuditId: f.intakeAudit.id } } } });
    const metadata = audit[0].metadata as Record<string, unknown>;
    expect(metadata.binding).not.toHaveProperty('consentPin');
    expect(result!.bindingHash).toBe(sha256(stableJson(metadata.binding)));
    expect(JSON.stringify(audit)).not.toContain(syntheticText);
    expect(await unchangedData(f)).toEqual(before);
    expect(await currentAuthority(f)).toMatchObject({ bindingHash: result!.bindingHash, approvalBasis: 'company_delegation' });
  });

  it('serializes concurrent submit attempts and replays the one persisted receipt', async () => {
    const f = await fixture();
    const outcomes = await Promise.allSettled([f.submit(), f.submit()]);
    let successes = 0;
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') {
        expect(outcome.value).not.toBeNull();
        successes++;
      } else {
        const reason = outcome.reason as { code?: string; meta?: { code?: string }; response?: { code?: string } };
        expect(reason.code === 'P2034' || (reason.code === 'P2010' && reason.meta?.code === '40001') ||
          reason.response?.code === 'COMPANY_FINAL_REVIEW_CHANGED').toBe(true);
      }
    }
    expect(successes).toBeGreaterThanOrEqual(1);
    const saved = await submissions(f);
    expect(saved).toHaveLength(1);
    const originalReceipt = await receipts(f);
    expect(originalReceipt).toHaveLength(1);
    const review = await db.storyWriterReview.findUniqueOrThrow({ where: { id: f.review.id } });
    expect(review).toMatchObject({ state: 'submitted', revision: 2, decisions: {}, finalSummary: {} });
    expect(await f.submit(2)).toMatchObject({ idempotentReplay: true,
      bindingHash: (originalReceipt[0].metadata as Record<string, unknown>).bindingHash,
      submission: { id: saved[0].id }, review: { revision: 2 } });
    expect(await submissions(f)).toEqual(saved);
    expect(await receipts(f)).toEqual(originalReceipt);
  });

  it('rolls back the real submission and review CAS when PostgreSQL rejects the audit insert', async () => {
    const f = await fixture();
    const before = await unchangedData(f);
    const beforeReview = await db.storyWriterReview.findUniqueOrThrow({ where: { id: f.review.id } });
    const failure = await installAuditFailure(f);
    try {
      await expect(f.submit()).rejects.toThrow(/Synthetic company final audit failure/);
      expect(await submissions(f)).toEqual([]);
      expect(await receipts(f)).toEqual([]);
      expect(await db.auditEvent.count({ where: { actorUserId: f.owner.id } })).toBe(1);
      expect(await db.storyWriterReview.findUniqueOrThrow({ where: { id: f.review.id } })).toEqual(beforeReview);
      expect(await unchangedData(f)).toEqual(before);
    } finally { await dropOwnedTrigger(failure); }
    expect(await f.submit()).toMatchObject({ idempotentReplay: false, review: { revision: 2 } });
    expect(await submissions(f)).toHaveLength(1);
    expect(await receipts(f)).toHaveLength(1);
  });

  it('rejects a stale expected revision before writing anything', async () => {
    const f = await fixture();
    await expect(f.submit(0)).rejects.toMatchObject({ response: { code: 'COMPANY_FINAL_REVIEW_CHANGED' } });
    expect(await submissions(f)).toEqual([]);
    expect(await db.auditEvent.count({ where: { actorUserId: f.owner.id } })).toBe(1);
    expect(await db.storyWriterReview.findUniqueOrThrow({ where: { id: f.review.id } })).toEqual(f.review);
  });

  it.each(['critical', 'warning'] as const)('blocks an open %s before submission and invalidates replay if it appears later', async severity => {
    const f = await fixture();
    const issue = await createIssue(f, severity);
    expect(await f.submit()).toBeNull();
    expect(await submissions(f)).toEqual([]);
    expect(await db.storyWriterReview.findUniqueOrThrow({ where: { id: f.review.id } })).toEqual(f.review);
    await db.storyContinuityIssue.update({ where: { id: issue.id }, data: { status: 'resolved' } });
    expect(await f.submit()).toMatchObject({ idempotentReplay: false });
    const saved = await submissions(f);
    const audit = await receipts(f);
    await db.storyContinuityIssue.update({ where: { id: issue.id }, data: { status: 'open' } });
    await expect(f.submit(2)).rejects.toMatchObject({ response: { code: 'COMPANY_FINAL_SUBMISSION_CHANGED' } });
    expect(await submissions(f)).toEqual(saved);
    expect(await receipts(f)).toEqual(audit);
  });

  it.each(['running', 'incomplete-chunks', 'empty-chunks', 'incomplete-paragraphs'])('rejects current semantic analysis with %s without falling back to a stale approval', async condition => {
    const f = await fixture();
    if (condition === 'running') await db.storyAnalysisJob.update({ where: { id: f.analysis.id }, data: { status: 'running' } });
    if (condition === 'incomplete-chunks') await db.storyAnalysisJob.update({ where: { id: f.analysis.id }, data: { completedChunks: 0 } });
    if (condition === 'empty-chunks') await db.storyAnalysisJob.update({ where: { id: f.analysis.id }, data: { plannedChunks: 0, completedChunks: 0 } });
    if (condition === 'incomplete-paragraphs') await db.storyAnalysisJob.update({ where: { id: f.analysis.id }, data: { completedParagraphs: 0 } });
    expect(await f.submit()).toBeNull();
    expect(await submissions(f)).toEqual([]);
    expect(await db.storyWriterReview.findUniqueOrThrow({ where: { id: f.review.id } })).toEqual(f.review);
  });

  it('rejects an unapproved latest profile instead of selecting the older approved profile', async () => {
    const f = await fixture();
    const id = randomUUID();
    f.scope.profileIds.push(id);
    await db.storyWorkGenerationProfile.create({ data: { id, workId: f.work.id, ownerUserId: f.owner.id,
      manuscriptVersionId: f.manuscript.id, analysisJobId: f.analysis.id,
      sourceFingerprint: f.profile.sourceFingerprint, profileVersion: 2, status: 'needs_review',
      draftSettings: f.settings as unknown as Prisma.InputJsonValue } });
    expect(await f.submit()).toBeNull();
    expect(await submissions(f)).toEqual([]);
  });

  it('blocks a manually touched earlier review for the same manuscript', async () => {
    const f = await fixture();
    const analysisId = randomUUID();
    const reviewId = randomUUID();
    f.scope.analysisIds.push(analysisId);
    f.scope.reviewIds.push(reviewId);
    await db.storyAnalysisJob.create({ data: { id: analysisId, workId: f.work.id,
      manuscriptVersionId: f.manuscript.id, analysisVersion: 2, idempotencyKey: `${fixturePrefix}${randomUUID()}`,
      pipeline: 'structural_legacy', status: 'completed' } });
    const history = await db.storyWriterReview.create({ data: { id: reviewId, workId: f.work.id,
      ownerUserId: f.owner.id, manuscriptVersionId: f.manuscript.id, analysisJobId: analysisId,
      state: 'editing', decisions: { warningAcknowledged: true } } });
    expect(await f.submit()).toBeNull();
    expect(await submissions(f)).toEqual([]);
    expect(await db.storyWriterReview.findUniqueOrThrow({ where: { id: history.id } })).toEqual(history);
  });

  it('never relabels a real manual submission even when the review has the company terminal shape', async () => {
    const f = await fixture();
    const manual = await db.storyFinalSubmission.create({ data: { reviewId: f.review.id,
      manuscriptVersionId: f.manuscript.id, checksum: f.manuscript.contentHash,
      idempotencyKey: `story-final-submit:${sha256(randomUUID())}` } });
    await db.storyWriterReview.update({ where: { id: f.review.id }, data: { state: 'submitted', revision: 2, submittedAt: new Date() } });
    expect(await f.submit(2)).toBeNull();
    expect(await submissions(f)).toEqual([manual]);
    expect(await db.auditEvent.count({ where: { actorUserId: f.owner.id, action: COMPANY_FINAL_SUBMISSION_ACTION } })).toBe(0);
  });

  const staleReplay: Array<[string, (f: Fixture) => Promise<unknown>]> = [
    ['analysis no longer complete', f => db.storyAnalysisJob.update({ where: { id: f.analysis.id }, data: { status: 'running' } })],
    ['analysis chunks no longer complete', f => db.storyAnalysisJob.update({ where: { id: f.analysis.id }, data: { completedChunks: 0 } })],
    ['profile revision changed', f => db.storyWorkGenerationProfile.update({ where: { id: f.profile.id }, data: { reviewRevision: { increment: 1 } } })],
    ['profile fingerprint corrupted', f => db.storyWorkGenerationProfile.update({ where: { id: f.profile.id }, data: { approvedFingerprint: sha256('corrupt synthetic profile') } })],
    ['native audit no longer admin', f => db.auditEvent.update({ where: { id: f.intakeAudit.id }, data: { actorType: 'user' } })],
    ['review submission timestamp removed', f => db.storyWriterReview.update({ where: { id: f.review.id }, data: { submittedAt: null } })],
    ['manual review decisions added', f => db.storyWriterReview.update({ where: { id: f.review.id }, data: { decisions: { warningAcknowledged: true } } })],
  ];
  it.each(staleReplay)('rejects persisted replay when %s', async (_name, change) => {
    const f = await fixture();
    expect(await f.submit()).not.toBeNull();
    const saved = await submissions(f);
    const audit = await receipts(f);
    await change(f);
    await expect(f.submit(2)).rejects.toMatchObject({ response: { code: 'COMPANY_FINAL_SUBMISSION_CHANGED' } });
    expect(await submissions(f)).toEqual(saved);
    expect(await receipts(f)).toEqual(audit);
  });

  it.each(['scope', 'humanSemanticReview', 'publication', 'sharedReuse', 'bindingHash'])('rejects a tampered persisted company receipt: %s', async field => {
    const f = await fixture();
    await f.submit();
    const saved = await submissions(f);
    const original = (await receipts(f))[0];
    const metadata = { ...original.metadata as Record<string, unknown>,
      [field]: field === 'scope' ? 'publication' : field === 'bindingHash' ? sha256('tampered receipt') : true };
    const tampered = await db.auditEvent.update({ where: { id: original.id }, data: { metadata: metadata as Prisma.InputJsonObject } });
    await expect(f.submit(2)).rejects.toMatchObject({ response: { code: 'COMPANY_FINAL_SUBMISSION_CHANGED' } });
    expect(await submissions(f)).toEqual(saved);
    expect(await receipts(f)).toEqual([tampered]);
  });

  it('does not invent a missing company receipt for an existing reserved-key submission', async () => {
    const f = await fixture();
    await f.submit();
    const saved = await submissions(f);
    const audit = (await receipts(f))[0];
    await db.auditEvent.delete({ where: { id: audit.id } });
    await expect(f.submit(2)).rejects.toMatchObject({ response: { code: 'COMPANY_FINAL_SUBMISSION_CHANGED' } });
    expect(await submissions(f)).toEqual(saved);
    expect(await receipts(f)).toEqual([]);
  });

  it('rejects the original submission when a newer manuscript becomes current', async () => {
    const f = await fixture();
    await f.submit();
    const saved = await submissions(f);
    const audit = await receipts(f);
    const id = randomUUID();
    f.scope.manuscriptIds.push(id);
    await db.storyManuscriptVersion.create({ data: { id, workId: f.work.id, ownerUserId: f.owner.id,
      version: 2, locale: 'ko', contentHash: sha256('A newer synthetic private manuscript.'), structuredBody: {} } });
    expect(await f.submit(2)).toBeNull();
    await expect(currentAuthority(f)).rejects.toMatchObject({ response: { code: 'COMPANY_FINAL_SUBMISSION_CHANGED' } });
    expect(await submissions(f)).toEqual(saved);
    expect(await receipts(f)).toEqual(audit);
  });

  it.each(['intake_received', 'reviewing', 'release_ready', 'published'])('does not create a new delegated submission outside draft (%s)', async state => {
    const f = await fixture();
    if (state === 'published') await seedPublishedLifecycle(f);
    else await db.storyWork.update({ where: { id: f.work.id }, data: { status: state } });
    expect(await f.submit()).toBeNull();
    expect(await submissions(f)).toEqual([]);
    expect(await db.auditEvent.count({ where: { actorUserId: f.owner.id, action: COMPANY_FINAL_SUBMISSION_ACTION } })).toBe(0);
    expect(await db.storyWriterReview.findUniqueOrThrow({ where: { id: f.review.id } })).toEqual(f.review);
  });

  it.each(['intake_received', 'reviewing', 'release_ready'])('preserves existing manuscript receipt consumption in %s without weakening creation', async state => {
    const f = await fixture();
    const first = await f.submit();
    const audit = await receipts(f);
    await db.storyWork.update({ where: { id: f.work.id }, data: { status: state } });
    expect(await resolveCompanyPrivateIntakeSource(db, f.owner.id, f.work.id, f.manuscript)).toBeNull();
    expect(await currentAuthority(f)).toMatchObject({ bindingHash: first!.bindingHash });
    expect(await f.submit(2)).toMatchObject({ bindingHash: first!.bindingHash, idempotentReplay: true });
    expect(await receipts(f)).toEqual(audit);
    expect(await db.storyStyleProfileConsent.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it('consumes the same receipt in a valid published lifecycle and rejects a changed release checksum', async () => {
    const f = await fixture();
    const first = await f.submit();
    const saved = await submissions(f);
    const audit = await receipts(f);
    const release = await seedPublishedLifecycle(f);
    expect(await resolveCompanyPrivateIntakeSource(db, f.owner.id, f.work.id, f.manuscript)).toBeNull();
    expect(await currentAuthority(f)).toMatchObject({ bindingHash: first!.bindingHash });
    expect(await f.submit(2)).toMatchObject({ idempotentReplay: true, bindingHash: first!.bindingHash });
    await db.storyRelease.update({ where: { id: release.id }, data: { checksum: sha256('corrupt synthetic release checksum') } });
    await expect(currentAuthority(f)).rejects.toMatchObject({ response: { code: 'COMPANY_FINAL_SUBMISSION_CHANGED' } });
    await expect(f.submit(2)).rejects.toMatchObject({ response: { code: 'COMPANY_FINAL_SUBMISSION_CHANGED' } });
    expect(await submissions(f)).toEqual(saved);
    expect(await receipts(f)).toEqual(audit);
  });

  it('consumes the original manuscript receipt after a synthetically seeded writer flow clears the plan', async () => {
    const f = await fixture();
    const first = await f.submit();
    const saved = await submissions(f);
    const originalReceipt = await receipts(f);
    const published = await seedPublishedLifecycle(f);
    const job = await db.storyPublicationImportJob.findUniqueOrThrow({ where: { id: f.intake.id } });
    expect(job).toMatchObject({ status: 'published', releaseId: published.id, batchCursor: 1, planSnapshot: null });
    const storage = await db.$queryRaw<Array<{ cleared: boolean }>>(Prisma.sql`
      SELECT plan_snapshot IS NULL AS cleared FROM story_publication_import_jobs WHERE id = ${job.id}::uuid
    `);
    expect(storage).toEqual([{ cleared: true }]);
    expect(published.transition).toMatchObject({ workId: f.work.id, releaseId: published.id,
      actorUserId: f.owner.id, fromStatus: 'release_ready', toStatus: 'published', beforeRevision: 1, afterRevision: 2 });
    expect(published.linkedAudit).toMatchObject({ actorUserId: f.owner.id, actorType: 'admin',
      action: 'story_publication.writer_flow_linked', targetType: 'story_work', targetId: f.work.id });
    expect(published.linkedAudit.metadata).toEqual({ jobId: job.id, releaseId: published.id,
      manuscriptHash: f.manuscript.contentHash, sourceBindingSha256: f.intake.sourceBindingSha256,
      releaseChecksum: published.checksum, providerCalled: false, publicationTransitionId: published.transition.id });
    const beforeConsumption = await unchangedData(f);
    expect(await currentAuthority(f)).toMatchObject({ bindingHash: first!.bindingHash, approvalBasis: 'company_delegation' });
    expect(await f.submit(2)).toMatchObject({ bindingHash: first!.bindingHash, idempotentReplay: true,
      submission: { id: saved[0].id }, review: { revision: 2 } });
    expect(await resolveCompanyPrivateIntakeSource(db, f.owner.id, f.work.id, f.manuscript)).toBeNull();
    expect(await submissions(f)).toEqual(saved);
    expect(await receipts(f)).toEqual(originalReceipt);
    expect(await unchangedData(f)).toEqual(beforeConsumption);
    expect(beforeConsumption.consent).toBeNull();
  });

  const invalidLinkedProof: Array<[string, (f: Fixture, published: PublishedLifecycle) => Promise<unknown>]> = [
    ['missing linked audit', (_f, published) => db.auditEvent.delete({ where: { id: published.linkedAudit.id } })],
    ['non-admin linked audit', (_f, published) => db.auditEvent.update({ where: { id: published.linkedAudit.id }, data: { actorType: 'user' } })],
    ['missing linked audit owner', (_f, published) => db.auditEvent.update({ where: { id: published.linkedAudit.id }, data: { actorUserId: null } })],
    ['wrong linked action', (_f, published) => db.auditEvent.update({ where: { id: published.linkedAudit.id }, data: { action: 'story_publication.synthetic_other_action' } })],
    ['wrong linked target type', (_f, published) => db.auditEvent.update({ where: { id: published.linkedAudit.id }, data: { targetType: 'story_release' } })],
    ['wrong linked target id', (f, published) => db.auditEvent.update({ where: { id: published.linkedAudit.id }, data: { targetId: f.review.id } })],
    ['wrong linked job id', (_f, published) => changeAuditMetadata(published.linkedAudit.id, { jobId: randomUUID() })],
    ['wrong linked release id', (_f, published) => changeAuditMetadata(published.linkedAudit.id, { releaseId: randomUUID() })],
    ['wrong linked manuscript hash', (_f, published) => changeAuditMetadata(published.linkedAudit.id, { manuscriptHash: sha256('synthetic wrong linked manuscript') })],
    ['wrong linked source binding', (_f, published) => changeAuditMetadata(published.linkedAudit.id, { sourceBindingSha256: sha256('synthetic wrong linked source') })],
    ['wrong linked release checksum', (_f, published) => changeAuditMetadata(published.linkedAudit.id, { releaseChecksum: sha256('synthetic wrong linked release') })],
    ['linked provider called', (_f, published) => changeAuditMetadata(published.linkedAudit.id, { providerCalled: true })],
    ['nonexistent linked transition id', (_f, published) => changeAuditMetadata(published.linkedAudit.id, { publicationTransitionId: randomUUID() })],
    ['missing actual transition', (_f, published) => db.storyPublicationTransition.delete({ where: { id: published.transition.id } })],
    ['actual transition not published', (_f, published) => db.storyPublicationTransition.update({ where: { id: published.transition.id }, data: { toStatus: 'release_ready' } })],
    ['actual transition release missing', (_f, published) => db.storyPublicationTransition.update({ where: { id: published.transition.id }, data: { releaseId: null } })],
    ['incomplete published job cursor', f => db.storyPublicationImportJob.update({ where: { id: f.intake.id }, data: { batchCursor: 0 } })],
    ['over-completed published job cursor', f => db.storyPublicationImportJob.update({ where: { id: f.intake.id }, data: { batchCursor: 2 } })],
    ['published job error', f => db.storyPublicationImportJob.update({ where: { id: f.intake.id }, data: { errorCode: 'SYNTHETIC_QA_FAILURE' } })],
    ['changed native intake part count', f => changeAuditMetadata(f.intakeAudit.id, { partCount: 2 })],
  ];
  it.each(invalidLinkedProof)('rejects cleared-plan consumption with %s without changing the original receipt', async (_name, change) => {
    const f = await fixture();
    const first = await f.submit();
    const saved = await submissions(f);
    const originalReceipt = await receipts(f);
    const published = await seedPublishedLifecycle(f);
    expect(await currentAuthority(f)).toMatchObject({ bindingHash: first!.bindingHash });
    await change(f, published);
    await expect(currentAuthority(f)).rejects.toMatchObject({ response: { code: 'COMPANY_FINAL_SUBMISSION_CHANGED' } });
    await expect(f.submit(2)).rejects.toMatchObject({ response: { code: 'COMPANY_FINAL_SUBMISSION_CHANGED' } });
    expect(await submissions(f)).toEqual(saved);
    expect(await receipts(f)).toEqual(originalReceipt);
    expect(await db.storyStyleProfileConsent.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it('rejects a linked transition for a different synthetic work, not merely an existing transition id', async () => {
    const other = await fixture();
    const f = await fixture();
    const first = await f.submit();
    const saved = await submissions(f);
    const originalReceipt = await receipts(f);
    const published = await seedPublishedLifecycle(f);
    expect(await currentAuthority(f)).toMatchObject({ bindingHash: first!.bindingHash });
    await db.storyPublicationTransition.update({ where: { id: published.transition.id }, data: { workId: other.work.id } });
    await expect(currentAuthority(f)).rejects.toMatchObject({ response: { code: 'COMPANY_FINAL_SUBMISSION_CHANGED' } });
    await expect(f.submit(2)).rejects.toMatchObject({ response: { code: 'COMPANY_FINAL_SUBMISSION_CHANGED' } });
    expect(await submissions(f)).toEqual(saved);
    expect(await receipts(f)).toEqual(originalReceipt);
  });

  it.each(['retired-release', 'missing-publication-time', 'lost-native-audit'])('rejects published receipt consumption after %s', async condition => {
    const f = await fixture();
    await f.submit();
    const saved = await submissions(f);
    const audit = await receipts(f);
    const release = await seedPublishedLifecycle(f);
    if (condition === 'retired-release') await db.storyRelease.update({ where: { id: release.id }, data: { status: 'retired', retiredAt: new Date() } });
    if (condition === 'missing-publication-time') await db.storyWork.update({ where: { id: f.work.id }, data: { publishedAt: null } });
    if (condition === 'lost-native-audit') await db.auditEvent.delete({ where: { id: f.intakeAudit.id } });
    await expect(currentAuthority(f)).rejects.toMatchObject({ response: { code: 'COMPANY_FINAL_SUBMISSION_CHANGED' } });
    expect(await submissions(f)).toEqual(saved);
    expect(await receipts(f)).toEqual(audit);
  });

  describe('read-only company submission preview', () => {
    const preview = (f: Fixture, ownerId = f.owner.id) => new StoryStudioLinearService(db as never,
      new StoryStudioChoicePreparationService(db as never)).preview(ownerId, f.work.id, f.manuscript.id);

    it('does not auto-submit a pristine review while reading', async () => {
      const f = await fixture({ studioSource: true }), before = await unchangedData(f);
      const result = await preview(f);
      expect(result.review).toEqual({ reviewId: f.review.id, state: 'analysis_ready', revision: 1 });
      expect(await submissions(f)).toEqual([]); expect(await receipts(f)).toEqual([]);
      expect(await unchangedData(f)).toEqual(before);
    });

    it('rereads the exact current receipt without creating consent, jobs, audits or usage', async () => {
      const f = await fixture({ studioSource: true }), saved = await f.submit();
      const before = await unchangedData(f), original = await receipts(f);
      const result = await preview(f);
      expect(result.review).toMatchObject({ reviewId: f.review.id, state: 'submitted', revision: 2,
        approvalBasis: 'company_delegation', companySubmission: { contract: COMPANY_FINAL_SUBMISSION_CONTRACT,
          scope: 'manuscript_submission', submissionId: saved!.submission.id,
          manuscriptVersionId: f.manuscript.id, manuscriptHash: f.manuscript.contentHash,
          analysisJobId: f.analysis.id, reviewRevision: 2, bindingHash: saved!.bindingHash,
          humanSemanticReview: false, published: false, generationStarted: false } });
      expect((await preview(f)).review).toEqual(result.review);
      expect(await receipts(f)).toEqual(original); expect(await submissions(f)).toHaveLength(1);
      expect(await unchangedData(f)).toEqual(before);
    });

    it.each(['profile', 'receipt'] as const)('rejects changed %s without replacing its submission record', async changed => {
      const f = await fixture({ studioSource: true }); await f.submit();
      const saved = await submissions(f);
      if (changed === 'profile') await db.storyWorkGenerationProfile.update({ where: { id: f.profile.id },
        data: { reviewRevision: { increment: 1 } } });
      else {
        const [audit] = await receipts(f);
        await changeAuditMetadata(audit.id, { humanSemanticReview: true });
      }
      const before = await unchangedData(f), auditBefore = await receipts(f);
      await expect(preview(f)).rejects.toMatchObject({ response: { code: 'COMPANY_FINAL_SUBMISSION_CHANGED' } });
      expect(await submissions(f)).toEqual(saved); expect(await receipts(f)).toEqual(auditBefore);
      expect(await unchangedData(f)).toEqual(before);
    });

    it('rejects another owner before projecting manuscript or company proof', async () => {
      const f = await fixture({ studioSource: true }); await f.submit();
      const before = await unchangedData(f), saved = await submissions(f), audits = await receipts(f);
      await expect(preview(f, randomUUID())).rejects.toMatchObject({ status: 404 });
      expect(await unchangedData(f)).toEqual(before); expect(await submissions(f)).toEqual(saved);
      expect(await receipts(f)).toEqual(audits);
    });

    it('keeps a manual submitted review without converting it to delegation', async () => {
      const f = await fixture({ studioSource: true });
      await db.storyWriterReview.update({ where: { id: f.review.id }, data: { state: 'submitted', revision: 6,
        submittedAt: new Date(), decisions: { humanReviewed: true } } });
      await db.storyFinalSubmission.create({ data: { reviewId: f.review.id, manuscriptVersionId: f.manuscript.id,
        checksum: f.manuscript.contentHash, idempotencyKey: `${fixturePrefix}manual:${randomUUID()}` } });
      const before = await unchangedData(f), saved = await submissions(f);
      expect((await preview(f)).review).toEqual({ reviewId: f.review.id, state: 'submitted', revision: 6 });
      expect(await receipts(f)).toEqual([]); expect(await submissions(f)).toEqual(saved);
      expect(await unchangedData(f)).toEqual(before);
    });

    it('preserves the current company preview when a second semantic run is rejected', async () => {
      const f = await fixture({ studioSource: true });
      const resolvedWarning = await createIssue(f, 'warning', 'resolved');
      const submitted = await f.submit();
      if (!submitted) throw new Error('Synthetic native company review was not eligible');
      const originalReceipts = await receipts(f);
      f.scope.auditIds.push(...originalReceipts.map(row => row.id));
      expect(originalReceipts).toHaveLength(1);
      const analysisId = randomUUID();
      f.scope.analysisIds.push(analysisId);
      const attemptedWrites: string[] = [];
      const continuityQueries: Prisma.StoryContinuityIssueFindManyArgs[] = [];
      const snapshot = async () => ({
        unchanged: await unchangedData(f),
        reviews: await db.storyWriterReview.findMany({ where: { workId: f.work.id, ownerUserId: f.owner.id }, orderBy: { id: 'asc' } }),
        analyses: await db.storyAnalysisJob.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } }),
        chunks: await db.storyAnalysisChunk.findMany({ where: { analysisJobId: { in: f.scope.analysisIds } }, orderBy: { id: 'asc' } }),
        profiles: await db.storyWorkGenerationProfile.findMany({ where: { workId: f.work.id, ownerUserId: f.owner.id }, orderBy: { id: 'asc' } }),
        submissions: await db.storyFinalSubmission.findMany({ where: { reviewId: { in: f.scope.reviewIds } }, orderBy: { id: 'asc' } }),
        audits: await db.auditEvent.findMany({ where: { actorUserId: f.owner.id }, orderBy: { id: 'asc' } }),
        issues: await db.storyContinuityIssue.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } }),
      });
      const before = await snapshot();
      // The SQL-only partial unique index forbids a second semantic ID even with analysisVersion 2.
      await expect(db.storyAnalysisJob.create({ data: { id: analysisId, workId: f.work.id,
        manuscriptVersionId: f.manuscript.id, analysisVersion: 2, actorUserId: f.owner.id,
        idempotencyKey: `${fixturePrefix}analysis:${randomUUID()}`, pipeline: 'semantic_extraction_v1',
        status: 'completed', phase: 'completed', sourceContentHash: f.manuscript.contentHash, sourceLocale: 'ko',
        sourceDigest: f.manuscript.contentHash, configHash: sha256(`synthetic-rejected-semantic-config:${analysisId}`),
        rateCardId: f.rateCard.id, totalParts: 1, totalParagraphs: 1,
        plannedParagraphs: 1, completedParagraphs: 1, plannedChunks: 1, completedChunks: 1,
        completedAt: new Date() } })).rejects.toMatchObject({ code: 'P2002', meta: { target: ['manuscript_version_id'] } });
      expect(await db.storyAnalysisJob.findUnique({ where: { id: analysisId } })).toBeNull();
      expect(await snapshot()).toEqual(before);
      const readOperations = new Set(['findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow',
        'findMany', 'count', 'aggregate', 'groupBy']);
      const delegates = new Map<PropertyKey, object>();
      const rejectWrite = (operation: string): never => {
        attemptedWrites.push(operation);
        throw new Error(`Read-only company preview attempted ${operation}`);
      };
      // Reads, including native authority validation, are forwarded unchanged to PostgreSQL.
      const previewDb = new Proxy(db, { get(target, model) {
        const delegate = Reflect.get(target, model, target);
        if (typeof delegate === 'function') {
          return (..._args: unknown[]) => rejectWrite(String(model));
        }
        if (!delegate || typeof delegate !== 'object' || typeof delegate.findMany !== 'function') return delegate;
        if (!delegates.has(model)) delegates.set(model, new Proxy(delegate, { get(delegateTarget, operation) {
          const execute = Reflect.get(delegateTarget, operation, delegateTarget);
          if (typeof execute !== 'function') return execute;
          return (...args: unknown[]) => {
            if (!readOperations.has(String(operation))) return rejectWrite(`${String(model)}.${String(operation)}`);
            if (model === 'storyContinuityIssue' && operation === 'findMany') {
              continuityQueries.push(args[0] as Prisma.StoryContinuityIssueFindManyArgs);
            }
            return Reflect.apply(execute, delegateTarget, args);
          };
        } }));
        return delegates.get(model);
      } });
      const result = await new StoryStudioLinearService(previewDb as never,
        new StoryStudioChoicePreparationService(previewDb as never)).preview(f.owner.id, f.work.id, f.manuscript.id);
      expect(result.analysisJobId).toBe(f.analysis.id);
      expect(result.review).toMatchObject({ reviewId: f.review.id, state: 'submitted', revision: 2,
        approvalBasis: 'company_delegation',
        companySubmission: { contract: COMPANY_FINAL_SUBMISSION_CONTRACT, scope: 'manuscript_submission',
          submissionId: submitted.submission.id, manuscriptVersionId: f.manuscript.id,
          manuscriptHash: f.manuscript.contentHash, analysisJobId: f.analysis.id, reviewRevision: 2,
          bindingHash: submitted.bindingHash, humanSemanticReview: false, published: false, generationStarted: false } });
      expect(continuityQueries).toHaveLength(2);
      for (const query of continuityQueries) expect(query.where).toEqual({ workId: f.work.id,
        analysisJobId: f.analysis.id, pathScope: 'author_original', pathKey: 'author_original', status: 'open' });
      expect(continuityQueries.find(query => query.select?.summary)).toMatchObject({
        select: { severity: true, summary: true }, orderBy: { createdAt: 'asc' } });
      expect(result.issues).toEqual([]);
      expect(result.consent).toBeNull();
      expect(attemptedWrites).toEqual([]);
      expect(before.reviews).toEqual([submitted.review]);
      expect(before.analyses).toEqual([f.analysis]);
      expect(before.profiles).toEqual([f.profile]);
      expect(before.issues).toEqual([resolvedWarning]);
      expect(before.submissions).toEqual([submitted.submission]);
      expect(await receipts(f)).toEqual(originalReceipts);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('company final submission completion hook', () => {
    async function missingReviewFixture(options: { recoverySource?: boolean } = {}) {
      const f = await fixture({ studioSource: true, ...options });
      // Remove only this case's generated, pristine review; retain the actual semantic/source rows.
      const removed = await db.storyWriterReview.deleteMany({ where: { id: f.review.id,
        workId: f.work.id, ownerUserId: f.owner.id, manuscriptVersionId: f.manuscript.id,
        analysisJobId: f.analysis.id, state: 'analysis_ready', revision: 1, submittedAt: null,
        decisions: { equals: {} }, finalSummary: { equals: {} } } });
      expect(removed.count).toBe(1);
      return f;
    }

    async function completionRows(f: Fixture) {
      const reviews = await db.storyWriterReview.findMany({ where: { workId: f.work.id,
        ownerUserId: f.owner.id, manuscriptVersionId: f.manuscript.id }, orderBy: { id: 'asc' } });
      for (const row of reviews) if (!f.scope.reviewIds.includes(row.id)) f.scope.reviewIds.push(row.id);
      const saved = await db.storyFinalSubmission.findMany({ where: { manuscriptVersionId: f.manuscript.id,
        reviewId: { in: reviews.map(row => row.id) } }, orderBy: { id: 'asc' } });
      const audits = await db.auditEvent.findMany({ where: { actorUserId: f.owner.id,
        action: COMPANY_FINAL_SUBMISSION_ACTION, targetType: 'story_final_submission',
        targetId: { in: saved.map(row => row.id) } }, orderBy: { id: 'asc' } });
      for (const row of audits) if (!f.scope.auditIds.includes(row.id)) f.scope.auditIds.push(row.id);
      return { reviews, submissions: saved, audits };
    }

    async function complete(f: Fixture) {
      try {
        return await service.autoSubmitCompletedAnalysis(f.owner.id, f.work.id, f.manuscript.id, f.analysis.id);
      } finally { await completionRows(f); }
    }

    const completionSnapshot = async (f: Fixture) => ({
      unchanged: await unchangedData(f),
      ...await completionRows(f),
      analyses: await db.storyAnalysisJob.findMany({ where: { workId: f.work.id,
        manuscriptVersionId: f.manuscript.id }, orderBy: { id: 'asc' } }),
      profiles: await db.storyWorkGenerationProfile.findMany({ where: { workId: f.work.id,
        ownerUserId: f.owner.id }, orderBy: { id: 'asc' } }),
      issues: await db.storyContinuityIssue.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } }),
      intakeAudit: await db.auditEvent.findUniqueOrThrow({ where: { id: f.intakeAudit.id } }),
    });

    it('creates one missing review, revision-2 submission and system receipt atomically', async () => {
      const f = await missingReviewFixture(), before = await unchangedData(f);
      expect((await completionRows(f)).reviews).toEqual([]);
      const result = await complete(f);
      if (!result) throw new Error('Synthetic native completion did not submit the missing review');
      expect(result).toMatchObject({ approvalBasis: 'company_delegation', idempotentReplay: false,
        review: { workId: f.work.id, ownerUserId: f.owner.id, manuscriptVersionId: f.manuscript.id,
          analysisJobId: f.analysis.id, state: 'submitted', revision: 2, decisions: {}, finalSummary: {} },
        submission: { manuscriptVersionId: f.manuscript.id, checksum: f.manuscript.contentHash,
          idempotencyKey: `story-company-final-v1:${result.bindingHash}` } });
      expect(result.review.id).not.toBe(f.review.id);
      expect(result.review.submittedAt).toBeInstanceOf(Date);
      const saved = await completionRows(f);
      expect(saved.reviews).toEqual([result.review]);
      expect(saved.submissions).toEqual([result.submission]);
      expect(saved.audits).toHaveLength(1);
      expect(saved.audits[0]).toMatchObject({ actorUserId: f.owner.id, actorType: 'system',
        action: COMPANY_FINAL_SUBMISSION_ACTION, targetType: 'story_final_submission', targetId: result.submission.id,
        beforeData: { state: 'analysis_ready', revision: 1 }, afterData: { state: 'submitted', revision: 2 },
        metadata: { contract: COMPANY_FINAL_SUBMISSION_CONTRACT, scope: 'manuscript_submission',
          approvalBasis: 'company_delegation', bindingHash: result.bindingHash,
          humanSemanticReview: false, publication: false, sharedReuse: false,
          binding: { reviewId: result.review.id, manuscriptVersionId: f.manuscript.id,
            manuscriptHash: f.manuscript.contentHash, beforeReviewRevision: 1, submittedReviewRevision: 2,
            analysisPin: { id: f.analysis.id }, profilePin: { id: f.profile.id },
            source: { companyPrivateIntakeJobId: f.intake.id, companyPrivateIntakeAuditId: f.intakeAudit.id } } } });
      expect(await currentAuthority({ ...f, review: result.review })).toMatchObject({
        approvalBasis: 'company_delegation', bindingHash: result.bindingHash });
      expect(before.consent).toBeNull();
      expect(await unchangedData(f)).toEqual(before);
    });

    it('reuses the same pristine review and replays without another submission or audit', async () => {
      const f = await fixture({ studioSource: true }), before = await unchangedData(f);
      const first = await complete(f);
      if (!first) throw new Error('Synthetic native completion did not submit the existing review');
      expect(first.review.id).toBe(f.review.id);
      expect(first.idempotentReplay).toBe(false);
      const saved = await completionSnapshot(f);
      expect(await complete(f)).toMatchObject({ idempotentReplay: true, bindingHash: first.bindingHash,
        review: { id: f.review.id, revision: 2 }, submission: { id: first.submission.id } });
      expect(saved.reviews).toHaveLength(1);
      expect(saved.submissions).toHaveLength(1);
      expect(saved.audits).toHaveLength(1);
      expect(await completionSnapshot(f)).toEqual(saved);
      expect(await unchangedData(f)).toEqual(before);
    });

    it('serializes completion with openReview on the same pristine review and keeps one current receipt', async () => {
      const f = await fixture({ studioSource: true }), before = await unchangedData(f);
      const { StoryLifecycleService } = await import('./story-lifecycle.service');
      const lifecycle = new StoryLifecycleService(db as never, undefined, undefined, service);
      const outcomes = await Promise.allSettled([complete(f), lifecycle.openReview(f.owner.id, f.work.id,
        { manuscriptVersionId: f.manuscript.id, analysisJobId: f.analysis.id })]);
      const saved = await completionRows(f);
      let successes = 0;
      for (const outcome of outcomes) {
        if (outcome.status === 'fulfilled') {
          expect(outcome.value).toMatchObject({ approvalBasis: 'company_delegation' });
          successes++;
        } else {
          const reason = outcome.reason as { code?: string; meta?: { code?: string }; response?: { code?: string } };
          expect(reason.code === 'P2034' || (reason.code === 'P2010' && reason.meta?.code === '40001') ||
            reason.response?.code === 'COMPANY_FINAL_REVIEW_CHANGED').toBe(true);
        }
      }
      expect(successes).toBeGreaterThanOrEqual(1);
      expect(saved.reviews).toHaveLength(1);
      expect(saved.reviews[0]).toMatchObject({ id: f.review.id, state: 'submitted', revision: 2,
        decisions: {}, finalSummary: {} });
      expect(saved.submissions).toHaveLength(1);
      expect(saved.audits).toHaveLength(1);
      expect(await complete(f)).toMatchObject({ idempotentReplay: true,
        review: { id: f.review.id, revision: 2 }, submission: { id: saved.submissions[0].id },
        bindingHash: (saved.audits[0].metadata as Record<string, unknown>).bindingHash });
      expect(await completionRows(f)).toEqual(saved);
      expect(await currentAuthority(f)).toMatchObject({ approvalBasis: 'company_delegation' });
      expect(await unchangedData(f)).toEqual(before);
    });

    it.each(['ordinary author', 'missing native proof', 'touched legacy history', 'open warning',
      'changed approved profile'])('does not create a missing current review with %s', async condition => {
      const f = await missingReviewFixture();
      if (condition === 'ordinary author') await db.storyWork.update({ where: { id: f.work.id },
        data: { authorDisplayName: 'Synthetic ordinary author' } });
      if (condition === 'missing native proof') await db.auditEvent.update({ where: { id: f.intakeAudit.id },
        data: { actorType: 'user' } });
      if (condition === 'touched legacy history') {
        const analysisId = randomUUID(), reviewId = randomUUID();
        f.scope.analysisIds.push(analysisId);
        f.scope.reviewIds.push(reviewId);
        // Legacy history is permitted beside the single semantic run; this is not semantic B.
        await db.storyAnalysisJob.create({ data: { id: analysisId, workId: f.work.id,
          manuscriptVersionId: f.manuscript.id, analysisVersion: 2, pipeline: 'structural_legacy',
          idempotencyKey: `${fixturePrefix}legacy-history:${randomUUID()}`, status: 'completed' } });
        await db.storyWriterReview.create({ data: { id: reviewId, workId: f.work.id, ownerUserId: f.owner.id,
          manuscriptVersionId: f.manuscript.id, analysisJobId: analysisId, state: 'editing',
          decisions: { humanReviewed: true } } });
      }
      if (condition === 'open warning') await createIssue(f, 'warning');
      if (condition === 'changed approved profile') await db.storyWorkGenerationProfile.update({ where: { id: f.profile.id },
        data: { approvedFingerprint: sha256('synthetic changed completion profile') } });
      const before = await completionSnapshot(f);
      expect(await complete(f)).toBeNull();
      expect(await completionSnapshot(f)).toEqual(before);
      const saved = await completionRows(f);
      expect(saved.reviews.filter(row => row.analysisJobId === f.analysis.id)).toEqual([]);
      expect(saved.submissions).toEqual([]);
      expect(saved.audits).toEqual([]);
    });

    it('rolls back the new review and submission when PostgreSQL rejects the audit insert', async () => {
      const f = await missingReviewFixture(), before = await completionSnapshot(f);
      const failure = await installAuditFailure(f);
      try {
        await expect(complete(f)).rejects.toThrow(/Synthetic company final audit failure/);
        expect(await completionSnapshot(f)).toEqual(before);
        expect(await db.storyFinalSubmission.count({ where: { manuscriptVersionId: f.manuscript.id } })).toBe(0);
        expect(await db.auditEvent.count({ where: { actorUserId: f.owner.id } })).toBe(1);
      } finally { await dropOwnedTrigger(failure); }
      const retry = await complete(f);
      expect(retry).toMatchObject({ idempotentReplay: false, review: { state: 'submitted', revision: 2 } });
      const saved = await completionRows(f);
      expect(saved.reviews).toHaveLength(1);
      expect(saved.submissions).toHaveLength(1);
      expect(saved.audits).toHaveLength(1);
      expect(await unchangedData(f)).toEqual(before.unchanged);
    });

    it.each(['profile revision', 'receipt metadata'])('does not refresh an existing receipt after stale %s', async changed => {
      const f = await missingReviewFixture();
      const first = await complete(f);
      if (!first) throw new Error('Synthetic native completion did not create the initial receipt');
      const original = await completionRows(f);
      if (changed === 'profile revision') await db.storyWorkGenerationProfile.update({ where: { id: f.profile.id },
        data: { reviewRevision: { increment: 1 } } });
      else await changeAuditMetadata(original.audits[0].id, { publication: true });
      const before = await completionSnapshot(f);
      await expect(complete(f)).rejects.toMatchObject({ response: { code: 'COMPANY_FINAL_SUBMISSION_CHANGED' } });
      expect(await completionSnapshot(f)).toEqual(before);
      expect(before.reviews).toEqual(original.reviews);
      expect(before.submissions).toEqual(original.submissions);
      expect(before.audits).toHaveLength(1);
      if (changed === 'profile revision') expect(before.audits).toEqual(original.audits);
    });

    describe('pending company profile bootstrap submission connection', () => {
      async function assertNoPriorPendingCandidates() {
        const [row] = await db.$queryRaw<{ count: number }[]>(Prisma.sql`
          SELECT count(*)::int AS count FROM story_work_generation_profiles AS profile
          JOIN story_works AS work ON work.id = profile.work_id AND work.owner_user_id = profile.owner_user_id
          WHERE profile.status IN (${'approved'}, ${'needs_review'}) AND work.author_display_name = ${'루미나'}
            AND work.fixture_source = false
        `);
        expect(row.count).toBe(0);
      }

      async function pendingProfileFixture() {
        const f = await missingReviewFixture();
        const evidence = await db.storyAnalysisEvidence.create({ data: { analysisJobId: f.analysis.id,
          provenance: 'semantic_candidate', evidenceType: 'style', sourcePartKey: 'synthetic-part-1',
          sourceParagraphIndex: 0, payload: { title: 'Synthetic rhythm', observation: 'Synthetic short rhythm.' } } });
        const settings = normalizeCreatorGenerationProfile('story', { ...f.settings,
          sections: f.settings.sections.map(section => ({ ...section, decision: 'proposed',
            value: section.key === 'writing_style' ? { ...section.value, observations: [{
              title: 'Synthetic rhythm', detail: 'Synthetic short rhythm.', sourceRef: `analysis:${evidence.id}`,
            }] } : section.value })) });
        await db.storyWorkGenerationProfile.update({ where: { id: f.profile.id }, data: { status: 'needs_review',
          reviewRevision: 0, draftSettings: settings as unknown as Prisma.InputJsonValue,
          draftFingerprint: creatorGenerationProfileFingerprint(f.profile.sourceFingerprint, settings),
          approvedSettings: Prisma.DbNull, approvedFingerprint: null, approvedByUserId: null, approvedAt: null } });
        return f;
      }

      async function bootPending(fixtures: Fixture[], bothHooks = false, conflicts: string[] = []) {
        const company = new StoryCompanyFinalSubmissionService(db as never);
        const profile = new StoryGenerationProfileService(db as never, company);
        const original = company.autoSubmitCompletedAnalysis.bind(company);
        const submission = jest.spyOn(company, 'autoSubmitCompletedAnalysis').mockImplementation(async (...args) => {
          try { return await original(...args); }
          catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError) {
              conflicts.push(`${error.code}:${typeof error.meta?.code === 'string' ? error.meta.code : ''}`);
            }
            throw error;
          }
        });
        const warnings: string[] = [];
        const profileWarn = jest.spyOn((profile as any).logger, 'warn').mockImplementation(message => { warnings.push(String(message)); });
        const companyWarn = jest.spyOn((company as any).logger, 'warn').mockImplementation(message => { warnings.push(String(message)); });
        try {
          if (bothHooks) company.onApplicationBootstrap();
          profile.onApplicationBootstrap();
          await Promise.all([(profile as any).bootstrapRecovery, (company as any).bootstrapRecovery]);
          return warnings;
        } finally {
          await profile.beforeApplicationShutdown();
          await company.beforeApplicationShutdown();
          submission.mockRestore();
          profileWarn.mockRestore(); companyWarn.mockRestore();
          for (const f of fixtures) {
            await completionRows(f);
            const audits = await db.auditEvent.findMany({ where: { actorUserId: f.owner.id,
              action: 'story_generation_profile.company_auto_approved', targetId: f.profile.id }, select: { id: true } });
            for (const audit of audits) if (!f.scope.auditIds.includes(audit.id)) f.scope.auditIds.push(audit.id);
          }
        }
      }

      async function stableBeyondApproval(f: Fixture) {
        const { profile: _profile, work, ...rest } = await unchangedData(f);
        const { updatedAt: _updatedAt, ...stableWork } = work;
        return { work: stableWork, ...rest };
      }

      it('connects current pending company approval to one submitted receipt even with both startup hooks', async () => {
        await assertNoPriorPendingCandidates();
        const f = await pendingProfileFixture(), before = await stableBeyondApproval(f);
        const conflicts: string[] = [];
        const warnings = await bootPending([f], true, conflicts);
        expect(warnings.every(warning => warning.endsWith('PrismaClientKnownRequestError'))).toBe(true);
        expect(conflicts.every(code => ['P2034:', 'P2010:40001'].includes(code))).toBe(true);
        const profile = await db.storyWorkGenerationProfile.findUniqueOrThrow({ where: { id: f.profile.id } });
        expect(profile).toMatchObject({ status: 'approved', reviewRevision: 1, approvedByUserId: f.owner.id });
        const saved = await completionRows(f);
        expect(saved.reviews).toHaveLength(1); expect(saved.submissions).toHaveLength(1); expect(saved.audits).toHaveLength(1);
        expect(saved.reviews[0]).toMatchObject({ state: 'submitted', revision: 2, decisions: {}, finalSummary: {} });
        expect(await db.auditEvent.count({ where: { actorUserId: f.owner.id,
          action: 'story_generation_profile.company_auto_approved', targetId: f.profile.id } })).toBe(1);
        expect(await db.storyMemoryRecord.count({ where: { workId: f.work.id, analysisJobId: f.analysis.id,
          provenance: 'writer_approved_semantic', status: 'approved' } })).toBe(1);
        expect(await stableBeyondApproval(f)).toEqual(before);
        await bootPending([f], true);
        expect(await completionRows(f)).toEqual(saved);
        expect(await db.storyWorkGenerationProfile.findUniqueOrThrow({ where: { id: f.profile.id } })).toEqual(profile);
        expect(await stableBeyondApproval(f)).toEqual(before);
      });

      it('preserves an approved profile when submission audit fails and later recovers without another approval', async () => {
        await assertNoPriorPendingCandidates();
        const f = await pendingProfileFixture(), before = await stableBeyondApproval(f);
        const failure = await installAuditFailure(f);
        try {
          const warnings = await bootPending([f]);
          expect(warnings.length).toBeGreaterThan(0);
          expect(JSON.stringify(warnings)).not.toContain(f.owner.id);
          expect(JSON.stringify(warnings)).not.toContain('Synthetic company final audit failure');
          expect(await db.storyWorkGenerationProfile.findUniqueOrThrow({ where: { id: f.profile.id } }))
            .toMatchObject({ status: 'approved', reviewRevision: 1 });
          expect(await completionRows(f)).toEqual({ reviews: [], submissions: [], audits: [] });
          expect(await stableBeyondApproval(f)).toEqual(before);
        } finally { await dropOwnedTrigger(failure); }
        await bootPending([f], true);
        const saved = await completionRows(f);
        expect(saved.submissions).toHaveLength(1); expect(saved.audits).toHaveLength(1);
        expect(await db.auditEvent.count({ where: { actorUserId: f.owner.id,
          action: 'story_generation_profile.company_auto_approved', targetId: f.profile.id } })).toBe(1);
        expect(await db.storyMemoryRecord.count({ where: { workId: f.work.id, analysisJobId: f.analysis.id } })).toBe(1);
        expect(await stableBeyondApproval(f)).toEqual(before);
      });

      it('preserves ordinary author manually revised and unproven company profiles without submission', async () => {
        await assertNoPriorPendingCandidates();
        const ordinary = await pendingProfileFixture(), manual = await pendingProfileFixture(), missing = await pendingProfileFixture();
        await db.storyWork.update({ where: { id: ordinary.work.id }, data: { authorDisplayName: 'Synthetic ordinary author' } });
        await db.storyWorkGenerationProfile.update({ where: { id: manual.profile.id }, data: { reviewRevision: 1 } });
        await db.auditEvent.update({ where: { id: missing.intakeAudit.id }, data: { actorType: 'user' } });
        const all = [ordinary, manual, missing], before = await Promise.all(all.map(unchangedData));
        expect(await bootPending(all, true)).toEqual([]);
        expect(await Promise.all(all.map(unchangedData))).toEqual(before);
        for (const f of all) expect(await completionRows(f)).toEqual({ reviews: [], submissions: [], audits: [] });
      });

      describe('native company recovery microsecond pagination', () => {
        const timestamp = '2026-10-05 07:00:00.123456+00';
        type NativeProfile = { id: string; createdAt: string; expectedCreatedAt: string };
        type NativePage = { rows: { id: string; createdAt: string }[]; values: unknown[]; sql: string };

        async function seedSameTimestampProfiles(f: Fixture) {
          const original = await db.storyWorkGenerationProfile.findUniqueOrThrow({ where: { id: f.profile.id } });
          const ids = Array.from({ length: 100 }, () => randomUUID());
          f.scope.profileIds.push(...ids);
          const created = await db.storyWorkGenerationProfile.createMany({ data: ids.map((id, index) => ({
            id, workId: original.workId, ownerUserId: original.ownerUserId,
            manuscriptVersionId: original.manuscriptVersionId, analysisJobId: original.analysisJobId,
            sourceFingerprint: original.sourceFingerprint, profileVersion: index + 2,
            status: original.status, reviewRevision: original.reviewRevision,
            draftSettings: original.draftSettings as Prisma.InputJsonValue, draftFingerprint: original.draftFingerprint,
            approvedSettings: original.approvedSettings === null ? Prisma.DbNull : original.approvedSettings as Prisma.InputJsonValue,
            approvedFingerprint: original.approvedFingerprint, approvedByUserId: original.approvedByUserId,
            approvedAt: original.approvedAt, analysisErrorCode: original.analysisErrorCode,
          })) });
          expect(created.count).toBe(100);
          expect(await db.$executeRaw(Prisma.sql`
            UPDATE story_work_generation_profiles SET created_at = ${timestamp}::timestamptz
            WHERE work_id = ${f.work.id}::uuid AND owner_user_id = ${f.owner.id}::uuid
              AND id IN (${Prisma.join(f.scope.profileIds.map(id => Prisma.sql`${id}::uuid`))})
          `)).toBe(101);
          const native = await nativeProfiles(f);
          expect(native).toHaveLength(101);
          expect(new Set(native.map(row => row.id)).size).toBe(101);
          for (const row of native) {
            expect(row.createdAt).toBe(row.expectedCreatedAt);
            expect(row.createdAt).toContain('.123456');
          }
          return native;
        }

        async function nativeProfiles(f: Fixture) {
          return db.$queryRaw<NativeProfile[]>(Prisma.sql`
            SELECT id, created_at::text AS "createdAt", ${timestamp}::timestamptz::text AS "expectedCreatedAt"
            FROM story_work_generation_profiles
            WHERE work_id = ${f.work.id}::uuid AND owner_user_id = ${f.owner.id}::uuid
              AND id IN (${Prisma.join(f.scope.profileIds.map(id => Prisma.sql`${id}::uuid`))})
            ORDER BY created_at ASC, id ASC
          `);
        }

        async function paginationSnapshot(f: Fixture) {
          return {
            unchanged: await unchangedData(f),
            profiles: await db.storyWorkGenerationProfile.findMany({ where: { workId: f.work.id, ownerUserId: f.owner.id },
              orderBy: { id: 'asc' } }),
            nativeProfiles: await nativeProfiles(f),
            completion: await completionRows(f),
            audits: await db.auditEvent.findMany({ where: { actorUserId: f.owner.id }, orderBy: { id: 'asc' } }),
            memories: await db.storyMemoryRecord.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } }),
            evidence: await db.storyAnalysisEvidence.findMany({ where: { analysisJobId: { in: f.scope.analysisIds } },
              orderBy: { id: 'asc' } }),
          };
        }

        async function runNativePagination(f: Fixture, kind: 'pending' | 'approved') {
          const pages: NativePage[] = [];
          const actualDb = new Proxy(db, { get(target, key, receiver) {
            if (key === '$queryRaw') return async (query: Prisma.Sql) => {
              const rows = await target.$queryRaw<{ id: string; createdAt: string }[]>(query);
              pages.push({ rows: rows.map(row => ({ id: row.id, createdAt: row.createdAt })),
                values: [...query.values], sql: query.sql });
              return rows;
            };
            const value = Reflect.get(target, key, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
          } });
          const company = new StoryCompanyFinalSubmissionService(actualDb as never);
          const profile = new StoryGenerationProfileService(actualDb as never, company);
          // Spies observe the original methods, including their real SQL authority checks.
          const approve = jest.spyOn(profile, 'autoApproveCompany');
          const submit = jest.spyOn(company, 'autoSubmitCompletedAnalysis');
          const warnings: string[] = [];
          const profileWarn = jest.spyOn((profile as any).logger, 'warn').mockImplementation(message => { warnings.push(String(message)); });
          const companyWarn = jest.spyOn((company as any).logger, 'warn').mockImplementation(message => { warnings.push(String(message)); });
          const bootstrap = kind === 'pending' ? profile : company;
          try {
            bootstrap.onApplicationBootstrap();
            const pending = (bootstrap as any).bootstrapRecovery;
            expect(pending).toBeInstanceOf(Promise);
            await pending;
            expect(warnings).toEqual([]);
            expect(approve).toHaveBeenCalledTimes(kind === 'pending' ? 101 : 0);
            expect(submit).toHaveBeenCalledTimes(kind === 'approved' ? 101 : 0);
            for (const args of approve.mock.calls) expect(args).toEqual([f.owner.id, f.work.id,
              { manuscriptVersionId: f.manuscript.id, analysisJobId: f.analysis.id }]);
            for (const args of submit.mock.calls) expect(args).toEqual([f.owner.id, f.work.id, f.manuscript.id, f.analysis.id]);
            for (const result of [...approve.mock.results, ...submit.mock.results]) {
              expect(result.type).toBe('return');
              expect(await result.value).toBeNull();
            }
            return pages;
          } finally {
            try {
              await profile.beforeApplicationShutdown();
              await company.beforeApplicationShutdown();
            } finally {
              approve.mockRestore(); submit.mockRestore(); profileWarn.mockRestore(); companyWarn.mockRestore();
              await completionRows(f);
              const audits = await db.auditEvent.findMany({ where: { actorUserId: f.owner.id }, select: { id: true } });
              for (const audit of audits) if (!f.scope.auditIds.includes(audit.id)) f.scope.auditIds.push(audit.id);
            }
          }
        }

        function expectNativePages(pages: NativePage[], native: NativeProfile[], f: Fixture, status: string) {
          expect(pages.map(page => page.rows.length)).toEqual([100, 1]);
          const orderedIds = native.map(row => row.id);
          const seenIds = pages.flatMap(page => page.rows.map(row => row.id));
          expect(pages[0].rows.map(row => row.id)).toEqual(orderedIds.slice(0, 100));
          expect(pages[1].rows.map(row => row.id)).toEqual(orderedIds.slice(100));
          expect(seenIds).toEqual(orderedIds);
          expect(new Set(seenIds).size).toBe(101);
          const sourceValues = [status, f.work.authorDisplayName, ...(status === 'approved' ? [f.work.status] : [])];
          expect(pages[0].values).toEqual([...sourceValues, 100]);
          expect(pages[0].sql).not.toContain('(profile.created_at, profile.id) >');
          expect(pages[1].values).toEqual([...sourceValues, native[99].createdAt, native[99].id, 100]);
          expect(pages[1].sql).toContain('(profile.created_at, profile.id) >');
          for (const page of pages) {
            expect(page.sql).toContain('profile.created_at::text AS "createdAt"');
            expect(page.sql).toContain('ORDER BY profile.created_at ASC, profile.id ASC');
            for (const row of page.rows) expect(row.createdAt).toBe(native[0].expectedCreatedAt);
          }
        }

        it('paginates 101 manually revised native pending profiles with the exact microsecond cursor without writes', async () => {
          await assertNoPriorPendingCandidates();
          const f = await pendingProfileFixture();
          await db.storyWorkGenerationProfile.update({ where: { id: f.profile.id }, data: { reviewRevision: 1 } });
          const native = await seedSameTimestampProfiles(f), before = await paginationSnapshot(f);
          expect(before.profiles).toHaveLength(101);
          expect(before.profiles.map(row => row.profileVersion).sort((a, b) => a - b))
            .toEqual(Array.from({ length: 101 }, (_, index) => index + 1));
          for (const row of before.profiles) expect(row).toMatchObject({ status: 'needs_review', reviewRevision: 1,
            approvedSettings: null, approvedFingerprint: null, approvedByUserId: null, approvedAt: null });
          expect(before.completion).toEqual({ reviews: [], submissions: [], audits: [] });
          expect(before.audits).toHaveLength(1);
          expect(before.memories).toEqual([]);
          expectNativePages(await runNativePagination(f, 'pending'), native, f, 'needs_review');
          expect(await paginationSnapshot(f)).toEqual(before);
        });

        it('paginates 101 approved native profiles with an editing review and the exact microsecond cursor without writes', async () => {
          await assertNoPriorPendingCandidates();
          const f = await fixture({ studioSource: true });
          await db.storyWriterReview.update({ where: { id: f.review.id }, data: { state: 'editing' } });
          const native = await seedSameTimestampProfiles(f), before = await paginationSnapshot(f);
          expect(before.profiles).toHaveLength(101);
          expect(before.profiles.map(row => row.profileVersion).sort((a, b) => a - b))
            .toEqual(Array.from({ length: 101 }, (_, index) => index + 1));
          for (const row of before.profiles) expect(row).toMatchObject({ status: 'approved', reviewRevision: 1,
            approvedSettings: f.profile.approvedSettings, approvedFingerprint: f.profile.approvedFingerprint,
            approvedByUserId: f.profile.approvedByUserId, approvedAt: f.profile.approvedAt });
          expect(before.completion.reviews).toHaveLength(1);
          expect(before.completion.reviews[0]).toMatchObject({ id: f.review.id, state: 'editing', revision: 1 });
          expect(before.completion.submissions).toEqual([]); expect(before.completion.audits).toEqual([]);
          expect(before.audits).toHaveLength(1);
          expect(before.memories).toEqual([]);
          expectNativePages(await runNativePagination(f, 'approved'), native, f, 'approved');
          expect(await paginationSnapshot(f)).toEqual(before);
        });
      });
    });

    describe('already approved company submission bootstrap recovery', () => {
      async function bootWithOwnedRows(fixtures: Fixture[]) {
        const bootstrap = new StoryCompanyFinalSubmissionService(db as never);
        const warn = jest.spyOn((bootstrap as any).logger, 'warn').mockImplementation(() => undefined);
        try {
          bootstrap.onApplicationBootstrap();
          await (bootstrap as any).bootstrapRecovery;
          return warn.mock.calls.map(args => String(args[0]));
        }
        finally {
          await bootstrap.beforeApplicationShutdown();
          warn.mockRestore();
          for (const f of fixtures) await completionRows(f);
        }
      }

      async function assertNoPriorCandidates() {
        const [row] = await db.$queryRaw<{ count: number }[]>(Prisma.sql`
          SELECT count(*)::int AS count FROM story_work_generation_profiles AS profile
          JOIN story_works AS work ON work.id = profile.work_id AND work.owner_user_id = profile.owner_user_id
          WHERE profile.status = ${'approved'} AND work.author_display_name = ${'루미나'}
            AND work.fixture_source = false AND work.status = ${'draft'}
        `);
        expect(row.count).toBe(0);
      }

      it('restores only a current company submission and preserves manual warnings and missing native proof', async () => {
        await assertNoPriorCandidates();
        const current = await missingReviewFixture(), manual = await fixture({ studioSource: true }),
          warning = await missingReviewFixture(), missingProof = await missingReviewFixture(),
          ordinary = await missingReviewFixture();
        const all = [current, manual, warning, missingProof, ordinary];
        await db.storyWriterReview.update({ where: { id: manual.review.id }, data: {
          state: 'editing', decisions: { humanReviewed: true } } });
        await createIssue(warning, 'warning');
        await db.auditEvent.update({ where: { id: missingProof.intakeAudit.id }, data: { actorType: 'user' } });
        await db.storyWork.update({ where: { id: ordinary.work.id }, data: { authorDisplayName: 'Synthetic ordinary author' } });
        const before = await Promise.all(all.map(unchangedData));
        await bootWithOwnedRows(all);
        const saved = await Promise.all(all.map(completionRows));
        expect(saved[0].reviews).toHaveLength(1);
        expect(saved[0].reviews[0]).toMatchObject({ state: 'submitted', revision: 2, decisions: {}, finalSummary: {} });
        expect(saved[0].submissions).toHaveLength(1);
        expect(saved[0].audits).toHaveLength(1);
        expect(saved[1].reviews).toHaveLength(1);
        expect(saved[1].reviews[0]).toMatchObject({ state: 'editing', decisions: { humanReviewed: true } });
        for (const blocked of saved.slice(1)) {
          expect(blocked.submissions).toEqual([]);
          expect(blocked.audits).toEqual([]);
        }
        expect(await Promise.all(all.map(unchangedData))).toEqual(before);
      });

      it('replays bootstrap without another review submission or company audit', async () => {
        await assertNoPriorCandidates();
        const f = await missingReviewFixture(), before = await unchangedData(f);
        await bootWithOwnedRows([f]);
        const saved = await completionRows(f);
        expect(saved.reviews).toHaveLength(1);
        expect(saved.submissions).toHaveLength(1);
        expect(saved.audits).toHaveLength(1);
        await bootWithOwnedRows([f]);
        expect(await completionRows(f)).toEqual(saved);
        expect(await unchangedData(f)).toEqual(before);
        expect(await currentAuthority({ ...f, review: saved.reviews[0] })).toMatchObject({
          approvalBasis: 'company_delegation' });
      });

      it('retains an atomic failed receipt while continuing the next already approved company work', async () => {
        await assertNoPriorCandidates();
        const failed = await missingReviewFixture(), next = await missingReviewFixture();
        const before = await Promise.all([failed, next].map(unchangedData));
        const failure = await installAuditFailure(failed);
        try {
          const warnings = await bootWithOwnedRows([failed, next]);
          expect(await completionRows(failed)).toEqual({ reviews: [], submissions: [], audits: [] });
          const saved = await completionRows(next);
          expect(saved.reviews).toHaveLength(1);
          expect(saved.submissions).toHaveLength(1);
          expect(saved.audits).toHaveLength(1);
          expect(await Promise.all([failed, next].map(unchangedData))).toEqual(before);
          expect(warnings.length).toBeGreaterThan(0);
          expect(JSON.stringify(warnings)).not.toContain('Synthetic company final audit failure');
          expect(JSON.stringify(warnings)).not.toContain(failed.owner.id);
          expect(JSON.stringify(warnings)).not.toContain(failed.work.id);
        } finally { await dropOwnedTrigger(failure); }
      });
    });

    describe('company submission after explicit profile recovery', () => {
      async function recoveryFixture() {
        const f = await missingReviewFixture({ recoverySource: true });
        const provider = { readiness: jest.fn(), generate: jest.fn(), preflight: jest.fn() };
        const semantic = new SemanticAnalysisService(new SemanticAnalysisRepository(db as never), provider as never,
          new StoryGenerationProfileService(db as never), service);
        const warn = jest.spyOn((semantic as any).logger, 'warn').mockImplementation(() => undefined);
        async function recover() {
          try { return await semantic.recoverProfile(f.owner.id, f.analysis.id, f.manuscript.contentHash); }
          finally {
            await completionRows(f);
            const audits = await db.auditEvent.findMany({ where: { actorUserId: f.owner.id,
              targetId: f.analysis.id, action: 'story_analysis.profile_recovered' }, select: { id: true } });
            for (const audit of audits) if (!f.scope.auditIds.includes(audit.id)) f.scope.auditIds.push(audit.id);
          }
        }
        return { f, provider, warn, recover };
      }

      it('continues a recovered current company analysis and replays without provider calls', async () => {
        const { f, provider, recover } = await recoveryFixture();
        const { analysis: beforeAnalysis, ...unchanged } = await unchangedData(f);
        expect(await recover()).toMatchObject({ status: 'completed', approval: 'not_approved' });
        const saved = await completionRows(f);
        expect(saved.reviews).toHaveLength(1);
        expect(saved.reviews[0]).toMatchObject({ state: 'submitted', revision: 2, decisions: {}, finalSummary: {} });
        expect(saved.submissions).toHaveLength(1);
        expect(saved.audits).toHaveLength(1);
        expect(await currentAuthority({ ...f, review: saved.reviews[0] })).toMatchObject({
          approvalBasis: 'company_delegation' });
        const analysis = await db.storyAnalysisJob.findUniqueOrThrow({ where: { id: f.analysis.id } });
        expect(analysis).toMatchObject({ status: 'completed', phase: 'completed', leaseToken: null, errorCode: null });
        expect(analysis.configPins).toEqual(beforeAnalysis.configPins);
        expect(analysis.reservedInputTokens).toBe(beforeAnalysis.reservedInputTokens);
        expect(analysis.reservedCostKrw).toEqual(beforeAnalysis.reservedCostKrw);
        expect(analysis.actualCostKrw?.equals(0)).toBe(true);
        const audits = await db.auditEvent.findMany({ where: { actorUserId: f.owner.id,
          targetId: f.analysis.id, action: 'story_analysis.profile_recovered' } });
        expect(audits).toHaveLength(1);
        expect(await recover()).toMatchObject({ status: 'completed' });
        expect(await completionRows(f)).toEqual(saved);
        expect(await db.storyAnalysisJob.findUniqueOrThrow({ where: { id: f.analysis.id } })).toEqual(analysis);
        expect(await db.auditEvent.findMany({ where: { actorUserId: f.owner.id,
          targetId: f.analysis.id, action: 'story_analysis.profile_recovered' } })).toEqual(audits);
        const { analysis: _recoveredAnalysis, ...after } = await unchangedData(f);
        expect(after).toEqual(unchanged);
        for (const method of Object.values(provider)) expect(method).not.toHaveBeenCalled();
      });

      it('keeps an ordinary author recovery without a company submission', async () => {
        const { f, provider, recover } = await recoveryFixture();
        await db.storyWork.update({ where: { id: f.work.id }, data: { authorDisplayName: 'Synthetic ordinary author' } });
        const { analysis: beforeAnalysis, ...unchanged } = await unchangedData(f);
        expect(await recover()).toMatchObject({ status: 'completed', approval: 'not_approved' });
        expect(await completionRows(f)).toEqual({ reviews: [], submissions: [], audits: [] });
        const { analysis, ...after } = await unchangedData(f);
        expect(analysis).toMatchObject({ status: 'completed', phase: 'completed', errorCode: null });
        expect(analysis.configPins).toEqual(beforeAnalysis.configPins);
        expect(analysis.reservedCostKrw).toEqual(beforeAnalysis.reservedCostKrw);
        expect(after).toEqual(unchanged);
        for (const method of Object.values(provider)) expect(method).not.toHaveBeenCalled();
      });

      it('retains recovered analysis when the company receipt audit fails atomically', async () => {
        const { f, provider, warn, recover } = await recoveryFixture();
        const failure = await installAuditFailure(f);
        try {
          expect(await recover()).toMatchObject({ status: 'completed' });
          expect(await completionRows(f)).toEqual({ reviews: [], submissions: [], audits: [] });
          expect(await db.storyAnalysisJob.findUniqueOrThrow({ where: { id: f.analysis.id } }))
            .toMatchObject({ status: 'completed', errorCode: null });
          expect(await db.auditEvent.count({ where: { actorUserId: f.owner.id,
            targetId: f.analysis.id, action: 'story_analysis.profile_recovered' } })).toBe(1);
          expect(warn).toHaveBeenCalledTimes(1);
          expect(JSON.stringify(warn.mock.calls)).not.toContain('Synthetic company final audit failure');
          for (const method of Object.values(provider)) expect(method).not.toHaveBeenCalled();
        } finally { await dropOwnedTrigger(failure); warn.mockRestore(); }
      });
    });

    it('pairs missing-review completion with actual openReview without leaking database failures', async () => {
      const f = await missingReviewFixture(), before = await unchangedData(f);
      expect((await completionRows(f)).reviews).toEqual([]);
      const { StoryLifecycleService } = await import('./story-lifecycle.service');
      const lifecycle = new StoryLifecycleService(db as never, undefined, undefined, service);
      let releaseStart!: () => void;
      const start = new Promise<void>(resolve => { releaseStart = resolve; });
      const pending = [start.then(() => complete(f)), start.then(() => lifecycle.openReview(f.owner.id, f.work.id,
        { manuscriptVersionId: f.manuscript.id, analysisJobId: f.analysis.id }))];
      releaseStart();
      const outcomes = await Promise.allSettled(pending);
      const saved = await completionRows(f);
      expect(saved.reviews).toHaveLength(1);
      expect(saved.reviews[0]).toMatchObject({ workId: f.work.id, ownerUserId: f.owner.id,
        manuscriptVersionId: f.manuscript.id, analysisJobId: f.analysis.id, state: 'submitted', revision: 2,
        decisions: {}, finalSummary: {} });
      expect(saved.submissions).toHaveLength(1);
      expect(saved.audits).toHaveLength(1);
      const bindingHash = (saved.audits[0].metadata as Record<string, unknown>).bindingHash;
      let successes = 0;
      for (const [caller, outcome] of outcomes.entries()) {
        if (outcome.status === 'fulfilled') {
          successes++;
          expect(outcome.value).toMatchObject(caller === 0
            ? { approvalBasis: 'company_delegation', bindingHash,
              review: { id: saved.reviews[0].id, state: 'submitted', revision: 2 },
              submission: { id: saved.submissions[0].id } }
            : { reviewId: saved.reviews[0].id, state: 'submitted', revision: 2,
              approvalBasis: 'company_delegation', companySubmission: { submissionId: saved.submissions[0].id,
                analysisJobId: f.analysis.id, bindingHash, humanSemanticReview: false, published: false, generationStarted: false } });
        } else {
          const reason = outcome.reason as { code?: string; meta?: { code?: string };
            response?: { code?: string }; getStatus?: () => number };
          const status = reason.getStatus?.();
          const guardedConflict = status === 409 && ['COMPANY_FINAL_REVIEW_CHANGED',
            'COMPANY_FINAL_SUBMISSION_CHANGED'].includes(reason.response?.code ?? '');
          const guardedReconciliation = status === 503 && ['COMPANY_FINAL_REVIEW_UNCONFIRMED',
            'WRITER_REVIEW_OPEN_RETRY'].includes(reason.response?.code ?? '');
          // The internal hook may lose a Serializable snapshot; the POST must never leak raw Prisma/deadlock errors.
          const internalSerialization = caller === 0 && (reason.code === 'P2034' ||
            (reason.code === 'P2010' && reason.meta?.code === '40001'));
          expect(internalSerialization || guardedConflict || guardedReconciliation).toBe(true);
        }
      }
      expect(successes).toBeGreaterThanOrEqual(1);
      expect(await complete(f)).toMatchObject({ idempotentReplay: true, bindingHash,
        review: { id: saved.reviews[0].id, revision: 2 }, submission: { id: saved.submissions[0].id } });
      expect(await currentAuthority({ ...f, review: saved.reviews[0] })).toMatchObject({
        approvalBasis: 'company_delegation', bindingHash });
      expect(await completionRows(f)).toEqual(saved);
      expect(await unchangedData(f)).toEqual(before);
    });
  });
});

import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as companyFinalSubmission from './story-company-final-submission.policy';
import { prepareManuscript, storedManuscriptBody } from './story-manuscript-file.policy';
import { StoryStudioLinearService } from './story-studio-linear.service';
import { StoryStudioChoicePreparationService } from './story-studio-choice-preparation.service';

function fixture() {
  const ids = { owner: randomUUID(), work: randomUUID(), manuscript: randomUUID(), analysis: randomUUID(),
    review: randomUUID(), submission: randomUUID(), release: randomUUID(), consent: randomUUID(),
    part: randomUUID(), scene: randomUUID() };
  const text = 'The author keeps the original ending.';
  const prepared = prepareManuscript(Buffer.from(JSON.stringify({ locale: 'ko', parts: [
    { partKey: 'part-1', title: 'Original ending', paragraphs: [{ kind: 'paragraph', text }] },
  ] })));
  const manuscript = { id: ids.manuscript, workId: ids.work, ownerUserId: ids.owner,
    locale: 'ko', contentHash: prepared.contentHash, structuredBody: storedManuscriptBody(prepared) };
  const work = { id: ids.work, ownerUserId: ids.owner, status: 'draft', activeReleaseId: null,
    publishedAt: null, fixtureSource: false, title: { ko: 'Contract story' } };
  const review = { id: ids.review, workId: ids.work, ownerUserId: ids.owner,
    manuscriptVersionId: ids.manuscript, analysisJobId: ids.analysis, state: 'submitted', revision: 6,
    submittedAt: new Date('2026-10-05T00:00:00Z'),
    decisions: { warningAcknowledged: true } as Record<string, unknown>, finalSummary: {} };
  const submission = { id: ids.submission, reviewId: ids.review, manuscriptVersionId: ids.manuscript,
    checksum: manuscript.contentHash, status: 'submitted', idempotencyKey: 'manual-final-review' };
  const consent = { id: ids.consent, ownerUserId: ids.owner, manuscriptVersionId: ids.manuscript,
    status: 'active', rightsConfirmed: true, aiBranchAllowed: true, startsAt: new Date(0),
    expiresAt: null, allowedLocales: ['ko'], revision: 1 };
  const original = { id: randomUUID(), sceneId: ids.scene, choiceKey: 'author-original', position: 1,
    routeKind: 'writer_original', label: { ko: 'Keep the authored ending' }, targetSceneId: null,
    targetEndingKey: 'author_main', declaredRejoinSceneId: null };
  const release = { id: ids.release, workId: ids.work, manuscriptVersionId: ids.manuscript,
    status: 'candidate', validationSummary: { ready: false }, branchGraphSnapshot: {
      contract: 'studio-linear-v1', parts: [{ partKey: 'part-1', originalLabel: original.label.ko, nextPartKey: null }],
    } };
  const choices: any[] = [original];
  const auditRows: any[] = [];
  const db: any = {
    storyWork: { findFirst: jest.fn().mockResolvedValue(work) },
    storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue(manuscript),
      findUnique: jest.fn().mockResolvedValue(manuscript) },
    storyAnalysisJob: { findFirst: jest.fn().mockResolvedValue({ id: ids.analysis, status: 'completed',
      pipeline: 'semantic_extraction_v1', sourceContentHash: manuscript.contentHash, sourceLocale: 'ko',
      totalParagraphs: 1, completedParagraphs: 1 }) },
    storyWriterReview: { findFirst: jest.fn().mockResolvedValue(review) },
    storyFinalSubmission: { findUnique: jest.fn().mockResolvedValue(submission) },
    storyStyleProfileConsent: { findUnique: jest.fn().mockResolvedValue(consent) },
    storyAuthoredImport: { findUnique: jest.fn().mockResolvedValue(null) },
    storyContinuityIssue: { findMany: jest.fn().mockResolvedValue([]) },
    storyReaderProgress: { count: jest.fn().mockResolvedValue(0) },
    storyRelease: { findFirst: jest.fn(async ({ where }) => where.id ? release : null),
      create: jest.fn(async ({ data }) => ({ ...release, ...data })),
      update: jest.fn().mockResolvedValue(release) },
    storyPart: { count: jest.fn().mockResolvedValue(0), createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue({ id: ids.part, workId: ids.work, position: 1,
        status: 'draft', title: { ko: 'Original ending' } }),
      findMany: jest.fn().mockResolvedValue([{ id: ids.part, position: 1, status: 'draft' }]) },
    storyScene: { createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue({ id: ids.scene, partId: ids.part, status: 'draft' }),
      findMany: jest.fn().mockResolvedValue([{ id: ids.scene, partId: ids.part, status: 'draft' }]) },
    storyBeat: { createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([{ sceneId: ids.scene, content: { ko: text } }]) },
    storyChoice: { findMany: jest.fn(async () => choices), update: jest.fn(),
      createMany: jest.fn(async ({ data }) => { choices.push(...data); return { count: data.length }; }) },
    storyVisualPrompt: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn() },
    storyStudioChoiceJob: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    auditEvent: { findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn(async ({ where }) => auditRows.filter(row => row.action === where.action)),
      create: jest.fn(async ({ data }) => { const row = { id: randomUUID(), ...data }; auditRows.push(row); return row; }) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(async (run: (tx: unknown) => Promise<unknown>) => run(db)),
  };
  const choiceService = new StoryStudioChoicePreparationService(db as never);
  const linearService = new StoryStudioLinearService(db as never, choiceService);
  const provider = { modelName: 'test-choice-model', generate: jest.fn().mockResolvedValue([
    { partKey: 'part-1', alternatives: ['Keep the evidence private', 'Share the evidence'] },
  ]) };
  jest.spyOn(choiceService as any, 'provider').mockReturnValue(provider);
  const body = { manuscriptVersionId: ids.manuscript, expectedManuscriptHash: manuscript.contentHash,
    originalRoutesReviewed: true, originalRoutes: [{ partKey: 'part-1', label: original.label.ko }] };
  return { ids, manuscript, review, submission, consent, choices, auditRows, db,
    choiceService, linearService, provider, body };
}

type Fixture = ReturnType<typeof fixture>;
const consumers = ['materialize', 'finish', 'prepare', 'original-scene', 'publishable', 'prepared-scenes'] as const;
type Consumer = (typeof consumers)[number];

function consume(f: Fixture, consumer: Consumer): Promise<unknown> {
  const { ids } = f;
  switch (consumer) {
    case 'materialize': return f.linearService.materialize(ids.owner, ids.work, f.body);
    case 'finish': return f.linearService.finish(ids.owner, ids.work, ids.release);
    case 'prepare': return f.choiceService.prepare(ids.owner, ids.work, ids.release, ids.scene);
    case 'original-scene': return f.choiceService.assertOriginalSceneReadyTx(f.db, ids.owner, ids.work, ids.release, ids.scene);
    case 'publishable': return f.choiceService.assertPublishableTx(f.db, ids.work, ids.owner, ids.manuscript, ids.release);
    case 'prepared-scenes': return f.choiceService.assertPreparedScenesTx(f.db, ids.work, ids.owner, ids.manuscript,
      ids.release, [ids.scene]);
  }
}

function expectNoMaterialization(f: Fixture) {
  expect(f.db.storyRelease.create).not.toHaveBeenCalled();
  expect(f.db.storyRelease.update).not.toHaveBeenCalled();
  expect(f.db.storyPart.createMany).not.toHaveBeenCalled();
  expect(f.db.storyScene.createMany).not.toHaveBeenCalled();
  expect(f.db.storyBeat.createMany).not.toHaveBeenCalled();
  expect(f.db.storyChoice.createMany).not.toHaveBeenCalled();
  expect(f.db.storyChoice.update).not.toHaveBeenCalled();
  expect(f.db.storyVisualPrompt.createMany).not.toHaveBeenCalled();
  expect(f.db.storyStudioChoiceJob.create).not.toHaveBeenCalled();
  expect(f.provider.generate).not.toHaveBeenCalled();
}

describe('company final submission Studio consumer contract', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    { label: 'manual', key: 'manual-final-review' },
    { label: 'old prefix', key: 'story-company-final-v0:legacy' },
    { label: 'embedded prefix', key: 'manual:story-company-final-v1:legacy' },
    { label: 'missing fixture key', key: undefined },
    { label: 'null fixture key', key: null },
  ])('leaves non-company submission $label unchanged without requiring a company receipt', async ({ key }) => {
    const f = fixture();
    Object.assign(f.submission, { idempotencyKey: key });
    const guard = jest.spyOn(companyFinalSubmission, 'assertCompanyFinalSubmissionCurrent');
    const originalReview = JSON.stringify(f.review), originalSubmission = JSON.stringify(f.submission);
    await expect(consume(f, 'materialize')).resolves.toMatchObject({ idempotentReplay: false });
    // Materialization writes are separate from the already-materialized choice fixture.
    f.choices.splice(1);
    await expect(consume(f, 'original-scene')).resolves.toBeUndefined();
    await expect(consume(f, 'prepare')).resolves.toMatchObject({ choiceCount: 3, originalRoutePreserved: true });
    await expect(consume(f, 'prepared-scenes')).resolves.toBeUndefined();
    await expect(consume(f, 'finish')).resolves.toEqual({ releaseId: f.ids.release, ready: true, published: false });
    await expect(consume(f, 'publishable')).resolves.toEqual({ partIds: [f.ids.part], sceneIds: [f.ids.scene] });
    expect(guard).toHaveBeenCalledTimes(8);
    for (const call of guard.mock.calls) expect(call).toEqual([f.db, { ownerUserId: f.ids.owner,
      workId: f.ids.work, review: f.review, manuscript: f.manuscript, submission: f.submission }]);
    expect(JSON.stringify(f.review)).toBe(originalReview);
    expect(JSON.stringify(f.submission)).toBe(originalSubmission);
    expect(f.db.auditEvent.findFirst).not.toHaveBeenCalled();
  });

  describe.each(['invalid server receipt', 'stale current binding'])('%s', reason => {
    it.each(consumers)('blocks %s and preserves the policy rejection', async consumer => {
      const f = fixture();
      f.submission.idempotencyKey = `story-company-final-v1:${f.ids.submission}`;
      // Policy validity is parent-owned; consumers must await and propagate its rejection.
      const rejection = new ConflictException({ code: 'TEST_COMPANY_FINAL_SUBMISSION_REJECTED', reason });
      const guard = jest.spyOn(companyFinalSubmission, 'assertCompanyFinalSubmissionCurrent').mockRejectedValue(rejection);
      await expect(consume(f, consumer)).rejects.toBe(rejection);
      expect(guard).toHaveBeenCalledTimes(1);
      expect(guard).toHaveBeenCalledWith(f.db, { ownerUserId: f.ids.owner, workId: f.ids.work,
        review: f.review, manuscript: f.manuscript, submission: f.submission });
      expectNoMaterialization(f);
      expect(f.db.auditEvent.create).not.toHaveBeenCalled();
    });
  });

  it('revalidates the company submission after generation and before storing choices', async () => {
    const f = fixture();
    f.submission.idempotencyKey = `story-company-final-v1:${f.ids.submission}`;
    const rejection = new ConflictException({ code: 'TEST_COMPANY_FINAL_SUBMISSION_STALE' });
    const guard = jest.spyOn(companyFinalSubmission, 'assertCompanyFinalSubmissionCurrent')
      .mockResolvedValueOnce({ approvalBasis: 'company_delegation', bindingHash: 'a'.repeat(64) })
      .mockRejectedValueOnce(rejection);
    await expect(consume(f, 'prepare')).rejects.toBe(rejection);
    expect(guard).toHaveBeenCalledTimes(2);
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
    expect(f.db.storyChoice.createMany).not.toHaveBeenCalled();
    expect(f.db.storyChoice.update).not.toHaveBeenCalled();
    expect(f.choices).toHaveLength(1);
    expect(f.auditRows.map(row => row.action)).toEqual(['story_studio_choices.provider_usage']);
  });

  describe.each(['status', 'checksum'] as const)('original submission %s gate', field => {
    it.each(consumers)('runs before the company policy in %s', async consumer => {
      const f = fixture();
      f.submission.idempotencyKey = `story-company-final-v1:${f.ids.submission}`;
      f.submission[field] = 'invalid';
      const guard = jest.spyOn(companyFinalSubmission, 'assertCompanyFinalSubmissionCurrent')
        .mockRejectedValue(new ConflictException('Company policy must not be reached'));
      const code = consumer === 'materialize' || consumer === 'finish' ? 'STUDIO_LINEAR_FINAL_REVIEW_REQUIRED'
        : consumer === 'publishable' || consumer === 'prepared-scenes' ? 'STUDIO_CHOICES_PUBLICATION_CONSENT_REQUIRED'
        : 'STUDIO_CHOICES_FINAL_REVIEW_REQUIRED';
      await expect(consume(f, consumer)).rejects.toMatchObject({ response: { code } });
      expect(guard).not.toHaveBeenCalled();
      expectNoMaterialization(f);
    });
  });

  describe.each(['reviewId', 'manuscriptVersionId'] as const)('misbound company submission %s', field => {
    it.each(['materialize', 'publishable'] as const)('is rejected by the actual policy in %s', async consumer => {
      const f = fixture();
      f.review.revision = 2;
      f.review.decisions = {};
      f.submission.idempotencyKey = `story-company-final-v1:${'a'.repeat(64)}`;
      f.submission[field] = randomUUID();
      const guard = jest.spyOn(companyFinalSubmission, 'assertCompanyFinalSubmissionCurrent');
      await expect(consume(f, consumer)).rejects.toMatchObject({ response: {
        code: 'COMPANY_FINAL_SUBMISSION_CHANGED' } });
      expect(guard).toHaveBeenCalledTimes(1);
      expectNoMaterialization(f);
    });
  });

  it('does not treat an accepted company policy as rights, continuity or three-choice approval', async () => {
    const f = fixture();
    f.submission.idempotencyKey = `story-company-final-v1:${f.ids.submission}`;
    jest.spyOn(companyFinalSubmission, 'assertCompanyFinalSubmissionCurrent')
      .mockResolvedValue({ approvalBasis: 'company_delegation', bindingHash: 'a'.repeat(64) });
    f.db.storyContinuityIssue.findMany.mockResolvedValueOnce([{ severity: 'critical' }]);
    await expect(consume(f, 'materialize')).rejects.toMatchObject({ response: {
      code: 'STUDIO_LINEAR_CONTINUITY_REVIEW_REQUIRED' } });
    f.consent.aiBranchAllowed = false;
    await expect(consume(f, 'materialize')).rejects.toMatchObject({ response: {
      code: 'STUDIO_LINEAR_AI_RIGHTS_CONSENT_REQUIRED' } });
    await expect(consume(f, 'prepare')).rejects.toMatchObject({ response: {
      code: 'STUDIO_CHOICES_AI_RIGHTS_CONSENT_REQUIRED' } });
    f.consent.aiBranchAllowed = true;
    await expect(consume(f, 'publishable')).rejects.toMatchObject({ response: {
      code: 'STUDIO_CHOICES_PUBLICATION_CHOICES_INCOMPLETE' } });
    expectNoMaterialization(f);
  });

  describe.each(['missing', 'expired', 'not-started', 'locale-disallowed'] as const)
  ('accepted manuscript receipt with %s AI consent', condition => {
    it.each(consumers)('still blocks %s without inventing consent or invoking the provider', async consumer => {
      const f = fixture();
      f.review.revision = 2;
      f.review.decisions = {};
      f.submission.idempotencyKey = `story-company-final-v1:${'a'.repeat(64)}`;
      const guard = jest.spyOn(companyFinalSubmission, 'assertCompanyFinalSubmissionCurrent')
        .mockResolvedValue({ approvalBasis: 'company_delegation', bindingHash: 'a'.repeat(64) });
      switch (condition) {
        case 'missing': f.db.storyStyleProfileConsent.findUnique.mockResolvedValue(null); break;
        case 'expired': Object.assign(f.consent, { expiresAt: new Date(0) }); break;
        case 'not-started': f.consent.startsAt = new Date(Date.now() + 86_400_000); break;
        case 'locale-disallowed': f.consent.allowedLocales = ['en']; break;
      }
      const originalConsent = JSON.stringify(f.consent), originalSubmission = JSON.stringify(f.submission);
      const code = consumer === 'materialize' || consumer === 'finish' ? 'STUDIO_LINEAR_AI_RIGHTS_CONSENT_REQUIRED'
        : consumer === 'publishable' || consumer === 'prepared-scenes' ? 'STUDIO_CHOICES_PUBLICATION_CONSENT_REQUIRED'
        : 'STUDIO_CHOICES_AI_RIGHTS_CONSENT_REQUIRED';
      await expect(consume(f, consumer)).rejects.toMatchObject({ response: { code } });
      expect(guard).toHaveBeenCalledTimes(consumer === 'publishable' || consumer === 'prepared-scenes' ? 0 : 1);
      expect(f.db.storyStyleProfileConsent.findUnique).toHaveBeenCalledWith({ where: { workId: f.ids.work } });
      expect(JSON.stringify(f.consent)).toBe(originalConsent);
      expect(JSON.stringify(f.submission)).toBe(originalSubmission);
      expectNoMaterialization(f);
      expect(f.db.auditEvent.create).not.toHaveBeenCalled();
    });
  });

  it('verifies the company receipt on preview without writes and leaves visual-source reads independent', async () => {
    const f = fixture();
    f.submission.idempotencyKey = `story-company-final-v1:${f.ids.submission}`;
    const guard = jest.spyOn(companyFinalSubmission, 'assertCompanyFinalSubmissionCurrent')
      .mockResolvedValue({ approvalBasis: 'company_delegation', bindingHash: 'a'.repeat(64) });
    const preview = await f.linearService.preview(f.ids.owner, f.ids.work, f.ids.manuscript);
    const query = { expectedManuscriptHash: f.manuscript.contentHash,
      expectedSourceChecksum: preview.importedVisualReferences.checksum, offset: 0, textOffset: 0 };
    await f.linearService.visualReferencePage(f.ids.owner, f.ids.work, f.ids.manuscript, query);
    await f.linearService.visualReferenceDetail(f.ids.owner, f.ids.work, f.ids.manuscript, 0, query);
    expect(guard).toHaveBeenCalledTimes(1);
    expect(guard).toHaveBeenCalledWith(f.db, expect.objectContaining({ ownerUserId: f.ids.owner,
      workId: f.ids.work, review: f.review, manuscript: f.manuscript, submission: f.submission }));
    expect(preview.review).toMatchObject({ approvalBasis: 'company_delegation',
      companySubmission: { humanSemanticReview: false, generationStarted: false, published: false } });
    expectNoMaterialization(f);
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.db.auditEvent.create).not.toHaveBeenCalled();
  });

  it.each(['publishable', 'prepared-scenes'] as const)('does not change non-intake %s validation', async consumer => {
    const f = fixture();
    f.manuscript.structuredBody.intake.format = 'other-manuscript-contract';
    const guard = jest.spyOn(companyFinalSubmission, 'assertCompanyFinalSubmissionCurrent')
      .mockRejectedValue(new ConflictException('Non-intake paths must not consume company submissions'));
    await expect(consume(f, consumer)).resolves.toBeUndefined();
    expect(guard).not.toHaveBeenCalled();
    expect(f.db.storyFinalSubmission.findUnique).not.toHaveBeenCalled();
    expectNoMaterialization(f);
  });

  it.each(['materialize', 'finish', 'prepare', 'original-scene'] as const)
  ('preserves the authored-import exclusion before company policy in %s', async consumer => {
    const f = fixture();
    f.db.storyAuthoredImport.findUnique.mockResolvedValue({ workId: f.ids.work });
    const guard = jest.spyOn(companyFinalSubmission, 'assertCompanyFinalSubmissionCurrent')
      .mockRejectedValue(new ConflictException('Imported works must not consume company submissions'));
    const code = consumer === 'materialize' || consumer === 'finish' ? 'STUDIO_LINEAR_PRIVATE_WORK_REQUIRED'
      : 'STUDIO_CHOICES_IMPORTED_WORK_UNSUPPORTED';
    await expect(consume(f, consumer)).rejects.toMatchObject({ response: { code } });
    expect(guard).not.toHaveBeenCalled();
    expectNoMaterialization(f);
  });
});

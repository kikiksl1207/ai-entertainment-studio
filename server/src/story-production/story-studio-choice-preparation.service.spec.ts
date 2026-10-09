import { createHash, randomUUID } from 'crypto';
import { StoryChoicePreparationError } from './story-choice-preparation.provider';
import { StoryStudioChoicePreparationService } from './story-studio-choice-preparation.service';
import { StoryStudioChoiceJobService } from './story-studio-choice-job.service';
import { CREATOR_GENERATION_PROFILE_SCHEMA, STORY_PROFILE_SECTION_KEYS,
  creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile, stableJson } from '../generation-profile/creator-generation-profile.policy';
import { continuationGenerationProfileSnapshot, STORY_CONTINUATION_PROFILE_VIEW_VERSION } from './story-continuation-context.policy';
import { SEMANTIC_PIPELINE } from './story-semantic-analysis.types';
import { CHOICE_CONSENT_APPROVAL_TYPE, CHOICE_CONSENT_REAPPROVED } from './story-studio-choice-consent.policy';

function fixture() {
  const ids = { owner: randomUUID(), work: randomUUID(), release: randomUUID(), manuscript: randomUUID(),
    scene: randomUUID(), part: randomUUID(), review: randomUUID(), consent: randomUUID(), next: randomUUID() };
  const original = { id: randomUUID(), sceneId: ids.scene, choiceKey: 'original', position: 1,
    routeKind: 'writer_original', label: { ko: '증거를 들고 다음 방으로 간다' } as { ko: string | null },
    targetSceneId: ids.next as string | null, targetEndingKey: null as string | null, declaredRejoinSceneId: null };
  const work = { id: ids.work, ownerUserId: ids.owner, status: 'draft', activeReleaseId: null,
    publishedAt: null, fixtureSource: false, title: { ko: '시험 작품' } };
  const manuscript = { id: ids.manuscript, workId: ids.work, ownerUserId: ids.owner, locale: 'ko',
    contentHash: 'hash', structuredBody: { intake: { format: 'story-manuscript-intake-v1' }, parts: [
      { partKey: 'part-1', title: '첫 장', paragraphs: [{ kind: 'paragraph', text: '첫 문장. 마지막 문장.' }] },
    ] } };
  const consent = { id: ids.consent, ownerUserId: ids.owner, manuscriptVersionId: ids.manuscript,
    status: 'active', rightsConfirmed: true, aiBranchAllowed: true, startsAt: new Date(0),
    expiresAt: null, allowedLocales: ['ko'], revision: 1 };
  const choices = [original];
  let evidence: Record<string, unknown> | null = null;
  const db: any = {
    storyWork: { findFirst: jest.fn().mockResolvedValue(work) },
    storyAuthoredImport: { findUnique: jest.fn().mockResolvedValue(null) },
    storyRelease: { findFirst: jest.fn().mockResolvedValue({ id: ids.release, manuscriptVersionId: ids.manuscript }) },
    storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue(manuscript), findUnique: jest.fn().mockResolvedValue(manuscript) },
    storyWriterReview: { findFirst: jest.fn().mockResolvedValue({ id: ids.review, state: 'submitted' }) },
    storyFinalSubmission: { findUnique: jest.fn().mockResolvedValue({ status: 'submitted', checksum: 'hash', manuscriptVersionId: ids.manuscript }) },
    storyStyleProfileConsent: { findUnique: jest.fn().mockResolvedValue(consent) },
    storyWorkGenerationProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    storyAnalysisJob: { findFirst: jest.fn().mockResolvedValue(null) },
    storyScene: { findFirst: jest.fn().mockResolvedValue({ id: ids.scene, partId: ids.part }),
      findUnique: jest.fn().mockResolvedValue({ id: ids.next, partId: randomUUID() }),
      findMany: jest.fn().mockResolvedValue([{ id: ids.scene, partId: ids.part, status: 'published' }]) },
    storyPart: { findFirst: jest.fn().mockImplementation(async ({ where }) => ({
      id: where.id, workId: ids.work, position: where.id === ids.part ? 1 : 2,
      status: 'draft', title: { ko: '첫 장' },
    })), findMany: jest.fn().mockResolvedValue([{ id: ids.part, position: 1, status: 'published' }]) },
    storyBeat: { findMany: jest.fn().mockResolvedValue([{ sceneId: ids.scene, content: { ko: '첫 문장. 마지막 문장.' } }]) },
    storyChoice: { findMany: jest.fn().mockImplementation(async () => choices),
      update: jest.fn(async ({ data }) => { original.label = data.label; return original; }),
      createMany: jest.fn(async ({ data }) => { choices.push(...data); return { count: data.length }; }) },
    storyStudioChoiceJob: { findUnique: jest.fn().mockResolvedValue(null) },
    auditEvent: { create: jest.fn(async ({ data }) => { evidence = data; return data; }),
      findMany: jest.fn(async () => evidence ? [evidence] : []) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(async (run: (tx: unknown) => Promise<unknown>) => run(db)),
  };
  const service = new StoryStudioChoicePreparationService(db as never);
  const provider = { modelName: 'test-choice-model', generate: jest.fn().mockResolvedValue([{ partKey: 'part-1', alternatives: [
    '증거를 숨기고 혼자 조사한다', '증거를 경찰에게 건넨다',
  ] }]) };
  const providerFactory = jest.spyOn(service as never, 'provider').mockReturnValue(provider as never);
  return { ids, db, service, provider, providerFactory, consent, choices, original, manuscript };
}

function approvedProfileFixture() {
  const f = fixture();
  const analysis = { id: randomUUID(), workId: f.ids.work, manuscriptVersionId: f.ids.manuscript,
    status: 'completed', pipeline: SEMANTIC_PIPELINE, sourceContentHash: f.manuscript.contentHash,
    sourceLocale: 'ko', totalParagraphs: 1, plannedParagraphs: 1, completedParagraphs: 1,
    analysisVersion: 2, configHash: 'analysis-config' };
  const sourceFingerprint = createHash('sha256').update(stableJson({ workId: f.ids.work,
    manuscriptVersionId: f.ids.manuscript, contentHash: f.manuscript.contentHash,
    analysisJobId: analysis.id, analysisVersion: analysis.analysisVersion,
    analysisConfigHash: analysis.configHash })).digest('hex');
  const evidenceId = randomUUID();
  const settings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({ key, decision: 'accepted',
      value: { summary: `Approved ${key} ` + 's'.repeat(500),
        observations: Array.from({ length: 12 }, (_, index) => ({ title: `${key} ${index}`,
          detail: key === 'timeline' ? 'Future author-plan injury, not a current route fact.' : 'd'.repeat(800),
          sourceRef: `analysis:${evidenceId}` })) },
      evidence: [{ sourceType: 'manuscript', sourceRef: `analysis:${evidenceId}:part-2:3`,
        summary: 'Authored reference only.' }],
    })),
  });
  const profile = { id: randomUUID(), workId: f.ids.work, ownerUserId: f.ids.owner,
    manuscriptVersionId: f.ids.manuscript, analysisJobId: analysis.id, sourceFingerprint,
    status: 'approved', profileVersion: 1, reviewRevision: 2,
    approvedSettings: settings as any, approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings),
    approvedByUserId: f.ids.owner, approvedAt: new Date('2026-09-30T00:00:00Z'),
    draftSettings: { summary: 'UNAPPROVED_DRAFT_MUST_NOT_BE_SENT' },
  };
  f.db.storyWorkGenerationProfile = { findFirst: jest.fn().mockResolvedValue(profile) };
  f.db.storyAnalysisJob = { findFirst: jest.fn().mockResolvedValue(analysis) };
  f.db.storyWriterReview.findFirst.mockResolvedValue({ id: f.ids.review, state: 'submitted', analysisJobId: analysis.id });
  return { ...f, profile, analysis, evidenceId };
}

async function storedPartFixture() {
  const f = approvedProfileFixture();
  await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
  const [proof] = await f.db.auditEvent.findMany({});
  proof.id = randomUUID();
  const pendingPart = randomUUID();
  f.manuscript.structuredBody.parts.push({ partKey: 'part-2', title: 'Pending part',
    paragraphs: [{ kind: 'paragraph', text: 'Pending authored text.' }] });
  f.db.storyPart.findMany.mockResolvedValue([
    { id: f.ids.part, position: 1, status: 'draft' }, { id: pendingPart, position: 2, status: 'draft' },
  ]);
  f.db.storyScene.findMany.mockResolvedValue([
    { id: f.ids.scene, partId: f.ids.part, status: 'draft' },
    { id: f.ids.next, partId: pendingPart, status: 'draft' },
  ]);
  const pendingChoice = { ...f.original, id: randomUUID(), sceneId: f.ids.next,
    targetSceneId: null, targetEndingKey: 'author_main' };
  f.db.storyChoice.findMany.mockImplementation(async ({ where }: { where: { sceneId: { in: string[] } } }) =>
    [...f.choices, pendingChoice].filter(choice => where.sceneId.in.includes(choice.sceneId)));
  const job = { id: randomUUID(), ownerUserId: f.ids.owner, workId: f.ids.work,
    releaseId: f.ids.release, manuscriptVersionId: f.ids.manuscript, status: 'processing',
    totalParts: 2, completedParts: 0, leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000) };
  f.db.storyStudioChoiceJob.findUnique.mockResolvedValue(job);
  f.db.storyStudioChoiceJob.updateMany = jest.fn(async ({ data }) => {
    Object.assign(job, data); return { count: 1 };
  });
  const resume = new StoryStudioChoiceJobService(f.db as never, f.service);
  jest.spyOn(resume as any, 'claim').mockResolvedValue({ id: job.id, leaseToken: job.leaseToken, recovered: false });
  const prepareNext = jest.spyOn(f.service, 'prepare');
  return { ...f, proof, job, resume, prepareNext };
}

describe('Studio authored choice preparation', () => {
  it.each(['approvedGenerationProfile', 'approvedGenerationProfileIdentity'] as const)(
    'keeps an invalid approval date a safe conflict in %s', async method => {
      const f = approvedProfileFixture();
      f.profile.approvedAt = new Date(NaN);
      await expect(f.service[method](f.db, f.ids.owner, f.ids.work, f.manuscript, f.analysis.id))
        .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_GENERATION_PROFILE_INVALID' } });
      expect(f.provider.generate).not.toHaveBeenCalled();
      expect(f.db.auditEvent.create).not.toHaveBeenCalled();
      expect(f.db.storyChoice.createMany).not.toHaveBeenCalled();
    },
  );

  async function receiptFixture() {
    const f = approvedProfileFixture();
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
    const [proof] = await f.db.auditEvent.findMany({});
    proof.id = randomUUID();
    f.consent.revision = 2;
    const receipt = { targetId: f.ids.scene, metadata: { ...proof.metadata,
      approvalType: CHOICE_CONSENT_APPROVAL_TYPE, sourceProofId: proof.id, consentRevision: 2,
      choicesReviewed: true, currentConsentConfirmed: true, batchHash: 'a'.repeat(64) } };
    f.db.auditEvent.findMany.mockImplementation(async ({ where }: { where?: { action?: string } }) =>
      where?.action === CHOICE_CONSENT_REAPPROVED ? [receipt] : [proof]);
    return { ...f, proof, receipt };
  }
  it('allows renewed consent only through an explicit bound author receipt without modifying the generation proof', async () => {
    const f = await receiptFixture(), oldProof = JSON.stringify(f.proof);
    await expect(f.service.assertPublishableTx(f.db, f.ids.work, f.ids.owner, f.ids.manuscript, f.ids.release)).resolves.toBeUndefined();
    expect(JSON.stringify(f.proof)).toBe(oldProof); expect(f.provider.generate).toHaveBeenCalledTimes(1);
  });
  it.each(['approvalType', 'sourceProofId', 'consentId', 'consentRevision', 'choicesReviewed', 'currentConsentConfirmed',
    'batchHash', 'workId', 'releaseId', 'manuscriptHash', 'sceneDigest', 'choiceDigest', 'generationProfilePin',
    'generationProfileViewVersion', 'analysisJobId'])('rejects mismatched renewed consent receipt %s', async field => {
    const f = await receiptFixture();
    f.receipt.metadata[field] = 'wrong';
    await expect(f.service.assertPublishableTx(f.db, f.ids.work, f.ids.owner, f.ids.manuscript, f.ids.release))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_GENERATION_PROOF_REQUIRED' } });
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
  });
  it('does not accept a renewed revision without an author receipt or when the consent is revoked again', async () => {
    const f = await receiptFixture(); f.db.auditEvent.findMany.mockResolvedValue([f.proof]);
    await expect(f.service.assertPublishableTx(f.db, f.ids.work, f.ids.owner, f.ids.manuscript, f.ids.release))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_GENERATION_PROOF_REQUIRED' } });
    f.consent.status = 'revoked';
    await expect(f.service.assertPublishableTx(f.db, f.ids.work, f.ids.owner, f.ids.manuscript, f.ids.release))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_PUBLICATION_CONSENT_REQUIRED' } });
  });

  it('validates stored choice proofs without requiring choices for still-pending authored parts', async () => {
    const f = await storedPartFixture();
    await expect(f.service.assertPreparedScenesTx(f.db, f.ids.work, f.ids.owner,
      f.ids.manuscript, f.ids.release, [f.ids.scene])).resolves.toBeUndefined();
    expect(f.db.storyChoice.findMany).toHaveBeenLastCalledWith({ where: { sceneId: { in: [f.ids.scene] } },
      orderBy: [{ position: 'asc' }, { id: 'asc' }] });
    await expect(f.service.assertPublishableTx(f.db, f.ids.work, f.ids.owner, f.ids.manuscript, f.ids.release))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_PUBLICATION_CHOICES_INCOMPLETE' } });
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
  });

  it.each<[string, (f: Awaited<ReturnType<typeof storedPartFixture>>) => void]>([
    ['consent revision', f => { f.consent.revision += 1; }],
    ['consent identity', f => { f.consent.id = randomUUID(); }],
    ['profile review revision', f => { f.profile.reviewRevision += 1; }],
    ['profile version', f => { f.profile.profileVersion += 1; }],
    ['profile identity', f => { f.profile.id = randomUUID(); }],
    ['profile approval timestamp', f => { f.profile.approvedAt = new Date('2026-09-30T00:01:00Z'); }],
    ['reapproved profile content', f => {
      f.profile.approvedSettings.sections[0].value.summary = 'Reapproved constraint';
      f.profile.approvedFingerprint = creatorGenerationProfileFingerprint(f.profile.sourceFingerprint,
        normalizeCreatorGenerationProfile('story', f.profile.approvedSettings));
    }],
    ['profile view', f => { f.proof.metadata.generationProfileViewVersion = 'obsolete-view'; }],
    ['analysis binding', f => { f.proof.metadata.analysisJobId = randomUUID(); }],
    ['missing profile pin', f => { delete f.proof.metadata.generationProfilePin; }],
  ])('rejects a stored scene with stale %s while another part is pending', async (_name, mutate) => {
    const f = await storedPartFixture();
    mutate(f);
    await expect(f.resume.executeOne()).resolves.toBe('failed');
    expect(f.job).toMatchObject({ status: 'failed', completedParts: 1,
      errorCode: 'STUDIO_CHOICES_GENERATION_PROOF_REQUIRED', leaseToken: null });
    expect(f.prepareNext).not.toHaveBeenCalled();
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
    expect(f.db.storyChoice.createMany).toHaveBeenCalledTimes(1);
  });

  it('accepts an explicitly reapproved consent receipt for a stored scene before resuming', async () => {
    const f = await storedPartFixture();
    f.consent.revision += 1;
    const receipt = { targetId: f.ids.scene, metadata: { ...f.proof.metadata,
      approvalType: CHOICE_CONSENT_APPROVAL_TYPE, sourceProofId: f.proof.id,
      consentRevision: f.consent.revision, choicesReviewed: true, currentConsentConfirmed: true,
      batchHash: 'b'.repeat(64) } };
    f.db.auditEvent.findMany.mockImplementation(async ({ where }: { where: { action: string } }) =>
      where.action === CHOICE_CONSENT_REAPPROVED ? [receipt] : [f.proof]);
    await expect(f.service.assertPreparedScenesTx(f.db, f.ids.work, f.ids.owner,
      f.ids.manuscript, f.ids.release, [f.ids.scene])).resolves.toBeUndefined();
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
  });

  it('rejects a stored-scene validation request outside the reviewed manuscript', async () => {
    const f = await storedPartFixture();
    await expect(f.service.assertPreparedScenesTx(f.db, f.ids.work, f.ids.owner,
      f.ids.manuscript, f.ids.release, [randomUUID()]))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_PUBLICATION_SCENES_INCOMPLETE' } });
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
  });
  it('sends only the bounded approved snapshot and records its approval pin and view version', async () => {
    const f = approvedProfileFixture();
    f.original.choiceKey = 'original1';
    const { approved, pin } = continuationGenerationProfileSnapshot(f.profile);
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
    expect(f.provider.generate).toHaveBeenCalledWith({ workTitle: '시험 작품', generationProfile: approved,
      parts: [expect.objectContaining({ partKey: 'part-1', originalChoiceLabel: f.original.label.ko })],
    }, expect.any(Function));
    expect(Buffer.byteLength(JSON.stringify(approved), 'utf8')).toBeLessThanOrEqual(16_384);
    expect(JSON.stringify(f.provider.generate.mock.calls[0][0])).not.toContain('UNAPPROVED_DRAFT');
    expect(approved.sections.find(section => section.key === 'writing_style')?.value.observations).toHaveLength(4);
    expect(approved.sections.find(section => section.key === 'timeline')?.value).toMatchObject({
      referenceScope: 'author_plan_not_route_history', observations: [
        expect.objectContaining({ referenceScope: 'author_plan_not_route_history',
          sourceRef: `analysis:${f.evidenceId}`, sourcePartKey: 'part-2', sourceParagraphIndex: 3 }),
        expect.any(Object),
      ],
    });
    expect(f.db.storyWorkGenerationProfile.findFirst).toHaveBeenCalledWith({ where: { workId: f.ids.work },
      orderBy: { profileVersion: 'desc' } });
    expect(f.db.storyAnalysisJob.findFirst).toHaveBeenCalledWith({ where: { workId: f.ids.work,
      manuscriptVersionId: f.ids.manuscript, pipeline: SEMANTIC_PIPELINE },
      orderBy: { analysisVersion: 'desc' } });
    expect(f.db.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'story_studio_choices.prepared', metadata: expect.objectContaining({ generationProfilePin: {
        ...pin, manuscriptVersionId: f.ids.manuscript, analysisJobId: f.analysis.id,
        analysisVersion: f.analysis.analysisVersion, approvedByUserId: f.ids.owner,
        approvedAt: f.profile.approvedAt.toISOString(),
      },
        generationProfileViewVersion: STORY_CONTINUATION_PROFILE_VIEW_VERSION, analysisJobId: f.analysis.id }),
    }) });
    expect(f.original).toMatchObject({ choiceKey: 'original1', position: 1, routeKind: 'writer_original',
      targetSceneId: f.ids.next });
    expect(f.db.storyChoice.update).not.toHaveBeenCalled();
    expect(f.choices.slice(1)).toEqual([
      expect.objectContaining({ position: 2, routeKind: 'generation_required' }),
      expect.objectContaining({ position: 3, routeKind: 'generation_required' }),
    ]);
    for (const choice of f.choices.slice(1)) {
      expect(choice).not.toHaveProperty('targetSceneId');
      expect(choice).not.toHaveProperty('declaredRejoinSceneId');
    }
  });

  it.each(['queued', 'running', 'failed'])('does not fall back to an earlier approved analysis when the latest is %s', async status => {
    const f = approvedProfileFixture();
    const latest = { ...f.analysis, id: randomUUID(), analysisVersion: f.analysis.analysisVersion + 1, status };
    f.db.storyAnalysisJob.findFirst.mockImplementation(async ({ where }: { where: { status?: string } }) =>
      [latest, f.analysis].find(row => !where.status || row.status === where.status) ?? null);
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_GENERATION_PROFILE_SOURCE_MISMATCH' } });
    expect(f.providerFactory).not.toHaveBeenCalled();
    expect(f.provider.generate).not.toHaveBeenCalled();
    expect(f.db.storyChoice.createMany).not.toHaveBeenCalled();
  });

  it.each(['queued', 'running', 'failed'])('blocks publication rather than reuse an older approval when the latest analysis is %s', async status => {
    const f = approvedProfileFixture();
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
    const latest = { ...f.analysis, id: randomUUID(), analysisVersion: f.analysis.analysisVersion + 1, status };
    f.db.storyAnalysisJob.findFirst.mockImplementation(async ({ where }: { where: { status?: string } }) =>
      [latest, f.analysis].find(row => !where.status || row.status === where.status) ?? null);
    await expect(f.service.assertPublishableTx(f.db, f.ids.work, f.ids.owner, f.ids.manuscript, f.ids.release))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_GENERATION_PROFILE_SOURCE_MISMATCH' } });
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
  });

  it.each(['queued', 'running', 'failed'])('does not treat a latest %s semantic analysis without a profile as a legacy work', async status => {
    const f = fixture();
    f.db.storyAnalysisJob.findFirst.mockImplementation(async ({ where }: { where: { status?: string } }) =>
      !where.status || where.status === status ? { id: randomUUID(), status } : null);
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_GENERATION_PROFILE_APPROVAL_REQUIRED' } });
    expect(f.providerFactory).not.toHaveBeenCalled();
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it.each<[string, (f: ReturnType<typeof approvedProfileFixture>) => void, string]>([
    ['another work', f => { f.profile.workId = randomUUID(); }, 'APPROVAL_REQUIRED'],
    ['another owner', f => { f.profile.ownerUserId = randomUUID(); }, 'APPROVAL_REQUIRED'],
    ['another approver', f => { f.profile.approvedByUserId = randomUUID(); }, 'APPROVAL_REQUIRED'],
    ['missing approval date', f => { f.profile.approvedAt = null as never; }, 'APPROVAL_REQUIRED'],
    ['unapproved latest draft', f => { f.profile.status = 'needs_review'; }, 'APPROVAL_REQUIRED'],
    ['missing approved settings', f => { f.profile.approvedSettings = null; }, 'INVALID'],
    ['missing approved fingerprint', f => { f.profile.approvedFingerprint = null as never; }, 'INVALID'],
    ['tampered fingerprint', f => { f.profile.approvedFingerprint = '0'.repeat(64); }, 'INVALID'],
    ['tampered approved content', f => { f.profile.approvedSettings.sections[0].value.summary = 'Changed'; }, 'INVALID'],
    ['another manuscript', f => { f.profile.manuscriptVersionId = randomUUID(); }, 'SOURCE_MISMATCH'],
    ['another profile analysis', f => { f.profile.analysisJobId = randomUUID(); }, 'SOURCE_MISMATCH'],
    ['changed source fingerprint', f => { f.profile.sourceFingerprint = '0'.repeat(64); }, 'SOURCE_MISMATCH'],
    ['another analysis work', f => { f.analysis.workId = randomUUID(); }, 'SOURCE_MISMATCH'],
    ['another analysis manuscript', f => { f.analysis.manuscriptVersionId = randomUUID(); }, 'SOURCE_MISMATCH'],
    ['changed source hash', f => { f.analysis.sourceContentHash = 'changed'; }, 'SOURCE_MISMATCH'],
    ['unfinished analysis', f => { f.analysis.status = 'running'; }, 'SOURCE_MISMATCH'],
    ['non-Korean analysis', f => { f.analysis.sourceLocale = 'en'; }, 'SOURCE_MISMATCH'],
    ['empty completed analysis', f => {
      f.analysis.totalParagraphs = 0; f.analysis.plannedParagraphs = 0; f.analysis.completedParagraphs = 0;
    }, 'SOURCE_MISMATCH'],
    ['incomplete analysis plan', f => { f.analysis.plannedParagraphs = 0; }, 'SOURCE_MISMATCH'],
    ['incomplete completed analysis', f => { f.analysis.completedParagraphs = 0; }, 'SOURCE_MISMATCH'],
    ['excess analysis plan', f => { f.analysis.plannedParagraphs = 2; }, 'SOURCE_MISMATCH'],
    ['excess analysis completion', f => { f.analysis.completedParagraphs = 2; }, 'SOURCE_MISMATCH'],
    ['nonsemantic analysis', f => { f.analysis.pipeline = 'legacy' as never; }, 'SOURCE_MISMATCH'],
    ['new analysis version', f => { f.analysis.analysisVersion += 1; }, 'SOURCE_MISMATCH'],
    ['changed analysis configuration', f => { f.analysis.configHash = 'changed'; }, 'SOURCE_MISMATCH'],
    ['another reviewed analysis', f => { f.db.storyWriterReview.findFirst.mockResolvedValue({
      id: f.ids.review, state: 'submitted', analysisJobId: randomUUID() }); }, 'SOURCE_MISMATCH'],
    ['missing completed analysis', f => { f.db.storyAnalysisJob.findFirst.mockResolvedValue(null); }, 'SOURCE_MISMATCH'],
  ])('blocks %s before constructing or calling the provider', async (_name, mutate, suffix) => {
    const f = approvedProfileFixture();
    mutate(f);
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .rejects.toMatchObject({ response: { code: `STUDIO_CHOICES_GENERATION_PROFILE_${suffix}` } });
    expect(f.providerFactory).not.toHaveBeenCalled();
    expect(f.provider.generate).not.toHaveBeenCalled();
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.db.storyChoice.createMany).not.toHaveBeenCalled();
  });

  it.each<[string, (f: ReturnType<typeof approvedProfileFixture>) => void, string]>([
    ['review revision', f => { f.profile.reviewRevision += 1; }, 'STUDIO_CHOICES_SOURCE_CHANGED'],
    ['profile version', f => { f.profile.profileVersion += 1; }, 'STUDIO_CHOICES_SOURCE_CHANGED'],
    ['approval timestamp', f => { f.profile.approvedAt = new Date('2026-09-30T00:01:00Z'); }, 'STUDIO_CHOICES_SOURCE_CHANGED'],
    ['reapproved settings', f => {
      f.profile.approvedSettings.sections[0].value.summary = 'Changed approved constraints';
      f.profile.approvedFingerprint = creatorGenerationProfileFingerprint(f.profile.sourceFingerprint,
        normalizeCreatorGenerationProfile('story', f.profile.approvedSettings));
    }, 'STUDIO_CHOICES_SOURCE_CHANGED'],
    ['revoked approval', f => { f.profile.status = 'needs_review'; }, 'STUDIO_CHOICES_GENERATION_PROFILE_APPROVAL_REQUIRED'],
    ['removed profile', f => { f.db.storyWorkGenerationProfile.findFirst.mockResolvedValue(null); }, 'STUDIO_CHOICES_GENERATION_PROFILE_APPROVAL_REQUIRED'],
  ])('rejects a changed %s after generation without writing choices', async (_name, mutate, code) => {
    const f = approvedProfileFixture();
    f.provider.generate.mockImplementationOnce(async () => {
      mutate(f);
      return [{ partKey: 'part-1', alternatives: ['증거를 숨기고 혼자 조사한다', '증거를 경찰에게 건넨다'] }];
    });
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .rejects.toMatchObject({ response: { code } });
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
    expect(f.db.storyWorkGenerationProfile.findFirst).toHaveBeenCalledTimes(2);
    expect(f.db.storyChoice.update).not.toHaveBeenCalled();
    expect(f.db.storyChoice.createMany).not.toHaveBeenCalled();
    expect(f.db.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(f.db.$queryRaw.mock.calls.some(([query]: [{ sql: string }]) => query.sql.includes('story_work_generation_profiles') &&
      query.sql.includes('FOR SHARE'))).toBe(true);
  });

  it('rejects a profile introduced during a legacy generation attempt', async () => {
    const f = approvedProfileFixture();
    f.db.storyWorkGenerationProfile.findFirst.mockResolvedValueOnce(null);
    f.db.storyAnalysisJob.findFirst.mockResolvedValueOnce(null);
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_SOURCE_CHANGED' } });
    expect(f.provider.generate.mock.calls[0][0]).not.toHaveProperty('generationProfile');
    expect(f.db.storyChoice.createMany).not.toHaveBeenCalled();
  });

  it('retains legacy behavior when the work has no profile, but does not bypass lookup failures', async () => {
    const legacy = fixture();
    legacy.db.storyWorkGenerationProfile = { findFirst: jest.fn().mockResolvedValue(null) };
    await legacy.service.prepare(legacy.ids.owner, legacy.ids.work, legacy.ids.release, legacy.ids.scene);
    expect(legacy.provider.generate.mock.calls[0][0]).not.toHaveProperty('generationProfile');
    const unavailable = approvedProfileFixture();
    unavailable.db.storyWorkGenerationProfile.findFirst.mockRejectedValue(new Error('profile lookup failed'));
    await expect(unavailable.service.prepare(unavailable.ids.owner, unavailable.ids.work,
      unavailable.ids.release, unavailable.ids.scene)).rejects.toThrow('profile lookup failed');
    expect(unavailable.provider.generate).not.toHaveBeenCalled();
  });

  it('retains legacy behavior when the client genuinely has no approved-profile support', async () => {
    const f = fixture();
    delete f.db.storyWorkGenerationProfile;
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
    expect(f.provider.generate.mock.calls[0][0]).not.toHaveProperty('generationProfile');
    await expect(f.service.assertPublishableTx(f.db, f.ids.work, f.ids.owner, f.ids.manuscript,
      f.ids.release)).resolves.toBeUndefined();
  });

  it('requires an approved profile when completed semantic analysis exists, even if the profile is missing', async () => {
    const f = approvedProfileFixture();
    f.db.storyWorkGenerationProfile.findFirst.mockResolvedValue(null);
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_GENERATION_PROFILE_APPROVAL_REQUIRED' } });
    expect(f.providerFactory).not.toHaveBeenCalled();
    expect(f.provider.generate).not.toHaveBeenCalled();
    expect(f.db.storyChoice.createMany).not.toHaveBeenCalled();
  });

  it.each<[string, (f: ReturnType<typeof approvedProfileFixture>) => void, string]>([
    ['review revision', f => { f.profile.reviewRevision += 1; }, 'STUDIO_CHOICES_GENERATION_PROOF_REQUIRED'],
    ['profile version', f => { f.profile.profileVersion += 1; }, 'STUDIO_CHOICES_GENERATION_PROOF_REQUIRED'],
    ['approval timestamp', f => { f.profile.approvedAt = new Date('2026-09-30T00:01:00Z'); }, 'STUDIO_CHOICES_GENERATION_PROOF_REQUIRED'],
    ['approval identity', f => { f.profile.id = randomUUID(); }, 'STUDIO_CHOICES_GENERATION_PROOF_REQUIRED'],
    ['reapproved content', f => {
      f.profile.approvedSettings.sections[0].value.summary = 'Newly approved constraint';
      f.profile.approvedFingerprint = creatorGenerationProfileFingerprint(f.profile.sourceFingerprint,
        normalizeCreatorGenerationProfile('story', f.profile.approvedSettings));
    }, 'STUDIO_CHOICES_GENERATION_PROOF_REQUIRED'],
    ['wrong owner', f => { f.profile.ownerUserId = randomUUID(); }, 'STUDIO_CHOICES_GENERATION_PROFILE_APPROVAL_REQUIRED'],
    ['revoked approval', f => { f.profile.status = 'needs_review'; }, 'STUDIO_CHOICES_GENERATION_PROFILE_APPROVAL_REQUIRED'],
    ['removed semantic profile', f => { f.db.storyWorkGenerationProfile.findFirst.mockResolvedValue(null); }, 'STUDIO_CHOICES_GENERATION_PROFILE_APPROVAL_REQUIRED'],
    ['tampered fingerprint', f => { f.profile.approvedFingerprint = '0'.repeat(64); }, 'STUDIO_CHOICES_GENERATION_PROFILE_INVALID'],
    ['stale manuscript', f => { f.profile.manuscriptVersionId = randomUUID(); }, 'STUDIO_CHOICES_GENERATION_PROFILE_SOURCE_MISMATCH'],
    ['changed analysis source', f => { f.analysis.sourceContentHash = 'changed'; }, 'STUDIO_CHOICES_GENERATION_PROFILE_SOURCE_MISMATCH'],
    ['new analysis version', f => { f.analysis.analysisVersion += 1; }, 'STUDIO_CHOICES_GENERATION_PROFILE_SOURCE_MISMATCH'],
    ['another reviewed analysis', f => { f.db.storyWriterReview.findFirst.mockResolvedValue({
      id: f.ids.review, state: 'submitted', analysisJobId: randomUUID() }); }, 'STUDIO_CHOICES_GENERATION_PROFILE_SOURCE_MISMATCH'],
  ])('blocks publication after %s changes following preparation', async (_name, mutate, code) => {
    const f = approvedProfileFixture();
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
    mutate(f);
    await expect(f.service.assertPublishableTx(f.db, f.ids.work, f.ids.owner, f.ids.manuscript,
      f.ids.release)).rejects.toMatchObject({ response: { code } });
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
  });

  it('blocks a legacy proof when a current approved profile now exists', async () => {
    const f = approvedProfileFixture();
    f.db.storyWorkGenerationProfile.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    f.db.storyAnalysisJob.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
    await expect(f.service.assertPublishableTx(f.db, f.ids.work, f.ids.owner, f.ids.manuscript,
      f.ids.release)).rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_GENERATION_PROOF_REQUIRED' } });
    expect(f.provider.generate.mock.calls[0][0]).not.toHaveProperty('generationProfile');
  });

  it('blocks a legacy proof when semantic analysis now exists without its required profile', async () => {
    const f = fixture();
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
    f.db.storyAnalysisJob.findFirst.mockResolvedValue({ id: randomUUID() });
    await expect(f.service.assertPublishableTx(f.db, f.ids.work, f.ids.owner, f.ids.manuscript,
      f.ids.release)).rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_GENERATION_PROFILE_APPROVAL_REQUIRED' } });
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
  });

  it('invalidates a preparation proof from an older approved-profile view', async () => {
    const f = approvedProfileFixture();
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
    await expect(f.service.assertPublishableTx(f.db, f.ids.work, f.ids.owner, f.ids.manuscript,
      f.ids.release)).resolves.toBeUndefined();
    const [proof] = await f.db.auditEvent.findMany({});
    proof.metadata.generationProfileViewVersion = 'story-profile-prompt-v2';
    await expect(f.service.assertPublishableTx(f.db, f.ids.work, f.ids.owner, f.ids.manuscript,
      f.ids.release)).rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_GENERATION_PROOF_REQUIRED' } });
  });

  it('accepts a reviewed heading removed for readers but rejects changed prose', async () => {
    const accepted = fixture();
    accepted.manuscript.structuredBody.parts[0].paragraphs = [{ kind: 'paragraph',
      text: '# Part 01. 첫 장\n\n첫 문장. 마지막 문장.' }];
    await expect(accepted.service.prepare(accepted.ids.owner, accepted.ids.work,
      accepted.ids.release, accepted.ids.scene)).resolves.toMatchObject({ choiceCount: 3 });

    const changed = fixture();
    changed.manuscript.structuredBody.parts[0].paragraphs = [{ kind: 'paragraph',
      text: '# Part 01. 첫 장\n\n다른 문장. 마지막 문장.' }];
    await expect(changed.service.prepare(changed.ids.owner, changed.ids.work,
      changed.ids.release, changed.ids.scene)).rejects.toMatchObject({
      response: { code: 'STUDIO_CHOICES_MANUSCRIPT_SCENE_MISMATCH' },
    });
    expect(changed.provider.generate).not.toHaveBeenCalled();
  });

  it('preserves the authored route and commits two generated alternatives only after final review and consent', async () => {
    const f = fixture();
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .resolves.toEqual({ sceneId: f.ids.scene, choiceCount: 3, originalRoutePreserved: true });
    expect(f.db.storyChoice.createMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ position: 2, routeKind: 'generation_required', label: { ko: '증거를 숨기고 혼자 조사한다' } }),
      expect.objectContaining({ position: 3, routeKind: 'generation_required', label: { ko: '증거를 경찰에게 건넨다' } }),
    ] });
    expect(f.original.targetSceneId).toBe(f.ids.next);
    expect(f.db.auditEvent.create).toHaveBeenCalledTimes(2);
    expect(f.db.auditEvent.create).toHaveBeenNthCalledWith(1, { data: expect.objectContaining({
      action: 'story_studio_choices.provider_usage',
      metadata: expect.objectContaining({ model: 'test-choice-model', outcome: 'accepted',
        usageStatus: 'unavailable' }),
    }) });
  });

  it('generates the missing original label only for a reviewed private route and binds its proof', async () => {
    const f = fixture();
    f.original.label = { ko: null };
    f.original.targetSceneId = null;
    f.original.targetEndingKey = 'author_main';
    f.db.storyRelease.findFirst.mockResolvedValue({ id: f.ids.release,
      manuscriptVersionId: f.ids.manuscript, branchGraphSnapshot: { parts: [
        { partKey: 'part-1', originalLabel: null, nextPartKey: null },
      ] } });
    f.provider.generate.mockResolvedValue([{ partKey: 'part-1',
      originalChoiceLabel: '기록을 보존하고 사건을 마무리한다', alternatives: [
        '기록을 지우고 홀로 떠난다', '기록을 공개해 새 조사에 나선다',
      ] }]);
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .resolves.toMatchObject({ choiceCount: 3 });
    expect(f.provider.generate).toHaveBeenCalledWith({ workTitle: '시험 작품', parts: [
      expect.objectContaining({ partKey: 'part-1', nextPartTitle: null, nextPartExcerpt: null }),
    ] }, expect.any(Function));
    expect(f.db.storyChoice.update).toHaveBeenCalledWith({ where: { id: f.original.id },
      data: { label: { ko: '기록을 보존하고 사건을 마무리한다' } } });
    expect(f.choices).toHaveLength(3);
    expect(f.db.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      metadata: expect.objectContaining({ originalLabelGenerated: true }),
    }) });
  });

  it('passes the next authored part to AI without changing the original route destination', async () => {
    const f = fixture();
    f.original.label = { ko: null };
    f.manuscript.structuredBody.parts.push({ partKey: 'part-2', title: '두 번째 장',
      paragraphs: [{ kind: 'paragraph', text: '다음 장에서는 편지를 들고 항구로 향한다.' }] });
    f.db.storyRelease.findFirst.mockResolvedValue({ id: f.ids.release,
      manuscriptVersionId: f.ids.manuscript, branchGraphSnapshot: { parts: [
        { partKey: 'part-1', originalLabel: null, nextPartKey: 'part-2' },
      ] } });
    f.provider.generate.mockResolvedValue([{ partKey: 'part-1',
      originalChoiceLabel: '편지를 챙겨 항구로 향한다', alternatives: [
        '편지를 숨기고 집에 남는다', '편지를 경찰에게 넘긴다',
      ] }]);
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
    expect(f.provider.generate).toHaveBeenCalledWith({ workTitle: '시험 작품', parts: [
      expect.objectContaining({ nextPartTitle: '두 번째 장',
        nextPartExcerpt: '다음 장에서는 편지를 들고 항구로 향한다.' }),
    ] }, expect.any(Function));
    expect(f.original.targetSceneId).toBe(f.ids.next);
    expect(f.db.storyChoice.update).toHaveBeenCalledTimes(1);
  });

  it('does not send reviewed chapter headings as prose to the choice provider', async () => {
    const f = fixture();
    f.original.label = { ko: null };
    f.manuscript.structuredBody.parts[0].paragraphs = [{ kind: 'paragraph',
      text: '# Part 01. 첫 장\n\n첫 문장. 마지막 문장.' }];
    f.manuscript.structuredBody.parts.push({ partKey: 'part-2', title: '두 번째 장',
      paragraphs: [{ kind: 'paragraph', text: '# Part 02. 두 번째 장\n\n다음 장면의 본문.' }] });
    f.db.storyRelease.findFirst.mockResolvedValue({ id: f.ids.release,
      manuscriptVersionId: f.ids.manuscript, branchGraphSnapshot: { parts: [
        { partKey: 'part-1', originalLabel: null, nextPartKey: 'part-2' },
      ] } });
    f.provider.generate.mockResolvedValue([{ partKey: 'part-1',
      originalChoiceLabel: '증거를 들고 다음 방으로 간다', alternatives: [
        '증거를 숨기고 혼자 조사한다', '증거를 경찰에게 건넨다',
      ] }]);
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
    expect(f.provider.generate).toHaveBeenCalledWith({ workTitle: '시험 작품', parts: [
      expect.objectContaining({ context: '첫 문장. 마지막 문장.',
        nextPartExcerpt: '다음 장면의 본문.' }),
    ] }, expect.any(Function));
  });

  it('does not save an empty original when AI returns no original wording', async () => {
    const f = fixture();
    f.original.label = { ko: null };
    f.original.targetSceneId = null;
    f.original.targetEndingKey = 'author_main';
    f.db.storyRelease.findFirst.mockResolvedValue({ id: f.ids.release,
      manuscriptVersionId: f.ids.manuscript, branchGraphSnapshot: { parts: [
        { partKey: 'part-1', originalLabel: null, nextPartKey: null },
      ] } });
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_GENERATION_INVALID' } });
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.db.storyChoice.update).not.toHaveBeenCalled();
    expect(f.original.label).toEqual({ ko: null });
  });

  it('rejects a prefilled auto label that does not match the reviewed route snapshot', async () => {
    const f = fixture();
    f.db.storyRelease.findFirst.mockResolvedValue({ id: f.ids.release,
      manuscriptVersionId: f.ids.manuscript, branchGraphSnapshot: { parts: [
        { partKey: 'part-1', originalLabel: null, nextPartKey: null },
      ] } });
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_ORIGINAL_ROUTE_REQUIRED' } });
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('rejects an authored ending target when the manuscript still has a next part', async () => {
    const f = fixture();
    f.original.label = { ko: null };
    f.original.targetSceneId = null;
    f.original.targetEndingKey = 'author_main';
    f.manuscript.structuredBody.parts.push({ partKey: 'part-2', title: '두 번째 장',
      paragraphs: [{ kind: 'paragraph', text: '다음 장의 첫 장면.' }] });
    f.db.storyRelease.findFirst.mockResolvedValue({ id: f.ids.release,
      manuscriptVersionId: f.ids.manuscript, branchGraphSnapshot: { parts: [
        { partKey: 'part-1', originalLabel: null, nextPartKey: 'part-2' },
      ] } });
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_ORIGINAL_ROUTE_REQUIRED' } });
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('fails closed without reviewed submission or current AI rights consent', async () => {
    const f = fixture();
    f.db.storyFinalSubmission.findUnique.mockResolvedValueOnce(null);
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_FINAL_REVIEW_REQUIRED' } });
    f.consent.aiBranchAllowed = false;
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_AI_RIGHTS_CONSENT_REQUIRED' } });
    expect(f.provider.generate).not.toHaveBeenCalled();
    expect(f.db.storyChoice.createMany).not.toHaveBeenCalled();
  });

  it('does not persist placeholder choices when generation fails', async () => {
    const f = fixture();
    f.provider.generate.mockRejectedValueOnce(new StoryChoicePreparationError('invalid_output'));
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_GENERATION_FAILED' } });
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.db.storyChoice.createMany).not.toHaveBeenCalled();
    expect(f.db.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'story_studio_choices.provider_usage',
      metadata: expect.objectContaining({ outcome: 'rejected', usageStatus: 'unavailable' }),
    }) });
  });

  it('records observed token usage even when provider output is rejected', async () => {
    const f = fixture();
    f.provider.generate.mockImplementationOnce(async (_input: unknown,
      onUsage: (usage: unknown) => void) => {
      onUsage({ inputTokens: 240, outputTokens: 80, cachedInputTokens: 20, reasoningTokens: 10 });
      throw new StoryChoicePreparationError('invalid_output');
    });
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_GENERATION_FAILED' } });
    expect(f.db.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'story_studio_choices.provider_usage',
      metadata: expect.objectContaining({ outcome: 'rejected', usageStatus: 'reported',
        providerUsage: { inputTokens: 240, outputTokens: 80, cachedInputTokens: 20,
          reasoningTokens: 10 } }),
    }) });
    expect(f.db.storyChoice.createMany).not.toHaveBeenCalled();
  });

  it('records successful provider usage separately from the publication proof', async () => {
    const f = fixture();
    f.provider.generate.mockImplementationOnce(async (_input: unknown,
      onUsage: (usage: unknown) => void) => {
      onUsage({ inputTokens: 300, outputTokens: 100, cachedInputTokens: 40, reasoningTokens: 5 });
      return [{ partKey: 'part-1', originalChoiceLabel: '증거를 들고 다음 방으로 간다',
        alternatives: ['증거를 숨기고 혼자 조사한다', '증거를 경찰에게 건넨다'] }];
    });
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
    expect(f.db.auditEvent.create).toHaveBeenNthCalledWith(1, { data: expect.objectContaining({
      action: 'story_studio_choices.provider_usage',
      metadata: expect.objectContaining({ outcome: 'accepted', usageStatus: 'reported',
        providerUsage: { inputTokens: 300, outputTokens: 100, cachedInputTokens: 40,
          reasoningTokens: 5 } }),
    }) });
    expect(f.db.auditEvent.create).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({
      action: 'story_studio_choices.prepared',
    }) });
  });

  it('stops before saving choices if the usage audit cannot be stored', async () => {
    const f = fixture();
    f.db.auditEvent.create.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .rejects.toThrow('audit unavailable');
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.db.storyChoice.createMany).not.toHaveBeenCalled();
  });

  it('blocks legacy scene-by-scene calls while a durable background job owns the release', async () => {
    const f = fixture();
    const leaseToken = randomUUID();
    f.db.storyStudioChoiceJob.findUnique.mockResolvedValue({ status: 'processing', leaseToken,
      leaseExpiresAt: new Date(Date.now() + 60_000) });
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_BACKGROUND_JOB_ACTIVE' } });
    expect(f.provider.generate).not.toHaveBeenCalled();
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene, leaseToken))
      .resolves.toMatchObject({ choiceCount: 3 });
  });

  it('rejects a missing job when a background lease was supplied', async () => {
    const f = fixture();
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene, randomUUID()))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_BACKGROUND_JOB_ACTIVE' } });
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it.each(['replaced', 'expired', 'removed'])('rejects choices when the lease is %s before storage', async reason => {
    const f = fixture();
    const leaseToken = randomUUID();
    f.db.storyStudioChoiceJob.findUnique.mockResolvedValue({ status: 'processing', leaseToken,
      leaseExpiresAt: new Date(Date.now() + 60_000) });
    f.provider.generate.mockImplementationOnce(async () => {
      f.db.storyStudioChoiceJob.findUnique.mockResolvedValue(reason === 'removed' ? null : {
        status: 'processing', leaseToken: reason === 'replaced' ? randomUUID() : leaseToken,
        leaseExpiresAt: reason === 'expired' ? new Date(0) : new Date(Date.now() + 60_000),
      });
      return [{ partKey: 'part-1', alternatives: ['증거를 숨기고 혼자 조사한다', '증거를 경찰에게 건넨다'] }];
    });
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene, leaseToken))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_BACKGROUND_JOB_ACTIVE' } });
    expect(f.db.storyChoice.createMany).not.toHaveBeenCalled();
    expect(f.db.storyChoice.update).not.toHaveBeenCalled();
  });

  it('locks the background job before scene and approval rows during choice storage', async () => {
    const f = fixture();
    const leaseToken = randomUUID();
    f.db.storyStudioChoiceJob.findUnique.mockResolvedValue({ status: 'processing', leaseToken,
      leaseExpiresAt: new Date(Date.now() + 60_000) });
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene, leaseToken);
    const queries = f.db.$queryRaw.mock.calls.map(([query]: [{ strings: readonly string[] }]) => query.strings.join(' '));
    expect(queries[0]).toContain('story_studio_choice_jobs');
    expect(queries[0]).toContain('FOR UPDATE');
    expect(queries[1]).toContain('story_scenes');
  });

  it('rejects a changed manuscript between generation and storage', async () => {
    const f = fixture();
    f.db.storyManuscriptVersion.findFirst.mockResolvedValueOnce(f.manuscript)
      .mockResolvedValueOnce({ ...f.manuscript, contentHash: 'changed' });
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_FINAL_REVIEW_REQUIRED' } });
    expect(f.db.storyChoice.createMany).not.toHaveBeenCalled();
  });

  it('blocks publication when reviewed Studio scenes have fewer than three choices', async () => {
    const f = fixture();
    await expect(f.service.assertPublishableTx(f.db as never, f.ids.work, f.ids.owner, f.ids.manuscript, f.ids.release))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_PUBLICATION_CHOICES_INCOMPLETE' } });
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
    await expect(f.service.assertPublishableTx(f.db as never, f.ids.work, f.ids.owner, f.ids.manuscript, f.ids.release)).resolves.toBeUndefined();
    expect(f.db.storyScene.findMany).toHaveBeenCalledTimes(2);
    expect(f.db.auditEvent.findMany).toHaveBeenCalledTimes(2);
  });

  it('rejects a preparation proof from an older consent revision even after active renewal', async () => {
    const f = fixture();
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
    await expect(f.service.assertPublishableTx(f.db as never, f.ids.work, f.ids.owner,
      f.ids.manuscript, f.ids.release)).resolves.toBeUndefined();
    f.consent.revision += 1;
    await expect(f.service.assertPublishableTx(f.db as never, f.ids.work, f.ids.owner,
      f.ids.manuscript, f.ids.release)).rejects.toMatchObject({
      response: { code: 'STUDIO_CHOICES_GENERATION_PROOF_REQUIRED' },
    });
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
    expect(f.db.storyChoice.createMany).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null, '1', 0, 2])('cannot use consent proof revision %p for the current approval', async revision => {
    const f = fixture();
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
    const [proof] = await f.db.auditEvent.findMany({});
    proof.metadata.consentRevision = revision;
    await expect(f.service.assertPublishableTx(f.db as never, f.ids.work, f.ids.owner,
      f.ids.manuscript, f.ids.release)).rejects.toMatchObject({
      response: { code: 'STUDIO_CHOICES_GENERATION_PROOF_REQUIRED' },
    });
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
  });

  it('blocks publication when an uploaded Studio manuscript has no final review', async () => {
    const f = fixture();
    f.db.storyWriterReview.findFirst.mockResolvedValueOnce(null);
    await expect(f.service.assertPublishableTx(f.db as never, f.ids.work, f.ids.owner, f.ids.manuscript, f.ids.release))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_FINAL_REVIEW_REQUIRED' } });
    expect(f.db.storyChoice.createMany).not.toHaveBeenCalled();
  });

  it('returns only reviewed draft rows for atomic promotion at publication', async () => {
    const f = fixture();
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
    f.db.storyPart.findMany.mockResolvedValueOnce([{ id: f.ids.part, position: 1, status: 'draft' }]);
    f.db.storyScene.findMany.mockResolvedValueOnce([{ id: f.ids.scene, partId: f.ids.part, status: 'draft' }]);
    await expect(f.service.assertPublishableTx(f.db as never, f.ids.work, f.ids.owner, f.ids.manuscript, f.ids.release))
      .resolves.toEqual({ partIds: [f.ids.part], sceneIds: [f.ids.scene] });
  });

  it('checks a 265-part manuscript with bounded grouped reads and the same choice proofs', async () => {
    const f = fixture();
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
    const [proof] = await f.db.auditEvent.findMany({});
    const rows = Array.from({ length: 265 }, (_, index) => ({
      partId: randomUUID(), sceneId: randomUUID(), position: index + 1,
    }));
    f.manuscript.structuredBody.parts = rows.map((row) => ({ partKey: `part-${row.position}`,
      title: '첫 장', paragraphs: [{ kind: 'paragraph', text: '첫 문장. 마지막 문장.' }] }));
    f.db.storyPart.findMany.mockResolvedValue(rows.map((row) => ({
      id: row.partId, position: row.position, status: 'published',
    })));
    f.db.storyScene.findMany.mockResolvedValue(rows.map((row) => ({
      id: row.sceneId, partId: row.partId, status: 'published',
    })));
    f.db.storyChoice.findMany.mockResolvedValue(rows.flatMap((row) => f.choices.map((choice) => ({
      ...choice, id: randomUUID(), sceneId: row.sceneId,
    }))));
    f.db.storyBeat.findMany.mockResolvedValue(rows.map((row) => ({
      sceneId: row.sceneId, content: { ko: '첫 문장. 마지막 문장.' },
    })));
    f.db.auditEvent.findMany.mockResolvedValue(rows.map((row) => ({
      ...proof, targetId: row.sceneId,
    })));
    f.db.storyScene.findMany.mockClear();
    f.db.storyChoice.findMany.mockClear();
    f.db.storyBeat.findMany.mockClear();
    f.db.auditEvent.findMany.mockClear();
    await expect(f.service.assertPublishableTx(f.db as never, f.ids.work, f.ids.owner,
      f.ids.manuscript, f.ids.release)).resolves.toBeUndefined();
    for (const query of [f.db.storyScene.findMany, f.db.storyChoice.findMany,
      f.db.storyBeat.findMany, f.db.auditEvent.findMany]) expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects hand-edited placeholder labels without matching generation evidence', async () => {
    const f = fixture();
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
    f.choices[1].label = { ko: '임시 선택지' };
    await expect(f.service.assertPublishableTx(f.db as never, f.ids.work, f.ids.owner, f.ids.manuscript, f.ids.release))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_GENERATION_PROOF_REQUIRED' } });
  });

  it('rejects scene prose changed after choice generation', async () => {
    const f = fixture();
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
    f.db.storyBeat.findMany.mockResolvedValueOnce([{ sceneId: f.ids.scene, content: { ko: '다른 본문' } }]);
    await expect(f.service.assertPublishableTx(f.db as never, f.ids.work, f.ids.owner, f.ids.manuscript, f.ids.release))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_GENERATION_PROOF_REQUIRED' } });
  });
});

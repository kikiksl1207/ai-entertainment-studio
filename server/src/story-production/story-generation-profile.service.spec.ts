import { ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { CREATOR_GENERATION_PROFILE_SCHEMA, STORY_PROFILE_SECTION_KEYS, creatorGenerationProfileFingerprint,
  stableJson, type CreatorGenerationProfileSettings } from '../generation-profile/creator-generation-profile.policy';
import { PrismaService } from '../prisma/prisma.service';
import { StoryGenerationProfileService } from './story-generation-profile.service';
import { continuationGenerationProfileSnapshot } from './story-continuation-context.policy';
import { releaseChecksum } from './story-lifecycle.policy';
import { brotliCompressSync } from 'zlib';

const owner = '00000000-0000-4000-8000-000000000201';
const workId = '00000000-0000-4000-8000-000000000202';
const manuscriptId = '00000000-0000-4000-8000-000000000203';
const analysisId = '00000000-0000-4000-8000-000000000204';
const profileId = '00000000-0000-4000-8000-000000000205';
const styleEvidenceId = '00000000-0000-4000-8000-000000000206';
const releaseId = '00000000-0000-4000-8000-000000000209';

function publishedCompanyWork() {
  return { id: workId, ownerUserId: owner, authorDisplayName: '루미나', fixtureSource: false,
    status: 'published', activeReleaseId: releaseId, publishedAt: new Date('2026-09-23T00:00:00.000Z') };
}

function publishedCompanyRelease() {
  const snapshot = { manuscriptVersionId: manuscriptId, branchGraphSnapshot: {}, endingSetSnapshot: {},
    sceneAssetManifest: {}, localizedDisplaySnapshot: {} };
  return { id: releaseId, workId, status: 'active', ...snapshot, checksum: releaseChecksum(snapshot) };
}

function sourceMocks(prisma: ReturnType<typeof fixture>['prisma']) {
  prisma.storyWork.findFirst.mockResolvedValue({ id: workId });
  prisma.storyManuscriptVersion.findFirst.mockResolvedValue({
    id: manuscriptId,
    version: 3,
    locale: 'ko',
    contentHash: 'a'.repeat(64),
    structuredBody: {
      parts: [
        { paragraphs: [{ text: 'first' }, { text: 'second' }] },
        { paragraphs: [{ text: 'third' }] },
      ],
    },
  });
  prisma.storyAnalysisJob.findFirst.mockResolvedValue({
    id: analysisId,
    analysisVersion: 2,
    sourceContentHash: 'a'.repeat(64),
    configHash: 'b'.repeat(64),
    totalParts: 2,
    totalParagraphs: 3,
  });
}

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: profileId,
    workId,
    ownerUserId: owner,
    manuscriptVersionId: manuscriptId,
    analysisJobId: analysisId,
    sourceFingerprint: 'c'.repeat(64),
    profileVersion: 1,
    reviewRevision: 0,
    status: 'needs_review',
    draftSettings: {},
    draftFingerprint: 'd'.repeat(64),
    approvedSettings: null,
    approvedFingerprint: null,
    approvedByUserId: null,
    approvedAt: null,
    analysisErrorCode: null,
    createdAt: new Date('2026-09-23T00:00:00.000Z'),
    updatedAt: new Date('2026-09-23T00:00:00.000Z'),
    ...overrides,
  };
}

function fixture() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: workId }]),
    storyWork: { findFirst: jest.fn() },
    storyPublicationImportJob: { findFirst: jest.fn() },
    storyManuscriptVersion: { findFirst: jest.fn() },
    storyRelease: { findFirst: jest.fn().mockResolvedValue(publishedCompanyRelease()) },
    storyAnalysisEvidence: { findMany: jest.fn(), count: jest.fn().mockResolvedValue(4),
      findFirst: jest.fn().mockResolvedValue({ id: styleEvidenceId }) },
    storyWorkGenerationProfile: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    storyMemoryRecord: { updateMany: jest.fn(), createMany: jest.fn() },
    auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit' }), findFirst: jest.fn() },
  };
  const prisma = {
    storyWork: { findFirst: jest.fn() },
    storyManuscriptVersion: { findFirst: jest.fn() },
    storyAnalysisJob: { findFirst: jest.fn() },
    storyAnalysisEvidence: { findMany: jest.fn() },
    storyWorkGenerationProfile: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  tx.storyManuscriptVersion.findFirst.mockResolvedValue({ id: manuscriptId, workId,
    ownerUserId: owner, contentHash: 'a'.repeat(64) });
  return { prisma, tx, service: new StoryGenerationProfileService(prisma as unknown as PrismaService) };
}

function snapshotBarriers(f: ReturnType<typeof fixture>) {
  return f.tx.$queryRaw.mock.calls.filter(([query]) =>
    typeof query?.sql === 'string' && query.sql.includes('UPDATE story_works SET updated_at'));
}

function reviewedSettings(): CreatorGenerationProfileSettings {
  return {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
    kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map((key) => ({
      key,
      decision: 'accepted' as const,
      value: key === 'writing_style' ? { summary: key,
        observations: [{ sourceRef: `analysis:${styleEvidenceId}`, title: 'Distinct rhythm', detail: 'Short clauses' }] }
        : { summary: key },
      evidence: [],
    })),
  };
}

function sourceFingerprint() {
  return createHash('sha256').update(stableJson({ workId, manuscriptVersionId: manuscriptId,
    contentHash: 'a'.repeat(64), analysisJobId: analysisId, analysisVersion: 2,
    analysisConfigHash: 'b'.repeat(64) })).digest('hex');
}

function privateCompanyIntakeFixture(compressed = false) {
  const f = fixture();
  sourceMocks(f.prisma);
  const jobId = '00000000-0000-4000-8000-000000000207';
  const auditId = '00000000-0000-4000-8000-000000000208';
  const sourceBindingSha256 = 'e'.repeat(64);
  const plan = { storyKey: 'monster', slug: 'company-private-story',
    writerIntakeWorkflow: 'writer_review_before_choices_v1', sourceBindingSha256,
    manuscript: { contentHash: 'a'.repeat(64) }, parts: [{}, {}], prompts: [] };
  const work = { id: workId, ownerUserId: owner, slug: plan.slug, status: 'draft',
    authorDisplayName: '루미나', fixtureSource: false, activeReleaseId: null, publishedAt: null,
    coverManifest: { privateIntake: { contract: 'publication-writer-intake-v1', jobId,
      sourceBindingSha256, manuscriptHash: 'a'.repeat(64) } } };
  const manuscript = { id: manuscriptId, ownerUserId: owner, workId, contentHash: 'a'.repeat(64) };
  const job = { id: jobId, actorUserId: owner, workId, releaseId: null, errorCode: null,
    status: 'awaiting_author_review', storyKey: plan.storyKey, sourceBindingSha256,
    planSnapshot: compressed ? { storageContract: 'story-publication-plan-br-base64-v1',
      data: brotliCompressSync(Buffer.from(JSON.stringify(plan))).toString('base64') } : plan };
  const audit = { id: auditId, actorUserId: owner, actorType: 'admin',
    action: 'story_publication.private_writer_intake', targetType: 'story_work', targetId: workId,
    metadata: { jobId, manuscriptVersionId: manuscriptId, manuscriptHash: manuscript.contentHash,
      sourceBindingSha256, partCount: 2, analysisStarted: false, choicesGenerated: false, published: false } };
  f.tx.storyWork.findFirst.mockResolvedValue(work);
  f.tx.storyManuscriptVersion.findFirst.mockResolvedValue(manuscript);
  f.tx.storyPublicationImportJob.findFirst.mockImplementation(({ where }) =>
    where.status === 'awaiting_author_review' ? job : null);
  f.tx.auditEvent.findFirst.mockImplementation(({ where }) =>
    where.action === 'story_publication.private_writer_intake' ? audit : null);
  const settings = reviewedSettings();
  settings.sections.forEach(section => { section.decision = 'proposed'; });
  const profile = profileRow({ sourceFingerprint: sourceFingerprint(), draftSettings: settings });
  f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(profile);
  f.tx.storyWorkGenerationProfile.updateMany.mockResolvedValue({ count: 1 });
  f.tx.storyWorkGenerationProfile.findUniqueOrThrow.mockResolvedValue(profileRow({ status: 'approved' }));
  f.tx.storyAnalysisEvidence.findMany.mockResolvedValue([]);
  return { ...f, work, manuscript, job, audit, profile, plan };
}

describe('private company intake profile auto-approval', () => {
  it.each([false, true])('approves the exact latest trusted intake (compressed=%s)', async compressed => {
    const f = privateCompanyIntakeFixture(compressed);

    expect((await f.service.autoApproveCompany(owner, workId))?.profile.status).toBe('approved');
    expect(f.tx.storyManuscriptVersion.findFirst).toHaveBeenCalledWith({
      where: { workId, ownerUserId: owner }, orderBy: { version: 'desc' },
      select: { id: true, workId: true, ownerUserId: true, contentHash: true },
    });
    expect(f.tx.storyWorkGenerationProfile.updateMany).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      actorType: 'system', action: 'story_generation_profile.company_auto_approved',
      metadata: expect.objectContaining({ companyPrivateIntakeJobId: f.job.id,
        companyPrivateIntakeAuditId: f.audit.id, companySourceBindingSha256: f.job.sourceBindingSha256,
        companyManuscriptVersionId: manuscriptId }),
    }) }));
    expect(snapshotBarriers(f)).toHaveLength(1);
  });

  it.each([
    'display-name-only', 'external-author', 'fixture', 'missing-audit', 'wrong-audit-actor',
    'wrong-audit-target', 'old-manuscript-id', 'old-manuscript-hash', 'wrong-source-binding',
    'wrong-plan-binding', 'wrong-job-owner', 'wrong-work-owner', 'newer-manuscript',
    'newer-manuscript-same-hash', 'wrong-manuscript-owner', 'manual-revision', 'manual-section',
    'stale-profile', 'malformed-compression',
  ])('keeps %s out of private company intake auto-approval', async condition => {
    const f = privateCompanyIntakeFixture();
    switch (condition) {
      case 'display-name-only': f.tx.storyPublicationImportJob.findFirst.mockResolvedValue(null); break;
      case 'external-author': f.work.authorDisplayName = 'External author'; break;
      case 'fixture': f.work.fixtureSource = true; break;
      case 'missing-audit': f.tx.auditEvent.findFirst.mockResolvedValue(null); break;
      case 'wrong-audit-actor': f.audit.actorType = 'user'; break;
      case 'wrong-audit-target': f.audit.targetId = analysisId; break;
      case 'old-manuscript-id': f.audit.metadata.manuscriptVersionId = analysisId; break;
      case 'old-manuscript-hash': f.audit.metadata.manuscriptHash = 'f'.repeat(64); break;
      case 'wrong-source-binding': f.audit.metadata.sourceBindingSha256 = 'f'.repeat(64); break;
      case 'wrong-plan-binding': f.plan.sourceBindingSha256 = 'f'.repeat(64); break;
      case 'wrong-job-owner': f.job.actorUserId = analysisId; break;
      case 'wrong-work-owner': f.work.ownerUserId = analysisId; break;
      case 'newer-manuscript': f.manuscript.id = analysisId; f.manuscript.contentHash = 'f'.repeat(64); break;
      case 'newer-manuscript-same-hash': f.manuscript.id = analysisId; break;
      case 'wrong-manuscript-owner': f.manuscript.ownerUserId = analysisId; break;
      case 'manual-revision': f.profile.reviewRevision = 1; break;
      case 'manual-section': f.profile.draftSettings = reviewedSettings(); break;
      case 'stale-profile': f.profile.sourceFingerprint = 'f'.repeat(64); break;
      case 'malformed-compression': f.job.planSnapshot = {
        storageContract: 'story-publication-plan-br-base64-v1', data: 'invalid',
      }; break;
    }

    expect(await f.service.autoApproveCompany(owner, workId)).toBeNull();
    expect(f.tx.storyWorkGenerationProfile.updateMany).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(snapshotBarriers(f)).toHaveLength(0);
  });

  it('does not approve a private company intake twice', async () => {
    const f = privateCompanyIntakeFixture();
    expect((await f.service.autoApproveCompany(owner, workId))?.profile.status).toBe('approved');
    f.profile.status = 'approved';
    expect(await f.service.autoApproveCompany(owner, workId)).toBeNull();
    expect(f.tx.storyWorkGenerationProfile.updateMany).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });
});

describe('published company source binding', () => {
  function publishedFixture(proof: 'import' | 'audit') {
    const f = privateCompanyIntakeFixture();
    const work = publishedCompanyWork();
    const release = publishedCompanyRelease();
    const receipt = { id: 'company-import', releaseId };
    const publication = { id: 'company-publication', afterData: { workId, releaseId, status: 'published' } };
    f.tx.storyWork.findFirst.mockResolvedValue(work);
    f.tx.storyRelease.findFirst.mockResolvedValue(release);
    f.tx.storyPublicationImportJob.findFirst.mockResolvedValue(proof === 'import' ? receipt : null);
    f.tx.auditEvent.findFirst.mockResolvedValue(proof === 'audit' ? publication : null);
    return { ...f, work, release, receipt, publication };
  }

  it.each(['import', 'audit'] as const)('preserves current published %s approval', async proof => {
    const f = publishedFixture(proof);
    expect((await f.service.autoApproveCompany(owner, workId))?.profile.status).toBe('approved');
    expect(f.tx.storyWorkGenerationProfile.updateMany).toHaveBeenCalledTimes(1);
  });

  it.each((['import', 'audit'] as const).flatMap(proof =>
    ['old-receipt-release', 'new-manuscript-same-hash', 'new-manuscript-hash',
      'different-release-manuscript', 'retired-release', 'corrupt-release'].map(condition => [proof, condition] as const)))
    ('blocks %s with %s', async (proof, condition) => {
      const f = publishedFixture(proof);
      switch (condition) {
        case 'old-receipt-release': f.receipt.releaseId = analysisId; f.publication.afterData.releaseId = analysisId; break;
        case 'new-manuscript-same-hash': f.manuscript.id = analysisId; break;
        case 'new-manuscript-hash': f.manuscript.contentHash = 'f'.repeat(64); break;
        case 'different-release-manuscript': f.release.manuscriptVersionId = analysisId; break;
        case 'retired-release': f.release.status = 'retired'; break;
        case 'corrupt-release': f.release.checksum = 'f'.repeat(64); break;
      }
      expect(await f.service.autoApproveCompany(owner, workId)).toBeNull();
      expect(f.tx.storyWorkGenerationProfile.updateMany).not.toHaveBeenCalled();
      expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    });
});

describe('StoryGenerationProfileService', () => {
  it('auto-approves only an unchanged, company-imported Lumina draft with an audit trail', async () => {
    const f = fixture();
    sourceMocks(f.prisma);
    const settings = reviewedSettings();
    settings.sections.forEach((section) => { section.decision = 'proposed'; });
    f.tx.storyWork.findFirst.mockResolvedValue(publishedCompanyWork());
    f.tx.storyPublicationImportJob.findFirst.mockResolvedValue({ id: 'company-import', releaseId });
    f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(profileRow({
      sourceFingerprint: sourceFingerprint(), draftSettings: settings,
    }));
    f.tx.storyWorkGenerationProfile.updateMany.mockResolvedValue({ count: 1 });
    f.tx.storyWorkGenerationProfile.findUniqueOrThrow.mockResolvedValue(profileRow({ status: 'approved' }));
    f.tx.storyAnalysisEvidence.findMany.mockResolvedValue([]);

    const result = await f.service.autoApproveCompany(owner, workId);

    expect(result?.profile.status).toBe('approved');
    expect(snapshotBarriers(f)).toHaveLength(1);
    expect(snapshotBarriers(f)[0][0].values).toEqual([workId, owner]);
    const update = f.tx.storyWorkGenerationProfile.updateMany.mock.calls[0][0];
    expect(update.where).toMatchObject({ status: 'needs_review', reviewRevision: 0,
      sourceFingerprint: sourceFingerprint() });
    expect(update.data.approvedSettings.sections.every((section: { decision: string }) =>
      section.decision === 'accepted')).toBe(true);
    expect(update.data.approvedFingerprint).toBe(update.data.draftFingerprint);
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorType: 'system',
        action: 'story_generation_profile.company_auto_approved',
        metadata: expect.objectContaining({ companyImportJobId: 'company-import' }) }),
    }));
  });

  it('does not auto-approve a copied Lumina display name without company import provenance', async () => {
    const f = fixture();
    sourceMocks(f.prisma);
    f.tx.storyWork.findFirst.mockResolvedValue(publishedCompanyWork());
    f.tx.storyPublicationImportJob.findFirst.mockResolvedValue(null);

    expect(await f.service.autoApproveCompany(owner, workId)).toBeNull();
    expect(snapshotBarriers(f)).toHaveLength(0);
    expect(f.tx.storyWorkGenerationProfile.updateMany).not.toHaveBeenCalled();
  });

  it('keeps a company draft in review when its style is a generic fallback without cited analysis', async () => {
    const f = fixture();
    sourceMocks(f.prisma);
    const settings = reviewedSettings();
    settings.sections.forEach((section) => { section.decision = 'proposed'; });
    settings.sections.find((section) => section.key === 'writing_style')!.value = { summary: 'Generic fallback' };
    f.tx.storyWork.findFirst.mockResolvedValue(publishedCompanyWork());
    f.tx.storyPublicationImportJob.findFirst.mockResolvedValue({ id: 'company-import', releaseId });
    f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(profileRow({
      sourceFingerprint: sourceFingerprint(), draftSettings: settings,
    }));

    expect(await f.service.autoApproveCompany(owner, workId)).toBeNull();
    expect(f.tx.storyAnalysisEvidence.findFirst).not.toHaveBeenCalled();
    expect(f.tx.storyWorkGenerationProfile.updateMany).not.toHaveBeenCalled();
  });

  it('does not auto-approve a company style observation from outside its analysis', async () => {
    const f = fixture();
    sourceMocks(f.prisma);
    const settings = reviewedSettings();
    settings.sections.forEach((section) => { section.decision = 'proposed'; });
    f.tx.storyWork.findFirst.mockResolvedValue(publishedCompanyWork());
    f.tx.storyPublicationImportJob.findFirst.mockResolvedValue({ id: 'company-import', releaseId });
    f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(profileRow({
      sourceFingerprint: sourceFingerprint(), draftSettings: settings,
    }));
    f.tx.storyAnalysisEvidence.findFirst.mockResolvedValue(null);

    expect(await f.service.autoApproveCompany(owner, workId)).toBeNull();
    expect(f.tx.storyAnalysisEvidence.findFirst).toHaveBeenCalledWith({
      where: { id: { in: [styleEvidenceId] }, analysisJobId: analysisId,
        provenance: 'semantic_candidate', evidenceType: 'style' }, select: { id: true },
    });
    expect(f.tx.storyWorkGenerationProfile.updateMany).not.toHaveBeenCalled();
  });

  it('recognizes a direct company publication audit when no import job was needed', async () => {
    const f = fixture();
    sourceMocks(f.prisma);
    const settings = reviewedSettings();
    settings.sections.forEach((section) => { section.decision = 'proposed'; });
    f.tx.storyWork.findFirst.mockResolvedValue(publishedCompanyWork());
    f.tx.storyPublicationImportJob.findFirst.mockResolvedValue(null);
    f.tx.auditEvent.findFirst.mockResolvedValue({ id: 'company-publication', afterData: { workId, releaseId } });
    f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(profileRow({
      sourceFingerprint: sourceFingerprint(), draftSettings: settings,
    }));
    f.tx.storyWorkGenerationProfile.updateMany.mockResolvedValue({ count: 1 });
    f.tx.storyWorkGenerationProfile.findUniqueOrThrow.mockResolvedValue(profileRow({ status: 'approved' }));
    f.tx.storyAnalysisEvidence.findMany.mockResolvedValue([]);

    expect((await f.service.autoApproveCompany(owner, workId))?.profile.status).toBe('approved');
    expect(f.tx.auditEvent.findFirst).toHaveBeenCalledWith({
      where: { actorUserId: owner, actorType: 'admin',
        action: { in: ['story_approved_source.public_beta_published', 'story_upload.public_beta_published'] },
        afterData: { path: ['workId'], equals: workId },
        AND: [{ afterData: { path: ['releaseId'], equals: releaseId } }] },
      select: { id: true, afterData: true },
    });
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metadata: expect.objectContaining({
        companyPublicationAuditId: 'company-publication',
      }) }),
    }));
  });

  it('does not auto-approve an outside author even if a publication job exists', async () => {
    const f = fixture();
    sourceMocks(f.prisma);
    f.tx.storyWork.findFirst.mockResolvedValue({ authorDisplayName: '다른 작가', fixtureSource: false });
    f.tx.storyPublicationImportJob.findFirst.mockResolvedValue({ id: 'company-import' });

    expect(await f.service.autoApproveCompany(owner, workId)).toBeNull();
    expect(f.tx.storyPublicationImportJob.findFirst).not.toHaveBeenCalled();
    expect(f.tx.storyWorkGenerationProfile.updateMany).not.toHaveBeenCalled();
  });

  it('does not repeat auto-approval for an already approved company profile', async () => {
    const f = fixture();
    sourceMocks(f.prisma);
    f.tx.storyWork.findFirst.mockResolvedValue(publishedCompanyWork());
    f.tx.storyPublicationImportJob.findFirst.mockResolvedValue({ id: 'company-import', releaseId });
    f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(profileRow({
      sourceFingerprint: sourceFingerprint(), status: 'approved',
    }));

    expect(await f.service.autoApproveCompany(owner, workId)).toBeNull();
    expect(f.tx.storyWorkGenerationProfile.updateMany).not.toHaveBeenCalled();
  });

  it('leaves manually edited company drafts for human review', async () => {
    const f = fixture();
    sourceMocks(f.prisma);
    f.tx.storyWork.findFirst.mockResolvedValue(publishedCompanyWork());
    f.tx.storyPublicationImportJob.findFirst.mockResolvedValue({ id: 'company-import', releaseId });
    f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(profileRow({
      sourceFingerprint: sourceFingerprint(), draftSettings: reviewedSettings(),
    }));

    expect(await f.service.autoApproveCompany(owner, workId)).toBeNull();
    expect(f.tx.storyWorkGenerationProfile.updateMany).not.toHaveBeenCalled();
  });

  it('still returns a reviewable draft when company auto-approval fails', async () => {
    const f = fixture();
    sourceMocks(f.prisma);
    f.prisma.storyWorkGenerationProfile.findFirst.mockResolvedValue(profileRow());
    jest.spyOn(f.service, 'autoApproveCompany').mockRejectedValue(new Error('temporary failure'));
    jest.spyOn((f.service as any).logger, 'warn').mockImplementation(() => undefined);

    const result = await f.service.getOrCreate(owner, workId);

    expect(result.profile.status).toBe('needs_review');
    expect(result.profile.reviewRequired).toBe(true);
  });

  it('checks company drafts beyond the first hundred review items', async () => {
    const f = fixture();
    const createdAt = new Date('2026-09-23T00:00:00.000Z');
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `profile-${String(index).padStart(3, '0')}`,
      createdAt,
      workId: `work-${index}`,
      ownerUserId: owner,
    }));
    const finalProfile = { id: 'profile-100', createdAt, workId, ownerUserId: owner };
    f.prisma.storyWorkGenerationProfile.findMany
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([finalProfile]);
    const approve = jest.spyOn(f.service, 'autoApproveCompany').mockResolvedValue(null);

    await (f.service as any).approvePendingCompanyProfiles();

    expect(approve).toHaveBeenCalledTimes(101);
    expect(approve).toHaveBeenLastCalledWith(owner, workId);
    expect(f.prisma.storyWorkGenerationProfile.findMany).toHaveBeenCalledTimes(2);
    expect(f.prisma.storyWorkGenerationProfile.findMany.mock.calls[1][0].where.OR).toEqual([
      { createdAt: { gt: createdAt } },
      { createdAt, id: { gt: 'profile-099' } },
    ]);
  });

  it('recovers a missing draft for the owned latest completed semantic analysis without duplicating it', async () => {
    const f = fixture();
    sourceMocks(f.prisma);
    let stored: ReturnType<typeof profileRow> | null = null;
    f.prisma.storyWorkGenerationProfile.findFirst.mockImplementation(() => stored);
    f.tx.storyAnalysisEvidence.findMany.mockResolvedValue([
      { id: 'e-style', evidenceType: 'style', sourcePartKey: 'part-1', sourceParagraphIndex: 0,
        payload: { title: 'Short rhythm', observation: 'Short sentences accelerate tense scenes.', styleCategory: 'sentence_rhythm' } },
      { id: 'e-event', evidenceType: 'event', sourcePartKey: 'part-2', sourceParagraphIndex: 0,
        payload: { title: 'Later event', observation: 'The later event follows the opening promise.' } },
      { id: 'e-entity', evidenceType: 'entity', sourcePartKey: 'part-1', sourceParagraphIndex: 1,
        payload: { title: 'Lead', observation: 'The lead retains the same identity.' } },
      { id: 'e-background', evidenceType: 'background', sourcePartKey: 'part-2', sourceParagraphIndex: 0,
        payload: { title: 'Harbor', observation: 'The harbor remains cold and foggy.' } },
    ]);
    f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(null);
    f.tx.storyWorkGenerationProfile.create.mockImplementation(({ data }) => {
      stored = profileRow(data);
      return stored;
    });

    const result = await f.service.getOrCreate(owner, workId);
    const replay = await f.service.getOrCreate(owner, workId);
    const draft = result.profile.draftSettings as ReturnType<typeof reviewedSettings>;

    expect(replay.profile).toEqual(result.profile);
    expect(f.tx.storyWorkGenerationProfile.create).toHaveBeenCalledTimes(1);
    expect(result.profile.status).toBe('needs_review');
    expect(result.profile.reviewRequired).toBe(true);
    expect(draft.sections).toHaveLength(8);
    expect(draft.sections.every((section: { decision: string }) => section.decision === 'proposed')).toBe(true);
    expect(draft.sections.find((section: { key: string }) => section.key === 'scene_scale')!.value)
      .toMatchObject({ partCount: 2, paragraphCount: 3 });
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'story_generation_profile.analysis_draft_created' }),
    }));
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('samples style and events from the end of a long analysis instead of only its first 5000 rows', async () => {
    const f = fixture();
    f.tx.storyAnalysisEvidence.count.mockResolvedValue(6000);
    f.tx.$queryRaw.mockResolvedValue(['style', 'event'].flatMap((type) =>
      Array.from({ length: 250 }, (_, index) => ({
        id: `${type}-${index === 249 ? 2999 : index * 12}`,
        evidenceType: type,
        sourcePartKey: `part-${index}`,
        sourceParagraphIndex: 0,
        payload: { title: `Finding ${index}`, observation: `Observed at ${index}` },
      }))));

    const settings = await (f.service as any).settingsFromAnalysis(f.tx, analysisId, {
      id: manuscriptId, version: 1, locale: 'ko-KR', structuredBody: { parts: [] },
    });
    const style = settings.sections.find((section: { key: string }) => section.key === 'writing_style')!;
    const timeline = settings.sections.find((section: { key: string }) => section.key === 'timeline')!;

    expect(style.value.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceRef: 'analysis:style-0' }),
      expect.objectContaining({ sourceRef: 'analysis:style-2999' }),
    ]));
    expect(timeline.value.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceRef: 'analysis:event-2999' }),
    ]));
    expect(f.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(f.tx.storyAnalysisEvidence.findMany).not.toHaveBeenCalled();
  });

  it('does not recover a legacy publication-style snapshot as a semantic profile', async () => {
    const f = fixture();
    sourceMocks(f.prisma);
    f.prisma.storyAnalysisJob.findFirst.mockResolvedValue(null);

    await expect(f.service.getOrCreate(owner, workId)).rejects.toMatchObject({
      response: { code: 'GENERATION_PROFILE_ANALYSIS_REQUIRED' },
    });
    expect(f.prisma.storyAnalysisJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ pipeline: 'semantic_extraction_v1' }),
    }));
    expect(f.tx.storyWorkGenerationProfile.create).not.toHaveBeenCalled();
  });

  it('creates one NEEDS_REVIEW draft and audit event when completion is replayed', async () => {
    const f = fixture();
    sourceMocks(f.prisma);
    f.tx.storyWork.findFirst.mockResolvedValue({ id: workId });
    f.tx.storyManuscriptVersion.findFirst.mockResolvedValue(await f.prisma.storyManuscriptVersion.findFirst());
    f.tx.storyAnalysisEvidence.findMany.mockResolvedValue([
      { id: 'e-style', evidenceType: 'style', sourcePartKey: 'part-1', sourceParagraphIndex: 0,
        payload: { title: 'Rhythm', observation: 'Short sentences.', styleCategory: 'sentence_rhythm' } },
    ]);
    let stored: ReturnType<typeof profileRow> | null = null;
    f.tx.storyWorkGenerationProfile.findFirst.mockImplementation(({ where }) =>
      where.analysisJobId ? stored : null);
    f.tx.storyWorkGenerationProfile.create.mockImplementation(({ data }) => {
      stored = profileRow(data);
      return stored;
    });
    const job = { id: analysisId, workId, manuscriptVersionId: manuscriptId, actorUserId: owner,
      pipeline: 'semantic_extraction_v1', status: 'running', phase: 'finalizing',
      analysisVersion: 2, sourceContentHash: 'a'.repeat(64),
      configHash: 'b'.repeat(64), totalParts: 2, totalParagraphs: 3 } as never;

    const first = await f.service.createDraftAtCompletion(f.tx as never, job);
    const replay = await f.service.createDraftAtCompletion(f.tx as never, job);

    expect(replay).toBe(first);
    expect(first.status).toBe('needs_review');
    expect(first.approvedSettings).toBeNull();
    expect(first.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.draftFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(f.tx.storyWorkGenerationProfile.create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(f.tx.storyAnalysisEvidence.findMany).toHaveBeenCalledTimes(1);
    expect(snapshotBarriers(f)).toHaveLength(1);
  });

  it('refuses to backfill a historically completed job', async () => {
    const f = fixture();
    await expect(f.service.createDraftAtCompletion(f.tx as never, {
      actorUserId: owner, pipeline: 'semantic_extraction_v1', status: 'completed', phase: 'completed',
    } as never)).rejects.toThrow('Invalid semantic profile source');
    expect(f.tx.storyWorkGenerationProfile.create).not.toHaveBeenCalled();
  });

  it('does not approve a stale reviewed draft', async () => {
    const f = fixture();
    sourceMocks(f.prisma);
    f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(profileRow({
      sourceFingerprint: expect.anything(),
      draftSettings: reviewedSettings(),
      draftFingerprint: 'd'.repeat(64),
    }));

    await expect(f.service.approve(owner, workId, {
      expectedDraftFingerprint: 'e'.repeat(64),
    })).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.storyWorkGenerationProfile.updateMany).not.toHaveBeenCalled();
  });

  it('supersedes untouched AI observations and style examples when the author corrects a summary', async () => {
    const f = fixture(); sourceMocks(f.prisma);
    const original = reviewedSettings();
    original.sections[0].value.categories = [{ category: 'sentence_rhythm', observations: ['Short clauses'] }];
    f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(profileRow({ draftSettings: original }));
    f.tx.storyWorkGenerationProfile.update.mockImplementation(async ({ data }) => profileRow(data));
    const edited = JSON.parse(JSON.stringify(original)) as CreatorGenerationProfileSettings;
    edited.sections[0].decision = 'edited';
    edited.sections[0].value.summary = 'Use long, reflective sentences with a limited third-person narrator.';
    edited.sections[0].evidence = [{ sourceType: 'manuscript', sourceRef: `analysis:${styleEvidenceId}`, summary: 'Reviewed source' }];

    await f.service.update(owner, workId, { settings: edited });
    expect(snapshotBarriers(f)).toHaveLength(1);
    const saved = f.tx.storyWorkGenerationProfile.update.mock.calls[0][0].data.draftSettings;
    expect(saved.sections.find((section: { key: string }) => section.key === 'writing_style')).toMatchObject({ decision: 'edited', value: {
      summary: edited.sections[0].value.summary, observations: [], categories: [],
    }, evidence: edited.sections[0].evidence });
    expect(saved.sections.find((section: { key: string }) => section.key === 'scene_scale')).toEqual(original.sections[1]);

    f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(profileRow({ sourceFingerprint: sourceFingerprint(),
      draftSettings: saved, draftFingerprint: 'e'.repeat(64) }));
    f.tx.storyWorkGenerationProfile.updateMany.mockResolvedValue({ count: 1 });
    f.tx.storyWorkGenerationProfile.findUniqueOrThrow.mockResolvedValue(profileRow({ status: 'approved', approvedSettings: saved }));
    await f.service.approve(owner, workId, { expectedDraftFingerprint: 'e'.repeat(64) });
    expect(snapshotBarriers(f)).toHaveLength(2);
    expect(f.tx.storyMemoryRecord.updateMany).toHaveBeenCalled();
    expect(f.tx.storyMemoryRecord.createMany).not.toHaveBeenCalled();
    const approved = f.tx.storyWorkGenerationProfile.updateMany.mock.calls[0][0].data.approvedSettings;
    expect(approved.sections.find((section: { key: string }) => section.key === 'writing_style').value.summary)
      .toBe(edited.sections[0].value.summary);
    const context = continuationGenerationProfileSnapshot(profileRow({ status: 'approved',
      approvedSettings: approved, approvedFingerprint: creatorGenerationProfileFingerprint('c'.repeat(64), approved) }) as never);
    expect(context.approved.sections.find(section => section.key === 'writing_style')?.value)
      .toEqual({ summary: edited.sections[0].value.summary, referenceScope: 'production_constraint' });
    expect(JSON.stringify(context.approved)).not.toContain('Short clauses');
  });

  it('preserves explicit replacement observations instead of removing the author own revision', async () => {
    const f = fixture(); sourceMocks(f.prisma);
    const original = reviewedSettings();
    f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(profileRow({ draftSettings: original }));
    f.tx.storyWorkGenerationProfile.update.mockImplementation(async ({ data }) => profileRow(data));
    const edited = JSON.parse(JSON.stringify(original)) as CreatorGenerationProfileSettings;
    edited.sections[0].decision = 'edited'; edited.sections[0].value.summary = 'Author revised style';
    edited.sections[0].value.observations = [{ sourceRef: `analysis:${styleEvidenceId}`, title: 'Author review', detail: 'Long reflective clauses' }];
    await f.service.update(owner, workId, { settings: edited });
    expect(f.tx.storyWorkGenerationProfile.update.mock.calls[0][0].data.draftSettings.sections
      .find((section: { key: string }) => section.key === 'writing_style').value)
      .toEqual(edited.sections[0].value);
  });

  it('proposes retained world and cast references for explicit author review, not automatic approval', async () => {
    const f = fixture();
    f.tx.storyAnalysisEvidence.findMany.mockResolvedValue([{ id: styleEvidenceId, evidenceType: 'style',
      sourcePartKey: 'part-1', sourceParagraphIndex: 0, payload: { observation: 'Original style' } }]);
    const visualBible = { era: 'Korean modern city', artStyle: 'Illustrated cinema', palette: 'Gray and green',
      characters: [{ name: '윤해원', appearance: 'Adult woman, dark hair, green jacket' }], prohibited: ['poster montage'] };
    const reference = { contract: 'publication-visual-source-v1', sourceBindingSha256: 'a'.repeat(64),
      approvalState: 'reference_only', prompts: [], visualBible };
    const result = await (f.service as any).settingsFromAnalysis(f.tx, analysisId, { id: manuscriptId, version: 1, locale: 'ko',
      structuredBody: { parts: [], publicationVisualSource: { ...reference, checksum: releaseChecksum(reference) } } });
    expect(result.sections.find((row: { key: string }) => row.key === 'visual_direction')).toMatchObject({
      decision: 'proposed', value: { visualBible: { era: visualBible.era, artStyle: visualBible.artStyle, palette: visualBible.palette,
        prohibited: visualBible.prohibited } }, evidence: [expect.objectContaining({ sourceType: 'visual' })] });
    expect(result.sections.find((row: { key: string }) => row.key === 'visual_cast')).toMatchObject({
      decision: 'proposed', value: { characters: visualBible.characters } });
    expect(f.tx.storyWorkGenerationProfile.updateMany).not.toHaveBeenCalled();
    expect(f.tx.storyMemoryRecord.createMany).not.toHaveBeenCalled();
  });

  it.each([false, true])('does not retain hidden imported anchors in summary-only clients (reviewed controls %s)', async reviewed => {
    const f = fixture(); sourceMocks(f.prisma);
    const original = reviewedSettings();
    original.sections.find(row => row.key === 'visual_cast')!.value.characters = [{ name: 'Old face', appearance: 'Old identity' }];
    f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(profileRow({ draftSettings: original }));
    f.tx.storyWorkGenerationProfile.update.mockImplementation(async ({ data }) => profileRow(data));
    const edited = JSON.parse(JSON.stringify(original)) as CreatorGenerationProfileSettings;
    const cast = edited.sections.find(row => row.key === 'visual_cast')!;
    cast.decision = 'edited'; cast.value.summary = 'Author revised appearance';
    if (reviewed) cast.value.visualReviewVersion = 'story-visual-review-v1';
    await f.service.update(owner, workId, { settings: edited });
    const saved = f.tx.storyWorkGenerationProfile.update.mock.calls[0][0].data.draftSettings.sections
      .find((row: { key: string }) => row.key === 'visual_cast').value;
      expect(saved.visualReviewVersion).toBeUndefined();
    if (reviewed) expect(saved.characters).toEqual(original.sections.find(row => row.key === 'visual_cast')!.value.characters);
    else expect(saved.characters).toBeUndefined();
  });

  it('refuses an oversized downstream context before writing an approved profile', async () => {
    const f = fixture(); sourceMocks(f.prisma);
    const settings = reviewedSettings();
    settings.sections.find(row => row.key === 'visual_direction')!.value.visualBible = {
      era: 'x'.repeat(800), artStyle: 'x'.repeat(800), palette: 'x'.repeat(800), prohibited: new Array(24).fill('x'.repeat(200)) };
    settings.sections.find(row => row.key === 'visual_cast')!.value.characters = Array.from({ length: 16 }, (_, i) =>
      ({ name: `Actor${i}`, appearance: '가'.repeat(300) }));
    f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(profileRow({ draftSettings: settings, draftFingerprint: 'e'.repeat(64) }));
    await expect(f.service.approve(owner, workId, { expectedDraftFingerprint: 'e'.repeat(64) }))
      .rejects.toMatchObject({ response: { code: 'GENERATION_PROFILE_CONTEXT_INVALID' } });
    expect(f.tx.storyWorkGenerationProfile.updateMany).not.toHaveBeenCalled();
  });

  it('indexes approved style and facts, excluding removed notes and superseding older memories', async () => {
    const f = fixture();
    sourceMocks(f.prisma);
    const entityId = '00000000-0000-4000-8000-000000000301';
    const eventId = '00000000-0000-4000-8000-000000000302';
    const omittedId = '00000000-0000-4000-8000-000000000303';
    const styleId = '00000000-0000-4000-8000-000000000304';
    const settings = reviewedSettings();
    for (const section of settings.sections) {
      if (section.key === 'writing_style') section.value = { observations: [
        { sourceRef: `analysis:${styleId}`, title: '문장 리듬', detail: '긴 회상 뒤 짧은 현재형 문장으로 전환한다.' },
      ] };
      if (section.key === 'canon') section.value = { observations: [
        { sourceRef: `analysis:${entityId}`, title: '주인공', detail: '왼손을 다친 채 항구에 도착한다.' },
      ] };
      if (section.key === 'timeline') section.value = { observations: [
        { sourceRef: `analysis:${eventId}`, title: '도착', detail: '폭풍이 지나간 뒤에 도착한다.' },
      ] };
      if (section.key === 'narrative_devices') {
        section.decision = 'removed';
        section.value = { observations: [
          { sourceRef: `analysis:${omittedId}`, title: '제외한 복선', detail: '저장하지 않는다.' },
        ] };
      }
    }
    f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(profileRow({ draftSettings: settings }));
    f.tx.storyWorkGenerationProfile.updateMany.mockResolvedValue({ count: 1 });
    f.tx.storyWorkGenerationProfile.findUniqueOrThrow.mockResolvedValue(profileRow({
      status: 'approved', draftSettings: settings,
    }));
    f.tx.storyAnalysisEvidence.findMany.mockResolvedValue([
      { id: styleId, evidenceType: 'style', sourcePartKey: 'part-1' },
      { id: entityId, evidenceType: 'entity', sourcePartKey: 'part-1' },
      { id: eventId, evidenceType: 'event', sourcePartKey: 'part-2' },
    ]);

    await f.service.approve(owner, workId, { expectedDraftFingerprint: 'd'.repeat(64) });

    expect(f.tx.storyAnalysisEvidence.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: [entityId, eventId, styleId] }, analysisJobId: analysisId,
        provenance: 'semantic_candidate' },
    }));
    expect(f.tx.storyMemoryRecord.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ analysisJobId: analysisId, status: 'approved',
        provenance: 'writer_approved_semantic' }),
      data: { status: 'superseded' },
    }));
    const created = f.tx.storyMemoryRecord.createMany.mock.calls[0][0].data;
    expect(created).toHaveLength(3);
    expect(created).toEqual(expect.arrayContaining([
      expect.objectContaining({ memoryType: 'style', evidenceIds: [styleId],
        content: { ko: '문장 리듬: 긴 회상 뒤 짧은 현재형 문장으로 전환한다.' } }),
      expect.objectContaining({ memoryType: 'entity', evidenceIds: [entityId],
        content: { ko: '주인공: 왼손을 다친 채 항구에 도착한다.' } }),
      expect.objectContaining({ memoryType: 'event', evidenceIds: [eventId],
        content: { ko: '도착: 폭풍이 지나간 뒤에 도착한다.' } }),
    ]));
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metadata: expect.objectContaining({ approvedMemoryCount: 3 }) }),
    }));
  });

  it('does not persist unverified references from a reviewed section', async () => {
    const f = fixture();
    sourceMocks(f.prisma);
    const settings = reviewedSettings();
    settings.sections.find((section) => section.key === 'canon')!.value = { observations: [
      { sourceRef: 'analysis:00000000-0000-4000-8000-000000000399', detail: '다른 분석의 인물' },
    ] };
    f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(profileRow({ draftSettings: settings }));
    f.tx.storyWorkGenerationProfile.updateMany.mockResolvedValue({ count: 1 });
    f.tx.storyWorkGenerationProfile.findUniqueOrThrow.mockResolvedValue(profileRow({ status: 'approved' }));
    f.tx.storyAnalysisEvidence.findMany.mockResolvedValue([]);

    await f.service.approve(owner, workId, { expectedDraftFingerprint: 'd'.repeat(64) });

    expect(f.tx.storyMemoryRecord.createMany).not.toHaveBeenCalled();
    expect(f.tx.storyMemoryRecord.updateMany).toHaveBeenCalledTimes(1);
  });
});

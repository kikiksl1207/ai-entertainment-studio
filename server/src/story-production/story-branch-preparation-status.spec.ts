import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StoryProductionController } from './story-production.controller';
import { StoryProductionService } from './story-production.service';

describe('owner branch preparation status', () => {
  const owner = '00000000-0000-4000-8000-000000000001';
  const manuscriptId = '00000000-0000-4000-8000-000000000002';
  const workId = '00000000-0000-4000-8000-000000000003';
  const releaseId = '00000000-0000-4000-8000-000000000004';
  const hash = 'a'.repeat(64);
  const rows = [
    { partIndex: 0, expectedPartCount: 2, partKey: 'opening', status: 'awaiting_author_consent' },
    { partIndex: 1, expectedPartCount: 2, partKey: 'ending', status: 'awaiting_author_consent' },
  ];

  function fixture() {
    const manuscript = { id: manuscriptId, workId, version: 2, locale: 'ko', contentHash: hash };
    const latest = { version: 2 };
    const analysis = { id: 'analysis', totalParagraphs: 4, completedParagraphs: 4 };
    const review = { id: 'review', state: 'submitted', analysisJobId: analysis.id };
    const submission = { status: 'submitted', checksum: hash, manuscriptVersionId: manuscriptId };
    const consent = { ownerUserId: owner, manuscriptVersionId: manuscriptId, status: 'active',
      rightsConfirmed: true, aiBranchAllowed: true, allowedLocales: ['ko'],
      startsAt: new Date('2020-01-01'), expiresAt: null };
    const release = { id: releaseId, validationSummary: { ready: false } };
    const studioJob = { manuscriptVersionId: manuscriptId, ownerUserId: owner, workId,
      status: 'queued', totalParts: 2, completedParts: 0 };
    const prisma = {
      storyManuscriptVersion: { findFirst: jest.fn(async ({ where }): Promise<typeof manuscript | typeof latest | null> =>
        where.id ? manuscript : latest) },
      storyBranchPreparationJob: { findMany: jest.fn().mockResolvedValue(rows) },
      storyAnalysisJob: { findFirst: jest.fn().mockResolvedValue(analysis) },
      storyWriterReview: { findFirst: jest.fn().mockResolvedValue(review) },
      storyFinalSubmission: { findUnique: jest.fn().mockResolvedValue(submission) },
      storyStyleProfileConsent: { findUnique: jest.fn().mockResolvedValue(consent) },
      storyRelease: { findFirst: jest.fn().mockResolvedValue(release) },
      storyStudioChoiceJob: { findUnique: jest.fn().mockResolvedValue(studioJob) },
    };
    const read = () => new StoryProductionService(prisma as never).branchPreparationStatus(owner, manuscriptId);
    return { prisma, manuscript, latest, analysis, review, submission, consent, release, studioJob, read };
  }

  it('mounts only an authenticated manuscript-scoped read route', () => {
    const handler = StoryProductionController.prototype.branchPreparations;
    expect(Reflect.getMetadata(PATH_METADATA, handler))
      .toBe('me/creator-studio/manuscripts/:manuscriptId/branch-preparations');
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard]);
  });

  it('does not mistake upload intents for processing and keeps the response private', async () => {
    const f = fixture();
    f.prisma.storyAnalysisJob.findFirst.mockResolvedValue(null);
    const result = await f.read();
    expect(result).toMatchObject({ manuscriptVersionId: manuscriptId, version: 2, locale: 'ko',
      latestVersion: 2, status: 'awaiting_analysis', partStatusSource: 'upload_intent_rows',
      parts: [{ partKey: 'opening', status: 'awaiting_author_consent' },
        { partKey: 'ending', status: 'awaiting_author_consent' }] });
    expect(JSON.stringify(result)).not.toMatch(/sourceHash|rawText|structuredBody|ownerUserId|expectedPartCount|contentHash/);
    expect(f.prisma.storyManuscriptVersion.findFirst).toHaveBeenCalledWith({
      where: { id: manuscriptId, ownerUserId: owner },
      select: { id: true, workId: true, version: true, locale: true, contentHash: true },
    });
    expect(f.prisma.storyBranchPreparationJob.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { manuscriptVersionId: manuscriptId, workId, ownerUserId: owner }, take: 1001,
    }));
    expect(f.prisma.storyStudioChoiceJob.findUnique).not.toHaveBeenCalled();
  });

  it('shows analysis failure without calling it a choice-preparation failure', async () => {
    const f = fixture();
    f.prisma.storyAnalysisJob.findFirst.mockImplementation(async ({ where }) =>
      where.status === 'completed' ? null : { status: 'failed' });
    await expect(f.read()).resolves.toMatchObject({ status: 'failed', failureStage: 'analysis' });
  });

  it('requires a submitted review bound to the completed analysis and source hash', async () => {
    const f = fixture();
    f.review.analysisJobId = 'other-analysis';
    await expect(f.read()).resolves.toMatchObject({ status: 'awaiting_review' });
    expect(f.prisma.storyFinalSubmission.findUnique).not.toHaveBeenCalled();
    f.review.analysisJobId = f.analysis.id;
    f.submission.checksum = 'b'.repeat(64);
    await expect(f.read()).resolves.toMatchObject({ status: 'awaiting_review' });
  });

  it('distinguishes absent or stale consent from missing materialization', async () => {
    const f = fixture();
    f.consent.manuscriptVersionId = 'other-version';
    await expect(f.read()).resolves.toMatchObject({ status: 'awaiting_author_consent' });
    f.consent.manuscriptVersionId = manuscriptId;
    f.prisma.storyRelease.findFirst.mockResolvedValue(null);
    await expect(f.read()).resolves.toMatchObject({ status: 'awaiting_materialization' });
  });

  it.each([
    ['queued', 'queued', 0],
    ['processing', 'in_progress', 1],
    ['failed', 'failed', 1],
  ])('projects the Studio %s job as %s without changing upload rows', async (jobState, expected, done) => {
    const f = fixture();
    f.studioJob.status = jobState;
    f.studioJob.completedParts = done;
    const result = await f.read();
    expect(result).toMatchObject({ status: expected, completedParts: done, totalParts: 2,
      parts: [{ status: 'awaiting_author_consent' }, { status: 'awaiting_author_consent' }] });
    if (jobState === 'failed') expect(result).toMatchObject({ failureStage: 'choice_preparation' });
  });

  it('reports prepared only for a completed, matching job and ready release', async () => {
    const f = fixture();
    f.studioJob.status = 'completed';
    f.studioJob.completedParts = 2;
    await expect(f.read()).resolves.toMatchObject({ status: 'incomplete' });
    f.release.validationSummary.ready = true;
    expect(await f.read()).toMatchObject({ status: 'prepared', completedParts: 2, totalParts: 2 });
    expect(await f.read()).toMatchObject({ status: 'prepared', completedParts: 2, totalParts: 2 });
    f.studioJob.totalParts = 3;
    await expect(f.read()).resolves.toMatchObject({ status: 'incomplete' });
  });

  it('identifies a superseded immutable version before projecting an old job', async () => {
    const f = fixture();
    f.latest.version = 3;
    await expect(f.read()).resolves.toMatchObject({ status: 'superseded', version: 2, latestVersion: 3 });
    f.prisma.storyBranchPreparationJob.findMany.mockResolvedValueOnce([]);
    await expect(f.read()).resolves.toMatchObject({ status: 'superseded', parts: [] });
    expect(f.prisma.storyAnalysisJob.findFirst).not.toHaveBeenCalled();
  });

  it('does not reveal whether a foreign manuscript exists', async () => {
    const f = fixture();
    f.prisma.storyManuscriptVersion.findFirst.mockResolvedValue(null);
    await expect(f.read()).rejects.toBeInstanceOf(NotFoundException);
    expect(f.prisma.storyBranchPreparationJob.findMany).not.toHaveBeenCalled();
  });

  it('keeps missing or incomplete upload rows explicitly incomplete', async () => {
    const f = fixture();
    f.prisma.storyBranchPreparationJob.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(rows.slice(0, 1));
    await expect(f.read()).resolves.toMatchObject({ status: 'not_prepared', parts: [] });
    await expect(f.read()).resolves.toMatchObject({ status: 'incomplete' });
    expect(f.prisma.storyAnalysisJob.findFirst).not.toHaveBeenCalled();
  });
});

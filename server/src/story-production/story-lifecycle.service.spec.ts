import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as authoredImport from './story-authored-import.service';
import { StoryLifecycleService } from './story-lifecycle.service';
import { StoryStudioChoicePreparationService } from './story-studio-choice-preparation.service';
import { StoryCompanyFinalSubmissionService } from './story-company-final-submission.service';

describe('company submission through the existing owned review POST', () => {
  function fixture() {
    const owner = randomUUID(), work = randomUUID(), manuscript = randomUUID(), analysis = randomUUID();
    const review = { id: randomUUID(), ownerUserId: owner, workId: work, manuscriptVersionId: manuscript,
      analysisJobId: analysis, state: 'analysis_ready', revision: 1, submittedAt: null };
    const db = { storyWork: { findFirst: jest.fn().mockResolvedValue({ id: work, ownerUserId: owner }) },
      storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue({ id: manuscript }) },
      storyAnalysisJob: { findUnique: jest.fn().mockResolvedValue({ id: analysis, workId: work, manuscriptVersionId: manuscript, status: 'completed' }) },
      storyWriterReview: { upsert: jest.fn().mockResolvedValue(review), findFirst: jest.fn().mockResolvedValue(review) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: work }]), $transaction: jest.fn() };
    db.$transaction.mockImplementation(async (run: (tx: typeof db) => Promise<unknown>) => run(db));
    const autoSubmitReview = jest.fn().mockResolvedValue(null);
    const currentSubmittedReview = jest.fn().mockResolvedValue(null);
    const service = new StoryLifecycleService(db as never, undefined, undefined,
      { autoSubmitReview, currentSubmittedReview } as unknown as StoryCompanyFinalSubmissionService);
    return { owner, work, manuscript, analysis, review, db, autoSubmitReview, currentSubmittedReview, service,
      open: () => service.openReview(owner, work, { manuscriptVersionId: manuscript, analysisJobId: analysis }) };
  }
  it('returns the bound company submission without claiming human confirmation or generation', async () => {
    const f = fixture(), submissionId = randomUUID(), submittedAt = new Date();
    f.autoSubmitReview.mockResolvedValue({ review: { ...f.review, state: 'submitted', revision: 2, submittedAt },
      submission: { id: submissionId, checksum: 'a'.repeat(64) }, bindingHash: 'b'.repeat(64), approvalBasis: 'company_delegation' });
    expect(await f.open()).toMatchObject({ reviewId: f.review.id, state: 'submitted', revision: 2,
      approvalBasis: 'company_delegation', companySubmission: { contract: 'story-company-final-submission-v1',
        scope: 'manuscript_submission', submissionId, manuscriptVersionId: f.manuscript,
        manuscriptHash: 'a'.repeat(64), analysisJobId: f.analysis, reviewRevision: 2,
        bindingHash: 'b'.repeat(64), humanSemanticReview: false, published: false, generationStarted: false } });
    expect(f.autoSubmitReview).toHaveBeenCalledWith(f.owner, f.review.id, 1);
  });
  it('retains the original manual review when company source does not qualify', async () => {
    const f = fixture(); expect(await f.open()).toMatchObject({ reviewId: f.review.id, state: 'analysis_ready', revision: 1 });
  });
  it('leaves uncertain company failures pending without exposing their message', async () => {
    const f = fixture(); f.autoSubmitReview.mockRejectedValue(new Error('SYNTHETIC_PRIVATE_DIAGNOSTIC'));
    const warning = jest.spyOn((f.service as any).logger, 'warn').mockImplementation(() => undefined);
    try {
      expect(await f.open()).toMatchObject({ state: 'analysis_ready', revision: 1 });
      expect(warning).toHaveBeenCalledWith('Company manuscript submission response needs reconciliation: Error');
    } finally { warning.mockRestore(); }
  });
  it('reconciles a concurrent committed submission instead of returning the pre-write review', async () => {
    const f = fixture(), latest = { ...f.review, state: 'submitted', revision: 2, submittedAt: new Date() };
    f.autoSubmitReview.mockRejectedValue(new ConflictException());
    f.db.storyWriterReview.findFirst.mockResolvedValue(latest);
    f.currentSubmittedReview.mockResolvedValue({ review: latest, submission: { id: randomUUID(), checksum: 'a'.repeat(64) },
      bindingHash: 'b'.repeat(64), approvalBasis: 'company_delegation' });
    const warning = jest.spyOn((f.service as any).logger, 'warn').mockImplementation(() => undefined);
    try {
      expect(await f.open()).toMatchObject({ state: 'submitted', revision: 2, approvalBasis: 'company_delegation' });
      expect(f.autoSubmitReview).toHaveBeenCalledTimes(1);
      expect(f.currentSubmittedReview).toHaveBeenCalledWith(f.owner, latest.id);
    } finally { warning.mockRestore(); }
  });
  it('returns a retryable failure when current state cannot be reconciled', async () => {
    const f = fixture(); f.autoSubmitReview.mockRejectedValue(new Error('SYNTHETIC_PRIVATE_DIAGNOSTIC'));
    f.db.storyWriterReview.findFirst.mockRejectedValue(new Error('SYNTHETIC_DB_DIAGNOSTIC'));
    const warning = jest.spyOn((f.service as any).logger, 'warn').mockImplementation(() => undefined);
    try {
      await expect(f.open()).rejects.toMatchObject({ response: { code: 'COMPANY_FINAL_REVIEW_UNCONFIRMED' } });
      expect(f.autoSubmitReview).toHaveBeenCalledTimes(1); expect(f.currentSubmittedReview).not.toHaveBeenCalled();
    } finally { warning.mockRestore(); }
  });
  it('checks owner and completed analysis before calling automatic submission', async () => {
    const f = fixture(); f.db.storyAnalysisJob.findUnique.mockResolvedValue({ status: 'running', manuscriptVersionId: f.manuscript } as never);
    await expect(f.open()).rejects.toBeInstanceOf(ConflictException);
    expect(f.autoSubmitReview).not.toHaveBeenCalled(); expect(f.db.storyWriterReview.upsert).not.toHaveBeenCalled();
  });
  it('locks the work before review insertion and commits before company submission', async () => {
    const f = fixture(), order: string[] = [];
    f.db.$queryRaw.mockImplementation(async () => { order.push('work lock'); return [{ id: f.work }]; });
    f.db.storyWriterReview.upsert.mockImplementation(async () => { order.push('review'); return f.review; });
    f.db.$transaction.mockImplementation(async run => {
      const result = await run(f.db); order.push('commit'); return result;
    });
    f.autoSubmitReview.mockImplementation(async () => { order.push('delegation'); return null; });
    await f.open();
    expect(order).toEqual(['work lock', 'review', 'commit', 'delegation']);
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
  });
  it('does not create a review after ownership changes before the locked read', async () => {
    const f = fixture();
    f.db.storyWork.findFirst.mockResolvedValueOnce({ id: f.work, ownerUserId: f.owner }).mockResolvedValueOnce(null as never);
    await expect(f.open()).rejects.toMatchObject({ status: 404 });
    expect(f.db.storyWriterReview.upsert).not.toHaveBeenCalled(); expect(f.autoSubmitReview).not.toHaveBeenCalled();
  });
  it('does not create a review when analysis is no longer completed after locking', async () => {
    const f = fixture();
    f.db.storyAnalysisJob.findUnique.mockResolvedValueOnce({ id: f.analysis, workId: f.work,
      manuscriptVersionId: f.manuscript, status: 'completed' }).mockResolvedValueOnce({
        id: f.analysis, workId: f.work, manuscriptVersionId: f.manuscript, status: 'running' });
    await expect(f.open()).rejects.toBeInstanceOf(ConflictException);
    expect(f.db.storyWriterReview.upsert).not.toHaveBeenCalled(); expect(f.autoSubmitReview).not.toHaveBeenCalled();
  });
  it('sanitizes an uncertain review creation failure without retrying submission', async () => {
    const f = fixture(); f.db.$transaction.mockRejectedValueOnce(new Error('SYNTHETIC_PRIVATE_WRITE_DETAIL'));
    await expect(f.open()).rejects.toMatchObject({ status: 503,
      response: { code: 'WRITER_REVIEW_OPEN_RETRY', message: 'The current manuscript review must be checked again' } });
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    expect(f.autoSubmitReview).not.toHaveBeenCalled(); expect(f.currentSubmittedReview).not.toHaveBeenCalled();
  });
});

describe('StoryLifecycleService', () => {
  const prisma = {
    storyWork: { findFirst: jest.fn() },
    storyManuscriptVersion: { findFirst: jest.fn() },
    storyRelease: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    storyMemoryRecord: { findMany: jest.fn() },
    storyWriterReview: { findFirst: jest.fn(), updateMany: jest.fn() },
    storyContinuityIssue: { findMany: jest.fn() },
    storyQualityEvent: { upsert: jest.fn() },
  };
  const service = new StoryLifecycleService(prisma as never);

  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  function publicationFixture(authored = true) {
    jest.spyOn(authoredImport, 'assertAuthoredImportPublicationTx').mockResolvedValue(
      authored ? { partIds: ['part-1'], sceneIds: ['scene-1', 'scene-2'] } : undefined,
    );
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'work-id' }]),
      storyWork: {
        findUnique: jest.fn().mockResolvedValue({ id: 'work-id', status: 'release_ready', releaseRevision: 1,
          activeReleaseId: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      asset: { findUnique: jest.fn() },
      storyRelease: {
        findFirst: jest.fn().mockResolvedValue({ id: 'release-id', version: 1, manuscriptVersionId: 'manuscript-id',
          validationSummary: { ready: true } }),
        update: jest.fn(),
      },
      storyAnalysisJob: { findFirst: jest.fn().mockResolvedValue(null) },
      storyAuthoredImport: { findUnique: jest.fn().mockResolvedValue(authored ? { id: 'import-id' } : null) },
      storyWriterReview: { findFirst: jest.fn().mockResolvedValue(null) },
      storyManuscriptVersion: { findUnique: jest.fn().mockResolvedValue(null) },
      storyPart: {
        findMany: jest.fn().mockResolvedValue([{ id: 'part-1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      storyScene: {
        findMany: jest.fn().mockResolvedValue([{ id: 'scene-1' }, { id: 'scene-2' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      storyChoice: { groupBy: jest.fn().mockResolvedValue([
        { sceneId: 'scene-1', _count: { _all: 3 } },
        { sceneId: 'scene-2', _count: { _all: 3 } },
      ]) },
      storyPublicationTransition: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'transition-id', fromStatus: 'release_ready',
          toStatus: 'published', beforeRevision: 1, afterRevision: 2, createdAt: new Date() }),
      },
      auditEvent: { create: jest.fn() },
    };
    const publicationPrisma = {
      storyPublicationTransition: tx.storyPublicationTransition,
      $transaction: jest.fn(async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx)),
    };
    return { tx, lifecycle: new StoryLifecycleService(publicationPrisma as never) };
  }

  const publish = (lifecycle: StoryLifecycleService) => lifecycle.transitionPublication(
    'admin-id', 'work-id', { toStatus: 'published', releaseId: 'release-id', expectedRevision: 1 }, 'publish-key-123',
  );

  it('returns an existing immutable release for the same snapshot checksum', async () => {
    prisma.storyWork.findFirst.mockResolvedValue({ id: 'work-id', ownerUserId: 'user-id' });
    prisma.storyManuscriptVersion.findFirst.mockResolvedValue({ id: 'manuscript-id' });
    prisma.storyRelease.findUnique.mockResolvedValue({
      id: 'release-id',
      version: 1,
      status: 'candidate',
      checksum: 'checksum',
      validationSummary: { ready: true },
      diffSummary: {},
      activatedAt: null,
      retiredAt: null,
      createdAt: new Date(),
    });

    const result = await service.createRelease('user-id', 'work-id', {
      manuscriptVersionId: 'manuscript-id',
      branchGraphSnapshot: { version: 1 },
      endingSetSnapshot: { version: 1 },
      sceneAssetManifest: { version: 1 },
      localizedDisplaySnapshot: { version: 1 },
      validationSummary: { ready: true },
    });

    expect(result.idempotentReplay).toBe(true);
    expect(prisma.storyRelease.create).not.toHaveBeenCalled();
  });

  it('returns at most 50 bounded memory records without full manuscript', async () => {
    prisma.storyWork.findFirst.mockResolvedValue({ id: 'work-id', ownerUserId: 'user-id' });
    prisma.storyMemoryRecord.findMany.mockResolvedValue([]);

    const result = await service.retrieveMemory('user-id', 'work-id', {
      partKey: 'part-12',
      types: 'entity,event',
    });

    expect(result).toEqual({ bounded: true, fullManuscriptIncluded: false, items: [] });
    expect(prisma.storyMemoryRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });

  it('blocks final confirmation while a critical continuity issue remains', async () => {
    prisma.storyWriterReview.findFirst.mockResolvedValue({
      id: 'review-id',
      ownerUserId: 'user-id',
      workId: 'work-id',
      analysisJobId: 'analysis-id',
      state: 'continuity_review',
      revision: 4,
    });
    prisma.storyContinuityIssue.findMany.mockResolvedValue([{ severity: 'critical' }]);

    await expect(
      service.transitionReview('user-id', 'review-id', {
        toState: 'final_confirmation',
        expectedRevision: 4,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.storyContinuityIssue.findMany).toHaveBeenCalledWith({
      where: {
        workId: 'work-id', analysisJobId: 'analysis-id', status: 'open',
        pathScope: 'author_original', pathKey: 'author_original',
      },
      select: { severity: true },
    });
    expect(prisma.storyWriterReview.updateMany).not.toHaveBeenCalled();
  });

  it('rejects quality events containing private or provider dimensions', async () => {
    await expect(
      service.recordQualityEvent({
        workId: 'work-id',
        releaseId: null,
        sessionKeyHash: 'hash',
        eventType: 'choice_selected',
        metricBucket: 'story_path',
        dimensions: { privateInput: 'blocked' },
        idempotencyKey: 'event-key',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.storyQualityEvent.upsert).not.toHaveBeenCalled();
  });

  it('blocks authored publication when an intended scene is missing', async () => {
    const { tx, lifecycle } = publicationFixture();
    tx.storyScene.findMany.mockResolvedValue([{ id: 'scene-1' }]);
    tx.storyChoice.groupBy.mockResolvedValue([{ sceneId: 'scene-1', _count: { _all: 3 } }]);

    await expect(publish(lifecycle)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.storyPart.updateMany).not.toHaveBeenCalled();
    expect(tx.storyRelease.update).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2])('blocks authored publication with %s choices in an intended scene', async (count) => {
    const { tx, lifecycle } = publicationFixture();
    tx.storyChoice.groupBy.mockResolvedValue([
      { sceneId: 'scene-1', _count: { _all: 3 } },
      ...(count ? [{ sceneId: 'scene-2', _count: { _all: count } }] : []),
    ]);

    await expect(publish(lifecycle)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.storyPart.updateMany).not.toHaveBeenCalled();
    expect(tx.storyRelease.update).not.toHaveBeenCalled();
  });

  it('publishes authored scenes when each has exactly three persisted choices', async () => {
    const { tx, lifecycle } = publicationFixture();

    await expect(publish(lifecycle)).resolves.toMatchObject({ toStatus: 'published', idempotentReplay: false });
    expect(tx.storyChoice.groupBy).toHaveBeenCalledWith({ by: ['sceneId'],
      where: { sceneId: { in: ['scene-1', 'scene-2'] }, position: { gt: 0 } }, _count: { _all: true } });
    expect(tx.storyPart.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.storyScene.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.storyRelease.update).toHaveBeenCalledTimes(1);
  });

  it('blocks a newly created draft from publishing without author, summary and verified cover', async () => {
    const { tx, lifecycle } = publicationFixture();
    tx.storyWork.findUnique.mockResolvedValue({ id: 'work-id', ownerUserId: 'owner-id',
      slug: `draft-${randomUUID()}`, status: 'release_ready', releaseRevision: 1,
      activeReleaseId: null, defaultLocale: 'ko', authorDisplayName: null,
      summary: {}, coverManifest: {} });
    await expect(publish(lifecycle)).rejects.toMatchObject({
      response: { code: 'STORY_PUBLICATION_METADATA_REQUIRED' },
    });
    expect(tx.storyPart.updateMany).not.toHaveBeenCalled();
    expect(tx.asset.findUnique).not.toHaveBeenCalled();
  });

  it('publishes a new draft only with an uploaded, active public image owned by its author', async () => {
    const { tx, lifecycle } = publicationFixture();
    const assetId = randomUUID();
    tx.storyWork.findUnique.mockResolvedValue({ id: 'work-id', ownerUserId: 'owner-id',
      slug: `draft-${randomUUID()}`, status: 'release_ready', releaseRevision: 1,
      activeReleaseId: null, defaultLocale: 'ko', authorDisplayName: '루미나',
      summary: { ko: '작품 소개' },
      coverManifest: { assetId, url: `/api/v1/assets/public/${assetId}/display` } });
    tx.asset.findUnique.mockResolvedValue({ id: assetId, assetType: 'image', visibility: 'public', storageProvider: 'r2',
      metadata: { uploadIntent: { status: 'uploaded', createdByUserId: 'owner-id' } } });
    await expect(publish(lifecycle)).resolves.toMatchObject({ toStatus: 'published' });
    expect(tx.asset.findUnique).toHaveBeenCalledWith({ where: { id: assetId } });
  });

  it.each(['other-owner', 'archived', 'local-storage'])('rejects a new draft cover that is %s', async (state) => {
    const { tx, lifecycle } = publicationFixture();
    const assetId = randomUUID();
    tx.storyWork.findUnique.mockResolvedValue({ id: 'work-id', ownerUserId: 'owner-id',
      slug: `draft-${randomUUID()}`, status: 'release_ready', releaseRevision: 1,
      activeReleaseId: null, defaultLocale: 'ko', authorDisplayName: '루미나',
      summary: { ko: '작품 소개' },
      coverManifest: { assetId, url: `/api/v1/assets/public/${assetId}/display` } });
    tx.asset.findUnique.mockResolvedValue({ id: assetId, assetType: 'image', visibility: 'public',
      storageProvider: state === 'local-storage' ? 'local' : 'r2',
      metadata: { uploadIntent: { status: 'uploaded',
        createdByUserId: state === 'other-owner' ? 'other-id' : 'owner-id' },
        lifecycle: { status: state === 'archived' ? 'archived' : 'active' } } });
    await expect(publish(lifecycle)).rejects.toMatchObject({
      response: { code: 'STORY_PUBLICATION_METADATA_REQUIRED' },
    });
    expect(tx.storyPart.updateMany).not.toHaveBeenCalled();
  });

  it('atomically promotes reviewed Studio drafts after their three choices are checked', async () => {
    jest.spyOn(StoryStudioChoicePreparationService.prototype, 'assertPublishableTx')
      .mockResolvedValue({ partIds: ['part-1'], sceneIds: ['scene-1', 'scene-2'] });
    const { tx, lifecycle } = publicationFixture(false);
    await expect(publish(lifecycle)).resolves.toMatchObject({ toStatus: 'published' });
    expect(tx.storyPart.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'draft', id: { in: ['part-1'] } }),
    }));
    expect(tx.storyPart.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.storyScene.updateMany).toHaveBeenCalledTimes(1);
  });

  it('keeps legacy publication permissive for scenes with fewer than three choices', async () => {
    const { tx, lifecycle } = publicationFixture(false);
    tx.storyChoice.groupBy.mockResolvedValue([{ sceneId: 'scene-1', _count: { _all: 1 } }]);

    await expect(publish(lifecycle)).resolves.toMatchObject({ toStatus: 'published' });
    expect(tx.storyPart.updateMany).not.toHaveBeenCalled();
    expect(tx.storyScene.updateMany).not.toHaveBeenCalled();
    expect(tx.storyRelease.update).toHaveBeenCalledTimes(1);
  });
});

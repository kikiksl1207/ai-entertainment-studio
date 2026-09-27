import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import * as authoredImport from './story-authored-import.service';
import { StoryLifecycleService } from './story-lifecycle.service';
import { StoryStudioChoicePreparationService } from './story-studio-choice-preparation.service';

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
      storyRelease: {
        findFirst: jest.fn().mockResolvedValue({ id: 'release-id', version: 1, manuscriptVersionId: 'manuscript-id',
          validationSummary: { ready: true } }),
        update: jest.fn(),
      },
      storyAnalysisJob: { findFirst: jest.fn().mockResolvedValue(null) },
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

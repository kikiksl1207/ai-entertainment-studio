import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { StoryLifecycleService } from './story-lifecycle.service';

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
});

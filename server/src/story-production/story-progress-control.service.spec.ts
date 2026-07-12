import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { StoryProgressControlService } from './story-progress-control.service';
import { STORY_PROGRESS_MESSAGE_KEYS } from './story-progress-control.policy';

describe('StoryProgressControlService', () => {
  const prisma = {
    storyCustomChoice: { findUnique: jest.fn(), create: jest.fn() },
    storyReaderProgress: { findFirst: jest.fn(), findUnique: jest.fn() },
    storyWork: { findFirst: jest.fn() },
    storyScene: { findFirst: jest.fn() },
    storyPart: { findFirst: jest.fn() },
    userEntitlement: { findFirst: jest.fn() },
    feedSearchBlockedTerm: { findMany: jest.fn() },
    storyResetQuotaBucket: { findMany: jest.fn() },
    storyProgressCheckpoint: { findFirst: jest.fn() },
  };
  const moderation = { preview: jest.fn() };
  const service = new StoryProgressControlService(prisma as never, moderation as never);

  const progress = {
    id: '00000000-0000-0000-0000-000000000001',
    userId: '00000000-0000-0000-0000-000000000002',
    workId: '00000000-0000-0000-0000-000000000003',
    currentSceneId: '00000000-0000-0000-0000-000000000004',
    currentAct: 1,
    progressRevision: 3,
    storyVersion: 2,
    status: 'active',
  };
  const work = {
    id: progress.workId,
    priceLumina: new Decimal(100),
    publishedVersion: 2,
    customChoiceEnabled: true,
  };
  const scene = { id: progress.currentSceneId, partId: '00000000-0000-0000-0000-000000000005' };
  const part = { id: scene.partId, workId: work.id, actNumber: 1 };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.storyCustomChoice.findUnique.mockResolvedValue(null);
    prisma.storyReaderProgress.findFirst.mockResolvedValue(progress);
    prisma.storyWork.findFirst.mockResolvedValue(work);
    prisma.storyScene.findFirst.mockResolvedValue(scene);
    prisma.storyPart.findFirst.mockResolvedValue(part);
    prisma.feedSearchBlockedTerm.findMany.mockResolvedValue([]);
    prisma.userEntitlement.findFirst.mockResolvedValue(null);
    moderation.preview.mockReturnValue({ decision: 'allow' });
  });

  it('does not trust a client paid flag when no active server entitlement exists', async () => {
    prisma.userEntitlement.findFirst.mockResolvedValue(null);

    await expect(
      service.submitCustomChoice(
        progress.userId,
        progress.id,
        { input: 'Take the east gate', expectedRevision: 3 },
        'custom-choice-key',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.storyCustomChoice.create).not.toHaveBeenCalled();
  });

  it('returns a safe receipt without echoing accepted private input', async () => {
    prisma.userEntitlement.findFirst.mockResolvedValue({ id: 'entitlement-id' });
    prisma.storyCustomChoice.create.mockResolvedValue({
      id: 'request-id',
      status: 'accepted',
      createdAt: new Date('2026-07-13T00:00:00.000Z'),
    });

    const result = await service.submitCustomChoice(
      progress.userId,
      progress.id,
      { input: '  Take the east gate  ', expectedRevision: 3 },
      'custom-choice-key',
    );

    expect(result).toEqual({
      requestId: 'request-id',
      status: 'accepted',
      acceptedAt: new Date('2026-07-13T00:00:00.000Z'),
      privateInputReturned: false,
    });
    expect(JSON.stringify(result)).not.toContain('Take the east gate');
  });

  it('returns a no-progress public projection without internal identifiers', async () => {
    prisma.storyReaderProgress.findUnique.mockResolvedValue(null);

    const result = await service.publicState(progress.userId, work.id);

    expect(result).toMatchObject({
      statusKey: STORY_PROGRESS_MESSAGE_KEYS.noProgress,
      canResume: false,
      fullResetRemaining: 1,
      actResetRemaining: 3,
      customChoiceCapability: false,
    });
    expect(JSON.stringify(result)).not.toContain(progress.id);
  });

  it('projects exhausted quotas separately from paid custom choice capability', async () => {
    prisma.storyReaderProgress.findUnique.mockResolvedValue(progress);
    prisma.storyResetQuotaBucket.findMany.mockResolvedValue([
      { scopeKey: 'full', usedCount: 1, limitCount: 1 },
      { scopeKey: 'act:1', usedCount: 3, limitCount: 3 },
    ]);
    prisma.storyProgressCheckpoint.findFirst.mockResolvedValue({
      actNumber: 1,
      beatPosition: 4,
    });
    prisma.userEntitlement.findFirst.mockResolvedValue({ id: 'entitlement-id' });

    const result = await service.publicState(progress.userId, work.id);

    expect(result).toMatchObject({
      statusKey: STORY_PROGRESS_MESSAGE_KEYS.quotaExhausted,
      fullResetRemaining: 0,
      actResetRemaining: 0,
      customChoiceCapability: true,
    });
    expect(result).not.toHaveProperty('progressId');
    expect(result).not.toHaveProperty('workId');
  });
});

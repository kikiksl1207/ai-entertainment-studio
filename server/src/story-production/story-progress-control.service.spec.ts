import 'reflect-metadata';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { StoryProgressControlService } from './story-progress-control.service';
import { STORY_PROGRESS_MESSAGE_KEYS } from './story-progress-control.policy';
import * as releasePolicy from './story-progress-control.policy';

describe('StoryProgressControlService', () => {
  const prisma = {
    storyCustomChoice: { findUnique: jest.fn(), create: jest.fn() },
    storyReaderProgress: { findFirst: jest.fn(), findUnique: jest.fn() },
    storyWork: { findFirst: jest.fn() },
    storyScene: { findFirst: jest.fn(), findMany: jest.fn() },
    storyPart: { findFirst: jest.fn(), findMany: jest.fn() },
    storyChoiceEvent: { count: jest.fn() },
    storyRelease: { findFirst: jest.fn() },
    storyReleaseCapability: { findUnique: jest.fn() },
    storyAiRateCard: { findUnique: jest.fn() },
    userEntitlement: { findFirst: jest.fn() },
    feedSearchBlockedTerm: { findMany: jest.fn() },
    storyResetQuotaBucket: { findMany: jest.fn(), findUnique: jest.fn() },
    storyProgressCheckpoint: { findFirst: jest.fn() },
    storyQualityEvent: { upsert: jest.fn() },
  };
  const moderation = { preview: jest.fn() };
  const service = new StoryProgressControlService(prisma as never, moderation as never);

  const progress = {
    id: '00000000-0000-0000-0000-000000000001',
    userId: '00000000-0000-0000-0000-000000000002',
    workId: '00000000-0000-0000-0000-000000000003',
    currentSceneId: '00000000-0000-0000-0000-000000000004',
    currentGeneratedSceneId: null,
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
    jest.restoreAllMocks();
    jest.clearAllMocks();
    prisma.storyCustomChoice.findUnique.mockResolvedValue(null);
    prisma.storyReaderProgress.findFirst.mockResolvedValue(progress);
    prisma.storyWork.findFirst.mockResolvedValue(work);
    prisma.storyScene.findFirst.mockResolvedValue(scene);
    prisma.storyPart.findFirst.mockResolvedValue(part);
    prisma.feedSearchBlockedTerm.findMany.mockResolvedValue([]);
    prisma.userEntitlement.findFirst.mockResolvedValue(null);
    moderation.preview.mockReturnValue({ decision: 'allow' });
    prisma.storyQualityEvent.upsert.mockResolvedValue({ id: 'quality-event' });
  });

  it('targets the first scene of the first published part for a full reset', async () => {
    prisma.storyWork.findFirst.mockResolvedValue({
      ...work,
      priceLumina: new Decimal(0),
      status: 'published',
      fixtureSource: false,
      activeReleaseId: 'release-1',
      publishedAt: new Date('2026-09-20T00:00:00.000Z'),
    });
    prisma.storyPart.findFirst
      .mockResolvedValueOnce(part)
      .mockResolvedValueOnce({ id: 'part-1' });
    prisma.storyPart.findMany.mockResolvedValue([
      { id: 'part-1' },
      { id: 'part-14' },
      { id: 'part-66' },
    ]);
    prisma.storyScene.findMany.mockResolvedValue([
      { id: 'part-14-main', partId: 'part-14', position: 1 },
      { id: 'part-1-main', partId: 'part-1', position: 1 },
      { id: 'part-66-main', partId: 'part-66', position: 1 },
    ]);
    prisma.storyRelease.findFirst.mockResolvedValue({ id: 'release-1' });
    prisma.storyReleaseCapability.findUnique.mockResolvedValue({
      status: 'active',
      revision: 1,
      rateCardId: 'rate-card-1',
      fullResetLimit: 1,
      actResetLimit: 3,
    });
    prisma.storyAiRateCard.findUnique.mockResolvedValue({ id: 'rate-card-1', status: 'active' });
    prisma.storyChoiceEvent.count.mockResolvedValue(7);
    prisma.storyResetQuotaBucket.findUnique.mockResolvedValue(null);

    const result = await service.resetPreview(progress.userId, progress.id, {
      target: 'full',
      locale: 'ko',
    });

    expect(result).toMatchObject({
      target: 'full',
      targetAct: 1,
      targetSceneId: 'part-1-main',
      invalidatedEventCount: 7,
    });
    expect(prisma.storyPart.findFirst).toHaveBeenNthCalledWith(2, {
      where: { workId: work.id, actNumber: 1, status: 'published', fixtureSource: false },
      select: { id: true },
      orderBy: { position: 'asc' },
    });
    expect(prisma.storyChoiceEvent.count).toHaveBeenCalledWith({
      where: { progressId: progress.id, invalidatedAt: null },
    });
  });

  it('targets the first part in an act without narrowing the invalidated scene range', async () => {
    prisma.storyWork.findFirst.mockResolvedValue({ ...work, priceLumina: new Decimal(0) });
    prisma.storyPart.findFirst
      .mockResolvedValueOnce(part)
      .mockResolvedValueOnce({ id: 'part-30' });
    prisma.storyPart.findMany.mockResolvedValue([
      { id: 'part-30' },
      { id: 'part-45' },
      { id: 'part-66' },
    ]);
    prisma.storyScene.findMany.mockResolvedValue([
      { id: 'part-45-main', partId: 'part-45', position: 1 },
      { id: 'part-30-main', partId: 'part-30', position: 1 },
      { id: 'part-66-main', partId: 'part-66', position: 1 },
    ]);
    prisma.storyChoiceEvent.count.mockResolvedValue(3);
    prisma.storyResetQuotaBucket.findUnique.mockResolvedValue(null);

    const result = await service.resetPreview(progress.userId, progress.id, {
      target: 'act',
      actNumber: 2,
      locale: 'ko',
    });

    expect(result).toMatchObject({
      target: 'act',
      targetAct: 2,
      targetSceneId: 'part-30-main',
      invalidatedEventCount: 3,
    });
    expect(prisma.storyPart.findFirst).toHaveBeenNthCalledWith(2, {
      where: { workId: work.id, actNumber: 2, status: 'published', fixtureSource: false },
      select: { id: true },
      orderBy: { position: 'asc' },
    });
    expect(prisma.storyChoiceEvent.count).toHaveBeenCalledWith({
      where: {
        progressId: progress.id,
        invalidatedAt: null,
        sceneId: { in: ['part-45-main', 'part-30-main', 'part-66-main'] },
      },
    });
  });

  describe('completed ending reset preview', () => {
    beforeEach(() => {
      prisma.storyReaderProgress.findFirst.mockResolvedValue({ ...progress, status: 'completed', currentSceneId: null });
      prisma.storyWork.findFirst.mockResolvedValue({ ...work, priceLumina: new Decimal(0), status: 'published',
        fixtureSource: false, activeReleaseId: 'release-1', publishedAt: new Date(0) });
      prisma.storyPart.findMany.mockResolvedValue([{ id: part.id }]);
      prisma.storyScene.findMany.mockResolvedValue([{ id: scene.id, partId: part.id, position: 1 }]);
      prisma.storyRelease.findFirst.mockResolvedValue({ id: 'release-1' });
      prisma.storyReleaseCapability.findUnique.mockResolvedValue({ status: 'active', revision: 1,
        rateCardId: 'rate-card-1', fullResetLimit: 1, actResetLimit: 3 });
      prisma.storyAiRateCard.findUnique.mockResolvedValue({ id: 'rate-card-1', status: 'active' });
      prisma.storyChoiceEvent.count.mockResolvedValue(1);
      prisma.storyResetQuotaBucket.findUnique.mockResolvedValue(null);
    });

    it('allows full and act previews without inventing a current scene or changing progress', async () => {
      for (const target of ['full', 'act'] as const) {
        await expect(service.resetPreview(progress.userId, progress.id, { target, locale: 'ko',
          ...(target === 'act' ? { actNumber: 1 } : {}) })).resolves.toMatchObject({
          target, targetSceneId: scene.id, expectedRevision: progress.progressRevision, canExecute: true,
        });
      }
      expect(prisma.storyReaderProgress.findFirst).toHaveBeenCalledWith({ where: { id: progress.id, userId: progress.userId } });
      expect(prisma.storyPart.findFirst).toHaveBeenCalledWith({
        where: { workId: work.id, status: 'published', fixtureSource: false }, orderBy: { position: 'asc' },
      });
      expect(prisma.storyScene.findFirst).not.toHaveBeenCalled();
      expect(prisma.storyQualityEvent.upsert).not.toHaveBeenCalled();
    });

    it('still denies another reader before work or reset plan lookup', async () => {
      prisma.storyReaderProgress.findFirst.mockResolvedValue(null);
      await expect(service.resetPreview('other-reader', progress.id, { target: 'full', locale: 'ko' })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.storyWork.findFirst).not.toHaveBeenCalled();
      expect(prisma.storyChoiceEvent.count).not.toHaveBeenCalled();
    });

    it('does not turn an incomplete progress without a scene into a completed ending', async () => {
      prisma.storyReaderProgress.findFirst.mockResolvedValue({ ...progress, currentSceneId: null });
      await expect(service.resetPreview(progress.userId, progress.id, { target: 'full', locale: 'ko' })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.storyPart.findMany).not.toHaveBeenCalled();
    });

    it.each(['full', 'act'] as const)('previews %s reset from an owned active generated route using published entry access', async target => {
      prisma.storyReaderProgress.findFirst.mockResolvedValue({ ...progress, currentSceneId: null,
        currentGeneratedSceneId: '00000000-0000-0000-0000-000000000006' });
      await expect(service.resetPreview(progress.userId, progress.id, { target, locale: 'ko',
        ...(target === 'act' ? { actNumber: 1 } : {}) })).resolves.toMatchObject({
        target, canExecute: true, targetSceneId: scene.id, expectedRevision: progress.progressRevision,
      });
      expect(prisma.storyPart.findFirst).toHaveBeenCalledWith({
        where: { workId: work.id, status: 'published', fixtureSource: false }, orderBy: { position: 'asc' },
      });
      expect(prisma.storyScene.findFirst).not.toHaveBeenCalled();
      expect(prisma.storyQualityEvent.upsert).not.toHaveBeenCalled();
    });

    it('does not enable a non-active generated progress', async () => {
      prisma.storyReaderProgress.findFirst.mockResolvedValue({ ...progress, currentSceneId: null, status: 'paused',
        currentGeneratedSceneId: '00000000-0000-0000-0000-000000000006' });
      await expect(service.resetPreview(progress.userId, progress.id, { target: 'full', locale: 'ko' }))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.storyPart.findMany).not.toHaveBeenCalled();
    });

    it('does not bypass published entry access for an active generated route', async () => {
      prisma.storyReaderProgress.findFirst.mockResolvedValue({ ...progress, currentSceneId: null,
        currentGeneratedSceneId: '00000000-0000-0000-0000-000000000006' });
      prisma.storyWork.findFirst.mockResolvedValue(work);
      await expect(service.resetPreview(progress.userId, progress.id, { target: 'full', locale: 'ko' }))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.storyPart.findMany).not.toHaveBeenCalled();
    });

    it.each(['active', 'completed'])('rejects an outdated %s act preview before planning or quota lookup', async status => {
      prisma.storyReaderProgress.findFirst.mockResolvedValue({ ...progress, status,
        currentSceneId: status === 'completed' ? null : scene.id, storyVersion: 1 });
      await expect(service.resetPreview(progress.userId, progress.id, { target: 'act', actNumber: 1,
        locale: 'ko' })).rejects.toMatchObject({ response: {
        code: 'STORY_RESET_VERSION_MISMATCH', messageKey: STORY_PROGRESS_MESSAGE_KEYS.versionMismatch,
        retryable: false,
      } });
      expect(prisma.storyPart.findMany).not.toHaveBeenCalled();
      expect(prisma.storyResetQuotaBucket.findUnique).not.toHaveBeenCalled();
    });

    it('still previews a full reset onto the current release after the manuscript version changed', async () => {
      prisma.storyReaderProgress.findFirst.mockResolvedValue({ ...progress, status: 'completed',
        currentSceneId: null, storyVersion: 1 });
      await expect(service.resetPreview(progress.userId, progress.id, { target: 'full', locale: 'ko' }))
        .resolves.toMatchObject({ target: 'full', expectedRevision: progress.progressRevision, canExecute: true });
      expect(prisma.storyRelease.findFirst).toHaveBeenCalled();
    });

    it('keeps pending generation unavailable just like reset execution', async () => {
      prisma.storyReaderProgress.findFirst.mockResolvedValue({ ...progress, status: 'ai_pending' });
      await expect(service.resetPreview(progress.userId, progress.id, { target: 'full', locale: 'ko' })).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.storyWork.findFirst).not.toHaveBeenCalled();
    });

    it('retains paid access checks for the published entry part', async () => {
      prisma.storyWork.findFirst.mockResolvedValue(work);
      await expect(service.resetPreview(progress.userId, progress.id, { target: 'full', locale: 'ko' })).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.userEntitlement.findFirst).toHaveBeenCalled();
      expect(prisma.storyPart.findMany).not.toHaveBeenCalled();
    });

    it('keeps exhausted reset limits visible without charging or executing', async () => {
      prisma.storyResetQuotaBucket.findUnique.mockResolvedValue({ usedCount: 1, limitCount: 1 });
      await expect(service.resetPreview(progress.userId, progress.id, { target: 'full', locale: 'ko' })).resolves.toMatchObject({
        canExecute: false, remainingBefore: 0, remainingAfter: 0,
      });
      expect(prisma.storyQualityEvent.upsert).not.toHaveBeenCalled();
    });

    it.each(['work', 'part'] as const)('requires a published non-fixture %s', async missing => {
      if (missing === 'work') prisma.storyWork.findFirst.mockResolvedValue(null);
      else prisma.storyPart.findFirst.mockResolvedValue(null);
      await expect(service.resetPreview(progress.userId, progress.id, { target: 'full', locale: 'ko' })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.storyPart.findMany).not.toHaveBeenCalled();
    });
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

  it('retains future custom receipt privacy when a future release policy permits it', async () => {
    // Test-only future-policy simulation; no runtime override or request flag exists.
    jest.spyOn(releasePolicy, 'assertCustomChoiceReleasePolicy').mockImplementation(() => {});
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

  it('allows a reader to resume from an active AI-generated scene', async () => {
    prisma.storyReaderProgress.findUnique.mockResolvedValue({
      ...progress,
      currentSceneId: null,
      currentGeneratedSceneId: '00000000-0000-0000-0000-000000000006',
    });
    prisma.storyResetQuotaBucket.findMany.mockResolvedValue([]);
    prisma.storyProgressCheckpoint.findFirst.mockResolvedValue(null);
    prisma.userEntitlement.findFirst.mockResolvedValue({ id: 'entitlement-id' });

    await expect(service.publicState(progress.userId, work.id)).resolves.toMatchObject({
      statusKey: STORY_PROGRESS_MESSAGE_KEYS.ready,
      canResume: true,
    });
  });

  it('projects exhausted quotas while first-release paid custom choices remain deferred', async () => {
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
      customChoiceCapability: false,
    });
    expect(result).not.toHaveProperty('progressId');
    expect(result).not.toHaveProperty('workId');
  });
});

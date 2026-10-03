import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { StoryProductionService } from './story-production.service';

describe('reader start request collision recovery', () => {
  function fixture(target: unknown = ['user_id', 'work_id']) {
    const collision = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002', clientVersion: '6.6.0', meta: { target },
    });
    const progress = { id: 'saved-progress', storyVersion: 1 };
    const prisma = {
      storyPart: { findMany: jest.fn().mockResolvedValue([{ id: 'first-part', actNumber: 1 }]) },
      storyScene: { findFirst: jest.fn().mockResolvedValue({ id: 'first-scene' }) },
      storyReaderProgress: { findUnique: jest.fn().mockResolvedValueOnce(null).mockResolvedValue(progress) },
      storyQualityEvent: { upsert: jest.fn() },
      $transaction: jest.fn().mockRejectedValue(collision),
    };
    const service = new StoryProductionService(prisma as never);
    const work = jest.spyOn(service as any, 'publicWorkById').mockResolvedValue({
      id: 'work', publishedVersion: 1, priceLumina: new Decimal(0), activeReleaseId: null,
    });
    const projection = jest.spyOn(service, 'currentProgress').mockResolvedValue({ progressId: progress.id } as never);
    return { service, prisma, work, progress, projection, collision };
  }

  afterEach(() => jest.restoreAllMocks());

  it('returns the concurrently saved progress without a second creation or start event', async () => {
    const f = fixture();
    await expect(f.service.startProgress('reader', 'work', { mode: 'continue', locale: 'ko' }))
      .resolves.toEqual({ progressId: 'saved-progress' });
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(f.prisma.storyQualityEvent.upsert).not.toHaveBeenCalled();
    expect(f.work).toHaveBeenCalledTimes(2);
    expect(f.projection).toHaveBeenCalledWith('reader', 'saved-progress', 'ko');
  });

  it('checks the publication version again instead of joining obsolete progress', async () => {
    const f = fixture();
    f.progress.storyVersion = 2;
    await expect(f.service.startProgress('reader', 'work', { mode: 'continue', locale: 'ko' }))
      .rejects.toMatchObject({ response: { code: 'STORY_PROGRESS_VERSION_MISMATCH' } });
    expect(f.projection).not.toHaveBeenCalled();
  });

  it('checks access again if the public work becomes unavailable during the collision', async () => {
    const f = fixture();
    f.work.mockResolvedValueOnce({ id: 'work', publishedVersion: 1, priceLumina: new Decimal(0), activeReleaseId: null })
      .mockRejectedValue(new Error('Publication withdrawn'));
    await expect(f.service.startProgress('reader', 'work', { mode: 'continue', locale: 'ko' }))
      .rejects.toThrow('Publication withdrawn');
    expect(f.projection).not.toHaveBeenCalled();
  });

  it('does not turn a concurrent restart into an implicit reset', async () => {
    const f = fixture();
    await expect(f.service.startProgress('reader', 'work', { mode: 'restart', locale: 'ko' })).rejects.toBe(f.collision);
    expect(f.work).toHaveBeenCalledTimes(1);
  });

  it('keeps the explicit checkpoint requirement when no progress exists', async () => {
    const f = fixture();
    await expect(f.service.startProgress('reader', 'work', { mode: 'checkpoint', locale: 'ko' }))
      .rejects.toThrow('Checkpoint is not available');
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([['id'], ['work_id', 'id'], ['user_id', 'work_id', 'id'], undefined].map(target => [target]))
    ('does not hide an unrelated or unclassified unique constraint: %p', async target => {
      const f = fixture(target);
      if (target === undefined) f.collision.meta = {};
      await expect(f.service.startProgress('reader', 'work', { mode: 'continue', locale: 'ko' })).rejects.toBe(f.collision);
      expect(f.work).toHaveBeenCalledTimes(1);
    });

  it('bounds recovery if another collision occurs after the first', async () => {
    const f = fixture();
    f.prisma.storyReaderProgress.findUnique.mockReset().mockResolvedValue(null);
    await expect(f.service.startProgress('reader', 'work', { mode: 'continue', locale: 'ko' })).rejects.toBe(f.collision);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});

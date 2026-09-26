import { randomUUID } from 'crypto';
import { StoryStudioChoiceJobService } from './story-studio-choice-job.service';

function fixture() {
  const ids = { owner: randomUUID(), work: randomUUID(), release: randomUUID(), manuscript: randomUUID(),
    job: randomUUID(), firstPart: randomUUID(), secondPart: randomUUID(),
    firstScene: randomUUID(), secondScene: randomUUID() };
  const job: any = { id: ids.job, ownerUserId: ids.owner, workId: ids.work, releaseId: ids.release,
    manuscriptVersionId: ids.manuscript, status: 'queued', totalParts: 2, completedParts: 0,
    leaseToken: null, leaseExpiresAt: null, errorCode: null };
  const counts = new Map<string, number>([[ids.firstScene, 1], [ids.secondScene, 1]]);
  const db: any = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: ids.job }]),
    $transaction: jest.fn(async (run: (tx: unknown) => Promise<unknown>) => run(db)),
    storyStudioChoiceJob: {
      findUnique: jest.fn(async () => job),
      updateMany: jest.fn(async ({ where, data }) => {
        if (where.leaseToken && where.leaseToken !== job.leaseToken) return { count: 0 };
        Object.assign(job, data); return { count: 1 };
      }),
      update: jest.fn(async ({ data }) => { Object.assign(job, data); return job; }),
    },
    storyWork: { findFirst: jest.fn().mockResolvedValue({ id: ids.work, ownerUserId: ids.owner }) },
    storyRelease: { findFirst: jest.fn().mockResolvedValue({ id: ids.release, manuscriptVersionId: ids.manuscript }),
      update: jest.fn().mockResolvedValue({}) },
    storyPart: { findMany: jest.fn().mockResolvedValue([{ id: ids.firstPart }, { id: ids.secondPart }]) },
    storyScene: { findMany: jest.fn().mockResolvedValue([
      { id: ids.firstScene, partId: ids.firstPart }, { id: ids.secondScene, partId: ids.secondPart },
    ]) },
    storyChoice: { findMany: jest.fn(async () => [...counts].flatMap(([sceneId, count]) =>
      Array.from({ length: count }, () => ({ sceneId })))) },
  };
  const choices = { prepare: jest.fn(async (_owner: string, _work: string, _release: string, sceneId: string) => {
    counts.set(sceneId, 3);
  }), assertPublishableTx: jest.fn().mockResolvedValue({}) };
  const service = new StoryStudioChoiceJobService(db as never, choices as never);
  jest.spyOn(service as any, 'claim').mockImplementation(async () => {
    if (job.status !== 'queued') return null;
    const leaseToken = randomUUID();
    Object.assign(job, { status: 'processing', leaseToken });
    return { id: ids.job, leaseToken };
  });
  return { ids, job, counts, db, choices, service };
}

describe('durable Studio choice preparation', () => {
  it('claims one expired or queued job with a database lease', async () => {
    const f = fixture();
    jest.mocked((f.service as any).claim).mockRestore();
    const claim = await (f.service as any).claim();
    expect(claim).toMatchObject({ id: f.ids.job });
    expect(claim.leaseToken).toMatch(/^[a-f0-9-]{36}$/);
    const query = f.db.$queryRaw.mock.calls[0][0];
    expect(query.strings.join(' ')).toContain('FOR UPDATE SKIP LOCKED');
    expect(query.strings.join(' ')).toContain('lease_expires_at < CURRENT_TIMESTAMP');
  });

  it('prepares one scene at a time, then validates the complete release without browser requests', async () => {
    const f = fixture();
    await expect(f.service.executeOne()).resolves.toBe('progress');
    expect(f.choices.prepare).toHaveBeenCalledWith(f.ids.owner, f.ids.work, f.ids.release, f.ids.firstScene,
      expect.any(String));
    expect(f.job).toMatchObject({ status: 'queued', completedParts: 1, leaseToken: null });
    await expect(f.service.executeOne()).resolves.toBe('progress');
    expect(f.choices.prepare).toHaveBeenCalledWith(f.ids.owner, f.ids.work, f.ids.release, f.ids.secondScene,
      expect.any(String));
    await expect(f.service.executeOne()).resolves.toBe('completed');
    expect(f.choices.prepare).toHaveBeenCalledTimes(2);
    expect(f.choices.assertPublishableTx).toHaveBeenCalledWith(f.db, f.ids.work, f.ids.owner,
      f.ids.manuscript, f.ids.release);
    expect(f.db.storyRelease.update).toHaveBeenCalledWith({ where: { id: f.ids.release },
      data: { validationSummary: expect.objectContaining({ ready: true }) } });
    expect(f.job).toMatchObject({ status: 'completed', completedParts: 2, leaseToken: null });
  });

  it('resumes after a stored scene without generating it again', async () => {
    const f = fixture();
    f.counts.set(f.ids.firstScene, 3);
    await expect(f.service.executeOne()).resolves.toBe('progress');
    expect(f.choices.prepare).toHaveBeenCalledTimes(1);
    expect(f.choices.prepare).toHaveBeenCalledWith(f.ids.owner, f.ids.work, f.ids.release, f.ids.secondScene,
      expect.any(String));
    expect(f.job.completedParts).toBe(2);
  });

  it('stops after provider failure and requires an explicit owner retry', async () => {
    const f = fixture();
    f.choices.prepare.mockRejectedValueOnce(new Error('provider failed'));
    await expect(f.service.executeOne()).resolves.toBe('failed');
    expect(f.job).toMatchObject({ status: 'failed', errorCode: 'STUDIO_CHOICES_PREPARATION_FAILED' });
    expect(f.db.storyRelease.update).not.toHaveBeenCalled();
    await expect(f.service.retry(f.ids.owner, f.ids.work, f.ids.release))
      .resolves.toEqual({ releaseId: f.ids.release, status: 'queued' });
    expect(f.job.status).toBe('queued');
    f.service.onModuleDestroy();
  });

  it('fails closed on a partial choice set instead of replacing authored choices', async () => {
    const f = fixture();
    f.counts.set(f.ids.firstScene, 2);
    await expect(f.service.executeOne()).resolves.toBe('failed');
    expect(f.choices.prepare).not.toHaveBeenCalled();
    expect(f.db.storyRelease.update).not.toHaveBeenCalled();
    expect(f.job.errorCode).toBe('STUDIO_CHOICES_PARTIAL_SET');
  });
});

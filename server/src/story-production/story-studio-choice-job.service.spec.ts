import { ConflictException } from '@nestjs/common';
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
      findUnique: jest.fn(async () => ({ ...job })),
      updateMany: jest.fn(async ({ where, data }) => {
        if (Object.entries(where).some(([key, value]) => key === 'leaseExpiresAt'
          ? !job.leaseExpiresAt || job.leaseExpiresAt <= (value as { gt: Date }).gt
          : job[key] !== value)) return { count: 0 };
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
  const choices = { prepare: jest.fn(async (_owner: string, _work: string, _release: string, sceneId: string,
    _leaseToken?: string) => {
    counts.set(sceneId, 3);
  }), assertPreparedScenesTx: jest.fn().mockResolvedValue(undefined),
    assertPublishableTx: jest.fn().mockResolvedValue({}) };
  const service = new StoryStudioChoiceJobService(db as never, choices as never);
  jest.spyOn(service as any, 'claim').mockImplementation(async () => {
    const recovered = job.status === 'processing' && job.leaseExpiresAt < new Date();
    if (job.status !== 'queued' && !recovered) return null;
    const leaseToken = randomUUID();
    Object.assign(job, { status: 'processing', leaseToken, leaseExpiresAt: new Date(Date.now() + 60_000) });
    return { id: ids.job, leaseToken, recovered };
  });
  return { ids, job, counts, db, choices, service };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, failed) => { resolve = done; reject = failed; });
  return { promise, resolve, reject };
}

describe('Studio choice worker graceful shutdown', () => {
  it('stops before any claim, caches both lifecycle hooks and cannot restart', async () => {
    const f = fixture();
    const shutdown = f.service.onModuleDestroy();
    expect(f.service.beforeApplicationShutdown()).toBe(shutdown);
    expect(f.service.onModuleDestroy()).toBe(shutdown);
    await shutdown;
    f.service.onApplicationBootstrap();
    (f.service as any).schedule(0);
    await expect(f.service.executeOne()).resolves.toBe('idle');
    expect((f.service as any).claim).not.toHaveBeenCalled();
    expect(f.choices.prepare).not.toHaveBeenCalled();
    expect((f.service as any).timer).toBeUndefined();
  });

  it('coalesces concurrent execution in this worker into one claim and provider attempt', async () => {
    const f = fixture(), gate = deferred<void>(), entered = deferred<void>();
    f.choices.prepare.mockImplementationOnce(async () => {
      entered.resolve(); await gate.promise; f.counts.set(f.ids.firstScene, 3);
    });
    const active = f.service.executeOne();
    expect(f.service.executeOne()).toBe(active);
    await entered.promise;
    const shutdown = f.service.onModuleDestroy();
    await expect(f.service.executeOne()).resolves.toBe('idle');
    gate.resolve();
    await expect(active).resolves.toBe('progress');
    await shutdown;
    expect((f.service as any).claim).toHaveBeenCalledTimes(1);
    expect(f.choices.prepare).toHaveBeenCalledTimes(1);
    expect(f.job).toMatchObject({ status: 'queued', completedParts: 1, leaseToken: null });
  });

  it.each(['success', 'failure'])('waits for the active %s and its durable outcome before finishing shutdown', async outcome => {
    const f = fixture(), gate = deferred<void>(), entered = deferred<void>();
    f.choices.prepare.mockImplementationOnce(async () => {
      entered.resolve(); await gate.promise;
      if (outcome === 'failure') throw new Error('offline provider failure');
      f.counts.set(f.ids.firstScene, 3);
    });
    const active = f.service.executeOne();
    await entered.promise;
    let finished = false;
    const shutdown = f.service.onModuleDestroy().then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(f.job.status).toBe('processing');
    expect(f.db.storyStudioChoiceJob.updateMany).not.toHaveBeenCalled();
    gate.resolve();
    await expect(active).resolves.toBe(outcome === 'success' ? 'progress' : 'failed');
    await shutdown;
    expect(finished).toBe(true);
    expect(f.job).toMatchObject({ status: outcome === 'success' ? 'queued' : 'failed',
      completedParts: outcome === 'success' ? 1 : 0, leaseToken: null });
    expect(f.choices.prepare).toHaveBeenCalledTimes(1);
    expect((f.service as any).active).toBeUndefined();
  });

  it('drains a claim already in progress without introducing a second claim', async () => {
    const f = fixture(), gate = deferred<void>();
    const originalClaim = jest.mocked((f.service as any).claim).getMockImplementation()!;
    jest.mocked((f.service as any).claim).mockImplementationOnce(async () => {
      await gate.promise; return originalClaim();
    });
    const active = f.service.executeOne();
    const shutdown = f.service.beforeApplicationShutdown();
    gate.resolve();
    await expect(active).resolves.toBe('progress');
    await shutdown;
    expect((f.service as any).claim).toHaveBeenCalledTimes(1);
    expect(f.job).toMatchObject({ status: 'queued', completedParts: 1 });
  });

  it('waits for all-choice validation and release readiness in the current transaction', async () => {
    const f = fixture(), gate = deferred<void>(), entered = deferred<void>();
    f.counts.set(f.ids.firstScene, 3); f.counts.set(f.ids.secondScene, 3);
    f.choices.assertPublishableTx.mockImplementationOnce(async () => { entered.resolve(); await gate.promise; });
    const active = f.service.executeOne();
    await entered.promise;
    const shutdown = f.service.beforeApplicationShutdown();
    expect(f.db.storyRelease.update).not.toHaveBeenCalled();
    gate.resolve();
    await expect(active).resolves.toBe('completed');
    await shutdown;
    expect(f.job).toMatchObject({ status: 'completed', completedParts: 2 });
    expect(f.db.storyRelease.update).toHaveBeenCalledTimes(1);
    expect(f.choices.prepare).not.toHaveBeenCalled();
  });

  it('settles shutdown after a database rejection while preserving the executor rejection', async () => {
    const f = fixture(), gate = deferred<void>();
    jest.mocked((f.service as any).claim).mockImplementationOnce(async () => {
      await gate.promise; throw new Error('offline database unavailable');
    });
    const active = f.service.executeOne();
    const rejected = expect(active).rejects.toThrow('offline database unavailable');
    const shutdown = f.service.onModuleDestroy();
    gate.resolve();
    await rejected; await expect(shutdown).resolves.toBeUndefined();
    expect(f.choices.prepare).not.toHaveBeenCalled();
    expect(f.db.storyStudioChoiceJob.updateMany).not.toHaveBeenCalled();
  });

  it('reports bounded drain timeout without requeueing or declaring an unknown attempt complete', async () => {
    jest.useFakeTimers();
    const f = fixture(), gate = deferred<void>(), entered = deferred<void>();
    try {
      f.choices.prepare.mockImplementationOnce(async () => {
        entered.resolve(); await gate.promise; f.counts.set(f.ids.firstScene, 3);
      });
      const active = f.service.executeOne();
      await entered.promise;
      const shutdown = f.service.onModuleDestroy();
      const failed = expect(shutdown).rejects.toThrow('studio_choice_worker_drain_timeout');
      await jest.advanceTimersByTimeAsync(120_000);
      await failed;
      expect(f.job.status).toBe('processing');
      expect(f.db.storyStudioChoiceJob.updateMany).not.toHaveBeenCalled();
      expect(f.service.beforeApplicationShutdown()).toBe(shutdown);
      await expect(f.service.executeOne()).resolves.toBe('idle');
      // The late result remains subject to the original expired lease, not a shutdown override.
      gate.resolve();
      await expect(active).resolves.toBe('failed');
      expect(f.job).toMatchObject({ status: 'failed', errorCode: 'STUDIO_CHOICES_LEASE_CHANGED' });
      expect(f.db.storyRelease.update).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally { gate.resolve(); jest.useRealTimers(); }
  });

  it('clears a scheduled tick before it can claim', async () => {
    jest.useFakeTimers();
    const f = fixture();
    try {
      (f.service as any).schedule(0);
      await f.service.onModuleDestroy();
      await jest.runOnlyPendingTimersAsync();
      expect((f.service as any).claim).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
  });

  it('keeps a still-valid five-minute lease authoritative after drain timeout', async () => {
    jest.useFakeTimers();
    const f = fixture(), gate = deferred<void>(), entered = deferred<void>();
    try {
      f.choices.prepare.mockImplementationOnce(async () => {
        f.job.leaseExpiresAt = new Date(Date.now() + 300_000);
        entered.resolve(); await gate.promise; f.counts.set(f.ids.firstScene, 3);
      });
      const active = f.service.executeOne(); await entered.promise;
      const shutdown = f.service.onModuleDestroy();
      const rejected = expect(shutdown).rejects.toThrow('studio_choice_worker_drain_timeout');
      await jest.advanceTimersByTimeAsync(120_000); await rejected;
      expect(f.job.status).toBe('processing');
      expect(f.db.storyStudioChoiceJob.updateMany).not.toHaveBeenCalled();
      gate.resolve(); await expect(active).resolves.toBe('progress');
      expect(f.job).toMatchObject({ status: 'queued', completedParts: 1, leaseToken: null });
      expect(f.service.beforeApplicationShutdown()).toBe(shutdown);
      await expect(f.service.executeOne()).resolves.toBe('idle');
      expect(f.choices.prepare).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally { gate.resolve(); jest.useRealTimers(); }
  });

  it('clears a rejected scheduled claim and retries polling without restarting a paid attempt', async () => {
    jest.useFakeTimers();
    const f = fixture();
    const oldWorker = process.env.STORY_STUDIO_CHOICE_WORKER_ENABLED;
    const oldKey = process.env.STORY_CONTINUATION_OPENAI_API_KEY;
    try {
      process.env.STORY_STUDIO_CHOICE_WORKER_ENABLED = 'true';
      process.env.STORY_CONTINUATION_OPENAI_API_KEY = 'offline-unit-key';
      jest.mocked((f.service as any).claim).mockRejectedValueOnce(new Error('offline claim unavailable'));
      (f.service as any).schedule(0); await jest.advanceTimersByTimeAsync(0);
      expect((f.service as any).active).toBeUndefined();
      expect(f.choices.prepare).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(1);
      await jest.advanceTimersByTimeAsync(3_000);
      expect((f.service as any).claim).toHaveBeenCalledTimes(2);
      expect(f.choices.prepare).toHaveBeenCalledTimes(1);
      await f.service.onModuleDestroy(); expect(jest.getTimerCount()).toBe(0);
    } finally {
      await f.service.onModuleDestroy();
      if (oldWorker === undefined) delete process.env.STORY_STUDIO_CHOICE_WORKER_ENABLED;
      else process.env.STORY_STUDIO_CHOICE_WORKER_ENABLED = oldWorker;
      if (oldKey === undefined) delete process.env.STORY_CONTINUATION_OPENAI_API_KEY;
      else process.env.STORY_CONTINUATION_OPENAI_API_KEY = oldKey;
      jest.useRealTimers();
    }
  });

  it.each(['direct-continue', 'scheduled-continue', 'direct-stop', 'scheduled-stop'])(
    'coalesces a real owner retry during an active attempt and preserves polling: %s', async mode => {
      jest.useFakeTimers();
      const first = fixture(), retried = fixture(), gate = deferred<void>(), entered = deferred<void>();
      retried.job.status = 'failed';
      const rows = [first, retried];
      const selected = (id: string) => rows.find(row => Object.values(row.ids).some(value => value === id))!;
      const db: any = {
        $transaction: jest.fn(async (run: (tx: unknown) => Promise<unknown>) => run(db)),
        storyWork: { findFirst: jest.fn(async ({ where }) => ({ id: where.id,
          ownerUserId: selected(where.id).ids.owner })) },
        storyRelease: { findFirst: jest.fn(async ({ where }) => ({ id: where.id,
          manuscriptVersionId: selected(where.id).ids.manuscript })) },
        storyStudioChoiceJob: {
          findUnique: jest.fn(async ({ where }) => ({ ...selected(where.id).job })),
          updateMany: jest.fn(async args => selected(args.where.id ?? args.where.workId)
            .db.storyStudioChoiceJob.updateMany(args)),
        },
        storyPart: { findMany: jest.fn(async ({ where }) => selected(where.workId).db.storyPart.findMany()) },
        storyScene: { findMany: jest.fn(async ({ where }) => selected(where.partId.in[0]).db.storyScene.findMany()) },
        storyChoice: { findMany: jest.fn(async ({ where }) => selected(where.sceneId.in[0]).db.storyChoice.findMany()) },
      };
      const choices = { prepare: jest.fn(async (owner, work, release, scene, token) =>
        selected(work).choices.prepare(owner, work, release, scene, token)),
      assertPreparedScenesTx: jest.fn(), assertPublishableTx: jest.fn() };
      const service = new StoryStudioChoiceJobService(db, choices as never);
      const claim = jest.spyOn(service as any, 'claim').mockImplementation(async () => {
        const row = [retried, first].find(candidate => candidate.job.status === 'queued');
        if (!row) return null;
        Object.assign(row.job, { status: 'processing', leaseToken: randomUUID(),
          leaseExpiresAt: new Date(Date.now() + 300_000) });
        return { id: row.ids.job, leaseToken: row.job.leaseToken, recovered: false };
      });
      const old = { node: process.env.NODE_ENV, worker: process.env.STORY_STUDIO_CHOICE_WORKER_ENABLED,
        key: process.env.STORY_CONTINUATION_OPENAI_API_KEY };
      try {
        process.env.NODE_ENV = 'production'; process.env.STORY_STUDIO_CHOICE_WORKER_ENABLED = 'true';
        process.env.STORY_CONTINUATION_OPENAI_API_KEY = 'offline-unit-key';
        first.choices.prepare.mockImplementationOnce(async () => {
          entered.resolve(); await gate.promise; first.counts.set(first.ids.firstScene, 3);
        });
        if (mode.startsWith('scheduled')) {
          service.onApplicationBootstrap(); await jest.advanceTimersByTimeAsync(0);
        } else void service.executeOne();
        await entered.promise;
        const active = (service as any).active as Promise<unknown>;
        await expect(service.retry(retried.ids.owner, retried.ids.work, retried.ids.release))
          .resolves.toEqual({ releaseId: retried.ids.release, status: 'queued' });
        await jest.advanceTimersByTimeAsync(0);
        expect(claim).toHaveBeenCalledTimes(1); expect(retried.choices.prepare).not.toHaveBeenCalled();
        const shutdown = mode.endsWith('stop') ? service.onModuleDestroy() : undefined;
        gate.resolve(); await active; await jest.advanceTimersByTimeAsync(0);
        if (shutdown) {
          await shutdown; expect(jest.getTimerCount()).toBe(0);
          expect(claim).toHaveBeenCalledTimes(1); expect(retried.job.status).toBe('queued');
        } else {
          expect(jest.getTimerCount()).toBe(1); await jest.advanceTimersByTimeAsync(3_000);
          expect(claim).toHaveBeenCalledTimes(2); expect(retried.choices.prepare).toHaveBeenCalledTimes(1);
          expect(retried.job).toMatchObject({ status: 'queued', completedParts: 1 });
        }
      } finally {
        gate.resolve(); await service.onModuleDestroy();
        for (const [key, value] of [['NODE_ENV', old.node], ['STORY_STUDIO_CHOICE_WORKER_ENABLED', old.worker],
          ['STORY_CONTINUATION_OPENAI_API_KEY', old.key]]) {
          if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
        }
        jest.useRealTimers();
      }
    });

  it('does not schedule another tick after the active scheduled attempt drains', async () => {
    jest.useFakeTimers();
    const f = fixture(), gate = deferred<void>(), entered = deferred<void>();
    const oldWorker = process.env.STORY_STUDIO_CHOICE_WORKER_ENABLED;
    const oldKey = process.env.STORY_CONTINUATION_OPENAI_API_KEY;
    try {
      process.env.STORY_STUDIO_CHOICE_WORKER_ENABLED = 'true';
      process.env.STORY_CONTINUATION_OPENAI_API_KEY = 'offline-unit-key';
      f.choices.prepare.mockImplementationOnce(async () => {
        entered.resolve(); await gate.promise; f.counts.set(f.ids.firstScene, 3);
      });
      (f.service as any).schedule(0);
      await jest.advanceTimersByTimeAsync(0);
      await entered.promise;
      const shutdown = f.service.onModuleDestroy();
      gate.resolve(); await shutdown;
      await jest.advanceTimersByTimeAsync(3_000);
      expect(f.choices.prepare).toHaveBeenCalledTimes(1);
      expect((f.service as any).claim).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      gate.resolve();
      if (oldWorker === undefined) delete process.env.STORY_STUDIO_CHOICE_WORKER_ENABLED;
      else process.env.STORY_STUDIO_CHOICE_WORKER_ENABLED = oldWorker;
      if (oldKey === undefined) delete process.env.STORY_CONTINUATION_OPENAI_API_KEY;
      else process.env.STORY_CONTINUATION_OPENAI_API_KEY = oldKey;
      jest.useRealTimers();
    }
  });
});

describe('durable Studio choice preparation', () => {
  it('does not start paid preparation from an existing API key without an explicit worker switch', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousWorker = process.env.STORY_STUDIO_CHOICE_WORKER_ENABLED;
    const f = fixture();
    const schedule = jest.spyOn(f.service as any, 'schedule').mockImplementation(() => undefined);
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.STORY_STUDIO_CHOICE_WORKER_ENABLED;
      f.service.onApplicationBootstrap();
      f.job.status = 'failed';
      await f.service.retry(f.ids.owner, f.ids.work, f.ids.release);
      expect(schedule).not.toHaveBeenCalled();

      process.env.STORY_STUDIO_CHOICE_WORKER_ENABLED = 'true';
      f.service.onApplicationBootstrap();
      expect(schedule).toHaveBeenCalledWith(0);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousWorker === undefined) delete process.env.STORY_STUDIO_CHOICE_WORKER_ENABLED;
      else process.env.STORY_STUDIO_CHOICE_WORKER_ENABLED = previousWorker;
      await f.service.onModuleDestroy();
    }
  });

  it.each(['queued', 'processing'])('claims a %s job with a database lease and preserves whether it is an interrupted attempt', async previousStatus => {
    const f = fixture();
    f.db.$queryRaw.mockResolvedValueOnce([{ id: f.ids.job, previous_status: previousStatus }]);
    jest.mocked((f.service as any).claim).mockRestore();
    const claim = await (f.service as any).claim();
    expect(claim).toMatchObject({ id: f.ids.job, recovered: previousStatus === 'processing' });
    expect(claim.leaseToken).toMatch(/^[a-f0-9-]{36}$/);
    const query = f.db.$queryRaw.mock.calls[0][0];
    expect(query.strings.join(' ')).toContain('FOR UPDATE SKIP LOCKED');
    expect(query.strings.join(' ')).toContain('lease_expires_at < CURRENT_TIMESTAMP');
    expect(query.strings.join(' ')).toContain('candidate.status AS previous_status');
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
    const locks = f.db.$queryRaw.mock.calls.map(([query]: [{ strings: readonly string[] }]) => query.strings.join(' '));
    expect(locks[0]).toContain('story_releases');
    expect(locks[1]).toContain('story_studio_choice_jobs');
    expect(locks[1]).toContain('FOR UPDATE');
  });

  it('resumes after a stored scene without generating it again', async () => {
    const f = fixture();
    f.counts.set(f.ids.firstScene, 3);
    await expect(f.service.executeOne()).resolves.toBe('progress');
    expect(f.choices.prepare).toHaveBeenCalledTimes(1);
    expect(f.choices.prepare).toHaveBeenCalledWith(f.ids.owner, f.ids.work, f.ids.release, f.ids.secondScene,
      expect.any(String));
    expect(f.choices.assertPreparedScenesTx).toHaveBeenCalledWith(f.db, f.ids.work, f.ids.owner,
      f.ids.manuscript, f.ids.release, [f.ids.firstScene]);
    expect(f.choices.assertPreparedScenesTx.mock.invocationCallOrder[0])
      .toBeLessThan(f.choices.prepare.mock.invocationCallOrder[0]);
    expect(f.job.completedParts).toBe(2);
  });

  it('blocks a rejected stored choice proof before requesting any remaining part', async () => {
    const f = fixture();
    f.counts.set(f.ids.firstScene, 3);
    f.job.completedParts = 0;
    f.choices.assertPreparedScenesTx.mockRejectedValueOnce(new ConflictException({
      code: 'STUDIO_CHOICES_GENERATION_PROOF_REQUIRED',
    }));
    await expect(f.service.executeOne()).resolves.toBe('failed');
    expect(f.choices.assertPreparedScenesTx).toHaveBeenCalledWith(f.db, f.ids.work, f.ids.owner,
      f.ids.manuscript, f.ids.release, [f.ids.firstScene]);
    expect(f.choices.prepare).not.toHaveBeenCalled();
    expect(f.job).toMatchObject({ status: 'failed', completedParts: 1,
      errorCode: 'STUDIO_CHOICES_GENERATION_PROOF_REQUIRED', leaseToken: null });
    expect(f.db.storyRelease.update).not.toHaveBeenCalled();
  });

  it('validates every stored three-choice scene, including one after the next pending part', async () => {
    const f = fixture();
    const thirdPart = randomUUID(), thirdScene = randomUUID();
    f.job.totalParts = 3;
    f.counts.set(f.ids.firstScene, 3);
    f.counts.set(thirdScene, 3);
    f.db.storyPart.findMany.mockResolvedValue([{ id: f.ids.firstPart }, { id: f.ids.secondPart }, { id: thirdPart }]);
    f.db.storyScene.findMany.mockResolvedValue([
      { id: f.ids.firstScene, partId: f.ids.firstPart }, { id: f.ids.secondScene, partId: f.ids.secondPart },
      { id: thirdScene, partId: thirdPart },
    ]);
    await expect(f.service.executeOne()).resolves.toBe('progress');
    expect(f.choices.assertPreparedScenesTx).toHaveBeenCalledWith(f.db, f.ids.work, f.ids.owner,
      f.ids.manuscript, f.ids.release, [f.ids.firstScene, thirdScene]);
    expect(f.choices.assertPreparedScenesTx.mock.invocationCallOrder[0])
      .toBeLessThan(f.choices.prepare.mock.invocationCallOrder[0]);
    expect(f.choices.prepare).toHaveBeenCalledTimes(1);
    expect(f.job.completedParts).toBe(3);
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
    await f.service.onModuleDestroy();
  });

  it('fails closed on a partial choice set instead of replacing authored choices', async () => {
    const f = fixture();
    f.counts.set(f.ids.firstScene, 2);
    await expect(f.service.executeOne()).resolves.toBe('failed');
    expect(f.choices.prepare).not.toHaveBeenCalled();
    expect(f.db.storyRelease.update).not.toHaveBeenCalled();
    expect(f.job.errorCode).toBe('STUDIO_CHOICES_PARTIAL_SET');
  });

  it('cannot finish after another worker takes over during validation', async () => {
    const f = fixture();
    f.counts.set(f.ids.firstScene, 3);
    f.counts.set(f.ids.secondScene, 3);
    const replacementToken = randomUUID();
    f.choices.assertPublishableTx.mockImplementationOnce(async () => {
      Object.assign(f.job, { leaseToken: replacementToken, leaseExpiresAt: new Date(Date.now() + 60_000) });
    });
    await expect(f.service.executeOne()).resolves.toBe('idle');
    expect(f.job).toMatchObject({ status: 'processing', leaseToken: replacementToken, errorCode: null });
    expect(f.db.storyRelease.update).not.toHaveBeenCalled();
    expect(f.db.storyStudioChoiceJob.update).not.toHaveBeenCalled();
  });

  it('does not mark a release ready when its lease expires during validation', async () => {
    const f = fixture();
    f.counts.set(f.ids.firstScene, 3);
    f.counts.set(f.ids.secondScene, 3);
    f.choices.assertPublishableTx.mockImplementationOnce(async () => {
      f.job.leaseExpiresAt = new Date(0);
    });
    await expect(f.service.executeOne()).resolves.toBe('failed');
    expect(f.job.errorCode).toBe('STUDIO_CHOICES_LEASE_CHANGED');
    expect(f.db.storyRelease.update).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'])('ignores an old worker late %s without changing a replacement lease', async outcome => {
    const f = fixture();
    const replacementToken = randomUUID();
    f.choices.prepare.mockImplementationOnce(async () => {
      Object.assign(f.job, { leaseToken: replacementToken, leaseExpiresAt: new Date(Date.now() + 60_000) });
      if (outcome === 'failure') throw new Error('late provider failure');
      f.counts.set(f.ids.firstScene, 3);
    });
    await expect(f.service.executeOne()).resolves.toBe('idle');
    expect(f.job).toMatchObject({ status: 'processing', completedParts: 0,
      leaseToken: replacementToken, errorCode: null });
    expect(f.db.storyRelease.update).not.toHaveBeenCalled();
  });

  it('reconciles all committed choices after interruption without another provider request', async () => {
    const f = fixture();
    f.counts.set(f.ids.firstScene, 3);
    f.counts.set(f.ids.secondScene, 3);
    Object.assign(f.job, { status: 'processing', completedParts: 1,
      leaseToken: randomUUID(), leaseExpiresAt: new Date(0) });
    await expect(f.service.executeOne()).resolves.toBe('completed');
    expect(f.choices.prepare).not.toHaveBeenCalled();
    expect(f.job).toMatchObject({ status: 'completed', completedParts: 2, leaseToken: null });
  });

  it('requires an explicit retry after an expired incomplete attempt instead of risking duplicate provider cost', async () => {
    const f = fixture();
    f.counts.set(f.ids.firstScene, 3);
    Object.assign(f.job, { status: 'processing', completedParts: 0,
      leaseToken: randomUUID(), leaseExpiresAt: new Date(0) });
    await expect(f.service.executeOne()).resolves.toBe('failed');
    expect(f.choices.prepare).not.toHaveBeenCalled();
    expect(f.job).toMatchObject({ status: 'failed', completedParts: 1,
      errorCode: 'STUDIO_CHOICES_INTERRUPTED_RETRY_REQUIRED' });
    await expect(f.service.executeOne()).resolves.toBe('idle');
    await f.service.retry(f.ids.owner, f.ids.work, f.ids.release);
    await expect(f.service.executeOne()).resolves.toBe('progress');
    expect(f.choices.prepare).toHaveBeenCalledTimes(1);
    expect(f.choices.prepare).toHaveBeenCalledWith(f.ids.owner, f.ids.work, f.ids.release,
      f.ids.secondScene, expect.any(String));
    expect(f.job.completedParts).toBe(2);
  });

  it.each(['paused', 'expired'])('does not start preparation after a claimed job becomes %s', async reason => {
    const f = fixture();
    jest.mocked((f.service as any).claim).mockImplementationOnce(async () => {
      Object.assign(f.job, { status: reason === 'paused' ? 'paused' : 'processing',
        leaseToken: randomUUID(), leaseExpiresAt: reason === 'expired' ? new Date(0) : new Date(Date.now() + 60_000) });
      return { id: f.ids.job, leaseToken: f.job.leaseToken };
    });
    await expect(f.service.executeOne()).resolves.toBe('idle');
    expect(f.choices.prepare).not.toHaveBeenCalled();
    expect(f.db.storyRelease.update).not.toHaveBeenCalled();
  });

  it('rejects malformed retry identifiers without querying or queueing a job', async () => {
    const f = fixture();
    await expect(f.service.retry(f.ids.owner, 'bad-work', f.ids.release)).rejects.toMatchObject({
      response: { code: 'STUDIO_CHOICES_INVALID_ID' },
    });
    expect(f.db.storyWork.findFirst).not.toHaveBeenCalled();
    expect(f.db.storyStudioChoiceJob.updateMany).not.toHaveBeenCalled();
  });

  it.each(['owner', 'release'])('rejects an unavailable private %s before changing the retry queue', async missing => {
    const f = fixture();
    f.job.status = 'failed';
    if (missing === 'owner') f.db.storyWork.findFirst.mockResolvedValueOnce(null);
    else f.db.storyRelease.findFirst.mockResolvedValueOnce(null);
    await expect(f.service.retry(f.ids.owner, f.ids.work, f.ids.release)).rejects.toMatchObject({
      response: { code: 'STUDIO_CHOICES_PRIVATE_DRAFT_REQUIRED' },
    });
    expect(f.db.storyWork.findFirst).toHaveBeenCalledWith({ where: { id: f.ids.work, ownerUserId: f.ids.owner,
      status: { not: 'published' }, activeReleaseId: null } });
    expect(f.db.storyStudioChoiceJob.updateMany).not.toHaveBeenCalled();
    expect(f.job.status).toBe('failed');
  });

  it.each(['queued', 'processing', 'completed', 'paused', 'changed-manuscript'])('does not retry a %s job', async state => {
    const f = fixture();
    f.job.status = state === 'changed-manuscript' ? 'failed' : state;
    if (state === 'changed-manuscript') f.job.manuscriptVersionId = randomUUID();
    const previous = { ...f.job };
    await expect(f.service.retry(f.ids.owner, f.ids.work, f.ids.release)).rejects.toMatchObject({
      response: { code: 'STUDIO_CHOICES_RETRY_NOT_AVAILABLE' },
    });
    expect(f.job).toEqual(previous);
    expect(f.choices.prepare).not.toHaveBeenCalled();
  });
});

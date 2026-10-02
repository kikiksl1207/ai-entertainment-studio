import { Global, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StoryStudioChoiceJobService } from './story-studio-choice-job.service';
import { StoryStudioChoicePreparationService } from './story-studio-choice-preparation.service';

const url = process.env.STORY_CHOICE_SHUTDOWN_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
function deferred() {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
}

postgres('Studio choice shutdown (real PostgreSQL and Nest lifecycle, offline preparation)', () => {
  let observer: PrismaClient;
  let app: INestApplication | undefined;
  const gates: Array<ReturnType<typeof deferred>> = [];
  const orderings = ['database-first', 'worker-first', 'same-module'] as const;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' ||
        parsed.port !== '55432' || parsed.username !== 'lumina_qa' || parsed.password ||
        parsed.pathname !== '/lumina_choice_shutdown_qa' || parsed.search || parsed.hash ||
        process.env.NODE_ENV !== 'test') throw new Error('Dedicated choice shutdown QA database required');
    observer = new PrismaClient({ datasources: { db: { url } }, log: [] });
    await observer.$connect();
    expect(await observer.user.count()).toBe(0);
    expect(await observer.storyStudioChoiceJob.count()).toBe(0);
  });
  beforeEach(() => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('External calls forbidden in shutdown QA'));
  });
  afterEach(async () => {
    for (const gate of gates.splice(0)) gate.open();
    try {
      await app?.close();
      app = undefined;
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { jest.restoreAllMocks(); }
  });
  afterAll(async () => { await observer?.$disconnect(); });

  async function fixture() {
    const owner = randomUUID(), work = randomUUID(), manuscript = randomUUID();
    const release = randomUUID(), part = randomUUID(), scene = randomUUID(), job = randomUUID();
    await observer.$transaction(async tx => {
      await tx.user.create({ data: { id: owner } });
      await tx.storyWork.create({ data: { id: work, ownerUserId: owner,
        slug: `choice-shutdown-${randomUUID()}`, title: { ko: 'Synthetic lifecycle story' }, summary: {} } });
      await tx.storyManuscriptVersion.create({ data: { id: manuscript, workId: work, ownerUserId: owner,
        version: 1, locale: 'ko', contentHash: 'a'.repeat(64), structuredBody: { lifecycleFixture: true } } });
      await tx.storyRelease.create({ data: { id: release, workId: work, manuscriptVersionId: manuscript,
        version: 1, checksum: 'b'.repeat(64), createdByUserId: owner, branchGraphSnapshot: {},
        endingSetSnapshot: {}, sceneAssetManifest: {}, localizedDisplaySnapshot: {} } });
      await tx.storyPart.create({ data: { id: part, workId: work, position: 1, title: { ko: 'Fixture part' } } });
      await tx.storyScene.create({ data: { id: scene, partId: part, sceneKey: 'scene-1', position: 1,
        title: { ko: 'Fixture scene' } } });
      await tx.storyChoice.create({ data: { sceneId: scene, choiceKey: 'original', position: 1,
        label: { ko: 'Keep the ledger' }, routeKind: 'writer_original', targetEndingKey: 'original' } });
      await tx.storyStudioChoiceJob.create({ data: { id: job, workId: work, ownerUserId: owner,
        releaseId: release, manuscriptVersionId: manuscript, totalParts: 1 } });
    });
    return { owner, work, manuscript, release, part, scene, job };
  }

  async function application(order: typeof orderings[number], preparation: object) {
    const database = new PrismaService({ datasources: { db: { url } }, log: [] });
    const disconnected = jest.spyOn(database, '$disconnect');
    @Global()
    @Module({ providers: [{ provide: PrismaService, useValue: database }], exports: [PrismaService] })
    class DatabaseModule {}
    const providers = [{ provide: StoryStudioChoicePreparationService, useValue: preparation },
      StoryStudioChoiceJobService];
    @Module({ providers })
    class WorkerModule {}
    const module = order === 'same-module'
      ? await Test.createTestingModule({ providers: [{ provide: PrismaService, useValue: database }, ...providers] }).compile()
      : await Test.createTestingModule({ imports: order === 'database-first'
        ? [DatabaseModule, WorkerModule] : [WorkerModule, DatabaseModule] }).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    return { worker: app.get(StoryStudioChoiceJobService), disconnected };
  }

  async function withFixtureClaim(f: Awaited<ReturnType<typeof fixture>>, run: () => Promise<void>) {
    // The production claim SQL remains unchanged; its SKIP LOCKED excludes other retained fixtures.
    await observer.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM story_studio_choice_jobs WHERE id <> ${f.job}::uuid FOR UPDATE`;
      await run();
    }, { timeout: 45_000 });
  }

  it.each(orderings)('persists accepted choices and job status before disconnect: %s', async order => {
    const f = await fixture(), entered = deferred(), gate = deferred(); gates.push(gate);
    const preparation = {
      prepare: jest.fn(async (_owner: string, _work: string, _release: string, sceneId: string) => {
        expect(sceneId).toBe(f.scene); entered.open(); await gate.promise;
        await observer.$transaction(async tx => {
          await tx.storyChoice.createMany({ data: [2, 3].map(position => ({ sceneId,
            choiceKey: `alternative-${position}`, position, routeKind: 'generation_required',
            label: { ko: `Offline alternative ${position}` } })) });
          await tx.auditEvent.create({ data: { actorUserId: f.owner, actorType: 'user',
            action: 'choice_shutdown_qa.offline_stored', targetType: 'story_scene', targetId: sceneId,
            metadata: { synthetic: true, realAi: false } } });
        });
      }),
      assertPreparedScenesTx: jest.fn(), assertPublishableTx: jest.fn(),
    };
    await withFixtureClaim(f, async () => {
    const runtime = await application(order, preparation);
    const active = runtime.worker.executeOne();
    expect(runtime.worker.executeOne()).toBe(active);
    await entered.promise;
    let closed = false;
    const close = app!.close().then(() => { closed = true; });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(closed).toBe(false); expect(runtime.disconnected).not.toHaveBeenCalled();
    expect((await observer.storyStudioChoiceJob.findUniqueOrThrow({ where: { id: f.job } })).status).toBe('processing');
    gate.open(); await expect(active).resolves.toBe('progress'); await close; app = undefined;
    expect(runtime.disconnected).toHaveBeenCalledTimes(1);
    expect(await observer.storyChoice.count({ where: { sceneId: f.scene } })).toBe(3);
    expect(await observer.auditEvent.count({ where: { actorUserId: f.owner } })).toBe(1);
    expect(await observer.storyStudioChoiceJob.findUniqueOrThrow({ where: { id: f.job } }))
      .toMatchObject({ status: 'queued', completedParts: 1, leaseToken: null, leaseExpiresAt: null });
    expect(preparation.prepare).toHaveBeenCalledTimes(1);
    await expect(runtime.worker.executeOne()).resolves.toBe('idle');
    });
  }, 15_000);

  it.each(orderings)('persists a failed attempt before disconnect without an automatic retry: %s', async order => {
    const f = await fixture(), entered = deferred(), gate = deferred(); gates.push(gate);
    const preparation = { prepare: jest.fn(async () => {
      entered.open(); await gate.promise; throw new Error('Offline preparation failure');
    }), assertPreparedScenesTx: jest.fn(), assertPublishableTx: jest.fn() };
    await withFixtureClaim(f, async () => {
    const runtime = await application(order, preparation);
    const active = runtime.worker.executeOne(); await entered.promise;
    const close = app!.close();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(runtime.disconnected).not.toHaveBeenCalled();
    gate.open(); await expect(active).resolves.toBe('failed'); await close; app = undefined;
    expect(runtime.disconnected).toHaveBeenCalledTimes(1);
    expect(await observer.storyChoice.count({ where: { sceneId: f.scene } })).toBe(1);
    expect(await observer.storyStudioChoiceJob.findUniqueOrThrow({ where: { id: f.job } }))
      .toMatchObject({ status: 'failed', completedParts: 0, leaseToken: null,
        errorCode: 'STUDIO_CHOICES_PREPARATION_FAILED' });
    expect(preparation.prepare).toHaveBeenCalledTimes(1);
    await expect(runtime.worker.executeOne()).resolves.toBe('idle');
    });
  }, 15_000);

  it('leaves an interrupted incomplete attempt failed until the owner explicitly retries', async () => {
    const f = await fixture();
    await observer.storyStudioChoiceJob.update({ where: { id: f.job }, data: {
      status: 'processing', leaseToken: randomUUID(), leaseExpiresAt: new Date(0),
    } });
    const preparation = { prepare: jest.fn(), assertPreparedScenesTx: jest.fn(), assertPublishableTx: jest.fn() };
    await withFixtureClaim(f, async () => {
    const runtime = await application('same-module', preparation);
    await expect(runtime.worker.executeOne()).resolves.toBe('failed');
    expect(preparation.prepare).not.toHaveBeenCalled();
    expect(await observer.storyStudioChoiceJob.findUniqueOrThrow({ where: { id: f.job } }))
      .toMatchObject({ status: 'failed', errorCode: 'STUDIO_CHOICES_INTERRUPTED_RETRY_REQUIRED' });
    await expect(runtime.worker.executeOne()).resolves.toBe('idle');
    await expect(runtime.worker.retry(f.owner, f.work, f.release)).resolves.toEqual({ releaseId: f.release, status: 'queued' });
    });
  }, 15_000);
});

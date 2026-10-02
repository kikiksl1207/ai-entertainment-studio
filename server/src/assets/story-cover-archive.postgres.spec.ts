import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AdminController } from '../admin/admin.controller';
import { AdminService } from '../admin/admin.service';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

postgres('Published story cover archive guard (isolated PostgreSQL)', () => {
  let db: PrismaClient;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' ||
        parsed.port !== '55432' || parsed.username !== 'lumina_qa' ||
        parsed.pathname !== '/lumina_story_qa' || parsed.search || parsed.hash) {
      throw new Error('Dedicated story QA database required');
    }
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
  });

  afterAll(async () => { await db?.$disconnect(); });

  it('blocks every archive path while a published work uses the cover and permits a retired cover', async () => {
    const owner = await db.user.create({ data: {} });
    const asset = await db.asset.create({ data: {
      assetType: 'image', visibility: 'public', storageProvider: 'r2',
      storageKey: `qa/cover-archive/${randomUUID()}.png`, mimeType: 'image/png',
      metadata: { lifecycle: { status: 'active' } },
    } });
    const work = await db.storyWork.create({ data: {
      ownerUserId: owner.id, slug: `qa-cover-${randomUUID()}`,
      title: { ko: '표지 보호 검사' }, summary: { ko: '시험 원고' },
      coverManifest: { assetId: asset.id },
    } });
    const manuscript = await db.storyManuscriptVersion.create({ data: {
      workId: work.id, ownerUserId: owner.id, version: 1, locale: 'ko',
      contentHash: 'a'.repeat(64), structuredBody: {},
    } });
    const release = await db.storyRelease.create({ data: {
      workId: work.id, version: 1, status: 'active', manuscriptVersionId: manuscript.id,
      checksum: 'b'.repeat(64), branchGraphSnapshot: {}, endingSetSnapshot: {},
      sceneAssetManifest: {}, localizedDisplaySnapshot: {}, createdByUserId: owner.id,
    } });
    await db.storyWork.update({ where: { id: work.id }, data: {
      status: 'published', activeReleaseId: release.id, publishedAt: new Date(),
    } });
    const archived = { lifecycle: { status: 'archived' } };
    const admin = new AdminController(new AdminService(db as never, { get: () => undefined } as never));
    await expect(admin.archiveAsset({ id: owner.id } as never, asset.id, { force: true }))
      .rejects.toMatchObject({ response: { code: 'STORY_PUBLISHED_COVER_ARCHIVE_BLOCKED' } });
    let failure: unknown;
    try {
      await db.asset.update({ where: { id: asset.id }, data: { metadata: archived } });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Prisma.PrismaClientUnknownRequestError);
    expect((failure as Error).message).toContain('Published story cover cannot be archived');
    expect((await db.asset.findUniqueOrThrow({ where: { id: asset.id } })).metadata)
      .toEqual({ lifecycle: { status: 'active' } });

    await db.storyWork.update({ where: { id: work.id }, data: {
      status: 'archived', activeReleaseId: null,
    } });
    await expect(db.asset.update({ where: { id: asset.id }, data: { metadata: archived } }))
      .resolves.toMatchObject({ id: asset.id, metadata: archived });

    await db.storyWork.update({ where: { id: work.id }, data: { status: 'draft' } });
    await db.asset.update({ where: { id: asset.id }, data: {
      metadata: { lifecycle: { status: 'active' } },
    } });
    const archiver = new PrismaClient({ datasources: { db: { url } } });
    await archiver.$connect();
    let releaseLock!: () => void;
    const holdLock = new Promise<void>((resolve) => { releaseLock = resolve; });
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const publishing = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM assets WHERE id = ${asset.id}::uuid FOR UPDATE`;
      await tx.storyWork.update({ where: { id: work.id }, data: {
        status: 'published', activeReleaseId: release.id,
      } });
      signalLocked();
      await holdLock;
    }, { timeout: 10_000 });
    try {
      await Promise.race([locked, publishing.then(() => {
        throw new Error('Publication finished before the cover lock was held');
      })]);
      const attemptedArchive = archiver.asset.update({ where: { id: asset.id },
        data: { metadata: archived } }).then(() => null, (error: unknown) => error);
      let archiveWaiting = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const rows = await db.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query ILIKE '%assets%' AND cardinality(pg_blocking_pids(pid)) > 0`;
        if (rows[0]?.count > 0) { archiveWaiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(archiveWaiting).toBe(true);
      releaseLock();
      await publishing;
      const concurrentFailure = await attemptedArchive;
      expect(concurrentFailure).toBeInstanceOf(Prisma.PrismaClientUnknownRequestError);
      expect((concurrentFailure as Error).message).toContain('Published story cover cannot be archived');
      expect((await db.asset.findUniqueOrThrow({ where: { id: asset.id } })).metadata)
        .toEqual({ lifecycle: { status: 'active' } });
    } finally {
      releaseLock();
      await publishing.catch(() => undefined);
      await archiver.$disconnect();
    }
  });
});

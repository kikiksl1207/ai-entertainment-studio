import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { activationFixture } from './story-ai-activation.postgres-fixture';
import { StoryAuthorBodyPreviewService } from './story-author-body-preview.service';
import { createStoryRouteRoot } from './story-route-identity.store';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
jest.setTimeout(30000);

postgres('author body preview on dedicated PostgreSQL (synthetic settlement, no providers)', () => {
  let db: PrismaClient, service: StoryAuthorBodyPreviewService;
  let f: Awaited<ReturnType<typeof activationFixture>>;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.origin !== 'null' || parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' ||
      parsed.port !== '55432' || parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash ||
      !/^\/lumina_body_preview_qa_[a-f0-9]{12}$/.test(parsed.pathname)) throw new Error('Dedicated loopback QA database required');
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    f = await activationFixture(db);
    const progress = await db.storyReaderProgress.create({ data: {
      userId: f.owner.id, workId: f.work.id, currentSceneId: f.scene.id, checkpointSceneId: f.scene.id,
      activeReleaseId: f.release.id, aiRateCardId: f.rate.id, capabilityRevision: f.progresses[0].capabilityRevision,
    } });
    const routeNodeId = await createStoryRouteRoot(db, progress, f.scene.id, f.part.actNumber);
    f.progresses[0] = await db.storyReaderProgress.update({ where: { id: progress.id }, data: { routeNodeId } });
    service = new StoryAuthorBodyPreviewService(db as never);
  });
  afterAll(async () => { await db?.$disconnect(); });

  async function state() {
    const names = ['storyReaderProgress', 'storyAiGeneratedScene', 'storyAiGeneratedBeat', 'storyAiGeneratedChoice',
      'storyAiContinuation', 'storyAiReusableResult', 'storyAiUsageLedger', 'storyChoiceEvent', 'storyEndingDiscovery',
      'storyMemoryRecord', 'storyQualityEvent', 'storyVisualPrompt', 'storyVisualGeneration', 'walletLedger', 'storyCanonicalReadReceipt'] as const;
    const rows: Record<string, unknown> = {};
    for (const name of names) rows[name] = await (db[name] as any).findMany({ orderBy: { id: 'asc' } });
    return rows;
  }
  const preview = () => service.preview(f.owner.id, f.work.id, { locale: 'ko' });

  it('reads the author canonical scene; readers cannot use the author endpoint; no state changes', async () => {
    const before = await state();
    expect(await preview()).toMatchObject({ progress: { scene: { isGenerated: false, title: 'Source scene' } } });
    await expect(service.preview(f.reader.id, f.work.id, { locale: 'ko' })).rejects.toBeInstanceOf(NotFoundException);
    expect(await state()).toEqual(before);
  });

  it('reads only the author personal settled body, even though images and shared approval are absent', async () => {
    await f.generatePersonal();
    const before = await state();
    expect(await preview()).toMatchObject({ readOnly: true, imageGenerationStarted: false,
      progress: { scene: { isGenerated: true, title: 'Synthetic private continuation',
        beats: [{ content: 'Synthetic generated continuation.' }] } } });
    expect(await preview()).toEqual(await preview());
    expect(await state()).toEqual(before);
    expect(await db.storyAiReusableResult.findFirst({ where: { workId: f.work.id } })).toMatchObject({ status: 'pending' });
    expect(await db.storyVisualGeneration.count()).toBe(0);
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('accepts PostgreSQL-equivalent uppercase UUIDs and never creates a missing translation', async () => {
    const before = await state();
    expect(await service.preview(f.owner.id.toUpperCase(), f.work.id.toUpperCase(), { locale: 'ko' })).toEqual(await preview());
    await expect(service.preview(f.owner.id, f.work.id, { locale: 'en' })).rejects.toBeInstanceOf(ConflictException);
    expect(await state()).toEqual(before);
  });

  it('rejects an old release pin without advancing or repairing the progress', async () => {
    const original = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progresses[0].id } });
    try {
      await db.storyReaderProgress.update({ where: { id: original.id }, data: { activeReleaseId: null } });
      const before = await state();
      await expect(preview()).rejects.toBeInstanceOf(ConflictException);
      expect(await state()).toEqual(before);
    } finally {
      await db.storyReaderProgress.update({ where: { id: original.id }, data: { activeReleaseId: original.activeReleaseId } });
    }
  });

  it('PostgreSQL itself enforces read-only mode, not just mocked absence of write calls', async () => {
    await expect(db.$transaction(async tx => {
      await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
      expect(await tx.$queryRaw`SHOW transaction_read_only`).toEqual([{ transaction_read_only: 'on' }]);
      await tx.$executeRaw(Prisma.sql`UPDATE story_works SET published_version = published_version + 1 WHERE id = ${f.work.id}::uuid`);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })).rejects.toMatchObject({ code: 'P2010', meta: { code: '25006' } });
    expect((await db.storyWork.findUniqueOrThrow({ where: { id: f.work.id } })).publishedVersion).toBe(1);
  });
});

import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { UserAssetsService } from '../assets/user-assets.service';
import { StoryProductionService } from './story-production.service';
import { StoryCatalogQueryDto } from './dto/story-production.dto';

const url = process.env.STORY_DRAFT_METADATA_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

postgres('writer draft publication details (isolated PostgreSQL)', () => {
  let db: PrismaClient;
  let userId: string | undefined;
  let workId: string | undefined;
  let assetId: string | undefined;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
        parsed.username !== 'lumina_qa' || parsed.pathname !== '/lumina_story_qa' ||
        parsed.search || parsed.hash) {
      throw new Error('Dedicated loopback story QA database required');
    }
    db = new PrismaClient({ datasources: { db: { url: url! } } });
    await db.$connect();
  });

  afterAll(async () => {
    if (!db) return;
    try {
      if (workId) await db.storyWork.deleteMany({ where: { id: workId } });
      if (assetId) await db.asset.deleteMany({ where: { id: assetId } });
      if (userId) await db.user.deleteMany({ where: { id: userId } });
    } finally {
      await db.$disconnect();
    }
  });

  it('persists owner metadata, projects it into the catalog and protects its cover', async () => {
    userId = (await db.user.create({ data: {} })).id;
    const requestId = randomUUID();
    assetId = (await db.asset.create({ data: {
      assetType: 'image', visibility: 'public', storageProvider: 'local',
      storageKey: `qa/writer-cover/${requestId}.png`, mimeType: 'image/png',
      metadata: { uploadIntent: { status: 'uploaded', createdByUserId: userId },
        lifecycle: { status: 'active' } },
    } })).id;
    workId = (await db.storyWork.create({ data: {
      ownerUserId: userId, slug: `draft-${requestId}`,
      title: { ko: '검사용 초안' }, summary: {},
    } })).id;
    const assets = new UserAssetsService(db as never, { get: () => undefined } as never);
    const stories = new StoryProductionService(db as never, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, assets);
    await expect(stories.updateDraftMetadata(userId, workId, {
      authorDisplayName: '루미나', summary: '검사용 소개', coverAssetId: assetId,
    })).rejects.toBeInstanceOf(BadRequestException);
    await db.asset.update({ where: { id: assetId }, data: { storageProvider: 'r2' } });
    const saved = await stories.updateDraftMetadata(userId, workId, {
      authorDisplayName: '  루미나  ', summary: '  검사용 소개  ', coverAssetId: assetId,
    });
    expect(saved).toMatchObject({ workId, authorDisplayName: '루미나', summary: '검사용 소개',
      cover: { assetId, url: `/api/v1/assets/public/${assetId}/display` }, releaseRevision: 2 });

    const stored = await db.storyWork.findUniqueOrThrow({ where: { id: workId } });
    expect(stored.summary).toEqual({ ko: '검사용 소개' });
    expect(stored.coverManifest).toEqual(saved.cover);
    const catalog = await stories.creatorCatalog(userId, new StoryCatalogQueryDto());
    expect(catalog.items).toContainEqual(expect.objectContaining({
      workId, authorDisplayName: '루미나', cover: saved.cover,
      summary: expect.objectContaining({ value: '검사용 소개' }),
    }));
    await expect(assets.archiveAsset(userId, assetId, {})).rejects.toBeInstanceOf(BadRequestException);
    expect((await db.asset.findUniqueOrThrow({ where: { id: assetId } })).metadata)
      .toMatchObject({ lifecycle: { status: 'active' } });
  });
});

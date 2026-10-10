import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { activationFixture } from './story-ai-activation.postgres-fixture';
import { StoryAuthorBodyPreviewService } from './story-author-body-preview.service';
import { createStoryRouteRoot } from './story-route-identity.store';
import { authoredPartContinuationLengthBounds } from './story-continuation-author-length.store';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
jest.setTimeout(30000);

postgres('author stored-body length on owned PostgreSQL (synthetic only)', () => {
  let db: PrismaClient, service: StoryAuthorBodyPreviewService;
  let f: Awaited<ReturnType<typeof activationFixture>>;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
      parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash ||
      !/^\/lumina_body_length_qa_[a-f0-9]{12}$/.test(parsed.pathname)) {
      throw new Error('Owned loopback body length QA database required');
    }
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    f = await activationFixture(db);
    const progress = await db.storyReaderProgress.create({ data: {
      userId: f.owner.id, workId: f.work.id, currentSceneId: f.scene.id, checkpointSceneId: f.scene.id,
      activeReleaseId: f.release.id, aiRateCardId: f.rate.id,
      capabilityRevision: f.progresses[0].capabilityRevision,
    } });
    const routeNodeId = await createStoryRouteRoot(db, progress, f.scene.id, f.part.actNumber);
    f.progresses[0] = await db.storyReaderProgress.update({ where: { id: progress.id }, data: { routeNodeId } });
    service = new StoryAuthorBodyPreviewService(db as never);
  });
  afterAll(async () => { await db?.$disconnect(); });

  async function state() {
    const names = ['storyReaderProgress', 'storyAiGeneratedScene', 'storyAiGeneratedBeat', 'storyAiGeneratedChoice',
      'storyAiContinuation', 'storyAiReusableResult', 'storyAiUsageLedger', 'storyChoiceEvent', 'storyEndingDiscovery',
      'storyMemoryRecord', 'storyQualityEvent', 'storyVisualPrompt', 'storyVisualGeneration', 'walletLedger',
      'storyCanonicalReadReceipt', 'storyAuthorBodyTrialApproval'] as const;
    const rows: Record<string, unknown> = {};
    for (const name of names) rows[name] = await (db[name] as any).findMany({ orderBy: { id: 'asc' } });
    return rows;
  }
  const inspect = () => service.lengthDiagnostic(f.owner.id, f.work.id, { locale: 'ko' });

  it('canonical body is not an AI result; another reader cannot inspect it; domain rows stay unchanged', async () => {
    const before = await state();
    expect(await inspect()).toMatchObject({ contract: 'story-author-body-length-v1',
      referenceScope: 'current_published_original_part', outcome: 'canonical_body_only', diagnostic: null,
      readOnly: true, currentApprovalVerified: false, semanticQualityVerified: false,
      dispatchAuthorized: false, providerCalls: 0, operatingWrites: 0 });
    await expect(service.lengthDiagnostic(f.reader.id, f.work.id, { locale: 'ko' })).rejects.toBeInstanceOf(NotFoundException);
    expect(await state()).toEqual(before);
  });

  it('compares the own stored body with the current published original part in a real read snapshot', async () => {
    // The fixture settles synthetic output before the read; this is not a real-model result.
    await f.generatePersonal();
    const bounds = await authoredPartContinuationLengthBounds(db, f.part.id, 'ko');
    const before = await state();
    const result = await inspect();
    expect(result).toMatchObject({ outcome: 'generated_body_checked',
      diagnostic: { version: 'story-fixed-cap-narrative-v1',
        expectedBounds: { referenceUnits: bounds.referenceUnits, minUnits: bounds.minUnits,
          targetUnits: bounds.targetUnits, maxUnits: bounds.maxUnits },
        currentApprovalVerified: false, providerReceiptVerified: false,
        semanticQualityVerified: false, dispatchAuthorized: false, providerCalls: 0 } });
    expect(await inspect()).toEqual(result);
    expect(await state()).toEqual(before);
    expect(JSON.stringify(result)).not.toMatch(/Source scene|Synthetic generated|title|content|workId|sceneId|userId|hash|fingerprint/);
    expect(f.provider.generate).not.toHaveBeenCalled();
    expect(await db.storyVisualGeneration.count()).toBe(0);
    expect(await db.storyAuthorBodyTrialApproval.count()).toBe(0);
  });

  it('rejects stale release state without repairing or modifying any domain rows', async () => {
    const original = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progresses[0].id } });
    try {
      await db.storyReaderProgress.update({ where: { id: original.id }, data: { activeReleaseId: null } });
      const before = await state();
      await expect(inspect()).rejects.toBeInstanceOf(ConflictException);
      expect(await state()).toEqual(before);
    } finally {
      await db.storyReaderProgress.update({ where: { id: original.id }, data: { activeReleaseId: original.activeReleaseId } });
    }
  });

  it('PostgreSQL enforces read-only mode and preserves work version after a denied write', async () => {
    const before = await db.storyWork.findUniqueOrThrow({ where: { id: f.work.id } });
    await expect(db.$transaction(async tx => {
      await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
      expect(await tx.$queryRaw`SHOW transaction_read_only`).toEqual([{ transaction_read_only: 'on' }]);
      await tx.$executeRaw(Prisma.sql`UPDATE story_works SET published_version = published_version + 1 WHERE id = ${f.work.id}::uuid`);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })).rejects.toMatchObject({
      code: 'P2010', meta: { code: '25006' },
    });
    expect((await db.storyWork.findUniqueOrThrow({ where: { id: f.work.id } })).publishedVersion).toBe(before.publishedVersion);
  });
});

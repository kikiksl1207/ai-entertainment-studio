import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { activationFixture } from './story-ai-activation.postgres-fixture';
import { StoryInteractionApprovalService } from './story-interaction-approval.service';
import { STORY_LOCALES } from './story-production.policy';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

// The caller provisions this NEW database and applies normal migrations. This suite never creates/resets a database.
postgres('canonical interaction catalog on dedicated PostgreSQL', () => {
  let db: PrismaClient;
  let service: StoryInteractionApprovalService;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.port !== '55432' ||
      parsed.username !== 'lumina_qa' || parsed.pathname !== '/lumina_interaction_catalog_qa' || parsed.search || parsed.hash) {
      throw new Error('Dedicated new lumina_interaction_catalog_qa loopback database required');
    }
    db = new PrismaClient({ datasources: { db: { url: url! } } });
    await db.$connect();
    service = new StoryInteractionApprovalService(db as never);
  });
  afterAll(async () => { await db?.$disconnect(); });

  async function fixture() {
    const f = await activationFixture(db, false);
    const beat = await db.storyBeat.update({ where: { sceneId_position: { sceneId: f.scene.id, position: 1 } },
      data: { content: Object.fromEntries(STORY_LOCALES.map(locale => [locale, `  Exact ${locale} source.\n`])) } });
    return { ...f, beat };
  }

  async function pagedFixture() {
    const f = await fixture();
    const tiedScene = await db.storyScene.create({ data: { partId: f.part.id, sceneKey: 'tied',
      position: f.scene.position, status: 'published', title: {} } });
    const secondPart = await db.storyPart.create({ data: { workId: f.work.id, position: 2, status: 'published', title: {} } });
    const laterScene = await db.storyScene.create({ data: { partId: secondPart.id, sceneKey: 'later',
      position: 0, status: 'published', title: {} } });
    const beats = [f.beat];
    for (const [scene, position] of [[f.scene, 2], [f.scene, 3], [f.scene, 4], [f.scene, 5], [f.scene, 6],
      [f.scene, 7], [f.scene, 8], [f.scene, 9], [f.scene, 10], [tiedScene, 1], [tiedScene, 2], [laterScene, 1]] as const) {
      beats.push(await db.storyBeat.create({ data: { id: randomUUID(), sceneId: scene.id, position,
        beatType: ['paragraph', 'narration', 'dialogue'][position % 3], content: { en: `Exact source ${scene.sceneKey} ${position}.` } } }));
    }
    const scenes = new Map([f.scene, tiedScene, laterScene].map(scene => [scene.id, scene]));
    const parts = new Map([f.part, secondPart].map(part => [part.id, part]));
    const expected = beats.map(beat => {
      const scene = scenes.get(beat.sceneId)!;
      const part = parts.get(scene.partId)!;
      return { beatId: beat.id, sceneId: scene.id, partId: part.id, partPosition: part.position,
        scenePosition: scene.position, beatPosition: beat.position };
    }).sort((a, b) => a.partPosition - b.partPosition || a.scenePosition - b.scenePosition ||
      a.beatPosition - b.beatPosition || a.beatId.localeCompare(b.beatId));
    return { ...f, expected };
  }

  it('paginates across scenes/parts in narrative order with UUID ties, without duplicates or skips', async () => {
    const f = await pagedFixture();
    const first = await service.catalog(f.owner.id, f.work.id, { locale: 'en' });
    expect(first).toMatchObject({ contract: 'story-canonical-interaction-catalog-v1', ownerUserId: f.owner.id,
      workId: f.work.id, releaseId: f.release.id, releaseChecksum: f.release.checksum,
      manuscriptVersionId: f.manuscript.id, manuscriptHash: f.manuscript.contentHash, locale: 'en' });
    expect(first.items.map(row => row.beatId)).toEqual(f.expected.slice(0, 8).map(row => row.beatId));
    expect(first.nextAfterBeatId).toBe(f.expected[7].beatId);
    const second = await service.catalog(f.owner.id, f.work.id, { locale: 'en', afterBeatId: first.nextAfterBeatId!,
      expectedReleaseId: first.releaseId, expectedReleaseChecksum: first.releaseChecksum });
    expect(second.items.map(row => row.beatId)).toEqual(f.expected.slice(8).map(row => row.beatId));
    expect(second.nextAfterBeatId).toBeNull();
    for (const row of [...first.items, ...second.items]) {
      expect(row).toMatchObject(f.expected.find(expected => expected.beatId === row.beatId)!);
      expect(row.sourceAvailable).toBe(true);
    }
  });

  it.each(STORY_LOCALES)('returns verbatim exact %s text and no fallback when that locale is missing', async locale => {
    const f = await fixture();
    expect((await service.catalog(f.owner.id, f.work.id, { locale })).items[0]).toMatchObject({
      beatId: f.beat.id, sourceText: `  Exact ${locale} source.\n`, sourceAvailable: true });
    const content = Object.fromEntries(STORY_LOCALES.filter(value => value !== locale).map(value => [value, 'Other-locale source.']));
    await db.storyBeat.update({ where: { id: f.beat.id }, data: { content } });
    expect((await service.catalog(f.owner.id, f.work.id, { locale })).items[0]).toMatchObject({
      beatId: f.beat.id, sourceText: null, sourceAvailable: false });
  });

  it('does not stringify nested source blobs and enforces the UTF-16 source limit', async () => {
    const f = await fixture();
    for (const text of [{ private: 'DO_NOT_EXPOSE' }, ['DO_NOT_EXPOSE'], 42, '', 'x', 'x'.repeat(64001), '\uD83D\uDE80'.repeat(32001)]) {
      await db.storyBeat.update({ where: { id: f.beat.id }, data: { content: { en: text } } });
      const result = await service.catalog(f.owner.id, f.work.id, { locale: 'en' });
      expect(result.items[0]).toMatchObject({ beatId: f.beat.id, sourceText: null, sourceAvailable: false });
      expect(JSON.stringify(result)).not.toContain('DO_NOT_EXPOSE');
    }
    await db.storyBeat.update({ where: { id: f.beat.id }, data: { content: { en: '\uD83D\uDE80'.repeat(32000) } } });
    expect((await service.catalog(f.owner.id, f.work.id, { locale: 'en' })).items[0].sourceAvailable).toBe(true);
    // PostgreSQL JSONB rejects NUL/unpaired surrogate storage; those cases are exercised in the unit suite.
  });

  it('returns 404 for a cursor from another published work and for a nonowner', async () => {
    const f = await fixture(); const foreign = await fixture();
    await expect(service.catalog(f.owner.id, f.work.id, { locale: 'en', afterBeatId: foreign.beat.id,
      expectedReleaseId: f.release.id, expectedReleaseChecksum: f.release.checksum }))
      .rejects.toMatchObject({ status: 404, response: { code: 'STORY_INTERACTION_BEAT_UNAVAILABLE' } });
    await expect(service.catalog(f.reader.id, f.work.id, { locale: 'en' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each(['scene-draft', 'scene-fixture', 'part-draft', 'part-fixture', 'unsupported'])(
    'excludes a noncanonical source and rejects its cursor: %s', async change => {
      const f = await fixture();
      if (change === 'scene-draft') await db.storyScene.update({ where: { id: f.scene.id }, data: { status: 'draft' } });
      if (change === 'scene-fixture') await db.storyScene.update({ where: { id: f.scene.id }, data: { fixtureSource: true } });
      if (change === 'part-draft') await db.storyPart.update({ where: { id: f.part.id }, data: { status: 'draft' } });
      if (change === 'part-fixture') await db.storyPart.update({ where: { id: f.part.id }, data: { fixtureSource: true } });
      if (change === 'unsupported') await db.storyBeat.update({ where: { id: f.beat.id }, data: { beatType: 'image' } });
      const result = await service.catalog(f.owner.id, f.work.id, { locale: 'en' });
      expect(result.items).toEqual([]); expect(result.nextAfterBeatId).toBeNull();
      await expect(service.catalog(f.owner.id, f.work.id, { locale: 'en', afterBeatId: f.beat.id,
        expectedReleaseId: f.release.id, expectedReleaseChecksum: f.release.checksum })).rejects.toBeInstanceOf(NotFoundException);
    });

  it('returns conflict when either the current release or its checksum changes between pages', async () => {
    const f = await pagedFixture();
    const first = await service.catalog(f.owner.id, f.work.id, { locale: 'en' });
    const query = { locale: 'en', afterBeatId: first.nextAfterBeatId!, expectedReleaseId: first.releaseId,
      expectedReleaseChecksum: first.releaseChecksum };
    await db.storyRelease.update({ where: { id: f.release.id }, data: { checksum: 'c'.repeat(64) } });
    await expect(service.catalog(f.owner.id, f.work.id, query)).rejects.toBeInstanceOf(ConflictException);
    await db.storyRelease.update({ where: { id: f.release.id }, data: { status: 'retired' } });
    const next = await db.storyRelease.create({ data: { workId: f.work.id, version: 2, status: 'active',
      checksum: 'd'.repeat(64), manuscriptVersionId: f.manuscript.id, branchGraphSnapshot: {}, endingSetSnapshot: {},
      sceneAssetManifest: {}, localizedDisplaySnapshot: {}, createdByUserId: f.owner.id } });
    await db.storyWork.update({ where: { id: f.work.id }, data: { activeReleaseId: next.id } });
    await expect(service.catalog(f.owner.id, f.work.id, query)).rejects.toBeInstanceOf(ConflictException);
  });

  it('uses an actual read-only repeatable-read transaction and leaves audit/AI/assets/source state unchanged', async () => {
    const f = await fixture();
    async function snapshot() {
      return { work: await db.storyWork.findUnique({ where: { id: f.work.id } }),
        manuscript: await db.storyManuscriptVersion.findUnique({ where: { id: f.manuscript.id } }),
        beats: await db.storyBeat.findMany({ where: { sceneId: f.scene.id }, orderBy: { id: 'asc' } }),
        audits: await db.auditEvent.count(), approvals: await db.storyInteractionApproval.count(),
        ai: await db.storyAiContinuation.count(), generated: await db.storyAiGeneratedScene.count(),
        assets: await db.asset.count(), progress: await db.storyReaderProgress.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } }) };
    }
    const before = await snapshot();
    let checked = false;
    const observed = new StoryInteractionApprovalService({
      $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => db.$transaction(async tx => {
        return run(new Proxy(tx, { get(target, key) {
          if (key === '$queryRaw') return async (sql: Prisma.Sql) => {
            const settings = await tx.$queryRaw<Array<{ readOnly: string; isolation: string }>>(Prisma.sql`
              SELECT current_setting('transaction_read_only') AS "readOnly",
                current_setting('transaction_isolation') AS "isolation"`);
            expect(settings).toEqual([{ readOnly: 'on', isolation: 'repeatable read' }]); checked = true;
            return tx.$queryRaw(sql);
          };
          return Reflect.get(target, key);
        } }));
      }, options),
    } as never);
    const result = await observed.catalog(f.owner.id, f.work.id, { locale: 'en' });
    expect(checked).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result).not.toHaveProperty('structuredBody');
    expect(await snapshot()).toEqual(before);
  });
});

import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { StoryAuthoredImportService, assertAuthoredImportPublicationTx, authoredMaterializedSnapshot } from './story-authored-import.service';
import { StoryProductionService } from './story-production.service';
import { assertAuthoredImportTestDatabase, createAuthoredImportPgFixture } from './story-authored-import.postgres-fixture';
import { readActualAuthoredImportFixture } from './story-authored-import.actual-fixture';
import { authoredHash, prepareAuthoredSourceMap } from './story-authored-source-map.policy';
import { releaseChecksum } from './story-lifecycle.policy';

const enabled = process.env.STORY_AUTHORED_TEST_DATABASE_URL;
const pg = enabled ? describe : describe.skip;

pg('authored import real PostgreSQL constraints and transactions (private QA only)', () => {
  let db: PrismaClient;
  beforeAll(() => {
    assertAuthoredImportTestDatabase(enabled!);
    db = new PrismaClient({ datasources: { db: { url: enabled } } });
  });
  afterAll(async () => { await db?.$disconnect(); });

  const fixture = () => createAuthoredImportPgFixture(db);

  it('creates only a private complete candidate and replays the same key without duplication', async () => {
    const f = await fixture();
    const first = await f.apply();
    expect(first).toMatchObject({ applyExecuted: true, idempotentReplay: false, publishReady: false });
    expect(await f.apply()).toMatchObject({ idempotentReplay: true });
    const parts = await db.storyPart.findMany({ where: { workId: f.work.id } });
    expect(parts).toHaveLength(3);
    expect(parts.every(part => part.status === 'draft' && part.priceLumina.toString() === '37')).toBe(true);
    const receipt = await db.storyAuthoredImport.findUniqueOrThrow({ where: { workId: f.work.id } });
    expect(receipt).toMatchObject({ sourceSceneCount: 6, beatCount: 6, choiceCount: 9, actCount: 2 });
    expect(await db.storyVisualPrompt.count({ where: { workId: f.work.id } })).toBe(6);
    const scenes = await db.storyScene.findMany({ where: { partId: { in: parts.map(part => part.id) } } });
    expect(scenes.every(scene => scene.status === 'draft' && scene.endingType === null)).toBe(true);
    const choices = await db.storyChoice.findMany({ where: { sceneId: { in: scenes.map(scene => scene.id) } } });
    expect(choices.filter(choice => choice.position > 1).every(choice => choice.routeKind === 'generation_required' &&
      choice.targetSceneId === null && choice.targetEndingKey === null && choice.declaredRejoinSceneId === null)).toBe(true);
    expect((await db.storyWork.findUniqueOrThrow({ where: { id: f.work.id } })).status).toBe('draft');
    expect(await db.storyReleaseCapability.count({ where: { releaseId: f.release.id } })).toBe(0);
    await expect(new StoryProductionService(db as never).startProgress(f.owner.id, f.work.id, { mode: 'continue', locale: 'ko' }))
      .rejects.toMatchObject({ status: 404 });
  });

  it('serializes simultaneous identical apply and refuses a different key', async () => {
    const f = await fixture();
    const results = await Promise.all([f.apply(), f.apply()]);
    expect(results.filter(result => !('idempotentReplay' in result) || !result.idempotentReplay)).toHaveLength(1);
    expect(await db.storyAuthoredImport.count({ where: { workId: f.work.id } })).toBe(1);
    await expect(f.apply(randomUUID())).rejects.toMatchObject({ response: { code: 'AUTHORED_IMPORT_ALREADY_BOUND' } });
  });

  it('refuses nonempty works and cross-owner access without partial rows', async () => {
    const f = await fixture();
    const other = await db.user.create({ data: {} });
    await expect(f.service.execute(other.id, f.work.id, f.body, f.source.buffer, randomUUID())).rejects.toMatchObject({ status: 404 });
    await db.storyPart.create({ data: { workId: f.work.id, position: 1, title: {} } });
    await expect(f.apply()).rejects.toMatchObject({ response: { code: 'AUTHORED_INITIAL_WORK_NOT_EMPTY' } });
    expect(await db.storyPart.count({ where: { workId: f.work.id } })).toBe(1);
    expect(await db.storyAuthoredImport.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it('rolls back all materialized rows after an injected mid-transaction failure', async () => {
    const f = await fixture();
    const wrapped = new Proxy(db, { get(target, property) {
      if (property === '$transaction') return (run: (tx: unknown) => Promise<unknown>, options: unknown) =>
        db.$transaction(tx => run(new Proxy(tx, { get(t, p) {
          if (p === 'storyChoice') return { createMany: async () => { throw new Error('PRIVATE_SYNTHETIC_DATABASE_FAILURE'); } };
          return Reflect.get(t, p);
        } })), options as never);
      return Reflect.get(target, property);
    } });
    await expect(new StoryAuthoredImportService(wrapped as never).execute(f.owner.id, f.work.id, f.body, f.source.buffer, f.key))
      .rejects.toMatchObject({ response: { code: 'AUTHORED_IMPORT_FAILED' } });
    expect(await db.storyPart.count({ where: { workId: f.work.id } })).toBe(0);
    expect(await db.storyAuthoredImport.count({ where: { workId: f.work.id } })).toBe(0);
    expect(await db.storyVisualPrompt.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it('enforces paired visual JSON fields and immutable receipts in the database', async () => {
    const f = await fixture();
    await f.apply();
    const part = await db.storyPart.findFirstOrThrow({ where: { workId: f.work.id } });
    const scene = await db.storyScene.findFirstOrThrow({ where: { partId: part.id } });
    const beat = await db.storyBeat.findFirstOrThrow({ where: { sceneId: scene.id } });
    await expect(db.storyBeat.update({ where: { id: beat.id }, data: { visualManifest: Prisma.DbNull } })).rejects.toThrow();
    await expect(db.storyBeat.update({ where: { id: beat.id }, data: { visualManifest: { sceneKey: null } } })).rejects.toThrow();
    await expect(db.storyAuthoredImport.update({ where: { workId: f.work.id }, data: { planChecksum: 'f'.repeat(64) } })).rejects.toThrow();
    await expect(db.storyAuthoredImport.delete({ where: { workId: f.work.id } })).rejects.toThrow();
    const prompt = await db.storyVisualPrompt.findFirstOrThrow({ where: { workId: f.work.id } });
    await expect(db.storyVisualPrompt.update({ where: { id: prompt.id }, data: { promptText: `${prompt.promptText} changed` } })).rejects.toThrow();
    await expect(db.storyVisualPrompt.delete({ where: { id: prompt.id } })).rejects.toThrow();
  });

  it('never treats caller ready as approval and detects changed materialized content first', async () => {
    const f = await fixture();
    await f.apply();
    await expect(db.$transaction(tx => assertAuthoredImportPublicationTx(tx, f.work.id, f.release.id)))
      .rejects.toMatchObject({ response: { code: 'AUTHORED_IMPORT_REVIEW_BINDING_REQUIRED' } });
    await expect(db.storyWork.update({ where: { id: f.work.id }, data: { status: 'published', activeReleaseId: f.release.id } })).rejects.toThrow();
    const part = await db.storyPart.findFirstOrThrow({ where: { workId: f.work.id } });
    const scene = await db.storyScene.findFirstOrThrow({ where: { partId: part.id } });
    const beat = await db.storyBeat.findFirstOrThrow({ where: { sceneId: scene.id } });
    await db.storyBeat.update({ where: { id: beat.id }, data: { content: { ko: 'Changed synthetic body.' } } });
    await expect(db.$transaction(tx => assertAuthoredImportPublicationTx(tx, f.work.id, f.release.id)))
      .rejects.toMatchObject({ response: { code: 'AUTHORED_MATERIALIZED_CONTENT_CHANGED' } });
    await expect(f.apply()).rejects.toMatchObject({ response: { code: 'AUTHORED_MATERIALIZED_CONTENT_CHANGED' } });
  });

  (process.env.AUTHORED_SOURCE_MAP_PATH && process.env.AUTHORED_ANALYSIS_INPUT_PATH ? it : it.skip)(
    'persists the complete actual 216-part graph privately without authorizing public traversal', async () => {
      const source = readActualAuthoredImportFixture();
      const plan = prepareAuthoredSourceMap(source.buffer, source.manuscript, source.ending);
      const f = await createAuthoredImportPgFixture(db, source);
      const first = await f.apply();
      expect(first).toMatchObject({ applyExecuted: true, publishReady: false,
        counts: { parts: 216, acts: 11, sourceScenes: 2138, choices: 648, verifiedVisualAssets: 0 } });
      expect(await f.apply()).toMatchObject({ idempotentReplay: true, publishReady: false });
      const rows = await authoredMaterializedSnapshot(db, f.work.id);
      const receipt = await db.storyAuthoredImport.findUniqueOrThrow({ where: { workId: f.work.id } });
      expect(releaseChecksum(rows)).toBe(receipt.materializedChecksum);
      expect(rows.parts).toHaveLength(216);
      expect(rows.scenes).toHaveLength(216);
      expect(rows.choices).toHaveLength(648);
      expect(new Set(rows.beats.map(beat => beat.sourceSceneKey)).size).toBe(2138);
      expect(await db.storyVisualPrompt.count({ where: { workId: f.work.id } })).toBe(2138);
      // Only digests/booleans enter assertion output, never actual private prose.
      for (const [i, part] of rows.parts.entries()) {
        const scene = rows.scenes.find(row => row.partId === part.id)!;
        const expected = plan.parts[i];
        const beats = rows.beats.filter(beat => beat.sceneId === scene.id);
        const choices = rows.choices.filter(choice => choice.sceneId === scene.id);
        expect(part.status === 'draft' && scene.status === 'draft' && scene.endingType === null).toBe(true);
        expect(part.actNumber).toBe(expected.actNumber);
        expect(beats.length).toBeGreaterThan(0);
        expect(beats.length).toBeLessThanOrEqual(40);
        expect(authoredHash(JSON.stringify(beats.map(beat => ({ key: beat.sourceSceneKey,
          text: (beat.content as Record<string, string>).ko })))))
          .toBe(authoredHash(JSON.stringify(expected.packing.beats.map(beat => ({ key: beat.sourceSceneKey, text: beat.text })))));
        expect(beats.every(beat => (beat.visualManifest as Record<string, unknown>).sceneKey === beat.sourceSceneKey)).toBe(true);
        expect(choices).toHaveLength(3);
        expect(authoredHash(JSON.stringify(choices.map(choice => (choice.label as Record<string, string>).ko))))
          .toBe(authoredHash(JSON.stringify(expected.choices.map(choice => choice.label))));
        const next = rows.scenes.find(row => row.partId === rows.parts[i + 1]?.id);
        expect(choices[0].targetSceneId).toBe(next?.id ?? null);
        expect(choices[0].targetEndingKey).toBe(i === 215 ? 'author_main' : null);
        expect(choices.slice(1).every(choice => choice.routeKind === 'generation_required' &&
          choice.targetSceneId === null && choice.targetEndingKey === null && choice.declaredRejoinSceneId === null)).toBe(true);
      }
      expect(new Set(rows.parts.map(part => part.actNumber)).size).toBe(11);
      await expect(db.$transaction(tx => assertAuthoredImportPublicationTx(tx, f.work.id, f.release.id)))
        .rejects.toMatchObject({ response: { code: 'AUTHORED_IMPORT_REVIEW_BINDING_REQUIRED' } });
      await expect(new StoryProductionService(db as never).startProgress(f.owner.id, f.work.id, { mode: 'continue', locale: 'ko' }))
        .rejects.toMatchObject({ status: 404 });
      expect(await db.storyReleaseCapability.count({ where: { releaseId: f.release.id } })).toBe(0);
      expect(await db.storyReaderProgress.count({ where: { workId: f.work.id } })).toBe(0);
      const after = readActualAuthoredImportFixture();
      expect(authoredHash(after.buffer)).toBe(authoredHash(source.buffer));
      expect(after.manuscript.contentHash).toBe(source.manuscript.contentHash);
    }, 120000);
});

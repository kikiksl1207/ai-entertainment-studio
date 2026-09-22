import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { authorContentChecksum } from './story-author-final-review.store';
import { assertAuthorReviewTestDatabase, authorReviewPgFixture } from './story-author-final-review.postgres-fixture';

const databaseUrl = process.env.STORY_AUTHOR_REVIEW_TEST_DATABASE_URL;
const pg = databaseUrl ? describe : describe.skip;
type Ids = { work: string; part: string; scene: string; beat: string; choice: string;
  otherWork: string; otherPart: string; otherScene: string; otherBeat: string; otherChoice: string };

const changes: Array<[string, (r: Ids) => Prisma.Sql]> = [
  ['part title', r => Prisma.sql`UPDATE story_parts SET title = '{"ko":"Changed"}'::jsonb WHERE id = ${r.part}::uuid`],
  ['part price', r => Prisma.sql`UPDATE story_parts SET price_lumina = price_lumina + 1 WHERE id = ${r.part}::uuid`],
  ['part order', r => Prisma.sql`UPDATE story_parts SET position = 9999 WHERE id = ${r.part}::uuid`],
  ['part act and season', r => Prisma.sql`UPDATE story_parts SET act_number = 99, season_key = 'changed' WHERE id = ${r.part}::uuid`],
  ['part fixture identity', r => Prisma.sql`UPDATE story_parts SET fixture_source = true WHERE id = ${r.part}::uuid`],
  ['scene title', r => Prisma.sql`UPDATE story_scenes SET title = '{}'::jsonb WHERE id = ${r.scene}::uuid`],
  ['scene source identity', r => Prisma.sql`UPDATE story_scenes SET scene_key = 'changed' WHERE id = ${r.scene}::uuid`],
  ['scene order', r => Prisma.sql`UPDATE story_scenes SET position = 9999 WHERE id = ${r.scene}::uuid`],
  ['scene visual', r => Prisma.sql`UPDATE story_scenes SET visual_manifest = '{}'::jsonb WHERE id = ${r.scene}::uuid`],
  ['scene ending', r => Prisma.sql`UPDATE story_scenes SET ending_type = 'changed' WHERE id = ${r.scene}::uuid`],
  ['scene fixture identity', r => Prisma.sql`UPDATE story_scenes SET fixture_source = true WHERE id = ${r.scene}::uuid`],
  ['beat body', r => Prisma.sql`UPDATE story_beats SET content = '{"ko":"Changed reader body"}'::jsonb WHERE id = ${r.beat}::uuid`],
  ['beat kind', r => Prisma.sql`UPDATE story_beats SET beat_type = 'dialogue' WHERE id = ${r.beat}::uuid`],
  ['beat order', r => Prisma.sql`UPDATE story_beats SET position = 9999 WHERE id = ${r.beat}::uuid`],
  ['beat source mapping', r => Prisma.sql`UPDATE story_beats SET source_scene_key = 'changed' WHERE id = ${r.beat}::uuid`],
  ['beat visual', r => Prisma.sql`UPDATE story_beats SET visual_manifest = '{}'::jsonb WHERE id = ${r.beat}::uuid`],
  ['choice label', r => Prisma.sql`UPDATE story_choices SET label = '{"ko":"Changed choice"}'::jsonb WHERE id = ${r.choice}::uuid`],
  ['choice identity', r => Prisma.sql`UPDATE story_choices SET choice_key = 'changed' WHERE id = ${r.choice}::uuid`],
  ['choice order', r => Prisma.sql`UPDATE story_choices SET position = 9999 WHERE id = ${r.choice}::uuid`],
  ['choice routing', r => Prisma.sql`UPDATE story_choices SET route_kind = 'generation_required' WHERE id = ${r.choice}::uuid`],
  ['choice target', r => Prisma.sql`UPDATE story_choices SET target_scene_id = NULL WHERE id = ${r.choice}::uuid`],
  ['choice ending', r => Prisma.sql`UPDATE story_choices SET target_ending_key = 'changed' WHERE id = ${r.choice}::uuid`],
  ['choice rejoin', r => Prisma.sql`UPDATE story_choices SET declared_rejoin_scene_id = ${r.scene}::uuid WHERE id = ${r.choice}::uuid`],
  ['part deletion', r => Prisma.sql`DELETE FROM story_parts WHERE id = ${r.part}::uuid`],
  ['scene deletion', r => Prisma.sql`DELETE FROM story_scenes WHERE id = ${r.scene}::uuid`],
  ['beat deletion', r => Prisma.sql`DELETE FROM story_beats WHERE id = ${r.beat}::uuid`],
  ['choice deletion', r => Prisma.sql`DELETE FROM story_choices WHERE id = ${r.choice}::uuid`],
  ['part addition', r => Prisma.sql`INSERT INTO story_parts(work_id, position, title) VALUES (${r.work}::uuid, 9999, '{}'::jsonb)`],
  ['scene addition', r => Prisma.sql`INSERT INTO story_scenes(part_id, scene_key, position, title) VALUES (${r.part}::uuid, 'extra', 9999, '{}'::jsonb)`],
  ['beat addition', r => Prisma.sql`INSERT INTO story_beats(scene_id, position, beat_type, content) VALUES (${r.scene}::uuid, 9999, 'paragraph', '{}'::jsonb)`],
  ['choice addition', r => Prisma.sql`INSERT INTO story_choices(scene_id, choice_key, position, label) VALUES (${r.scene}::uuid, 'extra', 9999, '{}'::jsonb)`],
  ['part outbound reparent', r => Prisma.sql`UPDATE story_parts SET work_id = ${r.otherWork}::uuid, position = 9999 WHERE id = ${r.part}::uuid`],
  ['scene outbound reparent', r => Prisma.sql`UPDATE story_scenes SET part_id = ${r.otherPart}::uuid, scene_key = 'moved', position = 9999 WHERE id = ${r.scene}::uuid`],
  ['beat outbound reparent', r => Prisma.sql`UPDATE story_beats SET scene_id = ${r.otherScene}::uuid, position = 9999 WHERE id = ${r.beat}::uuid`],
  ['choice outbound reparent', r => Prisma.sql`UPDATE story_choices SET scene_id = ${r.otherScene}::uuid, choice_key = 'moved', position = 9999 WHERE id = ${r.choice}::uuid`],
  ['part inbound reparent', r => Prisma.sql`UPDATE story_parts SET work_id = ${r.work}::uuid, position = 9999 WHERE id = ${r.otherPart}::uuid`],
  ['scene inbound reparent', r => Prisma.sql`UPDATE story_scenes SET part_id = ${r.part}::uuid, scene_key = 'moved', position = 9999 WHERE id = ${r.otherScene}::uuid`],
  ['beat inbound reparent', r => Prisma.sql`UPDATE story_beats SET scene_id = ${r.scene}::uuid, position = 9999 WHERE id = ${r.otherBeat}::uuid`],
  ['choice inbound reparent', r => Prisma.sql`UPDATE story_choices SET scene_id = ${r.scene}::uuid, choice_key = 'moved', position = 9999 WHERE id = ${r.otherChoice}::uuid`],
];

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function sqlState(error: unknown): string {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return 'unexpected';
  return error.code === 'P2034' ? '40001' : String(error.meta?.code ?? error.code);
}

pg('approved canonical content DB guard (synthetic disposable QA)', () => {
  let db: PrismaClient;
  let approved: Awaited<ReturnType<typeof authorReviewPgFixture>>;
  let ids: Ids;
  let digest: string;

  async function rowIds(work: string) {
    const part = await db.storyPart.findFirstOrThrow({ where: { workId: work }, orderBy: { position: 'asc' } });
    const scene = await db.storyScene.findFirstOrThrow({ where: { partId: part.id } });
    const beat = await db.storyBeat.findFirstOrThrow({ where: { sceneId: scene.id }, orderBy: { position: 'asc' } });
    const choice = await db.storyChoice.findFirstOrThrow({ where: { sceneId: scene.id }, orderBy: { position: 'asc' } });
    return { work, part: part.id, scene: scene.id, beat: beat.id, choice: choice.id };
  }

  beforeAll(async () => {
    assertAuthorReviewTestDatabase(databaseUrl!);
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    approved = await authorReviewPgFixture(db);
    await approved.confirm();
    await approved.publish();
    const other = await authorReviewPgFixture(db);
    const a = await rowIds(approved.work.id);
    const b = await rowIds(other.work.id);
    ids = { ...a, otherWork: b.work, otherPart: b.part, otherScene: b.scene, otherBeat: b.beat, otherChoice: b.choice };
    digest = await authorContentChecksum(db, ids.work);
  }, 30000);
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(async () => { if (ids) expect(await authorContentChecksum(db, ids.work)).toBe(digest); });

  async function blocked(query: Prisma.Sql, state = '23514', message = 'AUTHOR_APPROVED_CONTENT_IMMUTABLE') {
    let result = { state: 'unexpected', expectedMessage: false };
    try {
      await db.$transaction(async tx => {
        await tx.$executeRaw(query);
        // Always roll back a counterexample even if the guard is broken.
        throw new Error('Missing expected mutation guard');
      }, { maxWait: 2000, timeout: 10000 });
    } catch (error) {
      result = { state: sqlState(error), expectedMessage: !message ||
        (error instanceof Error && error.message.includes(message)) };
    }
    expect(result).toEqual({ state, expectedMessage: true });
  }

  it.each(changes)('rejects direct SQL %s after a valid publication', async (_label, query) => {
    await blocked(query(ids));
  });

  it('denies table-wide TRUNCATE rather than relying on snapshot-visible proof rows', async () => {
    await blocked(Prisma.sql`TRUNCATE TABLE story_beats`, '23514', 'AUTHOR_CANONICAL_TRUNCATE_UNSUPPORTED');
  });

  it('freezes content immediately at approval, before publication', async () => {
    const f = await authorReviewPgFixture(db);
    await f.confirm();
    const r = await rowIds(f.work.id);
    await blocked(Prisma.sql`UPDATE story_beats SET content = '{}'::jsonb WHERE id = ${r.beat}::uuid`);
    expect((await db.storyWork.findUniqueOrThrow({ where: { id: f.work.id } })).status).toBe('release_ready');
  });

  it('allows unchanged content and controlled part/scene lifecycle fields under the work-first lock', async () => {
    await db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${ids.work}::uuid FOR UPDATE`);
      await tx.storyPart.update({ where: { id: ids.part }, data: { status: 'draft', updatedAt: new Date() } });
      await tx.storyScene.update({ where: { id: ids.scene }, data: { status: 'draft', updatedAt: new Date() } });
      await tx.storyPart.update({ where: { id: ids.part }, data: { status: 'published', publishedAt: new Date() } });
      await tx.storyScene.update({ where: { id: ids.scene }, data: { status: 'published' } });
      await tx.$executeRaw(Prisma.sql`UPDATE story_beats SET content = content WHERE id = ${ids.beat}::uuid`);
    });
  });

  it('allows suspension/resumption of the same approved release without reapproving draft content', async () => {
    let work = await db.storyWork.findUniqueOrThrow({ where: { id: ids.work } });
    await approved.lifecycle.transitionPublication(approved.owner.id, ids.work,
      { toStatus: 'sale_suspended', expectedRevision: work.releaseRevision }, randomUUID());
    work = await db.storyWork.findUniqueOrThrow({ where: { id: ids.work } });
    await approved.lifecycle.transitionPublication(approved.owner.id, ids.work,
      { toStatus: 'published', releaseId: approved.release.id, expectedRevision: work.releaseRevision }, randomUUID());
    expect((await db.storyWork.findUniqueOrThrow({ where: { id: ids.work } })).status).toBe('published');
    expect(await db.storyAuthorFinalReviewProof.count({ where: { workId: ids.work } })).toBe(1);
  });

  it('keeps revoked content immutable while allowing suspension and refusing republication', async () => {
    const f = await authorReviewPgFixture(db);
    await f.confirm();
    await f.publish();
    const proof = await db.storyAuthorFinalReviewProof.findUniqueOrThrow({ where: { reviewId: f.review.id } });
    const r = await rowIds(f.work.id);
    await f.service.revoke(f.owner.id, proof.id);
    await blocked(Prisma.sql`UPDATE story_beats SET content = '{}'::jsonb WHERE id = ${r.beat}::uuid`);
    let work = await db.storyWork.findUniqueOrThrow({ where: { id: f.work.id } });
    await f.lifecycle.transitionPublication(f.owner.id, f.work.id,
      { toStatus: 'sale_suspended', expectedRevision: work.releaseRevision }, randomUUID());
    work = await db.storyWork.findUniqueOrThrow({ where: { id: f.work.id } });
    await expect(f.lifecycle.transitionPublication(f.owner.id, f.work.id,
      { toStatus: 'published', releaseId: f.release.id, expectedRevision: work.releaseRevision }, randomUUID()))
      .rejects.toMatchObject({ response: { code: 'AUTHOR_FINAL_REVIEW_PROOF_REVOKED' } });
  });

  it('fails direct child writes fast while another transaction holds work, without an inverse lock wait', async () => {
    const ready = signal();
    const release = signal();
    const holder = db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${ids.work}::uuid FOR UPDATE`);
      ready.resolve();
      await release.promise;
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_beats WHERE id = ${ids.beat}::uuid FOR UPDATE`);
    }, { maxWait: 2000, timeout: 15000 });
    const settled = holder.finally(() => ready.resolve());
    try {
      await ready.promise;
      await blocked(Prisma.sql`UPDATE story_beats SET content = '{}'::jsonb WHERE id = ${ids.beat}::uuid`, '55P03', '');
    } finally {
      release.resolve();
      await settled;
    }
  }, 20000);

  it('rejects an old repeatable-read snapshot that predates the proof commit', async () => {
    const f = await authorReviewPgFixture(db);
    const r = await rowIds(f.work.id);
    const ready = signal();
    const proceed = signal();
    const writer = db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${r.work}::uuid`);
      ready.resolve();
      await proceed.promise;
      await tx.$executeRaw(Prisma.sql`UPDATE story_beats SET content = '{}'::jsonb WHERE id = ${r.beat}::uuid`);
      throw new Error('Stale writer unexpectedly passed the guard');
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 15000 });
    const outcome = writer.then(() => 'committed', error => sqlState(error)).finally(() => ready.resolve());
    try {
      await ready.promise;
      await f.confirm();
    } finally { proceed.resolve(); }
    expect(await outcome).toBe('40001');
    expect(await authorContentChecksum(db, r.work)).toBe(f.proposal.snapshot.contentChecksum);
  }, 20000);

  it('does not make unapproved legacy rows immutable', async () => {
    const owner = await db.user.create({ data: {} });
    const work = await db.storyWork.create({ data: { ownerUserId: owner.id, slug: `legacy-edit-${randomUUID()}`, title: {}, summary: {} } });
    const part = await db.storyPart.create({ data: { workId: work.id, position: 1, title: {} } });
    const scene = await db.storyScene.create({ data: { partId: part.id, position: 1, sceneKey: 'legacy', title: {} } });
    const beat = await db.storyBeat.create({ data: { sceneId: scene.id, position: 1, beatType: 'paragraph', content: {} } });
    await db.storyBeat.update({ where: { id: beat.id }, data: { content: { ko: 'Edited synthetic legacy body.' } } });
    await db.storyBeat.delete({ where: { id: beat.id } });
    expect(await db.storyAuthorFinalReviewProof.count({ where: { workId: work.id } })).toBe(0);
  });
});

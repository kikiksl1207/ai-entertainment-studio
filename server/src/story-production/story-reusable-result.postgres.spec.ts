import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { activationFixture, postgresClient } from './story-ai-activation.postgres-fixture';

const describePostgres = process.env.STORY_TEST_DATABASE_URL ? describe : describe.skip;

describePostgres('shared story result PostgreSQL ownership and lifecycle', () => {
  let db: PrismaClient;
  let f: Awaited<ReturnType<typeof activationFixture>>;
  let source: Awaited<ReturnType<typeof f.generate>>;
  const region = process.env.STORY_AI_REGION;
  beforeAll(async () => {
    process.env.STORY_AI_REGION = 'KR';
    db = postgresClient();
    f = await activationFixture(db);
    source = await f.generate();
    await f.approve(source);
  }, 30000);
  afterAll(async () => {
    if (region === undefined) delete process.env.STORY_AI_REGION; else process.env.STORY_AI_REGION = region;
    await db?.$disconnect();
  });

  function pending(overrides: Record<string, unknown> = {}) {
    const { id: _id, createdAt: _created, updatedAt: _updated, ...snapshot } = source;
    return { ...snapshot, reuseKey: randomUUID(), claimToken: 'new-claim', status: 'pending',
      originGeneratedSceneId: null, reviewPendingAt: null, resultChecksum: null, title: undefined,
      visualManifest: undefined, approvedAt: null, ...overrides };
  }

  it('installs composite source ownership and origin constraints', async () => {
    const [row] = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_constraint WHERE conname IN (
      'story_ai_reusable_results_part_work_fk','story_ai_reusable_results_scene_part_fk',
      'story_ai_reusable_results_source_choice_fk','story_ai_reusable_results_source_shared_owner_fk',
      'story_ai_reusable_results_source_shared_choice_fk','story_ai_reusable_result_origin_fk')`;
    expect(Number(row.count)).toBe(6);
  });

  it('rejects cross-work canonical source ownership', async () => {
    const other = await activationFixture(db);
    await expect(db.storyAiReusableResult.create({ data: pending({
      workId: other.work.id, releaseId: other.release.id, manuscriptVersionId: other.manuscript.id,
    }) as never })).rejects.toThrow(/part_work_fk|Foreign key/);
  });

  it('rejects cross-work and cross-release shared sources', async () => {
    const other = await activationFixture(db);
    await expect(db.storyAiReusableResult.create({ data: pending({
      workId: other.work.id, releaseId: other.release.id, manuscriptVersionId: other.manuscript.id,
      sourceKind: 'generated', sourceCanonicalPartId: null, sourceCanonicalSceneId: null,
      sourceCanonicalChoiceId: null, sourceSharedResultId: source.id, sourceSharedChoiceKey: 'next',
    }) as never })).rejects.toThrow(/approved shared source|owner_fk/);
    const release2 = await db.storyRelease.create({ data: {
      workId: f.work.id, version: 2, manuscriptVersionId: f.manuscript.id, checksum: 'release-2',
      branchGraphSnapshot: {}, endingSetSnapshot: {}, sceneAssetManifest: {}, localizedDisplaySnapshot: {}, createdByUserId: f.owner.id,
    } });
    await expect(db.storyAiReusableResult.create({ data: pending({
      releaseId: release2.id, sourceKind: 'generated', sourceCanonicalPartId: null, sourceCanonicalSceneId: null,
      sourceCanonicalChoiceId: null, sourceSharedResultId: source.id, sourceSharedChoiceKey: 'next',
    }) as never })).rejects.toThrow(/approved shared source|owner_fk/);
  });

  it('rejects nonexistent shared choice, accepts exact owned approved choice', async () => {
    const data = pending({ sourceKind: 'generated', sourceCanonicalPartId: null, sourceCanonicalSceneId: null,
      sourceCanonicalChoiceId: null, sourceSharedResultId: source.id, sourceSharedChoiceKey: 'missing' });
    await expect(db.storyAiReusableResult.create({ data: data as never })).rejects.toThrow(/approved shared source|choice_fk/);
    await expect(db.storyAiReusableResult.create({ data: { ...data, sourceSharedChoiceKey: 'next' } as never }))
      .resolves.toMatchObject({ status: 'pending' });
  });

  it.each(['approved', 'revoked'])('rejects direct %s INSERT', async (status) => {
    await expect(db.storyAiReusableResult.create({ data: pending({ status }) as never }))
      .rejects.toThrow(/must be inserted as pending|requires active legal/);
  });

  it('rejects rewriting approval timestamp and origin checksum', async () => {
    await expect(db.storyAiReusableResult.update({ where: { id: source.id }, data: { approvedAt: new Date(0) } }))
      .rejects.toThrow(/approval timestamp is immutable/);
    await expect(db.storyAiReusableResult.update({ where: { id: source.id }, data: { resultChecksum: 'f'.repeat(64) } }))
      .rejects.toThrow(/review origin is immutable|output is immutable/);
  });
});

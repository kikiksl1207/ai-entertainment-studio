import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { activationFixture } from './story-ai-activation.postgres-fixture';
import { StoryProductionService } from './story-production.service';
import { StoryAuthorBodyPreviewService } from './story-author-body-preview.service';
import { StoryCanonicalReadService } from './story-canonical-read.service';
import { canonicalEndingPosition } from './story-canonical-ending.store';
import { STORY_LOCALES } from './story-production.policy';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
jest.setTimeout(30000);
const localized = (text: string) => Object.fromEntries(STORY_LOCALES.map(locale => [locale, `${locale} ${text}`]));
const visual = { sceneKey: 'source', background: { state: 'missing' }, characters: [],
  fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' } };

postgres('canonical ending reread on real isolated PostgreSQL, no paid providers', () => {
  let db: PrismaClient;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
      parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash ||
      !/^\/lumina_failed_cost_qa_[a-f0-9]{12}$/.test(parsed.pathname)) throw new Error('Dedicated loopback QA database required');
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
  });
  afterAll(async () => { await db?.$disconnect(); });

  async function prepared(targeted = false, sceneOnly = false) {
    const f = await activationFixture(db, false);
    await db.storyWork.update({ where: { id: f.work.id }, data: { slug: `canonical-ending-${randomUUID()}`,
      title: localized('Authored story'), publishedAt: new Date(0) } });
    await db.storyPart.update({ where: { id: f.part.id }, data: { title: localized('Last part') } });
    await db.storyScene.update({ where: { id: f.scene.id }, data: { title: localized('Final source'), visualManifest: visual } });
    const beat = await db.storyBeat.update({ where: { sceneId_position: { sceneId: f.scene.id, position: 1 } },
      data: { content: localized('Synthetic final prose.') } });
    const target = targeted ? await db.storyScene.create({ data: { partId: f.part.id, sceneKey: 'ending', position: 2,
      title: localized('Authored ending'), visualManifest: { ...visual, sceneKey: 'ending' },
      endingType: 'author_sub', status: 'published' } }) : null;
    const targetBeat = target && await db.storyBeat.create({ data: { sceneId: target.id, position: 1,
      beatType: 'paragraph', content: localized('Synthetic targeted ending.') } });
    const original = await db.storyChoice.create({ data: { sceneId: f.scene.id, choiceKey: 'original', position: 2,
      label: localized('Finish the original'), routeKind: 'writer_original', targetSceneId: target?.id,
      targetEndingKey: sceneOnly ? null : targeted ? 'author-sub-ending' : 'author_main' } });
    await db.storyReaderProgress.update({ where: { id: f.progresses[0].id }, data: { currentBeatPosition: 1 } });
    const stories = new StoryProductionService(db as never);
    const choose = () => stories.selectChoice(f.reader.id, f.progresses[0].id, original.id, 1, 'ko');
    const progress = () => db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progresses[0].id } });
    return { ...f, beat, target, targetBeat, original, stories, choose, progress };
  }
  type Fixture = Awaited<ReturnType<typeof prepared>>;
  async function immutableState(f: Fixture) {
    return { events: await db.storyChoiceEvent.findMany({ where: { progressId: f.progresses[0].id } }),
      endings: await db.storyEndingDiscovery.findMany({ where: { workId: f.work.id } }),
      continuations: await db.storyAiContinuation.findMany({ where: { workId: f.work.id } }),
      costs: await db.storyAiUsageLedger.findMany({ where: { workId: f.work.id } }),
      routes: await db.storyProgressRouteNode.findMany({ where: { workId: f.work.id } }) };
  }

  async function unavailableReadSnapshot(f: Fixture) {
    const history = await immutableState(f);
    // Stabilize row order only; retain every field, JSON value and Date unchanged.
    const ordered = <T extends { id: string }>(rows: T[]) =>
      [...rows].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    return { progress: await f.progress(), history: {
      events: ordered(history.events), endings: ordered(history.endings),
      continuations: ordered(history.continuations), costs: ordered(history.costs),
      routes: ordered(history.routes),
    } };
  }

  async function expectCompletedEndingUnavailable(f: Fixture, read: () => Promise<unknown>) {
    const before = await unavailableReadSnapshot(f);
    let error: unknown;
    try { await read(); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
    expect((error as ConflictException).getResponse()).toEqual({
      code: 'STORY_COMPLETED_ENDING_UNAVAILABLE', retryable: false, progressMutated: false,
    });
    expect(await unavailableReadSnapshot(f)).toStrictEqual(before);
    expect(f.provider.generate).not.toHaveBeenCalled();
    return before;
  }

  it.each(['source', 'target', 'scene-only'] as const)('keeps the real canonical ending position (%s) for reread without reopening choices', async kind => {
    const targeted = kind !== 'source', f = await prepared(targeted, kind === 'scene-only');
    const result = await f.choose();
    const endingScene = f.target ?? f.scene;
    expect(result).toMatchObject({ status: 'completed', scene: { id: endingScene.id }, choices: [] });
    expect(await f.progress()).toMatchObject({ currentSceneId: endingScene.id, currentGeneratedSceneId: null,
      currentBeatPosition: targeted ? 0 : 1, progressRevision: 2, status: 'completed' });
    const before = await immutableState(f);
    for (const locale of STORY_LOCALES) {
      const reread = await f.stories.currentProgress(f.reader.id, f.progresses[0].id, locale);
      expect(reread).toMatchObject({ status: 'completed', scene: { id: endingScene.id }, choices: [] });
      expect(reread.scene!.beats[0].content).toEqual({ locale, fallback: false,
        value: `${locale} Synthetic ${targeted ? 'targeted ending' : 'final prose'}.` });
    }
    await expect(f.choose()).rejects.toBeInstanceOf(ConflictException);
    await expect(f.stories.currentProgress(f.second.id, f.progresses[0].id, 'ko')).rejects.toBeInstanceOf(NotFoundException);
    expect(await immutableState(f)).toEqual(before);
    expect(before.continuations).toEqual([]);
    expect(before.costs).toEqual([]);
    if (kind === 'scene-only') expect(before.endings).toEqual([]);
    expect(f.provider.generate).not.toHaveBeenCalled();
  });
  it.each(['source', 'target', 'scene-only'] as const)('lets only the evidenced ending advance its reading position and explicitly confirm its exact source (%s)', async kind => {
    const targeted = kind !== 'source', f = await prepared(targeted, kind === 'scene-only');
    await f.choose();
    const before = await immutableState(f);
    await f.stories.updateBeatProgress(f.reader.id, f.progresses[0].id, { position: 1, expectedRevision: 2 }, 'ko');
    expect(await f.progress()).toMatchObject({ status: 'completed', progressRevision: 3, currentBeatPosition: 1 });
    await expect(f.stories.updateBeatProgress(f.reader.id, f.progresses[0].id, { position: 1, expectedRevision: 2 }, 'ko'))
      .rejects.toBeInstanceOf(ConflictException);
    const reads = new StoryCanonicalReadService(db as never);
    const beatId = f.targetBeat?.id ?? f.beat.id;
    const preview = await reads.preview(f.reader.id, f.progresses[0].id, beatId, { locale: 'ko' });
    const input = { locale: 'ko', expectedRevision: preview.expectedRevision, expectedScopeChecksum: preview.scopeChecksum,
      expectedSourceTextHash: preview.sourceTextHash, displayedAndRead: true, idempotencyKey: randomUUID() };
    const confirmed = await reads.confirm(f.reader.id, f.progresses[0].id, beatId, input);
    expect(confirmed).toMatchObject({ beatId, readerMemoryApplied: false, idempotentReplay: false });
    expect(await reads.confirm(f.reader.id, f.progresses[0].id, beatId, input)).toMatchObject({ idempotentReplay: true });
    expect(await immutableState(f)).toEqual(before);
  });
  it('exposes the completed canonical body to its owner-only preview without image generation', async () => {
    const f = await prepared();
    await db.storyReaderProgress.update({ where: { id: f.progresses[0].id }, data: { userId: f.owner.id } });
    await f.stories.selectChoice(f.owner.id, f.progresses[0].id, f.original.id, 1, 'ko');
    const preview = new StoryAuthorBodyPreviewService(db as never);
    for (const locale of STORY_LOCALES) {
      expect(await preview.preview(f.owner.id, f.work.id, { locale })).toMatchObject({
        readOnly: true, imageGenerationStarted: false, progress: { status: 'completed', scene: { id: f.scene.id }, choices: [] } });
    }
    await expect(preview.preview(f.reader.id, f.work.id, { locale: 'ko' })).rejects.toBeInstanceOf(NotFoundException);
    expect(await db.storyVisualGeneration.count({ where: { workId: f.work.id } })).toBe(0);
  });
  it.each(['source', 'target', 'scene-only'] as const)('recovers legacy %s prose in read-only projections without repairing stored history', async kind => {
    const f = await prepared(kind !== 'source', kind === 'scene-only');
    await db.storyReaderProgress.update({ where: { id: f.progresses[0].id }, data: { userId: f.owner.id } });
    await f.stories.selectChoice(f.owner.id, f.progresses[0].id, f.original.id, 1, 'ko');
    await db.storyReaderProgress.update({ where: { id: f.progresses[0].id }, data: { currentSceneId: null, currentBeatPosition: 0 } });
    const before = await f.progress(), history = await immutableState(f), endingScene = f.target ?? f.scene;
    const preview = new StoryAuthorBodyPreviewService(db as never);
    for (const locale of STORY_LOCALES) {
      expect(await f.stories.currentProgress(f.owner.id, before.id, locale)).toMatchObject({
        status: 'completed', scene: { id: endingScene.id }, choices: [], revision: before.progressRevision });
      expect(await preview.preview(f.owner.id, f.work.id, { locale })).toMatchObject({
        readOnly: true, imageGenerationStarted: false, progress: { status: 'completed', scene: { id: endingScene.id }, choices: [] } });
    }
    expect(await f.progress()).toEqual(before);
    expect(await immutableState(f)).toEqual(history);
    await expect(f.stories.updateBeatProgress(f.owner.id, before.id, { position: 1, expectedRevision: before.progressRevision }, 'ko'))
      .rejects.toBeInstanceOf(NotFoundException);
    const reads = new StoryCanonicalReadService(db as never);
    await expect(reads.preview(f.owner.id, before.id, f.targetBeat?.id ?? f.beat.id, { locale: 'ko' }))
      .rejects.toBeInstanceOf(ConflictException);
    if (kind !== 'scene-only') {
      await db.storyEndingDiscovery.deleteMany({ where: { workId: f.work.id } });
      const unavailable = await expectCompletedEndingUnavailable(f,
        () => f.stories.currentProgress(f.owner.id, before.id, 'ko'));
      expect(await preview.preview(f.owner.id, f.work.id, { locale: 'ko' })).toMatchObject({ progress: { status: 'completed', scene: null } });
      expect(await unavailableReadSnapshot(f)).toStrictEqual(unavailable);
    }
  });
  it.each(['work', 'part'] as const)('does not recover paid %s prose after access is absent, expired or revoked', async scope => {
    const f = await prepared();
    await f.choose();
    await db.storyReaderProgress.update({ where: { id: f.progresses[0].id }, data: { currentSceneId: null } });
    if (scope === 'work') await db.storyWork.update({ where: { id: f.work.id }, data: { priceLumina: 10 } });
    else await db.storyPart.update({ where: { id: f.part.id }, data: { priceLumina: 10 } });
    const current = () => f.stories.currentProgress(f.reader.id, f.progresses[0].id, 'ko');
    await expectCompletedEndingUnavailable(f, current);
    const access = await db.userEntitlement.create({ data: { userId: f.reader.id, entitlementType: 'story_work',
      referenceType: 'story_work', referenceId: f.work.id, startsAt: new Date(0) } });
    expect(await current()).toMatchObject({ scene: { id: f.scene.id }, status: 'completed' });
    await db.userEntitlement.update({ where: { id: access.id }, data: { expiresAt: new Date(0) } });
    await expectCompletedEndingUnavailable(f, current);
    await db.userEntitlement.update({ where: { id: access.id }, data: { expiresAt: null, revokedAt: new Date() } });
    await expectCompletedEndingUnavailable(f, current);
  });
  it.each(['event invalidated', 'ending missing', 'release changed', 'completed flag only'] as const)
  ('does not grant completed reading from %s', async kind => {
    const f = await prepared();
    if (kind !== 'completed flag only') await f.choose();
    if (kind === 'event invalidated') await db.storyChoiceEvent.updateMany({ where: { progressId: f.progresses[0].id }, data: { invalidatedAt: new Date() } });
    if (kind === 'ending missing') await db.storyEndingDiscovery.deleteMany({ where: { workId: f.work.id } });
    if (kind === 'release changed') await db.storyWork.update({ where: { id: f.work.id }, data: { publishedVersion: 2 } });
    if (kind === 'completed flag only') await db.storyReaderProgress.update({ where: { id: f.progresses[0].id }, data: { status: 'completed' } });
    const before = await f.progress();
    expect(await canonicalEndingPosition(db, before)).toBeNull();
    await expect(f.stories.updateBeatProgress(f.reader.id, before.id, { position: 1, expectedRevision: before.progressRevision }, 'ko'))
      .rejects.toBeInstanceOf(ConflictException);
    const reads = new StoryCanonicalReadService(db as never);
    await expect(reads.preview(f.reader.id, before.id, f.beat.id, { locale: 'ko' })).rejects.toBeInstanceOf(ConflictException);
    expect(await f.progress()).toEqual(before);
  });
});

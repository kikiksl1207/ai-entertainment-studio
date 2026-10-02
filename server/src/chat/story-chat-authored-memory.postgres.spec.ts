import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ARTIST_PROFILE_SECTION_KEYS, creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile } from '../generation-profile/creator-generation-profile.policy';
import { StoryCanonicalReadService } from '../story-production/story-canonical-read.service';
import { StoryInteractionApprovalService } from '../story-production/story-interaction-approval.service';
import { StoryArtistParticipantService } from '../story-production/story-artist-participant.service';
import { StoryProductionService } from '../story-production/story-production.service';
import { appendStoryRoute, createStoryRouteRoot, storyRouteSharingHash } from '../story-production/story-route-identity.store';
import { loadStoryChatMemoryContext, unverifiedStoryMemoryContext } from './story-chat-memory';
import { loadStoryChatRouteScope } from './story-chat-route-scope';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
const artistName = 'Memory QA Artist';

postgres('Authored route memories (actual services, isolated PostgreSQL, no provider)', () => {
  let db: PrismaClient, stories: StoryProductionService;
  const users: string[] = [], works: string[] = [], artists: string[] = [], assets: string[] = [];

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (process.env.NODE_ENV !== 'test' || parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' ||
        parsed.port !== '55432' || parsed.username !== 'lumina_qa' || parsed.pathname !== '/lumina_authored_memory_qa' ||
        parsed.search || parsed.hash) throw new Error('Dedicated story QA database required');
    db = new PrismaClient({ datasources: { db: { url } } }); await db.$connect();
    const participants = new StoryArtistParticipantService(db as never, new ConfigService());
    stories = new StoryProductionService(db as never, undefined, undefined, undefined, undefined,
      undefined, undefined, participants);
  });
  beforeEach(() => { jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Provider calls forbidden')); });
  afterEach(async () => {
    try {
      // Preserve immutable evidence and append-only routes. The operator drops
      // only this run's newly created dedicated DB after checking its contents.
      expect(global.fetch).not.toHaveBeenCalled();
      users.length = works.length = artists.length = assets.length = 0;
    } finally { jest.restoreAllMocks(); }
  });
  afterAll(async () => { await db?.$disconnect(); });

  async function fixture() {
    const reader = await db.user.create({ data: {} }); users.push(reader.id);
    const other = await db.user.create({ data: {} }); users.push(other.id);
    const work = await db.storyWork.create({ data: { ownerUserId: reader.id, slug: `authored-memory-${randomUUID()}`,
      title: { ko: 'Synthetic memory story' }, summary: {}, coverManifest: { url: '/public/story/memory/cover.webp' } } }); works.push(work.id);
    const manuscript = await db.storyManuscriptVersion.create({ data: { workId: work.id, ownerUserId: reader.id,
      version: 1, locale: 'ko', contentHash: 'a'.repeat(64), structuredBody: {} } });
    const release = await db.storyRelease.create({ data: { workId: work.id, version: 1, status: 'active',
      manuscriptVersionId: manuscript.id, branchGraphSnapshot: {}, endingSetSnapshot: {}, sceneAssetManifest: {},
      localizedDisplaySnapshot: {}, checksum: 'b'.repeat(64), createdByUserId: reader.id } });
    await db.storyWork.update({ where: { id: work.id }, data: { status: 'published', activeReleaseId: release.id, publishedAt: new Date(0) } });
    const part = await db.storyPart.create({ data: { workId: work.id, position: 1, status: 'published', title: { ko: 'First part' } } });
    const makeScene = (position: number) => db.storyScene.create({ data: { partId: part.id, sceneKey: `scene-${position}`,
      position, status: 'published', title: { ko: `Scene ${position}` }, visualManifest: { sceneKey: `scene-${position}`, characters: [],
        background: { state: 'ready', publicAssetPath: '/public/story/memory/scene.webp', altKey: 'scene' },
        fallback: { publicAssetPath: '/public/story/memory/scene.webp', altKey: 'scene' } } } });
    const scene = await makeScene(1), next = await makeScene(2);
    await db.storyBeat.createMany({ data: [
      { sceneId: scene.id, position: 1, beatType: 'dialogue', content: { ko: `${artistName}: A read promise.` } },
      { sceneId: scene.id, position: 2, beatType: 'dialogue', content: { ko: `${artistName}: An unread future.` } },
      { sceneId: next.id, position: 1, beatType: 'dialogue', content: { ko: `${artistName}: A current promise.` } },
    ] });
    const choice = await db.storyChoice.create({ data: { sceneId: scene.id, choiceKey: 'main', position: 1,
      label: { ko: 'Continue' }, targetSceneId: next.id, routeKind: 'branch' } });
    await db.storyChoice.createMany({ data: [2, 3].map(position => ({ sceneId: scene.id, choiceKey: `other-${position}`,
      position, label: { ko: `Option ${position}` }, targetSceneId: next.id, routeKind: 'branch' })) });
    const artist = await db.artist.create({ data: { slug: `memory-artist-${randomUUID()}`, displayName: artistName, status: 'active' } }); artists.push(artist.id);
    const asset = await db.asset.create({ data: { assetType: 'image', storageKey: `/memory/${randomUUID()}.webp`,
      mimeType: 'image/webp', checksum: 'c'.repeat(64), fileSizeBytes: BigInt(100) } }); assets.push(asset.id);
    await db.artistAsset.create({ data: { artistId: artist.id, assetId: asset.id, usageType: 'thumb', isPrimary: true } });
    const settings = normalizeCreatorGenerationProfile('artist', { kind: 'artist', schemaVersion: 'creator-generation-profile-v1',
      sections: ARTIST_PROFILE_SECTION_KEYS.map(key => ({ key, decision: 'accepted' as const,
        value: { summary: 'Synthetic adult story identity' }, evidence: [] })) });
    const sourceFingerprint = 'd'.repeat(64);
    const profile = await db.artistStoryIdentityProfile.create({ data: { artistId: artist.id, status: 'approved',
      sourceFingerprint, referenceAssetIds: [asset.id], profileVersion: 1, reviewRevision: 1,
      draftSettings: settings as unknown as Prisma.InputJsonValue, approvedSettings: settings as unknown as Prisma.InputJsonValue,
      approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings), approvedByUserId: reader.id, approvedAt: new Date() } });
    const started = await stories.startProgress(reader.id, work.id, { mode: 'continue', locale: 'ko', participantArtistId: artist.id });
    const progress = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: started.progressId } });
    const input = { userId: reader.id, artistId: artist.id, artistDisplayName: artistName, progressId: progress.id };
    async function readScene(sceneId: string) {
      const beat = await db.storyBeat.findUniqueOrThrow({ where: { sceneId_position: { sceneId, position: 1 } } });
      const text = (beat.content as Prisma.JsonObject).ko as string, quote = text.slice(`${artistName}: `.length);
      const approvals = new StoryInteractionApprovalService(db as never);
      const review = await approvals.review(reader.id, work.id, beat.id, { artistId: artist.id, locale: 'ko' });
      await approvals.approve(reader.id, work.id, beat.id, { artistId: artist.id, locale: 'ko',
        expectedSourceChecksum: review.identity.sourceChecksum, expectedIdentityPinHash: review.identity.identityPinHash,
        interactionReviewed: true, interactionKind: 'dialogue', evidenceStart: text.indexOf(quote), evidenceText: quote,
        memoryText: quote, idempotencyKey: randomUUID() });
      const reads = new StoryCanonicalReadService(db as never);
      const preview = await reads.preview(reader.id, progress.id, beat.id, { locale: 'ko' });
      await reads.confirm(reader.id, progress.id, beat.id, { locale: 'ko', expectedRevision: preview.expectedRevision,
        expectedScopeChecksum: preview.scopeChecksum, expectedSourceTextHash: preview.sourceTextHash,
        displayedAndRead: true, idempotencyKey: randomUUID() });
    }
    await readScene(scene.id);
    return { reader, other, work, release, part, scene, next, choice, artist, profile, progress, input, readScene };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function depart(f: Fixture, position = 1) {
    await stories.updateBeatProgress(f.reader.id, f.progress.id, { position, expectedRevision: f.progress.progressRevision });
    await stories.selectChoice(f.reader.id, f.progress.id, f.choice.id, f.progress.progressRevision + 1);
    return db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progress.id } });
  }
  async function resetRoot(f: Fixture) {
    const before = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progress.id } });
    const root = await createStoryRouteRoot(db, before, f.scene.id, f.part.actNumber);
    await db.storyReaderProgress.update({ where: { id: before.id }, data: { routeNodeId: root,
      currentSceneId: f.scene.id, currentGeneratedSceneId: null, currentBeatPosition: 0, pathSummary: [],
      status: 'active', progressRevision: { increment: 1 } } });
  }

  it('preserves navigation metadata while memories require independent author and reader records', async () => {
    const f = await fixture(), progress = await depart(f);
    expect(progress.pathSummary).toEqual([expect.objectContaining({ sceneId: f.scene.id, choiceId: f.choice.id, readBeatPosition: 1 })]);
    expect(await db.storyProgressRouteNode.findUniqueOrThrow({ where: { id: progress.routeNodeId! } }))
      .toMatchObject({ sourceSceneId: f.scene.id, narrativeStep: { sceneId: f.scene.id, readBeatPosition: 1 } });
    expect(await loadStoryChatMemoryContext(db as never, f.input)).toMatchObject({ source: 'attributed_story_dialogue',
      items: [{ workTitle: 'Synthetic memory story', sceneTitle: 'Scene 1', artistDialogue: 'A read promise.',
        interactionKind: 'dialogue', evidenceSource: 'canonical_author_approved' }] });
    await stories.updateBeatProgress(f.reader.id, f.progress.id, { position: 1, expectedRevision: progress.progressRevision });
    await f.readScene(f.next.id);
    expect((await loadStoryChatMemoryContext(db as never, f.input)).items.map(item => item.artistDialogue))
      .toEqual(['A current promise.', 'A read promise.']);
  });

  it('retains the read original dialogue after a completed ending without inventing later dialogue', async () => {
    const f = await fixture();
    await db.storyChoice.update({ where: { id: f.choice.id }, data: { targetSceneId: null, targetEndingKey: 'author_main' } });
    const progress = await depart(f);
    expect(progress).toMatchObject({ status: 'completed', currentSceneId: null, currentBeatPosition: 0 });
    expect((await loadStoryChatMemoryContext(db as never, f.input)).items.map(item => item.artistDialogue)).toEqual(['A read promise.']);
  });

  it('uses an existing exact root receipt without backfilling a missing legacy cursor', async () => {
    const f = await fixture(), progress = await depart(f);
    const active = await db.storyProgressRouteNode.findUniqueOrThrow({ where: { id: progress.routeNodeId! } });
    const legacy = await appendStoryRoute(db, { ...progress, routeNodeId: active.parentId }, { kind: 'canonical',
      sceneId: f.scene.id, choiceId: f.choice.id, targetSceneId: f.next.id, endingKey: null }, 1);
    await db.storyReaderProgress.update({ where: { id: progress.id }, data: {
      routeNodeId: legacy, seenSceneIds: [f.scene.id, f.next.id],
    } });
    expect((await loadStoryChatMemoryContext(db as never, f.input)).items.map(item => item.artistDialogue)).toEqual(['A read promise.']);
  });

  it('keeps abandoned sibling nodes and pre-reset roots out of the active memories', async () => {
    const f = await fixture(), progress = await depart(f);
    const active = await db.storyProgressRouteNode.findUniqueOrThrow({ where: { id: progress.routeNodeId! } });
    await appendStoryRoute(db, { ...progress, routeNodeId: active.parentId }, { kind: 'canonical',
      sceneId: f.scene.id, choiceId: f.choice.id, targetSceneId: f.next.id, endingKey: null }, 1,
    { sceneId: f.scene.id, choiceId: f.choice.id, readBeatPosition: 2 });
    expect((await loadStoryChatMemoryContext(db as never, f.input)).items.map(item => item.artistDialogue)).toEqual(['A read promise.']);
    await resetRoot(f);
    expect(await db.storyProgressRouteNode.count({ where: { workId: f.work.id } })).toBe(4);
    expect(await loadStoryChatMemoryContext(db as never, f.input)).toEqual(unverifiedStoryMemoryContext());
  });

  it('excludes source scenes belonging to another work and progress owned by another reader', async () => {
    const f = await fixture(), other = await fixture(), progress = await depart(f);
    expect(await loadStoryChatMemoryContext(db as never, { ...f.input, userId: f.other.id })).toEqual(unverifiedStoryMemoryContext());
    const privateNode = await appendStoryRoute(db, progress, { kind: 'private' }, 1,
      { sourceSceneId: other.scene.id, customChoiceId: randomUUID(), readBeatPosition: 1 });
    await db.storyReaderProgress.update({ where: { id: progress.id }, data: { routeNodeId: privateNode } });
    expect((await loadStoryChatMemoryContext(db as never, f.input)).items.map(item => item.artistDialogue)).toEqual(['A read promise.']);
  });

  it('allows owned private routes and their hashless descendants without enabling shared reuse', async () => {
    const f = await fixture(), progress = await depart(f);
    const privateNode = await appendStoryRoute(db, progress, { kind: 'private' }, 1,
      { sourceSceneId: f.next.id, customChoiceId: randomUUID(), readBeatPosition: 1 });
    const descendant = await appendStoryRoute(db, { ...progress, routeNodeId: privateNode }, { kind: 'canonical',
      sceneId: f.scene.id, choiceId: f.choice.id, targetSceneId: f.next.id, endingKey: null }, 1,
    { sceneId: f.scene.id, choiceId: f.choice.id, readBeatPosition: 1 });
    expect(await db.storyProgressRouteNode.findUniqueOrThrow({ where: { id: descendant! } })).toMatchObject({ routeHash: null });
    await db.storyReaderProgress.update({ where: { id: progress.id }, data: { routeNodeId: descendant } });
    expect(await storyRouteSharingHash(db, { ...progress, routeNodeId: descendant })).toBeNull();
    expect((await loadStoryChatMemoryContext(db as never, f.input)).items.map(item => item.artistDialogue))
      .toEqual(['A read promise.']);
    expect(await loadStoryChatRouteScope(db as never, f.input)).toMatchObject({ progressId: progress.id, routeNodeId: descendant });
    expect(await loadStoryChatRouteScope(db as never, { ...f.input, userId: f.other.id })).toBeNull();
  });

  it('withdraws original memories when identity approval or the published release changes', async () => {
    const f = await fixture(); await depart(f);
    await db.artistStoryIdentityProfile.update({ where: { id: f.profile.id }, data: { status: 'rejected' } });
    expect(await loadStoryChatMemoryContext(db as never, f.input)).toEqual(unverifiedStoryMemoryContext());
    await db.artistStoryIdentityProfile.update({ where: { id: f.profile.id }, data: { status: 'approved' } });
    await db.storyWork.update({ where: { id: f.work.id }, data: { activeReleaseId: null } });
    expect(await loadStoryChatMemoryContext(db as never, f.input)).toEqual(unverifiedStoryMemoryContext());
  });

  it.each(['reset', 'approval', 'release'] as const)('withholds a memory if %s changes while the actual beat query loads', async mutation => {
    const f = await fixture(); await depart(f); let changed = false;
    const racing = db.$extends({ query: { storyBeat: { async findMany({ args, query }) {
      const result = await query(args);
      if (!changed) {
        changed = true;
        if (mutation === 'reset') await resetRoot(f);
        else if (mutation === 'approval') await db.artistStoryIdentityProfile.update({ where: { id: f.profile.id }, data: { status: 'rejected' } });
        else await db.storyWork.update({ where: { id: f.work.id }, data: { activeReleaseId: null } });
      }
      return result;
    } } } });
    expect(await loadStoryChatMemoryContext(racing as never, f.input)).toEqual(unverifiedStoryMemoryContext());
    expect(changed).toBe(true);
  });

  it('rejects unavailable/stale/foreign inputs without a phantom departure record', async () => {
    const f = await fixture();
    await expect(stories.updateBeatProgress(f.reader.id, f.progress.id, { position: 99, expectedRevision: 1 })).rejects.toMatchObject({ status: 400 });
    await expect(stories.selectChoice(f.reader.id, f.progress.id, randomUUID(), 1)).rejects.toMatchObject({ status: 400 });
    await expect(stories.selectChoice(f.other.id, f.progress.id, f.choice.id, 1)).rejects.toMatchObject({ status: 404 });
    const current = await depart(f);
    await expect(stories.selectChoice(f.reader.id, f.progress.id, f.choice.id, 2)).rejects.toMatchObject({ status: 409 });
    expect(await db.storyChoiceEvent.count({ where: { progressId: f.progress.id } })).toBe(1);
    expect(await db.storyProgressRouteNode.count({ where: { workId: f.work.id } })).toBe(2);
    expect(await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progress.id } })).toEqual(current);
  });
});

import 'reflect-metadata';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { request } from 'http';
import { type AddressInfo } from 'net';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile } from '../generation-profile/creator-generation-profile.policy';
import { PrismaService } from '../prisma/prisma.service';
import { StoryArtistParticipantService } from './story-artist-participant.service';
import { StoryProductionController } from './story-production.controller';
import { StoryProductionService } from './story-production.service';
import { StoryProgressControlService } from './story-progress-control.service';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

postgres('Artist participation (real HTTP/services, isolated PostgreSQL, no provider)', () => {
  let db: PrismaClient, participants: StoryArtistParticipantService, stories: StoryProductionService;
  let app: INestApplication, port: number;
  const jwt = new JwtService(), secret = randomUUID();
  const users: string[] = [], works: string[] = [], artists: string[] = [], assets: string[] = [], campaigns: string[] = [];

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (process.env.NODE_ENV !== 'test' || parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' ||
        parsed.port !== '55432' || parsed.username !== 'lumina_qa' || parsed.pathname !== '/lumina_story_qa' ||
        parsed.search || parsed.hash) throw new Error('Dedicated story QA database required');
    db = new PrismaClient({ datasources: { db: { url } } }); await db.$connect();
    const config = new ConfigService({ JWT_ACCESS_SECRET: secret });
    participants = new StoryArtistParticipantService(db as never, config);
    stories = new StoryProductionService(db as never, undefined, undefined, undefined, undefined,
      undefined, undefined, participants);
    const module = await Test.createTestingModule({ controllers: [StoryProductionController], providers: [
      { provide: StoryProductionService, useValue: stories },
      { provide: StoryArtistParticipantService, useValue: participants },
      // These routes do not call checkpoint/reset/custom-choice controls.
      { provide: StoryProgressControlService, useValue: {} },
      { provide: PrismaService, useValue: db }, { provide: ConfigService, useValue: config },
      { provide: JwtService, useValue: jwt }, JwtAuthGuard,
    ] }).compile();
    app = module.createNestApplication({ logger: false }); configureHttpRouting(app);
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1'); port = (app.getHttpServer().address() as AddressInfo).port;
  });

  beforeEach(() => { jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Provider calls forbidden')); });
  afterEach(async () => {
    try {
      await db.$transaction(async tx => {
        // Only this test's tracked IDs; no existing shared fixtures or production records.
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        await tx.storyQualityEvent.deleteMany({ where: { workId: { in: works } } });
        await tx.storyProgressRouteNode.deleteMany({ where: { workId: { in: works } } });
        await tx.storyProgressArtistParticipant.deleteMany({ where: { workId: { in: works } } });
        await tx.storyReaderProgress.deleteMany({ where: { workId: { in: works } } });
        const parts = await tx.storyPart.findMany({ where: { workId: { in: works } }, select: { id: true } });
        const scenes = await tx.storyScene.findMany({ where: { partId: { in: parts.map(row => row.id) } }, select: { id: true } });
        await tx.storyBeat.deleteMany({ where: { sceneId: { in: scenes.map(row => row.id) } } });
        await tx.storyScene.deleteMany({ where: { id: { in: scenes.map(row => row.id) } } });
        await tx.storyPart.deleteMany({ where: { id: { in: parts.map(row => row.id) } } });
        await tx.storyRelease.deleteMany({ where: { workId: { in: works } } });
        await tx.storyManuscriptVersion.deleteMany({ where: { workId: { in: works } } });
        await tx.storyWork.deleteMany({ where: { id: { in: works } } });
        await tx.conceptVoteBallot.deleteMany({ where: { userId: { in: users } } });
        const votes = await tx.conceptVote.findMany({ where: { artistId: { in: artists } }, select: { id: true } });
        await tx.conceptVoteOption.deleteMany({ where: { voteId: { in: votes.map(row => row.id) } } });
        await tx.conceptVote.deleteMany({ where: { id: { in: votes.map(row => row.id) } } });
        await tx.artistBoostEvent.deleteMany({ where: { artistId: { in: artists } } });
        await tx.artistStoryIdentityProfile.deleteMany({ where: { artistId: { in: artists } } });
        await tx.artistAsset.deleteMany({ where: { artistId: { in: artists } } });
        await tx.artist.deleteMany({ where: { id: { in: artists } } });
        await tx.asset.deleteMany({ where: { id: { in: assets } } });
        await tx.boostCampaign.deleteMany({ where: { id: { in: campaigns } } });
        await tx.user.deleteMany({ where: { id: { in: users } } });
      });
      users.length = works.length = artists.length = assets.length = campaigns.length = 0;
      expect(global.fetch).not.toHaveBeenCalled();
    } finally { jest.restoreAllMocks(); }
  });
  afterAll(async () => { await app?.close(); await db?.$disconnect(); });

  async function fixture() {
    const reader = await db.user.create({ data: {} }); users.push(reader.id);
    const other = await db.user.create({ data: {} }); users.push(other.id);
    const work = await db.storyWork.create({ data: { ownerUserId: reader.id, slug: `participant-run-${randomUUID()}`,
      title: { ko: 'Participation QA' }, summary: {}, coverManifest: { url: '/public/story/participation/cover.webp' } } }); works.push(work.id);
    const manuscript = await db.storyManuscriptVersion.create({ data: { workId: work.id, ownerUserId: reader.id,
      version: 1, locale: 'ko', contentHash: 'a'.repeat(64), structuredBody: {} } });
    const release = await db.storyRelease.create({ data: { workId: work.id, version: 1, status: 'active',
      manuscriptVersionId: manuscript.id, branchGraphSnapshot: {}, endingSetSnapshot: {}, sceneAssetManifest: {},
      localizedDisplaySnapshot: {}, checksum: 'b'.repeat(64), createdByUserId: reader.id } });
    await db.storyWork.update({ where: { id: work.id }, data: { status: 'published', activeReleaseId: release.id, publishedAt: new Date(0) } });
    const part = await db.storyPart.create({ data: { workId: work.id, position: 1, status: 'published', title: { ko: 'First part' } } });
    const scene = await db.storyScene.create({ data: { partId: part.id, sceneKey: 'part-1-main', position: 1,
      status: 'published', title: { ko: 'First scene' }, visualManifest: { sceneKey: 'part-1-main', characters: [],
        background: { state: 'ready', publicAssetPath: '/public/story/participation/scene.webp', altKey: 'scene' },
        fallback: { publicAssetPath: '/public/story/participation/scene.webp', altKey: 'scene' } } } });
    await db.storyBeat.create({ data: { sceneId: scene.id, position: 1, beatType: 'narration', content: { ko: 'The reader opens the story.' } } });
    const group = `Participation ${randomUUID().slice(0, 8)}`;
    const ready = async (name: string, approved = true, status = 'active') => {
      const artist = await db.artist.create({ data: { slug: `participant-artist-${randomUUID()}`, displayName: `${group} ${name}`, status } }); artists.push(artist.id);
      const asset = await db.asset.create({ data: { assetType: 'image', storageKey: `/participation/${randomUUID()}.webp`,
        mimeType: 'image/webp', checksum: 'c'.repeat(64), fileSizeBytes: BigInt(100) } }); assets.push(asset.id);
      await db.artistAsset.create({ data: { artistId: artist.id, assetId: asset.id, usageType: 'thumb', isPrimary: true } });
      const settings = normalizeCreatorGenerationProfile('artist', { kind: 'artist', schemaVersion: 'creator-generation-profile-v1', sections: [
        { key: 'fixed_identity', decision: 'accepted', value: { summary: 'Fixed synthetic adult appearance' }, evidence: [] },
        { key: 'adaptable_presentation', decision: 'accepted', value: { summary: 'Story wardrobe only' }, evidence: [] },
      ] });
      const sourceFingerprint = 'd'.repeat(64);
      const profile = await db.artistStoryIdentityProfile.create({ data: { artistId: artist.id,
        status: approved ? 'approved' : 'needs_review', sourceFingerprint, referenceAssetIds: [asset.id],
        profileVersion: 1, reviewRevision: 1, draftSettings: settings as unknown as Prisma.InputJsonValue,
        approvedSettings: approved ? settings as unknown as Prisma.InputJsonValue : Prisma.DbNull,
        approvedFingerprint: approved ? creatorGenerationProfileFingerprint(sourceFingerprint, settings) : null,
        approvedByUserId: approved ? reader.id : null } });
      return { artist, asset, profile };
    };
    const liked = await ready('Liked'), voted = await ready('Voted'), searched = await ready('Search');
    const pending = await ready('Pending', false), inactive = await ready('Inactive', true, 'draft');
    const campaign = await db.boostCampaign.create({ data: { slug: `participant-campaign-${randomUUID()}`, name: 'Isolated participation',
      startsAt: new Date(0), endsAt: new Date('2099-01-01') } }); campaigns.push(campaign.id);
    await db.artistBoostEvent.create({ data: { campaignId: campaign.id, userId: reader.id, artistId: liked.artist.id,
      boostType: 'free_like', rawAmount: 1, weightedScore: 1 } });
    const vote = await db.conceptVote.create({ data: { artistId: voted.artist.id } });
    const option = await db.conceptVoteOption.create({ data: { voteId: vote.id, optionKey: 'first' } });
    await db.conceptVoteBallot.create({ data: { voteId: vote.id, optionId: option.id, userId: reader.id } });
    return { reader, other, work, scene, group, liked, voted, searched, pending, inactive };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const token = (sub: string, tokenType = 'access') => jwt.signAsync({ sub, tokenType }, { secret, expiresIn: '5m' });
  async function call(f: Fixture, method: string, path: string, body?: unknown, userId: string | null = f.reader.id) {
    const authorization = userId ? await token(userId) : null;
    return new Promise<{ status: number; cache: string | undefined; body: any }>((resolve, reject) => {
      const payload = body === undefined ? '' : JSON.stringify(body);
      const req = request({ hostname: '127.0.0.1', port, method, path: `/api/v1${path}`,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload),
          ...(authorization ? { authorization: `Bearer ${authorization}` } : {}) } }, res => {
        const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => { try { resolve({ status: res.statusCode!, cache: res.headers['cache-control'],
          body: JSON.parse(Buffer.concat(chunks).toString()) }); } catch (error) { reject(error); } });
      });
      req.setTimeout(10000, () => req.destroy(new Error('Local participation HTTP timeout')));
      req.on('error', reject); req.end(payload);
    });
  }
  const candidatePath = (f: Fixture, q = '') => `/me/stories/${f.work.id}/artist-candidates?q=${encodeURIComponent(q)}&take=20`;
  const startPath = (f: Fixture) => `/stories/${f.work.id}/progress`;
  const input = (f: Fixture, progressId: string, artistId = f.searched.artist.id) => ({ progressId, workId: f.work.id, userId: f.reader.id, artistId });
  async function emptyProgress(f: Fixture) {
    return db.storyReaderProgress.create({ data: { userId: f.reader.id, workId: f.work.id, currentSceneId: f.scene.id } });
  }

  it('loads actual engagement and global name search without enabling pending or inactive artists', async () => {
    const f = await fixture(), before = await db.storyReaderProgress.count({ where: { workId: f.work.id } });
    const response = await call(f, 'GET', candidatePath(f, f.group));
    expect(response).toMatchObject({ status: 200, cache: 'private, no-store', body: { selectedArtistId: null, selectionLocked: false } });
    expect(response.body.engaged.map((row: any) => [row.artistId, row.source]).sort()).toEqual([
      [f.liked.artist.id, 'liked'], [f.voted.artist.id, 'voted'],
    ].sort());
    expect(response.body.searchResults).toHaveLength(4);
    expect(response.body.searchResults.find((row: any) => row.artistId === f.searched.artist.id)).toMatchObject({ source: 'search', visualIdentityReady: true });
    expect(response.body.searchResults.find((row: any) => row.artistId === f.pending.artist.id)).toMatchObject({ visualIdentityReady: false });
    expect(response.body.searchResults.some((row: any) => row.artistId === f.inactive.artist.id)).toBe(false);
    expect(await db.storyReaderProgress.count({ where: { workId: f.work.id } })).toBe(before);
  }, 60_000);

  it('starts with the searched identity pin, replays it and rejects a different artist', async () => {
    const f = await fixture();
    const started = await call(f, 'POST', startPath(f), { mode: 'continue', participantArtistId: f.searched.artist.id });
    expect(started).toMatchObject({ status: 201, body: { participantArtist: { artistId: f.searched.artist.id, locked: true, visualIdentityReady: true } } });
    const stored = await db.storyProgressArtistParticipant.findUniqueOrThrow({ where: { progressId: started.body.progressId } });
    expect(stored).toMatchObject({ selectionSource: 'search', identityProfileId: f.searched.profile.id,
      identityApprovedFingerprint: f.searched.profile.approvedFingerprint, referenceAssetIds: [f.searched.asset.id], referenceChecksums: ['c'.repeat(64)] });
    expect((await call(f, 'POST', startPath(f), { mode: 'continue', participantArtistId: f.searched.artist.id })).status).toBe(201);
    expect((await call(f, 'POST', startPath(f), { mode: 'continue', participantArtistId: f.liked.artist.id })).status).toBe(409);
    expect(await db.storyProgressArtistParticipant.findUniqueOrThrow({ where: { progressId: started.body.progressId } })).toEqual(stored);
    expect((await call(f, 'GET', candidatePath(f))).body).toMatchObject({ selectedArtistId: f.searched.artist.id, selectionLocked: true });
    expect((await call(f, 'POST', `/me/story-progress/${started.body.progressId}/beat`, { position: 1, expectedRevision: 1 })).status).toBe(201);
    expect((await call(f, 'POST', startPath(f), { mode: 'continue' })).body.participantArtist.artistId).toBe(f.searched.artist.id);
    expect(await db.storyReaderProgress.count({ where: { workId: f.work.id } })).toBe(1);
  }, 60_000);

  it('rolls an unready start back completely and permits selecting another ready artist', async () => {
    const f = await fixture();
    const failed = await call(f, 'POST', startPath(f), { mode: 'continue', participantArtistId: f.pending.artist.id });
    expect(failed).toMatchObject({ status: 409, body: { error: { code: 'STORY_PARTICIPANT_IDENTITY_NOT_READY' } } });
    expect(await db.storyReaderProgress.count({ where: { workId: f.work.id } })).toBe(0);
    expect(await db.storyProgressRouteNode.count({ where: { workId: f.work.id } })).toBe(0);
    expect(await db.storyQualityEvent.count({ where: { workId: f.work.id } })).toBe(0);
    expect((await call(f, 'POST', startPath(f), { mode: 'continue', participantArtistId: f.liked.artist.id })).status).toBe(201);
  }, 60_000);

  it('locks selection after reading without a participant and rejects a stale start selection', async () => {
    const f = await fixture(), started = await call(f, 'POST', startPath(f), { mode: 'continue' });
    expect(started.status).toBe(201);
    expect((await call(f, 'POST', `/me/story-progress/${started.body.progressId}/beat`, { position: 1, expectedRevision: 1 })).status).toBe(201);
    expect((await call(f, 'GET', candidatePath(f))).body).toMatchObject({ selectionLocked: true, selectedArtistId: null });
    expect((await call(f, 'POST', startPath(f), { mode: 'continue', participantArtistId: f.searched.artist.id })).status).toBe(409);
    expect(await db.storyProgressArtistParticipant.count({ where: { workId: f.work.id } })).toBe(0);
  }, 60_000);

  it('does not expose another reader selection or bind that reader progress', async () => {
    const f = await fixture(), progress = await emptyProgress(f);
    await db.$transaction(tx => participants.bind(tx, input(f, progress.id)));
    expect((await call(f, 'GET', candidatePath(f), undefined, f.other.id)).body)
      .toMatchObject({ engaged: [], selectedArtistId: null, selectionLocked: false });
    await expect(db.$transaction(tx => participants.bind(tx, { ...input(f, progress.id), userId: f.other.id })))
      .rejects.toMatchObject({ status: 404 });
    expect(await db.storyProgressArtistParticipant.count({ where: { progressId: progress.id } })).toBe(1);
  }, 60_000);

  it('rejects unauthenticated, malformed and unpublished inputs before creating progress', async () => {
    const f = await fixture();
    expect((await call(f, 'GET', candidatePath(f), undefined, null)).status).toBe(401);
    expect((await call(f, 'POST', startPath(f), { mode: 'continue' }, null)).status).toBe(401);
    for (const query of ['take=31', 'take=no', `q=${'x'.repeat(81)}`, 'take=1&actorUserId=other']) {
      expect((await call(f, 'GET', `/me/stories/${f.work.id}/artist-candidates?${query}`)).status).toBe(400);
    }
    expect((await call(f, 'POST', '/stories/not-a-uuid/progress', { mode: 'continue' })).status).toBe(400);
    expect((await call(f, 'POST', startPath(f), { mode: 'continue', participantArtistId: 'invalid' })).status).toBe(400);
    expect((await call(f, 'POST', startPath(f), { mode: 'continue', participantArtistId: randomUUID() })).status).toBe(404);
    await db.storyWork.update({ where: { id: f.work.id }, data: { status: 'draft' } });
    expect((await call(f, 'GET', candidatePath(f))).status).toBe(404);
    expect(await db.storyReaderProgress.count({ where: { workId: f.work.id } })).toBe(0);
  }, 60_000);

  it('serializes same-artist duplicates and competing artists without replacing the winner', async () => {
    const f = await fixture(), progress = await emptyProgress(f);
    const duplicate = await Promise.all([1, 2].map(() => db.$transaction(tx => participants.bind(tx, input(f, progress.id)))));
    expect(duplicate[0].id).toBe(duplicate[1].id);
    await db.storyProgressArtistParticipant.delete({ where: { progressId: progress.id } });
    const competing = await Promise.allSettled([f.liked.artist.id, f.searched.artist.id]
      .map(artistId => db.$transaction(tx => participants.bind(tx, input(f, progress.id, artistId)))));
    expect(competing.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    const rejected = competing.find(row => row.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ response: { code: 'STORY_PARTICIPANT_LOCKED' } });
    expect(await db.storyProgressArtistParticipant.count({ where: { progressId: progress.id } })).toBe(1);
  }, 60_000);

  it('cannot first-bind an old read state after a concurrent reader update commits first', async () => {
    const f = await fixture(), progress = await emptyProgress(f);
    let release!: () => void, locked!: () => void, blocker = 0;
    const unlock = new Promise<void>(resolve => { release = resolve; });
    const held = new Promise<void>(resolve => { locked = resolve; });
    const mutation = db.$transaction(async tx => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`; blocker = pid;
      await tx.storyReaderProgress.update({ where: { id: progress.id }, data: { currentBeatPosition: 1, progressRevision: { increment: 1 } } });
      locked(); await unlock;
    }, { timeout: 15000 });
    let bind: Promise<unknown> | undefined;
    try {
      await Promise.race([held, mutation.then(() => { throw new Error('Writer finished before holding its lock'); })]);
      let entered!: () => void, binder = 0;
      const waiting = new Promise<void>(resolve => { entered = resolve; });
      bind = db.$transaction(async tx => {
        const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`; binder = pid; entered();
        return participants.bind(tx, input(f, progress.id));
      });
      const outcome = bind.then(value => ({ value, error: null }), error => ({ value: null, error }));
      await waiting;
      let observed = false;
      for (let attempt = 0; attempt < 200 && !observed; attempt++) {
        const [{ blocked }] = await db.$queryRaw<Array<{ blocked: boolean }>>`SELECT ${blocker}::int = ANY(pg_blocking_pids(${binder}::int)) AS blocked`;
        observed = blocked; if (!observed) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(observed).toBe(true); release(); await mutation;
      expect(await outcome).toMatchObject({ value: null, error: { response: { code: 'STORY_PARTICIPANT_LOCKED' } } });
      expect(await db.storyProgressArtistParticipant.count({ where: { progressId: progress.id } })).toBe(0);
      expect((await db.storyReaderProgress.findUniqueOrThrow({ where: { id: progress.id } })).currentBeatPosition).toBe(1);
    } finally { release(); await Promise.allSettled([mutation, ...(bind ? [bind] : [])]); }
  }, 60_000);

  it('stops identity generation context when the exact reference is archived after selection', async () => {
    const f = await fixture(), progress = await emptyProgress(f);
    const fixed = await db.$transaction(tx => participants.bind(tx, input(f, progress.id)));
    expect((await participants.pinnedContext(db as never, progress.id))?.pin.participantFingerprint).toBe(fixed.participantFingerprint);
    await db.asset.update({ where: { id: f.searched.asset.id }, data: { metadata: { lifecycle: { status: 'archived' } } } });
    await expect(participants.pinnedContext(db as never, progress.id))
      .rejects.toMatchObject({ response: { code: 'STORY_PARTICIPANT_IDENTITY_CHANGED' } });
    expect(await db.storyProgressArtistParticipant.findUniqueOrThrow({ where: { progressId: progress.id } })).toEqual(fixed);
  }, 60_000);
});

import { PrismaClient, StoryReaderProgress } from '@prisma/client';
import { randomUUID } from 'crypto';
import { activationFixture } from '../story-production/story-ai-activation.postgres-fixture';
import { createStoryRouteRoot } from '../story-production/story-route-identity.store';
import { loadStoryChatMemoryContext, unverifiedStoryMemoryContext } from './story-chat-memory';
import { ChatService } from './chat.service';
import { loadStoryChatRouteScope, lockApprovedStoryChatIdentity, storyChatRouteMarker } from './story-chat-route-scope';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
const artistName = '윤세린';
const sourceFingerprint = 'a'.repeat(64);
const approvedFingerprint = 'b'.repeat(64);
const participantFingerprint = 'c'.repeat(64);
jest.setTimeout(30000);

postgres('story-to-artist memory on isolated PostgreSQL', () => {
  let db: PrismaClient;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' ||
        parsed.port !== '55432' || parsed.username !== 'lumina_qa' ||
        parsed.pathname !== '/lumina_chat_memory_regression_qa' || parsed.search || parsed.hash) {
      throw new Error('Dedicated chat-memory QA database required');
    }
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
  });

  afterAll(async () => { await db?.$disconnect(); });

  async function bindArtist(progress: StoryReaderProgress, artistId: string, profileId: string) {
    return db.storyProgressArtistParticipant.create({ data: {
      progressId: progress.id, userId: progress.userId, workId: progress.workId,
      artistId, selectionSource: 'search', participantFingerprint,
      identityProfileId: profileId, identityProfileVersion: 1, identityReviewRevision: 1,
      identitySourceFingerprint: sourceFingerprint,
      identityApprovedFingerprint: approvedFingerprint,
      referenceAssetIds: [randomUUID()], referenceChecksums: ['d'.repeat(64)],
    } });
  }

  async function fixture() {
    const f = await activationFixture(db, false);
    const artist = await db.artist.create({ data: {
      slug: `chat-memory-${randomUUID()}`, displayName: artistName, status: 'active',
    } });
    const profile = await db.artistStoryIdentityProfile.create({ data: {
      artistId: artist.id, sourceFingerprint, referenceAssetIds: [randomUUID()],
      profileVersion: 1, reviewRevision: 1, status: 'approved',
      approvedSettings: {}, approvedFingerprint, approvedByUserId: f.owner.id,
      approvedAt: new Date(),
    } });
    const progress = f.progresses[0];
    await bindArtist(progress, artist.id, profile.id);
    const input = { userId: progress.userId, artistId: artist.id, artistDisplayName: artistName,
      progressId: progress.id };

    async function generatedScene(title: string, lines: string[]) {
      const choice = await db.storyCustomChoice.create({ data: {
        progressId: progress.id, userId: progress.userId, workId: f.work.id,
        sceneId: f.scene.id, idempotencyKey: randomUUID(), contentHash: 'e'.repeat(64),
        privateInput: 'Synthetic test choice', moderationDecision: 'allow',
      } });
      const continuation = await db.storyAiContinuation.create({ data: {
        userId: progress.userId, workId: f.work.id, releaseId: f.release.id,
        progressId: progress.id, requestKind: 'custom_choice', customChoiceId: choice.id,
        rateCardId: f.rate.id, styleConsentId: f.consent.id,
        capabilityRevision: progress.capabilityRevision!, idempotencyKey: randomUUID(),
        sourcePartId: f.part.id, sourceSceneId: f.scene.id,
        sourceProgressRevision: progress.progressRevision,
        estimatedCostKrw: 0, hardBudgetKrw: 0, inputTokenLimit: 1000,
        outputTokenLimit: 300, status: 'completed',
      } });
      const scene = await db.storyAiGeneratedScene.create({ data: {
        continuationId: continuation.id, userId: progress.userId, workId: f.work.id,
        releaseId: f.release.id, progressId: progress.id, sourcePartId: f.part.id,
        sceneKey: `chat-${randomUUID()}`, resultChecksum: 'f'.repeat(64),
        title: { ko: title }, visualManifest: {}, status: 'ready',
      } });
      await db.storyAiGeneratedBeat.createMany({ data: lines.map((line, index) => ({
        sceneId: scene.id, position: index + 1, beatType: 'dialogue', content: { ko: line },
      })) });
      return scene;
    }

    async function setRoute(pathSummary: object[], currentGeneratedSceneId: string, currentBeatPosition: number) {
      await db.storyReaderProgress.update({ where: { id: progress.id }, data: {
        currentSceneId: null, currentGeneratedSceneId, currentBeatPosition, pathSummary,
        progressRevision: { increment: 1 },
      } });
    }

    return { ...f, artist, profile, progress, input, generatedScene, setRoute };
  }

  it('remembers only dialogue actually read in a previous generated scene', async () => {
    const f = await fixture();
    const previous = await f.generatedScene('이전 장면', [
      `${artistName}: 읽은 약속이야.`, `${artistName}: 아직 읽지 않은 대사야.`,
    ]);
    const current = await f.generatedScene('현재 장면', [`${artistName}: 현재 대사야.`]);
    await f.setRoute([
      { generatedSceneId: previous.id },
      { sourceGeneratedSceneId: previous.id, readBeatPosition: 1, generatedSceneId: current.id },
    ], current.id, 0);

    expect(await loadStoryChatMemoryContext(db as never, f.input)).toEqual({
      source: 'attributed_story_dialogue',
      items: [{ workTitle: 'Synthetic story', sceneTitle: '이전 장면', artistDialogue: '읽은 약속이야.' }],
    });
    await f.setRoute([
      { generatedSceneId: previous.id },
      { sourceGeneratedSceneId: previous.id, readBeatPosition: 1, generatedSceneId: current.id },
    ], current.id, 1);
    expect(await loadStoryChatMemoryContext(db as never, f.input)).toEqual({
      source: 'attributed_story_dialogue',
      items: [
        { workTitle: 'Synthetic story', sceneTitle: '현재 장면', artistDialogue: '현재 대사야.' },
        { workTitle: 'Synthetic story', sceneTitle: '이전 장면', artistDialogue: '읽은 약속이야.' },
      ],
    });
  });

  it('does not promote a canonical colon or navigation cursor into author approval and a read receipt', async () => {
    const f = await fixture();
    await db.storyBeat.update({
      where: { sceneId_position: { sceneId: f.scene.id, position: 1 } },
      data: { content: { ko: `${artistName}: 원작 장면에서 나눈 약속이야.` } },
    });
    expect(await loadStoryChatMemoryContext(db as never, f.input)).toEqual(unverifiedStoryMemoryContext());

    await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: {
      currentBeatPosition: 1, progressRevision: { increment: 1 },
    } });
    expect(await loadStoryChatMemoryContext(db as never, f.input)).toEqual(unverifiedStoryMemoryContext());
  });

  it('excludes a ready scene on an abandoned route and forgets it after a completed reset', async () => {
    const f = await fixture();
    const abandoned = await f.generatedScene('버린 경로', [`${artistName}: 옛 경로의 기억.`]);
    const active = await f.generatedScene('새 경로', [`${artistName}: 새 경로의 기억.`]);
    await f.setRoute([{ generatedSceneId: abandoned.id }], abandoned.id, 1);
    expect((await loadStoryChatMemoryContext(db as never, f.input)).items).toHaveLength(1);

    const before = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progress.id } });
    const root = await createStoryRouteRoot(db, before, f.scene.id, f.part.actNumber);
    await db.storyResetCommand.create({ data: {
      progressId: before.id, userId: before.userId, idempotencyKey: randomUUID(),
      targetType: 'full', beforeRevision: before.progressRevision,
      afterRevision: before.progressRevision + 1,
    } });
    await db.storyReaderProgress.update({ where: { id: before.id }, data: {
      currentSceneId: f.scene.id, currentGeneratedSceneId: null, currentBeatPosition: 0,
      pathSummary: [], routeNodeId: root, progressRevision: { increment: 1 },
    } });
    expect(await loadStoryChatMemoryContext(db as never, f.input)).toEqual(unverifiedStoryMemoryContext());
    expect(await db.storyAiGeneratedScene.findUnique({ where: { id: abandoned.id } })).toMatchObject({ status: 'ready' });

    await f.setRoute([{ generatedSceneId: active.id }], active.id, 1);
    expect(await loadStoryChatMemoryContext(db as never, f.input)).toEqual({
      source: 'attributed_story_dialogue',
      items: [{ workTitle: 'Synthetic story', sceneTitle: '새 경로', artistDialogue: '새 경로의 기억.' }],
    });
  });

  it('revokes memory when the pinned artist identity loses approval', async () => {
    const f = await fixture();
    const scene = await f.generatedScene('신원 장면', [`${artistName}: 확인된 대사.`]);
    await f.setRoute([{ generatedSceneId: scene.id }], scene.id, 1);
    expect((await loadStoryChatMemoryContext(db as never, f.input)).items).toHaveLength(1);
    await db.artistStoryIdentityProfile.update({ where: { id: f.profile.id }, data: { status: 'rejected' } });
    expect(await loadStoryChatMemoryContext(db as never, f.input)).toEqual(unverifiedStoryMemoryContext());
  });

  it('locks only the approved pinned identity for final chat persistence', async () => {
    const f = await fixture();
    const scope = await loadStoryChatRouteScope(db as never, {
      userId: f.progress.userId, artistId: f.artist.id, progressId: f.progress.id,
    });
    expect(scope).not.toBeNull();
    expect(await db.$transaction(tx => lockApprovedStoryChatIdentity(tx, scope!, f.artist.id))).toBe(true);
    await db.artistStoryIdentityProfile.update({ where: { id: f.profile.id }, data: { status: 'rejected' } });
    expect(await db.$transaction(tx => lockApprovedStoryChatIdentity(tx, scope!, f.artist.id))).toBe(false);
  });

  it('shows only current-route chat turns after a reset and keeps ordinary chat separate', async () => {
    const f = await fixture();
    const session = await db.chatSession.create({ data: {
      userId: f.progress.userId, artistId: f.artist.id,
    } });
    const service = new ChatService(db as never, {} as never);
    const firstScope = await loadStoryChatRouteScope(db as never, {
      userId: f.progress.userId, artistId: f.artist.id, progressId: f.progress.id,
    });
    expect(firstScope).not.toBeNull();
    const ordinary = await db.chatMessage.create({ data: {
      chatSessionId: session.id, senderType: 'artist', messageType: 'opening_greeting',
      body: 'ordinary greeting',
    } });
    const firstRoute = await db.chatMessage.create({ data: {
      chatSessionId: session.id, senderType: 'user', body: 'before reset',
      modelMetadata: { storyRouteScope: storyChatRouteMarker(firstScope!) },
    } });
    expect((await service.getMessages(f.progress.userId, session.id, f.progress.id)).map(row => row.id))
      .toEqual([firstRoute.id]);

    const before = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progress.id } });
    const nextRouteNodeId = await createStoryRouteRoot(db, before, f.scene.id, f.part.actNumber);
    await db.storyResetCommand.create({ data: {
      progressId: before.id, userId: before.userId, idempotencyKey: randomUUID(),
      targetType: 'full', beforeRevision: before.progressRevision,
      afterRevision: before.progressRevision + 1,
    } });
    await db.storyReaderProgress.update({ where: { id: before.id }, data: {
      currentSceneId: f.scene.id, currentGeneratedSceneId: null, currentBeatPosition: 0,
      pathSummary: [], routeNodeId: nextRouteNodeId, progressRevision: { increment: 1 },
    } });
    expect(await service.getMessages(f.progress.userId, session.id, f.progress.id)).toEqual([]);
    const nextScope = await loadStoryChatRouteScope(db as never, {
      userId: f.progress.userId, artistId: f.artist.id, progressId: f.progress.id,
    });
    expect(nextScope).not.toBeNull();
    const secondRoute = await db.chatMessage.create({ data: {
      chatSessionId: session.id, senderType: 'artist', body: 'after reset',
      modelMetadata: { storyRouteScope: storyChatRouteMarker(nextScope!) },
    } });
    expect((await service.getMessages(f.progress.userId, session.id, f.progress.id)).map(row => row.id))
      .toEqual([secondRoute.id]);
    expect((await service.getMessages(f.progress.userId, session.id)).map(row => row.id))
      .toEqual([ordinary.id]);
    await expect(service.getMessages(f.owner.id, session.id, f.progress.id)).rejects.toThrow();
  });

  it('does not return dialogue if identity approval is revoked while memory loads', async () => {
    const f = await fixture();
    const scene = await f.generatedScene('경합 장면', [`${artistName}: 이제는 철회된 대사.`]);
    await f.setRoute([{ generatedSceneId: scene.id }], scene.id, 1);
    const racingDb = db.$extends({ query: {
      artistStoryIdentityProfile: {
        async findFirst({ args, query }) {
          const approved = await query(args);
          if (approved) {
            await db.artistStoryIdentityProfile.update({
              where: { id: f.profile.id }, data: { status: 'rejected' },
            });
          }
          return approved;
        },
      },
    } });

    expect(await loadStoryChatMemoryContext(racingDb as never, f.input)).toEqual(unverifiedStoryMemoryContext());
  });

  it('fails closed on multiple eligible progresses unless the exact progress is selected', async () => {
    const f = await fixture();
    const scene = await f.generatedScene('첫 작품', [`${artistName}: 첫 작품의 대사.`]);
    await f.setRoute([{ generatedSceneId: scene.id }], scene.id, 1);
    const secondWork = await activationFixture(db, false);
    const second = await db.storyReaderProgress.create({ data: {
      userId: f.progress.userId, workId: secondWork.work.id,
      currentSceneId: secondWork.scene.id, checkpointSceneId: secondWork.scene.id,
      activeReleaseId: secondWork.release.id, aiRateCardId: secondWork.rate.id,
      capabilityRevision: secondWork.progresses[0].capabilityRevision,
    } });
    const routeNodeId = await createStoryRouteRoot(db, second, secondWork.scene.id, secondWork.part.actNumber);
    await db.storyReaderProgress.update({ where: { id: second.id }, data: { routeNodeId } });
    await bindArtist(second, f.artist.id, f.profile.id);

    const { progressId: _progressId, ...ambiguousInput } = f.input;
    expect(await loadStoryChatMemoryContext(db as never, ambiguousInput)).toEqual(unverifiedStoryMemoryContext());
    expect((await loadStoryChatMemoryContext(db as never, f.input)).items).toEqual([
      { workTitle: 'Synthetic story', sceneTitle: '첫 작품', artistDialogue: '첫 작품의 대사.' },
    ]);
    expect(await loadStoryChatMemoryContext(db as never, {
      ...f.input, progressId: second.id,
    })).toEqual(unverifiedStoryMemoryContext());
    expect(await loadStoryChatMemoryContext(db as never, {
      ...f.input, userId: secondWork.reader.id,
    })).toEqual(unverifiedStoryMemoryContext());
  });
});

import { NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ARTIST_PROFILE_SECTION_KEYS, CREATOR_GENERATION_PROFILE_SCHEMA, creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile } from '../generation-profile/creator-generation-profile.policy';
import { StoryCanonicalReadService } from '../story-production/story-canonical-read.service';
import { StoryInteractionApprovalService } from '../story-production/story-interaction-approval.service';
import { ExecuteStoryResetDto } from '../story-production/dto/story-production.dto';
import { activationFixture } from '../story-production/story-ai-activation.postgres-fixture';
import { StoryProgressControlService } from '../story-production/story-progress-control.service';
import { appendStoryRoute } from '../story-production/story-route-identity.store';
import { ChatService } from './chat.service';
import { loadStoryChatMemoryContext, unverifiedStoryMemoryContext } from './story-chat-memory';
import { loadStoryChatRouteScope, storyChatRouteMarker } from './story-chat-route-scope';

// Operator setup: apply existing migrations and generate Prisma on the dedicated
// loopback QA database, then run only this spec with Jest --runInBand.
// Synthetic author/reader records and reset/chat isolation, not a semantic review
// of a real manuscript or an assessment of AI output quality. No generation is requested.
const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
const artistName = 'Synthetic Reset Artist';
const sourceFingerprint = 'a'.repeat(64);

postgres('real story resets isolate memory and chat on dedicated PostgreSQL', () => {
  let db: PrismaClient;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' ||
        parsed.port !== '55432' || parsed.username !== 'lumina_qa' ||
        parsed.pathname !== '/lumina_chat_memory_reset_qa' || parsed.search || parsed.hash) {
      throw new Error('Dedicated loopback chat-memory-reset QA database required');
    }
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
  });

  afterAll(async () => {
    // Retain append-only routes, author approvals and receipts until the operator
    // verifies and drops this run's newly created dedicated database as a whole.
    await db?.$disconnect();
  });

  it('clears read act/full memory, fences old chat by reset epoch, and leaves replay/rejections inert', async () => {
    const f = await activationFixture(db, false);
    await db.storyWork.update({ where: { id: f.work.id }, data: { publishedAt: new Date(0),
      slug: `synthetic-memory-reset-${randomUUID()}` } });
    const p = f.progresses[0];
    const controls = new StoryProgressControlService(db as never, undefined as never, f.economics);
    const noProvider = {
      readiness: jest.fn(() => { throw new Error('Provider access is forbidden in reset QA'); }),
      generate: jest.fn(() => { throw new Error('Provider access is forbidden in reset QA'); }),
    };
    const chat = new ChatService(db as never, noProvider as never);

    const artist = await db.artist.create({ data: {
      slug: `chat-memory-reset-${randomUUID()}`, displayName: artistName, status: 'active',
    } });
    const referenceAssetIds = [randomUUID()];
    const settings = normalizeCreatorGenerationProfile('artist', { kind: 'artist', schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
      sections: ARTIST_PROFILE_SECTION_KEYS.map(key => ({ key, decision: 'accepted' as const,
        value: { summary: 'Synthetic approved reset identity' }, evidence: [] })) });
    const approvedFingerprint = creatorGenerationProfileFingerprint(sourceFingerprint, settings);
    const profile = await db.artistStoryIdentityProfile.create({ data: {
      artistId: artist.id, sourceFingerprint, referenceAssetIds,
      profileVersion: 1, reviewRevision: 1, status: 'approved',
      approvedSettings: settings as unknown as Prisma.InputJsonValue, approvedFingerprint,
      approvedByUserId: f.owner.id, approvedAt: new Date(),
    } });
    await db.storyProgressArtistParticipant.create({ data: {
      progressId: p.id, userId: p.userId, workId: f.work.id, artistId: artist.id,
      selectionSource: 'search', participantFingerprint: 'c'.repeat(64),
      identityProfileId: profile.id, identityProfileVersion: profile.profileVersion,
      identityReviewRevision: profile.reviewRevision, identitySourceFingerprint: sourceFingerprint,
      identityApprovedFingerprint: approvedFingerprint,
      referenceAssetIds, referenceChecksums: ['d'.repeat(64)],
    } });
    const session = await db.chatSession.create({ data: { userId: p.userId, artistId: artist.id } });
    // A cached ordinary greeting prevents the unscoped read from generating one.
    const ordinary = await db.chatMessage.create({ data: {
      chatSessionId: session.id, senderType: 'artist', messageType: 'opening_greeting',
      body: 'Synthetic ordinary greeting',
    } });
    const input = { userId: p.userId, artistId: artist.id, artistDisplayName: artistName, progressId: p.id };
    const readProgress = () => db.storyReaderProgress.findUniqueOrThrow({ where: { id: p.id } });
    const memory = () => loadStoryChatMemoryContext(db as never, input);
    const messages = async () => (await chat.getMessages(p.userId, session.id, p.id)).map(row => row.id);
    const routeScope = () => loadStoryChatRouteScope(db as never, input);
    async function routeMessage(body: string) {
      const scope = await routeScope();
      expect(scope).not.toBeNull();
      return db.chatMessage.create({ data: {
        chatSessionId: session.id, senderType: 'artist', body,
        modelMetadata: { storyRouteScope: storyChatRouteMarker(scope!) },
      } });
    }
    async function readFirstBeat() {
      const current = await readProgress();
      await controls.confirmCheckpoint(p.userId, p.id, {
        sceneId: current.currentSceneId!, beatPosition: 1,
        expectedRevision: current.progressRevision, locale: 'ko',
      });
      if (current.currentSceneId === f.scene.id) return;
      const beat = await db.storyBeat.findUniqueOrThrow({ where: {
        sceneId_position: { sceneId: current.currentSceneId!, position: 1 } } });
      const sourceText = (beat.content as Prisma.JsonObject).ko as string;
      const quote = sourceText.slice(`${artistName}: `.length);
      const approvals = new StoryInteractionApprovalService(db as never);
      const review = await approvals.review(f.owner.id, f.work.id, beat.id, { artistId: artist.id, locale: 'ko' });
      if (!review.approvals.some(row => row.status === 'approved')) await approvals.approve(f.owner.id, f.work.id, beat.id, {
        artistId: artist.id, locale: 'ko', idempotencyKey: randomUUID(),
        expectedSourceChecksum: review.identity.sourceChecksum, expectedIdentityPinHash: review.identity.identityPinHash,
        interactionReviewed: true, interactionKind: 'dialogue', evidenceStart: sourceText.indexOf(quote), evidenceText: quote, memoryText: quote,
      });
      const reads = new StoryCanonicalReadService(db as never);
      const preview = await reads.preview(p.userId, p.id, beat.id, { locale: 'ko' });
      await reads.confirm(p.userId, p.id, beat.id, { locale: 'ko', idempotencyKey: randomUUID(),
        expectedRevision: preview.expectedRevision, expectedScopeChecksum: preview.scopeChecksum,
        expectedSourceTextHash: preview.sourceTextHash, displayedAndRead: true });
    }
    async function resetState() {
      return {
        progress: await readProgress(),
        commands: await db.storyResetCommand.count({ where: { progressId: p.id } }),
        nodes: await db.storyProgressRouteNode.count({ where: { progressId: p.id } }),
        checkpoints: await db.storyProgressCheckpoint.count({ where: { progressId: p.id } }),
        quotas: await db.storyResetQuotaBucket.findMany({
          where: { userId: p.userId, workId: f.work.id }, orderBy: { scopeKey: 'asc' },
        }),
      };
    }
    async function assertReplay(body: ExecuteStoryResetDto, key: string,
      receipt: Awaited<ReturnType<StoryProgressControlService['executeReset']>>, currentMessageId: string) {
      const before = await resetState();
      const beforeMemory = await memory();
      expect(await controls.executeReset(p.userId, p.id, body, key))
        .toEqual({ ...receipt, idempotentReplay: true });
      expect(await resetState()).toEqual(before);
      expect(await memory()).toEqual(beforeMemory);
      expect(await messages()).toEqual([currentMessageId]);
    }

    const part2 = await db.storyPart.create({ data: {
      workId: f.work.id, position: 2, actNumber: 2, title: { ko: 'Synthetic act two' },
      status: 'published', publishedAt: new Date(0),
    } });
    const entry = await db.storyScene.create({ data: {
      partId: part2.id, sceneKey: 'act-entry', position: 1,
      title: { ko: 'Synthetic act entry' }, status: 'published',
    } });
    const tail = await db.storyScene.create({ data: {
      partId: part2.id, sceneKey: 'act-tail', position: 2,
      title: { ko: 'Synthetic act tail' }, status: 'published',
    } });
    await db.storyBeat.createMany({ data: [
      { sceneId: entry.id, position: 1, beatType: 'dialogue', content: { ko: `${artistName}: Read entry dialogue.` } },
      { sceneId: entry.id, position: 2, beatType: 'dialogue', content: { ko: `${artistName}: Unread entry dialogue.` } },
      { sceneId: tail.id, position: 1, beatType: 'dialogue', content: { ko: `${artistName}: Read tail dialogue.` } },
      { sceneId: tail.id, position: 2, beatType: 'dialogue', content: { ko: `${artistName}: Unread tail dialogue.` } },
    ] });
    const enter = await db.storyChoice.update({ where: { id: f.choice.id }, data: {
      routeKind: 'branch', targetSceneId: entry.id,
    } });
    const next = await db.storyChoice.create({ data: {
      sceneId: entry.id, choiceKey: 'next', position: 1, label: { ko: 'Synthetic next choice' },
      routeKind: 'branch', targetSceneId: tail.id,
    } });

    // Seed valid canonical route ancestry using the existing store, not reset rows.
    async function advance(choice: { id: string; sceneId: string }, targetSceneId: string) {
      await db.$transaction(async tx => {
        const current = await tx.storyReaderProgress.findUniqueOrThrow({ where: { id: p.id } });
        expect(current.currentSceneId).toBe(choice.sceneId);
        const step = { sceneId: choice.sceneId, choiceId: choice.id, nextSceneId: targetSceneId,
          readBeatPosition: current.currentBeatPosition, explicitRejoin: false };
        const nodeId = await appendStoryRoute(tx, current, {
          kind: 'canonical', sceneId: choice.sceneId, choiceId: choice.id, targetSceneId, endingKey: null,
        }, 2, step);
        expect(nodeId).not.toBeNull();
        await tx.storyChoiceEvent.create({ data: {
          progressId: p.id, sceneId: choice.sceneId, choiceId: choice.id, targetSceneId,
        } });
        await tx.storyReaderProgress.update({ where: { id: p.id }, data: {
          routeNodeId: nodeId, currentSceneId: targetSceneId, currentGeneratedSceneId: null,
          currentAct: 2, currentBeatPosition: 0, progressRevision: { increment: 1 },
          pathSummary: [...current.pathSummary as Prisma.JsonArray, step] as Prisma.InputJsonValue,
          seenSceneIds: [f.scene.id, entry.id, ...(targetSceneId === tail.id ? [tail.id] : [])],
        } });
      });
    }

    expect(await memory()).toEqual(unverifiedStoryMemoryContext());
    await readFirstBeat(); // Act one's surviving prefix is narration, not artist dialogue.
    await advance(enter, entry.id);
    const atEntry = await readProgress();
    const oldEntryChat = await routeMessage('Synthetic old entry chat');
    expect(await messages()).toEqual([oldEntryChat.id]);
    await readFirstBeat();
    await advance(next, tail.id);
    await readFirstBeat();
    const oldTailChat = await routeMessage('Synthetic old tail chat');
    expect(await messages()).toEqual([oldTailChat.id]);
    const readMemory = { source: 'attributed_story_dialogue', items: [
      { workTitle: 'Synthetic story', sceneTitle: 'Synthetic act tail', artistDialogue: 'Read tail dialogue.',
        interactionKind: 'dialogue', evidenceSource: 'canonical_author_approved' },
      { workTitle: 'Synthetic story', sceneTitle: 'Synthetic act entry', artistDialogue: 'Read entry dialogue.',
        interactionKind: 'dialogue', evidenceSource: 'canonical_author_approved' },
    ] };
    expect(await memory()).toMatchObject(readMemory); // Neither unread second beat is eligible.

    const beforeAct = await readProgress();
    const actBody: ExecuteStoryResetDto = {
      target: 'act', actNumber: 2, expectedRevision: beforeAct.progressRevision, locale: 'ko',
    };
    const rejectedState = await resetState();
    await expect(controls.executeReset(f.owner.id, p.id, actBody, randomUUID()))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(controls.executeReset(p.userId, p.id, {
      ...actBody, expectedRevision: beforeAct.progressRevision - 1,
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'STORY_PROGRESS_STALE_REVISION' } });
    expect(await resetState()).toEqual(rejectedState);
    expect(await memory()).toMatchObject(readMemory);
    expect(await messages()).toEqual([oldTailChat.id]);
    expect(await loadStoryChatMemoryContext(db as never, { ...input, userId: f.owner.id }))
      .toEqual(unverifiedStoryMemoryContext());
    await expect(chat.getMessages(f.owner.id, session.id, p.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(chat.getMessages(p.userId, session.id, f.progresses[1].id)).rejects.toThrow();

    const actKey = randomUUID();
    const actReceipt = await controls.executeReset(p.userId, p.id, actBody, actKey);
    expect(actReceipt).toMatchObject({ target: 'act', targetAct: 2, status: 'completed',
      beforeRevision: beforeAct.progressRevision, afterRevision: beforeAct.progressRevision + 1,
      invalidatedEventCount: 1, idempotentReplay: false });
    const afterAct = await readProgress();
    expect(afterAct).toMatchObject({ routeNodeId: atEntry.routeNodeId, currentSceneId: entry.id,
      currentGeneratedSceneId: null, currentBeatPosition: 0, currentAct: 2,
      progressRevision: actReceipt.afterRevision, pathSummary: atEntry.pathSummary });
    expect(await memory()).toEqual(unverifiedStoryMemoryContext());
    expect(await messages()).toEqual([]);
    expect(await routeScope()).toMatchObject({ routeNodeId: atEntry.routeNodeId,
      resetCommandId: actReceipt.commandId, resetAfterRevision: actReceipt.afterRevision });
    expect(await db.storyChoiceEvent.findFirstOrThrow({ where: { progressId: p.id, choiceId: next.id } }))
      .toMatchObject({ invalidatedAt: expect.any(Date), resetCommandId: actReceipt.commandId });
    expect(await db.storyChoiceEvent.findFirstOrThrow({ where: { progressId: p.id, choiceId: enter.id } }))
      .toMatchObject({ invalidatedAt: null, resetCommandId: null });

    const actChat = await routeMessage('Synthetic current act chat');
    expect(await messages()).toEqual([actChat.id]);
    await readFirstBeat();
    expect(await memory()).toMatchObject({ source: 'attributed_story_dialogue', items: [readMemory.items[1]] });
    expect(await messages()).toEqual([actChat.id]); // Reading advances revision, not the reset epoch.
    await assertReplay(actBody, actKey, actReceipt, actChat.id);
    const replayState = await resetState();
    await expect(controls.executeReset(f.owner.id, p.id, actBody, actKey))
      .rejects.toMatchObject({ response: { code: 'STORY_RESET_IDEMPOTENCY_CONFLICT' } });
    await expect(controls.executeReset(p.userId, p.id, { ...actBody, target: 'full' }, actKey))
      .rejects.toMatchObject({ response: { code: 'STORY_RESET_IDEMPOTENCY_CONFLICT' } });
    expect(await resetState()).toEqual(replayState);
    expect(await messages()).toEqual([actChat.id]);

    const beforeFull = await readProgress();
    const fullBody: ExecuteStoryResetDto = {
      target: 'full', expectedRevision: beforeFull.progressRevision, locale: 'ko',
    };
    const fullKey = randomUUID();
    const fullReceipt = await controls.executeReset(p.userId, p.id, fullBody, fullKey);
    expect(fullReceipt).toMatchObject({ target: 'full', targetAct: 1, status: 'completed',
      beforeRevision: beforeFull.progressRevision, afterRevision: beforeFull.progressRevision + 1,
      invalidatedEventCount: 1, idempotentReplay: false });
    const afterFull = await readProgress();
    expect(afterFull).toMatchObject({ currentSceneId: f.scene.id, currentGeneratedSceneId: null,
      currentBeatPosition: 0, currentAct: 1, pathSummary: [],
      progressRevision: fullReceipt.afterRevision, activeReleaseId: f.release.id,
      aiRateCardId: f.rate.id, capabilityRevision: p.capabilityRevision });
    expect(afterFull.routeNodeId).not.toBe(p.routeNodeId);
    expect(afterFull.routeNodeId).not.toBe(afterAct.routeNodeId);
    expect(await db.storyProgressRouteNode.findUniqueOrThrow({ where: { id: afterFull.routeNodeId! } }))
      .toMatchObject({ progressId: p.id, workId: f.work.id, releaseId: f.release.id,
        stepKind: 'root', depth: 0, parentId: null, targetSceneId: f.scene.id, actNumber: 1 });
    expect(await memory()).toEqual(unverifiedStoryMemoryContext());
    expect(await messages()).toEqual([]);
    expect(await routeScope()).toMatchObject({ routeNodeId: afterFull.routeNodeId,
      resetCommandId: fullReceipt.commandId, resetAfterRevision: fullReceipt.afterRevision });

    const fullChat = await routeMessage('Synthetic current full-reset chat');
    await assertReplay(fullBody, fullKey, fullReceipt, fullChat.id);
    const fullState = await resetState();
    await expect(controls.executeReset(p.userId, p.id, fullBody, randomUUID()))
      .rejects.toMatchObject({ response: { code: 'STORY_PROGRESS_STALE_REVISION' } });
    await expect(controls.executeReset(f.owner.id, p.id, {
      ...fullBody, expectedRevision: afterFull.progressRevision,
    }, randomUUID())).rejects.toBeInstanceOf(NotFoundException);
    expect(await resetState()).toEqual(fullState);
    expect(await memory()).toEqual(unverifiedStoryMemoryContext());
    expect(await messages()).toEqual([fullChat.id]);
    expect((await chat.getMessages(p.userId, session.id)).map(row => row.id)).toEqual([ordinary.id]);
    expect(await db.chatMessage.count({ where: { chatSessionId: session.id } })).toBe(5);
    expect(await db.storyProgressRouteNode.findUnique({ where: { id: beforeAct.routeNodeId! } })).not.toBeNull();
    expect(await db.storyResetCommand.count({ where: { progressId: p.id } })).toBe(2);
    expect(await db.storyResetQuotaBucket.findMany({ where: { userId: p.userId, workId: f.work.id },
      orderBy: { scopeKey: 'asc' }, select: { scopeKey: true, usedCount: true } }))
      .toEqual([{ scopeKey: 'act:2', usedCount: 1 }, { scopeKey: 'full', usedCount: 1 }]);
    expect(noProvider.readiness).not.toHaveBeenCalled();
    expect(noProvider.generate).not.toHaveBeenCalled();
    expect(f.provider.readiness).not.toHaveBeenCalled();
    expect(f.provider.generate).not.toHaveBeenCalled();
  }, 30000);
});

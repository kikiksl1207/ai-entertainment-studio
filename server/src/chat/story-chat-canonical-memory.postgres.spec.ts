import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ARTIST_PROFILE_SECTION_KEYS, CREATOR_GENERATION_PROFILE_SCHEMA, creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile } from '../generation-profile/creator-generation-profile.policy';
import { activationFixture } from '../story-production/story-ai-activation.postgres-fixture';
import { StoryCanonicalReadService } from '../story-production/story-canonical-read.service';
import { StoryInteractionApprovalService } from '../story-production/story-interaction-approval.service';
import { StoryProgressControlService } from '../story-production/story-progress-control.service';
import { appendStoryRoute } from '../story-production/story-route-identity.store';
import { STORY_LOCALES, StoryLocale } from '../story-production/story-production.policy';
import { loadStoryChatMemoryContext, unverifiedStoryMemoryContext } from './story-chat-memory';
import { ChatLlmProviderAdapter } from './llm-provider.adapter';
import { ChatService } from './chat.service';
import { storyChatMemoryMarker } from './story-chat-memory-scope';
import { loadStoryChatRouteScope, storyChatRouteMarker } from './story-chat-route-scope';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
const dedicated = 'postgresql://lumina_qa@127.0.0.1:55432/lumina_canonical_memory_qa';
jest.setTimeout(30000);

// Real services and enabled SQL guards, synthetic data only. No model calls.
postgres('canonical author + reader memories on dedicated PostgreSQL', () => {
  let db: PrismaClient;
  beforeAll(async () => {
    if (url !== dedicated) throw new Error('Exact dedicated canonical-memory QA database required');
    db = new PrismaClient({ datasources: { db: { url } } }); await db.$connect();
  });
  afterAll(async () => { await db?.$disconnect(); });
  beforeEach(() => { jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Provider calls forbidden')); });
  afterEach(() => { expect(global.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

  async function fixture() {
    const f = await activationFixture(db, false);
    await db.storyWork.update({ where: { id: f.work.id }, data: { slug: `synthetic-canonical-memory-${randomUUID()}`,
      publishedAt: new Date(0), supportedLocales: [...STORY_LOCALES] } });
    const artist = await db.artist.create({ data: { slug: `synthetic-memory-artist-${randomUUID()}`,
      displayName: 'Aster', status: 'active' } });
    const settings = normalizeCreatorGenerationProfile('artist', { kind: 'artist', schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
      sections: ARTIST_PROFILE_SECTION_KEYS.map(key => ({ key, decision: 'accepted' as const,
        value: { summary: 'Synthetic approved memory identity' }, evidence: [] })) });
    const referenceAssetIds = [randomUUID()];
    const profile = await db.artistStoryIdentityProfile.create({ data: { artistId: artist.id, status: 'approved',
      profileVersion: 1, reviewRevision: 1, sourceFingerprint: 'e'.repeat(64), referenceAssetIds,
      approvedSettings: settings as unknown as Prisma.InputJsonValue,
      approvedFingerprint: creatorGenerationProfileFingerprint('e'.repeat(64), settings),
      approvedByUserId: f.owner.id, approvedAt: new Date() } });
    const progress = f.progresses[0];
    await db.storyProgressArtistParticipant.create({ data: { progressId: progress.id, userId: progress.userId,
      workId: progress.workId, artistId: artist.id, selectionSource: 'search', participantFingerprint: 'c'.repeat(64),
      identityProfileId: profile.id, identityProfileVersion: 1, identityReviewRevision: 1,
      identitySourceFingerprint: profile.sourceFingerprint, identityApprovedFingerprint: profile.approvedFingerprint!,
      referenceAssetIds, referenceChecksums: ['d'.repeat(64)] } });
    const texts = Object.fromEntries(STORY_LOCALES.map(locale => [locale,
      ` \t${locale} Cafe\u0301 \uD83D\uDE80\r\nAster: I will open the door. Aster opens the door for the reader. `]));
    const beat = await db.storyBeat.update({ where: { sceneId_position: { sceneId: f.scene.id, position: 1 } },
      data: { beatType: 'narration', content: texts } });
    const approvals = new StoryInteractionApprovalService(db as never), reads = new StoryCanonicalReadService(db as never);
    const input = { userId: progress.userId, artistId: artist.id, artistDisplayName: artist.displayName, progressId: progress.id };
    const memory = (client: unknown = db) => loadStoryChatMemoryContext(client as never, input);
    async function approve(locale: StoryLocale = 'ko', kind: 'action' | 'dialogue' = 'dialogue') {
      const review = await approvals.review(f.owner.id, f.work.id, beat.id, { locale, artistId: artist.id });
      const evidenceText = kind === 'dialogue' ? 'I will open the door.' : 'Aster opens the door for the reader.';
      return approvals.approve(f.owner.id, f.work.id, beat.id, { locale, artistId: artist.id,
        expectedSourceChecksum: review.identity.sourceChecksum, expectedIdentityPinHash: review.identity.identityPinHash,
        idempotencyKey: randomUUID(), interactionKind: kind, interactionReviewed: true,
        evidenceStart: texts[locale].indexOf(evidenceText), evidenceText,
        memoryText: kind === 'dialogue' ? evidenceText : 'Opened the door together.' });
    }
    async function read(locale: StoryLocale = 'ko') {
      const preview = await reads.preview(input.userId, progress.id, beat.id, { locale });
      return reads.confirm(input.userId, progress.id, beat.id, { locale, expectedRevision: preview.expectedRevision,
        expectedScopeChecksum: preview.scopeChecksum, expectedSourceTextHash: preview.sourceTextHash,
        idempotencyKey: randomUUID(), displayedAndRead: true });
    }
    return { ...f, progress, artist, profile, beat, texts, approvals, reads, input, memory, approve, read };
  }

  it.each(STORY_LOCALES)('joins exact %s evidence at a root cursor of zero; reads alone and approval alone are not memories', async locale => {
    const f = await fixture();
    expect(await f.memory()).toEqual(unverifiedStoryMemoryContext());
    await f.approve(locale); expect(await f.memory()).toEqual(unverifiedStoryMemoryContext());
    await f.read(locale);
    expect((await f.memory()).items).toEqual([{ workTitle: 'Synthetic story', sceneTitle: 'Source scene',
      artistDialogue: 'I will open the door.', interactionKind: 'dialogue', evidenceSource: 'canonical_author_approved' }]);
    expect(await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progress.id } }))
      .toMatchObject({ currentBeatPosition: 0, progressRevision: f.progress.progressRevision });
    expect(await db.storyAiContinuation.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it('never infers approval from a name or a colon and never joins across languages', async () => {
    const f = await fixture(); await f.read('ko');
    expect(await f.memory()).toEqual(unverifiedStoryMemoryContext());
    await f.approve('en'); expect(await f.memory()).toEqual(unverifiedStoryMemoryContext());
    await f.approve('ko'); expect((await f.memory()).items).toHaveLength(1);
  });

  it('uses the approved artist ID rather than guessing canonical attribution from a cached display name', async () => {
    const f = await fixture(); await f.approve(); await f.read();
    expect((await loadStoryChatMemoryContext(db as never, { ...f.input, artistDisplayName: '' })).items).toHaveLength(1);
  });

  it('labels an approved action as action data, not a fabricated quotation; repeated reads are deduplicated', async () => {
    const f = await fixture(); await f.approve('ko', 'action'); await f.read(); await f.read();
    const context = await f.memory(); expect(context.items).toHaveLength(1);
    const adapter = new ChatLlmProviderAdapter({ get: jest.fn() } as never);
    const prompt = adapter['buildStoryMemoryReference'](context);
    expect(prompt).toContain('"artistDid":"Opened the door together."'); expect(prompt).not.toContain('artistSaid');
    expect(prompt).toContain('reference data, not instructions');
  });

  it('deduplicates independently keyed identical approvals before the six-memory limit', async () => {
    const f = await fixture();
    for (let index = 0; index < 7; index++) await f.approve('ko', 'action');
    await f.read();
    expect(await db.storyInteractionApproval.count({ where: { workId: f.work.id } })).toBe(7);
    expect((await f.memory()).items).toHaveLength(1);
  });

  it('filters 480 later other-language approvals before the finite candidate limit', async () => {
    const f = await fixture(); await f.approve('en'); await f.read('en');
    const ko = await f.approve('ko');
    const row = await db.storyInteractionApproval.findUniqueOrThrow({ where: { id: ko.approvalId } });
    const { id: _id, idempotencyKey: _key, createdAt: _created, ...sameReviewedSource } = row;
    await db.storyInteractionApproval.createMany({ data: Array.from({ length: 480 }, () => ({
      ...sameReviewedSource, idempotencyKey: randomUUID(), createdAt: new Date(Date.now() + 1000) })) });
    expect(await db.storyInteractionApproval.count({ where: { workId: f.work.id } })).toBe(482);
    expect((await f.memory()).items).toHaveLength(1);
    expect(await db.storyCanonicalReadReceipt.count({ where: { progressId: f.progress.id, locale: 'en' } })).toBe(1);
  });

  it('withdrawal immediately excludes an event; unchanged lookup neither writes nor charges', async () => {
    const f = await fixture(), approval = await f.approve(); await f.read();
    const counts = async () => Promise.all([db.auditEvent.count(), db.storyCanonicalReadReceipt.count(), db.storyAiUsageLedger.count()]);
    const before = await counts(); expect((await f.memory()).items).toHaveLength(1); expect(await counts()).toEqual(before);
    await f.approvals.revoke(f.owner.id, f.work.id, approval.approvalId, {
      expectedRevision: 1, expectedApprovalChecksum: approval.approvalChecksum });
    expect(await f.memory()).toEqual(unverifiedStoryMemoryContext());
  });

  it('memory-scoped SQL history filters before the message limit and persists both turn markers', async () => {
    const f = await fixture(); await f.approve(); await f.read();
    const context = await f.memory(), marker = storyChatMemoryMarker(context);
    expect(context.canonicalProofFingerprint).toMatch(/^[a-f0-9]{64}$/);
    const scope = (await loadStoryChatRouteScope(db as never, {
      userId: f.input.userId, artistId: f.artist.id, progressId: f.progress.id,
    }))!;
    const session = await db.chatSession.create({ data: { userId: f.input.userId, artistId: f.artist.id } });
    const chat = new ChatService(db as never, { generate: jest.fn() } as never);
    const generated = { body: 'Synthetic approved-memory reply',
      usage: { provider: 'offline-test', model: 'synthetic-v1', inputTokens: 0, outputTokens: 0, estimatedCostKrw: '0.00' },
      safetyMetadata: {} };
    await chat['persistGeneratedMessage'](f.input.userId, session.id, f.artist.id,
      'Synthetic memory question', undefined, generated, scope, marker);
    const stored = await db.chatMessage.findMany({ where: { chatSessionId: session.id } });
    expect(stored).toHaveLength(2);
    for (const message of stored) expect(message.modelMetadata).toMatchObject({
      storyRouteScope: storyChatRouteMarker(scope), storyMemoryScope: marker,
    });
    const routeMarker = storyChatRouteMarker(scope);
    await db.chatMessage.createMany({ data: Array.from({ length: 25 }, (_, index) => ({
      chatSessionId: session.id, senderType: 'artist', body: `Synthetic stale history ${index}`,
      createdAt: new Date(Date.now() + 1000),
      modelMetadata: { storyRouteScope: routeMarker,
        ...(index % 2 ? { storyMemoryScope: { ...marker, checksum: 'f'.repeat(64) } } : {}) },
    })) });
    expect((await chat['recentProviderMessages'](session.id, scope, marker)).map(message => message.body).sort())
      .toEqual(['Synthetic approved-memory reply', 'Synthetic memory question'].sort());
    expect(await chat['recentProviderMessages'](session.id, null)).toEqual([]);
    expect(await db.chatMessage.count({ where: { chatSessionId: session.id } })).toBe(27);
  });

  it('memory-scoped withdrawal excludes historical answers without deleting the transcript', async () => {
    const f = await fixture(), approval = await f.approve(); await f.read();
    const oldMarker = storyChatMemoryMarker(await f.memory());
    const scope = (await loadStoryChatRouteScope(db as never, {
      userId: f.input.userId, artistId: f.artist.id, progressId: f.progress.id,
    }))!;
    const session = await db.chatSession.create({ data: { userId: f.input.userId, artistId: f.artist.id } });
    const original = await db.chatMessage.create({ data: { chatSessionId: session.id, senderType: 'artist',
      body: 'Synthetic previous memory answer', modelMetadata: {
        storyRouteScope: storyChatRouteMarker(scope), storyMemoryScope: oldMarker,
      } } });
    const chat = new ChatService(db as never, { generate: jest.fn() } as never);
    expect(await chat['recentProviderMessages'](session.id, scope, oldMarker)).toHaveLength(1);
    await f.approvals.revoke(f.owner.id, f.work.id, approval.approvalId, {
      expectedRevision: 1, expectedApprovalChecksum: approval.approvalChecksum,
    });
    const currentMarker = storyChatMemoryMarker(await f.memory());
    expect(currentMarker).not.toEqual(oldMarker);
    expect(await chat['recentProviderMessages'](session.id, scope, currentMarker)).toEqual([]);
    expect(await db.chatMessage.findUniqueOrThrow({ where: { id: original.id } }))
      .toMatchObject({ body: original.body, modelMetadata: original.modelMetadata });
    await expect(chat['assertStoryMemoryCurrent'](f.input.userId, f.artist, scope, oldMarker))
      .rejects.toMatchObject({ response: { code: 'STORY_CHAT_MEMORY_CHANGED' } });
  });

  it.each([false, true])('memory-scoped real generation pipeline with offline provider; withdrawal=%s', async withdraw => {
    const f = await fixture(), approval = await f.approve(); await f.read();
    const session = await db.chatSession.create({ data: { userId: f.input.userId, artistId: f.artist.id } });
    const expectedMarker = storyChatMemoryMarker(await f.memory());
    const provider = { generate: jest.fn().mockImplementation(async request => {
      expect(request.storyMemoryContext.items).toHaveLength(1);
      if (withdraw) await f.approvals.revoke(f.owner.id, f.work.id, approval.approvalId, {
        expectedRevision: 1, expectedApprovalChecksum: approval.approvalChecksum,
      });
      return { body: 'Synthetic offline response',
        usage: { provider: 'offline-test', model: 'synthetic-v1', inputTokens: 0, outputTokens: 0, estimatedCostKrw: '0.00' },
        safetyMetadata: {} };
    }) };
    const chat = new ChatService(db as never, provider as never);
    // Isolate the memory pipeline from provider allowlisting/quota; no auth or live-model claim.
    jest.spyOn(chat as never, 'buildBasicChatPreflight' as never)
      .mockResolvedValue({ canGenerate: true } as never);
    const result = chat.generateMessage(f.input.userId, session.id, {
      body: 'Synthetic shared-memory question', storyProgressId: f.progress.id,
    });
    if (withdraw) {
      await expect(result).rejects.toMatchObject({ response: { code: 'STORY_CHAT_MEMORY_CHANGED' } });
      expect(await db.chatMessage.count({ where: { chatSessionId: session.id } })).toBe(0);
    } else {
      await expect(result).resolves.toMatchObject({ generationStatus: 'completed' });
      const stored = await db.chatMessage.findMany({ where: { chatSessionId: session.id } });
      expect(stored).toHaveLength(2);
      for (const message of stored) expect(message.modelMetadata).toMatchObject({ storyMemoryScope: expectedMarker });
    }
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(await db.storyAiUsageLedger.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it.each(['text', 'release', 'manuscript', 'name', 'profile', 'new-profile', 'unpublished', 'fixture', 'access'] as const)
  ('excludes stale %s and cannot borrow another reader\'s confirmations', async mutation => {
    const f = await fixture(); await f.approve(); await f.read();
    expect((await f.memory()).items).toHaveLength(1);
    expect(await loadStoryChatMemoryContext(db as never, { ...f.input, userId: f.second.id }))
      .toEqual(unverifiedStoryMemoryContext());
    if (mutation === 'text') await db.storyBeat.update({ where: { id: f.beat.id }, data: { content: { ko: `${f.texts.ko} changed` } } });
    if (mutation === 'release') await db.storyRelease.update({ where: { id: f.release.id }, data: { checksum: 'f'.repeat(64) } });
    if (mutation === 'manuscript') await db.storyManuscriptVersion.update({ where: { id: f.manuscript.id }, data: { contentHash: 'f'.repeat(64) } });
    if (mutation === 'name') await db.artist.update({ where: { id: f.artist.id }, data: { displayName: 'Other Aster' } });
    if (mutation === 'profile') await db.artistStoryIdentityProfile.update({ where: { id: f.profile.id }, data: { status: 'needs_review' } });
    if (mutation === 'new-profile') await db.artistStoryIdentityProfile.create({ data: { artistId: f.artist.id,
      profileVersion: 2, reviewRevision: 0, sourceFingerprint: 'f'.repeat(64), status: 'pending_analysis', referenceAssetIds: [] } });
    if (mutation === 'unpublished') await db.storyScene.update({ where: { id: f.scene.id }, data: { status: 'draft' } });
    if (mutation === 'fixture') await db.storyScene.update({ where: { id: f.scene.id }, data: { fixtureSource: true } });
    if (mutation === 'access') await db.storyPart.update({ where: { id: f.part.id }, data: { priceLumina: 1 } });
    expect(await f.memory()).toEqual(unverifiedStoryMemoryContext());
  });

  it('keeps confirmed ancestors after navigation/completion and then invalidates on full reset', async () => {
    const f = await fixture(); await f.approve(); await f.read();
    const next = await db.storyScene.create({ data: { partId: f.part.id, sceneKey: 'next', position: 2,
      status: 'published', title: { ko: 'Next scene' } } });
    const child = await appendStoryRoute(db, f.progress, { kind: 'canonical', sceneId: f.scene.id,
      choiceId: f.choice.id, targetSceneId: next.id, endingKey: null }, 1, { sceneId: f.scene.id });
    await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: { routeNodeId: child,
      currentSceneId: next.id, progressRevision: { increment: 1 }, pathSummary: [{ sceneId: f.scene.id }] } });
    expect((await f.memory()).items).toHaveLength(1);
    await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: {
      status: 'completed', currentSceneId: null, pathSummary: [], progressRevision: { increment: 1 } } });
    expect((await f.memory()).items).toHaveLength(1);
    const controls = new StoryProgressControlService(db as never, undefined as never, f.economics);
    const current = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progress.id } });
    const result = await controls.executeReset(f.reader.id, current.id, { target: 'full',
      expectedRevision: current.progressRevision, locale: 'ko' }, randomUUID());
    expect(await f.memory()).toEqual(unverifiedStoryMemoryContext());
    expect(await db.storyCanonicalReadReceipt.findFirstOrThrow({ where: { progressId: current.id } }))
      .toMatchObject({ invalidatedAt: expect.any(Date), resetCommandId: result.commandId });
  });

  it('does not adopt a confirmed sibling even when both branches target the same scene', async () => {
    const f = await fixture(); await f.approve();
    const other = await db.storyChoice.create({ data: { sceneId: f.scene.id, choiceKey: 'sibling', position: 2,
      label: { ko: 'Sibling choice' }, targetSceneId: f.scene.id, routeKind: 'branch' } });
    const first = await appendStoryRoute(db, f.progress, { kind: 'canonical', sceneId: f.scene.id,
      choiceId: f.choice.id, targetSceneId: f.scene.id, endingKey: null }, 1);
    const sibling = await appendStoryRoute(db, f.progress, { kind: 'canonical', sceneId: f.scene.id,
      choiceId: other.id, targetSceneId: f.scene.id, endingKey: null }, 1);
    expect(first).not.toBe(sibling);
    await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: { routeNodeId: first,
      progressRevision: { increment: 1 } } });
    await f.read(); expect((await f.memory()).items).toHaveLength(1);
    await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: { routeNodeId: sibling,
      progressRevision: { increment: 1 } } });
    expect(await f.memory()).toEqual(unverifiedStoryMemoryContext());
    expect(await db.storyCanonicalReadReceipt.count({ where: { progressId: f.progress.id, invalidatedAt: null } })).toBe(1);
  });

  it('keeps a valid original ancestor in a private hashless route without claiming new private events are author-approved', async () => {
    const f = await fixture(); await f.approve(); await f.read();
    const child = await appendStoryRoute(db, f.progress, { kind: 'private' }, 1, { customChoiceId: randomUUID() });
    await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: { routeNodeId: child,
      progressRevision: { increment: 1 }, pathSummary: [{ customChoiceId: randomUUID() }] } });
    expect(await db.storyProgressRouteNode.findUniqueOrThrow({ where: { id: child! } })).toMatchObject({ routeHash: null });
    expect((await f.memory()).items).toHaveLength(1);
  });

  it.each(['withdraw', 'reset', 'text'] as const)('does not return an event when %s changes during its first snapshot', async mutation => {
    const f = await fixture(), approval = await f.approve(); await f.read(); let changed = false;
    const racing = db.$extends({ query: { storyBeat: { async findMany({ args, query }) {
      const rows = await query(args);
      if (!changed) {
        changed = true;
        if (mutation === 'withdraw') await f.approvals.revoke(f.owner.id, f.work.id, approval.approvalId,
          { expectedRevision: 1, expectedApprovalChecksum: approval.approvalChecksum });
        if (mutation === 'text') await db.storyBeat.update({ where: { id: f.beat.id }, data: { content: { ko: `${f.texts.ko} changed` } } });
        if (mutation === 'reset') {
          const current = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progress.id } });
          await new StoryProgressControlService(db as never, undefined as never, f.economics).executeReset(f.reader.id, current.id,
            { target: 'full', expectedRevision: current.progressRevision, locale: 'ko' }, randomUUID());
        }
      }
      return rows;
    } } } });
    expect(await f.memory(racing)).toEqual(unverifiedStoryMemoryContext()); expect(changed).toBe(true);
  });

  async function commitFixture() {
    const f = await fixture(), approval = await f.approve(); await f.read();
    const marker = storyChatMemoryMarker(await f.memory());
    const scope = (await loadStoryChatRouteScope(db as never, {
      userId: f.input.userId, artistId: f.artist.id, progressId: f.progress.id,
    }))!;
    const session = await db.chatSession.create({ data: { userId: f.input.userId, artistId: f.artist.id } });
    const generated = { body: 'Synthetic commit-fenced reply',
      usage: { provider: 'offline-test', model: 'synthetic-v1', inputTokens: 0, outputTokens: 0, estimatedCostKrw: '0.00' },
      safetyMetadata: {} };
    const persist = (client: unknown = db) => new ChatService(client as never, { generate: jest.fn() } as never)
      ['persistGeneratedMessage'](f.input.userId, session.id, f.artist.id, 'Synthetic memory question',
        undefined, generated, scope, marker);
    return { ...f, approval, marker, scope, session, persist };
  }

  type CommitFixture = Awaited<ReturnType<typeof commitFixture>>;
  function namedTransactions(name: string) {
    return { storyResetCommand: db.storyResetCommand,
      $transaction: (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => db.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('application_name', ${name}, true)`;
      return callback(tx);
    }, { timeout: 10000 }) };
  }
  async function mutateCommit(f: CommitFixture, mutation: string, name: string) {
    const named = namedTransactions(name);
    if (mutation === 'withdraw') return new StoryInteractionApprovalService(named as never)
      .revoke(f.owner.id, f.work.id, f.approval.approvalId, {
        expectedRevision: 1, expectedApprovalChecksum: f.approval.approvalChecksum,
      });
    if (mutation === 'reset') return new StoryProgressControlService(named as never, undefined as never, f.economics)
      .executeReset(f.reader.id, f.progress.id, { target: 'full', expectedRevision: f.scope.progressRevision, locale: 'ko' }, randomUUID());
    return named.$transaction(async tx => {
      if (mutation === 'direct approval') return tx.storyInteractionApproval.update({
        where: { id: f.approval.approvalId }, data: { status: 'revoked', revision: 2, revokedAt: new Date() } });
      if (mutation === 'text') return tx.storyBeat.update({ where: { id: f.beat.id }, data: { content: { ko: `${f.texts.ko} changed` } } });
      if (mutation === 'identity') return tx.artistStoryIdentityProfile.update({ where: { id: f.profile.id }, data: { status: 'needs_review' } });
      if (mutation === 'new identity') return tx.artistStoryIdentityProfile.create({ data: {
        artistId: f.artist.id, profileVersion: 2, sourceFingerprint: 'f'.repeat(64),
        referenceAssetIds: [], status: 'pending_analysis',
      } });
      if (mutation === 'participant') return tx.storyProgressArtistParticipant.update({
        where: { progressId: f.progress.id }, data: { identityApprovedFingerprint: 'f'.repeat(64) } });
      if (mutation === 'release') return tx.storyRelease.update({ where: { id: f.release.id }, data: { checksum: 'f'.repeat(64) } });
      if (mutation === 'manuscript') return tx.storyManuscriptVersion.update({ where: { id: f.manuscript.id }, data: { contentHash: 'f'.repeat(64) } });
      if (mutation === 'artist') return tx.artist.update({ where: { id: f.artist.id }, data: { displayName: 'Changed artist' } });
      if (mutation === 'work') return tx.storyWork.update({ where: { id: f.work.id }, data: { status: 'draft' } });
      if (mutation === 'part') return tx.storyPart.update({ where: { id: f.part.id }, data: { priceLumina: 1 } });
      if (mutation === 'scene') return tx.storyScene.update({ where: { id: f.scene.id }, data: { status: 'draft' } });
      if (mutation === 'route') return tx.storyProgressRouteNode.update({ where: { id: f.scope.routeNodeId }, data: { routeHash: 'f'.repeat(64) } });
      throw new Error('Unknown synthetic commit mutation');
    });
  }

  it.each(['withdraw', 'text', 'reset'])('commit fence rejects %s completed after the outside check but before saving', async mutation => {
    const f = await commitFixture();
    await mutateCommit(f, mutation, `commit-before-${randomUUID()}`);
    await expect(f.persist()).rejects.toMatchObject({ response: {
      code: mutation === 'reset' ? 'STORY_CHAT_ROUTE_CHANGED' : 'STORY_CHAT_MEMORY_CHANGED',
    } });
    expect(await db.chatMessage.count({ where: { chatSessionId: f.session.id } })).toBe(0);
  });

  it.each(['withdraw', 'direct approval', 'text', 'identity', 'new identity', 'participant', 'release', 'manuscript',
    'artist', 'work', 'part', 'scene', 'route', 'reset'])('commit fence serializes concurrent %s until both chat turns commit', async mutation => {
    const f = await commitFixture(), name = `commit-during-${randomUUID()}`;
    let reached!: () => void, release!: () => void;
    const arrived = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const paused = db.$extends({ query: { chatMessage: { async create({ args, query }) {
      if (args.data.senderType === 'user') { reached(); await gate; }
      return query(args);
    } } } });
    const saving = f.persist(paused);
    let competing: Promise<unknown> | undefined;
    const savedOutcome = saving.then(value => ({ value }), error => ({ error }));
    let competingOutcome: Promise<unknown> | undefined;
    try {
      await Promise.race([arrived, savedOutcome.then(() => { throw new Error('Save ended before commit gate'); })]);
      competing = mutateCommit(f, mutation, name);
      competingOutcome = competing.then(value => ({ value }), error => ({ error }));
      const deadline = Date.now() + 3000;
      let blocked = false;
      while (Date.now() < deadline && !blocked) {
        const rows = await db.$queryRaw<Array<{ blocked: boolean }>>`SELECT wait_event_type = 'Lock' AS blocked
          FROM pg_stat_activity WHERE datname = current_database() AND application_name = ${name}`;
        blocked = rows.some(row => row.blocked);
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      expect(await db.chatMessage.count({ where: { chatSessionId: f.session.id } })).toBe(0);
      release();
      await saving;
      if (mutation === 'route') await expect(competing).rejects.toThrow('story route nodes are append-only');
      else await competing;
      const messages = await db.chatMessage.findMany({ where: { chatSessionId: f.session.id } });
      expect(messages).toHaveLength(2);
      for (const message of messages) expect(message.modelMetadata).toMatchObject({ storyMemoryScope: f.marker });
      if (mutation === 'route') expect(storyChatMemoryMarker(await f.memory())).toEqual(f.marker);
      else expect(await f.memory()).toEqual(unverifiedStoryMemoryContext());
      const chat = new ChatService(db as never, { generate: jest.fn() } as never);
      expect(await chat['recentProviderMessages'](f.session.id, f.scope,
        storyChatMemoryMarker(await f.memory()))).toHaveLength(mutation === 'route' ? 2 : 0);
    } finally {
      release(); await savedOutcome; await competingOutcome;
    }
  });

  it('commit fence rolls back the user turn when the artist turn cannot be stored', async () => {
    const f = await commitFixture();
    const failing = db.$extends({ query: { chatMessage: { async create({ args, query }) {
      if (args.data.senderType === 'artist') throw new Error('Synthetic second-turn failure');
      return query(args);
    } } } });
    await expect(f.persist(failing)).rejects.toThrow('Synthetic second-turn failure');
    expect(await db.chatMessage.count({ where: { chatSessionId: f.session.id } })).toBe(0);
    expect(storyChatMemoryMarker(await f.memory())).toEqual(f.marker);
  });
});

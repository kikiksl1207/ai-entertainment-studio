import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { activationFixture } from './story-ai-activation.postgres-fixture';
import { StoryArtistParticipantService } from './story-artist-participant.service';
import { StoryAuthorBodyReviewService } from './story-author-body-review.service';
import { AuthorBodyReviewInput, bodyReviewHash } from './story-author-body-review.policy';
import { storyAiResultChecksum } from './story-ai-result-checksum';
import { continuationMemoryPins } from './story-continuation-context.policy';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
jest.setTimeout(30000);
postgres('private owner body reviews (isolated PostgreSQL, synthetic text, no AI)', () => {
  let db: PrismaClient, service: StoryAuthorBodyReviewService;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
        parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash ||
        !/^\/lumina_failed_cost_qa_[a-f0-9]{12}$/.test(parsed.pathname)) throw new Error('Owned loopback QA database required');
    db = new PrismaClient({ datasources: { db: { url } } }); await db.$connect();
    service = new StoryAuthorBodyReviewService(db as never, new StoryArtistParticipantService(db as never, new ConfigService()));
  });
  afterAll(async () => { await db?.$disconnect(); });
  async function fixture(generate = true) {
    const f = await activationFixture(db, true, false);
    await db.storyReaderProgress.update({ where: { id: f.progresses[0].id }, data: { userId: f.owner.id } });
    if (generate) await f.generatePersonal();
    const progress = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progresses[0].id } });
    const current = () => service.current(f.owner.id, f.work.id, 'ko');
    const input = async (decision: 'approve' | 'reject' = 'approve'): Promise<AuthorBodyReviewInput> => {
      const state = await current(); if (!state.target) throw new Error(`Synthetic target unavailable: ${state.state}`);
      return { locale: 'ko', sourceBindingHash: state.target.sourceBindingHash, expectedProgressRevision: state.target.progressRevision,
        expectedReviewId: state.latestReview?.id ?? null, decision, styleReviewed: true, charactersReviewed: true, timelineReviewed: true };
    };
    const review = async (decision: 'approve' | 'reject' = 'approve', key = randomUUID()) => service.review(f.owner.id, f.work.id, await input(decision), key);
    const count = async () => Number((await db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT count(*) FROM story_author_body_reviews WHERE work_id = ${f.work.id}::uuid`))[0].count);
    return { ...f, progress, current, input, review, count };
  }
  it('reads without domain mutation and records private review even without a shared result', async () => {
    const f = await fixture(), before = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progress.id } });
    const origin = await db.storyAiContinuation.findFirstOrThrow({ where: { progressId: f.progress.id } });
    const usage = await db.storyAiUsageLedger.findMany({ where: { continuationId: origin.id } });
    const start = await f.current(); expect(start).toMatchObject({ state: 'reviewable', readOnly: true, latestReview: null,
      generationStarted: false, imageGenerationStarted: false, publicationStarted: false, sharedReuseAuthorized: false });
    expect(await f.current()).toEqual(start); expect(await f.count()).toBe(0);
    const receipt = await f.review(); expect(receipt.review).toMatchObject({ decision: 'approve', applicability: 'current', version: 1 });
    expect((await f.current()).latestReview?.id).toBe(receipt.review.id);
    expect(await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progress.id } })).toEqual(before);
    expect(await db.storyAiContinuation.findUniqueOrThrow({ where: { id: origin.id } })).toEqual(origin);
    expect(await db.storyAiUsageLedger.findMany({ where: { continuationId: origin.id } })).toEqual(usage);
    expect(await db.storyAiReusableResult.count({ where: { workId: f.work.id } })).toBe(0);
    expect(f.provider.generate).not.toHaveBeenCalled();
    const persisted = await db.$queryRaw<Array<{ binding: unknown }>>(Prisma.sql`SELECT binding_snapshot AS binding
      FROM story_author_body_reviews WHERE id = ${receipt.review.id}::uuid`);
    expect(JSON.stringify(persisted)).not.toMatch(/Synthetic generated|structuredBody|resultBeats|providerPayload/);
  });
  it('rejects nonowners before reading their private progress or replay', async () => {
    const f = await fixture(), body = await f.input(), key = randomUUID(); await service.review(f.owner.id, f.work.id, body, key);
    await expect(service.current(f.second.id, f.work.id, 'ko')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.review(f.second.id, f.work.id, body, key)).rejects.toBeInstanceOf(NotFoundException);
    const id = (await f.current()).latestReview!.id;
    await expect(service.withdraw(f.second.id, f.work.id, id, randomUUID())).rejects.toBeInstanceOf(NotFoundException);
  });
  it('requires current generated body, not a pending source or original manuscript', async () => {
    const f = await fixture(false); expect(await f.current()).toMatchObject({ state: 'not_generated', target: null });
    await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: { status: 'ai_pending' } });
    expect(await f.current()).toMatchObject({ state: 'generation_pending', target: null });
  });
  it('replays exact request but not altered intent; stale replay never restores current approval', async () => {
    const f = await fixture(), body = await f.input(), key = randomUUID();
    const first = await service.review(f.owner.id, f.work.id, body, key);
    expect(await service.review(f.owner.id, f.work.id, body, key)).toMatchObject({ idempotentReplay: true, review: { id: first.review.id, applicability: 'current' } });
    await expect(service.review(f.owner.id, f.work.id, { ...body, decision: 'reject' }, key)).rejects.toBeInstanceOf(ConflictException);
    await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: { progressRevision: { increment: 1 } } });
    expect(await service.review(f.owner.id, f.work.id, body, key)).toMatchObject({ idempotentReplay: true, review: { applicability: 'stale' } });
    expect(await f.count()).toBe(1);
  });
  it('latest rejection and withdrawal never fall back to an earlier approval', async () => {
    const f = await fixture(), firstInput = await f.input(), key = randomUUID();
    const first = await service.review(f.owner.id, f.work.id, firstInput, key);
    const rejected = await f.review('reject');
    expect(rejected.review).toMatchObject({ decision: 'reject', applicability: 'current', version: 2 });
    const withdrawKey = randomUUID(); await service.withdraw(f.owner.id, f.work.id, rejected.review.id, withdrawKey);
    expect((await f.current()).latestReview).toMatchObject({ id: rejected.review.id, applicability: 'withdrawn', version: 2 });
    expect(await service.review(f.owner.id, f.work.id, firstInput, key)).toMatchObject({ idempotentReplay: true, review: { id: first.review.id, applicability: 'superseded' } });
    expect(await service.withdraw(f.owner.id, f.work.id, rejected.review.id, withdrawKey)).toMatchObject({ idempotentReplay: true, review: { applicability: 'withdrawn' } });
    await expect(service.withdraw(f.owner.id, f.work.id, first.review.id, withdrawKey)).rejects.toBeInstanceOf(ConflictException);
  });
  it('allows withdrawal after unpublication without generating or rewriting approval history', async () => {
    const f = await fixture(), approved = await f.review();
    await db.storyWork.update({ where: { id: f.work.id }, data: { status: 'draft' } });
    expect(await f.current()).toMatchObject({ state: 'source_changed', target: null, latestReview: { applicability: 'stale' } });
    expect(await service.withdraw(f.owner.id, f.work.id, approved.review.id, randomUUID())).toMatchObject({ review: { applicability: 'withdrawn' } });
    expect(await f.count()).toBe(1);
  });
  it('protects review and withdrawal history against direct SQL update, delete and truncate', async () => {
    const f = await fixture(), approved = await f.review();
    await service.withdraw(f.owner.id, f.work.id, approved.review.id, randomUUID());
    const before = await f.current();
    const statements = [
      Prisma.sql`UPDATE story_author_body_reviews SET decision = 'reject' WHERE id = ${approved.review.id}::uuid`,
      Prisma.sql`DELETE FROM story_author_body_reviews WHERE id = ${approved.review.id}::uuid`,
      Prisma.sql`UPDATE story_author_body_review_withdrawals SET created_at = now() WHERE review_id = ${approved.review.id}::uuid`,
      Prisma.sql`DELETE FROM story_author_body_review_withdrawals WHERE review_id = ${approved.review.id}::uuid`,
      Prisma.sql`TRUNCATE story_author_body_reviews, story_author_body_review_withdrawals`,
      Prisma.sql`TRUNCATE story_author_body_review_withdrawals`,
    ];
    for (const statement of statements) await expect(db.$executeRaw(statement)).rejects.toMatchObject({
      code: 'P2010', meta: { code: '23514', message: expect.stringContaining('STORY_AUTHOR_BODY_REVIEW_IMMUTABLE') } });
    expect(await f.current()).toEqual(before); expect(await f.count()).toBe(1);
  });
  it.each(['body', 'manuscript', 'consent', 'analysis', 'capability', 'route'])('rejects captured approval after %s changes', async kind => {
    const f = await fixture(), body = await f.input();
    if (kind === 'body') await db.storyAiGeneratedBeat.updateMany({ where: { sceneId: f.progress.currentGeneratedSceneId! }, data: { content: { ko: 'Changed synthetic text.' } } });
    if (kind === 'manuscript') await db.storyManuscriptVersion.create({ data: { workId: f.work.id, ownerUserId: f.owner.id,
      version: 2, locale: 'ko', contentHash: 'd'.repeat(64), structuredBody: {} } });
    if (kind === 'consent') await db.storyStyleProfileConsent.update({ where: { id: f.consent.id }, data: { revision: { increment: 1 } } });
    if (kind === 'analysis') await db.storyAnalysisJob.create({ data: { workId: f.work.id, manuscriptVersionId: f.manuscript.id,
      analysisVersion: 2, status: 'completed', idempotencyKey: randomUUID() } });
    if (kind === 'capability') await db.storyReleaseCapability.update({ where: { releaseId: f.release.id }, data: { revision: { increment: 1 } } });
    if (kind === 'route') await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: { routeNodeId: null } });
    expect(await f.current()).toMatchObject({ state: 'source_changed', target: null });
    await expect(service.review(f.owner.id, f.work.id, body, randomUUID())).rejects.toBeInstanceOf(ConflictException);
    expect(await f.count()).toBe(0);
  });
  it('supports private null-hash routes without conflating independent node identities', async () => {
    const f = await fixture();
    const route = await db.storyProgressRouteNode.findUniqueOrThrow({ where: { id: f.progress.routeNodeId! } });
    const { id: _id, ...source } = route;
    const privateSource = { ...source, narrativeStep: source.narrativeStep ?? Prisma.JsonNull,
      routeHash: null, stepKind: 'private', sourceSceneId: null, sourceChoiceId: null,
      sourceSharedResultId: null, sourceSharedChoiceKey: null, targetSceneId: null, endingKey: null };
    const privateRoute = await db.storyProgressRouteNode.create({ data: privateSource });
    await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: { routeNodeId: privateRoute.id } });
    const before = await f.input(); await f.review();
    const replacement = await db.storyProgressRouteNode.create({ data: privateSource });
    await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: { routeNodeId: replacement.id } });
    expect((await f.current()).target?.sourceBindingHash).not.toBe(before.sourceBindingHash);
    expect((await f.current()).latestReview?.applicability).toBe('stale');
  });
  it.each(['revision', 'content', 'status', 'scope'])('invalidates captured and existing approval after pinned memory %s changes', async kind => {
    const f = await fixture();
    const origin = await db.storyAiContinuation.findFirstOrThrow({ where: { progressId: f.progress.id } });
    const memory = await db.storyMemoryRecord.create({ data: { workId: f.work.id,
      manuscriptVersionId: f.manuscript.id, analysisJobId: origin.analysisJobId!,
      memoryType: 'character', memoryKey: randomUUID(), content: { ko: 'Synthetic memory evidence.' } } });
    await db.storyAiContinuation.update({ where: { id: origin.id }, data: { contextReferences: {
      ...(origin.contextReferences as Prisma.JsonObject), memoryPins: continuationMemoryPins([memory]) } } });
    const body = await f.input(), approved = await f.review();
    expect(approved.review.applicability).toBe('current');
    await db.storyMemoryRecord.update({ where: { id: memory.id }, data:
      kind === 'revision' ? { revision: { increment: 1 } } : kind === 'content' ? { content: { ko: 'Changed memory.' } } :
      kind === 'status' ? { status: 'draft' } : { workId: (await fixture(false)).work.id } });
    expect(await f.current()).toMatchObject({ state: 'source_changed', target: null, latestReview: { applicability: 'stale' } });
    await expect(service.review(f.owner.id, f.work.id, { ...body, expectedReviewId: approved.review.id }, randomUUID())).rejects.toBeInstanceOf(ConflictException);
    expect(await f.count()).toBe(1);
  });
  it('serializes concurrent opposite decisions with the expected review head', async () => {
    const f = await fixture(), body = await f.input();
    const results = await Promise.allSettled([service.review(f.owner.id, f.work.id, body, randomUUID()),
      service.review(f.owner.id, f.work.id, { ...body, decision: 'reject' }, randomUUID())]);
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(row => row.status === 'rejected')).toHaveLength(1); expect(await f.count()).toBe(1);
  });
  it('rolls back review and audit together and lets the same key safely reconcile an unconfirmed failure', async () => {
    const f = await fixture(), body = await f.input(), key = randomUUID();
    const failing = new Proxy(db, { get(target, property) {
      if (property === '$transaction') return (action: (tx: Prisma.TransactionClient) => unknown, options: unknown) =>
        db.$transaction(tx => action(new Proxy(tx, { get(transaction, field) {
          if (field === 'auditEvent') return { create: () => { throw new Error('Synthetic audit outage'); } };
          const value = Reflect.get(transaction, field); return typeof value === 'function' ? value.bind(transaction) : value;
        } })) as Promise<unknown>, options as never);
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const unavailable = new StoryAuthorBodyReviewService(failing as never, new StoryArtistParticipantService(db as never, new ConfigService()));
    await expect(unavailable.review(f.owner.id, f.work.id, body, key)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(await f.count()).toBe(0);
    expect(await service.review(f.owner.id, f.work.id, body, key)).toMatchObject({ idempotentReplay: false, review: { version: 1 } });
  });
  it('validates exact ending path evidence and fails closed if absent, not using endingType as an ending key', async () => {
    const f = await fixture(), scene = await db.storyAiGeneratedScene.findUniqueOrThrow({ where: { id: f.progress.currentGeneratedSceneId! } });
    const beats = await db.storyAiGeneratedBeat.findMany({ where: { sceneId: scene.id }, orderBy: { position: 'asc' } });
    const endingKey = 'synthetic-ending';
    await db.storyAiGeneratedChoice.deleteMany({ where: { sceneId: scene.id } });
    await db.storyAiGeneratedScene.update({ where: { id: scene.id }, data: { endingType: 'ai_generated',
      resultChecksum: storyAiResultChecksum({ title: scene.title, beats, visualManifest: scene.visualManifest, nextChoices: [], ending: { endingKey } }) } });
    await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: { status: 'completed' } });
    expect(await f.current()).toMatchObject({ state: 'source_changed', target: null });
    await db.storyEndingDiscovery.create({ data: { userId: f.owner.id, workId: f.work.id, releaseId: f.release.id,
      endingKey, endingKind: 'ai_generated', provenance: 'ai_generated', pathSignature: bodyReviewHash(f.progress.pathSummary) } });
    expect((await f.current()).target?.ending).toBe(true);
    expect((await f.review()).review.applicability).toBe('current');
    expect(f.provider.generate).not.toHaveBeenCalled();
  });
});

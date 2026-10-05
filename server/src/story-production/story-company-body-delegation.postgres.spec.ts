import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { activationFixture } from './story-ai-activation.postgres-fixture';
import { StoryArtistParticipantService } from './story-artist-participant.service';
import { StoryAuthorBodyReviewService } from './story-author-body-review.service';
import { releaseChecksum } from './story-lifecycle.policy';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
jest.setTimeout(30000);
postgres('company body delegation (isolated PostgreSQL, no AI)', () => {
  let db: PrismaClient, service: StoryAuthorBodyReviewService;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
        parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash ||
        !/^\/lumina_failed_cost_qa_[a-f0-9]{12}$/.test(parsed.pathname)) throw new Error('Owned isolated database required');
    db = new PrismaClient({ datasources: { db: { url } } }); await db.$connect();
    service = new StoryAuthorBodyReviewService(db as never, new StoryArtistParticipantService(db as never, new ConfigService()));
  });
  afterAll(async () => { await db?.$disconnect(); });
  async function fixture(company = true) {
    const f = await activationFixture(db, false, false);
    f.release.checksum = releaseChecksum({ manuscriptVersionId: f.manuscript.id, branchGraphSnapshot: {},
      endingSetSnapshot: {}, sceneAssetManifest: {}, localizedDisplaySnapshot: {} });
    await db.storyRelease.update({ where: { id: f.release.id }, data: { checksum: f.release.checksum } });
    await db.storyWork.update({ where: { id: f.work.id }, data: { authorDisplayName: company ? '\uB8E8\uBBF8\uB098' : 'External', publishedAt: new Date() } });
    await db.auditEvent.create({ data: { actorType: 'admin', actorUserId: f.owner.id,
      action: 'story_upload.public_beta_published', targetType: 'story_work', targetId: f.work.id,
      afterData: { workId: f.work.id, releaseId: f.release.id } } });
    await f.activation.createActivation(f.owner.id, f.activationBody);
    await db.storyReaderProgress.update({ where: { id: f.progresses[0].id }, data: { userId: f.owner.id } });
    const origin = await f.generatePersonal();
    const current = () => service.current(f.owner.id, f.work.id, 'ko');
    const count = async () => Number((await db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT count(*) FROM story_author_body_reviews WHERE work_id = ${f.work.id}::uuid`))[0].count);
    const manual = async (decision: 'approve' | 'reject') => {
      const view = await current();
      if (!view.target) throw new Error('Synthetic target missing');
      return service.review(f.owner.id, f.work.id, { locale: 'ko', decision, styleReviewed: true,
        charactersReviewed: true, timelineReviewed: true, sourceBindingHash: view.target.sourceBindingHash,
        expectedProgressRevision: view.target.progressRevision, expectedReviewId: view.latestReview?.id ?? null }, randomUUID());
    };
    return { ...f, origin, current, count, manual, auto: () => service.autoApproveCompanyContinuation(origin.id) };
  }
  it('records delegated authority without claiming human review or changing paid/public data', async () => {
    const f = await fixture();
    const before = await db.storyAiContinuation.findUniqueOrThrow({ where: { id: f.origin.id } });
    const usage = await db.storyAiUsageLedger.findMany({ where: { continuationId: f.origin.id } });
    const progress = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progresses[0].id } });
    expect((await f.current()).latestReview).toBeNull(); expect(await f.count()).toBe(0);
    await (service as unknown as { recoverCompanyApprovals(): Promise<void> }).recoverCompanyApprovals();
    const row = await f.auto();
    expect(row).toMatchObject({ approvalBasis: 'company_delegation', decision: 'approve', applicability: 'current',
      styleReviewed: false, charactersReviewed: false, timelineReviewed: false });
    expect((await f.current()).latestReview).toEqual(row);
    expect(await db.storyAiContinuation.findUniqueOrThrow({ where: { id: f.origin.id } })).toEqual(before);
    expect(await db.storyReaderProgress.findUniqueOrThrow({ where: { id: progress.id } })).toEqual(progress);
    expect(await db.storyAiUsageLedger.findMany({ where: { continuationId: f.origin.id } })).toEqual(usage);
    expect(await db.storyAiReusableResult.count({ where: { workId: f.work.id } })).toBe(0);
    expect(f.provider.generate).not.toHaveBeenCalled();
    const audit = await db.auditEvent.findFirstOrThrow({ where: { targetId: row!.id, action: 'story.author_body_review.company_delegated' } });
    expect(audit).toMatchObject({ actorType: 'system', actorUserId: null, metadata: {
      approvalBasis: 'company_delegation', humanSemanticReview: false, publicationStarted: false, sharedReuseAuthorized: false } });
  });
  it('serializes concurrent automatic recovery into one immutable receipt', async () => {
    const f = await fixture(); const rows = await Promise.all([f.auto(), f.auto()]);
    expect(rows[0]!.id).toBe(rows[1]!.id); expect(await f.count()).toBe(1);
  });
  it.each(['approve', 'reject'] as const)('never supersedes a manual %s even after revision changes', async decision => {
    const f = await fixture(); await f.auto(); const manual = await f.manual(decision);
    await db.storyReaderProgress.update({ where: { id: f.progresses[0].id }, data: { progressRevision: { increment: 1 } } });
    expect(await f.auto()).toBeNull();
    expect((await f.current()).latestReview).toMatchObject({ id: manual.review.id, approvalBasis: 'human_review', applicability: 'stale' });
    expect(await f.count()).toBe(2);
  });
  it('never resurrects a withdrawn company approval', async () => {
    const f = await fixture(); const row = await f.auto();
    await service.withdraw(f.owner.id, f.work.id, row!.id, randomUUID());
    await db.storyReaderProgress.update({ where: { id: f.progresses[0].id }, data: { progressRevision: { increment: 1 } } });
    expect(await f.auto()).toBeNull(); expect(await f.count()).toBe(1);
    expect((await f.current()).latestReview?.applicability).toBe('withdrawn');
  });
  it('honors superseded human history rather than checking only the latest row', async () => {
    const f = await fixture(); const first = await f.auto(); await f.manual('reject');
    await db.$executeRaw(Prisma.sql`INSERT INTO story_author_body_reviews
      SELECT ${randomUUID()}::uuid, owner_user_id, work_id, release_id, progress_id, scene_id, continuation_id,
        locale, 3, source_binding_hash, binding_snapshot, request_hash, ${randomUUID()}, decision,
        style_reviewed, characters_reviewed, timeline_reviewed, created_at, approval_basis, delegation_snapshot
      FROM story_author_body_reviews WHERE id = ${first!.id}::uuid`);
    await db.storyReaderProgress.update({ where: { id: f.progresses[0].id }, data: { progressRevision: { increment: 1 } } });
    expect(await f.auto()).toBeNull(); expect(await f.count()).toBe(3);
  });
  it('requires a native receipt, not copied credit, and marks removed authority stale', async () => {
    const f = await fixture(); const row = await f.auto();
    await db.auditEvent.deleteMany({ where: { actorUserId: f.owner.id, action: 'story_upload.public_beta_published' } });
    expect(await f.auto()).toBeNull(); expect(await f.count()).toBe(1);
    expect((await f.current()).latestReview).toMatchObject({ id: row!.id, applicability: 'stale' });
  });
  it('excludes external authors and nonowner continuations', async () => {
    const f = await fixture(false); expect(await f.auto()).toBeNull(); expect(await f.count()).toBe(0);
    const company = await fixture();
    const readerRequest = await company.request(1);
    expect(await service.autoApproveCompanyContinuation(readerRequest.continuationId)).toBeNull();
  });
  it.each(['manuscript', 'consent', 'analysis', 'capability', 'body'])('rejects automatic approval when %s changed', async kind => {
    const f = await fixture();
    if (kind === 'manuscript') await db.storyManuscriptVersion.create({ data: { workId: f.work.id, ownerUserId: f.owner.id,
      version: 2, locale: 'ko', contentHash: 'd'.repeat(64), structuredBody: {} } });
    if (kind === 'consent') await db.storyStyleProfileConsent.update({ where: { id: f.consent.id }, data: { withdrawnAt: new Date() } });
    if (kind === 'analysis') await db.storyAnalysisJob.create({ data: { workId: f.work.id, manuscriptVersionId: f.manuscript.id,
      analysisVersion: 2, status: 'completed', idempotencyKey: randomUUID() } });
    if (kind === 'capability') await db.storyReleaseCapability.update({ where: { releaseId: f.release.id }, data: { revision: { increment: 1 } } });
    if (kind === 'body') await db.storyAiGeneratedBeat.updateMany({ where: { sceneId: f.origin.resultGeneratedSceneId! }, data: { content: { ko: 'Changed synthetic result.' } } });
    await expect(f.auto()).rejects.toThrow(); expect(await f.count()).toBe(0);
  });
  it('rejects forged human flags in a company receipt at database level', async () => {
    const f = await fixture(); const row = await f.auto();
    await expect(db.$executeRaw(Prisma.sql`INSERT INTO story_author_body_reviews
      SELECT ${randomUUID()}::uuid, owner_user_id, work_id, release_id, progress_id, scene_id, continuation_id,
        locale, version + 1, source_binding_hash, binding_snapshot, request_hash, ${randomUUID()}, decision,
        true, false, false, created_at, approval_basis, delegation_snapshot
      FROM story_author_body_reviews WHERE id = ${row!.id}::uuid`)).rejects.toMatchObject({ code: 'P2010', meta: { code: '23514' } });
    expect(await f.count()).toBe(1);
  });
});

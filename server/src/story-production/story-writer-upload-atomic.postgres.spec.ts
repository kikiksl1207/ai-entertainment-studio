import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { StoryProductionService } from './story-production.service';
import { SemanticAnalysisRepository } from './story-semantic-analysis.repository';
import { SemanticAnalysisService } from './story-semantic-analysis.service';
import { SemanticAnalysisProvider } from './story-semantic-analysis.provider';
import { semanticTestConfig } from './story-semantic-analysis.test-fixture';
import type { CreateManuscriptVersionDto } from './dto/story-production.dto';

const url = process.env.STORY_UPLOAD_ATOMIC_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
const databaseName = 'lumina_writer_upload_atomic_qa';

postgres('atomic writer upload and opted-in semantic queue (isolated PostgreSQL)', () => {
  let db: PrismaClient;
  let ownerId: string;
  let workId: string;
  let rateCardId: string;
  let rateCardVersion: string;
  const transport = jest.fn(async () => { throw new Error('Provider transport must not run during upload'); });

  function manuscript(text: string): CreateManuscriptVersionDto {
    return { locale: 'ko', parts: [{ partKey: 'part-1', title: 'Synthetic part',
      paragraphs: [{ kind: 'paragraph', text }] }] };
  }

  function service(enabled = true) {
    const config = semanticTestConfig({ enabled, autoEnqueueOnUpload: true, workerEnabled: true,
      rateCardId, rateCardVersion });
    const provider = new SemanticAnalysisProvider(config, transport);
    const analysis = new SemanticAnalysisService(new SemanticAnalysisRepository(db as never), provider, {} as never);
    return new StoryProductionService(db as never, undefined, undefined, undefined, analysis);
  }

  async function clearFixtures() {
    const [{ name }] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (name !== databaseName) throw new Error('Dedicated writer-upload QA database required for cleanup');
    await db.$transaction(async tx => {
      // The bypass is local to fixture cleanup; all test writes run with normal constraints and triggers.
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.$executeRaw`TRUNCATE TABLE story_analysis_jobs, story_branch_preparation_jobs,
        story_manuscript_versions, story_works, story_ai_rate_cards, users CASCADE`;
    }, { timeout: 30_000 });
  }

  async function removeFailureTrigger() {
    await db.$executeRaw`DROP TRIGGER IF EXISTS qa_fail_writer_upload_queue_create ON story_analysis_jobs`;
    await db.$executeRaw`DROP FUNCTION IF EXISTS qa_fail_writer_upload_queue_create()`;
  }

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
        parsed.username !== 'lumina_qa' || parsed.pathname !== `/${databaseName}` || parsed.search || parsed.hash) {
      throw new Error('Dedicated loopback writer-upload QA database required');
    }
    db = new PrismaClient({ datasources: { db: { url: url! } } });
    await db.$connect();
    await removeFailureTrigger();
    await clearFixtures();
  }, 35_000);

  beforeEach(async () => {
    ownerId = (await db.user.create({ data: {} })).id;
    workId = (await db.storyWork.create({ data: { ownerUserId: ownerId,
      slug: `writer-upload-${randomUUID()}`, title: { ko: 'Synthetic work' }, summary: {} } })).id;
    rateCardId = randomUUID();
    rateCardVersion = `offline-${rateCardId}`;
    const config = semanticTestConfig();
    await db.storyAiRateCard.create({ data: { id: rateCardId, version: rateCardVersion,
      provider: config.provider, model: config.model, status: 'active',
      inputCostPerMillion: config.inputKrwPerMillion,
      cachedInputCostPerMillion: config.cachedInputKrwPerMillion,
      outputCostPerMillion: config.outputKrwPerMillion, createdByUserId: ownerId } });
    transport.mockClear();
  });

  afterAll(async () => {
    if (db) {
      try { await removeFailureTrigger(); await clearFixtures(); }
      finally { await db.$disconnect(); }
    }
  }, 35_000);

  it('commits the manuscript and queued job, then reuses both for identical content', async () => {
    const upload = service();
    const body = manuscript('A synthetic scene opens the story.');
    const first = await upload.createManuscriptVersion(ownerId, workId, body);
    expect(first).toMatchObject({ idempotentReplay: false, analysisStarted: true,
      manuscript: { workId, version: 1, locale: 'ko' } });
    expect(first.analysisJobId).toEqual(expect.any(String));

    const saved = await db.storyManuscriptVersion.findUniqueOrThrow({ where: { id: first.manuscript.id } });
    const job = await db.storyAnalysisJob.findUniqueOrThrow({ where: { id: first.analysisJobId } });
    expect(saved.structuredBody).toMatchObject({ parts: body.parts });
    expect(job).toMatchObject({ workId, manuscriptVersionId: saved.id, actorUserId: ownerId,
      analysisVersion: 1, pipeline: 'semantic_extraction_v1', status: 'queued', phase: 'initializing',
      sourceContentHash: saved.contentHash, sourceLocale: 'ko', rateCardId });
    expect(await db.storyBranchPreparationJob.count({ where: { manuscriptVersionId: saved.id } })).toBe(1);

    const retry = await upload.createManuscriptVersion(ownerId, workId, body);
    expect(retry).toMatchObject({ idempotentReplay: true, analysisStarted: true,
      analysisJobId: job.id, manuscript: { id: saved.id, version: 1, contentHash: saved.contentHash } });
    expect(await db.storyManuscriptVersion.count({ where: { workId } })).toBe(1);
    expect(await db.storyAnalysisJob.count({ where: { workId } })).toBe(1);
    expect(await db.storyBranchPreparationJob.count({ where: { workId } })).toBe(1);
    await expect(upload.branchPreparationStatus(ownerId, saved.id)).resolves.toMatchObject({
      status: 'awaiting_analysis', partStatusSource: 'upload_intent_rows',
      parts: [{ partKey: 'part-1', status: 'awaiting_author_consent' }],
    });

    const next = await upload.createManuscriptVersion(ownerId, workId,
      manuscript('A revised synthetic scene opens the story.'));
    expect(next.manuscript.version).toBe(2);
    await expect(upload.branchPreparationStatus(ownerId, saved.id)).resolves.toMatchObject({
      status: 'superseded', version: 1, latestVersion: 2,
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('rolls the manuscript and branch preparation back when the queue insert fails', async () => {
    await db.$executeRaw`CREATE FUNCTION qa_fail_writer_upload_queue_create() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'qa_forced_queue_create_failure'; END; $$ LANGUAGE plpgsql`;
    await db.$executeRaw`CREATE TRIGGER qa_fail_writer_upload_queue_create BEFORE INSERT ON story_analysis_jobs
      FOR EACH ROW EXECUTE FUNCTION qa_fail_writer_upload_queue_create()`;
    try {
      await expect(service().createManuscriptVersion(ownerId, workId,
        manuscript('Synthetic content that must roll back.'))).rejects.toMatchObject({
        status: 503, response: { code: 'MANUSCRIPT_STORE_RETRY' },
      });
      expect(await db.storyManuscriptVersion.count({ where: { workId } })).toBe(0);
      expect(await db.storyBranchPreparationJob.count({ where: { workId } })).toBe(0);
      expect(await db.storyAnalysisJob.count({ where: { workId } })).toBe(0);
      expect(await db.storyWork.count({ where: { id: workId, ownerUserId: ownerId } })).toBe(1);
      expect(transport).not.toHaveBeenCalled();
    } finally {
      await removeFailureTrigger();
    }
  });

  it('stores a manuscript without a job when semantic analysis is disabled', async () => {
    const receipt = await service(false).createManuscriptVersion(ownerId, workId,
      manuscript('Synthetic upload while analysis is disabled.'));
    expect(receipt).toMatchObject({ idempotentReplay: false, analysisStarted: false,
      manuscript: { workId, version: 1 } });
    expect(receipt.analysisJobId).toBeUndefined();
    expect(await db.storyManuscriptVersion.count({ where: { workId } })).toBe(1);
    expect(await db.storyBranchPreparationJob.count({ where: { workId } })).toBe(1);
    expect(await db.storyAnalysisJob.count({ where: { workId } })).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  });

  it('lets a new writer create a private work and upload without activating analysis', async () => {
    const writer = service(false);
    const requestId = randomUUID();
    const draft = await writer.createDraft(ownerId, { requestId, title: '  New manuscript  ', locale: 'ko' });
    expect(draft.status).toBe('draft');
    expect(await writer.createDraft(ownerId, { requestId, title: 'New manuscript', locale: 'ko' }))
      .toEqual(draft);
    const work = await db.storyWork.findUniqueOrThrow({ where: { id: draft.workId } });
    expect(work).toMatchObject({ ownerUserId: ownerId, status: 'draft', activeReleaseId: null,
      title: { ko: 'New manuscript' } });
    const receipt = await writer.createManuscriptVersion(ownerId, draft.workId,
      manuscript('A new writer submits the first private part.'));
    expect(receipt).toMatchObject({ analysisStarted: false,
      manuscript: { workId: draft.workId, version: 1 } });
    expect(await db.storyAnalysisJob.count({ where: { workId: draft.workId } })).toBe(0);
    expect(await db.storyWork.count({ where: { id: draft.workId, status: 'published' } })).toBe(0);
  });
});

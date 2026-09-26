import 'reflect-metadata';
import { PrismaClient, type StoryAnalysisJob } from '@prisma/client';
import { randomUUID } from 'crypto';
import { SemanticAnalysisRepository } from './story-semantic-analysis.repository';
import { SemanticAnalysisService } from './story-semantic-analysis.service';
import { SemanticAnalysisProvider } from './story-semantic-analysis.provider';
import { StoryGenerationProfileService } from './story-generation-profile.service';
import { semanticTestConfig, semanticTestEnvelope, semanticTestOutput } from './story-semantic-analysis.test-fixture';
import { manuscriptContentHash } from './story-production.policy';
import { SEMANTIC_PACKING_PROFILE, semanticPinHash, semanticPins, semanticReservation, type SemanticConfig, type SemanticPins } from './story-semantic-analysis.config';
import type { SemanticInput } from './story-semantic-analysis.types';
import { nextSourceChunk, sourceParts } from './story-semantic-analysis.source';
import { preparePastedManuscript, storedManuscriptBody } from './story-manuscript-file.policy';

const url = process.env.STORY_ANALYSIS_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

postgres('Semantic analysis durable pipeline (isolated PostgreSQL, fake transport)', () => {
  let db: PrismaClient, left: PrismaClient, right: PrismaClient;
  let owner: string, stranger: string, workId: string, manuscriptId: string, cardId: string;
  let config: SemanticConfig;
  let a: SemanticAnalysisService, b: SemanticAnalysisService;
  let repoA: SemanticAnalysisRepository, repoB: SemanticAnalysisRepository;
  let profilesA: StoryGenerationProfileService;
  let transport: jest.Mock;

  function services(changes: Partial<SemanticConfig> = {}) {
    config = semanticTestConfig({ rateCardId: cardId, rateCardVersion: `offline-${cardId}`, ...changes });
    repoA = new SemanticAnalysisRepository(left as never);
    repoB = new SemanticAnalysisRepository(right as never);
    profilesA = new StoryGenerationProfileService(left as never);
    a = new SemanticAnalysisService(repoA, new SemanticAnalysisProvider(config, transport), profilesA);
    b = new SemanticAnalysisService(repoB, new SemanticAnalysisProvider(config, transport), new StoryGenerationProfileService(right as never));
  }
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' || parsed.pathname !== '/lumina_analysis_packing_qa')
      throw new Error('Dedicated semantic analysis QA database required');
    const client = () => new PrismaClient({ datasources: { db: { url: url! } } });
    db = client(); left = client(); right = client();
    await db.$connect(); await left.$connect(); await right.$connect();
    await clearFixtures();
  });
  beforeEach(async () => {
    owner = (await db.user.create({ data: {} })).id;
    stranger = (await db.user.create({ data: {} })).id;
    workId = (await db.storyWork.create({ data: { ownerUserId: owner, slug: `analysis-${randomUUID()}`, title: { ko: 'Synthetic analysis' }, summary: {} } })).id;
    const parts = [{ partKey: 'part-1', title: 'Synthetic part', paragraphs: Array.from({ length: 130 }, (_, i) => ({
      kind: 'paragraph', text: `Synthetic action ${i}. ${i === 0 ? '[entity:Mina] [foreshadow:watch]' : i === 129 ? '[payoff:watch]' : ''}`,
    })) }];
    manuscriptId = (await db.storyManuscriptVersion.create({ data: { workId, ownerUserId: owner, version: 1, locale: 'ko',
      contentHash: manuscriptContentHash({ parts }), structuredBody: { parts } } })).id;
    const pins = semanticTestConfig();
    cardId = randomUUID();
    await db.storyAiRateCard.create({ data: { id: cardId, version: `offline-${cardId}`, provider: pins.provider, model: pins.model,
      status: 'active', inputCostPerMillion: pins.inputKrwPerMillion, cachedInputCostPerMillion: pins.cachedInputKrwPerMillion,
      outputCostPerMillion: pins.outputKrwPerMillion, createdByUserId: owner } });
    transport = jest.fn().mockImplementation(async (_url, init) => {
      const input: SemanticInput = JSON.parse(JSON.parse(init.body).input[0].content[0].text);
      const output = semanticTestOutput(input);
      if (output.evidence.length) Object.assign(output.evidence[0], { kind: 'style', styleCategory: 'sentence_rhythm',
        title: 'Short action clauses', observation: 'The cited local action uses a short clause; this is a candidate rhythm observation.' });
      return new Response(JSON.stringify(semanticTestEnvelope(output)));
    });
    services();
  });
  async function clearFixtures() {
    const database = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (database[0]?.name !== 'lumina_analysis_packing_qa') throw new Error('Dedicated QA cleanup required');
    // Append-only history deliberately rejects DELETE. TRUNCATE is limited to
    // this dedicated disposable database and never changes production triggers.
    await db.$executeRaw`TRUNCATE TABLE story_continuity_decision_audits,
      story_continuity_issue_evidence, story_continuity_entry_evidence,
      story_continuity_path_states, story_continuity_issues, story_continuity_entries,
      story_analysis_evidence, story_analysis_chunks, story_analysis_jobs,
      story_manuscript_versions, story_works, story_ai_rate_cards, users CASCADE`;
  }
  afterEach(async () => {
    jest.restoreAllMocks();
    await clearFixtures();
  });
  afterAll(async () => { await left?.$disconnect(); await right?.$disconnect(); await db?.$disconnect(); });

  const enqueue = (service = a, key = randomUUID()) => service.enqueue(owner, manuscriptId, key);
  const row = (id: string) => db.storyAnalysisJob.findUniqueOrThrow({ where: { id } });
  async function until(id: string, predicate: (job: StoryAnalysisJob) => boolean, service = a) {
    for (let i = 0; i < 80; i++) {
      const current = await row(id);
      if (predicate(current)) return current;
      if (current.status === 'failed' || current.status === 'completed') throw new Error('Unexpected terminal analysis state');
      await service.executeOne('offline-worker');
    }
    throw new Error('Bounded test polling exhausted');
  }
  async function planned() {
    const job = await enqueue();
    await until(job.id, value => value.phase === 'extracting');
    expect(transport).not.toHaveBeenCalled();
    return job;
  }
  async function fence(id: string) {
    const claim = await repoA.claim();
    expect(claim?.id).toBe(id);
    const chunk = await db.storyAnalysisChunk.findFirstOrThrow({ where: { analysisJobId: id }, orderBy: { ordinal: 'asc' } });
    await repoA.leased(claim!, tx => tx.storyAnalysisChunk.update({ where: { id: chunk.id },
      data: { status: 'running', dispatchStartedAt: new Date() } }), false);
    return claim!;
  }
  async function expire(id: string) {
    await db.$executeRaw`UPDATE story_analysis_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=${id}::uuid`;
  }

  async function historicalJob(phase: 'initializing' | 'planning', pins = semanticPins({ ...config, packingProfile: undefined })) {
    const source = await db.storyManuscriptVersion.findUniqueOrThrow({ where: { id: manuscriptId } });
    const parts = sourceParts(source.structuredBody);
    const first = phase === 'planning' ? nextSourceChunk(parts, { part: 0, paragraph: 0, offset: 0 }, {
      manuscriptVersionId: source.id, contentHash: source.contentHash, locale: source.locale,
    }, pins)! : null;
    const job = await db.storyAnalysisJob.create({ data: { workId, manuscriptVersionId: source.id, actorUserId: owner,
      rateCardId: cardId, pipeline: 'semantic_extraction_v1', status: phase === 'planning' ? 'running' : 'queued', phase,
      sourceContentHash: source.contentHash, sourceLocale: source.locale,
      sourceDigest: phase === 'planning' ? manuscriptContentHash(source.structuredBody) : source.contentHash,
      configHash: semanticPinHash(pins), configPins: pins, analysisVersion: 1, idempotencyKey: randomUUID(),
      ...(first ? { totalParagraphs: 130, totalParts: 1, plannedParagraphs: first.completedParagraphs, plannedChunks: 1,
        planCursor: first.next, reservedInputTokens: first.inputTokens, reservedOutputTokens: pins.outputTokenLimit,
        reservedCostKrw: semanticReservation(pins, first.inputTokens, pins.outputTokenLimit, 1) } : {}),
    } });
    const chunk = first ? await db.storyAnalysisChunk.create({ data: { analysisJobId: job.id, ordinal: 0,
      sourceRefs: first.refs, sourceHash: first.sourceHash, paragraphCount: first.completedParagraphs,
      inputTokenBudget: first.inputTokens } }) : null;
    return { job, chunk };
  }

  it('has no disabled fallback job or provider call', async () => {
    services({ enabled: false });
    await expect(enqueue()).rejects.toMatchObject({ status: 503, response: { code: 'SEMANTIC_ANALYSIS_UNAVAILABLE' } });
    expect(await db.storyAnalysisJob.count({ where: { workId } })).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  });
  it.each(['same', 'different'])('reserves one version under concurrent %s keys across clients', async mode => {
    const key = randomUUID();
    const results = await Promise.allSettled([enqueue(a, key), enqueue(b, mode === 'same' ? key : randomUUID())]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(mode === 'same' ? 2 : 1);
    if (mode === 'different') expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason)
      .toMatchObject({ status: 409, response: { code: 'ANALYSIS_VERSION_ALREADY_RESERVED' } });
    expect(await db.storyAnalysisJob.count({ where: { workId } })).toBe(1);
    expect(transport).not.toHaveBeenCalled();
  });
  it('binds replay keys to actor/work/version and denies foreign source reads', async () => {
    const key = randomUUID();
    const job = await enqueue(a, key);
    expect((await enqueue(b, key)).id).toBe(job.id);
    await expect(b.enqueue(stranger, manuscriptId, key)).rejects.toMatchObject({ status: 404 });
    await expect(b.get(stranger, job.id)).rejects.toMatchObject({ status: 404 });
    const revised = { parts: [{ partKey: 'part-2', title: 'Changed', paragraphs: [{ kind: 'paragraph', text: 'Synthetic revised source.' }] }] };
    const next = await db.storyManuscriptVersion.create({ data: { workId, ownerUserId: owner, version: 2, locale: 'ko',
      contentHash: manuscriptContentHash(revised), structuredBody: revised } });
    await expect(b.enqueue(owner, next.id, key)).rejects.toMatchObject({ response: { code: 'ANALYSIS_IDEMPOTENCY_CONFLICT' } });
  });
  it('grants only one live lease across workers for the same queued job', async () => {
    const job = await enqueue();
    const claims = await Promise.all([repoA.claim(), repoB.claim()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)?.id).toBe(job.id);
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(['initializing', 'planning'] as const)('actually resumes a pre-profile %s job under the new worker without rewriting pins/chunks', async phase => {
    const { job, chunk } = await historicalJob(phase);
    const sourceBefore = await db.storyManuscriptVersion.findUniqueOrThrow({ where: { id: manuscriptId } });
    expect(config.packingProfile).toBe(SEMANTIC_PACKING_PROFILE);
    expect(job.configPins).not.toHaveProperty('packingProfile');
    const planned = await until(job.id, value => value.phase === 'extracting', b);
    expect(planned.errorCode).toBeNull();
    expect(planned.configPins).toEqual(job.configPins);
    expect(planned.configHash).toBe(job.configHash);
    const chunks = await db.storyAnalysisChunk.findMany({ where: { analysisJobId: job.id }, orderBy: { ordinal: 'asc' } });
    expect(chunks.map(value => value.paragraphCount)).toEqual([32, 32, 32, 32, 2]);
    expect(chunks.map(value => (value.sourceRefs as unknown[]).length)).toEqual([32, 32, 32, 32, 2]);
    if (chunk) expect(chunks[0]).toEqual(chunk);
    expect(await db.storyManuscriptVersion.findUniqueOrThrow({ where: { id: manuscriptId } })).toEqual(sourceBefore);
    expect(transport).not.toHaveBeenCalled();
    await b.executeOne('new-worker-extraction');
    expect(transport).toHaveBeenCalledTimes(1);
    const dispatched = JSON.parse(JSON.parse(transport.mock.calls[0][1].body).input[0].content[0].text) as SemanticInput;
    expect(dispatched.pieces).toHaveLength(32);
    expect(dispatched.pieces.map(piece => piece.paragraphIndex)).toEqual(Array.from({ length: 32 }, (_, i) => i));
    expect((await row(job.id)).completedParagraphs).toBe(32);
  });

  it('rejects changed non-planner config on legacy jobs instead of loosening all pin equality', async () => {
    const { job } = await historicalJob('planning');
    services({ maxJobCostKrw: '99999' });
    await b.executeOne('changed-worker');
    expect(await row(job.id)).toMatchObject({ status: 'failed', errorCode: 'analysis_configuration_changed',
      configPins: job.configPins, configHash: job.configHash });
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects a hash-consistent unknown job profile before planning or dispatch', async () => {
    const pins = { ...semanticPins(config), packingProfile: 'unsupported' } as unknown as SemanticPins;
    const { job } = await historicalJob('initializing', pins);
    await b.executeOne('new-worker');
    expect(await row(job.id)).toMatchObject({ status: 'failed', errorCode: 'analysis_packing_profile_unsupported', configPins: pins });
    expect(await db.storyAnalysisChunk.count({ where: { analysisJobId: job.id } })).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([3, 4])('validates paste identity v%i and preserves its own paragraph citation coordinates', async identityVersion => {
    const raw = 'Synthetic first\r\n\r\nSynthetic second\n';
    const input = preparePastedManuscript(Buffer.from(raw), JSON.stringify({ locale: 'ko', confirmed: true, parts: [
      { partKey: 'paste-part', title: 'Synthetic', start: 0, end: raw.length },
    ] }));
    const body = storedManuscriptBody(input);
    if (identityVersion === 3) body.parts[0].paragraphs = [
      { kind: 'paragraph', text: 'Synthetic first\r\n' }, { kind: 'paragraph', text: '\r\n' },
      { kind: 'paragraph', text: 'Synthetic second\n' },
    ];
    body.intake.identityVersion = identityVersion;
    const source = await db.storyManuscriptVersion.create({ data: { workId, ownerUserId: owner, version: 2, locale: 'ko',
      structuredBody: body, contentHash: manuscriptContentHash({ identityVersion, locale: 'ko', parts: body.parts, sourceSha256: input.source.sha256 }) } });
    const paragraphIndex = identityVersion === 3 ? 2 : 1;
    transport.mockImplementation(async (_url, init) => {
      const input: SemanticInput = JSON.parse(JSON.parse(init.body).input[0].content[0].text);
      const cited = input.pieces.find(piece => piece.paragraphIndex === paragraphIndex)!;
      return new Response(JSON.stringify(semanticTestEnvelope(semanticTestOutput({ ...input, pieces: [cited] }))));
    });
    const job = await a.enqueue(owner, source.id, randomUUID());
    await until(job.id, value => value.status === 'completed', b);
    const page = await b.get(owner, job.id);
    const candidate = page.evidence.find(value => value.provenance === 'semantic_candidate')!;
    const citation = await b.citation(owner, job.id, candidate.id);
    expect(citation.citations[0]).toMatchObject({ paragraphIndex, quote: 'Synthetic second\n' });
    expect(await db.storyManuscriptVersion.findUniqueOrThrow({ where: { id: source.id } })).toEqual(source);
  });

  it('does not treat an unrecognized intake identity as a legacy checksum', async () => {
    const parts = [{ partKey: 'future', title: 'Synthetic', paragraphs: [{ kind: 'paragraph', text: 'Synthetic source' }] }];
    const source = await db.storyManuscriptVersion.create({ data: { workId, ownerUserId: owner, version: 2, locale: 'ko',
      structuredBody: { parts, intake: { identityVersion: 5 } }, contentHash: manuscriptContentHash({ parts }) } });
    const job = await a.enqueue(owner, source.id, randomUUID());
    await b.executeOne('worker');
    expect(await row(job.id)).toMatchObject({ status: 'failed', errorCode: 'analysis_source_identity_unsupported' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('resumes local planning and completes with paged reviewable evidence, not approval', async () => {
    const job = await enqueue();
    await a.executeOne('initial-worker');
    expect((await row(job.id)).phase).toBe('planning');
    services();
    const completed = await until(job.id, value => value.status === 'completed', b);
    expect(completed.completedParagraphs).toBe(130);
    expect(completed.completedChunks).toBe(completed.plannedChunks);
    expect(transport).toHaveBeenCalledTimes(completed.plannedChunks);
    const page = await b.get(owner, job.id);
    expect(page).toMatchObject({ hasMore: true, review: { fullyReviewed: false, publicationApproved: false, memoryApproved: false },
      job: { semanticCompleted: true, progress: { coverageComplete: true } } });
    const next = await b.get(owner, job.id, page.nextCursor!);
    expect(next.hasMore).toBe(false);
    const all = [...page.evidence, ...next.evidence];
    expect(new Set(all.map(item => item.id)).size).toBe(all.length);
    expect(all.length).toBe((completed.result as { evidenceCount: number }).evidenceCount);
    const candidate = all.find(item => item.provenance === 'semantic_candidate')!;
    expect(candidate).toMatchObject({ title: 'Short action clauses', observation: expect.any(String), interpretation: 'model_inference', reviewRequired: true });
    const quoted = await b.citation(owner, job.id, candidate.id);
    expect(quoted.citations[0].quote.length).toBeGreaterThan(0);
    await expect(b.citation(stranger, job.id, candidate.id)).rejects.toMatchObject({ status: 404 });
    expect(await db.storyContinuityEntry.count({ where: { analysisJobId: job.id } })).toBe(3);
    expect(await db.storyContinuityIssue.count({ where: { analysisJobId: job.id } })).toBe(0);
    expect(await db.storyMemoryRecord.count({ where: { workId } })).toBe(0);
    const profiles = await db.storyWorkGenerationProfile.findMany({ where: { workId } });
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ manuscriptVersionId: manuscriptId, analysisJobId: job.id,
      status: 'needs_review', approvedAt: null, approvedFingerprint: null });
    await b.executeOne('replay-worker');
    expect(await db.storyWorkGenerationProfile.count({ where: { workId } })).toBe(1);
    expect(JSON.stringify(page)).not.toMatch(/apiKey|offline-synthetic-test-key|structuredBody|providerPayload/);
  });
  it('rolls back completion when the draft write fails, then retries without a duplicate', async () => {
    const job = await enqueue();
    await until(job.id, value => value.phase === 'finalizing');
    jest.spyOn(profilesA, 'createDraftAtCompletion').mockRejectedValueOnce(new Error('temporary draft failure'));

    expect(await a.executeOne('draft-retry-worker')).toEqual({ status: 'retry_wait' });
    expect(await row(job.id)).toMatchObject({ status: 'running', phase: 'finalizing' });
    expect(await db.storyWorkGenerationProfile.count({ where: { workId } })).toBe(0);
    expect(await b.executeOne('draft-success-worker')).toEqual({ status: 'processed' });
    expect(await row(job.id)).toMatchObject({ status: 'completed', phase: 'completed' });
    expect(await db.storyWorkGenerationProfile.count({ where: { workId, status: 'needs_review' } })).toBe(1);
  });
  it.each([
    { maxJobInputTokens: 8192 }, { maxJobOutputTokens: 2048 }, { maxJobCostKrw: '0.01' },
  ])('rejects a whole book over its aggregate bound before the first dispatch', async bound => {
    services(bound);
    const parts = [{ partKey: 'large', title: 'Synthetic larger source', paragraphs: Array.from({ length: 1000 }, (_, i) => ({
      kind: 'paragraph', text: `Synthetic action ${i}.`,
    })) }];
    manuscriptId = (await db.storyManuscriptVersion.create({ data: { workId, ownerUserId: owner, version: 2, locale: 'ko',
      structuredBody: { parts }, contentHash: manuscriptContentHash({ parts }) } })).id;
    const job = await enqueue();
    const failed = await until(job.id, value => value.status === 'failed');
    expect(failed.errorCode).toBe('analysis_aggregate_budget_exceeded');
    expect(transport).not.toHaveBeenCalled();
    expect(await db.storyAnalysisChunk.count({ where: { analysisJobId: job.id, dispatchStartedAt: { not: null } } })).toBe(0);
    expect((await a.get(owner, job.id)).job).toMatchObject({ semanticCompleted: false, errorCode: 'analysis_aggregate_budget_exceeded' });
  });
  it('checks current pinned rate card again before dispatch', async () => {
    const job = await planned();
    await db.storyAiRateCard.update({ where: { id: cardId }, data: { status: 'retired', retiredAt: new Date() } });
    await a.executeOne('worker');
    expect((await row(job.id)).errorCode).toBe('analysis_rate_card_mismatch');
    expect(transport).not.toHaveBeenCalled();
  });
  it('recovers an expired dispatched lease as unknown without regenerating or releasing reservation', async () => {
    const job = await planned();
    const before = await row(job.id);
    const oldClaim = await fence(job.id);
    await expire(job.id);
    await b.executeOne('replacement-worker');
    const failed = await row(job.id);
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'provider_outcome_unknown', actualCostKrw: null });
    expect(failed.reservedCostKrw.equals(before.reservedCostKrw)).toBe(true);
    await expect(repoA.leased(oldClaim, async () => undefined)).rejects.toMatchObject({ code: 'analysis_lease_lost' });
    await b.executeOne('next-poll');
    expect(transport).not.toHaveBeenCalled();
    await expect(enqueue(b)).rejects.toMatchObject({ response: { code: 'ANALYSIS_VERSION_ALREADY_RESERVED' } });
  });
  it('recovers dispatch before checking changed config pins', async () => {
    const job = await planned();
    await fence(job.id); await expire(job.id);
    services({ maxJobCostKrw: '99999' });
    await b.executeOne('changed-config-worker');
    expect((await row(job.id)).errorCode).toBe('provider_outcome_unknown');
    expect(transport).not.toHaveBeenCalled();
  });
  it('keeps a durable fence if successful generation and subsequent failure persistence both fail', async () => {
    const job = await planned();
    const actual = repoA.leased.bind(repoA);
    jest.spyOn(repoA, 'leased').mockImplementation((claimed, run, release) => {
      if (release !== false) return Promise.reject(new Error('synthetic DB failure'));
      return actual(claimed, run, release);
    });
    await a.executeOne('crashing-worker');
    expect(transport).toHaveBeenCalledTimes(1);
    expect((await row(job.id)).status).toBe('running');
    await expire(job.id);
    await b.executeOne('recovery-worker');
    expect((await row(job.id))).toMatchObject({ status: 'failed', errorCode: 'provider_outcome_unknown', actualCostKrw: null });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('requeues proven cancellation before transport even if the local fence was already written', async () => {
    const job = await planned();
    const signal = new AbortController();
    const actual = repoA.leased.bind(repoA);
    jest.spyOn(repoA, 'leased').mockImplementation(async (claimed, run, release) => {
      const result = await actual(claimed, run, release);
      if (release === false) signal.abort();
      return result;
    });
    await a.executeOne('cancelling-worker', signal.signal);
    expect(transport).not.toHaveBeenCalled();
    expect((await row(job.id)).status).toBe('running');
    expect(await db.storyAnalysisChunk.count({ where: { analysisJobId: job.id, dispatchStartedAt: { not: null } } })).toBe(0);
    await b.executeOne('replacement-worker');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('never auto-retries a received 429 or claims unknown usage costs zero', async () => {
    const job = await planned();
    transport.mockImplementation(async () => new Response('not logged', { status: 429 }));
    await a.executeOne('worker'); await b.executeOne('next-worker');
    expect(transport).toHaveBeenCalledTimes(1);
    expect((await row(job.id))).toMatchObject({ status: 'failed', errorCode: 'provider_rate_limited', actualCostKrw: null });
  });
  it('rejects source rewrites and owner/work pin substitution at the database boundary', async () => {
    const job = await enqueue();
    await expect(db.storyManuscriptVersion.update({ where: { id: manuscriptId }, data: { locale: 'en' } })).rejects.toThrow();
    await expect(db.storyAnalysisJob.update({ where: { id: job.id }, data: { actorUserId: stranger } })).rejects.toThrow();
    await expect(db.storyAnalysisJob.create({ data: { workId, manuscriptVersionId: manuscriptId, actorUserId: stranger,
      analysisVersion: 999, idempotencyKey: randomUUID() } })).rejects.toThrow();
  });
  it('the dispatch trigger fails closed when a manually inserted job lacks budget pins', async () => {
    const source = await db.storyManuscriptVersion.findUniqueOrThrow({ where: { id: manuscriptId } });
    const job = await db.storyAnalysisJob.create({ data: { workId, manuscriptVersionId: manuscriptId, actorUserId: owner,
      rateCardId: cardId, pipeline: 'semantic_extraction_v1', status: 'running', phase: 'extracting',
      sourceContentHash: source.contentHash, sourceLocale: source.locale, sourceDigest: source.contentHash, configHash: 'a'.repeat(64),
      configPins: {}, analysisVersion: 1, idempotencyKey: randomUUID(), totalParagraphs: 1, plannedParagraphs: 1,
      plannedChunks: 1, reservedInputTokens: 1, reservedOutputTokens: 1, reservedCostKrw: 1,
      leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60000) } });
    const chunk = await db.storyAnalysisChunk.create({ data: { analysisJobId: job.id, ordinal: 0, sourceRefs: [],
      sourceHash: 'b'.repeat(64), paragraphCount: 1, inputTokenBudget: 1 } });
    await expect(db.storyAnalysisChunk.update({ where: { id: chunk.id }, data: { dispatchStartedAt: new Date(), status: 'running' } }))
      .rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});

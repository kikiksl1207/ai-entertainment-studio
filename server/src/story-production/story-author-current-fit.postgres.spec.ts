import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { CREATOR_GENERATION_PROFILE_SCHEMA, STORY_PROFILE_SECTION_KEYS, creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile, stableJson } from '../generation-profile/creator-generation-profile.policy';
import { StoryAuthorCurrentFitService } from './story-author-current-fit.service';
import * as inspector from './story-continuation-fixed-cap-fit';
import { prepareStoryContinuationOpenAiRequestForDiagnostics } from './story-continuation-openai.prompt';
import { storyContinuationInputTokenBudget } from './story-continuation-tokenizer';
import { createStoryRouteRoot } from './story-route-identity.store';
import { SEMANTIC_PIPELINE } from './story-semantic-analysis.types';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
const hash = (value: unknown) => createHash('sha256').update(stableJson(value)).digest('hex');
const PRIVATE = 'SYNTHETIC_CURRENT_FIT_PRIVATE';
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const localized = (value: string) => Object.fromEntries(locales.map(locale => [locale, value]));
jest.setTimeout(30000);

// Real persistence and isolation, but synthetic source/approval metadata, never an AI receipt.
postgres('current-fit on owned PostgreSQL, SDK174 (synthetic only)', () => {
  let db: PrismaClient;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
      parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash ||
      !/^\/lumina_body_length_qa_[a-f0-9]{12}$/.test(parsed.pathname)) throw new Error('Owned current-fit QA database required');
    db = new PrismaClient({ datasources: { db: { url } } }); await db.$connect();
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await db?.$disconnect(); });

  async function fixture(afterWorkRead?: () => Promise<void>) {
    const owner = await db.user.create({ data: {} });
    const work = await db.storyWork.create({ data: { ownerUserId: owner.id, slug: 'current-fit-' + randomUUID(),
      status: 'draft', defaultLocale: 'ko', supportedLocales: locales, title: localized(PRIVATE), summary: {} } });
    const structuredBody = { parts: [{ paragraphs: [PRIVATE] }] };
    const manuscript = await db.storyManuscriptVersion.create({ data: { workId: work.id, ownerUserId: owner.id,
      version: 1, locale: 'ko', contentHash: hash(structuredBody), structuredBody } });
    const rate = await db.storyAiRateCard.create({ data: { version: 'current-fit-fk-' + randomUUID(), status: 'active',
      provider: 'openai', model: 'gpt-5.4-mini-2026-03-17', inputCostPerMillion: 0, outputCostPerMillion: 0,
      createdByUserId: owner.id } });
    const analysis = await db.storyAnalysisJob.create({ data: { workId: work.id, manuscriptVersionId: manuscript.id,
      analysisVersion: 1, idempotencyKey: randomUUID(), pipeline: SEMANTIC_PIPELINE, status: 'completed',
      actorUserId: owner.id, sourceContentHash: manuscript.contentHash, sourceLocale: 'ko', sourceDigest: manuscript.contentHash,
      configHash: hash({ synthetic: true }), configPins: {}, rateCardId: rate.id, phase: 'completed', completedAt: new Date() } });
    const sourceFingerprint = hash({ workId: work.id, manuscriptVersionId: manuscript.id, contentHash: manuscript.contentHash,
      analysisJobId: analysis.id, analysisVersion: analysis.analysisVersion, analysisConfigHash: analysis.configHash });
    const settings = normalizeCreatorGenerationProfile('story', { schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
      sections: STORY_PROFILE_SECTION_KEYS.map(key => ({ key, decision: 'accepted', evidence: [], value: key === 'writing_style'
        ? { summary: PRIVATE, customConstraint: 'generic full style', observations: [
          { title: 'head', detail: 'head intact' }, { title: 'middle', detail: 'middle intact' },
          { title: 'tail', detail: 'tail intact' }], categories: [{ category: 'rhythm', observations: ['head category', 'tail category'] }] }
        : { summary: 'approved ' + key } })) });
    const profile = await db.storyWorkGenerationProfile.create({ data: { workId: work.id, ownerUserId: owner.id,
      manuscriptVersionId: manuscript.id, analysisJobId: analysis.id, sourceFingerprint, profileVersion: 1, reviewRevision: 1,
      status: 'approved', draftSettings: settings as unknown as Prisma.InputJsonValue,
      approvedSettings: settings as unknown as Prisma.InputJsonValue,
      approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings), approvedByUserId: owner.id, approvedAt: new Date() } });
    const part = await db.storyPart.create({ data: { workId: work.id, position: 1, title: localized(PRIVATE), status: 'published' } });
    const scene = await db.storyScene.create({ data: { partId: part.id, sceneKey: 'synthetic-main', position: 1,
      title: localized(PRIVATE), status: 'published' } });
    await db.storyBeat.create({ data: { sceneId: scene.id, position: 1, beatType: 'paragraph', content: localized('a'.repeat(5200)) } });
    const choice = await db.storyChoice.create({ data: { sceneId: scene.id, choiceKey: 'synthetic-choice', position: 1,
      label: localized(PRIVATE), routeKind: 'generation_required' } });
    const release = await db.storyRelease.create({ data: { workId: work.id, version: 1, status: 'active', manuscriptVersionId: manuscript.id,
      checksum: hash({ syntheticRelease: work.id }), branchGraphSnapshot: {}, endingSetSnapshot: {}, sceneAssetManifest: {},
      localizedDisplaySnapshot: {}, createdByUserId: owner.id } });
    await db.storyWork.update({ where: { id: work.id }, data: { status: 'published', activeReleaseId: release.id, publishedVersion: 1 } });
    await db.storyReleaseCapability.create({ data: { workId: work.id, releaseId: release.id, rateCardId: rate.id,
      status: 'active', revision: 2, aiInputTokenLimit: 32768, aiOutputTokenLimit: 8192, updatedByUserId: owner.id } });
    const progress = await db.storyReaderProgress.create({ data: { userId: owner.id, workId: work.id, currentSceneId: scene.id,
      currentBeatPosition: 1, activeReleaseId: release.id, storyVersion: 1, progressRevision: 52, aiRateCardId: rate.id, capabilityRevision: 2 } });
    await db.$transaction(async tx => {
      const routeNodeId = await createStoryRouteRoot(tx, progress, scene.id, 1);
      await tx.storyReaderProgress.update({ where: { id: progress.id }, data: { routeNodeId } });
    });
    for (const row of [{ memoryType: 'style', partKey: null }, { memoryType: 'foreshadow', partKey: 'synthetic' },
      { memoryType: 'event', partKey: 'unreached-future' }]) await db.storyMemoryRecord.create({ data: {
      workId: work.id, manuscriptVersionId: manuscript.id, analysisJobId: analysis.id, memoryKey: randomUUID(),
      ...row, content: localized(PRIVATE), provenance: 'writer_original', status: 'approved' } });
    const modes: Array<{ readOnly: string; isolation: string }> = [];
    const writes: string[] = [], lockingQueries: string[] = [];
    const failures: Array<{ code: string; kind: string; lastRead: string; elapsedMs: number }> = [];
    let lastRead = 'transaction';
    const txCount = jest.fn();
    const rawReadCount = jest.fn();
    const facade = { $transaction: async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: any) => {
      txCount(); expect(options).toEqual({ isolationLevel: 'RepeatableRead' });
      const started = Date.now();
      try { return await db.$transaction(async tx => {
        let invoked = false;
        const observed = new Proxy(tx, { get(target, key) {
          if (key === '$executeRaw') return async (sql: Prisma.Sql) => {
            expect(sql.strings.join('')).toBe('SET TRANSACTION READ ONLY'); expect(sql.values).toEqual([]);
            const result = await target.$executeRaw(sql);
            const ro = await target.$queryRaw<Array<{ transaction_read_only: string }>>`SHOW transaction_read_only`;
            const rr = await target.$queryRaw<Array<{ transaction_isolation: string }>>`SHOW transaction_isolation`;
            modes.push({ readOnly: ro[0].transaction_read_only, isolation: rr[0].transaction_isolation }); return result;
          };
          if (key === '$queryRaw') return async (strings: TemplateStringsArray, ...values: unknown[]) => {
            rawReadCount();
            lastRead = '$queryRaw';
            const sql = strings.join('');
            if (/FOR\s+(?:UPDATE|SHARE|KEY|NO)/i.test(sql)) { lockingQueries.push('row_lock'); throw new Error('Row lock prohibited'); }
            return (target.$queryRaw as any)(strings, ...values);
          };
          const delegate = Reflect.get(target, key);
          if (typeof key === 'string' && key.startsWith('story') && delegate && typeof delegate === 'object') {
            return new Proxy(delegate, { get(model, method) {
              const original = Reflect.get(model, method);
              if (typeof method === 'string' && ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'].includes(method)) {
                return () => { writes.push(key + '.' + method); throw new Error('Domain write prohibited'); };
              }
              if (key === 'storyWork' && method === 'findFirst') return async (...args: unknown[]) => {
                lastRead = key + '.' + method;
                const result = await original.apply(model, args);
                if (!invoked && afterWorkRead) { invoked = true; await afterWorkRead(); }
                return result;
              };
              return typeof original === 'function' ? (...args: unknown[]) => {
                lastRead = key + '.' + String(method); return original.apply(model, args);
              } : original;
            } });
          }
          return typeof delegate === 'function' ? delegate.bind(target) : delegate;
        } });
        return callback(observed);
      }, options); } catch (error) {
        const detail = error as { code?: string; constructor?: { name?: string } };
        failures.push({ code: /^P\d{4}$/.test(detail.code || '') ? detail.code! : 'unknown',
          kind: ['Error', 'TypeError', 'RangeError', 'PrismaClientKnownRequestError', 'PrismaClientValidationError',
            'PrismaClientUnknownRequestError'].includes(detail.constructor?.name || '') ? detail.constructor!.name! : 'unknown',
          lastRead, elapsedMs: Date.now() - started });
        throw error;
      }
    } };
    const service = new StoryAuthorCurrentFitService(facade as never);
    const inspectSpy = jest.spyOn(inspector, 'inspectStoryContinuationFixedCapFit');
    const read = async (revision = 52, locale = 'ko') => {
      try { return await service.inspect(owner.id, work.id,
        { locale, choiceId: choice.id, expectedProgressRevision: revision }); }
      catch (error) {
        if (failures.length) throw new Error('SYNTHETIC_NATIVE_BOUNDARY ' + JSON.stringify(failures));
        throw error;
      }
    };
    return { owner, work, manuscript, analysis, profile, progress, choice, scene, release, service, read,
      inspectSpy, modes, writes, lockingQueries, txCount, rawReadCount };
  }

  async function snapshot() {
    const names = ['user', 'storyWork', 'storyManuscriptVersion', 'storyAnalysisJob', 'storyWorkGenerationProfile',
      'storyPart', 'storyScene', 'storyBeat', 'storyChoice', 'storyRelease', 'storyReleaseCapability', 'storyAiRateCard',
      'storyReaderProgress', 'storyProgressRouteNode', 'storyMemoryRecord', 'storyProgressArtistParticipant',
      'storyAiContinuation', 'storyAiUsageLedger', 'storyAiAllowanceBucket', 'storyAiReusableResult',
      'storyAuthorBodyTrialApproval', 'storyAuthorBodyTrialCommand', 'storyAuthorBodyReview', 'auditEvent'];
    return Object.fromEntries(await Promise.all(names.map(async name => [name,
      await (db as any)[name].findMany({ orderBy: name === 'storyAuthorBodyTrialCommand'
        ? [{ userId: 'asc' }, { idempotencyKey: 'asc' }] : { id: 'asc' } })])));
  }
  function assertModes(f: Awaited<ReturnType<typeof fixture>>, count = 1) {
    expect(f.txCount).toHaveBeenCalledTimes(count);
    expect(f.modes).toEqual(Array.from({ length: count }, () => ({ readOnly: 'on', isolation: 'repeatable read' })));
    expect(f.writes).toEqual([]); expect(f.lockingQueries).toEqual([]);
  }

  it('CURRENT-FIT-PG: complete source/profile/builder/tokenizer on one real RO/RR snapshot leaves affected rows unchanged', async () => {
    const f = await fixture(), before = await snapshot();
    const result = await f.read();
    expect(result).toMatchObject({ outcome: 'request_checked', currentSourceState: 'validated', progressRevision: 52,
      approvalReferenceVerified: true, legalAuthorization: 'not_evaluated', paidApproval: 'not_evaluated',
      diagnostic: { inputFit: 'within_policy_bound', outputFit: 'unmeasured', writingStylePresent: true } });
    const [input, config] = f.inspectSpy.mock.calls[0];
    const prepared = prepareStoryContinuationOpenAiRequestForDiagnostics(input, config);
    expect(result.diagnostic!.inputTokenBudget).toBe(storyContinuationInputTokenBudget(prepared));
    const projected = JSON.parse(prepared.input[0].content[0].text);
    expect(projected.sourceScene.beats[0].content).toBe('a'.repeat(5200));
    expect(projected.generationProfile.sections).toHaveLength(8);
    expect(projected.generationProfile.sections.find((row: any) => row.key === 'writing_style').value.observations
      .map((row: any) => row.detail)).toEqual(['head intact', 'middle intact', 'tail intact']);
    expect(projected.memories.some((row: any) => row.memoryType === 'author_plan_foreshadow')).toBe(true);
    expect(projected.memories.some((row: any) => row.memoryType === 'author_plan_event')).toBe(true);
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
    expect(JSON.stringify(result)).not.toContain(f.work.id);
    expect(await snapshot()).toEqual(before); assertModes(f);
  });

  it('CURRENT-FIT-PG: new pending latest profile cannot fall back to older approval', async () => {
    const f = await fixture();
    await db.storyWorkGenerationProfile.create({ data: { workId: f.work.id, ownerUserId: f.owner.id,
      manuscriptVersionId: f.manuscript.id, analysisJobId: f.analysis.id, sourceFingerprint: f.profile.sourceFingerprint,
      profileVersion: 2, reviewRevision: 1, status: 'needs_review', draftSettings: f.profile.draftSettings as Prisma.InputJsonValue } });
    const before = await snapshot();
    expect(await f.read()).toMatchObject({ reason: 'approval_unavailable', diagnostic: null });
    expect(f.inspectSpy).not.toHaveBeenCalled(); expect(await snapshot()).toEqual(before); assertModes(f);
  });

  it('CURRENT-FIT-PG: malformed retained JSON reference is ordinary unavailable before typed UUID query', async () => {
    const f = await fixture();
    await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: {
      pathSummary: [{ sceneId: f.scene.id, choiceId: 'not-a-uuid', nextSceneId: f.scene.id }],
    } });
    const before = await snapshot();
    expect(await f.read()).toMatchObject({ reason: 'context_unavailable', diagnostic: null });
    expect(f.inspectSpy).not.toHaveBeenCalled(); expect(f.rawReadCount).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before); assertModes(f);
  });

  it('CURRENT-FIT-PG: concurrent external revision write is not mixed into an established RR snapshot', async () => {
    let progressId: string;
    const f = await fixture(async () => {
      await db.storyReaderProgress.update({ where: { id: progressId }, data: { progressRevision: 53 } });
    });
    progressId = f.progress.id;
    expect(await f.read()).toMatchObject({ outcome: 'request_checked', progressRevision: 52 });
    expect(await f.read()).toMatchObject({ reason: 'progress_changed', diagnostic: null });
    expect(f.inspectSpy).toHaveBeenCalledTimes(1); assertModes(f, 2);
    expect((await db.storyReaderProgress.findUnique({ where: { id: progressId } }))!.progressRevision).toBe(53);
  });

  it('CURRENT-FIT-PG: PostgreSQL rejects row-lock and write in READ ONLY, independently of synthetic method guards', async () => {
    const f = await fixture();
    const before = await snapshot();
    await expect(db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$queryRaw`SELECT id FROM story_works WHERE id=${f.work.id}::uuid FOR SHARE`;
    }, { isolationLevel: 'RepeatableRead' })).rejects.toMatchObject({ code: 'P2010', meta: { code: '25006' } });
    await expect(db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`UPDATE story_reader_progress SET progress_revision=99 WHERE id=${f.progress.id}::uuid`;
    }, { isolationLevel: 'RepeatableRead' })).rejects.toMatchObject({ code: 'P2010', meta: { code: '25006' } });
    expect(await snapshot()).toEqual(before);
  });
});

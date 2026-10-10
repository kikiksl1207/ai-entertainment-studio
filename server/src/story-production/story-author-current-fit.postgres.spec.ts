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

  // CURRENT-FIT-GENERATED-PG: persisted synthetic metadata, not AI output, human review or authorization.
  const GENERATED_PRIVATE = 'CURRENT-FIT-GENERATED-PG_PRIVATE_SYNTHETIC';
  async function generatedFixture() {
    const f = await fixture();
    const { appendStoryRoute, storyRouteStepForContinuation } = await import('./story-route-identity.store');
    const { storyAiResultChecksum } = await import('./story-ai-result-checksum');
    const { STORY_CONTINUATION_PROMPT_VERSION, STORY_CONTINUATION_SCHEMA_VERSION } = await import('./story-continuation-openai.schema');
    const progress = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progress.id } });
    const root = await db.storyProgressRouteNode.findUniqueOrThrow({ where: { id: progress.routeNodeId! } });
    const tail = await db.storyScene.create({ data: { partId: f.scene.partId, position: 2,
      sceneKey: 'synthetic-authored-tail', title: localized(PRIVATE), status: 'published' } });
    await db.storyBeat.createMany({ data: [
      { sceneId: tail.id, position: 1, beatType: 'dialogue', content: localized(' \n' + 'b'.repeat(834) + '\t ') },
      { sceneId: tail.id, position: 2, beatType: 'scene_break', content: localized('excluded divider') },
    ] });
    const consent = await db.storyStyleProfileConsent.create({ data: { workId: f.work.id, ownerUserId: f.owner.id,
      manuscriptVersionId: f.manuscript.id, rightsConfirmed: false, aiBranchAllowed: false,
      startsAt: new Date(0), publicClaim: 'synthetic_fixture_not_authorization' } });
    const contract = await db.contentRightsContract.create({ data: {
      workType: 'story', workId: f.work.id, createdByUserId: f.owner.id } });
    const rights = await db.contentRightsContractVersion.create({ data: {
      contractId: contract.id, revision: 1, contentVersionId: f.manuscript.id, exclusivity: 'nonexclusive',
      media: ['story_publication'], regions: ['KR'], startsAt: new Date(0), effectiveFrom: new Date(0),
      saleAllowed: false, aiTransformationAllowed: false, generatedResultReuseAllowed: false, approvalState: 'draft',
      authorRightsHolderShareBps: 4500, salesAgencyShareBps: 0, companyShareBps: 5500,
      pointUsagePolicy: 'unresolved', refundReversalPolicy: 'unresolved', paidPointPolicy: 'unresolved',
      bonusPointPolicy: 'unresolved', vatPolicy: 'unresolved',
      internalGenerationCostTreatment: 'company_internal_cost_not_deducted_from_creator_share', createdByUserId: f.owner.id,
    } });
    const generationProfilePin = { id: f.profile.id, profileVersion: f.profile.profileVersion,
      reviewRevision: f.profile.reviewRevision, sourceFingerprint: f.profile.sourceFingerprint,
      approvedFingerprint: f.profile.approvedFingerprint! };
    const beats = [
      { beatType: 'paragraph', content: GENERATED_PRIVATE + ' head ' + 'g'.repeat(1700) },
      { beatType: 'dialogue', content: GENERATED_PRIVATE + ' middle ' + 'm'.repeat(1700) },
      { beatType: 'paragraph', content: GENERATED_PRIVATE + ' tail ' + 't'.repeat(1700) },
    ];
    async function createSource() {
      const origin = await db.storyAiContinuation.create({ data: {
        userId: f.owner.id, workId: f.work.id, releaseId: f.release.id, progressId: progress.id,
        requestKind: 'recommended_choice', recommendedChoiceId: f.choice.id, sourceSceneId: f.scene.id,
        sourcePartId: f.scene.partId, sourceProgressRevision: progress.progressRevision,
        sourceRouteNodeId: root.id, sourceRouteHash: root.routeHash,
        manuscriptVersionId: f.manuscript.id, analysisJobId: f.analysis.id, analysisVersion: f.analysis.analysisVersion,
        rightsContractId: contract.id, rightsContractVersionId: rights.id, releaseChecksum: f.release.checksum,
        rateCardId: progress.aiRateCardId!, styleConsentId: consent.id, styleConsentRevision: consent.revision,
        capabilityRevision: progress.capabilityRevision!, idempotencyKey: randomUUID(), locale: 'ko',
        contextFingerprint: hash({ synthetic: GENERATED_PRIVATE, generationProfilePin }),
        promptVersion: STORY_CONTINUATION_PROMPT_VERSION, outputSchemaVersion: STORY_CONTINUATION_SCHEMA_VERSION,
        contextReferences: { sourceKind: 'synthetic_generated_fixture', review: 'synthetic_not_human_approval',
          generationProfilePin, fullManuscriptIncluded: false, providerPayloadIncluded: false },
        status: 'completed', completedAt: new Date(), estimatedCostKrw: 0, hardBudgetKrw: 0,
        inputTokenLimit: 32768, outputTokenLimit: 8192,
      } });
      const sceneKey = 'current-fit-generated-' + randomUUID();
      const title = localized(GENERATED_PRIVATE + ' source');
      const nextChoices = [{ choiceKey: 'synthetic-next', label: localized(GENERATED_PRIVATE + ' choice') }];
      const visualManifest = { sceneKey, background: { state: 'fallback', altKey: 'story.visual.fallback' },
        characters: [], fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' } };
      const persistedBeats = beats.map(beat => ({ beatType: beat.beatType, content: localized(beat.content) }));
      // ai_generated is the required storage discriminator, not a claim of a provider receipt.
      const generated = await db.storyAiGeneratedScene.create({ data: {
        continuationId: origin.id, userId: f.owner.id, workId: f.work.id, releaseId: f.release.id, progressId: progress.id,
        sourcePartId: f.scene.partId, sceneKey, title, visualManifest, provenance: 'ai_generated',
        resultChecksum: storyAiResultChecksum({ title, beats: persistedBeats, visualManifest, nextChoices }), status: 'ready',
      } });
      await db.storyAiGeneratedBeat.createMany({ data: persistedBeats.map((beat, index) => ({
        sceneId: generated.id, position: index + 1, ...beat })) });
      const generatedChoice = await db.storyAiGeneratedChoice.create({ data: {
        sceneId: generated.id, position: 1, ...nextChoices[0], routeKind: 'generation_required' } });
      const completedOrigin = await db.storyAiContinuation.update({ where: { id: origin.id },
        data: { resultGeneratedSceneId: generated.id } });
      return { generated, generatedChoice, origin: completedOrigin };
    }
    const source = await createSource();
    const pathSummary = [{ sourceSceneId: f.scene.id, sourceGeneratedSceneId: null, choiceId: f.choice.id,
      generatedSceneId: source.generated.id, readBeatPosition: progress.currentBeatPosition, provenance: 'ai_generated' }];
    const current = await db.$transaction(async tx => {
      const step = await storyRouteStepForContinuation(tx, { ...source.origin, endingKey: null });
      expect(step).toEqual({ kind: 'canonical', sceneId: f.scene.id, choiceId: f.choice.id, targetSceneId: null, endingKey: null });
      const routeNodeId = await appendStoryRoute(tx, progress, step, progress.currentAct, pathSummary[0]);
      await tx.storyChoiceEvent.create({ data: { progressId: progress.id, sceneId: f.scene.id, choiceId: f.choice.id } });
      return tx.storyReaderProgress.update({ where: { id: progress.id }, data: {
        currentSceneId: null, currentGeneratedSceneId: source.generated.id, currentBeatPosition: beats.length,
        progressRevision: { increment: 1 }, pathSummary, routeNodeId } });
    });
    const generatedRead = (choiceId = source.generatedChoice.id, userId = f.owner.id) => f.service.inspect(userId, f.work.id,
      { locale: 'ko', choiceId, expectedProgressRevision: current.progressRevision });
    return { ...f, ...source, current, root, beats, generationProfilePin, createSource, generatedRead };
  }

  async function generatedSnapshot() {
    const names = ['storyAiGeneratedScene', 'storyAiGeneratedBeat', 'storyAiGeneratedChoice', 'storyChoiceEvent',
      'storyStyleProfileConsent', 'contentRightsContract', 'contentRightsContractVersion',
      'storyAiLegalActivation', 'storyAiResultEvidence'];
    return { ...await snapshot(), ...Object.fromEntries(await Promise.all(names.map(async name => [
      name, await (db as any)[name].findMany({ orderBy: { id: 'asc' } })]))) };
  }
  function assertGeneratedSummary(result: Awaited<ReturnType<StoryAuthorCurrentFitService['inspect']>>,
    f: Awaited<ReturnType<typeof generatedFixture>>) {
    expect(result).toMatchObject({ readOnly: true, providerCalls: 0, operatingWrites: 0,
      dispatchAuthorized: false, semanticQualityVerified: false, legalAuthorization: 'not_evaluated', paidApproval: 'not_evaluated' });
    const publicJson = JSON.stringify(result);
    for (const privateValue of [PRIVATE, GENERATED_PRIVATE, ...f.beats.map(beat => beat.content), f.owner.id,
      f.work.id, f.release.id, f.manuscript.id, f.analysis.id, f.profile.id, f.progress.id, f.scene.id,
      f.generated.id, f.generatedChoice.id, f.origin.id, f.current.routeNodeId!, f.root.id,
      f.profile.sourceFingerprint, f.profile.approvedFingerprint!, f.generated.resultChecksum,
      f.origin.contextFingerprint, f.root.routeHash!]) expect(publicJson).not.toContain(privateValue);
  }
  async function expectGeneratedUnavailable(f: Awaited<ReturnType<typeof generatedFixture>>, reason: string,
    choiceId = f.generatedChoice.id) {
    const before = await generatedSnapshot();
    const result = await f.generatedRead(choiceId);
    expect(result).toMatchObject({ outcome: 'current_source_unavailable', currentSourceState: 'unavailable',
      reason, diagnostic: null, approvalReferenceVerified: false });
    expect(f.inspectSpy).not.toHaveBeenCalled(); assertGeneratedSummary(result, f);
    expect(await generatedSnapshot()).toEqual(before);
  }

  it('CURRENT-FIT-GENERATED-PG: full private generated beats use the entire original published part 80-120 target', async () => {
    const f = await generatedFixture(), before = await generatedSnapshot();
    expect(f.origin).toMatchObject({ status: 'completed', userId: f.owner.id, workId: f.work.id,
      releaseId: f.release.id, manuscriptVersionId: f.manuscript.id, analysisJobId: f.analysis.id,
      resultGeneratedSceneId: f.generated.id, sharedResultId: null,
      contextReferences: { sourceKind: 'synthetic_generated_fixture', review: 'synthetic_not_human_approval',
        generationProfilePin: f.generationProfilePin } });
    expect(f.generated.sharedResultId).toBeNull();
    const result = await f.generatedRead();
    expect(result).toMatchObject({ outcome: 'request_checked', currentSourceState: 'validated',
      progressRevision: 53, approvalReferenceVerified: true, manuscriptVersion: 1, analysisVersion: 1,
      profileVersion: 1, reviewRevision: 1, diagnostic: { inputFit: 'within_policy_bound', writingStylePresent: true,
        narrativeLength: { referenceUnits: 6034, minUnits: 4828, targetUnits: 6034, maxUnits: 7240 },
        outputFit: 'unmeasured', multiStageFit: 'unimplemented', currentApprovalVerified: false, providerCalls: 0 } });
    expect(f.inspectSpy).toHaveBeenCalledTimes(1);
    const [input, config] = f.inspectSpy.mock.calls[0];
    const prepared = prepareStoryContinuationOpenAiRequestForDiagnostics(input, config);
    expect(prepared.max_output_tokens).toBe(8192);
    expect(result.diagnostic!.inputTokenBudget).toBe(storyContinuationInputTokenBudget(prepared));
    expect(result.diagnostic!.requestBytes).toBe(Buffer.byteLength(JSON.stringify(prepared), 'utf8'));
    const projected = JSON.parse(prepared.input[0].content[0].text);
    expect(projected.sourceScene.beats).toEqual(f.beats);
    expect(projected.sourceScene.title).toBe(GENERATED_PRIVATE + ' source');
    expect(projected.selectedChoice.label).toBe(GENERATED_PRIVATE + ' choice');
    expect(projected.narrativeLength).toEqual({ measurement: 'narrative-nonwhite-codepoints-v1',
      sourceUnits: 6034, minimumUnits: 4828, targetUnits: 6034, maximumUnits: 7240 });
    expect(f.beats.reduce((units, beat) => units + beat.content.replace(/\s/g, '').length, 0)).not.toBe(6034);
    expect(projected.generationProfile.sections).toHaveLength(8);
    const style = projected.generationProfile.sections.find((row: any) => row.key === 'writing_style').value;
    expect(style.observations.map((row: any) => row.detail)).toEqual(['head intact', 'middle intact', 'tail intact']);
    expect(style.categories[0].observations).toEqual(['head category', 'tail category']);
    expect(style.customConstraint).toBe('generic full style');
    expect(projected.path).toEqual([{ sourceTitle: PRIVATE, choiceLabel: PRIVATE,
      targetTitle: GENERATED_PRIVATE + ' source', explicitRejoin: false, endingType: null }]);
    expect(projected.routeContinuity.actions).toEqual([{ step: 1, choiceLabel: PRIVATE }]);
    assertGeneratedSummary(result, f); expect(await generatedSnapshot()).toEqual(before); assertModes(f);
  });

  it('CURRENT-FIT-GENERATED-PG: generated choice must match current route and fully read progress source', async () => {
    const f = await generatedFixture();
    const alternate = await f.createSource();
    expect(alternate.generated.id).not.toBe(f.generated.id);
    expect(alternate.generatedChoice.label).toEqual(f.generatedChoice.label);
    await expectGeneratedUnavailable(f, 'choice_unavailable', alternate.generatedChoice.id);
    await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: { routeNodeId: f.root.id } });
    await expectGeneratedUnavailable(f, 'context_unavailable');
    await db.storyReaderProgress.update({ where: { id: f.progress.id },
      data: { routeNodeId: f.current.routeNodeId, currentBeatPosition: 2 } });
    await expectGeneratedUnavailable(f, 'source_not_fully_read');
    await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: { currentBeatPosition: 3 } });
    const before = await generatedSnapshot();
    const result = await f.generatedRead();
    expect(result).toMatchObject({ outcome: 'request_checked', progressRevision: 53, approvalReferenceVerified: true });
    expect(f.inspectSpy).toHaveBeenCalledTimes(1);
    const [input, config] = f.inspectSpy.mock.calls[0];
    const prepared = prepareStoryContinuationOpenAiRequestForDiagnostics(input, config);
    const projected = JSON.parse(prepared.input[0].content[0].text);
    expect(projected.sourceScene.beats).toEqual(f.beats);
    expect(projected.selectedChoice.label).toBe(GENERATED_PRIVATE + ' choice');
    expect(result.diagnostic!.inputTokenBudget).toBe(storyContinuationInputTokenBudget(prepared));
    assertGeneratedSummary(result, f); expect(await generatedSnapshot()).toEqual(before); assertModes(f, 4);
  });

  it('CURRENT-FIT-GENERATED-PG: pending, nonowner, shared-scope and stale origin fail before inspection', async () => {
    const f = await generatedFixture();
    await db.storyAiContinuation.update({ where: { id: f.origin.id }, data: { status: 'queued', completedAt: null } });
    await expectGeneratedUnavailable(f, 'source_unavailable');
    await db.storyAiContinuation.update({ where: { id: f.origin.id },
      data: { status: 'completed', completedAt: f.origin.completedAt } });
    await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: { status: 'ai_pending' } });
    await expectGeneratedUnavailable(f, 'progress_unavailable');
    await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: { status: 'active' } });
    const outsider = await db.user.create({ data: {} }), beforeNonowner = await generatedSnapshot();
    await expect(f.generatedRead(f.generatedChoice.id, outsider.id)).rejects.toMatchObject({
      status: 404, response: { code: 'STORY_AUTHOR_CURRENT_FIT_NOT_FOUND' } });
    expect(f.inspectSpy).not.toHaveBeenCalled(); expect(await generatedSnapshot()).toEqual(beforeNonowner);
    // A real pending shared tuple is enough to leave private scope; no activation or approval is fabricated.
    const shared = await db.storyAiReusableResult.create({ data: {
      reuseKey: 'current-fit-generated-' + randomUUID(), workId: f.work.id, releaseId: f.release.id,
      releaseChecksum: f.release.checksum, manuscriptVersionId: f.manuscript.id, sourceKind: 'canonical',
      sourceCanonicalPartId: f.scene.partId, sourceCanonicalSceneId: f.scene.id, sourceCanonicalChoiceId: f.choice.id,
      sourceFingerprint: hash({ syntheticSource: f.scene.id }), semanticPathFingerprint: hash([]),
      contextFingerprint: f.origin.contextFingerprint, promptVersion: f.origin.promptVersion,
      outputSchemaVersion: f.origin.outputSchemaVersion, locale: 'ko', provider: 'synthetic-no-provider',
      model: 'synthetic-no-model', rateCardVersion: 'synthetic-reference-only',
      costPolicyVersion: 'synthetic-no-paid-cost', rightsActivationKey: 'synthetic-not-legal-activation',
      moderationPolicyVersion: 'synthetic-no-moderation', moderationEvidenceVersion: 'synthetic-no-evidence',
      qualityPolicyVersion: 'synthetic-not-human-review', status: 'pending',
    } });
    await db.storyAiGeneratedScene.update({ where: { id: f.generated.id }, data: { sharedResultId: shared.id } });
    await expectGeneratedUnavailable(f, 'context_unavailable');
    await db.storyAiGeneratedScene.update({ where: { id: f.generated.id }, data: { sharedResultId: null } });
    await db.storyAiContinuation.update({ where: { id: f.origin.id }, data: { resultGeneratedSceneId: null } });
    await expectGeneratedUnavailable(f, 'source_unavailable');
    expect(f.inspectSpy).not.toHaveBeenCalled(); assertModes(f, 5);
  });

  // CURRENT-FIT-PRIVATE-HOP-PG: synthetic persistence only; no provider, human review or legal/paid approval.
  const PRIVATE_HOP = 'CURRENT-FIT-PRIVATE-HOP-PG_PRIVATE_SYNTHETIC';
  async function privateHopFixture(generatedCount = 2, wrongFirstPrivateOriginChoice = false) {
    if (!Number.isInteger(generatedCount) || generatedCount < 2 || generatedCount > 27) {
      throw new Error('Bounded synthetic private-hop fixture required');
    }
    const f = await generatedFixture();
    const firstRoute = await db.storyProgressRouteNode.findUniqueOrThrow({ where: { id: f.current.routeNodeId! } });
    const history = [{ generated: f.generated, generatedChoice: f.generatedChoice, origin: f.origin,
      beats: f.beats, current: f.current, node: firstRoute }];
    const { appendStoryRoute, storyRouteStepForContinuation } = await import('./story-route-identity.store');
    const { storyAiResultChecksum } = await import('./story-ai-result-checksum');
    async function appendHop() {
      const generation = history.length + 1, parent = history.at(-1)!;
      if (generation > 27) throw new Error('Synthetic private-hop fixture bound exceeded');
      const originSource = generation === 2 && wrongFirstPrivateOriginChoice ? await f.createSource() : parent;
      const origin = await db.storyAiContinuation.create({ data: {
        userId: f.owner.id, workId: f.work.id, releaseId: f.release.id, progressId: f.progress.id,
        requestKind: 'recommended_choice', sourceSceneId: null, recommendedChoiceId: null,
        sourceGeneratedSceneId: originSource.generated.id, generatedChoiceId: originSource.generatedChoice.id,
        sourcePartId: originSource.generated.sourcePartId, sourceProgressRevision: parent.current.progressRevision,
        sourceRouteNodeId: parent.node.id, sourceRouteHash: parent.node.routeHash,
        manuscriptVersionId: f.manuscript.id, analysisJobId: f.analysis.id, analysisVersion: f.analysis.analysisVersion,
        rightsContractId: f.origin.rightsContractId, rightsContractVersionId: f.origin.rightsContractVersionId,
        releaseChecksum: f.release.checksum, rateCardId: parent.current.aiRateCardId!,
        styleConsentId: f.origin.styleConsentId, styleConsentRevision: f.origin.styleConsentRevision,
        capabilityRevision: parent.current.capabilityRevision!, idempotencyKey: randomUUID(), locale: 'ko',
        contextFingerprint: hash({ synthetic: PRIVATE_HOP, generation, generationProfilePin: f.generationProfilePin }),
        promptVersion: f.origin.promptVersion, outputSchemaVersion: f.origin.outputSchemaVersion,
        contextReferences: { sourceKind: 'synthetic_private_hop_fixture', review: 'synthetic_not_human_approval',
          generationProfilePin: f.generationProfilePin, fullManuscriptIncluded: false, providerPayloadIncluded: false },
        status: 'completed', completedAt: new Date(), estimatedCostKrw: 0, hardBudgetKrw: 0,
        inputTokenLimit: 32768, outputTokenLimit: 8192,
      } });
      const beats = [
        { beatType: 'paragraph', content: PRIVATE_HOP + ' G' + generation + ' head ' + 'h'.repeat(1500) },
        { beatType: 'dialogue', content: PRIVATE_HOP + ' G' + generation + ' middle ' + 'm'.repeat(1500) },
        { beatType: 'paragraph', content: PRIVATE_HOP + ' G' + generation + ' tail ' + 't'.repeat(1500) },
      ];
      const sceneKey = 'current-fit-private-hop-' + randomUUID();
      const title = localized(PRIVATE_HOP + ' G' + generation);
      const nextChoices = [{ choiceKey: 'synthetic-private-next', label: localized(PRIVATE_HOP + ' next choice') }];
      const visualManifest = { sceneKey, background: { state: 'fallback', altKey: 'story.visual.fallback' },
        characters: [], fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' } };
      const persistedBeats = beats.map(beat => ({ beatType: beat.beatType, content: localized(beat.content) }));
      const generated = await db.storyAiGeneratedScene.create({ data: {
        continuationId: origin.id, userId: f.owner.id, workId: f.work.id, releaseId: f.release.id,
        progressId: f.progress.id, sourcePartId: parent.generated.sourcePartId, sceneKey, title, visualManifest,
        provenance: 'ai_generated', status: 'ready',
        resultChecksum: storyAiResultChecksum({ title, beats: persistedBeats, visualManifest, nextChoices }),
      } });
      await db.storyAiGeneratedBeat.createMany({ data: persistedBeats.map((beat, index) => ({
        sceneId: generated.id, position: index + 1, ...beat })) });
      const generatedChoice = await db.storyAiGeneratedChoice.create({ data: {
        sceneId: generated.id, position: 1, ...nextChoices[0], routeKind: 'generation_required' } });
      const completedOrigin = await db.storyAiContinuation.update({ where: { id: origin.id },
        data: { resultGeneratedSceneId: generated.id } });
      const reference = { sourceSceneId: null, sourceGeneratedSceneId: parent.generated.id,
        choiceId: parent.generatedChoice.id, generatedSceneId: generated.id,
        readBeatPosition: parent.current.currentBeatPosition, provenance: 'ai_generated' };
      const current = await db.$transaction(async tx => {
        const step = await storyRouteStepForContinuation(tx, { ...completedOrigin, endingKey: null });
        expect(step).toEqual({ kind: 'private' });
        const routeNodeId = await appendStoryRoute(tx, parent.current, step, parent.current.currentAct, reference);
        const pathSummary = [...parent.current.pathSummary as Prisma.JsonObject[], reference].slice(-24);
        return tx.storyReaderProgress.update({ where: { id: f.progress.id }, data: {
          currentSceneId: null, currentGeneratedSceneId: generated.id, currentBeatPosition: beats.length,
          progressRevision: { increment: 1 }, routeNodeId, pathSummary } });
      });
      const node = await db.storyProgressRouteNode.findUniqueOrThrow({ where: { id: current.routeNodeId! } });
      expect(node).toMatchObject({ stepKind: 'private', depth: generation, parentId: parent.node.id,
        routeHash: null, sourceSceneId: null, sourceChoiceId: null, sourceSharedResultId: null,
        sourceSharedChoiceKey: null, targetSceneId: null, endingKey: null, narrativeStep: reference });
      const next = { generated, generatedChoice, origin: completedOrigin, beats, current, node };
      history.push(next);
      return next;
    }
    while (history.length < generatedCount) await appendHop();
    const privateRead = (choiceId = history.at(-1)!.generatedChoice.id,
      revision = history.at(-1)!.current.progressRevision) => f.service.inspect(f.owner.id, f.work.id,
      { locale: 'ko', choiceId, expectedProgressRevision: revision });
    return { ...f, history, appendHop, privateRead };
  }

  async function assertPrivateHopBindings(f: Awaited<ReturnType<typeof privateHopFixture>>) {
    const routes = await db.storyProgressRouteNode.findMany({ where: {
      progressId: f.progress.id, workId: f.work.id, releaseId: f.release.id }, orderBy: { depth: 'asc' } });
    const origins = await db.storyAiContinuation.findMany({ where: { id: { in: f.history.map(row => row.origin.id) } } });
    const scenes = await db.storyAiGeneratedScene.findMany({ where: { id: { in: f.history.map(row => row.generated.id) } } });
    const choices = await db.storyAiGeneratedChoice.findMany({ where: { id: { in: f.history.map(row => row.generatedChoice.id) } } });
    expect(routes).toHaveLength(f.history.length + 1); expect(origins).toHaveLength(f.history.length);
    expect(scenes).toHaveLength(f.history.length); expect(choices).toHaveLength(f.history.length);
    expect(routes[0]).toMatchObject({ id: f.root.id, stepKind: 'root', depth: 0, parentId: null,
      targetSceneId: f.scene.id, sourceSceneId: null, sourceChoiceId: null, routeHash: f.root.routeHash });
    expect(routes[0].routeHash).toMatch(/^[a-f0-9]{64}$/);
    for (const [index, source] of f.history.entries()) {
      const node = routes[index + 1], parent = routes[index];
      expect(node.id).toBe(source.node.id);
      expect(node).toMatchObject({ parentId: parent.id, depth: index + 1,
        stepKind: index === 0 ? 'canonical' : 'private', targetSceneId: null, endingKey: null,
        sourceSceneId: index === 0 ? f.scene.id : null, sourceChoiceId: index === 0 ? f.choice.id : null,
        sourceSharedResultId: null, sourceSharedChoiceKey: null });
      if (index === 0) expect(node.routeHash).toMatch(/^[a-f0-9]{64}$/);
      else expect(node.routeHash).toBeNull();
      const origin = origins.find(row => row.id === source.origin.id)!;
      expect(origin).toMatchObject({ userId: f.owner.id, workId: f.work.id, releaseId: f.release.id,
        progressId: f.progress.id, manuscriptVersionId: f.manuscript.id, status: 'completed',
        requestKind: 'recommended_choice', customChoiceId: null, sourcePartId: f.scene.partId,
        sourceSceneId: index === 0 ? f.scene.id : null,
        recommendedChoiceId: index === 0 ? f.choice.id : null,
        sourceGeneratedSceneId: index === 0 ? null : f.history[index - 1].generated.id,
        generatedChoiceId: index === 0 ? null : f.history[index - 1].generatedChoice.id,
        sourceRouteNodeId: parent.id, sourceRouteHash: parent.routeHash,
        sourceProgressRevision: index === 0 ? f.progress.progressRevision : f.history[index - 1].current.progressRevision,
        resultSceneId: null, resultGeneratedSceneId: source.generated.id, sharedResultId: null,
        contextReferences: { sourceKind: index === 0 ? 'synthetic_generated_fixture' : 'synthetic_private_hop_fixture',
          review: 'synthetic_not_human_approval', generationProfilePin: f.generationProfilePin } });
      expect(scenes.find(row => row.id === source.generated.id)).toMatchObject({
        continuationId: origin.id, userId: f.owner.id, workId: f.work.id, releaseId: f.release.id,
        progressId: f.progress.id, sourcePartId: f.scene.partId, provenance: 'ai_generated',
        status: 'ready', endingType: null, sharedResultId: null });
      expect(choices.find(row => row.id === source.generatedChoice.id)).toMatchObject({
        sceneId: source.generated.id, routeKind: 'generation_required', position: 1 });
    }
    const head = f.history.at(-1)!;
    expect(await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progress.id } })).toMatchObject({
      routeNodeId: head.node.id, currentSceneId: null, currentGeneratedSceneId: head.generated.id,
      currentBeatPosition: head.beats.length, progressRevision: head.current.progressRevision });
    expect(await db.storyStyleProfileConsent.findUniqueOrThrow({ where: { id: f.origin.styleConsentId } }))
      .toMatchObject({ rightsConfirmed: false, aiBranchAllowed: false });
    expect(await db.contentRightsContractVersion.findUniqueOrThrow({ where: { id: f.origin.rightsContractVersionId! } }))
      .toMatchObject({ approvalState: 'draft', saleAllowed: false, aiTransformationAllowed: false, generatedResultReuseAllowed: false });
  }

  function assertPrivateHopSummary(result: Awaited<ReturnType<StoryAuthorCurrentFitService['inspect']>>,
    f: Awaited<ReturnType<typeof privateHopFixture>>) {
    assertGeneratedSummary(result, f);
    const publicJson = JSON.stringify(result);
    expect(publicJson).not.toContain(PRIVATE_HOP);
    for (const source of f.history) {
      for (const value of [...source.beats.map(beat => beat.content), source.generated.id,
        source.generatedChoice.id, source.origin.id, source.origin.sourceGeneratedSceneId,
        source.origin.generatedChoiceId, source.node.id, source.node.routeHash,
        source.generated.resultChecksum, source.origin.contextFingerprint]) {
        if (typeof value === 'string') expect(publicJson).not.toContain(value);
      }
    }
  }

  it('CURRENT-FIT-PRIVATE-HOP-PG: real R2/null and R3/null inspect full G2/G3 with unchanged original/style/request pins', async () => {
    const f = await privateHopFixture(2);
    const { continuationHash } = await import('./story-continuation-context.policy');
    const rate = await db.storyAiRateCard.findUniqueOrThrow({ where: { id: f.progress.aiRateCardId! } });
    for (const generation of [2, 3]) {
      if (generation === 3) await f.appendHop();
      await assertPrivateHopBindings(f);
      const head = f.history.at(-1)!, before = await generatedSnapshot(), call = f.inspectSpy.mock.calls.length;
      const result = await f.privateRead();
      expect(result).toMatchObject({ outcome: 'request_checked', currentSourceState: 'validated',
        progressRevision: head.current.progressRevision, approvalReferenceVerified: true,
        manuscriptVersion: 1, analysisVersion: 1, profileVersion: 1, reviewRevision: 1,
        diagnostic: { inputFit: 'within_policy_bound', writingStylePresent: true, outputFit: 'unmeasured',
          multiStageFit: 'unimplemented', currentApprovalVerified: false, dispatchAuthorized: false,
          narrativeLength: { referenceUnits: 6034, minUnits: 4828, targetUnits: 6034, maxUnits: 7240 } } });
      const [input, config] = f.inspectSpy.mock.calls[call];
      expect(input).toMatchObject({ operationId: 'current_owner_read_only_diagnostic', locale: 'ko',
        provider: rate.provider, model: rate.model, rateCardId: rate.id, rateCardVersion: rate.version,
        promptVersion: f.origin.promptVersion, outputSchemaVersion: f.origin.outputSchemaVersion,
        inputTokenLimit: 32768, outputTokenLimit: 8192 });
      expect(config).toEqual({ provider: rate.provider, model: rate.model, rateCardId: rate.id,
        rateCardVersion: rate.version, maxInputTokens: 32768, maxOutputTokens: 8192 });
      expect(input.contextFingerprint).toBe(continuationHash({ release: f.release.id, checksum: f.release.checksum,
        progressRevision: head.current.progressRevision, profile: f.generationProfilePin,
        choice: head.generatedChoice.id, context: input.approvedContext }));
      const prepared = prepareStoryContinuationOpenAiRequestForDiagnostics(input, config);
      const projected = JSON.parse(prepared.input[0].content[0].text);
      expect(projected.sourceScene).toEqual({ title: PRIVATE_HOP + ' G' + generation, beats: head.beats });
      expect(projected.selectedChoice).toEqual({ label: PRIVATE_HOP + ' next choice' });
      expect(projected.narrativeLength).toEqual({ measurement: 'narrative-nonwhite-codepoints-v1',
        sourceUnits: 6034, minimumUnits: 4828, targetUnits: 6034, maximumUnits: 7240 });
      expect(head.beats.reduce((units, beat) => units + beat.content.replace(/\s/g, '').length, 0)).not.toBe(6034);
      const approved = normalizeCreatorGenerationProfile('story', f.profile.approvedSettings);
      const approvedStyle = approved.sections.find(section => section.key === 'writing_style')!.value;
      expect(projected.generationProfile.sections).toHaveLength(8);
      expect(projected.generationProfile.sections.find((section: any) => section.key === 'writing_style').value)
        .toEqual({ ...approvedStyle, referenceScope: 'production_constraint', observations: [
          { title: 'head', detail: 'head intact', referenceScope: 'writing_pattern' },
          { title: 'middle', detail: 'middle intact', referenceScope: 'writing_pattern' },
          { title: 'tail', detail: 'tail intact', referenceScope: 'writing_pattern' }] });
      expect(projected.path).toEqual(f.history.map((_, index) => ({
        sourceTitle: index === 0 ? PRIVATE : index === 1 ? GENERATED_PRIVATE + ' source' : PRIVATE_HOP + ' G' + index,
        choiceLabel: index === 0 ? PRIVATE : index === 1 ? GENERATED_PRIVATE + ' choice' : PRIVATE_HOP + ' next choice',
        targetTitle: index === 0 ? GENERATED_PRIVATE + ' source' : PRIVATE_HOP + ' G' + (index + 1),
        explicitRejoin: false, endingType: null })));
      expect(projected.routeContinuity.actions).toEqual(f.history.map((_, index) => ({
        step: index + 1, choiceLabel: index === 0 ? PRIVATE : index === 1 ? GENERATED_PRIVATE + ' choice'
          : PRIVATE_HOP + ' next choice' })));
      expect(prepared.max_output_tokens).toBe(8192);
      expect(result.diagnostic!.inputTokenBudget).toBe(storyContinuationInputTokenBudget(prepared));
      expect(result.diagnostic!.requestBytes).toBe(Buffer.byteLength(JSON.stringify(prepared), 'utf8'));
      expect(await f.privateRead()).toEqual(result);
      expect(f.inspectSpy).toHaveBeenCalledTimes(call + 2);
      expect(f.inspectSpy.mock.calls[call + 1][0]).toEqual(input);
      assertPrivateHopSummary(result, f); expect(await generatedSnapshot()).toEqual(before);
    }
    assertModes(f, 4);
  });

  it('CURRENT-FIT-PRIVATE-HOP-PG: first canonical and old private origins outside 12/24 retained suffix are still bound', async () => {
    const f = await privateHopFixture(27);
    await assertPrivateHopBindings(f);
    const head = f.history.at(-1)!, retained = head.current.pathSummary as Prisma.JsonObject[];
    expect(retained).toHaveLength(24);
    for (const old of f.history.slice(0, 2)) {
      expect(JSON.stringify(retained)).not.toContain(old.generated.id);
      expect(JSON.stringify(retained.slice(-12))).not.toContain(old.generated.id);
    }
    const baseline = await generatedSnapshot();
    const valid = await f.privateRead();
    expect(valid).toMatchObject({ outcome: 'request_checked', progressRevision: head.current.progressRevision });
    assertPrivateHopSummary(valid, f); expect(await generatedSnapshot()).toEqual(baseline);
    for (const old of f.history.slice(0, 2)) {
      f.inspectSpy.mockClear();
      // Status is mutable synthetic metadata; route nodes and origin parent/hash pins are never changed.
      await db.storyAiContinuation.update({ where: { id: old.origin.id }, data: { status: 'queued', completedAt: null } });
      const before = await generatedSnapshot();
      const result = await f.privateRead();
      expect(result).toMatchObject({ outcome: 'current_source_unavailable', reason: 'context_unavailable',
        currentSourceState: 'unavailable', diagnostic: null, approvalReferenceVerified: false });
      expect(f.inspectSpy).not.toHaveBeenCalled(); assertPrivateHopSummary(result, f);
      expect(await generatedSnapshot()).toEqual(before);
      await db.storyAiContinuation.update({ where: { id: old.origin.id },
        data: { status: 'completed', completedAt: old.origin.completedAt } });
    }
    expect(await generatedSnapshot()).toEqual(baseline); assertModes(f, 3);
  });

  it('CURRENT-FIT-PRIVATE-HOP-PG: real same-label sibling origin choice and noncurrent requested choice cannot bind G3', async () => {
    const f = await privateHopFixture(3, true), first = f.history[0], second = f.history[1], head = f.history[2];
    const actualOrigin = await db.storyAiContinuation.findUniqueOrThrow({ where: { id: second.origin.id } });
    const sibling = await db.storyAiGeneratedChoice.findUniqueOrThrow({ where: { id: actualOrigin.generatedChoiceId! } });
    expect(sibling.id).not.toBe(first.generatedChoice.id);
    expect(sibling.sceneId).not.toBe(first.generated.id);
    expect(sibling).toMatchObject({ sceneId: actualOrigin.sourceGeneratedSceneId,
      routeKind: 'generation_required', position: 1 });
    const siblingScene = await db.storyAiGeneratedScene.findUniqueOrThrow({ where: { id: sibling.sceneId } });
    expect(siblingScene).toMatchObject({ userId: f.owner.id, workId: f.work.id, releaseId: f.release.id,
      progressId: f.progress.id, sourcePartId: f.scene.partId, status: 'ready', provenance: 'ai_generated', sharedResultId: null });
    expect(await db.storyAiContinuation.findUniqueOrThrow({ where: { id: siblingScene.continuationId } }))
      .toMatchObject({ status: 'completed', sourceSceneId: f.scene.id, recommendedChoiceId: f.choice.id,
        sourceRouteNodeId: f.root.id, sourceRouteHash: f.root.routeHash, resultGeneratedSceneId: siblingScene.id,
        contextReferences: { sourceKind: 'synthetic_generated_fixture', review: 'synthetic_not_human_approval' } });
    expect(sibling.label).toEqual(first.generatedChoice.label);
    expect(actualOrigin).toMatchObject({ status: 'completed', sourceGeneratedSceneId: siblingScene.id,
      generatedChoiceId: sibling.id, sourceRouteNodeId: first.node.id, sourceRouteHash: first.node.routeHash,
      resultGeneratedSceneId: second.generated.id, sourcePartId: f.scene.partId, sharedResultId: null });
    expect(second.node.narrativeStep).toMatchObject({ sourceGeneratedSceneId: first.generated.id,
      choiceId: first.generatedChoice.id, generatedSceneId: second.generated.id });
    expect(head.origin).toMatchObject({ sourceGeneratedSceneId: second.generated.id,
      generatedChoiceId: second.generatedChoice.id, sourceRouteNodeId: second.node.id, sourceRouteHash: null,
      resultGeneratedSceneId: head.generated.id });
    expect(second.generatedChoice.label).toEqual(head.generatedChoice.label);
    const before = await generatedSnapshot();
    const wrongRequested = await f.privateRead(second.generatedChoice.id);
    expect(wrongRequested).toMatchObject({ reason: 'choice_unavailable', diagnostic: null, approvalReferenceVerified: false });
    const mismatchedHistory = await f.privateRead();
    expect(mismatchedHistory).toMatchObject({ reason: 'context_unavailable', diagnostic: null, approvalReferenceVerified: false });
    expect(f.inspectSpy).not.toHaveBeenCalled();
    assertPrivateHopSummary(wrongRequested, f); assertPrivateHopSummary(mismatchedHistory, f);
    expect(await generatedSnapshot()).toEqual(before); assertModes(f, 2);
  });


  // PROFILE-VIEW-SIZE: owned native fixtures only; synthetic approval is not human/provider evidence.
  // BEGIN PROFILE-VIEW-SIZE APPEND
  async function profileViewSizeFixture() {
    const f = await fixture();
    const endRule = '  "SYNTHETIC_END_RULE":\nKeep the entire final exception.\t ';
    const summary = ' \n' + '\uD55C'.repeat(7900) + '\n' + PRIVATE + endRule;
    const sourceRef = 'analysis:' + f.analysis.id;
    const observations = ['head', 'repeat', 'repeat', 'tail'].map(title => ({
      title: '  ' + title + '\t ', detail: ' \n\uD55C\uAE00 ' + title + endRule, sourceRef,
    }));
    const categories = [{ category: '  synthetic rhythm\t ',
      observations: ['  repeated category\n', '  repeated category\n', endRule] }];
    const settings = normalizeCreatorGenerationProfile('story', {
      schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
      sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
        key, decision: 'accepted',
        evidence: key === 'writing_style' ? [{ sourceType: 'manuscript',
          sourceRef: sourceRef + ':SYNTHETIC-PART:7', summary: 'Synthetic locator, not human review' }] : [],
        value: key === 'writing_style' ? { summary, customConstraint: endRule, observations, categories }
          : { summary: key === 'canon' ? ' \n' + 'c'.repeat(600) + '\t ' : 'approved ' + key },
      })),
    });
    const sizeProfile = await db.storyWorkGenerationProfile.create({ data: {
      workId: f.work.id, ownerUserId: f.owner.id, manuscriptVersionId: f.manuscript.id,
      analysisJobId: f.analysis.id, sourceFingerprint: f.profile.sourceFingerprint,
      profileVersion: 2, reviewRevision: 1, status: 'approved',
      draftSettings: settings as unknown as Prisma.InputJsonValue,
      approvedSettings: settings as unknown as Prisma.InputJsonValue,
      approvedFingerprint: creatorGenerationProfileFingerprint(f.profile.sourceFingerprint, settings),
      approvedByUserId: f.owner.id, approvedAt: new Date(),
    } });
    const persisted = normalizeCreatorGenerationProfile('story', sizeProfile.approvedSettings);
    const styleValue = persisted.sections.find(section => section.key === 'writing_style')!.value;
    expect(styleValue).toEqual({ summary, customConstraint: endRule, observations, categories });
    expect(sizeProfile.approvedFingerprint).toBe(
      creatorGenerationProfileFingerprint(sizeProfile.sourceFingerprint, persisted));
    expect(await db.storyWorkGenerationProfile.findFirst({
      where: { workId: f.work.id }, orderBy: { profileVersion: 'desc' }, select: { id: true },
    })).toEqual({ id: sizeProfile.id });
    expect(sizeProfile).toMatchObject({ status: 'approved', ownerUserId: f.owner.id,
      manuscriptVersionId: f.release.manuscriptVersionId, analysisJobId: f.analysis.id,
      approvedByUserId: f.owner.id, profileVersion: 2, reviewRevision: 1 });

    // Independent oracle for this restricted fixture shape, including PG JSON object order.
    // It does not call the projector or derive expectations from the thrown diagnostic.
    const expectedStyle = { key: 'writing_style', value: {
      ...Object.fromEntries(Object.entries(styleValue).filter(([field]) =>
        !['observations', 'categories', 'referenceScope'].includes(field))),
      referenceScope: 'production_constraint',
      observations: observations.map(row => ({ title: row.title, detail: row.detail,
        referenceScope: 'writing_pattern', sourceRef, sourcePartKey: 'SYNTHETIC-PART', sourceParagraphIndex: 7 })),
      categories,
    } };
    const tierBytes = [240, 200, 160].map(summaryLimit => {
      const approved = { schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
        sections: persisted.sections.map(section => {
          expect(section.decision).toBe('accepted');
          if (section.key === 'writing_style') return expectedStyle;
          expect(Object.keys(section.value)).toEqual(['summary']);
          const literal = section.value.summary;
          if (typeof literal !== 'string') throw new Error('SYNTHETIC_PROFILE_VIEW_FIXTURE_INVALID');
          return { key: section.key, value: {
            summary: section.key === 'branch_behavior' ? literal
              : Array.from(literal.trim()).slice(0, summaryLimit).join('').trim(),
            referenceScope: ['scene_scale', 'branch_behavior'].includes(section.key)
              ? 'production_constraint' : 'author_plan_not_route_history',
          } };
        }) };
      return Buffer.byteLength(JSON.stringify(approved), 'utf8');
    });
    expect(tierBytes.every(value => Number.isSafeInteger(value) && value > 16384)).toBe(true);
    expect(tierBytes[0]).toBeGreaterThan(tierBytes[1]);
    expect(tierBytes[1]).toBeGreaterThan(tierBytes[2]);
    const expectedDiagnostic = {
      contract: 'story-profile-view-byte-diagnostic-v1', byteCap: 16384,
      minimumProjectedViewBytes: Math.min(...tierBytes),
      writingStyleSectionBytes: Buffer.byteLength(JSON.stringify(expectedStyle), 'utf8'),
      scopeObservationCount: observations.length,
      trustedRepeatedScopeBytes: observations.length * Buffer.byteLength(',"referenceScope":"writing_pattern"', 'utf8'),
      projectionTiers: 3, modelInputFit: 'unmeasured', compactViewFit: 'unmeasured',
      semanticQualityVerified: false,
    } as const;
    return { ...f, sizeProfile, summary, endRule, sourceRef, expectedDiagnostic };
  }

  function assertProfileViewSizeSummary(value: unknown, f: Awaited<ReturnType<typeof profileViewSizeFixture>>) {
    const publicJson = JSON.stringify(value);
    expect(publicJson).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    for (const privateValue of [PRIVATE, f.summary, f.endRule, f.sourceRef, 'SYNTHETIC-PART',
      'Synthetic locator, not human review', 'repeated category', f.sizeProfile.sourceFingerprint,
      f.sizeProfile.approvedFingerprint!, f.profile.approvedFingerprint!, f.release.checksum, f.manuscript.contentHash]) {
      expect(publicJson).not.toContain(privateValue);
    }
  }

  it('PROFILE-VIEW-SIZE: latest valid full-style overflow returns exact numeric v6 aggregates in RO/RR without source changes', async () => {
    const f = await profileViewSizeFixture();
    const policy = await import('./story-continuation-context.policy');
    const projection = jest.spyOn(policy, 'continuationGenerationProfileSnapshot');
    const helper = await import('./story-continuation-diagnostic-context');
    const contextRead = jest.spyOn(helper, 'readStoryContinuationDiagnosticContext');
    const before = await generatedSnapshot();
    expect(Object.keys(before)).toHaveLength(33);
    const result = await f.read();
    expect(result).toEqual({
      contract: 'story-author-current-fit-v1', locale: 'ko',
      sourceScope: 'latest_private_approval_and_current_reader_source',
      readOnly: true, providerCalls: 0, operatingWrites: 0, dispatchAuthorized: false,
      semanticQualityVerified: false, legalAuthorization: 'not_evaluated', paidApproval: 'not_evaluated',
      outcome: 'current_source_unavailable', currentSourceState: 'unavailable',
      reason: 'approved_profile_context_too_large', approvalReferenceVerified: false,
      progressRevision: null, manuscriptVersion: null, analysisVersion: null,
      profileVersion: null, reviewRevision: null, diagnostic: null,
      profileViewDiagnostic: f.expectedDiagnostic,
    });
    expect(projection).toHaveBeenCalledTimes(1);
    expect(projection.mock.calls[0][0]).toMatchObject({ id: f.sizeProfile.id,
      approvedSettings: f.sizeProfile.approvedSettings, approvedFingerprint: f.sizeProfile.approvedFingerprint });
    // The spy retains the real projector; inspect its actual thrown typed error, not a synthetic replacement.
    expect(projection.mock.results[0].type).toBe('throw');
    const error = projection.mock.results[0].value as unknown;
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(policy.StoryContinuationProfileViewContextTooLargeError);
    expect(error).toMatchObject({ message: 'generation_profile_context_too_large',
      profileViewDiagnostic: f.expectedDiagnostic });
    const diag = f.expectedDiagnostic;
    expect(diag.minimumProjectedViewBytes).toBeGreaterThan(diag.byteCap);
    expect(diag.minimumProjectedViewBytes).toBeLessThanOrEqual(2000000);
    expect(diag.writingStyleSectionBytes).toBeGreaterThan(0);
    expect(diag.writingStyleSectionBytes).toBeLessThanOrEqual(diag.minimumProjectedViewBytes);
    expect(diag.scopeObservationCount).toBeGreaterThanOrEqual(0);
    expect(diag.scopeObservationCount).toBeLessThanOrEqual(200);
    for (const amount of [diag.minimumProjectedViewBytes, diag.writingStyleSectionBytes,
      diag.scopeObservationCount, diag.trustedRepeatedScopeBytes]) expect(Number.isSafeInteger(amount)).toBe(true);
    expect(contextRead).not.toHaveBeenCalled();
    expect(f.inspectSpy).not.toHaveBeenCalled();
    expect(await db.storyReleaseCapability.findUniqueOrThrow({ where: { releaseId: f.release.id } }))
      .toMatchObject({ aiInputTokenLimit: 32768, aiOutputTokenLimit: 8192 });
    const beats = await db.storyBeat.findMany({ where: { sceneId: f.scene.id }, orderBy: { position: 'asc' } });
    expect(beats).toHaveLength(1);
    expect(beats[0].content).toEqual(localized('a'.repeat(5200)));
    const { authorPartStoryContinuationLengthBounds, storyContinuationOutputTokenLimit } =
      await import('./story-continuation-length.policy');
    const bounds = authorPartStoryContinuationLengthBounds('ko', ['a'.repeat(5200)]);
    expect(bounds).toEqual({ profileVersion: 'author-length-80-120-v1',
      measurement: 'narrative-nonwhite-codepoints-v1', locale: 'ko',
      referenceUnits: 5200, minUnits: 4160, targetUnits: 5200, maxUnits: 6240 });
    expect(storyContinuationOutputTokenLimit(bounds, 8192)).toBe(8192);
    assertProfileViewSizeSummary(result, f);
    expect(await generatedSnapshot()).toEqual(before);
    assertModes(f);
  });

  it('PROFILE-VIEW-SIZE: stale latest fingerprint cannot expose a byte aggregate or fall back to the old approval', async () => {
    const f = await profileViewSizeFixture();
    expect(f.sizeProfile.approvedFingerprint).not.toBe('0'.repeat(64));
    await db.storyWorkGenerationProfile.update({ where: { id: f.sizeProfile.id },
      data: { approvedFingerprint: '0'.repeat(64) } });
    const policy = await import('./story-continuation-context.policy');
    const projection = jest.spyOn(policy, 'continuationGenerationProfileSnapshot');
    const before = await generatedSnapshot();
    expect(Object.keys(before)).toHaveLength(33);
    const result = await f.read();
    expect(result).toMatchObject({ contract: 'story-author-current-fit-v1',
      outcome: 'current_source_unavailable', currentSourceState: 'unavailable',
      reason: 'approval_unavailable', approvalReferenceVerified: false, diagnostic: null,
      readOnly: true, providerCalls: 0, operatingWrites: 0, dispatchAuthorized: false,
      semanticQualityVerified: false, legalAuthorization: 'not_evaluated', paidApproval: 'not_evaluated' });
    expect(result).not.toHaveProperty('profileViewDiagnostic');
    expect(projection).not.toHaveBeenCalled();
    expect(f.inspectSpy).not.toHaveBeenCalled();
    assertProfileViewSizeSummary(result, f);
    expect(await generatedSnapshot()).toEqual(before);
    assertModes(f);
  });

  it('PROFILE-VIEW-SIZE: a real foreign user cannot receive owner-only profile-size aggregates', async () => {
    const f = await profileViewSizeFixture();
    const outsider = await db.user.create({ data: {} });
    expect(outsider.id).not.toBe(f.owner.id);
    const policy = await import('./story-continuation-context.policy');
    const projection = jest.spyOn(policy, 'continuationGenerationProfileSnapshot');
    const before = await generatedSnapshot();
    expect(Object.keys(before)).toHaveLength(33);
    const denial = await f.service.inspect(outsider.id, f.work.id, {
      locale: 'ko', choiceId: f.choice.id, expectedProgressRevision: f.progress.progressRevision,
    }).then(() => null, (error: unknown) => error);
    expect(denial).toMatchObject({ status: 404, response: { code: 'STORY_AUTHOR_CURRENT_FIT_NOT_FOUND' } });
    expect(denial).not.toHaveProperty('profileViewDiagnostic');
    const publicResponse = (denial as { getResponse(): unknown }).getResponse();
    expect(publicResponse).toEqual({ code: 'STORY_AUTHOR_CURRENT_FIT_NOT_FOUND' });
    expect(publicResponse).not.toHaveProperty('profileViewDiagnostic');
    expect(projection).not.toHaveBeenCalled();
    expect(f.inspectSpy).not.toHaveBeenCalled();
    assertProfileViewSizeSummary(publicResponse, f);
    expect(await generatedSnapshot()).toEqual(before);
    assertModes(f);
  });
  // END PROFILE-VIEW-SIZE APPEND

  it('STYLE-PROJECTION-COMPLETE-PG: an approved unsupported rule stops the owner read with a distinct safe reason', async () => {
    const f = await fixture();
    const settings = normalizeCreatorGenerationProfile('story', f.profile.approvedSettings);
    const style = settings.sections.find(section => section.key === 'writing_style')!;
    (style.value.observations as Array<Record<string, unknown>>)[0].authorException =
      'SYNTHETIC_APPROVED_EXCEPTION_MUST_NOT_DISAPPEAR';
    await db.storyWorkGenerationProfile.update({ where: { id: f.profile.id }, data: {
      approvedSettings: settings as unknown as Prisma.InputJsonValue,
      approvedFingerprint: creatorGenerationProfileFingerprint(f.profile.sourceFingerprint, settings),
    } });
    const policy = await import('./story-continuation-context.policy');
    const diagnosticContext = await import('./story-continuation-diagnostic-context');
    const projection = jest.spyOn(policy, 'continuationGenerationProfileSnapshot');
    const contextRead = jest.spyOn(diagnosticContext, 'readStoryContinuationDiagnosticContext');
    const before = await generatedSnapshot();
    expect(Object.keys(before)).toHaveLength(33);
    const result = await f.read();
    expect(result).toMatchObject({ contract: 'story-author-current-fit-v1',
      outcome: 'current_source_unavailable', currentSourceState: 'unavailable',
      reason: 'approved_profile_style_projection_incomplete', approvalReferenceVerified: false, diagnostic: null,
      readOnly: true, providerCalls: 0, operatingWrites: 0, dispatchAuthorized: false,
      semanticQualityVerified: false, legalAuthorization: 'not_evaluated', paidApproval: 'not_evaluated' });
    expect(result).not.toHaveProperty('profileViewDiagnostic');
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_APPROVED_EXCEPTION_MUST_NOT_DISAPPEAR');
    expect(projection).toHaveBeenCalledTimes(1);
    expect(projection.mock.results[0]).toMatchObject({ type: 'throw',
      value: { message: 'generation_profile_style_projection_incomplete' } });
    expect(contextRead).not.toHaveBeenCalled();
    expect(f.inspectSpy).not.toHaveBeenCalled();
    expect(await generatedSnapshot()).toEqual(before);
    assertModes(f);
  });

});

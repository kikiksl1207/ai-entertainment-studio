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
});

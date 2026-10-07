import {
  CREATOR_GENERATION_PROFILE_SCHEMA,
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
} from '../generation-profile/creator-generation-profile.policy';
import { StoryContinuationContextAssembler } from './story-continuation-context.assembler';
import {
  continuationExecutionFingerprint,
  continuationGenerationProfileSnapshot,
  continuationHash,
  continuationPathHash,
  continuationSourceHash,
  STORY_CONTINUATION_PROFILE_VIEW_VERSION,
} from './story-continuation-context.policy';
import { StoryContinuationExecutor } from './story-continuation.executor';
import type { StoryContinuationOpenAiConfig } from './story-continuation-openai.config';
import { buildStoryContinuationOpenAiRequest } from './story-continuation-openai.prompt';
import { STORY_CONTINUATION_PROMPT_VERSION, STORY_CONTINUATION_SCHEMA_VERSION } from './story-continuation-openai.schema';
import type { StoryContinuationProviderRequest } from './story-continuation.provider';
import type { StoryContinuationClaim } from './story-continuation.repository';
import { STORY_CONTINUATION_ROUTE_VIEW_VERSION } from './story-continuation-route-continuity';

const config: StoryContinuationOpenAiConfig = {
  enabled: false, provider: 'openai', model: 'gpt-4.1-2025-04-14',
  rateCardId: 'synthetic-position-card', rateCardVersion: 'fixture-v1', apiKey: '',
  timeoutMs: 100, maxInputTokens: 32_768, maxOutputTokens: 8_192,
  maxResponseBytes: 200_000, visualAssetPath: '/assets/story/neutral-placeholder.webp',
};
const sourceRef = 'analysis:11111111-1111-4111-8111-111111111111';
const futureEvent = 'AUTHOR_PLAN_ONLY: The sealed archive burns in the planned final part.';
const unreadEvent = 'UNREAD_ONLY: The archive has already burned.';
const stop = 'synthetic_position_preflight_stop';
type ReadQuery = { where: Record<string, any> };

function profile(ambiguous = false) {
  const approvedSettings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
    sections: ['timeline', 'branch_behavior'].map(key => ({
      key, decision: 'accepted',
      value: key === 'timeline' ? {
        summary: 'A possible manuscript ending, not reader history.',
        observations: [{ title: 'Planned ending', detail: futureEvent, sourceRef,
          sourcePartKey: 'FORGED_EARLY_PART', referenceScope: 'reader_route_fact' }],
      } : { summary: 'Preserve the selected branch consequences.' },
      evidence: key === 'timeline' ? [
        { sourceType: 'manuscript', sourceRef: `${sourceRef}:PART-32:17`, summary: 'Manuscript coordinate.' },
        ...(ambiguous ? [{ sourceType: 'manuscript', sourceRef: `${sourceRef}:PART-1:2`, summary: 'Ambiguous coordinate.' }] : []),
      ] : [],
    })),
  });
  const sourceFingerprint = 'a'.repeat(64);
  return { id: 'profile-id', status: 'approved', profileVersion: 1, reviewRevision: 1,
    sourceFingerprint, approvedSettings,
    approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, approvedSettings) };
}

// Read delegates emulate query scoping only; no Prisma client or SQL is executed.
function matches(row: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (value && typeof value === 'object' && 'in' in value) {
      return (value.in as unknown[]).includes(row[key]);
    }
    return row[key] === value;
  });
}

function fixture({ act = 1, steps = 14, readPosition = 2, ambiguous = false } = {}) {
  const approvedProfile = profile(ambiguous);
  const snapshot = continuationGenerationProfileSnapshot(approvedProfile as never);
  const part = { id: 'part-id', workId: 'work-id', status: 'published', fixtureSource: false,
    actNumber: act, position: act, partKey: `PART-${act}` };
  const generatedScenes = Array.from({ length: steps + 1 }, (_, index) => ({
    id: `generated-${index + 1}`, title: { en: `Actual route scene ${index + 1}` },
    userId: 'reader-id', workId: 'work-id', releaseId: 'release-id', progressId: 'progress-id',
    sourcePartId: part.id, status: 'ready', endingType: null,
  }));
  const choices = generatedScenes.map((scene, index) => ({ id: `choice-${index + 1}`,
    sceneId: scene.id, label: { en: `Keep route promise ${index + 1}` }, routeKind: 'generation_required' }));
  const beats = generatedScenes.flatMap(scene => [1, 2, 3].map(position => ({
    sceneId: scene.id, position, beatType: 'paragraph',
    content: { en: position === 3 ? unreadEvent : `Read ${scene.id} event ${position}.` },
  })));
  const routeSteps = generatedScenes.slice(0, steps).map((scene, index) => ({
    sourceGeneratedSceneId: scene.id, choiceId: choices[index].id,
    generatedSceneId: generatedScenes[index + 1].id,
    ...(readPosition ? { readBeatPosition: readPosition } : {}),
  }));
  const pathSummary = routeSteps.slice(-6);
  const progress = { id: 'progress-id', userId: 'reader-id', workId: 'work-id', activeReleaseId: 'release-id',
    currentSceneId: null, currentGeneratedSceneId: generatedScenes.at(-1)!.id,
    currentAct: act, currentBeatPosition: 2, status: 'ai_pending', progressRevision: 10,
    routeNodeId: 'route-node-id', pathSummary };
  const routeNode = { id: progress.routeNodeId, progressId: progress.id, workId: progress.workId,
    releaseId: progress.activeReleaseId, routeHash: 'verified-route-hash' };
  const semanticPath = pathSummary.map(step => ({
    sourceTitle: generatedScenes.find(scene => scene.id === step.sourceGeneratedSceneId)!.title.en,
    choiceLabel: choices.find(choice => choice.id === step.choiceId)!.label.en,
    targetTitle: generatedScenes.find(scene => scene.id === step.generatedSceneId)!.title.en,
    explicitRejoin: false, endingType: null,
  }));
  const routeContinuity = { version: STORY_CONTINUATION_ROUTE_VIEW_VERSION,
    actions: routeSteps.map((step, index) => ({ step: index + 1,
      choiceLabel: choices.find(choice => choice.id === step.choiceId)!.label.en })),
    readEvidence: readPosition ? routeSteps.map((step, index) => ({ step: index + 1,
      text: readPosition === 1 ? `Read ${step.sourceGeneratedSceneId} event 1.`
        : `Read ${step.sourceGeneratedSceneId} event 1. / Read ${step.sourceGeneratedSceneId} event 2.` })) : [],
  };
  const source = generatedScenes.at(-1)!;
  const selectedChoice = choices.at(-1)!;
  const sourceHash = continuationSourceHash({ kind: 'generated', locale: 'en', title: source.title,
    beats: beats.filter(beat => beat.sceneId === source.id && beat.position <= progress.currentBeatPosition),
    choiceLabel: selectedChoice.label });
  const pathHash = continuationPathHash(semanticPath);
  const routeContinuityHash = continuationHash(routeContinuity);
  const request: StoryContinuationProviderRequest = {
    operationId: 'position-continuation', locale: 'en', contextFingerprint: 'synthetic-position-context',
    promptVersion: STORY_CONTINUATION_PROMPT_VERSION, outputSchemaVersion: STORY_CONTINUATION_SCHEMA_VERSION,
    provider: config.provider, model: config.model, rateCardId: config.rateCardId, rateCardVersion: config.rateCardVersion,
    inputTokenLimit: 32_768, outputTokenLimit: 500,
  };
  const continuation = { id: request.operationId, leaseToken: 'lease-token', userId: progress.userId,
    workId: progress.workId, releaseId: progress.activeReleaseId, progressId: progress.id,
    sourcePartId: part.id, sourceSceneId: null, sourceGeneratedSceneId: source.id,
    sourceRouteNodeId: routeNode.id, sourceRouteHash: routeNode.routeHash,
    recommendedChoiceId: null, generatedChoiceId: selectedChoice.id, sourceProgressRevision: 9,
    manuscriptVersionId: 'manuscript-id', analysisJobId: 'analysis-id', locale: request.locale,
    promptVersion: request.promptVersion, inputTokenLimit: request.inputTokenLimit,
    contextFingerprint: request.contextFingerprint, contextReferences: {
      memoryPins: [], sourceHash, pathHash, routeContinuityHash,
      routeContinuityVersion: STORY_CONTINUATION_ROUTE_VIEW_VERSION,
      generationProfilePin: snapshot.pin, generationProfileViewVersion: STORY_CONTINUATION_PROFILE_VIEW_VERSION,
      executionFingerprint: continuationExecutionFingerprint({ contextFingerprint: request.contextFingerprint,
        sourceHash, pathHash, memoryPins: [], routeContinuityHash,
        routeContinuityVersion: STORY_CONTINUATION_ROUTE_VIEW_VERSION, generationProfilePin: snapshot.pin }),
    } };
  const claim: StoryContinuationClaim = { continuationId: continuation.id, leaseToken: 'lease-token',
    attemptCount: 1, maxAttempts: 3, request };
  const prisma = {
    storyAiContinuation: { findUnique: jest.fn().mockResolvedValue(continuation) },
    storyReaderProgress: { findFirst: jest.fn(async ({ where }: ReadQuery) => matches(progress, where) ? progress : null) },
    storyPart: { findFirst: jest.fn(async ({ where }: ReadQuery) => matches(part, where) ? part : null) },
    storyScene: { findMany: jest.fn().mockResolvedValue([{ id: 'authored-source' }]) },
    storyBeat: { findMany: jest.fn().mockResolvedValue([
      { beatType: 'paragraph', content: { en: 'Authored prose sets scene length, not a route ending threshold.' } },
    ]) },
    storyAiGeneratedScene: {
      findFirst: jest.fn(async ({ where }: ReadQuery) => generatedScenes.find(scene => matches(scene, where)) ?? null),
      findMany: jest.fn(async ({ where }: ReadQuery) => generatedScenes.filter(scene => matches(scene, where))),
    },
    storyAiGeneratedChoice: {
      findFirst: jest.fn(async ({ where }: ReadQuery) => choices.find(choice => matches(choice, where)) ?? null),
      findMany: jest.fn(async ({ where }: ReadQuery) => choices.filter(choice => matches(choice, where))),
    },
    storyAiGeneratedBeat: { findMany: jest.fn(async ({ where }: ReadQuery) => beats.filter(beat =>
      typeof where.sceneId === 'string' ? beat.sceneId === where.sceneId && beat.position <= where.position.lte
        : where.sceneId.in.includes(beat.sceneId))) },
    storyMemoryRecord: { findMany: jest.fn().mockResolvedValue([]) },
    storyWorkGenerationProfile: { findFirst: jest.fn(async ({ where }: ReadQuery) =>
      matches({ ...approvedProfile, workId: progress.workId, manuscriptVersionId: continuation.manuscriptVersionId,
        analysisJobId: continuation.analysisJobId }, where) ? approvedProfile : null) },
    storyProgressRouteNode: { findFirst: jest.fn(async ({ where }: ReadQuery) => matches(routeNode, where) ? routeNode : null) },
    $queryRaw: jest.fn(async (_sql: TemplateStringsArray, ..._values: unknown[]) =>
      routeSteps.map((narrative_step, index) => ({ depth: index + 1, narrative_step }))),
  };
  const assembler = new StoryContinuationContextAssembler(prisma as never);
  const provider = {
    readiness: jest.fn().mockResolvedValue({ enabled: true }),
    preflight: jest.fn(async (request: StoryContinuationProviderRequest) => {
      buildStoryContinuationOpenAiRequest(request, config);
      return { supported: false, reason: stop };
    }),
    generate: jest.fn(() => { throw new Error('Generation is prohibited in position tests'); }),
  };
  const queue = { claimExpiredTerminal: jest.fn().mockResolvedValue(null), claimNext: jest.fn().mockResolvedValue(claim),
    markDispatched: jest.fn(), releaseForRetry: jest.fn(), releaseNotAcceptedForRetry: jest.fn() };
  const economics = { continuationExecutionAuthorization: jest.fn().mockResolvedValue({ allowed: true }),
    continuationDispatchAuthorization: jest.fn(), failClaimedContinuation: jest.fn(), settleClaimedContinuation: jest.fn() };
  const executor = new StoryContinuationExecutor(queue as never, provider as never, economics as never,
    assembler, { preview: jest.fn() } as never);
  return { assembler, claim, continuation, progress, part, routeNode, routeSteps, generatedScenes,
    beats, choices, prisma, provider, queue, economics, executor, semanticPath, routeContinuity };
}

async function payload(f: ReturnType<typeof fixture>) {
  const approvedContext = await f.assembler.assemble(f.claim);
  const body = buildStoryContinuationOpenAiRequest({ ...f.claim.request, approvedContext }, config);
  return { approvedContext, body, context: JSON.parse(body.input[0].content[0].text) };
}

function readerFacts(context: Record<string, unknown>) {
  return { sourceScene: context.sourceScene, selectedChoice: context.selectedChoice,
    path: context.path, routeContinuity: context.routeContinuity, memories: context.memories };
}

async function expectNoDispatch(f: ReturnType<typeof fixture>, reason: string, preflight = false) {
  await expect(f.executor.executeOne('synthetic-position-worker')).resolves.toMatchObject({ status: 'failed' });
  expect(f.provider.preflight).toHaveBeenCalledTimes(preflight ? 1 : 0);
  expect(f.provider.generate).not.toHaveBeenCalled();
  expect(f.queue.markDispatched).not.toHaveBeenCalled();
  expect(f.queue.releaseForRetry).not.toHaveBeenCalled();
  expect(f.queue.releaseNotAcceptedForRetry).not.toHaveBeenCalled();
  expect(f.economics.settleClaimedContinuation).not.toHaveBeenCalled();
  expect(f.economics.continuationDispatchAuthorization).not.toHaveBeenCalled();
  expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(f.claim, reason, 'failed',
    ...(preflight ? [undefined, true] : []));
}

describe('manuscript position is not reader route progress or finite ending eligibility', () => {
  let network: jest.SpyInstance;
  beforeEach(() => { network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network is prohibited')); });
  afterEach(() => { expect(network).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

  it.each([{ act: 1, steps: 14 }, { act: 32, steps: 2 }])(
    'uses verified route actions/read evidence at manuscript act $act after $steps choices', async options => {
      const f = fixture(options);
      const { context, body } = await payload(f);
      expect(context.path).toEqual(f.semanticPath);
      expect(context.routeContinuity).toEqual(f.routeContinuity);
      expect(context.routeContinuity.actions).toHaveLength(options.steps);
      expect(context.path).toHaveLength(Math.min(options.steps, 6));
      expect(context.sourceScene.beats).toHaveLength(2);
      expect(JSON.stringify(readerFacts(context))).not.toMatch(/AUTHOR_PLAN_ONLY|UNREAD_ONLY/);
      expect(context).not.toHaveProperty('currentAct');
      expect(context).not.toHaveProperty('readerProgress');
      expect(context).not.toHaveProperty('endingThreshold');
      expect(context).not.toHaveProperty('forceEnding');
      expect(body.instructions).toContain('they do not prove the reader reached that event');
      expect(body.instructions).toContain('may omit intermediate steps');
      await expectNoDispatch(f, stop, true);
    },
  );

  it('does not turn source act/ordinal changes into new reader facts or scene-length/ending thresholds', async () => {
    const early = await payload(fixture({ act: 1, steps: 2 }));
    const late = await payload(fixture({ act: 91, steps: 2 }));
    expect(readerFacts(early.context)).toEqual(readerFacts(late.context));
    expect(early.context.narrativeLength).toEqual(late.context.narrativeLength);
    expect(early.body.text.format.schema).toEqual(late.body.text.format.schema);
    expect(early.body.instructions).toEqual(late.body.instructions);
  });

  it('changes route evidence when the reader actually read fewer beats, despite the same source anchor', async () => {
    const before = await payload(fixture({ steps: 2, readPosition: 1 }));
    const after = await payload(fixture({ steps: 2, readPosition: 2 }));
    expect(before.context.path).toEqual(after.context.path);
    expect(before.context.routeContinuity.actions).toEqual(after.context.routeContinuity.actions);
    expect(before.context.routeContinuity.readEvidence).not.toEqual(after.context.routeContinuity.readEvidence);
    expect(JSON.stringify(before.context.routeContinuity.readEvidence)).not.toContain('event 2');
    expect(JSON.stringify(after.context.routeContinuity.readEvidence)).toContain('event 2');
  });

  it('does not reconstruct historical read evidence from a source anchor when read positions are absent', async () => {
    const { context } = await payload(fixture({ steps: 2, readPosition: 0 }));
    expect(context.routeContinuity.actions).toHaveLength(2);
    expect(context.routeContinuity.readEvidence).toEqual([]);
    expect(context.sourceScene.beats).toHaveLength(2);
  });

  it.each([false, true])('keeps approved source provenance outside actual route facts (ambiguous=%s)', async ambiguous => {
    const { context } = await payload(fixture({ steps: 2, ambiguous }));
    const timeline = context.generationProfile.sections.find((section: { key: string }) => section.key === 'timeline');
    expect(timeline.value.referenceScope).toBe('author_plan_not_route_history');
    expect(timeline.value.observations).toEqual([{ title: 'Planned ending', detail: futureEvent, sourceRef,
      referenceScope: 'author_plan_not_route_history',
      ...(!ambiguous ? { sourcePartKey: 'PART-32', sourceParagraphIndex: 17 } : {}),
    }]);
    expect(JSON.stringify(context)).not.toContain('FORGED_EARLY_PART');
    expect(JSON.stringify(readerFacts(context))).not.toContain(futureEvent);
    expect(context.generationProfile.sections.find((section: { key: string }) => section.key === 'branch_behavior')
      .value).toEqual({ summary: 'Preserve the selected branch consequences.', referenceScope: 'production_constraint' });
  });

  it('does not serialize unapproved reader counters or ending instructions smuggled beside approved context', async () => {
    const f = fixture({ steps: 2 });
    const approvedContext = await f.assembler.assemble(f.claim);
    Object.assign(approvedContext, { currentAct: 32, sourcePartOrdinal: 32,
      readerProgress: { completedParts: 32 }, forceEnding: true, endingThreshold: 32 });
    const body = buildStoryContinuationOpenAiRequest({ ...f.claim.request, approvedContext }, config);
    const context = JSON.parse(body.input[0].content[0].text);
    for (const field of ['currentAct', 'sourcePartOrdinal', 'readerProgress', 'forceEnding', 'endingThreshold']) {
      expect(context).not.toHaveProperty(field);
    }
    expect(context.routeContinuity).toEqual(f.routeContinuity);
  });

  it.each(['userId', 'activeReleaseId', 'progressRevision', 'currentGeneratedSceneId'] as const)(
    'rejects mismatched reader %s before preflight or generation', async field => {
      const f = fixture({ steps: 2 });
      Object.assign(f.progress, { [field]: field === 'progressRevision' ? 11 : 'wrong-scope' });
      await expectNoDispatch(f, 'pinned_context_changed');
      expect(f.prisma.storyReaderProgress.findFirst).toHaveBeenCalledWith({ where: {
        id: 'progress-id', userId: 'reader-id', workId: 'work-id', activeReleaseId: 'release-id',
        currentSceneId: null, currentGeneratedSceneId: 'generated-3', status: 'ai_pending', progressRevision: 10,
      } });
    },
  );

  it('rejects a stale worker lease without reading body or reader progress', async () => {
    const f = fixture({ steps: 2 });
    f.continuation.leaseToken = 'stale-lease';
    await expectNoDispatch(f, 'stale_worker_lease');
    expect(f.prisma.storyReaderProgress.findFirst).not.toHaveBeenCalled();
    expect(f.prisma.storyAiGeneratedBeat.findMany).not.toHaveBeenCalled();
  });

  it('rejects a changed pinned route even when the manuscript act is unchanged', async () => {
    const f = fixture({ steps: 2 });
    f.routeNode.routeHash = 'changed-route';
    await expectNoDispatch(f, 'pinned_route_changed');
  });

  it.each(['current', 'recent'] as const)('rejects another reader\'s %s generated scene', async location => {
    const f = fixture({ steps: 2 });
    f.generatedScenes[location === 'current' ? 2 : 0].userId = 'another-reader';
    await expectNoDispatch(f, 'pinned_context_changed');
    const lookup = location === 'current' ? f.prisma.storyAiGeneratedScene.findFirst : f.prisma.storyAiGeneratedScene.findMany;
    expect(lookup).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      userId: 'reader-id', workId: 'work-id', releaseId: 'release-id', progressId: 'progress-id', status: 'ready',
    }) }));
  });

  it('rejects changed actual choice history instead of inferring it from currentAct', async () => {
    const f = fixture({ steps: 2 });
    f.choices[0].label.en = 'A different reader decision';
    await expectNoDispatch(f, 'pinned_context_changed');
  });

  it('rejects changed read evidence even when source and semantic path pins still match', async () => {
    const f = fixture({ steps: 2 });
    f.beats.find(beat => beat.sceneId === 'generated-1' && beat.position === 2)!.content.en = 'Changed actual read event.';
    await expectNoDispatch(f, 'pinned_context_changed');
    expect(f.prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(f.prisma.$queryRaw.mock.calls[0].slice(1)).toEqual([
      'route-node-id', 'progress-id', 'work-id', 'release-id', 512, 'progress-id', 'work-id', 'release-id',
    ]);
  });
});

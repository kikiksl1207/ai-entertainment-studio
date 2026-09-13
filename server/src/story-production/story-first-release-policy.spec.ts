import 'reflect-metadata';
import { Decimal } from '@prisma/client/runtime/library';
import { StoryProgressControlService } from './story-progress-control.service';
import { StoryEconomicsService } from './story-economics.service';
import { StoryProductionService } from './story-production.service';
import { StoryLifecycleService } from './story-lifecycle.service';
import {
  firstReleaseChoiceCapability,
  firstReleaseCustomChoiceDenial,
  validatePrivateCustomChoice,
} from './story-progress-control.policy';
import { validateStoryReleaseCapability } from './story-economics.policy';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { StoryProductionController } from './story-production.controller';

const capability = {
  releaseId: 'release', status: 'active', revision: 2, fixedChoiceCount: 12,
  customChoiceEnabled: true, customChoiceMaxLength: 200,
  fullResetLimit: 1, actResetLimit: 3, includedAiRouteCount: 4,
  aiInputTokenLimit: 1000, aiOutputTokenLimit: 500,
  warningBudgetKrw: 10, hardBudgetKrw: 20,
};

function fixture() {
  const progress = {
    id: 'progress', userId: 'reader', workId: 'work', currentSceneId: 'scene',
    checkpointSceneId: 'scene', currentAct: 1, currentBeatPosition: 0,
    progressRevision: 3, storyVersion: 1, status: 'active',
    activeReleaseId: 'release', capabilityRevision: 2,
    pathSummary: [], seenSceneIds: ['scene'], visitedEndingKeys: [],
  };
  const work = {
    id: 'work', slug: 'a-story', status: 'published', fixtureSource: false,
    publishedVersion: 1, activeReleaseId: 'release', priceLumina: new Decimal(100),
    customChoiceEnabled: true, defaultLocale: 'en', title: { en: 'A story' },
    coverManifest: {},
  };
  const part = { id: 'part', workId: 'work', status: 'published', fixtureSource: false, actNumber: 1, priceLumina: new Decimal(100), title: { en: 'Part' } };
  const visualManifest = {
    sceneKey: 'opening', background: { state: 'missing' }, characters: [],
    fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' },
  };
  const scene = { id: 'scene', partId: 'part', sceneKey: 'opening', status: 'published', fixtureSource: false, title: { en: 'Opening' }, visualManifest, endingType: null };
  const choices = [1, 2, 3].map((n) => ({
    id: `choice-${n}`, position: n, sceneId: 'scene', label: { en: `Route ${n}` },
    targetSceneId: `target-${n}`, targetEndingKey: null,
    declaredRejoinSceneId: null, routeKind: 'branch',
  }));
  const entitlement = {
    userId: 'reader', referenceId: 'work', entitlementType: 'story_work',
    startsAt: new Date(0), expiresAt: null as Date | null, revokedAt: null as Date | null,
  };
  const mutations = {
    customCreate: jest.fn(), requestCreate: jest.fn(), allowanceUpsert: jest.fn(),
    usageCreate: jest.fn(), eventCreate: jest.fn(), qualityUpsert: jest.fn(),
    progressUpdate: jest.fn().mockResolvedValue({ count: 1 }), checkpointCreate: jest.fn(),
  };
  const prisma = {
    storyReaderProgress: {
      findFirst: jest.fn().mockImplementation(async ({ where }) => where.userId === progress.userId ? progress : null),
      findUnique: jest.fn().mockResolvedValue(progress), updateMany: mutations.progressUpdate,
    },
    storyWork: { findFirst: jest.fn().mockResolvedValue(work), findUnique: jest.fn().mockResolvedValue(work), findMany: jest.fn().mockResolvedValue([work]) },
    storyPart: { findFirst: jest.fn().mockResolvedValue(part), findUnique: jest.fn().mockResolvedValue(part), findMany: jest.fn().mockResolvedValue([part]) },
    storyScene: {
      findFirst: jest.fn().mockImplementation(async ({ where }) => where.id === 'scene' ? scene : { ...scene, id: where.id }),
      findMany: jest.fn().mockResolvedValue(choices.map((c) => ({ ...scene, id: c.targetSceneId }))),
    },
    storyChoice: { findMany: jest.fn().mockResolvedValue(choices), groupBy: jest.fn() },
    storyCustomChoice: { findUnique: jest.fn().mockResolvedValue(null), create: mutations.customCreate },
    storyRelease: { findFirst: jest.fn().mockResolvedValue({ id: 'release' }), findMany: jest.fn().mockResolvedValue([{ id: 'release' }]) },
    storyReleaseCapability: { findUnique: jest.fn().mockResolvedValue(capability) },
    userEntitlement: {
      findFirst: jest.fn().mockImplementation(async ({ where }) =>
        where.userId === entitlement.userId && where.referenceId.in.includes(entitlement.referenceId) &&
        where.entitlementType.in.includes(entitlement.entitlementType) &&
        entitlement.revokedAt === null && entitlement.startsAt <= where.startsAt.lte &&
        (entitlement.expiresAt === null || entitlement.expiresAt > where.OR[1].expiresAt.gt)
          ? { id: 'entitlement' } : null),
      findMany: jest.fn().mockResolvedValue([{ referenceId: 'work' }]),
    },
    storyAiContinuation: { create: mutations.requestCreate, findUnique: jest.fn() },
    storyAiAllowanceBucket: { upsert: mutations.allowanceUpsert, findUnique: jest.fn().mockResolvedValue(null) },
    storyAiUsageLedger: { create: mutations.usageCreate },
    storyChoiceEvent: { create: mutations.eventCreate, findMany: jest.fn().mockResolvedValue([]) },
    storyQualityEvent: { upsert: mutations.qualityUpsert },
    feedSearchBlockedTerm: { findMany: jest.fn() },
    storyProgressCheckpoint: { create: mutations.checkpointCreate, findFirst: jest.fn().mockResolvedValue(null) },
    storyResetQuotaBucket: { findMany: jest.fn().mockResolvedValue([]) },
    storyBeat: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (run) => run(prisma));
  const moderation = { preview: jest.fn() };
  const economics = new StoryEconomicsService(prisma as never);
  const controls = new StoryProgressControlService(prisma as never, moderation as never, economics);
  const production = new StoryProductionService(prisma as never, economics);
  return { progress, work, scene, part, choices, entitlement, prisma, mutations, moderation, economics, controls, production };
}

function expectNoWrites(f: ReturnType<typeof fixture>) {
  for (const mutation of Object.values(f.mutations)) expect(mutation).not.toHaveBeenCalled();
  expect(f.moderation.preview).not.toHaveBeenCalled();
}

describe('First public release custom-choice enforcement', () => {
  it.each([0, 100])('denies price %s with legacy custom=true on both service configurations', async (price) => {
    const f = fixture();
    f.work.priceLumina = new Decimal(price);
    const legacy = new StoryProgressControlService(f.prisma as never, f.moderation as never);
    for (const service of [legacy, f.controls]) {
      await expect(service.submitCustomChoice('reader', 'progress', {
        input: 'Private route', expectedRevision: 3, paid: true, customChoiceEnabled: true,
      } as never, 'custom-key-123')).rejects.toMatchObject({
        status: 403, response: firstReleaseCustomChoiceDenial(),
      });
    }
    expectNoWrites(f);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect(f.prisma.storyCustomChoice.findUnique).not.toHaveBeenCalled();
  });

  it.each(['expired', 'revoked', 'future', 'foreign', 'wrong-type'])('still checks %s entitlement before release denial', async (state) => {
    const f = fixture();
    if (state === 'expired') f.entitlement.expiresAt = new Date(0);
    if (state === 'revoked') f.entitlement.revokedAt = new Date();
    if (state === 'future') f.entitlement.startsAt = new Date('2099-01-01');
    if (state === 'foreign') f.entitlement.userId = 'another-reader';
    if (state === 'wrong-type') f.entitlement.entitlementType = 'unrelated';
    await expect(f.controls.submitCustomChoice('reader', 'progress', { input: 'Private route', expectedRevision: 3 }, 'custom-key-123'))
      .rejects.toMatchObject({ status: 403, message: 'Story entitlement required' });
    expect(f.prisma.userEntitlement.findFirst).toHaveBeenCalled();
    expectNoWrites(f);
  });

  it('does not expose foreign progress or replay a stale revision', async () => {
    const f = fixture();
    await expect(f.controls.submitCustomChoice('foreign', 'progress', { input: 'Private route', expectedRevision: 3 }, 'custom-key-123'))
      .rejects.toMatchObject({ status: 404 });
    await expect(f.controls.submitCustomChoice('reader', 'progress', { input: 'Private route', expectedRevision: 2 }, 'custom-key-123'))
      .rejects.toMatchObject({ status: 409, response: { code: 'STORY_PROGRESS_STALE_REVISION' } });
    expectNoWrites(f);
  });

  it.each(['active', 'stale-version', 'stale-capability', 'pending'])('cannot revive a saved custom receipt for %s progress', async (state) => {
    const f = fixture();
    if (state === 'stale-version') f.progress.storyVersion = 0;
    if (state === 'stale-capability') f.progress.capabilityRevision = 0;
    if (state === 'pending') f.progress.status = 'ai_pending';
    const validation = validatePrivateCustomChoice('Private route');
    f.prisma.storyCustomChoice.findUnique.mockResolvedValue({
      id: 'saved-request', userId: 'reader', progressId: 'progress',
      contentHash: validation.accepted ? validation.contentHash : '', status: 'queued',
    });
    const replay = jest.spyOn(f.economics, 'customChoiceReplay');
    await expect(f.controls.submitCustomChoice('reader', 'progress', { input: 'Private route', expectedRevision: 3 }, 'custom-key-123'))
      .rejects.toMatchObject({ response: firstReleaseCustomChoiceDenial() });
    expect(replay).not.toHaveBeenCalled();
    expect(f.prisma.storyCustomChoice.findUnique).not.toHaveBeenCalled();
    expectNoWrites(f);
  });

  it('blocks alternate economics preparation, request and replay before any work', async () => {
    const f = fixture();
    const context = { progress: f.progress, work: f.work, part: f.part, scene: f.scene };
    for (const attempt of [
      () => f.economics.prepareCustomChoice('reader', context, 'Private route'),
      () => f.economics.requestCustomChoice({ userId: 'reader', context, prepared: { capability }, normalizedInput: 'Private route' } as never),
      () => f.economics.customChoiceReplay('reader', { userId: 'reader', privateInput: 'Private route' }, 'hash'),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ response: firstReleaseCustomChoiceDenial() });
    }
    expectNoWrites(f);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect(f.prisma.storyReleaseCapability.findUnique).not.toHaveBeenCalled();
  });

  it('emits a safe HTTP envelope, with retryability under details and no private input', async () => {
    const f = fixture();
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const request = { url: '/api/v1/me/story-progress/progress/custom-choice', headers: {} };
    try {
      await f.controls.submitCustomChoice('reader', 'progress', { input: 'Private route', expectedRevision: 3 }, 'custom-key-123');
      throw new Error('Expected denial');
    } catch (error) {
      new HttpExceptionFilter().catch(error, {
        switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ status }) }),
      } as never);
    }
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ success: false, error: expect.objectContaining({
      code: 'STORY_CUSTOM_CHOICE_DEFERRED',
      messageKey: 'story.progress.customChoice.firstReleaseDeferred',
      message: firstReleaseCustomChoiceDenial().message,
      statusCode: 403, details: { retryable: false },
    }) });
    expect(JSON.stringify(json.mock.calls)).not.toContain('Private route');
  });
});

describe('First public release suggested choices', () => {
  it.each([[1, 0], [2, 0], [3, 0], [1, 100], [2, 100], [3, 100]])('preserves the distinct target of choice %s at price %s', async (n, price) => {
    const f = fixture();
    f.work.priceLumina = new Decimal(price);
    jest.spyOn(f.production, 'currentProgress').mockResolvedValue({} as never);
    await f.production.selectChoice('reader', 'progress', `choice-${n}`, 3);
    expect(f.mutations.eventCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ choiceId: `choice-${n}`, targetSceneId: `target-${n}` }) });
    expect(f.mutations.progressUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'progress', userId: 'reader', progressRevision: 3 },
      data: expect.objectContaining({ currentSceneId: `target-${n}`, progressRevision: { increment: 1 } }),
    }));
    expect(f.prisma.storyAiContinuation.create).not.toHaveBeenCalled();
  });

  it('blocks all submission and projection for overfull authored scenes without deleting choices', async () => {
    const f = fixture();
    f.choices.push({ ...f.choices[0], id: 'choice-4', position: 4 });
    const original = JSON.stringify(f.choices);
    for (const id of ['choice-1', 'choice-4']) {
      await expect(f.production.selectChoice('reader', 'progress', id, 3))
        .rejects.toMatchObject({ status: 409, response: { code: 'STORY_SUGGESTED_CHOICE_LIMIT_EXCEEDED' } });
    }
    await expect(f.production.currentProgress('reader', 'progress'))
      .rejects.toMatchObject({ status: 409, response: { code: 'STORY_SUGGESTED_CHOICE_LIMIT_EXCEEDED' } });
    expect(JSON.stringify(f.choices)).toBe(original);
    expectNoWrites(f);
  });

  it('enforces the same overfull-scene guard through both GET controller aliases', async () => {
    const f = fixture();
    f.choices.push({ ...f.choices[0], id: 'choice-4' });
    const controller = new StoryProductionController(f.production, f.controls);
    await expect(controller.current({ id: 'reader' } as never, 'progress', { locale: 'en' })).rejects.toMatchObject({ status: 409 });
    await expect(controller.currentScene({ id: 'reader' } as never, 'progress', { locale: 'en' })).rejects.toMatchObject({ status: 409 });
    expectNoWrites(f);
  });

  it.each(['missing', 'legacy'])('never falls back to twelve reader choices for %s capability', async (mode) => {
    const f = fixture();
    f.choices.push({ ...f.choices[0], id: 'choice-4' });
    f.prisma.storyReleaseCapability.findUnique.mockResolvedValue(null);
    const service = mode === 'legacy' ? new StoryProductionService(f.prisma as never) : f.production;
    await expect(service.currentProgress('reader', 'progress')).rejects.toMatchObject({ response: { code: 'STORY_SUGGESTED_CHOICE_LIMIT_EXCEEDED' } });
    expectNoWrites(f);
  });

  it('rejects an unoffered fourth id even when the current scene has only three choices', async () => {
    const f = fixture();
    await expect(f.production.selectChoice('reader', 'progress', 'choice-4', 3)).rejects.toMatchObject({ status: 400 });
    expectNoWrites(f);
  });

  it.each(['expired', 'revoked', 'foreign', 'stale', 'version', 'capability', 'missing-release', 'inactive-release'])('does not mutate suggested progress with %s access', async (state) => {
    const f = fixture();
    if (state === 'expired') f.entitlement.expiresAt = new Date(0);
    if (state === 'revoked') f.entitlement.revokedAt = new Date();
    if (state === 'version') f.progress.storyVersion = 0;
    if (state === 'capability') f.progress.capabilityRevision = 0;
    if (state === 'missing-release') {
      f.progress.activeReleaseId = null as never;
      f.work.activeReleaseId = null as never;
    }
    if (state === 'inactive-release') f.prisma.storyRelease.findFirst.mockResolvedValue(null);
    await expect(f.production.selectChoice(state === 'foreign' ? 'another-reader' : 'reader', 'progress', 'choice-1', state === 'stale' ? 2 : 3)).rejects.toBeDefined();
    expectNoWrites(f);
  });

  it.each([0, 1, 2, 3])('projects %s authored choices with identical first-release capability', async (count) => {
    const f = fixture();
    f.prisma.storyChoice.findMany.mockResolvedValue(f.choices.slice(0, count));
    if (count === 0) f.scene.endingType = 'author_main' as never;
    const result = await f.production.currentProgress('reader', 'progress', 'en');
    expect(result.choices).toHaveLength(count);
    expect(result).toMatchObject({ releaseCapability: firstReleaseChoiceCapability() });
    expectNoWrites(f);
  });

  it('retains ending completion with zero offered choices', async () => {
    const f = fixture();
    f.progress.currentSceneId = null as never;
    f.progress.status = 'completed';
    await expect(f.production.currentProgress('reader', 'progress')).resolves.toMatchObject({ status: 'completed', choices: [], releaseCapability: firstReleaseChoiceCapability() });
    expectNoWrites(f);
  });
});

describe('Release capability and regression contract', () => {
  it.each([true, false])('rejects custom-enabled release config regardless of free=%s', (freeStory) => {
    expect(validateStoryReleaseCapability({ ...capability, freeStory, fixedChoiceCount: 3 })).toContain('first_release_custom_choice_must_be_disabled');
    expect(validateStoryReleaseCapability({ ...capability, freeStory, fixedChoiceCount: 3, customChoiceEnabled: false })).toEqual([]);
  });

  it.each([true, false])('projects custom=%s config as suggested-only without disabling generation budgets', async (customChoiceEnabled) => {
    const f = fixture();
    f.prisma.storyReleaseCapability.findUnique.mockResolvedValue({ ...capability, customChoiceEnabled });
    const expected = { ...firstReleaseChoiceCapability(), aiGenerationEnabled: true, aiBudget: { inputTokenLimit: 1000, outputTokenLimit: 500 } };
    await expect(f.economics.readerCapability('reader', 'work')).resolves.toMatchObject(expected);
    await expect(f.economics.publicCapabilityByRelease('release')).resolves.toMatchObject(expected);
    await expect(f.controls.publicState('reader', 'work')).resolves.toMatchObject({
      canResume: true, canFullReset: true, canActReset: true,
      fullResetRemaining: 1, actResetRemaining: 3, customChoiceCapability: false,
      releaseCapability: expected,
    });
    const detail = await f.production.detail('a-story', 'reader', { locale: 'en' });
    expect(detail).toMatchObject({ releaseCapability: expected, replay: { newAiPathGeneration: { enabled: true } } });
    const catalog = await f.production.catalog(undefined, { locale: 'en', limit: 10 });
    expect(catalog.items[0]).toMatchObject({ releaseCapability: expected });
    await expect(f.economics.releaseSessionPin('release')).resolves.toMatchObject({ capabilityRevision: 2 });
    expectNoWrites(f);
  });

  it('keeps continuation and checkpoint commands independent of custom deferral', async () => {
    const f = fixture();
    f.mutations.checkpointCreate.mockImplementation(async ({ data }) => ({ ...data, createdAt: new Date() }));
    await expect(f.production.startProgress('reader', 'work', { mode: 'continue', locale: 'en' })).resolves.toMatchObject({ revision: 3 });
    await expect(f.controls.confirmCheckpoint('reader', 'progress', { sceneId: 'scene', beatPosition: 0, expectedRevision: 3, locale: 'en' })).resolves.toMatchObject({ revision: 4 });
    expect(f.mutations.checkpointCreate).toHaveBeenCalled();
    expect(f.mutations.customCreate).not.toHaveBeenCalled();
  });

  it.each([['full', 1], ['act', 3]] as const)('executes %s reset only up to its %s-use quota and preserves history', async (target, limit) => {
    const f = fixture();
    f.work.priceLumina = new Decimal(0);
    f.progress.visitedEndingKeys = ['known-ending'] as never;
    const bucket = { id: 'bucket', revision: 1, usedCount: 0, limitCount: limit };
    const commands = new Map<string, Record<string, unknown>>();
    const quotaUpdate = jest.fn().mockImplementation(async ({ where }) => {
      if (bucket.usedCount >= where.usedCount.lt) return { count: 0 };
      bucket.usedCount += 1;
      bucket.revision += 1;
      return { count: 1 };
    });
    const eventsUpdate = jest.fn();
    const resetCreate = jest.fn().mockImplementation(async ({ data }) => {
      const command = { ...data, id: `reset-${bucket.usedCount}`, status: 'completed' };
      commands.set(data.idempotencyKey, command);
      return command;
    });
    const prisma = {
      ...f.prisma,
      storyScene: { ...f.prisma.storyScene, findUnique: jest.fn().mockResolvedValue(f.scene), findMany: jest.fn().mockResolvedValue([f.scene]) },
      storyChoiceEvent: { ...f.prisma.storyChoiceEvent, count: jest.fn().mockResolvedValue(2), updateMany: eventsUpdate },
      storyResetQuotaBucket: {
        ...f.prisma.storyResetQuotaBucket,
        findUnique: jest.fn().mockResolvedValue(bucket),
        upsert: jest.fn().mockResolvedValue(bucket), updateMany: quotaUpdate,
      },
      storyResetCommand: {
        findUnique: jest.fn().mockImplementation(async ({ where }) => commands.get(where.idempotencyKey) ?? null),
        create: resetCreate,
      },
      auditEvent: { create: jest.fn() },
    };
    f.prisma.$transaction.mockImplementation(async (run) => run(prisma));
    const controls = new StoryProgressControlService(prisma as never, f.moderation as never, f.economics);
    const body = { target, actNumber: 1, expectedRevision: 3, locale: 'en' };
    await expect(controls.resetPreview('reader', 'progress', body)).resolves.toMatchObject({ remainingBefore: limit, canExecute: true });
    for (let index = 0; index < limit; index += 1) {
      await expect(controls.executeReset('reader', 'progress', body, `reset-key-${index}`)).resolves.toMatchObject({ status: 'completed', target, afterRevision: 4 });
    }
    await expect(controls.executeReset('reader', 'progress', body, 'reset-key-0')).resolves.toMatchObject({ idempotentReplay: true });
    expect(bucket.usedCount).toBe(limit);
    await expect(controls.executeReset('reader', 'progress', body, 'reset-key-exhausted')).rejects.toMatchObject({ response: { code: 'STORY_RESET_QUOTA_EXHAUSTED' } });
    expect(resetCreate).toHaveBeenCalledTimes(limit);
    expect(eventsUpdate).toHaveBeenCalledTimes(limit);
    expect(f.mutations.checkpointCreate).toHaveBeenLastCalledWith({ data: expect.objectContaining({ visitedEndingKeys: ['known-ending'] }) });
    expect(f.mutations.customCreate).not.toHaveBeenCalled();
    expect(f.mutations.allowanceUpsert).not.toHaveBeenCalled();
  });

  it('blocks activation of an overfull published scene before release/work writes', async () => {
    const f = fixture();
    const tx = {
      ...f.prisma,
      storyWork: { findUnique: jest.fn().mockResolvedValue({ ...f.work, status: 'release_ready', releaseRevision: 1 }), updateMany: jest.fn() },
      storyRelease: { findFirst: jest.fn().mockResolvedValue({ id: 'release', validationSummary: { ready: true } }), update: jest.fn() },
      storyPublicationTransition: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    f.prisma.$transaction.mockImplementation(async (run) => run(tx));
    f.prisma.storyChoice.groupBy.mockResolvedValue([{ sceneId: 'scene', _count: { _all: 4 } }]);
    const lifecycle = new StoryLifecycleService({ ...tx, $transaction: f.prisma.$transaction } as never);
    await expect(lifecycle.transitionPublication('admin', 'work', { toStatus: 'published', releaseId: 'release', expectedRevision: 1 } as never, 'publish-key-123'))
      .rejects.toMatchObject({ response: { code: 'STORY_SUGGESTED_CHOICE_LIMIT_EXCEEDED' } });
    expect(tx.storyWork.updateMany).not.toHaveBeenCalled();
    expect(tx.storyRelease.update).not.toHaveBeenCalled();
  });
});

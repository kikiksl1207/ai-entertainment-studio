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
  rateCardId: 'rate-card',
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
    publishedAt: new Date(0),
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
    storyAnalysisJob: { findFirst: jest.fn().mockResolvedValue(null) },
    storyContinuityIssue: { count: jest.fn().mockResolvedValue(0) },
    storyCustomChoice: { findUnique: jest.fn().mockResolvedValue(null), create: mutations.customCreate },
    storyRelease: { findFirst: jest.fn().mockResolvedValue({ id: 'release' }), findMany: jest.fn().mockResolvedValue([{ id: 'release' }]) },
    storyReleaseCapability: { findUnique: jest.fn().mockResolvedValue(capability) },
    storyAiRateCard: { findUnique: jest.fn().mockResolvedValue({ id: 'rate-card', status: 'active' }) },
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

function releaseSwitchResetFixture(price: number) {
  const f = fixture();
  const oldPin = { activeReleaseId: 'release', capabilityRevision: 2, aiRateCardId: 'rate-card' };
  Object.assign(f.progress, oldPin, { visitedEndingKeys: ['known-ending'], pathSummary: [{ sceneId: 'scene', choiceId: 'old-choice' }] });
  Object.assign(f.work, { activeReleaseId: 'release-b', publishedVersion: 2, priceLumina: new Decimal(price) });
  const release = { id: 'release-b', workId: 'work', version: 2, status: 'active' };
  const config = { ...capability, releaseId: release.id, revision: 7, rateCardId: 'rate-b', fixedChoiceCount: 3, customChoiceEnabled: false };
  const rateCard = { id: 'rate-b', status: 'active' };
  const entry = { ...f.scene, id: 'entry-b', sceneKey: 'entry-b', visualManifest: { ...f.scene.visualManifest, sceneKey: 'entry-b' } };
  const target = { ...f.scene, id: 'target-b', sceneKey: 'target-b', visualManifest: { ...f.scene.visualManifest, sceneKey: 'target-b' } };
  const choice = { ...f.choices[0], id: 'choice-b', sceneId: entry.id, targetSceneId: target.id };
  const bucket = { id: 'full-bucket', revision: 1, usedCount: 0, limitCount: 1 };
  const events = [{ sceneId: 'scene', choiceId: 'old-choice', invalidatedAt: null as Date | null }];
  const checkpoints: Array<Record<string, unknown>> = [];
  const commands = new Map<string, Record<string, unknown>>();
  const allowances = {
    release: { includedLimit: 4, purchasedLimit: 0, reservedCount: 0, consumedCount: 2, compensatedCount: 0 },
    'release-b': { includedLimit: 4, purchasedLimit: 0, reservedCount: 0, consumedCount: 1, compensatedCount: 0 },
  };
  f.prisma.storyRelease.findFirst.mockImplementation(async ({ where }) =>
    where.id === release.id && where.workId === release.workId && where.status === release.status &&
    (where.version === undefined || where.version === release.version) ? { ...release } : null);
  f.prisma.storyReleaseCapability.findUnique.mockImplementation(async ({ where }) => where.releaseId === config.releaseId ? { ...config } : null);
  f.prisma.storyAiRateCard.findUnique.mockImplementation(async ({ where }) => where.id === rateCard.id ? { ...rateCard } : null);
  f.prisma.storyReaderProgress.findFirst.mockImplementation(async ({ where }) => where.userId === f.progress.userId ? { ...f.progress } : null);
  f.prisma.storyReaderProgress.findUnique.mockImplementation(async () => ({ ...f.progress }));
  f.mutations.progressUpdate.mockImplementation(async ({ where, data }) => {
    if (where.progressRevision !== f.progress.progressRevision) return { count: 0 };
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      (f.progress as Record<string, unknown>)[key] = key === 'progressRevision'
        ? f.progress.progressRevision + (value as { increment: number }).increment : value;
    }
    return { count: 1 };
  });
  f.prisma.storyScene.findFirst.mockImplementation(async ({ where }) => [f.scene, entry, target].find((scene) => scene.id === where.id) ?? null);
  f.prisma.storyScene.findMany.mockImplementation(async ({ where }) => where.partId ? [entry, target] : [entry, target].filter((scene) => where.id.in.includes(scene.id)));
  f.prisma.storyChoice.findMany.mockImplementation(async ({ where }) => where.sceneId === entry.id ? [choice] : []);
  f.mutations.eventCreate.mockImplementation(async ({ data }) => events.push({ ...data, invalidatedAt: null }));
  f.mutations.checkpointCreate.mockImplementation(async ({ data }) => {
    const checkpoint = { ...data, createdAt: new Date() };
    checkpoints.push(checkpoint);
    return checkpoint;
  });
  f.prisma.storyAiAllowanceBucket.findUnique.mockImplementation(async ({ where }) => allowances[where.userId_releaseId.releaseId as keyof typeof allowances]);
  const quotaUpsert = jest.fn().mockResolvedValue(bucket);
  const quotaUpdate = jest.fn().mockImplementation(async ({ where }) => {
    if (bucket.usedCount >= where.usedCount.lt || bucket.revision !== where.revision) return { count: 0 };
    bucket.usedCount += 1;
    bucket.revision += 1;
    return { count: 1 };
  });
  const commandCreate = jest.fn().mockImplementation(async ({ data }) => {
    const command = { ...data, id: 'reset-command', status: 'completed' };
    commands.set(data.idempotencyKey, command);
    return command;
  });
  const invalidateEvents = jest.fn().mockImplementation(async ({ data }) => events.forEach((event) => { event.invalidatedAt = data.invalidatedAt; }));
  const auditCreate = jest.fn();
  const prisma = {
    ...f.prisma,
    storyScene: { ...f.prisma.storyScene, findUnique: jest.fn().mockResolvedValue(f.scene) },
    storyChoiceEvent: { ...f.prisma.storyChoiceEvent, count: jest.fn().mockResolvedValue(1), updateMany: invalidateEvents },
    storyResetQuotaBucket: {
      ...f.prisma.storyResetQuotaBucket, findUnique: jest.fn().mockResolvedValue(bucket), upsert: quotaUpsert, updateMany: quotaUpdate,
    },
    storyResetCommand: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => commands.get(where.idempotencyKey) ?? null), create: commandCreate,
    },
    auditEvent: { create: auditCreate },
  };
  f.prisma.$transaction.mockImplementation(async (run) => run(prisma));
  const controls = new StoryProgressControlService(prisma as never, f.moderation as never, f.economics);
  const body = { target: 'full' as const, expectedRevision: 3, locale: 'en' };
  return { ...f, controls, release, config, rateCard, entry, target, choice, bucket, events, checkpoints, commands, allowances,
    quotaUpsert, quotaUpdate, commandCreate, invalidateEvents, auditCreate, body, oldPin };
}

describe('Review return 1: full reset after release switch', () => {
  it.each([0, 100])('repins reset then accepts the new release choice at price %s', async (price) => {
    const f = releaseSwitchResetFixture(price);
    const allowanceBefore = JSON.stringify(f.allowances);
    const entitlementBefore = JSON.stringify(f.entitlement);
    await expect(f.production.selectChoice('reader', 'progress', f.choice.id, 3)).rejects.toMatchObject({ response: { code: 'STORY_PROGRESS_VERSION_MISMATCH' } });
    await expect(f.controls.publicState('reader', 'work')).resolves.toMatchObject({ canFullReset: true, canActReset: false, customChoiceCapability: false });
    await expect(f.controls.resetPreview('reader', 'progress', f.body)).resolves.toMatchObject({ targetSceneId: f.entry.id, remainingBefore: 1, expectedRevision: 3 });
    await expect(f.controls.executeReset('reader', 'progress', f.body, 'release-switch-reset')).resolves.toMatchObject({ beforeRevision: 3, afterRevision: 4, status: 'completed' });
    expect(f.progress).toMatchObject({
      activeReleaseId: 'release-b', storyVersion: 2, capabilityRevision: 7, aiRateCardId: 'rate-b',
      currentSceneId: f.entry.id, checkpointSceneId: f.entry.id, progressRevision: 4,
      pathSummary: [], visitedEndingKeys: ['known-ending'],
    });
    expect(f.checkpoints).toEqual([expect.objectContaining({ storyVersion: 2, progressRevision: 4, sceneId: f.entry.id, visitedEndingKeys: ['known-ending'] })]);
    expect(f.events[0]).toMatchObject({ choiceId: 'old-choice', invalidatedAt: expect.any(Date) });
    expect(f.mutations.qualityUpsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ releaseId: 'release-b' }) }));
    expect(f.quotaUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { userId_workId_scopeKey: { userId: 'reader', workId: 'work', scopeKey: 'full' } }, update: {} }));
    expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    const result = await f.production.selectChoice('reader', 'progress', f.choice.id, 4, 'en');
    expect(result).toMatchObject({ revision: 5, storyVersion: 2, scene: { id: f.target.id }, releaseCapability: firstReleaseChoiceCapability() });
    expect(f.events).toHaveLength(2);
    expect(f.events[1]).toMatchObject({ choiceId: f.choice.id, invalidatedAt: null });
    const afterChoice = JSON.stringify(f.progress);
    await expect(f.controls.executeReset('reader', 'progress', f.body, 'release-switch-reset')).resolves.toMatchObject({ idempotentReplay: true });
    expect(JSON.stringify(f.progress)).toBe(afterChoice);
    expect(f.bucket.usedCount).toBe(1);
    expect(f.quotaUpdate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.allowances)).toBe(allowanceBefore);
    expect(JSON.stringify(f.entitlement)).toBe(entitlementBefore);
    await expect(f.economics.readerCapability('reader', 'work')).resolves.toMatchObject({ aiAllowanceRemaining: 3 });
    expect(f.mutations.allowanceUpsert).not.toHaveBeenCalled();
    expect(f.mutations.usageCreate).not.toHaveBeenCalled();
    expect(f.mutations.requestCreate).not.toHaveBeenCalled();
    await expect(f.controls.submitCustomChoice('reader', 'progress', { input: 'Still deferred', expectedRevision: 5 }, 'custom-after-reset')).rejects.toMatchObject({ response: { code: 'STORY_CUSTOM_CHOICE_DEFERRED' } });
  });

  it.each([0, 100])('rejects invalid reset before any quota/write at price %s', async (price) => {
    for (const invalid of ['missing-release', 'inactive-release', 'foreign-release', 'release-version', 'unpublished-work', 'missing-config', 'inactive-config', 'invalid-reset-limit', 'missing-rate', 'inactive-rate', 'missing-target', 'stale-revision']) {
      const f = releaseSwitchResetFixture(price);
      if (invalid === 'missing-release') f.work.activeReleaseId = null as never;
      if (invalid === 'inactive-release') f.release.status = 'retired';
      if (invalid === 'foreign-release') f.release.workId = 'foreign';
      if (invalid === 'release-version') f.release.version = 1;
      if (invalid === 'unpublished-work') f.work.status = 'sale_suspended';
      if (invalid === 'missing-config') f.prisma.storyReleaseCapability.findUnique.mockResolvedValue(null);
      if (invalid === 'inactive-config') f.config.status = 'inactive';
      if (invalid === 'invalid-reset-limit') f.config.fullResetLimit = 0;
      if (invalid === 'missing-rate') f.prisma.storyAiRateCard.findUnique.mockResolvedValue(null);
      if (invalid === 'inactive-rate') f.rateCard.status = 'retired';
      if (invalid === 'missing-target') f.prisma.storyScene.findMany.mockResolvedValue([]);
      if (invalid === 'stale-revision') f.body.expectedRevision = 2;
      const before = JSON.stringify({ progress: f.progress, events: f.events, bucket: f.bucket, allowances: f.allowances, entitlement: f.entitlement });
      await expect(f.controls.executeReset('reader', 'progress', f.body, 'invalid-reset')).rejects.toBeDefined();
      expect(JSON.stringify({ progress: f.progress, events: f.events, bucket: f.bucket, allowances: f.allowances, entitlement: f.entitlement })).toBe(before);
      expectNoWrites(f);
      for (const mutation of [f.quotaUpsert, f.quotaUpdate, f.commandCreate, f.invalidateEvents, f.auditCreate]) expect(mutation).not.toHaveBeenCalled();
      expect(f.checkpoints).toEqual([]);
    }
  });

  it.each(['expired', 'revoked', 'foreign', 'wrong-type'])('preserves paid access checks for %s access', async (invalid) => {
    const f = releaseSwitchResetFixture(100);
    if (invalid === 'expired') f.entitlement.expiresAt = new Date(0);
    if (invalid === 'revoked') f.entitlement.revokedAt = new Date();
    if (invalid === 'wrong-type') f.entitlement.entitlementType = 'unrelated';
    await expect(f.controls.executeReset(invalid === 'foreign' ? 'foreign-user' : 'reader', 'progress', f.body, 'access-reset')).rejects.toBeDefined();
    expect(f.quotaUpsert).not.toHaveBeenCalled();
    expectNoWrites(f);
  });

  it('keeps act reset version-bound and never replenishes exhausted full-reset quota', async () => {
    const f = releaseSwitchResetFixture(0);
    await expect(f.controls.executeReset('reader', 'progress', { ...f.body, target: 'act', actNumber: 1 }, 'act-reset')).rejects.toMatchObject({ response: { code: 'STORY_RESET_VERSION_MISMATCH' } });
    expect(f.quotaUpsert).not.toHaveBeenCalled();
    f.bucket.usedCount = 1;
    await expect(f.controls.executeReset('reader', 'progress', f.body, 'exhausted-reset')).rejects.toMatchObject({ response: { code: 'STORY_RESET_QUOTA_EXHAUSTED' } });
    expect(f.bucket.usedCount).toBe(1);
    expect(f.commandCreate).not.toHaveBeenCalled();
    expectNoWrites(f);
    expect(f.progress).toMatchObject(f.oldPin);
  });
});

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
  it('does not mutate progress or start generation for a generation-required choice', async () => {
    const f = fixture();
    f.choices[1].routeKind = 'generation_required';
    f.choices[1].targetSceneId = null as never;
    await expect(f.production.selectChoice('reader', 'progress', 'choice-2', 3))
      .rejects.toMatchObject({ response: {
        code: 'STORY_CHOICE_GENERATION_REQUIRED',
        progressMutated: false,
        generationStarted: false,
      } });
    expectNoWrites(f);
  });

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

  it('blocks publication when the release manuscript has an unresolved critical continuity issue', async () => {
    const f = fixture();
    const tx = {
      ...f.prisma,
      storyWork: { findUnique: jest.fn().mockResolvedValue({ ...f.work, status: 'release_ready', releaseRevision: 1 }), updateMany: jest.fn() },
      storyRelease: {
        findFirst: jest.fn().mockResolvedValue({ id: 'release', manuscriptVersionId: 'manuscript-1', validationSummary: { ready: true } }),
        update: jest.fn(),
      },
      storyPublicationTransition: { findUnique: jest.fn().mockResolvedValue(null) },
      storyAnalysisJob: { findFirst: jest.fn().mockResolvedValue({ id: 'analysis-1' }) },
      storyContinuityIssue: { count: jest.fn().mockResolvedValue(1) },
    };
    f.prisma.$transaction.mockImplementation(async (run) => run(tx));
    const lifecycle = new StoryLifecycleService({ ...tx, $transaction: f.prisma.$transaction } as never);

    await expect(lifecycle.transitionPublication(
      'admin',
      'work',
      { toStatus: 'published', releaseId: 'release', expectedRevision: 1 } as never,
      'publish-critical-key-123',
    )).rejects.toThrow('Unresolved critical continuity issue blocks publication');

    expect(tx.storyContinuityIssue.count).toHaveBeenCalledWith({
      where: {
        workId: 'work', analysisJobId: 'analysis-1', severity: 'critical', status: 'open',
        pathScope: 'author_original', pathKey: 'author_original',
      },
    });
    expect(tx.storyWork.updateMany).not.toHaveBeenCalled();
    expect(tx.storyRelease.update).not.toHaveBeenCalled();
  });
});

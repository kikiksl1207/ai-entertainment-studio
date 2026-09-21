import * as policy from './story-imjin-release-bridge.policy';
import { StoryImjinReleaseBridgeService } from './story-imjin-release-bridge.service';
import { StoryProductionService } from './story-production.service';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { Prisma } from '@prisma/client';

jest.mock('./story-imjin-release-bridge.policy', () => ({
  ...jest.requireActual('./story-imjin-release-bridge.policy'),
  prepareImjinReleasePlan: jest.fn(),
}));

const plan: policy.ImjinReleasePlan = {
  source: { byteLength: 10, sha256: 'a'.repeat(64), partCount: 2 },
  parts: [1, 2].map((number) => ({
    partKey: `part-0${number}`,
    title: `Synthetic ${number}`,
    sceneKey: `part-0${number}-main`,
    beats: [`Synthetic beat ${number}`],
    choices: [
      { choiceKey: 'A' as const, label: 'A', routeKind: 'writer_original' as const,
        targetPartKey: number === 1 ? 'part-02' : null, targetEndingKey: number === 2 ? 'author_main' : null },
      { choiceKey: 'B' as const, label: 'B', routeKind: 'generation_required' as const,
        targetPartKey: null, targetEndingKey: null },
      { choiceKey: 'C' as const, label: 'C', routeKind: 'generation_required' as const,
        targetPartKey: null, targetEndingKey: null },
    ],
    privateDirectives: [{
      type: 'character' as const, ordinal: null, value: `Private direction ${number}`, sourceLine: 1,
    }],
    sceneDirectiveCount: 1,
    backgroundDirectiveCount: 1,
  })),
};

function fixture(overrides: Record<string, unknown> = {}, sourceText = 'private-source') {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'work' }]),
    storyWork: { findUnique: jest.fn().mockResolvedValue({
      id: 'work', status: 'release_ready', fixtureSource: false,
      priceLumina: { isZero: () => true }, customChoiceEnabled: false,
    }) },
    storyRelease: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'release', status: 'candidate', manuscriptVersionId: 'manuscript', checksum: 'checksum',
        validationSummary: { ready: true, blockingIssueCount: 0 }, diffSummary: {},
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    storyReleaseCapability: { findUnique: jest.fn().mockResolvedValue({
      status: 'active', fixedChoiceCount: 3, customChoiceEnabled: false, rateCardId: 'rate-card',
    }) },
    storyAiRateCard: { findUnique: jest.fn().mockResolvedValue({ status: 'active' }) },
    storyAnalysisJob: { findFirst: jest.fn().mockResolvedValue({ id: 'analysis' }) },
    storyContinuityIssue: { count: jest.fn().mockResolvedValue(0) },
    storyPart: { count: jest.fn().mockResolvedValue(0), createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    storyScene: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    storyBeat: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    storyChoice: { createMany: jest.fn().mockResolvedValue({ count: 6 }) },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    ...overrides,
  };
  const prisma = {
    storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue({
      id: 'manuscript', structuredBody: { intake: { source: { kind: 'utf8_paste', rawText: sourceText } } },
    }) },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { tx, prisma, service: new StoryImjinReleaseBridgeService(prisma as never) };
}

describe('StoryImjinReleaseBridgeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(policy.prepareImjinReleasePlan).mockReturnValue(plan);
  });

  it('defaults to dry-run and performs no transaction writes', async () => {
    const f = fixture();
    const result = await f.service.execute('admin', 'work', { manuscriptVersionId: 'manuscript', apply: false });
    expect(result).toMatchObject({ mode: 'dry_run', applyExecuted: false, rawManuscriptIncluded: false });
    expect(JSON.stringify(result)).not.toContain('private-source');
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails closed before a transaction when apply is not explicitly bound', async () => {
    const f = fixture();
    await expect(f.service.execute('admin', 'work', {
      manuscriptVersionId: 'manuscript', apply: true,
    })).rejects.toMatchObject({ response: { code: 'IMJIN_IMPORT_IDEMPOTENCY_REQUIRED' } });
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rolls back before writes when publication prerequisites are not ready', async () => {
    const f = fixture({
      storyContinuityIssue: { count: jest.fn().mockResolvedValue(1) },
    });
    await expect(f.service.execute('admin', 'work', {
      manuscriptVersionId: 'manuscript', apply: true, releaseId: 'release', expectedReleaseChecksum: 'checksum',
    }, 'idempotency-key')).rejects.toMatchObject({ response: { code: 'IMJIN_IMPORT_CONTINUITY_BLOCKED' } });
    expect(f.tx.storyPart.createMany).not.toHaveBeenCalled();
    expect(f.tx.storyRelease.update).not.toHaveBeenCalled();
  });

  it('materializes A only and preserves B/C as generation-required with no target', async () => {
    const f = fixture();
    const result = await f.service.execute('admin', 'work', {
      manuscriptVersionId: 'manuscript', apply: true, releaseId: 'release', expectedReleaseChecksum: 'checksum',
    }, 'idempotency-key');
    const rows = f.tx.storyChoice.createMany.mock.calls[0][0].data as Array<Record<string, unknown>>;
    expect(rows.filter((row) => row.routeKind === 'generation_required')).toHaveLength(4);
    expect(rows.filter((row) => row.routeKind === 'generation_required'))
      .toEqual(expect.arrayContaining([expect.objectContaining({ targetSceneId: null, targetEndingKey: null })]));
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ choiceKey: 'A', targetEndingKey: 'author_main' }),
    ]));
    expect(f.tx.storyScene.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ endingType: null }), expect.objectContaining({ endingType: null })],
    }));
    expect(result).toMatchObject({ mode: 'apply', applyExecuted: true, idempotentReplay: false });
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metadata: expect.objectContaining({ rawSourceIncluded: false }) }),
    }));
    expect(f.tx.storyRelease.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { diffSummary: expect.objectContaining({
        privateProductionDirectives: expect.objectContaining({
          public: false,
          parts: expect.arrayContaining([expect.objectContaining({
            directives: expect.arrayContaining([expect.objectContaining({ type: 'character' })]),
          })]),
        }),
      }) },
    }));
    expect(JSON.stringify(result)).not.toContain('Private direction');
  });

  it('replays only the same idempotency payload without duplicate writes', async () => {
    const f = fixture();
    const key = 'idempotency-key';
    const payloadHash = createHash('sha256').update(JSON.stringify({
      workId: 'work', manuscriptVersionId: 'manuscript', releaseId: 'release',
      expectedReleaseChecksum: 'checksum', sourceSha256: plan.source.sha256,
    })).digest('hex');
    f.tx.storyRelease.findFirst.mockResolvedValue({
      id: 'release', status: 'candidate', manuscriptVersionId: 'manuscript', checksum: 'checksum',
      validationSummary: { ready: true, blockingIssueCount: 0 },
      diffSummary: { importBridge: {
        keyHash: createHash('sha256').update(key).digest('hex'), payloadHash,
      } },
    });
    await expect(f.service.execute('admin', 'work', {
      manuscriptVersionId: 'manuscript', apply: true, releaseId: 'release', expectedReleaseChecksum: 'checksum',
    }, key)).resolves.toMatchObject({ idempotentReplay: true });
    expect(f.tx.storyPart.createMany).not.toHaveBeenCalled();
  });

  it('sanitizes unexpected transaction failures that may contain manuscript content', async () => {
    const f = fixture();
    f.prisma.$transaction.mockRejectedValue(new Error('private-source Synthetic beat'));
    let failure: unknown;
    try {
      await f.service.execute('admin', 'work', {
        manuscriptVersionId: 'manuscript', apply: true, releaseId: 'release', expectedReleaseChecksum: 'checksum',
      }, 'idempotency-key');
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ response: { code: 'IMJIN_IMPORT_TRANSACTION_FAILED' } });
    expect(JSON.stringify(failure)).not.toContain('private-source');
    expect(JSON.stringify(failure)).not.toContain('Synthetic beat');
  });

  const actualSourcePath = process.env.IMJIN_ACTUAL_SOURCE_PATH;
  (actualSourcePath ? it : it.skip)('materializes the actual 75-part plan and reads 75 before only 75A completes (real services, explicit persistence double)', async () => {
    const raw = readFileSync(actualSourcePath!);
    const actualPolicy = jest.requireActual<typeof policy>('./story-imjin-release-bridge.policy');
    const actualPlan = actualPolicy.prepareImjinReleasePlan(raw);
    jest.mocked(policy.prepareImjinReleasePlan).mockImplementation(actualPolicy.prepareImjinReleasePlan);
    const f = fixture({}, raw.toString('utf8'));
    await f.service.execute('admin', 'work', {
      manuscriptVersionId: 'manuscript', apply: true, releaseId: 'release', expectedReleaseChecksum: 'checksum',
    }, 'actual-75-ending-regression');
    const parts = f.tx.storyPart.createMany.mock.calls[0][0].data as Array<Prisma.StoryPartCreateManyInput & { id: string }>;
    const scenes = f.tx.storyScene.createMany.mock.calls[0][0].data as Array<Prisma.StorySceneCreateManyInput & { id: string }>;
    const beats = (f.tx.storyBeat.createMany.mock.calls[0][0].data as Prisma.StoryBeatCreateManyInput[])
      .map((row, index) => ({ ...row, id: `beat-${index}` }));
    const choices = (f.tx.storyChoice.createMany.mock.calls[0][0].data as Prisma.StoryChoiceCreateManyInput[]).map((row, index) => ({
      ...row, id: `choice-${index}`, declaredRejoinSceneId: null,
    }));
    expect(parts).toHaveLength(75); expect(scenes).toHaveLength(75); expect(choices).toHaveLength(225);
    expect(scenes.every((scene) => scene.endingType === null)).toBe(true);
    const last = scenes[74]; const prior = scenes[73];
    const a74 = choices.find((choice) => choice.sceneId === prior.id && choice.choiceKey === 'A')!;
    const a75 = choices.find((choice) => choice.sceneId === last.id && choice.choiceKey === 'A')!;
    expect(a74).toMatchObject({ targetSceneId: last.id, targetEndingKey: null });
    expect(a75).toMatchObject({ targetSceneId: null, targetEndingKey: 'author_main' });
    const lastChoices = choices.filter((choice) => choice.sceneId === last.id);
    expect(lastChoices.slice(1).map(({ routeKind, targetSceneId, targetEndingKey }) =>
      ({ routeKind, targetSceneId, targetEndingKey }))).toEqual([
      { routeKind: 'generation_required', targetSceneId: null, targetEndingKey: null },
      { routeKind: 'generation_required', targetSceneId: null, targetEndingKey: null },
    ]);

    const progress = {
      id: 'progress', userId: 'reader', workId: 'work', activeReleaseId: 'release', storyVersion: 1,
      currentSceneId: prior.id, currentGeneratedSceneId: null, currentBeatPosition: 0, currentAct: 5,
      progressRevision: 1, status: 'active', routeNodeId: null, checkpointSceneId: prior.id,
      pathSummary: [], seenSceneIds: [prior.id], visitedEndingKeys: [],
    };
    const work = { id: 'work', status: 'published', fixtureSource: false, publishedVersion: 1,
      activeReleaseId: 'release', defaultLocale: 'ko', priceLumina: { isZero: () => true } };
    const ending = jest.fn().mockResolvedValue({});
    const tx = {
      storyReaderProgress: {
        findFirst: jest.fn(async () => ({ ...progress })),
        updateMany: jest.fn(async ({ where, data }: { where: { progressRevision: number }; data: Record<string, any> }) => {
          if (where.progressRevision !== progress.progressRevision) return { count: 0 };
          const { progressRevision, ...rest } = data;
          for (const [key, value] of Object.entries(rest)) if (value !== undefined) Object.assign(progress, { [key]: value });
          progress.progressRevision += progressRevision.increment;
          return { count: 1 };
        }),
      },
      storyWork: { findFirst: jest.fn(async () => work), findUnique: jest.fn(async () => work) },
      storyRelease: { findFirst: jest.fn().mockResolvedValue({ id: 'release', workId: 'work', status: 'active', version: 1,
        manuscriptVersionId: 'manuscript', checksum: 'checksum' }) },
      storyPart: { findFirst: jest.fn(async ({ where }: { where: { id: string } }) => parts.find((part) => part.id === where.id)),
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => parts.find((part) => part.id === where.id)) },
      storyScene: { findFirst: jest.fn(async ({ where }: { where: { id: string } }) => scenes.find((scene) => scene.id === where.id)),
        findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => scenes.filter((scene) => where.id.in.includes(scene.id))) },
      storyBeat: { findMany: jest.fn(async ({ where }: { where: { sceneId: string } }) => beats.filter((beat) => beat.sceneId === where.sceneId)) },
      storyChoice: { findMany: jest.fn(async ({ where }: { where: { sceneId: string } }) => choices.filter((choice) => choice.sceneId === where.sceneId)) },
      contentRightsContract: { findFirst: jest.fn().mockResolvedValue(null) },
      storyChoiceEvent: { create: jest.fn().mockResolvedValue({}) },
      storyEndingDiscovery: { upsert: ending },
      storyQualityEvent: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { ...tx, $transaction: async (run: (client: typeof tx) => unknown) => run(tx) };
    const reader = new StoryProductionService(prisma as never);
    const result = await reader.selectChoice('reader', progress.id, a74.id, 1, 'ko') as {
      status: string; revision: number; scene: { id: string; beats: Array<{ content: { value: string } }> };
      choices: Array<{ id: string; routeKind: string }>;
    };
    expect(result.status).toBe('active'); expect(result.scene.id).toBe(last.id);
    const digest = (texts: string[]) => createHash('sha256').update(JSON.stringify(texts)).digest('hex');
    expect(digest(result.scene.beats.map((beat) => beat.content.value))).toBe(digest(actualPlan.parts[74].beats));
    expect(result.choices.map((choice) => choice.id)).toEqual(lastChoices.map((choice) => choice.id));
    expect(result.choices.map((choice) => choice.routeKind)).toEqual(['writer_original', 'generation_required', 'generation_required']);
    expect(progress.currentSceneId).toBe(last.id); expect(progress.visitedEndingKeys).toEqual([]);
    expect(ending).not.toHaveBeenCalled();
    for (const alternative of lastChoices.slice(1)) {
      await expect(reader.selectChoice('reader', progress.id, alternative.id, result.revision, 'ko'))
        .rejects.toMatchObject({ response: { code: 'STORY_AI_LEGAL_ACTIVATION_REQUIRED' } });
    }
    expect(progress.currentSceneId).toBe(last.id); expect(progress.progressRevision).toBe(result.revision);
    await expect(reader.selectChoice('reader', progress.id, a75.id, result.revision, 'ko')).resolves.toMatchObject({
      status: 'completed', scene: null, choices: [],
    });
    expect(progress.currentSceneId).toBeNull(); expect(progress.visitedEndingKeys).toEqual(['author_main']);
    expect(ending).toHaveBeenCalledTimes(1);
  });
});

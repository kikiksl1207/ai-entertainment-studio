import * as policy from './story-imjin-release-bridge.policy';
import { StoryImjinReleaseBridgeService } from './story-imjin-release-bridge.service';
import { createHash } from 'crypto';

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
        targetPartKey: number === 1 ? 'part-02' : null, targetEndingKey: number === 2 ? 'writer-primary' : null },
      { choiceKey: 'B' as const, label: 'B', routeKind: 'generation_required' as const,
        targetPartKey: null, targetEndingKey: null },
      { choiceKey: 'C' as const, label: 'C', routeKind: 'generation_required' as const,
        targetPartKey: null, targetEndingKey: null },
    ],
    sceneDirectiveCount: 1,
    backgroundDirectiveCount: 1,
  })),
};

function fixture(overrides: Record<string, unknown> = {}) {
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
      id: 'manuscript', structuredBody: { intake: { source: { kind: 'utf8_paste', rawText: 'private-source' } } },
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
    expect(result).toMatchObject({ mode: 'apply', applyExecuted: true, idempotentReplay: false });
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metadata: expect.objectContaining({ rawSourceIncluded: false }) }),
    }));
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
});

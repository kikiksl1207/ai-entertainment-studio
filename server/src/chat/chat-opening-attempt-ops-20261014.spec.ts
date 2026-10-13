import { ChatService } from './chat.service';
import type { ChatGenerationResult } from './llm-provider.adapter';

const OWNER = '00000000-0000-4000-8000-000000000951';
const OTHER_OWNER = '00000000-0000-4000-8000-000000000952';
const ARTIST = '00000000-0000-4000-8000-000000000953';
const DAY_START = new Date('2026-10-13T15:00:00.000Z');
const SCHEMA = '2026-05-22.character-chat-opening-greeting-v1';
const CONTRACT = '2026-06-05.character-chat-opening-greeting-variants.v1';
const PROVIDER = 'synthetic-provider';
const MODEL = 'synthetic-success-model';

type Row = {
  messageType: unknown;
  modelMetadata: unknown;
  safetyMetadata: unknown;
};
type Stats = {
  totalResponses: number;
  failureCount: number;
  fallbackCount: number;
  usageByModel: Array<{
    provider: string;
    model: string;
    responses: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostKrw: string;
  }>;
  estimatedCostKrw: string;
};
type Candidate = {
  body: string;
  source: 'provider' | 'fallback';
  providerCall: boolean;
  providerAttempted: boolean;
  fallbackReason?: string;
  generated?: ChatGenerationResult;
  toneCandidate: {
    contractVersion: string;
    characterSlug: string;
    guideKo: string;
    guideSource: string;
    toneTags: string[];
    personaTags: string[];
    displaySafe: true;
    rawPersonaPromptStored: false;
  };
};
type SourceProbe = {
  openingGreetingModelMetadata(candidate: Candidate): Record<string, unknown>;
  openingGreetingSafetyMetadata(candidate: Candidate): Record<string, unknown>;
  providerOpsStatsForUser(owner: string, day: Date): Promise<Stats>;
  koreaServiceDayStartUtc(now: Date): Date;
};

const generated: ChatGenerationResult = {
  body: 'Synthetic greeting.',
  usage: {
    provider: PROVIDER,
    model: MODEL,
    inputTokens: 12,
    outputTokens: 24,
    estimatedCostKrw: '0.04',
  },
  safetyMetadata: { provider: PROVIDER, generationStatus: 'completed' },
};

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    body: 'Synthetic local greeting.',
    source: 'fallback',
    providerCall: false,
    providerAttempted: true,
    fallbackReason: 'provider_timeout',
    toneCandidate: {
      contractVersion: 'synthetic-tone-contract',
      characterSlug: 'synthetic-character',
      guideKo: 'Synthetic guide.',
      guideSource: 'synthetic-fixture',
      toneTags: [],
      personaTags: [],
      displaySafe: true,
      rawPersonaPromptStored: false,
    },
    ...overrides,
  };
}

const fixtures: Array<{ forbidden: jest.Mock; providerGenerate: jest.Mock }> = [];

function fixture() {
  const forbidden = jest.fn(() => {
    throw new Error('Unexpected write, raw query, wallet or extra dependency call');
  });
  const providerGenerate = jest.fn(() => {
    throw new Error('Provider generation is forbidden in this read-only fixture');
  });
  const writes = {
    create: forbidden,
    createMany: forbidden,
    update: forbidden,
    updateMany: forbidden,
    upsert: forbidden,
    delete: forbidden,
    deleteMany: forbidden,
  };
  const prisma = {
    user: {
      ...writes,
      findUnique: jest.fn().mockResolvedValue({ id: OWNER, email: 'owner@example.invalid' }),
    },
    artist: {
      ...writes,
      findFirst: jest.fn().mockResolvedValue({
        id: ARTIST, slug: 'synthetic-character', displayName: 'Synthetic Character',
      }),
      findUnique: forbidden,
    },
    chatMessage: {
      ...writes,
      findMany: jest.fn(),
      findFirst: jest.fn().mockImplementation(async (input: {
        select?: Record<string, unknown>;
      }) => {
        if (!input.select || Object.keys(input.select).some((key) =>
          !['id', 'createdAt'].includes(key))) {
          throw new Error('Cooldown queries may not read message bodies');
        }
        return null;
      }),
      count: jest.fn().mockResolvedValue(0),
    },
    chatSession: { ...writes, findFirst: forbidden, findMany: forbidden },
    chatFeatureOrder: { ...writes, findFirst: forbidden },
    walletAccount: { ...writes, findUnique: forbidden },
    walletLedger: { ...writes, findMany: forbidden },
    $transaction: forbidden,
    $queryRaw: forbidden,
    $queryRawUnsafe: forbidden,
    $executeRaw: forbidden,
    $executeRawUnsafe: forbidden,
  };
  const provider = {
    readiness: jest.fn().mockReturnValue({
      provider: PROVIDER, configured: true, status: 'provider_ready',
      messageKey: 'chat.generation.ready',
    }),
    generate: providerGenerate,
    fallbackResult: forbidden,
  };
  const service = new ChatService(prisma as never, provider as never);
  const probe = service as unknown as SourceProbe;
  // Fix only this instance's service-day projection, not the global clock.
  jest.spyOn(probe, 'koreaServiceDayStartUtc').mockReturnValue(DAY_START);
  let rows: Row[] = [];
  prisma.chatMessage.findMany.mockImplementation(async (input: {
    select?: Record<string, unknown>;
  }) => {
    if (!input.select || Object.keys(input.select).some((key) =>
      !['messageType', 'modelMetadata', 'safetyMetadata'].includes(key))) {
      throw new Error('Only classification metadata may be selected; no body reads');
    }
    return rows;
  });
  const result = {
    service, probe, prisma, provider, forbidden, providerGenerate,
    setRows(value: Row[]) { rows = value; },
    stats(owner = OWNER) { return probe.providerOpsStatsForUser(owner, DAY_START); },
  };
  fixtures.push(result);
  return result;
}

function openingRow(probe: SourceProbe, overrides: Partial<Candidate> = {}): Row {
  const input = candidate(overrides);
  return {
    messageType: 'opening_greeting',
    modelMetadata: probe.openingGreetingModelMetadata(input),
    safetyMetadata: probe.openingGreetingSafetyMetadata(input),
  };
}

function withModel(row: Row, overrides: Record<string, unknown>): Row {
  return { ...row, modelMetadata: { ...(row.modelMetadata as Record<string, unknown>), ...overrides } };
}

function withSafety(row: Row, overrides: Record<string, unknown>): Row {
  return { ...row, safetyMetadata: { ...(row.safetyMetadata as Record<string, unknown>), ...overrides } };
}

function basicFallback(): Row {
  return {
    messageType: 'text',
    modelMetadata: {
      provider: PROVIDER, model: 'fallback',
      usage: { provider: PROVIDER, model: 'fallback', inputTokens: 0, outputTokens: 0, estimatedCostKrw: '0.00' },
      estimatedCostKrw: '0.00',
    },
    safetyMetadata: { provider: PROVIDER, generationStatus: 'fallback', reason: 'provider_timeout' },
  };
}

const emptyStats: Stats = {
  totalResponses: 0, failureCount: 0, fallbackCount: 0,
  usageByModel: [], estimatedCostKrw: '0.00',
};

describe('ChatService opening attempt ops read aggregation', () => {
  let http: jest.SpyInstance;

  beforeEach(() => {
    fixtures.length = 0;
    http = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('HTTP is forbidden in this synthetic fixture');
    });
  });

  afterEach(() => {
    try {
      expect(http).not.toHaveBeenCalled();
      for (const f of fixtures) {
        expect(f.forbidden).not.toHaveBeenCalled();
        expect(f.providerGenerate).not.toHaveBeenCalled();
      }
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('counts exact producer-marked failed openings once without inventing usage', async () => {
    const f = fixture();
    for (const reason of ['provider_timeout', 'provider_empty_response', 'provider_failed', 'provider_synthetic_future_error']) {
      const row = openingRow(f.probe, { fallbackReason: reason });
      expect(row.modelMetadata).toMatchObject({
        usageSchemaVersion: SCHEMA, contractVersion: CONTRACT,
        purpose: 'opening_greeting', source: 'fallback', fallbackReason: reason,
      });
      expect(row.safetyMetadata).toMatchObject({
        contractVersion: CONTRACT, purpose: 'opening_greeting',
        openingGreetingSource: 'fallback', providerAttempted: true, fallbackReason: reason,
      });
      f.setRows([row]);
      expect(await f.stats()).toEqual({
        ...emptyStats, totalResponses: 1, failureCount: 1, fallbackCount: 1,
      });
    }
  });

  it('excludes nonattempts and contradictory blocked or disabled attempt flags', async () => {
    const f = fixture();
    for (const reason of ['provider_guard_blocked', 'provider_disabled', 'provider_not_configured', 'provider_not_allowed']) {
      for (const providerAttempted of [false, true]) {
        f.setRows([openingRow(f.probe, { fallbackReason: reason, providerAttempted })]);
        expect(await f.stats()).toEqual(emptyStats);
      }
    }
  });

  it('rejects malformed unversioned inconsistent and wrong-type untracked metadata', async () => {
    const f = fixture();
    const row = openingRow(f.probe);
    const invalid: Row[] = [
      withSafety(row, { providerAttempted: undefined }),
      withSafety(row, { providerAttempted: false }),
      withSafety(row, { providerAttempted: 'true' }),
      withSafety(row, { providerAttempted: 1 }),
      withSafety(row, { providerAttempted: null }),
      withModel(row, { usageSchemaVersion: undefined }),
      withModel(row, { usageSchemaVersion: 'unknown-schema' }),
      withModel(row, { contractVersion: undefined }),
      withSafety(row, { contractVersion: 'unknown-contract' }),
      withModel(row, { purpose: 'text' }),
      withSafety(row, { purpose: 'text' }),
      withModel(row, { source: 'provider' }),
      withSafety(row, { openingGreetingSource: 'provider' }),
      withModel(row, { fallbackReason: '' }),
      withSafety(row, { fallbackReason: '   ' }),
      withModel(row, { fallbackReason: 1 }),
      withSafety(row, { fallbackReason: ['provider_timeout'] }),
      withSafety(row, { fallbackReason: 'provider_empty_response' }),
      withSafety(withModel(row, { fallbackReason: '' }), { fallbackReason: '' }),
      withSafety(withModel(row, { fallbackReason: '   ' }), { fallbackReason: '   ' }),
      { ...row, messageType: 'text' },
      { ...row, messageType: undefined },
      { ...row, modelMetadata: [row.modelMetadata] },
      { ...row, safetyMetadata: [row.safetyMetadata] },
      { ...row, modelMetadata: null },
      { ...row, safetyMetadata: null },
      { ...row, modelMetadata: 'opening_greeting' },
      { ...row, safetyMetadata: { purpose: 'opening_greeting', fallbackReason: 'provider_timeout' } },
    ];
    for (const value of invalid) {
      f.setRows([value]);
      expect(await f.stats()).toEqual(emptyStats);
    }
  });

  it('preserves tracked success basic fallback and overlapping legacy markers once', async () => {
    const f = fixture();
    const success = openingRow(f.probe, {
      source: 'provider', providerCall: true, fallbackReason: undefined, generated,
    });
    const overlap = withSafety(withModel(openingRow(f.probe), {
      provider: PROVIDER, model: 'synthetic-legacy-model',
      usage: { inputTokens: 3, outputTokens: 5, estimatedCostKrw: '0.00' },
    }), { generationStatus: 'fallback', reason: 'provider_timeout' });
    f.setRows([success, basicFallback(), overlap]);
    expect(await f.stats()).toEqual({
      totalResponses: 3, failureCount: 2, fallbackCount: 2, estimatedCostKrw: '0.04',
      usageByModel: [
        { provider: PROVIDER, model: MODEL, responses: 1, inputTokens: 12, outputTokens: 24, estimatedCostKrw: '0.04' },
        { provider: PROVIDER, model: 'fallback', responses: 1, inputTokens: 0, outputTokens: 0, estimatedCostKrw: '0.00' },
        { provider: PROVIDER, model: 'synthetic-legacy-model', responses: 1, inputTokens: 3, outputTokens: 5, estimatedCostKrw: '0.00' },
      ],
    });
  });

  it('keeps mixed unknown-attempt totals separate from known model usage and costs', async () => {
    const f = fixture();
    const success = openingRow(f.probe, {
      source: 'provider', providerCall: true, fallbackReason: undefined, generated,
    });
    f.setRows([openingRow(f.probe), success, basicFallback(), openingRow(f.probe, { fallbackReason: 'provider_empty_response' })]);
    const stats = await f.stats();
    expect(stats).toMatchObject({ totalResponses: 4, failureCount: 3, fallbackCount: 3, estimatedCostKrw: '0.04' });
    expect(stats.usageByModel).toEqual([
      { provider: PROVIDER, model: MODEL, responses: 1, inputTokens: 12, outputTokens: 24, estimatedCostKrw: '0.04' },
      { provider: PROVIDER, model: 'fallback', responses: 1, inputTokens: 0, outputTokens: 0, estimatedCostKrw: '0.00' },
    ]);
    expect(stats.usageByModel.reduce((sum, value) => sum + value.responses, 0)).toBe(2);
    expect(stats.usageByModel.every((value) => value.provider !== 'unknown' && value.model !== 'unknown')).toBe(true);
  });

  it('captures unchanged owner day artist and paid filters with metadata-only projection', async () => {
    const f = fixture();
    for (const owner of [OWNER, OTHER_OWNER]) {
      await f.stats(owner);
      expect(f.prisma.chatMessage.findMany).toHaveBeenLastCalledWith({
        where: {
          senderType: 'artist', chatFeatureOrderId: null,
          createdAt: { gte: DAY_START }, chatSession: { userId: owner },
        },
        select: { messageType: true, modelMetadata: true, safetyMetadata: true },
      });
    }
    expect(f.prisma.chatMessage.findMany).toHaveBeenCalledTimes(2);
  });

  it('propagates metadata read failure rather than publishing a zero-count success', async () => {
    const f = fixture();
    const failure = new Error('Synthetic metadata read unavailable');
    f.prisma.chatMessage.findMany.mockRejectedValue(failure);
    await expect(f.stats()).rejects.toBe(failure);
    await expect(f.service.getProviderOpsStatus(OWNER)).rejects.toBe(failure);
    await expect(f.service.getUsageSummary(OWNER, { artistId: ARTIST })).rejects.toBe(failure);
  });

  it('feeds existing request50 failure5 status and summary guards without generation', async () => {
    for (const scenario of [
      { failures: 1, successes: 0, remaining: 49, failureRemaining: 4, allowed: true },
      { failures: 5, successes: 0, remaining: 45, failureRemaining: 0, allowed: false },
      { failures: 1, successes: 49, remaining: 0, failureRemaining: 4, allowed: false },
    ]) {
      const f = fixture();
      f.setRows([
        ...Array.from({ length: scenario.failures }, () => openingRow(f.probe)),
        ...Array.from({ length: scenario.successes }, () => openingRow(f.probe, {
          source: 'provider', providerCall: true, fallbackReason: undefined, generated,
        })),
      ]);
      const ops = await f.service.getProviderOpsStatus(OWNER);
      expect(ops.guard).toMatchObject({
        providerDailyRequestLimit: 50, providerDailyFailureLimit: 5,
        requestRemaining: scenario.remaining, failureRemaining: scenario.failureRemaining,
        canAttemptProvider: scenario.allowed, walletMutation: false, settlementMutation: false,
      });
      expect(ops.usage).toMatchObject({
        totalResponses: scenario.failures + scenario.successes,
        failureCount: scenario.failures, fallbackCount: scenario.failures,
      });
      const summary = await f.service.getUsageSummary(OWNER, { artistId: ARTIST });
      expect(summary).toMatchObject({
        canSend: scenario.allowed, canGenerate: scenario.allowed,
        providerDailyLimit: 50, providerDailyUsed: scenario.failures + scenario.successes,
        providerDailyRemaining: scenario.remaining, providerDailyFailureLimit: 5,
        providerDailyFailureCount: scenario.failures,
        providerDailyFailureRemaining: scenario.failureRemaining,
      });
      expect(f.provider.readiness).toHaveBeenCalledWith({ userId: OWNER, userEmail: 'owner@example.invalid' });
      expect(f.prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: OWNER }, select: { id: true, email: true } });
      expect(f.prisma.artist.findFirst).toHaveBeenCalledWith({ where: { id: ARTIST, status: 'active' }, select: { id: true, slug: true, displayName: true } });
    }
    const disabled = fixture();
    disabled.setRows([openingRow(disabled.probe)]);
    disabled.provider.readiness.mockReturnValue({
      provider: PROVIDER, configured: false, status: 'provider_disabled',
      messageKey: 'chat.generation.providerNotConfigured',
    });
    expect((await disabled.service.getProviderOpsStatus(OWNER)).guard).toMatchObject({
      requestRemaining: 49, failureRemaining: 4, canAttemptProvider: false,
    });
  });
});

import { NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';

const owner = '00000000-0000-4000-8000-000000000101';
const otherOwner = '00000000-0000-4000-8000-000000000102';
const artistId = '00000000-0000-4000-8000-000000000103';
const now = new Date('2026-10-15T04:00:00.000Z');
const todayStart = new Date('2026-10-14T15:00:00.000Z');
const cooldownCutoff = new Date('2026-10-15T03:59:30.000Z');
const marker = 'SYNTHETIC_FAILURE_DETAIL_NOT_FOR_READ_SUMMARY';
const accounting = {
  contract: 'chat-provider-estimate-coverage-v1',
  scope: 'stored_current_user_artist_messages_without_feature_order',
  billingStatus: 'unverified', actualProviderCostKrw: null, providerInvoiceVerified: false,
  failedProviderUsageIncluded: false, featureOrderMessagesIncluded: false,
};
type Row = { messageType: unknown; modelMetadata: unknown; safetyMetadata: unknown };
type Stats = {
  totalResponses: number; failureCount: number; fallbackCount: number;
  usageByModel: Array<{ provider: string; model: string; responses: number;
    inputTokens: number; outputTokens: number; estimatedCostKrw: string }>;
  estimatedCostKrw: string;
};
type Aggregate = { aggregateProviderOpsStats(rows: Row[]): Stats };

function failedRow(): Row {
  return { messageType: 'text', modelMetadata: { provider: 'openai', model: 'fallback',
    usage: { provider: 'openai', model: 'fallback', inputTokens: 0, outputTokens: 0, estimatedCostKrw: '0.00' } },
  safetyMetadata: { provider: 'openai', generationStatus: 'fallback', reason: 'provider_incomplete_response',
    localFallbackCostOnly: true, failedProviderResponse: { responseStatus: 'incomplete', reason: 'max_output_tokens',
      model: marker, inputTokens: 41, outputTokens: 23, estimatedCostKrw: null, billingStatus: 'unverified' } } };
}
function greetingRow(): Row {
  const purpose = 'opening_greeting', contractVersion = '2026-06-05.character-chat-opening-greeting-variants.v1';
  return { messageType: purpose,
    modelMetadata: { purpose, contractVersion, usageSchemaVersion: '2026-05-22.character-chat-opening-greeting-v1',
      source: 'fallback', fallbackReason: 'provider_incomplete_response', estimatedCostKrw: '0.00' },
    safetyMetadata: { purpose, contractVersion, openingGreetingSource: 'fallback', providerAttempted: true,
      fallbackReason: 'provider_incomplete_response', failedProviderResponseStorage: 'greeting_metadata',
      localFallbackCostOnly: true, failedProviderResponse: { inputTokens: null, outputTokens: null,
        estimatedCostKrw: null, billingStatus: 'unverified' } } };
}

function fixture(rows: Row[]) {
  const unexpected: string[] = [];
  function strict<T extends object>(name: string, methods: T): T {
    return new Proxy(methods, { get(target, key, receiver) {
      if (typeof key !== 'string' || Object.prototype.hasOwnProperty.call(target, key)) return Reflect.get(target, key, receiver);
      unexpected.push(name + '.' + key); throw new Error('Unexpected repository access');
    } });
  }
  const user = strict('user', { findUnique: jest.fn(async (query: { where: { id: string } }) => ({ id: query.where.id, email: null })) });
  const artist = strict('artist', { findFirst: jest.fn(async (): Promise<{ id: string; slug: string; displayName: string } | null> =>
    ({ id: artistId, slug: 'synthetic-estimate-reader', displayName: 'Synthetic estimate reader' })) });
  const chatMessage = strict('chatMessage', { findMany: jest.fn(async () => rows),
    findFirst: jest.fn(async () => null), count: jest.fn(async () => 7) });
  const prisma = strict('prisma', { user, artist, chatMessage });
  const blocked = () => jest.fn(() => { throw new Error('Provider dispatch forbidden in read-only coverage tests'); });
  const provider = { readiness: jest.fn(() => ({ provider: 'openai', configured: true,
    status: 'provider_ready', messageKey: 'chat.generation.ready' })), generate: blocked(), fallbackResult: blocked() };
  const service = new ChatService(prisma as never, provider as never);
  return { service, aggregate: service as unknown as Aggregate, user, artist, chatMessage, provider, unexpected };
}
function expectAccounting(value: unknown) {
  expect(value).toEqual(accounting);
  expect(Object.isFrozen(value)).toBe(true);
  expect(Object.keys(value as object)).toHaveLength(7);
}
function expectOpsQuery(f: ReturnType<typeof fixture>, actor: string, count = 1) {
  expect(f.chatMessage.findMany).toHaveBeenCalledTimes(count);
  expect(f.chatMessage.findMany).toHaveBeenLastCalledWith({ where: { senderType: 'artist', chatFeatureOrderId: null,
    createdAt: { gte: todayStart }, chatSession: { userId: actor } },
  select: { messageType: true, modelMetadata: true, safetyMetadata: true } });
}
function expectUserQuery(f: ReturnType<typeof fixture>, actor: string, count = 1) {
  expect(f.user.findUnique).toHaveBeenCalledTimes(count);
  expect(f.user.findUnique).toHaveBeenLastCalledWith({ where: { id: actor }, select: { id: true, email: true } });
}
function expectAdmissionQueries(f: ReturnType<typeof fixture>, actor: string) {
  expect(f.artist.findFirst).toHaveBeenCalledTimes(1);
  expect(f.artist.findFirst).toHaveBeenCalledWith({ where: { id: artistId, status: 'active' },
    select: { id: true, slug: true, displayName: true } });
  expect(f.chatMessage.findFirst).toHaveBeenCalledTimes(1);
  expect(f.chatMessage.findFirst).toHaveBeenCalledWith({ where: { senderType: 'user', chatFeatureOrderId: null,
    createdAt: { gte: cooldownCutoff }, chatSession: { userId: actor, artistId } },
  orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true } });
  expect(f.chatMessage.count).toHaveBeenCalledTimes(1);
  expect(f.chatMessage.count).toHaveBeenCalledWith({ where: { senderType: 'user', chatFeatureOrderId: null,
    createdAt: { gte: todayStart }, chatSession: { userId: actor, artistId } } });
}

describe('Chat provider estimate coverage (synthetic read-only service)', () => {
  const fixtures: Array<ReturnType<typeof fixture>> = [];
  function make(rows: Row[]) { const f = fixture(rows); fixtures.push(f); return f; }
  beforeEach(() => { fixtures.length = 0; jest.useFakeTimers().setSystemTime(now); });
  afterEach(() => {
    try {
      for (const f of fixtures) {
        expect(f.unexpected).toEqual([]);
        expect(f.provider.generate).not.toHaveBeenCalled(); expect(f.provider.fallbackResult).not.toHaveBeenCalled();
      }
    } finally { jest.useRealTimers(); jest.restoreAllMocks(); }
  });

  it('keeps an ordinary failed reply local usage zero without claiming a verified provider invoice', async () => {
    const rows = [failedRow()], f = make(rows);
    const expected: Stats = { totalResponses: 1, failureCount: 1, fallbackCount: 1, estimatedCostKrw: '0.00',
      usageByModel: [{ provider: 'openai', model: 'fallback', responses: 1, inputTokens: 0, outputTokens: 0, estimatedCostKrw: '0.00' }] };
    expect(f.aggregate.aggregateProviderOpsStats(rows)).toEqual(expected);
    const result = await f.service.getProviderOpsStatus(owner);
    expect(result.usage).toEqual({ ...expected, accounting }); expectAccounting(result.usage.accounting);
    expect(result.guard).toMatchObject({ requestRemaining: 49, failureRemaining: 4, canAttemptProvider: true,
      providerDailyRequestLimit: 50, providerDailyFailureLimit: 5, walletMutation: false, settlementMutation: false });
    expect(result).toMatchObject({ walletMutation: false, settlementMutation: false, secretsReturned: false });
    expect(JSON.stringify(result)).not.toContain(marker);
    expectOpsQuery(f, owner); expectUserQuery(f, owner);
    expect(f.artist.findFirst).not.toHaveBeenCalled(); expect(f.chatMessage.findFirst).not.toHaveBeenCalled();
    expect(f.chatMessage.count).not.toHaveBeenCalled(); expect(f.provider.readiness).toHaveBeenCalledTimes(1);
  });

  it('keeps attempted greeting and ordinary failure counts in the actual usage-summary preflight', async () => {
    const rows = [failedRow(), greetingRow()], f = make(rows);
    const expected = { totalResponses: 2, failureCount: 2, fallbackCount: 2, estimatedCostKrw: '0.00',
      usageByModel: [{ provider: 'openai', model: 'fallback', responses: 1, inputTokens: 0, outputTokens: 0, estimatedCostKrw: '0.00' }] };
    expect(f.aggregate.aggregateProviderOpsStats(rows)).toEqual(expected);
    const result = await f.service.getUsageSummary(owner, { artistId });
    expect(result.providerOps).toEqual({ policy: expect.any(Object), usageByModel: expected.usageByModel,
      fallbackCount: 2, estimatedCostKrw: '0.00', accounting });
    expectAccounting(result.providerOps.accounting);
    expect(result).toMatchObject({ canSend: true, canGenerate: true, dailyUsed: 7, dailyRemaining: 43,
      providerDailyUsed: 2, providerDailyRemaining: 48, providerDailyFailureCount: 2, providerDailyFailureRemaining: 3,
      walletMutation: false, settlementEligible: false, providerCall: false, rawMessagesExposed: false });
    expectOpsQuery(f, owner); expectUserQuery(f, owner); expectAdmissionQueries(f, owner);
    expect(f.provider.readiness).toHaveBeenCalledTimes(1);
  });

  it('preserves mixed legacy estimates and null numeric projection while keeping actual provider cost unknown', async () => {
    const rows: Row[] = [
      { messageType: 'text', modelMetadata: { provider: 'openai', model: 'legacy-a',
        usage: { inputTokens: '10', outputTokens: '20', estimatedCostKrw: '1.25' } }, safetyMetadata: {} },
      { messageType: 'text', modelMetadata: { provider: 'openai', model: 'legacy-a', usage: null,
        estimatedCostKrw: null }, safetyMetadata: {} },
      { messageType: 'text', modelMetadata: { model: 'legacy-b', usage: { provider: 'openai',
        input_tokens: '2', output_tokens: 3, estimatedCostKrw: '0.50' } }, safetyMetadata: {} },
      { messageType: 'text', modelMetadata: null, safetyMetadata: null }, failedRow(),
    ];
    const saved = JSON.stringify(rows), f = make(rows);
    const expected: Stats = { totalResponses: 4, failureCount: 1, fallbackCount: 1, estimatedCostKrw: '1.75', usageByModel: [
      { provider: 'openai', model: 'legacy-a', responses: 2, inputTokens: 10, outputTokens: 20, estimatedCostKrw: '1.25' },
      { provider: 'openai', model: 'legacy-b', responses: 1, inputTokens: 2, outputTokens: 3, estimatedCostKrw: '0.50' },
      { provider: 'openai', model: 'fallback', responses: 1, inputTokens: 0, outputTokens: 0, estimatedCostKrw: '0.00' },
    ] };
    expect(f.aggregate.aggregateProviderOpsStats(rows)).toEqual(expected);
    const ops = await f.service.getProviderOpsStatus(owner), summary = await f.service.getUsageSummary(owner, { artistId });
    expect(ops.usage).toEqual({ ...expected, accounting });
    expect(summary.providerOps.usageByModel).toEqual(expected.usageByModel);
    expect(summary.providerOps.estimatedCostKrw).toBe('1.75');
    expect(summary).toMatchObject({ providerDailyUsed: 4, providerDailyFailureCount: 1, providerDailyRemaining: 46 });
    expectAccounting(ops.usage.accounting); expectAccounting(summary.providerOps.accounting);
    expect(JSON.stringify(rows)).toBe(saved);
    expectOpsQuery(f, owner, 2); expectUserQuery(f, owner, 2); expectAdmissionQueries(f, owner);
    expect(f.provider.readiness).toHaveBeenCalledTimes(2);
  });

  it('counts only strict attempted legacy greetings without inventing model usage for unattempted or guarded rows', async () => {
    const attempted = greetingRow();
    const guarded = greetingRow(), unattempted = greetingRow(), invalidContract = greetingRow();
    (guarded.modelMetadata as Record<string, unknown>).fallbackReason = 'provider_guard_blocked';
    (guarded.safetyMetadata as Record<string, unknown>).fallbackReason = 'provider_guard_blocked';
    (unattempted.safetyMetadata as Record<string, unknown>).providerAttempted = false;
    (invalidContract.safetyMetadata as Record<string, unknown>).contractVersion = 'synthetic-invalid';
    const rows = [attempted, guarded, unattempted, invalidContract,
      { messageType: 'opening_greeting', modelMetadata: { source: 'fallback' }, safetyMetadata: {} }], f = make(rows);
    const expected = { totalResponses: 1, failureCount: 1, fallbackCount: 1, usageByModel: [], estimatedCostKrw: '0.00' };
    expect(f.aggregate.aggregateProviderOpsStats(rows)).toEqual(expected);
    const result = await f.service.getProviderOpsStatus(owner);
    expect(result.usage).toEqual({ ...expected, accounting }); expectAccounting(result.usage.accounting);
    expectOpsQuery(f, owner); expectUserQuery(f, owner);
    expect(f.artist.findFirst).not.toHaveBeenCalled(); expect(f.chatMessage.findFirst).not.toHaveBeenCalled();
    expect(f.chatMessage.count).not.toHaveBeenCalled(); expect(f.provider.readiness).toHaveBeenCalledTimes(1);
  });

  it('retains invalid or inactive artist NotFound before user, usage, readiness or any write admission', async () => {
    const f = make([]); f.artist.findFirst.mockResolvedValueOnce(null);
    await expect(f.service.getUsageSummary(owner, { artistId })).rejects.toBeInstanceOf(NotFoundException);
    expect(f.artist.findFirst).toHaveBeenCalledTimes(1);
    expect(f.artist.findFirst).toHaveBeenCalledWith({ where: { id: artistId, status: 'active' },
      select: { id: true, slug: true, displayName: true } });
    expect(f.user.findUnique).not.toHaveBeenCalled(); expect(f.chatMessage.findMany).not.toHaveBeenCalled();
    expect(f.chatMessage.findFirst).not.toHaveBeenCalled(); expect(f.chatMessage.count).not.toHaveBeenCalled();
    expect(f.provider.readiness).not.toHaveBeenCalled();
  });

  it('uses the current caller predicates and one immutable shared accounting object in both real getter paths', async () => {
    const f = make([]);
    const ops = await f.service.getProviderOpsStatus(otherOwner);
    const summary = await f.service.getUsageSummary(otherOwner, { artistId });
    expectOpsQuery(f, otherOwner, 2); expectUserQuery(f, otherOwner, 2); expectAdmissionQueries(f, otherOwner);
    expect(f.provider.readiness).toHaveBeenNthCalledWith(1, { userId: otherOwner, userEmail: null });
    expect(f.provider.readiness).toHaveBeenNthCalledWith(2, { userId: otherOwner, userEmail: null });
    expect(f.provider.readiness).toHaveBeenCalledTimes(2);
    expectAccounting(ops.usage.accounting); expectAccounting(summary.providerOps.accounting);
    expect(ops.usage.accounting).toBe(summary.providerOps.accounting);
    expect(Reflect.set(ops.usage.accounting, 'billingStatus', 'verified')).toBe(false);
    expect(() => Object.defineProperty(ops.usage.accounting, 'actualProviderCostKrw', { value: 0 })).toThrow(TypeError);
    expectAccounting(summary.providerOps.accounting);
    expect(ops.guard).toMatchObject({ requestRemaining: 50, failureRemaining: 5, canAttemptProvider: true });
    expect(summary.providerOps).toMatchObject({ estimatedCostKrw: '0.00', fallbackCount: 0, usageByModel: [] });
  });
});

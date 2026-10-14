import { ConflictException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatLlmProviderRequestError } from './llm-provider.adapter';
import type { ChatGenerationResult } from './llm-provider.adapter';

const USER = '00000000-0000-4000-8000-000000001151';
const SESSION = '00000000-0000-4000-8000-000000001152';
const ARTIST = '00000000-0000-4000-8000-000000001153';
const BODY = 'SYNTHETIC_GREETING_BODY_NOT_AUDIT_DATA';
const REQUEST = 'SYNTHETIC_GREETING_REQUEST_NOT_AUDIT_DATA';
const SECRET = 'SYNTHETIC_GREETING_ERROR_OR_KEY_NOT_AUDIT_DATA';
const WARNING = 'Character chat returned usage evidence was not recorded';
type Row = { id: string; chatSessionId: string; senderType: string; messageType: string;
  body: string; createdAt: Date; modelMetadata: Record<string, unknown>; safetyMetadata: Record<string, unknown> };
type FixtureOptions = { configured?: boolean; status?: 'completed' | 'unreported';
  saveError?: Error; commitError?: Error; commitBeforeReject?: boolean };

function generated(status: 'completed' | 'unreported'): ChatGenerationResult {
  return { body: BODY,
    usage: { provider: 'openai', model: 'gpt-4.1-mini', inputTokens: 11, outputTokens: 7,
      estimatedCostKrw: '999.99' },
    safetyMetadata: { provider: 'openai', generationStatus: 'completed', providerResponseStatus: status,
      providerCompletionVerified: status === 'completed', requestId: REQUEST, raw: SECRET,
      error: SECRET, apiKey: SECRET, semanticQualityVerified: true } };
}

function evidence(status: 'completed' | 'unreported') {
  return { contract: 'chat-returned-usage-evidence-v1', responseStatus: status,
    completionVerified: status === 'completed', model: 'gpt-4.1-mini', inputTokens: 11, outputTokens: 7,
    cachedInputTokens: null, normalizedUsageOnly: true, semanticQualityVerified: false,
    actualProviderCostKrw: null, providerInvoiceVerified: false, billingStatus: 'unverified' };
}

function expectSafe(value: unknown) {
  for (const secret of [BODY, REQUEST, SECRET, '999.99']) expect(JSON.stringify(value)).not.toContain(secret);
}

let fetchBlock: jest.SpyInstance;
beforeEach(() => {
  fetchBlock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Greeting fixture forbids network'));
});
afterEach(() => {
  try { expect(fetchBlock).not.toHaveBeenCalled(); }
  finally { jest.restoreAllMocks(); }
});

function fixture(options: FixtureOptions = {}) {
  const status = options.status ?? 'completed';
  const result = generated(status);
  const rows: Row[] = [], staged: Row[] = [], events: string[] = [];
  const observations: Array<{ active: boolean; settled: string; callbackReturned: boolean }> = [];
  let active = false, settled = 'not_started', callbackReturned = false;
  const session = { id: SESSION, userId: USER, artistId: ARTIST, status: 'active', chatPersona: null,
    artist: { id: ARTIST, slug: 'synthetic-greeting-return', displayName: 'Synthetic character' } };
  const findGreeting = (where: { chatSessionId: string; senderType: string; messageType: string }) =>
    rows.find(row => row.chatSessionId === where.chatSessionId && row.senderType === where.senderType
      && row.messageType === where.messageType) ?? null;
  const tx = {
    chatSession: { update: jest.fn().mockImplementation(async () => { events.push('lock'); return session; }) },
    chatMessage: {
      findFirst: jest.fn().mockImplementation(async ({ where }) => findGreeting(where)),
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        events.push('save');
        if (options.saveError) throw options.saveError;
        const row = { ...data, id: 'synthetic-greeting-message', createdAt: new Date(0) } as Row;
        staged.push(row); return row;
      }),
    },
  };
  const prisma = {
    chatSession: { findMany: jest.fn().mockResolvedValue([session]) },
    chatMessage: {
      findFirst: jest.fn().mockImplementation(async ({ where }) => findGreeting(where)),
      findMany: jest.fn().mockImplementation(async () => [...rows]), create: jest.fn(),
    },
    auditEvent: { create: jest.fn().mockImplementation(async () => {
      observations.push({ active, settled, callbackReturned }); events.push('audit');
      return { id: 'synthetic-greeting-audit' };
    }) },
    walletAccount: { updateMany: jest.fn() }, walletLedger: { create: jest.fn() },
    $transaction: jest.fn().mockImplementation(async (work: (client: typeof tx) => Promise<unknown>) => {
      active = true; settled = 'pending'; callbackReturned = false; events.push('tx:start');
      try {
        const value = await work(tx);
        callbackReturned = true; events.push('callback:returned');
        // Both pre-commit rejection and committed-but-unacknowledged outcomes are synthetic.
        if (options.commitError) {
          if (options.commitBeforeReject) rows.push(...staged);
          throw options.commitError;
        }
        rows.push(...staged); active = false; settled = 'fulfilled'; events.push('tx:fulfilled');
        return value;
      } catch (error) {
        active = false; settled = 'rejected'; events.push('tx:rejected'); throw error;
      }
    }),
  };
  const provider = { generate: jest.fn().mockImplementation(async () => { events.push('provider:return'); return result; }),
    fallbackResult: jest.fn() };
  const service = new ChatService(prisma as never, provider as never);
  const internals = service as any;
  // Actual ensure, builder, metadata functions and outer audit execute; only admission/provider/tx are synthetic.
  jest.spyOn(internals, 'buildCharacterRuntimePersonaContext').mockReturnValue({
    welcome: { text: 'Synthetic welcome', source: 'synthetic_fixture' }, starterOptions: [],
    personaTags: [], tone: { guideKo: '' }, source: 'synthetic_fixture',
  });
  jest.spyOn(internals, 'selectDispatchArtistPersona').mockReturnValue({ status: 'unverified' });
  jest.spyOn(internals, 'openingGreetingToneCandidate').mockReturnValue({ syntheticOnly: true });
  jest.spyOn(internals, 'getProviderUserContext').mockResolvedValue({ userId: USER, userEmail: null });
  jest.spyOn(internals, 'providerReadinessForUser').mockResolvedValue({ provider: 'openai',
    configured: options.configured !== false, status: options.configured === false ? 'provider_not_configured' : 'provider_ready' });
  jest.spyOn(internals, 'providerOpsStatsForUser').mockResolvedValue({ totalResponses: 0, failureCount: 0 });
  const current = jest.spyOn(internals, 'assertArtistPersonaSelectionCurrent').mockResolvedValue(undefined);
  const cachedCurrent = jest.spyOn(internals, 'assertCachedArtistPersonaCurrent').mockResolvedValue(undefined);
  const owned = jest.spyOn(internals, 'getOwnedSessionForOpeningGreeting').mockResolvedValue(session);
  const builder = jest.spyOn(internals, 'buildOpeningGreetingCandidate');
  const warn = jest.spyOn(internals.logger, 'warn').mockImplementation(() => undefined);
  return { service, internals, session, prisma, tx, provider, current, cachedCurrent, owned, builder, warn,
    result, status, rows, staged, events, observations,
    ensure: () => internals.ensureSessionOpeningGreeting(USER, session) as Promise<any> };
}

type Fixture = ReturnType<typeof fixture>;
function expectNoUnrelatedWork(f: Fixture) {
  expect(f.provider.fallbackResult).not.toHaveBeenCalled();
  expect(f.prisma.chatMessage.create).not.toHaveBeenCalled();
  expect(f.prisma.walletAccount.updateMany).not.toHaveBeenCalled();
  expect(f.prisma.walletLedger.create).not.toHaveBeenCalled();
}

function expectOutsideAudit(f: Fixture, reason: 'source_conflict' | 'storage_or_processing_failure',
  callbackReturned: boolean) {
  expect(f.prisma.auditEvent.create.mock.calls).toEqual([[{ data: {
    actorUserId: USER, actorType: 'system', action: 'chat_provider_return_handling_failed',
    targetType: 'chat_session', targetId: SESSION,
    metadata: { schemaVersion: '2026-10-15.chat-returned-usage-v1', provider: 'openai',
      stage: 'application_after_provider_return', reason, applicationOutcome: 'rejected_or_unconfirmed',
      returnedUsageEvidence: evidence(f.status) },
  } }]]);
  expect(f.observations).toEqual([{ active: false, settled: 'rejected', callbackReturned }]);
  expect(f.events.indexOf('tx:rejected')).toBeGreaterThanOrEqual(0);
  expect(f.events.indexOf('audit')).toBeGreaterThan(f.events.indexOf('tx:rejected'));
  expectSafe(f.prisma.auditEvent.create.mock.calls);
  expectNoUnrelatedWork(f);
}

describe('opening greeting returned usage at the settled transaction boundary', () => {
  it('01 captures returned usage before a post-return greeting conflict', async () => {
    const f = fixture();
    const conflict = new ConflictException({ code: 'SYNTHETIC_GREETING_CANON_CHANGED' });
    f.current.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
      // The capture must precede this guard, not reread the mutated result from the catch.
      f.result.usage.inputTokens = 99;
      f.result.safetyMetadata.providerResponseStatus = 'unreported';
      throw conflict;
    });
    await expect(f.ensure()).rejects.toBe(conflict);
    expect(f.builder).toHaveBeenCalledTimes(1);
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
    expect(f.current).toHaveBeenCalledTimes(2);
    expect(f.tx.chatMessage.create).not.toHaveBeenCalled();
    expect(f.rows).toEqual([]);
    expectOutsideAudit(f, 'source_conflict', false);
  });

  it('02 audits save or commit rejection only after settlement without claiming whether a row committed', async () => {
    for (const stage of ['save', 'commit', 'committed_unacknowledged'] as const) {
      const original = new Error('Synthetic greeting storage rejection');
      const f = fixture(stage === 'save' ? { saveError: original } : { commitError: original,
        commitBeforeReject: stage === 'committed_unacknowledged',
        status: stage === 'commit' ? 'unreported' : 'completed' });
      await expect(f.ensure()).rejects.toBe(original);
      expect(f.builder).toHaveBeenCalledTimes(1);
      expect(f.provider.generate).toHaveBeenCalledTimes(1);
      expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(f.tx.chatMessage.create).toHaveBeenCalledTimes(1);
      expect(f.rows).toHaveLength(stage === 'committed_unacknowledged' ? 1 : 0);
      expectOutsideAudit(f, 'storage_or_processing_failure', stage !== 'save');
    }
  });

  it('03 an outside audit rejection only warns statically and rethrows the identical greeting failure', async () => {
    for (const conflictStage of [true, false]) {
      const original = conflictStage ? new ConflictException({ code: 'SYNTHETIC_GREETING_SOURCE_CHANGED' })
        : new Error('Synthetic greeting commit rejection');
      const f = fixture(conflictStage ? {} : { commitError: original });
      if (conflictStage) f.current.mockResolvedValueOnce(undefined).mockRejectedValueOnce(original);
      f.prisma.auditEvent.create.mockImplementationOnce(async () => {
        const active = f.events.includes('tx:start') && !f.events.includes('tx:rejected');
        f.observations.push({ active, settled: f.events.includes('tx:rejected') ? 'rejected' : 'pending',
          callbackReturned: f.events.includes('callback:returned') });
        f.events.push('audit'); throw new Error(SECRET);
      });
      await expect(f.ensure()).rejects.toBe(original);
      expectOutsideAudit(f, conflictStage ? 'source_conflict' : 'storage_or_processing_failure', !conflictStage);
      expect(f.warn.mock.calls).toEqual([[WARNING]]);
      expectSafe(f.warn.mock.calls);
      expect(f.provider.generate).toHaveBeenCalledTimes(1);
      expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
    }
  });

  it('04 success and both cache checks keep their existing no-audit and no-provider replay behavior', async () => {
    const f = fixture();
    const first = await f.ensure();
    expect(first).toMatchObject({ text: BODY, source: 'provider', cache: { hit: false },
      generation: { providerCall: true } });
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
    expect(f.builder).toHaveBeenCalledTimes(1);
    expect(f.rows).toHaveLength(1);
    expect(f.prisma.auditEvent.create).not.toHaveBeenCalled();
    f.provider.generate.mockClear(); f.builder.mockClear(); f.prisma.$transaction.mockClear();
    const cached = await f.ensure();
    expect(cached).toMatchObject({ id: first.id, cache: { hit: true }, generation: { providerCall: false } });
    expect(f.provider.generate).not.toHaveBeenCalled();
    expect(f.builder).not.toHaveBeenCalled();
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect(f.prisma.auditEvent.create).not.toHaveBeenCalled();
    expectNoUnrelatedWork(f);
    const lockedCache = fixture();
    lockedCache.rows.push(f.rows[0]);
    lockedCache.prisma.chatMessage.findFirst.mockResolvedValueOnce(null);
    await expect(lockedCache.ensure()).resolves.toMatchObject({ cache: { hit: true },
      generation: { providerCall: false } });
    expect(lockedCache.tx.chatSession.update).toHaveBeenCalledTimes(1);
    expect(lockedCache.tx.chatMessage.create).not.toHaveBeenCalled();
    expect(lockedCache.provider.generate).not.toHaveBeenCalled();
    expect(lockedCache.builder).not.toHaveBeenCalled();
    expect(lockedCache.prisma.auditEvent.create).not.toHaveBeenCalled();
    expectNoUnrelatedWork(lockedCache);
  });

  it('05 local, pre-return conflict and terminal throw do not invent returned-result outside evidence', async () => {
    const local = fixture({ configured: false });
    await expect(local.ensure()).resolves.toMatchObject({ source: 'fallback', generation: { providerCall: false } });
    expect(local.provider.generate).not.toHaveBeenCalled();
    expect(local.prisma.auditEvent.create).not.toHaveBeenCalled();
    expectNoUnrelatedWork(local);
    const before = fixture();
    const conflict = new ConflictException({ code: 'SYNTHETIC_GREETING_PRE_RETURN_CHANGED' });
    before.current.mockRejectedValueOnce(conflict);
    await expect(before.ensure()).rejects.toBe(conflict);
    expect(before.provider.generate).not.toHaveBeenCalled();
    expect(before.prisma.auditEvent.create).not.toHaveBeenCalled();
    expectNoUnrelatedWork(before);
    const commitError = new Error('Synthetic terminal fallback commit rejection');
    const terminal = fixture({ commitError });
    terminal.provider.generate.mockRejectedValueOnce(new ChatLlmProviderRequestError(
      'Synthetic terminal response', 'provider_incomplete_response', null,
      { responseStatus: 'incomplete', reason: 'max_output_tokens', model: 'gpt-4.1-mini',
        inputTokens: 11, outputTokens: 7, estimatedCostKrw: null, billingStatus: 'unverified' }));
    await expect(terminal.ensure()).rejects.toBe(commitError);
    expect(terminal.provider.generate).toHaveBeenCalledTimes(1);
    expect(terminal.tx.chatMessage.create).toHaveBeenCalledTimes(1);
    expect(terminal.prisma.auditEvent.create).not.toHaveBeenCalled();
    expect(terminal.rows).toEqual([]);
    expectNoUnrelatedWork(terminal);
  });

  it('06 actual public session/message reads after a rejected greeting do not call the provider or retry its transaction', async () => {
    const original = new Error('Synthetic greeting save rejection');
    const f = fixture({ saveError: original });
    await expect(f.ensure()).rejects.toBe(original);
    expectOutsideAudit(f, 'storage_or_processing_failure', false);
    f.provider.generate.mockClear(); f.builder.mockClear(); f.prisma.$transaction.mockClear();
    f.prisma.auditEvent.create.mockClear();
    await expect(f.service.getSessions(USER)).resolves.toEqual([f.session]);
    await expect(f.service.getMessages(USER, SESSION)).resolves.toEqual([]);
    expect(f.prisma.chatSession.findMany.mock.calls[0][0].where).toEqual({ userId: USER });
    expect(f.owned.mock.calls).toEqual([[USER, SESSION]]);
    expect(f.prisma.chatMessage.findMany.mock.calls[0][0].where).toEqual({ chatSessionId: SESSION });
    expect(f.provider.generate).not.toHaveBeenCalled();
    expect(f.builder).not.toHaveBeenCalled();
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect(f.prisma.auditEvent.create).not.toHaveBeenCalled();
    expectNoUnrelatedWork(f);
  });
});

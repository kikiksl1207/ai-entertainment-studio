import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { captureChatReturnedUsageEvidence } from './chat-returned-usage-evidence';
import type { ChatGenerationResult } from './llm-provider.adapter';

const USER = '00000000-0000-4000-8000-000000001015';
const SESSION = '00000000-0000-4000-8000-000000001016';
const ARTIST = '00000000-0000-4000-8000-000000001017';
const ORDER = '00000000-0000-4000-8000-000000001018';
const BODY = 'SYNTHETIC_RETURNED_BODY_NOT_AUDIT_DATA';
const RAW = 'SYNTHETIC_RAW_OR_REQUEST_NOT_AUDIT_DATA';
const SECRET = 'SYNTHETIC_KEY_OR_ERROR_NOT_AUDIT_DATA';
const WARNING = 'Character chat returned usage evidence was not recorded';
const POLICY = { canGenerate: true };

// Match the actual adapter's result keys, not a separate sanitizer-only contract.
function generated(status: 'completed' | 'unreported' = 'completed'): ChatGenerationResult {
  return {
    body: BODY,
    usage: { provider: 'openai', model: 'gpt-4.1-mini', inputTokens: 11, outputTokens: 7,
      estimatedCostKrw: '999.99', cachedInputTokens: 5, raw: RAW } as ChatGenerationResult['usage'],
    safetyMetadata: { provider: 'openai', generationStatus: 'completed', providerResponseStatus: status,
      providerCompletionVerified: status === 'completed', requestId: RAW, rawPayload: RAW,
      error: SECRET, apiKey: SECRET, semanticQualityVerified: true },
  };
}

function expectedEvidence(status: 'completed' | 'unreported' | 'unknown' = 'completed') {
  return { contract: 'chat-returned-usage-evidence-v1', responseStatus: status,
    completionVerified: status === 'completed', model: 'gpt-4.1-mini', inputTokens: 11, outputTokens: 7,
    cachedInputTokens: null, normalizedUsageOnly: true, semanticQualityVerified: false,
    actualProviderCostKrw: null, providerInvoiceVerified: false, billingStatus: 'unverified' };
}

function expectSafe(value: unknown) {
  const encoded = JSON.stringify(value);
  for (const secret of [BODY, RAW, SECRET, '999.99']) expect(encoded).not.toContain(secret);
}

let fetchBlock: jest.SpyInstance;
beforeEach(() => {
  fetchBlock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Fixture forbids network'));
});
afterEach(() => {
  try { expect(fetchBlock).not.toHaveBeenCalled(); }
  finally { jest.restoreAllMocks(); }
});

function fixture(result: ChatGenerationResult = generated()) {
  const prisma = {
    auditEvent: { create: jest.fn().mockResolvedValue({ id: 'synthetic-return-audit' }) },
    chatMessage: { create: jest.fn(), createMany: jest.fn() },
    walletAccount: { updateMany: jest.fn() }, walletLedger: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const provider = { generate: jest.fn().mockResolvedValue(result), fallbackResult: jest.fn() };
  const service = new ChatService(prisma as never, provider as never);
  const internals = service as any;
  const session = { id: SESSION, artist: { id: ARTIST, slug: 'synthetic-returned-usage',
    displayName: 'Synthetic character' }, chatPersona: null };
  const order = { id: ORDER, status: 'completed', messages: [],
    chatFeatureProduct: { sku: 'SYNTHETIC_RETURN_REPLY', featureType: 'deep_reply', priceLumina: 2 } };
  // Admission/persona/history and persistence are boundaries, not claims of SQL or canon verification.
  const admission = jest.spyOn(internals, 'getOwnedSessionForGeneration').mockResolvedValue(session);
  jest.spyOn(internals, 'getFeatureOrderForGeneration').mockResolvedValue(order);
  jest.spyOn(internals, 'getProviderUserContext').mockResolvedValue({ userEmail: null });
  jest.spyOn(internals, 'buildBasicChatPreflight').mockResolvedValue({ canGenerate: true });
  jest.spyOn(internals, 'providerReadinessForUser').mockResolvedValue({ provider: 'openai', configured: true });
  jest.spyOn(internals, 'chatGenerationPolicy').mockReturnValue(POLICY);
  jest.spyOn(internals, 'selectDispatchArtistPersona').mockReturnValue({ status: 'unverified' });
  const current = jest.spyOn(internals, 'assertArtistPersonaSelectionCurrent').mockResolvedValue(undefined);
  jest.spyOn(internals, 'buildCharacterRuntimePersonaContext').mockReturnValue({
    welcome: { text: 'Synthetic welcome', source: 'synthetic_fixture' },
    starterOptions: [], personaTags: [], tone: { guideKo: '' },
  });
  jest.spyOn(internals, 'loadApprovedArtistKnowledgeContext').mockResolvedValue(undefined);
  jest.spyOn(internals, 'loadOptionalStoryMemory').mockResolvedValue(undefined);
  jest.spyOn(internals, 'recentProviderMessages').mockResolvedValue([]);
  jest.spyOn(internals, 'orderSummary').mockImplementation((...args: unknown[]) => {
    const value = args[0] as { id: string; status: string };
    return { id: value.id, status: value.status };
  });
  const refund = jest.spyOn(internals, 'failFeatureOrderAndRestoreLumina').mockResolvedValue(null);
  const saved = { generationStatus: 'completed', message: { id: 'synthetic-saved-message', body: result.body },
    usage: result.usage };
  const persist = jest.spyOn(internals, 'persistGeneratedMessage').mockResolvedValue(saved);
  const warn = jest.spyOn(internals.logger, 'warn').mockImplementation(() => undefined);
  return { service, prisma, provider, admission, current, refund, persist, saved, warn, result };
}

type Fixture = ReturnType<typeof fixture>;
function call(f: Fixture, paid = false) {
  return f.service.generateMessage(USER, SESSION, { body: 'Synthetic ordinary input',
    ...(paid ? { chatFeatureOrderId: ORDER } : {}) });
}

function expectAudit(f: Fixture, paid: boolean, reason: 'source_conflict' | 'storage_or_processing_failure',
  status: 'completed' | 'unreported' = 'completed') {
  expect(f.prisma.auditEvent.create.mock.calls).toEqual([[{ data: {
    actorUserId: USER, actorType: 'system', action: 'chat_provider_return_handling_failed',
    targetType: paid ? 'chat_feature_order' : 'chat_session', targetId: paid ? ORDER : SESSION,
    metadata: { schemaVersion: '2026-10-15.chat-returned-usage-v1', provider: 'openai',
      stage: 'application_after_provider_return', reason, applicationOutcome: 'rejected_or_unconfirmed',
      returnedUsageEvidence: expectedEvidence(status) },
  } }]]);
  expectSafe(f.prisma.auditEvent.create.mock.calls);
  expect(f.prisma.auditEvent.create.mock.invocationCallOrder[0])
    .toBeGreaterThan(f.provider.generate.mock.invocationCallOrder[0]);
}

function expectNoSideEffects(f: Fixture, generatedCalls: number, savedCalls: number) {
  expect(f.provider.generate).toHaveBeenCalledTimes(generatedCalls);
  expect(f.persist).toHaveBeenCalledTimes(savedCalls);
  expect(f.provider.fallbackResult).not.toHaveBeenCalled();
  expect(f.prisma.chatMessage.create).not.toHaveBeenCalled();
  expect(f.prisma.chatMessage.createMany).not.toHaveBeenCalled();
  expect(f.prisma.walletAccount.updateMany).not.toHaveBeenCalled();
  expect(f.prisma.walletLedger.create).not.toHaveBeenCalled();
  expect(f.prisma.$transaction).not.toHaveBeenCalled();
}

async function caughtFailure(f: Fixture, paid = false) {
  let caught: unknown;
  try { await call(f, paid); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(ServiceUnavailableException);
  const response = (caught as ServiceUnavailableException).getResponse();
  expect(response).toEqual({ code: 'CHAT_LLM_GENERATION_FAILED', message: 'Character chat generation failed',
    messageKey: 'chat.generation.failed', details: { generationStatus: 'failed',
      order: paid ? { id: ORDER, status: 'failed' } : null,
      policy: { generation: POLICY, failure: { refundOnGenerationFailure: true, orderFailureStatus: 'failed',
        walletRecoveryLedgerType: 'refund', walletRecoveryReferenceType: 'chat_feature_order' } } } });
  expectSafe(response);
  return caught;
}

describe('ordinary returned provider usage evidence (synthetic boundaries, no greeting)', () => {
  it('01 captures the actual completed adapter shape, freezes the allowlist and strips all non-usage evidence', () => {
    const input = generated();
    const evidence = captureChatReturnedUsageEvidence(input);
    expect(evidence).toEqual(expectedEvidence());
    expect(Object.isFrozen(evidence)).toBe(true);
    expectSafe(evidence);
    input.usage.inputTokens = 88;
    input.safetyMetadata.providerResponseStatus = 'unreported';
    expect(evidence).toEqual(expectedEvidence());
  });

  it('02 preserves legacy uncertainty and valid zero counts while rejecting unsafe numbers, models and other providers', () => {
    expect(captureChatReturnedUsageEvidence(generated('unreported'))).toEqual(expectedEvidence('unreported'));
    const legacy = generated(); legacy.safetyMetadata = {};
    expect(captureChatReturnedUsageEvidence(legacy)).toEqual(expectedEvidence('unknown'));
    for (const bad of [null, undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '11']) {
      const value = generated();
      const evidence = captureChatReturnedUsageEvidence({ ...value,
        usage: { ...value.usage, inputTokens: bad, outputTokens: bad } });
      expect(evidence).toEqual({ ...expectedEvidence(), inputTokens: null, outputTokens: null });
    }
    for (const model of ['gpt-4.1-mini', 'o1', 'o3-mini', 'o4-mini-2025-04-16']) {
      expect(captureChatReturnedUsageEvidence({ ...generated(), usage: { ...generated().usage,
        model, inputTokens: 0, outputTokens: 0 } })).toEqual({ ...expectedEvidence(), model,
        inputTokens: 0, outputTokens: 0 });
    }
    for (const model of [null, 123, 'fallback', 'o0', 'gpt-', 'gpt-secret value', SECRET, 'gpt-' + 'x'.repeat(125)]) {
      expect(captureChatReturnedUsageEvidence({ ...generated(), usage: { ...generated().usage, model } }))
        .toEqual({ ...expectedEvidence(), model: null });
    }
    for (const value of [null, [], {}, { usage: [] }, { usage: { provider: 'local' } },
      { ...generated(), usage: { ...generated().usage, provider: 'OPENAI' } }]) {
      expect(captureChatReturnedUsageEvidence(value)).toBeNull();
    }
    const forged = { ...generated(), safetyMetadata: { responseStatus: 'completed', completionVerified: true,
      providerResponseStatus: 'incomplete', providerCompletionVerified: true } };
    expect(captureChatReturnedUsageEvidence(forged)).toEqual(expectedEvidence('unknown'));
  });

  it('03 audits completed or legacy usage after a post-return source conflict without replacing that conflict', async () => {
    for (const status of ['completed', 'unreported'] as const) {
      const f = fixture(generated(status));
      const conflict = new ConflictException({ code: 'SYNTHETIC_CANON_CHANGED' });
      f.current.mockResolvedValueOnce(undefined).mockRejectedValueOnce(conflict);
      await expect(call(f)).rejects.toBe(conflict);
      expect(f.current).toHaveBeenCalledTimes(2);
      expectAudit(f, false, 'source_conflict', status);
      expect(f.refund).not.toHaveBeenCalled();
      expect(f.warn).not.toHaveBeenCalled();
      expectNoSideEffects(f, 1, 0);
    }
  });

  it('04 audits a rejected persistence call as unconfirmed and preserves generic failure details without another save', async () => {
    const f = fixture();
    // This is caller-observed rejection, not proof that a database transaction rolled back.
    f.persist.mockRejectedValueOnce(new Error(SECRET));
    await caughtFailure(f);
    expectAudit(f, false, 'storage_or_processing_failure');
    expect(f.persist.mock.calls[0][5]).toBe(f.result);
    expect(f.prisma.auditEvent.create.mock.invocationCallOrder[0])
      .toBeGreaterThan(f.persist.mock.invocationCallOrder[0]);
    expect(f.refund).not.toHaveBeenCalled();
    expectNoSideEffects(f, 1, 1);
  });

  it('05 keeps paid recovery at the original three arguments before evidence, including the existing refund-throw limit', async () => {
    for (const auditRejects of [false, true]) {
      const f = fixture();
      f.persist.mockRejectedValueOnce(new Error(SECRET));
      if (auditRejects) f.prisma.auditEvent.create.mockRejectedValueOnce(new Error(SECRET));
      await caughtFailure(f, true);
      expect(f.refund.mock.calls).toEqual([[USER, ORDER, 'generation_failed']]);
      expectAudit(f, true, 'storage_or_processing_failure');
      expect(f.refund.mock.invocationCallOrder[0])
        .toBeLessThan(f.prisma.auditEvent.create.mock.invocationCallOrder[0]);
      expect(f.warn.mock.calls).toEqual(auditRejects ? [[WARNING]] : []);
      expectSafe(f.warn.mock.calls);
      expectNoSideEffects(f, 1, 1);
    }
    const f = fixture();
    const refundError = new Error('Synthetic original recovery failure');
    f.persist.mockRejectedValueOnce(new Error(SECRET));
    f.refund.mockRejectedValueOnce(refundError);
    await expect(call(f, true)).rejects.toBe(refundError);
    expect(f.refund.mock.calls).toEqual([[USER, ORDER, 'generation_failed']]);
    expect(f.prisma.auditEvent.create).not.toHaveBeenCalled();
    expectNoSideEffects(f, 1, 1);
  });

  it('06 audit rejection only warns statically and cannot mask a free conflict or generic handling failure', async () => {
    for (const sourceConflict of [true, false]) {
      const f = fixture();
      f.prisma.auditEvent.create.mockRejectedValueOnce(new Error(SECRET));
      if (sourceConflict) {
        const conflict = new ConflictException({ code: 'SYNTHETIC_SOURCE_CHANGED' });
        f.current.mockResolvedValueOnce(undefined).mockRejectedValueOnce(conflict);
        await expect(call(f)).rejects.toBe(conflict);
      } else {
        f.persist.mockRejectedValueOnce(new Error(SECRET));
        await caughtFailure(f);
      }
      expectAudit(f, false, sourceConflict ? 'source_conflict' : 'storage_or_processing_failure');
      expect(f.warn.mock.calls).toEqual([[WARNING]]);
      expectSafe(f.warn.mock.calls);
      expect(f.refund).not.toHaveBeenCalled();
      expectNoSideEffects(f, 1, sourceConflict ? 0 : 1);
    }
  });

  it('07 success, pre-return conflict and non-openai return never manufacture returned-usage audits or retries', async () => {
    const success = fixture();
    await expect(call(success)).resolves.toBe(success.saved);
    expect(success.persist.mock.calls[0][5]).toBe(success.result);
    expect(success.prisma.auditEvent.create).not.toHaveBeenCalled();
    expect(success.refund).not.toHaveBeenCalled();
    expectNoSideEffects(success, 1, 1);
    const before = fixture();
    const conflict = new ConflictException({ code: 'SYNTHETIC_PRE_RETURN_CHANGED' });
    before.current.mockRejectedValueOnce(conflict);
    await expect(call(before)).rejects.toBe(conflict);
    expect(before.prisma.auditEvent.create).not.toHaveBeenCalled();
    expect(before.refund).not.toHaveBeenCalled();
    expectNoSideEffects(before, 0, 0);
    const otherResult = generated();
    otherResult.usage = { ...otherResult.usage, provider: 'synthetic-local' } as ChatGenerationResult['usage'];
    const other = fixture(otherResult);
    other.persist.mockRejectedValueOnce(new Error(SECRET));
    await caughtFailure(other);
    expect(other.prisma.auditEvent.create).not.toHaveBeenCalled();
    expect(other.refund).not.toHaveBeenCalled();
    expectNoSideEffects(other, 1, 1);
  });
});

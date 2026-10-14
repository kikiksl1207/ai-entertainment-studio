import { ServiceUnavailableException } from '@nestjs/common';
import { ChatService } from './chat.service';
import {
  ChatFailedProviderResponse,
  ChatGenerationResult,
  ChatLlmProviderAdapter,
  ChatLlmProviderRequestError,
} from './llm-provider.adapter';

const USER = '00000000-0000-4000-8000-000000000815';
const SESSION = '00000000-0000-4000-8000-000000000816';
const ARTIST = '00000000-0000-4000-8000-000000000817';
const ORDER = '00000000-0000-4000-8000-000000000818';
const BODY_SECRET = 'SYNTHETIC_PARTIAL_PROVIDER_BODY_DO_NOT_STORE';
const AUDIT_SECRET = 'SYNTHETIC_AUDIT_ERROR_DO_NOT_DISPLAY';
const LOCAL_USAGE = { provider: 'openai', model: 'fallback', inputTokens: 0, outputTokens: 0, estimatedCostKrw: '0.00' };

let fetchBlock: jest.SpyInstance;
beforeEach(() => {
  fetchBlock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Service fixture forbids provider dispatch'));
});
afterEach(() => {
  try { expect(fetchBlock).not.toHaveBeenCalled(); }
  finally { fetchBlock.mockRestore(); }
});

function fixture() {
  const evidence = { responseStatus: 'incomplete', reason: 'max_output_tokens', model: 'synthetic-terminal-primary',
    inputTokens: 11, outputTokens: 7, estimatedCostKrw: null, billingStatus: 'unverified', body: BODY_SECRET };
  const error = new ChatLlmProviderRequestError('Character chat provider did not complete the response',
    'provider_incomplete_response', 'synthetic-terminal-request', evidence as ChatFailedProviderResponse);
  const tx = { chatSession: { update: jest.fn().mockResolvedValue({ id: SESSION }) },
    chatMessage: { findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        ...data, id: 'synthetic-greeting-message', createdAt: new Date(0),
      })) } };
  const prisma = { auditEvent: { create: jest.fn().mockResolvedValue({ id: 'synthetic-audit' }) },
    chatMessage: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
    $transaction: jest.fn().mockImplementation(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    walletAccount: { updateMany: jest.fn() }, walletLedger: { create: jest.fn() } };
  const adapter = new ChatLlmProviderAdapter({ get: () => undefined } as never);
  const generate = jest.spyOn(adapter, 'generate').mockRejectedValue(error);
  const fallback = jest.spyOn(adapter, 'fallbackResult');
  const service = new ChatService(prisma as never, adapter);
  const internals = service as any;
  const session = { id: SESSION, artist: { id: ARTIST, slug: 'synthetic-terminal', displayName: 'Synthetic character' },
    chatPersona: null };
  const order = { id: ORDER, status: 'completed', messages: [],
    chatFeatureProduct: { sku: 'SYNTHETIC_PAID_REPLY', featureType: 'deep_reply', priceLumina: 2 } };
  const runtimePersona = { welcome: { text: 'Synthetic welcome', source: 'synthetic_fixture' },
    starterOptions: [], personaTags: [], tone: { guideKo: '' } };
  const ready = { provider: 'openai', configured: true, status: 'provider_ready', messageKey: 'synthetic.ready' };
  // These admission/persona/history spies isolate the catch path; they do not verify those production gates.
  jest.spyOn(internals, 'getOwnedSessionForGeneration').mockResolvedValue(session);
  jest.spyOn(internals, 'getFeatureOrderForGeneration').mockResolvedValue(order);
  jest.spyOn(internals, 'getProviderUserContext').mockResolvedValue({ userEmail: null });
  jest.spyOn(internals, 'buildBasicChatPreflight').mockResolvedValue({ canGenerate: true });
  jest.spyOn(internals, 'providerReadinessForUser').mockResolvedValue(ready);
  jest.spyOn(internals, 'chatGenerationPolicy').mockReturnValue({ canGenerate: true });
  jest.spyOn(internals, 'selectDispatchArtistPersona').mockReturnValue({ status: 'unverified' });
  jest.spyOn(internals, 'assertArtistPersonaSelectionCurrent').mockResolvedValue(undefined);
  jest.spyOn(internals, 'buildCharacterRuntimePersonaContext').mockReturnValue(runtimePersona);
  jest.spyOn(internals, 'loadApprovedArtistKnowledgeContext').mockResolvedValue(undefined);
  jest.spyOn(internals, 'loadOptionalStoryMemory').mockResolvedValue(undefined);
  jest.spyOn(internals, 'recentProviderMessages').mockResolvedValue([]);
  jest.spyOn(internals, 'openingGreetingToneCandidate').mockReturnValue({ syntheticOnly: true });
  jest.spyOn(internals, 'providerOpsStatsForUser').mockResolvedValue({ totalResponses: 0, failureCount: 0 });
  jest.spyOn(internals, 'orderSummary').mockImplementation((...args: unknown[]) => {
    const value = args[0] as { id: string; status: string };
    return { id: value.id, status: value.status };
  });
  const refund = jest.spyOn(internals, 'failFeatureOrderAndRestoreLumina').mockResolvedValue(null);
  const persist = jest.spyOn(internals, 'persistGeneratedMessage').mockImplementation(async (...args: unknown[]) => {
    const generated = args[5] as ChatGenerationResult;
    return { message: { senderType: 'artist', body: generated.body }, usage: generated.usage };
  });
  const warn = jest.spyOn(internals.logger, 'warn').mockImplementation(() => undefined);
  return { service, internals, adapter, generate, fallback, error, prisma, tx, session, refund, persist, warn };
}

function expectSafe(value: unknown) {
  for (const secret of [BODY_SECRET, AUDIT_SECRET]) expect(JSON.stringify(value)).not.toContain(secret);
}

function expectAudit(f: ReturnType<typeof fixture>, paid: boolean) {
  expect(f.prisma.auditEvent.create).toHaveBeenCalledTimes(1);
  const data = f.prisma.auditEvent.create.mock.calls[0][0].data;
  expect(data).toMatchObject({ actorUserId: USER, actorType: 'system', action: 'chat_provider_response_failed',
    targetType: paid ? 'chat_feature_order' : 'chat_session', targetId: paid ? ORDER : SESSION,
    metadata: { schemaVersion: '2026-10-15.chat-provider-failure-v1', provider: 'openai',
      failedProviderResponse: f.error.failedResponse } });
  expectSafe(data);
  expect(f.prisma.$transaction).not.toHaveBeenCalled();
}

async function paidFailure(f: ReturnType<typeof fixture>) {
  let caught: unknown;
  try { await f.service.generateMessage(USER, SESSION, { body: 'Synthetic paid input', chatFeatureOrderId: ORDER }); }
  catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(ServiceUnavailableException);
  const response = (caught as ServiceUnavailableException).getResponse();
  expect(response).toMatchObject({ code: 'CHAT_LLM_GENERATION_FAILED', details: {
    generationStatus: 'failed', failedProviderResponse: f.error.failedResponse,
  } });
  expectSafe(response);
  return response as { details: { failedProviderResponseAuditRecorded: boolean } };
}

function expectFreeMetadata(f: ReturnType<typeof fixture>, auditRecorded: boolean) {
  expect(f.persist).toHaveBeenCalledTimes(1);
  const generated = f.persist.mock.calls[0][5] as ChatGenerationResult;
  expect(generated.usage).toEqual(LOCAL_USAGE);
  expect(generated.safetyMetadata).toMatchObject({ failedProviderResponse: f.error.failedResponse,
    failedProviderResponseAuditRecorded: auditRecorded, localFallbackCostOnly: true });
  expectSafe(generated);
  expect(f.refund).not.toHaveBeenCalled();
  expect(f.prisma.chatMessage.create).not.toHaveBeenCalled();
}

describe('ChatService terminal provider failure boundaries (synthetic storage only)', () => {
  it('free generateMessage catches the terminal error and passes safe fallback metadata after one audit', async () => {
    const f = fixture();
    const result = await f.service.generateMessage(USER, SESSION, { body: 'Synthetic free input' });
    expect(result).toMatchObject({ generationStatus: 'fallback', requestId: 'synthetic-terminal-request' });
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.fallback).toHaveBeenCalledTimes(1);
    expect(f.fallback).toHaveBeenCalledWith(f.error);
    expectAudit(f, false);
    expectFreeMetadata(f, true);
    expect(f.prisma.auditEvent.create.mock.invocationCallOrder[0]).toBeLessThan(f.persist.mock.invocationCallOrder[0]);
    expect(f.prisma.walletAccount.updateMany).not.toHaveBeenCalled();
    expect(f.prisma.walletLedger.create).not.toHaveBeenCalled();
  });

  it('paid generateMessage rejects partial output, invokes the unchanged three-argument refund once, then audits', async () => {
    const f = fixture();
    const response = await paidFailure(f);
    expect(response.details.failedProviderResponseAuditRecorded).toBe(true);
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.refund.mock.calls).toEqual([[USER, ORDER, 'generation_failed']]);
    expectAudit(f, true);
    expect(f.refund.mock.invocationCallOrder[0]).toBeLessThan(f.prisma.auditEvent.create.mock.invocationCallOrder[0]);
    expect(f.persist).not.toHaveBeenCalled();
    expect(f.fallback).not.toHaveBeenCalled();
    expect(f.prisma.chatMessage.create).not.toHaveBeenCalled();
    expect(f.tx.chatMessage.create).not.toHaveBeenCalled();
  });

  it('actual opening-greeting save keeps failed usage in both JSON metadata fields and never invokes an outer audit', async () => {
    const f = fixture();
    await f.internals.ensureSessionOpeningGreeting(USER, f.session);
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(f.tx.chatSession.update).toHaveBeenCalledTimes(1);
    expect(f.tx.chatMessage.create).toHaveBeenCalledTimes(1);
    const data = f.tx.chatMessage.create.mock.calls[0][0].data;
    expect(data.body).toEqual(expect.any(String));
    expect(data.body).not.toBe(BODY_SECRET);
    for (const key of ['modelMetadata', 'safetyMetadata']) {
      expect(data[key]).toMatchObject({ failedProviderResponse: f.error.failedResponse,
        failedProviderResponseStorage: 'greeting_metadata', localFallbackCostOnly: true,
        rawProviderPayloadStored: false });
      expect(data[key]).not.toHaveProperty('failedProviderResponseAuditRecorded');
    }
    expect(data.modelMetadata).toMatchObject({ source: 'fallback', estimatedCostKrw: '0.00' });
    expect(data.safetyMetadata).toMatchObject({ openingGreetingSource: 'fallback', providerAttempted: true });
    expectSafe(data);
    expect(f.prisma.auditEvent.create).not.toHaveBeenCalled();
    expect(f.prisma.chatMessage.create).not.toHaveBeenCalled();
    expect(f.persist).not.toHaveBeenCalled();
    expect(f.refund).not.toHaveBeenCalled();
  });

  it('audit rejection returns false with only a static warning and cannot replace free fallback or repeat paid recovery', async () => {
    for (const paid of [false, true]) {
      const f = fixture();
      f.prisma.auditEvent.create.mockRejectedValueOnce(new Error(AUDIT_SECRET));
      if (paid) {
        const response = await paidFailure(f);
        expect(response.details.failedProviderResponseAuditRecorded).toBe(false);
        expect(f.refund.mock.calls).toEqual([[USER, ORDER, 'generation_failed']]);
        expect(f.persist).not.toHaveBeenCalled();
        expect(f.fallback).not.toHaveBeenCalled();
      } else {
        const result = await f.service.generateMessage(USER, SESSION, { body: 'Synthetic free input' });
        expect(result).toMatchObject({ generationStatus: 'fallback' });
        expectFreeMetadata(f, false);
        expect(f.fallback).toHaveBeenCalledTimes(1);
      }
      expectAudit(f, paid);
      expect(f.generate).toHaveBeenCalledTimes(1);
      expect(f.warn.mock.calls).toEqual([['Character chat provider failure evidence was not recorded']]);
      expectSafe(f.warn.mock.calls);
    }
  });
});

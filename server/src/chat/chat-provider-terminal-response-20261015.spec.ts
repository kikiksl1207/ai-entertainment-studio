import { ConfigService } from '@nestjs/config';
import {
  ChatFailedProviderResponse,
  ChatGenerationRequest,
  ChatLlmProviderAdapter,
  ChatLlmProviderRequestError,
} from './llm-provider.adapter';

const USER = '00000000-0000-4000-8000-000000000815';
const PRIMARY = 'synthetic-terminal-primary';
const UNUSED = 'synthetic-terminal-unused';
const REQUEST_ID = 'synthetic-terminal-request';
const KEY = 'SYNTHETIC_KEY_NOT_A_CREDENTIAL';
const BODY_SECRET = 'SYNTHETIC_RAW_BODY_DO_NOT_DISPLAY';
const ERROR_SECRET = 'SYNTHETIC_ERROR_DO_NOT_DISPLAY';
const DETAIL_SECRET = 'SYNTHETIC_DETAIL_DO_NOT_DISPLAY';
const LOCAL_USAGE = { provider: 'openai', model: 'fallback', inputTokens: 0, outputTokens: 0, estimatedCostKrw: '0.00' };

function request(): ChatGenerationRequest {
  return { sessionId: '00000000-0000-4000-8000-000000000816', userId: USER,
    artist: { id: '00000000-0000-4000-8000-000000000817', slug: 'synthetic-terminal', displayName: 'Synthetic character' },
    persona: null, runtimePersona: null, mode: 'basic_chat',
    userMessage: 'Synthetic prompt; no real manuscript or private account.', recentMessages: [], order: null };
}

function completed(overrides: Record<string, unknown> = {}) {
  return { status: 'completed', output_text: 'Synthetic completed reply', error: null,
    incomplete_details: null, usage: { input_tokens: 11, output_tokens: 7 }, ...overrides };
}

function packet(payload: unknown) {
  return { ok: true, status: 200, headers: { get: jest.fn((key: string) => key === 'x-request-id' ? REQUEST_ID : null) },
    json: jest.fn().mockResolvedValue(payload) };
}

let fetchSpy: jest.SpyInstance;
beforeEach(() => {
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unplanned synthetic fetch is forbidden'));
});
afterEach(() => { fetchSpy.mockRestore(); });

function fixture(payload: unknown, model = PRIMARY) {
  const values: Record<string, string> = { CHARACTER_CHAT_PROVIDER_ENABLED: 'true', OPENAI_API_KEY: KEY,
    CHARACTER_CHAT_PROVIDER_ALLOWLIST: USER, OPENAI_CHAT_MODEL: model, OPENAI_CHAT_FALLBACK_MODEL: UNUSED };
  const config = { get: jest.fn((key: string) => values[key]) };
  const adapter = new ChatLlmProviderAdapter(config as unknown as ConfigService);
  const first = packet(payload);
  const unused = packet(completed({ output_text: 'Unused synthetic fallback reply' }));
  fetchSpy.mockReset().mockImplementation(async () => {
    if (fetchSpy.mock.calls.length === 1) return first as unknown as Response;
    if (fetchSpy.mock.calls.length === 2) return unused as unknown as Response;
    throw new Error('Synthetic dispatch bound exceeded');
  });
  return { adapter, first, unused, model };
}

function expectOneAttempt(f: ReturnType<typeof fixture>) {
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, options] = fetchSpy.mock.calls[0];
  expect(url).toBe('https://api.openai.com/v1/responses');
  expect(options.method).toBe('POST');
  expect(JSON.parse(options.body).model).toBe(f.model);
  expect(f.first.json).toHaveBeenCalledTimes(1);
  expect(f.unused.json).not.toHaveBeenCalled();
  expect(f.unused.headers.get).not.toHaveBeenCalled();
}

function expectSafe(error: ChatLlmProviderRequestError, fallback: unknown) {
  const view = JSON.stringify({ message: error.message, stack: error.stack,
    own: Object.fromEntries(Object.getOwnPropertyNames(error).map(key => [key, Reflect.get(error, key)])), fallback });
  for (const secret of [KEY, BODY_SECRET, ERROR_SECRET, DETAIL_SECRET]) expect(view).not.toContain(secret);
}

async function rejected(payload: Record<string, unknown>,
  expected: Partial<ChatFailedProviderResponse> & Pick<ChatFailedProviderResponse, 'responseStatus' | 'reason'>,
  model = PRIMARY, code?: string) {
  const f = fixture(payload, model);
  let caught: unknown;
  try { await f.adapter.generate(request()); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(ChatLlmProviderRequestError);
  const error = caught as ChatLlmProviderRequestError;
  expect(error.code).toBe(code ?? (expected.responseStatus === 'incomplete'
    ? 'provider_incomplete_response' : 'provider_response_not_completed'));
  if (!code) expect(error.message).toBe('Character chat provider did not complete the response');
  expect(error.requestId).toBe(REQUEST_ID);
  expect(error.failedResponse).toEqual({
    model: PRIMARY, inputTokens: 11, outputTokens: 7, estimatedCostKrw: null, billingStatus: 'unverified', ...expected });
  expect(Object.isFrozen(error.failedResponse)).toBe(true);
  const fallback = f.adapter.fallbackResult(error);
  expect(fallback.usage).toEqual(LOCAL_USAGE);
  expect(fallback.safetyMetadata).toMatchObject({ generationStatus: 'fallback',
    failedProviderResponse: error.failedResponse, localFallbackCostOnly: true });
  expectSafe(error, fallback);
  expectOneAttempt(f);
  return error;
}

describe('Chat provider terminal response contract (synthetic only)', () => {
  it('accepts completed output as verified and keeps empty completed output a bounded failure', async () => {
    const f = fixture(completed());
    const result = await f.adapter.generate(request());
    expect(result.body).toBe('Synthetic completed reply');
    expect(result.usage).toMatchObject({ provider: 'openai', model: PRIMARY, inputTokens: 11, outputTokens: 7 });
    expect(result.safetyMetadata).toMatchObject({ generationStatus: 'completed',
      providerResponseStatus: 'completed', providerCompletionVerified: true, fallbackModelUsed: false });
    expectOneAttempt(f);
    await rejected(completed({ output_text: '' }), { responseStatus: 'completed', reason: 'unreported' },
      PRIMARY, 'provider_empty_response');
  });

  it('preserves absent-status legacy output without claiming provider completion verification', async () => {
    const payload: Record<string, unknown> = completed();
    delete payload.status;
    const f = fixture(payload);
    const result = await f.adapter.generate(request());
    expect(result.body).toBe('Synthetic completed reply');
    expect(result.safetyMetadata).toMatchObject({ generationStatus: 'completed',
      providerResponseStatus: 'unreported', providerCompletionVerified: false, fallbackModelUsed: false });
    expectOneAttempt(f);
  });

  it('rejects partial and empty incomplete responses for max-output and content-filter reasons', async () => {
    for (const reason of ['max_output_tokens', 'content_filter'] as const) {
      for (const output_text of [BODY_SECRET, '']) {
        await rejected(completed({ status: 'incomplete', output_text,
          incomplete_details: { reason, internal: DETAIL_SECRET } }), { responseStatus: 'incomplete', reason });
      }
    }
  });

  it('rejects every explicit noncompleted status and bounds unrecognized status metadata', async () => {
    const rows: Array<{ raw: unknown; expected: ChatFailedProviderResponse['responseStatus'] }> = [
      { raw: 'failed', expected: 'failed' }, { raw: 'cancelled', expected: 'cancelled' },
      { raw: 'in_progress', expected: 'in_progress' }, { raw: 'queued', expected: 'queued' },
      { raw: 'unknown', expected: 'unknown' }, { raw: ERROR_SECRET, expected: 'unknown' },
      { raw: null, expected: 'unknown' },
    ];
    for (const row of rows) await rejected(completed({ status: row.raw, output_text: BODY_SECRET,
      error: { message: ERROR_SECRET, body: DETAIL_SECRET } }), { responseStatus: row.expected, reason: 'unreported' });
  });

  it('rejects completed responses with any nonnull error or incomplete details without leaking them', async () => {
    const rows: Array<{ fields: Record<string, unknown>; reason: ChatFailedProviderResponse['reason'] }> = [
      { fields: { error: { message: ERROR_SECRET } }, reason: 'unreported' },
      { fields: { error: false }, reason: 'unreported' },
      { fields: { incomplete_details: { reason: 'content_filter', raw: DETAIL_SECRET } }, reason: 'content_filter' },
      { fields: { incomplete_details: {} }, reason: 'unreported' },
    ];
    for (const row of rows) await rejected(completed({ output_text: BODY_SECRET, ...row.fields }),
      { responseStatus: 'completed', reason: row.reason });
  });

  it('retains null for missing or malformed failed-response usage instead of inventing zero', async () => {
    const rows: Array<{ usage: unknown; inputTokens: number | null; outputTokens: number | null }> = [
      { usage: undefined, inputTokens: null, outputTokens: null },
      { usage: null, inputTokens: null, outputTokens: null },
      { usage: [], inputTokens: null, outputTokens: null },
      { usage: { input_tokens: '11', output_tokens: 7 }, inputTokens: null, outputTokens: 7 },
      { usage: { input_tokens: 11, output_tokens: Number.NaN }, inputTokens: 11, outputTokens: null },
      { usage: { input_tokens: -1, output_tokens: Number.POSITIVE_INFINITY }, inputTokens: null, outputTokens: null },
      { usage: { input_tokens: 1.5, output_tokens: false }, inputTokens: null, outputTokens: null },
      { usage: { input_tokens: 0, output_tokens: 0 }, inputTokens: 0, outputTokens: 0 },
    ];
    for (const row of rows) await rejected(completed({ status: 'incomplete', output_text: BODY_SECRET,
      usage: row.usage, incomplete_details: { reason: 'max_output_tokens' } }),
    { responseStatus: 'incomplete', reason: 'max_output_tokens', inputTokens: row.inputTokens, outputTokens: row.outputTokens });
  });

  it('allowlists failure reasons and bounds malformed configured models in failure evidence', async () => {
    await rejected(completed({ status: 'incomplete', output_text: BODY_SECRET,
      incomplete_details: { reason: 'steered' } }), { responseStatus: 'incomplete', reason: 'steered' });
    await rejected(completed({ status: 'incomplete', output_text: BODY_SECRET,
      incomplete_details: { reason: DETAIL_SECRET } }), { responseStatus: 'incomplete', reason: 'unknown' });
    await rejected(completed({ status: 'incomplete', output_text: BODY_SECRET }),
      { responseStatus: 'incomplete', reason: 'unreported', model: 'unreported' }, `${PRIMARY}\n${DETAIL_SECRET}`);
  });

  it('sanitizes the optional constructor evidence and preserves local fallback usage separately', () => {
    const values = { responseStatus: 'incomplete', reason: 'max_output_tokens', model: PRIMARY,
      inputTokens: 11, outputTokens: 7, estimatedCostKrw: null, billingStatus: 'unverified',
      body: BODY_SECRET, error: ERROR_SECRET };
    const error = new ChatLlmProviderRequestError('Character chat provider did not complete the response',
      'provider_incomplete_response', REQUEST_ID, values as ChatFailedProviderResponse);
    const f = fixture(null);
    const fallback = f.adapter.fallbackResult(error);
    expect(error.failedResponse).toEqual({ responseStatus: 'incomplete', reason: 'max_output_tokens', model: PRIMARY,
      inputTokens: 11, outputTokens: 7, estimatedCostKrw: null, billingStatus: 'unverified' });
    expect(Object.isFrozen(error.failedResponse)).toBe(true);
    expect(fallback.usage).toEqual(LOCAL_USAGE);
    expect(fallback.safetyMetadata.failedProviderResponse).toEqual(error.failedResponse);
    expectSafe(error, fallback);
    const malformed = new ChatLlmProviderRequestError('Character chat provider request failed', 'provider_request_failed', null,
      { responseStatus: ERROR_SECRET, reason: DETAIL_SECRET, model: `${PRIMARY}\n${DETAIL_SECRET}`,
        inputTokens: -1, outputTokens: '7', estimatedCostKrw: '9.00', billingStatus: 'paid', body: BODY_SECRET,
      } as unknown as ChatFailedProviderResponse);
    const malformedFallback = f.adapter.fallbackResult(malformed);
    expect(malformed.failedResponse).toEqual({ responseStatus: 'unknown', reason: 'unknown', model: 'unreported',
      inputTokens: null, outputTokens: null, estimatedCostKrw: null, billingStatus: 'unverified' });
    expect(malformedFallback.usage).toEqual(LOCAL_USAGE);
    expect(malformedFallback.safetyMetadata.failedProviderResponse).toEqual(malformed.failedResponse);
    expectSafe(malformed, malformedFallback);
    const legacy = f.adapter.fallbackResult(new ChatLlmProviderRequestError('Safe synthetic failure', 'provider_timeout'));
    expect(legacy.usage).toEqual(LOCAL_USAGE);
    expect(legacy.safetyMetadata.failedProviderResponse).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(f.unused.json).not.toHaveBeenCalled();
  });
});

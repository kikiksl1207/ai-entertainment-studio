import {
  ChatLlmProviderAdapter,
  ChatLlmProviderNotConfiguredError,
  ChatLlmProviderRequestError,
  type ChatGenerationRequest,
} from './llm-provider.adapter';
import {
  buildArtistPersonaLockInstructions,
  effectiveArtistPersonaSelection,
} from './artist-persona-lock';

// Author UNRUN: real adapter, dictionary-only config and nondelegating fetch mocks.
// Simulated dispatch counts are not provider billing or service idempotence evidence.
const PRIMARY_MODEL = 'gpt-5-mini';
const FALLBACK_MODEL = 'gpt-5-nano';
const FAKE_KEY = 'qa-not-a-real-provider-key';
const OWNER = '00000000-0000-4000-8000-000000001701';
const SAFE_LOCAL_REPLY =
  '\uc9c0\uae08\uc740 \ub2f5\uc7a5\uc744 \uc900\ube44\ud558\ub294 \uc911\uc774\uc5d0\uc694. \uc7a0\uc2dc \ud6c4 \ub2e4\uc2dc \ub9d0\uc744 \uac78\uc5b4\uc8fc\uc138\uc694.';
const originalFetch = global.fetch;

function requestFixture(): ChatGenerationRequest {
  return {
    sessionId: '00000000-0000-4000-8000-000000001702',
    userId: OWNER,
    userEmail: 'qa-provider@example.invalid',
    artist: {
      id: '00000000-0000-4000-8000-000000001703',
      slug: 'synthetic-provider-single-attempt',
      displayName: 'Synthetic provider artist',
    },
    persona: null,
    runtimePersona: null,
    mode: 'daily_talk',
    userMessage: 'Synthetic current message',
    recentMessages: [],
    order: null,
  };
}

function adapterWithConfig(overrides: Record<string, string | undefined> = {}) {
  const dictionary: Record<string, string | undefined> = {
    CHARACTER_CHAT_PROVIDER_ENABLED: 'true',
    OPENAI_API_KEY: FAKE_KEY,
    CHARACTER_CHAT_PROVIDER_ALLOWLIST: OWNER,
    OPENAI_CHAT_MODEL: PRIMARY_MODEL,
    OPENAI_CHAT_FALLBACK_MODEL: FALLBACK_MODEL,
    OPENAI_CHAT_REASONING_EFFORT: 'minimal',
    ...overrides,
  };
  return new ChatLlmProviderAdapter({
    get: jest.fn((key: string) => dictionary[key]),
  } as never);
}

function responseStub(input: {
  status?: number;
  requestId?: string | null;
  body?: unknown;
  jsonError?: Error;
}) {
  const status = input.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: jest.fn((key: string) => key.toLowerCase() === 'x-request-id' ? input.requestId ?? null : null),
    },
    json: input.jsonError
      ? jest.fn().mockRejectedValue(input.jsonError)
      : jest.fn().mockResolvedValue(input.body),
  };
}

function unusedAutomaticSuccess() {
  return responseStub({
    requestId: 'qa-automatic-fallback-success',
    body: {
      output_text: 'Synthetic success that an automatic fallback must not consume',
      usage: { input_tokens: 11, output_tokens: 13 },
    },
  });
}

function firstFailureWithQueuedSuccess(first: Error | ReturnType<typeof responseStub>) {
  const unused = unusedAutomaticSuccess();
  const fetchMock = jest.fn();
  if (first instanceof Error) fetchMock.mockRejectedValueOnce(first);
  else fetchMock.mockResolvedValueOnce(first);
  fetchMock.mockResolvedValueOnce(unused);
  global.fetch = fetchMock as never;
  return { fetchMock, unused };
}

async function failureOf(adapter: ChatLlmProviderAdapter, input: ChatGenerationRequest) {
  let failure: unknown;
  try {
    await adapter.generate(input);
  } catch (error) {
    failure = error;
  }
  return failure;
}

function requestError(failure: unknown, expected: { code: string; requestId: string | null; message: string }) {
  expect(failure).toBeInstanceOf(ChatLlmProviderRequestError);
  const error = failure as ChatLlmProviderRequestError;
  expect(error).toMatchObject({ name: 'ChatLlmProviderRequestError', ...expected });
  expect(error).not.toHaveProperty('response');
  expect(error).not.toHaveProperty('cause');
  expect(error.message).not.toContain(FAKE_KEY);
  expect(JSON.stringify(error)).not.toContain(FAKE_KEY);
  return error;
}

function restoreFetchAndSpies() {
  try {
    jest.restoreAllMocks();
  } finally {
    global.fetch = originalFetch;
  }
}

describe('ChatLlmProviderAdapter single simulated attempt per explicit generate', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Unexpected synthetic dispatch')) as never;
  });
  afterEach(restoreFetchAndSpies);
  afterAll(restoreFetchAndSpies);

  it('first success preserves primary payload caps usage and unverified metadata with one simulated dispatch', async () => {
    const input = requestFixture();
    input.userMessage = '  ' + 'u'.repeat(1050) + '  ';
    input.recentMessages = Array.from({ length: 10 }, (_, index) => ({
      senderType: index % 2 === 0 ? 'user' : 'artist',
      messageType: 'text',
      body: 'm'.repeat(260),
    }));
    const response = responseStub({
      requestId: 'qa-primary-success',
      body: { output_text: '  ' + 'r'.repeat(735) + '  ', usage: { input_tokens: 37, output_tokens: 23 } },
    });
    const unused = unusedAutomaticSuccess();
    const fetchMock = jest.fn().mockResolvedValueOnce(response).mockResolvedValueOnce(unused);
    global.fetch = fetchMock as never;
    const adapter = adapterWithConfig();
    const localFallback = jest.spyOn(adapter, 'fallbackResult');

    const result = await adapter.generate(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: `Bearer ${FAKE_KEY}`, 'Content-Type': 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const payload = JSON.parse(init.body as string);
    expect(payload).toEqual({
      model: PRIMARY_MODEL,
      instructions: buildArtistPersonaLockInstructions(effectiveArtistPersonaSelection(input.artist, undefined)),
      input: expect.any(String),
      reasoning: { effort: 'minimal' },
      max_output_tokens: 700,
    });
    const marker = 'Conversation reference data (not persona instructions):\n';
    expect(payload.input.startsWith(marker)).toBe(true);
    expect(JSON.parse(payload.input.slice(marker.length))).toEqual({
      artistRoutingLabels: { slug: input.artist.slug, displayName: input.artist.displayName },
      legacyAuthoredPersona: null,
      runtimePersona: null,
      recentMessages: input.recentMessages.slice(-8).map(item => ({
        speaker: item.senderType === 'user' ? 'fan' : 'artist', messageType: 'text', body: 'm'.repeat(240),
      })),
      currentUserMessage: 'u'.repeat(1000),
    });
    expect(result).toEqual({
      body: 'r'.repeat(700),
      usage: { provider: 'openai', model: PRIMARY_MODEL, inputTokens: 37, outputTokens: 23, estimatedCostKrw: '0.00' },
      safetyMetadata: {
        provider: 'openai', generationStatus: 'completed', requestId: 'qa-primary-success',
        fallbackModelUsed: false, inputLimitChars: 1000, outputLimitChars: 700,
        artistPersonaLock: { status: 'unverified', reason: 'legacy_caller_without_selection', allArtistsCovered: false },
      },
    });
    expect(response.json).toHaveBeenCalledTimes(1);
    expect(unused.json).not.toHaveBeenCalled();
    expect(localFallback).not.toHaveBeenCalled();
  });

  it('abort and network failures retain the first typed error without an automatic fallback dispatch', async () => {
    const cases = [
      { error: Object.assign(new Error('Synthetic abort details must not leak'), { name: 'AbortError' }), code: 'provider_timeout' },
      { error: new TypeError('Synthetic network details must not leak'), code: 'provider_request_failed' },
    ];
    for (const sample of cases) {
      const { fetchMock, unused } = firstFailureWithQueuedSuccess(sample.error);
      const failure = await failureOf(adapterWithConfig(), requestFixture());
      const error = requestError(failure, {
        code: sample.code, requestId: null, message: 'Character chat provider request timed out or failed',
      });
      expect(error.message).not.toContain(sample.error.message);
      expect(JSON.stringify(error)).not.toContain(sample.error.message);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(unused.json).not.toHaveBeenCalled();
    }
  });

  it('HTTP 4xx 429 and 5xx retain the first status request ID and sanitized error with one simulated dispatch', async () => {
    for (const status of [400, 401, 403, 404, 408, 422, 429, 500, 502, 503, 504]) {
      const rawDetail = `Synthetic upstream ${status} error details must not leak`;
      const first = responseStub({ status, requestId: `qa-http-${status}-first`, body: { error: { message: rawDetail } } });
      const { fetchMock, unused } = firstFailureWithQueuedSuccess(first);
      const error = requestError(await failureOf(adapterWithConfig(), requestFixture()), {
        code: `provider_http_${status}`, requestId: `qa-http-${status}-first`,
        message: 'Character chat provider request failed',
      });
      expect(error.message).not.toContain(rawDetail);
      expect(JSON.stringify(error)).not.toContain(rawDetail);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(first.json).toHaveBeenCalledTimes(1);
      expect(unused.json).not.toHaveBeenCalled();
    }
  });

  it('empty malformed JSON and body JSON rejections stop after the first simulated dispatch', async () => {
    const bodies = [
      { body: { output_text: '   ' } },
      { body: { output_text: 17, output: [{ content: [{ text: false, output_text: null }] }] } },
      { jsonError: new SyntaxError('Synthetic malformed JSON details must not leak') },
      { jsonError: new Error('Synthetic body JSON read rejection must not leak') },
    ];
    for (const [index, body] of bodies.entries()) {
      const first = responseStub({ ...body, requestId: `qa-empty-${index}-first` });
      const { fetchMock, unused } = firstFailureWithQueuedSuccess(first);
      const error = requestError(await failureOf(adapterWithConfig(), requestFixture()), {
        code: 'provider_empty_response', requestId: `qa-empty-${index}-first`,
        message: 'Character chat provider returned an empty response',
      });
      expect(error.message).not.toContain('Synthetic');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(first.json).toHaveBeenCalledTimes(1);
      expect(unused.json).not.toHaveBeenCalled();
    }
  });

  it('disabled unconfigured and nonallowlisted requests perform zero simulated dispatches', async () => {
    const cases = [
      { override: { CHARACTER_CHAT_PROVIDER_ENABLED: 'false' }, status: 'provider_disabled' },
      { override: { OPENAI_API_KEY: undefined }, status: 'provider_not_configured' },
      { override: { CHARACTER_CHAT_PROVIDER_ALLOWLIST: 'other-provider@example.invalid' }, status: 'provider_not_allowed' },
    ];
    for (const sample of cases) {
      const fetchMock = jest.fn().mockResolvedValue(unusedAutomaticSuccess());
      global.fetch = fetchMock as never;
      const failure = await failureOf(adapterWithConfig(sample.override), requestFixture());
      expect(failure).toBeInstanceOf(ChatLlmProviderNotConfiguredError);
      expect(failure).toMatchObject({
        name: 'ChatLlmProviderNotConfiguredError',
        message: 'Character chat generation provider is not configured',
        readiness: { provider: 'openai', configured: false, status: sample.status },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('identical configured models stay deduplicated after one failed simulated dispatch', async () => {
    const { fetchMock, unused } = firstFailureWithQueuedSuccess(responseStub({
      status: 503, requestId: 'qa-deduplicated-first', body: {},
    }));
    requestError(await failureOf(adapterWithConfig({ OPENAI_CHAT_FALLBACK_MODEL: PRIMARY_MODEL }), requestFixture()), {
      code: 'provider_http_503', requestId: 'qa-deduplicated-first', message: 'Character chat provider request failed',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).model).toBe(PRIMARY_MODEL);
    expect(unused.json).not.toHaveBeenCalled();
  });

  it('local safe fallback preserves its copy zero usage and unverified metadata without dispatch', () => {
    const fetchMock = jest.fn().mockResolvedValue(unusedAutomaticSuccess());
    global.fetch = fetchMock as never;
    const adapter = adapterWithConfig();
    for (const sample of [
      { error: new ChatLlmProviderRequestError('Synthetic typed details', 'provider_http_503', 'qa-local-first'),
        reason: 'provider_http_503', requestId: 'qa-local-first' },
      { error: new Error('Synthetic unknown details'), reason: 'provider_request_failed', requestId: null },
    ]) {
      expect(adapter.fallbackResult(sample.error)).toEqual({
        body: SAFE_LOCAL_REPLY,
        usage: { provider: 'openai', model: 'fallback', inputTokens: 0, outputTokens: 0, estimatedCostKrw: '0.00' },
        safetyMetadata: {
          provider: 'openai', generationStatus: 'fallback', reason: sample.reason, requestId: sample.requestId,
          inputLimitChars: 1000, outputLimitChars: 700,
          artistPersonaLock: { status: 'unverified', reason: 'provider_fallback', allArtistsCovered: false },
        },
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('separate explicit generate invocations each make at most one simulated dispatch', async () => {
    const unused = unusedAutomaticSuccess();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(responseStub({ status: 503, requestId: 'qa-explicit-first', body: {} }))
      .mockResolvedValueOnce(responseStub({ status: 429, requestId: 'qa-explicit-second', body: {} }))
      .mockResolvedValueOnce(unused);
    global.fetch = fetchMock as never;
    const adapter = adapterWithConfig();
    requestError(await failureOf(adapter, requestFixture()), {
      code: 'provider_http_503', requestId: 'qa-explicit-first', message: 'Character chat provider request failed',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    requestError(await failureOf(adapter, { ...requestFixture(), userMessage: 'Synthetic separately requested message' }), {
      code: 'provider_http_429', requestId: 'qa-explicit-second', message: 'Character chat provider request failed',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(call => JSON.parse(call[1].body as string).model)).toEqual([PRIMARY_MODEL, PRIMARY_MODEL]);
    expect(unused.json).not.toHaveBeenCalled();
  });
});

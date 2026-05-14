import { ChatLlmProviderAdapter, ChatLlmProviderRequestError } from './llm-provider.adapter';

const baseRequest = {
  sessionId: '00000000-0000-4000-8000-000000000237',
  userId: '00000000-0000-4000-8000-000000000001',
  userEmail: 'beta@example.com',
  artist: {
    id: '00000000-0000-4000-8000-000000000002',
    slug: 'yoon-serin',
    displayName: '윤세린',
  },
  persona: {
    id: '00000000-0000-4000-8000-000000000003',
    name: 'soft-dm',
    systemPrompt: '따뜻하고 짧은 DM 톤으로 답한다.',
    safetyRules: { cleanMode: true },
    modelConfig: { replyLength: 'short' },
  },
  mode: 'daily_talk',
  userMessage: '오늘 하루가 조금 길었어.',
  recentMessages: [
    {
      senderType: 'user',
      messageType: 'text',
      body: '안녕',
    },
  ],
  order: null,
};

function adapterWithEnv(env: Record<string, string | undefined>) {
  return new ChatLlmProviderAdapter({
    get: jest.fn((key: string) => env[key]),
  } as never);
}

function responseStub(input: {
  ok: boolean;
  status?: number;
  requestId?: string | null;
  body?: unknown;
}) {
  return {
    ok: input.ok,
    status: input.status ?? 200,
    headers: {
      get: jest.fn((key: string) =>
        key.toLowerCase() === 'x-request-id' ? input.requestId ?? null : null,
      ),
    },
    json: jest.fn().mockResolvedValue(input.body ?? {}),
  };
}

describe('ChatLlmProviderAdapter readiness', () => {
  it('stays disabled by default without requiring OpenAI env', () => {
    const adapter = adapterWithEnv({});

    expect(adapter.readiness()).toMatchObject({
      provider: 'openai',
      configured: false,
      status: 'provider_disabled',
      messageKey: 'chat.generation.providerNotConfigured',
    });
  });

  it('requires the server-side API key when the private beta flag is on', () => {
    const adapter = adapterWithEnv({
      CHARACTER_CHAT_PROVIDER_ENABLED: 'true',
    });

    expect(adapter.readiness({ userId: baseRequest.userId })).toMatchObject({
      configured: false,
      status: 'provider_not_configured',
    });
  });

  it('requires an allowlisted user id or email before reporting ready', () => {
    const adapter = adapterWithEnv({
      CHARACTER_CHAT_PROVIDER_ENABLED: 'true',
      OPENAI_API_KEY: 'unit-test-placeholder-key',
      CHARACTER_CHAT_PROVIDER_ALLOWLIST: 'beta@example.com',
    });

    expect(adapter.readiness({ userId: 'other-user' })).toMatchObject({
      configured: false,
      status: 'provider_not_allowed',
    });
    expect(
      adapter.readiness({
        userId: baseRequest.userId,
        userEmail: 'BETA@example.com',
      }),
    ).toMatchObject({
      configured: true,
      status: 'provider_ready',
    });
  });
});

describe('ChatLlmProviderAdapter.generate', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('calls OpenAI Responses API and returns trimmed safe metadata', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      responseStub({
        ok: true,
        requestId: 'req_237_success',
        body: {
          output_text: '오늘은 여기까지 온 것만으로도 충분해. 천천히 숨 고르자.',
          usage: { input_tokens: 15, output_tokens: 20 },
        },
      }),
    );
    global.fetch = fetchMock as never;
    const adapter = adapterWithEnv({
      CHARACTER_CHAT_PROVIDER_ENABLED: 'true',
      OPENAI_API_KEY: 'unit-test-placeholder-key',
      CHARACTER_CHAT_PROVIDER_ALLOWLIST: baseRequest.userId,
      OPENAI_CHAT_MODEL: 'gpt-5-mini',
    });

    const result = await adapter.generate(baseRequest);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer unit-test-placeholder-key',
        }),
      }),
    );
    expect(result).toMatchObject({
      body: '오늘은 여기까지 온 것만으로도 충분해. 천천히 숨 고르자.',
      usage: {
        provider: 'openai',
        model: 'gpt-5-mini',
        inputTokens: 15,
        outputTokens: 20,
        estimatedCostKrw: '0.00',
      },
      safetyMetadata: {
        provider: 'openai',
        generationStatus: 'completed',
        requestId: 'req_237_success',
        fallbackModelUsed: false,
      },
    });
  });

  it('tries the fallback model when the primary model request fails', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        responseStub({
          ok: false,
          status: 503,
          requestId: 'req_237_primary',
        }),
      )
      .mockResolvedValueOnce(
        responseStub({
          ok: true,
          requestId: 'req_237_fallback',
          body: {
            output_text: '잠깐 숨 돌리고 다시 이야기하자.',
            usage: { input_tokens: 10, output_tokens: 12 },
          },
        }),
      );
    global.fetch = fetchMock as never;
    const adapter = adapterWithEnv({
      CHARACTER_CHAT_PROVIDER_ENABLED: 'true',
      OPENAI_API_KEY: 'unit-test-placeholder-key',
      CHARACTER_CHAT_PROVIDER_ALLOWLIST: 'beta@example.com',
      OPENAI_CHAT_MODEL: 'gpt-5-mini',
      OPENAI_CHAT_FALLBACK_MODEL: 'gpt-5-nano',
    });

    const result = await adapter.generate(baseRequest);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      body: '잠깐 숨 돌리고 다시 이야기하자.',
      usage: { model: 'gpt-5-nano' },
      safetyMetadata: {
        requestId: 'req_237_fallback',
        fallbackModelUsed: true,
      },
    });
  });

  it('surfaces a request error without exposing raw provider response content', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      responseStub({
        ok: false,
        status: 500,
        requestId: 'req_237_error',
        body: { error: { message: 'raw provider text should not be returned' } },
      }),
    ) as never;
    const adapter = adapterWithEnv({
      CHARACTER_CHAT_PROVIDER_ENABLED: 'true',
      OPENAI_API_KEY: 'unit-test-placeholder-key',
      CHARACTER_CHAT_PROVIDER_ALLOWLIST: 'beta@example.com',
    });

    await expect(adapter.generate(baseRequest)).rejects.toMatchObject({
      name: 'ChatLlmProviderRequestError',
      code: 'provider_http_500',
      requestId: 'req_237_error',
    } satisfies Partial<ChatLlmProviderRequestError>);
  });
});

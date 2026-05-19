import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_OPENAI_CHAT_MODEL = 'gpt-5-mini';
const DEFAULT_OPENAI_CHAT_FALLBACK_MODEL = 'gpt-5-nano';
const DEFAULT_OPENAI_REASONING_EFFORT = 'minimal';
const CHAT_INPUT_MAX_CHARS = 1000;
const CHAT_OUTPUT_MAX_CHARS = 700;
const OPENAI_PROVIDER_TIMEOUT_MS = 12_000;
const OPENAI_PROVIDER_MAX_OUTPUT_TOKENS = 700;
const SAFE_FALLBACK_MESSAGE =
  '지금은 답장을 준비하는 중이에요. 잠시 후 다시 말을 걸어주세요.';

export type ChatLlmProviderReadinessStatus =
  | 'provider_ready'
  | 'provider_disabled'
  | 'provider_not_configured'
  | 'provider_not_allowed';

export type ChatLlmProviderReadinessContext = {
  userId?: string;
  userEmail?: string | null;
};

export type ChatLlmProviderReadiness = {
  provider: string;
  configured: boolean;
  status: ChatLlmProviderReadinessStatus;
  messageKey: string;
};

export type ChatGenerationUsage = {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostKrw: string;
};

export type ChatGenerationRequest = {
  sessionId: string;
  userId: string;
  userEmail?: string | null;
  artist: {
    id: string;
    slug: string;
    displayName: string;
  };
  persona: {
    id: string;
    name: string;
    systemPrompt: string;
    safetyRules: unknown;
    modelConfig: unknown;
  } | null;
  runtimePersona: ChatRuntimePersonaContext | null;
  mode: string;
  userMessage: string;
  recentMessages: Array<{
    senderType: string;
    messageType: string;
    body: string | null;
  }>;
  order: {
    id: string;
    sku: string;
    featureType: string;
    priceLumina: unknown;
  } | null;
};

export type ChatRuntimePersonaContext = {
  welcome: {
    text: string;
    source: string;
  };
  starterOptions: Array<{
    key: string;
    label: string;
    message: string;
    directInput?: boolean;
  }>;
  tone: {
    tagline: string | null;
    contentTone: string | null;
    personalityKeywords: string[];
    toneTags: string[];
  };
  personaReference: {
    catalogVersion: string;
    selectedTraitIds: string[];
    selectedTraits: Array<{
      id: string;
      group: string;
      labelKo: string;
      i18nKey: string;
      conflictsWith: string[];
      toneGuideKo?: string;
    }>;
    customFields: {
      customTraitsKo: string[];
      fanNicknameKo: string | null;
      relationshipToneKo: string | null;
      favoriteTopicsKo: string[];
      openingMoodKo: string | null;
    };
    legacyToneSignals: {
      contentTone: string | null;
      personalityKeywords: string[];
    };
    source: string;
    readOnly: boolean;
    mutationEnabled: boolean;
  };
  forbiddenTone: string[];
  safetyNote: {
    text: string;
    source: string;
  };
  source: string;
};

export type ChatGenerationResult = {
  body: string;
  usage: ChatGenerationUsage;
  safetyMetadata: Record<string, unknown>;
};

type OpenAiResponseUsage = {
  input_tokens?: number;
  output_tokens?: number;
};

type OpenAiResponseBody = {
  output_text?: unknown;
  output?: unknown;
  usage?: OpenAiResponseUsage;
};

type OpenAiAttemptResult = {
  body: string;
  usage: ChatGenerationUsage;
  requestId: string | null;
};

export class ChatLlmProviderNotConfiguredError extends Error {
  readonly readiness: ChatLlmProviderReadiness;

  constructor(readiness: ChatLlmProviderReadiness) {
    super('Character chat generation provider is not configured');
    this.name = 'ChatLlmProviderNotConfiguredError';
    this.readiness = readiness;
  }
}

export class ChatLlmProviderRequestError extends Error {
  readonly code: string;
  readonly requestId: string | null;

  constructor(message: string, code: string, requestId: string | null = null) {
    super(message);
    this.name = 'ChatLlmProviderRequestError';
    this.code = code;
    this.requestId = requestId;
  }
}

export interface ChatLlmProvider {
  readiness(context?: ChatLlmProviderReadinessContext): ChatLlmProviderReadiness;
  generate(request: ChatGenerationRequest): Promise<ChatGenerationResult>;
}

@Injectable()
export class ChatLlmProviderAdapter implements ChatLlmProvider {
  constructor(private readonly configService: ConfigService) {}

  readiness(context?: ChatLlmProviderReadinessContext): ChatLlmProviderReadiness {
    const provider = 'openai';

    if (!this.booleanFromEnv('CHARACTER_CHAT_PROVIDER_ENABLED')) {
      return {
        provider,
        configured: false,
        status: 'provider_disabled',
        messageKey: 'chat.generation.providerNotConfigured',
      };
    }

    if (!this.envString('OPENAI_API_KEY')) {
      return {
        provider,
        configured: false,
        status: 'provider_not_configured',
        messageKey: 'chat.generation.providerNotConfigured',
      };
    }

    if (!this.isAllowlisted(context)) {
      return {
        provider,
        configured: false,
        status: 'provider_not_allowed',
        messageKey: 'chat.generation.privateBetaOnly',
      };
    }

    return {
      provider,
      configured: true,
      status: 'provider_ready',
      messageKey: 'chat.generation.ready',
    };
  }

  async generate(request: ChatGenerationRequest): Promise<ChatGenerationResult> {
    const readiness = this.readiness({
      userId: request.userId,
      userEmail: request.userEmail,
    });

    if (!readiness.configured) {
      throw new ChatLlmProviderNotConfiguredError(readiness);
    }

    const configuredModels = [
      this.envString('OPENAI_CHAT_MODEL') ?? DEFAULT_OPENAI_CHAT_MODEL,
      this.envString('OPENAI_CHAT_FALLBACK_MODEL') ??
        DEFAULT_OPENAI_CHAT_FALLBACK_MODEL,
    ].filter((model): model is string => Boolean(model));
    const models = configuredModels.filter(
      (model, index, list) => list.indexOf(model) === index,
    );
    let lastError: ChatLlmProviderRequestError | null = null;

    for (const model of models) {
      try {
        const result = await this.requestOpenAiResponse(model, request);

        return {
          body: result.body,
          usage: result.usage,
          safetyMetadata: {
            provider: readiness.provider,
            generationStatus: 'completed',
            requestId: result.requestId,
            fallbackModelUsed: model !== models[0],
            inputLimitChars: CHAT_INPUT_MAX_CHARS,
            outputLimitChars: CHAT_OUTPUT_MAX_CHARS,
          },
        };
      } catch (error) {
        lastError =
          error instanceof ChatLlmProviderRequestError
            ? error
            : new ChatLlmProviderRequestError(
                'Character chat provider request failed',
                'provider_request_failed',
              );
      }
    }

    throw (
      lastError ??
      new ChatLlmProviderRequestError(
        'Character chat provider request failed',
        'provider_request_failed',
      )
    );
  }

  fallbackResult(error: unknown): ChatGenerationResult {
    const providerError =
      error instanceof ChatLlmProviderRequestError ? error : null;

    return {
      body: SAFE_FALLBACK_MESSAGE,
      usage: {
        provider: 'openai',
        model: 'fallback',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostKrw: '0.00',
      },
      safetyMetadata: {
        provider: 'openai',
        generationStatus: 'fallback',
        reason: providerError?.code ?? 'provider_request_failed',
        requestId: providerError?.requestId ?? null,
        inputLimitChars: CHAT_INPUT_MAX_CHARS,
        outputLimitChars: CHAT_OUTPUT_MAX_CHARS,
      },
    };
  }

  private async requestOpenAiResponse(
    model: string,
    request: ChatGenerationRequest,
  ): Promise<OpenAiAttemptResult> {
    const apiKey = this.envString('OPENAI_API_KEY');

    if (!apiKey) {
      throw new ChatLlmProviderNotConfiguredError(this.readiness());
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_PROVIDER_TIMEOUT_MS);

    try {
      const response = await fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          instructions: this.buildSystemInstructions(request),
          input: this.buildConversationInput(request),
          reasoning: {
            effort:
              this.envString('OPENAI_CHAT_REASONING_EFFORT') ??
              DEFAULT_OPENAI_REASONING_EFFORT,
          },
          max_output_tokens: OPENAI_PROVIDER_MAX_OUTPUT_TOKENS,
        }),
        signal: controller.signal,
      });
      const requestId = response.headers.get('x-request-id');
      const responseBody = (await response.json().catch(() => null)) as
        | OpenAiResponseBody
        | null;

      if (!response.ok) {
        throw new ChatLlmProviderRequestError(
          'Character chat provider request failed',
          `provider_http_${response.status}`,
          requestId,
        );
      }

      const body = this.normalizeProviderOutput(responseBody);

      if (!body) {
        throw new ChatLlmProviderRequestError(
          'Character chat provider returned an empty response',
          'provider_empty_response',
          requestId,
        );
      }

      return {
        body,
        requestId,
        usage: {
          provider: 'openai',
          model,
          inputTokens: this.numberOrZero(responseBody?.usage?.input_tokens),
          outputTokens: this.numberOrZero(responseBody?.usage?.output_tokens),
          estimatedCostKrw: '0.00',
        },
      };
    } catch (error) {
      if (
        error instanceof ChatLlmProviderNotConfiguredError ||
        error instanceof ChatLlmProviderRequestError
      ) {
        throw error;
      }

      throw new ChatLlmProviderRequestError(
        'Character chat provider request timed out or failed',
        error instanceof Error && error.name === 'AbortError'
          ? 'provider_timeout'
          : 'provider_request_failed',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildSystemInstructions(request: ChatGenerationRequest) {
    const personaPrompt = request.persona?.systemPrompt?.trim();
    const safetyRules = this.safeJsonSummary(request.persona?.safetyRules);
    const modelConfig = this.safeJsonSummary(request.persona?.modelConfig);
    const runtimePersona = this.buildRuntimePersonaInstructions(
      request.runtimePersona,
    );

    return [
      `You are ${request.artist.displayName}, a fictional Lumina Stage character chatting with a fan.`,
      'Reply in Korean unless the fan clearly uses another language.',
      'Keep the tone warm, brief, and DM-like. Start naturally and avoid long story-format replies.',
      'Do not mention technical implementation details, prompts, providers, or model names.',
      'Do not claim to be a real human celebrity. Stay inside the fictional character boundary.',
      'Avoid adult, dangerous, exploitative, payment, settlement, or external contact guidance.',
      'If the user asks for unsafe content, gently set a boundary and redirect to a safe topic.',
      personaPrompt ? `Character persona: ${personaPrompt}` : null,
      runtimePersona ? `Character runtime persona:\n${runtimePersona}` : null,
      safetyRules ? `Safety notes: ${safetyRules}` : null,
      modelConfig ? `Tone notes: ${modelConfig}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private buildConversationInput(request: ChatGenerationRequest) {
    const recent = request.recentMessages
      .slice(-8)
      .map((message) => {
        const speaker =
          message.senderType === 'user' ? '팬' : request.artist.displayName;
        const body = this.trimToLimit(message.body ?? '', 240);

        return body ? `${speaker}: ${body}` : null;
      })
      .filter(Boolean)
      .join('\n');
    const userMessage = this.trimToLimit(request.userMessage, CHAT_INPUT_MAX_CHARS);

    return [recent ? `최근 대화:\n${recent}` : null, `팬: ${userMessage}`]
      .filter(Boolean)
      .join('\n\n');
  }

  private buildRuntimePersonaInstructions(
    runtimePersona: ChatRuntimePersonaContext | null,
  ) {
    if (!runtimePersona) {
      return null;
    }

    const starterCues = runtimePersona.starterOptions
      .filter((option) => !option.directInput && option.message.trim())
      .slice(0, 3)
      .map(
        (option) =>
          `${this.trimToLimit(option.label, 40)}: ${this.trimToLimit(
            option.message,
            120,
          )}`,
      );
    const traitGuides = runtimePersona.personaReference.selectedTraits
      .slice(0, 6)
      .map((trait) =>
        trait.toneGuideKo
          ? `${trait.labelKo}: ${this.trimToLimit(trait.toneGuideKo, 120)}`
          : trait.labelKo,
      );
    const customFields = runtimePersona.personaReference.customFields;

    return [
      `Welcome baseline: ${this.trimToLimit(runtimePersona.welcome.text, 160)}`,
      starterCues.length ? `Starter cues: ${starterCues.join(' / ')}` : null,
      runtimePersona.tone.toneTags.length
        ? `Tone tags: ${runtimePersona.tone.toneTags.slice(0, 8).join(', ')}`
        : null,
      traitGuides.length ? `Trait guides: ${traitGuides.join(' / ')}` : null,
      customFields.fanNicknameKo
        ? `Fan nickname: ${this.trimToLimit(customFields.fanNicknameKo, 40)}`
        : null,
      customFields.relationshipToneKo
        ? `Relationship tone: ${this.trimToLimit(
            customFields.relationshipToneKo,
            160,
          )}`
        : null,
      customFields.favoriteTopicsKo.length
        ? `Favorite topics: ${customFields.favoriteTopicsKo.slice(0, 8).join(', ')}`
        : null,
      customFields.openingMoodKo
        ? `Opening mood: ${this.trimToLimit(customFields.openingMoodKo, 80)}`
        : null,
      runtimePersona.forbiddenTone.length
        ? `Forbidden tone or blocked expressions: ${runtimePersona.forbiddenTone
            .slice(0, 8)
            .join(', ')}`
        : null,
      `Safety note: ${this.trimToLimit(runtimePersona.safetyNote.text, 180)}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private normalizeProviderOutput(responseBody: OpenAiResponseBody | null) {
    const outputText =
      typeof responseBody?.output_text === 'string'
        ? responseBody.output_text
        : this.extractOutputText(responseBody?.output);

    return this.trimToLimit(outputText.trim(), CHAT_OUTPUT_MAX_CHARS);
  }

  private extractOutputText(output: unknown): string {
    if (!Array.isArray(output)) {
      return '';
    }

    return output
      .flatMap((item) => {
        const content = this.recordOrEmpty(item).content;

        return Array.isArray(content) ? content : [];
      })
      .map((contentItem) => {
        const record = this.recordOrEmpty(contentItem);

        return typeof record.text === 'string'
          ? record.text
          : typeof record.output_text === 'string'
            ? record.output_text
            : '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  private isAllowlisted(context?: ChatLlmProviderReadinessContext) {
    const allowlist = this.envString('CHARACTER_CHAT_PROVIDER_ALLOWLIST')
      ?.split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    if (!allowlist?.length) {
      return false;
    }

    const userId = context?.userId?.trim().toLowerCase();
    const userEmail = context?.userEmail?.trim().toLowerCase();

    return Boolean(
      (userId && allowlist.includes(userId)) ||
        (userEmail && allowlist.includes(userEmail)),
    );
  }

  private booleanFromEnv(key: string) {
    const value = this.envString(key)?.toLowerCase();

    return value === 'true' || value === '1' || value === 'yes' || value === 'on';
  }

  private envString(key: string) {
    const value = this.configService.get<string>(key)?.trim();

    return value || null;
  }

  private numberOrZero(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private trimToLimit(value: string, limit: number) {
    const trimmed = value.trim();

    return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
  }

  private safeJsonSummary(value: unknown) {
    if (!value || (typeof value !== 'object' && !Array.isArray(value))) {
      return null;
    }

    return this.trimToLimit(JSON.stringify(value), 600);
  }

  private recordOrEmpty(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ArtistKnowledgeChatContext } from './artist-url-knowledge-contract';
import { StoryChatMemoryContext } from './story-chat-memory';
import {
  artistPersonaLockMetadata,
  buildArtistPersonaLockInstructions,
  effectiveArtistPersonaSelection,
  isLockedArtistPersona,
  type ArtistPersonaSelection,
} from './artist-persona-lock';

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
  personaSelection?: ArtistPersonaSelection;
  storyMemoryContext?: StoryChatMemoryContext;
  mode: string;
  userMessage: string;
  maxOutputTokens?: number;
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
    guideKo: string;
    guideSource: string;
  };
  personaTags: string[];
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
  knowledgeContext?: ArtistKnowledgeChatContext;
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

    const personaSelection = effectiveArtistPersonaSelection(request.artist, request.personaSelection);
    if (isLockedArtistPersona(request.personaSelection) && !isLockedArtistPersona(personaSelection)) {
      throw new ChatLlmProviderRequestError(
        'Selected character source is unavailable before dispatch',
        'provider_persona_source_changed',
      );
    }
    const prompt = {
      instructions: this.buildSystemInstructions(request, personaSelection),
      input: this.buildConversationInput(request),
    };

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
        const result = await this.requestOpenAiResponse(model, request, prompt);

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
            artistPersonaLock: artistPersonaLockMetadata(personaSelection),
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
        artistPersonaLock: { status: 'unverified', reason: 'provider_fallback', allArtistsCovered: false },
      },
    };
  }

  private async requestOpenAiResponse(
    model: string,
    request: ChatGenerationRequest,
    prompt: { instructions: string; input: string },
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
          instructions: prompt.instructions,
          input: prompt.input,
          reasoning: {
            effort:
              this.envString('OPENAI_CHAT_REASONING_EFFORT') ??
              DEFAULT_OPENAI_REASONING_EFFORT,
          },
          max_output_tokens:
            request.maxOutputTokens ?? OPENAI_PROVIDER_MAX_OUTPUT_TOKENS,
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

  private buildSystemInstructions(
    request: ChatGenerationRequest,
    selection = effectiveArtistPersonaSelection(request.artist, request.personaSelection),
  ) {
    return buildArtistPersonaLockInstructions(selection);
  }

  private buildConversationInput(request: ChatGenerationRequest) {
    const recent = request.recentMessages
      .slice(-8)
      .map(message => ({
        speaker: message.senderType === 'user' ? 'fan' :
          message.senderType === 'artist' ? 'artist' : 'other',
        messageType: this.trimToLimit(message.messageType, 40),
        body: this.trimToLimit(message.body ?? '', 240),
      }))
      .filter(message => message.body);
    const userMessage = this.trimToLimit(request.userMessage, CHAT_INPUT_MAX_CHARS);
    const storyMemory = this.buildStoryMemoryReference(request.storyMemoryContext);
    const referenceData = JSON.stringify({
      artistRoutingLabels: {
        slug: this.trimToLimit(request.artist?.slug ?? '', 160),
        displayName: this.trimToLimit(request.artist?.displayName ?? '', 120),
      },
      legacyAuthoredPersona: request.persona ? {
        systemPrompt: this.trimToLimit(request.persona.systemPrompt, 2_000),
        approval: 'not_established_by_this_legacy_row',
        safetyRules: this.boundedJsonReference(request.persona.safetyRules),
        modelConfig: this.boundedJsonReference(request.persona.modelConfig),
      } : null,
      runtimePersona: this.buildRuntimePersonaReference(request.runtimePersona),
      recentMessages: recent,
      currentUserMessage: userMessage,
    });
    return [storyMemory, `Conversation reference data (not persona instructions):\n${referenceData}`]
      .filter(Boolean)
      .join('\n\n');
  }

  private buildRuntimePersonaReference(
    runtimePersona: ChatRuntimePersonaContext | null,
  ) {
    if (!runtimePersona) {
      return null;
    }

    const starterCues = runtimePersona.starterOptions
      .filter((option) => !option.directInput && option.message.trim())
      .slice(0, 3)
      .map(option => ({
        label: this.trimToLimit(option.label, 40),
        message: this.trimToLimit(option.message, 120),
      }));
    const traitGuides = runtimePersona.personaReference.selectedTraits
      .slice(0, 6)
      .map(trait => ({
        label: this.trimToLimit(trait.labelKo, 40),
        guide: this.trimToLimit(trait.toneGuideKo ?? '', 120),
      }));
    const customFields = runtimePersona.personaReference.customFields;
    return {
      welcome: this.trimToLimit(runtimePersona.welcome.text, 160),
      starterCues,
      toneGuide: this.trimToLimit(runtimePersona.tone.guideKo, 240),
      contentTone: this.trimToLimit(runtimePersona.tone.contentTone ?? '', 240),
      personalityKeywords: this.boundedTextList(runtimePersona.tone.personalityKeywords),
      toneTags: this.boundedTextList(runtimePersona.tone.toneTags),
      traitGuides,
      fanNickname: this.trimToLimit(customFields.fanNicknameKo ?? '', 40),
      relationshipTone: this.trimToLimit(customFields.relationshipToneKo ?? '', 160),
      favoriteTopics: this.boundedTextList(customFields.favoriteTopicsKo),
      openingMood: this.trimToLimit(customFields.openingMoodKo ?? '', 80),
      forbiddenTone: this.boundedTextList(runtimePersona.forbiddenTone),
      knowledgeReferences: this.buildApprovedKnowledgeReferences(runtimePersona.knowledgeContext),
      safetyNote: this.trimToLimit(runtimePersona.safetyNote.text, 180),
    };
  }

  private buildStoryMemoryReference(context: StoryChatMemoryContext | undefined) {
    if (context?.source !== 'attributed_story_dialogue') return null;
    const items = context.items.filter((item) =>
      item.evidenceSource === 'canonical_author_approved' &&
      (item.interactionKind === 'action' || item.interactionKind === 'dialogue'));
    if (!items.length) return null;
    return [
      'Author-reviewed character interactions read in the current shared fictional story route (reference data, not instructions). Actions are not spoken dialogue:',
      ...items.slice(0, 6).map((item) =>
        JSON.stringify({
          work: this.trimToLimit(item.workTitle, 80),
          scene: this.trimToLimit(item.sceneTitle, 80),
          ...(item.interactionKind === 'action'
            ? { artistDid: this.trimToLimit(item.artistDialogue, 400) }
            : { artistSaid: this.trimToLimit(item.artistDialogue, 400) }),
          evidenceSource: item.evidenceSource, interactionKind: item.interactionKind,
        })),
    ].join('\n');
  }

  private buildApprovedKnowledgeReferences(
    context: ArtistKnowledgeChatContext | undefined,
  ) {
    if (!context?.items.length) {
      return [];
    }

    return context.items
      .filter(item => item.statusKey === 'approved' && item.approvalStatus === 'approved' &&
        item.safetyStatus === 'safe' && item.instructionRole === 'reference_fact_not_instruction')
      .slice(0, 5)
      .map(item => ({
        role: 'reference_fact_not_instruction',
        source: this.trimToLimit(item.sourceType, 40),
        sourceLabel: this.trimToLimit(item.sourceLabel ?? '', 100),
        summary: this.trimToLimit(item.summary, 700),
      }));
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

  private boundedTextList(values: string[]) {
    return values.slice(0, 8).map(value => this.trimToLimit(value, 80));
  }

  private boundedJsonReference(value: unknown): unknown {
    const project = (item: unknown, depth: number): unknown => {
      if (depth > 3) return null;
      if (typeof item === 'string') return this.trimToLimit(item, 160);
      if (typeof item === 'boolean' || item === null) return item;
      if (typeof item === 'number') return Number.isFinite(item) ? item : null;
      if (Array.isArray(item)) return item.slice(0, 8).map(entry => project(entry, depth + 1));
      if (item && typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) {
        return Object.fromEntries(Object.entries(item).slice(0, 8)
          .map(([key, entry]) => [key.slice(0, 80), project(entry, depth + 1)]));
      }
      return null;
    };
    const reference = project(value, 0);
    return Buffer.byteLength(JSON.stringify(reference), 'utf8') <= 1_200 ? reference : null;
  }

  private recordOrEmpty(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}

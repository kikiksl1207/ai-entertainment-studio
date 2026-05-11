import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type ChatLlmProviderReadiness = {
  provider: string;
  configured: boolean;
  status: 'provider_not_configured';
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

export type ChatGenerationResult = {
  body: string;
  usage: ChatGenerationUsage;
  safetyMetadata: Record<string, unknown>;
};

export class ChatLlmProviderNotConfiguredError extends Error {
  readonly readiness: ChatLlmProviderReadiness;

  constructor(readiness: ChatLlmProviderReadiness) {
    super('Character chat generation provider is not configured');
    this.name = 'ChatLlmProviderNotConfiguredError';
    this.readiness = readiness;
  }
}

export interface ChatLlmProvider {
  readiness(): ChatLlmProviderReadiness;
  generate(request: ChatGenerationRequest): Promise<ChatGenerationResult>;
}

@Injectable()
export class ChatLlmProviderAdapter implements ChatLlmProvider {
  constructor(private readonly configService: ConfigService) {}

  readiness(): ChatLlmProviderReadiness {
    const provider =
      this.configService.get<string>('CHAT_LLM_PROVIDER')?.trim() ||
      this.configService.get<string>('LLM_PROVIDER')?.trim() ||
      'not_configured';

    return {
      provider,
      configured: false,
      status: 'provider_not_configured',
      messageKey: 'chat.generation.providerNotConfigured',
    };
  }

  async generate(_request: ChatGenerationRequest): Promise<ChatGenerationResult> {
    throw new ChatLlmProviderNotConfiguredError(this.readiness());
  }
}

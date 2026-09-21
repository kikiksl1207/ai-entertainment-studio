import { Injectable } from '@nestjs/common';
import type { StoryContinuationApprovedContext } from './story-continuation-context.assembler';

export type StoryContinuationProviderRequest = {
  operationId: string;
  locale: string;
  contextFingerprint: string;
  promptVersion: string;
  outputSchemaVersion: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  provider?: string;
  model?: string;
  rateCardId?: string;
  rateCardVersion?: string;
  approvedContext?: StoryContinuationApprovedContext;
};

export type StoryContinuationProviderResult = {
  title: Record<string, string>;
  beats: Array<{
    beatType: 'paragraph' | 'dialogue' | 'scene_break';
    content: Record<string, string>;
  }>;
  visualManifest: Record<string, unknown>;
  nextChoices?: Array<{
    choiceKey: string;
    label: Record<string, string>;
  }>;
  ending?: { endingKey: string };
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    imageUnits: number;
  };
};

export type StoryContinuationProviderPreflight = {
  supported: boolean;
  reason?: string;
  budgetMethod?: string;
  inputTokenUpperBound?: number;
  inputTokenLimit?: number;
};

export abstract class StoryContinuationProvider {
  preflight?: (request: StoryContinuationProviderRequest) => Promise<StoryContinuationProviderPreflight> =
    async () => ({ supported: false, reason: 'provider_preflight_unavailable' });

  abstract readiness(): Promise<{ enabled: boolean; reason?: string }>;
  abstract generate(
    request: StoryContinuationProviderRequest,
    signal: AbortSignal,
  ): Promise<StoryContinuationProviderResult>;
}

export class StoryContinuationProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

@Injectable()
export class DisabledStoryContinuationProvider extends StoryContinuationProvider {
  preflight = async () => ({ supported: false, reason: 'provider_not_configured' });

  async readiness() {
    return { enabled: false, reason: 'provider_not_configured' };
  }

  async generate(
    _request: StoryContinuationProviderRequest,
    _signal: AbortSignal,
  ): Promise<StoryContinuationProviderResult> {
    throw new StoryContinuationProviderError('provider_not_configured', false);
  }
}

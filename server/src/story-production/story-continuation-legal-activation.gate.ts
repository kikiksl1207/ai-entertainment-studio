import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StoryAiActivationService } from './story-ai-activation.service';

export type StoryContinuationLegalActivationContext = {
  workId: string;
  releaseId: string;
  manuscriptVersionId: string | null;
  rightsContractVersionId: string | null;
  locale?: string;
};

export abstract class StoryContinuationLegalActivationGate {
  abstract authorize(
    context: StoryContinuationLegalActivationContext,
    tx?: Prisma.TransactionClient,
  ): Promise<{ active: boolean; reason: string }>;
}

@Injectable()
export class PersistedStoryContinuationLegalActivationGate extends StoryContinuationLegalActivationGate {
  constructor(private readonly activation: StoryAiActivationService) { super(); }
  async authorize(context: StoryContinuationLegalActivationContext, tx?: Prisma.TransactionClient) {
    const active = Boolean(await this.activation.prepare(context, tx, false));
    return { active, reason: active ? 'persisted_legal_activation' : 'STORY_AI_LEGAL_ACTIVATION_REQUIRED' };
  }
}

@Injectable()
export class UnconfiguredStoryContinuationLegalActivationGate
  extends StoryContinuationLegalActivationGate {
  async authorize() {
    return {
      active: false,
      reason: 'STORY_AI_LEGAL_ACTIVATION_REQUIRED',
    };
  }
}

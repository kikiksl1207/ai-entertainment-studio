import { Injectable } from '@nestjs/common';

export type StoryContinuationLegalActivationContext = {
  workId: string;
  releaseId: string;
  manuscriptVersionId: string | null;
  rightsContractVersionId: string | null;
};

export abstract class StoryContinuationLegalActivationGate {
  abstract authorize(
    context: StoryContinuationLegalActivationContext,
  ): Promise<{ active: boolean; reason: string }>;
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

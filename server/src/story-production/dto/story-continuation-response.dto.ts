export type StoryAiContinuationProvenance = 'ai_generated' | 'ai_reused';

export class StoryAiContinuationStatusResponseDto {
  continuationId!: string;
  status!: string;
  revisionAfterRequest!: number;
  allowanceRemaining!: number;
  retryable!: boolean;
  progressApplied!: boolean;
  privateInputReturned!: false;
  providerPayloadReturned!: false;
  internalCostReturned!: false;
  resultGeneratedSceneId!: string | null;
  provenance!: StoryAiContinuationProvenance;
  idempotentReplay!: boolean;
  createdAt!: Date;
  completedAt!: Date | null;
}

import { Injectable } from '@nestjs/common';

export type StoryReusableResultEvidenceSnapshot = {
  rightsActivationKey: string;
  moderationPolicyVersion: string;
  moderationEvidenceVersion: string;
  qualityPolicyVersion: string;
};

export type StoryReusableResultApprovalContext = {
  workId: string;
  releaseId: string;
  releaseChecksum: string;
  manuscriptVersionId: string;
  rightsContractVersionId: string;
  resultChecksum?: string;
};

export abstract class StoryReusableResultApprovalGate {
  abstract evaluate(
    context: StoryReusableResultApprovalContext,
  ): Promise<{
    eligible: boolean;
    reason: string;
    snapshot?: StoryReusableResultEvidenceSnapshot;
  }>;
}

@Injectable()
export class UnconfiguredStoryReusableResultApprovalGate
  extends StoryReusableResultApprovalGate {
  async evaluate() {
    return {
      eligible: false,
      reason: 'persistent_legal_moderation_quality_evidence_unavailable',
    };
  }
}

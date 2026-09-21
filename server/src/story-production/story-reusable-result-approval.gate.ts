import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StoryAiActivationService } from './story-ai-activation.service';

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
  resultId?: string;
  locale?: string;
};

export abstract class StoryReusableResultApprovalGate {
  prepare(context: StoryReusableResultApprovalContext, tx?: Prisma.TransactionClient) {
    return this.evaluate(context, tx);
  }
  async authorizeResult(_context: StoryReusableResultApprovalContext, _tx?: Prisma.TransactionClient) {
    return false;
  }
  abstract evaluate(
    context: StoryReusableResultApprovalContext,
    tx?: Prisma.TransactionClient,
  ): Promise<{
    eligible: boolean;
    reason: string;
    snapshot?: StoryReusableResultEvidenceSnapshot;
  }>;
}

@Injectable()
export class PersistedStoryReusableResultApprovalGate extends StoryReusableResultApprovalGate {
  constructor(private readonly activation: StoryAiActivationService) { super(); }

  async prepare(context: StoryReusableResultApprovalContext, tx?: Prisma.TransactionClient) {
    const row = await this.activation.prepare(context, tx);
    return row ? { eligible: true, reason: 'legal_activation_prepared', snapshot: {
      rightsActivationKey: row.id, moderationPolicyVersion: row.moderationPolicyVersion,
      moderationEvidenceVersion: row.moderationEvidenceVersion, qualityPolicyVersion: row.qualityPolicyVersion,
    } } : { eligible: false, reason: 'persistent_legal_activation_required' };
  }

  async evaluate(context: StoryReusableResultApprovalContext, tx?: Prisma.TransactionClient) {
    const allowed = await this.authorizeResult(context, tx);
    return allowed ? this.prepare(context, tx) : { eligible: false, reason: 'result_evidence_required' };
  }

  authorizeResult(context: StoryReusableResultApprovalContext, tx?: Prisma.TransactionClient) {
    return this.activation.authorizeResult(context, tx);
  }
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

import { continuationHash } from './story-continuation-context.policy';
import type { StoryReusableResultEvidenceSnapshot } from './story-reusable-result-approval.gate';

export const STORY_AI_REUSE_COST_POLICY_VERSION = 'story-ai-reuse-cost-v1';

export type StoryReusableResultKeyInput = {
  releaseId: string;
  releaseChecksum: string;
  sourceKind: 'canonical' | 'generated';
  sourceCanonicalPartId: string | null;
  sourceCanonicalSceneId: string | null;
  sourceCanonicalChoiceId: string | null;
  sourceSharedResultId: string | null;
  sourceSharedChoiceKey: string | null;
  sourceFingerprint: string;
  semanticPathFingerprint: string;
  contextFingerprint: string;
  promptVersion: string;
  outputSchemaVersion: string;
  locale: string;
  provider: string;
  model: string;
  rateCardVersion: string;
  costPolicyVersion: string;
  evidence: StoryReusableResultEvidenceSnapshot;
};

export function storyReusableResultKey(input: StoryReusableResultKeyInput) {
  return continuationHash(input);
}

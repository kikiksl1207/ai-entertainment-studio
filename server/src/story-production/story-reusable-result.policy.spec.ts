import { storyReusableResultKey, type StoryReusableResultKeyInput } from './story-reusable-result.policy';
import { UnconfiguredStoryReusableResultApprovalGate } from './story-reusable-result-approval.gate';

const base: StoryReusableResultKeyInput = {
  releaseId: 'release-1',
  releaseChecksum: 'release-checksum-1',
  sourceKind: 'canonical',
  sourceCanonicalPartId: 'part-1',
  sourceCanonicalSceneId: 'scene-1',
  sourceCanonicalChoiceId: 'choice-1',
  sourceSharedResultId: null,
  sourceSharedChoiceKey: null,
  sourceFingerprint: 'source-1',
  semanticPathFingerprint: 'path-1',
  contextFingerprint: 'context-1',
  promptVersion: 'prompt-1',
  outputSchemaVersion: 'schema-1',
  locale: 'ko',
  provider: 'provider-1',
  model: 'model-1',
  rateCardVersion: 'rate-1',
  costPolicyVersion: 'cost-1',
  evidence: {
    rightsActivationKey: 'rights-1',
    moderationPolicyVersion: 'moderation-policy-1',
    moderationEvidenceVersion: 'moderation-evidence-1',
    qualityPolicyVersion: 'quality-1',
  },
};

describe('shared story result reuse identity', () => {
  it('fails closed without persisted legal, moderation, and quality evidence', async () => {
    await expect(new UnconfiguredStoryReusableResultApprovalGate().evaluate())
      .resolves.toEqual({
        eligible: false,
        reason: 'persistent_legal_moderation_quality_evidence_unavailable',
      });
  });

  it.each([
    ['releaseId', { releaseId: 'release-2' }],
    ['releaseChecksum', { releaseChecksum: 'release-checksum-2' }],
    ['sourcePart', { sourceCanonicalPartId: 'part-2' }],
    ['sourceScene', { sourceCanonicalSceneId: 'scene-2' }],
    ['sourceChoice', { sourceCanonicalChoiceId: 'choice-2' }],
    ['sharedSource', { sourceSharedResultId: 'shared-source-2' }],
    ['sharedChoice', { sourceSharedChoiceKey: 'shared-choice-2' }],
    ['sourceFingerprint', { sourceFingerprint: 'source-2' }],
    ['semanticPath', { semanticPathFingerprint: 'path-2' }],
    ['approvedContext', { contextFingerprint: 'context-2' }],
    ['prompt', { promptVersion: 'prompt-2' }],
    ['outputSchema', { outputSchemaVersion: 'schema-2' }],
    ['locale', { locale: 'en' }],
    ['provider', { provider: 'provider-2' }],
    ['model', { model: 'model-2' }],
    ['rateCard', { rateCardVersion: 'rate-2' }],
    ['costPolicy', { costPolicyVersion: 'cost-2' }],
    ['rightsActivation', { evidence: { ...base.evidence, rightsActivationKey: 'rights-2' } }],
    ['moderationPolicy', { evidence: { ...base.evidence, moderationPolicyVersion: 'moderation-policy-2' } }],
    ['moderationEvidence', { evidence: { ...base.evidence, moderationEvidenceVersion: 'moderation-evidence-2' } }],
    ['qualityPolicy', { evidence: { ...base.evidence, qualityPolicyVersion: 'quality-2' } }],
  ])('misses when %s changes', (_dimension, change) => {
    expect(storyReusableResultKey({ ...base, ...change } as StoryReusableResultKeyInput))
      .not.toBe(storyReusableResultKey(base));
  });

  it('does not accept reader, progress, or private-input dimensions in the key contract', () => {
    expect(Object.keys(base)).not.toEqual(expect.arrayContaining([
      'userId', 'progressId', 'customChoice', 'privateInput',
    ]));
  });
});

export const STORY_ENDING_PROVENANCE_VALUES = [
  'author_default',
  'author_sub',
  'ai_generated',
] as const;

export type StoryEndingProvenance =
  (typeof STORY_ENDING_PROVENANCE_VALUES)[number];

export const STORY_ENDING_PROVENANCE_LABEL_KEYS: Record<
  StoryEndingProvenance,
  string
> = {
  author_default: 'storyStage.ending.provenance.authorDefault',
  author_sub: 'storyStage.ending.provenance.authorSub',
  ai_generated: 'storyStage.ending.provenance.aiGenerated',
};

export interface StoryEndingCompletionSource {
  endingKey: string;
  provenance: StoryEndingProvenance;
  routeSummaryKey: string;
  stateSignatureKey: string;
}

function stableSignatureHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildStoryEndingCompletionSignature(
  source: StoryEndingCompletionSource,
): string {
  return `story-completion-${stableSignatureHash(
    [
      source.endingKey,
      source.provenance,
      source.routeSummaryKey,
      source.stateSignatureKey,
    ].join('|'),
  )}`;
}

export function projectStoryEndingCompletion(
  source: StoryEndingCompletionSource,
) {
  return {
    endingKey: source.endingKey,
    endingLabelKey: STORY_ENDING_PROVENANCE_LABEL_KEYS[source.provenance],
    routeSummaryKey: source.routeSummaryKey,
    completionSignature: buildStoryEndingCompletionSignature(source),
  };
}

export function canApplyStoryEndingTransition(
  current: StoryEndingProvenance,
  incoming: StoryEndingProvenance,
): boolean {
  if (incoming !== 'ai_generated') return true;
  return current === 'ai_generated';
}

export const STORY_ENDING_PROVENANCE_POLICY_BACKEND_CONTRACT = {
  version: '2026-07-11.story-ending-provenance-policy.v1',
  status: 'read_model_and_policy_contract',
  provenanceValues: STORY_ENDING_PROVENANCE_VALUES,
  authorEndingPolicy: {
    defaultEndingCount: 1,
    subEndingMin: 2,
    subEndingMax: 10,
    aiMayOverwriteAuthorEnding: false,
  },
  aiEndingPolicy: {
    multipleEndingsPerStateAllowed: true,
    distinctStateRequiresDistinctCompletionSignature: true,
    authorOwnershipMayNotBeClaimed: true,
  },
  publicProjectionFields: [
    'endingKey',
    'endingLabelKey',
    'routeSummaryKey',
    'completionSignature',
  ],
  localePolicy: {
    labelKeys: STORY_ENDING_PROVENANCE_LABEL_KEYS,
    supportedLocales: ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'],
    rawProvenanceAsUiCopy: false,
  },
  mutationPolicy: {
    endingWrite: false,
    authorEndingOverwrite: false,
    providerCall: false,
    storyProgressMutation: false,
    paymentMutation: false,
  },
} as const;

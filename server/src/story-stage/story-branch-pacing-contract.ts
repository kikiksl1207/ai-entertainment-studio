export interface StoryBranchPacingInput {
  currentPartNumber: number;
  totalPartCount: number;
  timelineSummaryKey: string;
  storyTimeKey: string;
  authorStyleReferenceKey: string;
  worldRuleKeys: string[];
  requestEnding: boolean;
  explicitEarlyEndingConditionKey?: string;
}

export interface StoryBranchPacingProjection {
  currentPartNumber: number;
  totalPartCount: number;
  progressBps: number;
  timelineSummaryKey: string;
  storyTimeKey: string;
  authorStyleReferenceKey: string;
  worldRuleKeys: string[];
  endingDecision:
    | 'continue'
    | 'author_ending_window'
    | 'explicit_early_ending_window';
  endingAllowed: boolean;
}

const AUTHOR_ENDING_MIN_PROGRESS_BPS = 7_000;
const EXPLICIT_EARLY_ENDING_MIN_PROGRESS_BPS = 3_000;

export function buildStoryBranchPacingProjection(
  input: StoryBranchPacingInput,
): StoryBranchPacingProjection {
  const safeTotal = Math.max(1, input.totalPartCount);
  const safeCurrent = Math.min(Math.max(1, input.currentPartNumber), safeTotal);
  const progressBps = Math.floor((safeCurrent / safeTotal) * 10_000);
  const authorEndingWindow = progressBps >= AUTHOR_ENDING_MIN_PROGRESS_BPS;
  const explicitEarlyEndingWindow =
    Boolean(input.explicitEarlyEndingConditionKey) &&
    progressBps >= EXPLICIT_EARLY_ENDING_MIN_PROGRESS_BPS;
  const endingAllowed =
    input.requestEnding &&
    (authorEndingWindow || explicitEarlyEndingWindow);

  return {
    currentPartNumber: safeCurrent,
    totalPartCount: safeTotal,
    progressBps,
    timelineSummaryKey: input.timelineSummaryKey,
    storyTimeKey: input.storyTimeKey,
    authorStyleReferenceKey: input.authorStyleReferenceKey,
    worldRuleKeys: [...input.worldRuleKeys],
    endingDecision: !endingAllowed
      ? 'continue'
      : authorEndingWindow
        ? 'author_ending_window'
        : 'explicit_early_ending_window',
    endingAllowed,
  };
}

export const STORY_BRANCH_TIMELINE_PACING_BACKEND_CONTRACT = {
  version: '2026-07-11.story-branch-timeline-pacing.v1',
  status: 'request_projection_contract_only',
  requestFields: [
    'currentPartNumber',
    'totalPartCount',
    'progressBps',
    'timelineSummaryKey',
    'storyTimeKey',
    'authorStyleReferenceKey',
    'worldRuleKeys',
    'explicitEarlyEndingConditionKey',
  ],
  pacingPolicy: {
    authorEndingMinProgressBps: AUTHOR_ENDING_MIN_PROGRESS_BPS,
    explicitEarlyEndingMinProgressBps:
      EXPLICIT_EARLY_ENDING_MIN_PROGRESS_BPS,
    ungroundedEarlyEndingAllowed: false,
    explicitEarlyEndingConditionRequired: true,
  },
  referencePolicy: {
    styleAsReferenceMetadataOnly: true,
    partLengthAsReferenceMetadataOnly: true,
    worldRulesAsReferenceMetadataOnly: true,
    fullManuscriptInRequest: false,
    fullManuscriptInLogs: false,
  },
  mutationPolicy: {
    providerCall: false,
    storyWrite: false,
    storyProgressMutation: false,
    endingCreate: false,
    paymentMutation: false,
  },
} as const;

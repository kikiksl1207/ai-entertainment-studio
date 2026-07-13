import { createHash } from 'crypto';

export const STORY_PUBLICATION_STATES = [
  'draft',
  'intake_received',
  'reviewing',
  'revision_requested',
  'release_ready',
  'published',
  'sale_suspended',
  'archived',
] as const;

export const STORY_REVIEW_STATES = [
  'editing',
  'analysis_ready',
  'summary_review',
  'proposal_review',
  'continuity_review',
  'final_confirmation',
  'submission_pending',
  'submitted',
  'submission_failed',
] as const;

const PUBLICATION_TRANSITIONS: Record<string, string[]> = {
  draft: ['intake_received'],
  intake_received: ['reviewing'],
  reviewing: ['revision_requested', 'release_ready'],
  revision_requested: ['reviewing'],
  release_ready: ['published'],
  published: ['sale_suspended', 'archived'],
  sale_suspended: ['published', 'archived'],
  archived: [],
};

const REVIEW_TRANSITIONS: Record<string, string[]> = {
  editing: ['analysis_ready'],
  analysis_ready: ['summary_review', 'editing'],
  summary_review: ['proposal_review', 'editing'],
  proposal_review: ['continuity_review', 'editing'],
  continuity_review: ['final_confirmation', 'editing'],
  final_confirmation: ['submission_pending', 'editing'],
  submission_pending: ['submitted', 'submission_failed'],
  submission_failed: ['submission_pending', 'editing'],
  submitted: [],
};

const QUALITY_FORBIDDEN_FIELDS = new Set([
  'userId',
  'email',
  'privateInput',
  'manuscriptText',
  'providerPayload',
  'prompt',
  'sourceText',
]);

export function canTransitionPublication(from: string, to: string) {
  return PUBLICATION_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionReview(from: string, to: string) {
  return REVIEW_TRANSITIONS[from]?.includes(to) ?? false;
}

export function releaseChecksum(input: unknown) {
  return createHash('sha256').update(stableJson(input)).digest('hex');
}

export function storyPathSignature(path: unknown) {
  return createHash('sha256').update(stableJson(path)).digest('hex');
}

export function sessionKeyHash(progressId: string) {
  return createHash('sha256').update(`story-session:${progressId}`).digest('hex');
}

export function qualityDimensionViolations(input: unknown, path = ''): string[] {
  if (Array.isArray(input)) {
    return input.flatMap((value, index) =>
      qualityDimensionViolations(value, `${path}[${index}]`),
    );
  }
  if (!isRecord(input)) return [];
  return Object.entries(input).flatMap(([key, value]) => {
    const current = path ? `${path}.${key}` : key;
    return [
      ...(QUALITY_FORBIDDEN_FIELDS.has(key) ? [current] : []),
      ...qualityDimensionViolations(value, current),
    ];
  });
}

export function publicReleaseEligible(input: {
  workStatus: string;
  releaseStatus?: string | null;
  activeReleaseId?: string | null;
}) {
  return (
    input.workStatus === 'published' &&
    input.releaseStatus === 'active' &&
    Boolean(input.activeReleaseId)
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

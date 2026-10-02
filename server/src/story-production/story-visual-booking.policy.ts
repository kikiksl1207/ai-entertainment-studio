import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { stableContinuationJson } from './story-continuation-context.policy';

export type StoryVisualBookingBinding = {
  workId: string; releaseId: string; releaseChecksum: string; sourceSceneKey: string; promptSha256: string;
};

export type StoryVisualBookingBasis = StoryVisualBookingBinding & {
  variantKey: string;
  sourceKind: string | null;
  sourceBindingSha256: string | null;
  visualBibleVersion: string;
  visualBibleFingerprint: string;
  authorApprovalIdentitySha256: string | null;
  sceneGuidanceApprovalSha256: string | null;
  coverSourceFingerprint: string | null;
  workVisualReferenceChecksum: string | null;
  effectivePromptSha256: string;
  provider: string; model: string; quality: string; size: string; requestContractVersion: string;
};

export type StoryVisualBookingIdentity = StoryVisualBookingBasis & {
  contract: 'story-visual-booking-v1'; identitySha256: string;
};

const keys: Array<keyof StoryVisualBookingBasis> = [
  'workId', 'releaseId', 'releaseChecksum', 'sourceSceneKey', 'promptSha256', 'variantKey',
  'sourceKind', 'sourceBindingSha256', 'visualBibleVersion', 'visualBibleFingerprint',
  'authorApprovalIdentitySha256', 'sceneGuidanceApprovalSha256', 'coverSourceFingerprint',
  'workVisualReferenceChecksum', 'effectivePromptSha256', 'provider', 'model', 'quality', 'size', 'requestContractVersion',
];
const nullable = new Set<keyof StoryVisualBookingBasis>(['sourceKind', 'sourceBindingSha256',
  'authorApprovalIdentitySha256', 'sceneGuidanceApprovalSha256', 'coverSourceFingerprint', 'workVisualReferenceChecksum']);
const hashes = new Set<keyof StoryVisualBookingBasis>(['releaseChecksum', 'promptSha256', 'sourceBindingSha256',
  'authorApprovalIdentitySha256', 'sceneGuidanceApprovalSha256', 'coverSourceFingerprint',
  'workVisualReferenceChecksum', 'effectivePromptSha256']);

export function storyVisualBookingIdentity(basis: StoryVisualBookingBasis): StoryVisualBookingIdentity {
  const data = Object.fromEntries(keys.map(key => [key, basis[key]])) as StoryVisualBookingBasis;
  const value = { contract: 'story-visual-booking-v1' as const, ...data };
  return { ...value, identitySha256: createHash('sha256').update(stableContinuationJson(value)).digest('hex') };
}

export function parsedStoryVisualBooking(value: Prisma.JsonValue | unknown): StoryVisualBookingIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length + 2 ||
      Object.keys(row).some(key => ![...keys, 'contract', 'identitySha256'].includes(key)) ||
      row.contract !== 'story-visual-booking-v1' || typeof row.identitySha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(row.identitySha256) || Buffer.byteLength(JSON.stringify(row)) > 8192) return null;
  for (const key of keys) {
    const field = row[key];
    if (nullable.has(key) && field === null) continue;
    if (typeof field !== 'string' || !field || field.length > 160 || field.includes('\0') ||
        (hashes.has(key) && !/^[a-f0-9]{64}$/.test(field))) return null;
  }
  if (row.variantKey !== 'default') return null;
  if (!/^(?:[a-f0-9]{20}|[a-f0-9]{64})$/.test(String(row.visualBibleFingerprint))) return null;
  const { identitySha256, ...basis } = row;
  return identitySha256 === createHash('sha256').update(stableContinuationJson(basis)).digest('hex')
    ? row as StoryVisualBookingIdentity : null;
}

export function storyVisualBookingMatches(value: unknown, binding: StoryVisualBookingBinding) {
  const identity = parsedStoryVisualBooking(value);
  return identity && (['workId', 'releaseId', 'releaseChecksum', 'sourceSceneKey', 'promptSha256'] as const)
    .every(key => identity[key] === binding[key])
    ? identity : null;
}

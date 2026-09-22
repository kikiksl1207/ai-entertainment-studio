import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';

export const CREATOR_GENERATION_PROFILE_SCHEMA = 'creator-generation-profile-v1';

export const STORY_PROFILE_SECTION_KEYS = [
  'writing_style',
  'scene_scale',
  'canon',
  'timeline',
  'narrative_devices',
  'branch_behavior',
  'visual_direction',
  'visual_cast',
] as const;

export const ARTIST_PROFILE_SECTION_KEYS = [
  'fixed_identity',
  'adaptable_presentation',
] as const;

const DECISIONS = new Set(['proposed', 'accepted', 'edited', 'removed', 'unknown']);
const CONFIRMED_DECISIONS = new Set(['accepted', 'edited']);
const STORY_BLOCKING_KEYS = new Set([
  'writing_style',
  'scene_scale',
  'canon',
  'timeline',
  'branch_behavior',
  'visual_direction',
]);
const ARTIST_BLOCKING_KEYS = new Set(ARTIST_PROFILE_SECTION_KEYS);
const MAX_PROFILE_BYTES = 128 * 1024;
const MAX_VALUE_DEPTH = 8;
const MAX_ARRAY_ITEMS = 200;
const MAX_OBJECT_KEYS = 100;
const MAX_STRING_LENGTH = 8_000;

export type CreatorGenerationProfileKind = 'story' | 'artist';

export type CreatorGenerationProfileEvidence = {
  sourceType: 'manuscript' | 'metadata' | 'visual' | 'profile';
  sourceRef: string;
  summary: string;
};

export type CreatorGenerationProfileSection = {
  key: string;
  decision: 'proposed' | 'accepted' | 'edited' | 'removed' | 'unknown';
  value: Record<string, unknown>;
  evidence: CreatorGenerationProfileEvidence[];
};

export type CreatorGenerationProfileSettings = {
  schemaVersion: typeof CREATOR_GENERATION_PROFILE_SCHEMA;
  kind: CreatorGenerationProfileKind;
  sections: CreatorGenerationProfileSection[];
};

export function normalizeCreatorGenerationProfile(
  kind: CreatorGenerationProfileKind,
  input: unknown,
): CreatorGenerationProfileSettings {
  const root = plainRecord(input, 'GENERATION_PROFILE_INVALID');
  if (root.schemaVersion !== CREATOR_GENERATION_PROFILE_SCHEMA || root.kind !== kind) {
    invalid('GENERATION_PROFILE_SCHEMA_MISMATCH');
  }
  if (!Array.isArray(root.sections) || root.sections.length < 1 || root.sections.length > 16) {
    invalid('GENERATION_PROFILE_SECTIONS_INVALID');
  }
  const allowed = new Set(kind === 'story' ? STORY_PROFILE_SECTION_KEYS : ARTIST_PROFILE_SECTION_KEYS);
  const seen = new Set<string>();
  const sections = root.sections.map((raw) => {
    const section = plainRecord(raw, 'GENERATION_PROFILE_SECTION_INVALID');
    const key = boundedString(section.key, 80, 'GENERATION_PROFILE_SECTION_INVALID');
    if (!allowed.has(key as never) || seen.has(key)) invalid('GENERATION_PROFILE_SECTION_INVALID');
    seen.add(key);
    const decision = boundedString(section.decision, 24, 'GENERATION_PROFILE_DECISION_INVALID');
    if (!DECISIONS.has(decision)) invalid('GENERATION_PROFILE_DECISION_INVALID');
    const value = sanitizeJsonObject(section.value, 0);
    const evidence = section.evidence === undefined
      ? []
      : evidenceItems(section.evidence);
    return { key, decision, value, evidence } as CreatorGenerationProfileSection;
  });
  const normalized: CreatorGenerationProfileSettings = {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
    kind,
    sections: sections.sort((left, right) => left.key.localeCompare(right.key)),
  };
  if (Buffer.byteLength(stableJson(normalized), 'utf8') > MAX_PROFILE_BYTES) {
    invalid('GENERATION_PROFILE_TOO_LARGE');
  }
  return normalized;
}

export function assertCreatorGenerationProfileApprovable(
  settings: CreatorGenerationProfileSettings,
) {
  const required = settings.kind === 'story'
    ? STORY_PROFILE_SECTION_KEYS
    : ARTIST_PROFILE_SECTION_KEYS;
  const blocking = settings.kind === 'story' ? STORY_BLOCKING_KEYS : ARTIST_BLOCKING_KEYS;
  const sections = new Map(settings.sections.map((section) => [section.key, section]));
  const missing = required.filter((key) => !sections.has(key));
  const proposed = settings.sections.filter((section) => section.decision === 'proposed').map((section) => section.key);
  const unresolvedBlocking = settings.sections
    .filter((section) => blocking.has(section.key) && !CONFIRMED_DECISIONS.has(section.decision))
    .map((section) => section.key);
  if (missing.length || proposed.length || unresolvedBlocking.length) {
    throw new ConflictException({
      code: 'GENERATION_PROFILE_REVIEW_INCOMPLETE',
      message: 'Generation profile review is incomplete',
      details: { missing, proposed, unresolvedBlocking },
    });
  }
}

export function creatorGenerationProfileFingerprint(
  sourceFingerprint: string,
  settings: CreatorGenerationProfileSettings,
) {
  return createHash('sha256')
    .update(stableJson({ sourceFingerprint, settings }))
    .digest('hex');
}

export function creatorGenerationProfileProjection(profile: {
  id: string;
  sourceFingerprint: string;
  referenceAssetIds?: unknown;
  profileVersion: number;
  reviewRevision: number;
  status: string;
  draftSettings: unknown;
  draftFingerprint: string | null;
  approvedSettings: unknown;
  approvedFingerprint: string | null;
  approvedAt: Date | null;
  analysisErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: profile.id,
    sourceFingerprint: profile.sourceFingerprint,
    ...(profile.referenceAssetIds === undefined
      ? {}
      : { referenceAssetIds: stringArray(profile.referenceAssetIds) }),
    profileVersion: profile.profileVersion,
    reviewRevision: profile.reviewRevision,
    status: profile.status,
    draftSettings: profile.draftSettings,
    draftFingerprint: profile.draftFingerprint,
    approvedSettings: profile.approvedSettings,
    approvedFingerprint: profile.approvedFingerprint,
    approvedAt: profile.approvedAt,
    analysisErrorCode: profile.analysisErrorCode,
    reviewRequired: profile.status !== 'approved',
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function evidenceItems(value: unknown): CreatorGenerationProfileEvidence[] {
  if (!Array.isArray(value) || value.length > 20) invalid('GENERATION_PROFILE_EVIDENCE_INVALID');
  return value.map((raw) => {
    const item = plainRecord(raw, 'GENERATION_PROFILE_EVIDENCE_INVALID');
    const sourceType = boundedString(item.sourceType, 24, 'GENERATION_PROFILE_EVIDENCE_INVALID');
    if (!['manuscript', 'metadata', 'visual', 'profile'].includes(sourceType)) {
      invalid('GENERATION_PROFILE_EVIDENCE_INVALID');
    }
    return {
      sourceType: sourceType as CreatorGenerationProfileEvidence['sourceType'],
      sourceRef: boundedString(item.sourceRef, 300, 'GENERATION_PROFILE_EVIDENCE_INVALID'),
      summary: boundedString(item.summary, 1_000, 'GENERATION_PROFILE_EVIDENCE_INVALID'),
    };
  });
}

function sanitizeJsonObject(value: unknown, depth: number): Record<string, unknown> {
  return sanitizeJson(value, depth, true) as Record<string, unknown>;
}

function sanitizeJson(value: unknown, depth: number, requireObject = false): unknown {
  if (depth > MAX_VALUE_DEPTH) invalid('GENERATION_PROFILE_VALUE_INVALID');
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (requireObject || (typeof value === 'number' && !Number.isFinite(value))) {
      invalid('GENERATION_PROFILE_VALUE_INVALID');
    }
    return value;
  }
  if (typeof value === 'string') {
    if (requireObject || value.length > MAX_STRING_LENGTH) invalid('GENERATION_PROFILE_VALUE_INVALID');
    return value;
  }
  if (Array.isArray(value)) {
    if (requireObject || value.length > MAX_ARRAY_ITEMS) invalid('GENERATION_PROFILE_VALUE_INVALID');
    return value.map((item) => sanitizeJson(item, depth + 1));
  }
  const source = plainRecord(value, 'GENERATION_PROFILE_VALUE_INVALID');
  const entries = Object.entries(source);
  if (entries.length > MAX_OBJECT_KEYS) invalid('GENERATION_PROFILE_VALUE_INVALID');
  return Object.fromEntries(entries.map(([key, item]) => {
    if (!key || key.length > 120 || ['__proto__', 'constructor', 'prototype'].includes(key)) {
      invalid('GENERATION_PROFILE_VALUE_INVALID');
    }
    return [key, sanitizeJson(item, depth + 1)];
  }));
}

function plainRecord(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    invalid(code);
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, max: number, code: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) invalid(code);
  return value.trim();
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function invalid(code: string): never {
  throw new BadRequestException({ code, message: 'Invalid creator generation profile' });
}

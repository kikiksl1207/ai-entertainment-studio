import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import {
  CREATOR_GENERATION_PROFILE_SCHEMA,
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
} from '../generation-profile/creator-generation-profile.policy';
import type { StoryParticipantPin } from './story-artist-participant.service';

export type StoryContinuationMemoryPin = {
  id: string;
  revision: number;
  contentHash: string;
};

export type StoryContinuationGenerationProfilePin = {
  id: string;
  profileVersion: number;
  reviewRevision: number;
  sourceFingerprint: string;
  approvedFingerprint: string;
};

export type StoryContinuationApprovedGenerationProfile = {
  schemaVersion: typeof CREATOR_GENERATION_PROFILE_SCHEMA;
  sections: Array<{
    key: string;
    value: Record<string, unknown>;
  }>;
};

type ApprovedStoryGenerationProfileRow = {
  id: string;
  status: string;
  profileVersion: number;
  reviewRevision: number;
  sourceFingerprint: string;
  approvedFingerprint: string | null;
  approvedSettings: Prisma.JsonValue | null;
};

export type StoryContinuationSemanticPathStep = {
  sourceTitle: string;
  choiceLabel: string;
  targetTitle: string | null;
  explicitRejoin: boolean;
  endingType: string | null;
};

const MAX_SEMANTIC_PATH_STEPS = 12;
export const STORY_CONTINUATION_PROFILE_VIEW_VERSION = 'story-profile-prompt-v2';
const MAX_PROFILE_VIEW_BYTES = 16_384;
const PROFILE_VIEW_LIMITS = [
  { summary: 240, detail: 160, title: 80, categoryExample: 120 },
  { summary: 200, detail: 120, title: 60, categoryExample: 80 },
  { summary: 160, detail: 100, title: 40, categoryExample: 60 },
] as const;

type SemanticSceneRow = { id: string; title: Prisma.JsonValue; endingType: string | null };
type CanonicalChoiceRow = {
  id: string;
  sceneId: string;
  label: Prisma.JsonValue;
  targetEndingKey: string | null;
  declaredRejoinSceneId: string | null;
};
type GeneratedChoiceRow = { id: string; sceneId: string; label: Prisma.JsonValue };

export function continuationMemoryPins(
  memories: Array<{ id: string; revision: number; content: Prisma.JsonValue }>,
): StoryContinuationMemoryPin[] {
  return memories.map((memory) => ({
    id: memory.id,
    revision: memory.revision,
    contentHash: continuationHash(memory.content),
  }));
}

export function continuationSourceHash(input: {
  kind: 'canonical' | 'generated';
  locale: string;
  title: Prisma.JsonValue;
  beats: Array<{ position: number; beatType: string; content: Prisma.JsonValue }>;
  choiceLabel: Prisma.JsonValue;
}) {
  return continuationHash({
    kind: input.kind,
    title: localizedContinuationText(input.title, input.locale),
    beats: input.beats.map((beat) => ({
      position: beat.position,
      beatType: beat.beatType,
      content: localizedContinuationText(beat.content, input.locale),
    })),
    choiceLabel: localizedContinuationText(input.choiceLabel, input.locale),
  });
}

export function continuationPathHash(path: StoryContinuationSemanticPathStep[]) {
  return continuationHash(path);
}

export async function assembleContinuationSemanticPath(
  prisma: any,
  input: {
    pathSummary: Prisma.JsonValue;
    locale: string;
    userId: string;
    workId: string;
    releaseId: string;
    progressId: string;
  },
): Promise<StoryContinuationSemanticPathStep[]> {
  const entries = (Array.isArray(input.pathSummary) ? input.pathSummary : [])
    .flatMap((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
      ? [entry as Record<string, unknown>]
      : [])
    .slice(-MAX_SEMANTIC_PATH_STEPS);
  const canonicalSceneIds = new Set<string>();
  const generatedSceneIds = new Set<string>();
  const canonicalChoiceIds = new Set<string>();
  const generatedChoiceIds = new Set<string>();
  for (const entry of entries) {
    addString(canonicalSceneIds, entry.sceneId ?? entry.sourceSceneId);
    addString(canonicalSceneIds, entry.nextSceneId);
    addString(generatedSceneIds, entry.sourceGeneratedSceneId);
    addString(generatedSceneIds, entry.generatedSceneId);
    if (typeof entry.choiceId === 'string') {
      (entry.sourceGeneratedSceneId ? generatedChoiceIds : canonicalChoiceIds).add(entry.choiceId);
    }
  }
  const [canonicalScenes, generatedScenes, canonicalChoices, generatedChoices] = await Promise.all([
    canonicalSceneIds.size
      ? prisma.storyScene.findMany({
          where: { id: { in: [...canonicalSceneIds] }, status: 'published', fixtureSource: false },
          select: { id: true, title: true, endingType: true },
        })
      : [],
    generatedSceneIds.size
      ? prisma.storyAiGeneratedScene.findMany({
          where: {
            id: { in: [...generatedSceneIds] }, userId: input.userId, workId: input.workId,
            releaseId: input.releaseId, progressId: input.progressId, status: 'ready',
          },
          select: { id: true, title: true, endingType: true },
        })
      : [],
    canonicalChoiceIds.size
      ? prisma.storyChoice.findMany({
          where: { id: { in: [...canonicalChoiceIds] } },
          select: { id: true, sceneId: true, label: true, targetEndingKey: true, declaredRejoinSceneId: true },
        })
      : [],
    generatedChoiceIds.size
      ? prisma.storyAiGeneratedChoice.findMany({
          where: { id: { in: [...generatedChoiceIds] } },
          select: { id: true, sceneId: true, label: true },
        })
      : [],
  ]);
  const canonicalSceneById = new Map<string, SemanticSceneRow>(
    (canonicalScenes as SemanticSceneRow[]).map((item) => [item.id, item]),
  );
  const generatedSceneById = new Map<string, SemanticSceneRow>(
    (generatedScenes as SemanticSceneRow[]).map((item) => [item.id, item]),
  );
  const canonicalChoiceById = new Map<string, CanonicalChoiceRow>(
    (canonicalChoices as CanonicalChoiceRow[]).map((item) => [item.id, item]),
  );
  const generatedChoiceById = new Map<string, GeneratedChoiceRow>(
    (generatedChoices as GeneratedChoiceRow[]).map((item) => [item.id, item]),
  );
  return entries.map((entry) => {
    const generatedSource = typeof entry.sourceGeneratedSceneId === 'string';
    const sourceId = generatedSource
      ? entry.sourceGeneratedSceneId as string
      : String(entry.sceneId ?? entry.sourceSceneId ?? '');
    const targetId = typeof entry.generatedSceneId === 'string'
      ? entry.generatedSceneId
      : typeof entry.nextSceneId === 'string'
        ? entry.nextSceneId
        : null;
    const source = generatedSource
      ? generatedSceneById.get(sourceId)
      : canonicalSceneById.get(sourceId);
    const target = typeof entry.generatedSceneId === 'string'
      ? generatedSceneById.get(targetId!)
      : targetId
        ? canonicalSceneById.get(targetId)
        : null;
    const canonicalChoice = generatedSource
      ? null
      : canonicalChoiceById.get(String(entry.choiceId ?? ''));
    const generatedChoice = generatedSource
      ? generatedChoiceById.get(String(entry.choiceId ?? ''))
      : null;
    const choice = canonicalChoice ?? generatedChoice;
    if (!source || !choice || choice.sceneId !== sourceId || (targetId && !target)) {
      throw new Error('semantic_path_changed');
    }
    return {
      sourceTitle: localizedContinuationText(source.title, input.locale),
      choiceLabel: localizedContinuationText(choice.label, input.locale),
      targetTitle: target ? localizedContinuationText(target.title, input.locale) : null,
      explicitRejoin: generatedSource
        ? false
        : Boolean(canonicalChoice?.declaredRejoinSceneId ?? entry.explicitRejoin),
      endingType: String(target?.endingType ?? canonicalChoice?.targetEndingKey ?? '') || null,
    };
  });
}

export function continuationExecutionFingerprint(input: {
  contextFingerprint: string;
  sourceHash: string;
  pathHash: string;
  memoryPins: StoryContinuationMemoryPin[];
  generationProfilePin?: StoryContinuationGenerationProfilePin;
  participantPin?: StoryParticipantPin;
}) {
  return continuationHash(input);
}

export function continuationGenerationProfileSnapshot(profile: ApprovedStoryGenerationProfileRow) {
  if (profile.status !== 'approved' || !profile.approvedFingerprint || !profile.approvedSettings) {
    throw new Error('generation_profile_not_approved');
  }
  const normalized = normalizeCreatorGenerationProfile('story', profile.approvedSettings);
  const approvedFingerprint = creatorGenerationProfileFingerprint(
    profile.sourceFingerprint,
    normalized,
  );
  if (approvedFingerprint !== profile.approvedFingerprint) {
    throw new Error('generation_profile_fingerprint_changed');
  }
  const pin: StoryContinuationGenerationProfilePin = {
    id: profile.id,
    profileVersion: profile.profileVersion,
    reviewRevision: profile.reviewRevision,
    sourceFingerprint: profile.sourceFingerprint,
    approvedFingerprint,
  };
  const sections = normalized.sections.filter((section) =>
    section.decision === 'accepted' || section.decision === 'edited');
  for (const limits of PROFILE_VIEW_LIMITS) {
    const approved: StoryContinuationApprovedGenerationProfile = {
      schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
      sections: sections.map((section) => ({
        key: section.key, value: continuationProfileValue(section.key, section.value, limits),
      })),
    };
    if (Buffer.byteLength(JSON.stringify(approved), 'utf8') <= MAX_PROFILE_VIEW_BYTES) {
      return { pin, approved };
    }
  }
  throw new Error('generation_profile_context_too_large');
}

function continuationProfileValue(
  key: string,
  value: Record<string, unknown>,
  limits: typeof PROFILE_VIEW_LIMITS[number],
) {
  const projected: Record<string, unknown> = {};
  for (const [field, item] of Object.entries(value)) {
    if (field === 'observations' || field === 'categories') continue;
    projected[field] = field === 'summary' ? profileText(item, limits.summary) : item;
  }
  if (Array.isArray(value.observations)) {
    const limit = key === 'writing_style' ? 4
      : ['canon', 'timeline', 'narrative_devices'].includes(key) ? 2 : 1;
    const observations = spreadProfileItems(value.observations, limit)
      .flatMap((raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
        const row = raw as Record<string, unknown>;
        const detail = profileText(row.detail, limits.detail);
        return detail ? [{ title: profileText(row.title, limits.title), detail }] : [];
      });
    if (observations.length) projected.observations = observations;
  }
  if (key === 'writing_style' && Array.isArray(value.categories)) {
    const categories = value.categories.slice(0, 6).flatMap((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
      const row = raw as Record<string, unknown>;
      const category = profileText(row.category, 40);
      const example = Array.isArray(row.observations)
        ? row.observations.map((item) => profileText(item, limits.categoryExample)).find(Boolean) : null;
      return category && example ? [{ category, example }] : [];
    });
    if (categories.length) projected.categories = categories;
  }
  return projected;
}

function spreadProfileItems(items: unknown[], limit: number) {
  if (items.length <= limit) return items;
  if (limit === 1) return [items[Math.floor(items.length / 2)]];
  return Array.from({ length: limit }, (_, index) =>
    items[Math.round(index * (items.length - 1) / (limit - 1))]);
}

function profileText(value: unknown, maxCharacters: number) {
  return typeof value === 'string' ? Array.from(value.trim()).slice(0, maxCharacters).join('').trim() : '';
}

export function parseContinuationGenerationProfilePin(
  value: Prisma.JsonValue | undefined,
): StoryContinuationGenerationProfilePin | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('generation_profile_pin_invalid');
  }
  const pin = value as Record<string, Prisma.JsonValue>;
  if (
    typeof pin.id !== 'string' || !pin.id ||
    !Number.isInteger(pin.profileVersion) || Number(pin.profileVersion) < 1 ||
    !Number.isInteger(pin.reviewRevision) || Number(pin.reviewRevision) < 1 ||
    typeof pin.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(pin.sourceFingerprint) ||
    typeof pin.approvedFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(pin.approvedFingerprint)
  ) {
    throw new Error('generation_profile_pin_invalid');
  }
  return {
    id: pin.id,
    profileVersion: Number(pin.profileVersion),
    reviewRevision: Number(pin.reviewRevision),
    sourceFingerprint: pin.sourceFingerprint,
    approvedFingerprint: pin.approvedFingerprint,
  };
}

export function localizedContinuationText(
  value: Prisma.JsonValue,
  locale: string,
): string {
  if (typeof value === 'string') return value;
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('localized_context_missing');
  }
  const localized = (value as Record<string, Prisma.JsonValue>)[locale];
  if (typeof localized !== 'string') throw new Error('localized_context_missing');
  return localized;
}

export function approvedContinuationMemoryText(
  value: Prisma.JsonValue,
  locale: string,
): string {
  if (typeof value === 'string') return value;
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('approved_memory_context_invalid');
  }
  const record = value as Record<string, Prisma.JsonValue>;
  const localeKeys = Object.keys(record).filter((key) => /^[a-z]{2}(?:-[A-Z]{2})?$/.test(key));
  if (localeKeys.length > 0) return localizedContinuationText(value, locale);
  return stableContinuationJson(value);
}

export function continuationHash(value: unknown) {
  return createHash('sha256').update(stableContinuationJson(value)).digest('hex');
}

export function stableContinuationJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableContinuationJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableContinuationJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function addString(target: Set<string>, value: unknown) {
  if (typeof value === 'string' && value) target.add(value);
}

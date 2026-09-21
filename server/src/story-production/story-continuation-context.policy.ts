import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';

export type StoryContinuationMemoryPin = {
  id: string;
  revision: number;
  contentHash: string;
};

export type StoryContinuationSemanticPathStep = {
  sourceTitle: string;
  choiceLabel: string;
  targetTitle: string | null;
  explicitRejoin: boolean;
  endingType: string | null;
};

const MAX_SEMANTIC_PATH_STEPS = 12;

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
}) {
  return continuationHash(input);
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

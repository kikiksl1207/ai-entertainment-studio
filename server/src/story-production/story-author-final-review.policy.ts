import { ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { AuthoredMaterializedSnapshot } from './story-authored-materialized.snapshot';
import { proposeStoryContinuationLength, type StoryContinuationLengthBounds } from './story-continuation-length.policy';

export const AUTHOR_FINAL_REVIEW_VERSION = 'author-final-review-v1';
export const AUTHOR_WHOLE_PART_MAPPING = 'receipt-whole-materialized-part-v1';

export type AuthorWholePartReference = {
  sourcePartId: string;
  sourceSceneId: string;
  sourceSceneKeys: string[];
  narrativeHash: string;
  length: StoryContinuationLengthBounds | null;
};

export type AuthorReviewSnapshot = {
  version: typeof AUTHOR_FINAL_REVIEW_VERSION;
  reviewId: string;
  reviewRevision: number;
  ownerUserId: string;
  workId: string;
  manuscriptVersionId: string;
  manuscriptContentHash: string;
  releaseId: string;
  releaseChecksum: string;
  receiptId: string;
  sourceMapSha256: string;
  planChecksum: string;
  draftMaterializedChecksum: string;
  contentChecksum: string;
  mappingVersion: typeof AUTHOR_WHOLE_PART_MAPPING;
  sourceLocale: string;
  endingResolution: unknown;
  reviewedScopes: string[];
  anchorPolicy: { version: 'author-branch-resolution-v1'; minGeneratedSegments: number } | null;
  parts: AuthorWholePartReference[];
};

export function authorReviewConflict(code: string): never {
  throw new ConflictException({ code, message: 'Author review binding is unavailable or changed' });
}

export function verifiedWholePartReferences(
  snapshot: AuthoredMaterializedSnapshot,
  provenance: unknown,
  locale: string,
  includeAnchor: boolean,
): AuthorWholePartReference[] {
  const source = object(provenance);
  if (source.contract !== 'story-authored-source-spans-v1' || !Array.isArray(source.parts) ||
      source.parts.length !== snapshot.parts.length || snapshot.parts.length < 1 || snapshot.parts.length > 1000 ||
      snapshot.scenes.length !== snapshot.parts.length || snapshot.beats.length > 40_000 || snapshot.choices.length > 3000) {
    authorReviewConflict('AUTHOR_SOURCE_MAPPING_UNSUPPORTED');
  }
  const scenes = new Map(snapshot.scenes.map(scene => [scene.id, scene]));
  const beatsByKey = new Map<string, typeof snapshot.beats>();
  for (const beat of snapshot.beats) {
    if (!beat.sourceSceneKey) authorReviewConflict('AUTHOR_SOURCE_MAPPING_UNSUPPORTED');
    const items = beatsByKey.get(beat.sourceSceneKey) ?? [];
    items.push(beat);
    beatsByKey.set(beat.sourceSceneKey, items);
  }
  const usedKeys = new Set<string>();
  const usedParts = new Set<string>();
  const refs: AuthorWholePartReference[] = [];
  for (const raw of source.parts) {
    const group = object(raw);
    if (!Array.isArray(group.scenes) || !group.scenes.length || group.scenes.length > 40) {
      authorReviewConflict('AUTHOR_SOURCE_MAPPING_UNSUPPORTED');
    }
    const groupedBeats: typeof snapshot.beats = [];
    const keys: string[] = [];
    for (const rawScene of group.scenes) {
      const sourceScene = object(rawScene);
      const key = sourceScene.sourceSceneKey;
      if (typeof key !== 'string' || usedKeys.has(key)) authorReviewConflict('AUTHOR_SOURCE_MAPPING_UNSUPPORTED');
      const beats = (beatsByKey.get(key) ?? []).slice().sort((a, b) => a.position - b.position);
      if (!beats.length || beats.length !== sourceScene.beatCount || beats[0].position !== sourceScene.firstBeatPosition ||
          beats.some((beat, i) => beat.sceneId !== beats[0].sceneId || beat.position !== beats[0].position + i)) {
        authorReviewConflict('AUTHOR_SOURCE_MAPPING_CHANGED');
      }
      const text = beats.map(beat => exactNarrative(beat.content, locale)).join('');
      if (Buffer.byteLength(text) !== sourceScene.textBytes || textHash(text) !== sourceScene.textSha256) {
        authorReviewConflict('AUTHOR_SOURCE_NARRATIVE_CHANGED');
      }
      usedKeys.add(key);
      keys.push(key);
      groupedBeats.push(...beats);
    }
    const scene = scenes.get(groupedBeats[0].sceneId);
    if (!scene || usedParts.has(scene.partId) || groupedBeats.some((beat, i) =>
      beat.sceneId !== scene.id || beat.position !== i + 1 || beat.beatType !== 'narration') ||
      snapshot.beats.filter(beat => beat.sceneId === scene.id).length !== groupedBeats.length ||
      !snapshot.parts.some(part => part.id === scene.partId)) authorReviewConflict('AUTHOR_WHOLE_PART_MAPPING_REQUIRED');
    usedParts.add(scene.partId);
    const projected = groupedBeats.map(beat => ({ beatType: beat.beatType, content: { [locale]: exactNarrative(beat.content, locale) } }));
    refs.push({ sourcePartId: scene.partId, sourceSceneId: scene.id, sourceSceneKeys: keys,
      narrativeHash: textHash(JSON.stringify(groupedBeats.map(beat => ({
        id: beat.id, position: beat.position, sourceSceneKey: beat.sourceSceneKey, content: beat.content,
      })))),
      length: includeAnchor ? proposeStoryContinuationLength({ locale, beats: projected }).bounds : null });
  }
  if (usedKeys.size !== beatsByKey.size || usedParts.size !== snapshot.parts.length) {
    authorReviewConflict('AUTHOR_SOURCE_COVERAGE_INCOMPLETE');
  }
  return refs.sort((a, b) => a.sourcePartId.localeCompare(b.sourcePartId));
}

function exactNarrative(value: unknown, locale: string): string {
  const content = object(value);
  if (Object.keys(content).length !== 1 || typeof content[locale] !== 'string') {
    authorReviewConflict('AUTHOR_SOURCE_LOCALE_MISMATCH');
  }
  return content[locale] as string;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) authorReviewConflict('AUTHOR_SOURCE_MAPPING_UNSUPPORTED');
  return value as Record<string, unknown>;
}

function textHash(value: string) { return createHash('sha256').update(value).digest('hex'); }

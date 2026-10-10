import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { createHash } from 'crypto';
import {
  CREATOR_GENERATION_PROFILE_SCHEMA,
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
  stableJson,
} from '../generation-profile/creator-generation-profile.policy';
import type { StoryApprovedParticipant, StoryParticipantPin } from './story-artist-participant.service';
import { authoredPartContinuationLengthBounds } from './story-continuation-author-length.store';
import type { StoryContinuationApprovedContext } from './story-continuation-context.assembler';
import {
  approvedContinuationMemoryText,
  assembleContinuationSemanticPath,
  localizedContinuationText,
  stableContinuationJson,
} from './story-continuation-context.policy';
import { sourceStoryContinuationLengthBounds, StoryContinuationLengthPolicyError } from './story-continuation-length.policy';
import { assembleContinuationRouteContinuity } from './story-continuation-route-continuity';
import { boundedPath, STORY_LOCALES } from './story-production.policy';

export type StoryContinuationDiagnosticContextInput = {
  userId: string;
  workId: string;
  releaseId: string;
  manuscriptVersionId: string;
  analysisJobId: string;
  progress: any;
  part: { id: string; position: number };
  scene: any;
  choice: any;
  sourceKind: 'canonical' | 'generated';
  locale: string;
  generationProfile: StoryContinuationApprovedContext['generationProfile'];
};

type RouteRow = {
  id: string;
  parent_id: string | null;
  depth: number;
  step_kind: string;
  target_scene_id: string | null;
  source_shared_result_id: string | null;
  route_hash: string | null;
  narrative_step: Prisma.JsonValue | null;
};

export class StoryContinuationDiagnosticContextUnavailable extends Error {
  readonly code = 'diagnostic_context_unavailable' as const;
  constructor() { super('diagnostic_context_unavailable'); }
}

function unavailable(): never { throw new StoryContinuationDiagnosticContextUnavailable(); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const referenceKeys = ['sceneId', 'sourceSceneId', 'sourceGeneratedSceneId', 'choiceId', 'customChoiceId',
  'nextSceneId', 'generatedSceneId'] as const;
function validReferences(value: Record<string, unknown>) {
  return referenceKeys.every(key => value[key] === undefined || value[key] === null ||
    (typeof value[key] === 'string' && isUUID(value[key])));
}
const contextErrorCodes = new Set([
  'semantic_path_changed', 'localized_context_missing', 'approved_memory_context_invalid',
  'route_continuity_invalid', 'author_length_scenes_invalid', 'author_length_beats_invalid',
]);
const lengthErrorCodes = new Set([
  'author_length_locale_unsupported', 'author_length_beats_invalid', 'author_length_text_invalid',
  'author_length_byte_limit', 'author_length_unicode_invalid', 'author_length_reference_empty',
  'author_length_beat_type_invalid', 'author_length_locale_mismatch',
]);
const profileErrorCodes = new Set([
  'GENERATION_PROFILE_INVALID', 'GENERATION_PROFILE_SCHEMA_MISMATCH', 'GENERATION_PROFILE_SECTIONS_INVALID',
  'GENERATION_PROFILE_SECTION_INVALID', 'GENERATION_PROFILE_DECISION_INVALID', 'GENERATION_PROFILE_VALUE_INVALID',
  'GENERATION_PROFILE_EVIDENCE_INVALID', 'GENERATION_PROFILE_TOO_LARGE',
]);

// The caller owns current owner/release/approval/source binding and the RO/RR transaction.
// Imported readers below use only this tx; no lease, authorization or execution is inferred.
export async function readStoryContinuationDiagnosticContext(
  tx: Prisma.TransactionClient,
  input: StoryContinuationDiagnosticContextInput,
): Promise<StoryContinuationApprovedContext> {
  try {
    const { progress, part, scene, choice, locale } = input;
    if (![input.userId, input.workId, input.releaseId, input.manuscriptVersionId,
      input.analysisJobId, progress?.id, part?.id, scene?.id, choice?.id].every(nonempty) ||
      !(STORY_LOCALES as readonly string[]).includes(locale) ||
      !['canonical', 'generated'].includes(input.sourceKind) ||
      progress.userId !== input.userId || progress.workId !== input.workId ||
      progress.activeReleaseId !== input.releaseId || progress.status !== 'active' ||
      !Number.isSafeInteger(progress.progressRevision) || progress.progressRevision < 0 ||
      !Number.isInteger(part.position) || part.position < 1 ||
      choice.sceneId !== scene.id || choice.routeKind !== 'generation_required' ||
      choice.targetSceneId || choice.declaredRejoinSceneId || choice.targetEndingKey ||
      !input.generationProfile || input.generationProfile.schemaVersion !== CREATOR_GENERATION_PROFILE_SCHEMA ||
      !Array.isArray(input.generationProfile.sections) || !input.generationProfile.sections.length) unavailable();
    if (input.sourceKind === 'canonical'
      ? progress.currentSceneId !== scene.id || progress.currentGeneratedSceneId != null || scene.partId !== part.id
      : progress.currentGeneratedSceneId !== scene.id || progress.currentSceneId != null || scene.sourcePartId !== part.id) {
      unavailable();
    }
    if (!Array.isArray(progress.pathSummary) || progress.pathSummary.some((step: unknown) =>
      !record(step) || !validReferences(step))) unavailable();
    const pathSummary = boundedPath(progress.pathSummary as Prisma.JsonObject[]);
    await readCurrentDiagnosticRoute(tx, input, pathSummary);
    const participantArtist = await readDiagnosticParticipant(tx, input);

    const priorParts = await tx.storyPart.findMany({
      where: { workId: input.workId, position: { lte: part.position }, status: 'published', fixtureSource: false },
      select: { id: true }, orderBy: { position: 'asc' },
    });
    if (!priorParts.some((item) => item.id === part.id)) unavailable();
    if (input.sourceKind === 'generated' && (!Number.isInteger(progress.currentBeatPosition) ||
      progress.currentBeatPosition < 1 || progress.currentBeatPosition > 40)) unavailable();
    const activeChoices = await tx.storyChoiceEvent.findMany({
      where: { progressId: progress.id, invalidatedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { sceneId: true, targetSceneId: true }, take: 1024,
    });
    const reachedSceneIds = new Set<string>();
    if (input.sourceKind === 'canonical') reachedSceneIds.add(scene.id);
    for (const step of activeChoices) {
      for (const id of [step.targetSceneId, step.sceneId]) if (nonempty(id)) reachedSceneIds.add(id);
    }
    const reachedScenes = reachedSceneIds.size ? await tx.storyScene.findMany({
      where: { id: { in: [...reachedSceneIds] }, partId: { in: priorParts.map((item) => item.id) },
        sceneKey: { endsWith: '-main' }, fixtureSource: false },
      select: { id: true, sceneKey: true },
    }) : [];
    const reachedPartKeys = new Set(reachedScenes.map((item) => item.sceneKey.slice(0, -5)).filter(Boolean));
    const partKeyBySceneId = new Map(reachedScenes.map((item) => [item.id, item.sceneKey.slice(0, -5)]));
    const reachedKeys = [...new Set([
      ...[...reachedSceneIds].map((id) => partKeyBySceneId.get(id)).filter((key): key is string => Boolean(key)),
      ...reachedPartKeys,
    ])];
    const recentReachedKeys = reachedKeys.slice(0, 16);
    const priority = new Map(recentReachedKeys.map((key, index) => [key, index]));
    const memoryScope = { workId: input.workId, manuscriptVersionId: input.manuscriptVersionId,
      analysisJobId: input.analysisJobId, status: 'approved' };
    const nonStyleTypes = ['entity', 'event', 'foreshadow', 'branch'];
    const memorySelect = { id: true, memoryType: true, partKey: true, revision: true, content: true } as const;
    const styleRows = await tx.storyMemoryRecord.findMany({
      where: { ...memoryScope, memoryType: 'style' },
      orderBy: [{ memoryKey: 'asc' }, { id: 'asc' }], select: memorySelect, take: 8,
    });
    const reachedRows = recentReachedKeys.length ? await tx.storyMemoryRecord.findMany({
      where: { ...memoryScope, memoryType: { in: nonStyleTypes }, partKey: { in: recentReachedKeys } },
      orderBy: [{ partKey: 'desc' }, { memoryType: 'asc' }, { memoryKey: 'asc' }],
      select: memorySelect, take: 128,
    }) : [];
    const planningRows = await tx.storyMemoryRecord.findMany({
      where: { ...memoryScope, memoryType: { in: nonStyleTypes },
        ...(reachedKeys.length ? { OR: [{ partKey: null }, { partKey: { notIn: reachedKeys } }] } : {}) },
      orderBy: [{ partKey: 'asc' }, { memoryType: 'asc' }, { memoryKey: 'asc' }],
      select: memorySelect, take: 15,
    });
    const sourceBeats = input.sourceKind === 'canonical'
      ? await tx.storyBeat.findMany({ where: { sceneId: scene.id },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: { position: true, beatType: true, content: true }, take: 41 })
      : await tx.storyAiGeneratedBeat.findMany({
        where: { sceneId: scene.id, position: { lte: progress.currentBeatPosition } },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: { position: true, beatType: true, content: true }, take: 41 });
    if (!sourceBeats.length || sourceBeats.length > 40 ||
      sourceBeats.some((beat, index) => beat.position !== index + 1) ||
      (input.sourceKind === 'generated' && sourceBeats.length !== progress.currentBeatPosition)) unavailable();
    const path = await assembleContinuationSemanticPath(tx, {
      pathSummary, locale, userId: input.userId, workId: input.workId,
      releaseId: input.releaseId, progressId: progress.id,
    });
    const recentReachedRows = reachedRows
      .sort((left, right) => (priority.get(left.partKey || '') ?? 16) - (priority.get(right.partKey || '') ?? 16))
      .slice(0, 32)
      .sort((left, right) => (priority.get(right.partKey || '') ?? 16) - (priority.get(left.partKey || '') ?? 16));
    const style = styleRows.length <= 3 ? styleRows : [
      styleRows[0], styleRows[Math.floor((styleRows.length - 1) / 2)], styleRows[styleRows.length - 1],
    ];
    const memories = [...style, ...recentReachedRows, ...planningRows];
    const context: StoryContinuationApprovedContext = {
      sourceScene: { title: localizedContinuationText(scene.title, locale),
        beats: sourceBeats.map((beat) => ({ beatType: beat.beatType,
          content: localizedContinuationText(beat.content, locale) })) },
      selectedChoice: { label: localizedContinuationText(choice.label, locale) },
      path,
      memories: memories.map((item) => ({
        memoryType: item.memoryType !== 'style' && (item.memoryType === 'foreshadow' ||
          typeof item.partKey !== 'string' || !reachedPartKeys.has(item.partKey))
          ? `author_plan_${item.memoryType}` : item.memoryType,
        content: diagnosticMemoryText(item.content, locale),
      })),
      generationProfile: input.generationProfile,
      ...(participantArtist ? { participantArtist } : {}),
    };
    context.narrativeLength = input.sourceKind === 'generated'
      ? await authoredPartContinuationLengthBounds(tx, part.id, locale)
      : sourceStoryContinuationLengthBounds(locale, context.sourceScene.beats);
    context.routeContinuity = await assembleContinuationRouteContinuity(tx, {
      routeNodeId: progress.routeNodeId, progressId: progress.id, workId: input.workId,
      releaseId: input.releaseId, userId: input.userId, locale, pathSummary: progress.pathSummary,
    });
    return context;
  } catch (error) {
    if (error instanceof StoryContinuationDiagnosticContextUnavailable) throw error;
    if ((error instanceof Error && error.constructor === Error && contextErrorCodes.has(error.message)) ||
      (error instanceof StoryContinuationLengthPolicyError && lengthErrorCodes.has(error.code))) unavailable();
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      if (record(response) && typeof response.code === 'string' && profileErrorCodes.has(response.code)) unavailable();
    }
    throw error;
  }
}

// The existing continuity reader permits absent/legacy routes. Diagnostics require a
// complete surviving chain and the same recent references before using its sampler.
async function readCurrentDiagnosticRoute(tx: Prisma.TransactionClient,
  input: StoryContinuationDiagnosticContextInput, pathSummary: Prisma.JsonObject[]) {
  const { progress } = input;
  if (!nonempty(progress.routeNodeId) || (input.sourceKind === 'generated' && input.scene.sharedResultId)) unavailable();
  const rows = await tx.$queryRaw<RouteRow[]>`
    WITH RECURSIVE ancestry AS (
      SELECT id, parent_id, depth, step_kind, target_scene_id, source_shared_result_id,
        route_hash, narrative_step, 1 AS distance
      FROM story_progress_route_nodes
      WHERE id=${progress.routeNodeId}::uuid AND progress_id=${progress.id}::uuid
        AND work_id=${input.workId}::uuid AND release_id=${input.releaseId}::uuid
      UNION ALL
      SELECT parent.id, parent.parent_id, parent.depth, parent.step_kind, parent.target_scene_id,
        parent.source_shared_result_id, parent.route_hash, parent.narrative_step, child.distance + 1
      FROM story_progress_route_nodes parent JOIN ancestry child ON parent.id=child.parent_id
      WHERE child.distance < 512 AND parent.progress_id=${progress.id}::uuid
        AND parent.work_id=${input.workId}::uuid AND parent.release_id=${input.releaseId}::uuid
    ) SELECT id, parent_id, depth, step_kind, target_scene_id, source_shared_result_id,
      route_hash, narrative_step FROM ancestry ORDER BY depth ASC`;
  if (!rows.length || rows[0].parent_id !== null || rows[0].step_kind !== 'root' ||
    rows[0].narrative_step !== null || rows.at(-1)!.id !== progress.routeNodeId) unavailable();
  const references: Prisma.JsonObject[] = [];
  let current = { kind: 'canonical', id: rows[0].target_scene_id };
  for (const [index, row] of rows.entries()) {
    if (row.depth !== index || (index > 0 && row.parent_id !== rows[index - 1].id) ||
      !row.route_hash || !/^[a-f0-9]{64}$/i.test(row.route_hash) || row.step_kind === 'shared' ||
      row.source_shared_result_id !== null) unavailable();
    if (!index) continue;
    if (!record(row.narrative_step) || !validReferences(row.narrative_step) || row.step_kind === 'root') unavailable();
    const step = row.narrative_step;
    const generatedSource = nonempty(step.sourceGeneratedSceneId);
    const sourceId = generatedSource ? step.sourceGeneratedSceneId : step.sourceSceneId ?? step.sceneId;
    if (current.kind !== (generatedSource ? 'generated' : 'canonical') || current.id !== sourceId ||
      (!nonempty(step.choiceId) && !nonempty(step.customChoiceId))) unavailable();
    if (nonempty(step.generatedSceneId)) current = { kind: 'generated', id: step.generatedSceneId };
    else {
      if (!nonempty(step.nextSceneId) || row.target_scene_id !== step.nextSceneId) unavailable();
      current = { kind: 'canonical', id: step.nextSceneId };
    }
    references.push(routeReferences(step));
  }
  if (current.kind !== input.sourceKind || current.id !== input.scene.id ||
    stableContinuationJson(boundedPath(references)) !==
      stableContinuationJson(pathSummary.map(routeReferences))) unavailable();
}

function routeReferences(step: Record<string, unknown>): Prisma.JsonObject {
  const references: Prisma.JsonObject = {};
  for (const key of referenceKeys) {
    if (typeof step[key] === 'string' || step[key] === null) references[key] = step[key] as string | null;
  }
  if (typeof step.explicitRejoin === 'boolean') references.explicitRejoin = step.explicitRejoin;
  if (Number.isInteger(step.readBeatPosition) && Number(step.readBeatPosition) >= 0 && Number(step.readBeatPosition) <= 40) {
    references.readBeatPosition = Number(step.readBeatPosition);
  }
  if (step.provenance === 'ai_generated' || step.provenance === 'ai_reused') references.provenance = step.provenance;
  return references;
}

function diagnosticMemoryText(value: Prisma.JsonValue, locale: string) {
  // The shared memory serializer accepts structured records. Known locale maps must
  // still contain the requested locale, including the two script-qualified Chinese keys.
  if (record(value) && Object.keys(value).some((key) => (STORY_LOCALES as readonly string[]).includes(key))) {
    localizedContinuationText(value, locale);
  }
  return approvedContinuationMemoryText(value, locale);
}

// Narrow read equivalent of pinnedContext, including its pin/fingerprint/asset checks.
// The service itself also owns binding, public URLs and config, so is not instantiated.
async function readDiagnosticParticipant(tx: Prisma.TransactionClient,
  input: StoryContinuationDiagnosticContextInput): Promise<StoryApprovedParticipant | null> {
  const participant = await tx.storyProgressArtistParticipant.findUnique({
    where: { progressId: input.progress.id },
    include: { artist: { select: { id: true, slug: true, displayName: true } } },
  });
  if (!participant) return null;
  if (participant.userId !== input.userId || participant.workId !== input.workId ||
    participant.progressId !== input.progress.id) unavailable();
  const pin: StoryParticipantPin = {
    id: participant.id, artistId: participant.artistId, participantFingerprint: participant.participantFingerprint,
    identityProfileId: participant.identityProfileId, identityProfileVersion: participant.identityProfileVersion,
    identityReviewRevision: participant.identityReviewRevision, identitySourceFingerprint: participant.identitySourceFingerprint,
    identityApprovedFingerprint: participant.identityApprovedFingerprint,
    referenceAssetIds: stringArray(participant.referenceAssetIds),
    referenceChecksums: stringArray(participant.referenceChecksums),
  };
  const fingerprint = createHash('sha256').update(stableJson({
    artistId: pin.artistId, slug: participant.artist.slug, displayName: participant.artist.displayName,
    identity: pin.identityProfileId ? { id: pin.identityProfileId, profileVersion: pin.identityProfileVersion,
      reviewRevision: pin.identityReviewRevision, sourceFingerprint: pin.identitySourceFingerprint,
      approvedFingerprint: pin.identityApprovedFingerprint } : null,
    referenceAssetIds: pin.referenceAssetIds, referenceChecksums: pin.referenceChecksums,
  })).digest('hex');
  if (participant.artist.id !== pin.artistId || pin.participantFingerprint !== fingerprint) unavailable();
  let identityProfile: StoryApprovedParticipant['identityProfile'];
  if (pin.identityProfileId) {
    const profile = await tx.artistStoryIdentityProfile.findFirst({ where: {
      id: pin.identityProfileId, artistId: participant.artistId, profileVersion: pin.identityProfileVersion!,
      reviewRevision: pin.identityReviewRevision!, sourceFingerprint: pin.identitySourceFingerprint!,
      approvedFingerprint: pin.identityApprovedFingerprint!, status: 'approved',
    } });
    if (!profile?.approvedSettings) unavailable();
    const normalized = normalizeCreatorGenerationProfile('artist', profile.approvedSettings);
    if (creatorGenerationProfileFingerprint(profile.sourceFingerprint, normalized) !== profile.approvedFingerprint) unavailable();
    const assets = await tx.artistAsset.findMany({
      where: { artistId: participant.artistId, assetId: { in: pin.referenceAssetIds }, asset: { visibility: 'public' } },
      select: { assetId: true, asset: { select: { checksum: true, metadata: true } } },
    });
    const assetById = new Map(assets.map((item) => [item.assetId, item.asset]));
    if (pin.referenceAssetIds.some((id, index) => {
      const asset = assetById.get(id);
      return !asset || !publicReady(asset.metadata) || asset.checksum !== pin.referenceChecksums[index];
    })) unavailable();
    identityProfile = { schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
      sections: normalized.sections.filter((section) => section.decision === 'accepted' || section.decision === 'edited')
        .map((section) => ({ key: section.key, value: section.value })) };
  }
  return { artistId: participant.artistId, slug: participant.artist.slug, displayName: participant.artist.displayName,
    visualIdentityReady: Boolean(identityProfile), ...(identityProfile ? { identityProfile } : {}) };
}

function stringArray(value: Prisma.JsonValue) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function publicReady(value: Prisma.JsonValue) {
  if (!record(value)) return true;
  const lifecycle = value.lifecycle;
  return lifecycle === undefined || (record(lifecycle) && lifecycle.status === 'active');
}

import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { STORY_LOCALES } from '../story-production/story-production.policy';
import { loadCanonicalStoryMemory } from './story-chat-canonical-memory';

export type StoryChatMemoryItem = {
  workTitle: string;
  sceneTitle: string;
  // Keep the legacy field name; interactionKind determines action versus speech.
  artistDialogue: string;
  interactionKind?: 'action' | 'dialogue';
  evidenceSource?: 'canonical_author_approved';
};

export type StoryChatMemoryContext = (
  | { source: 'no_verified_interaction'; items: [] }
  | { source: 'attributed_story_dialogue'; items: StoryChatMemoryItem[] }
) & { canonicalProofFingerprint?: string };

const MAX_PROGRESS = 1;
const MAX_ROUTE_SCENES = 12;
const MAX_MEMORY_ITEMS = 6;

export function unverifiedStoryMemoryContext(): StoryChatMemoryContext {
  return { source: 'no_verified_interaction', items: [] };
}

function localizedText(value: Prisma.JsonValue, locale = 'ko'): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Prisma.JsonObject;
  for (const candidate of [...new Set([locale, ...STORY_LOCALES])]) {
    const text = record[candidate];
    if (typeof text === 'string' && text.trim()) return text.trim();
  }
  return null;
}

function routeGeneratedSceneReadLimits(
  pathSummary: Prisma.JsonValue,
  currentGeneratedSceneId: string | null,
  currentBeatPosition: number,
): Map<string, number> {
  const limits = new Map<string, number>();
  if (!Array.isArray(pathSummary) || !currentGeneratedSceneId) return limits;
  const generated = pathSummary.flatMap((entry, index) =>
    entry && typeof entry === 'object' && !Array.isArray(entry) &&
    typeof entry.generatedSceneId === 'string' && entry.generatedSceneId
      ? [{ id: entry.generatedSceneId, index }]
      : []);
  const current = generated.at(-1);
  if (current?.id !== currentGeneratedSceneId) return limits;
  for (const { id, index } of generated.slice(-MAX_ROUTE_SCENES)) {
    const next = pathSummary[index + 1];
    const readPosition = index === current.index
      ? currentBeatPosition
      : next && typeof next === 'object' && !Array.isArray(next) &&
        next.sourceGeneratedSceneId === id
        ? next.readBeatPosition
        : null;
    if (typeof readPosition === 'number' && Number.isSafeInteger(readPosition) && readPosition >= 0) {
      limits.set(id, readPosition);
    }
  }
  return limits;
}

export async function loadStoryChatMemoryContext(
  prisma: PrismaService | Prisma.TransactionClient,
  input: { userId: string; artistId: string; artistDisplayName: string; progressId?: string },
  transaction?: Prisma.TransactionClient,
): Promise<StoryChatMemoryContext> {
  // A saving caller must already hold its exact progress/revision fence.
  if (transaction && transaction !== prisma) throw new Error('Memory save must use the caller transaction');
  const progresses = await prisma.storyReaderProgress.findMany({
    where: {
      ...(input.progressId ? { id: input.progressId } : {}),
      userId: input.userId,
      status: { in: ['active', 'completed'] },
      participantArtist: { is: {
        artistId: input.artistId,
        identityApprovedFingerprint: { not: null },
      } },
    },
    orderBy: { updatedAt: 'desc' },
    take: input.progressId ? 1 : MAX_PROGRESS + 1,
    select: {
      id: true, workId: true, activeReleaseId: true, routeNodeId: true, pathSummary: true,
      progressRevision: true, storyVersion: true,
      currentSceneId: true, currentGeneratedSceneId: true, currentBeatPosition: true,
      participantArtist: { select: {
        identityProfileId: true, identityProfileVersion: true,
        identityReviewRevision: true, identitySourceFingerprint: true,
        identityApprovedFingerprint: true,
      } },
    },
  });
  if (progresses.length !== 1) return unverifiedStoryMemoryContext();
  if (transaction) {
    const progress = progresses[0];
    // Match the approval service's work -> artist -> identity lock order.
    // Its work lock also serializes new approvals and withdrawals with this save.
    await transaction.$queryRaw`SELECT id FROM story_works WHERE id = ${progress.workId}::uuid FOR SHARE`;
    // UPDATE also conflicts with FK KEY SHARE taken by a new profile insert.
    // SHARE alone protects existing profiles, not the latest-version predicate.
    const artists = await transaction.$queryRaw<Array<{ displayName: string }>>`SELECT display_name AS "displayName"
      FROM artists WHERE id = ${input.artistId}::uuid AND status = 'active' FOR UPDATE`;
    if (artists.length !== 1) return unverifiedStoryMemoryContext();
    await transaction.$queryRaw`SELECT id FROM artist_story_identity_profiles
      WHERE artist_id = ${input.artistId}::uuid ORDER BY profile_version DESC FOR SHARE`;
    await transaction.$queryRaw`SELECT id FROM story_progress_artist_participants
      WHERE progress_id = ${progress.id}::uuid AND user_id = ${input.userId}::uuid FOR SHARE`;
    if (progress.activeReleaseId) await transaction.$queryRaw`SELECT r.id FROM story_releases r
      JOIN story_manuscript_versions m ON m.id = r.manuscript_version_id
      WHERE r.id = ${progress.activeReleaseId}::uuid AND r.work_id = ${progress.workId}::uuid FOR SHARE OF r, m`;
  }
  const items: StoryChatMemoryItem[] = [];
  let canonicalFingerprint: string | undefined;
  for (const progress of progresses) {
    if (!progress.activeReleaseId || !progress.routeNodeId) continue;
    const readLimits = routeGeneratedSceneReadLimits(
      progress.pathSummary, progress.currentGeneratedSceneId, progress.currentBeatPosition,
    );
    const sceneIds = [...readLimits.keys()];
    // A root scene can have an explicit receipt even before its navigation cursor moves.
    if (!Number.isSafeInteger(progress.storyVersion) && !sceneIds.length && !progress.currentSceneId &&
        (!Array.isArray(progress.pathSummary) || !progress.pathSummary.length)) continue;
    const activeRoute = await prisma.storyProgressRouteNode.findFirst({
      where: {
        id: progress.routeNodeId, progressId: progress.id,
        workId: progress.workId, releaseId: progress.activeReleaseId,
      },
      select: { id: true },
    });
    if (!activeRoute) continue;
    const identity = progress.participantArtist;
    if (!identity?.identityProfileId || !identity.identityProfileVersion ||
        identity.identityReviewRevision == null || !identity.identitySourceFingerprint ||
        !identity.identityApprovedFingerprint) continue;
    const approvedProfile = await prisma.artistStoryIdentityProfile.findFirst({
      where: {
        id: identity.identityProfileId,
        artistId: input.artistId,
        profileVersion: identity.identityProfileVersion,
        reviewRevision: identity.identityReviewRevision,
        sourceFingerprint: identity.identitySourceFingerprint,
        approvedFingerprint: identity.identityApprovedFingerprint,
        status: 'approved',
      },
      select: { id: true },
    });
    if (!approvedProfile) continue;
    const work = await prisma.storyWork.findFirst({
      where: { id: progress.workId, activeReleaseId: progress.activeReleaseId, status: 'published', fixtureSource: false },
      select: { title: true },
    });
    const workTitle = work && localizedText(work.title);
    if (!workTitle) continue;
    const canonical = await loadCanonicalStoryMemory(prisma, input, progress, transaction);
    if (canonical.items.length) canonicalFingerprint = canonical.fingerprint;
    // Ready/read generated prose has no reviewed interaction evidence. A name
    // prefix alone cannot establish that the character spoke in this route.
    items.push(...canonical.items);
    if (items.length >= MAX_MEMORY_ITEMS) break;
  }
  if (!items.length) return unverifiedStoryMemoryContext();
  const progress = progresses[0];
  const currentProgress = await prisma.storyReaderProgress.findFirst({
    where: {
      id: progress.id, userId: input.userId, workId: progress.workId,
      status: { in: ['active', 'completed'] },
      participantArtist: { is: {
        artistId: input.artistId,
        identityApprovedFingerprint: { not: null },
      } },
    },
    select: {
      activeReleaseId: true, routeNodeId: true, pathSummary: true, progressRevision: true,
      currentSceneId: true, currentGeneratedSceneId: true, currentBeatPosition: true,
      participantArtist: { select: { identityApprovedFingerprint: true } },
    },
  });
  if (!currentProgress || currentProgress.activeReleaseId !== progress.activeReleaseId ||
      currentProgress.routeNodeId !== progress.routeNodeId ||
      currentProgress.progressRevision !== progress.progressRevision ||
      currentProgress.currentSceneId !== progress.currentSceneId ||
      currentProgress.currentGeneratedSceneId !== progress.currentGeneratedSceneId ||
      currentProgress.currentBeatPosition !== progress.currentBeatPosition ||
      currentProgress.participantArtist?.identityApprovedFingerprint !==
        progress.participantArtist?.identityApprovedFingerprint ||
      JSON.stringify(currentProgress.pathSummary) !== JSON.stringify(progress.pathSummary)) {
    return unverifiedStoryMemoryContext();
  }
  const identity = progress.participantArtist!;
  const currentApproval = await prisma.artistStoryIdentityProfile.findFirst({
    where: {
      id: identity.identityProfileId!,
      artistId: input.artistId,
      profileVersion: identity.identityProfileVersion!,
      reviewRevision: identity.identityReviewRevision!,
      sourceFingerprint: identity.identitySourceFingerprint!,
      approvedFingerprint: identity.identityApprovedFingerprint!,
      status: 'approved',
    },
    select: { id: true },
  });
  if (!currentApproval) return unverifiedStoryMemoryContext();
  const currentWork = await prisma.storyWork.findFirst({
    where: { id: progress.workId, activeReleaseId: progress.activeReleaseId,
      status: 'published', fixtureSource: false },
    select: { id: true },
  });
  if (!currentWork) return unverifiedStoryMemoryContext();
  if (canonicalFingerprint !== undefined) {
    const canonical = await loadCanonicalStoryMemory(prisma, input, progress, transaction);
    if (canonical.fingerprint !== canonicalFingerprint) return unverifiedStoryMemoryContext();
  }
  const selectedItems = items.slice(0, MAX_MEMORY_ITEMS);
  return {
    source: 'attributed_story_dialogue', items: selectedItems,
    ...(canonicalFingerprint !== undefined && selectedItems.some(
      (item) => item.evidenceSource === 'canonical_author_approved',
    ) ? { canonicalProofFingerprint: canonicalFingerprint } : {}),
  };
}

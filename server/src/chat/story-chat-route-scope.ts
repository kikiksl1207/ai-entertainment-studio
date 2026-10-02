import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

export type StoryChatRouteScope = {
  progressId: string;
  workId: string;
  releaseId: string;
  routeNodeId: string;
  progressRevision: number;
  resetCommandId: string | null;
  resetAfterRevision: number | null;
  identityProfileId: string;
  identityProfileVersion: number;
  identityReviewRevision: number;
  identitySourceFingerprint: string;
  identityApprovedFingerprint: string;
  progressUpdatedAt: Date;
};

export function storyChatRouteMarker(scope: StoryChatRouteScope) {
  return {
    version: 2,
    progressId: scope.progressId,
    workId: scope.workId,
    releaseId: scope.releaseId,
    routeNodeId: scope.routeNodeId,
    resetEpoch: scope.resetCommandId
      ? { commandId: scope.resetCommandId, afterRevision: scope.resetAfterRevision }
      : null,
    identityApprovedFingerprint: scope.identityApprovedFingerprint,
  };
}

export function storyChatRouteWhere(
  scope: StoryChatRouteScope,
  userId: string,
  artistId: string,
): Prisma.StoryReaderProgressWhereInput {
  return {
    id: scope.progressId,
    userId,
    workId: scope.workId,
    activeReleaseId: scope.releaseId,
    routeNodeId: scope.routeNodeId,
    progressRevision: scope.progressRevision,
    updatedAt: scope.progressUpdatedAt,
    status: { in: ['active', 'completed'] },
    participantArtist: { is: {
      artistId,
      identityProfileId: scope.identityProfileId,
      identityProfileVersion: scope.identityProfileVersion,
      identityReviewRevision: scope.identityReviewRevision,
      identitySourceFingerprint: scope.identitySourceFingerprint,
      identityApprovedFingerprint: scope.identityApprovedFingerprint,
    } },
  };
}

export async function lockApprovedStoryChatIdentity(
  tx: Prisma.TransactionClient,
  scope: StoryChatRouteScope,
  artistId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM artist_story_identity_profiles
    WHERE id = ${scope.identityProfileId}::uuid
      AND artist_id = ${artistId}::uuid
      AND profile_version = ${scope.identityProfileVersion}
      AND review_revision = ${scope.identityReviewRevision}
      AND source_fingerprint = ${scope.identitySourceFingerprint}
      AND approved_fingerprint = ${scope.identityApprovedFingerprint}
      AND status = 'approved'
    FOR SHARE
  `;
  return rows.length === 1;
}

export async function loadStoryChatRouteScope(
  prisma: PrismaService,
  input: { userId: string; artistId: string; progressId: string },
): Promise<StoryChatRouteScope | null> {
  const progress = await prisma.storyReaderProgress.findFirst({
    where: {
      id: input.progressId,
      userId: input.userId,
      status: { in: ['active', 'completed'] },
      participantArtist: { is: {
        artistId: input.artistId,
        identityApprovedFingerprint: { not: null },
      } },
    },
    select: {
      id: true, workId: true, activeReleaseId: true, routeNodeId: true,
      progressRevision: true, updatedAt: true,
      participantArtist: { select: {
        identityProfileId: true, identityProfileVersion: true,
        identityReviewRevision: true, identitySourceFingerprint: true,
        identityApprovedFingerprint: true,
      } },
    },
  });
  const identity = progress?.participantArtist;
  if (!progress?.activeReleaseId || !progress.routeNodeId ||
      !Number.isSafeInteger(progress.progressRevision) || !identity?.identityProfileId ||
      !identity.identityProfileVersion || identity.identityReviewRevision == null ||
      !identity.identitySourceFingerprint || !identity.identityApprovedFingerprint) return null;

  const [route, profile, reset] = await Promise.all([
    // Private routes have no reusable hash; the owned route ID still isolates their chat.
    prisma.storyProgressRouteNode.findFirst({
      where: {
        id: progress.routeNodeId, progressId: progress.id,
        workId: progress.workId, releaseId: progress.activeReleaseId,
      },
      select: { id: true },
    }),
    prisma.artistStoryIdentityProfile.findFirst({
      where: {
        id: identity.identityProfileId, artistId: input.artistId,
        profileVersion: identity.identityProfileVersion,
        reviewRevision: identity.identityReviewRevision,
        sourceFingerprint: identity.identitySourceFingerprint,
        approvedFingerprint: identity.identityApprovedFingerprint,
        status: 'approved',
      },
      select: { id: true },
    }),
    prisma.storyResetCommand.findFirst({
      where: {
        progressId: progress.id, userId: input.userId,
        status: 'completed', afterRevision: { lte: progress.progressRevision },
      },
      orderBy: [{ afterRevision: 'desc' }, { id: 'desc' }],
      select: { id: true, afterRevision: true },
    }),
  ]);
  if (!route || !profile) return null;

  return {
    progressId: progress.id,
    workId: progress.workId,
    releaseId: progress.activeReleaseId,
    routeNodeId: progress.routeNodeId,
    progressRevision: progress.progressRevision,
    resetCommandId: reset?.id ?? null,
    resetAfterRevision: reset?.afterRevision ?? null,
    identityProfileId: identity.identityProfileId,
    identityProfileVersion: identity.identityProfileVersion,
    identityReviewRevision: identity.identityReviewRevision,
    identitySourceFingerprint: identity.identitySourceFingerprint,
    identityApprovedFingerprint: identity.identityApprovedFingerprint,
    progressUpdatedAt: progress.updatedAt,
  };
}

export async function isStoryChatRouteScopeCurrent(
  prisma: PrismaService,
  input: { userId: string; artistId: string; scope: StoryChatRouteScope },
): Promise<boolean> {
  const progress = await prisma.storyReaderProgress.findFirst({
    where: storyChatRouteWhere(input.scope, input.userId, input.artistId),
    select: { id: true },
  });
  if (!progress) return false;

  // A reset advances progressRevision in the same transaction as its command.
  // The exact progress fence therefore proves the reset epoch is unchanged.
  const profile = await prisma.artistStoryIdentityProfile.findFirst({
    where: {
      id: input.scope.identityProfileId, artistId: input.artistId,
      profileVersion: input.scope.identityProfileVersion,
      reviewRevision: input.scope.identityReviewRevision,
      sourceFingerprint: input.scope.identitySourceFingerprint,
      approvedFingerprint: input.scope.identityApprovedFingerprint,
      status: 'approved',
    },
    select: { id: true },
  });
  return Boolean(profile);
}

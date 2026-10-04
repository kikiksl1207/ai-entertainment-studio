import { Prisma } from '@prisma/client';
import { storyPathSignature } from './story-lifecycle.policy';
import { boundedPath } from './story-production.policy';

type EndingProgress = {
  id: string; userId: string; workId: string; status: string; storyVersion: number;
  activeReleaseId: string | null; routeNodeId?: string | null;
  currentSceneId: string | null; currentGeneratedSceneId?: string | null;
  pathSummary: Prisma.JsonValue;
};

// A completed flag alone is not evidence that this canonical scene belongs to the ending.
export async function canonicalEndingPosition(db: Prisma.TransactionClient, progress: EndingProgress, recoverMissing = false) {
  if (progress.status !== 'completed' || (!progress.currentSceneId && !recoverMissing) || progress.currentGeneratedSceneId ||
    !progress.activeReleaseId || !progress.routeNodeId || !Array.isArray(progress.pathSummary)) return null;
  const work = await db.storyWork.findFirst({ where: { id: progress.workId, status: 'published',
    fixtureSource: false, activeReleaseId: progress.activeReleaseId, publishedVersion: progress.storyVersion } });
  const release = work && await db.storyRelease.findFirst({ where: { id: progress.activeReleaseId,
    workId: progress.workId, status: 'active', version: progress.storyVersion } });
  const route = release && await db.storyProgressRouteNode.findFirst({ where: { id: progress.routeNodeId,
    progressId: progress.id, workId: progress.workId, releaseId: release.id, stepKind: 'canonical' } });
  if (!release || !route || (!route.endingKey && !route.targetSceneId) || !route.sourceSceneId || !route.sourceChoiceId) return null;
  const sceneId = route.targetSceneId ?? route.sourceSceneId;
  if (progress.currentSceneId && sceneId !== progress.currentSceneId) return null;
  const event = await db.storyChoiceEvent.findFirst({ where: { progressId: progress.id,
    sceneId: route.sourceSceneId, choiceId: route.sourceChoiceId, targetSceneId: route.targetSceneId,
    endingKey: route.endingKey, endingType: { in: ['author_main', 'author_sub'] },
    invalidatedAt: null, resetCommandId: null }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  if (!event) return null;
  const scene = await db.storyScene.findFirst({ where: { id: sceneId,
    status: 'published', fixtureSource: false } });
  const part = scene && await db.storyPart.findFirst({ where: { id: scene.partId,
    workId: progress.workId, status: 'published', fixtureSource: false } });
  if (!part || (scene!.endingType && scene!.endingType !== event.endingType)) return null;
  if (work!.ownerUserId !== progress.userId && (!work!.priceLumina.isZero() || !part.priceLumina.isZero())) {
    const now = new Date();
    const access = await db.userEntitlement.findFirst({ where: { userId: progress.userId,
      entitlementType: { in: ['story_work', 'story_season', 'story_part'] }, referenceId: { in: [work!.id, part.id] },
      revokedAt: null, startsAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    }, select: { id: true } });
    if (!access) return null;
  }
  if (route.endingKey) {
    const discovery = await db.storyEndingDiscovery.findFirst({ where: { userId: progress.userId,
      workId: progress.workId, releaseId: release.id, endingKey: route.endingKey,
      endingKind: event.endingType!, provenance: 'writer_original',
      pathSignature: storyPathSignature(boundedPath(progress.pathSummary)) } });
    if (!discovery) return null;
  } else if (route.targetSceneId !== scene!.id || scene!.endingType !== event.endingType) return null;
  return { sceneId: scene!.id, endingType: event.endingType!, routeNodeId: route.id };
}

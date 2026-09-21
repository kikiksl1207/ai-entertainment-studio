import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { appendStoryRouteHash, storyRouteRootHash, StoryRouteStep } from './story-route-identity.policy';

type RouteProgress = { id: string; workId: string; activeReleaseId: string | null; routeNodeId?: string | null };
// Hashes always retain the complete route. Expensive dependency/reset walks have
// a separate fail-closed ceiling; exceeding it never truncates or invents a hash.
const ROUTE_WALK_LIMIT = 16384;

export async function createStoryRouteRoot(tx: Prisma.TransactionClient, progress: RouteProgress, sceneId: string, actNumber: number) {
  if (!progress.activeReleaseId) return null;
  const release = await tx.storyRelease.findFirst({ where: { id: progress.activeReleaseId, workId: progress.workId } });
  if (!release) return null;
  const node = await tx.storyProgressRouteNode.create({ data: {
    progressId: progress.id, workId: progress.workId, releaseId: release.id, depth: 0, stepKind: 'root',
    targetSceneId: sceneId, actNumber, routeHash: storyRouteRootHash({ workId: progress.workId,
      releaseId: release.id, releaseChecksum: release.checksum, manuscriptVersionId: release.manuscriptVersionId, entrySceneId: sceneId }),
  } });
  return node.id;
}

export async function appendStoryRoute(tx: Prisma.TransactionClient, progress: RouteProgress, step: StoryRouteStep, actNumber: number,
  narrativeStep?: Record<string, unknown>) {
  if (!progress.routeNodeId || !progress.activeReleaseId) return null;
  const parent = await tx.storyProgressRouteNode.findFirst({ where: { id: progress.routeNodeId,
    progressId: progress.id, workId: progress.workId, releaseId: progress.activeReleaseId } });
  if (!parent) throw new ConflictException('Story route owner changed');
  const node = await tx.storyProgressRouteNode.create({ data: {
    progressId: progress.id, workId: progress.workId, releaseId: progress.activeReleaseId,
    parentId: parent.id, depth: parent.depth + 1, stepKind: step.kind, actNumber,
    routeHash: appendStoryRouteHash(parent.routeHash, step),
    sourceSceneId: step.kind === 'canonical' ? step.sceneId : null,
    sourceChoiceId: step.kind === 'canonical' ? step.choiceId : null,
    targetSceneId: step.kind === 'canonical' ? step.targetSceneId : null,
    sourceSharedResultId: step.kind === 'shared' ? step.sharedResultId : null,
    sourceSharedChoiceKey: step.kind === 'shared' ? step.choiceKey : null,
    endingKey: step.kind === 'private' ? null : step.endingKey,
    narrativeStep: narrativeStep ? narrativeReferences(narrativeStep) : step.kind === 'canonical'
      ? { sceneId: step.sceneId, choiceId: step.choiceId, nextSceneId: step.targetSceneId, explicitRejoin: false }
      : Prisma.DbNull,
  } });
  return node.id;
}

export async function storyRouteSnapshot(tx: Prisma.TransactionClient, progress: RouteProgress) {
  if (!progress.routeNodeId || !progress.activeReleaseId) return { nodeId: null, hash: null };
  const node = await tx.storyProgressRouteNode.findFirst({ where: { id: progress.routeNodeId,
    progressId: progress.id, workId: progress.workId, releaseId: progress.activeReleaseId } });
  if (!node) throw new ConflictException('Story route owner changed');
  return { nodeId: node.id, hash: node.routeHash };
}

export async function storyRouteSharingHash(tx: Prisma.TransactionClient, progress: RouteProgress) {
  const snapshot = await storyRouteSnapshot(tx, progress);
  if (!snapshot.hash) return null;
  const nodes = await tx.$queryRaw<Array<{ parent_id: string | null; source_shared_result_id: string | null }>>`
    WITH RECURSIVE ancestry AS (
      SELECT id,parent_id,source_shared_result_id,1 AS distance FROM story_progress_route_nodes WHERE id=${snapshot.nodeId}::uuid
      UNION ALL SELECT n.id,n.parent_id,n.source_shared_result_id,a.distance+1 FROM story_progress_route_nodes n
        JOIN ancestry a ON n.id=a.parent_id WHERE a.distance<${ROUTE_WALK_LIMIT}
    ) SELECT parent_id,source_shared_result_id FROM ancestry`;
  if (!nodes.some((node) => node.parent_id === null)) return null;
  const ids = [...new Set(nodes.flatMap((node) => node.source_shared_result_id ? [node.source_shared_result_id] : []))];
  if (!ids.length) return snapshot.hash;
  const sources = await tx.$queryRaw<Array<{ valid: boolean }>>`
    SELECT story_ai_shared_ancestry_valid(id) AS valid FROM story_ai_reusable_results
    WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) FOR SHARE`;
  return sources.length === ids.length && sources.every((source) => source.valid) ? snapshot.hash : null;
}

export async function storyRouteStepForContinuation(tx: Prisma.TransactionClient, input: {
  workId: string; releaseId: string; sourceSceneId: string | null; recommendedChoiceId: string | null;
  sourceGeneratedSceneId: string | null; generatedChoiceId: string | null; endingKey: string | null;
}): Promise<StoryRouteStep> {
  if (input.sourceSceneId && input.recommendedChoiceId) return { kind: 'canonical',
    sceneId: input.sourceSceneId, choiceId: input.recommendedChoiceId, targetSceneId: null, endingKey: input.endingKey };
  if (input.sourceGeneratedSceneId && input.generatedChoiceId) {
    const source = await tx.storyAiGeneratedScene.findUnique({ where: { id: input.sourceGeneratedSceneId } });
    const choice = await tx.storyAiGeneratedChoice.findFirst({ where: { id: input.generatedChoiceId, sceneId: input.sourceGeneratedSceneId } });
    const shared = source?.sharedResultId && await tx.storyAiReusableResult.findFirst({ where: {
      id: source.sharedResultId, workId: input.workId, releaseId: input.releaseId, status: 'approved',
    } });
    if (shared && choice) return { kind: 'shared', sharedResultId: shared.id, choiceKey: choice.choiceKey, endingKey: input.endingKey };
  }
  return { kind: 'private' };
}

export async function restoreStoryActRoute(tx: Prisma.TransactionClient, progress: RouteProgress, targetSceneId: string, targetAct: number) {
  if (!progress.routeNodeId || !progress.activeReleaseId) return null;
  const nodes = await tx.$queryRaw<Array<{ id: string; target_scene_id: string | null; act_number: number; depth: number;
    narrative_step: Prisma.JsonObject | null }>>`
    WITH RECURSIVE ancestry AS (
      SELECT *,1 AS distance FROM story_progress_route_nodes WHERE id=${progress.routeNodeId}::uuid AND progress_id=${progress.id}::uuid
        AND release_id=${progress.activeReleaseId}::uuid
      UNION ALL SELECT n.*,a.distance+1 FROM story_progress_route_nodes n JOIN ancestry a ON n.id=a.parent_id WHERE a.distance<${ROUTE_WALK_LIMIT}
    ) SELECT id,target_scene_id,act_number,depth,narrative_step FROM ancestry ORDER BY depth ASC`;
  const entry = nodes.findIndex((node) => node.target_scene_id === targetSceneId && node.act_number === targetAct);
  // Restoring a truncated/unvisited act, or a route with later cross-act backtracking,
  // is not proof of a surviving prefix. Personal reset remains available.
  if (nodes[0]?.depth !== 0 || entry < 0 || nodes.slice(entry + 1).some((node) => node.act_number < targetAct)) return null;
  const prefix = nodes.slice(1, entry + 1);
  if (prefix.some((node) => !node.narrative_step)) return null;
  return { nodeId: nodes[entry].id, pathSummary: prefix.slice(-24).map((node) => node.narrative_step!) };
}

function narrativeReferences(input: Record<string, unknown>): Prisma.InputJsonObject {
  const references: Record<string, string | boolean | null> = {};
  for (const key of ['sceneId', 'sourceSceneId', 'sourceGeneratedSceneId', 'choiceId', 'nextSceneId', 'generatedSceneId']) {
    if (typeof input[key] === 'string' || input[key] === null) references[key] = input[key] as string | null;
  }
  if (typeof input.explicitRejoin === 'boolean') references.explicitRejoin = input.explicitRejoin;
  if (input.provenance === 'ai_generated' || input.provenance === 'ai_reused') references.provenance = input.provenance;
  return references;
}

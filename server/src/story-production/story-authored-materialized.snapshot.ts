import { Prisma } from '@prisma/client';

export async function authoredMaterializedSnapshot(tx: Prisma.TransactionClient, workId: string) {
  const parts = await tx.storyPart.findMany({ where: { workId }, orderBy: { position: 'asc' }, take: 1001,
    select: { id: true, seasonKey: true, actNumber: true, position: true, status: true, title: true,
      priceLumina: true, fixtureSource: true } });
  const scenes = await tx.storyScene.findMany({ where: { partId: { in: parts.map(part => part.id) } },
    orderBy: [{ partId: 'asc' }, { position: 'asc' }], take: 1001,
    select: { id: true, partId: true, sceneKey: true, position: true, status: true, title: true,
      visualManifest: true, endingType: true, fixtureSource: true } });
  const ids = scenes.map(scene => scene.id);
  const beats = await tx.storyBeat.findMany({ where: { sceneId: { in: ids } },
    orderBy: [{ sceneId: 'asc' }, { position: 'asc' }], take: 40001,
    select: { id: true, sceneId: true, position: true, beatType: true, content: true, sourceSceneKey: true, visualManifest: true } });
  const choices = await tx.storyChoice.findMany({ where: { sceneId: { in: ids } },
    orderBy: [{ sceneId: 'asc' }, { position: 'asc' }], take: 3001,
    select: { id: true, sceneId: true, choiceKey: true, position: true, label: true, routeKind: true,
      targetSceneId: true, targetEndingKey: true, declaredRejoinSceneId: true } });
  return { parts: parts.map(part => ({ ...part, priceLumina: part.priceLumina.toString() })), scenes, beats, choices };
}

export type AuthoredMaterializedSnapshot = Awaited<ReturnType<typeof authoredMaterializedSnapshot>>;

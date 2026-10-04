import { Prisma } from '@prisma/client';
import { canonicalEndingPosition } from './story-canonical-ending.store';
import { storyPathSignature } from './story-lifecycle.policy';

function fixture() {
  const progress = { id: 'progress', userId: 'reader', workId: 'work', status: 'completed', storyVersion: 1,
    activeReleaseId: 'release', routeNodeId: 'node', currentSceneId: 'source', currentGeneratedSceneId: null,
    pathSummary: [{ sceneId: 'source', choiceId: 'choice', nextSceneId: null }] };
  const work = { id: 'work', ownerUserId: 'writer', priceLumina: new Prisma.Decimal(0) }, release = { id: 'release' };
  const part = { id: 'part', priceLumina: new Prisma.Decimal(0) };
  const route = { id: 'node', sourceSceneId: 'source', sourceChoiceId: 'choice', targetSceneId: null as string | null,
    endingKey: 'author_main' as string | null };
  const event = { endingType: 'author_main' };
  const scene = { id: 'source', partId: 'part', endingType: null as string | null };
  const db = {
    storyWork: { findFirst: jest.fn().mockResolvedValue(work) },
    storyRelease: { findFirst: jest.fn().mockResolvedValue(release) },
    storyProgressRouteNode: { findFirst: jest.fn().mockResolvedValue(route) },
    storyChoiceEvent: { findFirst: jest.fn().mockResolvedValue(event) },
    storyEndingDiscovery: { findFirst: jest.fn().mockResolvedValue({ id: 'discovery' }) },
    storyScene: { findFirst: jest.fn().mockResolvedValue(scene) },
    storyPart: { findFirst: jest.fn().mockResolvedValue(part) },
    userEntitlement: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const read = () => canonicalEndingPosition(db as unknown as Prisma.TransactionClient, progress);
  return { db, progress, route, event, scene, work, part, read };
}

describe('canonical ending position evidence', () => {
  it('keeps the source scene of a key-only authored ending without rewriting route identity', async () => {
    const f = fixture();
    expect(await f.read()).toEqual({ sceneId: 'source', endingType: 'author_main', routeNodeId: 'node' });
    expect(f.route.targetSceneId).toBeNull();
    expect(f.db.storyWork.findFirst).toHaveBeenCalledWith({ where: { id: 'work', status: 'published',
      fixtureSource: false, activeReleaseId: 'release', publishedVersion: 1 } });
    expect(f.db.storyChoiceEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      progressId: 'progress', sceneId: 'source', choiceId: 'choice', targetSceneId: null,
      endingKey: 'author_main', endingType: { in: ['author_main', 'author_sub'] }, invalidatedAt: null, resetCommandId: null } }));
    expect(f.db.storyEndingDiscovery.findFirst).toHaveBeenCalledWith({ where: { userId: 'reader', workId: 'work',
      releaseId: 'release', endingKey: 'author_main', endingKind: 'author_main', provenance: 'writer_original',
      pathSignature: storyPathSignature(f.progress.pathSummary) } });
  });
  it('uses an explicitly targeted authored ending scene instead of the preceding source', async () => {
    const f = fixture();
    f.progress.currentSceneId = f.scene.id = f.route.targetSceneId = 'target';
    f.scene.endingType = f.event.endingType = 'author_sub';
    expect(await f.read()).toEqual({ sceneId: 'target', endingType: 'author_sub', routeNodeId: 'node' });
  });
  it('reads a scene-only authored ending without inventing a gallery key or discovery', async () => {
    const f = fixture();
    f.progress.currentSceneId = f.scene.id = f.route.targetSceneId = 'target';
    f.route.endingKey = null;
    f.scene.endingType = f.event.endingType = 'author_sub';
    expect(await f.read()).toEqual({ sceneId: 'target', endingType: 'author_sub', routeNodeId: 'node' });
    expect(f.db.storyEndingDiscovery.findFirst).not.toHaveBeenCalled();
  });
  it('recovers a missing legacy canonical pointer only for an explicit read-only projection request', async () => {
    const f = fixture();
    f.progress.currentSceneId = null as never;
    expect(await f.read()).toBeNull();
    expect(await canonicalEndingPosition(f.db as unknown as Prisma.TransactionClient, f.progress, true))
      .toEqual({ sceneId: 'source', endingType: 'author_main', routeNodeId: 'node' });
    expect(f.progress.currentSceneId).toBeNull();
  });
  it.each(['work', 'part'] as const)('requires current reader access for paid %s ending prose', async scope => {
    const f = fixture();
    f[scope].priceLumina = new Prisma.Decimal(10);
    expect(await f.read()).toBeNull();
    f.db.userEntitlement.findFirst.mockResolvedValue({ id: 'access' });
    expect(await f.read()).toMatchObject({ sceneId: 'source' });
    expect(f.db.userEntitlement.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      userId: 'reader', referenceId: { in: ['work', 'part'] }, revokedAt: null,
    }) }));
  });
  it.each(['active', 'pending', 'scene', 'generated', 'release', 'node', 'path'] as const)
  ('rejects missing or ineligible progress %s before querying', async kind => {
    const f = fixture();
    if (kind === 'active') f.progress.status = 'active';
    if (kind === 'pending') f.progress.status = 'ai_pending';
    if (kind === 'scene') f.progress.currentSceneId = null as never;
    if (kind === 'generated') f.progress.currentGeneratedSceneId = 'generated' as never;
    if (kind === 'release') f.progress.activeReleaseId = null as never;
    if (kind === 'node') f.progress.routeNodeId = null as never;
    if (kind === 'path') f.progress.pathSummary = {} as never;
    expect(await f.read()).toBeNull();
    expect(f.db.storyWork.findFirst).not.toHaveBeenCalled();
  });
  it.each(['storyWork', 'storyRelease', 'storyProgressRouteNode', 'storyChoiceEvent', 'storyEndingDiscovery', 'storyScene', 'storyPart'] as const)
  ('requires persisted %s evidence', async key => {
    const f = fixture();
    f.db[key].findFirst.mockResolvedValue(null);
    expect(await f.read()).toBeNull();
  });
  it.each(['key', 'source', 'choice', 'target', 'ending-type'] as const)
  ('fails closed on mismatched %s', async kind => {
    const f = fixture();
    if (kind === 'key') f.route.endingKey = null;
    if (kind === 'source') f.route.sourceSceneId = null as never;
    if (kind === 'choice') f.route.sourceChoiceId = null as never;
    if (kind === 'target') f.route.targetSceneId = 'another-scene';
    if (kind === 'ending-type') f.scene.endingType = 'ai_generated';
    expect(await f.read()).toBeNull();
  });
});

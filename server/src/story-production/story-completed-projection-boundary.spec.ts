import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StoryProductionService } from './story-production.service';
import { storyPathSignature } from './story-lifecycle.policy';

function fixture(generated = false) {
  const progress = { id: 'progress', userId: 'reader', workId: 'work', status: 'completed',
    activeReleaseId: 'release' as string | null, storyVersion: 1, progressRevision: 7, currentAct: 1,
    routeNodeId: 'route' as string | null, currentSceneId: generated ? null : 'ending' as string | null,
    currentGeneratedSceneId: generated ? 'generated' : null as string | null, currentBeatPosition: 0,
    pathSummary: [{ sceneId: 'source', choiceId: 'choice', nextSceneId: 'ending' }] };
  const state = {
    progress,
    work: { id: 'work', ownerUserId: 'reader', status: 'published', fixtureSource: false,
      activeReleaseId: 'release', publishedVersion: 1, defaultLocale: 'ko', priceLumina: new Prisma.Decimal(0) },
    release: { id: 'release', workId: 'work', status: 'active', version: 1 },
    route: { id: 'route', progressId: 'progress', workId: 'work', releaseId: 'release', stepKind: 'canonical',
      sourceSceneId: 'source', sourceChoiceId: 'choice', targetSceneId: 'ending', endingKey: 'author-main' },
    event: { progressId: 'progress', sceneId: 'source', choiceId: 'choice', targetSceneId: 'ending',
      endingKey: 'author-main', endingType: 'author_main', invalidatedAt: null, resetCommandId: null },
    discovery: { userId: 'reader', workId: 'work', releaseId: 'release', endingKey: 'author-main',
      endingKind: 'author_main', provenance: 'writer_original', pathSignature: storyPathSignature(progress.pathSummary) },
    scene: { id: 'ending', partId: 'part', status: 'published', fixtureSource: false, endingType: 'author_main' },
    part: { id: 'part', workId: 'work', status: 'published', fixtureSource: false, priceLumina: new Prisma.Decimal(0),
      seasonKey: 'season-1', actNumber: 1, position: 1, title: { ko: 'Synthetic part' } },
    generated: { id: 'generated', userId: 'reader', workId: 'work', progressId: 'progress',
      releaseId: 'release', sourcePartId: 'part', sceneKey: 'synthetic-ending', status: 'ready', endingType: 'ai_generated',
      title: { ko: 'Synthetic ending' }, visualManifest: { sceneKey: 'synthetic-ending',
        background: { state: 'fallback', altKey: 'story.visual.fallback' }, characters: [],
        fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' } } },
  };
  const matches = (row: Record<string, any>, where: Record<string, any>) => Object.entries(where)
    .every(([key, value]) => value === undefined ||
      (value && typeof value === 'object' && 'in' in value ? value.in.includes(row[key]) : row[key] === value));
  const first = (row: () => Record<string, any>) => jest.fn(async ({ where }: any) =>
    matches(row(), where) ? { ...row() } : null);
  const noWrite = jest.fn(() => { throw new Error('Read-only projection attempted a write'); });
  const prisma = {
    storyReaderProgress: { findFirst: first(() => state.progress), updateMany: noWrite },
    storyWork: { findFirst: first(() => state.work) }, storyRelease: { findFirst: first(() => state.release) },
    storyProgressRouteNode: { findFirst: first(() => state.route) }, storyChoiceEvent: { findFirst: first(() => state.event) },
    storyEndingDiscovery: { findFirst: first(() => state.discovery) }, storyScene: { findFirst: first(() => state.scene) },
    storyPart: { findFirst: first(() => state.part) }, storyAiGeneratedScene: { findFirst: first(() => state.generated) },
    storyAiGeneratedBeat: { findMany: jest.fn(async () => [{ id: 'beat', position: 1, beatType: 'paragraph',
      content: { ko: 'Synthetic ending text.' } }]) }, storyAiGeneratedChoice: { findMany: jest.fn(async () => []) },
    userEntitlement: { findFirst: jest.fn(async () => null) }, $transaction: noWrite,
  };
  const visuals = { variantKeyForProgress: jest.fn(async () => 'default'),
    readyVisuals: jest.fn(async () => new Map([['synthetic-ending', { sourceSceneKey: 'synthetic-ending',
      publicAssetPath: '/assets/story/ending.webp' }]])), promptKeys: jest.fn(async () => new Set<string>()) };
  const service = new StoryProductionService(prisma as never, undefined, undefined, undefined, undefined, visuals as never);
  const canonicalProjection = jest.spyOn(service as any, 'sceneProjection').mockImplementation(async (p: any) => ({
    progressId: p.id, status: p.status, revision: p.progressRevision, currentBeatPosition: p.currentBeatPosition,
    scene: { id: p.currentSceneId, endingType: 'author_main' }, choices: [],
  }));
  const get = () => service.currentProgress('reader', 'progress', 'ko');
  return { state, prisma, visuals, noWrite, service, canonicalProjection, get };
}

describe('completed ending GET projection boundaries', () => {
  it.each(['no-scenes-no-route', 'canonical-no-route', 'old-canonical-release', 'old-canonical-version',
    'missing-event', 'missing-discovery', 'ambiguous-scenes', 'missing-release'])(
    'rejects %s without a completion projection or writes', async kind => {
      const f = fixture();
      if (kind === 'no-scenes-no-route') f.state.progress.currentSceneId = f.state.progress.routeNodeId = null;
      if (kind === 'canonical-no-route') f.state.progress.routeNodeId = null;
      if (kind === 'old-canonical-release') f.state.work.activeReleaseId = 'new-release';
      if (kind === 'old-canonical-version') f.state.work.publishedVersion++;
      if (kind === 'missing-event') f.state.event.invalidatedAt = new Date() as never;
      if (kind === 'missing-discovery') f.state.discovery.pathSignature = 'changed';
      if (kind === 'ambiguous-scenes') f.state.progress.currentGeneratedSceneId = 'generated';
      if (kind === 'missing-release') f.state.progress.activeReleaseId = null;
      const before = JSON.stringify(f.state);
      await expect(f.get()).rejects.toMatchObject({ response: { code: 'STORY_COMPLETED_ENDING_UNAVAILABLE' } });
      expect(f.canonicalProjection).not.toHaveBeenCalled(); expect(f.noWrite).not.toHaveBeenCalled();
      expect(f.visuals.readyVisuals).not.toHaveBeenCalled(); expect(JSON.stringify(f.state)).toBe(before);
    });

  it.each([false, true])('projects evidenced canonical ending with missing pointer=%s, without repair', async missing => {
    const f = fixture(); f.state.progress.currentBeatPosition = 1;
    if (missing) f.state.progress.currentSceneId = null;
    const before = JSON.stringify(f.state);
    await expect(f.get()).resolves.toMatchObject({ status: 'completed', scene: { id: 'ending' },
      currentBeatPosition: missing ? 0 : 1, revision: 7 });
    expect(JSON.stringify(f.state)).toBe(before); expect(f.noWrite).not.toHaveBeenCalled();
    expect(f.prisma.storyEndingDiscovery.findFirst).toHaveBeenCalledTimes(1);
  });

  it.each(['old-release', 'old-version', 'wrong-owner', 'not-ending', 'release-inactive', 'release-version'])(
    'rejects generated %s before artwork or text delivery', async kind => {
      const f = fixture(true);
      if (kind === 'old-release') f.state.work.activeReleaseId = 'new-release';
      if (kind === 'old-version') f.state.work.publishedVersion++;
      if (kind === 'wrong-owner') f.state.generated.userId = 'other';
      if (kind === 'not-ending') f.state.generated.endingType = 'not-an-ending';
      if (kind === 'release-inactive') f.state.release.status = 'revoked';
      if (kind === 'release-version') f.state.release.version++;
      const before = JSON.stringify(f.state);
      await expect(f.get()).rejects.toBeInstanceOf(kind.startsWith('release-') ? ConflictException : NotFoundException);
      expect(f.noWrite).not.toHaveBeenCalled(); expect(f.visuals.readyVisuals).not.toHaveBeenCalled();
      expect(f.prisma.storyAiGeneratedBeat.findMany).not.toHaveBeenCalled(); expect(JSON.stringify(f.state)).toBe(before);
    });

  it.each(['ready', 'pending', 'unavailable'])('preserves current generated %s paired delivery without declaring it read', async delivery => {
    const f = fixture(true);
    if (delivery !== 'ready') f.visuals.readyVisuals.mockResolvedValue(new Map());
    if (delivery === 'pending') f.visuals.promptKeys.mockResolvedValue(new Set(['synthetic-ending']));
    const before = JSON.stringify(f.state);
    await expect(f.get()).resolves.toMatchObject({ status: 'completed', currentBeatPosition: 0, revision: 7,
      scene: { deliveryState: delivery === 'ready' ? 'ready' : `artwork_${delivery}`,
        endingType: delivery === 'ready' ? 'ai_generated' : null }, choices: [] });
    expect(JSON.stringify(f.state)).toBe(before); expect(f.noWrite).not.toHaveBeenCalled();
  });

  it('leaves the ordinary active projection policy unchanged', async () => {
    const f = fixture(); f.state.progress.status = 'active'; f.state.progress.routeNodeId = null;
    await expect(f.get()).resolves.toMatchObject({ status: 'active' });
    expect(f.prisma.storyEndingDiscovery.findFirst).not.toHaveBeenCalled(); expect(f.noWrite).not.toHaveBeenCalled();
  });
});

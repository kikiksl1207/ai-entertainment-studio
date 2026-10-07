import { assembleContinuationSemanticPath } from './story-continuation-context.policy';
import { assembleContinuationRouteContinuity } from './story-continuation-route-continuity';

type Row = Record<string, any>;
const input = { locale: 'en', userId: 'reader', workId: 'own-work', releaseId: 'release', progressId: 'progress' };
const ownPart = { id: 'own-part', workId: input.workId, status: 'published', fixtureSource: false };
const foreignPart = { ...ownPart, id: 'foreign-part', workId: 'different-work' };
const source = { id: 'source', partId: ownPart.id, status: 'published', fixtureSource: false,
  title: { en: 'Read own scene' }, endingType: null };
const target = { ...source, id: 'target', title: { en: 'Own target' } };
const foreign = { ...source, id: 'foreign', partId: foreignPart.id, title: { en: 'Foreign material' } };
const choice = { id: 'choice', sceneId: source.id, label: { en: 'Keep the promise' },
  targetEndingKey: null, declaredRejoinSceneId: null };

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => value === undefined ||
    (value && typeof value === 'object' && 'in' in value ? value.in.includes(row[key]) : row[key] === value));
}

function fixture({ parts = [ownPart, foreignPart], scenes = [source, target, foreign],
  selectedChoice = choice, step = { sceneId: source.id, choiceId: choice.id, nextSceneId: target.id } }: {
    parts?: Row[]; scenes?: Row[]; selectedChoice?: Row; step?: Row;
  } = {}) {
  const delegate = (rows: Row[]) => ({ findMany: jest.fn(async ({ where }: Row) => rows.filter(row => matches(row, where))) });
  const prisma = { storyPart: delegate(parts), storyScene: delegate(scenes), storyChoice: delegate([selectedChoice]),
    storyCustomChoice: delegate([]), storyAiGeneratedScene: delegate([]), storyAiGeneratedChoice: delegate([]),
    storyAiGeneratedBeat: delegate([]), $queryRaw: jest.fn(async () => [{ depth: 1, narrative_step: step }]) };
  return { prisma, path: [step] };
}

describe('canonical continuation material belongs to the current published work', () => {
  it.each(['semantic', 'continuity'] as const)('retains the valid own-work %s projection', async (kind) => {
    const f = fixture();
    const value = kind === 'semantic'
      ? await assembleContinuationSemanticPath(f.prisma, { ...input, pathSummary: f.path })
      : await assembleContinuationRouteContinuity(f.prisma, { ...input, routeNodeId: 'route', pathSummary: f.path });
    if (kind === 'semantic') expect(value).toEqual([{ sourceTitle: 'Read own scene', choiceLabel: 'Keep the promise',
      targetTitle: 'Own target', explicitRejoin: false, endingType: null }]);
    else expect(value).toEqual({ version: 'story-route-continuity-v1', actions: [{ step: 1, choiceLabel: 'Keep the promise' }],
      readEvidence: [] });
  });

  it.each(['semantic', 'continuity'] as const)('rejects foreign canonical source from stored %s history', async (kind) => {
    const f = fixture({ step: { sceneId: foreign.id, choiceId: choice.id, nextSceneId: target.id },
      selectedChoice: { ...choice, sceneId: foreign.id } });
    const pending = kind === 'semantic'
      ? assembleContinuationSemanticPath(f.prisma, { ...input, pathSummary: f.path })
      : assembleContinuationRouteContinuity(f.prisma, { ...input, routeNodeId: 'route', pathSummary: f.path });
    await expect(pending).rejects.toThrow(kind === 'semantic' ? 'semantic_path_changed' : 'route_continuity_invalid');
  });

  it('rejects a foreign canonical destination even when its source and choice are own-work', async () => {
    const f = fixture({ step: { sceneId: source.id, choiceId: choice.id, nextSceneId: foreign.id } });
    await expect(assembleContinuationSemanticPath(f.prisma, { ...input, pathSummary: f.path }))
      .rejects.toThrow('semantic_path_changed');
  });

  it.each(['archived', 'fixture'] as const)('rejects canonical scenes whose parent is %s', async (kind) => {
    const part = { ...ownPart, ...(kind === 'archived' ? { status: 'archived' } : { fixtureSource: true }) };
    const f = fixture({ parts: [part] });
    await expect(assembleContinuationSemanticPath(f.prisma, { ...input, pathSummary: f.path }))
      .rejects.toThrow('semantic_path_changed');
    await expect(assembleContinuationRouteContinuity(f.prisma, { ...input, routeNodeId: 'route', pathSummary: f.path }))
      .rejects.toThrow('route_continuity_invalid');
  });

  it.each(['semantic', 'continuity'] as const)('limits the %s scene read by verified own published part IDs', async (kind) => {
    const f = fixture();
    if (kind === 'semantic') await assembleContinuationSemanticPath(f.prisma, { ...input, pathSummary: f.path });
    else await assembleContinuationRouteContinuity(f.prisma, { ...input, routeNodeId: 'route', pathSummary: f.path });
    expect(f.prisma.storyPart.findMany).toHaveBeenCalledTimes(1);
    expect(f.prisma.storyPart.findMany).toHaveBeenCalledWith({ where: {
      workId: input.workId, status: 'published', fixtureSource: false }, select: { id: true } });
    expect(f.prisma.storyScene.findMany.mock.calls[0][0].where.partId).toEqual({ in: [ownPart.id] });
  });

  it('does not introduce a canonical-part read for an empty semantic path', async () => {
    const f = fixture();
    expect(await assembleContinuationSemanticPath(f.prisma, { ...input, pathSummary: [] })).toEqual([]);
    expect(f.prisma.storyPart.findMany).not.toHaveBeenCalled();
  });
});

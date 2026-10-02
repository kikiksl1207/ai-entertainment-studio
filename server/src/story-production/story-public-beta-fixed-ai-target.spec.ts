import { StoryPublicBetaAiActivationService } from './story-public-beta-ai-activation.service';
import { StoryFixedRouteChoiceRefreshService } from './story-fixed-route-choice-refresh.service';

const target = {
  workId: '10000000-0000-4000-8000-000000000001',
  releaseId: '20000000-0000-4000-8000-000000000001',
};
const confirmations = {
  aiBranchGenerationConfirmed: true,
  authorStyleReferenceConfirmed: true,
  generatedResultReuseConfirmed: true,
  imageTransformationConfirmed: true,
} as const;
const slugs = {
  monster: 'the-monster-that-did-not-eat-my-name',
  rebellion: 'we-wrote-rebellion-on-each-others-bodies',
};

function fixture(storyKey: keyof typeof slugs, activeReleaseId = target.releaseId) {
  const work = { id: target.workId, slug: slugs[storyKey], status: 'published', fixtureSource: false,
    activeReleaseId, ownerUserId: 'owner' };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    storyWork: { findFirst: jest.fn().mockResolvedValue(work), findUnique: jest.fn().mockResolvedValue(work) },
    storyRelease: { findFirst: jest.fn().mockResolvedValue({ id: target.releaseId, checksum: 'a'.repeat(64) }) },
    storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue({ id: 'manuscript' }) },
    storyPart: { findMany: jest.fn().mockResolvedValue([{ id: 'part', position: 1, title: { ko: 'Part' } }]) },
    storyReaderProgress: { updateMany: jest.fn() }, storyAiAllowanceBucket: { updateMany: jest.fn() },
    auditEvent: { create: jest.fn() },
  };
  const prisma = { $transaction: jest.fn(async (callback: (db: typeof tx) => Promise<unknown>) => callback(tx)) };
  const legal = { createActivation: jest.fn().mockResolvedValue({ id: 'activation' }) };
  const service = new StoryPublicBetaAiActivationService(prisma as never, legal as never);
  for (const [method, value] of [
    ['ensureRateCard', { id: 'rate', version: 'v1' }], ['ensureStyleSnapshot', { id: 'analysis' }],
    ['ensureConsent', { id: 'consent', revision: 1 }], ['ensureRights', { id: 'rights' }],
    ['ensureCapability', { revision: 1, includedAiRouteCount: 3 }], ['latestValidActivation', null],
  ] as const) jest.spyOn(service as never, method as never).mockResolvedValue(value as never);
  return { service, tx, legal };
}

describe('fixed story staged AI results retain their selected work and release', () => {
  afterEach(() => jest.restoreAllMocks());

  for (const storyKey of ['monster', 'rebellion'] as const) {
    it.each(['preparing', 'awaiting_promotion'] as const)('%s returns the exact pair without enabling legal AI activation', async phase => {
      const { service, tx, legal } = fixture(storyKey);
      const progress = { totalParts: 2, preparedParts: phase === 'preparing' ? 1 : 2,
        remainingParts: phase === 'preparing' ? 1 : 0, ready: false, phase, publicChoiceSet: 'legacy' as const };
      const refresh = jest.spyOn(StoryFixedRouteChoiceRefreshService.prototype, 'refreshBatch').mockResolvedValue(progress);
      expect(await service.activate('operator', storyKey, { ...target, ...confirmations })).toEqual({
        ...target, storyKey, status: 'preparing_choices', active: false,
        totalParts: progress.totalParts, preparedParts: progress.preparedParts,
        remainingParts: progress.remainingParts, phase,
      });
      expect(tx.storyWork.findFirst).toHaveBeenCalledWith({ where: {
        id: target.workId, slug: slugs[storyKey], status: 'published', fixtureSource: false,
      } });
      expect(refresh).toHaveBeenCalledWith('operator', storyKey, target.workId, target.releaseId);
      expect(legal.createActivation).not.toHaveBeenCalled();
    });

    it(`${storyKey} preserves the legacy unscoped response contract`, async () => {
      const { service, tx } = fixture(storyKey);
      jest.spyOn(StoryFixedRouteChoiceRefreshService.prototype, 'refreshBatch').mockResolvedValue({
        totalParts: 2, preparedParts: 1, remainingParts: 1, ready: false,
        phase: 'preparing', publicChoiceSet: 'legacy',
      });
      const result = await service.activate('operator', storyKey, confirmations);
      expect(result).not.toHaveProperty('workId'); expect(result).not.toHaveProperty('releaseId');
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(tx.storyWork.findUnique).toHaveBeenCalledWith({ where: { slug: slugs[storyKey] } });
    });

    it(`${storyKey} rejects a changed selected release before approval or provider preparation`, async () => {
      const { service, tx, legal } = fixture(storyKey, 'changed-release');
      const refresh = jest.spyOn(StoryFixedRouteChoiceRefreshService.prototype, 'refreshBatch');
      await expect(service.activate('operator', storyKey, { ...target, ...confirmations })).rejects.toMatchObject({
        response: { code: 'STORY_PUBLICATION_CHOICE_SOURCE_CHANGED' },
      });
      expect(tx.storyRelease.findFirst).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled(); expect(legal.createActivation).not.toHaveBeenCalled();
    });
  }
});

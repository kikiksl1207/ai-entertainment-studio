import { StoryEconomicsService } from './story-economics.service';
import type { StoryContinuationApprovedContext } from './story-continuation-context.assembler';

describe('approved-result reuse sibling guard', () => {
  it('rejects an exact narrative collision before creating a reused reader scene', async () => {
    const createContinuation = jest.fn();
    const createScene = jest.fn();
    const tx = {
      storyAiReusableBeat: { findMany: jest.fn().mockResolvedValue([
        { position: 1, beatType: 'paragraph', content: { ko: '같은 사건.' } },
      ]) },
      storyAiReusableChoice: { findMany: jest.fn().mockResolvedValue([
        { position: 1, choiceKey: 'next', label: { ko: '계속' } },
      ]) },
      storyAiAllowanceBucket: { findUnique: jest.fn().mockResolvedValue({ id: 'allowance-id' }) },
      storyAiContinuation: { create: createContinuation },
      storyAiGeneratedScene: { create: createScene },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const prepared = {
      input: { work: { id: 'work-id' }, release: { id: 'release-id', checksum: 'release-checksum' } },
      sharedResult: {
        id: 'shared-result-id', status: 'approved', workId: 'work-id', releaseId: 'release-id',
        releaseChecksum: 'release-checksum', resultChecksum: 'c'.repeat(64),
        title: { ko: '같은 장면' }, visualManifest: { sceneKey: 'source' }, endingKey: null,
      },
      siblingContextKey: 'a'.repeat(64), siblingChoiceKey: 'b'.repeat(64),
      approvedContext: {
        sourceScene: { title: 'Synthetic approved source', beats: [
          { beatType: 'paragraph', content: 'A different source event.' },
        ] },
        selectedChoice: { label: 'Continue the synthetic route' }, path: [], memories: [],
      } satisfies StoryContinuationApprovedContext,
      locale: 'ko',
    };
    const service = new StoryEconomicsService({} as never);
    const applyReuse = Reflect.get(service, 'applyReusableResultTx') as
      (tx: unknown, prepared: unknown) => Promise<unknown>;
    await expect(applyReuse.call(service, tx, prepared)).rejects.toMatchObject({
      code: 'continuation_sibling_narrative_duplicate',
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(createContinuation).not.toHaveBeenCalled();
    expect(createScene).not.toHaveBeenCalled();
  });
});

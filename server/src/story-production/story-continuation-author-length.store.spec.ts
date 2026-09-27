import { authoredPartContinuationLengthBounds } from './story-continuation-author-length.store';

describe('authored part length reference', () => {
  it('counts published canonical beats across scenes instead of the previous generated scene', async () => {
    const db = {
      storyScene: { findMany: jest.fn().mockResolvedValue([{ id: 'scene-a' }, { id: 'scene-b' }]) },
      storyBeat: { findMany: jest.fn().mockResolvedValue([
        { beatType: 'paragraph', content: { ko: '가'.repeat(3_000) } },
        { beatType: 'scene_break', content: { ko: '---' } },
        { beatType: 'dialogue', content: { ko: '나'.repeat(4_000) } },
      ]) },
    };
    await expect(authoredPartContinuationLengthBounds(db as never, 'part-id', 'ko'))
      .resolves.toMatchObject({ referenceUnits: 7_000, minUnits: 5_600, maxUnits: 8_400 });
    expect(db.storyScene.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { partId: 'part-id', status: 'published', fixtureSource: false },
    }));
    expect(db.storyBeat.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { sceneId: { in: ['scene-a', 'scene-b'] } },
    }));
  });
});

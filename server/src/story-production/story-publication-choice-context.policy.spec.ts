import { assertSamePublishedChoicePreparationContext, PublishedChoicePreparationContext,
  readPublishedChoicePreparationContext } from './story-publication-choice-context.policy';
import { releaseChecksum } from './story-lifecycle.policy';

function context(): PublishedChoicePreparationContext {
  return { version: 'published-choice-exact-scope-v1', workId: 'work', releaseId: 'release',
    parts: [1, 9, 17].map(position => ({ partId: `part-id-${position}`, partKey: `part-${position}`,
      sceneId: `scene-${position}`, title: `Chapter ${position}` })),
    sourceDigest: 'a'.repeat(64), generationProfileBinding: null };
}
function batch(value = context()) {
  return { workId: value.workId, releaseId: value.releaseId, firstPartPosition: 1,
    preparationContext: value, preparationContextSha256: releaseChecksum(value) };
}

describe('Published choice exact preparation scope', () => {
  it('retains non-contiguous identities without constructing an eight-part range', () => {
    expect(readPublishedChoicePreparationContext(batch()).parts.map(part => part.partKey))
      .toEqual(['part-1', 'part-9', 'part-17']);
    expect(() => assertSamePublishedChoicePreparationContext(batch(), context())).not.toThrow();
  });
  it.each(['missing', 'hash', 'version', 'first', 'duplicate-part', 'duplicate-scene', 'order', 'empty', 'too-many',
    'key', 'source', 'profile'] as const)('blocks an unverifiable %s context even before any recovery', fault => {
    const saved: any = batch();
    if (fault === 'missing') { saved.preparationContext = null; saved.preparationContextSha256 = null; }
    if (fault === 'hash') saved.preparationContextSha256 = 'b'.repeat(64);
    if (fault === 'first') saved.firstPartPosition = 2;
    const value = saved.preparationContext;
    if (fault === 'version') value.version = 'legacy-contiguous';
    if (fault === 'duplicate-part') value.parts[1].partId = value.parts[0].partId;
    if (fault === 'duplicate-scene') value.parts[1].sceneId = value.parts[0].sceneId;
    if (fault === 'order') value.parts.reverse();
    if (fault === 'empty') value.parts = [];
    if (fault === 'too-many') value.parts = Array.from({ length: 9 }, (_, index) => ({
      partId: `p${index}`, sceneId: `s${index}`, partKey: `part-${index + 1}`, title: 'Test' }));
    if (fault === 'key') value.parts[1].partKey = 'part-NaN';
    if (fault === 'source') value.sourceDigest = 'unverifiable';
    if (fault === 'profile') delete value.generationProfileBinding;
    if (value && fault !== 'hash') saved.preparationContextSha256 = releaseChecksum(value);
    expect(() => readPublishedChoicePreparationContext(saved)).toThrow(expect.objectContaining({
      response: expect.objectContaining({ code: 'STORY_CHOICE_PREPARATION_CONTEXT_REQUIRED' }),
    }));
  });
  it.each(['part', 'scene', 'title', 'source', 'release', 'profile'] as const)
    ('does not transfer a reviewed retry to changed %s settings', changed => {
      const current = context();
      if (changed === 'part') current.parts[1].partKey = 'part-10';
      if (changed === 'scene') current.parts[1].sceneId = 'other-scene';
      if (changed === 'title') current.parts[1].title = 'Edited title';
      if (changed === 'source') current.sourceDigest = 'c'.repeat(64);
      if (changed === 'release') current.releaseId = 'new-release';
      if (changed === 'profile') current.generationProfileBinding = { workId: 'work',
        generationProfilePin: { approvedAt: 'changed' } } as never;
      expect(() => assertSamePublishedChoicePreparationContext(batch(), current)).toThrow(expect.objectContaining({
        response: expect.objectContaining({ code: 'STORY_CHOICE_PREPARATION_CONTEXT_CHANGED' }),
      }));
    });
});

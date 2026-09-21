import { appendStoryRouteHash, storyRouteRootHash } from './story-route-identity.policy';

const root = { workId: 'work', releaseId: 'release', releaseChecksum: 'checksum', manuscriptVersionId: 'manuscript', entrySceneId: 'entry' };
const step = (choiceId: string) => ({ kind: 'canonical' as const, sceneId: 'source', choiceId, targetSceneId: 'rejoin', endingKey: null });

describe('complete deterministic story route identity', () => {
  it('matches identical canonical decisions across users, ignoring personal/random IDs and labels', () => {
    const a = storyRouteRootHash({ ...root, userId: 'alice' } as typeof root);
    const b = storyRouteRootHash({ ...root, userId: 'bob' } as typeof root);
    expect(a).toBe(b);
    expect(appendStoryRouteHash(a, { ...step('choice-a'), label: 'Same', progressId: 'one' } as ReturnType<typeof step>))
      .toBe(appendStoryRouteHash(b, { ...step('choice-a'), label: 'Different', progressId: 'two' } as ReturnType<typeof step>));
  });

  it('retains early different choice IDs after 25 identical choices and a canonical rejoin', () => {
    let a = appendStoryRouteHash(storyRouteRootHash(root), step('early-a'));
    let b = appendStoryRouteHash(storyRouteRootHash(root), step('early-b'));
    for (let i = 0; i < 25; i++) {
      a = appendStoryRouteHash(a, step(`same-${i}`));
      b = appendStoryRouteHash(b, step(`same-${i}`));
    }
    expect(a).not.toBe(b);
  });

  it('distinguishes same-label choices and choice order', () => {
    const seed = storyRouteRootHash(root);
    expect(appendStoryRouteHash(seed, step('a'))).not.toBe(appendStoryRouteHash(seed, step('b')));
    expect(appendStoryRouteHash(appendStoryRouteHash(seed, step('a')), step('b')))
      .not.toBe(appendStoryRouteHash(appendStoryRouteHash(seed, step('b')), step('a')));
  });

  it('uses shared source IDs and choice keys, never personal generated scene IDs', () => {
    const shared = { kind: 'shared' as const, sharedResultId: 'approved-source', choiceKey: 'next', endingKey: null };
    const seed = storyRouteRootHash(root);
    const a = { ...shared, generatedSceneId: 'personal-one' };
    const b = { ...shared, generatedSceneId: 'personal-two' };
    expect(appendStoryRouteHash(seed, a)).toBe(appendStoryRouteHash(seed, b));
    expect(appendStoryRouteHash(seed, shared)).not.toBe(appendStoryRouteHash(seed, { ...shared, choiceKey: 'other' }));
  });

  it('never reconstructs unknown legacy or private ancestry from a recent suffix', () => {
    expect(appendStoryRouteHash(null, step('a'))).toBeNull();
    const privatePath = appendStoryRouteHash(storyRouteRootHash(root), { kind: 'private' });
    expect(appendStoryRouteHash(privatePath, step('a'))).toBeNull();
    expect(storyRouteRootHash({ ...root, releaseChecksum: 'new-release' })).not.toBe(storyRouteRootHash(root));
  });
});

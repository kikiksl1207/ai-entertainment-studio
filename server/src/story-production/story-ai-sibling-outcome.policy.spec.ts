import type { StoryContinuationApprovedContext } from './story-continuation-context.assembler';
import { storyAiNarrativeChecksum, storyAiSiblingChoiceKey, storyAiSiblingContextKey } from './story-ai-sibling-outcome.policy';

const context: StoryContinuationApprovedContext = {
  sourceScene: { title: 'Crossroads', beats: [{ beatType: 'paragraph', content: 'The ship is leaving.' }] },
  selectedChoice: { label: 'Board the ship' },
  path: [],
  memories: [{ memoryType: 'style', content: 'Brief, vivid scenes.' }],
};
const source = { kind: 'canonical' as const, sceneId: 'scene-a' };
const base = {
  workId: 'work-a', releaseId: 'release-a', releaseChecksum: 'release-checksum',
  manuscriptVersionId: 'manuscript-a', source,
  route: { kind: 'shared' as const, hash: 'route-a' }, locale: 'en',
  promptVersion: 'story-continuation-v7', outputSchemaVersion: 'story-continuation-output-v1',
  approvedContext: context, pins: { memoryPins: ['memory-a'], participantPin: null },
};

describe('exact sibling narrative identity', () => {
  it('uses one context key for distinct selected choices, but distinct choice keys', () => {
    const other = { ...context, selectedChoice: { label: 'Stay ashore' } };
    expect(storyAiSiblingContextKey({ ...base, approvedContext: other }))
      .toBe(storyAiSiblingContextKey(base));
    expect(storyAiSiblingChoiceKey(source, { id: 'choice-a', choiceKey: 'board' }))
      .not.toBe(storyAiSiblingChoiceKey(source, { id: 'choice-b', choiceKey: 'stay' }));
  });

  it('separates different participants, approved pins, routes, and private source scenes', () => {
    const key = storyAiSiblingContextKey(base);
    const participant = { artistId: 'artist-a', slug: 'artist-a', displayName: 'A', visualIdentityReady: true };
    expect(storyAiSiblingContextKey({ ...base, approvedContext: { ...context, participantArtist: participant } }))
      .not.toBe(key);
    expect(storyAiSiblingContextKey({ ...base, pins: { memoryPins: ['memory-b'], participantPin: null } }))
      .not.toBe(key);
    expect(storyAiSiblingContextKey({ ...base, route: { kind: 'shared', hash: 'route-b' } }))
      .not.toBe(key);
    expect(storyAiSiblingContextKey({ ...base, source: { kind: 'private', sceneId: 'scene-a' } }))
      .not.toBe(key);
  });

  it('keeps shared-result choice identity stable across readers with different generated choice IDs', () => {
    const shared = { kind: 'shared' as const, resultId: 'approved-result-a' };
    expect(storyAiSiblingChoiceKey(shared, { id: 'reader-a-choice', choiceKey: 'follow' }))
      .toBe(storyAiSiblingChoiceKey(shared, { id: 'reader-b-choice', choiceKey: 'follow' }));
    expect(storyAiSiblingChoiceKey(shared, { id: 'reader-a-choice', choiceKey: 'follow' }))
      .not.toBe(storyAiSiblingChoiceKey(shared, { id: 'reader-b-choice', choiceKey: 'wait' }));
  });

  it('compares narrative body even when a title or beat presentation changes', () => {
    const narrative = { title: { en: 'At dawn' },
      beats: [{ beatType: 'paragraph', content: { en: 'They met at the harbor.' } }] };
    const digest = storyAiNarrativeChecksum(narrative);
    const first = { ...narrative,
      visualManifest: { sceneKey: 'different' }, nextChoices: [{ label: 'Go left' }] };
    const second = { ...narrative,
      visualManifest: { sceneKey: 'another' }, nextChoices: [{ label: 'Go right' }] };
    expect(storyAiNarrativeChecksum(first)).toBe(digest);
    expect(storyAiNarrativeChecksum(second)).toBe(digest);
    expect(storyAiNarrativeChecksum({ title: { en: ' At  dawn ' },
      beats: [{ beatType: 'paragraph', content: { en: 'They met\n at the harbor.  ' } }] })).toBe(digest);
    expect(storyAiNarrativeChecksum({ ...narrative, title: { en: 'At dusk' } })).toBe(digest);
    expect(storyAiNarrativeChecksum({ ...narrative,
      beats: [{ beatType: 'dialogue', content: { en: 'They met at the harbor.' } }] })).toBe(digest);
    expect(storyAiNarrativeChecksum({ ...narrative,
      beats: [{ beatType: 'paragraph', content: { en: 'They met on the ship.' } }] })).not.toBe(digest);
  });
});

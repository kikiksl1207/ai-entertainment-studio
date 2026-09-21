import { storyAiResultChecksum } from './story-ai-result-checksum';

describe('reviewed story AI result checksum', () => {
  const output = {
    title: { ko: 'Title' }, beats: [{ beatType: 'paragraph', content: { ko: 'Body' } }],
    visualManifest: { sceneKey: 'scene', characters: [] },
    nextChoices: [{ choiceKey: 'next', label: { ko: 'Next' } }], ending: null,
  };

  it('hashes exactly the stored shape, ignoring row IDs/positions and normalizing choice keys', () => {
    const stored = {
      ...output,
      beats: [{ ...output.beats[0], id: 'row-id', position: 1 }],
      nextChoices: [{ ...output.nextChoices[0], choiceKey: ' next ', id: 'choice-id' }],
    };
    expect(storyAiResultChecksum(output)).toBe(storyAiResultChecksum(stored));
  });

  it.each(['title', 'beat', 'visual', 'choice', 'ending'])('invalidates a changed %s', (field) => {
    const changed = structuredClone(output) as any;
    if (field === 'title') changed.title.ko = 'Changed';
    if (field === 'beat') changed.beats[0].content.ko = 'Changed';
    if (field === 'visual') changed.visualManifest.sceneKey = 'changed';
    if (field === 'choice') changed.nextChoices[0].label.ko = 'Changed';
    if (field === 'ending') changed.ending = { endingKey: 'ai-ending' };
    expect(storyAiResultChecksum(changed)).not.toBe(storyAiResultChecksum(output));
  });

  it('round trips an ending-only result without inventing a choice', () => {
    const ending = { ...output, nextChoices: [], ending: { endingKey: 'ai-end' } };
    const { nextChoices: _choices, ...withoutChoices } = ending;
    expect(storyAiResultChecksum(ending)).toBe(storyAiResultChecksum(withoutChoices));
    expect(storyAiResultChecksum(ending)).not.toBe(storyAiResultChecksum(output));
  });
});

import {
  canApplyStoryEndingTransition,
  projectStoryEndingCompletion,
  STORY_ENDING_PROVENANCE_POLICY_BACKEND_CONTRACT,
  STORY_ENDING_PROVENANCE_VALUES,
} from './story-ending-provenance-contract';

describe('story ending provenance policy backend contract', () => {
  it('keeps author endings protected from AI overwrite', () => {
    expect(canApplyStoryEndingTransition('author_default', 'ai_generated')).toBe(
      false,
    );
    expect(canApplyStoryEndingTransition('author_sub', 'ai_generated')).toBe(
      false,
    );
    expect(canApplyStoryEndingTransition('ai_generated', 'ai_generated')).toBe(
      true,
    );
  });

  it('creates distinct completion signatures for distinct routes', () => {
    const base = {
      endingKey: 'ending-shared',
      provenance: 'author_sub' as const,
      stateSignatureKey: 'state-balanced',
    };
    const first = projectStoryEndingCompletion({
      ...base,
      routeSummaryKey: 'story.route.summary-a',
    });
    const second = projectStoryEndingCompletion({
      ...base,
      routeSummaryKey: 'story.route.summary-b',
    });

    expect(first.completionSignature).not.toBe(second.completionSignature);
    expect(first).not.toHaveProperty('provenance');
    expect(first.endingLabelKey).toBe(
      'storyStage.ending.provenance.authorSub',
    );
  });

  it('maps every internal provenance to locale-ready public label keys', () => {
    const labels =
      STORY_ENDING_PROVENANCE_POLICY_BACKEND_CONTRACT.localePolicy.labelKeys;
    expect(Object.keys(labels)).toEqual(STORY_ENDING_PROVENANCE_VALUES);
    expect(Object.values(labels)).not.toEqual(STORY_ENDING_PROVENANCE_VALUES);
    expect(
      Object.values(labels).every((key) =>
        key.startsWith('storyStage.ending.provenance.'),
      ),
    ).toBe(true);
  });
});

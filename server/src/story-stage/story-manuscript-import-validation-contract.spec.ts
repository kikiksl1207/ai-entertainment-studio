import {
  StoryManuscriptImportDraft,
  validateStoryManuscriptImport,
} from './story-manuscript-import-validation-contract';

function buildValidDraft(): StoryManuscriptImportDraft {
  return {
    parts: [
      {
        partKey: 'part-01',
        bodyCharacterCount: 10_000,
        branchSummaryCharacterCount: 1_200,
        sceneKeys: ['scene-start', 'scene-a', 'scene-b', 'scene-c'],
      },
    ],
    scenes: [
      { sceneKey: 'scene-start', backgroundKey: 'bg-start', characterKeys: ['lead'] },
      { sceneKey: 'scene-a', backgroundKey: 'bg-a', characterKeys: ['lead'] },
      { sceneKey: 'scene-b', backgroundKey: 'bg-b', characterKeys: ['guide'] },
      { sceneKey: 'scene-c', backgroundKey: 'bg-c', characterKeys: ['lead', 'guide'] },
    ],
    choices: ['a', 'b', 'c'].map((key) => ({
      choiceKey: `choice-${key}`,
      sourceSceneKey: 'scene-start',
      nextSceneKey: `scene-${key}`,
    })),
    endings: [
      {
        endingKey: 'ending-default',
        sourceSceneKey: 'scene-c',
        provenance: 'author_default',
      },
    ],
    backgroundKeys: ['bg-start', 'bg-a', 'bg-b', 'bg-c'],
    characterKeys: ['lead', 'guide'],
  };
}

describe('story writer manuscript import validation', () => {
  it('accepts a structured synthetic graph without storing manuscript text', () => {
    expect(validateStoryManuscriptImport(buildValidDraft())).toEqual({
      warnings: [],
      blockers: [],
      publishReady: true,
    });
  });

  it('keeps length deviations as warnings while blocking broken references', () => {
    const draft = buildValidDraft();
    draft.parts[0].bodyCharacterCount = 7_999;
    draft.parts[0].branchSummaryCharacterCount = 2_001;
    draft.choices[1].nextSceneKey = 'scene-missing';

    const result = validateStoryManuscriptImport(draft);
    expect(result.warnings).toEqual([
      'part_length_review:part-01',
      'branch_summary_length_review:part-01',
    ]);
    expect(result.blockers).toContain('dangling_route:choice-b');
    expect(result.publishReady).toBe(false);
  });

  it('blocks unmarked forced convergence and missing ending scenes', () => {
    const draft = buildValidDraft();
    draft.choices = draft.choices.map((choice) => ({
      ...choice,
      nextSceneKey: 'scene-a',
    }));
    draft.endings[0].sourceSceneKey = 'scene-ending-missing';

    const result = validateStoryManuscriptImport(draft);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        'forced_choice_convergence:scene-start',
        'ending_scene_missing:ending-default',
      ]),
    );
  });
});

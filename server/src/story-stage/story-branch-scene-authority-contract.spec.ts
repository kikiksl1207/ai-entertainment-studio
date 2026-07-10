import { STORY_BRANCH_SCENE_AUTHORITY_AUDIT_CONTRACT } from './story-branch-scene-authority-contract';

describe('story branch scene authority audit contract', () => {
  it('keeps A B C choices on distinct server-resolved next scenes before rejoin', () => {
    const routes = STORY_BRANCH_SCENE_AUTHORITY_AUDIT_CONTRACT.choiceRouteMatrix;
    const nextScenes = routes.map((route) => route.nextSceneKey);
    const backgrounds = routes.map((route) => route.backgroundKey);

    expect(routes).toHaveLength(3);
    expect(new Set(nextScenes).size).toBe(routes.length);
    expect(new Set(backgrounds).size).toBe(routes.length);
    expect(routes.every((route) => route.rejoinSceneKey === 'scene_after_showcase')).toBe(true);
    expect(STORY_BRANCH_SCENE_AUTHORITY_AUDIT_CONTRACT.validationRules).toMatchObject({
      allChoicesMayNotConvergeImmediately: true,
      nextSceneMustBeServerResolved: true,
      backgroundMustBelongToNextScene: true,
      characterPresenceMustBelongToNextScene: true,
      laterRejoinAllowed: true,
      branchLocalSceneAllowedBeforeRejoin: true,
    });
    expect(STORY_BRANCH_SCENE_AUTHORITY_AUDIT_CONTRACT.rejoinPolicy).toEqual({
      minimumDistinctScenesBeforeRejoin: 1,
      sameImmediateNextSceneAllowed: false,
      explicitRejoinSceneRequired: true,
    });
  });

  it('separates author default author sub and AI endings without provider or wallet mutation', () => {
    expect(STORY_BRANCH_SCENE_AUTHORITY_AUDIT_CONTRACT.endingTypePolicy).toMatchObject({
      allowedEndingTypes: ['author_default', 'author_sub', 'ai_generated'],
      clientSubmittedEndingTrusted: false,
      aiEndingRequiresExplicitBudgetGuard: true,
      rawEndingTypeReturned: false,
    });
    const endingTypePolicy =
      STORY_BRANCH_SCENE_AUTHORITY_AUDIT_CONTRACT.endingTypePolicy;
    expect(Object.keys(endingTypePolicy.publicLabelKeys)).toEqual(
      endingTypePolicy.allowedEndingTypes,
    );
    expect(Object.values(endingTypePolicy.publicLabelKeys)).toEqual([
      'storyStage.ending.authorDefault',
      'storyStage.ending.authorSub',
      'storyStage.ending.aiGenerated',
    ]);
    expect(Object.values(endingTypePolicy.publicLabelKeys)).not.toEqual(
      endingTypePolicy.allowedEndingTypes,
    );
    expect(STORY_BRANCH_SCENE_AUTHORITY_AUDIT_CONTRACT.mutationPolicy).toMatchObject({
      choiceSubmit: false,
      storyStateMutation: false,
      providerCall: false,
      walletMutation: false,
      settlementMutation: false,
      payoutMutation: false,
    });
    expect(STORY_BRANCH_SCENE_AUTHORITY_AUDIT_CONTRACT.forbiddenOutput).toEqual(
      expect.arrayContaining([
        'raw author note',
        'provider prompt',
        'provider payload',
        'hidden future scene body',
      ]),
    );
  });
});

export type StoryImportEndingProvenance =
  | 'author_default'
  | 'author_sub'
  | 'ai_generated';

export interface StoryManuscriptImportDraft {
  parts: Array<{
    partKey: string;
    bodyCharacterCount: number;
    branchSummaryCharacterCount: number;
    sceneKeys: string[];
  }>;
  scenes: Array<{
    sceneKey: string;
    backgroundKey: string;
    characterKeys: string[];
  }>;
  choices: Array<{
    choiceKey: string;
    sourceSceneKey: string;
    nextSceneKey: string;
    explicitRejoin?: boolean;
  }>;
  endings: Array<{
    endingKey: string;
    sourceSceneKey: string;
    provenance: StoryImportEndingProvenance;
  }>;
  backgroundKeys: string[];
  characterKeys: string[];
}

export interface StoryManuscriptImportValidationResult {
  warnings: string[];
  blockers: string[];
  publishReady: boolean;
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function validateStoryManuscriptImport(
  draft: StoryManuscriptImportDraft,
): StoryManuscriptImportValidationResult {
  const warnings: string[] = [];
  const blockers: string[] = [];
  const sceneKeys = new Set(draft.scenes.map((scene) => scene.sceneKey));
  const backgroundKeys = new Set(draft.backgroundKeys);
  const characterKeys = new Set(draft.characterKeys);

  for (const duplicate of duplicateValues(draft.parts.map((part) => part.partKey))) {
    blockers.push(`duplicate_part:${duplicate}`);
  }
  for (const duplicate of duplicateValues(draft.scenes.map((scene) => scene.sceneKey))) {
    blockers.push(`duplicate_scene:${duplicate}`);
  }

  for (const part of draft.parts) {
    if (part.bodyCharacterCount < 8_000 || part.bodyCharacterCount > 12_000) {
      warnings.push(`part_length_review:${part.partKey}`);
    }
    if (part.branchSummaryCharacterCount > 2_000) {
      warnings.push(`branch_summary_length_review:${part.partKey}`);
    }
    for (const sceneKey of part.sceneKeys) {
      if (!sceneKeys.has(sceneKey)) {
        blockers.push(`part_scene_missing:${part.partKey}:${sceneKey}`);
      }
    }
  }

  for (const scene of draft.scenes) {
    if (!backgroundKeys.has(scene.backgroundKey)) {
      blockers.push(`background_missing:${scene.sceneKey}`);
    }
    for (const characterKey of scene.characterKeys) {
      if (!characterKeys.has(characterKey)) {
        blockers.push(`character_missing:${scene.sceneKey}:${characterKey}`);
      }
    }
  }

  const choicesBySource = new Map<string, typeof draft.choices>();
  for (const choice of draft.choices) {
    if (!sceneKeys.has(choice.sourceSceneKey)) {
      blockers.push(`choice_source_missing:${choice.choiceKey}`);
    }
    if (!sceneKeys.has(choice.nextSceneKey)) {
      blockers.push(`dangling_route:${choice.choiceKey}`);
    }
    choicesBySource.set(choice.sourceSceneKey, [
      ...(choicesBySource.get(choice.sourceSceneKey) ?? []),
      choice,
    ]);
  }

  for (const [sourceSceneKey, choices] of choicesBySource) {
    if (choices.length < 2) continue;
    const nextSceneKeys = new Set(choices.map((choice) => choice.nextSceneKey));
    if (
      nextSceneKeys.size === 1 &&
      !choices.every((choice) => choice.explicitRejoin === true)
    ) {
      blockers.push(`forced_choice_convergence:${sourceSceneKey}`);
    }
  }

  for (const ending of draft.endings) {
    if (!sceneKeys.has(ending.sourceSceneKey)) {
      blockers.push(`ending_scene_missing:${ending.endingKey}`);
    }
  }
  const defaultEndingCount = draft.endings.filter(
    (ending) => ending.provenance === 'author_default',
  ).length;
  if (defaultEndingCount !== 1) {
    blockers.push('author_default_ending_count_invalid');
  }

  return {
    warnings,
    blockers: [...new Set(blockers)],
    publishReady: blockers.length === 0,
  };
}

export const STORY_WRITER_MANUSCRIPT_IMPORT_VALIDATION_CONTRACT = {
  version: '2026-07-11.story-manuscript-import-validation.v1',
  status: 'deterministic_validator_contract',
  thresholds: {
    targetPartCharacters: 10_000,
    warningBandCharacters: [8_000, 12_000],
    branchSummaryMaxCharacters: 2_000,
  },
  variableChoiceCountAllowed: true,
  warningOnlyRules: ['part_length', 'branch_summary_length'],
  publishBlockRules: [
    'duplicate_reference',
    'dangling_route',
    'forced_choice_convergence',
    'missing_scene',
    'missing_ending',
    'missing_visual_reference',
  ],
  fixturePolicy: {
    syntheticKeysAndCountsOnly: true,
    manuscriptBodyStoredInFixture: false,
    personalDataStoredInFixture: false,
  },
  mutationPolicy: {
    importWrite: false,
    publishMutation: false,
    storyWrite: false,
    providerCall: false,
    assetUpload: false,
  },
} as const;

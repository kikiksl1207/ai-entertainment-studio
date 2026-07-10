import {
  STORY_BRANCH_TIMELINE_PACING_BACKEND_CONTRACT,
  STORY_ENDING_PROVENANCE_POLICY_BACKEND_CONTRACT,
  STORY_LOCALE_PAYLOAD_FALLBACK_API_CONTRACT,
  STORY_SCENE_VISUAL_MANIFEST_API_CONTRACT,
  STORY_STAGE_CONTRACT,
  STORY_WRITER_MANUSCRIPT_IMPORT_VALIDATION_CONTRACT,
} from './story-stage-contract';

describe('story contract bundle 1815-1819', () => {
  it('links all five read-only contracts into the story stage aggregate', () => {
    expect(STORY_STAGE_CONTRACT.sceneVisualManifestApi).toBe(
      STORY_SCENE_VISUAL_MANIFEST_API_CONTRACT,
    );
    expect(STORY_STAGE_CONTRACT.writerManuscriptImportValidation).toBe(
      STORY_WRITER_MANUSCRIPT_IMPORT_VALIDATION_CONTRACT,
    );
    expect(STORY_STAGE_CONTRACT.branchTimelinePacing).toBe(
      STORY_BRANCH_TIMELINE_PACING_BACKEND_CONTRACT,
    );
    expect(STORY_STAGE_CONTRACT.endingProvenancePolicy).toBe(
      STORY_ENDING_PROVENANCE_POLICY_BACKEND_CONTRACT,
    );
    expect(STORY_STAGE_CONTRACT.localePayloadFallbackApi).toBe(
      STORY_LOCALE_PAYLOAD_FALLBACK_API_CONTRACT,
    );
  });

  it('keeps every bundle mutation flag disabled', () => {
    const policies = [
      STORY_SCENE_VISUAL_MANIFEST_API_CONTRACT.mutationPolicy,
      STORY_WRITER_MANUSCRIPT_IMPORT_VALIDATION_CONTRACT.mutationPolicy,
      STORY_BRANCH_TIMELINE_PACING_BACKEND_CONTRACT.mutationPolicy,
      STORY_ENDING_PROVENANCE_POLICY_BACKEND_CONTRACT.mutationPolicy,
      STORY_LOCALE_PAYLOAD_FALLBACK_API_CONTRACT.mutationPolicy,
    ];

    expect(
      policies.every((policy) =>
        Object.values(policy).every((enabled) => enabled === false),
      ),
    ).toBe(true);
  });
});

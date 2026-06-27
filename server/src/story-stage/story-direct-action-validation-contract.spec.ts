import { STORY_DIRECT_ACTION_VALIDATION_CONTRACT } from './story-direct-action-validation-contract';

describe('Story direct action validation contract', () => {
  it('publishes fail-closed direct action validation policy without provider or story mutation', () => {
    expect(STORY_DIRECT_ACTION_VALIDATION_CONTRACT).toMatchObject({
      version: '2026-06-18.story-direct-action-validation-policy.v1',
      status: 'validation_policy_contract_only',
      enabled: false,
      input: {
        field: 'directAction.body',
        minChars: 1,
        maxChars: 500,
        trimsWhitespace: true,
        emptyAfterTrimRejected: true,
        rawInputStoredBeforeValidation: false,
      },
      responseProjection: {
        allowed: {
          providerCallTriggered: false,
          storyMutationTriggered: false,
        },
        rejected: {
          rawInternalReasonReturned: false,
          rawModerationPayloadReturned: false,
        },
      },
    });
    expect(STORY_DIRECT_ACTION_VALIDATION_CONTRACT.validationOrder).toEqual([
      'require_authenticated_story_session_owner',
      'validate_text_length_and_plain_text_shape',
      'load_current_story_session_scene',
      'validate_timeline_continuity',
      'validate_player_location_and_reachability',
      'validate_world_rule_constraints',
      'validate_safety_and_age_rating',
      'validate_author_forbidden_outcomes',
      'validate_character_persona_integrity',
      'return_validation_projection_without_provider_or_story_mutation',
    ]);
    expect(
      Object.values(
        STORY_DIRECT_ACTION_VALIDATION_CONTRACT.noMutationPolicy,
      ).every((enabled) => enabled === false),
    ).toBe(true);
  });

  it('rejects unsafe impossible author-forbidden and persona-breaking actions by policy', () => {
    expect(STORY_DIRECT_ACTION_VALIDATION_CONTRACT.guardPolicies).toMatchObject({
      timeline: {
        rejects: [
          'changes_past_locked_event',
          'skips_required_scene_consequence',
          'creates_impossible_time_jump',
        ],
        failCode: 'STORY_ACTION_TIMELINE_CONFLICT',
      },
      location: {
        rejects: [
          'acts_outside_current_reachable_location',
          'teleports_without_story_permission',
          'intervenes_in_remote_scene_without_channel',
        ],
        failCode: 'STORY_ACTION_LOCATION_CONFLICT',
      },
      worldRules: {
        rejects: [
          'breaks_world_physics_or_magic_limits',
          'uses_unowned_item_or_power',
          'solves_core_conflict_without_cost',
        ],
        failCode: 'STORY_ACTION_WORLD_RULE_CONFLICT',
      },
      safety: {
        rejects: [
          'adult_sexual_content',
          'graphic_exploitation',
          'self_harm_instruction',
          'hate_or_harassment_targeting_protected_class',
        ],
        failCode: 'STORY_ACTION_SAFETY_BLOCKED',
      },
      authorForbiddenOutcomes: {
        rejects: [
          'kills_protected_character',
          'bypasses_planned_mystery_solution',
          'forces_romance_or_betrayal_against_author_rule',
        ],
        failCode: 'STORY_ACTION_AUTHOR_RULE_BLOCKED',
      },
      characterIntegrity: {
        rejects: [
          'breaks_established_persona',
          'forces_other_character_internal_intent',
          'takes_control_of_non_player_character',
        ],
        failCode: 'STORY_ACTION_CHARACTER_INTEGRITY_BLOCKED',
      },
    });
    expect(STORY_DIRECT_ACTION_VALIDATION_CONTRACT.privacy).toMatchObject({
      rawPromptReturned: false,
      providerPayloadReturned: false,
      rawSafetyClassifierPayloadReturned: false,
      authorPrivateRuleReturned: false,
      adminMemoReturned: false,
    });
  });
});

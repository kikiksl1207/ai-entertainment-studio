export const STORY_DIRECT_ACTION_VALIDATION_CONTRACT = {
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
  validationOrder: [
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
  ],
  guardPolicies: {
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
  },
  responseProjection: {
    allowed: {
      fields: [
        'ok',
        'accepted',
        'normalizedPreview',
        'validationState',
        'messageKey',
      ],
      providerCallTriggered: false,
      storyMutationTriggered: false,
    },
    rejected: {
      fields: [
        'ok',
        'accepted',
        'code',
        'messageKey',
        'safeSuggestionKey',
        'retryAllowed',
      ],
      rawInternalReasonReturned: false,
      rawModerationPayloadReturned: false,
    },
  },
  noMutationPolicy: {
    providerCall: false,
    storyStateMutation: false,
    directActionStore: false,
    timelineMutation: false,
    characterStateMutation: false,
    notificationCreate: false,
    walletMutation: false,
    luminaMutation: false,
    paymentMutation: false,
    settlementMutation: false,
    payoutMutation: false,
  },
  privacy: {
    rawPromptReturned: false,
    providerPayloadReturned: false,
    rawSafetyClassifierPayloadReturned: false,
    authorPrivateRuleReturned: false,
    adminMemoReturned: false,
  },
} as const;

export const STORY_STAGE_FREE_PROLOGUE_ENTITLEMENT_GUARD = {
  version: '2026-06-18.story-stage-free-prologue-entitlement-guard.v1',
  status: 'contract_only',
  endpoints: {
    preview: 'GET /api/v1/story-stage/prologue/preview',
    start: 'POST /api/v1/story-stage/prologue/sessions',
  },
  entitlement: {
    type: 'story_stage_free_prologue',
    platformAccountLimit: 1,
    uniquenessScope: ['userId', 'story_stage_free_prologue'],
    sourceOfTruth: 'user_entitlements',
    replayBehavior: 'return_existing_entitlement_without_new_session_charge',
  },
  companionPolicy: {
    allowedModes: ['self', 'ai_artist_companion'],
    maxAiArtistCompanions: 1,
    userSelfIncluded: true,
    artistSource: 'server_resolved_active_ai_artist',
    clientSubmittedArtistTrusted: false,
  },
  validationOrder: [
    'authenticate_platform_account',
    'resolve_story_pack_and_prologue_chapter',
    'verify_prologue_is_free_and_active',
    'verify_user_has_no_prior_free_prologue_entitlement',
    'resolve_optional_ai_artist_companion',
    'enforce_max_one_ai_artist_companion',
    'create_free_prologue_session_and_entitlement_in_same_transaction',
  ],
  responsePolicy: {
    stableCodeRequired: true,
    messageKeyRequired: true,
    rawUserFacingEnglishCopy: false,
    entitlementIdReturned: true,
    walletLedgerIdReturned: false,
    settlementIdReturned: false,
  },
  failureCodes: {
    alreadyUsed: {
      status: 409,
      code: 'STORY_FREE_PROLOGUE_ALREADY_USED',
      messageKey: 'storyStage.prologue.alreadyUsed',
    },
    invalidCompanion: {
      status: 400,
      code: 'STORY_PROLOGUE_INVALID_COMPANION',
      messageKey: 'storyStage.prologue.invalidCompanion',
    },
    unavailable: {
      status: 404,
      code: 'STORY_PROLOGUE_UNAVAILABLE',
      messageKey: 'storyStage.prologue.unavailable',
    },
  },
  mutationPolicy: {
    freeEntitlementMutation: true,
    storySessionMutation: true,
    paymentMutation: false,
    walletMutation: false,
    walletDebit: false,
    settlementMutation: false,
    payoutMutation: false,
    providerCall: false,
  },
} as const;

export const STORY_STAGE_CONTRACT = {
  version: '2026-06-18.story-stage-contract.v1',
  freePrologueEntitlementGuard: STORY_STAGE_FREE_PROLOGUE_ENTITLEMENT_GUARD,
} as const;

import { STORY_ROUTE_SUPPORTED_LOCALE_SLOTS } from './story-route-relocation-contract';
import {
  STORY_UPLOAD_IMPORT_EXPORT_MIGRATION_CONTRACT,
  STORY_UPLOAD_REVIEW_STATUSES,
} from './story-upload-intake-contract';

export const STORY_UPLOAD_ENDING_TYPES = [
  'author_main',
  'author_sub',
  'ai_fallback',
] as const;

export const STORY_UPLOAD_INTAKE_STORAGE_GUARD_CONTRACT = {
  version: '2026-07-01.story-upload-intake-storage-guard.v1',
  status: 'read_model_contract_only',
  sourceReference: 'Lumina Stage story upload workspace',
  normalizedSlices: {
    work: [
      'storyUploadId',
      'title',
      'genreKeys',
      'ageRatingKey',
      'isFree',
      'reviewStatusKey',
    ],
    scenes: [
      'sceneId',
      'storyUploadId',
      'order',
      'title',
      'bodyKey',
      'backgroundRef',
      'castRefs',
    ],
    backgrounds: ['backgroundId', 'assetRef', 'fallbackKey', 'localeCopyKeys'],
    cast: ['characterRef', 'displayNameKey', 'roleKey', 'visibilityState'],
    choices: ['choiceId', 'sceneId', 'labelKey', 'nextSceneId', 'branchId'],
    endings: ['endingId', 'sceneId', 'endingType', 'labelKey'],
    review: ['reviewStatusKey', 'pmReviewFlags', 'missingFieldKeys'],
  },
  localeExpansion: {
    slots: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
    i18nKeyRequiredForUserCopy: true,
    rawLocaleBlobStoredAsPrimary: false,
  },
  forbiddenStorageFields: [
    'rawPrompt',
    'providerPayload',
    'signedUrl',
    'storageKey',
    'rawAccountId',
    'rawEmail',
    'dbUrl',
  ],
  mutationPolicy: {
    contractAddsEndpoint: false,
    dbWrite: false,
    storyPublishMutation: false,
    paymentMutation: false,
    providerCall: false,
    assetUploadIntentCreate: false,
  },
} as const;

export const STORY_ENDING_TYPE_BACKEND_POLICY_CONTRACT = {
  version: '2026-07-01.story-ending-type-backend-policy.v1',
  status: 'backend_policy_contract_only',
  endingTypes: STORY_UPLOAD_ENDING_TYPES,
  authorMain: {
    required: true,
    exactCount: 1,
    source: 'writer_declared_primary_ending',
  },
  authorSub: {
    required: false,
    minWhenProvided: 2,
    maxWhenProvided: 10,
    source: 'writer_declared_optional_sub_endings',
  },
  aiFallback: {
    allowedOnlyWhenWriterBranchMissing: true,
    mayReplaceAuthorEnding: false,
    source: 'server_marked_unresolved_branch_fallback',
    requiredAuthorUnsetEvidence: {
      branchIdField: 'branchId',
      writerEndingConfiguredField: 'writerEndingConfigured',
      writerEndingConfiguredRequiredValue: false,
      fallbackReasonKey: 'storyUpload.ending.aiFallback.writerMissing',
      providerGeneratedAtIntake: false,
    },
    publicDomEvidenceAttributes: [
      'data-ai-fallback-policy',
      'data-writer-ending-configured',
      'data-provider-generated-at-intake',
    ],
    publicFixtureState: {
      endingType: 'ai_fallback',
      authorConfiguredEndingId: null,
      fallbackAllowedOnlyBecauseWriterEndingMissing: true,
      mutationExecuted: false,
    },
  },
  displaySeparation: {
    authorMainLabelKey: 'storyUpload.ending.authorMain',
    authorSubLabelKey: 'storyUpload.ending.authorSub',
    aiFallbackLabelKey: 'storyUpload.ending.aiFallback',
    aiFallbackMustNotUseAuthorBadge: true,
  },
  validationFailureConditions: [
    'ai_fallback_without_author_unset_branch_evidence',
    'ai_fallback_saved_as_author_ending',
    'author_main_count_not_exactly_one',
    'author_sub_count_outside_2_to_10_when_present',
  ],
  mutationPolicy: {
    providerGeneration: false,
    storyWrite: false,
    publishMutation: false,
  },
} as const;

export const STORY_BRANCH_RESULT_STATE_BACKEND_GUARD_CONTRACT = {
  version: '2026-07-02.story-branch-result-state-backend-guard.v1',
  status: 'read_model_contract_only',
  resultDifferenceAxes: [
    'event',
    'relationship',
    'risk',
    'item',
    'information',
    'ending_condition',
  ],
  requiredChoiceEvidenceFields: [
    'choiceId',
    'nextSceneId',
    'choiceBodyKey',
    'resultDeltaKeys',
    'resultStateKey',
  ],
  failureConditions: [
    'all_choices_share_same_next_scene_body_and_result',
    'choice_missing_result_state_key',
    'rejoin_without_pre_rejoin_difference',
  ],
  rejoinPolicy: {
    rejoinAllowed: true,
    differenceBeforeRejoinRequired: true,
    minimumDifferentAxesBeforeRejoin: 1,
  },
  mutationPolicy: {
    storyWrite: false,
    storyProgressMutation: false,
    providerCall: false,
    paymentMutation: false,
  },
} as const;

export const STORY_PART_LENGTH_POLICY_CONTRACT = {
  version: '2026-07-02.story-part-length-policy.v1',
  status: 'read_model_contract_only',
  partTextCharactersTarget: 10_000,
  branchSummaryCharactersMax: 2_000,
  defaultShortPlayPartCount: 10,
  defaultShortPlayUnit: 'ten_part_short_drama',
  fieldSeparation: {
    manuscriptBodyField: 'partBodyKey',
    branchSummaryField: 'branchSummaryKey',
    branchSummaryMayReplaceManuscriptBody: false,
  },
  mobileStatusKeys: [
    'storyUpload.length.partTarget',
    'storyUpload.length.branchSummaryLimit',
    'storyUpload.length.tenPartShortDrama',
  ],
  mutationPolicy: {
    storyWrite: false,
    providerCall: false,
    paymentMutation: false,
  },
} as const;

export const AUTHOR_SUB_ENDING_COUNT_VALIDATION_GUARD_CONTRACT = {
  version: '2026-07-02.author-sub-ending-count-validation-guard.v1',
  status: 'validation_contract_only',
  authorMain: {
    required: true,
    exactCount: 1,
  },
  authorSub: {
    required: false,
    minWhenProvided: 2,
    maxWhenProvided: 10,
  },
  aiFallback: {
    allowedOnlyWhenWriterBranchMissing: true,
    writerAuthored: false,
    providerGenerationAtValidation: false,
  },
  publicFixtureEvidence: {
    authorMainCountAttribute: 'data-author-main-count',
    authorMainExpectedCount: 1,
    authorSubCountAttribute: 'data-author-sub-count',
    authorSubMinAttribute: 'data-author-sub-min',
    authorSubMaxAttribute: 'data-author-sub-max',
    authorSubMin: 2,
    authorSubMax: 10,
    aiFallbackPolicyAttribute: 'data-ai-fallback-policy',
    writerEndingConfiguredAttribute: 'data-writer-ending-configured',
    providerGeneratedAtIntakeAttribute: 'data-provider-generated-at-intake',
  },
  validationOrder: [
    'count_author_main_endings',
    'count_author_sub_endings_when_present',
    'verify_ai_fallback_has_author_unset_branch_evidence',
    'reject_ai_fallback_if_saved_or_labeled_as_author_ending',
  ],
  failureConditions:
    STORY_ENDING_TYPE_BACKEND_POLICY_CONTRACT.validationFailureConditions,
  mutationPolicy: {
    providerGeneration: false,
    storyWrite: false,
    publishMutation: false,
  },
} as const;

export const STORY_UPLOAD_PUBLIC_SOURCE_SAFETY_GUARD_CONTRACT = {
  version: '2026-07-01.story-upload-public-source-safety-guard.v1',
  status: 'classification_guard_contract_only',
  publicSourceCandidates: [
    'three_kingdoms',
    'imjin_war',
    'gwiju_battle',
    'greek_myth',
    'norse_myth',
    'japanese_myth',
    'maha_related_myth',
    'cthulhu_public_domain_candidate',
  ],
  pmReviewRequiredWhen: [
    'modern_game_unique_expression',
    'modern_webtoon_unique_expression',
    'modern_anime_unique_expression',
    'modern_drama_unique_expression',
    'modern_translation_unique_wording',
    'uncertain_public_domain_status',
    'cthulhu_later_derivative_setting',
  ],
  rewritePolicy: {
    luminaOriginalVoiceRequired: true,
    originalSceneCompositionRequired: true,
    originalCharacterInterpretationRequired: true,
    copiedModernTranslationAllowed: false,
    automaticCopyrightClearance: false,
  },
  classificationOutput: {
    statusKeys: ['public_source_candidate', 'pm_review_required', 'blocked_reference'],
    pmReviewFlagRequired: true,
    finalLegalJudgmentAutomated: false,
  },
  mutationPolicy: {
    storyWrite: false,
    publishMutation: false,
    providerCall: false,
  },
} as const;

export const STORY_HIATUS_PENALTY_PENDING_VALUES_GUARD_CONTRACT = {
  version: '2026-07-01.story-hiatus-penalty-pending-values-guard.v1',
  status: 'pending_policy_values_contract_only',
  pendingDecisionKeys: [
    'longHiatusDayThreshold',
    'firstWarningDay',
    'settlementRateReductionSteps',
    'partialRefundFormula',
  ],
  placeholderPolicy: {
    unsetValuesUseStableKey: 'pending_pm_decision',
    clientSubmittedPenaltyValuesTrusted: false,
    operatorDecisionRequiredBeforeEnforcement: true,
  },
  completedChapterProtection: {
    alreadyCompletedChapterRateLocked: true,
    retroactivePenaltyOnCompletedChapters: false,
    settledOrPayoutRowsRewritten: false,
  },
  futureAndIncompleteOnly: {
    appliesOnlyToFutureOrIncompleteChapters: true,
    incompleteChapterStatusKeys: ['draft', 'scheduled', 'paused', 'publishing'],
    completedChapterAccessMutation: false,
  },
  mutationPolicy: {
    settlementMutation: false,
    refundMutation: false,
    walletMutation: false,
    payoutMutation: false,
    paymentMutation: false,
  },
} as const;

export const STORY_UPLOAD_PENDING_DECISION_AUDIT_GUARD_CONTRACT = {
  version: '2026-07-02.story-upload-pending-decision-audit-guard.v1',
  status: 'audit_read_model_contract_only',
  pendingDecisionKeys:
    STORY_HIATUS_PENALTY_PENDING_VALUES_GUARD_CONTRACT.pendingDecisionKeys,
  auditProjectionFields: [
    'decisionKey',
    'status',
    'ownerRole',
    'reviewStatusKey',
    'updatedAt',
  ],
  allowedStatusKeys: ['pending_pm_decision', 'approved', 'rejected'],
  forbiddenDefaulting: {
    longHiatusDayThreshold: true,
    firstWarningDay: true,
    settlementRateReductionSteps: true,
    partialRefundFormula: true,
  },
  mutationPolicy: {
    refundMutation: false,
    walletMutation: false,
    settlementMutation: false,
    payoutMutation: false,
    paymentMutation: false,
  },
} as const;

export const STORY_UPLOAD_FIXTURE_PRIVACY_GUARD_CONTRACT = {
  version: '2026-07-01.story-upload-fixture-privacy-guard.v1',
  status: 'fixture_privacy_contract_only',
  fixtureNamespace: {
    prefix: 'story-upload-fixture-',
    allowedUse: 'read_only_preview_and_qa_rows_only',
    realAuthorUploadMixingAllowed: false,
    publicDummyTextOnly: true,
  },
  allowedReportFields: [
    'runId',
    'fixtureNamespace',
    'storyUploadPreviewPath',
    'reviewStatusKey',
    'publicSceneCount',
    'publicEndingTypeCounts',
    'status',
  ],
  forbiddenFields: [
    'rawUserId',
    'rawAccountId',
    'rawEmail',
    'token',
    'password',
    'cookie',
    'apiKey',
    'dbUrl',
    'providerPayload',
    'rawPrompt',
    'storageKey',
    'signedUrl',
  ],
  mutationPolicy: {
    accountMutation: false,
    storyWrite: false,
    providerCall: false,
    paymentMutation: false,
    fixtureCleanupMutation: false,
  },
} as const;

export const STORY_BRANCH_GRAPH_CYCLE_GUARD_CONTRACT = {
  version: '2026-07-03.story-branch-graph-cycle-guard.v1',
  status: 'read_model_contract_only',
  graphModel: {
    rootSceneRequired: true,
    treeRootBranchingIsDefault: true,
    rejoinAllowed: true,
    rejoinRequiresPreRejoinDifference: true,
    terminalEndingSceneRequiredForEveryReachablePath: true,
  },
  traversalProjectionFields: [
    'storyUploadId',
    'rootSceneId',
    'sceneId',
    'choiceId',
    'nextSceneId',
    'mergeTargetSceneId',
    'resultStateKey',
    'resultDeltaKeys',
    'reachableFromRoot',
    'cycleGroupId',
  ],
  resultDifferenceAxes: [
    'event',
    'relationship',
    'risk',
    'item',
    'information',
    'ending_condition',
  ],
  failureConditions: [
    'unreachable_scene_from_root',
    'cycle_without_terminal_escape',
    'self_loop_without_progress_or_terminal_condition',
    'branch_without_next_scene_or_merge_target',
    'all_choices_immediately_rejoin_same_scene_body_and_result',
    'rejoin_without_pre_rejoin_result_difference',
  ],
  mutationPolicy: {
    storyWrite: false,
    progressWrite: false,
    providerCall: false,
    paymentMutation: false,
  },
} as const;

export const STORY_BRANCH_GRAPH_READ_MODEL_CONTRACT = {
  version: '2026-07-03.story-branch-graph-read-model.v1',
  status: 'read_model_contract_only',
  requiredNodeFields: [
    'sceneId',
    'choiceId',
    'nextSceneId',
    'rejoinGroup',
    'endingCandidate',
    'writerConfigured',
  ],
  branchingPolicy: {
    treeLikeBranchingDefault: true,
    allChoicesMayShareNextSceneOnlyWithExplicitRejoin: true,
    rejoinGroupRequiredForSharedNextScene: true,
    optionalLaterRejoinNodesSupported: true,
    resultDifferenceRequiredBeforeRejoin: true,
  },
  localeFixturePolicy: {
    slots: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
    labelFieldsUseLocaleKeys: true,
    rawI18nKeyVisibleInFixture: false,
    mobileFixtureRequired: true,
  },
  validationFailureConditions: [
    'scene_id_missing',
    'choice_id_missing',
    'next_scene_id_missing_without_terminal_ending',
    'shared_next_scene_without_rejoin_group',
    'rejoin_group_without_pre_rejoin_difference',
    'ending_candidate_missing_for_terminal_scene',
    'writer_configured_state_missing',
  ],
  mutationPolicy: {
    storyWrite: false,
    progressWrite: false,
    providerCall: false,
    paymentMutation: false,
  },
} as const;

export const STORY_ENDING_OWNERSHIP_GUARD_CONTRACT = {
  version: '2026-07-03.story-ending-ownership-guard.v1',
  status: 'ownership_guard_contract_only',
  endingTypes: STORY_UPLOAD_ENDING_TYPES,
  ownershipProjectionFields: [
    'endingId',
    'endingType',
    'ownerSource',
    'writerEndingConfigured',
    'authorUnsetBranchEvidenceKey',
    'providerGeneratedAtIntake',
    'labelKey',
  ],
  ownerSourceMap: {
    author_main: 'writer_declared_primary_ending',
    author_sub: 'writer_declared_optional_sub_ending',
    ai_fallback: 'server_marked_unresolved_branch_fallback',
  },
  aiFallbackRules: {
    requiresAuthorUnsetBranchEvidence: true,
    mayAttachToAuthorOwnedEndingRoute: false,
    mayReplaceAuthorEnding: false,
    savedAsAuthorEnding: false,
    providerPayloadExported: false,
  },
  failureConditions: [
    'ai_fallback_without_author_unset_branch_evidence',
    'ai_fallback_saved_with_author_owner_source',
    'author_ending_route_contains_ai_fallback_override',
    'ending_type_owner_source_mismatch',
    'provider_payload_exported_for_ending',
  ],
  mutationPolicy: {
    providerGeneration: false,
    storyWrite: false,
    publishMutation: false,
    paymentMutation: false,
  },
} as const;

export const STORY_ENDING_OWNERSHIP_PERSISTENCE_CONTRACT = {
  version: '2026-07-03.story-ending-ownership-persistence.v1',
  status: 'persistence_contract_only',
  persistenceFields: [
    'endingId',
    'endingType',
    'ownerSource',
    'writerConfigured',
    'authorEndingId',
    'labelKey',
  ],
  writerEndingRules: {
    authorMainExactCount: 1,
    authorSubMinWhenProvided: 2,
    authorSubMaxWhenProvided: 10,
    aiFallbackAllowedOnlyWhenWriterUnset: true,
    aiFallbackMayPersistAsAuthorEnding: false,
  },
  visibleLabelPolicy: {
    localeSlots: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
    visibleLabelsUseLocaleText: true,
    rawEnumAsVisibleText: false,
    labelKeyRequired: true,
  },
  validationFailureConditions: [
    'author_main_count_not_exactly_one',
    'author_sub_count_outside_2_to_10_when_present',
    'ai_fallback_without_writer_unset_branch',
    'ai_fallback_persisted_as_author_owned_ending',
    'raw_ending_enum_visible_to_reader',
  ],
  mutationPolicy: {
    providerGeneration: false,
    storyWrite: false,
    publishMutation: false,
    paymentMutation: false,
  },
} as const;

export const STORY_SCENE_ASSET_REFERENCE_GUARD_CONTRACT = {
  version: '2026-07-03.story-scene-asset-reference-guard.v1',
  status: 'public_reference_guard_contract_only',
  allowedPublicReferenceFields: [
    'assetId',
    'publicPath',
    'status',
    'fallbackKey',
    'labelKey',
    'width',
    'height',
  ],
  allowedStatuses: ['ready', 'loading', 'missing', 'fallback', 'blocked'],
  sceneProjectionFields: [
    'sceneId',
    'backgroundRef',
    'characterAssetRefs',
    'assetStatusKey',
    'fallbackKey',
  ],
  forbiddenFixtureFields: [
    'signedUrl',
    'privateStoragePath',
    'storageKey',
    'providerPayload',
    'rawProviderPayload',
    'internalAccountId',
    'rawAccountId',
    'rawEmail',
  ],
  failureConditions: [
    'signed_url_exported',
    'private_storage_path_exported',
    'provider_payload_exported',
    'internal_account_id_exported',
    'asset_reference_missing_public_path_or_status',
  ],
  mutationPolicy: {
    imageGeneration: false,
    uploadIntentCreate: false,
    assetUpload: false,
    providerCall: false,
    storyWrite: false,
  },
} as const;

export const STORY_SCENE_BACKGROUND_ASSET_METADATA_GUARD_CONTRACT = {
  version: '2026-07-03.story-scene-background-asset-metadata-guard.v1',
  status: 'safe_public_metadata_contract_only',
  allowedPublicMetadataFields: [
    'assetId',
    'altKey',
    'localeLabel',
    'sceneUse',
  ],
  sceneUseValues: ['background', 'character', 'prop', 'fallback'],
  localeLabelPolicy: {
    slots: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
    altKeyRequired: true,
    localeLabelRequired: true,
    rawI18nKeyVisible: false,
  },
  mobileQaFixtureIds: [
    'story-scene-bg-fixture-mobile-ready',
    'story-scene-bg-fixture-mobile-loading',
    'story-scene-bg-fixture-mobile-fallback',
  ],
  forbiddenPublicMetadataFields: [
    'rawPrompt',
    'localPath',
    'providerPayload',
    'privateBucketUrl',
    'signedUrl',
    'storageKey',
    'rawEmail',
  ],
  mutationPolicy: {
    imageGeneration: false,
    uploadIntentCreate: false,
    assetUpload: false,
    publishMutation: false,
    providerCall: false,
  },
} as const;

export const STORY_UPLOAD_REVIEW_STATE_TRANSITION_GUARD_CONTRACT = {
  version: '2026-07-03.story-upload-review-state-transition-guard.v1',
  status: 'workflow_transition_guard_contract_only',
  statuses: STORY_UPLOAD_REVIEW_STATUSES,
  allowedTransitions: [
    ['draft', 'pm_review'],
    ['pm_review', 'needs_revision'],
    ['pm_review', 'locale_ready'],
    ['pm_review', 'blocked'],
    ['needs_revision', 'pm_review'],
    ['locale_ready', 'qa_ready'],
    ['qa_ready', 'publish_ready'],
    ['blocked', 'pm_review'],
  ],
  transitionGates: {
    publishReady: {
      from: 'qa_ready',
      requiresQaPass: true,
      requiresNoBlockerReason: true,
      messageKey: 'storyUpload.review.publishReadyRequiresQaPass',
    },
    blocked: {
      requiresBlockerReasonKey: true,
      allowedReasonKeyPrefix: 'storyUpload.blocker.',
      messageKey: 'storyUpload.review.blockedReasonRequired',
    },
    localeReady: {
      requiresI18nKeyPackage: true,
      rawCopyAsStatusAllowed: false,
    },
  },
  failureConditions: [
    'publish_ready_without_qa_pass',
    'publish_ready_from_non_qa_ready_state',
    'blocked_without_blocker_reason_key',
    'unknown_review_status_key',
    'raw_status_copy_returned_to_client',
  ],
  mutationPolicy: {
    publishMutation: false,
    providerCall: false,
    paymentMutation: false,
    walletMutation: false,
  },
} as const;

export const STORY_UPLOAD_DRAFT_LENGTH_VALIDATOR_CONTRACT = {
  version: '2026-07-03.story-upload-draft-length-validator.v1',
  status: 'validator_contract_only',
  thresholds: {
    partTargetCharacters: 10_000,
    branchSummaryMaxCharacters: 2_000,
    shortDramaPartCount: 10,
  },
  validationStates: {
    ok: {
      blocksSubmit: false,
      messageKey: 'storyUpload.length.ok',
    },
    warning: {
      blocksSubmit: false,
      messageKey: 'storyUpload.length.warning',
    },
    hardBlock: {
      blocksSubmit: true,
      messageKey: 'storyUpload.length.hardBlock',
    },
  },
  warningVersusHardBlockSeparated: true,
  mobileFixtureValues: {
    primaryWidth: '390-400px',
    nearPartTargetCharacters: 9_800,
    overBranchSummaryCharacters: 2_001,
    shortDramaParts: 10,
  },
  copyPolicy: {
    writerFacingMessagesUseI18nKeys: true,
    localeSlots: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
    rawManuscriptStoredInFixture: false,
    realManuscriptRecorded: false,
  },
  mutationPolicy: {
    storyWrite: false,
    uploadWrite: false,
    providerCall: false,
    publishMutation: false,
    paymentMutation: false,
  },
} as const;

export const STORY_SERIALIZATION_PENALTY_POLICY_SKELETON = {
  version: '2026-07-03.story-serialization-penalty-policy-skeleton.v1',
  status: 'disabled_policy_skeleton_only',
  policyStates: ['draft', 'reviewRequired', 'disabled'],
  policySubjects: [
    'hiatus',
    'discontinued_serialization',
    'missing_ending',
  ],
  liveEnforcement: {
    enabled: false,
    requiresPmConfirmation: true,
    defaultState: 'disabled',
    readerRefundMutationEnabled: false,
    authorPenaltyMutationEnabled: false,
  },
  localeKeyStructure: {
    titleKeyPrefix: 'storyPenalty.policy.',
    bodyKeyPrefix: 'storyPenalty.policy.',
    localeSlots: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
    rawPolicyCopyVisible: false,
  },
  dataAccessPolicy: {
    queryTargetAccounts: false,
    recordTargetAccounts: false,
    paymentDataReturned: false,
    walletDataReturned: false,
    secretDataReturned: false,
  },
  mutationPolicy: {
    settlementMutation: false,
    refundMutation: false,
    walletMutation: false,
    payoutMutation: false,
    paymentMutation: false,
    storyWrite: false,
  },
} as const;

export const STORY_IMPORT_EXPORT_SCHEMA_VERSION_GUARD_CONTRACT = {
  version: '2026-07-03.story-import-export-schema-version-guard.v1',
  status: 'schema_version_guard_contract_only',
  currentSchemaVersion: '2026-07-03.story-upload-import-export.v2',
  requiredTopLevelFields: [
    'schemaVersion',
    'work',
    'parts',
    'scenes',
    'branches',
    'endings',
    'backgrounds',
    'review',
  ],
  requiredNestedFields: {
    parts: ['partId', 'partIndex', 'partBodyKey'],
    scenes: ['sceneId', 'partId', 'bodyKey', 'backgroundRef'],
    branches: ['branchId', 'choiceId', 'sourceSceneId', 'nextSceneId'],
    endings: ['endingId', 'endingType', 'ownerSource', 'labelKey'],
    backgrounds: ['backgroundId', 'publicPath', 'status', 'fallbackKey'],
  },
  exportAllowlist:
    STORY_UPLOAD_IMPORT_EXPORT_MIGRATION_CONTRACT.exportFieldAllowlist,
  importCompatibility: {
    missingSchemaVersion: {
      action: 'block_import_until_manual_mapping',
      blockedFields: ['branches', 'endings', 'backgrounds'],
    },
    legacyV1MissingBackgroundRef: {
      action: 'normalize_to_missing_background_fallback',
      normalizedFields: ['backgroundRef', 'fallbackKey', 'status'],
    },
    legacyV1MissingEndingOwner: {
      action: 'block_publish_ready_until_owner_source_resolved',
      blockedFields: ['endingType', 'ownerSource'],
    },
  },
  failureConditions: [
    'schema_version_missing',
    'required_story_slice_missing',
    'legacy_schema_imported_without_compatibility_action',
    'ending_owner_source_missing_after_import',
    'background_public_reference_missing_after_import',
  ],
  mutationPolicy: {
    migrationWrite: false,
    uploadWrite: false,
    importWrite: false,
    publishMutation: false,
    paymentMutation: false,
    walletMutation: false,
  },
} as const;

export const STORY_UPLOAD_LIVE_AI_FALLBACK_EVIDENCE_GUARD_CONTRACT = {
  version: '2026-07-03.story-upload-live-ai-fallback-evidence-guard.v1',
  status: 'live_dom_read_model_guard_only',
  route: {
    path: '/story-upload',
    expectedEvidenceSelector: '.su-ai-fallback-evidence',
    expectedValidationSelector: '.su-ending-validation-evidence',
  },
  requiredDomAttributes: [
    'data-ai-fallback-policy',
    'data-writer-ending-configured',
    'data-provider-generated-at-intake',
  ],
  requiredValues: {
    aiFallbackPolicy: 'writer-ending-missing-only',
    writerEndingConfigured: 'false',
    providerGeneratedAtIntake: 'false',
  },
  authorCountEvidence: {
    authorMainCountAttribute: 'data-author-main-count',
    authorMainExpectedCount: '1',
    authorSubCountAttribute: 'data-author-sub-count',
    authorSubMinAttribute: 'data-author-sub-min',
    authorSubMaxAttribute: 'data-author-sub-max',
    authorSubMin: '2',
    authorSubMax: '10',
  },
  publicEvidenceLabels: {
    fallbackReason: 'Writer ending is missing for this branch',
    authorMainCount: 'Writer main ending exact 1',
    authorSubRange: 'writer sub ending 2-10 when provided',
  },
  visibleTextMustNotContain: [
    'storyUpload.ending.aiFallback.writerMissing',
    'author_main',
    'author_sub',
    'ai_fallback',
  ],
  failureConditions: [
    'live_ai_fallback_evidence_missing',
    'writer_ending_configured_not_false_for_ai_fallback',
    'provider_generated_at_intake_not_false',
    'author_count_evidence_missing',
    'raw_ai_fallback_reason_key_visible',
    'raw_ending_enum_visible_in_evidence',
    'ai_fallback_visible_as_author_owned_ending',
  ],
  mutationPolicy: {
    providerGeneration: false,
    storyWrite: false,
    importWrite: false,
    publishMutation: false,
    paymentMutation: false,
  },
} as const;

export const STORY_IMPORT_PREVIEW_PUBLIC_LABEL_GUARD_CONTRACT = {
  version: '2026-07-03.story-import-preview-public-label-guard.v1',
  status: 'public_label_guard_contract_only',
  route: {
    path: '/story-upload',
    tableSelector: '.su-import-preview',
    rowRawValueAttribute: 'data-ending-type',
  },
  publicEndingLabels: {
    author_main: 'Writer main ending',
    author_sub: 'Writer sub ending',
    ai_fallback: 'AI fallback ending',
  },
  internalValuesAllowedOnlyInAttributes: [
    'author_main',
    'author_sub',
    'ai_fallback',
  ],
  visibleTextMustNotContain: [
    'author_main',
    'author_sub',
    'ai_fallback',
    'writer_primary_ending',
    'writer_sub_ending',
    'ai_fallback_ending',
  ],
  failureConditions: [
    'raw_ending_enum_visible_in_import_preview',
    'public_ending_label_missing',
    'raw_i18n_key_visible_in_import_preview',
  ],
  mutationPolicy: {
    importWrite: false,
    storyWrite: false,
    publishMutation: false,
    providerCall: false,
    paymentMutation: false,
  },
} as const;

export const STORY_UPLOAD_GUARD_FORBIDDEN_FIELDS = [
  'token',
  'password',
  'cookie',
  'apiKey',
  'dbUrl',
  'rawUserId',
  'rawAccountId',
  'rawEmail',
  'providerPayload',
  'rawProviderPayload',
  'rawPrompt',
  'storageKey',
  'privateStoragePath',
  'signedUrl',
  'internalAccountId',
  'paymentOrderId',
  'walletLedgerId',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function findStoryUploadSensitiveFieldViolations(
  candidate: unknown,
  path = '',
): string[] {
  const forbidden = new Set<string>(STORY_UPLOAD_GUARD_FORBIDDEN_FIELDS);

  if (Array.isArray(candidate)) {
    return candidate.flatMap((item, index) =>
      findStoryUploadSensitiveFieldViolations(item, `${path}[${index}]`),
    );
  }

  if (!isRecord(candidate)) {
    return [];
  }

  return Object.entries(candidate).flatMap(([field, value]) => {
    const fieldPath = path ? `${path}.${field}` : field;
    const fieldViolation = forbidden.has(field) ? [fieldPath] : [];

    return [
      ...fieldViolation,
      ...findStoryUploadSensitiveFieldViolations(value, fieldPath),
    ];
  });
}

export const STORY_UPLOAD_BACKEND_GUARD_CONTRACT = {
  version: '2026-07-01.story-upload-backend-guard-bundle.v1',
  status: 'contract_bundle_only',
  intakeStorageGuard: STORY_UPLOAD_INTAKE_STORAGE_GUARD_CONTRACT,
  endingTypePolicy: STORY_ENDING_TYPE_BACKEND_POLICY_CONTRACT,
  branchResultStateGuard: STORY_BRANCH_RESULT_STATE_BACKEND_GUARD_CONTRACT,
  partLengthPolicy: STORY_PART_LENGTH_POLICY_CONTRACT,
  authorSubEndingCountValidation:
    AUTHOR_SUB_ENDING_COUNT_VALIDATION_GUARD_CONTRACT,
  publicSourceSafetyGuard: STORY_UPLOAD_PUBLIC_SOURCE_SAFETY_GUARD_CONTRACT,
  hiatusPenaltyPendingValuesGuard:
    STORY_HIATUS_PENALTY_PENDING_VALUES_GUARD_CONTRACT,
  pendingDecisionAuditGuard:
    STORY_UPLOAD_PENDING_DECISION_AUDIT_GUARD_CONTRACT,
  fixturePrivacyGuard: STORY_UPLOAD_FIXTURE_PRIVACY_GUARD_CONTRACT,
  branchGraphReadModel: STORY_BRANCH_GRAPH_READ_MODEL_CONTRACT,
  branchGraphCycleGuard: STORY_BRANCH_GRAPH_CYCLE_GUARD_CONTRACT,
  endingOwnershipGuard: STORY_ENDING_OWNERSHIP_GUARD_CONTRACT,
  endingOwnershipPersistence:
    STORY_ENDING_OWNERSHIP_PERSISTENCE_CONTRACT,
  sceneAssetReferenceGuard: STORY_SCENE_ASSET_REFERENCE_GUARD_CONTRACT,
  sceneBackgroundAssetMetadataGuard:
    STORY_SCENE_BACKGROUND_ASSET_METADATA_GUARD_CONTRACT,
  reviewStateTransitionGuard:
    STORY_UPLOAD_REVIEW_STATE_TRANSITION_GUARD_CONTRACT,
  draftLengthValidator: STORY_UPLOAD_DRAFT_LENGTH_VALIDATOR_CONTRACT,
  serializationPenaltyPolicySkeleton:
    STORY_SERIALIZATION_PENALTY_POLICY_SKELETON,
  importExportSchemaVersionGuard:
    STORY_IMPORT_EXPORT_SCHEMA_VERSION_GUARD_CONTRACT,
  liveAiFallbackEvidenceGuard:
    STORY_UPLOAD_LIVE_AI_FALLBACK_EVIDENCE_GUARD_CONTRACT,
  importPreviewPublicLabelGuard:
    STORY_IMPORT_PREVIEW_PUBLIC_LABEL_GUARD_CONTRACT,
  sensitiveFieldGuard: {
    forbiddenFields: STORY_UPLOAD_GUARD_FORBIDDEN_FIELDS,
    rawAccountFieldsAllowed: false,
    credentialFieldsAllowed: false,
    providerPayloadAllowed: false,
  },
  mutationPolicy: {
    contractAddsEndpoint: false,
    dbWrite: false,
    storyWrite: false,
    storyPublishMutation: false,
    providerCall: false,
    paymentMutation: false,
    walletMutation: false,
    settlementMutation: false,
    payoutMutation: false,
    fixtureCleanupMutation: false,
  },
} as const;

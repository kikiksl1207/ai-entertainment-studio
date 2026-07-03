import { STORY_ROUTE_SUPPORTED_LOCALE_SLOTS } from './story-route-relocation-contract';

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
  'rawPrompt',
  'storageKey',
  'signedUrl',
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

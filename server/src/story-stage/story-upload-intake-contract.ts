import {
  PUBLIC_SOURCE_STORY_COPYRIGHT_BOUNDARY_CONTRACT,
  STORY_BRANCH_MARKER_INGESTION_CONTRACT,
  STORY_MANUSCRIPT_MARKER_TOKENS,
} from './story-manuscript-ingestion-contract';
import { STORY_ROUTE_SUPPORTED_LOCALE_SLOTS } from './story-route-relocation-contract';

export const STORY_UPLOAD_REVIEW_STATUSES = [
  'draft',
  'pm_review',
  'needs_revision',
  'locale_ready',
  'qa_ready',
  'publish_ready',
  'blocked',
] as const;

export const STORY_UPLOAD_INTAKE_ENDING_TYPES = [
  'writer_primary_ending',
  'writer_sub_ending',
  'ai_fallback_ending',
] as const;

export const STORY_UPLOAD_SAFE_DTO_FIELD_GROUPS = {
  work: [
    'workId',
    'slug',
    'titleKey',
    'summaryKey',
    'genreKeys',
    'sourceClass',
    'copyrightBoundaryState',
    'partIndex',
    'partCount',
    'partTextLengthTarget',
    'branchSummaryLengthLimit',
  ],
  scenes: [
    'sceneId',
    'sceneMarker',
    'sceneTextKey',
    'backgroundId',
    'characterIds',
    'choiceIds',
    'endingId',
    'reviewStatus',
  ],
  choices: [
    'choiceId',
    'branchId',
    'labelKey',
    'choiceBodyKey',
    'nextSceneId',
    'mergeTargetSceneId',
    'toneKey',
    'resultDeltaKeys',
    'relationshipDeltaKey',
    'riskDeltaKey',
    'itemDeltaKey',
    'informationDeltaKey',
    'endingConditionKey',
  ],
  backgrounds: [
    'backgroundId',
    'assetHintKey',
    'fallbackKey',
    'reviewStatus',
  ],
  characters: [
    'characterId',
    'displayNameKey',
    'roleKey',
    'entranceState',
    'visibility',
  ],
  endings: [
    'endingId',
    'endingType',
    'endingSceneId',
    'labelKey',
    'isCanonicalWriterEnding',
  ],
  review: ['reviewStatus', 'blockerReasonKeys', 'reviewNoteKey'],
} as const;

export const STORY_UPLOAD_INTAKE_API_CONTRACT = {
  version: '2026-07-11.story-upload-intake-api.v2',
  status: 'authenticated_persistence_implemented',
  sourceReference: {
    sourceName: 'Lumina Stage story upload workspace',
    pmBoardIsAuthority: true,
    externalPageContentPersisted: false,
  },
  endpoints: {
    intakePreview: {
      method: 'GET',
      path: '/api/v1/story-upload/intake/:workId/preview',
      enabled: false,
      response: 'StoryUploadIntakePreviewDto',
    },
    intakeValidate: {
      method: 'POST',
      path: '/api/v1/story-upload/intake/validate',
      enabled: false,
      response: 'StoryUploadValidationResultDto',
    },
    intakeSubmit: {
      method: 'POST',
      path: '/api/v1/story-upload/intake',
      enabled: true,
      authRequired: true,
      contentType: 'multipart/form-data',
      idempotentRetry: true,
      response: 'StoryUploadIntakeReceiptDto',
    },
  },
  persistenceBoundary: {
    submissionTable: 'story_upload_submissions',
    fileTable: 'story_upload_submission_files',
    objectStorageRequiredOutsideDevelopment: true,
    safeReceiptFields: [
      'submissionId',
      'status',
      'submissionType',
      'fileCount',
      'totalBytes',
      'replayed',
      'receivedAt',
    ],
    privateStorageKeyReturned: false,
    rightsReferenceReturned: false,
  },
  dtoFieldGroups: STORY_UPLOAD_SAFE_DTO_FIELD_GROUPS,
  partDefaults: {
    partTextLengthTarget: 10_000,
    branchSummaryLengthLimit: 2_000,
    defaultShortPlayPartCount: 10,
    defaultShortPlayLabel: 'ten_part_short_drama',
    branchSummaryMayReplaceManuscriptBody: false,
  },
  branchChoiceResultAxes: [
    'relationship',
    'risk',
    'item',
    'information',
    'ending_condition',
  ],
  requiredSeparation: {
    workInfoSeparateFromScenes: true,
    choicesSeparateFromSceneText: true,
    choiceResultDeltasSeparateFromNextScene: true,
    backgroundsSeparateFromProviderPrompt: true,
    charactersSeparateFromPrivatePersona: true,
    endingTypeSeparateFromReviewStatus: true,
    reviewStatusSeparateFromPublishMutation: true,
  },
  validationFailureConditions: [
    'branch_summary_replaces_manuscript_body',
    'branch_summary_over_length_limit',
    'all_choices_share_same_next_scene_body_and_result',
  ],
  mobileStatusKeys: [
    'storyUpload.status.draft',
    'storyUpload.status.pmReview',
    'storyUpload.status.needsRevision',
    'storyUpload.status.localeReady',
    'storyUpload.status.qaReady',
    'storyUpload.status.publishReady',
    'storyUpload.status.blocked',
  ],
  mutationPolicy: {
    uploadWrite: true,
    intakeDbWrite: true,
    objectStorageWrite: true,
    publishMutation: false,
    providerGeneration: false,
    paymentMutation: false,
    walletMutation: false,
  },
} as const;

export const WRITER_MANUSCRIPT_SCENE_CHOICE_ENDING_SCHEMA = {
  version: '2026-07-01.writer-manuscript-scene-choice-ending-schema.v1',
  status: 'schema_contract_only',
  manuscriptFirst: true,
  partStructure: {
    partTextLengthTarget: 10_000,
    defaultShortPlayPartCount: 10,
    singlePartApproxCharacters: 10_000,
  },
  branchSummaryPolicy: {
    maxCharactersPerBranch: 2_000,
    mayReplaceManuscriptBody: false,
  },
  acceptedMarkers: {
    scene: ['[scene]', '[장면]'],
    branch: [STORY_MANUSCRIPT_MARKER_TOKENS.branch, '[분기점]'],
    background: [STORY_MANUSCRIPT_MARKER_TOKENS.background, '[배경]'],
    cast: [STORY_MANUSCRIPT_MARKER_TOKENS.cast, '[등장 캐릭터]'],
    ending: ['[ending]', '[엔딩]'],
  },
  sceneChoiceRules: {
    multipleChoicesPerSceneAllowed: true,
    treeRootBranchingIsDefault: true,
    choiceCanTargetNextScene: true,
    choiceCanHaveDistinctBody: true,
    choiceResultDifferenceRequired: true,
    choiceResultDifferenceRequiredBeforeMerge: true,
    choiceCanRejoinCommonScene: true,
    resultDifferenceAxes: [
      'relationship',
      'risk',
      'item',
      'information',
      'ending_condition',
    ],
    branchGraphContract: STORY_BRANCH_MARKER_INGESTION_CONTRACT,
    choiceOnlyGameDesignUploadIsDefault: false,
  },
  endingTypes: {
    allowedTypes: STORY_UPLOAD_INTAKE_ENDING_TYPES,
    writerPrimaryEnding: {
      type: 'writer_primary_ending',
      writerAuthored: true,
      isDefaultCanonical: true,
    },
    writerSubEnding: {
      type: 'writer_sub_ending',
      writerAuthored: true,
      canBeBranchSpecific: true,
    },
    aiFallbackEnding: {
      type: 'ai_fallback_ending',
      generatedByProviderAtIntake: false,
      labelRequired: true,
      mustRemainVisiblyMarked: true,
    },
  },
  failureConditions: [
    'choice_only_game_design_uploaded_as_primary',
    'ending_type_missing',
    'ai_fallback_ending_unlabeled',
    'branch_without_next_scene_or_merge_target',
    'branch_summary_replaces_manuscript_body',
    'all_choices_share_same_next_scene_body_and_result',
  ],
} as const;

export const STORY_UPLOAD_IMPORT_EXPORT_MIGRATION_CONTRACT = {
  version: '2026-07-01.story-upload-import-export-migration.v1',
  status: 'mapping_contract_with_fixture_examples_only',
  stableIdentifiers: {
    workId: 'story_upload_work_id',
    sceneId: 'story_upload_scene_id',
    branchId: 'story_upload_branch_id',
    endingId: 'story_upload_ending_id',
    localeKey: 'story_upload_locale_key',
  },
  explicitlyNotSourceOfTruth: [
    'notion_page_id',
    'notion_block_id',
    'temporary_row_index',
    'private_account_id',
  ],
  exportFieldAllowlist: [
    'workId',
    'sceneId',
    'branchId',
    'choiceId',
    'endingId',
    'localeKey',
    'reviewStatus',
    'blockerReasonKeys',
  ],
  exportFieldDenylist: [
    'rawCredential',
    'privateAccountId',
    'providerPayload',
    'paymentInternalValue',
    'settlementInternalValue',
    'walletLedgerId',
    'signedUrl',
    'storageKey',
  ],
  fixtureExamples: [
    {
      workId: 'story-upload-work-fixture',
      sceneId: 'scene-001',
      branchId: 'B01',
      endingId: 'ending-writer-primary',
      reviewStatus: 'pm_review',
    },
  ],
  mutationPolicy: {
    migrationWrite: false,
    uploadWrite: false,
    paymentMutation: false,
    settlementMutation: false,
    walletMutation: false,
  },
} as const;

export const STORY_UPLOAD_REVIEW_WORKFLOW_CONTRACT = {
  version: '2026-07-01.story-upload-review-workflow.v1',
  status: 'workflow_contract_only',
  statuses: STORY_UPLOAD_REVIEW_STATUSES,
  allowedTransitions: [
    ['draft', 'pm_review'],
    ['pm_review', 'needs_revision'],
    ['pm_review', 'locale_ready'],
    ['locale_ready', 'qa_ready'],
    ['qa_ready', 'publish_ready'],
    ['pm_review', 'blocked'],
    ['needs_revision', 'pm_review'],
  ],
  blockerReasonKeys: [
    'storyUpload.blocker.copyrightReviewRequired',
    'storyUpload.blocker.cthulhuDerivativeReviewRequired',
    'storyUpload.blocker.aiFallbackEndingLabelRequired',
    'storyUpload.blocker.publicSourceBoundaryUnclear',
    'storyUpload.blocker.privateOrProviderDataDetected',
  ],
  handoffGates: {
    emilyLocalePackage: {
      requiresStatus: 'locale_ready',
      requiresNoBlockerReason: true,
    },
    viewerMobileReview: {
      requiresStatus: 'qa_ready',
      primaryMobileWidth: '390-400px',
    },
    qaContractReview: {
      requiresStatus: 'qa_ready',
      noRawKeyVisible: true,
    },
  },
  copyrightBoundary:
    PUBLIC_SOURCE_STORY_COPYRIGHT_BOUNDARY_CONTRACT,
  mutationPolicy: {
    publishMutation: false,
    providerGeneration: false,
    paymentMutation: false,
    walletMutation: false,
  },
} as const;

export const STORY_UPLOAD_I18N_HANDOFF_KEY_PACKAGE = {
  version: '2026-07-01.story-upload-i18n-handoff-key-package.v1',
  status: 'i18n_key_package_contract_only',
  localeSlots: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
  requiredKeyGroups: {
    buttons: [
      'storyUpload.button.saveDraft',
      'storyUpload.button.requestReview',
      'storyUpload.button.importPreview',
      'storyUpload.button.exportContract',
    ],
    statuses: STORY_UPLOAD_INTAKE_API_CONTRACT.mobileStatusKeys,
    warnings: STORY_UPLOAD_REVIEW_WORKFLOW_CONTRACT.blockerReasonKeys,
    endingTypes: [
      'storyUpload.ending.writerPrimary',
      'storyUpload.ending.writerSub',
      'storyUpload.ending.aiFallback',
    ],
  },
  mobileCopyLimits: {
    primaryMobileWidth: '390-400px',
    buttonMaxCharactersKo: 8,
    statusMaxCharactersKo: 10,
    warningShortLabelMaxCharactersKo: 14,
    allowDetailCopyInSheetBody: true,
  },
  rawKeyPolicy: {
    rawKeyVisible: false,
    singleLocaleOnlyAllowed: false,
    fallbackLocale: 'ko',
    missingTranslationBlocksQaReady: true,
  },
} as const;

export const STORY_UPLOAD_INTAKE_FORBIDDEN_FIELDS = [
  'token',
  'password',
  'cookie',
  'apiKey',
  'rawEmail',
  'dbUrl',
  'rawCredential',
  'privateAccountId',
  'providerPayload',
  'paymentInternalValue',
  'settlementInternalValue',
  'walletLedgerId',
  'storageKey',
  'signedUrl',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function findStoryUploadIntakeSensitiveFieldViolations(
  candidate: unknown,
  path = '',
): string[] {
  const forbidden = new Set<string>(STORY_UPLOAD_INTAKE_FORBIDDEN_FIELDS);

  if (Array.isArray(candidate)) {
    return candidate.flatMap((item, index) =>
      findStoryUploadIntakeSensitiveFieldViolations(
        item,
        `${path}[${index}]`,
      ),
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
      ...findStoryUploadIntakeSensitiveFieldViolations(value, fieldPath),
    ];
  });
}

export const STORY_UPLOAD_CONTRACT_BUNDLE = {
  version: '2026-07-11.story-upload-contract-bundle.v2',
  status: 'contract_bundle_only',
  intakeApi: STORY_UPLOAD_INTAKE_API_CONTRACT,
  manuscriptSceneChoiceEndingSchema:
    WRITER_MANUSCRIPT_SCENE_CHOICE_ENDING_SCHEMA,
  importExportMigration: STORY_UPLOAD_IMPORT_EXPORT_MIGRATION_CONTRACT,
  reviewWorkflow: STORY_UPLOAD_REVIEW_WORKFLOW_CONTRACT,
  i18nHandoffKeyPackage: STORY_UPLOAD_I18N_HANDOFF_KEY_PACKAGE,
  sensitiveFieldGuard: {
    forbiddenFields: STORY_UPLOAD_INTAKE_FORBIDDEN_FIELDS,
    rawEmailAllowed: false,
    credentialAllowed: false,
    providerPayloadAllowed: false,
  },
  mutationPolicy: {
    uploadWrite: true,
    intakeDbWrite: true,
    objectStorageWrite: true,
    publishMutation: false,
    migrationWrite: false,
    providerGeneration: false,
    paymentMutation: false,
    walletMutation: false,
    settlementMutation: false,
    payoutMutation: false,
  },
} as const;

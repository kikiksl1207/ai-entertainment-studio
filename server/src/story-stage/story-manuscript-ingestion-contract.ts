import {
  STORY_SCENE_ALLOWED_CHARACTER_FIELDS,
  STORY_SCENE_ALLOWED_RESPONSE_FIELDS,
} from './story-scene-read-model';
import { IMMERSIVE_STORY_PLAYER_REQUIRED_FIELDS } from './story-immersive-experience-contract';
import { STORY_ROUTE_SUPPORTED_LOCALE_SLOTS } from './story-route-relocation-contract';

export const STORY_MANUSCRIPT_MARKER_TOKENS = {
  branch: '[branch Bxx]',
  scene: '[scene n]',
  sceneVariant: '[scene nA]',
  commonScene: '[common scene n]',
  background: '[background]',
  cast: '[cast]',
  narration: '[narration]',
  dialogue: '[dialogue]',
} as const;

export const STORY_CHAT_PLAY_SCENE_READ_MODEL_SUPPORT_CONTRACT = {
  version: '2026-07-01.story-chat-play-scene-read-model-support.v1',
  status: 'read_model_support_contract_only',
  surfaces: ['story_player_current_scene', 'story_player_chat_turns'],
  playerRequiredFields: IMMERSIVE_STORY_PLAYER_REQUIRED_FIELDS,
  sceneAssetFields: [
    'sceneId',
    'backgroundAsset',
    'backgroundPromptKey',
    'backgroundState',
    'characters',
    'characterPose',
    'entranceState',
    'fallbackKey',
  ],
  sceneProjectionCompatibility: {
    allowedSceneFields: STORY_SCENE_ALLOWED_RESPONSE_FIELDS,
    allowedCharacterFields: STORY_SCENE_ALLOWED_CHARACTER_FIELDS,
    chatTurnsReferenceSceneId: true,
    choicesReferenceNextSceneHint: true,
    currentSceneIsAuthoritative: true,
  },
  fixtureCoverage: {
    minimumScenes: 3,
    includesBackgroundChange: true,
    includesCharacterPresentScene: true,
    includesCharacterAbsentScene: true,
    includesFallbackBackgroundScene: true,
  },
  i18n: {
    supportedLocaleSlots: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
    fallbackKeyRequired: true,
    rawKeyVisible: false,
  },
  privacy: {
    rawPromptReturned: false,
    providerPayloadReturned: false,
    storageKeyReturned: false,
    signedUrlReturned: false,
    privateNoteReturned: false,
  },
  mutationPolicy: {
    providerGeneration: false,
    assetUploadIntentCreate: false,
    assetCreate: false,
    storyWrite: false,
    storyProgressMutation: false,
    paymentMutation: false,
    walletMutation: false,
  },
} as const;

export const WRITER_MANUSCRIPT_HANDOFF_FORMAT_CONTRACT = {
  version: '2026-07-01.writer-manuscript-handoff-format.v1',
  status: 'handoff_format_contract_only',
  acceptedSubmissionShape: {
    primaryDocument: 'long_body_manuscript',
    branchMarkersRequired: true,
    sceneMarkersRequired: true,
    backgroundMarkersRequired: true,
    castMarkersRecommended: true,
  },
  deprecatedShape: {
    gameDesignDocFirst: false,
    userRoleSheetFirst: false,
    choiceSpreadsheetFirst: false,
  },
  markerTokens: STORY_MANUSCRIPT_MARKER_TOKENS,
  parserReadySections: [
    'longBodyBeforeFirstBranch',
    'branchMarker',
    'branchContinuationBody',
    'sceneMarker',
    'backgroundMarker',
    'castMarker',
  ],
  minimumPolicy: {
    minimumBodyCharactersBeforeFirstBranch: 1200,
    branchMarkerIdPattern: 'B\\d{2}',
    sceneMarkerIdPattern: '\\d+[A-Z]?',
    everySceneNeedsBackgroundOrFallback: true,
  },
  downstreamHandoff: {
    copyAndTranslationOwner: 'emily',
    localeSlots: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
    luffyScope: 'manuscript_receipt_contract_only',
  },
} as const;

export const STORY_BRANCH_MARKER_INGESTION_CONTRACT = {
  version: '2026-07-01.story-branch-marker-ingestion.v1',
  status: 'data_model_contract_only',
  acceptedMarkers: {
    branch: STORY_MANUSCRIPT_MARKER_TOKENS.branch,
    sceneVariant: STORY_MANUSCRIPT_MARKER_TOKENS.sceneVariant,
    commonScene: STORY_MANUSCRIPT_MARKER_TOKENS.commonScene,
  },
  graphModel: {
    nodeTypes: ['scene', 'choice', 'merge'],
    branchIdField: 'branchId',
    sceneIdField: 'sceneId',
    choiceIdField: 'choiceId',
    mergeTargetSceneIdField: 'mergeTargetSceneId',
    branchesMayRejoinCommonScene: true,
    fullyDivergentBranchesRequired: false,
  },
  choiceSemantics: {
    mustNotBeTriviaAnswer: true,
    allowedAxes: ['personality', 'strategy', 'relationship', 'risk'],
    labelKeyRequired: true,
    nextSceneHintRequired: true,
  },
  ingestionOrder: [
    'normalize_marker_tokens',
    'create_scene_nodes',
    'create_choice_edges',
    'attach_merge_targets',
    'return_read_model_without_progress_write',
  ],
  mutationPolicy: {
    contractAddsEndpoint: false,
    storyWrite: false,
    storyProgressMutation: false,
    paymentMutation: false,
    providerGeneration: false,
  },
} as const;

export const MANUSCRIPT_SCENE_EXTRACTION_CONTRACT = {
  version: '2026-07-01.manuscript-scene-extraction.v1',
  status: 'scene_extraction_contract_only',
  sourceMarkers: {
    scene: STORY_MANUSCRIPT_MARKER_TOKENS.scene,
    background: STORY_MANUSCRIPT_MARKER_TOKENS.background,
    cast: STORY_MANUSCRIPT_MARKER_TOKENS.cast,
    narration: STORY_MANUSCRIPT_MARKER_TOKENS.narration,
    dialogue: STORY_MANUSCRIPT_MARKER_TOKENS.dialogue,
  },
  extractedSceneFields: [
    'sceneId',
    'sceneText',
    'narrationBlocks',
    'dialogueTurns',
    'backgroundAssetHintKey',
    'backgroundPromptKey',
    'backgroundState',
    'characters',
    'fallbackKey',
  ],
  backgroundPolicy: {
    minimumBackgroundsPerScene: 1,
    missingBackgroundRequiresFallbackKey: true,
    rawPromptAsUserCopyAllowed: false,
  },
  characterPolicy: {
    charactersUseProjectionFields: STORY_SCENE_ALLOWED_CHARACTER_FIELDS,
    entranceStateRequired: true,
    exitCanMapToEntranceState: 'exiting',
    absentCanMapToLayer: 'offscreen',
  },
  privacy: {
    rawPromptReturned: false,
    providerPayloadReturned: false,
    privateNoteReturned: false,
    storageKeyReturned: false,
    signedUrlReturned: false,
  },
  mutationPolicy: {
    providerGeneration: false,
    storyWrite: false,
    storyProgressMutation: false,
    paymentMutation: false,
    walletMutation: false,
  },
} as const;

export const PUBLIC_SOURCE_STORY_COPYRIGHT_BOUNDARY_CONTRACT = {
  version: '2026-07-01.public-source-story-copyright-boundary.v1',
  status: 'copyright_boundary_contract_only',
  allowedSourceClasses: [
    'public_domain_history',
    'public_domain_myth',
    'public_domain_classic_literature',
    'operator_approved_original_outline',
  ],
  forbiddenReferenceClasses: [
    'modern_game_unique_expression',
    'modern_webtoon_unique_expression',
    'modern_anime_unique_expression',
    'modern_drama_unique_expression',
    'modern_translation_unique_wording',
    'brand_character_or_logo',
  ],
  rewritePolicy: {
    luminaOriginalVoiceRequired: true,
    originalSceneCompositionRequired: true,
    originalCharacterInterpretationRequired: true,
    copiedModernTranslationAllowed: false,
  },
  specialReviewTopics: {
    cthulhuOrLaterDerivativeSettingRequiresPmReview: true,
    livingAuthorOrRecentTranslationRequiresPmReview: true,
    uncertainPublicDomainStatusRequiresPmReview: true,
  },
  handoffChecklistForEmily: [
    'forbiddenReferenceClasses',
    'rewritePolicy',
    'specialReviewTopics',
    'localeSlots',
  ],
  localeSlots: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
} as const;

export const STORY_MANUSCRIPT_INGESTION_FORBIDDEN_FIELDS = [
  'token',
  'password',
  'cookie',
  'apiKey',
  'rawEmail',
  'dbUrl',
  'providerPayload',
  'rawPrompt',
  'privateNote',
  'storageKey',
  'signedUrl',
  'paymentOrderId',
  'walletLedgerId',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function findStoryManuscriptSensitiveFieldViolations(
  candidate: unknown,
  path = '',
): string[] {
  const forbidden = new Set<string>(
    STORY_MANUSCRIPT_INGESTION_FORBIDDEN_FIELDS,
  );

  if (Array.isArray(candidate)) {
    return candidate.flatMap((item, index) =>
      findStoryManuscriptSensitiveFieldViolations(item, `${path}[${index}]`),
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
      ...findStoryManuscriptSensitiveFieldViolations(value, fieldPath),
    ];
  });
}

export const STORY_MANUSCRIPT_PIPELINE_CONTRACT = {
  version: '2026-07-01.story-manuscript-pipeline.v1',
  status: 'contract_bundle_only',
  chatPlaySceneReadModelSupport:
    STORY_CHAT_PLAY_SCENE_READ_MODEL_SUPPORT_CONTRACT,
  writerManuscriptHandoffFormat:
    WRITER_MANUSCRIPT_HANDOFF_FORMAT_CONTRACT,
  branchMarkerIngestion: STORY_BRANCH_MARKER_INGESTION_CONTRACT,
  manuscriptSceneExtraction: MANUSCRIPT_SCENE_EXTRACTION_CONTRACT,
  publicSourceCopyrightBoundary:
    PUBLIC_SOURCE_STORY_COPYRIGHT_BOUNDARY_CONTRACT,
  sensitiveFieldGuard: {
    forbiddenFields: STORY_MANUSCRIPT_INGESTION_FORBIDDEN_FIELDS,
    rawEmailAllowed: false,
    credentialAllowed: false,
    providerPayloadAllowed: false,
  },
  mutationPolicy: {
    providerGeneration: false,
    storyWrite: false,
    storyProgressMutation: false,
    assetUploadIntentCreate: false,
    assetCreate: false,
    paymentMutation: false,
    walletMutation: false,
    settlementMutation: false,
    payoutMutation: false,
  },
} as const;

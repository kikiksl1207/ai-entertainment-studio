import { STORY_ROUTE_SUPPORTED_LOCALE_SLOTS } from './story-route-relocation-contract';

export const STORY_DISCOVERY_FILTER_IDS = [
  'recommended',
  'tasteMatch',
  'new',
  'ranking',
  'startToday',
  'genre',
] as const;

export const STORY_DISCOVERY_CARD_FIELDS = [
  'storyId',
  'slug',
  'titleKey',
  'coverImage',
  'genreKeys',
  'tagKeys',
  'viewCountLabelKey',
  'popularityLabelKey',
  'startState',
] as const;

export const STORY_DISCOVERY_FILTER_LIST_UX_CONTRACT = {
  version: '2026-07-01.story-discovery-filter-list-ux.v1',
  status: 'ux_data_contract_only',
  route: '/story-stage',
  surface: 'story_discovery',
  filters: STORY_DISCOVERY_FILTER_IDS,
  cardFields: STORY_DISCOVERY_CARD_FIELDS,
  startStates: ['free_prologue', 'continue', 'locked', 'coming_soon'],
  i18n: {
    supportedLocaleSlots: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
    requiredKeyPrefixes: [
      'storyStage.discovery.filter',
      'storyStage.discovery.card',
      'storyStage.discovery.status',
    ],
    rawKeyVisible: false,
  },
  responsivePolicy: {
    primaryMobileWidth: '390-400px',
    mobileColumns: [2, 1],
    minCardWidthPx: 164,
    searchAndFilterMayWrap: true,
    bottomTabOverlapAllowed: false,
  },
  noMutationPolicy: {
    storyWrite: false,
    storyProgressMutation: false,
    providerGeneration: false,
    paymentMutation: false,
    walletMutation: false,
  },
} as const;

export const STORY_DETAIL_PROLOGUE_PREVIEW_CONTRACT = {
  version: '2026-07-01.story-detail-prologue-preview.v1',
  status: 'detail_sheet_contract_only',
  entryFrom: 'story_discovery_card',
  surfaces: {
    desktop: 'modal',
    mobile: 'bottom_or_full_sheet',
  },
  fields: [
    'coverImage',
    'titleKey',
    'creatorDisplayKey',
    'aiArtistKeys',
    'tagKeys',
    'descriptionKey',
    'conversationProfile',
    'startSettings',
    'prologuePreview',
    'updatedAtLabelKey',
    'similarStories',
    'readOnlyStats',
  ],
  playCtaStates: {
    freePrologue: {
      state: 'free_prologue',
      ctaKey: 'storyStage.detail.cta.freePrologue',
      paymentPreviewRequired: false,
    },
    continue: {
      state: 'continue',
      ctaKey: 'storyStage.detail.cta.continue',
      paymentPreviewRequired: false,
    },
    purchaseRequired: {
      state: 'purchase_required',
      ctaKey: 'storyStage.detail.cta.purchaseRequired',
      paymentPreviewRequired: true,
    },
  },
  doubleChargeGuard: {
    freePrologueAndPurchaseCtaVisibleTogether: false,
    continueAndPurchaseCtaVisibleTogether: false,
    walletDebitFromPreviewAllowed: false,
  },
  readOnlyProjectionFields: ['comments', 'rating', 'completionReaders'],
  i18n: {
    supportedLocaleSlots: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
    longTitleMustWrap: true,
    chipTextMayWrap: true,
    rawKeyVisible: false,
  },
  noMutationPolicy: {
    storyWrite: false,
    storyProgressMutation: false,
    providerGeneration: false,
    paymentMutation: false,
    walletMutation: false,
  },
} as const;

export const IMMERSIVE_STORY_PLAYER_REQUIRED_FIELDS = [
  'sceneId',
  'sceneText',
  'backgroundAsset',
  'backgroundState',
  'characters',
  'chatTurns',
  'choices',
  'speaker',
  'nextSceneHint',
] as const;

export const IMMERSIVE_STORY_PLAYER_DATA_CONTRACT = {
  version: '2026-07-01.immersive-story-player-data.v1',
  status: 'read_model_contract_only',
  route: '/story-stage/play',
  requiredFields: IMMERSIVE_STORY_PLAYER_REQUIRED_FIELDS,
  chatTurnFields: [
    'turnId',
    'speaker',
    'speakerDisplayKey',
    'messageKey',
    'sceneId',
    'createdAt',
  ],
  choiceFields: ['choiceId', 'labelKey', 'toneKey', 'nextSceneHint'],
  choicePolicy: {
    defaultChoiceCount: 3,
    maxChoiceCount: 5,
    directInputVisibleInPublicMvp: false,
    directInputInternalTestOnly: true,
  },
  minimumStartDataPolicy: {
    defaultBackgroundRequired: true,
    shortPrologueRequired: true,
    inputCtaRequired: true,
    blankWhiteScreenAllowed: false,
  },
  richDataPolicy: {
    keepsTextAndImageFlow: true,
    currentSceneBackgroundStageRequired: true,
    chatTurnsMustReferenceSceneId: true,
    choicesMustReferenceNextSceneHint: true,
  },
  i18n: {
    supportedLocaleSlots: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
    requiredKeyPrefixes: [
      'storyStage.player.status',
      'storyStage.player.fallback',
      'storyStage.player.message',
      'storyStage.player.choice',
    ],
    rawKeyVisible: false,
  },
  mobileSafeAreaPolicy: {
    primaryMobileWidth: '390-400px',
    inputOrChoiceOverlayMustClearBottomTabbar: true,
    sceneTextMustNotOverlapChoices: true,
    backgroundMayRemainFullBleed: true,
  },
  noMutationPolicy: {
    providerGeneration: false,
    storyWrite: false,
    storyProgressMutation: false,
    paymentMutation: false,
    walletMutation: false,
  },
} as const;

export const TUTORIAL_FREE_PROLOGUE_RECOVERY_CONTRACT = {
  version: '2026-07-01.tutorial-free-prologue-recovery.v1',
  status: 'tutorial_contract_only',
  candidate: {
    slug: 'imjin-war-nanjung-ilgi-prologue',
    titleKey: 'storyStage.tutorial.imjinWarNanjungIlgi.title',
    descriptionKey: 'storyStage.tutorial.imjinWarNanjungIlgi.description',
    prologueKey: 'storyStage.tutorial.imjinWarNanjungIlgi.prologue',
    userRole: 'third_party_participant_not_original_protagonist',
  },
  scope: {
    freePrologue: true,
    maxAiArtistCompanions: 1,
    defaultChoiceCount: 3,
    continueAllowed: true,
    readOnlyStats: ['completionReaders', 'comments', 'rating'],
  },
  originalityPolicy: {
    copiesModernTranslation: false,
    copiesSpecificGameDesign: false,
    copiesSpecificWebtoonOrAnimeDesign: false,
    luminaOriginalInterpretationRequired: true,
  },
  i18n: {
    supportedLocaleSlots: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
    requiredKeys: [
      'storyStage.tutorial.imjinWarNanjungIlgi.title',
      'storyStage.tutorial.imjinWarNanjungIlgi.description',
      'storyStage.tutorial.imjinWarNanjungIlgi.prologue',
      'storyStage.tutorial.imjinWarNanjungIlgi.cta',
    ],
    rawKeyVisible: false,
  },
  mobileCtaPolicy: {
    primaryMobileWidth: '390-400px',
    ctaWrapAllowed: true,
    ctaOverlapAllowed: false,
  },
  noMutationPolicy: {
    storyWrite: false,
    storyProgressMutation: false,
    providerGeneration: false,
    paymentMutation: false,
    walletMutation: false,
  },
} as const;

export const STORY_IMMERSIVE_EXPERIENCE_FORBIDDEN_FIELDS = [
  'token',
  'password',
  'cookie',
  'apiKey',
  'rawEmail',
  'dbUrl',
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

export function findImmersiveStorySensitiveFieldViolations(
  candidate: unknown,
  path = '',
): string[] {
  const forbidden = new Set<string>(
    STORY_IMMERSIVE_EXPERIENCE_FORBIDDEN_FIELDS,
  );

  if (Array.isArray(candidate)) {
    return candidate.flatMap((item, index) =>
      findImmersiveStorySensitiveFieldViolations(item, `${path}[${index}]`),
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
      ...findImmersiveStorySensitiveFieldViolations(value, fieldPath),
    ];
  });
}

export const STORY_IMMERSIVE_EXPERIENCE_CONTRACT = {
  version: '2026-07-01.story-immersive-experience.v1',
  status: 'contract_bundle_only',
  discoveryFilterListUx: STORY_DISCOVERY_FILTER_LIST_UX_CONTRACT,
  detailProloguePreview: STORY_DETAIL_PROLOGUE_PREVIEW_CONTRACT,
  playerData: IMMERSIVE_STORY_PLAYER_DATA_CONTRACT,
  tutorialFreePrologueRecovery: TUTORIAL_FREE_PROLOGUE_RECOVERY_CONTRACT,
  sensitiveFieldGuard: {
    forbiddenFields: STORY_IMMERSIVE_EXPERIENCE_FORBIDDEN_FIELDS,
    rawEmailAllowed: false,
    credentialAllowed: false,
    providerPayloadAllowed: false,
  },
  noMutationPolicy: {
    providerGeneration: false,
    storyWrite: false,
    storyProgressMutation: false,
    paymentMutation: false,
    walletMutation: false,
    settlementMutation: false,
    payoutMutation: false,
  },
} as const;

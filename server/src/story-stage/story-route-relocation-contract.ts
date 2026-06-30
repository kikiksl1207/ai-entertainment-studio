export const STORY_ROUTE_SUPPORTED_LOCALE_SLOTS = [
  'ko',
  'en',
  'ja',
  'zh-Hans',
  'zh-Hant',
] as const;

export const STORY_ROUTE_REGIONAL_LOCALE_TAGS = {
  ko: 'ko-KR',
  en: 'en-US',
  ja: 'ja-JP',
  'zh-Hans': 'zh-CN',
  'zh-Hant': 'zh-Hant',
} as const;

export const STORY_STAGE_I18N_RUNTIME_EXPOSURE_CONTRACT = {
  version: '2026-06-30.story-stage-i18n-runtime-exposure.v1',
  status: 'runtime_contract_only',
  runtimeGlobal: {
    name: 'window.luminaI18n',
    requiredMethods: ['getLocale', 't', 'apply'],
    storyStageMayRead: true,
    storyStageMayMutateLocale: false,
  },
  localeSlots: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
  regionalTagMapping: STORY_ROUTE_REGIONAL_LOCALE_TAGS,
  lookupOrder: [
    'window.luminaI18n.t',
    'story_stage_page_copy_bundle',
    'document.documentElement.lang',
    'ko-KR',
  ],
  rawKeyExposurePolicy: {
    sceneCopyMayRenderRawKey: false,
    fallbackCopyMayRenderRawKey: false,
    missingTranslationUsesUserSafeFallback: true,
  },
  testCriteria: {
    localeSwitchMustAffectStorySceneCopy: true,
    backgroundAndCharacterAltUseI18nKeys: true,
    providerPromptMayNotBeFallbackCopy: true,
  },
  mutationPolicy: {
    providerCall: false,
    storyProgressMutation: false,
    storySceneWrite: false,
    paymentMutation: false,
    walletMutation: false,
  },
} as const;

export const LUMINA_FEED_SHORTFORM_EMBEDDED_DATA_CONTRACT = {
  version: '2026-06-30.lumina-feed-shortform-embedded-data.v1',
  status: 'read_only_data_contract',
  surface: {
    route: '/lumina-feed',
    query: 'surface=shorts',
    surfaceKey: 'luminaFeed.surface.shorts',
    reusesExistingShortformData: true,
  },
  sourcePriority: [
    'GET /api/v1/shortforms',
    'window.LuminaStaticData.shortformsLocal',
    'empty_state_copy_key',
  ],
  itemFields: [
    'id',
    'slug',
    'titleKey',
    'thumbnailUrl',
    'videoUrl',
    'artistSlug',
    'durationSeconds',
    'publishedAt',
  ],
  mobileDataPolicy: {
    composerStateSharedWithFeedPosts: false,
    feedTabsRemainAddressable: true,
    shortformCardsDoNotRequireGlobalTab: true,
    primaryMobileWidth: '390-400px',
  },
  privacy: {
    rawStorageKeyReturned: false,
    signedUrlReturned: false,
    privateArtistMemoReturned: false,
    rawProviderPayloadReturned: false,
  },
  mutationPolicy: {
    feedPostMutation: false,
    shortformMutation: false,
    likeMutation: false,
    followMutation: false,
    blockMutation: false,
    reportMutation: false,
    paymentMutation: false,
  },
} as const;

export const SHORTFORM_LEGACY_ROUTE_COMPATIBILITY_CONTRACT = {
  version: '2026-06-30.shortform-legacy-route-compatibility.v1',
  status: 'route_compatibility_contract',
  recommendedMode: 'temporary_compatibility_with_feed_shorts_canonical',
  acceptedModes: [
    'temporary_compatibility_with_feed_shorts_canonical',
    'server_redirect_to_feed_shorts',
    'static 안내_to_feed_shorts',
  ],
  legacyRoute: '/shortform',
  canonicalTarget: '/lumina-feed?surface=shorts',
  preserveQueryAndHash: true,
  seoPolicy: {
    canonicalHref: '/lumina-feed',
    noindexLegacyDuringTransition: true,
    oldLinksMustNot404: true,
  },
  separationPolicy: {
    storyStagePath: '/story-stage',
    characterChatPath: '/character-chat',
    storyMustNotResolveToCharacterChat: true,
    legacyShortformMustNotActivateStoryTab: true,
  },
  mutationPolicy: {
    providerCall: false,
    storyProgressMutation: false,
    paymentMutation: false,
    feedPostMutation: false,
  },
} as const;

export const GLOBAL_NAV_STORY_TAB_ACTIVE_STATE_TEST_SKELETON = {
  version: '2026-06-30.global-nav-story-tab-active-state-test.v1',
  status: 'test_skeleton_contract',
  routeCases: [
    {
      route: '/story-stage',
      expectedActiveTab: 'story',
      expectedHref: '/story-stage',
    },
    {
      route: '/story-stage?storySceneFixturePreview=1',
      expectedActiveTab: 'story',
      expectedHref: '/story-stage',
    },
    {
      route: '/lumina-feed?surface=shorts',
      expectedActiveTab: 'lumina-feed',
      expectedSurface: 'shorts',
    },
    {
      route: '/shortform',
      expectedActiveTab: 'lumina-feed',
      expectedSurface: 'shorts',
      legacyRoute: true,
    },
    {
      route: '/character-chat',
      expectedActiveTab: 'character-chat',
      mustNotActivateStory: true,
    },
  ],
  labelFitPolicy: {
    primaryMobileWidth: '390-400px',
    supportedLocaleSlots: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
    maxMobileTabLines: 1,
    rawI18nKeyVisible: false,
  },
  noMutationTestMode: true,
} as const;

export const STORY_SHORTS_ROUTE_ANALYTICS_CONTRACT = {
  version: '2026-06-30.story-shorts-route-analytics.v1',
  status: 'read_only_analytics_contract',
  allowedEvents: [
    'story_tab_view',
    'feed_shorts_surface_view',
    'shortform_legacy_route_view',
  ],
  allowedPayloadFields: ['eventName', 'route', 'surface', 'locale'],
  allowedRoutes: ['/story-stage', '/lumina-feed', '/shortform'],
  allowedSurfaces: ['story', 'feed_shorts', 'shortform_legacy'],
  forbiddenPayloadFields: [
    'userToken',
    'rawEmail',
    'dbUserId',
    'cookie',
    'apiKey',
    'providerPayload',
    'storyProgressId',
    'paymentOrderId',
    'walletLedgerId',
  ],
  qaMode: {
    readOnlyVerification: true,
    mayUseBrowserEventSpy: true,
    serverMutationRequired: false,
  },
  mutationPolicy: {
    analyticsWriteRequiredForQa: false,
    postMutation: false,
    paymentMutation: false,
    walletMutation: false,
    storyProgressMutation: false,
    providerCall: false,
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function findStoryShortsAnalyticsPayloadViolations(
  payload: unknown,
): string[] {
  if (!isRecord(payload)) {
    return ['payload'];
  }

  const allowedFields = new Set<string>(
    STORY_SHORTS_ROUTE_ANALYTICS_CONTRACT.allowedPayloadFields,
  );
  const forbiddenFields = new Set<string>(
    STORY_SHORTS_ROUTE_ANALYTICS_CONTRACT.forbiddenPayloadFields,
  );

  return Object.keys(payload).filter(
    (field) => !allowedFields.has(field) || forbiddenFields.has(field),
  );
}

export const STORY_SHORTS_ROUTE_RELOCATION_CONTRACT = {
  version: '2026-06-30.story-shorts-route-relocation.v1',
  status: 'route_contract_only',
  routeAuthority: {
    storyCanonicalPath: '/story-stage',
    characterChatPath: '/character-chat',
    storyIsCharacterChat: false,
    shortformLegacyPath: '/shortform',
    luminaFeedPath: '/lumina-feed',
  },
  globalNavigation: {
    replaceShortformTabWithStory: true,
    desktopNavStoryHref: '/story-stage',
    mobileTabStoryHref: '/story-stage',
    storyNavKey: 'nav.storyStage',
    storyTabKey: 'tab.storyStage',
    removeGlobalShortformPrimaryTab: true,
  },
  shortformAbsorption: {
    targetSurface: '/lumina-feed?surface=shorts',
    surfaceKey: 'luminaFeed.surface.shorts',
    directShortformAccessMode: 'temporary_compat_or_redirect',
    directShortformTarget: '/lumina-feed?surface=shorts',
    preserveQueryAndHash: true,
  },
  seo: {
    storyCanonical: '/story-stage',
    shortformCanonicalTarget: '/lumina-feed',
    duplicateShortformCanonicalAllowed: false,
    legacyShortformNoindexDuringTransition: true,
  },
  responsiveContract: {
    primaryMobileWidth: '390-400px',
    storyTabMustFitBottomNav: true,
    feedShortsSurfaceMustNotOverlapComposer: true,
  },
  i18n: {
    supportedLocaleSlots: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
    requiredKeys: [
      'nav.storyStage',
      'tab.storyStage',
      'luminaFeed.surface.shorts',
      'shortform.redirect.shortLabel',
    ],
  },
  runtimeContracts: {
    storyStageI18n: STORY_STAGE_I18N_RUNTIME_EXPOSURE_CONTRACT,
    luminaFeedShortformEmbeddedData:
      LUMINA_FEED_SHORTFORM_EMBEDDED_DATA_CONTRACT,
    shortformLegacyRouteCompatibility:
      SHORTFORM_LEGACY_ROUTE_COMPATIBILITY_CONTRACT,
    globalNavStoryTabActiveState:
      GLOBAL_NAV_STORY_TAB_ACTIVE_STATE_TEST_SKELETON,
    readOnlyAnalytics: STORY_SHORTS_ROUTE_ANALYTICS_CONTRACT,
  },
  mutationPolicy: {
    providerCall: false,
    paymentMutation: false,
    walletMutation: false,
    storyProgressMutation: false,
    feedPostMutation: false,
    shortformMutation: false,
  },
} as const;

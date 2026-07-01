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

export const STORY_STAGE_RUNTIME_COPY_KEY_GROUPS = {
  nav: ['nav.storyStage', 'tab.storyStage'],
  status: [
    'storyStage.status.loading',
    'storyStage.status.ready',
    'storyStage.status.unavailable',
  ],
  fallback: [
    'storyStage.scene.assetFallback.default',
    'storyStage.scene.assetFallback.shortLabel',
    'storyStage.prologue.unavailable',
  ],
} as const;

export const STORY_STAGE_I18N_RUNTIME_EXPOSURE_CONTRACT = {
  version: '2026-07-01.story-stage-i18n-runtime-exposure.v2',
  status: 'runtime_contract_only',
  runtimeGlobal: {
    name: 'window.luminaI18n',
    requiredMethods: ['getLocale', 'setLocale', 't', 'apply'],
    requiredConstants: ['LOCALES'],
    storyStageMayRead: true,
    storyStageMayMutateLocale: false,
    storyStageLocaleSwitchMayCallSetLocale: true,
  },
  runtimeApi: {
    LOCALES: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
    getLocaleReturns: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
    setLocaleAccepts: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
    setLocaleRejectsUnsupportedLocale: true,
    regionalTagMapping: STORY_ROUTE_REGIONAL_LOCALE_TAGS,
  },
  localeSlots: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
  regionalTagMapping: STORY_ROUTE_REGIONAL_LOCALE_TAGS,
  lookupOrder: [
    'window.luminaI18n.t',
    'window.luminaI18n.LOCALES',
    'story_stage_page_copy_bundle',
    'document.documentElement.lang',
    'ko-KR',
  ],
  copyCoverage: {
    requiredKeyGroups: STORY_STAGE_RUNTIME_COPY_KEY_GROUPS,
    koHardcodedStatusCopyAllowed: false,
    koHardcodedFallbackCopyAllowed: false,
    koHardcodedNavCopyAllowed: false,
  },
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

export const STORY_STAGE_MOBILE_SAFE_AREA_CONTRACT = {
  version: '2026-07-01.story-stage-mobile-safe-area.v1',
  status: 'responsive_contract_only',
  viewport: {
    primaryMobileWidth: '390-400px',
    orientation: 'portrait',
    safeAreaInsetSource: 'env(safe-area-inset-bottom)',
  },
  sceneRectCases: [
    {
      sceneOrdinal: 1,
      textBlock: 'story-scene-text',
      previewNav: 'story-scene-prev-next-nav',
      bottomTabbar: 'mobile-tabbar',
    },
    {
      sceneOrdinal: 2,
      textBlock: 'story-scene-text',
      previewNav: 'story-scene-prev-next-nav',
      bottomTabbar: 'mobile-tabbar',
    },
    {
      sceneOrdinal: 3,
      textBlock: 'story-scene-text',
      previewNav: 'story-scene-prev-next-nav',
      bottomTabbar: 'mobile-tabbar',
    },
  ],
  rectExpectations: {
    sceneStageMustContainBackground: true,
    textMustNotOverlapPreviewNav: true,
    previewNavMustNotOverlapBottomTabbar: true,
    textMustRemainReadableAboveBottomTabbar: true,
    characterLayerMayNotCoverChoiceOrNavControls: true,
  },
  spacingGuidance: {
    minTextToNavGapPx: 12,
    minNavToTabbarGapPx: 16,
    minStageInlinePaddingPx: 16,
    bottomPaddingFormula: 'tabbarHeight + safeAreaInsetBottom + 16px',
    choiceOverlayMaxHeight: '40vh',
  },
  qaMeasurementPolicy: {
    captureSceneOrdinals: [1, 2, 3],
    failOnAnyNegativeRectGap: true,
    failOnHorizontalOverflow: true,
    failOnRawI18nKey: true,
  },
  mutationPolicy: {
    providerCall: false,
    storyProgressMutation: false,
    storySceneWrite: false,
    paymentMutation: false,
    walletMutation: false,
  },
} as const;

export const LUMINA_FEED_SHORTS_SURFACE_FALLBACK_CONTRACT = {
  version: '2026-07-01.lumina-feed-shorts-surface-fallback.v1',
  status: 'read_only_surface_fallback_contract',
  surface: {
    route: '/lumina-feed',
    query: 'surface=shorts',
    readOnly: true,
  },
  fallbackStates: {
    loading: {
      state: 'loading',
      messageKey: 'feed.shorts.loading',
      skeletonAllowed: true,
    },
    empty: {
      state: 'empty',
      messageKey: 'feed.shorts.empty',
      primaryCtaKey: 'feed.shorts.discoverCta',
    },
    error: {
      state: 'error',
      messageKey: 'feed.shorts.error',
      retryCtaKey: 'feed.shorts.retry',
    },
  },
  failureRules: {
    missingShortformDataUsesEmptyState: true,
    apiFailureUsesErrorState: true,
    slowApiUsesLoadingStateBeforeError: true,
    composerAndPostStateIgnoredForShortsFallback: true,
  },
  i18nPolicy: {
    requiredKeys: [
      'feed.shorts.loading',
      'feed.shorts.empty',
      'feed.shorts.error',
      'feed.shorts.retry',
    ],
    supportedLocaleSlots: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
    rawKeyVisible: false,
  },
  mobileOverflowPolicy: {
    primaryMobileWidth: '390-400px',
    cardsMayWrap: true,
    horizontalScrollRequired: false,
    composerOverlapAllowed: false,
  },
  mutationPolicy: {
    feedPostMutation: false,
    likeMutation: false,
    followMutation: false,
    blockMutation: false,
    reportMutation: false,
    paymentMutation: false,
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
  fallbackContract: LUMINA_FEED_SHORTS_SURFACE_FALLBACK_CONTRACT,
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
  redirectNoLoopPolicy: {
    normalizeTrailingSlashBeforeCompare: true,
    doNotRedirectWhenAlreadyAtCanonicalTarget: true,
    useHistoryReplaceForClientRedirect: true,
    maxRedirectsPerNavigation: 1,
    backButtonReturnsToPreviousNonLegacyRoute: true,
    preserveQueryAndHash: true,
    storyStageRouteExcluded: true,
    characterChatRouteExcluded: true,
  },
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

export const STORY_ROUTE_RELOCATION_DIFF_AUDIT_CONTRACT = {
  version: '2026-07-01.story-route-relocation-diff-audit.v1',
  status: 'qa_audit_checklist_contract',
  auditSource: {
    expectedContract: 'STORY_SHORTS_ROUTE_RELOCATION_CONTRACT',
    targetBranch: 'main_after_route_reflection',
    diffRequiresHumanReview: true,
  },
  routeCases: [
    {
      route: '/story-stage',
      expectedActiveTab: 'story',
      expectedCanonical: '/story-stage',
    },
    {
      route: '/lumina-feed?surface=shorts',
      expectedActiveTab: 'lumina-feed',
      expectedSurface: 'shorts',
    },
    {
      route: '/shortform',
      expectedActiveTab: 'lumina-feed',
      expectedTarget: '/lumina-feed?surface=shorts',
      noLoopRequired: true,
    },
    {
      route: '/character-chat',
      expectedActiveTab: 'character-chat',
      storyRouteMustStaySeparate: true,
    },
  ],
  checklist: {
    mobileWidth: '390-400px',
    localeSlots: STORY_ROUTE_SUPPORTED_LOCALE_SLOTS,
    noRawI18nKey: true,
    noMutationRequired: true,
    includesDesktopAndMobileNav: true,
  },
  failConditions: [
    'story_stage_resolves_to_character_chat',
    'shortform_redirect_loop',
    'feed_shorts_surface_posts_or_likes',
    'mobile_tab_overlaps_story_stage_controls',
    'raw_i18n_key_visible',
    'payment_wallet_story_progress_or_provider_mutation',
  ],
  handoffConsumers: ['qa1', 'viewer', 'zoro'],
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
    storyStageMobileSafeArea: STORY_STAGE_MOBILE_SAFE_AREA_CONTRACT,
    luminaFeedShortformEmbeddedData:
      LUMINA_FEED_SHORTFORM_EMBEDDED_DATA_CONTRACT,
    luminaFeedShortsSurfaceFallback:
      LUMINA_FEED_SHORTS_SURFACE_FALLBACK_CONTRACT,
    shortformLegacyRouteCompatibility:
      SHORTFORM_LEGACY_ROUTE_COMPATIBILITY_CONTRACT,
    globalNavStoryTabActiveState:
      GLOBAL_NAV_STORY_TAB_ACTIVE_STATE_TEST_SKELETON,
    readOnlyAnalytics: STORY_SHORTS_ROUTE_ANALYTICS_CONTRACT,
    routeRelocationDiffAudit: STORY_ROUTE_RELOCATION_DIFF_AUDIT_CONTRACT,
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

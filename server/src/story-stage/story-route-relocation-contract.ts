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
    supportedLocaleSlots: ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'],
    requiredKeys: [
      'nav.storyStage',
      'tab.storyStage',
      'luminaFeed.surface.shorts',
      'shortform.redirect.shortLabel',
    ],
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

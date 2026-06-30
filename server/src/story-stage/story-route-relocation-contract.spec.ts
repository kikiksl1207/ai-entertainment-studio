import { STORY_STAGE_CONTRACT } from './story-stage-contract';
import {
  findStoryShortsAnalyticsPayloadViolations,
  GLOBAL_NAV_STORY_TAB_ACTIVE_STATE_TEST_SKELETON,
  LUMINA_FEED_SHORTFORM_EMBEDDED_DATA_CONTRACT,
  SHORTFORM_LEGACY_ROUTE_COMPATIBILITY_CONTRACT,
  STORY_SHORTS_ROUTE_ANALYTICS_CONTRACT,
  STORY_SHORTS_ROUTE_RELOCATION_CONTRACT,
  STORY_STAGE_I18N_RUNTIME_EXPOSURE_CONTRACT,
} from './story-route-relocation-contract';

describe('Story and shorts route relocation contract', () => {
  it('keeps Story Stage canonical and separate from character chat', () => {
    expect(STORY_STAGE_CONTRACT.storyShortsRouteRelocation).toBe(
      STORY_SHORTS_ROUTE_RELOCATION_CONTRACT,
    );
    expect(
      STORY_SHORTS_ROUTE_RELOCATION_CONTRACT.routeAuthority,
    ).toMatchObject({
      storyCanonicalPath: '/story-stage',
      characterChatPath: '/character-chat',
      storyIsCharacterChat: false,
      shortformLegacyPath: '/shortform',
      luminaFeedPath: '/lumina-feed',
    });
  });

  it('moves the global shortform slot to Story and absorbs shorts into Lumina Feed', () => {
    expect(
      STORY_SHORTS_ROUTE_RELOCATION_CONTRACT.globalNavigation,
    ).toMatchObject({
      replaceShortformTabWithStory: true,
      desktopNavStoryHref: '/story-stage',
      mobileTabStoryHref: '/story-stage',
      removeGlobalShortformPrimaryTab: true,
    });
    expect(
      STORY_SHORTS_ROUTE_RELOCATION_CONTRACT.shortformAbsorption,
    ).toMatchObject({
      targetSurface: '/lumina-feed?surface=shorts',
      directShortformAccessMode: 'temporary_compat_or_redirect',
      directShortformTarget: '/lumina-feed?surface=shorts',
      preserveQueryAndHash: true,
    });
  });

  it('defines SEO, i18n, mobile, and no-mutation boundaries', () => {
    expect(STORY_SHORTS_ROUTE_RELOCATION_CONTRACT.seo).toMatchObject({
      storyCanonical: '/story-stage',
      shortformCanonicalTarget: '/lumina-feed',
      duplicateShortformCanonicalAllowed: false,
    });
    expect(STORY_SHORTS_ROUTE_RELOCATION_CONTRACT.i18n).toMatchObject({
      supportedLocaleSlots: ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'],
    });
    expect(STORY_SHORTS_ROUTE_RELOCATION_CONTRACT.i18n.requiredKeys).toEqual(
      expect.arrayContaining([
        'nav.storyStage',
        'tab.storyStage',
        'luminaFeed.surface.shorts',
        'shortform.redirect.shortLabel',
      ]),
    );
    expect(
      STORY_SHORTS_ROUTE_RELOCATION_CONTRACT.responsiveContract,
    ).toMatchObject({
      primaryMobileWidth: '390-400px',
      storyTabMustFitBottomNav: true,
      feedShortsSurfaceMustNotOverlapComposer: true,
    });
    expect(
      Object.values(
        STORY_SHORTS_ROUTE_RELOCATION_CONTRACT.mutationPolicy,
      ).every((enabled) => enabled === false),
    ).toBe(true);
  });

  it('contracts Story Stage i18n runtime exposure without locale mutation', () => {
    expect(
      STORY_SHORTS_ROUTE_RELOCATION_CONTRACT.runtimeContracts.storyStageI18n,
    ).toBe(STORY_STAGE_I18N_RUNTIME_EXPOSURE_CONTRACT);
    expect(STORY_STAGE_I18N_RUNTIME_EXPOSURE_CONTRACT.runtimeGlobal).toMatchObject(
      {
        name: 'window.luminaI18n',
        requiredMethods: ['getLocale', 't', 'apply'],
        storyStageMayRead: true,
        storyStageMayMutateLocale: false,
      },
    );
    expect(
      STORY_STAGE_I18N_RUNTIME_EXPOSURE_CONTRACT.regionalTagMapping,
    ).toMatchObject({
      ko: 'ko-KR',
      en: 'en-US',
      ja: 'ja-JP',
      'zh-Hans': 'zh-CN',
      'zh-Hant': 'zh-Hant',
    });
    expect(
      STORY_STAGE_I18N_RUNTIME_EXPOSURE_CONTRACT.rawKeyExposurePolicy,
    ).toMatchObject({
      sceneCopyMayRenderRawKey: false,
      fallbackCopyMayRenderRawKey: false,
      missingTranslationUsesUserSafeFallback: true,
    });
    expect(
      Object.values(
        STORY_STAGE_I18N_RUNTIME_EXPOSURE_CONTRACT.mutationPolicy,
      ).every((enabled) => enabled === false),
    ).toBe(true);
  });

  it('defines Lumina Feed embedded shorts data as read-only reusable shortform data', () => {
    expect(
      STORY_SHORTS_ROUTE_RELOCATION_CONTRACT.runtimeContracts
        .luminaFeedShortformEmbeddedData,
    ).toBe(LUMINA_FEED_SHORTFORM_EMBEDDED_DATA_CONTRACT);
    expect(LUMINA_FEED_SHORTFORM_EMBEDDED_DATA_CONTRACT.surface).toMatchObject({
      route: '/lumina-feed',
      query: 'surface=shorts',
      reusesExistingShortformData: true,
    });
    expect(LUMINA_FEED_SHORTFORM_EMBEDDED_DATA_CONTRACT.sourcePriority).toEqual([
      'GET /api/v1/shortforms',
      'window.LuminaStaticData.shortformsLocal',
      'empty_state_copy_key',
    ]);
    expect(LUMINA_FEED_SHORTFORM_EMBEDDED_DATA_CONTRACT.itemFields).toEqual(
      expect.arrayContaining(['slug', 'titleKey', 'thumbnailUrl', 'videoUrl']),
    );
    expect(
      Object.values(
        LUMINA_FEED_SHORTFORM_EMBEDDED_DATA_CONTRACT.mutationPolicy,
      ).every((enabled) => enabled === false),
    ).toBe(true);
  });

  it('keeps legacy shortform route compatible without mixing Story or Character Chat', () => {
    expect(
      STORY_SHORTS_ROUTE_RELOCATION_CONTRACT.runtimeContracts
        .shortformLegacyRouteCompatibility,
    ).toBe(SHORTFORM_LEGACY_ROUTE_COMPATIBILITY_CONTRACT);
    expect(SHORTFORM_LEGACY_ROUTE_COMPATIBILITY_CONTRACT).toMatchObject({
      legacyRoute: '/shortform',
      canonicalTarget: '/lumina-feed?surface=shorts',
      preserveQueryAndHash: true,
    });
    expect(
      SHORTFORM_LEGACY_ROUTE_COMPATIBILITY_CONTRACT.separationPolicy,
    ).toMatchObject({
      storyStagePath: '/story-stage',
      characterChatPath: '/character-chat',
      storyMustNotResolveToCharacterChat: true,
      legacyShortformMustNotActivateStoryTab: true,
    });
  });

  it('publishes active-state route cases for Story, Feed shorts, legacy shortform, and character chat', () => {
    expect(
      STORY_SHORTS_ROUTE_RELOCATION_CONTRACT.runtimeContracts
        .globalNavStoryTabActiveState,
    ).toBe(GLOBAL_NAV_STORY_TAB_ACTIVE_STATE_TEST_SKELETON);
    expect(GLOBAL_NAV_STORY_TAB_ACTIVE_STATE_TEST_SKELETON.routeCases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route: '/story-stage',
          expectedActiveTab: 'story',
        }),
        expect.objectContaining({
          route: '/lumina-feed?surface=shorts',
          expectedActiveTab: 'lumina-feed',
          expectedSurface: 'shorts',
        }),
        expect.objectContaining({
          route: '/shortform',
          expectedActiveTab: 'lumina-feed',
          legacyRoute: true,
        }),
        expect.objectContaining({
          route: '/character-chat',
          expectedActiveTab: 'character-chat',
          mustNotActivateStory: true,
        }),
      ]),
    );
    expect(
      GLOBAL_NAV_STORY_TAB_ACTIVE_STATE_TEST_SKELETON.labelFitPolicy,
    ).toMatchObject({
      primaryMobileWidth: '390-400px',
      maxMobileTabLines: 1,
      rawI18nKeyVisible: false,
    });
  });

  it('allows only read-only route analytics payload fields', () => {
    expect(
      STORY_SHORTS_ROUTE_RELOCATION_CONTRACT.runtimeContracts.readOnlyAnalytics,
    ).toBe(STORY_SHORTS_ROUTE_ANALYTICS_CONTRACT);
    expect(STORY_SHORTS_ROUTE_ANALYTICS_CONTRACT.allowedEvents).toEqual([
      'story_tab_view',
      'feed_shorts_surface_view',
      'shortform_legacy_route_view',
    ]);
    expect(
      findStoryShortsAnalyticsPayloadViolations({
        eventName: 'story_tab_view',
        route: '/story-stage',
        surface: 'story',
        locale: 'ko',
      }),
    ).toEqual([]);
    expect(
      findStoryShortsAnalyticsPayloadViolations({
        eventName: 'feed_shorts_surface_view',
        route: '/lumina-feed',
        userToken: 'not-allowed',
        rawEmail: 'not-allowed',
      }),
    ).toEqual(['userToken', 'rawEmail']);
    expect(
      Object.values(STORY_SHORTS_ROUTE_ANALYTICS_CONTRACT.mutationPolicy).every(
        (enabled) => enabled === false,
      ),
    ).toBe(true);
  });
});

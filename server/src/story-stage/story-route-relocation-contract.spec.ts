import { STORY_STAGE_CONTRACT } from './story-stage-contract';
import { STORY_SHORTS_ROUTE_RELOCATION_CONTRACT } from './story-route-relocation-contract';

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
});

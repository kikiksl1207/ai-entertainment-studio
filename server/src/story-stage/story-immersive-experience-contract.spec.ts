import { STORY_STAGE_CONTRACT } from './story-stage-contract';
import {
  findImmersiveStorySensitiveFieldViolations,
  IMMERSIVE_STORY_PLAYER_DATA_CONTRACT,
  STORY_DETAIL_PROLOGUE_PREVIEW_CONTRACT,
  STORY_DISCOVERY_FILTER_LIST_UX_CONTRACT,
  STORY_IMMERSIVE_EXPERIENCE_CONTRACT,
  TUTORIAL_FREE_PROLOGUE_RECOVERY_CONTRACT,
} from './story-immersive-experience-contract';

describe('Immersive story experience contracts', () => {
  it('exposes discovery, detail, player, and tutorial contracts from the aggregate', () => {
    expect(STORY_STAGE_CONTRACT.storyImmersiveExperience).toBe(
      STORY_IMMERSIVE_EXPERIENCE_CONTRACT,
    );
    expect(STORY_STAGE_CONTRACT.storyDiscoveryFilterListUx).toBe(
      STORY_DISCOVERY_FILTER_LIST_UX_CONTRACT,
    );
    expect(STORY_STAGE_CONTRACT.storyDetailProloguePreview).toBe(
      STORY_DETAIL_PROLOGUE_PREVIEW_CONTRACT,
    );
    expect(STORY_STAGE_CONTRACT.immersiveStoryPlayerData).toBe(
      IMMERSIVE_STORY_PLAYER_DATA_CONTRACT,
    );
    expect(STORY_STAGE_CONTRACT.tutorialFreePrologueRecovery).toBe(
      TUTORIAL_FREE_PROLOGUE_RECOVERY_CONTRACT,
    );
  });

  it('defines the Story Stage discovery filter and card list UX contract', () => {
    expect(STORY_DISCOVERY_FILTER_LIST_UX_CONTRACT).toMatchObject({
      route: '/story-stage',
      surface: 'story_discovery',
      filters: [
        'recommended',
        'tasteMatch',
        'new',
        'ranking',
        'startToday',
        'genre',
      ],
    });
    expect(STORY_DISCOVERY_FILTER_LIST_UX_CONTRACT.cardFields).toEqual(
      expect.arrayContaining([
        'titleKey',
        'coverImage',
        'genreKeys',
        'tagKeys',
        'viewCountLabelKey',
        'popularityLabelKey',
        'startState',
      ]),
    );
    expect(STORY_DISCOVERY_FILTER_LIST_UX_CONTRACT.responsivePolicy).toMatchObject(
      {
        primaryMobileWidth: '390-400px',
        mobileColumns: [2, 1],
        searchAndFilterMayWrap: true,
        bottomTabOverlapAllowed: false,
      },
    );
    expect(STORY_DISCOVERY_FILTER_LIST_UX_CONTRACT.i18n).toMatchObject({
      supportedLocaleSlots: ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'],
      rawKeyVisible: false,
    });
  });

  it('separates detail modal prologue CTA states without double-charge signals', () => {
    expect(STORY_DETAIL_PROLOGUE_PREVIEW_CONTRACT.surfaces).toMatchObject({
      desktop: 'modal',
      mobile: 'bottom_or_full_sheet',
    });
    expect(STORY_DETAIL_PROLOGUE_PREVIEW_CONTRACT.fields).toEqual(
      expect.arrayContaining([
        'conversationProfile',
        'startSettings',
        'prologuePreview',
        'similarStories',
        'readOnlyStats',
      ]),
    );
    expect(STORY_DETAIL_PROLOGUE_PREVIEW_CONTRACT.playCtaStates).toMatchObject({
      freePrologue: { paymentPreviewRequired: false },
      continue: { paymentPreviewRequired: false },
      purchaseRequired: { paymentPreviewRequired: true },
    });
    expect(STORY_DETAIL_PROLOGUE_PREVIEW_CONTRACT.doubleChargeGuard).toEqual({
      freePrologueAndPurchaseCtaVisibleTogether: false,
      continueAndPurchaseCtaVisibleTogether: false,
      walletDebitFromPreviewAllowed: false,
    });
  });

  it('defines the immersive player read model with scene background, chat, and choice data', () => {
    expect(IMMERSIVE_STORY_PLAYER_DATA_CONTRACT.requiredFields).toEqual([
      'sceneId',
      'sceneText',
      'backgroundAsset',
      'backgroundState',
      'characters',
      'chatTurns',
      'choices',
      'speaker',
      'nextSceneHint',
    ]);
    expect(IMMERSIVE_STORY_PLAYER_DATA_CONTRACT.choicePolicy).toMatchObject({
      defaultChoiceCount: 3,
      maxChoiceCount: 5,
      directInputVisibleInPublicMvp: false,
    });
    expect(
      IMMERSIVE_STORY_PLAYER_DATA_CONTRACT.minimumStartDataPolicy,
    ).toMatchObject({
      defaultBackgroundRequired: true,
      shortPrologueRequired: true,
      inputCtaRequired: true,
      blankWhiteScreenAllowed: false,
    });
    expect(IMMERSIVE_STORY_PLAYER_DATA_CONTRACT.mobileSafeAreaPolicy).toMatchObject(
      {
        primaryMobileWidth: '390-400px',
        inputOrChoiceOverlayMustClearBottomTabbar: true,
        sceneTextMustNotOverlapChoices: true,
      },
    );
  });

  it('recovers the tutorial free prologue as a Lumina-original third-party entry', () => {
    expect(TUTORIAL_FREE_PROLOGUE_RECOVERY_CONTRACT.candidate).toMatchObject({
      slug: 'imjin-war-nanjung-ilgi-prologue',
      titleKey: 'storyStage.tutorial.imjinWarNanjungIlgi.title',
      userRole: 'third_party_participant_not_original_protagonist',
    });
    expect(TUTORIAL_FREE_PROLOGUE_RECOVERY_CONTRACT.scope).toMatchObject({
      freePrologue: true,
      maxAiArtistCompanions: 1,
      defaultChoiceCount: 3,
      continueAllowed: true,
    });
    expect(TUTORIAL_FREE_PROLOGUE_RECOVERY_CONTRACT.scope.readOnlyStats).toEqual(
      ['completionReaders', 'comments', 'rating'],
    );
    expect(TUTORIAL_FREE_PROLOGUE_RECOVERY_CONTRACT.originalityPolicy).toEqual({
      copiesModernTranslation: false,
      copiesSpecificGameDesign: false,
      copiesSpecificWebtoonOrAnimeDesign: false,
      luminaOriginalInterpretationRequired: true,
    });
  });

  it('keeps immersive story contracts read-only and rejects sensitive fields', () => {
    expect(
      Object.values(STORY_IMMERSIVE_EXPERIENCE_CONTRACT.noMutationPolicy).every(
        (enabled) => enabled === false,
      ),
    ).toBe(true);
    expect(
      Object.values(
        IMMERSIVE_STORY_PLAYER_DATA_CONTRACT.noMutationPolicy,
      ).every((enabled) => enabled === false),
    ).toBe(true);
    expect(
      findImmersiveStorySensitiveFieldViolations({
        sceneId: 'scene-1',
        chatTurns: [
          {
            messageKey: 'storyStage.player.message.opening',
            rawEmail: 'not-allowed',
          },
        ],
        backgroundAsset: {
          storageKey: 'not-allowed',
        },
        providerPayload: { token: 'not-allowed' },
      }),
    ).toEqual([
      'chatTurns[0].rawEmail',
      'backgroundAsset.storageKey',
      'providerPayload',
      'providerPayload.token',
    ]);
  });
});

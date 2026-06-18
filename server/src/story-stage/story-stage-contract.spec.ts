import { STORY_STAGE_PACK_CHAPTER_SESSION_CONTRACT } from './story-stage-contract';

describe('Story stage pack chapter session contract skeleton', () => {
  it('publishes StoryPack StoryChapter StorySession and StoryChoice skeletons without enabling mutations', () => {
    expect(STORY_STAGE_PACK_CHAPTER_SESSION_CONTRACT).toMatchObject({
      version: '2026-06-18.story-stage-pack-chapter-session-skeleton.v1',
      status: 'backend_contract_skeleton_only',
      scope: {
        surfaces: [
          'story_pack',
          'story_chapter',
          'story_session',
          'story_choice',
        ],
        implementationReady: false,
        readModelOnly: true,
        publicMutationEnabled: false,
      },
      apiContracts: {
        storyPackList: {
          method: 'GET',
          path: '/api/v1/story-packs',
          enabled: false,
          authRequired: false,
        },
        storySessionCreate: {
          method: 'POST',
          path: '/api/v1/story-packs/:packSlug/sessions',
          enabled: false,
          authRequired: true,
          idempotencyRequired: true,
        },
        storyChoiceList: {
          method: 'GET',
          path: '/api/v1/story-sessions/:sessionId/choices',
          enabled: false,
          authRequired: true,
        },
      },
      storyPack: {
        pricingModes: ['free', 'paid', 'mixed'],
        lifecycleStatuses: [
          'draft',
          'serializing',
          'completed',
          'hiatus',
          'season_ended',
          'archived',
        ],
        publicListStatuses: [
          'serializing',
          'completed',
          'hiatus',
          'season_ended',
        ],
        privateFieldsReturned: false,
      },
      storyChapter: {
        pricingModes: ['free', 'paid'],
        lifecycleStatuses: [
          'draft',
          'scheduled',
          'published',
          'paused',
          'season_finale',
          'archived',
        ],
        publicReadableStatuses: ['published', 'paused', 'season_finale'],
        paidAccessPolicy: {
          freeChapterReadableWithoutPurchase: true,
          paidChapterRequiresEntitlement: true,
          lockedBodyReturned: false,
        },
      },
      storySession: {
        lifecycleStatuses: [
          'active',
          'paused',
          'completed',
          'abandoned',
          'expired',
        ],
        source: 'server_created_story_session_after_entitlement_check',
        replaySameRequest: true,
        conflictOnChangedFingerprint: true,
        aiProviderCallOnCreate: false,
        walletMutationOnCreate: false,
        imageVideoGenerationOnCreate: false,
      },
      storyChoice: {
        defaultCount: 3,
        maxCount: 5,
        choiceTypes: ['dialogue', 'action', 'investigate', 'travel', 'wait'],
        rawModelPromptReturned: false,
        providerPayloadReturned: false,
      },
    });
    expect(
      STORY_STAGE_PACK_CHAPTER_SESSION_CONTRACT.validationOrder,
    ).toEqual([
      'auth_optional_for_public_pack_reads',
      'validate_pack_slug',
      'load_public_story_pack',
      'validate_chapter_identifier_when_present',
      'load_public_or_entitled_chapter_projection',
      'require_auth_for_session_or_choice_reads',
      'check_paid_chapter_entitlement_before_body_projection',
      'validate_idempotency_key_for_session_create',
      'return_contract_projection_without_mutation',
    ]);
    expect(
      Object.values(
        STORY_STAGE_PACK_CHAPTER_SESSION_CONTRACT.noMutationPolicy,
      ).every((enabled) => enabled === false),
    ).toBe(true);
  });

  it('keeps paid chapter body locked until entitlement and hides private backend material', () => {
    expect(
      STORY_STAGE_PACK_CHAPTER_SESSION_CONTRACT.storyChapter.paidAccessPolicy,
    ).toMatchObject({
      previewFieldsForLockedPaidChapter: [
        'id',
        'chapterNo',
        'title',
        'summary',
        'pricingMode',
        'priceLumina',
        'locked',
      ],
      lockedBodyReturned: false,
    });
    expect(STORY_STAGE_PACK_CHAPTER_SESSION_CONTRACT.privacy).toMatchObject({
      rawUserEmailReturned: false,
      rawPaymentLedgerIdReturned: false,
      providerPromptReturned: false,
      providerResponseReturned: false,
      adminMemoReturned: false,
      internalModerationNoteReturned: false,
    });
  });
});

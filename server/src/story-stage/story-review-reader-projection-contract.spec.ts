import { STORY_REVIEW_READER_PROJECTION_CONTRACT } from './story-review-reader-projection-contract';

describe('Story review reader projection contract', () => {
  it('publishes story comment rating and completed reader badge projections without mutation', () => {
    expect(STORY_REVIEW_READER_PROJECTION_CONTRACT).toMatchObject({
      version: '2026-06-18.story-review-reader-projection.v1',
      status: 'projection_contract_only',
      enabled: false,
      surfaces: [
        'story_pack_comments',
        'story_pack_ratings',
        'story_chapter_comments',
        'story_chapter_ratings',
        'completed_reader_badge',
      ],
      commentPolicy: {
        packComments: {
          enabled: false,
          scope: 'story_pack',
          commenterEligibility: 'paid_reader_or_entitled_reader_only',
        },
        chapterComments: {
          enabled: false,
          scope: 'story_chapter',
          commenterEligibility: 'chapter_entitled_reader_only',
        },
        maxChars: 500,
        rawSpoilerBodyReturnedToNonReader: false,
        rawModerationPayloadReturned: false,
      },
      ratingPolicy: {
        packRatings: {
          enabled: false,
          scope: 'story_pack',
          raterEligibility: 'paid_reader_or_entitled_reader_only',
        },
        chapterRatings: {
          enabled: false,
          scope: 'story_chapter',
          raterEligibility: 'chapter_entitled_reader_only',
        },
        scale: { min: 1, max: 5, step: 1 },
        oneRatingPerUserPerScope: true,
        ratingMutationEnabled: false,
      },
    });
    expect(
      Object.values(
        STORY_REVIEW_READER_PROJECTION_CONTRACT.noMutationPolicy,
      ).every((enabled) => enabled === false),
    ).toBe(true);
  });

  it('keeps completed reader badge display-safe and separate from payment authority', () => {
    expect(
      STORY_REVIEW_READER_PROJECTION_CONTRACT.completedReaderBadge,
    ).toMatchObject({
      field: 'reader.badges.completedReader',
      meaning: 'viewer completed every currently published readable chapter',
      evidenceSources: [
        'story_chapter_read_progress.completed_at',
        'story_entitlements.confirmed',
      ],
      trustLevel: 'reader_completion_signal_not_authority_for_payment',
      displayedOnComments: true,
      displayedOnRatings: true,
      rawReadHistoryReturned: false,
    });
    expect(
      STORY_REVIEW_READER_PROJECTION_CONTRACT.completedReaderBadgeDisplay,
    ).toMatchObject({
      projectionField: 'readerBadges.completedReader',
      labelKey: 'story.readerBadge.completed.label',
      descriptionKey: 'story.readerBadge.completed.description',
      iconKey: 'completed_reader',
      visibleOn: ['comment_item', 'rating_item', 'author_review_summary'],
      evidenceReturnedAsBooleanOnly: true,
      rawChapterProgressReturned: false,
      rawEntitlementIdReturned: false,
      paymentAuthority: false,
    });
    expect(
      STORY_REVIEW_READER_PROJECTION_CONTRACT.validationOrder,
    ).toEqual([
      'load_public_story_pack_or_chapter',
      'authorize_author_or_public_reader_scope',
      'require_auth_for_comment_or_rating_write',
      'check_reader_entitlement_for_comment_or_rating',
      'check_completed_reader_badge_projection',
      'aggregate_author_review_summary_without_reader_identity',
      'return_projection_without_comment_rating_report_or_notification_mutation',
    ]);
    expect(STORY_REVIEW_READER_PROJECTION_CONTRACT.privacy).toMatchObject({
      rawUserEmailReturned: false,
      rawPaymentLedgerIdReturned: false,
      rawReadHistoryReturned: false,
      rawReportReasonReturned: false,
      moderationNotesReturned: false,
    });
  });

  it('requires purchased or entitled readers for future comment and rating submissions without enabling mutation', () => {
    const readiness =
      STORY_REVIEW_READER_PROJECTION_CONTRACT.purchasedReaderWriteReadiness;

    expect(readiness).toMatchObject({
      version: '2026-06-23.story-comment-rating-purchased-reader-contract.v1',
      status: 'contract_only_mutation_disabled',
      authRequiredForWrite: true,
      eligibility: {
        storyPack: {
          paidOrGrantedReaderOnly: true,
          authorSelfReviewAllowed: false,
        },
        storyChapter: {
          chapterEntitledReaderOnly: true,
          lockedOrPreviewOnlyChapterCanWrite: false,
        },
      },
      errorResponses: {
        authRequired: {
          status: 401,
          code: 'STORY_REVIEW_AUTH_REQUIRED',
          messageKey: 'story.review.authRequired',
        },
        entitlementRequired: {
          status: 403,
          code: 'STORY_REVIEW_ENTITLEMENT_REQUIRED',
          messageKey: 'story.review.entitlementRequired',
        },
        invalidCommentBody: {
          status: 400,
          code: 'STORY_REVIEW_COMMENT_INVALID',
          messageKey: 'story.review.commentInvalid',
        },
        invalidRating: {
          status: 400,
          code: 'STORY_REVIEW_RATING_INVALID',
          messageKey: 'story.review.ratingInvalid',
        },
      },
      mutationEnabled: false,
      commentCreateEnabled: false,
      ratingUpsertEnabled: false,
      paymentMutationEnabled: false,
      entitlementGrantMutationEnabled: false,
    });
    expect(readiness.eligibility.storyPack.source).toEqual(
      expect.arrayContaining([
        'user_entitlements.story_pack_access.confirmed',
        'story_purchase_ledger.completed_pack_or_season_purchase',
      ]),
    );
    expect(readiness.eligibility.storyChapter.source).toEqual(
      expect.arrayContaining([
        'user_entitlements.story_chapter_access.confirmed',
        'story_chapter_read_progress.entitled_reader',
      ]),
    );
    expect(readiness.validationOrder).toEqual([
      'authenticate_viewer',
      'load_story_pack_or_chapter',
      'reject_author_self_review_for_own_work',
      'check_confirmed_purchase_or_entitlement',
      'validate_comment_body_or_rating_value',
      'attach_completed_reader_badge_projection',
      'return_disabled_submit_projection_without_mutation',
    ]);
  });

  it('lets authors read safe comment rating and completed-reader aggregates without reader private data', () => {
    const authorRead =
      STORY_REVIEW_READER_PROJECTION_CONTRACT.authorReadProjection;

    expect(authorRead).toMatchObject({
      version: '2026-06-23.story-author-review-reader-read-projection.v1',
      status: 'read_model_contract_only',
      endpoint: 'GET /api/v1/creator-studio/story-packs/:packId/review-summary',
      auth: {
        authorOwnPackOnly: true,
        backstageReadRequiresPermission: 'story:read',
        nonAuthorDeniedWithoutIdentityLeak: true,
      },
      commentPreviewPolicy: {
        maxItems: 20,
        includesSafeBodyPreview: true,
        includesCompletedReaderBadge: true,
        spoilerPreviewRedactedForUnentitledViewer: true,
        moderationHiddenCommentsExcluded: true,
      },
      ratingBreakdownPolicy: {
        buckets: [1, 2, 3, 4, 5],
        viewerSpecificRatingReturned: false,
        anonymousAggregateOnly: true,
      },
      completedReaderPolicy: {
        countOnlyForAuthor: true,
        readerListReturned: false,
        rawReadHistoryReturned: false,
        paymentAuthority: false,
      },
      scopeSeparation: {
        packAggregate: 'own_story_pack_all_comments_and_ratings',
        chapterBreakdown: 'own_story_pack_chapter_comments_and_ratings',
        authorOnly: true,
        publicReaderDetailReturned: false,
        paymentLedgerDetailReturned: false,
      },
      privacy: {
        readerUserIdReturned: false,
        rawUserEmailReturned: false,
        paymentLedgerIdReturned: false,
        entitlementIdReturned: false,
        rawReadHistoryReturned: false,
        rawReportReasonReturned: false,
        moderationNotesReturned: false,
      },
    });
    expect(authorRead.metrics).toEqual([
      'commentCount',
      'ratingCount',
      'averageRating',
      'completedReaderCount',
      'chapterCommentCount',
      'chapterRatingCount',
    ]);
    expect(
      STORY_REVIEW_READER_PROJECTION_CONTRACT.projectionFields.authorReviewSummary,
    ).toEqual([
      'packId',
      'commentCount',
      'ratingCount',
      'averageRating',
      'completedReaderCount',
      'chapterBreakdown',
      'safeCommentPreviews',
      'ratingBuckets',
    ]);
    expect(
      STORY_REVIEW_READER_PROJECTION_CONTRACT.projectionFields.commentItem,
    ).toEqual(
      expect.arrayContaining([
        'readerBadges.completedReader.labelKey',
        'readerBadges.completedReader.iconKey',
      ]),
    );
    expect(
      Object.values(authorRead.noMutationPolicy).every(
        (enabled) => enabled === false,
      ),
    ).toBe(true);
  });

  it('separates all-pack comments, chapter comments, and rating summaries by read scope', () => {
    const separation =
      STORY_REVIEW_READER_PROJECTION_CONTRACT.readProjectionSeparation;

    expect(separation).toMatchObject({
      version: '2026-06-23.story-comment-rating-read-scope-separation.v1',
      publicPackThread: {
        endpoint: 'GET /api/v1/story-packs/:packSlug/comments',
        scope: 'story_pack',
        includesChapterNo: false,
        includesCompletedReaderBadge: true,
        spoilerBodyRequiresEntitlement: true,
      },
      publicChapterThread: {
        endpoint:
          'GET /api/v1/story-packs/:packSlug/chapters/:chapterNo/comments',
        scope: 'story_chapter',
        includesChapterNo: true,
        includesCompletedReaderBadge: true,
        spoilerBodyRequiresChapterEntitlement: true,
      },
      ratingSummary: {
        packEndpoint: 'GET /api/v1/story-packs/:packSlug/ratings',
        chapterEndpoint:
          'GET /api/v1/story-packs/:packSlug/chapters/:chapterNo/ratings',
        viewerOwnRatingReturnedOnlyToViewer: true,
        anonymousAggregateOnlyForPublic: true,
      },
    });
  });
});

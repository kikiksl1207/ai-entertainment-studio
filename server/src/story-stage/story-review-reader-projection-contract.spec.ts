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
      Object.values(authorRead.noMutationPolicy).every(
        (enabled) => enabled === false,
      ),
    ).toBe(true);
  });
});

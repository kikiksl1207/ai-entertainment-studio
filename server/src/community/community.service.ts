import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { buildPublicAssetUrl } from '../common/asset-url';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { LUMINA_FEED_SAMPLE_POSTS } from './lumina-feed-samples';

type CommunityQuery = Record<string, string | undefined>;
type CommunityBody = Record<string, unknown>;
type FeedSearchBlockedTermScope = {
  normalizedKeyword: string;
  searchType: string;
  language: string;
};
type StoredThreadItem = {
  id: string;
  position: number;
  body: string;
  status: string;
  createdAt: unknown;
  updatedAt: unknown;
  deletedAt: unknown;
  [key: string]: unknown;
};

const POST_VISIBILITIES = new Set(['public', 'followers']);
const REPORT_REASONS = new Set([
  'sexual_content',
  'harassment',
  'hate',
  'impersonation',
  'spam',
  'other',
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FEED_POST_MAX_IMAGES = 4;
const FEED_POST_MAX_BODY_CHARS = 2200;
const FEED_THREAD_MAX_ITEMS = 10;
const FEED_THREAD_ITEM_MAX_BODY_CHARS = 500;
const FEED_THREAD_CONTINUATION_MAX_BODY_CHARS = 500;
const FEED_THREAD_PREVIEW_MAX_CHARS = 160;
const FEED_REPLY_MAX_BODY_CHARS = 300;
const FEED_EXTERNAL_URL_MAX_LENGTH = 2048;
const SEARCH_LANGUAGES = new Set(['ko', 'ja', 'en', 'zh', 'unknown']);
const TRENDING_LANGUAGE_FILTERS = new Set(['all', 'ko', 'ja', 'en', 'zh', 'unknown']);
const SEARCH_TYPES = new Set(['text', 'hashtag']);
const SEARCH_EVENT_DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const FEED_PUBLIC_CLEANUP_GUARD_NOT: Prisma.CommunityPostWhereInput[] = [
  { body: { equals: 'test', mode: 'insensitive' } },
  { body: { contains: 'testtest', mode: 'insensitive' } },
  { body: { equals: 'sample', mode: 'insensitive' } },
  { body: { equals: 'fixture', mode: 'insensitive' } },
  { body: { equals: '테스트' } },
  { body: { contains: '임시문구' } },
  { body: { contains: '샘플문구' } },
];

export const USER_SOCIAL_ACCOUNT_CONTRACT = {
  version: '2026-06-08.user-social-account-contract.v1',
  profileFollowLists: {
    endpoints: [
      'GET /api/v1/users/:userId/followers',
      'GET /api/v1/users/:userId/following-users',
      'GET /api/v1/users/handle/:publicHandle/followers',
      'GET /api/v1/users/handle/:publicHandle/following-users',
    ],
    targetVisibilityWhere: {
      status: 'active',
      deletedAt: null,
    },
    returnedUserWhere: {
      status: 'active',
      deletedAt: null,
    },
    hiddenStatuses: ['deleted', 'suspended', 'inactive', 'private'],
    projection: 'public_user_follow_summary_v1',
    profileCountProjection: {
      followerRowsBlockedByViewerExcluded: true,
      followingRowsBlockedByViewerExcluded: true,
      blockedRelationshipDirection: 'either_direction',
      countAndListUseSameVisibilityWhere: true,
      hiddenRowsExcludedBeforeCount: true,
      emptyProjection: {
        items: [],
        count: 0,
        total: 0,
        nextCursor: null,
      },
      errorProjection: {
        blockedTargetStatus: 403,
        blockedTargetCode: 'USER_PROFILE_BLOCKED',
        notFoundCode: 'USER_NOT_FOUND',
        invalidCursorCode: 'INVALID_CURSOR',
      },
    },
    publicListProjection: {
      version: '2026-06-16.public-user-follow-list-projection.v1',
      surfaces: {
        followers: [
          'GET /api/v1/users/:userId/followers',
          'GET /api/v1/users/handle/:publicHandle/followers',
        ],
        followingUsers: [
          'GET /api/v1/users/:userId/following-users',
          'GET /api/v1/users/handle/:publicHandle/following-users',
        ],
      },
      targetProfileRequired: {
        status: 'active',
        deletedAt: null,
        blockedByViewer: false,
      },
      returnedFollowRowsWhere: {
        followDeletedAt: null,
        sourceUserStatus: 'active',
        targetUserStatus: 'active',
        userDeletedAt: null,
        activeBlockEitherDirection: false,
      },
      hiddenUserStatuses: ['deleted', 'suspended', 'inactive', 'private'],
      countSource: 'same_where_as_items_after_hidden_and_block_filters',
      cursorField: 'user_follows.id',
      viewerHintsSafeOnly: true,
      mutation: false,
    },
    privateFieldsExcluded: [
      'email',
      'phone',
      'providerIds',
      'walletAccounts',
      'walletLedger',
      'paymentOrders',
      'privateProfile',
      'moderationNotes',
    ],
  },
  blockEffects: {
    blockEndpoint: 'POST /api/v1/users/:userId/block',
    unblockEndpoint: 'DELETE /api/v1/users/:userId/block',
    removesViewerToTargetFollow: true,
    removesTargetToViewerFollow: true,
    refollowBlockedWhileActive: true,
    blockedProfileListAccess: {
      status: 403,
      code: 'USER_PROFILE_BLOCKED',
      messageKey: 'social.profile.blocked',
    },
    hiddenSurfaces: [
      'feed',
      'comments',
      'premium_chat',
      'support',
      'user_follow_lists',
    ],
    walletMutation: false,
    luminaMutation: false,
    paymentMutation: false,
    settlementMutation: false,
  },
  followerBlockProjectionGuard: {
    version: '2026-06-16.feed-follower-block-projection-guard.v1',
    source: 'user_blocks',
    activeBlockWhere: {
      status: 'active',
      deletedAt: null,
      direction: 'either_direction',
    },
    surfaces: {
      feed: [
        'GET /api/v1/me/lumina-feed',
        'GET /api/v1/me/lumina-feed/liked-posts',
        'GET /api/v1/users/:userId/posts',
        'GET /api/v1/users/handle/:publicHandle/posts',
      ],
      profile: [
        'GET /api/v1/users/:userId',
        'GET /api/v1/users/handle/:publicHandle',
      ],
      followLists: [
        'GET /api/v1/users/:userId/followers',
        'GET /api/v1/users/:userId/following-users',
        'GET /api/v1/users/handle/:publicHandle/followers',
        'GET /api/v1/users/handle/:publicHandle/following-users',
      ],
    },
    projectionPolicy: {
      targetProfileBlocked: 'fail_closed_403_USER_PROFILE_BLOCKED',
      feedRowsByBlockedUsers: 'exclude_before_pagination_and_count',
      followerRowsByBlockedUsers: 'exclude_before_pagination_and_count',
      followingRowsByBlockedUsers: 'exclude_before_pagination_and_count',
      profileCountsUseSameFilterAsLists: true,
      viewerHintsMustNotLeakBlockedUserPrivateFields: true,
    },
    mutationPolicy: {
      contractAddsBlockMutation: false,
      followMutation: false,
      unfollowMutation: false,
      feedMutation: false,
      walletMutation: false,
      luminaMutation: false,
      settlementMutation: false,
      payoutMutation: false,
    },
    liveFixtureSeedGuard: {
      version: '2026-06-17.feed-follower-block-live-fixture-seed.v1',
      status: 'qa_runbook_contract_only',
      enabledByDefault: false,
      productionAutoSeed: false,
      liveMutationByContract: false,
      allowedEnvironments: ['local', 'staging'],
      forbiddenEnvironments: ['production'],
      runId: {
        required: true,
        format: 'qa-follow-block-YYYYMMDD-runN',
        persistedOnRows: true,
        cleanupScope: 'run_id_only',
      },
      disposableUsers: [
        {
          alias: 'qa_viewer',
          role: 'logged_in_viewer_running_block_ux',
          realUserAllowed: false,
        },
        {
          alias: 'qa_profile_owner',
          role: 'public_profile_with_follow_lists',
          realUserAllowed: false,
        },
        {
          alias: 'qa_follower',
          role: 'visible_follower_row',
          realUserAllowed: false,
        },
        {
          alias: 'qa_blocked_follower',
          role: 'blocked_follower_row_hidden_from_viewer',
          realUserAllowed: false,
        },
      ],
      fixtureRows: [
        {
          model: 'user_follows',
          purpose: 'profile_owner_has_visible_follower',
          sourceAlias: 'qa_follower',
          targetAlias: 'qa_profile_owner',
          status: 'active',
          runIdRequired: true,
        },
        {
          model: 'user_follows',
          purpose: 'profile_owner_has_blocked_follower_fixture',
          sourceAlias: 'qa_blocked_follower',
          targetAlias: 'qa_profile_owner',
          status: 'active',
          runIdRequired: true,
        },
        {
          model: 'user_blocks',
          purpose: 'viewer_blocks_blocked_follower_for_list_filter_smoke',
          sourceAlias: 'qa_viewer',
          targetAlias: 'qa_blocked_follower',
          status: 'active',
          runIdRequired: true,
        },
      ],
      visibilityChecks: [
        {
          endpoint: 'GET /api/v1/users/:userId/followers',
          expected: 'visible_follower_returned_blocked_follower_excluded',
        },
        {
          endpoint: 'GET /api/v1/users/:userId/following-users',
          expected: 'only_active_public_rows_with_block_filter',
        },
        {
          endpoint: 'POST /api/v1/users/:userId/block',
          expected: 'viewer_owned_block_ux_only_no_real_user_target',
        },
      ],
      allowedReportFields: [
        'runId',
        'userAlias',
        'safeUserId',
        'rowModel',
        'rowId',
        'status',
        'visibilityCheck',
        'httpStatus',
        'stableCode',
        'messageKey',
      ],
      forbiddenReportFields: [
        'raw email',
        'password',
        'access token',
        'refresh token',
        'cookie',
        'database url',
        'provider credential',
      ],
      safety: {
        realUserFollowMutation: false,
        realUserBlockMutation: false,
        walletMutation: false,
        luminaMutation: false,
        settlementMutation: false,
        payoutMutation: false,
      },
    },
  },
  feedInteractionGuards: {
    readSurfaces: [
      'GET /api/v1/me/lumina-feed',
      'GET /api/v1/me/lumina-feed/liked-posts',
      'GET /api/v1/lumina-feed/posts/:postId/replies',
      'GET /api/v1/lumina-feed/posts/:postId/thread-continuations',
    ],
    writeSurfaces: [
      'POST /api/v1/lumina-feed/posts/:postId/likes',
      'POST /api/v1/lumina-feed/posts/:postId/replies',
      'POST /api/v1/lumina-feed/posts/:postId/reposts',
      'POST /api/v1/lumina-feed/posts/:postId/thread-continuations',
    ],
    relationshipSource: 'user_blocks',
    blockedRelationshipDirection: 'either_direction',
    readProjection: {
      filterBlockedAuthors: true,
      filterBlockedReplyAuthors: true,
      renderRepostSourceTombstoneWhenOriginalAuthorBlocked: true,
      viewerHintsMustNotLeakBlockedUserPrivateFields: true,
    },
    writePolicy: {
      failBeforeCommunityMutation: true,
      failBeforeNotificationMutation: true,
      status: 403,
      code: 'USER_FOLLOW_BLOCKED',
      messageKey: 'social.follow.blocked',
    },
  },
  premiumChatRelationshipGuards: {
    blockedSurfaces: [
      'POST /api/v1/chat/premium-rooms',
      'POST /api/v1/chat/premium-rooms/:roomId/messages',
      'POST /api/v1/chat/premium-rooms/:roomId/donations',
      'POST /api/v1/chat/premium-rooms/:roomId/reports',
      'GET /api/v1/chat/me/premium-rooms/:roomId/status',
    ],
    relationshipSource: 'user_blocks',
    blockedRelationshipDirection: 'either_direction',
    validationOrder: [
      'load_room_participants_or_artist_target',
      'check_user_blocks_either_direction',
      'reject_before_wallet_order_message_donation_or_report_mutation',
      'continue_domain_specific_guard',
    ],
    failBeforeWalletMutation: true,
    failBeforeOrderMutation: true,
    failBeforeMessageMutation: true,
    failBeforeDonationMutation: true,
    failBeforeReportMutation: true,
    failBeforeSettlementMutation: true,
    failBeforePayoutMutation: true,
    status: 403,
    code: 'USER_RELATIONSHIP_BLOCKED',
    messageKey: 'social.relationship.blocked',
  },
} as const;

export const LUMINA_FEED_THREAD_REPOST_COUNT_PROJECTION_CONTRACT = {
  version: '2026-06-15.lumina-feed-thread-repost-count-projection.v1',
  status: 'read_model_contract_only',
  threadContinuation: {
    relation: 'thread_continuation',
    actionKey: 'feed_thread_continue',
    stateKey: 'thread_continuation',
    childPostFlow: 'existing_post_child_post',
    rootAuthorOnly: true,
    autoLongTextSplit: false,
    listEndpoint: '/api/v1/lumina-feed/posts/:postId/thread-continuations',
    createEndpoint: '/api/v1/lumina-feed/posts/:postId/thread-continuations',
    countField: 'threadContinuationCount',
    countSource: 'community_posts.metadata.threadContinuation.rootPostId',
    excludedFrom: [
      'manualThreadCount',
      'repostCount',
      'shareCount',
      'replyCount',
      'commentCount',
    ],
  },
  repost: {
    allowedTypes: ['repost', 'quote_repost'],
    actionKeys: {
      repost: 'feed_repost',
      quoteRepost: 'feed_quote_repost',
    },
    stateKeys: {
      repost: 'repost',
      quoteRepost: 'quote_repost',
    },
    originalReferenceField: 'metadata.repost.originalPostId',
    quoteBodyField: 'body',
    originalPostProjectionField: 'post.repost.originalPost',
    countField: 'repostCount',
    countSource: 'community_posts.metadata.repost.originalPostId',
    profileTabIncludes: ['repost', 'quote_repost'],
    notificationType: 'feed.repost',
    excludedFrom: [
      'manualThreadCount',
      'threadContinuationCount',
      'shareCount',
      'replyCount',
      'commentCount',
    ],
  },
  share: {
    relation: 'share',
    actionKey: 'feed_share',
    stateKey: 'share_contract',
    createsFeedRow: false,
    countTarget: null,
    shareUrlProjectionOnly: true,
    repostRelation: false,
    threadRelation: false,
    notificationMutation: false,
    unreadCountMutation: false,
  },
  blockedRelationshipPolicy: {
    writePolicy: 'reject_before_feed_or_notification_mutation',
    readAndCountProjection: 'exclude_or_tombstone_blocked_relationship_rows',
  },
  mutationPolicy: {
    contractAddsPostCreate: false,
    contractAddsRepostCreate: false,
    contractAddsShareCreate: false,
    contractAddsNotificationCreate: false,
    walletMutation: false,
    luminaMutation: false,
    settlementMutation: false,
    payoutMutation: false,
    orderMutation: false,
    paidLikeMutation: false,
  },
} as const;

export const LUMINA_FEED_MULTI_IMAGE_ATTACHMENT_CONTRACT = {
  version: '2026-06-16.lumina-feed-multi-image-attachment-metadata.v1',
  status: 'projection_contract_only',
  maxImages: FEED_POST_MAX_IMAGES,
  supportedCounts: [1, 2, 3, 4],
  overflowBadgeRequired: false,
  overflowBadgePolicy: {
    maxUploadCountEqualsMaxDisplayCount: true,
    plusNRequired: false,
    reason: 'feed image uploads are capped at four assets',
  },
  requestPolicy: {
    field: 'assetIds',
    maxItems: FEED_POST_MAX_IMAGES,
    uniqueOnly: true,
    existingPublicImageAssetsOnly: true,
    archivedAssetsAllowed: false,
    videoAssetsAllowed: false,
  },
  projection: {
    field: 'post.assets',
    role: 'attachment',
    orderField: 'sortOrder',
    metadataFields: [
      'id',
      'role',
      'sortOrder',
      'asset.id',
      'asset.assetType',
      'asset.mimeType',
      'asset.width',
      'asset.height',
      'asset.url',
      'asset.displayUrl',
      'asset.thumbnailUrl',
    ],
    countMetadata: {
      assetCountField: 'assetCount',
      layoutCountSource: 'post.assets.length',
      supportedLayoutCounts: [2, 3, 4],
      overflowCount: 0,
    },
  },
  privacy: {
    storageKeyReturned: false,
    storageProviderReturned: false,
    rawAssetMetadataReturned: false,
    privateOriginalUrlReturned: false,
    signedUploadUrlReturned: false,
  },
  mutationPolicy: {
    contractAddsImageUpload: false,
    contractAddsFeedCreate: false,
    contractAddsRepostMutation: false,
    walletMutation: false,
    luminaMutation: false,
    settlementMutation: false,
    payoutMutation: false,
  },
} as const;

export const LUMINA_FEED_REPOST_PERMISSION_GUARD_CONTRACT = {
  version: '2026-06-16.lumina-feed-repost-permission-guard.v1',
  status: 'guard_contract_only',
  endpoints: {
    repost: 'POST /api/v1/lumina-feed/posts/:postId/reposts',
    quoteRepost: 'POST /api/v1/lumina-feed/posts/:postId/reposts',
    share: 'POST /api/v1/lumina-feed/posts/:postId/share',
  },
  actions: {
    repost: {
      relation: 'repost',
      actionKey: 'feed_repost',
      stateKey: 'repost',
      createsFeedRow: true,
      quoteBodyAllowed: false,
      originalReferenceField: 'metadata.repost.originalPostId',
      countTarget: 'repost_count',
    },
    quoteRepost: {
      relation: 'quote_repost',
      actionKey: 'feed_quote_repost',
      stateKey: 'quote_repost',
      createsFeedRow: true,
      quoteBodyAllowed: true,
      quoteBodyMaxChars: FEED_POST_MAX_BODY_CHARS,
      originalReferenceField: 'metadata.repost.originalPostId',
      quoteBodyProjectionField: 'post.repost.quoteBody',
      originalBodyProjectionField: 'post.repost.originalPost.body',
      countTarget: 'repost_count',
    },
    share: {
      relation: 'share',
      actionKey: 'feed_share',
      stateKey: 'share_contract',
      createsFeedRow: false,
      shareUrlProjectionOnly: true,
      repostRelation: false,
      threadRelation: false,
      commentRelation: false,
      replyRelation: false,
      countTarget: null,
    },
  },
  validationOrder: [
    'require_authenticated_viewer_for_repost_or_quote_repost',
    'validate_source_post_id',
    'load_public_published_source_post',
    'reject_deleted_hidden_private_or_moderation_review_source',
    'check_user_blocks_either_direction',
    'validate_quote_body_when_present',
    'return_relation_specific_projection',
  ],
  failClosedSourcePolicy: {
    missingSource: { status: 404, code: 'FEED_POST_NOT_FOUND' },
    deletedSource: { status: 404, code: 'FEED_POST_NOT_FOUND' },
    hiddenSource: { status: 404, code: 'FEED_POST_NOT_FOUND' },
    privateSource: { status: 404, code: 'FEED_POST_NOT_FOUND' },
    moderationReviewSource: { status: 404, code: 'FEED_POST_NOT_FOUND' },
    blockedRelationship: { status: 403, code: 'USER_FOLLOW_BLOCKED' },
    readProjectionWhenSourceLaterUnavailable: 'tombstone_without_original_body',
  },
  mutationPolicy: {
    contractAddsPostCreate: false,
    contractAddsRepostCreate: false,
    contractAddsShareCreate: false,
    contractAddsNotificationCreate: false,
    shareCreatesFeedRow: false,
    shareCreatesNotification: false,
    walletMutation: false,
    luminaMutation: false,
    settlementMutation: false,
    payoutMutation: false,
    orderMutation: false,
    paidLikeMutation: false,
  },
} as const;

export const LUMINA_FEED_QUOTE_REPOST_CONTENT_READ_MODEL_CONTRACT = {
  version: '2026-06-17.lumina-feed-quote-repost-content-read-model.v1',
  status: 'read_model_contract_only',
  sourceContract: 'LUMINA_FEED_REPOST_PERMISSION_GUARD_CONTRACT',
  projection: {
    field: 'post.repost',
    allowedTypes: ['repost', 'quote_repost'],
    simpleRepost: {
      type: 'repost',
      hasQuote: false,
      quoteBodyField: 'post.repost.quoteBody',
      quoteBodyValue: null,
      originalPostProjectionField: 'post.repost.originalPost',
    },
    quoteRepost: {
      type: 'quote_repost',
      hasQuote: true,
      quoteBodyField: 'post.repost.quoteBody',
      originalPostProjectionField: 'post.repost.originalPost',
      originalBodyField: 'post.repost.originalPost.body',
      quoteBodyDoesNotOverwriteOriginalBody: true,
      quoteBodyPreservedWhenOriginalUnavailable: true,
    },
    relationshipFlags: {
      parentPostId: null,
      threadRootPostId: null,
      commentRelation: false,
      replyRelation: false,
      threadRelation: false,
    },
    preservedOriginalIdentifiers: [
      'post.repost.originalPostId',
      'post.repost.originalAuthorUserId',
      'post.repost.originalArtistId',
    ],
  },
  unavailableOriginalPolicy: {
    appliesTo: [
      'missing',
      'deleted',
      'hidden',
      'private',
      'moderation_review',
      'viewer_hidden',
      'blocked_relationship',
    ],
    projection: {
      originalState: 'unavailable',
      tombstone: true,
      unavailableReason: 'viewer_restricted_or_unavailable',
      originalPost: null,
    },
    safeTombstoneOnly: true,
    quoteBodyMayRemainVisible: true,
    originalBodyReturned: false,
  },
  privacy: {
    originalPrivateBodyReturned: false,
    originalDraftBodyReturned: false,
    originalModerationNotesReturned: false,
    originalReportStateReturned: false,
    originalInternalMetadataReturned: false,
    originalOwnerEmailReturned: false,
    originalWalletOrLedgerReturned: false,
    rawEnumUiCopyRequired: false,
  },
  mutationPolicy: {
    contractAddsPostCreate: false,
    contractAddsRepostCreate: false,
    contractAddsQuoteRepostCreate: false,
    contractAddsNotificationCreate: false,
    contractAddsUnreadCountMutation: false,
    contractAddsShareMutation: false,
    walletMutation: false,
    luminaMutation: false,
    settlementMutation: false,
    payoutMutation: false,
    orderMutation: false,
    paidLikeMutation: false,
  },
} as const;

@Injectable()
export class CommunityService {
  private readonly logger = new Logger(CommunityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getFeed(query: CommunityQuery) {
    const take = this.take(query.take);
    const cursor = this.optionalString(query.cursor);
    const mode = this.optionalString(query.mode) ?? 'all';
    const artistSlug = this.optionalString(query.artistSlug);

    if (!['all', 'artists', 'fans'].includes(mode)) {
      throw new BadRequestException('mode must be all, artists, or fans');
    }

    const posts = await this.prisma.communityPost.findMany({
      where: this.clean({
        status: 'published',
        visibility: 'public',
        deletedAt: null,
        ...this.publicFeedCleanupGuardWhere(),
        artist: artistSlug ? { slug: artistSlug, status: 'active' } : undefined,
        artistId: mode === 'artists' ? { not: null } : undefined,
        postType: mode === 'fans' ? 'user_post' : undefined,
      }),
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: this.postInclude(),
      orderBy: { publishedAt: 'desc' },
    });

    return Promise.all(posts.map((post) => this.toPostView(post)));
  }

  async getPersonalizedFeed(userId: string, query: CommunityQuery) {
    await this.assertActiveUser(userId);
    const take = this.take(query.take);
    const cursor = this.optionalString(query.cursor);
    const mode = this.optionalString(query.mode) ?? 'all';
    const artistSlug = this.optionalString(query.artistSlug);
    const blockedUserIds = await this.getBlockedRelationshipUserIds(userId);

    if (!['all', 'artists', 'fans', 'following'].includes(mode)) {
      throw new BadRequestException('mode must be all, artists, fans, or following');
    }

    const followingArtistIds =
      mode === 'following' ? await this.getFollowingArtistIds(userId) : [];
    const followingUserIds =
      mode === 'following' ? await this.getFollowingUserIds(userId) : [];

    if (
      mode === 'following' &&
      followingArtistIds.length === 0 &&
      followingUserIds.length === 0
    ) {
      return [];
    }

    const posts = await this.prisma.communityPost.findMany({
      where: this.clean({
        status: 'published',
        visibility: 'public',
        deletedAt: null,
        ...this.publicFeedCleanupGuardWhere(),
        artist: artistSlug ? { slug: artistSlug, status: 'active' } : undefined,
        artistId: mode === 'artists' ? { not: null } : undefined,
        postType: mode === 'fans' ? 'user_post' : undefined,
        OR:
          mode === 'following'
            ? [
                ...(followingArtistIds.length
                  ? [{ artistId: { in: followingArtistIds } }]
                  : []),
                ...(followingUserIds.length
                  ? [{ authorUserId: { in: followingUserIds } }]
                  : []),
              ]
            : undefined,
        authorUserId: blockedUserIds.length ? { notIn: blockedUserIds } : undefined,
        hiddenByUsers: {
          none: {
            userId,
            status: 'active',
            deletedAt: null,
          },
        },
      }),
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: this.postInclude(),
      orderBy: { publishedAt: 'desc' },
    });

    return Promise.all(posts.map((post) => this.toPostView(post, userId)));
  }

  async getMyLikedPosts(userId: string, query: CommunityQuery) {
    await this.assertActiveUser(userId);
    const take = this.take(query.take);
    const cursor = this.optionalString(query.cursor);
    const blockedUserIds = await this.getBlockedRelationshipUserIds(userId);

    if (cursor && !UUID_PATTERN.test(cursor)) {
      throw new BadRequestException('cursor must be a like reaction UUID');
    }

    const reactions = await this.prisma.communityReaction.findMany({
      where: {
        userId,
        reactionType: 'like',
        post: {
          status: 'published',
          visibility: 'public',
          deletedAt: null,
          authorUserId: blockedUserIds.length ? { notIn: blockedUserIds } : undefined,
          hiddenByUsers: {
            none: {
              userId,
              status: 'active',
              deletedAt: null,
            },
          },
        },
      },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        post: {
          include: this.postInclude(),
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const items = await Promise.all(
      reactions.map(async (reaction) => ({
        ...(await this.toPostView(reaction.post, userId)),
        viewerLike: {
          id: reaction.id,
          likedAt: reaction.createdAt,
        },
      })),
    );

    return {
      items,
      posts: items,
      count: items.length,
      nextCursor: reactions.length === take ? reactions[reactions.length - 1].id : null,
      cursorType: 'community_reaction_id',
      visibility: 'viewer_only',
      policy: {
        privateToViewer: true,
        publicProfileExposure: false,
      },
    };
  }

  async searchFeed(
    query: CommunityQuery,
    context: { userId?: string; visitorHash?: string | null } = {},
  ) {
    const take = this.take(query.take);
    const cursor = this.optionalString(query.cursor);
    const search = this.searchQuery(query.q ?? query.query ?? query.keyword);
    const searchType = this.searchType(query.type, search);
    const language = this.searchLanguage(query.language ?? query.locale, search);
    const normalizedKeyword = this.normalizeSearchKeyword(search, searchType);
    const where = this.feedSearchWhere(normalizedKeyword, searchType);
    const posts = await this.prisma.communityPost.findMany({
      where,
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: this.postInclude(),
      orderBy: { publishedAt: 'desc' },
    });
    const items = await Promise.all(posts.map((post) => this.toPostView(post, context.userId)));

    await this.recordFeedSearchEvent({
      keyword: search,
      normalizedKeyword,
      searchType,
      language,
      resultCount: items.length,
      userId: context.userId,
      visitorHash: context.visitorHash,
      metadata: {
        source: 'lumina_feed_search',
        q: search,
        requestedLanguage: query.language ?? query.locale ?? null,
        detectedLanguage: this.detectSearchLanguage(search),
      },
    });

    return {
      items,
      posts: items,
      count: items.length,
      nextCursor: posts.length === take ? posts[posts.length - 1]?.id ?? null : null,
      query: {
        keyword: search,
        normalizedKeyword,
        type: searchType,
        language,
        cursor: cursor ?? null,
      },
      policy: this.feedSearchPolicy(),
    };
  }

  async getSearchSuggestions(query: CommunityQuery) {
    const take = Math.min(this.take(query.take), 10);
    const rawKeyword = this.optionalString(query.q ?? query.query ?? query.keyword);
    const normalizedKeyword = rawKeyword
      ? this.normalizeSearchKeyword(rawKeyword, rawKeyword.startsWith('#') ? 'hashtag' : 'text')
      : null;
    const language = this.trendingLanguage(query.language ?? query.locale);
    const since = new Date(Date.now() - this.trendingWindow(query.window ?? '24h').ms);
    const [blockedTerms, artists, users] = await Promise.all([
      this.getActiveFeedSearchBlockedTerms(language),
      this.artistSearchSuggestions(normalizedKeyword, take),
      this.userSearchSuggestions(normalizedKeyword, take),
    ]);
    const [recentQueries, hashtags] = await Promise.all([
      this.searchQuerySuggestions(normalizedKeyword, language, since, take, blockedTerms),
      this.hashtagSuggestions(normalizedKeyword, language, since, take, blockedTerms),
    ]);

    return {
      generatedAt: new Date(),
      query: {
        keyword: rawKeyword ?? null,
        normalizedKeyword,
        language,
      },
      sections: {
        recentQueries,
        hashtags,
        artists,
        users,
      },
      items: [
        ...recentQueries.map((item) => ({ ...item, section: 'recentQueries' })),
        ...hashtags.map((item) => ({ ...item, section: 'hashtags' })),
        ...artists.map((item) => ({ ...item, section: 'artists' })),
        ...users.map((item) => ({ ...item, section: 'users' })),
      ],
      policy: {
        ...this.feedSearchPolicy(),
        qOptional: true,
        sectionTakeLimit: 10,
        defaultWindow: '24h',
        blockedTermFiltering: true,
      },
    };
  }

  async getTrendingSearches(query: CommunityQuery) {
    const take = this.take(query.take);
    const language = this.trendingLanguage(query.language ?? query.locale);
    const searchType = this.optionalSearchType(query.type);
    const window = this.trendingWindow(query.window);
    const since = new Date(Date.now() - window.ms);
    const blockedTerms = await this.getActiveFeedSearchBlockedTerms(language);
    const where: Prisma.FeedSearchEventWhereInput = this.clean({
      createdAt: { gte: since },
      language: language === 'all' ? undefined : language,
      searchType,
    });
    const grouped = await this.prisma.feedSearchEvent.groupBy({
      by: ['normalizedKeyword', 'searchType', 'language'],
      where,
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: [{ _count: { normalizedKeyword: 'desc' } }, { _max: { createdAt: 'desc' } }],
      take: Math.min(take * 3, 100),
    });
    const visibleGrouped = grouped
      .filter(
        (item) =>
          !this.isFeedSearchBlocked(
            blockedTerms,
            item.normalizedKeyword,
            item.searchType,
            item.language,
          ),
      )
      .slice(0, take);
    const latestEvents = visibleGrouped.length
      ? await this.prisma.feedSearchEvent.findMany({
          where: {
            OR: visibleGrouped.map((item) => ({
              normalizedKeyword: item.normalizedKeyword,
              searchType: item.searchType,
              language: item.language,
            })),
          },
          orderBy: { createdAt: 'desc' },
          distinct: ['normalizedKeyword', 'searchType', 'language'],
        })
      : [];
    const latestEventMap = new Map(
      latestEvents.map((event) => [
        this.trendingKey(event.normalizedKeyword, event.searchType, event.language),
        event,
      ]),
    );

    return {
      generatedAt: new Date(),
      language,
      type: searchType ?? 'all',
      window: {
        key: window.key,
        since,
        minutes: Math.round(window.ms / 60_000),
      },
      items: visibleGrouped.map((item, index) => {
        const latestEvent = latestEventMap.get(
          this.trendingKey(item.normalizedKeyword, item.searchType, item.language),
        );

        return {
          rank: index + 1,
          keyword: latestEvent?.keyword ?? item.normalizedKeyword,
          normalizedKeyword: item.normalizedKeyword,
          type: item.searchType,
          language: item.language,
          searchCount: item._count._all,
          lastSearchedAt: item._max.createdAt,
        };
      }),
      policy: this.feedSearchPolicy(),
    };
  }

  async getTrendingHashtags(query: CommunityQuery) {
    const take = this.take(query.take);
    const language = this.trendingLanguage(query.language ?? query.locale);
    const window = this.trendingWindow(query.window ?? '24h');
    const since = new Date(Date.now() - window.ms);
    const [posts, blockedTerms] = await Promise.all([
      this.prisma.communityPost.findMany({
        where: {
          status: 'published',
          visibility: 'public',
          deletedAt: null,
          ...this.publicFeedCleanupGuardWhere(),
          publishedAt: { gte: since },
          body: { contains: '#' },
        },
        take: 500,
        select: {
          id: true,
          body: true,
          publishedAt: true,
        },
        orderBy: { publishedAt: 'desc' },
      }),
      this.getActiveFeedSearchBlockedTerms(language),
    ]);
    const buckets = new Map<
      string,
      {
        keyword: string;
        normalizedKeyword: string;
        language: string;
        postIds: Set<string>;
        latestPublishedAt: Date;
      }
    >();

    for (const post of posts) {
      for (const hashtag of this.extractHashtags(post.body)) {
        const detectedLanguage = this.detectSearchLanguage(hashtag) ?? 'unknown';

        if (language !== 'all' && detectedLanguage !== language) {
          continue;
        }

        const normalizedKeyword = this.normalizeSearchKeyword(hashtag, 'hashtag');
        if (
          this.isFeedSearchBlocked(
            blockedTerms,
            normalizedKeyword,
            'hashtag',
            detectedLanguage,
          )
        ) {
          continue;
        }

        const bucketKey = this.trendingKey(normalizedKeyword, 'hashtag', detectedLanguage);
        const existing = buckets.get(bucketKey);

        if (existing) {
          existing.postIds.add(post.id);
          if (post.publishedAt > existing.latestPublishedAt) {
            existing.latestPublishedAt = post.publishedAt;
            existing.keyword = `#${hashtag}`;
          }
          continue;
        }

        buckets.set(bucketKey, {
          keyword: `#${hashtag}`,
          normalizedKeyword,
          language: detectedLanguage,
          postIds: new Set([post.id]),
          latestPublishedAt: post.publishedAt,
        });
      }
    }

    const items = [...buckets.values()]
      .sort((left, right) => {
        const countDiff = right.postIds.size - left.postIds.size;

        if (countDiff !== 0) {
          return countDiff;
        }

        return right.latestPublishedAt.getTime() - left.latestPublishedAt.getTime();
      })
      .slice(0, take)
      .map((item, index) => ({
        rank: index + 1,
        keyword: item.keyword,
        normalizedKeyword: item.normalizedKeyword,
        type: 'hashtag',
        language: item.language,
        postCount: item.postIds.size,
        latestPublishedAt: item.latestPublishedAt,
        searchUrl: `/api/v1/lumina-feed/search?q=${encodeURIComponent(
          item.keyword,
        )}&type=hashtag&language=${item.language}`,
      }));

    return {
      generatedAt: new Date(),
      language,
      window: {
        key: window.key,
        since,
        minutes: Math.round(window.ms / 60_000),
      },
      sampledPostCount: posts.length,
      items,
      policy: {
        ...this.feedSearchPolicy(),
        source: 'recent_public_feed_posts',
        maxSampledPosts: 500,
        blockedTermFiltering: true,
      },
    };
  }

  getSamplePosts(query: CommunityQuery) {
    const take = this.take(query.take);
    const mode = this.optionalString(query.mode) ?? 'all';
    const artistSlug = this.optionalString(query.artistSlug);

    if (!['all', 'artists', 'fans', 'debut'].includes(mode)) {
      throw new BadRequestException('mode must be all, artists, fans, or debut');
    }

    const posts = LUMINA_FEED_SAMPLE_POSTS.filter((post) => {
      if (artistSlug && post.artistSlug !== artistSlug) {
        return false;
      }

      if (mode === 'artists') {
        return post.postType === 'artist_post';
      }

      if (mode === 'fans') {
        return post.postType === 'fan_post';
      }

      if (mode === 'debut') {
        return post.postType === 'debut_artist_post';
      }

      return true;
    });

    return {
      source: 'notion_019_sample_posts',
      total: posts.length,
      items: posts.slice(0, take),
    };
  }

  async getArtistPosts(slug: string, query: CommunityQuery) {
    const artist = await this.prisma.artist.findFirst({
      where: { slug, status: 'active' },
      select: { id: true },
    });

    if (!artist) {
      throw new NotFoundException('Artist not found');
    }

    const posts = await this.prisma.communityPost.findMany({
      where: {
        artistId: artist.id,
        status: 'published',
        visibility: 'public',
        deletedAt: null,
        ...this.publicFeedCleanupGuardWhere(),
      },
      take: this.take(query.take),
      include: this.postInclude(),
      orderBy: { publishedAt: 'desc' },
    });

    return Promise.all(posts.map((post) => this.toPostView(post)));
  }

  async createPost(userId: string, input: CommunityBody) {
    await this.assertActiveUser(userId);
    const assetIds = await this.resolvePostAssetIds(input);
    const body = this.feedPostBody(input, assetIds.length > 0);
    const artistId = await this.resolveOptionalArtistId(input);
    const visibility = this.visibility(input.visibility);
    const metadata = this.buildPostMetadata(input);

    if (artistId) {
      await this.assertArtistOperator(userId, artistId);
    }

    const post = await this.prisma.communityPost.create({
      data: {
        authorUserId: userId,
        artistId,
        postType: artistId ? 'artist_post' : 'user_post',
        visibility,
        body,
        metadata: this.toJson(metadata),
        assets: assetIds.length
          ? {
              create: assetIds.map((assetId, index) => ({
                assetId,
                role: 'attachment',
                sortOrder: index,
              })),
            }
          : undefined,
      },
      include: this.postInclude(),
    });

    return { post: await this.toPostView(post) };
  }

  async createThreadPost(userId: string, input: CommunityBody) {
    await this.assertActiveUser(userId);
    const assetIds = await this.resolvePostAssetIds(input);
    const threadItems = this.feedThreadItems(input, assetIds.length > 0);
    const artistId = await this.resolveOptionalArtistId(input);
    const visibility = this.visibility(input.visibility);
    const now = new Date();
    const metadata = {
      ...this.buildPostMetadata(input),
      thread: this.buildThreadMetadata(threadItems, now),
    };

    if (artistId) {
      await this.assertArtistOperator(userId, artistId);
    }

    const post = await this.prisma.communityPost.create({
      data: {
        authorUserId: userId,
        artistId,
        postType: artistId ? 'artist_post' : 'user_post',
        visibility,
        body: threadItems[0].body,
        metadata: this.toJson(metadata),
        assets: assetIds.length
          ? {
              create: assetIds.map((assetId, index) => ({
                assetId,
                role: 'attachment',
                sortOrder: index,
              })),
            }
          : undefined,
      },
      include: this.postInclude(),
    });
    const postView = await this.toPostView(post, userId);

    return {
      post: postView,
      rootId: post.id,
      rootPostId: post.id,
      itemCount: postView.thread.itemCount,
      threadCount: postView.thread.threadCount,
      readProjection: postView.thread,
      policy: this.feedThreadPolicy(),
    };
  }

  async getThreadContinuations(
    postId: string,
    query: CommunityQuery,
    viewerUserId?: string | null,
  ) {
    const rootPost = await this.findPublicPost(postId);
    const take = this.take(query.take);
    const cursor = this.optionalString(query.cursor);

    if (cursor && !UUID_PATTERN.test(cursor)) {
      throw new BadRequestException('cursor must be a post UUID');
    }

    const where = {
      status: 'published',
      visibility: 'public',
      deletedAt: null,
      ...this.publicFeedCleanupGuardWhere(),
      metadata: {
        path: ['threadContinuation', 'rootPostId'],
        equals: rootPost.id,
      },
    } as Prisma.CommunityPostWhereInput;
    const posts = await this.prisma.communityPost.findMany({
      where,
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: this.postInclude(),
      orderBy: { publishedAt: 'asc' },
    });
    const items = await Promise.all(
      posts.map((post) => this.toPostView(post, viewerUserId)),
    );

    return {
      rootPostId: rootPost.id,
      relation: 'thread_continuation',
      items,
      posts: items,
      count: items.length,
      nextCursor: posts.length === take ? posts[posts.length - 1].id : null,
      policy: this.feedThreadContinuationPolicy(),
    };
  }

  async createThreadContinuation(
    userId: string,
    postId: string,
    input: CommunityBody,
  ) {
    await this.assertActiveUser(userId);
    const rootPost = await this.findPublicPostWithInclude(postId);

    if (rootPost.authorUserId !== userId) {
      throw new ForbiddenException('Post author access is required');
    }

    const body = this.text(input, 'body', 1, FEED_THREAD_CONTINUATION_MAX_BODY_CHARS);
    const metadata = {
      ...this.relationInputMetadata(input),
      threadContinuation: this.buildThreadContinuationMetadata(rootPost, new Date()),
    };
    const post = await this.prisma.communityPost.create({
      data: {
        authorUserId: userId,
        artistId: rootPost.artistId,
        postType: rootPost.postType ?? (rootPost.artistId ? 'artist_post' : 'user_post'),
        visibility: 'public',
        body,
        metadata: this.toJson(metadata),
      },
      include: this.postInclude(),
    });

    return {
      post: await this.toPostView(post, userId),
      rootPostId: rootPost.id,
      parentPostId: rootPost.id,
      relation: 'thread_continuation',
      policy: this.feedThreadContinuationPolicy(),
    };
  }

  async createRepost(userId: string, postId: string, input: CommunityBody) {
    await this.assertActiveUser(userId);
    const originalPost = await this.findPublicPostWithInclude(postId);
    await this.assertNoActiveUserBlock(userId, originalPost.authorUserId);
    const quoteBody = this.optionalText(input, 'body', FEED_POST_MAX_BODY_CHARS) ?? '';
    const metadata = {
      ...this.relationInputMetadata(input),
      repost: this.buildRepostMetadata(originalPost, quoteBody, new Date()),
    };
    const post = await this.prisma.communityPost.create({
      data: {
        authorUserId: userId,
        artistId: null,
        postType: 'user_post',
        visibility: 'public',
        body: quoteBody,
        metadata: this.toJson(metadata),
      },
      include: this.postInclude(),
    });

    return {
      post: await this.toPostView(post, userId),
      originalPostId: originalPost.id,
      relation: quoteBody ? 'quote_repost' : 'repost',
      policy: this.feedRepostPolicy(),
    };
  }

  async sharePost(postId: string) {
    const post = await this.findPublicPost(postId);

    return {
      ok: true,
      postId: post.id,
      relation: 'share',
      createsFeedRow: false,
      repostRelation: false,
      threadRelation: false,
      commentRelation: false,
      replyRelation: false,
      share: this.feedShareContract(post.id),
      policy: this.feedSharePolicy(),
    };
  }

  async getPost(postId: string, viewerUserId?: string | null) {
    const post = await this.findVisiblePostWithInclude(postId);

    return {
      post: await this.toPostView(post, viewerUserId),
      policy: {
        detailProjection: true,
        threadItemsOrderedBy: 'position',
        rootOnlyEngagement: true,
      },
    };
  }

  async createLinkPreview(userId: string, input: CommunityBody) {
    await this.assertActiveUser(userId);

    const url = this.text(input, 'url', 1, FEED_EXTERNAL_URL_MAX_LENGTH);
    const preview = this.buildLinkPreview(url);

    return {
      preview,
      policy: this.feedExternalLinkPolicy(),
    };
  }

  async deletePost(userId: string, postId: string) {
    await this.assertActiveUser(userId);

    if (!UUID_PATTERN.test(postId)) {
      throw new BadRequestException('postId must be a UUID');
    }

    const post = await this.prisma.communityPost.findFirst({
      where: {
        id: postId,
      },
      select: {
        id: true,
        authorUserId: true,
        status: true,
        deletedAt: true,
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.authorUserId !== userId) {
      if (post.deletedAt || post.status === 'deleted') {
        throw new NotFoundException('Post not found');
      }

      throw new ForbiddenException('Post author access is required');
    }

    if (post.deletedAt || post.status === 'deleted') {
      return { ok: true };
    }

    await this.prisma.communityPost.update({
      where: { id: post.id },
      data: {
        status: 'deleted',
        deletedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return { ok: true };
  }

  async updatePost(userId: string, postId: string, input: CommunityBody) {
    await this.assertActiveUser(userId);

    if (!UUID_PATTERN.test(postId)) {
      throw new BadRequestException('postId must be a UUID');
    }

    const post = await this.prisma.communityPost.findFirst({
      where: {
        id: postId,
        deletedAt: null,
      },
      select: {
        id: true,
        authorUserId: true,
        status: true,
        metadata: true,
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.status !== 'published') {
      throw new BadRequestException('Only published posts can be edited');
    }

    if (post.authorUserId !== userId) {
      throw new ForbiddenException('Post author access is required');
    }

    const body = this.text(input, 'body', 1, FEED_POST_MAX_BODY_CHARS);
    const currentMetadata = this.metadataObject(post.metadata);
    const inputMetadata = { ...(this.object(input, 'metadata') ?? {}) };
    delete inputMetadata.thread;
    const thread = this.threadMetadataObject(currentMetadata.thread);
    const metadata = {
      ...currentMetadata,
      ...inputMetadata,
      ...(thread
        ? {
            thread: {
              ...thread,
              updatedAt: new Date().toISOString(),
              rootUpdatedAt: new Date().toISOString(),
            },
          }
        : {}),
      editedAt: new Date().toISOString(),
      editedByUserId: userId,
      editScope: 'body_only_mvp',
    };
    const updatedPost = await this.prisma.communityPost.update({
      where: { id: post.id },
      data: {
        body,
        metadata: this.toJson(metadata),
        updatedAt: new Date(),
      },
      include: this.postInclude(),
    });

    return {
      post: await this.toPostView(updatedPost, userId),
      policy: {
        editScope: 'body_only_mvp',
        assetEditing: 'not_supported_yet',
      },
    };
  }

  async updateThreadItem(
    userId: string,
    postId: string,
    itemId: string,
    input: CommunityBody,
  ) {
    await this.assertActiveUser(userId);
    const post = await this.getOwnedThreadRoot(userId, postId);
    const body = this.threadItemBody(input.body, 2);
    const metadata = this.metadataObject(post.metadata);
    const thread = this.requireMutableThread(metadata.thread);
    const now = new Date().toISOString();
    const items = this.mutableStoredThreadItems(thread);
    const itemIndex = items.findIndex((item) => item.id === itemId);

    if (itemIndex < 0) {
      throw new NotFoundException('Thread item not found');
    }

    if (items[itemIndex].status === 'deleted' || items[itemIndex].deletedAt) {
      throw new BadRequestException('Deleted thread items cannot be edited');
    }

    items[itemIndex] = {
      ...items[itemIndex],
      body,
      updatedAt: now,
    };

    const updatedPost = await this.prisma.communityPost.update({
      where: { id: post.id },
      data: {
        metadata: this.toJson({
          ...metadata,
          thread: {
            ...thread,
            items,
            updatedAt: now,
          },
        }),
        updatedAt: new Date(),
      },
      include: this.postInclude(),
    });
    const postView = await this.toPostView(updatedPost, userId);

    return {
      ok: true,
      post: postView,
      threadItem: postView.thread.items.find((item: any) => item.id === itemId) ?? null,
      policy: this.feedThreadPolicy(),
    };
  }

  async deleteThreadItem(userId: string, postId: string, itemId: string) {
    await this.assertActiveUser(userId);
    const post = await this.getOwnedThreadRoot(userId, postId);
    const metadata = this.metadataObject(post.metadata);
    const thread = this.requireMutableThread(metadata.thread);
    const items = this.mutableStoredThreadItems(thread);
    const itemIndex = items.findIndex((item) => item.id === itemId);

    if (itemIndex < 0) {
      throw new NotFoundException('Thread item not found');
    }

    if (items[itemIndex].status === 'deleted' || items[itemIndex].deletedAt) {
      return { ok: true, alreadyDeleted: true };
    }

    const now = new Date().toISOString();
    items[itemIndex] = {
      ...items[itemIndex],
      status: 'deleted',
      deletedAt: now,
      updatedAt: now,
    };

    const updatedPost = await this.prisma.communityPost.update({
      where: { id: post.id },
      data: {
        metadata: this.toJson({
          ...metadata,
          thread: {
            ...thread,
            items,
            updatedAt: now,
          },
        }),
        updatedAt: new Date(),
      },
      include: this.postInclude(),
    });
    const postView = await this.toPostView(updatedPost, userId);

    return {
      ok: true,
      alreadyDeleted: false,
      post: postView,
      itemCount: postView.thread.itemCount,
      threadCount: postView.thread.threadCount,
      policy: this.feedThreadPolicy(),
    };
  }

  async getReplies(postId: string, query: CommunityQuery, viewerUserId?: string) {
    await this.findVisiblePost(postId);
    const blockedUserIds = viewerUserId
      ? await this.getBlockedRelationshipUserIds(viewerUserId)
      : [];

    const replies = await this.prisma.communityReply.findMany({
      where: {
        postId,
        status: 'published',
        deletedAt: null,
        authorUserId: blockedUserIds.length ? { notIn: blockedUserIds } : undefined,
      },
      take: this.take(query.take),
      include: this.replyInclude(),
      orderBy: { createdAt: 'asc' },
    });

    return replies.map((reply) => this.toReplyView(reply, viewerUserId));
  }

  async createReply(userId: string, postId: string, input: CommunityBody) {
    await this.assertActiveUser(userId);
    const post = await this.findVisiblePost(postId);
    await this.assertNoActiveUserBlock(userId, post.authorUserId);
    const body = this.text(input, 'body', 1, FEED_REPLY_MAX_BODY_CHARS);

    const result = await this.prisma.$transaction(async (tx) => {
      const reply = await tx.communityReply.create({
        data: {
          postId,
          authorUserId: userId,
          body,
          metadata: this.toJson(this.object(input, 'metadata') ?? {}),
        },
        include: this.replyInclude(),
      });

      await tx.communityPost.update({
        where: { id: postId },
        data: { replyCount: { increment: 1 }, updatedAt: new Date() },
      });

        return { reply: this.toReplyView(reply, userId) };
      });

      await this.createNotificationSafely({
        userId: post.authorUserId,
        type: 'feed.reply',
        title: 'New reply on your feed post',
      body: this.truncate(body, 120),
      actorUserId: userId,
      artistId: post.artistId,
      targetType: 'community_post',
      targetId: post.id,
    });

    return result;
  }

  async deleteReply(userId: string, replyId: string) {
    await this.assertActiveUser(userId);

    if (!UUID_PATTERN.test(replyId)) {
      throw new BadRequestException('replyId must be a UUID');
    }

    const reply = await this.prisma.communityReply.findFirst({
      where: {
        id: replyId,
        deletedAt: null,
      },
      select: {
        id: true,
        postId: true,
        authorUserId: true,
        post: {
          select: {
            artistId: true,
          },
        },
      },
    });

    if (!reply) {
      throw new NotFoundException('Reply not found');
    }

    if (reply.authorUserId !== userId) {
      if (!reply.post.artistId) {
        throw new ForbiddenException('Reply author access is required');
      }

      await this.assertArtistOperator(userId, reply.post.artistId);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.communityReply.update({
        where: { id: reply.id },
        data: {
          status: 'deleted',
          deletedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      await tx.communityPost.update({
        where: { id: reply.postId },
        data: {
          replyCount: { decrement: 1 },
          updatedAt: new Date(),
        },
      });

      return { ok: true };
    });
  }

  async likePost(userId: string, postId: string, idempotencyKey?: string) {
    const visiblePost = await this.findVisiblePost(postId);
    await this.assertNoActiveUserBlock(userId, visiblePost.authorUserId);

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const reaction = await tx.communityReaction.create({
          data: {
            postId,
            userId,
            reactionType: 'like',
          },
        });

        const post = await tx.communityPost.update({
          where: { id: postId },
          data: { likeCount: { increment: 1 }, updatedAt: new Date() },
          include: this.postInclude(),
        });

        return {
          reaction,
          post,
          idempotentReplay: false,
          idempotencyKey: idempotencyKey ?? null,
        };
      });

      await this.createNotificationSafely({
        userId: visiblePost.authorUserId,
        type: 'feed.like',
        title: 'New like on your feed post',
        actorUserId: userId,
        artistId: visiblePost.artistId,
        targetType: 'community_post',
        targetId: visiblePost.id,
      });

      return {
        ...result,
        post: await this.toPostView(result.post, userId),
      };
    } catch (error) {
      if (this.isUniqueConstraint(error)) {
        const post = await this.prisma.communityPost.findUnique({
          where: { id: postId },
          include: this.postInclude(),
        });
        return {
          post: post ? await this.toPostView(post, userId) : null,
          idempotentReplay: true,
          idempotencyKey: idempotencyKey ?? null,
        };
      }

      throw error;
    }
  }

  async unlikePost(userId: string, postId: string) {
    await this.findVisiblePost(postId);

    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.communityReaction.deleteMany({
        where: {
          postId,
          userId,
          reactionType: 'like',
        },
      });

      if (deleted.count > 0) {
        await tx.communityPost.update({
          where: { id: postId },
          data: { likeCount: { decrement: 1 }, updatedAt: new Date() },
        });
      }

      const post = await tx.communityPost.findUnique({
        where: { id: postId },
        include: this.postInclude(),
      });

      return {
        ok: true,
        removed: deleted.count > 0,
        post: post ? await this.toPostView(post, userId) : null,
      };
    });
  }

  async reportPost(userId: string, postId: string, input: CommunityBody) {
    await this.findVisiblePost(postId);
    const reason = this.reportReason(input.reason);
    const detail = this.optionalText(input, 'detail', 500);

    return this.prisma.$transaction(async (tx) => {
      const report = await tx.communityReport.create({
        data: {
          postId,
          reporterUserId: userId,
          reason,
          detail,
          metadata: this.toJson(this.object(input, 'metadata') ?? {}),
        },
      });

      await tx.communityPost.update({
        where: { id: postId },
        data: { reportCount: { increment: 1 }, updatedAt: new Date() },
      });

      return { report };
    });
  }

  async hidePost(userId: string, postId: string) {
    await this.assertActiveUser(userId);
    await this.findVisiblePost(postId);

    const hiddenPost = await this.prisma.communityHiddenPost.upsert({
      where: {
        userId_postId: {
          userId,
          postId,
        },
      },
      create: {
        userId,
        postId,
      },
      update: {
        status: 'active',
        deletedAt: null,
        updatedAt: new Date(),
      },
      include: this.hiddenPostInclude(),
    });

    return { hiddenPost: await this.toHiddenPostView(hiddenPost) };
  }

  async unhidePost(userId: string, postId: string) {
    if (!UUID_PATTERN.test(postId)) {
      throw new BadRequestException('postId must be a UUID');
    }

    await this.prisma.communityHiddenPost.updateMany({
      where: {
        userId,
        postId,
        status: 'active',
      },
      data: {
        status: 'deleted',
        deletedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return { ok: true };
  }

  async followArtist(userId: string, artistId: string) {
    const artist = await this.resolveActiveArtist(artistId);

    const follow = await this.prisma.artistFollow.upsert({
      where: {
        userId_artistId: {
          userId,
          artistId: artist.id,
        },
      },
      create: {
        userId,
        artistId: artist.id,
      },
      update: {
        status: 'active',
        deletedAt: null,
        updatedAt: new Date(),
      },
      include: this.followInclude(),
    });

    return this.toArtistFollowActionView(follow, true);
  }

  async unfollowArtist(userId: string, artistId: string) {
    const artist = await this.resolveActiveArtist(artistId);

    await this.prisma.artistFollow.updateMany({
      where: {
        userId,
        artistId: artist.id,
        status: 'active',
      },
      data: {
        status: 'deleted',
        deletedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return {
      ok: true,
      artist: {
        id: artist.id,
        slug: artist.slug,
        displayName: artist.displayName,
      },
      stats: await this.artistFollowStats(artist.id),
      viewer: {
        isAuthenticated: true,
        isFollowing: false,
        canFollow: true,
        canUnfollow: false,
      },
    };
  }

  async followUser(followerUserId: string, followingUserId: string) {
    if (!UUID_PATTERN.test(followingUserId)) {
      throw this.socialBadRequest(
        'INVALID_USER_ID',
        'social.user.invalidId',
        'userId must be a UUID',
      );
    }

    if (followerUserId === followingUserId) {
      throw this.socialConflict(
        'SELF_FOLLOW_NOT_ALLOWED',
        'social.follow.selfNotAllowed',
        'Cannot follow yourself',
      );
    }

    await this.assertActiveUser(followerUserId);
    await this.assertActiveUser(followingUserId);
    await this.assertNoActiveUserBlock(followerUserId, followingUserId);

    const existing = await this.prisma.userFollow.findUnique({
      where: {
        followerUserId_followingUserId: {
          followerUserId,
          followingUserId,
        },
      },
      select: {
        status: true,
        deletedAt: true,
      },
    });
    const shouldNotify = !existing || existing.status !== 'active' || existing.deletedAt;

    const follow = await this.prisma.userFollow.upsert({
      where: {
        followerUserId_followingUserId: {
          followerUserId,
          followingUserId,
        },
      },
      create: {
        followerUserId,
        followingUserId,
      },
      update: {
        status: 'active',
        deletedAt: null,
        updatedAt: new Date(),
      },
      include: this.userFollowInclude('following'),
    });

    if (shouldNotify) {
      await this.createNotificationSafely({
        userId: followingUserId,
        type: 'user.follow',
        title: 'New follower',
        actorUserId: followerUserId,
        targetType: 'user',
        targetId: followerUserId,
      });
    }

    return this.toUserFollowActionView(follow, followerUserId, followingUserId, true);
  }

  async followUserByHandle(followerUserId: string, publicHandle: string) {
    const followingUserId = await this.resolveActiveUserIdByHandle(publicHandle);

    return this.followUser(followerUserId, followingUserId);
  }

  async unfollowUser(followerUserId: string, followingUserId: string) {
    if (!UUID_PATTERN.test(followingUserId)) {
      throw this.socialBadRequest(
        'INVALID_USER_ID',
        'social.user.invalidId',
        'userId must be a UUID',
      );
    }

    await this.prisma.userFollow.updateMany({
      where: {
        followerUserId,
        followingUserId,
        status: 'active',
      },
      data: {
        status: 'deleted',
        deletedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return {
      ok: true,
      user: await this.publicUserSummary(followingUserId),
      stats: await this.userFollowStats(followingUserId),
      viewer: {
        isAuthenticated: true,
        isFollowing: false,
        canFollow: true,
        canUnfollow: false,
      },
    };
  }

  async unfollowUserByHandle(followerUserId: string, publicHandle: string) {
    const followingUserId = await this.resolveActiveUserIdByHandle(publicHandle);

    return this.unfollowUser(followerUserId, followingUserId);
  }

  async blockUser(blockerUserId: string, blockedUserId: string, input: CommunityBody = {}) {
    if (!UUID_PATTERN.test(blockedUserId)) {
      throw this.socialBadRequest(
        'INVALID_USER_ID',
        'social.user.invalidId',
        'userId must be a UUID',
      );
    }

    if (blockerUserId === blockedUserId) {
      throw this.socialConflict(
        'SELF_BLOCK_NOT_ALLOWED',
        'social.block.selfNotAllowed',
        'Cannot block yourself',
      );
    }

    const reason = this.optionalText(input, 'reason', 200);
    await this.assertActiveUser(blockerUserId);
    await this.assertActiveUser(blockedUserId);

    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.userBlock.upsert({
        where: {
          blockerUserId_blockedUserId: {
            blockerUserId,
            blockedUserId,
          },
        },
        create: {
          blockerUserId,
          blockedUserId,
          reason,
        },
        update: {
          status: 'active',
          reason,
          deletedAt: null,
          updatedAt: new Date(),
        },
        include: this.userBlockInclude(),
      });

      const viewerToTargetFollow = await tx.userFollow.updateMany({
        where: {
          followerUserId: blockerUserId,
          followingUserId: blockedUserId,
          status: 'active',
        },
        data: {
          status: 'deleted',
          deletedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      const targetToViewerFollow = await tx.userFollow.updateMany({
        where: {
          followerUserId: blockedUserId,
          followingUserId: blockerUserId,
          status: 'active',
        },
        data: {
          status: 'deleted',
          deletedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: blockerUserId,
          actorType: 'user',
          action: 'community.user_block.activated',
          targetType: 'user_block',
          targetId: created.id,
          beforeData: Prisma.JsonNull,
          afterData: this.toJson({
            blockerUserId,
            blockedUserId,
            status: 'active',
            reasonStoredOnBlock: Boolean(reason),
          }),
          metadata: this.toJson({
            viewerToTargetFollowRemoved: viewerToTargetFollow.count > 0,
            targetToViewerFollowRemoved: targetToViewerFollow.count > 0,
            rawEmailStored: false,
            rawTokenStored: false,
            rawCookieStored: false,
            rawIpStored: false,
            walletMutation: false,
            luminaMutation: false,
            paymentMutation: false,
            settlementMutation: false,
          }),
        },
      });

      return {
        block: created,
        viewerToTargetFollowRemoved: viewerToTargetFollow.count > 0,
        targetToViewerFollowRemoved: targetToViewerFollow.count > 0,
      };
    });

    return {
      block: await this.toUserBlockView(result.block),
      effects: {
        viewerToTargetFollowRemoved: result.viewerToTargetFollowRemoved,
        targetToViewerFollowRemoved: result.targetToViewerFollowRemoved,
        refollowBlocked: true,
        feedHiddenForViewer: true,
        commentsHiddenForViewer: true,
        premiumChatBlockedBeforeWallet: true,
        supportBlockedBeforeWallet: true,
      },
      policy: this.userBlockPolicy(),
    };
  }

  async blockUserByHandle(
    blockerUserId: string,
    publicHandle: string,
    input: CommunityBody = {},
  ) {
    const blockedUserId = await this.resolveActiveUserIdByHandle(publicHandle);

    return this.blockUser(blockerUserId, blockedUserId, input);
  }

  async unblockUser(blockerUserId: string, blockedUserId: string) {
    if (!UUID_PATTERN.test(blockedUserId)) {
      throw this.socialBadRequest(
        'INVALID_USER_ID',
        'social.user.invalidId',
        'userId must be a UUID',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.userBlock.updateMany({
        where: {
          blockerUserId,
          blockedUserId,
          status: 'active',
        },
        data: {
          status: 'deleted',
          deletedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      if (deleted.count > 0) {
        await tx.auditEvent.create({
          data: {
            actorUserId: blockerUserId,
            actorType: 'user',
            action: 'community.user_block.deleted',
            targetType: 'user_block',
            targetId: blockedUserId,
            beforeData: this.toJson({
              blockerUserId,
              blockedUserId,
              status: 'active',
            }),
            afterData: this.toJson({
              blockerUserId,
              blockedUserId,
              status: 'deleted',
            }),
            metadata: this.toJson({
              rawEmailStored: false,
              rawTokenStored: false,
              rawCookieStored: false,
              rawIpStored: false,
              walletMutation: false,
              luminaMutation: false,
              paymentMutation: false,
              settlementMutation: false,
            }),
          },
        });
      }
    });

    return { ok: true };
  }

  async unblockUserByHandle(blockerUserId: string, publicHandle: string) {
    const blockedUserId = await this.resolveActiveUserIdByHandle(publicHandle);

    return this.unblockUser(blockerUserId, blockedUserId);
  }

  async getPublicUserProfile(userId: string, viewerUserId?: string) {
    if (!UUID_PATTERN.test(userId)) {
      throw new BadRequestException('userId must be a UUID');
    }

    return this.getPublicUserProfileByWhere({ id: userId }, viewerUserId);
  }

  async getPublicUserProfileByHandle(publicHandle: string, viewerUserId?: string) {
    const normalizedHandle = this.normalizePublicHandle(publicHandle);

    return this.getPublicUserProfileByWhere(
      {
        profile: { is: { publicHandle: normalizedHandle } },
      },
      viewerUserId,
    );
  }

  async getPublicUserPosts(
    userId: string,
    query: CommunityQuery,
    viewerUserId?: string,
  ) {
    if (!UUID_PATTERN.test(userId)) {
      throw new BadRequestException('userId must be a UUID');
    }

    return this.getPublicUserPostsByWhere({ id: userId }, query, viewerUserId);
  }

  async getPublicUserPostsByHandle(
    publicHandle: string,
    query: CommunityQuery,
    viewerUserId?: string,
  ) {
    const normalizedHandle = this.normalizePublicHandle(publicHandle);

    return this.getPublicUserPostsByWhere(
      {
        profile: { is: { publicHandle: normalizedHandle } },
      },
      query,
      viewerUserId,
    );
  }

  private async getPublicUserProfileByWhere(where: {
    id?: string;
    profile?: { is: { publicHandle: string } };
  }, viewerUserId?: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        ...where,
        status: 'active',
        deletedAt: null,
      },
      select: {
        id: true,
        email: true,
        createdAt: true,
        profile: {
          select: {
            displayName: true,
            publicHandle: true,
            avatarAssetId: true,
            coverAssetId: true,
            bio: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.assertProfileVisibleToViewer(user.id, viewerUserId);
    const blockedUserIds = viewerUserId
      ? await this.getBlockedRelationshipUserIds(viewerUserId)
      : [];
    const followerCountWhere = this.clean({
      followingUserId: user.id,
      status: 'active',
      deletedAt: null,
      followerUserId: blockedUserIds.length ? { notIn: blockedUserIds } : undefined,
    });
    const followingUserCountWhere = this.clean({
      followerUserId: user.id,
      status: 'active',
      deletedAt: null,
      followingUserId: blockedUserIds.length ? { notIn: blockedUserIds } : undefined,
    });

    const [
      followers,
      followingUsers,
      followingArtists,
      posts,
      replies,
      recentPosts,
    ] = await Promise.all([
      this.prisma.userFollow.count({
        where: followerCountWhere,
      }),
      this.prisma.userFollow.count({
        where: followingUserCountWhere,
      }),
      this.prisma.artistFollow.count({
        where: { userId: user.id, status: 'active', deletedAt: null },
      }),
      this.prisma.communityPost.count({
        where: {
          authorUserId: user.id,
          status: 'published',
          visibility: 'public',
          deletedAt: null,
        },
      }),
      this.prisma.communityReply.count({
        where: { authorUserId: user.id, status: 'published', deletedAt: null },
      }),
      this.prisma.communityPost.findMany({
        where: {
          authorUserId: user.id,
          status: 'published',
          visibility: 'public',
          deletedAt: null,
        },
        take: 5,
        include: this.postInclude(),
        orderBy: { publishedAt: 'desc' },
      }),
    ]);
    const viewer = await this.userProfileViewerState(user.id, viewerUserId);

    return {
      user: {
        ...(await this.toCompactUserView(user)),
        bio: user.profile?.bio ?? null,
        createdAt: user.createdAt,
      },
      stats: {
        followerCount: followers,
        followingCount: followingUsers,
        followingArtistCount: followingArtists,
        postCount: posts,
        replyCount: replies,
        followers,
        followingUsers,
        followingArtists,
        posts,
        replies,
      },
      viewer,
      policy: {
        visibility: 'public_active_users_only',
        profileRouteKey: 'publicHandle',
        postsEndpoint: 'GET /api/v1/users/handle/:publicHandle/lumina-feed',
        followEndpoint: 'POST /api/v1/users/:userId/follow',
        unfollowEndpoint: 'DELETE /api/v1/users/:userId/follow',
        editProfileEndpoint: 'PATCH /api/v1/me/profile',
        countProjection: {
          followerRowsBlockedByViewerExcluded: true,
          followingRowsBlockedByViewerExcluded: true,
          blockedRelationshipDirection: 'either_direction',
        },
      },
      recentPosts: await Promise.all(
        recentPosts.map((post) => this.toPostView(post, viewerUserId)),
      ),
    };
  }

  private async getPublicUserPostsByWhere(
    where: {
      id?: string;
      profile?: { is: { publicHandle: string } };
    },
    query: CommunityQuery,
    viewerUserId?: string,
  ) {
    const user = await this.prisma.user.findFirst({
      where: {
        ...where,
        status: 'active',
        deletedAt: null,
      },
      select: {
        id: true,
        profile: {
          select: {
            displayName: true,
            publicHandle: true,
            avatarAssetId: true,
            coverAssetId: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.assertProfileVisibleToViewer(user.id, viewerUserId);

    const take = this.take(query.take);
    const cursor = this.optionalString(query.cursor);

    if (cursor && !UUID_PATTERN.test(cursor)) {
      throw new BadRequestException('cursor must be a post UUID');
    }

    const posts = await this.prisma.communityPost.findMany({
      where: {
        authorUserId: user.id,
        status: 'published',
        visibility: 'public',
        deletedAt: null,
        ...this.publicFeedCleanupGuardWhere(),
      },
      include: this.postInclude(),
      orderBy: { publishedAt: 'desc' },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    return {
      user: await this.toCompactUserView(user),
      items: await Promise.all(posts.map((post) => this.toPostView(post, viewerUserId))),
      count: posts.length,
      nextCursor: posts.length === take ? posts[posts.length - 1]?.id ?? null : null,
      viewer: await this.userProfileViewerState(user.id, viewerUserId),
      policy: {
        visibility: 'public_posts_only',
        pagination: 'cursor_by_post_id',
      },
    };
  }

  async getPublicUserFollowers(
    userId: string,
    query: CommunityQuery = {},
    viewerUserId?: string,
  ) {
    if (!UUID_PATTERN.test(userId)) {
      throw this.socialBadRequest(
        'INVALID_USER_ID',
        'social.user.invalidId',
        'userId must be a UUID',
      );
    }

    return this.getPublicUserFollowListByWhere(
      { id: userId },
      'followers',
      query,
      viewerUserId,
    );
  }

  async getPublicUserFollowingUsers(
    userId: string,
    query: CommunityQuery = {},
    viewerUserId?: string,
  ) {
    if (!UUID_PATTERN.test(userId)) {
      throw this.socialBadRequest(
        'INVALID_USER_ID',
        'social.user.invalidId',
        'userId must be a UUID',
      );
    }

    return this.getPublicUserFollowListByWhere(
      { id: userId },
      'following-users',
      query,
      viewerUserId,
    );
  }

  async getPublicUserFollowersByHandle(
    publicHandle: string,
    query: CommunityQuery = {},
    viewerUserId?: string,
  ) {
    const normalizedHandle = this.normalizePublicHandle(publicHandle);

    return this.getPublicUserFollowListByWhere(
      { profile: { is: { publicHandle: normalizedHandle } } },
      'followers',
      query,
      viewerUserId,
    );
  }

  async getPublicUserFollowingUsersByHandle(
    publicHandle: string,
    query: CommunityQuery = {},
    viewerUserId?: string,
  ) {
    const normalizedHandle = this.normalizePublicHandle(publicHandle);

    return this.getPublicUserFollowListByWhere(
      { profile: { is: { publicHandle: normalizedHandle } } },
      'following-users',
      query,
      viewerUserId,
    );
  }

  async getPublicUserFollowingArtists(
    userId: string,
    query: CommunityQuery = {},
    viewerUserId?: string,
  ) {
    if (!UUID_PATTERN.test(userId)) {
      throw this.socialBadRequest(
        'INVALID_USER_ID',
        'social.user.invalidId',
        'userId must be a UUID',
      );
    }

    return this.getPublicUserFollowingArtistListByWhere(
      { id: userId },
      query,
      viewerUserId,
    );
  }

  async getPublicUserFollowingArtistsByHandle(
    publicHandle: string,
    query: CommunityQuery = {},
    viewerUserId?: string,
  ) {
    const normalizedHandle = this.normalizePublicHandle(publicHandle);

    return this.getPublicUserFollowingArtistListByWhere(
      { profile: { is: { publicHandle: normalizedHandle } } },
      query,
      viewerUserId,
    );
  }

  private async getPublicUserFollowListByWhere(
    where: {
      id?: string;
      profile?: { is: { publicHandle: string } };
    },
    list: 'followers' | 'following-users',
    query: CommunityQuery,
    viewerUserId?: string,
  ) {
    const user = await this.prisma.user.findFirst({
      where: {
        ...where,
        status: 'active',
        deletedAt: null,
      },
      select: {
        id: true,
        profile: {
          select: {
            displayName: true,
            publicHandle: true,
            avatarAssetId: true,
            coverAssetId: true,
          },
        },
      },
    });

    if (!user) {
      throw this.socialNotFound(
        'USER_NOT_FOUND',
        'social.user.notFound',
        'User not found',
      );
    }

    await this.assertProfileVisibleToViewer(user.id, viewerUserId);

    const take = this.take(query.take);
    const cursor = this.optionalString(query.cursor);

    if (cursor && !UUID_PATTERN.test(cursor)) {
      throw this.socialBadRequest(
        'INVALID_CURSOR',
        'social.followList.invalidCursor',
        'cursor must be a follow UUID',
      );
    }

    const direction = list === 'followers' ? 'follower' : 'following';
    const blockedUserIds = viewerUserId
      ? await this.getBlockedRelationshipUserIds(viewerUserId)
      : [];
    const followWhere =
      list === 'followers'
        ? this.clean({
            followingUserId: user.id,
            status: 'active',
            deletedAt: null,
            followerUserId: blockedUserIds.length ? { notIn: blockedUserIds } : undefined,
            follower: {
              status: 'active',
              deletedAt: null,
            },
          })
        : this.clean({
            followerUserId: user.id,
            status: 'active',
            deletedAt: null,
            followingUserId: blockedUserIds.length ? { notIn: blockedUserIds } : undefined,
            following: {
              status: 'active',
              deletedAt: null,
            },
          });

    const [follows, total] = await Promise.all([
      this.prisma.userFollow.findMany({
        where: followWhere,
        include: this.userFollowInclude(direction),
        orderBy: { createdAt: 'desc' },
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.prisma.userFollow.count({ where: followWhere }),
    ]);
    const items = await Promise.all(
      follows.map((follow) =>
        this.toUserFollowView(follow, direction, viewerUserId, true),
      ),
    );

    return {
      ...this.userFollowListResponse(items, follows, total, take),
      target: await this.toCompactUserView(user),
      viewer: {
        ...(await this.userProfileViewerState(user.id, viewerUserId)),
        canViewList: true,
      },
      policy: {
        projection: USER_SOCIAL_ACCOUNT_CONTRACT.profileFollowLists.projection,
        visibility: 'public_active_profiles_only',
        list,
        hiddenUserRule:
          'Only active non-deleted users are returned; suspended, deleted, or inactive users are hidden from follow cards.',
        blockedUserRule:
          'Authenticated viewers do not receive list rows for users in an active block relationship; a block relationship with the target profile returns 403.',
        viewerHints: [
          'isAuthenticated',
          'isSelf',
          'isFollowing',
          'canFollow',
          'canUnfollow',
          'blockedByMe',
          'hasBlockedMe',
        ],
        privateFieldsExcluded:
          USER_SOCIAL_ACCOUNT_CONTRACT.profileFollowLists.privateFieldsExcluded,
      },
    };
  }

  private async getPublicUserFollowingArtistListByWhere(
    where: {
      id?: string;
      profile?: { is: { publicHandle: string } };
    },
    query: CommunityQuery,
    viewerUserId?: string,
  ) {
    const user = await this.prisma.user.findFirst({
      where: {
        ...where,
        status: 'active',
        deletedAt: null,
      },
      select: {
        id: true,
        profile: {
          select: {
            displayName: true,
            publicHandle: true,
            avatarAssetId: true,
            coverAssetId: true,
          },
        },
      },
    });

    if (!user) {
      throw this.socialNotFound(
        'USER_NOT_FOUND',
        'social.user.notFound',
        'User not found',
      );
    }

    await this.assertProfileVisibleToViewer(user.id, viewerUserId);

    const take = this.take(query.take);
    const cursor = this.optionalString(query.cursor);

    if (cursor && !UUID_PATTERN.test(cursor)) {
      throw this.socialBadRequest(
        'INVALID_CURSOR',
        'social.followList.invalidCursor',
        'cursor must be a follow UUID',
      );
    }

    const followWhere = {
      userId: user.id,
      status: 'active',
      deletedAt: null,
      artist: { status: 'active' },
    } satisfies Prisma.ArtistFollowWhereInput;

    const [follows, total] = await Promise.all([
      this.prisma.artistFollow.findMany({
        where: followWhere,
        include: this.followInclude(),
        orderBy: { createdAt: 'desc' },
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.prisma.artistFollow.count({ where: followWhere }),
    ]);
    const items = await Promise.all(
      follows.map((follow) => this.toArtistFollowView(follow)),
    );

    return {
      items,
      artists: items,
      count: items.length,
      total,
      nextCursor: follows.length === take ? follows[follows.length - 1]?.id ?? null : null,
      target: await this.toCompactUserView(user),
      viewer: {
        ...(await this.userProfileViewerState(user.id, viewerUserId)),
        canViewList: true,
      },
      policy: {
        projection: 'public_user_follow_summary_v1',
        visibility: 'public_active_profiles_only',
        list: 'following-artists',
        hiddenArtistRule:
          'Only active public artists are returned; draft, archived, deleted, or suspended artists are hidden from public follow cards.',
        privateFieldsExcluded: [
          'email',
          'phone',
          'providerIds',
          'walletAccounts',
          'walletLedger',
          'paymentOrders',
          'privateProfile',
          'artistOwnership',
          'operatorFields',
          'settlement',
          'payout',
          'moderationNotes',
        ],
      },
    };
  }

  private async userProfileViewerState(targetUserId: string, viewerUserId?: string) {
    const isAuthenticated = Boolean(viewerUserId);
    const isSelf = Boolean(viewerUserId && viewerUserId === targetUserId);
    const follow = viewerUserId
      ? await this.prisma.userFollow.findUnique({
          where: {
            followerUserId_followingUserId: {
              followerUserId: viewerUserId,
              followingUserId: targetUserId,
            },
          },
          select: {
            status: true,
            deletedAt: true,
          },
        })
      : null;
    const block =
      viewerUserId && !isSelf
        ? await this.prisma.userBlock.findFirst({
            where: {
              status: 'active',
              deletedAt: null,
              OR: [
                { blockerUserId: viewerUserId, blockedUserId: targetUserId },
                { blockerUserId: targetUserId, blockedUserId: viewerUserId },
              ],
            },
            select: {
              blockerUserId: true,
              blockedUserId: true,
            },
          })
        : null;
    const isFollowing = Boolean(follow?.status === 'active' && !follow.deletedAt);
    const blockedByMe = Boolean(viewerUserId && block?.blockerUserId === viewerUserId);
    const hasBlockedMe = Boolean(viewerUserId && block?.blockedUserId === viewerUserId);
    const isBlocked = blockedByMe || hasBlockedMe;

    return {
      isAuthenticated,
      isSelf,
      isFollowing,
      canFollow: Boolean(viewerUserId && !isSelf && !isFollowing && !isBlocked),
      canUnfollow: Boolean(viewerUserId && !isSelf && isFollowing && !isBlocked),
      canEditProfile: isSelf,
      blockedByMe,
      hasBlockedMe,
    };
  }

  private async assertProfileVisibleToViewer(targetUserId: string, viewerUserId?: string) {
    if (!viewerUserId || viewerUserId === targetUserId) {
      return;
    }

    const block = await this.prisma.userBlock.findFirst({
      where: {
        status: 'active',
        deletedAt: null,
        OR: [
          { blockerUserId: viewerUserId, blockedUserId: targetUserId },
          { blockerUserId: targetUserId, blockedUserId: viewerUserId },
        ],
      },
      select: {
        id: true,
      },
    });

    if (block) {
      throw this.socialForbidden(
        'USER_PROFILE_BLOCKED',
        'social.profile.blocked',
        'User profile is not available',
      );
    }
  }

  async getMyFollowing(userId: string) {
    const [artists, users] = await Promise.all([
      this.getMyFollowingArtists(userId),
      this.getMyFollowingUsers(userId),
    ]);

    return {
      artists: artists.items,
      users: users.items,
      summaries: {
        artists: {
          count: artists.count,
          total: artists.total,
          nextCursor: artists.nextCursor,
        },
        users: {
          count: users.count,
          total: users.total,
          nextCursor: users.nextCursor,
        },
      },
    };
  }

  async getMyFollowingArtists(userId: string, query: CommunityQuery = {}) {
    await this.assertActiveUser(userId);
    const take = this.take(query.take);
    const cursor = this.optionalString(query.cursor);

    if (cursor && !UUID_PATTERN.test(cursor)) {
      throw new BadRequestException('cursor must be a follow UUID');
    }

    const where = {
      userId,
      status: 'active',
      deletedAt: null,
      artist: { status: 'active' },
    } satisfies Prisma.ArtistFollowWhereInput;

    const [follows, total] = await Promise.all([
      this.prisma.artistFollow.findMany({
        where,
        include: this.followInclude(),
        orderBy: { createdAt: 'desc' },
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.prisma.artistFollow.count({ where }),
    ]);
    const items = await Promise.all(
      follows.map((follow) => this.toArtistFollowView(follow)),
    );

    return {
      items,
      artists: items,
      count: items.length,
      total,
      nextCursor: follows.length === take ? follows[follows.length - 1]?.id ?? null : null,
      policy: {
        hiddenArtistRule:
          'Only active public artists are returned; draft, archived, deleted, or suspended artists are hidden from My Page follow cards.',
      },
    };
  }

  async getMyFollowingUsers(userId: string, query: CommunityQuery = {}) {
    const take = this.take(query.take);
    const cursor = this.optionalString(query.cursor);

    if (cursor && !UUID_PATTERN.test(cursor)) {
      throw new BadRequestException('cursor must be a follow UUID');
    }

    const where = {
      followerUserId: userId,
      status: 'active',
      deletedAt: null,
      following: {
        status: 'active',
        deletedAt: null,
      },
    } satisfies Prisma.UserFollowWhereInput;

    const [follows, total] = await Promise.all([
      this.prisma.userFollow.findMany({
        where,
        include: this.userFollowInclude('following'),
        orderBy: { createdAt: 'desc' },
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.prisma.userFollow.count({ where }),
    ]);
    const items = await Promise.all(
      follows.map((follow) => this.toUserFollowView(follow, 'following')),
    );

    return this.userFollowListResponse(items, follows, total, take);
  }

  async getMyFollowers(userId: string, query: CommunityQuery = {}) {
    const take = this.take(query.take);
    const cursor = this.optionalString(query.cursor);

    if (cursor && !UUID_PATTERN.test(cursor)) {
      throw new BadRequestException('cursor must be a follow UUID');
    }

    const where = {
      followingUserId: userId,
      status: 'active',
      deletedAt: null,
      follower: {
        status: 'active',
        deletedAt: null,
      },
    } satisfies Prisma.UserFollowWhereInput;

    const [follows, total] = await Promise.all([
      this.prisma.userFollow.findMany({
        where,
        include: this.userFollowInclude('follower'),
        orderBy: { createdAt: 'desc' },
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.prisma.userFollow.count({ where }),
    ]);
    const items = await Promise.all(
      follows.map((follow) => this.toUserFollowView(follow, 'follower')),
    );

    return this.userFollowListResponse(items, follows, total, take);
  }

  async removeFollower(userId: string, followerUserId: string) {
    if (!UUID_PATTERN.test(followerUserId)) {
      throw this.socialBadRequest(
        'INVALID_USER_ID',
        'social.user.invalidId',
        'userId must be a UUID',
      );
    }

    if (userId === followerUserId) {
      throw this.socialConflict(
        'SELF_FOLLOW_NOT_ALLOWED',
        'social.follow.selfNotAllowed',
        'Cannot remove yourself as follower',
      );
    }

    await this.assertActiveUser(userId);
    await this.assertActiveUser(followerUserId);

    const removed = await this.prisma.userFollow.updateMany({
      where: {
        followerUserId,
        followingUserId: userId,
        status: 'active',
      },
      data: {
        status: 'deleted',
        deletedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return {
      ok: true,
      removed: removed.count > 0,
      user: await this.publicUserSummary(followerUserId),
      stats: await this.userFollowStats(userId),
      viewer: {
        isAuthenticated: true,
        isSelf: false,
        isFollowing: false,
        canFollow: true,
        canUnfollow: false,
      },
      policy: {
        blockCreated: false,
        refollowAllowed: true,
        walletMutation: false,
        luminaMutation: false,
        paymentMutation: false,
        refundMutation: false,
        payoutMutation: false,
        settlementMutation: false,
        revenueSharingMutation: false,
      },
    };
  }

  async getMyHiddenPosts(userId: string, query: CommunityQuery) {
    const hiddenPosts = await this.prisma.communityHiddenPost.findMany({
      where: {
        userId,
        status: 'active',
        deletedAt: null,
      },
      take: this.take(query.take),
      include: this.hiddenPostInclude(),
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(hiddenPosts.map((hiddenPost) => this.toHiddenPostView(hiddenPost)));
  }

  async getMyBlockedUsers(userId: string, query: CommunityQuery) {
    const blocks = await this.prisma.userBlock.findMany({
      where: {
        blockerUserId: userId,
        status: 'active',
        deletedAt: null,
      },
      take: this.take(query.take),
      include: this.userBlockInclude(),
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(blocks.map((block) => this.toUserBlockView(block)));
  }

  private postInclude() {
    return {
      author: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
              publicHandle: true,
              avatarAssetId: true,
              coverAssetId: true,
            },
          },
        },
      },
      artist: {
        select: {
          id: true,
          slug: true,
          displayName: true,
        },
      },
      assets: {
        include: {
          asset: {
            select: {
              id: true,
              assetType: true,
              mimeType: true,
              width: true,
              height: true,
              storageKey: true,
              metadata: true,
              createdAt: true,
            },
          },
        },
        orderBy: { sortOrder: 'asc' },
      },
    } satisfies Prisma.CommunityPostInclude;
  }

  private replyInclude() {
    return {
      author: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
              publicHandle: true,
              avatarAssetId: true,
              coverAssetId: true,
            },
          },
        },
      },
    } satisfies Prisma.CommunityReplyInclude;
  }

  private followInclude() {
    return {
      artist: {
        include: {
          publicProfile: true,
          artistAssets: {
            where: {
              usageType: { in: ['thumb', 'cover'] },
              asset: {
                visibility: 'public',
              },
            },
            include: {
              asset: {
                select: {
                  id: true,
                  storageKey: true,
                  metadata: true,
                },
              },
            },
            orderBy: [{ usageType: 'desc' }, { isPrimary: 'desc' }, { sortOrder: 'asc' }],
          },
        },
      },
    } satisfies Prisma.ArtistFollowInclude;
  }

  private userFollowInclude(direction: 'follower' | 'following') {
    const userSelect = {
      id: true,
      status: true,
      profile: {
        select: {
          displayName: true,
          publicHandle: true,
          avatarAssetId: true,
          coverAssetId: true,
        },
      },
    };

    return {
      [direction]: {
        select: userSelect,
      },
    } satisfies Prisma.UserFollowInclude;
  }

  private hiddenPostInclude() {
    return {
      post: {
        include: this.postInclude(),
      },
    } satisfies Prisma.CommunityHiddenPostInclude;
  }

  private async toPostView(post: any, viewerUserId?: string | null) {
    const metadata = this.metadataObject(post.metadata);
    const isAuthor = Boolean(viewerUserId && post.authorUserId === viewerUserId);
    const thread = this.threadProjection(post, metadata);
    const threadContinuation = this.threadContinuationProjection(metadata);
    const repost = await this.repostProjection(metadata, viewerUserId);
    const [viewerReaction, artistFollow, authorFollow] = viewerUserId
      ? await Promise.all([
          this.prisma.communityReaction.findUnique({
            where: {
              postId_userId_reactionType: {
                postId: post.id,
                userId: viewerUserId,
                reactionType: 'like',
              },
            },
            select: { id: true },
          }),
          post.artistId
            ? this.prisma.artistFollow.findUnique({
                where: {
                  userId_artistId: {
                    userId: viewerUserId,
                    artistId: post.artistId,
                  },
                },
                select: { status: true, deletedAt: true },
              })
            : Promise.resolve(null),
          !isAuthor
            ? this.prisma.userFollow.findUnique({
                where: {
                  followerUserId_followingUserId: {
                    followerUserId: viewerUserId,
                    followingUserId: post.authorUserId,
                  },
                },
                select: { status: true, deletedAt: true },
              })
            : Promise.resolve(null),
        ])
      : [null, null, null];
    const isFollowingArtist = Boolean(
      artistFollow?.status === 'active' && !artistFollow.deletedAt,
    );
    const isFollowingAuthor = Boolean(
      authorFollow?.status === 'active' && !authorFollow.deletedAt,
    );

    return {
      ...post,
      author: this.toPublicPostAuthor(post.author),
      linkPreview: metadata.linkPreview
        ? this.metadataObject(metadata.linkPreview)
        : null,
      thread,
      threadContinuation,
      repost,
      assets: (post.assets ?? []).map((link: any) => {
        const displayUrl = this.publicFeedAssetUrl(
          link.asset.id,
          link.asset.storageKey,
          'display',
        );
        const thumbnailUrl = this.publicFeedAssetUrl(
          link.asset.id,
          link.asset.storageKey,
          'thumbnail',
        );

        return {
          id: link.id,
          role: link.role,
          sortOrder: link.sortOrder,
          asset: {
            id: link.asset.id,
            assetType: link.asset.assetType,
            mimeType: link.asset.mimeType,
            width: link.asset.width,
            height: link.asset.height,
            url: displayUrl,
            displayUrl,
            thumbnailUrl,
            status: this.assetStatus(link.asset.metadata),
            createdAt: link.asset.createdAt,
          },
        };
      }),
      viewer: {
        userId: viewerUserId ?? null,
        hasLiked: Boolean(viewerReaction),
        isAuthor,
        isFollowingArtist,
        isFollowingAuthor,
        canFollowArtist: Boolean(viewerUserId && post.artistId && !isFollowingArtist),
        canUnfollowArtist: Boolean(viewerUserId && post.artistId && isFollowingArtist),
        canFollowAuthor: Boolean(viewerUserId && !isAuthor && !isFollowingAuthor),
        canUnfollowAuthor: Boolean(viewerUserId && !isAuthor && isFollowingAuthor),
        canEdit: isAuthor,
        canDelete: isAuthor,
      },
      permissions: {
        canEdit: isAuthor,
        canDelete: isAuthor,
        editScope: 'body_only_mvp',
        thread: {
          canEditItems: isAuthor,
          canDeleteItems: isAuthor,
          rootOnlyEngagement: true,
        },
        threadContinuation: {
          canCreate: isAuthor,
          relation: 'thread_continuation',
          commentRelation: false,
          replyRelation: false,
        },
      },
    };
  }

  private toPublicPostAuthor(author: any) {
    if (!author) {
      return null;
    }

    return {
      id: author.id,
      profile: author.profile
        ? {
            displayName: author.profile.displayName ?? null,
            publicHandle: author.profile.publicHandle ?? null,
            avatarAssetId: author.profile.avatarAssetId ?? null,
            coverAssetId: author.profile.coverAssetId ?? null,
          }
        : null,
    };
  }

  private threadProjection(post: any, metadata: Record<string, unknown>) {
    const thread = this.threadMetadataObject(metadata.thread);
    const rootItem = {
      id: post.id,
      postId: post.id,
      position: 1,
      role: 'root',
      body: typeof post.body === 'string' ? post.body : '',
      status: post.status,
      createdAt: this.isoString(post.createdAt),
      updatedAt: this.isoString(post.updatedAt),
      deletedAt: this.isoString(post.deletedAt),
    };
    const storedItems = thread
      ? this.mutableStoredThreadItems(thread)
          .filter((item) => item.status !== 'deleted' && !item.deletedAt)
          .sort((first, second) => first.position - second.position)
      : [];
    const items = [
      rootItem,
      ...storedItems.map((item) => ({
        id: item.id,
        postId: post.id,
        position: item.position,
        role: 'item',
        body: item.body,
        status: item.status,
        createdAt: this.isoString(item.createdAt),
        updatedAt: this.isoString(item.updatedAt),
        deletedAt: this.isoString(item.deletedAt),
      })),
    ];
    const itemCount = items.length;

    return {
      isThread: Boolean(thread && itemCount > 1),
      rootPostId: post.id,
      itemCount,
      threadCount: itemCount,
      maxItems: FEED_THREAD_MAX_ITEMS,
      previewText: this.threadPreviewText(items.map((item) => item.body)),
      items,
      autoSplit: false,
      rootOnlyEngagement: true,
      engagementTarget: 'root',
      assetTarget: 'root',
      likesTarget: 'root',
      commentsTarget: 'root',
      imagesTarget: 'root',
      countIsolation: {
        threadCountSource: 'manual_thread_items_only',
        continuationCountIncluded: false,
        repostCountIncluded: false,
        shareCountIncluded: false,
        replyCountIncluded: false,
      },
    };
  }

  private threadContinuationProjection(metadata: Record<string, unknown>) {
    const relation = this.metadataObject(metadata.threadContinuation);
    const rootPostId = this.stringFromUnknown(relation.rootPostId);

    if (!rootPostId) {
      return {
        isContinuation: false,
        relation: null,
      };
    }

    return {
      isContinuation: true,
      type: 'thread_continuation',
      relation: 'thread_continuation',
      actionKey: 'feed_thread_continue',
      stateKey: 'thread_continuation',
      rootPostId,
      parentPostId: this.stringFromUnknown(relation.parentPostId) ?? rootPostId,
      source: 'existing_post',
      displayPlacement: 'under_root_post',
      sortKey: this.stringFromUnknown(relation.sortKey) ?? null,
      commentRelation: false,
      replyRelation: false,
      autoSplit: false,
    };
  }

  private async repostProjection(
    metadata: Record<string, unknown>,
    viewerUserId?: string | null,
  ) {
    const relation = this.metadataObject(metadata.repost);
    const originalPostId = this.stringFromUnknown(relation.originalPostId);

    if (!originalPostId) {
      return null;
    }

    const blockedUserIds = viewerUserId
      ? await this.getBlockedRelationshipUserIds(viewerUserId)
      : [];
    const originalPost = await this.prisma.communityPost.findFirst({
      where: {
        id: originalPostId,
        status: 'published',
        visibility: 'public',
        deletedAt: null,
        authorUserId: blockedUserIds.length ? { notIn: blockedUserIds } : undefined,
        hiddenByUsers: viewerUserId
          ? {
              none: {
                userId: viewerUserId,
                status: 'active',
                deletedAt: null,
              },
            }
          : undefined,
      },
      select: {
        id: true,
        authorUserId: true,
        artistId: true,
        postType: true,
        body: true,
        publishedAt: true,
        author: {
          select: {
            id: true,
            profile: {
              select: {
                displayName: true,
                publicHandle: true,
                avatarAssetId: true,
              },
            },
          },
        },
        artist: {
          select: {
            id: true,
            slug: true,
            displayName: true,
          },
        },
      },
    });

    const quoteBody =
      this.stringFromUnknown(relation.quoteBody) ??
      this.stringFromUnknown(relation.quoteText) ??
      null;
    const type = this.repostRelationType(this.stringFromUnknown(relation.type), quoteBody);

    return {
      isRepost: true,
      type,
      relation: 'repost',
      hasQuote: type === 'quote_repost',
      parentPostId: null,
      threadRootPostId: null,
      commentRelation: false,
      replyRelation: false,
      threadRelation: false,
      actionKey: type === 'quote_repost' ? 'feed_quote_repost' : 'feed_repost',
      stateKey: type,
      originalPostId,
      originalAuthorUserId:
        this.stringFromUnknown(relation.originalAuthorUserId) ??
        originalPost?.authorUserId ??
        null,
      originalArtistId:
        this.stringFromUnknown(relation.originalArtistId) ??
        originalPost?.artistId ??
        null,
      quoteBody,
      originalState: originalPost ? 'visible' : 'unavailable',
      tombstone: !originalPost,
      unavailableReason: originalPost ? null : 'viewer_restricted_or_unavailable',
      originalPost: originalPost
        ? {
            id: originalPost.id,
            authorUserId: originalPost.authorUserId,
            artistId: originalPost.artistId,
            postType: originalPost.postType,
            body: originalPost.body,
            publishedAt: originalPost.publishedAt,
            author: originalPost.author,
            artist: originalPost.artist,
          }
        : null,
      policy: this.feedRepostPolicy(),
    };
  }

  private threadPreviewText(bodies: string[]) {
    const preview = bodies
      .map((body) => body.trim())
      .filter(Boolean)
      .join('\n')
      .trim();

    return preview.length > FEED_THREAD_PREVIEW_MAX_CHARS
      ? preview.slice(0, FEED_THREAD_PREVIEW_MAX_CHARS)
      : preview;
  }

  private publicFeedAssetUrl(assetId: string, storageKey: string, variant = 'display') {
    if (/^https?:\/\//i.test(storageKey)) {
      return storageKey;
    }

    const configuredBaseUrl =
      this.configService.get<string>('API_PUBLIC_BASE_URL') ??
      this.configService.get<string>('BACKEND_PUBLIC_BASE_URL');
    const baseUrl = configuredBaseUrl ?? 'https://api.lumina-stage.com';

    return `${baseUrl.replace(/\/+$/, '')}/api/v1/assets/public/${assetId}/${variant}`;
  }

  private toReplyView(reply: any, viewerUserId?: string | null) {
    const isAuthor = Boolean(viewerUserId && reply.authorUserId === viewerUserId);

    return {
      ...reply,
      viewer: {
        userId: viewerUserId ?? null,
        isAuthor,
        canDelete: isAuthor,
      },
      permissions: {
        canDelete: isAuthor,
      },
    };
  }

  private async toHiddenPostView(hiddenPost: any) {
    return {
      ...hiddenPost,
      post: hiddenPost.post ? await this.toPostView(hiddenPost.post) : null,
    };
  }

  private async toArtistFollowView(follow: any) {
    const artist = follow.artist;
    const visibleAssets = (artist.artistAssets ?? []).filter((artistAsset: any) =>
      this.isPublicReadyAsset(artistAsset.asset.metadata),
    );
    const thumb =
      visibleAssets.find((artistAsset: any) => artistAsset.usageType === 'thumb') ??
      visibleAssets.find((artistAsset: any) => artistAsset.usageType === 'cover') ??
      null;
    const latestFeed = await this.prisma.communityPost.findFirst({
      where: {
        artistId: artist.id,
        status: 'published',
        visibility: 'public',
        deletedAt: null,
      },
      select: { publishedAt: true },
      orderBy: { publishedAt: 'desc' },
    });
    const metadata = this.metadataObject(artist.publicProfile?.publicMetadata);
    const profileFacts = this.metadataObject(metadata.profileFacts);
    const characterType =
      this.stringFromUnknown(profileFacts.characterType) ??
      this.stringFromUnknown(profileFacts.position) ??
      null;

    return {
      id: artist.id,
      followId: follow.id,
      slug: artist.slug,
      displayName: artist.displayName,
      name: artist.displayName,
      thumbnailUrl: thumb
        ? buildPublicAssetUrl(this.configService, thumb.asset.storageKey)
        : null,
      thumbUrl: thumb ? buildPublicAssetUrl(this.configService, thumb.asset.storageKey) : null,
      status: artist.status,
      type: characterType,
      followedAt: follow.createdAt,
      latestFeedAt: latestFeed?.publishedAt ?? null,
      isFollowing: true,
    };
  }

  private async toArtistFollowActionView(follow: any, isFollowing: boolean) {
    const artist = await this.toArtistFollowView(follow);

    return {
      ...follow,
      follow,
      artist,
      stats: await this.artistFollowStats(artist.id),
      viewer: {
        isAuthenticated: true,
        isFollowing,
        canFollow: !isFollowing,
        canUnfollow: isFollowing,
      },
      policy: {
        followTarget: 'artist_id',
        followEndpoint: 'POST /api/v1/artists/:artistId/follow',
        unfollowEndpoint: 'DELETE /api/v1/artists/:artistId/follow',
      },
    };
  }

  private async artistFollowStats(artistId: string) {
    const followerCount = await this.prisma.artistFollow.count({
      where: {
        artistId,
        status: 'active',
        deletedAt: null,
      },
    });

    return { followerCount };
  }

  private userBlockInclude() {
    return {
      blocked: {
        select: {
          id: true,
          status: true,
          profile: {
            select: {
              displayName: true,
              publicHandle: true,
              avatarAssetId: true,
              coverAssetId: true,
            },
          },
        },
      },
    } satisfies Prisma.UserBlockInclude;
  }

  private async assertActiveUser(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        status: 'active',
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!user) {
      throw this.socialNotFound(
        'USER_NOT_FOUND',
        'social.user.notFound',
        'User not found',
      );
    }
  }

  private async assertNoActiveUserBlock(firstUserId: string, secondUserId: string) {
    const block = await this.prisma.userBlock.findFirst({
      where: {
        status: 'active',
        deletedAt: null,
        OR: [
          { blockerUserId: firstUserId, blockedUserId: secondUserId },
          { blockerUserId: secondUserId, blockedUserId: firstUserId },
        ],
      },
      select: { id: true },
    });

    if (block) {
      throw this.socialForbidden(
        'USER_FOLLOW_BLOCKED',
        'social.follow.blocked',
        'User follow is blocked',
      );
    }
  }

  private async toUserFollowView(
    follow: any,
    direction: 'follower' | 'following',
    viewerUserId?: string,
    includeViewer = false,
  ) {
    const user = follow[direction];
    const avatarAsset = user.profile?.avatarAssetId
      ? await this.prisma.asset.findUnique({
          where: { id: user.profile.avatarAssetId },
          select: { id: true, storageKey: true },
        })
      : null;

    const view = {
      id: follow.id,
      status: follow.status,
      followedAt: follow.createdAt,
      updatedAt: follow.updatedAt,
      user: {
        id: user.id,
        displayName:
          user.profile?.displayName ?? user.profile?.publicHandle ?? 'Lumina User',
        publicHandle: user.profile?.publicHandle ?? null,
        avatarUrl: avatarAsset
          ? buildPublicAssetUrl(this.configService, avatarAsset.storageKey)
          : null,
      },
    };

    if (!includeViewer) {
      return view;
    }

    return {
      ...view,
      viewer: await this.userProfileViewerState(user.id, viewerUserId),
    };
  }

  private userFollowListResponse(
    items: Array<Awaited<ReturnType<CommunityService['toUserFollowView']>>>,
    follows: Array<{ id: string }>,
    total: number,
    take: number,
  ) {
    return {
      items,
      users: items,
      count: items.length,
      total,
      nextCursor: follows.length === take ? follows[follows.length - 1]?.id ?? null : null,
      policy: {
        hiddenUserRule:
          'Only active non-deleted users are returned; suspended, deleted, or inactive users are hidden from follow cards.',
      },
    };
  }

  private async toUserFollowActionView(
    follow: any,
    followerUserId: string,
    followingUserId: string,
    isFollowing: boolean,
  ) {
    return {
      ...follow,
      follow,
      user: await this.publicUserSummary(followingUserId),
      stats: await this.userFollowStats(followingUserId),
      viewer: {
        isAuthenticated: true,
        isFollowing,
        canFollow: followerUserId !== followingUserId && !isFollowing,
        canUnfollow: followerUserId !== followingUserId && isFollowing,
      },
      policy: {
        followTarget: 'user_id',
        followEndpoint: 'POST /api/v1/users/:userId/follow',
        unfollowEndpoint: 'DELETE /api/v1/users/:userId/follow',
      },
    };
  }

  private async publicUserSummary(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        status: 'active',
        deletedAt: null,
      },
      select: {
        id: true,
        profile: {
          select: {
            displayName: true,
            publicHandle: true,
            avatarAssetId: true,
            coverAssetId: true,
          },
        },
      },
    });

    if (!user) {
      throw this.socialNotFound(
        'USER_NOT_FOUND',
        'social.user.notFound',
        'User not found',
      );
    }

    return this.toCompactUserView(user);
  }

  private async userFollowStats(userId: string) {
    const [followerCount, followingCount] = await Promise.all([
      this.prisma.userFollow.count({
        where: {
          followingUserId: userId,
          status: 'active',
          deletedAt: null,
        },
      }),
      this.prisma.userFollow.count({
        where: {
          followerUserId: userId,
          status: 'active',
          deletedAt: null,
        },
      }),
    ]);

    return { followerCount, followingCount };
  }

  private async toUserBlockView(block: any) {
    return {
      id: block.id,
      status: block.status,
      reason: block.reason ?? null,
      blockedAt: block.createdAt,
      updatedAt: block.updatedAt,
      user: await this.toCompactUserView(block.blocked),
    };
  }

  private async toCompactUserView(user: any) {
    const avatarAsset = user.profile?.avatarAssetId
      ? await this.prisma.asset.findUnique({
          where: { id: user.profile.avatarAssetId },
          select: { id: true, storageKey: true },
        })
      : null;
    const coverAsset = user.profile?.coverAssetId
      ? await this.prisma.asset.findUnique({
          where: { id: user.profile.coverAssetId },
          select: { id: true, storageKey: true },
        })
      : null;

    return {
      id: user.id,
      displayName:
        user.profile?.displayName ?? user.profile?.publicHandle ?? 'Lumina User',
      publicHandle: user.profile?.publicHandle ?? null,
      avatarUrl: avatarAsset
        ? buildPublicAssetUrl(this.configService, avatarAsset.storageKey)
        : null,
      coverImageUrl: coverAsset
        ? buildPublicAssetUrl(this.configService, coverAsset.storageKey)
        : null,
    };
  }

  private async resolveActiveUserIdByHandle(publicHandle: string) {
    const normalizedHandle = this.normalizePublicHandle(publicHandle);
    const user = await this.prisma.user.findFirst({
      where: {
        status: 'active',
        deletedAt: null,
        profile: { is: { publicHandle: normalizedHandle } },
      },
      select: { id: true },
    });

    if (!user) {
      throw this.socialNotFound(
        'USER_NOT_FOUND',
        'social.user.notFound',
        'User not found',
      );
    }

    return user.id;
  }

  private normalizePublicHandle(publicHandle: string) {
    const normalizedHandle = publicHandle.trim();

    if (!normalizedHandle || normalizedHandle.length > 80) {
      throw this.socialBadRequest(
        'INVALID_PUBLIC_HANDLE',
        'social.profile.invalidHandle',
        'publicHandle is invalid',
      );
    }

    return normalizedHandle;
  }

  private async getBlockedRelationshipUserIds(userId: string) {
    const rows = await this.prisma.userBlock.findMany({
      where: {
        status: 'active',
        deletedAt: null,
        OR: [{ blockerUserId: userId }, { blockedUserId: userId }],
      },
      select: {
        blockerUserId: true,
        blockedUserId: true,
      },
    });

    return [
      ...new Set(
        rows.map((row) =>
          row.blockerUserId === userId ? row.blockedUserId : row.blockerUserId,
        ),
      ),
    ];
  }

  private async getFollowingArtistIds(userId: string) {
    const rows = await this.prisma.artistFollow.findMany({
      where: {
        userId,
        status: 'active',
        deletedAt: null,
      },
      select: {
        artistId: true,
      },
    });

    return rows.map((row) => row.artistId);
  }

  private async getFollowingUserIds(userId: string) {
    const rows = await this.prisma.userFollow.findMany({
      where: {
        followerUserId: userId,
        status: 'active',
        deletedAt: null,
      },
      select: {
        followingUserId: true,
      },
    });

    return rows.map((row) => row.followingUserId);
  }

  private async searchQuerySuggestions(
    normalizedKeyword: string | null,
    language: string,
    since: Date,
    take: number,
    blockedTerms: FeedSearchBlockedTermScope[],
  ) {
    const where: Prisma.FeedSearchEventWhereInput = this.clean({
      createdAt: { gte: since },
      language: language === 'all' ? undefined : language,
      normalizedKeyword: normalizedKeyword
        ? { contains: normalizedKeyword, mode: 'insensitive' }
        : undefined,
    });
    const grouped = await this.prisma.feedSearchEvent.groupBy({
      by: ['normalizedKeyword', 'searchType', 'language'],
      where,
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: [{ _count: { normalizedKeyword: 'desc' } }, { _max: { createdAt: 'desc' } }],
      take: Math.min(take * 3, 100),
    });
    const visibleGrouped = grouped
      .filter(
        (item) =>
          !this.isFeedSearchBlocked(
            blockedTerms,
            item.normalizedKeyword,
            item.searchType,
            item.language,
          ),
      )
      .slice(0, take);
    const latestEvents = visibleGrouped.length
      ? await this.prisma.feedSearchEvent.findMany({
          where: {
            OR: visibleGrouped.map((item) => ({
              normalizedKeyword: item.normalizedKeyword,
              searchType: item.searchType,
              language: item.language,
            })),
          },
          orderBy: { createdAt: 'desc' },
          distinct: ['normalizedKeyword', 'searchType', 'language'],
        })
      : [];
    const latestEventMap = new Map(
      latestEvents.map((event) => [
        this.trendingKey(event.normalizedKeyword, event.searchType, event.language),
        event,
      ]),
    );

    return visibleGrouped.map((item) => {
      const latestEvent = latestEventMap.get(
        this.trendingKey(item.normalizedKeyword, item.searchType, item.language),
      );
      const keyword = latestEvent?.keyword ?? item.normalizedKeyword;

      return {
        type: 'query',
        keyword,
        normalizedKeyword: item.normalizedKeyword,
        searchType: item.searchType,
        language: item.language,
        searchCount: item._count._all,
        lastSearchedAt: item._max.createdAt,
        searchUrl: `/api/v1/lumina-feed/search?q=${encodeURIComponent(
          keyword,
        )}&type=${item.searchType}&language=${item.language}`,
      };
    });
  }

  private async hashtagSuggestions(
    normalizedKeyword: string | null,
    language: string,
    since: Date,
    take: number,
    blockedTerms: FeedSearchBlockedTermScope[],
  ) {
    const posts = await this.prisma.communityPost.findMany({
      where: {
        status: 'published',
        visibility: 'public',
        deletedAt: null,
        publishedAt: { gte: since },
        body: { contains: '#' },
      },
      take: 500,
      select: { id: true, body: true, publishedAt: true },
      orderBy: { publishedAt: 'desc' },
    });
    const buckets = new Map<
      string,
      {
        keyword: string;
        normalizedKeyword: string;
        language: string;
        postIds: Set<string>;
        latestPublishedAt: Date;
      }
    >();

    for (const post of posts) {
      for (const hashtag of this.extractHashtags(post.body)) {
        const detectedLanguage = this.detectSearchLanguage(hashtag) ?? 'unknown';
        const normalizedHashtag = this.normalizeSearchKeyword(hashtag, 'hashtag');

        if (language !== 'all' && detectedLanguage !== language) {
          continue;
        }

        if (
          normalizedKeyword &&
          !normalizedHashtag.includes(normalizedKeyword.replace(/^#/, ''))
        ) {
          continue;
        }

        if (
          this.isFeedSearchBlocked(
            blockedTerms,
            normalizedHashtag,
            'hashtag',
            detectedLanguage,
          )
        ) {
          continue;
        }

        const bucketKey = this.trendingKey(normalizedHashtag, 'hashtag', detectedLanguage);
        const existing = buckets.get(bucketKey);

        if (existing) {
          existing.postIds.add(post.id);
          if (post.publishedAt > existing.latestPublishedAt) {
            existing.latestPublishedAt = post.publishedAt;
            existing.keyword = `#${hashtag}`;
          }
          continue;
        }

        buckets.set(bucketKey, {
          keyword: `#${hashtag}`,
          normalizedKeyword: normalizedHashtag,
          language: detectedLanguage,
          postIds: new Set([post.id]),
          latestPublishedAt: post.publishedAt,
        });
      }
    }

    return [...buckets.values()]
      .sort((left, right) => {
        const countDiff = right.postIds.size - left.postIds.size;
        return countDiff || right.latestPublishedAt.getTime() - left.latestPublishedAt.getTime();
      })
      .slice(0, take)
      .map((item) => ({
        type: 'hashtag',
        keyword: item.keyword,
        normalizedKeyword: item.normalizedKeyword,
        language: item.language,
        postCount: item.postIds.size,
        latestPublishedAt: item.latestPublishedAt,
        searchUrl: `/api/v1/lumina-feed/search?q=${encodeURIComponent(
          item.keyword,
        )}&type=hashtag&language=${item.language}`,
      }));
  }

  private async artistSearchSuggestions(normalizedKeyword: string | null, take: number) {
    if (!normalizedKeyword) {
      return [];
    }

    const artists = await this.prisma.artist.findMany({
      where: {
        status: 'active',
        OR: [
          { displayName: { contains: normalizedKeyword, mode: 'insensitive' } },
          { slug: { contains: normalizedKeyword, mode: 'insensitive' } },
        ],
      },
      take,
      select: {
        id: true,
        slug: true,
        displayName: true,
      },
      orderBy: { displayName: 'asc' },
    });

    return artists.map((artist) => ({
      type: 'artist',
      id: artist.id,
      keyword: artist.displayName,
      slug: artist.slug,
      displayName: artist.displayName,
      searchUrl: `/api/v1/lumina-feed?artistSlug=${encodeURIComponent(artist.slug)}`,
    }));
  }

  private async userSearchSuggestions(normalizedKeyword: string | null, take: number) {
    if (!normalizedKeyword) {
      return [];
    }

    const users = await this.prisma.user.findMany({
      where: {
        status: 'active',
        deletedAt: null,
        profile: {
          is: {
            OR: [
              { displayName: { contains: normalizedKeyword, mode: 'insensitive' } },
              { publicHandle: { contains: normalizedKeyword, mode: 'insensitive' } },
            ],
          },
        },
      },
      take,
      select: {
        id: true,
        profile: {
          select: {
            displayName: true,
            publicHandle: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((user) => ({
      type: 'user',
      id: user.id,
      keyword: user.profile?.displayName ?? user.profile?.publicHandle ?? 'Lumina User',
      displayName: user.profile?.displayName ?? null,
      publicHandle: user.profile?.publicHandle ?? null,
      profileUrl: user.profile?.publicHandle
        ? `/api/v1/users/handle/${encodeURIComponent(user.profile.publicHandle)}/profile`
        : `/api/v1/users/${user.id}/profile`,
    }));
  }

  private searchQuery(value: unknown) {
    const text = this.optionalStringValue(value);

    if (!text) {
      throw new BadRequestException('q must be a non-empty search keyword');
    }

    if (text.length > 80) {
      throw new BadRequestException('q must be shorter than or equal to 80 characters');
    }

    return text;
  }

  private searchType(value: unknown, keyword: string) {
    const explicit = this.optionalStringValue(value);

    if (explicit) {
      if (!SEARCH_TYPES.has(explicit)) {
        throw new BadRequestException('type must be text or hashtag');
      }

      return explicit;
    }

    return keyword.trim().startsWith('#') ? 'hashtag' : 'text';
  }

  private optionalSearchType(value: unknown) {
    const explicit = this.optionalStringValue(value);

    if (!explicit || explicit === 'all') {
      return undefined;
    }

    if (!SEARCH_TYPES.has(explicit)) {
      throw new BadRequestException('type must be all, text, or hashtag');
    }

    return explicit;
  }

  private normalizeSearchKeyword(keyword: string, searchType: string) {
    const normalized = keyword
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^#+/, searchType === 'hashtag' ? '' : '#')
      .toLocaleLowerCase();

    if (!normalized) {
      throw new BadRequestException('q must be a non-empty search keyword');
    }

    return normalized.slice(0, 80);
  }

  private searchLanguage(value: unknown, keyword: string) {
    const mapped = this.mapLocaleToSearchLanguage(this.optionalStringValue(value));

    if (mapped && mapped !== 'all') {
      return mapped;
    }

    const detected = this.detectSearchLanguage(keyword);
    return detected ?? 'unknown';
  }

  private trendingLanguage(value: unknown) {
    const mapped = this.mapLocaleToSearchLanguage(this.optionalStringValue(value)) ?? 'all';

    if (!TRENDING_LANGUAGE_FILTERS.has(mapped)) {
      throw new BadRequestException('language must be all, ko, ja, en, zh, or unknown');
    }

    return mapped;
  }

  private mapLocaleToSearchLanguage(value?: string) {
    if (!value) {
      return undefined;
    }

    const normalized = value.trim().toLowerCase();

    if (normalized === 'all') {
      return 'all';
    }

    if (normalized.startsWith('ko')) {
      return 'ko';
    }

    if (normalized.startsWith('ja') || normalized.startsWith('jp')) {
      return 'ja';
    }

    if (normalized.startsWith('en')) {
      return 'en';
    }

    if (normalized.startsWith('zh') || normalized.startsWith('cn')) {
      return 'zh';
    }

    if (SEARCH_LANGUAGES.has(normalized)) {
      return normalized;
    }

    throw new BadRequestException('language must be ko, ja, en, zh, unknown, or all');
  }

  private detectSearchLanguage(keyword: string) {
    if (/[가-힣]/.test(keyword)) {
      return 'ko';
    }

    if (/[\u3040-\u30ff]/.test(keyword)) {
      return 'ja';
    }

    if (/[\u4e00-\u9fff]/.test(keyword)) {
      return 'zh';
    }

    if (/[a-z]/i.test(keyword)) {
      return 'en';
    }

    return null;
  }

  private extractHashtags(body: string) {
    const matches = body.matchAll(/#([\p{L}\p{N}_][\p{L}\p{N}_-]{0,49})/gu);

    return [...matches]
      .map((match) => match[1]?.trim())
      .filter((value): value is string => Boolean(value));
  }

  private feedSearchWhere(
    normalizedKeyword: string,
    searchType: string,
  ): Prisma.CommunityPostWhereInput {
    const publicWhere = {
      status: 'published',
      visibility: 'public',
      deletedAt: null,
      ...this.publicFeedCleanupGuardWhere(),
    };

    if (searchType === 'hashtag') {
      return {
        ...publicWhere,
        body: { contains: `#${normalizedKeyword}`, mode: 'insensitive' },
      };
    }

    return {
      ...publicWhere,
      OR: [
        { body: { contains: normalizedKeyword, mode: 'insensitive' } },
        { artist: { displayName: { contains: normalizedKeyword, mode: 'insensitive' } } },
        { artist: { slug: { contains: normalizedKeyword, mode: 'insensitive' } } },
        {
          author: {
            profile: {
              is: {
                displayName: { contains: normalizedKeyword, mode: 'insensitive' },
              },
            },
          },
        },
        {
          author: {
            profile: {
              is: {
                publicHandle: { contains: normalizedKeyword, mode: 'insensitive' },
              },
            },
          },
        },
      ],
    };
  }

  private async recordFeedSearchEvent(input: {
    keyword: string;
    normalizedKeyword: string;
    searchType: string;
    language: string;
    resultCount: number;
    userId?: string;
    visitorHash?: string | null;
    metadata: Record<string, unknown>;
  }) {
    try {
      const visitorHash = input.visitorHash
        ? this.hashVisitor(input.visitorHash)
        : null;
      const dedupeSince = new Date(Date.now() - SEARCH_EVENT_DEDUPE_WINDOW_MS);
      const duplicateMatchers = [
        ...(input.userId ? [{ userId: input.userId }] : []),
        ...(visitorHash ? [{ visitorHash }] : []),
      ];
      const recentDuplicate = duplicateMatchers.length
        ? await this.prisma.feedSearchEvent.findFirst({
            where: {
              normalizedKeyword: input.normalizedKeyword,
              searchType: input.searchType,
              language: input.language,
              createdAt: { gte: dedupeSince },
              OR: duplicateMatchers,
            },
            select: { id: true },
          })
        : null;

      if (recentDuplicate) {
        return;
      }

      await this.prisma.feedSearchEvent.create({
        data: {
          userId: input.userId ?? null,
          visitorHash,
          keyword: input.keyword,
          normalizedKeyword: input.normalizedKeyword,
          searchType: input.searchType,
          language: input.language,
          resultCount: input.resultCount,
          metadata: this.toJson(input.metadata),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to record feed search event: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private hashVisitor(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private trendingWindow(value: unknown) {
    const key = this.optionalStringValue(value) ?? '1h';
    const windows: Record<string, number> = {
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
    };
    const ms = windows[key];

    if (!ms) {
      throw new BadRequestException('window must be 15m, 1h, 6h, 24h, or 7d');
    }

    return { key, ms };
  }

  private trendingKey(keyword: string, searchType: string, language: string) {
    return `${language}:${searchType}:${keyword}`;
  }

  private feedSearchPolicy() {
    return {
      supportedLanguages: ['ko', 'ja', 'en', 'zh'],
      trendingLanguageModes: ['all', 'ko', 'ja', 'en', 'zh', 'unknown'],
      searchTypes: ['text', 'hashtag'],
      defaultTrendingWindow: '1h',
      trendingWindows: ['15m', '1h', '6h', '24h', '7d'],
      dedupeWindowMinutes: 10,
      blockedTermFiltering: true,
      hashtags: {
        useHashPrefixInQuery: true,
        languageCanBeUnknown: true,
        allLanguageRankingRecommendedForEarlyTraffic: true,
      },
    };
  }

  private async getActiveFeedSearchBlockedTerms(language: string) {
    return this.prisma.feedSearchBlockedTerm.findMany({
      where: {
        status: 'active',
        language: language === 'all' ? undefined : { in: ['all', language] },
      },
      select: {
        normalizedKeyword: true,
        searchType: true,
        language: true,
      },
    });
  }

  private isFeedSearchBlocked(
    blockedTerms: FeedSearchBlockedTermScope[],
    normalizedKeyword: string,
    searchType: string,
    language: string,
  ) {
    return blockedTerms.some(
      (term) =>
        term.normalizedKeyword === normalizedKeyword &&
        (term.searchType === 'all' || term.searchType === searchType) &&
        (term.language === 'all' || term.language === language),
    );
  }

  private async findVisiblePost(postId: string) {
    if (!UUID_PATTERN.test(postId)) {
      throw new BadRequestException('postId must be a UUID');
    }

    const post = await this.prisma.communityPost.findFirst({
      where: {
        id: postId,
        status: 'published',
        deletedAt: null,
      },
      select: {
        id: true,
        authorUserId: true,
        artistId: true,
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return post;
  }

  private async findPublicPost(postId: string) {
    if (!UUID_PATTERN.test(postId)) {
      throw new BadRequestException('postId must be a UUID');
    }

    const post = await this.prisma.communityPost.findFirst({
      where: {
        id: postId,
        status: 'published',
        visibility: 'public',
        deletedAt: null,
        ...this.publicFeedCleanupGuardWhere(),
      },
      select: {
        id: true,
        authorUserId: true,
        artistId: true,
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return post;
  }

  private async findPublicPostWithInclude(postId: string) {
    if (!UUID_PATTERN.test(postId)) {
      throw new BadRequestException('postId must be a UUID');
    }

    const post = await this.prisma.communityPost.findFirst({
      where: {
        id: postId,
        status: 'published',
        visibility: 'public',
        deletedAt: null,
        ...this.publicFeedCleanupGuardWhere(),
      },
      include: this.postInclude(),
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return post;
  }

  private async findVisiblePostWithInclude(postId: string) {
    if (!UUID_PATTERN.test(postId)) {
      throw new BadRequestException('postId must be a UUID');
    }

    const post = await this.prisma.communityPost.findFirst({
      where: {
        id: postId,
        status: 'published',
        deletedAt: null,
      },
      include: this.postInclude(),
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return post;
  }

  private async getOwnedThreadRoot(userId: string, postId: string) {
    if (!UUID_PATTERN.test(postId)) {
      throw new BadRequestException('postId must be a UUID');
    }

    const post = await this.prisma.communityPost.findFirst({
      where: {
        id: postId,
        deletedAt: null,
      },
      select: {
        id: true,
        authorUserId: true,
        status: true,
        metadata: true,
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.status !== 'published') {
      throw new BadRequestException('Only published posts can be edited');
    }

    if (post.authorUserId !== userId) {
      throw new ForbiddenException('Post author access is required');
    }

    return post;
  }

  private async createNotificationSafely(input: {
    userId: string;
    type: string;
    title: string;
    body?: string | null;
    actorUserId?: string | null;
    artistId?: string | null;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    try {
      await this.notificationsService.createNotification(input);
    } catch (error) {
      this.logger.warn(
        `Failed to create notification ${input.type} for user ${input.userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private truncate(value: string, maxLength: number) {
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
  }

  private async resolveOptionalArtistId(input: CommunityBody) {
    const artistId = this.optionalStringValue(input.artistId);
    const artistSlug = this.optionalStringValue(input.artistSlug);

    if (!artistId && !artistSlug) {
      return undefined;
    }

    const artist = await this.prisma.artist.findFirst({
      where: {
        status: 'active',
        ...(artistId
          ? UUID_PATTERN.test(artistId)
            ? { id: artistId }
            : { slug: artistId }
          : { slug: artistSlug }),
      },
      select: { id: true },
    });

    if (!artist) {
      throw new NotFoundException('Artist not found');
    }

    return artist.id;
  }

  private async resolvePostAssetIds(input: CommunityBody) {
    const value = input.assetIds;

    if (value === undefined || value === null) {
      return [];
    }

    if (!Array.isArray(value)) {
      throw new BadRequestException('assetIds must be an array');
    }

    if (value.length > FEED_POST_MAX_IMAGES) {
      throw new BadRequestException(
        `A feed post can attach up to ${FEED_POST_MAX_IMAGES} images`,
      );
    }

    const assetIds = value.map((entry) => {
      if (typeof entry !== 'string' || !entry.trim()) {
        throw new BadRequestException('assetIds must contain UUID strings');
      }

      const assetId = entry.trim();

      if (!UUID_PATTERN.test(assetId)) {
        throw new BadRequestException('assetIds must contain UUID strings');
      }

      return assetId;
    });

    const uniqueAssetIds = Array.from(new Set(assetIds));

    if (uniqueAssetIds.length !== assetIds.length) {
      throw new BadRequestException('assetIds must not contain duplicates');
    }

    if (!uniqueAssetIds.length) {
      return [];
    }

    const assets = await this.prisma.asset.findMany({
      where: {
        id: { in: uniqueAssetIds },
        visibility: 'public',
      },
      select: {
        id: true,
        assetType: true,
        mimeType: true,
        metadata: true,
      },
    });
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

    for (const assetId of uniqueAssetIds) {
      const asset = assetsById.get(assetId);

      if (!asset) {
        throw new BadRequestException('All feed assets must be public images');
      }

      if (asset.assetType !== 'image' || !asset.mimeType.startsWith('image/')) {
        throw new BadRequestException(
          'Lumina Feed supports image attachments only. Use Shortform for videos.',
        );
      }

      const metadata = this.metadataObject(asset.metadata);
      const uploadIntent = this.metadataObject(metadata.uploadIntent);
      const lifecycle = this.metadataObject(metadata.lifecycle);

      if (uploadIntent.status && uploadIntent.status !== 'uploaded') {
        throw new BadRequestException('Asset upload must be confirmed before linking');
      }

      if (lifecycle.status === 'archived') {
        throw new BadRequestException('Archived assets cannot be linked');
      }
    }

    return uniqueAssetIds;
  }

  private buildPostMetadata(input: CommunityBody) {
    const metadata = { ...(this.object(input, 'metadata') ?? {}) };
    delete metadata.linkPreview;
    delete metadata.externalUrl;
    delete metadata.feedPolicy;
    delete metadata.thread;

    const externalUrl = this.optionalString(input.externalUrl);

    if (!externalUrl) {
      return metadata;
    }

    const linkPreview = this.buildLinkPreview(externalUrl);

    return {
      ...metadata,
      externalUrl: linkPreview.canonicalUrl,
      linkPreview,
      feedPolicy: {
        externalLink: 'metadata_only',
        remoteFetch: 'disabled_for_mvp',
        videoUpload: 'not_allowed_in_feed_mvp',
      },
    };
  }

  private relationInputMetadata(input: CommunityBody) {
    const metadata = { ...(this.object(input, 'metadata') ?? {}) };
    delete metadata.linkPreview;
    delete metadata.externalUrl;
    delete metadata.feedPolicy;
    delete metadata.thread;
    delete metadata.threadContinuation;
    delete metadata.repost;
    delete metadata.share;

    return metadata;
  }

  private buildLinkPreview(rawUrl: string) {
    const trimmed = rawUrl.trim();

    if (trimmed.length > FEED_EXTERNAL_URL_MAX_LENGTH) {
      throw new BadRequestException(
        `url must be ${FEED_EXTERNAL_URL_MAX_LENGTH} characters or fewer`,
      );
    }

    let parsed: URL;

    try {
      parsed = new URL(trimmed);
    } catch {
      throw new BadRequestException('url must be a valid HTTPS URL');
    }

    if (parsed.protocol !== 'https:') {
      throw new BadRequestException('url must use https');
    }

    if (parsed.username || parsed.password) {
      throw new BadRequestException('url must not include credentials');
    }

    if (this.isBlockedExternalHostname(parsed.hostname)) {
      throw new BadRequestException('url hostname is not allowed');
    }

    parsed.hash = '';
    const canonicalUrl = parsed.toString();
    const hostname = parsed.hostname.toLowerCase();
    const siteName = hostname.replace(/^www\./, '');

    return {
      source: 'metadata_only',
      url: canonicalUrl,
      canonicalUrl,
      hostname,
      siteName,
      title: null,
      description: null,
      imageUrl: null,
      fetchStatus: 'not_fetched_mvp',
      remoteFetch: 'disabled_for_mvp',
    };
  }

  private feedExternalLinkPolicy() {
    return {
      externalLinks: 'enabled',
      acceptedUrlSchemes: ['https'],
      maxUrlLength: FEED_EXTERNAL_URL_MAX_LENGTH,
      storedFields: ['canonicalUrl', 'hostname', 'siteName'],
      bodyCopy: 'not_allowed',
      remoteFetch: 'disabled_for_mvp',
      videoUpload: 'not_allowed_in_feed_mvp',
    };
  }

  private buildThreadMetadata(
    threadItems: Array<{ position: number; body: string }>,
    now: Date,
  ) {
    const timestamp = now.toISOString();

    return {
      version: 1,
      type: 'manual_thread',
      maxItems: FEED_THREAD_MAX_ITEMS,
      autoSplit: false,
      rootPosition: 1,
      rootOnlyEngagement: true,
      engagementTarget: 'root',
      assetTarget: 'root',
      createdAt: timestamp,
      updatedAt: timestamp,
      rootUpdatedAt: timestamp,
      items: threadItems.slice(1).map((item) => ({
        id: randomUUID(),
        position: item.position,
        body: item.body,
        status: 'published',
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      })),
    };
  }

  private buildThreadContinuationMetadata(rootPost: any, now: Date) {
    const timestamp = now.toISOString();

    return {
      version: 1,
      type: 'thread_continuation',
      rootPostId: rootPost.id,
      parentPostId: rootPost.id,
      rootAuthorUserId: rootPost.authorUserId,
      rootArtistId: rootPost.artistId ?? null,
      source: 'existing_post',
      displayPlacement: 'under_root_post',
      autoSplit: false,
      commentRelation: false,
      replyRelation: false,
      rootAuthorOnly: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      sortKey: timestamp,
    };
  }

  private buildRepostMetadata(originalPost: any, quoteBody: string, now: Date) {
    const timestamp = now.toISOString();
    const type = quoteBody ? 'quote_repost' : 'repost';

    return {
      version: 1,
      type,
      originalPostId: originalPost.id,
      originalAuthorUserId: originalPost.authorUserId,
      originalArtistId: originalPost.artistId ?? null,
      originalPostType: originalPost.postType,
      quoteBody: quoteBody || null,
      hasQuote: type === 'quote_repost',
      parentThreadRelation: false,
      commentRelation: false,
      replyRelation: false,
      sourceVisibility: 'public',
      originalDeletionPolicy: 'render_tombstone_without_body',
      originalHiddenPolicy: 'hide_embedded_original',
      originalBlockedPolicy: 'hide_embedded_original',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  private feedThreadPolicy() {
    return {
      relation: 'legacy_manual_thread',
      maxItems: FEED_THREAD_MAX_ITEMS,
      maxCharsPerItem: FEED_THREAD_ITEM_MAX_BODY_CHARS,
      rootIncludedInLimit: true,
      autoSplit: false,
      canonicalContinuationEndpoint:
        '/api/v1/lumina-feed/posts/:postId/thread-continuations',
      manualThreadIsNotContinuation: true,
      rootOnlyEngagement: true,
      likesTarget: 'root',
      commentsTarget: 'root',
      imagesTarget: 'root',
      countIsolation: {
        threadCountSource: 'manual_thread_items_only',
        continuationCountIncluded: false,
        repostCountIncluded: false,
        shareCountIncluded: false,
        replyCountIncluded: false,
      },
      walletMutation: false,
      luminaMutation: false,
      settlementMutation: false,
      payoutMutation: false,
    };
  }

  private feedThreadContinuationPolicy() {
    return {
      relation: 'thread_continuation',
      source: 'existing_post',
      canonicalButtonMeaning: 'append_to_existing_post',
      existingPostRequired: true,
      rootAuthorOnly: true,
      maxCharsPerItem: FEED_THREAD_CONTINUATION_MAX_BODY_CHARS,
      autoSplit: false,
      commentRelation: false,
      replyRelation: false,
      listEndpoint: '/api/v1/lumina-feed/posts/:postId/thread-continuations',
      createEndpoint: '/api/v1/lumina-feed/posts/:postId/thread-continuations',
      deletedRootPolicy: 'not_found',
      hiddenRootPolicy: 'not_found',
      privateRootPolicy: 'not_found',
      blockedRootPolicy: 'not_found_before_create',
      failClosedOnUnavailableRoot: true,
      stateProjection: {
        actionKey: 'feed_thread_continue',
        stateKey: 'thread_continuation',
        countTarget: 'thread_continuation_list',
        countDoesNotMutateRootThreadCount: true,
        countDoesNotMutateRepostCount: true,
        countDoesNotMutateShareCount: true,
      },
      walletMutation: false,
      luminaMutation: false,
      settlementMutation: false,
      payoutMutation: false,
    };
  }

  private feedRepostPolicy() {
    return {
      relation: 'repost',
      allowedTypes: ['repost', 'quote_repost'],
      simpleRepostRelation: 'repost',
      quoteRepostRelation: 'quote_repost',
      simpleRepostBodyPolicy: 'empty_body',
      quoteRepostBodyPolicy: 'optional_quote_body',
      quoteBodyMaxChars: FEED_POST_MAX_BODY_CHARS,
      emptyBodyCreates: 'repost',
      nonEmptyBodyCreates: 'quote_repost',
      sourceVisibility: 'public_only',
      originalReferenceRequired: true,
      parentThreadRelation: false,
      commentRelation: false,
      replyRelation: false,
      deletedSourcePolicy: 'not_found_before_create',
      createSourceStatusPolicy: 'published_public_not_deleted_only',
      createBlockedRelationshipPolicy: 'reject_before_repost_create',
      originalDeletionPolicy: 'render_tombstone_without_body',
      originalHiddenPolicy: 'hide_embedded_original',
      originalBlockedPolicy: 'hide_embedded_original',
      embeddedOriginalProjection: 'safe_public_summary_or_tombstone',
      stateProjection: {
        simpleRepostActionKey: 'feed_repost',
        quoteRepostActionKey: 'feed_quote_repost',
        simpleRepostStateKey: 'repost',
        quoteRepostStateKey: 'quote_repost',
        countTarget: 'repost_count',
        countDoesNotMutateThreadCount: true,
        countDoesNotMutateShareCount: true,
        countDoesNotMutateReplyCount: true,
      },
      unavailableSourceFailClosed: {
        deleted: 'not_found_before_create_or_tombstone_on_read',
        hidden: 'not_found_before_create_or_tombstone_on_read',
        private: 'not_found_before_create_or_tombstone_on_read',
        blocked: 'reject_before_create_or_tombstone_on_read',
        sourceBodyReturnedWhenUnavailable: false,
      },
      detailReadModel: {
        endpoint: 'GET /api/v1/lumina-feed/posts/:postId',
        quoteBodyField: 'post.repost.quoteBody',
        originalBodyField: 'post.repost.originalPost.body',
        tombstoneFields: [
          'post.repost.originalState',
          'post.repost.tombstone',
          'post.repost.unavailableReason',
        ],
        quoteBodyPreservedWhenOriginalUnavailable: true,
        originalBodyReturnedOnlyWhenVisible: true,
      },
      rawPrivateMetadataReturned: false,
      rawOwnerMetadataReturned: false,
      shareIsSeparateContract: true,
      shareCountMutation: false,
      countProjection: {
        feedCounters: {
          repostCountIncludes: ['repost', 'quote_repost'],
          quoteRepostCountField: 'quoteRepostCount',
          shareCountField: 'shareCount',
          shareCountMutation: false,
        },
        profileCounters: {
          repostsTabIncludes: ['repost', 'quote_repost'],
          shareActionsExcluded: true,
        },
        notificationCounters: {
          repostNotificationIncludes: ['repost', 'quote_repost'],
          shareNotificationMutation: false,
          shareUnreadCountMutation: false,
        },
        blockedRelationshipPolicy: {
          writePolicy: 'reject_before_repost_create',
          readProjection: 'hide_or_tombstone_when_blocked',
          countProjection: 'exclude_blocked_relationship_rows',
          notificationProjection: 'skip_before_notification_mutation',
        },
      },
      walletMutation: false,
      luminaMutation: false,
      settlementMutation: false,
      payoutMutation: false,
      paidLikeMutation: false,
    };
  }

  private feedShareContract(postId: string) {
    return {
      publicPath: this.publicFeedPostPath(postId),
      publicUrl: null,
      webShare: {
        enabled: true,
        urlPath: this.publicFeedPostPath(postId),
      },
      shareCount: null,
      countStrategy: 'not_mutated_by_share_contract',
      countProjection: {
        feedCounters: {
          repostCountMutation: false,
          quoteRepostCountMutation: false,
          shareCountMutation: false,
        },
        profileCounters: {
          repostsTabMutation: false,
        },
        notificationCounters: {
          createsNotification: false,
          unreadCountMutation: false,
        },
        blockedRelationshipPolicy: 'share_contract_has_no_server_count_or_notification_row',
      },
      stateProjection: {
        actionKey: 'feed_share',
        stateKey: 'share_contract',
        countTarget: null,
        countDoesNotMutateThreadCount: true,
        countDoesNotMutateRepostCount: true,
        countDoesNotMutateReplyCount: true,
      },
    };
  }

  private feedSharePolicy() {
    return {
      relation: 'share',
      projection: 'share_contract_only',
      repostRelation: false,
      threadRelation: false,
      commentRelation: false,
      replyRelation: false,
      sourceVisibility: 'public_only',
      sourceStatusPolicy: 'published_public_not_deleted_only',
      unavailableSourceFailClosed: {
        deleted: 'not_found',
        hidden: 'not_found',
        private: 'not_found',
        blocked: 'not_found',
      },
      availableOnOtherUsersPosts: true,
      authorOwnershipRequired: false,
      stateProjection: {
        actionKey: 'feed_share',
        stateKey: 'share_contract',
        countTarget: null,
        countDoesNotMutateThreadCount: true,
        countDoesNotMutateRepostCount: true,
        countDoesNotMutateReplyCount: true,
      },
      publicPathTemplate: '/lumina-feed/posts/:postId',
      privateMetadataReturned: false,
      rawOwnerMetadataReturned: false,
      rawAuthorUserIdReturned: false,
      createsFeedRow: false,
      createsRepost: false,
      shareCountMutation: false,
      countProjection: {
        feedCounters: {
          repostCountMutation: false,
          quoteRepostCountMutation: false,
          shareCountMutation: false,
        },
        profileCounters: {
          repostsTabMutation: false,
        },
        notificationCounters: {
          createsNotification: false,
          unreadCountMutation: false,
        },
        blockedRelationshipPolicy: 'share_contract_has_no_server_count_or_notification_row',
      },
      walletMutation: false,
      luminaMutation: false,
      settlementMutation: false,
      payoutMutation: false,
      paidLikeMutation: false,
    };
  }

  private publicFeedPostPath(postId: string) {
    return `/lumina-feed/posts/${postId}`;
  }

  private isBlockedExternalHostname(hostname: string) {
    const normalized = hostname.toLowerCase();

    if (
      normalized === 'localhost' ||
      normalized.endsWith('.localhost') ||
      normalized.endsWith('.local') ||
      normalized === '::1' ||
      normalized === '0.0.0.0'
    ) {
      return true;
    }

    if (/^(127|10)\./.test(normalized)) {
      return true;
    }

    if (/^192\.168\./.test(normalized)) {
      return true;
    }

    const private172 = normalized.match(/^172\.(\d{1,2})\./);
    if (private172) {
      const secondOctet = Number(private172[1]);
      return secondOctet >= 16 && secondOctet <= 31;
    }

    return /^(fc|fd|fe80):/i.test(normalized);
  }

  private async resolveActiveArtist(artistIdOrSlug: string) {
    const artist = await this.prisma.artist.findFirst({
      where: {
        status: 'active',
        ...(UUID_PATTERN.test(artistIdOrSlug)
          ? { id: artistIdOrSlug }
          : { slug: artistIdOrSlug }),
      },
      select: { id: true, slug: true, displayName: true },
    });

    if (!artist) {
      throw new NotFoundException('Artist not found');
    }

    return artist;
  }

  private async assertArtistOperator(userId: string, artistId: string) {
    const operator = await this.prisma.artistOperator.findFirst({
      where: {
        userId,
        artistId,
        status: 'active',
        revokedAt: null,
      },
      select: { id: true },
    });

    if (!operator) {
      throw new ForbiddenException('Artist operator access is required');
    }
  }

  private take(raw?: string) {
    const parsed = raw ? Number(raw) : 20;

    if (!Number.isInteger(parsed)) {
      throw new BadRequestException('take must be an integer');
    }

    return Math.max(1, Math.min(parsed, 50));
  }

  private publicFeedCleanupGuardWhere(): Prisma.CommunityPostWhereInput {
    return {
      NOT: FEED_PUBLIC_CLEANUP_GUARD_NOT,
    };
  }

  private visibility(value: unknown) {
    const normalized = this.optionalStringValue(value) ?? 'public';

    if (!POST_VISIBILITIES.has(normalized)) {
      throw new BadRequestException('visibility must be public or followers');
    }

    return normalized;
  }

  private reportReason(value: unknown) {
    const normalized = this.optionalStringValue(value) ?? '';

    if (!REPORT_REASONS.has(normalized)) {
      throw new BadRequestException(
        'reason must be sexual_content, harassment, hate, impersonation, spam, or other',
      );
    }

    return normalized;
  }

  private text(input: CommunityBody, key: string, min: number, max: number) {
    const value = this.optionalStringValue(input[key]);

    if (!value || value.length < min) {
      throw new BadRequestException(`${key} must be a non-empty string`);
    }

    if (value.length > max) {
      throw new BadRequestException(`${key} must be shorter than or equal to ${max} characters`);
    }

    return value;
  }

  private feedPostBody(input: CommunityBody, hasAssets: boolean) {
    const value = this.optionalStringValue(input.body);

    if (!value) {
      if (hasAssets) {
        return '';
      }

      throw new BadRequestException('body must be a non-empty string');
    }

    if (value.length > FEED_POST_MAX_BODY_CHARS) {
      throw new BadRequestException(
        `body must be shorter than or equal to ${FEED_POST_MAX_BODY_CHARS} characters`,
      );
    }

    return value;
  }

  private feedThreadItems(input: CommunityBody, hasAssets: boolean) {
    const rawItems = this.threadInputItems(input);

    if (!rawItems) {
      return [
        {
          position: 1,
          body: this.feedPostBody(input, hasAssets),
        },
      ];
    }

    if (rawItems.length < 1) {
      throw new BadRequestException('thread items must include at least one item');
    }

    if (rawItems.length > FEED_THREAD_MAX_ITEMS) {
      throw new BadRequestException(
        `thread items must include ${FEED_THREAD_MAX_ITEMS} items or fewer`,
      );
    }

    return rawItems.map((item, index) => ({
      position: index + 1,
      body: this.threadItemBody(
        this.threadItemBodyValue(item),
        index + 1,
        rawItems.length === 1 && hasAssets,
      ),
    }));
  }

  private threadInputItems(input: CommunityBody) {
    const candidate =
      input.items ?? input.threadItems ?? input.pieces ?? input.threadPieces;

    if (candidate === undefined || candidate === null) {
      return null;
    }

    if (!Array.isArray(candidate)) {
      throw new BadRequestException('thread items must be an array');
    }

    return candidate;
  }

  private threadItemBodyValue(item: unknown) {
    if (typeof item === 'string') {
      return item;
    }

    const data =
      item && typeof item === 'object' && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : null;

    return data?.body ?? data?.text ?? data?.content;
  }

  private threadItemBody(value: unknown, position: number, allowEmpty = false) {
    const body = typeof value === 'string' ? value.trim() : '';

    if (!body) {
      if (allowEmpty) {
        return '';
      }

      throw new BadRequestException(`thread item ${position} body must be a non-empty string`);
    }

    if (body.length > FEED_THREAD_ITEM_MAX_BODY_CHARS) {
      throw new BadRequestException(
        `thread item ${position} body must be shorter than or equal to ${FEED_THREAD_ITEM_MAX_BODY_CHARS} characters`,
      );
    }

    return body;
  }

  private optionalText(input: CommunityBody, key: string, max: number) {
    const value = this.optionalStringValue(input[key]);

    if (!value) {
      return undefined;
    }

    if (value.length > max) {
      throw new BadRequestException(`${key} must be shorter than or equal to ${max} characters`);
    }

    return value;
  }

  private optionalString(queryValue: unknown) {
    return this.optionalStringValue(queryValue);
  }

  private optionalStringValue(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private object(input: CommunityBody, key: string) {
    const value = input[key];
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private metadataObject(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private threadMetadataObject(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private requireMutableThread(value: unknown) {
    const thread = this.threadMetadataObject(value);

    if (!thread) {
      throw new BadRequestException('Post is not a thread');
    }

    return thread;
  }

  private mutableStoredThreadItems(thread: Record<string, unknown>): StoredThreadItem[] {
    const items = Array.isArray(thread.items) ? thread.items : [];

    return items
      .map((value, index) => {
        const item = this.metadataObject(value);
        const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : null;

        if (!id) {
          return null;
        }

        return {
          ...item,
          id,
          position: Number.isInteger(item.position) ? Number(item.position) : index + 2,
          body: typeof item.body === 'string' ? item.body : '',
          status: item.status === 'deleted' ? 'deleted' : 'published',
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          deletedAt: item.deletedAt,
        };
      })
      .filter((item): item is StoredThreadItem => item !== null);
  }

  private isoString(value: unknown) {
    if (value instanceof Date) {
      return value.toISOString();
    }

    return typeof value === 'string' ? value : null;
  }

  private assetStatus(metadataValue: unknown) {
    const metadata = this.metadataObject(metadataValue);
    const uploadIntent = this.metadataObject(metadata.uploadIntent);
    const lifecycle = this.metadataObject(metadata.lifecycle);

    if (lifecycle.status === 'archived') {
      return 'archived';
    }

    return typeof uploadIntent.status === 'string' ? uploadIntent.status : 'ready';
  }

  private isPublicReadyAsset(metadataValue: unknown) {
    const metadata = this.metadataObject(metadataValue);
    const uploadIntent = this.metadataObject(metadata.uploadIntent);
    const lifecycle = this.metadataObject(metadata.lifecycle);

    if (lifecycle.status === 'archived') {
      return false;
    }

    return !uploadIntent.status || uploadIntent.status === 'uploaded';
  }

  private stringFromUnknown(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private repostRelationType(value: string | undefined, quoteBody: string | null) {
    if (value === 'quote_repost' || value === 'repost') {
      return value;
    }

    return quoteBody ? 'quote_repost' : 'repost';
  }

  private userBlockPolicy() {
    return {
      relationship: 'user_block',
      scope: 'viewer_target_pair',
      hiddenSurfaces: USER_SOCIAL_ACCOUNT_CONTRACT.blockEffects.hiddenSurfaces,
      walletMutation: false,
      luminaMutation: false,
      paymentMutation: false,
      refundMutation: false,
      payoutMutation: false,
      settlementMutation: false,
      revenueSharingMutation: false,
    };
  }

  private socialBadRequest(code: string, messageKey: string, message: string) {
    return new BadRequestException({ code, message, messageKey });
  }

  private socialConflict(code: string, messageKey: string, message: string) {
    return new ConflictException({ code, message, messageKey });
  }

  private socialForbidden(code: string, messageKey: string, message: string) {
    return new ForbiddenException({ code, message, messageKey });
  }

  private socialNotFound(code: string, messageKey: string, message: string) {
    return new NotFoundException({ code, message, messageKey });
  }

  private isUniqueConstraint(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private clean<T extends Record<string, unknown>>(input: T) {
    return Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ) as T;
  }

  private toJson(value: unknown) {
    if (value === null || value === undefined) {
      return Prisma.JsonNull;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}

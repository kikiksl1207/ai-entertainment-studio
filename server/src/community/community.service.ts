import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
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
const FEED_EXTERNAL_URL_MAX_LENGTH = 2048;
const SEARCH_LANGUAGES = new Set(['ko', 'ja', 'en', 'zh', 'unknown']);
const TRENDING_LANGUAGE_FILTERS = new Set(['all', 'ko', 'ja', 'en', 'zh', 'unknown']);
const SEARCH_TYPES = new Set(['text', 'hashtag']);
const SEARCH_EVENT_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

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
        deletedAt: null,
      },
      select: {
        id: true,
        authorUserId: true,
        artistId: true,
        status: true,
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.authorUserId !== userId) {
      if (!post.artistId) {
        throw new ForbiddenException('Post author access is required');
      }

      await this.assertArtistOperator(userId, post.artistId);
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
        artistId: true,
        status: true,
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.status !== 'published') {
      throw new BadRequestException('Only published posts can be edited');
    }

    if (post.authorUserId !== userId) {
      if (!post.artistId) {
        throw new ForbiddenException('Post author access is required');
      }

      await this.assertArtistOperator(userId, post.artistId);
    }

    const body = this.text(input, 'body', 1, 500);
    const updatedPost = await this.prisma.communityPost.update({
      where: { id: post.id },
      data: {
        body,
        metadata: this.toJson({
          ...this.object(input, 'metadata'),
          editedAt: new Date().toISOString(),
          editedByUserId: userId,
          editScope: 'body_only_mvp',
        }),
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

  async getReplies(postId: string, query: CommunityQuery) {
    await this.findVisiblePost(postId);

    const replies = await this.prisma.communityReply.findMany({
      where: {
        postId,
        status: 'published',
        deletedAt: null,
      },
      take: this.take(query.take),
      include: this.replyInclude(),
      orderBy: { createdAt: 'asc' },
    });

    return replies.map((reply) => this.toReplyView(reply));
  }

  async createReply(userId: string, postId: string, input: CommunityBody) {
    await this.assertActiveUser(userId);
    const post = await this.findVisiblePost(postId);
    const body = this.text(input, 'body', 1, 300);

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
      throw new BadRequestException('userId must be a UUID');
    }

    if (followerUserId === followingUserId) {
      throw new BadRequestException('Cannot follow yourself');
    }

    await this.assertActiveUser(followerUserId);
    await this.assertActiveUser(followingUserId);

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
      throw new BadRequestException('userId must be a UUID');
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
      throw new BadRequestException('userId must be a UUID');
    }

    if (blockerUserId === blockedUserId) {
      throw new BadRequestException('Cannot block yourself');
    }

    const reason = this.optionalText(input, 'reason', 200);
    await this.assertActiveUser(blockerUserId);
    await this.assertActiveUser(blockedUserId);

    const block = await this.prisma.$transaction(async (tx) => {
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

      await tx.userFollow.updateMany({
        where: {
          OR: [
            { followerUserId: blockerUserId, followingUserId: blockedUserId },
            { followerUserId: blockedUserId, followingUserId: blockerUserId },
          ],
          status: 'active',
        },
        data: {
          status: 'deleted',
          deletedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      return created;
    });

    return { block: await this.toUserBlockView(block) };
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
      throw new BadRequestException('userId must be a UUID');
    }

    await this.prisma.userBlock.updateMany({
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

    const [
      followers,
      followingUsers,
      followingArtists,
      posts,
      replies,
      recentPosts,
    ] = await Promise.all([
      this.prisma.userFollow.count({
        where: { followingUserId: user.id, status: 'active', deletedAt: null },
      }),
      this.prisma.userFollow.count({
        where: { followerUserId: user.id, status: 'active', deletedAt: null },
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
    const isFollowing = Boolean(follow?.status === 'active' && !follow.deletedAt);

    return {
      isAuthenticated,
      isSelf,
      isFollowing,
      canFollow: Boolean(viewerUserId && !isSelf && !isFollowing),
      canUnfollow: Boolean(viewerUserId && !isSelf && isFollowing),
      canEditProfile: isSelf,
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
      throw new ForbiddenException('User profile is not available');
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
          email: true,
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
      email: true,
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
      linkPreview: metadata.linkPreview
        ? this.metadataObject(metadata.linkPreview)
        : null,
      assets: (post.assets ?? []).map((link: any) => {
        const url = this.publicFeedAssetUrl(link.asset.id, link.asset.storageKey);

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
            url,
            thumbnailUrl: url,
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
      },
    };
  }

  private publicFeedAssetUrl(assetId: string, storageKey: string) {
    if (/^https?:\/\//i.test(storageKey)) {
      return storageKey;
    }

    const configuredBaseUrl =
      this.configService.get<string>('API_PUBLIC_BASE_URL') ??
      this.configService.get<string>('BACKEND_PUBLIC_BASE_URL');
    const baseUrl =
      configuredBaseUrl ??
      (this.configService.get<string>('NODE_ENV') === 'production'
        ? 'https://api.lumina-stage.com'
        : '');

    return `${baseUrl.replace(/\/+$/, '')}/api/v1/assets/public/${assetId}`;
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
          email: true,
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
      throw new NotFoundException('User not found');
    }
  }

  private async toUserFollowView(follow: any, direction: 'follower' | 'following') {
    const user = follow[direction];
    const avatarAsset = user.profile?.avatarAssetId
      ? await this.prisma.asset.findUnique({
          where: { id: user.profile.avatarAssetId },
          select: { id: true, storageKey: true },
        })
      : null;

    return {
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
      throw new NotFoundException('User not found');
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
      throw new NotFoundException('User not found');
    }

    return user.id;
  }

  private normalizePublicHandle(publicHandle: string) {
    const normalizedHandle = publicHandle.trim();

    if (!normalizedHandle || normalizedHandle.length > 80) {
      throw new BadRequestException('publicHandle is invalid');
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

    if (value.length > 500) {
      throw new BadRequestException('body must be shorter than or equal to 500 characters');
    }

    return value;
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

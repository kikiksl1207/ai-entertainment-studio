import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { buildPublicAssetUrl } from '../common/asset-url';
import { PrismaService } from '../prisma/prisma.service';
import { LUMINA_FEED_SAMPLE_POSTS } from './lumina-feed-samples';

type CommunityQuery = Record<string, string | undefined>;
type CommunityBody = Record<string, unknown>;

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

@Injectable()
export class CommunityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  getFeed(query: CommunityQuery) {
    const take = this.take(query.take);
    const cursor = this.optionalString(query.cursor);
    const mode = this.optionalString(query.mode) ?? 'all';
    const artistSlug = this.optionalString(query.artistSlug);

    if (!['all', 'artists', 'fans'].includes(mode)) {
      throw new BadRequestException('mode must be all, artists, or fans');
    }

    return this.prisma.communityPost.findMany({
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

    return this.prisma.communityPost.findMany({
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
  }

  async createPost(userId: string, input: CommunityBody) {
    const body = this.text(input, 'body', 1, 500);
    const artistId = await this.resolveOptionalArtistId(input);
    const visibility = this.visibility(input.visibility);

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
        metadata: this.toJson(this.object(input, 'metadata') ?? {}),
      },
      include: this.postInclude(),
    });

    return { post };
  }

  async getReplies(postId: string, query: CommunityQuery) {
    await this.findVisiblePost(postId);

    return this.prisma.communityReply.findMany({
      where: {
        postId,
        status: 'published',
        deletedAt: null,
      },
      take: this.take(query.take),
      include: this.replyInclude(),
      orderBy: { createdAt: 'asc' },
    });
  }

  async createReply(userId: string, postId: string, input: CommunityBody) {
    await this.findVisiblePost(postId);
    const body = this.text(input, 'body', 1, 300);

    return this.prisma.$transaction(async (tx) => {
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

      return { reply };
    });
  }

  async likePost(userId: string, postId: string, idempotencyKey?: string) {
    await this.findVisiblePost(postId);

    try {
      return await this.prisma.$transaction(async (tx) => {
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
    } catch (error) {
      if (this.isUniqueConstraint(error)) {
        const post = await this.prisma.communityPost.findUnique({
          where: { id: postId },
          include: this.postInclude(),
        });
        return { post, idempotentReplay: true, idempotencyKey: idempotencyKey ?? null };
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

      return { ok: true, removed: deleted.count > 0 };
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

  async followArtist(userId: string, artistId: string) {
    const artist = await this.resolveActiveArtist(artistId);

    return this.prisma.artistFollow.upsert({
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

    return { ok: true };
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

    return this.prisma.userFollow.upsert({
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

    return { ok: true };
  }

  async getMyFollowing(userId: string) {
    const [artists, users] = await Promise.all([
      this.getMyFollowingArtists(userId),
      this.getMyFollowingUsers(userId),
    ]);

    return { artists, users };
  }

  getMyFollowingArtists(userId: string) {
    return this.prisma.artistFollow.findMany({
      where: {
        userId,
        status: 'active',
        deletedAt: null,
      },
      include: this.followInclude(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMyFollowingUsers(userId: string) {
    const follows = await this.prisma.userFollow.findMany({
      where: {
        followerUserId: userId,
        status: 'active',
        deletedAt: null,
      },
      include: this.userFollowInclude('following'),
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      follows.map((follow) => this.toUserFollowView(follow, 'following')),
    );
  }

  async getMyFollowers(userId: string) {
    const follows = await this.prisma.userFollow.findMany({
      where: {
        followingUserId: userId,
        status: 'active',
        deletedAt: null,
      },
      include: this.userFollowInclude('follower'),
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(follows.map((follow) => this.toUserFollowView(follow, 'follower')));
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
              avatarAssetId: true,
            },
          },
        },
      },
    } satisfies Prisma.CommunityReplyInclude;
  }

  private followInclude() {
    return {
      artist: {
        select: {
          id: true,
          slug: true,
          displayName: true,
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
          avatarAssetId: true,
        },
      },
    };

    return {
      [direction]: {
        select: userSelect,
      },
    } satisfies Prisma.UserFollowInclude;
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
        displayName: user.profile?.displayName ?? user.email?.split('@')[0] ?? 'Lumina User',
        avatarUrl: avatarAsset
          ? buildPublicAssetUrl(this.configService, avatarAsset.storageKey)
          : null,
      },
    };
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
      select: { id: true },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return post;
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

  private optionalString(queryValue: string | undefined) {
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

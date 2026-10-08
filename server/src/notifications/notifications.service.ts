import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { buildPublicAssetUrl } from '../common/asset-url';
import { PrismaService } from '../prisma/prisma.service';

type NotificationQuery = Record<string, string | undefined>;

type CreateNotificationInput = {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  actorUserId?: string | null;
  artistId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
};

type NotificationTemplate = {
  messageKey: string;
  titleKey: string;
  bodyKey?: string;
  defaultTitle: string;
  defaultBody?: string | null;
};

export const FEED_NOTIFICATION_PROJECTION_CONTRACT = {
  version: '2026-06-08.feed-thread-comment-repost-notification-projection.v1',
  readOnly: true,
  notificationMutationEnabled: false,
  feedEventTypes: {
    comment: 'feed.reply',
    threadContinuation: 'feed.thread_continuation',
    repost: 'feed.repost',
  },
  countLanes: {
    comment: {
      type: 'feed.reply',
      countKey: 'feedCommentUnreadCount',
      targetType: 'community_post',
      mixesWithThreadContinuation: false,
      mixesWithRepost: false,
    },
    threadContinuation: {
      type: 'feed.thread_continuation',
      countKey: 'feedThreadContinuationUnreadCount',
      targetType: 'community_post',
      mixesWithComment: false,
      mixesWithRepost: false,
    },
    repost: {
      type: 'feed.repost',
      countKey: 'feedRepostUnreadCount',
      targetType: 'community_post',
      mixesWithComment: false,
      mixesWithThreadContinuation: false,
    },
  },
  failClosedReadFilters: {
    deletedPost: 'exclude_from_list_and_count',
    hiddenPost: 'exclude_from_list_and_count',
    privatePost: 'exclude_from_list_and_count',
    blockedRelationship: 'exclude_without_identity_leak',
    missingPost: 'exclude_from_list_and_count',
  },
  projectionFields: [
    'id',
    'type',
    'targetType',
    'targetId',
    'readAt',
    'createdAt',
    'i18n.messageKey',
    'i18n.titleKey',
    'i18n.bodyKey',
    'actor.displayName',
    'actor.publicHandle',
  ],
  privacy: {
    rawPostBodyReturned: false,
    rawCommentBodyReturned: false,
    rawDeletedPostReturned: false,
    blockedUserPrivateFieldsReturned: false,
    actorEmailReturned: false,
    tokenReturned: false,
    cookieReturned: false,
  },
  noMutation: {
    communityPostCreate: true,
    communityReplyCreate: true,
    repostCreate: true,
    notificationCreate: true,
    walletMutation: true,
    settlementMutation: true,
    payoutMutation: true,
  },
} as const;

const NOTIFICATION_STATUSES = new Set(['all', 'read', 'unread']);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  'feed.reply': {
    messageKey: 'notification.feed.reply',
    titleKey: 'notification.feed.reply.title',
    bodyKey: 'notification.feed.reply.body',
    defaultTitle: 'New reply on your feed post',
    defaultBody: 'Someone replied to your feed post.',
  },
  'feed.like': {
    messageKey: 'notification.feed.like',
    titleKey: 'notification.feed.like.title',
    defaultTitle: 'New like on your feed post',
    defaultBody: 'Someone liked your feed post.',
  },
  'feed.thread_continuation': {
    messageKey: 'notification.feed.threadContinuation',
    titleKey: 'notification.feed.threadContinuation.title',
    bodyKey: 'notification.feed.threadContinuation.body',
    defaultTitle: 'New thread continuation on your feed post',
    defaultBody: 'Someone continued a feed thread.',
  },
  'feed.repost': {
    messageKey: 'notification.feed.repost',
    titleKey: 'notification.feed.repost.title',
    bodyKey: 'notification.feed.repost.body',
    defaultTitle: 'New repost on your feed post',
    defaultBody: 'Someone reposted your feed post.',
  },
  'user.follow': {
    messageKey: 'notification.user.follow',
    titleKey: 'notification.user.follow.title',
    defaultTitle: 'New follower',
    defaultBody: 'Someone started following you.',
  },
  'fan_letter.received': {
    messageKey: 'notification.fan_letter.received',
    titleKey: 'notification.fan_letter.received.title',
    bodyKey: 'notification.fan_letter.received.body',
    defaultTitle: 'New fan letter',
    defaultBody: 'A fan sent a new letter.',
  },
  'fan_letter.reply': {
    messageKey: 'notification.fan_letter.reply',
    titleKey: 'notification.fan_letter.reply.title',
    bodyKey: 'notification.fan_letter.reply.body',
    defaultTitle: 'Fan letter reply arrived',
    defaultBody: 'Your fan letter received a reply.',
  },
};

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  getFeedNotificationProjectionContract() {
    return FEED_NOTIFICATION_PROJECTION_CONTRACT;
  }

  async list(userId: string, query: NotificationQuery) {
    const take = this.take(query.take);
    const cursor = this.optionalString(query.cursor);
    const status = this.optionalString(query.status) ?? 'all';
    const type = this.optionalString(query.type);

    if (!NOTIFICATION_STATUSES.has(status)) {
      throw new BadRequestException('status must be all, read, or unread');
    }

    if (cursor && !UUID_PATTERN.test(cursor)) {
      throw new BadRequestException('cursor must be a UUID');
    }

    return this.notificationTransaction(async (tx) => {
      const scope = this.visibleNotificationSql(userId);
      let position = Prisma.empty;
      if (cursor) {
        const anchors = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT n.id FROM user_notifications n
          WHERE ${scope} AND n.id = ${cursor}::uuid LIMIT 1
        `);
        if (!anchors.length) throw new BadRequestException('cursor is unavailable');
        position = Prisma.sql`AND (n.created_at, n.id) < (
          (SELECT anchor.created_at FROM user_notifications anchor
            WHERE anchor.user_id = ${userId}::uuid AND anchor.id = ${cursor}::uuid), ${cursor}::uuid
        )`;
      }
      const statusFilter = status === 'unread' ? Prisma.sql`AND n.read_at IS NULL` :
        status === 'read' ? Prisma.sql`AND n.read_at IS NOT NULL` : Prisma.empty;
      const typeFilter = type ? Prisma.sql`AND n.type = ${type}` : Prisma.empty;
      const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT n.id FROM user_notifications n WHERE ${scope}
        ${statusFilter} ${typeFilter} ${position}
        ORDER BY n.created_at DESC, n.id DESC LIMIT ${take + 1}
      `);
      const counts = await tx.$queryRaw<{ unreadCount: number }[]>(Prisma.sql`
        SELECT COUNT(*)::integer AS "unreadCount" FROM user_notifications n
        WHERE ${scope} AND n.read_at IS NULL
      `);
      const page = ids.slice(0, take);
      const rows = page.length ? await tx.userNotification.findMany({
        where: { userId, id: { in: page.map((item) => item.id) } },
        include: this.notificationInclude(),
      }) : [];
      const byId = new Map(rows.map((row) => [row.id, row]));
      const notifications = await Promise.all(page.map(async ({ id }) => {
        const row = byId.get(id);
        if (!row) throw new NotFoundException('Notification not found');
        return this.toNotificationView(row, tx);
      }));
      return {
        notifications, unreadCount: counts[0].unreadCount,
        nextCursor: ids.length > take ? page[page.length - 1]?.id ?? null : null,
      };
    });
  }

  async unreadCount(userId: string) {
    return this.notificationTransaction(async (tx) => {
      const counts = await tx.$queryRaw<{ unreadCount: number }[]>(Prisma.sql`
        SELECT COUNT(*)::integer AS "unreadCount" FROM user_notifications n
        WHERE ${this.visibleNotificationSql(userId)} AND n.read_at IS NULL
      `);
      return { unreadCount: counts[0].unreadCount };
    });
  }

  async markRead(userId: string, notificationId: string) {
    if (typeof notificationId !== 'string' || !UUID_PATTERN.test(notificationId)) {
      throw new BadRequestException('notificationId must be a UUID');
    }

    return this.notificationTransaction(async (tx) => {
      const ids = await tx.$queryRaw<{ id: string; readAt: Date | null }[]>(Prisma.sql`
        SELECT n.id, n.read_at AS "readAt" FROM user_notifications n
        WHERE ${this.visibleNotificationSql(userId)} AND n.id = ${notificationId}::uuid LIMIT 1
      `);
      if (!ids.length) throw new NotFoundException('Notification not found');
      if (ids[0].readAt === null) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE user_notifications n SET read_at = CURRENT_TIMESTAMP
          WHERE ${this.visibleNotificationSql(userId)} AND n.id = ${notificationId}::uuid AND n.read_at IS NULL
        `);
      }
      const notification = await tx.userNotification.findUnique({
        where: { id: ids[0].id }, include: this.notificationInclude(),
      });
      if (!notification) throw new NotFoundException('Notification not found');
      return { notification: await this.toNotificationView(notification, tx) };
    });
  }

  async markAllRead(userId: string) {
    return this.notificationTransaction(async (tx) => {
      const updatedCount = await tx.$executeRaw(Prisma.sql`
        UPDATE user_notifications n SET read_at = CURRENT_TIMESTAMP
        WHERE ${this.visibleNotificationSql(userId)} AND n.read_at IS NULL
      `);
      return { ok: true, updatedCount };
    });
  }

  private async notificationTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        });
      } catch (error) {
        const known = error && typeof error === 'object' && 'code' in error;
        const sqlState = known && 'meta' in error && error.meta && typeof error.meta === 'object' && 'code' in error.meta
          ? error.meta.code : null;
        const conflict = known && (error.code === 'P2034' ||
          (error.code === 'P2010' && (sqlState === '40001' || sqlState === '40P01')));
        if (attempt >= 2 || !conflict) throw error;
      }
    }
  }

  private noActiveBlockSql(userId: string, other: Prisma.Sql) {
    return Prisma.sql`NOT EXISTS (
      SELECT 1 FROM user_blocks b WHERE b.status = 'active' AND b.deleted_at IS NULL AND
        ((b.blocker_user_id = ${userId}::uuid AND b.blocked_user_id = ${other}) OR
         (b.blocked_user_id = ${userId}::uuid AND b.blocker_user_id = ${other}))
    )`;
  }

  // Generic notification targets have no post relation; keep the same visibility predicate in SQL for pages, counts and writes.
  private visibleNotificationSql(userId: string) {
    return Prisma.sql`
      n.user_id = ${userId}::uuid
      AND ${this.noActiveBlockSql(userId, Prisma.sql`n.actor_user_id`)}
      AND (
        (n.target_type IS DISTINCT FROM 'community_post' AND n.type NOT LIKE 'feed.%') OR
        EXISTS (
          SELECT 1 FROM community_posts p
          WHERE n.target_type = 'community_post' AND p.id = n.target_id
            AND p.status = 'published' AND p.visibility = 'public' AND p.deleted_at IS NULL
            AND ${this.noActiveBlockSql(userId, Prisma.sql`p.author_user_id`)}
            AND NOT EXISTS (
              SELECT 1 FROM community_hidden_posts h
              WHERE h.post_id = p.id AND h.user_id = ${userId}::uuid
                AND h.status = 'active' AND h.deleted_at IS NULL
            )
        )
      )
    `;
  }

  async createNotification(input: CreateNotificationInput) {
    if (input.actorUserId && input.actorUserId === input.userId) {
      return null;
    }

    if (!(await this.shouldDeliver(input.userId, input.type))) {
      return null;
    }

    const template = this.notificationTemplate(input.type);

    return this.prisma.userNotification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        actorUserId: input.actorUserId ?? null,
        artistId: input.artistId ?? null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadata: this.toJson({
          messageKey: template.messageKey,
          titleKey: template.titleKey,
          bodyKey: template.bodyKey ?? null,
          defaultTitle: template.defaultTitle,
          defaultBody: template.defaultBody ?? null,
          ...(input.metadata ?? {}),
        }),
      },
    });
  }

  private async shouldDeliver(userId: string, type: string) {
    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
      select: {
        activityNotifications: true,
        feedNotifications: true,
      },
    });

    if (!settings) {
      return true;
    }

    if (type.startsWith('feed.')) {
      return settings.feedNotifications;
    }

    return settings.activityNotifications;
  }

  private async toNotificationView(notification: any, client: Prisma.TransactionClient = this.prisma) {
    const feed = notification.type.startsWith('feed.');
    const template = this.notificationTemplate(notification.type);
    const projected = feed ? {
      ...notification, title: template.defaultTitle, body: template.defaultBody ?? null,
      metadata: { messageKey: template.messageKey, titleKey: template.titleKey, bodyKey: template.bodyKey ?? null },
    } : notification;
    const avatarAsset = notification.actorUser?.profile?.avatarAssetId
      ? await client.asset.findUnique({
          where: { id: notification.actorUser.profile.avatarAssetId },
          select: { storageKey: true },
        })
      : null;

    return {
      id: notification.id,
      type: notification.type,
      title: projected.title,
      body: projected.body,
      i18n: this.notificationI18n(projected),
      targetType: notification.targetType,
      targetId: notification.targetId,
      metadata: projected.metadata,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      actor: notification.actorUser
        ? {
            id: notification.actorUser.id,
            displayName:
              notification.actorUser.profile?.displayName ??
              notification.actorUser.profile?.publicHandle ??
              'Lumina User',
            publicHandle: notification.actorUser.profile?.publicHandle ?? null,
            avatarUrl: avatarAsset
              ? buildPublicAssetUrl(this.configService, avatarAsset.storageKey)
              : null,
          }
        : null,
      artist: notification.artist
        ? {
            id: notification.artist.id,
            slug: notification.artist.slug,
            displayName: notification.artist.displayName,
          }
        : null,
    };
  }

  private notificationInclude() {
    return {
      actorUser: {
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
    } satisfies Prisma.UserNotificationInclude;
  }

  private take(value: string | undefined) {
    if (value !== undefined && typeof value !== 'string') throw new BadRequestException('take must be a string');
    const parsed = Number(value ?? 20);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      throw new BadRequestException('take must be an integer between 1 and 100');
    }

    return parsed;
  }

  private optionalString(value: unknown) {
    if (value !== undefined && value !== null && typeof value !== 'string') throw new BadRequestException('query values must be strings');
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private toJson(value: Record<string, unknown>) {
    return value as Prisma.InputJsonObject;
  }

  private notificationTemplate(type: string) {
    return (
      NOTIFICATION_TEMPLATES[type] ?? {
        messageKey: `notification.${type}`,
        titleKey: `notification.${type}.title`,
        defaultTitle: 'New notification',
        defaultBody: null,
      }
    );
  }

  private notificationI18n(notification: {
    type: string;
    title: string;
    body: string | null;
    metadata: Prisma.JsonValue;
    actorUserId?: string | null;
    artistId?: string | null;
    targetType?: string | null;
    targetId?: string | null;
  }) {
    const template = this.notificationTemplate(notification.type);
    const metadata =
      notification.metadata &&
      typeof notification.metadata === 'object' &&
      !Array.isArray(notification.metadata)
        ? (notification.metadata as Record<string, unknown>)
        : {};

    return {
      messageKey:
        typeof metadata.messageKey === 'string'
          ? metadata.messageKey
          : template.messageKey,
      titleKey:
        typeof metadata.titleKey === 'string' ? metadata.titleKey : template.titleKey,
      bodyKey:
        typeof metadata.bodyKey === 'string'
          ? metadata.bodyKey
          : template.bodyKey ?? null,
      defaultTitle: notification.title,
      defaultBody: notification.body,
      params: {
        type: notification.type,
        actorUserId: notification.actorUserId ?? null,
        artistId: notification.artistId ?? null,
        targetType: notification.targetType ?? null,
        targetId: notification.targetId ?? null,
      },
    };
  }

  private clean<T extends Record<string, unknown>>(value: T) {
    return Object.fromEntries(
      Object.entries(value).filter(([, entry]) => entry !== undefined),
    ) as T;
  }
}

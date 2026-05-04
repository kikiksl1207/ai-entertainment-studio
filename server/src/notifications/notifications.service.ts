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

    const where = this.clean({
      userId,
      type,
      readAt:
        status === 'unread' ? null : status === 'read' ? { not: null } : undefined,
    }) satisfies Prisma.UserNotificationWhereInput;

    const [rows, unreadCount] = await Promise.all([
      this.prisma.userNotification.findMany({
        where,
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: this.notificationInclude(),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.userNotification.count({
        where: { userId, readAt: null },
      }),
    ]);

    const hasNextPage = rows.length > take;
    const notifications = rows.slice(0, take);

    return {
      notifications: await Promise.all(
        notifications.map((notification) => this.toNotificationView(notification)),
      ),
      unreadCount,
      nextCursor: hasNextPage ? notifications[notifications.length - 1]?.id ?? null : null,
    };
  }

  async unreadCount(userId: string) {
    const unreadCount = await this.prisma.userNotification.count({
      where: { userId, readAt: null },
    });

    return { unreadCount };
  }

  async markRead(userId: string, notificationId: string) {
    if (!UUID_PATTERN.test(notificationId)) {
      throw new BadRequestException('notificationId must be a UUID');
    }

    const notification = await this.prisma.userNotification.findFirst({
      where: { id: notificationId, userId },
      select: { id: true, readAt: true },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    const updated = await this.prisma.userNotification.update({
      where: { id: notification.id },
      data: notification.readAt ? {} : { readAt: new Date() },
      include: this.notificationInclude(),
    });

    return { notification: await this.toNotificationView(updated) };
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.userNotification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });

    return { ok: true, updatedCount: result.count };
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

  private async toNotificationView(notification: any) {
    const avatarAsset = notification.actorUser?.profile?.avatarAssetId
      ? await this.prisma.asset.findUnique({
          where: { id: notification.actorUser.profile.avatarAssetId },
          select: { storageKey: true },
        })
      : null;

    return {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      i18n: this.notificationI18n(notification),
      targetType: notification.targetType,
      targetId: notification.targetId,
      metadata: notification.metadata,
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
          email: true,
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
    const parsed = Number(value ?? 20);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      throw new BadRequestException('take must be an integer between 1 and 100');
    }

    return parsed;
  }

  private optionalString(value: unknown) {
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

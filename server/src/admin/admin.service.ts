import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SettlementRecord } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { createHash, createHmac, randomUUID } from 'crypto';
import { AuthUser } from '../auth/auth.types';
import { buildPublicAssetUrl } from '../common/asset-url';
import { PrismaService } from '../prisma/prisma.service';

type AdminPayload = Record<string, unknown>;
type AuditQuery = Record<string, string | undefined>;

const SETTLEMENT_STATUSES = new Set([
  'estimated',
  'ready',
  'hold',
  'paid',
  'recheck',
  'cancelled',
]);

const SETTLEMENT_TYPES = new Set(['artist', 'partner']);

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  getAdminRoles() {
    return this.prisma.adminRole.findMany({
      orderBy: { name: 'asc' },
    });
  }

  getAdminUsers() {
    return this.prisma.adminUser.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        role: true,
        user: {
          select: {
            id: true,
            email: true,
            status: true,
            createdAt: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });
  }

  async getBackstageSummary() {
    const { start, end } = this.todayRange();
    const [
      todayUsers,
      activeUsers,
      suspendedUsers,
      todayPaymentOrders,
      pendingPaymentOrders,
      paidPaymentOrdersToday,
      submittedDebutApplications,
      recentDebutApplications,
      submittedReports,
      reviewingReports,
      hiddenPosts,
      highRiskPosts,
      recentAuditEvents,
    ] = await Promise.all([
      this.prisma.user.count({
        where: {
          createdAt: { gte: start, lt: end },
          deletedAt: null,
        },
      }),
      this.prisma.user.count({
        where: { status: 'active', deletedAt: null },
      }),
      this.prisma.user.count({
        where: { status: 'suspended', deletedAt: null },
      }),
      this.prisma.paymentOrder.count({
        where: { createdAt: { gte: start, lt: end } },
      }),
      this.prisma.paymentOrder.count({
        where: { status: { in: ['pending', 'pg_pending'] } },
      }),
      this.prisma.paymentOrder.aggregate({
        where: {
          status: 'paid',
          createdAt: { gte: start, lt: end },
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.debutApplication.count({
        where: { status: { in: ['submitted', 'reviewing'] } },
      }),
      this.prisma.debutApplication.findMany({
        where: { status: { in: ['submitted', 'reviewing'] } },
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          applicantName: true,
          displayName: true,
          contactEmail: true,
          participationType: true,
          shareTierRequested: true,
          createdAt: true,
        },
      }),
      this.prisma.communityReport.count({
        where: { status: 'submitted' },
      }),
      this.prisma.communityReport.count({
        where: { status: 'reviewing' },
      }),
      this.prisma.communityPost.count({
        where: { status: 'hidden' },
      }),
      this.prisma.communityPost.findMany({
        where: {
          reportCount: { gt: 0 },
          status: { in: ['published', 'hidden'] },
        },
        take: 5,
        orderBy: [{ reportCount: 'desc' }, { createdAt: 'desc' }],
        include: this.communityPostInclude(),
      }),
      this.prisma.auditEvent.findMany({
        take: 8,
        orderBy: { createdAt: 'desc' },
        include: {
          actorUser: {
            select: { id: true, email: true, status: true },
          },
        },
      }),
    ]);

    return {
      generatedAt: new Date(),
      range: {
        label: 'today',
        timezone: 'Asia/Seoul',
        start,
        end,
      },
      kpis: [
        {
          key: 'today_users',
          label: 'Today signups',
          value: todayUsers,
          tone: 'info',
          href: '/backstage/users',
        },
        {
          key: 'today_payment_orders',
          label: 'Today charge orders',
          value: todayPaymentOrders,
          tone: 'commerce',
          href: '/backstage/payments',
        },
        {
          key: 'moderation_queue',
          label: 'Reports pending',
          value: submittedReports + reviewingReports,
          tone: submittedReports + reviewingReports > 0 ? 'warning' : 'ok',
          href: '/backstage/community',
        },
        {
          key: 'debut_queue',
          label: 'Debut applications',
          value: submittedDebutApplications,
          tone: submittedDebutApplications > 0 ? 'warning' : 'ok',
          href: '/backstage/debut',
        },
      ],
      users: {
        today: todayUsers,
        active: activeUsers,
        suspended: suspendedUsers,
      },
      payments: {
        todayOrders: todayPaymentOrders,
        pendingOrders: pendingPaymentOrders,
        todayPaidOrders: paidPaymentOrdersToday._count._all,
        todayPaidAmount: paidPaymentOrdersToday._sum.amount ?? new Decimal(0),
      },
      queues: {
        debutApplications: submittedDebutApplications,
        communityReports: {
          submitted: submittedReports,
          reviewing: reviewingReports,
          totalOpen: submittedReports + reviewingReports,
        },
        hiddenPosts,
      },
      alerts: [
        {
          key: 'moderation_queue',
          severity: submittedReports + reviewingReports > 0 ? 'warning' : 'info',
          title: 'Community moderation queue',
          count: submittedReports + reviewingReports,
          href: '/backstage/community',
        },
        {
          key: 'debut_queue',
          severity: submittedDebutApplications > 0 ? 'warning' : 'info',
          title: 'Debut applications awaiting review',
          count: submittedDebutApplications,
          href: '/backstage/debut',
        },
        {
          key: 'payment_pending',
          severity: pendingPaymentOrders > 0 ? 'watch' : 'info',
          title: 'Payment orders not completed',
          count: pendingPaymentOrders,
          href: '/backstage/payments',
        },
      ],
      tables: {
        recentDebutApplications,
        highRiskPosts,
        recentAuditEvents,
      },
      policy: {
        pageName: 'Backstage',
        recommendedLayout: 'sidebar-kpi-table',
        desktopFirst: true,
        preferredUrl: '/backstage',
        creatorStudioUrl: '/creator-studio',
      },
    };
  }

  async getBackstageCreatorOperations(user: AuthUser, query: AuditQuery) {
    const pagination = this.adminPagination(query, 20);
    const search = this.optionalString(query, 'query') ?? this.optionalString(query, 'q');
    const status = this.optionalString(query, 'status');
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const canViewContact = this.canViewCreatorContact(user);
    const canViewPayout = this.canViewPayoutInfo(user);
    const applicationWhere: Prisma.DebutApplicationWhereInput = this.clean({
      status,
      OR: search
        ? [
            { applicantName: { contains: search, mode: 'insensitive' } },
            { displayName: { contains: search, mode: 'insensitive' } },
            { contactEmail: { contains: search, mode: 'insensitive' } },
            { user: { email: { contains: search, mode: 'insensitive' } } },
          ]
        : undefined,
    });

    const [
      applications,
      applicationsByStatus,
      activeArtistOperators,
      aiArtists,
      aiArtistTotal,
      newApplicationCount,
    ] = await Promise.all([
      this.prisma.debutApplication.findMany({
        where: applicationWhere,
        take: pagination.takeForQuery,
        ...pagination.cursorArgs,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              status: true,
              createdAt: true,
              profile: {
                select: {
                  displayName: true,
                  publicHandle: true,
                },
              },
              authAccounts: {
                select: {
                  provider: true,
                  lastLoginAt: true,
                  createdAt: true,
                },
              },
              artistOperators: {
                where: { status: 'active' },
                select: {
                  id: true,
                  role: true,
                  status: true,
                  artist: {
                    select: { id: true, slug: true, displayName: true, status: true },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.debutApplication.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.artistOperator.findMany({
        where: { status: 'active' },
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: this.artistOperatorInclude(),
      }),
      this.prisma.artist.findMany({
        where: {
          OR: search
            ? [
                { displayName: { contains: search, mode: 'insensitive' } },
                { slug: { contains: search, mode: 'insensitive' } },
              ]
            : undefined,
        },
        take: 10,
        orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
        include: {
          publicProfile: true,
          visualProfile: true,
          contentProfile: true,
          _count: {
            select: {
              artistAssets: true,
              shortforms: true,
              premiumVideos: true,
              chatPersonas: true,
              followers: true,
              communityPosts: true,
            },
          },
        },
      }),
      this.prisma.artist.count(),
      this.prisma.debutApplication.count({
        where: { status: { in: ['submitted', 'reviewing'] } },
      }),
    ]);

    const applicationPage = this.paginated(applications, pagination.take);

    return {
      generatedAt: new Date(),
      summary: {
        newApplications: newApplicationCount,
        applicationsByStatus: this.countRowsToObject(applicationsByStatus, 'status'),
        activeArtistOperators: activeArtistOperators.length,
        aiArtists: aiArtistTotal,
      },
      applications: {
        ...applicationPage,
        items: applicationPage.items.map((application) => {
          const latestLoginAt = this.latestLoginAt(application.user.authAccounts);
          const metadata = this.metadataObject(application.metadata);
          return {
            id: application.id,
            userId: application.userId,
            status: application.status,
            realName: application.applicantName,
            stageName: application.displayName,
            applicantName: application.applicantName,
            displayName: application.displayName,
            participationType: application.participationType,
            shareTierRequested: application.shareTierRequested,
            shareTierApproved: application.shareTierApproved,
            applicationChannel: metadata.applicationChannel ?? null,
            applicationType: metadata.applicationType ?? null,
            rightsReviewRequired: metadata.rightsReviewRequired ?? false,
            partnerReviewRequired: metadata.partnerReviewRequired ?? false,
            contactEmail: canViewContact
              ? application.contactEmail
              : this.maskEmail(application.contactEmail),
            contactPhone: canViewContact
              ? application.contactPhone
              : this.maskPhone(application.contactPhone),
            contactMasked: !canViewContact,
            contactAccessAllowed: canViewContact,
            payoutAccountMasked: true,
            payoutAccessAllowed: canViewPayout,
            loginType: this.primaryLoginType(application.user.authAccounts),
            lastSeenAt: latestLoginAt,
            inactive30Days: latestLoginAt ? latestLoginAt < thirtyDaysAgo : true,
            needsFollowUp: ['submitted', 'reviewing', 'needs_more_info'].includes(
              application.status,
            ),
            isNew: application.status === 'submitted',
            createdAt: application.createdAt,
            updatedAt: application.updatedAt,
            user: {
              id: application.user.id,
              email: application.user.email,
              status: application.user.status,
              profile: application.user.profile,
              artists: application.user.artistOperators.map((operator) => operator.artist),
            },
          };
        }),
      },
      activeCreators: activeArtistOperators.map((operator) => ({
        operatorId: operator.id,
        userId: operator.userId,
        artistId: operator.artistId,
        role: operator.role,
        status: operator.status,
        permissions: operator.permissions,
        createdAt: operator.createdAt,
        updatedAt: operator.updatedAt,
        user: {
          id: operator.user.id,
          email: canViewContact ? operator.user.email : this.maskEmail(operator.user.email),
          status: operator.user.status,
          profile: operator.user.profile,
        },
        artist: operator.artist,
      })),
      aiArtists: aiArtists.map((artist) => ({
        id: artist.id,
        slug: artist.slug,
        displayName: artist.displayName,
        status: artist.status,
        sortOrder: artist.sortOrder,
        launchedAt: artist.launchedAt,
        counts: artist._count,
        missing: this.aiArtistMissingSections(artist),
        updatedAt: artist.updatedAt,
      })),
      permissions: {
        contactAccessAllowed: canViewContact,
        payoutAccessAllowed: canViewPayout,
        contactMasked: !canViewContact,
        payoutMasked: !canViewPayout,
      },
      policy: {
        route: '/backstage/creators',
        contactRoles: ['super_admin', 'sales_admin'],
        payoutRoles: ['super_admin', 'accounting_admin'],
        rawContactDefault: false,
        payoutModelStatus: 'not_implemented',
      },
    };
  }

  async getBackstageAiContentHealth(query: AuditQuery) {
    const pagination = this.adminPagination(query, 20);
    const search = this.optionalString(query, 'query') ?? this.optionalString(query, 'q');
    const status = this.optionalString(query, 'status');
    const where: Prisma.ArtistWhereInput = this.clean({
      status,
      OR: search
        ? [
            { displayName: { contains: search, mode: 'insensitive' } },
            { slug: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    });

    const artists = await this.prisma.artist.findMany({
      where,
      take: pagination.takeForQuery,
      ...pagination.cursorArgs,
      orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: {
        publicProfile: true,
        visualProfile: true,
        contentProfile: true,
        artistAssets: {
          orderBy: [{ usageType: 'asc' }, { sortOrder: 'asc' }],
          include: {
            asset: {
              select: {
                id: true,
                assetType: true,
                visibility: true,
                storageProvider: true,
                storageKey: true,
                mimeType: true,
                width: true,
                height: true,
                durationSeconds: true,
                metadata: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
        shortforms: {
          select: {
            id: true,
            slug: true,
            title: true,
            status: true,
            publishedAt: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 5,
        },
        premiumVideos: {
          select: {
            id: true,
            sku: true,
            title: true,
            status: true,
            publishedAt: true,
            updatedAt: true,
            _count: { select: { assets: true, unlocks: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: 5,
        },
        chatPersonas: {
          select: {
            id: true,
            name: true,
            status: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 5,
        },
        giftProducts: {
          select: {
            id: true,
            sku: true,
            name: true,
            giftKind: true,
            status: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 5,
        },
        _count: {
          select: {
            artistAssets: true,
            shortforms: true,
            premiumVideos: true,
            chatPersonas: true,
            followers: true,
            communityPosts: true,
            giftProducts: true,
          },
        },
      },
    });
    const page = this.paginated(artists, pagination.take);
    const items = page.items.map((artist) => this.presentAiContentHealth(artist));
    const statusCounts = items.reduce<Record<string, number>>((acc, item) => {
      acc[item.healthStatus] = (acc[item.healthStatus] ?? 0) + 1;
      return acc;
    }, {});

    return {
      generatedAt: new Date(),
      ...page,
      items,
      summary: {
        totalInPage: items.length,
        byHealthStatus: statusCounts,
        needsAction: items.filter((item) => item.healthStatus !== 'ok').length,
      },
      policy: {
        route: '/backstage/ai-content',
        slotSelectionFirst: true,
        autoClassificationStatus: 'deferred',
        requiredSlots: ['cover', 'thumbnail', 'gallery'],
      },
    };
  }

  async getBackstageUsersOverview(query: AuditQuery) {
    const pagination = this.adminPagination(query, 20);
    const email = this.optionalString(query, 'email');
    const search = this.optionalString(query, 'query') ?? this.optionalString(query, 'q');
    const status = this.optionalString(query, 'status');
    const where: Prisma.UserWhereInput = this.clean({
      status,
      email: email
        ? {
            contains: email,
            mode: 'insensitive',
          }
        : undefined,
      OR: search
        ? [
            { email: { contains: search, mode: 'insensitive' } },
            { phoneNumber: { contains: search, mode: 'insensitive' } },
            {
              profile: {
                is: {
                  displayName: { contains: search, mode: 'insensitive' },
                },
              },
            },
            {
              profile: {
                is: {
                  publicHandle: { contains: search, mode: 'insensitive' },
                },
              },
            },
          ]
        : undefined,
    });

    const users = await this.prisma.user.findMany({
      where,
      take: pagination.takeForQuery,
      ...pagination.cursorArgs,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        phoneNumber: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        profile: {
          select: {
            displayName: true,
            publicHandle: true,
          },
        },
        authAccounts: {
          select: {
            provider: true,
            lastLoginAt: true,
            createdAt: true,
          },
        },
        walletAccounts: {
          select: {
            currencyCode: true,
            status: true,
            cachedBalance: true,
          },
        },
        _count: {
          select: {
            refreshTokens: {
              where: {
                revokedAt: null,
                expiresAt: { gt: new Date() },
              },
            },
            paymentOrders: true,
            communityPosts: true,
            communityReports: true,
            artistFollows: true,
            followingUsers: true,
            followers: true,
          },
        },
      },
    });
    const page = this.paginated(users, pagination.take);
    const userIds = page.items.map((user) => user.id);
    const [reportsAgainstPosts, userAuditEvents, recentPayments] = await Promise.all([
      userIds.length
        ? this.prisma.communityReport.findMany({
            where: {
              post: {
                authorUserId: { in: userIds },
              },
            },
            select: {
              id: true,
              status: true,
              reason: true,
              createdAt: true,
              post: {
                select: {
                  authorUserId: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          })
        : [],
      userIds.length
        ? this.prisma.auditEvent.findMany({
            where: {
              targetType: 'user',
              targetId: { in: userIds },
            },
            orderBy: { createdAt: 'desc' },
            take: Math.max(20, userIds.length * 5),
            include: {
              actorUser: {
                select: { id: true, email: true },
              },
            },
          })
        : [],
      userIds.length
        ? this.prisma.paymentOrder.findMany({
            where: {
              userId: { in: userIds },
            },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              userId: true,
              orderNo: true,
              provider: true,
              status: true,
              amount: true,
              currency: true,
              createdAt: true,
            },
            take: Math.max(20, userIds.length * 3),
          })
        : [],
    ]);
    const reportStats = this.userReportStats(reportsAgainstPosts);
    const auditStats = this.userAuditStats(userAuditEvents);
    const paymentStats = this.userPaymentStats(recentPayments);
    const items = page.items.map((user) => {
      const wallet = user.walletAccounts.find((account) => account.currencyCode === 'LUMINA');
      const latestLoginAt = this.latestLoginAt(user.authAccounts);
      const reports = reportStats.get(user.id) ?? {
        total: 0,
        open: 0,
        latestReason: null,
        latestAt: null,
      };
      const audit = auditStats.get(user.id) ?? {
        sanctionCount: 0,
        recentAction: null,
      };
      const payments = paymentStats.get(user.id) ?? {
        paidCount: 0,
        paidAmountKrw: new Decimal(0),
        lastOrder: null,
      };

      return {
        id: user.id,
        userId: user.id,
        email: user.email,
        phoneNumber: user.phoneNumber,
        status: user.status,
        displayName: user.profile?.displayName ?? null,
        publicHandle: user.profile?.publicHandle ?? null,
        loginType: this.primaryLoginType(user.authAccounts),
        loginTypes: user.authAccounts.map((account) => account.provider),
        walletBalanceLumina: wallet?.cachedBalance ?? new Decimal(0),
        walletStatus: wallet?.status ?? null,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        deletedAt: user.deletedAt,
        lastSeenAt: latestLoginAt,
        activeSessionCount: user._count.refreshTokens,
        paymentCount: user._count.paymentOrders,
        paidOrderCount: payments.paidCount,
        paidAmountKrw: payments.paidAmountKrw,
        lastPaymentOrder: payments.lastOrder,
        authoredPostCount: user._count.communityPosts,
        reportSubmittedCount: user._count.communityReports,
        reportCount: reports.total,
        openReportCount: reports.open,
        latestReportReason: reports.latestReason,
        latestReportAt: reports.latestAt,
        sanctionCount: audit.sanctionCount,
        recentAction: audit.recentAction,
        followingArtistCount: user._count.artistFollows,
        followingUserCount: user._count.followingUsers,
        followerCount: user._count.followers,
      };
    });

    return {
      generatedAt: new Date(),
      ...page,
      items,
      summary: {
        suspendedInPage: items.filter((item) => item.status === 'suspended').length,
        deletedInPage: items.filter((item) => item.deletedAt).length,
        openReportsInPage: items.reduce((sum, item) => sum + item.openReportCount, 0),
        activeSessionsInPage: items.reduce((sum, item) => sum + item.activeSessionCount, 0),
      },
      policy: {
        route: '/backstage/users',
        dangerActions: ['suspend', 'restore', 'delete', 'revoke_sessions'],
        reasonRequiredByUi: true,
        settlementFieldsIncluded: false,
      },
    };
  }

  async getBackstageSettlementPreview(query: AuditQuery) {
    const pagination = this.adminPagination(query, 20);
    const search = this.optionalString(query, 'query') ?? this.optionalString(query, 'q');
    const status = this.optionalString(query, 'status');
    const period = this.settlementPeriod(query);
    const policy = this.settlementPolicy(query);
    const where: Prisma.ArtistWhereInput = this.clean({
      status,
      OR: search
        ? [
            { displayName: { contains: search, mode: 'insensitive' } },
            { slug: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    });
    const artists = await this.prisma.artist.findMany({
      where,
      take: pagination.takeForQuery,
      ...pagination.cursorArgs,
      orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        slug: true,
        displayName: true,
        status: true,
        artistOperators: {
          where: { status: 'active' },
          select: {
            role: true,
            user: {
              select: {
                id: true,
                email: true,
                profile: {
                  select: {
                    displayName: true,
                    publicHandle: true,
                  },
                },
              },
            },
          },
          take: 3,
        },
      },
    });
    const page = this.paginated(artists, pagination.take);
    const artistIds = page.items.map((artist) => artist.id);
    const [chatOrders, giftOrders, boostEvents, premiumUnlocks] = await Promise.all([
      artistIds.length
        ? this.prisma.chatFeatureOrder.findMany({
            where: {
              artistId: { in: artistIds },
              status: 'completed',
              createdAt: { gte: period.start, lt: period.end },
            },
            include: {
              chatFeatureProduct: {
                select: { id: true, sku: true, name: true, priceLumina: true },
              },
            },
          })
        : [],
      artistIds.length
        ? this.prisma.giftOrder.findMany({
            where: {
              artistId: { in: artistIds },
              status: 'completed',
              createdAt: { gte: period.start, lt: period.end },
            },
            include: {
              giftProduct: {
                select: { id: true, sku: true, name: true, priceLumina: true },
              },
            },
          })
        : [],
      artistIds.length
        ? this.prisma.artistBoostEvent.findMany({
            where: {
              artistId: { in: artistIds },
              boostType: 'lumina_boost',
              createdAt: { gte: period.start, lt: period.end },
            },
            include: {
              boostProduct: {
                select: { id: true, sku: true, name: true, priceLumina: true },
              },
            },
          })
        : [],
      artistIds.length
        ? this.prisma.userPremiumVideoUnlock.findMany({
            where: {
              unlockedAt: { gte: period.start, lt: period.end },
              premiumVideoProduct: {
                artistId: { in: artistIds },
              },
            },
            include: {
              premiumVideoProduct: {
                select: {
                  id: true,
                  artistId: true,
                  sku: true,
                  title: true,
                  priceLumina: true,
                },
              },
            },
          })
        : [],
    ]);
    const revenueByArtist = new Map<string, ReturnType<typeof this.emptyRevenueBucket>>();

    for (const artistId of artistIds) {
      revenueByArtist.set(artistId, this.emptyRevenueBucket());
    }

    for (const order of chatOrders) {
      this.addRevenueEvent(
        revenueByArtist,
        order.artistId,
        'chat',
        order.chatFeatureProduct.priceLumina,
        policy.unitPriceKrw,
      );
    }

    for (const order of giftOrders) {
      this.addRevenueEvent(
        revenueByArtist,
        order.artistId,
        'gift',
        order.totalLumina,
        policy.unitPriceKrw,
      );
    }

    for (const event of boostEvents) {
      this.addRevenueEvent(
        revenueByArtist,
        event.artistId,
        'paid_like',
        event.rawAmount,
        policy.unitPriceKrw,
      );
    }

    for (const unlock of premiumUnlocks) {
      const artistId = unlock.premiumVideoProduct.artistId;
      if (artistId) {
        this.addRevenueEvent(
          revenueByArtist,
          artistId,
          'premium_video',
          unlock.premiumVideoProduct.priceLumina,
          policy.unitPriceKrw,
        );
      }
    }

    const settlementRecords = await this.settlementRecordsForKeys(
      artistIds.map((artistId) => this.settlementKey('artist', artistId, period.label)),
    );
    const items = page.items.map((artist) => {
      const bucket = revenueByArtist.get(artist.id) ?? this.emptyRevenueBucket();
      const financials = this.settlementFinancials(bucket.totalLumina, policy);
      const settlementKey = this.settlementKey('artist', artist.id, period.label);
      const manualSettlement = this.settlementRecordSummary(
        settlementRecords.get(settlementKey),
      );
      return {
        settlementKey,
        artist: {
          id: artist.id,
          slug: artist.slug,
          displayName: artist.displayName,
          status: artist.status,
        },
        creators: artist.artistOperators.map((operator) => ({
          role: operator.role,
          userId: operator.user.id,
          email: this.maskEmail(operator.user.email),
          displayName: operator.user.profile?.displayName ?? null,
          publicHandle: operator.user.profile?.publicHandle ?? null,
        })),
        period: period.label,
        eventCount: bucket.eventCount,
        grossLumina: bucket.totalLumina,
        productBreakdown: bucket.breakdown,
        financials,
        status: manualSettlement?.status ?? (bucket.eventCount > 0 ? 'estimated' : 'no_revenue'),
        holdReason: manualSettlement?.reason ?? null,
        manualSettlement,
        payoutEligibility: this.payoutEligibility({
          eventCount: bucket.eventCount,
          manualSettlement,
        }),
      };
    });
    const totals = items.reduce(
      (acc, item) => ({
        eventCount: acc.eventCount + item.eventCount,
        grossLumina: acc.grossLumina.plus(item.grossLumina),
        grossRevenueKrw: acc.grossRevenueKrw.plus(item.financials.grossRevenueKrw),
        netRevenueKrw: acc.netRevenueKrw.plus(item.financials.netRevenueKrw),
        creatorShareKrw: acc.creatorShareKrw.plus(item.financials.creatorShareKrw),
        platformShareKrw: acc.platformShareKrw.plus(item.financials.platformShareKrw),
        riskReserveKrw: acc.riskReserveKrw.plus(item.financials.riskReserveKrw),
      }),
      {
        eventCount: 0,
        grossLumina: new Decimal(0),
        grossRevenueKrw: new Decimal(0),
        netRevenueKrw: new Decimal(0),
        creatorShareKrw: new Decimal(0),
        platformShareKrw: new Decimal(0),
        riskReserveKrw: new Decimal(0),
      },
    );

    return {
      generatedAt: new Date(),
      period,
      policy,
      ...page,
      items,
      totals,
      notice:
        'Estimated only. Final payout requires normalized creator revenue events, refund/chargeback checks, policy review, tax/accounting confirmation, and admin confirmation.',
    };
  }

  async getBackstagePartnerSettlementPreview(query: AuditQuery) {
    const pagination = this.adminPagination(query, 20);
    const search = this.optionalString(query, 'query') ?? this.optionalString(query, 'q');
    const status = this.optionalString(query, 'status');
    const artistStatus = this.optionalString(query, 'artistStatus');
    const period = this.settlementPeriod(query);
    const policy = this.settlementPolicy(query);
    const where: Prisma.UserWhereInput = this.clean({
      status,
      artistOperators: {
        some: {
          status: 'active',
          artist: this.clean({
            status: artistStatus,
          }),
        },
      },
      OR: search
        ? [
            { email: { contains: search, mode: 'insensitive' } },
            { profile: { displayName: { contains: search, mode: 'insensitive' } } },
            { profile: { publicHandle: { contains: search, mode: 'insensitive' } } },
            {
              artistOperators: {
                some: {
                  artist: {
                    OR: [
                      { displayName: { contains: search, mode: 'insensitive' } },
                      { slug: { contains: search, mode: 'insensitive' } },
                    ],
                  },
                },
              },
            },
          ]
        : undefined,
    });
    const partners = await this.prisma.user.findMany({
      where,
      take: pagination.takeForQuery,
      ...pagination.cursorArgs,
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        email: true,
        status: true,
        createdAt: true,
        profile: {
          select: {
            displayName: true,
            publicHandle: true,
          },
        },
        artistOperators: {
          where: {
            status: 'active',
            artist: this.clean({
              status: artistStatus,
            }),
          },
          select: {
            role: true,
            artist: {
              select: {
                id: true,
                slug: true,
                displayName: true,
                status: true,
                sortOrder: true,
              },
            },
          },
          orderBy: [{ artist: { sortOrder: 'asc' } }, { createdAt: 'asc' }],
        },
      },
    });
    const page = this.paginated(partners, pagination.take);
    const partnerIds = page.items.map((partner) => partner.id);
    const artistIds = [
      ...new Set(
        page.items.flatMap((partner) =>
          partner.artistOperators.map((operator) => operator.artist.id),
        ),
      ),
    ];
    const [chatOrders, giftOrders, boostEvents, premiumUnlocks, pendingApplicationCounts] =
      await Promise.all([
        artistIds.length
          ? this.prisma.chatFeatureOrder.findMany({
              where: {
                artistId: { in: artistIds },
                status: 'completed',
                createdAt: { gte: period.start, lt: period.end },
              },
              include: {
                chatFeatureProduct: {
                  select: { id: true, sku: true, name: true, priceLumina: true },
                },
              },
            })
          : [],
        artistIds.length
          ? this.prisma.giftOrder.findMany({
              where: {
                artistId: { in: artistIds },
                status: 'completed',
                createdAt: { gte: period.start, lt: period.end },
              },
              include: {
                giftProduct: {
                  select: { id: true, sku: true, name: true, priceLumina: true },
                },
              },
            })
          : [],
        artistIds.length
          ? this.prisma.artistBoostEvent.findMany({
              where: {
                artistId: { in: artistIds },
                boostType: 'lumina_boost',
                createdAt: { gte: period.start, lt: period.end },
              },
              include: {
                boostProduct: {
                  select: { id: true, sku: true, name: true, priceLumina: true },
                },
              },
            })
          : [],
        artistIds.length
          ? this.prisma.userPremiumVideoUnlock.findMany({
              where: {
                unlockedAt: { gte: period.start, lt: period.end },
                premiumVideoProduct: {
                  artistId: { in: artistIds },
                },
              },
              include: {
                premiumVideoProduct: {
                  select: {
                    id: true,
                    artistId: true,
                    sku: true,
                    title: true,
                    priceLumina: true,
                  },
                },
              },
            })
          : [],
        partnerIds.length
          ? this.prisma.debutApplication.groupBy({
              by: ['userId'],
              where: {
                userId: { in: partnerIds },
                status: { in: ['submitted', 'reviewing', 'under_review', 'needs_more_info'] },
              },
              _count: { _all: true },
            })
          : [],
      ]);
    const revenueByArtist = new Map<string, ReturnType<typeof this.emptyRevenueBucket>>();

    for (const artistId of artistIds) {
      revenueByArtist.set(artistId, this.emptyRevenueBucket());
    }

    for (const order of chatOrders) {
      this.addRevenueEvent(
        revenueByArtist,
        order.artistId,
        'chat',
        order.chatFeatureProduct.priceLumina,
        policy.unitPriceKrw,
      );
    }

    for (const order of giftOrders) {
      this.addRevenueEvent(
        revenueByArtist,
        order.artistId,
        'gift',
        order.totalLumina,
        policy.unitPriceKrw,
      );
    }

    for (const event of boostEvents) {
      this.addRevenueEvent(
        revenueByArtist,
        event.artistId,
        'paid_like',
        event.rawAmount,
        policy.unitPriceKrw,
      );
    }

    for (const unlock of premiumUnlocks) {
      const artistId = unlock.premiumVideoProduct.artistId;
      if (artistId) {
        this.addRevenueEvent(
          revenueByArtist,
          artistId,
          'premium_video',
          unlock.premiumVideoProduct.priceLumina,
          policy.unitPriceKrw,
        );
      }
    }

    const pendingApplicationsByPartner = new Map(
      pendingApplicationCounts.map((entry) => [entry.userId, entry._count._all]),
    );
    const partnerSettlementRecords = await this.settlementRecordsForKeys(
      page.items.map((partner) => this.settlementKey('partner', partner.id, period.label)),
    );
    const items = page.items.map((partner) => {
      const artists = partner.artistOperators.map((operator) => {
        const bucket =
          revenueByArtist.get(operator.artist.id) ?? this.emptyRevenueBucket();
        const financials = this.settlementFinancials(bucket.totalLumina, policy);
        return {
          artist: {
            id: operator.artist.id,
            slug: operator.artist.slug,
            displayName: operator.artist.displayName,
            status: operator.artist.status,
          },
          role: operator.role,
          eventCount: bucket.eventCount,
          grossLumina: bucket.totalLumina,
          productBreakdown: bucket.breakdown,
          financials,
          status: bucket.eventCount > 0 ? 'estimated' : 'no_revenue',
          holdReason: null,
        };
      });
      const totals = artists.reduce(
        (acc, item) => ({
          eventCount: acc.eventCount + item.eventCount,
          grossLumina: acc.grossLumina.plus(item.grossLumina),
          grossRevenueKrw: acc.grossRevenueKrw.plus(item.financials.grossRevenueKrw),
          netRevenueKrw: acc.netRevenueKrw.plus(item.financials.netRevenueKrw),
          creatorShareKrw: acc.creatorShareKrw.plus(item.financials.creatorShareKrw),
          platformShareKrw: acc.platformShareKrw.plus(item.financials.platformShareKrw),
          riskReserveKrw: acc.riskReserveKrw.plus(item.financials.riskReserveKrw),
        }),
        {
          eventCount: 0,
          grossLumina: new Decimal(0),
          grossRevenueKrw: new Decimal(0),
          netRevenueKrw: new Decimal(0),
          creatorShareKrw: new Decimal(0),
          platformShareKrw: new Decimal(0),
          riskReserveKrw: new Decimal(0),
        },
      );
      const approvedArtistCount = artists.filter(
        (item) => item.artist.status === 'active',
      ).length;
      const settlementKey = this.settlementKey('partner', partner.id, period.label);
      const manualSettlement = this.settlementRecordSummary(
        partnerSettlementRecords.get(settlementKey),
      );

      return {
        settlementKey,
        partner: {
          userId: partner.id,
          email: this.maskEmail(partner.email),
          displayName: partner.profile?.displayName ?? null,
          publicHandle: partner.profile?.publicHandle ?? null,
          status: partner.status,
          createdAt: partner.createdAt,
        },
        period: period.label,
        operatedArtistCount: artists.length,
        approvedArtistCount,
        pendingArtistApplicationCount:
          pendingApplicationsByPartner.get(partner.id) ?? 0,
        artists,
        totals,
        payoutStatus:
          manualSettlement?.status ?? (totals.eventCount > 0 ? 'estimated' : 'no_revenue'),
        payoutHoldReason: manualSettlement?.reason ?? null,
        lastSettlementAt: manualSettlement?.updatedAt ?? null,
        manualSettlement,
        payoutEligibility: this.payoutEligibility({
          eventCount: totals.eventCount,
          manualSettlement,
        }),
      };
    });
    const totals = items.reduce(
      (acc, item) => ({
        partnerCount: acc.partnerCount + 1,
        operatedArtistCount: acc.operatedArtistCount + item.operatedArtistCount,
        approvedArtistCount: acc.approvedArtistCount + item.approvedArtistCount,
        pendingArtistApplicationCount:
          acc.pendingArtistApplicationCount + item.pendingArtistApplicationCount,
        eventCount: acc.eventCount + item.totals.eventCount,
        grossLumina: acc.grossLumina.plus(item.totals.grossLumina),
        grossRevenueKrw: acc.grossRevenueKrw.plus(item.totals.grossRevenueKrw),
        netRevenueKrw: acc.netRevenueKrw.plus(item.totals.netRevenueKrw),
        creatorShareKrw: acc.creatorShareKrw.plus(item.totals.creatorShareKrw),
        platformShareKrw: acc.platformShareKrw.plus(item.totals.platformShareKrw),
        riskReserveKrw: acc.riskReserveKrw.plus(item.totals.riskReserveKrw),
      }),
      {
        partnerCount: 0,
        operatedArtistCount: 0,
        approvedArtistCount: 0,
        pendingArtistApplicationCount: 0,
        eventCount: 0,
        grossLumina: new Decimal(0),
        grossRevenueKrw: new Decimal(0),
        netRevenueKrw: new Decimal(0),
        creatorShareKrw: new Decimal(0),
        platformShareKrw: new Decimal(0),
        riskReserveKrw: new Decimal(0),
      },
    );

    return {
      generatedAt: new Date(),
      period,
      policy,
      ...page,
      items,
      totals,
      policyNotes: {
        route: '/backstage/settlements/partners',
        payoutUnit: 'partner_user',
        detailUnit: 'artist',
        previewOnly: true,
        initialCandidateSlotLimit: 10,
        additionalSlotUnit: 5,
      },
      notice:
        'Estimated only. Partner payout groups multiple artist details by operator account. Final payout requires refund/chargeback checks, tax/accounting confirmation, payout account verification, and admin confirmation.',
    };
  }

  async updateBackstageSettlementStatus(
    user: AuthUser,
    settlementKey: string,
    input: AdminPayload,
  ) {
    this.assertSettlementOperator(user);

    const parsedKey = this.parseSettlementKey(settlementKey);
    const status = this.settlementStatus(input, 'status');
    const reason = this.string(input, 'reason');
    const note = this.optionalString(input, 'note') ?? null;
    const paidAt = input.paidAt === undefined ? null : this.date(input, 'paidAt');
    const paymentMethod = this.optionalString(input, 'paymentMethod') ?? null;
    const payoutReference = this.optionalString(input, 'payoutReference') ?? null;
    const amountKrw = this.optionalDecimal(input, 'amountKrw');
    const eligibilityOverrideConfirmed = this.boolean(
      input,
      'eligibilityOverrideConfirmed',
      false,
    );

    if (status === 'paid' && amountKrw === undefined) {
      throw new BadRequestException('amountKrw is required when status is paid');
    }

    if (status === 'paid' && !eligibilityOverrideConfirmed) {
      throw new BadRequestException(
        'eligibilityOverrideConfirmed must be true until identity and payout account verification models are connected',
      );
    }

    const before = await this.prisma.settlementRecord.findUnique({
      where: { settlementKey },
    });

    if (before?.status === 'paid' && status === 'paid') {
      throw new BadRequestException('Settlement is already marked paid');
    }

    const metadata = this.toJson({
      ...(before ? this.metadataObject(before.metadata) : {}),
      eligibilityOverrideConfirmed,
      eligibilityPolicy:
        'manual_v1_requires_accounting_confirmation_until_identity_payout_models_are_connected',
      lastChangedBy: user.id,
      lastChangedAt: new Date().toISOString(),
    });
    const data = {
      settlementType: parsedKey.type,
      period: parsedKey.period,
      artistId: parsedKey.type === 'artist' ? parsedKey.id : null,
      partnerUserId: parsedKey.type === 'partner' ? parsedKey.id : null,
      status,
      amountKrw,
      reason,
      note,
      paidAt: status === 'paid' ? paidAt ?? new Date() : paidAt,
      paymentMethod,
      payoutReference,
      metadata,
      updatedByUserId: user.id,
      updatedAt: new Date(),
    };
    const record = await this.prisma.settlementRecord.upsert({
      where: { settlementKey },
      create: {
        settlementKey,
        ...data,
        createdByUserId: user.id,
      },
      update: data,
    });

    await this.prisma.auditEvent.create({
      data: {
        actorUserId: user.id,
        actorType: 'admin',
        action: 'settlement.status.update',
        targetType: 'settlement_record',
        targetId: record.id,
        beforeData: this.toJson(before),
        afterData: this.toJson(record),
        metadata: this.toJson({
          settlementKey,
          settlementType: parsedKey.type,
          period: parsedKey.period,
          status,
        }),
      },
    });

    return {
      ok: true,
      record: this.settlementRecordSummary(record),
      policy: {
        manualOnly: true,
        moneyTransfer: false,
        requiresExternalAccountingAction: true,
      },
    };
  }

  async getBackstageSettlements(query: AuditQuery) {
    const pagination = this.adminPagination(query, 20);
    const period = this.optionalString(query, 'period');
    const status = this.optionalString(query, 'status');
    const type = this.optionalString(query, 'type');
    const search = this.optionalString(query, 'query') ?? this.optionalString(query, 'q');

    if (period && !/^\d{4}-\d{2}$/.test(period)) {
      throw new BadRequestException('period must be YYYY-MM');
    }

    if (status && !SETTLEMENT_STATUSES.has(status)) {
      throw new BadRequestException(
        'status must be estimated, ready, hold, paid, recheck, or cancelled',
      );
    }

    if (type && !SETTLEMENT_TYPES.has(type)) {
      throw new BadRequestException('type must be artist or partner');
    }

    const where: Prisma.SettlementRecordWhereInput = this.clean({
      period,
      status,
      settlementType: type,
      OR: search
        ? [
            { settlementKey: { contains: search, mode: 'insensitive' } },
            { reason: { contains: search, mode: 'insensitive' } },
            { note: { contains: search, mode: 'insensitive' } },
            { payoutReference: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    });
    const records = await this.prisma.settlementRecord.findMany({
      where,
      take: pagination.takeForQuery,
      ...pagination.cursorArgs,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    const page = this.paginated(records, pagination.take);
    const items = page.items.map((record) => this.settlementRecordSummary(record));
    const statusCounts = await this.prisma.settlementRecord.groupBy({
      by: ['status'],
      where: this.clean({
        period,
        settlementType: type,
      }),
      _count: { _all: true },
    });

    return {
      generatedAt: new Date(),
      ...page,
      items,
      summary: {
        period: period ?? null,
        type: type ?? null,
        statusCounts: Object.fromEntries(
          statusCounts.map((entry) => [entry.status, entry._count._all]),
        ),
      },
      policy: {
        manualOnly: true,
        moneyTransfer: false,
        settlementKeyFormat: ['artist:<artistId>:YYYY-MM', 'partner:<partnerUserId>:YYYY-MM'],
      },
    };
  }

  async createAdminUser(user: AuthUser, input: AdminPayload) {
    this.assertSuperAdmin(user);

    const targetUser = await this.findAdminTargetUser(input);
    const existing = await this.prisma.adminUser.findUnique({
      where: { userId: targetUser.id },
    });

    if (existing) {
      throw new ConflictException('User is already an admin');
    }

    const role = await this.findAdminRole(this.string(input, 'roleName', 'content_admin'));
    const adminUser = await this.prisma.adminUser.create({
      data: {
        userId: targetUser.id,
        roleId: role.id,
        status: this.adminStatus(input, 'status', 'active'),
        createdByUserId: user.id,
      },
      include: {
        role: true,
        user: {
          select: {
            id: true,
            email: true,
            status: true,
          },
        },
      },
    });

    await this.recordAudit(
      user,
      'admin_user.create',
      'admin_user',
      adminUser.id,
      null,
      adminUser,
    );

    return adminUser;
  }

  async updateAdminUser(user: AuthUser, adminUserId: string, input: AdminPayload) {
    this.assertSuperAdmin(user);

    const before = await this.prisma.adminUser.findUnique({
      where: { id: adminUserId },
      include: { role: true, user: true },
    });

    if (!before) {
      throw new NotFoundException('Admin user not found');
    }

    const nextStatus =
      input.status === undefined ? undefined : this.adminStatus(input, 'status');

    if (before.userId === user.id && nextStatus && nextStatus !== 'active') {
      throw new BadRequestException('You cannot deactivate your own admin access');
    }

    const roleName = this.optionalString(input, 'roleName');
    const role = roleName ? await this.findAdminRole(roleName) : null;
    const adminUser = await this.prisma.adminUser.update({
      where: { id: adminUserId },
      data: this.clean({
        roleId: role?.id,
        status: nextStatus,
        updatedAt: new Date(),
      }),
      include: {
        role: true,
        user: {
          select: {
            id: true,
            email: true,
            status: true,
          },
        },
      },
    });

    await this.recordAudit(
      user,
      'admin_user.update',
      'admin_user',
      adminUser.id,
      before,
      adminUser,
    );

    return adminUser;
  }

  getAuditEvents(query: AuditQuery) {
    const pagination = this.adminPagination(query);
    const search = this.optionalString(query, 'query') ?? this.optionalString(query, 'q');
    const where: Prisma.AuditEventWhereInput = this.clean({
      actorUserId: this.optionalString(query, 'actorUserId'),
      action: this.optionalString(query, 'action'),
      targetType: this.optionalString(query, 'targetType'),
      targetId: this.optionalString(query, 'targetId'),
      OR: search
        ? [
            { action: { contains: search, mode: 'insensitive' } },
            { targetType: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    });

    return this.prisma.auditEvent
      .findMany({
      where,
      take: pagination.takeForQuery,
      ...pagination.cursorArgs,
      orderBy: { createdAt: 'desc' },
      include: {
        actorUser: {
          select: { id: true, email: true, status: true },
        },
      },
      })
      .then((rows) => this.paginated(rows, pagination.take));
  }

  getUsers(query: AuditQuery) {
    const pagination = this.adminPagination(query);
    const email = this.optionalString(query, 'email');
    const search = this.optionalString(query, 'query') ?? this.optionalString(query, 'q');
    const status = this.optionalString(query, 'status');
    const where: Prisma.UserWhereInput = this.clean({
      status,
      email: email
        ? {
            contains: email,
            mode: 'insensitive',
          }
        : undefined,
      OR: search
        ? [
            { email: { contains: search, mode: 'insensitive' } },
            { phoneNumber: { contains: search, mode: 'insensitive' } },
            {
              profile: {
                is: {
                  displayName: { contains: search, mode: 'insensitive' },
                },
              },
            },
            {
              profile: {
                is: {
                  publicHandle: { contains: search, mode: 'insensitive' },
                },
              },
            },
          ]
        : undefined,
    });

    return this.prisma.user
      .findMany({
      where,
      take: pagination.takeForQuery,
      ...pagination.cursorArgs,
      orderBy: { createdAt: 'desc' },
      select: this.userModerationSelect(),
      })
      .then((rows) => this.paginated(rows, pagination.take));
  }

  async getUser(userId: string) {
    const user = await this.findUserForModeration(userId);
    return user;
  }

  async suspendUser(user: AuthUser, userId: string, input: AdminPayload) {
    this.assertNotSelf(user, userId);

    const before = await this.findUserForModeration(userId);

    if (before.deletedAt || before.status === 'deleted') {
      throw new BadRequestException('Deleted user cannot be suspended');
    }

    const now = new Date();
    const [updatedUser, revokedSessions] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          status: 'suspended',
          updatedAt: now,
        },
        select: this.userModerationSelect(),
      }),
      this.prisma.userRefreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: { revokedAt: now },
      }),
    ]);

    await this.recordAudit(
      user,
      'user.suspend',
      'user',
      updatedUser.id,
      before,
      updatedUser,
      { reason: this.optionalString(input, 'reason'), revokedSessionCount: revokedSessions.count },
    );

    return {
      ok: true,
      user: updatedUser,
      revokedSessionCount: revokedSessions.count,
    };
  }

  async restoreUser(user: AuthUser, userId: string, input: AdminPayload) {
    const before = await this.findUserForModeration(userId);
    const now = new Date();
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: 'active',
        deletedAt: null,
        updatedAt: now,
      },
      select: this.userModerationSelect(),
    });

    await this.recordAudit(
      user,
      'user.restore',
      'user',
      updatedUser.id,
      before,
      updatedUser,
      { reason: this.optionalString(input, 'reason') },
    );

    return {
      ok: true,
      user: updatedUser,
    };
  }

  async deleteUser(user: AuthUser, userId: string, input: AdminPayload) {
    this.assertNotSelf(user, userId);

    const before = await this.findUserForModeration(userId);
    const now = new Date();
    const [updatedUser, revokedSessions] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          status: 'deleted',
          deletedAt: now,
          updatedAt: now,
        },
        select: this.userModerationSelect(),
      }),
      this.prisma.userRefreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: { revokedAt: now },
      }),
      this.prisma.userActionToken.updateMany({
        where: {
          userId,
          consumedAt: null,
        },
        data: { consumedAt: now },
      }),
      this.prisma.userReferralCode.updateMany({
        where: {
          userId,
          status: 'active',
        },
        data: {
          status: 'inactive',
          updatedAt: now,
        },
      }),
    ]);

    await this.recordAudit(
      user,
      'user.delete',
      'user',
      updatedUser.id,
      before,
      updatedUser,
      { reason: this.optionalString(input, 'reason'), revokedSessionCount: revokedSessions.count },
    );

    return {
      ok: true,
      user: updatedUser,
      revokedSessionCount: revokedSessions.count,
    };
  }

  async revokeUserSessions(user: AuthUser, userId: string, input: AdminPayload) {
    this.assertNotSelf(user, userId);

    const before = await this.findUserForModeration(userId);
    const now = new Date();
    const revokedSessions = await this.prisma.userRefreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        revokedAt: now,
      },
    });
    const after = await this.findUserForModeration(userId);

    await this.recordAudit(
      user,
      'user.sessions.revoke',
      'user',
      userId,
      before,
      after,
      {
        reason: this.optionalString(input, 'reason'),
        revokedSessionCount: revokedSessions.count,
      },
    );

    return {
      ok: true,
      user: after,
      revokedSessionCount: revokedSessions.count,
    };
  }

  getPaymentOrders(query: AuditQuery) {
    const pagination = this.adminPagination(query);
    const orderNo = this.optionalString(query, 'orderNo');
    const search = this.optionalString(query, 'query') ?? this.optionalString(query, 'q');
    const where: Prisma.PaymentOrderWhereInput = this.clean({
      userId: this.optionalString(query, 'userId'),
      provider: this.optionalString(query, 'provider'),
      status: this.optionalString(query, 'status'),
      orderNo: orderNo
        ? {
            contains: orderNo,
            mode: 'insensitive',
          }
        : undefined,
      OR: search
        ? [
            { orderNo: { contains: search, mode: 'insensitive' } },
            { provider: { contains: search, mode: 'insensitive' } },
            { user: { email: { contains: search, mode: 'insensitive' } } },
          ]
        : undefined,
    });

    return this.prisma.paymentOrder
      .findMany({
      where,
      take: pagination.takeForQuery,
      ...pagination.cursorArgs,
      orderBy: { createdAt: 'desc' },
      include: this.paymentOrderInclude(),
      })
      .then((rows) => this.paginated(rows, pagination.take));
  }

  async getPaymentOrder(orderId: string) {
    const order = await this.prisma.paymentOrder.findFirst({
      where: this.paymentOrderLookupWhere(orderId),
      include: this.paymentOrderInclude(),
    });

    if (!order) {
      throw new NotFoundException('Payment order not found');
    }

    return order;
  }

  async createPaymentRefund(user: AuthUser, orderId: string, input: AdminPayload) {
    const refund = await this.prisma.$transaction(async (tx) => {
      const order = await tx.paymentOrder.findFirst({
        where: this.paymentOrderLookupWhere(orderId),
        include: {
          luminaProduct: true,
          refunds: true,
        },
      });

      if (!order) {
        throw new NotFoundException('Payment order not found');
      }

      if (order.status !== 'paid') {
        throw new BadRequestException('Only paid payment orders can be refunded');
      }

      const refundableAmount = this.refundablePaymentAmount(order);
      const amount =
        input.amount === undefined ? refundableAmount : this.decimal(input, 'amount');
      if (amount.lte(0)) {
        throw new BadRequestException('amount must be greater than zero');
      }

      if (amount.gt(refundableAmount)) {
        throw new BadRequestException('Refund amount exceeds refundable amount');
      }

      return tx.refundTransaction.create({
        data: {
          paymentOrderId: order.id,
          providerRefundId: this.optionalString(input, 'providerRefundId'),
          amount,
          reason: this.optionalString(input, 'reason'),
          status: this.refundStatus(input, 'status', 'requested'),
        },
        include: this.refundTransactionInclude(),
      });
    });

    await this.recordAudit(
      user,
      'payment_refund.create',
      'refund_transaction',
      refund.id,
      null,
      refund,
      {
        paymentOrderId: refund.paymentOrderId,
        orderNo: refund.paymentOrder.orderNo,
      },
    );

    return refund;
  }

  getRefundTransactions(query: AuditQuery) {
    const pagination = this.adminPagination(query);
    const search = this.optionalString(query, 'query') ?? this.optionalString(query, 'q');
    const where: Prisma.RefundTransactionWhereInput = this.clean({
      paymentOrderId: this.optionalString(query, 'paymentOrderId'),
      providerRefundId: this.optionalString(query, 'providerRefundId'),
      status: this.optionalString(query, 'status'),
      OR: search
        ? [
            { providerRefundId: { contains: search, mode: 'insensitive' } },
            { reason: { contains: search, mode: 'insensitive' } },
            {
              paymentOrder: {
                orderNo: { contains: search, mode: 'insensitive' },
              },
            },
            {
              paymentOrder: {
                user: { email: { contains: search, mode: 'insensitive' } },
              },
            },
          ]
        : undefined,
    });

    return this.prisma.refundTransaction
      .findMany({
      where,
      take: pagination.takeForQuery,
      ...pagination.cursorArgs,
      orderBy: { createdAt: 'desc' },
      include: this.refundTransactionInclude(),
      })
      .then((rows) => this.paginated(rows, pagination.take));
  }

  async updateRefundTransaction(user: AuthUser, refundId: string, input: AdminPayload) {
    const before = await this.prisma.refundTransaction.findUnique({
      where: { id: refundId },
      include: this.refundTransactionInclude(),
    });

    if (!before) {
      throw new NotFoundException('Refund transaction not found');
    }

    const nextStatus =
      input.status === undefined ? undefined : this.refundStatus(input, 'status');
    if (nextStatus && !['cancelled', 'failed'].includes(nextStatus)) {
      await this.ensureRefundStatusWithinPaymentAmount(before.paymentOrderId, refundId);
    }

    const refund = await this.prisma.refundTransaction.update({
      where: { id: refundId },
      data: this.clean({
        providerRefundId: this.optionalString(input, 'providerRefundId'),
        reason: this.optionalString(input, 'reason'),
        status: nextStatus,
        updatedAt: new Date(),
      }),
      include: this.refundTransactionInclude(),
    });

    await this.recordAudit(
      user,
      'payment_refund.update',
      'refund_transaction',
      refund.id,
      before,
      refund,
    );

    return refund;
  }

  async getAssets(query: AuditQuery) {
    const take = Math.max(1, Math.min(this.number(query, 'take', 50), 100));
    const where: Prisma.AssetWhereInput = this.clean({
      assetType: this.optionalString(query, 'assetType'),
      visibility: this.optionalString(query, 'visibility'),
      storageProvider: this.optionalString(query, 'storageProvider'),
    });
    const uploadStatus = this.optionalString(query, 'uploadStatus');
    const lifecycleStatus = this.optionalString(query, 'lifecycleStatus');

    const assets = await this.prisma.asset.findMany({
      where,
      take,
      orderBy: { createdAt: 'desc' },
      include: this.assetRelationInclude(),
    });

    return assets
      .map((asset) => this.presentAsset(asset))
      .filter((asset) => !uploadStatus || asset.uploadStatus === uploadStatus)
      .filter((asset) => !lifecycleStatus || asset.lifecycleStatus === lifecycleStatus);
  }

  async getAsset(assetId: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: this.assetRelationInclude(),
    });

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    return this.presentAsset(asset);
  }

  async createAsset(user: AuthUser, input: AdminPayload) {
    const asset = await this.prisma.asset.create({
      data: {
        assetType: this.string(input, 'assetType'),
        visibility: this.string(input, 'visibility', 'public'),
        storageProvider: this.string(input, 'storageProvider', 'local'),
        storageKey: this.string(input, 'storageKey'),
        mimeType: this.string(input, 'mimeType'),
        fileSizeBytes: this.optionalBigInt(input, 'fileSizeBytes'),
        width: this.optionalNumber(input, 'width'),
        height: this.optionalNumber(input, 'height'),
        durationSeconds: this.optionalDecimal(input, 'durationSeconds'),
        checksum: this.optionalString(input, 'checksum'),
        metadata: this.json(input, 'metadata'),
      },
    });

    await this.recordAudit(user, 'asset.create', 'asset', asset.id, null, asset);
    return asset;
  }

  async createAssetUploadIntent(user: AuthUser, input: AdminPayload) {
    const mimeType = this.allowedMimeType(this.string(input, 'mimeType'));
    const assetType = this.assetTypeFromInput(input, mimeType);
    const fileName = this.safeFileName(this.string(input, 'fileName'));
    const fileSizeBytes = this.fileSizeBytes(input, assetType);
    const visibility = this.visibility(input, 'visibility', 'public');
    const storageProvider = this.configService.get<string>('OBJECT_STORAGE_PROVIDER') ?? 'local';
    const storageKey = this.buildStorageKey(assetType, fileName);
    const expiresInSeconds = this.numberFromEnv('OBJECT_UPLOAD_INTENT_TTL_SECONDS', 900);
    const uploadUrl = this.buildUploadUrl(storageProvider, storageKey, expiresInSeconds);
    const publicUrl = this.buildPublicAssetUrl(storageKey);

    const asset = await this.prisma.asset.create({
      data: {
        assetType,
        visibility,
        storageProvider,
        storageKey,
        mimeType,
        fileSizeBytes,
        width: this.optionalNumber(input, 'width'),
        height: this.optionalNumber(input, 'height'),
        durationSeconds: this.optionalDecimal(input, 'durationSeconds'),
        checksum: this.optionalString(input, 'checksum'),
        metadata: this.toJson({
          ...this.json(input, 'metadata'),
          uploadIntent: {
            status: 'pending_upload',
            fileName,
            createdByUserId: user.id,
            createdAt: new Date().toISOString(),
          },
        }),
      },
    });

    const result = {
      asset,
      upload: {
        method: 'PUT',
        url: uploadUrl,
        publicUrl,
        storageProvider,
        storageKey,
        requiredHeaders: {
          'content-type': mimeType,
        },
        expiresInSeconds,
        mode: storageProvider === 'local' ? 'metadata_only' : 'direct_upload_ready',
      },
    };

    await this.recordAudit(
      user,
      'asset.upload_intent.create',
      'asset',
      asset.id,
      null,
      result,
    );
    return result;
  }

  async confirmAssetUpload(user: AuthUser, assetId: string, input: AdminPayload) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    const before = asset;
    await this.assertObjectUploaded(asset.storageProvider, asset.storageKey);

    const confirmedAt = new Date().toISOString();
    const metadata = this.metadataObject(asset.metadata);
    const uploadIntent = this.metadataObject(metadata.uploadIntent);
    const updatedMetadata = {
      ...metadata,
      uploadIntent: {
        ...uploadIntent,
        status: 'uploaded',
        confirmedByUserId: user.id,
        confirmedAt,
        objectETag: this.optionalString(input, 'objectETag'),
      },
    };

    const updatedAsset = await this.prisma.asset.update({
      where: { id: asset.id },
      data: {
        metadata: this.toJson(updatedMetadata),
        updatedAt: new Date(),
      },
    });

    const result = {
      asset: updatedAsset,
      upload: {
        status: 'uploaded',
        confirmedAt,
        publicUrl: this.buildPublicAssetUrl(updatedAsset.storageKey),
      },
    };

    await this.recordAudit(
      user,
      'asset.upload.confirm',
      'asset',
      updatedAsset.id,
      before,
      result,
    );

    return result;
  }

  async archiveAsset(user: AuthUser, assetId: string, input: AdminPayload) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: this.assetRelationInclude(),
    });

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    const linkedCount =
      asset.artistAssets.length + asset.shortformAssets.length + asset.premiumVideoAssets.length;
    const force = this.boolean(input, 'force', false);

    if (linkedCount > 0 && !force) {
      throw new BadRequestException('Asset must be unlinked before archive unless force is true');
    }

    const archivedAt = new Date().toISOString();
    const metadata = this.metadataObject(asset.metadata);
    const lifecycle = this.metadataObject(metadata.lifecycle);
    const updatedMetadata = {
      ...metadata,
      lifecycle: {
        ...lifecycle,
        status: 'archived',
        reason: this.optionalString(input, 'reason') ?? null,
        archivedByUserId: user.id,
        archivedAt,
      },
    };

    const updatedAsset = await this.prisma.asset.update({
      where: { id: asset.id },
      data: {
        metadata: this.toJson(updatedMetadata),
        updatedAt: new Date(),
      },
      include: this.assetRelationInclude(),
    });
    const result = this.presentAsset(updatedAsset);

    await this.recordAudit(
      user,
      'asset.archive',
      'asset',
      asset.id,
      this.presentAsset(asset),
      result,
      { force, linkedCount },
    );
    return result;
  }

  async restoreAsset(user: AuthUser, assetId: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: this.assetRelationInclude(),
    });

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    const restoredAt = new Date().toISOString();
    const metadata = this.metadataObject(asset.metadata);
    const lifecycle = this.metadataObject(metadata.lifecycle);
    const updatedMetadata = {
      ...metadata,
      lifecycle: {
        ...lifecycle,
        status: 'active',
        restoredByUserId: user.id,
        restoredAt,
      },
    };

    const updatedAsset = await this.prisma.asset.update({
      where: { id: asset.id },
      data: {
        metadata: this.toJson(updatedMetadata),
        updatedAt: new Date(),
      },
      include: this.assetRelationInclude(),
    });
    const result = this.presentAsset(updatedAsset);

    await this.recordAudit(
      user,
      'asset.restore',
      'asset',
      asset.id,
      this.presentAsset(asset),
      result,
    );
    return result;
  }

  async createArtist(user: AuthUser, input: AdminPayload) {
    const artist = await this.prisma.artist.create({
      data: {
        slug: this.string(input, 'slug'),
        displayName: this.string(input, 'displayName'),
        status: this.string(input, 'status', 'draft'),
        sortOrder: this.number(input, 'sortOrder', 0),
        launchedAt: this.optionalDate(input, 'launchedAt'),
      },
    });

    await this.upsertArtistProfiles(artist.id, input);
    const result = await this.getArtistWithProfiles(artist.id);
    await this.recordAudit(user, 'artist.create', 'artist', artist.id, null, result);
    return result;
  }

  async updateArtist(user: AuthUser, artistId: string, input: AdminPayload) {
    await this.ensureArtist(artistId);
    const before = await this.getArtistWithProfiles(artistId);
    await this.prisma.artist.update({
      where: { id: artistId },
      data: this.clean({
        slug: this.optionalString(input, 'slug'),
        displayName: this.optionalString(input, 'displayName'),
        status: this.optionalString(input, 'status'),
        sortOrder: this.optionalNumber(input, 'sortOrder'),
        launchedAt: this.optionalDate(input, 'launchedAt'),
        updatedAt: new Date(),
      }),
    });

    await this.upsertArtistProfiles(artistId, input);
    const result = await this.getArtistWithProfiles(artistId);
    await this.recordAudit(user, 'artist.update', 'artist', artistId, before, result);
    return result;
  }

  async getArtistOperators(artistId: string) {
    await this.ensureArtist(artistId);

    return this.prisma.artistOperator.findMany({
      where: { artistId },
      orderBy: { createdAt: 'desc' },
      include: this.artistOperatorInclude(),
    });
  }

  async createArtistOperator(user: AuthUser, artistId: string, input: AdminPayload) {
    await this.ensureArtist(artistId);
    const targetUser = await this.findAdminTargetUser(input);
    const permissions = this.optionalStringArray(input, 'permissions') ?? [
      'feed:post',
      'feed:reply',
    ];

    const operator = await this.prisma.artistOperator.upsert({
      where: {
        userId_artistId: {
          userId: targetUser.id,
          artistId,
        },
      },
      create: {
        userId: targetUser.id,
        artistId,
        role: this.string(input, 'role', 'owner'),
        status: this.artistOperatorStatus(input, 'status', 'active'),
        permissions,
      },
      update: {
        role: this.optionalString(input, 'role'),
        status: this.artistOperatorStatus(input, 'status', 'active'),
        permissions,
        revokedAt: null,
        updatedAt: new Date(),
      },
      include: this.artistOperatorInclude(),
    });

    await this.recordAudit(
      user,
      'artist_operator.upsert',
      'artist_operator',
      operator.id,
      null,
      operator,
      { artistId, targetUserId: targetUser.id },
    );

    return operator;
  }

  async updateArtistOperator(user: AuthUser, operatorId: string, input: AdminPayload) {
    const before = await this.prisma.artistOperator.findUnique({
      where: { id: operatorId },
      include: this.artistOperatorInclude(),
    });

    if (!before) {
      throw new NotFoundException('Artist operator not found');
    }

    const status =
      input.status === undefined ? undefined : this.artistOperatorStatus(input, 'status');
    const permissions = this.optionalStringArray(input, 'permissions');
    const revokedAt =
      status === 'revoked' || status === 'inactive'
        ? new Date()
        : status === 'active'
          ? null
          : undefined;

    const operator = await this.prisma.artistOperator.update({
      where: { id: operatorId },
      data: this.clean({
        role: this.optionalString(input, 'role'),
        status,
        permissions,
        revokedAt,
        updatedAt: new Date(),
      }),
      include: this.artistOperatorInclude(),
    });

    await this.recordAudit(
      user,
      'artist_operator.update',
      'artist_operator',
      operator.id,
      before,
      operator,
      { note: this.optionalString(input, 'note') },
    );

    return operator;
  }

  async linkArtistAsset(user: AuthUser, artistId: string, input: AdminPayload) {
    await this.ensureArtist(artistId);
    const asset = await this.ensureAssetLinkable(this.string(input, 'assetId'));
    const usageType = this.assetRole(input, 'usageType', 'cover');
    const isPrimary = this.boolean(input, 'isPrimary', false);
    const sortOrder = this.number(input, 'sortOrder', 0);

    const result = await this.prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.artistAsset.updateMany({
          where: { artistId, usageType },
          data: { isPrimary: false },
        });
      }

      return tx.artistAsset.upsert({
        where: {
          artistId_assetId_usageType: {
            artistId,
            assetId: asset.id,
            usageType,
          },
        },
        update: {
          isPrimary,
          sortOrder,
        },
        create: {
          artistId,
          assetId: asset.id,
          usageType,
          isPrimary,
          sortOrder,
        },
        include: { asset: true },
      });
    });

    await this.recordAudit(
      user,
      'artist_asset.link',
      'artist',
      artistId,
      null,
      result,
    );
    return result;
  }

  async unlinkArtistAsset(user: AuthUser, artistId: string, artistAssetId: string) {
    const link = await this.prisma.artistAsset.findUnique({
      where: { id: artistAssetId },
      include: { asset: true, artist: true },
    });

    if (!link || link.artistId !== artistId) {
      throw new NotFoundException('Artist asset link not found');
    }

    await this.prisma.artistAsset.delete({
      where: { id: artistAssetId },
    });

    const result = { deleted: true, link };
    await this.recordAudit(
      user,
      'artist_asset.unlink',
      'artist',
      artistId,
      link,
      result,
    );
    return result;
  }

  async createShortform(user: AuthUser, input: AdminPayload) {
    const shortform = await this.prisma.shortform.create({
      data: {
        artistId: this.optionalString(input, 'artistId'),
        title: this.string(input, 'title'),
        slug: this.string(input, 'slug'),
        description: this.optionalString(input, 'description'),
        status: this.string(input, 'status', 'draft'),
        publishedAt: this.optionalDate(input, 'publishedAt'),
      },
    });

    await this.recordAudit(user, 'shortform.create', 'shortform', shortform.id, null, shortform);
    return shortform;
  }

  async updateShortform(user: AuthUser, shortformId: string, input: AdminPayload) {
    const before = await this.prisma.shortform.findUnique({ where: { id: shortformId } });
    const shortform = await this.prisma.shortform.update({
      where: { id: shortformId },
      data: this.clean({
        artistId: this.optionalString(input, 'artistId'),
        title: this.optionalString(input, 'title'),
        slug: this.optionalString(input, 'slug'),
        description: this.optionalString(input, 'description'),
        status: this.optionalString(input, 'status'),
        publishedAt: this.optionalDate(input, 'publishedAt'),
        updatedAt: new Date(),
      }),
    });

    await this.recordAudit(user, 'shortform.update', 'shortform', shortformId, before, shortform);
    return shortform;
  }

  async linkShortformAsset(user: AuthUser, shortformId: string, input: AdminPayload) {
    await this.ensureShortform(shortformId);
    const asset = await this.ensureAssetLinkable(this.string(input, 'assetId'));
    const role = this.assetRole(input, 'role', 'thumbnail');
    const sortOrder = this.number(input, 'sortOrder', 0);

    const result = await this.prisma.shortformAsset.upsert({
      where: {
        shortformId_assetId_role: {
          shortformId,
          assetId: asset.id,
          role,
        },
      },
      update: { sortOrder },
      create: {
        shortformId,
        assetId: asset.id,
        role,
        sortOrder,
      },
      include: { asset: true },
    });

    await this.recordAudit(
      user,
      'shortform_asset.link',
      'shortform',
      shortformId,
      null,
      result,
    );
    return result;
  }

  async unlinkShortformAsset(
    user: AuthUser,
    shortformId: string,
    shortformAssetId: string,
  ) {
    const link = await this.prisma.shortformAsset.findUnique({
      where: { id: shortformAssetId },
      include: { asset: true, shortform: true },
    });

    if (!link || link.shortformId !== shortformId) {
      throw new NotFoundException('Shortform asset link not found');
    }

    await this.prisma.shortformAsset.delete({
      where: { id: shortformAssetId },
    });

    const result = { deleted: true, link };
    await this.recordAudit(
      user,
      'shortform_asset.unlink',
      'shortform',
      shortformId,
      link,
      result,
    );
    return result;
  }

  async createLuminaProduct(user: AuthUser, input: AdminPayload) {
    const product = await this.prisma.luminaProduct.create({
      data: {
        sku: this.string(input, 'sku'),
        name: this.string(input, 'name'),
        luminaAmount: this.decimal(input, 'luminaAmount'),
        bonusAmount: this.decimal(input, 'bonusAmount', 0),
        priceAmount: this.decimal(input, 'priceAmount'),
        priceCurrency: this.string(input, 'priceCurrency', 'KRW'),
        status: this.string(input, 'status', 'active'),
      },
    });

    await this.recordAudit(
      user,
      'lumina_product.create',
      'lumina_product',
      product.id,
      null,
      product,
    );
    return product;
  }

  async updateLuminaProduct(user: AuthUser, productId: string, input: AdminPayload) {
    const before = await this.prisma.luminaProduct.findUnique({ where: { id: productId } });
    const product = await this.prisma.luminaProduct.update({
      where: { id: productId },
      data: this.clean({
        sku: this.optionalString(input, 'sku'),
        name: this.optionalString(input, 'name'),
        luminaAmount: this.optionalDecimal(input, 'luminaAmount'),
        bonusAmount: this.optionalDecimal(input, 'bonusAmount'),
        priceAmount: this.optionalDecimal(input, 'priceAmount'),
        priceCurrency: this.optionalString(input, 'priceCurrency'),
        status: this.optionalString(input, 'status'),
        updatedAt: new Date(),
      }),
    });

    await this.recordAudit(
      user,
      'lumina_product.update',
      'lumina_product',
      productId,
      before,
      product,
    );
    return product;
  }

  async createGiftProduct(user: AuthUser, input: AdminPayload) {
    const product = await this.prisma.giftProduct.create({
      data: {
        artistId: this.optionalString(input, 'artistId'),
        sku: this.string(input, 'sku'),
        name: this.string(input, 'name'),
        giftKind: this.string(input, 'giftKind'),
        priceLumina: this.decimal(input, 'priceLumina'),
        progressAmount: this.decimal(input, 'progressAmount', 0),
        targetAmount: this.optionalDecimal(input, 'targetAmount'),
        unlockAssetId: this.optionalString(input, 'unlockAssetId'),
        reactionAssetId: this.optionalString(input, 'reactionAssetId'),
        status: this.string(input, 'status', 'active'),
        metadata: this.json(input, 'metadata'),
      },
    });

    await this.recordAudit(user, 'gift_product.create', 'gift_product', product.id, null, product);
    return product;
  }

  async updateGiftProduct(user: AuthUser, productId: string, input: AdminPayload) {
    const before = await this.prisma.giftProduct.findUnique({ where: { id: productId } });
    const product = await this.prisma.giftProduct.update({
      where: { id: productId },
      data: this.clean({
        artistId: this.optionalString(input, 'artistId'),
        sku: this.optionalString(input, 'sku'),
        name: this.optionalString(input, 'name'),
        giftKind: this.optionalString(input, 'giftKind'),
        priceLumina: this.optionalDecimal(input, 'priceLumina'),
        progressAmount: this.optionalDecimal(input, 'progressAmount'),
        targetAmount: this.optionalDecimal(input, 'targetAmount'),
        unlockAssetId: this.optionalString(input, 'unlockAssetId'),
        reactionAssetId: this.optionalString(input, 'reactionAssetId'),
        status: this.optionalString(input, 'status'),
        metadata: this.optionalJson(input, 'metadata'),
        updatedAt: new Date(),
      }),
    });

    await this.recordAudit(
      user,
      'gift_product.update',
      'gift_product',
      productId,
      before,
      product,
    );
    return product;
  }

  async createBoostProduct(user: AuthUser, input: AdminPayload) {
    const product = await this.prisma.boostProduct.create({
      data: {
        sku: this.string(input, 'sku'),
        name: this.string(input, 'name'),
        boostAmount: this.decimal(input, 'boostAmount'),
        priceLumina: this.decimal(input, 'priceLumina'),
        status: this.string(input, 'status', 'active'),
        metadata: this.json(input, 'metadata'),
      },
    });

    await this.recordAudit(
      user,
      'boost_product.create',
      'boost_product',
      product.id,
      null,
      product,
    );
    return product;
  }

  async updateBoostProduct(user: AuthUser, productId: string, input: AdminPayload) {
    const before = await this.prisma.boostProduct.findUnique({ where: { id: productId } });
    const product = await this.prisma.boostProduct.update({
      where: { id: productId },
      data: this.clean({
        sku: this.optionalString(input, 'sku'),
        name: this.optionalString(input, 'name'),
        boostAmount: this.optionalDecimal(input, 'boostAmount'),
        priceLumina: this.optionalDecimal(input, 'priceLumina'),
        status: this.optionalString(input, 'status'),
        metadata: this.optionalJson(input, 'metadata'),
        updatedAt: new Date(),
      }),
    });

    await this.recordAudit(
      user,
      'boost_product.update',
      'boost_product',
      productId,
      before,
      product,
    );
    return product;
  }

  async createBoostCampaign(user: AuthUser, input: AdminPayload) {
    const campaign = await this.prisma.boostCampaign.create({
      data: {
        slug: this.string(input, 'slug'),
        name: this.string(input, 'name'),
        description: this.optionalString(input, 'description'),
        status: this.string(input, 'status', 'draft'),
        startsAt: this.date(input, 'startsAt'),
        endsAt: this.date(input, 'endsAt'),
        freeLikeWeight: this.decimal(input, 'freeLikeWeight', 1),
        luminaBoostWeight: this.decimal(input, 'luminaBoostWeight', 1),
        dailyFreeLikeLimit: this.optionalNumber(input, 'dailyFreeLikeLimit'),
        metadata: this.json(input, 'metadata'),
      },
    });

    await this.recordAudit(
      user,
      'boost_campaign.create',
      'boost_campaign',
      campaign.id,
      null,
      campaign,
    );
    return campaign;
  }

  async updateBoostCampaign(user: AuthUser, campaignId: string, input: AdminPayload) {
    const before = await this.prisma.boostCampaign.findUnique({ where: { id: campaignId } });
    const campaign = await this.prisma.boostCampaign.update({
      where: { id: campaignId },
      data: this.clean({
        slug: this.optionalString(input, 'slug'),
        name: this.optionalString(input, 'name'),
        description: this.optionalString(input, 'description'),
        status: this.optionalString(input, 'status'),
        startsAt: this.optionalDate(input, 'startsAt'),
        endsAt: this.optionalDate(input, 'endsAt'),
        freeLikeWeight: this.optionalDecimal(input, 'freeLikeWeight'),
        luminaBoostWeight: this.optionalDecimal(input, 'luminaBoostWeight'),
        dailyFreeLikeLimit: this.optionalNumber(input, 'dailyFreeLikeLimit'),
        metadata: this.optionalJson(input, 'metadata'),
        updatedAt: new Date(),
      }),
    });

    await this.recordAudit(
      user,
      'boost_campaign.update',
      'boost_campaign',
      campaignId,
      before,
      campaign,
    );
    return campaign;
  }

  async snapshotBoostCampaign(user: AuthUser, campaignId: string) {
    const campaign = await this.prisma.boostCampaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      throw new NotFoundException('Boost campaign not found');
    }

    const events = await this.prisma.artistBoostEvent.findMany({
      where: { campaignId },
      include: { artist: true },
    });
    const rows = new Map<
      string,
      {
        totalFreeLikes: Decimal;
        totalLuminaBoosts: Decimal;
        totalWeightedScore: Decimal;
      }
    >();

    for (const event of events) {
      const row = rows.get(event.artistId) ?? {
        totalFreeLikes: new Decimal(0),
        totalLuminaBoosts: new Decimal(0),
        totalWeightedScore: new Decimal(0),
      };

      if (event.boostType === 'free_like') {
        row.totalFreeLikes = row.totalFreeLikes.plus(event.rawAmount);
      }

      if (event.boostType === 'lumina_boost') {
        row.totalLuminaBoosts = row.totalLuminaBoosts.plus(event.rawAmount);
      }

      row.totalWeightedScore = row.totalWeightedScore.plus(event.weightedScore);
      rows.set(event.artistId, row);
    }

    const snapshotAt = new Date();
    const rankedRows = [...rows.entries()]
      .sort((left, right) =>
        right[1].totalWeightedScore.comparedTo(left[1].totalWeightedScore),
      )
      .map(([artistId, row], index) => ({
        campaignId,
        artistId,
        rankNo: index + 1,
        snapshotAt,
        ...row,
      }));

    if (rankedRows.length === 0) {
      await this.recordAudit(user, 'boost_campaign.snapshot', 'boost_campaign', campaignId, null, {
        rows: 0,
      });
      return [];
    }

    await this.prisma.artistRankingSnapshot.createMany({ data: rankedRows });
    const snapshots = await this.prisma.artistRankingSnapshot.findMany({
      where: { campaignId, snapshotAt },
      include: {
        artist: {
          select: { id: true, slug: true, displayName: true },
        },
      },
      orderBy: { rankNo: 'asc' },
    });

    await this.recordAudit(
      user,
      'boost_campaign.snapshot',
      'boost_campaign',
      campaignId,
      null,
      { rows: snapshots },
    );
    return snapshots;
  }

  async createPremiumVideoProduct(user: AuthUser, input: AdminPayload) {
    const product = await this.prisma.premiumVideoProduct.create({
      data: {
        artistId: this.optionalString(input, 'artistId'),
        sku: this.string(input, 'sku'),
        title: this.string(input, 'title'),
        description: this.optionalString(input, 'description'),
        priceLumina: this.decimal(input, 'priceLumina'),
        status: this.string(input, 'status', 'draft'),
        publishedAt: this.optionalDate(input, 'publishedAt'),
      },
    });

    await this.recordAudit(
      user,
      'premium_video_product.create',
      'premium_video_product',
      product.id,
      null,
      product,
    );
    return product;
  }

  async updatePremiumVideoProduct(user: AuthUser, productId: string, input: AdminPayload) {
    const before = await this.prisma.premiumVideoProduct.findUnique({
      where: { id: productId },
    });
    const product = await this.prisma.premiumVideoProduct.update({
      where: { id: productId },
      data: this.clean({
        artistId: this.optionalString(input, 'artistId'),
        sku: this.optionalString(input, 'sku'),
        title: this.optionalString(input, 'title'),
        description: this.optionalString(input, 'description'),
        priceLumina: this.optionalDecimal(input, 'priceLumina'),
        status: this.optionalString(input, 'status'),
        publishedAt: this.optionalDate(input, 'publishedAt'),
        updatedAt: new Date(),
      }),
    });

    await this.recordAudit(
      user,
      'premium_video_product.update',
      'premium_video_product',
      productId,
      before,
      product,
    );
    return product;
  }

  async linkPremiumVideoAsset(user: AuthUser, productId: string, input: AdminPayload) {
    await this.ensurePremiumVideoProduct(productId);
    const asset = await this.ensureAssetLinkable(this.string(input, 'assetId'));
    const role = this.assetRole(input, 'role', 'video');
    const sortOrder = this.number(input, 'sortOrder', 0);

    const result = await this.prisma.premiumVideoAsset.upsert({
      where: {
        premiumVideoProductId_assetId_role: {
          premiumVideoProductId: productId,
          assetId: asset.id,
          role,
        },
      },
      update: { sortOrder },
      create: {
        premiumVideoProductId: productId,
        assetId: asset.id,
        role,
        sortOrder,
      },
      include: { asset: true },
    });

    await this.recordAudit(
      user,
      'premium_video_asset.link',
      'premium_video_product',
      productId,
      null,
      result,
    );
    return result;
  }

  async unlinkPremiumVideoAsset(
    user: AuthUser,
    productId: string,
    premiumVideoAssetId: string,
  ) {
    const link = await this.prisma.premiumVideoAsset.findUnique({
      where: { id: premiumVideoAssetId },
      include: { asset: true, premiumVideoProduct: true },
    });

    if (!link || link.premiumVideoProductId !== productId) {
      throw new NotFoundException('Premium video asset link not found');
    }

    await this.prisma.premiumVideoAsset.delete({
      where: { id: premiumVideoAssetId },
    });

    const result = { deleted: true, link };
    await this.recordAudit(
      user,
      'premium_video_asset.unlink',
      'premium_video_product',
      productId,
      link,
      result,
    );
    return result;
  }

  async createChatFeatureProduct(user: AuthUser, input: AdminPayload) {
    const product = await this.prisma.chatFeatureProduct.create({
      data: {
        sku: this.string(input, 'sku'),
        name: this.string(input, 'name'),
        featureType: this.string(input, 'featureType'),
        priceLumina: this.decimal(input, 'priceLumina'),
        status: this.string(input, 'status', 'active'),
        metadata: this.json(input, 'metadata'),
      },
    });

    await this.recordAudit(
      user,
      'chat_feature_product.create',
      'chat_feature_product',
      product.id,
      null,
      product,
    );
    return product;
  }

  async updateChatFeatureProduct(user: AuthUser, productId: string, input: AdminPayload) {
    const before = await this.prisma.chatFeatureProduct.findUnique({
      where: { id: productId },
    });
    const product = await this.prisma.chatFeatureProduct.update({
      where: { id: productId },
      data: this.clean({
        sku: this.optionalString(input, 'sku'),
        name: this.optionalString(input, 'name'),
        featureType: this.optionalString(input, 'featureType'),
        priceLumina: this.optionalDecimal(input, 'priceLumina'),
        status: this.optionalString(input, 'status'),
        metadata: this.optionalJson(input, 'metadata'),
        updatedAt: new Date(),
      }),
    });

    await this.recordAudit(
      user,
      'chat_feature_product.update',
      'chat_feature_product',
      productId,
      before,
      product,
    );
    return product;
  }

  getCommunityReports(query: AuditQuery) {
    const pagination = this.adminPagination(query);
    const status = this.optionalString(query, 'status');
    const reason = this.optionalString(query, 'reason');
    const postId = this.optionalString(query, 'postId');
    const reporterUserId = this.optionalString(query, 'reporterUserId');
    const search = this.optionalString(query, 'query') ?? this.optionalString(query, 'q');
    const where: Prisma.CommunityReportWhereInput = this.clean({
      status,
      reason,
      postId,
      reporterUserId,
      OR: search
        ? [
            { reason: { contains: search, mode: 'insensitive' } },
            { detail: { contains: search, mode: 'insensitive' } },
            { post: { body: { contains: search, mode: 'insensitive' } } },
            { reporter: { email: { contains: search, mode: 'insensitive' } } },
          ]
        : undefined,
    });

    return this.prisma.communityReport
      .findMany({
        where,
        take: pagination.takeForQuery,
        ...pagination.cursorArgs,
        orderBy: { createdAt: 'desc' },
        include: this.communityReportInclude(),
      })
      .then((rows) => this.paginated(rows, pagination.take));
  }

  getCommunityPosts(query: AuditQuery) {
    const pagination = this.adminPagination(query);
    const status = this.optionalString(query, 'status');
    const postType = this.optionalString(query, 'postType');
    const artistSlug = this.optionalString(query, 'artistSlug');
    const authorUserId = this.optionalString(query, 'authorUserId');
    const minReports = this.optionalNumber(query, 'minReports');
    const search = this.optionalString(query, 'query') ?? this.optionalString(query, 'q');
    const where: Prisma.CommunityPostWhereInput = this.clean({
      status,
      postType,
      authorUserId,
      artist: artistSlug ? { slug: artistSlug } : undefined,
      reportCount:
        minReports === undefined
          ? undefined
          : {
              gte: minReports,
            },
      OR: search
        ? [
            { body: { contains: search, mode: 'insensitive' } },
            { author: { email: { contains: search, mode: 'insensitive' } } },
            { artist: { displayName: { contains: search, mode: 'insensitive' } } },
            { artist: { slug: { contains: search, mode: 'insensitive' } } },
          ]
        : undefined,
    });

    return this.prisma.communityPost
      .findMany({
        where,
        take: pagination.takeForQuery,
        ...pagination.cursorArgs,
        orderBy:
          this.optionalString(query, 'sort') === 'reports'
            ? [{ reportCount: 'desc' }, { createdAt: 'desc' }]
            : { createdAt: 'desc' },
        include: this.communityPostInclude(),
      })
      .then((rows) => this.paginated(rows, pagination.take));
  }

  async getCommunityModerationSummary(query: AuditQuery) {
    const highRiskTake = Math.max(1, Math.min(this.number(query, 'take', 10), 50));
    const [
      reportsByStatus,
      reportsByReason,
      postsByStatus,
      postsByType,
      highRiskPosts,
    ] = await Promise.all([
      this.prisma.communityReport.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.communityReport.groupBy({
        by: ['reason'],
        _count: { _all: true },
        where: {
          status: { in: ['submitted', 'reviewing'] },
        },
      }),
      this.prisma.communityPost.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.communityPost.groupBy({
        by: ['postType'],
        _count: { _all: true },
        where: {
          status: { in: ['published', 'hidden'] },
        },
      }),
      this.prisma.communityPost.findMany({
        where: {
          reportCount: { gt: 0 },
          status: { in: ['published', 'hidden'] },
        },
        take: highRiskTake,
        orderBy: [{ reportCount: 'desc' }, { createdAt: 'desc' }],
        include: this.communityPostInclude(),
      }),
    ]);

    return {
      reports: {
        byStatus: this.countRowsToObject(reportsByStatus, 'status'),
        byReason: this.countRowsToObject(reportsByReason, 'reason'),
      },
      posts: {
        byStatus: this.countRowsToObject(postsByStatus, 'status'),
        byType: this.countRowsToObject(postsByType, 'postType'),
        highRisk: highRiskPosts,
      },
    };
  }

  async updateCommunityReport(user: AuthUser, reportId: string, input: AdminPayload) {
    const before = await this.prisma.communityReport.findUnique({
      where: { id: reportId },
      include: this.communityReportInclude(),
    });

    if (!before) {
      throw new NotFoundException('Community report not found');
    }

    const action = this.communityReportAction(input);
    const status =
      input.status === undefined
        ? action === 'none'
          ? undefined
          : 'resolved'
        : this.communityReportStatus(input, 'status');
    const now = new Date();
    const report = await this.prisma.$transaction(async (tx) => {
      const updatedReport = await tx.communityReport.update({
        where: { id: reportId },
        data: this.clean({
          status,
          detail: this.optionalString(input, 'detail'),
          metadata: this.optionalJson(input, 'metadata'),
          updatedAt: now,
        }),
        include: this.communityReportInclude(),
      });

      if (action === 'hide_post' || action === 'restore_post') {
        const postMetadata = this.metadataObject(before.post.metadata);
        const moderation = this.metadataObject(postMetadata.moderation);
        await tx.communityPost.update({
          where: { id: before.postId },
          data: {
            status: action === 'hide_post' ? 'hidden' : 'published',
            deletedAt: action === 'restore_post' ? null : undefined,
            updatedAt: now,
            metadata: this.toJson({
              ...postMetadata,
              moderation: {
                ...moderation,
                status: action === 'hide_post' ? 'hidden' : 'restored',
                reason: this.optionalString(input, 'reason') ?? null,
                note: this.optionalString(input, 'note') ?? null,
                reportId,
                actionByUserId: user.id,
                actionAt: now.toISOString(),
              },
            }),
          },
        });
      }

      if (this.boolean(input, 'resolveMatchingReports', false)) {
        await tx.communityReport.updateMany({
          where: {
            postId: before.postId,
            id: { not: reportId },
            status: { in: ['submitted', 'reviewing'] },
          },
          data: {
            status: status === 'dismissed' ? 'dismissed' : 'resolved',
            updatedAt: now,
          },
        });
      }

      return updatedReport;
    });

    await this.recordAudit(
      user,
      'community_report.update',
      'community_report',
      report.id,
      before,
      report,
      {
        note: this.optionalString(input, 'note'),
        action,
        resolveMatchingReports: this.boolean(input, 'resolveMatchingReports', false),
      },
    );

    return report;
  }

  async hideCommunityPost(user: AuthUser, postId: string, input: AdminPayload) {
    const before = await this.findCommunityPostForAdmin(postId);
    const metadata = this.metadataObject(before.metadata);
    const moderation = this.metadataObject(metadata.moderation);
    const hiddenAt = new Date().toISOString();
    const post = await this.prisma.communityPost.update({
      where: { id: postId },
      data: {
        status: 'hidden',
        updatedAt: new Date(),
        metadata: this.toJson({
          ...metadata,
          moderation: {
            ...moderation,
            status: 'hidden',
            reason: this.optionalString(input, 'reason') ?? null,
            note: this.optionalString(input, 'note') ?? null,
            hiddenByUserId: user.id,
            hiddenAt,
          },
        }),
      },
      include: this.communityPostInclude(),
    });

    await this.recordAudit(
      user,
      'community_post.hide',
      'community_post',
      post.id,
      before,
      post,
    );

    return { ok: true, post };
  }

  async restoreCommunityPost(user: AuthUser, postId: string, input: AdminPayload) {
    const before = await this.findCommunityPostForAdmin(postId);
    const metadata = this.metadataObject(before.metadata);
    const moderation = this.metadataObject(metadata.moderation);
    const restoredAt = new Date().toISOString();
    const post = await this.prisma.communityPost.update({
      where: { id: postId },
      data: {
        status: 'published',
        deletedAt: null,
        updatedAt: new Date(),
        metadata: this.toJson({
          ...metadata,
          moderation: {
            ...moderation,
            status: 'restored',
            reason: this.optionalString(input, 'reason') ?? null,
            note: this.optionalString(input, 'note') ?? null,
            restoredByUserId: user.id,
            restoredAt,
          },
        }),
      },
      include: this.communityPostInclude(),
    });

    await this.recordAudit(
      user,
      'community_post.restore',
      'community_post',
      post.id,
      before,
      post,
    );

    return { ok: true, post };
  }

  private presentAiContentHealth(artist: Record<string, unknown>) {
    const assetLinks = Array.isArray(artist.artistAssets) ? artist.artistAssets : [];
    const publicProfile = this.metadataObject(artist.publicProfile);
    const visualProfile = this.metadataObject(artist.visualProfile);
    const contentProfile = this.metadataObject(artist.contentProfile);
    const shortforms = Array.isArray(artist.shortforms) ? artist.shortforms : [];
    const premiumVideos = Array.isArray(artist.premiumVideos) ? artist.premiumVideos : [];
    const chatPersonas = Array.isArray(artist.chatPersonas) ? artist.chatPersonas : [];
    const giftProducts = Array.isArray(artist.giftProducts) ? artist.giftProducts : [];
    const counts = this.metadataObject(artist._count);
    const slots = {
      cover: this.assetSlotSummary(assetLinks, ['cover', 'hero', 'banner']),
      thumbnail: this.assetSlotSummary(assetLinks, [
        'thumbnail',
        'thumb',
        'avatar',
        'profile',
        'card',
      ]),
      gallery: this.assetSlotSummary(assetLinks, ['gallery', 'photo', 'image', 'detail']),
    };
    const missing = this.aiArtistMissingSections(artist);
    const healthStatus =
      missing.length === 0 ? 'ok' : missing.length <= 2 ? 'needs_review' : 'needs_action';

    return {
      id: artist.id,
      slug: artist.slug,
      displayName: artist.displayName,
      status: artist.status,
      sortOrder: artist.sortOrder,
      launchedAt: artist.launchedAt,
      updatedAt: artist.updatedAt,
      healthStatus,
      missing,
      profiles: {
        publicReady: Boolean(publicProfile.tagline || publicProfile.summary),
        visualReady: Boolean(
          visualProfile.styleNotes ||
            (Array.isArray(visualProfile.visualKeywords) &&
              visualProfile.visualKeywords.length > 0),
        ),
        contentReady: Boolean(contentProfile.contentTone || contentProfile.operatingNotes),
      },
      slots,
      counts: {
        assets: counts.artistAssets ?? 0,
        shortforms: counts.shortforms ?? 0,
        premiumVideos: counts.premiumVideos ?? 0,
        chatPersonas: counts.chatPersonas ?? 0,
        giftProducts: counts.giftProducts ?? 0,
        followers: counts.followers ?? 0,
        communityPosts: counts.communityPosts ?? 0,
      },
      recent: {
        shortforms,
        premiumVideos,
        chatPersonas,
        giftProducts,
      },
      nextActions: missing.map((key) => this.aiContentNextAction(key)),
    };
  }

  private aiArtistMissingSections(artist: Record<string, unknown>) {
    const assetLinks = Array.isArray(artist.artistAssets) ? artist.artistAssets : [];
    const publicProfile = this.metadataObject(artist.publicProfile);
    const visualProfile = this.metadataObject(artist.visualProfile);
    const contentProfile = this.metadataObject(artist.contentProfile);
    const counts = this.metadataObject(artist._count);
    const missing: string[] = [];

    if (!publicProfile.tagline && !publicProfile.summary) {
      missing.push('public_profile');
    }

    if (
      !visualProfile.styleNotes &&
      (!Array.isArray(visualProfile.visualKeywords) ||
        visualProfile.visualKeywords.length === 0)
    ) {
      missing.push('visual_profile');
    }

    if (!contentProfile.contentTone && !contentProfile.operatingNotes) {
      missing.push('content_profile');
    }

    if (!this.assetSlotSummary(assetLinks, ['cover', 'hero', 'banner']).count) {
      missing.push('cover_asset');
    }

    if (
      !this.assetSlotSummary(assetLinks, [
        'thumbnail',
        'thumb',
        'avatar',
        'profile',
        'card',
      ]).count
    ) {
      missing.push('thumbnail_asset');
    }

    if (!this.assetSlotSummary(assetLinks, ['gallery', 'photo', 'image', 'detail']).count) {
      missing.push('gallery_assets');
    }

    if (!counts.shortforms) {
      missing.push('shortforms');
    }

    if (!counts.chatPersonas) {
      missing.push('chat_persona');
    }

    return missing;
  }

  private assetSlotSummary(assetLinks: unknown[], usageTypes: string[]) {
    const normalized = new Set(usageTypes.map((item) => item.toLowerCase()));
    const links = assetLinks.filter((link) => {
      const usageType =
        this.metadataObject(link).usageType?.toString().toLowerCase() ?? '';
      return normalized.has(usageType);
    });
    const primary =
      links.find((link) => this.metadataObject(link).isPrimary === true) ?? links[0] ?? null;
    const primaryAsset = primary ? this.metadataObject(this.metadataObject(primary).asset) : null;
    const storageKey =
      typeof primaryAsset?.storageKey === 'string' ? primaryAsset.storageKey : null;

    return {
      count: links.length,
      primaryAssetId: primaryAsset?.id ?? null,
      primaryUrl: storageKey ? this.buildPublicAssetUrl(storageKey) : null,
    };
  }

  private aiContentNextAction(key: string) {
    const labels: Record<string, string> = {
      public_profile: '아티스트 공개 소개/태그라인을 보강합니다.',
      visual_profile: '비주얼 키워드 또는 스타일 노트를 보강합니다.',
      content_profile: '콘텐츠 톤앤매너 또는 운영 노트를 보강합니다.',
      cover_asset: '커버/히어로 슬롯 이미지를 연결합니다.',
      thumbnail_asset: '썸네일/프로필 슬롯 이미지를 연결합니다.',
      gallery_assets: '갤러리 슬롯 이미지를 1장 이상 연결합니다.',
      shortforms: '공개 또는 준비 중 숏폼을 1개 이상 등록합니다.',
      chat_persona: '캐릭터챗용 persona 초안을 준비합니다.',
    };

    return {
      key,
      label: labels[key] ?? '운영자가 상태를 확인합니다.',
    };
  }

  private userReportStats(
    reports: {
      status: string;
      reason: string;
      createdAt: Date;
      post: { authorUserId: string };
    }[],
  ) {
    const stats = new Map<
      string,
      { total: number; open: number; latestReason: string | null; latestAt: Date | null }
    >();

    for (const report of reports) {
      const userId = report.post.authorUserId;
      const current = stats.get(userId) ?? {
        total: 0,
        open: 0,
        latestReason: null,
        latestAt: null,
      };
      current.total += 1;
      if (['submitted', 'reviewing'].includes(report.status)) {
        current.open += 1;
      }
      if (!current.latestAt || report.createdAt > current.latestAt) {
        current.latestReason = report.reason;
        current.latestAt = report.createdAt;
      }
      stats.set(userId, current);
    }

    return stats;
  }

  private userAuditStats(
    events: {
      action: string;
      targetId: string | null;
      createdAt: Date;
      actorUser?: { id: string; email: string | null } | null;
    }[],
  ) {
    const sanctionActions = new Set(['user.suspend', 'user.delete']);
    const stats = new Map<
      string,
      {
        sanctionCount: number;
        recentAction: {
          action: string;
          createdAt: Date;
          actorUser?: { id: string; email: string | null } | null;
        } | null;
      }
    >();

    for (const event of events) {
      if (!event.targetId) {
        continue;
      }

      const current = stats.get(event.targetId) ?? {
        sanctionCount: 0,
        recentAction: null,
      };
      if (sanctionActions.has(event.action)) {
        current.sanctionCount += 1;
      }
      if (!current.recentAction || event.createdAt > current.recentAction.createdAt) {
        current.recentAction = {
          action: event.action,
          createdAt: event.createdAt,
          actorUser: event.actorUser,
        };
      }
      stats.set(event.targetId, current);
    }

    return stats;
  }

  private userPaymentStats(
    orders: {
      userId: string;
      orderNo: string;
      provider: string;
      status: string;
      amount: Decimal;
      currency: string;
      createdAt: Date;
    }[],
  ) {
    const stats = new Map<
      string,
      {
        paidCount: number;
        paidAmountKrw: Decimal;
        lastOrder: {
          orderNo: string;
          provider: string;
          status: string;
          amount: Decimal;
          currency: string;
          createdAt: Date;
        } | null;
      }
    >();

    for (const order of orders) {
      const current = stats.get(order.userId) ?? {
        paidCount: 0,
        paidAmountKrw: new Decimal(0),
        lastOrder: null,
      };
      if (order.status === 'paid') {
        current.paidCount += 1;
        current.paidAmountKrw = current.paidAmountKrw.plus(order.amount);
      }
      if (!current.lastOrder || order.createdAt > current.lastOrder.createdAt) {
        current.lastOrder = {
          orderNo: order.orderNo,
          provider: order.provider,
          status: order.status,
          amount: order.amount,
          currency: order.currency,
          createdAt: order.createdAt,
        };
      }
      stats.set(order.userId, current);
    }

    return stats;
  }

  private settlementPeriod(query: AuditQuery) {
    const period = this.optionalString(query, 'period');
    const now = new Date();
    const label =
      period && /^\d{4}-\d{2}$/.test(period)
        ? period
        : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const [yearValue, monthValue] = label.split('-').map((part) => Number(part));

    if (
      !Number.isInteger(yearValue) ||
      !Number.isInteger(monthValue) ||
      monthValue < 1 ||
      monthValue > 12
    ) {
      throw new BadRequestException('period must be YYYY-MM');
    }

    const start = new Date(Date.UTC(yearValue, monthValue - 1, 1));
    const end = new Date(Date.UTC(yearValue, monthValue, 1));

    return {
      label,
      timezone: 'UTC',
      start,
      end,
    };
  }

  private settlementPolicy(query: AuditQuery) {
    return {
      unitPriceKrw: this.decimal(query, 'unitPriceKrw', 10),
      vatRateBps: this.number(query, 'vatRateBps', 1000),
      pgFeeRateBps: this.number(query, 'pgFeeRateBps', 250),
      pgFeeVatRateBps: this.number(query, 'pgFeeVatRateBps', 1000),
      aiCostRateBps: this.number(query, 'aiCostRateBps', 0),
      directCostRateBps: this.number(query, 'directCostRateBps', 0),
      settlementRateBps: this.number(query, 'settlementRateBps', 8000),
      platformMinimumMarginBps: this.number(query, 'platformMinimumMarginBps', 1000),
      status: 'preview_only',
    };
  }

  private emptyRevenueBucket() {
    return {
      eventCount: 0,
      totalLumina: new Decimal(0),
      breakdown: {
        chat: this.emptyProductBreakdown('chat'),
        gift: this.emptyProductBreakdown('gift'),
        paid_like: this.emptyProductBreakdown('paid_like'),
        premium_video: this.emptyProductBreakdown('premium_video'),
      },
    };
  }

  private emptyProductBreakdown(type: string) {
    return {
      type,
      eventCount: 0,
      grossLumina: new Decimal(0),
      grossRevenueKrw: new Decimal(0),
    };
  }

  private addRevenueEvent(
    revenueByArtist: Map<string, ReturnType<typeof this.emptyRevenueBucket>>,
    artistId: string,
    type: keyof ReturnType<typeof this.emptyRevenueBucket>['breakdown'],
    lumina: Decimal,
    unitPriceKrw: Decimal,
  ) {
    const bucket = revenueByArtist.get(artistId) ?? this.emptyRevenueBucket();
    const amount = new Decimal(lumina);
    bucket.eventCount += 1;
    bucket.totalLumina = bucket.totalLumina.plus(amount);
    bucket.breakdown[type].eventCount += 1;
    bucket.breakdown[type].grossLumina =
      bucket.breakdown[type].grossLumina.plus(amount);
    bucket.breakdown[type].grossRevenueKrw =
      bucket.breakdown[type].grossLumina.mul(unitPriceKrw);
    revenueByArtist.set(artistId, bucket);
  }

  private settlementFinancials(
    totalLumina: Decimal,
    policy: ReturnType<typeof this.settlementPolicy>,
  ) {
    const grossRevenueKrw = totalLumina.mul(policy.unitPriceKrw);
    const vatKrw = grossRevenueKrw.mul(policy.vatRateBps).div(10_000 + policy.vatRateBps);
    const vatExcludedRevenueKrw = grossRevenueKrw.minus(vatKrw);
    const pgFeeKrw = grossRevenueKrw.mul(policy.pgFeeRateBps).div(10_000);
    const pgFeeVatKrw = pgFeeKrw.mul(policy.pgFeeVatRateBps).div(10_000);
    const aiCostKrw = grossRevenueKrw.mul(policy.aiCostRateBps).div(10_000);
    const directCostKrw = grossRevenueKrw.mul(policy.directCostRateBps).div(10_000);
    const netRevenueKrw = Decimal.max(
      0,
      vatExcludedRevenueKrw.minus(pgFeeKrw).minus(pgFeeVatKrw).minus(aiCostKrw).minus(directCostKrw),
    );
    const creatorShareKrw = netRevenueKrw.mul(policy.settlementRateBps).div(10_000);
    const platformShareKrw = netRevenueKrw
      .mul(policy.platformMinimumMarginBps)
      .div(10_000);
    const riskReserveKrw = Decimal.max(
      0,
      netRevenueKrw.minus(creatorShareKrw).minus(platformShareKrw),
    );

    return {
      grossRevenueKrw,
      vatKrw,
      vatExcludedRevenueKrw,
      pgFeeKrw,
      pgFeeVatKrw,
      aiCostKrw,
      directCostKrw,
      refundAdjustmentKrw: new Decimal(0),
      netRevenueKrw,
      settlementRateBps: policy.settlementRateBps,
      creatorShareKrw,
      platformShareKrw,
      riskReserveKrw,
    };
  }

  private settlementKey(type: 'artist' | 'partner', id: string, period: string) {
    return `${type}:${id}:${period}`;
  }

  private parseSettlementKey(settlementKey: string) {
    const [type, id, period] = settlementKey.split(':');

    if (!SETTLEMENT_TYPES.has(type) || !id || !this.isUuid(id) || !/^\d{4}-\d{2}$/.test(period)) {
      throw new BadRequestException(
        'settlementKey must be artist:<artistId>:YYYY-MM or partner:<partnerUserId>:YYYY-MM',
      );
    }

    return {
      type: type as 'artist' | 'partner',
      id,
      period,
    };
  }

  private settlementStatus(input: AdminPayload, key: string) {
    const status = this.string(input, key);

    if (!SETTLEMENT_STATUSES.has(status) || status === 'estimated') {
      throw new BadRequestException('status must be ready, hold, paid, recheck, or cancelled');
    }

    return status;
  }

  private async settlementRecordsForKeys(keys: string[]) {
    if (!keys.length) {
      return new Map<string, SettlementRecord>();
    }

    const records = await this.prisma.settlementRecord.findMany({
      where: { settlementKey: { in: keys } },
    });

    return new Map(records.map((record) => [record.settlementKey, record]));
  }

  private settlementRecordSummary(record?: SettlementRecord | null) {
    if (!record) {
      return null;
    }

    return {
      id: record.id,
      settlementKey: record.settlementKey,
      settlementType: record.settlementType,
      period: record.period,
      status: record.status,
      amountKrw: record.amountKrw,
      reason: record.reason,
      note: record.note,
      paidAt: record.paidAt,
      paymentMethod: record.paymentMethod,
      payoutReference: record.payoutReference,
      updatedByUserId: record.updatedByUserId,
      updatedAt: record.updatedAt,
      createdAt: record.createdAt,
    };
  }

  private payoutEligibility(input: {
    eventCount: number;
    manualSettlement: { status: string } | null;
  }) {
    const blockingReasons: string[] = [];

    if (input.eventCount < 1) {
      blockingReasons.push('no_revenue_events');
    }

    if (input.manualSettlement?.status === 'paid') {
      blockingReasons.push('already_paid');
    }

    return {
      canMarkPaid: blockingReasons.length === 0,
      blockingReasons,
      identityVerification: {
        status: 'not_connected',
        note: 'Identity verification model is not connected to settlement records yet.',
      },
      payoutAccount: {
        status: 'not_connected',
        note: 'Payout account model is not connected to settlement records yet.',
      },
      payoutException: {
        status: 'not_connected',
      },
    };
  }

  private assertSettlementOperator(user: AuthUser) {
    if (
      user.adminPermissions?.includes('*') ||
      this.hasAdminRole(user, [
        'super_admin',
        'accounting_admin',
        'commerce_admin',
        'settlement_admin',
      ])
    ) {
      return;
    }

    throw new ForbiddenException('Settlement operation permission required');
  }

  private primaryLoginType(authAccounts: { provider: string; lastLoginAt?: Date | null }[]) {
    const latest = [...authAccounts].sort((left, right) => {
      const leftAt = left.lastLoginAt?.getTime() ?? 0;
      const rightAt = right.lastLoginAt?.getTime() ?? 0;
      return rightAt - leftAt;
    })[0];

    return latest?.provider ?? null;
  }

  private latestLoginAt(authAccounts: { lastLoginAt?: Date | null }[]) {
    return authAccounts.reduce<Date | null>((latest, account) => {
      if (!account.lastLoginAt) {
        return latest;
      }

      return !latest || account.lastLoginAt > latest ? account.lastLoginAt : latest;
    }, null);
  }

  private canViewCreatorContact(user: AuthUser) {
    return this.hasAdminRole(user, [
      'super_admin',
      'sales_admin',
      'business_admin',
      'partnership_admin',
    ]);
  }

  private canViewPayoutInfo(user: AuthUser) {
    return this.hasAdminRole(user, ['super_admin', 'accounting_admin', 'commerce_admin']);
  }

  private hasAdminRole(user: AuthUser, roles: string[]) {
    if (user.adminPermissions?.includes('*')) {
      return true;
    }

    return Boolean(user.adminRole && roles.includes(user.adminRole));
  }

  private maskEmail(email?: string | null) {
    if (!email) {
      return null;
    }

    const [name, domain] = email.split('@');
    if (!domain) {
      return '***';
    }

    return `${name.slice(0, 2)}***@${domain}`;
  }

  private maskPhone(phone?: string | null) {
    if (!phone) {
      return null;
    }

    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7) {
      return '***';
    }

    return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
  }

  private recordAudit(
    user: AuthUser,
    action: string,
    targetType: string,
    targetId: string | null,
    beforeData: unknown,
    afterData: unknown,
    metadata: AdminPayload = {},
  ) {
    return this.prisma.auditEvent.create({
      data: {
        actorUserId: user.id,
        actorType: 'admin',
        action,
        targetType,
        targetId,
        beforeData: this.toJson(beforeData),
        afterData: this.toJson(afterData),
        metadata: this.toJson(metadata),
      },
    });
  }

  private userModerationSelect() {
    return {
      id: true,
      email: true,
      phoneNumber: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      profile: {
        select: {
          displayName: true,
          publicHandle: true,
        },
      },
      authAccounts: {
        select: {
          provider: true,
          lastLoginAt: true,
          createdAt: true,
        },
      },
      walletAccounts: {
        select: {
          id: true,
          currencyCode: true,
          status: true,
          cachedBalance: true,
        },
      },
      _count: {
        select: {
          refreshTokens: {
            where: {
              revokedAt: null,
              expiresAt: { gt: new Date() },
            },
          },
          paymentOrders: true,
          sentUserGifts: true,
          receivedUserGifts: true,
        },
      },
    } satisfies Prisma.UserSelect;
  }

  private artistOperatorInclude() {
    return {
      user: {
        select: {
          id: true,
          email: true,
          status: true,
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
          status: true,
        },
      },
    } satisfies Prisma.ArtistOperatorInclude;
  }

  private communityPostInclude() {
    return {
      author: {
        select: {
          id: true,
          email: true,
          status: true,
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
          status: true,
        },
      },
    } satisfies Prisma.CommunityPostInclude;
  }

  private communityReportInclude() {
    return {
      reporter: {
        select: {
          id: true,
          email: true,
          status: true,
          profile: {
            select: {
              displayName: true,
            },
          },
        },
      },
      post: {
        include: this.communityPostInclude(),
      },
    } satisfies Prisma.CommunityReportInclude;
  }

  private async findCommunityPostForAdmin(postId: string) {
    if (!this.isUuid(postId)) {
      throw new BadRequestException('postId must be a UUID');
    }

    const post = await this.prisma.communityPost.findUnique({
      where: { id: postId },
      include: this.communityPostInclude(),
    });

    if (!post) {
      throw new NotFoundException('Community post not found');
    }

    return post;
  }

  private async findUserForModeration(userId: string) {
    if (!this.isUuid(userId)) {
      throw new BadRequestException('userId must be a UUID');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: this.userModerationSelect(),
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  private assetRelationInclude() {
    return {
      artistAssets: {
        include: {
          artist: {
            select: { id: true, slug: true, displayName: true, status: true },
          },
        },
      },
      shortformAssets: {
        include: {
          shortform: {
            select: { id: true, slug: true, title: true, status: true },
          },
        },
      },
      premiumVideoAssets: {
        include: {
          premiumVideoProduct: {
            select: { id: true, sku: true, title: true, status: true },
          },
        },
      },
    } satisfies Prisma.AssetInclude;
  }

  private paymentOrderInclude() {
    return {
      user: {
        select: {
          id: true,
          email: true,
          status: true,
          createdAt: true,
        },
      },
      luminaProduct: true,
      transactions: {
        orderBy: { createdAt: 'desc' as const },
      },
      refunds: {
        orderBy: { createdAt: 'desc' as const },
      },
    } satisfies Prisma.PaymentOrderInclude;
  }

  private refundTransactionInclude() {
    return {
      paymentOrder: {
        include: {
          user: {
            select: {
              id: true,
              email: true,
              status: true,
            },
          },
          luminaProduct: true,
        },
      },
    } satisfies Prisma.RefundTransactionInclude;
  }

  private paymentOrderLookupWhere(orderId: string): Prisma.PaymentOrderWhereInput {
    const orderNoOnly = { orderNo: orderId };

    if (!this.isUuid(orderId)) {
      return orderNoOnly;
    }

    return {
      OR: [{ id: orderId }, orderNoOnly],
    };
  }

  private refundablePaymentAmount(
    order: Prisma.PaymentOrderGetPayload<{ include: { refunds: true } }>,
  ) {
    const reservedOrCompletedRefunds = order.refunds
      .filter((refund) => !['cancelled', 'failed'].includes(refund.status))
      .reduce((sum, refund) => sum.plus(refund.amount), new Decimal(0));

    return order.amount.minus(reservedOrCompletedRefunds);
  }

  private async ensureRefundStatusWithinPaymentAmount(
    paymentOrderId: string,
    refundId: string,
  ) {
    const order = await this.prisma.paymentOrder.findUnique({
      where: { id: paymentOrderId },
      include: { refunds: true },
    });

    if (!order) {
      throw new NotFoundException('Payment order not found');
    }

    const targetRefund = order.refunds.find((refund) => refund.id === refundId);
    if (!targetRefund) {
      throw new NotFoundException('Refund transaction not found');
    }

    const reservedOrCompletedRefunds = order.refunds
      .filter(
        (refund) =>
          refund.id !== refundId && !['cancelled', 'failed'].includes(refund.status),
      )
      .reduce((sum, refund) => sum.plus(refund.amount), new Decimal(0));

    if (reservedOrCompletedRefunds.plus(targetRefund.amount).gt(order.amount)) {
      throw new BadRequestException('Refund status update exceeds payment amount');
    }
  }

  private presentAsset(
    asset: Prisma.AssetGetPayload<{
      include: ReturnType<AdminService['assetRelationInclude']>;
    }>,
  ) {
    const metadata = this.metadataObject(asset.metadata);
    const uploadIntent = this.metadataObject(metadata.uploadIntent);
    const uploadStatus =
      typeof uploadIntent.status === 'string' ? uploadIntent.status : 'ready';
    const lifecycle = this.metadataObject(metadata.lifecycle);
    const lifecycleStatus =
      typeof lifecycle.status === 'string' ? lifecycle.status : 'active';

    return {
      id: asset.id,
      assetType: asset.assetType,
      visibility: asset.visibility,
      storageProvider: asset.storageProvider,
      storageKey: asset.storageKey,
      url: this.buildPublicAssetUrl(asset.storageKey),
      mimeType: asset.mimeType,
      fileSizeBytes: asset.fileSizeBytes?.toString() ?? null,
      width: asset.width,
      height: asset.height,
      durationSeconds: asset.durationSeconds?.toString() ?? null,
      checksum: asset.checksum,
      metadata: asset.metadata,
      uploadStatus,
      lifecycleStatus,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
      links: {
        artists: asset.artistAssets.map((link) => ({
          id: link.id,
          artistId: link.artistId,
          usageType: link.usageType,
          isPrimary: link.isPrimary,
          sortOrder: link.sortOrder,
          artist: link.artist,
        })),
        shortforms: asset.shortformAssets.map((link) => ({
          id: link.id,
          shortformId: link.shortformId,
          role: link.role,
          sortOrder: link.sortOrder,
          shortform: link.shortform,
        })),
        premiumVideos: asset.premiumVideoAssets.map((link) => ({
          id: link.id,
          premiumVideoProductId: link.premiumVideoProductId,
          role: link.role,
          sortOrder: link.sortOrder,
          premiumVideoProduct: link.premiumVideoProduct,
        })),
      },
    };
  }

  private async upsertArtistProfiles(artistId: string, input: AdminPayload) {
    const publicProfile = this.object(input, 'publicProfile');
    const visualProfile = this.object(input, 'visualProfile');
    const contentProfile = this.object(input, 'contentProfile');

    if (publicProfile) {
      await this.prisma.artistPublicProfile.upsert({
        where: { artistId },
        update: this.clean({ ...publicProfile, updatedAt: new Date() }) as never,
        create: { artistId, ...publicProfile } as never,
      });
    }

    if (visualProfile) {
      await this.prisma.artistVisualProfile.upsert({
        where: { artistId },
        update: this.clean({ ...visualProfile, updatedAt: new Date() }) as never,
        create: { artistId, ...visualProfile } as never,
      });
    }

    if (contentProfile) {
      await this.prisma.artistContentProfile.upsert({
        where: { artistId },
        update: this.clean({ ...contentProfile, updatedAt: new Date() }) as never,
        create: { artistId, ...contentProfile } as never,
      });
    }
  }

  private getArtistWithProfiles(artistId: string) {
    return this.prisma.artist.findUniqueOrThrow({
      where: { id: artistId },
      include: {
        publicProfile: true,
        visualProfile: true,
        contentProfile: true,
      },
    });
  }

  private async ensureArtist(artistId: string) {
    const artist = await this.prisma.artist.findUnique({ where: { id: artistId } });

    if (!artist) {
      throw new NotFoundException('Artist not found');
    }
  }

  private async ensureShortform(shortformId: string) {
    const shortform = await this.prisma.shortform.findUnique({
      where: { id: shortformId },
    });

    if (!shortform) {
      throw new NotFoundException('Shortform not found');
    }
  }

  private async ensurePremiumVideoProduct(productId: string) {
    const product = await this.prisma.premiumVideoProduct.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException('Premium video product not found');
    }
  }

  private async ensureAssetLinkable(assetId: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    const metadata = this.metadataObject(asset.metadata);
    const uploadIntent = this.metadataObject(metadata.uploadIntent);

    if (uploadIntent.status && uploadIntent.status !== 'uploaded') {
      throw new BadRequestException('Asset upload must be confirmed before linking');
    }

    const lifecycle = this.metadataObject(metadata.lifecycle);

    if (lifecycle.status === 'archived') {
      throw new BadRequestException('Archived assets cannot be linked');
    }

    return asset;
  }

  private async findAdminTargetUser(input: AdminPayload) {
    const userId = this.optionalString(input, 'userId');
    const email = this.optionalString(input, 'email')?.toLowerCase();

    if (!userId && !email) {
      throw new BadRequestException('userId or email is required');
    }

    const targetUser = userId
      ? await this.prisma.user.findUnique({ where: { id: userId } })
      : await this.prisma.user.findUnique({ where: { email } });

    if (!targetUser || targetUser.status !== 'active' || targetUser.deletedAt) {
      throw new NotFoundException('Active user not found');
    }

    return targetUser;
  }

  private async findAdminRole(roleName: string) {
    const role = await this.prisma.adminRole.findUnique({
      where: { name: roleName },
    });

    if (!role) {
      throw new NotFoundException('Admin role not found');
    }

    return role;
  }

  private assertSuperAdmin(user: AuthUser) {
    if (
      user.adminRole !== 'super_admin' &&
      !user.adminPermissions?.includes('*')
    ) {
      throw new ForbiddenException('Super admin access is required');
    }
  }

  private assertNotSelf(user: AuthUser, targetUserId: string) {
    if (user.id === targetUserId) {
      throw new BadRequestException('You cannot perform this action on your own account');
    }
  }

  private adminStatus(input: AdminPayload, key: string, fallback?: string) {
    const status = this.string(input, key, fallback);

    if (!['active', 'suspended', 'revoked'].includes(status)) {
      throw new BadRequestException(`${key} must be active, suspended, or revoked`);
    }

    return status;
  }

  private artistOperatorStatus(input: AdminPayload, key: string, fallback?: string) {
    const status = this.string(input, key, fallback);

    if (!['active', 'inactive', 'revoked'].includes(status)) {
      throw new BadRequestException(`${key} must be active, inactive, or revoked`);
    }

    return status;
  }

  private refundStatus(input: AdminPayload, key: string, fallback?: string) {
    const status = this.string(input, key, fallback);

    if (!['requested', 'processing', 'succeeded', 'failed', 'cancelled'].includes(status)) {
      throw new BadRequestException(
        `${key} must be requested, processing, succeeded, failed, or cancelled`,
      );
    }

    return status;
  }

  private communityReportStatus(input: AdminPayload, key: string, fallback?: string) {
    const status = this.string(input, key, fallback);

    if (!['submitted', 'reviewing', 'resolved', 'dismissed'].includes(status)) {
      throw new BadRequestException(
        `${key} must be submitted, reviewing, resolved, or dismissed`,
      );
    }

    return status;
  }

  private communityReportAction(input: AdminPayload) {
    const action = this.optionalString(input, 'action') ?? 'none';

    if (!['none', 'hide_post', 'restore_post'].includes(action)) {
      throw new BadRequestException('action must be none, hide_post, or restore_post');
    }

    return action;
  }

  private todayRange() {
    const seoulOffsetMs = 9 * 60 * 60 * 1000;
    const nowInSeoul = new Date(Date.now() + seoulOffsetMs);
    const startUtcMs =
      Date.UTC(
        nowInSeoul.getUTCFullYear(),
        nowInSeoul.getUTCMonth(),
        nowInSeoul.getUTCDate(),
      ) - seoulOffsetMs;

    return {
      start: new Date(startUtcMs),
      end: new Date(startUtcMs + 24 * 60 * 60 * 1000),
    };
  }

  private countRowsToObject<T extends Record<string, unknown>>(rows: T[], key: keyof T) {
    return Object.fromEntries(
      rows.map((row) => [
        String(row[key]),
        this.metadataObject(row._count)._all ?? 0,
      ]),
    );
  }

  private visibility(input: AdminPayload, key: string, fallback: string) {
    const visibility = this.string(input, key, fallback);

    if (!['public', 'private'].includes(visibility)) {
      throw new BadRequestException(`${key} must be public or private`);
    }

    return visibility;
  }

  private assetTypeFromInput(input: AdminPayload, mimeType: string) {
    const value = this.string(input, 'assetType', mimeType.startsWith('video/') ? 'video' : 'image');

    if (!['image', 'video'].includes(value)) {
      throw new BadRequestException('assetType must be image or video');
    }

    if (value === 'image' && !mimeType.startsWith('image/')) {
      throw new BadRequestException('image assets must use an image mimeType');
    }

    if (value === 'video' && !mimeType.startsWith('video/')) {
      throw new BadRequestException('video assets must use a video mimeType');
    }

    return value;
  }

  private allowedMimeType(mimeType: string) {
    const allowed = new Set([
      'image/jpeg',
      'image/png',
      'image/webp',
      'video/mp4',
      'video/webm',
      'video/quicktime',
    ]);

    if (!allowed.has(mimeType)) {
      throw new BadRequestException('mimeType is not allowed');
    }

    return mimeType;
  }

  private fileSizeBytes(input: AdminPayload, assetType: string) {
    const size = this.number(input, 'fileSizeBytes');
    const maxSize =
      assetType === 'video'
        ? this.numberFromEnv('MAX_VIDEO_UPLOAD_BYTES', 524_288_000)
        : this.numberFromEnv('MAX_IMAGE_UPLOAD_BYTES', 20_971_520);

    if (!Number.isInteger(size) || size < 1) {
      throw new BadRequestException('fileSizeBytes must be a positive integer');
    }

    if (size > maxSize) {
      throw new BadRequestException(`fileSizeBytes must be less than or equal to ${maxSize}`);
    }

    return BigInt(size);
  }

  private safeFileName(fileName: string) {
    const cleaned = fileName
      .normalize('NFKD')
      .replace(/[^\w.\-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .toLowerCase();

    if (!cleaned || !cleaned.includes('.')) {
      throw new BadRequestException('fileName must include a safe extension');
    }

    return cleaned.slice(0, 120);
  }

  private buildStorageKey(assetType: string, fileName: string) {
    const date = new Date();
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const prefix = this.storageKeyPrefix();
    const path = `uploads/${assetType}s/${yyyy}/${mm}/${dd}/${randomUUID()}-${fileName}`;

    return prefix ? `${prefix}/${path}` : path;
  }

  private buildUploadUrl(storageProvider: string, storageKey: string, expiresInSeconds: number) {
    if (storageProvider === 'r2' || storageProvider === 's3') {
      return this.buildS3CompatiblePresignedPutUrl(storageProvider, storageKey, expiresInSeconds);
    }

    if (storageProvider !== 'local') {
      throw new BadRequestException('OBJECT_STORAGE_PROVIDER must be local, r2, or s3');
    }

    return `/pending-local-upload/${storageKey}`;
  }

  private async assertObjectUploaded(storageProvider: string, storageKey: string) {
    if (storageProvider === 'local') {
      return;
    }

    if (storageProvider === 'r2' || storageProvider === 's3') {
      const response = await fetch(
        this.buildS3CompatibleSignedHeadUrl(storageProvider, storageKey),
        { method: 'HEAD' },
      );

      if (response.status === 404) {
        throw new BadRequestException('Uploaded object was not found in storage');
      }

      if (!response.ok) {
        throw new BadRequestException('Could not verify uploaded object');
      }

      return;
    }

    throw new BadRequestException('OBJECT_STORAGE_PROVIDER must be local, r2, or s3');
  }

  private buildPublicAssetUrl(storageKey: string) {
    return buildPublicAssetUrl(this.configService, storageKey, null);
  }

  private buildS3CompatiblePresignedPutUrl(
    storageProvider: string,
    storageKey: string,
    expiresInSeconds: number,
  ) {
    const bucket = this.envString('OBJECT_STORAGE_BUCKET');
    const region = this.configService.get<string>('OBJECT_STORAGE_REGION') ?? 'auto';
    const accessKeyId = this.envString('OBJECT_STORAGE_ACCESS_KEY_ID');
    const secretAccessKey = this.envString('OBJECT_STORAGE_SECRET_ACCESS_KEY');
    const now = new Date();
    const amzDate = this.amzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const endpoint = this.buildObjectStorageEndpoint(storageProvider, bucket, region);
    const url = new URL(this.joinUrlPath(endpoint, storageKey));
    const credential = `${accessKeyId}/${scope}`;
    const signedHeaders = 'host';

    const query: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresInSeconds),
      'X-Amz-SignedHeaders': signedHeaders,
    };

    const canonicalQuery = this.canonicalQueryString(query);
    const canonicalRequest = [
      'PUT',
      this.canonicalUri(url.pathname),
      canonicalQuery,
      `host:${url.host}\n`,
      signedHeaders,
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      this.sha256Hex(canonicalRequest),
    ].join('\n');
    const signature = this.hmacHex(
      this.signingKey(secretAccessKey, dateStamp, region, 's3'),
      stringToSign,
    );

    url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;
    return url.toString();
  }

  private buildS3CompatibleSignedHeadUrl(storageProvider: string, storageKey: string) {
    const bucket = this.envString('OBJECT_STORAGE_BUCKET');
    const region = this.configService.get<string>('OBJECT_STORAGE_REGION') ?? 'auto';
    const accessKeyId = this.envString('OBJECT_STORAGE_ACCESS_KEY_ID');
    const secretAccessKey = this.envString('OBJECT_STORAGE_SECRET_ACCESS_KEY');
    const now = new Date();
    const amzDate = this.amzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const endpoint = this.buildObjectStorageEndpoint(storageProvider, bucket, region);
    const url = new URL(this.joinUrlPath(endpoint, storageKey));
    const credential = `${accessKeyId}/${scope}`;
    const signedHeaders = 'host';
    const query: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': '60',
      'X-Amz-SignedHeaders': signedHeaders,
    };
    const canonicalQuery = this.canonicalQueryString(query);
    const canonicalRequest = [
      'HEAD',
      this.canonicalUri(url.pathname),
      canonicalQuery,
      `host:${url.host}\n`,
      signedHeaders,
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      this.sha256Hex(canonicalRequest),
    ].join('\n');
    const signature = this.hmacHex(
      this.signingKey(secretAccessKey, dateStamp, region, 's3'),
      stringToSign,
    );

    url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;
    return url.toString();
  }

  private buildObjectStorageEndpoint(storageProvider: string, bucket: string, region: string) {
    const configuredEndpoint = this.configService.get<string>('OBJECT_STORAGE_ENDPOINT');

    if (configuredEndpoint) {
      return `${configuredEndpoint.replace(/\/+$/, '')}/${bucket}`;
    }

    if (storageProvider === 's3') {
      return `https://${bucket}.s3.${region}.amazonaws.com`;
    }

    throw new BadRequestException('OBJECT_STORAGE_ENDPOINT is required for r2 storage');
  }

  private joinUrlPath(baseUrl: string, storageKey: string) {
    return `${baseUrl.replace(/\/+$/, '')}/${storageKey
      .split('/')
      .map((part) => this.rfc3986Encode(part))
      .join('/')}`;
  }

  private canonicalUri(pathname: string) {
    return pathname
      .split('/')
      .map((part) => this.rfc3986Encode(decodeURIComponent(part)))
      .join('/');
  }

  private canonicalQueryString(query: Record<string, string>) {
    return Object.entries(query)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${this.rfc3986Encode(key)}=${this.rfc3986Encode(value)}`)
      .join('&');
  }

  private rfc3986Encode(value: string) {
    return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  }

  private amzDate(date: Date) {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  }

  private sha256Hex(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private signingKey(secretAccessKey: string, dateStamp: string, region: string, service: string) {
    const dateKey = this.hmacBuffer(`AWS4${secretAccessKey}`, dateStamp);
    const dateRegionKey = this.hmacBuffer(dateKey, region);
    const dateRegionServiceKey = this.hmacBuffer(dateRegionKey, service);
    return this.hmacBuffer(dateRegionServiceKey, 'aws4_request');
  }

  private hmacBuffer(key: string | Buffer, value: string) {
    return createHmac('sha256', key).update(value).digest();
  }

  private hmacHex(key: string | Buffer, value: string) {
    return createHmac('sha256', key).update(value).digest('hex');
  }

  private envString(key: string) {
    const value = this.configService.get<string>(key);

    if (!value) {
      throw new BadRequestException(`${key} environment variable is required`);
    }

    return value;
  }

  private storageKeyPrefix() {
    const value = this.configService.get<string>('OBJECT_STORAGE_KEY_PREFIX');

    if (!value) {
      return '';
    }

    return value
      .trim()
      .replace(/^\/+|\/+$/g, '')
      .replace(/\/+/g, '/')
      .split('/')
      .map((part) =>
        part
          .normalize('NFKD')
          .replace(/[^\w.\-]+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^[-.]+|[-.]+$/g, '')
          .toLowerCase(),
      )
      .filter(Boolean)
      .join('/');
  }

  private numberFromEnv(key: string, fallback: number) {
    const value = this.configService.get<string>(key);

    if (!value) {
      return fallback;
    }

    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new BadRequestException(`${key} must be a positive number`);
    }

    return parsed;
  }

  private string(input: AdminPayload, key: string, fallback?: string) {
    const value = input[key] ?? fallback;

    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${key} must be a non-empty string`);
    }

    return value.trim();
  }

  private optionalString(input: AdminPayload, key: string) {
    const value = input[key];
    return typeof value === 'string' ? value.trim() : undefined;
  }

  private optionalStringArray(input: AdminPayload, key: string) {
    const value = input[key];

    if (value === undefined) {
      return undefined;
    }

    if (
      !Array.isArray(value) ||
      value.some((item) => typeof item !== 'string' || !item.trim())
    ) {
      throw new BadRequestException(`${key} must be an array of non-empty strings`);
    }

    return value.map((item) => item.trim());
  }

  private isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private number(input: AdminPayload, key: string, fallback?: number) {
    const value = input[key] ?? fallback;
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      throw new BadRequestException(`${key} must be a number`);
    }

    return parsed;
  }

  private boolean(input: AdminPayload, key: string, fallback: boolean) {
    const value = input[key] ?? fallback;

    if (typeof value === 'boolean') {
      return value;
    }

    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    throw new BadRequestException(`${key} must be a boolean`);
  }

  private assetRole(input: AdminPayload, key: string, fallback: string) {
    const value = this.string(input, key, fallback);

    if (!/^[a-z][a-z0-9_-]{1,40}$/.test(value)) {
      throw new BadRequestException(`${key} must be a safe role string`);
    }

    return value;
  }

  private optionalNumber(input: AdminPayload, key: string) {
    return input[key] === undefined ? undefined : this.number(input, key);
  }

  private adminPagination(input: AdminPayload, fallback = 50) {
    const take = Math.max(1, Math.min(this.number(input, 'take', fallback), 100));
    const cursor = this.optionalString(input, 'cursor');

    if (cursor && !this.isUuid(cursor)) {
      throw new BadRequestException('cursor must be a UUID');
    }

    const cursorArgs: Record<string, unknown> = cursor
      ? {
          cursor: { id: cursor },
          skip: 1,
        }
      : {};

    return {
      take,
      takeForQuery: take + 1,
      cursorArgs,
    };
  }

  private paginated<T extends { id: string }>(rows: T[], take: number) {
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const lastItem = items.at(-1);

    return {
      items,
      count: items.length,
      hasMore,
      nextCursor: hasMore && lastItem ? lastItem.id : null,
    };
  }

  private decimal(input: AdminPayload, key: string, fallback?: number) {
    const value = input[key] ?? fallback;

    try {
      return new Decimal(value as string | number);
    } catch {
      throw new BadRequestException(`${key} must be a decimal`);
    }
  }

  private optionalDecimal(input: AdminPayload, key: string) {
    return input[key] === undefined ? undefined : this.decimal(input, key);
  }

  private date(input: AdminPayload, key: string) {
    const value = input[key];
    const date = new Date(String(value));

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${key} must be a valid date`);
    }

    return date;
  }

  private optionalDate(input: AdminPayload, key: string) {
    return input[key] === undefined ? undefined : this.date(input, key);
  }

  private optionalBigInt(input: AdminPayload, key: string) {
    return input[key] === undefined ? undefined : BigInt(String(input[key]));
  }

  private json(input: AdminPayload, key: string) {
    return (input[key] ?? {}) as object;
  }

  private optionalJson(input: AdminPayload, key: string) {
    return input[key] === undefined ? undefined : this.json(input, key);
  }

  private metadataObject(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as AdminPayload)
      : {};
  }

  private object(input: AdminPayload, key: string) {
    const value = input[key];
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as AdminPayload)
      : undefined;
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

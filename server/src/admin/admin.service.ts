import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SettlementLuminaConversionRequest, SettlementRecord } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { createHash, createHmac, randomUUID } from 'crypto';
import { AuthUser } from '../auth/auth.types';
import {
  ARTIST_URL_KNOWLEDGE_CONTRACT,
  ARTIST_URL_KNOWLEDGE_STATUSES,
  buildArtistKnowledgeAuditPayload,
  isArtistKnowledgeSourceType,
  normalizeArtistKnowledgeSummary,
} from '../chat/artist-url-knowledge-contract';
import { buildPublicAssetUrl } from '../common/asset-url';
import { PrismaService } from '../prisma/prisma.service';

type AdminPayload = Record<string, unknown>;
type AuditQuery = Record<string, string | undefined>;
const BACKSTAGE_FAN_MISSION_INCLUDE = {
  artist: {
    select: {
      id: true,
      slug: true,
      displayName: true,
      status: true,
    },
  },
} satisfies Prisma.FanMissionInclude;
const AUTH_ACTION_TOKEN_AUDIT_INCLUDE = {
  user: {
    select: {
      id: true,
      email: true,
      status: true,
      deletedAt: true,
      emailVerifiedAt: true,
    },
  },
} satisfies Prisma.UserActionTokenInclude;

type BackstageFanMission = Prisma.FanMissionGetPayload<{
  include: typeof BACKSTAGE_FAN_MISSION_INCLUDE;
}>;
type AuthActionTokenAuditRow = Prisma.UserActionTokenGetPayload<{
  include: typeof AUTH_ACTION_TOKEN_AUDIT_INCLUDE;
}>;

type SettlementComplianceUser = {
  id: string;
  phoneNumber: string | null;
  identityVerification: {
    status: string;
    provider: string | null;
    verifiedNameMasked: string | null;
    verifiedAt: Date | null;
    expiresAt: Date | null;
  } | null;
  payoutAccount: {
    status: string;
    bankName: string | null;
    accountHolderMasked: string | null;
    accountLast4: string | null;
    holderMatchesIdentity: boolean;
    updatedAt: Date;
  } | null;
  payoutException: {
    status: string;
    reason: string | null;
    documentAttached: boolean;
    approvedByUserId: string | null;
    approvedAt: Date | null;
    updatedAt: Date;
  } | null;
};
type SettlementComplianceSummary = {
  identityVerification: {
    status: string;
    provider: string | null;
    verifiedNameMasked: string | null;
    verifiedAt: Date | null;
    expiresAt: Date | null;
  };
  payoutAccount: {
    status: string;
    bankName: string | null;
    accountHolderMasked: string | null;
    accountLast4: string | null;
    holderMatchesIdentity: boolean;
    updatedAt: Date | null;
  };
  payoutException: {
    status: string;
    reason: string | null;
    documentAttached: boolean;
    approvedByUserId: string | null;
    approvedAt: Date | null;
    updatedAt: Date | null;
  };
  eligibility: {
    identityVerified: boolean;
    payoutReady: boolean;
    payoutExceptionApproved: boolean;
    canReceiveSettlement: boolean;
  };
};
type SettlementConversionRequester = {
  id: string;
  email: string | null;
  status: string;
  profile: {
    displayName: string | null;
    publicHandle: string | null;
    avatarAssetId: string | null;
  } | null;
};

const SETTLEMENT_STATUSES = new Set([
  'estimated',
  'ready',
  'hold',
  'paid',
  'recheck',
  'cancelled',
]);

const SETTLEMENT_TYPES = new Set(['artist', 'partner']);
const SETTLEMENT_CONVERSION_STATUSES = new Set([
  'requested',
  'approved',
  'rejected',
  'credited',
  'cancelled',
]);
const SETTLEMENT_CONVERSION_MUTATION_STATUSES = new Set([
  'approved',
  'rejected',
  'credited',
  'cancelled',
]);
const DEFAULT_CURRENCY = 'LUMINA';
const FEED_SEARCH_LANGUAGES = new Set(['all', 'ko', 'ja', 'en', 'zh', 'unknown']);
const FEED_SEARCH_TYPES = new Set(['all', 'text', 'hashtag']);
const FEED_SEARCH_BLOCKED_TERM_STATUSES = new Set(['active', 'inactive', 'archived']);
const FAN_MISSION_STATUSES = new Set(['draft', 'active', 'inactive', 'archived']);
const FAN_MISSION_ARCHIVE_STATUSES = new Set(['inactive', 'archived']);
const FAN_MISSION_SURFACES = new Set([
  'home',
  'artist_detail',
  'feed',
  'mypage',
  'creator_studio_hint',
]);
const AUTH_ACTION_TOKEN_PURPOSES = new Set([
  'email_verification',
  'password_reset',
]);
const AUTH_ACTION_TOKEN_STATUSES = new Set([
  'all',
  'pending',
  'consumed',
  'expired',
]);
const AUTH_ACTION_TOKEN_DELIVERY_STATUSES = new Set([
  'all',
  'not_recorded',
  'pending',
  'accepted',
  'not_configured',
  'failed',
]);
const AUTH_ACTION_TOKEN_DELIVERY_PROVIDERS = new Set([
  'all',
  'none',
  'resend',
  'sendgrid',
]);
const FAN_MISSION_NON_CASH_POLICY = {
  cashLike: false,
  luminaAmount: 0,
  settlementEligible: false,
  transferable: false,
};
const FAN_MISSION_FORBIDDEN_REWARD_KEYS = [
  'amount',
  'cash',
  'cashlike',
  'currency',
  'lumina',
  'luminaamount',
  'paidlike',
  'payout',
  'pricelumina',
  'revenue',
  'settlement',
  'settlementeligible',
  'transferable',
  'wallet',
];
const FEED_SEARCH_WINDOWS: Record<string, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};
const WALLET_ADJUSTMENT_REASONS = new Set([
  'event_grant',
  'abuse_reversal',
  'refund_correction',
  'customer_support',
  'qa_test',
  'manual_correction',
]);
const WALLET_ADJUSTMENT_PLACEHOLDER_NOTES = new Set(['백스테이지 운영 처리']);

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getBackstageObjectStorageDiagnostics() {
    const storageProvider =
      this.configService.get<string>('OBJECT_STORAGE_PROVIDER') ?? 'local';
    const bucket = this.configService.get<string>('OBJECT_STORAGE_BUCKET');
    const region = this.configService.get<string>('OBJECT_STORAGE_REGION') ?? null;
    const endpoint = this.configService.get<string>('OBJECT_STORAGE_ENDPOINT');
    const publicBaseUrl = this.configService.get<string>('OBJECT_STORAGE_PUBLIC_BASE_URL');
    const accessKeyId = this.configService.get<string>('OBJECT_STORAGE_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>(
      'OBJECT_STORAGE_SECRET_ACCESS_KEY',
    );
    const keyPrefix = this.normalizedObjectStorageKeyPrefix();
    const uploadIntentTtlSeconds = this.positiveEnvNumber(
      'OBJECT_UPLOAD_INTENT_TTL_SECONDS',
      900,
    );
    const maxImageUploadBytes = this.positiveEnvNumber(
      'MAX_IMAGE_UPLOAD_BYTES',
      8 * 1024 * 1024,
    );
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const userImageIntentWhere: Prisma.AssetWhereInput = {
      assetType: 'image',
      createdAt: { gte: since },
      metadata: {
        path: ['uploadIntent', 'scope'],
        equals: 'user_image',
      },
    };

    const [total, pendingUpload, uploaded] = await Promise.all([
      this.prisma.asset.count({ where: userImageIntentWhere }),
      this.prisma.asset.count({
        where: {
          AND: [
            userImageIntentWhere,
            {
              metadata: {
                path: ['uploadIntent', 'status'],
                equals: 'pending_upload',
              },
            },
          ],
        },
      }),
      this.prisma.asset.count({
        where: {
          AND: [
            userImageIntentWhere,
            {
              metadata: {
                path: ['uploadIntent', 'status'],
                equals: 'uploaded',
              },
            },
          ],
        },
      }),
    ]);

    const requiredEnvChecks: Array<[string, string | undefined]> = [
      ['OBJECT_STORAGE_BUCKET', bucket],
      ['OBJECT_STORAGE_ACCESS_KEY_ID', accessKeyId],
      ['OBJECT_STORAGE_SECRET_ACCESS_KEY', secretAccessKey],
    ];
    const missingRequiredEnv = requiredEnvChecks
      .filter(([, value]) => !value)
      .map(([key]) => key);
    const missingDisplayEnv = publicBaseUrl ? [] : ['OBJECT_STORAGE_PUBLIC_BASE_URL'];
    const missingR2Env =
      storageProvider === 'r2' && !endpoint ? ['OBJECT_STORAGE_ENDPOINT'] : [];
    const isDirectUploadProvider = storageProvider === 's3' || storageProvider === 'r2';
    const readyForDirectUpload =
      isDirectUploadProvider &&
      missingRequiredEnv.length === 0 &&
      missingR2Env.length === 0;

    return {
      generatedAt: new Date().toISOString(),
      reason: this.objectStorageDiagnosticReason({
        storageProvider,
        readyForDirectUpload,
        missingRequiredEnv,
        missingDisplayEnv,
        missingR2Env,
      }),
      environment: {
        storageProvider,
        directUploadMode: isDirectUploadProvider
          ? 's3_compatible_presigned_put'
          : 'metadata_only',
        bucketConfigured: Boolean(bucket),
        region,
        endpointConfigured: Boolean(endpoint),
        publicBaseUrlConfigured: Boolean(publicBaseUrl),
        accessKeyConfigured: Boolean(accessKeyId),
        secretKeyConfigured: Boolean(secretAccessKey),
        keyPrefix: keyPrefix || null,
        uploadIntentTtlSeconds,
        maxImageUploadBytes,
        expectedUploadSignedHeaders: isDirectUploadProvider
          ? 'content-type;host'
          : null,
      },
      recentUserImageUploads24h: {
        total,
        pendingUpload,
        uploaded,
        failedOrUnconfirmed: Math.max(total - uploaded, 0),
      },
      warnings: [...missingRequiredEnv, ...missingDisplayEnv, ...missingR2Env].map(
        (key) => `${key} is not configured`,
      ),
      nextActions: this.objectStorageDiagnosticNextActions({
        storageProvider,
        readyForDirectUpload,
        missingRequiredEnv,
        missingDisplayEnv,
        missingR2Env,
      }),
      policy: {
        userUploadIntentEndpoint: 'POST /api/v1/me/assets/upload-intents',
        confirmUploadEndpoint: 'POST /api/v1/me/assets/:assetId/confirm-upload',
        requiredPutHeader: 'content-type',
        secretsReturned: false,
      },
    };
  }

  async getBackstageFanMissions(user: AuthUser, query: AuditQuery) {
    this.assertSuperAdmin(user);
    const pagination = this.adminPagination(query);
    const status = this.optionalString(query, 'status');
    const surface = this.optionalString(query, 'surface');
    const artistId = this.optionalString(query, 'artistId');
    const slug = this.optionalString(query, 'slug');

    if (status && !FAN_MISSION_STATUSES.has(status)) {
      throw this.adminBadRequest(
        'FAN_MISSION_INVALID_STATUS',
        'Invalid fan mission status',
        'admin.fanEngagement.mission.invalidStatus',
        { allowed: [...FAN_MISSION_STATUSES] },
      );
    }

    if (surface && !FAN_MISSION_SURFACES.has(surface)) {
      throw this.adminBadRequest(
        'FAN_MISSION_INVALID_SURFACE',
        'Invalid fan mission surface',
        'admin.fanEngagement.mission.invalidSurface',
        { allowed: [...FAN_MISSION_SURFACES] },
      );
    }

    if (artistId && !this.isUuid(artistId)) {
      throw this.adminBadRequest(
        'FAN_MISSION_INVALID_ARTIST_ID',
        'artistId must be a UUID',
        'admin.fanEngagement.mission.invalidArtistId',
      );
    }

    const where: Prisma.FanMissionWhereInput = this.clean({
      status,
      artistId,
      slug: slug ? { contains: slug, mode: 'insensitive' } : undefined,
      OR: surface
        ? [{ surfaces: { has: surface } }, { surfaces: { isEmpty: true } }]
        : undefined,
    });

    const [rows, total] = await Promise.all([
      this.prisma.fanMission.findMany({
        where,
        take: pagination.takeForQuery,
        ...pagination.cursorArgs,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: BACKSTAGE_FAN_MISSION_INCLUDE,
      }),
      this.prisma.fanMission.count({ where }),
    ]);
    const page = this.paginated(rows, pagination.take);

    return {
      ...page,
      items: page.items.map((mission) => this.backstageFanMission(mission)),
      total,
      policy: this.fanMissionNonCashPolicy(),
      filters: {
        status: status ?? null,
        surface: surface ?? null,
        artistId: artistId ?? null,
        slug: slug ?? null,
      },
    };
  }

  async createBackstageFanMission(user: AuthUser, input: AdminPayload) {
    this.assertSuperAdmin(user);
    const data = await this.backstageFanMissionCreateData(input);
    const existing = await this.prisma.fanMission.findUnique({
      where: { slug: data.slug },
      select: { id: true },
    });

    if (existing) {
      throw this.adminConflict(
        'FAN_MISSION_SLUG_EXISTS',
        'Fan mission slug already exists',
        'admin.fanEngagement.mission.slugExists',
        { slug: data.slug },
      );
    }

    const mission = await this.createFanMissionWithStableDuplicateError(data);

    await this.recordAudit(
      user,
      'fan_mission.create',
      'fan_mission',
      mission.id,
      null,
      this.backstageFanMission(mission),
      { policy: this.fanMissionNonCashPolicy() },
    );

    return {
      mission: this.backstageFanMission(mission),
      publicReadiness: this.fanMissionPublicReadiness(mission),
      policy: this.fanMissionNonCashPolicy(),
    };
  }

  async archiveBackstageFanMission(
    user: AuthUser,
    missionId: string,
    input: AdminPayload,
  ) {
    this.assertSuperAdmin(user);

    if (!this.isUuid(missionId)) {
      throw this.adminBadRequest(
        'FAN_MISSION_INVALID_ID',
        'missionId must be a UUID',
        'admin.fanEngagement.mission.invalidId',
      );
    }

    const before = await this.prisma.fanMission.findUnique({
      where: { id: missionId },
      include: BACKSTAGE_FAN_MISSION_INCLUDE,
    });

    if (!before) {
      throw this.adminNotFound(
        'FAN_MISSION_NOT_FOUND',
        'Fan mission not found',
        'admin.fanEngagement.mission.notFound',
      );
    }

    const nextStatus = this.optionalString(input, 'status') ?? 'archived';

    if (!FAN_MISSION_ARCHIVE_STATUSES.has(nextStatus)) {
      throw this.adminBadRequest(
        'FAN_MISSION_INVALID_ARCHIVE_STATUS',
        'Archive status must be inactive or archived',
        'admin.fanEngagement.mission.invalidArchiveStatus',
        { allowed: [...FAN_MISSION_ARCHIVE_STATUSES] },
      );
    }

    const mission = await this.prisma.fanMission.update({
      where: { id: missionId },
      data: {
        status: nextStatus,
        updatedAt: new Date(),
      },
      include: BACKSTAGE_FAN_MISSION_INCLUDE,
    });

    await this.recordAudit(
      user,
      'fan_mission.archive',
      'fan_mission',
      mission.id,
      this.backstageFanMission(before),
      this.backstageFanMission(mission),
      {
        reason: this.optionalString(input, 'reason') ?? null,
        policy: this.fanMissionNonCashPolicy(),
      },
    );

    return {
      mission: this.backstageFanMission(mission),
      archived: mission.status === 'archived',
      deactivated: mission.status === 'inactive',
      policy: this.fanMissionNonCashPolicy(),
    };
  }

  getAdminRoles() {
    return this.prisma.adminRole.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async getAdminMe(user: AuthUser) {
    const adminUser = await this.prisma.adminUser.findUnique({
      where: { userId: user.id },
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
      },
    });

    return {
      user: {
        id: user.id,
        email: user.email ?? adminUser?.user.email ?? null,
      },
      admin: adminUser
        ? {
            id: adminUser.id,
            status: adminUser.status,
            role: adminUser.role.name,
            permissions: adminUser.role.permissions,
            lastAccessAt: adminUser.lastAccessAt,
            source: 'admin_users',
          }
        : {
            id: null,
            status: 'active',
            role: user.adminRole ?? null,
            permissions: user.adminPermissions ?? [],
            lastAccessAt: null,
            source: 'bootstrap_admin_emails',
          },
      policy: {
        permissionRule:
          'A permission ending in :write also grants the matching :read route. * grants every admin route.',
        roleNames: [
          'super_admin',
          'accounting_admin',
          'sales_admin',
          'cs_admin',
          'ai_artist_admin',
          'content_admin',
          'commerce_admin',
        ],
      },
    };
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

  async getBackstageFeedSearchAnalytics(query: AuditQuery) {
    const take = Math.max(1, Math.min(this.number(query, 'take', 20), 50));
    const language = this.feedSearchLanguage(query.language ?? query.locale);
    const searchType = this.feedSearchType(query.type);
    const window = this.feedSearchWindow(query.window);
    const search = this.optionalString(query, 'query') ?? this.optionalString(query, 'q');
    const since = new Date(Date.now() - window.ms);
    const where: Prisma.FeedSearchEventWhereInput = this.clean({
      createdAt: { gte: since },
      language: language === 'all' ? undefined : language,
      searchType: searchType === 'all' ? undefined : searchType,
      normalizedKeyword: search
        ? { contains: search.trim().toLocaleLowerCase(), mode: 'insensitive' }
        : undefined,
    });
    const [grouped, recentEvents, totalEvents, zeroResultCount] = await Promise.all([
      this.prisma.feedSearchEvent.groupBy({
        by: ['normalizedKeyword', 'searchType', 'language'],
        where,
        _count: { _all: true },
        _sum: { resultCount: true },
        _max: { createdAt: true },
        orderBy: [{ _count: { normalizedKeyword: 'desc' } }, { _max: { createdAt: 'desc' } }],
        take,
      }),
      this.prisma.feedSearchEvent.findMany({
        where,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          keyword: true,
          normalizedKeyword: true,
          searchType: true,
          language: true,
          resultCount: true,
          userId: true,
          createdAt: true,
        },
      }),
      this.prisma.feedSearchEvent.count({ where }),
      this.prisma.feedSearchEvent.count({
        where: {
          ...where,
          resultCount: 0,
        },
      }),
    ]);
    const latestEvents = grouped.length
      ? await this.prisma.feedSearchEvent.findMany({
          where: {
            OR: grouped.map((item) => ({
              normalizedKeyword: item.normalizedKeyword,
              searchType: item.searchType,
              language: item.language,
            })),
          },
          orderBy: { createdAt: 'desc' },
          distinct: ['normalizedKeyword', 'searchType', 'language'],
          select: {
            keyword: true,
            normalizedKeyword: true,
            searchType: true,
            language: true,
          },
        })
      : [];
    const latestMap = new Map(
      latestEvents.map((event) => [
        this.feedSearchAnalyticsKey(
          event.normalizedKeyword,
          event.searchType,
          event.language,
        ),
        event.keyword,
      ]),
    );

    return {
      generatedAt: new Date(),
      filters: {
        language,
        type: searchType,
        query: search ?? null,
        window: {
          key: window.key,
          since,
          minutes: Math.round(window.ms / 60_000),
        },
      },
      summary: {
        totalEvents,
        zeroResultCount,
        zeroResultRate: totalEvents > 0 ? zeroResultCount / totalEvents : 0,
        groupedCount: grouped.length,
      },
      items: grouped.map((item, index) => ({
        rank: index + 1,
        keyword:
          latestMap.get(
            this.feedSearchAnalyticsKey(
              item.normalizedKeyword,
              item.searchType,
              item.language,
            ),
          ) ?? item.normalizedKeyword,
        normalizedKeyword: item.normalizedKeyword,
        type: item.searchType,
        language: item.language,
        searchCount: item._count._all,
        totalResultCount: item._sum.resultCount ?? 0,
        averageResultCount:
          item._count._all > 0
            ? Number(item._sum.resultCount ?? 0) / item._count._all
            : 0,
        lastSearchedAt: item._max.createdAt,
      })),
      recentEvents,
      policy: {
        source: 'feed_search_events',
        realtimeApproximation: true,
        supportedLanguages: ['all', 'ko', 'ja', 'en', 'zh', 'unknown'],
        supportedTypes: ['all', 'text', 'hashtag'],
        supportedWindows: Object.keys(FEED_SEARCH_WINDOWS),
        privacy: 'visitor hashes are not exposed',
      },
    };
  }

  async getBackstageFeedSearchBlockedTerms(query: AuditQuery) {
    const pagination = this.adminPagination(query, 20);
    const language = this.feedSearchLanguage(query.language ?? query.locale);
    const searchType = this.feedSearchType(query.type);
    const status = this.optionalString(query, 'status') ?? 'active';
    const search = this.optionalString(query, 'query') ?? this.optionalString(query, 'q');

    if (status !== 'all' && !FEED_SEARCH_BLOCKED_TERM_STATUSES.has(status)) {
      throw new BadRequestException('status must be all, active, inactive, or archived');
    }

    const where: Prisma.FeedSearchBlockedTermWhereInput = this.clean({
      status: status === 'all' ? undefined : status,
      language: language === 'all' ? undefined : language,
      searchType: searchType === 'all' ? undefined : searchType,
      OR: search
        ? [
            { keyword: { contains: search, mode: 'insensitive' } },
            {
              normalizedKeyword: {
                contains: this.normalizeFeedSearchBlockedKeyword(search, searchType),
                mode: 'insensitive',
              },
            },
          ]
        : undefined,
    });
    const [rows, total, statusCounts] = await Promise.all([
      this.prisma.feedSearchBlockedTerm.findMany({
        where,
        take: pagination.takeForQuery,
        ...pagination.cursorArgs,
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        include: {
          createdByUser: {
            select: {
              id: true,
              email: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.feedSearchBlockedTerm.count({ where }),
      this.prisma.feedSearchBlockedTerm.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);
    const page = this.paginated(rows, pagination.take);

    return {
      generatedAt: new Date(),
      ...page,
      total,
      items: page.items.map((item) => ({
        id: item.id,
        keyword: item.keyword,
        normalizedKeyword: item.normalizedKeyword,
        type: item.searchType,
        language: item.language,
        status: item.status,
        reason: item.reason,
        createdByUserId: item.createdByUserId,
        updatedByUserId: item.updatedByUserId,
        createdByUser: item.createdByUser,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      summary: {
        byStatus: this.countRowsToObject(statusCounts, 'status'),
      },
      filters: {
        language,
        type: searchType,
        status,
        query: search ?? null,
      },
      policy: this.feedSearchBlockedTermsPolicy(),
    };
  }

  async createBackstageFeedSearchBlockedTerm(user: AuthUser, body: AdminPayload) {
    const keyword = this.feedSearchBlockedKeyword(body.keyword);
    const searchType = this.feedSearchType(body.type ?? body.searchType);
    const language = this.feedSearchLanguage(body.language ?? body.locale);
    const status = this.feedSearchBlockedTermStatus(body.status ?? 'active');
    const normalizedKeyword = this.normalizeFeedSearchBlockedKeyword(keyword, searchType);
    const reason = body.reason === null ? null : this.optionalString(body, 'reason') ?? null;

    try {
      const created = await this.prisma.feedSearchBlockedTerm.create({
        data: {
          keyword,
          normalizedKeyword,
          searchType,
          language,
          status,
          reason,
          createdByUserId: user.id,
          updatedByUserId: user.id,
        },
      });

      await this.recordAudit(
        user,
        'feed_search_blocked_term.create',
        'feed_search_blocked_term',
        created.id,
        null,
        created,
        { keyword, normalizedKeyword, searchType, language, status },
      );

      return {
        ok: true,
        item: created,
        policy: this.feedSearchBlockedTermsPolicy(),
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'Blocked search term already exists for this type and language',
        );
      }

      throw error;
    }
  }

  async updateBackstageFeedSearchBlockedTerm(
    user: AuthUser,
    termId: string,
    body: AdminPayload,
  ) {
    if (!this.isUuid(termId)) {
      throw new BadRequestException('termId must be a UUID');
    }

    const before = await this.prisma.feedSearchBlockedTerm.findUnique({
      where: { id: termId },
    });

    if (!before) {
      throw new NotFoundException('Blocked search term not found');
    }

    const keyword =
      body.keyword === undefined ? before.keyword : this.feedSearchBlockedKeyword(body.keyword);
    const searchType =
      body.type === undefined && body.searchType === undefined
        ? before.searchType
        : this.feedSearchType(body.type ?? body.searchType);
    const language =
      body.language === undefined && body.locale === undefined
        ? before.language
        : this.feedSearchLanguage(body.language ?? body.locale);
    const normalizedKeyword = this.normalizeFeedSearchBlockedKeyword(keyword, searchType);
    const data: Prisma.FeedSearchBlockedTermUpdateInput = this.clean({
      keyword: body.keyword === undefined ? undefined : keyword,
      normalizedKeyword:
        body.keyword === undefined && body.type === undefined && body.searchType === undefined
          ? undefined
          : normalizedKeyword,
      searchType:
        body.type === undefined && body.searchType === undefined ? undefined : searchType,
      language: body.language === undefined && body.locale === undefined ? undefined : language,
      status:
        body.status === undefined
          ? undefined
          : this.feedSearchBlockedTermStatus(body.status),
      reason:
        body.reason === undefined
          ? undefined
          : body.reason === null
            ? null
            : this.optionalString(body, 'reason') ?? null,
      updatedByUserId: user.id,
      updatedAt: new Date(),
    });

    try {
      const updated = await this.prisma.feedSearchBlockedTerm.update({
        where: { id: termId },
        data,
      });

      await this.recordAudit(
        user,
        'feed_search_blocked_term.update',
        'feed_search_blocked_term',
        updated.id,
        before,
        updated,
        { status: updated.status, searchType: updated.searchType, language: updated.language },
      );

      return {
        ok: true,
        item: updated,
        policy: this.feedSearchBlockedTermsPolicy(),
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'Blocked search term already exists for this type and language',
        );
      }

      throw error;
    }
  }

  async getBackstageCreatorAccess(query: AuditQuery) {
    const pagination = this.adminPagination(query, 20);
    const search = this.optionalString(query, 'query') ?? this.optionalString(query, 'q');
    const status = this.optionalString(query, 'status');
    const artistId = this.optionalString(query, 'artistId');
    const artistSlug = this.optionalString(query, 'artistSlug') ?? this.optionalString(query, 'slug');
    const userId = this.optionalString(query, 'userId');
    const email = this.optionalString(query, 'email')?.toLowerCase();

    if (artistId && !this.isUuid(artistId)) {
      throw new BadRequestException('artistId must be a UUID');
    }

    if (userId && !this.isUuid(userId)) {
      throw new BadRequestException('userId must be a UUID');
    }

    const where: Prisma.ArtistOperatorWhereInput = this.clean({
      status,
      artistId,
      userId,
      artist: artistSlug ? { slug: artistSlug } : undefined,
      user: email ? { email } : undefined,
      OR: search
        ? [
            { user: { email: { contains: search, mode: 'insensitive' } } },
            { user: { profile: { displayName: { contains: search, mode: 'insensitive' } } } },
            { user: { profile: { publicHandle: { contains: search, mode: 'insensitive' } } } },
            { artist: { slug: { contains: search, mode: 'insensitive' } } },
            { artist: { displayName: { contains: search, mode: 'insensitive' } } },
            { role: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    });

    const rows = await this.prisma.artistOperator.findMany({
      where,
      take: pagination.takeForQuery,
      ...pagination.cursorArgs,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }, { createdAt: 'desc' }],
      include: this.artistOperatorInclude(),
    });
    const page = this.paginated(rows, pagination.take);

    return {
      generatedAt: new Date(),
      ...page,
      items: page.items.map((operator) => this.creatorAccessItem(operator)),
      policy: this.creatorAccessPolicy(),
    };
  }

  async getBackstageCreatorAccessDiagnostics(query: AuditQuery) {
    const userId = this.optionalString(query, 'userId');
    const email = this.optionalString(query, 'email')?.toLowerCase();

    if (!userId && !email) {
      throw new BadRequestException('userId or email is required');
    }

    if (userId && !this.isUuid(userId)) {
      throw new BadRequestException('userId must be a UUID');
    }

    const users = await this.prisma.user.findMany({
      where: this.clean({
        id: userId,
        email,
      }),
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        status: true,
        deletedAt: true,
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
            providerUserId: true,
            lastLoginAt: true,
            createdAt: true,
          },
          orderBy: [{ lastLoginAt: 'desc' }, { createdAt: 'desc' }],
        },
        artistOperators: {
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
          include: {
            artist: {
              select: {
                id: true,
                slug: true,
                displayName: true,
                status: true,
              },
            },
          },
        },
        debutApplications: {
          where: { status: 'approved' },
          orderBy: { updatedAt: 'desc' },
          take: 3,
          select: {
            id: true,
            applicantName: true,
            displayName: true,
            contactEmail: true,
            participationType: true,
            updatedAt: true,
          },
        },
        adminAccess: {
          select: {
            id: true,
            status: true,
            role: {
              select: {
                name: true,
                permissions: true,
              },
            },
          },
        },
      },
    });
    const exactMatchCount = users.length;
    const activeUsers = users.filter(
      (user) => user.status === 'active' && user.deletedAt === null,
    );
    const activeOperators = users.flatMap((user) =>
      user.artistOperators.filter(
        (operator) => operator.status === 'active' && operator.revokedAt === null,
      ),
    );
    const activeApprovedApplications = activeUsers.flatMap(
      (user) => user.debutApplications,
    );
    const activeAdminUsers = activeUsers.filter(
      (user) => user.adminAccess?.status === 'active',
    );
    const latestAuthAccount = users
      .flatMap((user) =>
        user.authAccounts.map((account) => ({
          userId: user.id,
          email: user.email,
          ...account,
        })),
      )
      .sort((left, right) => {
        const leftAt = left.lastLoginAt?.getTime() ?? left.createdAt.getTime();
        const rightAt = right.lastLoginAt?.getTime() ?? right.createdAt.getTime();
        return rightAt - leftAt;
      })[0] ?? null;
    const accessEnabled =
      activeUsers.length > 0 &&
      (activeOperators.length > 0 ||
        activeApprovedApplications.length > 0 ||
        activeAdminUsers.length > 0);

    return {
      generatedAt: new Date(),
      query: {
        userId: userId ?? null,
        email: email ?? null,
      },
      result: {
        accessEnabled,
        reason: this.creatorAccessDiagnosticReason({
          exactMatchCount,
          activeUsersCount: activeUsers.length,
          activeOperatorsCount: activeOperators.length,
          approvedApplicationsCount: activeApprovedApplications.length,
          activeAdminUsersCount: activeAdminUsers.length,
          totalOperatorsCount: users.reduce(
            (sum, user) => sum + user.artistOperators.length,
            0,
          ),
        }),
        exactMatchCount,
        activeUsersCount: activeUsers.length,
        activeOperatorsCount: activeOperators.length,
        approvedApplicationsCount: activeApprovedApplications.length,
        activeAdminUsersCount: activeAdminUsers.length,
        latestAuthAccount,
      },
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        status: user.status,
        deletedAt: user.deletedAt,
        createdAt: user.createdAt,
        profile: user.profile,
        authAccounts: user.authAccounts.map((account) => ({
          ...account,
          providerUserId: this.maskProviderUserId(account.providerUserId),
        })),
        artistOperators: user.artistOperators.map((operator) => ({
          operatorId: operator.id,
          artistId: operator.artistId,
          role: operator.role,
          status: operator.status,
          revokedAt: operator.revokedAt,
          canEnterCreatorStudio:
            operator.status === 'active' && operator.revokedAt === null,
          permissions: operator.permissions,
          artist: operator.artist,
          createdAt: operator.createdAt,
          updatedAt: operator.updatedAt,
        })),
        approvedApplications: user.debutApplications.map((application) => ({
          id: application.id,
          applicantName: application.applicantName,
          displayName: application.displayName,
          contactEmail: application.contactEmail,
          participationType: application.participationType,
          updatedAt: application.updatedAt,
          canEnterCreatorStudio: user.status === 'active' && user.deletedAt === null,
          needsArtistOperatorLink: true,
        })),
        adminAccess: user.adminAccess
          ? {
              id: user.adminAccess.id,
              status: user.adminAccess.status,
              roleName: user.adminAccess.role.name,
              permissions: user.adminAccess.role.permissions,
              canEnterCreatorStudio:
                user.status === 'active' &&
                user.deletedAt === null &&
                user.adminAccess.status === 'active',
            }
          : null,
      })),
      expectedUserEndpoint: '/api/v1/me/creator-studio',
      expectedUserEndpointRule:
        'The signed-in access token must belong to the same active userId that has an active artist operator row, an approved debut application, or active admin access.',
      nextActions: this.creatorAccessDiagnosticNextActions({
        accessEnabled,
        exactMatchCount,
        activeUsersCount: activeUsers.length,
        activeOperatorsCount: activeOperators.length,
        approvedApplicationsCount: activeApprovedApplications.length,
        activeAdminUsersCount: activeAdminUsers.length,
        totalOperatorsCount: users.reduce((sum, user) => sum + user.artistOperators.length, 0),
      }),
    };
  }

  async grantBackstageCreatorAccess(user: AuthUser, input: AdminPayload) {
    const targetUser = await this.findAdminTargetUser(input);
    const artist = await this.findCreatorAccessArtist(input);
    const role = this.string(input, 'role', 'owner');
    const status = this.artistOperatorStatus(input, 'status', 'active');
    const permissions = this.optionalStringArray(input, 'permissions') ?? [
      'feed:post',
      'feed:reply',
      'image:request',
      'profile:update',
      'settlement:read',
    ];

    const before = await this.prisma.artistOperator.findUnique({
      where: {
        userId_artistId: {
          userId: targetUser.id,
          artistId: artist.id,
        },
      },
      include: this.artistOperatorInclude(),
    });
    const operator = await this.prisma.artistOperator.upsert({
      where: {
        userId_artistId: {
          userId: targetUser.id,
          artistId: artist.id,
        },
      },
      create: {
        userId: targetUser.id,
        artistId: artist.id,
        role,
        status,
        permissions,
        revokedAt: status === 'active' ? null : new Date(),
      },
      update: {
        role,
        status,
        permissions,
        revokedAt: status === 'active' ? null : new Date(),
        updatedAt: new Date(),
      },
      include: this.artistOperatorInclude(),
    });

    await this.recordAudit(
      user,
      before ? 'backstage.creator_access.restore' : 'backstage.creator_access.grant',
      'artist_operator',
      operator.id,
      before,
      operator,
      {
        targetUserId: targetUser.id,
        artistId: artist.id,
        artistSlug: artist.slug,
        note: this.optionalString(input, 'note') ?? null,
      },
    );

    return {
      ok: true,
      item: this.creatorAccessItem(operator),
      policy: this.creatorAccessPolicy(),
    };
  }

  async updateBackstageCreatorAccess(
    user: AuthUser,
    operatorId: string,
    input: AdminPayload,
  ) {
    if (!this.isUuid(operatorId)) {
      throw new BadRequestException('operatorId must be a UUID');
    }

    const before = await this.prisma.artistOperator.findUnique({
      where: { id: operatorId },
      include: this.artistOperatorInclude(),
    });

    if (!before) {
      throw new NotFoundException('Creator access not found');
    }

    const status =
      input.status === undefined ? undefined : this.artistOperatorStatus(input, 'status');
    const data: Prisma.ArtistOperatorUpdateInput = this.clean({
      role: this.optionalString(input, 'role'),
      status,
      permissions: this.optionalStringArray(input, 'permissions'),
      revokedAt:
        status === undefined ? undefined : status === 'active' ? null : new Date(),
      updatedAt: new Date(),
    });

    const operator = await this.prisma.artistOperator.update({
      where: { id: operatorId },
      data,
      include: this.artistOperatorInclude(),
    });

    await this.recordAudit(
      user,
      'backstage.creator_access.update',
      'artist_operator',
      operator.id,
      before,
      operator,
      { note: this.optionalString(input, 'note') ?? null },
    );

    return {
      ok: true,
      item: this.creatorAccessItem(operator),
      policy: this.creatorAccessPolicy(),
    };
  }

  async createBackstageQaCreatorSettlementRevenue(
    user: AuthUser,
    input: AdminPayload,
  ) {
    this.assertBackstageQaToolsEnabled();
    const targetUser = await this.findQaCreatorSettlementUser(input);
    const operator = await this.findQaCreatorSettlementOperator(
      targetUser.id,
      this.optionalString(input, 'artistId'),
    );
    const amountLumina = this.decimal(input, 'amountLumina', 2000);

    if (amountLumina.lte(0) || amountLumina.gt(100_000)) {
      throw new BadRequestException('amountLumina must be between 0 and 100000');
    }

    const idempotencyKey = `qa:creator-settlement-revenue:${randomUUID()}`;
    const title =
      this.optionalString(input, 'title') ?? 'QA creator settlement revenue';
    const body =
      this.optionalString(input, 'body') ??
      'Temporary QA fan letter revenue for Creator Studio settlement conversion testing.';
    const fanLetter = await this.prisma.fanLetter.create({
      data: {
        senderUserId: user.id,
        artistId: operator.artistId,
        status: 'submitted',
        moderationStatus: 'approved',
        amountLumina,
        title,
        body,
        idempotencyKey,
        metadata: this.toJson({
          qaCreatorSettlementRevenue: true,
          source: 'backstage_qa_tool',
          purpose: 'creator_studio_settlement_conversion_test',
          operatorUserId: targetUser.id,
          artistId: operator.artistId,
          createdByAdminUserId: user.id,
          amountLumina: amountLumina.toString(),
          cleanup: 'Use response.cleanup.path to delete this QA record.',
          walletLedgerCreated: false,
        }),
      },
      select: {
        id: true,
        artistId: true,
        senderUserId: true,
        amountLumina: true,
        status: true,
        moderationStatus: true,
        title: true,
        idempotencyKey: true,
        metadata: true,
        createdAt: true,
      },
    });

    await this.recordAudit(
      user,
      'backstage.qa_creator_settlement_revenue.create',
      'fan_letter',
      fanLetter.id,
      null,
      fanLetter,
      {
        operatorUserId: targetUser.id,
        artistId: operator.artistId,
        amountLumina: amountLumina.toString(),
      },
    );

    return {
      ok: true,
      qa: true,
      fanLetter: {
        id: fanLetter.id,
        artistId: fanLetter.artistId,
        amountLumina: fanLetter.amountLumina,
        status: fanLetter.status,
        moderationStatus: fanLetter.moderationStatus,
        title: fanLetter.title,
        createdAt: fanLetter.createdAt,
      },
      operator: {
        operatorId: operator.id,
        userId: targetUser.id,
        email: this.maskEmail(targetUser.email),
        role: operator.role,
      },
      artist: operator.artist,
      settlementPreview: {
        userEndpoint: '/api/v1/me/creator-studio/settlement-preview',
        adminEndpoint: '/admin/api/v1/backstage/operations/settlement-preview',
        note: 'Refresh Creator Studio settlement after deploy to see the temporary amount.',
      },
      cleanup: {
        method: 'DELETE',
        path: `/admin/api/v1/backstage/operations/qa/creator-settlement-revenue/${fanLetter.id}`,
      },
      safety: {
        envGate: 'ENABLE_BACKSTAGE_QA_TOOLS=true',
        walletLedgerCreated: false,
        removeAfterQa: true,
        note: 'This QA fan letter affects settlement previews until it is deleted.',
      },
    };
  }

  async deleteBackstageQaCreatorSettlementRevenue(
    user: AuthUser,
    fanLetterId: string,
  ) {
    this.assertBackstageQaToolsEnabled();

    if (!this.isUuid(fanLetterId)) {
      throw new BadRequestException('fanLetterId must be a UUID');
    }

    const before = await this.prisma.fanLetter.findUnique({
      where: { id: fanLetterId },
      select: {
        id: true,
        artistId: true,
        senderUserId: true,
        walletLedgerId: true,
        amountLumina: true,
        status: true,
        moderationStatus: true,
        title: true,
        idempotencyKey: true,
        metadata: true,
        createdAt: true,
      },
    });

    if (!before) {
      throw new NotFoundException('QA settlement revenue fan letter not found');
    }

    const metadata = this.metadataObject(before.metadata);
    if (
      metadata.qaCreatorSettlementRevenue !== true ||
      !before.idempotencyKey?.startsWith('qa:creator-settlement-revenue:')
    ) {
      throw new BadRequestException('Only QA settlement revenue fan letters can be deleted here');
    }

    await this.prisma.fanLetter.delete({ where: { id: fanLetterId } });
    await this.recordAudit(
      user,
      'backstage.qa_creator_settlement_revenue.delete',
      'fan_letter',
      fanLetterId,
      before,
      null,
      {
        artistId: before.artistId,
        amountLumina: before.amountLumina.toString(),
      },
    );

    return {
      ok: true,
      deleted: true,
      fanLetterId,
      note: 'Refresh Creator Studio settlement preview after deletion.',
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
    const [chatOrders, giftOrders, boostEvents, premiumUnlocks, fanLetters] = await Promise.all([
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
      artistIds.length
        ? this.prisma.fanLetter.findMany({
            where: {
              artistId: { in: artistIds },
              status: { in: ['submitted', 'seen', 'replied', 'archived'] },
              amountLumina: { gt: 0 },
              createdAt: { gte: period.start, lt: period.end },
            },
            select: {
              artistId: true,
              amountLumina: true,
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

    for (const letter of fanLetters) {
      this.addRevenueEvent(
        revenueByArtist,
        letter.artistId,
        'fan_letter',
        letter.amountLumina,
        policy.unitPriceKrw,
      );
    }

    const creatorUserIds = [
      ...new Set(
        page.items.flatMap((artist) =>
          artist.artistOperators.map((operator) => operator.user.id),
        ),
      ),
    ];
    const [settlementRecords, settlementCompliance] = await Promise.all([
      this.settlementRecordsForKeys(
        artistIds.map((artistId) => this.settlementKey('artist', artistId, period.label)),
      ),
      this.settlementComplianceForUsers(creatorUserIds),
    ]);
    const items = page.items.map((artist) => {
      const bucket = revenueByArtist.get(artist.id) ?? this.emptyRevenueBucket();
      const financials = this.settlementFinancials(bucket.totalLumina, policy);
      const settlementKey = this.settlementKey('artist', artist.id, period.label);
      const manualSettlement = this.settlementRecordSummary(
        settlementRecords.get(settlementKey),
      );
      const creatorSettlementCompliance = artist.artistOperators.map((operator) => ({
        userId: operator.user.id,
        role: operator.role,
        ...this.settlementComplianceSummary(settlementCompliance.get(operator.user.id)),
      }));
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
          settlementCompliance: this.settlementComplianceSummary(
            settlementCompliance.get(operator.user.id),
          ),
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
          settlementCompliance: creatorSettlementCompliance,
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
    const [chatOrders, giftOrders, boostEvents, premiumUnlocks, fanLetters, pendingApplicationCounts] =
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
        artistIds.length
          ? this.prisma.fanLetter.findMany({
              where: {
                artistId: { in: artistIds },
                status: { in: ['submitted', 'seen', 'replied', 'archived'] },
                amountLumina: { gt: 0 },
                createdAt: { gte: period.start, lt: period.end },
              },
              select: {
                artistId: true,
                amountLumina: true,
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

    for (const letter of fanLetters) {
      this.addRevenueEvent(
        revenueByArtist,
        letter.artistId,
        'fan_letter',
        letter.amountLumina,
        policy.unitPriceKrw,
      );
    }

    const pendingApplicationsByPartner = new Map(
      pendingApplicationCounts.map((entry) => [entry.userId, entry._count._all]),
    );
    const [partnerSettlementRecords, settlementCompliance] = await Promise.all([
      this.settlementRecordsForKeys(
        page.items.map((partner) => this.settlementKey('partner', partner.id, period.label)),
      ),
      this.settlementComplianceForUsers(partnerIds),
    ]);
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
      const partnerSettlementCompliance = this.settlementComplianceSummary(
        settlementCompliance.get(partner.id),
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
        settlementCompliance: partnerSettlementCompliance,
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
          settlementCompliance: [partnerSettlementCompliance],
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

  async getBackstageSettlementConversions(query: AuditQuery) {
    const pagination = this.adminPagination(query, 20);
    const status = this.optionalString(query, 'status');
    const period = this.optionalString(query, 'period');
    const type = this.optionalString(query, 'type');
    const search = this.optionalString(query, 'query') ?? this.optionalString(query, 'q');

    if (status && !SETTLEMENT_CONVERSION_STATUSES.has(status)) {
      throw new BadRequestException(
        'status must be requested, approved, rejected, credited, or cancelled',
      );
    }

    if (period && !/^\d{4}-\d{2}$/.test(period)) {
      throw new BadRequestException('period must be YYYY-MM');
    }

    if (type && !SETTLEMENT_TYPES.has(type)) {
      throw new BadRequestException('type must be artist or partner');
    }

    const where: Prisma.SettlementLuminaConversionRequestWhereInput = this.clean({
      status,
      period,
      settlementType: type,
      OR: search
        ? [
            { settlementKey: { contains: search, mode: 'insensitive' } },
            { note: { contains: search, mode: 'insensitive' } },
            { adminNote: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    });
    const rows = await this.prisma.settlementLuminaConversionRequest.findMany({
      where,
      take: pagination.takeForQuery,
      ...pagination.cursorArgs,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const page = this.paginated(rows, pagination.take);
    const requesterIds = [...new Set(page.items.map((item) => item.requesterUserId))];
    const requesterMap = await this.settlementConversionRequesterMap(requesterIds);
    const items = page.items.map((row) =>
      this.presentSettlementConversionForAdmin(row, requesterMap.get(row.requesterUserId)),
    );
    const [statusCounts, amountTotals] = await Promise.all([
      this.prisma.settlementLuminaConversionRequest.groupBy({
        by: ['status'],
        where: this.clean({
          period,
          settlementType: type,
        }),
        _count: { _all: true },
      }),
      this.prisma.settlementLuminaConversionRequest.aggregate({
        where: this.clean({
          status,
          period,
          settlementType: type,
        }),
        _sum: {
          amountKrw: true,
          requestedLumina: true,
        },
      }),
    ]);

    return {
      generatedAt: new Date(),
      ...page,
      items,
      summary: {
        period: period ?? null,
        type: type ?? null,
        status: status ?? null,
        statusCounts: Object.fromEntries(
          statusCounts.map((entry) => [entry.status, entry._count._all]),
        ),
        totalAmountKrw: amountTotals._sum.amountKrw ?? new Decimal(0),
        totalRequestedLumina: amountTotals._sum.requestedLumina ?? new Decimal(0),
      },
      policy: this.settlementConversionAdminPolicy(),
    };
  }

  async updateBackstageSettlementConversionStatus(
    user: AuthUser,
    conversionId: string,
    input: AdminPayload,
  ) {
    this.assertSettlementOperator(user);

    if (!this.isUuid(conversionId)) {
      throw new BadRequestException('conversionId must be a UUID');
    }

    const status = this.settlementConversionMutationStatus(input, 'status');
    const adminNote = this.optionalString(input, 'adminNote') ?? null;

    const before = await this.prisma.settlementLuminaConversionRequest.findUnique({
      where: { id: conversionId },
    });

    if (!before) {
      throw new NotFoundException('Settlement Lumina conversion request not found');
    }

    if (before.status === 'credited' && status !== 'credited') {
      throw new BadRequestException('Credited conversion cannot be changed');
    }

    if (['rejected', 'cancelled'].includes(before.status)) {
      throw new BadRequestException(`Conversion is already terminal: ${before.status}`);
    }

    if (status === 'credited') {
      return this.creditSettlementConversion(user, before, adminNote);
    }

    if (before.status === status) {
      throw new BadRequestException(`Conversion is already ${status}`);
    }

    const updated = await this.prisma.settlementLuminaConversionRequest.update({
      where: { id: before.id },
      data: {
        status,
        adminNote,
        processedByUserId: user.id,
        processedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await this.prisma.auditEvent.create({
      data: {
        actorUserId: user.id,
        actorType: 'admin',
        action: 'settlement_lumina_conversion.status.update',
        targetType: 'settlement_lumina_conversion_request',
        targetId: updated.id,
        beforeData: this.toJson(before),
        afterData: this.toJson(updated),
        metadata: this.toJson({
          settlementKey: updated.settlementKey,
          settlementType: updated.settlementType,
          period: updated.period,
          status,
          walletCredited: false,
        }),
      },
    });

    return {
      ok: true,
      conversion: this.presentSettlementConversionForAdmin(updated),
      policy: this.settlementConversionAdminPolicy(),
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

  async getBackstageSettlement(settlementKey: string) {
    this.parseSettlementKey(settlementKey);

    const record = await this.prisma.settlementRecord.findUnique({
      where: { settlementKey },
    });

    if (!record) {
      throw new NotFoundException('Settlement record not found');
    }

    const auditEvents = await this.prisma.auditEvent.findMany({
      where: {
        targetType: 'settlement_record',
        targetId: record.id,
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        actorUserId: true,
        actorType: true,
        action: true,
        beforeData: true,
        afterData: true,
        metadata: true,
        createdAt: true,
      },
    });

    return {
      record: this.settlementRecordSummary(record),
      metadata: this.metadataObject(record.metadata),
      auditEvents: auditEvents.map((event) => ({
        id: event.id,
        actorUserId: event.actorUserId,
        actorType: event.actorType,
        action: event.action,
        beforeData: event.beforeData,
        afterData: event.afterData,
        metadata: event.metadata,
        createdAt: event.createdAt,
      })),
      policy: {
        manualOnly: true,
        moneyTransfer: false,
        auditEventLimit: 20,
      },
    };
  }

  async getBackstageWalletLedgerDailyReconcile(query: AuditQuery) {
    const { serviceDate, start, end } = this.walletLedgerDailyWindow(query);
    const userId = this.optionalString(query, 'userId');
    const currencyCode = this.optionalString(query, 'currencyCode') ?? 'LUMINA';

    if (userId && !this.isUuid(userId)) {
      throw this.adminBadRequest(
        'WALLET_DAILY_RECONCILE_INVALID_USER_ID',
        'userId must be a UUID',
        'admin.walletDailyReconcile.invalidUserId',
      );
    }

    if (currencyCode !== 'LUMINA') {
      throw this.adminBadRequest(
        'WALLET_DAILY_RECONCILE_INVALID_CURRENCY',
        'currencyCode must be LUMINA',
        'admin.walletDailyReconcile.invalidCurrency',
      );
    }

    const rows = await this.prisma.walletLedger.findMany({
      where: {
        createdAt: {
          gte: start,
          lt: end,
        },
        walletAccount: this.clean({
          currencyCode,
          userId,
        }),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        walletAccount: {
          select: {
            id: true,
            userId: true,
            currencyCode: true,
            status: true,
            cachedBalance: true,
          },
        },
      },
    });

    const accounts = new Map<
      string,
      {
        walletAccountId: string;
        userId: string;
        currencyCode: string;
        walletStatus: string;
        cachedBalanceLumina: Decimal;
        entryCount: number;
        creditLumina: Decimal;
        debitLumina: Decimal;
        netLumina: Decimal;
        byLedgerType: Map<
          string,
          { entryCount: number; creditLumina: Decimal; debitLumina: Decimal }
        >;
      }
    >();
    const totals = {
      entryCount: 0,
      creditLumina: new Decimal(0),
      debitLumina: new Decimal(0),
      netLumina: new Decimal(0),
    };

    for (const row of rows) {
      const account =
        accounts.get(row.walletAccountId) ??
        {
          walletAccountId: row.walletAccountId,
          userId: row.walletAccount.userId,
          currencyCode: row.walletAccount.currencyCode,
          walletStatus: row.walletAccount.status,
          cachedBalanceLumina: row.walletAccount.cachedBalance,
          entryCount: 0,
          creditLumina: new Decimal(0),
          debitLumina: new Decimal(0),
          netLumina: new Decimal(0),
          byLedgerType: new Map<
            string,
            { entryCount: number; creditLumina: Decimal; debitLumina: Decimal }
          >(),
        };
      const ledgerType =
        account.byLedgerType.get(row.ledgerType) ??
        {
          entryCount: 0,
          creditLumina: new Decimal(0),
          debitLumina: new Decimal(0),
        };
      const amount = new Decimal(row.amount);

      account.entryCount += 1;
      ledgerType.entryCount += 1;
      totals.entryCount += 1;

      if (row.direction === 'credit') {
        account.creditLumina = account.creditLumina.plus(amount);
        account.netLumina = account.netLumina.plus(amount);
        ledgerType.creditLumina = ledgerType.creditLumina.plus(amount);
        totals.creditLumina = totals.creditLumina.plus(amount);
        totals.netLumina = totals.netLumina.plus(amount);
      } else if (row.direction === 'debit') {
        account.debitLumina = account.debitLumina.plus(amount);
        account.netLumina = account.netLumina.minus(amount);
        ledgerType.debitLumina = ledgerType.debitLumina.plus(amount);
        totals.debitLumina = totals.debitLumina.plus(amount);
        totals.netLumina = totals.netLumina.minus(amount);
      }

      account.byLedgerType.set(row.ledgerType, ledgerType);
      accounts.set(row.walletAccountId, account);
    }

    const items = [...accounts.values()].map((account) => ({
      serviceDate,
      walletAccountId: account.walletAccountId,
      userId: account.userId,
      currencyCode: account.currencyCode,
      walletStatus: account.walletStatus,
      cachedBalanceLumina: this.decimalText(account.cachedBalanceLumina),
      ledgerEntryCount: account.entryCount,
      creditLumina: this.decimalText(account.creditLumina),
      debitLumina: this.decimalText(account.debitLumina),
      netLumina: this.decimalText(account.netLumina),
      byLedgerType: [...account.byLedgerType.entries()].map(([ledgerType, value]) => ({
        ledgerType,
        entryCount: value.entryCount,
        creditLumina: this.decimalText(value.creditLumina),
        debitLumina: this.decimalText(value.debitLumina),
        netLumina: this.decimalText(value.creditLumina.minus(value.debitLumina)),
      })),
      reconciliation: {
        cachedBalanceSource: 'wallet_accounts.cached_balance',
        ledgerSource: 'wallet_ledger',
        currentBalanceSnapshotOnly: true,
        openingBalanceRequiredForExactDailyBalance: true,
      },
    }));

    return {
      generatedAt: new Date(),
      serviceDate,
      range: {
        start: start.toISOString(),
        endExclusive: end.toISOString(),
      },
      currencyCode,
      userId: userId ?? null,
      totals: {
        walletAccountCount: items.length,
        ledgerEntryCount: totals.entryCount,
        creditLumina: this.decimalText(totals.creditLumina),
        debitLumina: this.decimalText(totals.debitLumina),
        netLumina: this.decimalText(totals.netLumina),
      },
      items,
      policy: {
        permission: 'payments:read',
        mutation: false,
        sourceOfTruth: 'wallet_ledger',
        cachedBalanceSource: 'wallet_accounts.cached_balance',
        clientDisplayedBalanceTrusted: false,
        rawPaymentIdentifierReturned: false,
        rawReceiptReturned: false,
        providerTokenReturned: false,
        idempotencyKeyReturned: false,
        memoReturned: false,
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

  async getAuthActionTokens(query: AuditQuery) {
    const pagination = this.adminPagination(query);
    const purpose = this.optionalString(query, 'purpose');
    const status = this.optionalString(query, 'status') ?? 'all';
    const userId = this.optionalString(query, 'userId');
    const email = this.optionalString(query, 'email')?.toLowerCase();
    const deliveryStatus = this.optionalString(query, 'deliveryStatus') ?? 'all';
    const deliveryProvider =
      this.optionalString(query, 'deliveryProvider') ??
      this.optionalString(query, 'provider') ??
      'all';
    const now = new Date();

    if (purpose && !AUTH_ACTION_TOKEN_PURPOSES.has(purpose)) {
      throw this.adminBadRequest(
        'AUTH_ACTION_TOKEN_INVALID_PURPOSE',
        'Invalid auth action token purpose',
        'admin.authActionTokens.invalidPurpose',
        { allowed: [...AUTH_ACTION_TOKEN_PURPOSES] },
      );
    }

    if (!AUTH_ACTION_TOKEN_STATUSES.has(status)) {
      throw this.adminBadRequest(
        'AUTH_ACTION_TOKEN_INVALID_STATUS',
        'Invalid auth action token status',
        'admin.authActionTokens.invalidStatus',
        { allowed: [...AUTH_ACTION_TOKEN_STATUSES] },
      );
    }

    if (!AUTH_ACTION_TOKEN_DELIVERY_STATUSES.has(deliveryStatus)) {
      throw this.adminBadRequest(
        'AUTH_ACTION_TOKEN_INVALID_DELIVERY_STATUS',
        'Invalid auth action token delivery status',
        'admin.authActionTokens.invalidDeliveryStatus',
        { allowed: [...AUTH_ACTION_TOKEN_DELIVERY_STATUSES] },
      );
    }

    if (!AUTH_ACTION_TOKEN_DELIVERY_PROVIDERS.has(deliveryProvider)) {
      throw this.adminBadRequest(
        'AUTH_ACTION_TOKEN_INVALID_DELIVERY_PROVIDER',
        'Invalid auth action token delivery provider',
        'admin.authActionTokens.invalidDeliveryProvider',
        { allowed: [...AUTH_ACTION_TOKEN_DELIVERY_PROVIDERS] },
      );
    }

    if (userId && !this.isUuid(userId)) {
      throw this.adminBadRequest(
        'AUTH_ACTION_TOKEN_INVALID_USER_ID',
        'userId must be a UUID',
        'admin.authActionTokens.invalidUserId',
      );
    }

    const where: Prisma.UserActionTokenWhereInput = this.clean({
      purpose,
      userId,
      user: email
        ? {
            email: {
              contains: email,
              mode: 'insensitive',
            },
          }
        : undefined,
      deliveryStatus: deliveryStatus === 'all' ? undefined : deliveryStatus,
      deliveryProvider:
        deliveryProvider === 'all'
          ? undefined
          : deliveryProvider === 'none'
            ? null
            : { equals: deliveryProvider, mode: 'insensitive' },
      ...this.authActionTokenStatusWhere(status, now),
    });

    const [rows, total] = await Promise.all([
      this.prisma.userActionToken.findMany({
        where,
        take: pagination.takeForQuery,
        ...pagination.cursorArgs,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: AUTH_ACTION_TOKEN_AUDIT_INCLUDE,
      }),
      this.prisma.userActionToken.count({ where }),
    ]);
    const page = this.paginated(rows, pagination.take);

    return {
      ...page,
      items: page.items.map((row) => this.authActionTokenAuditItem(row, now)),
      total,
      filters: {
        purpose: purpose ?? 'all',
        status,
        deliveryStatus,
        deliveryProvider,
        userId: userId ?? null,
        email: email ? this.maskEmail(email) : null,
      },
      policy: this.authActionTokenAuditPolicy(),
    };
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
    const uploadUrl = this.buildUploadUrl(
      storageProvider,
      storageKey,
      expiresInSeconds,
      mimeType,
    );
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

  async createBackstageWalletAdjustment(user: AuthUser, input: AdminPayload) {
    this.assertSuperAdmin(user);
    const targets = await this.walletAdjustmentTargets(input, 1);

    if (targets.length !== 1) {
      throw new BadRequestException('Exactly one wallet adjustment target is required');
    }

    const result = await this.applyWalletAdjustments(user, input, targets);
    return {
      ok: true,
      mode: 'single',
      ...result,
    };
  }

  async createBackstageBulkWalletAdjustment(user: AuthUser, input: AdminPayload) {
    this.assertSuperAdmin(user);
    const targets = await this.walletAdjustmentTargets(input, 100);
    const result = await this.applyWalletAdjustments(user, input, targets);

    return {
      ok: true,
      mode: 'bulk',
      ...result,
    };
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
      this.communityPostAuditSnapshot(before),
      this.communityPostAuditSnapshot(post),
      this.communityModerationAuditMetadata(input),
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
      this.communityPostAuditSnapshot(before),
      this.communityPostAuditSnapshot(post),
      this.communityModerationAuditMetadata(input),
    );

    return { ok: true, post };
  }

  async getBackstageArtistKnowledgeUrls(query: AuditQuery) {
    const pagination = this.adminPagination(query, 50);
    const artistId = this.optionalString(query, 'artistId');
    const status = this.optionalString(query, 'status');

    if (artistId && !this.isUuid(artistId)) {
      this.throwArtistKnowledgeBadRequest(
        'ARTIST_KNOWLEDGE_URL_INVALID_ID',
        'artistKnowledgeUrl.error.invalidId',
        '자료 URL 요청 정보를 확인해 주세요.',
        { field: 'artistId' },
      );
    }

    if (
      status &&
      !(ARTIST_URL_KNOWLEDGE_STATUSES as readonly string[]).includes(status)
    ) {
      this.throwArtistKnowledgeBadRequest(
        'ARTIST_KNOWLEDGE_URL_STATUS_INVALID',
        'artistKnowledgeUrl.error.statusInvalid',
        '자료 URL 상태 필터를 확인해 주세요.',
        { supportedStatuses: ARTIST_URL_KNOWLEDGE_STATUSES },
      );
    }

    const rows = await this.prisma.artistKnowledgeUrl.findMany({
      where: this.clean({
        artistId,
        status,
      }),
      take: pagination.takeForQuery,
      ...pagination.cursorArgs,
      orderBy: [{ createdAt: 'desc' }],
      include: {
        artist: {
          select: {
            id: true,
            slug: true,
            displayName: true,
            status: true,
          },
        },
        submittedBy: {
          select: {
            id: true,
            email: true,
          },
        },
        reviewedBy: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });
    const paginated = this.paginated(rows, pagination.take);

    return {
      ...paginated,
      items: paginated.items.map((row) =>
        this.presentBackstageArtistKnowledgeUrl(row),
      ),
      contract: ARTIST_URL_KNOWLEDGE_CONTRACT.apiContracts.adminList,
    };
  }

  async approveBackstageArtistKnowledgeUrl(
    user: AuthUser,
    knowledgeUrlId: string,
    input: AdminPayload,
  ) {
    this.assertArtistKnowledgeUuid(knowledgeUrlId, 'knowledgeUrlId');
    const existing = await this.prisma.artistKnowledgeUrl.findUnique({
      where: { id: knowledgeUrlId },
    });

    if (!existing) {
      this.throwArtistKnowledgeNotFound();
    }

    if (existing.status === 'archived') {
      throw new ConflictException({
        code: 'ARTIST_KNOWLEDGE_URL_ARCHIVED',
        message: '보관된 자료 URL은 승인할 수 없습니다.',
        messageKey: 'artistKnowledgeUrl.error.archived',
      });
    }

    const summary =
      normalizeArtistKnowledgeSummary(this.optionalString(input, 'summary')) ??
      normalizeArtistKnowledgeSummary(existing.summary);

    if (!summary) {
      this.throwArtistKnowledgeBadRequest(
        'ARTIST_KNOWLEDGE_URL_SUMMARY_REQUIRED',
        'artistKnowledgeUrl.error.summaryRequired',
        '승인하려면 요약 설명이 필요합니다.',
      );
    }

    const before = existing;
    const row = await this.prisma.artistKnowledgeUrl.update({
      where: { id: existing.id },
      data: {
        status: 'approved',
        summary,
        allowChatReference: this.boolean(
          input,
          'allowChatRef',
          existing.allowChatReference,
        ),
        rejectionReason: null,
        reviewedByUserId: user.id,
        reviewedAt: new Date(),
        archivedAt: null,
        updatedAt: new Date(),
        metadata: this.toJson({
          ...this.metadataObject(existing.metadata),
          contractVersion: ARTIST_URL_KNOWLEDGE_CONTRACT.version,
          summarySource: input.summary
            ? 'admin_review_summary'
            : 'artist_description_reviewed',
          externalFetchPerformed: false,
          rawPageBodyStored: false,
        }),
      },
      include: {
        artist: true,
        submittedBy: true,
        reviewedBy: true,
      },
    });
    const audit = buildArtistKnowledgeAuditPayload(
      'artist_knowledge_url.approve',
      before,
      row,
    );

    await this.recordAudit(
      user,
      'artist_knowledge_url.approve',
      'artist_knowledge_url',
      row.id,
      audit.beforeData,
      audit.afterData,
      audit.metadata,
    );

    return {
      item: this.presentBackstageArtistKnowledgeUrl(row),
      contract: ARTIST_URL_KNOWLEDGE_CONTRACT.apiContracts.adminApprove,
    };
  }

  async rejectBackstageArtistKnowledgeUrl(
    user: AuthUser,
    knowledgeUrlId: string,
    input: AdminPayload,
  ) {
    this.assertArtistKnowledgeUuid(knowledgeUrlId, 'knowledgeUrlId');
    const reason = this.optionalString(input, 'reason');
    if (!reason) {
      this.throwArtistKnowledgeBadRequest(
        'ARTIST_KNOWLEDGE_URL_REJECTION_REASON_REQUIRED',
        'artistKnowledgeUrl.error.rejectionReasonRequired',
        '반려하려면 사유를 입력해 주세요.',
      );
    }
    const existing = await this.prisma.artistKnowledgeUrl.findUnique({
      where: { id: knowledgeUrlId },
    });

    if (!existing) {
      this.throwArtistKnowledgeNotFound();
    }

    if (existing.status === 'archived') {
      throw new ConflictException({
        code: 'ARTIST_KNOWLEDGE_URL_ARCHIVED',
        message: '보관된 자료 URL은 반려할 수 없습니다.',
        messageKey: 'artistKnowledgeUrl.error.archived',
      });
    }

    const before = existing;
    const row = await this.prisma.artistKnowledgeUrl.update({
      where: { id: existing.id },
      data: {
        status: 'rejected',
        rejectionReason: reason.slice(0, 500),
        reviewedByUserId: user.id,
        reviewedAt: new Date(),
        updatedAt: new Date(),
        metadata: this.toJson({
          ...this.metadataObject(existing.metadata),
          contractVersion: ARTIST_URL_KNOWLEDGE_CONTRACT.version,
          chatReferenceBlocked: true,
        }),
      },
      include: {
        artist: true,
        submittedBy: true,
        reviewedBy: true,
      },
    });
    const audit = buildArtistKnowledgeAuditPayload(
      'artist_knowledge_url.reject',
      before,
      row,
    );

    await this.recordAudit(
      user,
      'artist_knowledge_url.reject',
      'artist_knowledge_url',
      row.id,
      audit.beforeData,
      audit.afterData,
      audit.metadata,
    );

    return {
      item: this.presentBackstageArtistKnowledgeUrl(row),
      contract: ARTIST_URL_KNOWLEDGE_CONTRACT.apiContracts.adminReject,
    };
  }

  async archiveBackstageArtistKnowledgeUrl(
    user: AuthUser,
    knowledgeUrlId: string,
    input: AdminPayload,
  ) {
    this.assertArtistKnowledgeUuid(knowledgeUrlId, 'knowledgeUrlId');
    const existing = await this.prisma.artistKnowledgeUrl.findUnique({
      where: { id: knowledgeUrlId },
    });

    if (!existing) {
      this.throwArtistKnowledgeNotFound();
    }

    const before = existing;
    const row = await this.prisma.artistKnowledgeUrl.update({
      where: { id: existing.id },
      data: {
        status: 'archived',
        archivedAt: new Date(),
        updatedAt: new Date(),
        metadata: this.toJson({
          ...this.metadataObject(existing.metadata),
          contractVersion: ARTIST_URL_KNOWLEDGE_CONTRACT.version,
          archivedReason: this.optionalString(input, 'reason') ?? null,
          chatReferenceBlocked: true,
        }),
      },
      include: {
        artist: true,
        submittedBy: true,
        reviewedBy: true,
      },
    });
    const audit = buildArtistKnowledgeAuditPayload(
      'artist_knowledge_url.archive',
      before,
      row,
    );

    await this.recordAudit(
      user,
      'artist_knowledge_url.archive',
      'artist_knowledge_url',
      row.id,
      audit.beforeData,
      audit.afterData,
      audit.metadata,
    );

    return {
      item: this.presentBackstageArtistKnowledgeUrl(row),
      contract: ARTIST_URL_KNOWLEDGE_CONTRACT.apiContracts.adminArchive,
    };
  }

  private presentBackstageArtistKnowledgeUrl(row: {
    id: string;
    artistId: string;
    submittedByUserId: string;
    reviewedByUserId: string | null;
    status: string;
    sourceType: string;
    url: string;
    canonicalUrl: string;
    artistDescription: string;
    summary: string;
    allowChatReference: boolean;
    rejectionReason: string | null;
    metadata: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
    reviewedAt: Date | null;
    archivedAt: Date | null;
    artist?: {
      id: string;
      slug: string;
      displayName: string;
      status: string;
    };
    submittedBy?: {
      id: string;
      email: string | null;
    };
    reviewedBy?: {
      id: string;
      email: string | null;
    } | null;
  }) {
    return {
      id: row.id,
      artistId: row.artistId,
      artist: row.artist ?? null,
      submittedByUserId: row.submittedByUserId,
      submittedBy: row.submittedBy
        ? {
            id: row.submittedBy.id,
            emailMasked: this.maskEmail(row.submittedBy.email),
          }
        : null,
      reviewedByUserId: row.reviewedByUserId,
      reviewedBy: row.reviewedBy
        ? {
            id: row.reviewedBy.id,
            emailMasked: this.maskEmail(row.reviewedBy.email),
          }
        : null,
      type: isArtistKnowledgeSourceType(row.sourceType)
        ? row.sourceType
        : 'other',
      url: row.url,
      canonicalUrl: row.canonicalUrl,
      description: row.artistDescription,
      summary: row.summary,
      allowChatRef: row.allowChatReference,
      status: ARTIST_URL_KNOWLEDGE_STATUSES.includes(row.status as never)
        ? row.status
        : 'pending',
      rejectionReason: row.rejectionReason,
      metadata: this.metadataObject(row.metadata),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      reviewedAt: row.reviewedAt,
      archivedAt: row.archivedAt,
      chatReference: {
        eligible:
          row.status === 'approved' &&
          row.allowChatReference &&
          Boolean(row.summary),
        approvedOnly: true,
        rawUrlIncludedInPrompt: false,
      },
    };
  }

  private assertArtistKnowledgeUuid(value: string, field: string) {
    if (!this.isUuid(value)) {
      this.throwArtistKnowledgeBadRequest(
        'ARTIST_KNOWLEDGE_URL_INVALID_ID',
        'artistKnowledgeUrl.error.invalidId',
        '자료 URL 요청 정보를 확인해 주세요.',
        { field },
      );
    }
  }

  private throwArtistKnowledgeNotFound(): never {
    throw new NotFoundException({
      code: 'ARTIST_KNOWLEDGE_URL_NOT_FOUND',
      message: '자료 URL을 찾을 수 없습니다.',
      messageKey: 'artistKnowledgeUrl.error.notFound',
    });
  }

  private throwArtistKnowledgeBadRequest(
    code: string,
    messageKey: string,
    message: string,
    details?: Record<string, unknown>,
  ): never {
    throw new BadRequestException(this.clean({ code, message, messageKey, details }));
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
        fan_letter: this.emptyProductBreakdown('fan_letter'),
      },
    };
  }

  async getBackstageLaunchReadiness() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [
      activeArtists,
      activeArtistsWithCover,
      activeArtistsWithThumb,
      publishedShortforms,
      activeUsers,
      activeLuminaProducts,
      paidPaymentOrders,
      activeGiftProducts,
      activeChatFeatureProducts,
      activePremiumVideoProducts,
      feedPosts,
      feedPostsLast7d,
      openReports,
      debutApplications,
      activeArtistOperators,
      openCreatorImageRequests,
      fanLetters,
      s3Assets,
      uploadedUserAssets,
      recentAuditEvents,
    ] = await Promise.all([
      this.prisma.artist.count({ where: { status: 'active' } }),
      this.prisma.artist.count({
        where: {
          status: 'active',
          artistAssets: { some: { usageType: { in: ['cover', 'hero', 'banner'] } } },
        },
      }),
      this.prisma.artist.count({
        where: {
          status: 'active',
          artistAssets: { some: { usageType: { in: ['thumb', 'thumbnail', 'profile', 'card'] } } },
        },
      }),
      this.prisma.shortform.count({ where: { status: 'published' } }),
      this.prisma.user.count({ where: { status: 'active', deletedAt: null } }),
      this.prisma.luminaProduct.count({ where: { status: 'active' } }),
      this.prisma.paymentOrder.count({ where: { status: 'paid' } }),
      this.prisma.giftProduct.count({ where: { status: 'active' } }),
      this.prisma.chatFeatureProduct.count({ where: { status: 'active' } }),
      this.prisma.premiumVideoProduct.count({ where: { status: 'published' } }),
      this.prisma.communityPost.count({
        where: { status: 'published', visibility: 'public', deletedAt: null },
      }),
      this.prisma.communityPost.count({
        where: {
          status: 'published',
          visibility: 'public',
          deletedAt: null,
          publishedAt: { gte: sevenDaysAgo },
        },
      }),
      this.prisma.communityReport.count({
        where: { status: { in: ['submitted', 'reviewing'] } },
      }),
      this.prisma.debutApplication.count(),
      this.prisma.artistOperator.count({ where: { status: 'active' } }),
      this.prisma.creatorImageRequest.count({
        where: { status: { in: ['submitted', 'reviewing', 'in_progress'] } },
      }),
      this.prisma.fanLetter.count(),
      this.prisma.asset.count({
        where: { storageProvider: { in: ['s3', 'r2'] }, visibility: 'public' },
      }),
      this.prisma.asset.count({
        where: {
          visibility: 'public',
          metadata: {
            path: ['uploadIntent', 'status'],
            equals: 'uploaded',
          },
        },
      }),
      this.prisma.auditEvent.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    ]);

    const categories = [
      this.launchReadinessCategory({
        key: 'public_content',
        label: 'Public characters/content',
        score: Math.min(100, activeArtists * 10 + publishedShortforms * 4),
        targetScore: 80,
        metrics: {
          activeArtists,
          activeArtistsWithCover,
          activeArtistsWithThumb,
          publishedShortforms,
        },
        blockers: [
          ...(activeArtists < 8 ? ['active_artist_count_below_8'] : []),
          ...(activeArtistsWithCover < activeArtists ? ['some_active_artists_missing_cover'] : []),
          ...(activeArtistsWithThumb < activeArtists ? ['some_active_artists_missing_thumb'] : []),
        ],
        nextActions: [
          'Keep active character count at 8+ for launch breadth.',
          'Check every active artist has cover/thumb/gallery assets before launch.',
        ],
      }),
      this.launchReadinessCategory({
        key: 'lumina_commerce',
        label: 'Lumina commerce/BM',
        score: Math.min(
          100,
          activeLuminaProducts * 20 +
            activeGiftProducts * 8 +
            activeChatFeatureProducts * 8 +
            activePremiumVideoProducts * 8 +
            (paidPaymentOrders > 0 ? 20 : 0),
        ),
        targetScore: 80,
        metrics: {
          activeLuminaProducts,
          paidPaymentOrders,
          activeGiftProducts,
          activeChatFeatureProducts,
          activePremiumVideoProducts,
        },
        blockers: [
          ...(activeLuminaProducts < 3 ? ['charge_products_below_3'] : []),
          ...(paidPaymentOrders < 1 ? ['no_paid_payment_order_verified_yet'] : []),
        ],
        nextActions: [
          'Run one paid/PG verification before opening paid traffic.',
          'Keep unavailable products visible only as disabled placeholders.',
        ],
      }),
      this.launchReadinessCategory({
        key: 'social_feed',
        label: 'Lumina Feed/SNS flow',
        score: Math.min(100, feedPosts * 8 + feedPostsLast7d * 6 + activeUsers),
        targetScore: 80,
        metrics: {
          activeUsers,
          feedPosts,
          feedPostsLast7d,
          openReports,
        },
        blockers: [
          ...(feedPosts < 10 ? ['feed_seed_posts_below_10'] : []),
          ...(openReports > 0 ? ['open_moderation_reports'] : []),
        ],
        nextActions: [
          'Verify feed create/edit/like/reply/report flows from a normal user account.',
          'Keep user profile route and follow buttons tested together.',
        ],
      }),
      this.launchReadinessCategory({
        key: 'creator_studio',
        label: 'Creator/debut/studio',
        score: Math.min(
          100,
          debutApplications * 12 + activeArtistOperators * 18 + fanLetters * 8,
        ),
        targetScore: 80,
        metrics: {
          debutApplications,
          activeArtistOperators,
          openCreatorImageRequests,
          fanLetters,
        },
        blockers: [
          ...(debutApplications < 1 ? ['no_debut_application_tested'] : []),
          ...(activeArtistOperators < 1 ? ['no_active_artist_operator'] : []),
        ],
        nextActions: [
          'Test debut application from public form to Backstage review.',
          'Keep Creator Studio image request disabled until policy/UI is final.',
        ],
      }),
      this.launchReadinessCategory({
        key: 'ops_safety',
        label: 'Backstage/ops/safety',
        score: Math.min(100, recentAuditEvents * 5 + (openReports === 0 ? 35 : 10) + 35),
        targetScore: 80,
        metrics: {
          openReports,
          recentAuditEvents,
          s3Assets,
          uploadedUserAssets,
        },
        blockers: [
          ...(openReports > 0 ? ['moderation_queue_not_empty'] : []),
          ...(s3Assets < 1 && uploadedUserAssets < 1 ? ['object_storage_upload_not_verified'] : []),
        ],
        nextActions: [
          'Run one S3/direct-upload browser verification.',
          'Review Backstage audit trail after each admin status action.',
        ],
      }),
    ];
    const overallScore = Math.round(
      categories.reduce((sum, category) => sum + category.score, 0) / categories.length,
    );

    return {
      generatedAt: new Date(),
      target: {
        label: '1차 오픈 최소 조건',
        minimumCategoryScore: 80,
        minimumOverallScore: 80,
      },
      overall: {
        score: overallScore,
        status: overallScore >= 80 ? 'ready_candidate' : 'needs_work',
        belowTargetCategories: categories
          .filter((category) => category.score < category.targetScore)
          .map((category) => category.key),
      },
      categories,
      policy: {
        scoring: 'operational_signal_not_final_business_judgment',
        frontendUse: 'Backstage readiness dashboard or PM checklist',
        requiredHumanReview:
          'User still makes final launch judgment for policy, copy, payment, SNS, and legal readiness.',
      },
    };
  }

  private launchReadinessCategory(input: {
    key: string;
    label: string;
    score: number;
    targetScore: number;
    metrics: Record<string, number>;
    blockers: string[];
    nextActions: string[];
  }) {
    const score = Math.max(0, Math.min(100, Math.round(input.score)));

    return {
      key: input.key,
      label: input.label,
      score,
      targetScore: input.targetScore,
      status:
        score >= input.targetScore && input.blockers.length === 0
          ? 'ready_candidate'
          : score >= input.targetScore
            ? 'score_ready_with_blockers'
            : 'needs_work',
      metrics: input.metrics,
      blockers: input.blockers,
      nextActions: input.nextActions,
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

  private async creditSettlementConversion(
    user: AuthUser,
    before: SettlementLuminaConversionRequest,
    adminNote: string | null,
  ) {
    if (!['requested', 'approved', 'credited'].includes(before.status)) {
      throw new BadRequestException(
        'Only requested or approved conversions can be credited',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (before.walletLedgerId) {
        const existingLedger = await tx.walletLedger.findUnique({
          where: { id: before.walletLedgerId },
        });
        const replayed = await tx.settlementLuminaConversionRequest.update({
          where: { id: before.id },
          data: {
            status: 'credited',
            adminNote,
            processedByUserId: user.id,
            processedAt: before.processedAt ?? new Date(),
            updatedAt: new Date(),
          },
        });

        return {
          conversion: replayed,
          ledger: existingLedger,
          idempotentReplay: true,
        };
      }

      const idempotencyKey = `settlement-lumina-conversion:${before.id}`;
      const existingLedger = await tx.walletLedger.findUnique({
        where: { idempotencyKey },
      });

      if (existingLedger) {
        const replayed = await tx.settlementLuminaConversionRequest.update({
          where: { id: before.id },
          data: {
            status: 'credited',
            adminNote,
            walletLedgerId: existingLedger.id,
            processedByUserId: user.id,
            processedAt: before.processedAt ?? new Date(),
            updatedAt: new Date(),
          },
        });

        return {
          conversion: replayed,
          ledger: existingLedger,
          idempotentReplay: true,
        };
      }

      const wallet = await tx.walletAccount.upsert({
        where: {
          userId_currencyCode: {
            userId: before.requesterUserId,
            currencyCode: DEFAULT_CURRENCY,
          },
        },
        update: {},
        create: {
          userId: before.requesterUserId,
          currencyCode: DEFAULT_CURRENCY,
        },
      });

      const ledger = await tx.walletLedger.create({
        data: {
          walletAccountId: wallet.id,
          direction: 'credit',
          amount: before.requestedLumina,
          ledgerType: 'settlement_lumina_conversion',
          referenceType: 'settlement_lumina_conversion_request',
          referenceId: before.id,
          idempotencyKey,
          memo: `Settlement money charged as Lumina: ${before.settlementKey}`,
        },
      });

      await tx.walletAccount.update({
        where: { id: wallet.id },
        data: {
          cachedBalance: {
            increment: before.requestedLumina,
          },
          updatedAt: new Date(),
        },
      });

      const credited = await tx.settlementLuminaConversionRequest.update({
        where: { id: before.id },
        data: {
          status: 'credited',
          adminNote,
          walletLedgerId: ledger.id,
          processedByUserId: user.id,
          processedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      return {
        conversion: credited,
        ledger,
        idempotentReplay: false,
      };
    });

    await this.prisma.auditEvent.create({
      data: {
        actorUserId: user.id,
        actorType: 'admin',
        action: 'settlement_lumina_conversion.status.update',
        targetType: 'settlement_lumina_conversion_request',
        targetId: result.conversion.id,
        beforeData: this.toJson(before),
        afterData: this.toJson(result.conversion),
        metadata: this.toJson({
          settlementKey: result.conversion.settlementKey,
          settlementType: result.conversion.settlementType,
          period: result.conversion.period,
          status: result.conversion.status,
          walletCredited: true,
          walletLedgerId: result.conversion.walletLedgerId,
          idempotentReplay: result.idempotentReplay,
        }),
      },
    });

    return {
      ok: true,
      conversion: this.presentSettlementConversionForAdmin(result.conversion),
      walletLedger: result.ledger,
      idempotentReplay: result.idempotentReplay,
      policy: this.settlementConversionAdminPolicy(),
    };
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

  private feedSearchLanguage(value: unknown) {
    const language = this.optionalString({ value }, 'value') ?? 'all';

    if (!FEED_SEARCH_LANGUAGES.has(language)) {
      throw new BadRequestException('language must be all, ko, ja, en, zh, or unknown');
    }

    return language;
  }

  private feedSearchType(value: unknown) {
    const searchType = this.optionalString({ value }, 'value') ?? 'all';

    if (!FEED_SEARCH_TYPES.has(searchType)) {
      throw new BadRequestException('type must be all, text, or hashtag');
    }

    return searchType;
  }

  private feedSearchBlockedTermStatus(value: unknown) {
    const status = this.string({ value }, 'value');

    if (!FEED_SEARCH_BLOCKED_TERM_STATUSES.has(status)) {
      throw new BadRequestException('status must be active, inactive, or archived');
    }

    return status;
  }

  private feedSearchBlockedKeyword(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException('keyword must be a non-empty string');
    }

    const keyword = value.trim().replace(/\s+/g, ' ');

    if (keyword.length > 80) {
      throw new BadRequestException('keyword must be shorter than or equal to 80 characters');
    }

    return keyword;
  }

  private normalizeFeedSearchBlockedKeyword(keyword: string, searchType: string) {
    const normalized = keyword
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^#+/, searchType === 'text' ? '#' : '')
      .toLocaleLowerCase();

    if (!normalized) {
      throw new BadRequestException('keyword must be a non-empty string');
    }

    return normalized.slice(0, 80);
  }

  private feedSearchBlockedTermsPolicy() {
    return {
      publicDiscoveryOnly: true,
      directSearchStillAllowed: true,
      appliedTo: ['trending-searches', 'hashtags', 'search-suggestions'],
      supportedLanguages: ['all', 'ko', 'ja', 'en', 'zh', 'unknown'],
      supportedTypes: ['all', 'text', 'hashtag'],
      statuses: ['active', 'inactive', 'archived'],
      auditEvents: [
        'feed_search_blocked_term.create',
        'feed_search_blocked_term.update',
      ],
    };
  }

  private feedSearchWindow(value: unknown) {
    const key = this.optionalString({ value }, 'value') ?? '1h';
    const ms = FEED_SEARCH_WINDOWS[key];

    if (!ms) {
      throw new BadRequestException('window must be 15m, 1h, 6h, 24h, or 7d');
    }

    return { key, ms };
  }

  private feedSearchAnalyticsKey(keyword: string, searchType: string, language: string) {
    return `${language}:${searchType}:${keyword}`;
  }

  private settlementConversionMutationStatus(input: AdminPayload, key: string) {
    const status = this.string(input, key);

    if (!SETTLEMENT_CONVERSION_MUTATION_STATUSES.has(status)) {
      throw new BadRequestException(
        'status must be approved, rejected, credited, or cancelled',
      );
    }

    return status;
  }

  private settlementConversionAdminPolicy() {
    return {
      requestOnly: true,
      unitPriceKrw: 10,
      minAmountKrw: 1000,
      statusFlow: {
        requested: ['approved', 'rejected', 'credited', 'cancelled'],
        approved: ['credited', 'rejected', 'cancelled'],
        rejected: [],
        credited: [],
        cancelled: [],
      },
      walletCredit: {
        status: 'credited',
        ledgerType: 'settlement_lumina_conversion',
        referenceType: 'settlement_lumina_conversion_request',
        idempotencyKeyPrefix: 'settlement-lumina-conversion',
      },
    };
  }

  private async settlementConversionRequesterMap(userIds: string[]) {
    if (!userIds.length) {
      return new Map<string, SettlementConversionRequester>();
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        email: true,
        status: true,
        profile: {
          select: {
            displayName: true,
            publicHandle: true,
            avatarAssetId: true,
          },
        },
      },
    });

    return new Map(users.map((targetUser) => [targetUser.id, targetUser]));
  }

  private presentSettlementConversionForAdmin(
    row: SettlementLuminaConversionRequest,
    requester?: SettlementConversionRequester,
  ) {
    return {
      id: row.id,
      requesterUserId: row.requesterUserId,
      requester: requester
        ? {
            id: requester.id,
            email: requester.email,
            status: requester.status,
            displayName: requester.profile?.displayName ?? null,
            publicHandle: requester.profile?.publicHandle ?? null,
            avatarAssetId: requester.profile?.avatarAssetId ?? null,
          }
        : null,
      settlementKey: row.settlementKey,
      settlementType: row.settlementType,
      period: row.period,
      targetArtistId: row.targetArtistId,
      amountKrw: row.amountKrw,
      requestedLumina: row.requestedLumina,
      status: row.status,
      note: row.note,
      adminNote: row.adminNote,
      walletLedgerId: row.walletLedgerId,
      processedByUserId: row.processedByUserId,
      processedAt: row.processedAt,
      idempotencyKey: row.idempotencyKey,
      metadata: this.metadataObject(row.metadata),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
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

  private async settlementComplianceForUsers(
    userIds: string[],
  ): Promise<Map<string, SettlementComplianceUser>> {
    if (!userIds.length) {
      return new Map<string, SettlementComplianceUser>();
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        phoneNumber: true,
        identityVerification: true,
        payoutAccount: true,
        payoutException: true,
      },
    });

    return new Map(users.map((user) => [user.id, user]));
  }

  private settlementComplianceSummary(
    record: SettlementComplianceUser | undefined,
  ): SettlementComplianceSummary {
    const identityStatus =
      record?.identityVerification?.status ?? (record?.phoneNumber ? 'verified' : 'unverified');
    const identityProvider =
      record?.identityVerification?.provider ?? (record?.phoneNumber ? 'phone_number_mvp' : null);
    const payoutAccountStatus = record?.payoutAccount?.status ?? 'missing';
    const payoutExceptionStatus = record?.payoutException?.status ?? 'none';
    const identityVerified = identityStatus === 'verified';
    const payoutReady = payoutAccountStatus === 'registered';
    const payoutExceptionApproved = payoutExceptionStatus === 'approved';

    return {
      identityVerification: {
        status: identityStatus,
        provider: identityProvider,
        verifiedNameMasked: record?.identityVerification?.verifiedNameMasked ?? null,
        verifiedAt: record?.identityVerification?.verifiedAt ?? null,
        expiresAt: record?.identityVerification?.expiresAt ?? null,
      },
      payoutAccount: {
        status: payoutAccountStatus,
        bankName: record?.payoutAccount?.bankName ?? null,
        accountHolderMasked: record?.payoutAccount?.accountHolderMasked ?? null,
        accountLast4: record?.payoutAccount?.accountLast4 ?? null,
        holderMatchesIdentity: record?.payoutAccount?.holderMatchesIdentity ?? false,
        updatedAt: record?.payoutAccount?.updatedAt ?? null,
      },
      payoutException: {
        status: payoutExceptionStatus,
        reason: record?.payoutException?.reason ?? null,
        documentAttached: record?.payoutException?.documentAttached ?? false,
        approvedByUserId: record?.payoutException?.approvedByUserId ?? null,
        approvedAt: record?.payoutException?.approvedAt ?? null,
        updatedAt: record?.payoutException?.updatedAt ?? null,
      },
      eligibility: {
        identityVerified,
        payoutReady,
        payoutExceptionApproved,
        canReceiveSettlement: identityVerified && (payoutReady || payoutExceptionApproved),
      },
    };
  }

  private payoutEligibility(input: {
    eventCount: number;
    manualSettlement: { status: string } | null;
    settlementCompliance?: SettlementComplianceSummary[];
  }) {
    const blockingReasons: string[] = [];
    const compliance = input.settlementCompliance ?? [];

    if (input.eventCount < 1) {
      blockingReasons.push('no_revenue_events');
    }

    if (input.manualSettlement?.status === 'paid') {
      blockingReasons.push('already_paid');
    }

    if (compliance.length > 0 && !compliance.some((item) => item.eligibility.canReceiveSettlement)) {
      blockingReasons.push('no_verified_payout_profile');
    }

    return {
      canMarkPaid: blockingReasons.length === 0,
      blockingReasons,
      identityVerification: {
        status: compliance.length
          ? compliance.every((item) => item.eligibility.identityVerified)
            ? 'verified'
            : compliance.some((item) => item.eligibility.identityVerified)
              ? 'partial'
              : 'unverified'
          : 'not_connected',
        note: compliance.length
          ? 'Uses user identity verification records with phone-number MVP fallback.'
          : 'No creator or partner user is attached to this settlement row.',
      },
      payoutAccount: {
        status: compliance.length
          ? compliance.some((item) => item.eligibility.payoutReady)
            ? 'registered'
            : 'missing'
          : 'not_connected',
        note: compliance.length
          ? 'Only masked payout account fields are exposed.'
          : 'No creator or partner user is attached to this settlement row.',
      },
      payoutException: {
        status: compliance.some((item) => item.eligibility.payoutExceptionApproved)
          ? 'approved'
          : compliance.some((item) => item.payoutException.status === 'pending')
            ? 'pending'
            : compliance.length
              ? 'none'
              : 'not_connected',
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

  private authActionTokenStatusWhere(
    status: string,
    now: Date,
  ): Prisma.UserActionTokenWhereInput {
    if (status === 'pending') {
      return {
        consumedAt: null,
        expiresAt: { gt: now },
      };
    }

    if (status === 'consumed') {
      return {
        consumedAt: { not: null },
      };
    }

    if (status === 'expired') {
      return {
        consumedAt: null,
        expiresAt: { lte: now },
      };
    }

    return {};
  }

  private authActionTokenAuditItem(row: AuthActionTokenAuditRow, now: Date) {
    const status = this.authActionTokenAuditStatus(row, now);

    return {
      id: row.id,
      purpose: row.purpose,
      status,
      statusKey: `admin.authActionTokens.status.${status}`,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
      delivery: {
        status: row.deliveryStatus,
        channel: row.deliveryChannel,
        provider: row.deliveryProvider,
        persisted: row.deliveryStatus !== 'not_recorded',
        source: 'user_action_tokens.delivery_audit_fields',
        attemptedAt: row.deliveryAttemptedAt,
        acceptedAt: row.deliveryAcceptedAt,
        failedAt: row.deliveryFailedAt,
        statusKey: `admin.authActionTokens.delivery.${row.deliveryStatus}`,
      },
      target: {
        userId: row.userId,
        emailMasked: row.targetEmailMasked ?? this.maskEmail(row.user.email),
        userStatus: row.user.status,
        emailVerified: Boolean(row.user.emailVerifiedAt),
        deleted: Boolean(row.user.deletedAt),
      },
      sensitiveFields: {
        rawTokenReturned: false,
        tokenHashReturned: false,
        rawEmailReturned: false,
        mailBodyReturned: false,
      },
    };
  }

  private authActionTokenAuditStatus(row: AuthActionTokenAuditRow, now: Date) {
    if (row.consumedAt) {
      return 'consumed';
    }

    if (row.expiresAt.getTime() <= now.getTime()) {
      return 'expired';
    }

    return 'pending';
  }

  private authActionTokenAuditPolicy() {
    return {
      targetEmailMasked: true,
      rawEmailReturned: false,
      rawTokenReturned: false,
      tokenHashReturned: false,
      mailBodyReturned: false,
      deliveryStatusPersisted: true,
      deliveryProviderPersisted: true,
      deliveryRawProviderResponseReturned: false,
      requestCooldownSeconds: 60,
      duplicatePendingTokenPolicy:
        'reuse_recent_pending_token_within_cooldown_else_consume_previous',
      cooldownDuplicateRequestsCreateNewRow: false,
      supportedPurposes: [...AUTH_ACTION_TOKEN_PURPOSES],
      supportedStatuses: [...AUTH_ACTION_TOKEN_STATUSES],
      supportedDeliveryStatuses: [...AUTH_ACTION_TOKEN_DELIVERY_STATUSES],
      supportedDeliveryProviders: [...AUTH_ACTION_TOKEN_DELIVERY_PROVIDERS],
    };
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

  private walletAdjustmentDirection(input: AdminPayload) {
    const value = this.string(input, 'direction').toLowerCase();

    if (['credit', 'add', 'grant', 'plus'].includes(value)) {
      return 'credit';
    }

    if (['debit', 'remove', 'deduct', 'minus', 'revoke'].includes(value)) {
      return 'debit';
    }

    throw new BadRequestException('direction must be credit or debit');
  }

  private walletAdjustmentReasonType(input: AdminPayload) {
    const reasonType = this.string(input, 'reasonType', 'manual_correction');

    if (!WALLET_ADJUSTMENT_REASONS.has(reasonType)) {
      throw new BadRequestException(
        `reasonType must be one of ${[...WALLET_ADJUSTMENT_REASONS].join(', ')}`,
      );
    }

    return reasonType;
  }

  private walletAdjustmentAmount(input: AdminPayload) {
    const amount = this.decimal(input, 'amountLumina');

    if (amount.lte(0) || amount.gt(100_000)) {
      throw new BadRequestException('amountLumina must be between 0 and 100000');
    }

    return amount;
  }

  private walletAdjustmentNote(input: AdminPayload) {
    const note =
      this.optionalString(input, 'note') ??
      this.optionalString(input, 'reason') ??
      this.optionalString(input, 'adminNote');

    if (!note) {
      throw new BadRequestException('note is required for wallet adjustments');
    }

    if (WALLET_ADJUSTMENT_PLACEHOLDER_NOTES.has(note)) {
      throw new BadRequestException('operator-entered note is required for wallet adjustments');
    }

    return note;
  }

  private walletAdjustmentTargetRefs(input: AdminPayload) {
    const refs: { userId?: string; email?: string; label: string }[] = [];
    const addRef = (value: unknown) => {
      const text = String(value ?? '').trim();
      if (!text) {
        return;
      }

      if (this.isUuid(text)) {
        refs.push({ userId: text, label: text });
        return;
      }

      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
        refs.push({ email: text.toLowerCase(), label: text });
        return;
      }

      throw new BadRequestException(`Invalid wallet adjustment target: ${text}`);
    };
    const addTextList = (value?: string) => {
      value
        ?.split(/[\n,;\t ]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach(addRef);
    };

    addRef(this.optionalString(input, 'userId'));
    addRef(this.optionalString(input, 'email'));
    addTextList(this.optionalString(input, 'userIds'));
    addTextList(this.optionalString(input, 'emails'));
    addTextList(this.optionalString(input, 'targetUsers'));
    addTextList(this.optionalString(input, 'targetsText'));

    const targets = input.targets;
    if (Array.isArray(targets)) {
      for (const target of targets) {
        if (typeof target === 'string') {
          addRef(target);
          continue;
        }

        if (target && typeof target === 'object' && !Array.isArray(target)) {
          const objectTarget = target as AdminPayload;
          addRef(objectTarget.userId ?? objectTarget.email ?? objectTarget.identifier);
        }
      }
    }

    const seen = new Set<string>();
    return refs.filter((ref) => {
      const key = ref.userId ? `id:${ref.userId}` : `email:${ref.email}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private async walletAdjustmentTargets(input: AdminPayload, maxTargets: number) {
    const refs = this.walletAdjustmentTargetRefs(input);

    if (!refs.length) {
      throw new BadRequestException('At least one wallet adjustment target is required');
    }

    if (refs.length > maxTargets) {
      throw new BadRequestException(`Wallet adjustment target limit is ${maxTargets}`);
    }

    const userIds = refs.map((ref) => ref.userId).filter(Boolean) as string[];
    const emails = refs.map((ref) => ref.email).filter(Boolean) as string[];
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        OR: [
          ...userIds.map((id) => ({ id })),
          ...emails.map((email) => ({
            email: { equals: email, mode: 'insensitive' as const },
          })),
        ],
      },
      select: {
        id: true,
        email: true,
        status: true,
        profile: {
          select: {
            displayName: true,
            publicHandle: true,
          },
        },
        walletAccounts: {
          where: { currencyCode: DEFAULT_CURRENCY },
          select: {
            id: true,
            status: true,
            currencyCode: true,
            cachedBalance: true,
          },
          take: 1,
        },
      },
    });
    const byUserId = new Map(users.map((user) => [user.id, user]));
    const byEmail = new Map(
      users
        .filter((user) => user.email)
        .map((user) => [user.email!.toLowerCase(), user]),
    );
    const resolved = refs.map((ref) =>
      ref.userId ? byUserId.get(ref.userId) : byEmail.get(ref.email ?? ''),
    );
    const missing = refs.filter((_, index) => !resolved[index]).map((ref) => ref.label);

    if (missing.length) {
      throw new NotFoundException(`Wallet adjustment target not found: ${missing.join(', ')}`);
    }

    return resolved as NonNullable<(typeof resolved)[number]>[];
  }

  private async applyWalletAdjustments(
    user: AuthUser,
    input: AdminPayload,
    targets: Awaited<ReturnType<AdminService['walletAdjustmentTargets']>>,
  ) {
    const direction = this.walletAdjustmentDirection(input);
    const amount = this.walletAdjustmentAmount(input);
    const reasonType = this.walletAdjustmentReasonType(input);
    const note = this.walletAdjustmentNote(input);
    const batchId = randomUUID();
    const now = new Date();
    const items = await this.prisma.$transaction(async (tx) => {
      const results: AdminPayload[] = [];

      for (const target of targets) {
        const existingWallet = target.walletAccounts[0] ?? null;
        if (existingWallet && existingWallet.status !== 'active') {
          throw new BadRequestException(`Wallet is not active for user ${target.id}`);
        }

        if (direction === 'debit' && !existingWallet) {
          throw new BadRequestException(`Active wallet not found for user ${target.id}`);
        }

        if (direction === 'debit' && existingWallet!.cachedBalance.lt(amount)) {
          throw new BadRequestException(`Insufficient Lumina balance for user ${target.id}`);
        }

        const wallet =
          existingWallet ??
          (await tx.walletAccount.create({
            data: {
              userId: target.id,
              currencyCode: DEFAULT_CURRENCY,
            },
          }));
        let beforeBalance: Decimal;
        let afterBalance: Decimal;

        if (direction === 'credit') {
          const updatedWallet = await tx.walletAccount.update({
            where: { id: wallet.id },
            data: {
              cachedBalance: { increment: amount },
              updatedAt: now,
            },
            select: { cachedBalance: true },
          });
          afterBalance = updatedWallet.cachedBalance;
          beforeBalance = afterBalance.minus(amount);
        } else {
          const updated = await tx.walletAccount.updateMany({
            where: {
              id: wallet.id,
              status: 'active',
              cachedBalance: { gte: amount },
            },
            data: {
              cachedBalance: { decrement: amount },
              updatedAt: now,
            },
          });

          if (updated.count !== 1) {
            throw new BadRequestException(`Insufficient Lumina balance for user ${target.id}`);
          }

          const updatedWallet = await tx.walletAccount.findUniqueOrThrow({
            where: { id: wallet.id },
            select: { cachedBalance: true },
          });
          afterBalance = updatedWallet.cachedBalance;
          beforeBalance = afterBalance.plus(amount);
        }

        const idempotencyKey = `admin-wallet-adjustment:${batchId}:${target.id}`;
        const ledger = await tx.walletLedger.create({
          data: {
            walletAccountId: wallet.id,
            direction,
            amount,
            ledgerType: 'admin_wallet_adjustment',
            referenceType: 'admin_wallet_adjustment',
            idempotencyKey,
            memo: `[${reasonType}] ${note}`.slice(0, 500),
          },
        });

        results.push({
          userId: target.id,
          email: this.maskEmail(target.email),
          displayName: target.profile?.displayName ?? target.profile?.publicHandle ?? null,
          walletAccountId: wallet.id,
          walletLedgerId: ledger.id,
          direction,
          amountLumina: amount.toString(),
          beforeBalance: beforeBalance.toString(),
          afterBalance: afterBalance.toString(),
        });
      }

      return results;
    });

    await this.recordAudit(
      user,
      targets.length > 1 ? 'wallet_adjustment.bulk' : 'wallet_adjustment.create',
      'wallet_account',
      targets.length === 1 ? (items[0]?.walletAccountId as string) : null,
      null,
      items,
      {
        batchId,
        direction,
        amountLumina: amount.toString(),
        reasonType,
        note,
        targetCount: targets.length,
      },
    );

    return {
      batchId,
      direction,
      amountLumina: amount,
      reasonType,
      targetCount: targets.length,
      items,
      policy: {
        requiresSuperAdmin: true,
        ledgerType: 'admin_wallet_adjustment',
        allowNegativeBalance: false,
        maxTargetsPerBulk: 100,
        maxAmountLuminaPerTarget: 100000,
      },
    };
  }

  private assertBackstageQaToolsEnabled() {
    if (this.configService.get<string>('ENABLE_BACKSTAGE_QA_TOOLS') === 'true') {
      return;
    }

    throw new ForbiddenException(
      'Backstage QA tools are disabled. Set ENABLE_BACKSTAGE_QA_TOOLS=true temporarily.',
    );
  }

  private async findQaCreatorSettlementUser(input: AdminPayload) {
    const userId = this.optionalString(input, 'userId');
    const email =
      this.optionalString(input, 'operatorEmail') ??
      this.optionalString(input, 'email');

    if (!userId && !email) {
      throw new BadRequestException('userId, operatorEmail, or email is required');
    }

    if (userId && !this.isUuid(userId)) {
      throw new BadRequestException('userId must be a UUID');
    }

    const targetUser = userId
      ? await this.prisma.user.findUnique({ where: { id: userId } })
      : await this.prisma.user.findFirst({
          where: {
            email: { equals: email?.toLowerCase(), mode: 'insensitive' },
          },
        });

    if (!targetUser || targetUser.status !== 'active' || targetUser.deletedAt) {
      throw new NotFoundException('Active creator operator user not found');
    }

    return targetUser;
  }

  private async findQaCreatorSettlementOperator(userId: string, artistId?: string) {
    if (artistId && !this.isUuid(artistId)) {
      throw new BadRequestException('artistId must be a UUID');
    }

    const operators = await this.prisma.artistOperator.findMany({
      where: {
        userId,
        ...(artistId ? { artistId } : {}),
        status: 'active',
        revokedAt: null,
      },
      include: this.artistOperatorInclude(),
      orderBy: [{ createdAt: 'desc' }],
    });

    const operator = operators[0];
    if (!operator) {
      throw new NotFoundException(
        artistId
          ? 'Active artist operator row not found for this user and artist'
          : 'Active artist operator row not found for this user',
      );
    }

    return operator;
  }

  private async findCreatorAccessArtist(input: AdminPayload) {
    const artistId = this.optionalString(input, 'artistId');
    const artistSlug =
      this.optionalString(input, 'artistSlug') ?? this.optionalString(input, 'slug');

    if (!artistId && !artistSlug) {
      throw new BadRequestException('artistId or artistSlug is required');
    }

    if (artistId && !this.isUuid(artistId)) {
      throw new BadRequestException('artistId must be a UUID');
    }

    const artist = artistId
      ? await this.prisma.artist.findUnique({ where: { id: artistId } })
      : await this.prisma.artist.findUnique({ where: { slug: artistSlug } });

    if (!artist) {
      throw new NotFoundException('Artist not found');
    }

    return artist;
  }

  private creatorAccessItem(
    operator: {
      id: string;
      userId: string;
      artistId: string;
      role: string;
      status: string;
      permissions: string[];
      createdAt: Date;
      updatedAt: Date;
      revokedAt: Date | null;
      user: unknown;
      artist: unknown;
    },
  ) {
    return {
      operatorId: operator.id,
      userId: operator.userId,
      artistId: operator.artistId,
      role: operator.role,
      status: operator.status,
      permissions: operator.permissions,
      canEnterCreatorStudio: operator.status === 'active' && operator.revokedAt === null,
      creatorStudioUrl: '/creator-studio.html',
      createdAt: operator.createdAt,
      updatedAt: operator.updatedAt,
      revokedAt: operator.revokedAt,
      user: operator.user,
      artist: operator.artist,
    };
  }

  private creatorAccessPolicy() {
    return {
      purpose: 'Grant or restore Creator Studio access by user email and selected artist.',
      accessRule:
        'Creator Studio opens when the logged-in active user has an active artist_operators row with revokedAt null or an approved debut application pending artist-operator linkage.',
      recommendedGrantBody: {
        email: 'creator@example.com',
        artistId: 'artist-uuid',
        role: 'owner',
        status: 'active',
        permissions: [
          'feed:post',
          'feed:reply',
          'image:request',
          'profile:update',
          'settlement:read',
        ],
      },
      frontendChecks: {
        userEndpoint: 'GET /api/v1/me/creator-studio',
        enabledPath: 'access.enabled',
        backstageListEndpoint: 'GET /admin/api/v1/backstage/operations/creator-access',
        backstageGrantEndpoint: 'POST /admin/api/v1/backstage/operations/creator-access',
        backstageUpdateEndpoint:
          'PATCH /admin/api/v1/backstage/operations/creator-access/:operatorId',
      },
    };
  }

  private creatorAccessDiagnosticReason(input: {
    exactMatchCount: number;
    activeUsersCount: number;
    activeOperatorsCount: number;
    approvedApplicationsCount: number;
    activeAdminUsersCount: number;
    totalOperatorsCount: number;
  }) {
    if (input.exactMatchCount === 0) {
      return 'user_not_found_or_email_mismatch';
    }

    if (input.activeUsersCount === 0) {
      return 'user_not_active_or_deleted';
    }

    if (input.activeOperatorsCount > 0) {
      return 'creator_studio_access_ready';
    }

    if (input.approvedApplicationsCount > 0) {
      return 'approved_debut_application_access_ready';
    }

    if (input.activeAdminUsersCount > 0) {
      return 'active_admin_operator_access_ready';
    }

    if (input.totalOperatorsCount === 0) {
      return 'no_artist_operator_rows';
    }

    if (input.activeOperatorsCount === 0) {
      return 'artist_operator_exists_but_not_active';
    }

    return 'creator_studio_access_ready';
  }

  private creatorAccessDiagnosticNextActions(input: {
    accessEnabled: boolean;
    exactMatchCount: number;
    activeUsersCount: number;
    activeOperatorsCount: number;
    approvedApplicationsCount: number;
    activeAdminUsersCount: number;
    totalOperatorsCount: number;
  }) {
    if (input.accessEnabled) {
      return [
        'Ask the user to sign out and sign in again, then refresh /creator-studio.html.',
        'If the page still blocks access, verify that the frontend sends Authorization: Bearer <accessToken> to GET /api/v1/me/creator-studio.',
      ];
    }

    if (input.exactMatchCount === 0) {
      return [
        'Confirm the exact login email shown in My Page or auth response.',
        'If the user used social login, check whether the provider returned a different email.',
      ];
    }

    if (input.activeUsersCount === 0) {
      return ['Restore or reactivate the user before granting Creator Studio access.'];
    }

    if (input.totalOperatorsCount === 0) {
      return [
        'Grant Creator Studio access with POST /admin/api/v1/backstage/operations/creator-access, or approve the debut application if the user should enter before an artist operator row exists.',
        'Use the user email and selected artistId from the Backstage UI when granting direct artist access.',
      ];
    }

    if (input.activeOperatorsCount === 0) {
      return [
        'Patch the existing creator access row to status active.',
        'Ensure revokedAt becomes null when status is active.',
      ];
    }

    return ['Re-run diagnostics after the next grant/update action.'];
  }

  private objectStorageDiagnosticReason(input: {
    storageProvider: string;
    readyForDirectUpload: boolean;
    missingRequiredEnv: string[];
    missingDisplayEnv: string[];
    missingR2Env: string[];
  }) {
    if (input.storageProvider === 'local') {
      return 'local_metadata_only';
    }

    if (input.storageProvider !== 's3' && input.storageProvider !== 'r2') {
      return 'unsupported_storage_provider';
    }

    if (input.missingR2Env.length > 0) {
      return 'r2_endpoint_missing';
    }

    if (input.missingRequiredEnv.length > 0) {
      return 'direct_upload_env_incomplete';
    }

    if (input.missingDisplayEnv.length > 0) {
      return 'direct_upload_ready_public_url_missing';
    }

    if (input.readyForDirectUpload) {
      return 'direct_upload_ready';
    }

    return 'object_storage_needs_review';
  }

  private objectStorageDiagnosticNextActions(input: {
    storageProvider: string;
    readyForDirectUpload: boolean;
    missingRequiredEnv: string[];
    missingDisplayEnv: string[];
    missingR2Env: string[];
  }) {
    if (input.storageProvider === 'local') {
      return [
        'Set OBJECT_STORAGE_PROVIDER to s3 or r2 for real browser image uploads.',
        'Use local only for metadata-only development flows.',
      ];
    }

    if (input.storageProvider !== 's3' && input.storageProvider !== 'r2') {
      return ['Set OBJECT_STORAGE_PROVIDER to local, s3, or r2.'];
    }

    if (input.missingR2Env.length > 0) {
      return ['Set OBJECT_STORAGE_ENDPOINT for R2-compatible direct uploads.'];
    }

    if (input.missingRequiredEnv.length > 0) {
      return [
        'Complete the missing OBJECT_STORAGE_* environment variables in Render.',
        'Redeploy the API after environment variables are changed.',
      ];
    }

    if (input.missingDisplayEnv.length > 0) {
      return [
        'Direct upload can be signed, but image display may fail until OBJECT_STORAGE_PUBLIC_BASE_URL is configured.',
      ];
    }

    if (input.readyForDirectUpload) {
      return [
        'If PUT still fails, compare the upload intent URL X-Amz-SignedHeaders with content-type;host.',
        'If PUT succeeds but images do not render, check bucket/CDN public GET access and OBJECT_STORAGE_PUBLIC_BASE_URL.',
      ];
    }

    return ['Re-run diagnostics after storage configuration changes.'];
  }

  private normalizedObjectStorageKeyPrefix() {
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

  private positiveEnvNumber(key: string, fallback: number) {
    const value = this.configService.get<string>(key);

    if (!value) {
      return fallback;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private maskProviderUserId(value: string) {
    if (value.length <= 8) {
      return '***';
    }

    return `${value.slice(0, 4)}***${value.slice(-4)}`;
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

  private communityPostAuditSnapshot(post: unknown) {
    const row = this.metadataObject(post);
    const metadata = this.metadataObject(row.metadata);
    const moderation = this.metadataObject(metadata.moderation);
    const author = this.metadataObject(row.author);
    const artist = this.metadataObject(row.artist);

    return {
      id: this.stringOrNull(row.id),
      status: this.stringOrNull(row.status),
      visibility: this.stringOrNull(row.visibility),
      postType: this.stringOrNull(row.postType),
      authorUserId: this.stringOrNull(row.authorUserId),
      artistId: this.stringOrNull(row.artistId),
      reportCount: this.numberOrNull(row.reportCount),
      publishedAt: this.isoOrNull(row.publishedAt),
      deletedAt: this.isoOrNull(row.deletedAt),
      bodyPresent: typeof row.body === 'string' && row.body.length > 0,
      bodyLength: typeof row.body === 'string' ? row.body.length : 0,
      author: Object.keys(author).length
        ? {
            id: this.stringOrNull(author.id),
            status: this.stringOrNull(author.status),
            emailMasked: this.maskEmail(this.stringOrNull(author.email)),
          }
        : null,
      artist: Object.keys(artist).length
        ? {
            id: this.stringOrNull(artist.id),
            slug: this.stringOrNull(artist.slug),
            status: this.stringOrNull(artist.status),
          }
        : null,
      moderation: {
        status: this.stringOrNull(moderation.status),
        reason: this.stringOrNull(moderation.reason),
        notePresent: typeof moderation.note === 'string' && moderation.note.length > 0,
        hiddenByUserId: this.stringOrNull(moderation.hiddenByUserId),
        restoredByUserId: this.stringOrNull(moderation.restoredByUserId),
        hiddenAt: this.stringOrNull(moderation.hiddenAt),
        restoredAt: this.stringOrNull(moderation.restoredAt),
      },
      auditRawBodyStored: false,
      auditRawEmailStored: false,
      auditRawModerationNoteStored: false,
      auditTokenCookiePasswordStored: false,
      auditDbUrlStored: false,
    };
  }

  private communityModerationAuditMetadata(input: AdminPayload) {
    const note = this.optionalString(input, 'note');
    const reason = this.optionalString(input, 'reason');

    return {
      reason: reason ?? null,
      notePresent: Boolean(note),
      rawBodyStored: false,
      rawEmailStored: false,
      rawModerationNoteStored: false,
      tokenCookiePasswordStored: false,
      dbUrlStored: false,
    };
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

  private adminBadRequest(
    code: string,
    message: string,
    messageKey: string,
    details: AdminPayload = {},
  ) {
    return new BadRequestException({ code, message, messageKey, details });
  }

  private adminConflict(
    code: string,
    message: string,
    messageKey: string,
    details: AdminPayload = {},
  ) {
    return new ConflictException({ code, message, messageKey, details });
  }

  private adminNotFound(
    code: string,
    message: string,
    messageKey: string,
    details: AdminPayload = {},
  ) {
    return new NotFoundException({ code, message, messageKey, details });
  }

  private async backstageFanMissionCreateData(input: AdminPayload) {
    const artistId = this.fanMissionOptionalUuid(
      input,
      'artistId',
      'FAN_MISSION_INVALID_ARTIST_ID',
      'admin.fanEngagement.mission.invalidArtistId',
    );
    const actionTargetId = this.fanMissionOptionalUuid(
      input,
      'actionTargetId',
      'FAN_MISSION_INVALID_ACTION_TARGET_ID',
      'admin.fanEngagement.mission.invalidActionTargetId',
    );
    const startsAt = this.fanMissionDate(input, 'startsAt');
    const endsAt = this.fanMissionDate(input, 'endsAt');

    if (endsAt <= startsAt) {
      throw this.adminBadRequest(
        'FAN_MISSION_INVALID_WINDOW',
        'Fan mission endsAt must be after startsAt',
        'admin.fanEngagement.mission.invalidWindow',
      );
    }

    if (artistId) {
      const artist = await this.prisma.artist.findUnique({
        where: { id: artistId },
        select: { id: true },
      });

      if (!artist) {
        throw this.adminNotFound(
          'FAN_MISSION_ARTIST_NOT_FOUND',
          'Artist not found',
          'admin.fanEngagement.mission.artistNotFound',
        );
      }
    }

    return {
      artistId,
      slug: this.fanMissionSlug(input),
      missionType: this.fanMissionSafeKey(
        input,
        'missionType',
        'FAN_MISSION_INVALID_TYPE',
        'admin.fanEngagement.mission.invalidType',
      ),
      status: this.fanMissionStatus(input),
      surfaces: this.fanMissionSurfaces(input),
      resetPolicy: this.fanMissionResetPolicy(input),
      actionType: this.fanMissionOptionalSafeKey(
        input,
        'actionType',
        'FAN_MISSION_INVALID_ACTION_TYPE',
        'admin.fanEngagement.mission.invalidActionType',
      ),
      actionTargetId,
      rewardPolicy: this.toJson(this.fanMissionRewardPolicy(input)),
      copy: this.toJson(this.fanMissionCopy(input)),
      startsAt,
      endsAt,
    } satisfies Prisma.FanMissionUncheckedCreateInput;
  }

  private async createFanMissionWithStableDuplicateError(
    data: Prisma.FanMissionUncheckedCreateInput,
  ) {
    try {
      return await this.prisma.fanMission.create({
        data,
        include: BACKSTAGE_FAN_MISSION_INCLUDE,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw this.adminConflict(
          'FAN_MISSION_SLUG_EXISTS',
          'Fan mission slug already exists',
          'admin.fanEngagement.mission.slugExists',
          { slug: data.slug },
        );
      }

      throw error;
    }
  }

  private backstageFanMission(mission: BackstageFanMission) {
    return {
      id: mission.id,
      slug: mission.slug,
      missionType: mission.missionType,
      status: mission.status,
      statusKey: `fanMission.status.${mission.status}`,
      surfaces: mission.surfaces,
      resetPolicy: mission.resetPolicy,
      action: {
        type: mission.actionType,
        targetId: mission.actionTargetId,
      },
      artist: mission.artist
        ? {
            id: mission.artist.id,
            slug: mission.artist.slug,
            displayName: mission.artist.displayName,
            status: mission.artist.status,
          }
        : null,
      rewardPolicy: this.fanMissionRewardPolicyForResponse(mission.rewardPolicy),
      copy: this.metadataObject(mission.copy),
      startsAt: mission.startsAt,
      endsAt: mission.endsAt,
      createdAt: mission.createdAt,
      updatedAt: mission.updatedAt,
      policy: this.fanMissionNonCashPolicy(),
    };
  }

  private fanMissionPublicReadiness(mission: BackstageFanMission) {
    const now = new Date();
    const homeEligible =
      mission.status === 'active' &&
      (mission.surfaces.length === 0 || mission.surfaces.includes('home')) &&
      (!mission.startsAt || mission.startsAt <= now) &&
      (!mission.endsAt || mission.endsAt > now);

    return {
      publicListEndpoint:
        'GET /api/v1/fan-engagement/missions?surface=home&scope=today&take=3',
      homeTodayEligible: homeEligible,
      warningKey: homeEligible ? null : 'admin.fanEngagement.mission.notHomeTodayEligible',
      policy: this.fanMissionNonCashPolicy(),
    };
  }

  private fanMissionNonCashPolicy() {
    return { ...FAN_MISSION_NON_CASH_POLICY };
  }

  private fanMissionSlug(input: AdminPayload) {
    const slug = this.fanMissionRequiredString(
      input,
      'slug',
      'FAN_MISSION_SLUG_REQUIRED',
      'admin.fanEngagement.mission.slugRequired',
    ).toLowerCase();

    if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(slug)) {
      throw this.adminBadRequest(
        'FAN_MISSION_INVALID_SLUG',
        'Fan mission slug must be lowercase alphanumeric with hyphens',
        'admin.fanEngagement.mission.invalidSlug',
      );
    }

    return slug;
  }

  private fanMissionStatus(input: AdminPayload) {
    const status = this.fanMissionRequiredString(
      input,
      'status',
      'FAN_MISSION_STATUS_REQUIRED',
      'admin.fanEngagement.mission.statusRequired',
    );

    if (!FAN_MISSION_STATUSES.has(status)) {
      throw this.adminBadRequest(
        'FAN_MISSION_INVALID_STATUS',
        'Invalid fan mission status',
        'admin.fanEngagement.mission.invalidStatus',
        { allowed: [...FAN_MISSION_STATUSES] },
      );
    }

    return status;
  }

  private fanMissionSurfaces(input: AdminPayload) {
    const singleSurface = this.fanMissionOptionalString(
      input,
      'surface',
      'FAN_MISSION_INVALID_SURFACE',
      'admin.fanEngagement.mission.invalidSurface',
    );
    const surfaceList = this.fanMissionOptionalStringArray(
      input,
      'surfaces',
      'FAN_MISSION_INVALID_SURFACES',
      'admin.fanEngagement.mission.invalidSurfaces',
    );
    const surfaces = [...new Set([...surfaceList, ...(singleSurface ? [singleSurface] : [])])];

    if (surfaces.length === 0) {
      throw this.adminBadRequest(
        'FAN_MISSION_INVALID_SURFACES',
        'At least one fan mission surface is required',
        'admin.fanEngagement.mission.invalidSurfaces',
        { allowed: [...FAN_MISSION_SURFACES] },
      );
    }

    const invalid = surfaces.filter((surface) => !FAN_MISSION_SURFACES.has(surface));

    if (invalid.length > 0) {
      throw this.adminBadRequest(
        'FAN_MISSION_INVALID_SURFACE',
        'Invalid fan mission surface',
        'admin.fanEngagement.mission.invalidSurface',
        { invalid, allowed: [...FAN_MISSION_SURFACES] },
      );
    }

    return surfaces;
  }

  private fanMissionResetPolicy(input: AdminPayload) {
    const resetPolicy = this.fanMissionRequiredString(
      input,
      'resetPolicy',
      'FAN_MISSION_RESET_POLICY_REQUIRED',
      'admin.fanEngagement.mission.resetPolicyRequired',
    );
    const [policy, value] = resetPolicy.split(':', 2);
    const valid =
      ['once', 'daily', 'weekly'].includes(resetPolicy) ||
      (policy === 'season' && Boolean(value) && /^[a-z0-9][a-z0-9_-]{1,80}$/.test(value));

    if (!valid) {
      throw this.adminBadRequest(
        'FAN_MISSION_INVALID_RESET_POLICY',
        'Invalid fan mission reset policy',
        'admin.fanEngagement.mission.invalidResetPolicy',
        { examples: ['once', 'daily', 'weekly', 'season:qa-20260510-run1'] },
      );
    }

    return resetPolicy;
  }

  private fanMissionRewardPolicy(input: AdminPayload) {
    const rewardPolicy = this.object(input, 'rewardPolicy');

    if (!rewardPolicy) {
      throw this.adminBadRequest(
        'FAN_MISSION_INVALID_REWARD_POLICY',
        'rewardPolicy must be an object',
        'admin.fanEngagement.mission.invalidRewardPolicy',
      );
    }

    const points = Number(rewardPolicy.points ?? 0);

    if (!Number.isInteger(points) || points < 0 || points > 1000) {
      throw this.adminBadRequest(
        'FAN_MISSION_INVALID_REWARD_POINTS',
        'rewardPolicy.points must be an integer fan point amount',
        'admin.fanEngagement.mission.invalidRewardPoints',
      );
    }

    const forbiddenKey = this.firstForbiddenFanRewardKey(rewardPolicy);

    if (forbiddenKey) {
      throw this.adminBadRequest(
        'FAN_MISSION_CASH_LIKE_REWARD_FORBIDDEN',
        'Fan mission rewards must remain non-cash fan engagement points',
        'admin.fanEngagement.mission.cashLikeRewardForbidden',
        { key: forbiddenKey },
      );
    }

    return rewardPolicy;
  }

  private fanMissionRewardPolicyForResponse(value: Prisma.JsonValue) {
    const rewardPolicy = this.metadataObject(value);
    const points = Number(rewardPolicy.points ?? 0);

    return {
      ...rewardPolicy,
      points: Number.isInteger(points) && points >= 0 ? points : 0,
      policy: this.fanMissionNonCashPolicy(),
    };
  }

  private fanMissionCopy(input: AdminPayload) {
    const copy = this.object(input, 'copy');

    if (!copy) {
      throw this.adminBadRequest(
        'FAN_MISSION_INVALID_COPY',
        'copy must be an object with stable keys',
        'admin.fanEngagement.mission.invalidCopy',
      );
    }

    const requiredKeys = ['titleKey', 'descriptionKey', 'ctaKey', 'statusKey'];
    const missing = requiredKeys.filter((key) => typeof copy[key] !== 'string' || !copy[key]);

    if (missing.length > 0) {
      throw this.adminBadRequest(
        'FAN_MISSION_COPY_KEYS_REQUIRED',
        'Fan mission copy requires stable message keys',
        'admin.fanEngagement.mission.copyKeysRequired',
        { missing },
      );
    }

    return copy;
  }

  private fanMissionSafeKey(
    input: AdminPayload,
    key: string,
    code: string,
    messageKey: string,
  ) {
    const value = this.fanMissionRequiredString(
      input,
      key,
      code,
      messageKey,
    );

    if (!/^[a-z][a-z0-9_:-]{1,80}$/.test(value)) {
      throw this.adminBadRequest(code, `${key} must be a stable key`, messageKey);
    }

    return value;
  }

  private fanMissionOptionalSafeKey(
    input: AdminPayload,
    key: string,
    code: string,
    messageKey: string,
  ) {
    return input[key] === undefined
      ? undefined
      : this.fanMissionSafeKey(input, key, code, messageKey);
  }

  private fanMissionOptionalUuid(
    input: AdminPayload,
    key: string,
    code: string,
    messageKey: string,
  ) {
    const value = this.fanMissionOptionalString(input, key, code, messageKey);

    if (value && !this.isUuid(value)) {
      throw this.adminBadRequest(code, `${key} must be a UUID`, messageKey);
    }

    return value;
  }

  private fanMissionRequiredString(
    input: AdminPayload,
    key: string,
    code: string,
    messageKey: string,
  ) {
    const value = input[key];

    if (typeof value !== 'string' || !value.trim()) {
      throw this.adminBadRequest(code, `${key} must be a non-empty string`, messageKey);
    }

    return value.trim();
  }

  private fanMissionOptionalString(
    input: AdminPayload,
    key: string,
    code: string,
    messageKey: string,
  ) {
    const value = input[key];

    if (value === undefined) {
      return undefined;
    }

    if (typeof value !== 'string' || !value.trim()) {
      throw this.adminBadRequest(code, `${key} must be a non-empty string`, messageKey);
    }

    return value.trim();
  }

  private fanMissionOptionalStringArray(
    input: AdminPayload,
    key: string,
    code: string,
    messageKey: string,
  ) {
    const value = input[key];

    if (value === undefined) {
      return [];
    }

    if (
      !Array.isArray(value) ||
      value.some((item) => typeof item !== 'string' || !item.trim())
    ) {
      throw this.adminBadRequest(code, `${key} must be an array of strings`, messageKey);
    }

    return value.map((item) => item.trim());
  }

  private fanMissionDate(input: AdminPayload, key: string) {
    const value = input[key];
    const date = new Date(String(value));

    if (!value || Number.isNaN(date.getTime())) {
      throw this.adminBadRequest(
        'FAN_MISSION_INVALID_DATE',
        `${key} must be a valid date`,
        'admin.fanEngagement.mission.invalidDate',
        { field: key },
      );
    }

    return date;
  }

  private firstForbiddenFanRewardKey(value: unknown): string | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.firstForbiddenFanRewardKey(item)).find(Boolean) ?? null;
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      const normalized = key.toLowerCase();

      if (FAN_MISSION_FORBIDDEN_REWARD_KEYS.includes(normalized)) {
        return key;
      }

      const nested = this.firstForbiddenFanRewardKey(nestedValue);

      if (nested) {
        return nested;
      }
    }

    return null;
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

  private buildUploadUrl(
    storageProvider: string,
    storageKey: string,
    expiresInSeconds: number,
    mimeType: string,
  ) {
    if (storageProvider === 'r2' || storageProvider === 's3') {
      return this.buildS3CompatiblePresignedPutUrl(
        storageProvider,
        storageKey,
        expiresInSeconds,
        mimeType,
      );
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
    mimeType: string,
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
    const signedHeaders = 'content-type;host';

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
      `content-type:${mimeType}\nhost:${url.host}\n`,
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

  private assertUuid(value: string, field: string) {
    if (!this.isUuid(value)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
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

  private walletLedgerDailyWindow(input: AdminPayload) {
    const serviceDate = this.optionalString(input, 'serviceDate') ?? this.todayIsoDate();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
      throw this.adminBadRequest(
        'WALLET_DAILY_RECONCILE_INVALID_SERVICE_DATE',
        'serviceDate must be YYYY-MM-DD',
        'admin.walletDailyReconcile.invalidServiceDate',
      );
    }

    const start = new Date(`${serviceDate}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) {
      throw this.adminBadRequest(
        'WALLET_DAILY_RECONCILE_INVALID_SERVICE_DATE',
        'serviceDate must be YYYY-MM-DD',
        'admin.walletDailyReconcile.invalidServiceDate',
      );
    }

    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    return { serviceDate, start, end };
  }

  private todayIsoDate() {
    return new Date().toISOString().slice(0, 10);
  }

  private decimalText(value: Decimal) {
    return value.toDecimalPlaces(2).toString();
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

  private stringOrNull(value: unknown) {
    return typeof value === 'string' && value.length ? value : null;
  }

  private numberOrNull(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private isoOrNull(value: unknown) {
    if (value instanceof Date) {
      return value.toISOString();
    }

    return typeof value === 'string' && value.length ? value : null;
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

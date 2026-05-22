import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AuthUser } from '../auth/auth.types';
import { buildPublicAssetUrl } from '../common/asset-url';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCreatorStudioKnowledgeUrlDto,
  CreateCreatorStudioSettlementConversionDto,
  CreatorStudioKnowledgeUrlQueryDto,
  CreatorStudioSettlementConversionQueryDto,
  CreatorStudioSettlementPreviewQueryDto,
  ReviewCreatorStudioKnowledgeUrlDto,
  UpdateCreatorStudioKnowledgeUrlDto,
  UpdateCreatorStudioArtistProfileDto,
} from './dto/creator-studio.dto';

const OPEN_IMAGE_REQUEST_STATUSES = [
  'submitted',
  'reviewing',
  'generating',
  'needs_more_info',
];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CREATOR_STUDIO_INITIAL_SLOT_LIMIT = 10;
const CREATOR_PAYOUT_CURRENCY = 'KRW';
const CREATOR_PAYOUT_WITHHOLDING_TAX_BPS = 330;
const CREATOR_PAYOUT_FX_SAFE_MARGIN_MIN_BPS = 300;
const CREATOR_PAYOUT_FX_SAFE_MARGIN_MAX_BPS = 500;
const KNOWLEDGE_URL_DESCRIPTION_MAX_CHARS = 2000;
const KNOWLEDGE_URL_SUMMARY_MAX_CHARS = 600;
const KNOWLEDGE_URL_TITLE_MAX_CHARS = 160;
const KNOWLEDGE_URL_STATUSES = ['pending', 'approved', 'rejected', 'archived'];
const KNOWLEDGE_URL_TYPES = ['youtube', 'instagram', 'tiktok', 'blog', 'notice', 'other'];
const KNOWLEDGE_URL_REVIEW_PERMISSIONS = [
  'artist_knowledge:review',
  'artist-knowledge:review',
  'knowledge_url:review',
  'knowledge-url:review',
];
const KNOWLEDGE_URL_MANAGE_PERMISSIONS = [
  'artist_knowledge:manage',
  'artist-knowledge:manage',
  'knowledge_url:manage',
  'knowledge-url:manage',
];
type CreatorRevenueType = 'chat' | 'gift' | 'paid_like' | 'premium_video' | 'fan_letter';
type KnowledgeUrlRow = {
  id: string;
  artistId: string;
  sourceUrl: string;
  sourceDomain: string;
  sourcePlatform: string;
  sourceType: string;
  title: string | null;
  artistDescription: string;
  summary: string;
  visibility: string;
  status: string;
  rejectReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  archivedAt: Date | null;
};

@Injectable()
export class CreatorStudioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getStudio(user: AuthUser) {
    const userId = user.id;
    const operators = await this.prisma.artistOperator.findMany({
      where: {
        userId,
        status: 'active',
        revokedAt: null,
      },
      include: {
        artist: {
          include: {
            publicProfile: true,
            visualProfile: true,
            contentProfile: true,
            artistAssets: {
              where: { asset: { visibility: 'public' } },
              include: { asset: true },
              orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const artistIds = operators.map((operator) => operator.artistId);
    const approvedApplication = artistIds.length
      ? null
      : await this.prisma.debutApplication.findFirst({
          where: {
            userId,
            status: 'approved',
          },
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true,
            applicantName: true,
            displayName: true,
            contactEmail: true,
            participationType: true,
            updatedAt: true,
          },
        });
    const adminAccess =
      artistIds.length || approvedApplication
        ? null
        : await this.prisma.adminUser.findUnique({
            where: { userId },
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
          });
    const hasAdminAccess = adminAccess?.status === 'active';
    const [imageRequestCounts, recentImageRequests] = artistIds.length
      ? await Promise.all([
          this.prisma.creatorImageRequest.groupBy({
            by: ['artistId', 'status'],
            where: { artistId: { in: artistIds } },
            _count: { _all: true },
          }),
          this.prisma.creatorImageRequest.findMany({
            where: { artistId: { in: artistIds } },
            take: 8,
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
            orderBy: { createdAt: 'desc' },
          }),
        ])
      : [[], []];

    const imageRequestSummary = this.imageRequestSummary(imageRequestCounts);
    const activeArtistCount = operators.filter(
      (operator) => operator.artist.status === 'active',
    ).length;
    const needsAttentionCount = imageRequestSummary.total.open;
    const hasAccess =
      artistIds.length > 0 || approvedApplication !== null || hasAdminAccess;
    let accessType: 'personal_creator' | 'studio_operator' | 'admin_operator' | null =
      null;
    if (hasAccess) {
      accessType = hasAdminAccess
        ? 'admin_operator'
        : artistIds.length > 1
          ? 'studio_operator'
          : 'personal_creator';
    }
    const pendingApprovedApplication = approvedApplication
      ? {
          id: approvedApplication.id,
          applicantName: approvedApplication.applicantName,
          displayName: approvedApplication.displayName,
          contactEmail: approvedApplication.contactEmail,
          participationType: approvedApplication.participationType,
          updatedAt: approvedApplication.updatedAt,
          needsArtistOperatorLink: true,
        }
      : null;

    return {
      access: {
        enabled: hasAccess,
        type: accessType,
        status: hasAccess ? 'approved' : 'none',
        reason: artistIds.length
          ? 'active_artist_operator_found'
          : approvedApplication
            ? 'approved_debut_application_found'
            : hasAdminAccess
              ? 'active_admin_operator_found'
            : 'no_active_artist_operator',
        entryUrl: '/creator-studio.html',
        source:
          artistIds.length > 0
            ? 'artist_operator'
            : approvedApplication
              ? 'approved_debut_application'
              : hasAdminAccess
                ? 'admin_operator'
                : 'none',
        approvedApplication: pendingApprovedApplication,
        admin: hasAdminAccess
          ? {
              id: adminAccess.id,
              roleName: adminAccess.role.name,
              permissions: adminAccess.role.permissions,
            }
          : null,
      },
      viewer: {
        userId,
        email: user.email ?? null,
      },
      summary: {
        ownedArtistCount: artistIds.length,
        activeArtistCount,
        needsAttentionCount,
        openImageRequestCount: imageRequestSummary.total.open,
        deliveredImageRequestCount: imageRequestSummary.total.delivered,
        slotLimit: CREATOR_STUDIO_INITIAL_SLOT_LIMIT,
        usedSlots: artistIds.length,
        remainingSlots: Math.max(
          0,
          CREATOR_STUDIO_INITIAL_SLOT_LIMIT - artistIds.length,
        ),
      },
      artists: operators.map((operator) =>
        this.presentOperator(operator, imageRequestSummary.byArtist[operator.artistId]),
      ),
      imageRequests: {
        summary: imageRequestSummary.total,
        recent: recentImageRequests.map((request) => this.presentImageRequest(request)),
      },
      policy: {
        mode:
          artistIds.length > 0
            ? 'creator_studio_bootstrap_v1'
            : approvedApplication
              ? 'approved_application_pending_artist_operator'
              : hasAdminAccess
                ? 'admin_operator_preview'
                : 'creator_studio_no_access',
        emptyState:
          artistIds.length > 0
            ? 'No active artist operator access is connected to this account yet.'
            : approvedApplication
              ? 'Approved debut application exists, but no artist operator is linked yet.'
              : hasAdminAccess
                ? 'Admin access is active, but no artist operator is linked yet.'
                : 'No Creator Studio access is connected to this account yet.',
        canCreateImageRequests: artistIds.length > 0,
        slotPolicy: {
          initialSlotLimit: CREATOR_STUDIO_INITIAL_SLOT_LIMIT,
          usedSlots: artistIds.length,
          remainingSlots: Math.max(
            0,
            CREATOR_STUDIO_INITIAL_SLOT_LIMIT - artistIds.length,
          ),
          canRequestAdditionalArtist: false,
          additionalArtistRequestMode: 'debut_application_or_admin_review',
          paidSlotExpansionStatus: 'planned_not_open',
        },
        imageRequestTypes: [
          'profile_image',
          'content_image',
          'feed_image',
          'shortform_thumbnail',
          'concept_reference',
        ],
        endpoints: {
          createImageRequest: '/api/v1/creator-image-requests',
          imageRequests: '/api/v1/me/creator-image-requests',
          payoutSummary: '/api/v1/me/creator-studio/payout-summary',
          settlementPreview: '/api/v1/me/creator-studio/settlement-preview',
          settlementConversions: '/api/v1/me/creator-studio/settlement-conversions',
          knowledgeUrls: '/api/v1/me/creator-studio/knowledge-urls',
          knowledgeUrlUpdate: '/api/v1/me/creator-studio/knowledge-urls/:sourceId',
          knowledgeUrlApprove:
            '/api/v1/me/creator-studio/knowledge-urls/:sourceId/approve',
          knowledgeUrlReject:
            '/api/v1/me/creator-studio/knowledge-urls/:sourceId/reject',
          knowledgeUrlArchive:
            '/api/v1/me/creator-studio/knowledge-urls/:sourceId/archive',
          uploadIntent: '/api/v1/me/assets/upload-intents',
          confirmUpload: '/api/v1/me/assets/:assetId/confirm-upload',
        },
      },
    };
  }

  async getPayoutSummary(
    userId: string,
    query: CreatorStudioSettlementPreviewQueryDto,
  ) {
    const preview = await this.getSettlementPreview(userId, query);
    const tier = this.payoutSettlementTier(preview.items);
    const grossAmount = preview.totals.creatorShareKrw;
    const taxAmount = this.payoutTaxAmount(grossAmount);
    const netAmount = Decimal.max(0, grossAmount.minus(taxAmount));
    const hidePayoutRow = preview.items.length === 0 || tier === 'internal';
    const fxSnapshot = this.payoutFxSnapshot();
    const shareRate = this.payoutShareRate(preview.policy.settlementRateBps);

    return {
      period: preview.period,
      currency: CREATOR_PAYOUT_CURRENCY,
      fxSnapshot,
      shareRate,
      settlementTier: tier,
      cards: [
        this.payoutCard('grossLumina', {
          amountLumina: preview.totals.grossLumina,
        }),
        this.payoutCard('eligibleLumina', {
          amountLumina: preview.totals.grossLumina,
        }),
        this.payoutCard('grossAmount', {
          amount: grossAmount,
          currency: CREATOR_PAYOUT_CURRENCY,
        }),
        this.payoutCard('taxAmount', {
          amount: taxAmount,
          currency: CREATOR_PAYOUT_CURRENCY,
        }),
        this.payoutCard('netAmount', {
          amount: netAmount,
          currency: CREATOR_PAYOUT_CURRENCY,
        }),
      ],
      totals: {
        grossLumina: this.decimalString(preview.totals.grossLumina),
        eligibleLumina: this.decimalString(preview.totals.grossLumina),
        grossAmount: this.moneyAmount(grossAmount, CREATOR_PAYOUT_CURRENCY),
        taxAmount: this.moneyAmount(taxAmount, CREATOR_PAYOUT_CURRENCY),
        netAmount: this.moneyAmount(netAmount, CREATOR_PAYOUT_CURRENCY),
        currency: CREATOR_PAYOUT_CURRENCY,
        fxSnapshot,
        shareRate,
        settlementTier: tier,
      },
      artists: preview.items.map((item) => {
        const artistTier = this.payoutSettlementTier([item]);
        const artistGrossAmount = item.financials.creatorShareKrw;
        const artistTaxAmount = this.payoutTaxAmount(artistGrossAmount);
        const artistNetAmount = Decimal.max(0, artistGrossAmount.minus(artistTaxAmount));

        return {
          artist: item.artist,
          eventCount: item.eventCount,
          grossLumina: this.decimalString(item.grossLumina),
          eligibleLumina: this.decimalString(item.grossLumina),
          grossAmount: this.moneyAmount(artistGrossAmount, CREATOR_PAYOUT_CURRENCY),
          taxAmount: this.moneyAmount(artistTaxAmount, CREATOR_PAYOUT_CURRENCY),
          netAmount: this.moneyAmount(artistNetAmount, CREATOR_PAYOUT_CURRENCY),
          currency: CREATOR_PAYOUT_CURRENCY,
          shareRate: this.payoutShareRate(item.financials.settlementRateBps),
          settlementTier: artistTier,
          policy: {
            hidePayoutRow: artistTier === 'internal',
            hideReason: artistTier === 'internal' ? 'platform_owned_artist' : null,
          },
          status: item.status,
        };
      }),
      policy: {
        readOnly: true,
        previewOnly: true,
        payoutMutationOpen: false,
        walletMutation: false,
        settlementConfirmationOpen: false,
        hidePayoutRow,
        hideReason:
          preview.items.length === 0
            ? 'no_active_artist_operator'
            : tier === 'internal'
              ? 'platform_owned_artist'
              : null,
        sourceBreakdownVisibleToCreator: false,
        creatorFacingPaidFreeSplit: false,
        internalSourceVisibility: 'backstage_only',
        calculationMode: 'estimated_creator_share_before_final_accounting',
        withholdingTaxRateBps: CREATOR_PAYOUT_WITHHOLDING_TAX_BPS,
        availableSettlementTiers: ['internal', 'staff', 'general', 'special'],
        defaultCurrency: CREATOR_PAYOUT_CURRENCY,
        fxSnapshot,
      },
      notice:
        'Estimated read-only payout summary. Final payout requires admin confirmation, refund/chargeback checks, tax/accounting review, payout account verification, and active creator settlement compliance.',
    };
  }

  async getSettlementPreview(
    userId: string,
    query: CreatorStudioSettlementPreviewQueryDto,
  ) {
    const period = this.settlementPeriod(query.period);
    const policy = this.creatorSettlementPolicy();
    const operators = await this.prisma.artistOperator.findMany({
      where: {
        userId,
        status: 'active',
        revokedAt: null,
      },
      select: {
        id: true,
        role: true,
        permissions: true,
        artistId: true,
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
      orderBy: [{ artist: { sortOrder: 'asc' } }, { createdAt: 'desc' }],
    });
    const artistIds = operators.map((operator) => operator.artistId);
    const revenueByArtist = new Map<string, ReturnType<typeof this.emptyRevenueBucket>>();

    for (const artistId of artistIds) {
      revenueByArtist.set(artistId, this.emptyRevenueBucket());
    }

    const [chatOrders, giftOrders, boostEvents, premiumUnlocks, fanLetters] =
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
                  select: { priceLumina: true },
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
              select: {
                artistId: true,
                totalLumina: true,
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
              select: {
                artistId: true,
                rawAmount: true,
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
                    artistId: true,
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

    const items = operators.map((operator) => {
      const bucket = revenueByArtist.get(operator.artistId) ?? this.emptyRevenueBucket();
      const financials = this.settlementFinancials(bucket.totalLumina, policy);

      return {
        artist: operator.artist,
        operator: {
          id: operator.id,
          role: operator.role,
          permissions: operator.permissions,
        },
        eventCount: bucket.eventCount,
        grossLumina: bucket.totalLumina,
        productBreakdown: bucket.breakdown,
        financials,
        status: bucket.eventCount > 0 ? 'estimated' : 'no_revenue',
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
      period,
      policy,
      items,
      totals,
      policyNotes: {
        payoutUnit: 'operator_user',
        previewOnly: true,
        includedSources: ['chat', 'gift', 'paid_like', 'premium_video', 'fan_letter'],
        excludedSources: ['free_like', 'refunded_fan_letter'],
      },
      notice:
        'Estimated only. Final payout requires admin confirmation, refund/chargeback checks, tax/accounting review, and active creator settlement compliance.',
    };
  }

  async getSettlementConversions(
    userId: string,
    query: CreatorStudioSettlementConversionQueryDto,
  ) {
    await this.assertCreatorStudioAccess(userId);
    const rows = await this.prisma.settlementLuminaConversionRequest.findMany({
      where: this.clean({
        requesterUserId: userId,
        period: query.period,
        status: query.status,
      }),
      take: 50,
      orderBy: { createdAt: 'desc' },
    });

    return {
      items: rows.map((row) => this.presentSettlementConversion(row)),
      count: rows.length,
      policy: this.settlementConversionPolicy(),
    };
  }

  async createSettlementConversion(
    userId: string,
    input: CreateCreatorStudioSettlementConversionDto,
  ) {
    const parsedKey = this.parseSettlementKey(input.settlementKey);
    await this.assertSettlementConversionAccess(userId, parsedKey);

    if (input.idempotencyKey) {
      const existing = await this.prisma.settlementLuminaConversionRequest.findFirst({
        where: {
          requesterUserId: userId,
          idempotencyKey: input.idempotencyKey,
        },
      });

      if (existing) {
        return {
          conversion: this.presentSettlementConversion(existing),
          idempotentReplay: true,
          policy: this.settlementConversionPolicy(),
        };
      }
    }

    const amountKrw = new Decimal(input.amountKrw);
    const policy = this.settlementConversionPolicy();

    if (amountKrw.comparedTo(policy.minAmountKrw) < 0) {
      throw new BadRequestException(
        `amountKrw must be greater than or equal to ${policy.minAmountKrw.toString()}`,
      );
    }

    const preview = await this.getSettlementPreview(userId, { period: parsedKey.period });
    const estimatedAvailableKrw =
      parsedKey.type === 'artist'
        ? preview.items.find((item) => item.artist.id === parsedKey.id)?.financials
            .creatorShareKrw ?? new Decimal(0)
        : preview.totals.creatorShareKrw;
    const reservedKrw = await this.reservedSettlementConversionAmount(
      userId,
      input.settlementKey,
    );
    const remainingKrw = Decimal.max(0, estimatedAvailableKrw.minus(reservedKrw));

    if (amountKrw.comparedTo(remainingKrw) > 0) {
      throw new BadRequestException({
        code: 'SETTLEMENT_CONVERSION_AMOUNT_EXCEEDS_PREVIEW',
        message: 'Requested amount exceeds the current settlement preview balance',
        details: {
          estimatedAvailableKrw: estimatedAvailableKrw.toString(),
          reservedKrw: reservedKrw.toString(),
          remainingKrw: remainingKrw.toString(),
        },
      });
    }

    const requestedLumina = amountKrw.div(policy.unitPriceKrw);
    const row = await this.prisma.settlementLuminaConversionRequest.create({
      data: {
        requesterUserId: userId,
        settlementKey: input.settlementKey,
        settlementType: parsedKey.type,
        period: parsedKey.period,
        targetArtistId: parsedKey.type === 'artist' ? parsedKey.id : null,
        amountKrw,
        requestedLumina,
        note: input.note ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        metadata: this.toJson({
          source: 'creator_studio',
          previewOnly: true,
          unitPriceKrw: policy.unitPriceKrw.toString(),
          estimatedAvailableKrw: estimatedAvailableKrw.toString(),
          reservedKrw: reservedKrw.toString(),
          remainingKrwBeforeRequest: remainingKrw.toString(),
          walletCredit: 'admin_approval_required',
        }),
      },
    });

    return {
      conversion: this.presentSettlementConversion(row),
      idempotentReplay: false,
      policy,
      notice:
        'Request received only. Lumina is credited after admin/accounting approval; no wallet balance changed yet.',
    };
  }

  async getKnowledgeUrls(
    userId: string,
    query: CreatorStudioKnowledgeUrlQueryDto,
  ) {
    const artistIds = await this.creatorStudioArtistIds(userId);
    const requestedArtistId = query.artistId ?? null;
    const status = this.optionalKnowledgeUrlStatus(query.status ?? null);

    if (requestedArtistId) {
      this.assertUuid(requestedArtistId, 'artistId');
      if (!artistIds.includes(requestedArtistId)) {
        throw new ForbiddenException('Artist operator access is required');
      }
    }

    const rows = artistIds.length
      ? await this.prisma.artistKnowledgeSource.findMany({
          where: this.clean({
            artistId: requestedArtistId ?? { in: artistIds },
            status,
          }),
          take: 100,
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        })
      : [];

    return {
      items: rows.map((row) => this.presentKnowledgeUrl(row)),
      count: rows.length,
      policy: this.knowledgeUrlPolicy(),
    };
  }

  async createKnowledgeUrl(
    userId: string,
    input: CreateCreatorStudioKnowledgeUrlDto,
  ) {
    const artistId = this.requiredUuid(input.artistId, 'artistId');
    await this.assertArtistKnowledgeAccess(userId, artistId, 'manage');
    const url = this.normalizeKnowledgeUrl(input.url);
    const description = this.requiredText(
      input.description,
      'description',
      KNOWLEDGE_URL_DESCRIPTION_MAX_CHARS,
    );
    const sourceType = this.normalizeKnowledgeUrlType(input.type);
    const sourcePlatform = this.inferKnowledgeUrlPlatform(url, sourceType);
    const visibility = input.allowChatRef === false ? 'private' : 'chat_reference';
    const existing = await this.prisma.artistKnowledgeSource.findFirst({
      where: { artistId, sourceUrl: url },
    });

    if (existing) {
      return {
        item: this.presentKnowledgeUrl(existing),
        idempotentReplay: true,
        policy: this.knowledgeUrlPolicy(),
      };
    }

    const row = await this.prisma.artistKnowledgeSource.create({
      data: {
        artistId,
        sourceUrl: url,
        sourceDomain: new URL(url).hostname.toLowerCase(),
        sourcePlatform,
        sourceType,
        title: this.optionalText(input.title, KNOWLEDGE_URL_TITLE_MAX_CHARS),
        artistDescription: description,
        summary: this.requiredText(
          input.summary ?? description,
          'summary',
          KNOWLEDGE_URL_SUMMARY_MAX_CHARS,
        ),
        visibility,
        status: 'pending',
        createdByUserId: userId,
        updatedByUserId: userId,
      },
    });

    return {
      item: this.presentKnowledgeUrl(row),
      idempotentReplay: false,
      policy: this.knowledgeUrlPolicy(),
      notice:
        'URL material was received as pending. It is not used by character chat until approved.',
    };
  }

  async updateKnowledgeUrl(
    userId: string,
    sourceId: string,
    input: UpdateCreatorStudioKnowledgeUrlDto,
  ) {
    this.assertUuid(sourceId, 'sourceId');
    const before = await this.getKnowledgeUrlForMutation(sourceId);
    await this.assertArtistKnowledgeAccess(userId, before.artistId, 'manage');

    if (!['pending', 'rejected'].includes(before.status)) {
      throw new BadRequestException({
        code: 'ARTIST_KNOWLEDGE_SOURCE_LOCKED',
        message: 'Only pending or rejected knowledge URLs can be edited',
      });
    }

    const nextUrl =
      input.url === undefined || input.url === null
        ? before.sourceUrl
        : this.normalizeKnowledgeUrl(input.url);

    if (nextUrl !== before.sourceUrl) {
      const duplicate = await this.prisma.artistKnowledgeSource.findFirst({
        where: {
          artistId: before.artistId,
          sourceUrl: nextUrl,
          id: { not: before.id },
        },
        select: { id: true },
      });

      if (duplicate) {
        throw new BadRequestException({
          code: 'ARTIST_KNOWLEDGE_SOURCE_DUPLICATE_URL',
          message: 'A knowledge URL with the same artist and URL already exists',
        });
      }
    }

    const sourceType =
      input.type === undefined ? before.sourceType : this.normalizeKnowledgeUrlType(input.type);
    const row = await this.prisma.artistKnowledgeSource.update({
      where: { id: before.id },
      data: this.clean({
        sourceUrl: nextUrl,
        sourceDomain: new URL(nextUrl).hostname.toLowerCase(),
        sourcePlatform: this.inferKnowledgeUrlPlatform(nextUrl, sourceType),
        sourceType,
        title:
          input.title === undefined
            ? undefined
            : this.optionalText(input.title, KNOWLEDGE_URL_TITLE_MAX_CHARS),
        artistDescription:
          input.description === undefined
            ? undefined
            : this.requiredText(
                input.description,
                'description',
                KNOWLEDGE_URL_DESCRIPTION_MAX_CHARS,
              ),
        summary:
          input.summary === undefined
            ? undefined
            : this.requiredText(input.summary, 'summary', KNOWLEDGE_URL_SUMMARY_MAX_CHARS),
        visibility:
          input.allowChatRef === undefined
            ? undefined
            : input.allowChatRef === false
              ? 'private'
              : 'chat_reference',
        status: 'pending',
        rejectReason: null,
        rejectedAt: null,
        reviewedByUserId: null,
        updatedByUserId: userId,
      }),
    });

    return {
      item: this.presentKnowledgeUrl(row),
      idempotentReplay: false,
      policy: this.knowledgeUrlPolicy(),
      notice: 'Knowledge URL was updated and returned to pending review.',
    };
  }

  async approveKnowledgeUrl(userId: string, sourceId: string) {
    this.assertUuid(sourceId, 'sourceId');
    const before = await this.getKnowledgeUrlForMutation(sourceId);
    await this.assertArtistKnowledgeAccess(userId, before.artistId, 'review');

    if (before.status === 'approved') {
      return {
        item: this.presentKnowledgeUrl(before),
        idempotentReplay: true,
        policy: this.knowledgeUrlPolicy(),
      };
    }

    if (before.status === 'archived') {
      throw new BadRequestException({
        code: 'ARTIST_KNOWLEDGE_SOURCE_ARCHIVED',
        message: 'Archived knowledge URLs cannot be approved',
      });
    }

    const row = await this.prisma.artistKnowledgeSource.update({
      where: { id: before.id },
      data: {
        status: 'approved',
        visibility: before.visibility === 'private' ? 'private' : 'chat_reference',
        approvedAt: new Date(),
        rejectedAt: null,
        archivedAt: null,
        rejectReason: null,
        reviewedByUserId: userId,
        updatedByUserId: userId,
      },
    });

    return {
      item: this.presentKnowledgeUrl(row),
      idempotentReplay: false,
      policy: this.knowledgeUrlPolicy(),
    };
  }

  async rejectKnowledgeUrl(
    userId: string,
    sourceId: string,
    input: ReviewCreatorStudioKnowledgeUrlDto,
  ) {
    this.assertUuid(sourceId, 'sourceId');
    const before = await this.getKnowledgeUrlForMutation(sourceId);
    await this.assertArtistKnowledgeAccess(userId, before.artistId, 'review');

    if (before.status === 'rejected') {
      return {
        item: this.presentKnowledgeUrl(before),
        idempotentReplay: true,
        policy: this.knowledgeUrlPolicy(),
      };
    }

    if (before.status === 'archived') {
      throw new BadRequestException({
        code: 'ARTIST_KNOWLEDGE_SOURCE_ARCHIVED',
        message: 'Archived knowledge URLs cannot be rejected',
      });
    }

    const row = await this.prisma.artistKnowledgeSource.update({
      where: { id: before.id },
      data: {
        status: 'rejected',
        approvedAt: null,
        rejectedAt: new Date(),
        rejectReason: this.optionalText(input.reason, 500),
        reviewedByUserId: userId,
        updatedByUserId: userId,
      },
    });

    return {
      item: this.presentKnowledgeUrl(row),
      idempotentReplay: false,
      policy: this.knowledgeUrlPolicy(),
    };
  }

  async archiveKnowledgeUrl(userId: string, sourceId: string) {
    this.assertUuid(sourceId, 'sourceId');
    const before = await this.getKnowledgeUrlForMutation(sourceId);
    await this.assertArtistKnowledgeAccess(userId, before.artistId, 'manage');

    if (before.status === 'archived') {
      return {
        item: this.presentKnowledgeUrl(before),
        idempotentReplay: true,
        policy: this.knowledgeUrlPolicy(),
      };
    }

    const row = await this.prisma.artistKnowledgeSource.update({
      where: { id: before.id },
      data: {
        status: 'archived',
        archivedAt: new Date(),
        approvedAt: null,
        rejectedAt: null,
        updatedByUserId: userId,
      },
    });

    return {
      item: this.presentKnowledgeUrl(row),
      idempotentReplay: false,
      policy: this.knowledgeUrlPolicy(),
    };
  }

  async updateArtistProfile(
    user: AuthUser,
    artistId: string,
    input: UpdateCreatorStudioArtistProfileDto,
  ) {
    this.assertUuid(artistId, 'artistId');
    await this.assertArtistOperator(user.id, artistId);

    if (
      input.publicProfile === undefined &&
      input.visualProfile === undefined &&
      input.contentProfile === undefined
    ) {
      throw new BadRequestException('At least one profile section is required');
    }

    const before = await this.prisma.artist.findUnique({
      where: { id: artistId },
      include: {
        publicProfile: true,
        visualProfile: true,
        contentProfile: true,
        artistAssets: {
          where: { asset: { visibility: 'public' } },
          include: { asset: true },
          orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
        },
      },
    });

    if (!before) {
      throw new NotFoundException('Artist not found');
    }

    await this.prisma.$transaction(async (tx) => {
      if (input.publicProfile !== undefined) {
        const publicMetadata =
          input.publicProfile.publicMetadata === undefined
            ? undefined
            : this.mergeMetadata(before.publicProfile?.publicMetadata, {
                ...input.publicProfile.publicMetadata,
                creatorStudioUpdatedByUserId: user.id,
                creatorStudioUpdatedAt: new Date().toISOString(),
              });

        await tx.artistPublicProfile.upsert({
          where: { artistId },
          create: {
            artistId,
            tagline: input.publicProfile.tagline,
            summary: input.publicProfile.summary,
            personalityKeywords: input.publicProfile.personalityKeywords ?? [],
            publicStory: input.publicProfile.publicStory,
            publicMetadata: publicMetadata ?? Prisma.JsonNull,
          },
          update: this.clean({
            tagline: input.publicProfile.tagline,
            summary: input.publicProfile.summary,
            personalityKeywords: input.publicProfile.personalityKeywords,
            publicStory: input.publicProfile.publicStory,
            publicMetadata,
            updatedAt: new Date(),
          }),
        });
      }

      if (input.visualProfile !== undefined) {
        await tx.artistVisualProfile.upsert({
          where: { artistId },
          create: {
            artistId,
            visualKeywords: input.visualProfile.visualKeywords ?? [],
            styleNotes: input.visualProfile.styleNotes,
            primaryColor: input.visualProfile.primaryColor,
            secondaryColor: input.visualProfile.secondaryColor,
          },
          update: this.clean({
            visualKeywords: input.visualProfile.visualKeywords,
            styleNotes: input.visualProfile.styleNotes,
            primaryColor: input.visualProfile.primaryColor,
            secondaryColor: input.visualProfile.secondaryColor,
            updatedAt: new Date(),
          }),
        });
      }

      if (input.contentProfile !== undefined) {
        await tx.artistContentProfile.upsert({
          where: { artistId },
          create: {
            artistId,
            contentTone: input.contentProfile.contentTone,
            allowedTopics: input.contentProfile.allowedTopics ?? [],
            blockedTopics: input.contentProfile.blockedTopics ?? [],
            operatingNotes: input.contentProfile.operatingNotes,
          },
          update: this.clean({
            contentTone: input.contentProfile.contentTone,
            allowedTopics: input.contentProfile.allowedTopics,
            blockedTopics: input.contentProfile.blockedTopics,
            operatingNotes: input.contentProfile.operatingNotes,
            updatedAt: new Date(),
          }),
        });
      }

      await tx.artist.update({
        where: { id: artistId },
        data: { updatedAt: new Date() },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: user.id,
          actorType: 'creator',
          action: 'creator_studio.artist_profile.update',
          targetType: 'artist',
          targetId: artistId,
          beforeData: this.toJson({
            publicProfile: before.publicProfile,
            visualProfile: before.visualProfile,
            contentProfile: before.contentProfile,
          }),
          afterData: this.toJson(input),
          metadata: Prisma.JsonNull,
        },
      });
    });

    const updated = await this.prisma.artistOperator.findFirstOrThrow({
      where: {
        userId: user.id,
        artistId,
        status: 'active',
        revokedAt: null,
      },
      include: {
        artist: {
          include: {
            publicProfile: true,
            visualProfile: true,
            contentProfile: true,
            artistAssets: {
              where: { asset: { visibility: 'public' } },
              include: { asset: true },
              orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
            },
          },
        },
      },
    });

    return {
      artist: this.presentOperator(updated).artist,
      message: 'Creator studio artist profile updated',
    };
  }

  private presentOperator(
    operator: Prisma.ArtistOperatorGetPayload<{
      include: {
        artist: {
          include: {
            publicProfile: true;
            visualProfile: true;
            contentProfile: true;
            artistAssets: { include: { asset: true } };
          };
        };
      };
    }>,
    imageRequests?: {
      total: number;
      open: number;
      delivered: number;
      rejected: number;
      byStatus: Record<string, number>;
    },
  ) {
    const assets = operator.artist.artistAssets
      .filter((artistAsset) => this.isPublicReadyAsset(artistAsset.asset.metadata))
      .map((artistAsset) => ({
        id: artistAsset.asset.id,
        usageType: artistAsset.usageType,
        assetType: artistAsset.asset.assetType,
        url: this.assetUrl(artistAsset.asset.storageKey),
        mimeType: artistAsset.asset.mimeType,
        width: artistAsset.asset.width,
        height: artistAsset.asset.height,
        isPrimary: artistAsset.isPrimary,
        sortOrder: artistAsset.sortOrder,
      }));
    const coverImage = assets.find((asset) => asset.usageType === 'cover') ?? null;
    const thumbnailImage = assets.find((asset) => asset.usageType === 'thumb') ?? coverImage;

    return {
      operator: {
        id: operator.id,
        role: operator.role,
        permissions: operator.permissions,
        status: operator.status,
        createdAt: operator.createdAt,
      },
      artist: {
        id: operator.artist.id,
        slug: operator.artist.slug,
        displayName: operator.artist.displayName,
        status: operator.artist.status,
        sortOrder: operator.artist.sortOrder,
        launchedAt: operator.artist.launchedAt,
        publicProfile: operator.artist.publicProfile,
        visualProfile: operator.artist.visualProfile,
        contentProfile: operator.artist.contentProfile,
        coverImage,
        thumbnailImage,
        assets,
      },
      imageRequests:
        imageRequests ?? {
          total: 0,
          open: 0,
          delivered: 0,
          rejected: 0,
          byStatus: {},
        },
    };
  }

  private presentImageRequest(
    request: Prisma.CreatorImageRequestGetPayload<{
      include: {
        artist: {
          select: {
            id: true;
            slug: true;
            displayName: true;
            status: true;
          };
        };
      };
    }>,
  ) {
    return {
      ...request,
      referenceAssetIds: Array.isArray(request.referenceAssetIds)
        ? request.referenceAssetIds
        : [],
      resultAssetIds: Array.isArray(request.resultAssetIds) ? request.resultAssetIds : [],
    };
  }

  private imageRequestSummary(
    counts: Array<{
      artistId: string;
      status: string;
      _count: { _all: number };
    }>,
  ) {
    const total = {
      total: 0,
      open: 0,
      delivered: 0,
      rejected: 0,
      byStatus: {} as Record<string, number>,
    };
    const byArtist: Record<string, typeof total> = {};

    for (const row of counts) {
      const count = row._count._all;
      const artistSummary =
        byArtist[row.artistId] ??
        (byArtist[row.artistId] = {
          total: 0,
          open: 0,
          delivered: 0,
          rejected: 0,
          byStatus: {},
        });

      for (const summary of [total, artistSummary]) {
        summary.total += count;
        summary.byStatus[row.status] = (summary.byStatus[row.status] ?? 0) + count;

        if (OPEN_IMAGE_REQUEST_STATUSES.includes(row.status)) {
          summary.open += count;
        }

        if (row.status === 'delivered') {
          summary.delivered += count;
        }

        if (row.status === 'rejected') {
          summary.rejected += count;
        }
      }
    }

    return { total, byArtist };
  }

  private isPublicReadyAsset(metadata: unknown) {
    const record = this.recordOrEmpty(metadata);
    const uploadIntent = this.recordOrEmpty(record.uploadIntent);
    const lifecycle = this.recordOrEmpty(record.lifecycle);

    return (
      uploadIntent.status !== 'pending_upload' &&
      lifecycle.status !== 'archived'
    );
  }

  private recordOrEmpty(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private assetUrl(storageKey: string) {
    return buildPublicAssetUrl(this.configService, storageKey, storageKey);
  }

  private settlementPeriod(period?: string) {
    const now = new Date();
    const label =
      period ??
      `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const [year, month] = label.split('-').map(Number);

    if (!year || !month || month < 1 || month > 12) {
      throw new BadRequestException('period must be YYYY-MM');
    }

    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));

    return { label, start, end };
  }

  private creatorSettlementPolicy() {
    return {
      unitPriceKrw: new Decimal(10),
      vatRateBps: 1000,
      pgFeeRateBps: 250,
      pgFeeVatRateBps: 1000,
      aiCostRateBps: 0,
      directCostRateBps: 0,
      settlementRateBps: 8000,
      platformMinimumMarginBps: 1000,
      status: 'preview_only',
    };
  }

  private settlementConversionPolicy() {
    return {
      status: 'request_only',
      unitPriceKrw: new Decimal(10),
      minAmountKrw: new Decimal(1000),
      statuses: ['requested', 'approved', 'rejected', 'credited', 'cancelled'],
      walletCreditTiming: 'admin_approval_required',
      settlementDeductionTiming: 'credited_status_only',
      userFacingName: '정산금으로 충전',
      forbiddenTerms: ['환전'],
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

  private emptyProductBreakdown(type: CreatorRevenueType) {
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
    type: CreatorRevenueType,
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
    policy: ReturnType<typeof this.creatorSettlementPolicy>,
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
      netRevenueKrw,
      settlementRateBps: policy.settlementRateBps,
      creatorShareKrw,
      platformShareKrw,
      riskReserveKrw,
    };
  }

  private payoutCard(
    id: 'grossLumina' | 'eligibleLumina' | 'grossAmount' | 'taxAmount' | 'netAmount',
    value:
      | { amountLumina: Decimal }
      | { amount: Decimal; currency: typeof CREATOR_PAYOUT_CURRENCY },
  ) {
    const labelKey = `creatorStudio.payoutSummary.${id}.label`;
    const descriptionKey = `creatorStudio.payoutSummary.${id}.description`;

    if ('amountLumina' in value) {
      return {
        id,
        labelKey,
        descriptionKey,
        value: this.decimalString(value.amountLumina),
        unit: 'LUMINA',
        amountLumina: this.decimalString(value.amountLumina),
        amount: null,
        currency: null,
      };
    }

    return {
      id,
      labelKey,
      descriptionKey,
      value: this.moneyString(value.amount),
      unit: value.currency,
      amountLumina: null,
      amount: this.moneyAmount(value.amount, value.currency),
      currency: value.currency,
    };
  }

  private payoutSettlementTier(
    items: Array<{
      operator: { role: string; permissions: string[] };
    }>,
  ): 'internal' | 'staff' | 'general' | 'special' {
    if (items.some((item) => item.operator.permissions.includes('settlement:special'))) {
      return 'special';
    }

    if (
      items.some(
        (item) =>
          item.operator.role === 'staff' ||
          item.operator.permissions.includes('settlement:staff'),
      )
    ) {
      return 'staff';
    }

    if (
      items.length > 0 &&
      items.every(
        (item) =>
          item.operator.role === 'internal' ||
          item.operator.permissions.includes('settlement:internal'),
      )
    ) {
      return 'internal';
    }

    return 'general';
  }

  private payoutShareRate(settlementRateBps: number) {
    return {
      bps: settlementRateBps,
      percent: this.decimalString(new Decimal(settlementRateBps).div(100)),
    };
  }

  private payoutTaxAmount(amount: Decimal) {
    return amount.mul(CREATOR_PAYOUT_WITHHOLDING_TAX_BPS).div(10_000);
  }

  private payoutFxSnapshot() {
    return {
      baseCurrency: CREATOR_PAYOUT_CURRENCY,
      settlementCurrency: CREATOR_PAYOUT_CURRENCY,
      snapshotStatus: 'krw_base_no_fx',
      weeklyRefresh: true,
      rateSource: 'weekly_reference_rate_placeholder',
      baseRate: '1',
      appliedRate: '1',
      safeMarginRangeBps: {
        min: CREATOR_PAYOUT_FX_SAFE_MARGIN_MIN_BPS,
        max: CREATOR_PAYOUT_FX_SAFE_MARGIN_MAX_BPS,
      },
      appliedSafeMarginBps: 0,
      capturedAt: null,
      nextRefreshAt: null,
    };
  }

  private moneyAmount(amount: Decimal, currency: typeof CREATOR_PAYOUT_CURRENCY) {
    return {
      amount: this.moneyString(amount),
      currency,
    };
  }

  private moneyString(amount: Decimal) {
    return amount.toDecimalPlaces(2).toFixed(2);
  }

  private decimalString(amount: Decimal) {
    return amount.toDecimalPlaces(2).toString();
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

  private parseSettlementKey(settlementKey: string) {
    const [type, id, period] = settlementKey.split(':');

    if (
      !['artist', 'partner'].includes(type) ||
      !id ||
      !UUID_PATTERN.test(id) ||
      !/^\d{4}-\d{2}$/.test(period)
    ) {
      throw new BadRequestException(
        'settlementKey must be artist:<artistId>:YYYY-MM or partner:<userId>:YYYY-MM',
      );
    }

    return {
      type: type as 'artist' | 'partner',
      id,
      period,
    };
  }

  private async assertSettlementConversionAccess(
    userId: string,
    parsedKey: ReturnType<typeof this.parseSettlementKey>,
  ) {
    if (parsedKey.type === 'partner') {
      if (parsedKey.id !== userId) {
        throw new ForbiddenException('Creator settlement conversion access is required');
      }

      await this.assertCreatorStudioAccess(userId);
      return;
    }

    await this.assertArtistOperator(userId, parsedKey.id);
  }

  private async assertCreatorStudioAccess(userId: string) {
    const operator = await this.prisma.artistOperator.findFirst({
      where: {
        userId,
        status: 'active',
        revokedAt: null,
      },
      select: { id: true },
    });

    if (!operator) {
      throw new ForbiddenException('Creator Studio access is required');
    }
  }

  private async reservedSettlementConversionAmount(
    userId: string,
    settlementKey: string,
  ) {
    const aggregate = await this.prisma.settlementLuminaConversionRequest.aggregate({
      where: {
        requesterUserId: userId,
        settlementKey,
        status: { in: ['requested', 'approved', 'credited'] },
      },
      _sum: { amountKrw: true },
    });

    return aggregate._sum.amountKrw ?? new Decimal(0);
  }

  private presentSettlementConversion(row: {
    id: string;
    requesterUserId: string;
    settlementKey: string;
    settlementType: string;
    period: string;
    targetArtistId: string | null;
    amountKrw: Decimal;
    requestedLumina: Decimal;
    status: string;
    note: string | null;
    adminNote: string | null;
    walletLedgerId: string | null;
    processedByUserId: string | null;
    processedAt: Date | null;
    idempotencyKey: string | null;
    metadata: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
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
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      metadata: this.recordOrEmpty(row.metadata),
    };
  }

  private async creatorStudioArtistIds(userId: string) {
    const operators = await this.prisma.artistOperator.findMany({
      where: {
        userId,
        status: 'active',
        revokedAt: null,
      },
      select: { artistId: true },
    });

    if (!operators.length) {
      throw new ForbiddenException('Creator Studio artist operator access is required');
    }

    return operators.map((operator) => operator.artistId);
  }

  private async getKnowledgeUrlForMutation(sourceId: string) {
    const row = await this.prisma.artistKnowledgeSource.findUnique({
      where: { id: sourceId },
    });

    if (!row) {
      throw new NotFoundException('Knowledge URL not found');
    }

    return row;
  }

  private async assertArtistKnowledgeAccess(
    userId: string,
    artistId: string,
    mode: 'manage' | 'review',
  ) {
    const operator = await this.prisma.artistOperator.findFirst({
      where: {
        userId,
        artistId,
        status: 'active',
        revokedAt: null,
      },
      select: {
        id: true,
        role: true,
        permissions: true,
      },
    });

    if (!operator) {
      throw new ForbiddenException('Artist operator access is required');
    }

    if (mode === 'manage') {
      return operator;
    }

    const canReview =
      ['owner', 'admin', 'staff', 'internal'].includes(operator.role) ||
      operator.permissions.some((permission) =>
        KNOWLEDGE_URL_REVIEW_PERMISSIONS.includes(permission),
      ) ||
      operator.permissions.some((permission) =>
        KNOWLEDGE_URL_MANAGE_PERMISSIONS.includes(permission),
      );

    if (!canReview) {
      throw new ForbiddenException('Artist knowledge review permission is required');
    }

    return operator;
  }

  private requiredUuid(value: string | null | undefined, field: string) {
    const normalized = this.optionalText(value, 80);

    if (!normalized) {
      throw new BadRequestException(`${field} is required`);
    }

    this.assertUuid(normalized, field);
    return normalized;
  }

  private requiredText(value: string | null | undefined, field: string, max: number) {
    const normalized = this.optionalText(value, max);

    if (!normalized) {
      throw new BadRequestException(`${field} is required`);
    }

    return normalized;
  }

  private optionalText(value: string | null | undefined, max: number) {
    if (value === null || value === undefined) {
      return null;
    }

    const normalized = String(value).trim().replace(/\s+/g, ' ');

    if (!normalized) {
      return null;
    }

    return normalized.length > max ? normalized.slice(0, max) : normalized;
  }

  private normalizeKnowledgeUrl(value: string | null | undefined) {
    const raw = this.requiredText(value, 'url', 2000);
    let parsed: URL;

    try {
      parsed = new URL(raw);
    } catch {
      throw new BadRequestException({
        code: 'ARTIST_KNOWLEDGE_SOURCE_URL_INVALID',
        message: 'url must be a valid HTTPS URL',
      });
    }

    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new BadRequestException({
        code: 'ARTIST_KNOWLEDGE_SOURCE_URL_INVALID',
        message: 'url must be a valid HTTPS URL without credentials',
      });
    }

    const hostname = parsed.hostname.toLowerCase();
    if (!hostname || this.isBlockedKnowledgeUrlHost(hostname)) {
      throw new BadRequestException({
        code: 'ARTIST_KNOWLEDGE_SOURCE_URL_HOST_BLOCKED',
        message: 'url host is not allowed for artist knowledge sources',
      });
    }

    parsed.hash = '';
    return parsed.toString();
  }

  private isBlockedKnowledgeUrlHost(hostname: string) {
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      return true;
    }

    const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4) {
      return hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd');
    }

    const octets = ipv4.slice(1).map((part) => Number(part));
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
      return true;
    }

    const [first, second] = octets;
    return (
      first === 10 ||
      first === 127 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254)
    );
  }

  private normalizeKnowledgeUrlType(value: string | null | undefined) {
    const normalized = this.optionalText(value, 40)?.toLowerCase() ?? 'other';

    return KNOWLEDGE_URL_TYPES.includes(normalized) ? normalized : 'other';
  }

  private inferKnowledgeUrlPlatform(url: string, sourceType: string) {
    if (sourceType !== 'other') {
      return sourceType;
    }

    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      return 'youtube';
    }
    if (hostname.includes('instagram.com')) {
      return 'instagram';
    }
    if (hostname.includes('tiktok.com')) {
      return 'tiktok';
    }
    if (hostname.includes('blog.') || hostname.includes('tistory.com')) {
      return 'blog';
    }

    return 'other';
  }

  private optionalKnowledgeUrlStatus(value: string | null) {
    if (!value) {
      return undefined;
    }

    if (!KNOWLEDGE_URL_STATUSES.includes(value)) {
      throw new BadRequestException('status must be pending, approved, rejected, or archived');
    }

    return value;
  }

  private presentKnowledgeUrl(row: KnowledgeUrlRow) {
    const allowChatRef = ['chat_reference', 'public'].includes(row.visibility);
    const chatReferenceEligible =
      row.status === 'approved' && allowChatRef && row.approvedAt !== null;

    return {
      id: row.id,
      artistId: row.artistId,
      type: row.sourceType,
      platform: row.sourcePlatform,
      url: row.sourceUrl,
      sourceDomain: row.sourceDomain,
      title: row.title,
      description: row.artistDescription,
      summary: row.summary,
      allowChatRef,
      visibility: row.visibility,
      status: row.status,
      rejectReason: row.rejectReason,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      approvedAt: row.approvedAt,
      rejectedAt: row.rejectedAt,
      archivedAt: row.archivedAt,
      chatReference: {
        eligible: chatReferenceEligible,
        approvedOnly: true,
        runtimeFields: ['domain', 'platform', 'title', 'summary'],
        fullUrlInjected: false,
        rawSourceInjected: false,
      },
    };
  }

  private knowledgeUrlPolicy() {
    return {
      contractVersion: '2026-05-22.artist-knowledge-sources.v1',
      storage: {
        table: 'artist_knowledge_sources',
        uniqueKey: ['artistId', 'url'],
        noAutoCrawling: true,
        noExternalAccountRequired: true,
        secretOrTokenRequired: false,
      },
      statuses: KNOWLEDGE_URL_STATUSES,
      transitions: {
        create: { from: null, to: 'pending', actor: 'active_artist_operator' },
        update: { from: ['pending', 'rejected'], to: 'pending' },
        approve: { from: ['pending', 'rejected'], to: 'approved' },
        reject: { from: ['pending', 'approved'], to: 'rejected' },
        archive: { from: ['pending', 'approved', 'rejected'], to: 'archived' },
      },
      permissions: {
        list: 'active_artist_operator',
        create: 'active_artist_operator',
        update: 'active_artist_operator_pending_or_rejected_only',
        approve: 'owner_or_artist_knowledge_review_permission',
        reject: 'owner_or_artist_knowledge_review_permission',
        archive: 'active_artist_operator',
      },
      chatReference: {
        acceptedStatuses: ['approved'],
        excludedStatuses: ['pending', 'rejected', 'archived'],
        requiredVisibility: ['chat_reference', 'public'],
        providerRuntimeFields: ['domain', 'platform', 'title', 'summary'],
        fullUrlInjected: false,
        rawSourceInjected: false,
        maxSnippetsPerGeneration: 3,
        promptInjectionTreatment: 'facts_only_never_instruction',
      },
    };
  }

  private assertUuid(value: string, field: string) {
    if (!UUID_PATTERN.test(value)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
  }

  private mergeMetadata(current: Prisma.JsonValue | undefined, patch: Record<string, unknown>) {
    const base =
      current && typeof current === 'object' && !Array.isArray(current)
        ? (current as Record<string, unknown>)
        : {};

    return this.toJson({ ...base, ...patch });
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

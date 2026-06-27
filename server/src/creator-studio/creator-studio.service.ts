import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AuthUser } from '../auth/auth.types';
import {
  ARTIST_URL_KNOWLEDGE_CONTRACT,
  ARTIST_URL_KNOWLEDGE_STATUSES,
  artistKnowledgeSafetyStatusFromMetadata,
  buildArtistKnowledgeAuditPayload,
  isArtistKnowledgeSourceType,
  normalizeArtistKnowledgeTitle,
  normalizeArtistKnowledgeSummary,
} from '../chat/artist-url-knowledge-contract';
import { buildPublicAssetUrl } from '../common/asset-url';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCreatorStudioKnowledgeUrlDto,
  CreateCreatorStudioSettlementConversionDto,
  CreatorStudioKnowledgeUrlQueryDto,
  CreatorStudioSettlementConversionQueryDto,
  CreatorStudioSettlementPreviewQueryDto,
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
type CreatorRevenueType = 'chat' | 'gift' | 'paid_like' | 'premium_video' | 'fan_letter';

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

  async getKnowledgeUrls(
    userId: string,
    query: CreatorStudioKnowledgeUrlQueryDto,
  ) {
    const artistIds = await this.creatorStudioKnowledgeArtistIds(
      userId,
      query.artistId ?? undefined,
    );

    if (!artistIds.length) {
      return {
        items: [],
        contract: ARTIST_URL_KNOWLEDGE_CONTRACT.apiContracts.creatorList,
      };
    }

    const rows = await this.prisma.artistKnowledgeUrl.findMany({
      where: {
        artistId: { in: artistIds },
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 50,
    });

    return {
      items: rows.map((row) => this.presentKnowledgeUrl(row)),
      contract: ARTIST_URL_KNOWLEDGE_CONTRACT.apiContracts.creatorList,
    };
  }

  async createKnowledgeUrl(
    user: AuthUser,
    input: CreateCreatorStudioKnowledgeUrlDto,
  ) {
    await this.assertArtistKnowledgeOperator(user.id, input.artistId);

    const sourceType = this.knowledgeSourceType(input.type);
    const canonicalUrl = this.canonicalKnowledgeUrl(input.url);
    const summary = normalizeArtistKnowledgeSummary(input.description);

    if (!summary) {
      this.throwArtistKnowledgeBadRequest(
        'ARTIST_KNOWLEDGE_URL_DESCRIPTION_REQUIRED',
        'artistKnowledgeUrl.error.descriptionRequired',
        '자료 설명을 입력해 주세요.',
      );
    }

    await this.assertKnowledgeUrlNotDuplicated(input.artistId, canonicalUrl);

    const row = await this.prisma.artistKnowledgeUrl.create({
      data: {
        artistId: input.artistId,
        submittedByUserId: user.id,
        status: 'pending',
        sourceType,
        url: input.url.trim(),
        canonicalUrl,
        artistDescription: input.description.trim(),
        summary,
        allowChatReference: input.allowChatRef ?? true,
        metadata: this.toJson({
          contractVersion: ARTIST_URL_KNOWLEDGE_CONTRACT.version,
          summarySource: 'artist_description_initial',
          externalFetchPerformed: false,
          rawPageBodyStored: false,
        }),
      },
    });

    await this.recordArtistKnowledgeAudit(
      user,
      'creator_studio.artist_knowledge_url.create',
      null,
      row,
    );

    return {
      item: this.presentKnowledgeUrl(row),
      contract: ARTIST_URL_KNOWLEDGE_CONTRACT.apiContracts.creatorCreate,
    };
  }

  async updateKnowledgeUrl(
    user: AuthUser,
    knowledgeUrlId: string,
    input: UpdateCreatorStudioKnowledgeUrlDto,
  ) {
    this.assertArtistKnowledgeUuid(knowledgeUrlId, 'knowledgeUrlId');
    const existing = await this.prisma.artistKnowledgeUrl.findUnique({
      where: { id: knowledgeUrlId },
    });

    if (!existing) {
      this.throwArtistKnowledgeNotFound();
    }

    await this.assertArtistKnowledgeOperator(user.id, existing.artistId);

    if (existing.status === 'archived') {
      throw new ConflictException({
        code: 'ARTIST_KNOWLEDGE_URL_ARCHIVED',
        message: '보관된 자료 URL은 수정할 수 없습니다.',
        messageKey: 'artistKnowledgeUrl.error.archived',
      });
    }

    const hasPatch =
      input.type !== undefined ||
      input.url !== undefined ||
      input.description !== undefined ||
      input.allowChatRef !== undefined;

    if (!hasPatch) {
      this.throwArtistKnowledgeBadRequest(
        'ARTIST_KNOWLEDGE_URL_PATCH_REQUIRED',
        'artistKnowledgeUrl.error.patchRequired',
        '수정할 항목을 하나 이상 입력해 주세요.',
      );
    }

    const canonicalUrl =
      input.url !== undefined && input.url !== null
        ? this.canonicalKnowledgeUrl(input.url)
        : existing.canonicalUrl;

    if (canonicalUrl !== existing.canonicalUrl) {
      await this.assertKnowledgeUrlNotDuplicated(
        existing.artistId,
        canonicalUrl,
        existing.id,
      );
    }

    const description =
      input.description !== undefined && input.description !== null
        ? input.description.trim()
        : existing.artistDescription;
    const summary = normalizeArtistKnowledgeSummary(description);

    if (!summary) {
      this.throwArtistKnowledgeBadRequest(
        'ARTIST_KNOWLEDGE_URL_DESCRIPTION_REQUIRED',
        'artistKnowledgeUrl.error.descriptionRequired',
        '자료 설명을 입력해 주세요.',
      );
    }

    const row = await this.prisma.artistKnowledgeUrl.update({
      where: { id: existing.id },
      data: this.clean({
        sourceType:
          input.type !== undefined && input.type !== null
            ? this.knowledgeSourceType(input.type)
            : undefined,
        url:
          input.url !== undefined && input.url !== null
            ? input.url.trim()
            : undefined,
        canonicalUrl,
        artistDescription: description,
        summary,
        allowChatReference: input.allowChatRef,
        status: 'pending',
        reviewedByUserId: null,
        reviewedAt: null,
        rejectionReason: null,
        archivedAt: null,
        updatedAt: new Date(),
        metadata: this.mergeMetadata(existing.metadata, {
          contractVersion: ARTIST_URL_KNOWLEDGE_CONTRACT.version,
          summarySource: 'artist_description_revision',
          externalFetchPerformed: false,
          rawPageBodyStored: false,
        }),
      }),
    });

    await this.recordArtistKnowledgeAudit(
      user,
      'creator_studio.artist_knowledge_url.update',
      existing,
      row,
    );

    return {
      item: this.presentKnowledgeUrl(row),
      contract: ARTIST_URL_KNOWLEDGE_CONTRACT.apiContracts.creatorUpdate,
    };
  }

  async archiveKnowledgeUrl(user: AuthUser, knowledgeUrlId: string) {
    this.assertArtistKnowledgeUuid(knowledgeUrlId, 'knowledgeUrlId');
    const existing = await this.prisma.artistKnowledgeUrl.findUnique({
      where: { id: knowledgeUrlId },
    });

    if (!existing) {
      this.throwArtistKnowledgeNotFound();
    }

    await this.assertArtistKnowledgeOperator(user.id, existing.artistId);

    const row = await this.prisma.artistKnowledgeUrl.update({
      where: { id: existing.id },
      data: {
        status: 'archived',
        archivedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await this.recordArtistKnowledgeAudit(
      user,
      'creator_studio.artist_knowledge_url.archive',
      existing,
      row,
    );

    return {
      item: this.presentKnowledgeUrl(row),
      contract: ARTIST_URL_KNOWLEDGE_CONTRACT.apiContracts.creatorArchive,
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

  private presentKnowledgeUrl(row: {
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
  }) {
    const metadata = this.recordOrEmpty(row.metadata);
    const status = ARTIST_URL_KNOWLEDGE_STATUSES.includes(row.status as never)
      ? row.status
      : 'pending';
    const safetyStatus = artistKnowledgeSafetyStatusFromMetadata(
      metadata,
      status,
    );

    return {
      id: row.id,
      artistId: row.artistId,
      submittedByUserId: row.submittedByUserId,
      reviewedByUserId: row.reviewedByUserId,
      type: row.sourceType,
      title: normalizeArtistKnowledgeTitle(
        typeof metadata.title === 'string' ? metadata.title : null,
      ),
      url: row.url,
      canonicalUrl: row.canonicalUrl,
      description: row.artistDescription,
      summary: row.summary,
      allowChatRef: row.allowChatReference,
      status,
      approvalStatus: status,
      safetyStatus,
      rejectionReason: row.rejectionReason,
      metadata: this.presentKnowledgeUrlMetadata(metadata),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      reviewedAt: row.reviewedAt,
      archivedAt: row.archivedAt,
      chatReference: {
        eligible:
          status === 'approved' &&
          row.allowChatReference &&
          Boolean(row.summary) &&
          safetyStatus === 'safe',
        approvedOnly: true,
        rawUrlIncludedInPrompt: false,
      },
    };
  }

  private presentKnowledgeUrlMetadata(record: Record<string, unknown>) {
    return {
      contractVersion:
        typeof record.contractVersion === 'string' ? record.contractVersion : null,
      externalFetchPerformed: record.externalFetchPerformed === true,
      rawPageBodyStored: record.rawPageBodyStored === true,
      chatReferenceBlocked: record.chatReferenceBlocked === true,
      internalReviewReasonReturned: false,
      adminNoteReturned: false,
    };
  }

  private recordArtistKnowledgeAudit(
    user: AuthUser,
    action: string,
    beforeData: Parameters<typeof buildArtistKnowledgeAuditPayload>[1],
    afterData: Parameters<typeof buildArtistKnowledgeAuditPayload>[2],
  ) {
    const audit = buildArtistKnowledgeAuditPayload(action, beforeData, afterData);
    const targetId = afterData?.id ?? beforeData?.id ?? null;

    return this.prisma.auditEvent.create({
      data: {
        actorUserId: user.id,
        actorType: 'creator',
        action,
        targetType: 'artist_knowledge_url',
        targetId,
        beforeData: this.toJson(audit.beforeData),
        afterData: this.toJson(audit.afterData),
        metadata: this.toJson(audit.metadata),
      },
    });
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

  private async assertArtistKnowledgeOperator(userId: string, artistId: string) {
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
      throw new ForbiddenException({
        code: 'ARTIST_KNOWLEDGE_URL_ACCESS_REQUIRED',
        message: '이 아티스트의 자료 URL을 관리할 권한이 없습니다.',
        messageKey: 'artistKnowledgeUrl.error.accessRequired',
      });
    }
  }

  private async creatorStudioKnowledgeArtistIds(
    userId: string,
    artistId?: string,
  ) {
    if (artistId) {
      this.assertArtistKnowledgeUuid(artistId, 'artistId');
      await this.assertArtistKnowledgeOperator(userId, artistId);

      return [artistId];
    }

    const operators = await this.prisma.artistOperator.findMany({
      where: {
        userId,
        status: 'active',
        revokedAt: null,
      },
      select: { artistId: true },
      orderBy: { createdAt: 'desc' },
    });

    return operators.map((operator) => operator.artistId);
  }

  private knowledgeSourceType(type: string) {
    if (!isArtistKnowledgeSourceType(type)) {
      this.throwArtistKnowledgeBadRequest(
        'ARTIST_KNOWLEDGE_URL_TYPE_INVALID',
        'artistKnowledgeUrl.error.typeInvalid',
        '지원하는 자료 유형을 선택해 주세요.',
        { supportedTypes: ARTIST_URL_KNOWLEDGE_CONTRACT.sourceTypes },
      );
    }

    return type;
  }

  private canonicalKnowledgeUrl(value: string) {
    const raw = value.trim();

    try {
      const url = new URL(raw);

      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('invalid protocol');
      }

      url.hash = '';
      url.hostname = url.hostname.toLowerCase();

      return url.toString();
    } catch {
      this.throwArtistKnowledgeBadRequest(
        'ARTIST_KNOWLEDGE_URL_INVALID_URL',
        'artistKnowledgeUrl.error.invalidUrl',
        'http 또는 https로 시작하는 올바른 URL을 입력해 주세요.',
      );
    }
  }

  private async assertKnowledgeUrlNotDuplicated(
    artistId: string,
    canonicalUrl: string,
    exceptId?: string,
  ) {
    const existing = await this.prisma.artistKnowledgeUrl.findFirst({
      where: {
        artistId,
        canonicalUrl,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (existing) {
      throw new ConflictException({
        code: 'ARTIST_KNOWLEDGE_URL_DUPLICATED',
        message: '이미 등록된 자료 URL입니다.',
        messageKey: 'artistKnowledgeUrl.error.duplicated',
        existingStatus: ARTIST_URL_KNOWLEDGE_STATUSES.includes(
          existing.status as never,
        )
          ? existing.status
          : 'pending',
      });
    }
  }

  private assertArtistKnowledgeUuid(value: string, field: string) {
    if (!UUID_PATTERN.test(value)) {
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

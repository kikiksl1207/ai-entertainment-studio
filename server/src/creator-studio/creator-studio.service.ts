import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AuthUser } from '../auth/auth.types';
import { buildPublicAssetUrl } from '../common/asset-url';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreatorStudioSettlementPreviewQueryDto,
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
type CreatorRevenueType = 'chat' | 'gift' | 'paid_like' | 'premium_video' | 'fan_letter';

@Injectable()
export class CreatorStudioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getStudio(userId: string) {
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
    const hasAccess = artistIds.length > 0;
    let accessType: 'personal_creator' | 'studio_operator' | null = null;
    if (hasAccess) {
      accessType = artistIds.length > 1 ? 'studio_operator' : 'personal_creator';
    }

    return {
      access: {
        enabled: hasAccess,
        type: accessType,
        status: hasAccess ? 'approved' : 'none',
        entryUrl: '/creator-studio.html',
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
        mode: 'creator_studio_bootstrap_v1',
        emptyState:
          'No active artist operator access is connected to this account yet.',
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
          settlementPreview: '/api/v1/me/creator-studio/settlement-preview',
          uploadIntent: '/api/v1/me/assets/upload-intents',
          confirmUpload: '/api/v1/me/assets/:assetId/confirm-upload',
        },
      },
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

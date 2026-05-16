import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_CURRENCY = 'LUMINA';
const PAID_LIKE_PRODUCT_SKU = 'BOOST_BASIC_VOTE';
const PAID_LIKE_DAILY_LIMIT = 20;
const BOOST_IDEMPOTENCY_REQUIRED = {
  code: 'BOOST_IDEMPOTENCY_REQUIRED',
  message: 'boost.error.idempotencyRequired',
  messageKey: 'boost.error.idempotencyRequired',
  walletMutation: false,
  idempotencyRequired: true,
} as const;
const BOOST_IDEMPOTENCY_CONFLICT = {
  code: 'BOOST_IDEMPOTENCY_CONFLICT',
  message: 'boost.error.idempotencyConflict',
  messageKey: 'boost.error.idempotencyConflict',
  walletMutation: false,
} as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class BoostsService {
  constructor(private readonly prisma: PrismaService) {}

  getCurrentCampaign() {
    const now = new Date();

    return this.prisma.boostCampaign.findFirst({
      where: {
        status: 'active',
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      orderBy: { startsAt: 'desc' },
    });
  }

  getBoostProducts() {
    return this.prisma.boostProduct.findMany({
      where: { status: 'active' },
      orderBy: [{ priceLumina: 'asc' }, { boostAmount: 'asc' }],
    });
  }

  async createFreeLike(
    userId: string,
    input: {
      campaignId: string;
      artistId?: string;
      artistSlug?: string;
      idempotencyKey?: string;
    },
  ) {
    const [campaign, artist] = await Promise.all([
      this.getActiveCampaign(input.campaignId),
      this.resolveActiveArtist(input.artistId, input.artistSlug),
    ]);

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (input.idempotencyKey) {
        const existingEvent = await tx.artistBoostEvent.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });

        if (existingEvent) {
          return { event: existingEvent, idempotentReplay: true };
        }
      }

      if (campaign.dailyFreeLikeLimit) {
        const usedToday = await tx.artistBoostEvent.count({
          where: {
            campaignId: campaign.id,
            userId,
            boostType: 'free_like',
            createdAt: { gte: this.startOfToday() },
          },
        });

        if (usedToday >= campaign.dailyFreeLikeLimit) {
          throw new BadRequestException('Daily free like limit exceeded');
        }
      }

      const event = await tx.artistBoostEvent.create({
        data: {
          campaignId: campaign.id,
          userId,
          artistId: artist.id,
          boostType: 'free_like',
          rawAmount: new Decimal(1),
          weightedScore: campaign.freeLikeWeight,
          idempotencyKey: input.idempotencyKey,
        },
      });

      return { event, idempotentReplay: false };
    });
  }

  async createPaidLike(
    userId: string,
    input: {
      campaignId: string;
      artistId?: string;
      artistSlug?: string;
      quantity?: number | string;
      idempotencyKey?: string;
    },
  ) {
    const quantity = this.parsePaidLikeQuantity(input.quantity);
    const idempotencyKey = this.requireWalletMutationIdempotencyKey(
      input.idempotencyKey,
    );
    const [campaign, artist, boostProduct] = await Promise.all([
      this.getActiveCampaign(input.campaignId),
      this.resolveActiveArtist(input.artistId, input.artistSlug),
      this.prisma.boostProduct.findFirst({
        where: { sku: PAID_LIKE_PRODUCT_SKU, status: 'active' },
      }),
    ]);

    if (!boostProduct) {
      throw new NotFoundException('Paid like product not found');
    }

    const quantityDecimal = new Decimal(quantity);
    const totalPriceLumina = boostProduct.priceLumina.mul(quantityDecimal);
    const totalBoostAmount = boostProduct.boostAmount.mul(quantityDecimal);
    const { start, resetAt } = this.todayWindow();

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existingEvent = await tx.artistBoostEvent.findUnique({
        where: { idempotencyKey },
        include: { walletLedger: true },
      });

      if (existingEvent) {
        this.assertPaidLikeIdempotentReplay(existingEvent, {
          userId,
          campaignId: campaign.id,
          artistId: artist.id,
          boostProductId: boostProduct.id,
          quantity,
        });

        const wallet = existingEvent.walletLedgerId
          ? await tx.walletAccount.findFirst({
              where: {
                userId,
                currencyCode: DEFAULT_CURRENCY,
              },
            })
          : null;

        return {
          event: existingEvent,
          idempotentReplay: true,
          paidLike: {
            quantity,
            unitPriceLumina: boostProduct.priceLumina,
            totalPriceLumina,
            unitBoostAmount: boostProduct.boostAmount,
            totalBoostAmount,
          },
          wallet,
        };
      }

      const paidLikeEventsToday = await tx.artistBoostEvent.findMany({
        where: {
          campaignId: campaign.id,
          userId,
          boostType: 'lumina_boost',
          createdAt: { gte: start },
          metadata: {
            path: ['source'],
            equals: 'paid_like',
          },
        },
        select: {
          metadata: true,
        },
      });
      const usedToday = this.sumPaidLikeQuantities(paidLikeEventsToday);

      if (usedToday + quantity > PAID_LIKE_DAILY_LIMIT) {
        throw new BadRequestException('Daily paid like limit exceeded');
      }

      const wallet = await tx.walletAccount.findUnique({
        where: {
          userId_currencyCode: {
            userId,
            currencyCode: DEFAULT_CURRENCY,
          },
        },
      });

      if (!wallet || wallet.status !== 'active') {
        throw new BadRequestException('Active wallet not found');
      }

      const updatedWalletResult = await tx.walletAccount.updateMany({
        where: {
          id: wallet.id,
          cachedBalance: { gte: totalPriceLumina },
        },
        data: {
          cachedBalance: { decrement: totalPriceLumina },
        },
      });

      if (updatedWalletResult.count !== 1) {
        throw new BadRequestException('Insufficient Lumina balance');
      }

      const ledger = await tx.walletLedger.create({
        data: {
          walletAccountId: wallet.id,
          direction: 'debit',
          amount: totalPriceLumina,
          ledgerType: 'boost_spend',
          referenceType: 'boost_product',
          referenceId: boostProduct.id,
          idempotencyKey: `wallet:boost-paid-like:${idempotencyKey}`,
          memo: `Paid like x${quantity}: ${artist.displayName}`,
        },
      });

      const event = await tx.artistBoostEvent.create({
        data: {
          campaignId: campaign.id,
          userId,
          artistId: artist.id,
          boostType: 'lumina_boost',
          boostProductId: boostProduct.id,
          walletLedgerId: ledger.id,
          rawAmount: totalBoostAmount,
          weightedScore: totalBoostAmount.mul(campaign.luminaBoostWeight),
          idempotencyKey,
          metadata: {
            source: 'paid_like',
            idempotencyScope: 'boost-paid-like',
            quantity,
            artistSlug: artist.slug,
            unitPriceLumina: boostProduct.priceLumina.toString(),
            totalPriceLumina: totalPriceLumina.toString(),
            dailyLimit: PAID_LIKE_DAILY_LIMIT,
            usedTodayBefore: usedToday,
            usedTodayAfter: usedToday + quantity,
            resetsAt: resetAt.toISOString(),
          },
        },
        include: { walletLedger: true },
      });

      const updatedWallet = await tx.walletAccount.findUnique({
        where: { id: wallet.id },
      });

      return {
        event,
        idempotentReplay: false,
        paidLike: {
          quantity,
          unitPriceLumina: boostProduct.priceLumina,
          totalPriceLumina,
          unitBoostAmount: boostProduct.boostAmount,
          totalBoostAmount,
          dailyLimit: PAID_LIKE_DAILY_LIMIT,
          usedToday: usedToday + quantity,
          remainingToday: Math.max(PAID_LIKE_DAILY_LIMIT - usedToday - quantity, 0),
          resetsAt: resetAt.toISOString(),
        },
        wallet: updatedWallet,
      };
    });
  }

  async createBoostOrder(
    userId: string,
    input: {
      campaignId: string;
      artistId: string;
      boostProductId: string;
      idempotencyKey?: string;
    },
  ) {
    const idempotencyKey = this.requireWalletMutationIdempotencyKey(
      input.idempotencyKey,
    );
    const [campaign, boostProduct] = await Promise.all([
      this.getActiveCampaign(input.campaignId),
      this.prisma.boostProduct.findFirst({
        where: { id: input.boostProductId, status: 'active' },
      }),
    ]);

    if (!boostProduct) {
      throw new NotFoundException('Boost product not found');
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existingEvent = await tx.artistBoostEvent.findUnique({
        where: { idempotencyKey },
        include: { walletLedger: true },
      });

      if (existingEvent) {
        this.assertBoostOrderIdempotentReplay(existingEvent, {
          userId,
          campaignId: campaign.id,
          artistId: input.artistId,
          boostProductId: boostProduct.id,
        });

        return { event: existingEvent, idempotentReplay: true };
      }

      const wallet = await tx.walletAccount.findUnique({
        where: {
          userId_currencyCode: {
            userId,
            currencyCode: DEFAULT_CURRENCY,
          },
        },
      });

      if (!wallet || wallet.status !== 'active') {
        throw new BadRequestException('Active wallet not found');
      }

      const updatedWallet = await tx.walletAccount.updateMany({
        where: {
          id: wallet.id,
          cachedBalance: { gte: boostProduct.priceLumina },
        },
        data: {
          cachedBalance: { decrement: boostProduct.priceLumina },
        },
      });

      if (updatedWallet.count !== 1) {
        throw new BadRequestException('Insufficient Lumina balance');
      }

      const ledger = await tx.walletLedger.create({
        data: {
          walletAccountId: wallet.id,
          direction: 'debit',
          amount: boostProduct.priceLumina,
          ledgerType: 'boost_spend',
          referenceType: 'boost_product',
          referenceId: boostProduct.id,
          idempotencyKey: `wallet:boost-order:${idempotencyKey}`,
          memo: `Boost order: ${boostProduct.name}`,
        },
      });

      const event = await tx.artistBoostEvent.create({
        data: {
          campaignId: campaign.id,
          userId,
          artistId: input.artistId,
          boostType: 'lumina_boost',
          boostProductId: boostProduct.id,
          walletLedgerId: ledger.id,
          rawAmount: boostProduct.boostAmount,
          weightedScore: boostProduct.boostAmount.mul(campaign.luminaBoostWeight),
          idempotencyKey,
          metadata: {
            source: 'boost_order',
            idempotencyScope: 'boost-order',
          },
        },
        include: { walletLedger: true },
      });

      return { event, idempotentReplay: false };
    });
  }

  async getRankings(campaignId: string) {
    const events = await this.prisma.artistBoostEvent.findMany({
      where: { campaignId },
      include: {
        artist: {
          select: {
            id: true,
            slug: true,
            displayName: true,
          },
        },
      },
    });

    const rows = new Map<
      string,
      {
        artist: { id: string; slug: string; displayName: string };
        totalFreeLikes: Decimal;
        totalLuminaBoosts: Decimal;
        totalWeightedScore: Decimal;
      }
    >();

    for (const event of events) {
      const row = rows.get(event.artistId) ?? {
        artist: event.artist,
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

    return [...rows.values()]
      .sort((left, right) => right.totalWeightedScore.comparedTo(left.totalWeightedScore))
      .map((row, index) => ({
        rankNo: index + 1,
        ...row,
      }));
  }

  getMyBoostEvents(userId: string) {
    return this.prisma.artistBoostEvent.findMany({
      where: { userId },
      include: {
        campaign: true,
        artist: {
          select: {
            id: true,
            slug: true,
            displayName: true,
          },
        },
        boostProduct: true,
        walletLedger: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getMyFreeLikeQuota(userId: string) {
    const campaign = await this.getCurrentCampaign();
    const { start, resetAt } = this.todayWindow();

    if (!campaign) {
      return {
        campaign: null,
        dailyLimit: 0,
        usedToday: 0,
        remaining: 0,
        resetsAt: resetAt.toISOString(),
      };
    }

    const usedToday = await this.prisma.artistBoostEvent.count({
      where: {
        campaignId: campaign.id,
        userId,
        boostType: 'free_like',
        createdAt: { gte: start },
      },
    });
    const dailyLimit = campaign.dailyFreeLikeLimit ?? 0;

    return {
      campaign: {
        id: campaign.id,
        slug: campaign.slug,
        name: campaign.name,
      },
      dailyLimit,
      usedToday,
      remaining: Math.max(dailyLimit - usedToday, 0),
      resetsAt: resetAt.toISOString(),
    };
  }

  private async getActiveCampaign(campaignId: string) {
    const now = new Date();
    const campaign = await this.prisma.boostCampaign.findFirst({
      where: {
        id: campaignId,
        status: 'active',
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
    });

    if (!campaign) {
      throw new NotFoundException('Active boost campaign not found');
    }

    return campaign;
  }

  private async resolveActiveArtist(artistId?: string, artistSlug?: string) {
    const normalizedArtistId = artistId?.trim();
    const normalizedArtistSlug = artistSlug?.trim();

    if (!normalizedArtistId && !normalizedArtistSlug) {
      throw new BadRequestException('artistId or artistSlug is required');
    }

    const artist = await this.prisma.artist.findFirst({
      where: {
        status: 'active',
        OR: [
          normalizedArtistId && UUID_PATTERN.test(normalizedArtistId)
            ? { id: normalizedArtistId }
            : undefined,
          normalizedArtistSlug ? { slug: normalizedArtistSlug } : undefined,
          normalizedArtistId ? { slug: normalizedArtistId } : undefined,
        ].filter(Boolean) as Array<{ id: string } | { slug: string }>,
      },
      select: {
        id: true,
        slug: true,
        displayName: true,
      },
    });

    if (!artist) {
      throw new BadRequestException('Active artist not found');
    }

    return artist;
  }

  private startOfToday() {
    return this.todayWindow().start;
  }

  private todayWindow() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const resetAt = new Date(start);
    resetAt.setDate(resetAt.getDate() + 1);

    return { start, resetAt };
  }

  async getMyPaidLikeQuota(userId: string) {
    const campaign = await this.getCurrentCampaign();
    const { start, resetAt } = this.todayWindow();

    if (!campaign) {
      return {
        campaign: null,
        dailyLimit: PAID_LIKE_DAILY_LIMIT,
        usedToday: 0,
        remaining: 0,
        resetsAt: resetAt.toISOString(),
        unitPriceLumina: null,
      };
    }

    const [paidLikeEventsToday, boostProduct] = await Promise.all([
      this.prisma.artistBoostEvent.findMany({
        where: {
          campaignId: campaign.id,
          userId,
          boostType: 'lumina_boost',
          createdAt: { gte: start },
          metadata: {
            path: ['source'],
            equals: 'paid_like',
          },
        },
        select: {
          metadata: true,
        },
      }),
      this.prisma.boostProduct.findFirst({
        where: { sku: PAID_LIKE_PRODUCT_SKU, status: 'active' },
        select: {
          priceLumina: true,
        },
      }),
    ]);
    const usedToday = this.sumPaidLikeQuantities(paidLikeEventsToday);

    return {
      campaign: {
        id: campaign.id,
        slug: campaign.slug,
        name: campaign.name,
      },
      dailyLimit: PAID_LIKE_DAILY_LIMIT,
      usedToday,
      remaining: Math.max(PAID_LIKE_DAILY_LIMIT - usedToday, 0),
      resetsAt: resetAt.toISOString(),
      unitPriceLumina: boostProduct?.priceLumina ?? null,
    };
  }

  private parsePaidLikeQuantity(value: number | string | undefined) {
    const quantity = typeof value === 'string' ? Number(value) : (value ?? 1);

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > PAID_LIKE_DAILY_LIMIT) {
      throw new BadRequestException(
        `quantity must be an integer between 1 and ${PAID_LIKE_DAILY_LIMIT}`,
      );
    }

    return quantity;
  }

  private sumPaidLikeQuantities(
    events: Array<{
      metadata: unknown;
    }>,
  ) {
    return events.reduce((total, event) => {
      const metadata =
        event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
          ? (event.metadata as Record<string, unknown>)
          : {};
      const quantity =
        typeof metadata.quantity === 'number'
          ? metadata.quantity
          : typeof metadata.quantity === 'string'
            ? Number(metadata.quantity)
            : 1;

      return total + (Number.isFinite(quantity) && quantity > 0 ? quantity : 1);
    }, 0);
  }

  private requireWalletMutationIdempotencyKey(value?: string) {
    const idempotencyKey = value?.trim();

    if (!idempotencyKey) {
      throw new BadRequestException(BOOST_IDEMPOTENCY_REQUIRED);
    }

    return idempotencyKey;
  }

  private assertPaidLikeIdempotentReplay(
    event: {
      userId: string;
      campaignId: string;
      artistId: string;
      boostType: string;
      boostProductId: string | null;
      metadata: unknown;
    },
    expected: {
      userId: string;
      campaignId: string;
      artistId: string;
      boostProductId: string;
      quantity: number;
    },
  ) {
    const metadata = this.metadataRecord(event.metadata);
    const storedQuantity =
      typeof metadata.quantity === 'number'
        ? metadata.quantity
        : typeof metadata.quantity === 'string'
          ? Number(metadata.quantity)
          : null;

    if (
      event.userId === expected.userId &&
      event.campaignId === expected.campaignId &&
      event.artistId === expected.artistId &&
      event.boostType === 'lumina_boost' &&
      event.boostProductId === expected.boostProductId &&
      metadata.source === 'paid_like' &&
      storedQuantity === expected.quantity
    ) {
      return;
    }

    throw new ConflictException(BOOST_IDEMPOTENCY_CONFLICT);
  }

  private assertBoostOrderIdempotentReplay(
    event: {
      userId: string;
      campaignId: string;
      artistId: string;
      boostType: string;
      boostProductId: string | null;
    },
    expected: {
      userId: string;
      campaignId: string;
      artistId: string;
      boostProductId: string;
    },
  ) {
    if (
      event.userId === expected.userId &&
      event.campaignId === expected.campaignId &&
      event.artistId === expected.artistId &&
      event.boostType === 'lumina_boost' &&
      event.boostProductId === expected.boostProductId
    ) {
      return;
    }

    throw new ConflictException(BOOST_IDEMPOTENCY_CONFLICT);
  }

  private metadataRecord(metadata: unknown) {
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  }
}

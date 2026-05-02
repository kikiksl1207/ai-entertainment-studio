import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_CURRENCY = 'LUMINA';
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

    return this.prisma.$transaction(async (tx) => {
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

  async createBoostOrder(
    userId: string,
    input: {
      campaignId: string;
      artistId: string;
      boostProductId: string;
      idempotencyKey?: string;
    },
  ) {
    const [campaign, boostProduct] = await Promise.all([
      this.getActiveCampaign(input.campaignId),
      this.prisma.boostProduct.findFirst({
        where: { id: input.boostProductId, status: 'active' },
      }),
    ]);

    if (!boostProduct) {
      throw new NotFoundException('Boost product not found');
    }

    return this.prisma.$transaction(async (tx) => {
      if (input.idempotencyKey) {
        const existingEvent = await tx.artistBoostEvent.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: { walletLedger: true },
        });

        if (existingEvent) {
          return { event: existingEvent, idempotentReplay: true };
        }
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
          idempotencyKey: input.idempotencyKey
            ? `wallet:${input.idempotencyKey}`
            : undefined,
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
          idempotencyKey: input.idempotencyKey,
        },
        include: { walletLedger: true },
      });

      return { event, idempotentReplay: false };
    });
  }

  async getRankings(campaignId: string) {
    const snapshotAt = await this.prisma.artistRankingSnapshot.findFirst({
      where: { campaignId },
      orderBy: { snapshotAt: 'desc' },
      select: { snapshotAt: true },
    });

    if (snapshotAt) {
      return this.prisma.artistRankingSnapshot.findMany({
        where: { campaignId, snapshotAt: snapshotAt.snapshotAt },
        include: {
          artist: {
            select: {
              id: true,
              slug: true,
              displayName: true,
            },
          },
        },
        orderBy: { rankNo: 'asc' },
      });
    }

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
}

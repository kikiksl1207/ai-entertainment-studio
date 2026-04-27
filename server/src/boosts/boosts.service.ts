import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_CURRENCY = 'LUMINA';

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
      artistId: string;
      idempotencyKey?: string;
    },
  ) {
    const campaign = await this.getActiveCampaign(input.campaignId);

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
          artistId: input.artistId,
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

  private startOfToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
}

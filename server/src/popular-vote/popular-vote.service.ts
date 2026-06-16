import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

type PopularVoteQuery = Record<string, string | undefined>;

export const PUBLIC_ARTIST_RANKING_PROJECTION_CONTRACT = {
  version: '2026-06-16.public-artist-ranking-projection.v1',
  includedArtistStatus: 'active',
  includedPublicCharacters: [
    'already_public_active_character',
    'gallery_ready_then_active_character',
  ],
  excludedArtistStatuses: ['pending', 'hidden', 'archived', 'deleted'],
  surfaces: {
    like: '/api/v1/boost-campaigns/:campaignId/rankings',
    vote: [
      '/api/v1/popular-vote/main-pick',
      '/api/v1/popular-vote/hall-of-fame/year-champion',
    ],
    support: '/api/v1/chat/rankings?type=donation',
    communication: '/api/v1/chat/rankings?type=communication',
  },
  mutationPolicy: {
    likeMutation: false,
    voteMutation: false,
    supportMutation: false,
    walletMutation: false,
    settlementMutation: false,
    payoutMutation: false,
  },
} as const;

@Injectable()
export class PopularVoteService {
  constructor(private readonly prisma: PrismaService) {}

  async getMainPick() {
    const campaign = await this.findCurrentMainPickCampaign();
    if (!campaign) {
      return {
        campaign: null,
        leader: null,
        rankings: [],
      };
    }

    const rankings = await this.buildRankings(campaign.id, {
      includeZeroScoreActiveArtists: true,
    });
    return {
      campaign,
      leader: rankings[0] ?? null,
      rankings,
    };
  }

  getMonthlyPicks(query: PopularVoteQuery) {
    const where: Prisma.MonthlyPickWinnerWhereInput = {};
    const year = this.optionalNumber(query.year);
    if (year) {
      where.year = year;
    }

    const take = Math.max(1, Math.min(this.optionalNumber(query.take) ?? 24, 60));
    return this.prisma.monthlyPickWinner.findMany({
      where,
      take,
      include: this.monthlyPickInclude(),
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async getYearChampion(query: PopularVoteQuery) {
    const year = this.optionalNumber(query.year) ?? this.kstParts(new Date()).year;
    const { start, end } = this.kstYearRange(year);
    const rankings = await this.buildRankingsForDateRange(start, end);

    return {
      year,
      champion: rankings[0] ?? null,
      rankings,
      rule: 'annual_weighted_score_sum',
    };
  }

  async finalizeMonthlyPick(
    user: AuthUser,
    input: { campaignId?: string; year?: number; month?: number },
  ) {
    const { year, month } =
      input.year && input.month
        ? this.assertMonth(input.year, input.month)
        : this.previousKstMonth(new Date());
    const { start, end } = this.kstMonthRange(year, month);
    const campaign = await this.findMonthlyCampaign(input.campaignId, start, end);
    const rankings = await this.buildRankings(campaign.id);
    const winner = rankings[0];

    if (!winner) {
      throw new BadRequestException('Campaign has no ranking rows to finalize');
    }

    const result = await this.prisma.monthlyPickWinner.upsert({
      where: {
        year_month: { year, month },
      },
      update: {
        campaignId: campaign.id,
        artistId: winner.artist.id,
        rankNo: winner.rankNo,
        totalFreeLikes: winner.totalFreeLikes,
        totalLuminaBoosts: winner.totalLuminaBoosts,
        totalWeightedScore: winner.totalWeightedScore,
        decidedAt: new Date(),
        updatedAt: new Date(),
        metadata: this.toJson({
          finalizedByUserId: user.id,
          source: 'admin_manual',
        }),
      },
      create: {
        campaignId: campaign.id,
        artistId: winner.artist.id,
        year,
        month,
        rankNo: winner.rankNo,
        totalFreeLikes: winner.totalFreeLikes,
        totalLuminaBoosts: winner.totalLuminaBoosts,
        totalWeightedScore: winner.totalWeightedScore,
        metadata: this.toJson({
          finalizedByUserId: user.id,
          source: 'admin_manual',
        }),
      },
      include: this.monthlyPickInclude(),
    });

    await this.recordAudit(user, 'popular_vote.monthly_pick.finalize', result.id, {
      campaignId: campaign.id,
      year,
      month,
      artistId: winner.artist.id,
    });

    return {
      winner: result,
      rankings,
    };
  }

  private findCurrentMainPickCampaign() {
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

  private async findMonthlyCampaign(campaignId: string | undefined, start: Date, end: Date) {
    const campaign = campaignId
      ? await this.prisma.boostCampaign.findUnique({ where: { id: campaignId } })
      : await this.prisma.boostCampaign.findFirst({
          where: {
            startsAt: { lt: end },
            endsAt: { gt: start },
          },
          orderBy: { endsAt: 'desc' },
        });

    if (!campaign) {
      throw new NotFoundException('Boost campaign not found for monthly pick');
    }

    return campaign;
  }

  private async buildRankings(
    campaignId: string,
    options: { includeZeroScoreActiveArtists?: boolean } = {},
  ) {
    return this.buildRankingsFromEvents({ campaignId }, options);
  }

  private buildRankingsForDateRange(start: Date, end: Date) {
    return this.buildRankingsFromEvents({
      createdAt: {
        gte: start,
        lt: end,
      },
    });
  }

  private async buildRankingsFromEvents(
    where: Prisma.ArtistBoostEventWhereInput,
    options: { includeZeroScoreActiveArtists?: boolean } = {},
  ) {
    const [events, activeArtists] = await Promise.all([
      this.prisma.artistBoostEvent.findMany({
        where: {
          ...where,
          artist: {
            status: PUBLIC_ARTIST_RANKING_PROJECTION_CONTRACT.includedArtistStatus,
          },
        },
        include: { artist: this.artistSelect() },
      }),
      this.prisma.artist.findMany({
        where: {
          status: PUBLIC_ARTIST_RANKING_PROJECTION_CONTRACT.includedArtistStatus,
        },
        ...this.artistSelect(),
        orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
      }),
    ]);

    const rows = new Map<
      string,
      {
        artist: { id: string; slug: string; displayName: string };
        totalFreeLikes: Decimal;
        totalPaidLikes: Decimal;
        totalLuminaBoosts: Decimal;
        totalWeightedScore: Decimal;
      }
    >();

    const activeArtistOrder = new Map(
      activeArtists.map((activeArtist, index) => [activeArtist.id, index]),
    );
    if (options.includeZeroScoreActiveArtists) {
      for (const activeArtist of activeArtists) {
        rows.set(activeArtist.id, {
          artist: activeArtist,
          totalFreeLikes: new Decimal(0),
          totalPaidLikes: new Decimal(0),
          totalLuminaBoosts: new Decimal(0),
          totalWeightedScore: new Decimal(0),
        });
      }
    }

    for (const event of events) {
      if (!activeArtistOrder.has(event.artistId)) {
        continue;
      }

      const row = rows.get(event.artistId) ?? {
        artist: event.artist,
        totalFreeLikes: new Decimal(0),
        totalPaidLikes: new Decimal(0),
        totalLuminaBoosts: new Decimal(0),
        totalWeightedScore: new Decimal(0),
      };

      if (event.boostType === 'free_like') {
        row.totalFreeLikes = row.totalFreeLikes.plus(event.rawAmount);
      }

      if (event.boostType === 'lumina_boost') {
        row.totalPaidLikes = row.totalPaidLikes.plus(event.rawAmount);
        row.totalLuminaBoosts = row.totalLuminaBoosts.plus(event.rawAmount);
      }

      row.totalWeightedScore = row.totalWeightedScore.plus(event.weightedScore);
      rows.set(event.artistId, row);
    }

    return [...rows.values()]
      .sort((left, right) => {
        const scoreOrder = right.totalWeightedScore.comparedTo(left.totalWeightedScore);
        if (scoreOrder !== 0) {
          return scoreOrder;
        }

        const leftOrder = activeArtistOrder.get(left.artist.id) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = activeArtistOrder.get(right.artist.id) ?? Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }

        return left.artist.displayName.localeCompare(right.artist.displayName, 'ko');
      })
      .map((row, index) => ({
        rankNo: index + 1,
        ...row,
      }));
  }

  private monthlyPickInclude() {
    return {
      campaign: true,
      artist: this.artistSelect(),
    } satisfies Prisma.MonthlyPickWinnerInclude;
  }

  private artistSelect() {
    return {
      select: {
        id: true,
        slug: true,
        displayName: true,
      },
    } satisfies Prisma.ArtistDefaultArgs;
  }

  private optionalNumber(value: string | number | undefined) {
    if (value === undefined || value === '') {
      return undefined;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      throw new BadRequestException('Expected an integer value');
    }

    return parsed;
  }

  private assertMonth(year: number, month: number) {
    if (!Number.isInteger(year) || year < 2026 || year > 2100) {
      throw new BadRequestException('year must be between 2026 and 2100');
    }

    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('month must be between 1 and 12');
    }

    return { year, month };
  }

  private previousKstMonth(date: Date) {
    const { year, month } = this.kstParts(date);
    if (month === 1) {
      return { year: year - 1, month: 12 };
    }

    return { year, month: month - 1 };
  }

  private kstParts(date: Date) {
    const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return {
      year: kst.getUTCFullYear(),
      month: kst.getUTCMonth() + 1,
    };
  }

  private kstMonthRange(year: number, month: number) {
    const start = new Date(Date.UTC(year, month - 1, 1) - 9 * 60 * 60 * 1000);
    const endYear = month === 12 ? year + 1 : year;
    const endMonth = month === 12 ? 0 : month;
    const end = new Date(Date.UTC(endYear, endMonth, 1) - 9 * 60 * 60 * 1000);

    return { start, end };
  }

  private kstYearRange(year: number) {
    const start = new Date(Date.UTC(year, 0, 1) - 9 * 60 * 60 * 1000);
    const end = new Date(Date.UTC(year + 1, 0, 1) - 9 * 60 * 60 * 1000);

    return { start, end };
  }

  private recordAudit(
    user: AuthUser,
    action: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ) {
    return this.prisma.auditEvent.create({
      data: {
        actorUserId: user.id,
        actorType: 'admin',
        action,
        targetType: 'monthly_pick_winner',
        targetId,
        beforeData: Prisma.JsonNull,
        afterData: Prisma.JsonNull,
        metadata: this.toJson(metadata),
      },
    });
  }

  private toJson(value: unknown) {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}

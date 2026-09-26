import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

type PopularVoteQuery = Record<string, string | undefined>;

export const MONTHLY_PICK_ARCHIVE_GRACE_MS = 5 * 60 * 1000;

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

    const { year, month } = this.kstParts(new Date());
    const { start, end } = this.kstMonthRange(year, month);
    const rankings = await this.buildRankings(campaign.id, {
      includeZeroScoreActiveArtists: true,
    }, start, end);
    return {
      campaign,
      leader: rankings[0]?.totalWeightedScore.greaterThan(0) ? rankings[0] : null,
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
    const currentYear = this.kstParts(new Date()).year;

    return {
      year,
      champion:
        year < currentYear && rankings[0]?.totalWeightedScore.greaterThan(0)
          ? rankings[0]
          : null,
      rankings,
      rule: 'annual_weighted_score_sum',
    };
  }

  async finalizeMonthlyPick(
    user: AuthUser,
    input: { campaignId?: string; year?: number; month?: number },
  ) {
    if ((input.year === undefined) !== (input.month === undefined)) {
      throw new BadRequestException('year and month must be provided together');
    }
    const { year, month } =
      input.year !== undefined && input.month !== undefined
        ? this.assertMonth(input.year, input.month)
        : this.previousKstMonth(new Date());
    this.assertCompletedMonth(year, month);
    const existing = await this.prisma.monthlyPickWinner.findUnique({
      where: { year_month: { year, month } },
      include: this.monthlyPickInclude(),
    });
    if (existing) {
      return { winner: existing, rankings: [] };
    }

    const { start, end } = this.kstMonthRange(year, month);
    const campaign = await this.findMonthlyCampaign(input.campaignId, start, end);
    const rankings = await this.buildRankings(campaign.id, {}, start, end);
    const winner = rankings[0];

    if (!winner?.totalWeightedScore.greaterThan(0)) {
      throw new BadRequestException('Campaign has no positive-score winner to finalize');
    }

    const created = await this.prisma.monthlyPickWinner.createMany({
      data: [{
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
      }],
      skipDuplicates: true,
    });
    const result = await this.prisma.monthlyPickWinner.findUniqueOrThrow({
      where: { year_month: { year, month } },
      include: this.monthlyPickInclude(),
    });

    if (created.count) {
      await this.recordAudit(user, 'popular_vote.monthly_pick.finalize', result.id, {
        campaignId: campaign.id,
        year,
        month,
        artistId: winner.artist.id,
      });
    }

    return {
      winner: result,
      rankings: created.count ? rankings : [],
    };
  }

  async archiveCompletedMonths(now = new Date()) {
    const firstEvent = await this.prisma.artistBoostEvent.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    if (!firstEvent) {
      return;
    }

    const first = this.kstParts(firstEvent.createdAt);
    // Let votes already in flight at midnight commit before fixing the award.
    const last = this.previousKstMonth(new Date(now.getTime() - MONTHLY_PICK_ARCHIVE_GRACE_MS));
    let { year, month } = first.year < 2026 ? { year: 2026, month: 1 } : first;
    while (year < last.year || (year === last.year && month <= last.month)) {
      await this.archiveMonth(year, month);
      ({ year, month } = this.nextMonth(year, month));
    }
  }

  private async archiveMonth(year: number, month: number) {
    const where = { year_month: { year, month } };
    if (await this.prisma.monthlyPickWinner.findUnique({ where, select: { id: true } })) {
      return;
    }

    const { start, end } = this.kstMonthRange(year, month);
    const campaigns = await this.prisma.boostCampaign.findMany({
      where: { startsAt: { lt: end }, endsAt: { gt: start } },
      orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
    });
    let best: {
      campaignId: string;
      winner: Awaited<ReturnType<PopularVoteService['buildRankings']>>[number];
    } | undefined;
    for (const campaign of campaigns) {
      const winner = (await this.buildRankings(campaign.id, {}, start, end))[0];
      if (winner?.totalWeightedScore.greaterThan(0) &&
          (!best || winner.totalWeightedScore.greaterThan(best.winner.totalWeightedScore))) {
        best = { campaignId: campaign.id, winner };
      }
    }
    if (!best) {
      return;
    }

    await this.prisma.monthlyPickWinner.createMany({
      data: [{
        campaignId: best.campaignId,
        artistId: best.winner.artist.id,
        year,
        month,
        rankNo: best.winner.rankNo,
        totalFreeLikes: best.winner.totalFreeLikes,
        totalLuminaBoosts: best.winner.totalLuminaBoosts,
        totalWeightedScore: best.winner.totalWeightedScore,
        metadata: this.toJson({ source: 'automatic_kst_rollover' }),
      }],
      skipDuplicates: true,
    });
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

    if (campaign.startsAt >= end || campaign.endsAt <= start) {
      throw new BadRequestException('Boost campaign does not overlap the requested month');
    }

    return campaign;
  }

  private async buildRankings(
    campaignId: string,
    options: { includeZeroScoreActiveArtists?: boolean } = {},
    start?: Date,
    end?: Date,
  ) {
    return this.buildRankingsFromEvents({
      campaignId,
      ...(start && end ? { createdAt: { gte: start, lt: end } } : {}),
    }, options);
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

  private nextMonth(year: number, month: number) {
    return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  }

  private assertCompletedMonth(year: number, month: number) {
    const { end } = this.kstMonthRange(year, month);
    if (Date.now() < end.getTime() + MONTHLY_PICK_ARCHIVE_GRACE_MS) {
      throw new BadRequestException('Only settled KST months can be finalized');
    }
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

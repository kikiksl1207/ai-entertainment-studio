import { Decimal } from '@prisma/client/runtime/library';
import {
  PUBLIC_ARTIST_RANKING_PROJECTION_CONTRACT,
  PopularVoteService,
} from './popular-vote.service';

const campaign = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'mvp-launch-main-pick',
  name: 'Lumina Pick',
  startsAt: new Date('2026-01-01T00:00:00.000Z'),
  endsAt: new Date('2027-01-01T00:00:00.000Z'),
};
const yoonSerin = {
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'yoon-serin',
  displayName: '윤세린',
};
const ohHyerin = {
  id: '55555555-5555-4555-8555-555555555555',
  slug: 'oh-hyerin',
  displayName: '오혜린',
};
const minChaeon = {
  id: '66666666-6666-4666-8666-666666666666',
  slug: 'min-chaeon',
  displayName: '민채온',
};

function createHarness() {
  const prisma = {
    boostCampaign: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    artistBoostEvent: {
      findMany: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    artist: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    monthlyPickWinner: {
      findMany: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn(),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditEvent: {
      create: jest.fn(),
    },
  };

  return {
    prisma,
    service: new PopularVoteService(prisma as never),
  };
}

describe('PopularVoteService main pick rankings', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-27T03:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps active public characters visible in the read-only main-pick projection', async () => {
    const { service, prisma } = createHarness();
    prisma.boostCampaign.findFirst.mockResolvedValue(campaign);
    prisma.artist.findMany.mockResolvedValue([yoonSerin, ohHyerin, minChaeon]);
    prisma.artistBoostEvent.findMany.mockResolvedValue([
      {
        artistId: yoonSerin.id,
        artist: yoonSerin,
        boostType: 'free_like',
        rawAmount: new Decimal(1),
        weightedScore: new Decimal(1),
      },
    ]);

    const result = await service.getMainPick();

    expect(result.campaign).toBe(campaign);
    expect(result.leader?.artist.slug).toBe('yoon-serin');
    expect(result.rankings.map((row) => row.artist.slug)).toEqual([
      'yoon-serin',
      'oh-hyerin',
      'min-chaeon',
    ]);
    expect(result.rankings[1]).toMatchObject({
      rankNo: 2,
      artist: ohHyerin,
    });
    expect(result.rankings[1].totalFreeLikes.toString()).toBe('0');
    expect(result.rankings[1].totalWeightedScore.toString()).toBe('0');
    expect(result.rankings[2]).toMatchObject({
      rankNo: 3,
      artist: minChaeon,
    });
    expect(prisma.artist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'active' } }),
    );
    expect(prisma.artistBoostEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          campaignId: campaign.id,
          createdAt: {
            gte: new Date('2026-08-31T15:00:00.000Z'),
            lt: new Date('2026-09-30T15:00:00.000Z'),
          },
          artist: { status: 'active' },
        },
      }),
    );
  });

  it('excludes non-public artist statuses from vote rankings even with legacy events', async () => {
    const { service, prisma } = createHarness();
    const hiddenArtist = {
      id: '77777777-7777-4777-8777-777777777777',
      slug: 'hidden-character',
      displayName: 'Hidden Character',
    };
    prisma.boostCampaign.findFirst.mockResolvedValue(campaign);
    prisma.artist.findMany.mockResolvedValue([ohHyerin]);
    prisma.artistBoostEvent.findMany.mockResolvedValue([
      {
        artistId: ohHyerin.id,
        artist: ohHyerin,
        boostType: 'free_like',
        rawAmount: new Decimal(1),
        weightedScore: new Decimal(1),
      },
      {
        artistId: hiddenArtist.id,
        artist: hiddenArtist,
        boostType: 'lumina_boost',
        rawAmount: new Decimal(999),
        weightedScore: new Decimal(999),
      },
    ]);

    const result = await service.getMainPick();

    expect(prisma.artistBoostEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          campaignId: campaign.id,
          createdAt: {
            gte: new Date('2026-08-31T15:00:00.000Z'),
            lt: new Date('2026-09-30T15:00:00.000Z'),
          },
          artist: { status: 'active' },
        },
      }),
    );
    expect(result.rankings.map((row) => row.artist.slug)).toEqual(['oh-hyerin']);
    expect(JSON.stringify(result.rankings)).not.toContain('hidden-character');
  });

  it('has no monthly winner before the first vote, even with active artists', async () => {
    const { service, prisma } = createHarness();
    prisma.boostCampaign.findFirst.mockResolvedValue(campaign);
    prisma.artist.findMany.mockResolvedValue([yoonSerin, ohHyerin]);
    prisma.artistBoostEvent.findMany.mockResolvedValue([]);

    const result = await service.getMainPick();

    expect(result.leader).toBeNull();
    expect(result.rankings).toHaveLength(2);
  });

  it('uses the new KST month at midnight rather than the previous campaign total', async () => {
    jest.setSystemTime(new Date('2026-09-30T15:00:00.000Z'));
    const { service, prisma } = createHarness();
    prisma.boostCampaign.findFirst.mockResolvedValue(campaign);
    prisma.artist.findMany.mockResolvedValue([yoonSerin]);
    prisma.artistBoostEvent.findMany.mockResolvedValue([]);

    await service.getMainPick();

    expect(prisma.artistBoostEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        campaignId: campaign.id,
        createdAt: {
          gte: new Date('2026-09-30T15:00:00.000Z'),
          lt: new Date('2026-10-31T15:00:00.000Z'),
        },
        artist: { status: 'active' },
      },
    }));
    expect(prisma.monthlyPickWinner.createMany).not.toHaveBeenCalled();
  });

  it('does not announce an annual champion before the year is over', async () => {
    const { service, prisma } = createHarness();
    prisma.artist.findMany.mockResolvedValue([yoonSerin]);
    prisma.artistBoostEvent.findMany.mockResolvedValue([{
      artistId: yoonSerin.id,
      artist: yoonSerin,
      boostType: 'free_like',
      rawAmount: new Decimal(1),
      weightedScore: new Decimal(1),
    }]);

    const result = await service.getYearChampion({ year: '2026' });

    expect(result.champion).toBeNull();
    expect(result.rankings[0].artist.slug).toBe('yoon-serin');
  });

  it('publishes the cross-lane public artist ranking projection contract', () => {
    expect(PUBLIC_ARTIST_RANKING_PROJECTION_CONTRACT).toMatchObject({
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
    });
  });
});

describe('PopularVoteService monthly archival', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-30T15:05:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('archives the previous KST month with positive votes and keeps reads write-free', async () => {
    const { service, prisma } = createHarness();
    prisma.artistBoostEvent.findFirst.mockResolvedValue({
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    prisma.boostCampaign.findMany.mockResolvedValue([campaign]);
    prisma.artist.findMany.mockResolvedValue([yoonSerin, ohHyerin]);
    prisma.artistBoostEvent.findMany.mockResolvedValue([{
      artistId: yoonSerin.id,
      artist: yoonSerin,
      boostType: 'free_like',
      rawAmount: new Decimal(3),
      weightedScore: new Decimal(3),
    }]);

    await service.archiveCompletedMonths();

    expect(prisma.boostCampaign.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        startsAt: { lt: new Date('2026-09-30T15:00:00.000Z') },
        endsAt: { gt: new Date('2026-08-31T15:00:00.000Z') },
      },
    }));
    expect(prisma.monthlyPickWinner.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        year: 2026,
        month: 9,
        campaignId: campaign.id,
        artistId: yoonSerin.id,
        metadata: { source: 'automatic_kst_rollover' },
      })],
      skipDuplicates: true,
    });
    expect(prisma.monthlyPickWinner.createMany.mock.calls[0][0].data[0]
      .totalWeightedScore.toString()).toBe('3');
  });

  it('waits for the archival grace period after the public reset', async () => {
    jest.setSystemTime(new Date('2026-09-30T15:04:59.999Z'));
    const { service, prisma } = createHarness();
    prisma.artistBoostEvent.findFirst.mockResolvedValue({
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    });

    await service.archiveCompletedMonths();

    expect(prisma.boostCampaign.findMany).not.toHaveBeenCalled();
    expect(prisma.monthlyPickWinner.createMany).not.toHaveBeenCalled();
  });

  it('does not invent a winner for an empty or zero-score month', async () => {
    const { service, prisma } = createHarness();
    prisma.artistBoostEvent.findFirst.mockResolvedValue({
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    prisma.boostCampaign.findMany.mockResolvedValue([campaign]);
    prisma.artist.findMany.mockResolvedValue([yoonSerin]);
    prisma.artistBoostEvent.findMany.mockResolvedValue([{
      artistId: yoonSerin.id,
      artist: yoonSerin,
      boostType: 'free_like',
      rawAmount: new Decimal(0),
      weightedScore: new Decimal(0),
    }]);

    await service.archiveCompletedMonths();

    expect(prisma.monthlyPickWinner.createMany).not.toHaveBeenCalled();
  });

  it('selects the strongest positive campaign when campaigns overlap', async () => {
    const { service, prisma } = createHarness();
    const newerCampaign = { ...campaign, id: '33333333-3333-4333-8333-333333333333' };
    prisma.artistBoostEvent.findFirst.mockResolvedValue({
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    prisma.boostCampaign.findMany.mockResolvedValue([newerCampaign, campaign]);
    prisma.artist.findMany.mockResolvedValue([yoonSerin, ohHyerin]);
    prisma.artistBoostEvent.findMany.mockImplementation(({ where }) => Promise.resolve(
      where.campaignId === newerCampaign.id ? [] : [{
        artistId: ohHyerin.id,
        artist: ohHyerin,
        boostType: 'free_like',
        rawAmount: new Decimal(2),
        weightedScore: new Decimal(2),
      }],
    ));

    await service.archiveCompletedMonths();

    expect(prisma.monthlyPickWinner.createMany.mock.calls[0][0].data[0])
      .toMatchObject({ campaignId: campaign.id, artistId: ohHyerin.id });
  });

  it('catches up across a year boundary and does not overwrite an archived month', async () => {
    jest.setSystemTime(new Date('2027-02-01T00:00:00.000Z'));
    const { service, prisma } = createHarness();
    prisma.artistBoostEvent.findFirst.mockResolvedValue({
      createdAt: new Date('2026-12-31T14:00:00.000Z'),
    });
    prisma.monthlyPickWinner.findUnique.mockImplementation(({ where }) =>
      where.year_month.month === 12 ? Promise.resolve({ id: 'existing' }) : Promise.resolve(null));
    prisma.boostCampaign.findMany.mockResolvedValue([campaign]);
    prisma.artist.findMany.mockResolvedValue([ohHyerin]);
    prisma.artistBoostEvent.findMany.mockResolvedValue([{
      artistId: ohHyerin.id,
      artist: ohHyerin,
      boostType: 'free_like',
      rawAmount: new Decimal(1),
      weightedScore: new Decimal(1),
    }]);

    await service.archiveCompletedMonths();

    expect(prisma.monthlyPickWinner.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.monthlyPickWinner.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.monthlyPickWinner.createMany.mock.calls[0][0].data[0])
      .toMatchObject({ year: 2027, month: 1 });
  });

  it('preserves an existing manual award without recomputing or auditing', async () => {
    const { service, prisma } = createHarness();
    const existing = { id: 'existing', artistId: ohHyerin.id };
    prisma.monthlyPickWinner.findUnique.mockResolvedValue(existing);

    const result = await service.finalizeMonthlyPick({ id: 'admin' }, { year: 2026, month: 9 });

    expect(result).toEqual({ winner: existing, rankings: [] });
    expect(prisma.monthlyPickWinner.createMany).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('handles a competing insert without changing the winning award or auditing twice', async () => {
    const { service, prisma } = createHarness();
    const existing = { id: 'existing', artistId: ohHyerin.id };
    prisma.boostCampaign.findFirst.mockResolvedValue(campaign);
    prisma.artist.findMany.mockResolvedValue([yoonSerin]);
    prisma.artistBoostEvent.findMany.mockResolvedValue([{
      artistId: yoonSerin.id,
      artist: yoonSerin,
      boostType: 'free_like',
      rawAmount: new Decimal(1),
      weightedScore: new Decimal(1),
    }]);
    prisma.monthlyPickWinner.createMany.mockResolvedValue({ count: 0 });
    prisma.monthlyPickWinner.findUniqueOrThrow.mockResolvedValue(existing);

    const result = await service.finalizeMonthlyPick({ id: 'admin' }, { year: 2026, month: 9 });

    expect(result).toEqual({ winner: existing, rankings: [] });
    expect(prisma.monthlyPickWinner.createMany).toHaveBeenCalledWith(expect.objectContaining({
      skipDuplicates: true,
    }));
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects finalization before the KST month is complete', async () => {
    const { service, prisma } = createHarness();
    await expect(service.finalizeMonthlyPick({ id: 'admin' }, { year: 2026, month: 10 }))
      .rejects.toThrow('Only settled KST months');
    expect(prisma.monthlyPickWinner.createMany).not.toHaveBeenCalled();
  });

  it('rejects early manual finalization during the archival grace window', async () => {
    jest.setSystemTime(new Date('2026-09-30T15:04:59.999Z'));
    const { service, prisma } = createHarness();
    await expect(service.finalizeMonthlyPick({ id: 'admin' }, { year: 2026, month: 9 }))
      .rejects.toThrow('Only settled KST months');
    expect(prisma.monthlyPickWinner.createMany).not.toHaveBeenCalled();
  });

  it('rejects an unrelated campaign and a partial month', async () => {
    const { service, prisma } = createHarness();
    prisma.boostCampaign.findUnique.mockResolvedValue({
      ...campaign,
      startsAt: new Date('2026-10-01T00:00:00.000Z'),
    });
    await expect(service.finalizeMonthlyPick({ id: 'admin' }, { year: 2026 }))
      .rejects.toThrow('year and month must be provided together');
    await expect(service.finalizeMonthlyPick({ id: 'admin' }, {
      campaignId: campaign.id, year: 2026, month: 9,
    })).rejects.toThrow('does not overlap');
    expect(prisma.monthlyPickWinner.createMany).not.toHaveBeenCalled();
  });
});

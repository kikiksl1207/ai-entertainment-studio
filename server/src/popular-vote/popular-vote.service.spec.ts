import { Decimal } from '@prisma/client/runtime/library';
import {
  PUBLIC_ARTIST_RANKING_PROJECTION_CONTRACT,
  PopularVoteService,
} from './popular-vote.service';

const campaign = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'mvp-launch-main-pick',
  name: 'Lumina Pick',
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
    },
    artistBoostEvent: {
      findMany: jest.fn(),
    },
    artist: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    monthlyPickWinner: {
      findMany: jest.fn(),
      upsert: jest.fn(),
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
          artist: { status: 'active' },
        },
      }),
    );
    expect(result.rankings.map((row) => row.artist.slug)).toEqual(['oh-hyerin']);
    expect(JSON.stringify(result.rankings)).not.toContain('hidden-character');
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

import { Decimal } from '@prisma/client/runtime/library';
import { PopularVoteService } from './popular-vote.service';

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
  it('keeps active zero-score artists visible in the read-only main-pick projection', async () => {
    const { service, prisma } = createHarness();
    prisma.boostCampaign.findFirst.mockResolvedValue(campaign);
    prisma.artist.findMany.mockResolvedValue([yoonSerin, ohHyerin]);
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
    ]);
    expect(result.rankings[1]).toMatchObject({
      rankNo: 2,
      artist: ohHyerin,
    });
    expect(result.rankings[1].totalFreeLikes.toString()).toBe('0');
    expect(result.rankings[1].totalWeightedScore.toString()).toBe('0');
    expect(prisma.artist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'active' } }),
    );
  });
});

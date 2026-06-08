import { BadRequestException, ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { BoostsService } from './boosts.service';

const campaign = {
  id: '11111111-1111-4111-8111-111111111111',
  freeLikeWeight: new Decimal(1),
  luminaBoostWeight: new Decimal(1),
  dailyFreeLikeLimit: 1,
};
const artist = {
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'luna',
  displayName: 'Luna',
};
const boostProduct = {
  id: '33333333-3333-4333-8333-333333333333',
  sku: 'BOOST_BASIC_VOTE',
  name: 'Basic vote',
  priceLumina: new Decimal(10),
  boostAmount: new Decimal(1),
};
const wallet = {
  id: '44444444-4444-4444-8444-444444444444',
  status: 'active',
  cachedBalance: new Decimal(100),
};

function createHarness() {
  const tx = {
    artistBoostEvent: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    walletAccount: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    walletLedger: {
      create: jest.fn(),
    },
  };
  const prisma = {
    boostCampaign: {
      findFirst: jest.fn(),
    },
    artist: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    boostProduct: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    artistBoostEvent: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };

  return {
    tx,
    prisma,
    service: new BoostsService(prisma as never),
  };
}

describe('BoostsService wallet mutation safety', () => {
  it('requires an idempotency key before a paid-like wallet mutation', async () => {
    const { service, prisma } = createHarness();

    await expect(
      service.createPaidLike('user-1', {
        campaignId: campaign.id,
        artistId: artist.id,
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createPaidLike('user-1', {
        campaignId: campaign.id,
        artistId: artist.id,
        quantity: 1,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'BOOST_IDEMPOTENCY_REQUIRED',
        messageKey: 'boost.error.idempotencyRequired',
        walletMutation: false,
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('replays a paid-like idempotency key without another debit', async () => {
    const { service, prisma, tx } = createHarness();
    prisma.boostCampaign.findFirst.mockResolvedValue(campaign);
    prisma.artist.findFirst.mockResolvedValue(artist);
    prisma.boostProduct.findFirst.mockResolvedValue(boostProduct);
    tx.artistBoostEvent.findUnique.mockResolvedValue({
      id: 'event-1',
      userId: 'user-1',
      campaignId: campaign.id,
      artistId: artist.id,
      boostType: 'lumina_boost',
      boostProductId: boostProduct.id,
      walletLedgerId: 'ledger-1',
      metadata: { source: 'paid_like', quantity: 2 },
    });
    tx.walletAccount.findFirst.mockResolvedValue(wallet);

    const result = await service.createPaidLike('user-1', {
      campaignId: campaign.id,
      artistId: artist.id,
      quantity: 2,
      idempotencyKey: 'paid-like-1',
    });

    expect(result).toMatchObject({ idempotentReplay: true });
    expect(tx.walletAccount.updateMany).not.toHaveBeenCalled();
    expect(tx.walletLedger.create).not.toHaveBeenCalled();
    expect(tx.artistBoostEvent.create).not.toHaveBeenCalled();
  });

  it('rejects paid-like idempotency key reuse with a different body', async () => {
    const { service, prisma, tx } = createHarness();
    prisma.boostCampaign.findFirst.mockResolvedValue(campaign);
    prisma.artist.findFirst.mockResolvedValue(artist);
    prisma.boostProduct.findFirst.mockResolvedValue(boostProduct);
    tx.artistBoostEvent.findUnique.mockResolvedValue({
      id: 'event-1',
      userId: 'user-1',
      campaignId: campaign.id,
      artistId: '99999999-9999-4999-8999-999999999999',
      boostType: 'lumina_boost',
      boostProductId: boostProduct.id,
      walletLedgerId: 'ledger-1',
      metadata: { source: 'paid_like', quantity: 1 },
    });

    await expect(
      service.createPaidLike('user-1', {
        campaignId: campaign.id,
        artistId: artist.id,
        quantity: 1,
        idempotencyKey: 'paid-like-1',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'BOOST_IDEMPOTENCY_CONFLICT',
        messageKey: 'boost.error.idempotencyConflict',
        walletMutation: false,
      },
    });
    await expect(
      service.createPaidLike('user-1', {
        campaignId: campaign.id,
        artistId: artist.id,
        quantity: 1,
        idempotencyKey: 'paid-like-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.walletAccount.updateMany).not.toHaveBeenCalled();
  });

  it('debits paid-like only with a balance guard and scoped ledger key', async () => {
    const { service, prisma, tx } = createHarness();
    prisma.boostCampaign.findFirst.mockResolvedValue(campaign);
    prisma.artist.findFirst.mockResolvedValue(artist);
    prisma.boostProduct.findFirst.mockResolvedValue(boostProduct);
    tx.artistBoostEvent.findUnique.mockResolvedValue(null);
    tx.artistBoostEvent.findMany.mockResolvedValue([]);
    tx.walletAccount.findUnique
      .mockResolvedValueOnce(wallet)
      .mockResolvedValueOnce({ ...wallet, cachedBalance: new Decimal(90) });
    tx.walletAccount.updateMany.mockResolvedValue({ count: 1 });
    tx.walletLedger.create.mockResolvedValue({ id: 'ledger-1' });
    tx.artistBoostEvent.create.mockResolvedValue({ id: 'event-1' });

    await expect(
      service.createPaidLike('user-1', {
        campaignId: campaign.id,
        artistId: artist.id,
        quantity: 1,
        idempotencyKey: 'paid-like-1',
      }),
    ).resolves.toMatchObject({ idempotentReplay: false });

    expect(tx.walletAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: wallet.id,
          cachedBalance: { gte: new Decimal(10) },
        }),
        data: { cachedBalance: { decrement: new Decimal(10) } },
      }),
    );
    expect(tx.walletLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: 'wallet:boost-paid-like:paid-like-1',
        }),
      }),
    );
    expect(tx.artistBoostEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          boostType: 'lumina_boost',
          metadata: {
            path: ['source'],
            equals: 'paid_like',
          },
        }),
      }),
    );
    expect(tx.artistBoostEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          artistId: artist.id,
          boostType: 'lumina_boost',
          metadata: expect.objectContaining({ source: 'paid_like' }),
        }),
      }),
    );
  });

  it('replays a matching free-like idempotency key without creating another ledger row', async () => {
    const { service, prisma, tx } = createHarness();
    prisma.boostCampaign.findFirst.mockResolvedValue(campaign);
    prisma.artist.findFirst.mockResolvedValue(artist);
    tx.artistBoostEvent.findUnique.mockResolvedValue({
      id: 'free-like-event-1',
      userId: 'user-1',
      campaignId: campaign.id,
      artistId: artist.id,
      boostType: 'free_like',
    });

    const result = await service.createFreeLike('user-1', {
      campaignId: campaign.id,
      artistId: artist.id,
      idempotencyKey: 'free-like-1',
    });

    expect(result).toMatchObject({ idempotentReplay: true });
    expect(tx.artistBoostEvent.count).not.toHaveBeenCalled();
    expect(tx.artistBoostEvent.create).not.toHaveBeenCalled();
  });

  it('rejects free-like idempotency key reuse with a different body', async () => {
    const { service, prisma, tx } = createHarness();
    prisma.boostCampaign.findFirst.mockResolvedValue(campaign);
    prisma.artist.findFirst.mockResolvedValue(artist);
    tx.artistBoostEvent.findUnique.mockResolvedValue({
      id: 'free-like-event-1',
      userId: 'user-1',
      campaignId: campaign.id,
      artistId: '99999999-9999-4999-8999-999999999999',
      boostType: 'free_like',
    });

    await expect(
      service.createFreeLike('user-1', {
        campaignId: campaign.id,
        artistId: artist.id,
        idempotencyKey: 'free-like-1',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'BOOST_IDEMPOTENCY_CONFLICT',
        messageKey: 'boost.error.idempotencyConflict',
        walletMutation: false,
      },
    });
    expect(tx.artistBoostEvent.count).not.toHaveBeenCalled();
    expect(tx.artistBoostEvent.create).not.toHaveBeenCalled();
  });

  it('builds refreshed like and paid-like counts from the server boost ledger', async () => {
    const { service, prisma } = createHarness();
    prisma.artist.findMany.mockResolvedValue([artist]);
    prisma.artistBoostEvent.findMany.mockResolvedValue([
      {
        artistId: artist.id,
        artist,
        boostType: 'free_like',
        rawAmount: new Decimal(1),
        weightedScore: new Decimal(1),
      },
      {
        artistId: artist.id,
        artist,
        boostType: 'lumina_boost',
        rawAmount: new Decimal(3),
        weightedScore: new Decimal(3),
        metadata: { source: 'paid_like' },
      },
    ]);

    const rankings = await service.getRankings(campaign.id);
    const [row] = rankings;

    expect(prisma.artistBoostEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          campaignId: campaign.id,
          artist: { status: 'active' },
        },
      }),
    );
    expect(prisma.artist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'active' } }),
    );
    expect(row.artist).toEqual(artist);
    expect(row.totalFreeLikes.toString()).toBe('1');
    expect(row.totalPaidLikes.toString()).toBe('3');
    expect(row.totalLuminaBoosts.toString()).toBe('3');
    expect(row.totalWeightedScore.toString()).toBe('4');
  });

  it('keeps active artists with zero likes visible in campaign rankings', async () => {
    const { service, prisma } = createHarness();
    const ohHyerin = {
      id: '55555555-5555-4555-8555-555555555555',
      slug: 'oh-hyerin',
      displayName: '오혜린',
    };
    prisma.artist.findMany.mockResolvedValue([artist, ohHyerin]);
    prisma.artistBoostEvent.findMany.mockResolvedValue([
      {
        artistId: artist.id,
        artist,
        boostType: 'free_like',
        rawAmount: new Decimal(1),
        weightedScore: new Decimal(1),
      },
    ]);

    const rankings = await service.getRankings(campaign.id);

    expect(rankings).toHaveLength(2);
    expect(rankings[0]).toMatchObject({
      rankNo: 1,
      artist,
    });
    expect(rankings[1].artist).toEqual(ohHyerin);
    expect(rankings[1].totalFreeLikes.toString()).toBe('0');
    expect(rankings[1].totalPaidLikes.toString()).toBe('0');
    expect(rankings[1].totalWeightedScore.toString()).toBe('0');
  });

  it('excludes pending or private artists from public campaign rankings even with legacy events', async () => {
    const { service, prisma } = createHarness();
    const pendingArtist = {
      id: '66666666-6666-4666-8666-666666666666',
      slug: 'pending-character',
      displayName: 'Pending Character',
    };
    prisma.artist.findMany.mockResolvedValue([artist]);
    prisma.artistBoostEvent.findMany.mockResolvedValue([
      {
        artistId: artist.id,
        artist,
        boostType: 'free_like',
        rawAmount: new Decimal(1),
        weightedScore: new Decimal(1),
      },
      {
        artistId: pendingArtist.id,
        artist: pendingArtist,
        boostType: 'lumina_boost',
        rawAmount: new Decimal(999),
        weightedScore: new Decimal(999),
      },
    ]);

    const rankings = await service.getRankings(campaign.id);

    expect(prisma.artistBoostEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          campaignId: campaign.id,
          artist: { status: 'active' },
        },
      }),
    );
    expect(rankings).toHaveLength(1);
    expect(rankings[0].artist).toEqual(artist);
    expect(JSON.stringify(rankings)).not.toContain('pending-character');
    expect(rankings[0].totalWeightedScore.toString()).toBe('1');
  });

  it('requires an idempotency key before a boost-order wallet mutation', async () => {
    const { service, prisma } = createHarness();

    await expect(
      service.createBoostOrder('user-1', {
        campaignId: campaign.id,
        artistId: artist.id,
        boostProductId: boostProduct.id,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'BOOST_IDEMPOTENCY_REQUIRED',
        messageKey: 'boost.error.idempotencyRequired',
        walletMutation: false,
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects boost-order idempotency key reuse with a different body', async () => {
    const { service, prisma, tx } = createHarness();
    prisma.boostCampaign.findFirst.mockResolvedValue(campaign);
    prisma.boostProduct.findFirst.mockResolvedValue(boostProduct);
    tx.artistBoostEvent.findUnique.mockResolvedValue({
      id: 'event-1',
      userId: 'user-1',
      campaignId: campaign.id,
      artistId: '99999999-9999-4999-8999-999999999999',
      boostType: 'lumina_boost',
      boostProductId: boostProduct.id,
      walletLedgerId: 'ledger-1',
      metadata: { source: 'boost_order' },
    });

    await expect(
      service.createBoostOrder('user-1', {
        campaignId: campaign.id,
        artistId: artist.id,
        boostProductId: boostProduct.id,
        idempotencyKey: 'boost-order-1',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'BOOST_IDEMPOTENCY_CONFLICT',
        messageKey: 'boost.error.idempotencyConflict',
        walletMutation: false,
      },
    });
    expect(tx.walletAccount.updateMany).not.toHaveBeenCalled();
  });
});

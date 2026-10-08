import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PopularVoteService } from './popular-vote.service';

function fixture() {
  const artist = { id: 'synthetic-artist', slug: 'synthetic-pick', displayName: 'Synthetic Pick' };
  const winner = { id: 'synthetic-award', artistId: artist.id };
  const tx = {
    monthlyPickWinner: { createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(winner) },
    auditEvent: { create: jest.fn().mockResolvedValue({ id: 'synthetic-audit' }) },
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    boostCampaign: { findFirst: jest.fn().mockResolvedValue({ id: 'synthetic-campaign',
      startsAt: new Date('2026-01-01T00:00:00Z'), endsAt: new Date('2027-01-01T00:00:00Z') }) },
    artist: { findMany: jest.fn().mockResolvedValue([artist]) },
    artistBoostEvent: { findMany: jest.fn().mockResolvedValue([{ artistId: artist.id, artist,
      boostType: 'free_like', rawAmount: new Decimal(2), weightedScore: new Decimal(2) }]) },
    monthlyPickWinner: { findUnique: jest.fn().mockResolvedValue(null), createMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    auditEvent: { create: jest.fn() },
  };
  return { tx, prisma, winner, service: new PopularVoteService(prisma as never) };
}

describe('manual monthly pick atomic winner and audit', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-10-02T00:00:00Z')));
  afterEach(() => jest.useRealTimers());

  test('winner receipt and one audit use the same ReadCommitted transaction, not root writes', async () => {
    const { service, tx, prisma, winner } = fixture();
    const result = await service.finalizeMonthlyPick({ id: 'synthetic-admin' }, { year: 2026, month: 9 });
    expect(result.winner).toBe(winner);
    expect(result.rankings).toHaveLength(1);
    expect(result.rankings[0].totalWeightedScore.toString()).toBe('2');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
    expect(tx.monthlyPickWinner.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    expect(tx.monthlyPickWinner.findUniqueOrThrow.mock.invocationCallOrder[0]).toBeGreaterThan(tx.monthlyPickWinner.createMany.mock.invocationCallOrder[0]);
    expect(tx.auditEvent.create.mock.invocationCallOrder[0]).toBeGreaterThan(tx.monthlyPickWinner.findUniqueOrThrow.mock.invocationCallOrder[0]);
    expect(tx.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorUserId: 'synthetic-admin', actorType: 'admin', action: 'popular_vote.monthly_pick.finalize',
      targetId: winner.id, targetType: 'monthly_pick_winner',
      metadata: { campaignId: 'synthetic-campaign', year: 2026, month: 9, artistId: 'synthetic-artist' },
    }) });
    expect(prisma.monthlyPickWinner.createMany).not.toHaveBeenCalled();
    expect(prisma.monthlyPickWinner.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  test('a competing winner is returned without a second audit or overwritten ranking receipt', async () => {
    const { service, tx, winner } = fixture();
    tx.monthlyPickWinner.createMany.mockResolvedValue({ count: 0 });
    expect(await service.finalizeMonthlyPick({ id: 'synthetic-admin' }, { year: 2026, month: 9 }))
      .toEqual({ winner, rankings: [] });
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  test('an existing award remains a write-free fast path', async () => {
    const { service, tx, prisma, winner } = fixture();
    prisma.monthlyPickWinner.findUnique.mockResolvedValue(winner as never);
    expect(await service.finalizeMonthlyPick({ id: 'synthetic-admin' }, { year: 2026, month: 9 }))
      .toEqual({ winner, rankings: [] });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
    expect(prisma.artistBoostEvent.findMany).not.toHaveBeenCalled();
  });

  test.each(['insert', 'read', 'audit', 'transaction'])('%s failure rejects the whole transaction without retrying', async boundary => {
    const { service, tx, prisma } = fixture();
    const error = new Error('synthetic monthly persistence failure');
    if (boundary === 'insert') tx.monthlyPickWinner.createMany.mockRejectedValue(error);
    if (boundary === 'read') tx.monthlyPickWinner.findUniqueOrThrow.mockRejectedValue(error);
    if (boundary === 'audit') tx.auditEvent.create.mockRejectedValue(error);
    if (boundary === 'transaction') prisma.$transaction.mockRejectedValue(error);
    await expect(service.finalizeMonthlyPick({ id: 'synthetic-admin' }, { year: 2026, month: 9 })).rejects.toBe(error);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    if (boundary === 'insert' || boundary === 'read') expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  test.each([{ year: 2026 }, { year: 2026, month: 0 }, { year: 2026, month: 13 },
    { year: 2026, month: 10 }, { year: 2027, month: 1 }])('invalid or unsettled %j never begins a write', async input => {
    const { service, tx, prisma } = fixture();
    await expect(service.finalizeMonthlyPick({ id: 'synthetic-admin' }, input)).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });
});

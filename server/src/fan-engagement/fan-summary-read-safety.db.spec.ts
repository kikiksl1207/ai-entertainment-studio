import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { FanEngagementService } from './fan-engagement.service';

describe('fan summary read boundary', () => {
  test('query failure propagates instead of using the recent ledger as a false total', async () => {
    const error = new Error('isolated summary read failed');
    const prisma = { $transaction: jest.fn().mockRejectedValue(error) };
    const service = new FanEngagementService(prisma as never);
    await expect(service.getMySummary(randomUUID(), {})).rejects.toBe(error);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  });
});

const run = process.env.RUN_FAN_SUMMARY_DB_QA === '1' ? describe : describe.skip;
run('isolated PostgreSQL full fan points and KST participation summary', () => {
  const users = Array.from({ length: 6 }, () => randomUUID());
  const missionId = randomUUID();
  let db: PrismaClient;
  let service: FanEngagementService;
  const now = new Date();
  const kstDate = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  const todayStart = new Date(`${kstDate}T00:00:00+09:00`).getTime();
  const day = 86400000;

  beforeAll(async () => {
    const url = new URL(process.env.FAN_SUMMARY_QA_DATABASE_URL || '');
    if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/lumina_story_qa') {
      throw new Error('Only the named local isolated QA database is allowed');
    }
    db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    await db.$connect();
    const names = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (names[0]?.name !== 'lumina_story_qa') throw new Error('Unexpected database');
    await db.user.createMany({ data: users.map(id => ({ id })) });
    await db.fanMission.create({ data: {
      id: missionId, slug: `isolated-summary-${missionId}`, missionType: 'qa_summary', actionType: 'one_tap',
      resetPolicy: 'once', startsAt: now, endsAt: new Date(now.getTime() + day),
    } });
    service = new FanEngagementService(db as never);
  });

  afterAll(async () => {
    if (!db) return;
    try {
      await db.fanEngagementPointLedger.deleteMany({ where: { userId: { in: users } } });
      await db.fanMissionParticipation.deleteMany({ where: { userId: { in: users } } });
      await db.fanMission.deleteMany({ where: { id: missionId } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      expect(await db.fanEngagementPointLedger.count({ where: { userId: { in: users } } })).toBe(0);
      expect(await db.fanMissionParticipation.count({ where: { userId: { in: users } } })).toBe(0);
      expect(await db.fanMission.count({ where: { id: missionId } })).toBe(0);
      expect(await db.user.count({ where: { id: { in: users } } })).toBe(0);
    } finally { await db.$disconnect(); }
  });

  async function participation(userId: string, createdAt: Date, status = 'accepted') {
    return db.fanMissionParticipation.create({ data: {
      missionId, userId, participationType: 'qa_summary', resetBucket: randomUUID(), status, createdAt,
    } });
  }

  test('over twenty entries use full totals with spending/adjustment, isolate users and ignore future records', async () => {
    await db.fanEngagementPointLedger.createMany({ data: [
      ...Array.from({ length: 40 }, () => ({ userId: users[0], points: 3, direction: 'earn', createdAt: now })),
      { userId: users[0], points: 10, direction: 'spend', createdAt: now },
      { userId: users[0], points: 2, direction: 'adjustment', createdAt: now },
      { userId: users[0], points: 500, direction: 'earn', createdAt: new Date(now.getTime() + day) },
      { userId: users[4], points: 500, direction: 'earn', createdAt: now },
    ].map(row => ({ ...row, ledgerType: 'qa_summary', referenceType: 'isolated_qa', referenceId: randomUUID() })) });
    const result = await service.getMySummary(users[0], {});
    expect(result.points).toEqual({ balance: 112, lifetimeEarned: 120, cashLike: false, transferable: false, settlementEligible: false, luminaConvertible: false });
    expect(result.recentLedger).toHaveLength(20);
    expect(result.recentLedger.some(row => row.points === 500)).toBe(false);
    expect(result.participationSummary).toEqual({ completedTodayCount: 0, currentStreakDays: 0, totalAcceptedCount: 0 });
  });

  test('more than one hundred accepted rows count once/weekly activity by actual KST dates, not reset buckets', async () => {
    const todayActivity = new Date(Math.min(now.getTime(), todayStart + 60000));
    await db.fanMissionParticipation.createMany({ data: [
      ...Array.from({ length: 101 }, () => ({ createdAt: todayActivity })),
      { createdAt: new Date(todayStart - day + 60000) },
      { createdAt: new Date(todayStart - 2 * day + 60000) },
    ].map(row => ({ ...row, missionId, userId: users[1], participationType: 'qa_summary', resetBucket: randomUUID() })) });
    const result = await service.getMySummary(users[1], { locale: 'en' });
    expect(result.participationSummary).toEqual({ completedTodayCount: 101, currentStreakDays: 3, totalAcceptedCount: 103 });
    expect(result.points.balance).toBe(0);
  });

  test('yesterday anchors an ongoing streak, a missing day breaks it, and old streaks return zero', async () => {
    for (const ago of [1, 2, 4, 5]) await participation(users[2], new Date(todayStart - ago * day + 60000));
    expect((await service.getMySummary(users[2], {})).participationSummary).toEqual({ completedTodayCount: 0, currentStreakDays: 2, totalAcceptedCount: 4 });
    for (const ago of [3, 4]) await participation(users[4], new Date(todayStart - ago * day + 60000));
    expect((await service.getMySummary(users[4], {})).participationSummary.currentStreakDays).toBe(0);
  });

  test('KST midnight, repeated activity, nonaccepted and future records do not inflate a streak', async () => {
    await participation(users[3], new Date(todayStart - 1000));
    await participation(users[3], new Date(todayStart));
    await participation(users[3], new Date(todayStart));
    await participation(users[3], new Date(todayStart - 2 * day), 'rejected');
    await participation(users[3], new Date(todayStart + day));
    const result = await service.getMySummary(users[3], {});
    expect(result.participationSummary).toEqual({ completedTodayCount: 2, currentStreakDays: 2, totalAcceptedCount: 3 });
    await db.fanEngagementPointLedger.create({ data: { userId: users[3], points: 4, direction: 'spend', ledgerType: 'qa_summary', referenceType: 'isolated_qa', referenceId: randomUUID() } });
    expect((await service.getMySummary(users[3], {})).points).toMatchObject({ balance: -4, lifetimeEarned: 0 });
  });

  test('a committed write between summary reads is visible only in the next snapshot', async () => {
    const data = {
      userId: users[5], points: 7, direction: 'earn', ledgerType: 'qa_summary',
      referenceType: 'isolated_qa', referenceId: randomUUID(), createdAt: new Date(now.getTime() - 1000),
    };
    await db.fanEngagementPointLedger.create({ data });
    let firstReadDone!: () => void;
    const firstRead = new Promise<void>(resolve => { firstReadDone = resolve; });
    let inserted = false;
    const controlledService = new FanEngagementService({
      $transaction: (
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options: { isolationLevel: Prisma.TransactionIsolationLevel },
      ) => db.$transaction(async tx => {
        // All reads are real SQL; gate the aggregate until another connection commits a new entry.
        const ledger = Object.assign({}, tx.fanEngagementPointLedger, {
          findMany: async (args: Prisma.FanEngagementPointLedgerFindManyArgs) => {
            const rows = await tx.fanEngagementPointLedger.findMany(args);
            firstReadDone();
            return rows;
          },
          groupBy: async (args: {
            by: ['direction']; where: Prisma.FanEngagementPointLedgerWhereInput; _sum: { points: true };
          }) => {
            await firstRead;
            await db.fanEngagementPointLedger.create({ data: { ...data, points: 11, referenceId: randomUUID() } });
            inserted = true;
            return tx.fanEngagementPointLedger.groupBy(args);
          },
        });
        return callback(Object.assign({}, tx, { fanEngagementPointLedger: ledger }) as Prisma.TransactionClient);
      }, options),
    } as never);
    const snapshot = await controlledService.getMySummary(users[5], {});
    expect(inserted).toBe(true);
    expect(snapshot.recentLedger).toHaveLength(1);
    expect(snapshot.points).toMatchObject({ balance: 7, lifetimeEarned: 7 });
    const fresh = await service.getMySummary(users[5], {});
    expect(fresh.recentLedger).toHaveLength(2);
    expect(fresh.points).toMatchObject({ balance: 18, lifetimeEarned: 18 });
  });
});

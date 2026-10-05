import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AdminUsersReadService } from './admin-users-read.service';
import { PrismaService } from '../prisma/prisma.service';

const firstId = '00000000-0000-4000-8000-000000000002';
const secondId = '00000000-0000-4000-8000-000000000001';

function account(id = firstId) {
  return {
    id, email: 'qa-looking-name@example.test', phoneNumber: null, status: 'active',
    createdAt: new Date('2026-09-30'), updatedAt: new Date('2026-09-30'), deletedAt: null,
    profile: { displayName: 'TEST is not a classification', publicHandle: 'handle' },
    authAccounts: [], walletAccounts: [],
    _count: { refreshTokens: 0, paymentOrders: 0, communityPosts: 0, communityReports: 0,
      artistFollows: 0, followingUsers: 0, followers: 0 },
  };
}

function fixture(rows = [account()]) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: {
      count: jest.fn().mockResolvedValue(0).mockResolvedValueOnce(87).mockResolvedValueOnce(2),
      findMany: jest.fn().mockResolvedValue(rows), findFirst: jest.fn().mockResolvedValue({ id: firstId }),
    },
    communityReport: { findMany: jest.fn().mockResolvedValue([]) },
    auditEvent: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
    paymentOrder: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
  };
  const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
  return { tx, prisma, service: new AdminUsersReadService(prisma as unknown as PrismaService) };
}

function expectPageEnrichmentQuery(query: Prisma.Sql, ids: string[]) {
  const sql = query.sql.replace(/\s+/g, ' ').trim();
  expect(query.values).toEqual(ids);
  expect(sql.match(/\?::uuid/g)).toHaveLength(ids.length);
  for (const id of ids) expect(sql).not.toContain(id);
  expect(sql).toContain('COUNT(*) AS report_count, COUNT(*) FILTER (WHERE report.status IN (\'submitted\', \'reviewing\')) AS open_report_count');
  expect(sql).toContain('FROM community_reports AS report JOIN community_posts AS post ON post.id = report.post_id JOIN page_users AS page ON page.id = post.author_user_id GROUP BY post.author_user_id');
  expect(sql).toContain('LEFT JOIN report_totals AS totals ON totals.user_id = page.id');
  expect(sql.match(/LEFT JOIN LATERAL/g)).toHaveLength(3);
  expect(sql).toContain('WHERE post.author_user_id = page.id ORDER BY report.created_at DESC, report.id DESC LIMIT 1 ) AS latest_report ON TRUE');
  expect(sql).toContain('WHERE event.target_type = \'user\' AND event.target_id = page.id ORDER BY event.created_at DESC, event.id DESC LIMIT 1 ) AS latest_action ON TRUE');
  expect(sql).toContain('WHERE orders.user_id = page.id ORDER BY orders.created_at DESC, orders.id DESC LIMIT 1 ) AS latest_order ON TRUE');
}

describe('AdminUsersReadService (synthetic Prisma unit fixtures)', () => {
  it('returns DB-wide and filtered counts without classifying names or emails', async () => {
    const { service, tx, prisma } = fixture();
    const result = await service.getBackstageUsersOverview({ query: ' TEST ' });
    expect(result).toMatchObject({ totalAccounts: 87, filteredAccounts: 2, count: 1,
      policy: { source: 'users', testAccountsIncluded: true, deletedAccountsIncluded: true, accountClassification: 'explicit_admin', realCustomerInference: false } });
    expect(result.items[0]).not.toHaveProperty('isTestAccount');
    expect(result.items[0]).not.toHaveProperty('isRealUser');
    expect(result.items[0].lastSeenAt).toBeNull();
    expect(tx.user.count.mock.calls[0]).toEqual([]);
    const where = tx.user.findMany.mock.calls[0][0].where;
    expect(tx.user.count).toHaveBeenNthCalledWith(2, { where });
    expect(where.OR).toHaveLength(4);
    expect(where.OR[0]).toEqual({ email: { contains: 'TEST', mode: 'insensitive' } });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' });
  });

  it('fetches one lookahead row and uses deterministic timestamp/id ordering', async () => {
    const { service, tx } = fixture([account(firstId), account(secondId)]);
    const result = await service.getBackstageUsersOverview({ take: '1' });
    expect(result).toMatchObject({ count: 1, hasMore: true, nextCursor: firstId });
    expect(tx.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }));
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.calls[0][0].values).toEqual([firstId]);
    expect(tx.communityReport.findMany).not.toHaveBeenCalled();
  });

  it('uses the same server filters for cursor validation, search, and result counts', async () => {
    const { service, tx } = fixture([account(secondId)]);
    const result = await service.getBackstageUsersOverview({ cursor: firstId, take: '1', email: 'USER@', status: 'suspended' });
    expect(result).toMatchObject({ hasMore: false, nextCursor: null });
    const args = tx.user.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ cursor: { id: firstId }, skip: 1,
      where: { status: 'suspended', email: { contains: 'USER@', mode: 'insensitive' } } });
    expect(tx.user.findFirst).toHaveBeenCalledWith({ where: { AND: [args.where, { id: firstId }] }, select: { id: true } });
  });

  it('supports an exact user UUID and q alias without changing account data', async () => {
    const { service, tx } = fixture();
    await service.getBackstageUsersOverview({ q: firstId });
    expect(tx.user.findMany.mock.calls[0][0].where.OR).toContainEqual({ id: firstId });
  });

  it('reports an empty page as empty, while preserving the global count', async () => {
    const { service, tx } = fixture([]);
    const result = await service.getBackstageUsersOverview({ query: 'no-match' });
    expect(result).toMatchObject({ items: [], count: 0, hasMore: false, nextCursor: null, totalAccounts: 87 });
    expect(tx.communityReport.findMany).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.auditEvent.groupBy).not.toHaveBeenCalled();
    expect(tx.paymentOrder.groupBy).not.toHaveBeenCalled();
    expect(tx.auditEvent.findMany).not.toHaveBeenCalled();
    expect(tx.paymentOrder.findMany).not.toHaveBeenCalled();
  });

  it.each(['NaN', '1.5', '0', '-1', '101', 'Infinity', ''])('rejects invalid take %p before reading DB', async (take) => {
    const { service, prisma } = fixture();
    await expect(service.getBackstageUsersOverview({ take })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects malformed and expired/filter-mismatched cursors', async () => {
    const { service, tx } = fixture();
    await expect(service.getBackstageUsersOverview({ cursor: 'bad' })).rejects.toBeInstanceOf(BadRequestException);
    tx.user.findFirst.mockResolvedValue(null);
    await expect(service.getBackstageUsersOverview({ cursor: firstId })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.user.findMany).not.toHaveBeenCalled();
  });

  it('uses all-time aggregate sanctions/payments and sums only KRW into the KRW field', async () => {
    const { service, tx } = fixture();
    tx.auditEvent.groupBy.mockResolvedValue([{ targetId: firstId, _count: { _all: 39 } }]);
    tx.paymentOrder.groupBy.mockResolvedValueOnce([{ userId: firstId, _count: { _all: 31 } }])
      .mockResolvedValueOnce([{ userId: firstId, _sum: { amount: new Prisma.Decimal(7200) } }]);
    const result = await service.getBackstageUsersOverview({});
    expect(result.items[0].sanctionCount).toBe(39);
    expect(result.items[0].paidOrderCount).toBe(31);
    expect(result.items[0].paidAmountKrw.toString()).toBe('7200');
  });

  it('keeps exact totals and latest records with long, uneven histories without reading the histories into the service', async () => {
    const emptyId = '00000000-0000-4000-8000-000000000003';
    const lookaheadId = '00000000-0000-4000-8000-000000000004';
    const rows = [account(firstId), account(secondId), account(emptyId), account(lookaheadId)];
    const { service, tx } = fixture(rows);
    const historyId = (prefix: string, index: number) => `${prefix}-0000-4000-8000-${String(index).padStart(12, '0')}`;
    const historyUser = (index: number) => index < 4000 ? firstId : index < 5500 ? secondId : lookaheadId;
    const historicalAt = new Date('2020-01-01');
    const latestAt = new Date('2026-09-30');
    const latestSecondAt = new Date('2021-01-01');
    const newestFirst = (a: { id: string; createdAt: Date }, b: { id: string; createdAt: Date }) =>
      b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id);
    const reports = Array.from({ length: 6000 }, (_, index) => ({
      id: historyId('10000000', index + 10),
      post: { id: `post-${historyUser(index)}-${index % 7}`, authorUserId: historyUser(index) },
      reporterUserId: secondId, status: ['submitted', 'reviewing', 'resolved', 'dismissed'][index % 4],
      reason: 'historical reason', createdAt: historicalAt,
    }));
    reports.push(
      { ...reports[0], id: historyId('10000000', 1), status: 'submitted', reason: 'lower ID tie', createdAt: latestAt },
      { ...reports[0], id: historyId('10000000', 2), status: 'resolved', reason: 'latest closed report', createdAt: latestAt },
      { ...reports[4000], id: historyId('10000000', 3), status: 'reviewing', reason: 'older second user latest', createdAt: latestSecondAt },
    );
    const actorUser = { id: firstId, email: 'admin@example.test' };
    const actions = Array.from({ length: 6000 }, (_, index) => ({
      id: historyId('20000000', index + 10), targetId: historyUser(index) as string | null, targetType: 'user',
      action: ['user.suspend', 'user.delete', 'user.restore', 'user.revoke_sessions'][index % 4],
      createdAt: historicalAt, actorUser: null as typeof actorUser | null,
    }));
    actions.push(
      { ...actions[0], id: historyId('20000000', 1), action: 'user.suspend', createdAt: latestAt },
      { ...actions[0], id: historyId('20000000', 2), action: 'user.restore', createdAt: latestAt, actorUser },
      { ...actions[4000], id: historyId('20000000', 3), action: 'user.revoke_sessions', createdAt: latestSecondAt },
      { ...actions[0], id: historyId('20000000', 4), targetType: 'artist', action: 'user.suspend', createdAt: new Date('2027-01-01') },
      { ...actions[0], id: historyId('20000000', 5), targetId: null, action: 'user.delete', createdAt: new Date('2027-01-01') },
    );
    const orders = Array.from({ length: 6000 }, (_, index) => ({
      id: historyId('30000000', index + 10), userId: historyUser(index), orderNo: `history-${index}`, provider: 'mock',
      status: ['paid', 'pending', 'paid', 'failed'][index % 4],
      amount: new Prisma.Decimal('1.25'), currency: index % 4 === 0 ? 'KRW' : `currency-${index}`, createdAt: historicalAt,
    }));
    orders.push(
      { ...orders[0], id: historyId('30000000', 1), orderNo: 'lower-ID-paid', amount: new Prisma.Decimal('250.50'), createdAt: latestAt },
      { ...orders[0], id: historyId('30000000', 2), orderNo: 'latest-pending', status: 'pending', currency: 'USD', amount: new Prisma.Decimal('90.10'), createdAt: latestAt },
      { ...orders[4000], id: historyId('30000000', 3), orderNo: 'second-paid', currency: 'EUR', amount: new Prisma.Decimal('3.25'), createdAt: latestSecondAt },
    );
    rows[0]._count.paymentOrders = 4002;
    rows[1]._count.paymentOrders = 1501;
    rows[1]._count.communityReports = reports.length;

    // Emulate only the SQL's reduced result; the service never receives these histories.
    tx.$queryRaw.mockImplementation(async (query: Prisma.Sql) => {
      expectPageEnrichmentQuery(query, [firstId, secondId, emptyId]);
      return query.values.map((value) => {
        const userId = String(value);
        const received = reports.filter((report) => report.post.authorUserId === userId);
        const latestReport = [...received].sort(newestFirst)[0];
        const latestAction = actions.filter((event) => event.targetType === 'user' && event.targetId === userId).sort(newestFirst)[0];
        const latestOrder = orders.filter((order) => order.userId === userId).sort(newestFirst)[0];
        return {
          userId, reportCount: BigInt(received.length),
          openReportCount: BigInt(received.filter((report) => ['submitted', 'reviewing'].includes(report.status)).length),
          latestReportReason: latestReport?.reason ?? null, latestReportAt: latestReport?.createdAt ?? null,
          recentActionId: latestAction?.id ?? null, lastPaymentOrderId: latestOrder?.id ?? null,
        };
      });
    });
    tx.auditEvent.groupBy.mockImplementation(async ({ where }) => where.targetId.in.map((targetId: string) => ({
      targetId, _count: { _all: actions.filter((event) => event.targetId === targetId &&
        event.targetType === where.targetType && where.action.in.includes(event.action)).length },
    })));
    tx.paymentOrder.groupBy.mockImplementation(async ({ where, _count }) => {
      const groups = new Map<string, { userId: string; _count: { _all: number }; _sum: { amount: Prisma.Decimal } }>();
      for (const order of orders.filter((order) => where.userId.in.includes(order.userId) && order.status === where.status &&
        (!where.currency || order.currency === where.currency))) {
        const group = groups.get(order.userId) ?? { userId: order.userId, _count: { _all: 0 }, _sum: { amount: new Prisma.Decimal(0) } };
        group._count._all++;
        group._sum.amount = group._sum.amount.plus(order.amount);
        groups.set(order.userId, group);
      }
      return [...groups.values()].map((group) => _count ? { userId: group.userId, _count: group._count } :
        { userId: group.userId, _sum: group._sum });
    });
    tx.auditEvent.findMany.mockImplementation(async ({ where, take }) => actions.filter((event) => where.id.in.includes(event.id)).slice(0, take)
      .map(({ targetId, action, createdAt, actorUser }) => ({ targetId, action, createdAt, actorUser })));
    tx.paymentOrder.findMany.mockImplementation(async ({ where, take }) => orders.filter((order) => where.id.in.includes(order.id)).slice(0, take)
      .map(({ userId, orderNo, provider, status, amount, currency, createdAt }) => ({ userId, orderNo, provider, status, amount, currency, createdAt })));

    const result = await service.getBackstageUsersOverview({ take: '3' });
    expect(result).toMatchObject({ count: 3, hasMore: true, nextCursor: emptyId, summary: { openReportsInPage: 2752 } });
    expect(result.items[0]).toMatchObject({
      reportCount: 4002, openReportCount: 2001, latestReportReason: 'latest closed report', latestReportAt: latestAt,
      reportSubmittedCount: 0, paymentCount: 4002, paidOrderCount: 2001, sanctionCount: 2001,
      recentAction: { action: 'user.restore', createdAt: latestAt, actorUser },
      lastPaymentOrder: { userId: firstId, orderNo: 'latest-pending', status: 'pending', currency: 'USD', createdAt: latestAt },
    });
    expect(result.items[0].paidAmountKrw.toString()).toBe('1500.5');
    expect(result.items[0].lastPaymentOrder?.amount.toString()).toBe('90.1');
    expect(result.items[0].lastPaymentOrder).not.toHaveProperty('id');
    expect(result.items[0].recentAction).not.toHaveProperty('targetId');
    expect(result.items[1]).toMatchObject({
      reportCount: 1501, openReportCount: 751, latestReportReason: 'older second user latest', latestReportAt: latestSecondAt,
      reportSubmittedCount: 6003, paymentCount: 1501, paidOrderCount: 751, sanctionCount: 750,
      recentAction: { action: 'user.revoke_sessions', createdAt: latestSecondAt, actorUser: null },
      lastPaymentOrder: { userId: secondId, orderNo: 'second-paid', status: 'paid', currency: 'EUR', createdAt: latestSecondAt },
    });
    expect(result.items[1].paidAmountKrw.toString()).toBe('468.75');
    expect(result.items[2]).toMatchObject({
      reportCount: 0, openReportCount: 0, latestReportReason: null, latestReportAt: null,
      recentAction: null, lastPaymentOrder: null, sanctionCount: 0, paidOrderCount: 0,
    });
    expect(typeof result.items[0].reportCount).toBe('number');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.communityReport.findMany).not.toHaveBeenCalled();
    expect(tx.auditEvent.groupBy).toHaveBeenCalledTimes(1);
    expect(tx.auditEvent.groupBy).toHaveBeenCalledWith({
      by: ['targetId'], where: { targetType: 'user', targetId: { in: [firstId, secondId, emptyId] }, action: { in: ['user.suspend', 'user.delete'] } },
      _count: { _all: true },
    });
    expect(tx.paymentOrder.groupBy).toHaveBeenCalledTimes(2);
    expect(tx.paymentOrder.groupBy).toHaveBeenNthCalledWith(1, {
      by: ['userId'], where: { userId: { in: [firstId, secondId, emptyId] }, status: 'paid' },
      _count: { _all: true },
    });
    expect(tx.paymentOrder.groupBy).toHaveBeenNthCalledWith(2, {
      by: ['userId'], where: { userId: { in: [firstId, secondId, emptyId] }, status: 'paid', currency: 'KRW' },
      _sum: { amount: true },
    });
    expect(new Set(orders.filter((order) => order.status === 'paid').map((order) => order.currency)).size).toBeGreaterThan(1000);
    for (const call of [...tx.auditEvent.groupBy.mock.results, ...tx.paymentOrder.groupBy.mock.results]) {
      expect((await call.value).length).toBeLessThanOrEqual(3);
    }
    expect(tx.auditEvent.findMany).toHaveBeenCalledTimes(1);
    expect(tx.auditEvent.findMany).toHaveBeenCalledWith({
      where: { id: { in: [historyId('20000000', 2), historyId('20000000', 3)] } }, take: 2,
      select: { targetId: true, action: true, createdAt: true, actorUser: { select: { id: true, email: true } } },
    });
    expect(tx.paymentOrder.findMany).toHaveBeenCalledTimes(1);
    expect(tx.paymentOrder.findMany).toHaveBeenCalledWith({
      where: { id: { in: [historyId('30000000', 2), historyId('30000000', 3)] } }, take: 2,
      select: { userId: true, orderNo: true, provider: true, status: true, amount: true, currency: true, createdAt: true },
    });
  });

  it('uses a constant number of page-bounded queries even at the maximum page size', async () => {
    const rows = Array.from({ length: 101 }, (_, index) => account(`00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`));
    const ids = rows.slice(0, 100).map((user) => user.id);
    const { service, tx } = fixture(rows);
    tx.$queryRaw.mockResolvedValue(ids.map((userId, index) => ({
      userId, reportCount: 0n, openReportCount: 0n, latestReportReason: null, latestReportAt: null,
      recentActionId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      lastPaymentOrderId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    })));
    tx.auditEvent.findMany.mockResolvedValue(ids.map((targetId) => ({
      targetId, action: 'user.restore', createdAt: new Date('2026-09-30'), actorUser: null,
    })));
    tx.paymentOrder.findMany.mockResolvedValue(ids.map((userId, index) => ({
      userId, orderNo: `pending-${index}`, provider: 'mock', status: 'pending',
      amount: new Prisma.Decimal(1), currency: 'KRW', createdAt: new Date('2026-09-30'),
    })));
    const result = await service.getBackstageUsersOverview({ take: '100' });
    expect(result).toMatchObject({ count: 100, hasMore: true, nextCursor: ids[99] });
    expect(result.items.map((user) => user.id)).toEqual(ids);
    expect(result.items.filter((user) => user.recentAction)).toHaveLength(100);
    expect(result.items.filter((user) => user.lastPaymentOrder)).toHaveLength(100);
    expect(tx.user.findMany).toHaveBeenCalledTimes(1);
    expect(tx.user.findMany.mock.calls[0][0].take).toBe(101);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expectPageEnrichmentQuery(tx.$queryRaw.mock.calls[0][0], ids);
    expect(tx.communityReport.findMany).not.toHaveBeenCalled();
    for (const delegate of [tx.auditEvent, tx.paymentOrder]) {
      expect(delegate.groupBy).toHaveBeenCalledTimes(delegate === tx.paymentOrder ? 2 : 1);
      expect(delegate.findMany).toHaveBeenCalledTimes(1);
      const args = delegate.findMany.mock.calls[0][0];
      expect(args.take).toBe(100);
      expect(args.where.id.in).toHaveLength(100);
      expect(args).not.toHaveProperty('distinct');
    }
  });

  it('skips latest-record hydration for users with no matching histories and converts bigint counts to response numbers', async () => {
    const { service, tx } = fixture();
    tx.$queryRaw.mockResolvedValue([{
      userId: firstId, reportCount: 3000000000n, openReportCount: 2000000000n,
      latestReportReason: 'latest', latestReportAt: new Date('2026-09-30'),
      recentActionId: null, lastPaymentOrderId: null,
    }]);
    const result = await service.getBackstageUsersOverview({});
    expect(result.items[0]).toMatchObject({ reportCount: 3000000000, openReportCount: 2000000000,
      recentAction: null, lastPaymentOrder: null });
    expect(result.summary.openReportsInPage).toBe(2000000000);
    expect(tx.auditEvent.findMany).not.toHaveBeenCalled();
    expect(tx.paymentOrder.findMany).not.toHaveBeenCalled();
  });

  it('propagates enrichment failures instead of silently returning zero histories', async () => {
    const { service, tx } = fixture();
    tx.$queryRaw.mockRejectedValue(new Error('enrichment unavailable'));
    await expect(service.getBackstageUsersOverview({})).rejects.toThrow('enrichment unavailable');
    expect(tx.auditEvent.findMany).not.toHaveBeenCalled();
    expect(tx.paymentOrder.findMany).not.toHaveBeenCalled();
  });

  it('propagates DB failures instead of returning fabricated accounts or zero totals', async () => {
    const { service, tx } = fixture();
    tx.user.count.mockReset().mockRejectedValue(new Error('DB unavailable'));
    await expect(service.getBackstageUsersOverview({})).rejects.toThrow('DB unavailable');
  });

  it('keeps global and filtered explicit test counts separate from returned page counts', async () => {
    const classified = { ...account(), testAccountClassification: { classification: 'test', revision: 3, updatedAt: new Date('2026-10-05') } };
    const { service, tx } = fixture([classified]);
    tx.user.count.mockReset().mockResolvedValueOnce(87).mockResolvedValueOnce(12).mockResolvedValueOnce(8).mockResolvedValueOnce(3);
    const result = await service.getBackstageUsersOverview({});
    expect(result.summary).toMatchObject({ globalTestAccounts: 8, globalUnclassifiedAccounts: 79,
      filteredTestAccounts: 3, filteredUnclassifiedAccounts: 9 });
    expect(result.items[0].testAccountClassification).toMatchObject({ classification: 'test', revision: 3, source: 'explicit_admin' });
    expect(result.policy.realCustomerInference).toBe(false);
  });

  it.each(['test', 'unclassified'])('binds explicit classification %s to counts and cursor validation', async classification => {
    const { service, tx } = fixture();
    await service.getBackstageUsersOverview({ classification, cursor: firstId });
    const where = tx.user.findMany.mock.calls[0][0].where;
    expect(tx.user.count).toHaveBeenNthCalledWith(2, { where });
    expect(tx.user.findFirst).toHaveBeenCalledWith({ where: { AND: [where, { id: firstId }] }, select: { id: true } });
    if (classification === 'test') expect(where.testAccountClassification).toEqual({ is: { classification: 'test' } });
    else expect(where.AND[0].OR).toEqual([{ testAccountClassification: { is: null } },
      { testAccountClassification: { is: { classification: 'unclassified' } } }]);
  });

  it('never infers a test or ordinary customer classification from the name/email', async () => {
    const { service } = fixture();
    const result = await service.getBackstageUsersOverview({});
    expect(result.items[0].testAccountClassification).toEqual({ classification: 'unclassified', revision: 0, source: 'unclassified', updatedAt: null });
    expect(result.summary.globalUnclassifiedAccounts).toBe(87);
  });

  it('rejects malformed classification filter before accessing DB', async () => {
    const { service, prisma } = fixture();
    await expect(service.getBackstageUsersOverview({ classification: 'real_customer' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

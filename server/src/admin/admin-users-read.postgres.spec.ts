import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AdminUsersReadService } from './admin-users-read.service';
import { PrismaService } from '../prisma/prisma.service';

const url = process.env.ADMIN_USERS_READ_DATABASE_URL;
const describeDatabase = url ? describe : describe.skip;

describeDatabase('AdminUsersReadService existing PostgreSQL data (read only; no fixtures)', () => {
  it('matches persisted account counts, two cursor pages, email/UUID search and empty results', async () => {
    const db = new PrismaClient({ datasources: { db: { url: url! } } });
    try {
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const readOnlyPrisma = { $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) };
        const service = new AdminUsersReadService(readOnlyPrisma as unknown as PrismaService);
        const total = await tx.user.count();
        const expected = await tx.user.findMany({ take: 40, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } });
        const first = await service.getBackstageUsersOverview({ take: '20' });
        expect(first.totalAccounts).toBe(total);
        expect(first.filteredAccounts).toBe(total);
        expect(first.items.map((user) => user.id)).toEqual(expected.slice(0, 20).map((user) => user.id));
        expect(first.hasMore).toBe(total > 20);
        expect(first.policy.accountClassification).toBe('unavailable');
        if (first.nextCursor) {
          const second = await service.getBackstageUsersOverview({ take: '20', cursor: first.nextCursor });
          expect(second.items.map((user) => user.id)).toEqual(expected.slice(20, 40).map((user) => user.id));
          expect(second.totalAccounts).toBe(total);
          expect(new Set([...first.items, ...second.items].map((user) => user.id)).size).toBe(first.count + second.count);
        }
        const account = first.items[0];
        if (account) {
          const byId = await service.getBackstageUsersOverview({ query: account.id });
          expect(byId.items.some((user) => user.id === account.id)).toBe(true);
          if (account.email) {
            const where: Prisma.UserWhereInput = { email: { contains: account.email, mode: 'insensitive' } };
            const byEmail = await service.getBackstageUsersOverview({ email: account.email });
            expect(byEmail.filteredAccounts).toBe(await tx.user.count({ where }));
            expect(byEmail.items.some((user) => user.id === account.id)).toBe(true);
          }
        }
        const empty = await service.getBackstageUsersOverview({ query: `__admin_readonly_no_match_${Date.now()}__` });
        expect(empty).toMatchObject({ items: [], filteredAccounts: 0, totalAccounts: total });
        const [reported, actioned, purchased] = await Promise.all([
          tx.communityReport.findFirst({ select: { post: { select: { authorUserId: true } } } }),
          tx.auditEvent.findFirst({ where: { targetType: 'user', targetId: { not: null } }, select: { targetId: true } }),
          tx.paymentOrder.findFirst({ select: { userId: true } }),
        ]);
        const historyUsers = [...new Set([reported?.post.authorUserId, actioned?.targetId, purchased?.userId]
          .filter((id): id is string => Boolean(id)))];
        for (const userId of historyUsers) {
          const item = (await service.getBackstageUsersOverview({ query: userId })).items.find((user) => user.id === userId);
          if (!item) continue;
          const [reportCount, openReportCount, latestReport, latestAction, latestOrder] = await Promise.all([
            tx.communityReport.count({ where: { post: { authorUserId: userId } } }),
            tx.communityReport.count({ where: { post: { authorUserId: userId }, status: { in: ['submitted', 'reviewing'] } } }),
            tx.communityReport.findFirst({ where: { post: { authorUserId: userId } },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { reason: true, createdAt: true } }),
            tx.auditEvent.findFirst({ where: { targetType: 'user', targetId: userId },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { action: true, createdAt: true } }),
            tx.paymentOrder.findFirst({ where: { userId },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { orderNo: true, status: true, createdAt: true } }),
          ]);
          expect(item.reportCount).toBe(reportCount);
          expect(item.openReportCount).toBe(openReportCount);
          // Compare private fields as booleans to keep failed-test logs free of their values.
          expect(item.latestReportReason === (latestReport?.reason ?? null)).toBe(true);
          expect(item.latestReportAt?.getTime() ?? null).toBe(latestReport?.createdAt.getTime() ?? null);
          expect(item.recentAction?.action === latestAction?.action).toBe(true);
          expect(item.recentAction?.createdAt.getTime() ?? null).toBe(latestAction?.createdAt.getTime() ?? null);
          expect(item.lastPaymentOrder?.orderNo === latestOrder?.orderNo).toBe(true);
          expect(item.lastPaymentOrder?.status === latestOrder?.status).toBe(true);
          expect(item.lastPaymentOrder?.createdAt.getTime() ?? null).toBe(latestOrder?.createdAt.getTime() ?? null);
        }
        console.info('Existing read-only history sources:', {
          reports: Boolean(reported), userActions: Boolean(actioned), paymentOrders: Boolean(purchased),
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20_000 });
    } finally {
      await db.$disconnect();
    }
  }, 30_000);
});

describeDatabase('AdminUsersReadService isolated PostgreSQL history fixtures (always rolled back)', () => {
  it('reduces long histories to exact counts, KRW totals and latest records in PostgreSQL', async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
        parsed.username !== 'lumina_qa' || parsed.pathname !== '/lumina_story_qa' || parsed.search || parsed.hash) {
      throw new Error('Dedicated loopback lumina_story_qa database required');
    }
    const db = new PrismaClient({ datasources: { db: { url: url! } } });
    const rollback = new Error('admin_history_fixture_rollback');
    try {
      await expect(db.$transaction(async (tx) => {
        const user = await tx.user.create({ data: {} });
        const other = await tx.user.create({ data: {} });
        const post = await tx.communityPost.create({ data: { authorUserId: user.id, body: 'Isolated history QA' } });
        const otherPost = await tx.communityPost.create({ data: { authorUserId: other.id, body: 'Other isolated QA' } });
        const product = await tx.luminaProduct.create({ data: {
          sku: `admin-history-qa-${randomUUID()}`, name: 'Isolated QA only', luminaAmount: 1, priceAmount: 1,
        } });
        const [lowerId, upperId] = [randomUUID(), randomUUID()].sort();
        const older = new Date('2020-01-01');
        const latest = new Date('2026-09-30');
        await tx.communityReport.createMany({ data: [
          ...Array.from({ length: 2000 }, (_, index) => ({ postId: post.id, reporterUserId: other.id,
            reason: 'Historical QA', status: index % 2 ? 'resolved' : 'submitted', createdAt: older })),
          { id: lowerId, postId: post.id, reporterUserId: other.id, reason: 'Lower tie', status: 'submitted', createdAt: latest },
          { id: upperId, postId: post.id, reporterUserId: other.id, reason: 'Latest closed QA', status: 'resolved', createdAt: latest },
          { postId: otherPost.id, reporterUserId: user.id, reason: 'Other author QA', createdAt: latest },
        ] });
        await tx.auditEvent.createMany({ data: [
          ...Array.from({ length: 2000 }, (_, index) => ({ actorType: 'admin', targetType: 'user',
            targetId: user.id, action: index % 2 ? 'user.restore' : 'user.suspend', createdAt: older })),
          { id: lowerId, actorType: 'admin', targetType: 'user', targetId: user.id, action: 'user.delete', createdAt: latest },
          { id: upperId, actorType: 'admin', actorUserId: other.id, targetType: 'user', targetId: user.id,
            action: 'user.restore', createdAt: latest },
          { actorType: 'admin', targetType: 'artist', targetId: user.id, action: 'user.suspend', createdAt: new Date('2027-01-01') },
        ] });
        await tx.paymentOrder.createMany({ data: [
          ...Array.from({ length: 2000 }, (_, index) => ({ userId: user.id, luminaProductId: product.id,
            orderNo: `qa-${randomUUID()}`, provider: 'qa-only', status: 'paid', amount: '1.25',
            currency: index % 2 ? 'USD' : 'KRW', createdAt: older })),
          { id: lowerId, userId: user.id, luminaProductId: product.id, orderNo: `qa-${randomUUID()}`,
            provider: 'qa-only', status: 'paid', amount: '0.25', currency: 'KRW', createdAt: latest },
          { id: upperId, userId: user.id, luminaProductId: product.id, orderNo: `qa-${randomUUID()}`,
            provider: 'qa-only', status: 'pending', amount: '9.25', currency: 'KRW', createdAt: latest },
          { userId: other.id, luminaProductId: product.id, orderNo: `qa-${randomUUID()}`,
            provider: 'qa-only', status: 'paid', amount: '999', currency: 'KRW', createdAt: latest },
        ] });
        const prisma = { $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) };
        const service = new AdminUsersReadService(prisma as unknown as PrismaService);
        const result = await service.getBackstageUsersOverview({ query: user.id });
        expect(result.count).toBe(1);
        const item = result.items[0];
        expect(item).toMatchObject({ reportCount: 2002, openReportCount: 1001, reportSubmittedCount: 1,
          latestReportReason: 'Latest closed QA', latestReportAt: latest, sanctionCount: 1001,
          paymentCount: 2002, paidOrderCount: 2001,
          recentAction: { action: 'user.restore', createdAt: latest, actorUser: { id: other.id } },
          lastPaymentOrder: { status: 'pending', amount: new Prisma.Decimal('9.25'), createdAt: latest },
        });
        expect(item.paidAmountKrw.toString()).toBe('1250.25');
        expect(result.summary.openReportsInPage).toBe(1001);
        throw rollback;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 })).rejects.toBe(rollback);
    } finally {
      await db.$disconnect();
    }
  }, 45_000);
});

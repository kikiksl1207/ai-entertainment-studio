import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { parseTestAccountFilter } from './admin-test-account-policy';

type UsersQuery = Record<string, string | undefined>;
type UserPageEnrichment = {
  userId: string;
  reportCount: bigint;
  openReportCount: bigint;
  latestReportReason: string | null;
  latestReportAt: Date | null;
  recentActionId: string | null;
  lastPaymentOrderId: string | null;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AdminUsersReadService {
  constructor(private readonly prisma: PrismaService) {}

  async getBackstageUsersOverview(query: UsersQuery) {
    const take = query.take === undefined ? 20 : Number(query.take);
    if (!Number.isInteger(take) || take < 1 || take > 100) {
      throw new BadRequestException('take must be an integer between 1 and 100');
    }
    const cursor = query.cursor?.trim();
    if (cursor && !UUID.test(cursor)) {
      throw new BadRequestException('cursor must be a UUID');
    }
    const search = query.query?.trim() || query.q?.trim() || undefined;
    const email = query.email?.trim() || undefined;
    const status = query.status?.trim() || undefined;
    const classification = parseTestAccountFilter(query.classification);
    const where: Prisma.UserWhereInput = {
      ...(status ? { status } : {}),
      ...(email ? { email: { contains: email, mode: 'insensitive' } } : {}),
      ...(search ? { OR: [
        { email: { contains: search, mode: 'insensitive' } },
        { phoneNumber: { contains: search, mode: 'insensitive' } },
        { profile: { is: { displayName: { contains: search, mode: 'insensitive' } } } },
        { profile: { is: { publicHandle: { contains: search, mode: 'insensitive' } } } },
        ...(UUID.test(search) ? [{ id: search }] : []),
      ] } : {}),
      ...(classification === 'test' ? { testAccountClassification: { is: { classification: 'test' } } } : {}),
      ...(classification === 'unclassified' ? { AND: [{ OR: [
        { testAccountClassification: { is: null } },
        { testAccountClassification: { is: { classification: 'unclassified' } } },
      ] }] } : {}),
    };

    // Counts and the cursor page share a snapshot; no account classification is inferred.
    return this.prisma.$transaction(async (tx) => {
      if (cursor && !await tx.user.findFirst({ where: { AND: [where, { id: cursor }] }, select: { id: true } })) {
        throw new BadRequestException('cursor is no longer valid for these filters; reload the first page');
      }
      const [totalAccounts, filteredAccounts, rows, globalTestAccounts, filteredTestAccounts] = await Promise.all([
        tx.user.count(),
        tx.user.count({ where }),
        tx.user.findMany({
          where, take: take + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true, email: true, phoneNumber: true, status: true,
            testAccountClassification: { select: { classification: true, revision: true, updatedAt: true } },
            createdAt: true, updatedAt: true, deletedAt: true,
            profile: { select: { displayName: true, publicHandle: true } },
            authAccounts: { select: { provider: true, lastLoginAt: true } },
            walletAccounts: { select: { currencyCode: true, status: true, cachedBalance: true } },
            _count: { select: {
              refreshTokens: { where: { revokedAt: null, expiresAt: { gt: new Date() } } },
              paymentOrders: true, communityPosts: true, communityReports: true,
              artistFollows: true, followingUsers: true, followers: true,
            } },
          },
        }),
        tx.user.count({ where: { testAccountClassification: { is: { classification: 'test' } } } }),
        tx.user.count({ where: { AND: [where, { testAccountClassification: { is: { classification: 'test' } } }] } }),
      ]);
      const hasMore = rows.length > take;
      const users = rows.slice(0, take);
      const ids = users.map((user) => user.id);
      // Prisma distinct can load whole histories. Reduce in PostgreSQL before hydrating records.
      const [enrichment, sanctions, payments, krwPayments] = ids.length ? await Promise.all([
        tx.$queryRaw<UserPageEnrichment[]>(Prisma.sql`
          WITH page_users (id) AS (
            VALUES ${Prisma.join(ids.map((id) => Prisma.sql`(${id}::uuid)`))}
          ), report_totals AS (
            SELECT post.author_user_id AS user_id, COUNT(*) AS report_count,
              COUNT(*) FILTER (WHERE report.status IN ('submitted', 'reviewing')) AS open_report_count
            FROM community_reports AS report
            JOIN community_posts AS post ON post.id = report.post_id
            JOIN page_users AS page ON page.id = post.author_user_id
            GROUP BY post.author_user_id
          )
          SELECT page.id AS "userId", COALESCE(totals.report_count, 0) AS "reportCount",
            COALESCE(totals.open_report_count, 0) AS "openReportCount",
            latest_report.reason AS "latestReportReason", latest_report.created_at AS "latestReportAt",
            latest_action.id AS "recentActionId", latest_order.id AS "lastPaymentOrderId"
          FROM page_users AS page
          LEFT JOIN report_totals AS totals ON totals.user_id = page.id
          LEFT JOIN LATERAL (
            SELECT report.reason, report.created_at
            FROM community_reports AS report
            JOIN community_posts AS post ON post.id = report.post_id
            WHERE post.author_user_id = page.id
            ORDER BY report.created_at DESC, report.id DESC
            LIMIT 1
          ) AS latest_report ON TRUE
          LEFT JOIN LATERAL (
            SELECT event.id
            FROM audit_events AS event
            WHERE event.target_type = 'user' AND event.target_id = page.id
              AND event.action <> 'user.test_account_classification'
            ORDER BY event.created_at DESC, event.id DESC
            LIMIT 1
          ) AS latest_action ON TRUE
          LEFT JOIN LATERAL (
            SELECT orders.id
            FROM payment_orders AS orders
            WHERE orders.user_id = page.id
            ORDER BY orders.created_at DESC, orders.id DESC
            LIMIT 1
          ) AS latest_order ON TRUE
        `),
        tx.auditEvent.groupBy({
          by: ['targetId'], where: { targetType: 'user', targetId: { in: ids }, action: { in: ['user.suspend', 'user.delete'] } },
          _count: { _all: true },
        }),
        tx.paymentOrder.groupBy({
          by: ['userId'], where: { userId: { in: ids }, status: 'paid' },
          _count: { _all: true },
        }),
        tx.paymentOrder.groupBy({
          by: ['userId'], where: { userId: { in: ids }, status: 'paid', currency: 'KRW' },
          _sum: { amount: true },
        }),
      ]) : [[], [], [], []];
      const actionIds = enrichment.flatMap((row) => row.recentActionId ? [row.recentActionId] : []);
      const orderIds = enrichment.flatMap((row) => row.lastPaymentOrderId ? [row.lastPaymentOrderId] : []);
      const [recentActions, lastOrders] = await Promise.all([
        actionIds.length ? tx.auditEvent.findMany({
          where: { id: { in: actionIds } }, take: actionIds.length,
          select: { targetId: true, action: true, createdAt: true, actorUser: { select: { id: true, email: true } } },
        }) : [],
        orderIds.length ? tx.paymentOrder.findMany({
          where: { id: { in: orderIds } }, take: orderIds.length,
          select: { userId: true, orderNo: true, provider: true, status: true, amount: true, currency: true, createdAt: true },
        }) : [],
      ]);
      const enrichmentByUser = new Map(enrichment.map((row) => [row.userId, row]));
      const items = users.map((user) => {
        const wallet = user.walletAccounts.find((account) => account.currencyCode === 'LUMINA');
        const accounts = [...user.authAccounts].sort((a, b) => (b.lastLoginAt?.getTime() ?? 0) - (a.lastLoginAt?.getTime() ?? 0));
        const userEnrichment = enrichmentByUser.get(user.id);
        const action = recentActions.find((event) => event.targetId === user.id);
        return {
          id: user.id, userId: user.id, email: user.email, phoneNumber: user.phoneNumber, status: user.status,
          testAccountClassification: {
            classification: user.testAccountClassification?.classification ?? 'unclassified',
            revision: user.testAccountClassification?.revision ?? 0,
            source: user.testAccountClassification ? 'explicit_admin' : 'unclassified',
            updatedAt: user.testAccountClassification?.updatedAt ?? null,
          },
          displayName: user.profile?.displayName ?? null, publicHandle: user.profile?.publicHandle ?? null,
          loginType: accounts[0]?.provider ?? null, loginTypes: accounts.map((account) => account.provider),
          walletBalanceLumina: wallet?.cachedBalance ?? new Prisma.Decimal(0), walletStatus: wallet?.status ?? null,
          createdAt: user.createdAt, updatedAt: user.updatedAt, deletedAt: user.deletedAt,
          lastSeenAt: accounts[0]?.lastLoginAt ?? null, activeSessionCount: user._count.refreshTokens,
          paymentCount: user._count.paymentOrders,
          paidOrderCount: payments.find((payment) => payment.userId === user.id)?._count._all ?? 0,
          paidAmountKrw: krwPayments.find((payment) => payment.userId === user.id)?._sum.amount ?? new Prisma.Decimal(0),
          lastPaymentOrder: lastOrders.find((order) => order.userId === user.id) ?? null,
          authoredPostCount: user._count.communityPosts, reportSubmittedCount: user._count.communityReports,
          reportCount: Number(userEnrichment?.reportCount ?? 0),
          openReportCount: Number(userEnrichment?.openReportCount ?? 0),
          latestReportReason: userEnrichment?.latestReportReason ?? null, latestReportAt: userEnrichment?.latestReportAt ?? null,
          sanctionCount: sanctions.find((event) => event.targetId === user.id)?._count._all ?? 0,
          recentAction: action ? { action: action.action, createdAt: action.createdAt, actorUser: action.actorUser } : null,
          followingArtistCount: user._count.artistFollows, followingUserCount: user._count.followingUsers,
          followerCount: user._count.followers,
        };
      });
      return {
        generatedAt: new Date(), items, count: items.length, hasMore,
        nextCursor: hasMore ? items.at(-1)!.id : null,
        totalAccounts, filteredAccounts, filters: { search: search ?? null, email: email ?? null, status: status ?? null, classification },
        summary: {
          totalAccounts, filteredAccounts,
          globalTestAccounts, globalUnclassifiedAccounts: totalAccounts - globalTestAccounts,
          filteredTestAccounts, filteredUnclassifiedAccounts: filteredAccounts - filteredTestAccounts,
          suspendedInPage: items.filter((item) => item.status === 'suspended').length,
          deletedInPage: items.filter((item) => item.deletedAt).length,
          openReportsInPage: items.reduce((sum, item) => sum + item.openReportCount, 0),
          activeSessionsInPage: items.reduce((sum, item) => sum + item.activeSessionCount, 0),
        },
        policy: {
          source: 'users', route: '/backstage/users', testAccountsIncluded: true,
          deletedAccountsIncluded: true, accountClassification: 'explicit_admin', realCustomerInference: false,
          dangerActions: ['suspend', 'restore', 'delete', 'revoke_sessions'],
          reasonRequiredByUi: true, settlementFieldsIncluded: false,
        },
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}

import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { GUARDS_METADATA, HEADERS_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { AuthUser } from '../auth/auth.types';
import { ADMIN_PERMISSIONS_KEY } from '../auth/decorators/admin-permissions.decorator';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { AdminTestAccountController } from './admin-test-account.controller';
import { parseTestAccountCommand } from './admin-test-account-policy';
import { AdminTestAccountService } from './admin-test-account.service';
import { AdminUsersReadService } from './admin-users-read.service';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

const ACTOR = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const TARGET = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CHANGE = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-05T02:00:00.000Z');
const KEY = 'independent-qa-command-01';
const actor: AuthUser = { id: ACTOR, adminPermissions: ['*'] };
const declaration = { classification: 'test', expectedRevision: 0, reasonCode: 'qa_owned' };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const sqlText = (query: Prisma.Sql) => query.sql.replace(/\s+/g, ' ').trim();

async function statusOf(operation: Promise<unknown>, expected: number) {
  const result = await operation.then(value => ({ value, error: null }), error => ({ value: null, error }));
  expect(result.error).toBeInstanceOf(HttpException);
  if (result.error instanceof HttpException) expect(result.error.getStatus()).toBe(expected);
  return result.error as HttpException;
}

function serviceHarness() {
  const events: string[] = [];
  const live = {
    actor: { status: 'active', deletedAt: null as Date | null, email: 'operator@example.invalid' },
    grants: [{ status: 'active', permissions: ['*'] }],
    bootstrap: '',
    targetExists: true,
  };
  const tx = {
    $queryRaw: jest.fn(async (query: Prisma.Sql) => {
      if (sqlText(query).includes('FROM admin_users')) {
        events.push('grant-lock');
        return live.grants;
      }
      events.push('user-lock');
      return [];
    }),
    user: {
      findUnique: jest.fn(async (args: any) => {
        if (args.select.status) {
          events.push('actor-read');
          return live.actor;
        }
        events.push('target-read');
        return live.targetExists ? { id: args.where.id } : null;
      }),
    },
    adminTestAccountChange: {
      findUnique: jest.fn(async (_args: any): Promise<any> => { events.push('key-read'); return null; }),
      findMany: jest.fn(async (_args: any): Promise<any[]> => []),
      create: jest.fn(async ({ data }: any) => { events.push('history-create'); return { id: CHANGE, createdAt: NOW, ...data }; }),
    },
    adminTestAccountState: {
      findUnique: jest.fn(async (_args: any): Promise<any> => { events.push('state-read'); return null; }),
      create: jest.fn(async ({ data }: any) => { events.push('state-create'); return data; }),
      update: jest.fn(async ({ where, data }: any) => { events.push('state-update'); return { userId: where.userId, ...data }; }),
    },
    auditEvent: { create: jest.fn(async (_args: any) => { events.push('audit-create'); return {}; }) },
  };
  const prisma = { $transaction: jest.fn(async (callback: any, _options: any) => callback(tx)) };
  const config = { get: jest.fn((name: string) => name === 'ADMIN_EMAILS' ? live.bootstrap : undefined) };
  return { service: new AdminTestAccountService(prisma as any, config as any), tx, prisma, config, live, events };
}

function noClassificationWrites(h: ReturnType<typeof serviceHarness>) {
  expect(h.tx.adminTestAccountChange.create).not.toHaveBeenCalled();
  expect(h.tx.adminTestAccountState.create).not.toHaveBeenCalled();
  expect(h.tx.adminTestAccountState.update).not.toHaveBeenCalled();
  expect(h.tx.auditEvent.create).not.toHaveBeenCalled();
}

function userRow(id: string, state: any = null) {
  return {
    id, email: 'qa+fixture@example.invalid', phoneNumber: null, status: 'active',
    testAccountClassification: state, createdAt: NOW, updatedAt: NOW, deletedAt: null,
    profile: null, authAccounts: [], walletAccounts: [],
    _count: { refreshTokens: 0, paymentOrders: 0, communityPosts: 0, communityReports: 0,
      artistFollows: 0, followingUsers: 0, followers: 0 },
  };
}

function overviewHarness(rows: any[] = []) {
  const tx = {
    user: {
      count: jest.fn(async (_args?: any) => 0),
      findFirst: jest.fn(async (_args: any): Promise<any> => ({ id: OTHER })),
      findMany: jest.fn(async (_args: any) => rows),
    },
    $queryRaw: jest.fn(async (_query: Prisma.Sql) => []),
    auditEvent: { groupBy: jest.fn(async (_args: any) => []), findMany: jest.fn(async (_args: any) => []) },
    paymentOrder: { groupBy: jest.fn(async (_args: any) => []), findMany: jest.fn(async (_args: any) => []) },
  };
  const prisma = { $transaction: jest.fn(async (callback: any, _options: any) => callback(tx)) };
  return { service: new AdminUsersReadService(prisma as any), tx, prisma };
}

describe('admin test account independent boundary QA (offline mocks only)', () => {
  it('canonicalizes only the exact declaration body and binds its fingerprint to target and body', () => {
    const reordered = { reasonCode: 'qa_owned', expectedRevision: 0, classification: 'test' };
    const command = parseTestAccountCommand(ACTOR.toUpperCase(), KEY, reordered);
    expect(command).toEqual({ ...declaration, userId: ACTOR, idempotencyKey: KEY,
      fingerprint: hash(JSON.stringify({ userId: ACTOR, ...declaration })) });
    expect(parseTestAccountCommand(TARGET, KEY, declaration).fingerprint).not.toBe(command.fingerprint);
    expect(parseTestAccountCommand(ACTOR, KEY, { ...declaration, reasonCode: 'fixture' }).fingerprint).not.toBe(command.fingerprint);
    expect(parseTestAccountCommand(ACTOR, 'independent-other-key', reordered).fingerprint).toBe(command.fingerprint);
  });

  it('rejects extra body fields, accessors, and multiple key headers before any lookup without evaluating a getter', async () => {
    const getter = jest.fn(() => 'test');
    const accessor = { expectedRevision: 0, reasonCode: 'qa_owned' };
    Object.defineProperty(accessor, 'classification', { enumerable: true, get: getter });
    for (const [key, body, code] of [
      [KEY, { ...declaration, email: 'private@example.invalid' }, 'ADMIN_TEST_ACCOUNT_BODY_INVALID'],
      [KEY, accessor, 'ADMIN_TEST_ACCOUNT_BODY_INVALID'],
      [[KEY, KEY], declaration, 'ADMIN_TEST_ACCOUNT_IDEMPOTENCY_KEY_INVALID'],
    ] as const) {
      const h = serviceHarness();
      const error = await statusOf(h.service.set(actor, TARGET, key, body), 400);
      expect(error.getResponse()).toEqual({ code, message: 'Invalid test account request' });
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
      expect(h.tx.user.findUnique).not.toHaveBeenCalled();
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('validates a malformed read target before a transaction or target lookup', async () => {
    const h = serviceHarness();
    await statusOf(h.service.get(actor, 'not-a-user-uuid'), 400);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires the existing literal full-admin grant even for a bootstrap-listed caller', async () => {
    const h = serviceHarness();
    h.live.bootstrap = h.live.actor.email;
    const limited = { ...actor, email: h.live.actor.email, adminPermissions: ['users:*', 'users:write'] };
    await statusOf(h.service.get(limited, TARGET), 403);
    await statusOf(h.service.set(limited, TARGET, KEY, declaration), 403);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rechecks revoked live permission before target existence or old-key/current lookups', async () => {
    const h = serviceHarness();
    h.live.grants = [{ status: 'active', permissions: ['users:read'] }];
    h.live.targetExists = false;
    await statusOf(h.service.set(actor, TARGET, KEY, declaration), 403);
    expect(h.events).toEqual(['user-lock', 'actor-read', 'grant-lock']);
    expect(h.tx.adminTestAccountChange.findUnique).not.toHaveBeenCalled();
    expect(h.tx.adminTestAccountState.findUnique).not.toHaveBeenCalled();
    noClassificationWrites(h);
  });

  it('allows only the existing bootstrap path using the live actor email, with no permission writes', async () => {
    const h = serviceHarness();
    h.live.grants = [];
    h.live.bootstrap = '  OPERATOR@EXAMPLE.INVALID  ';
    const result = await h.service.get({ ...actor, email: 'stale-token@example.invalid' }, TARGET);
    expect(result.state).toEqual({ classification: 'unclassified', revision: 0, source: 'unclassified', updatedAt: null });
    noClassificationWrites(h);
    expect(h.config.get).toHaveBeenCalledWith('ADMIN_EMAILS');
  });

  it('does not let bootstrap bypass a live suspended or deleted actor', async () => {
    for (const disabled of [{ status: 'suspended', deletedAt: null }, { status: 'active', deletedAt: NOW }]) {
      const h = serviceHarness();
      Object.assign(h.live.actor, disabled);
      h.live.bootstrap = h.live.actor.email;
      await statusOf(h.service.set(actor, TARGET, KEY, declaration), 403);
      expect(h.events).toEqual(['user-lock', 'actor-read']);
      noClassificationWrites(h);
    }
  });

  it('REGRESSION: bootstrap cannot override an active limited role after full permission is revoked', async () => {
    const h = serviceHarness();
    h.live.bootstrap = h.live.actor.email;
    h.live.grants = [{ status: 'active', permissions: ['users:read'] }];
    // AdminAuthGuard prioritizes an active existing role over the bootstrap fallback.
    // The stale request still has '*', but the current active role no longer does.
    await statusOf(h.service.set(actor, TARGET, KEY, declaration), 403);
    noClassificationWrites(h);
  });

  it('locks actor and target in stable order and deduplicates a self-target before grant recheck', async () => {
    const h = serviceHarness();
    await h.service.set(actor, TARGET, KEY, declaration);
    const writeLock = h.tx.$queryRaw.mock.calls[0][0];
    expect(sqlText(writeLock)).toContain('ORDER BY id FOR UPDATE');
    expect(writeLock.values).toEqual([TARGET, ACTOR]);
    expect(sqlText(h.tx.$queryRaw.mock.calls[1][0])).toContain('FOR SHARE OF a, r');
    expect(h.events.slice(0, 5)).toEqual(['user-lock', 'actor-read', 'grant-lock', 'target-read', 'key-read']);
    expect(h.prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 });
    const self = serviceHarness();
    await self.service.set(actor, ACTOR, KEY, declaration);
    expect(self.tx.$queryRaw.mock.calls[0][0].values).toEqual([ACTOR]);
    const read = serviceHarness();
    await read.service.get(actor, ACTOR);
    expect(sqlText(read.tx.$queryRaw.mock.calls[0][0])).toContain('ORDER BY id FOR SHARE');
    expect(read.prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10_000 });
  });

  it('returns an email-independent baseline and an intentionally private history projection', async () => {
    const h = serviceHarness();
    const result = await h.service.get(actor, TARGET);
    expect(result).toEqual({ contract: 'admin-test-account-classification-v1', userId: TARGET, readOnly: true,
      state: { classification: 'unclassified', revision: 0, source: 'unclassified', updatedAt: null }, history: [],
      policy: { realCustomerInference: false, permissionChanges: false } });
    expect(h.tx.adminTestAccountChange.findMany).toHaveBeenCalledWith({ where: { userId: TARGET },
      orderBy: { revision: 'desc' }, take: 20,
      select: { id: true, revision: true, classification: true, reasonCode: true, createdAt: true } });
    noClassificationWrites(h);
  });

  it('preserves explicit-admin source and nonzero revision for a cleared account', async () => {
    const h = serviceHarness();
    h.tx.adminTestAccountState.findUnique.mockResolvedValue({ userId: TARGET, classification: 'unclassified', revision: 4, updatedAt: NOW });
    const result = await h.service.get(actor, TARGET);
    expect(result.state).toEqual({ classification: 'unclassified', revision: 4, source: 'explicit_admin', updatedAt: NOW });
    await statusOf(h.service.set(actor, TARGET, KEY, declaration), 409);
    noClassificationWrites(h);
  });

  it('writes one target-bound immutable-history attempt, current state and audit with only hashed command keys', async () => {
    const h = serviceHarness();
    const result = await h.service.set(actor, TARGET, KEY, declaration);
    const fingerprint = hash(JSON.stringify({ userId: TARGET, ...declaration }));
    expect(h.tx.adminTestAccountChange.findUnique).toHaveBeenCalledWith({
      where: { actorUserId_requestKeyHash: { actorUserId: ACTOR, requestKeyHash: hash(KEY) } },
    });
    expect(h.tx.adminTestAccountState.findUnique).toHaveBeenCalledWith({ where: { userId: TARGET } });
    expect(h.tx.adminTestAccountChange.create).toHaveBeenCalledTimes(1);
    expect(h.tx.adminTestAccountChange.create).toHaveBeenCalledWith({ data: {
      userId: TARGET, actorUserId: ACTOR, classification: 'test', expectedRevision: 0, revision: 1,
      reasonCode: 'qa_owned', requestKeyHash: hash(KEY), requestFingerprint: fingerprint,
    } });
    expect(h.tx.adminTestAccountState.create).toHaveBeenCalledWith({ data: {
      userId: TARGET, classification: 'test', revision: 1, latestChangeId: CHANGE, updatedAt: NOW,
    } });
    expect(h.tx.auditEvent.create).toHaveBeenCalledWith({ data: {
      actorUserId: ACTOR, actorType: 'admin', action: 'user.test_account_classification', targetType: 'user', targetId: TARGET,
      beforeData: { classification: 'unclassified', revision: 0 }, afterData: { classification: 'test', revision: 1 },
      metadata: { changeId: CHANGE, reasonCode: 'qa_owned', permissionChanges: false, realCustomerInference: false },
    } });
    expect(result).toEqual({ contract: 'admin-test-account-classification-command-v1', userId: TARGET,
      idempotentReplay: false, receipt: { classification: 'test', revision: 1, reasonCode: 'qa_owned' },
      current: { classification: 'test', revision: 1, source: 'explicit_admin', updatedAt: NOW }, permissionChanges: false });
    expect(JSON.stringify([h.tx.adminTestAccountChange.create.mock.calls, h.tx.auditEvent.create.mock.calls, result])).not.toContain(KEY);
    expect(h.events.slice(-3)).toEqual(['history-create', 'state-create', 'audit-create']);
    expect(h.tx.adminTestAccountState.update).not.toHaveBeenCalled();
  });

  it('clears by appending the next declaration, never deleting or resetting the baseline', async () => {
    const h = serviceHarness();
    h.tx.adminTestAccountState.findUnique.mockResolvedValue({ userId: TARGET, classification: 'test', revision: 3, updatedAt: NOW });
    const result = await h.service.set(actor, TARGET, KEY, { classification: 'unclassified', expectedRevision: 3, reasonCode: 'clear' });
    expect(result.current).toEqual({ classification: 'unclassified', revision: 4, source: 'explicit_admin', updatedAt: NOW });
    expect(h.tx.adminTestAccountState.update).toHaveBeenCalledWith({ where: { userId: TARGET }, data: {
      classification: 'unclassified', revision: 4, latestChangeId: CHANGE, updatedAt: NOW,
    } });
    expect(h.tx.adminTestAccountState.create).not.toHaveBeenCalled();
    expect(h.tx.adminTestAccountChange.create.mock.calls[0][0].data).toMatchObject({ expectedRevision: 3, revision: 4, reasonCode: 'clear' });
    expect(h.tx.auditEvent.create.mock.calls[0][0].data.beforeData).toEqual({ classification: 'test', revision: 3 });
  });

  it('returns 409 for stale revision without attempting history, current, or audit writes', async () => {
    const h = serviceHarness();
    h.tx.adminTestAccountState.findUnique.mockResolvedValue({ classification: 'test', revision: 2, updatedAt: NOW });
    await statusOf(h.service.set(actor, TARGET, KEY, declaration), 409);
    noClassificationWrites(h);
  });

  it('rejects a key bound to another target even when a corrupted receipt fingerprint matches this command', async () => {
    const h = serviceHarness();
    h.tx.adminTestAccountChange.findUnique.mockResolvedValue({ userId: OTHER,
      requestFingerprint: parseTestAccountCommand(TARGET, KEY, declaration).fingerprint,
      classification: 'test', revision: 1, reasonCode: 'qa_owned' });
    await statusOf(h.service.set(actor, TARGET, KEY, declaration), 409);
    noClassificationWrites(h);
  });

  it('rejects a changed declaration under the same actor key without leaking its old receipt', async () => {
    const h = serviceHarness();
    h.tx.adminTestAccountChange.findUnique.mockResolvedValue({ userId: TARGET,
      requestFingerprint: parseTestAccountCommand(TARGET, KEY, declaration).fingerprint,
      classification: 'test', revision: 1, reasonCode: 'qa_owned' });
    const error = await statusOf(h.service.set(actor, TARGET, KEY, { ...declaration, reasonCode: 'fixture' }), 409);
    expect(JSON.stringify(error.getResponse())).not.toContain('qa_owned');
    noClassificationWrites(h);
  });

  it('replays the old receipt but returns the newer cleared current state without comparing the stale expected revision', async () => {
    const h = serviceHarness();
    h.tx.adminTestAccountChange.findUnique.mockResolvedValue({ userId: TARGET,
      requestFingerprint: parseTestAccountCommand(TARGET, KEY, declaration).fingerprint,
      classification: 'test', revision: 1, reasonCode: 'qa_owned' });
    h.tx.adminTestAccountState.findUnique.mockResolvedValue({ userId: TARGET, classification: 'unclassified', revision: 5, updatedAt: NOW });
    const result = await h.service.set(actor, TARGET, KEY, declaration);
    expect(result).toEqual({ contract: 'admin-test-account-classification-command-v1', userId: TARGET, idempotentReplay: true,
      receipt: { classification: 'test', revision: 1, reasonCode: 'qa_owned' },
      current: { classification: 'unclassified', revision: 5, source: 'explicit_admin', updatedAt: NOW }, permissionChanges: false });
    noClassificationWrites(h);
  });

  it('sanitizes database errors while distinguishing known conflicts from service unavailability', async () => {
    const privateMessage = 'postgres://private-host raw-secret-email@example.invalid sensitive-command-key';
    for (const [error, status] of [
      [new Error(privateMessage), 503],
      [new Prisma.PrismaClientKnownRequestError(privateMessage, { code: 'P2002', clientVersion: 'independent-qa' }), 409],
      [new Prisma.PrismaClientKnownRequestError(privateMessage, { code: 'P2034', clientVersion: 'independent-qa' }), 409],
      [new Prisma.PrismaClientKnownRequestError(privateMessage, { code: 'P2010', clientVersion: 'independent-qa', meta: { code: '23514' } }), 503],
    ] as const) {
      const h = serviceHarness();
      h.tx.$queryRaw.mockRejectedValueOnce(error);
      const caught = await statusOf(h.service.set(actor, TARGET, KEY, declaration), status);
      expect(JSON.stringify(caught.getResponse())).not.toMatch(/private-host|raw-secret-email|sensitive-command-key|P20\d\d|23514/);
      noClassificationWrites(h);
    }
    const auditFailure = serviceHarness();
    auditFailure.tx.auditEvent.create.mockRejectedValueOnce(new Error(privateMessage));
    await statusOf(auditFailure.service.set(actor, TARGET, KEY, declaration), 503);
    // This mock proves failure propagation, not database rollback or commit atomicity.
    expect(auditFailure.tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('uses the related classification filter consistently for totals, cursor validation and lookahead paging', async () => {
    const explicitClear = { classification: 'unclassified', revision: 6, updatedAt: NOW };
    const h = overviewHarness([userRow(TARGET), userRow(ACTOR, explicitClear), userRow(OTHER)]);
    h.tx.user.count.mockResolvedValueOnce(9).mockResolvedValueOnce(4).mockResolvedValueOnce(3).mockResolvedValueOnce(0);
    const result = await h.service.getBackstageUsersOverview({ classification: 'unclassified', query: 'qa', email: 'fixture', status: 'active', cursor: OTHER, take: '2' });
    const where = h.tx.user.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ status: 'active', email: { contains: 'fixture', mode: 'insensitive' },
      OR: [{ email: { contains: 'qa', mode: 'insensitive' } }, { phoneNumber: { contains: 'qa', mode: 'insensitive' } },
        { profile: { is: { displayName: { contains: 'qa', mode: 'insensitive' } } } },
        { profile: { is: { publicHandle: { contains: 'qa', mode: 'insensitive' } } } }],
      AND: [{ OR: [{ testAccountClassification: { is: null } },
        { testAccountClassification: { is: { classification: 'unclassified' } } }] }] });
    expect(h.tx.user.findFirst).toHaveBeenCalledWith({ where: { AND: [where, { id: OTHER }] }, select: { id: true } });
    expect(h.tx.user.count.mock.calls).toEqual([[], [{ where }],
      [{ where: { testAccountClassification: { is: { classification: 'test' } } } }],
      [{ where: { AND: [where, { testAccountClassification: { is: { classification: 'test' } } }] } }]]);
    expect(h.tx.user.findMany.mock.calls[0][0]).toMatchObject({ where, take: 3, cursor: { id: OTHER }, skip: 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    expect(result).toMatchObject({ count: 2, hasMore: true, nextCursor: ACTOR, totalAccounts: 9, filteredAccounts: 4,
      summary: { globalTestAccounts: 3, globalUnclassifiedAccounts: 6, filteredTestAccounts: 0, filteredUnclassifiedAccounts: 4 },
      policy: { realCustomerInference: false } });
    expect(result.items.map(item => item.testAccountClassification)).toEqual([
      { classification: 'unclassified', revision: 0, source: 'unclassified', updatedAt: null },
      { ...explicitClear, source: 'explicit_admin' },
    ]);
    expect(h.tx.$queryRaw.mock.calls[0][0].values).toEqual([TARGET, ACTOR]);
    expect(h.prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  });

  it('uses only stored test relations and rejects invalid filters or out-of-filter cursors before page/count reads', async () => {
    const test = overviewHarness();
    await test.service.getBackstageUsersOverview({ classification: 'test' });
    expect(test.tx.user.findMany.mock.calls[0][0].where).toEqual({ testAccountClassification: { is: { classification: 'test' } } });
    const all = overviewHarness();
    await all.service.getBackstageUsersOverview({});
    expect(all.tx.user.findMany.mock.calls[0][0].where).toEqual({});
    const invalid = overviewHarness();
    await statusOf(invalid.service.getBackstageUsersOverview({ classification: 'real_customer' }), 400);
    expect(invalid.prisma.$transaction).not.toHaveBeenCalled();
    const cursor = overviewHarness();
    cursor.tx.user.findFirst.mockResolvedValue(null);
    await statusOf(cursor.service.getBackstageUsersOverview({ classification: 'test', cursor: OTHER }), 400);
    expect(cursor.tx.user.count).not.toHaveBeenCalled();
    expect(cursor.tx.user.findMany).not.toHaveBeenCalled();
  });

  it('keeps both routes behind existing full-admin guards and private no-store headers, forwarding the raw key and body', async () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminTestAccountController)).toBe('/admin/api/v1/users/:userId/test-account-classification');
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminTestAccountController)).toEqual([AdminAuthGuard, AdminPermissionGuard]);
    expect(Reflect.getMetadata(ADMIN_PERMISSIONS_KEY, AdminTestAccountController)).toEqual(['*']);
    for (const method of ['get', 'set'] as const) {
      expect(Reflect.getMetadata(HEADERS_METADATA, AdminTestAccountController.prototype[method])).toEqual([
        { name: 'Cache-Control', value: 'private, no-store' },
      ]);
      expect(Reflect.getMetadata(ADMIN_PERMISSIONS_KEY, AdminTestAccountController.prototype[method])).toBeUndefined();
    }
    const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, AdminTestAccountController, 'set');
    expect(metadata[`${RouteParamtypes.HEADERS}:2`]).toMatchObject({ index: 2, data: 'idempotency-key' });
    expect(metadata[`${RouteParamtypes.BODY}:3`]).toMatchObject({ index: 3 });
    expect(metadata[`${RouteParamtypes.PARAM}:1`]).toMatchObject({ index: 1, data: 'userId' });
    const service = { get: jest.fn(async (..._args: any[]) => ({})), set: jest.fn(async (..._args: any[]) => ({})) };
    const controller = new AdminTestAccountController(service as any);
    await controller.get(actor, TARGET);
    await controller.set(actor, TARGET, undefined, declaration);
    expect(service.get).toHaveBeenCalledWith(actor, TARGET);
    expect(service.set).toHaveBeenCalledWith(actor, TARGET, undefined, declaration);
    expect(service.set.mock.calls[0][3]).toBe(declaration);
  });

  it('statically preserves migration history immutability, actor-key uniqueness and composite current-state binding', () => {
    const migration = readFileSync(resolve(__dirname, '../../prisma/migrations/20261005020000_admin_test_account_classification/migration.sql'), 'utf8').replace(/\s+/g, ' ');
    expect(migration).toContain('UNIQUE (actor_user_id, request_key_hash)');
    expect(migration).toContain('UNIQUE (user_id, revision)');
    expect(migration).toContain('UNIQUE (id, user_id, revision, classification)');
    expect(migration).toContain('FOREIGN KEY (latest_change_id, user_id, revision, classification) REFERENCES admin_test_account_changes(id, user_id, revision, classification) ON DELETE RESTRICT');
    expect(migration).toContain("IF TG_OP <> 'INSERT' THEN");
    expect(migration).toContain('ON admin_test_account_changes FOR EACH ROW EXECUTE FUNCTION guard_admin_test_account_change()');
    expect(migration).toContain('ON admin_test_account_changes FOR EACH STATEMENT EXECUTE FUNCTION guard_admin_test_account_change()');
    expect(migration).toContain("IF TG_OP IN ('DELETE', 'TRUNCATE') THEN");
    expect(migration).toContain('NEW.user_id <> OLD.user_id OR NEW.revision <> OLD.revision + 1');
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_admin_test_account_current_state()');
    expect(migration).not.toMatch(/INSERT INTO admin_(?:users|roles)|UPDATE admin_(?:users|roles)|CREATE ROLE|GRANT /i);
    const schema = readFileSync(resolve(__dirname, '../../prisma/schema.prisma'), 'utf8');
    const change = schema.match(/model AdminTestAccountChange \{([\s\S]*?)\n\}/)?.[1];
    const state = schema.match(/model AdminTestAccountState \{([\s\S]*?)\n\}/)?.[1];
    expect(change).toContain('@@unique([actorUserId, requestKeyHash]');
    expect(change).toContain('@@unique([id, userId, revision, classification]');
    expect(change).not.toMatch(/\bidempotencyKey\b/);
    expect(state).toContain('@map("latest_change_id")');
    expect(state).toContain('onDelete: Restrict');
  });
});

describe('admin test account permission follow-up (offline mocks only)', () => {
  function holdGrantRead(h: ReturnType<typeof serviceHarness>) {
    let signalReached!: () => void;
    let release!: (grants: typeof h.live.grants) => void;
    const reached = new Promise<void>(resolve => { signalReached = resolve; });
    const response = new Promise<typeof h.live.grants>(resolve => { release = resolve; });
    const original = h.tx.$queryRaw.getMockImplementation()!;
    h.tx.$queryRaw.mockImplementation(async query => {
      if (sqlText(query).includes('FROM admin_users')) {
        h.events.push('grant-lock');
        signalReached();
        return response;
      }
      return original(query);
    });
    return { reached, release };
  }

  function noProtectedReads(h: ReturnType<typeof serviceHarness>) {
    expect(h.events).toEqual(['user-lock', 'actor-read', 'grant-lock']);
    expect(h.tx.adminTestAccountChange.findUnique).not.toHaveBeenCalled();
    expect(h.tx.adminTestAccountChange.findMany).not.toHaveBeenCalled();
    expect(h.tx.adminTestAccountState.findUnique).not.toHaveBeenCalled();
    noClassificationWrites(h);
  }

  it('denies GET for a live active limited role despite bootstrap, before target/state/history disclosure', async () => {
    const h = serviceHarness();
    h.live.grants = [{ status: 'active', permissions: ['users:read'] }];
    h.live.bootstrap = h.live.actor.email;
    h.live.targetExists = false;
    const error = await statusOf(h.service.get(actor, TARGET), 403);
    expect(error.getResponse()).toEqual({ message: 'Current admin permission is required', error: 'Forbidden', statusCode: 403 });
    noProtectedReads(h);
    expect(sqlText(h.tx.$queryRaw.mock.calls[0][0])).toContain('ORDER BY id FOR SHARE');
    expect(sqlText(h.tx.$queryRaw.mock.calls[1][0])).toContain('FOR SHARE OF a, r');
  });

  it('allows existing bootstrap fallback for an inactive stored grant on GET and SET', async () => {
    for (const mode of ['get', 'set'] as const) {
      const h = serviceHarness();
      h.live.grants = [{ status: 'inactive', permissions: ['users:read'] }];
      h.live.bootstrap = '  OPERATOR@EXAMPLE.INVALID  ';
      const request = { ...actor, email: 'stale-token@example.invalid' };
      if (mode === 'get') {
        const result = await h.service.get(request, TARGET);
        expect(result.state).toEqual({ classification: 'unclassified', revision: 0, source: 'unclassified', updatedAt: null });
        noClassificationWrites(h);
      } else {
        const result = await h.service.set(request, TARGET, KEY, declaration);
        expect(result).toMatchObject({ idempotentReplay: false, current: { classification: 'test', revision: 1 }, permissionChanges: false });
        expect(h.tx.adminTestAccountChange.create).toHaveBeenCalledTimes(1);
        expect(h.tx.adminTestAccountState.create).toHaveBeenCalledTimes(1);
        expect(h.tx.auditEvent.create).toHaveBeenCalledTimes(1);
      }
      expect(h.events.slice(0, 4)).toEqual(['user-lock', 'actor-read', 'grant-lock', 'target-read']);
    }
  });

  it('does not treat inactive stored full permission or stale token email as a current grant', async () => {
    for (const mode of ['get', 'set'] as const) {
      const h = serviceHarness();
      h.live.grants = [{ status: 'inactive', permissions: ['*'] }];
      h.live.bootstrap = 'old-bootstrap@example.invalid';
      const stale = { ...actor, email: 'old-bootstrap@example.invalid' };
      await statusOf(mode === 'get' ? h.service.get(stale, TARGET) : h.service.set(stale, TARGET, KEY, declaration), 403);
      noProtectedReads(h);
    }
  });

  it('allows a live active full stored role independently of removed bootstrap on GET and SET', async () => {
    for (const mode of ['get', 'set'] as const) {
      const h = serviceHarness();
      h.live.bootstrap = '';
      const staleBootstrap = { ...actor, email: h.live.actor.email };
      if (mode === 'get') {
        const result = await h.service.get(staleBootstrap, TARGET);
        expect(result.readOnly).toBe(true);
        noClassificationWrites(h);
      } else {
        const result = await h.service.set(staleBootstrap, TARGET, KEY, declaration);
        expect(result).toMatchObject({ idempotentReplay: false, receipt: { classification: 'test', revision: 1 }, permissionChanges: false });
        expect(h.tx.adminTestAccountChange.create).toHaveBeenCalledTimes(1);
      }
      expect(h.events.slice(0, 4)).toEqual(['user-lock', 'actor-read', 'grant-lock', 'target-read']);
    }
  });

  it('denies role downgrade racing with bootstrap addition at the delayed live-grant response', async () => {
    for (const mode of ['get', 'set'] as const) {
      const h = serviceHarness();
      const gate = holdGrantRead(h);
      const operation = mode === 'get' ? h.service.get(actor, TARGET) : h.service.set(actor, TARGET, KEY, declaration);
      await gate.reached;
      expect(h.tx.user.findUnique).toHaveBeenCalledTimes(1);
      expect(h.config.get).not.toHaveBeenCalled();
      h.live.grants = [{ status: 'active', permissions: ['users:read'] }];
      h.live.bootstrap = h.live.actor.email;
      gate.release(h.live.grants);
      await statusOf(operation, 403);
      expect(h.config.get).toHaveBeenCalledWith('ADMIN_EMAILS');
      noProtectedReads(h);
    }
  });

  it('denies bootstrap removal racing with an inactive role at the delayed live-grant response', async () => {
    for (const mode of ['get', 'set'] as const) {
      const h = serviceHarness();
      h.live.grants = [{ status: 'inactive', permissions: ['*'] }];
      h.live.bootstrap = h.live.actor.email;
      const gate = holdGrantRead(h);
      const operation = mode === 'get' ? h.service.get(actor, TARGET) : h.service.set(actor, TARGET, KEY, declaration);
      await gate.reached;
      expect(h.config.get).not.toHaveBeenCalled();
      h.live.bootstrap = '';
      gate.release(h.live.grants);
      await statusOf(operation, 403);
      noProtectedReads(h);
    }
  });
});

jest.mock('./admin.service', () => ({ AdminService: class {} }));
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA } from '@nestjs/common/constants';
import { AdminModule } from './admin.module';
import { AdminController } from './admin.controller';
import { AdminTestAccountPrivacyMiddleware } from './admin-test-account.privacy';

describe('admin test account privacy route review (offline mocks only)', () => {
  function registrations() {
    const forRoutes = jest.fn();
    const consumer = { apply: jest.fn(() => ({ forRoutes })) };
    new AdminModule().configure(consumer as any);
    return { consumer, forRoutes, routes: forRoutes.mock.calls[0] };
  }

  it('registers privacy middleware for both protected controllers without a global wildcard', () => {
    const { consumer, forRoutes, routes } = registrations();
    expect(consumer.apply).toHaveBeenCalledTimes(1);
    expect(consumer.apply).toHaveBeenCalledWith(AdminTestAccountPrivacyMiddleware);
    expect(forRoutes).toHaveBeenCalledTimes(1);
    expect(routes).toEqual([AdminController, AdminTestAccountController]);
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AdminModule)).toEqual([AdminController, AdminTestAccountController]);
  });

  it('aligns protected controller paths without broadening existing guards or permissions', () => {
    const { routes } = registrations();
    const classificationPath = Reflect.getMetadata(PATH_METADATA, AdminTestAccountController).replace(/^\//, '');
    const adminPath = Reflect.getMetadata(PATH_METADATA, AdminController).replace(/^\//, '');
    expect(routes.map((controller: any) => Reflect.getMetadata(PATH_METADATA, controller).replace(/^\//, '')))
      .toEqual([adminPath, classificationPath]);
    expect(Reflect.getMetadata(METHOD_METADATA, AdminTestAccountController.prototype.get)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(METHOD_METADATA, AdminTestAccountController.prototype.set)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(METHOD_METADATA, AdminController.prototype.getBackstageUsersOverview)).toBe(RequestMethod.GET);
    for (const controller of [AdminTestAccountController, AdminController]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([AdminAuthGuard, AdminPermissionGuard]);
    }
    expect(Reflect.getMetadata(ADMIN_PERMISSIONS_KEY, AdminTestAccountController)).toEqual(['*']);
    expect(Reflect.getMetadata(ADMIN_PERMISSIONS_KEY, AdminController.prototype.getBackstageUsersOverview)).toEqual(['users:read']);
    for (const controller of routes) expect(Reflect.getMetadata(PATH_METADATA, controller)).not.toContain('*');
  });

  it('sets private no-store headers before success or simulated 401/403/400 on either registered route', () => {
    const { routes } = registrations();
    const expectedHeaders = {
      'cache-control': 'private, no-store', pragma: 'no-cache', expires: '0', vary: 'Authorization',
    };
    for (const route of routes) {
      for (const status of [200, 401, 403, 400]) {
        const headers: Record<string, string> = { 'cache-control': 'public, max-age=3600' };
        const response = { statusCode: 200, getHeader: (name: string) => headers[name.toLowerCase()],
          setHeader: jest.fn((name: string, value: string) => { headers[name.toLowerCase()] = value; }) };
        const request = { path: Reflect.getMetadata(PATH_METADATA, route).replace(':userId', TARGET), method: 'GET' };
        const next = jest.fn(() => {
          expect(headers).toEqual(expectedHeaders);
          response.statusCode = status;
          if (status !== 200) throw new HttpException('Simulated downstream outcome', status);
        });
        let caught: unknown;
        try { new AdminTestAccountPrivacyMiddleware().use(request, response, next); }
        catch (error) { caught = error; }
        if (status === 200) expect(caught).toBeUndefined();
        else {
          expect(caught).toBeInstanceOf(HttpException);
          expect((caught as HttpException).getStatus()).toBe(status);
        }
        expect(headers).toEqual(expectedHeaders);
        expect(response.setHeader).toHaveBeenCalledTimes(4);
        expect(next).toHaveBeenCalledTimes(1);
        expect(response.statusCode).toBe(status);
      }
    }
  });

  it('preserves existing Vary dimensions, a wildcard and case-insensitive Authorization without duplication', () => {
    for (const [before, after] of [['Origin', 'Origin, Authorization'], ['*', '*'],
      ['Origin, authorization', 'Origin, authorization'], ['Origin, Accept-Encoding', 'Origin, Accept-Encoding, Authorization']]) {
      const headers: Record<string, string> = { vary: before };
      const response = { getHeader: (name: string) => headers[name.toLowerCase()],
        setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; } };
      const next = jest.fn();
      new AdminTestAccountPrivacyMiddleware().use({}, response, next);
      expect(headers.vary).toBe(after);
      expect(headers['cache-control']).toBe('private, no-store');
      expect(next).toHaveBeenCalledTimes(1);
    }
  });
});

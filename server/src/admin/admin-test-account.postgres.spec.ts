import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { AdminTestAccountController } from './admin-test-account.controller';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminTestAccountService } from './admin-test-account.service';
import { AdminUsersReadService } from './admin-users-read.service';

const url = process.env.ADMIN_TEST_ACCOUNT_QA_DATABASE_URL;
const databaseTests = url ? describe : describe.skip;
databaseTests('Explicit test account classification isolated PostgreSQL', () => {
  let db: PrismaClient;
  let service: AdminTestAccountService;
  let reader: AdminUsersReadService;
  let actor: { id: string; adminPermissions: string[] };
  let roleId: string;
  let targetId: string;
  let anotherId: string;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
        parsed.username !== 'lumina_qa' || !/^\/lumina_admin_test_qa_[a-f0-9]{12}$/.test(parsed.pathname) || parsed.password) {
      throw new Error('Dedicated synthetic loopback database required');
    }
    db = new PrismaClient({ datasources: { db: { url } } });
    const admin = await db.user.create({ data: {} });
    actor = { id: admin.id, adminPermissions: ['*'] };
    const role = await db.adminRole.create({ data: { name: `synthetic_test_accounts_${randomUUID()}`, permissions: ['*'] } });
    roleId = role.id;
    await db.adminUser.create({ data: { userId: admin.id, roleId } });
    targetId = (await db.user.create({ data: { email: `synthetic-looking-test-${randomUUID()}@example.test` } })).id;
    anotherId = (await db.user.create({ data: {} })).id;
    service = new AdminTestAccountService(db as unknown as PrismaService, { get: () => '' } as unknown as ConfigService);
    reader = new AdminUsersReadService(db as unknown as PrismaService);
  });
  afterAll(async () => { if (db) await db.$disconnect(); });

  it('starts with exact persisted global totals and no inferred classification', async () => {
    const total = await db.user.count();
    const page = await reader.getBackstageUsersOverview({ query: targetId });
    expect(page).toMatchObject({ totalAccounts: total, filteredAccounts: 1, count: 1,
      summary: { globalTestAccounts: 0, globalUnclassifiedAccounts: total, filteredTestAccounts: 0, filteredUnclassifiedAccounts: 1 } });
    expect(page.items[0].testAccountClassification).toMatchObject({ classification: 'unclassified', revision: 0 });
  });

  it('stores one immutable declaration plus audit; duplicate request writes neither twice', async () => {
    const body = { classification: 'test', expectedRevision: 0, reasonCode: 'manual_confirmation' };
    const key = `synthetic-${randomUUID()}`;
    const first = await service.set(actor, targetId, key, body);
    const replay = await service.set(actor, targetId, key, body);
    expect(first).toMatchObject({ idempotentReplay: false, current: { classification: 'test', revision: 1 } });
    expect(replay).toMatchObject({ idempotentReplay: true, receipt: { classification: 'test', revision: 1 } });
    expect(await db.adminTestAccountChange.count({ where: { userId: targetId } })).toBe(1);
    expect(await db.auditEvent.count({ where: { action: 'user.test_account_classification', targetId } })).toBe(1);
    const saved = await db.adminTestAccountChange.findFirst({ where: { userId: targetId } });
    expect(saved?.requestKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(saved).includes(key)).toBe(false);
    await expect(service.set(actor, anotherId, key, body)).rejects.toBeInstanceOf(ConflictException);
  });

  it('excludes only explicit test declarations, preserves all accounts, and clears by a new event', async () => {
    const total = await db.user.count();
    expect((await reader.getBackstageUsersOverview({ classification: 'test' })).filteredAccounts).toBe(1);
    expect((await reader.getBackstageUsersOverview({ classification: 'unclassified' })).filteredAccounts).toBe(total - 1);
    const state = await service.get(actor, targetId);
    await service.set(actor, targetId, `synthetic-${randomUUID()}`, { classification: 'unclassified', expectedRevision: state.state.revision, reasonCode: 'clear' });
    const cleared = await service.get(actor, targetId);
    expect(cleared.state).toMatchObject({ classification: 'unclassified', revision: 2, source: 'explicit_admin' });
    expect(cleared.history).toHaveLength(2);
    expect(await db.user.count()).toBe(total);
    expect((await reader.getBackstageUsersOverview({ classification: 'test' })).filteredAccounts).toBe(0);
  });

  it('serializes different concurrent requests for the same revision: exactly one succeeds', async () => {
    const body = { classification: 'test', expectedRevision: 0, reasonCode: 'fixture' };
    const results = await Promise.allSettled([
      service.set(actor, anotherId, `synthetic-${randomUUID()}`, body),
      service.set(actor, anotherId, `synthetic-${randomUUID()}`, body),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected' && result.reason instanceof ConflictException)).toHaveLength(1);
    expect(await db.adminTestAccountChange.count({ where: { userId: anotherId } })).toBe(1);
    expect(await db.auditEvent.count({ where: { targetId: anotherId, action: 'user.test_account_classification' } })).toBe(1);
  });

  it('keeps classification audit history separate from reports and preserves an older sanction action', async () => {
    const fresh = await db.user.create({ data: {} });
    await service.set(actor, fresh.id, `synthetic-${randomUUID()}`, { classification: 'test', expectedRevision: 0, reasonCode: 'fixture' });
    const classifiedOnly = await reader.getBackstageUsersOverview({ query: fresh.id });
    expect(classifiedOnly.items[0]).toMatchObject({ recentAction: null, reportCount: 0, openReportCount: 0, sanctionCount: 0 });
    await db.auditEvent.create({ data: { action: 'user.suspend', actorUserId: actor.id, actorType: 'admin', targetType: 'user', targetId: fresh.id,
      createdAt: new Date('2026-01-01T00:00:00Z'), beforeData: {}, afterData: {} } });
    const withSanction = await reader.getBackstageUsersOverview({ query: fresh.id });
    expect(withSanction.items[0]).toMatchObject({ recentAction: { action: 'user.suspend' }, sanctionCount: 1 });
    expect(await db.auditEvent.count({ where: { targetId: fresh.id, action: 'user.test_account_classification' } })).toBe(1);
  });

  it('enforces history immutability, reason checks and current-state binding inside PostgreSQL', async () => {
    await expect(db.$executeRaw`UPDATE admin_test_account_changes SET reason_code='clear' WHERE user_id=${targetId}::uuid`).rejects.toBeDefined();
    await expect(db.$executeRaw`DELETE FROM admin_test_account_changes WHERE user_id=${targetId}::uuid`).rejects.toBeDefined();
    await expect(db.$executeRaw`TRUNCATE admin_test_account_changes`).rejects.toBeDefined();
    await expect(db.$executeRaw`DELETE FROM admin_test_account_states WHERE user_id=${targetId}::uuid`).rejects.toBeDefined();
    await expect(db.$executeRaw`UPDATE admin_test_account_states SET revision=revision+5 WHERE user_id=${targetId}::uuid`).rejects.toBeDefined();
    expect((await service.get(actor, targetId)).state.revision).toBe(2);
  });

  it('rolls back the declaration and state when audit storage fails', async () => {
    const fresh = await db.user.create({ data: {} });
    let auditReached = false;
    const failDb = { $transaction: (callback: (tx: unknown) => unknown, options: unknown) => db.$transaction(async tx => callback({
      ...tx,
    }), options as any) };
    failDb.$transaction = (callback, options) => db.$transaction(async tx => callback(new Proxy(tx, {
      get(target, property, receiver) {
        if (property === 'auditEvent') return { create: () => { auditReached = true; throw new Error('Synthetic audit failure'); } };
        return Reflect.get(target, property, receiver);
      },
    })), options as any);
    const failed = new AdminTestAccountService(failDb as unknown as PrismaService, { get: () => '' } as unknown as ConfigService);
    await expect(failed.set(actor, fresh.id, `synthetic-${randomUUID()}`, { classification: 'test', expectedRevision: 0, reasonCode: 'qa_owned' })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(auditReached).toBe(true);
    expect(await db.adminTestAccountChange.count({ where: { userId: fresh.id } })).toBe(0);
    expect(await db.adminTestAccountState.count({ where: { userId: fresh.id } })).toBe(0);
  });

  it('rechecks revoked stored permission and neither changes permissions nor user status', async () => {
    await db.adminRole.update({ where: { id: roleId }, data: { permissions: ['audit:read'] } });
    const before = await db.adminTestAccountChange.count();
    await expect(service.set(actor, targetId, `synthetic-${randomUUID()}`, { classification: 'test', expectedRevision: 2, reasonCode: 'fixture' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(await db.adminTestAccountChange.count()).toBe(before);
    expect((await db.user.findUnique({ where: { id: targetId } }))?.status).toBe('active');
    await db.adminRole.update({ where: { id: roleId }, data: { permissions: ['*'] } });
  });

  it('rejects a history-only commit with no associated current state', async () => {
    const fresh = await db.user.create({ data: {} });
    await expect(db.$transaction(async tx => tx.adminTestAccountChange.create({ data: {
      userId: fresh.id, actorUserId: actor.id, classification: 'test', expectedRevision: 0, revision: 1,
      reasonCode: 'fixture', requestKeyHash: 'ab'.repeat(32), requestFingerprint: 'cd'.repeat(32),
    } }))).rejects.toBeDefined();
    expect(await db.adminTestAccountChange.count({ where: { userId: fresh.id } })).toBe(0);
  });

  it('serves actual Nest controller with real synthetic JWT/DB guards: anonymous401, non-admin403, explicit201 and invalid400', async () => {
    const secret = randomUUID();
    const config = { get: (name: string) => name === 'JWT_ACCESS_SECRET' ? secret : '',
      getOrThrow: (name: string) => { if (name !== 'JWT_ACCESS_SECRET') throw new Error('Unknown synthetic config'); return secret; } };
    const module = await Test.createTestingModule({ imports: [JwtModule.register({})],
      controllers: [AdminTestAccountController], providers: [AdminTestAccountService, AdminAuthGuard, AdminPermissionGuard, JwtAuthGuard,
        { provide: PrismaService, useValue: db }, { provide: ConfigService, useValue: config }] }).compile();
    const app = module.createNestApplication({ logger: false });
    try {
      await app.listen(0, '127.0.0.1');
      const address = app.getHttpServer().address();
      const path = `http://127.0.0.1:${address.port}/admin/api/v1/users/${targetId}/test-account-classification`;
      const request = (init?: RequestInit) => fetch(path, { ...init, signal: AbortSignal.timeout(5000) });
      const anonymous = await request();
      expect(anonymous.status).toBe(401);
      await anonymous.arrayBuffer();
      const jwt = module.get(JwtService);
      const ordinary = await jwt.signAsync({ sub: anotherId, tokenType: 'access' }, { secret, expiresIn: '60s' });
      const forbidden = await request({ headers: { Authorization: `Bearer ${ordinary}` } });
      expect(forbidden.status).toBe(403);
      await forbidden.arrayBuffer();
      const full = await jwt.signAsync({ sub: actor.id, tokenType: 'access' }, { secret, expiresIn: '60s' });
      const headers = { Authorization: `Bearer ${full}` };
      const read = await request({ headers });
      expect(read.status).toBe(200);
      expect(read.headers.get('cache-control')).toBe('private, no-store');
      const before = await read.json() as any;
      const command = { classification: 'test', expectedRevision: before.state.revision, reasonCode: 'qa_owned' };
      const result = await request({ method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': `synthetic-http-${randomUUID()}` }, body: JSON.stringify(command) });
      expect(result.status).toBe(201);
      expect(await result.json()).toMatchObject({ permissionChanges: false, current: { classification: 'test', revision: before.state.revision + 1 } });
      const invalid = await request({ method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': `synthetic-http-${randomUUID()}` }, body: JSON.stringify({ ...command, classification: 'real_customer' }) });
      expect(invalid.status).toBe(400);
      await invalid.arrayBuffer();
    } finally {
      app.getHttpServer().closeIdleConnections();
      await app.close();
    }
  }, 30000);
});

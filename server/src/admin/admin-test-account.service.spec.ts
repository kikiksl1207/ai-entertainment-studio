import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AdminTestAccountService } from './admin-test-account.service';
import { AdminTestAccountController } from './admin-test-account.controller';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { ADMIN_PERMISSIONS_KEY } from '../auth/decorators/admin-permissions.decorator';
import { GUARDS_METADATA } from '@nestjs/common/constants';

const actorId = '00000000-0000-4000-8000-000000000001';
const targetId = '00000000-0000-4000-8000-000000000002';
const actor = { id: actorId, adminPermissions: ['*'] };
const body = { classification: 'test', expectedRevision: 0, reasonCode: 'manual_confirmation' };
const key = 'synthetic-classification-key';
function fixture() {
  let state: any = null;
  const changes: any[] = [];
  const tx = {
    $queryRaw: jest.fn(async (sql) => sql.sql.includes('admin_users') ? [{ status: 'active', permissions: ['*'] }] : []),
    user: { findUnique: jest.fn(async ({ where }) => where.id === actorId
      ? { status: 'active', deletedAt: null, email: null as string | null } : where.id === targetId ? { id: targetId } : null) },
    adminTestAccountState: {
      findUnique: jest.fn(async () => state),
      create: jest.fn(async ({ data }) => (state = data)),
      update: jest.fn(async ({ data }) => (state = { ...state, ...data })),
    },
    adminTestAccountChange: {
      findUnique: jest.fn(async ({ where }) => changes.find(change => change.actorUserId === where.actorUserId_requestKeyHash.actorUserId &&
        change.requestKeyHash === where.actorUserId_requestKeyHash.requestKeyHash) ?? null),
      findMany: jest.fn(async () => [...changes].reverse().map(({ id, revision, classification, reasonCode, createdAt }) =>
        ({ id, revision, classification, reasonCode, createdAt }))),
      create: jest.fn(async ({ data }) => { const change = { ...data, id: targetId, createdAt: new Date('2026-10-05T00:00:00Z') }; changes.push(change); return change; }),
    },
    auditEvent: { create: jest.fn(async () => ({})) },
  };
  const prisma = { $transaction: jest.fn(async callback => callback(tx)) };
  const config = { get: jest.fn(() => '') };
  return { tx, prisma, config, changes, service: new AdminTestAccountService(prisma as unknown as PrismaService, config as unknown as ConfigService) };
}

describe('Admin explicit test account declarations', () => {
  it('uses both existing admin guards and the existing full-permission boundary', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminTestAccountController)).toEqual([AdminAuthGuard, AdminPermissionGuard]);
    expect(Reflect.getMetadata(ADMIN_PERMISSIONS_KEY, AdminTestAccountController)).toEqual(['*']);
  });
  it('reads unclassified baseline without declaring an ordinary or real customer', async () => {
    const { service, tx } = fixture();
    expect(await service.get(actor, targetId)).toMatchObject({ readOnly: true,
      state: { classification: 'unclassified', revision: 0, source: 'unclassified', updatedAt: null },
      history: [], policy: { realCustomerInference: false, permissionChanges: false } });
    expect(tx.adminTestAccountState.create).not.toHaveBeenCalled();
    expect(tx.adminTestAccountChange.create).not.toHaveBeenCalled();
  });
  it('writes explicit state, immutable command and audit in one transaction; raw key is not persisted', async () => {
    const { service, tx, prisma, changes } = fixture();
    const result = await service.set(actor, targetId, key, body);
    expect(result).toMatchObject({ idempotentReplay: false, receipt: { classification: 'test', revision: 1, reasonCode: 'manual_confirmation' },
      current: { classification: 'test', revision: 1, source: 'explicit_admin' }, permissionChanges: false });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'ReadCommitted', timeout: 10000 });
    expect(changes[0]).not.toHaveProperty('idempotencyKey');
    expect(changes[0].requestKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(tx.auditEvent.create.mock.calls)).not.toContain(key);
    expect(tx.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorType: 'admin',
      action: 'user.test_account_classification', metadata: expect.objectContaining({ permissionChanges: false, realCustomerInference: false }) }) });
  });
  it('replays the exact command once and returns current state rather than replacing a newer declaration', async () => {
    const { service, tx } = fixture();
    await service.set(actor, targetId, key, body);
    await service.set(actor, targetId, 'synthetic-clear-key', { classification: 'unclassified', expectedRevision: 1, reasonCode: 'clear' });
    const replay = await service.set(actor, targetId, key, body);
    expect(replay).toMatchObject({ idempotentReplay: true, receipt: { classification: 'test', revision: 1 },
      current: { classification: 'unclassified', revision: 2, source: 'explicit_admin' } });
    expect(tx.adminTestAccountChange.create).toHaveBeenCalledTimes(2);
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(2);
  });
  it('rejects reuse of a command key for a different payload', async () => {
    const { service, tx } = fixture();
    await service.set(actor, targetId, key, body);
    await expect(service.set(actor, targetId, key, { ...body, reasonCode: 'fixture' })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.adminTestAccountChange.create).toHaveBeenCalledTimes(1);
  });
  it('rejects stale revision without another audit or state write', async () => {
    const { service, tx } = fixture();
    await service.set(actor, targetId, key, body);
    await expect(service.set(actor, targetId, 'synthetic-second-key', body)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.adminTestAccountChange.create).toHaveBeenCalledTimes(1);
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });
  it.each([{ permissions: [] as string[] }, { permissions: ['audit:read'] }, { permissions: ['users:write'] }])('rejects non-full permission $permissions before any DB transaction', async ({ permissions }) => {
    const { service, prisma } = fixture();
    await expect(service.set({ id: actorId, adminPermissions: permissions }, targetId, key, body)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('rechecks current role permission instead of trusting the captured guarded actor', async () => {
    const { service, tx } = fixture();
    tx.$queryRaw.mockResolvedValue([]);
    await expect(service.set(actor, targetId, key, body)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.adminTestAccountChange.create).not.toHaveBeenCalled();
  });
  it('allows only the existing bootstrap grant while still leaving the target unclassified', async () => {
    const { service, tx, config } = fixture();
    tx.$queryRaw.mockResolvedValue([]);
    config.get.mockReturnValue('synthetic-bootstrap@example.test');
    tx.user.findUnique.mockImplementation(async ({ where }) => where.id === actorId
      ? { status: 'active', deletedAt: null, email: 'synthetic-bootstrap@example.test' } : { id: targetId });
    expect((await service.get(actor, targetId)).state.classification).toBe('unclassified');
    expect(tx.adminTestAccountChange.create).not.toHaveBeenCalled();
  });
  it('rejects a deleted or suspended actor even with an old full grant', async () => {
    const { service, tx } = fixture();
    tx.user.findUnique.mockResolvedValue({ status: 'suspended', deletedAt: null, email: null });
    await expect(service.set(actor, targetId, key, body)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.adminTestAccountChange.create).not.toHaveBeenCalled();
  });
  it('rejects nonexistent target and invalid input without exposing raw fields', async () => {
    const { service, prisma } = fixture();
    await expect(service.get(actor, 'malformed')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    await expect(service.get(actor, '00000000-0000-4000-8000-000000000003')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('maps persistence failures to a clean unavailable response rather than fabricating zero state', async () => {
    const { service, tx } = fixture();
    tx.adminTestAccountChange.create.mockRejectedValue(new Error('Synthetic private DB diagnostic'));
    await expect(service.set(actor, targetId, key, body)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(tx.adminTestAccountState.create).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });
});

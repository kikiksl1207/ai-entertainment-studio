import { AuthService } from './auth.service';
import * as bcrypt from 'bcryptjs';

jest.mock('bcryptjs', () => ({ compare: jest.fn(), hash: jest.fn() }));

function fixture() {
  const user = { id: '00000000-0000-4000-8000-000000000071',
    email: 'closure-fixture@example.invalid', status: 'active', deletedAt: null, authAccounts: [] };
  const updated = { ...user, status: 'deleted', deletedAt: new Date(), updatedAt: new Date() };
  const makeModels = () => ({
    user: { update: jest.fn().mockResolvedValue(updated) },
    userRefreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    userActionToken: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
    userReferralCode: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    auditEvent: { create: jest.fn().mockResolvedValue({ id: 'synthetic-audit' }) },
  });
  const tx = makeModels();
  const prisma = { ...makeModels(), user: { ...makeModels().user,
    findFirst: jest.fn().mockResolvedValue(user) },
    $transaction: jest.fn(async (input: unknown) => typeof input === 'function'
      ? input(tx) : Promise.all(input as Array<Promise<unknown>>)) };
  const service = new AuthService(prisma as never, {} as never, {} as never, {} as never, {} as never);
  return { user, updated, tx, prisma, service };
}

describe('account deletion audit atomicity', () => {
  it('writes the audit and every closure change through the same transaction', async () => {
    const f = fixture();
    const result = await f.service.deleteAccount(f.user.id, { reason: 'fixture closure' });
    expect(result).toMatchObject({ ok: true, revokedSessionCount: 2, user: { status: 'deleted' } });
    expect(f.tx.user.update).toHaveBeenCalledTimes(1);
    expect(f.tx.userRefreshToken.updateMany).toHaveBeenCalledTimes(1);
    expect(f.tx.userActionToken.updateMany).toHaveBeenCalledTimes(1);
    expect(f.tx.userReferralCode.updateMany).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'user.self_delete', actorUserId: f.user.id }) }));
    expect(f.prisma.auditEvent.create).not.toHaveBeenCalled();
    expect(f.prisma.user.update).not.toHaveBeenCalled();
  });

  it('propagates an audit failure inside the transaction instead of failing after commit', async () => {
    const f = fixture();
    const failure = new Error('synthetic audit failure');
    f.tx.auditEvent.create.mockRejectedValue(failure);
    await expect(f.service.deleteAccount(f.user.id, {})).rejects.toBe(failure);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(f.prisma.auditEvent.create).not.toHaveBeenCalled();
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does not write an audit outside the transaction when the user update fails', async () => {
    const f = fixture();
    const failure = new Error('synthetic update failure');
    f.tx.user.update.mockRejectedValue(failure);
    await expect(f.service.deleteAccount(f.user.id, {})).rejects.toBe(failure);
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(f.prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('propagates a session-write failure without reporting a successful closure', async () => {
    const f = fixture();
    const failure = new Error('synthetic revocation failure');
    f.tx.userRefreshToken.updateMany.mockRejectedValue(failure);
    await expect(f.service.deleteAccount(f.user.id, {})).rejects.toBe(failure);
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('retains the active-account gate before any transaction', async () => {
    const f = fixture(); f.prisma.user.findFirst.mockResolvedValue(null);
    await expect(f.service.deleteAccount(f.user.id, {})).rejects.toMatchObject({ status: 400 });
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires the existing email password before entering a transaction', async () => {
    const f = fixture();
    f.prisma.user.findFirst.mockResolvedValue({ ...f.user, authAccounts: [{ passwordHash: 'fixture' }] });
    await expect(f.service.deleteAccount(f.user.id, {})).rejects.toMatchObject({ status: 400 });
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects the wrong password without transaction writes', async () => {
    const f = fixture();
    f.prisma.user.findFirst.mockResolvedValue({ ...f.user, authAccounts: [{ passwordHash: 'fixture' }] });
    jest.mocked(bcrypt.compare).mockImplementationOnce(async () => false as never);
    await expect(f.service.deleteAccount(f.user.id, { currentPassword: 'incorrect-fixture' }))
      .rejects.toMatchObject({ status: 401 });
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('retains the verified-password path without adding a new closure policy', async () => {
    const f = fixture();
    f.prisma.user.findFirst.mockResolvedValue({ ...f.user, authAccounts: [{ passwordHash: 'fixture' }] });
    jest.mocked(bcrypt.compare).mockImplementationOnce(async () => true as never);
    await expect(f.service.deleteAccount(f.user.id, { currentPassword: 'valid-fixture' }))
      .resolves.toMatchObject({ ok: true, revokedSessionCount: 2 });
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });
});

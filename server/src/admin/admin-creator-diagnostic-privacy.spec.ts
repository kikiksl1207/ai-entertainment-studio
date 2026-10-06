import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_AT = new Date('2026-10-01T00:00:00Z');
const LOGIN_AT = new Date('2026-10-06T00:00:00Z');

function fixture(subject: string) {
  return {
    id: USER_ID, email: 'diagnostic@example.invalid', status: 'active', deletedAt: null,
    createdAt: CREATED_AT, profile: null, artistOperators: [], debutApplications: [], adminAccess: null,
    authAccounts: [{ provider: 'google', providerUserId: subject, lastLoginAt: LOGIN_AT, createdAt: CREATED_AT,
      passwordHash: 'SYNTHETIC_HASH', refreshToken: 'SYNTHETIC_TOKEN', metadata: { secret: 'SYNTHETIC_PRIVATE' } }],
  };
}

function harness(rows: unknown[]) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const service = new AdminService({ user: { findMany } } as unknown as PrismaService,
    { get: jest.fn() } as unknown as ConfigService);
  return { service, findMany };
}

describe('Creator access diagnostics authentication summary', () => {
  it('masks the latest subject identically to the account list and excludes future private fields', async () => {
    const subject = 'SYNTHETIC_PROVIDER_SUBJECT_0123456789';
    const { service } = harness([fixture(subject)]);
    const result = await service.getBackstageCreatorAccessDiagnostics({ userId: USER_ID });
    expect(result.result.latestAuthAccount?.providerUserId).toBe('SYNT***6789');
    expect(result.users[0].authAccounts[0].providerUserId).toBe('SYNT***6789');
    expect(Object.keys(result.result.latestAuthAccount!).sort()).toEqual(['createdAt', 'email', 'lastLoginAt', 'provider', 'providerUserId', 'userId']);
    expect(Object.keys(result.users[0].authAccounts[0]).sort()).toEqual(['createdAt', 'lastLoginAt', 'provider', 'providerUserId']);
    for (const value of [subject, 'SYNTHETIC_HASH', 'SYNTHETIC_TOKEN', 'SYNTHETIC_PRIVATE']) expect(JSON.stringify(result)).not.toContain(value);
  });

  it('keeps the established mask for empty, short and boundary-length subjects', async () => {
    for (const subject of ['', 'x', '12345678', '123456789']) {
      const { service } = harness([fixture(subject)]);
      const result = await service.getBackstageCreatorAccessDiagnostics({ userId: USER_ID });
      expect(result.result.latestAuthAccount?.providerUserId).toBe(subject.length <= 8 ? '***' : '1234***6789');
      expect(result.users[0].authAccounts[0].providerUserId).toBe(result.result.latestAuthAccount?.providerUserId);
    }
  });

  it('keeps latest ordering and null login dates without changing creator access', async () => {
    const row = fixture('OLDER_PROVIDER_1234');
    row.authAccounts[0].lastLoginAt = CREATED_AT;
    const newer = { ...row.authAccounts[0], providerUserId: 'NEWER_PROVIDER_5678', lastLoginAt: null, createdAt: LOGIN_AT };
    const user = { ...row, authAccounts: [...row.authAccounts, newer], debutApplications: [{ id: USER_ID,
      applicantName: 'Synthetic Creator', displayName: null, contactEmail: 'contact@example.invalid', participationType: 'creator', updatedAt: LOGIN_AT }] };
    const { service } = harness([user]);
    const result = await service.getBackstageCreatorAccessDiagnostics({ userId: USER_ID });
    expect(result.result.latestAuthAccount?.providerUserId).toBe('NEWE***5678');
    expect(result.result.latestAuthAccount?.lastLoginAt).toBeNull();
    expect(result.result.accessEnabled).toBe(true);
    expect(result.result.approvedApplicationsCount).toBe(1);
    expect(result.users[0].approvedApplications[0].contactEmail).toBe('contact@example.invalid');
  });

  it('does not manufacture a latest login or access for empty matches', async () => {
    for (const rows of [[], [{ ...fixture('ignored'), authAccounts: [] }]]) {
      const { service } = harness(rows);
      const result = await service.getBackstageCreatorAccessDiagnostics({ userId: USER_ID });
      expect(result.result.latestAuthAccount).toBeNull();
      expect(result.result.exactMatchCount).toBe(rows.length);
      expect(result.result.accessEnabled).toBe(false);
    }
  });

  it('rejects invalid input before any database read', async () => {
    const { service, findMany } = harness([]);
    for (const query of [{}, { userId: 'bad-uuid' }]) await expect(service.getBackstageCreatorAccessDiagnostics(query)).rejects.toBeInstanceOf(BadRequestException);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('preserves database failure without success fallback or automatic retry', async () => {
    const { service, findMany } = harness([]);
    findMany.mockRejectedValue(new Error('Synthetic unavailable database'));
    await expect(service.getBackstageCreatorAccessDiagnostics({ userId: USER_ID })).rejects.toThrow('Synthetic unavailable database');
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});

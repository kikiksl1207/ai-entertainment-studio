import { ConfigService } from '@nestjs/config';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

const APPLICATION_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const OPERATOR_ID = '33333333-3333-4333-8333-333333333333';
const ARTIST_ID = '44444444-4444-4444-8444-444444444444';
const REQUESTER_ID = '55555555-5555-4555-8555-555555555555';
const CREATED_AT = new Date('2026-10-01T00:00:00Z');

function application(id = APPLICATION_ID) {
  return {
    id, userId: USER_ID, status: 'submitted',
    applicantName: 'Synthetic Private Name', displayName: 'Synthetic Stage',
    participationType: 'creator', shareTierRequested: null, shareTierApproved: null,
    contactEmail: 'contact@example.invalid', contactPhone: '00012345678',
    metadata: {}, createdAt: CREATED_AT, updatedAt: CREATED_AT,
    user: {
      id: USER_ID, email: 'login@example.invalid', status: 'active',
      profile: { displayName: 'Synthetic Public Profile', publicHandle: 'synthetic-public' },
      authAccounts: [], artistOperators: [],
    },
  };
}

function activeCreator() {
  return {
    id: OPERATOR_ID, userId: USER_ID, artistId: ARTIST_ID,
    role: 'creator', status: 'active', permissions: ['existing:synthetic'],
    createdAt: CREATED_AT, updatedAt: CREATED_AT,
    user: {
      id: USER_ID, email: 'operator@example.invalid', status: 'active',
      profile: { displayName: 'Synthetic Public Creator', avatarAssetId: null },
    },
    artist: { id: ARTIST_ID, slug: 'synthetic-artist', displayName: 'Synthetic Artist', status: 'active' },
  };
}

function requester(adminRole?: string, adminPermissions = ['creators:read']): AuthUser {
  return { id: REQUESTER_ID, adminRole, adminPermissions };
}

function harness(applications: unknown[] = [application()], creators: unknown[] = [activeCreator()]) {
  const reads = {
    debutApplication: {
      findMany: jest.fn().mockResolvedValue(applications),
      groupBy: jest.fn().mockResolvedValue([{ status: 'submitted', _count: { _all: applications.length } }]),
      count: jest.fn().mockResolvedValue(applications.length),
    },
    artistOperator: { findMany: jest.fn().mockResolvedValue(creators) },
    artist: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  };
  const service = new AdminService(
    reads as unknown as PrismaService,
    { get: jest.fn() } as unknown as ConfigService,
  );
  return { service, reads };
}

describe('Creator operations existing contact permission projection', () => {
  it.each([
    ['super_admin', true], ['sales_admin', false],
    ['business_admin', false], ['partnership_admin', false],
  ] as const)('preserves allowed %s contacts and existing payout flag', async (role, payout) => {
    const { service } = harness();
    const result = await service.getBackstageCreatorOperations(requester(role), {});
    expect(result.applications.items[0]).toMatchObject({
      realName: 'Synthetic Private Name', applicantName: 'Synthetic Private Name',
      contactEmail: 'contact@example.invalid', contactPhone: '00012345678',
      contactMasked: false, contactAccessAllowed: true, payoutAccessAllowed: payout,
      user: { email: 'login@example.invalid' },
    });
    expect(result.activeCreators[0].user.email).toBe('operator@example.invalid');
    expect(result.permissions).toEqual({
      contactAccessAllowed: true, payoutAccessAllowed: payout,
      contactMasked: false, payoutMasked: !payout,
    });
  });

  it('keeps the existing raw wildcard grant behavior without granting anything', async () => {
    const { service } = harness();
    const user = requester('content_admin', ['*']);
    const result = await service.getBackstageCreatorOperations(user, {});
    expect(result.applications.items[0].user.email).toBe('login@example.invalid');
    expect(result.permissions).toEqual({
      contactAccessAllowed: true, payoutAccessAllowed: true, contactMasked: false, payoutMasked: false,
    });
    expect(user).toEqual({ id: REQUESTER_ID, adminRole: 'content_admin', adminPermissions: ['*'] });
  });

  it.each([
    ['content_admin', false], ['accounting_admin', true],
    ['commerce_admin', true], ['unrecognized_role', false], [undefined, false],
  ] as const)('removes private aliases for %s without changing public names or masking', async (role, payout) => {
    const { service } = harness();
    const result = await service.getBackstageCreatorOperations(requester(role), {});
    expect(result.applications.items[0]).toMatchObject({
      realName: null, applicantName: null, stageName: 'Synthetic Stage', displayName: 'Synthetic Stage',
      contactEmail: 'co***@example.invalid', contactPhone: '000-****-5678',
      contactMasked: true, contactAccessAllowed: false, payoutAccessAllowed: payout,
      user: {
        email: null, status: 'active',
        profile: { displayName: 'Synthetic Public Profile', publicHandle: 'synthetic-public' },
      },
    });
    expect(result.activeCreators[0]).toMatchObject({
      role: 'creator', permissions: ['existing:synthetic'],
      user: { email: 'op***@example.invalid', profile: { displayName: 'Synthetic Public Creator' } },
      artist: { displayName: 'Synthetic Artist', slug: 'synthetic-artist' },
    });
    expect(result.permissions).toEqual({
      contactAccessAllowed: false, payoutAccessAllowed: payout, contactMasked: true, payoutMasked: !payout,
    });
  });

  it('preserves every allowed contact search clause, status, cursor and page size', async () => {
    const { service, reads } = harness();
    await service.getBackstageCreatorOperations(requester('sales_admin'), {
      query: '  contact@example.invalid  ', status: 'submitted', take: '2', cursor: APPLICATION_ID,
    });
    expect(reads.debutApplication.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: 'submitted', OR: [
          { applicantName: { contains: 'contact@example.invalid', mode: 'insensitive' } },
          { displayName: { contains: 'contact@example.invalid', mode: 'insensitive' } },
          { contactEmail: { contains: 'contact@example.invalid', mode: 'insensitive' } },
          { user: { email: { contains: 'contact@example.invalid', mode: 'insensitive' } } },
        ],
      }, take: 3, cursor: { id: APPLICATION_ID }, skip: 1, orderBy: { createdAt: 'desc' },
    }));
  });

  it.each([
    ['query', 'Synthetic Private Name'], ['q', 'login@example.invalid'],
    ['query', 'contact@example.invalid'],
  ] as const)('restricts forbidden %s=%s searches to public displayName', async (key, term) => {
    const { service, reads } = harness([], []);
    const result = await service.getBackstageCreatorOperations(requester('content_admin'), { [key]: term });
    expect(reads.debutApplication.findMany.mock.calls[0][0].where).toEqual({
      OR: [{ displayName: { contains: term, mode: 'insensitive' } }],
    });
    expect(reads.artist.findMany.mock.calls[0][0].where).toEqual({
      OR: [
        { displayName: { contains: term, mode: 'insensitive' } },
        { slug: { contains: term, mode: 'insensitive' } },
      ],
    });
    expect(result.applications.items).toEqual([]);
  });

  it('continues public stage-name search and preserves paginated projection', async () => {
    const { service, reads } = harness([
      application(APPLICATION_ID), application('66666666-6666-4666-8666-666666666666'),
    ]);
    const result = await service.getBackstageCreatorOperations(requester('content_admin'), {
      query: 'Synthetic Stage', take: '1',
    });
    expect(reads.debutApplication.findMany.mock.calls[0][0].where).toEqual({
      OR: [{ displayName: { contains: 'Synthetic Stage', mode: 'insensitive' } }],
    });
    expect(result.applications).toMatchObject({ count: 1, hasMore: true, nextCursor: APPLICATION_ID });
    expect(result.applications.items).toHaveLength(1);
    expect(result.applications.items[0].realName).toBeNull();
    expect(result.applications.items[0].stageName).toBe('Synthetic Stage');
  });

  it('does not create a filter or sample fallback for an empty unsearched result', async () => {
    const { service, reads } = harness([], []);
    const result = await service.getBackstageCreatorOperations(requester('content_admin'), { query: '  ' });
    expect(reads.debutApplication.findMany.mock.calls[0][0].where).toEqual({});
    expect(result.applications).toEqual({ items: [], count: 0, hasMore: false, nextCursor: null });
    expect(result.activeCreators).toEqual([]);
    expect(result.aiArtists).toEqual([]);
    expect(result.summary).toEqual({
      newApplications: 0, applicationsByStatus: { submitted: 0 }, activeArtistOperators: 0, aiArtists: 0,
    });
  });

  it('preserves null contact masking without synthesizing values', async () => {
    const row = { ...application(), contactEmail: null, contactPhone: null };
    const { service } = harness([row]);
    const result = await service.getBackstageCreatorOperations(requester('content_admin'), {});
    expect(result.applications.items[0]).toMatchObject({
      contactEmail: null, contactPhone: null, realName: null, applicantName: null, user: { email: null },
    });
  });

  it('propagates a reader failure without fallback, retry or mutation', async () => {
    const { service, reads } = harness();
    const failure = new Error('Synthetic reader unavailable');
    reads.debutApplication.findMany.mockRejectedValueOnce(failure);
    await expect(service.getBackstageCreatorOperations(requester('content_admin'), {})).rejects.toBe(failure);
    expect(reads.debutApplication.findMany).toHaveBeenCalledTimes(1);
    expect(Object.keys(reads.debutApplication).sort()).toEqual(['count', 'findMany', 'groupBy']);
    expect(Object.keys(reads.artistOperator)).toEqual(['findMany']);
    expect(Object.keys(reads.artist).sort()).toEqual(['count', 'findMany']);
  });
});

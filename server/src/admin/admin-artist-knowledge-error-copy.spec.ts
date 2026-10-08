import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthUser } from '../auth/auth.types';
import { ARTIST_URL_KNOWLEDGE_CONTRACT } from '../chat/artist-url-knowledge-contract';
import { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

const VALID_UUID = '00000000-0000-4000-8000-000000000901';
const SYNTHETIC_USER: AuthUser = {
  id: '00000000-0000-4000-8000-000000000902',
};
const REQUEST_MESSAGE = '자료 URL 요청 정보를 확인해 주세요.';
const STATUSES = ['pending', 'approved', 'rejected', 'archived'];
const ACTIONS = [
  'creator_studio.artist_knowledge_url.create',
  'creator_studio.artist_knowledge_url.update',
  'creator_studio.artist_knowledge_url.archive',
  'artist_knowledge_url.approve',
  'artist_knowledge_url.reject',
  'artist_knowledge_url.archive',
];

function createService() {
  const forbiddenWrite = () =>
    jest.fn().mockImplementation(() => {
      throw new Error('QA_WRITE_FORBIDDEN');
    });
  const prisma = {
    artistKnowledgeUrl: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: forbiddenWrite(),
      update: forbiddenWrite(),
      delete: forbiddenWrite(),
    },
    auditEvent: {
      findMany: jest.fn().mockResolvedValue([]),
      create: forbiddenWrite(),
    },
    $transaction: forbiddenWrite(),
    $executeRaw: forbiddenWrite(),
    $executeRawUnsafe: forbiddenWrite(),
  };
  const writes = [
    prisma.artistKnowledgeUrl.create,
    prisma.artistKnowledgeUrl.update,
    prisma.artistKnowledgeUrl.delete,
    prisma.auditEvent.create,
    prisma.$transaction,
    prisma.$executeRaw,
    prisma.$executeRawUnsafe,
  ];
  const service = new AdminService(
    prisma as unknown as PrismaService,
    { get: jest.fn() } as unknown as ConfigService,
  );
  return { service, prisma, writes };
}

function expectNoWrites(writes: jest.Mock[]) {
  for (const write of writes) {
    expect(write).not.toHaveBeenCalled();
  }
}

type InvalidCase = {
  name: string;
  invoke: (service: AdminService) => Promise<unknown>;
  body: Record<string, unknown>;
};

const invalidCases: InvalidCase[] = [
  {
    name: 'list artistId',
    invoke: (service) =>
      service.getBackstageArtistKnowledgeUrls({ artistId: 'not-a-uuid' }),
    body: {
      code: 'ARTIST_KNOWLEDGE_URL_INVALID_ID',
      messageKey: 'artistKnowledgeUrl.error.invalidId',
      message: REQUEST_MESSAGE,
      details: { field: 'artistId' },
    },
  },
  {
    name: 'list status',
    invoke: (service) =>
      service.getBackstageArtistKnowledgeUrls({ status: 'draft' }),
    body: {
      code: 'ARTIST_KNOWLEDGE_URL_STATUS_INVALID',
      messageKey: 'artistKnowledgeUrl.error.statusInvalid',
      message: '자료 URL 상태 필터를 확인해 주세요.',
      details: { supportedStatuses: STATUSES },
    },
  },
  {
    name: 'audit action',
    invoke: (service) =>
      service.getBackstageArtistKnowledgeUrlAuditEvents({ action: 'unsupported' }),
    body: {
      code: 'ARTIST_KNOWLEDGE_URL_AUDIT_ACTION_INVALID',
      messageKey: 'artistKnowledgeUrl.error.auditActionInvalid',
      message: '자료 URL 감사 로그 필터를 확인해 주세요.',
      details: { supportedActions: ACTIONS },
    },
  },
  {
    name: 'audit targetId',
    invoke: (service) =>
      service.getBackstageArtistKnowledgeUrlAuditEvents({ targetId: 'not-a-uuid' }),
    body: {
      code: 'ARTIST_KNOWLEDGE_URL_INVALID_ID',
      messageKey: 'artistKnowledgeUrl.error.invalidId',
      message: REQUEST_MESSAGE,
      details: { field: 'targetId' },
    },
  },
  {
    name: 'audit artistId',
    invoke: (service) =>
      service.getBackstageArtistKnowledgeUrlAuditEvents({ artistId: 'not-a-uuid' }),
    body: {
      code: 'ARTIST_KNOWLEDGE_URL_INVALID_ID',
      messageKey: 'artistKnowledgeUrl.error.invalidId',
      message: REQUEST_MESSAGE,
      details: { field: 'artistId' },
    },
  },
  {
    name: 'shared UUID validator through approve',
    invoke: (service) =>
      service.approveBackstageArtistKnowledgeUrl(SYNTHETIC_USER, 'not-a-uuid', {}),
    body: {
      code: 'ARTIST_KNOWLEDGE_URL_INVALID_ID',
      messageKey: 'artistKnowledgeUrl.error.invalidId',
      message: REQUEST_MESSAGE,
      details: { field: 'knowledgeUrlId' },
    },
  },
];

describe('AdminService artist-knowledge error copy only', () => {
  it.each(invalidCases)('$name rejects before reads or writes', async ({ invoke, body }) => {
    const { service, prisma, writes } = createService();
    const error = await invoke(service).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    const exception = error as BadRequestException;
    expect(exception.getStatus()).toBe(400);
    expect(exception.getResponse()).toEqual(body);
    expect(JSON.stringify(exception.getResponse())).not.toContain('\uFFFD');
    expect(prisma.artistKnowledgeUrl.findMany).not.toHaveBeenCalled();
    expect(prisma.artistKnowledgeUrl.findUnique).not.toHaveBeenCalled();
    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
    expectNoWrites(writes);
  });

  it('accepts a trimmed valid list artistId with the original reader', async () => {
    const { service, prisma, writes } = createService();
    const result = await service.getBackstageArtistKnowledgeUrls({
      artistId: ` ${VALID_UUID} `,
    });

    expect(prisma.artistKnowledgeUrl.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.artistKnowledgeUrl.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { artistId: VALID_UUID },
        take: 51,
        orderBy: [{ createdAt: 'desc' }],
      }),
    );
    expect(result).toEqual({
      items: [], count: 0, hasMore: false, nextCursor: null,
      contract: ARTIST_URL_KNOWLEDGE_CONTRACT.apiContracts.adminList,
    });
    expectNoWrites(writes);
  });

  it('accepts every original list status without a mutation', async () => {
    const { service, prisma, writes } = createService();
    for (const status of STATUSES) {
      const result = await service.getBackstageArtistKnowledgeUrls({ status });
      expect(prisma.artistKnowledgeUrl.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { status } }),
      );
      expect(result.items).toEqual([]);
    }
    expect(prisma.artistKnowledgeUrl.findMany).toHaveBeenCalledTimes(STATUSES.length);
    expectNoWrites(writes);
  });

  it('accepts every original audit action through the native read projection', async () => {
    const { service, prisma, writes } = createService();
    for (const action of ACTIONS) {
      const result = await service.getBackstageArtistKnowledgeUrlAuditEvents({ action });
      expect(prisma.auditEvent.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: {
            targetType: 'artist_knowledge_url',
            targetId: { not: null },
            action,
          },
        }),
      );
      expect(result.items).toEqual([]);
      expect(result.policy).toMatchObject({ permission: 'audit:read', mutation: false });
    }
    expect(prisma.auditEvent.findMany).toHaveBeenCalledTimes(ACTIONS.length);
    expectNoWrites(writes);
  });

  it('accepts a trimmed valid audit targetId without changing the predicate', async () => {
    const { service, prisma, writes } = createService();
    await service.getBackstageArtistKnowledgeUrlAuditEvents({ targetId: ` ${VALID_UUID} ` });

    expect(prisma.auditEvent.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { targetType: 'artist_knowledge_url', targetId: VALID_UUID },
      }),
    );
    expectNoWrites(writes);
  });

  it('accepts a valid audit artistId with both original JSON predicates', async () => {
    const { service, prisma, writes } = createService();
    await service.getBackstageArtistKnowledgeUrlAuditEvents({ artistId: VALID_UUID });

    expect(prisma.auditEvent.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          targetType: 'artist_knowledge_url',
          targetId: { not: null },
          OR: [
            { beforeData: { path: ['artistId'], equals: VALID_UUID } },
            { afterData: { path: ['artistId'], equals: VALID_UUID } },
          ],
        },
      }),
    );
    expectNoWrites(writes);
  });

  it('allows a valid shared UUID to reach the missing-record reader, not approval writes', async () => {
    const { service, prisma, writes } = createService();
    const error = await service.approveBackstageArtistKnowledgeUrl(
      SYNTHETIC_USER, VALID_UUID, {},
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getStatus()).toBe(404);
    expect((error as NotFoundException).getResponse()).toMatchObject({
      code: 'ARTIST_KNOWLEDGE_URL_NOT_FOUND',
      messageKey: 'artistKnowledgeUrl.error.notFound',
    });
    expect(prisma.artistKnowledgeUrl.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.artistKnowledgeUrl.findUnique).toHaveBeenCalledWith({ where: { id: VALID_UUID } });
    expect(prisma.artistKnowledgeUrl.findMany).not.toHaveBeenCalled();
    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
    expectNoWrites(writes);
  });
});

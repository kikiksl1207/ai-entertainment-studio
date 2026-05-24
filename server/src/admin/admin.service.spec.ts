import { BadRequestException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

type PrismaMock = {
  userActionToken: {
    findMany: jest.Mock;
    count: jest.Mock;
  };
};

function createService() {
  const prisma: PrismaMock = {
    userActionToken: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };
  const config = {
    get: jest.fn(),
  };
  const service = new AdminService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
  );

  return { service, prisma };
}

async function expectHttpError(
  promise: Promise<unknown>,
  expected: Record<string, unknown>,
) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getResponse()).toMatchObject(expected);
    return;
  }

  throw new Error('Expected promise to reject');
}

describe('AdminService auth action token audit', () => {
  it('returns masked target and omits sensitive token fields', async () => {
    const { service, prisma } = createService();
    const createdAt = new Date('2026-05-14T00:00:00.000Z');
    const expiresAt = new Date('2099-01-01T00:00:00.000Z');
    const attemptedAt = new Date('2026-05-14T00:01:00.000Z');
    const acceptedAt = new Date('2026-05-14T00:01:01.000Z');

    prisma.userActionToken.findMany.mockResolvedValue([
      {
        id: '00000000-0000-4000-8000-000000000101',
        userId: '00000000-0000-4000-8000-000000000001',
        purpose: 'email_verification',
        tokenHash: 'hash-value-must-not-leak',
        createdAt,
        expiresAt,
        consumedAt: null,
        deliveryStatus: 'accepted',
        deliveryChannel: 'email',
        deliveryProvider: 'resend',
        deliveryAttemptedAt: attemptedAt,
        deliveryAcceptedAt: acceptedAt,
        deliveryFailedAt: null,
        targetEmailMasked: 'qa***@example.com',
        user: {
          id: '00000000-0000-4000-8000-000000000001',
          email: 'qa@example.com',
          status: 'active',
          deletedAt: null,
          emailVerifiedAt: null,
        },
      },
    ]);
    prisma.userActionToken.count.mockResolvedValue(1);

    const result = await service.getAuthActionTokens({
      purpose: 'email_verification',
      status: 'pending',
      deliveryStatus: 'accepted',
      deliveryProvider: 'resend',
    });

    expect(prisma.userActionToken.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          purpose: 'email_verification',
          consumedAt: null,
          expiresAt: { gt: expect.any(Date) },
          deliveryStatus: 'accepted',
          deliveryProvider: { equals: 'resend', mode: 'insensitive' },
        }),
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      purpose: 'email_verification',
      status: 'pending',
      delivery: {
        status: 'accepted',
        channel: 'email',
        provider: 'resend',
        persisted: true,
        attemptedAt,
        acceptedAt,
        failedAt: null,
      },
      target: {
        userId: '00000000-0000-4000-8000-000000000001',
        emailMasked: 'qa***@example.com',
        userStatus: 'active',
        emailVerified: false,
        deleted: false,
      },
      sensitiveFields: {
        rawTokenReturned: false,
        tokenHashReturned: false,
        rawEmailReturned: false,
        mailBodyReturned: false,
      },
    });
    expect(result.filters).toMatchObject({
      purpose: 'email_verification',
      status: 'pending',
      deliveryStatus: 'accepted',
      deliveryProvider: 'resend',
      email: null,
    });
    expect(result.policy).toMatchObject({
      supportedDeliveryStatuses: expect.arrayContaining(['accepted', 'failed']),
      supportedDeliveryProviders: expect.arrayContaining(['resend', 'sendgrid', 'none']),
      requestCooldownSeconds: 60,
      duplicatePendingTokenPolicy:
        'reuse_recent_pending_token_within_cooldown_else_consume_previous',
      cooldownDuplicateRequestsCreateNewRow: false,
    });
    expect(JSON.stringify(result)).not.toContain('hash-value-must-not-leak');
    expect(JSON.stringify(result)).not.toContain('qa@example.com');
  });

  it('supports filtering delivery rows without a provider', async () => {
    const { service, prisma } = createService();

    prisma.userActionToken.findMany.mockResolvedValue([]);
    prisma.userActionToken.count.mockResolvedValue(0);

    const result = await service.getAuthActionTokens({
      deliveryStatus: 'not_configured',
      deliveryProvider: 'none',
    });

    expect(prisma.userActionToken.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deliveryStatus: 'not_configured',
          deliveryProvider: null,
        }),
      }),
    );
    expect(result.filters).toMatchObject({
      deliveryStatus: 'not_configured',
      deliveryProvider: 'none',
    });
  });

  it('rejects unsupported purposes with a stable admin error', async () => {
    const { service } = createService();

    try {
      await service.getAuthActionTokens({ purpose: 'magic_link' });
      throw new Error('Expected invalid purpose to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'AUTH_ACTION_TOKEN_INVALID_PURPOSE',
        messageKey: 'admin.authActionTokens.invalidPurpose',
      });
    }
  });

  it('rejects unsupported delivery filters with stable admin errors', async () => {
    const { service } = createService();

    await expect(service.getAuthActionTokens({ deliveryStatus: 'sent' })).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AUTH_ACTION_TOKEN_INVALID_DELIVERY_STATUS',
        messageKey: 'admin.authActionTokens.invalidDeliveryStatus',
      }),
    });

    await expect(service.getAuthActionTokens({ deliveryProvider: 'smtp' })).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AUTH_ACTION_TOKEN_INVALID_DELIVERY_PROVIDER',
        messageKey: 'admin.authActionTokens.invalidDeliveryProvider',
      }),
    });
  });
});

describe('AdminService artist knowledge URL operations', () => {
  const adminUser = {
    id: '00000000-0000-4000-8000-000000000900',
    email: 'admin@example.com',
    role: 'admin',
    adminPermissions: ['artists:write'],
  };
  const row = {
    id: '00000000-0000-4000-8000-000000000230',
    artistId: '00000000-0000-4000-8000-000000000221',
    submittedByUserId: '00000000-0000-4000-8000-000000000220',
    reviewedByUserId: null,
    status: 'pending',
    sourceType: 'youtube',
    url: 'https://www.youtube.com/watch?v=abc',
    canonicalUrl: 'https://www.youtube.com/watch?v=abc',
    artistDescription: 'Behind the scenes rehearsal update.',
    summary: 'Behind the scenes rehearsal update.',
    allowChatReference: true,
    rejectionReason: null,
    metadata: {},
    createdAt: new Date('2026-05-22T00:00:00.000Z'),
    updatedAt: new Date('2026-05-22T00:00:00.000Z'),
    reviewedAt: null,
    archivedAt: null,
    artist: {
      id: '00000000-0000-4000-8000-000000000221',
      slug: 'test-creator',
      displayName: 'Test Creator',
      status: 'active',
    },
    submittedBy: {
      id: '00000000-0000-4000-8000-000000000220',
      email: 'creator@example.com',
    },
    reviewedBy: null,
  };

  function createKnowledgeService(overrides: Record<string, unknown> = {}) {
    const prisma = {
      artistKnowledgeUrl: {
        findMany: jest.fn().mockResolvedValue([row]),
        findUnique: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue({
          ...row,
          status: 'approved',
          reviewedByUserId: adminUser.id,
          reviewedBy: { id: adminUser.id, email: adminUser.email },
          reviewedAt: new Date('2026-05-22T01:00:00.000Z'),
        }),
      },
      auditEvent: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
      ...overrides,
    };
    const config = { get: jest.fn() };
    const service = new AdminService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );

    return { service, prisma };
  }

  it('approves pending artist knowledge URLs and makes them chat eligible', async () => {
    const { service, prisma } = createKnowledgeService();

    const result = await service.approveBackstageArtistKnowledgeUrl(
      adminUser as never,
      row.id,
      { summary: 'Approved artist-provided summary.' },
    );

    expect(prisma.artistKnowledgeUrl.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: row.id },
        data: expect.objectContaining({
          status: 'approved',
          summary: 'Approved artist-provided summary.',
          rejectionReason: null,
          reviewedByUserId: adminUser.id,
        }),
      }),
    );
    expect(prisma.auditEvent.create).toHaveBeenCalled();
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: adminUser.id,
          actorType: 'admin',
          action: 'artist_knowledge_url.approve',
          targetType: 'artist_knowledge_url',
          targetId: row.id,
          beforeData: expect.objectContaining({
            status: 'pending',
            artistId: row.artistId,
            summaryPresent: true,
          }),
          afterData: expect.objectContaining({
            status: 'approved',
            artistId: row.artistId,
            summaryPresent: true,
          }),
          metadata: expect.objectContaining({
            statusTransition: { from: 'pending', to: 'approved' },
            rawUrlStored: false,
            rawPageBodyStored: false,
            tokenCookiePasswordStored: false,
            providerPayloadStored: false,
            dbUrlStored: false,
          }),
        }),
      }),
    );
    const auditPayload = JSON.stringify(prisma.auditEvent.create.mock.calls[0][0]);
    expect(auditPayload).not.toContain('https://www.youtube.com/watch?v=abc');
    expect(auditPayload).not.toContain('Approved artist-provided summary.');
    expect(auditPayload).not.toContain('Behind the scenes rehearsal update.');
    expect(result).toMatchObject({
      item: {
        status: 'approved',
        chatReference: {
          eligible: true,
          approvedOnly: true,
          rawUrlIncludedInPrompt: false,
        },
      },
      contract: {
        resultingStatus: 'approved',
        chatEligibleAfterApprove: true,
      },
    });
  });

  it('returns stable user-facing errors for invalid filters and missing rejection reason', async () => {
    const { service } = createKnowledgeService();

    await expectHttpError(service.getBackstageArtistKnowledgeUrls({ status: 'draft' }), {
      code: 'ARTIST_KNOWLEDGE_URL_STATUS_INVALID',
      messageKey: 'artistKnowledgeUrl.error.statusInvalid',
    });

    await expectHttpError(
      service.rejectBackstageArtistKnowledgeUrl(adminUser as never, row.id, {}),
      {
        code: 'ARTIST_KNOWLEDGE_URL_REJECTION_REASON_REQUIRED',
        messageKey: 'artistKnowledgeUrl.error.rejectionReasonRequired',
      },
    );
  });
});

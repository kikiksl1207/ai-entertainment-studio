import { BadRequestException } from '@nestjs/common';
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

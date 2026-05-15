import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { createHash } from 'crypto';
import { AuthService } from './auth.service';
import { ConfirmPasswordResetDto } from './dto/auth.dto';

jest.mock('bcryptjs', () => ({
  hash: jest.fn(async (value: string) => `hashed:${value}`),
  compare: jest.fn(),
}));

const userId = '00000000-0000-4000-8000-000000000001';
const actionTokenId = '00000000-0000-4000-8000-000000000101';
const email = 'fan@example.com';
const token = 'a'.repeat(40);

type PrismaMock = {
  user: {
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  userActionToken: {
    updateMany: jest.Mock;
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  userAuthAccount: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  userRefreshToken: {
    updateMany: jest.Mock;
  };
  userIdentityVerification: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
  $transaction: jest.Mock;
};

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function createPrismaMock(): PrismaMock {
  const prisma: PrismaMock = {
    user: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    userActionToken: {
      updateMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    userAuthAccount: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    userRefreshToken: {
      updateMany: jest.fn(),
    },
    userIdentityVerification: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (tx: PrismaMock) => Promise<unknown>) => callback(prisma),
  );
  prisma.userActionToken.create.mockResolvedValue({ id: actionTokenId });

  return prisma;
}

function serviceWith(prisma: PrismaMock) {
  const config = {
    get: jest.fn((key: string) =>
      key === 'NODE_ENV' ? 'test' : undefined,
    ),
    getOrThrow: jest.fn(),
  };
  const delivery = {
    sendActionEmail: jest.fn().mockResolvedValue({
      status: 'not_configured',
      channel: 'email',
    }),
    requestStatus: jest.fn().mockReturnValue({
      status: 'not_configured',
      channel: 'email',
    }),
  };

  return {
    service: new AuthService(
      prisma as never,
      {} as never,
      config as never,
      {} as never,
      delivery as never,
    ),
    delivery,
  };
}

function activeActionToken(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000101',
    userId,
    tokenHash: hashToken(token),
    purpose: 'email_verification',
    expiresAt: new Date('2026-05-14T00:00:00.000Z'),
    consumedAt: null,
    user: {
      id: userId,
      status: 'active',
      deletedAt: null,
    },
    ...overrides,
  };
}

describe('AuthService action token flows', () => {
  it('keeps email verification request neutral when the account does not exist', async () => {
    const prisma = createPrismaMock();
    const { service, delivery } = serviceWith(prisma);
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.requestEmailVerification({ email: ` ${email.toUpperCase()} ` }),
    ).resolves.toEqual({
      success: true,
      ok: true,
      delivery: { status: 'not_configured', channel: 'email' },
      debug: undefined,
    });

    expect(prisma.userActionToken.create).not.toHaveBeenCalled();
    expect(delivery.sendActionEmail).not.toHaveBeenCalled();
    expect(delivery.requestStatus).toHaveBeenCalledTimes(1);
  });

  it('keeps email verification request neutral when delivery fails', async () => {
    const prisma = createPrismaMock();
    const { service, delivery } = serviceWith(prisma);
    prisma.user.findFirst.mockResolvedValue({ id: userId, emailVerifiedAt: null });
    delivery.sendActionEmail.mockRejectedValue(new Error('provider unavailable'));
    delivery.requestStatus.mockReturnValue({
      status: 'accepted',
      channel: 'email',
      provider: 'resend',
    });

    await expect(service.requestEmailVerification({ email })).resolves.toEqual({
      success: true,
      ok: true,
      delivery: { status: 'accepted', channel: 'email', provider: 'resend' },
      debug: undefined,
    });
    expect(prisma.userActionToken.update).toHaveBeenCalledWith({
      where: { id: actionTokenId },
      data: {
        deliveryStatus: 'failed',
        deliveryChannel: 'email',
        deliveryProvider: 'resend',
        deliveryAttemptedAt: expect.any(Date),
        deliveryAcceptedAt: null,
        deliveryFailedAt: expect.any(Date),
      },
    });
  });

  it('creates a new verification token while consuming older unused tokens', async () => {
    const prisma = createPrismaMock();
    const { service, delivery } = serviceWith(prisma);
    prisma.user.findFirst.mockResolvedValue({ id: userId, emailVerifiedAt: null });

    await service.requestEmailVerification({ email });

    expect(prisma.userActionToken.updateMany).toHaveBeenCalledWith({
      where: {
        userId,
        purpose: 'email_verification',
        consumedAt: null,
      },
      data: { consumedAt: expect.any(Date) },
    });
    expect(prisma.userActionToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId,
        purpose: 'email_verification',
        tokenHash: expect.any(String),
        expiresAt: expect.any(Date),
        deliveryStatus: 'pending',
        deliveryChannel: 'email',
        targetEmailMasked: 'fa***@example.com',
      }),
    });
    expect(delivery.sendActionEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: email,
        purpose: 'email_verification',
        actionToken: expect.any(String),
      }),
    );
    expect(prisma.userActionToken.update).toHaveBeenCalledWith({
      where: { id: actionTokenId },
      data: {
        deliveryStatus: 'not_configured',
        deliveryChannel: 'email',
        deliveryProvider: null,
        deliveryAttemptedAt: expect.any(Date),
        deliveryAcceptedAt: null,
        deliveryFailedAt: null,
      },
    });
  });

  it('does not issue another verification token for an already verified email', async () => {
    const prisma = createPrismaMock();
    const { service, delivery } = serviceWith(prisma);
    prisma.user.findFirst.mockResolvedValue({
      id: userId,
      emailVerifiedAt: new Date('2026-05-13T00:00:00.000Z'),
    });

    await service.requestEmailVerification({ email });

    expect(prisma.userActionToken.create).not.toHaveBeenCalled();
    expect(delivery.sendActionEmail).not.toHaveBeenCalled();
    expect(delivery.requestStatus).toHaveBeenCalledTimes(1);
  });

  it('confirms email verification once and stores emailVerifiedAt', async () => {
    const prisma = createPrismaMock();
    const { service } = serviceWith(prisma);
    prisma.userActionToken.findFirst.mockResolvedValue(activeActionToken());

    await expect(
      service.confirmEmailVerification({ token }),
    ).resolves.toEqual({ success: true, ok: true });

    expect(prisma.userActionToken.findFirst).toHaveBeenCalledWith({
      where: {
        tokenHash: hashToken(token),
        purpose: 'email_verification',
        consumedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      include: {
        user: {
          select: {
            id: true,
            status: true,
            deletedAt: true,
          },
        },
      },
    });
    expect(prisma.userActionToken.update).toHaveBeenCalledWith({
      where: { id: '00000000-0000-4000-8000-000000000101' },
      data: { consumedAt: expect.any(Date) },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: {
        emailVerifiedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      },
    });
  });

  it('rejects invalid, expired, or reused email verification tokens with a stable code', async () => {
    const prisma = createPrismaMock();
    const { service } = serviceWith(prisma);
    prisma.userActionToken.findFirst.mockResolvedValue(null);

    await expect(service.confirmEmailVerification({ token })).rejects.toMatchObject({
      response: {
        code: 'AUTH_EMAIL_VERIFICATION_TOKEN_INVALID_OR_EXPIRED',
        messageKey: 'auth.emailVerification.tokenInvalidOrExpired',
      },
    });
  });

  it('confirms password reset once and revokes active sessions', async () => {
    const prisma = createPrismaMock();
    const { service } = serviceWith(prisma);
    prisma.userActionToken.findFirst.mockResolvedValue(
      activeActionToken({ purpose: 'password_reset' }),
    );
    prisma.userAuthAccount.findFirst.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000201',
      passwordHash: 'old-hash',
    });
    prisma.userRefreshToken.updateMany.mockResolvedValue({ count: 2 });

    await expect(
      service.confirmPasswordReset({ token, newPassword: 'Newpass1' }),
    ).resolves.toEqual({
      success: true,
      ok: true,
      revokedCount: 2,
    });

    expect(prisma.userAuthAccount.update).toHaveBeenCalledWith({
      where: { id: '00000000-0000-4000-8000-000000000201' },
      data: {
        passwordHash: 'hashed:Newpass1',
        lastLoginAt: null,
      },
    });
    expect(prisma.userRefreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        userId,
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('keeps password reset request neutral when delivery fails', async () => {
    const prisma = createPrismaMock();
    const { service, delivery } = serviceWith(prisma);
    prisma.userAuthAccount.findUnique.mockResolvedValue({
      userId,
      passwordHash: 'old-hash',
      user: {
        status: 'active',
        deletedAt: null,
      },
    });
    delivery.sendActionEmail.mockRejectedValue(new Error('provider unavailable'));
    delivery.requestStatus.mockReturnValue({
      status: 'accepted',
      channel: 'email',
      provider: 'sendgrid',
    });

    await expect(service.requestPasswordReset({ email })).resolves.toEqual({
      success: true,
      ok: true,
      delivery: { status: 'accepted', channel: 'email', provider: 'sendgrid' },
      debug: undefined,
    });
    expect(prisma.userActionToken.update).toHaveBeenCalledWith({
      where: { id: actionTokenId },
      data: {
        deliveryStatus: 'failed',
        deliveryChannel: 'email',
        deliveryProvider: 'sendgrid',
        deliveryAttemptedAt: expect.any(Date),
        deliveryAcceptedAt: null,
        deliveryFailedAt: expect.any(Date),
      },
    });
  });

  it('keeps password reset policy validation on letter and number passwords', async () => {
    const dto = plainToInstance(ConfirmPasswordResetDto, {
      token,
      newPassword: 'passwordonly',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'newPassword')).toBe(true);
  });

  it('returns account age and clean-mode policy without blocking signup', async () => {
    const prisma = createPrismaMock();
    const { service } = serviceWith(prisma);
    prisma.user.findFirst.mockResolvedValue({
      id: userId,
      email,
      phoneNumber: null,
      status: 'active',
      adminAccess: null,
      artistOperators: [],
      identityVerification: {
        status: 'verified',
        provider: 'nice',
        verifiedNameMasked: 'H***',
        verifiedAt: new Date('2026-05-13T00:00:00.000Z'),
        expiresAt: null,
        birthDate: new Date('2010-05-10T00:00:00.000Z'),
      },
      payoutAccount: null,
      payoutException: null,
    });

    await expect(service.getMyTrust(userId)).resolves.toMatchObject({
      accountState: {
        identityVerified: true,
        ageBand: 'under_19',
        minor: true,
        cleanModeRequired: true,
        signupAllowedWithoutIdentityVerification: true,
        identityVerificationBeforeSignupRequired: false,
        ageGate: {
          status: 'minor',
          ageBand: 'under_19',
          isMinor: true,
          isAdult: false,
          adultThresholdYears: 19,
          verifiedBirthDatePresent: true,
        },
        cleanMode: {
          status: 'required',
          required: true,
          mode: 'minor_protected',
          signupBlocking: false,
        },
        accountLimit: {
          enabled: false,
          enforced: false,
          enforcement: 'policy_flag_only',
        },
      },
      policy: {
        signupAllowedWithoutIdentityVerification: true,
        identityVerificationBeforeSignupRequired: false,
        minorCleanModeEnforcedWhenVerifiedMinor: true,
        identityVerificationAccountLimit: {
          enabled: false,
          enforced: false,
          enforcement: 'policy_flag_only',
        },
      },
    });
  });

  it('fails closed before creating an identity verification when provider is not configured', async () => {
    const prisma = createPrismaMock();
    const { service } = serviceWith(prisma);
    prisma.user.findFirst.mockResolvedValue({
      id: userId,
      identityVerification: null,
    });

    await expect(
      service.requestIdentityVerification(userId, {
        provider: 'nice',
        method: 'mobile_phone',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'IDENTITY_VERIFICATION_PROVIDER_NOT_CONNECTED',
        messageKey: 'identityVerification.providerNotConnected',
        statusCode: 501,
        requestStarted: false,
        verification: {
          status: 'unverified',
          identityVerified: false,
          ageBand: 'unknown',
          minor: null,
          cleanModeRequired: false,
        },
      },
    });
    expect(prisma.userIdentityVerification.upsert).not.toHaveBeenCalled();
  });
});

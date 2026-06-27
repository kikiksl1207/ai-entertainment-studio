import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { createHash } from 'crypto';
import { AuthService } from './auth.service';
import { AUTH_EMAIL_VERIFICATION_THROTTLE_CONTRACT } from './auth-email-verification-throttle-contract';
import { AUTH_PASSWORD_RESET_ABUSE_GUARD_CONTRACT } from './auth-password-reset-abuse-guard-contract';
import { AUTH_SESSION_INVALIDATION_CONTRACT } from './auth-session-invalidation-contract';
import {
  ChangePasswordDto,
  ConfirmPasswordResetDto,
  InspectPasswordResetDto,
  RegisterDto,
  SetPasswordDto,
} from './dto/auth.dto';

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
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  userProfile: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
  };
  userActionToken: {
    updateMany: jest.Mock;
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  userAuthAccount: {
    create: jest.Mock;
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
  userReferralCode: {
    updateMany: jest.Mock;
  };
  auditEvent: {
    create: jest.Mock;
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
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    userProfile: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    userActionToken: {
      updateMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    userAuthAccount: {
      create: jest.fn(),
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
    userReferralCode: {
      updateMany: jest.fn(),
    },
    auditEvent: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (tx: PrismaMock) => Promise<unknown>) => callback(prisma),
  );
  prisma.userActionToken.create.mockResolvedValue({ id: actionTokenId });

  return prisma;
}

function serviceWith(
  prisma: PrismaMock,
  configValues: Record<string, string> = {},
  socialAuth: Record<string, unknown> = {},
) {
  const config = {
    get: jest.fn((key: string) =>
      key === 'NODE_ENV' ? 'test' : configValues[key],
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
      socialAuth as never,
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
    expiresAt: new Date('2099-05-14T00:00:00.000Z'),
    consumedAt: null,
    targetEmailMasked: 'fa***@example.com',
    user: {
      id: userId,
      status: 'active',
      deletedAt: null,
    },
    ...overrides,
  };
}

describe('AuthService action token flows', () => {
  it('returns non-secret social provider configured/status contract', () => {
    const prisma = createPrismaMock();
    const { service } = serviceWith(prisma, {
      KAKAO_REST_API_KEY: 'configured',
      GOOGLE_OAUTH_CLIENT_ID: 'configured',
      NAVER_CLIENT_ID: 'configured',
      NAVER_CLIENT_SECRET: 'configured',
    });

    expect(service.getSocialProviders()).toEqual({
      providers: [
        {
          provider: 'kakao',
          displayName: 'Kakao',
          enabled: true,
          configured: true,
          status: 'configured',
          statusKey: 'auth.social.provider.configured',
          tokenLoginConfigured: true,
          authorizationCodeLoginConfigured: true,
        },
        {
          provider: 'google',
          displayName: 'Google',
          enabled: true,
          configured: true,
          status: 'configured',
          statusKey: 'auth.social.provider.configured',
          tokenLoginConfigured: true,
          authorizationCodeLoginConfigured: false,
        },
        {
          provider: 'naver',
          displayName: 'Naver',
          enabled: true,
          configured: true,
          status: 'configured',
          statusKey: 'auth.social.provider.configured',
          tokenLoginConfigured: true,
          authorizationCodeLoginConfigured: true,
        },
      ],
    });
  });

  it('marks social providers not configured without exposing required secret names', () => {
    const prisma = createPrismaMock();
    const { service } = serviceWith(prisma);

    expect(service.getSocialProviders().providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'google',
          enabled: false,
          configured: false,
          status: 'not_configured',
          statusKey: 'auth.social.provider.not_configured',
          tokenLoginConfigured: false,
          authorizationCodeLoginConfigured: false,
        }),
      ]),
    );
  });

  it('keeps email verification request neutral when the account does not exist', async () => {
    const prisma = createPrismaMock();
    const { service, delivery } = serviceWith(prisma);
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.requestEmailVerification({ email: ` ${email.toUpperCase()} ` }),
    ).resolves.toMatchObject({
      success: true,
      ok: true,
      delivery: { status: 'not_configured', channel: 'email' },
      policy: {
        purpose: 'email_verification',
        neutralResponse: true,
        recommendedClientCooldownSeconds: 60,
        serverEnforcedCooldownSeconds: 60,
        duplicatePendingTokenPolicy:
          'reuse_recent_pending_token_within_cooldown_else_consume_previous',
        cooldownResponseDisclosure: 'neutral_request_accepted',
        rawTokenReturned: false,
        tokenHashReturned: false,
        messageKey: 'auth.emailVerification.requestAccepted',
      },
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

    await expect(service.requestEmailVerification({ email })).resolves.toMatchObject({
      success: true,
      ok: true,
      delivery: { status: 'accepted', channel: 'email', provider: 'resend' },
      policy: {
        purpose: 'email_verification',
        neutralResponse: true,
      },
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

  it('keeps repeated verification requests inside cooldown neutral without sending another email', async () => {
    const prisma = createPrismaMock();
    const { service, delivery } = serviceWith(prisma);
    prisma.user.findFirst.mockResolvedValue({ id: userId, emailVerifiedAt: null });
    prisma.userActionToken.findFirst.mockResolvedValue({
      id: actionTokenId,
      createdAt: new Date(),
    });

    await expect(service.requestEmailVerification({ email })).resolves.toMatchObject({
      success: true,
      ok: true,
      delivery: { status: 'not_configured', channel: 'email' },
      policy: {
        purpose: 'email_verification',
        serverEnforcedCooldownSeconds: 60,
        duplicatePendingTokenPolicy:
          'reuse_recent_pending_token_within_cooldown_else_consume_previous',
        cooldownResponseDisclosure: 'neutral_request_accepted',
        rawTokenReturned: false,
        tokenHashReturned: false,
      },
      debug: undefined,
    });

    expect(AUTH_EMAIL_VERIFICATION_THROTTLE_CONTRACT.throttle).toMatchObject({
      serverEnforced: true,
      windowSeconds: 60,
      duplicatePendingTokenPolicy:
        'reuse_recent_pending_token_within_cooldown_else_consume_previous',
      cooldownDisclosure: 'neutral_request_accepted',
      duringCooldown: {
        createNewToken: false,
        consumeOlderTokens: false,
        sendEmail: false,
        returnDebugToken: false,
      },
    });
    expect(AUTH_EMAIL_VERIFICATION_THROTTLE_CONTRACT.responsePolicy).toMatchObject({
      neutralResponse: true,
      revealsAccountExistence: false,
      revealsEmailVerifiedState: false,
      rawTokenReturned: false,
      tokenHashReturned: false,
      rawEmailReturned: false,
    });
    expect(prisma.userActionToken.findFirst).toHaveBeenCalledWith({
      where: {
        userId,
        purpose: 'email_verification',
        consumedAt: null,
        expiresAt: { gt: expect.any(Date) },
        createdAt: { gte: expect.any(Date) },
      },
      select: { id: true },
    });
    expect(prisma.userActionToken.create).not.toHaveBeenCalled();
    expect(prisma.userActionToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.userActionToken.update).not.toHaveBeenCalled();
    expect(delivery.sendActionEmail).not.toHaveBeenCalled();
    expect(delivery.requestStatus).toHaveBeenCalledTimes(1);
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
    prisma.userActionToken.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.confirmEmailVerification({ token }),
    ).resolves.toEqual({ success: true, ok: true });

    expect(prisma.userActionToken.findFirst).toHaveBeenCalledWith({
      where: {
        tokenHash: hashToken(token),
        purpose: 'email_verification',
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
    expect(prisma.userActionToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: '00000000-0000-4000-8000-000000000101',
        consumedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
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
        details: {
          state: 'invalid',
          statusKey: 'auth.emailVerification.invalid',
          rawTokenReturned: false,
          tokenHashReturned: false,
        },
      },
    });
  });

  it('distinguishes expired and already-used email verification links without exposing token data', async () => {
    const prisma = createPrismaMock();
    const { service } = serviceWith(prisma);

    prisma.userActionToken.findFirst.mockResolvedValueOnce(
      activeActionToken({
        expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      }),
    );
    await expect(service.confirmEmailVerification({ token })).rejects.toMatchObject({
      response: {
        code: 'AUTH_EMAIL_VERIFICATION_TOKEN_INVALID_OR_EXPIRED',
        messageKey: 'auth.emailVerification.tokenInvalidOrExpired',
        details: {
          state: 'expired',
          statusKey: 'auth.emailVerification.expired',
          rawTokenReturned: false,
          tokenHashReturned: false,
        },
      },
    });

    prisma.userActionToken.findFirst.mockResolvedValueOnce(
      activeActionToken({
        consumedAt: new Date('2026-05-14T00:00:00.000Z'),
      }),
    );
    await expect(service.confirmEmailVerification({ token })).rejects.toMatchObject({
      response: {
        code: 'AUTH_EMAIL_VERIFICATION_TOKEN_INVALID_OR_EXPIRED',
        messageKey: 'auth.emailVerification.tokenInvalidOrExpired',
        details: {
          state: 'already_used',
          statusKey: 'auth.emailVerification.already_used',
          rawTokenReturned: false,
          tokenHashReturned: false,
        },
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
      providerUserId: email,
      passwordHash: 'old-hash',
    });
    prisma.userActionToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.userRefreshToken.updateMany.mockResolvedValue({ count: 2 });

    await expect(
      service.confirmPasswordReset({ token, newPassword: 'Newpass1' }),
    ).resolves.toEqual({
      success: true,
      ok: true,
      revokedCount: 2,
    });

    expect(prisma.userActionToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: actionTokenId,
        consumedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { consumedAt: expect.any(Date) },
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

  it('keeps password reset session invalidation server-authoritative and secret-free', async () => {
    const prisma = createPrismaMock();
    const { service } = serviceWith(prisma);
    prisma.userActionToken.findFirst.mockResolvedValue(
      activeActionToken({ purpose: 'password_reset' }),
    );
    prisma.userAuthAccount.findFirst.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000201',
      providerUserId: email,
      passwordHash: 'old-hash',
    });
    prisma.userActionToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.userRefreshToken.updateMany.mockResolvedValue({ count: 3 });

    const result = await service.confirmPasswordReset({
      token,
      newPassword: 'Newpass1',
    });

    expect(AUTH_SESSION_INVALIDATION_CONTRACT.passwordResetConfirm.sessionInvalidation).toMatchObject({
      revokesRefreshTokens: true,
      scope: 'all active sessions for token.userId',
      where: {
        userIdSource: 'token.userId',
        revokedAt: null,
      },
      accessTokenExpiryOnlyFallbackAllowed: false,
    });
    expect(prisma.userRefreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        userId,
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(AUTH_SESSION_INVALIDATION_CONTRACT.passwordResetConfirm.untrustedClientFields).toEqual(
      expect.arrayContaining(['refreshToken', 'sessionId', 'cookie', 'userId']),
    );
    expect(AUTH_SESSION_INVALIDATION_CONTRACT.passwordResetConfirm.responsePolicy).toMatchObject({
      returnsAccessToken: false,
      returnsRefreshToken: false,
      returnsCookie: false,
      returnsSessionSecret: false,
      returnsPasswordHash: false,
      returnsResetTokenHash: false,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /accessToken|refreshToken|cookie|sessionSecret|passwordHash|tokenHash/i,
    );
  });

  it('blocks social-only password change before password or session mutation', async () => {
    const prisma = createPrismaMock();
    const { service } = serviceWith(prisma);
    prisma.userAuthAccount.findFirst.mockResolvedValue(null);

    await expect(
      service.changePassword(userId, {
        currentPassword: 'SocialOnlyCurrent1',
        newPassword: 'SocialOnlyNext1',
      }),
    ).rejects.toMatchObject({
      response: {
        message: 'Email password is not configured for this account',
      },
    });

    expect(prisma.userAuthAccount.update).not.toHaveBeenCalled();
    expect(prisma.userRefreshToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('projects social-only account method without provider credentials or session secrets', async () => {
    const prisma = createPrismaMock();
    const { service } = serviceWith(prisma);
    prisma.user.findFirst.mockResolvedValue({
      id: userId,
      email,
      emailVerifiedAt: new Date('2026-05-15T00:00:00.000Z'),
      phoneNumber: null,
      status: 'active',
      createdAt: new Date('2026-05-15T00:00:00.000Z'),
      authAccounts: [
        { provider: 'google', passwordHash: null },
        { provider: 'naver', passwordHash: null },
      ],
      profile: null,
      settings: null,
      walletAccounts: [],
    });

    const projection = await service.getMe(userId);

    expect(projection).toMatchObject({
      provider: 'google',
      providers: ['google', 'naver'],
      hasPassword: false,
      isSocialOnly: true,
      emailVerification: {
        status: 'verified',
        required: false,
        messageKey: 'auth.emailVerification.verified',
      },
    });
    const payload = JSON.stringify(projection);
    expect(payload).not.toMatch(/passwordHash|providerUserId|accessToken|refreshToken|cookie/i);
    expect(payload).not.toMatch(/passwordResetCta|resetPasswordCta|forgotPasswordCta/i);
  });

  it('projects email-password account method separately from social-only settings copy', async () => {
    const prisma = createPrismaMock();
    const { service } = serviceWith(prisma);
    prisma.user.findFirst.mockResolvedValue({
      id: userId,
      email,
      emailVerifiedAt: new Date('2026-05-15T00:00:00.000Z'),
      phoneNumber: null,
      status: 'active',
      createdAt: new Date('2026-05-15T00:00:00.000Z'),
      authAccounts: [{ provider: 'email', passwordHash: 'hash' }],
      profile: null,
      settings: null,
      walletAccounts: [],
    });

    const projection = await service.getMe(userId);

    expect(projection).toMatchObject({
      provider: 'email',
      providers: ['email'],
      hasPassword: true,
      isSocialOnly: false,
      emailVerification: {
        status: 'verified',
        required: false,
        messageKey: 'auth.emailVerification.verified',
      },
    });
    const payload = JSON.stringify(projection);
    expect(payload).not.toMatch(/social[-_ ]only/i);
    expect(payload).not.toMatch(/passwordHash|providerUserId|accessToken|refreshToken|cookie/i);
  });

  it('deletes accounts by revoking sessions and all outstanding action tokens', async () => {
    const prisma = createPrismaMock();
    const { service } = serviceWith(prisma);
    const deletedAt = new Date('2026-06-15T00:00:00.000Z');
    prisma.user.findFirst.mockResolvedValue({
      id: userId,
      email,
      status: 'active',
      deletedAt: null,
      authAccounts: [],
    });
    prisma.user.update.mockResolvedValue({
      id: userId,
      email,
      status: 'deleted',
      deletedAt,
      updatedAt: deletedAt,
    });
    prisma.userRefreshToken.updateMany.mockResolvedValue({ count: 2 });
    prisma.userActionToken.updateMany.mockResolvedValue({ count: 3 });
    prisma.userReferralCode.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditEvent.create.mockResolvedValue({ id: 'audit-1' });
    prisma.$transaction.mockImplementationOnce(
      async (operations: Array<Promise<unknown>>) => Promise.all(operations),
    );

    await expect(
      service.deleteAccount(userId, {
        reason: 'safe account closure reason',
      }),
    ).resolves.toMatchObject({
      ok: true,
      revokedSessionCount: 2,
      user: {
        id: userId,
        status: 'deleted',
      },
    });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: userId },
        data: expect.objectContaining({
          status: 'deleted',
          deletedAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.userRefreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: expect.any(Date),
      },
    });
    expect(prisma.userActionToken.updateMany).toHaveBeenCalledWith({
      where: {
        userId,
        consumedAt: null,
      },
      data: {
        consumedAt: expect.any(Date),
      },
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'user.self_delete',
          targetType: 'user',
          targetId: userId,
        }),
      }),
    );
  });

  it('rejects deleted email and social accounts before issuing sessions or relinking providers', async () => {
    const prisma = createPrismaMock();
    const socialAuth = {
      verifyProfile: jest.fn().mockResolvedValue({
        provider: 'google',
        providerUserId: 'google-deleted-user',
        email,
        emailVerified: true,
      }),
    };
    const { service } = serviceWith(prisma, {}, socialAuth);
    const deletedUser = {
      id: userId,
      email,
      status: 'deleted',
      deletedAt: new Date('2026-06-15T00:00:00.000Z'),
    };

    prisma.userAuthAccount.findUnique
      .mockResolvedValueOnce({
        id: 'email-auth-account',
        userId,
        passwordHash: 'hash',
        user: deletedUser,
      })
      .mockResolvedValueOnce({
        id: 'social-auth-account',
        userId,
        provider: 'google',
        providerUserId: 'google-deleted-user',
        user: deletedUser,
      });

    await expect(
      service.login({ email, password: 'Password123' }),
    ).rejects.toMatchObject({
      response: {
        message: 'Invalid email or password',
      },
    });
    await expect(
      service.socialLogin({
        provider: 'google',
        token: 'provider-token',
      }),
    ).rejects.toMatchObject({
      response: {
        message: 'User is not active.',
      },
    });

    expect(prisma.userAuthAccount.update).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.userAuthAccount.create).not.toHaveBeenCalled();
    expect(prisma.userRefreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('inspects password reset tokens without consuming them or returning secrets', async () => {
    const prisma = createPrismaMock();
    const { service } = serviceWith(prisma);
    prisma.userActionToken.findFirst.mockResolvedValue(
      activeActionToken({ purpose: 'password_reset' }),
    );

    await expect(service.inspectPasswordReset({ token })).resolves.toMatchObject({
      success: true,
      ok: true,
      purpose: 'password_reset',
      status: 'valid',
      statusKey: 'auth.passwordReset.valid',
      canReset: true,
      email: {
        masked: 'fa***@example.com',
        returned: 'masked_only',
      },
      policy: {
        readOnly: true,
        consumesToken: false,
        confirmRequiresEmail: false,
        rawTokenReturned: false,
        tokenHashReturned: false,
        fullEmailReturned: false,
        passwordReturned: false,
        emailPrefill: {
          source: 'user_action_tokens.targetEmailMasked',
          mode: 'masked_only',
          rawEmailReturned: false,
          invalidOrExpiredTokenEmailReturned: false,
          confirmWithoutEmailInput: true,
          clientEditableEmailRequired: false,
          tokenOrCookieUsedAsPrefillValue: false,
        },
        confirmEndpoint: {
          method: 'POST',
          path: '/api/v1/auth/password-resets/confirm',
          requiredFields: ['token', 'newPassword'],
          optionalFields: ['email'],
        },
      },
    });
    expect(prisma.userActionToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.userAuthAccount.update).not.toHaveBeenCalled();
    expect(prisma.userRefreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('inspects invalid, expired, and used password reset links safely', async () => {
    const prisma = createPrismaMock();
    const { service } = serviceWith(prisma);
    prisma.userActionToken.findFirst.mockResolvedValueOnce(null);

    await expect(service.inspectPasswordReset({ token })).resolves.toMatchObject({
      status: 'invalid',
      canReset: false,
      email: { masked: null, returned: 'not_returned' },
      policy: {
        rawTokenReturned: false,
        tokenHashReturned: false,
        fullEmailReturned: false,
        emailPrefill: {
          mode: 'masked_only',
          rawEmailReturned: false,
          invalidOrExpiredTokenEmailReturned: false,
        },
      },
    });

    prisma.userActionToken.findFirst.mockResolvedValueOnce(
      activeActionToken({
        purpose: 'password_reset',
        expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      }),
    );
    await expect(service.inspectPasswordReset({ token })).resolves.toMatchObject({
      status: 'expired',
      canReset: false,
      email: { masked: null, returned: 'not_returned' },
    });

    prisma.userActionToken.findFirst.mockResolvedValueOnce(
      activeActionToken({
        purpose: 'password_reset',
        consumedAt: new Date('2026-05-14T00:00:00.000Z'),
      }),
    );
    await expect(service.inspectPasswordReset({ token })).resolves.toMatchObject({
      status: 'already_used',
      canReset: false,
      email: { masked: null, returned: 'not_returned' },
    });
  });

  it('rejects invalid, expired, and used password reset confirms before mutation', async () => {
    const prisma = createPrismaMock();
    const { service } = serviceWith(prisma);

    prisma.userActionToken.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.confirmPasswordReset({ token, newPassword: 'password' }),
    ).rejects.toMatchObject({
      response: {
        code: 'AUTH_PASSWORD_RESET_TOKEN_INVALID_OR_EXPIRED',
        messageKey: 'auth.passwordReset.tokenInvalidOrExpired',
        details: {
          state: 'invalid',
          statusKey: 'auth.passwordReset.invalid',
          rawTokenReturned: false,
          tokenHashReturned: false,
        },
      },
    });

    prisma.userActionToken.findFirst.mockResolvedValueOnce(
      activeActionToken({
        purpose: 'password_reset',
        expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      }),
    );
    await expect(
      service.confirmPasswordReset({ token, newPassword: 'password' }),
    ).rejects.toMatchObject({
      response: {
        details: {
          state: 'expired',
          statusKey: 'auth.passwordReset.expired',
          rawTokenReturned: false,
          tokenHashReturned: false,
        },
      },
    });

    prisma.userActionToken.findFirst.mockResolvedValueOnce(
      activeActionToken({
        purpose: 'password_reset',
        consumedAt: new Date('2026-05-14T00:00:00.000Z'),
      }),
    );
    await expect(
      service.confirmPasswordReset({ token, newPassword: 'password' }),
    ).rejects.toMatchObject({
      response: {
        details: {
          state: 'already_used',
          statusKey: 'auth.passwordReset.already_used',
          rawTokenReturned: false,
          tokenHashReturned: false,
        },
      },
    });

    expect(prisma.userActionToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.userAuthAccount.update).not.toHaveBeenCalled();
    expect(prisma.userRefreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('rejects password reset when the submitted email does not match the token account', async () => {
    const prisma = createPrismaMock();
    const { service } = serviceWith(prisma);
    prisma.userActionToken.findFirst.mockResolvedValue(
      activeActionToken({ purpose: 'password_reset' }),
    );
    prisma.userAuthAccount.findFirst.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000201',
      providerUserId: email,
      passwordHash: 'old-hash',
    });

    await expect(
      service.confirmPasswordReset({
        token,
        email: 'other@example.com',
        newPassword: 'Newpass1',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'AUTH_PASSWORD_RESET_EMAIL_MISMATCH',
        messageKey: 'auth.passwordReset.emailMismatch',
      },
    });
    expect(prisma.userActionToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.userAuthAccount.update).not.toHaveBeenCalled();
    expect(prisma.userRefreshToken.updateMany).not.toHaveBeenCalled();
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

    await expect(service.requestPasswordReset({ email })).resolves.toMatchObject({
      success: true,
      ok: true,
      delivery: { status: 'accepted', channel: 'email', provider: 'sendgrid' },
      policy: {
        purpose: 'password_reset',
        neutralResponse: true,
        recommendedClientCooldownSeconds: 60,
        serverEnforcedCooldownSeconds: 60,
        duplicatePendingTokenPolicy:
          'reuse_recent_pending_token_within_cooldown_else_consume_previous',
        cooldownResponseDisclosure: 'neutral_request_accepted',
        rawTokenReturned: false,
        tokenHashReturned: false,
        messageKey: 'auth.passwordReset.requestAccepted',
      },
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

  it('keeps repeated password reset requests inside cooldown neutral without sending another email', async () => {
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
    prisma.userActionToken.findFirst.mockResolvedValue({
      id: actionTokenId,
      createdAt: new Date(),
    });

    await expect(service.requestPasswordReset({ email })).resolves.toMatchObject({
      success: true,
      ok: true,
      delivery: { status: 'not_configured', channel: 'email' },
      policy: {
        purpose: 'password_reset',
        serverEnforcedCooldownSeconds: 60,
        duplicatePendingTokenPolicy:
          'reuse_recent_pending_token_within_cooldown_else_consume_previous',
        cooldownResponseDisclosure: 'neutral_request_accepted',
        rawTokenReturned: false,
        tokenHashReturned: false,
      },
      debug: undefined,
    });

    expect(AUTH_PASSWORD_RESET_ABUSE_GUARD_CONTRACT.responsePolicy).toMatchObject({
      neutralResponse: true,
      messageKey: 'auth.passwordReset.requestAccepted',
      revealsAccountExistence: false,
      revealsPasswordConfigured: false,
      rawEmailReturned: false,
      rawTokenReturned: false,
      tokenHashReturned: false,
      passwordReturned: false,
    });
    expect(AUTH_PASSWORD_RESET_ABUSE_GUARD_CONTRACT.cooldown).toMatchObject({
      serverEnforced: true,
      windowSeconds: 60,
      source: 'user_action_tokens.createdAt',
      duplicatePendingTokenPolicy:
        'reuse_recent_pending_token_within_cooldown_else_consume_previous',
      repeatedRequestCreatesNewToken: false,
      repeatedRequestConsumesPreviousToken: false,
      repeatedRequestSendsEmail: false,
      repeatedRequestReturnsDebugToken: false,
    });
    expect(AUTH_PASSWORD_RESET_ABUSE_GUARD_CONTRACT.auditSeparation).toMatchObject({
      deliveryStatusStoredOnActionToken: true,
      deliveryAttemptedAtStored: true,
      providerRawResponseStored: false,
      adminReadModelUsesMaskedEmail: true,
      rawMailBodyReturned: false,
    });
    expect(prisma.userActionToken.create).not.toHaveBeenCalled();
    expect(prisma.userActionToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.userActionToken.update).not.toHaveBeenCalled();
    expect(delivery.sendActionEmail).not.toHaveBeenCalled();
    expect(delivery.requestStatus).toHaveBeenCalledTimes(1);
  });

  it('keeps password policy to 8 characters minimum without composition requirements', async () => {
    const validSamples = [
      plainToInstance(RegisterDto, {
        email,
        password: 'password',
      }),
      plainToInstance(ChangePasswordDto, {
        currentPassword: 'old-password',
        newPassword: 'password',
      }),
      plainToInstance(SetPasswordDto, {
        newPassword: 'password',
      }),
      plainToInstance(ConfirmPasswordResetDto, {
        token,
        newPassword: 'password',
      }),
      plainToInstance(InspectPasswordResetDto, {
        token,
      }),
    ];
    const invalidResetDto = plainToInstance(ConfirmPasswordResetDto, {
      token,
      email,
      newPassword: 'short7!',
    });
    const invalidEmailResetDto = plainToInstance(ConfirmPasswordResetDto, {
      token,
      email: 'not-an-email',
      newPassword: 'password',
    });

    await expect(Promise.all(validSamples.map((sample) => validate(sample)))).resolves
      .toEqual([[], [], [], [], []]);

    const errors = await validate(invalidResetDto);
    const invalidEmailErrors = await validate(invalidEmailResetDto);

    expect(errors.some((error) => error.property === 'newPassword')).toBe(true);
    expect(errors[0]?.constraints).toMatchObject({
      minLength: 'auth.password.minLength',
    });
    expect(invalidEmailErrors.some((error) => error.property === 'email')).toBe(true);
  });

  it('returns email verification gate state for unverified email accounts', async () => {
    const prisma = createPrismaMock();
    const { service } = serviceWith(prisma);
    prisma.user.findFirst.mockResolvedValue({
      id: userId,
      email,
      emailVerifiedAt: null,
      phoneNumber: null,
      status: 'active',
      createdAt: new Date('2026-05-15T00:00:00.000Z'),
      authAccounts: [{ provider: 'email', passwordHash: 'hash' }],
      profile: null,
      settings: null,
      walletAccounts: [],
    });

    await expect(service.getMe(userId)).resolves.toMatchObject({
      emailVerified: false,
      emailVerifiedAt: null,
      emailVerification: {
        status: 'required',
        required: true,
        code: 'AUTH_EMAIL_VERIFICATION_REQUIRED',
        messageKey: 'auth.emailVerification.required',
        requiredActions: ['verify_email'],
        gates: {
          coreFeaturesRequireVerifiedEmail: true,
          coreFeaturesBlockedUntilVerified: true,
          loginAllowedBeforeVerification: true,
        },
        resend: {
          purpose: 'email_verification',
          neutralResponse: true,
          recommendedClientCooldownSeconds: 60,
          serverEnforcedCooldownSeconds: 60,
          duplicatePendingTokenPolicy:
            'reuse_recent_pending_token_within_cooldown_else_consume_previous',
          cooldownResponseDisclosure: 'neutral_request_accepted',
          tokenTtlSeconds: 86400,
          rawTokenReturned: false,
          tokenHashReturned: false,
        },
      },
    });
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
        details: {
          requestStarted: false,
        },
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

  it('keeps confirm fail-closed details visible through the error wrapper contract', async () => {
    const prisma = createPrismaMock();
    const { service } = serviceWith(prisma);
    prisma.userIdentityVerification.findUnique.mockResolvedValue(null);

    await expect(
      service.confirmIdentityVerification(userId, 'self', {
        token: 'provider-token',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'IDENTITY_VERIFICATION_PROVIDER_NOT_CONNECTED',
        messageKey: 'identityVerification.providerNotConnected',
        statusCode: 501,
        requestStarted: false,
        details: {
          requestStarted: false,
          tokenReceived: true,
        },
      },
    });
  });
});

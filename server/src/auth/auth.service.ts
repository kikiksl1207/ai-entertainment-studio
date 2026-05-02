import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload, SocialProviderConfig } from './auth.types';
import {
  ChangePasswordDto,
  ConfirmEmailVerificationDto,
  ConfirmPasswordResetDto,
  DeleteAccountDto,
  LoginDto,
  RegisterDto,
  RequestEmailVerificationDto,
  RequestPasswordResetDto,
  SocialLoginDto,
  UpdateProfileDto,
} from './dto/auth.dto';
import { SocialAuthService } from './social-auth.service';
import { buildPublicAssetUrl } from '../common/asset-url';

const PASSWORD_HASH_ROUNDS = 12;
const LUMINA_CURRENCY_CODE = 'LUMINA';
const SIGNUP_BONUS_LUMINA = 300;
const REFERRAL_REWARD_LUMINA = 500;
const NICKNAME_CHANGE_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const EMAIL_VERIFICATION_PURPOSE = 'email_verification';
const PASSWORD_RESET_PURPOSE = 'password_reset';

type SessionContext = {
  userAgent?: string | null;
  ipAddress?: string | null;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly socialAuthService: SocialAuthService,
  ) {}

  async register(input: RegisterDto, sessionContext?: SessionContext) {
    const email = input.email.trim().toLowerCase();
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await bcrypt.hash(input.password, PASSWORD_HASH_ROUNDS);
    const displayName = input.displayName?.trim() || email.split('@')[0];

    const user = await this.prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email,
          status: 'active',
        },
      });

      await tx.userAuthAccount.create({
        data: {
          userId: createdUser.id,
          provider: 'email',
          providerUserId: email,
          passwordHash,
        },
      });

      await tx.userProfile.create({
        data: {
          userId: createdUser.id,
          displayName,
        },
      });

      await tx.userSettings.create({
        data: {
          userId: createdUser.id,
        },
      });

      await this.createWalletWithSignupBonus(tx, createdUser.id);
      await this.applyReferralReward(tx, createdUser.id, input.referralCode);

      return createdUser;
    });

    return this.authResponse(
      await this.getMe(user.id),
      await this.issueTokens(user.id, email, undefined, sessionContext),
    );
  }

  async login(input: LoginDto, sessionContext?: SessionContext) {
    const email = input.email.trim().toLowerCase();
    const authAccount = await this.prisma.userAuthAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider: 'email',
          providerUserId: email,
        },
      },
      include: {
        user: true,
      },
    });

    if (
      !authAccount?.passwordHash ||
      authAccount.user.status !== 'active' ||
      authAccount.user.deletedAt
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(input.password, authAccount.passwordHash);

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.prisma.userAuthAccount.update({
      where: { id: authAccount.id },
      data: { lastLoginAt: new Date() },
    });

    return this.authResponse(
      await this.getMe(authAccount.userId),
      await this.issueTokens(authAccount.userId, email, undefined, sessionContext),
    );
  }

  async socialLogin(input: SocialLoginDto, sessionContext?: SessionContext) {
    const profile = await this.socialAuthService.verifyProfile(
      input.provider,
      {
        token: input.token ?? input.accessToken,
        code: input.code,
        redirectUri: input.redirectUri,
      },
    );
    const providerUserId = profile.providerUserId;
    const verifiedEmail = profile.emailVerified
      ? (profile.email?.trim().toLowerCase() ?? null)
      : null;
    const displayName =
      input.displayName?.trim() ||
      profile.displayName?.trim() ||
      verifiedEmail?.split('@')[0] ||
      `${profile.provider}_${providerUserId.slice(0, 8)}`;

    const authAccount = await this.prisma.userAuthAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider: profile.provider,
          providerUserId,
        },
      },
      include: { user: true },
    });

    if (authAccount) {
      this.assertUserCanLogin(authAccount.user);

      await this.prisma.userAuthAccount.update({
        where: { id: authAccount.id },
        data: { lastLoginAt: new Date() },
      });

      return this.authResponse(
        await this.getMe(authAccount.userId),
        await this.issueTokens(
          authAccount.userId,
          authAccount.user.email,
          undefined,
          sessionContext,
        ),
      );
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const existingUser = verifiedEmail
        ? await tx.user.findUnique({
            where: { email: verifiedEmail },
          })
        : null;

      if (existingUser) {
        this.assertUserCanLogin(existingUser);

        await tx.userAuthAccount.create({
          data: {
            userId: existingUser.id,
            provider: profile.provider,
            providerUserId,
          },
        });

        return existingUser;
      }

      const createdUser = await tx.user.create({
        data: {
          email: verifiedEmail,
          status: 'active',
        },
      });

      await tx.userAuthAccount.create({
        data: {
          userId: createdUser.id,
          provider: profile.provider,
          providerUserId,
        },
      });

      await tx.userProfile.create({
        data: {
          userId: createdUser.id,
          displayName,
        },
      });

      await tx.userSettings.create({
        data: {
          userId: createdUser.id,
        },
      });

      await this.createWalletWithSignupBonus(tx, createdUser.id);
      await this.applyReferralReward(tx, createdUser.id, input.referralCode);

      return createdUser;
    });

    return this.authResponse(
      await this.getMe(user.id),
      await this.issueTokens(user.id, user.email, undefined, sessionContext),
    );
  }

  getSocialProviders(): { providers: SocialProviderConfig[] } {
    return {
      providers: [
        {
          provider: 'kakao',
          displayName: 'Kakao',
          enabled: this.hasConfig('KAKAO_REST_API_KEY'),
        },
        {
          provider: 'google',
          displayName: 'Google',
          enabled: this.hasConfig('GOOGLE_OAUTH_CLIENT_ID'),
        },
        {
          provider: 'naver',
          displayName: 'Naver',
          enabled: this.hasConfig('NAVER_CLIENT_ID'),
        },
      ],
    };
  }

  async refresh(refreshToken: string, sessionContext?: SessionContext) {
    let payload: JwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.tokenType !== 'refresh') {
      throw new UnauthorizedException('Refresh token is required');
    }

    if (!payload.tokenId) {
      throw new UnauthorizedException('Refresh token is not tracked');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        id: payload.sub,
        status: 'active',
        deletedAt: null,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User is not active');
    }

    const storedToken = await this.prisma.userRefreshToken.findUnique({
      where: { id: payload.tokenId },
    });

    if (
      !storedToken ||
      storedToken.userId !== user.id ||
      storedToken.revokedAt ||
      storedToken.expiresAt <= new Date() ||
      storedToken.tokenHash !== this.hashToken(refreshToken)
    ) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.prisma.userRefreshToken.update({
      where: { id: storedToken.id },
      data: {
        revokedAt: new Date(),
        lastUsedAt: new Date(),
      },
    });

    return this.authResponse(
      await this.getMe(user.id),
      await this.issueTokens(user.id, user.email, storedToken.id, sessionContext),
    );
  }

  async logout(refreshToken: string) {
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });

      if (payload.tokenType === 'refresh' && payload.tokenId) {
        await this.prisma.userRefreshToken.updateMany({
          where: {
            id: payload.tokenId,
            tokenHash: this.hashToken(refreshToken),
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
      }
    } catch {
      // Logout remains idempotent so clients can clear local tokens safely.
    }

    return { ok: true };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        status: 'active',
        deletedAt: null,
      },
      select: {
        id: true,
        email: true,
        phoneNumber: true,
        status: true,
        createdAt: true,
        authAccounts: {
          select: {
            provider: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        profile: true,
        settings: true,
        walletAccounts: {
          where: { currencyCode: LUMINA_CURRENCY_CODE },
        },
      },
    });

    if (!user) {
      throw new BadRequestException('Active user not found');
    }

    return this.formatMe(user);
  }

  async getMyPageSummary(userId: string) {
    await this.assertActiveUser(userId);

    const [
      user,
      wallet,
      recentLedger,
      recentPaymentOrders,
      boostEventCounts,
      premiumUnlocks,
      debutApplications,
      followingArtists,
      feedCounts,
    ] = await Promise.all([
      this.getMe(userId),
      this.prisma.walletAccount.upsert({
        where: {
          userId_currencyCode: {
            userId,
            currencyCode: LUMINA_CURRENCY_CODE,
          },
        },
        update: {},
        create: {
          userId,
          currencyCode: LUMINA_CURRENCY_CODE,
        },
      }),
      this.prisma.walletLedger.findMany({
        where: {
          walletAccount: {
            userId,
            currencyCode: LUMINA_CURRENCY_CODE,
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.paymentOrder.findMany({
        where: { userId },
        include: {
          luminaProduct: true,
          transactions: true,
          refunds: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.artistBoostEvent.groupBy({
        by: ['boostType'],
        where: { userId },
        _count: { _all: true },
      }),
      this.prisma.userPremiumVideoUnlock.findMany({
        where: { userId },
        include: {
          premiumVideoProduct: {
            select: {
              id: true,
              sku: true,
              title: true,
              artist: {
                select: {
                  id: true,
                  slug: true,
                  displayName: true,
                },
              },
            },
          },
        },
        orderBy: { unlockedAt: 'desc' },
        take: 10,
      }),
      this.prisma.debutApplication.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.artistFollow.findMany({
        where: {
          userId,
          status: 'active',
          deletedAt: null,
        },
        include: {
          artist: {
            select: {
              id: true,
              slug: true,
              displayName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      Promise.all([
        this.prisma.communityPost.count({ where: { authorUserId: userId } }),
        this.prisma.communityReply.count({ where: { authorUserId: userId } }),
        this.prisma.communityReaction.count({ where: { userId } }),
      ]),
    ]);

    const latestDebutApplication = debutApplications[0] ?? null;

    return {
      user,
      wallet: {
        ...wallet,
        stella: this.toStellaDisplay(wallet.cachedBalance),
      },
      recentLedger,
      recentPaymentOrders,
      activity: {
        boostEventCounts: Object.fromEntries(
          boostEventCounts.map((row) => [row.boostType, row._count._all]),
        ),
        premiumUnlocks,
        followingArtists,
        feedCounts: {
          posts: feedCounts[0],
          replies: feedCounts[1],
          reactions: feedCounts[2],
        },
      },
      debut: {
        latestApplication: latestDebutApplication,
        applications: debutApplications,
        ctaState: latestDebutApplication ? 'status' : 'apply',
      },
      policy: {
        nicknameChangeIntervalDays: 30,
        avatarUploadMode: 'asset_upload_flow',
        stellaDisplayThresholdLumina: 10000,
      },
    };
  }

  async updateProfile(userId: string, input: UpdateProfileDto) {
    await this.assertActiveUser(userId);

    if (
      input.displayName === undefined &&
      input.bio === undefined &&
      input.avatarAssetId === undefined
    ) {
      throw new BadRequestException('At least one profile field is required');
    }

    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
    });
    const now = new Date();
    const nextChangeAt = this.nextNicknameChangeAt(profile?.nicknameChangedAt ?? null);

    if (input.displayName !== undefined && profile?.displayName !== input.displayName) {
      if (profile?.nicknameChangedAt && nextChangeAt > now) {
        throw new BadRequestException('Nickname can be changed once every 30 days');
      }
    }

    if (input.avatarAssetId) {
      const asset = await this.prisma.asset.findFirst({
        where: {
          id: input.avatarAssetId,
          assetType: 'image',
        },
        select: { id: true },
      });

      if (!asset) {
        throw new BadRequestException('Avatar asset not found');
      }
    }

    await this.prisma.userProfile.upsert({
      where: { userId },
      update: this.clean({
        displayName: input.displayName,
        bio: input.bio,
        avatarAssetId: input.avatarAssetId,
        nicknameChangedAt:
          input.displayName !== undefined && profile?.displayName !== input.displayName
            ? now
            : undefined,
        updatedAt: now,
      }),
      create: {
        userId,
        displayName: input.displayName ?? 'Lumina Fan',
        bio: input.bio,
        avatarAssetId: input.avatarAssetId,
        nicknameChangedAt: input.displayName !== undefined ? now : undefined,
      },
    });

    return this.getMe(userId);
  }

  async requestEmailVerification(input: RequestEmailVerificationDto) {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: {
        email,
        status: 'active',
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (user) {
      await this.createUserActionToken(
        user.id,
        EMAIL_VERIFICATION_PURPOSE,
        EMAIL_VERIFICATION_TOKEN_TTL_MS,
      );
    }

    return {
      ok: true,
      delivery: {
        status: 'not_configured',
        channel: 'email',
      },
    };
  }

  async confirmEmailVerification(input: ConfirmEmailVerificationDto) {
    const token = await this.consumeUserActionToken(
      input.token,
      EMAIL_VERIFICATION_PURPOSE,
    );

    await this.prisma.user.update({
      where: { id: token.userId },
      data: {
        updatedAt: new Date(),
      },
    });

    return { ok: true };
  }

  async requestPasswordReset(input: RequestPasswordResetDto) {
    const email = input.email.trim().toLowerCase();
    const authAccount = await this.prisma.userAuthAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider: 'email',
          providerUserId: email,
        },
      },
      select: {
        userId: true,
        passwordHash: true,
        user: {
          select: {
            status: true,
            deletedAt: true,
          },
        },
      },
    });

    if (
      authAccount?.passwordHash &&
      authAccount.user.status === 'active' &&
      !authAccount.user.deletedAt
    ) {
      await this.createUserActionToken(
        authAccount.userId,
        PASSWORD_RESET_PURPOSE,
        PASSWORD_RESET_TOKEN_TTL_MS,
      );
    }

    return {
      ok: true,
      delivery: {
        status: 'not_configured',
        channel: 'email',
      },
    };
  }

  async confirmPasswordReset(input: ConfirmPasswordResetDto) {
    const token = await this.consumeUserActionToken(input.token, PASSWORD_RESET_PURPOSE);
    this.assertUserCanLogin(token.user);

    const passwordHash = await bcrypt.hash(input.newPassword, PASSWORD_HASH_ROUNDS);

    const result = await this.prisma.$transaction(async (tx) => {
      const authAccount = await tx.userAuthAccount.findFirst({
        where: {
          userId: token.userId,
          provider: 'email',
        },
        select: {
          id: true,
          passwordHash: true,
        },
      });

      if (!authAccount?.passwordHash) {
        throw new BadRequestException('Email password is not configured for this account');
      }

      await tx.userAuthAccount.update({
        where: { id: authAccount.id },
        data: {
          passwordHash,
          lastLoginAt: null,
        },
      });

      return tx.userRefreshToken.updateMany({
        where: {
          userId: token.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    });

    return {
      ok: true,
      revokedCount: result.count,
    };
  }

  async changePassword(userId: string, input: ChangePasswordDto) {
    if (input.currentPassword === input.newPassword) {
      throw new BadRequestException('New password must be different');
    }

    const authAccount = await this.prisma.userAuthAccount.findFirst({
      where: {
        userId,
        provider: 'email',
      },
      select: {
        id: true,
        passwordHash: true,
        user: {
          select: {
            status: true,
            deletedAt: true,
          },
        },
      },
    });

    if (!authAccount?.passwordHash) {
      throw new BadRequestException('Email password is not configured for this account');
    }

    this.assertUserCanLogin(authAccount.user);

    const currentPasswordMatches = await bcrypt.compare(
      input.currentPassword,
      authAccount.passwordHash,
    );

    if (!currentPasswordMatches) {
      throw new UnauthorizedException('Current password is invalid');
    }

    const passwordHash = await bcrypt.hash(input.newPassword, PASSWORD_HASH_ROUNDS);

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.userAuthAccount.update({
        where: { id: authAccount.id },
        data: { passwordHash },
      });

      return tx.userRefreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    });

    return {
      ok: true,
      revokedCount: result.count,
    };
  }

  async deleteAccount(userId: string, input: DeleteAccountDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        status: 'active',
        deletedAt: null,
      },
      include: {
        authAccounts: {
          where: { provider: 'email' },
          select: {
            passwordHash: true,
          },
          take: 1,
        },
      },
    });

    if (!user) {
      throw new BadRequestException('Active user not found');
    }

    const emailPasswordHash = user.authAccounts[0]?.passwordHash;

    if (emailPasswordHash) {
      if (!input.currentPassword) {
        throw new BadRequestException('currentPassword is required');
      }

      const passwordMatches = await bcrypt.compare(input.currentPassword, emailPasswordHash);

      if (!passwordMatches) {
        throw new UnauthorizedException('Current password is invalid');
      }
    }

    const now = new Date();
    const [updatedUser, revokedSessions] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          status: 'deleted',
          deletedAt: now,
          updatedAt: now,
        },
        select: {
          id: true,
          email: true,
          status: true,
          deletedAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.userRefreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      }),
      this.prisma.userActionToken.updateMany({
        where: {
          userId,
          consumedAt: null,
        },
        data: {
          consumedAt: now,
        },
      }),
      this.prisma.userReferralCode.updateMany({
        where: {
          userId,
          status: 'active',
        },
        data: {
          status: 'inactive',
          updatedAt: now,
        },
      }),
    ]);

    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        actorType: 'user',
        action: 'user.self_delete',
        targetType: 'user',
        targetId: userId,
        beforeData: this.toJson({
          id: user.id,
          email: user.email,
          status: user.status,
          deletedAt: user.deletedAt,
        }),
        afterData: this.toJson(updatedUser),
        metadata: this.toJson({
          reason: this.truncateNullable(input.reason, 500),
          revokedSessionCount: revokedSessions.count,
        }),
      },
    });

    return {
      ok: true,
      user: updatedUser,
      revokedSessionCount: revokedSessions.count,
    };
  }

  async listActiveSessions(userId: string) {
    await this.assertActiveUser(userId);

    const now = new Date();
    const sessions = await this.prisma.userRefreshToken.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        userAgent: true,
        ipAddress: true,
        lastUsedAt: true,
        replacedBy: true,
      },
    });

    return { sessions };
  }

  async revokeSession(userId: string, sessionId: string) {
    await this.assertActiveUser(userId);

    const result = await this.prisma.userRefreshToken.updateMany({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return {
      ok: true,
      revokedCount: result.count,
    };
  }

  async revokeAllSessions(userId: string) {
    await this.assertActiveUser(userId);

    const result = await this.prisma.userRefreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return {
      ok: true,
      revokedCount: result.count,
    };
  }

  private async formatMe(user: {
    id: string;
    email: string | null;
    phoneNumber: string | null;
    status: string;
    createdAt: Date;
    authAccounts: { provider: string }[];
    profile: {
      displayName: string;
      avatarAssetId: string | null;
      bio: string | null;
      nicknameChangedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    } | null;
    settings: unknown;
    walletAccounts: unknown[];
  }) {
    const avatarAsset = user.profile?.avatarAssetId
      ? await this.prisma.asset.findUnique({
          where: { id: user.profile.avatarAssetId },
          select: {
            id: true,
            storageKey: true,
            mimeType: true,
            width: true,
            height: true,
          },
        })
      : null;
    const nicknameLastChangedAt = user.profile?.nicknameChangedAt ?? null;
    const nicknameNextChangeAt = this.nextNicknameChangeAt(nicknameLastChangedAt);
    const primaryProvider = user.authAccounts[0]?.provider ?? null;

    return {
      id: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      status: user.status,
      provider: primaryProvider,
      providers: user.authAccounts.map((account) => account.provider),
      createdAt: user.createdAt,
      displayName: user.profile?.displayName ?? user.email?.split('@')[0] ?? 'Lumina Fan',
      avatarUrl: avatarAsset
        ? buildPublicAssetUrl(this.configService, avatarAsset.storageKey)
        : null,
      avatarAsset: avatarAsset
        ? {
            ...avatarAsset,
            url: buildPublicAssetUrl(this.configService, avatarAsset.storageKey),
          }
        : null,
      bio: user.profile?.bio ?? null,
      nicknameLastChangedAt,
      nicknameNextChangeAt,
      canChangeNickname: nicknameNextChangeAt <= new Date(),
      profile: user.profile,
      settings: user.settings,
      walletAccounts: user.walletAccounts,
    };
  }

  private nextNicknameChangeAt(changedAt: Date | null) {
    return changedAt
      ? new Date(changedAt.getTime() + NICKNAME_CHANGE_INTERVAL_MS)
      : new Date(0);
  }

  private toStellaDisplay(luminaAmount: { toString: () => string }) {
    const lumina = Number(luminaAmount.toString());
    const stella = lumina >= 10000 ? Math.floor(lumina / 10000) : 0;

    return {
      amount: stella,
      enabled: stella > 0,
      rate: '10000L = 1 Stella display unit',
    };
  }

  private clean<T extends Record<string, unknown>>(input: T) {
    return Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ) as T;
  }

  private async issueTokens(
    userId: string,
    email?: string | null,
    replacedTokenId?: string,
    sessionContext?: SessionContext,
  ) {
    const refreshTokenId = randomUUID();
    const refreshExpiresIn = this.getJwtExpiresIn('JWT_REFRESH_EXPIRES_IN', '30d');
    const accessPayload: JwtPayload = {
      sub: userId,
      email,
      tokenType: 'access',
    };
    const refreshPayload: JwtPayload = {
      sub: userId,
      email,
      tokenType: 'refresh',
      tokenId: refreshTokenId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.getJwtExpiresIn('JWT_ACCESS_EXPIRES_IN', '15m'),
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshExpiresIn,
      }),
    ]);

    await this.prisma.userRefreshToken.create({
      data: {
        id: refreshTokenId,
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + this.durationToMs(refreshExpiresIn)),
        userAgent: this.truncateNullable(sessionContext?.userAgent, 512),
        ipAddress: this.truncateNullable(sessionContext?.ipAddress, 64),
        lastUsedAt: new Date(),
      },
    });

    if (replacedTokenId) {
      await this.prisma.userRefreshToken.updateMany({
        where: { id: replacedTokenId },
        data: { replacedBy: refreshTokenId },
      });
    }

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
    };
  }

  private getJwtExpiresIn(key: string, fallback: string) {
    return (this.configService.get<string>(key) ?? fallback) as '15m';
  }

  private authResponse(
    user: Awaited<ReturnType<AuthService['getMe']>>,
    tokens: Awaited<ReturnType<AuthService['issueTokens']>>,
  ) {
    return {
      user,
      tokens,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenType: tokens.tokenType,
    };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private createOpaqueToken() {
    return randomBytes(32).toString('base64url');
  }

  private async createUserActionToken(
    userId: string,
    purpose: string,
    ttlMs: number,
  ) {
    const rawToken = this.createOpaqueToken();
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.userActionToken.updateMany({
        where: {
          userId,
          purpose,
          consumedAt: null,
        },
        data: {
          consumedAt: now,
        },
      });

      await tx.userActionToken.create({
        data: {
          userId,
          purpose,
          tokenHash: this.hashToken(rawToken),
          expiresAt: new Date(now.getTime() + ttlMs),
        },
      });
    });

    return rawToken;
  }

  private async consumeUserActionToken(rawToken: string, purpose: string) {
    const token = await this.prisma.userActionToken.findFirst({
      where: {
        tokenHash: this.hashToken(rawToken),
        purpose,
        consumedAt: null,
        expiresAt: { gt: new Date() },
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

    if (!token) {
      throw new BadRequestException('Token is invalid or expired');
    }

    await this.prisma.userActionToken.update({
      where: { id: token.id },
      data: { consumedAt: new Date() },
    });

    return token;
  }

  private async createWalletWithSignupBonus(
    tx: Prisma.TransactionClient,
    userId: string,
  ) {
    const wallet = await tx.walletAccount.create({
      data: {
        userId,
        currencyCode: LUMINA_CURRENCY_CODE,
        cachedBalance: SIGNUP_BONUS_LUMINA,
      },
    });

    await tx.walletLedger.create({
      data: {
        walletAccountId: wallet.id,
        direction: 'credit',
        amount: SIGNUP_BONUS_LUMINA,
        ledgerType: 'event_grant',
        referenceType: 'user',
        referenceId: userId,
        idempotencyKey: `signup_bonus:${userId}`,
        memo: 'Lumina signup bonus',
      },
    });

    return wallet;
  }

  private async applyReferralReward(
    tx: Prisma.TransactionClient,
    referredUserId: string,
    referralCode?: string,
  ) {
    if (!referralCode) {
      return null;
    }

    const code = await tx.userReferralCode.findFirst({
      where: {
        code: referralCode,
        status: 'active',
        user: {
          status: 'active',
          deletedAt: null,
        },
      },
    });

    if (!code) {
      throw new BadRequestException('Referral code is not valid');
    }

    if (code.userId === referredUserId) {
      throw new BadRequestException('Self referral is not allowed');
    }

    const existingReward = await tx.referralReward.findUnique({
      where: { referredUserId },
    });

    if (existingReward) {
      return existingReward;
    }

    const [referrerWallet, referredWallet] = await Promise.all([
      tx.walletAccount.findUnique({
        where: {
          userId_currencyCode: {
            userId: code.userId,
            currencyCode: LUMINA_CURRENCY_CODE,
          },
        },
      }),
      tx.walletAccount.findUnique({
        where: {
          userId_currencyCode: {
            userId: referredUserId,
            currencyCode: LUMINA_CURRENCY_CODE,
          },
        },
      }),
    ]);

    if (!referrerWallet || referrerWallet.status !== 'active') {
      throw new BadRequestException('Referrer wallet is not active');
    }

    if (!referredWallet || referredWallet.status !== 'active') {
      throw new BadRequestException('Referred wallet is not active');
    }

    const referrerLedger = await tx.walletLedger.create({
      data: {
        walletAccountId: referrerWallet.id,
        direction: 'credit',
        amount: REFERRAL_REWARD_LUMINA,
        ledgerType: 'event_grant',
        referenceType: 'user',
        referenceId: referredUserId,
        idempotencyKey: `referral:referrer:${referredUserId}`,
        memo: 'Referral reward',
      },
    });

    const referredLedger = await tx.walletLedger.create({
      data: {
        walletAccountId: referredWallet.id,
        direction: 'credit',
        amount: REFERRAL_REWARD_LUMINA,
        ledgerType: 'event_grant',
        referenceType: 'user',
        referenceId: code.userId,
        idempotencyKey: `referral:referred:${referredUserId}`,
        memo: 'Referral signup bonus',
      },
    });

    await Promise.all([
      tx.walletAccount.update({
        where: { id: referrerWallet.id },
        data: { cachedBalance: { increment: REFERRAL_REWARD_LUMINA } },
      }),
      tx.walletAccount.update({
        where: { id: referredWallet.id },
        data: { cachedBalance: { increment: REFERRAL_REWARD_LUMINA } },
      }),
      tx.userReferralCode.update({
        where: { id: code.id },
        data: {
          useCount: { increment: 1 },
          updatedAt: new Date(),
        },
      }),
    ]);

    return tx.referralReward.create({
      data: {
        referrerUserId: code.userId,
        referredUserId,
        referralCodeId: code.id,
        referrerAmount: REFERRAL_REWARD_LUMINA,
        referredAmount: REFERRAL_REWARD_LUMINA,
        referrerLedgerId: referrerLedger.id,
        referredLedgerId: referredLedger.id,
        idempotencyKey: `referral:${referredUserId}`,
      },
    });
  }

  private durationToMs(value: string) {
    const match = value.match(/^(\d+)([smhd])$/);

    if (!match) {
      throw new Error(`Unsupported JWT duration: ${value}`);
    }

    const amount = Number(match[1]);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return amount * multipliers[unit];
  }

  private assertUserCanLogin(user: { status: string; deletedAt?: Date | null }) {
    if (user.status !== 'active' || user.deletedAt) {
      throw new UnauthorizedException('User is not active');
    }
  }

  private async assertActiveUser(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        status: 'active',
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!user) {
      throw new UnauthorizedException('User is not active');
    }
  }

  private hasConfig(key: string) {
    return Boolean(this.configService.get<string>(key)?.trim());
  }

  private truncateNullable(value: string | null | undefined, maxLength: number) {
    const normalized = value?.trim();

    if (!normalized) {
      return null;
    }

    return normalized.slice(0, maxLength);
  }

  private toJson(value: unknown) {
    if (value === null || value === undefined) {
      return Prisma.JsonNull;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}

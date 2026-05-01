import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload, SocialProviderConfig } from './auth.types';
import { LoginDto, RegisterDto, SocialLoginDto } from './dto/auth.dto';
import { SocialAuthService } from './social-auth.service';

const PASSWORD_HASH_ROUNDS = 12;
const LUMINA_CURRENCY_CODE = 'LUMINA';
const SIGNUP_BONUS_LUMINA = 300;
const REFERRAL_REWARD_LUMINA = 500;

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

    return {
      user: await this.getMe(user.id),
      tokens: await this.issueTokens(user.id, email, undefined, sessionContext),
    };
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

    return {
      user: await this.getMe(authAccount.userId),
      tokens: await this.issueTokens(authAccount.userId, email, undefined, sessionContext),
    };
  }

  async socialLogin(input: SocialLoginDto, sessionContext?: SessionContext) {
    const profile = await this.socialAuthService.verifyProfile(
      input.provider,
      input.token,
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

      return {
        user: await this.getMe(authAccount.userId),
        tokens: await this.issueTokens(
          authAccount.userId,
          authAccount.user.email,
          undefined,
          sessionContext,
        ),
      };
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

    return {
      user: await this.getMe(user.id),
      tokens: await this.issueTokens(user.id, user.email, undefined, sessionContext),
    };
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
        {
          provider: 'apple',
          displayName: 'Apple',
          enabled: this.hasConfig('APPLE_CLIENT_ID'),
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

    return {
      user: await this.getMe(user.id),
      tokens: await this.issueTokens(user.id, user.email, storedToken.id, sessionContext),
    };
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

    return user;
  }

  async listActiveSessions(userId: string) {
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

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
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
        ledgerType: 'signup_bonus',
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
        ledgerType: 'referral_reward',
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
        ledgerType: 'referral_signup_bonus',
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
}

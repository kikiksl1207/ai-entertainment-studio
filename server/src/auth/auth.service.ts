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
  SetPasswordDto,
  SocialLoginDto,
  UpdateProfileDto,
  UpdateSettingsDto,
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
            passwordHash: true,
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
      followingUsers,
      followers,
      followCounts,
      feedCounts,
      recentActivities,
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
          artist: { status: 'active' },
        },
        include: {
          artist: {
            include: {
              publicProfile: true,
              artistAssets: {
                where: {
                  usageType: { in: ['thumb', 'cover'] },
                  asset: {
                    visibility: 'public',
                  },
                },
                include: {
                  asset: {
                    select: {
                      id: true,
                      storageKey: true,
                      metadata: true,
                    },
                  },
                },
                orderBy: [
                  { usageType: 'desc' },
                  { isPrimary: 'desc' },
                  { sortOrder: 'asc' },
                ],
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      this.prisma.userFollow.findMany({
        where: {
          followerUserId: userId,
          status: 'active',
          deletedAt: null,
        },
        include: this.userFollowUserInclude('following'),
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      this.prisma.userFollow.findMany({
        where: {
          followingUserId: userId,
          status: 'active',
          deletedAt: null,
        },
        include: this.userFollowUserInclude('follower'),
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      Promise.all([
        this.prisma.artistFollow.count({
          where: { userId, status: 'active', deletedAt: null },
        }),
        this.prisma.userFollow.count({
          where: { followerUserId: userId, status: 'active', deletedAt: null },
        }),
        this.prisma.userFollow.count({
          where: { followingUserId: userId, status: 'active', deletedAt: null },
        }),
      ]),
      Promise.all([
        this.prisma.communityPost.count({ where: { authorUserId: userId } }),
        this.prisma.communityReply.count({ where: { authorUserId: userId } }),
        this.prisma.communityReaction.count({ where: { userId } }),
      ]),
      this.getMyActivityLedger(userId, { take: '12' }),
    ]);

    const latestDebutApplication = debutApplications[0] ?? null;

    return {
      user,
      wallet: {
        ...wallet,
        lumina: {
          balance: wallet.cachedBalance,
          currencyCode: wallet.currencyCode,
        },
        stella: this.toStellaDisplay(wallet.cachedBalance),
      },
      recentLedger,
      recentPaymentOrders,
      activity: {
        boostEventCounts: Object.fromEntries(
          boostEventCounts.map((row) => [row.boostType, row._count._all]),
        ),
        premiumUnlocks,
        followingArtists: await Promise.all(
          followingArtists.map((follow) => this.toArtistFollowView(follow)),
        ),
        followingUsers: await Promise.all(
          followingUsers.map((follow) => this.toUserFollowView(follow, 'following')),
        ),
        followers: await Promise.all(
          followers.map((follow) => this.toUserFollowView(follow, 'follower')),
        ),
        followCounts: {
          followingArtists: followCounts[0],
          followingUsers: followCounts[1],
          followers: followCounts[2],
        },
        feedCounts: {
          posts: feedCounts[0],
          replies: feedCounts[1],
          reactions: feedCounts[2],
        },
      },
      recentActivities: recentActivities.items,
      debut: {
        latestApplication: latestDebutApplication,
        applications: debutApplications,
        ctaState: latestDebutApplication ? 'status' : 'apply',
      },
      policy: {
        nicknameChangeIntervalDays: 30,
        displayName: {
          minLength: 2,
          maxLength: 50,
          unique: false,
          firstChangeHasCooldown: true,
        },
        passwordRule: {
          minLength: 8,
          maxLength: 128,
          requiresLetter: true,
          requiresNumber: true,
        },
        avatarUploadMode: 'asset_upload_flow',
        stellaDisplayThresholdLumina: 10000,
      },
    };
  }

  async getMyActivityLedger(
    userId: string,
    query: { type?: string; take?: string } = {},
  ) {
    await this.assertActiveUser(userId);
    const take = this.parseTake(query.take, 50);
    const type = query.type?.trim();
    const allowedTypes = new Set(['charge', 'boost', 'unlock', 'gift', 'free_like']);

    if (type && type !== 'all' && !allowedTypes.has(type)) {
      throw new BadRequestException('type must be all, charge, boost, unlock, gift, or free_like');
    }

    const [ledgerEntries, paymentOrders, boostEvents, premiumUnlocks] = await Promise.all([
      this.prisma.walletLedger.findMany({
        where: {
          walletAccount: {
            userId,
            currencyCode: LUMINA_CURRENCY_CODE,
          },
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.paymentOrder.findMany({
        where: { userId },
        include: { luminaProduct: true, refunds: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.artistBoostEvent.findMany({
        where: { userId },
        include: {
          artist: {
            select: { id: true, slug: true, displayName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take,
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
                select: { id: true, slug: true, displayName: true },
              },
            },
          },
        },
        orderBy: { unlockedAt: 'desc' },
        take,
      }),
    ]);

    const items = [
      ...paymentOrders.map((order) => ({
        id: `payment:${order.id}`,
        type: 'charge',
        title: order.luminaProduct.name,
        description: `${order.status} payment order`,
        amountLumina: order.luminaProduct.luminaAmount.plus(order.luminaProduct.bonusAmount),
        status: order.status,
        createdAt: order.createdAt,
        relatedArtist: null,
        relatedContent: { type: 'payment_order', id: order.id, orderNo: order.orderNo },
      })),
      ...boostEvents.map((event) => ({
        id: `boost:${event.id}`,
        type: event.boostType === 'free_like' ? 'free_like' : 'boost',
        title: event.boostType === 'free_like' ? 'Free like' : 'Paid boost',
        description: event.artist.displayName,
        amountLumina: event.rawAmount,
        status: 'completed',
        createdAt: event.createdAt,
        relatedArtist: event.artist,
        relatedContent: { type: 'boost_event', id: event.id },
      })),
      ...premiumUnlocks.map((unlock) => ({
        id: `unlock:${unlock.id}`,
        type: 'unlock',
        title: unlock.premiumVideoProduct.title,
        description: 'Premium content unlock',
        amountLumina: null,
        status: unlock.expiresAt && unlock.expiresAt <= new Date() ? 'expired' : 'active',
        createdAt: unlock.unlockedAt,
        relatedArtist: unlock.premiumVideoProduct.artist,
        relatedContent: {
          type: 'premium_video',
          id: unlock.premiumVideoProduct.id,
          sku: unlock.premiumVideoProduct.sku,
        },
      })),
      ...ledgerEntries
        .filter((entry) => ['user_gift_send', 'user_gift_receive'].includes(entry.ledgerType))
        .map((entry) => ({
          id: `ledger:${entry.id}`,
          type: 'gift',
          title: entry.direction === 'credit' ? 'Lumina gift received' : 'Lumina gift sent',
          description: entry.memo,
          amountLumina: entry.amount,
          status: 'completed',
          createdAt: entry.createdAt,
          relatedArtist: null,
          relatedContent: {
            type: entry.referenceType,
            id: entry.referenceId,
          },
        })),
    ]
      .filter((item) => !type || type === 'all' || item.type === type)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, take);

    return { items, total: items.length };
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

  async getSettings(userId: string) {
    await this.assertActiveUser(userId);

    const settings = await this.prisma.userSettings.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });

    return {
      settings: this.formatSettings(settings),
      policy: this.settingsPolicy(),
    };
  }

  async updateSettings(userId: string, input: UpdateSettingsDto) {
    await this.assertActiveUser(userId);

    if (
      input.locale === undefined &&
      input.timezone === undefined &&
      input.marketingOptIn === undefined &&
      input.pushOptIn === undefined &&
      input.activityNotifications === undefined &&
      input.feedNotifications === undefined &&
      input.emailNotifications === undefined
    ) {
      throw new BadRequestException('At least one settings field is required');
    }

    const settings = await this.prisma.userSettings.upsert({
      where: { userId },
      create: {
        userId,
        ...this.clean({
          locale: input.locale,
          timezone: input.timezone,
          marketingOptIn: input.marketingOptIn,
          pushOptIn: input.pushOptIn,
          activityNotifications: input.activityNotifications,
          feedNotifications: input.feedNotifications,
          emailNotifications: input.emailNotifications,
        }),
      },
      update: this.clean({
        locale: input.locale,
        timezone: input.timezone,
        marketingOptIn: input.marketingOptIn,
        pushOptIn: input.pushOptIn,
        activityNotifications: input.activityNotifications,
        feedNotifications: input.feedNotifications,
        emailNotifications: input.emailNotifications,
        updatedAt: new Date(),
      }),
    });

    return {
      settings: this.formatSettings(settings),
      policy: this.settingsPolicy(),
    };
  }

  async requestEmailVerification(input: RequestEmailVerificationDto) {
    const email = input.email.trim().toLowerCase();
    let debugToken: { token: string; expiresAt: Date } | null = null;
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
      debugToken = await this.createUserActionToken(
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
      debug: this.actionTokenDebugPayload(debugToken),
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
    let debugToken: { token: string; expiresAt: Date } | null = null;
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
      debugToken = await this.createUserActionToken(
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
      debug: this.actionTokenDebugPayload(debugToken),
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

  async setPassword(userId: string, input: SetPasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        status: 'active',
        deletedAt: null,
      },
      select: {
        id: true,
        email: true,
        authAccounts: {
          where: { provider: 'email' },
          select: {
            id: true,
            passwordHash: true,
          },
          take: 1,
        },
      },
    });

    if (!user) {
      throw new BadRequestException('Active user not found');
    }

    if (!user.email) {
      throw new BadRequestException('Verified email is required to set a password');
    }

    const authAccount = user.authAccounts[0] ?? null;

    if (authAccount?.passwordHash) {
      throw new ConflictException('Email password is already configured');
    }

    const passwordHash = await bcrypt.hash(input.newPassword, PASSWORD_HASH_ROUNDS);

    await this.prisma.userAuthAccount.upsert({
      where: {
        provider_providerUserId: {
          provider: 'email',
          providerUserId: user.email,
        },
      },
      create: {
        userId: user.id,
        provider: 'email',
        providerUserId: user.email,
        passwordHash,
      },
      update: {
        passwordHash,
        lastLoginAt: null,
      },
    });

    return {
      ok: true,
      user: await this.getMe(user.id),
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
    authAccounts: { provider: string; passwordHash: string | null }[];
    profile: {
      displayName: string;
      avatarAssetId: string | null;
      bio: string | null;
      nicknameChangedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    } | null;
    settings: {
      userId: string;
      locale: string;
      timezone: string;
      marketingOptIn: boolean;
      pushOptIn: boolean;
      activityNotifications: boolean;
      feedNotifications: boolean;
      emailNotifications: boolean;
      createdAt: Date;
      updatedAt: Date;
    } | null;
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
            metadata: true,
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
      hasPassword: user.authAccounts.some((account) => Boolean(account.passwordHash)),
      isSocialOnly: !user.authAccounts.some((account) => Boolean(account.passwordHash)),
      createdAt: user.createdAt,
      displayName: user.profile?.displayName ?? user.email?.split('@')[0] ?? 'Lumina Fan',
      avatarUrl: avatarAsset
        ? buildPublicAssetUrl(this.configService, avatarAsset.storageKey)
        : null,
      avatarAsset: avatarAsset
        ? {
            ...avatarAsset,
            url: buildPublicAssetUrl(this.configService, avatarAsset.storageKey),
            thumbnailUrl: buildPublicAssetUrl(this.configService, avatarAsset.storageKey),
            status: this.assetStatus(avatarAsset.metadata),
          }
        : null,
      bio: user.profile?.bio ?? null,
      nicknameLastChangedAt,
      nicknameNextChangeAt,
      canChangeNickname: nicknameNextChangeAt <= new Date(),
      profile: user.profile,
      settings: user.settings ? this.formatSettings(user.settings) : null,
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
      displayAmount: stella,
      enabled: stella > 0,
      rate: '10000L = 1 Stella display unit',
      displayRule: 'Show Stella only when balance is at least 10000L',
    };
  }

  private formatSettings(settings: {
    userId: string;
    locale: string;
    timezone: string;
    marketingOptIn: boolean;
    pushOptIn: boolean;
    activityNotifications: boolean;
    feedNotifications: boolean;
    emailNotifications: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      locale: settings.locale,
      timezone: settings.timezone,
      marketingOptIn: settings.marketingOptIn,
      pushOptIn: settings.pushOptIn,
      activityNotifications: settings.activityNotifications,
      feedNotifications: settings.feedNotifications,
      emailNotifications: settings.emailNotifications,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }

  private settingsPolicy() {
    return {
      locale: {
        default: 'ko-KR',
        supported: ['ko-KR', 'en-US'],
      },
      timezone: {
        default: 'Asia/Seoul',
      },
      notifications: {
        activityNotifications: 'likes, replies, follows, and profile activity',
        feedNotifications: 'Lumina Feed updates from followed artists and users',
        emailNotifications: 'account and service emails where email delivery is configured',
        marketingOptIn: 'promotion and event messages',
        pushOptIn: 'push delivery permission flag',
      },
    };
  }

  private userFollowUserInclude(direction: 'follower' | 'following') {
    const userSelect = {
      id: true,
      email: true,
      status: true,
      profile: {
        select: {
          displayName: true,
          avatarAssetId: true,
        },
      },
    };

    return {
      [direction]: {
        select: userSelect,
      },
    } satisfies Prisma.UserFollowInclude;
  }

  private async toUserFollowView(follow: any, direction: 'follower' | 'following') {
    const user = follow[direction];
    const avatarAsset = user.profile?.avatarAssetId
      ? await this.prisma.asset.findUnique({
          where: { id: user.profile.avatarAssetId },
          select: { id: true, storageKey: true },
        })
      : null;

    return {
      id: follow.id,
      status: follow.status,
      followedAt: follow.createdAt,
      updatedAt: follow.updatedAt,
      user: {
        id: user.id,
        displayName: user.profile?.displayName ?? user.email?.split('@')[0] ?? 'Lumina User',
        avatarUrl: avatarAsset
          ? buildPublicAssetUrl(this.configService, avatarAsset.storageKey)
          : null,
      },
    };
  }

  private async toArtistFollowView(follow: any) {
    const artist = follow.artist;
    const visibleAssets = (artist.artistAssets ?? []).filter((artistAsset: any) =>
      this.isPublicReadyAsset(artistAsset.asset.metadata),
    );
    const thumb =
      visibleAssets.find((artistAsset: any) => artistAsset.usageType === 'thumb') ??
      visibleAssets.find((artistAsset: any) => artistAsset.usageType === 'cover') ??
      null;
    const latestFeed = await this.prisma.communityPost.findFirst({
      where: {
        artistId: artist.id,
        status: 'published',
        visibility: 'public',
        deletedAt: null,
      },
      select: { publishedAt: true },
      orderBy: { publishedAt: 'desc' },
    });
    const metadata = this.recordOrEmpty(artist.publicProfile?.publicMetadata);
    const profileFacts = this.recordOrEmpty(metadata.profileFacts);
    const type =
      this.stringFromUnknown(profileFacts.characterType) ??
      this.stringFromUnknown(profileFacts.position) ??
      null;
    const thumbnailUrl = thumb
      ? buildPublicAssetUrl(this.configService, thumb.asset.storageKey)
      : null;

    return {
      id: artist.id,
      followId: follow.id,
      slug: artist.slug,
      displayName: artist.displayName,
      name: artist.displayName,
      thumbnailUrl,
      thumbUrl: thumbnailUrl,
      status: artist.status,
      type,
      followedAt: follow.createdAt,
      latestFeedAt: latestFeed?.publishedAt ?? null,
      isFollowing: true,
    };
  }

  private assetStatus(metadata: unknown) {
    if (!this.isRecord(metadata)) {
      return 'ready';
    }

    const uploadIntent = metadata.uploadIntent;

    if (!this.isRecord(uploadIntent)) {
      return 'ready';
    }

    return typeof uploadIntent.status === 'string' ? uploadIntent.status : 'ready';
  }

  private isPublicReadyAsset(metadata: unknown) {
    const record = this.recordOrEmpty(metadata);
    const uploadIntent = this.recordOrEmpty(record.uploadIntent);
    const lifecycle = this.recordOrEmpty(record.lifecycle);

    if (lifecycle.status === 'archived') {
      return false;
    }

    return !uploadIntent.status || uploadIntent.status === 'uploaded';
  }

  private recordOrEmpty(value: unknown) {
    return this.isRecord(value) ? value : {};
  }

  private stringFromUnknown(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private parseTake(value: string | undefined, fallback: number) {
    const parsed = value ? Number(value) : fallback;

    if (!Number.isInteger(parsed)) {
      throw new BadRequestException('take must be an integer');
    }

    return Math.max(1, Math.min(parsed, 100));
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
    const expiresAt = new Date(now.getTime() + ttlMs);

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
          expiresAt,
        },
      });
    });

    return { token: rawToken, expiresAt };
  }

  private actionTokenDebugPayload(token: { token: string; expiresAt: Date } | null) {
    if (!token || !this.shouldExposeActionTokensForDebug()) {
      return undefined;
    }

    return {
      actionToken: token.token,
      expiresAt: token.expiresAt,
      warning: 'Debug only. Never enable in production or share tokens publicly.',
    };
  }

  private shouldExposeActionTokensForDebug() {
    return (
      this.configService.get<string>('ACTION_TOKEN_DEBUG_ENABLED') === 'true' &&
      this.configService.get<string>('NODE_ENV') !== 'production'
    );
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

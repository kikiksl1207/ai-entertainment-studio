import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload, SocialProviderConfig } from './auth.types';
import {
  ChangePasswordDto,
  ConfirmEmailVerificationDto,
  ConfirmIdentityVerificationDto,
  ConfirmPasswordResetDto,
  DeleteAccountDto,
  LoginDto,
  RegisterDto,
  RequestEmailVerificationDto,
  RequestIdentityVerificationDto,
  RequestPasswordResetDto,
  SetPasswordDto,
  SocialLoginDto,
  UpdateProfileDto,
  UpdateSettlementProfileDto,
  UpdateSettingsDto,
  SUPPORTED_LOCALES,
} from './dto/auth.dto';
import { SocialAuthService } from './social-auth.service';
import { AuthEmailDeliveryService } from './auth-email-delivery.service';
import type { AuthEmailDeliveryResult } from './auth-email-delivery.service';
import { buildPublicAssetUrl } from '../common/asset-url';
import { USER_IMAGE_UPLOAD_MAX_BYTES } from '../assets/user-assets.service';

const PASSWORD_HASH_ROUNDS = 12;
const LUMINA_CURRENCY_CODE = 'LUMINA';
const SIGNUP_BONUS_LUMINA = 300;
const REFERRAL_REWARD_LUMINA = 500;
const NICKNAME_CHANGE_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const EMAIL_VERIFICATION_PURPOSE = 'email_verification';
const PASSWORD_RESET_PURPOSE = 'password_reset';
const MYPAGE_DEBUT_STATUS_COPY: Record<
  string,
  { status: string; labelKo: string; messageKey: string; defaultMessageKo: string }
> = {
  submitted: {
    status: 'submitted',
    labelKo: '신청 접수 완료',
    messageKey: 'debut.application.status.submitted',
    defaultMessageKo: '데뷔 신청이 접수됐어요. 운영팀이 순서대로 확인합니다.',
  },
  reviewing: {
    status: 'reviewing',
    labelKo: '심사 중',
    messageKey: 'debut.application.status.reviewing',
    defaultMessageKo: '제출 내용을 검토하고 있어요. 결과가 정리되면 알려드릴게요.',
  },
  under_review: {
    status: 'reviewing',
    labelKo: '심사 중',
    messageKey: 'debut.application.status.reviewing',
    defaultMessageKo: '제출 내용을 검토하고 있어요. 결과가 정리되면 알려드릴게요.',
  },
  needs_more_info: {
    status: 'needs_more_info',
    labelKo: '보완 요청',
    messageKey: 'debut.application.status.needsMoreInfo',
    defaultMessageKo: '추가 확인이 필요한 항목이 있어요. 안내를 확인해 주세요.',
  },
  approved_for_contact: {
    status: 'approved',
    labelKo: '연락 준비 중',
    messageKey: 'debut.application.status.approved',
    defaultMessageKo: '상담 또는 다음 안내를 드릴 수 있는 상태예요. 데뷔 확정은 별도 계약 이후 결정됩니다.',
  },
  approved: {
    status: 'approved',
    labelKo: '연락 준비 중',
    messageKey: 'debut.application.status.approved',
    defaultMessageKo: '상담 또는 다음 안내를 드릴 수 있는 상태예요. 데뷔 확정은 별도 계약 이후 결정됩니다.',
  },
  rejected: {
    status: 'rejected',
    labelKo: '심사 종료',
    messageKey: 'debut.application.status.rejected',
    defaultMessageKo: '이번 신청 검토가 종료됐어요. 공개 가능한 사유만 안내됩니다.',
  },
  archived: {
    status: 'canceled',
    labelKo: '신청 취소',
    messageKey: 'debut.application.status.canceled',
    defaultMessageKo: '사용자 요청 또는 운영 기준에 따라 신청이 종료됐어요.',
  },
  withdrawn: {
    status: 'canceled',
    labelKo: '신청 취소',
    messageKey: 'debut.application.status.canceled',
    defaultMessageKo: '사용자 요청 또는 운영 기준에 따라 신청이 종료됐어요.',
  },
};
type ActionTokenDebug = { id: string; token: string; expiresAt: Date };
const ARTIST_CATEGORY_LABELS = [
  '아티스트',
  '모델',
  '배우',
  '엔터테이너',
  '스포츠',
  '기타',
] as const;
const ARTIST_CATEGORY_FILTER_LABELS = [
  '전체',
  ...ARTIST_CATEGORY_LABELS,
] as const;
const TEMP_DISPLAY_NAME_COLORS = [
  '민트',
  '코랄',
  '하늘',
  '라벤더',
  '루비',
  '실버',
  '골드',
  '피치',
  '네온',
  '바이올렛',
] as const;
const TEMP_DISPLAY_NAME_OBJECTS = [
  '별빛',
  '달빛',
  '리듬',
  '무대',
  '오로라',
  '멜로디',
  '픽셀',
  '스파크',
  '하트',
  '스포트',
] as const;

type SessionContext = {
  userAgent?: string | null;
  ipAddress?: string | null;
};

type IdentityVerificationProvider = 'nice';
type IdentityVerificationMethod = 'mobile_phone' | 'ipin';
type IdentityVerificationProviderStatus = {
  provider: IdentityVerificationProvider;
  selected: boolean;
  configured: boolean;
  integrationStatus:
    | 'provider_not_selected'
    | 'not_configured'
    | 'credentials_ready_adapter_stub';
  methods: IdentityVerificationMethod[];
  env: Record<string, boolean>;
  requiredEnvKeys: string[];
};
type IdentityVerificationSummaryRecord = {
  status: string;
  provider: string | null;
  verifiedNameMasked: string | null;
  verifiedAt: Date | null;
  expiresAt: Date | null;
  birthDate?: Date | null;
};
type AccountAgeBand = 'unknown' | 'under_19' | 'adult_19_plus';
type AccountAgeGate = {
  status: 'unknown' | 'minor' | 'adult';
  ageBand: AccountAgeBand;
  isMinor: boolean | null;
  isAdult: boolean | null;
  ageYears: number | null;
  adultThresholdYears: number;
  verifiedBirthDatePresent: boolean;
  verificationSource: 'provider_birth_date' | 'phone_number_mvp' | 'unverified';
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly socialAuthService: SocialAuthService,
    private readonly authEmailDeliveryService: AuthEmailDeliveryService,
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
    const temporaryIdentity = await this.generateTemporaryProfileIdentity();
    const displayName = input.displayName?.trim() || temporaryIdentity.displayName;

    if (input.displayName) {
      await this.assertDisplayNameAvailable(displayName);
    }

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
          publicHandle: temporaryIdentity.publicHandle,
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
    const temporaryIdentity = await this.generateTemporaryProfileIdentity();
    const displayName = input.displayName?.trim() || temporaryIdentity.displayName;

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

      if (
        verifiedEmail &&
        authAccount.user.email === verifiedEmail &&
        !authAccount.user.emailVerifiedAt
      ) {
        await this.prisma.user.update({
          where: { id: authAccount.userId },
          data: {
            emailVerifiedAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }

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

        if (!existingUser.emailVerifiedAt) {
          await tx.user.update({
            where: { id: existingUser.id },
            data: {
              emailVerifiedAt: new Date(),
              updatedAt: new Date(),
            },
          });
        }

        return existingUser;
      }

      const createdUser = await tx.user.create({
        data: {
          email: verifiedEmail,
          emailVerifiedAt: verifiedEmail ? new Date() : null,
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
          publicHandle: temporaryIdentity.publicHandle,
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
        emailVerifiedAt: true,
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

  async getMyTrust(userId: string) {
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
        adminAccess: {
          select: {
            status: true,
            role: {
              select: {
                name: true,
                permissions: true,
              },
            },
          },
        },
        artistOperators: {
          where: { status: 'active' },
          select: {
            id: true,
            artistId: true,
            role: true,
            permissions: true,
            status: true,
          },
        },
        identityVerification: true,
        payoutAccount: true,
        payoutException: true,
      },
    });

    if (!user) {
      throw new BadRequestException('Active user not found');
    }

    const identityVerification = this.identityVerificationSummary(
      user.identityVerification,
      user.phoneNumber,
    );
    const identityVerified = identityVerification.status === 'verified';
    const accountState = this.accountStatePolicy(identityVerification);
    const identityProviderStatus = this.identityVerificationProviderStatus('nice');
    const payoutAccountReady = user.payoutAccount?.status === 'registered';
    const payoutExceptionApproved = user.payoutException?.status === 'approved';
    const hasActiveAdminAccess = user.adminAccess?.status === 'active';
    const artistOperators = user.artistOperators;
    const hasArtistOperatorAccess = artistOperators.length > 0;
    const level = hasActiveAdminAccess
      ? 'admin'
      : hasArtistOperatorAccess
        ? 'artist_operator'
        : identityVerified
          ? 'verified'
          : 'basic';

    const requiredActions = identityVerified
      ? []
      : [
          {
            code: 'identity_verification_required',
            titleKey: 'identityVerification.required.title',
            messageKey: 'identityVerification.required',
            appliesTo: [
              'referral_reward',
              'paid_support',
              'fan_letter',
              'creator_settlement',
            ],
          },
        ];

    return {
      userId: user.id,
      status: user.status,
      trust: {
        level,
        identityVerified,
        identityVerificationProvider: identityVerification.provider,
        identityProviderStatus,
        ageBand: identityVerification.ageBand,
        minor: identityVerification.minor,
        cleanModeRequired: identityVerification.cleanModeRequired,
        referralEligible: identityVerified,
        paidSupportEligible: identityVerified,
        creatorSettlementEligible:
          identityVerified &&
          hasArtistOperatorAccess &&
          (payoutAccountReady || payoutExceptionApproved),
        adminEligible: hasActiveAdminAccess,
      },
      accountState,
      settlement: {
        identityVerification,
        payoutAccount: this.payoutAccountSummary(user.payoutAccount),
        payoutException: this.payoutExceptionSummary(user.payoutException),
        payoutAccountReady,
        payoutExceptionApproved,
      },
      accountLimit: {
        enabled: false,
        enforced: false,
        maxAccountsPerIdentity: 3,
        currentAccountsForIdentity: identityVerified ? 1 : null,
        basis:
          identityVerification.provider === 'phone_number_mvp'
            ? 'phone_number_mvp'
            : identityVerified
              ? 'identity_subject_hash_after_provider_verification'
              : 'unverified',
        enforcement: 'policy_flag_only',
        messageKey: 'account.identityVerification.accountLimit',
      },
      roles: {
        admin: hasActiveAdminAccess
          ? {
              roleName: user.adminAccess?.role.name ?? null,
              permissions: user.adminAccess?.role.permissions ?? [],
            }
          : null,
        artistOperators,
      },
      requiredActions,
      policy: {
        freeLikeAllowedForUnverifiedUsers: true,
        paidSupportRequiresIdentityVerification: true,
        referralRewardRequiresIdentityVerification: true,
        creatorSettlementRequiresIdentityVerification: true,
        creatorSettlementRequiresPayoutAccount: true,
        identityVerificationAccountLimit: {
          enabled: false,
          enforced: false,
          maxAccountsPerIdentity: 3,
          basis: 'identity_subject_hash_after_provider_verification',
          enforcement: 'policy_flag_only',
          messageKey: 'account.identityVerification.accountLimit',
        },
        guestBrowsingAllowed: true,
        signupAllowedWithoutIdentityVerification:
          accountState.signupAllowedWithoutIdentityVerification,
        identityVerificationBeforeSignupRequired:
          accountState.identityVerificationBeforeSignupRequired,
        minorCleanModeEnforcedWhenVerifiedMinor: true,
      },
    };
  }

  getIdentityVerificationPolicy() {
    const providerStatus = this.identityVerificationProviderStatus('nice');

    return {
      provider: providerStatus.provider,
      methods: providerStatus.methods,
      providerStatus,
      policy: {
        maxAccountsPerIdentity: 3,
        signupAllowedWithoutIdentityVerification: true,
        identityVerificationBeforeSignupRequired: false,
        rawResidentRegistrationNumberStored: false,
        rawIdentityDocumentUploadRequired: false,
        rawProviderTokenStored: false,
        verifiedNameStorage: 'masked_only',
        birthDateStorage: 'date_only_after_provider_verification',
        identitySubjectStorage: 'hash_only',
        adultThresholdYears: 19,
        minorCleanModeEnforcedWhenVerifiedMinor: true,
        cleanModeSource: 'verified_birth_date_only',
        accountLimit: {
          enabled: false,
          enforced: false,
          maxAccountsPerIdentity: 3,
          basis: 'identity_subject_hash_after_provider_verification',
          enforcement: 'policy_flag_only',
          messageKey: 'account.identityVerification.accountLimit',
        },
        supportedProviders: ['nice'],
        phoneAndIpinPlanned: true,
        launchMode: 'provider_adapter_stub',
      },
      nextAction: this.identityVerificationNextAction(providerStatus, 'unverified'),
    };
  }

  async requestIdentityVerification(
    userId: string,
    input: RequestIdentityVerificationDto,
  ) {
    const provider = input.provider ?? 'nice';
    const method = this.normalizeIdentityVerificationMethod(input.method);
    const providerStatus = this.identityVerificationProviderStatus(provider);
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        status: 'active',
        deletedAt: null,
      },
      select: {
        id: true,
        identityVerification: true,
      },
    });

    if (!user) {
      throw new BadRequestException('Active user not found');
    }

    if (user.identityVerification?.status === 'verified') {
      return this.identityVerificationRequestView(
        user.identityVerification,
        providerStatus,
        method,
      );
    }

    if (!providerStatus.configured) {
      throw this.identityVerificationProviderNotConnectedException(
        providerStatus,
        user.identityVerification ?? null,
        method,
      );
    }

    const now = new Date();
    const metadata = {
      skeleton: true,
      requestedAt: now.toISOString(),
      method,
      returnUrlProvided: Boolean(input.returnUrl),
      providerConfigured: providerStatus.configured,
      providerIntegrationStatus: providerStatus.integrationStatus,
      rawIdentityDocumentStored: false,
      rawNameStored: false,
      rawPhoneNumberStored: false,
      rawProviderTokenStored: false,
      residentRegistrationNumberStored: false,
      signupAllowedWithoutIdentityVerification: true,
      cleanModeSource: 'verified_birth_date_only',
    };

    const record = await this.prisma.userIdentityVerification.upsert({
      where: { userId },
      create: {
        userId,
        status: 'unverified',
        provider,
        metadata: this.toJson(metadata),
      },
      update: {
        status: 'unverified',
        provider,
        metadata: this.toJson(metadata),
        updatedAt: now,
      },
    });

    return this.identityVerificationRequestView(record, providerStatus, method);
  }

  async confirmIdentityVerification(
    userId: string,
    verificationId: string,
    input: ConfirmIdentityVerificationDto,
  ) {
    if (verificationId !== 'self') {
      throw this.authBadRequest(
        'IDENTITY_VERIFICATION_INVALID_ID',
        'Invalid identity verification id.',
        'identityVerification.invalidId',
        { verificationId },
      );
    }

    const providerStatus = this.identityVerificationProviderStatus('nice');
    const record = await this.prisma.userIdentityVerification.findUnique({
      where: { userId },
    });
    const tokenReceived = input.token.trim().length > 0;

    throw this.identityVerificationProviderNotConnectedException(
      providerStatus,
      record,
      undefined,
      { tokenReceived },
    );
  }

  async getMySettlementProfile(userId: string) {
    const user = await this.findActiveSettlementUser(userId);

    return {
      settlementProfile: this.settlementProfileView(user),
      policy: this.settlementProfilePolicy(),
    };
  }

  async updateMySettlementProfile(userId: string, input: UpdateSettlementProfileDto) {
    await this.assertActiveUser(userId);
    const now = new Date();
    const hasPayoutInput =
      input.bankName !== undefined ||
      input.accountHolderName !== undefined ||
      input.accountLast4 !== undefined ||
      input.holderMatchesIdentity !== undefined;
    const hasExceptionInput = input.payoutExceptionReason !== undefined;

    if (!hasPayoutInput && !hasExceptionInput) {
      throw new BadRequestException('At least one settlement profile field is required');
    }

    if (hasPayoutInput) {
      const existingPayoutAccount = await this.prisma.userPayoutAccount.findUnique({
        where: { userId },
      });
      const bankName =
        input.bankName !== undefined
          ? input.bankName.trim() || null
          : existingPayoutAccount?.bankName ?? null;
      const accountHolderMasked =
        input.accountHolderName !== undefined
          ? this.maskPersonalName(input.accountHolderName)
          : existingPayoutAccount?.accountHolderMasked ?? null;
      const accountLast4 =
        input.accountLast4 !== undefined
          ? input.accountLast4.trim() || null
          : existingPayoutAccount?.accountLast4 ?? null;
      const holderMatchesIdentity =
        input.holderMatchesIdentity ?? existingPayoutAccount?.holderMatchesIdentity ?? false;
      const status =
        bankName && accountHolderMasked && accountLast4 ? 'registered' : 'needs_review';

      await this.prisma.userPayoutAccount.upsert({
        where: { userId },
        update: {
          status,
          bankName,
          accountHolderMasked,
          accountLast4,
          holderMatchesIdentity,
          metadata: {
            source: 'user_self_reported_mvp',
            rawAccountNumberStored: false,
          },
          updatedAt: now,
        },
        create: {
          userId,
          status,
          bankName,
          accountHolderMasked,
          accountLast4,
          holderMatchesIdentity,
          metadata: {
            source: 'user_self_reported_mvp',
            rawAccountNumberStored: false,
          },
        },
      });
    }

    if (hasExceptionInput) {
      const reason = input.payoutExceptionReason?.trim();

      await this.prisma.userPayoutException.upsert({
        where: { userId },
        update: {
          status: reason ? 'pending' : 'none',
          reason: reason || null,
          documentAttached: false,
          metadata: {
            source: 'user_self_reported_mvp',
            reviewedByAdmin: false,
          },
          updatedAt: now,
        },
        create: {
          userId,
          status: reason ? 'pending' : 'none',
          reason: reason || null,
          documentAttached: false,
          metadata: {
            source: 'user_self_reported_mvp',
            reviewedByAdmin: false,
          },
        },
      });
    }

    return this.getMySettlementProfile(userId);
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
        select: this.myPageDebutApplicationSelect(),
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
    const debutApplicationViews = debutApplications.map((application) =>
      this.toMyPageDebutApplicationView(application),
    );

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
        latestApplication: latestDebutApplication
          ? this.toMyPageDebutApplicationView(latestDebutApplication)
          : null,
        applications: debutApplicationViews,
        ctaState: latestDebutApplication ? 'status' : 'apply',
      },
      policy: {
        nicknameChangeIntervalDays: 30,
        displayName: {
          minLength: 2,
          maxLength: 20,
          unique: true,
          defaultFormat: '색상+사물+4자리숫자',
          autoAssignedOnSignup: true,
          firstChangeHasCooldown: true,
        },
        publicHandle: {
          unique: true,
          autoAssignedOnSignup: true,
          defaultFormat: '색상+사물+4자리숫자',
          editable: false,
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
      input.avatarAssetId === undefined &&
      input.coverAssetId === undefined
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
        throw new HttpException(
          'Nickname can be changed once every 30 days',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      await this.assertDisplayNameAvailable(input.displayName, userId);
    }

    await this.assertProfileImageAsset(userId, input.avatarAssetId, 'Avatar asset not found');
    await this.assertProfileImageAsset(userId, input.coverAssetId, 'Cover asset not found');

    const fallbackIdentity = profile
      ? null
      : await this.generateTemporaryProfileIdentity();

    await this.prisma.userProfile.upsert({
      where: { userId },
      update: this.clean({
        displayName: input.displayName,
        bio: input.bio,
        avatarAssetId: input.avatarAssetId,
        coverAssetId: input.coverAssetId,
        nicknameChangedAt:
          input.displayName !== undefined && profile?.displayName !== input.displayName
            ? now
            : undefined,
        updatedAt: now,
      }),
      create: {
        userId,
        displayName: input.displayName ?? fallbackIdentity?.displayName ?? 'Lumina Fan',
        publicHandle:
          fallbackIdentity?.publicHandle ??
          (await this.generateTemporaryProfileIdentity()).publicHandle,
        bio: input.bio,
        avatarAssetId: input.avatarAssetId,
        coverAssetId: input.coverAssetId,
        nicknameChangedAt: input.displayName !== undefined ? now : undefined,
      },
    });

    return this.getMe(userId);
  }

  async checkDisplayNameAvailability(displayName: string, currentUserId?: string) {
    const normalized = displayName.trim();
    const policy = {
      minLength: 2,
      maxLength: 20,
      unique: true,
      currentUserIsAvailable: Boolean(currentUserId),
    };

    const existingProfile = await this.prisma.userProfile.findFirst({
      where: {
        displayName: { equals: normalized, mode: 'insensitive' },
      },
      select: {
        userId: true,
        displayName: true,
      },
    });

    const isCurrentUser = Boolean(
      currentUserId && existingProfile?.userId === currentUserId,
    );
    const available = !existingProfile || isCurrentUser;

    return {
      displayName: normalized,
      available,
      reason: available ? null : 'already_taken',
      isCurrentUser,
      policy,
    };
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
      input.emailNotifications === undefined &&
      input.notifications === undefined
    ) {
      throw new BadRequestException('At least one settings field is required');
    }

    const notifications = input.notifications;
    const marketingOptIn = input.marketingOptIn ?? notifications?.marketingOptIn;
    const pushOptIn = input.pushOptIn ?? notifications?.pushOptIn;
    const activityNotifications =
      input.activityNotifications ?? notifications?.activityNotifications;
    const feedNotifications = input.feedNotifications ?? notifications?.feedNotifications;
    const emailNotifications =
      input.emailNotifications ?? notifications?.emailNotifications;

    if (
      input.locale === undefined &&
      input.timezone === undefined &&
      marketingOptIn === undefined &&
      pushOptIn === undefined &&
      activityNotifications === undefined &&
      feedNotifications === undefined &&
      emailNotifications === undefined
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
          marketingOptIn,
          pushOptIn,
          activityNotifications,
          feedNotifications,
          emailNotifications,
        }),
      },
      update: this.clean({
        locale: input.locale,
        timezone: input.timezone,
        marketingOptIn,
        pushOptIn,
        activityNotifications,
        feedNotifications,
        emailNotifications,
        updatedAt: new Date(),
      }),
    });

    return {
      settings: this.formatSettings(settings),
      policy: this.settingsPolicy(),
    };
  }

  getLocalizationPolicy(acceptLanguage?: string | string[]) {
    const header = Array.isArray(acceptLanguage)
      ? acceptLanguage.join(',')
      : acceptLanguage;
    const detectedLocale = this.detectSupportedLocale(header);

    return {
      defaultLocale: 'ko-KR',
      supportedLocales: SUPPORTED_LOCALES,
      detectedLocale,
      source: detectedLocale === 'ko-KR' && !header ? 'default' : 'accept-language',
      fallbackRule:
        'Use signed-in user settings.locale first, then localStorage, then detectedLocale, then ko-KR.',
      storageEndpoints: {
        get: 'GET /api/v1/me/settings',
        patch: 'PATCH /api/v1/me/settings',
      },
    };
  }

  getPublicBootstrap(acceptLanguage?: string | string[]) {
    return {
      service: 'lumina-stage',
      version: '2026-05-03.mvp',
      generatedAt: new Date().toISOString(),
      localization: this.getLocalizationPolicy(acceptLanguage),
      auth: {
        emailPassword: {
          enabled: true,
          passwordMinLength: 8,
          passwordMaxLength: 128,
          passwordRule: 'At least one letter and one number',
          defaultDisplayNameFormat: '색상+사물+4자리숫자',
          defaultPublicHandleFormat: '색상+사물+4자리숫자',
        },
        social: this.getSocialProviders(),
      },
      currency: {
        lumina: {
          code: 'L',
          unitPriceKrw: 10,
          signupBonusLumina: 300,
          referralBonusLumina: 500,
        },
      },
      features: {
        luminaPick: true,
        luminaFeed: true,
        luminaStation: true,
        debutApplications: true,
        notifications: true,
        userProfiles: true,
        payments: {
          enabled: false,
          status: 'pg_pending',
          note: 'Payment order APIs exist, but the production PG provider is not enabled yet.',
        },
        storageUploads: {
          enabled: true,
          note: 'Upload intent APIs exist. End-to-end object storage verification depends on production storage credentials.',
        },
      },
      policy: {
        paidLikeUnitPriceLumina: 10,
        paidLikeDailyLimit: 20,
        feedPostMaxImageCount: 4,
        luminaFeed: {
          maxImagesPerPost: 4,
          allowedAttachmentTypes: ['image'],
          allowedImageMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
          externalLinks: {
            enabled: true,
            acceptedUrlSchemes: ['https'],
            maxUrlLength: 2048,
            remoteFetch: 'disabled_for_mvp',
            storedFields: ['canonicalUrl', 'hostname', 'siteName'],
          },
          videoUpload: 'not_allowed_in_feed_mvp',
        },
        userImageUpload: {
          maxBytes: this.publicUserImageUploadMaxBytes(),
          maxMegabytes: Math.floor(this.publicUserImageUploadMaxBytes() / (1024 * 1024)),
          allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
          purposes: ['avatar', 'feed_image'],
          videoUpload: 'not_allowed_in_feed_mvp',
        },
        artistCategories: {
          filterLabels: ARTIST_CATEGORY_FILTER_LABELS,
          categoryLabels: ARTIST_CATEGORY_LABELS,
          fallbackCategory: '기타',
          sourceField: 'displayCategory',
          responseFields: ['category', 'displayCategory'],
          rule: 'Use category/displayCategory from artist responses. Unknown or unapproved concepts fall back to 기타 until operations approves a new category.',
        },
        artistVisibility:
          'Only active public artists are returned in user-facing artist lists.',
      },
      endpoints: {
        appBootstrap: 'GET /api/v1/app/bootstrap',
        artists: 'GET /api/v1/artists',
        artistRoadmap: 'GET /api/v1/artists/roadmap',
        localizationPolicy: 'GET /api/v1/localization/policy',
        meSettings: 'GET /api/v1/me/settings',
        updateMeSettings: 'PATCH /api/v1/me/settings',
        socialProviders: 'GET /api/v1/auth/social/providers',
        luminaStation: 'GET /api/v1/lumina-station',
        notifications: 'GET /api/v1/me/notifications',
        debutPolicy: 'GET /api/v1/debut/policy',
      },
    };
  }

  async requestEmailVerification(input: RequestEmailVerificationDto) {
    const email = input.email.trim().toLowerCase();
    let debugToken: ActionTokenDebug | null = null;
    const user = await this.prisma.user.findFirst({
      where: {
        email,
        status: 'active',
        deletedAt: null,
      },
      select: {
        id: true,
        emailVerifiedAt: true,
      },
    });

    if (user && !user.emailVerifiedAt) {
      debugToken = await this.createUserActionToken(
        user.id,
        EMAIL_VERIFICATION_PURPOSE,
        EMAIL_VERIFICATION_TOKEN_TTL_MS,
        email,
      );
    }

    const delivery = await this.sendActionEmailNeutral({
      to: email,
      purpose: EMAIL_VERIFICATION_PURPOSE,
      debugToken,
    });

    return {
      success: true,
      ok: true,
      delivery,
      debug: this.actionTokenDebugPayload(debugToken),
    };
  }

  async confirmEmailVerification(input: ConfirmEmailVerificationDto) {
    const token = await this.consumeUserActionToken(
      input.token,
      EMAIL_VERIFICATION_PURPOSE,
    );
    this.assertUserCanLogin(token.user);

    await this.prisma.user.update({
      where: { id: token.userId },
      data: {
        emailVerifiedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return { success: true, ok: true };
  }

  async requestPasswordReset(input: RequestPasswordResetDto) {
    const email = input.email.trim().toLowerCase();
    let debugToken: ActionTokenDebug | null = null;
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
        email,
      );
    }

    const delivery = await this.sendActionEmailNeutral({
      to: email,
      purpose: PASSWORD_RESET_PURPOSE,
      debugToken,
    });

    return {
      success: true,
      ok: true,
      delivery,
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
        throw this.authBadRequest(
          'AUTH_EMAIL_PASSWORD_NOT_CONFIGURED',
          'Email password is not configured for this account.',
          'auth.password.emailNotConfigured',
        );
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
      success: true,
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
    emailVerifiedAt: Date | null;
    phoneNumber: string | null;
    status: string;
    createdAt: Date;
    authAccounts: { provider: string; passwordHash: string | null }[];
    profile: {
      displayName: string;
      publicHandle: string;
      avatarAssetId: string | null;
      coverAssetId: string | null;
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
    const coverAsset = user.profile?.coverAssetId
      ? await this.prisma.asset.findUnique({
          where: { id: user.profile.coverAssetId },
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
      emailVerifiedAt: user.emailVerifiedAt,
      emailVerified: Boolean(user.emailVerifiedAt),
      phoneNumber: user.phoneNumber,
      status: user.status,
      provider: primaryProvider,
      providers: user.authAccounts.map((account) => account.provider),
      hasPassword: user.authAccounts.some((account) => Boolean(account.passwordHash)),
      isSocialOnly: !user.authAccounts.some((account) => Boolean(account.passwordHash)),
      createdAt: user.createdAt,
      displayName:
        user.profile?.displayName ?? user.profile?.publicHandle ?? 'Lumina Fan',
      publicHandle: user.profile?.publicHandle ?? null,
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
      coverImageUrl: coverAsset
        ? buildPublicAssetUrl(this.configService, coverAsset.storageKey)
        : null,
      coverAsset: coverAsset
        ? {
            ...coverAsset,
            url: buildPublicAssetUrl(this.configService, coverAsset.storageKey),
            thumbnailUrl: buildPublicAssetUrl(this.configService, coverAsset.storageKey),
            status: this.assetStatus(coverAsset.metadata),
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

  private async assertDisplayNameAvailable(displayName: string, currentUserId?: string) {
    const availability = await this.checkDisplayNameAvailability(displayName, currentUserId);

    if (!availability.available) {
      throw new ConflictException({
        code: 'DISPLAY_NAME_ALREADY_TAKEN',
        message: 'Display name is already taken',
        displayName: availability.displayName,
      });
    }
  }

  private async generateTemporaryProfileIdentity() {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const color =
        TEMP_DISPLAY_NAME_COLORS[
          randomInt(0, TEMP_DISPLAY_NAME_COLORS.length)
        ];
      const object =
        TEMP_DISPLAY_NAME_OBJECTS[
          randomInt(0, TEMP_DISPLAY_NAME_OBJECTS.length)
        ];
      const digits = randomInt(1000, 10000);
      const candidate = `${color}${object}${digits}`;
      const existingProfile = await this.prisma.userProfile.findFirst({
        where: { publicHandle: candidate },
        select: { userId: true },
      });

      if (!existingProfile) {
        return {
          displayName: candidate,
          publicHandle: candidate,
        };
      }
    }

    const fallback = `lumina-${randomBytes(8).toString('hex')}`;

    return {
      displayName: fallback,
      publicHandle: fallback,
    };
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
        supported: SUPPORTED_LOCALES,
        fallback:
          'Use signed-in user settings.locale first, then localStorage, then browser language, then ko-KR.',
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

  private async findActiveSettlementUser(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        status: 'active',
        deletedAt: null,
      },
      select: {
        id: true,
        phoneNumber: true,
        status: true,
        identityVerification: true,
        payoutAccount: true,
        payoutException: true,
        artistOperators: {
          where: { status: 'active' },
          select: {
            id: true,
            artistId: true,
            role: true,
            status: true,
          },
        },
      },
    });

    if (!user) {
      throw new BadRequestException('Active user not found');
    }

    return user;
  }

  private settlementProfileView(user: Awaited<ReturnType<AuthService['findActiveSettlementUser']>>) {
    const identityVerification = this.identityVerificationSummary(
      user.identityVerification,
      user.phoneNumber,
    );
    const payoutAccount = this.payoutAccountSummary(user.payoutAccount);
    const payoutException = this.payoutExceptionSummary(user.payoutException);
    const identityVerified = identityVerification.status === 'verified';
    const payoutReady = payoutAccount.status === 'registered';
    const payoutExceptionApproved = payoutException.status === 'approved';
    const requiredActions = [
      !identityVerified ? 'identity_verification_required' : null,
      !payoutReady && !payoutExceptionApproved ? 'payout_account_required' : null,
    ].filter(Boolean);

    return {
      userId: user.id,
      status: user.status,
      identityVerification,
      payoutAccount,
      payoutException,
      artistOperatorAccess: user.artistOperators.map((operator) => ({
        id: operator.id,
        artistId: operator.artistId,
        role: operator.role,
        status: operator.status,
      })),
      eligibility: {
        identityVerified,
        payoutReady,
        payoutExceptionApproved,
        creatorSettlementEligible:
          identityVerified &&
          user.artistOperators.length > 0 &&
          (payoutReady || payoutExceptionApproved),
        requiredActions,
      },
    };
  }

  private normalizeIdentityVerificationMethod(
    method?: RequestIdentityVerificationDto['method'],
  ): IdentityVerificationMethod {
    return method === 'ipin' ? 'ipin' : 'mobile_phone';
  }

  private identityVerificationProviderStatus(
    provider: IdentityVerificationProvider = 'nice',
  ): IdentityVerificationProviderStatus {
    const selectedProvider = (
      this.configService.get<string>('IDENTITY_VERIFICATION_PROVIDER') ?? 'nice'
    )
      .trim()
      .toLowerCase();
    const selected = selectedProvider === provider;
    const requiredEnvKeys = [
      'NICE_IDENTITY_SITE_CODE',
      'NICE_IDENTITY_SITE_PASSWORD',
      'NICE_IDENTITY_RETURN_URL',
      'NICE_IDENTITY_CALLBACK_URL',
    ];
    const env = Object.fromEntries(
      requiredEnvKeys.map((key) => [key, this.hasConfig(key)]),
    );
    const configured = selected && requiredEnvKeys.every((key) => env[key]);
    const integrationStatus = !selected
      ? 'provider_not_selected'
      : configured
        ? 'credentials_ready_adapter_stub'
        : 'not_configured';

    return {
      provider,
      selected,
      configured,
      integrationStatus,
      methods: ['mobile_phone', 'ipin'],
      env,
      requiredEnvKeys,
    };
  }

  private identityVerificationNextAction(
    providerStatus: IdentityVerificationProviderStatus,
    status: string,
  ) {
    if (status === 'verified') {
      return {
        type: 'already_verified',
        label: 'Identity verification complete',
      };
    }

    if (!providerStatus.selected) {
      return {
        type: 'provider_not_selected',
        label: 'Identity verification is unavailable',
      };
    }

    if (!providerStatus.configured) {
      return {
        type: 'provider_not_configured',
        label: 'Identity verification setup is required',
      };
    }

    return {
      type: 'provider_adapter_pending',
      label: 'Identity verification adapter implementation is pending',
    };
  }

  private identityVerificationRequestView(
    record: IdentityVerificationSummaryRecord | null,
    providerStatus: IdentityVerificationProviderStatus,
    method: IdentityVerificationMethod,
  ) {
    const verification = this.identityVerificationSummary(record);

    return {
      verificationId: 'self',
      method,
      verification,
      providerStatus,
      nextAction: this.identityVerificationNextAction(
        providerStatus,
        verification.status,
      ),
      storagePolicy: {
        rawResidentRegistrationNumberStored: false,
        rawIdentityDocumentStored: false,
      },
    };
  }

  private identityVerificationProviderNotConnectedException(
    providerStatus: IdentityVerificationProviderStatus,
    record: IdentityVerificationSummaryRecord | null,
    method?: IdentityVerificationMethod,
    details: Record<string, unknown> = {},
  ) {
    const verification = this.identityVerificationSummary(record);

    return new HttpException(
      {
        code: 'IDENTITY_VERIFICATION_PROVIDER_NOT_CONNECTED',
        message: 'Identity verification provider adapter is not connected yet.',
        messageKey: 'identityVerification.providerNotConnected',
        statusCode: HttpStatus.NOT_IMPLEMENTED,
        verificationId: 'self',
        method,
        requestStarted: false,
        verification,
        providerStatus,
        nextAction: this.identityVerificationNextAction(
          providerStatus,
          verification.status,
        ),
        details: {
          requestStarted: false,
          ...details,
        },
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  private settlementProfilePolicy() {
    return {
      rawAccountNumberStored: false,
      payoutAccountInput:
        'Store bankName, masked account holder name, and accountLast4 only. Do not store full account numbers before a verified payout provider is connected.',
      identityVerification:
        'MVP uses phone-number fallback when present. Real identity provider connection is a later compliance step.',
      payoutException:
        'Use only when the creator cannot use the normal self-owned payout account route. Admin review is required before payout.',
    };
  }

  private identityVerificationSummary(
    record: IdentityVerificationSummaryRecord | null,
    phoneNumber?: string | null,
  ) {
    if (record) {
      const ageGate = this.accountAgeGate(record.birthDate ?? null, record.status);

      return {
        status: record.status,
        provider: record.provider,
        identityVerified: record.status === 'verified',
        verifiedNameMasked: record.verifiedNameMasked,
        verifiedAt: record.verifiedAt,
        expiresAt: record.expiresAt,
        birthDateStatus: record.birthDate ? 'stored_date_only' : 'not_collected',
        ageBand: ageGate.ageBand,
        minor: ageGate.isMinor,
        cleanModeRequired: this.cleanModePolicy(ageGate).required,
        ageGate,
        cleanMode: this.cleanModePolicy(ageGate),
      };
    }

    if (phoneNumber) {
      const ageGate = this.accountAgeGate(null, 'phone_number_mvp');

      return {
        status: 'verified',
        provider: 'phone_number_mvp',
        identityVerified: true,
        verifiedNameMasked: null,
        verifiedAt: null,
        expiresAt: null,
        birthDateStatus: 'not_collected',
        ageBand: ageGate.ageBand,
        minor: ageGate.isMinor,
        cleanModeRequired: this.cleanModePolicy(ageGate).required,
        ageGate,
        cleanMode: this.cleanModePolicy(ageGate),
      };
    }

    const ageGate = this.accountAgeGate(null, 'unverified');

    return {
      status: 'unverified',
      provider: null,
      identityVerified: false,
      verifiedNameMasked: null,
      verifiedAt: null,
      expiresAt: null,
      birthDateStatus: 'not_collected',
      ageBand: ageGate.ageBand,
      minor: ageGate.isMinor,
      cleanModeRequired: this.cleanModePolicy(ageGate).required,
      ageGate,
      cleanMode: this.cleanModePolicy(ageGate),
    };
  }

  private accountStatePolicy(identityVerification: ReturnType<AuthService['identityVerificationSummary']>) {
    return {
      accountStatus: identityVerification.status,
      identityVerified: identityVerification.identityVerified,
      ageBand: identityVerification.ageBand,
      minor: identityVerification.minor,
      cleanModeRequired: identityVerification.cleanModeRequired,
      signupAllowedWithoutIdentityVerification: true,
      identityVerificationBeforeSignupRequired: false,
      ageGate: identityVerification.ageGate,
      cleanMode: identityVerification.cleanMode,
      restrictedUntilIdentityVerified: [
        'referral_reward',
        'paid_support',
        'fan_letter',
        'creator_settlement',
      ],
      storagePolicy: {
        rawResidentRegistrationNumberStored: false,
        rawIdentityDocumentStored: false,
        rawProviderTokenStored: false,
        verifiedNameStorage: 'masked_only',
        birthDateStorage: 'date_only_after_provider_verification',
        identitySubjectStorage: 'hash_only',
      },
      accountLimit: {
        enabled: false,
        enforced: false,
        maxAccountsPerIdentity: 3,
        basis: 'identity_subject_hash_after_provider_verification',
        enforcement: 'policy_flag_only',
        messageKey: 'account.identityVerification.accountLimit',
      },
    };
  }

  private accountAgeGate(
    birthDate: Date | null,
    status: string,
  ): AccountAgeGate {
    const verifiedProviderBirthDate = status === 'verified' ? birthDate : null;
    const verificationSource =
      status === 'phone_number_mvp'
        ? 'phone_number_mvp'
        : verifiedProviderBirthDate
          ? 'provider_birth_date'
          : 'unverified';
    const adultThresholdYears = 19;

    if (!verifiedProviderBirthDate) {
      return {
        status: 'unknown',
        ageBand: 'unknown',
        isMinor: null,
        isAdult: null,
        ageYears: null,
        adultThresholdYears,
        verifiedBirthDatePresent: false,
        verificationSource,
      };
    }

    const ageYears = this.ageYears(verifiedProviderBirthDate, new Date());
    const isAdult = ageYears >= adultThresholdYears;

    return {
      status: isAdult ? 'adult' : 'minor',
      ageBand: isAdult ? 'adult_19_plus' : 'under_19',
      isMinor: !isAdult,
      isAdult,
      ageYears,
      adultThresholdYears,
      verifiedBirthDatePresent: true,
      verificationSource,
    };
  }

  private cleanModePolicy(ageGate: AccountAgeGate) {
    const minor = ageGate.status === 'minor';
    const unknown = ageGate.status === 'unknown';

    return {
      status: minor ? 'required' : unknown ? 'age_unverified' : 'not_required',
      required: minor,
      mode: minor ? 'minor_protected' : 'standard',
      source: ageGate.verificationSource,
      messageKey: minor
        ? 'account.cleanMode.minorRequired'
        : unknown
          ? 'account.cleanMode.ageUnverified'
          : 'account.cleanMode.notRequired',
      signupBlocking: false,
    };
  }

  private ageYears(birthDate: Date, asOf: Date) {
    let years = asOf.getUTCFullYear() - birthDate.getUTCFullYear();
    const birthdayHasPassed =
      asOf.getUTCMonth() > birthDate.getUTCMonth() ||
      (asOf.getUTCMonth() === birthDate.getUTCMonth() &&
        asOf.getUTCDate() >= birthDate.getUTCDate());

    if (!birthdayHasPassed) {
      years -= 1;
    }

    return years;
  }

  private payoutAccountSummary(
    record:
      | {
          status: string;
          bankName: string | null;
          accountHolderMasked: string | null;
          accountLast4: string | null;
          holderMatchesIdentity: boolean;
          updatedAt: Date;
        }
      | null,
  ) {
    if (!record) {
      return {
        status: 'missing',
        bankName: null,
        accountHolderMasked: null,
        accountLast4: null,
        holderMatchesIdentity: false,
        updatedAt: null,
      };
    }

    return {
      status: record.status,
      bankName: record.bankName,
      accountHolderMasked: record.accountHolderMasked,
      accountLast4: record.accountLast4,
      holderMatchesIdentity: record.holderMatchesIdentity,
      updatedAt: record.updatedAt,
    };
  }

  private payoutExceptionSummary(
    record:
      | {
          status: string;
          reason: string | null;
          documentAttached: boolean;
          approvedByUserId: string | null;
          approvedAt: Date | null;
          updatedAt: Date;
        }
      | null,
  ) {
    if (!record) {
      return {
        status: 'none',
        reason: null,
        documentAttached: false,
        approvedByUserId: null,
        approvedAt: null,
        updatedAt: null,
      };
    }

    return {
      status: record.status,
      reason: record.reason,
      documentAttached: record.documentAttached,
      approvedByUserId: record.approvedByUserId,
      approvedAt: record.approvedAt,
      updatedAt: record.updatedAt,
    };
  }

  private maskPersonalName(value: string) {
    const normalized = value.trim();

    if (!normalized) {
      return null;
    }

    if (normalized.length <= 2) {
      return `${normalized[0]}*`;
    }

    return `${normalized[0]}${'*'.repeat(normalized.length - 2)}${normalized.at(-1)}`;
  }

  private detectSupportedLocale(acceptLanguage?: string) {
    if (!acceptLanguage) {
      return 'ko-KR';
    }

    const candidates = acceptLanguage
      .split(',')
      .map((item) => item.trim().split(';')[0])
      .filter(Boolean);

    for (const candidate of candidates) {
      const normalized = this.normalizeLocale(candidate);
      if (SUPPORTED_LOCALES.includes(normalized as (typeof SUPPORTED_LOCALES)[number])) {
        return normalized;
      }
    }

    return 'ko-KR';
  }

  private normalizeLocale(value: string) {
    const [language, region] = value.replace('_', '-').split('-');
    const normalizedLanguage = language.toLowerCase();
    const normalizedRegion = region?.toUpperCase();
    const base = normalizedRegion
      ? `${normalizedLanguage}-${normalizedRegion}`
      : normalizedLanguage;

    if (base === 'ko') {
      return 'ko-KR';
    }

    if (base === 'ja') {
      return 'ja-JP';
    }

    if (base === 'en') {
      return 'en-US';
    }

    if (base === 'zh' || base === 'zh-CN' || base === 'zh-HANS') {
      return 'zh-CN';
    }

    return base;
  }

  private userFollowUserInclude(direction: 'follower' | 'following') {
    const userSelect = {
      id: true,
      email: true,
      status: true,
      profile: {
        select: {
          displayName: true,
          publicHandle: true,
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
        displayName:
          user.profile?.displayName ?? user.profile?.publicHandle ?? 'Lumina User',
        publicHandle: user.profile?.publicHandle ?? null,
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

  private myPageDebutApplicationSelect() {
    return {
      id: true,
      status: true,
      displayName: true,
      participationType: true,
      shareTierRequested: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
      attachments: {
        select: {
          id: true,
          category: true,
          status: true,
        },
      },
    } satisfies Prisma.DebutApplicationSelect;
  }

  private toMyPageDebutApplicationView(application: any) {
    const metadata = this.recordOrEmpty(application.metadata);
    const copy =
      MYPAGE_DEBUT_STATUS_COPY[application.status] ??
      MYPAGE_DEBUT_STATUS_COPY.submitted;
    const applicationChannel =
      this.stringFromUnknown(metadata.applicationChannel) ?? 'phone_consultation';
    const applicationType =
      this.stringFromUnknown(metadata.applicationType) ?? 'personal_unaffiliated';
    const attachments = application.attachments ?? [];
    const categories = [
      ...new Set(
        attachments
          .map((attachment: any) => this.stringFromUnknown(attachment.category))
          .filter((category: string | undefined): category is string => Boolean(category)),
      ),
    ];

    return {
      id: application.id,
      status: copy.status,
      statusLabelKo: copy.labelKo,
      messageKey: copy.messageKey,
      defaultMessageKo: copy.defaultMessageKo,
      displayName: application.displayName,
      participationType: application.participationType,
      applicationChannel,
      applicationType,
      submittedAt: application.createdAt,
      updatedAt: application.updatedAt,
      requestedShareRate: application.shareTierRequested,
      materialSummary: {
        count: attachments.length,
        categories,
        hasPrivateMaterials: attachments.length > 0,
        metadataOnly: true,
      },
      statusHistory: this.myPageDebutStatusHistory(application, copy),
      publicNotice: {
        status: copy.status,
        titleKey: `${copy.messageKey}.title`,
        bodyKey: `${copy.messageKey}.body`,
        publicReason:
          this.stringFromUnknown(metadata.publicStatusReason) ??
          this.stringFromUnknown(metadata.userVisibleReason) ??
          null,
        dispatch: {
          inAppSent: false,
          emailSent: false,
          contractOnly: true,
        },
        internalAdminNoteReturned: false,
        settlementOrContractFinalized: false,
      },
      privacy: {
        contactReturned: false,
        introReturned: false,
        adminReviewNoteReturned: false,
        internalMetadataReturned: false,
        privateMaterialUrlReturned: false,
      },
    };
  }

  private myPageDebutStatusHistory(
    application: any,
    currentCopy: { status: string; labelKo: string; messageKey: string },
  ) {
    const submittedCopy = MYPAGE_DEBUT_STATUS_COPY.submitted;
    const history = [
      {
        status: submittedCopy.status,
        labelKo: submittedCopy.labelKo,
        messageKey: submittedCopy.messageKey,
        occurredAt: application.createdAt,
        source: 'application.createdAt',
      },
    ];

    if (currentCopy.status !== 'submitted') {
      history.push({
        status: currentCopy.status,
        labelKo: currentCopy.labelKo,
        messageKey: currentCopy.messageKey,
        occurredAt: application.updatedAt,
        source: 'application.updatedAt',
      });
    }

    return history;
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

  private publicUserImageUploadMaxBytes() {
    const configured = Number(this.configService.get<string>('MAX_IMAGE_UPLOAD_BYTES'));

    return Number.isInteger(configured) && configured > 0
      ? configured
      : USER_IMAGE_UPLOAD_MAX_BYTES;
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
    targetEmail: string,
  ): Promise<ActionTokenDebug> {
    const rawToken = this.createOpaqueToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    let tokenId = '';

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

      const created = await tx.userActionToken.create({
        data: {
          userId,
          purpose,
          tokenHash: this.hashToken(rawToken),
          expiresAt,
          deliveryStatus: 'pending',
          deliveryChannel: 'email',
          targetEmailMasked: this.maskEmail(targetEmail),
        },
      });
      tokenId = created.id;
    });

    return { id: tokenId, token: rawToken, expiresAt };
  }

  private actionTokenDebugPayload(token: ActionTokenDebug | null) {
    if (!token || !this.shouldExposeActionTokensForDebug()) {
      return undefined;
    }

    return {
      actionToken: token.token,
      expiresAt: token.expiresAt,
      warning: 'Debug only. Never enable in production or share tokens publicly.',
    };
  }

  private async sendActionEmailNeutral(input: {
    to: string;
    purpose: typeof EMAIL_VERIFICATION_PURPOSE | typeof PASSWORD_RESET_PURPOSE;
    debugToken: ActionTokenDebug | null;
  }) {
    if (!input.debugToken) {
      return this.authEmailDeliveryService.requestStatus();
    }

    const attemptedAt = new Date();

    try {
      const delivery = await this.authEmailDeliveryService.sendActionEmail({
        to: input.to,
        purpose: input.purpose,
        actionToken: input.debugToken.token,
        expiresAt: input.debugToken.expiresAt,
      });
      await this.recordActionTokenDelivery(input.debugToken.id, delivery, attemptedAt);

      return delivery;
    } catch {
      const delivery = this.authEmailDeliveryService.requestStatus();
      await this.recordActionTokenDelivery(
        input.debugToken.id,
        delivery,
        attemptedAt,
        true,
      );

      return delivery;
    }
  }

  private recordActionTokenDelivery(
    tokenId: string,
    delivery: AuthEmailDeliveryResult,
    attemptedAt: Date,
    failed = false,
  ) {
    const now = new Date();
    const deliveryStatus = failed ? 'failed' : delivery.status;

    return this.prisma.userActionToken.update({
      where: { id: tokenId },
      data: {
        deliveryStatus,
        deliveryChannel: delivery.channel,
        deliveryProvider: delivery.provider ?? null,
        deliveryAttemptedAt: attemptedAt,
        deliveryAcceptedAt: deliveryStatus === 'accepted' ? now : null,
        deliveryFailedAt: deliveryStatus === 'failed' ? now : null,
      },
    });
  }

  private maskEmail(email?: string | null) {
    if (!email) {
      return null;
    }

    const [name, domain] = email.split('@');
    if (!domain) {
      return '***';
    }

    return `${name.slice(0, 2)}***@${domain}`;
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
      throw this.invalidActionTokenException(purpose);
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
        ledgerType: 'referral_reward',
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
      throw this.authUnauthorized(
        'AUTH_USER_NOT_ACTIVE',
        'User is not active.',
        'auth.user.notActive',
      );
    }
  }

  private invalidActionTokenException(purpose: string) {
    if (purpose === EMAIL_VERIFICATION_PURPOSE) {
      return this.authBadRequest(
        'AUTH_EMAIL_VERIFICATION_TOKEN_INVALID_OR_EXPIRED',
        'Email verification token is invalid or expired.',
        'auth.emailVerification.tokenInvalidOrExpired',
      );
    }

    if (purpose === PASSWORD_RESET_PURPOSE) {
      return this.authBadRequest(
        'AUTH_PASSWORD_RESET_TOKEN_INVALID_OR_EXPIRED',
        'Password reset token is invalid or expired.',
        'auth.passwordReset.tokenInvalidOrExpired',
      );
    }

    return this.authBadRequest(
      'AUTH_ACTION_TOKEN_INVALID_OR_EXPIRED',
      'Action token is invalid or expired.',
      'auth.actionToken.invalidOrExpired',
    );
  }

  private authBadRequest(
    code: string,
    message: string,
    messageKey: string,
    details?: unknown,
  ) {
    return new BadRequestException({ code, message, messageKey, details });
  }

  private authUnauthorized(code: string, message: string, messageKey: string) {
    return new UnauthorizedException({ code, message, messageKey });
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

  private async assertProfileImageAsset(
    userId: string,
    assetId: string | null | undefined,
    notFoundMessage: string,
  ) {
    if (!assetId) {
      return;
    }

    const asset = await this.prisma.asset.findFirst({
      where: {
        id: assetId,
        assetType: 'image',
        metadata: {
          path: ['uploadIntent', 'createdByUserId'],
          equals: userId,
        },
      },
      select: { id: true, metadata: true },
    });

    if (!asset) {
      throw new BadRequestException(notFoundMessage);
    }

    const status = this.assetStatus(asset.metadata);

    if (status !== 'ready' && status !== 'uploaded') {
      throw new BadRequestException('Profile image asset upload must be confirmed');
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

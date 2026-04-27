import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from './auth.types';
import { LoginDto, RegisterDto } from './dto/auth.dto';

const PASSWORD_HASH_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(input: RegisterDto) {
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

      await tx.walletAccount.create({
        data: {
          userId: createdUser.id,
          currencyCode: 'LUMINA',
        },
      });

      return createdUser;
    });

    return {
      user: await this.getMe(user.id),
      tokens: await this.issueTokens(user.id, email),
    };
  }

  async login(input: LoginDto) {
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
      tokens: await this.issueTokens(authAccount.userId, email),
    };
  }

  async refresh(refreshToken: string) {
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

    return {
      user: await this.getMe(user.id),
      tokens: await this.issueTokens(user.id, user.email),
    };
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
          where: { currencyCode: 'LUMINA' },
        },
      },
    });

    if (!user) {
      throw new BadRequestException('Active user not found');
    }

    return user;
  }

  private async issueTokens(userId: string, email?: string | null) {
    const accessPayload: JwtPayload = {
      sub: userId,
      email,
      tokenType: 'access',
    };
    const refreshPayload: JwtPayload = {
      sub: userId,
      email,
      tokenType: 'refresh',
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.getJwtExpiresIn('JWT_ACCESS_EXPIRES_IN', '15m'),
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.getJwtExpiresIn('JWT_REFRESH_EXPIRES_IN', '30d'),
      }),
    ]);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
    };
  }

  private getJwtExpiresIn(key: string, fallback: string) {
    return (this.configService.get<string>(key) ?? fallback) as '15m';
  }
}

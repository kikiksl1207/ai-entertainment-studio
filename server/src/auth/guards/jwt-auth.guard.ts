import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { AuthUser, JwtPayload } from '../auth.types';
import { PrismaService } from '../../prisma/prisma.service';

type RequestWithAuth = {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthUser;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const token = this.extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException('Bearer token is required');
    }

    let secret: string;
    try {
      secret = this.configService.getOrThrow<string>('JWT_ACCESS_SECRET');
    } catch {
      throw new ServiceUnavailableException({
        code: 'AUTH_CONFIG_UNAVAILABLE',
        message: 'Authentication temporarily unavailable',
      });
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret,
      });

      if (
        payload?.tokenType !== 'access' ||
        typeof payload.sub !== 'string' ||
        !payload.sub.trim()
      ) {
        throw new UnauthorizedException('Access token is required');
      }

    } catch (error) {
      if (error instanceof TokenExpiredError) {
        throw new UnauthorizedException({
          code: 'AUTH_TOKEN_EXPIRED',
          message: 'Invalid or expired access token',
        });
      }
      throw new UnauthorizedException('Invalid or expired access token');
    }

    let user: { id: string; email: string | null } | null;
    try {
      user = await this.prisma.user.findFirst({
        where: {
          id: payload.sub,
          status: 'active',
          deletedAt: null,
        },
        select: {
          id: true,
          email: true,
        },
      });
    } catch {
      throw new ServiceUnavailableException({
        code: 'AUTH_LOOKUP_UNAVAILABLE',
        message: 'Authentication temporarily unavailable',
      });
    }

    if (!user) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    request.user = {
      id: user.id,
      email: user.email ?? payload.email,
    };

    return true;
  }

  private extractBearerToken(header: string | string[] | undefined) {
    const value = Array.isArray(header) ? header[0] : header;

    if (!value?.startsWith('Bearer ')) {
      return null;
    }

    return value.slice('Bearer '.length);
  }
}

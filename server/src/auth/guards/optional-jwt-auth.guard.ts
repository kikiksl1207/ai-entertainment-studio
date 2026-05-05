import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser, JwtPayload } from '../auth.types';

type RequestWithOptionalAuth = {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthUser;
};

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestWithOptionalAuth>();
    const token = this.extractBearerToken(request.headers.authorization);

    if (!token) {
      return true;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });

      if (payload.tokenType !== 'access') {
        return true;
      }

      const user = await this.prisma.user.findFirst({
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

      if (user) {
        request.user = {
          id: user.id,
          email: user.email ?? payload.email,
        };
      }
    } catch {
      return true;
    }

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

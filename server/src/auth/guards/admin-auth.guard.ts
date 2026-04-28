import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthUser } from '../auth.types';

type RequestWithAuth = {
  user?: AuthUser;
};

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly jwtAuthGuard: JwtAuthGuard,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    await this.jwtAuthGuard.canActivate(context);

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const authenticatedUser = request.user;
    const userId = authenticatedUser?.id;

    if (!userId) {
      throw new ForbiddenException('Admin access is required');
    }

    const adminUser = await this.prisma.adminUser.findUnique({
      where: { userId },
      include: { role: true },
    });

    if (adminUser?.status === 'active') {
      await this.prisma.adminUser.update({
        where: { id: adminUser.id },
        data: { lastAccessAt: new Date() },
      });

      request.user = {
        ...authenticatedUser,
        adminRole: adminUser.role.name,
        adminPermissions: adminUser.role.permissions,
      };

      return true;
    }

    if (this.isBootstrapAdmin(authenticatedUser?.email)) {
      request.user = {
        ...authenticatedUser,
        adminRole: 'super_admin',
        adminPermissions: ['*'],
      };

      return true;
    }

    throw new ForbiddenException('Admin access is required');
  }

  private isBootstrapAdmin(email?: string | null) {
    if (!email) {
      return false;
    }

    return this.getAdminEmails().has(email.toLowerCase());
  }

  private getAdminEmails() {
    return new Set(
      (this.configService.get<string>('ADMIN_EMAILS') ?? '')
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    );
  }
}

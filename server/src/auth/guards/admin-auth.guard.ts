import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  ) {}

  async canActivate(context: ExecutionContext) {
    await this.jwtAuthGuard.canActivate(context);

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const adminEmails = this.getAdminEmails();

    if (!request.user?.email || !adminEmails.has(request.user.email.toLowerCase())) {
      throw new ForbiddenException('Admin access is required');
    }

    return true;
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

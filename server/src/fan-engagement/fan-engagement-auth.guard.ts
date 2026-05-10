import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Injectable()
export class FanEngagementJwtAuthGuard implements CanActivate {
  constructor(private readonly jwtAuthGuard: JwtAuthGuard) {}

  async canActivate(context: ExecutionContext) {
    try {
      return await this.jwtAuthGuard.canActivate(context);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw new UnauthorizedException({
          code: 'AUTH_REQUIRED',
          message: 'Authentication is required for fan engagement submit',
          messageKey: 'fanEngagement.auth.required',
        });
      }

      throw error;
    }
  }
}

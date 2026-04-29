import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ADMIN_PERMISSIONS_KEY } from '../decorators/admin-permissions.decorator';
import { AuthUser } from '../auth.types';

type RequestWithAuth = {
  user?: AuthUser;
};

@Injectable()
export class AdminPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const requiredPermissions =
      this.reflector.getAllAndOverride<string[]>(ADMIN_PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const grantedPermissions = request.user?.adminPermissions ?? [];

    if (
      requiredPermissions.every((permission) =>
        this.hasPermission(grantedPermissions, permission),
      )
    ) {
      return true;
    }

    throw new ForbiddenException('Admin permission is required');
  }

  private hasPermission(grantedPermissions: string[], requiredPermission: string) {
    if (grantedPermissions.includes('*')) {
      return true;
    }

    if (grantedPermissions.includes(requiredPermission)) {
      return true;
    }

    const [resource, action] = requiredPermission.split(':');

    if (resource && grantedPermissions.includes(`${resource}:*`)) {
      return true;
    }

    return action === 'read' && grantedPermissions.includes(`${resource}:write`);
  }
}

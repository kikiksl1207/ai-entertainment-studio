import { Body, Controller, Get, Header, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireAdminPermissions } from '../auth/decorators/admin-permissions.decorator';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { AdminTestAccountService } from './admin-test-account.service';

@Controller('/admin/api/v1/users/:userId/test-account-classification')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@RequireAdminPermissions('*')
export class AdminTestAccountController {
  constructor(private readonly service: AdminTestAccountService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  get(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.service.get(user, userId);
  }

  @Post()
  @Header('Cache-Control', 'private, no-store')
  set(@CurrentUser() user: AuthUser, @Param('userId') userId: string,
      @Headers('idempotency-key') key: string | undefined, @Body() body: unknown) {
    return this.service.set(user, userId, key, body);
  }
}

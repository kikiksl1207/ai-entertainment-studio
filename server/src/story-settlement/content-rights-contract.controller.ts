import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { RequireAdminPermissions } from '../auth/decorators/admin-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ContentRightsContractService } from './content-rights-contract.service';

@Controller('admin/api/v1/content-rights-contracts')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
export class AdminContentRightsContractController {
  constructor(private readonly service: ContentRightsContractService) {}

  @Post()
  @RequireAdminPermissions('settlements:write')
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.service.create(user.id, body);
  }

  @Post(':contractId/revisions')
  @RequireAdminPermissions('settlements:write')
  revise(
    @CurrentUser() user: AuthUser,
    @Param('contractId') contractId: string,
    @Body() body: unknown,
  ) {
    return this.service.revise(user.id, contractId, body);
  }

  @Post(':contractId/approve')
  @RequireAdminPermissions('settlements:write')
  approve(
    @CurrentUser() user: AuthUser,
    @Param('contractId') contractId: string,
    @Body() body: unknown,
  ) {
    return this.service.approve(user.id, contractId, body);
  }

  @Get()
  @RequireAdminPermissions('payments:read')
  list() {
    return this.service.listAdmin();
  }

  @Get(':contractId')
  @RequireAdminPermissions('payments:read')
  get(@Param('contractId') contractId: string) {
    return this.service.getAdmin(contractId);
  }
}

@Controller('me/creator-studio/content-rights-contracts')
@UseGuards(JwtAuthGuard)
export class PartyContentRightsContractController {
  constructor(private readonly service: ContentRightsContractService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.listForParty(user.id);
  }

  @Get(':contractId')
  get(@CurrentUser() user: AuthUser, @Param('contractId') contractId: string) {
    return this.service.getForParty(user.id, contractId);
  }
}

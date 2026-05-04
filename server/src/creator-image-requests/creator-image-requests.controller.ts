import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireAdminPermissions } from '../auth/decorators/admin-permissions.decorator';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreatorImageRequestsService } from './creator-image-requests.service';
import {
  AdminUpdateCreatorImageRequestDto,
  CreateCreatorImageRequestDto,
  CreatorImageRequestListQueryDto,
} from './dto/creator-image-requests.dto';

@Controller()
export class CreatorImageRequestsController {
  constructor(private readonly creatorImageRequestsService: CreatorImageRequestsService) {}

  @Post('creator-image-requests')
  @UseGuards(JwtAuthGuard)
  createRequest(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateCreatorImageRequestDto,
  ) {
    return this.creatorImageRequestsService.createRequest(user, body);
  }

  @Get('me/creator-image-requests')
  @UseGuards(JwtAuthGuard)
  listMyRequests(
    @CurrentUser() user: AuthUser,
    @Query() query: CreatorImageRequestListQueryDto,
  ) {
    return this.creatorImageRequestsService.listMyRequests(user, query);
  }

  @Get('creator-image-requests/:requestId')
  @UseGuards(JwtAuthGuard)
  getMyRequest(@CurrentUser() user: AuthUser, @Param('requestId') requestId: string) {
    return this.creatorImageRequestsService.getMyRequest(user, requestId);
  }
}

@Controller('/admin/api/v1/creator-image-requests')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
export class CreatorImageRequestsAdminController {
  constructor(private readonly creatorImageRequestsService: CreatorImageRequestsService) {}

  @Get()
  @RequireAdminPermissions('assets:read')
  listRequests(@Query() query: CreatorImageRequestListQueryDto) {
    return this.creatorImageRequestsService.listAdminRequests(query);
  }

  @Get(':requestId')
  @RequireAdminPermissions('assets:read')
  getRequest(@Param('requestId') requestId: string) {
    return this.creatorImageRequestsService.getAdminRequest(requestId);
  }

  @Patch(':requestId')
  @RequireAdminPermissions('assets:write')
  updateRequest(
    @CurrentUser() user: AuthUser,
    @Param('requestId') requestId: string,
    @Body() body: AdminUpdateCreatorImageRequestDto,
  ) {
    return this.creatorImageRequestsService.updateAdminRequest(user, requestId, body);
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { RequireAdminPermissions } from '../auth/decorators/admin-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { SiteContentService } from './site-content.service';

type SiteContentQuery = Record<string, string | undefined>;
type SiteContentBody = Record<string, unknown>;

@Controller('site-content')
export class SiteContentController {
  constructor(private readonly siteContentService: SiteContentService) {}

  @Get('bootstrap')
  getBootstrap(@Query() query: SiteContentQuery) {
    return this.siteContentService.getBootstrap(query);
  }
}

@Controller('/admin/api/v1/backstage/site-content')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@RequireAdminPermissions('*')
export class SiteContentAdminController {
  constructor(private readonly siteContentService: SiteContentService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: SiteContentQuery) {
    return this.siteContentService.listAdmin(user, query);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.siteContentService.getAdmin(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: SiteContentBody) {
    return this.siteContentService.createAdmin(user, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: SiteContentBody,
  ) {
    return this.siteContentService.updateAdmin(user, id, body);
  }

  @Post(':id/publish')
  publish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.siteContentService.publishAdmin(user, id);
  }

  @Post(':id/archive')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.siteContentService.archiveAdmin(user, id);
  }

  @Post(':id/restore')
  restore(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: SiteContentBody,
  ) {
    return this.siteContentService.restoreAdmin(user, id, body);
  }
}

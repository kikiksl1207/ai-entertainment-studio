import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireAdminPermissions } from '../auth/decorators/admin-permissions.decorator';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { PopularVoteService } from './popular-vote.service';

type PopularVoteQuery = Record<string, string | undefined>;
type FinalizeMonthlyPickBody = {
  campaignId?: string;
  year?: number;
  month?: number;
};

@Controller('popular-vote')
export class PopularVoteController {
  constructor(private readonly popularVoteService: PopularVoteService) {}

  @Get('main-pick')
  getMainPick() {
    return this.popularVoteService.getMainPick();
  }

  @Get('hall-of-fame/monthly-picks')
  getMonthlyPicks(@Query() query: PopularVoteQuery) {
    return this.popularVoteService.getMonthlyPicks(query);
  }

  @Get('hall-of-fame/year-champion')
  getYearChampion(@Query() query: PopularVoteQuery) {
    return this.popularVoteService.getYearChampion(query);
  }
}

@Controller('/admin/api/v1/popular-vote')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
export class PopularVoteAdminController {
  constructor(private readonly popularVoteService: PopularVoteService) {}

  @Post('monthly-picks/finalize')
  @RequireAdminPermissions('boosts:write')
  finalizeMonthlyPick(
    @CurrentUser() user: AuthUser,
    @Body() body: FinalizeMonthlyPickBody,
  ) {
    return this.popularVoteService.finalizeMonthlyPick(user, body);
  }
}

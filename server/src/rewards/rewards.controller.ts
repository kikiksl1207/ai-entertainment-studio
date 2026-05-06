import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RewardsService } from './rewards.service';

@Controller('rewards')
@UseGuards(JwtAuthGuard)
export class RewardsController {
  constructor(private readonly rewardsService: RewardsService) {}

  @Get('referral-code')
  getReferralCode(@CurrentUser() user: AuthUser) {
    return this.rewardsService.getOrCreateReferralCode(user.id);
  }

  @Get('referrals')
  getReferralRewards(@CurrentUser() user: AuthUser) {
    return this.rewardsService.getReferralRewards(user.id);
  }

  @Post('daily-attendance')
  claimDailyAttendance(@CurrentUser() user: AuthUser) {
    return this.rewardsService.claimDailyAttendance(user.id);
  }

  @Get('daily-attendance/policy')
  getDailyAttendancePolicy() {
    return this.rewardsService.getDailyAttendancePolicy();
  }

  @Get('daily-attendance')
  getDailyAttendanceHistory(@CurrentUser() user: AuthUser) {
    return this.rewardsService.getDailyAttendanceHistory(user.id);
  }

  @Get('activation-policy')
  getActivationPolicy() {
    return this.rewardsService.getActivationPolicy();
  }

  @Get('activation-progress')
  getActivationProgress(@CurrentUser() user: AuthUser) {
    return this.rewardsService.getActivationProgress(user.id);
  }

  @Get('birthday')
  getBirthdayRewardStatus(@CurrentUser() user: AuthUser) {
    return this.rewardsService.getBirthdayRewardStatus(user.id);
  }

  @Post('birthday/claim')
  claimBirthdayReward(@CurrentUser() user: AuthUser) {
    return this.rewardsService.claimBirthdayReward(user.id);
  }

  @Post('activation-quests/:code/claim')
  claimActivationQuest(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.rewardsService.claimActivationQuest(user.id, code);
  }
}

import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserAssetsService } from './user-assets.service';

type UserAssetBody = Record<string, unknown>;

@Controller('me/assets')
@UseGuards(JwtAuthGuard)
export class UserAssetsController {
  constructor(private readonly userAssetsService: UserAssetsService) {}

  @Post('upload-intents')
  createUploadIntent(@CurrentUser() user: AuthUser, @Body() body: UserAssetBody) {
    return this.userAssetsService.createUploadIntent(user.id, body);
  }

  @Post(':assetId/confirm-upload')
  confirmUpload(
    @CurrentUser() user: AuthUser,
    @Param('assetId') assetId: string,
    @Body() body: UserAssetBody,
  ) {
    return this.userAssetsService.confirmUpload(user.id, assetId, body);
  }
}

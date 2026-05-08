import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Redirect,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserAssetsService } from './user-assets.service';

type UserAssetBody = Record<string, unknown>;
type UserAssetQuery = Record<string, string | undefined>;

@Controller('me/assets')
@UseGuards(JwtAuthGuard)
export class UserAssetsController {
  constructor(private readonly userAssetsService: UserAssetsService) {}

  @Get()
  listAssets(@CurrentUser() user: AuthUser, @Query() query: UserAssetQuery) {
    return this.userAssetsService.listAssets(user.id, query);
  }

  @Get(':assetId')
  getAsset(@CurrentUser() user: AuthUser, @Param('assetId') assetId: string) {
    return this.userAssetsService.getAsset(user.id, assetId);
  }

  @Post('upload-intents')
  createUploadIntent(@CurrentUser() user: AuthUser, @Body() body: UserAssetBody) {
    return this.userAssetsService.createUploadIntent(user.id, body);
  }

  @Post(':assetId/confirm-upload')
  confirmUpload(
    @CurrentUser() user: AuthUser,
    @Param('assetId') assetId: string,
    @Body() body: UserAssetBody,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.userAssetsService.confirmUpload(user.id, assetId, body, requestId);
  }

  @Post(':assetId/archive')
  archiveAsset(
    @CurrentUser() user: AuthUser,
    @Param('assetId') assetId: string,
    @Body() body: UserAssetBody,
  ) {
    return this.userAssetsService.archiveAsset(user.id, assetId, body);
  }

  @Post(':assetId/restore')
  restoreAsset(@CurrentUser() user: AuthUser, @Param('assetId') assetId: string) {
    return this.userAssetsService.restoreAsset(user.id, assetId);
  }
}

@Controller('assets')
export class PublicAssetsController {
  constructor(private readonly userAssetsService: UserAssetsService) {}

  @Get('public/:assetId')
  @Redirect(undefined, 302)
  async redirectPublicAsset(@Param('assetId') assetId: string) {
    return {
      url: await this.userAssetsService.getPublicAssetDeliveryUrl(assetId),
    };
  }

  @Get('public/:assetId/:variant')
  @Redirect(undefined, 302)
  async redirectPublicAssetVariant(
    @Param('assetId') assetId: string,
    @Param('variant') variant: string,
  ) {
    return {
      url: await this.userAssetsService.getPublicAssetDeliveryUrl(assetId, variant),
    };
  }
}

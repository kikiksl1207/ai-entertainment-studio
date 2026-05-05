import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreatorStudioService } from './creator-studio.service';
import {
  CreatorStudioSettlementPreviewQueryDto,
  CreatorStudioSettlementConversionQueryDto,
  CreateCreatorStudioSettlementConversionDto,
  UpdateCreatorStudioArtistProfileDto,
} from './dto/creator-studio.dto';

@Controller('me/creator-studio')
@UseGuards(JwtAuthGuard)
export class CreatorStudioController {
  constructor(private readonly creatorStudioService: CreatorStudioService) {}

  @Get()
  getStudio(@CurrentUser() user: AuthUser) {
    return this.creatorStudioService.getStudio(user.id);
  }

  @Get('settlement-preview')
  getSettlementPreview(
    @CurrentUser() user: AuthUser,
    @Query() query: CreatorStudioSettlementPreviewQueryDto,
  ) {
    return this.creatorStudioService.getSettlementPreview(user.id, query);
  }

  @Get('settlement-conversions')
  getSettlementConversions(
    @CurrentUser() user: AuthUser,
    @Query() query: CreatorStudioSettlementConversionQueryDto,
  ) {
    return this.creatorStudioService.getSettlementConversions(user.id, query);
  }

  @Post('settlement-conversions')
  createSettlementConversion(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateCreatorStudioSettlementConversionDto,
  ) {
    return this.creatorStudioService.createSettlementConversion(user.id, body);
  }

  @Patch('artists/:artistId/profile')
  updateArtistProfile(
    @CurrentUser() user: AuthUser,
    @Param('artistId') artistId: string,
    @Body() body: UpdateCreatorStudioArtistProfileDto,
  ) {
    return this.creatorStudioService.updateArtistProfile(user, artistId, body);
  }
}

import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreatorStudioService } from './creator-studio.service';
import {
  CreatorStudioSettlementPreviewQueryDto,
  CreatorStudioSettlementConversionQueryDto,
  CreateCreatorStudioSettlementConversionDto,
  CreateCreatorStudioKnowledgeUrlDto,
  CreatorStudioKnowledgeUrlQueryDto,
  ReviewCreatorStudioKnowledgeUrlDto,
  UpdateCreatorStudioKnowledgeUrlDto,
  UpdateCreatorStudioArtistProfileDto,
} from './dto/creator-studio.dto';

@Controller('me/creator-studio')
@UseGuards(JwtAuthGuard)
export class CreatorStudioController {
  constructor(private readonly creatorStudioService: CreatorStudioService) {}

  @Get()
  getStudio(@CurrentUser() user: AuthUser) {
    return this.creatorStudioService.getStudio(user);
  }

  @Get('settlement-preview')
  getSettlementPreview(
    @CurrentUser() user: AuthUser,
    @Query() query: CreatorStudioSettlementPreviewQueryDto,
  ) {
    return this.creatorStudioService.getSettlementPreview(user.id, query);
  }

  @Get('payout-summary')
  getPayoutSummary(
    @CurrentUser() user: AuthUser,
    @Query() query: CreatorStudioSettlementPreviewQueryDto,
  ) {
    return this.creatorStudioService.getPayoutSummary(user.id, query);
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

  @Get('knowledge-urls')
  getKnowledgeUrls(
    @CurrentUser() user: AuthUser,
    @Query() query: CreatorStudioKnowledgeUrlQueryDto,
  ) {
    return this.creatorStudioService.getKnowledgeUrls(user.id, query);
  }

  @Post('knowledge-urls')
  createKnowledgeUrl(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateCreatorStudioKnowledgeUrlDto,
  ) {
    return this.creatorStudioService.createKnowledgeUrl(user.id, body);
  }

  @Patch('knowledge-urls/:sourceId')
  updateKnowledgeUrl(
    @CurrentUser() user: AuthUser,
    @Param('sourceId') sourceId: string,
    @Body() body: UpdateCreatorStudioKnowledgeUrlDto,
  ) {
    return this.creatorStudioService.updateKnowledgeUrl(user.id, sourceId, body);
  }

  @Post('knowledge-urls/:sourceId/approve')
  approveKnowledgeUrl(
    @CurrentUser() user: AuthUser,
    @Param('sourceId') sourceId: string,
  ) {
    return this.creatorStudioService.approveKnowledgeUrl(user.id, sourceId);
  }

  @Post('knowledge-urls/:sourceId/reject')
  rejectKnowledgeUrl(
    @CurrentUser() user: AuthUser,
    @Param('sourceId') sourceId: string,
    @Body() body: ReviewCreatorStudioKnowledgeUrlDto,
  ) {
    return this.creatorStudioService.rejectKnowledgeUrl(user.id, sourceId, body);
  }

  @Post('knowledge-urls/:sourceId/archive')
  archiveKnowledgeUrl(
    @CurrentUser() user: AuthUser,
    @Param('sourceId') sourceId: string,
  ) {
    return this.creatorStudioService.archiveKnowledgeUrl(user.id, sourceId);
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

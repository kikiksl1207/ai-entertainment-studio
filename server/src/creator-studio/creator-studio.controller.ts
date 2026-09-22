import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  ApproveCreatorGenerationProfileDto,
  CreateArtistStoryIdentityDraftDto,
  UpdateArtistStoryIdentityProfileDto,
} from '../generation-profile/dto/creator-generation-profile.dto';
import { CreatorStudioService } from './creator-studio.service';
import {
  CreateCreatorStudioKnowledgeUrlDto,
  CreatorStudioSettlementPreviewQueryDto,
  CreatorStudioSettlementConversionQueryDto,
  CreateCreatorStudioSettlementConversionDto,
  CreatorStudioKnowledgeUrlQueryDto,
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
    return this.creatorStudioService.createKnowledgeUrl(user, body);
  }

  @Patch('knowledge-urls/:knowledgeUrlId')
  updateKnowledgeUrl(
    @CurrentUser() user: AuthUser,
    @Param('knowledgeUrlId') knowledgeUrlId: string,
    @Body() body: UpdateCreatorStudioKnowledgeUrlDto,
  ) {
    return this.creatorStudioService.updateKnowledgeUrl(user, knowledgeUrlId, body);
  }

  @Post('knowledge-urls/:knowledgeUrlId/archive')
  archiveKnowledgeUrl(
    @CurrentUser() user: AuthUser,
    @Param('knowledgeUrlId') knowledgeUrlId: string,
  ) {
    return this.creatorStudioService.archiveKnowledgeUrl(user, knowledgeUrlId);
  }

  @Patch('artists/:artistId/profile')
  updateArtistProfile(
    @CurrentUser() user: AuthUser,
    @Param('artistId') artistId: string,
    @Body() body: UpdateCreatorStudioArtistProfileDto,
  ) {
    return this.creatorStudioService.updateArtistProfile(user, artistId, body);
  }

  @Get('artists/:artistId/story-identity-profile')
  getArtistStoryIdentityProfile(
    @CurrentUser() user: AuthUser,
    @Param('artistId') artistId: string,
  ) {
    return this.creatorStudioService.getArtistStoryIdentityProfile(user.id, artistId);
  }

  @Patch('artists/:artistId/story-identity-profile')
  updateArtistStoryIdentityProfile(
    @CurrentUser() user: AuthUser,
    @Param('artistId') artistId: string,
    @Body() body: UpdateArtistStoryIdentityProfileDto,
  ) {
    return this.creatorStudioService.updateArtistStoryIdentityProfile(user.id, artistId, body);
  }

  @Post('artists/:artistId/story-identity-profile/draft')
  @UseGuards(JwtAuthGuard)
  createArtistStoryIdentityDraft(
    @CurrentUser() user: AuthUser,
    @Param('artistId') artistId: string,
    @Body() body: CreateArtistStoryIdentityDraftDto,
  ) {
    return this.creatorStudioService.createArtistStoryIdentityDraft(user.id, artistId, body);
  }

  @Post('artists/:artistId/story-identity-profile/approve')
  approveArtistStoryIdentityProfile(
    @CurrentUser() user: AuthUser,
    @Param('artistId') artistId: string,
    @Body() body: ApproveCreatorGenerationProfileDto,
  ) {
    return this.creatorStudioService.approveArtistStoryIdentityProfile(user.id, artistId, body);
  }
}

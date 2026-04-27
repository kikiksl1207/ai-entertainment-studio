import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminService } from './admin.service';

type AdminPayload = Record<string, unknown>;

@Controller('/admin/api/v1')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('assets')
  createAsset(@Body() body: AdminPayload) {
    return this.adminService.createAsset(body);
  }

  @Post('artists')
  createArtist(@Body() body: AdminPayload) {
    return this.adminService.createArtist(body);
  }

  @Patch('artists/:artistId')
  updateArtist(@Param('artistId') artistId: string, @Body() body: AdminPayload) {
    return this.adminService.updateArtist(artistId, body);
  }

  @Post('shortforms')
  createShortform(@Body() body: AdminPayload) {
    return this.adminService.createShortform(body);
  }

  @Patch('shortforms/:shortformId')
  updateShortform(
    @Param('shortformId') shortformId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateShortform(shortformId, body);
  }

  @Post('lumina-products')
  createLuminaProduct(@Body() body: AdminPayload) {
    return this.adminService.createLuminaProduct(body);
  }

  @Patch('lumina-products/:productId')
  updateLuminaProduct(
    @Param('productId') productId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateLuminaProduct(productId, body);
  }

  @Post('gift-products')
  createGiftProduct(@Body() body: AdminPayload) {
    return this.adminService.createGiftProduct(body);
  }

  @Patch('gift-products/:productId')
  updateGiftProduct(@Param('productId') productId: string, @Body() body: AdminPayload) {
    return this.adminService.updateGiftProduct(productId, body);
  }

  @Post('boost-products')
  createBoostProduct(@Body() body: AdminPayload) {
    return this.adminService.createBoostProduct(body);
  }

  @Patch('boost-products/:productId')
  updateBoostProduct(@Param('productId') productId: string, @Body() body: AdminPayload) {
    return this.adminService.updateBoostProduct(productId, body);
  }

  @Post('boost-campaigns')
  createBoostCampaign(@Body() body: AdminPayload) {
    return this.adminService.createBoostCampaign(body);
  }

  @Patch('boost-campaigns/:campaignId')
  updateBoostCampaign(
    @Param('campaignId') campaignId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateBoostCampaign(campaignId, body);
  }

  @Post('boost-campaigns/:campaignId/snapshot')
  snapshotBoostCampaign(@Param('campaignId') campaignId: string) {
    return this.adminService.snapshotBoostCampaign(campaignId);
  }

  @Post('premium-video-products')
  createPremiumVideoProduct(@Body() body: AdminPayload) {
    return this.adminService.createPremiumVideoProduct(body);
  }

  @Patch('premium-video-products/:productId')
  updatePremiumVideoProduct(
    @Param('productId') productId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updatePremiumVideoProduct(productId, body);
  }

  @Post('chat-feature-products')
  createChatFeatureProduct(@Body() body: AdminPayload) {
    return this.adminService.createChatFeatureProduct(body);
  }

  @Patch('chat-feature-products/:productId')
  updateChatFeatureProduct(
    @Param('productId') productId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateChatFeatureProduct(productId, body);
  }
}

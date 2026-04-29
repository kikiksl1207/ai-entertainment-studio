import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminService } from './admin.service';

type AdminPayload = Record<string, unknown>;
type AuditQuery = Record<string, string | undefined>;

@Controller('/admin/api/v1')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('admin-roles')
  getAdminRoles() {
    return this.adminService.getAdminRoles();
  }

  @Get('admin-users')
  getAdminUsers() {
    return this.adminService.getAdminUsers();
  }

  @Post('admin-users')
  createAdminUser(@CurrentUser() user: AuthUser, @Body() body: AdminPayload) {
    return this.adminService.createAdminUser(user, body);
  }

  @Patch('admin-users/:adminUserId')
  updateAdminUser(
    @CurrentUser() user: AuthUser,
    @Param('adminUserId') adminUserId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateAdminUser(user, adminUserId, body);
  }

  @Get('audit-events')
  getAuditEvents(@Query() query: AuditQuery) {
    return this.adminService.getAuditEvents(query);
  }

  @Get('payment-orders')
  getPaymentOrders(@Query() query: AuditQuery) {
    return this.adminService.getPaymentOrders(query);
  }

  @Get('payment-orders/:orderId')
  getPaymentOrder(@Param('orderId') orderId: string) {
    return this.adminService.getPaymentOrder(orderId);
  }

  @Post('payment-orders/:orderId/refunds')
  createPaymentRefund(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.createPaymentRefund(user, orderId, body);
  }

  @Get('refund-transactions')
  getRefundTransactions(@Query() query: AuditQuery) {
    return this.adminService.getRefundTransactions(query);
  }

  @Patch('refund-transactions/:refundId')
  updateRefundTransaction(
    @CurrentUser() user: AuthUser,
    @Param('refundId') refundId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateRefundTransaction(user, refundId, body);
  }

  @Get('assets')
  getAssets(@Query() query: AuditQuery) {
    return this.adminService.getAssets(query);
  }

  @Get('assets/:assetId')
  getAsset(@Param('assetId') assetId: string) {
    return this.adminService.getAsset(assetId);
  }

  @Post('assets')
  createAsset(@CurrentUser() user: AuthUser, @Body() body: AdminPayload) {
    return this.adminService.createAsset(user, body);
  }

  @Post('assets/upload-intents')
  createAssetUploadIntent(@CurrentUser() user: AuthUser, @Body() body: AdminPayload) {
    return this.adminService.createAssetUploadIntent(user, body);
  }

  @Post('assets/:assetId/confirm-upload')
  confirmAssetUpload(
    @CurrentUser() user: AuthUser,
    @Param('assetId') assetId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.confirmAssetUpload(user, assetId, body);
  }

  @Post('assets/:assetId/archive')
  archiveAsset(
    @CurrentUser() user: AuthUser,
    @Param('assetId') assetId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.archiveAsset(user, assetId, body);
  }

  @Post('assets/:assetId/restore')
  restoreAsset(@CurrentUser() user: AuthUser, @Param('assetId') assetId: string) {
    return this.adminService.restoreAsset(user, assetId);
  }

  @Post('artists')
  createArtist(@CurrentUser() user: AuthUser, @Body() body: AdminPayload) {
    return this.adminService.createArtist(user, body);
  }

  @Patch('artists/:artistId')
  updateArtist(
    @CurrentUser() user: AuthUser,
    @Param('artistId') artistId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateArtist(user, artistId, body);
  }

  @Post('artists/:artistId/assets')
  linkArtistAsset(
    @CurrentUser() user: AuthUser,
    @Param('artistId') artistId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.linkArtistAsset(user, artistId, body);
  }

  @Delete('artists/:artistId/assets/:artistAssetId')
  unlinkArtistAsset(
    @CurrentUser() user: AuthUser,
    @Param('artistId') artistId: string,
    @Param('artistAssetId') artistAssetId: string,
  ) {
    return this.adminService.unlinkArtistAsset(user, artistId, artistAssetId);
  }

  @Post('shortforms')
  createShortform(@CurrentUser() user: AuthUser, @Body() body: AdminPayload) {
    return this.adminService.createShortform(user, body);
  }

  @Patch('shortforms/:shortformId')
  updateShortform(
    @CurrentUser() user: AuthUser,
    @Param('shortformId') shortformId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateShortform(user, shortformId, body);
  }

  @Post('shortforms/:shortformId/assets')
  linkShortformAsset(
    @CurrentUser() user: AuthUser,
    @Param('shortformId') shortformId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.linkShortformAsset(user, shortformId, body);
  }

  @Delete('shortforms/:shortformId/assets/:shortformAssetId')
  unlinkShortformAsset(
    @CurrentUser() user: AuthUser,
    @Param('shortformId') shortformId: string,
    @Param('shortformAssetId') shortformAssetId: string,
  ) {
    return this.adminService.unlinkShortformAsset(user, shortformId, shortformAssetId);
  }

  @Post('lumina-products')
  createLuminaProduct(@CurrentUser() user: AuthUser, @Body() body: AdminPayload) {
    return this.adminService.createLuminaProduct(user, body);
  }

  @Patch('lumina-products/:productId')
  updateLuminaProduct(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateLuminaProduct(user, productId, body);
  }

  @Post('gift-products')
  createGiftProduct(@CurrentUser() user: AuthUser, @Body() body: AdminPayload) {
    return this.adminService.createGiftProduct(user, body);
  }

  @Patch('gift-products/:productId')
  updateGiftProduct(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateGiftProduct(user, productId, body);
  }

  @Post('boost-products')
  createBoostProduct(@CurrentUser() user: AuthUser, @Body() body: AdminPayload) {
    return this.adminService.createBoostProduct(user, body);
  }

  @Patch('boost-products/:productId')
  updateBoostProduct(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateBoostProduct(user, productId, body);
  }

  @Post('boost-campaigns')
  createBoostCampaign(@CurrentUser() user: AuthUser, @Body() body: AdminPayload) {
    return this.adminService.createBoostCampaign(user, body);
  }

  @Patch('boost-campaigns/:campaignId')
  updateBoostCampaign(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateBoostCampaign(user, campaignId, body);
  }

  @Post('boost-campaigns/:campaignId/snapshot')
  snapshotBoostCampaign(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
  ) {
    return this.adminService.snapshotBoostCampaign(user, campaignId);
  }

  @Post('premium-video-products')
  createPremiumVideoProduct(@CurrentUser() user: AuthUser, @Body() body: AdminPayload) {
    return this.adminService.createPremiumVideoProduct(user, body);
  }

  @Patch('premium-video-products/:productId')
  updatePremiumVideoProduct(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updatePremiumVideoProduct(user, productId, body);
  }

  @Post('premium-video-products/:productId/assets')
  linkPremiumVideoAsset(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.linkPremiumVideoAsset(user, productId, body);
  }

  @Delete('premium-video-products/:productId/assets/:premiumVideoAssetId')
  unlinkPremiumVideoAsset(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Param('premiumVideoAssetId') premiumVideoAssetId: string,
  ) {
    return this.adminService.unlinkPremiumVideoAsset(
      user,
      productId,
      premiumVideoAssetId,
    );
  }

  @Post('chat-feature-products')
  createChatFeatureProduct(@CurrentUser() user: AuthUser, @Body() body: AdminPayload) {
    return this.adminService.createChatFeatureProduct(user, body);
  }

  @Patch('chat-feature-products/:productId')
  updateChatFeatureProduct(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateChatFeatureProduct(user, productId, body);
  }
}

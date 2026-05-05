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
import { RequireAdminPermissions } from '../auth/decorators/admin-permissions.decorator';
import { AuthUser } from '../auth/auth.types';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { AdminService } from './admin.service';

type AdminPayload = Record<string, unknown>;
type AuditQuery = Record<string, string | undefined>;

@Controller('/admin/api/v1')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('backstage/summary')
  @RequireAdminPermissions('*')
  getBackstageSummary() {
    return this.adminService.getBackstageSummary();
  }

  @Get('backstage/launch-readiness')
  @RequireAdminPermissions('*')
  getBackstageLaunchReadiness() {
    return this.adminService.getBackstageLaunchReadiness();
  }

  @Get('backstage/operations/creators')
  @RequireAdminPermissions('*')
  getBackstageCreatorOperations(@CurrentUser() user: AuthUser, @Query() query: AuditQuery) {
    return this.adminService.getBackstageCreatorOperations(user, query);
  }

  @Get('backstage/operations/ai-content-health')
  @RequireAdminPermissions('artists:read')
  getBackstageAiContentHealth(@Query() query: AuditQuery) {
    return this.adminService.getBackstageAiContentHealth(query);
  }

  @Get('backstage/operations/users-overview')
  @RequireAdminPermissions('*')
  getBackstageUsersOverview(@Query() query: AuditQuery) {
    return this.adminService.getBackstageUsersOverview(query);
  }

  @Get('backstage/operations/feed-search-analytics')
  @RequireAdminPermissions('*')
  getBackstageFeedSearchAnalytics(@Query() query: AuditQuery) {
    return this.adminService.getBackstageFeedSearchAnalytics(query);
  }

  @Get('backstage/operations/feed-search-blocked-terms')
  @RequireAdminPermissions('*')
  getBackstageFeedSearchBlockedTerms(@Query() query: AuditQuery) {
    return this.adminService.getBackstageFeedSearchBlockedTerms(query);
  }

  @Post('backstage/operations/feed-search-blocked-terms')
  @RequireAdminPermissions('*')
  createBackstageFeedSearchBlockedTerm(
    @CurrentUser() user: AuthUser,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.createBackstageFeedSearchBlockedTerm(user, body);
  }

  @Patch('backstage/operations/feed-search-blocked-terms/:termId')
  @RequireAdminPermissions('*')
  updateBackstageFeedSearchBlockedTerm(
    @CurrentUser() user: AuthUser,
    @Param('termId') termId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateBackstageFeedSearchBlockedTerm(user, termId, body);
  }

  @Get('backstage/operations/settlement-preview')
  @RequireAdminPermissions('payments:read')
  getBackstageSettlementPreview(@Query() query: AuditQuery) {
    return this.adminService.getBackstageSettlementPreview(query);
  }

  @Get('backstage/operations/partner-settlement-preview')
  @RequireAdminPermissions('payments:read')
  getBackstagePartnerSettlementPreview(@Query() query: AuditQuery) {
    return this.adminService.getBackstagePartnerSettlementPreview(query);
  }

  @Get('backstage/settlement-conversions')
  @RequireAdminPermissions('payments:read')
  getBackstageSettlementConversions(@Query() query: AuditQuery) {
    return this.adminService.getBackstageSettlementConversions(query);
  }

  @Post('backstage/settlement-conversions/:conversionId/status')
  @RequireAdminPermissions('*')
  updateBackstageSettlementConversionStatus(
    @CurrentUser() user: AuthUser,
    @Param('conversionId') conversionId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateBackstageSettlementConversionStatus(
      user,
      conversionId,
      body,
    );
  }

  @Post('backstage/settlements/:settlementKey/status')
  @RequireAdminPermissions('*')
  updateBackstageSettlementStatus(
    @CurrentUser() user: AuthUser,
    @Param('settlementKey') settlementKey: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateBackstageSettlementStatus(user, settlementKey, body);
  }

  @Get('backstage/settlements')
  @RequireAdminPermissions('payments:read')
  getBackstageSettlements(@Query() query: AuditQuery) {
    return this.adminService.getBackstageSettlements(query);
  }

  @Get('backstage/settlements/:settlementKey')
  @RequireAdminPermissions('payments:read')
  getBackstageSettlement(@Param('settlementKey') settlementKey: string) {
    return this.adminService.getBackstageSettlement(settlementKey);
  }

  @Get('admin-roles')
  @RequireAdminPermissions('*')
  getAdminRoles() {
    return this.adminService.getAdminRoles();
  }

  @Get('admin-users')
  @RequireAdminPermissions('*')
  getAdminUsers() {
    return this.adminService.getAdminUsers();
  }

  @Post('admin-users')
  @RequireAdminPermissions('*')
  createAdminUser(@CurrentUser() user: AuthUser, @Body() body: AdminPayload) {
    return this.adminService.createAdminUser(user, body);
  }

  @Patch('admin-users/:adminUserId')
  @RequireAdminPermissions('*')
  updateAdminUser(
    @CurrentUser() user: AuthUser,
    @Param('adminUserId') adminUserId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateAdminUser(user, adminUserId, body);
  }

  @Get('audit-events')
  @RequireAdminPermissions('audit:read')
  getAuditEvents(@Query() query: AuditQuery) {
    return this.adminService.getAuditEvents(query);
  }

  @Get('users')
  @RequireAdminPermissions('*')
  getUsers(@Query() query: AuditQuery) {
    return this.adminService.getUsers(query);
  }

  @Get('users/:userId')
  @RequireAdminPermissions('*')
  getUser(@Param('userId') userId: string) {
    return this.adminService.getUser(userId);
  }

  @Post('users/:userId/suspend')
  @RequireAdminPermissions('*')
  suspendUser(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.suspendUser(user, userId, body);
  }

  @Post('users/:userId/restore')
  @RequireAdminPermissions('*')
  restoreUser(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.restoreUser(user, userId, body);
  }

  @Post('users/:userId/delete')
  @RequireAdminPermissions('*')
  deleteUser(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.deleteUser(user, userId, body);
  }

  @Post('users/:userId/revoke-sessions')
  @RequireAdminPermissions('*')
  revokeUserSessions(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.revokeUserSessions(user, userId, body);
  }

  @Get('payment-orders')
  @RequireAdminPermissions('payments:read')
  getPaymentOrders(@Query() query: AuditQuery) {
    return this.adminService.getPaymentOrders(query);
  }

  @Get('payment-orders/:orderId')
  @RequireAdminPermissions('payments:read')
  getPaymentOrder(@Param('orderId') orderId: string) {
    return this.adminService.getPaymentOrder(orderId);
  }

  @Post('payment-orders/:orderId/refunds')
  @RequireAdminPermissions('refunds:write')
  createPaymentRefund(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.createPaymentRefund(user, orderId, body);
  }

  @Get('refund-transactions')
  @RequireAdminPermissions('payments:read')
  getRefundTransactions(@Query() query: AuditQuery) {
    return this.adminService.getRefundTransactions(query);
  }

  @Patch('refund-transactions/:refundId')
  @RequireAdminPermissions('refunds:write')
  updateRefundTransaction(
    @CurrentUser() user: AuthUser,
    @Param('refundId') refundId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateRefundTransaction(user, refundId, body);
  }

  @Get('assets')
  @RequireAdminPermissions('assets:read')
  getAssets(@Query() query: AuditQuery) {
    return this.adminService.getAssets(query);
  }

  @Get('assets/:assetId')
  @RequireAdminPermissions('assets:read')
  getAsset(@Param('assetId') assetId: string) {
    return this.adminService.getAsset(assetId);
  }

  @Post('assets')
  @RequireAdminPermissions('assets:write')
  createAsset(@CurrentUser() user: AuthUser, @Body() body: AdminPayload) {
    return this.adminService.createAsset(user, body);
  }

  @Post('assets/upload-intents')
  @RequireAdminPermissions('assets:write')
  createAssetUploadIntent(@CurrentUser() user: AuthUser, @Body() body: AdminPayload) {
    return this.adminService.createAssetUploadIntent(user, body);
  }

  @Post('assets/:assetId/confirm-upload')
  @RequireAdminPermissions('assets:write')
  confirmAssetUpload(
    @CurrentUser() user: AuthUser,
    @Param('assetId') assetId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.confirmAssetUpload(user, assetId, body);
  }

  @Post('assets/:assetId/archive')
  @RequireAdminPermissions('assets:write')
  archiveAsset(
    @CurrentUser() user: AuthUser,
    @Param('assetId') assetId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.archiveAsset(user, assetId, body);
  }

  @Post('assets/:assetId/restore')
  @RequireAdminPermissions('assets:write')
  restoreAsset(@CurrentUser() user: AuthUser, @Param('assetId') assetId: string) {
    return this.adminService.restoreAsset(user, assetId);
  }

  @Post('artists')
  @RequireAdminPermissions('artists:write')
  createArtist(@CurrentUser() user: AuthUser, @Body() body: AdminPayload) {
    return this.adminService.createArtist(user, body);
  }

  @Patch('artists/:artistId')
  @RequireAdminPermissions('artists:write')
  updateArtist(
    @CurrentUser() user: AuthUser,
    @Param('artistId') artistId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateArtist(user, artistId, body);
  }

  @Get('artists/:artistId/operators')
  @RequireAdminPermissions('artists:write')
  getArtistOperators(@Param('artistId') artistId: string) {
    return this.adminService.getArtistOperators(artistId);
  }

  @Post('artists/:artistId/operators')
  @RequireAdminPermissions('artists:write')
  createArtistOperator(
    @CurrentUser() user: AuthUser,
    @Param('artistId') artistId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.createArtistOperator(user, artistId, body);
  }

  @Patch('artist-operators/:operatorId')
  @RequireAdminPermissions('artists:write')
  updateArtistOperator(
    @CurrentUser() user: AuthUser,
    @Param('operatorId') operatorId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateArtistOperator(user, operatorId, body);
  }

  @Post('artists/:artistId/assets')
  @RequireAdminPermissions('artists:write', 'assets:write')
  linkArtistAsset(
    @CurrentUser() user: AuthUser,
    @Param('artistId') artistId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.linkArtistAsset(user, artistId, body);
  }

  @Delete('artists/:artistId/assets/:artistAssetId')
  @RequireAdminPermissions('artists:write', 'assets:write')
  unlinkArtistAsset(
    @CurrentUser() user: AuthUser,
    @Param('artistId') artistId: string,
    @Param('artistAssetId') artistAssetId: string,
  ) {
    return this.adminService.unlinkArtistAsset(user, artistId, artistAssetId);
  }

  @Post('shortforms')
  @RequireAdminPermissions('shortforms:write')
  createShortform(@CurrentUser() user: AuthUser, @Body() body: AdminPayload) {
    return this.adminService.createShortform(user, body);
  }

  @Patch('shortforms/:shortformId')
  @RequireAdminPermissions('shortforms:write')
  updateShortform(
    @CurrentUser() user: AuthUser,
    @Param('shortformId') shortformId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateShortform(user, shortformId, body);
  }

  @Post('shortforms/:shortformId/assets')
  @RequireAdminPermissions('shortforms:write', 'assets:write')
  linkShortformAsset(
    @CurrentUser() user: AuthUser,
    @Param('shortformId') shortformId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.linkShortformAsset(user, shortformId, body);
  }

  @Delete('shortforms/:shortformId/assets/:shortformAssetId')
  @RequireAdminPermissions('shortforms:write', 'assets:write')
  unlinkShortformAsset(
    @CurrentUser() user: AuthUser,
    @Param('shortformId') shortformId: string,
    @Param('shortformAssetId') shortformAssetId: string,
  ) {
    return this.adminService.unlinkShortformAsset(user, shortformId, shortformAssetId);
  }

  @Post('lumina-products')
  @RequireAdminPermissions('products:write')
  createLuminaProduct(@CurrentUser() user: AuthUser, @Body() body: AdminPayload) {
    return this.adminService.createLuminaProduct(user, body);
  }

  @Patch('lumina-products/:productId')
  @RequireAdminPermissions('products:write')
  updateLuminaProduct(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateLuminaProduct(user, productId, body);
  }

  @Post('gift-products')
  @RequireAdminPermissions('products:write')
  createGiftProduct(@CurrentUser() user: AuthUser, @Body() body: AdminPayload) {
    return this.adminService.createGiftProduct(user, body);
  }

  @Patch('gift-products/:productId')
  @RequireAdminPermissions('products:write')
  updateGiftProduct(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateGiftProduct(user, productId, body);
  }

  @Post('boost-products')
  @RequireAdminPermissions('boosts:write')
  createBoostProduct(@CurrentUser() user: AuthUser, @Body() body: AdminPayload) {
    return this.adminService.createBoostProduct(user, body);
  }

  @Patch('boost-products/:productId')
  @RequireAdminPermissions('boosts:write')
  updateBoostProduct(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateBoostProduct(user, productId, body);
  }

  @Post('boost-campaigns')
  @RequireAdminPermissions('boosts:write')
  createBoostCampaign(@CurrentUser() user: AuthUser, @Body() body: AdminPayload) {
    return this.adminService.createBoostCampaign(user, body);
  }

  @Patch('boost-campaigns/:campaignId')
  @RequireAdminPermissions('boosts:write')
  updateBoostCampaign(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateBoostCampaign(user, campaignId, body);
  }

  @Post('boost-campaigns/:campaignId/snapshot')
  @RequireAdminPermissions('boosts:write')
  snapshotBoostCampaign(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
  ) {
    return this.adminService.snapshotBoostCampaign(user, campaignId);
  }

  @Get('community/reports')
  @RequireAdminPermissions('community:read')
  getCommunityReports(@Query() query: AuditQuery) {
    return this.adminService.getCommunityReports(query);
  }

  @Get('community/posts')
  @RequireAdminPermissions('community:read')
  getCommunityPosts(@Query() query: AuditQuery) {
    return this.adminService.getCommunityPosts(query);
  }

  @Get('community/summary')
  @RequireAdminPermissions('community:read')
  getCommunityModerationSummary(@Query() query: AuditQuery) {
    return this.adminService.getCommunityModerationSummary(query);
  }

  @Patch('community/reports/:reportId')
  @RequireAdminPermissions('community:write')
  updateCommunityReport(
    @CurrentUser() user: AuthUser,
    @Param('reportId') reportId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateCommunityReport(user, reportId, body);
  }

  @Post('community/posts/:postId/hide')
  @RequireAdminPermissions('community:write')
  hideCommunityPost(
    @CurrentUser() user: AuthUser,
    @Param('postId') postId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.hideCommunityPost(user, postId, body);
  }

  @Post('community/posts/:postId/restore')
  @RequireAdminPermissions('community:write')
  restoreCommunityPost(
    @CurrentUser() user: AuthUser,
    @Param('postId') postId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.restoreCommunityPost(user, postId, body);
  }

  @Post('premium-video-products')
  @RequireAdminPermissions('premium_videos:write')
  createPremiumVideoProduct(@CurrentUser() user: AuthUser, @Body() body: AdminPayload) {
    return this.adminService.createPremiumVideoProduct(user, body);
  }

  @Patch('premium-video-products/:productId')
  @RequireAdminPermissions('premium_videos:write')
  updatePremiumVideoProduct(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updatePremiumVideoProduct(user, productId, body);
  }

  @Post('premium-video-products/:productId/assets')
  @RequireAdminPermissions('premium_videos:write', 'assets:write')
  linkPremiumVideoAsset(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.linkPremiumVideoAsset(user, productId, body);
  }

  @Delete('premium-video-products/:productId/assets/:premiumVideoAssetId')
  @RequireAdminPermissions('premium_videos:write', 'assets:write')
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
  @RequireAdminPermissions('chat_products:write')
  createChatFeatureProduct(@CurrentUser() user: AuthUser, @Body() body: AdminPayload) {
    return this.adminService.createChatFeatureProduct(user, body);
  }

  @Patch('chat-feature-products/:productId')
  @RequireAdminPermissions('chat_products:write')
  updateChatFeatureProduct(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Body() body: AdminPayload,
  ) {
    return this.adminService.updateChatFeatureProduct(user, productId, body);
  }
}

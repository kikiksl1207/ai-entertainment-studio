import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CommunityService } from './community.service';

type CommunityQuery = Record<string, string | undefined>;
type CommunityBody = Record<string, unknown>;
type RequestWithOptionalAuth = {
  user?: AuthUser;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
};

@Controller()
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  @Get('lumina-feed')
  getFeed(@Query() query: CommunityQuery) {
    return this.communityService.getFeed(query);
  }

  @Get('me/lumina-feed')
  @UseGuards(JwtAuthGuard)
  getMyFeed(@CurrentUser() user: AuthUser, @Query() query: CommunityQuery) {
    return this.communityService.getPersonalizedFeed(user.id, query);
  }

  @Get('me/lumina-feed/likes')
  @UseGuards(JwtAuthGuard)
  getMyLikedPosts(@CurrentUser() user: AuthUser, @Query() query: CommunityQuery) {
    return this.communityService.getMyLikedPosts(user.id, query);
  }

  @Get('lumina-feed/search')
  @UseGuards(OptionalJwtAuthGuard)
  searchFeed(
    @Query() query: CommunityQuery,
    @Req() request: RequestWithOptionalAuth,
  ) {
    return this.communityService.searchFeed(query, {
      userId: request.user?.id,
      visitorHash: this.visitorHashInput(request),
    });
  }

  @Get('lumina-feed/search-suggestions')
  getSearchSuggestions(@Query() query: CommunityQuery) {
    return this.communityService.getSearchSuggestions(query);
  }

  @Get('lumina-feed/trending-searches')
  getTrendingSearches(@Query() query: CommunityQuery) {
    return this.communityService.getTrendingSearches(query);
  }

  @Get('lumina-feed/hashtags')
  getTrendingHashtags(@Query() query: CommunityQuery) {
    return this.communityService.getTrendingHashtags(query);
  }

  @Get('lumina-feed/samples')
  getSamplePosts(@Query() query: CommunityQuery) {
    return this.communityService.getSamplePosts(query);
  }

  @Get('artists/:slug/posts')
  getArtistPosts(@Param('slug') slug: string, @Query() query: CommunityQuery) {
    return this.communityService.getArtistPosts(slug, query);
  }

  @Post('lumina-feed/posts')
  @UseGuards(JwtAuthGuard)
  createPost(@CurrentUser() user: AuthUser, @Body() body: CommunityBody) {
    return this.communityService.createPost(user.id, body);
  }

  @Post('lumina-feed/posts/thread')
  @UseGuards(JwtAuthGuard)
  createThreadPost(@CurrentUser() user: AuthUser, @Body() body: CommunityBody) {
    return this.communityService.createThreadPost(user.id, body);
  }

  @Get('lumina-feed/posts/:postId/thread-continuations')
  @UseGuards(OptionalJwtAuthGuard)
  getThreadContinuations(
    @Param('postId') postId: string,
    @Query() query: CommunityQuery,
    @Req() request: RequestWithOptionalAuth,
  ) {
    return this.communityService.getThreadContinuations(
      postId,
      query,
      request.user?.id,
    );
  }

  @Post('lumina-feed/posts/:postId/thread-continuations')
  @UseGuards(JwtAuthGuard)
  createThreadContinuation(
    @CurrentUser() user: AuthUser,
    @Param('postId') postId: string,
    @Body() body: CommunityBody,
  ) {
    return this.communityService.createThreadContinuation(user.id, postId, body);
  }

  @Post('lumina-feed/posts/:postId/reposts')
  @UseGuards(JwtAuthGuard)
  createRepost(
    @CurrentUser() user: AuthUser,
    @Param('postId') postId: string,
    @Body() body: CommunityBody,
  ) {
    return this.communityService.createRepost(user.id, postId, body);
  }

  @Post('lumina-feed/posts/:postId/share')
  sharePost(@Param('postId') postId: string) {
    return this.communityService.sharePost(postId);
  }

  @Get('lumina-feed/posts/:postId')
  @UseGuards(OptionalJwtAuthGuard)
  getPost(@Param('postId') postId: string, @Req() request: RequestWithOptionalAuth) {
    return this.communityService.getPost(postId, request.user?.id);
  }

  @Post('lumina-feed/link-preview')
  @UseGuards(JwtAuthGuard)
  createLinkPreview(@CurrentUser() user: AuthUser, @Body() body: CommunityBody) {
    return this.communityService.createLinkPreview(user.id, body);
  }

  @Delete('lumina-feed/posts/:postId')
  @UseGuards(JwtAuthGuard)
  deletePost(@CurrentUser() user: AuthUser, @Param('postId') postId: string) {
    return this.communityService.deletePost(user.id, postId);
  }

  @Patch('lumina-feed/posts/:postId')
  @UseGuards(JwtAuthGuard)
  updatePost(
    @CurrentUser() user: AuthUser,
    @Param('postId') postId: string,
    @Body() body: CommunityBody,
  ) {
    return this.communityService.updatePost(user.id, postId, body);
  }

  @Patch('lumina-feed/posts/:postId/thread-items/:itemId')
  @UseGuards(JwtAuthGuard)
  updateThreadItem(
    @CurrentUser() user: AuthUser,
    @Param('postId') postId: string,
    @Param('itemId') itemId: string,
    @Body() body: CommunityBody,
  ) {
    return this.communityService.updateThreadItem(user.id, postId, itemId, body);
  }

  @Delete('lumina-feed/posts/:postId/thread-items/:itemId')
  @UseGuards(JwtAuthGuard)
  deleteThreadItem(
    @CurrentUser() user: AuthUser,
    @Param('postId') postId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.communityService.deleteThreadItem(user.id, postId, itemId);
  }

  @Get('lumina-feed/posts/:postId/replies')
  @UseGuards(OptionalJwtAuthGuard)
  getReplies(
    @Param('postId') postId: string,
    @Query() query: CommunityQuery,
    @Req() request: RequestWithOptionalAuth,
  ) {
    return this.communityService.getReplies(postId, query, request.user?.id);
  }

  @Post('lumina-feed/posts/:postId/replies')
  @UseGuards(JwtAuthGuard)
  createReply(
    @CurrentUser() user: AuthUser,
    @Param('postId') postId: string,
    @Body() body: CommunityBody,
  ) {
    return this.communityService.createReply(user.id, postId, body);
  }

  @Delete('lumina-feed/replies/:replyId')
  @UseGuards(JwtAuthGuard)
  deleteReply(@CurrentUser() user: AuthUser, @Param('replyId') replyId: string) {
    return this.communityService.deleteReply(user.id, replyId);
  }

  @Post('lumina-feed/posts/:postId/like')
  @UseGuards(JwtAuthGuard)
  likePost(
    @CurrentUser() user: AuthUser,
    @Param('postId') postId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.communityService.likePost(user.id, postId, idempotencyKey);
  }

  @Delete('lumina-feed/posts/:postId/like')
  @UseGuards(JwtAuthGuard)
  unlikePost(@CurrentUser() user: AuthUser, @Param('postId') postId: string) {
    return this.communityService.unlikePost(user.id, postId);
  }

  @Post('lumina-feed/posts/:postId/report')
  @UseGuards(JwtAuthGuard)
  reportPost(
    @CurrentUser() user: AuthUser,
    @Param('postId') postId: string,
    @Body() body: CommunityBody,
  ) {
    return this.communityService.reportPost(user.id, postId, body);
  }

  @Post('lumina-feed/posts/:postId/hide')
  @UseGuards(JwtAuthGuard)
  hidePost(@CurrentUser() user: AuthUser, @Param('postId') postId: string) {
    return this.communityService.hidePost(user.id, postId);
  }

  @Delete('lumina-feed/posts/:postId/hide')
  @UseGuards(JwtAuthGuard)
  unhidePost(@CurrentUser() user: AuthUser, @Param('postId') postId: string) {
    return this.communityService.unhidePost(user.id, postId);
  }

  @Post('artists/:artistId/follow')
  @UseGuards(JwtAuthGuard)
  followArtist(@CurrentUser() user: AuthUser, @Param('artistId') artistId: string) {
    return this.communityService.followArtist(user.id, artistId);
  }

  @Delete('artists/:artistId/follow')
  @UseGuards(JwtAuthGuard)
  unfollowArtist(@CurrentUser() user: AuthUser, @Param('artistId') artistId: string) {
    return this.communityService.unfollowArtist(user.id, artistId);
  }

  @Post('users/:userId/follow')
  @UseGuards(JwtAuthGuard)
  followUser(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.communityService.followUser(user.id, userId);
  }

  @Post('users/handle/:publicHandle/follow')
  @UseGuards(JwtAuthGuard)
  followUserByHandle(
    @CurrentUser() user: AuthUser,
    @Param('publicHandle') publicHandle: string,
  ) {
    return this.communityService.followUserByHandle(user.id, publicHandle);
  }

  @Delete('users/:userId/follow')
  @UseGuards(JwtAuthGuard)
  unfollowUser(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.communityService.unfollowUser(user.id, userId);
  }

  @Delete('users/handle/:publicHandle/follow')
  @UseGuards(JwtAuthGuard)
  unfollowUserByHandle(
    @CurrentUser() user: AuthUser,
    @Param('publicHandle') publicHandle: string,
  ) {
    return this.communityService.unfollowUserByHandle(user.id, publicHandle);
  }

  @Post('users/:userId/block')
  @UseGuards(JwtAuthGuard)
  blockUser(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Body() body: CommunityBody,
  ) {
    return this.communityService.blockUser(user.id, userId, body);
  }

  @Post('users/handle/:publicHandle/block')
  @UseGuards(JwtAuthGuard)
  blockUserByHandle(
    @CurrentUser() user: AuthUser,
    @Param('publicHandle') publicHandle: string,
    @Body() body: CommunityBody,
  ) {
    return this.communityService.blockUserByHandle(user.id, publicHandle, body);
  }

  @Delete('users/:userId/block')
  @UseGuards(JwtAuthGuard)
  unblockUser(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.communityService.unblockUser(user.id, userId);
  }

  @Delete('users/handle/:publicHandle/block')
  @UseGuards(JwtAuthGuard)
  unblockUserByHandle(
    @CurrentUser() user: AuthUser,
    @Param('publicHandle') publicHandle: string,
  ) {
    return this.communityService.unblockUserByHandle(user.id, publicHandle);
  }

  @Get('users/:userId/profile')
  @UseGuards(OptionalJwtAuthGuard)
  getUserProfile(@Param('userId') userId: string, @Req() request: RequestWithOptionalAuth) {
    return this.communityService.getPublicUserProfile(userId, request.user?.id);
  }

  @Get('users/handle/:publicHandle/profile')
  @UseGuards(OptionalJwtAuthGuard)
  getUserProfileByHandle(
    @Param('publicHandle') publicHandle: string,
    @Req() request: RequestWithOptionalAuth,
  ) {
    return this.communityService.getPublicUserProfileByHandle(
      publicHandle,
      request.user?.id,
    );
  }

  @Get('users/:userId/lumina-feed')
  @UseGuards(OptionalJwtAuthGuard)
  getUserPosts(
    @Param('userId') userId: string,
    @Query() query: CommunityQuery,
    @Req() request: RequestWithOptionalAuth,
  ) {
    return this.communityService.getPublicUserPosts(userId, query, request.user?.id);
  }

  @Get('users/handle/:publicHandle/lumina-feed')
  @UseGuards(OptionalJwtAuthGuard)
  getUserPostsByHandle(
    @Param('publicHandle') publicHandle: string,
    @Query() query: CommunityQuery,
    @Req() request: RequestWithOptionalAuth,
  ) {
    return this.communityService.getPublicUserPostsByHandle(
      publicHandle,
      query,
      request.user?.id,
    );
  }

  @Get('users/:userId/followers')
  @UseGuards(OptionalJwtAuthGuard)
  getUserFollowers(
    @Param('userId') userId: string,
    @Query() query: CommunityQuery,
    @Req() request: RequestWithOptionalAuth,
  ) {
    return this.communityService.getPublicUserFollowers(
      userId,
      query,
      request.user?.id,
    );
  }

  @Get('users/:userId/following-users')
  @UseGuards(OptionalJwtAuthGuard)
  getUserFollowingUsers(
    @Param('userId') userId: string,
    @Query() query: CommunityQuery,
    @Req() request: RequestWithOptionalAuth,
  ) {
    return this.communityService.getPublicUserFollowingUsers(
      userId,
      query,
      request.user?.id,
    );
  }

  @Get('users/handle/:publicHandle/followers')
  @UseGuards(OptionalJwtAuthGuard)
  getUserFollowersByHandle(
    @Param('publicHandle') publicHandle: string,
    @Query() query: CommunityQuery,
    @Req() request: RequestWithOptionalAuth,
  ) {
    return this.communityService.getPublicUserFollowersByHandle(
      publicHandle,
      query,
      request.user?.id,
    );
  }

  @Get('users/handle/:publicHandle/following-users')
  @UseGuards(OptionalJwtAuthGuard)
  getUserFollowingUsersByHandle(
    @Param('publicHandle') publicHandle: string,
    @Query() query: CommunityQuery,
    @Req() request: RequestWithOptionalAuth,
  ) {
    return this.communityService.getPublicUserFollowingUsersByHandle(
      publicHandle,
      query,
      request.user?.id,
    );
  }

  @Get('me/following')
  @UseGuards(JwtAuthGuard)
  getMyFollowing(@CurrentUser() user: AuthUser) {
    return this.communityService.getMyFollowing(user.id);
  }

  @Get('me/following-artists')
  @UseGuards(JwtAuthGuard)
  getMyFollowingArtists(@CurrentUser() user: AuthUser, @Query() query: CommunityQuery) {
    return this.communityService.getMyFollowingArtists(user.id, query);
  }

  @Get('me/following-users')
  @UseGuards(JwtAuthGuard)
  getMyFollowingUsers(@CurrentUser() user: AuthUser, @Query() query: CommunityQuery) {
    return this.communityService.getMyFollowingUsers(user.id, query);
  }

  @Get('me/followers')
  @UseGuards(JwtAuthGuard)
  getMyFollowers(@CurrentUser() user: AuthUser, @Query() query: CommunityQuery) {
    return this.communityService.getMyFollowers(user.id, query);
  }

  @Delete('me/followers/:userId')
  @UseGuards(JwtAuthGuard)
  removeFollower(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.communityService.removeFollower(user.id, userId);
  }

  @Get('me/hidden-posts')
  @UseGuards(JwtAuthGuard)
  getMyHiddenPosts(@CurrentUser() user: AuthUser, @Query() query: CommunityQuery) {
    return this.communityService.getMyHiddenPosts(user.id, query);
  }

  @Get('me/blocked-users')
  @UseGuards(JwtAuthGuard)
  getMyBlockedUsers(@CurrentUser() user: AuthUser, @Query() query: CommunityQuery) {
    return this.communityService.getMyBlockedUsers(user.id, query);
  }

  private visitorHashInput(request: RequestWithOptionalAuth) {
    const forwardedFor = request.headers['x-forwarded-for'];
    const firstForwardedFor = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor;
    const ip =
      firstForwardedFor?.split(',')[0]?.trim() ??
      request.ip ??
      request.socket?.remoteAddress ??
      'unknown';
    const userAgent = request.headers['user-agent'];
    const firstUserAgent = Array.isArray(userAgent) ? userAgent[0] : userAgent;

    return `${ip}|${firstUserAgent ?? 'unknown'}`;
  }
}

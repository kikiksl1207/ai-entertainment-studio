import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CommunityService } from './community.service';

type CommunityQuery = Record<string, string | undefined>;
type CommunityBody = Record<string, unknown>;

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

  @Delete('lumina-feed/posts/:postId')
  @UseGuards(JwtAuthGuard)
  deletePost(@CurrentUser() user: AuthUser, @Param('postId') postId: string) {
    return this.communityService.deletePost(user.id, postId);
  }

  @Get('lumina-feed/posts/:postId/replies')
  getReplies(@Param('postId') postId: string, @Query() query: CommunityQuery) {
    return this.communityService.getReplies(postId, query);
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

  @Delete('users/:userId/follow')
  @UseGuards(JwtAuthGuard)
  unfollowUser(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.communityService.unfollowUser(user.id, userId);
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

  @Delete('users/:userId/block')
  @UseGuards(JwtAuthGuard)
  unblockUser(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.communityService.unblockUser(user.id, userId);
  }

  @Get('users/:userId/profile')
  getUserProfile(@Param('userId') userId: string) {
    return this.communityService.getPublicUserProfile(userId);
  }

  @Get('users/handle/:publicHandle/profile')
  getUserProfileByHandle(@Param('publicHandle') publicHandle: string) {
    return this.communityService.getPublicUserProfileByHandle(publicHandle);
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
  getMyFollowingUsers(@CurrentUser() user: AuthUser) {
    return this.communityService.getMyFollowingUsers(user.id);
  }

  @Get('me/followers')
  @UseGuards(JwtAuthGuard)
  getMyFollowers(@CurrentUser() user: AuthUser) {
    return this.communityService.getMyFollowers(user.id);
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
}

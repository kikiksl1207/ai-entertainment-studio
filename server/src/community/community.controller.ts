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

  @Get('me/following')
  @UseGuards(JwtAuthGuard)
  getMyFollowing(@CurrentUser() user: AuthUser) {
    return this.communityService.getMyFollowing(user.id);
  }
}

import { Body, Controller, Get, Header, Headers, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OttPlaybackService } from './ott-playback.service';

@Controller('me/ott-media')
@UseGuards(JwtAuthGuard)
export class OttPlaybackController {
  constructor(private readonly service: OttPlaybackService) {}

  @Post('works/:workId/playback-manifests')
  @Header('Cache-Control', 'private, no-store')
  create(@CurrentUser() user: AuthUser, @Param('workId') workId: string, @Headers('idempotency-key') key: string, @Body() body: unknown) {
    return this.service.createManifest(user.id, workId, key, body);
  }

  @Get('works/:workId/playback-manifests')
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() user: AuthUser, @Param('workId') workId: string, @Query() query: unknown) { return this.service.listManifests(user.id, workId, query); }

  @Get('playback-manifests/:manifestId')
  @Header('Cache-Control', 'private, no-store')
  get(@CurrentUser() user: AuthUser, @Param('manifestId') id: string) { return this.service.getManifest(user.id, id); }

  @Post('playback-manifests/:manifestId/preview-pins')
  @Header('Cache-Control', 'private, no-store')
  pin(@CurrentUser() user: AuthUser, @Param('manifestId') id: string, @Body() body: unknown) { return this.service.pinPreview(user.id, id, body); }

  @Post('playback-previews/:previewId/progress')
  @Header('Cache-Control', 'private, no-store')
  start(@CurrentUser() user: AuthUser, @Param('previewId') id: string, @Body() body: unknown) { return this.service.startProgress(user.id, id, body); }

  @Get('playback-progress/:progressId')
  @Header('Cache-Control', 'private, no-store')
  progress(@CurrentUser() user: AuthUser, @Param('progressId') id: string) { return this.service.getProgress(user.id, id); }

  @Post('playback-progress/:progressId/choices')
  @Header('Cache-Control', 'private, no-store')
  choice(@CurrentUser() user: AuthUser, @Param('progressId') id: string, @Headers('idempotency-key') key: string, @Body() body: unknown) {
    return this.service.command(user.id, id, 'choice', key, body);
  }

  @Put('playback-progress/:progressId/position')
  @Header('Cache-Control', 'private, no-store')
  position(@CurrentUser() user: AuthUser, @Param('progressId') id: string, @Headers('idempotency-key') key: string, @Body() body: unknown) {
    return this.service.command(user.id, id, 'position', key, body);
  }
}

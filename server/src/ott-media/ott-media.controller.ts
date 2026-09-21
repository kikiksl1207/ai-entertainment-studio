import { Body, Controller, Get, Header, Headers, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { IncomingMessage, ServerResponse } from 'http';
import { pipeline } from 'stream/promises';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { fail } from './ott-media.contract';
import { OttMediaService } from './ott-media.service';
import { BrowserRequest, OttMediaBrowserGuard } from './ott-media-browser.guard';
import { StoredObject } from './ott-media.storage';
import { OttMediaDelivery } from './ott-media.delivery';

@Controller('me/ott-media')
@UseGuards(JwtAuthGuard)
export class OttMediaController {
  constructor(private readonly service: OttMediaService, private readonly delivery: OttMediaDelivery) {}

  @Post('works')
  createWork(@CurrentUser() user: AuthUser, @Body() body: unknown) { return this.service.createWork(user.id, body); }

  @Post('works/:workId/versions')
  createVersion(@CurrentUser() user: AuthUser, @Param('workId') id: string, @Body() body: unknown) {
    return this.service.createVersion(user.id, id, body);
  }

  @Post('versions/:versionId/upload-intents')
  @Header('Cache-Control', 'private, no-store')
  createIntent(@CurrentUser() user: AuthUser, @Param('versionId') id: string,
    @Headers('idempotency-key') key: string | undefined, @Body() body: unknown) {
    return this.service.createIntent(user.id, id, key, body);
  }

  @Put('files/:fileId/object')
  upload(@CurrentUser() user: AuthUser, @Param('fileId') id: string, @Req() req: IncomingMessage) {
    if (req.headers['content-encoding'] || req.readableEnded || req.aborted) fail('INVALID');
    return this.service.uploadObject(user.id, id, req, req.headers['content-type']);
  }

  @Post('files/:fileId/confirm')
  confirm(@CurrentUser() user: AuthUser, @Param('fileId') id: string, @Body() body: unknown) { return this.service.confirm(user.id, id, body); }

  @Post('files/:fileId/revoke')
  @Header('Cache-Control', 'private, no-store')
  revoke(@CurrentUser() user: AuthUser, @Param('fileId') id: string, @Body() body: unknown) { return this.service.revoke(user.id, id, body); }

  @Get('files/:fileId')
  @Header('Cache-Control', 'private, no-store')
  getFile(@CurrentUser() user: AuthUser, @Param('fileId') id: string) { return this.service.getFile(user.id, id); }

  @Get('files/:fileId/preview')
  @Header('Cache-Control', 'private, no-store')
  preview(@CurrentUser() user: AuthUser, @Param('fileId') id: string) { return this.service.preview(user.id, id); }

  @Post('files/:fileId/playback-session')
  async browserSession(@CurrentUser() user: AuthUser, @Param('fileId') id: string, @Body() body: unknown,
    @Headers('origin') origin: string | undefined, @Headers('sec-fetch-site') fetchSite: string | undefined,
    @Res({ passthrough: true }) response: ServerResponse) {
    this.delivery.assertBrowserOrigin(origin, true, fetchSite);
    const session = await this.service.browserSession(user.id, id, body);
    response.setHeader('Set-Cookie', session.cookie);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Origin, Authorization');
    return { playback: { path: session.path, expiresAt: session.expiresAt, mode: 'secure_http_only_cookie', rangeSupported: true } };
  }

  @Get('files/:fileId/delivery')
  async deliver(@CurrentUser() user: AuthUser, @Param('fileId') id: string,
    @Headers('x-ott-expires') expires: string, @Headers('x-ott-signature') signature: string,
    @Headers('range') range: string | undefined, @Res() response: ServerResponse) {
    const media = await this.service.deliver(user.id, id, expires, signature);
    return streamResponse(media, range, response);
  }
}

@Controller('ott-media/private-files')
@UseGuards(OttMediaBrowserGuard)
export class OttMediaBrowserController {
  constructor(private readonly service: OttMediaService) {}

  @Get(':fileId/delivery')
  async deliver(@Req() request: BrowserRequest, @Headers('range') range: string | undefined, @Res() response: ServerResponse) {
    const media = await this.service.deliverBrowser(request.ottGrant);
    return streamResponse(media, range, response);
  }
}

async function streamResponse(media: StoredObject, range: string | undefined, response: ServerResponse) {
  try {
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('Vary', 'Origin, Authorization, Cookie');
      response.setHeader('Cross-Origin-Resource-Policy', 'same-site');
      let selected: { start: number; end: number };
      try { selected = byteRange(range, media.sizeBytes); }
      catch (error) { response.setHeader('Content-Range', `bytes */${media.sizeBytes}`); throw error; }
      response.setHeader('Content-Type', 'video/mp4');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('Accept-Ranges', 'bytes');
      response.setHeader('Content-Length', selected.end - selected.start + 1);
      if (range) {
        response.statusCode = 206;
        response.setHeader('Content-Range', `bytes ${selected.start}-${selected.end}/${media.sizeBytes}`);
      }
      await pipeline(media.stream(selected.start, selected.end), response);
  } finally { await media.close(); }
}

export function byteRange(value: string | undefined, size: number) {
  if (value === undefined) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) fail('RANGE_INVALID');
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) fail('RANGE_INVALID');
  return { start, end };
}

import { Controller, Get, Header, Headers, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import { ServerResponse } from 'http';
import { streamResponse } from '../../ott-media/ott-media.controller';
import { OttMediaDelivery } from '../../ott-media/ott-media.delivery';
import { OttPublicService } from './ott-public.service';

@Controller('ott')
export class OttPublicController {
  constructor(private readonly service: OttPublicService, private readonly delivery: OttMediaDelivery) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list() {
    return this.service.list();
  }

  @Get(':slug')
  @Header('Cache-Control', 'no-store')
  async detail(@Param('slug') slug: string) {
    const item = await this.service.findBySlug(slug);
    if (!item) throw new NotFoundException('Published OTT title not found');
    return item;
  }

  @Get(':slug/watch')
  @Header('Cache-Control', 'no-store')
  async watch(@Param('slug') slug: string, @Query('locale') locale: string | undefined) {
    const watch = await this.service.watch(slug, locale);
    if (!watch) throw new NotFoundException('Published OTT watch not found');
    return watch;
  }

  @Post(':slug/nodes/:nodeKey/playback-session')
  async browserSession(@Param('slug') slug: string, @Param('nodeKey') nodeKey: string,
    @Headers('origin') origin: string | undefined, @Headers('sec-fetch-site') fetchSite: string | undefined,
    @Res({ passthrough: true }) response: ServerResponse) {
    this.delivery.assertBrowserOrigin(origin, true, fetchSite);
    const session = await this.service.browserSession(slug, nodeKey);
    if (!session) throw new NotFoundException('Published OTT node not found');
    response.setHeader('Set-Cookie', session.cookie);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Origin');
    return { playback: { path: session.path, expiresAt: session.expiresAt,
      mode: 'secure_http_only_cookie', rangeSupported: true } };
  }

  @Get(':slug/nodes/:nodeKey/delivery')
  async deliver(@Param('slug') slug: string, @Param('nodeKey') nodeKey: string,
    @Headers('cookie') cookie: string | undefined, @Headers('origin') origin: string | undefined,
    @Headers('sec-fetch-site') fetchSite: string | undefined, @Headers('range') range: string | undefined,
    @Res() response: ServerResponse) {
    this.delivery.assertBrowserOrigin(origin, false, fetchSite);
    const media = await this.service.deliver(slug, nodeKey, cookie);
    if (!media) throw new NotFoundException('Published OTT node not found');
    return streamResponse(media, range, response);
  }
}

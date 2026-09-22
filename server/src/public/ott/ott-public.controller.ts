import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';
import { OttPublicService } from './ott-public.service';

@Controller('ott')
export class OttPublicController {
  constructor(private readonly service: OttPublicService) {}

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
}

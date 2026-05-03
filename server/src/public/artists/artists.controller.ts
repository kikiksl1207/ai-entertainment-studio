import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ArtistsService } from './artists.service';

@Controller('artists')
export class ArtistsController {
  constructor(private readonly artistsService: ArtistsService) {}

  @Get()
  findAll() {
    return this.artistsService.findAll();
  }

  @Get('roadmap')
  findRoadmap() {
    return this.artistsService.findRoadmap();
  }

  @Get(':slug')
  async findBySlug(@Param('slug') slug: string) {
    const artist = await this.artistsService.findBySlug(slug);

    if (!artist) {
      throw new NotFoundException('Artist not found');
    }

    return artist;
  }
}

import { Controller, Get, NotFoundException, Param, Req, UseGuards } from '@nestjs/common';
import { AuthUser } from '../../auth/auth.types';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { ArtistsService } from './artists.service';

type RequestWithOptionalAuth = {
  user?: AuthUser;
};

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
  @UseGuards(OptionalJwtAuthGuard)
  async findBySlug(@Param('slug') slug: string, @Req() request: RequestWithOptionalAuth) {
    const artist = await this.artistsService.findBySlug(slug, request.user?.id);

    if (!artist) {
      throw new NotFoundException('Artist not found');
    }

    return artist;
  }
}

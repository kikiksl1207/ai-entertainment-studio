import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ShortformsService } from './shortforms.service';

@Controller('shortforms')
export class ShortformsController {
  constructor(private readonly shortformsService: ShortformsService) {}

  @Get()
  findAll() {
    return this.shortformsService.findAll();
  }

  @Get(':slug')
  async findBySlug(@Param('slug') slug: string) {
    const shortform = await this.shortformsService.findBySlug(slug);

    if (!shortform) {
      throw new NotFoundException('Shortform not found');
    }

    return shortform;
  }
}

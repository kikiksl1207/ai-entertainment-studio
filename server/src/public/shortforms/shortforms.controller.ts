import { Controller, Get } from '@nestjs/common';
import { ShortformsService } from './shortforms.service';

@Controller('shortforms')
export class ShortformsController {
  constructor(private readonly shortformsService: ShortformsService) {}

  @Get()
  findAll() {
    return this.shortformsService.findAll();
  }
}

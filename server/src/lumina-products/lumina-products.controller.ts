import { Controller, Get } from '@nestjs/common';
import { LuminaProductsService } from './lumina-products.service';

@Controller('lumina-products')
export class LuminaProductsController {
  constructor(private readonly luminaProductsService: LuminaProductsService) {}

  @Get()
  findAll() {
    return this.luminaProductsService.findAll();
  }
}

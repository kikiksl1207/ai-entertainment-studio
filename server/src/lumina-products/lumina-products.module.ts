import { Module } from '@nestjs/common';
import { LuminaProductsController } from './lumina-products.controller';
import { LuminaProductsService } from './lumina-products.service';

@Module({
  controllers: [LuminaProductsController],
  providers: [LuminaProductsService],
})
export class LuminaProductsModule {}

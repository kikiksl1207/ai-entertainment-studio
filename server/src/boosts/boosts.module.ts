import { Module } from '@nestjs/common';
import { BoostsController } from './boosts.controller';
import { BoostsService } from './boosts.service';

@Module({
  controllers: [BoostsController],
  providers: [BoostsService],
})
export class BoostsModule {}

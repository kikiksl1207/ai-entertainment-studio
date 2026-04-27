import { Module } from '@nestjs/common';
import { PremiumVideosController } from './premium-videos.controller';
import { PremiumVideosService } from './premium-videos.service';

@Module({
  controllers: [PremiumVideosController],
  providers: [PremiumVideosService],
})
export class PremiumVideosModule {}

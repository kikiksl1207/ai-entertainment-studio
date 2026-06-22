import { Module } from '@nestjs/common';
import { AiPremiumContentController } from './ai-premium-content.controller';

@Module({
  controllers: [AiPremiumContentController],
})
export class AiPremiumContentModule {}

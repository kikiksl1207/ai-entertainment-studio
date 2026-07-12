import { Module } from '@nestjs/common';
import { StoryProductionController } from './story-production.controller';
import { StoryProductionService } from './story-production.service';

@Module({
  controllers: [StoryProductionController],
  providers: [StoryProductionService],
})
export class StoryProductionModule {}

import { Module } from '@nestjs/common';
import { ModerationModule } from '../moderation/moderation.module';
import { StoryProgressControlService } from './story-progress-control.service';
import {
  StoryProductionController,
  StoryProgressAdminController,
} from './story-production.controller';
import { StoryProductionService } from './story-production.service';

@Module({
  imports: [ModerationModule],
  controllers: [StoryProductionController, StoryProgressAdminController],
  providers: [StoryProductionService, StoryProgressControlService],
})
export class StoryProductionModule {}

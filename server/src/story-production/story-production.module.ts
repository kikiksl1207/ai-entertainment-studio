import { Module } from '@nestjs/common';
import { ModerationModule } from '../moderation/moderation.module';
import { StoryProgressControlService } from './story-progress-control.service';
import {
  StoryLifecycleController,
  StoryPublicationAdminController,
} from './story-lifecycle.controller';
import { StoryLifecycleService } from './story-lifecycle.service';
import {
  StoryProductionController,
  StoryProgressAdminController,
} from './story-production.controller';
import { StoryProductionService } from './story-production.service';

@Module({
  imports: [ModerationModule],
  controllers: [
    StoryProductionController,
    StoryProgressAdminController,
    StoryLifecycleController,
    StoryPublicationAdminController,
  ],
  providers: [
    StoryProductionService,
    StoryProgressControlService,
    StoryLifecycleService,
  ],
})
export class StoryProductionModule {}

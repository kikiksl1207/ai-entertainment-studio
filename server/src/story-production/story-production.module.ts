import { Module } from '@nestjs/common';
import { ModerationModule } from '../moderation/moderation.module';
import { StoryProgressControlService } from './story-progress-control.service';
import {
  StoryEconomicsAdminController,
  StoryEconomicsController,
} from './story-economics.controller';
import { StoryEconomicsService } from './story-economics.service';
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
import {
  StoryManuscriptAdmission, StoryManuscriptFileController,
  StoryManuscriptMultipartInterceptor, StoryManuscriptOwnerGuard,
  StoryManuscriptPasteMultipartInterceptor, StoryManuscriptPasteOwnerGuard,
} from './story-manuscript-file.controller';

@Module({
  imports: [ModerationModule],
  controllers: [
    StoryManuscriptFileController,
    StoryProductionController,
    StoryProgressAdminController,
    StoryLifecycleController,
    StoryPublicationAdminController,
    StoryEconomicsController,
    StoryEconomicsAdminController,
  ],
  providers: [
    StoryManuscriptAdmission,
    StoryManuscriptOwnerGuard,
    StoryManuscriptMultipartInterceptor,
    StoryManuscriptPasteOwnerGuard,
    StoryManuscriptPasteMultipartInterceptor,
    StoryProductionService,
    StoryProgressControlService,
    StoryLifecycleService,
    StoryEconomicsService,
  ],
})
export class StoryProductionModule {}

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
  StoryImjinReleaseBridgeAdminController,
  StoryPublicationAdminController,
} from './story-lifecycle.controller';
import { StoryLifecycleService } from './story-lifecycle.service';
import { StoryImjinReleaseBridgeService } from './story-imjin-release-bridge.service';
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
import {
  DisabledStoryContinuationProvider,
  StoryContinuationProvider,
} from './story-continuation.provider';
import {
  PrismaStoryContinuationQueueRepository,
  StoryContinuationQueueRepository,
} from './story-continuation.repository';
import { StoryContinuationExecutor } from './story-continuation.executor';
import { StoryContinuationContextAssembler } from './story-continuation-context.assembler';
import {
  StoryContinuationLegalActivationGate,
  UnconfiguredStoryContinuationLegalActivationGate,
} from './story-continuation-legal-activation.gate';

@Module({
  imports: [ModerationModule],
  controllers: [
    StoryManuscriptFileController,
    StoryProductionController,
    StoryProgressAdminController,
    StoryLifecycleController,
    StoryPublicationAdminController,
    StoryImjinReleaseBridgeAdminController,
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
    StoryImjinReleaseBridgeService,
    StoryEconomicsService,
    StoryContinuationExecutor,
    StoryContinuationContextAssembler,
    {
      provide: StoryContinuationLegalActivationGate,
      useClass: UnconfiguredStoryContinuationLegalActivationGate,
    },
    {
      provide: StoryContinuationProvider,
      useClass: DisabledStoryContinuationProvider,
    },
    {
      provide: StoryContinuationQueueRepository,
      useClass: PrismaStoryContinuationQueueRepository,
    },
  ],
})
export class StoryProductionModule {}

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
  STORY_CONTINUATION_OPENAI_PROVIDER,
  STORY_CONTINUATION_WORKER_PROVIDER,
} from './story-continuation-runtime.providers';
import {
  PrismaStoryContinuationQueueRepository,
  StoryContinuationQueueRepository,
} from './story-continuation.repository';
import { StoryContinuationExecutor } from './story-continuation.executor';
import { StoryContinuationContextAssembler } from './story-continuation-context.assembler';
import {
  StoryContinuationLegalActivationGate,
  PersistedStoryContinuationLegalActivationGate,
} from './story-continuation-legal-activation.gate';
import {
  StoryReusableResultApprovalGate,
  PersistedStoryReusableResultApprovalGate,
} from './story-reusable-result-approval.gate';
import { StoryAiActivationService } from './story-ai-activation.service';
import { StoryAiActivationAdminController } from './story-ai-activation.controller';

@Module({
  imports: [ModerationModule],
  controllers: [
    StoryAiActivationAdminController,
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
    StoryAiActivationService,
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
      useClass: PersistedStoryContinuationLegalActivationGate,
    },
    {
      provide: StoryReusableResultApprovalGate,
      useClass: PersistedStoryReusableResultApprovalGate,
    },
    STORY_CONTINUATION_OPENAI_PROVIDER,
    STORY_CONTINUATION_WORKER_PROVIDER,
    {
      provide: StoryContinuationQueueRepository,
      useClass: PrismaStoryContinuationQueueRepository,
    },
  ],
})
export class StoryProductionModule {}

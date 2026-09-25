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
  StoryAuthoredImportController,
  StoryAuthoredImportMultipartInterceptor,
} from './story-authored-import.controller';
import { StoryAuthoredImportService } from './story-authored-import.service';
import { StoryAuthorFinalReviewService } from './story-author-final-review.service';
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
import { SemanticAnalysisRepository } from './story-semantic-analysis.repository';
import { SemanticAnalysisService } from './story-semantic-analysis.service';
import { SEMANTIC_PROVIDER_FACTORY, SEMANTIC_WORKER_FACTORY } from './story-semantic-analysis.worker';
import {
  StoryVisualGenerationAdminController,
  StoryVisualAssetController,
  StoryVisualGenerationController,
} from './story-visual-generation.controller';
import { StoryVisualGenerationService } from './story-visual-generation.service';
import { StoryPublicBetaPolicy } from './story-public-beta.policy';
import { StoryPublicationIntakeController } from './story-publication-intake.controller';
import { StoryPublicationIntakeService } from './story-publication-intake.service';
import { StoryPublicBetaAiActivationService } from './story-public-beta-ai-activation.service';
import { StoryUploadModule } from '../story-upload/story-upload.module';
import { StoryGenerationProfileService } from './story-generation-profile.service';
import { StoryArtistParticipantService } from './story-artist-participant.service';
import { StoryStudioChoicePreparationController } from './story-studio-choice-preparation.controller';
import { StoryStudioChoicePreparationService } from './story-studio-choice-preparation.service';
import { StoryStudioLinearController } from './story-studio-linear.controller';
import { StoryStudioLinearService } from './story-studio-linear.service';

@Module({
  imports: [ModerationModule, StoryUploadModule],
  controllers: [
    StoryAiActivationAdminController,
    StoryManuscriptFileController,
    StoryStudioChoicePreparationController,
    StoryStudioLinearController,
    StoryAuthoredImportController,
    StoryProductionController,
    StoryProgressAdminController,
    StoryLifecycleController,
    StoryPublicationAdminController,
    StoryImjinReleaseBridgeAdminController,
    StoryEconomicsController,
    StoryEconomicsAdminController,
    StoryVisualGenerationController,
    StoryVisualAssetController,
    StoryVisualGenerationAdminController,
    StoryPublicationIntakeController,
  ],
  providers: [
    SemanticAnalysisRepository,
    SemanticAnalysisService,
    SEMANTIC_PROVIDER_FACTORY,
    SEMANTIC_WORKER_FACTORY,
    StoryAiActivationService,
    StoryManuscriptAdmission,
    StoryManuscriptOwnerGuard,
    StoryManuscriptMultipartInterceptor,
    StoryManuscriptPasteOwnerGuard,
    StoryManuscriptPasteMultipartInterceptor,
    StoryAuthoredImportService,
    StoryAuthorFinalReviewService,
    StoryStudioChoicePreparationService,
    StoryStudioLinearService,
    StoryAuthoredImportMultipartInterceptor,
    StoryProductionService,
    StoryProgressControlService,
    StoryLifecycleService,
    StoryImjinReleaseBridgeService,
    StoryEconomicsService,
    StoryVisualGenerationService,
    StoryPublicBetaPolicy,
    StoryPublicationIntakeService,
    StoryPublicBetaAiActivationService,
    StoryGenerationProfileService,
    StoryArtistParticipantService,
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

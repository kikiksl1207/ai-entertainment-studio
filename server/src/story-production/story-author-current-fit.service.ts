import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { StoryAuthorCurrentFitQueryDto } from './dto/story-author-current-fit.dto';
import { readCurrentApprovedStoryStyleSnapshot } from './story-author-approved-style.snapshot';
import { continuationGenerationProfileSnapshot, continuationHash, StoryContinuationProfileViewContextTooLargeError,
  type StoryContinuationProfileViewSizeDiagnostic } from './story-continuation-context.policy';
import { readStoryContinuationDiagnosticContext, StoryContinuationDiagnosticContextUnavailable } from './story-continuation-diagnostic-context';
import { inspectStoryContinuationFixedCapFit, STORY_FIXED_CAP_INPUT_TOKENS, STORY_FIXED_CAP_OUTPUT_TOKENS } from './story-continuation-fixed-cap-fit';
import { storyContinuationOutputTokenLimit } from './story-continuation-length.policy';
import { STORY_CONTINUATION_PROMPT_VERSION, STORY_CONTINUATION_SCHEMA_VERSION } from './story-continuation-openai.schema';
import { STORY_LOCALES } from './story-production.policy';

const reasons = ['progress_unavailable', 'progress_changed', 'release_unavailable', 'approval_unavailable',
  'approved_profile_context_too_large',
  'source_scope_mismatch', 'source_unavailable', 'choice_unavailable', 'source_not_fully_read',
  'capability_unavailable', 'fixed_cap_settings_mismatch', 'context_unavailable'] as const;
type Reason = typeof reasons[number];
class SnapshotUnavailable extends Error {
  constructor(readonly reason: Reason,
    readonly profileViewDiagnostic?: StoryContinuationProfileViewSizeDiagnostic) { super(reason); }
}
function unavailable(reason: Reason, profileViewDiagnostic?: StoryContinuationProfileViewSizeDiagnostic): never {
  throw new SnapshotUnavailable(reason, profileViewDiagnostic);
}
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);

@Injectable()
export class StoryAuthorCurrentFitService {
  constructor(private readonly prisma: PrismaService) {}

  async inspect(userId: string, workId: string, query: StoryAuthorCurrentFitQueryDto) {
    if (!isUUID(userId) || !isUUID(workId) || !isUUID(query?.choiceId) ||
      !(STORY_LOCALES as readonly string[]).includes(query?.locale) ||
      !Number.isSafeInteger(query?.expectedProgressRevision) || query.expectedProgressRevision < 0 ||
      query.expectedProgressRevision > 2147483647) {
      throw new BadRequestException({ code: 'STORY_AUTHOR_CURRENT_FIT_INPUT_INVALID' });
    }
    userId = userId.toLowerCase();
    workId = workId.toLowerCase();
    const choiceId = query.choiceId.toLowerCase();
    const envelope = {
      contract: 'story-author-current-fit-v1' as const, locale: query.locale,
      sourceScope: 'latest_private_approval_and_current_reader_source' as const,
      readOnly: true as const, providerCalls: 0 as const, operatingWrites: 0 as const,
      dispatchAuthorized: false as const, semanticQualityVerified: false as const,
      legalAuthorization: 'not_evaluated' as const, paidApproval: 'not_evaluated' as const,
    };
    try {
      return await this.prisma.$transaction(async db => {
        await db.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
        const work = await db.storyWork.findFirst({
          where: { id: workId, ownerUserId: userId, status: 'published', fixtureSource: false },
          select: { id: true, ownerUserId: true, activeReleaseId: true, publishedVersion: true },
        });
        if (!work) throw new NotFoundException({ code: 'STORY_AUTHOR_CURRENT_FIT_NOT_FOUND' });
        const progress = await db.storyReaderProgress.findUnique({ where: { userId_workId: { userId, workId } },
          select: { id: true, userId: true, workId: true, activeReleaseId: true, storyVersion: true,
            progressRevision: true, currentBeatPosition: true, currentSceneId: true, currentGeneratedSceneId: true,
            status: true, routeNodeId: true, pathSummary: true, aiRateCardId: true, capabilityRevision: true } });
        if (!progress || progress.status !== 'active') unavailable('progress_unavailable');
        if (progress.userId !== userId || progress.workId !== workId || !isUUID(progress.id) ||
          !Number.isSafeInteger(progress.progressRevision) || progress.progressRevision !== query.expectedProgressRevision) {
          unavailable('progress_changed');
        }
        if (!work.activeReleaseId || progress.activeReleaseId !== work.activeReleaseId ||
          !positive(work.publishedVersion) || progress.storyVersion !== work.publishedVersion) unavailable('release_unavailable');
        const release = await db.storyRelease.findFirst({
          where: { id: work.activeReleaseId, workId, status: 'active' },
          select: { id: true, workId: true, status: true, version: true, checksum: true, manuscriptVersionId: true },
        });
        if (!release || release.version !== progress.storyVersion || !hash(release.checksum) ||
          !isUUID(release.manuscriptVersionId)) unavailable('release_unavailable');

        let approval: Awaited<ReturnType<typeof readCurrentApprovedStoryStyleSnapshot>>;
        try { approval = await readCurrentApprovedStoryStyleSnapshot(db, userId, workId); }
        catch (error) {
          if (error instanceof ConflictException || error instanceof NotFoundException || error instanceof ServiceUnavailableException) {
            unavailable('approval_unavailable');
          }
          throw error;
        }
        const profile = await db.storyWorkGenerationProfile.findUnique({ where: { id: approval.approvalPin.id },
          select: { id: true, workId: true, ownerUserId: true, manuscriptVersionId: true, analysisJobId: true,
            status: true, profileVersion: true, reviewRevision: true, sourceFingerprint: true,
            approvedSettings: true, approvedFingerprint: true } });
        if (!profile || profile.workId !== workId || profile.ownerUserId !== userId ||
          profile.manuscriptVersionId !== release.manuscriptVersionId) unavailable('source_scope_mismatch');
        let generationProfile;
        try { generationProfile = continuationGenerationProfileSnapshot(profile); }
        catch (error) {
          if (error instanceof StoryContinuationProfileViewContextTooLargeError) {
            unavailable('approved_profile_context_too_large', error.profileViewDiagnostic);
          }
          if (error instanceof Error && error.message === 'generation_profile_context_too_large') {
            unavailable('approved_profile_context_too_large');
          }
          unavailable('approval_unavailable');
        }
        if (continuationHash(generationProfile.pin) !== continuationHash(approval.approvalPin)) unavailable('approval_unavailable');

        if (!!progress.currentSceneId === !!progress.currentGeneratedSceneId) unavailable('source_unavailable');
        const sourceKind = progress.currentGeneratedSceneId ? 'generated' as const : 'canonical' as const;
        const scene = sourceKind === 'generated'
          ? await db.storyAiGeneratedScene.findFirst({ where: { id: progress.currentGeneratedSceneId!, userId, workId,
              progressId: progress.id, releaseId: release.id, status: 'ready' },
            select: { id: true, sourcePartId: true, title: true, endingType: true, continuationId: true, sharedResultId: true } })
          : await db.storyScene.findFirst({ where: { id: progress.currentSceneId!, status: 'published', fixtureSource: false },
            select: { id: true, partId: true, title: true, endingType: true } });
        if (!scene || scene.endingType !== null) unavailable('source_unavailable');
        const partId = 'sourcePartId' in scene ? scene.sourcePartId : scene.partId;
        const part = await db.storyPart.findFirst({ where: { id: partId, workId, status: 'published', fixtureSource: false },
          select: { id: true, position: true } });
        if (!part || !positive(part.position)) unavailable('source_unavailable');
        if ('continuationId' in scene) {
          const origin = await db.storyAiContinuation.findFirst({
            where: { id: scene.continuationId, userId, workId, progressId: progress.id, releaseId: release.id,
              status: 'completed', resultGeneratedSceneId: scene.id }, select: { id: true },
          });
          if (!origin) unavailable('source_unavailable');
        }
        const positions = sourceKind === 'generated'
          ? await db.storyAiGeneratedBeat.findMany({ where: { sceneId: scene.id }, orderBy: { position: 'asc' },
            select: { position: true }, take: 41 })
          : await db.storyBeat.findMany({ where: { sceneId: scene.id }, orderBy: { position: 'asc' },
            select: { position: true }, take: 41 });
        if (!positions.length || positions.length > 40 || positions.some((beat, i) => beat.position !== i + 1) ||
          progress.currentBeatPosition !== positions.length) unavailable('source_not_fully_read');
        const choice: { id: string; sceneId: string; position: number; label: Prisma.JsonValue; routeKind: string;
          targetSceneId?: string | null; targetEndingKey?: string | null; declaredRejoinSceneId?: string | null } | null = sourceKind === 'generated'
          ? await db.storyAiGeneratedChoice.findFirst({ where: { id: choiceId, sceneId: scene.id },
            select: { id: true, sceneId: true, position: true, label: true, routeKind: true } })
          : await db.storyChoice.findFirst({ where: { id: choiceId, sceneId: scene.id },
            select: { id: true, sceneId: true, position: true, label: true, routeKind: true,
              targetSceneId: true, targetEndingKey: true, declaredRejoinSceneId: true } });
        if (!choice || choice.routeKind !== 'generation_required' || !positive(choice.position) || choice.position > 3 ||
          (choice.targetSceneId || choice.targetEndingKey || choice.declaredRejoinSceneId)) {
          unavailable('choice_unavailable');
        }
        const capability = await db.storyReleaseCapability.findUnique({ where: { releaseId: release.id },
          select: { workId: true, releaseId: true, status: true, revision: true, rateCardId: true,
            aiInputTokenLimit: true, aiOutputTokenLimit: true } });
        if (!capability || capability.workId !== workId || capability.status !== 'active' || !positive(capability.revision) ||
          capability.revision !== progress.capabilityRevision || capability.rateCardId !== progress.aiRateCardId) {
          unavailable('capability_unavailable');
        }
        if (capability.aiInputTokenLimit !== STORY_FIXED_CAP_INPUT_TOKENS ||
          capability.aiOutputTokenLimit !== STORY_FIXED_CAP_OUTPUT_TOKENS) unavailable('fixed_cap_settings_mismatch');
        const rateCard = await db.storyAiRateCard.findUnique({ where: { id: capability.rateCardId },
          select: { id: true, status: true, provider: true, model: true, version: true } });
        if (!rateCard || rateCard.status !== 'active' || rateCard.provider !== 'openai' ||
          typeof rateCard.model !== 'string' || !rateCard.model || rateCard.model.length > 100 ||
          typeof rateCard.version !== 'string' || !rateCard.version || rateCard.version.length > 128) unavailable('capability_unavailable');
        let context;
        try {
          context = await readStoryContinuationDiagnosticContext(db, { userId, workId, releaseId: release.id,
            manuscriptVersionId: release.manuscriptVersionId, analysisJobId: profile.analysisJobId,
            progress, part, scene, choice, sourceKind, locale: query.locale, generationProfile: generationProfile.approved });
        } catch (error) {
          if (error instanceof StoryContinuationDiagnosticContextUnavailable) unavailable('context_unavailable');
          throw error;
        }
        const diagnostic = inspectStoryContinuationFixedCapFit({
          // This marker is never a stored continuation, paid receipt, lease or provider operation.
          operationId: 'current_owner_read_only_diagnostic', locale: query.locale,
          contextFingerprint: continuationHash({ release: release.id, checksum: release.checksum,
            progressRevision: progress.progressRevision, profile: generationProfile.pin, choice: choice.id, context }),
          promptVersion: STORY_CONTINUATION_PROMPT_VERSION, outputSchemaVersion: STORY_CONTINUATION_SCHEMA_VERSION,
          inputTokenLimit: capability.aiInputTokenLimit,
          outputTokenLimit: storyContinuationOutputTokenLimit(context.narrativeLength!, capability.aiOutputTokenLimit),
          provider: rateCard.provider, model: rateCard.model, rateCardId: rateCard.id, rateCardVersion: rateCard.version,
          approvedContext: context,
        }, { provider: rateCard.provider, model: rateCard.model, rateCardId: rateCard.id, rateCardVersion: rateCard.version,
          maxInputTokens: capability.aiInputTokenLimit, maxOutputTokens: capability.aiOutputTokenLimit });
        return { ...envelope, outcome: 'request_checked' as const, currentSourceState: 'validated' as const,
          approvalReferenceVerified: true as const, progressRevision: progress.progressRevision,
          manuscriptVersion: approval.projection.manuscriptVersion, analysisVersion: approval.projection.analysisVersion,
          profileVersion: approval.projection.profileVersion, reviewRevision: approval.projection.reviewRevision, diagnostic };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    } catch (error) {
      if (error instanceof SnapshotUnavailable) return { ...envelope, outcome: 'current_source_unavailable' as const,
        currentSourceState: 'unavailable' as const, reason: error.reason, approvalReferenceVerified: false as const,
        progressRevision: null, manuscriptVersion: null, analysisVersion: null, profileVersion: null, reviewRevision: null,
        diagnostic: null,
        ...(error.profileViewDiagnostic ? { profileViewDiagnostic: error.profileViewDiagnostic } : {}) };
      if (error instanceof NotFoundException) throw error;
      throw new ServiceUnavailableException({ code: 'STORY_AUTHOR_CURRENT_FIT_UNAVAILABLE' });
    }
  }
}

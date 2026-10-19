import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { StoryAuthorCurrentFitQueryDto } from './dto/story-author-current-fit.dto';
import { readCurrentApprovedStoryStyleSnapshot } from './story-author-approved-style.snapshot';
import { continuationHash, profileObservationSource,
  type StoryContinuationProfileViewSizeDiagnostic } from './story-continuation-context.policy';
import { buildStoryApprovedProfileDelivery, decodeStoryApprovedProfileDelivery, measureStoryApprovedProfileDelivery,
  measureStoryApprovedProfileDeliveryComponents,
  createStoryApprovedProfileDiagnosticView, STORY_APPROVED_PROFILE_DELIVERY_CONTRACT } from './story-approved-profile-delivery.policy';
import type { StoryContinuationDiagnosticApprovedContext, StoryContinuationDiagnosticProfileBinding,
  StoryContinuationRequestPreparationConfig } from './story-continuation-openai.prompt';
import type { StoryContinuationProviderRequest } from './story-continuation.provider';
import { readStoryContinuationDiagnosticContext, StoryContinuationDiagnosticContextUnavailable } from './story-continuation-diagnostic-context';
import { inspectStoryContinuationFixedCapFit, STORY_FIXED_CAP_INPUT_TOKENS, STORY_FIXED_CAP_OUTPUT_TOKENS } from './story-continuation-fixed-cap-fit';
import { storyContinuationOutputTokenLimit } from './story-continuation-length.policy';
import { STORY_CONTINUATION_PROMPT_VERSION, STORY_CONTINUATION_SCHEMA_VERSION } from './story-continuation-openai.schema';
import { STORY_LOCALES } from './story-production.policy';
import { createStoryProfileOfflineReference, StoryProfileReferenceError,
  type StoryProfileReferenceOfflineBounds, type StoryProfileReferenceSnapshot } from './story-approved-profile-reference.policy';
import { inspectStoryRestoredProfileFixedCapFit } from './story-restored-profile-fixed-cap-fit';
import { OfflineStoryRestoredProfileFit } from './story-restored-profile-async-fit';
import type { OfflineTokenBudgetControls } from './story-continuation-tokenizer.offline';

export type StoryCurrentFitOfflineOptions = Readonly<{ bounds: StoryProfileReferenceOfflineBounds; nowMs: number }>;
type OfflineComputation = Readonly<{ owner: OfflineStoryRestoredProfileFit; controls: OfflineTokenBudgetControls }>;
const offlineNativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;

function captureOfflineComputation(owner: OfflineStoryRestoredProfileFit,
  controls: OfflineTokenBudgetControls): OfflineComputation {
  try {
    if (!(owner instanceof OfflineStoryRestoredProfileFit) || !controls || typeof controls !== 'object'
      || Array.isArray(controls) || ![Object.prototype, null].includes(Object.getPrototypeOf(controls))) throw new Error();
    const descriptors = Object.getOwnPropertyDescriptors(controls);
    if (Reflect.ownKeys(controls).some(key => typeof key !== 'string'
      || !['deadlineMs', 'joinGraceMs', 'workerHeapMiB', 'signal'].includes(key))
      || Object.values(descriptors).some(item => !item.enumerable || !('value' in item))) throw new Error();
    const integer = (value: unknown, minimum: number, maximum: number) => typeof value === 'number'
      && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
    if (!integer(descriptors.deadlineMs?.value, 1, 2147483647)
      || !integer(descriptors.joinGraceMs?.value, 1, 2147483647)
      || !integer(descriptors.workerHeapMiB?.value, 16, 1024)) throw new Error();
    const signal: unknown = descriptors.signal?.value;
    if (signal !== undefined && (!(signal instanceof AbortSignal) || !offlineNativeAborted
      || typeof Reflect.apply(offlineNativeAborted, signal, []) !== 'boolean')) throw new Error();
    return Object.freeze({ owner, controls: Object.freeze({ deadlineMs: descriptors.deadlineMs.value as number,
      joinGraceMs: descriptors.joinGraceMs.value as number, workerHeapMiB: descriptors.workerHeapMiB.value as number,
      ...(signal === undefined ? {} : { signal }) }) });
  } catch { throw new BadRequestException({ code: 'STORY_AUTHOR_OFFLINE_COMPUTATION_INPUT_INVALID' }); }
}

function offlineOptions(value: StoryCurrentFitOfflineOptions): StoryCurrentFitOfflineOptions {
  const data = (item: unknown, keys: readonly string[]) => {
    if (!item || typeof item !== 'object' || Object.getPrototypeOf(item) !== Object.prototype ||
      Reflect.ownKeys(item).length !== keys.length || keys.some(key => {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        return !descriptor?.enumerable || !('value' in descriptor);
      })) throw new BadRequestException({ code: 'STORY_AUTHOR_OFFLINE_FIT_INPUT_INVALID' });
  };
  data(value, ['bounds', 'nowMs']);
  data(value.bounds, ['purpose', 'restoredBytes', 'rawApprovalBytes', 'referenceLifetimeMs']);
  if (value.bounds.purpose !== 'offline_validation_only' ||
    ![value.bounds.restoredBytes, value.bounds.rawApprovalBytes, value.bounds.referenceLifetimeMs]
      .every(item => Number.isSafeInteger(item) && item > 0) ||
    !Number.isSafeInteger(value.nowMs) || value.nowMs < 0 ||
    !Number.isSafeInteger(value.nowMs + value.bounds.referenceLifetimeMs)) {
    throw new BadRequestException({ code: 'STORY_AUTHOR_OFFLINE_FIT_INPUT_INVALID' });
  }
  return Object.freeze({ bounds: Object.freeze({ ...value.bounds }), nowMs: value.nowMs });
}

const reasons = ['progress_unavailable', 'progress_changed', 'release_unavailable', 'approval_unavailable',
  'approved_profile_context_too_large',
  'approved_profile_style_projection_incomplete',
  'source_scope_mismatch', 'source_unavailable', 'choice_unavailable', 'source_not_fully_read',
  'capability_unavailable', 'fixed_cap_settings_mismatch', 'context_unavailable'] as const;
type Reason = typeof reasons[number];
type ProfileDeliveryDiagnostic = Readonly<{
  contract: typeof STORY_APPROVED_PROFILE_DELIVERY_CONTRACT;
  byteCap: 16384;
  wholeCandidateViewBytes: number;
  candidateViewFits: boolean;
  normalizedApprovalPreserved: true;
  modelInputFit: 'unmeasured';
  semanticQualityVerified: false;
  sizeBreakdown?: ReturnType<typeof measureStoryApprovedProfileDeliveryComponents>;
}>;
class SnapshotUnavailable extends Error {
  constructor(readonly reason: Reason,
    readonly profileViewDiagnostic?: StoryContinuationProfileViewSizeDiagnostic,
    readonly profileDeliveryDiagnostic?: ProfileDeliveryDiagnostic) { super(reason); }
}
function unavailable(reason: Reason, profileViewDiagnostic?: StoryContinuationProfileViewSizeDiagnostic,
  profileDeliveryDiagnostic?: ProfileDeliveryDiagnostic): never {
  throw new SnapshotUnavailable(reason, profileViewDiagnostic, profileDeliveryDiagnostic);
}
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);

@Injectable()
export class StoryAuthorCurrentFitService {
  constructor(private readonly prisma: PrismaService) {}

  async inspect(userId: string, workId: string, query: StoryAuthorCurrentFitQueryDto) {
    return this.inspectSnapshot(userId, workId, query);
  }

  async inspectOfflineRestoredProfile(userId: string, workId: string, query: StoryAuthorCurrentFitQueryDto,
    options: StoryCurrentFitOfflineOptions) {
    return this.inspectSnapshot(userId, workId, query, offlineOptions(options));
  }

  // Internal offline caller retains this owner/drain obligation, including after a disconnected request.
  async inspectOfflineRestoredProfileAsync(userId: string, workId: string, query: StoryAuthorCurrentFitQueryDto,
    options: StoryCurrentFitOfflineOptions, owner: OfflineStoryRestoredProfileFit, controls: OfflineTokenBudgetControls) {
    const computation = captureOfflineComputation(owner, controls);
    if (computation.owner.busy) throw new ConflictException({ code: 'STORY_AUTHOR_OFFLINE_COMPUTATION_BUSY' });
    return this.inspectSnapshot(userId, workId, query, offlineOptions(options), computation);
  }

  private async inspectSnapshot(userId: string, workId: string, query: StoryAuthorCurrentFitQueryDto,
    offline?: StoryCurrentFitOfflineOptions, computation?: OfflineComputation) {
    const choiceIdInput = query?.choiceId;
    const locale = query?.locale;
    const expectedProgressRevision = query?.expectedProgressRevision;
    const profileByteBreakdown = query?.profileByteBreakdown;
    if (!isUUID(userId) || !isUUID(workId) || !isUUID(choiceIdInput) ||
      !(STORY_LOCALES as readonly string[]).includes(locale) ||
      !Number.isSafeInteger(expectedProgressRevision) || expectedProgressRevision < 0 ||
      expectedProgressRevision > 2147483647 ||
      (profileByteBreakdown !== undefined && profileByteBreakdown !== 'v1')) {
      throw new BadRequestException({ code: 'STORY_AUTHOR_CURRENT_FIT_INPUT_INVALID' });
    }
    userId = userId.toLowerCase();
    workId = workId.toLowerCase();
    const choiceId = choiceIdInput.toLowerCase();
    const envelope = {
      contract: 'story-author-current-fit-v1' as const, locale,
      sourceScope: 'latest_private_approval_and_current_reader_source' as const,
      readOnly: true as const, providerCalls: 0 as const, operatingWrites: 0 as const,
      dispatchAuthorized: false as const, semanticQualityVerified: false as const,
      legalAuthorization: 'not_evaluated' as const, paidApproval: 'not_evaluated' as const,
      requestPreparationContract: 'story-continuation-lossless-profile-diagnostic-v1' as const,
      dispatchCompatibility: 'not_evaluated' as const,
      ...(offline ? { contract: computation ? 'story-author-current-fit-restored-async-offline-v1' as const
        : 'story-author-current-fit-restored-offline-v1' as const,
        requestPreparationContract: 'story-continuation-restored-profile-offline-v1' as const,
        offlineValidationOnly: true as const, productionInstalled: false as const,
        productionRestoredCapSelected: false as const, referencePersistence: 'request_local_only' as const } : {}),
    };
    try {
      const snapshot = await this.prisma.$transaction(async db => {
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
          !Number.isSafeInteger(progress.progressRevision) || progress.progressRevision !== expectedProgressRevision) {
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
        let delivery;
        try {
          const packet = buildStoryApprovedProfileDelivery(profile, approval.approvalPin, profileObservationSource);
          delivery = decodeStoryApprovedProfileDelivery(packet, profile,
            STORY_APPROVED_PROFILE_DELIVERY_CONTRACT, profileObservationSource);
        } catch { unavailable('approval_unavailable'); }
        const size = measureStoryApprovedProfileDelivery(delivery.packet);
        const profileDeliveryDiagnostic: ProfileDeliveryDiagnostic = Object.freeze({
          contract: STORY_APPROVED_PROFILE_DELIVERY_CONTRACT, byteCap: 16384,
          wholeCandidateViewBytes: size.wholeCandidateViewBytes, candidateViewFits: size.candidateViewFits,
          normalizedApprovalPreserved: true, modelInputFit: 'unmeasured', semanticQualityVerified: false,
          ...(profileByteBreakdown === 'v1'
            ? { sizeBreakdown: measureStoryApprovedProfileDeliveryComponents(delivery.packet) } : {}),
        });
        if (!size.candidateViewFits && !offline) unavailable('approved_profile_context_too_large', undefined, profileDeliveryDiagnostic);
        const generationProfile = createStoryApprovedProfileDiagnosticView(delivery.settings);

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
        let context: StoryContinuationDiagnosticApprovedContext;
        try {
          const routeContext = await readStoryContinuationDiagnosticContext(db, { userId, workId, releaseId: release.id,
            manuscriptVersionId: release.manuscriptVersionId, analysisJobId: profile.analysisJobId,
            progress, part, scene, choice, sourceKind, locale, generationProfile });
          context = { ...routeContext, generationProfile };
        } catch (error) {
          if (error instanceof StoryContinuationDiagnosticContextUnavailable) unavailable('context_unavailable');
          throw error;
        }
        const request: StoryContinuationProviderRequest = {
          // This marker is never a stored continuation, paid receipt, lease or provider operation.
          operationId: 'current_owner_read_only_diagnostic', locale,
          contextFingerprint: continuationHash({ release: release.id, checksum: release.checksum,
            progressRevision: progress.progressRevision, profile: delivery.packet.pin, choice: choice.id, context }),
          promptVersion: STORY_CONTINUATION_PROMPT_VERSION, outputSchemaVersion: STORY_CONTINUATION_SCHEMA_VERSION,
          inputTokenLimit: capability.aiInputTokenLimit,
          outputTokenLimit: offline ? STORY_FIXED_CAP_OUTPUT_TOKENS
            : storyContinuationOutputTokenLimit(context.narrativeLength!, capability.aiOutputTokenLimit),
          provider: rateCard.provider, model: rateCard.model, rateCardId: rateCard.id, rateCardVersion: rateCard.version,
          approvedContext: context,
        };
        const configuration: StoryContinuationRequestPreparationConfig = {
          provider: rateCard.provider, model: rateCard.model, rateCardId: rateCard.id, rateCardVersion: rateCard.version,
          maxInputTokens: capability.aiInputTokenLimit, maxOutputTokens: capability.aiOutputTokenLimit,
        };
        const profileBinding: StoryContinuationDiagnosticProfileBinding = { packet: delivery.packet, currentRow: profile };
        const offlineSnapshot: StoryProfileReferenceSnapshot | undefined = offline ? {
          scope: { ownerUserId: userId, workId, manuscriptVersionId: release.manuscriptVersionId,
            analysisJobId: profile.analysisJobId, releaseId: release.id, releaseVersion: release.version,
            releaseChecksum: release.checksum, progressId: progress.id, progressRevision: progress.progressRevision,
            routeNodeId: progress.routeNodeId, sourceSceneKind: sourceKind, sourceSceneId: scene.id,
            choiceId: choice.id, locale: locale as StoryProfileReferenceSnapshot['scope']['locale'],
            capabilityRevision: capability.revision,
            rateCardId: rateCard.id, rateCardVersion: rateCard.version }, row: profile,
        } : undefined;
        return { request, configuration, profileBinding, offlineSnapshot, response: {
          ...envelope, outcome: 'request_checked' as const, currentSourceState: 'validated' as const,
          approvalReferenceVerified: true as const, progressRevision: progress.progressRevision,
          manuscriptVersion: approval.projection.manuscriptVersion, analysisVersion: approval.projection.analysisVersion,
          profileVersion: approval.projection.profileVersion, reviewRevision: approval.projection.reviewRevision,
          profileDeliveryDiagnostic,
        } };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      // Compute only from the completed read snapshot; tokenization must not hold its DB transaction open.
      if (offline && snapshot.offlineSnapshot) {
        const issued = createStoryProfileOfflineReference(snapshot.offlineSnapshot, profileObservationSource,
          offline.bounds, offline.nowMs, offline.nowMs + offline.bounds.referenceLifetimeMs);
        const restoration = {
          reference: JSON.parse(JSON.stringify(issued)), serverOwnedIssuedReference: issued,
          current: snapshot.offlineSnapshot, localBounds: offline.bounds, nowMs: offline.nowMs,
        };
        const diagnostic = computation
          ? await computation.owner.inspect(snapshot.request, snapshot.configuration, restoration, computation.controls)
          : inspectStoryRestoredProfileFixedCapFit(snapshot.request, snapshot.configuration, restoration);
        return { ...snapshot.response, diagnostic };
      }
      const diagnostic = inspectStoryContinuationFixedCapFit(snapshot.request, snapshot.configuration, snapshot.profileBinding);
      return { ...snapshot.response, diagnostic };
    } catch (error) {
      if (error instanceof SnapshotUnavailable) return { ...envelope, outcome: 'current_source_unavailable' as const,
        currentSourceState: 'unavailable' as const, reason: error.reason, approvalReferenceVerified: false as const,
        progressRevision: null, manuscriptVersion: null, analysisVersion: null, profileVersion: null, reviewRevision: null,
        diagnostic: null,
        ...(error.profileViewDiagnostic ? { profileViewDiagnostic: error.profileViewDiagnostic } : {}),
        ...(error.profileDeliveryDiagnostic ? { profileDeliveryDiagnostic: error.profileDeliveryDiagnostic } : {}) };
      if (error instanceof NotFoundException) throw error;
      if (offline && error instanceof StoryProfileReferenceError) return { ...envelope,
        outcome: 'current_source_unavailable' as const, currentSourceState: 'unavailable' as const,
        reason: error.code, approvalReferenceVerified: false as const,
        progressRevision: null, manuscriptVersion: null, analysisVersion: null, profileVersion: null, reviewRevision: null,
        diagnostic: null };
      throw new ServiceUnavailableException({ code: 'STORY_AUTHOR_CURRENT_FIT_UNAVAILABLE' });
    }
  }
}

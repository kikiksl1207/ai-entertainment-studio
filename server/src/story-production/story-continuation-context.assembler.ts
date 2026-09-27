import { ConflictException, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { StoryContinuationClaim } from './story-continuation.repository';
import { storyRouteSnapshot } from './story-route-identity.store';
import {
  assembleContinuationSemanticPath,
  continuationExecutionFingerprint,
  continuationGenerationProfileSnapshot,
  approvedContinuationMemoryText,
  continuationMemoryPins,
  continuationPathHash,
  continuationSourceHash,
  localizedContinuationText,
  stableContinuationJson,
  parseContinuationGenerationProfilePin,
  STORY_CONTINUATION_PROFILE_VIEW_VERSION,
  type StoryContinuationMemoryPin,
  type StoryContinuationSemanticPathStep,
} from './story-continuation-context.policy';
import { StoryArtistParticipantService, type StoryApprovedParticipant } from './story-artist-participant.service';
import { authoredPartContinuationLengthBounds } from './story-continuation-author-length.store';
import { sourceStoryContinuationLengthBounds, type StoryContinuationLengthBounds } from './story-continuation-length.policy';

export class StoryContinuationContextError extends ConflictException {
  constructor(readonly code: string) {
    super(code);
  }
}

export type StoryContinuationApprovedContext = {
  sourceScene: {
    title: string;
    beats: Array<{ beatType: string; content: string }>;
  };
  selectedChoice: { label: string };
  path: StoryContinuationSemanticPathStep[];
  memories: Array<{ memoryType: string; content: string }>;
  narrativeLength?: StoryContinuationLengthBounds;
  generationProfile?: ReturnType<typeof continuationGenerationProfileSnapshot>['approved'];
  participantArtist?: StoryApprovedParticipant;
};

@Injectable()
export class StoryContinuationContextAssembler {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly storyParticipants?: StoryArtistParticipantService,
  ) {}

  async assemble(claim: StoryContinuationClaim): Promise<StoryContinuationApprovedContext> {
    const continuation = await this.prisma.storyAiContinuation.findUnique({
      where: { id: claim.continuationId },
    });
    if (!continuation || continuation.leaseToken !== claim.leaseToken) {
      throw new StoryContinuationContextError('stale_worker_lease');
    }
    const references = record(continuation.contextReferences);
    const memoryPins = memoryPinArray(references.memoryPins);
    const memoryIds = memoryPins.map((pin) => pin.id);
    let generationProfilePin;
    try {
      generationProfilePin = parseContinuationGenerationProfilePin(references.generationProfilePin);
    } catch {
      throw new StoryContinuationContextError('pinned_context_changed');
    }
    if (generationProfilePin && references.generationProfileViewVersion !== STORY_CONTINUATION_PROFILE_VIEW_VERSION) {
      throw new StoryContinuationContextError('pinned_context_changed');
    }
    const participantSnapshot = this.storyParticipants
      ? await this.storyParticipants.pinnedContext(this.prisma, continuation.progressId)
      : null;
    if (
      stableContinuationJson(participantSnapshot?.pin ?? null) !==
      stableContinuationJson(references.participantPin ?? null)
    ) {
      throw new StoryContinuationContextError('pinned_context_changed');
    }
    const sourceKind = continuation.sourceGeneratedSceneId ? 'generated' : 'canonical';
    const [progress, part, canonicalScene, generatedScene, memories, generationProfile] = await Promise.all([
      this.prisma.storyReaderProgress.findFirst({
        where: {
          id: continuation.progressId,
          userId: continuation.userId,
          workId: continuation.workId,
          activeReleaseId: continuation.releaseId,
          currentSceneId: continuation.sourceSceneId,
          currentGeneratedSceneId: continuation.sourceGeneratedSceneId,
          status: 'ai_pending',
          progressRevision: continuation.sourceProgressRevision + 1,
        },
      }),
      this.prisma.storyPart.findFirst({
        where: {
          id: continuation.sourcePartId,
          workId: continuation.workId,
          status: 'published',
          fixtureSource: false,
        },
      }),
      continuation.sourceSceneId
        ? this.prisma.storyScene.findFirst({
            where: {
              id: continuation.sourceSceneId,
              partId: continuation.sourcePartId,
              status: 'published',
              fixtureSource: false,
            },
            select: { id: true, title: true },
          })
        : Promise.resolve(null),
      continuation.sourceGeneratedSceneId
        ? this.prisma.storyAiGeneratedScene.findFirst({
            where: {
              id: continuation.sourceGeneratedSceneId,
              userId: continuation.userId,
              workId: continuation.workId,
              releaseId: continuation.releaseId,
              progressId: continuation.progressId,
              sourcePartId: continuation.sourcePartId,
              status: 'ready',
            },
            select: { id: true, title: true },
          })
        : Promise.resolve(null),
      this.prisma.storyMemoryRecord.findMany({
        where: {
          id: { in: memoryIds },
          workId: continuation.workId,
          manuscriptVersionId: continuation.manuscriptVersionId ?? undefined,
          analysisJobId: continuation.analysisJobId ?? undefined,
          status: 'approved',
        },
        orderBy: [{ memoryType: 'asc' }, { memoryKey: 'asc' }, { id: 'asc' }],
        select: { id: true, memoryType: true, revision: true, content: true },
      }),
      generationProfilePin
        ? this.prisma.storyWorkGenerationProfile.findFirst({
            where: {
              id: generationProfilePin.id,
              workId: continuation.workId,
              manuscriptVersionId: continuation.manuscriptVersionId ?? undefined,
              analysisJobId: continuation.analysisJobId ?? undefined,
              profileVersion: generationProfilePin.profileVersion,
              reviewRevision: generationProfilePin.reviewRevision,
              sourceFingerprint: generationProfilePin.sourceFingerprint,
              approvedFingerprint: generationProfilePin.approvedFingerprint,
              status: 'approved',
            },
            select: {
              id: true,
              status: true,
              profileVersion: true,
              reviewRevision: true,
              sourceFingerprint: true,
              approvedFingerprint: true,
              approvedSettings: true,
            },
          })
        : Promise.resolve(null),
    ]);
    const scene = canonicalScene ?? generatedScene;
    if (!progress || !part || !scene || memories.length !== memoryIds.length) {
      throw new StoryContinuationContextError('pinned_context_changed');
    }
    let approvedGenerationProfile;
    if (generationProfilePin) {
      if (!generationProfile) throw new StoryContinuationContextError('pinned_context_changed');
      try {
        const snapshot = continuationGenerationProfileSnapshot(generationProfile);
        if (stableContinuationJson(snapshot.pin) !== stableContinuationJson(generationProfilePin)) {
          throw new Error('generation_profile_pin_changed');
        }
        approvedGenerationProfile = snapshot.approved;
      } catch {
        throw new StoryContinuationContextError('pinned_context_changed');
      }
    }
    const route = await storyRouteSnapshot(this.prisma, progress);
    if (route.nodeId !== (continuation.sourceRouteNodeId ?? null) || route.hash !== (continuation.sourceRouteHash ?? null)) {
      throw new StoryContinuationContextError('pinned_route_changed');
    }
    const [sourceBeats, choice] = sourceKind === 'canonical'
      ? await Promise.all([
          this.prisma.storyBeat.findMany({
            where: { sceneId: continuation.sourceSceneId! },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            select: { position: true, beatType: true, content: true },
            take: 41,
          }),
          this.prisma.storyChoice.findFirst({
            where: {
              id: continuation.recommendedChoiceId ?? undefined,
              sceneId: continuation.sourceSceneId!,
              routeKind: 'generation_required',
              targetSceneId: null,
            },
            select: { id: true, label: true },
          }),
        ])
      : await Promise.all([
          this.prisma.storyAiGeneratedBeat.findMany({
            where: { sceneId: continuation.sourceGeneratedSceneId! },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            select: { position: true, beatType: true, content: true },
            take: 41,
          }),
          this.prisma.storyAiGeneratedChoice.findFirst({
            where: {
              id: continuation.generatedChoiceId ?? undefined,
              sceneId: continuation.sourceGeneratedSceneId!,
              routeKind: 'generation_required',
            },
            select: { id: true, label: true },
          }),
        ]);
    if (!choice || sourceBeats.length < 1 || sourceBeats.length > 40) {
      throw new StoryContinuationContextError('pinned_context_changed');
    }
    const currentMemoryPins = continuationMemoryPins(memories);
    const sourceHash = continuationSourceHash({
      kind: sourceKind,
      locale: continuation.locale,
      title: scene.title,
      beats: sourceBeats,
      choiceLabel: choice.label,
    });
    let narrativeLength: StoryContinuationLengthBounds;
    try {
      narrativeLength = sourceKind === 'generated'
        ? await authoredPartContinuationLengthBounds(this.prisma, continuation.sourcePartId, continuation.locale)
        : sourceStoryContinuationLengthBounds(continuation.locale, sourceBeats.map((beat) => ({
            beatType: beat.beatType,
            content: localizedContinuationText(beat.content, continuation.locale),
          })));
    } catch {
      throw new StoryContinuationContextError('pinned_context_changed');
    }
    if (references.narrativeLength && stableContinuationJson(references.narrativeLength) !== stableContinuationJson(narrativeLength)) {
      throw new StoryContinuationContextError('pinned_context_changed');
    }
    let semanticPath: StoryContinuationSemanticPathStep[];
    try {
      semanticPath = await assembleContinuationSemanticPath(this.prisma, {
        pathSummary: progress.pathSummary,
        locale: continuation.locale,
        userId: continuation.userId,
        workId: continuation.workId,
        releaseId: continuation.releaseId,
        progressId: continuation.progressId,
      });
    } catch {
      throw new StoryContinuationContextError('pinned_context_changed');
    }
    const pathHash = continuationPathHash(semanticPath);
    const executionFingerprint = continuationExecutionFingerprint({
      contextFingerprint: continuation.contextFingerprint,
      sourceHash,
      pathHash,
      memoryPins: currentMemoryPins,
      ...(generationProfilePin ? { generationProfilePin } : {}),
      ...(participantSnapshot ? { participantPin: participantSnapshot.pin } : {}),
    });
    if (
      stableContinuationJson(currentMemoryPins) !== stableContinuationJson(memoryPins) ||
      references.sourceHash !== sourceHash ||
      references.pathHash !== pathHash ||
      references.executionFingerprint !== executionFingerprint
    ) {
      throw new StoryContinuationContextError('pinned_context_changed');
    }
    let approvedContext: StoryContinuationApprovedContext;
    try {
      approvedContext = {
        sourceScene: {
          title: localizedContinuationText(scene.title, continuation.locale),
          beats: sourceBeats.map((beat) => ({
            beatType: beat.beatType,
            content: localizedContinuationText(beat.content, continuation.locale),
          })),
        },
        selectedChoice: {
          label: localizedContinuationText(choice.label, continuation.locale),
        },
        path: semanticPath,
        memories: memories.map((memory) => ({
          memoryType: memory.memoryType,
          content: approvedContinuationMemoryText(memory.content, continuation.locale),
        })),
        narrativeLength,
        ...(approvedGenerationProfile
          ? { generationProfile: approvedGenerationProfile }
          : {}),
        ...(participantSnapshot
          ? { participantArtist: participantSnapshot.approved }
          : {}),
      };
    } catch {
      throw new StoryContinuationContextError('localized_context_missing');
    }
    if (stableContinuationJson(approvedContext).length > continuation.inputTokenLimit * 4) {
      throw new StoryContinuationContextError('approved_context_bound_exceeded');
    }
    return approvedContext;
  }
}

function record(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

function memoryPinArray(value: Prisma.JsonValue | undefined): StoryContinuationMemoryPin[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || Array.isArray(item) || typeof item !== 'object') return [];
    const pin = item as Record<string, Prisma.JsonValue>;
    return typeof pin.id === 'string' && Number.isInteger(pin.revision) && typeof pin.contentHash === 'string'
      ? [{ id: pin.id, revision: Number(pin.revision), contentHash: pin.contentHash }]
      : [];
  });
}

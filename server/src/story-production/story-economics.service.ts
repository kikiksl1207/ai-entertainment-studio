import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  ActivateStoryAiRateCardDto,
  CreateStoryAiRateCardDto,
  EstimateStoryMemoryBudgetDto,
  EstimateStoryPriceDto,
  SettleStoryAiContinuationDto,
  TransitionStoryStyleConsentDto,
  UpsertStoryReleaseCapabilityDto,
  UpsertStoryStyleConsentDto,
} from './dto/story-economics.dto';
import {
  calculateInitialStoryPrice,
  calculateStoryUsageCost,
  duplicateFixedChoice,
  estimateHierarchicalMemoryTokens,
  STORY_AI_PUBLIC_CLAIM,
  storyAllowanceRemaining,
  storyBudgetDecision,
  validateStoryReleaseCapability,
} from './story-economics.policy';
import {
  boundedPath,
  isPublicStorySourceSafe,
  STORY_LOCALES,
} from './story-production.policy';
import {
  assertCustomChoiceReleasePolicy,
  firstReleaseChoiceCapability,
} from './story-progress-control.policy';
import { projectStoredStorySceneVisualManifest } from '../story-stage/story-scene-visual-manifest-contract';
import {
  StoryContinuationProvider,
  type StoryContinuationProviderResult,
} from './story-continuation.provider';
import type { StoryContinuationClaim } from './story-continuation.repository';
import { StoryContinuationLegalActivationGate } from './story-continuation-legal-activation.gate';
import {
  assembleContinuationSemanticPath,
  continuationHash,
  continuationExecutionFingerprint,
  approvedContinuationMemoryText,
  continuationMemoryPins,
  continuationPathHash,
  continuationSourceHash,
  localizedContinuationText,
  stableContinuationJson,
} from './story-continuation-context.policy';
import {
  StoryReusableResultApprovalGate,
} from './story-reusable-result-approval.gate';
import {
  STORY_AI_REUSE_COST_POLICY_VERSION,
  storyReusableResultKey,
} from './story-reusable-result.policy';

type CustomChoiceContext = {
  progress: {
    id: string;
    workId: string;
    currentSceneId: string | null;
    checkpointSceneId: string | null;
    progressRevision: number;
    activeReleaseId: string | null;
    aiRateCardId?: string | null;
    capabilityRevision?: number | null;
    pathSummary: Prisma.JsonValue;
    status: string;
  };
  work: {
    id: string;
    priceLumina: { isZero(): boolean };
  };
  scene: { id: string; partId: string };
  part: { id: string };
};

type PreparedCustomChoice = {
  capability: any;
  rateCard: any;
  consent: any;
  estimatedInputTokens: number;
  estimatedCostKrw: number;
  memoryIds: string[];
  choiceEventIds: string[];
};

type RecommendedChoiceRequest = {
  userId: string;
  progress: any;
  work: any;
  part: any;
  scene: any;
  release: {
    id: string;
    workId: string;
    version: number;
    manuscriptVersionId: string;
    checksum: string;
    status: string;
  };
  choice: any;
  sourceKind: 'canonical' | 'generated';
  locale: string;
  idempotencyKey?: string;
};

type RecommendedChoiceReplayClient = Pick<
  Prisma.TransactionClient,
  'storyAiContinuation' | 'storyAiAllowanceBucket'
>;

type RecommendedChoiceReplayScope = {
  userId: string;
  progressId: string;
  choiceId: string;
  expectedRevision: number;
  locale: string;
};

@Injectable()
export class StoryEconomicsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly legalActivation?: StoryContinuationLegalActivationGate,
    @Optional() private readonly continuationProvider?: StoryContinuationProvider,
    @Optional() private readonly reusableApproval?: StoryReusableResultApprovalGate,
  ) {}

  async recommendedChoiceReplay(
    userId: string,
    progressId: string,
    choiceId: string,
    expectedRevision: number,
    locale: string,
    idempotencyKey: string,
  ) {
    const key = this.idempotencyKey('recommended-choice', idempotencyKey);
    return this.recommendedChoiceReplayForClient(
      this.prisma,
      { userId, progressId, choiceId, expectedRevision, locale },
      key,
    );
  }

  async requestRecommendedChoiceTx(
    tx: Prisma.TransactionClient,
    input: RecommendedChoiceRequest,
  ) {
    const key = this.idempotencyKey('recommended-choice', input.idempotencyKey);
    const locale = normalizeRecommendedChoiceLocale(input.locale);
    if (
      input.choice.routeKind !== 'generation_required' ||
      input.choice.targetSceneId ||
      input.choice.sceneId !== input.scene.id
    ) {
      throw new ConflictException('Choice is not eligible for generated continuation');
    }
    const replayScope = {
      userId: input.userId,
      progressId: input.progress.id,
      choiceId: input.choice.id,
      expectedRevision: input.progress.progressRevision,
      locale,
    };
    const replay = await this.recommendedChoiceReplayForClient(tx, replayScope, key);
    if (replay) return replay;

    const now = new Date();
    const [capability, rateCard, consent, analysis, rightsContract] = await Promise.all([
      tx.storyReleaseCapability.findUnique({ where: { releaseId: input.release.id } }),
      tx.storyAiRateCard.findUnique({ where: { id: input.progress.aiRateCardId } }),
      tx.storyStyleProfileConsent.findFirst({
        where: {
          workId: input.work.id,
          manuscriptVersionId: input.release.manuscriptVersionId,
          status: 'active',
          rightsConfirmed: true,
          aiBranchAllowed: true,
          startsAt: { lte: now },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      }),
      tx.storyAnalysisJob.findFirst({
        where: {
          workId: input.work.id,
          manuscriptVersionId: input.release.manuscriptVersionId,
          status: 'completed',
        },
        orderBy: [{ analysisVersion: 'desc' }, { createdAt: 'desc' }],
      }),
      tx.contentRightsContract.findFirst({
        where: { workType: 'story', workId: input.work.id },
        include: {
          versions: {
            where: {
              contentVersionId: input.release.manuscriptVersionId,
              approvalState: 'approved_configuration',
              aiTransformationAllowed: true,
              effectiveFrom: { lte: now },
              startsAt: { lte: now },
              OR: [{ endsAt: null }, { endsAt: { gt: now } }],
            },
            orderBy: [{ revision: 'desc' }],
            take: 1,
          },
        },
      }),
    ]);
    const rights = rightsContract?.versions?.[0];
    const legalActivation = rights
      ? await this.legalActivation?.authorize({
          workId: input.work.id,
          releaseId: input.release.id,
          manuscriptVersionId: input.release.manuscriptVersionId,
          rightsContractVersionId: rights.id,
        })
      : null;
    if (
      !capability ||
      capability.status !== 'active' ||
      capability.revision !== input.progress.capabilityRevision ||
      capability.rateCardId !== input.progress.aiRateCardId ||
      !rateCard ||
      rateCard.status !== 'active' ||
      !consent ||
      !jsonStringArray(consent.allowedLocales).includes(locale) ||
      !analysis ||
      !rights ||
      !legalActivation?.active ||
      !jsonStringArray(rights.media).some((media) =>
        ['story', 'story_publication', 'all'].includes(media),
      )
    ) {
      throw new ForbiddenException({
        code: !legalActivation?.active
          ? 'STORY_AI_LEGAL_ACTIVATION_REQUIRED'
          : 'STORY_AI_GENERATION_NOT_AUTHORIZED',
        messageKey: 'story.progress.aiGeneration.notAuthorized',
        retryable: false,
      });
    }

    const boundedProgressPath = boundedPath(jsonRecordArray(input.progress.pathSummary));
    const [memory, sourceBeats, semanticPath] = await Promise.all([
      tx.storyMemoryRecord.findMany({
        where: {
          workId: input.work.id,
          manuscriptVersionId: input.release.manuscriptVersionId,
          status: 'approved',
          ...(analysis ? { analysisJobId: analysis.id } : {}),
          memoryType: { in: ['entity', 'event', 'foreshadow', 'branch', 'style'] },
        },
        orderBy: [{ memoryType: 'asc' }, { memoryKey: 'asc' }],
        select: { id: true, memoryType: true, revision: true, content: true },
        take: 50,
      }),
      input.sourceKind === 'canonical'
        ? tx.storyBeat.findMany({
            where: { sceneId: input.scene.id },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            select: { position: true, beatType: true, content: true },
            take: 41,
          })
        : tx.storyAiGeneratedBeat.findMany({
            where: { sceneId: input.scene.id },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            select: { position: true, beatType: true, content: true },
            take: 41,
          }),
      assembleContinuationSemanticPath(tx, {
        pathSummary: boundedProgressPath as Prisma.JsonValue,
        locale,
        userId: input.userId,
        workId: input.work.id,
        releaseId: input.release.id,
        progressId: input.progress.id,
      }),
    ]);
    if (sourceBeats.length < 1 || sourceBeats.length > 40) {
      throw new ForbiddenException({
        code: 'STORY_AI_CONTEXT_BUDGET_EXCEEDED',
        messageKey: 'story.progress.aiGeneration.contextBudgetExceeded',
        retryable: false,
      });
    }
    const memoryPins = continuationMemoryPins(memory);
    let sourceHash: string;
    let approvedContext: unknown;
    try {
      sourceHash = continuationSourceHash({
        kind: input.sourceKind,
        locale,
        title: input.scene.title,
        beats: sourceBeats,
        choiceLabel: input.choice.label,
      });
      approvedContext = {
        sourceScene: {
          title: localizedContinuationText(input.scene.title, locale),
          beats: sourceBeats.map((beat) => ({
            beatType: beat.beatType,
            content: localizedContinuationText(beat.content, locale),
          })),
        },
        selectedChoice: {
          label: localizedContinuationText(input.choice.label, locale),
        },
        path: semanticPath,
        memories: memory.map((item) => ({
          memoryType: item.memoryType,
          content: approvedContinuationMemoryText(item.content, locale),
        })),
      };
    } catch {
      throw new ForbiddenException({
        code: 'STORY_AI_CONTEXT_LOCALE_UNAVAILABLE',
        messageKey: 'story.progress.aiGeneration.contextUnavailable',
        retryable: false,
      });
    }
    const pathHash = continuationPathHash(semanticPath);
    const context = {
      workId: input.work.id,
      releaseId: input.release.id,
      releaseVersion: input.release.version,
      releaseChecksum: input.release.checksum,
      manuscriptVersionId: input.release.manuscriptVersionId,
      sourcePartId: input.part.id,
      sourceSceneId: input.sourceKind === 'canonical' ? input.scene.id : null,
      sourceGeneratedSceneId: input.sourceKind === 'generated' ? input.scene.id : null,
      recommendedChoiceId: input.sourceKind === 'canonical' ? input.choice.id : null,
      generatedChoiceId: input.sourceKind === 'generated' ? input.choice.id : null,
      semanticPath,
      memory: memoryPins,
      analysis: analysis
        ? { id: analysis.id, version: analysis.analysisVersion }
        : null,
      locale,
      capabilityRevision: capability.revision,
      styleConsent: { id: consent.id, revision: consent.revision },
      rights: { contractId: rightsContract!.id, versionId: rights.id, revision: rights.revision },
      rateCard: { id: rateCard.id, version: rateCard.version },
      promptVersion: 'story-continuation-v1',
      outputSchemaVersion: 'story-continuation-output-v1',
    };
    const contextFingerprint = createHash('sha256')
      .update(stableJson(context))
      .digest('hex');
    const executionFingerprint = continuationExecutionFingerprint({
      contextFingerprint,
      sourceHash,
      pathHash,
      memoryPins,
    });
    const contextCharacters = stableContinuationJson(approvedContext).length;
    const estimatedInputTokens = Math.max(1, Math.ceil(contextCharacters / 4));
    if (estimatedInputTokens > capability.aiInputTokenLimit) {
      throw new ForbiddenException({
        code: 'STORY_AI_CONTEXT_BUDGET_EXCEEDED',
        messageKey: 'story.progress.aiGeneration.contextBudgetExceeded',
        retryable: false,
      });
    }
    const reusableContextFingerprint = continuationHash({
      workId: input.work.id,
      releaseChecksum: input.release.checksum,
      manuscriptVersionId: input.release.manuscriptVersionId,
      sourceHash,
      pathHash,
      memory: memoryPins.map(({ revision, contentHash }) => ({ revision, contentHash })),
      analysisVersion: analysis.analysisVersion,
      locale,
    });
    const reusableSource = input.sourceKind === 'generated' &&
      typeof input.scene.sharedResultId === 'string'
      ? await tx.storyAiReusableResult.findFirst({
          where: {
            id: input.scene.sharedResultId,
            workId: input.work.id,
            releaseId: input.release.id,
            status: 'approved',
          },
          select: { id: true },
        })
      : null;
    const reusableSourceEligible = input.sourceKind === 'canonical' || (
      Boolean(reusableSource) &&
      typeof input.choice.choiceKey === 'string' &&
      input.choice.choiceKey.trim().length > 0
    );
    const reusableApproval = rights.generatedResultReuseAllowed && reusableSourceEligible
      ? await this.reusableApproval?.evaluate({
          workId: input.work.id,
          releaseId: input.release.id,
          releaseChecksum: input.release.checksum,
          manuscriptVersionId: input.release.manuscriptVersionId,
          rightsContractVersionId: rights.id,
        })
      : null;
    let reuseKey: string | null = null;
    let sharedResult: any = null;
    if (reusableApproval?.eligible && reusableApproval.snapshot) {
      reuseKey = storyReusableResultKey({
        releaseId: input.release.id,
        releaseChecksum: input.release.checksum,
        sourceKind: input.sourceKind,
        sourceCanonicalSceneId: input.sourceKind === 'canonical' ? input.scene.id : null,
        sourceCanonicalChoiceId: input.sourceKind === 'canonical' ? input.choice.id : null,
        sourceSharedResultId: input.sourceKind === 'generated' ? input.scene.sharedResultId : null,
        sourceSharedChoiceKey: input.sourceKind === 'generated' ? input.choice.choiceKey.trim() : null,
        sourceFingerprint: sourceHash,
        semanticPathFingerprint: pathHash,
        contextFingerprint: reusableContextFingerprint,
        promptVersion: context.promptVersion,
        outputSchemaVersion: context.outputSchemaVersion,
        locale,
        provider: rateCard.provider,
        model: rateCard.model,
        rateCardVersion: rateCard.version,
        costPolicyVersion: STORY_AI_REUSE_COST_POLICY_VERSION,
        evidence: reusableApproval.snapshot,
      });
      const claimToken = randomUUID();
      sharedResult = await tx.storyAiReusableResult.upsert({
        where: { reuseKey },
        create: {
          reuseKey,
          workId: input.work.id,
          releaseId: input.release.id,
          releaseChecksum: input.release.checksum,
          manuscriptVersionId: input.release.manuscriptVersionId,
          sourceKind: input.sourceKind,
          sourceCanonicalSceneId: input.sourceKind === 'canonical' ? input.scene.id : null,
          sourceCanonicalChoiceId: input.sourceKind === 'canonical' ? input.choice.id : null,
          sourceSharedResultId: input.sourceKind === 'generated' ? input.scene.sharedResultId : null,
          sourceSharedChoiceKey: input.sourceKind === 'generated' ? input.choice.choiceKey.trim() : null,
          sourceFingerprint: sourceHash,
          semanticPathFingerprint: pathHash,
          contextFingerprint: reusableContextFingerprint,
          promptVersion: context.promptVersion,
          outputSchemaVersion: context.outputSchemaVersion,
          locale,
          provider: rateCard.provider,
          model: rateCard.model,
          rateCardVersion: rateCard.version,
          costPolicyVersion: STORY_AI_REUSE_COST_POLICY_VERSION,
          rightsActivationKey: reusableApproval.snapshot.rightsActivationKey,
          moderationPolicyVersion: reusableApproval.snapshot.moderationPolicyVersion,
          moderationEvidenceVersion: reusableApproval.snapshot.moderationEvidenceVersion,
          qualityPolicyVersion: reusableApproval.snapshot.qualityPolicyVersion,
          claimToken,
        },
        update: {},
      });
      if (sharedResult.status === 'approved') {
        return this.applyReusableResultTx(tx, {
          input,
          key,
          capability,
          rateCard,
          consent,
          analysis,
          rightsContractId: rightsContract!.id,
          rights,
          contextFingerprint,
          reusableContextFingerprint,
          reuseKey,
          sourceHash,
          pathHash,
          executionFingerprint,
          sharedResult,
        });
      }
      if (sharedResult.status === 'revoked') {
        throw new ForbiddenException({
          code: 'STORY_AI_SHARED_RESULT_REVOKED',
          messageKey: 'story.progress.aiGeneration.sharedResultRevoked',
          retryable: false,
        });
      }
      if (sharedResult.claimToken !== claimToken) {
        const claimed = sharedResult.claimToken === null
          ? await tx.storyAiReusableResult.updateMany({
              where: { id: sharedResult.id, status: 'pending', claimToken: null },
              data: { claimToken, updatedAt: now },
            })
          : { count: 0 };
        if (claimed.count === 1) {
          sharedResult = { ...sharedResult, claimToken };
        } else {
          throw new ConflictException({
            code: 'STORY_AI_SHARED_RESULT_PENDING',
            messageKey: 'story.progress.aiGeneration.sharedResultPending',
            retryable: true,
            progressMutated: false,
            generationStarted: false,
          });
        }
      }
    }
    if (capability.includedAiRouteCount < 1) {
      throw new ForbiddenException({
        code: 'STORY_AI_ALLOWANCE_NOT_CONFIGURED',
        messageKey: 'story.progress.aiGeneration.notAuthorized',
        retryable: false,
      });
    }
    const providerReadiness = await this.continuationProvider?.readiness();
    if (!providerReadiness?.enabled) {
      throw new ConflictException({
        code: 'STORY_CHOICE_GENERATION_UNAVAILABLE',
        messageKey: 'story.choice.status.generationUnavailable',
        retryable: false,
        progressMutated: false,
        generationStarted: false,
      });
    }
    const estimatedCostKrw = calculateStoryUsageCost(this.rateNumbers(rateCard), {
      inputTokens: estimatedInputTokens,
      outputTokens: capability.aiOutputTokenLimit,
    });
    if (storyBudgetDecision(
      estimatedCostKrw,
      Number(capability.warningBudgetKrw),
      Number(capability.hardBudgetKrw),
    ).decision === 'blocked') {
      throw new ForbiddenException({
        code: 'STORY_AI_HARD_BUDGET_EXCEEDED',
        messageKey: 'story.progress.aiGeneration.budgetExceeded',
        retryable: false,
      });
    }

    const allowance = await tx.storyAiAllowanceBucket.upsert({
      where: {
        userId_releaseId: { userId: input.userId, releaseId: input.release.id },
      },
      create: {
        userId: input.userId,
        workId: input.work.id,
        releaseId: input.release.id,
        includedLimit: capability.includedAiRouteCount,
      },
      update: {},
    });
    if (storyAllowanceRemaining(allowance) < 1) {
      throw new ForbiddenException({
        code: 'STORY_AI_ALLOWANCE_EXHAUSTED',
        messageKey: 'story.progress.aiGeneration.allowanceExhausted',
        retryable: false,
      });
    }
    const reserved = await tx.storyAiAllowanceBucket.updateMany({
      where: { id: allowance.id, revision: allowance.revision },
      data: {
        reservedCount: { increment: 1 },
        revision: { increment: 1 },
        updatedAt: now,
      },
    });
    if (reserved.count !== 1) {
      const racedReplay = await this.recommendedChoiceReplayForClient(
        tx,
        replayScope,
        key,
      );
      if (racedReplay) return racedReplay;
      throw new ConflictException('Story AI allowance changed concurrently');
    }
    const continuation = await tx.storyAiContinuation.create({
      data: {
        userId: input.userId,
        workId: input.work.id,
        releaseId: input.release.id,
        progressId: input.progress.id,
        requestKind: 'recommended_choice',
        customChoiceId: null,
        recommendedChoiceId: input.sourceKind === 'canonical' ? input.choice.id : null,
        generatedChoiceId: input.sourceKind === 'generated' ? input.choice.id : null,
        rateCardId: rateCard.id,
        styleConsentId: consent.id,
        styleConsentRevision: consent.revision,
        capabilityRevision: capability.revision,
        idempotencyKey: key,
        sourcePartId: input.part.id,
        sourceSceneId: input.sourceKind === 'canonical' ? input.scene.id : null,
        sourceGeneratedSceneId: input.sourceKind === 'generated' ? input.scene.id : null,
        sourceProgressRevision: input.progress.progressRevision,
        checkpointSceneId: input.progress.checkpointSceneId,
        manuscriptVersionId: input.release.manuscriptVersionId,
        analysisJobId: analysis?.id,
        analysisVersion: analysis?.analysisVersion,
        rightsContractId: rightsContract!.id,
        rightsContractVersionId: rights.id,
        releaseChecksum: input.release.checksum,
        locale,
        contextFingerprint,
        reusableContextFingerprint: sharedResult ? reusableContextFingerprint : null,
        reuseKey,
        sharedResultId: sharedResult?.id ?? null,
        promptVersion: context.promptVersion,
        outputSchemaVersion: context.outputSchemaVersion,
        contextReferences: {
          memoryPins,
          sourceHash,
          pathHash,
          executionFingerprint,
          sharedClaimToken: sharedResult?.claimToken ?? null,
          fullManuscriptIncluded: false,
          providerPayloadIncluded: false,
        },
        estimatedCostKrw,
        hardBudgetKrw: capability.hardBudgetKrw,
        inputTokenLimit: capability.aiInputTokenLimit,
        outputTokenLimit: capability.aiOutputTokenLimit,
        maxAttempts: 3,
      },
    });
    await tx.storyAiUsageLedger.create({
      data: {
        continuationId: continuation.id,
        userId: input.userId,
        workId: input.work.id,
        releaseId: input.release.id,
        rateCardId: rateCard.id,
        eventKind: 'recommended_route_request',
        status: 'reserved',
        provider: rateCard.provider,
        model: rateCard.model,
        rateCardVersion: rateCard.version,
        inputTokens: estimatedInputTokens,
        outputTokens: capability.aiOutputTokenLimit,
        estimatedCostKrw,
        allowanceDelta: 0,
        progressApplied: false,
        provenance: 'ai_generated',
        idempotencyKey: `usage-request:${continuation.id}`,
      },
    });
    const progressUpdate = await tx.storyReaderProgress.updateMany({
      where: {
        id: input.progress.id,
        userId: input.userId,
        workId: input.work.id,
        activeReleaseId: input.release.id,
        currentSceneId: input.sourceKind === 'canonical' ? input.scene.id : null,
        currentGeneratedSceneId: input.sourceKind === 'generated' ? input.scene.id : null,
        progressRevision: input.progress.progressRevision,
        status: 'active',
      },
      data: {
        status: 'ai_pending',
        progressRevision: { increment: 1 },
        updatedAt: now,
      },
    });
    if (progressUpdate.count !== 1) {
      throw new ConflictException('Story progress changed concurrently');
    }
    return this.continuationProjection(
      continuation,
      storyAllowanceRemaining(allowance) - 1,
      false,
    );
  }

  async createRateCard(adminUserId: string, body: CreateStoryAiRateCardDto) {
    const existing = await this.prisma.storyAiRateCard.findUnique({
      where: { version: body.version.trim() },
    });
    if (existing) {
      const matches =
        existing.provider === body.provider.trim() &&
        existing.model === body.model.trim() &&
        existing.currencyCode === body.currencyCode &&
        Number(existing.inputCostPerMillion) === body.inputCostPerMillion &&
        Number(existing.outputCostPerMillion) === body.outputCostPerMillion &&
        Number(existing.cachedInputCostPerMillion) ===
          body.cachedInputCostPerMillion &&
        Number(existing.imageUnitCost) === body.imageUnitCost;
      if (!matches) throw new ConflictException('Rate card version is immutable');
      return this.rateCardProjection(existing, true);
    }
    const rateCard = await this.prisma.storyAiRateCard.create({
      data: {
        version: body.version.trim(),
        provider: body.provider.trim(),
        model: body.model.trim(),
        currencyCode: body.currencyCode,
        inputCostPerMillion: body.inputCostPerMillion,
        outputCostPerMillion: body.outputCostPerMillion,
        cachedInputCostPerMillion: body.cachedInputCostPerMillion,
        imageUnitCost: body.imageUnitCost,
        createdByUserId: adminUserId,
      },
    });
    return this.rateCardProjection(rateCard, false);
  }

  async activateRateCard(
    adminUserId: string,
    rateCardId: string,
    body: ActivateStoryAiRateCardDto,
  ) {
    const effectiveAt = new Date(body.effectiveAt);
    return this.prisma.$transaction(async (tx) => {
      const rateCard = await tx.storyAiRateCard.findUnique({ where: { id: rateCardId } });
      if (!rateCard) throw new NotFoundException('Story AI rate card not found');
      await tx.storyAiRateCard.updateMany({
        where: { status: 'active', id: { not: rateCard.id } },
        data: { status: 'retired', retiredAt: effectiveAt },
      });
      const active = await tx.storyAiRateCard.update({
        where: { id: rateCard.id },
        data: { status: 'active', effectiveAt, retiredAt: null },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: adminUserId,
          actorType: 'admin',
          action: 'story_ai_rate_card.activate',
          targetType: 'story_ai_rate_card',
          targetId: rateCard.id,
          metadata: { version: rateCard.version, effectiveAt },
        },
      });
      return this.rateCardProjection(active, false);
    });
  }

  async upsertReleaseCapability(
    adminUserId: string,
    releaseId: string,
    body: UpsertStoryReleaseCapabilityDto,
  ) {
    const release = await this.prisma.storyRelease.findUnique({ where: { id: releaseId } });
    if (!release) throw new NotFoundException('Story release not found');
    const [work, rateCard, existing] = await Promise.all([
      this.prisma.storyWork.findUnique({ where: { id: release.workId } }),
      this.prisma.storyAiRateCard.findUnique({ where: { id: body.rateCardId } }),
      this.prisma.storyReleaseCapability.findUnique({ where: { releaseId } }),
    ]);
    if (!work || !rateCard) throw new NotFoundException('Capability dependency not found');
    if (rateCard.status !== 'active') {
      throw new ConflictException('An active rate card is required');
    }
    if (existing && existing.revision !== body.expectedRevision) {
      throw new ConflictException('Story release capability changed concurrently');
    }
    const errors = validateStoryReleaseCapability({
      freeStory: work.priceLumina.isZero(),
      fixedChoiceCount: body.fixedChoiceCount,
      customChoiceEnabled: body.customChoiceEnabled,
      customChoiceMaxLength: body.customChoiceMaxLength,
      fullResetLimit: body.fullResetLimit,
      actResetLimit: body.actResetLimit,
      includedAiRouteCount: body.includedAiRouteCount,
      aiInputTokenLimit: body.aiInputTokenLimit,
      aiOutputTokenLimit: body.aiOutputTokenLimit,
      warningBudgetKrw: body.warningBudgetKrw,
      hardBudgetKrw: body.hardBudgetKrw,
    });
    const capability = await this.prisma.storyReleaseCapability.upsert({
      where: { releaseId },
      create: {
        workId: work.id,
        releaseId,
        rateCardId: rateCard.id,
        fixedChoiceCount: body.fixedChoiceCount,
        customChoiceEnabled: body.customChoiceEnabled,
        customChoiceMaxLength: body.customChoiceMaxLength,
        fullResetLimit: body.fullResetLimit,
        actResetLimit: body.actResetLimit,
        includedAiRouteCount: body.includedAiRouteCount,
        aiInputTokenLimit: body.aiInputTokenLimit,
        aiOutputTokenLimit: body.aiOutputTokenLimit,
        warningBudgetKrw: body.warningBudgetKrw,
        hardBudgetKrw: body.hardBudgetKrw,
        status: errors.length ? 'invalid' : 'active',
        validationErrors: errors,
        updatedByUserId: adminUserId,
      },
      update: {
        rateCardId: rateCard.id,
        fixedChoiceCount: body.fixedChoiceCount,
        customChoiceEnabled: body.customChoiceEnabled,
        customChoiceMaxLength: body.customChoiceMaxLength,
        fullResetLimit: body.fullResetLimit,
        actResetLimit: body.actResetLimit,
        includedAiRouteCount: body.includedAiRouteCount,
        aiInputTokenLimit: body.aiInputTokenLimit,
        aiOutputTokenLimit: body.aiOutputTokenLimit,
        warningBudgetKrw: body.warningBudgetKrw,
        hardBudgetKrw: body.hardBudgetKrw,
        status: errors.length ? 'invalid' : 'active',
        validationErrors: errors,
        revision: { increment: 1 },
        updatedByUserId: adminUserId,
        updatedAt: new Date(),
      },
    });
    return this.capabilityProjection(capability);
  }

  async estimateAndSavePrice(
    adminUserId: string,
    workId: string,
    body: EstimateStoryPriceDto,
  ) {
    const [work, rateCard] = await Promise.all([
      this.prisma.storyWork.findUnique({ where: { id: workId }, select: { id: true } }),
      this.prisma.storyAiRateCard.findUnique({ where: { id: body.rateCardId } }),
    ]);
    if (!work || !rateCard) throw new NotFoundException('Story pricing dependency not found');
    const oneRouteCost = calculateStoryUsageCost(this.rateNumbers(rateCard), {
      inputTokens: body.averageAiInputTokens,
      outputTokens: body.averageAiOutputTokens,
    });
    const estimate = calculateInitialStoryPrice({
      authorRightsCostKrw: body.authorRightsCostKrw,
      expectedReplayCostKrw: 0,
      includedAiRouteCostKrw: oneRouteCost * body.includedNewAiRouteCount,
      paymentFeeRate: body.paymentFeeRate,
      vatRate: body.vatRate,
      storageDeliveryCostKrw: body.storageDeliveryCostKrw,
      operatingMarginRate: body.operatingMarginRate,
    });
    const policy = await this.prisma.storyPricingPolicy.upsert({
      where: { workId },
      create: {
        workId,
        rateCardId: rateCard.id,
        authorRightsCostKrw: body.authorRightsCostKrw,
        expectedFreeReplayCount: body.expectedFreeReplayCount,
        includedNewAiRouteCount: body.includedNewAiRouteCount,
        paymentFeeRate: body.paymentFeeRate,
        vatRate: body.vatRate,
        storageDeliveryCostKrw: body.storageDeliveryCostKrw,
        operatingMarginRate: body.operatingMarginRate,
        warningBudgetKrw: body.warningBudgetKrw,
        hardBudgetKrw: body.hardBudgetKrw,
        updatedByUserId: adminUserId,
      },
      update: {
        rateCardId: rateCard.id,
        authorRightsCostKrw: body.authorRightsCostKrw,
        expectedFreeReplayCount: body.expectedFreeReplayCount,
        includedNewAiRouteCount: body.includedNewAiRouteCount,
        paymentFeeRate: body.paymentFeeRate,
        vatRate: body.vatRate,
        storageDeliveryCostKrw: body.storageDeliveryCostKrw,
        operatingMarginRate: body.operatingMarginRate,
        warningBudgetKrw: body.warningBudgetKrw,
        hardBudgetKrw: body.hardBudgetKrw,
        revision: { increment: 1 },
        updatedByUserId: adminUserId,
        updatedAt: new Date(),
      },
    });
    return {
      policyId: policy.id,
      rateCardVersion: rateCard.version,
      averageAiRouteCostKrw: oneRouteCost,
      ...estimate,
      existingRouteReplayCostKrw: 0,
      warningBudgetKrw: policy.warningBudgetKrw.toString(),
      hardBudgetKrw: policy.hardBudgetKrw.toString(),
    };
  }

  async estimateMemoryBudget(
    userId: string,
    workId: string,
    body: EstimateStoryMemoryBudgetDto,
    idempotencyKey?: string,
  ) {
    const key = this.idempotencyKey('story-memory-budget', idempotencyKey);
    const existing = await this.prisma.storyMemoryBudgetRun.findUnique({
      where: { idempotencyKey: key },
    });
    if (existing) return this.memoryBudgetProjection(existing, true);
    const [work, manuscript, rateCard, analysisJob] = await Promise.all([
      this.prisma.storyWork.findFirst({ where: { id: workId, ownerUserId: userId } }),
      this.prisma.storyManuscriptVersion.findFirst({
        where: { id: body.manuscriptVersionId, workId, ownerUserId: userId },
      }),
      this.prisma.storyAiRateCard.findUnique({ where: { id: body.rateCardId } }),
      body.analysisJobId
        ? this.prisma.storyAnalysisJob.findUnique({ where: { id: body.analysisJobId } })
        : null,
    ]);
    if (!work || !manuscript || !rateCard) {
      throw new NotFoundException('Story memory budget dependency not found');
    }
    if (rateCard.status !== 'active') {
      throw new ConflictException('An active rate card is required');
    }
    if (
      body.analysisJobId &&
      (!analysisJob || analysisJob.manuscriptVersionId !== manuscript.id)
    ) {
      throw new ConflictException('Analysis job does not match the manuscript');
    }
    const structured = manuscript.structuredBody as unknown as {
      parts?: Array<{ partKey?: string; paragraphs?: Array<{ text?: string }> }>;
    };
    const currentPart =
      structured.parts?.find((part) => part.partKey === body.scopeKey) ??
      structured.parts?.[0];
    const measuredCurrentPartCharacters = (currentPart?.paragraphs ?? []).reduce(
      (sum, paragraph) => sum + (paragraph.text?.length ?? 0),
      0,
    );
    const currentPartCharacters = measuredCurrentPartCharacters || 10_000;
    const tokens = estimateHierarchicalMemoryTokens({
      scopeType: body.scopeType,
      partCount: body.partCount,
      currentPartCharacters,
      relatedEvidenceCharacters: body.relatedEvidenceCharacters,
      outputTokenLimit: body.outputTokenLimit,
    });
    const estimatedCostKrw = calculateStoryUsageCost(this.rateNumbers(rateCard), {
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
    });
    const decision = storyBudgetDecision(
      estimatedCostKrw,
      body.warningBudgetKrw,
      body.hardBudgetKrw,
    );
    const run = await this.prisma.storyMemoryBudgetRun.create({
      data: {
        workId,
        manuscriptVersionId: manuscript.id,
        analysisJobId: body.analysisJobId,
        rateCardId: rateCard.id,
        scopeType: body.scopeType,
        scopeKey: body.scopeKey,
        partCount: body.partCount,
        estimatedInputTokens: tokens.inputTokens,
        estimatedOutputTokens: tokens.outputTokens,
        estimatedCostKrw,
        warningBudgetKrw: body.warningBudgetKrw,
        hardBudgetKrw: body.hardBudgetKrw,
        decision: decision.decision,
        reasonCode: decision.reasonCode,
        idempotencyKey: key,
      },
    });
    return this.memoryBudgetProjection(run, false);
  }

  async getStyleConsent(userId: string, workId: string) {
    await this.assertOwner(userId, workId);
    const consent = await this.prisma.storyStyleProfileConsent.findUnique({
      where: { workId },
    });
    return consent ? this.consentProjection(consent) : null;
  }

  async upsertStyleConsent(
    userId: string,
    workId: string,
    body: UpsertStoryStyleConsentDto,
  ) {
    await this.assertOwner(userId, workId);
    const [manuscript, existing] = await Promise.all([
      this.prisma.storyManuscriptVersion.findFirst({
        where: { id: body.manuscriptVersionId, workId, ownerUserId: userId },
      }),
      this.prisma.storyStyleProfileConsent.findUnique({ where: { workId } }),
    ]);
    if (!manuscript) throw new NotFoundException('Approved manuscript not found');
    if (!body.rightsConfirmed) {
      throw new BadRequestException('Rights confirmation is required');
    }
    if (existing && existing.revision !== body.expectedRevision) {
      throw new ConflictException('Style consent changed concurrently');
    }
    const startsAt = new Date(body.startsAt);
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (expiresAt && expiresAt <= startsAt) {
      throw new BadRequestException('Consent period is invalid');
    }
    const consent = await this.prisma.storyStyleProfileConsent.upsert({
      where: { workId },
      create: {
        workId,
        ownerUserId: userId,
        manuscriptVersionId: manuscript.id,
        status: 'active',
        rightsConfirmed: true,
        aiBranchAllowed: body.aiBranchAllowed,
        translationAllowed: body.translationAllowed,
        imageTransformationAllowed: body.imageTransformationAllowed,
        allowedLocales: body.allowedLocales,
        allowedRegions: body.allowedRegions,
        startsAt,
        expiresAt,
        publicClaim: STORY_AI_PUBLIC_CLAIM,
      },
      update: {
        manuscriptVersionId: manuscript.id,
        status: 'active',
        rightsConfirmed: true,
        aiBranchAllowed: body.aiBranchAllowed,
        translationAllowed: body.translationAllowed,
        imageTransformationAllowed: body.imageTransformationAllowed,
        allowedLocales: body.allowedLocales,
        allowedRegions: body.allowedRegions,
        startsAt,
        expiresAt,
        publicClaim: STORY_AI_PUBLIC_CLAIM,
        revision: { increment: 1 },
        withdrawnAt: null,
        deletionRequestedAt: null,
        deletedAt: null,
        updatedAt: new Date(),
      },
    });
    return this.consentProjection(consent);
  }

  async transitionStyleConsent(
    userId: string,
    workId: string,
    body: TransitionStoryStyleConsentDto,
  ) {
    await this.assertOwner(userId, workId);
    const consent = await this.prisma.storyStyleProfileConsent.findUnique({
      where: { workId },
    });
    if (!consent) throw new NotFoundException('Style consent not found');
    if (consent.revision !== body.expectedRevision) {
      throw new ConflictException('Style consent changed concurrently');
    }
    const allowedTransition =
      (consent.status === 'active' &&
        ['suspended', 'withdrawn'].includes(body.toStatus)) ||
      (consent.status === 'suspended' &&
        ['active', 'withdrawn'].includes(body.toStatus)) ||
      (consent.status === 'withdrawn' && body.toStatus === 'deletion_pending') ||
      (consent.status === 'deletion_pending' && body.toStatus === 'deleted');
    if (!allowedTransition) {
      throw new BadRequestException('Style consent transition is not allowed');
    }
    const now = new Date();
    const updated = await this.prisma.storyStyleProfileConsent.update({
      where: { id: consent.id },
      data: {
        status: body.toStatus,
        revision: { increment: 1 },
        withdrawnAt: body.toStatus === 'withdrawn' ? now : consent.withdrawnAt,
        deletionRequestedAt:
          body.toStatus === 'deletion_pending' ? now : consent.deletionRequestedAt,
        deletedAt: body.toStatus === 'deleted' ? now : null,
        updatedAt: now,
      },
    });
    if (body.toStatus === 'deleted') {
      await this.prisma.storyMemoryRecord.updateMany({
        where: { workId, memoryType: 'style' },
        data: { status: 'deleted' },
      });
    }
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        actorType: 'user',
        action: `story_style_consent.${body.toStatus}`,
        targetType: 'story_style_profile_consent',
        targetId: consent.id,
        metadata: { workId, beforeStatus: consent.status, afterStatus: body.toStatus },
      },
    });
    return this.consentProjection(updated);
  }

  async prepareCustomChoice(
    userId: string,
    context: CustomChoiceContext,
    normalizedInput: string,
  ): Promise<PreparedCustomChoice> {
    assertCustomChoiceReleasePolicy();
    if (
      context.work.priceLumina.isZero() ||
      !context.progress.activeReleaseId ||
      context.progress.status !== 'active'
    ) {
      this.customChoiceDenied();
    }
    const now = new Date();
    const [capability, entitlement, consent, choices] = await Promise.all([
      this.prisma.storyReleaseCapability.findUnique({
        where: { releaseId: context.progress.activeReleaseId! },
      }),
      this.prisma.userEntitlement.findFirst({
        where: {
          userId,
          entitlementType: { in: ['story_work', 'story_season', 'story_part'] },
          referenceId: { in: [context.work.id, context.part.id] },
          revokedAt: null,
          startsAt: { lte: now },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { id: true },
      }),
      this.activeStyleConsent(context.work.id, now),
      this.prisma.storyChoice.findMany({
        where: { sceneId: context.scene.id },
        orderBy: { position: 'asc' },
        take: 3,
        select: { id: true, label: true },
      }),
    ]);
    if (
      !capability ||
      capability.status !== 'active' ||
      context.progress.capabilityRevision !== capability.revision ||
      !capability.customChoiceEnabled ||
      !entitlement ||
      !consent ||
      !consent.aiBranchAllowed
    ) {
      this.customChoiceDenied();
    }
    if (normalizedInput.length > capability.customChoiceMaxLength) {
      throw new BadRequestException({
        code: 'STORY_CUSTOM_CHOICE_TOO_LONG',
        messageKey: 'story.progress.customChoice.rejected',
        retryable: true,
      });
    }
    const labels = choices.flatMap((choice) => localizedStrings(choice.label));
    if (duplicateFixedChoice(normalizedInput, labels)) {
      throw new BadRequestException({
        code: 'STORY_CUSTOM_CHOICE_DUPLICATES_FIXED_CHOICE',
        messageKey: 'story.progress.customChoice.rejected',
        retryable: true,
      });
    }
    const rateCard = await this.prisma.storyAiRateCard.findUnique({
      where: { id: context.progress.aiRateCardId ?? capability.rateCardId },
    });
    if (!rateCard || !['active', 'retired'].includes(rateCard.status)) {
      this.customChoiceDenied();
    }
    const [memory, history, scene] = await Promise.all([
      this.prisma.storyMemoryRecord.findMany({
        where: {
          workId: context.work.id,
          status: 'approved',
          memoryType: { in: ['entity', 'event', 'foreshadow', 'branch', 'style'] },
          ...(consent ? {} : { memoryType: { not: 'style' } }),
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, content: true },
        take: 50,
      }),
      this.prisma.storyChoiceEvent.findMany({
        where: { progressId: context.progress.id, invalidatedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
        take: 30,
      }),
      this.prisma.storyScene.findUnique({
        where: { id: context.scene.id },
        select: { title: true, visualManifest: true },
      }),
    ]);
    const contextCharacters =
      JSON.stringify(scene ?? {}).length +
      memory.reduce((sum, item) => sum + JSON.stringify(item.content).length, 0) +
      normalizedInput.length;
    const estimatedInputTokens = Math.min(
      capability.aiInputTokenLimit,
      Math.max(1, Math.ceil(contextCharacters / 4)),
    );
    const estimatedCostKrw = calculateStoryUsageCost(this.rateNumbers(rateCard), {
      inputTokens: estimatedInputTokens,
      outputTokens: capability.aiOutputTokenLimit,
    });
    if (estimatedCostKrw > Number(capability.hardBudgetKrw)) {
      throw new ForbiddenException({
        code: 'STORY_CUSTOM_CHOICE_BUDGET_EXCEEDED',
        messageKey: 'story.progress.customChoice.budgetExceeded',
        retryable: false,
      });
    }
    return {
      capability,
      rateCard,
      consent,
      estimatedInputTokens,
      estimatedCostKrw,
      memoryIds: memory.map((item) => item.id),
      choiceEventIds: history.map((item) => item.id),
    };
  }

  async requestCustomChoice(input: {
    userId: string;
    context: CustomChoiceContext;
    normalizedInput: string;
    contentHash: string;
    moderationDecision: string;
    idempotencyKey: string;
    prepared: PreparedCustomChoice;
  }) {
    assertCustomChoiceReleasePolicy();
    const result = await this.prisma.$transaction(async (tx) => {
      const progress = await tx.storyReaderProgress.findFirst({
        where: {
          id: input.context.progress.id,
          userId: input.userId,
          progressRevision: input.context.progress.progressRevision,
          status: 'active',
          activeReleaseId: input.prepared.capability.releaseId,
        },
      });
      if (!progress) throw new ConflictException('Story progress changed concurrently');
      const now = new Date();
      const [capability, consent, entitlement] = await Promise.all([
        tx.storyReleaseCapability.findUnique({
          where: { releaseId: input.prepared.capability.releaseId },
        }),
        tx.storyStyleProfileConsent.findFirst({
          where: {
            id: input.prepared.consent.id,
            workId: input.context.work.id,
            status: 'active',
            rightsConfirmed: true,
            aiBranchAllowed: true,
            startsAt: { lte: now },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        }),
        tx.userEntitlement.findFirst({
          where: {
            userId: input.userId,
            entitlementType: { in: ['story_work', 'story_season', 'story_part'] },
            referenceId: { in: [input.context.work.id, input.context.part.id] },
            revokedAt: null,
            startsAt: { lte: now },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          select: { id: true },
        }),
      ]);
      if (
        !capability ||
        capability.status !== 'active' ||
        capability.revision !== input.prepared.capability.revision ||
        !capability.customChoiceEnabled ||
        !consent ||
        !entitlement
      ) {
        throw new ForbiddenException('Story AI request authorization changed');
      }
      const previousFailedContinuation = await tx.storyAiContinuation.findFirst({
        where: {
          progressId: progress.id,
          status: { in: ['failed', 'timeout'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      const allowance = await tx.storyAiAllowanceBucket.upsert({
        where: {
          userId_releaseId: {
            userId: input.userId,
            releaseId: input.prepared.capability.releaseId,
          },
        },
        create: {
          userId: input.userId,
          workId: input.context.work.id,
          releaseId: input.prepared.capability.releaseId,
          includedLimit: input.prepared.capability.includedAiRouteCount,
        },
        update: {},
      });
      if (storyAllowanceRemaining(allowance) < 1) {
        throw new ForbiddenException({
          code: 'STORY_AI_ALLOWANCE_EXHAUSTED',
          messageKey: 'story.progress.customChoice.allowanceExhausted',
          retryable: false,
        });
      }
      const reserved = await tx.storyAiAllowanceBucket.updateMany({
        where: { id: allowance.id, revision: allowance.revision },
        data: {
          reservedCount: { increment: 1 },
          revision: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (reserved.count !== 1) {
        throw new ConflictException('Story AI allowance changed concurrently');
      }
      const customChoice = await tx.storyCustomChoice.create({
        data: {
          progressId: progress.id,
          userId: input.userId,
          workId: input.context.work.id,
          sceneId: input.context.scene.id,
          idempotencyKey: input.idempotencyKey,
          contentHash: input.contentHash,
          privateInput: input.normalizedInput,
          moderationDecision: input.moderationDecision,
          status: 'queued',
        },
      });
      const continuation = await tx.storyAiContinuation.create({
        data: {
          userId: input.userId,
          workId: input.context.work.id,
          releaseId: input.prepared.capability.releaseId,
          progressId: progress.id,
          customChoiceId: customChoice.id,
          rateCardId: input.prepared.rateCard.id,
          styleConsentId: input.prepared.consent.id,
          capabilityRevision: input.prepared.capability.revision,
          idempotencyKey: `continuation:${input.idempotencyKey}`,
          sourcePartId: input.context.part.id,
          sourceSceneId: input.context.scene.id,
          sourceProgressRevision: progress.progressRevision,
          checkpointSceneId: progress.checkpointSceneId,
          contextReferences: {
            sourceSceneId: input.context.scene.id,
            choiceEventIds: input.prepared.choiceEventIds,
            memoryIds: input.prepared.memoryIds,
            styleConsentRevision: input.prepared.consent.revision,
            fullManuscriptIncluded: false,
            privateInputIncluded: false,
          },
          estimatedCostKrw: input.prepared.estimatedCostKrw,
          hardBudgetKrw: input.prepared.capability.hardBudgetKrw,
          inputTokenLimit: input.prepared.capability.aiInputTokenLimit,
          outputTokenLimit: input.prepared.capability.aiOutputTokenLimit,
        },
      });
      await tx.storyAiUsageLedger.create({
        data: {
          continuationId: continuation.id,
          userId: input.userId,
          workId: input.context.work.id,
          releaseId: input.prepared.capability.releaseId,
          rateCardId: input.prepared.rateCard.id,
          eventKind: previousFailedContinuation
            ? 'retry_without_completion'
            : 'new_route_request',
          status: 'reserved',
          provider: input.prepared.rateCard.provider,
          model: input.prepared.rateCard.model,
          rateCardVersion: input.prepared.rateCard.version,
          inputTokens: input.prepared.estimatedInputTokens,
          outputTokens: input.prepared.capability.aiOutputTokenLimit,
          estimatedCostKrw: input.prepared.estimatedCostKrw,
          allowanceDelta: 0,
          progressApplied: false,
          provenance: 'ai_generated',
          idempotencyKey: `usage-request:${continuation.id}`,
        },
      });
      const progressUpdate = await tx.storyReaderProgress.updateMany({
        where: {
          id: progress.id,
          userId: input.userId,
          progressRevision: progress.progressRevision,
          status: 'active',
        },
        data: {
          status: 'ai_pending',
          progressRevision: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (progressUpdate.count !== 1) {
        throw new ConflictException('Story progress changed concurrently');
      }
      return { continuation, remaining: storyAllowanceRemaining(allowance) - 1 };
    });
    return this.continuationProjection(result.continuation, result.remaining, false);
  }

  async customChoiceReplay(userId: string, customChoice: any, contentHash: string) {
    assertCustomChoiceReleasePolicy();
    if (customChoice.userId !== userId || customChoice.contentHash !== contentHash) {
      throw new ConflictException('Custom choice idempotency conflict');
    }
    const continuation = await this.prisma.storyAiContinuation.findUnique({
      where: { customChoiceId: customChoice.id },
    });
    if (!continuation) {
      return {
        requestId: customChoice.id,
        status: customChoice.status,
        acceptedAt: customChoice.createdAt,
        privateInputReturned: false,
        idempotentReplay: true,
      };
    }
    const allowance = await this.prisma.storyAiAllowanceBucket.findUnique({
      where: {
        userId_releaseId: { userId, releaseId: continuation.releaseId },
      },
    });
    const rateCard = await this.prisma.storyAiRateCard.findUnique({
      where: { id: continuation.rateCardId },
    });
    if (rateCard) {
      await this.prisma.storyAiUsageLedger.upsert({
        where: {
          idempotencyKey: `usage-duplicate:${continuation.id}:${contentHash}`,
        },
        create: {
          continuationId: continuation.id,
          userId,
          workId: continuation.workId,
          releaseId: continuation.releaseId,
          rateCardId: rateCard.id,
          eventKind: 'duplicate_submission_blocked',
          status: 'blocked',
          provider: rateCard.provider,
          model: rateCard.model,
          rateCardVersion: rateCard.version,
          estimatedCostKrw: 0,
          actualCostKrw: 0,
          allowanceDelta: 0,
          progressApplied: false,
          provenance: 'ai_generated',
          idempotencyKey: `usage-duplicate:${continuation.id}:${contentHash}`,
        },
        update: {},
      });
    }
    return this.continuationProjection(
      continuation,
      allowance ? storyAllowanceRemaining(allowance) : 0,
      true,
    );
  }

  async continuationStatus(userId: string, progressId: string, continuationId: string) {
    if (!userId || !progressId || !continuationId) {
      throw new NotFoundException('Story AI continuation not found');
    }
    const continuation = await this.prisma.storyAiContinuation.findFirst({
      where: { id: continuationId, userId, progressId },
    });
    if (!continuation) throw new NotFoundException('Story AI continuation not found');
    const allowance = await this.prisma.storyAiAllowanceBucket.findUnique({
      where: {
        userId_releaseId: { userId, releaseId: continuation.releaseId },
      },
    });
    return this.continuationProjection(
      continuation,
      allowance ? storyAllowanceRemaining(allowance) : 0,
      false,
    );
  }

  async continuationExecutionAuthorization(claim: StoryContinuationClaim) {
    const continuation = await this.prisma.storyAiContinuation.findUnique({
      where: { id: claim.continuationId },
    });
    if (
      !continuation ||
      continuation.status !== 'processing' ||
      continuation.leaseToken !== claim.leaseToken ||
      continuation.requestKind !== 'recommended_choice'
    ) {
      return { allowed: false as const, code: 'stale_worker_lease' };
    }
    const now = new Date();
    const [work, release, capability, consent, rights, analysis, progress] = await Promise.all([
      this.prisma.storyWork.findUnique({ where: { id: continuation.workId } }),
      this.prisma.storyRelease.findUnique({ where: { id: continuation.releaseId } }),
      this.prisma.storyReleaseCapability.findUnique({
        where: { releaseId: continuation.releaseId },
      }),
      this.prisma.storyStyleProfileConsent.findUnique({
        where: { id: continuation.styleConsentId },
      }),
      continuation.rightsContractVersionId
        ? this.prisma.contentRightsContractVersion.findUnique({
            where: { id: continuation.rightsContractVersionId },
          })
        : Promise.resolve(null),
      continuation.analysisJobId && continuation.analysisVersion
        ? this.prisma.storyAnalysisJob.findFirst({
            where: {
              id: continuation.analysisJobId,
              workId: continuation.workId,
              manuscriptVersionId: continuation.manuscriptVersionId ?? undefined,
              analysisVersion: continuation.analysisVersion,
              status: 'completed',
            },
          })
        : Promise.resolve(null),
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
    ]);
    const legalActivation = await this.legalActivation?.authorize({
      workId: continuation.workId,
      releaseId: continuation.releaseId,
      manuscriptVersionId: continuation.manuscriptVersionId,
      rightsContractVersionId: continuation.rightsContractVersionId,
    });
    const allowed = Boolean(
      work?.status === 'published' &&
      Boolean(progress) &&
      legalActivation?.active &&
      Boolean(continuation.manuscriptVersionId) &&
      Boolean(continuation.analysisJobId) &&
      Boolean(continuation.analysisVersion) &&
      Boolean(continuation.rightsContractId) &&
      Boolean(continuation.rightsContractVersionId) &&
      work.activeReleaseId === continuation.releaseId &&
      release?.workId === continuation.workId &&
      release.status === 'active' &&
      release.manuscriptVersionId === continuation.manuscriptVersionId &&
      release.checksum === continuation.releaseChecksum &&
      capability?.status === 'active' &&
      capability.revision === continuation.capabilityRevision &&
      capability.rateCardId === continuation.rateCardId &&
      consent?.status === 'active' &&
      consent.rightsConfirmed &&
      consent.aiBranchAllowed &&
      consent.revision === continuation.styleConsentRevision &&
      consent.manuscriptVersionId === continuation.manuscriptVersionId &&
      consent.startsAt <= now &&
      (!consent.expiresAt || consent.expiresAt > now) &&
      jsonStringArray(consent.allowedLocales).includes(continuation.locale) &&
      analysis?.id === continuation.analysisJobId &&
      analysis.analysisVersion === continuation.analysisVersion &&
      rights?.contractId === continuation.rightsContractId &&
      rights.approvalState === 'approved_configuration' &&
      rights.aiTransformationAllowed &&
      rights.contentVersionId === continuation.manuscriptVersionId &&
      rights.effectiveFrom <= now &&
      rights.startsAt <= now &&
      (!rights.endsAt || rights.endsAt > now) &&
      jsonStringArray(rights.media).some((media) =>
        ['story', 'story_publication', 'all'].includes(media),
      )
    );
    return allowed
      ? { allowed: true as const }
      : { allowed: false as const, code: 'generation_authorization_changed' };
  }

  async settleClaimedContinuation(
    claim: StoryContinuationClaim,
    result: StoryContinuationProviderResult,
  ) {
    const continuation = await this.prisma.storyAiContinuation.findUnique({
      where: { id: claim.continuationId },
    });
    if (!continuation) throw new NotFoundException('Story AI continuation not found');
    const rateCard = await this.prisma.storyAiRateCard.findUnique({
      where: { id: continuation.rateCardId },
    });
    if (!rateCard) throw new ConflictException('Story AI rate card is unavailable');
    const actualCostKrw = calculateStoryUsageCost(this.rateNumbers(rateCard), result.usage);
    return this.settleContinuation(
      null,
      claim.continuationId,
      {
        status: 'completed',
        moderationDecision: 'allow',
        ...result.usage,
        actualCostKrw,
        resultTitle: result.title,
        resultBeats: result.beats,
        resultVisualManifest: result.visualManifest,
        nextChoices: result.nextChoices,
        ending: result.ending,
      },
      `worker:${claim.continuationId}:${claim.leaseToken}`,
      claim.leaseToken,
    );
  }

  async failClaimedContinuation(
    claim: StoryContinuationClaim,
    failureCode: string,
    status: 'failed' | 'timeout',
  ) {
    return this.settleContinuation(
      null,
      claim.continuationId,
      {
        status,
        moderationDecision: 'reject',
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        imageUnits: 0,
        failureCode: failureCode.slice(0, 80),
      },
      `worker:${claim.continuationId}:${claim.leaseToken}`,
      claim.leaseToken,
    );
  }

  async settleContinuation(
    adminUserId: string | null,
    continuationId: string,
    body: SettleStoryAiContinuationDto,
    idempotencyKey?: string,
    expectedLeaseToken?: string,
  ) {
    const key = this.idempotencyKey('story-ai-settlement', idempotencyKey);
    const replay = await this.prisma.storyAiUsageLedger.findUnique({
      where: { idempotencyKey: key },
    });
    if (replay) {
      const continuation = await this.prisma.storyAiContinuation.findUnique({
        where: { id: replay.continuationId },
      });
      if (!continuation || continuation.id !== continuationId) {
        throw new ConflictException('Settlement idempotency conflict');
      }
      return this.settlementProjection(continuation, true);
    }
    return this.prisma.$transaction(async (tx) => {
      const continuation = await tx.storyAiContinuation.findUnique({
        where: { id: continuationId },
      });
      if (!continuation) throw new NotFoundException('Story AI continuation not found');
      if (!['queued', 'processing'].includes(continuation.status)) {
        throw new ConflictException('Story AI continuation is already terminal');
      }
      if (expectedLeaseToken && (
        continuation.status !== 'processing' ||
        continuation.leaseToken !== expectedLeaseToken ||
        !continuation.leaseExpiresAt ||
        continuation.leaseExpiresAt <= new Date()
      )) {
        throw new ConflictException('Story AI continuation lease is stale');
      }
      const [rateCard, allowance, progress, sourceScene, consent, release, capability, rightsVersion, work, analysis] = await Promise.all([
        tx.storyAiRateCard.findUnique({ where: { id: continuation.rateCardId } }),
        tx.storyAiAllowanceBucket.findUnique({
          where: {
            userId_releaseId: {
              userId: continuation.userId,
              releaseId: continuation.releaseId,
            },
          },
        }),
        tx.storyReaderProgress.findUnique({ where: { id: continuation.progressId } }),
        continuation.sourceSceneId
          ? tx.storyScene.findUnique({ where: { id: continuation.sourceSceneId } })
          : tx.storyAiGeneratedScene.findFirst({
              where: {
                id: continuation.sourceGeneratedSceneId ?? undefined,
                userId: continuation.userId,
                workId: continuation.workId,
                releaseId: continuation.releaseId,
                progressId: continuation.progressId,
                status: 'ready',
              },
            }),
        tx.storyStyleProfileConsent.findUnique({
          where: { id: continuation.styleConsentId },
        }),
        tx.storyRelease.findUnique({ where: { id: continuation.releaseId } }),
        tx.storyReleaseCapability.findUnique({ where: { releaseId: continuation.releaseId } }),
        continuation.rightsContractVersionId
          ? tx.contentRightsContractVersion.findUnique({
              where: { id: continuation.rightsContractVersionId },
            })
          : Promise.resolve(null),
        tx.storyWork.findUnique({ where: { id: continuation.workId } }),
        continuation.analysisJobId && continuation.analysisVersion
          ? tx.storyAnalysisJob.findFirst({
              where: {
                id: continuation.analysisJobId,
                workId: continuation.workId,
                manuscriptVersionId: continuation.manuscriptVersionId ?? undefined,
                analysisVersion: continuation.analysisVersion,
                status: 'completed',
              },
            })
          : Promise.resolve(null),
      ]);
      if (!rateCard || !allowance || !progress || !sourceScene || !consent || !release || !capability || !work) {
        throw new ConflictException('Story AI continuation dependency is unavailable');
      }
      const legalActivation = await this.legalActivation?.authorize({
        workId: continuation.workId,
        releaseId: continuation.releaseId,
        manuscriptVersionId: continuation.manuscriptVersionId,
        rightsContractVersionId: continuation.rightsContractVersionId,
      });
      const calculatedCost = calculateStoryUsageCost(this.rateNumbers(rateCard), {
        inputTokens: body.inputTokens,
        outputTokens: body.outputTokens,
        cachedInputTokens: body.cachedInputTokens,
        imageUnits: body.imageUnits,
      });
      if (
        body.status === 'completed' &&
        body.actualCostKrw === undefined
      ) {
        throw new BadRequestException('Completed continuation requires measured cost');
      }
      if (
        body.actualCostKrw !== undefined &&
        Math.abs(calculatedCost - body.actualCostKrw) > 0.01
      ) {
        throw new BadRequestException('Measured usage cost does not match the rate card');
      }
      let finalStatus = body.status;
      let failureCode = body.failureCode ?? null;
      const consentActive =
        consent.status === 'active' &&
        consent.rightsConfirmed &&
        consent.aiBranchAllowed &&
        consent.startsAt <= new Date() &&
        (!consent.expiresAt || consent.expiresAt > new Date());
      const recommendedPinsActive =
        continuation.requestKind !== 'recommended_choice' || (
          work.status === 'published' &&
          Boolean(continuation.manuscriptVersionId) &&
          Boolean(continuation.analysisJobId) &&
          Boolean(continuation.analysisVersion) &&
          Boolean(continuation.rightsContractId) &&
          Boolean(continuation.rightsContractVersionId) &&
          work.activeReleaseId === continuation.releaseId &&
          release.workId === continuation.workId &&
          release.status === 'active' &&
          release.manuscriptVersionId === continuation.manuscriptVersionId &&
          release.checksum === continuation.releaseChecksum &&
          capability.status === 'active' &&
          capability.revision === continuation.capabilityRevision &&
          capability.rateCardId === continuation.rateCardId &&
          capability.includedAiRouteCount > 0 &&
          allowance.workId === continuation.workId &&
          progress.userId === continuation.userId &&
          progress.workId === continuation.workId &&
          progress.activeReleaseId === continuation.releaseId &&
          (progress.currentSceneId ?? null) === continuation.sourceSceneId &&
          (progress.currentGeneratedSceneId ?? null) === continuation.sourceGeneratedSceneId &&
          legalActivation?.active &&
          consent.revision === continuation.styleConsentRevision &&
          consent.manuscriptVersionId === continuation.manuscriptVersionId &&
          analysis?.id === continuation.analysisJobId &&
          analysis.analysisVersion === continuation.analysisVersion &&
          rightsVersion?.contractId === continuation.rightsContractId &&
          rightsVersion.approvalState === 'approved_configuration' &&
          rightsVersion.aiTransformationAllowed &&
          rightsVersion.contentVersionId === continuation.manuscriptVersionId &&
          rightsVersion.effectiveFrom <= new Date() &&
          rightsVersion.startsAt <= new Date() &&
          (!rightsVersion.endsAt || rightsVersion.endsAt > new Date()) &&
          jsonStringArray(rightsVersion.media).some((media) =>
            ['story', 'story_publication', 'all'].includes(media),
          )
        );
      if (finalStatus === 'completed' && !consentActive) {
        finalStatus = 'failed';
        failureCode = 'style_consent_inactive';
      }
      if (finalStatus === 'completed' && !recommendedPinsActive) {
        finalStatus = 'failed';
        failureCode = 'generation_authorization_changed';
      }
      if (finalStatus === 'completed' && body.moderationDecision !== 'allow') {
        finalStatus = 'failed';
        failureCode = 'generated_output_moderation_rejected';
      }
      if (
        finalStatus === 'completed' &&
        (body.inputTokens > continuation.inputTokenLimit ||
          body.outputTokens > continuation.outputTokenLimit)
      ) {
        finalStatus = 'failed';
        failureCode = 'token_budget_exceeded';
      }
      if (
        finalStatus === 'completed' &&
        body.actualCostKrw! > Number(continuation.hardBudgetKrw)
      ) {
        finalStatus = 'failed';
        failureCode = 'hard_budget_exceeded';
      }
      if (finalStatus === 'completed' && (!body.resultTitle || !body.resultBeats?.length)) {
        throw new BadRequestException('Completed continuation requires a sanitized result');
      }
      const generatedSceneKey = `ai-${continuation.id}`;
      let sanitizedVisualManifest: Prisma.InputJsonValue | undefined;
      if (finalStatus === 'completed' && continuation.requestKind === 'recommended_choice') {
        assertRecommendedContinuationOutput(body, generatedSceneKey);
        sanitizedVisualManifest = sanitizeRecommendedVisualManifest(
          body.resultVisualManifest!,
          generatedSceneKey,
        );
      }
      let resultGeneratedSceneId: string | null = null;
      let resultChecksum: string | null = null;
      if (finalStatus === 'completed') {
        if (
          progress.status !== 'ai_pending' ||
          progress.progressRevision !== continuation.sourceProgressRevision + 1
        ) {
          throw new ConflictException('Pending story progress changed concurrently');
        }
        resultChecksum = createHash('sha256').update(stableJson({
          title: body.resultTitle,
          beats: body.resultBeats,
          visualManifest: sanitizedVisualManifest ?? body.resultVisualManifest,
          nextChoices: body.nextChoices ?? [],
          ending: body.ending ?? null,
        })).digest('hex');
        const scene = await tx.storyAiGeneratedScene.create({
          data: {
            continuationId: continuation.id,
            userId: continuation.userId,
            workId: continuation.workId,
            releaseId: continuation.releaseId,
            progressId: continuation.progressId,
            sourcePartId: continuation.sourcePartId,
            sceneKey: generatedSceneKey,
            resultChecksum,
            provenance: 'ai_generated',
            title: body.resultTitle!,
            visualManifest: sanitizedVisualManifest ?? (body.resultVisualManifest ?? {
              provenance: 'ai_generated',
            }) as Prisma.InputJsonValue,
            endingType: body.ending ? 'ai_generated' : null,
            status: 'ready',
          },
        });
        for (const [index, beat] of body.resultBeats!.entries()) {
          await tx.storyAiGeneratedBeat.create({
            data: {
              sceneId: scene.id,
              position: index + 1,
              beatType: beat.beatType,
              content: beat.content,
            },
          });
        }
        for (const [index, choice] of (body.nextChoices ?? []).entries()) {
          await tx.storyAiGeneratedChoice.create({
            data: {
              sceneId: scene.id,
              choiceKey: choice.choiceKey.trim(),
              position: index + 1,
              label: choice.label,
              routeKind: 'generation_required',
            },
          });
        }
        const path = jsonRecordArray(progress.pathSummary);
        const nextPath = boundedPath([
          ...path,
          {
            sourceSceneId: continuation.sourceSceneId,
            sourceGeneratedSceneId: continuation.sourceGeneratedSceneId,
            choiceId: continuation.recommendedChoiceId ?? continuation.generatedChoiceId,
            generatedSceneId: scene.id,
            provenance: 'ai_generated',
          },
        ]);
        if (continuation.recommendedChoiceId) {
          await tx.storyChoiceEvent.create({
            data: {
              progressId: progress.id,
              sceneId: continuation.sourceSceneId!,
              choiceId: continuation.recommendedChoiceId,
              targetSceneId: null,
              endingKey: body.ending?.endingKey,
              endingType: body.ending ? 'ai_generated' : null,
              explicitRejoin: false,
            },
          });
        }
        if (body.ending) {
          await tx.storyEndingDiscovery.upsert({
            where: {
              userId_releaseId_endingKey_pathSignature: {
                userId: continuation.userId,
                releaseId: continuation.releaseId,
                endingKey: body.ending.endingKey,
                pathSignature: createHash('sha256').update(stableJson(nextPath)).digest('hex'),
              },
            },
            create: {
              userId: continuation.userId,
              workId: continuation.workId,
              releaseId: continuation.releaseId,
              endingKey: body.ending.endingKey,
              endingKind: 'ai_generated',
              pathSignature: createHash('sha256').update(stableJson(nextPath)).digest('hex'),
              provenance: 'ai_generated',
            },
            update: { lastSeenAt: new Date() },
          });
        }
        const progressUpdate = await tx.storyReaderProgress.updateMany({
          where: {
            id: progress.id,
            userId: continuation.userId,
            workId: continuation.workId,
            activeReleaseId: continuation.releaseId,
            currentSceneId: continuation.sourceSceneId,
            currentGeneratedSceneId: continuation.sourceGeneratedSceneId,
            progressRevision: progress.progressRevision,
            status: 'ai_pending',
          },
          data: {
            currentSceneId: null,
            currentGeneratedSceneId: body.ending ? null : scene.id,
            currentBeatPosition: 0,
            status: body.ending ? 'completed' : 'active',
            progressRevision: { increment: 1 },
            pathSummary: nextPath as Prisma.InputJsonValue,
            visitedEndingKeys: body.ending
              ? [...new Set([
                  ...jsonStringArray(progress.visitedEndingKeys),
                  body.ending.endingKey,
                ])]
              : undefined,
            updatedAt: new Date(),
          },
        });
        if (progressUpdate.count !== 1) {
          throw new ConflictException('Pending story progress changed concurrently');
        }
        resultGeneratedSceneId = scene.id;
      } else {
        const restored = await tx.storyReaderProgress.updateMany({
          where: {
            id: progress.id,
            status: 'ai_pending',
            ...(continuation.requestKind === 'recommended_choice'
              ? {
                  userId: continuation.userId,
                  workId: continuation.workId,
                   activeReleaseId: continuation.releaseId,
                   currentSceneId: continuation.sourceSceneId,
                   currentGeneratedSceneId: continuation.sourceGeneratedSceneId,
                   progressRevision: continuation.sourceProgressRevision + 1,
                }
              : {}),
          },
          data: {
            currentSceneId: continuation.sourceSceneId,
            currentGeneratedSceneId: continuation.sourceGeneratedSceneId,
            currentBeatPosition: 0,
            status: 'active',
            progressRevision: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        if (restored.count !== 1) {
          throw new ConflictException('Pending story progress changed concurrently');
        }
      }
      if (continuation.sharedResultId) {
        const sharedResult = await tx.storyAiReusableResult.findUnique({
          where: { id: continuation.sharedResultId },
        });
        const contextReferences = jsonRecord(continuation.contextReferences);
        const sharedClaimToken = typeof contextReferences.sharedClaimToken === 'string'
          ? contextReferences.sharedClaimToken
          : null;
        if (
          !sharedResult ||
          sharedResult.status !== 'pending' ||
          sharedResult.reuseKey !== continuation.reuseKey ||
          !sharedClaimToken ||
          sharedResult.claimToken !== sharedClaimToken
        ) {
          throw new ConflictException('Shared result claim changed concurrently');
        }
        let reusableApproval: Awaited<ReturnType<StoryReusableResultApprovalGate['evaluate']>> | null = null;
        if (
          finalStatus === 'completed' &&
          continuation.requestKind === 'recommended_choice' &&
          rightsVersion?.generatedResultReuseAllowed &&
          legalActivation?.active &&
          resultChecksum
        ) {
          reusableApproval = await this.reusableApproval?.evaluate({
            workId: continuation.workId,
            releaseId: continuation.releaseId,
            releaseChecksum: continuation.releaseChecksum!,
            manuscriptVersionId: continuation.manuscriptVersionId!,
            rightsContractVersionId: continuation.rightsContractVersionId!,
            resultChecksum,
          }) ?? null;
        }
        const approvalSnapshot = reusableApproval?.snapshot;
        const approve = Boolean(
          reusableApproval?.eligible &&
          approvalSnapshot &&
          approvalSnapshot.rightsActivationKey === sharedResult.rightsActivationKey &&
          approvalSnapshot.moderationPolicyVersion === sharedResult.moderationPolicyVersion &&
          approvalSnapshot.moderationEvidenceVersion === sharedResult.moderationEvidenceVersion &&
          approvalSnapshot.qualityPolicyVersion === sharedResult.qualityPolicyVersion,
        );
        if (approve) {
          for (const [index, beat] of body.resultBeats!.entries()) {
            await tx.storyAiReusableBeat.create({
              data: {
                sharedResultId: sharedResult.id,
                position: index + 1,
                beatType: beat.beatType,
                content: beat.content,
              },
            });
          }
          for (const [index, choice] of (body.nextChoices ?? []).entries()) {
            await tx.storyAiReusableChoice.create({
              data: {
                sharedResultId: sharedResult.id,
                position: index + 1,
                choiceKey: choice.choiceKey.trim(),
                label: choice.label,
              },
            });
          }
          const approved = await tx.storyAiReusableResult.updateMany({
            where: {
              id: sharedResult.id,
              status: 'pending',
              claimToken: sharedClaimToken,
            },
            data: {
              status: 'approved',
              claimToken: null,
              resultChecksum,
              title: body.resultTitle!,
              visualManifest: (sanitizedVisualManifest ?? body.resultVisualManifest!) as Prisma.InputJsonValue,
              endingKey: body.ending?.endingKey ?? null,
              approvedAt: new Date(),
              updatedAt: new Date(),
            },
          });
          if (approved.count !== 1) {
            throw new ConflictException('Shared result claim changed concurrently');
          }
          await tx.storyAiGeneratedScene.update({
            where: { id: resultGeneratedSceneId! },
            data: { sharedResultId: sharedResult.id },
          });
          await tx.auditEvent.create({
            data: {
              actorUserId: adminUserId,
              actorType: adminUserId ? 'admin' : 'system',
              action: 'story_ai_reusable_result.approve',
              targetType: 'story_ai_reusable_result',
              targetId: sharedResult.id,
              metadata: {
                resultChecksum,
                evidenceVersionsMatched: true,
                privateContextStored: false,
              },
            },
          });
        } else if (finalStatus === 'completed') {
          const revoked = await tx.storyAiReusableResult.updateMany({
            where: {
              id: sharedResult.id,
              status: 'pending',
              claimToken: sharedClaimToken,
            },
            data: {
              status: 'revoked',
              claimToken: null,
              revokedAt: new Date(),
              revokeReason: reusableApproval?.reason ?? failureCode ?? 'reuse_evidence_unavailable',
              updatedAt: new Date(),
            },
          });
          if (revoked.count !== 1) {
            throw new ConflictException('Shared result claim changed concurrently');
          }
        } else {
          const released = await tx.storyAiReusableResult.updateMany({
            where: {
              id: sharedResult.id,
              status: 'pending',
              claimToken: sharedClaimToken,
            },
            data: { claimToken: null, updatedAt: new Date() },
          });
          if (released.count !== 1) {
            throw new ConflictException('Shared result claim changed concurrently');
          }
        }
      }
      const allowanceUpdate = await tx.storyAiAllowanceBucket.updateMany({
        where: {
          id: allowance.id,
          revision: allowance.revision,
          reservedCount: { gt: 0 },
        },
        data: {
          reservedCount: { decrement: 1 },
          consumedCount: finalStatus === 'completed' ? { increment: 1 } : undefined,
          revision: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (allowanceUpdate.count !== 1) {
        throw new ConflictException('Story AI allowance changed concurrently');
      }
      const completed = await tx.storyAiContinuation.update({
        where: { id: continuation.id },
        data: {
          status: finalStatus,
          failureCode,
          resultSceneId: null,
          resultGeneratedSceneId,
          actualCostKrw: body.actualCostKrw ?? null,
          leaseToken: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: new Date(),
        },
      });
      if (continuation.customChoiceId) {
        await tx.storyCustomChoice.update({
          where: { id: continuation.customChoiceId },
          data: { status: finalStatus },
        });
      }
      await tx.storyAiUsageLedger.create({
        data: {
          continuationId: continuation.id,
          userId: continuation.userId,
          workId: continuation.workId,
          releaseId: continuation.releaseId,
          rateCardId: rateCard.id,
          eventKind:
            finalStatus === 'completed'
              ? 'new_route_completed'
              : finalStatus === 'timeout'
                ? 'new_route_timeout'
                : 'new_route_failed',
          status: finalStatus,
          provider: rateCard.provider,
          model: rateCard.model,
          rateCardVersion: rateCard.version,
          inputTokens: body.inputTokens,
          outputTokens: body.outputTokens,
          cachedInputTokens: body.cachedInputTokens,
          imageUnits: body.imageUnits,
          estimatedCostKrw: continuation.estimatedCostKrw,
          actualCostKrw: body.actualCostKrw ?? null,
          allowanceDelta: finalStatus === 'completed' ? -1 : 0,
          progressApplied: finalStatus === 'completed',
          provenance: 'ai_generated',
          idempotencyKey: key,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: adminUserId,
          actorType: adminUserId ? 'admin' : 'system',
          action: 'story_ai_continuation.settle',
          targetType: 'story_ai_continuation',
          targetId: continuation.id,
          metadata: {
            status: finalStatus,
            progressApplied: finalStatus === 'completed',
            allowanceConsumed: finalStatus === 'completed',
            rateCardVersion: rateCard.version,
          },
        },
      });
      return this.settlementProjection(completed, false);
    });
  }

  async compensateContinuation(
    adminUserId: string,
    continuationId: string,
    reasonValue: string,
    idempotencyKey?: string,
  ) {
    const key = this.idempotencyKey('story-ai-compensation', idempotencyKey);
    const reason = reasonValue.trim();
    if (!reason) throw new BadRequestException('Compensation reason is required');
    const replay = await this.prisma.storyAiUsageLedger.findUnique({
      where: { idempotencyKey: key },
    });
    if (replay) {
      if (replay.continuationId !== continuationId) {
        throw new ConflictException('Compensation idempotency conflict');
      }
      return { continuationId, compensated: true, idempotentReplay: true };
    }
    return this.prisma.$transaction(async (tx) => {
      const continuation = await tx.storyAiContinuation.findUnique({
        where: { id: continuationId },
      });
      if (!continuation || continuation.status !== 'completed') {
        throw new ConflictException('Only completed usage can be compensated');
      }
      const [allowance, rateCard] = await Promise.all([
        tx.storyAiAllowanceBucket.findUnique({
          where: {
            userId_releaseId: {
              userId: continuation.userId,
              releaseId: continuation.releaseId,
            },
          },
        }),
        tx.storyAiRateCard.findUnique({ where: { id: continuation.rateCardId } }),
      ]);
      if (!allowance || !rateCard) {
        throw new ConflictException('Compensation dependency is unavailable');
      }
      const updated = await tx.storyAiAllowanceBucket.updateMany({
        where: { id: allowance.id, revision: allowance.revision },
        data: {
          compensatedCount: { increment: 1 },
          revision: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Story AI allowance changed concurrently');
      }
      await tx.storyAiUsageLedger.create({
        data: {
          continuationId: continuation.id,
          userId: continuation.userId,
          workId: continuation.workId,
          releaseId: continuation.releaseId,
          rateCardId: rateCard.id,
          eventKind: 'approved_compensation',
          status: 'compensated',
          provider: rateCard.provider,
          model: rateCard.model,
          rateCardVersion: rateCard.version,
          estimatedCostKrw: continuation.estimatedCostKrw,
          actualCostKrw: continuation.actualCostKrw,
          allowanceDelta: 1,
          progressApplied: false,
          provenance: 'ai_generated',
          idempotencyKey: key,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: adminUserId,
          actorType: 'admin',
          action: 'story_ai_allowance.compensate',
          targetType: 'story_ai_continuation',
          targetId: continuation.id,
          metadata: { reason, allowanceRestored: 1 },
        },
      });
      return { continuationId, compensated: true, idempotentReplay: false };
    });
  }

  async readerCapability(userId: string, workId: string) {
    const work = await this.prisma.storyWork.findFirst({
      where: {
        id: workId,
        status: 'published',
        fixtureSource: false,
        activeReleaseId: { not: null },
        publishedAt: { lte: new Date() },
      },
    });
    if (
      !work ||
      !isPublicStorySourceSafe({
        fixtureSource: work.fixtureSource,
        slug: work.slug,
        manifest: work.coverManifest,
      })
    ) {
      throw new NotFoundException('Published story not found');
    }
    const [activeRelease, capability] = await Promise.all([
      this.prisma.storyRelease.findFirst({
        where: { id: work.activeReleaseId!, workId: work.id, status: 'active' },
        select: { id: true },
      }),
      this.prisma.storyReleaseCapability.findUnique({
        where: { releaseId: work.activeReleaseId! },
      }),
    ]);
    if (!activeRelease) throw new NotFoundException('Published story not found');
    if (!capability || capability.status !== 'active') {
      return this.failClosedCapability();
    }
    const allowance = await this.prisma.storyAiAllowanceBucket.findUnique({
      where: { userId_releaseId: { userId, releaseId: capability.releaseId } },
    });
    return {
      ...this.capabilityProjection(capability),
      aiAllowanceRemaining: allowance
        ? storyAllowanceRemaining(allowance)
        : capability.includedAiRouteCount,
    };
  }

  async releaseSessionPin(releaseId: string) {
    const capability = await this.prisma.storyReleaseCapability.findUnique({
      where: { releaseId },
    });
    if (!capability || capability.status !== 'active') return null;
    return {
      aiRateCardId: capability.rateCardId,
      capabilityRevision: capability.revision,
    };
  }

  async capabilityByRelease(releaseId: string | null | undefined) {
    if (!releaseId) return null;
    const capability = await this.prisma.storyReleaseCapability.findUnique({
      where: { releaseId },
    });
    return capability?.status === 'active' ? capability : null;
  }

  async publicCapabilityByRelease(releaseId: string | null | undefined) {
    const capability = await this.capabilityByRelease(releaseId);
    return capability
      ? this.capabilityProjection(capability)
      : this.failClosedCapability();
  }

  async assertReleasePublishableTx(
    tx: Prisma.TransactionClient,
    work: { id: string; priceLumina: { isZero(): boolean } },
    release: { id: string },
  ) {
    const [capability, rateCard] = await Promise.all([
      tx.storyReleaseCapability.findUnique({ where: { releaseId: release.id } }),
      tx.storyReleaseCapability
        .findUnique({ where: { releaseId: release.id }, select: { rateCardId: true } })
        .then((value) =>
          value
            ? tx.storyAiRateCard.findUnique({ where: { id: value.rateCardId } })
            : null,
        ),
    ]);
    if (!capability || capability.status !== 'active' || rateCard?.status !== 'active') {
      throw new ConflictException('Valid release capability and rate card are required');
    }
    const errors = validateStoryReleaseCapability({
      freeStory: work.priceLumina.isZero(),
      fixedChoiceCount: capability.fixedChoiceCount,
      customChoiceEnabled: capability.customChoiceEnabled,
      customChoiceMaxLength: capability.customChoiceMaxLength,
      fullResetLimit: capability.fullResetLimit,
      actResetLimit: capability.actResetLimit,
      includedAiRouteCount: capability.includedAiRouteCount,
      aiInputTokenLimit: capability.aiInputTokenLimit,
      aiOutputTokenLimit: capability.aiOutputTokenLimit,
      warningBudgetKrw: Number(capability.warningBudgetKrw),
      hardBudgetKrw: Number(capability.hardBudgetKrw),
    });
    if (errors.length) throw new ConflictException('Release capability validation failed');
  }

  async activeStyleConsent(workId: string, at = new Date()) {
    return this.prisma.storyStyleProfileConsent.findFirst({
      where: {
        workId,
        status: 'active',
        rightsConfirmed: true,
        startsAt: { lte: at },
        OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
      },
    });
  }

  private async assertOwner(userId: string, workId: string) {
    const work = await this.prisma.storyWork.findFirst({
      where: { id: workId, ownerUserId: userId },
      select: { id: true },
    });
    if (!work) throw new NotFoundException('Story work not found');
  }

  private rateNumbers(rateCard: any) {
    return {
      inputCostPerMillion: Number(rateCard.inputCostPerMillion),
      outputCostPerMillion: Number(rateCard.outputCostPerMillion),
      cachedInputCostPerMillion: Number(rateCard.cachedInputCostPerMillion),
      imageUnitCost: Number(rateCard.imageUnitCost),
    };
  }

  private rateCardProjection(rateCard: any, idempotentReplay: boolean) {
    return {
      id: rateCard.id,
      version: rateCard.version,
      provider: rateCard.provider,
      model: rateCard.model,
      status: rateCard.status,
      currencyCode: rateCard.currencyCode,
      effectiveAt: rateCard.effectiveAt,
      retiredAt: rateCard.retiredAt,
      idempotentReplay,
    };
  }

  private capabilityProjection(capability: any) {
    return {
      configStatus: capability.status,
      ...firstReleaseChoiceCapability(),
      aiGenerationEnabled:
        capability.status === 'active' &&
        capability.aiInputTokenLimit > 0 && capability.aiOutputTokenLimit > 0,
      resetPolicy: {
        fullLimit: capability.fullResetLimit,
        actLimit: capability.actResetLimit,
      },
      aiBudget: {
        inputTokenLimit: capability.aiInputTokenLimit,
        outputTokenLimit: capability.aiOutputTokenLimit,
      },
      revision: capability.revision,
      source: 'active_release_capability',
    };
  }

  private failClosedCapability() {
    return {
      configStatus: 'missing_or_invalid',
      ...firstReleaseChoiceCapability(),
      aiGenerationEnabled: false,
      resetPolicy: { fullLimit: 0, actLimit: 0 },
      aiBudget: null,
      aiAllowanceRemaining: 0,
      revision: null,
      source: 'fail_closed',
    };
  }

  private consentProjection(consent: any) {
    return {
      status: consent.status,
      rightsConfirmed: consent.rightsConfirmed,
      scopes: {
        aiBranch: consent.aiBranchAllowed,
        translation: consent.translationAllowed,
        imageTransformation: consent.imageTransformationAllowed,
      },
      allowedLocales: consent.allowedLocales,
      allowedRegions: consent.allowedRegions,
      startsAt: consent.startsAt,
      expiresAt: consent.expiresAt,
      publicClaim: STORY_AI_PUBLIC_CLAIM,
      revision: consent.revision,
      withdrawnAt: consent.withdrawnAt,
      deletionRequestedAt: consent.deletionRequestedAt,
      deletedAt: consent.deletedAt,
    };
  }

  private memoryBudgetProjection(run: any, idempotentReplay: boolean) {
    return {
      runId: run.id,
      scopeType: run.scopeType,
      scopeKey: run.scopeKey,
      partCount: run.partCount,
      estimatedInputTokens: run.estimatedInputTokens,
      estimatedOutputTokens: run.estimatedOutputTokens,
      estimatedCostKrw: run.estimatedCostKrw.toString(),
      decision: run.decision,
      reasonCode: run.reasonCode,
      fullManuscriptResent: false,
      idempotentReplay,
    };
  }

  private async recommendedChoiceReplayForClient(
    client: RecommendedChoiceReplayClient,
    scope: RecommendedChoiceReplayScope,
    key: string,
  ) {
    const continuation = await client.storyAiContinuation.findUnique({
      where: { idempotencyKey: key },
    });
    if (!continuation) return null;
    if (
      continuation.requestKind !== 'recommended_choice' ||
      continuation.userId !== scope.userId ||
      continuation.progressId !== scope.progressId ||
      (continuation.recommendedChoiceId ?? continuation.generatedChoiceId) !== scope.choiceId ||
      continuation.sourceProgressRevision !== scope.expectedRevision ||
      continuation.locale !== normalizeRecommendedChoiceLocale(scope.locale)
    ) {
      throw new ConflictException('Recommended choice idempotency conflict');
    }
    const allowance = await client.storyAiAllowanceBucket.findUnique({
      where: {
        userId_releaseId: {
            userId: scope.userId,
            releaseId: continuation.releaseId,
          },
        },
      });
    return this.continuationProjection(
      continuation,
      allowance ? storyAllowanceRemaining(allowance) : 0,
      true,
    );
  }

  private async applyReusableResultTx(
    tx: Prisma.TransactionClient,
    prepared: {
      input: RecommendedChoiceRequest;
      key: string;
      capability: any;
      rateCard: any;
      consent: any;
      analysis: any;
      rightsContractId: string;
      rights: any;
      contextFingerprint: string;
      reusableContextFingerprint: string;
      reuseKey: string;
      sourceHash: string;
      pathHash: string;
      executionFingerprint: string;
      sharedResult: any;
    },
  ) {
    const { input, sharedResult } = prepared;
    const [beats, choices, allowance] = await Promise.all([
      tx.storyAiReusableBeat.findMany({
        where: { sharedResultId: sharedResult.id },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      }),
      tx.storyAiReusableChoice.findMany({
        where: { sharedResultId: sharedResult.id },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      }),
      tx.storyAiAllowanceBucket.findUnique({
        where: { userId_releaseId: { userId: input.userId, releaseId: input.release.id } },
      }),
    ]);
    if (
      sharedResult.status !== 'approved' ||
      sharedResult.workId !== input.work.id ||
      sharedResult.releaseId !== input.release.id ||
      sharedResult.releaseChecksum !== input.release.checksum ||
      !sharedResult.resultChecksum ||
      !sharedResult.title ||
      !sharedResult.visualManifest ||
      beats.length < 1 || beats.length > 40 ||
      choices.length > 3 ||
      ((choices.length > 0) === Boolean(sharedResult.endingKey))
    ) {
      throw new ConflictException('Approved shared story result is incomplete');
    }
    const now = new Date();
    const continuation = await tx.storyAiContinuation.create({
      data: {
        userId: input.userId,
        workId: input.work.id,
        releaseId: input.release.id,
        progressId: input.progress.id,
        requestKind: 'recommended_choice',
        customChoiceId: null,
        recommendedChoiceId: input.sourceKind === 'canonical' ? input.choice.id : null,
        generatedChoiceId: input.sourceKind === 'generated' ? input.choice.id : null,
        rateCardId: prepared.rateCard.id,
        styleConsentId: prepared.consent.id,
        styleConsentRevision: prepared.consent.revision,
        capabilityRevision: prepared.capability.revision,
        idempotencyKey: prepared.key,
        sourcePartId: input.part.id,
        sourceSceneId: input.sourceKind === 'canonical' ? input.scene.id : null,
        sourceGeneratedSceneId: input.sourceKind === 'generated' ? input.scene.id : null,
        sourceProgressRevision: input.progress.progressRevision,
        checkpointSceneId: input.progress.checkpointSceneId,
        manuscriptVersionId: input.release.manuscriptVersionId,
        analysisJobId: prepared.analysis.id,
        analysisVersion: prepared.analysis.analysisVersion,
        rightsContractId: prepared.rightsContractId,
        rightsContractVersionId: prepared.rights.id,
        releaseChecksum: input.release.checksum,
        locale: sharedResult.locale,
        contextFingerprint: prepared.contextFingerprint,
        reusableContextFingerprint: prepared.reusableContextFingerprint,
        reuseKey: prepared.reuseKey,
        sharedResultId: sharedResult.id,
        promptVersion: sharedResult.promptVersion,
        outputSchemaVersion: sharedResult.outputSchemaVersion,
        contextReferences: {
          sourceHash: prepared.sourceHash,
          pathHash: prepared.pathHash,
          executionFingerprint: prepared.executionFingerprint,
          fullManuscriptIncluded: false,
          providerPayloadIncluded: false,
          sharedResultReused: true,
        },
        status: 'completed',
        resultSceneId: null,
        estimatedCostKrw: 0,
        hardBudgetKrw: prepared.capability.hardBudgetKrw,
        inputTokenLimit: prepared.capability.aiInputTokenLimit,
        outputTokenLimit: prepared.capability.aiOutputTokenLimit,
        actualCostKrw: 0,
        completedAt: now,
      },
    });
    const scene = await tx.storyAiGeneratedScene.create({
      data: {
        continuationId: continuation.id,
        userId: input.userId,
        workId: input.work.id,
        releaseId: input.release.id,
        progressId: input.progress.id,
        sourcePartId: input.part.id,
        sceneKey: `ai-reuse-${continuation.id}`,
        resultChecksum: sharedResult.resultChecksum,
        provenance: 'ai_reused',
        sharedResultId: sharedResult.id,
        title: sharedResult.title as Prisma.InputJsonValue,
        visualManifest: sharedResult.visualManifest as Prisma.InputJsonValue,
        endingType: sharedResult.endingKey ? 'ai_generated' : null,
        status: 'ready',
      },
    });
    for (const beat of beats) {
      await tx.storyAiGeneratedBeat.create({
        data: {
          sceneId: scene.id,
          position: beat.position,
          beatType: beat.beatType,
          content: beat.content as Prisma.InputJsonValue,
        },
      });
    }
    for (const choice of choices) {
      await tx.storyAiGeneratedChoice.create({
        data: {
          sceneId: scene.id,
          position: choice.position,
          choiceKey: choice.choiceKey,
          label: choice.label as Prisma.InputJsonValue,
          routeKind: 'generation_required',
        },
      });
    }
    const nextPath = boundedPath([
      ...jsonRecordArray(input.progress.pathSummary),
      {
        sourceSceneId: input.sourceKind === 'canonical' ? input.scene.id : null,
        sourceGeneratedSceneId: input.sourceKind === 'generated' ? input.scene.id : null,
        choiceId: input.choice.id,
        generatedSceneId: scene.id,
        provenance: 'ai_reused',
      },
    ]);
    if (input.sourceKind === 'canonical') {
      await tx.storyChoiceEvent.create({
        data: {
          progressId: input.progress.id,
          sceneId: input.scene.id,
          choiceId: input.choice.id,
          targetSceneId: null,
          endingKey: sharedResult.endingKey,
          endingType: sharedResult.endingKey ? 'ai_generated' : null,
          explicitRejoin: false,
        },
      });
    }
    if (sharedResult.endingKey) {
      const pathSignature = createHash('sha256').update(stableJson(nextPath)).digest('hex');
      await tx.storyEndingDiscovery.upsert({
        where: {
          userId_releaseId_endingKey_pathSignature: {
            userId: input.userId,
            releaseId: input.release.id,
            endingKey: sharedResult.endingKey,
            pathSignature,
          },
        },
        create: {
          userId: input.userId,
          workId: input.work.id,
          releaseId: input.release.id,
          endingKey: sharedResult.endingKey,
          endingKind: 'ai_generated',
          pathSignature,
          provenance: 'ai_reused',
        },
        update: { lastSeenAt: now },
      });
    }
    const progressUpdate = await tx.storyReaderProgress.updateMany({
      where: {
        id: input.progress.id,
        userId: input.userId,
        workId: input.work.id,
        activeReleaseId: input.release.id,
        currentSceneId: input.sourceKind === 'canonical' ? input.scene.id : null,
        currentGeneratedSceneId: input.sourceKind === 'generated' ? input.scene.id : null,
        progressRevision: input.progress.progressRevision,
        status: 'active',
      },
      data: {
        currentSceneId: null,
        currentGeneratedSceneId: sharedResult.endingKey ? null : scene.id,
        currentBeatPosition: 0,
        status: sharedResult.endingKey ? 'completed' : 'active',
        progressRevision: { increment: 1 },
        pathSummary: nextPath as Prisma.InputJsonValue,
        visitedEndingKeys: sharedResult.endingKey
          ? [...new Set([
              ...jsonStringArray(input.progress.visitedEndingKeys),
              sharedResult.endingKey,
            ])]
          : undefined,
        updatedAt: now,
      },
    });
    if (progressUpdate.count !== 1) {
      throw new ConflictException('Story progress changed concurrently');
    }
    const completed = await tx.storyAiContinuation.update({
      where: { id: continuation.id },
      data: { resultGeneratedSceneId: scene.id },
    });
    await tx.storyAiUsageLedger.create({
      data: {
        continuationId: continuation.id,
        userId: input.userId,
        workId: input.work.id,
        releaseId: input.release.id,
        rateCardId: prepared.rateCard.id,
        eventKind: 'shared_route_reused',
        status: 'completed',
        provider: sharedResult.provider,
        model: sharedResult.model,
        rateCardVersion: sharedResult.rateCardVersion,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        imageUnits: 0,
        estimatedCostKrw: 0,
        actualCostKrw: 0,
        allowanceDelta: 0,
        progressApplied: true,
        provenance: 'ai_reused',
        idempotencyKey: `usage-reuse:${continuation.id}`,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorUserId: input.userId,
        actorType: 'user',
        action: 'story_ai_continuation.reuse',
        targetType: 'story_ai_continuation',
        targetId: continuation.id,
        metadata: {
          sharedResultId: sharedResult.id,
          providerCalled: false,
          allowanceMutated: false,
          actualCostKrw: 0,
        },
      },
    });
    return this.continuationProjection(
      completed,
      allowance ? storyAllowanceRemaining(allowance) : 0,
      false,
    );
  }

  private continuationProjection(
    continuation: any,
    allowanceRemaining: number,
    idempotentReplay: boolean,
  ) {
    return {
      continuationId: continuation.id,
      status: continuation.status,
      revisionAfterRequest: continuation.sourceProgressRevision + 1,
      allowanceRemaining,
      retryable: ['failed', 'timeout'].includes(continuation.status),
      progressApplied: continuation.status === 'completed',
      privateInputReturned: false,
      providerPayloadReturned: false,
      internalCostReturned: false,
      resultGeneratedSceneId: continuation.resultGeneratedSceneId ?? null,
      provenance: jsonRecord(continuation.contextReferences).sharedResultReused === true
        ? 'ai_reused'
        : 'ai_generated',
      idempotentReplay,
      createdAt: continuation.createdAt,
      completedAt: continuation.completedAt,
    };
  }

  private settlementProjection(continuation: any, idempotentReplay: boolean) {
    return {
      continuationId: continuation.id,
      status: continuation.status,
      progressApplied: continuation.status === 'completed',
      allowanceConsumed: continuation.status === 'completed',
      failureCode: continuation.failureCode,
      idempotentReplay,
    };
  }

  private customChoiceDenied(): never {
    throw new ForbiddenException({
      code: 'STORY_CUSTOM_CHOICE_ENTITLEMENT_REQUIRED',
      messageKey: 'story.progress.customChoice.entitlementRequired',
      retryable: false,
    });
  }

  private idempotencyKey(prefix: string, value?: string) {
    const key = value?.trim();
    if (!key || key.length < 8 || key.length > 200) {
      throw new BadRequestException('A valid Idempotency-Key header is required');
    }
    return `${prefix}:${key}`;
  }
}

function localizedStrings(value: Prisma.JsonValue): string[] {
  if (typeof value === 'string') return [value];
  if (!value || Array.isArray(value) || typeof value !== 'object') return [];
  return Object.values(value).filter((item): item is string => typeof item === 'string');
}

function jsonRecordArray(value: Prisma.JsonValue | null | undefined) {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function jsonRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && !Array.isArray(value) && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
}

function jsonStringArray(value: Prisma.JsonValue | null | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function normalizeRecommendedChoiceLocale(value: string) {
  const locale = value.trim();
  return STORY_LOCALES.find(
    (candidate) => candidate.toLowerCase() === locale.toLowerCase(),
  ) ?? locale;
}

export function assertRecommendedContinuationOutput(
  body: SettleStoryAiContinuationDto,
  expectedSceneKey: string,
) {
  const hasChoices = Boolean(body.nextChoices?.length);
  const hasEnding = Boolean(body.ending);
  if (hasChoices === hasEnding) {
    throw new BadRequestException(
      'Generated continuation requires either next choices or an explicit ending',
    );
  }
  if (!body.resultVisualManifest || !projectStoredStorySceneVisualManifest(
    body.resultVisualManifest,
    expectedSceneKey,
  )) {
    throw new BadRequestException('Generated continuation visual manifest is invalid');
  }
  const labels = (body.nextChoices ?? []).map((choice) => stableJson(choice.label));
  const keys = (body.nextChoices ?? []).map((choice) => choice.choiceKey.trim());
  if (
    keys.some((key) => !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(key)) ||
    new Set(keys).size !== keys.length ||
    new Set(labels).size !== labels.length
  ) {
    throw new BadRequestException('Generated continuation choices must be distinct');
  }
  if (body.ending && !/^ai-[a-z0-9][a-z0-9_-]{0,116}$/i.test(body.ending.endingKey.trim())) {
    throw new BadRequestException('Generated continuation ending key is invalid');
  }
}

export function sanitizeRecommendedVisualManifest(
  value: Record<string, unknown>,
  expectedSceneKey: string,
): Prisma.InputJsonValue {
  const projected = projectStoredStorySceneVisualManifest(value, expectedSceneKey);
  const fallback = value.fallback && typeof value.fallback === 'object' && !Array.isArray(value.fallback)
    ? value.fallback as Record<string, unknown>
    : {};
  if (!projected) {
    throw new BadRequestException('Generated continuation visual manifest is invalid');
  }
  return {
    sceneKey: projected.sceneKey,
    background: {
      publicAssetPath: projected.background.publicAssetPath,
      altKey: projected.background.altKey,
      state: projected.background.state,
    },
    characters: projected.characters.map((character) => ({
      characterKey: character.characterKey,
      placement: character.placement,
      expressionKey: character.expressionKey,
      publicAssetPath: character.publicAssetPath,
    })),
    fallback: {
      publicAssetPath: String(fallback.publicAssetPath),
      altKey: String(fallback.altKey),
    },
  };
}

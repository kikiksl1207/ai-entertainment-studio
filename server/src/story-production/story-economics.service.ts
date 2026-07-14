import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

@Injectable()
export class StoryEconomicsService {
  constructor(private readonly prisma: PrismaService) {}

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

  async continuationStatus(userId: string, continuationId: string) {
    const continuation = await this.prisma.storyAiContinuation.findFirst({
      where: { id: continuationId, userId },
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

  async settleContinuation(
    adminUserId: string,
    continuationId: string,
    body: SettleStoryAiContinuationDto,
    idempotencyKey?: string,
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
      const [rateCard, allowance, progress, sourceScene, consent] = await Promise.all([
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
        tx.storyScene.findUnique({ where: { id: continuation.sourceSceneId } }),
        tx.storyStyleProfileConsent.findUnique({
          where: { id: continuation.styleConsentId },
        }),
      ]);
      if (!rateCard || !allowance || !progress || !sourceScene || !consent) {
        throw new ConflictException('Story AI continuation dependency is unavailable');
      }
      const calculatedCost = calculateStoryUsageCost(this.rateNumbers(rateCard), {
        inputTokens: body.inputTokens,
        outputTokens: body.outputTokens,
        cachedInputTokens: body.cachedInputTokens,
        imageUnits: body.imageUnits,
      });
      if (Math.abs(calculatedCost - body.actualCostKrw) > 0.01) {
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
      if (finalStatus === 'completed' && !consentActive) {
        finalStatus = 'failed';
        failureCode = 'style_consent_inactive';
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
        body.actualCostKrw > Number(continuation.hardBudgetKrw)
      ) {
        finalStatus = 'failed';
        failureCode = 'hard_budget_exceeded';
      }
      if (finalStatus === 'completed' && (!body.resultTitle || !body.resultBeats?.length)) {
        throw new BadRequestException('Completed continuation requires a sanitized result');
      }
      let resultSceneId: string | null = null;
      if (finalStatus === 'completed') {
        if (
          progress.status !== 'ai_pending' ||
          progress.progressRevision !== continuation.sourceProgressRevision + 1
        ) {
          throw new ConflictException('Pending story progress changed concurrently');
        }
        const scene = await tx.storyScene.create({
          data: {
            partId: sourceScene.partId,
            sceneKey: `ai-${continuation.id}`,
            position: sourceScene.position + 1,
            status: 'published',
            title: body.resultTitle!,
            visualManifest: {
              provenance: 'ai_generated',
            },
            fixtureSource: false,
          },
        });
        for (const [index, beat] of body.resultBeats!.entries()) {
          await tx.storyBeat.create({
            data: {
              sceneId: scene.id,
              position: index + 1,
              beatType: beat.beatType,
              content: beat.content,
            },
          });
        }
        const path = jsonRecordArray(progress.pathSummary);
        const progressUpdate = await tx.storyReaderProgress.updateMany({
          where: {
            id: progress.id,
            progressRevision: progress.progressRevision,
            status: 'ai_pending',
          },
          data: {
            currentSceneId: scene.id,
            currentBeatPosition: 0,
            status: 'active',
            progressRevision: { increment: 1 },
            pathSummary: [
              ...path,
              {
                sourceSceneId: continuation.sourceSceneId,
                nextSceneId: scene.id,
                provenance: 'ai_generated',
              },
            ] as Prisma.InputJsonValue,
            updatedAt: new Date(),
          },
        });
        if (progressUpdate.count !== 1) {
          throw new ConflictException('Pending story progress changed concurrently');
        }
        resultSceneId = scene.id;
      } else {
        const checkpointSceneId = continuation.checkpointSceneId ?? continuation.sourceSceneId;
        const checkpointScene = await tx.storyScene.findUnique({
          where: { id: checkpointSceneId },
        });
        const checkpointPart = checkpointScene
          ? await tx.storyPart.findUnique({ where: { id: checkpointScene.partId } })
          : null;
        const restored = await tx.storyReaderProgress.updateMany({
          where: { id: progress.id, status: 'ai_pending' },
          data: {
            currentSceneId: checkpointSceneId,
            currentBeatPosition: 0,
            currentAct: checkpointPart?.actNumber ?? progress.currentAct,
            status: 'active',
            progressRevision: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        if (restored.count !== 1) {
          throw new ConflictException('Pending story progress changed concurrently');
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
          resultSceneId,
          actualCostKrw: body.actualCostKrw,
          completedAt: new Date(),
        },
      });
      await tx.storyCustomChoice.update({
        where: { id: continuation.customChoiceId },
        data: { status: finalStatus },
      });
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
          actualCostKrw: body.actualCostKrw,
          allowanceDelta: finalStatus === 'completed' ? -1 : 0,
          progressApplied: finalStatus === 'completed',
          provenance: 'ai_generated',
          idempotencyKey: key,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: adminUserId,
          actorType: 'admin',
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
      where: { id: workId, status: 'published', activeReleaseId: { not: null } },
    });
    if (!work) throw new NotFoundException('Published story not found');
    const capability = await this.prisma.storyReleaseCapability.findUnique({
      where: { releaseId: work.activeReleaseId! },
    });
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
      fixedChoices: capability.fixedChoiceCount,
      customChoiceEnabled:
        capability.status === 'active' && capability.customChoiceEnabled,
      customChoiceMaxLength: capability.customChoiceMaxLength,
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
      fixedChoices: 3,
      customChoiceEnabled: false,
      customChoiceMaxLength: 0,
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

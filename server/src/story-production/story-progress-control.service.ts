import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { ModerationService } from '../moderation/moderation.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdjustStoryResetQuotaDto,
  ConfirmStoryCheckpointDto,
  ExecuteStoryResetDto,
  StoryResetPreviewQueryDto,
  SubmitCustomStoryChoiceDto,
} from './dto/story-production.dto';
import {
  containsBlockedTerm,
  safeResetAuditMetadata,
  STORY_PROGRESS_LOCALE_SLOTS,
  STORY_PROGRESS_MESSAGE_KEYS,
  STORY_RESET_LIMITS,
  storyProgressStatusKey,
  storyResetRemaining,
  storyResetScopeKey,
  validatePrivateCustomChoice,
} from './story-progress-control.policy';
import { sessionKeyHash } from './story-lifecycle.policy';
import { StoryEconomicsService } from './story-economics.service';

type ResetPlan = {
  targetSceneId: string;
  targetAct: number;
  invalidatedSceneIds: string[];
  invalidatedEventCount: number;
};

@Injectable()
export class StoryProgressControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    @Optional() private readonly economics?: StoryEconomicsService,
  ) {}

  async submitCustomChoice(
    userId: string,
    progressId: string,
    body: SubmitCustomStoryChoiceDto,
    idempotencyKey?: string,
  ) {
    const key = this.requireIdempotencyKey('story-custom-choice', idempotencyKey);
    const validation = validatePrivateCustomChoice(body.input, this.economics ? 2000 : 500);
    if (!validation.accepted) {
      throw new BadRequestException({
        code: `STORY_CUSTOM_CHOICE_${validation.reason.toUpperCase()}`,
        messageKey: STORY_PROGRESS_MESSAGE_KEYS.customChoiceRejected,
        retryable: true,
      });
    }

    const existing = await this.prisma.storyCustomChoice.findUnique({
      where: { idempotencyKey: key },
    });
    if (existing) {
      if (
        existing.userId !== userId ||
        existing.progressId !== progressId ||
        existing.contentHash !== validation.contentHash
      ) {
        throw new ConflictException({
          code: 'STORY_CUSTOM_CHOICE_IDEMPOTENCY_CONFLICT',
          messageKey: 'story.progress.error.idempotencyConflict',
          retryable: false,
        });
      }
      return this.economics
        ? this.economics.customChoiceReplay(userId, existing, validation.contentHash)
        : this.customChoiceReceipt(existing);
    }

    const context = await this.progressContext(userId, progressId);
    if (context.progress.progressRevision !== body.expectedRevision) {
      this.throwStaleRevision(context.progress.progressRevision);
    }
    const prepared = this.economics
      ? await this.economics.prepareCustomChoice(
          userId,
          context,
          validation.normalized,
        )
      : null;
    const legacyCanUseCustomChoice =
      !this.economics &&
      context.work.customChoiceEnabled &&
      !context.work.priceLumina.isZero() &&
      context.progress.storyVersion === context.work.publishedVersion &&
      (await this.hasActivePaidEntitlement(
        userId,
        context.work.id,
        context.part.id,
      ));
    if (!this.economics && !legacyCanUseCustomChoice) {
      throw new ForbiddenException({
        code: 'STORY_CUSTOM_CHOICE_ENTITLEMENT_REQUIRED',
        messageKey: STORY_PROGRESS_MESSAGE_KEYS.customChoiceDenied,
        retryable: false,
      });
    }

    const blockedTerms = await this.prisma.feedSearchBlockedTerm.findMany({
      where: { status: 'active', searchType: { in: ['all', 'text'] } },
      select: { normalizedKeyword: true },
      take: 1000,
    });
    if (
      containsBlockedTerm(
        validation.normalized,
        blockedTerms.map((term) => term.normalizedKeyword),
      )
    ) {
      throw new BadRequestException({
        code: 'STORY_CUSTOM_CHOICE_BLOCKED_TERM',
        messageKey: STORY_PROGRESS_MESSAGE_KEYS.customChoiceRejected,
        retryable: true,
      });
    }
    const moderation = this.moderation.preview({
      surface: 'story_custom_choice',
      body: validation.normalized,
    });
    if (moderation.decision !== 'allow') {
      throw new BadRequestException({
        code: 'STORY_CUSTOM_CHOICE_MODERATION_REJECTED',
        messageKey: STORY_PROGRESS_MESSAGE_KEYS.customChoiceRejected,
        retryable: true,
      });
    }

    if (this.economics && prepared) {
      return this.economics.requestCustomChoice({
        userId,
        context,
        normalizedInput: validation.normalized,
        contentHash: validation.contentHash,
        moderationDecision: moderation.decision,
        idempotencyKey: key,
        prepared,
      });
    }

    const choice = await this.prisma.storyCustomChoice.create({
      data: {
        progressId: context.progress.id,
        userId,
        workId: context.work.id,
        sceneId: context.scene.id,
        idempotencyKey: key,
        contentHash: validation.contentHash,
        privateInput: validation.normalized,
        moderationDecision: moderation.decision,
      },
    });
    await this.prisma.storyQualityEvent.upsert({
      where: { idempotencyKey: `custom-choice:${choice.id}` },
      create: {
        workId: context.work.id,
        releaseId: context.progress.activeReleaseId,
        sessionKeyHash: sessionKeyHash(context.progress.id),
        eventType: 'custom_choice_accepted',
        metricBucket: 'story_path',
        dimensions: { moderationDecision: moderation.decision },
        idempotencyKey: `custom-choice:${choice.id}`,
      },
      update: {},
    });
    return this.customChoiceReceipt(choice);
  }

  async confirmCheckpoint(
    userId: string,
    progressId: string,
    body: ConfirmStoryCheckpointDto,
  ) {
    const context = await this.progressContext(userId, progressId);
    if (context.progress.progressRevision !== body.expectedRevision) {
      this.throwStaleRevision(context.progress.progressRevision);
    }
    if (context.progress.storyVersion !== context.work.publishedVersion) {
      throw new ConflictException({
        code: 'STORY_CHECKPOINT_VERSION_MISMATCH',
        messageKey: STORY_PROGRESS_MESSAGE_KEYS.versionMismatch,
        retryable: false,
      });
    }
    if (body.sceneId !== context.progress.currentSceneId) {
      this.throwStaleRevision(context.progress.progressRevision);
    }
    await this.assertBeatExists(context.scene.id, body.beatPosition);

    const afterRevision = context.progress.progressRevision + 1;
    const checkpoint = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.storyReaderProgress.updateMany({
        where: {
          id: context.progress.id,
          userId,
          progressRevision: body.expectedRevision,
          storyVersion: context.work.publishedVersion,
        },
        data: {
          currentBeatPosition: body.beatPosition,
          checkpointSceneId: body.sceneId,
          currentAct: context.part.actNumber,
          progressRevision: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (updated.count !== 1) this.throwStaleRevision(body.expectedRevision);
      return tx.storyProgressCheckpoint.create({
        data: {
          progressId: context.progress.id,
          progressRevision: afterRevision,
          storyVersion: context.work.publishedVersion,
          sceneId: body.sceneId,
          beatPosition: body.beatPosition,
          actNumber: context.part.actNumber,
          visitedEndingKeys: jsonStringArray(context.progress.visitedEndingKeys),
        },
      });
    });
    return this.checkpointProjection(checkpoint);
  }

  async checkpoint(userId: string, progressId: string) {
    const progress = await this.prisma.storyReaderProgress.findFirst({
      where: { id: progressId, userId },
    });
    if (!progress) throw new NotFoundException('Story progress not found');
    const checkpoint = await this.prisma.storyProgressCheckpoint.findFirst({
      where: { progressId, checkpointStatus: 'confirmed' },
      orderBy: [{ progressRevision: 'desc' }, { createdAt: 'desc' }],
    });
    return checkpoint ? this.checkpointProjection(checkpoint) : null;
  }

  async resetPreview(
    userId: string,
    progressId: string,
    query: StoryResetPreviewQueryDto,
  ) {
    const context = await this.progressContext(userId, progressId);
    const configuredLimits = await this.resetLimits(
      context.progress.activeReleaseId,
      context.progress.capabilityRevision,
    );
    await this.assertStoryAccess(userId, context.work.id, context.part.id, context.work.priceLumina.isZero());
    const plan = await this.buildResetPlan(
      this.prisma,
      context.work.id,
      context.progress.id,
      query.target,
      query.actNumber,
    );
    const scopeKey = storyResetScopeKey(query.target, plan.targetAct);
    const bucket = await this.prisma.storyResetQuotaBucket.findUnique({
      where: { userId_workId_scopeKey: { userId, workId: context.work.id, scopeKey } },
    });
    const limit = bucket?.limitCount ?? configuredLimits[query.target];
    const remaining = storyResetRemaining(query.target, bucket?.usedCount ?? 0, limit);
    return {
      target: query.target,
      targetAct: plan.targetAct,
      targetSceneId: plan.targetSceneId,
      invalidatedEventCount: plan.invalidatedEventCount,
      remainingBefore: remaining,
      remainingAfter: Math.max(0, remaining - 1),
      canExecute: remaining > 0,
      expectedRevision: context.progress.progressRevision,
      messageKey:
        query.target === 'full'
          ? STORY_PROGRESS_MESSAGE_KEYS.fullReset
          : STORY_PROGRESS_MESSAGE_KEYS.actReset,
    };
  }

  async executeReset(
    userId: string,
    progressId: string,
    body: ExecuteStoryResetDto,
    idempotencyKey?: string,
  ) {
    const key = this.requireIdempotencyKey('story-reset', idempotencyKey);
    const existing = await this.prisma.storyResetCommand.findUnique({
      where: { idempotencyKey: key },
    });
    if (existing) {
      if (
        existing.userId !== userId ||
        existing.progressId !== progressId ||
        existing.targetType !== body.target ||
        existing.targetAct !== (body.target === 'full' ? 1 : body.actNumber ?? null)
      ) {
        throw new ConflictException({
          code: 'STORY_RESET_IDEMPOTENCY_CONFLICT',
          messageKey: 'story.progress.error.idempotencyConflict',
          retryable: false,
        });
      }
      return this.resetCommandProjection(existing, true);
    }

    const pendingProgress = this.economics
      ? await this.prisma.storyReaderProgress.findFirst({
          where: { id: progressId, userId },
          select: { activeReleaseId: true, capabilityRevision: true },
        })
      : null;
    const configuredLimits = await this.resetLimits(
      pendingProgress?.activeReleaseId,
      pendingProgress?.capabilityRevision,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const progress = await tx.storyReaderProgress.findFirst({
        where: { id: progressId, userId },
      });
      if (!progress) throw new NotFoundException('Story progress not found');
      if (progress.status === 'ai_pending') {
        throw new ConflictException('Story progress is awaiting AI continuation');
      }
      if (progress.progressRevision !== body.expectedRevision) {
        this.throwStaleRevision(progress.progressRevision);
      }
      const work = await tx.storyWork.findUnique({ where: { id: progress.workId } });
      if (!work) throw new NotFoundException('Published story not found');
      const currentScene = progress.currentSceneId
        ? await tx.storyScene.findUnique({ where: { id: progress.currentSceneId } })
        : null;
      const currentPart = currentScene
        ? await tx.storyPart.findUnique({ where: { id: currentScene.partId } })
        : await tx.storyPart.findFirst({ where: { workId: work.id }, orderBy: { position: 'asc' } });
      if (!currentPart) throw new NotFoundException('Story part not found');
      await this.assertStoryAccessTx(
        tx,
        userId,
        work.id,
        currentPart.id,
        work.priceLumina.isZero(),
      );
      if (body.target === 'act' && progress.storyVersion !== work.publishedVersion) {
        throw new ConflictException({
          code: 'STORY_RESET_VERSION_MISMATCH',
          messageKey: STORY_PROGRESS_MESSAGE_KEYS.versionMismatch,
          retryable: false,
        });
      }
      const plan = await this.buildResetPlan(
        tx,
        work.id,
        progress.id,
        body.target,
        body.actNumber,
      );
      const scopeKey = storyResetScopeKey(body.target, plan.targetAct);
      const limit = configuredLimits[body.target];
      const bucket = await tx.storyResetQuotaBucket.upsert({
        where: { userId_workId_scopeKey: { userId, workId: work.id, scopeKey } },
        create: { userId, workId: work.id, scopeKey, limitCount: limit },
        update: {},
      });
      const quotaUpdate = await tx.storyResetQuotaBucket.updateMany({
        where: {
          id: bucket.id,
          revision: bucket.revision,
          usedCount: { lt: bucket.limitCount },
        },
        data: { usedCount: { increment: 1 }, revision: { increment: 1 }, updatedAt: new Date() },
      });
      if (quotaUpdate.count !== 1) {
        throw new ForbiddenException({
          code: 'STORY_RESET_QUOTA_EXHAUSTED',
          messageKey: STORY_PROGRESS_MESSAGE_KEYS.quotaExhausted,
          retryable: false,
        });
      }

      const afterRevision = progress.progressRevision + 1;
      const command = await tx.storyResetCommand.create({
        data: {
          progressId: progress.id,
          userId,
          idempotencyKey: key,
          targetType: body.target,
          targetAct: plan.targetAct,
          beforeRevision: progress.progressRevision,
          afterRevision,
          invalidatedEventCount: plan.invalidatedEventCount,
        },
      });
      const activePath = jsonRecordArray(progress.pathSummary);
      const activeSeen = jsonStringArray(progress.seenSceneIds);
      const invalidated = new Set(plan.invalidatedSceneIds);
      const updatedProgress = await tx.storyReaderProgress.updateMany({
        where: { id: progress.id, userId, progressRevision: body.expectedRevision },
        data: {
          currentSceneId: plan.targetSceneId,
          currentBeatPosition: 0,
          currentAct: plan.targetAct,
          checkpointSceneId: plan.targetSceneId,
          progressRevision: { increment: 1 },
          storyVersion: work.publishedVersion,
          pathSummary:
            body.target === 'full'
              ? []
              : (activePath.filter((entry) => !invalidated.has(String(entry.sceneId))) as Prisma.InputJsonValue),
          seenSceneIds:
            body.target === 'full'
              ? [plan.targetSceneId]
              : activeSeen.filter((sceneId) => !invalidated.has(sceneId)),
          status: 'active',
          updatedAt: new Date(),
        },
      });
      if (updatedProgress.count !== 1) this.throwStaleRevision(progress.progressRevision);
      await tx.storyChoiceEvent.updateMany({
        where: {
          progressId: progress.id,
          invalidatedAt: null,
          ...(body.target === 'act' ? { sceneId: { in: plan.invalidatedSceneIds } } : {}),
        },
        data: { invalidatedAt: new Date(), resetCommandId: command.id },
      });
      await tx.storyProgressCheckpoint.create({
        data: {
          progressId: progress.id,
          progressRevision: afterRevision,
          storyVersion: work.publishedVersion,
          sceneId: plan.targetSceneId,
          beatPosition: 0,
          actNumber: plan.targetAct,
          visitedEndingKeys: jsonStringArray(progress.visitedEndingKeys),
        },
      });
      await tx.storyQualityEvent.upsert({
        where: { idempotencyKey: `reset:${command.id}` },
        create: {
          workId: work.id,
          releaseId: progress.activeReleaseId,
          sessionKeyHash: sessionKeyHash(progress.id),
          eventType: 'reset_completed',
          metricBucket: 'story_replay',
          dimensions: { resetTarget: body.target, targetAct: plan.targetAct },
          idempotencyKey: `reset:${command.id}`,
        },
        update: {},
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          actorType: 'user',
          action: 'story_progress.reset',
          targetType: 'story_reader_progress',
          targetId: progress.id,
          metadata: safeResetAuditMetadata({
            target: body.target,
            actNumber: plan.targetAct,
            beforeRevision: progress.progressRevision,
            afterRevision,
            invalidatedEventCount: plan.invalidatedEventCount,
          }),
        },
      });
      return command;
    });
    return this.resetCommandProjection(result, false);
  }

  async publicState(userId: string, workId: string) {
    const work = await this.prisma.storyWork.findFirst({
      where: { id: workId, status: 'published', fixtureSource: false },
    });
    if (!work) throw new NotFoundException('Published story not found');
    const [progress, paidEntitled, configuredCapability] = await Promise.all([
      this.prisma.storyReaderProgress.findUnique({
        where: { userId_workId: { userId, workId } },
      }),
      this.hasActivePaidEntitlement(userId, workId),
      this.economics ? this.economics.readerCapability(userId, workId) : null,
    ]);
    const configuredLimits = configuredCapability
      ? {
          full: configuredCapability.resetPolicy.fullLimit,
          act: configuredCapability.resetPolicy.actLimit,
        }
      : STORY_RESET_LIMITS;
    const capabilityMatches =
      !this.economics ||
      !progress ||
      progress.capabilityRevision === configuredCapability?.revision;
    const storyAccess = {
      isFree: work.priceLumina.isZero(),
      entitled: work.priceLumina.isZero() || paidEntitled,
    };
    if (!progress) {
      return {
        statusKey: STORY_PROGRESS_MESSAGE_KEYS.noProgress,
        canResume: false,
        checkpointLabel: null,
        fullResetRemaining: configuredLimits.full,
        actResetRemaining: configuredLimits.act,
        resetTargetSummary: null,
        storyAccess,
        canFullReset: false,
        canActReset: false,
        customChoiceCapability: false,
        releaseCapability: configuredCapability,
        localeSlots: STORY_PROGRESS_LOCALE_SLOTS,
      };
    }
    const scopeKeys = ['full', `act:${progress.currentAct}`];
    const [buckets, checkpoint] = await Promise.all([
      this.prisma.storyResetQuotaBucket.findMany({
        where: { userId, workId, scopeKey: { in: scopeKeys } },
      }),
      this.prisma.storyProgressCheckpoint.findFirst({
        where: { progressId: progress.id, checkpointStatus: 'confirmed' },
        orderBy: { progressRevision: 'desc' },
      }),
    ]);
    const byScope = new Map(buckets.map((bucket) => [bucket.scopeKey, bucket]));
    const full = byScope.get('full');
    const act = byScope.get(`act:${progress.currentAct}`);
    const fullRemaining = storyResetRemaining(
      'full',
      full?.usedCount ?? 0,
      full?.limitCount ?? configuredLimits.full,
    );
    const actRemaining = storyResetRemaining(
      'act',
      act?.usedCount ?? 0,
      act?.limitCount ?? configuredLimits.act,
    );
    const versionMatches = progress.storyVersion === work.publishedVersion;
    return {
      statusKey: storyProgressStatusKey({
        hasProgress: true,
        completed: progress.status === 'completed',
        versionMatches,
        quotaExhausted: fullRemaining === 0 && actRemaining === 0,
      }),
      canResume: Boolean(progress.currentSceneId) && progress.status === 'active' && versionMatches,
      checkpointLabel: checkpoint
        ? {
            messageKey: STORY_PROGRESS_MESSAGE_KEYS.checkpoint,
            actNumber: checkpoint.actNumber,
            beatPosition: checkpoint.beatPosition,
          }
        : null,
      fullResetRemaining: fullRemaining,
      actResetRemaining: actRemaining,
      resetTargetSummary: {
        full: { messageKey: STORY_PROGRESS_MESSAGE_KEYS.fullReset, remaining: fullRemaining },
        act: {
          messageKey: STORY_PROGRESS_MESSAGE_KEYS.actReset,
          actNumber: progress.currentAct,
          remaining: actRemaining,
        },
      },
      storyAccess,
      canFullReset:
        storyAccess.entitled &&
        fullRemaining > 0 &&
        progress.status !== 'ai_pending' &&
        capabilityMatches,
      canActReset:
        storyAccess.entitled &&
        actRemaining > 0 &&
        versionMatches &&
        progress.status !== 'ai_pending' &&
        capabilityMatches,
      customChoiceCapability:
        (configuredCapability
          ? configuredCapability.customChoiceEnabled &&
            configuredCapability.aiAllowanceRemaining > 0
          : work.customChoiceEnabled && !work.priceLumina.isZero()) &&
        paidEntitled &&
        versionMatches &&
        Boolean(progress.currentSceneId) &&
        progress.status === 'active' &&
        capabilityMatches,
      releaseCapability: configuredCapability,
      localeSlots: STORY_PROGRESS_LOCALE_SLOTS,
    };
  }

  async adjustResetQuota(
    adminUserId: string,
    body: AdjustStoryResetQuotaDto,
    idempotencyKey?: string,
  ) {
    const key = this.requireIdempotencyKey('story-reset-adjustment', idempotencyKey);
    const existing = await this.prisma.storyResetQuotaAdjustment.findUnique({
      where: { idempotencyKey: key },
    });
    if (existing) return this.adjustmentProjection(existing, true);
    const scopeKey = storyResetScopeKey(body.target, body.actNumber);
    const reason = body.reason.trim();
    if (!reason) throw new BadRequestException('Adjustment reason is required');

    const adjustment = await this.prisma.$transaction(async (tx) => {
      const [user, work] = await Promise.all([
        tx.user.findUnique({ where: { id: body.userId }, select: { id: true } }),
        tx.storyWork.findUnique({ where: { id: body.workId }, select: { id: true } }),
      ]);
      if (!user || !work) throw new NotFoundException('Reset quota target not found');
      const bucket = await tx.storyResetQuotaBucket.upsert({
        where: {
          userId_workId_scopeKey: {
            userId: body.userId,
            workId: body.workId,
            scopeKey,
          },
        },
        create: {
          userId: body.userId,
          workId: body.workId,
          scopeKey,
          limitCount: STORY_RESET_LIMITS[body.target],
        },
        update: {},
      });
      const afterLimit = bucket.limitCount + body.addedUses;
      const updated = await tx.storyResetQuotaBucket.updateMany({
        where: { id: bucket.id, revision: bucket.revision },
        data: {
          limitCount: afterLimit,
          revision: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Reset quota changed concurrently');
      }
      const created = await tx.storyResetQuotaAdjustment.create({
        data: {
          quotaBucketId: bucket.id,
          adminUserId,
          idempotencyKey: key,
          addedUses: body.addedUses,
          beforeLimit: bucket.limitCount,
          afterLimit,
          reason,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: adminUserId,
          actorType: 'admin',
          action: 'story_reset_quota.adjust',
          targetType: 'story_reset_quota_bucket',
          targetId: bucket.id,
          metadata: {
            scopeKey,
            addedUses: body.addedUses,
            beforeLimit: bucket.limitCount,
            afterLimit,
          },
        },
      });
      return created;
    });
    return this.adjustmentProjection(adjustment, false);
  }

  private async progressContext(userId: string, progressId: string) {
    const progress = await this.prisma.storyReaderProgress.findFirst({
      where: { id: progressId, userId },
    });
    if (!progress?.currentSceneId) {
      throw new NotFoundException('Active story progress not found');
    }
    const [work, scene] = await Promise.all([
      this.prisma.storyWork.findFirst({
        where: { id: progress.workId, status: 'published', fixtureSource: false },
      }),
      this.prisma.storyScene.findFirst({
        where: { id: progress.currentSceneId, status: 'published', fixtureSource: false },
      }),
    ]);
    if (!work || !scene) throw new NotFoundException('Published story progress not found');
    const part = await this.prisma.storyPart.findFirst({
      where: { id: scene.partId, workId: work.id, status: 'published', fixtureSource: false },
    });
    if (!part) throw new NotFoundException('Published story part not found');
    return { progress, work, scene, part };
  }

  private async assertBeatExists(sceneId: string, beatPosition: number) {
    if (beatPosition === 0) return;
    const beat = await this.prisma.storyBeat.findUnique({
      where: { sceneId_position: { sceneId, position: beatPosition } },
      select: { id: true },
    });
    if (!beat) throw new BadRequestException('Beat position is not available');
  }

  private async buildResetPlan(
    client: PrismaService | Prisma.TransactionClient,
    workId: string,
    progressId: string,
    target: 'full' | 'act',
    requestedAct?: number,
  ): Promise<ResetPlan> {
    const targetAct = target === 'full' ? 1 : requestedAct;
    if (!targetAct || targetAct < 1) {
      throw new BadRequestException({
        code: 'STORY_RESET_ACT_REQUIRED',
        messageKey: STORY_PROGRESS_MESSAGE_KEYS.actReset,
        retryable: true,
      });
    }
    const invalidatedParts = await client.storyPart.findMany({
      where: {
        workId,
        status: 'published',
        fixtureSource: false,
        actNumber: target === 'full' ? { gte: 1 } : { gte: targetAct },
      },
      select: { id: true },
      orderBy: { position: 'asc' },
    });
    if (!invalidatedParts.length) throw new NotFoundException('Reset target act not found');
    const scenes = await client.storyScene.findMany({
      where: {
        partId: { in: invalidatedParts.map((part) => part.id) },
        status: 'published',
        fixtureSource: false,
      },
      select: { id: true, partId: true, position: true },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    const targetPartIds = new Set(
      (
        await client.storyPart.findMany({
          where: { workId, actNumber: targetAct, status: 'published', fixtureSource: false },
          select: { id: true },
        })
      ).map((part) => part.id),
    );
    const targetScene = scenes.find((scene) => targetPartIds.has(scene.partId));
    if (!targetScene) throw new NotFoundException('Reset target scene not found');
    const invalidatedSceneIds = scenes.map((scene) => scene.id);
    const invalidatedEventCount = await client.storyChoiceEvent.count({
      where: {
        progressId,
        invalidatedAt: null,
        ...(target === 'act' ? { sceneId: { in: invalidatedSceneIds } } : {}),
      },
    });
    return {
      targetSceneId: targetScene.id,
      targetAct,
      invalidatedSceneIds,
      invalidatedEventCount,
    };
  }

  private async assertStoryAccess(
    userId: string,
    workId: string,
    partId: string,
    freeStory: boolean,
  ) {
    if (freeStory || (await this.hasActivePaidEntitlement(userId, workId, partId))) return;
    throw new ForbiddenException('Story entitlement required');
  }

  private async assertStoryAccessTx(
    tx: Prisma.TransactionClient,
    userId: string,
    workId: string,
    partId: string,
    freeStory: boolean,
  ) {
    if (freeStory) return;
    const now = new Date();
    const entitlement = await tx.userEntitlement.findFirst({
      where: {
        userId,
        referenceId: { in: [workId, partId] },
        revokedAt: null,
        startsAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true },
    });
    if (!entitlement) throw new ForbiddenException('Story entitlement required');
  }

  private async hasActivePaidEntitlement(userId: string, workId: string, partId?: string) {
    const now = new Date();
    const entitlement = await this.prisma.userEntitlement.findFirst({
      where: {
        userId,
        entitlementType: { in: ['story_work', 'story_season', 'story_part'] },
        referenceId: { in: [workId, ...(partId ? [partId] : [])] },
        revokedAt: null,
        startsAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true },
    });
    return Boolean(entitlement);
  }

  private async resetLimits(
    releaseId: string | null | undefined,
    capabilityRevision?: number | null,
  ) {
    if (!this.economics) return STORY_RESET_LIMITS;
    const capability = await this.economics.capabilityByRelease(releaseId);
    if (!capability || capability.revision !== capabilityRevision) {
      throw new ForbiddenException({
        code: 'STORY_RELEASE_CAPABILITY_REQUIRED',
        messageKey: 'story.progress.reset.capabilityRequired',
        retryable: false,
      });
    }
    return {
      full: capability.fullResetLimit,
      act: capability.actResetLimit,
    };
  }

  private checkpointProjection(checkpoint: {
    progressRevision: number;
    storyVersion: number;
    sceneId: string;
    beatPosition: number;
    actNumber: number;
    createdAt: Date;
  }) {
    return {
      revision: checkpoint.progressRevision,
      storyVersion: checkpoint.storyVersion,
      sceneId: checkpoint.sceneId,
      beatPosition: checkpoint.beatPosition,
      actNumber: checkpoint.actNumber,
      confirmedAt: checkpoint.createdAt,
    };
  }

  private customChoiceReceipt(choice: { id: string; status: string; createdAt: Date }) {
    return {
      requestId: choice.id,
      status: choice.status,
      acceptedAt: choice.createdAt,
      privateInputReturned: false,
    };
  }

  private resetCommandProjection(
    command: {
      id: string;
      targetType: string;
      targetAct: number | null;
      beforeRevision: number;
      afterRevision: number;
      invalidatedEventCount: number;
      status: string;
    },
    idempotentReplay: boolean,
  ) {
    return {
      commandId: command.id,
      target: command.targetType,
      targetAct: command.targetAct,
      beforeRevision: command.beforeRevision,
      afterRevision: command.afterRevision,
      invalidatedEventCount: command.invalidatedEventCount,
      status: command.status,
      idempotentReplay,
    };
  }

  private adjustmentProjection(
    adjustment: {
      id: string;
      addedUses: number;
      beforeLimit: number;
      afterLimit: number;
      createdAt: Date;
    },
    idempotentReplay: boolean,
  ) {
    return {
      adjustmentId: adjustment.id,
      addedUses: adjustment.addedUses,
      beforeLimit: adjustment.beforeLimit,
      afterLimit: adjustment.afterLimit,
      adjustedAt: adjustment.createdAt,
      idempotentReplay,
    };
  }

  private requireIdempotencyKey(prefix: string, value?: string) {
    const key = value?.trim();
    if (!key || key.length < 8 || key.length > 200) {
      throw new BadRequestException({
        code: 'STORY_IDEMPOTENCY_KEY_REQUIRED',
        messageKey: 'story.progress.error.idempotencyRequired',
        retryable: true,
      });
    }
    return `${prefix}:${createHash('sha256').update(key).digest('hex')}`;
  }

  private throwStaleRevision(currentRevision: number): never {
    throw new ConflictException({
      code: 'STORY_PROGRESS_STALE_REVISION',
      messageKey: STORY_PROGRESS_MESSAGE_KEYS.staleRevision,
      retryable: true,
      currentRevision,
    });
  }
}

function jsonRecordArray(value: Prisma.JsonValue): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function jsonStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  AggregateStoryQualityDto,
  BuildStoryMemoryDto,
  ClearStorySlotDto,
  CreateStoryReleaseDto,
  OpenWriterReviewDto,
  SaveStorySlotDto,
  StoryMemoryQueryDto,
  TransitionStoryPublicationDto,
  TransitionWriterReviewDto,
} from './dto/story-lifecycle.dto';
import {
  canTransitionPublication,
  canTransitionReview,
  qualityDimensionViolations,
  releaseChecksum,
} from './story-lifecycle.policy';
import { StoryEconomicsService } from './story-economics.service';

@Injectable()
export class StoryLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly economics?: StoryEconomicsService,
  ) {}

  async lifecycle(userId: string, workId: string) {
    const work = await this.assertOwner(userId, workId);
    const [activeRelease, latestTransition] = await Promise.all([
      work.activeReleaseId
        ? this.prisma.storyRelease.findUnique({ where: { id: work.activeReleaseId } })
        : null,
      this.prisma.storyPublicationTransition.findFirst({
        where: { workId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      status: work.status,
      revision: work.releaseRevision,
      requiredNextAction: this.nextPublicationAction(work.status),
      activeRelease: activeRelease ? this.releaseProjection(activeRelease) : null,
      latestTransition: latestTransition
        ? {
            fromStatus: latestTransition.fromStatus,
            toStatus: latestTransition.toStatus,
            publicSummary: latestTransition.publicSummary,
            changedAt: latestTransition.createdAt,
          }
        : null,
    };
  }

  async createRelease(
    userId: string,
    workId: string,
    body: CreateStoryReleaseDto,
  ) {
    await this.assertOwner(userId, workId);
    const manuscript = await this.prisma.storyManuscriptVersion.findFirst({
      where: { id: body.manuscriptVersionId, workId, ownerUserId: userId },
    });
    if (!manuscript) throw new NotFoundException('Manuscript version not found');
    const snapshot = {
      manuscriptVersionId: manuscript.id,
      branchGraphSnapshot: body.branchGraphSnapshot,
      endingSetSnapshot: body.endingSetSnapshot,
      sceneAssetManifest: body.sceneAssetManifest,
      localizedDisplaySnapshot: body.localizedDisplaySnapshot,
    };
    const checksum = releaseChecksum(snapshot);
    const existing = await this.prisma.storyRelease.findUnique({
      where: { workId_checksum: { workId, checksum } },
    });
    if (existing) return { release: this.releaseProjection(existing), idempotentReplay: true };
    const latest = await this.prisma.storyRelease.findFirst({
      where: { workId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const release = await this.prisma.storyRelease.create({
      data: {
        workId,
        version: (latest?.version ?? 0) + 1,
        manuscriptVersionId: manuscript.id,
        branchGraphSnapshot: body.branchGraphSnapshot as Prisma.InputJsonValue,
        endingSetSnapshot: body.endingSetSnapshot as Prisma.InputJsonValue,
        sceneAssetManifest: body.sceneAssetManifest as Prisma.InputJsonValue,
        localizedDisplaySnapshot:
          body.localizedDisplaySnapshot as Prisma.InputJsonValue,
        checksum,
        validationSummary: body.validationSummary as Prisma.InputJsonValue,
        diffSummary: (body.diffSummary ?? {}) as Prisma.InputJsonValue,
        createdByUserId: userId,
      },
    });
    return { release: this.releaseProjection(release), idempotentReplay: false };
  }

  async transitionPublication(
    actorUserId: string,
    workId: string,
    body: TransitionStoryPublicationDto,
    idempotencyKey?: string,
  ) {
    const key = this.idempotencyKey('story-publication', idempotencyKey);
    const existing = await this.prisma.storyPublicationTransition.findUnique({
      where: { idempotencyKey: key },
    });
    if (existing) return this.transitionProjection(existing, true);
    return this.prisma.$transaction(async (tx) => {
      const work = await tx.storyWork.findUnique({ where: { id: workId } });
      if (!work) throw new NotFoundException('Story work not found');
      if (work.releaseRevision !== body.expectedRevision) this.stale(work.releaseRevision);
      const isReleaseSwitch =
        work.status === 'published' &&
        body.toStatus === 'published' &&
        Boolean(body.releaseId) &&
        body.releaseId !== work.activeReleaseId;
      if (!canTransitionPublication(work.status, body.toStatus) && !isReleaseSwitch) {
        throw new BadRequestException('Publication transition is not allowed');
      }
      const release = body.releaseId
        ? await tx.storyRelease.findFirst({ where: { id: body.releaseId, workId } })
        : null;
      if (body.toStatus === 'published') {
        if (!release) throw new BadRequestException('Validated release is required');
        const validation = release.validationSummary as Record<string, unknown>;
        if (validation.ready !== true || Number(validation.blockingIssueCount ?? 0) > 0) {
          throw new ConflictException('Release validation is not ready');
        }
        if (this.economics) {
          await this.economics.assertReleasePublishableTx(tx, work, release);
        }
      }
      const afterRevision = work.releaseRevision + 1;
      if (body.toStatus === 'published' && release) {
        if (work.activeReleaseId && work.activeReleaseId !== release.id) {
          await tx.storyRelease.updateMany({
            where: { id: work.activeReleaseId, status: 'active' },
            data: { status: 'retired', retiredAt: new Date() },
          });
        }
        await tx.storyRelease.update({
          where: { id: release.id },
          data: { status: 'active', activatedAt: new Date(), retiredAt: null },
        });
      }
      const updated = await tx.storyWork.updateMany({
        where: { id: work.id, releaseRevision: body.expectedRevision },
        data: {
          status: body.toStatus,
          activeReleaseId:
            body.toStatus === 'published' && release ? release.id : undefined,
          publishedVersion:
            body.toStatus === 'published' && release ? release.version : undefined,
          publishedAt: body.toStatus === 'published' ? new Date() : undefined,
          releaseRevision: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (updated.count !== 1) this.stale(work.releaseRevision);
      const transition = await tx.storyPublicationTransition.create({
        data: {
          workId,
          releaseId: release?.id,
          actorUserId,
          idempotencyKey: key,
          fromStatus: work.status,
          toStatus: body.toStatus,
          beforeRevision: work.releaseRevision,
          afterRevision,
          publicSummary: (body.publicSummary ?? {}) as Prisma.InputJsonValue,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId,
          actorType: 'admin',
          action: isReleaseSwitch ? 'story_release.rollback_or_switch' : 'story_publication.transition',
          targetType: 'story_work',
          targetId: workId,
          metadata: {
            fromStatus: work.status,
            toStatus: body.toStatus,
            beforeRevision: work.releaseRevision,
            afterRevision,
            releaseVersion: release?.version ?? null,
          },
        },
      });
      return this.transitionProjection(transition, false);
    });
  }

  async releases(userId: string, workId: string) {
    await this.assertOwner(userId, workId);
    const rows = await this.prisma.storyRelease.findMany({
      where: { workId },
      orderBy: { version: 'desc' },
    });
    return rows.map((row) => this.releaseProjection(row));
  }

  async saveSlots(userId: string, workId: string) {
    const rows = await this.prisma.storySaveSlot.findMany({
      where: { userId, workId, status: 'active' },
      orderBy: { slotNumber: 'asc' },
    });
    return { minimumSlots: 3, slots: rows.map((row) => this.slotProjection(row)) };
  }

  async saveSlot(userId: string, workId: string, body: SaveStorySlotDto) {
    const progress = await this.prisma.storyReaderProgress.findUnique({
      where: { userId_workId: { userId, workId } },
    });
    if (!progress?.activeReleaseId) throw new NotFoundException('Pinned story progress not found');
    const checkpoint = body.checkpointId
      ? await this.prisma.storyProgressCheckpoint.findFirst({
          where: { id: body.checkpointId, progressId: progress.id, checkpointStatus: 'confirmed' },
        })
      : await this.prisma.storyProgressCheckpoint.findFirst({
          where: { progressId: progress.id, checkpointStatus: 'confirmed' },
          orderBy: { progressRevision: 'desc' },
        });
    if (!checkpoint) throw new NotFoundException('Confirmed checkpoint not found');
    const existing = await this.prisma.storySaveSlot.findUnique({
      where: { userId_workId_slotNumber: { userId, workId, slotNumber: body.slotNumber } },
    });
    if (existing && (!body.overwriteConfirmed || body.expectedRevision !== existing.revision)) {
      throw new ConflictException('Explicit slot overwrite confirmation is required');
    }
    const slot = await this.prisma.storySaveSlot.upsert({
      where: { userId_workId_slotNumber: { userId, workId, slotNumber: body.slotNumber } },
      create: {
        userId,
        workId,
        slotNumber: body.slotNumber,
        releaseId: progress.activeReleaseId,
        checkpointId: checkpoint.id,
        label: body.label,
      },
      update: {
        releaseId: progress.activeReleaseId,
        checkpointId: checkpoint.id,
        label: body.label,
        revision: { increment: 1 },
        status: 'active',
        savedAt: new Date(),
        clearedAt: null,
      },
    });
    return this.slotProjection(slot);
  }

  async clearSlot(userId: string, workId: string, slotNumber: number, body: ClearStorySlotDto) {
    if (!body.clearConfirmed) throw new BadRequestException('Explicit slot clear confirmation is required');
    const updated = await this.prisma.storySaveSlot.updateMany({
      where: { userId, workId, slotNumber, revision: body.expectedRevision, status: 'active' },
      data: { status: 'cleared', revision: { increment: 1 }, clearedAt: new Date() },
    });
    if (updated.count !== 1) throw new ConflictException('Save slot changed concurrently');
    return { slotNumber, cleared: true };
  }

  async endingGallery(userId: string, workId: string) {
    const endings = await this.prisma.storyEndingDiscovery.findMany({
      where: { userId, workId },
      orderBy: { firstSeenAt: 'desc' },
    });
    return endings.map((ending) => ({
      endingKey: ending.endingKey,
      endingKind: ending.endingKind,
      pathSignature: ending.pathSignature,
      provenance: ending.provenance,
      firstSeenAt: ending.firstSeenAt,
      lastSeenAt: ending.lastSeenAt,
    }));
  }

  async buildMemory(userId: string, workId: string, body: BuildStoryMemoryDto, idempotencyKey?: string) {
    await this.assertOwner(userId, workId);
    const key = this.idempotencyKey('story-memory', idempotencyKey);
    const existing = await this.prisma.storyMemoryRetrievalRun.findUnique({ where: { idempotencyKey: key } });
    if (existing) return this.memoryRunProjection(existing, true);
    const job = await this.prisma.storyAnalysisJob.findUnique({ where: { id: body.analysisJobId } });
    if (!job || job.status !== 'completed') throw new ConflictException('Completed analysis is required');
    const manuscript = await this.prisma.storyManuscriptVersion.findFirst({
      where: { id: job.manuscriptVersionId, workId, ownerUserId: userId },
    });
    if (!manuscript) throw new NotFoundException('Analysis source not found');
    if (this.economics && body.retrievalTypes.includes('style')) {
      const consent = await this.economics.activeStyleConsent(workId);
      if (!consent || consent.manuscriptVersionId !== manuscript.id) {
        throw new ConflictException(
          'Active style consent for this manuscript is required',
        );
      }
    }
    const evidence = await this.prisma.storyAnalysisEvidence.findMany({
      where: { analysisJobId: job.id },
      orderBy: [{ sourcePartKey: 'asc' }, { sourceParagraphIndex: 'asc' }],
      take: 1000,
    });
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.storyMemoryRetrievalRun.create({
        data: {
          workId,
          analysisJobId: job.id,
          idempotencyKey: key,
          currentPartKey: body.currentPartKey,
          retrievalTypes: body.retrievalTypes,
          checkpoint: 'evidence_loaded',
        },
      });
      const selectedIds: string[] = [];
      for (const item of evidence) {
        const memoryType = this.memoryType(item.evidenceType);
        if (!memoryType || !body.retrievalTypes.includes(memoryType)) continue;
        const memoryKey = `${item.sourcePartKey}:${item.evidenceType}:${item.sourceParagraphIndex}`;
        const memory = await tx.storyMemoryRecord.upsert({
          where: {
            analysisJobId_memoryType_memoryKey: {
              analysisJobId: job.id,
              memoryType,
              memoryKey,
            },
          },
          create: {
            workId,
            analysisJobId: job.id,
            manuscriptVersionId: manuscript.id,
            memoryType,
            memoryKey,
            partKey: item.sourcePartKey,
            content: item.payload as Prisma.InputJsonValue,
            evidenceIds: [item.id],
            provenance: 'writer_original',
          },
          update: {},
        });
        selectedIds.push(memory.id);
      }
      const completed = await tx.storyMemoryRetrievalRun.update({
        where: { id: run.id },
        data: {
          selectedMemoryIds: selectedIds.slice(0, 200),
          checkpoint: 'memory_index_completed',
          status: 'completed',
          completedAt: new Date(),
        },
      });
      return this.memoryRunProjection(completed, false);
    });
  }

  async retrieveMemory(userId: string, workId: string, query: StoryMemoryQueryDto) {
    await this.assertOwner(userId, workId);
    const types = (query.types ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    const styleConsent = this.economics
      ? await this.economics.activeStyleConsent(workId)
      : null;
    const allowedTypes = (types.length
      ? types
      : ['summary', 'scene', 'entity', 'event', 'foreshadow', 'branch', 'style']
    ).filter((type) => type !== 'style' || Boolean(styleConsent));
    if (!allowedTypes.length) {
      return { bounded: true, fullManuscriptIncluded: false, items: [] };
    }
    const rows = await this.prisma.storyMemoryRecord.findMany({
      where: {
        workId,
        status: 'approved',
        memoryType: { in: allowedTypes },
        OR: [
          { partKey: query.partKey },
          {
            memoryType: {
              in: ['entity', 'event', 'foreshadow', 'branch', ...(styleConsent ? ['style'] : [])],
            },
          },
        ],
      },
      orderBy: [{ partKey: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
    return {
      bounded: true,
      fullManuscriptIncluded: false,
      items: rows.map((row) => ({
        memoryType: row.memoryType,
        partKey: row.partKey,
        content: row.content,
        evidenceIds: row.evidenceIds,
        provenance: row.provenance,
        revision: row.revision,
      })),
    };
  }

  async openReview(userId: string, workId: string, body: OpenWriterReviewDto) {
    await this.assertOwner(userId, workId);
    const [manuscript, analysis] = await Promise.all([
      this.prisma.storyManuscriptVersion.findFirst({ where: { id: body.manuscriptVersionId, workId, ownerUserId: userId } }),
      this.prisma.storyAnalysisJob.findUnique({ where: { id: body.analysisJobId } }),
    ]);
    if (!manuscript || !analysis || analysis.manuscriptVersionId !== manuscript.id || analysis.status !== 'completed') {
      throw new ConflictException('Completed actual analysis is required');
    }
    const review = await this.prisma.storyWriterReview.upsert({
      where: {
        workId_manuscriptVersionId_analysisJobId: {
          workId,
          manuscriptVersionId: manuscript.id,
          analysisJobId: analysis.id,
        },
      },
      create: {
        workId,
        ownerUserId: userId,
        manuscriptVersionId: manuscript.id,
        analysisJobId: analysis.id,
        state: 'analysis_ready',
      },
      update: {},
    });
    return this.reviewProjection(review);
  }

  async transitionReview(userId: string, reviewId: string, body: TransitionWriterReviewDto) {
    const review = await this.prisma.storyWriterReview.findFirst({ where: { id: reviewId, ownerUserId: userId } });
    if (!review) throw new NotFoundException('Writer review not found');
    if (review.revision !== body.expectedRevision) throw new ConflictException('Writer review changed concurrently');
    if (!canTransitionReview(review.state, body.toState)) throw new BadRequestException('Review transition is not allowed');
    if (body.toState === 'final_confirmation') {
      const issues = await this.prisma.storyContinuityIssue.findMany({
        where: { workId: review.workId, analysisJobId: review.analysisJobId, status: 'open' },
        select: { severity: true },
      });
      if (issues.some((issue) => issue.severity === 'critical')) throw new ConflictException('Critical continuity issue blocks confirmation');
      if (issues.some((issue) => issue.severity === 'warning') && body.decisions?.warningAcknowledged !== true) {
        throw new ConflictException('Warning decision is required');
      }
    }
    const updated = await this.prisma.storyWriterReview.updateMany({
      where: { id: review.id, ownerUserId: userId, revision: body.expectedRevision },
      data: {
        state: body.toState,
        decisions: body.decisions as Prisma.InputJsonValue | undefined,
        finalSummary: body.finalSummary as Prisma.InputJsonValue | undefined,
        revision: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (updated.count !== 1) throw new ConflictException('Writer review changed concurrently');
    const current = await this.prisma.storyWriterReview.findUniqueOrThrow({ where: { id: review.id } });
    const work = await this.prisma.storyWork.findUnique({
      where: { id: review.workId },
      select: { activeReleaseId: true },
    });
    await this.recordQualityEvent({
      workId: review.workId,
      releaseId: work?.activeReleaseId ?? null,
      sessionKeyHash: createHash('sha256').update(`writer-review:${review.id}`).digest('hex'),
      eventType: 'writer_review_transition',
      metricBucket: 'writer_revision',
      dimensions: { fromState: review.state, toState: body.toState },
      idempotencyKey: `writer-review:${review.id}:${body.expectedRevision}`,
    });
    return this.reviewProjection(current);
  }

  async submitReview(userId: string, reviewId: string, idempotencyKey?: string) {
    const key = this.idempotencyKey('story-final-submit', idempotencyKey);
    const existing = await this.prisma.storyFinalSubmission.findUnique({ where: { idempotencyKey: key } });
    if (existing) return this.submissionProjection(existing, true);
    const existingForReview = await this.prisma.storyFinalSubmission.findUnique({
      where: { reviewId },
    });
    if (existingForReview) return this.submissionProjection(existingForReview, true);
    return this.prisma.$transaction(async (tx) => {
      const review = await tx.storyWriterReview.findFirst({ where: { id: reviewId, ownerUserId: userId } });
      if (!review) throw new NotFoundException('Writer review not found');
      if (review.state !== 'final_confirmation' && review.state !== 'submission_failed') {
        throw new ConflictException('Final confirmation is required');
      }
      const manuscript = await tx.storyManuscriptVersion.findUnique({ where: { id: review.manuscriptVersionId } });
      if (!manuscript) throw new NotFoundException('Manuscript version not found');
      const submission = await tx.storyFinalSubmission.create({
        data: {
          reviewId: review.id,
          manuscriptVersionId: manuscript.id,
          idempotencyKey: key,
          checksum: manuscript.contentHash,
        },
      });
      await tx.storyWriterReview.update({
        where: { id: review.id },
        data: { state: 'submitted', revision: { increment: 1 }, submittedAt: new Date(), updatedAt: new Date() },
      });
      return this.submissionProjection(submission, false);
    });
  }

  async aggregateQuality(userId: string, workId: string, body: AggregateStoryQualityDto) {
    await this.assertOwner(userId, workId);
    const release = await this.prisma.storyRelease.findFirst({ where: { id: body.releaseId, workId } });
    if (!release) throw new NotFoundException('Story release not found');
    const [events, continuityIssues, foreshadowEntries] = await Promise.all([
      this.prisma.storyQualityEvent.findMany({
        where: { workId, releaseId: release.id },
        select: { eventType: true, numericValue: true, dimensions: true, sessionKeyHash: true },
        take: 100000,
      }),
      this.prisma.storyContinuityIssue.findMany({
        where: { workId },
        select: { status: true },
        take: 10000,
      }),
      this.prisma.storyContinuityEntry.findMany({
        where: { workId, entryType: { in: ['foreshadow', 'payoff'] } },
        select: { entryType: true, label: true },
        take: 10000,
      }),
    ]);
    const starts = new Set(
      events.filter((event) => event.eventType === 'session_started').map((event) => event.sessionKeyHash),
    ).size;
    const completions = new Set(
      events.filter((event) => event.eventType === 'ending_reached').map((event) => event.sessionKeyHash),
    ).size;
    const replays = events.filter((event) => event.eventType === 'reset_completed').length;
    const choices = events.filter((event) => event.eventType === 'choice_selected');
    const divergent = choices.filter(
      (event) => (event.dimensions as Record<string, unknown>).choiceOutcomeKind !== 'immediate_convergence',
    ).length;
    const rejoins = choices.filter(
      (event) => (event.dimensions as Record<string, unknown>).rejoinDeclared === true,
    ).length;
    const endingKinds = new Set(
      events
        .filter((event) => event.eventType === 'ending_reached')
        .map((event) => String((event.dimensions as Record<string, unknown>).endingKind ?? 'unknown')),
    ).size;
    const reviewEvents = events.filter((event) => event.eventType === 'writer_review_transition');
    const revisionEvents = reviewEvents.filter(
      (event) => (event.dimensions as Record<string, unknown>).toState === 'editing',
    ).length;
    const foreshadowLabels = new Set(
      foreshadowEntries
        .filter((entry) => entry.entryType === 'foreshadow')
        .map((entry) => entry.label.toLowerCase()),
    );
    const payoffLabels = new Set(
      foreshadowEntries
        .filter((entry) => entry.entryType === 'payoff')
        .map((entry) => entry.label.toLowerCase()),
    );
    const resolvedForeshadow = [...foreshadowLabels].filter((label) => payoffLabels.has(label)).length;
    const aiCosts = events
      .filter((event) => event.eventType === 'new_ai_route_completed' && event.numericValue)
      .map((event) => Number(event.numericValue!.toString()));
    const metrics: Array<{
      metricKey: string;
      sampleCount: number;
      numerator?: number;
      denominator?: number;
      measuredValue?: number;
    }> = [
      ...(starts > 0
        ? [
            {
              metricKey: 'reader_completion_rate',
              sampleCount: starts,
              numerator: completions,
              denominator: starts,
              measuredValue: completions / starts,
            },
            {
              metricKey: 'reader_replay_rate',
              sampleCount: starts,
              numerator: replays,
              denominator: starts,
              measuredValue: replays / starts,
            },
          ]
        : []),
      ...(choices.length > 0
        ? [
            {
              metricKey: 'choice_next_scene_divergence_rate',
              sampleCount: choices.length,
              numerator: divergent,
              denominator: choices.length,
              measuredValue: divergent / choices.length,
            },
            {
              metricKey: 'declared_rejoin_rate',
              sampleCount: choices.length,
              numerator: rejoins,
              denominator: choices.length,
              measuredValue: rejoins / choices.length,
            },
          ]
        : []),
      ...(endingKinds > 0
        ? [{ metricKey: 'ending_diversity', sampleCount: completions, measuredValue: endingKinds }]
        : []),
      ...(continuityIssues.length > 0
        ? [
            {
              metricKey: 'continuity_finding_resolution_rate',
              sampleCount: continuityIssues.length,
              numerator: continuityIssues.filter((issue) => issue.status !== 'open').length,
              denominator: continuityIssues.length,
              measuredValue:
                continuityIssues.filter((issue) => issue.status !== 'open').length /
                continuityIssues.length,
            },
          ]
        : []),
      ...(foreshadowLabels.size > 0
        ? [
            {
              metricKey: 'foreshadow_resolution_rate',
              sampleCount: foreshadowLabels.size,
              numerator: resolvedForeshadow,
              denominator: foreshadowLabels.size,
              measuredValue: resolvedForeshadow / foreshadowLabels.size,
            },
          ]
        : []),
      ...(reviewEvents.length > 0
        ? [
            {
              metricKey: 'writer_revision_rate',
              sampleCount: reviewEvents.length,
              numerator: revisionEvents,
              denominator: reviewEvents.length,
              measuredValue: revisionEvents / reviewEvents.length,
            },
          ]
        : []),
      ...(aiCosts.length > 0
        ? [
            {
              metricKey: 'new_ai_route_cost_by_release',
              sampleCount: aiCosts.length,
              measuredValue: aiCosts.reduce((sum, value) => sum + value, 0),
            },
          ]
        : []),
    ];
    const saved = [];
    for (const metric of metrics) {
      saved.push(
        await this.prisma.storyQualityAggregate.upsert({
          where: {
            workId_releaseId_metricKey: {
              workId,
              releaseId: release.id,
              metricKey: metric.metricKey,
            },
          },
          create: { workId, releaseId: release.id, ...metric },
          update: { ...metric, measuredAt: new Date() },
        }),
      );
    }
    return { measured: true, fabricated: false, metrics: saved };
  }

  async qualityMetrics(userId: string, workId: string) {
    await this.assertOwner(userId, workId);
    return this.prisma.storyQualityAggregate.findMany({
      where: { workId },
      orderBy: { measuredAt: 'desc' },
    });
  }

  async recordQualityEvent(input: {
    workId: string;
    releaseId: string | null;
    sessionKeyHash: string;
    eventType: string;
    metricBucket: string;
    dimensions: Record<string, unknown>;
    idempotencyKey: string;
  }) {
    const violations = qualityDimensionViolations(input.dimensions);
    if (violations.length) throw new BadRequestException('Unsafe quality event dimensions');
    return this.prisma.storyQualityEvent.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      create: { ...input, dimensions: input.dimensions as Prisma.InputJsonValue },
      update: {},
    });
  }

  private async assertOwner(userId: string, workId: string) {
    const work = await this.prisma.storyWork.findFirst({ where: { id: workId, ownerUserId: userId } });
    if (!work) throw new NotFoundException('Story work not found');
    return work;
  }

  private releaseProjection(release: any) {
    return {
      id: release.id,
      version: release.version,
      status: release.status,
      checksum: release.checksum,
      validationSummary: release.validationSummary,
      diffSummary: release.diffSummary,
      activatedAt: release.activatedAt,
      retiredAt: release.retiredAt,
      createdAt: release.createdAt,
    };
  }

  private transitionProjection(value: any, idempotentReplay: boolean) {
    return {
      transitionId: value.id,
      fromStatus: value.fromStatus,
      toStatus: value.toStatus,
      beforeRevision: value.beforeRevision,
      afterRevision: value.afterRevision,
      changedAt: value.createdAt,
      idempotentReplay,
    };
  }

  private slotProjection(slot: any) {
    return {
      slotNumber: slot.slotNumber,
      label: slot.label,
      revision: slot.revision,
      releaseId: slot.releaseId,
      checkpointId: slot.checkpointId,
      savedAt: slot.savedAt,
    };
  }

  private memoryRunProjection(run: any, idempotentReplay: boolean) {
    return {
      runId: run.id,
      status: run.status,
      checkpoint: run.checkpoint,
      selectedMemoryCount: Array.isArray(run.selectedMemoryIds) ? run.selectedMemoryIds.length : 0,
      idempotentReplay,
    };
  }

  private reviewProjection(review: any) {
    return {
      reviewId: review.id,
      state: review.state,
      revision: review.revision,
      decisions: review.decisions,
      finalSummary: review.finalSummary,
      submittedAt: review.submittedAt,
      updatedAt: review.updatedAt,
    };
  }

  private submissionProjection(submission: any, idempotentReplay: boolean) {
    return {
      submissionId: submission.id,
      status: submission.status,
      submittedAt: submission.createdAt,
      idempotentReplay,
    };
  }

  private memoryType(evidenceType: string) {
    const map: Record<string, string> = {
      scene: 'scene',
      beat: 'scene',
      dialogue: 'scene',
      entity: 'entity',
      cast: 'entity',
      event: 'event',
      time: 'event',
      place: 'event',
      foreshadow: 'foreshadow',
      payoff: 'foreshadow',
      branch_candidate: 'branch',
      background: 'style',
    };
    return map[evidenceType] ?? null;
  }

  private nextPublicationAction(status: string) {
    const keys: Record<string, string> = {
      draft: 'story.publish.next.submitIntake',
      intake_received: 'story.publish.next.startReview',
      reviewing: 'story.publish.next.resolveReview',
      revision_requested: 'story.publish.next.uploadRevision',
      release_ready: 'story.publish.next.authorizePublish',
      published: 'story.publish.next.monitorRelease',
      sale_suspended: 'story.publish.next.resumeOrArchive',
      archived: 'story.publish.next.none',
    };
    return keys[status] ?? 'story.publish.next.contactSupport';
  }

  private idempotencyKey(prefix: string, value?: string) {
    const normalized = value?.trim();
    if (!normalized || normalized.length < 8 || normalized.length > 200) {
      throw new BadRequestException('A valid Idempotency-Key header is required');
    }
    return `${prefix}:${createHash('sha256').update(normalized).digest('hex')}`;
  }

  private stale(currentRevision: number): never {
    throw new ConflictException({
      code: 'STORY_RELEASE_STALE_REVISION',
      messageKey: 'story.release.error.staleRevision',
      currentRevision,
      retryable: true,
    });
  }
}

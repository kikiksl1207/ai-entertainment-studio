import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  assertAtomicWalletDebitSucceeded,
  requireWalletMutationIdempotencyKey,
  throwWalletMutationIdempotencyConflict,
} from '../common/wallet-mutation-safety';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateManuscriptVersionDto,
  DecideContinuityIssueDto,
  StartStoryProgressDto,
  StoryCatalogQueryDto,
  StoryLocaleQueryDto,
  UpdateBeatProgressDto,
} from './dto/story-production.dto';
import {
  analyzeStructuredManuscript,
  boundedPath,
  deriveContinuityLedger,
  hasActiveEntitlement,
  isPublicStorySourceSafe,
  manuscriptContentHash,
  projectLocalizedValue,
  projectStoryGraphValidationSummary,
} from './story-production.policy';
import { sessionKeyHash, storyPathSignature } from './story-lifecycle.policy';
import { StoryEconomicsService } from './story-economics.service';
import { projectStoredStorySceneVisualManifest } from '../story-stage/story-scene-visual-manifest-contract';

const STORY_ENTITLEMENT_TYPES = [
  'story_work',
  'story_season',
  'story_part',
  'story_author_ending',
];
const CURRENCY = 'LUMINA';

@Injectable()
export class StoryProductionService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly economics?: StoryEconomicsService,
  ) {}

  async catalog(userId: string | undefined, query: StoryCatalogQueryDto) {
    const rows = await this.prisma.storyWork.findMany({
      where: {
        status: 'published',
        fixtureSource: false,
        activeReleaseId: { not: null },
        publishedAt: { lte: new Date() },
      },
      select: {
        id: true,
        slug: true,
        defaultLocale: true,
        title: true,
        summary: true,
        coverManifest: true,
        priceLumina: true,
        fixtureSource: true,
        publishedAt: true,
        activeReleaseId: true,
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    const activeReleases = await this.prisma.storyRelease.findMany({
      where: {
        id: { in: rows.map((row) => row.activeReleaseId).filter((id): id is string => Boolean(id)) },
        status: 'active',
      },
      select: { id: true },
    });
    const activeReleaseIds = new Set(activeReleases.map((release) => release.id));
    const safeRows = rows.filter((row) =>
      isPublicStorySourceSafe({
        fixtureSource: row.fixtureSource,
        slug: row.slug,
        manifest: row.coverManifest,
      }) && Boolean(row.activeReleaseId && activeReleaseIds.has(row.activeReleaseId)),
    );
    const page = safeRows.slice(0, query.limit);
    const entitledIds = await this.entitledReferenceIds(
      userId,
      page.map((row) => row.id),
    );
    const capabilities = this.economics
      ? new Map(
          await Promise.all(
            page.map(async (row) => [
              row.id,
              await this.economics!.publicCapabilityByRelease(row.activeReleaseId),
            ] as const),
          ),
        )
      : null;

    return {
      items: page.map((row) => {
        const title = projectLocalizedValue(row.title, query.locale, row.defaultLocale);
        const summary = projectLocalizedValue(row.summary, query.locale, row.defaultLocale);
        const entitled = entitledIds.has(row.id);
        return {
          id: row.id,
          slug: row.slug,
          title,
          summary,
          cover: row.coverManifest,
          publishedAt: row.publishedAt,
          access: {
            entitled,
            priceLumina: entitled ? null : row.priceLumina.toString(),
            purchaseAction: entitled ? null : 'purchase',
          },
          releaseCapability: capabilities?.get(row.id) ?? null,
        };
      }),
      nextCursor: safeRows.length > query.limit ? page.at(-1)?.id ?? null : null,
    };
  }

  async detail(slug: string, userId: string | undefined, query: StoryLocaleQueryDto) {
    const work = await this.prisma.storyWork.findFirst({
      where: {
        slug,
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
    const activeRelease = await this.prisma.storyRelease.findFirst({
      where: { id: work.activeReleaseId!, workId: work.id, status: 'active' },
    });
    if (!activeRelease) throw new NotFoundException('Published story not found');

    const parts = await this.prisma.storyPart.findMany({
      where: {
        workId: work.id,
        status: 'published',
        fixtureSource: false,
        publishedAt: { lte: new Date() },
      },
      orderBy: { position: 'asc' },
    });
    const referenceIds = [work.id, ...parts.map((part) => part.id)];
    const entitledIds = await this.entitledReferenceIds(userId, referenceIds);
    const workEntitled = entitledIds.has(work.id) || work.priceLumina.isZero();
    const progress = userId
      ? await this.prisma.storyReaderProgress.findUnique({
          where: { userId_workId: { userId, workId: work.id } },
        })
      : null;
    const endingRecords = progress
      ? await this.prisma.storyChoiceEvent.findMany({
          where: { progressId: progress.id, endingKey: { not: null } },
          select: { endingKey: true, endingType: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          distinct: ['endingKey'],
        })
      : [];
    const releaseCapability = this.economics
      ? await this.economics.publicCapabilityByRelease(work.activeReleaseId)
      : null;

    return {
      id: work.id,
      slug: work.slug,
      title: projectLocalizedValue(work.title, query.locale, work.defaultLocale),
      summary: projectLocalizedValue(work.summary, query.locale, work.defaultLocale),
      cover: work.coverManifest,
      parts: parts.map((part) => {
        const entitled = workEntitled || entitledIds.has(part.id) || part.priceLumina.isZero();
        return {
          id: part.id,
          seasonKey: part.seasonKey,
          position: part.position,
          title: projectLocalizedValue(part.title, query.locale, work.defaultLocale),
          access: {
            entitled,
            priceLumina: entitled ? null : part.priceLumina.toString(),
            purchaseAction: entitled ? null : 'purchase',
          },
        };
      }),
      access: {
        entitled: workEntitled,
        priceLumina: workEntitled ? null : work.priceLumina.toString(),
        purchaseAction: workEntitled ? null : 'purchase',
      },
      replay: userId
        ? {
            continue: Boolean(progress?.currentSceneId),
            restart: workEntitled,
            checkpoint: Boolean(progress?.checkpointSceneId),
            branchReplay: workEntitled,
            chargeRequired: false,
            newAiPathGeneration: {
              separateUsage: true,
              enabled: releaseCapability?.customChoiceEnabled ?? false,
            },
          }
        : null,
      endingRecords,
      releaseCapability,
    };
  }

  async purchaseWork(userId: string, workId: string, idempotencyKey?: string) {
    const key = requireWalletMutationIdempotencyKey(idempotencyKey);
    const work = await this.publicWorkById(workId);
    const active = await this.hasEntitlement(userId, [work.id]);
    if (active || work.priceLumina.isZero()) {
      return { entitled: true, charged: false, idempotentReplay: true };
    }

    return this.prisma.$transaction(async (tx) => {
      const ledgerKey = `story-work:${key}`;
      const existingLedger = await tx.walletLedger.findUnique({
        where: { idempotencyKey: ledgerKey },
      });
      if (existingLedger) {
        this.assertPurchaseReplay(existingLedger, work.id, work.priceLumina);
        const entitlement = await tx.userEntitlement.findUnique({
          where: {
            userId_entitlementType_referenceType_referenceId: {
              userId,
              entitlementType: 'story_work',
              referenceType: 'story_work',
              referenceId: work.id,
            },
          },
        });
        if (!entitlement) throwWalletMutationIdempotencyConflict();
        return { entitled: true, charged: false, idempotentReplay: true };
      }

      const existing = await tx.userEntitlement.findUnique({
        where: {
          userId_entitlementType_referenceType_referenceId: {
            userId,
            entitlementType: 'story_work',
            referenceType: 'story_work',
            referenceId: work.id,
          },
        },
      });
      if (existing && hasActiveEntitlement([existing])) {
        return { entitled: true, charged: false, idempotentReplay: true };
      }

      const wallet = await tx.walletAccount.findUnique({
        where: { userId_currencyCode: { userId, currencyCode: CURRENCY } },
      });
      if (!wallet || wallet.status !== 'active') {
        throw new BadRequestException('Active wallet not found');
      }
      const updated = await tx.walletAccount.updateMany({
        where: { id: wallet.id, cachedBalance: { gte: work.priceLumina } },
        data: { cachedBalance: { decrement: work.priceLumina } },
      });
      assertAtomicWalletDebitSucceeded(updated);
      const ledger = await tx.walletLedger.create({
        data: {
          walletAccountId: wallet.id,
          direction: 'debit',
          amount: work.priceLumina,
          ledgerType: 'story_purchase',
          referenceType: 'story_work',
          referenceId: work.id,
          idempotencyKey: ledgerKey,
          memo: 'Story work entitlement purchase',
        },
      });
      await tx.userEntitlement.upsert({
        where: {
          userId_entitlementType_referenceType_referenceId: {
            userId,
            entitlementType: 'story_work',
            referenceType: 'story_work',
            referenceId: work.id,
          },
        },
        create: {
          userId,
          entitlementType: 'story_work',
          referenceType: 'story_work',
          referenceId: work.id,
          grantedByReferenceType: 'wallet_ledger',
          grantedByReferenceId: ledger.id,
        },
        update: {
          revokedAt: null,
          expiresAt: null,
          startsAt: new Date(),
          grantedByReferenceType: 'wallet_ledger',
          grantedByReferenceId: ledger.id,
        },
      });
      return { entitled: true, charged: true, idempotentReplay: false };
    });
  }

  async startProgress(userId: string, workId: string, body: StartStoryProgressDto) {
    const work = await this.publicWorkById(workId);
    const parts = await this.prisma.storyPart.findMany({
      where: { workId, status: 'published', fixtureSource: false },
      select: { id: true, actNumber: true },
      orderBy: { position: 'asc' },
    });
    if (!parts.length) throw new NotFoundException('Published story part not found');
    const entitled = work.priceLumina.isZero() || (await this.hasEntitlement(userId, [work.id, ...parts.map((part) => part.id)]));
    if (!entitled) throw new ForbiddenException('Story entitlement required');
    const firstScene = await this.prisma.storyScene.findFirst({
      where: { partId: { in: parts.map((part) => part.id) }, status: 'published', fixtureSource: false },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    if (!firstScene) throw new NotFoundException('Published story scene not found');

    const existing = await this.prisma.storyReaderProgress.findUnique({
      where: { userId_workId: { userId, workId } },
    });
    if (existing && body.mode !== 'continue') {
      throw new BadRequestException({
        code: 'STORY_PROGRESS_CONTROL_COMMAND_REQUIRED',
        messageKey:
          body.mode === 'restart'
            ? 'story.progress.reset.previewRequired'
            : 'story.progress.checkpoint.confirmRequired',
        retryable: true,
      });
    }
    if (existing) {
      if (existing.storyVersion !== work.publishedVersion) {
        throw new ConflictException({
          code: 'STORY_PROGRESS_VERSION_MISMATCH',
          messageKey: 'story.progress.status.versionMismatch',
          retryable: false,
        });
      }
      return this.currentProgress(userId, existing.id, body.locale);
    }
    if (body.mode === 'checkpoint') {
      throw new BadRequestException('Checkpoint is not available');
    }
    const targetSceneId = firstScene.id;
    const sessionPin =
      this.economics && work.activeReleaseId
        ? await this.economics.releaseSessionPin(work.activeReleaseId)
        : null;
    const progress = await this.prisma.storyReaderProgress.create({
      data: {
        userId,
        workId,
        currentSceneId: targetSceneId,
        currentBeatPosition: 0,
        currentAct: parts.find((part) => part.id === firstScene.partId)?.actNumber ?? 1,
        storyVersion: work.publishedVersion,
        activeReleaseId: work.activeReleaseId,
        aiRateCardId: sessionPin?.aiRateCardId,
        capabilityRevision: sessionPin?.capabilityRevision,
        checkpointSceneId: targetSceneId,
        seenSceneIds: [targetSceneId],
        pathSummary: [],
      },
    });
    await this.prisma.storyQualityEvent.upsert({
      where: { idempotencyKey: `session-start:${progress.id}` },
      create: {
        workId,
        releaseId: progress.activeReleaseId,
        sessionKeyHash: sessionKeyHash(progress.id),
        eventType: 'session_started',
        metricBucket: 'story_session',
        dimensions: { storyVersion: progress.storyVersion },
        idempotencyKey: `session-start:${progress.id}`,
      },
      update: {},
    });
    return this.currentProgress(userId, progress.id, body.locale);
  }

  async currentProgress(userId: string, progressId: string, locale = 'ko') {
    const progress = await this.prisma.storyReaderProgress.findFirst({
      where: { id: progressId, userId },
    });
    if (!progress) throw new NotFoundException('Story progress not found');
    if (!progress.currentSceneId) {
      return {
        progressId,
        status: progress.status,
        revision: progress.progressRevision,
        storyVersion: progress.storyVersion,
        currentAct: progress.currentAct,
        scene: null,
        choices: [],
        path: boundedPath(jsonArray(progress.pathSummary)),
      };
    }
    return this.sceneProjection(progress, locale);
  }

  async updateBeatProgress(
    userId: string,
    progressId: string,
    body: UpdateBeatProgressDto,
    locale = 'ko',
  ) {
    const progress = await this.prisma.storyReaderProgress.findFirst({
      where: { id: progressId, userId },
    });
    if (!progress?.currentSceneId) {
      throw new NotFoundException('Active story progress not found');
    }
    if (progress.status !== 'active') {
      throw new ConflictException('Story progress is not ready for beat updates');
    }
    if (progress.progressRevision !== body.expectedRevision) {
      throw new ConflictException({
        code: 'STORY_PROGRESS_STALE_REVISION',
        messageKey: 'story.progress.error.staleRevision',
        retryable: true,
        currentRevision: progress.progressRevision,
      });
    }
    const beat = await this.prisma.storyBeat.findUnique({
      where: {
        sceneId_position: {
          sceneId: progress.currentSceneId,
          position: body.position,
        },
      },
    });
    if (!beat && body.position !== 0) {
      throw new BadRequestException(
        'Beat position is not available for the current scene',
      );
    }
    const updated = await this.prisma.storyReaderProgress.updateMany({
      where: {
        id: progress.id,
        userId,
        progressRevision: body.expectedRevision,
      },
      data: {
        currentBeatPosition: body.position,
        progressRevision: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        code: 'STORY_PROGRESS_STALE_REVISION',
        messageKey: 'story.progress.error.staleRevision',
        retryable: true,
      });
    }
    return this.currentProgress(userId, progressId, locale);
  }

  async selectChoice(
    userId: string,
    progressId: string,
    choiceId: string,
    expectedRevision: number,
    locale = 'ko',
  ) {
    await this.prisma.$transaction(async (tx) => {
      const progress = await tx.storyReaderProgress.findFirst({ where: { id: progressId, userId } });
      if (!progress?.currentSceneId) throw new NotFoundException('Active story progress not found');
      if (progress.status !== 'active') {
        throw new ConflictException('Story progress is awaiting another command');
      }
      if (progress.progressRevision !== expectedRevision) {
        throw new ConflictException({
          code: 'STORY_PROGRESS_STALE_REVISION',
          messageKey: 'story.progress.error.staleRevision',
          retryable: true,
          currentRevision: progress.progressRevision,
        });
      }
      const choice = await tx.storyChoice.findFirst({ where: { id: choiceId, sceneId: progress.currentSceneId } });
      if (!choice) throw new BadRequestException('Choice is not available for the current scene');
      const target = choice.targetSceneId
        ? await tx.storyScene.findFirst({ where: { id: choice.targetSceneId, status: 'published', fixtureSource: false } })
        : null;
      if (choice.targetSceneId && !target) throw new ConflictException('Choice target is unavailable');
      const endingType = target?.endingType ?? (choice.targetEndingKey ? 'author_sub' : null);
      const targetPart = target
        ? await tx.storyPart.findUnique({ where: { id: target.partId } })
        : null;
      const path = boundedPath([
        ...jsonArray(progress.pathSummary),
        {
          sceneId: progress.currentSceneId,
          choiceId: choice.id,
          nextSceneId: target?.id ?? null,
          explicitRejoin: Boolean(choice.declaredRejoinSceneId),
        },
      ]);
      const seen = [...new Set([...jsonStringArray(progress.seenSceneIds), ...(target ? [target.id] : [])])];
      await tx.storyChoiceEvent.create({
        data: {
          progressId,
          sceneId: progress.currentSceneId,
          choiceId: choice.id,
          targetSceneId: target?.id,
          endingKey: choice.targetEndingKey,
          endingType,
          explicitRejoin: Boolean(choice.declaredRejoinSceneId),
        },
      });
      if (choice.targetEndingKey && progress.activeReleaseId) {
        const signature = storyPathSignature(path);
        await tx.storyEndingDiscovery.upsert({
          where: {
            userId_releaseId_endingKey_pathSignature: {
              userId,
              releaseId: progress.activeReleaseId,
              endingKey: choice.targetEndingKey,
              pathSignature: signature,
            },
          },
          create: {
            userId,
            workId: progress.workId,
            releaseId: progress.activeReleaseId,
            endingKey: choice.targetEndingKey,
            endingKind: endingType ?? 'author_sub',
            pathSignature: signature,
            provenance: endingType === 'ai_generated' ? 'ai_generated' : 'writer_original',
          },
          update: { lastSeenAt: new Date() },
        });
      }
      await tx.storyQualityEvent.upsert({
        where: { idempotencyKey: `choice:${progress.id}:${expectedRevision}` },
        create: {
          workId: progress.workId,
          releaseId: progress.activeReleaseId,
          sessionKeyHash: sessionKeyHash(progress.id),
          eventType: choice.targetEndingKey ? 'ending_reached' : 'choice_selected',
          metricBucket: 'story_path',
          dimensions: {
            choiceOutcomeKind: choice.routeKind,
            endingKind: endingType,
            rejoinDeclared: Boolean(choice.declaredRejoinSceneId),
          },
          idempotencyKey: `choice:${progress.id}:${expectedRevision}`,
        },
        update: {},
      });
      const updated = await tx.storyReaderProgress.updateMany({
        where: { id: progress.id, userId, progressRevision: expectedRevision },
        data: {
          currentSceneId: endingType ? null : target?.id,
          currentBeatPosition: 0,
          currentAct: targetPart?.actNumber ?? progress.currentAct,
          progressRevision: { increment: 1 },
          checkpointSceneId: target?.id ?? progress.checkpointSceneId,
          pathSummary: path as Prisma.InputJsonValue,
          seenSceneIds: seen,
          visitedEndingKeys: choice.targetEndingKey
            ? [
                ...new Set([
                  ...jsonStringArray(progress.visitedEndingKeys),
                  choice.targetEndingKey,
                ]),
              ]
            : undefined,
          status: endingType ? 'completed' : 'active',
          updatedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({
          code: 'STORY_PROGRESS_STALE_REVISION',
          messageKey: 'story.progress.error.staleRevision',
          retryable: true,
        });
      }
    });
    return this.currentProgress(userId, progressId, locale);
  }

  async graph(
    userId: string,
    workId: string,
    focusSceneId?: string,
    locale = 'ko',
  ) {
    const work = await this.assertOwner(userId, workId);
    const parts = await this.prisma.storyPart.findMany({
      where: { workId, fixtureSource: false },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        seasonKey: true,
        actNumber: true,
        position: true,
        status: true,
        title: true,
      },
    });
    const partIds = parts.map((part) => part.id);
    const scene = focusSceneId
      ? await this.prisma.storyScene.findFirst({
          where: {
            id: focusSceneId,
            partId: { in: partIds },
            fixtureSource: false,
          },
          select: {
            id: true,
            partId: true,
            sceneKey: true,
            position: true,
            status: true,
            title: true,
            endingType: true,
          },
        })
      : await this.prisma.storyScene.findFirst({
          where: { partId: { in: partIds }, fixtureSource: false },
          orderBy: { position: 'asc' },
          select: {
            id: true,
            partId: true,
            sceneKey: true,
            position: true,
            status: true,
            title: true,
            endingType: true,
          },
        });
    if (!scene) throw new NotFoundException('Story scene not found');
    const choices = await this.prisma.storyChoice.findMany({
      where: { sceneId: scene.id },
      orderBy: { position: 'asc' },
      take: 20,
      select: {
        id: true,
        choiceKey: true,
        label: true,
        targetSceneId: true,
        targetEndingKey: true,
        routeKind: true,
        declaredRejoinSceneId: true,
      },
    });
    const destinationIds = [...new Set(choices.flatMap((choice) => [choice.targetSceneId, choice.declaredRejoinSceneId]).filter((id): id is string => Boolean(id)))];
    const destinations = await this.prisma.storyScene.findMany({
      where: {
        id: { in: destinationIds },
        partId: { in: partIds },
        fixtureSource: false,
      },
      select: {
        id: true,
        partId: true,
        sceneKey: true,
        position: true,
        status: true,
        title: true,
        endingType: true,
      },
    });
    const parentCandidates = await this.prisma.storyChoice.findMany({
      where: { targetSceneId: scene.id },
      select: {
        sceneId: true,
        routeKind: true,
        declaredRejoinSceneId: true,
      },
      take: 20,
    });
    const parentScenes = await this.prisma.storyScene.findMany({
      where: {
        id: { in: parentCandidates.map((parent) => parent.sceneId) },
        partId: { in: partIds },
        fixtureSource: false,
      },
      select: { id: true },
    });
    const parentSceneIds = new Set(parentScenes.map((parent) => parent.id));
    const release = await this.prisma.storyRelease.findFirst({
      where: work.activeReleaseId
        ? { id: work.activeReleaseId, workId }
        : { workId },
      orderBy: { createdAt: 'desc' },
      select: { validationSummary: true },
    });
    const currentPart = parts.find((part) => part.id === scene.partId)!;
    const destinationById = new Map(
      destinations.map((destination) => [destination.id, destination]),
    );
    return {
      vocabulary: ['scene', 'choice', 'branch', 'rejoin', 'ending'],
      part: {
        id: currentPart.id,
        seasonKey: currentPart.seasonKey,
        actNumber: currentPart.actNumber,
        position: currentPart.position,
        status: currentPart.status,
        title: projectLocalizedValue(
          currentPart.title,
          locale,
          work.defaultLocale,
        ),
      },
      focus: {
        id: scene.id,
        sceneKey: scene.sceneKey,
        position: scene.position,
        status: scene.status,
        title: projectLocalizedValue(scene.title, locale, work.defaultLocale),
        endingType: scene.endingType,
      },
      parents: parentCandidates.filter((parent) =>
        parentSceneIds.has(parent.sceneId),
      ),
      choices: choices.map((choice) => ({
        id: choice.id,
        choiceKey: choice.choiceKey,
        label: projectLocalizedValue(choice.label, locale, work.defaultLocale),
        targetSceneId: choice.targetSceneId,
        targetEndingKey: choice.targetEndingKey,
        routeKind: choice.routeKind,
        explicitRejoin: Boolean(choice.declaredRejoinSceneId),
        declaredRejoinSceneId: choice.declaredRejoinSceneId,
        nextScene: choice.targetSceneId
          ? projectGraphScene(
              destinationById.get(choice.targetSceneId),
              locale,
              work.defaultLocale,
            )
          : null,
      })),
      destinations: destinations.map((destination) =>
        projectGraphScene(destination, locale, work.defaultLocale),
      ),
      validation: projectStoryGraphValidationSummary(
        release?.validationSummary,
      ),
      page: { bounded: true, maxChoices: 20, fullGraphIncluded: false },
    };
  }

  async createManuscriptVersion(userId: string, workId: string, body: CreateManuscriptVersionDto) {
    await this.assertOwner(userId, workId);
    const structuredBody = { parts: body.parts };
    const contentHash = manuscriptContentHash(structuredBody);
    return this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.storyManuscriptVersion.findUnique({
        where: { workId_contentHash: { workId, contentHash } },
      });
      if (duplicate) return { manuscript: duplicate, idempotentReplay: true };
      const latest = await tx.storyManuscriptVersion.findFirst({ where: { workId }, orderBy: { version: 'desc' }, select: { version: true } });
      const manuscript = await tx.storyManuscriptVersion.create({
        data: {
          workId,
          ownerUserId: userId,
          version: (latest?.version ?? 0) + 1,
          locale: body.locale,
          contentHash,
          structuredBody: structuredBody as unknown as Prisma.InputJsonValue,
        },
      });
      return { manuscript, idempotentReplay: false };
    });
  }

  async analyzeManuscript(userId: string, manuscriptId: string, idempotencyKey?: string) {
    const key = this.analysisIdempotencyKey(idempotencyKey);
    const manuscript = await this.prisma.storyManuscriptVersion.findFirst({ where: { id: manuscriptId, ownerUserId: userId } });
    if (!manuscript) throw new NotFoundException('Manuscript version not found');
    const existing = await this.prisma.storyAnalysisJob.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      if (existing.manuscriptVersionId !== manuscript.id) throw new ConflictException('Idempotency key belongs to another manuscript');
      return existing;
    }
    const body = manuscript.structuredBody as unknown as { parts: CreateManuscriptVersionDto['parts'] };
    const analysis = analyzeStructuredManuscript(body.parts);
    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.storyAnalysisJob.findFirst({ where: { manuscriptVersionId: manuscript.id }, orderBy: { analysisVersion: 'desc' }, select: { analysisVersion: true } });
      const job = await tx.storyAnalysisJob.create({
        data: {
          manuscriptVersionId: manuscript.id,
          analysisVersion: (latest?.analysisVersion ?? 0) + 1,
          idempotencyKey: key,
          status: 'running',
          startedAt: new Date(),
          result: { counts: analysis.counts, partCount: analysis.partCount },
        },
      });
      const storedEvidence = [];
      for (const item of analysis.evidence) {
        storedEvidence.push(await tx.storyAnalysisEvidence.create({ data: { analysisJobId: job.id, ...item, payload: item.payload } }));
      }
      const ledger = deriveContinuityLedger(storedEvidence.map((item) => ({
        id: item.id,
        evidenceType: item.evidenceType as any,
        sourcePartKey: item.sourcePartKey,
        sourceParagraphIndex: item.sourceParagraphIndex,
        payload: item.payload as Record<string, string | number | boolean>,
      })));
      for (const entry of ledger.entries) {
        await tx.storyContinuityEntry.create({ data: { workId: manuscript.workId, analysisJobId: job.id, ...entry } });
      }
      for (const issue of ledger.issues) {
        await tx.storyContinuityIssue.create({ data: { workId: manuscript.workId, analysisJobId: job.id, ...issue } });
      }
      return tx.storyAnalysisJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          result: {
            counts: analysis.counts,
            partCount: analysis.partCount,
            evidenceCount: storedEvidence.length,
            continuityEntryCount: ledger.entries.length,
            criticalIssueCount: ledger.issues.length,
          },
        },
      });
    });
  }

  async analysis(userId: string, analysisId: string) {
    const job = await this.prisma.storyAnalysisJob.findUnique({ where: { id: analysisId } });
    if (!job) throw new NotFoundException('Analysis job not found');
    const manuscript = await this.prisma.storyManuscriptVersion.findFirst({ where: { id: job.manuscriptVersionId, ownerUserId: userId } });
    if (!manuscript) throw new NotFoundException('Analysis job not found');
    const evidence = await this.prisma.storyAnalysisEvidence.findMany({ where: { analysisJobId: job.id }, orderBy: [{ sourcePartKey: 'asc' }, { sourceParagraphIndex: 'asc' }] });
    return { job, evidence };
  }

  async continuity(userId: string, workId: string) {
    await this.assertOwner(userId, workId);
    const [entries, issues] = await Promise.all([
      this.prisma.storyContinuityEntry.findMany({ where: { workId }, orderBy: [{ entryType: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.storyContinuityIssue.findMany({ where: { workId }, orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    const publishBlocked = issues.some((issue) => issue.severity === 'critical' && issue.status === 'open');
    return { entries, issues, publishGate: { blocked: publishBlocked, unresolvedCriticalCount: issues.filter((issue) => issue.severity === 'critical' && issue.status === 'open').length } };
  }

  async decideContinuityIssue(userId: string, workId: string, issueId: string, body: DecideContinuityIssueDto) {
    await this.assertOwner(userId, workId);
    const issue = await this.prisma.storyContinuityIssue.findFirst({ where: { id: issueId, workId } });
    if (!issue) throw new NotFoundException('Continuity issue not found');
    return this.prisma.storyContinuityIssue.update({
      where: { id: issue.id },
      data: { status: body.status, authorDecision: body.decision, decidedByUserId: userId, decidedAt: new Date(), updatedAt: new Date() },
    });
  }

  private async sceneProjection(
    progress: {
      id: string;
      currentSceneId: string | null;
      currentBeatPosition: number;
      currentAct: number;
      progressRevision: number;
      storyVersion: number;
      activeReleaseId?: string | null;
      capabilityRevision?: number | null;
      pathSummary: Prisma.JsonValue;
      status: string;
    },
    locale: string,
  ) {
    const scene = await this.prisma.storyScene.findFirst({ where: { id: progress.currentSceneId!, status: 'published', fixtureSource: false } });
    if (!scene || !isPublicStorySourceSafe({ fixtureSource: scene?.fixtureSource, manifest: scene?.visualManifest })) {
      throw new NotFoundException('Published story scene not found');
    }
    const part = await this.prisma.storyPart.findUnique({ where: { id: scene.partId } });
    const work = part ? await this.prisma.storyWork.findUnique({ where: { id: part.workId } }) : null;
    if (!part || !work || work.status !== 'published' || part.status !== 'published') throw new NotFoundException('Published story scene not found');
    const visualManifest = projectStoredStorySceneVisualManifest(
      scene.visualManifest,
      scene.sceneKey,
    );
    if (!visualManifest) {
      throw new NotFoundException('Published story scene not found');
    }
    const [beats, choices, releaseCapability] = await Promise.all([
      this.prisma.storyBeat.findMany({ where: { sceneId: scene.id }, orderBy: { position: 'asc' }, take: 40 }),
      this.prisma.storyChoice.findMany({ where: { sceneId: scene.id }, orderBy: { position: 'asc' }, take: 12 }),
      this.economics
        ? this.economics.capabilityByRelease(progress.activeReleaseId)
        : null,
    ]);
    const visibleChoices =
      progress.status === 'active'
        ? choices.slice(0, releaseCapability?.fixedChoiceCount ?? 12)
        : [];
    const nextIds = visibleChoices.map((choice) => choice.targetSceneId).filter((id): id is string => Boolean(id));
    const nextScenes = await this.prisma.storyScene.findMany({ where: { id: { in: nextIds }, status: 'published', fixtureSource: false }, select: { id: true, sceneKey: true, title: true, visualManifest: true } });
    const nextById = new Map(
      nextScenes.flatMap((next) => {
        if (!isPublicStorySourceSafe({ manifest: next.visualManifest })) return [];
        const manifest = projectStoredStorySceneVisualManifest(
          next.visualManifest,
          next.sceneKey,
        );
        return manifest ? [[next.id, { ...next, visualManifest: manifest }] as const] : [];
      }),
    );
    return {
      progressId: progress.id,
      status: progress.status,
      revision: progress.progressRevision,
      storyVersion: progress.storyVersion,
      currentAct: progress.currentAct,
      currentBeatPosition: progress.currentBeatPosition,
      part: {
        id: part.id,
        seasonKey: part.seasonKey,
        actNumber: part.actNumber,
        position: part.position,
        title: projectLocalizedValue(part.title, locale, work.defaultLocale),
      },
      scene: {
        id: scene.id,
        sceneKey: scene.sceneKey,
        title: projectLocalizedValue(scene.title, locale, work.defaultLocale),
        beats: beats.map((beat) => ({ id: beat.id, position: beat.position, type: beat.beatType, content: projectLocalizedValue(beat.content, locale, work.defaultLocale) })),
        visualManifest,
        endingType: scene.endingType,
      },
      choices: visibleChoices.filter((choice) => !choice.targetSceneId || nextById.has(choice.targetSceneId)).map((choice) => {
        const next = choice.targetSceneId ? nextById.get(choice.targetSceneId) : null;
        return {
          id: choice.id,
          label: projectLocalizedValue(choice.label, locale, work.defaultLocale),
          routeKind: choice.routeKind,
          explicitRejoin: Boolean(choice.declaredRejoinSceneId),
          nextHint: next ? { title: projectLocalizedValue(next.title, locale, work.defaultLocale), visualManifest: next.visualManifest } : null,
        };
      }),
      path: boundedPath(jsonArray(progress.pathSummary)),
      releaseCapability:
        releaseCapability &&
        progress.capabilityRevision === releaseCapability.revision
        ? {
            fixedChoices: releaseCapability.fixedChoiceCount,
            customChoiceEnabled: releaseCapability.customChoiceEnabled,
            customChoiceMaxLength: releaseCapability.customChoiceMaxLength,
            source: 'pinned_release_capability',
          }
        : this.economics
          ? {
              fixedChoices: 3,
              customChoiceEnabled: false,
              customChoiceMaxLength: 0,
              source: 'fail_closed',
            }
          : null,
    };
  }

  private async publicWorkById(workId: string) {
    const work = await this.prisma.storyWork.findFirst({ where: { id: workId, status: 'published', fixtureSource: false, activeReleaseId: { not: null }, publishedAt: { lte: new Date() } } });
    if (!work || !isPublicStorySourceSafe({ fixtureSource: work.fixtureSource, slug: work.slug, manifest: work.coverManifest })) throw new NotFoundException('Published story not found');
    const release = await this.prisma.storyRelease.findFirst({
      where: { id: work.activeReleaseId!, workId: work.id, status: 'active' },
      select: { id: true },
    });
    if (!release) throw new NotFoundException('Published story not found');
    return work;
  }

  private async assertOwner(userId: string, workId: string) {
    const work = await this.prisma.storyWork.findFirst({ where: { id: workId, ownerUserId: userId } });
    if (!work) throw new NotFoundException('Story work not found');
    return work;
  }

  private async entitledReferenceIds(userId: string | undefined, referenceIds: string[]) {
    if (!userId || !referenceIds.length) return new Set<string>();
    const rows = await this.prisma.userEntitlement.findMany({
      where: { userId, entitlementType: { in: STORY_ENTITLEMENT_TYPES }, referenceId: { in: referenceIds }, revokedAt: null, startsAt: { lte: new Date() }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      select: { referenceId: true },
    });
    return new Set(rows.map((row) => row.referenceId));
  }

  private async hasEntitlement(userId: string, referenceIds: string[]) {
    return (await this.entitledReferenceIds(userId, referenceIds)).size > 0;
  }

  private assertPurchaseReplay(ledger: { ledgerType: string; referenceType: string | null; referenceId: string | null; amount: Decimal }, workId: string, amount: Decimal) {
    if (ledger.ledgerType === 'story_purchase' && ledger.referenceType === 'story_work' && ledger.referenceId === workId && ledger.amount.equals(amount)) return;
    throwWalletMutationIdempotencyConflict();
  }

  private analysisIdempotencyKey(value?: string) {
    const key = value?.trim();
    if (!key || key.length < 8 || key.length > 200) throw new BadRequestException('A valid Idempotency-Key header is required');
    return `story-analysis:${key}`;
  }
}

function jsonArray(value: Prisma.JsonValue | null | undefined): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function jsonStringArray(value: Prisma.JsonValue | null | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function projectGraphScene(
  scene:
    | {
        id: string;
        partId: string;
        sceneKey: string;
        position: number;
        status: string;
        title: unknown;
        endingType: string | null;
      }
    | undefined,
  locale: string,
  defaultLocale: string,
) {
  return scene
    ? {
        id: scene.id,
        partId: scene.partId,
        sceneKey: scene.sceneKey,
        position: scene.position,
        status: scene.status,
        title: projectLocalizedValue(scene.title, locale, defaultLocale),
        endingType: scene.endingType,
      }
    : null;
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
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
  PurchaseStoryWorkDto,
  StartStoryProgressDto,
  StoryCatalogQueryDto,
  StoryLocaleQueryDto,
  UpdateBeatProgressDto,
} from './dto/story-production.dto';
import {
  boundedPath,
  creatorStorySelectionPermissions,
  hasActiveEntitlement,
  isPublicStorySourceSafe,
  projectLocalizedValue,
  projectContinuityGateForPath,
  projectStoryAccess,
  projectStoryGraphValidationSummary,
  STORY_LOCALES,
} from './story-production.policy';
import { sessionKeyHash, storyPathSignature } from './story-lifecycle.policy';
import { StoryEconomicsService } from './story-economics.service';
import {
  assertSuggestedChoiceCount,
  firstReleaseChoiceCapability,
  STORY_FIRST_RELEASE_CHOICE_POLICY,
} from './story-progress-control.policy';
import { projectStoredStorySceneVisualManifest } from '../story-stage/story-scene-visual-manifest-contract';
import { projectAuthoredBeatVisual } from './story-authored-beat-visual.policy';
import { prepareValidatedJsonManuscript } from './story-manuscript-file.policy';
import { storeManuscriptVersion } from './story-manuscript-version.store';
import { StoryAnalysisDiscoveryQueryDto } from './dto/story-analysis-discovery.dto';
import { StoryContinuationProvider } from './story-continuation.provider';
import { StoryContinuationLegalActivationGate } from './story-continuation-legal-activation.gate';
import { SemanticAnalysisService } from './story-semantic-analysis.service';
import { appendStoryRoute, createStoryRouteRoot } from './story-route-identity.store';
import { StoryVisualGenerationService } from './story-visual-generation.service';
import { StoryPublicBetaPolicy } from './story-public-beta.policy';
import { StoryArtistParticipantService } from './story-artist-participant.service';
import {
  normalizeStoryHashtagKey,
  projectStoryHashtags,
} from './story-hashtag.policy';

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
    @Optional() private readonly continuationProvider?: StoryContinuationProvider,
    @Optional() private readonly legalActivation?: StoryContinuationLegalActivationGate,
    @Optional() private readonly semanticAnalysis?: SemanticAnalysisService,
    @Optional() private readonly visualGeneration?: StoryVisualGenerationService,
    @Optional() private readonly publicBeta?: StoryPublicBetaPolicy,
    @Optional() private readonly storyParticipants?: StoryArtistParticipantService,
  ) {}

  async creatorCatalog(userId: string, query: StoryCatalogQueryDto) {
    const rows = await this.prisma.storyWork.findMany({
      where: { ownerUserId: userId, fixtureSource: false },
      select: {
        id: true,
        slug: true,
        status: true,
        defaultLocale: true,
        title: true,
        summary: true,
        activeReleaseId: true,
        publishedAt: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);

    return {
      items: page.map((row) => ({
        workId: row.id,
        slug: row.slug,
        title: projectLocalizedValue(row.title, query.locale, row.defaultLocale),
        summary: projectLocalizedValue(row.summary, query.locale, row.defaultLocale),
        publication: {
          status: row.status,
          published: row.status === 'published' && Boolean(row.activeReleaseId),
          publishedAt: row.publishedAt,
        },
        permissions: creatorStorySelectionPermissions(),
        updatedAt: row.updatedAt,
      })),
      nextCursor: rows.length > query.limit ? page.at(-1)?.id ?? null : null,
    };
  }

  async catalog(userId: string | undefined, query: StoryCatalogQueryDto) {
    const searchQuery = query.q?.normalize('NFKC').trim().replace(/^#/, '').toLocaleLowerCase().slice(0, 80) || '';
    const hashtagKey = normalizeStoryHashtagKey(query.tag);
    const publicWhere: Prisma.StoryWorkWhereInput = {
      status: 'published',
      fixtureSource: false,
      activeReleaseId: { not: null },
      publishedAt: { lte: new Date() },
    };
    const [rows, hashtagRows] = await Promise.all([
      this.prisma.storyWork.findMany({
      where: {
        ...publicWhere,
        ...(searchQuery ? { searchText: { contains: searchQuery, mode: 'insensitive' as const } } : {}),
        ...(hashtagKey ? { hashtagKeys: { has: hashtagKey } } : {}),
      },
      select: {
        id: true,
        slug: true,
        defaultLocale: true,
        title: true,
        summary: true,
        authorDisplayName: true,
        hashtagKeys: true,
        hashtagLabels: true,
        coverManifest: true,
        priceLumina: true,
        releaseRevision: true,
        fixtureSource: true,
        publishedAt: true,
        activeReleaseId: true,
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
      }),
      this.prisma.storyWork.findMany({
        where: publicWhere,
        select: {
          id: true,
          slug: true,
          fixtureSource: true,
          coverManifest: true,
          activeReleaseId: true,
          hashtagKeys: true,
          hashtagLabels: true,
        },
      }),
    ]);
    const activeReleases = await this.prisma.storyRelease.findMany({
      where: {
        id: {
          in: [...new Set([...rows, ...hashtagRows]
            .map((row) => row.activeReleaseId)
            .filter((id): id is string => Boolean(id)))],
        },
        status: 'active',
      },
      select: { id: true, workId: true, checksum: true },
    });
    const activeReleasesById = new Map(activeReleases.map((release) => [release.id, release]));
    const isSafeRow = (row: {
      id: string;
      slug: string;
      fixtureSource: boolean;
      coverManifest: Prisma.JsonValue;
      activeReleaseId: string | null;
    }) =>
      !(row.coverManifest && typeof row.coverManifest === 'object' &&
        !Array.isArray(row.coverManifest) &&
        (row.coverManifest as Record<string, unknown>).catalogVisibility === 'unlisted') &&
      isPublicStorySourceSafe({
        fixtureSource: row.fixtureSource,
        slug: row.slug,
        manifest: row.coverManifest,
      }) && Boolean(row.activeReleaseId && activeReleasesById.has(row.activeReleaseId)) &&
        (!row.activeReleaseId || !this.publicBeta || this.publicBeta.allows(
          row.id, row.activeReleaseId, activeReleasesById.get(row.activeReleaseId)!.checksum,
        ));
    const safeRows = rows.filter(isSafeRow);
    const hashtagCounts = new Map<string, { key: string; label: string; count: number }>();
    hashtagRows.filter(isSafeRow).forEach((row) => {
      projectStoryHashtags(row.hashtagKeys, row.hashtagLabels, query.locale, 'ko').forEach((hashtag) => {
        const existing = hashtagCounts.get(hashtag.key);
        hashtagCounts.set(hashtag.key, {
          key: hashtag.key,
          label: hashtag.label,
          count: (existing?.count ?? 0) + 1,
        });
      });
    });
    const page = safeRows.slice(0, query.limit);
    const entitledIds = await this.entitledReferenceIds(
      userId,
      page.map((row) => row.id),
    );
    const progressRows =
      userId && page.length
        ? await this.prisma.storyReaderProgress.findMany({
            where: { userId, workId: { in: page.map((row) => row.id) } },
            select: {
              workId: true,
              currentSceneId: true,
              currentGeneratedSceneId: true,
              visitedEndingKeys: true,
            },
          })
        : [];
    const progressByWorkId = new Map(progressRows.map((row) => [row.workId, row]));
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
        const progress = progressByWorkId.get(row.id);
        const release = row.activeReleaseId ? activeReleasesById.get(row.activeReleaseId) : null;
        const betaFreeAccess = Boolean(release && this.publicBeta?.freeAccess(row.id, release.id, release.checksum));
        return {
          id: row.id,
          slug: row.slug,
          title,
          summary,
          author: row.authorDisplayName ? { displayName: row.authorDisplayName } : null,
          hashtags: projectStoryHashtags(
            row.hashtagKeys,
            row.hashtagLabels,
            query.locale,
            row.defaultLocale,
          ),
          cover: row.coverManifest,
          publishedAt: row.publishedAt,
          access: this.accessProjection(
            row.priceLumina,
            entitledIds.has(row.id),
            Boolean(userId),
            Boolean(progress?.currentSceneId || progress?.currentGeneratedSceneId),
            jsonStringArray(progress?.visitedEndingKeys).length,
            betaFreeAccess ? true : undefined,
            row,
          ),
          releaseCapability: capabilities?.get(row.id) ?? firstReleaseChoiceCapability(),
        };
      }),
      nextCursor: safeRows.length > query.limit ? page.at(-1)?.id ?? null : null,
      filters: {
        hashtags: [...hashtagCounts.values()].sort((left, right) =>
          right.count - left.count || left.label.localeCompare(right.label, query.locale)),
      },
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
    this.publicBeta?.assertAllowed(work.id, activeRelease.id, activeRelease.checksum);
    const betaFreeAccess = this.publicBeta?.freeAccess(work.id, activeRelease.id, activeRelease.checksum) ?? false;

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
    const workEntitlementGranted = entitledIds.has(work.id);
    const workAccessible = workEntitlementGranted || work.priceLumina.isZero() || betaFreeAccess;
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
      : { ...firstReleaseChoiceCapability(), aiGenerationEnabled: false };

    return {
      id: work.id,
      slug: work.slug,
      title: projectLocalizedValue(work.title, query.locale, work.defaultLocale),
      summary: projectLocalizedValue(work.summary, query.locale, work.defaultLocale),
      author: work.authorDisplayName ? { displayName: work.authorDisplayName } : null,
      hashtags: projectStoryHashtags(
        work.hashtagKeys,
        work.hashtagLabels,
        query.locale,
        work.defaultLocale,
      ),
      cover: work.coverManifest,
      parts: parts.map((part) => {
        const entitlementGranted = workEntitlementGranted || entitledIds.has(part.id);
        return {
          id: part.id,
          seasonKey: part.seasonKey,
          position: part.position,
          title: projectLocalizedValue(part.title, query.locale, work.defaultLocale),
          access: this.accessProjection(
            part.priceLumina,
            entitlementGranted,
            Boolean(userId),
            false,
            0,
            betaFreeAccess || work.priceLumina.isZero() || part.priceLumina.isZero(),
          ),
        };
      }),
      access: this.accessProjection(
        work.priceLumina,
        workEntitlementGranted,
        Boolean(userId),
        Boolean(progress?.currentSceneId || progress?.currentGeneratedSceneId),
        endingRecords.length,
        betaFreeAccess ? true : undefined,
        work,
      ),
      replay: userId
        ? {
            continue: Boolean(progress?.currentSceneId || progress?.currentGeneratedSceneId),
            restart: workAccessible,
            checkpoint: Boolean(progress?.checkpointSceneId),
            branchReplay: workAccessible,
            chargeRequired: false,
            newAiPathGeneration: {
              separateUsage: true,
              enabled: releaseCapability.aiGenerationEnabled,
            },
          }
        : null,
      endingRecords,
      releaseCapability,
    };
  }

  async readerAccess(
    userId: string,
    workId: string,
    query: StoryLocaleQueryDto,
  ) {
    const work = await this.publicWorkById(workId);
    const [entitlementGranted, progress, aiCapability] = await Promise.all([
      this.hasEntitlement(userId, [work.id]),
      this.prisma.storyReaderProgress.findUnique({
        where: { userId_workId: { userId, workId: work.id } },
        select: {
          id: true,
          currentSceneId: true,
          currentGeneratedSceneId: true,
          checkpointSceneId: true,
          visitedEndingKeys: true,
        },
      }),
      this.economics ? this.economics.readerCapability(userId, work.id) : firstReleaseChoiceCapability(),
    ]);
    const endingCount = jsonStringArray(progress?.visitedEndingKeys).length;

    return {
      workId: work.id,
      slug: work.slug,
      title: projectLocalizedValue(work.title, query.locale, work.defaultLocale),
      access: this.accessProjection(
        work.priceLumina,
        entitlementGranted,
        true,
        Boolean(progress?.currentSceneId || progress?.currentGeneratedSceneId),
        endingCount,
        work.betaFreeAccess ? true : undefined,
        work,
      ),
      replay: {
        continue: Boolean(progress?.currentSceneId || progress?.currentGeneratedSceneId),
        checkpoint: Boolean(progress?.checkpointSceneId),
        reset: Boolean(progress),
        endingCount,
      },
      aiCapability,
    };
  }

  async purchaseWork(
    userId: string,
    workId: string,
    idempotencyKey?: string,
    confirmation?: PurchaseStoryWorkDto,
  ) {
    const key = requireWalletMutationIdempotencyKey(idempotencyKey);
    return this.prisma.$transaction(async (tx) => {
      const ledgerKey = `story-work:${key}`;
      // Global key lock binds cross-owner replays. The user lock serializes
      // different keys before reading an entitlement that may not exist yet.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ledgerKey}, 1837))`;
      const users = await tx.$queryRaw<Array<{ id: string; status: string; deleted_at: Date | null }>>`
        SELECT id, status, deleted_at FROM users WHERE id = ${userId}::uuid FOR NO KEY UPDATE
      `;
      if (!users.length || users[0].status !== 'active' || users[0].deleted_at) {
        throw new BadRequestException('Active user not found');
      }
      await tx.$queryRaw`SELECT id FROM story_works WHERE id = ${workId}::uuid FOR SHARE`;
      const entitlementKey = {
        userId, entitlementType: 'story_work', referenceType: 'story_work', referenceId: workId,
      };
      await tx.$queryRaw`
        SELECT id FROM user_entitlements
        WHERE user_id = ${userId}::uuid AND entitlement_type = 'story_work'
          AND reference_type = 'story_work' AND reference_id = ${workId}::uuid
        FOR UPDATE
      `;
      const entitlement = await tx.userEntitlement.findUnique({
        where: { userId_entitlementType_referenceType_referenceId: entitlementKey },
      });
      const existingLedger = await tx.walletLedger.findUnique({
        where: { idempotencyKey: ledgerKey },
        include: { walletAccount: { select: { userId: true, currencyCode: true } } },
      });
      if (existingLedger) {
        this.assertPurchaseReplay(existingLedger, userId, workId);
        const entitled = Boolean(entitlement && hasActiveEntitlement([entitlement]));
        return {
          entitled, charged: false, idempotentReplay: true, chargedAmountLumina: '0',
          originalPurchaseAmountLumina: existingLedger.amount.toString(),
          outcome: entitled ? 'replayed' : 'entitlement_inactive',
        };
      }
      const work = await tx.storyWork.findUnique({ where: { id: workId } });
      const stale = () => {
        throw new ConflictException({
          code: 'STORY_PURCHASE_CONFIRMATION_STALE',
          messageKey: 'story.purchase.confirmationStale', walletMutation: false,
          details: { walletMutation: false },
        });
      };
      if (!work) throw new NotFoundException('Published story not found');
      if (work.activeReleaseId) {
        await tx.$queryRaw`SELECT id FROM story_releases WHERE id = ${work.activeReleaseId}::uuid FOR SHARE`;
      }
      const release = work.activeReleaseId ? await tx.storyRelease.findFirst({
        where: { id: work.activeReleaseId, workId, status: 'active' }, select: { id: true, checksum: true },
      }) : null;
      if (work.status !== 'published' || !work.publishedAt || work.publishedAt > new Date() ||
        !isPublicStorySourceSafe({
          fixtureSource: work.fixtureSource, slug: work.slug, manifest: work.coverManifest,
        })) stale();
      if (!release) stale();
      const checkedRelease = release!;
      this.publicBeta?.assertAllowed(work.id, checkedRelease.id, checkedRelease.checksum);
      if (entitlement && hasActiveEntitlement([entitlement])) {
        return { entitled: true, charged: false, idempotentReplay: true,
          chargedAmountLumina: '0', outcome: 'already_entitled' };
      }
      if (work.priceLumina.isZero() || this.publicBeta?.freeAccess(
        work.id, checkedRelease.id, checkedRelease.checksum,
      )) {
        return { entitled: true, charged: false, idempotentReplay: true,
          chargedAmountLumina: '0', outcome: 'free' };
      }
      if (confirmation?.confirmedPriceLumina == null || confirmation.expectedReleaseId == null ||
        confirmation.expectedReleaseRevision == null) {
        throw new ConflictException({
          code: 'STORY_PURCHASE_CONFIRMATION_REQUIRED',
          messageKey: 'story.purchase.confirmationRequired', walletMutation: false,
          details: { walletMutation: false },
        });
      }
      if (typeof confirmation.confirmedPriceLumina !== 'string' ||
        !/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/.test(confirmation.confirmedPriceLumina) ||
        !work.priceLumina.isPositive() ||
        !work.priceLumina.equals(confirmation.confirmedPriceLumina) ||
        work.activeReleaseId !== confirmation.expectedReleaseId ||
        work.releaseRevision !== confirmation.expectedReleaseRevision) stale();
      await tx.$queryRaw`
        SELECT id FROM wallet_accounts WHERE user_id = ${userId}::uuid
          AND currency_code = ${CURRENCY} FOR UPDATE
      `;
      const wallet = await tx.walletAccount.findUnique({
        where: { userId_currencyCode: { userId, currencyCode: CURRENCY } },
      });
      if (!wallet || wallet.status !== 'active') {
        throw new BadRequestException('Active wallet not found');
      }
      const updated = await tx.walletAccount.updateMany({
        where: { id: wallet.id, status: 'active', cachedBalance: { gte: work.priceLumina } },
        data: { cachedBalance: { decrement: work.priceLumina } },
      });
      assertAtomicWalletDebitSucceeded(updated);
      const ledger = await tx.walletLedger.create({
        data: {
          walletAccountId: wallet.id, direction: 'debit', amount: work.priceLumina,
          ledgerType: 'story_purchase', referenceType: 'story_work', referenceId: work.id,
          idempotencyKey: ledgerKey, memo: 'Story work entitlement purchase',
        },
      });
      await tx.userEntitlement.upsert({
        where: { userId_entitlementType_referenceType_referenceId: entitlementKey },
        create: {
          ...entitlementKey, grantedByReferenceType: 'wallet_ledger', grantedByReferenceId: ledger.id,
        },
        update: {
          revokedAt: null, expiresAt: null, startsAt: new Date(),
          grantedByReferenceType: 'wallet_ledger', grantedByReferenceId: ledger.id,
        },
      });
      return { entitled: true, charged: true, idempotentReplay: false,
        chargedAmountLumina: work.priceLumina.toString(), outcome: 'purchased' };
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
    const entitled = work.priceLumina.isZero() || work.betaFreeAccess ||
      (await this.hasEntitlement(userId, [work.id, ...parts.map((part) => part.id)]));
    if (!entitled) throw new ForbiddenException('Story entitlement required');
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
      if (body.participantArtistId && this.storyParticipants) {
        const existingParticipant = await this.prisma.storyProgressArtistParticipant.findUnique({
          where: { progressId: existing.id },
          select: { artistId: true },
        });
        if (!existingParticipant) {
          if (
            existing.currentBeatPosition !== 0 ||
            existing.currentGeneratedSceneId ||
            jsonArray(existing.pathSummary).length > 0
          ) {
            throw new ConflictException({
              code: 'STORY_PARTICIPANT_LOCKED',
              messageKey: 'story.participant.error.locked',
              retryable: false,
            });
          }
          await this.prisma.$transaction((tx) => this.storyParticipants!.bind(tx, {
            progressId: existing.id,
            userId,
            workId,
            artistId: body.participantArtistId!,
          }));
        } else if (existingParticipant.artistId !== body.participantArtistId) {
          throw new ConflictException({
            code: 'STORY_PARTICIPANT_LOCKED',
            messageKey: 'story.participant.error.locked',
            retryable: false,
          });
        }
      }
      return this.currentProgress(userId, existing.id, body.locale);
    }
    if (body.mode === 'checkpoint') {
      throw new BadRequestException('Checkpoint is not available');
    }
    const firstPart = parts[0];
    const firstScene = await this.prisma.storyScene.findFirst({
      where: { partId: firstPart.id, status: 'published', fixtureSource: false },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    if (!firstScene) throw new NotFoundException('Published story scene not found');
    const targetSceneId = firstScene.id;
    const sessionPin =
      this.economics && work.activeReleaseId
        ? await this.economics.releaseSessionPin(work.activeReleaseId)
        : null;
    const progress = await this.prisma.$transaction(async (tx) => {
      const created = await tx.storyReaderProgress.create({
        data: {
          userId,
          workId,
          currentSceneId: targetSceneId,
          currentBeatPosition: 0,
          currentAct: firstPart.actNumber,
          storyVersion: work.publishedVersion,
          activeReleaseId: work.activeReleaseId,
          aiRateCardId: sessionPin?.aiRateCardId,
          capabilityRevision: sessionPin?.capabilityRevision,
          checkpointSceneId: targetSceneId,
          seenSceneIds: [targetSceneId],
          pathSummary: [],
        },
      });
      if (body.participantArtistId && this.storyParticipants) {
        await this.storyParticipants.bind(tx, {
          progressId: created.id,
          userId,
          workId,
          artistId: body.participantArtistId,
        });
      }
      const routeNodeId = await createStoryRouteRoot(tx, created, targetSceneId, firstPart.actNumber);
      return tx.storyReaderProgress.update({ where: { id: created.id }, data: { routeNodeId } });
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
    const participantArtist = this.storyParticipants
      ? await this.storyParticipants.projection(progress.id)
      : null;
    if (progress.currentGeneratedSceneId) {
      return { ...(await this.generatedSceneProjection(progress, locale)), participantArtist };
    }
    if (!progress.currentSceneId) {
      return {
        progressId,
        status: progress.status,
        revision: progress.progressRevision,
        storyVersion: progress.storyVersion,
        currentAct: progress.currentAct,
        scene: null,
        choices: [],
        releaseCapability: firstReleaseChoiceCapability(),
        path: boundedPath(jsonArray(progress.pathSummary)),
        participantArtist,
      };
    }
    return { ...(await this.sceneProjection(progress, locale)), participantArtist };
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
    if (!progress || (!progress.currentSceneId && !progress.currentGeneratedSceneId)) {
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
    const beat = progress.currentGeneratedSceneId
      ? await this.prisma.storyAiGeneratedBeat.findUnique({
          where: {
            sceneId_position: {
              sceneId: progress.currentGeneratedSceneId,
              position: body.position,
            },
          },
        })
      : await this.prisma.storyBeat.findUnique({
          where: {
            sceneId_position: {
              sceneId: progress.currentSceneId!,
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
    idempotencyKey?: string,
  ) {
    if (this.economics && idempotencyKey) {
      const replay = await this.economics.recommendedChoiceReplay(
        userId,
        progressId,
        choiceId,
        expectedRevision,
        locale,
        idempotencyKey,
      );
      if (replay) return replay;
    }
    let generationReceipt: unknown;
    try {
      generationReceipt = await this.prisma.$transaction(async (tx) => {
      const progress = await tx.storyReaderProgress.findFirst({ where: { id: progressId, userId } });
      if (!progress || (!progress.currentSceneId && !progress.currentGeneratedSceneId)) {
        throw new NotFoundException('Active story progress not found');
      }
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
      const work = await tx.storyWork.findFirst({
        where: { id: progress.workId, status: 'published', fixtureSource: false },
      });
      const canonicalScene = progress.currentSceneId
        ? await tx.storyScene.findFirst({
            where: { id: progress.currentSceneId, status: 'published', fixtureSource: false },
          })
        : null;
      const generatedScene = progress.currentGeneratedSceneId
        ? await tx.storyAiGeneratedScene.findFirst({
            where: {
              id: progress.currentGeneratedSceneId,
              userId,
              workId: progress.workId,
              releaseId: progress.activeReleaseId ?? undefined,
              progressId: progress.id,
              status: 'ready',
            },
          })
        : null;
      const scene = canonicalScene ?? generatedScene;
      const sourceKind = generatedScene ? 'generated' as const : 'canonical' as const;
      const part = scene ? await tx.storyPart.findFirst({
        where: {
          id: canonicalScene?.partId ?? generatedScene?.sourcePartId,
          workId: progress.workId,
          status: 'published',
          fixtureSource: false,
        },
      }) : null;
      if (!work || !scene || !part) throw new NotFoundException('Published story progress not found');
      if (!work.priceLumina.isZero()) {
        const now = new Date();
        const entitlement = await tx.userEntitlement.findFirst({
          where: {
            userId,
            entitlementType: { in: STORY_ENTITLEMENT_TYPES },
            referenceId: { in: [work.id, part.id] },
            revokedAt: null,
            startsAt: { lte: now },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          select: { id: true },
        });
        if (!entitlement) throw new ForbiddenException('Story entitlement required');
      }
      if (!progress.activeReleaseId || progress.storyVersion !== work.publishedVersion || progress.activeReleaseId !== work.activeReleaseId) {
        throw new ConflictException({
          code: 'STORY_PROGRESS_VERSION_MISMATCH',
          messageKey: 'story.progress.status.versionMismatch',
          retryable: false,
        });
      }
      const release = await tx.storyRelease.findFirst({
        where: { id: progress.activeReleaseId, workId: work.id, status: 'active' },
        select: {
          id: true,
          workId: true,
          version: true,
          manuscriptVersionId: true,
          checksum: true,
          status: true,
        },
      });
      if (!release) throw new NotFoundException('Published story not found');
      if (this.economics) {
        const capability = await tx.storyReleaseCapability.findUnique({ where: { releaseId: release.id } });
        if (!capability || capability.status !== 'active' || capability.revision !== progress.capabilityRevision) {
          throw new ConflictException('Story release capability changed');
        }
      }
      const choices = sourceKind === 'canonical'
        ? await tx.storyChoice.findMany({
            where: { sceneId: scene.id },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            take: STORY_FIRST_RELEASE_CHOICE_POLICY.maxSuggestedChoices + 1,
          })
        : await tx.storyAiGeneratedChoice.findMany({
            where: { sceneId: scene.id },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            take: STORY_FIRST_RELEASE_CHOICE_POLICY.maxSuggestedChoices + 1,
          });
      assertSuggestedChoiceCount(choices.length);
      const choice: any = choices.find((item) => item.id === choiceId);
      if (!choice) throw new BadRequestException('Choice is not available for the current scene');
      if (choice.routeKind === 'generation_required') {
        const normalizedLocale = STORY_LOCALES.find((candidate) => candidate.toLowerCase() === locale.trim().toLowerCase()) ?? locale.trim();
        const now = new Date();
        const contract = await tx.contentRightsContract.findFirst({
          where: { workType: 'story', workId: work.id },
          include: { versions: { where: {
            contentVersionId: release.manuscriptVersionId, approvalState: 'approved_configuration',
            aiTransformationAllowed: true, effectiveFrom: { lte: now }, startsAt: { lte: now },
            OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          }, orderBy: { revision: 'desc' }, take: 1 } },
        });
        const legalActivation = await this.legalActivation?.authorize({
          workId: work.id,
          releaseId: release.id,
          manuscriptVersionId: release.manuscriptVersionId,
          rightsContractVersionId: contract?.versions[0]?.id ?? null,
          locale: normalizedLocale,
        }, tx);
        if (!legalActivation?.active) {
          throw new ForbiddenException({
            code: 'STORY_AI_LEGAL_ACTIVATION_REQUIRED',
            messageKey: 'story.progress.aiGeneration.legalActivationRequired',
            retryable: false,
            progressMutated: false,
            generationStarted: false,
          });
        }
        if (!this.economics) {
          await this.continuationProvider?.readiness();
          throw new ConflictException({
            code: 'STORY_CHOICE_GENERATION_UNAVAILABLE',
            messageKey: 'story.choice.status.generationUnavailable',
            retryable: false,
            progressMutated: false,
            generationStarted: false,
          });
        }
        return this.economics.requestRecommendedChoiceTx(tx, {
          userId,
          progress,
          work,
          part,
          scene,
          release,
          choice,
          sourceKind,
          locale: normalizedLocale,
          idempotencyKey,
        });
      }
      const target = choice.targetSceneId
        ? await tx.storyScene.findFirst({ where: { id: choice.targetSceneId, status: 'published', fixtureSource: false } })
        : null;
      if (choice.targetSceneId && !target) throw new ConflictException('Choice target is unavailable');
      const endingType = target?.endingType ?? (
        choice.targetEndingKey === 'author_main'
          ? 'author_main'
          : choice.targetEndingKey
            ? 'author_sub'
            : null
      );
      const targetPart = target
        ? await tx.storyPart.findUnique({ where: { id: target.partId } })
        : null;
      if (target && (!targetPart || targetPart.workId !== work.id || targetPart.status !== 'published' || targetPart.fixtureSource)) {
        throw new ConflictException('Choice target is unavailable');
      }
      const path = boundedPath([
        ...jsonArray(progress.pathSummary),
        {
          sceneId: progress.currentSceneId!,
          choiceId: choice.id,
          nextSceneId: target?.id ?? null,
          explicitRejoin: Boolean(choice.declaredRejoinSceneId),
        },
      ]);
      const routeNodeId = await appendStoryRoute(tx, progress, {
        kind: 'canonical', sceneId: scene.id, choiceId: choice.id,
        targetSceneId: target?.id ?? null, endingKey: choice.targetEndingKey ?? null,
      }, targetPart?.actNumber ?? progress.currentAct, path.at(-1) as Record<string, unknown>);
      const seen = [...new Set([...jsonStringArray(progress.seenSceneIds), ...(target ? [target.id] : [])])];
      await tx.storyChoiceEvent.create({
        data: {
          progressId,
          sceneId: progress.currentSceneId!,
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
          routeNodeId,
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
      if (sourceKind === 'generated') {
        throw new ConflictException('Generated story choice route is invalid');
      }
      return null;
      }, { timeout: 15_000 });
    } catch (error) {
      if (
        idempotencyKey &&
        error && typeof error === 'object' && 'code' in error && error.code === 'P2002' &&
        this.economics
      ) {
        const replay = await this.economics.recommendedChoiceReplay(
          userId,
          progressId,
          choiceId,
          expectedRevision,
          locale,
          idempotencyKey,
        );
        if (replay) return replay;
      }
      throw error;
    }
    if (generationReceipt) return generationReceipt;
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
    const firstPart = parts[0];
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
      : firstPart
        ? await this.prisma.storyScene.findFirst({
            where: { partId: firstPart.id, fixtureSource: false },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
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
        : null;
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
    return storeManuscriptVersion(this.prisma, userId, workId,
      prepareValidatedJsonManuscript(body));
  }

  async analyzeManuscript(userId: string, manuscriptId: string, idempotencyKey?: string) {
    if (!this.semanticAnalysis) throw new ServiceUnavailableException({ code: 'SEMANTIC_ANALYSIS_UNAVAILABLE' });
    return this.semanticAnalysis.enqueue(userId, manuscriptId, idempotencyKey);
  }

  manuscriptVersions(userId: string, workId: string, query: StoryAnalysisDiscoveryQueryDto) {
    if (!this.semanticAnalysis) throw new ServiceUnavailableException('Semantic analysis service unavailable');
    return this.semanticAnalysis.manuscripts(userId, workId, query);
  }

  analysisJobs(userId: string, manuscriptId: string, query: StoryAnalysisDiscoveryQueryDto) {
    if (!this.semanticAnalysis) throw new ServiceUnavailableException('Semantic analysis service unavailable');
    return this.semanticAnalysis.analyses(userId, manuscriptId, query);
  }

  async analysis(userId: string, analysisId: string, cursor?: string) {
    if (!this.semanticAnalysis) throw new ServiceUnavailableException({ code: 'SEMANTIC_ANALYSIS_UNAVAILABLE' });
    return this.semanticAnalysis.get(userId, analysisId, cursor);
  }

  async analysisCitation(userId: string, analysisId: string, evidenceId: string) {
    if (!this.semanticAnalysis) throw new ServiceUnavailableException({ code: 'SEMANTIC_ANALYSIS_UNAVAILABLE' });
    return this.semanticAnalysis.citation(userId, analysisId, evidenceId);
  }

  async continuity(userId: string, workId: string) {
    await this.assertOwner(userId, workId);
    const manuscript = await this.prisma.storyManuscriptVersion.findFirst({
      where: { workId, ownerUserId: userId },
      orderBy: { version: 'desc' },
      select: { id: true, version: true },
    });
    const analysis = manuscript
      ? await this.prisma.storyAnalysisJob.findFirst({
          where: { workId, manuscriptVersionId: manuscript.id, status: 'completed' },
          orderBy: { analysisVersion: 'desc' },
          select: { id: true, analysisVersion: true },
        })
      : null;
    if (!manuscript || !analysis) {
      return {
        manuscriptVersion: manuscript?.version ?? null,
        analysisVersion: null,
        entries: [],
        issues: [],
        pathStates: { authorOriginal: [], readerDerived: [] },
        decisionHistory: [],
        publishGate: { blocked: false, unresolvedCriticalCount: 0, unresolvedWarningCount: 0 },
      };
    }
    const [entries, issues, evidence, entryLinks, issueLinks, pathStates, decisions] = await Promise.all([
      this.prisma.storyContinuityEntry.findMany({ where: { workId, analysisJobId: analysis.id }, orderBy: [{ entryType: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.storyContinuityIssue.findMany({
        where: {
          workId,
          analysisJobId: analysis.id,
          pathScope: 'author_original',
          pathKey: 'author_original',
        },
        orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.storyAnalysisEvidence.findMany({ where: { analysisJobId: analysis.id }, select: { id: true, evidenceType: true, sourcePartKey: true, sourceParagraphIndex: true } }),
      this.prisma.storyContinuityEntryEvidence.findMany({ where: { analysisJobId: analysis.id }, select: { entryId: true, evidenceId: true } }),
      this.prisma.storyContinuityIssueEvidence.findMany({ where: { analysisJobId: analysis.id }, select: { issueId: true, evidenceId: true } }),
      this.prisma.storyContinuityPathState.findMany({ where: { workId, analysisJobId: analysis.id }, orderBy: [{ pathScope: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.storyContinuityDecisionAudit.findMany({ where: { workId, analysisJobId: analysis.id }, orderBy: [{ issueId: 'asc' }, { decisionRevision: 'asc' }] }),
    ]);
    const evidenceById = new Map(evidence.map((item) => [item.id, item]));
    const evidenceFor = (links: Array<{ evidenceId: string }>) => links
      .map((link) => evidenceById.get(link.evidenceId))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const projectedEntries = entries.map((entry) => ({
      id: entry.id,
      analysisVersion: entry.analysisVersion,
      entryType: entry.entryType,
      ledgerKey: entry.ledgerKey,
      label: entry.label,
      evidence: evidenceFor(entryLinks.filter((link) => link.entryId === entry.id)),
    }));
    const authorIssues = issues.filter(
      (issue) => issue.pathScope === 'author_original' && issue.pathKey === 'author_original',
    );
    const authorIssueIds = new Set(authorIssues.map((issue) => issue.id));
    const projectedIssues = authorIssues.map((issue) => ({
      id: issue.id,
      analysisVersion: issue.analysisVersion,
      pathScope: issue.pathScope,
      pathKey: issue.pathKey,
      issueKey: issue.issueKey,
      severity: issue.severity,
      status: issue.status,
      summary: issue.summary,
      decisionRevision: issue.decisionRevision,
      evidence: evidenceFor(issueLinks.filter((link) => link.issueId === issue.id)),
    }));
    const publishGate = projectContinuityGateForPath(issues, 'author_original', 'author_original');
    const projectPathState = (scope: string) => pathStates
      .filter((state) => state.pathScope === scope)
      .map((state) => ({ entryId: state.entryId, pathKey: state.pathKey, state: state.state }));
    return {
      manuscriptVersion: manuscript.version,
      analysisVersion: analysis.analysisVersion,
      entries: projectedEntries,
      issues: projectedIssues,
      pathStates: {
        authorOriginal: projectPathState('author_original'),
        readerDerived: projectPathState('reader_derived'),
      },
      decisionHistory: decisions.filter((decision) => authorIssueIds.has(decision.issueId)).map((decision) => ({
        issueId: decision.issueId,
        revision: decision.decisionRevision,
        fromStatus: decision.fromStatus,
        toStatus: decision.toStatus,
        decision: decision.decision,
        decidedAt: decision.createdAt,
      })),
      publishGate,
    };
  }

  async decideContinuityIssue(userId: string, workId: string, issueId: string, body: DecideContinuityIssueDto) {
    await this.assertOwner(userId, workId);
    const issue = await this.prisma.storyContinuityIssue.findFirst({
      where: {
        id: issueId,
        workId,
        pathScope: 'author_original',
        pathKey: 'author_original',
      },
    });
    if (!issue) throw new NotFoundException('Continuity issue not found');
    return this.prisma.$transaction(async (tx) => {
      const revision = issue.decisionRevision + 1;
      await tx.storyContinuityDecisionAudit.create({
        data: {
          workId,
          analysisJobId: issue.analysisJobId,
          analysisVersion: issue.analysisVersion,
          issueId: issue.id,
          decisionRevision: revision,
          fromStatus: issue.status,
          toStatus: body.status,
          decision: body.decision,
          actorUserId: userId,
        },
      });
      const updated = await tx.storyContinuityIssue.updateMany({
        where: { id: issue.id, workId, decisionRevision: issue.decisionRevision },
        data: {
          status: body.status,
          authorDecision: body.decision,
          decidedByUserId: userId,
          decidedAt: new Date(),
          decisionRevision: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (updated.count !== 1) throw new ConflictException('Continuity issue changed concurrently');
      return tx.storyContinuityIssue.findUniqueOrThrow({ where: { id: issue.id } });
    });
  }

  private async generatedSceneProjection(
    progress: {
      id: string;
      workId: string;
      currentGeneratedSceneId: string | null;
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
    const scene = await this.prisma.storyAiGeneratedScene.findFirst({
      where: {
        id: progress.currentGeneratedSceneId!,
        progressId: progress.id,
        workId: progress.workId,
        releaseId: progress.activeReleaseId ?? undefined,
        status: 'ready',
      },
    });
    const part = scene
      ? await this.prisma.storyPart.findFirst({
          where: {
            id: scene.sourcePartId,
            workId: scene.workId,
            status: 'published',
            fixtureSource: false,
          },
        })
      : null;
    const work = part
      ? await this.prisma.storyWork.findFirst({
          where: { id: part.workId, status: 'published', fixtureSource: false },
        })
      : null;
    if (!scene || !part || !work) throw new NotFoundException('Generated story scene not found');
    let visualManifest = projectStoredStorySceneVisualManifest(scene.visualManifest, scene.sceneKey);
    if (!visualManifest) throw new NotFoundException('Generated story scene not found');
    const visualVariantKey = this.visualGeneration
      ? await this.visualGeneration.variantKeyForProgress(progress.id)
      : 'default';
    const [beats, choices, releaseCapability, readyVisuals, promptKeys] = await Promise.all([
      this.prisma.storyAiGeneratedBeat.findMany({
        where: { sceneId: scene.id },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        take: 41,
      }),
      this.prisma.storyAiGeneratedChoice.findMany({
        where: { sceneId: scene.id },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        take: STORY_FIRST_RELEASE_CHOICE_POLICY.maxSuggestedChoices + 1,
      }),
      this.economics && progress.activeReleaseId
        ? this.economics.capabilityByRelease(progress.activeReleaseId)
        : null,
      this.visualGeneration && progress.activeReleaseId
        ? this.visualGeneration.readyVisuals(work.id, progress.activeReleaseId, [scene.sceneKey], visualVariantKey)
        : new Map<string, { sourceSceneKey: string; publicAssetPath: string }>(),
      this.visualGeneration && progress.activeReleaseId
        ? this.visualGeneration.promptKeys(work.id, progress.activeReleaseId, [scene.sceneKey])
        : new Set<string>(),
    ]);
    const generatedVisual = readyVisuals.get(scene.sceneKey);
    if (generatedVisual) {
      visualManifest = this.applyReadyVisual(visualManifest, generatedVisual.publicAssetPath);
    }
    if (beats.length < 1 || beats.length > 40) {
      throw new NotFoundException('Generated story scene not found');
    }
    assertSuggestedChoiceCount(choices.length);
    const deliveryState = generatedVisual
      ? 'ready'
      : promptKeys.has(scene.sceneKey) ? 'artwork_pending' : 'artwork_unavailable';
    if (deliveryState !== 'ready') {
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
          isGenerated: true,
          title: null,
          beats: [],
          visualManifest,
          visualGenerationAvailable: deliveryState === 'artwork_pending',
          deliveryState,
          endingType: null,
        },
        choices: [],
        path: boundedPath(jsonArray(progress.pathSummary)),
        releaseCapability: { ...firstReleaseChoiceCapability(), source: 'paired_delivery_pending' },
      };
    }
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
        isGenerated: true,
        title: projectLocalizedValue(scene.title, locale, work.defaultLocale),
        beats: beats.map((beat) => ({
          id: beat.id,
          position: beat.position,
          type: beat.beatType,
          content: projectLocalizedValue(beat.content, locale, work.defaultLocale),
        })),
        visualManifest,
        visualGenerationAvailable: promptKeys.has(scene.sceneKey) && !generatedVisual,
        deliveryState,
        endingType: scene.endingType,
      },
      choices: progress.status === 'active'
        ? choices.map((choice) => ({
            id: choice.id,
            label: projectLocalizedValue(choice.label, locale, work.defaultLocale),
            routeKind: 'generation_required',
            explicitRejoin: false,
            nextHint: null,
          }))
        : [],
      path: boundedPath(jsonArray(progress.pathSummary)),
      releaseCapability:
        releaseCapability && progress.capabilityRevision === releaseCapability.revision
          ? { ...firstReleaseChoiceCapability(), source: 'pinned_release_capability' }
          : { ...firstReleaseChoiceCapability(), source: 'fail_closed' },
    };
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
    let visualManifest = projectStoredStorySceneVisualManifest(
      scene.visualManifest,
      scene.sceneKey,
    );
    if (!visualManifest) {
      throw new NotFoundException('Published story scene not found');
    }
    const [beats, choices, releaseCapability] = await Promise.all([
      this.prisma.storyBeat.findMany({ where: { sceneId: scene.id }, orderBy: { position: 'asc' }, take: 40 }),
      this.prisma.storyChoice.findMany({
        where: { sceneId: scene.id },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        take: STORY_FIRST_RELEASE_CHOICE_POLICY.maxSuggestedChoices + 1,
      }),
      this.economics
        ? this.economics.capabilityByRelease(progress.activeReleaseId)
        : null,
    ]);
    const visualKeys = [scene.sceneKey, ...beats.map(beat => beat.sourceSceneKey)
      .filter((key): key is string => Boolean(key))];
    const visualVariantKey = this.visualGeneration
      ? await this.visualGeneration.variantKeyForProgress(progress.id)
      : 'default';
    const [readyVisuals, promptKeys] = this.visualGeneration && progress.activeReleaseId
      ? await Promise.all([
          this.visualGeneration.readyVisuals(work.id, progress.activeReleaseId, visualKeys, visualVariantKey),
          this.visualGeneration.promptKeys(work.id, progress.activeReleaseId, visualKeys),
        ])
      : [new Map<string, { sourceSceneKey: string; publicAssetPath: string }>(), new Set<string>()];
    const canonicalVisual = readyVisuals.get(scene.sceneKey);
    if (canonicalVisual) {
      visualManifest = this.applyReadyVisual(visualManifest, canonicalVisual.publicAssetPath);
    }
    // One look-ahead detects invalid authored scenes without truncating their branches.
    assertSuggestedChoiceCount(choices.length);
    const projectedBeats = beats.map((beat) => {
      const visual = projectAuthoredBeatVisual(beat);
      if (!visual.valid) throw new NotFoundException('Published story visual segment not found');
      const generated = beat.sourceSceneKey ? readyVisuals.get(beat.sourceSceneKey) : null;
      const visualContext = visual.visualContext
        ? { ...visual.visualContext,
          generationAvailable: Boolean(beat.sourceSceneKey && promptKeys.has(beat.sourceSceneKey) && !generated),
          ...(generated ? { assetReadiness: 'ready' as const,
            manifest: this.applyReadyVisual(visual.visualContext.manifest, generated.publicAssetPath) } : {}) }
        : undefined;
      return { id: beat.id, position: beat.position, type: beat.beatType,
        content: projectLocalizedValue(beat.content, locale, work.defaultLocale),
        ...(visualContext ? { visualContext } : {}) };
    });
    const visibleChoices = progress.status === 'active' ? choices : [];
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
        beats: projectedBeats,
        visualManifest,
        visualGenerationAvailable: promptKeys.has(scene.sceneKey) && !canonicalVisual,
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
            ...firstReleaseChoiceCapability(),
            source: 'pinned_release_capability',
          }
        : this.economics
          ? {
              ...firstReleaseChoiceCapability(),
              source: 'fail_closed',
            }
          : firstReleaseChoiceCapability(),
    };
  }

  private applyReadyVisual<T extends { background: { altKey: string } }>(manifest: T, publicAssetPath: string) {
    return { ...manifest, background: { ...manifest.background, publicAssetPath, state: 'ready' as const } };
  }

  private async publicWorkById(workId: string) {
    const work = await this.prisma.storyWork.findFirst({ where: { id: workId, status: 'published', fixtureSource: false, activeReleaseId: { not: null }, publishedAt: { lte: new Date() } } });
    if (!work || !isPublicStorySourceSafe({ fixtureSource: work.fixtureSource, slug: work.slug, manifest: work.coverManifest })) throw new NotFoundException('Published story not found');
    const release = await this.prisma.storyRelease.findFirst({
      where: { id: work.activeReleaseId!, workId: work.id, status: 'active' },
      select: { id: true, checksum: true },
    });
    if (!release) throw new NotFoundException('Published story not found');
    this.publicBeta?.assertAllowed(work.id, release.id, release.checksum);
    return { ...work, betaFreeAccess: this.publicBeta?.freeAccess(work.id, release.id, release.checksum) ?? false };
  }

  private accessProjection(
    priceLumina: Decimal,
    entitlementGranted: boolean,
    authenticated: boolean,
    hasProgress = false,
    endingCount = 0,
    freeOverride?: boolean,
    purchase?: { activeReleaseId: string | null; releaseRevision: number },
  ) {
    const projection = projectStoryAccess({
      authenticated,
      entitled: entitlementGranted,
      isFree: freeOverride ?? priceLumina.isZero(),
      priceLumina: priceLumina.toString(),
      hasProgress,
      endingCount,
    });

    return {
      ...projection,
      entitled: projection.accessible,
      entitlementGranted,
      priceLumina: projection.accessible ? null : projection.pricing.amountLumina,
      purchaseAction: projection.accessible ? null : 'purchase',
      purchaseConfirmation: !projection.accessible && purchase?.activeReleaseId
        ? { priceLumina: priceLumina.toString(), releaseId: purchase.activeReleaseId,
            releaseRevision: purchase.releaseRevision }
        : null,
    };
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

  private assertPurchaseReplay(
    ledger: { ledgerType: string; referenceType: string | null; referenceId: string | null;
      direction: string; amount: Decimal; walletAccount: { userId: string; currencyCode: string } },
    userId: string,
    workId: string,
  ) {
    if (ledger.ledgerType === 'story_purchase' && ledger.referenceType === 'story_work' &&
      ledger.referenceId === workId && ledger.direction === 'debit' && ledger.amount.isPositive() &&
      ledger.walletAccount.userId === userId && ledger.walletAccount.currencyCode === CURRENCY) return;
    throwWalletMutationIdempotencyConflict();
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

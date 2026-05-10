import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type FanEngagementQuery = Record<string, string | undefined>;
type FanEngagementBody = Record<string, unknown>;
type JsonRecord = Record<string, unknown>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_SURFACES = new Set([
  'home',
  'artist_detail',
  'feed',
  'mypage',
  'creator_studio_hint',
]);
const VALID_MISSION_SCOPES = new Set(['today', 'active', 'available']);
const VALID_VOTE_STATUSES = new Set(['active', 'closed', 'draft', 'archived']);

@Injectable()
export class FanEngagementService {
  constructor(private readonly prisma: PrismaService) {}

  async getMissions(query: FanEngagementQuery, viewerUserId?: string) {
    const now = new Date();
    const surface = this.surface(query.surface);
    const artistId = this.optionalUuid(query.artistId, 'artistId');
    const scope = this.missionScope(query.scope);
    const take = this.take(query.take, 20);
    const locale = this.locale(query.locale);
    const missions = await this.prisma.fanMission.findMany({
      where: {
        status: 'active',
        ...(artistId ? { artistId } : {}),
        ...(surface
          ? { OR: [{ surfaces: { isEmpty: true } }, { surfaces: { has: surface } }] }
          : {}),
        ...this.activeWindowWhere(now),
      },
      include: {
        artist: { select: { id: true, slug: true, displayName: true } },
      },
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }],
      take,
    });
    const participationMap = viewerUserId
      ? await this.participationMap(viewerUserId, missions)
      : new Map<string, { status: string; createdAt: Date }>();
    const items = missions.map((mission) =>
      this.presentMission(mission, locale, participationMap),
    );

    return {
      generatedAt: now.toISOString(),
      locale,
      surface: surface ?? 'home',
      scope,
      items,
      summary: {
        availableCount: items.filter(
          (item) => item.participation.status !== 'accepted',
        ).length,
        completedTodayCount: items.filter(
          (item) => item.participation.status === 'accepted',
        ).length,
      },
      policy: this.policy(),
    };
  }

  async getConceptVotes(query: FanEngagementQuery, viewerUserId?: string) {
    const now = new Date();
    const locale = this.locale(query.locale);
    const artistId = this.optionalUuid(query.artistId, 'artistId');
    const status = this.voteStatus(query.status);
    const take = this.take(query.take, 20);
    const votes = await this.prisma.conceptVote.findMany({
      where: {
        status,
        visibility: 'public',
        ...(artistId ? { artistId } : {}),
        ...(status === 'active' ? this.activeWindowWhere(now) : {}),
      },
      include: {
        artist: { select: { id: true, slug: true, displayName: true } },
        options: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      },
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }],
      take,
    });
    const voteIds = votes.map((vote) => vote.id);
    const [ballots, missions] = await Promise.all([
      viewerUserId && voteIds.length
        ? this.prisma.conceptVoteBallot.findMany({
            where: { userId: viewerUserId, voteId: { in: voteIds } },
          })
        : [],
      voteIds.length
        ? this.prisma.fanMission.findMany({
            where: {
              status: 'active',
              missionType: 'vote_concept',
              actionType: 'concept_vote',
              actionTargetId: { in: voteIds },
            },
          })
        : [],
    ]);
    const ballotByVote = new Map(ballots.map((ballot) => [ballot.voteId, ballot]));
    const missionByVote = new Map(missions.map((mission) => [mission.actionTargetId, mission]));

    return {
      generatedAt: now.toISOString(),
      locale,
      items: await Promise.all(
        votes.map((vote) =>
          this.presentConceptVote(vote, locale, ballotByVote.get(vote.id), missionByVote.get(vote.id)),
        ),
      ),
      policy: this.policy(),
    };
  }

  async submitConceptVoteBallot(userId: string, voteId: string, input: FanEngagementBody) {
    this.assertUuid(voteId, 'voteId');
    const optionId = this.string(input, 'optionId');
    this.assertUuid(optionId, 'optionId');
    const missionId = this.optionalString(input, 'missionId');
    if (missionId) {
      this.assertUuid(missionId, 'missionId');
    }
    const idempotencyKey = this.optionalString(input, 'idempotencyKey');
    const existingByIdempotency = idempotencyKey
      ? await this.prisma.conceptVoteBallot.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey } },
          include: { vote: { include: { artist: true, options: true } }, option: true },
        })
      : null;

    if (existingByIdempotency) {
      if (existingByIdempotency.voteId !== voteId) {
        throw new BadRequestException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'fanEngagement.error.idempotencyKeyReused',
          messageKey: 'fanEngagement.error.idempotencyKeyReused',
          details: { voteId },
        });
      }

      return this.presentBallotResult(existingByIdempotency, null, 0, true);
    }

    const vote = await this.prisma.conceptVote.findUnique({
      where: { id: voteId },
      include: {
        artist: { select: { id: true, slug: true, displayName: true } },
        options: true,
      },
    });

    if (!vote) {
      throw new NotFoundException('Concept vote not found');
    }

    this.assertVoteOpen(vote);
    const option = vote.options.find((item) => item.id === optionId);
    if (!option) {
      throw new BadRequestException({
        code: 'OPTION_NOT_IN_VOTE',
        message: 'optionId does not belong to this vote',
        details: { voteId, optionId },
      });
    }

    const existingVote = await this.prisma.conceptVoteBallot.findUnique({
      where: { voteId_userId: { voteId, userId } },
    });
    if (existingVote) {
      throw new BadRequestException({
        code: 'ALREADY_VOTED',
        message: 'User already voted in this concept vote',
        details: { voteId },
      });
    }

    const mission = missionId
      ? await this.findLinkedConceptVoteMission(missionId, vote)
      : null;

    const result = await this.prisma
      .$transaction(async (tx) => {
        const ballot = await tx.conceptVoteBallot.create({
          data: { voteId, optionId, userId, missionId, idempotencyKey },
          include: {
            vote: { include: { artist: true, options: true } },
            option: true,
          },
        });
        let participation = null;
        let pointsGranted = 0;

        if (mission) {
          participation = await this.createParticipationRow(tx, {
            mission,
            userId,
            sourceType: 'concept_vote',
            sourceId: vote.id,
            idempotencyKey: null,
          });
          pointsGranted = await this.grantMissionPoints(tx, userId, mission, participation.id);
        }

        return { ballot, participation, pointsGranted };
      })
      .catch((error) => {
        if (this.isUniqueConstraintError(error)) {
          throw new BadRequestException({
            code: 'ALREADY_VOTED',
            message: 'fanEngagement.error.alreadyVoted',
            messageKey: 'fanEngagement.error.alreadyVoted',
            details: { voteId },
          });
        }

        throw error;
      });

    return this.presentBallotResult(
      result.ballot,
      result.participation,
      result.pointsGranted,
      false,
    );
  }

  async createMissionParticipation(
    userId: string,
    missionId: string,
    input: FanEngagementBody,
  ) {
    this.assertUuid(missionId, 'missionId');
    const action = this.optionalString(input, 'action') ?? 'complete';
    if (action !== 'complete') {
      throw new BadRequestException({
        code: 'INVALID_MISSION_ACTION',
        message: 'action must be complete',
      });
    }

    const idempotencyKey = this.optionalString(input, 'idempotencyKey');
    const existingByIdempotency = idempotencyKey
      ? await this.prisma.fanMissionParticipation.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey } },
        })
      : null;

    if (existingByIdempotency) {
      if (existingByIdempotency.missionId !== missionId) {
        throw new BadRequestException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'fanEngagement.error.idempotencyKeyReused',
          messageKey: 'fanEngagement.error.idempotencyKeyReused',
          details: { missionId },
        });
      }

      return {
        participation: this.presentParticipation(existingByIdempotency),
        rewards: this.rewards(0),
        idempotentReplay: true,
      };
    }

    const mission = await this.findOpenMission(missionId);
    const sourceType = this.optionalString(input, 'sourceType');
    const sourceId = this.optionalString(input, 'sourceId');
    if (sourceId) {
      this.assertUuid(sourceId, 'sourceId');
    }
    const resetBucket = this.resetBucket(mission);
    const existing = await this.prisma.fanMissionParticipation.findUnique({
      where: {
        missionId_userId_resetBucket: { missionId, userId, resetBucket },
      },
    });

    if (existing) {
      throw new BadRequestException({
        code: 'ALREADY_PARTICIPATED',
        message: 'Mission already completed for this reset bucket',
        details: { missionId, resetBucket },
      });
    }

    const result = await this.prisma
      .$transaction(async (tx) => {
        const participation = await this.createParticipationRow(tx, {
          mission,
          userId,
          sourceType,
          sourceId,
          idempotencyKey,
        });
        const pointsGranted = await this.grantMissionPoints(tx, userId, mission, participation.id);
        return { participation, pointsGranted };
      })
      .catch((error) => {
        if (this.isUniqueConstraintError(error)) {
          throw new BadRequestException({
            code: 'ALREADY_PARTICIPATED',
            message: 'fanEngagement.error.alreadyParticipated',
            messageKey: 'fanEngagement.error.alreadyParticipated',
            details: { missionId, resetBucket },
          });
        }

        throw error;
      });

    return {
      participation: this.presentParticipation(result.participation),
      rewards: this.rewards(result.pointsGranted),
      idempotentReplay: false,
    };
  }

  async getMySummary(userId: string, query: FanEngagementQuery) {
    const locale = this.locale(query.locale);
    const [ledger, participations, achievements, titles] = await Promise.all([
      this.prisma.fanEngagementPointLedger.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.fanMissionParticipation.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.userFanAchievement.findMany({
        where: { userId },
        include: { achievement: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.userFanTitle.findMany({
        where: { userId },
        include: { title: true },
        orderBy: [{ equipped: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);
    const balance = ledger.reduce((sum, row) => {
      if (row.direction === 'spend') {
        return sum - row.points;
      }
      return sum + row.points;
    }, 0);
    const lifetimeEarned = ledger
      .filter((row) => row.direction === 'earn')
      .reduce((sum, row) => sum + row.points, 0);
    const today = this.resetBucketForPolicy('daily', new Date());

    return {
      generatedAt: new Date().toISOString(),
      locale,
      points: {
        balance,
        lifetimeEarned,
        cashLike: false,
        transferable: false,
        settlementEligible: false,
        luminaConvertible: false,
      },
      participationSummary: {
        completedTodayCount: participations.filter(
          (row) => row.resetBucket === today && row.status === 'accepted',
        ).length,
        currentStreakDays: 0,
        totalAcceptedCount: participations.filter((row) => row.status === 'accepted').length,
      },
      achievements: achievements.map((row) => ({
        code: row.achievement.code,
        status: row.status,
        statusKey: `fanAchievement.status.${row.status}`,
        category: row.achievement.category,
        categoryKey: `fanAchievement.category.${row.achievement.category}`,
        copy: this.achievementCopy(row.achievement.copy, row.achievement.code),
        badgeIconKey: row.achievement.badgeIconKey,
        progress: {
          current: row.progressCurrent,
          target: row.progressTarget,
        },
        earnedAt: row.earnedAt,
      })),
      titles: {
        equipped: this.presentEquippedTitle(titles.find((row) => row.equipped)),
        items: titles.map((row) => ({
          code: row.title.code,
          status: row.status,
          statusKey: `fanTitle.status.${row.status}`,
          rarity: row.title.rarity,
          rarityKey: `fanTitle.rarity.${row.title.rarity}`,
          copy: this.titleCopy(row.title.copy, row.title.code),
        })),
      },
      recentLedger: ledger.map((row) => ({
        id: row.id,
        points: row.points,
        direction: row.direction,
        directionKey: `fanPointLedger.direction.${row.direction}`,
        ledgerType: row.ledgerType,
        ledgerTypeKey: `fanPointLedger.ledgerType.${row.ledgerType}`,
        referenceType: row.referenceType,
        referenceTypeKey: `fanPointLedger.referenceType.${row.referenceType}`,
        createdAt: row.createdAt,
      })),
      policy: this.policy(),
    };
  }

  private async participationMap(userId: string, missions: Array<{ id: string; resetPolicy: string }>) {
    const keys = missions.map((mission) => ({
      missionId: mission.id,
      resetBucket: this.resetBucket(mission),
    }));
    const rows = keys.length
      ? await this.prisma.fanMissionParticipation.findMany({
          where: {
            userId,
            OR: keys,
          },
        })
      : [];

    return new Map(
      rows.map((row) => [`${row.missionId}:${row.resetBucket}`, row]),
    );
  }

  private async presentConceptVote(
    vote: {
      id: string;
      artist: { id: string; slug: string; displayName: string };
      status: string;
      visibility: string;
      copy: Prisma.JsonValue;
      options: Array<{
        id: string;
        optionKey: string;
        copy: Prisma.JsonValue;
        sortOrder: number;
      }>;
    },
    locale: string,
    ballot: { optionId: string } | undefined,
    mission: { id: string } | undefined,
  ) {
    return {
      id: vote.id,
      artist: vote.artist,
      status: vote.status,
      statusKey: `conceptVote.status.${vote.status}`,
      visibility: vote.visibility,
      visibilityKey: `conceptVote.visibility.${vote.visibility}`,
      copy: this.voteCopy(vote.copy, vote.id),
      options: vote.options.map((option) => ({
        id: option.id,
        optionKey: option.optionKey,
        labels: this.labels(option.copy, locale),
        sortOrder: option.sortOrder,
      })),
      viewer: {
        hasVoted: Boolean(ballot),
        selectedOptionId: ballot?.optionId ?? null,
      },
      resultsPreview: ballot ? await this.resultsPreview(vote.id) : null,
      mission: mission
        ? {
            id: mission.id,
            participationStatus: 'not_started',
          }
        : null,
    };
  }

  private presentMission(
    mission: {
      id: string;
      slug: string;
      missionType: string;
      status: string;
      startsAt: Date | null;
      endsAt: Date | null;
      artist: { id: string; slug: string; displayName: string } | null;
      copy: Prisma.JsonValue;
      rewardPolicy: Prisma.JsonValue;
      actionType: string | null;
      actionTargetId: string | null;
      resetPolicy: string;
    },
    locale: string,
    participationMap: Map<string, { status: string; createdAt: Date }>,
  ) {
    const resetBucket = this.resetBucket(mission);
    const participation = participationMap.get(`${mission.id}:${resetBucket}`);
    const action =
      mission.missionType === 'vote_concept' &&
      mission.actionType === 'concept_vote' &&
      mission.actionTargetId
        ? {
            type: 'concept_vote',
            method: 'POST',
            endpoint: `/api/v1/fan-engagement/concept-votes/${mission.actionTargetId}/ballots`,
            requiresAuth: true,
            bodyHint: {
              optionId: 'uuid',
              missionId: mission.id,
              idempotencyKey: 'client-generated-key',
            },
          }
        : null;

    return {
      id: mission.id,
      slug: mission.slug,
      missionType: mission.missionType,
      missionTypeKey: `fanMission.type.${mission.missionType}`,
      artist: mission.artist,
      copy: this.missionCopy(mission.copy, mission.slug, locale),
      status: mission.status,
      statusKey: `fanMission.status.${mission.status}`,
      startsAt: mission.startsAt,
      endsAt: mission.endsAt,
      participation: {
        status: participation?.status ?? 'not_started',
        statusKey: `fanMissionParticipation.status.${participation?.status ?? 'not_started'}`,
        participatedAt: participation?.createdAt ?? null,
        remainingCount: participation ? 0 : 1,
      },
      rewardPreview: this.rewardPreview(mission.rewardPolicy),
      action,
    };
  }

  private async findLinkedConceptVoteMission(
    missionId: string,
    vote: { id: string; artistId: string },
  ) {
    const mission = await this.findOpenMission(missionId);
    if (
      mission.missionType !== 'vote_concept' ||
      mission.actionType !== 'concept_vote' ||
      mission.actionTargetId !== vote.id ||
      (mission.artistId && mission.artistId !== vote.artistId)
    ) {
      throw new BadRequestException({
        code: 'MISSION_NOT_LINKED_TO_VOTE',
        message: 'missionId is not linked to this concept vote',
        details: { missionId, voteId: vote.id },
      });
    }

    return mission;
  }

  private async findOpenMission(missionId: string) {
    const mission = await this.prisma.fanMission.findUnique({ where: { id: missionId } });
    if (!mission) {
      throw new NotFoundException('Fan mission not found');
    }

    this.assertMissionOpen(mission);
    return mission;
  }

  private createParticipationRow(
    tx: Prisma.TransactionClient,
    input: {
      mission: {
        id: string;
        artistId: string | null;
        missionType: string;
        resetPolicy: string;
      };
      userId: string;
      sourceType?: string | null;
      sourceId?: string | null;
      idempotencyKey?: string | null;
    },
  ) {
    return tx.fanMissionParticipation.create({
      data: {
        missionId: input.mission.id,
        userId: input.userId,
        artistId: input.mission.artistId,
        participationType: input.mission.missionType,
        status: 'accepted',
        moderationStatus: 'not_required',
        resetBucket: this.resetBucket(input.mission),
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        idempotencyKey: input.idempotencyKey,
      },
    });
  }

  private async grantMissionPoints(
    tx: Prisma.TransactionClient,
    userId: string,
    mission: { rewardPolicy: Prisma.JsonValue },
    participationId: string,
  ) {
    const points = this.rewardPoints(mission.rewardPolicy);
    if (points < 1) {
      return 0;
    }

    const existing = await tx.fanEngagementPointLedger.findUnique({
      where: {
        userId_referenceType_referenceId_ledgerType: {
          userId,
          referenceType: 'fan_mission_participation',
          referenceId: participationId,
          ledgerType: 'mission_reward',
        },
      },
    });

    if (existing) {
      return 0;
    }

    await tx.fanEngagementPointLedger.create({
      data: {
        userId,
        points,
        direction: 'earn',
        ledgerType: 'mission_reward',
        referenceType: 'fan_mission_participation',
        referenceId: participationId,
        metadata: this.toJson({
          cashLike: false,
          luminaAmount: 0,
          settlementEligible: false,
          transferable: false,
        }),
      },
    });

    return points;
  }

  private async presentBallotResult(
    ballot: {
      id: string;
      voteId: string;
      optionId: string;
      createdAt: Date;
      vote: { id: string };
    },
    participation: {
      id: string;
      missionId: string;
      status: string;
      moderationStatus: string;
      createdAt: Date;
    } | null,
    pointsGranted: number,
    idempotentReplay: boolean,
  ) {
    return {
      ballot: {
        id: ballot.id,
        voteId: ballot.voteId,
        optionId: ballot.optionId,
        createdAt: ballot.createdAt,
      },
      viewer: {
        hasVoted: true,
        selectedOptionId: ballot.optionId,
      },
      resultsPreview: await this.resultsPreview(ballot.voteId),
      missionParticipation: participation ? this.presentParticipation(participation) : null,
      rewards: this.rewards(pointsGranted),
      idempotentReplay,
    };
  }

  private async resultsPreview(voteId: string) {
    const rows = await this.prisma.conceptVoteBallot.groupBy({
      by: ['optionId'],
      where: { voteId },
      _count: { _all: true },
    });
    const total = rows.reduce((sum, row) => sum + row._count._all, 0);

    return {
      visible: true,
      totalBallots: total,
      options: rows.map((row) => ({
        id: row.optionId,
        ballotCount: row._count._all,
        ratio: total ? Math.round((row._count._all / total) * 1000) / 10 : 0,
      })),
    };
  }

  private presentParticipation(row: {
    id: string;
    missionId: string;
    status: string;
    moderationStatus: string;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      missionId: row.missionId,
      status: row.status,
      statusKey: `fanMissionParticipation.status.${row.status}`,
      moderationStatus: row.moderationStatus,
      moderationStatusKey: `fanMissionParticipation.moderationStatus.${row.moderationStatus}`,
      createdAt: row.createdAt,
    };
  }

  private presentEquippedTitle(
    row:
      | {
          title: { code: string; copy: Prisma.JsonValue };
          equippedAt: Date | null;
        }
      | undefined,
  ) {
    if (!row) {
      return null;
    }

    return {
      code: row.title.code,
      copy: {
        displayNameKey: this.titleCopy(row.title.copy, row.title.code).displayNameKey,
        labels: this.labels(row.title.copy, 'ko'),
      },
      equippedAt: row.equippedAt,
    };
  }

  private assertVoteOpen(vote: {
    status: string;
    startsAt: Date | null;
    endsAt: Date | null;
  }) {
    const now = new Date();
    if (vote.status !== 'active' || (vote.startsAt && vote.startsAt > now) || (vote.endsAt && vote.endsAt <= now)) {
      throw new BadRequestException({
        code: 'VOTE_NOT_ACTIVE',
        message: 'Concept vote is not active',
      });
    }
  }

  private assertMissionOpen(mission: {
    status: string;
    startsAt: Date | null;
    endsAt: Date | null;
  }) {
    const now = new Date();
    if (
      mission.status !== 'active' ||
      (mission.startsAt && mission.startsAt > now) ||
      (mission.endsAt && mission.endsAt <= now)
    ) {
      throw new BadRequestException({
        code: 'MISSION_NOT_ACTIVE',
        message: 'Fan mission is not active',
      });
    }
  }

  private missionCopy(value: Prisma.JsonValue, slug: string, locale: string) {
    const copy = this.metadataObject(value);
    return {
      titleKey: this.copyKey(copy, 'titleKey', `fanMission.${slug}.title`),
      descriptionKey: this.copyKey(copy, 'descriptionKey', `fanMission.${slug}.description`),
      ctaKey: this.copyKey(copy, 'ctaKey', `fanMission.${slug}.cta`),
      statusKey: this.copyKey(copy, 'statusKey', 'fanMission.status.active'),
      labels: this.labels(copy, locale),
    };
  }

  private voteCopy(value: Prisma.JsonValue, id: string) {
    const copy = this.metadataObject(value);
    return {
      titleKey: this.copyKey(copy, 'titleKey', `conceptVote.${id}.title`),
      summaryKey: this.copyKey(copy, 'summaryKey', `conceptVote.${id}.summary`),
      statusKey: this.copyKey(copy, 'statusKey', 'conceptVote.status.active'),
      labels: this.labels(copy, 'ko'),
    };
  }

  private achievementCopy(value: Prisma.JsonValue, code: string) {
    const copy = this.metadataObject(value);
    return {
      titleKey: this.copyKey(copy, 'titleKey', `achievement.${code}.title`),
      descriptionKey: this.copyKey(copy, 'descriptionKey', `achievement.${code}.description`),
      labels: this.labels(copy, 'ko'),
    };
  }

  private titleCopy(value: Prisma.JsonValue, code: string) {
    const copy = this.metadataObject(value);
    return {
      displayNameKey: this.copyKey(copy, 'displayNameKey', `fanTitle.${code}.name`),
      descriptionKey: this.copyKey(copy, 'descriptionKey', `fanTitle.${code}.description`),
      labels: this.labels(copy, 'ko'),
    };
  }

  private labels(value: Prisma.JsonValue | JsonRecord, locale: string) {
    const copy = this.metadataObject(value);
    const labels = this.metadataObject(copy.labels);
    const localized = this.metadataObject(labels[locale]) || this.metadataObject(labels.ko);

    return Object.keys(localized).length ? { [locale]: localized } : undefined;
  }

  private copyKey(copy: JsonRecord, key: string, fallback: string) {
    return typeof copy[key] === 'string' && copy[key] ? copy[key] : fallback;
  }

  private rewardPreview(value: Prisma.JsonValue) {
    const policy = this.metadataObject(value);
    return {
      points: this.rewardPoints(value),
      achievementCodes: this.stringArray(policy.achievementCodes),
      titleCodes: this.stringArray(policy.titleCodes),
      cashLike: false,
      luminaAmount: 0,
      settlementEligible: false,
      transferable: false,
    };
  }

  private rewards(pointsGranted: number) {
    return {
      pointsGranted,
      achievementsGranted: [] as string[],
      titlesGranted: [] as string[],
      cashLike: false,
      luminaAmount: 0,
      settlementEligible: false,
      transferable: false,
    };
  }

  private policy() {
    return {
      serviceTimezone: 'Asia/Seoul',
      rewardsAreCashLike: false,
      cashLike: false,
      luminaAmount: 0,
      pointsTransferable: false,
      transferable: false,
      settlementEligible: false,
      luminaConvertible: false,
      aiDraftsAutoPublish: false,
    };
  }

  private rewardPoints(value: Prisma.JsonValue) {
    const policy = this.metadataObject(value);
    const points = Number(policy.points ?? 0);
    return Number.isInteger(points) && points > 0 ? points : 0;
  }

  private activeWindowWhere(now: Date) {
    return {
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      ],
    } satisfies Prisma.FanMissionWhereInput;
  }

  private resetBucket(mission: { resetPolicy: string }) {
    return this.resetBucketForPolicy(mission.resetPolicy, new Date());
  }

  private resetBucketForPolicy(resetPolicy: string, date: Date) {
    const [policy, value] = resetPolicy.split(':', 2);
    if (policy === 'once') {
      return 'once';
    }

    if (policy === 'weekly') {
      return this.kstWeekBucket(date);
    }

    if (policy === 'season') {
      return value || 'season';
    }

    return this.kstDateBucket(date);
  }

  private kstDateBucket(date: Date) {
    return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  private kstWeekBucket(date: Date) {
    const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    const day = kst.getUTCDay() || 7;
    kst.setUTCDate(kst.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(kst.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((kst.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${kst.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  private take(value: string | undefined, max: number) {
    if (!value) {
      return max;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException('take must be a positive integer');
    }

    return Math.min(parsed, max);
  }

  private surface(value: string | undefined) {
    if (!value) {
      return undefined;
    }

    if (!VALID_SURFACES.has(value)) {
      throw new BadRequestException('surface is invalid');
    }

    return value;
  }

  private missionScope(value: string | undefined) {
    const scope = value ?? 'today';
    if (!VALID_MISSION_SCOPES.has(scope)) {
      throw new BadRequestException('scope is invalid');
    }

    return scope;
  }

  private voteStatus(value: string | undefined) {
    const status = value ?? 'active';
    if (!VALID_VOTE_STATUSES.has(status)) {
      throw new BadRequestException('status is invalid');
    }

    return status;
  }

  private locale(value: string | undefined) {
    return value === 'ko' ? 'ko' : 'ko';
  }

  private optionalUuid(value: string | undefined, field: string) {
    if (!value) {
      return undefined;
    }

    this.assertUuid(value, field);
    return value;
  }

  private assertUuid(value: string, field: string) {
    if (!UUID_PATTERN.test(value)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
  }

  private string(input: FanEngagementBody, key: string) {
    const value = input[key];
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${key} must be a non-empty string`);
    }

    return value.trim();
  }

  private optionalString(input: FanEngagementBody, key: string) {
    const value = input[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private metadataObject(value: unknown): JsonRecord {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonRecord)
      : {};
  }

  private stringArray(value: unknown) {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private isUniqueConstraintError(error: unknown) {
    return this.metadataObject(error).code === 'P2002';
  }

  private toJson(value: unknown) {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}

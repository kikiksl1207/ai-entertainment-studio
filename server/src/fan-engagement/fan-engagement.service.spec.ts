import { UnauthorizedException } from '@nestjs/common';
import { FanEngagementJwtAuthGuard } from './fan-engagement-auth.guard';
import { FanEngagementService } from './fan-engagement.service';

const userId = '00000000-0000-4000-8000-000000000001';
const missionId = '00000000-0000-4000-8000-000000000101';
const sourceId = '00000000-0000-4000-8000-000000000201';
const otherSourceId = '00000000-0000-4000-8000-000000000202';
const createdAt = new Date('2026-05-10T00:00:00.000Z');

type PrismaMock = {
  user: {
    findUnique: jest.Mock;
  };
  fanMission: {
    findUnique: jest.Mock;
  };
  fanMissionParticipation: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
  fanEngagementPointLedger: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
  userFanTitle: {
    findFirst: jest.Mock;
    updateMany: jest.Mock;
    update: jest.Mock;
  };
  userFanAchievement: {
    findMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

function activeMission(overrides: Record<string, unknown> = {}) {
  return {
    id: missionId,
    artistId: null,
    missionType: 'qa_submit_smoke',
    status: 'active',
    startsAt: new Date('2026-05-09T00:00:00.000Z'),
    endsAt: new Date('2099-05-12T00:00:00.000Z'),
    resetPolicy: 'season:qa-submit-spec',
    rewardPolicy: { points: 1 },
    ...overrides,
  };
}

function participation(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000301',
    missionId,
    userId,
    artistId: null,
    participationType: 'qa_submit_smoke',
    status: 'accepted',
    moderationStatus: 'not_required',
    resetBucket: 'qa-submit-spec',
    sourceType: 'qa_smoke',
    sourceId,
    idempotencyKey: 'idem-1',
    metadata: {
      idempotency: {
        requestFingerprint: JSON.stringify({
          action: 'complete',
          sourceType: 'qa_smoke',
          sourceId,
        }),
        request: {
          action: 'complete',
          sourceType: 'qa_smoke',
          sourceId,
        },
      },
    },
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function createPrismaMock(): PrismaMock {
  const prisma: PrismaMock = {
    user: {
      findUnique: jest.fn(),
    },
    fanMission: {
      findUnique: jest.fn(),
    },
    fanMissionParticipation: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    fanEngagementPointLedger: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    userFanTitle: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    userFanAchievement: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (tx: PrismaMock) => Promise<unknown>) => callback(prisma),
  );

  return prisma;
}

function serviceWith(prisma: PrismaMock) {
  return new FanEngagementService(prisma as never);
}

function fanTitle(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000501',
    userId,
    titleId: '00000000-0000-4000-8000-000000000502',
    status: 'active',
    equipped: false,
    equippedAt: null,
    createdAt,
    updatedAt: createdAt,
    title: {
      id: '00000000-0000-4000-8000-000000000502',
      code: 'concept_scout',
      rarity: 'common',
      copy: {
        labels: {
          ko: {
            displayName: '콘셉트 스카우트',
            description: '첫 콘셉트 참여 칭호',
          },
        },
      },
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    },
    ...overrides,
  };
}

function fanAchievement(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000601',
    userId,
    achievementId: '00000000-0000-4000-8000-000000000602',
    status: 'earned',
    progressCurrent: 1,
    progressTarget: 1,
    earnedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
    achievement: {
      id: '00000000-0000-4000-8000-000000000602',
      code: 'first_signal',
      category: 'mission',
      copy: {
        labels: {
          ko: {
            title: '첫 응원 신호',
            description: '처음으로 팬 미션에 참여했어요.',
          },
        },
      },
      badgeIconKey: 'signal-star',
      criteria: {},
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    },
    ...overrides,
  };
}

describe('FanEngagementService.createMissionParticipation', () => {
  it('creates one participation and one non-cash point grant for first submit', async () => {
    const prisma = createPrismaMock();
    prisma.fanMissionParticipation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.fanMission.findUnique.mockResolvedValue(activeMission());
    prisma.fanMissionParticipation.create.mockResolvedValue(participation());
    prisma.fanEngagementPointLedger.findUnique.mockResolvedValue(null);
    prisma.fanEngagementPointLedger.create.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000401',
    });

    const result = await serviceWith(prisma).createMissionParticipation(userId, missionId, {
      action: 'complete',
      sourceType: 'qa_smoke',
      sourceId,
      idempotencyKey: 'idem-1',
    });

    expect(result).toMatchObject({
      idempotentReplay: false,
      rewards: {
        pointsGranted: 1,
        cashLike: false,
        luminaAmount: 0,
        settlementEligible: false,
        transferable: false,
      },
    });
    expect(prisma.fanMissionParticipation.create).toHaveBeenCalledTimes(1);
    expect(prisma.fanEngagementPointLedger.create).toHaveBeenCalledTimes(1);
  });

  it('replays the same idempotency key and body without a new grant', async () => {
    const prisma = createPrismaMock();
    prisma.fanMissionParticipation.findUnique.mockResolvedValue(participation());

    const result = await serviceWith(prisma).createMissionParticipation(userId, missionId, {
      action: 'complete',
      sourceType: 'qa_smoke',
      sourceId,
      idempotencyKey: 'idem-1',
    });

    expect(result).toMatchObject({
      idempotentReplay: true,
      rewards: { pointsGranted: 0 },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.fanEngagementPointLedger.create).not.toHaveBeenCalled();
  });

  it('rejects idempotency key reuse with a different request body', async () => {
    const prisma = createPrismaMock();
    prisma.fanMissionParticipation.findUnique.mockResolvedValue(participation());

    await expect(
      serviceWith(prisma).createMissionParticipation(userId, missionId, {
        action: 'complete',
        sourceType: 'qa_smoke',
        sourceId: otherSourceId,
        idempotencyKey: 'idem-1',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'IDEMPOTENCY_BODY_MISMATCH',
        messageKey: 'fanEngagement.error.idempotencyBodyMismatch',
      },
    });
  });

  it('rejects duplicate submit in the same reset bucket', async () => {
    const prisma = createPrismaMock();
    prisma.fanMissionParticipation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(participation());
    prisma.fanMission.findUnique.mockResolvedValue(activeMission());

    await expect(
      serviceWith(prisma).createMissionParticipation(userId, missionId, {
        action: 'complete',
        sourceType: 'qa_smoke',
        sourceId,
        idempotencyKey: 'idem-2',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'ALREADY_PARTICIPATED',
        messageKey: 'fanEngagement.mission.alreadyParticipated',
      },
    });
  });

  it('returns stable not-found response for missing mission', async () => {
    const prisma = createPrismaMock();
    prisma.fanMissionParticipation.findUnique.mockResolvedValue(null);
    prisma.fanMission.findUnique.mockResolvedValue(null);

    await expect(
      serviceWith(prisma).createMissionParticipation(userId, missionId, {
        action: 'complete',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'MISSION_NOT_FOUND',
        messageKey: 'fanEngagement.mission.notFound',
      },
    });
  });

  it('returns stable inactive response for closed missions', async () => {
    const prisma = createPrismaMock();
    prisma.fanMissionParticipation.findUnique.mockResolvedValue(null);
    prisma.fanMission.findUnique.mockResolvedValue(activeMission({ status: 'inactive' }));

    await expect(
      serviceWith(prisma).createMissionParticipation(userId, missionId, {
        action: 'complete',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'MISSION_NOT_ACTIVE',
        messageKey: 'fanEngagement.mission.notActive',
      },
    });
  });

  it('returns stable validation response for invalid mission id', async () => {
    const prisma = createPrismaMock();

    await expect(
      serviceWith(prisma).createMissionParticipation(userId, 'not-a-uuid', {
        action: 'complete',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'INVALID_UUID',
        messageKey: 'fanEngagement.validation.invalidUuid',
      },
    });
  });

  it('wraps logged-out submit as AUTH_REQUIRED', async () => {
    const jwtAuthGuard = {
      canActivate: jest.fn().mockRejectedValue(new UnauthorizedException()),
    };
    const guard = new FanEngagementJwtAuthGuard(jwtAuthGuard as never);

    await expect(guard.canActivate({} as never)).rejects.toMatchObject({
      response: {
        code: 'AUTH_REQUIRED',
        messageKey: 'fanEngagement.auth.required',
      },
    });
    await expect(guard.canActivate({} as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('FanEngagementService fan title/public summary', () => {
  it('equips an owned active title and clears any previous equipped title', async () => {
    const prisma = createPrismaMock();
    const title = fanTitle();
    const equippedAt = new Date('2026-05-10T01:00:00.000Z');
    prisma.userFanTitle.findFirst.mockResolvedValue(title);
    prisma.userFanTitle.updateMany.mockResolvedValue({ count: 1 });
    prisma.userFanTitle.update.mockResolvedValue(
      fanTitle({ equipped: true, equippedAt }),
    );

    const result = await serviceWith(prisma).equipTitle(userId, {
      titleCode: 'concept_scout',
    });

    expect(prisma.userFanTitle.updateMany).toHaveBeenCalledWith({
      where: { userId, equipped: true },
      data: expect.objectContaining({ equipped: false, equippedAt: null }),
    });
    expect(result).toMatchObject({
      equipped: {
        code: 'concept_scout',
        copy: {
          labels: {
            ko: {
              displayName: '콘셉트 스카우트',
            },
          },
        },
      },
      policy: {
        settlementEligible: false,
        luminaConvertible: false,
      },
    });
  });

  it('rejects title equip when the user does not own the title', async () => {
    const prisma = createPrismaMock();
    prisma.userFanTitle.findFirst.mockResolvedValue(null);

    await expect(
      serviceWith(prisma).equipTitle(userId, { titleCode: 'missing_title' }),
    ).rejects.toMatchObject({
      response: {
        code: 'FAN_TITLE_NOT_OWNED',
        messageKey: 'fanTitle.notOwned',
      },
    });
  });

  it('returns only public fan title and badge data for public summaries', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({ id: userId });
    prisma.userFanTitle.findFirst.mockResolvedValue(
      fanTitle({ equipped: true, equippedAt: createdAt }),
    );
    prisma.userFanAchievement.findMany.mockResolvedValue([fanAchievement()]);

    const result = await serviceWith(prisma).getPublicSummary(userId, {});

    expect(result).toMatchObject({
      userId,
      publicTitle: {
        code: 'concept_scout',
      },
      publicBadges: [
        {
          code: 'first_signal',
          badgeIconKey: 'signal-star',
        },
      ],
      privacy: {
        participationHistoryPublic: false,
        exposesPrivateLedger: false,
      },
    });
    expect(result).not.toHaveProperty('recentLedger');
  });
});

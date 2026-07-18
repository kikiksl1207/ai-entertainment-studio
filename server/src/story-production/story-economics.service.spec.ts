import 'reflect-metadata';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { StoryEconomicsService } from './story-economics.service';

describe('StoryEconomicsService', () => {
  const prisma = {
    storyWork: { findFirst: jest.fn() },
    storyRelease: { findFirst: jest.fn() },
    storyReleaseCapability: { findUnique: jest.fn() },
    storyAiAllowanceBucket: { findUnique: jest.fn() },
    storyAiContinuation: { findFirst: jest.fn() },
    storyManuscriptVersion: { findFirst: jest.fn() },
    storyStyleProfileConsent: { findUnique: jest.fn() },
  };
  const service = new StoryEconomicsService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('returns a fail-closed reader capability when release config is missing', async () => {
    prisma.storyWork.findFirst.mockResolvedValue({
      id: 'work-id',
      slug: 'published-story',
      fixtureSource: false,
      coverManifest: { url: '/public/story/cover.webp' },
      activeReleaseId: 'release-id',
    });
    prisma.storyRelease.findFirst.mockResolvedValue({ id: 'release-id' });
    prisma.storyReleaseCapability.findUnique.mockResolvedValue(null);

    await expect(service.readerCapability('user-id', 'work-id')).resolves.toEqual({
      configStatus: 'missing_or_invalid',
      fixedChoices: 3,
      customChoiceEnabled: false,
      customChoiceMaxLength: 0,
      resetPolicy: { fullLimit: 0, actLimit: 0 },
      aiBudget: null,
      aiAllowanceRemaining: 0,
      revision: null,
      source: 'fail_closed',
    });
  });

  it('projects continuation status without private input, provider payload, or cost', async () => {
    prisma.storyAiContinuation.findFirst.mockResolvedValue({
      id: 'continuation-id',
      releaseId: 'release-id',
      sourceProgressRevision: 4,
      status: 'failed',
      estimatedCostKrw: '123.45',
      actualCostKrw: '10.00',
      createdAt: new Date('2026-07-14T00:00:00.000Z'),
      completedAt: new Date('2026-07-14T00:01:00.000Z'),
    });
    prisma.storyAiAllowanceBucket.findUnique.mockResolvedValue({
      includedLimit: 2,
      purchasedLimit: 0,
      reservedCount: 0,
      consumedCount: 0,
      compensatedCount: 0,
    });

    const result = await service.continuationStatus('user-id', 'continuation-id');

    expect(result).toMatchObject({
      continuationId: 'continuation-id',
      status: 'failed',
      allowanceRemaining: 2,
      retryable: true,
      progressApplied: false,
      privateInputReturned: false,
      providerPayloadReturned: false,
      internalCostReturned: false,
    });
    expect(result).not.toHaveProperty('estimatedCostKrw');
    expect(result).not.toHaveProperty('actualCostKrw');
  });

  it('requires rights confirmation before activating style consent', async () => {
    prisma.storyWork.findFirst.mockResolvedValue({ id: 'work-id' });
    prisma.storyManuscriptVersion.findFirst.mockResolvedValue({ id: 'manuscript-id' });
    prisma.storyStyleProfileConsent.findUnique.mockResolvedValue(null);

    await expect(
      service.upsertStyleConsent('user-id', 'work-id', {
        manuscriptVersionId: 'manuscript-id',
        rightsConfirmed: false,
        aiBranchAllowed: true,
        translationAllowed: false,
        imageTransformationAllowed: false,
        allowedLocales: ['ko'],
        allowedRegions: ['KR'],
        startsAt: '2026-07-14T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects free-story custom choice before spending or provider work', async () => {
    await expect(
      service.prepareCustomChoice(
        'user-id',
        {
          progress: {
            id: 'progress-id',
            workId: 'work-id',
            currentSceneId: 'scene-id',
            checkpointSceneId: 'scene-id',
            progressRevision: 1,
            activeReleaseId: 'release-id',
            pathSummary: [],
            status: 'active',
          },
          work: { id: 'work-id', priceLumina: { isZero: () => true } },
          scene: { id: 'scene-id', partId: 'part-id' },
          part: { id: 'part-id' },
        },
        'A new route',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

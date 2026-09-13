import 'reflect-metadata';
import { BadRequestException, ForbiddenException, NotFoundException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { StoryEconomicsController } from './story-economics.controller';
import { StoryEconomicsService } from './story-economics.service';
import { firstReleaseChoiceCapability } from './story-progress-control.policy';

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
      ...firstReleaseChoiceCapability(),
      aiGenerationEnabled: false,
      resetPolicy: { fullLimit: 0, actLimit: 0 },
      aiBudget: null,
      aiAllowanceRemaining: 0,
      revision: null,
      source: 'fail_closed',
    });
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

describe('continuation status controller/service boundary', () => {
  function fixture() {
    const rows = ['queued', 'processing', 'completed', 'failed', 'timeout'].map((status, index) => ({
      id: `continuation-${index}`,
      userId: 'reader',
      progressId: `progress-${index}`,
      workId: `work-${index}`,
      releaseId: `release-${index}`,
      sourceProgressRevision: index + 4,
      status,
      privateInput: 'synthetic private input',
      providerPayload: { text: 'synthetic provider payload' },
      contextReferences: { memoryIds: ['private-memory'] },
      estimatedCostKrw: '123.45',
      actualCostKrw: '10.00',
      failureCode: 'internal-only',
      createdAt: new Date('2026-07-14T00:00:00.000Z'),
      completedAt: index < 2 ? null : new Date('2026-07-14T00:01:00.000Z'),
    }));
    const allowances = rows.map((row, index) => ({
      userId: row.userId, releaseId: row.releaseId,
      includedLimit: index + 2, purchasedLimit: 0,
      reservedCount: 1, consumedCount: 0, compensatedCount: 0,
    }));
    const reads = {
      continuation: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        rows.find((row) => Object.entries(where).every(([key, value]) =>
          row[key as keyof typeof row] === value)) ?? null),
      allowance: jest.fn(async ({ where }: {
        where: { userId_releaseId: { userId: string; releaseId: string } };
      }) => allowances.find((row) =>
        row.userId === where.userId_releaseId.userId &&
        row.releaseId === where.userId_releaseId.releaseId) ?? null),
    };
    // A strict read-only adapter makes any new transaction, ledger, quota or write fail.
    function readOnly<T extends object>(target: T): T {
      return new Proxy(target, {
        get(object, key, receiver) {
          if (!(key in object)) throw new Error(`Unexpected database access: ${String(key)}`);
          return Reflect.get(object, key, receiver);
        },
      });
    }
    const db = readOnly({
      storyAiContinuation: readOnly({ findFirst: reads.continuation }),
      storyAiAllowanceBucket: readOnly({ findUnique: reads.allowance }),
    });
    const economics = new StoryEconomicsService(db as never);
    return { rows, allowances, reads, economics, controller: new StoryEconomicsController(economics) };
  }

  it('binds both URL parameters on the actual GET controller method', () => {
    const method = StoryEconomicsController.prototype.continuation;
    expect(Reflect.getMetadata(PATH_METADATA, method)).toBe(
      'me/story-progress/:progressId/ai-continuations/:continuationId',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(RequestMethod.GET);
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, StoryEconomicsController, 'continuation');
    expect(args[`${RouteParamtypes.PARAM}:1`]).toMatchObject({ index: 1, data: 'progressId' });
    expect(args[`${RouteParamtypes.PARAM}:2`]).toMatchObject({ index: 2, data: 'continuationId' });
  });

  it.each([0, 1, 2, 3, 4])('forwards and safely projects the matching parent for status %i, read-only', async (index) => {
    const f = fixture();
    const row = f.rows[index];
    const before = JSON.stringify({ rows: f.rows, allowances: f.allowances });
    const forwarding = jest.spyOn(f.economics, 'continuationStatus');
    const expected = {
      continuationId: row.id, status: row.status,
      revisionAfterRequest: row.sourceProgressRevision + 1,
      allowanceRemaining: index + 1,
      retryable: ['failed', 'timeout'].includes(row.status),
      progressApplied: row.status === 'completed',
      privateInputReturned: false, providerPayloadReturned: false,
      internalCostReturned: false, idempotentReplay: false,
      createdAt: row.createdAt, completedAt: row.completedAt,
    };
    for (let request = 0; request < 2; request += 1) {
      await expect(f.controller.continuation({ id: row.userId }, row.progressId, row.id))
        .resolves.toEqual(expected);
    }
    expect(forwarding).toHaveBeenCalledTimes(2);
    expect(forwarding).toHaveBeenCalledWith(row.userId, row.progressId, row.id);
    expect(f.reads.continuation).toHaveBeenCalledTimes(2);
    expect(f.reads.continuation).toHaveBeenCalledWith({
      where: { id: row.id, userId: row.userId, progressId: row.progressId },
    });
    expect(f.reads.allowance).toHaveBeenCalledTimes(2);
    expect(f.reads.allowance).toHaveBeenCalledWith({
      where: { userId_releaseId: { userId: row.userId, releaseId: row.releaseId } },
    });
    expect(JSON.stringify({ rows: f.rows, allowances: f.allowances })).toBe(before);
  });

  it.each([
    ['same user, different progress', 'reader', 'progress-1', 'continuation-0'],
    ['reverse parent mismatch', 'reader', 'progress-0', 'continuation-1'],
    ['foreign user', 'other-reader', 'progress-0', 'continuation-0'],
    ['missing continuation', 'reader', 'progress-0', 'missing'],
    ['missing progress', 'reader', 'missing', 'continuation-0'],
  ])('returns the same safe 404 for %s without reading allowance', async (_label, userId, progressId, continuationId) => {
    const f = fixture();
    const before = JSON.stringify({ rows: f.rows, allowances: f.allowances });
    const error = await f.controller.continuation({ id: userId }, progressId, continuationId)
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getResponse()).toEqual({
      statusCode: 404, error: 'Not Found', message: 'Story AI continuation not found',
    });
    expect(f.reads.continuation).toHaveBeenCalledTimes(1);
    expect(f.reads.continuation).toHaveBeenCalledWith({
      where: { id: continuationId, userId, progressId },
    });
    expect(f.reads.allowance).not.toHaveBeenCalled();
    expect(JSON.stringify({ rows: f.rows, allowances: f.allowances })).toBe(before);
  });

  it('keeps zero allowance projection when no matching bucket exists', async () => {
    const f = fixture();
    f.allowances.splice(0, 1);
    await expect(f.controller.continuation({ id: 'reader' }, 'progress-0', 'continuation-0'))
      .resolves.toMatchObject({ allowanceRemaining: 0, status: 'queued' });
  });

  it('fails closed for a legacy two-argument runtime call before Prisma can omit undefined filters', async () => {
    const f = fixture();
    // @ts-expect-error The parent scope and continuation ID are both mandatory.
    await expect(f.economics.continuationStatus('reader', 'continuation-0'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(f.reads.continuation).not.toHaveBeenCalled();
    expect(f.reads.allowance).not.toHaveBeenCalled();
  });
});

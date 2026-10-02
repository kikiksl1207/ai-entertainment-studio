import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateStoryDraftMetadataDto, StoryCatalogQueryDto } from './dto/story-production.dto';
import { StoryProductionController } from './story-production.controller';
import { StoryProductionService } from './story-production.service';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const workId = '33333333-3333-4333-8333-333333333333';
const requestId = '44444444-4444-4444-8444-444444444444';
const assetId = '55555555-5555-4555-8555-555555555555';
const cover = { assetId, url: `/api/v1/assets/public/${assetId}/display` };
const body = { authorDisplayName: '  작가 이름  ', summary: '  작품 소개  ', coverAssetId: assetId };

function fixture() {
  const row = {
    id: workId, ownerUserId: owner, slug: `draft-${requestId}`, status: 'draft',
    activeReleaseId: null, publishedAt: null, fixtureSource: false,
    defaultLocale: 'ko', summary: { ko: '이전 소개', en: 'Earlier summary' },
    authorDisplayName: null as string | null, coverManifest: {} as object,
    releaseRevision: 3, title: { ko: '내 작품' }, updatedAt: new Date('2026-09-30T00:00:00Z'),
  };
  const asset = {
    id: assetId, owner: { userId: owner }, assetType: 'image', visibility: 'public',
    storageProvider: 'r2', uploadStatus: 'uploaded', lifecycleStatus: 'active',
  };
  const getAsset = jest.fn().mockResolvedValue({ asset });
  const storyWork = {
      findFirst: jest.fn(async ({ where }) => where.id === row.id && where.ownerUserId === row.ownerUserId ? row : null),
      findFirstOrThrow: jest.fn(async () => row),
      findMany: jest.fn(async () => [row]),
      updateMany: jest.fn(async ({ data }) => {
        row.authorDisplayName = data.authorDisplayName;
        row.summary = data.summary;
        row.coverManifest = data.coverManifest;
        row.releaseRevision += data.releaseRevision.increment;
        return { count: 1 };
      }),
  };
  const prisma = {
    storyWork,
    $transaction: jest.fn(async (run: (tx: { storyWork: typeof storyWork }) => Promise<unknown>) => run({ storyWork })),
  };
  const service = new StoryProductionService(prisma as never, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, { getAsset } as never);
  return { row, asset, getAsset, prisma, service };
}

describe('creator story draft metadata', () => {
  it('requires and trims all fields while rejecting overlong or control-character text', async () => {
    const dto = plainToInstance(UpdateStoryDraftMetadataDto, body);
    expect(await validate(dto)).toEqual([]);
    expect(dto.authorDisplayName).toBe('작가 이름');
    expect(dto.summary).toBe('작품 소개');
    for (const candidate of [
      {}, { ...body, authorDisplayName: '   ' },
      { ...body, authorDisplayName: '가'.repeat(81) },
      { ...body, summary: '가'.repeat(601) },
      { ...body, summary: '첫 줄\n둘째 줄' },
      { ...body, summary: '작품 소개\n' },
      { ...body, authorDisplayName: '\n작가 이름' },
      { ...body, authorDisplayName: '작가\u200b이름' },
      { ...body, coverAssetId: 'not-a-uuid' },
      { ...body, coverAssetId: `${assetId}\n` },
    ]) {
      expect(await validate(plainToInstance(UpdateStoryDraftMetadataDto, candidate))).not.toEqual([]);
    }
  });

  it('rechecks Creator Studio access on the JWT-protected PATCH route', async () => {
    const updateDraftMetadata = jest.fn().mockResolvedValue({ workId });
    const getStudio = jest.fn();
    const controller = new StoryProductionController({ updateDraftMetadata } as never, {} as never,
      undefined, undefined, { getStudio } as never);
    expect(Reflect.getMetadata(PATH_METADATA, controller.updateDraftMetadata)).toBe(
      'me/creator-studio/stories/:workId/metadata');
    expect(Reflect.getMetadata(GUARDS_METADATA, controller.updateDraftMetadata)).toContain(JwtAuthGuard);

    getStudio.mockResolvedValueOnce({ access: { enabled: false } });
    await expect(controller.updateDraftMetadata({ id: owner } as never, workId, body))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(updateDraftMetadata).not.toHaveBeenCalled();

    getStudio.mockResolvedValueOnce({ access: { enabled: true } });
    await expect(controller.updateDraftMetadata({ id: owner } as never, workId, body))
      .resolves.toEqual({ workId });
    expect(updateDraftMetadata).toHaveBeenCalledWith(owner, workId, body);
  });

  it.each(['draft', 'release_ready'])('stores a %s owner draft and returns only current metadata state', async (status) => {
    const f = fixture();
    f.row.status = status;
    const result = await f.service.updateDraftMetadata(owner, workId, body);
    expect(f.getAsset).toHaveBeenCalledWith(owner, assetId);
    expect(f.prisma.storyWork.updateMany).toHaveBeenCalledWith({
      where: {
        id: workId, ownerUserId: owner, slug: `draft-${requestId}`, status,
        activeReleaseId: null, publishedAt: null, fixtureSource: false, releaseRevision: 3,
      },
      data: {
        authorDisplayName: '작가 이름', summary: { ko: '작품 소개', en: 'Earlier summary' },
        coverManifest: cover, releaseRevision: { increment: 1 },
      },
    });
    expect(result).toEqual({
      workId, status, authorDisplayName: '작가 이름', summary: '작품 소개', cover,
      releaseRevision: 4,
    });
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('accepts a case-insensitive UUID request while persisting the canonical asset id', async () => {
    const f = fixture();
    const upperAssetId = assetId.toUpperCase();
    await expect(f.service.updateDraftMetadata(owner, workId, { ...body, coverAssetId: upperAssetId }))
      .resolves.toMatchObject({ cover });
    expect(f.getAsset).toHaveBeenCalledWith(owner, upperAssetId);
  });

  it('rejects another owner and non-private or non-draft works before reading assets', async () => {
    const wrongOwner = fixture();
    await expect(wrongOwner.service.updateDraftMetadata(other, workId, body))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(wrongOwner.getAsset).not.toHaveBeenCalled();

    for (const change of [
      { slug: 'published-story' }, { slug: 'draft-not-a-uuid' },
      { status: 'reviewing' }, { status: 'published' },
      { activeReleaseId: requestId }, { publishedAt: new Date() }, { fixtureSource: true },
    ]) {
      const f = fixture();
      Object.assign(f.row, change);
      await expect(f.service.updateDraftMetadata(owner, workId, body))
        .rejects.toBeInstanceOf(ConflictException);
      expect(f.getAsset).not.toHaveBeenCalled();
      expect(f.prisma.storyWork.updateMany).not.toHaveBeenCalled();
    }
  });

  it('rejects an unowned or ineligible cover without updating the work', async () => {
    for (const change of [
      { id: other }, { owner: { userId: other } }, { assetType: 'video' }, { visibility: 'private' },
      { storageProvider: 'local' },
      { uploadStatus: 'pending_upload' }, { uploadStatus: 'ready' },
      { lifecycleStatus: 'archived' },
    ]) {
      const f = fixture();
      Object.assign(f.asset, change);
      await expect(f.service.updateDraftMetadata(owner, workId, body))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(f.prisma.storyWork.updateMany).not.toHaveBeenCalled();
    }
  });

  it('fails a publication or revision race at the atomic update without leaking a new state', async () => {
    const f = fixture();
    f.prisma.storyWork.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(f.service.updateDraftMetadata(owner, workId, body))
      .rejects.toBeInstanceOf(ConflictException);
    expect(f.prisma.storyWork.findFirstOrThrow).not.toHaveBeenCalled();
  });

  it('includes saved author and cover in the independently fetched owner catalog', async () => {
    const f = fixture();
    await f.service.updateDraftMetadata(owner, workId, body);
    const result = await f.service.creatorCatalog(owner, new StoryCatalogQueryDto());
    expect(f.prisma.storyWork.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerUserId: owner, fixtureSource: false },
      select: expect.objectContaining({ authorDisplayName: true, coverManifest: true }),
    }));
    expect(result.items).toEqual([expect.objectContaining({
      workId, authorDisplayName: '작가 이름', cover,
      title: expect.objectContaining({ value: '내 작품' }),
      summary: expect.objectContaining({ value: '작품 소개' }),
      publicationSummary: expect.objectContaining({ value: '작품 소개' }),
      defaultLocale: 'ko',
      publication: expect.objectContaining({ status: 'draft', published: false }),
    })]);
    const englishQuery = new StoryCatalogQueryDto();
    englishQuery.locale = 'en';
    const englishCatalog = await f.service.creatorCatalog(owner, englishQuery);
    expect(englishCatalog.items[0].summary).toMatchObject({ value: 'Earlier summary' });
    expect(englishCatalog.items[0].publicationSummary).toMatchObject({ value: '작품 소개' });
  });
});

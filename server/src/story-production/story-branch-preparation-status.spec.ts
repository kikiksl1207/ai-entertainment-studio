import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StoryProductionController } from './story-production.controller';
import { StoryProductionService } from './story-production.service';

describe('owner branch preparation status', () => {
  const owner = '00000000-0000-4000-8000-000000000001';
  const manuscriptId = '00000000-0000-4000-8000-000000000002';
  const workId = '00000000-0000-4000-8000-000000000003';

  it('mounts only an authenticated manuscript-scoped read route', () => {
    const handler = StoryProductionController.prototype.branchPreparations;
    expect(Reflect.getMetadata(PATH_METADATA, handler))
      .toBe('me/creator-studio/manuscripts/:manuscriptId/branch-preparations');
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard]);
  });

  it('returns only part identities and states for the owned immutable version', async () => {
    const prisma = {
      storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue({ id: manuscriptId, workId, version: 2, locale: 'ko' }) },
      storyBranchPreparationJob: { findMany: jest.fn().mockResolvedValue([
        { partIndex: 0, expectedPartCount: 2, partKey: 'opening', status: 'awaiting_author_consent' },
        { partIndex: 1, expectedPartCount: 2, partKey: 'ending', status: 'awaiting_author_consent' },
      ]) },
    };
    const result = await new StoryProductionService(prisma as never).branchPreparationStatus(owner, manuscriptId);
    expect(result).toMatchObject({ manuscriptVersionId: manuscriptId, version: 2, locale: 'ko',
      status: 'awaiting_author_consent', parts: [{ partKey: 'opening' }, { partKey: 'ending' }] });
    expect(JSON.stringify(result)).not.toMatch(/sourceHash|rawText|structuredBody|ownerUserId|expectedPartCount/);
    expect(prisma.storyManuscriptVersion.findFirst).toHaveBeenCalledWith({
      where: { id: manuscriptId, ownerUserId: owner },
      select: { id: true, workId: true, version: true, locale: true },
    });
    expect(prisma.storyBranchPreparationJob.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { manuscriptVersionId: manuscriptId, workId, ownerUserId: owner },
      take: 1000,
    }));
  });

  it('does not reveal whether a foreign manuscript exists', async () => {
    const prisma = { storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue(null) },
      storyBranchPreparationJob: { findMany: jest.fn() } };
    await expect(new StoryProductionService(prisma as never).branchPreparationStatus(owner, manuscriptId))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.storyBranchPreparationJob.findMany).not.toHaveBeenCalled();
  });

  it('keeps old versions without preparation rows explicitly incomplete', async () => {
    const prisma = { storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue({ id: manuscriptId, workId, version: 1, locale: 'ko' }) },
      storyBranchPreparationJob: { findMany: jest.fn().mockResolvedValue([]) } };
    await expect(new StoryProductionService(prisma as never).branchPreparationStatus(owner, manuscriptId))
      .resolves.toMatchObject({ status: 'not_prepared', parts: [] });
  });

  it('does not report complete waiting state when a part preparation row is missing', async () => {
    const prisma = { storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue({ id: manuscriptId, workId, version: 2, locale: 'ko' }) },
      storyBranchPreparationJob: { findMany: jest.fn().mockResolvedValue([
        { partIndex: 0, expectedPartCount: 2, partKey: 'opening', status: 'awaiting_author_consent' },
      ]) } };
    await expect(new StoryProductionService(prisma as never).branchPreparationStatus(owner, manuscriptId))
      .resolves.toMatchObject({ status: 'incomplete' });
  });
});

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CommunityService } from './community.service';

const postId = '10000001-1111-4111-8111-111111111111';
const viewerId = '10000002-1111-4111-8111-111111111111';
const authorId = '10000003-1111-4111-8111-111111111111';

function fixture(visibility = 'public', cleanupExcluded = false) {
  const parent = { id: postId, authorUserId: authorId, artistId: null };
  const findFirst = jest.fn(async ({ where }: any) => {
    expect(where.id).toBe(postId);
    expect(where.status).toBe('published');
    expect(where.deletedAt).toBeNull();
    expect(where.visibility).toBe('public');
    expect(where.NOT).toEqual((service as any).publicFeedCleanupGuardWhere().NOT);
    expect(where.NOT).toHaveLength(8);
    expect(where.NOT[0]).toEqual({ body: { equals: 'test', mode: 'insensitive' } });
    return visibility === where.visibility && !cleanupExcluded ? parent : null;
  });
  const findMany = jest.fn().mockResolvedValue([]);
  const service = new CommunityService({ communityPost: { findFirst }, communityReply: { findMany } } as any, {} as any, {} as any);
  const blocked = jest.spyOn(service as any, 'getBlockedRelationshipUserIds').mockResolvedValue([]);
  return { service, findFirst, findMany, blocked, parent };
}

describe('community public detail and replies visibility', () => {
  for (const visibility of ['followers', 'private']) {
    for (const viewer of [undefined, viewerId]) {
      it(`rejects ${visibility} detail for ${viewer ? 'authenticated' : 'anonymous'} readers`, async () => {
        const view = fixture(visibility);
        await expect((view.service as any).findVisiblePostWithInclude(postId, viewer)).rejects.toBeInstanceOf(NotFoundException);
        expect(view.findFirst).toHaveBeenCalledTimes(1);
        expect(view.blocked).toHaveBeenCalledTimes(viewer ? 1 : 0);
      });
      it(`rejects ${visibility} replies before child query for ${viewer ? 'authenticated' : 'anonymous'} readers`, async () => {
        const view = fixture(visibility);
        await expect(view.service.getReplies(postId, {}, viewer)).rejects.toBeInstanceOf(NotFoundException);
        expect(view.findMany).not.toHaveBeenCalled();
        expect(view.blocked).not.toHaveBeenCalled();
      });
    }
  }
  it('preserves public detail parent selection and blocked-author predicate', async () => {
    const view = fixture(); view.blocked.mockResolvedValue([viewerId]);
    await expect((view.service as any).findVisiblePostWithInclude(postId, viewerId)).resolves.toBe(view.parent);
    expect(view.findFirst.mock.calls[0][0].where.authorUserId).toEqual({ notIn: [viewerId] });
  });
  it('preserves public replies pagination and reply-author exclusion', async () => {
    const view = fixture(); view.blocked.mockResolvedValue([viewerId]);
    await expect(view.service.getReplies(postId, { take: '1' }, authorId)).resolves.toEqual([]);
    expect(view.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { postId, status: 'published', deletedAt: null, authorUserId: { notIn: [viewerId] } },
      take: 1, orderBy: { createdAt: 'asc' },
    }));
  });
  it('rejects cleanup-excluded public detail and replies before children', async () => {
    const view = fixture('public', true);
    await expect((view.service as any).findVisiblePostWithInclude(postId, viewerId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(view.service.getReplies(postId, {}, viewerId)).rejects.toBeInstanceOf(NotFoundException);
    expect(view.findMany).not.toHaveBeenCalled();
  });
  it('rejects malformed public route ids without a parent or child query', async () => {
    const view = fixture();
    await expect((view.service as any).findVisiblePostWithInclude('bad-id', viewerId)).rejects.toBeInstanceOf(BadRequestException);
    await expect(view.service.getReplies('bad-id', {}, viewerId)).rejects.toBeInstanceOf(BadRequestException);
    expect(view.findFirst).not.toHaveBeenCalled(); expect(view.findMany).not.toHaveBeenCalled(); expect(view.blocked).not.toHaveBeenCalled();
  });
});

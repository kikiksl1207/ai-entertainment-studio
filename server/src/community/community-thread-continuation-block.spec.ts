import { CommunityService } from './community.service';

describe('Community thread continuation blocking', () => {
  const rootId = 'c0000000-0000-4000-8000-000000000001';
  const authorId = 'c0000000-0000-4000-8000-000000000002';
  const viewerId = 'c0000000-0000-4000-8000-000000000003';
  const otherId = 'c0000000-0000-4000-8000-000000000004';
  const childId = 'c0000000-0000-4000-8000-000000000005';

  function fixture(blocks: Array<{ blockerUserId: string; blockedUserId: string }> = []) {
    const service = Object.create(CommunityService.prototype) as any;
    const findRoot = jest.fn().mockResolvedValue({ id: rootId, authorUserId: authorId });
    const findBlocks = jest.fn().mockResolvedValue(blocks);
    const findChildren = jest.fn().mockResolvedValue([{ id: childId, body: 'Synthetic continuation' }]);
    service.prisma = { communityPost: { findFirst: findRoot, findMany: findChildren },
      userBlock: { findMany: findBlocks } };
    service.toPostView = jest.fn(async (post: unknown) => post);
    return { service, findRoot, findBlocks, findChildren };
  }

  it.each([
    ['viewer blocks root author', { blockerUserId: viewerId, blockedUserId: authorId }],
    ['root author blocks viewer', { blockerUserId: authorId, blockedUserId: viewerId }],
  ])('hides continuations when %s before querying children', async (_, block) => {
    const { service, findBlocks, findChildren } = fixture([block]);
    await expect(service.getThreadContinuations(rootId, {}, viewerId)).rejects.toMatchObject({ status: 404 });
    expect(findBlocks).toHaveBeenCalledTimes(1);
    expect(findChildren).not.toHaveBeenCalled();
    expect(findBlocks.mock.calls[0][0].where).toEqual({ status: 'active', deletedAt: null,
      OR: [{ blockerUserId: viewerId }, { blockedUserId: viewerId }] });
  });

  it('preserves normal ordering, public selectors, pagination and projection', async () => {
    const { service, findRoot, findBlocks, findChildren } = fixture();
    const result = await service.getThreadContinuations(rootId, { take: 1, cursor: childId }, viewerId);
    expect(findRoot).toHaveBeenCalledTimes(1);
    expect(findBlocks).toHaveBeenCalledTimes(1);
    expect(findChildren).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'published', visibility: 'public', deletedAt: null,
        metadata: { path: ['threadContinuation', 'rootPostId'], equals: rootId }, authorUserId: undefined }),
      take: 1, cursor: { id: childId }, skip: 1, orderBy: { publishedAt: 'asc' },
    }));
    expect(result.count).toBe(1); expect(result.nextCursor).toBe(childId);
    expect(result.items).toEqual(result.posts);
    expect(service.toPostView).toHaveBeenCalledWith(
      { id: childId, body: 'Synthetic continuation' }, viewerId,
    );
  });

  it('preserves anonymous public lookup without a block query', async () => {
    const { service, findBlocks } = fixture();
    const result = await service.getThreadContinuations(rootId, {});
    expect(result.count).toBe(1); expect(findBlocks).not.toHaveBeenCalled();
  });

  it('excludes blocked child authors in the database predicate before pagination', async () => {
    const { service, findBlocks, findChildren } = fixture([
      { blockerUserId: otherId, blockedUserId: viewerId },
      { blockerUserId: viewerId, blockedUserId: otherId },
    ]);
    await service.getThreadContinuations(rootId, { take: 1 }, viewerId);
    expect(findBlocks).toHaveBeenCalledTimes(1);
    expect(findChildren.mock.calls[0][0].where.authorUserId).toEqual({ notIn: [otherId] });
    expect(findChildren.mock.calls[0][0].take).toBe(1);
  });

  it('rejects an invalid cursor before block or child queries', async () => {
    const { service, findBlocks, findChildren } = fixture();
    await expect(service.getThreadContinuations(rootId, { cursor: 'bad-cursor' }, viewerId))
      .rejects.toMatchObject({ status: 400 });
    expect(findBlocks).not.toHaveBeenCalled(); expect(findChildren).not.toHaveBeenCalled();
  });

  it('preserves the missing or deleted public root response', async () => {
    const { service, findRoot, findBlocks, findChildren } = fixture();
    findRoot.mockResolvedValue(null);
    await expect(service.getThreadContinuations(rootId, {}, viewerId)).rejects.toMatchObject({ status: 404 });
    expect(findRoot.mock.calls[0][0].where).toMatchObject({ id: rootId,
      status: 'published', visibility: 'public', deletedAt: null });
    expect(findBlocks).not.toHaveBeenCalled(); expect(findChildren).not.toHaveBeenCalled();
  });

  it('rejects an invalid root before any query', async () => {
    const { service, findRoot, findBlocks, findChildren } = fixture();
    await expect(service.getThreadContinuations('bad-root', {}, viewerId)).rejects.toMatchObject({ status: 400 });
    expect(findRoot).not.toHaveBeenCalled(); expect(findBlocks).not.toHaveBeenCalled();
    expect(findChildren).not.toHaveBeenCalled();
  });

  it('does not query children if the block lookup fails', async () => {
    const { service, findBlocks, findChildren } = fixture();
    findBlocks.mockRejectedValue(new Error('Synthetic block lookup failure'));
    await expect(service.getThreadContinuations(rootId, {}, viewerId))
      .rejects.toThrow('Synthetic block lookup failure');
    expect(findChildren).not.toHaveBeenCalled();
  });
});

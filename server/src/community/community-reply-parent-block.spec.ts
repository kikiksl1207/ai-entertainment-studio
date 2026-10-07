import { CommunityService } from './community.service';

describe('Community reply parent blocking', () => {
  const postId = 'b0000000-0000-4000-8000-000000000001';
  const authorId = 'b0000000-0000-4000-8000-000000000002';
  const viewerId = 'b0000000-0000-4000-8000-000000000003';
  const otherId = 'b0000000-0000-4000-8000-000000000004';

  function fixture(blocks: Array<{ blockerUserId: string; blockedUserId: string }> = []) {
    const service = Object.create(CommunityService.prototype) as any;
    const findPost = jest.fn().mockResolvedValue({ id: postId, authorUserId: authorId, artistId: null });
    const findBlocks = jest.fn().mockResolvedValue(blocks);
    const findReplies = jest.fn().mockResolvedValue([{ id: 'synthetic-reply', body: 'Synthetic reply' }]);
    service.prisma = {
      communityPost: { findFirst: findPost }, userBlock: { findMany: findBlocks },
      communityReply: { findMany: findReplies },
    };
    service.toReplyView = jest.fn((reply: unknown) => reply);
    return { service, findPost, findBlocks, findReplies };
  }

  it.each([
    ['viewer blocks parent author', { blockerUserId: viewerId, blockedUserId: authorId }],
    ['parent author blocks viewer', { blockerUserId: authorId, blockedUserId: viewerId }],
  ])('hides replies when %s without querying them', async (_, block) => {
    const { service, findPost, findBlocks, findReplies } = fixture([block]);
    await expect(service.getReplies(postId, {}, viewerId)).rejects.toMatchObject({ status: 404 });
    expect(findPost).toHaveBeenCalledTimes(1);
    expect(findBlocks).toHaveBeenCalledTimes(1);
    expect(findReplies).not.toHaveBeenCalled();
    expect(findBlocks).toHaveBeenCalledWith({
      where: { status: 'active', deletedAt: null,
        OR: [{ blockerUserId: viewerId }, { blockedUserId: viewerId }] },
      select: { blockerUserId: true, blockedUserId: true },
    });
  });

  it('preserves normal reply lookup and mapping', async () => {
    const { service, findReplies } = fixture();
    await expect(service.getReplies(postId, { take: 5 }, viewerId)).resolves.toHaveLength(1);
    expect(findReplies).toHaveBeenCalledWith(expect.objectContaining({
      where: { postId, status: 'published', deletedAt: null, authorUserId: undefined },
      take: 5, orderBy: { createdAt: 'asc' },
    }));
    expect(service.toReplyView).toHaveBeenCalledWith(
      { id: 'synthetic-reply', body: 'Synthetic reply' }, viewerId,
    );
  });

  it('preserves anonymous lookup without requesting a block list', async () => {
    const { service, findBlocks, findReplies } = fixture();
    await expect(service.getReplies(postId, {})).resolves.toHaveLength(1);
    expect(findBlocks).not.toHaveBeenCalled();
    expect(findReplies).toHaveBeenCalledTimes(1);
  });

  it('still filters blocked reply authors on an unblocked parent', async () => {
    const { service, findReplies } = fixture([{ blockerUserId: otherId, blockedUserId: viewerId }]);
    await service.getReplies(postId, {}, viewerId);
    expect(findReplies.mock.calls[0][0].where.authorUserId).toEqual({ notIn: [otherId] });
  });

  it('deduplicates bidirectional block rows without additional queries', async () => {
    const { service, findBlocks, findReplies } = fixture([
      { blockerUserId: viewerId, blockedUserId: otherId },
      { blockerUserId: otherId, blockedUserId: viewerId },
    ]);
    await service.getReplies(postId, {}, viewerId);
    expect(findBlocks).toHaveBeenCalledTimes(1);
    expect(findReplies.mock.calls[0][0].where.authorUserId).toEqual({ notIn: [otherId] });
  });

  it('rejects a malformed parent before any query', async () => {
    const { service, findPost, findBlocks, findReplies } = fixture();
    await expect(service.getReplies('bad-id', {}, viewerId)).rejects.toMatchObject({ status: 400 });
    expect(findPost).not.toHaveBeenCalled();
    expect(findBlocks).not.toHaveBeenCalled();
    expect(findReplies).not.toHaveBeenCalled();
  });

  it('preserves a missing or deleted parent response', async () => {
    const { service, findPost, findBlocks, findReplies } = fixture();
    findPost.mockResolvedValue(null);
    await expect(service.getReplies(postId, {}, viewerId)).rejects.toMatchObject({ status: 404 });
    expect(findPost).toHaveBeenCalledWith({ where: { id: postId, status: 'published', visibility: 'public', deletedAt: null,
      NOT: [
        { body: { equals: 'test', mode: 'insensitive' } },
        { body: { contains: 'testtest', mode: 'insensitive' } },
        { body: { equals: 'sample', mode: 'insensitive' } },
          { body: { equals: 'fixture', mode: 'insensitive' } },
        { body: { equals: '\ud14c\uc2a4\ud2b8' } },
        { body: { contains: '\uc784\uc2dc\ubb38\uad6c' } },
        { body: { contains: '\uc0d8\ud50c\ubb38\uad6c' } },
        { body: { contains: 'QA358', mode: 'insensitive' } },
      ] },
      select: { id: true, authorUserId: true, artistId: true } });
    expect(findBlocks).not.toHaveBeenCalled();
    expect(findReplies).not.toHaveBeenCalled();
  });
});

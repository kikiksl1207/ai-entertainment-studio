import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CommunityService } from './community.service';

const authorId = '00000000-0000-4000-8000-000000000101';
const otherUserId = '00000000-0000-4000-8000-000000000102';
const postId = '00000000-0000-4000-8000-000000000201';
const artistId = '00000000-0000-4000-8000-000000000301';
const threadItemId = '00000000-0000-4000-8000-000000000401';
const createdAt = new Date('2026-05-18T00:00:00.000Z');

type PrismaMock = ReturnType<typeof createPrismaMock>;

function createPrismaMock() {
  return {
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: authorId }),
    },
    communityPost: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    communityReply: {
      findMany: jest.fn(),
    },
    communityReaction: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    artistFollow: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    userFollow: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    artistOperator: {
      findFirst: jest.fn(),
    },
    asset: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function serviceWith(prisma: PrismaMock) {
  return new CommunityService(prisma as never, {} as never, {} as never);
}

function storedPost(overrides: Record<string, unknown> = {}) {
  return {
    id: postId,
    authorUserId: authorId,
    artistId: null,
    status: 'published',
    deletedAt: null,
    ...overrides,
  };
}

function postView(overrides: Record<string, unknown> = {}) {
  return {
    ...storedPost(),
    postType: 'user_post',
    visibility: 'public',
    body: 'Updated body',
    metadata: {},
    likeCount: 0,
    replyCount: 0,
    reportCount: 0,
    publishedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
    author: {
      id: authorId,
      email: null,
      profile: {
        displayName: 'Author',
        publicHandle: 'author',
        avatarAssetId: null,
        coverAssetId: null,
      },
    },
    artist: null,
    assets: [],
    ...overrides,
  };
}

function threadMetadata(overrides: Record<string, unknown> = {}) {
  return {
    thread: {
      version: 1,
      type: 'manual_thread',
      maxItems: 10,
      autoSplit: false,
      rootOnlyEngagement: true,
      engagementTarget: 'root',
      assetTarget: 'root',
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
      rootUpdatedAt: createdAt.toISOString(),
      items: [
        {
          id: threadItemId,
          position: 2,
          body: 'Second piece',
          status: 'published',
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
          deletedAt: null,
        },
      ],
      ...overrides,
    },
  };
}

describe('CommunityService Lumina Feed post edit/delete contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates only the author-owned post body and preserves post and author ids', async () => {
    const prisma = createPrismaMock();
    prisma.communityPost.findFirst.mockResolvedValue(storedPost());
    prisma.communityPost.update.mockResolvedValue(postView());
    const service = serviceWith(prisma);

    const result = await service.updatePost(authorId, postId, { body: 'Updated body' });

    expect(prisma.communityPost.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: postId },
        data: expect.not.objectContaining({
          id: expect.anything(),
          authorUserId: expect.anything(),
        }),
      }),
    );
    expect(result.post.id).toBe(postId);
    expect(result.post.authorUserId).toBe(authorId);
    expect(result.post.viewer.canEdit).toBe(true);
    expect(result.post.viewer.canDelete).toBe(true);
  });

  it('rejects update by a non-author even when the post belongs to an artist', async () => {
    const prisma = createPrismaMock();
    prisma.user.findFirst.mockResolvedValue({ id: otherUserId });
    prisma.communityPost.findFirst.mockResolvedValue(
      storedPost({ artistId, authorUserId: authorId }),
    );
    const service = serviceWith(prisma);

    await expect(
      service.updatePost(otherUserId, postId, { body: 'Not my post' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.artistOperator.findFirst).not.toHaveBeenCalled();
    expect(prisma.communityPost.update).not.toHaveBeenCalled();
  });

  it('rejects invalid, missing, empty, and too-long update requests before mutation', async () => {
    const prisma = createPrismaMock();
    prisma.communityPost.findFirst.mockResolvedValue(storedPost());
    const service = serviceWith(prisma);

    await expect(
      service.updatePost(authorId, 'not-a-uuid', { body: 'Valid body' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.communityPost.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.updatePost(authorId, postId, { body: 'Valid body' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    prisma.communityPost.findFirst.mockResolvedValue(storedPost());
    await expect(service.updatePost(authorId, postId, { body: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.updatePost(authorId, postId, { body: 'x'.repeat(501) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.communityPost.update).not.toHaveBeenCalled();
  });

  it('keeps feed list and reply/detail lookups scoped to non-deleted published posts', async () => {
    const prisma = createPrismaMock();
    prisma.communityPost.findMany.mockResolvedValue([]);
    prisma.communityPost.findFirst.mockResolvedValue(null);
    const service = serviceWith(prisma);

    await expect(service.getFeed({})).resolves.toEqual([]);
    expect(prisma.communityPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'published',
          visibility: 'public',
          deletedAt: null,
        }),
      }),
    );

    await expect(service.getReplies(postId, {})).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.communityPost.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: postId,
          status: 'published',
          deletedAt: null,
        },
      }),
    );
  });

  it('soft-deletes only author-owned posts', async () => {
    const prisma = createPrismaMock();
    prisma.communityPost.findFirst.mockResolvedValue(storedPost());
    prisma.communityPost.update.mockResolvedValue(storedPost({ status: 'deleted' }));
    const service = serviceWith(prisma);

    const result = await service.deletePost(authorId, postId);

    expect(result).toEqual({ ok: true });
    expect(prisma.communityPost.update).toHaveBeenCalledWith({
      where: { id: postId },
      data: {
        status: 'deleted',
        deletedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      },
    });
  });

  it('rejects delete by a non-author without falling through to artist operator access', async () => {
    const prisma = createPrismaMock();
    prisma.user.findFirst.mockResolvedValue({ id: otherUserId });
    prisma.communityPost.findFirst.mockResolvedValue(
      storedPost({ artistId, authorUserId: authorId }),
    );
    const service = serviceWith(prisma);

    await expect(service.deletePost(otherUserId, postId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.artistOperator.findFirst).not.toHaveBeenCalled();
    expect(prisma.communityPost.update).not.toHaveBeenCalled();
  });

  it('rejects invalid and missing delete requests before mutation', async () => {
    const prisma = createPrismaMock();
    const service = serviceWith(prisma);

    await expect(service.deletePost(authorId, 'not-a-uuid')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    prisma.communityPost.findFirst.mockResolvedValueOnce(null);
    await expect(service.deletePost(authorId, postId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.communityPost.update).not.toHaveBeenCalled();
  });

  it('keeps repeated author delete requests idempotent without a second mutation', async () => {
    const prisma = createPrismaMock();
    prisma.communityPost.findFirst
      .mockResolvedValueOnce(storedPost())
      .mockResolvedValueOnce(
        storedPost({ status: 'deleted', deletedAt: new Date('2026-05-18T00:10:00.000Z') }),
      );
    prisma.communityPost.update.mockResolvedValue(storedPost({ status: 'deleted' }));
    const service = serviceWith(prisma);

    await expect(service.deletePost(authorId, postId)).resolves.toEqual({ ok: true });
    await expect(service.deletePost(authorId, postId)).resolves.toEqual({ ok: true });
    expect(prisma.communityPost.update).toHaveBeenCalledTimes(1);
  });
});

describe('CommunityService Lumina Feed thread contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a one-piece thread with the same root body contract as a single feed post', async () => {
    const prisma = createPrismaMock();
    prisma.communityPost.create.mockImplementation(async (args: any) =>
      postView({
        body: args.data.body,
        metadata: args.data.metadata,
      }),
    );
    const service = serviceWith(prisma);

    const result = await service.createThreadPost(authorId, { body: 'Solo post' });

    expect(prisma.communityPost.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          body: 'Solo post',
          metadata: expect.objectContaining({
            thread: expect.objectContaining({
              autoSplit: false,
              rootOnlyEngagement: true,
              items: [],
            }),
          }),
        }),
      }),
    );
    expect(result.rootPostId).toBe(postId);
    expect(result.itemCount).toBe(1);
    expect(result.readProjection.isThread).toBe(false);
    expect(result.policy.walletMutation).toBe(false);
    expect(result.policy.luminaMutation).toBe(false);
    expect(result.policy.settlementMutation).toBe(false);
  });

  it('creates two to ten manually confirmed pieces with stable root-based projection', async () => {
    const prisma = createPrismaMock();
    prisma.communityPost.create.mockImplementation(async (args: any) =>
      postView({
        body: args.data.body,
        metadata: args.data.metadata,
      }),
    );
    const service = serviceWith(prisma);

    const result = await service.createThreadPost(authorId, {
      items: [{ body: 'Root piece' }, { body: 'Second piece' }],
    });

    const createArg = prisma.communityPost.create.mock.calls[0][0];
    expect(createArg.data.body).toBe('Root piece');
    expect(createArg.data.metadata.thread.items).toEqual([
      expect.objectContaining({
        position: 2,
        body: 'Second piece',
        status: 'published',
      }),
    ]);
    expect(result.itemCount).toBe(2);
    expect(result.threadCount).toBe(2);
    expect(result.readProjection.items.map((item: any) => item.position)).toEqual([1, 2]);
    expect(result.readProjection.engagementTarget).toBe('root');
    expect(result.readProjection.imagesTarget).toBe('root');
  });

  it('rejects eleven pieces and any piece over the 500-character contract before mutation', async () => {
    const prisma = createPrismaMock();
    const service = serviceWith(prisma);

    await expect(
      service.createThreadPost(authorId, {
        items: Array.from({ length: 11 }, (_, index) => ({ body: `piece ${index + 1}` })),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.createThreadPost(authorId, {
        items: [{ body: 'ok' }, { body: 'x'.repeat(501) }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.communityPost.create).not.toHaveBeenCalled();
  });

  it('edits thread items only for the root post author and never via artist operator access', async () => {
    const prisma = createPrismaMock();
    prisma.communityPost.findFirst.mockResolvedValue(
      storedPost({ metadata: threadMetadata() }),
    );
    prisma.communityPost.update.mockImplementation(async (args: any) =>
      postView({
        body: 'Root piece',
        metadata: args.data.metadata,
      }),
    );
    const service = serviceWith(prisma);

    const result = await service.updateThreadItem(authorId, postId, threadItemId, {
      body: 'Updated second piece',
    });

    expect(prisma.communityPost.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            thread: expect.objectContaining({
              items: [
                expect.objectContaining({
                  id: threadItemId,
                  body: 'Updated second piece',
                }),
              ],
            }),
          }),
        }),
      }),
    );
    expect(result.threadItem.body).toBe('Updated second piece');

    prisma.user.findFirst.mockResolvedValue({ id: otherUserId });
    prisma.communityPost.findFirst.mockResolvedValue(
      storedPost({ artistId, authorUserId: authorId, metadata: threadMetadata() }),
    );
    await expect(
      service.updateThreadItem(otherUserId, postId, threadItemId, {
        body: 'Operator should not edit',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.artistOperator.findFirst).not.toHaveBeenCalled();
  });

  it('keeps repeated thread item delete requests idempotent after the first mutation', async () => {
    const prisma = createPrismaMock();
    prisma.communityPost.findFirst
      .mockResolvedValueOnce(storedPost({ metadata: threadMetadata() }))
      .mockResolvedValueOnce(
        storedPost({
          metadata: threadMetadata({
            items: [
              {
                id: threadItemId,
                position: 2,
                body: 'Second piece',
                status: 'deleted',
                createdAt: createdAt.toISOString(),
                updatedAt: createdAt.toISOString(),
                deletedAt: createdAt.toISOString(),
              },
            ],
          }),
        }),
      );
    prisma.communityPost.update.mockImplementation(async (args: any) =>
      postView({
        body: 'Root piece',
        metadata: args.data.metadata,
      }),
    );
    const service = serviceWith(prisma);

    await expect(service.deleteThreadItem(authorId, postId, threadItemId)).resolves.toEqual(
      expect.objectContaining({ ok: true, alreadyDeleted: false, itemCount: 1 }),
    );
    await expect(service.deleteThreadItem(authorId, postId, threadItemId)).resolves.toEqual({
      ok: true,
      alreadyDeleted: true,
    });
    expect(prisma.communityPost.update).toHaveBeenCalledTimes(1);
  });
});

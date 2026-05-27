import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CommunityService } from './community.service';

const authorId = '00000000-0000-4000-8000-000000000101';
const otherUserId = '00000000-0000-4000-8000-000000000102';
const postId = '00000000-0000-4000-8000-000000000201';
const repostId = '00000000-0000-4000-8000-000000000203';
const artistId = '00000000-0000-4000-8000-000000000301';
const threadItemId = '00000000-0000-4000-8000-000000000401';
const imageAssetId = '00000000-0000-4000-8000-000000000501';
const createdAt = new Date('2026-05-18T00:00:00.000Z');

type PrismaMock = ReturnType<typeof createPrismaMock>;

function createPrismaMock() {
  const prisma: any = {
    $transaction: jest.fn(async (callback: any) => callback(prisma)),
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
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    userBlock: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    artistOperator: {
      findFirst: jest.fn(),
    },
    asset: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };

  return prisma;
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

describe('CommunityService user follow/block mutation contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fails closed when a blocked user tries to follow or refollow', async () => {
    const prisma = createPrismaMock();
    prisma.userBlock.findFirst.mockResolvedValue({ id: 'block-row' });
    const service = serviceWith(prisma);

    await expect(service.followUser(authorId, otherUserId)).rejects.toMatchObject({
      response: {
        code: 'USER_FOLLOW_BLOCKED',
        messageKey: 'social.follow.blocked',
      },
      status: 403,
    });
    expect(prisma.userFollow.upsert).not.toHaveBeenCalled();
  });

  it('removes an active follower without creating a block or wallet-like mutation', async () => {
    const prisma = createPrismaMock();
    prisma.user.findFirst.mockResolvedValue({
      id: otherUserId,
      profile: {
        displayName: 'Follower',
        publicHandle: 'follower',
        avatarAssetId: null,
        coverAssetId: null,
      },
    });
    prisma.userFollow.updateMany.mockResolvedValue({ count: 1 });
    prisma.userFollow.count
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(3);
    const service = serviceWith(prisma);

    const result = await service.removeFollower(authorId, otherUserId);

    expect(prisma.userFollow.updateMany).toHaveBeenCalledWith({
      where: {
        followerUserId: otherUserId,
        followingUserId: authorId,
        status: 'active',
      },
      data: {
        status: 'deleted',
        deletedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      },
    });
    expect(prisma.userBlock.upsert).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      removed: true,
      user: {
        id: otherUserId,
        displayName: 'Follower',
        publicHandle: 'follower',
      },
      stats: {
        followerCount: 12,
        followingCount: 3,
      },
      policy: {
        blockCreated: false,
        refollowAllowed: true,
        walletMutation: false,
        luminaMutation: false,
        paymentMutation: false,
        refundMutation: false,
        settlementMutation: false,
      },
    });
  });

  it('activates user block and soft-deletes follows in both directions', async () => {
    const prisma = createPrismaMock();
    prisma.userBlock.upsert.mockResolvedValue({
      id: 'block-row',
      status: 'active',
      reason: 'spam',
      createdAt,
      updatedAt: createdAt,
      blocked: {
        id: otherUserId,
        status: 'active',
        profile: {
          displayName: 'Blocked',
          publicHandle: 'blocked',
          avatarAssetId: null,
          coverAssetId: null,
        },
      },
    });
    prisma.userFollow.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const service = serviceWith(prisma);

    const result = await service.blockUser(authorId, otherUserId, { reason: 'spam' });

    expect(prisma.userFollow.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        followerUserId: authorId,
        followingUserId: otherUserId,
        status: 'active',
      },
      data: {
        status: 'deleted',
        deletedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      },
    });
    expect(prisma.userFollow.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        followerUserId: otherUserId,
        followingUserId: authorId,
        status: 'active',
      },
      data: {
        status: 'deleted',
        deletedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      },
    });
    expect(result).toMatchObject({
      block: {
        id: 'block-row',
        status: 'active',
        reason: 'spam',
        user: {
          id: otherUserId,
          displayName: 'Blocked',
          publicHandle: 'blocked',
        },
      },
      effects: {
        viewerToTargetFollowRemoved: true,
        targetToViewerFollowRemoved: true,
        refollowBlocked: true,
        feedHiddenForViewer: true,
        commentsHiddenForViewer: true,
        premiumChatBlockedBeforeWallet: true,
        supportBlockedBeforeWallet: true,
      },
      policy: {
        relationship: 'user_block',
        walletMutation: false,
        luminaMutation: false,
        paymentMutation: false,
        refundMutation: false,
        settlementMutation: false,
      },
    });
    expect(result.block.user).not.toHaveProperty('email');
  });
});

describe('CommunityService Lumina Feed post edit/delete contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates regular feed posts up to 2200 characters and rejects 2201', async () => {
    const prisma = createPrismaMock();
    prisma.communityPost.create.mockImplementation(async (args: any) =>
      postView({ body: args.data.body }),
    );
    const service = serviceWith(prisma);
    const maxBody = 'x'.repeat(2200);

    const result = await service.createPost(authorId, { body: maxBody });

    expect(prisma.communityPost.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ body: maxBody }),
      }),
    );
    expect(result.post.body).toBe(maxBody);

    await expect(
      service.createPost(authorId, { body: 'x'.repeat(2201) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.communityPost.create).toHaveBeenCalledTimes(1);
  });

  it('keeps image-only feed post empty body support', async () => {
    const prisma = createPrismaMock();
    prisma.asset.findMany.mockResolvedValue([
      {
        id: imageAssetId,
        assetType: 'image',
        mimeType: 'image/png',
        visibility: 'public',
        metadata: { uploadIntent: { status: 'uploaded' }, lifecycle: {} },
      },
    ]);
    prisma.communityPost.create.mockImplementation(async (args: any) =>
      postView({ body: args.data.body, assets: [] }),
    );
    const service = serviceWith(prisma);

    const result = await service.createPost(authorId, {
      body: '',
      assetIds: [imageAssetId],
    });

    expect(prisma.communityPost.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          body: '',
          assets: expect.objectContaining({
            create: [expect.objectContaining({ assetId: imageAssetId })],
          }),
        }),
      }),
    );
    expect(result.post.body).toBe('');
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

  it('allows 2200-character post body edits and rejects 2201 before mutation', async () => {
    const prisma = createPrismaMock();
    prisma.communityPost.findFirst.mockResolvedValue(storedPost());
    prisma.communityPost.update.mockImplementation(async (args: any) =>
      postView({ body: args.data.body }),
    );
    const service = serviceWith(prisma);
    const maxBody = 'x'.repeat(2200);

    const result = await service.updatePost(authorId, postId, { body: maxBody });

    expect(result.post.body).toBe(maxBody);
    await expect(
      service.updatePost(authorId, postId, { body: 'x'.repeat(2201) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.communityPost.update).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid, missing, and empty update requests before mutation', async () => {
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

describe('CommunityService Lumina Feed thread continuation, repost, and share contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a thread continuation under an existing author-owned public post', async () => {
    const prisma = createPrismaMock();
    prisma.communityPost.findFirst.mockResolvedValue(postView({ body: 'Root post' }));
    prisma.communityPost.create.mockImplementation(async (args: any) =>
      postView({
        id: '00000000-0000-4000-8000-000000000202',
        body: args.data.body,
        metadata: args.data.metadata,
      }),
    );
    const service = serviceWith(prisma);

    const result = await service.createThreadContinuation(authorId, postId, {
      body: 'Continued thought',
    });

    expect(prisma.communityPost.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          authorUserId: authorId,
          body: 'Continued thought',
          metadata: expect.objectContaining({
            threadContinuation: expect.objectContaining({
              type: 'thread_continuation',
              rootPostId: postId,
              parentPostId: postId,
              commentRelation: false,
              replyRelation: false,
              autoSplit: false,
            }),
          }),
        }),
      }),
    );
    expect(result.relation).toBe('thread_continuation');
    expect(result.post.threadContinuation.isContinuation).toBe(true);
    expect(result.policy.walletMutation).toBe(false);
    expect(result.policy.luminaMutation).toBe(false);
  });

  it('rejects thread continuations by non-authors and 501-character bodies before mutation', async () => {
    const prisma = createPrismaMock();
    prisma.user.findFirst.mockResolvedValue({ id: otherUserId });
    prisma.communityPost.findFirst.mockResolvedValue(postView({ body: 'Root post' }));
    const service = serviceWith(prisma);

    await expect(
      service.createThreadContinuation(otherUserId, postId, { body: 'Not mine' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.createThreadContinuation(authorId, 'not-a-uuid', { body: 'Invalid root' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.communityPost.findFirst.mockResolvedValue(postView({ body: 'Root post' }));
    await expect(
      service.createThreadContinuation(authorId, postId, { body: 'x'.repeat(501) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.communityPost.create).not.toHaveBeenCalled();
  });

  it('lists thread continuations separately from normal comments', async () => {
    const prisma = createPrismaMock();
    prisma.communityPost.findFirst.mockResolvedValue(storedPost());
    prisma.communityPost.findMany.mockResolvedValue([
      postView({
        id: '00000000-0000-4000-8000-000000000202',
        body: 'Continuation',
        metadata: {
          threadContinuation: {
            rootPostId: postId,
            parentPostId: postId,
            sortKey: createdAt.toISOString(),
          },
        },
      }),
    ]);
    const service = serviceWith(prisma);

    const result = await service.getThreadContinuations(postId, { take: '3' }, authorId);

    expect(prisma.communityPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          metadata: {
            path: ['threadContinuation', 'rootPostId'],
            equals: postId,
          },
        }),
        orderBy: { publishedAt: 'asc' },
      }),
    );
    expect(result.relation).toBe('thread_continuation');
    expect(result.items[0].threadContinuation.commentRelation).toBe(false);
    expect(result.items[0].threadContinuation.replyRelation).toBe(false);
  });

  it('creates quote reposts for public source posts without wallet or settlement mutation', async () => {
    const prisma = createPrismaMock();
    prisma.user.findFirst.mockResolvedValue({ id: otherUserId });
    prisma.communityPost.findFirst.mockResolvedValue(postView({ body: 'Original post' }));
    prisma.communityPost.create.mockImplementation(async (args: any) =>
      postView({
        id: repostId,
        authorUserId: otherUserId,
        body: args.data.body,
        metadata: args.data.metadata,
      }),
    );
    const service = serviceWith(prisma);
    const maxQuote = 'q'.repeat(2200);

    const result = await service.createRepost(otherUserId, postId, {
      body: maxQuote,
    });

    expect(prisma.communityPost.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          authorUserId: otherUserId,
          postType: 'user_post',
          body: maxQuote,
          metadata: expect.objectContaining({
            repost: expect.objectContaining({
              type: 'quote_repost',
              originalPostId: postId,
              originalAuthorUserId: authorId,
              originalDeletionPolicy: 'render_tombstone_without_body',
            }),
          }),
        }),
      }),
    );
    expect(result.relation).toBe('quote_repost');
    expect(result.post.repost.originalPostId).toBe(postId);
    expect(result.post.repost.originalState).toBe('visible');
    expect(result.post.repost.originalPost.body).toBe('Original post');
    expect(result.policy.walletMutation).toBe(false);
    expect(result.policy.settlementMutation).toBe(false);

    await expect(
      service.createRepost(otherUserId, postId, { body: 'q'.repeat(2201) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.communityPost.create).toHaveBeenCalledTimes(1);
  });

  it('keeps reply bodies capped at 300 characters', async () => {
    const prisma = createPrismaMock();
    prisma.communityPost.findFirst.mockResolvedValue(postView({ body: 'Root post' }));
    const service = serviceWith(prisma);

    await expect(
      service.createReply(otherUserId, postId, { body: 'r'.repeat(301) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.communityReply.findMany).not.toHaveBeenCalled();
  });

  it('renders a tombstone when the viewer hid the repost source post', async () => {
    const prisma = createPrismaMock();
    const repost = postView({
      id: repostId,
      authorUserId: otherUserId,
      body: 'Quote',
      metadata: {
        repost: {
          type: 'quote_repost',
          originalPostId: postId,
          originalAuthorUserId: authorId,
          quoteBody: 'Quote',
        },
      },
    });
    prisma.communityPost.findFirst
      .mockResolvedValueOnce(repost)
      .mockResolvedValueOnce(null);
    const service = serviceWith(prisma);

    const result = await service.getPost(repostId, otherUserId);

    expect(prisma.communityPost.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: postId,
          hiddenByUsers: {
            none: {
              userId: otherUserId,
              status: 'active',
              deletedAt: null,
            },
          },
        }),
      }),
    );
    expect(result.post.repost.originalState).toBe('unavailable');
    expect(result.post.repost.tombstone).toBe(true);
    expect(result.post.repost.originalPost).toBeNull();
    expect(JSON.stringify(result.post.repost)).not.toContain('Original body');
  });

  it('renders a tombstone when the repost source author is blocked either direction', async () => {
    const prisma = createPrismaMock();
    const repost = postView({
      id: repostId,
      authorUserId: otherUserId,
      body: 'Quote',
      metadata: {
        repost: {
          type: 'quote_repost',
          originalPostId: postId,
          originalAuthorUserId: authorId,
          quoteBody: 'Quote',
        },
      },
    });
    prisma.userBlock.findMany.mockResolvedValue([
      {
        blockerUserId: otherUserId,
        blockedUserId: authorId,
      },
    ]);
    prisma.communityPost.findFirst
      .mockResolvedValueOnce(repost)
      .mockResolvedValueOnce(null);
    const service = serviceWith(prisma);

    const result = await service.getPost(repostId, otherUserId);

    expect(prisma.communityPost.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: postId,
          authorUserId: { notIn: [authorId] },
        }),
      }),
    );
    expect(result.post.repost.originalState).toBe('unavailable');
    expect(result.post.repost.tombstone).toBe(true);
    expect(result.post.repost.originalPost).toBeNull();
    expect(JSON.stringify(result.post.repost)).not.toContain('Original body');
  });

  it('rejects repost sources that are missing, private, hidden, or deleted as safe not-found', async () => {
    const prisma = createPrismaMock();
    prisma.user.findFirst.mockResolvedValue({ id: otherUserId });
    prisma.communityPost.findFirst.mockResolvedValue(null);
    const service = serviceWith(prisma);

    await expect(
      service.createRepost(otherUserId, postId, { body: 'Cannot reference' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.communityPost.create).not.toHaveBeenCalled();
  });

  it('returns a share URL contract without mutating feed, wallet, or Lumina state', async () => {
    const prisma = createPrismaMock();
    prisma.communityPost.findFirst.mockResolvedValue(storedPost());
    const service = serviceWith(prisma);

    const result = await service.sharePost(postId);

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        postId,
        share: expect.objectContaining({
          publicPath: `/lumina-feed/posts/${postId}`,
          countStrategy: 'not_mutated_by_share_contract',
        }),
        policy: expect.objectContaining({
          shareCountMutation: false,
          walletMutation: false,
          luminaMutation: false,
        }),
      }),
    );
    expect(prisma.communityPost.create).not.toHaveBeenCalled();
    expect(prisma.communityPost.update).not.toHaveBeenCalled();
  });
});

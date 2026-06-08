import { NotificationsService } from './notifications.service';

describe('NotificationsService feed notification projection contract', () => {
  it('keeps feed comment, thread continuation, and repost notification counts separated without mutations', () => {
    const prisma = {
      userNotification: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      communityPost: {
        create: jest.fn(),
      },
      communityReply: {
        create: jest.fn(),
      },
      walletAccount: {
        updateMany: jest.fn(),
      },
    };
    const service = new NotificationsService(prisma as never, {} as never);

    const contract = service.getFeedNotificationProjectionContract();

    expect(contract).toMatchObject({
      version:
        '2026-06-08.feed-thread-comment-repost-notification-projection.v1',
      readOnly: true,
      notificationMutationEnabled: false,
      feedEventTypes: {
        comment: 'feed.reply',
        threadContinuation: 'feed.thread_continuation',
        repost: 'feed.repost',
      },
      countLanes: {
        comment: {
          type: 'feed.reply',
          countKey: 'feedCommentUnreadCount',
          targetType: 'community_post',
          mixesWithThreadContinuation: false,
          mixesWithRepost: false,
        },
        threadContinuation: {
          type: 'feed.thread_continuation',
          countKey: 'feedThreadContinuationUnreadCount',
          targetType: 'community_post',
          mixesWithComment: false,
          mixesWithRepost: false,
        },
        repost: {
          type: 'feed.repost',
          countKey: 'feedRepostUnreadCount',
          targetType: 'community_post',
          mixesWithComment: false,
          mixesWithThreadContinuation: false,
        },
      },
      failClosedReadFilters: {
        deletedPost: 'exclude_from_list_and_count',
        hiddenPost: 'exclude_from_list_and_count',
        privatePost: 'exclude_from_list_and_count',
        blockedRelationship: 'exclude_without_identity_leak',
        missingPost: 'exclude_from_list_and_count',
      },
      privacy: {
        rawPostBodyReturned: false,
        rawCommentBodyReturned: false,
        rawDeletedPostReturned: false,
        blockedUserPrivateFieldsReturned: false,
        actorEmailReturned: false,
        tokenReturned: false,
        cookieReturned: false,
      },
      noMutation: {
        communityPostCreate: true,
        communityReplyCreate: true,
        repostCreate: true,
        notificationCreate: true,
        walletMutation: true,
        settlementMutation: true,
        payoutMutation: true,
      },
    });
    expect(
      new Set(Object.values(contract.feedEventTypes)).size,
    ).toBe(Object.keys(contract.feedEventTypes).length);
    expect(prisma.userNotification.create).not.toHaveBeenCalled();
    expect(prisma.communityPost.create).not.toHaveBeenCalled();
    expect(prisma.communityReply.create).not.toHaveBeenCalled();
    expect(prisma.walletAccount.updateMany).not.toHaveBeenCalled();
  });
});

import { COMMUNITY_PRIVACY_GUARD_CONTRACT } from './community-privacy-guard-contract';

describe('community privacy guard contract', () => {
  it('keeps public follower/following profile rows filtered and credential-free', () => {
    expect(COMMUNITY_PRIVACY_GUARD_CONTRACT.publicFollowerProfile).toMatchObject({
      targetProfileRequired: {
        userStatus: 'active',
        userDeletedAt: null,
        publicHandleRequired: true,
        viewerBlockedEitherDirection: false,
      },
      returnedRowsWhere: {
        followStatus: 'active',
        followDeletedAt: null,
        sourceUserStatus: 'active',
        targetUserStatus: 'active',
        sourceUserDeletedAt: null,
        targetUserDeletedAt: null,
        activeBlockEitherDirection: false,
      },
      countUsesSameWhereAsItems: true,
      mutation: false,
    });
    expect(COMMUNITY_PRIVACY_GUARD_CONTRACT.publicFollowerProfile.privateFieldsReturned).toMatchObject({
      rawEmail: false,
      phone: false,
      providerIds: false,
      walletAccounts: false,
      walletLedger: false,
      paymentOrders: false,
      adminNotes: false,
      blockReason: false,
      rawUserIdFromQaNotes: false,
    });
  });

  it('excludes blocked users from feed, comments, and follow surfaces before counts', () => {
    expect(COMMUNITY_PRIVACY_GUARD_CONTRACT.blockVisibility).toMatchObject({
      activeBlockWhere: {
        status: 'active',
        deletedAt: null,
        direction: 'either_direction',
      },
      filteringRules: {
        excludeBlockedAuthorsBeforePagination: true,
        excludeBlockedRepliesBeforeCount: true,
        excludeBlockedFollowRowsBeforeCount: true,
        tombstoneInsteadOfIdentityLeak: true,
        countsUseFilteredRows: true,
      },
      mutation: false,
    });
    expect(COMMUNITY_PRIVACY_GUARD_CONTRACT.blockVisibility.hiddenSurfaces).toEqual(
      expect.arrayContaining(['feed', 'comments', 'followers', 'following']),
    );
    expect(COMMUNITY_PRIVACY_GUARD_CONTRACT.blockVisibility.privateFieldsReturned).toMatchObject({
      blockedUserEmail: false,
      blockerUserEmail: false,
      blockReason: false,
      moderationNotes: false,
      walletFields: false,
      paymentFields: false,
      rawRelationshipId: false,
    });
  });
});

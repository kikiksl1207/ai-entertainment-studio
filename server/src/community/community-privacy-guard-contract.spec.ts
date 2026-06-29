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

  it('applies the same relation privacy projection to social and email accounts', () => {
    expect(COMMUNITY_PRIVACY_GUARD_CONTRACT.accountProviderParity).toMatchObject({
      providers: expect.arrayContaining(['email', 'google', 'kakao', 'naver']),
      providerSpecificBranches: false,
      rawEmailReturned: false,
      providerUserIdReturned: false,
      socialAccountRowsReturned: false,
      passwordHashReturned: false,
      samePrivacyRulesForSocialAndEmail: true,
    });
    expect(
      COMMUNITY_PRIVACY_GUARD_CONTRACT.accountProviderParity.relationProjectionSource,
    ).toEqual(
      expect.arrayContaining([
        'users.id',
        'users.status',
        'users.deletedAt',
        'user_profiles.publicHandle',
        'user_follows',
        'user_blocks',
      ]),
    );
  });

  it('excludes deleted, suspended, and inactive accounts from relation surfaces', () => {
    expect(COMMUNITY_PRIVACY_GUARD_CONTRACT.accountLifecycleExclusion).toMatchObject({
      excludedStatuses: ['deleted', 'suspended', 'inactive'],
      deletedAtRequiredNull: true,
      surfaces: expect.arrayContaining([
        'followers',
        'following',
        'profile_relation_entry',
        'feed_author_link',
      ]),
      filterBefore: ['pagination', 'counts', 'linkRendering'],
      stableFallback: {
        status: 404,
        code: 'USER_NOT_FOUND',
        messageKey: 'social.user.notFound',
      },
      mutation: false,
    });
  });

  it('reserves qa-fb handles for disposable fixture rows only', () => {
    expect(COMMUNITY_PRIVACY_GUARD_CONTRACT.qaHandleNamespace).toMatchObject({
      prefix: 'qa-fb-',
      allowedUse: 'approved_disposable_fixture_rows_only',
      normalUserSignupAllowed: false,
      normalUserHandleUpdateAllowed: false,
      collisionCheckSource: 'user_profiles.publicHandle',
      confirmedRunValueRecording: false,
    });
    expect(COMMUNITY_PRIVACY_GUARD_CONTRACT.qaHandleNamespace.allowedReportFields).toEqual(
      expect.arrayContaining([
        'runId',
        'fixtureStatus',
        'publicProfileHandle',
        'publicProfilePath',
        'followersApiPath',
        'followingApiPath',
        'blockApiPath',
        'followerPublicHandle',
      ]),
    );
  });
});

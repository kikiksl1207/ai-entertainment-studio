export const AUTH_SOCIAL_LOGIN_COLLISION_CONTRACT = {
  version: '2026-06-27.social-login-collision.v1',
  endpoint: 'POST /api/v1/auth/social/login',
  authority: {
    providerProfile: 'server-verified social provider profile',
    providerUserId: 'provider + providerUserId unique account key',
    emailMergeEligibility: 'provider emailVerified=true and normalized email matches existing active user',
  },
  collisionGuard: {
    unverifiedProviderEmailCanMergeExistingUser: false,
    clientSubmittedEmailCanMergeExistingUser: false,
    differentProviderSameEmailRequiresProviderVerifiedEmail: true,
    existingUserMustBeActive: true,
    providerAccountCreatedInServerTransaction: true,
    providerUserIdUniqueConstraintRequired: true,
  },
  blockedOrSeparatedCases: {
    unverifiedEmail: {
      lookupExistingUserByEmail: false,
      attachProviderToExistingEmailUser: false,
      createPasswordOrEmailCredential: false,
    },
    deletedOrInactiveExistingUser: {
      issueSession: false,
      relinkProvider: false,
    },
  },
  safeResponsePolicy: {
    returnsProviderUserId: false,
    returnsProviderAccessToken: false,
    returnsProviderRefreshToken: false,
    returnsPasswordHash: false,
    returnsRawProviderPayload: false,
  },
} as const;

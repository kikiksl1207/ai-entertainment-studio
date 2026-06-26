export const AUTH_SOCIAL_UNLINK_SAFETY_CONTRACT = {
  version: '2026-06-26.social-unlink-safety.v1',
  status: 'contract_only_endpoint_not_enabled',
  futureEndpoint: 'DELETE /api/v1/me/auth/social/:provider',
  purpose:
    'Prevent account lockout when unlinking a social provider from a mixed email/social account.',
  authority: {
    currentUser: 'authenticated currentUser.id',
    loginMethods: 'server-loaded user_auth_accounts rows',
    emailPasswordCapability: 'provider=email with passwordHash present',
    socialProviderCapability: 'provider in google|kakao|naver',
  },
  untrustedClientFields: [
    'userId',
    'providerUserId',
    'hasPassword',
    'isSocialOnly',
    'remainingLoginMethods',
    'passwordHash',
  ],
  lockoutGuard: {
    serverComputesRemainingLoginMethods: true,
    unlinkLastLoginMethodAllowed: false,
    unlinkOnlySocialProviderWhenNoEmailPasswordAllowed: false,
    unlinkEmailPasswordFallbackMissingAllowed: false,
    requiresAtLeastOneRemainingLoginMethod: true,
    requiresCurrentUserOwnership: true,
  },
  blockedResponse: {
    status: 409,
    code: 'AUTH_SOCIAL_UNLINK_LAST_LOGIN_METHOD',
    messageKey: 'auth.social.unlink.lastLoginMethod',
    details: {
      recoveryActionKey: 'auth.password.setup.requiredBeforeUnlink',
      stableProviderKeyOnly: true,
    },
  },
  safeResponsePolicy: {
    returnsProvider: true,
    returnsProviderUserId: false,
    returnsPasswordHash: false,
    returnsRawEmail: false,
    returnsAccessToken: false,
    returnsRefreshToken: false,
    returnsCookie: false,
  },
  mutationPolicy: {
    socialAccountDeleteRequiresGuardPass: true,
    passwordMutation: false,
    sessionMutation: false,
    walletLedgerMutation: false,
    settlementOrPayoutMutation: false,
  },
} as const;

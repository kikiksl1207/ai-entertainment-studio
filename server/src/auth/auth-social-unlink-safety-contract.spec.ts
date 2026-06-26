import { AUTH_SOCIAL_UNLINK_SAFETY_CONTRACT } from './auth-social-unlink-safety-contract';

describe('auth social unlink safety contract', () => {
  it('keeps social unlink disabled until the server can prevent login lockout', () => {
    expect(AUTH_SOCIAL_UNLINK_SAFETY_CONTRACT).toMatchObject({
      status: 'contract_only_endpoint_not_enabled',
      futureEndpoint: 'DELETE /api/v1/me/auth/social/:provider',
      lockoutGuard: {
        serverComputesRemainingLoginMethods: true,
        unlinkLastLoginMethodAllowed: false,
        unlinkOnlySocialProviderWhenNoEmailPasswordAllowed: false,
        unlinkEmailPasswordFallbackMissingAllowed: false,
        requiresAtLeastOneRemainingLoginMethod: true,
        requiresCurrentUserOwnership: true,
      },
    });
  });

  it('does not trust client-submitted account capability fields', () => {
    expect(AUTH_SOCIAL_UNLINK_SAFETY_CONTRACT.authority).toMatchObject({
      currentUser: 'authenticated currentUser.id',
      loginMethods: 'server-loaded user_auth_accounts rows',
      emailPasswordCapability: 'provider=email with passwordHash present',
      socialProviderCapability: 'provider in google|kakao|naver',
    });
    expect(AUTH_SOCIAL_UNLINK_SAFETY_CONTRACT.untrustedClientFields).toEqual(
      expect.arrayContaining([
        'userId',
        'providerUserId',
        'hasPassword',
        'isSocialOnly',
        'remainingLoginMethods',
        'passwordHash',
      ]),
    );
  });

  it('pins stable lockout error keys and avoids leaking credentials', () => {
    expect(AUTH_SOCIAL_UNLINK_SAFETY_CONTRACT.blockedResponse).toMatchObject({
      status: 409,
      code: 'AUTH_SOCIAL_UNLINK_LAST_LOGIN_METHOD',
      messageKey: 'auth.social.unlink.lastLoginMethod',
      details: {
        recoveryActionKey: 'auth.password.setup.requiredBeforeUnlink',
        stableProviderKeyOnly: true,
      },
    });
    expect(AUTH_SOCIAL_UNLINK_SAFETY_CONTRACT.safeResponsePolicy).toMatchObject({
      returnsProvider: true,
      returnsProviderUserId: false,
      returnsPasswordHash: false,
      returnsRawEmail: false,
      returnsAccessToken: false,
      returnsRefreshToken: false,
      returnsCookie: false,
    });
    expect(AUTH_SOCIAL_UNLINK_SAFETY_CONTRACT.mutationPolicy).toMatchObject({
      socialAccountDeleteRequiresGuardPass: true,
      passwordMutation: false,
      sessionMutation: false,
      walletLedgerMutation: false,
      settlementOrPayoutMutation: false,
    });
  });
});

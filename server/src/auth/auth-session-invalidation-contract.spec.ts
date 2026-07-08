import { AUTH_SESSION_INVALIDATION_CONTRACT } from './auth-session-invalidation-contract';

describe('auth session invalidation contract', () => {
  it('pins logout to the stored refresh token body and idempotent backend revoke', () => {
    expect(AUTH_SESSION_INVALIDATION_CONTRACT.logoutRefreshToken).toMatchObject({
      endpoint: 'POST /api/v1/auth/logout',
      frontendContract: {
        sendsRefreshTokenBodyWhenPresent: true,
        clearsLocalAuthAfterAttempt: true,
      },
      backendContract: {
        idempotent: true,
        missingOrInvalidRefreshTokenReturnsOk: true,
        verifiesTokenType: 'refresh',
        clientSessionIdTrusted: false,
        currentAccessTokenAloneRevokesRefreshToken: false,
      },
      responsePolicy: {
        returnsOkOnly: true,
        returnsAccessToken: false,
        returnsRefreshToken: false,
        returnsCookie: false,
        returnsSessionSecret: false,
        returnsTokenHash: false,
      },
    });
  });

  it('keeps refresh rotation server-authoritative and rejects old token reuse', () => {
    expect(AUTH_SESSION_INVALIDATION_CONTRACT.refreshRotation).toMatchObject({
      endpoint: 'POST /api/v1/auth/refresh',
      requestBody: ['refreshToken'],
      oldTokenReuse: {
        accepted: false,
        expectedStatus: 401,
        walletMutation: false,
        accountMutationExceptRevocation: false,
      },
      responsePolicy: {
        returnsAccessToken: true,
        returnsRefreshToken: true,
        returnsCookie: false,
        returnsTokenHash: false,
        returnsRawSessionId: false,
      },
    });
    expect(AUTH_SESSION_INVALIDATION_CONTRACT.refreshRotation.mutationOrder).toEqual(
      expect.arrayContaining([
        'reject revoked expired mismatched hash or wrong owner',
        'revoke previous refresh token row',
        'issue replacement access and refresh tokens',
      ]),
    );
  });

  it('documents protected endpoint behavior after local logout', () => {
    expect(AUTH_SESSION_INVALIDATION_CONTRACT.protectedAfterLogout).toMatchObject({
      expectedClientState: 'local auth cleared after logout attempt',
      endpoints: ['GET /api/v1/me', 'GET /api/v1/me/trust'],
      expectedStatusWithoutValidAccessToken: 401,
      refreshRetryAfterRevokedRefreshToken: false,
    });
  });
});

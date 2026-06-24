export const AUTH_SESSION_INVALIDATION_CONTRACT = {
  version: '2026-06-24.auth-session-invalidation.v1',
  passwordResetConfirm: {
    endpoint: 'POST /api/v1/auth/password-resets/confirm',
    trigger: 'successful password reset confirmation',
    authority: {
      resetToken: 'server stored user_action_tokens row',
      account: 'server stored email user_auth_accounts row',
      sessions: 'server stored user_refresh_tokens rows',
    },
    untrustedClientFields: [
      'refreshToken',
      'sessionId',
      'cookie',
      'deviceId',
      'userId',
    ],
    mutationOrder: [
      'validate reset token and active user',
      'verify email auth account exists',
      'consume reset token once',
      'replace password hash',
      'revoke every active refresh token for token.userId',
    ],
    sessionInvalidation: {
      revokesRefreshTokens: true,
      scope: 'all active sessions for token.userId',
      where: {
        userIdSource: 'token.userId',
        revokedAt: null,
      },
      accessTokenExpiryOnlyFallbackAllowed: false,
    },
    responsePolicy: {
      mayReturnRevokedCount: true,
      returnsAccessToken: false,
      returnsRefreshToken: false,
      returnsCookie: false,
      returnsSessionSecret: false,
      returnsPasswordHash: false,
      returnsResetTokenHash: false,
    },
  },
} as const;

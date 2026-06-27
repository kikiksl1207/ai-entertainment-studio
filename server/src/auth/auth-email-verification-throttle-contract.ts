export const AUTH_EMAIL_VERIFICATION_THROTTLE_CONTRACT = {
  version: '2026-06-26.email-verification-throttle.v1',
  endpoint: 'POST /api/v1/auth/email-verifications',
  purpose: 'email_verification',
  responsePolicy: {
    neutralResponse: true,
    codeKey: 'auth.emailVerification.requestAccepted',
    revealsAccountExistence: false,
    revealsEmailVerifiedState: false,
    rawTokenReturned: false,
    tokenHashReturned: false,
    rawEmailReturned: false,
    deliveryProviderSecretReturned: false,
  },
  throttle: {
    serverEnforced: true,
    windowSeconds: 60,
    duplicatePendingTokenPolicy:
      'reuse_recent_pending_token_within_cooldown_else_consume_previous',
    cooldownDisclosure: 'neutral_request_accepted',
    recentPendingLookup: {
      userIdSource: 'server user row for normalized email',
      purpose: 'email_verification',
      consumedAt: null,
      expiresAt: 'gt_now',
      createdAt: 'gte_cooldown_start',
    },
    duringCooldown: {
      createNewToken: false,
      consumeOlderTokens: false,
      sendEmail: false,
      returnDebugToken: false,
    },
  },
  mutationPolicy: {
    productionEmailSendInUnitTest: false,
    accountMutation: false,
    sessionMutation: false,
    passwordMutation: false,
    walletLedgerMutation: false,
    settlementOrPayoutMutation: false,
  },
} as const;

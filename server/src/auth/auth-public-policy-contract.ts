export const AUTH_EMAIL_VERIFICATION_GATE_POLICY_CONTRACT = {
  version: '2026-07-08.auth-email-verification-gate-policy.v1',
  sourceOfTruth: ['users.emailVerifiedAt', 'feature policy per mutation surface'],
  defaultMvpPolicy: 'soft_notice_unless_surface_requires_hard_gate',
  policyTable: [
    {
      surface: 'debut_application_submit',
      endpoint: 'POST /api/v1/debut/applications',
      currentGate: 'soft_notice',
      mutationAllowedWhenUnverified: true,
      hardGateFlag: 'EMAIL_VERIFICATION_HARD_GATE_DEBUT',
      messageKey: 'auth.emailVerification.notice.debut',
    },
    {
      surface: 'paid_feature_wallet_mutation',
      endpoint: 'wallet-backed paid feature mutations',
      currentGate: 'hard_gate_when_required',
      mutationAllowedWhenUnverified: false,
      messageKey: 'auth.emailVerification.required',
    },
    {
      surface: 'account_security_change',
      endpoint: 'password, email, and deletion-sensitive account mutations',
      currentGate: 'hard_gate',
      mutationAllowedWhenUnverified: false,
      messageKey: 'auth.emailVerification.required',
    },
    {
      surface: 'creator_or_admin_write',
      endpoint: 'creator/admin write routes',
      currentGate: 'role_policy_plus_email_notice',
      mutationAllowedWhenUnverified: false,
      messageKey: 'auth.emailVerification.required',
    },
  ],
  responsePolicy: {
    returnsEmailVerificationState: true,
    returnsRawEmail: false,
    returnsCredential: false,
    returnsToken: false,
    returnsCookie: false,
    stableMessageKeyRequired: true,
  },
} as const;

export const AUTH_ERROR_PUBLIC_COPY_NORMALIZATION_CONTRACT = {
  version: '2026-07-08.auth-error-public-copy-normalization.v1',
  sourcePriority: ['messageKey', 'code', 'field key', 'generic mode fallback'],
  normalizedErrors: [
    {
      code: 'AUTH_INVALID_CREDENTIALS',
      messageKey: 'auth.login.invalidCredentials',
      rawBackendMessageVisible: false,
    },
    {
      code: 'AUTH_EMAIL_ALREADY_EXISTS',
      messageKey: 'auth.register.emailAlreadyExists',
      rawBackendMessageVisible: false,
    },
    {
      code: 'AUTH_EMAIL_VERIFICATION_REQUIRED',
      messageKey: 'auth.emailVerification.required',
      rawBackendMessageVisible: false,
    },
    {
      code: 'AUTH_PASSWORD_RESET_TOKEN_INVALID_OR_EXPIRED',
      messageKey: 'auth.passwordReset.tokenInvalidOrExpired',
      rawBackendMessageVisible: false,
    },
    {
      code: 'AUTH_RATE_LIMITED',
      messageKey: 'auth.rateLimited',
      rawBackendMessageVisible: false,
    },
  ],
  fallbackPolicy: {
    loginUsesGenericCopy: true,
    registerUsesGenericCopy: true,
    unknownValidationUsesFieldGenericCopy: true,
    rawExceptionVisible: false,
    stackTraceVisible: false,
  },
  forbiddenPublicOutput: [
    'raw exception',
    'stack trace',
    'database detail',
    'provider credential',
    'token',
    'cookie',
    'password',
    'raw email',
  ],
} as const;

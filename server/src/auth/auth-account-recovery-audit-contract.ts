export const AUTH_ACCOUNT_RECOVERY_AUDIT_CONTRACT = {
  version: '2026-06-24.auth-account-recovery-audit.v1',
  readModel: {
    purpose:
      'distinguish verified email-password recovery from social-only account recovery without exposing credentials',
    sourceOfTruth: {
      emailVerification: 'users.emailVerifiedAt',
      passwordCapability: 'user_auth_accounts.passwordHash on provider=email',
      providerSet: 'user_auth_accounts.provider',
      resetEligibility: 'derived server-side from active user + email auth account with password hash',
    },
    projectedFields: [
      'emailVerification.status',
      'emailVerification.messageKey',
      'hasPassword',
      'isSocialOnly',
      'passwordReset.statusKey',
      'passwordReset.available',
      'recoveryMethodKey',
    ],
    rawStatusPolicy: {
      stableKeysRequired: true,
      rawProviderStatusOnly: false,
      rawEnglishCopyOnly: false,
    },
  },
  verifiedEmailPassword: {
    requiredProjection: {
      emailVerified: true,
      emailVerificationStatus: 'verified',
      hasPassword: true,
      isSocialOnly: false,
      passwordResetAvailable: true,
      recoveryMethodKey: 'auth.recovery.emailPassword',
    },
    allowedActions: ['request_password_reset', 'confirm_password_reset'],
  },
  socialOnly: {
    requiredProjection: {
      hasPassword: false,
      isSocialOnly: true,
      passwordResetAvailable: false,
      recoveryMethodKey: 'auth.recovery.socialProvider',
    },
    blockedActions: ['confirm_email_password_reset_without_password_account'],
    nextActionKey: 'auth.recovery.socialProvider.signIn',
  },
  secretPolicy: {
    returnsRawEmail: false,
    returnsResetToken: false,
    returnsResetTokenHash: false,
    returnsPasswordHash: false,
    returnsProviderUserId: false,
    returnsProviderAccessToken: false,
    returnsProviderRefreshToken: false,
    returnsCookie: false,
    returnsApiKey: false,
    returnsDatabaseUrl: false,
  },
  mutationPolicy: {
    auditReadModelCreatesEmail: false,
    auditReadModelSendsEmail: false,
    auditReadModelRelinksProvider: false,
    auditReadModelResetsPassword: false,
    auditReadModelRevokesSessions: false,
  },
} as const;

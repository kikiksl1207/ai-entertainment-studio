import { AUTH_ACCOUNT_RECOVERY_AUDIT_CONTRACT } from './auth-account-recovery-audit-contract';

describe('auth account recovery audit contract', () => {
  it('separates verified email-password recovery from social-only recovery', () => {
    expect(AUTH_ACCOUNT_RECOVERY_AUDIT_CONTRACT.verifiedEmailPassword.requiredProjection).toMatchObject({
      emailVerified: true,
      emailVerificationStatus: 'verified',
      hasPassword: true,
      isSocialOnly: false,
      passwordResetAvailable: true,
      recoveryMethodKey: 'auth.recovery.emailPassword',
    });
    expect(AUTH_ACCOUNT_RECOVERY_AUDIT_CONTRACT.socialOnly.requiredProjection).toMatchObject({
      hasPassword: false,
      isSocialOnly: true,
      passwordResetAvailable: false,
      recoveryMethodKey: 'auth.recovery.socialProvider',
    });
    expect(AUTH_ACCOUNT_RECOVERY_AUDIT_CONTRACT.socialOnly.blockedActions).toContain(
      'confirm_email_password_reset_without_password_account',
    );
  });

  it('keeps recovery audit projections stable-keyed and credential-free', () => {
    expect(AUTH_ACCOUNT_RECOVERY_AUDIT_CONTRACT.readModel.rawStatusPolicy).toMatchObject({
      stableKeysRequired: true,
      rawProviderStatusOnly: false,
      rawEnglishCopyOnly: false,
    });
    expect(AUTH_ACCOUNT_RECOVERY_AUDIT_CONTRACT.readModel.projectedFields).toEqual(
      expect.arrayContaining([
        'emailVerification.status',
        'emailVerification.messageKey',
        'hasPassword',
        'isSocialOnly',
        'passwordReset.statusKey',
        'passwordReset.available',
        'recoveryMethodKey',
      ]),
    );
    expect(AUTH_ACCOUNT_RECOVERY_AUDIT_CONTRACT.secretPolicy).toMatchObject({
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
    });
  });

  it('does not allow audit/read-model checks to mutate account recovery state', () => {
    expect(AUTH_ACCOUNT_RECOVERY_AUDIT_CONTRACT.mutationPolicy).toMatchObject({
      auditReadModelCreatesEmail: false,
      auditReadModelSendsEmail: false,
      auditReadModelRelinksProvider: false,
      auditReadModelResetsPassword: false,
      auditReadModelRevokesSessions: false,
    });
  });
});

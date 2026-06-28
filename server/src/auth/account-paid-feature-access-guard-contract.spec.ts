import { ACCOUNT_PAID_FEATURE_ACCESS_GUARD_CONTRACT } from './account-paid-feature-access-guard-contract';

describe('account paid feature access guard contract', () => {
  it('blocks deleted, suspended, inactive, and unverified accounts before paid mutations', () => {
    expect(ACCOUNT_PAID_FEATURE_ACCESS_GUARD_CONTRACT.validationOrder).toEqual([
      'authenticate_session',
      'load_user_by_session_subject',
      'reject_deleted_or_missing_user',
      'reject_suspended_or_inactive_user',
      'require_auth_account',
      'require_email_verification_when_surface_requires_it',
      'apply_surface_specific_server_policy',
      'only_then_evaluate_wallet_or_ledger_mutation',
    ]);
    expect(ACCOUNT_PAID_FEATURE_ACCESS_GUARD_CONTRACT.blockedStates).toMatchObject({
      deleted: { code: 'ACCOUNT_DELETED', walletMutation: false },
      suspended: { code: 'ACCOUNT_SUSPENDED', walletMutation: false },
      inactive: { code: 'ACCOUNT_INACTIVE', walletMutation: false },
      emailUnverified: { code: 'EMAIL_VERIFICATION_REQUIRED', walletMutation: false },
      missingAuthAccount: { code: 'AUTH_ACCOUNT_REQUIRED', walletMutation: false },
    });
  });

  it('does not trust client account, entitlement, or wallet state', () => {
    expect(ACCOUNT_PAID_FEATURE_ACCESS_GUARD_CONTRACT.noClientAuthority).toMatchObject({
      clientSubmittedUserStatusTrusted: false,
      clientSubmittedEmailVerifiedTrusted: false,
      clientSubmittedWalletBalanceTrusted: false,
      clientSubmittedEntitlementTrusted: false,
    });
    expect(ACCOUNT_PAID_FEATURE_ACCESS_GUARD_CONTRACT.privacy).toMatchObject({
      rawEmailReturned: false,
      passwordHashReturned: false,
      providerCredentialReturned: false,
      tokenReturned: false,
      cookieReturned: false,
      apiKeyReturned: false,
      databaseUrlReturned: false,
    });
  });
});

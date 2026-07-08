import { WALLET_PAYMENT_REFUND_AUTHORITY_AUDIT_CONTRACT } from './wallet-payment-refund-authority-audit-contract';

describe('wallet payment refund authority audit contract', () => {
  it('pins payment, bonus, refund, and paid feature wallet authority to server sources', () => {
    const surfaces = new Map(
      WALLET_PAYMENT_REFUND_AUTHORITY_AUDIT_CONTRACT.auditedSurfaces.map(
        (surface) => [surface.surface, surface],
      ),
    );

    expect(surfaces.get('payment_charge_confirm')).toMatchObject({
      authority: 'payment provider event plus server order state',
      clientAmountTrusted: false,
      ledgerRequired: true,
      idempotencyRequired: true,
    });
    expect(surfaces.get('premium_chat_refund')).toMatchObject({
      authority: 'server refund policy moderation outcome and existing wallet ledger',
      clientRefundRateTrusted: false,
      ledgerRequired: true,
      idempotencyRequired: true,
    });
    expect(surfaces.get('support_or_paid_feature_debit')).toMatchObject({
      authority: 'wallet_accounts.cached_balance plus server product policy',
      clientBalanceTrusted: false,
    });
  });

  it('keeps cross-surface ledger invariants and blocks unsafe live QA credentials', () => {
    expect(WALLET_PAYMENT_REFUND_AUTHORITY_AUDIT_CONTRACT.crossSurfaceGuards).toMatchObject({
      walletMutationRequiresLedger: true,
      walletAndLedgerSameTransaction: true,
      replayDoesNotCreateSecondLedger: true,
      idempotencyMismatchCreatesNoWalletMutation: true,
      insufficientBalanceCreatesNoWalletLedger: true,
      refundDoesNotMutateSettlementOrPayout: true,
    });
    expect(
      WALLET_PAYMENT_REFUND_AUTHORITY_AUDIT_CONTRACT.qaBlockerWhenLiveCredentialsMissing,
    ).toMatchObject({
      blockedBy: 'safe QA wallet/payment credential source needed',
      passwordRequestAllowed: false,
      providerSecretRecordAllowed: false,
    });
  });

  it('allows only non-secret audit output', () => {
    expect(WALLET_PAYMENT_REFUND_AUTHORITY_AUDIT_CONTRACT.safeOutputPolicy).toMatchObject({
      recordRunId: true,
      recordPublicPath: true,
      recordHttpStatus: true,
      recordStableCodeMessageKey: true,
      recordRawEmail: false,
      recordToken: false,
      recordCookie: false,
      recordApiKey: false,
      recordDatabaseUrl: false,
      recordProviderPayload: false,
    });
  });
});

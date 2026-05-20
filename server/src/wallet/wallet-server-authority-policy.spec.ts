import {
  APP_PURCHASE_VERIFICATION_CONTRACT,
  SERVER_AUTHORITY_WALLET_POLICY,
  WALLET_LEDGER_SOURCE_CONTRACT,
} from './wallet-server-authority-policy';

describe('server-authority wallet policy', () => {
  it('does not allow client-submitted economic values as authority', () => {
    expect(SERVER_AUTHORITY_WALLET_POLICY).toMatchObject({
      clientSubmittedBalanceTrusted: false,
      clientSubmittedPriceTrusted: false,
      clientSubmittedSettlementTrusted: false,
      offlinePaidActionAllowed: false,
      allWalletDebitsRequireServerLedgerBalanceCheck: true,
      allWalletDebitsRequireAtomicNonNegativeUpdate: true,
      allWalletMutationsRequireIdempotencyOrProviderTransactionKey: true,
      appIntegrityIsAdvisoryOnly: true,
      rawPurchaseTokensLogged: false,
    });
  });

  it('keeps premium chat donation as an explicit wallet ledger source', () => {
    expect(WALLET_LEDGER_SOURCE_CONTRACT).toContainEqual(
      expect.objectContaining({
        source: 'premium_chat_donation',
        direction: 'debit',
        ledgerType: 'premium_chat_donation',
        serverAuthority: 'wallet_account_cached_balance',
        idempotency: 'client_idempotency_key',
      }),
    );
  });

  it('requires idempotency or provider transaction keys for every ledger source', () => {
    expect(
      WALLET_LEDGER_SOURCE_CONTRACT.every((source) => source.idempotency.length > 0),
    ).toBe(true);
  });

  it('requires server-side app-store purchase verification before credits', () => {
    expect(APP_PURCHASE_VERIFICATION_CONTRACT).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'google_play',
          serverVerification: 'google_play_developer_api',
          rawProofLogged: false,
        }),
        expect.objectContaining({
          platform: 'apple_app_store',
          serverVerification:
            'app_store_server_api_or_signed_transaction_validation',
          rawProofLogged: false,
        }),
      ]),
    );
    expect(
      APP_PURCHASE_VERIFICATION_CONTRACT.every(
        (contract) => contract.integritySignalRequiredForLedgerCredit === false,
      ),
    ).toBe(true);
  });
});

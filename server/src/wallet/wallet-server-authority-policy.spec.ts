import {
  APP_WEB_LUMINA_TAMPER_DEFENSE_CHECKLIST,
  APP_PURCHASE_VERIFICATION_CONTRACT,
  CLIENT_ECONOMIC_TAMPER_FIELDS,
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
      paymentOrderReplayRequiresSameUserProductAndProvider: true,
      paymentWebhookRawProviderPayloadStored: false,
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

  it('keeps premium chat room open and refund sources server-authoritative', () => {
    expect(WALLET_LEDGER_SOURCE_CONTRACT).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'premium_chat_room_open',
          direction: 'debit',
          ledgerType: 'premium_chat_open',
          serverAuthority:
            'premium_chat_room_policy_and_wallet_account_cached_balance',
          idempotency: 'client_idempotency_key',
        }),
        expect.objectContaining({
          source: 'premium_chat_room_refund',
          direction: 'credit',
          ledgerType: 'refund',
          serverAuthority: 'server_refund_policy_and_moderation_outcome',
          idempotency: 'server_room_refund_key',
        }),
      ]),
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

  it('requires payment order replay and webhook audit to stay server-authoritative', () => {
    const chargeSurface = APP_WEB_LUMINA_TAMPER_DEFENSE_CHECKLIST.find(
      (item) => item.surface === 'charge_purchase_credit',
    );

    expect(chargeSurface).toMatchObject({
      clientEconomicFieldsTrusted: false,
      authority: ['server product table', 'provider verified transaction'],
      idempotencyOrProviderTransactionKey: 'provider_transaction_id',
    });
    expect(chargeSurface?.doubleDebitGuard).toContain(
      'sanitized webhook audit payload',
    );
  });

  it('covers app and web Lumina tamper surfaces without trusting client economics', () => {
    const surfaces = APP_WEB_LUMINA_TAMPER_DEFENSE_CHECKLIST.map(
      (item) => item.surface,
    );

    expect(surfaces).toEqual(
      expect.arrayContaining([
        'wallet_balance',
        'paid_like_boost',
        'chat_feature_product',
        'premium_chat_room_and_support',
        'charge_purchase_credit',
        'refund_reversal',
      ]),
    );
    expect(
      APP_WEB_LUMINA_TAMPER_DEFENSE_CHECKLIST.every(
        (item) => item.clientEconomicFieldsTrusted === false,
      ),
    ).toBe(true);
    expect(
      APP_WEB_LUMINA_TAMPER_DEFENSE_CHECKLIST.filter((item) => item.mutation).every(
        (item) => item.idempotencyOrProviderTransactionKey.length > 0,
      ),
    ).toBe(true);
  });

  it('lists high-risk client economic fields as non-authoritative inputs', () => {
    expect(CLIENT_ECONOMIC_TAMPER_FIELDS).toEqual(
      expect.arrayContaining([
        'balanceLumina',
        'priceLumina',
        'paidAmount',
        'refundRate',
        'settlementShare',
      ]),
    );
  });
});

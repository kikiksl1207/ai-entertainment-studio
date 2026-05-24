import {
  APP_TAMPER_CONTRACT_TEST_CASES,
  APP_TAMPER_THREAT_MODEL,
  APP_WEB_LUMINA_TAMPER_DEFENSE_CHECKLIST,
  APP_PURCHASE_VERIFICATION_CONTRACT,
  CLIENT_ECONOMIC_TAMPER_FIELDS,
  SERVER_AUTHORITY_WALLET_POLICY,
  WALLET_RISK_LOG_CONTRACT,
  WALLET_LEDGER_SOURCE_CONTRACT,
  WALLET_MUTATION_GUARD_STEPS,
} from './wallet-server-authority-policy';

describe('server-authority wallet policy', () => {
  it('does not allow client-submitted economic values as authority', () => {
    expect(SERVER_AUTHORITY_WALLET_POLICY).toMatchObject({
      clientSubmittedBalanceTrusted: false,
      clientSubmittedPriceTrusted: false,
      clientSubmittedSettlementTrusted: false,
      clientSubmittedPaymentSuccessTrusted: false,
      clientSubmittedBonusTrusted: false,
      offlinePaidActionAllowed: false,
      allWalletDebitsRequireServerLedgerBalanceCheck: true,
      allWalletDebitsRequireAtomicNonNegativeUpdate: true,
      allWalletMutationsRequireIdempotencyOrProviderTransactionKey: true,
      localTestGrantRequiresEnvGate: true,
      localTestGrantRequiresIdempotencyKey: true,
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
          source: 'premium_chat_message',
          direction: 'debit',
          ledgerType: 'premium_chat_message',
          serverAuthority: 'server_visible_two_way_sentence_pair_meter',
          idempotency: 'server_message_pair_meter_key',
        }),
        expect.objectContaining({
          source: 'premium_chat_room_refund',
          direction: 'credit',
          ledgerType: 'refund',
          serverAuthority: 'server_refund_policy_and_moderation_outcome',
          idempotency: 'server_room_refund_key',
        }),
        expect.objectContaining({
          source: 'premium_chat_room_refund_restriction',
          direction: 'credit',
          ledgerType: 'premium_chat_room_company_revenue',
          serverAuthority: 'server_refund_restriction_outcome',
          idempotency: 'server_admin_decision_key',
        }),
        expect.objectContaining({
          source: 'premium_chat_room_refund_restriction',
          direction: 'credit',
          ledgerType: 'premium_chat_room_artist_compensation',
          serverAuthority: 'server_refund_restriction_outcome',
          idempotency: 'server_admin_decision_key',
        }),
      ]),
    );
  });

  it('requires idempotency or provider transaction keys for every ledger source', () => {
    expect(
      WALLET_LEDGER_SOURCE_CONTRACT.every((source) => source.idempotency.length > 0),
    ).toBe(true);
  });

  it('keeps debit and credit guard steps explicit for app tamper defense', () => {
    expect(WALLET_MUTATION_GUARD_STEPS.debit).toEqual(
      expect.arrayContaining([
        'require_idempotency_key_before_wallet_lookup',
        'atomic_update_many_cached_balance_gte_amount',
        'write_wallet_ledger_and_domain_record_in_same_transaction',
      ]),
    );
    expect(WALLET_MUTATION_GUARD_STEPS.credit).toEqual(
      expect.arrayContaining([
        'require_provider_transaction_or_server_idempotency_key',
        'derive_credit_amount_on_server',
        'dedupe_existing_ledger_or_provider_transaction',
      ]),
    );
    expect(WALLET_MUTATION_GUARD_STEPS.failClosed).toEqual(
      expect.arrayContaining([
        'insufficient_balance_creates_no_wallet_ledger',
        'provider_replay_creates_no_duplicate_credit',
      ]),
    );
  });

  it('keeps local test grants gated and idempotent when non-production enables them', () => {
    expect(WALLET_LEDGER_SOURCE_CONTRACT).toContainEqual(
      expect.objectContaining({
        source: 'local_test_grant',
        direction: 'credit',
        ledgerType: 'event_grant',
        serverAuthority: 'non_production_env_gate_and_server_amount',
        idempotency: 'client_idempotency_key_required',
      }),
    );
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
      APP_WEB_LUMINA_TAMPER_DEFENSE_CHECKLIST.find(
        (item) => item.surface === 'premium_chat_room_and_support',
      ),
    ).toMatchObject({
      doubleDebitGuard:
        'mutation_blocked_until_room_or_donation_storage_exists_then_idempotency_fingerprint_and_atomic_cached_balance_gte_amount',
    });
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
        'paymentSuccess',
        'bonusAmount',
        'sku',
        'productSku',
        'refundRate',
        'settlementShare',
      ]),
    );
  });

  it('documents the app tamper threat model as fail-closed server gates', () => {
    expect(APP_TAMPER_THREAT_MODEL).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          threat: 'client_balance_or_bonus_display_tamper',
          serverGate: 'wallet_accounts.cached_balance_and_wallet_ledger',
          expectedDecision: 'ignore_client_display_values',
          walletMutationAllowedFromClientProof: false,
        }),
        expect.objectContaining({
          threat: 'client_payment_success_spoof',
          serverGate: 'server_verified_provider_transaction',
          expectedDecision: 'no_credit_without_provider_verification',
        }),
        expect.objectContaining({
          threat: 'offline_replay_or_retry',
          serverGate: 'user_scoped_idempotency_key_and_request_fingerprint',
          expectedDecision:
            'same_fingerprint_replay_or_conflict_before_wallet_lookup',
        }),
        expect.objectContaining({
          threat: 'amount_or_sku_tamper',
          serverGate: 'server_product_catalog_and_domain_policy',
          expectedDecision: 'resolve_amount_on_server_or_reject',
        }),
      ]),
    );
    expect(
      APP_TAMPER_THREAT_MODEL.every(
        (threat) =>
          threat.trustedClientFields === false &&
          threat.walletMutationAllowedFromClientProof === false,
      ),
    ).toBe(true);
  });

  it('keeps risk logs useful without storing raw secrets or provider payloads', () => {
    expect(WALLET_RISK_LOG_CONTRACT.requiredFields).toEqual(
      expect.arrayContaining([
        'requestId',
        'userId',
        'sessionOrActionId',
        'surface',
        'idempotencyScope',
        'requestFingerprintHash',
        'serverAmountLumina',
        'decision',
        'reasonCode',
      ]),
    );
    expect(WALLET_RISK_LOG_CONTRACT).toMatchObject({
      clientEconomicValuesStoredAsAuthority: false,
      providerSecretsLogged: false,
      rawProviderPayloadLogged: false,
    });
    expect(WALLET_RISK_LOG_CONTRACT.forbiddenFields).toEqual(
      expect.arrayContaining([
        'rawIdempotencyKey',
        'rawPurchaseToken',
        'rawProviderPayload',
        'rawIntegrityPayload',
        'cookie',
        'password',
        'dbUrl',
        'signedUrl',
        'providerSecret',
      ]),
    );
  });

  it('keeps minimum tamper regression cases explicit and provider-secret-free', () => {
    expect(APP_TAMPER_CONTRACT_TEST_CASES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          caseId: 'client_balance_tamper_ignored',
          expectedGate: 'wallet_accounts.cached_balance',
        }),
        expect.objectContaining({
          caseId: 'fake_payment_success_rejected',
          expectedGate: 'provider_verified_transaction',
        }),
        expect.objectContaining({
          caseId: 'idempotency_replay_changed_body',
          expectedOutcome: 'stable_conflict_before_wallet_lookup',
        }),
        expect.objectContaining({
          caseId: 'sku_or_amount_tamper_rejected',
          expectedGate: 'server_product_catalog_and_policy',
        }),
      ]),
    );
    expect(
      APP_TAMPER_CONTRACT_TEST_CASES.flatMap((testCase) =>
        testCase.tamperedFields,
      ),
    ).toEqual(
      expect.arrayContaining([
        'balanceLumina',
        'paymentSuccess',
        'productSku',
        'sku',
      ]),
    );
  });
});

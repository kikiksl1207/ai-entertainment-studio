import {
  APP_TAMPER_CONTRACT_TEST_CASES,
  APP_TAMPER_THREAT_MODEL,
  APP_WEB_LUMINA_TAMPER_DEFENSE_CHECKLIST,
  APP_PURCHASE_VERIFICATION_CONTRACT,
  CLIENT_ECONOMIC_TAMPER_FIELDS,
  PREMIUM_CHAT_REFUND_RESTRICTION_SPLIT_CONTRACT,
  SERVER_AUTHORITY_WALLET_POLICY,
  WALLET_LEDGER_INVARIANT_CONTRACT,
  WALLET_RISK_LOG_CONTRACT,
  WALLET_LEDGER_SOURCE_CONTRACT,
  WALLET_MUTATION_SURFACE_GUARD_MATRIX,
  WALLET_MUTATION_GUARD_STEPS,
  WALLET_RACE_CONDITION_GUARD_CONTRACT,
  WALLET_SERVER_ONLY_SPEND_GUARD_CONTRACT,
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

  it('pins premium chat restricted refund splits without payout or settlement mutation', () => {
    expect(PREMIUM_CHAT_REFUND_RESTRICTION_SPLIT_CONTRACT).toMatchObject({
      mutationEnabledByThisContract: false,
      clientRefundOrSettlementInputTrusted: false,
      amountBasis: 'server_room_purchase_ledger_amount',
      decisionAuthority: 'server_moderation_or_admin_refund_decision',
      duplicateGuard: 'server_admin_decision_key',
      restrictedUserFaultScenarios: [
        {
          scenario: 'user_fault_refund_70_percent',
          userRefundPercent: 70,
          artistCompensationPercent: 10,
          companyRetainedPercent: 20,
        },
        {
          scenario: 'user_fault_refund_50_percent',
          userRefundPercent: 50,
          artistCompensationPercent: 10,
          companyRetainedPercent: 40,
        },
      ],
      requiredLedgerSplits: [
        {
          party: 'user',
          direction: 'credit',
          ledgerType: 'refund',
          referenceType: 'premium_chat_room',
        },
        {
          party: 'artist',
          direction: 'credit',
          ledgerType: 'premium_chat_room_artist_compensation',
          referenceType: 'premium_chat_room_refund_decision',
        },
        {
          party: 'company',
          direction: 'credit',
          ledgerType: 'premium_chat_room_company_revenue',
          referenceType: 'premium_chat_room_refund_decision',
        },
      ],
      separatedOutcomeReasons: [
        'artist_forced_termination',
        'report_suspension',
        'admin_sanction',
      ],
      walletLedgerRequiredBeforePayout: true,
      settlementMutationAllowed: false,
      payoutMutationAllowed: false,
    });
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

  it('pins concurrent wallet spend race guards across premium chat and AI content orders', () => {
    expect(WALLET_RACE_CONDITION_GUARD_CONTRACT).toMatchObject({
      concurrentSpendAuthority: 'wallet_accounts.cached_balance',
      debitOperation: 'atomic_update_many_cached_balance_gte_server_amount',
      ledgerWriteOrder: 'after_atomic_debit_success_only',
      domainRecordWriteOrder: 'same_transaction_after_atomic_debit_success',
      repeatedCallbackBehavior:
        'return_existing_projection_without_duplicate_ledger',
      idempotencyMismatchBehavior: 'stable_conflict_before_wallet_lookup',
      insufficientBalanceBehavior:
        'stable_insufficient_balance_without_domain_or_ledger_write',
      failedValidationCreatesLedger: false,
      pendingCreatesSpendLedger: false,
      rolledBackCountsTowardBalance: false,
      clientSubmittedAmountTrusted: false,
      clientSubmittedBalanceTrusted: false,
      settlementMutation: false,
      payoutMutation: false,
    });
    expect(WALLET_RACE_CONDITION_GUARD_CONTRACT.debitSurfaces).toEqual(
      expect.arrayContaining([
        'premium_chat_room_open',
        'premium_chat_message_debit',
        'premium_chat_donation',
        'chat_feature_order',
      ]),
    );
    expect(WALLET_RACE_CONDITION_GUARD_CONTRACT.duplicateRequestGuard).toEqual(
      expect.arrayContaining([
        'user_scoped_idempotency_key',
        'server_message_pair_meter_key',
        'provider_transaction_id',
      ]),
    );
    expect(
      WALLET_RACE_CONDITION_GUARD_CONTRACT.statusProjectionConsistency,
    ).toMatchObject({
      pending: 'not_counted_as_available_balance_until_committed',
      failed: 'not_counted_as_spend_or_credit',
      rolled_back: 'shown_as_reversal_pair_or_excluded_from_net_balance',
    });
  });

  it('pins cross-surface wallet ledger invariants for charge, first bonus, donation, and refund restriction', () => {
    expect(WALLET_LEDGER_INVARIANT_CONTRACT.globalInvariants).toMatchObject({
      clientEconomicFieldsTrusted: false,
      walletMutationRequiresLedger: true,
      ledgerRequiresIdempotencyOrProviderTransaction: true,
      walletAndLedgerSameTransaction: true,
      debitRequiresAtomicNonNegativeBalanceUpdate: true,
      failedValidationCreatesLedger: false,
      settlementOrPayoutFromClientInput: false,
    });
    expect(WALLET_LEDGER_INVARIANT_CONTRACT.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          surface: 'charge_purchase_credit',
          amountAuthority: 'server_active_charge_product_and_verified_provider_event',
          duplicateGuard: 'provider_transaction_id_unique',
          clientSubmittedAmountTrusted: false,
          failedProviderEventCreatesLedger: false,
        }),
        expect.objectContaining({
          surface: 'first_charge_bonus',
          amountAuthority: 'server_10_percent_of_base_lumina',
          duplicateGuard: 'first_charge_bonus_user_idempotency_key',
          packageBonusIncluded: false,
          clientSubmittedAmountTrusted: false,
        }),
        expect.objectContaining({
          surface: 'premium_chat_room_open',
          amountAuthority: 'server_room_tier_policy',
          negativeBalanceGuard: 'atomic_cached_balance_gte_amount_update',
          insufficientBalanceCreatesLedger: false,
          clientSubmittedAmountTrusted: false,
          clientSubmittedBalanceTrusted: false,
          clientSubmittedBonusTrusted: false,
        }),
        expect.objectContaining({
          surface: 'premium_chat_message_debit',
          amountAuthority: 'server_visible_two_way_sentence_pair_meter',
          negativeBalanceGuard: 'atomic_cached_balance_gte_amount_update',
          insufficientBalanceCreatesLedger: false,
          clientSubmittedAmountTrusted: false,
          clientSubmittedBalanceTrusted: false,
          clientSubmittedBonusTrusted: false,
        }),
        expect.objectContaining({
          surface: 'premium_chat_donation',
          amountAuthority: 'server_normalized_donation_amount',
          negativeBalanceGuard: 'atomic_cached_balance_gte_amount_update',
          insufficientBalanceCreatesLedger: false,
          clientSubmittedAmountTrusted: false,
          clientSubmittedBalanceTrusted: false,
          clientSubmittedBonusTrusted: false,
        }),
        expect.objectContaining({
          surface: 'premium_chat_refund_restriction',
          amountAuthority: 'server_admin_or_moderation_refund_policy',
          duplicateGuard: 'server_admin_decision_key',
          existingLedgerRequired: true,
          clientSubmittedRefundRateTrusted: false,
        }),
      ]),
    );
    expect(
      WALLET_LEDGER_INVARIANT_CONTRACT.surfaces.every(
        (surface) =>
          surface.settlementMutation === false &&
          surface.payoutMutation === false,
      ),
    ).toBe(true);
  });

  it('pins Lumina spend to server wallet balance and ledger writes, never client display values', () => {
    expect(WALLET_SERVER_ONLY_SPEND_GUARD_CONTRACT).toMatchObject({
      clientDisplayedBalanceTrusted: false,
      clientSubmittedLedgerIdTrusted: false,
      clientSubmittedCachedBalanceTrusted: false,
      spendRequiresServerWalletAccount: true,
      spendRequiresServerLedgerWrite: true,
      spendRequiresAtomicBalanceGuard: true,
      missingLedgerMeansSpendImpossible: true,
      blackMarketOrModifiedAppDisplayValueIgnored: true,
      insufficientBalanceCreatesDomainRecord: false,
      insufficientBalanceCreatesLedger: false,
      requiredServerSources: [
        'wallet_accounts.cached_balance',
        'wallet_ledger.idempotency_key',
        'server_product_or_domain_policy_amount',
      ],
    });
    expect(WALLET_SERVER_ONLY_SPEND_GUARD_CONTRACT.spendSurfaces).toEqual(
      expect.arrayContaining([
        'gift_order',
        'boost_paid_like',
        'premium_video_unlock',
        'chat_feature_order',
        'premium_chat_room_open',
        'premium_chat_message',
        'premium_chat_donation',
        'fan_letter',
        'user_gift_transfer_send',
      ]),
    );

    const debitSources = WALLET_LEDGER_SOURCE_CONTRACT.filter(
      (source) => source.direction === 'debit',
    );
    expect(
      WALLET_SERVER_ONLY_SPEND_GUARD_CONTRACT.spendSurfaces.every((surface) =>
        debitSources.some((source) => source.source === surface),
      ),
    ).toBe(true);
    expect(
      debitSources.every(
        (source) =>
          source.serverAuthority.includes('wallet_account_cached_balance') ||
          source.serverAuthority.includes('server_visible_two_way_sentence_pair_meter'),
      ),
    ).toBe(true);
  });

  it('ignores client-submitted Lumina balance, debit amount, and bonus values for premium chat debits', () => {
    const premiumChatDebitSurfaces = WALLET_LEDGER_INVARIANT_CONTRACT.surfaces.filter(
      (surface) =>
        [
          'premium_chat_room_open',
          'premium_chat_message_debit',
          'premium_chat_donation',
        ].includes(surface.surface),
    ) as Array<{
      surface: string;
      direction: string;
      clientSubmittedAmountTrusted: boolean;
      clientSubmittedBalanceTrusted: boolean;
      clientSubmittedBonusTrusted: boolean;
      negativeBalanceGuard: string;
      insufficientBalanceCreatesLedger: boolean;
      settlementMutation: boolean;
      payoutMutation: boolean;
    }>;

    expect(premiumChatDebitSurfaces).toHaveLength(3);
    expect(premiumChatDebitSurfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          surface: 'premium_chat_room_open',
          amountAuthority: 'server_room_tier_policy',
          duplicateGuard: 'room_open_idempotency_fingerprint',
        }),
        expect.objectContaining({
          surface: 'premium_chat_message_debit',
          amountAuthority: 'server_visible_two_way_sentence_pair_meter',
          duplicateGuard: 'server_message_pair_meter_key',
        }),
        expect.objectContaining({
          surface: 'premium_chat_donation',
          amountAuthority: 'server_normalized_donation_amount',
          duplicateGuard: 'premium_chat_donation_idempotency_key',
        }),
      ]),
    );
    for (const surface of premiumChatDebitSurfaces) {
      expect(surface.direction).toBe('debit');
      expect(surface.clientSubmittedAmountTrusted).toBe(false);
      expect(surface.clientSubmittedBalanceTrusted).toBe(false);
      expect(surface.clientSubmittedBonusTrusted).toBe(false);
      expect(surface.negativeBalanceGuard).toBe(
        'atomic_cached_balance_gte_amount_update',
      );
      expect(surface.insufficientBalanceCreatesLedger).toBe(false);
      expect(surface.settlementMutation).toBe(false);
      expect(surface.payoutMutation).toBe(false);
    }
  });

  it('pins payment, donation, premium chat debit, and refund guards to server authority', () => {
    expect(WALLET_MUTATION_SURFACE_GUARD_MATRIX).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          surface: 'payment_purchase_credit',
          direction: 'credit',
          authority: ['server product table', 'provider verified transaction'],
          duplicateGuard: 'provider_transaction_id_unique',
          negativeBalanceGuard: 'not_applicable_credit',
          clientEconomicFieldsTrusted: false,
        }),
        expect.objectContaining({
          surface: 'premium_chat_room_open',
          direction: 'debit',
          duplicateGuard: 'room_open_idempotency_fingerprint',
          negativeBalanceGuard:
            'atomic_update_many_cached_balance_gte_server_amount',
          clientEconomicFieldsTrusted: false,
        }),
        expect.objectContaining({
          surface: 'premium_chat_donation',
          direction: 'debit',
          duplicateGuard: 'client_idempotency_key',
          negativeBalanceGuard:
            'atomic_update_many_cached_balance_gte_server_amount',
          clientEconomicFieldsTrusted: false,
        }),
        expect.objectContaining({
          surface: 'premium_chat_message_debit',
          direction: 'debit',
          duplicateGuard: 'server_message_pair_meter_key',
          negativeBalanceGuard:
            'atomic_update_many_cached_balance_gte_server_amount',
          clientEconomicFieldsTrusted: false,
        }),
        expect.objectContaining({
          surface: 'premium_chat_room_refund',
          direction: 'credit',
          duplicateGuard: 'server_room_refund_key',
          negativeBalanceGuard: 'not_applicable_credit',
          clientEconomicFieldsTrusted: false,
        }),
      ]),
    );
    expect(
      WALLET_MUTATION_SURFACE_GUARD_MATRIX.every(
        (surface) =>
          surface.clientEconomicFieldsTrusted === false &&
          surface.authority.length > 0 &&
          surface.duplicateGuard.length > 0 &&
          surface.ledgerWriteAtomicity.endsWith('_in_transaction'),
      ),
    ).toBe(true);
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

  it('requires every active wallet mutation surface to declare server authority and double-spend guards', () => {
    const mutationSurfaces = APP_WEB_LUMINA_TAMPER_DEFENSE_CHECKLIST.filter(
      (item) => item.mutation,
    );

    expect(mutationSurfaces.length).toBeGreaterThan(0);
    for (const surface of mutationSurfaces) {
      expect(surface.clientEconomicFieldsTrusted).toBe(false);
      expect(surface.authority.length).toBeGreaterThan(0);
      expect(surface.idempotencyOrProviderTransactionKey).not.toBe(
        'not_applicable_read_only',
      );
      expect(surface.doubleDebitGuard).toBeTruthy();
      expect(JSON.stringify(surface)).not.toContain('client balance');
      expect(JSON.stringify(surface)).not.toContain('client success');
    }
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

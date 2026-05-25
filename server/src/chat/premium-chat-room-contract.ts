export const PREMIUM_CHAT_ROOM_OPEN_AMOUNTS_LUMINA = [300, 500, 1000, 3000] as const;

export const PREMIUM_CHAT_ROOM_DEFAULT_TIER_KEY = 'premium_chat_room_300';
export const PREMIUM_CHAT_ROOM_DEFAULT_UNLOCKED_TIER_KEYS = [
  PREMIUM_CHAT_ROOM_DEFAULT_TIER_KEY,
] as const;
export const PREMIUM_CHAT_ROOM_BASE_DURATION_DAYS = 3;
export const PREMIUM_CHAT_ROOM_MAX_DURATION_DAYS = 10;
export const PREMIUM_CHAT_ROOM_MAX_TIER_AMOUNT_LUMINA = 3000;

export const PREMIUM_CHAT_ROOM_MUTATION_BLOCKED_STATES = [
  'closed',
  'artist_closed',
  'expired',
  'reported',
  'blind',
  'blinded',
  'suspended',
  'refund_pending',
  'refund_limited_70',
  'refund_limited_50',
  'refunded',
  'admin_review',
] as const;

export const PREMIUM_CHAT_REPORT_REVIEW_STATUS_KEYS = [
  'reported',
  'blinded',
  'admin_review',
  'suspended',
  'refund_limited_70',
  'refund_limited_50',
] as const;

export const PREMIUM_CHAT_REPORT_REVIEW_REASON_KEYS = [
  'user_report_received',
  'room_blinded_pending_admin_review',
  'admin_review_pending_decision',
  'room_suspended_pending_admin_review',
  'user_fault_report_refund_70',
  'operator_sanction_user_fault_refund_50',
] as const;

export const PREMIUM_CHAT_ROOM_STATUS_ALIASES = {
  blinded: 'blind',
} as const;

export const PREMIUM_CHAT_ROOM_REFUND_ACCOUNTING_LEDGER_TYPES = [
  'refund',
  'premium_chat_room_company_revenue',
  'premium_chat_room_artist_compensation',
] as const;

export const PREMIUM_CHAT_BILLING_LEDGER_EVENT_NAMES = [
  'premium_chat.room_open_fee.debit',
  'premium_chat.message_pair.debit',
  'premium_chat.donation.debit',
  'premium_chat.room_refund.credit',
  'premium_chat.refund_restriction.company_revenue.credit',
  'premium_chat.refund_restriction.artist_compensation.credit',
] as const;

export const PREMIUM_CHAT_REFUND_REASON_KEYS = [
  'unanswered_24h_full_refund',
  'artist_forced_close_full_refund',
  'user_fault_report_refund_70',
  'operator_sanction_user_fault_refund_50',
  'operator_sanction_artist_fault_full_refund',
] as const;

export const PREMIUM_CHAT_LEDGER_TRACE_FIELDS = [
  'premiumChatLedgerGroupId',
  'flowType',
  'ledgerEventName',
  'ledgerType',
  'source',
  'direction',
  'referenceType',
  'referenceId',
  'roomId',
  'artistId',
  'userId',
  'grossLumina',
  'debitLumina',
  'refundLumina',
  'userRefundLumina',
  'companyRevenueLumina',
  'artistCompensationLumina',
  'refundReasonKey',
  'refundRestrictionStatusKey',
  'moderationStatusKey',
  'moderationReasonKey',
  'revenueSplitBps',
  'adminDecisionKeyHash',
  'reportId',
  'reportDecisionId',
  'idempotencyKeyHash',
  'settlementCandidate',
  'payoutCandidate',
] as const;

export const PREMIUM_CHAT_ROOM_ACCESS_CONTROL = {
  unauthenticated: {
    allowed: false,
    status: 401,
    code: 'auth_required',
    messageKey: 'auth.required',
    response: 'global_auth_mapping',
  },
  ownerUser: {
    allowed: true,
    userEndpoint: true,
    artistEndpoint: false,
    canOpenRoom: false,
    canSeePublicRefundStatus: true,
    canSeeReportProcessingStatus: true,
    canSeeArtistForceCloseAvailability: false,
    canForceClose: false,
    canReport: true,
  },
  artistOperator: {
    allowed: true,
    userEndpoint: false,
    artistEndpoint: true,
    canOpenRoom: false,
    canSeePublicRefundStatus: true,
    canSeeReportPendingFlag: true,
    canSeeForceCloseAvailability: true,
    canForceClose: false,
    canReport: false,
  },
  nonOwner: {
    allowed: false,
    status: 403,
    code: 'PREMIUM_CHAT_ROOM_NOT_OWNED',
    messageKey: 'chat.premiumRoom.notOwned',
    response: '403_or_404_without_identity_leak',
  },
} as const;

export type PremiumChatRoomAccessRole = keyof typeof PREMIUM_CHAT_ROOM_ACCESS_CONTROL;

export function isPremiumChatRoomMutationBlocked(status: string) {
  return (PREMIUM_CHAT_ROOM_MUTATION_BLOCKED_STATES as readonly string[]).includes(
    status,
  );
}

export const PREMIUM_CHAT_ROOM_CONTRACT = {
  version: '2026-05-25.premium-chat-report-refund-status.v1',
  previousVersion: '2026-05-25.premium-chat-billing-ledger.v1',
  feature: 'premium_chat_room',
  status: 'contract_ready_mutation_blocked',
  policy: {
    authRequired: true,
    walletMutationEnabled: false,
    pgRefundMutationEnabled: false,
    premiumChatAccountingLedgerMutationEnabled: false,
    settlementMutationEnabled: false,
    payoutMutationEnabled: false,
    clientSubmittedAmountTrusted: false,
    clientSubmittedBalanceTrusted: false,
    clientSubmittedPriceTrusted: false,
    clientSubmittedRefundRateTrusted: false,
    clientSubmittedArtistShareTrusted: false,
    clientSubmittedDurationTrusted: false,
    clientSubmittedSettlementShareTrusted: false,
    disabledMessageKey: 'chat.premiumRoom.contractPending',
  },
  roomOpen: {
    endpoint: {
      method: 'POST',
      pathTemplate: '/api/v1/chat/premium-rooms',
      status: 'planned',
      enabled: false,
      walletMutation: true,
      requiresIdempotencyKey: true,
    },
    tiers: [
      {
        tierKey: 'premium_chat_room_300',
        amountLumina: 300,
        initialArtistEligible: true,
        maxTier: false,
        unlockGate: {
          type: 'none',
          serverEvaluated: true,
        },
      },
      {
        tierKey: 'premium_chat_room_500',
        amountLumina: 500,
        initialArtistEligible: false,
        maxTier: false,
        unlockGate: {
          type: 'artist_follower_policy',
          policyKey: 'premiumChat.roomUnlock.500',
          serverEvaluated: true,
        },
      },
      {
        tierKey: 'premium_chat_room_1000',
        amountLumina: 1000,
        initialArtistEligible: false,
        maxTier: false,
        unlockGate: {
          type: 'artist_follower_policy',
          policyKey: 'premiumChat.roomUnlock.1000',
          serverEvaluated: true,
        },
      },
      {
        tierKey: 'premium_chat_room_3000',
        amountLumina: 3000,
        initialArtistEligible: false,
        maxTier: true,
        unlockGate: {
          type: 'artist_follower_policy',
          policyKey: 'premiumChat.roomUnlock.3000',
          serverEvaluated: true,
        },
      },
    ],
    idempotency: {
      required: true,
      acceptedFrom: ['Idempotency-Key header', 'body.idempotencyKey'],
      replayBehavior: 'return_existing_room_projection_without_second_debit',
      conflictStatus: 409,
      conflictCode: 'PREMIUM_CHAT_ROOM_IDEMPOTENCY_CONFLICT',
      conflictMessageKey: 'chat.premiumRoom.idempotencyConflict',
      requestFingerprintFields: ['artistId', 'tierKey', 'amountLumina'],
      replayRequiresSameFingerprint: true,
      conflictWalletMutation: false,
      walletLedgerKeyPattern:
        'premium-chat-room-open:<artistId>:<client-idempotency-key>',
    },
    ledger: {
      eventName: 'premium_chat.room_open_fee.debit',
      source: 'premium_chat_room_open',
      ledgerType: 'premium_chat_open',
      direction: 'debit',
      referenceType: 'premium_chat_room',
      requiresWalletLedgerTypeMigration: true,
      mutationEnabledByDefault: false,
      balanceSource: 'wallet_accounts.cached_balance',
      clientSubmittedBalanceTrusted: false,
      amountSource: 'server room tier policy',
      atomicBalanceGuard: 'cached_balance >= server_amount',
      insufficientBalanceBehavior:
        'return stable insufficient balance error without room, order, or ledger write',
      traceFields: PREMIUM_CHAT_LEDGER_TRACE_FIELDS,
    },
  },
  billingLedger: {
    version: '2026-05-25.premium-chat-billing-ledger.v1',
    mutationEnabled: false,
    walletMutationEnabled: false,
    pgRefundMutationEnabled: false,
    settlementMutationEnabled: false,
    payoutMutationEnabled: false,
    eventNames: PREMIUM_CHAT_BILLING_LEDGER_EVENT_NAMES,
    traceFields: PREMIUM_CHAT_LEDGER_TRACE_FIELDS,
    flowTypes: ['charge', 'refund', 'donation', 'revenue_split'],
    roomOpenFee: {
      eventName: 'premium_chat.room_open_fee.debit',
      source: 'premium_chat_room_open',
      ledgerType: 'premium_chat_open',
      direction: 'debit',
      referenceType: 'premium_chat_room',
      amountSource: 'server room tier policy',
      allowedAmountsLumina: PREMIUM_CHAT_ROOM_OPEN_AMOUNTS_LUMINA,
      idempotencyKeyPattern:
        'premium-chat-room-open:<artistId>:<client-idempotency-key>',
    },
    messagePairCharge: {
      eventName: 'premium_chat.message_pair.debit',
      source: 'premium_chat_message',
      ledgerType: 'premium_chat_message',
      direction: 'debit',
      referenceType: 'premium_chat_message_meter_window',
      unit: {
        userVisibleSentenceCount: 1,
        artistVisibleSentenceCount: 1,
        chargeLumina: 1,
      },
      rounding: {
        fractionalLuminaAllowed: false,
        halfPairWalletDebitAllowed: false,
        chargeablePairsFormula:
          'min(serverVisibleUserSentenceCount, serverVisibleArtistSentenceCount)',
        unpairedSentenceBehavior:
          'carry_forward_or_hold_without_wallet_ledger_until_counterparty_sentence_exists',
      },
      idempotencyKeyPattern:
        'premium-chat-message-pair:<roomId>:<meter-window-or-message-pair-id>',
      clientSubmittedMessageCountTrusted: false,
      rawMessageBodyRequired: false,
    },
    donation: {
      eventName: 'premium_chat.donation.debit',
      source: 'premium_chat_donation',
      ledgerType: 'premium_chat_donation',
      direction: 'debit',
      referenceType: 'premium_chat_donation',
      amountSource: 'server-normalized donation amount',
      settlementCandidate: true,
      payoutCandidate: false,
      idempotencyKeyPattern:
        'premium-chat-donation:<sessionId>:<client-idempotency-key>',
    },
    refundCredit: {
      eventName: 'premium_chat.room_refund.credit',
      source: 'premium_chat_room_refund',
      ledgerType: 'refund',
      direction: 'credit',
      referenceType: 'premium_chat_room',
      idempotencyKeyPattern: 'premium-chat-room-refund:<roomId>:<reasonKey>',
      duplicateRefundProtection: true,
    },
    revenueSplitEntries: [
      {
        eventName: 'premium_chat.refund_restriction.company_revenue.credit',
        source: 'premium_chat_room_refund_restriction',
        ledgerType: 'premium_chat_room_company_revenue',
        direction: 'credit',
        flowType: 'revenue_split',
        walletLedger: false,
        settlementMutation: false,
        payoutMutation: false,
      },
      {
        eventName:
          'premium_chat.refund_restriction.artist_compensation.credit',
        source: 'premium_chat_room_refund_restriction',
        ledgerType: 'premium_chat_room_artist_compensation',
        direction: 'credit',
        flowType: 'revenue_split',
        walletLedger: false,
        settlementMutation: false,
        payoutMutation: false,
      },
    ],
    sameLedgerTraceability:
      'All premium chat charge, refund, donation, and revenue split rows must share premiumChatLedgerGroupId, roomId, artistId, flowType, ledgerEventName, refundReasonKey when applicable, and revenueSplitBps when applicable.',
  },
  duration: {
    baseDays: PREMIUM_CHAT_ROOM_BASE_DURATION_DAYS,
    maxTotalDays: PREMIUM_CHAT_ROOM_MAX_DURATION_DAYS,
    artistExtension: {
      maxAdditionalDays:
        PREMIUM_CHAT_ROOM_MAX_DURATION_DAYS - PREMIUM_CHAT_ROOM_BASE_DURATION_DAYS,
      maxTotalDays: PREMIUM_CHAT_ROOM_MAX_DURATION_DAYS,
      serverEvaluated: true,
      messageKey: 'chat.premiumRoom.extensionLimit',
    },
    clientSubmittedExpiryTrusted: false,
    clientSubmittedDurationTrusted: false,
  },
  lifecycleStates: [
    'opened',
    'active',
    'artist_answered',
    'closed',
    'artist_closed',
    'expired',
    'reported',
    'blind',
    'blinded',
    'suspended',
    'refund_pending',
    'refund_limited_70',
    'refund_limited_50',
    'refunded',
    'admin_review',
  ],
  artistClosure: {
    normalClose: {
      resultingStatus: 'closed',
      legacyStatusAlias: 'artist_closed',
      refundPolicyKey: 'none_after_answer_or_expiry',
      artistCompensationEligible: true,
      walletAction: 'none',
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
    },
    artistForcedClose: {
      resultingStatus: 'refund_pending',
      finalStatusAfterRefund: 'refunded',
      refundPolicyKey: 'artist_forced_close_full_refund',
      userRefundBps: 10000,
      artistCompensationEligible: false,
      walletAction: 'server_refund_after_policy_decision',
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      messageKey: 'chat.premiumRoom.refund.artistForcedClose',
    },
    userFaultClose: {
      resultingStatus: 'refund_pending',
      refundPolicyKey: 'user_fault_partial_refund',
      artistCompensationEligible: true,
      allowedRefundPolicyKeys: ['user_fault_refund_70', 'user_fault_refund_50'],
    },
    operatorSanctionClose: {
      resultingStatus: 'admin_review',
      refundPolicyKey: 'operator_sanction_review',
      artistCompensationEligible: false,
    },
  },
  refunds: {
    reasonKeys: PREMIUM_CHAT_REFUND_REASON_KEYS,
    reasonPolicy: [
      {
        reasonKey: 'unanswered_24h_full_refund',
        userRefundBps: 10000,
        companyRevenueBps: 0,
        artistCompensationBps: 0,
        artistCompensationEligible: false,
      },
      {
        reasonKey: 'artist_forced_close_full_refund',
        userRefundBps: 10000,
        companyRevenueBps: 0,
        artistCompensationBps: 0,
        artistCompensationEligible: false,
      },
      {
        reasonKey: 'user_fault_report_refund_70',
        userRefundBps: 7000,
        companyRevenueBps: 2000,
        artistCompensationBps: 1000,
        artistCompensationEligible: true,
      },
      {
        reasonKey: 'operator_sanction_user_fault_refund_50',
        userRefundBps: 5000,
        companyRevenueBps: 4000,
        artistCompensationBps: 1000,
        artistCompensationEligible: true,
      },
      {
        reasonKey: 'operator_sanction_artist_fault_full_refund',
        userRefundBps: 10000,
        companyRevenueBps: 0,
        artistCompensationBps: 0,
        artistCompensationEligible: false,
      },
    ],
    unansweredAfterHours: {
      hours: 24,
      stateKey: 'unanswered_24h_refund_pending',
      publicReasonKey: 'unanswered_24h',
      userRefundBps: 10000,
      ledgerType: 'refund',
      eventName: 'premium_chat.room_refund.credit',
      source: 'premium_chat_room_refund',
      idempotency: 'server_room_refund_key',
      messageKey: 'chat.premiumRoom.refund.unanswered24h',
    },
    artistForcedClose: {
      reasonKey: 'artist_forced_close_full_refund',
      userRefundBps: 10000,
      eventName: 'premium_chat.room_refund.credit',
      ledgerType: 'refund',
      source: 'premium_chat_room_refund',
      idempotency: 'server_room_refund_key',
      duplicateRefundProtection: true,
      companyRevenueBps: 0,
      artistCompensationBps: 0,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      messageKey: 'chat.premiumRoom.refund.artistForcedClose',
    },
    userFaultPartialRefund: {
      allowedReasonKeys: [
        'user_fault_report_refund_70',
        'operator_sanction_user_fault_refund_50',
      ],
      allowedUserRefundBps: [7000, 5000],
      clientSubmittedRefundRateTrusted: false,
      minArtistCompensationBpsOfGross: 1000,
      compensationSource: 'non_refunded_portion',
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      messageKey: 'chat.premiumRoom.refund.userFaultPartial',
      outcomes: [
        {
          outcomeKey: 'user_fault_refund_70',
          refundRestrictionStatusKey: 'refund_limited_70',
          reasonKey: 'user_fault_report_refund_70',
          userRefundBps: 7000,
          companyRevenueBps: 2000,
          artistCompensationBps: 1000,
          policyHoldBps: 0,
          resultingStatus: 'refunded',
          ledgerEntries: [
            {
              entryKey: 'user_lumina_refund',
              eventName: 'premium_chat.room_refund.credit',
              ledger: 'wallet_ledger',
              ledgerType: 'refund',
              source: 'premium_chat_room_refund',
              direction: 'credit',
              bps: 7000,
              idempotency: 'server_room_refund_key',
              walletLedger: true,
              settlementMutation: false,
              payoutMutation: false,
            },
            {
              entryKey: 'company_revenue_retention',
              eventName:
                'premium_chat.refund_restriction.company_revenue.credit',
              ledger: 'premium_chat_room_revenue_ledger',
              ledgerType: 'premium_chat_room_company_revenue',
              source: 'premium_chat_room_refund_restriction',
              direction: 'credit',
              bps: 2000,
              walletLedger: false,
              settlementMutation: false,
              payoutMutation: false,
            },
            {
              entryKey: 'artist_compensation_retention',
              eventName:
                'premium_chat.refund_restriction.artist_compensation.credit',
              ledger: 'premium_chat_artist_revenue_ledger',
              ledgerType: 'premium_chat_room_artist_compensation',
              source: 'premium_chat_room_refund_restriction',
              direction: 'credit',
              bps: 1000,
              walletLedger: false,
              settlementMutation: false,
              payoutMutation: false,
            },
          ],
        },
        {
          outcomeKey: 'user_fault_refund_50',
          refundRestrictionStatusKey: 'refund_limited_50',
          reasonKey: 'operator_sanction_user_fault_refund_50',
          userRefundBps: 5000,
          companyRevenueBps: 4000,
          artistCompensationBps: 1000,
          policyHoldBps: 0,
          resultingStatus: 'refunded',
          ledgerEntries: [
            {
              entryKey: 'user_lumina_refund',
              eventName: 'premium_chat.room_refund.credit',
              ledger: 'wallet_ledger',
              ledgerType: 'refund',
              source: 'premium_chat_room_refund',
              direction: 'credit',
              bps: 5000,
              idempotency: 'server_room_refund_key',
              walletLedger: true,
              settlementMutation: false,
              payoutMutation: false,
            },
            {
              entryKey: 'company_revenue_retention',
              eventName:
                'premium_chat.refund_restriction.company_revenue.credit',
              ledger: 'premium_chat_room_revenue_ledger',
              ledgerType: 'premium_chat_room_company_revenue',
              source: 'premium_chat_room_refund_restriction',
              direction: 'credit',
              bps: 4000,
              walletLedger: false,
              settlementMutation: false,
              payoutMutation: false,
            },
            {
              entryKey: 'artist_compensation_retention',
              eventName:
                'premium_chat.refund_restriction.artist_compensation.credit',
              ledger: 'premium_chat_artist_revenue_ledger',
              ledgerType: 'premium_chat_room_artist_compensation',
              source: 'premium_chat_room_refund_restriction',
              direction: 'credit',
              bps: 1000,
              walletLedger: false,
              settlementMutation: false,
              payoutMutation: false,
            },
          ],
        },
      ],
    },
    duplicateRefundProtection: {
      walletLedgerKeyPattern: 'premium-chat-room-refund:<roomId>:<reasonKey>',
      adminDecisionKeyRequired: true,
    },
  },
  stateTransitions: {
    normalClose: {
      from: ['active', 'artist_answered'],
      to: 'closed',
      walletLedgerEntries: [],
      accountingLedgerEntries: [],
      orderMutation: false,
      settlementMutation: false,
      payoutMutation: false,
      messageKey: 'chat.premiumRoom.closed.normal',
    },
    artistForcedClose: {
      from: ['opened', 'active', 'artist_answered'],
      to: 'refund_pending',
      finalStatus: 'refunded',
      refundPolicyKey: 'artist_forced_close_full_refund',
      walletLedgerEntries: ['premium_chat_room_refund'],
      accountingLedgerEntries: [],
      orderMutation: false,
      settlementMutation: false,
      payoutMutation: false,
      messageKey: 'chat.premiumRoom.refund.artistForcedClose',
    },
    userFaultRefund70: {
      from: ['opened', 'active', 'artist_answered'],
      to: 'refund_pending',
      reviewStatus: 'refund_limited_70',
      finalStatus: 'refunded',
      refundPolicyKey: 'user_fault_refund_70',
      walletLedgerEntries: ['premium_chat_room_refund'],
      accountingLedgerEntries: [
        'premium_chat_room_company_revenue',
        'premium_chat_room_artist_compensation',
      ],
      orderMutation: false,
      settlementMutation: false,
      payoutMutation: false,
      messageKey: 'chat.premiumRoom.refund.userFaultPartial',
    },
    userFaultRefund50: {
      from: ['opened', 'active', 'artist_answered'],
      to: 'refund_pending',
      reviewStatus: 'refund_limited_50',
      finalStatus: 'refunded',
      refundPolicyKey: 'user_fault_refund_50',
      walletLedgerEntries: ['premium_chat_room_refund'],
      accountingLedgerEntries: [
        'premium_chat_room_company_revenue',
        'premium_chat_room_artist_compensation',
      ],
      orderMutation: false,
      settlementMutation: false,
      payoutMutation: false,
      messageKey: 'chat.premiumRoom.refund.userFaultPartial',
    },
    reportPending: {
      from: ['opened', 'active', 'artist_answered'],
      to: 'admin_review',
      interimStatuses: ['reported', 'blind', 'suspended'],
      walletLedgerEntries: [],
      accountingLedgerEntries: [],
      orderMutation: false,
      settlementMutation: false,
      payoutMutation: false,
      messageKey: 'chat.premiumRoom.report.processing',
    },
  },
  mutationGuards: {
    failClosedStates: PREMIUM_CHAT_ROOM_MUTATION_BLOCKED_STATES,
    blockedMutations: [
      'message_create',
      'donation_preview',
      'donation_create',
      'room_reopen',
      'conversation_meter_decrement',
      'support_point_grant',
      'settlement_accrual',
      'payout_accrual',
    ],
    guardOrder: [
      'load_room_status',
      'block_terminal_or_moderation_status_before_wallet_lookup',
      'block_reported_or_blinded_room_before_message_acceptance',
      'require_admin_refund_decision_before_any_refund_credit',
    ],
    blockedStateError: {
      status: 409,
      code: 'PREMIUM_CHAT_ROOM_MUTATION_BLOCKED',
      messageKey: 'chat.premiumRoom.blockedState',
    },
  },
  moderation: {
    reportEndpoint: {
      method: 'POST',
      pathTemplate: '/api/v1/chat/premium-rooms/:roomId/reports',
      status: 'planned',
      enabled: false,
      walletMutation: false,
    },
    statusKeys: PREMIUM_CHAT_REPORT_REVIEW_STATUS_KEYS,
    reasonKeys: PREMIUM_CHAT_REPORT_REVIEW_REASON_KEYS,
    statusAliases: PREMIUM_CHAT_ROOM_STATUS_ALIASES,
    reportProcessingStatus: 'admin_review',
    roomStatusesWhilePending: ['reported', 'blinded', 'suspended'],
    storageStatusAliases: [
      {
        publicStatusKey: 'blinded',
        storageStatusKey: 'blind',
        reasonKey: 'room_blinded_pending_admin_review',
        messageKey: 'chat.premiumRoom.report.blinded',
      },
    ],
    reviewStatuses: [
      {
        statusKey: 'reported',
        reasonKey: 'user_report_received',
        messageKey: 'chat.premiumRoom.report.reported',
        mutationAllowed: false,
        walletAction: 'none',
        publicCopySource: 'messageKey',
      },
      {
        statusKey: 'blinded',
        storageStatusKey: 'blind',
        reasonKey: 'room_blinded_pending_admin_review',
        messageKey: 'chat.premiumRoom.report.blinded',
        mutationAllowed: false,
        walletAction: 'none',
        publicCopySource: 'messageKey',
      },
      {
        statusKey: 'admin_review',
        reasonKey: 'admin_review_pending_decision',
        messageKey: 'chat.premiumRoom.report.adminReview',
        mutationAllowed: false,
        walletAction: 'none',
        publicCopySource: 'messageKey',
      },
      {
        statusKey: 'suspended',
        reasonKey: 'room_suspended_pending_admin_review',
        messageKey: 'chat.premiumRoom.report.suspended',
        mutationAllowed: false,
        walletAction: 'none',
        publicCopySource: 'messageKey',
      },
      {
        statusKey: 'refund_limited_70',
        reasonKey: 'user_fault_report_refund_70',
        refundPolicyKey: 'user_fault_refund_70',
        messageKey: 'chat.premiumRoom.refund.limited70',
        mutationAllowed: false,
        walletAction: 'server_refund_after_admin_decision_only',
        userRefundBps: 7000,
        companyRevenueBps: 2000,
        artistCompensationBps: 1000,
        splitTraceFields: [
          'refundRestrictionStatusKey',
          'refundReasonKey',
          'userRefundLumina',
          'companyRevenueLumina',
          'artistCompensationLumina',
          'revenueSplitBps',
          'adminDecisionKeyHash',
        ],
      },
      {
        statusKey: 'refund_limited_50',
        reasonKey: 'operator_sanction_user_fault_refund_50',
        refundPolicyKey: 'user_fault_refund_50',
        messageKey: 'chat.premiumRoom.refund.limited50',
        mutationAllowed: false,
        walletAction: 'server_refund_after_admin_decision_only',
        userRefundBps: 5000,
        companyRevenueBps: 4000,
        artistCompensationBps: 1000,
        splitTraceFields: [
          'refundRestrictionStatusKey',
          'refundReasonKey',
          'userRefundLumina',
          'companyRevenueLumina',
          'artistCompensationLumina',
          'revenueSplitBps',
          'adminDecisionKeyHash',
        ],
      },
    ],
    visibility: 'blind_until_admin_decision',
    walletActionBeforeAdminDecision: 'none',
    mutationGuard: 'fail_closed_before_wallet_or_message_mutation',
    messageKey: 'chat.premiumRoom.report.processing',
  },
  sensitiveDataPolicy: {
    rawChatBodyLogged: false,
    rawReportReasonReturned: false,
    tokenCookieSecretDbUrlLogged: false,
    signedUrlLogged: false,
  },
  responsePolicy: {
    stableKeysOnlyForUserFacingCopy: true,
    rawEnumUserCopyAllowed: false,
    labelsOptional: true,
    publicReasonOnly: true,
    publicReasonFields: ['reasonKey', 'messageKey', 'labels'],
    blockedPublicFields: [
      'rawAdminNote',
      'rawLedgerId',
      'rawWalletLedgerId',
      'rawProviderPayload',
      'rawUserEmail',
    ],
  },
  accessControl: PREMIUM_CHAT_ROOM_ACCESS_CONTROL,
} as const;

export function premiumChatRoomKnownTierKeys() {
  return PREMIUM_CHAT_ROOM_CONTRACT.roomOpen.tiers.map((tier) => tier.tierKey);
}

export function premiumChatRoomTierByKey(tierKey: string | null | undefined) {
  return (
    PREMIUM_CHAT_ROOM_CONTRACT.roomOpen.tiers.find(
      (tier) => tier.tierKey === tierKey,
    ) ?? null
  );
}

export function premiumChatRoomAllowedTierKeysForServerUnlocks(
  serverUnlockedTierKeys: readonly string[] = PREMIUM_CHAT_ROOM_DEFAULT_UNLOCKED_TIER_KEYS,
) {
  const knownKeys = new Set<string>(premiumChatRoomKnownTierKeys());
  const allowed = new Set<string>(PREMIUM_CHAT_ROOM_DEFAULT_UNLOCKED_TIER_KEYS);

  serverUnlockedTierKeys
    .filter((tierKey) => knownKeys.has(tierKey))
    .forEach((tierKey) => allowed.add(tierKey));

  return premiumChatRoomKnownTierKeys().filter((tierKey) => allowed.has(tierKey));
}

export function resolvePremiumChatRoomOpenPolicy(input: {
  tierKey?: string | null;
  serverUnlockedTierKeys?: readonly string[];
  clientSubmittedAmountLumina?: unknown;
  clientSubmittedFollowerCount?: unknown;
} = {}) {
  const tierKey = input.tierKey ?? PREMIUM_CHAT_ROOM_DEFAULT_TIER_KEY;
  const tier = premiumChatRoomTierByKey(tierKey);
  const allowedTierKeys = premiumChatRoomAllowedTierKeysForServerUnlocks(
    input.serverUnlockedTierKeys,
  );

  if (!tier) {
    return {
      allowed: false,
      status: 400,
      code: 'PREMIUM_CHAT_ROOM_TIER_INVALID',
      messageKey: 'chat.premiumRoom.invalidTier',
      tierKey,
      amountLumina: null,
      walletMutationEnabled: false,
      clientSubmittedAmountTrusted: false,
      clientSubmittedAmountIgnored:
        input.clientSubmittedAmountLumina !== undefined,
      clientSubmittedFollowerCountTrusted: false,
      allowedTierKeys,
      publicReason: {
        reasonKey: 'invalid_tier',
        messageKey: 'chat.premiumRoom.invalidTier',
        labels: {},
      },
    } as const;
  }

  if (!allowedTierKeys.includes(tier.tierKey)) {
    return {
      allowed: false,
      status: 403,
      code: 'PREMIUM_CHAT_ROOM_TIER_LOCKED',
      messageKey: 'chat.premiumRoom.tierLocked',
      tierKey: tier.tierKey,
      amountLumina: tier.amountLumina,
      maxTierAmountLumina: PREMIUM_CHAT_ROOM_MAX_TIER_AMOUNT_LUMINA,
      allowedTierKeys,
      unlockGate: tier.unlockGate,
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      clientSubmittedAmountTrusted: false,
      clientSubmittedFollowerCountTrusted: false,
      clientSubmittedFollowerCountIgnored:
        input.clientSubmittedFollowerCount !== undefined,
      publicReason: {
        reasonKey: 'tier_locked',
        messageKey: 'chat.premiumRoom.tierLocked',
        labels: {},
      },
    } as const;
  }

  const submittedAmount =
    typeof input.clientSubmittedAmountLumina === 'number'
      ? input.clientSubmittedAmountLumina
      : typeof input.clientSubmittedAmountLumina === 'string'
        ? Number(input.clientSubmittedAmountLumina)
        : null;

  return {
    allowed: true,
    tierKey: tier.tierKey,
    amountLumina: tier.amountLumina,
    maxTierAmountLumina: PREMIUM_CHAT_ROOM_MAX_TIER_AMOUNT_LUMINA,
    allowedTierKeys,
    unlockGate: tier.unlockGate,
    source: 'server_room_open_tier_policy',
    walletMutationEnabled: false,
    settlementMutationEnabled: false,
    payoutMutationEnabled: false,
    clientSubmittedAmountTrusted: false,
    clientSubmittedAmountIgnored: input.clientSubmittedAmountLumina !== undefined,
    clientSubmittedAmountMismatch:
      submittedAmount !== null &&
      Number.isFinite(submittedAmount) &&
      submittedAmount !== tier.amountLumina,
    clientSubmittedFollowerCountTrusted: false,
    clientSubmittedFollowerCountIgnored:
      input.clientSubmittedFollowerCount !== undefined,
    publicReason: {
      reasonKey: 'open_allowed',
      messageKey: 'chat.premiumRoom.openAllowed',
      labels: {},
    },
  } as const;
}

export function resolvePremiumChatRoomDurationPolicy(input: {
  requestedTotalDays?: unknown;
} = {}) {
  const requested =
    typeof input.requestedTotalDays === 'number'
      ? input.requestedTotalDays
      : typeof input.requestedTotalDays === 'string'
        ? Number(input.requestedTotalDays)
        : null;
  const validRequested =
    requested !== null && Number.isInteger(requested) && requested > 0
      ? requested
      : null;
  const requestedOrBase = validRequested ?? PREMIUM_CHAT_ROOM_BASE_DURATION_DAYS;
  const totalDays = Math.min(
    Math.max(requestedOrBase, PREMIUM_CHAT_ROOM_BASE_DURATION_DAYS),
    PREMIUM_CHAT_ROOM_MAX_DURATION_DAYS,
  );

  return {
    baseDays: PREMIUM_CHAT_ROOM_BASE_DURATION_DAYS,
    maxTotalDays: PREMIUM_CHAT_ROOM_MAX_DURATION_DAYS,
    totalDays,
    clientSubmittedDurationTrusted: false,
    clientSubmittedExpiryTrusted: false,
    serverCalculatedExpiryAuthoritative: true,
    capped: validRequested !== null && validRequested > PREMIUM_CHAT_ROOM_MAX_DURATION_DAYS,
    raisedToBase:
      validRequested !== null && validRequested < PREMIUM_CHAT_ROOM_BASE_DURATION_DAYS,
    messageKey:
      validRequested !== null && validRequested > PREMIUM_CHAT_ROOM_MAX_DURATION_DAYS
        ? 'chat.premiumRoom.extensionLimit'
        : null,
  } as const;
}

export function resolvePremiumChatRoomRefundPolicy(input: {
  policyKey: string;
  clientSubmittedRefundBps?: unknown;
  clientSubmittedArtistShareBps?: unknown;
}) {
  if (input.policyKey === 'artist_forced_close_full_refund') {
    return {
      allowed: true,
      policyKey: input.policyKey,
      userRefundBps: PREMIUM_CHAT_ROOM_CONTRACT.refunds.artistForcedClose.userRefundBps,
      companyRevenueBps:
        PREMIUM_CHAT_ROOM_CONTRACT.refunds.artistForcedClose.companyRevenueBps,
      artistCompensationBps:
        PREMIUM_CHAT_ROOM_CONTRACT.refunds.artistForcedClose.artistCompensationBps,
      clientSubmittedRefundRateTrusted: false,
      clientSubmittedArtistShareTrusted: false,
      clientSubmittedRefundRateIgnored:
        input.clientSubmittedRefundBps !== undefined,
      clientSubmittedArtistShareIgnored:
        input.clientSubmittedArtistShareBps !== undefined,
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      messageKey: PREMIUM_CHAT_ROOM_CONTRACT.refunds.artistForcedClose.messageKey,
    } as const;
  }

  const outcome =
    PREMIUM_CHAT_ROOM_CONTRACT.refunds.userFaultPartialRefund.outcomes.find(
      (candidate) => candidate.outcomeKey === input.policyKey,
    );

  if (!outcome) {
    return {
      allowed: false,
      status: 400,
      code: 'PREMIUM_CHAT_ROOM_REFUND_POLICY_INVALID',
      messageKey: 'chat.premiumRoom.refund.invalidPolicy',
      policyKey: input.policyKey,
      clientSubmittedRefundRateTrusted: false,
      clientSubmittedArtistShareTrusted: false,
      walletMutationEnabled: false,
    } as const;
  }

  return {
    allowed: true,
    policyKey: outcome.outcomeKey,
    userRefundBps: outcome.userRefundBps,
    companyRevenueBps: outcome.companyRevenueBps,
    artistCompensationBps: outcome.artistCompensationBps,
    policyHoldBps: outcome.policyHoldBps,
    resultingStatus: outcome.resultingStatus,
    ledgerEntries: outcome.ledgerEntries,
    clientSubmittedRefundRateTrusted: false,
    clientSubmittedArtistShareTrusted: false,
    clientSubmittedRefundRateIgnored: input.clientSubmittedRefundBps !== undefined,
    clientSubmittedArtistShareIgnored:
      input.clientSubmittedArtistShareBps !== undefined,
    walletMutationEnabled: false,
    settlementMutationEnabled: false,
    payoutMutationEnabled: false,
    messageKey:
      PREMIUM_CHAT_ROOM_CONTRACT.refunds.userFaultPartialRefund.messageKey,
  } as const;
}

export function resolvePremiumChatMessageChargePolicy(input: {
  userVisibleSentenceCount?: unknown;
  artistVisibleSentenceCount?: unknown;
  clientSubmittedChargeLumina?: unknown;
} = {}) {
  const userVisibleSentenceCount = nonNegativeInteger(
    input.userVisibleSentenceCount,
  );
  const artistVisibleSentenceCount = nonNegativeInteger(
    input.artistVisibleSentenceCount,
  );
  const chargeablePairCount = Math.min(
    userVisibleSentenceCount,
    artistVisibleSentenceCount,
  );
  const chargeLumina = chargeablePairCount;
  const clientSubmittedChargeLumina =
    typeof input.clientSubmittedChargeLumina === 'number'
      ? input.clientSubmittedChargeLumina
      : typeof input.clientSubmittedChargeLumina === 'string'
        ? Number(input.clientSubmittedChargeLumina)
        : null;

  return {
    eventName: 'premium_chat.message_pair.debit',
    source: 'premium_chat_message',
    ledgerType: 'premium_chat_message',
    direction: 'debit',
    unitLumina: 1,
    userVisibleSentenceCount,
    artistVisibleSentenceCount,
    chargeablePairCount,
    chargeLumina,
    unpairedUserSentenceCount:
      userVisibleSentenceCount - chargeablePairCount,
    unpairedArtistSentenceCount:
      artistVisibleSentenceCount - chargeablePairCount,
    fractionalLuminaAllowed: false,
    halfPairWalletDebitAllowed: false,
    walletMutationEnabled: false,
    settlementMutationEnabled: false,
    payoutMutationEnabled: false,
    clientSubmittedChargeTrusted: false,
    clientSubmittedChargeIgnored:
      input.clientSubmittedChargeLumina !== undefined,
    clientSubmittedChargeMismatch:
      clientSubmittedChargeLumina !== null &&
      Number.isFinite(clientSubmittedChargeLumina) &&
      clientSubmittedChargeLumina !== chargeLumina,
    rawMessageBodyRequired: false,
    messageKey: 'chat.premiumRoom.messageChargePolicy',
  } as const;
}

function nonNegativeInteger(value: unknown) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : 0;

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

export function premiumChatRoomAccessForRole(role: PremiumChatRoomAccessRole) {
  return PREMIUM_CHAT_ROOM_ACCESS_CONTROL[role];
}

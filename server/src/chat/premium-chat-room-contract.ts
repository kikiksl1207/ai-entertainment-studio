export const PREMIUM_CHAT_ROOM_OPEN_AMOUNTS_LUMINA = [300, 500, 1000, 3000] as const;

export const PREMIUM_CHAT_ROOM_DEFAULT_TIER_KEY = 'premium_chat_room_300';
export const PREMIUM_CHAT_ROOM_DEFAULT_UNLOCKED_TIER_KEYS = [
  PREMIUM_CHAT_ROOM_DEFAULT_TIER_KEY,
] as const;
export const PREMIUM_CHAT_ROOM_BASE_DURATION_DAYS = 3;
export const PREMIUM_CHAT_ROOM_MAX_DURATION_DAYS = 10;
export const PREMIUM_CHAT_ROOM_MAX_TIER_AMOUNT_LUMINA = 3000;
export const PREMIUM_CHAT_ROOM_FOLLOWER_TIER_UNLOCKS = [
  {
    tierKey: 'premium_chat_room_300',
    amountLumina: 300,
    minActiveFollowers: 0,
  },
  {
    tierKey: 'premium_chat_room_500',
    amountLumina: 500,
    minActiveFollowers: 1000,
  },
  {
    tierKey: 'premium_chat_room_1000',
    amountLumina: 1000,
    minActiveFollowers: 10000,
  },
  {
    tierKey: 'premium_chat_room_3000',
    amountLumina: 3000,
    minActiveFollowers: 50000,
  },
] as const;

export const PREMIUM_CHAT_ROOM_MUTATION_BLOCKED_STATES = [
  'closed',
  'artist_closed',
  'expired',
  'reported',
  'paused_by_report',
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

export const PREMIUM_CHAT_REPORT_REFUND_API_STATUS_KEYS = [
  'active',
  'paused_by_report',
  'refund_pending',
  'refunded',
  'closed_by_artist',
  'closed_by_operator',
] as const;

export const PREMIUM_CHAT_REPORT_REFUND_API_ACTION_KEYS = [
  'report_submit',
  'artist_force_close',
  'operator_sanction_close',
  'unanswered_24h_refund_candidate',
] as const;

export const PREMIUM_CHAT_UNANSWERED_REFUND_ELIGIBLE_STATUSES = [
  'opened',
  'active',
] as const;

export const PREMIUM_CHAT_UNANSWERED_REFUND_EXCLUDED_REASON_KEYS = [
  'artist_answered',
  'report_or_admin_review_not_unanswered',
  'terminal_status_not_unanswered',
  'not_yet_24h',
] as const;

export const PREMIUM_CHAT_ROOM_STATUS_READ_KEYS = [
  'active',
  'paused_by_report',
  'reported',
  'blinded',
  'admin_review',
  'refund_pending',
  'refund_limited_70',
  'refund_limited_50',
  'refunded',
  'closed',
  'closed_by_artist',
  'closed_by_operator',
  'expired',
  'suspended',
] as const;

export const PREMIUM_CHAT_ADMIN_REPORT_REFUND_QUERY_STATUS_KEYS = [
  'reported',
  'blinded',
  'suspended',
  'admin_review',
  'refund_pending',
  'refund_limited_70',
  'refund_limited_50',
  'refunded',
  'closed_by_artist',
  'closed_by_operator',
] as const;

export const PREMIUM_CHAT_ADMIN_REFUND_STATE_KEYS = [
  'none',
  'not_eligible',
  'pending',
  'refund_limited_70',
  'refund_limited_50',
  'refunded',
  'admin_review',
] as const;

export const PREMIUM_CHAT_ROOM_LIFECYCLE_PROJECTION_STATUS_KEYS = [
  'active',
  'expired',
  'closed',
  'paused_by_report',
  'refund_pending',
  'refunded',
  'closed_by_artist',
  'closed_by_operator',
] as const;

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

export const PREMIUM_CHAT_LEDGER_PRECISION_CONTRACT = {
  version: '2026-06-15.premium-chat-ledger-precision.v1',
  amountStorage: 'integer_lumina_subunits',
  luminaSubunitsPerLumina: 2,
  minimumBillableUnitLumina: 0.5,
  decimalAmountStoredInLedger: false,
  roundingMode: 'reject_non_unit_multiple_before_ledger',
  roomOpenFeeAmountSource: 'server_room_tier_policy',
  messagePairAmountSource: 'server_visible_two_way_sentence_pair_meter',
  duplicateChargeGuard: [
    'room_open_idempotency_fingerprint',
    'server_message_pair_meter_key',
  ],
  clientSubmittedAmountTrusted: false,
  clientSubmittedBalanceTrusted: false,
  clientSubmittedBonusTrusted: false,
  walletMutationEnabled: false,
  settlementMutationEnabled: false,
  payoutMutationEnabled: false,
} as const;

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
  version: '2026-05-25.premium-chat-report-refund-api.v1',
  previousVersion: '2026-05-25.premium-chat-report-refund-status.v1',
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
    entitlementGuard: {
      version: '2026-06-05.premium-chat-room-open-entitlement-guard.v1',
      defaultTierKey: PREMIUM_CHAT_ROOM_DEFAULT_TIER_KEY,
      defaultUnlockedTierKeys: PREMIUM_CHAT_ROOM_DEFAULT_UNLOCKED_TIER_KEYS,
      allowedAmountsLumina: PREMIUM_CHAT_ROOM_OPEN_AMOUNTS_LUMINA,
      maxTierAmountLumina: PREMIUM_CHAT_ROOM_MAX_TIER_AMOUNT_LUMINA,
      tierUnlockSource: 'server_unlocked_tier_keys',
      clientSubmittedAmountTrusted: false,
      clientSubmittedFollowerCountTrusted: false,
      clientSubmittedDurationTrusted: false,
      walletBalanceSource: 'wallet_accounts.cached_balance',
      duration: {
        baseDays: PREMIUM_CHAT_ROOM_BASE_DURATION_DAYS,
        maxTotalDays: PREMIUM_CHAT_ROOM_MAX_DURATION_DAYS,
        artistExtensionMaxAdditionalDays:
          PREMIUM_CHAT_ROOM_MAX_DURATION_DAYS - PREMIUM_CHAT_ROOM_BASE_DURATION_DAYS,
        serverCalculatedExpiryAuthoritative: true,
      },
      validationOrder: [
        'artist_exists',
        'tier_key_known',
        'tier_unlocked_by_server',
        'server_amount_from_tier',
        'duration_server_clamped',
        'idempotency_fingerprint',
        'wallet_cached_balance_gte_server_amount',
      ],
      mutationEnabled: false,
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
    },
    followerTierUnlockContract: {
      version: '2026-06-05.premium-chat-follower-tier-unlock.v1',
      sourceOfTruth: 'artist_follows',
      activeFollowerWhere: {
        status: 'active',
        deletedAt: null,
      },
      thresholds: PREMIUM_CHAT_ROOM_FOLLOWER_TIER_UNLOCKS,
      countIncludesDeletedAccounts: false,
      clientSubmittedFollowerCountTrusted: false,
      cachedFollowerCountTrustedForUnlock: false,
      manualCompanyOverrideEnabled: false,
      multipleRoomAmountsCanBeOffered: true,
      projectionFields: [
        'tierKey',
        'amountLumina',
        'minActiveFollowers',
        'unlocked',
        'source',
      ],
      mutationEnabled: false,
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
    },
    followerTierPriceGuard: {
      version: '2026-06-08.premium-chat-follower-tier-price-guard.v1',
      baseTierKey: PREMIUM_CHAT_ROOM_DEFAULT_TIER_KEY,
      baseAmountLumina: 300,
      maxTierAmountLumina: PREMIUM_CHAT_ROOM_MAX_TIER_AMOUNT_LUMINA,
      serverCountSource: 'artist_follows.active.non_deleted',
      serverUnlockedTierKeySource: 'server_counted_active_artist_follows',
      allowedTierAmountsLumina: PREMIUM_CHAT_ROOM_OPEN_AMOUNTS_LUMINA,
      failClosedBeforeWalletMutation: true,
      artistSubmittedTierTrusted: false,
      artistSubmittedAmountTrusted: false,
      clientSubmittedFollowerCountTrusted: false,
      validationOrder: [
        'tier_key_known',
        'artist_active_follower_count_loaded',
        'tier_unlocked_by_server',
        'server_amount_from_tier',
        'wallet_cached_balance_gte_server_amount',
      ],
      lockedTierError: {
        status: 403,
        code: 'PREMIUM_CHAT_ROOM_TIER_LOCKED',
        messageKey: 'chat.premiumRoom.tierLocked',
      },
      invalidTierError: {
        status: 400,
        code: 'PREMIUM_CHAT_ROOM_TIER_INVALID',
        messageKey: 'chat.premiumRoom.invalidTier',
      },
      mutationEnabled: false,
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
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
      precision: PREMIUM_CHAT_LEDGER_PRECISION_CONTRACT,
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
  roomLifecycle: {
    version: '2026-05-25.premium-chat-room-open-expiry.v1',
    mutationEnabled: false,
    walletMutationEnabled: false,
    settlementMutationEnabled: false,
    payoutMutationEnabled: false,
    roomOpen: {
      createdStatusKey: 'active',
      defaultTierKey: PREMIUM_CHAT_ROOM_DEFAULT_TIER_KEY,
      defaultAmountLumina: 300,
      amountSource: 'server room tier policy',
      openedAtSource: 'server_now',
      expiresAtSource: 'server_opened_at_plus_server_duration_days',
      baseDurationDays: PREMIUM_CHAT_ROOM_BASE_DURATION_DAYS,
      maxTotalDays: PREMIUM_CHAT_ROOM_MAX_DURATION_DAYS,
      clientSubmittedExpiryTrusted: false,
      clientSubmittedDurationTrusted: false,
      clientSubmittedAmountTrusted: false,
      duplicateOpenPolicy: {
        sameIdempotencyFingerprint:
          'return_existing_room_projection_without_second_debit',
        mismatchedIdempotencyFingerprint:
          '409 PREMIUM_CHAT_ROOM_IDEMPOTENCY_CONFLICT before wallet lookup',
        sameUserArtistActiveRoom:
          'return_existing_non_terminal_room_projection_without_second_debit',
      },
      storageRequiredBeforeMutation: [
        'premium_chat_rooms',
        'premium_chat_room_status_events',
        'premium_chat_accounting_ledger',
        'idempotency_replay_projection',
      ],
    },
    expiration: {
      statusKey: 'expired',
      publicStatusKey: 'expired',
      serverClockAuthoritative: true,
      transitionKeyPattern: 'premium-chat-room-expire:<roomId>:<expiresAtIso>',
      duplicateTransitionBehavior:
        'return_existing_expired_projection_without_second_status_event',
      canSendMessage: false,
      canDonate: false,
      canMeterConversation: false,
      supportPointGrantAllowed: false,
      walletAction: 'none',
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      messageKey: 'chat.premiumRoom.expired',
    },
    schedulerTransition: {
      version: '2026-06-08.premium-chat-room-scheduler-transition.v1',
      schedulerOrAdminJobOnly: true,
      serverClockAuthoritative: true,
      transitionOrder: [
        'skip_terminal_or_report_review_statuses',
        'mark_unanswered_after_24h_as_refund_pending',
        'mark_answered_or_non_refund_candidate_after_expires_at_as_expired',
      ],
      baseDurationDays: PREMIUM_CHAT_ROOM_BASE_DURATION_DAYS,
      maxTotalDays: PREMIUM_CHAT_ROOM_MAX_DURATION_DAYS,
      maxExtensionAdditionalDays:
        PREMIUM_CHAT_ROOM_MAX_DURATION_DAYS - PREMIUM_CHAT_ROOM_BASE_DURATION_DAYS,
      unansweredRefundPrecedesExpiration: true,
      expirationDoesNotCreateRefundCredit: true,
      unansweredCandidateDoesNotCreateRefundCredit: true,
      statusEventIdempotencyKeys: {
        expired: 'premium-chat-room-expire:<roomId>:<expiresAtIso>',
        refundPending:
          'premium-chat-room-unanswered-refund-candidate:<roomId>:unanswered_24h',
      },
      mutationEnabled: false,
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
    },
    unansweredRefundCandidate: {
      afterHours: 24,
      eligibleFromStatuses: PREMIUM_CHAT_UNANSWERED_REFUND_ELIGIBLE_STATUSES,
      firstArtistAnswerEvidence: [
        'room.status=artist_answered',
        'first_artist_reply_at_present',
        'hasArtistAnswer=true',
      ],
      excludedReasonKeys: PREMIUM_CHAT_UNANSWERED_REFUND_EXCLUDED_REASON_KEYS,
      statusKey: 'refund_pending',
      publicStatusKey: 'refund_pending',
      actionKey: 'unanswered_24h_refund_candidate',
      reasonKey: 'unanswered_24h_full_refund',
      candidateOnly: true,
      automaticRefundCredit: false,
      finalStatusKeyAfterDecision: 'refunded',
      duplicateCandidateKeyPattern:
        'premium-chat-room-unanswered-refund-candidate:<roomId>:unanswered_24h',
      duplicateCandidateBehavior:
        'return_existing_refund_pending_projection_without_second_refund_or_status_event',
      canSendMessage: false,
      canDonate: false,
      canMeterConversation: false,
      supportPointGrantAllowed: false,
      walletAction: 'server_refund_after_policy_decision_only',
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      messageKey: 'chat.premiumRoom.refund.unanswered24h',
    },
    publicProjectionStatusKeys: PREMIUM_CHAT_ROOM_LIFECYCLE_PROJECTION_STATUS_KEYS,
    terminalOrPausedProjection: {
      canSendMessage: false,
      canDonate: false,
      canMeterConversation: false,
      supportPointGrantAllowed: false,
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
    },
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
    splitLedgerContract: {
      version: '2026-06-08.premium-chat-refund-split-ledger.v1',
      sourceOfTruth: 'server_refund_policy_and_room_status',
      grossBps: 10000,
      walletRefundLedgerType: 'refund',
      companyRevenueLedgerType: 'premium_chat_room_company_revenue',
      artistCompensationLedgerType: 'premium_chat_room_artist_compensation',
      duplicateDecisionGuard: 'premium-chat-room-refund:<roomId>:<reasonKey>',
      adminDecisionKeyRequired: true,
      clientSubmittedRefundRateTrusted: false,
      clientSubmittedArtistShareTrusted: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      outcomes: {
        artistForcedClose: {
          reasonKey: 'artist_forced_close_full_refund',
          userRefundBps: 10000,
          companyRevenueBps: 0,
          artistCompensationBps: 0,
          walletLedgerEntries: ['premium_chat_room_refund'],
          accountingLedgerEntries: [],
        },
        userFaultRefund70: {
          reasonKey: 'user_fault_report_refund_70',
          refundRestrictionStatusKey: 'refund_limited_70',
          userRefundBps: 7000,
          companyRevenueBps: 2000,
          companyRevenuePercent: 20,
          artistCompensationBps: 1000,
          artistCompensationPercent: 10,
          walletLedgerEntries: ['premium_chat_room_refund'],
          accountingLedgerEntries: [
            'premium_chat_room_company_revenue',
            'premium_chat_room_artist_compensation',
          ],
        },
        userFaultRefund50: {
          reasonKey: 'operator_sanction_user_fault_refund_50',
          refundRestrictionStatusKey: 'refund_limited_50',
          userRefundBps: 5000,
          companyRevenueBps: 4000,
          companyRevenuePercent: 40,
          artistCompensationBps: 1000,
          artistCompensationPercent: 10,
          walletLedgerEntries: ['premium_chat_room_refund'],
          accountingLedgerEntries: [
            'premium_chat_room_company_revenue',
            'premium_chat_room_artist_compensation',
          ],
        },
      },
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
    reportPauseAuditGuard: {
      version: '2026-06-05.premium-chat-report-pause-audit-guard.v1',
      reportSubmitResult: {
        roomStatusKey: 'paused_by_report',
        reportStatusKey: 'reported',
        nextReviewStatusKeys: ['blinded', 'suspended', 'admin_review'],
        userCanSendMessage: false,
        artistCanReply: false,
        canDonate: false,
        communicationRankingEligible: false,
        donationRankingEligible: false,
      },
      publicProjection: {
        statusKeySource: 'messageKey',
        rawChatBodyReturned: false,
        rawReportReasonReturned: false,
        rawEvidenceReturned: false,
        adminNoteReturned: false,
      },
      adminReviewProjection: {
        permissionKeys: ['payments:read', 'community:read'],
        rawChatBodyReturnedToGeneralApi: false,
        fullConversationAccessRequiresAdminReviewPermission: true,
        reportReasonKeyReturned: true,
        rawReportBodyReturned: false,
      },
      automaticMutation: {
        refund: false,
        walletLedger: false,
        premiumChatAccountingLedger: false,
        settlement: false,
        payout: false,
        supportPointLedger: false,
      },
      auditFields: [
        'roomId',
        'reportId',
        'reporterUserId',
        'reportedUserId',
        'roomStatusKey',
        'reportStatusKey',
        'reasonKey',
        'safeEvidenceHash',
        'idempotencyKeyHash',
      ],
      forbiddenAuditFields: [
        'rawChatBody',
        'rawConversationBody',
        'rawReportBody',
        'rawReportReason',
        'rawEvidence',
        'token',
        'cookie',
        'password',
        'databaseUrl',
      ],
    },
  },
  reportRefundApi: {
    version: '2026-05-25.premium-chat-report-refund-api.v1',
    status: 'planned_disabled',
    mutationEnabled: false,
    walletMutationEnabled: false,
    pgRefundMutationEnabled: false,
    premiumChatAccountingLedgerMutationEnabled: false,
    settlementMutationEnabled: false,
    payoutMutationEnabled: false,
    statusKeys: PREMIUM_CHAT_REPORT_REFUND_API_STATUS_KEYS,
    actionKeys: PREMIUM_CHAT_REPORT_REFUND_API_ACTION_KEYS,
    statusMapping: {
      active: {
        lifecycleStatuses: ['opened', 'active', 'artist_answered'],
        canSendMessage: true,
        canDonate: true,
        messageKey: 'chat.premiumRoom.active',
      },
      paused_by_report: {
        lifecycleStatuses: ['reported', 'blinded', 'blind', 'suspended', 'admin_review'],
        canSendMessage: false,
        canDonate: false,
        messageKey: 'chat.premiumRoom.report.processing',
      },
      refund_pending: {
        lifecycleStatuses: ['refund_pending'],
        canSendMessage: false,
        canDonate: false,
        messageKey: 'chat.premiumRoom.refund.pending',
      },
      refunded: {
        lifecycleStatuses: ['refunded'],
        canSendMessage: false,
        canDonate: false,
        messageKey: 'chat.premiumRoom.refund.completed',
      },
      closed_by_artist: {
        lifecycleStatuses: ['artist_closed'],
        canSendMessage: false,
        canDonate: false,
        messageKey: 'chat.premiumRoom.closed.artist',
      },
      closed_by_operator: {
        lifecycleStatuses: [
          'closed',
          'refund_limited_70',
          'refund_limited_50',
        ],
        canSendMessage: false,
        canDonate: false,
        messageKey: 'chat.premiumRoom.closed.operator',
      },
    },
    endpoints: {
      reportSubmit: {
        method: 'POST',
        pathTemplate: '/api/v1/chat/premium-rooms/:roomId/reports',
        enabled: false,
        authRequired: true,
        requiresIdempotencyKey: true,
        walletMutation: false,
        settlementMutation: false,
        payoutMutation: false,
      },
      artistForceClose: {
        method: 'POST',
        pathTemplate:
          '/api/v1/creator-studio/premium-chat/rooms/:roomId/force-close',
        enabled: false,
        authRequired: true,
        requiresIdempotencyKey: true,
        walletMutation: false,
        settlementMutation: false,
        payoutMutation: false,
      },
      operatorClose: {
        method: 'POST',
        pathTemplate:
          '/admin/api/v1/backstage/premium-chat/rooms/:roomId/operator-close',
        enabled: false,
        authRequired: true,
        superAdminOnly: true,
        requiresIdempotencyKey: true,
        walletMutation: false,
        settlementMutation: false,
        payoutMutation: false,
      },
    },
    auditGuard: {
      version: '2026-06-05.premium-chat-refund-audit-guard.v1',
      mutationEnabled: false,
      actions: [
        'premium_chat.report.submit',
        'premium_chat.report.status_change',
        'premium_chat.refund.unanswered_24h_candidate',
        'premium_chat.refund.artist_forced_close',
        'premium_chat.refund.operator_sanction_close',
        'premium_chat.refund.decision_recorded',
      ],
      statusTransitions: {
        reportSubmit: {
          roomStatusKey: 'paused_by_report',
          reportStatusKey: 'reported',
          walletMutation: false,
          refundMutation: false,
          settlementMutation: false,
          payoutMutation: false,
        },
        unanswered24h: {
          roomStatusKey: 'refund_pending',
          refundReasonKey: 'unanswered_24h_full_refund',
          walletMutation: 'server_refund_after_policy_decision_only',
          settlementMutation: false,
          payoutMutation: false,
        },
        artistForcedClose: {
          roomStatusKey: 'refund_pending',
          closeStatusKey: 'closed_by_artist',
          refundReasonKey: 'artist_forced_close_full_refund',
          artistCompensationBps: 0,
          settlementMutation: false,
          payoutMutation: false,
        },
        userFault70: {
          roomStatusKey: 'closed_by_operator',
          refundRestrictionStatusKey: 'refund_limited_70',
          refundReasonKey: 'user_fault_report_refund_70',
          userRefundBps: 7000,
          companyRevenueBps: 2000,
          artistCompensationBps: 1000,
          settlementMutation: false,
          payoutMutation: false,
        },
        userFault50: {
          roomStatusKey: 'closed_by_operator',
          refundRestrictionStatusKey: 'refund_limited_50',
          refundReasonKey: 'operator_sanction_user_fault_refund_50',
          userRefundBps: 5000,
          companyRevenueBps: 4000,
          artistCompensationBps: 1000,
          settlementMutation: false,
          payoutMutation: false,
        },
      },
      roomPauseRefundAuditChain: {
        version: '2026-06-08.premium-chat-room-pause-refund-audit-chain.v1',
        storageRequiredBeforeMutation: [
          'premium_chat_room_reports',
          'premium_chat_room_status_events',
          'premium_chat_room_refund_decisions',
          'premium_chat_accounting_ledger',
        ],
        reportSubmit: {
          roomStatusKey: 'paused_by_report',
          reportStatusKey: 'reported',
          auditAction: 'premium_chat.report.submit',
          messageMutation: false,
          donationMutation: false,
          walletMutation: false,
          refundMutation: false,
        },
        operatorReview: {
          reviewStatusKeys: ['blinded', 'suspended', 'admin_review'],
          auditAction: 'premium_chat.report.status_change',
          rawReportBodyReturned: false,
          rawAdminNoteReturned: false,
        },
        refundDecision: {
          allowedRoomStatusKeys: [
            'paused_by_report',
            'refund_pending',
            'closed_by_artist',
            'closed_by_operator',
          ],
          auditAction: 'premium_chat.refund.decision_recorded',
          refundLedgerCreatedOnlyAfterDecision: true,
          pgRefundMutationEnabled: false,
          settlementMutation: false,
          payoutMutation: false,
        },
      },
      requiredTraceFields: [
        'roomId',
        'artistId',
        'actorUserId',
        'actionKey',
        'roomStatusKey',
        'refundReasonKey',
        'refundRestrictionStatusKey',
        'refundPolicyKey',
        'reportDecisionId',
        'idempotencyKeyHash',
      ],
      forbiddenAuditFields: [
        'rawChatBody',
        'rawReportBody',
        'rawReportReason',
        'rawAdminNote',
        'rawWalletLedgerId',
        'providerRefundId',
        'paymentReceipt',
        'token',
        'cookie',
        'password',
        'secret',
        'databaseUrl',
      ],
      walletLedgerMutation: 'refund_credit_only_after_policy_decision',
      accountingLedgerSeparation: {
        refundCreditLedgerType: 'refund',
        companyRevenueLedgerType: 'premium_chat_room_company_revenue',
        artistCompensationLedgerType: 'premium_chat_room_artist_compensation',
        restrictedRevenueSplitWalletLedger: false,
        settlementMutation: false,
        payoutMutation: false,
      },
    },
    idempotency: {
      acceptedFrom: ['Idempotency-Key header', 'body.idempotencyKey'],
      rawIdempotencyKeyLogged: false,
      replayBehavior:
        'same key and same safe request fingerprint returns existing projection without a second state, refund, or ledger mutation',
      conflictStatus: 409,
      conflictCode: 'PREMIUM_CHAT_REPORT_REFUND_IDEMPOTENCY_CONFLICT',
      conflictMessageKey: 'chat.premiumRoom.idempotencyConflict',
      conflictMutation: false,
      requestFingerprintFields: {
        reportSubmit: ['roomId', 'reasonKey', 'safeEvidenceHash'],
        artistForceClose: ['roomId', 'reasonKey'],
        operatorClose: ['roomId', 'decisionKey', 'refundPolicyKey'],
      },
    },
    adminReadOnly: {
      version: '2026-05-27.premium-chat-admin-report-refund-readonly.v1',
      status: 'planned_disabled',
      readOnly: true,
      enabled: false,
      authRequired: true,
      adminOnly: true,
      permissionKeys: ['payments:read', 'community:read'],
      writePermissionRequiredForMutationOnly: 'refunds:write',
      endpoints: {
        list: {
          method: 'GET',
          path: '/admin/api/v1/backstage/premium-chat/report-refund-rooms',
          enabled: false,
          query: {
            status: PREMIUM_CHAT_ADMIN_REPORT_REFUND_QUERY_STATUS_KEYS,
            refundState: PREMIUM_CHAT_ADMIN_REFUND_STATE_KEYS,
            artistId: 'optional uuid',
            roomId: 'optional uuid',
            take: { default: 50, max: 100 },
            cursor: 'opaque cursor',
          },
          walletMutation: false,
          refundMutation: false,
          settlementMutation: false,
          payoutMutation: false,
        },
        detail: {
          method: 'GET',
          pathTemplate:
            '/admin/api/v1/backstage/premium-chat/report-refund-rooms/:roomId',
          enabled: false,
          walletMutation: false,
          refundMutation: false,
          settlementMutation: false,
          payoutMutation: false,
        },
      },
      statusKeys: {
        room: PREMIUM_CHAT_ROOM_STATUS_READ_KEYS,
        reportReview: PREMIUM_CHAT_REPORT_REVIEW_STATUS_KEYS,
        reportReason: PREMIUM_CHAT_REPORT_REVIEW_REASON_KEYS,
        refund: PREMIUM_CHAT_ADMIN_REFUND_STATE_KEYS,
        query: PREMIUM_CHAT_ADMIN_REPORT_REFUND_QUERY_STATUS_KEYS,
      },
      listProjection: {
        projection: 'premiumRoomAdminReportRefundListItem',
        fields: [
          'roomId',
          'artist',
          'status',
          'report',
          'refund',
          'replySla',
          'lastStatusEventAt',
          'createdAt',
          'updatedAt',
        ],
        statusLabelKeyRequired: true,
        reportReasonKeyReturned: true,
        refundPolicyKeyReturned: true,
        rawStatusAsCopy: false,
        rawReportReasonReturned: false,
        rawChatBodyReturned: false,
        internalAdminNoteReturned: false,
        personalContactReturned: false,
      },
      detailProjection: {
        projection: 'premiumRoomAdminReportRefundDetail',
        room: 'premiumRoomStatus admin-safe projection',
        report: 'premiumRoomReportStatus admin-safe projection',
        refund: 'premiumRoomRefundStatus admin-safe projection',
        replySla: {
          source: 'same premiumRoomStatus.replySla projection as owner/artist read',
          clockSource: 'room.openedAt + 24h',
          refundCandidateEligibleStatuses: ['opened', 'active'],
          answeredEvidenceExcludesRefundCandidate: [
            'room.status=artist_answered',
            'lastArtistReplyAt_present',
            'hasArtistAnswer=true',
          ],
          notificationMutationEnabled: false,
          refundMutationEnabled: false,
          walletMutationEnabled: false,
          settlementMutationEnabled: false,
          payoutMutationEnabled: false,
        },
        moderationTimeline: {
          statusEventsReturned: true,
          statusEventKeysOnly: true,
          rawPayloadReturned: false,
          rawChatBodyReturned: false,
          internalAdminNoteReturned: false,
        },
        refundRestrictionMetadata: {
          userFault70: {
            statusKey: 'refund_limited_70',
            refundReasonKey: 'user_fault_report_refund_70',
            userRefundRatePercent: 70,
            userRefundBps: 7000,
            companyRetentionRatePercent: 20,
            companyRevenueBps: 2000,
            artistCompensationRatePercent: 10,
            artistCompensationBps: 1000,
            displayToAdminReadOnly: true,
            walletCreditMutation: false,
            settlementMutation: false,
            payoutMutation: false,
          },
          userFault50: {
            statusKey: 'refund_limited_50',
            refundReasonKey: 'operator_sanction_user_fault_refund_50',
            userRefundRatePercent: 50,
            userRefundBps: 5000,
            companyRetentionRatePercent: 40,
            companyRevenueBps: 4000,
            artistCompensationRatePercent: 10,
            artistCompensationBps: 1000,
            displayToAdminReadOnly: true,
            walletCreditMutation: false,
            settlementMutation: false,
            payoutMutation: false,
          },
        },
        actionAvailability: {
          operatorCloseEndpoint:
            '/admin/api/v1/backstage/premium-chat/rooms/:roomId/operator-close',
          operatorCloseMutationEnabled: false,
          refundCreditMutationEnabled: false,
          walletDebitMutationEnabled: false,
          settlementMutationEnabled: false,
          payoutMutationEnabled: false,
        },
      },
      privacy: {
        rawChatBodyReturned: false,
        chatMessagePreviewMode: 'redacted_or_safe_hash_only',
        rawReportBodyReturned: false,
        rawReportReasonReturned: false,
        rawReporterUserIdReturned: false,
        counterpartyUserIdReturned: false,
        userEmailReturned: false,
        userPhoneReturned: false,
        privateProfileReturned: false,
        internalAdminNoteReturned: false,
        rawWalletLedgerIdReturned: false,
        providerRefundIdReturned: false,
        tokenCookieSecretDbUrlLogged: false,
      },
      noMutation: {
        roomStatusChange: true,
        reportStateChange: true,
        refundDecision: true,
        walletCredit: true,
        walletDebit: true,
        pgRefund: true,
        accountingLedger: true,
        settlement: true,
        payout: true,
      },
    },
    projections: {
      reportSubmitAccepted: {
        actionKey: 'report_submit',
        roomStatusKey: 'paused_by_report',
        reportStatusKey: 'reported',
        nextReviewStatusKeys: ['blinded', 'suspended', 'admin_review'],
        messageKey: 'chat.premiumRoom.report.processing',
        canSendMessage: false,
        canDonate: false,
        rawReportBodyReturned: false,
      },
      artistForceCloseAccepted: {
        actionKey: 'artist_force_close',
        roomStatusKey: 'refund_pending',
        closeStatusKey: 'closed_by_artist',
        refundReasonKey: 'artist_forced_close_full_refund',
        messageKey: 'chat.premiumRoom.refund.artistForcedClose',
      },
      operatorCloseAccepted: {
        actionKey: 'operator_sanction_close',
        roomStatusKey: 'closed_by_operator',
        allowedRefundRestrictionStatusKeys: [
          'refund_limited_70',
          'refund_limited_50',
        ],
        messageKey: 'chat.premiumRoom.closed.operator',
      },
      unansweredRefundCandidate: {
        actionKey: 'unanswered_24h_refund_candidate',
        roomStatusKey: 'refund_pending',
        refundReasonKey: 'unanswered_24h_full_refund',
        messageKey: 'chat.premiumRoom.refund.unanswered24h',
      },
    },
    refundOutcomes: [
      {
        actionKey: 'unanswered_24h_refund_candidate',
        refundReasonKey: 'unanswered_24h_full_refund',
        resultingStatusKey: 'refund_pending',
        refundRatePercent: 100,
        refundRateBps: 10000,
        artistCompensationRatePercent: 0,
        artistCompensationBps: 0,
      },
      {
        actionKey: 'artist_force_close',
        refundReasonKey: 'artist_forced_close_full_refund',
        resultingStatusKey: 'refund_pending',
        refundRatePercent: 100,
        refundRateBps: 10000,
        artistCompensationRatePercent: 0,
        artistCompensationBps: 0,
      },
      {
        actionKey: 'operator_sanction_close',
        refundReasonKey: 'user_fault_report_refund_70',
        refundRestrictionStatusKey: 'refund_limited_70',
        resultingStatusKey: 'closed_by_operator',
        refundRatePercent: 70,
        refundRateBps: 7000,
        companyRetentionRatePercent: 20,
        companyRevenueBps: 2000,
        artistCompensationRatePercent: 10,
        artistCompensationBps: 1000,
      },
      {
        actionKey: 'operator_sanction_close',
        refundReasonKey: 'operator_sanction_user_fault_refund_50',
        refundRestrictionStatusKey: 'refund_limited_50',
        resultingStatusKey: 'closed_by_operator',
        refundRatePercent: 50,
        refundRateBps: 5000,
        companyRetentionRatePercent: 40,
        companyRevenueBps: 4000,
        artistCompensationRatePercent: 10,
        artistCompensationBps: 1000,
      },
      {
        actionKey: 'operator_sanction_close',
        refundReasonKey: 'operator_sanction_artist_fault_full_refund',
        resultingStatusKey: 'closed_by_operator',
        refundRatePercent: 100,
        refundRateBps: 10000,
        artistCompensationRatePercent: 0,
        artistCompensationBps: 0,
      },
    ],
    noMutationBeforeStorage: [
      'premium_chat_rooms',
      'premium_chat_room_reports',
      'premium_chat_room_status_events',
      'premium_chat_room_refund_decisions',
      'premium_chat_accounting_ledger',
      'idempotency_replay_projection',
    ],
    privacy: {
      rawChatBodyLogged: false,
      rawReportBodyReturned: false,
      rawReportReasonReturned: false,
      rawAdminNoteReturned: false,
      tokenCookieSecretDbUrlLogged: false,
    },
  },
  sensitiveDataPolicy: {
    rawChatBodyLogged: false,
    rawReportReasonReturned: false,
    tokenCookieSecretDbUrlLogged: false,
    signedUrlLogged: false,
  },
  imageAttachmentPolicy: {
    version: '2026-06-17.premium-chat-image-attachment-projection.v1',
    enabled: false,
    uploadMutationEnabled: false,
    messageMutationEnabled: false,
    walletMutationEnabled: false,
    settlementMutationEnabled: false,
    payoutMutationEnabled: false,
    allowedAssetType: 'image',
    responseProjection: {
      assetId: '<uuid>',
      safeThumbnailUrl: '<public asset proxy thumbnail URL>',
      displayUrl: '<public asset proxy display URL>',
      width: '<number|null>',
      height: '<number|null>',
      fileSizeBytes: '<decimal string|null>',
      moderationStatus: '<pending|safe|needs_review|blocked>',
    },
    requiredResponseFields: [
      'assetId',
      'safeThumbnailUrl',
      'displayUrl',
      'width',
      'height',
      'fileSizeBytes',
      'moderationStatus',
    ],
    forbiddenResponseFields: [
      'originalPrivateUrl',
      'storageKey',
      'signedUrl',
      'rawMetadata',
      'walletLedgerId',
      'token',
      'cookie',
      'password',
      'databaseUrl',
    ],
    deliverySource: 'GET /api/v1/assets/public/:assetId/:variant',
    originalPrivateUrlReturned: false,
    storageKeyReturned: false,
    signedUrlReturned: false,
    rawMetadataReturned: false,
    walletLedgerIdReturned: false,
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

export function resolvePremiumChatRoomFollowerTierUnlocks(input: {
  activeFollowerCount?: unknown;
  clientSubmittedFollowerCount?: unknown;
} = {}) {
  const activeFollowerCount =
    typeof input.activeFollowerCount === 'number' &&
    Number.isInteger(input.activeFollowerCount) &&
    input.activeFollowerCount > 0
      ? input.activeFollowerCount
      : 0;
  const tiers = PREMIUM_CHAT_ROOM_FOLLOWER_TIER_UNLOCKS.map((tier) => ({
    ...tier,
    unlocked: activeFollowerCount >= tier.minActiveFollowers,
    source: 'server_counted_active_artist_follows',
  }));

  return {
    activeFollowerCount,
    unlockedTierKeys: tiers
      .filter((tier) => tier.unlocked)
      .map((tier) => tier.tierKey),
    tiers,
    sourceOfTruth: 'artist_follows',
    activeFollowerWhere: {
      status: 'active',
      deletedAt: null,
    },
    clientSubmittedFollowerCountTrusted: false,
    clientSubmittedFollowerCountIgnored:
      input.clientSubmittedFollowerCount !== undefined,
    cachedFollowerCountTrustedForUnlock: false,
    countIncludesDeletedAccounts: false,
    manualCompanyOverrideEnabled: false,
    multipleRoomAmountsCanBeOffered: true,
    walletMutationEnabled: false,
    settlementMutationEnabled: false,
    payoutMutationEnabled: false,
  } as const;
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

export function resolvePremiumChatRoomLifecycleProjection(status: string) {
  const normalizedStatus = normalizePremiumChatRoomStatus(status);
  const pausedByReportStatuses = new Set([
    'reported',
    'blind',
    'suspended',
    'admin_review',
  ]);

  if (['opened', 'active', 'artist_answered'].includes(normalizedStatus)) {
    return {
      inputStatus: status,
      normalizedStatus,
      statusKey: 'active',
      canSendMessage: true,
      canDonate: true,
      canMeterConversation: true,
      supportPointGrantAllowed: true,
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      messageKey: 'chat.premiumRoom.active',
    } as const;
  }

  if (pausedByReportStatuses.has(normalizedStatus)) {
    return blockedPremiumChatRoomProjection(status, normalizedStatus, {
      statusKey: 'paused_by_report',
      reasonKey: 'admin_review_pending_decision',
      messageKey: 'chat.premiumRoom.report.processing',
    });
  }

  if (normalizedStatus === 'expired') {
    return blockedPremiumChatRoomProjection(status, normalizedStatus, {
      statusKey: 'expired',
      reasonKey: 'room_expired',
      messageKey: 'chat.premiumRoom.expired',
    });
  }

  if (normalizedStatus === 'closed') {
    return blockedPremiumChatRoomProjection(status, normalizedStatus, {
      statusKey: 'closed',
      reasonKey: 'room_closed',
      messageKey: 'chat.premiumRoom.closed.normal',
    });
  }

  if (normalizedStatus === 'artist_closed') {
    return blockedPremiumChatRoomProjection(status, normalizedStatus, {
      statusKey: 'closed_by_artist',
      reasonKey: 'artist_closed_room',
      messageKey: 'chat.premiumRoom.closed.artist',
    });
  }

  if (normalizedStatus === 'refund_pending') {
    return blockedPremiumChatRoomProjection(status, normalizedStatus, {
      statusKey: 'refund_pending',
      reasonKey: 'refund_pending',
      messageKey: 'chat.premiumRoom.refund.pending',
    });
  }

  if (normalizedStatus === 'refunded') {
    return blockedPremiumChatRoomProjection(status, normalizedStatus, {
      statusKey: 'refunded',
      reasonKey: 'refund_completed',
      messageKey: 'chat.premiumRoom.refund.completed',
    });
  }

  if (['refund_limited_70', 'refund_limited_50'].includes(normalizedStatus)) {
    return blockedPremiumChatRoomProjection(status, normalizedStatus, {
      statusKey: 'closed_by_operator',
      reasonKey: normalizedStatus,
      messageKey: 'chat.premiumRoom.closed.operator',
    });
  }

  return blockedPremiumChatRoomProjection(status, normalizedStatus, {
    statusKey: 'closed',
    reasonKey: 'unknown_room_state',
    messageKey: 'chat.premiumRoom.blockedState',
  });
}

export function resolvePremiumChatRoomUnansweredRefundCandidate(input: {
  currentStatus?: string;
  hasArtistAnswer?: boolean;
  hoursSinceOpen?: unknown;
  alreadyCandidate?: boolean;
} = {}) {
  const currentStatus = input.currentStatus ?? 'active';
  const normalizedStatus = normalizePremiumChatRoomStatus(currentStatus);
  const projection = resolvePremiumChatRoomLifecycleProjection(currentStatus);
  const hoursSinceOpen = nonNegativeNumber(input.hoursSinceOpen);
  const hasArtistAnswer =
    input.hasArtistAnswer === true || normalizedStatus === 'artist_answered';
  const alreadyCandidate =
    input.alreadyCandidate === true || projection.statusKey === 'refund_pending';
  const eligibleFromCurrentStatus = (
    PREMIUM_CHAT_UNANSWERED_REFUND_ELIGIBLE_STATUSES as readonly string[]
  ).includes(normalizedStatus);
  const candidateEligible =
    !alreadyCandidate &&
    eligibleFromCurrentStatus &&
    !hasArtistAnswer &&
    hoursSinceOpen >=
      PREMIUM_CHAT_ROOM_CONTRACT.roomLifecycle.unansweredRefundCandidate.afterHours;

  if (alreadyCandidate || candidateEligible) {
    return {
      candidate: true,
      duplicateCandidate: alreadyCandidate,
      statusKey: 'refund_pending',
      actionKey: 'unanswered_24h_refund_candidate',
      reasonKey: 'unanswered_24h_full_refund',
      candidateOnly: true,
      automaticRefundCredit: false,
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      messageKey: 'chat.premiumRoom.refund.unanswered24h',
    } as const;
  }

  const reasonKey = unansweredRefundIneligibleReasonKey({
    hasArtistAnswer,
    eligibleFromCurrentStatus,
    projectionStatusKey: projection.statusKey,
  });

  return {
    candidate: false,
    duplicateCandidate: false,
    statusKey: projection.statusKey,
    reasonKey,
    hoursSinceOpen,
    thresholdHours:
      PREMIUM_CHAT_ROOM_CONTRACT.roomLifecycle.unansweredRefundCandidate.afterHours,
    walletMutationEnabled: false,
    settlementMutationEnabled: false,
    payoutMutationEnabled: false,
    messageKey:
      projection.statusKey === 'active'
        ? 'chat.premiumRoom.active'
        : projection.messageKey,
  } as const;
}

export function resolvePremiumChatRoomSchedulerTransition(input: {
  currentStatus?: string;
  hasArtistAnswer?: boolean;
  hoursSinceOpen?: unknown;
  expiresAtElapsed?: boolean;
} = {}) {
  const currentStatus = input.currentStatus ?? 'active';
  const projection = resolvePremiumChatRoomLifecycleProjection(currentStatus);
  const unansweredCandidate = resolvePremiumChatRoomUnansweredRefundCandidate({
    currentStatus,
    hasArtistAnswer: input.hasArtistAnswer,
    hoursSinceOpen: input.hoursSinceOpen,
  });

  if (unansweredCandidate.candidate) {
    return {
      transition: true,
      toStatusKey: 'refund_pending',
      actionKey: 'unanswered_24h_refund_candidate',
      reasonKey: 'unanswered_24h_full_refund',
      statusEventIdempotencyKeyPattern:
        PREMIUM_CHAT_ROOM_CONTRACT.roomLifecycle.schedulerTransition
          .statusEventIdempotencyKeys.refundPending,
      automaticRefundCredit: false,
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      messageKey: 'chat.premiumRoom.refund.unanswered24h',
    } as const;
  }

  const canExpire =
    input.expiresAtElapsed === true && projection.statusKey === 'active';

  if (canExpire) {
    return {
      transition: true,
      toStatusKey: 'expired',
      actionKey: 'room_expired',
      reasonKey: 'room_expired',
      statusEventIdempotencyKeyPattern:
        PREMIUM_CHAT_ROOM_CONTRACT.roomLifecycle.schedulerTransition
          .statusEventIdempotencyKeys.expired,
      automaticRefundCredit: false,
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      messageKey: 'chat.premiumRoom.expired',
    } as const;
  }

  return {
    transition: false,
    toStatusKey: projection.statusKey,
    reasonKey:
      projection.statusKey === 'active'
        ? 'not_due'
        : 'terminal_or_review_status_not_scheduler_mutated',
    automaticRefundCredit: false,
    walletMutationEnabled: false,
    settlementMutationEnabled: false,
    payoutMutationEnabled: false,
    messageKey: projection.messageKey,
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
  const precision = resolvePremiumChatLedgerPrecision({
    serverAmountLumina: chargeLumina,
    clientSubmittedAmountLumina: input.clientSubmittedChargeLumina,
  });
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
    chargeLedgerUnits: precision.serverAmountLedgerUnits,
    ledgerUnitScale: precision.luminaSubunitsPerLumina,
    ledgerAmountStorage: precision.amountStorage,
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

export function resolvePremiumChatLedgerPrecision(input: {
  serverAmountLumina?: unknown;
  clientSubmittedAmountLumina?: unknown;
}) {
  const serverAmountLumina = nonNegativeNumber(input.serverAmountLumina);
  const serverAmountLedgerUnits =
    serverAmountLumina * PREMIUM_CHAT_LEDGER_PRECISION_CONTRACT.luminaSubunitsPerLumina;
  const serverAmountValid =
    Number.isInteger(serverAmountLedgerUnits) && serverAmountLumina >= 0;
  const clientSubmittedAmountLumina =
    typeof input.clientSubmittedAmountLumina === 'number'
      ? input.clientSubmittedAmountLumina
      : typeof input.clientSubmittedAmountLumina === 'string'
        ? Number(input.clientSubmittedAmountLumina)
        : null;

  return {
    amountStorage: PREMIUM_CHAT_LEDGER_PRECISION_CONTRACT.amountStorage,
    luminaSubunitsPerLumina:
      PREMIUM_CHAT_LEDGER_PRECISION_CONTRACT.luminaSubunitsPerLumina,
    minimumBillableUnitLumina:
      PREMIUM_CHAT_LEDGER_PRECISION_CONTRACT.minimumBillableUnitLumina,
    serverAmountLumina,
    serverAmountLedgerUnits: serverAmountValid ? serverAmountLedgerUnits : null,
    serverAmountValid,
    decimalAmountStoredInLedger: false,
    roundingMode: PREMIUM_CHAT_LEDGER_PRECISION_CONTRACT.roundingMode,
    clientSubmittedAmountTrusted: false,
    clientSubmittedAmountIgnored:
      input.clientSubmittedAmountLumina !== undefined,
    clientSubmittedAmountMismatch:
      clientSubmittedAmountLumina !== null &&
      Number.isFinite(clientSubmittedAmountLumina) &&
      clientSubmittedAmountLumina !== serverAmountLumina,
    walletMutationEnabled: false,
    settlementMutationEnabled: false,
    payoutMutationEnabled: false,
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

function nonNegativeNumber(value: unknown) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : 0;

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function normalizePremiumChatRoomStatus(status: string) {
  return (
    (PREMIUM_CHAT_ROOM_STATUS_ALIASES as Record<string, string>)[status] ?? status
  );
}

function unansweredRefundIneligibleReasonKey(input: {
  hasArtistAnswer: boolean;
  eligibleFromCurrentStatus: boolean;
  projectionStatusKey: string;
}) {
  if (input.hasArtistAnswer) {
    return 'artist_answered';
  }

  if (input.eligibleFromCurrentStatus) {
    return 'not_yet_24h';
  }

  if (
    ['paused_by_report', 'closed_by_operator'].includes(input.projectionStatusKey)
  ) {
    return 'report_or_admin_review_not_unanswered';
  }

  return 'terminal_status_not_unanswered';
}

function blockedPremiumChatRoomProjection(
  inputStatus: string,
  normalizedStatus: string,
  publicStatus: {
    statusKey: string;
    reasonKey: string;
    messageKey: string;
  },
) {
  return {
    inputStatus,
    normalizedStatus,
    statusKey: publicStatus.statusKey,
    reasonKey: publicStatus.reasonKey,
    canSendMessage: false,
    canDonate: false,
    canMeterConversation: false,
    supportPointGrantAllowed: false,
    walletMutationEnabled: false,
    settlementMutationEnabled: false,
    payoutMutationEnabled: false,
    messageKey: publicStatus.messageKey,
  } as const;
}

export function premiumChatRoomAccessForRole(role: PremiumChatRoomAccessRole) {
  return PREMIUM_CHAT_ROOM_ACCESS_CONTROL[role];
}

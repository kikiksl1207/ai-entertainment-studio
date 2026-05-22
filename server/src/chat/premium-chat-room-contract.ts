export const PREMIUM_CHAT_ROOM_OPEN_AMOUNTS_LUMINA = [300, 500, 1000, 3000] as const;

export const PREMIUM_CHAT_ROOM_DEFAULT_TIER_KEY = 'premium_chat_room_300';
export const PREMIUM_CHAT_ROOM_BASE_DURATION_DAYS = 3;
export const PREMIUM_CHAT_ROOM_MAX_DURATION_DAYS = 10;

export const PREMIUM_CHAT_ROOM_MUTATION_BLOCKED_STATES = [
  'closed',
  'artist_closed',
  'expired',
  'reported',
  'blind',
  'suspended',
  'refund_pending',
  'refunded',
  'admin_review',
] as const;

export const PREMIUM_CHAT_ROOM_REFUND_ACCOUNTING_LEDGER_TYPES = [
  'refund',
  'premium_chat_room_company_revenue',
  'premium_chat_room_artist_compensation',
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
  version: '2026-05-21.premium-chat-room-refund-ledger.v2',
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
        unlockGate: {
          type: 'none',
          serverEvaluated: true,
        },
      },
      {
        tierKey: 'premium_chat_room_500',
        amountLumina: 500,
        unlockGate: {
          type: 'artist_follower_policy',
          policyKey: 'premiumChat.roomUnlock.500',
          serverEvaluated: true,
        },
      },
      {
        tierKey: 'premium_chat_room_1000',
        amountLumina: 1000,
        unlockGate: {
          type: 'artist_follower_policy',
          policyKey: 'premiumChat.roomUnlock.1000',
          serverEvaluated: true,
        },
      },
      {
        tierKey: 'premium_chat_room_3000',
        amountLumina: 3000,
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
      conflictMessageKey: 'chat.premiumRoom.idempotencyConflict',
      requestFingerprintFields: ['artistId', 'tierKey', 'amountLumina'],
      walletLedgerKeyPattern:
        'premium-chat-room-open:<artistId>:<client-idempotency-key>',
    },
    ledger: {
      source: 'premium_chat_room_open',
      ledgerType: 'premium_chat_open',
      direction: 'debit',
      referenceType: 'premium_chat_room',
      requiresWalletLedgerTypeMigration: true,
      mutationEnabledByDefault: false,
    },
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
    'suspended',
    'refund_pending',
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
    unansweredAfterHours: {
      hours: 24,
      userRefundBps: 10000,
      ledgerType: 'refund',
      source: 'premium_chat_room_refund',
      idempotency: 'server_room_refund_key',
      messageKey: 'chat.premiumRoom.refund.unanswered24h',
    },
    artistForcedClose: {
      userRefundBps: 10000,
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
          userRefundBps: 7000,
          companyRevenueBps: 2000,
          artistCompensationBps: 1000,
          policyHoldBps: 0,
          resultingStatus: 'refunded',
          ledgerEntries: [
            {
              entryKey: 'user_lumina_refund',
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
          userRefundBps: 5000,
          companyRevenueBps: 4000,
          artistCompensationBps: 1000,
          policyHoldBps: 0,
          resultingStatus: 'refunded',
          ledgerEntries: [
            {
              entryKey: 'user_lumina_refund',
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
    reportProcessingStatus: 'admin_review',
    roomStatusesWhilePending: ['reported', 'blind', 'suspended'],
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
  },
  accessControl: PREMIUM_CHAT_ROOM_ACCESS_CONTROL,
} as const;

export function premiumChatRoomTierByKey(tierKey: string | null | undefined) {
  return (
    PREMIUM_CHAT_ROOM_CONTRACT.roomOpen.tiers.find(
      (tier) => tier.tierKey === tierKey,
    ) ?? null
  );
}

export function resolvePremiumChatRoomOpenPolicy(input: {
  tierKey?: string | null;
  clientSubmittedAmountLumina?: unknown;
  clientSubmittedFollowerCount?: unknown;
} = {}) {
  const tierKey = input.tierKey ?? PREMIUM_CHAT_ROOM_DEFAULT_TIER_KEY;
  const tier = premiumChatRoomTierByKey(tierKey);

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

export function premiumChatRoomAccessForRole(role: PremiumChatRoomAccessRole) {
  return PREMIUM_CHAT_ROOM_ACCESS_CONTROL[role];
}

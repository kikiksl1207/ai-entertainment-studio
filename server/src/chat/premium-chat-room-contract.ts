export const PREMIUM_CHAT_ROOM_OPEN_AMOUNTS_LUMINA = [300, 500, 1000, 3000] as const;

export const PREMIUM_CHAT_ROOM_CONTRACT = {
  version: '2026-05-20.premium-chat-room-ledger.v1',
  feature: 'premium_chat_room',
  status: 'contract_ready_mutation_blocked',
  policy: {
    authRequired: true,
    walletMutationEnabled: false,
    settlementMutationEnabled: false,
    payoutMutationEnabled: false,
    clientSubmittedAmountTrusted: false,
    clientSubmittedBalanceTrusted: false,
    clientSubmittedRefundRateTrusted: false,
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
    baseDays: 3,
    artistExtension: {
      maxAdditionalDays: 10,
      serverEvaluated: true,
      messageKey: 'chat.premiumRoom.extensionLimit',
    },
    clientSubmittedExpiryTrusted: false,
  },
  lifecycleStates: [
    'opened',
    'active',
    'artist_answered',
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
      resultingStatus: 'artist_closed',
      refundPolicyKey: 'none_after_answer_or_expiry',
      artistCompensationEligible: true,
    },
    userFaultClose: {
      resultingStatus: 'refund_pending',
      refundPolicyKey: 'user_fault_partial_refund',
      artistCompensationEligible: true,
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
    userFaultPartialRefund: {
      allowedUserRefundBps: [7000, 5000],
      clientSubmittedRefundRateTrusted: false,
      minArtistCompensationBpsOfGross: 1000,
      compensationSource: 'non_refunded_portion',
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      messageKey: 'chat.premiumRoom.refund.userFaultPartial',
    },
    duplicateRefundProtection: {
      walletLedgerKeyPattern: 'premium-chat-room-refund:<roomId>:<reasonKey>',
      adminDecisionKeyRequired: true,
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
    messageKey: 'chat.premiumRoom.report.processing',
  },
  responsePolicy: {
    stableKeysOnlyForUserFacingCopy: true,
    rawEnumUserCopyAllowed: false,
    labelsOptional: true,
  },
} as const;

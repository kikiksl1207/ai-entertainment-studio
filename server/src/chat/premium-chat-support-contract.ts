import { PREMIUM_CHAT_ROOM_CONTRACT } from './premium-chat-room-contract';

export const PREMIUM_CHAT_DONATION_AMOUNTS_LUMINA = [
  10,
  50,
  100,
  500,
  1000,
  5000,
  10000,
  50000,
] as const;

export const PREMIUM_CHAT_LEDGER_SOURCES = [
  'premium_chat_open',
  'premium_chat_message',
  'premium_chat_donation',
] as const;

export const PREMIUM_CHAT_SUPPORT_CONTRACT = {
  version: '2026-05-20.premium-chat-support.v1',
  feature: 'premium_chat_support',
  status: 'contract_ready_mutation_blocked',
  policy: {
    authRequired: true,
    walletMutationEnabled: false,
    settlementMutationEnabled: false,
    payoutMutationEnabled: false,
    disabledMessageKey: 'chat.donation.contractPending',
    disabledDisplayMessageKo:
      '프리미엄챗 후원은 원장·보안 검증이 끝난 뒤 열릴 예정이에요.',
  },
  endpoints: {
    contract: {
      method: 'GET',
      path: '/api/v1/chat/premium-support-contract',
      authRequired: true,
      walletMutation: false,
    },
    donationPreview: {
      method: 'POST',
      pathTemplate: '/api/v1/chat/sessions/:sessionId/donations/preview',
      status: 'planned',
      enabled: false,
      walletMutation: false,
    },
    donationCreate: {
      method: 'POST',
      pathTemplate: '/api/v1/chat/sessions/:sessionId/donations',
      status: 'planned',
      enabled: false,
      walletMutation: true,
      requiresIdempotencyKey: true,
    },
    rankings: {
      method: 'GET',
      path: '/api/v1/chat/rankings',
      query: {
        type: ['communication', 'donation', 'like'],
        period: ['daily', 'weekly', 'monthly', 'all'],
        take: { default: 20, max: 50 },
        cursor: 'opaque optional pagination cursor',
      },
      status: 'planned',
      walletMutation: false,
    },
  },
  donation: {
    fixedAmountsLumina: PREMIUM_CHAT_DONATION_AMOUNTS_LUMINA,
    customAmount: {
      supported: true,
      minLumina: 1,
      maxLumina: 50000,
      integerOnly: true,
    },
    message: {
      optional: true,
      maxChars: 200,
    },
    idempotency: {
      required: true,
      acceptedFrom: ['Idempotency-Key header', 'body.idempotencyKey'],
      replayBehavior: 'return_existing_projection_without_second_debit',
      conflictStatus: 409,
      conflictMessageKey: 'chat.donation.idempotencyConflict',
      requestFingerprintFields: ['sessionId', 'amountLumina', 'message'],
      walletLedgerKeyPattern:
        'premium-chat-donation:<sessionId>:<client-idempotency-key>',
    },
    ledger: {
      sources: PREMIUM_CHAT_LEDGER_SOURCES,
      donationSource: 'premium_chat_donation',
      direction: 'debit',
      referenceType: 'premium_chat_donation',
      artistSettlementEligible: true,
      requiresWalletLedgerTypeMigration: true,
    },
    blockedStates: {
      session: ['reported', 'blind', 'suspended', 'refund_pending'],
      donation: ['refunded', 'chargeback_review', 'cancelled'],
      behavior: 'fail_closed_before_wallet_lookup',
      messageKey: 'chat.donation.blockedRoomState',
    },
    highValuePolicy: {
      startsAtLumina: 10000,
      dailyLimitLumina: 50000,
      requiresTrustedAccount: true,
      requiresIdentityVerification: true,
      messageKey: 'chat.donation.identityVerificationRequired',
    },
  },
  room: PREMIUM_CHAT_ROOM_CONTRACT,
  rankings: {
    like: {
      path: '/api/v1/boost-campaigns/:campaignId/rankings',
      includes: ['free_like', 'lumina_boost'],
      excludes: ['premium_chat_donation'],
      note: 'Likes stay in the Lumina Pick/boost ranking lane.',
    },
    communication: {
      path: '/api/v1/chat/rankings?type=communication',
      scoreInputs: [
        'premium_chat_open',
        'premium_chat_message',
        'premium_chat_donation',
        'artist_reply_activity',
      ],
      excludes: ['free_like', 'lumina_boost'],
      refundedOrBlindedRows: 'excluded_or_zero_weight',
    },
    donation: {
      path: '/api/v1/chat/rankings?type=donation',
      scoreInputs: ['premium_chat_donation'],
      amountBasis: 'confirmed_net_lumina',
      excludes: ['free_like', 'lumina_boost', 'premium_chat_open', 'premium_chat_message'],
      refundedOrBlindedRows: 'excluded',
    },
  },
  projections: {
    donationEvent: {
      target: 'chat room system message',
      bodyShape: {
        id: '<donation event id>',
        type: 'premium_chat_donation',
        amountLumina: '<decimal string>',
        senderPublicName: '<safe display name>',
        message: '<optional safe message>',
        createdAt: '<ISO datetime>',
      },
      rawWalletLedgerIdExposed: false,
    },
    rankingItem: {
      id: '<artist id>',
      artistSlug: '<artist slug>',
      displayName: '<artist display name>',
      rankNo: '<number>',
      score: '<decimal string>',
      scoreLabelKey: 'chat.rankings.score.communication|chat.rankings.score.donation',
      viewer: {
        followed: '<boolean when auth context is present>',
      },
    },
  },
} as const;

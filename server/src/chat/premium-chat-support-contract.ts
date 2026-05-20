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

export const PREMIUM_CHAT_RANKING_TYPES = ['communication', 'donation'] as const;
export const PREMIUM_CHAT_RANKING_PERIODS = [
  'daily',
  'weekly',
  'monthly',
  'all',
] as const;

export const PREMIUM_CHAT_SUPPORT_CONTRACT = {
  version: '2026-05-20.premium-chat-support.v3',
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
        type: PREMIUM_CHAT_RANKING_TYPES,
        period: PREMIUM_CHAT_RANKING_PERIODS,
        take: { default: 20, max: 50 },
        cursor: 'opaque optional pagination cursor',
      },
      status: 'planned',
      enabled: false,
      walletMutation: false,
    },
  },
  apiContracts: {
    donationPreview: {
      method: 'POST',
      pathTemplate: '/api/v1/chat/sessions/:sessionId/donations/preview',
      enabled: false,
      authRequired: true,
      walletMutation: false,
      request: {
        params: {
          sessionId: 'uuid owned by the authenticated user',
        },
        body: {
          amountLumina: 'integer string or number',
          message: 'optional string, max 200 chars',
        },
      },
      response: {
        sessionId: '<session id>',
        amountLumina: '<decimal string>',
        wallet: {
          balanceLumina: '<decimal string>',
          afterBalanceLumina: '<decimal string>',
        },
        policy: {
          canDonate: '<boolean>',
          disabledMessageKey: '<message key when blocked>',
          walletMutation: false,
        },
      },
      errorCodes: [
        { status: 401, code: 'auth_required' },
        { status: 400, code: 'invalid_amount' },
        { status: 400, code: 'message_too_long' },
        { status: 403, code: 'session_not_owned' },
        { status: 404, code: 'session_not_found' },
        { status: 409, code: 'blocked_room_state' },
      ],
    },
    donationCreate: {
      method: 'POST',
      pathTemplate: '/api/v1/chat/sessions/:sessionId/donations',
      enabled: false,
      authRequired: true,
      walletMutation: true,
      request: {
        headers: {
          'Idempotency-Key': 'required client-generated key',
        },
        body: {
          amountLumina: 'integer string or number',
          message: 'optional string, max 200 chars',
          idempotencyKey: 'optional fallback when header is unavailable',
        },
      },
      response: {
        order: {
          id: '<premium chat donation order id>',
          status: 'confirmed',
          type: 'premium_chat_donation',
          sessionId: '<session id>',
          artistId: '<artist id>',
          amountLumina: '<decimal string>',
        },
        donation: {
          id: '<donation event id>',
          sessionId: '<session id>',
          amountLumina: '<decimal string>',
          status: 'confirmed',
          createdAt: '<ISO datetime>',
        },
        wallet: {
          balanceLumina: '<decimal string after debit>',
        },
        rankingRefresh: {
          endpoints: [
            '/api/v1/chat/rankings?type=communication',
            '/api/v1/chat/rankings?type=donation',
          ],
        },
      },
      errorCodes: [
        { status: 401, code: 'auth_required' },
        { status: 400, code: 'idempotency_key_required' },
        { status: 400, code: 'invalid_amount' },
        { status: 400, code: 'message_too_long' },
        { status: 402, code: 'insufficient_lumina_balance' },
        { status: 403, code: 'session_not_owned' },
        { status: 403, code: 'identity_verification_required' },
        { status: 404, code: 'session_not_found' },
        { status: 409, code: 'blocked_room_state' },
        { status: 409, code: 'idempotency_conflict' },
      ],
      serverAuthority: {
        balanceSource: 'wallet_account.cached_balance in a DB transaction',
        clientBalanceTrusted: false,
        debitSource: 'server wallet ledger only',
        orderSource: 'server-created premium chat donation order only',
        repeatRequestBehavior:
          'same idempotency key and same fingerprint returns existing projection without a second debit',
        conflictBehavior:
          'same idempotency key with a different fingerprint returns 409 before wallet lookup',
      },
    },
    rankingsList: {
      method: 'GET',
      path: '/api/v1/chat/rankings',
      enabled: false,
      authRequired: true,
      walletMutation: false,
      request: {
        query: {
          type: PREMIUM_CHAT_RANKING_TYPES,
          period: PREMIUM_CHAT_RANKING_PERIODS,
          take: { default: 20, max: 50 },
          cursor: 'opaque optional pagination cursor',
        },
      },
      response: {
        type: '<communication|donation>',
        period: '<daily|weekly|monthly|all>',
        window: {
          startsAt: '<ISO datetime or null for all>',
          endsAt: '<ISO datetime>',
          timezone: 'Asia/Seoul',
        },
        items: ['rankingItem projection'],
        nextCursor: '<opaque cursor or null>',
        generatedAt: '<ISO datetime>',
      },
      errorCodes: [
        { status: 401, code: 'auth_required' },
        { status: 400, code: 'invalid_ranking_type' },
        { status: 400, code: 'invalid_period' },
        { status: 400, code: 'invalid_take' },
      ],
      separation: {
        likeRankingPath: '/api/v1/boost-campaigns/:campaignId/rankings',
        chatRankingTypes: PREMIUM_CHAT_RANKING_TYPES,
        likeRankingExcludedFromChatRankings: true,
        chatDonationsExcludedFromLikeRankings: true,
      },
      privacy: {
        rawChatBodyReturned: false,
        rawReportReasonReturned: false,
        walletLedgerIdReturned: false,
        userIdReturned: false,
        messageIdsReturned: false,
      },
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
  donationOrderLedger: {
    status: 'planned_disabled',
    orderRecord: {
      table: 'premium_chat_donation_orders',
      statusFlow: [
        'pending',
        'confirmed',
        'failed',
        'refunded',
        'chargeback_review',
        'cancelled',
      ],
      immutableFieldsAfterConfirm: [
        'id',
        'userId',
        'artistId',
        'sessionId',
        'amountLumina',
        'idempotencyKey',
      ],
      clientTrustedFields: [],
    },
    ledgerWrite: {
      transactionRequired: true,
      walletBalanceSource: 'wallet_accounts.cached_balance',
      ledgerType: 'premium_chat_donation',
      referenceType: 'premium_chat_donation',
      referenceIdSource: 'premium_chat_donation_orders.id',
      direction: 'debit',
      amountSource: 'server-normalized donation amount',
      idempotencyKeyPattern:
        'premium-chat-donation:<sessionId>:<client-idempotency-key>',
      duplicateReplay: 'return_existing_order_and_projection',
      conflictReplay: '409 before wallet lookup',
    },
    validationOrder: [
      'auth_required',
      'session_exists_and_owned',
      'room_state_allows_support',
      'amount_allowed',
      'message_length_allowed',
      'idempotency_key_valid',
      'idempotency_fingerprint_match_or_empty',
      'wallet_active_and_sufficient',
      'trust_or_identity_gate_for_high_value',
    ],
    noMutationBefore: [
      'auth_required',
      'session_exists_and_owned',
      'room_state_allows_support',
      'amount_allowed',
      'idempotency_key_valid',
    ],
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
      periodWindows: PREMIUM_CHAT_RANKING_PERIODS,
      pagination: {
        cursor: 'opaque cursor from score, rank, artist id, and period window',
        defaultTake: 20,
        maxTake: 50,
      },
      scoreInputs: [
        'premium_chat_open',
        'premium_chat_message',
        'premium_chat_donation',
        'artist_reply_activity',
      ],
      scorePolicy: {
        premiumChatOpen: 'count confirmed opened rooms',
        premiumChatMessage: 'count safe non-blinded message activity',
        premiumChatDonation: 'use confirmed net Lumina contribution as a separate factor',
        artistReplyActivity: 'count safe artist-side replies without raw body exposure',
        formulaStatus: 'planned_weighted_score_server_side_only',
      },
      excludes: ['free_like', 'lumina_boost'],
      moderation: {
        reportedRows: 'excluded_until_admin_safe',
        blindedRows: 'excluded',
        suspendedRooms: 'excluded',
        refundedOrChargebackRows: 'zero_weight_or_excluded',
      },
      privacy: {
        rawChatBodyReturned: false,
        rawReportReasonReturned: false,
        walletLedgerIdReturned: false,
        userIdReturned: false,
        messageIdsReturned: false,
      },
      refundedOrBlindedRows: 'excluded_or_zero_weight',
    },
    donation: {
      path: '/api/v1/chat/rankings?type=donation',
      periodWindows: PREMIUM_CHAT_RANKING_PERIODS,
      pagination: {
        cursor: 'opaque cursor from confirmed net Lumina, rank, artist id, and period window',
        defaultTake: 20,
        maxTake: 50,
      },
      scoreInputs: ['premium_chat_donation'],
      amountBasis: 'confirmed_net_lumina',
      excludes: ['free_like', 'lumina_boost', 'premium_chat_open', 'premium_chat_message'],
      moderation: {
        reportedRows: 'excluded_until_admin_safe',
        blindedRows: 'excluded',
        refundedRows: 'excluded',
        chargebackRows: 'excluded',
      },
      privacy: {
        rawChatBodyReturned: false,
        rawReportReasonReturned: false,
        walletLedgerIdReturned: false,
        userIdReturned: false,
        messageIdsReturned: false,
      },
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

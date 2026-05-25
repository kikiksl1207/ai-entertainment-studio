import {
  PREMIUM_CHAT_REPORT_REFUND_API_STATUS_KEYS,
  PREMIUM_CHAT_ROOM_CONTRACT,
  PREMIUM_CHAT_ROOM_MUTATION_BLOCKED_STATES,
  PREMIUM_CHAT_ROOM_OPEN_AMOUNTS_LUMINA,
} from './premium-chat-room-contract';

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

export const PREMIUM_CHAT_DONATION_CUSTOM_AMOUNT_POLICY = {
  supported: true,
  minLumina: 1,
  maxLumina: 50000,
  integerOnly: true,
} as const;

export const PREMIUM_CHAT_LEDGER_SOURCES = [
  'premium_chat_open',
  'premium_chat_message',
  'premium_chat_donation',
] as const;

export const PREMIUM_CHAT_SUPPORT_POINT_LEDGER_TYPES = [
  'premium_chat_room_open_support_point',
  'premium_chat_message_activity_support_point',
  'premium_chat_donation_support_point',
] as const;

export const PREMIUM_CHAT_CONVERSATION_METER_EVENTS = [
  'user_message_visible',
  'artist_reply_visible',
  'message_blinded',
  'room_suspended',
] as const;

export const PREMIUM_CHAT_RANKING_TYPES = ['communication', 'donation'] as const;
export const PREMIUM_CHAT_RANKING_PERIODS = [
  'daily',
  'weekly',
  'monthly',
  'all',
] as const;

export const PREMIUM_CHAT_DONATION_HISTORY_STATUSES = [
  'confirmed',
  'refunded',
  'chargeback_review',
  'cancelled',
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

export const PREMIUM_CHAT_ROOM_LIST_VISIBLE_STATUSES = [
  'opened',
  'active',
  'artist_answered',
] as const;

export const PREMIUM_CHAT_ROOM_LIST_EXCLUDED_STATUSES = [
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

export const PREMIUM_CHAT_ROOM_INTERACTION_STATUS_MATRIX = {
  opened: {
    readMode: 'safe_conversation',
    userCanSendMessage: true,
    artistCanReply: true,
    canDonate: true,
    messageMeterEligible: true,
    communicationRankingEligible: true,
    donationRankingEligible: true,
    disabledMessageKey: null,
  },
  active: {
    readMode: 'safe_conversation',
    userCanSendMessage: true,
    artistCanReply: true,
    canDonate: true,
    messageMeterEligible: true,
    communicationRankingEligible: true,
    donationRankingEligible: true,
    disabledMessageKey: null,
  },
  artist_answered: {
    readMode: 'safe_conversation',
    userCanSendMessage: true,
    artistCanReply: true,
    canDonate: true,
    messageMeterEligible: true,
    communicationRankingEligible: true,
    donationRankingEligible: true,
    disabledMessageKey: null,
  },
  reported: {
    readMode: 'safe_status_only',
    userCanSendMessage: false,
    artistCanReply: false,
    canDonate: false,
    messageMeterEligible: false,
    communicationRankingEligible: false,
    donationRankingEligible: false,
    disabledMessageKey: 'chat.premiumRoom.report.processing',
  },
  paused_by_report: {
    readMode: 'safe_status_only',
    userCanSendMessage: false,
    artistCanReply: false,
    canDonate: false,
    messageMeterEligible: false,
    communicationRankingEligible: false,
    donationRankingEligible: false,
    disabledMessageKey: 'chat.premiumRoom.report.processing',
  },
  blind: {
    readMode: 'safe_status_only',
    userCanSendMessage: false,
    artistCanReply: false,
    canDonate: false,
    messageMeterEligible: false,
    communicationRankingEligible: false,
    donationRankingEligible: false,
    disabledMessageKey: 'chat.premiumRoom.report.blinded',
  },
  blinded: {
    readMode: 'safe_status_only',
    userCanSendMessage: false,
    artistCanReply: false,
    canDonate: false,
    messageMeterEligible: false,
    communicationRankingEligible: false,
    donationRankingEligible: false,
    disabledMessageKey: 'chat.premiumRoom.report.blinded',
  },
  suspended: {
    readMode: 'safe_status_only',
    userCanSendMessage: false,
    artistCanReply: false,
    canDonate: false,
    messageMeterEligible: false,
    communicationRankingEligible: false,
    donationRankingEligible: false,
    disabledMessageKey: 'chat.premiumRoom.suspended',
  },
  admin_review: {
    readMode: 'safe_status_only',
    userCanSendMessage: false,
    artistCanReply: false,
    canDonate: false,
    messageMeterEligible: false,
    communicationRankingEligible: false,
    donationRankingEligible: false,
    disabledMessageKey: 'chat.premiumRoom.adminReview',
  },
  refund_pending: {
    readMode: 'safe_status_only',
    userCanSendMessage: false,
    artistCanReply: false,
    canDonate: false,
    messageMeterEligible: false,
    communicationRankingEligible: false,
    donationRankingEligible: false,
    disabledMessageKey: 'chat.premiumRoom.refund.pending',
  },
  refund_limited_70: {
    readMode: 'safe_status_only',
    userCanSendMessage: false,
    artistCanReply: false,
    canDonate: false,
    messageMeterEligible: false,
    communicationRankingEligible: false,
    donationRankingEligible: false,
    disabledMessageKey: 'chat.premiumRoom.refund.limited70',
  },
  refund_limited_50: {
    readMode: 'safe_status_only',
    userCanSendMessage: false,
    artistCanReply: false,
    canDonate: false,
    messageMeterEligible: false,
    communicationRankingEligible: false,
    donationRankingEligible: false,
    disabledMessageKey: 'chat.premiumRoom.refund.limited50',
  },
  refunded: {
    readMode: 'safe_archive',
    userCanSendMessage: false,
    artistCanReply: false,
    canDonate: false,
    messageMeterEligible: false,
    communicationRankingEligible: false,
    donationRankingEligible: false,
    disabledMessageKey: 'chat.premiumRoom.refund.completed',
  },
  expired: {
    readMode: 'safe_archive',
    userCanSendMessage: false,
    artistCanReply: false,
    canDonate: false,
    messageMeterEligible: false,
    communicationRankingEligible: false,
    donationRankingEligible: false,
    disabledMessageKey: 'chat.premiumRoom.expired',
  },
  closed: {
    readMode: 'safe_archive',
    userCanSendMessage: false,
    artistCanReply: false,
    canDonate: false,
    messageMeterEligible: false,
    communicationRankingEligible: false,
    donationRankingEligible: false,
    disabledMessageKey: 'chat.premiumRoom.closed',
  },
  artist_closed: {
    readMode: 'safe_archive',
    userCanSendMessage: false,
    artistCanReply: false,
    canDonate: false,
    messageMeterEligible: false,
    communicationRankingEligible: false,
    donationRankingEligible: false,
    disabledMessageKey: 'chat.premiumRoom.closed.artist',
  },
  closed_by_artist: {
    readMode: 'safe_archive',
    userCanSendMessage: false,
    artistCanReply: false,
    canDonate: false,
    messageMeterEligible: false,
    communicationRankingEligible: false,
    donationRankingEligible: false,
    disabledMessageKey: 'chat.premiumRoom.closed.artist',
  },
  closed_by_operator: {
    readMode: 'safe_archive',
    userCanSendMessage: false,
    artistCanReply: false,
    canDonate: false,
    messageMeterEligible: false,
    communicationRankingEligible: false,
    donationRankingEligible: false,
    disabledMessageKey: 'chat.premiumRoom.closed.operator',
  },
} as const;

export const PREMIUM_CHAT_PRODUCT_PROJECTION_CONTRACT = {
  version: '2026-05-25.premium-chat-copy-status-room-tone.v1',
  status: 'contract_ready_mutation_blocked',
  userArtistCopySeparated: true,
  aiAutoReplyCopyAllowed: false,
  rawPromptReturned: false,
  providerPayloadReturned: false,
  rawChatBodyReturned: false,
  internalSettlementFormulaReturned: false,
  internalSettlementRateReturned: false,
  ledgerCalculationReturned: false,
  adminMemoReturned: false,
  serviceTone: {
    language: 'ko-KR',
    style: ['plain_service', 'calm', 'non_technical'],
    forbiddenUiTerms: [
      'provider',
      'prompt',
      'ledger',
      'mutation',
      'projection',
      '원장',
      '정산율',
      '관리자 메모',
      '내부 계산식',
    ],
    aiAutoReplyImplicationAllowed: false,
  },
  roomGuidanceCopy: {
    userVisibleCopy: {
      directArtistReply:
        '이 방은 아티스트가 직접 확인하고 답변하는 프리미엄챗이에요.',
      meterNotice:
        '대화가 오가면 이용량에 따라 루미나가 차감될 수 있어요.',
      unansweredRefundReview:
        '아티스트 답변이 24시간 동안 없으면 환불 검토 대상이 될 수 있어요.',
      reviewPaused:
        '신고 또는 운영 검토 중이라 잠시 대화와 후원이 멈춰 있어요.',
      supportRanking:
        '후원 메시지는 좋아요 순위가 아니라 후원/소통 랭킹에 반영돼요.',
    },
    artistVisibleCopy: {
      directReply:
        '팬이 기다리고 있어요. 직접 답변하면 프리미엄챗 소통이 이어져요.',
      revenueHint:
        '대화와 후원 참여가 늘면 크리에이터 수익에 도움이 될 수 있어요.',
      reviewPaused:
        '운영 검토 중인 방은 답변과 후원이 잠시 제한돼요.',
      supportRanking:
        '후원 메시지는 후원/소통 랭킹 흐름에만 반영돼요.',
    },
    supportMessageCopy: {
      userVisible:
        '응원의 마음을 후원 메시지로 남길 수 있어요. 좋아요 순위와는 별도로 반영돼요.',
      artistVisible:
        '팬의 후원 메시지가 도착했어요. 답변으로 소통을 이어갈 수 있어요.',
    },
  },
  userCopyPolicy: {
    meterNoticeMode: 'summary_only',
    perLineAmountCopyAllowed: false,
    messageKey: 'chat.premiumRoom.meter.userSummary',
  },
  artistCopyPolicy: {
    revenueNoticeMode: 'creator_revenue_hint_only',
    settlementFormulaCopyAllowed: false,
    messageKey: 'chat.premiumRoom.meter.artistRevenueHint',
  },
  unansweredRefundCandidate: {
    trigger: 'no_artist_answer_after_24h',
    roomStatus: 'refund_pending',
    refundPolicyKey: 'unanswered_24h_full_refund',
    refundStateMeaning: 'refund_candidate_pending_server_decision',
    refundCompletedCopyAllowed: false,
    autoRefundCompletedCopyAllowed: false,
    requiresServerRefundDecisionBeforeCredit: true,
    userRefundRatePercent: 100,
    userVisibleCopy: {
      titleKey: 'chat.premiumRoom.unanswered.user.title',
      bodyKey: 'chat.premiumRoom.unanswered.user.body',
      ctaKey: 'chat.premiumRoom.unanswered.user.cta',
    },
    artistVisibleCopy: {
      titleKey: 'chat.premiumRoom.unanswered.artist.title',
      bodyKey: 'chat.premiumRoom.unanswered.artist.body',
      ctaKey: 'chat.premiumRoom.unanswered.artist.cta',
    },
    availabilityAfterProjection:
      PREMIUM_CHAT_ROOM_INTERACTION_STATUS_MATRIX.refund_pending,
  },
  conversationMeterNotice: {
    userVisibleCopy: {
      summaryKey: 'chat.premiumRoom.meter.userSummary',
      detailKey: 'chat.premiumRoom.meter.userDetail',
    },
    artistVisibleCopy: {
      summaryKey: 'chat.premiumRoom.meter.artistSummary',
      detailKey: 'chat.premiumRoom.meter.artistDetail',
    },
    perLineLuminaCopyAllowed: false,
    internalFormulaReturned: false,
    remainingUnitsClientTrusted: false,
  },
  supportMessageProjection: {
    fixedAmountsLumina: PREMIUM_CHAT_DONATION_AMOUNTS_LUMINA,
    customAmount: PREMIUM_CHAT_DONATION_CUSTOM_AMOUNT_POLICY,
    messageMaxChars: 200,
    createsAiReply: false,
    createsChatMessage: false,
    rankingLanes: {
      like: false,
      communication: true,
      donation: true,
    },
    userVisibleCopy: {
      sheetTitleKey: 'chat.donation.sheet.title',
      amountLabelKey: 'chat.donation.amount.label',
      customAmountLabelKey: 'chat.donation.amount.custom',
      messagePlaceholderKey: 'chat.donation.message.placeholder',
      submittedMessageKey: 'chat.donation.message.submitted',
    },
    artistVisibleCopy: {
      receivedTitleKey: 'chat.donation.artist.receivedTitle',
      revenueHintKey: 'chat.donation.artist.revenueHint',
      replyPromptKey: 'chat.donation.artist.replyPrompt',
    },
    privacy: {
      rawSupportMessageReturnedInRankings: false,
      rawSupportMessageLogged: false,
      walletLedgerIdReturned: false,
      supportPointLedgerIdReturned: false,
      adminMemoReturned: false,
    },
  },
  lockedRoomMessages: {
    reported: {
      userVisibleCopy: {
        titleKey: 'chat.premiumRoom.lock.reported.user.title',
        bodyKey: 'chat.premiumRoom.lock.reported.user.body',
      },
      artistVisibleCopy: {
        titleKey: 'chat.premiumRoom.lock.reported.artist.title',
        bodyKey: 'chat.premiumRoom.lock.reported.artist.body',
      },
      availability: PREMIUM_CHAT_ROOM_INTERACTION_STATUS_MATRIX.reported,
    },
    blinded: {
      userVisibleCopy: {
        titleKey: 'chat.premiumRoom.lock.blinded.user.title',
        bodyKey: 'chat.premiumRoom.lock.blinded.user.body',
      },
      artistVisibleCopy: {
        titleKey: 'chat.premiumRoom.lock.blinded.artist.title',
        bodyKey: 'chat.premiumRoom.lock.blinded.artist.body',
      },
      availability: PREMIUM_CHAT_ROOM_INTERACTION_STATUS_MATRIX.blinded,
    },
    suspended: {
      userVisibleCopy: {
        titleKey: 'chat.premiumRoom.lock.suspended.user.title',
        bodyKey: 'chat.premiumRoom.lock.suspended.user.body',
      },
      artistVisibleCopy: {
        titleKey: 'chat.premiumRoom.lock.suspended.artist.title',
        bodyKey: 'chat.premiumRoom.lock.suspended.artist.body',
      },
      availability: PREMIUM_CHAT_ROOM_INTERACTION_STATUS_MATRIX.suspended,
    },
    admin_review: {
      userVisibleCopy: {
        titleKey: 'chat.premiumRoom.lock.adminReview.user.title',
        bodyKey: 'chat.premiumRoom.lock.adminReview.user.body',
      },
      artistVisibleCopy: {
        titleKey: 'chat.premiumRoom.lock.adminReview.artist.title',
        bodyKey: 'chat.premiumRoom.lock.adminReview.artist.body',
      },
      availability: PREMIUM_CHAT_ROOM_INTERACTION_STATUS_MATRIX.admin_review,
    },
    refund_pending: {
      userVisibleCopy: {
        titleKey: 'chat.premiumRoom.lock.refundPending.user.title',
        bodyKey: 'chat.premiumRoom.lock.refundPending.user.body',
      },
      artistVisibleCopy: {
        titleKey: 'chat.premiumRoom.lock.refundPending.artist.title',
        bodyKey: 'chat.premiumRoom.lock.refundPending.artist.body',
      },
      availability: PREMIUM_CHAT_ROOM_INTERACTION_STATUS_MATRIX.refund_pending,
    },
  },
  copyStatusConsistency: {
    unansweredAfter24h: {
      copyIntent: 'refund_candidate_pending_not_completed',
      trigger: 'no_artist_answer_after_24h',
      statusKey: 'refund_pending',
      refundReasonKey: 'unanswered_24h_full_refund',
      userRefundRatePercent: 100,
      refundCompletedCopyAllowed: false,
      autoRefundCompletedCopyAllowed: false,
      requiresServerRefundDecisionBeforeCredit: true,
      availability: PREMIUM_CHAT_ROOM_INTERACTION_STATUS_MATRIX.refund_pending,
      requiredCopyKeys: [
        'chat.premiumRoom.unanswered.user.title',
        'chat.premiumRoom.unanswered.user.body',
        'chat.premiumRoom.unanswered.artist.title',
        'chat.premiumRoom.unanswered.artist.body',
      ],
    },
    userFaultRefundLimit: {
      copyIntent: 'possible_refund_limit_after_server_or_admin_decision',
      copyMustBeConditional: true,
      clientSubmittedRefundRateTrusted: false,
      allowedRefundRatePercents: [70, 50],
      allowedRefundBps: [7000, 5000],
      artistCompensationRatePercent: 10,
      artistCompensationBps: 1000,
      refundRestrictionStatusKeys: ['refund_limited_70', 'refund_limited_50'],
      refundReasonKeys: [
        'user_fault_report_refund_70',
        'operator_sanction_user_fault_refund_50',
      ],
      requiredCopyKeys: [
        'chat.premiumRoom.refund.limited70',
        'chat.premiumRoom.refund.limited50',
      ],
    },
    reportAndReviewPause: {
      copyIntent: 'room_temporarily_paused_during_report_or_admin_review',
      statusKeys: [
        'paused_by_report',
        'reported',
        'blinded',
        'suspended',
        'admin_review',
      ],
      userCanSendMessage: false,
      artistCanReply: false,
      canDonate: false,
      supportPointEligible: false,
      messageMeterEligible: false,
      walletMutationAllowed: false,
      requiredCopyKeys: [
        'chat.premiumRoom.report.processing',
        'chat.premiumRoom.report.blinded',
        'chat.premiumRoom.adminReview',
        'chat.premiumRoom.suspended',
      ],
    },
  },
} as const;

export const PREMIUM_CHAT_SUPPORT_CONTRACT = {
  version: '2026-05-25.premium-chat-room-list-detail-projection.v1',
  previousVersion: '2026-05-25.premium-chat-copy-status-room-tone.v1',
  feature: 'premium_chat_support',
  status: 'contract_ready_mutation_blocked',
  policy: {
    authRequired: true,
    walletMutationEnabled: false,
    settlementMutationEnabled: false,
    payoutMutationEnabled: false,
    supportPointLedgerMutationEnabled: false,
    conversationMeterMutationEnabled: false,
    premiumChatAccountingLedgerMutationEnabled: false,
    productProjectionMutationEnabled: false,
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
    roomList: {
      method: 'GET',
      path: '/api/v1/chat/premium-rooms',
      query: {
        artistSlug: 'optional artist slug',
        status: PREMIUM_CHAT_ROOM_LIST_VISIBLE_STATUSES,
        take: { default: 20, max: 50 },
        cursor: 'opaque optional pagination cursor',
      },
      status: 'planned',
      enabled: false,
      authRequired: false,
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
    myDonationHistory: {
      method: 'GET',
      path: '/api/v1/chat/me/premium-donations',
      query: {
        period: PREMIUM_CHAT_RANKING_PERIODS,
        artistSlug: 'optional artist slug',
        status: PREMIUM_CHAT_DONATION_HISTORY_STATUSES,
        take: { default: 20, max: 50 },
        cursor: 'opaque optional pagination cursor',
      },
      status: 'planned',
      enabled: false,
      authRequired: true,
      walletMutation: false,
    },
    userRoomStatus: {
      method: 'GET',
      pathTemplate: '/api/v1/chat/me/premium-rooms/:roomId/status',
      status: 'planned',
      enabled: false,
      authRequired: true,
      walletMutation: false,
      settlementMutation: false,
      payoutMutation: false,
    },
    artistRoomStatus: {
      method: 'GET',
      pathTemplate:
        '/api/v1/creator-studio/premium-chat/rooms/:roomId/status',
      status: 'planned',
      enabled: false,
      authRequired: true,
      walletMutation: false,
      settlementMutation: false,
      payoutMutation: false,
    },
    reportSubmit: {
      method: 'POST',
      pathTemplate: '/api/v1/chat/premium-rooms/:roomId/reports',
      status: 'planned',
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
      status: 'planned',
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
      status: 'planned',
      enabled: false,
      authRequired: true,
      superAdminOnly: true,
      requiresIdempotencyKey: true,
      walletMutation: false,
      settlementMutation: false,
      payoutMutation: false,
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
  productProjection: PREMIUM_CHAT_PRODUCT_PROJECTION_CONTRACT,
  roomProjection: {
    version: '2026-05-25.premium-chat-room-list-detail-projection.v1',
    status: 'contract_ready_mutation_blocked',
    enabled: false,
    source: 'premium_chat_room_read_model_planned',
    listSurface: {
      projection: 'roomListItem',
      requiredFields: [
        'artist',
        'remainingPeriod',
        'status',
        'lastResponseStatus',
        'donationAvailability',
      ],
      rawStatusAsCopy: false,
      rawEnumCopyReturned: false,
      internalReasonReturned: false,
    },
    detailSurface: {
      projection: 'premiumRoomDetail',
      requiredFields: [
        'userVisibleStatusMessage',
        'artistVisibleStatusMessage',
        'lockState',
        'donationButton',
      ],
      userArtistCopySeparated: true,
      aiAutoReplyCopyAllowed: false,
      internalSettlementRateReturned: false,
      ledgerCalculationReturned: false,
    },
    donationButtonProjection: {
      enabledField: 'enabled',
      disabledReasonKeyField: 'disabledReasonKey',
      disabledMessageKeyField: 'disabledMessageKey',
      rawInternalReasonReturned: false,
      rawEnumCopyReturned: false,
    },
    forbiddenUserCopyTerms: [
      'provider',
      'prompt',
      'ledger',
      'mutation',
      'projection',
      'AI',
      'LLM',
      'auto reply',
    ],
    noMutation: {
      roomOpen: true,
      donationCreate: true,
      walletDebit: true,
      settlement: true,
      payout: true,
    },
  },
  apiContracts: {
    roomList: {
      method: 'GET',
      path: '/api/v1/chat/premium-rooms',
      enabled: false,
      authRequired: false,
      walletMutation: false,
      settlementMutation: false,
      payoutMutation: false,
      request: {
        query: {
          artistSlug: 'optional artist slug',
          status: PREMIUM_CHAT_ROOM_LIST_VISIBLE_STATUSES,
          take: { default: 20, max: 50 },
          cursor: 'opaque optional pagination cursor',
        },
      },
      response: {
        items: ['roomListItem projection'],
        projectionFields: [
          'artist',
          'remainingPeriod',
          'status',
          'lastResponseStatus',
          'donationAvailability',
        ],
        copyPolicy: {
          statusLabelKeyRequired: true,
          disabledMessageKeyRequired: true,
          rawStatusAsCopy: false,
          rawEnumCopyReturned: false,
          internalReasonReturned: false,
        },
        nextCursor: '<opaque cursor or null>',
        generatedAt: '<ISO datetime>',
      },
      tierPolicy: {
        source: 'PREMIUM_CHAT_ROOM_CONTRACT.roomOpen.tiers',
        allowedAmountsLumina: PREMIUM_CHAT_ROOM_OPEN_AMOUNTS_LUMINA,
        clientSubmittedPriceTrusted: false,
        localDisplayPriceAuthoritative: false,
      },
      visibility: {
        visibleStatuses: PREMIUM_CHAT_ROOM_LIST_VISIBLE_STATUSES,
        excludedStatuses: PREMIUM_CHAT_ROOM_LIST_EXCLUDED_STATUSES,
        reportedRooms: 'excluded',
        blindedRooms: 'excluded',
        refundedRooms: 'excluded',
        adminReviewRooms: 'excluded',
      },
      privacy: {
        rawWalletLedgerIdReturned: false,
        rawSupportPointLedgerIdReturned: false,
        rawConversationMeterLedgerIdReturned: false,
        rawAdminNoteReturned: false,
        rawReportReasonReturned: false,
        rawPayloadReturned: false,
        rawChatBodyReturned: false,
        rawUserIdReturned: false,
      },
      errorCodes: [
        { status: 400, code: 'invalid_artist_slug' },
        { status: 400, code: 'invalid_room_status' },
        { status: 400, code: 'invalid_take' },
      ],
    },
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
      publicMutationEnabled: false,
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
          clientSubmittedScoreTrusted: false,
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
        mutationOpenPrerequisites: [
          'premium_chat_donation_orders storage migration',
          'wallet ledger type allowlist migration',
          'room state moderation guard',
          'closed_or_reported_room_fail_closed_guard',
          'refund_restriction_accounting_ledger_contract',
          'idempotency replay projection',
          'ranking read-model refresh worker',
        ],
        repeatRequestBehavior:
          'same idempotency key and same fingerprint returns existing projection without a second debit',
        conflictBehavior:
          'same idempotency key with a different fingerprint returns 409 before wallet lookup',
      },
    },
    myDonationHistory: {
      method: 'GET',
      path: '/api/v1/chat/me/premium-donations',
      enabled: false,
      authRequired: true,
      walletMutation: false,
      settlementMutation: false,
      payoutMutation: false,
      request: {
        query: {
          period: PREMIUM_CHAT_RANKING_PERIODS,
          artistSlug: 'optional artist slug',
          status: PREMIUM_CHAT_DONATION_HISTORY_STATUSES,
          take: { default: 20, max: 50 },
          cursor: 'opaque optional pagination cursor',
        },
      },
      response: {
        items: ['myDonationHistoryItem projection'],
        summary: {
          totalConfirmedLumina: '<decimal string for filtered window>',
          refundedLumina: '<decimal string for filtered window>',
          donationCount: '<number>',
        },
        nextCursor: '<opaque cursor or null>',
        generatedAt: '<ISO datetime>',
      },
      visibility: {
        ownerOnly: true,
        otherUserAccess: '404_or_403_without_identity_leak',
        reportedOrBlindedRoomPolicy:
          'hide raw room/chat content and keep only safe donation status fields',
      },
      privacy: {
        rawWalletLedgerIdReturned: false,
        rawSupportPointLedgerIdReturned: false,
        rawConversationMeterLedgerIdReturned: false,
        rawAdminNoteReturned: false,
        rawReportReasonReturned: false,
        rawPayloadReturned: false,
        rawChatBodyReturned: false,
        counterpartyUserIdReturned: false,
      },
      errorCodes: [
        { status: 401, code: 'auth_required' },
        { status: 400, code: 'invalid_period' },
        { status: 400, code: 'invalid_status' },
        { status: 400, code: 'invalid_take' },
      ],
    },
    userRoomStatus: {
      method: 'GET',
      pathTemplate: '/api/v1/chat/me/premium-rooms/:roomId/status',
      enabled: false,
      authRequired: true,
      walletMutation: false,
      settlementMutation: false,
      payoutMutation: false,
      request: {
        params: {
          roomId: 'uuid owned by the authenticated user',
        },
      },
      response: {
        room: 'premiumRoomStatus projection',
        detail: 'premiumRoomDetail projection',
        refund: 'premiumRoomRefundStatus projection',
        report: 'premiumRoomReportStatus projection',
        mutationAvailability: 'premiumRoomMutationAvailability projection',
        generatedAt: '<ISO datetime>',
      },
      access: {
        ownerUser: {
          allowed: true,
          canSeeRefundStatus: true,
          canSeeReportStatus: true,
          canSeeArtistForceCloseAvailability: false,
        },
        artistOwner: {
          allowed: false,
          useEndpoint:
            '/api/v1/creator-studio/premium-chat/rooms/:roomId/status',
        },
        nonOwner: {
          allowed: false,
          response: '403_or_404_without_identity_leak',
        },
        unauthenticated: {
          allowed: false,
          status: 401,
          code: 'auth_required',
        },
      },
      visibility: {
        allowedStatusKeys: PREMIUM_CHAT_ROOM_STATUS_READ_KEYS,
        statusLabelKeyRequired: true,
        rawStatusAsCopy: false,
        reportedRoomRawReasonReturned: false,
        adminInternalDecisionReturned: false,
      },
      errorCodes: [
        { status: 401, code: 'auth_required' },
        { status: 400, code: 'invalid_room_id' },
        { status: 403, code: 'room_not_owned' },
        { status: 404, code: 'room_not_found' },
      ],
      privacy: {
        rawWalletLedgerIdReturned: false,
        rawSupportPointLedgerIdReturned: false,
        rawConversationMeterLedgerIdReturned: false,
        rawAdminNoteReturned: false,
        rawReportReasonReturned: false,
        rawReporterUserIdReturned: false,
        rawPayloadReturned: false,
        rawChatBodyReturned: false,
        counterpartyUserIdReturned: false,
      },
    },
    artistRoomStatus: {
      method: 'GET',
      pathTemplate:
        '/api/v1/creator-studio/premium-chat/rooms/:roomId/status',
      enabled: false,
      authRequired: true,
      walletMutation: false,
      settlementMutation: false,
      payoutMutation: false,
      request: {
        params: {
          roomId: 'uuid for a premium room opened to the authenticated artist',
        },
      },
      response: {
        room: 'premiumRoomStatus projection',
        detail: 'premiumRoomDetail projection',
        refund: 'premiumRoomRefundStatus projection',
        report: 'premiumRoomReportStatus projection',
        mutationAvailability: 'premiumRoomMutationAvailability projection',
        generatedAt: '<ISO datetime>',
      },
      access: {
        artistOwner: {
          allowed: true,
          canSeeRefundStatus: true,
          canSeeReportPendingFlag: true,
          canSeeForceCloseAvailability: true,
        },
        ownerUser: {
          allowed: false,
          useEndpoint: '/api/v1/chat/me/premium-rooms/:roomId/status',
        },
        nonOwnerArtist: {
          allowed: false,
          response: '403_or_404_without_identity_leak',
        },
        unauthenticated: {
          allowed: false,
          status: 401,
          code: 'auth_required',
        },
      },
      visibility: {
        allowedStatusKeys: PREMIUM_CHAT_ROOM_STATUS_READ_KEYS,
        statusLabelKeyRequired: true,
        rawStatusAsCopy: false,
        reportedRoomRawReasonReturned: false,
        adminInternalDecisionReturned: false,
      },
      errorCodes: [
        { status: 401, code: 'auth_required' },
        { status: 400, code: 'invalid_room_id' },
        { status: 403, code: 'artist_room_not_owned' },
        { status: 404, code: 'room_not_found' },
      ],
      privacy: {
        rawWalletLedgerIdReturned: false,
        rawSupportPointLedgerIdReturned: false,
        rawConversationMeterLedgerIdReturned: false,
        rawAdminNoteReturned: false,
        rawReportReasonReturned: false,
        rawReporterUserIdReturned: false,
        rawPayloadReturned: false,
        rawChatBodyReturned: false,
        userPrivateProfileReturned: false,
      },
    },
    reportSubmit: {
      method: 'POST',
      pathTemplate: '/api/v1/chat/premium-rooms/:roomId/reports',
      enabled: false,
      authRequired: true,
      requiresIdempotencyKey: true,
      walletMutation: false,
      settlementMutation: false,
      payoutMutation: false,
      request: {
        headers: {
          'Idempotency-Key': 'required client-generated key',
        },
        params: {
          roomId: 'uuid owned by the authenticated user',
        },
        body: {
          reasonKey: 'stable report reason key',
          evidenceHash: 'optional safe hash, never raw chat body',
          idempotencyKey: 'optional fallback when header is unavailable',
        },
      },
      response: {
        room: {
          status: {
            key: 'paused_by_report',
            labelKey: 'chat.premiumRoom.report.processing',
          },
          canSendMessage: false,
          canDonate: false,
        },
        report: 'premiumRoomReportStatus projection',
        mutationAvailability: 'premiumRoomMutationAvailability projection',
        idempotentReplay: '<boolean>',
      },
      idempotency:
        PREMIUM_CHAT_ROOM_CONTRACT.reportRefundApi.idempotency,
      projection:
        PREMIUM_CHAT_ROOM_CONTRACT.reportRefundApi.projections.reportSubmitAccepted,
      errorCodes: [
        { status: 401, code: 'auth_required' },
        { status: 400, code: 'invalid_room_id' },
        { status: 400, code: 'idempotency_key_required' },
        { status: 400, code: 'invalid_report_reason' },
        { status: 403, code: 'room_not_owned' },
        { status: 404, code: 'room_not_found' },
        { status: 409, code: 'blocked_room_state' },
        { status: 409, code: 'idempotency_conflict' },
      ],
      privacy: {
        rawChatBodyReturned: false,
        rawReportBodyReturned: false,
        rawReportReasonReturned: false,
        rawReporterUserIdReturned: false,
        rawPayloadReturned: false,
      },
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
      request: {
        headers: {
          'Idempotency-Key': 'required client-generated key',
        },
        params: {
          roomId: 'uuid for a premium room opened to the authenticated artist',
        },
        body: {
          reasonKey: 'artist_forced_close_full_refund',
          idempotencyKey: 'optional fallback when header is unavailable',
        },
      },
      response: {
        room: {
          status: {
            key: 'refund_pending',
            labelKey: 'chat.premiumRoom.refund.artistForcedClose',
          },
        },
        refund: 'premiumRoomRefundStatus projection',
        idempotentReplay: '<boolean>',
      },
      projection:
        PREMIUM_CHAT_ROOM_CONTRACT.reportRefundApi.projections
          .artistForceCloseAccepted,
      errorCodes: [
        { status: 401, code: 'auth_required' },
        { status: 400, code: 'invalid_room_id' },
        { status: 400, code: 'idempotency_key_required' },
        { status: 403, code: 'artist_room_not_owned' },
        { status: 404, code: 'room_not_found' },
        { status: 409, code: 'blocked_room_state' },
        { status: 409, code: 'idempotency_conflict' },
      ],
      privacy: {
        rawChatBodyReturned: false,
        rawAdminNoteReturned: false,
        rawPayloadReturned: false,
        rawWalletLedgerIdReturned: false,
      },
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
      request: {
        headers: {
          'Idempotency-Key': 'required admin-generated key',
        },
        params: {
          roomId: 'uuid for a premium room under admin review',
        },
        body: {
          decisionKey:
            'user_fault_report_refund_70|operator_sanction_user_fault_refund_50|operator_sanction_artist_fault_full_refund',
          idempotencyKey: 'optional fallback when header is unavailable',
        },
      },
      response: {
        room: {
          status: {
            key: 'closed_by_operator',
            labelKey: 'chat.premiumRoom.closed.operator',
          },
        },
        refund: 'premiumRoomRefundStatus projection',
        accounting: 'premiumRoomRefundRestrictionAccounting projection',
        idempotentReplay: '<boolean>',
      },
      projection:
        PREMIUM_CHAT_ROOM_CONTRACT.reportRefundApi.projections
          .operatorCloseAccepted,
      refundOutcomes:
        PREMIUM_CHAT_ROOM_CONTRACT.reportRefundApi.refundOutcomes.filter(
          (outcome) => outcome.actionKey === 'operator_sanction_close',
        ),
      errorCodes: [
        { status: 401, code: 'auth_required' },
        { status: 403, code: 'super_admin_required' },
        { status: 400, code: 'invalid_room_id' },
        { status: 400, code: 'idempotency_key_required' },
        { status: 400, code: 'invalid_operator_decision' },
        { status: 404, code: 'room_not_found' },
        { status: 409, code: 'blocked_room_state' },
        { status: 409, code: 'idempotency_conflict' },
      ],
      privacy: {
        rawChatBodyReturned: false,
        rawReportBodyReturned: false,
        rawAdminNoteReturned: false,
        rawPayloadReturned: false,
        rawWalletLedgerIdReturned: false,
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
      sourceFilters: {
        communication: {
          includes: [
            'confirmed_premium_chat_room_open',
            'safe_visible_premium_chat_message',
            'confirmed_net_premium_chat_donation',
            'safe_artist_reply_activity',
          ],
          excludes: [
            'free_like',
            'lumina_boost',
            'reported_room_rows',
            'blinded_message_rows',
            'refunded_donation_rows',
            'chargeback_donation_rows',
          ],
        },
        donation: {
          includes: ['confirmed_net_premium_chat_donation'],
          excludes: [
            'free_like',
            'lumina_boost',
            'premium_chat_open',
            'premium_chat_message',
            'reported_room_rows',
            'blinded_rows',
            'refunded_donation_rows',
            'chargeback_donation_rows',
            'cancelled_donation_rows',
          ],
        },
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
      ...PREMIUM_CHAT_DONATION_CUSTOM_AMOUNT_POLICY,
    },
    message: {
      optional: true,
      maxChars: 200,
    },
    supportMessageRouting: {
      sourceField: 'donation.message',
      maxChars: 200,
      createsChatMessage: false,
      rawMessageBodyReturnedInRankings: false,
      rawMessageBodyLogged: false,
      rankingLanes: {
        like: false,
        communication: true,
        donation: true,
      },
      allowedRankingTypes: PREMIUM_CHAT_RANKING_TYPES,
      excludedRankingPaths: ['/api/v1/boost-campaigns/:campaignId/rankings'],
      messageKey: 'chat.donation.supportMessage',
    },
    idempotency: {
      required: true,
      acceptedFrom: ['Idempotency-Key header', 'body.idempotencyKey'],
      replayBehavior: 'return_existing_projection_without_second_debit',
      conflictStatus: 409,
      conflictCode: 'PREMIUM_CHAT_DONATION_IDEMPOTENCY_CONFLICT',
      conflictMessageKey: 'chat.donation.idempotencyConflict',
      requestFingerprintFields: ['sessionId', 'amountLumina', 'message'],
      replayRequiresSameFingerprint: true,
      conflictWalletMutation: false,
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
      balanceSource: 'wallet_accounts.cached_balance',
      clientSubmittedBalanceTrusted: false,
      amountSource: 'server-normalized donation amount',
      allowedFixedAmountsLumina: PREMIUM_CHAT_DONATION_AMOUNTS_LUMINA,
      customAmount: PREMIUM_CHAT_DONATION_CUSTOM_AMOUNT_POLICY,
      atomicBalanceGuard: 'cached_balance >= server_amount',
      insufficientBalanceBehavior:
        'return stable insufficient balance error without order, donation event, ledger, or ranking write',
    },
    blockedStates: {
      session: PREMIUM_CHAT_ROOM_MUTATION_BLOCKED_STATES,
      donation: ['refunded', 'chargeback_review', 'cancelled'],
      behavior: 'fail_closed_before_wallet_lookup',
      messageKey: 'chat.donation.blockedRoomState',
    },
    availabilityByRoomStatus: {
      allowed: ['opened', 'active', 'artist_answered'],
      blocked: PREMIUM_CHAT_ROOM_MUTATION_BLOCKED_STATES,
      reportedOrBlindedCanDonate: false,
      suspendedOrRefundPendingCanDonate: false,
      checkOrder: [
        'auth_required',
        'session_exists_and_owned',
        'room_status_allows_support',
        'donation_status_allows_support',
        'amount_allowed',
        'message_length_allowed',
        'idempotency_key_valid',
        'wallet_authority_ready',
      ],
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
      duplicateReplayRequiresSameFingerprint: true,
      conflictReplay: '409 before wallet lookup',
      conflictCode: 'PREMIUM_CHAT_DONATION_IDEMPOTENCY_CONFLICT',
      conflictWalletMutation: false,
      atomicBalanceGuard: 'cached_balance >= server_amount',
      insufficientBalanceBehavior:
        'no premium_chat_donation order/event/ledger/support-point/ranking write',
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
  conversationMetering: {
    version: '2026-05-21.premium-chat-conversation-meter.v1',
    status: 'planned_disabled',
    unit: 'message_activity_unit',
    mutationEnabled: false,
    walletMutation: false,
    settlementMutation: false,
    clientSubmittedMessageCountTrusted: false,
    events: PREMIUM_CHAT_CONVERSATION_METER_EVENTS,
    decrementRules: {
      authority: 'server_visible_message_event',
      idempotencyKeyPattern: 'premium-chat-message-meter:<messageId>',
      duplicateMessageEventBehavior: 'ignore_without_second_decrement',
      blindedOrSuspendedRoomBehavior: 'hold_or_zero_weight_until_admin_safe',
      rawMessageBodyRequired: false,
    },
    ledgerWrite: {
      table: 'premium_chat_conversation_meter_ledger',
      ledgerType: 'premium_chat_message',
      direction: 'debit',
      referenceType: 'chat_message',
      referenceIdSource: 'chat_messages.id',
      requiresStorageMigration: true,
    },
    roomBalance: {
      source: 'premium_chat_rooms.remaining_message_units',
      clientSubmittedRemainingUnitsTrusted: false,
      overuseBehavior: 'fail_closed_before_message_acceptance',
      includedUnitsByTier: 'server_room_policy_only',
    },
  },
  supportPointLedger: {
    version: '2026-05-21.premium-chat-support-point-ledger.v1',
    status: 'planned_disabled',
    table: 'premium_chat_support_point_ledger',
    mutationEnabled: false,
    walletMutation: false,
    luminaWalletShared: false,
    fanEngagementPointLedgerShared: false,
    cashLike: false,
    transferable: false,
    settlementEligible: false,
    payoutEligible: false,
    pointScale: {
      donation: '1 point per confirmed net Lumina',
      roomOpen: 'server weighted room open point',
      messageActivity: 'server weighted visible safe message point',
      clientSubmittedPointTrusted: false,
    },
    ledgerTypes: PREMIUM_CHAT_SUPPORT_POINT_LEDGER_TYPES,
    entries: [
      {
        ledgerType: 'premium_chat_room_open_support_point',
        direction: 'credit',
        referenceType: 'premium_chat_room',
        source: 'confirmed_room_open',
      },
      {
        ledgerType: 'premium_chat_message_activity_support_point',
        direction: 'credit',
        referenceType: 'chat_message',
        source: 'safe_visible_premium_chat_message',
      },
      {
        ledgerType: 'premium_chat_donation_support_point',
        direction: 'credit',
        referenceType: 'premium_chat_donation',
        source: 'confirmed_net_donation',
      },
    ],
    idempotency: {
      uniqueness: ['userId', 'artistId', 'referenceType', 'referenceId', 'ledgerType'],
      duplicateReferenceBehavior: 'return_existing_projection_without_second_point_grant',
      conflictBehavior: '409_before_wallet_or_point_mutation',
    },
    privacy: {
      walletLedgerIdReturned: false,
      rawUserIdReturned: false,
      rawMessageBodyReturned: false,
      rawReportReasonReturned: false,
    },
  },
  room: PREMIUM_CHAT_ROOM_CONTRACT,
  roomList: {
    status: 'planned_disabled',
    endpoint: '/api/v1/chat/premium-rooms',
    visibleStatuses: PREMIUM_CHAT_ROOM_LIST_VISIBLE_STATUSES,
    excludedStatuses: PREMIUM_CHAT_ROOM_LIST_EXCLUDED_STATUSES,
    tierAmountsLumina: PREMIUM_CHAT_ROOM_OPEN_AMOUNTS_LUMINA,
    tierSource: 'room.roomOpen.tiers',
    publicFieldsOnly: true,
    projection: 'roomListItem',
    requiredProjectionFields: [
      'artist',
      'remainingPeriod',
      'status',
      'lastResponseStatus',
      'donationAvailability',
    ],
    copyPolicy: {
      statusLabelKeyRequired: true,
      rawStatusAsCopy: false,
      rawEnumCopyReturned: false,
      internalReasonReturned: false,
    },
    noMutation: {
      roomOpen: true,
      donationCreate: true,
      walletDebit: true,
      settlement: true,
      payout: true,
    },
  },
  roomStatusRead: {
    status: 'planned_disabled',
    userEndpoint: '/api/v1/chat/me/premium-rooms/:roomId/status',
    artistEndpoint: '/api/v1/creator-studio/premium-chat/rooms/:roomId/status',
    responseStatusKeys: PREMIUM_CHAT_ROOM_STATUS_READ_KEYS,
    reportRefundApiStatusKeys: PREMIUM_CHAT_REPORT_REFUND_API_STATUS_KEYS,
    interactionStatusMatrix: PREMIUM_CHAT_ROOM_INTERACTION_STATUS_MATRIX,
    unansweredRefundTransition: {
      trigger: 'no artist answer after 24 hours',
      fromStatuses: ['opened', 'active'],
      toStatus: 'refund_pending',
      refundPolicyKey: 'unanswered_24h_full_refund',
      userRefundBps: 10000,
      afterTransitionAvailability:
        PREMIUM_CHAT_ROOM_INTERACTION_STATUS_MATRIX.refund_pending,
    },
    readOnly: true,
    ownerOnly: true,
    authRequired: true,
    detailProjection: {
      projection: 'premiumRoomDetail',
      userVisibleStatusMessageRequired: true,
      artistVisibleStatusMessageRequired: true,
      lockStateRequired: true,
      donationButtonReasonRequired: true,
      rawStatusAsCopy: false,
      internalReasonReturned: false,
    },
    noMutation: {
      roomOpen: true,
      donationCreate: true,
      messageCreate: true,
      refundCreate: true,
      walletDebit: true,
      walletRefund: true,
      settlement: true,
      payout: true,
    },
    blockedStateMutationPolicy: {
      statuses: PREMIUM_CHAT_ROOM_MUTATION_BLOCKED_STATES,
      supportDisabled: true,
      messageDisabled: true,
      forceCloseMutationDisabledUntilFutureEndpoint: true,
      duplicateRefundBehavior:
        'return_existing_refund_projection_without_second_credit',
      duplicateReportBehavior:
        'return_existing_report_projection_without_second_state_mutation',
    },
    accessMatrix: {
      unauthenticated: {
        allowed: false,
        status: 401,
        code: 'auth_required',
      },
      ownerUser: {
        userEndpoint: true,
        artistEndpoint: false,
        canSeePublicRefundStatus: true,
        canSeeReportProcessingStatus: true,
      },
      artistOwner: {
        userEndpoint: false,
        artistEndpoint: true,
        canSeeReportPendingFlag: true,
        canSeeForceCloseAvailability: true,
      },
      nonOwner: {
        allowed: false,
        response: '403_or_404_without_identity_leak',
      },
    },
  },
  reportRefundApi: PREMIUM_CHAT_ROOM_CONTRACT.reportRefundApi,
  rankings: {
    like: {
      path: '/api/v1/boost-campaigns/:campaignId/rankings',
      includes: ['free_like', 'lumina_boost'],
      excludes: ['premium_chat_donation', 'premium_chat_donation_message'],
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
        'premium_chat_donation_message',
        'artist_reply_activity',
      ],
      scorePolicy: {
        premiumChatOpen: 'count confirmed opened rooms',
        premiumChatMessage: 'count safe non-blinded message activity',
        premiumChatDonation: 'use confirmed net Lumina contribution as a separate factor',
        artistReplyActivity: 'count safe artist-side replies without raw body exposure',
        supportPointLedger:
          'premium_chat_support_point_ledger is the ranking source once storage exists',
        formulaStatus: 'planned_weighted_score_server_side_only',
      },
      sourceLedgerTypes: [
        'premium_chat_room_open_support_point',
        'premium_chat_message_activity_support_point',
        'premium_chat_donation_support_point',
      ],
      excludes: ['free_like', 'lumina_boost'],
      moderation: {
        reportedRows: 'excluded_until_admin_safe',
        blindedRows: 'excluded',
        refundedRows: 'excluded',
        chargebackRows: 'excluded',
        suspendedRooms: 'excluded',
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
      sourceLedgerTypes: ['premium_chat_donation_support_point'],
      amountBasis: 'confirmed_net_lumina',
      supportMessagePolicy:
        'Donation messages may affect only premium chat communication/support projections, never Lumina Pick like rankings.',
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
    apiReadiness: {
      rankingEndpointEnabled: false,
      donationCreateEnabled: false,
      myDonationHistoryEnabled: false,
      scoreRefreshMutationByClient: false,
      frontendSubmitAllowed: false,
    },
  },
  projections: {
    donationEvent: {
      target: 'chat room system message',
      aiAutoReply: false,
      userVisibleCopy: {
        titleKey: 'chat.donation.event.user.title',
        bodyKey: 'chat.donation.event.user.body',
      },
      artistVisibleCopy: {
        titleKey: 'chat.donation.event.artist.title',
        bodyKey: 'chat.donation.event.artist.body',
      },
      bodyShape: {
        id: '<donation event id>',
        type: 'premium_chat_donation',
        amountLumina: '<decimal string>',
        senderPublicName: '<safe display name>',
        message: '<optional safe message>',
        createdAt: '<ISO datetime>',
      },
      rawWalletLedgerIdExposed: false,
      rawChatBodyReturned: false,
      internalSettlementFormulaReturned: false,
      adminMemoReturned: false,
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
      privacy: {
        rawWalletLedgerIdReturned: false,
        rawSupportPointLedgerIdReturned: false,
        rawConversationMeterLedgerIdReturned: false,
        rawChatBodyReturned: false,
        rawReportReasonReturned: false,
        rawUserIdReturned: false,
        messageIdsReturned: false,
      },
    },
    myDonationHistoryItem: {
      donationId: '<premium chat donation public id>',
      sessionId: '<premium chat session id owned by viewer>',
      artist: {
        id: '<artist id>',
        artistSlug: '<artist slug>',
        displayName: '<artist display name>',
        avatarUrl: '<safe public avatar url or null>',
      },
      amountLumina: '<decimal string>',
      status: {
        key: '<confirmed|refunded|chargeback_review|cancelled>',
        labelKey: '<stable Korean-copy key>',
      },
      messagePreview: '<viewer-owned safe support message preview or null>',
      createdAt: '<ISO datetime>',
      privacy: {
        rawWalletLedgerIdReturned: false,
        rawSupportPointLedgerIdReturned: false,
        rawConversationMeterLedgerIdReturned: false,
        rawAdminNoteReturned: false,
        rawReportReasonReturned: false,
        rawPayloadReturned: false,
        rawChatBodyReturned: false,
        counterpartyUserIdReturned: false,
      },
    },
    roomListItem: {
      roomId: '<premium chat room public id>',
      artist: {
        id: '<artist id>',
        artistSlug: '<artist slug>',
        displayName: '<artist display name>',
        avatarUrl: '<safe public avatar url or null>',
      },
      tier: {
        tierKey:
          'premium_chat_room_300|premium_chat_room_500|premium_chat_room_1000|premium_chat_room_3000',
        amountLumina: '<300|500|1000|3000>',
        unlockGate: '<server-evaluated gate summary>',
      },
      status: {
        key: '<opened|active|artist_answered>',
        labelKey: '<stable Korean-copy key>',
      },
      duration: {
        baseDays: 3,
        openedAt: '<ISO datetime>',
        expiresAt: '<ISO datetime>',
      },
      remainingPeriod: {
        daysRemaining: '<non-negative integer>',
        hoursRemaining: '<non-negative integer>',
        expiresAt: '<ISO datetime>',
        labelKey: '<stable Korean-copy key>',
        expired: '<boolean>',
      },
      lastResponseStatus: {
        key: '<not_started|waiting_artist|artist_replied|paused|closed>',
        labelKey: '<stable Korean-copy key>',
        messageKey: '<stable Korean-copy key>',
        rawEnumAsCopy: false,
      },
      donationAvailability: {
        enabled: '<boolean>',
        disabledReasonKey: '<stable public reason key or null>',
        disabledMessageKey: '<stable Korean-copy key or null>',
        internalReasonReturned: false,
        rawEnumAsCopy: false,
      },
      viewer: {
        canOpen: '<boolean when auth context is present>',
        disabledMessageKey: '<message key or null>',
      },
      metrics: {
        supporterCount: '<public count or null>',
        lastActivityAt: '<ISO datetime or null>',
      },
      privacy: {
        rawWalletLedgerIdReturned: false,
        rawSupportPointLedgerIdReturned: false,
        rawConversationMeterLedgerIdReturned: false,
        rawAdminNoteReturned: false,
        rawReportReasonReturned: false,
        rawPayloadReturned: false,
        rawChatBodyReturned: false,
        rawUserIdReturned: false,
      },
      copySafety: {
        rawStatusAsCopy: false,
        rawEnumCopyReturned: false,
        internalReasonReturned: false,
      },
    },
    premiumRoomStatus: {
      roomId: '<premium chat room public id>',
      viewerRole: '<user|artist>',
      artist: {
        id: '<artist id>',
        artistSlug: '<artist slug>',
        displayName: '<artist display name>',
        avatarUrl: '<safe public avatar url or null>',
      },
      tier: {
        tierKey:
          'premium_chat_room_300|premium_chat_room_500|premium_chat_room_1000|premium_chat_room_3000',
        amountLumina: '<300|500|1000|3000>',
      },
      status: {
        key:
          '<active|paused_by_report|reported|blinded|admin_review|refund_pending|refund_limited_70|refund_limited_50|refunded|closed|closed_by_artist|closed_by_operator|expired|suspended>',
        labelKey: '<stable Korean-copy key>',
      },
      userVisibleStatusMessage: {
        titleKey: '<stable Korean-copy key>',
        bodyKey: '<stable Korean-copy key>',
        rawStatusAsCopy: false,
      },
      artistVisibleStatusMessage: {
        titleKey: '<stable Korean-copy key>',
        bodyKey: '<stable Korean-copy key>',
        internalSettlementRateReturned: false,
        ledgerCalculationReturned: false,
      },
      lastResponseStatus: {
        key: '<not_started|waiting_artist|artist_replied|paused|closed>',
        labelKey: '<stable Korean-copy key>',
        messageKey: '<stable Korean-copy key>',
        rawEnumAsCopy: false,
      },
      lockState: {
        locked: '<boolean>',
        reasonKey:
          '<reported|blinded|suspended|admin_review|refund_pending|closed|expired|null>',
        userMessageKey: '<stable Korean-copy key or null>',
        artistMessageKey: '<stable Korean-copy key or null>',
        canSendMessage: '<boolean>',
        canDonate: '<boolean>',
        internalReasonReturned: false,
      },
      duration: {
        openedAt: '<ISO datetime>',
        expiresAt: '<ISO datetime>',
        closedAt: '<ISO datetime or null>',
      },
      privacy: {
        rawWalletLedgerIdReturned: false,
        rawAdminNoteReturned: false,
        rawReportReasonReturned: false,
        rawReporterUserIdReturned: false,
        rawPayloadReturned: false,
        rawChatBodyReturned: false,
      },
    },
    premiumRoomDetail: {
      room: 'premiumRoomStatus projection',
      userVisibleStatusMessage: {
        titleKey: '<stable Korean-copy key>',
        bodyKey: '<stable Korean-copy key>',
        fallbackKey: 'chat.premiumRoom.status.defaultUser',
      },
      artistVisibleStatusMessage: {
        titleKey: '<stable Korean-copy key>',
        bodyKey: '<stable Korean-copy key>',
        fallbackKey: 'chat.premiumRoom.status.defaultArtist',
        internalSettlementRateReturned: false,
        ledgerCalculationReturned: false,
      },
      lockState: {
        locked: '<boolean>',
        reasonKey:
          '<reported|blinded|suspended|admin_review|refund_pending|closed|expired|null>',
        userMessageKey: '<stable Korean-copy key or null>',
        artistMessageKey: '<stable Korean-copy key or null>',
        messageMutationEnabled: false,
        donationMutationEnabled: false,
        walletMutationEnabled: false,
      },
      donationButton: {
        enabled: '<boolean>',
        disabledReasonKey: '<stable public reason key or null>',
        disabledMessageKey: '<stable Korean-copy key or null>',
        internalReasonReturned: false,
        rawEnumAsCopy: false,
      },
      artistActivity: {
        replyActivityVisible: true,
        revenuePossibilityMessageKey: '<stable Korean-copy key or null>',
        internalSettlementRateReturned: false,
        ledgerCalculationReturned: false,
      },
      copySafety: {
        aiAutoReplyCopyAllowed: false,
        rawStatusAsCopy: false,
        rawEnumCopyReturned: false,
        internalReasonReturned: false,
      },
      privacy: {
        rawWalletLedgerIdReturned: false,
        rawSupportPointLedgerIdReturned: false,
        rawConversationMeterLedgerIdReturned: false,
        rawAdminNoteReturned: false,
        rawReportReasonReturned: false,
        rawPayloadReturned: false,
        rawChatBodyReturned: false,
        rawUserIdReturned: false,
      },
    },
    premiumRoomRefundStatus: {
      state:
        '<none|not_eligible|pending|refund_limited_70|refund_limited_50|refunded|admin_review>',
      labelKey: '<stable Korean-copy key>',
      policyKey:
        '<none|unanswered_24h|artist_forced_close_full_refund|user_fault_refund_70|user_fault_refund_50|operator_sanction_review>',
      refundRatePercent: '<100|70|50|null>',
      artistCompensationRatePercent: '<0|10|null>',
      amountLumina: '<decimal string or null>',
      requestedAt: '<ISO datetime or null>',
      resolvedAt: '<ISO datetime or null>',
      duplicateReplay:
        'existing refund projection is returned without a second credit ledger',
      privacy: {
        rawWalletLedgerIdReturned: false,
        providerRefundIdReturned: false,
        internalAdminNoteReturned: false,
      },
    },
    premiumRoomReportStatus: {
      state: '<none|reported|blinded|suspended|admin_review|resolved>',
      labelKey: '<stable Korean-copy key>',
      reportedAt: '<ISO datetime or null>',
      resolvedAt: '<ISO datetime or null>',
      duplicateReplay:
        'existing report projection is returned without a second moderation mutation',
      privacy: {
        rawReportReasonReturned: false,
        rawReporterUserIdReturned: false,
        internalAdminNoteReturned: false,
      },
    },
    premiumRoomMutationAvailability: {
      canSendMessage: '<boolean>',
      canDonate: '<boolean>',
      userVisibleCopy: '<projection copy key object>',
      artistVisibleCopy: '<projection copy key object>',
      donationButton: {
        enabled: '<boolean>',
        disabledReasonKey: '<stable public reason key or null>',
        disabledMessageKey: '<stable Korean-copy key or null>',
        internalReasonReturned: false,
        rawEnumAsCopy: false,
      },
      canArtistForceClose: '<boolean display-only until mutation endpoint exists>',
      canRequestRefund: '<boolean display-only until mutation endpoint exists>',
      disabledMessageKey: '<stable Korean-copy key or null>',
      blockedStatuses: PREMIUM_CHAT_ROOM_MUTATION_BLOCKED_STATES,
      copySafety: {
        aiAutoReplyCopyAllowed: false,
        rawStatusAsCopy: false,
        rawEnumCopyReturned: false,
        internalReasonReturned: false,
      },
      walletMutation: false,
      messageMutation: false,
      donationMutation: false,
      refundMutation: false,
      settlementMutation: false,
      payoutMutation: false,
    },
  },
} as const;

export function resolvePremiumChatDonationAmountPolicy(input: {
  amountLumina: unknown;
}) {
  const amount =
    typeof input.amountLumina === 'number'
      ? input.amountLumina
      : typeof input.amountLumina === 'string'
        ? Number(input.amountLumina)
        : NaN;
  const fixedAmounts = PREMIUM_CHAT_DONATION_AMOUNTS_LUMINA as readonly number[];

  if (!Number.isInteger(amount)) {
    return {
      allowed: false,
      status: 400,
      code: 'PREMIUM_CHAT_DONATION_AMOUNT_INVALID',
      messageKey: 'chat.donation.invalidAmount',
      amountLumina: null,
      walletMutationEnabled: false,
      clientSubmittedBalanceTrusted: false,
    } as const;
  }

  if (
    amount < PREMIUM_CHAT_DONATION_CUSTOM_AMOUNT_POLICY.minLumina ||
    amount > PREMIUM_CHAT_DONATION_CUSTOM_AMOUNT_POLICY.maxLumina
  ) {
    return {
      allowed: false,
      status: 400,
      code: 'PREMIUM_CHAT_DONATION_AMOUNT_OUT_OF_RANGE',
      messageKey: 'chat.donation.amountOutOfRange',
      amountLumina: amount,
      minLumina: PREMIUM_CHAT_DONATION_CUSTOM_AMOUNT_POLICY.minLumina,
      maxLumina: PREMIUM_CHAT_DONATION_CUSTOM_AMOUNT_POLICY.maxLumina,
      walletMutationEnabled: false,
      clientSubmittedBalanceTrusted: false,
    } as const;
  }

  return {
    allowed: true,
    amountLumina: amount,
    amountKind: fixedAmounts.includes(amount) ? 'fixed' : 'custom',
    source: 'server-normalized donation amount',
    walletMutationEnabled: false,
    clientSubmittedBalanceTrusted: false,
    clientSubmittedScoreTrusted: false,
    settlementMutationEnabled: false,
    payoutMutationEnabled: false,
    messageKey: 'chat.donation.amountAccepted',
  } as const;
}

export function resolvePremiumChatRoomInteractionAvailability(status: string) {
  const matrix = PREMIUM_CHAT_ROOM_INTERACTION_STATUS_MATRIX as Record<
    string,
    (typeof PREMIUM_CHAT_ROOM_INTERACTION_STATUS_MATRIX)[keyof typeof PREMIUM_CHAT_ROOM_INTERACTION_STATUS_MATRIX]
  >;

  return (
    matrix[status] ?? {
      readMode: 'safe_status_only',
      userCanSendMessage: false,
      artistCanReply: false,
      canDonate: false,
      messageMeterEligible: false,
      communicationRankingEligible: false,
      donationRankingEligible: false,
      disabledMessageKey: 'chat.premiumRoom.statusUnknown',
    }
  );
}

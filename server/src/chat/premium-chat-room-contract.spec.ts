import {
  PREMIUM_CHAT_ADMIN_REFUND_STATE_KEYS,
  PREMIUM_CHAT_ADMIN_REPORT_REFUND_QUERY_STATUS_KEYS,
  isPremiumChatRoomMutationBlocked,
  PREMIUM_CHAT_BILLING_LEDGER_EVENT_NAMES,
  PREMIUM_CHAT_LEDGER_TRACE_FIELDS,
  PREMIUM_CHAT_REPORT_REFUND_API_ACTION_KEYS,
  PREMIUM_CHAT_REPORT_REFUND_API_STATUS_KEYS,
  PREMIUM_CHAT_REPORT_REVIEW_REASON_KEYS,
  PREMIUM_CHAT_REPORT_REVIEW_STATUS_KEYS,
  PREMIUM_CHAT_REFUND_REASON_KEYS,
  PREMIUM_CHAT_UNANSWERED_REFUND_ELIGIBLE_STATUSES,
  PREMIUM_CHAT_UNANSWERED_REFUND_EXCLUDED_REASON_KEYS,
  PREMIUM_CHAT_ROOM_STATUS_READ_KEYS,
  PREMIUM_CHAT_ROOM_LIFECYCLE_PROJECTION_STATUS_KEYS,
  premiumChatRoomAllowedTierKeysForServerUnlocks,
  premiumChatRoomAccessForRole,
  PREMIUM_CHAT_ROOM_CONTRACT,
  PREMIUM_CHAT_ROOM_MUTATION_BLOCKED_STATES,
  PREMIUM_CHAT_ROOM_REFUND_ACCOUNTING_LEDGER_TYPES,
  resolvePremiumChatRoomFollowerTierUnlocks,
  resolvePremiumChatRoomLifecycleProjection,
  resolvePremiumChatRoomDurationPolicy,
  resolvePremiumChatRoomSchedulerTransition,
  resolvePremiumChatMessageChargePolicy,
  resolvePremiumChatRoomOpenPolicy,
  resolvePremiumChatRoomRefundPolicy,
  resolvePremiumChatRoomUnansweredRefundCandidate,
} from './premium-chat-room-contract';

describe('premium chat room refund and moderation ledger contract', () => {
  it('keeps initial artists on the 300L tier until the server unlocks higher tiers', () => {
    const resolved = resolvePremiumChatRoomOpenPolicy({
      tierKey: 'premium_chat_room_500',
      clientSubmittedAmountLumina: 1,
      clientSubmittedFollowerCount: 99999999,
    });

    expect(premiumChatRoomAllowedTierKeysForServerUnlocks()).toEqual([
      'premium_chat_room_300',
    ]);
    expect(resolved).toMatchObject({
      allowed: false,
      status: 403,
      code: 'PREMIUM_CHAT_ROOM_TIER_LOCKED',
      messageKey: 'chat.premiumRoom.tierLocked',
      tierKey: 'premium_chat_room_500',
      amountLumina: 500,
      maxTierAmountLumina: 3000,
      allowedTierKeys: ['premium_chat_room_300'],
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      clientSubmittedAmountTrusted: false,
      clientSubmittedFollowerCountTrusted: false,
      clientSubmittedFollowerCountIgnored: true,
      publicReason: {
        reasonKey: 'tier_locked',
        messageKey: 'chat.premiumRoom.tierLocked',
        labels: {},
      },
    });
  });

  it('uses server room tier unlocks instead of client-submitted price or follower count', () => {
    const resolved = resolvePremiumChatRoomOpenPolicy({
      tierKey: 'premium_chat_room_500',
      serverUnlockedTierKeys: ['premium_chat_room_500'],
      clientSubmittedAmountLumina: 1,
      clientSubmittedFollowerCount: 99999999,
    });

    expect(resolved).toMatchObject({
      allowed: true,
      tierKey: 'premium_chat_room_500',
      amountLumina: 500,
      maxTierAmountLumina: 3000,
      allowedTierKeys: ['premium_chat_room_300', 'premium_chat_room_500'],
      source: 'server_room_open_tier_policy',
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      clientSubmittedAmountTrusted: false,
      clientSubmittedAmountIgnored: true,
      clientSubmittedAmountMismatch: true,
      clientSubmittedFollowerCountTrusted: false,
      clientSubmittedFollowerCountIgnored: true,
      publicReason: {
        reasonKey: 'open_allowed',
        messageKey: 'chat.premiumRoom.openAllowed',
        labels: {},
      },
    });
    expect(PREMIUM_CHAT_ROOM_CONTRACT.roomOpen.idempotency).toMatchObject({
      required: true,
      conflictStatus: 409,
      conflictCode: 'PREMIUM_CHAT_ROOM_IDEMPOTENCY_CONFLICT',
      replayRequiresSameFingerprint: true,
      conflictWalletMutation: false,
      requestFingerprintFields: ['artistId', 'tierKey', 'amountLumina'],
    });
    expect(PREMIUM_CHAT_ROOM_CONTRACT.roomOpen.ledger).toMatchObject({
      eventName: 'premium_chat.room_open_fee.debit',
      source: 'premium_chat_room_open',
      ledgerType: 'premium_chat_open',
      direction: 'debit',
      balanceSource: 'wallet_accounts.cached_balance',
      clientSubmittedBalanceTrusted: false,
      amountSource: 'server room tier policy',
      atomicBalanceGuard: 'cached_balance >= server_amount',
      insufficientBalanceBehavior:
        'return stable insufficient balance error without room, order, or ledger write',
    });
    expect(PREMIUM_CHAT_ROOM_CONTRACT.billingLedger.roomOpenFee).toMatchObject({
      eventName: 'premium_chat.room_open_fee.debit',
      allowedAmountsLumina: [300, 500, 1000, 3000],
      amountSource: 'server room tier policy',
    });
  });

  it('fixes room open entitlement guard for server tiers and duration before wallet mutation', () => {
    expect(PREMIUM_CHAT_ROOM_CONTRACT.roomOpen.entitlementGuard).toMatchObject({
      version: '2026-06-05.premium-chat-room-open-entitlement-guard.v1',
      defaultTierKey: 'premium_chat_room_300',
      defaultUnlockedTierKeys: ['premium_chat_room_300'],
      allowedAmountsLumina: [300, 500, 1000, 3000],
      maxTierAmountLumina: 3000,
      tierUnlockSource: 'server_unlocked_tier_keys',
      clientSubmittedAmountTrusted: false,
      clientSubmittedFollowerCountTrusted: false,
      clientSubmittedDurationTrusted: false,
      walletBalanceSource: 'wallet_accounts.cached_balance',
      duration: {
        baseDays: 3,
        maxTotalDays: 10,
        artistExtensionMaxAdditionalDays: 7,
        serverCalculatedExpiryAuthoritative: true,
      },
      mutationEnabled: false,
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
    });
    expect(PREMIUM_CHAT_ROOM_CONTRACT.roomOpen.entitlementGuard.validationOrder).toEqual([
      'artist_exists',
      'tier_key_known',
      'tier_unlocked_by_server',
      'server_amount_from_tier',
      'duration_server_clamped',
      'idempotency_fingerprint',
      'wallet_cached_balance_gte_server_amount',
    ]);

    for (const [tierKey, amountLumina] of [
      ['premium_chat_room_300', 300],
      ['premium_chat_room_500', 500],
      ['premium_chat_room_1000', 1000],
      ['premium_chat_room_3000', 3000],
    ] as const) {
      expect(
        resolvePremiumChatRoomOpenPolicy({
          tierKey,
          serverUnlockedTierKeys: [tierKey],
          clientSubmittedAmountLumina: 1,
          clientSubmittedFollowerCount: 99999999,
        }),
      ).toMatchObject({
        allowed: true,
        tierKey,
        amountLumina,
        source: 'server_room_open_tier_policy',
        clientSubmittedAmountTrusted: false,
        clientSubmittedAmountIgnored: true,
        clientSubmittedAmountMismatch: true,
        clientSubmittedFollowerCountTrusted: false,
        clientSubmittedFollowerCountIgnored: true,
        walletMutationEnabled: false,
        settlementMutationEnabled: false,
        payoutMutationEnabled: false,
      });
    }
  });

  it('resolves follower tier unlocks from active server follows only', () => {
    expect(PREMIUM_CHAT_ROOM_CONTRACT.roomOpen.followerTierUnlockContract).toMatchObject({
      version: '2026-06-05.premium-chat-follower-tier-unlock.v1',
      sourceOfTruth: 'artist_follows',
      activeFollowerWhere: {
        status: 'active',
        deletedAt: null,
      },
      thresholds: [
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
      ],
      countIncludesDeletedAccounts: false,
      clientSubmittedFollowerCountTrusted: false,
      cachedFollowerCountTrustedForUnlock: false,
      manualCompanyOverrideEnabled: false,
      multipleRoomAmountsCanBeOffered: true,
      mutationEnabled: false,
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
    });

    expect(resolvePremiumChatRoomFollowerTierUnlocks({ activeFollowerCount: 999 }))
      .toMatchObject({
        unlockedTierKeys: ['premium_chat_room_300'],
      });
    expect(
      resolvePremiumChatRoomFollowerTierUnlocks({
        activeFollowerCount: 1000,
        clientSubmittedFollowerCount: 50000,
      }),
    ).toMatchObject({
      unlockedTierKeys: ['premium_chat_room_300', 'premium_chat_room_500'],
      clientSubmittedFollowerCountTrusted: false,
      clientSubmittedFollowerCountIgnored: true,
      sourceOfTruth: 'artist_follows',
      activeFollowerWhere: {
        status: 'active',
        deletedAt: null,
      },
    });
    expect(resolvePremiumChatRoomFollowerTierUnlocks({ activeFollowerCount: 10000 }))
      .toMatchObject({
        unlockedTierKeys: [
          'premium_chat_room_300',
          'premium_chat_room_500',
          'premium_chat_room_1000',
        ],
      });
    expect(resolvePremiumChatRoomFollowerTierUnlocks({ activeFollowerCount: 50000 }))
      .toMatchObject({
        unlockedTierKeys: [
          'premium_chat_room_300',
          'premium_chat_room_500',
          'premium_chat_room_1000',
          'premium_chat_room_3000',
        ],
        multipleRoomAmountsCanBeOffered: true,
        walletMutationEnabled: false,
      });
  });

  it('publishes a fail-closed follower tier price guard before wallet mutation', () => {
    expect(PREMIUM_CHAT_ROOM_CONTRACT.roomOpen.followerTierPriceGuard).toMatchObject({
      version: '2026-06-08.premium-chat-follower-tier-price-guard.v1',
      baseTierKey: 'premium_chat_room_300',
      baseAmountLumina: 300,
      maxTierAmountLumina: 3000,
      serverCountSource: 'artist_follows.active.non_deleted',
      serverUnlockedTierKeySource: 'server_counted_active_artist_follows',
      allowedTierAmountsLumina: [300, 500, 1000, 3000],
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
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
    });
    expect(
      resolvePremiumChatRoomOpenPolicy({
        tierKey: 'premium_chat_room_3000',
        serverUnlockedTierKeys: ['premium_chat_room_500'],
        clientSubmittedAmountLumina: 3000,
        clientSubmittedFollowerCount: 99999999,
      }),
    ).toMatchObject({
      allowed: false,
      code: 'PREMIUM_CHAT_ROOM_TIER_LOCKED',
      allowedTierKeys: ['premium_chat_room_300', 'premium_chat_room_500'],
      walletMutationEnabled: false,
      clientSubmittedFollowerCountTrusted: false,
      clientSubmittedFollowerCountIgnored: true,
    });
  });

  it('rejects unknown or above-maximum room tiers with a stable message key before wallet mutation', () => {
    const resolved = resolvePremiumChatRoomOpenPolicy({
      tierKey: 'premium_chat_room_5000',
      serverUnlockedTierKeys: ['premium_chat_room_3000', 'premium_chat_room_5000'],
      clientSubmittedAmountLumina: 5000,
    });

    expect(resolved).toMatchObject({
      allowed: false,
      status: 400,
      code: 'PREMIUM_CHAT_ROOM_TIER_INVALID',
      messageKey: 'chat.premiumRoom.invalidTier',
      amountLumina: null,
      walletMutationEnabled: false,
      clientSubmittedAmountTrusted: false,
      allowedTierKeys: ['premium_chat_room_300', 'premium_chat_room_3000'],
      publicReason: {
        reasonKey: 'invalid_tier',
        messageKey: 'chat.premiumRoom.invalidTier',
        labels: {},
      },
    });
  });

  it('caps room duration at a server-authoritative 10-day total', () => {
    const extended = resolvePremiumChatRoomDurationPolicy({
      requestedTotalDays: 99,
    });
    const shortened = resolvePremiumChatRoomDurationPolicy({
      requestedTotalDays: 1,
    });

    expect(PREMIUM_CHAT_ROOM_CONTRACT.duration).toMatchObject({
      baseDays: 3,
      maxTotalDays: 10,
      artistExtension: {
        maxAdditionalDays: 7,
        maxTotalDays: 10,
        serverEvaluated: true,
      },
      clientSubmittedExpiryTrusted: false,
      clientSubmittedDurationTrusted: false,
    });
    expect(extended).toMatchObject({
      baseDays: 3,
      maxTotalDays: 10,
      totalDays: 10,
      capped: true,
      clientSubmittedDurationTrusted: false,
      serverCalculatedExpiryAuthoritative: true,
      messageKey: 'chat.premiumRoom.extensionLimit',
    });
    expect(shortened).toMatchObject({
      totalDays: 3,
      raisedToBase: true,
      clientSubmittedExpiryTrusted: false,
    });
  });

  it('keeps scheduler transitions distinct for 24h unanswered, 3-day expiry, and 10-day extension cap', () => {
    expect(PREMIUM_CHAT_ROOM_CONTRACT.roomLifecycle.schedulerTransition).toMatchObject({
      version: '2026-06-08.premium-chat-room-scheduler-transition.v1',
      schedulerOrAdminJobOnly: true,
      serverClockAuthoritative: true,
      transitionOrder: [
        'skip_terminal_or_report_review_statuses',
        'mark_unanswered_after_24h_as_refund_pending',
        'mark_answered_or_non_refund_candidate_after_expires_at_as_expired',
      ],
      baseDurationDays: 3,
      maxTotalDays: 10,
      maxExtensionAdditionalDays: 7,
      unansweredRefundPrecedesExpiration: true,
      expirationDoesNotCreateRefundCredit: true,
      unansweredCandidateDoesNotCreateRefundCredit: true,
      mutationEnabled: false,
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
    });

    expect(
      resolvePremiumChatRoomSchedulerTransition({
        currentStatus: 'active',
        hoursSinceOpen: 24,
        hasArtistAnswer: false,
        expiresAtElapsed: true,
      }),
    ).toMatchObject({
      transition: true,
      toStatusKey: 'refund_pending',
      actionKey: 'unanswered_24h_refund_candidate',
      reasonKey: 'unanswered_24h_full_refund',
      automaticRefundCredit: false,
      walletMutationEnabled: false,
    });
    expect(
      resolvePremiumChatRoomSchedulerTransition({
        currentStatus: 'artist_answered',
        hoursSinceOpen: 72,
        hasArtistAnswer: true,
        expiresAtElapsed: true,
      }),
    ).toMatchObject({
      transition: true,
      toStatusKey: 'expired',
      actionKey: 'room_expired',
      automaticRefundCredit: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
    });
    expect(
      resolvePremiumChatRoomSchedulerTransition({
        currentStatus: 'reported',
        hoursSinceOpen: 72,
        hasArtistAnswer: false,
        expiresAtElapsed: true,
      }),
    ).toMatchObject({
      transition: false,
      toStatusKey: 'paused_by_report',
      reasonKey: 'terminal_or_review_status_not_scheduler_mutated',
      walletMutationEnabled: false,
    });
  });

  it('fixes room open and expiry as server-authoritative projections without live mutation', () => {
    expect(PREMIUM_CHAT_ROOM_LIFECYCLE_PROJECTION_STATUS_KEYS).toEqual([
      'active',
      'expired',
      'closed',
      'paused_by_report',
      'refund_pending',
      'refunded',
      'closed_by_artist',
      'closed_by_operator',
    ]);
    expect(PREMIUM_CHAT_ROOM_CONTRACT.roomLifecycle).toMatchObject({
      version: '2026-05-25.premium-chat-room-open-expiry.v1',
      mutationEnabled: false,
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      roomOpen: {
        createdStatusKey: 'active',
        defaultTierKey: 'premium_chat_room_300',
        defaultAmountLumina: 300,
        amountSource: 'server room tier policy',
        openedAtSource: 'server_now',
        expiresAtSource: 'server_opened_at_plus_server_duration_days',
        baseDurationDays: 3,
        maxTotalDays: 10,
        clientSubmittedExpiryTrusted: false,
        clientSubmittedDurationTrusted: false,
        clientSubmittedAmountTrusted: false,
      },
      expiration: {
        statusKey: 'expired',
        serverClockAuthoritative: true,
        canSendMessage: false,
        canDonate: false,
        canMeterConversation: false,
        supportPointGrantAllowed: false,
        walletAction: 'none',
        messageKey: 'chat.premiumRoom.expired',
      },
    });
    expect(
      PREMIUM_CHAT_ROOM_CONTRACT.roomLifecycle.roomOpen.duplicateOpenPolicy,
    ).toMatchObject({
      sameIdempotencyFingerprint:
        'return_existing_room_projection_without_second_debit',
      mismatchedIdempotencyFingerprint:
        '409 PREMIUM_CHAT_ROOM_IDEMPOTENCY_CONFLICT before wallet lookup',
      sameUserArtistActiveRoom:
        'return_existing_non_terminal_room_projection_without_second_debit',
    });
    expect(PREMIUM_CHAT_ROOM_CONTRACT.roomLifecycle.roomOpen.storageRequiredBeforeMutation).toEqual([
      'premium_chat_rooms',
      'premium_chat_room_status_events',
      'premium_chat_accounting_ledger',
      'idempotency_replay_projection',
    ]);
  });

  it('keeps expired, closed, and report-paused rooms unable to chat or donate', () => {
    expect(resolvePremiumChatRoomLifecycleProjection('opened')).toMatchObject({
      statusKey: 'active',
      canSendMessage: true,
      canDonate: true,
      canMeterConversation: true,
      supportPointGrantAllowed: true,
      walletMutationEnabled: false,
    });
    expect(resolvePremiumChatRoomLifecycleProjection('expired')).toMatchObject({
      statusKey: 'expired',
      reasonKey: 'room_expired',
      canSendMessage: false,
      canDonate: false,
      canMeterConversation: false,
      supportPointGrantAllowed: false,
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      messageKey: 'chat.premiumRoom.expired',
    });
    expect(resolvePremiumChatRoomLifecycleProjection('closed')).toMatchObject({
      statusKey: 'closed',
      reasonKey: 'room_closed',
      canSendMessage: false,
      canDonate: false,
      messageKey: 'chat.premiumRoom.closed.normal',
    });
    expect(resolvePremiumChatRoomLifecycleProjection('blinded')).toMatchObject({
      normalizedStatus: 'blind',
      statusKey: 'paused_by_report',
      reasonKey: 'admin_review_pending_decision',
      canSendMessage: false,
      canDonate: false,
      messageKey: 'chat.premiumRoom.report.processing',
    });
    expect(resolvePremiumChatRoomLifecycleProjection('refund_limited_70')).toMatchObject({
      statusKey: 'closed_by_operator',
      reasonKey: 'refund_limited_70',
      canSendMessage: false,
      canDonate: false,
      walletMutationEnabled: false,
    });
  });

  it('marks 24h unanswered rooms as refund candidates, not completed refunds', () => {
    const openedCandidate = resolvePremiumChatRoomUnansweredRefundCandidate({
      currentStatus: 'opened',
      hoursSinceOpen: 24,
      hasArtistAnswer: false,
    });
    const candidate = resolvePremiumChatRoomUnansweredRefundCandidate({
      currentStatus: 'active',
      hoursSinceOpen: 24,
      hasArtistAnswer: false,
    });
    const tooEarly = resolvePremiumChatRoomUnansweredRefundCandidate({
      currentStatus: 'active',
      hoursSinceOpen: 23.9,
      hasArtistAnswer: false,
    });
    const answered = resolvePremiumChatRoomUnansweredRefundCandidate({
      currentStatus: 'artist_answered',
      hoursSinceOpen: 48,
      hasArtistAnswer: true,
    });
    const answeredByStatus = resolvePremiumChatRoomUnansweredRefundCandidate({
      currentStatus: 'artist_answered',
      hoursSinceOpen: 48,
      hasArtistAnswer: false,
    });
    const reported = resolvePremiumChatRoomUnansweredRefundCandidate({
      currentStatus: 'reported',
      hoursSinceOpen: 48,
      hasArtistAnswer: false,
    });
    const closed = resolvePremiumChatRoomUnansweredRefundCandidate({
      currentStatus: 'closed',
      hoursSinceOpen: 48,
      hasArtistAnswer: false,
    });
    const duplicate = resolvePremiumChatRoomUnansweredRefundCandidate({
      currentStatus: 'refund_pending',
      hoursSinceOpen: 48,
      hasArtistAnswer: false,
    });

    expect(PREMIUM_CHAT_UNANSWERED_REFUND_ELIGIBLE_STATUSES).toEqual([
      'opened',
      'active',
    ]);
    expect(PREMIUM_CHAT_UNANSWERED_REFUND_EXCLUDED_REASON_KEYS).toEqual([
      'artist_answered',
      'report_or_admin_review_not_unanswered',
      'terminal_status_not_unanswered',
      'not_yet_24h',
    ]);
    expect(PREMIUM_CHAT_ROOM_CONTRACT.roomLifecycle.unansweredRefundCandidate).toMatchObject({
      afterHours: 24,
      eligibleFromStatuses: ['opened', 'active'],
      firstArtistAnswerEvidence: [
        'room.status=artist_answered',
        'first_artist_reply_at_present',
        'hasArtistAnswer=true',
      ],
      excludedReasonKeys: [
        'artist_answered',
        'report_or_admin_review_not_unanswered',
        'terminal_status_not_unanswered',
        'not_yet_24h',
      ],
      statusKey: 'refund_pending',
      actionKey: 'unanswered_24h_refund_candidate',
      reasonKey: 'unanswered_24h_full_refund',
      candidateOnly: true,
      automaticRefundCredit: false,
      finalStatusKeyAfterDecision: 'refunded',
      walletAction: 'server_refund_after_policy_decision_only',
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
    });
    expect(candidate).toMatchObject({
      candidate: true,
      duplicateCandidate: false,
      statusKey: 'refund_pending',
      actionKey: 'unanswered_24h_refund_candidate',
      reasonKey: 'unanswered_24h_full_refund',
      candidateOnly: true,
      automaticRefundCredit: false,
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
    });
    expect(openedCandidate).toMatchObject({
      candidate: true,
      statusKey: 'refund_pending',
      reasonKey: 'unanswered_24h_full_refund',
      automaticRefundCredit: false,
    });
    expect(tooEarly).toMatchObject({
      candidate: false,
      statusKey: 'active',
      reasonKey: 'not_yet_24h',
      thresholdHours: 24,
    });
    expect(answered).toMatchObject({
      candidate: false,
      statusKey: 'active',
      reasonKey: 'artist_answered',
    });
    expect(answeredByStatus).toMatchObject({
      candidate: false,
      statusKey: 'active',
      reasonKey: 'artist_answered',
    });
    expect(reported).toMatchObject({
      candidate: false,
      statusKey: 'paused_by_report',
      reasonKey: 'report_or_admin_review_not_unanswered',
      walletMutationEnabled: false,
    });
    expect(closed).toMatchObject({
      candidate: false,
      statusKey: 'closed',
      reasonKey: 'terminal_status_not_unanswered',
      walletMutationEnabled: false,
    });
    expect(duplicate).toMatchObject({
      candidate: true,
      duplicateCandidate: true,
      statusKey: 'refund_pending',
      automaticRefundCredit: false,
    });
  });

  it('charges visible two-way message pairs as integer Lumina without half-pair debits', () => {
    const resolved = resolvePremiumChatMessageChargePolicy({
      userVisibleSentenceCount: 3,
      artistVisibleSentenceCount: 1,
      clientSubmittedChargeLumina: 99,
    });

    expect(resolved).toMatchObject({
      eventName: 'premium_chat.message_pair.debit',
      source: 'premium_chat_message',
      ledgerType: 'premium_chat_message',
      direction: 'debit',
      unitLumina: 1,
      userVisibleSentenceCount: 3,
      artistVisibleSentenceCount: 1,
      chargeablePairCount: 1,
      chargeLumina: 1,
      unpairedUserSentenceCount: 2,
      unpairedArtistSentenceCount: 0,
      fractionalLuminaAllowed: false,
      halfPairWalletDebitAllowed: false,
      clientSubmittedChargeTrusted: false,
      clientSubmittedChargeMismatch: true,
      walletMutationEnabled: false,
    });
    expect(
      resolvePremiumChatMessageChargePolicy({
        userVisibleSentenceCount: 1,
        artistVisibleSentenceCount: 0,
      }),
    ).toMatchObject({
      chargeablePairCount: 0,
      chargeLumina: 0,
      unpairedUserSentenceCount: 1,
      halfPairWalletDebitAllowed: false,
    });
    expect(PREMIUM_CHAT_ROOM_CONTRACT.billingLedger.messagePairCharge).toMatchObject({
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
      },
    });
  });

  it('keeps normal room close read-only with no refund or settlement mutation', () => {
    const transition = PREMIUM_CHAT_ROOM_CONTRACT.stateTransitions.normalClose;

    expect(transition).toMatchObject({
      to: 'closed',
      walletLedgerEntries: [],
      accountingLedgerEntries: [],
      orderMutation: false,
      settlementMutation: false,
      payoutMutation: false,
      messageKey: 'chat.premiumRoom.closed.normal',
    });
    expect(PREMIUM_CHAT_ROOM_CONTRACT.artistClosure.normalClose).toMatchObject({
      resultingStatus: 'closed',
      legacyStatusAlias: 'artist_closed',
      refundPolicyKey: 'none_after_answer_or_expiry',
      walletAction: 'none',
    });
  });

  it('requires artist forced close to go through server refund policy', () => {
    const transition =
      PREMIUM_CHAT_ROOM_CONTRACT.stateTransitions.artistForcedClose;

    expect(transition).toMatchObject({
      to: 'refund_pending',
      finalStatus: 'refunded',
      refundPolicyKey: 'artist_forced_close_full_refund',
      walletLedgerEntries: ['premium_chat_room_refund'],
      accountingLedgerEntries: [],
      orderMutation: false,
      settlementMutation: false,
      payoutMutation: false,
    });
    expect(PREMIUM_CHAT_ROOM_CONTRACT.refunds.artistForcedClose).toMatchObject({
      reasonKey: 'artist_forced_close_full_refund',
      userRefundBps: 10000,
      eventName: 'premium_chat.room_refund.credit',
      source: 'premium_chat_room_refund',
      ledgerType: 'refund',
      companyRevenueBps: 0,
      artistCompensationBps: 0,
      duplicateRefundProtection: true,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
    });
    expect(PREMIUM_CHAT_ROOM_CONTRACT.refunds.unansweredAfterHours).toMatchObject({
      hours: 24,
      stateKey: 'unanswered_24h_refund_pending',
      publicReasonKey: 'unanswered_24h',
      userRefundBps: 10000,
      messageKey: 'chat.premiumRoom.refund.unanswered24h',
    });
    expect(
      resolvePremiumChatRoomRefundPolicy({
        policyKey: 'artist_forced_close_full_refund',
        clientSubmittedRefundBps: 5000,
        clientSubmittedArtistShareBps: 1000,
      }),
    ).toMatchObject({
      allowed: true,
      userRefundBps: 10000,
      companyRevenueBps: 0,
      artistCompensationBps: 0,
      clientSubmittedRefundRateTrusted: false,
      clientSubmittedArtistShareTrusted: false,
      clientSubmittedRefundRateIgnored: true,
      clientSubmittedArtistShareIgnored: true,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
    });
  });

  it('fixes the 70 percent user-fault refund accounting entries', () => {
    const outcome =
      PREMIUM_CHAT_ROOM_CONTRACT.refunds.userFaultPartialRefund.outcomes.find(
        (candidate) => candidate.outcomeKey === 'user_fault_refund_70',
      );

    expect(outcome).toMatchObject({
      reasonKey: 'user_fault_report_refund_70',
      userRefundBps: 7000,
      companyRevenueBps: 2000,
      artistCompensationBps: 1000,
      policyHoldBps: 0,
      resultingStatus: 'refunded',
    });
    expect(outcome?.ledgerEntries.map((entry) => entry.ledgerType)).toEqual([
      'refund',
      'premium_chat_room_company_revenue',
      'premium_chat_room_artist_compensation',
    ]);
    expect(outcome?.ledgerEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventName: 'premium_chat.room_refund.credit',
          ledgerType: 'refund',
          source: 'premium_chat_room_refund',
          walletLedger: true,
          bps: 7000,
        }),
        expect.objectContaining({
          eventName: 'premium_chat.refund_restriction.company_revenue.credit',
          ledgerType: 'premium_chat_room_company_revenue',
          walletLedger: false,
          settlementMutation: false,
          payoutMutation: false,
          bps: 2000,
        }),
        expect.objectContaining({
          eventName: 'premium_chat.refund_restriction.artist_compensation.credit',
          ledgerType: 'premium_chat_room_artist_compensation',
          walletLedger: false,
          settlementMutation: false,
          payoutMutation: false,
          bps: 1000,
        }),
      ]),
    );
  });

  it('fixes the 50 percent user-fault refund without a policy hold', () => {
    const outcome =
      PREMIUM_CHAT_ROOM_CONTRACT.refunds.userFaultPartialRefund.outcomes.find(
        (candidate) => candidate.outcomeKey === 'user_fault_refund_50',
      );

    expect(outcome).toMatchObject({
      reasonKey: 'operator_sanction_user_fault_refund_50',
      userRefundBps: 5000,
      companyRevenueBps: 4000,
      artistCompensationBps: 1000,
      policyHoldBps: 0,
      resultingStatus: 'refunded',
    });
    expect(outcome?.ledgerEntries.map((entry) => entry.ledgerType)).toEqual([
      'refund',
      'premium_chat_room_company_revenue',
      'premium_chat_room_artist_compensation',
    ]);
    expect(PREMIUM_CHAT_ROOM_REFUND_ACCOUNTING_LEDGER_TYPES).toEqual([
      'refund',
      'premium_chat_room_company_revenue',
      'premium_chat_room_artist_compensation',
    ]);
    expect(
      resolvePremiumChatRoomRefundPolicy({
        policyKey: 'user_fault_refund_50',
        clientSubmittedRefundBps: 10000,
        clientSubmittedArtistShareBps: 5000,
      }),
    ).toMatchObject({
      allowed: true,
      userRefundBps: 5000,
      companyRevenueBps: 4000,
      artistCompensationBps: 1000,
      policyHoldBps: 0,
      clientSubmittedRefundRateTrusted: false,
      clientSubmittedArtistShareTrusted: false,
      clientSubmittedRefundRateIgnored: true,
      clientSubmittedArtistShareIgnored: true,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
    });
  });

  it('keeps user-fault refund restriction ledger entries balanced and separated', () => {
    const outcomes =
      PREMIUM_CHAT_ROOM_CONTRACT.refunds.userFaultPartialRefund.outcomes;

    expect(outcomes).toHaveLength(2);
    for (const outcome of outcomes) {
      const bpsTotal = outcome.ledgerEntries.reduce(
        (total, entry) => total + entry.bps,
        0,
      );
      const walletEntries = outcome.ledgerEntries.filter(
        (entry) => entry.walletLedger,
      );
      const accountingEntries = outcome.ledgerEntries.filter(
        (entry) => !entry.walletLedger,
      );

      expect(bpsTotal).toBe(10000);
      expect(walletEntries).toEqual([
        expect.objectContaining({
          entryKey: 'user_lumina_refund',
          ledger: 'wallet_ledger',
          ledgerType: 'refund',
          source: 'premium_chat_room_refund',
          idempotency: 'server_room_refund_key',
          settlementMutation: false,
          payoutMutation: false,
        }),
      ]);
      expect(accountingEntries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ledgerType: 'premium_chat_room_company_revenue',
            walletLedger: false,
            settlementMutation: false,
            payoutMutation: false,
          }),
          expect.objectContaining({
            ledgerType: 'premium_chat_room_artist_compensation',
            walletLedger: false,
            settlementMutation: false,
            payoutMutation: false,
          }),
        ]),
      );
    }
  });

  it('keeps artist forced close full refund reason separate from user-fault restricted refund reasons', () => {
    const forcedClose = PREMIUM_CHAT_ROOM_CONTRACT.refunds.artistForcedClose;
    const userFaultOutcomes =
      PREMIUM_CHAT_ROOM_CONTRACT.refunds.userFaultPartialRefund.outcomes;
    const userFaultReasonKeys = userFaultOutcomes.map(
      (outcome) => outcome.reasonKey,
    );

    expect(forcedClose.reasonKey).toBe('artist_forced_close_full_refund');
    expect(forcedClose.userRefundBps).toBe(10000);
    expect(forcedClose.companyRevenueBps).toBe(0);
    expect(forcedClose.artistCompensationBps).toBe(0);
    expect(userFaultReasonKeys).toEqual([
      'user_fault_report_refund_70',
      'operator_sanction_user_fault_refund_50',
    ]);
    expect(userFaultReasonKeys).not.toContain(forcedClose.reasonKey);

    for (const outcome of userFaultOutcomes) {
      expect(outcome.userRefundBps).toBeLessThan(10000);
      expect(outcome.artistCompensationBps).toBe(1000);
      expect(outcome.ledgerEntries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'premium_chat_room_refund',
            ledgerType: 'refund',
            walletLedger: true,
          }),
          expect.objectContaining({
            source: 'premium_chat_room_refund_restriction',
            ledgerType: 'premium_chat_room_artist_compensation',
            walletLedger: false,
          }),
        ]),
      );
    }
  });

  it('publishes the server-authoritative refund split ledger contract', () => {
    const splitContract = PREMIUM_CHAT_ROOM_CONTRACT.refunds.splitLedgerContract;

    expect(splitContract).toMatchObject({
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
    });
    expect(splitContract.outcomes).toMatchObject({
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
      },
      userFaultRefund50: {
        reasonKey: 'operator_sanction_user_fault_refund_50',
        refundRestrictionStatusKey: 'refund_limited_50',
        userRefundBps: 5000,
        companyRevenueBps: 4000,
        companyRevenuePercent: 40,
        artistCompensationBps: 1000,
        artistCompensationPercent: 10,
      },
    });
    expect(
      splitContract.outcomes.userFaultRefund70.accountingLedgerEntries,
    ).toEqual(PREMIUM_CHAT_ROOM_REFUND_ACCOUNTING_LEDGER_TYPES.slice(1));
    expect(
      splitContract.outcomes.userFaultRefund50.accountingLedgerEntries,
    ).toEqual(PREMIUM_CHAT_ROOM_REFUND_ACCOUNTING_LEDGER_TYPES.slice(1));
  });

  it('separates refund reason keys and artist compensation split conditions', () => {
    expect(PREMIUM_CHAT_REFUND_REASON_KEYS).toEqual([
      'unanswered_24h_full_refund',
      'artist_forced_close_full_refund',
      'user_fault_report_refund_70',
      'operator_sanction_user_fault_refund_50',
      'operator_sanction_artist_fault_full_refund',
    ]);
    expect(PREMIUM_CHAT_ROOM_CONTRACT.refunds.reasonPolicy).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonKey: 'artist_forced_close_full_refund',
          userRefundBps: 10000,
          artistCompensationBps: 0,
          artistCompensationEligible: false,
        }),
        expect.objectContaining({
          reasonKey: 'user_fault_report_refund_70',
          userRefundBps: 7000,
          companyRevenueBps: 2000,
          artistCompensationBps: 1000,
          artistCompensationEligible: true,
        }),
        expect.objectContaining({
          reasonKey: 'operator_sanction_user_fault_refund_50',
          userRefundBps: 5000,
          companyRevenueBps: 4000,
          artistCompensationBps: 1000,
          artistCompensationEligible: true,
        }),
        expect.objectContaining({
          reasonKey: 'operator_sanction_artist_fault_full_refund',
          userRefundBps: 10000,
          artistCompensationBps: 0,
          artistCompensationEligible: false,
        }),
      ]),
    );
  });

  it('fixes premium chat ledger event names and trace fields across charge refund donation and split flows', () => {
    expect(PREMIUM_CHAT_BILLING_LEDGER_EVENT_NAMES).toEqual([
      'premium_chat.room_open_fee.debit',
      'premium_chat.message_pair.debit',
      'premium_chat.donation.debit',
      'premium_chat.room_refund.credit',
      'premium_chat.refund_restriction.company_revenue.credit',
      'premium_chat.refund_restriction.artist_compensation.credit',
    ]);
    expect(PREMIUM_CHAT_LEDGER_TRACE_FIELDS).toEqual(
      expect.arrayContaining([
        'premiumChatLedgerGroupId',
        'flowType',
        'ledgerEventName',
        'ledgerType',
        'roomId',
        'artistId',
        'grossLumina',
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
      ]),
    );
    expect(PREMIUM_CHAT_ROOM_CONTRACT.billingLedger).toMatchObject({
      mutationEnabled: false,
      walletMutationEnabled: false,
      eventNames: PREMIUM_CHAT_BILLING_LEDGER_EVENT_NAMES,
      flowTypes: ['charge', 'refund', 'donation', 'revenue_split'],
      donation: {
        eventName: 'premium_chat.donation.debit',
        ledgerType: 'premium_chat_donation',
      },
      refundCredit: {
        eventName: 'premium_chat.room_refund.credit',
        duplicateRefundProtection: true,
      },
      sameLedgerTraceability:
        'All premium chat charge, refund, donation, and revenue split rows must share premiumChatLedgerGroupId, roomId, artistId, flowType, ledgerEventName, refundReasonKey when applicable, and revenueSplitBps when applicable.',
    });
  });

  it('fails closed for reported and terminal room states before mutation', () => {
    expect(PREMIUM_CHAT_ROOM_MUTATION_BLOCKED_STATES).toEqual([
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
    ]);
    expect(
      PREMIUM_CHAT_ROOM_MUTATION_BLOCKED_STATES.every((status) =>
        isPremiumChatRoomMutationBlocked(status),
      ),
    ).toBe(true);
    expect(PREMIUM_CHAT_ROOM_CONTRACT.stateTransitions.reportPending).toMatchObject({
      to: 'admin_review',
      interimStatuses: ['reported', 'blind', 'suspended'],
      walletLedgerEntries: [],
      accountingLedgerEntries: [],
      orderMutation: false,
      settlementMutation: false,
      payoutMutation: false,
      messageKey: 'chat.premiumRoom.report.processing',
    });
    expect(PREMIUM_CHAT_ROOM_CONTRACT.mutationGuards).toMatchObject({
      failClosedStates: PREMIUM_CHAT_ROOM_MUTATION_BLOCKED_STATES,
      blockedStateError: {
        status: 409,
        code: 'PREMIUM_CHAT_ROOM_MUTATION_BLOCKED',
        messageKey: 'chat.premiumRoom.blockedState',
      },
    });
  });

  it('fixes premium chat report review and refund limitation status keys', () => {
    expect(PREMIUM_CHAT_REPORT_REVIEW_STATUS_KEYS).toEqual([
      'reported',
      'blinded',
      'admin_review',
      'suspended',
      'refund_limited_70',
      'refund_limited_50',
    ]);
    expect(PREMIUM_CHAT_REPORT_REVIEW_REASON_KEYS).toEqual([
      'user_report_received',
      'room_blinded_pending_admin_review',
      'admin_review_pending_decision',
      'room_suspended_pending_admin_review',
      'user_fault_report_refund_70',
      'operator_sanction_user_fault_refund_50',
    ]);
    expect(PREMIUM_CHAT_ROOM_CONTRACT.moderation).toMatchObject({
      statusKeys: PREMIUM_CHAT_REPORT_REVIEW_STATUS_KEYS,
      reasonKeys: PREMIUM_CHAT_REPORT_REVIEW_REASON_KEYS,
      statusAliases: {
        blinded: 'blind',
      },
      roomStatusesWhilePending: ['reported', 'blinded', 'suspended'],
      visibility: 'blind_until_admin_decision',
      walletActionBeforeAdminDecision: 'none',
    });
    expect(PREMIUM_CHAT_ROOM_CONTRACT.moderation.reviewStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statusKey: 'reported',
          reasonKey: 'user_report_received',
          messageKey: 'chat.premiumRoom.report.reported',
          mutationAllowed: false,
          walletAction: 'none',
        }),
        expect.objectContaining({
          statusKey: 'blinded',
          storageStatusKey: 'blind',
          reasonKey: 'room_blinded_pending_admin_review',
          messageKey: 'chat.premiumRoom.report.blinded',
          mutationAllowed: false,
        }),
        expect.objectContaining({
          statusKey: 'admin_review',
          reasonKey: 'admin_review_pending_decision',
          messageKey: 'chat.premiumRoom.report.adminReview',
          walletAction: 'none',
        }),
        expect.objectContaining({
          statusKey: 'suspended',
          reasonKey: 'room_suspended_pending_admin_review',
          messageKey: 'chat.premiumRoom.report.suspended',
          mutationAllowed: false,
        }),
      ]),
    );
    expect(PREMIUM_CHAT_ROOM_MUTATION_BLOCKED_STATES).toEqual(
      expect.arrayContaining([
        'reported',
        'blind',
        'blinded',
        'admin_review',
        'suspended',
        'refund_limited_70',
        'refund_limited_50',
      ]),
    );
  });

  it('tracks refund limitation split fields for 70 and 50 percent decisions', () => {
    const limited70 =
      PREMIUM_CHAT_ROOM_CONTRACT.moderation.reviewStatuses.find(
        (status) => status.statusKey === 'refund_limited_70',
      );
    const limited50 =
      PREMIUM_CHAT_ROOM_CONTRACT.moderation.reviewStatuses.find(
        (status) => status.statusKey === 'refund_limited_50',
      );

    expect(limited70).toMatchObject({
      statusKey: 'refund_limited_70',
      reasonKey: 'user_fault_report_refund_70',
      refundPolicyKey: 'user_fault_refund_70',
      messageKey: 'chat.premiumRoom.refund.limited70',
      walletAction: 'server_refund_after_admin_decision_only',
      userRefundBps: 7000,
      companyRevenueBps: 2000,
      artistCompensationBps: 1000,
    });
    expect(limited50).toMatchObject({
      statusKey: 'refund_limited_50',
      reasonKey: 'operator_sanction_user_fault_refund_50',
      refundPolicyKey: 'user_fault_refund_50',
      messageKey: 'chat.premiumRoom.refund.limited50',
      walletAction: 'server_refund_after_admin_decision_only',
      userRefundBps: 5000,
      companyRevenueBps: 4000,
      artistCompensationBps: 1000,
    });
    expect(limited70?.splitTraceFields).toEqual(
      expect.arrayContaining([
        'refundRestrictionStatusKey',
        'refundReasonKey',
        'userRefundLumina',
        'companyRevenueLumina',
        'artistCompensationLumina',
        'revenueSplitBps',
        'adminDecisionKeyHash',
      ]),
    );
    expect(
      PREMIUM_CHAT_ROOM_CONTRACT.refunds.userFaultPartialRefund.outcomes,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcomeKey: 'user_fault_refund_70',
          refundRestrictionStatusKey: 'refund_limited_70',
          reasonKey: 'user_fault_report_refund_70',
        }),
        expect.objectContaining({
          outcomeKey: 'user_fault_refund_50',
          refundRestrictionStatusKey: 'refund_limited_50',
          reasonKey: 'operator_sanction_user_fault_refund_50',
        }),
      ]),
    );
    expect(PREMIUM_CHAT_ROOM_CONTRACT.stateTransitions.userFaultRefund70).toMatchObject({
      reviewStatus: 'refund_limited_70',
      settlementMutation: false,
      payoutMutation: false,
    });
    expect(PREMIUM_CHAT_ROOM_CONTRACT.stateTransitions.userFaultRefund50).toMatchObject({
      reviewStatus: 'refund_limited_50',
      settlementMutation: false,
      payoutMutation: false,
    });
  });

  it('keeps report submit paused for admin review without raw body or automatic refund mutation', () => {
    const guard = PREMIUM_CHAT_ROOM_CONTRACT.moderation.reportPauseAuditGuard;

    expect(guard).toMatchObject({
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
    });
    expect(guard.auditFields).toEqual(
      expect.arrayContaining([
        'roomId',
        'reportId',
        'reporterUserId',
        'reportedUserId',
        'roomStatusKey',
        'reportStatusKey',
        'reasonKey',
        'safeEvidenceHash',
        'idempotencyKeyHash',
      ]),
    );
    expect(guard.forbiddenAuditFields).toEqual(
      expect.arrayContaining([
        'rawChatBody',
        'rawConversationBody',
        'rawReportBody',
        'rawReportReason',
        'rawEvidence',
        'token',
        'cookie',
        'password',
        'databaseUrl',
      ]),
    );
    for (const status of ['reported', 'paused_by_report', 'blinded', 'admin_review']) {
      expect(isPremiumChatRoomMutationBlocked(status)).toBe(true);
    }
    expect(PREMIUM_CHAT_ROOM_CONTRACT.reportRefundApi.statusMapping).toMatchObject({
      paused_by_report: {
        canSendMessage: false,
        canDonate: false,
      },
    });
    expect(PREMIUM_CHAT_ROOM_CONTRACT.moderation.reviewStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statusKey: 'reported',
          mutationAllowed: false,
          walletAction: 'none',
        }),
        expect.objectContaining({
          statusKey: 'admin_review',
          mutationAllowed: false,
          walletAction: 'none',
        }),
      ]),
    );
  });

  it('fixes disabled report and refund limitation API status keys', () => {
    expect(PREMIUM_CHAT_REPORT_REFUND_API_STATUS_KEYS).toEqual([
      'active',
      'paused_by_report',
      'refund_pending',
      'refunded',
      'closed_by_artist',
      'closed_by_operator',
    ]);
    expect(PREMIUM_CHAT_REPORT_REFUND_API_ACTION_KEYS).toEqual([
      'report_submit',
      'artist_force_close',
      'operator_sanction_close',
      'unanswered_24h_refund_candidate',
    ]);
    expect(PREMIUM_CHAT_ROOM_CONTRACT.reportRefundApi).toMatchObject({
      status: 'planned_disabled',
      mutationEnabled: false,
      walletMutationEnabled: false,
      pgRefundMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      statusKeys: PREMIUM_CHAT_REPORT_REFUND_API_STATUS_KEYS,
      actionKeys: PREMIUM_CHAT_REPORT_REFUND_API_ACTION_KEYS,
      endpoints: {
        reportSubmit: {
          method: 'POST',
          pathTemplate: '/api/v1/chat/premium-rooms/:roomId/reports',
          enabled: false,
          requiresIdempotencyKey: true,
          walletMutation: false,
        },
        artistForceClose: {
          method: 'POST',
          enabled: false,
          requiresIdempotencyKey: true,
          walletMutation: false,
        },
        operatorClose: {
          method: 'POST',
          enabled: false,
          superAdminOnly: true,
          requiresIdempotencyKey: true,
          walletMutation: false,
        },
      },
    });
    expect(PREMIUM_CHAT_ROOM_CONTRACT.reportRefundApi.statusMapping).toMatchObject({
      paused_by_report: {
        lifecycleStatuses: [
          'reported',
          'blinded',
          'blind',
          'suspended',
          'admin_review',
        ],
        canSendMessage: false,
        canDonate: false,
      },
      closed_by_artist: {
        lifecycleStatuses: ['artist_closed'],
        canDonate: false,
      },
      closed_by_operator: {
        lifecycleStatuses: [
          'closed',
          'refund_limited_70',
          'refund_limited_50',
        ],
        canSendMessage: false,
      },
    });
  });

  it('fixes report/close idempotency and safe projections without raw payloads', () => {
    expect(PREMIUM_CHAT_ROOM_CONTRACT.reportRefundApi.idempotency).toMatchObject({
      acceptedFrom: ['Idempotency-Key header', 'body.idempotencyKey'],
      rawIdempotencyKeyLogged: false,
      conflictStatus: 409,
      conflictCode: 'PREMIUM_CHAT_REPORT_REFUND_IDEMPOTENCY_CONFLICT',
      conflictMessageKey: 'chat.premiumRoom.idempotencyConflict',
      conflictMutation: false,
      requestFingerprintFields: {
        reportSubmit: ['roomId', 'reasonKey', 'safeEvidenceHash'],
        artistForceClose: ['roomId', 'reasonKey'],
        operatorClose: ['roomId', 'decisionKey', 'refundPolicyKey'],
      },
    });
    expect(PREMIUM_CHAT_ROOM_CONTRACT.reportRefundApi.projections).toMatchObject({
      reportSubmitAccepted: {
        actionKey: 'report_submit',
        roomStatusKey: 'paused_by_report',
        reportStatusKey: 'reported',
        nextReviewStatusKeys: ['blinded', 'suspended', 'admin_review'],
        canSendMessage: false,
        canDonate: false,
        rawReportBodyReturned: false,
      },
      artistForceCloseAccepted: {
        actionKey: 'artist_force_close',
        roomStatusKey: 'refund_pending',
        closeStatusKey: 'closed_by_artist',
        refundReasonKey: 'artist_forced_close_full_refund',
      },
      operatorCloseAccepted: {
        actionKey: 'operator_sanction_close',
        roomStatusKey: 'closed_by_operator',
        allowedRefundRestrictionStatusKeys: [
          'refund_limited_70',
          'refund_limited_50',
        ],
      },
      unansweredRefundCandidate: {
        actionKey: 'unanswered_24h_refund_candidate',
        roomStatusKey: 'refund_pending',
        refundReasonKey: 'unanswered_24h_full_refund',
      },
    });
    expect(PREMIUM_CHAT_ROOM_CONTRACT.reportRefundApi.privacy).toMatchObject({
      rawChatBodyLogged: false,
      rawReportBodyReturned: false,
      rawReportReasonReturned: false,
      rawAdminNoteReturned: false,
      tokenCookieSecretDbUrlLogged: false,
    });
  });

  it('defines admin report and refund read-only list/detail projections', () => {
    const adminReadOnly = PREMIUM_CHAT_ROOM_CONTRACT.reportRefundApi.adminReadOnly;

    expect(PREMIUM_CHAT_ADMIN_REPORT_REFUND_QUERY_STATUS_KEYS).toEqual([
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
    ]);
    expect(PREMIUM_CHAT_ADMIN_REFUND_STATE_KEYS).toEqual([
      'none',
      'not_eligible',
      'pending',
      'refund_limited_70',
      'refund_limited_50',
      'refunded',
      'admin_review',
    ]);
    expect(adminReadOnly).toMatchObject({
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
      listProjection: {
        projection: 'premiumRoomAdminReportRefundListItem',
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
        actionAvailability: {
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
        userEmailReturned: false,
        userPhoneReturned: false,
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
    });
    expect(adminReadOnly.statusKeys).toMatchObject({
      room: PREMIUM_CHAT_ROOM_STATUS_READ_KEYS,
      reportReview: PREMIUM_CHAT_REPORT_REVIEW_STATUS_KEYS,
      reportReason: PREMIUM_CHAT_REPORT_REVIEW_REASON_KEYS,
      refund: PREMIUM_CHAT_ADMIN_REFUND_STATE_KEYS,
      query: PREMIUM_CHAT_ADMIN_REPORT_REFUND_QUERY_STATUS_KEYS,
    });
    expect(adminReadOnly.listProjection.fields).toEqual(
      expect.arrayContaining(['replySla']),
    );
    expect(adminReadOnly.detailProjection.replySla).toMatchObject({
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
    });
    expect(adminReadOnly.detailProjection.refundRestrictionMetadata).toMatchObject({
      userFault70: {
        statusKey: 'refund_limited_70',
        refundReasonKey: 'user_fault_report_refund_70',
        userRefundRatePercent: 70,
        artistCompensationRatePercent: 10,
        artistCompensationBps: 1000,
        displayToAdminReadOnly: true,
        walletCreditMutation: false,
      },
      userFault50: {
        statusKey: 'refund_limited_50',
        refundReasonKey: 'operator_sanction_user_fault_refund_50',
        userRefundRatePercent: 50,
        artistCompensationRatePercent: 10,
        artistCompensationBps: 1000,
        displayToAdminReadOnly: true,
        walletCreditMutation: false,
      },
    });
  });

  it('fixes 100/70/50 refund rates and 0/10 artist compensation rates for API outcomes', () => {
    expect(PREMIUM_CHAT_ROOM_CONTRACT.reportRefundApi.refundOutcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionKey: 'unanswered_24h_refund_candidate',
          refundReasonKey: 'unanswered_24h_full_refund',
          refundRatePercent: 100,
          artistCompensationRatePercent: 0,
        }),
        expect.objectContaining({
          actionKey: 'artist_force_close',
          refundReasonKey: 'artist_forced_close_full_refund',
          refundRatePercent: 100,
          artistCompensationRatePercent: 0,
        }),
        expect.objectContaining({
          actionKey: 'operator_sanction_close',
          refundReasonKey: 'user_fault_report_refund_70',
          refundRestrictionStatusKey: 'refund_limited_70',
          refundRatePercent: 70,
          companyRetentionRatePercent: 20,
          artistCompensationRatePercent: 10,
        }),
        expect.objectContaining({
          actionKey: 'operator_sanction_close',
          refundReasonKey: 'operator_sanction_user_fault_refund_50',
          refundRestrictionStatusKey: 'refund_limited_50',
          refundRatePercent: 50,
          companyRetentionRatePercent: 40,
          artistCompensationRatePercent: 10,
        }),
        expect.objectContaining({
          actionKey: 'operator_sanction_close',
          refundReasonKey: 'operator_sanction_artist_fault_full_refund',
          refundRatePercent: 100,
          artistCompensationRatePercent: 0,
        }),
      ]),
    );
    expect(PREMIUM_CHAT_ROOM_CONTRACT.reportRefundApi.noMutationBeforeStorage).toEqual([
      'premium_chat_rooms',
      'premium_chat_room_reports',
      'premium_chat_room_status_events',
      'premium_chat_room_refund_decisions',
      'premium_chat_accounting_ledger',
      'idempotency_replay_projection',
    ]);
  });

  it('fixes premium chat refund audit guard without live mutation', () => {
    const auditGuard = PREMIUM_CHAT_ROOM_CONTRACT.reportRefundApi.auditGuard;

    expect(auditGuard).toMatchObject({
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
      accountingLedgerSeparation: {
        refundCreditLedgerType: 'refund',
        companyRevenueLedgerType: 'premium_chat_room_company_revenue',
        artistCompensationLedgerType: 'premium_chat_room_artist_compensation',
        restrictedRevenueSplitWalletLedger: false,
        settlementMutation: false,
        payoutMutation: false,
      },
    });
    expect(auditGuard.roomPauseRefundAuditChain).toMatchObject({
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
    });
    expect(auditGuard.requiredTraceFields).toEqual(
      expect.arrayContaining([
        'roomId',
        'artistId',
        'actionKey',
        'refundReasonKey',
        'refundRestrictionStatusKey',
        'refundPolicyKey',
        'idempotencyKeyHash',
      ]),
    );
    expect(auditGuard.forbiddenAuditFields).toEqual(
      expect.arrayContaining([
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
      ]),
    );
  });

  it('keeps sensitive values and live mutations out of the contract', () => {
    expect(PREMIUM_CHAT_ROOM_CONTRACT.policy).toMatchObject({
      walletMutationEnabled: false,
      pgRefundMutationEnabled: false,
      premiumChatAccountingLedgerMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      clientSubmittedPriceTrusted: false,
      clientSubmittedDurationTrusted: false,
      clientSubmittedRefundRateTrusted: false,
      clientSubmittedArtistShareTrusted: false,
      clientSubmittedSettlementShareTrusted: false,
    });
    expect(PREMIUM_CHAT_ROOM_CONTRACT.sensitiveDataPolicy).toMatchObject({
      rawChatBodyLogged: false,
      rawReportReasonReturned: false,
      tokenCookieSecretDbUrlLogged: false,
      signedUrlLogged: false,
    });
    expect(PREMIUM_CHAT_ROOM_CONTRACT.responsePolicy).toMatchObject({
      publicReasonOnly: true,
      publicReasonFields: ['reasonKey', 'messageKey', 'labels'],
      blockedPublicFields: expect.arrayContaining([
        'rawAdminNote',
        'rawWalletLedgerId',
        'rawProviderPayload',
        'rawUserEmail',
      ]),
      rawEnumUserCopyAllowed: false,
    });
    const publicResult = resolvePremiumChatRoomOpenPolicy({
      tierKey: 'premium_chat_room_300',
      clientSubmittedFollowerCount: 1,
    });
    const publicPayload = JSON.stringify(publicResult);

    expect(publicPayload).not.toContain('rawAdminNote');
    expect(publicPayload).not.toContain('rawWalletLedgerId');
    expect(publicPayload).not.toContain('rawUserEmail');
  });

  it('keeps user, artist, and non-owner access separated without opening mutations', () => {
    expect(premiumChatRoomAccessForRole('ownerUser')).toMatchObject({
      allowed: true,
      userEndpoint: true,
      artistEndpoint: false,
      canOpenRoom: false,
      canSeePublicRefundStatus: true,
      canSeeReportProcessingStatus: true,
      canSeeArtistForceCloseAvailability: false,
      canForceClose: false,
      canReport: true,
    });
    expect(premiumChatRoomAccessForRole('artistOperator')).toMatchObject({
      allowed: true,
      userEndpoint: false,
      artistEndpoint: true,
      canOpenRoom: false,
      canSeeForceCloseAvailability: true,
      canForceClose: false,
      canReport: false,
    });
    expect(premiumChatRoomAccessForRole('nonOwner')).toMatchObject({
      allowed: false,
      status: 403,
      code: 'PREMIUM_CHAT_ROOM_NOT_OWNED',
      messageKey: 'chat.premiumRoom.notOwned',
      response: '403_or_404_without_identity_leak',
    });
    expect(premiumChatRoomAccessForRole('unauthenticated')).toMatchObject({
      allowed: false,
      status: 401,
      code: 'auth_required',
      response: 'global_auth_mapping',
    });
  });
});

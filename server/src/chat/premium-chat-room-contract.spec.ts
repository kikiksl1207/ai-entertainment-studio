import {
  isPremiumChatRoomMutationBlocked,
  premiumChatRoomAccessForRole,
  PREMIUM_CHAT_ROOM_CONTRACT,
  PREMIUM_CHAT_ROOM_MUTATION_BLOCKED_STATES,
  PREMIUM_CHAT_ROOM_REFUND_ACCOUNTING_LEDGER_TYPES,
  resolvePremiumChatRoomDurationPolicy,
  resolvePremiumChatRoomOpenPolicy,
  resolvePremiumChatRoomRefundPolicy,
} from './premium-chat-room-contract';

describe('premium chat room refund and moderation ledger contract', () => {
  it('uses server room tier policy instead of client-submitted price or follower count', () => {
    const resolved = resolvePremiumChatRoomOpenPolicy({
      tierKey: 'premium_chat_room_500',
      clientSubmittedAmountLumina: 1,
      clientSubmittedFollowerCount: 99999999,
    });

    expect(resolved).toMatchObject({
      allowed: true,
      tierKey: 'premium_chat_room_500',
      amountLumina: 500,
      source: 'server_room_open_tier_policy',
      walletMutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      clientSubmittedAmountTrusted: false,
      clientSubmittedAmountIgnored: true,
      clientSubmittedAmountMismatch: true,
      clientSubmittedFollowerCountTrusted: false,
      clientSubmittedFollowerCountIgnored: true,
    });
  });

  it('rejects unknown room tiers with a stable message key before wallet mutation', () => {
    const resolved = resolvePremiumChatRoomOpenPolicy({
      tierKey: 'premium_chat_room_1',
      clientSubmittedAmountLumina: 1,
    });

    expect(resolved).toMatchObject({
      allowed: false,
      status: 400,
      code: 'PREMIUM_CHAT_ROOM_TIER_INVALID',
      messageKey: 'chat.premiumRoom.invalidTier',
      amountLumina: null,
      walletMutationEnabled: false,
      clientSubmittedAmountTrusted: false,
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
      userRefundBps: 10000,
      source: 'premium_chat_room_refund',
      ledgerType: 'refund',
      companyRevenueBps: 0,
      artistCompensationBps: 0,
      duplicateRefundProtection: true,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
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
          ledgerType: 'refund',
          source: 'premium_chat_room_refund',
          walletLedger: true,
          bps: 7000,
        }),
        expect.objectContaining({
          ledgerType: 'premium_chat_room_company_revenue',
          walletLedger: false,
          settlementMutation: false,
          payoutMutation: false,
          bps: 2000,
        }),
        expect.objectContaining({
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

  it('fails closed for reported and terminal room states before mutation', () => {
    expect(PREMIUM_CHAT_ROOM_MUTATION_BLOCKED_STATES).toEqual([
      'closed',
      'artist_closed',
      'expired',
      'reported',
      'blind',
      'suspended',
      'refund_pending',
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

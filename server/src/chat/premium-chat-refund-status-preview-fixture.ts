import { PREMIUM_CHAT_LIVE_QA_FIXTURE_READINESS } from './premium-chat-support-contract';
import {
  resolvePremiumChatRoomLifecycleProjection,
  resolvePremiumChatRoomRefundPolicy,
  resolvePremiumChatRoomUnansweredRefundCandidate,
} from './premium-chat-room-contract';

const PREVIEW_ENDPOINT =
  '/api/v1/chat/premium-rooms/refund-status-preview-fixture';

const commonNoMutationPolicy = {
  messageMutation: false,
  supportDonationMutation: false,
  walletDebitMutation: false,
  walletCreditMutation: false,
  refundMutation: false,
  settlementMutation: false,
  payoutMutation: false,
  reportMutation: false,
  paymentMutation: false,
} as const;

const commonPrivacyPolicy = {
  rawChatBodyReturned: false,
  rawReportReasonReturned: false,
  rawAdminNoteReturned: false,
  rawWalletLedgerIdReturned: false,
  providerRefundIdReturned: false,
  rawPayloadReturned: false,
  tokenCookieSecretDbUrlReturned: false,
} as const;

const previewAvailabilityByStatus = {
  refund_pending: {
    readMode: 'refund_candidate',
    disabledMessageKey: 'chat.premiumRoom.refund.pending',
  },
  refund_limited_70: {
    readMode: 'safe_archive',
    disabledMessageKey: 'chat.premiumRoom.closed.operator',
  },
  refund_limited_50: {
    readMode: 'safe_archive',
    disabledMessageKey: 'chat.premiumRoom.closed.operator',
  },
} as const;

function statusPreviewItem(input: {
  qaBucket: string;
  roomStatus: string;
  titleKo: string;
  bodyKo: string;
  refundState: string;
  refundReasonKey: string;
  refundRatePercent: number | null;
  artistCompensationRatePercent: number | null;
  candidateOnly?: boolean;
}) {
  const lifecycle = resolvePremiumChatRoomLifecycleProjection(input.roomStatus);
  const availability =
    previewAvailabilityByStatus[
      input.roomStatus as keyof typeof previewAvailabilityByStatus
    ] ?? {
      readMode: 'safe_status_only',
      disabledMessageKey: 'chat.premiumRoom.statusUnknown',
    };

  return {
    qaBucket: input.qaBucket,
    roomId: `qa-preview-${input.qaBucket}`,
    roomStatus: input.roomStatus,
    statusKey: lifecycle.statusKey,
    titleKo: input.titleKo,
    bodyKo: input.bodyKo,
    refundStatus: {
      state: input.refundState,
      reasonKey: input.refundReasonKey,
      refundRatePercent: input.refundRatePercent,
      artistCompensationRatePercent: input.artistCompensationRatePercent,
      candidateOnly: input.candidateOnly ?? false,
      duplicateReplay:
        'existing read-only projection is returned without a second refund, wallet, settlement, or payout mutation',
    },
    lockState: {
      canSendMessage: false,
      canDonate: false,
      readMode: availability.readMode,
      disabledMessageKey: availability.disabledMessageKey,
    },
    copySafety: {
      rawStatusAsCopy: false,
      rawEnumCopyReturned: false,
      internalReasonReturned: false,
    },
    noMutation: commonNoMutationPolicy,
    privacy: commonPrivacyPolicy,
  };
}

export function buildPremiumChatRefundStatusPreviewFixture() {
  const unanswered = resolvePremiumChatRoomUnansweredRefundCandidate({
    currentStatus: 'active',
    hoursSinceOpen: 24,
    hasArtistAnswer: false,
  });
  const limited70 = resolvePremiumChatRoomRefundPolicy({
    policyKey: 'user_fault_refund_70',
  });
  const limited50 = resolvePremiumChatRoomRefundPolicy({
    policyKey: 'user_fault_refund_50',
  });
  const artistForcedClose = resolvePremiumChatRoomRefundPolicy({
    policyKey: 'artist_forced_close_full_refund',
  });
  const artistForcedCloseRefundRatePercent = artistForcedClose.allowed
    ? artistForcedClose.userRefundBps / 100
    : 100;
  const artistForcedCloseCompensationRatePercent = artistForcedClose.allowed
    ? artistForcedClose.artistCompensationBps / 100
    : 0;

  return {
    version: '2026-06-22.premium-chat-refund-status-preview-fixture.v1',
    feature: 'premium_chat_refund_status_preview_fixture',
    status: 'read_only_fixture_ready',
    readOnly: true,
    authRequired: false,
    endpoint: {
      method: 'GET',
      path: PREVIEW_ENDPOINT,
      mounted: true,
    },
    sourceContract: {
      liveQaFixtureReadinessVersion:
        PREMIUM_CHAT_LIVE_QA_FIXTURE_READINESS.version,
      previousBlockers: PREMIUM_CHAT_LIVE_QA_FIXTURE_READINESS.currentBlockers,
    },
    items: [
      statusPreviewItem({
        qaBucket: 'unanswered_24h_refund_candidate',
        roomStatus: unanswered.statusKey,
        titleKo: '24시간 미답변 환불 검토',
        bodyKo:
          '아티스트 답변이 24시간 동안 없어 100% 환불 검토 상태로 전환된 예시입니다.',
        refundState: 'pending',
        refundReasonKey: unanswered.reasonKey,
        refundRatePercent: 100,
        artistCompensationRatePercent: 0,
        candidateOnly: true,
      }),
      statusPreviewItem({
        qaBucket: 'refund_limited_70_artist_10',
        roomStatus: 'refund_limited_70',
        titleKo: '70% 제한 환불',
        bodyKo:
          '유저 귀책 판정으로 70% 환불, 회사 20% 보전, 아티스트 10% 보전이 표시되는 예시입니다.',
        refundState: 'refund_limited_70',
        refundReasonKey: limited70.policyKey,
        refundRatePercent: limited70.allowed ? limited70.userRefundBps / 100 : 70,
        artistCompensationRatePercent:
          limited70.allowed ? limited70.artistCompensationBps / 100 : 10,
      }),
      statusPreviewItem({
        qaBucket: 'refund_limited_50_artist_10',
        roomStatus: 'refund_limited_50',
        titleKo: '50% 제한 환불',
        bodyKo:
          '운영 제재 판정으로 50% 환불, 회사 40% 보전, 아티스트 10% 보전이 표시되는 예시입니다.',
        refundState: 'refund_limited_50',
        refundReasonKey: limited50.policyKey,
        refundRatePercent: limited50.allowed ? limited50.userRefundBps / 100 : 50,
        artistCompensationRatePercent:
          limited50.allowed ? limited50.artistCompensationBps / 100 : 10,
      }),
      statusPreviewItem({
        qaBucket: 'artist_forced_close_full_refund',
        roomStatus: 'refund_pending',
        titleKo: '아티스트 종료 100% 환불',
        bodyKo:
          '아티스트가 방을 종료해 100% 환불 검토로 들어간 예시입니다. 아티스트 10% 보전 예외와 구분됩니다.',
        refundState: 'pending',
        refundReasonKey: artistForcedClose.policyKey,
        refundRatePercent: artistForcedCloseRefundRatePercent,
        artistCompensationRatePercent: artistForcedCloseCompensationRatePercent,
        candidateOnly: true,
      }),
    ],
    noMutation: commonNoMutationPolicy,
    privacy: commonPrivacyPolicy,
  } as const;
}

import {
  ARTIST_URL_KNOWLEDGE_CONTRACT_VERSION,
  buildArtistKnowledgeAuditSnapshot,
  buildArtistKnowledgeChatHandoff,
  isArtistKnowledgeChatEligible,
  normalizeArtistKnowledgeSummary,
  type ArtistKnowledgeChatHandoffCandidate,
} from './artist-url-knowledge-contract';

const PREVIEW_ENDPOINT = '/api/v1/chat/artist-url-knowledge-preview-fixture';

const noMutationPolicy = {
  urlCrawl: false,
  providerTraining: false,
  providerCall: false,
  chatResponseGeneration: false,
  knowledgeUrlCreate: false,
  approvalMutation: false,
  archiveMutation: false,
  walletMutation: false,
  settlementMutation: false,
  payoutMutation: false,
} as const;

const privacyPolicy = {
  rawUrlReturned: false,
  rawUrlQueryReturned: false,
  rawPageBodyReturned: false,
  rawEmailReturned: false,
  tokenCookiePasswordReturned: false,
  providerPayloadReturned: false,
  dbUrlReturned: false,
  adminNoteReturned: false,
  reviewNoteReturned: false,
} as const;

const fixtureRows = [
  {
    id: 'qa-artist-knowledge-pending',
    qaBucket: 'pending_review',
    artistId: 'qa-artist-yoon-serin',
    artistSlug: 'yoon-serin',
    status: 'pending',
    sourceType: 'notice',
    title: '공식 활동 자료 검토 대기',
    summary: '공식 활동 이력 요약은 검토 완료 후 채팅 참고 후보가 됩니다.',
    safetyStatus: 'unreviewed',
    allowChatReference: true,
    labelKo: '검토 대기',
  },
  {
    id: 'qa-artist-knowledge-approved-safe-chat',
    qaBucket: 'approved_safe_chat_candidate',
    artistId: 'qa-artist-yoon-serin',
    artistSlug: 'yoon-serin',
    status: 'approved',
    sourceType: 'notice',
    title: '공식 활동 요약 승인',
    summary:
      '윤세린은 차분한 인터뷰 톤과 팬에게 감사 인사를 자주 전하는 공식 활동 이력이 있습니다.',
    safetyStatus: 'safe',
    allowChatReference: true,
    labelKo: '승인됨',
  },
  {
    id: 'qa-artist-knowledge-rejected',
    qaBucket: 'rejected',
    artistId: 'qa-artist-yoon-serin',
    artistSlug: 'yoon-serin',
    status: 'rejected',
    sourceType: 'blog',
    title: '출처 불명 자료 반려',
    summary: null,
    safetyStatus: 'blocked',
    allowChatReference: false,
    labelKo: '반려됨',
  },
  {
    id: 'qa-artist-knowledge-archived',
    qaBucket: 'archived',
    artistId: 'qa-artist-yoon-serin',
    artistSlug: 'yoon-serin',
    status: 'archived',
    sourceType: 'other',
    title: '만료된 자료 보관',
    summary: null,
    safetyStatus: 'safe',
    allowChatReference: false,
    labelKo: '보관됨',
  },
  {
    id: 'qa-artist-knowledge-approved-chat-off',
    qaBucket: 'approved_chat_reference_disabled',
    artistId: 'qa-artist-yoon-serin',
    artistSlug: 'yoon-serin',
    status: 'approved',
    sourceType: 'instagram',
    title: '채팅 참고 제외 승인 자료',
    summary: '승인은 되었지만 채팅 참고 허용이 꺼진 안전 자료입니다.',
    safetyStatus: 'safe',
    allowChatReference: false,
    labelKo: '승인됨',
  },
  {
    id: 'qa-artist-knowledge-approved-summary-missing',
    qaBucket: 'approved_bounded_summary_missing',
    artistId: 'qa-artist-yoon-serin',
    artistSlug: 'yoon-serin',
    status: 'approved',
    sourceType: 'youtube',
    title: '요약 미완료 승인 자료',
    summary: null,
    safetyStatus: 'safe',
    allowChatReference: true,
    labelKo: '승인됨',
  },
] as const;

function ineligibleReasonKeys(row: ArtistKnowledgeChatHandoffCandidate) {
  const reasons: string[] = [];

  if (row.status !== 'approved') {
    reasons.push('approval_status_not_approved');
  }

  if (row.safetyStatus !== 'safe') {
    reasons.push('safety_status_not_safe');
  }

  if (row.allowChatReference !== true) {
    reasons.push('chat_reference_disabled');
  }

  if (!normalizeArtistKnowledgeSummary(row.summary ?? null)) {
    reasons.push('bounded_summary_missing');
  }

  return reasons;
}

export function buildArtistUrlKnowledgePreviewFixture() {
  return {
    version: '2026-06-22.artist-url-knowledge-preview-fixture.v1',
    contractVersion: ARTIST_URL_KNOWLEDGE_CONTRACT_VERSION,
    feature: 'artist_url_knowledge_preview_fixture',
    status: 'read_only_fixture_ready',
    readOnly: true,
    authRequired: false,
    endpoint: {
      method: 'GET',
      path: PREVIEW_ENDPOINT,
      mounted: true,
    },
    items: fixtureRows.map((row) => {
      const candidate: ArtistKnowledgeChatHandoffCandidate = {
        status: row.status,
        artistSlug: row.artistSlug,
        summary: row.summary,
        safetyStatus: row.safetyStatus,
        allowChatReference: row.allowChatReference,
      };
      const handoff = buildArtistKnowledgeChatHandoff(candidate);
      const eligible = isArtistKnowledgeChatEligible({
        status: row.status,
        allowChatReference: row.allowChatReference,
        summary: row.summary,
        safetyStatus: row.safetyStatus,
      });

      return {
        id: row.id,
        qaBucket: row.qaBucket,
        artistSlug: row.artistSlug,
        status: row.status,
        labelKo: row.labelKo,
        sourceType: row.sourceType,
        title: row.title,
        allowChatReference: row.allowChatReference,
        safetyStatus: row.safetyStatus,
        boundedSummary: normalizeArtistKnowledgeSummary(row.summary),
        chatContextCandidate: {
          eligible,
          handoffReady: handoff?.handoffReady ?? false,
          ineligibleReasonKeys: eligible ? [] : ineligibleReasonKeys(candidate),
          handoff,
        },
        auditSnapshot: buildArtistKnowledgeAuditSnapshot({
          id: row.id,
          artistId: row.artistId,
          status: row.status,
          sourceType: row.sourceType,
          allowChatReference: row.allowChatReference,
          summary: row.summary,
          reviewedAt:
            row.status === 'approved' ? '2026-06-19T00:00:00.000Z' : null,
          archivedAt:
            row.status === 'archived' ? '2026-06-19T00:00:00.000Z' : null,
        }),
        copySafety: {
          rawStatusAsCopy: false,
          rawEnumCopyReturned: false,
          rawUrlAsCopy: false,
        },
        noMutation: noMutationPolicy,
        privacy: privacyPolicy,
      };
    }),
    noMutation: noMutationPolicy,
    privacy: privacyPolicy,
  } as const;
}

export const ARTIST_URL_KNOWLEDGE_CONTRACT_VERSION =
  '2026-05-22.artist-url-knowledge.v1';
export const ARTIST_URL_KNOWLEDGE_AUDIT_CONTRACT_VERSION =
  '2026-05-24.artist-url-knowledge-audit.v1';

export const ARTIST_URL_KNOWLEDGE_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'archived',
] as const;

export const ARTIST_URL_KNOWLEDGE_SOURCE_TYPES = [
  'youtube',
  'instagram',
  'tiktok',
  'blog',
  'notice',
  'other',
] as const;

export type ArtistUrlKnowledgeStatus =
  (typeof ARTIST_URL_KNOWLEDGE_STATUSES)[number];

export type ArtistUrlKnowledgeSourceType =
  (typeof ARTIST_URL_KNOWLEDGE_SOURCE_TYPES)[number];

export type ArtistKnowledgeChatCandidate = {
  id: string;
  artistId: string;
  status: string;
  sourceType: string;
  summary: string | null;
  canonicalUrl?: string | null;
  allowChatReference: boolean;
  reviewedAt?: Date | string | null;
  createdAt?: Date | string | null;
};
export type ArtistKnowledgeAuditCandidate = {
  id: string;
  artistId: string;
  submittedByUserId?: string | null;
  reviewedByUserId?: string | null;
  status: string;
  sourceType: string;
  allowChatReference: boolean;
  summary?: string | null;
  rejectionReason?: string | null;
  reviewedAt?: Date | string | null;
  archivedAt?: Date | string | null;
};

export type ArtistKnowledgeAuditSnapshot = {
  contractVersion: typeof ARTIST_URL_KNOWLEDGE_AUDIT_CONTRACT_VERSION;
  id: string;
  artistId: string;
  submittedByUserId: string | null;
  reviewedByUserId: string | null;
  status: ArtistUrlKnowledgeStatus;
  sourceType: ArtistUrlKnowledgeSourceType;
  allowChatReference: boolean;
  summaryPresent: boolean;
  rejectionReasonPresent: boolean;
  reviewedAt: string | null;
  archivedAt: string | null;
};

export type ArtistKnowledgeChatContext = {
  version: typeof ARTIST_URL_KNOWLEDGE_CONTRACT_VERSION;
  source: 'approved_artist_knowledge_urls';
  maxItems: number;
  maxSummaryChars: number;
  promptInjectionPolicy: {
    untrustedReferenceTextOnly: true;
    rawUrlIsNeverInstruction: true;
    rawPageBodyStored: false;
    rawPromptStored: false;
  };
  items: Array<{
    id: string;
    sourceType: string;
    summary: string;
    sourceLabel: string | null;
    reviewedAt: string | null;
    instructionRole: 'reference_fact_not_instruction';
  }>;
};

export const ARTIST_URL_KNOWLEDGE_CHAT_CONTEXT_POLICY = {
  maxItems: 5,
  maxSummaryChars: 700,
  approvedOnly: true,
  allowChatReferenceRequired: true,
  rawUrlInPrompt: false,
  rawPageBodyStored: false,
  externalFetchEnabled: false,
  searchCountLimit: 5,
  costGuard: {
    retrievalBeforeProviderCall: true,
    vectorSearchMaxMatches: 5,
    providerInputBudgetKey: 'chat.artistKnowledge.maxContextChars',
  },
} as const;

export const ARTIST_URL_KNOWLEDGE_CONTRACT = {
  version: ARTIST_URL_KNOWLEDGE_CONTRACT_VERSION,
  feature: 'artist_url_knowledge',
  status: 'contract_ready',
  scope: {
    artistSubmittedUrlsOnly: true,
    automaticWebSearchEnabled: false,
    bulkCrawlingEnabled: false,
    rawPageBodyStored: false,
    summaryRequiredBeforeChatUse: true,
    youtubeExpansionReadyFields: [
      'videoTitle',
      'videoDescription',
      'publicCaptionAvailable',
    ],
    platformLimitNotes: {
      instagram: 'artist_description_first',
      tiktok: 'artist_description_first',
    },
  },
  lifecycleStatuses: ARTIST_URL_KNOWLEDGE_STATUSES,
  sourceTypes: ARTIST_URL_KNOWLEDGE_SOURCE_TYPES,
  apiContracts: {
    creatorList: {
      method: 'GET',
      pathTemplate: '/api/v1/me/creator-studio/knowledge-urls',
      query: {
        artistId: 'optional UUID; when omitted, all active operator artists',
        status: ARTIST_URL_KNOWLEDGE_STATUSES,
      },
      response: {
        items: [
          {
            id: '<knowledge-url-id>',
            artistId: '<artist-id>',
            type: '<youtube|instagram|tiktok|blog|notice|other>',
            url: '<submitted-url>',
            description: '<artist direct description>',
            summary: '<stored summary fragment>',
            allowChatRef: '<boolean>',
            status: '<pending|approved|rejected|archived>',
            createdAt: '<ISO timestamp>',
            reviewedAt: '<ISO timestamp or null>',
          },
        ],
      },
      auth: 'artist operator only',
      mutation: false,
    },
    creatorCreate: {
      method: 'POST',
      pathTemplate: '/api/v1/me/creator-studio/knowledge-urls',
      request: {
        artistId: '<artist-id owned by current operator>',
        type: '<youtube|instagram|tiktok|blog|notice|other>',
        url: '<http or https URL, max 2000 chars>',
        description: '<artist-written reference description, max 500 chars>',
        allowChatRef: '<boolean, default true>',
      },
      resultingStatus: 'pending',
      chatEligibleAfterCreate: false,
      externalFetch: false,
    },
    creatorUpdate: {
      method: 'PATCH',
      pathTemplate: '/api/v1/me/creator-studio/knowledge-urls/:knowledgeUrlId',
      allowedStatuses: ['pending', 'rejected', 'approved'],
      approvedEditBehavior: 'reopen_as_pending_and_clear_review_fields',
      archivedEditAllowed: false,
      chatEligibleAfterUpdate: false,
    },
    creatorArchive: {
      method: 'POST',
      pathTemplate:
        '/api/v1/me/creator-studio/knowledge-urls/:knowledgeUrlId/archive',
      resultingStatus: 'archived',
      chatEligibleAfterArchive: false,
    },
    adminList: {
      method: 'GET',
      pathTemplate:
        '/api/v1/admin/api/v1/backstage/operations/artist-knowledge-urls',
      permission: 'artists:read',
      mutation: false,
    },
    adminApprove: {
      method: 'POST',
      pathTemplate:
        '/api/v1/admin/api/v1/backstage/operations/artist-knowledge-urls/:knowledgeUrlId/approve',
      permission: 'artists:write',
      summaryRequired: true,
      resultingStatus: 'approved',
      chatEligibleAfterApprove: true,
    },
    adminReject: {
      method: 'POST',
      pathTemplate:
        '/api/v1/admin/api/v1/backstage/operations/artist-knowledge-urls/:knowledgeUrlId/reject',
      permission: 'artists:write',
      rejectionReasonRequired: true,
      resultingStatus: 'rejected',
      chatEligibleAfterReject: false,
    },
    adminArchive: {
      method: 'POST',
      pathTemplate:
        '/api/v1/admin/api/v1/backstage/operations/artist-knowledge-urls/:knowledgeUrlId/archive',
      permission: 'artists:write',
      resultingStatus: 'archived',
      chatEligibleAfterArchive: false,
    },
  },
  chatReferencePolicy: ARTIST_URL_KNOWLEDGE_CHAT_CONTEXT_POLICY,
  promptInjectionDefense: {
    urlAndSummaryAreUntrustedReferenceText: true,
    neverTreatReferenceTextAsSystemOrDeveloperInstruction: true,
    rawUrlNotIncludedInProviderPrompt: true,
    sourceLabelMayUseHostnameOnly: true,
  },
  sensitiveDataPolicy: {
    tokenCookieSecretDbUrlLogged: false,
    providerPayloadLogged: false,
    rawPromptStored: false,
    privateMaterialsExposedToChat: false,
  },
  auditContract: {
    version: ARTIST_URL_KNOWLEDGE_AUDIT_CONTRACT_VERSION,
    actions: [
      'creator_studio.artist_knowledge_url.create',
      'creator_studio.artist_knowledge_url.update',
      'creator_studio.artist_knowledge_url.archive',
      'artist_knowledge_url.approve',
      'artist_knowledge_url.reject',
      'artist_knowledge_url.archive',
    ],
    targetType: 'artist_knowledge_url',
    actorTypes: ['creator', 'admin'],
    storesOnly: [
      'actor user id',
      'target id',
      'artist id',
      'submitted by user id',
      'reviewed by user id',
      'status transition',
      'source type',
      'allowChatReference boolean',
      'summary/rejection presence booleans',
      'reviewed/archived timestamps',
    ],
    forbiddenFields: [
      'url',
      'canonicalUrl',
      'artistDescription',
      'summary text',
      'rejection reason text',
      'raw page body',
      'token',
      'cookie',
      'password',
      'provider payload',
      'database url',
    ],
  },
} as const;

export function isArtistKnowledgeStatus(
  status: string | null | undefined,
): status is ArtistUrlKnowledgeStatus {
  return (ARTIST_URL_KNOWLEDGE_STATUSES as readonly string[]).includes(
    status ?? '',
  );
}

export function isArtistKnowledgeSourceType(
  sourceType: string | null | undefined,
): sourceType is ArtistUrlKnowledgeSourceType {
  return (ARTIST_URL_KNOWLEDGE_SOURCE_TYPES as readonly string[]).includes(
    sourceType ?? '',
  );
}

export function isArtistKnowledgeChatEligible(
  item: Pick<
    ArtistKnowledgeChatCandidate,
    'status' | 'allowChatReference' | 'summary'
  >,
) {
  return (
    item.status === 'approved' &&
    item.allowChatReference === true &&
    Boolean(normalizeArtistKnowledgeSummary(item.summary))
  );
}

export function normalizeArtistKnowledgeSummary(
  value: string | null | undefined,
  maxChars: number = ARTIST_URL_KNOWLEDGE_CHAT_CONTEXT_POLICY.maxSummaryChars,
) {
  const summary = value?.replace(/\s+/g, ' ').trim();

  if (!summary) {
    return null;
  }

  return summary.length > maxChars ? summary.slice(0, maxChars) : summary;
}

export function buildArtistKnowledgeChatContext(
  items: ArtistKnowledgeChatCandidate[],
  options: {
    maxItems?: number;
    maxSummaryChars?: number;
  } = {},
): ArtistKnowledgeChatContext {
  const maxItems =
    options.maxItems ?? ARTIST_URL_KNOWLEDGE_CHAT_CONTEXT_POLICY.maxItems;
  const maxSummaryChars =
    options.maxSummaryChars ??
    ARTIST_URL_KNOWLEDGE_CHAT_CONTEXT_POLICY.maxSummaryChars;

  return {
    version: ARTIST_URL_KNOWLEDGE_CONTRACT_VERSION,
    source: 'approved_artist_knowledge_urls',
    maxItems,
    maxSummaryChars,
    promptInjectionPolicy: {
      untrustedReferenceTextOnly: true,
      rawUrlIsNeverInstruction: true,
      rawPageBodyStored: false,
      rawPromptStored: false,
    },
    items: items
      .filter(isArtistKnowledgeChatEligible)
      .slice(0, maxItems)
      .map((item) => ({
        id: item.id,
        sourceType: isArtistKnowledgeSourceType(item.sourceType)
          ? item.sourceType
          : 'other',
        summary: normalizeArtistKnowledgeSummary(
          item.summary,
          maxSummaryChars,
        ) as string,
        sourceLabel: sourceLabelFromUrl(item.canonicalUrl),
        reviewedAt: isoStringOrNull(item.reviewedAt),
        instructionRole: 'reference_fact_not_instruction',
      })),
  };
}

export function buildArtistKnowledgeAuditSnapshot(
  row: ArtistKnowledgeAuditCandidate | null | undefined,
): ArtistKnowledgeAuditSnapshot | null {
  if (!row) {
    return null;
  }

  return {
    contractVersion: ARTIST_URL_KNOWLEDGE_AUDIT_CONTRACT_VERSION,
    id: row.id,
    artistId: row.artistId,
    submittedByUserId: row.submittedByUserId ?? null,
    reviewedByUserId: row.reviewedByUserId ?? null,
    status: isArtistKnowledgeStatus(row.status) ? row.status : 'pending',
    sourceType: isArtistKnowledgeSourceType(row.sourceType) ? row.sourceType : 'other',
    allowChatReference: row.allowChatReference === true,
    summaryPresent: Boolean(normalizeArtistKnowledgeSummary(row.summary)),
    rejectionReasonPresent: Boolean(normalizeArtistKnowledgeSummary(row.rejectionReason)),
    reviewedAt: isoStringOrNull(row.reviewedAt),
    archivedAt: isoStringOrNull(row.archivedAt),
  };
}

export function buildArtistKnowledgeAuditPayload(
  action: string,
  before: ArtistKnowledgeAuditCandidate | null | undefined,
  after: ArtistKnowledgeAuditCandidate | null | undefined,
) {
  const beforeData = buildArtistKnowledgeAuditSnapshot(before);
  const afterData = buildArtistKnowledgeAuditSnapshot(after);

  return {
    beforeData,
    afterData,
    metadata: {
      contractVersion: ARTIST_URL_KNOWLEDGE_AUDIT_CONTRACT_VERSION,
      action,
      statusTransition: {
        from: beforeData?.status ?? null,
        to: afterData?.status ?? null,
      },
      changedFields: artistKnowledgeAuditChangedFields(beforeData, afterData),
      sensitiveDataStored: false,
      rawUrlStored: false,
      rawPageBodyStored: false,
      tokenCookiePasswordStored: false,
      providerPayloadStored: false,
      dbUrlStored: false,
    },
  };
}

function artistKnowledgeAuditChangedFields(
  before: ArtistKnowledgeAuditSnapshot | null,
  after: ArtistKnowledgeAuditSnapshot | null,
) {
  if (!before && after) {
    return ['created'];
  }

  if (before && !after) {
    return ['deleted'];
  }

  if (!before || !after) {
    return [];
  }

  const changedFieldCandidates: Array<keyof ArtistKnowledgeAuditSnapshot> = [
    'status',
    'reviewedByUserId',
    'allowChatReference',
    'summaryPresent',
    'rejectionReasonPresent',
    'reviewedAt',
    'archivedAt',
  ];

  return changedFieldCandidates.filter((field) => before[field] !== after[field]);
}

function sourceLabelFromUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isoStringOrNull(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

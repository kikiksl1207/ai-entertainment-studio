export const ARTIST_URL_KNOWLEDGE_CONTRACT_VERSION =
  '2026-05-22.artist-url-knowledge.v1';

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

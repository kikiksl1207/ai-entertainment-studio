export const ARTIST_URL_KNOWLEDGE_CONTRACT_VERSION =
  '2026-06-05.artist-url-knowledge-registration-skeleton.v1';
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

export const ARTIST_URL_KNOWLEDGE_SAFETY_STATUSES = [
  'unreviewed',
  'needs_review',
  'safe',
  'blocked',
] as const;

const ARTIST_URL_KNOWLEDGE_CONTRACT_AUDIT_ACTIONS = [
  'creator_studio.artist_knowledge_url.create',
  'creator_studio.artist_knowledge_url.update',
  'creator_studio.artist_knowledge_url.archive',
  'artist_knowledge_url.approve',
  'artist_knowledge_url.reject',
  'artist_knowledge_url.archive',
] as const;

export type ArtistUrlKnowledgeStatus =
  (typeof ARTIST_URL_KNOWLEDGE_STATUSES)[number];

export type ArtistUrlKnowledgeSourceType =
  (typeof ARTIST_URL_KNOWLEDGE_SOURCE_TYPES)[number];

export type ArtistUrlKnowledgeSafetyStatus =
  (typeof ARTIST_URL_KNOWLEDGE_SAFETY_STATUSES)[number];

export type ArtistKnowledgeChatCandidate = {
  id: string;
  artistId: string;
  status: string;
  sourceType: string;
  title?: string | null;
  summary: string | null;
  safetyStatus?: string | null;
  metadata?: unknown;
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

export type ArtistKnowledgeAdminAuditEventCandidate = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  actorUserId?: string | null;
  createdAt?: Date | string | null;
  beforeData?: ArtistKnowledgeAuditSnapshot | null;
  afterData?: ArtistKnowledgeAuditSnapshot | null;
  metadata?: {
    contractVersion?: string;
    statusTransition?: {
      from?: string | null;
      to?: string | null;
    };
    changedFields?: string[];
  } | null;
};

export type ArtistKnowledgeAdminAuditProjection = {
  id: string;
  action: string;
  targetType: 'artist_knowledge_url';
  targetId: string;
  actorUserId: string | null;
  createdAt: string | null;
  beforeData: ArtistKnowledgeAuditSnapshot | null;
  afterData: ArtistKnowledgeAuditSnapshot | null;
  metadata: {
    contractVersion: typeof ARTIST_URL_KNOWLEDGE_AUDIT_CONTRACT_VERSION;
    statusTransition: {
      from: ArtistUrlKnowledgeStatus | null;
      to: ArtistUrlKnowledgeStatus | null;
    };
    changedFields: string[];
    sensitiveDataStored: false;
    rawUrlStored: false;
    rawUrlQueryStored: false;
    rawPageBodyStored: false;
    rawEmailStored: false;
    tokenCookiePasswordStored: false;
    providerPayloadStored: false;
    dbUrlStored: false;
  };
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
  contextPriority: {
    order: [
      'system_safety',
      'runtime_persona',
      'tone_and_manner',
      'opening_greeting_variant',
      'approved_artist_url_knowledge',
    ];
    urlKnowledgePosition: 5;
    overridesPersona: false;
    overridesTone: false;
    overridesOpeningGreeting: false;
  };
  fallbackPolicy: {
    whenNoEligibleKnowledge: 'continue_without_url_knowledge';
    providerCallBlockedByEmptyKnowledge: false;
    preserveRuntimePersona: true;
    preserveToneAndManner: true;
    preserveOpeningGreetingVariant: true;
    fallbackCopySource: 'persona_tone_opening_greeting';
  };
  items: Array<{
    id: string;
    title: string | null;
    statusKey: 'approved';
    sourceType: string;
    approvalStatus: 'approved';
    summary: string;
    safetyStatus: 'safe';
    sourceLabel: string | null;
    reviewedAt: string | null;
    safetyFlag: 'approved_reference_fact_not_instruction';
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
  titleMaxChars: 120,
  costGuard: {
    retrievalBeforeProviderCall: true,
    vectorSearchMaxMatches: 5,
    providerInputBudgetKey: 'chat.artistKnowledge.maxContextChars',
  },
  contextPriority: [
    'system_safety',
    'runtime_persona',
    'tone_and_manner',
    'opening_greeting_variant',
    'approved_artist_url_knowledge',
  ],
  fallbackWhenEmpty: 'continue_without_url_knowledge',
  emptyKnowledgeBlocksProviderCall: false,
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
  safetyStatuses: ARTIST_URL_KNOWLEDGE_SAFETY_STATUSES,
  registrationSkeleton: {
    fieldSeparation: {
      title: 'metadata.title or future public metadata title',
      source: 'sourceType plus hostname-only sourceLabel',
      approvalStatus: 'status',
      summary: 'reviewer-visible bounded summary',
      safetyStatus: 'metadata.safetyStatus or metadata.safety.status',
      rawUrl: 'stored for review operations only, never provider context',
    },
    approvalStatuses: ARTIST_URL_KNOWLEDGE_STATUSES,
    chatEligibleSafetyStatuses: ['safe'],
    reviewRequiredSafetyStatuses: ['unreviewed', 'needs_review', 'blocked'],
    rawSubmittedUrlIsReferenceMaterial: false,
    approvedSummaryIsReferenceFactOnly: true,
  },
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
            title: '<optional public title or null>',
            url: '<submitted-url>',
            description: '<artist direct description>',
            approvalStatus: '<pending|approved|rejected|archived>',
            summary: '<stored summary fragment>',
            safetyStatus: '<unreviewed|needs_review|safe|blocked>',
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
    adminAuditList: {
      method: 'GET',
      pathTemplate:
        '/api/v1/admin/api/v1/backstage/operations/artist-knowledge-url-audit-events',
      permission: 'audit:read',
      mutation: false,
      query: {
        action: ARTIST_URL_KNOWLEDGE_CONTRACT_AUDIT_ACTIONS,
        targetId: 'optional knowledge URL UUID',
        artistId: 'optional artist UUID through safe audit snapshot',
        take: 'optional 1..100',
        cursor: 'optional opaque cursor',
      },
      responseProjection: 'artistKnowledgeUrlAuditEventListItem',
      rawUrlReturned: false,
      rawUrlQueryReturned: false,
      rawEmailReturned: false,
      providerPayloadReturned: false,
    },
  },
  chatReferencePolicy: ARTIST_URL_KNOWLEDGE_CHAT_CONTEXT_POLICY,
  chatFallbackPolicy: {
    noKnowledgeRows: 'continue_without_url_knowledge',
    noApprovedRows: 'continue_without_url_knowledge',
    pendingRowsOnly: 'continue_without_url_knowledge',
    unsafeRowsOnly: 'continue_without_url_knowledge',
    providerCallBlockedByEmptyKnowledge: false,
    preservePersona: true,
    preserveToneAndManner: true,
    preserveOpeningGreetingVariant: true,
    rawUnapprovedMaterialsInFallback: false,
    adminNotesInFallback: false,
  },
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
    adminReadOnlyProjection: {
      enabled: true,
      permission: 'audit:read',
      mutation: false,
      returnsBeforeAfterSnapshots: true,
      returnsChangedFields: true,
      returnsStatusTransition: true,
      rawUrlReturned: false,
      rawUrlQueryReturned: false,
      rawEmailReturned: false,
      providerPayloadReturned: false,
      tokenCookiePasswordReturned: false,
    },
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
      'raw url query',
      'artistDescription',
      'summary text',
      'rejection reason text',
      'raw page body',
      'token',
      'cookie',
      'password',
      'raw email',
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

export function isArtistKnowledgeSafetyStatus(
  status: string | null | undefined,
): status is ArtistUrlKnowledgeSafetyStatus {
  return (ARTIST_URL_KNOWLEDGE_SAFETY_STATUSES as readonly string[]).includes(
    status ?? '',
  );
}

export function isArtistKnowledgeChatEligible(
  item: Pick<
    ArtistKnowledgeChatCandidate,
    'status' | 'allowChatReference' | 'summary'
  > &
    Partial<Pick<ArtistKnowledgeChatCandidate, 'safetyStatus' | 'metadata'>>,
) {
  return (
    item.status === 'approved' &&
    item.allowChatReference === true &&
    Boolean(normalizeArtistKnowledgeSummary(item.summary)) &&
    artistKnowledgeSafetyStatusFromCandidate(item) === 'safe'
  );
}

export function artistKnowledgeSafetyStatusFromCandidate(
  item: Pick<ArtistKnowledgeChatCandidate, 'status'> &
    Partial<Pick<ArtistKnowledgeChatCandidate, 'safetyStatus' | 'metadata'>>,
) {
  if (isArtistKnowledgeSafetyStatus(item.safetyStatus)) {
    return item.safetyStatus;
  }

  return artistKnowledgeSafetyStatusFromMetadata(item.metadata, item.status);
}

export function artistKnowledgeSafetyStatusFromMetadata(
  metadata: unknown,
  lifecycleStatus?: string | null,
): ArtistUrlKnowledgeSafetyStatus {
  const metadataRecord = recordOrEmpty(metadata);
  const safetyRecord = recordOrEmpty(
    metadataRecord.safety ?? metadataRecord.safetyReview,
  );
  const candidate =
    stringOrNull(metadataRecord.safetyStatus) ??
    stringOrNull(safetyRecord.status) ??
    stringOrNull(safetyRecord.safetyStatus);

  if (isArtistKnowledgeSafetyStatus(candidate)) {
    return candidate;
  }

  return lifecycleStatus === 'approved' ? 'safe' : 'unreviewed';
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

export function normalizeArtistKnowledgeTitle(
  value: string | null | undefined,
  maxChars: number = ARTIST_URL_KNOWLEDGE_CHAT_CONTEXT_POLICY.titleMaxChars,
) {
  const title = value?.replace(/\s+/g, ' ').trim();

  if (!title) {
    return null;
  }

  return title.length > maxChars ? title.slice(0, maxChars) : title;
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
    contextPriority: {
      order: [
        'system_safety',
        'runtime_persona',
        'tone_and_manner',
        'opening_greeting_variant',
        'approved_artist_url_knowledge',
      ],
      urlKnowledgePosition: 5,
      overridesPersona: false,
      overridesTone: false,
      overridesOpeningGreeting: false,
    },
    fallbackPolicy: {
      whenNoEligibleKnowledge: 'continue_without_url_knowledge',
      providerCallBlockedByEmptyKnowledge: false,
      preserveRuntimePersona: true,
      preserveToneAndManner: true,
      preserveOpeningGreetingVariant: true,
      fallbackCopySource: 'persona_tone_opening_greeting',
    },
    items: items
      .filter(isArtistKnowledgeChatEligible)
      .slice(0, maxItems)
      .map((item) => ({
        id: item.id,
        title: normalizeArtistKnowledgeTitle(item.title),
        statusKey: 'approved' as const,
        sourceType: isArtistKnowledgeSourceType(item.sourceType)
          ? item.sourceType
          : 'other',
        approvalStatus: 'approved',
        summary: normalizeArtistKnowledgeSummary(
          item.summary,
          maxSummaryChars,
        ) as string,
        safetyStatus: 'safe',
        sourceLabel: sourceLabelFromUrl(item.canonicalUrl),
        reviewedAt: isoStringOrNull(item.reviewedAt),
        safetyFlag: 'approved_reference_fact_not_instruction' as const,
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
      rawUrlQueryStored: false,
      rawPageBodyStored: false,
      rawEmailStored: false,
      tokenCookiePasswordStored: false,
      providerPayloadStored: false,
      dbUrlStored: false,
    },
  };
}

export function buildArtistKnowledgeAdminAuditProjection(
  event: ArtistKnowledgeAdminAuditEventCandidate,
): ArtistKnowledgeAdminAuditProjection {
  return {
    id: event.id,
    action: ARTIST_URL_KNOWLEDGE_CONTRACT_AUDIT_ACTIONS.includes(
      event.action as (typeof ARTIST_URL_KNOWLEDGE_CONTRACT_AUDIT_ACTIONS)[number],
    )
      ? event.action
      : 'artist_knowledge_url.archive',
    targetType: 'artist_knowledge_url',
    targetId: event.targetId,
    actorUserId: event.actorUserId ?? null,
    createdAt: isoStringOrNull(event.createdAt),
    beforeData: sanitizeArtistKnowledgeAuditSnapshot(event.beforeData),
    afterData: sanitizeArtistKnowledgeAuditSnapshot(event.afterData),
    metadata: {
      contractVersion: ARTIST_URL_KNOWLEDGE_AUDIT_CONTRACT_VERSION,
      statusTransition: {
        from: sanitizeArtistKnowledgeStatus(event.metadata?.statusTransition?.from),
        to: sanitizeArtistKnowledgeStatus(event.metadata?.statusTransition?.to),
      },
      changedFields: sanitizeArtistKnowledgeAuditChangedFields(
        event.metadata?.changedFields,
      ),
      sensitiveDataStored: false,
      rawUrlStored: false,
      rawUrlQueryStored: false,
      rawPageBodyStored: false,
      rawEmailStored: false,
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

function sanitizeArtistKnowledgeAuditSnapshot(
  snapshot: ArtistKnowledgeAuditSnapshot | null | undefined,
): ArtistKnowledgeAuditSnapshot | null {
  if (!snapshot) {
    return null;
  }

  return {
    contractVersion: ARTIST_URL_KNOWLEDGE_AUDIT_CONTRACT_VERSION,
    id: snapshot.id,
    artistId: snapshot.artistId,
    submittedByUserId: snapshot.submittedByUserId ?? null,
    reviewedByUserId: snapshot.reviewedByUserId ?? null,
    status: sanitizeArtistKnowledgeStatus(snapshot.status) ?? 'pending',
    sourceType: isArtistKnowledgeSourceType(snapshot.sourceType)
      ? snapshot.sourceType
      : 'other',
    allowChatReference: snapshot.allowChatReference === true,
    summaryPresent: snapshot.summaryPresent === true,
    rejectionReasonPresent: snapshot.rejectionReasonPresent === true,
    reviewedAt: isoStringOrNull(snapshot.reviewedAt),
    archivedAt: isoStringOrNull(snapshot.archivedAt),
  };
}

function sanitizeArtistKnowledgeStatus(value: string | null | undefined) {
  return isArtistKnowledgeStatus(value) ? value : null;
}

function sanitizeArtistKnowledgeAuditChangedFields(
  fields: string[] | null | undefined,
) {
  const allowed = new Set([
    'created',
    'deleted',
    'status',
    'reviewedByUserId',
    'allowChatReference',
    'summaryPresent',
    'rejectionReasonPresent',
    'reviewedAt',
    'archivedAt',
  ]);

  return (fields ?? []).filter((field) => allowed.has(field));
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

function recordOrEmpty(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

import { HttpException } from '@nestjs/common';

export const CONTENT_WORK_TYPES = ['story', 'ott'] as const;
export const CONTENT_PARTY_ROLES = ['author', 'rights_holder', 'sales_agency'] as const;
export const CONTENT_EXCLUSIVITY = ['exclusive', 'nonexclusive'] as const;
export const CONTENT_MEDIA = [
  'story_publication',
  'ott_streaming',
  'download',
  'audio',
  'translation',
  'marketing',
] as const;
export const UNRESOLVED_POLICY = 'unresolved' as const;
export const INTERNAL_GENERATION_COST_TREATMENT =
  'company_internal_cost_not_deducted_from_creator_share' as const;

export type ContentWorkType = (typeof CONTENT_WORK_TYPES)[number];
export type ContentPartyRole = (typeof CONTENT_PARTY_ROLES)[number];
export type ContentExclusivity = (typeof CONTENT_EXCLUSIVITY)[number];
export type ContentMedium = (typeof CONTENT_MEDIA)[number];
export type ApprovalState = 'draft' | 'approved_configuration';

export type ContentContractParty = {
  role: ContentPartyRole;
  userId: string;
  agencyIdentifier: string | null;
};

export type ContentContractConfiguration = {
  contentVersionId: string;
  exclusivity: ContentExclusivity;
  media: ContentMedium[];
  regions: string[];
  startsAt: Date;
  endsAt: Date | null;
  saleAllowed: boolean;
  aiTransformationAllowed: boolean;
  generatedResultReuseAllowed: boolean;
  effectiveFrom: Date;
  authorRightsHolderShareBps: number;
  salesAgencyShareBps: number;
  companyShareBps: number;
  pointUsagePolicy: typeof UNRESOLVED_POLICY;
  refundReversalPolicy: typeof UNRESOLVED_POLICY;
  paidPointPolicy: typeof UNRESOLVED_POLICY;
  bonusPointPolicy: typeof UNRESOLVED_POLICY;
  vatPolicy: typeof UNRESOLVED_POLICY;
  internalGenerationCostTreatment: typeof INTERNAL_GENERATION_COST_TREATMENT;
  parties: ContentContractParty[];
};

export type CreateContentContractInput = ContentContractConfiguration & {
  workType: ContentWorkType;
  workId: string;
};

export type ContentContractVersion = ContentContractConfiguration & {
  id: string;
  contractId: string;
  revision: number;
  sourceVersionId: string | null;
  approvalState: ApprovalState;
  createdByUserId: string;
  approvedByUserId: string | null;
  createdAt: Date;
};

export type ContentContractAudit = {
  id: string;
  contractVersionId: string;
  action: 'created' | 'revised' | 'approved_configuration';
  actorUserId: string;
  snapshotHash: string;
  createdAt: Date;
};

export type ContentContractRecord = {
  id: string;
  workType: ContentWorkType;
  workId: string;
  createdByUserId: string;
  createdAt: Date;
  versions: ContentContractVersion[];
  audits: ContentContractAudit[];
};

export const CONTENT_RIGHTS_CONFIGURATION_BOUNDARY = {
  status: 'configuration_candidate',
  legalActivation: false,
  settlementAccrualMutation: false,
  payoutMutation: false,
  paymentMutation: false,
  effectiveSnapshotMutation: false,
  internalGenerationCostTreatment: INTERNAL_GENERATION_COST_TREATMENT,
  unresolvedPolicies: [
    'point_usage',
    'refund_reversal',
    'paid_points',
    'bonus_points',
    'vat',
  ],
  legacyPreviewConflict: {
    detected: true,
    source: 'GET /api/v1/me/creator-studio/settlement-preview',
    policy: 'fixed_after_cost_80_percent_preview',
    isolated: true,
    acceptedAsContractOrSettlementInput: false,
  },
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AGENCY_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,79}$/;
const REGION = /^(WORLDWIDE|[A-Z]{2}|[A-Z][A-Z0-9_:-]{2,31})$/;

export function parseCreateContentContract(value: unknown): CreateContentContractInput {
  const body = object(value, [
    'workType', 'workId', ...configurationKeys,
  ]);
  if (!CONTENT_WORK_TYPES.includes(body.workType as ContentWorkType)) invalid();
  return {
    workType: body.workType as ContentWorkType,
    workId: uuid(body.workId),
    ...parseConfiguration(body),
  };
}

export function parseContentContractRevision(value: unknown): {
  sourceVersionId: string;
  configuration: ContentContractConfiguration;
} {
  const body = object(value, ['sourceVersionId', ...configurationKeys]);
  return {
    sourceVersionId: uuid(body.sourceVersionId),
    configuration: parseConfiguration(body),
  };
}

export function parseContentContractApproval(value: unknown) {
  const body = object(value, ['sourceVersionId']);
  return { sourceVersionId: uuid(body.sourceVersionId) };
}

export function parseContentContractId(value: unknown) {
  return uuid(value);
}

export function assertCreatorPartyMatchesOwner(
  ownerUserId: string,
  configuration: ContentContractConfiguration,
) {
  const creator = configuration.parties.find(
    (party) => party.role === 'author' || party.role === 'rights_holder',
  );
  if (creator?.userId !== ownerUserId) contentRightsError('CONFLICT');
}

export function parseConfiguration(
  value: Record<string, unknown>,
): ContentContractConfiguration {
  const contentVersionId = uuid(value.contentVersionId);
  if (!CONTENT_EXCLUSIVITY.includes(value.exclusivity as ContentExclusivity)) invalid();
  const media = stringSet(value.media, CONTENT_MEDIA, 1, CONTENT_MEDIA.length) as ContentMedium[];
  const regions = regionSet(value.regions);
  const startsAt = date(value.startsAt);
  const endsAt = value.endsAt === null ? null : date(value.endsAt);
  if (endsAt && endsAt <= startsAt) invalid();
  const effectiveFrom = date(value.effectiveFrom);
  const authorRightsHolderShareBps = integer(value.authorRightsHolderShareBps, 0, 5000);
  const salesAgencyShareBps = integer(value.salesAgencyShareBps, 0, 1000);
  if (authorRightsHolderShareBps + salesAgencyShareBps > 5500) invalid();
  const companyShareBps = 10000 - authorRightsHolderShareBps - salesAgencyShareBps;
  const parties = parseParties(value.parties, salesAgencyShareBps);

  for (const key of [
    'pointUsagePolicy', 'refundReversalPolicy', 'paidPointPolicy',
    'bonusPointPolicy', 'vatPolicy',
  ]) {
    if (value[key] !== UNRESOLVED_POLICY) unresolved(key);
  }
  if (value.internalGenerationCostTreatment !== INTERNAL_GENERATION_COST_TREATMENT) {
    invalid();
  }

  return {
    contentVersionId,
    exclusivity: value.exclusivity as ContentExclusivity,
    media,
    regions,
    startsAt,
    endsAt,
    saleAllowed: bool(value.saleAllowed),
    aiTransformationAllowed: bool(value.aiTransformationAllowed),
    generatedResultReuseAllowed: bool(value.generatedResultReuseAllowed),
    effectiveFrom,
    authorRightsHolderShareBps,
    salesAgencyShareBps,
    companyShareBps,
    pointUsagePolicy: UNRESOLVED_POLICY,
    refundReversalPolicy: UNRESOLVED_POLICY,
    paidPointPolicy: UNRESOLVED_POLICY,
    bonusPointPolicy: UNRESOLVED_POLICY,
    vatPolicy: UNRESOLVED_POLICY,
    internalGenerationCostTreatment: INTERNAL_GENERATION_COST_TREATMENT,
    parties,
  };
}

const configurationKeys = [
  'contentVersionId', 'exclusivity', 'media', 'regions', 'startsAt', 'endsAt',
  'saleAllowed', 'aiTransformationAllowed', 'generatedResultReuseAllowed',
  'effectiveFrom', 'authorRightsHolderShareBps', 'salesAgencyShareBps',
  'pointUsagePolicy', 'refundReversalPolicy', 'paidPointPolicy',
  'bonusPointPolicy', 'vatPolicy', 'internalGenerationCostTreatment', 'parties',
];

function parseParties(value: unknown, salesShareBps: number): ContentContractParty[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) invalid();
  const parties = value.map((item) => {
    const party = object(item, ['role', 'userId', 'agencyIdentifier']);
    if (!CONTENT_PARTY_ROLES.includes(party.role as ContentPartyRole)) invalid();
    const role = party.role as ContentPartyRole;
    const agencyIdentifier = party.agencyIdentifier === undefined ? null : party.agencyIdentifier;
    if (role === 'sales_agency') {
      if (typeof agencyIdentifier !== 'string' || !AGENCY_IDENTIFIER.test(agencyIdentifier)) invalid();
    } else if (agencyIdentifier !== null) {
      invalid();
    }
    return { role, userId: uuid(party.userId), agencyIdentifier } as ContentContractParty;
  });
  const creatorParties = parties.filter((party) => party.role === 'author' || party.role === 'rights_holder');
  const salesParties = parties.filter((party) => party.role === 'sales_agency');
  if (creatorParties.length !== 1 || salesParties.length > 1) invalid();
  if ((salesShareBps > 0) !== (salesParties.length === 1)) invalid();
  if (new Set(parties.map((party) => `${party.role}:${party.userId}`)).size !== parties.length) invalid();
  return parties;
}

function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowed.includes(key))) invalid();
  return body;
}

function uuid(value: unknown) {
  if (typeof value !== 'string' || !UUID.test(value)) invalid();
  return value;
}

function date(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) invalid();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) invalid();
  const withoutMilliseconds = value.replace(/Z$/, '.000Z');
  const normalized = value.includes('.')
    ? value.replace(/\.(\d{1,3})Z$/, (_match, digits: string) => `.${digits.padEnd(3, '0')}Z`)
    : withoutMilliseconds;
  if (parsed.toISOString() !== normalized) invalid();
  return parsed;
}

function bool(value: unknown) {
  if (typeof value !== 'boolean') invalid();
  return value;
}

function integer(value: unknown, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) invalid();
  return Number(value);
}

function stringSet(value: unknown, allowed: readonly string[], minimum: number, maximum: number) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) invalid();
  if (value.some((item) => typeof item !== 'string' || !allowed.includes(item))) invalid();
  if (new Set(value).size !== value.length) invalid();
  return [...value] as string[];
}

function regionSet(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) invalid();
  if (value.some((item) => typeof item !== 'string' || !REGION.test(item))) invalid();
  if (new Set(value).size !== value.length) invalid();
  if (value.includes('WORLDWIDE') && value.length !== 1) invalid();
  return [...value] as string[];
}

function invalid(): never {
  throw new HttpException({ code: 'CONTENT_RIGHTS_INVALID', message: 'Invalid contract configuration.' }, 400);
}

function unresolved(field: string): never {
  throw new HttpException({
    code: 'CONTENT_RIGHTS_POLICY_UNRESOLVED',
    message: `${field} must remain unresolved until an approved policy exists.`,
  }, 409);
}

export function contentRightsError(code: 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'PERSISTENCE_UNAVAILABLE'): never {
  const status = code === 'NOT_FOUND' ? 404 : code === 'FORBIDDEN' ? 403 : code === 'CONFLICT' ? 409 : 503;
  throw new HttpException({ code: `CONTENT_RIGHTS_${code}`, message: 'Content rights contract request failed.' }, status);
}

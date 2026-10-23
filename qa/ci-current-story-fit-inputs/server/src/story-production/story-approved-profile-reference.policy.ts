import { createHash } from 'crypto';
import { isDeepStrictEqual } from 'util';
import { STORY_PAYLOAD_LOCALES, type StoryPayloadLocale } from '../story-stage/story-locale-payload-contract';
import {
  buildStoryApprovedProfileDelivery,
  decodeStoryApprovedProfileDelivery,
  measureStoryApprovedProfileDelivery,
  STORY_APPROVED_PROFILE_DELIVERY_CONTRACT,
  STORY_APPROVED_PROFILE_DELIVERY_LIMITS,
  type StoryApprovedProfileDeliveryRow,
  type StoryApprovedProfileDeliveryPin,
  type StoryApprovedProfileDeliverySourceResolver,
} from './story-approved-profile-delivery.policy';

export const STORY_PROFILE_REFERENCE_CONTRACT = 'story-approved-profile-reference-offline-v1';

export type StoryProfileReferenceScope = {
  ownerUserId: string;
  workId: string;
  manuscriptVersionId: string;
  analysisJobId: string;
  releaseId: string;
  releaseVersion: number;
  releaseChecksum: string;
  progressId: string;
  progressRevision: number;
  routeNodeId: string | null;
  sourceSceneKind: 'canonical' | 'generated';
  sourceSceneId: string;
  choiceId: string;
  locale: StoryPayloadLocale;
  capabilityRevision: number;
  rateCardId: string;
  rateCardVersion: string;
};

export type StoryProfileReferenceSnapshot = {
  scope: StoryProfileReferenceScope;
  row: StoryApprovedProfileDeliveryRow & {
    ownerUserId: string;
    workId: string;
    manuscriptVersionId: string;
    analysisJobId: string;
  };
};

// Explicit offline inputs, not defaults, environment settings or production admission.
export type StoryProfileReferenceOfflineBounds = {
  purpose: 'offline_validation_only';
  restoredBytes: number;
  rawApprovalBytes: number;
  referenceLifetimeMs: number;
};

type Reference = {
  contract: typeof STORY_PROFILE_REFERENCE_CONTRACT;
  scope: StoryProfileReferenceScope;
  pin: StoryApprovedProfileDeliveryPin;
  issuedAtMs: number;
  expiresAtMs: number;
  rawApprovalSha256: string;
  packetSha256: string;
};

type Code = 'reference_input_invalid' | 'reference_bounds_invalid' | 'reference_scope_mismatch'
  | 'reference_expired' | 'reference_changed' | 'raw_approval_too_large' | 'restored_profile_too_large'
  | 'reference_too_large' | 'reference_json_invalid';

export class StoryProfileReferenceError extends Error {
  constructor(readonly code: Code) { super(code); this.name = 'StoryProfileReferenceError'; }
}
function fail(code: Code): never { throw new StoryProfileReferenceError(code); }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

// Inspect descriptors before JSON serialization so getters/toJSON cannot add authority.
function json(value: unknown, maxBytes = Number.MAX_SAFE_INTEGER,
  overflowCode: Code = 'reference_json_invalid'): string {
  const ancestors = new Set<object>(), chunks: string[] = [];
  let bytes = 0;
  const append = (text: string) => {
    bytes += Buffer.byteLength(text, 'utf8');
    if (bytes > maxBytes) fail(overflowCode);
    chunks.push(text);
  };
  function visit(item: unknown, depth: number): void {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') {
      append(JSON.stringify(item)); return;
    }
    if (typeof item === 'number' && Number.isFinite(item)) { append(JSON.stringify(item)); return; }
    if (depth > 16 || (!Array.isArray(item) && !record(item))) fail('reference_json_invalid');
    const object = item as object;
    if (ancestors.has(object) || Object.getOwnPropertySymbols(object).length) fail('reference_json_invalid');
    const descriptors = Object.getOwnPropertyDescriptors(object);
    if (Object.values(descriptors).some(d => !('value' in d))) fail('reference_json_invalid');
    ancestors.add(object);
    try {
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype || Object.keys(descriptors).length !== item.length + 1) {
          fail('reference_json_invalid');
        }
        append('[');
        for (let i = 0; i < item.length; i++) {
          const d = descriptors[String(i)];
          if (!d?.enumerable || !('value' in d)) fail('reference_json_invalid');
          if (i) append(',');
          visit(d.value, depth + 1);
        }
        append(']'); return;
      }
      append('{');
      let index = 0;
      for (const [key, d] of Object.entries(descriptors)) {
        if (!d.enumerable || !('value' in d)) fail('reference_json_invalid');
        if (index++) append(',');
        append(JSON.stringify(key)); append(':'); visit(d.value, depth + 1);
      }
      append('}');
    } finally { ancestors.delete(object); }
  }
  visit(value, 0);
  return chunks.join('');
}

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const time = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const uuid = (value: unknown) => typeof value === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const SCOPE_KEYS = ['ownerUserId', 'workId', 'manuscriptVersionId', 'analysisJobId', 'releaseId',
  'releaseVersion', 'releaseChecksum', 'progressId', 'progressRevision', 'routeNodeId',
  'sourceSceneKind', 'sourceSceneId', 'choiceId', 'locale', 'capabilityRevision', 'rateCardId', 'rateCardVersion'];

function exact(value: unknown, keys: string[]) {
  if (!record(value) || Reflect.ownKeys(value).length !== keys.length
    || keys.some(key => {
      const d = Object.getOwnPropertyDescriptor(value, key);
      return !d?.enumerable || !('value' in d);
    })) fail('reference_input_invalid');
}

function validateScope(value: StoryProfileReferenceScope) {
  exact(value, SCOPE_KEYS);
  for (const key of ['ownerUserId', 'workId', 'manuscriptVersionId', 'analysisJobId', 'releaseId',
    'progressId', 'sourceSceneId', 'choiceId', 'rateCardId'] as const) {
    if (!uuid(value[key])) fail('reference_input_invalid');
  }
  if ((value.routeNodeId !== null && !uuid(value.routeNodeId)) || !positive(value.releaseVersion)
    || !positive(value.capabilityRevision) || !time(value.progressRevision) || value.progressRevision > 2147483647
    || !digest(value.releaseChecksum)
    || !['canonical', 'generated'].includes(value.sourceSceneKind)
    || !(STORY_PAYLOAD_LOCALES as readonly string[]).includes(value.locale)
    || typeof value.rateCardVersion !== 'string' || !value.rateCardVersion || value.rateCardVersion.length > 128) {
    fail('reference_input_invalid');
  }
}

function validateBounds(bounds: StoryProfileReferenceOfflineBounds) {
  exact(bounds, ['purpose', 'restoredBytes', 'rawApprovalBytes', 'referenceLifetimeMs']);
  if (bounds.purpose !== 'offline_validation_only' || !positive(bounds.restoredBytes)
    || !positive(bounds.rawApprovalBytes) || !positive(bounds.referenceLifetimeMs)) fail('reference_bounds_invalid');
}

function materialize(snapshot: StoryProfileReferenceSnapshot, resolver: StoryApprovedProfileDeliverySourceResolver,
  bounds: StoryProfileReferenceOfflineBounds) {
  validateBounds(bounds);
  exact(snapshot, ['scope', 'row']);
  validateScope(snapshot.scope);
  const { row, scope } = snapshot;
  exact(row, ['id', 'profileVersion', 'reviewRevision', 'sourceFingerprint', 'approvedFingerprint',
    'approvedSettings', 'status', 'ownerUserId', 'workId', 'manuscriptVersionId', 'analysisJobId']);
  if (row.ownerUserId !== scope.ownerUserId || row.workId !== scope.workId
    || row.manuscriptVersionId !== scope.manuscriptVersionId || row.analysisJobId !== scope.analysisJobId) {
    fail('reference_scope_mismatch');
  }
  const raw = json(row.approvedSettings, bounds.rawApprovalBytes, 'raw_approval_too_large');
  const pin: StoryApprovedProfileDeliveryPin = {
    id: row.id, profileVersion: row.profileVersion, reviewRevision: row.reviewRevision,
    sourceFingerprint: row.sourceFingerprint, approvedFingerprint: row.approvedFingerprint!,
  };
  const packet = buildStoryApprovedProfileDelivery(row, pin, resolver);
  const packetJson = json(packet, bounds.restoredBytes, 'restored_profile_too_large');
  const decoded = decodeStoryApprovedProfileDelivery(packet, row, STORY_APPROVED_PROFILE_DELIVERY_CONTRACT, resolver);
  return { decoded, rawApprovalSha256: sha(raw), packetSha256: sha(packetJson) };
}

export function createStoryProfileOfflineReference(snapshot: StoryProfileReferenceSnapshot,
  resolver: StoryApprovedProfileDeliverySourceResolver, bounds: StoryProfileReferenceOfflineBounds,
  issuedAtMs: number, expiresAtMs: number): Readonly<Reference> {
  const result = materialize(snapshot, resolver, bounds);
  if (!time(issuedAtMs) || !time(expiresAtMs) || expiresAtMs <= issuedAtMs
    || expiresAtMs - issuedAtMs > bounds.referenceLifetimeMs) fail('reference_input_invalid');
  const reference: Reference = {
    contract: STORY_PROFILE_REFERENCE_CONTRACT, scope: JSON.parse(json(snapshot.scope)),
    pin: { ...result.decoded.packet.pin }, issuedAtMs, expiresAtMs,
    rawApprovalSha256: result.rawApprovalSha256, packetSha256: result.packetSha256,
  };
  if (Buffer.byteLength(json(reference), 'utf8') > STORY_APPROVED_PROFILE_DELIVERY_LIMITS.viewBytes) {
    fail('reference_too_large');
  }
  Object.freeze(reference.scope); Object.freeze(reference.pin);
  return Object.freeze(reference);
}

export function restoreStoryProfileOfflineReference(reference: unknown, current: StoryProfileReferenceSnapshot,
  resolver: StoryApprovedProfileDeliverySourceResolver, bounds: StoryProfileReferenceOfflineBounds, nowMs: number,
  serverOwnedIssuedReference: unknown) {
  json(reference, STORY_APPROVED_PROFILE_DELIVERY_LIMITS.viewBytes, 'reference_too_large');
  // Future consumers must load this separately; a request cannot certify its own issue/expiry window.
  json(serverOwnedIssuedReference, STORY_APPROVED_PROFILE_DELIVERY_LIMITS.viewBytes, 'reference_too_large');
  if (!isDeepStrictEqual(reference, serverOwnedIssuedReference)) fail('reference_changed');
  exact(reference, ['contract', 'scope', 'pin', 'issuedAtMs', 'expiresAtMs', 'rawApprovalSha256', 'packetSha256']);
  const supplied = reference as Reference;
  validateBounds(bounds); validateScope(supplied.scope);
  if (supplied.contract !== STORY_PROFILE_REFERENCE_CONTRACT || !time(nowMs) || !time(supplied.issuedAtMs)
    || !time(supplied.expiresAtMs) || supplied.expiresAtMs <= supplied.issuedAtMs
    || supplied.expiresAtMs - supplied.issuedAtMs > bounds.referenceLifetimeMs
    || !digest(supplied.rawApprovalSha256) || !digest(supplied.packetSha256)) fail('reference_input_invalid');
  if (nowMs < supplied.issuedAtMs || nowMs >= supplied.expiresAtMs) fail('reference_expired');
  if (Buffer.byteLength(json(reference), 'utf8') > STORY_APPROVED_PROFILE_DELIVERY_LIMITS.viewBytes) fail('reference_too_large');
  const result = materialize(current, resolver, bounds);
  if (!isDeepStrictEqual(supplied.scope, current.scope)) fail('reference_scope_mismatch');
  if (!isDeepStrictEqual(supplied.pin, result.decoded.packet.pin)
    || supplied.rawApprovalSha256 !== result.rawApprovalSha256 || supplied.packetSha256 !== result.packetSha256) {
    fail('reference_changed');
  }
  return Object.freeze({
    ...result.decoded,
    legacyWholePacketMeasurement: measureStoryApprovedProfileDelivery(result.decoded.packet),
    referenceBytes: Buffer.byteLength(json(reference), 'utf8'),
    restoredBytes: Buffer.byteLength(json(result.decoded.packet), 'utf8'),
    localPurpose: 'offline_validation_only' as const,
    actualOwnerAuthenticated: false as const,
    wholeRequestInputFit: 'unmeasured' as const,
    dispatchAuthorized: false as const,
    paidApproval: 'not_evaluated' as const,
    semanticQualityVerified: false as const,
    providerCalls: 0 as const,
  });
}

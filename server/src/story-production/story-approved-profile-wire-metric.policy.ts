import { gzipSync, gunzipSync } from 'node:zlib';
import { types } from 'node:util';
import {
  buildStoryApprovedProfileDelivery,
  decodeStoryApprovedProfileDelivery,
  measureStoryApprovedProfileDelivery,
  STORY_APPROVED_PROFILE_DELIVERY_CONTRACT,
  type StoryApprovedProfileDeliveryRow,
  type StoryApprovedProfileDeliveryPin,
  type StoryApprovedProfileDeliverySourceResolver,
} from './story-approved-profile-delivery.policy';

export const STORY_APPROVED_PROFILE_WIRE_METRIC_CONTRACT = 'story-approved-profile-wire-metric-v1';
export const STORY_APPROVED_PROFILE_WIRE_WORK_BYTES = 262144;
const WIRE_ENVELOPE_CONTRACT = 'story-approved-profile-wire-envelope-v1';
export type StoryApprovedProfileWireMetricErrorCode = 'approval_invalid' | 'work_limit_exceeded' | 'measurement_failed';
const ERROR_CODES = new Set<string>(['approval_invalid', 'work_limit_exceeded', 'measurement_failed']);
const ownedErrors = new WeakSet<object>();

export class StoryApprovedProfileWireMetricError extends Error {
  readonly code: StoryApprovedProfileWireMetricErrorCode;
  constructor(code: StoryApprovedProfileWireMetricErrorCode) {
    const safeCode = ERROR_CODES.has(code) ? code : 'measurement_failed';
    super(safeCode);
    this.name = 'StoryApprovedProfileWireMetricError';
    this.code = safeCode;
    this.stack = undefined;
    ownedErrors.add(this);
    Object.freeze(this);
  }
}

export type StoryApprovedProfileWireMetric = Readonly<{
  contract: typeof STORY_APPROVED_PROFILE_WIRE_METRIC_CONTRACT;
  byteCap: 16384;
  wholeCandidateViewBytes: number;
  candidateViewFits: boolean;
  gzipBytes: number;
  base64Utf8Bytes: number;
  wholeWireEnvelopeBytes: number;
  normalizedApprovalPreserved: true;
  byteExactRoundTrip: true;
  modelInputFit: 'unmeasured';
  semanticQualityVerified: false;
  dispatchAuthorized: false;
  providerCalls: 0;
  operatingWrites: 0;
}>;

function fail(code: StoryApprovedProfileWireMetricErrorCode): never {
  throw new StoryApprovedProfileWireMetricError(code);
}
function isOwnedError(error: unknown): error is StoryApprovedProfileWireMetricError {
  return error !== null && typeof error === 'object' && ownedErrors.has(error);
}
type Work = { lowerBoundBytes: number; nodes: number };
function spend(work: Work, bytes: number) {
  work.lowerBoundBytes += bytes;
  if (work.lowerBoundBytes > STORY_APPROVED_PROFILE_WIRE_WORK_BYTES) fail('work_limit_exceeded');
}

function preflight(value: unknown, work: Work, invalid: 'approval_invalid' | 'measurement_failed',
  requireFrozen: boolean, ancestors = new Set<object>(), depth = 0): void {
  if (types.isProxy(value)) fail(invalid);
  if (work.nodes >= STORY_APPROVED_PROFILE_WIRE_WORK_BYTES) fail('work_limit_exceeded');
  work.nodes++;
  spend(work, 1);
  if (typeof value === 'string') { spend(work, value.length + 1); return; }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail(invalid);
    return;
  }
  if (typeof value !== 'object' || depth > 64 || ancestors.has(value)) fail(invalid);
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) fail(invalid);
  const keys = Reflect.ownKeys(value);
  spend(work, array ? Math.max(0, keys.length - 1) : keys.length);
  for (const key of keys) {
    if (typeof key !== 'string') fail(invalid);
    if (!array) spend(work, key.length + 2);
  }
  if (requireFrozen && !Object.isFrozen(value)) fail(invalid);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (array) {
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1) fail(invalid);
    for (let index = 0; index < length; index++) {
      if (!Object.prototype.hasOwnProperty.call(descriptors, String(index))) fail(invalid);
    }
  }
  ancestors.add(value);
  try {
    for (const key of keys) {
      if (typeof key !== 'string') fail(invalid);
      if (array && key === 'length') continue;
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail(invalid);
      preflight(descriptor.value, work, invalid, requireFrozen, ancestors, depth + 1);
    }
  } finally { ancestors.delete(value); }
}

// CPU-only: the caller owns the current owner-bound RO/RR snapshot and closes it before calling.
export function measureStoryApprovedProfileWireMetric(
  row: StoryApprovedProfileDeliveryRow,
  pin: StoryApprovedProfileDeliveryPin,
  resolver: StoryApprovedProfileDeliverySourceResolver,
): StoryApprovedProfileWireMetric {
  try {
    // Bound normalization input before the existing factory can expand repeated references.
    const work = { lowerBoundBytes: 0, nodes: 0 };
    preflight(row, work, 'approval_invalid', false);
    preflight(pin, work, 'approval_invalid', false);
    if (types.isProxy(resolver)) fail('approval_invalid');
  } catch (error) {
    if (isOwnedError(error)) throw error;
    fail('approval_invalid');
  }
  let delivery: ReturnType<typeof decodeStoryApprovedProfileDelivery>;
  try {
    const packet = buildStoryApprovedProfileDelivery(row, pin, resolver);
    delivery = decodeStoryApprovedProfileDelivery(packet, row, STORY_APPROVED_PROFILE_DELIVERY_CONTRACT, resolver);
  } catch { fail('approval_invalid'); }
  try {
    preflight(delivery.packet, { lowerBoundBytes: 0, nodes: 0 }, 'measurement_failed', true);
    const size = measureStoryApprovedProfileDelivery(delivery.packet);
    if (size.wholeCandidateViewBytes > STORY_APPROVED_PROFILE_WIRE_WORK_BYTES) fail('work_limit_exceeded');
    const original = Buffer.from(JSON.stringify(delivery.packet), 'utf8');
    if (original.length !== size.wholeCandidateViewBytes) fail('measurement_failed');
    const compressed = gzipSync(original, { level: 6, maxOutputLength: STORY_APPROVED_PROFILE_WIRE_WORK_BYTES * 2 });
    const encoded = compressed.toString('base64'), decoded = Buffer.from(encoded, 'base64');
    if (!decoded.equals(compressed)) fail('measurement_failed');
    const restored = gunzipSync(decoded, { maxOutputLength: original.length });
    if (!restored.equals(original)) fail('measurement_failed');
    const wholeWireEnvelopeBytes = Buffer.byteLength(JSON.stringify({
      contract: WIRE_ENVELOPE_CONTRACT, encoding: 'gzip+base64', data: encoded,
    }), 'utf8');
    return Object.freeze({
      contract: STORY_APPROVED_PROFILE_WIRE_METRIC_CONTRACT,
      byteCap: size.byteCap, wholeCandidateViewBytes: size.wholeCandidateViewBytes,
      candidateViewFits: size.candidateViewFits,
      gzipBytes: compressed.length, base64Utf8Bytes: Buffer.byteLength(encoded, 'utf8'), wholeWireEnvelopeBytes,
      normalizedApprovalPreserved: true, byteExactRoundTrip: true,
      modelInputFit: 'unmeasured', semanticQualityVerified: false, dispatchAuthorized: false,
      providerCalls: 0, operatingWrites: 0,
    });
  } catch (error) {
    if (isOwnedError(error)) throw error;
    fail('measurement_failed');
  }
}

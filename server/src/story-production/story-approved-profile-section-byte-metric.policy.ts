import { types } from 'node:util';
import { STORY_PROFILE_SECTION_KEYS } from '../generation-profile/creator-generation-profile.policy';
import {
  decodeStoryApprovedProfileDelivery,
  measureStoryApprovedProfileDeliveryComponents,
  STORY_APPROVED_PROFILE_DELIVERY_CONTRACT,
  STORY_APPROVED_PROFILE_DELIVERY_LIMITS,
  type StoryApprovedProfileDeliveryPacket,
  type StoryApprovedProfileDeliveryRow,
  type StoryApprovedProfileDeliverySourceResolver,
} from './story-approved-profile-delivery.policy';

export const STORY_APPROVED_PROFILE_SECTION_BYTE_METRIC_CONTRACT = 'story-approved-profile-section-byte-metric-v1';
export const STORY_APPROVED_PROFILE_SECTION_BYTE_WORK_BYTES = 262144;
// Packet, row, cumulative resolver output and final row recheck have separate budgets.
// Successful preflight totals are <=4 * 262144 visits/lower-bound bytes; the first
// budget overshoot fails immediately. These counters are not a total allocation cap.
// JSON string escaping can expand character bounds up to 6x before the exact byte check;
// numeric spellings/framing add bytes too. Every accepted serialized value is <=262144B.
export type StoryApprovedProfileSectionByteMetricErrorCode = 'approval_invalid' | 'work_limit_exceeded' | 'measurement_failed';
const ERROR_CODES = new Set<string>(['approval_invalid', 'work_limit_exceeded', 'measurement_failed']);
const ownedErrors = new WeakSet<object>();

export class StoryApprovedProfileSectionByteMetricError extends Error {
  readonly code: StoryApprovedProfileSectionByteMetricErrorCode;
  constructor(code: StoryApprovedProfileSectionByteMetricErrorCode) {
    const safeCode = ERROR_CODES.has(code) ? code : 'measurement_failed';
    super(safeCode);
    this.name = 'StoryApprovedProfileSectionByteMetricError';
    this.code = safeCode;
    this.stack = undefined;
    ownedErrors.add(this);
    Object.freeze(this);
  }
}

type SectionKey = typeof STORY_PROFILE_SECTION_KEYS[number];
export type StoryApprovedProfileSectionByteMetric = Readonly<{
  contract: typeof STORY_APPROVED_PROFILE_SECTION_BYTE_METRIC_CONTRACT;
  byteCap: 16384;
  wholeCandidateViewBytes: number;
  authorDataBytes: number;
  approvalEvidenceBytes: number;
  serverInterpretationBytes: number;
  approvalPinBytes: number;
  framingBytes: number;
  sections: ReadonlyArray<Readonly<{
    key: SectionKey;
    authorSectionBytes: number;
    authorValueBytes: number;
    approvalEvidenceEntryBytes: number;
  }>>;
  sectionsArrayFramingBytes: number;
  authorObjectFramingBytes: number;
  approvalEvidenceArrayFramingBytes: number;
  writingStyleSectionBytes: number;
  writingStyleValueBytes: number;
  modelInputFit: 'unmeasured';
  semanticQualityVerified: false;
  dispatchAuthorized: false;
  providerCalls: 0;
  operatingWrites: 0;
}>;

function fail(code: StoryApprovedProfileSectionByteMetricErrorCode): never {
  throw new StoryApprovedProfileSectionByteMetricError(code);
}
function isOwnedError(error: unknown): error is StoryApprovedProfileSectionByteMetricError {
  return error !== null && typeof error === 'object' && ownedErrors.has(error);
}
type Work = { lowerBoundBytes: number; nodes: number };
function spend(work: Work, bytes: number) {
  work.lowerBoundBytes += bytes;
  if (work.lowerBoundBytes > STORY_APPROVED_PROFILE_SECTION_BYTE_WORK_BYTES) fail('work_limit_exceeded');
}

// Count each expanded visit; aliases are allowed, but a shared DAG cannot bypass the work budget.
function preflight(value: unknown, work: Work, requireFrozen: boolean, ancestors = new Set<object>(), depth = 0): void {
  if (types.isProxy(value)) fail('approval_invalid');
  if (work.nodes >= STORY_APPROVED_PROFILE_SECTION_BYTE_WORK_BYTES) fail('work_limit_exceeded');
  work.nodes++;
  spend(work, 1);
  if (typeof value === 'string') { spend(work, value.length + 1); return; }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail('approval_invalid');
    return;
  }
  if (typeof value !== 'object' || depth > 64 || ancestors.has(value)) fail('approval_invalid');
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype) fail('approval_invalid');
  const keys = Reflect.ownKeys(value);
  spend(work, array ? Math.max(0, keys.length - 1) : keys.length);
  for (const key of keys) {
    if (typeof key !== 'string') fail('approval_invalid');
    if (!array) spend(work, key.length + 2);
  }
  if (requireFrozen && !Object.isFrozen(value)) fail('approval_invalid');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (array) {
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1) fail('approval_invalid');
    for (let index = 0; index < length; index++) {
      if (!Object.prototype.hasOwnProperty.call(descriptors, String(index))) fail('approval_invalid');
    }
  }
  ancestors.add(value);
  try {
    for (const key of keys) {
      if (typeof key !== 'string') fail('approval_invalid');
      if (array && key === 'length') continue;
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail('approval_invalid');
      preflight(descriptor.value, work, requireFrozen, ancestors, depth + 1);
    }
  } finally { ancestors.delete(value); }
}

function boundedJson(value: unknown): string {
  const text = JSON.stringify(value);
  if (typeof text !== 'string') fail('measurement_failed');
  if (Buffer.byteLength(text, 'utf8') > STORY_APPROVED_PROFILE_SECTION_BYTE_WORK_BYTES) fail('work_limit_exceeded');
  return text;
}
const jsonBytes = (value: unknown) => Buffer.byteLength(boundedJson(value), 'utf8');

// No packet-only admission exists: require the same plain JSON snapshot row and trusted resolver.
// Select explicit profile fields; a whole ORM row with Dates/non-JSON extras is rejected, not clamped.
// This revalidates the supplied approval, not its owner's identity, DB provenance or live authority.
export function measureStoryApprovedProfileSectionByteMetric(
  packet: StoryApprovedProfileDeliveryPacket,
  currentRow: StoryApprovedProfileDeliveryRow,
  resolver: StoryApprovedProfileDeliverySourceResolver,
): StoryApprovedProfileSectionByteMetric {
  let packetBefore: string, rowBefore: string;
  try {
    preflight(packet, { lowerBoundBytes: 0, nodes: 0 }, true);
    preflight(currentRow, { lowerBoundBytes: 0, nodes: 0 }, false);
    if (types.isProxy(resolver) || typeof resolver !== 'function') fail('approval_invalid');
    packetBefore = boundedJson(packet); rowBefore = boundedJson(currentRow);
  } catch (error) {
    if (isOwnedError(error)) throw error;
    fail('approval_invalid');
  }
  const resolverWork = { lowerBoundBytes: 0, nodes: 0 };
  let resolverFailure: StoryApprovedProfileSectionByteMetricError | undefined;
  const guardedResolver: StoryApprovedProfileDeliverySourceResolver = (ref, evidence) => {
    let source: ReturnType<StoryApprovedProfileDeliverySourceResolver>;
    try { source = resolver(ref, evidence); } catch { fail('approval_invalid'); }
    try { preflight(source, resolverWork, false); }
    catch (error) {
      resolverFailure = isOwnedError(error) ? error : new StoryApprovedProfileSectionByteMetricError('approval_invalid');
      throw resolverFailure;
    }
    return source;
  };
  try {
    decodeStoryApprovedProfileDelivery(packet, currentRow, STORY_APPROVED_PROFILE_DELIVERY_CONTRACT, guardedResolver);
  } catch {
    if (resolverFailure) throw resolverFailure;
    fail('approval_invalid');
  }
  try {
    preflight(currentRow, { lowerBoundBytes: 0, nodes: 0 }, false);
    if (boundedJson(currentRow) !== rowBefore || boundedJson(packet) !== packetBefore) fail('approval_invalid');
    const components = measureStoryApprovedProfileDeliveryComponents(packet);
    if (components.wholeCandidateViewBytes !== Buffer.byteLength(packetBefore, 'utf8')) fail('measurement_failed');
    const sections = packet.authorData.sections.map((section, index) => {
      if (!(STORY_PROFILE_SECTION_KEYS as readonly string[]).includes(section.key)) fail('approval_invalid');
      const evidence = packet.approvalEvidence[index];
      if (evidence.key !== section.key) fail('approval_invalid');
      return Object.freeze({
        key: section.key as SectionKey, authorSectionBytes: jsonBytes(section),
        authorValueBytes: jsonBytes(section.value), approvalEvidenceEntryBytes: jsonBytes(evidence),
      });
    });
    const sectionsArrayBytes = jsonBytes(packet.authorData.sections);
    const sectionsArrayFramingBytes = sectionsArrayBytes - sections.reduce((sum, item) => sum + item.authorSectionBytes, 0);
    const authorObjectFramingBytes = components.authorDataBytes - sectionsArrayBytes;
    const approvalEvidenceArrayFramingBytes = components.approvalEvidenceBytes
      - sections.reduce((sum, item) => sum + item.approvalEvidenceEntryBytes, 0);
    const style = sections.find(section => section.key === 'writing_style');
    if (!style || sections.length !== STORY_PROFILE_SECTION_KEYS.length
      || [sectionsArrayFramingBytes, authorObjectFramingBytes, approvalEvidenceArrayFramingBytes]
        .some(bytes => !Number.isSafeInteger(bytes) || bytes < 0)) fail('measurement_failed');
    return Object.freeze({
      contract: STORY_APPROVED_PROFILE_SECTION_BYTE_METRIC_CONTRACT,
      byteCap: STORY_APPROVED_PROFILE_DELIVERY_LIMITS.viewBytes,
      wholeCandidateViewBytes: components.wholeCandidateViewBytes, authorDataBytes: components.authorDataBytes,
      approvalEvidenceBytes: components.approvalEvidenceBytes, serverInterpretationBytes: components.serverInterpretationBytes,
      approvalPinBytes: components.approvalPinBytes, framingBytes: components.framingBytes,
      sections: Object.freeze(sections), sectionsArrayFramingBytes, authorObjectFramingBytes,
      approvalEvidenceArrayFramingBytes, writingStyleSectionBytes: style.authorSectionBytes,
      writingStyleValueBytes: style.authorValueBytes, modelInputFit: 'unmeasured',
      semanticQualityVerified: false, dispatchAuthorized: false, providerCalls: 0, operatingWrites: 0,
    });
  } catch (error) {
    if (isOwnedError(error)) throw error;
    fail('measurement_failed');
  }
}

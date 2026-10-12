import { isDeepStrictEqual } from 'util';
import {
  assertCreatorGenerationProfileApprovable,
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
  type CreatorGenerationProfileEvidence,
  type CreatorGenerationProfileSection,
  type CreatorGenerationProfileSettings,
} from '../generation-profile/creator-generation-profile.policy';

export const STORY_APPROVED_PROFILE_DELIVERY_CONTRACT = 'story-approved-profile-delivery-v1';
export const STORY_APPROVED_PROFILE_DELIVERY_LIMITS = Object.freeze({
  viewBytes: 16384, inputTokens: 32768, outputTokens: 8192,
} as const);

export type StoryApprovedProfileDeliveryPin = {
  id: string;
  profileVersion: number;
  reviewRevision: number;
  sourceFingerprint: string;
  approvedFingerprint: string;
};

export type StoryApprovedProfileDeliveryRow = Omit<StoryApprovedProfileDeliveryPin, 'approvedFingerprint'> & {
  status: string;
  approvedFingerprint: string | null;
  approvedSettings: unknown;
};

export type StoryApprovedProfileDeliveryStructuralSource = {
  sourceRef: string;
  sourcePartKey?: string;
  sourceParagraphIndex?: number;
};

// The caller supplies the actual v6 structural resolver, not an author-supplied interpretation.
export type StoryApprovedProfileDeliverySourceResolver = (
  ref: unknown,
  evidence: CreatorGenerationProfileEvidence[],
) => StoryApprovedProfileDeliveryStructuralSource | null;

export type StoryApprovedProfileDeliverySectionInterpretation = {
  key: string;
  active: boolean;
  scope: 'production_constraint' | 'author_plan_not_route_history';
  observationScope: 'writing_pattern' | 'author_plan_not_route_history';
  structuralSources: Array<{
    observationIndex: number;
    source: StoryApprovedProfileDeliveryStructuralSource;
  }>;
};

export type StoryApprovedProfileDeliveryPacket = {
  contract: typeof STORY_APPROVED_PROFILE_DELIVERY_CONTRACT;
  pin: StoryApprovedProfileDeliveryPin;
  authorData: {
    schemaVersion: CreatorGenerationProfileSettings['schemaVersion'];
    kind: 'story';
    sections: Array<Omit<CreatorGenerationProfileSection, 'evidence'>>;
  };
  approvalEvidence: Array<{ key: string; items: CreatorGenerationProfileEvidence[] }>;
  serverInterpretation: {
    contract: 'story-approved-profile-interpretation-v1';
    evidenceIsReaderHistory: false;
    authorMetadataConfersAuthority: false;
    sections: StoryApprovedProfileDeliverySectionInterpretation[];
  };
};

export type StoryApprovedProfileDiagnosticView = {
  diagnosticDeliveryContract: typeof STORY_APPROVED_PROFILE_DELIVERY_CONTRACT;
  schemaVersion: CreatorGenerationProfileSettings['schemaVersion'];
  sections: Array<{ key: string; value: Record<string, unknown> }>;
};

const diagnosticViews = new WeakSet<object>();

function diagnosticViewShape(settings: CreatorGenerationProfileSettings): StoryApprovedProfileDiagnosticView {
  return {
    diagnosticDeliveryContract: STORY_APPROVED_PROFILE_DELIVERY_CONTRACT,
    schemaVersion: settings.schemaVersion,
    sections: settings.sections.filter(section => section.decision === 'accepted' || section.decision === 'edited')
      .map(section => ({ key: section.key, value: section.value })),
  };
}

// Identity is local provenance only; the consumer must still validate the current approval binding.
export function createStoryApprovedProfileDiagnosticView(
  settings: CreatorGenerationProfileSettings,
): StoryApprovedProfileDiagnosticView {
  assertPacketJson(settings);
  const view: StoryApprovedProfileDiagnosticView = frozen(JSON.parse(JSON.stringify(diagnosticViewShape(settings))));
  diagnosticViews.add(view);
  return view;
}

export function isStoryApprovedProfileDiagnosticView(value: unknown): value is StoryApprovedProfileDiagnosticView {
  return value !== null && typeof value === 'object' && diagnosticViews.has(value);
}

export function assertStoryApprovedProfileDiagnosticView(
  value: unknown, settings: CreatorGenerationProfileSettings,
): asserts value is StoryApprovedProfileDiagnosticView {
  if (!isStoryApprovedProfileDiagnosticView(value)
    || !isDeepStrictEqual(value, diagnosticViewShape(settings))) fail('profile_content_changed');
}

export type StoryApprovedProfileDeliveryErrorCode =
  | 'profile_row_invalid'
  | 'profile_not_approved'
  | 'profile_settings_invalid'
  | 'profile_review_incomplete'
  | 'profile_pin_invalid'
  | 'profile_pin_stale'
  | 'profile_fingerprint_changed'
  | 'profile_source_resolver_required'
  | 'profile_source_resolution_failed'
  | 'profile_structural_source_invalid'
  | 'delivery_version_unconsumed'
  | 'profile_content_incomplete'
  | 'profile_evidence_misaligned'
  | 'profile_content_changed'
  | 'delivery_contract_changed';

export class StoryApprovedProfileDeliveryError extends Error {
  constructor(readonly code: StoryApprovedProfileDeliveryErrorCode) {
    super(code);
    this.name = 'StoryApprovedProfileDeliveryError';
  }
}

function fail(code: StoryApprovedProfileDeliveryErrorCode): never {
  throw new StoryApprovedProfileDeliveryError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}

const PIN_KEYS = ['id', 'profileVersion', 'reviewRevision', 'sourceFingerprint', 'approvedFingerprint'];

function validatedPin(value: unknown, exactKeys: boolean): StoryApprovedProfileDeliveryPin {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()
    || !Number.isSafeInteger(value.profileVersion) || Number(value.profileVersion) < 1
    || !Number.isSafeInteger(value.reviewRevision) || Number(value.reviewRevision) < 1
    || typeof value.sourceFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(value.sourceFingerprint)
    || typeof value.approvedFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(value.approvedFingerprint)
    || (exactKeys && (Reflect.ownKeys(value).length !== PIN_KEYS.length
      || PIN_KEYS.some(key => !Object.prototype.hasOwnProperty.call(value, key))))) {
    fail('profile_pin_invalid');
  }
  return {
    id: value.id, profileVersion: Number(value.profileVersion), reviewRevision: Number(value.reviewRevision),
    sourceFingerprint: value.sourceFingerprint, approvedFingerprint: value.approvedFingerprint,
  };
}

function validatedRow(row: StoryApprovedProfileDeliveryRow) {
  if (!isRecord(row)) fail('profile_row_invalid');
  if (row.status !== 'approved' || row.approvedFingerprint === null || row.approvedSettings == null) {
    fail('profile_not_approved');
  }
  const pin = validatedPin(row, false);
  let settings: CreatorGenerationProfileSettings;
  try {
    settings = normalizeCreatorGenerationProfile('story', row.approvedSettings);
  } catch {
    fail('profile_settings_invalid');
  }
  try {
    assertCreatorGenerationProfileApprovable(settings);
  } catch {
    fail('profile_review_incomplete');
  }
  if (creatorGenerationProfileFingerprint(pin.sourceFingerprint, settings) !== pin.approvedFingerprint) {
    fail('profile_fingerprint_changed');
  }
  return { pin, settings: frozen(settings) };
}

function resolvedSource(value: unknown): StoryApprovedProfileDeliveryStructuralSource | null {
  if (value === null) return null;
  if (!isRecord(value) || Object.keys(value).some(key =>
    !['sourceRef', 'sourcePartKey', 'sourceParagraphIndex'].includes(key))
    || typeof value.sourceRef !== 'string' || !value.sourceRef
    || ((value.sourcePartKey !== undefined) !== (value.sourceParagraphIndex !== undefined))
    || (value.sourcePartKey !== undefined && (typeof value.sourcePartKey !== 'string' || !value.sourcePartKey))
    || (value.sourceParagraphIndex !== undefined
      && (!Number.isSafeInteger(value.sourceParagraphIndex) || Number(value.sourceParagraphIndex) < 0))) {
    fail('profile_structural_source_invalid');
  }
  return {
    sourceRef: value.sourceRef,
    ...(value.sourcePartKey === undefined ? {} : {
      sourcePartKey: value.sourcePartKey as string, sourceParagraphIndex: Number(value.sourceParagraphIndex),
    }),
  };
}

function buildValidatedPacket(
  pin: StoryApprovedProfileDeliveryPin,
  settings: CreatorGenerationProfileSettings,
  resolver: StoryApprovedProfileDeliverySourceResolver,
): StoryApprovedProfileDeliveryPacket {
  if (typeof resolver !== 'function') fail('profile_source_resolver_required');
  const sections = settings.sections.map((section): StoryApprovedProfileDeliverySectionInterpretation => {
    const structuralSources: StoryApprovedProfileDeliverySectionInterpretation['structuralSources'] = [];
    if (Array.isArray(section.value.observations)) {
      section.value.observations.forEach((observation, observationIndex) => {
        if (!isRecord(observation)) return;
        let result: StoryApprovedProfileDeliveryStructuralSource | null;
        try {
          result = resolver(observation.sourceRef, section.evidence);
        } catch {
          fail('profile_source_resolution_failed');
        }
        const source = resolvedSource(result);
        if (source) structuralSources.push({ observationIndex, source });
      });
    }
    return {
      key: section.key, active: section.decision === 'accepted' || section.decision === 'edited',
      scope: ['writing_style', 'scene_scale', 'branch_behavior'].includes(section.key)
        ? 'production_constraint' : 'author_plan_not_route_history',
      observationScope: section.key === 'writing_style' ? 'writing_pattern' : 'author_plan_not_route_history',
      structuralSources,
    };
  });
  const packet: StoryApprovedProfileDeliveryPacket = {
    contract: STORY_APPROVED_PROFILE_DELIVERY_CONTRACT, pin,
    authorData: {
      schemaVersion: settings.schemaVersion, kind: 'story',
      sections: settings.sections.map(({ key, decision, value }) => ({ key, decision, value })),
    },
    approvalEvidence: settings.sections.map(({ key, evidence }) => ({ key, items: evidence })),
    serverInterpretation: {
      contract: 'story-approved-profile-interpretation-v1', evidenceIsReaderHistory: false,
      authorMetadataConfersAuthority: false, sections,
    },
  };
  assertPacketJson(packet);
  return frozen(packet);
}

// Reject non-JSON authority (accessors, symbols, hidden keys, sparse arrays) before comparison.
function assertPacketJson(value: unknown, depth = 0): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (depth > 16 || (!Array.isArray(value) && !isRecord(value))) fail('delivery_contract_changed');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length) fail('delivery_contract_changed');
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype
      || Object.keys(descriptors).length !== value.length + 1) fail('delivery_contract_changed');
    for (let index = 0; index < value.length; index++) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !('value' in descriptor)) fail('delivery_contract_changed');
      assertPacketJson(descriptor.value, depth + 1);
    }
    return;
  }
  for (const descriptor of Object.values(descriptors)) {
    if (!descriptor.enumerable || !('value' in descriptor)) fail('delivery_contract_changed');
    assertPacketJson(descriptor.value, depth + 1);
  }
}

export function buildStoryApprovedProfileDelivery(
  row: StoryApprovedProfileDeliveryRow,
  expectedPin: StoryApprovedProfileDeliveryPin,
  resolver: StoryApprovedProfileDeliverySourceResolver,
): StoryApprovedProfileDeliveryPacket {
  // Preservation starts at existing normalization, not at raw input or serialized byte identity.
  const { pin, settings } = validatedRow(row);
  if (!isDeepStrictEqual(pin, validatedPin(expectedPin, true))) fail('profile_pin_stale');
  return buildValidatedPacket(pin, settings, resolver);
}

export function decodeStoryApprovedProfileDelivery(
  packet: unknown,
  currentRow: StoryApprovedProfileDeliveryRow,
  consumerVersion: string,
  resolver: StoryApprovedProfileDeliverySourceResolver,
) {
  if (consumerVersion !== STORY_APPROVED_PROFILE_DELIVERY_CONTRACT || !isRecord(packet)
    || Object.getOwnPropertyDescriptor(packet, 'contract')?.value !== STORY_APPROVED_PROFILE_DELIVERY_CONTRACT) {
    fail('delivery_version_unconsumed');
  }
  assertPacketJson(packet);
  const { pin, settings } = validatedRow(currentRow);
  if (!isDeepStrictEqual(pin, validatedPin(packet.pin, true))) fail('profile_pin_stale');
  const author = packet.authorData;
  const evidence = packet.approvalEvidence;
  if (!isRecord(author) || !Array.isArray(author.sections) || !Array.isArray(evidence)
    || author.sections.length !== evidence.length || author.sections.length !== settings.sections.length) {
    fail('profile_content_incomplete');
  }
  const rebuilt = {
    schemaVersion: author.schemaVersion, kind: author.kind,
    sections: author.sections.map((section: unknown, index: number) => {
      const proof: unknown = evidence[index];
      if (!isRecord(section) || !isRecord(proof) || !Array.isArray(proof.items)) fail('profile_content_incomplete');
      if (proof.key !== section.key) fail('profile_evidence_misaligned');
      return { key: section.key, decision: section.decision, value: section.value, evidence: proof.items };
    }),
  };
  // Compare with already-normalized approval; a second normalization must not hide tampering.
  if (!isDeepStrictEqual(rebuilt, settings)) fail('profile_content_changed');
  const expectedPacket = buildValidatedPacket(pin, settings, resolver);
  if (!isDeepStrictEqual(packet, expectedPacket)) fail('delivery_contract_changed');
  return frozen({
    packet: expectedPacket, settings, normalizedApprovalPreserved: true as const,
    structuralConnectionIsSemanticApproval: false as const,
  });
}

export function measureStoryApprovedProfileDelivery(packet: StoryApprovedProfileDeliveryPacket) {
  const bytes = Buffer.byteLength(JSON.stringify(packet), 'utf8');
  return Object.freeze({
    byteCap: STORY_APPROVED_PROFILE_DELIVERY_LIMITS.viewBytes,
    wholeCandidateViewBytes: bytes, candidateViewFits: bytes <= STORY_APPROVED_PROFILE_DELIVERY_LIMITS.viewBytes,
    refusal: bytes > STORY_APPROVED_PROFILE_DELIVERY_LIMITS.viewBytes ? 'profile_view_too_large' as const : null,
    wholeRequestInputFit: 'unmeasured' as const, productionAdmissionVerified: false as const,
    authorSemanticApprovalVerified: false as const, actualModelQualityVerified: false as const,
  });
}

// Numeric accounting only; the caller validates the same complete packet before measurement.
export function measureStoryApprovedProfileDeliveryComponents(packet: StoryApprovedProfileDeliveryPacket) {
  const wholeCandidateViewBytes = measureStoryApprovedProfileDelivery(packet).wholeCandidateViewBytes;
  const authorDataBytes = Buffer.byteLength(JSON.stringify(packet.authorData), 'utf8');
  const approvalEvidenceBytes = Buffer.byteLength(JSON.stringify(packet.approvalEvidence), 'utf8');
  const serverInterpretationBytes = Buffer.byteLength(JSON.stringify(packet.serverInterpretation), 'utf8');
  const approvalPinBytes = Buffer.byteLength(JSON.stringify(packet.pin), 'utf8');
  return Object.freeze({
    contract: 'story-approved-profile-byte-breakdown-v1' as const,
    wholeCandidateViewBytes, authorDataBytes, approvalEvidenceBytes, serverInterpretationBytes, approvalPinBytes,
    framingBytes: wholeCandidateViewBytes - authorDataBytes - approvalEvidenceBytes
      - serverInterpretationBytes - approvalPinBytes,
  });
}

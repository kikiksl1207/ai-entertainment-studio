import 'reflect-metadata';
import {
  CREATOR_GENERATION_PROFILE_SCHEMA,
  STORY_PROFILE_SECTION_KEYS,
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
  type CreatorGenerationProfileEvidence,
} from '../generation-profile/creator-generation-profile.policy';
import { profileObservationSource } from './story-continuation-context.policy';
import {
  STORY_APPROVED_PROFILE_DELIVERY_CONTRACT,
  STORY_APPROVED_PROFILE_DELIVERY_LIMITS,
  buildStoryApprovedProfileDelivery,
  decodeStoryApprovedProfileDelivery,
  measureStoryApprovedProfileDelivery,
  measureStoryApprovedProfileDeliveryComponents,
  type StoryApprovedProfileDeliveryPacket,
  type StoryApprovedProfileDeliveryPin,
  type StoryApprovedProfileDeliveryRow,
} from './story-approved-profile-delivery.policy';

const SOURCE_REF = 'analysis:11111111-1111-4111-8111-111111111111';
const OBSERVATION = { title: 'Synthetic title.', detail: 'Synthetic complete rule.', sourceRef: SOURCE_REF };
const EVIDENCE: CreatorGenerationProfileEvidence[] = [
  { sourceType: 'manuscript', sourceRef: SOURCE_REF + ':part-a:4', summary: 'Synthetic first proof.' },
  { sourceType: 'manuscript', sourceRef: SOURCE_REF + ':part-a:4', summary: 'Synthetic second proof.' },
];

function fixture(
  style: Record<string, unknown> = {},
  evidence = EVIDENCE,
  id = 'synthetic-component-profile',
) {
  const settings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
      key, decision: key === 'writing_style' ? 'edited' : 'accepted',
      value: key === 'writing_style'
        ? { summary: 'Synthetic summary.', observations: [OBSERVATION], ...style }
        : { summary: 'Synthetic ' + key + '.' },
      evidence: key === 'writing_style' ? evidence : [
        { sourceType: 'metadata', sourceRef: 'synthetic:' + key, summary: 'Synthetic ' + key + ' evidence.' },
      ],
    })).reverse(),
  });
  const sourceFingerprint = 'a'.repeat(64);
  const row: StoryApprovedProfileDeliveryRow = {
    id, status: 'approved', profileVersion: 1, reviewRevision: 3,
    sourceFingerprint, approvedSettings: settings,
    approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings),
  };
  const pin: StoryApprovedProfileDeliveryPin = {
    id: row.id, profileVersion: row.profileVersion, reviewRevision: row.reviewRevision,
    sourceFingerprint, approvedFingerprint: row.approvedFingerprint!,
  };
  const built = buildStoryApprovedProfileDelivery(row, pin, profileObservationSource);
  const decoded = decodeStoryApprovedProfileDelivery(
    JSON.parse(JSON.stringify(built)), row, STORY_APPROVED_PROFILE_DELIVERY_CONTRACT, profileObservationSource,
  );
  return { row, settings, packet: decoded.packet };
}

const jsonBytes = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').length;

function expectAccounting(packet: StoryApprovedProfileDeliveryPacket) {
  const measured = measureStoryApprovedProfileDeliveryComponents(packet);
  const components = {
    authorDataBytes: jsonBytes(packet.authorData),
    approvalEvidenceBytes: jsonBytes(packet.approvalEvidence),
    serverInterpretationBytes: jsonBytes(packet.serverInterpretation),
    approvalPinBytes: jsonBytes(packet.pin),
  };
  // Removing only the four complete component values leaves these exact root framing bytes.
  const framing = '{"contract":' + JSON.stringify(packet.contract)
    + ',"pin":,"authorData":,"approvalEvidence":,"serverInterpretation":}';
  expect(measured).toEqual({
    contract: 'story-approved-profile-byte-breakdown-v1',
    wholeCandidateViewBytes: jsonBytes(packet),
    ...components,
    framingBytes: Buffer.from(framing, 'utf8').length,
  });
  expect(measured.wholeCandidateViewBytes).toBe(
    measured.authorDataBytes + measured.approvalEvidenceBytes + measured.serverInterpretationBytes
    + measured.approvalPinBytes + measured.framingBytes,
  );
  for (const [key, value] of Object.entries(measured)) {
    if (key === 'contract') continue;
    expect(Number.isSafeInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
  }
  expect(measured.wholeCandidateViewBytes).toBe(measureStoryApprovedProfileDelivery(packet).wholeCandidateViewBytes);
  return measured;
}

describe('story approved profile component byte accounting', () => {
  it('returns exactly seven keys in a fresh frozen numeric result without authority or quality fields', () => {
    const { packet } = fixture();
    const first = expectAccounting(packet);
    const second = measureStoryApprovedProfileDeliveryComponents(packet);
    expect(Object.keys(first).sort()).toEqual([
      'contract', 'wholeCandidateViewBytes', 'authorDataBytes', 'approvalEvidenceBytes',
      'serverInterpretationBytes', 'approvalPinBytes', 'framingBytes',
    ].sort());
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(second)).toBe(true);
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
    expect(packet.authorData.sections).toHaveLength(8);
  });

  it.each([
    ['ascii', 'Synthetic English text.'],
    // Escapes intentionally represent synthetic Korean/emoji/control characters, never owner text.
    ['unicode', '\uD55C\uAE00 \u{1F600}\u0301'],
    ['json-escapes', '"\\\n\t\u0000'],
  ] as const)('counts complete UTF-8 JSON for %s and preserves normalized scalar values', (name, text) => {
    const { packet, row } = fixture({
      sample: text, unknownAuthorField: [null, false, 0, '  kept  ', { empty: '', repeated: [text, text] }],
    }, [{ ...EVIDENCE[0], summary: 'Synthetic proof ' + text }], 'synthetic-pin-' + text);
    const before = JSON.stringify(packet), rowBefore = JSON.stringify(row);
    const measured = expectAccounting(packet);
    const style = packet.authorData.sections.find(section => section.key === 'writing_style')!;
    expect(style.value.sample).toBe(text);
    expect(style.value.unknownAuthorField).toEqual([
      null, false, 0, '  kept  ', { empty: '', repeated: [text, text] },
    ]);
    if (name === 'unicode') {
      expect(measured.authorDataBytes).toBeGreaterThan(JSON.stringify(packet.authorData).length);
      expect(measured.approvalEvidenceBytes).toBeGreaterThan(JSON.stringify(packet.approvalEvidence).length);
      expect(measured.approvalPinBytes).toBeGreaterThan(JSON.stringify(packet.pin).length);
    }
    if (name === 'json-escapes') {
      expect(JSON.stringify(style.value.sample)).toContain('\\n');
      expect(JSON.stringify(style.value.sample)).toContain('\\u0000');
    }
    expect(JSON.stringify(packet)).toBe(before);
    expect(JSON.stringify(row)).toBe(rowBefore);
  });

  it('counts repeated author observations, parallel evidence and structural indices without deduplication', () => {
    const single = fixture();
    const duplicateEvidence = [EVIDENCE[0], EVIDENCE[1], EVIDENCE[0]];
    const repeated = fixture({ observations: [OBSERVATION, OBSERVATION] }, duplicateEvidence);
    const before = JSON.stringify(repeated.packet);
    const a = expectAccounting(single.packet), b = expectAccounting(repeated.packet);
    const style = repeated.packet.authorData.sections.find(section => section.key === 'writing_style')!;
    expect(style.value.observations).toEqual([OBSERVATION, OBSERVATION]);
    expect(repeated.packet.approvalEvidence.find(section => section.key === 'writing_style')!.items).toEqual(duplicateEvidence);
    expect(repeated.packet.serverInterpretation.sections.find(section => section.key === 'writing_style')!
      .structuralSources.map(source => source.observationIndex)).toEqual([0, 1]);
    expect(b.approvalEvidenceBytes - a.approvalEvidenceBytes).toBe(jsonBytes(EVIDENCE[0]) + 1);
    expect(b.authorDataBytes - a.authorDataBytes).toBe(jsonBytes(OBSERVATION) + 1);
    expect(b.serverInterpretationBytes).toBeGreaterThan(a.serverInterpretationBytes);
    expect(b.approvalPinBytes).toBe(a.approvalPinBytes);
    expect(b.framingBytes).toBe(a.framingBytes);
    expect(JSON.stringify(repeated.packet)).toBe(before);
  });

  it('does not mutate, clone, freeze or replace caller-owned packet objects during measurement', () => {
    const { row, packet } = fixture({ custom: [null, false, 0, '  preserved  '] });
    const mutable = JSON.parse(JSON.stringify(packet)) as StoryApprovedProfileDeliveryPacket;
    decodeStoryApprovedProfileDelivery(mutable, row, STORY_APPROVED_PROFILE_DELIVERY_CONTRACT, profileObservationSource);
    const before = JSON.stringify(mutable);
    const refs = [mutable.pin, mutable.authorData, mutable.authorData.sections,
      mutable.approvalEvidence, mutable.serverInterpretation];
    expectAccounting(mutable);
    expect([mutable.pin, mutable.authorData, mutable.authorData.sections,
      mutable.approvalEvidence, mutable.serverInterpretation]).toEqual(refs);
    expect(mutable.pin).toBe(refs[0]);
    expect(mutable.authorData).toBe(refs[1]);
    expect(mutable.authorData.sections).toBe(refs[2]);
    expect(mutable.approvalEvidence).toBe(refs[3]);
    expect(mutable.serverInterpretation).toBe(refs[4]);
    expect(Object.isFrozen(mutable)).toBe(false);
    expect(refs.every(value => !Object.isFrozen(value))).toBe(true);
    expect(JSON.stringify(mutable)).toBe(before);
  });

  it('accounts for validated packets at cap and one byte above it without changing the existing measurement contract', () => {
    const empty = fixture({ paddingA: '', paddingB: '' });
    const needed = 16384 - jsonBytes(empty.packet);
    expect(needed).toBeGreaterThan(0);
    expect(needed).toBeLessThan(16000);
    const first = Math.min(8000, needed);
    const atCap = fixture({ paddingA: 'x'.repeat(first), paddingB: 'x'.repeat(needed - first) });
    const above = fixture({ paddingA: 'x'.repeat(first), paddingB: 'x'.repeat(needed - first + 1) });
    for (const [packet, bytes, fits, refusal] of [
      [atCap.packet, 16384, true, null],
      [above.packet, 16385, false, 'profile_view_too_large'],
    ] as const) {
      const before = JSON.stringify(packet);
      expect(expectAccounting(packet).wholeCandidateViewBytes).toBe(bytes);
      expect(measureStoryApprovedProfileDelivery(packet)).toEqual({
        byteCap: 16384, wholeCandidateViewBytes: bytes, candidateViewFits: fits, refusal,
        wholeRequestInputFit: 'unmeasured', productionAdmissionVerified: false,
        authorSemanticApprovalVerified: false, actualModelQualityVerified: false,
      });
      expect(JSON.stringify(packet)).toBe(before);
    }
    expect(STORY_APPROVED_PROFILE_DELIVERY_LIMITS).toEqual({
      viewBytes: 16384, inputTokens: 32768, outputTokens: 8192,
    });
  });

  it('preserves an oversized approved synthetic Unicode packet and all normalized evidence', () => {
    const duplicateEvidence = [EVIDENCE[0], EVIDENCE[1], EVIDENCE[0]];
    const { packet, row, settings } = fixture({
      summary: '\uD55C'.repeat(6000), custom: '\uAE00'.repeat(6000), observations: [OBSERVATION, OBSERVATION],
    }, duplicateEvidence);
    const before = JSON.stringify(packet);
    const measured = expectAccounting(packet);
    expect(measured.wholeCandidateViewBytes).toBeGreaterThan(16384);
    expect(measured.authorDataBytes).toBeGreaterThan(36000);
    expect(measureStoryApprovedProfileDelivery(packet)).toMatchObject({
      byteCap: 16384, candidateViewFits: false, refusal: 'profile_view_too_large',
      wholeRequestInputFit: 'unmeasured', actualModelQualityVerified: false,
    });
    expect(packet.approvalEvidence.find(section => section.key === 'writing_style')!.items).toEqual(duplicateEvidence);
    expect(decodeStoryApprovedProfileDelivery(
      packet, row, STORY_APPROVED_PROFILE_DELIVERY_CONTRACT, profileObservationSource,
    ).settings).toEqual(settings);
    expect(JSON.stringify(packet)).toBe(before);
  });
});


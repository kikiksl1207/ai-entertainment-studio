import 'reflect-metadata';
import {
  CREATOR_GENERATION_PROFILE_SCHEMA, STORY_PROFILE_SECTION_KEYS,
  creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile,
  type CreatorGenerationProfileEvidence,
} from '../generation-profile/creator-generation-profile.policy';
import { profileObservationSource } from './story-continuation-context.policy';
import {
  buildStoryApprovedProfileDelivery, decodeStoryApprovedProfileDelivery,
  measureStoryApprovedProfileDelivery, STORY_APPROVED_PROFILE_DELIVERY_CONTRACT,
  STORY_APPROVED_PROFILE_DELIVERY_LIMITS,
  type StoryApprovedProfileDeliveryPacket, type StoryApprovedProfileDeliveryPin,
  type StoryApprovedProfileDeliveryRow, type StoryApprovedProfileDeliverySourceResolver,
} from './story-approved-profile-delivery.policy';
import {
  measureStoryApprovedProfileSectionByteMetric, StoryApprovedProfileSectionByteMetricError,
  STORY_APPROVED_PROFILE_SECTION_BYTE_METRIC_CONTRACT, STORY_APPROVED_PROFILE_SECTION_BYTE_WORK_BYTES,
  type StoryApprovedProfileSectionByteMetricErrorCode,
} from './story-approved-profile-section-byte-metric.policy';

const SOURCE_REF = 'analysis:11111111-1111-4111-8111-111111111111';
const OBSERVATION = { title: 'Synthetic title.', detail: 'Synthetic complete exception.', sourceRef: SOURCE_REF };
const EVIDENCE: CreatorGenerationProfileEvidence[] = [
  { sourceType: 'manuscript', sourceRef: SOURCE_REF + ':part-a:4', summary: 'Synthetic first proof.' },
  { sourceType: 'manuscript', sourceRef: SOURCE_REF + ':part-a:4', summary: 'Synthetic second proof.' },
  { sourceType: 'manuscript', sourceRef: SOURCE_REF + ':part-a:4', summary: 'Synthetic first proof.' },
];
// Escapes represent synthetic Unicode/control characters, never owner prose.
const STYLE = {
  summary: '  Synthetic \uD55C\uAE00\n\t\u{1F600}\u0301 " \\  ',
  observations: [OBSERVATION, OBSERVATION],
  categories: [{ category: 'Synthetic category.', observations: ['same', 'same'] }],
  active: false, scope: 'reader_history', sourceParagraphIndex: 999,
  unknownAuthorField: [null, false, 0, '', '  kept  ', { z: ' retained ', a: false }],
};

function fixture(style: Record<string, unknown> = STYLE, otherPadding = '') {
  const settings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
      key, decision: key === 'writing_style' ? 'edited' : key === 'narrative_devices' ? 'unknown'
        : key === 'visual_cast' ? 'removed' : 'accepted',
      value: key === 'writing_style' ? style : { summary: 'Synthetic ' + key + '.', unknownOther: otherPadding },
      evidence: key === 'writing_style' ? EVIDENCE : [
        { sourceType: 'metadata', sourceRef: 'synthetic:' + key, summary: 'Synthetic ' + key + ' evidence.' },
      ],
    })).reverse(),
  });
  const sourceFingerprint = 'a'.repeat(64);
  const row: StoryApprovedProfileDeliveryRow = {
    id: 'synthetic-section-profile', status: 'approved', profileVersion: 1, reviewRevision: 3,
    sourceFingerprint, approvedSettings: settings,
    approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings),
  };
  const pin: StoryApprovedProfileDeliveryPin = {
    id: row.id, profileVersion: row.profileVersion, reviewRevision: row.reviewRevision,
    sourceFingerprint, approvedFingerprint: row.approvedFingerprint!,
  };
  const built = buildStoryApprovedProfileDelivery(row, pin, profileObservationSource);
  const packet = decodeStoryApprovedProfileDelivery(
    built, row, STORY_APPROVED_PROFILE_DELIVERY_CONTRACT, profileObservationSource,
  ).packet;
  return { row, settings, packet };
}
const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
function measure(packet: StoryApprovedProfileDeliveryPacket, row: StoryApprovedProfileDeliveryRow) {
  return measureStoryApprovedProfileSectionByteMetric(packet, row, profileObservationSource);
}
function expectCode(action: () => unknown, code: StoryApprovedProfileSectionByteMetricErrorCode) {
  try { action(); }
  catch (error) {
    expect(error).toBeInstanceOf(StoryApprovedProfileSectionByteMetricError);
    const failure = error as StoryApprovedProfileSectionByteMetricError;
    expect(failure.code).toBe(code); expect(failure.message).toBe(code);
    expect(failure.stack).toBeUndefined(); expect(Object.prototype.hasOwnProperty.call(failure, 'cause')).toBe(false);
    expect(Object.isFrozen(failure)).toBe(true);
    return;
  }
  throw new Error('Expected opaque section byte metric failure');
}
function frozenClone(packet: StoryApprovedProfileDeliveryPacket, change: (copy: StoryApprovedProfileDeliveryPacket) => void) {
  const copy = JSON.parse(JSON.stringify(packet)) as StoryApprovedProfileDeliveryPacket;
  change(copy);
  function freeze(value: unknown): void {
    if (value !== null && typeof value === 'object') {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
  }
  freeze(copy);
  return copy;
}
function expectAccounting(packet: StoryApprovedProfileDeliveryPacket, row: StoryApprovedProfileDeliveryRow) {
  const result = measure(packet, row);
  const sections = packet.authorData.sections.map((section, index) => ({
    key: section.key, authorSectionBytes: jsonBytes(section), authorValueBytes: jsonBytes(section.value),
    approvalEvidenceEntryBytes: jsonBytes(packet.approvalEvidence[index]),
  }));
  const style = sections.find(section => section.key === 'writing_style')!;
  const authorFrame = '{"schemaVersion":' + JSON.stringify(packet.authorData.schemaVersion)
    + ',"kind":"story","sections":}';
  const wholeFrame = '{"contract":' + JSON.stringify(packet.contract)
    + ',"pin":,"authorData":,"approvalEvidence":,"serverInterpretation":}';
  expect(result).toEqual({
    contract: STORY_APPROVED_PROFILE_SECTION_BYTE_METRIC_CONTRACT, byteCap: 16384,
    wholeCandidateViewBytes: jsonBytes(packet), authorDataBytes: jsonBytes(packet.authorData),
    approvalEvidenceBytes: jsonBytes(packet.approvalEvidence), serverInterpretationBytes: jsonBytes(packet.serverInterpretation),
    approvalPinBytes: jsonBytes(packet.pin), framingBytes: Buffer.byteLength(wholeFrame, 'utf8'),
    sections, sectionsArrayFramingBytes: 2 + sections.length - 1,
    authorObjectFramingBytes: Buffer.byteLength(authorFrame, 'utf8'),
    approvalEvidenceArrayFramingBytes: 2 + packet.approvalEvidence.length - 1,
    writingStyleSectionBytes: style.authorSectionBytes, writingStyleValueBytes: style.authorValueBytes,
    modelInputFit: 'unmeasured', semanticQualityVerified: false, dispatchAuthorized: false,
    providerCalls: 0, operatingWrites: 0,
  });
  expect(result.authorDataBytes).toBe(result.sections.reduce((sum, item) => sum + item.authorSectionBytes, 0)
    + result.sectionsArrayFramingBytes + result.authorObjectFramingBytes);
  expect(result.approvalEvidenceBytes).toBe(result.sections.reduce((sum, item) => sum + item.approvalEvidenceEntryBytes, 0)
    + result.approvalEvidenceArrayFramingBytes);
  expect(result.wholeCandidateViewBytes).toBe(result.authorDataBytes + result.approvalEvidenceBytes
    + result.serverInterpretationBytes + result.approvalPinBytes + result.framingBytes);
  for (const value of Object.values(result)) {
    if (typeof value === 'number') expect(Number.isSafeInteger(value) && value >= 0).toBe(true);
  }
  for (const section of result.sections) {
    expect(Object.keys(section)).toEqual(['key', 'authorSectionBytes', 'authorValueBytes', 'approvalEvidenceEntryBytes']);
    for (const [key, value] of Object.entries(section)) {
      if (key !== 'key') expect(Number.isSafeInteger(value) && Number(value) >= 0).toBe(true);
    }
  }
  return result;
}

describe('story approved profile section byte metric', () => {
  it('revalidates the current decoded packet and returns fresh frozen numeric-only accounting', () => {
    const { row, packet } = fixture();
    const first = expectAccounting(packet, row), second = measure(packet, row);
    expect(first).toEqual(second); expect(first).not.toBe(second);
    expect(Object.isFrozen(first) && Object.isFrozen(first.sections)).toBe(true);
    expect(first.sections.every(section => Object.isFrozen(section))).toBe(true);
    expect(second.sections).not.toBe(first.sections);
    expect(first.sections.map(section => section.key)).toEqual(packet.authorData.sections.map(section => section.key));
    expect(first.sections).toHaveLength(8);
    for (const key of ['packet', 'pin', 'id', 'sourceFingerprint', 'approvedFingerprint', 'data', 'model', 'candidateViewFits',
      'normalizedApprovalPreserved', 'currentOwnerVerified', 'liveApprovalAuthorityVerified']) {
      expect(Object.prototype.hasOwnProperty.call(first, key)).toBe(false);
    }
    const output = JSON.stringify(first);
    for (const privateText of [row.id, row.sourceFingerprint, row.approvedFingerprint!, SOURCE_REF, OBSERVATION.detail, STYLE.summary]) {
      expect(output.includes(privateText)).toBe(false);
    }
    expect(STORY_APPROVED_PROFILE_DELIVERY_LIMITS).toEqual({ viewBytes: 16384, inputTokens: 32768, outputTokens: 8192 });
  });

  it('preserves FULL Unicode, whitespace, escaping, controls, falsy and unknown value fields', () => {
    const { row, packet, settings } = fixture({ ...STYLE, unknownControl: '\u0000\r\n\t"\\' });
    const before = Buffer.from(JSON.stringify(packet)), rowBefore = Buffer.from(JSON.stringify(row));
    const refs = [packet.authorData, packet.authorData.sections, packet.approvalEvidence, packet.serverInterpretation, packet.pin];
    const result = expectAccounting(packet, row), style = packet.authorData.sections.find(section => section.key === 'writing_style')!;
    expect(style.value).toEqual({ ...STYLE, unknownControl: '\u0000\r\n\t"\\' });
    expect(packet.serverInterpretation.sections.find(section => section.key === 'writing_style')!.active).toBe(true);
    expect(packet.serverInterpretation.sections.find(section => section.key === 'writing_style')!.scope).toBe('production_constraint');
    expect(result.writingStyleValueBytes).toBeGreaterThan(JSON.stringify(style.value).length);
    expect(result.writingStyleSectionBytes).toBeGreaterThan(result.writingStyleValueBytes);
    expect(packet.authorData.sections).toEqual(settings.sections.map(({ key, decision, value }) => ({ key, decision, value })));
    expect(Buffer.from(JSON.stringify(packet)).equals(before)).toBe(true);
    expect(Buffer.from(JSON.stringify(row)).equals(rowBefore)).toBe(true);
    expect(packet.authorData).toBe(refs[0]); expect(packet.authorData.sections).toBe(refs[1]);
    expect(packet.approvalEvidence).toBe(refs[2]); expect(packet.serverInterpretation).toBe(refs[3]); expect(packet.pin).toBe(refs[4]);
  });

  it('counts evidence separately without deduplicating observations, evidence or normalized order', () => {
    const { row, packet } = fixture();
    const style = packet.authorData.sections.find(section => section.key === 'writing_style')!;
    const evidence = packet.approvalEvidence.find(section => section.key === 'writing_style')!;
    const result = expectAccounting(packet, row), counted = result.sections.find(section => section.key === 'writing_style')!;
    expect(style.value.observations).toEqual([OBSERVATION, OBSERVATION]); expect(evidence.items).toEqual(EVIDENCE);
    expect(counted.authorSectionBytes).toBe(jsonBytes(style)); expect(counted.approvalEvidenceEntryBytes).toBe(jsonBytes(evidence));
    expect(counted.authorSectionBytes).toBeLessThan(jsonBytes({ ...style, evidence: evidence.items }));
    expect(packet.serverInterpretation.sections.find(section => section.key === 'writing_style')!
      .structuralSources.map(source => source.observationIndex)).toEqual([0, 1]);
  });

  it('counts removed and unknown nonblocking sections in the complete authorData', () => {
    const { row, packet } = fixture();
    const result = expectAccounting(packet, row);
    for (const key of ['narrative_devices', 'visual_cast']) {
      expect(packet.serverInterpretation.sections.find(section => section.key === key)!.active).toBe(false);
      expect(result.sections.find(section => section.key === key)!.authorValueBytes).toBeGreaterThan(0);
      expect(result.sections.find(section => section.key === key)!.approvalEvidenceEntryBytes).toBeGreaterThan(0);
    }
  });

  it('does not infer a style overflow from aggregate authorData overflow', () => {
    const { row, packet } = fixture(STYLE, 'x'.repeat(4000));
    const result = expectAccounting(packet, row);
    expect(result.authorDataBytes).toBeGreaterThan(16384); expect(result.writingStyleSectionBytes).toBeLessThan(16384);
    expect(measureStoryApprovedProfileDelivery(packet).candidateViewFits).toBe(false);
    expect(result.modelInputFit).toBe('unmeasured'); expect(result.semanticQualityVerified || result.dispatchAuthorized).toBe(false);
  });

  it('counts a whole overflowing style value without dropping it or granting parts-only fit', () => {
    const { row, packet } = fixture({ ...STYLE, unknownPayload: Array.from({ length: 6 }, () => 'R'.repeat(4000)) });
    const before = JSON.stringify(packet), result = expectAccounting(packet, row);
    expect(result.writingStyleValueBytes).toBeGreaterThan(16384);
    expect(result.writingStyleSectionBytes).toBeGreaterThan(result.writingStyleValueBytes);
    expect(measureStoryApprovedProfileDelivery(packet).candidateViewFits).toBe(false);
    expect(JSON.stringify(packet)).toBe(before); expect(Object.prototype.hasOwnProperty.call(result, 'styleFits')).toBe(false);
  });

  it('keeps the original whole cap measurement at cap minus one, cap and cap plus one', () => {
    const base = fixture({ ...STYLE, paddingA: '', paddingB: '' });
    const needed = 16384 - jsonBytes(base.packet);
    expect(needed).toBeGreaterThan(1); expect(needed).toBeLessThan(16000);
    const first = Math.min(8000, needed - 1);
    for (const delta of [-1, 0, 1]) {
      const { row, packet } = fixture({ ...STYLE, paddingA: 'x'.repeat(first), paddingB: 'x'.repeat(needed - first + delta) });
      const result = expectAccounting(packet, row), originalMeasure = measureStoryApprovedProfileDelivery(packet);
      expect(result.wholeCandidateViewBytes).toBe(16384 + delta);
      expect(originalMeasure.byteCap).toBe(16384); expect(originalMeasure.candidateViewFits).toBe(delta <= 0);
      expect(originalMeasure.wholeRequestInputFit).toBe('unmeasured'); expect(originalMeasure.actualModelQualityVerified).toBe(false);
    }
  });

  it('requires an explicit current-row/resolver binding instead of trusting an arbitrary frozen packet', () => {
    const { row, packet } = fixture();
    expectCode(() => measure(packet, undefined as unknown as StoryApprovedProfileDeliveryRow), 'approval_invalid');
    expectCode(() => measureStoryApprovedProfileSectionByteMetric(packet, row,
      undefined as unknown as StoryApprovedProfileDeliverySourceResolver), 'approval_invalid');
    expectCode(() => measure(Object.freeze({}) as unknown as StoryApprovedProfileDeliveryPacket, row), 'approval_invalid');
    const mutable = JSON.parse(JSON.stringify(packet)) as StoryApprovedProfileDeliveryPacket;
    expectCode(() => measure(mutable, row), 'approval_invalid'); expect(Object.isFrozen(mutable)).toBe(false);
    const wholeOrmRow = { ...row, createdAt: new Date(0) };
    expectCode(() => measure(packet, wholeOrmRow), 'approval_invalid');
  });

  it('rejects draft, rejected, withdrawn or missing current approval', () => {
    const { row, packet } = fixture();
    for (const status of ['draft', 'rejected', 'withdrawn', 'removed']) {
      expectCode(() => measure(packet, { ...row, status }), 'approval_invalid');
    }
    expectCode(() => measure(packet, { ...row, approvedFingerprint: null }), 'approval_invalid');
  });

  it('rejects all stale five-pin dimensions and a current fingerprint mismatch', () => {
    const { row, packet } = fixture();
    for (const changed of [
      { ...row, id: 'synthetic-other-profile' }, { ...row, profileVersion: row.profileVersion + 1 },
      { ...row, reviewRevision: row.reviewRevision + 1 }, { ...row, sourceFingerprint: 'b'.repeat(64) },
      { ...row, approvedFingerprint: 'c'.repeat(64) },
    ]) expectCode(() => measure(packet, changed), 'approval_invalid');
    const stale = fixture();
    stale.settings.sections.find(section => section.key === 'writing_style')!.value.summary = 'Synthetic changed value.';
    expectCode(() => measure(stale.packet, stale.row), 'approval_invalid');
  });

  it('rejects incomplete actual approvability rather than measuring a partial approval', () => {
    for (const missing of [false, true]) {
      const { row, packet, settings } = fixture();
      if (missing) settings.sections.pop();
      else settings.sections.find(section => section.key === 'writing_style')!.decision = 'unknown';
      row.approvedFingerprint = creatorGenerationProfileFingerprint(row.sourceFingerprint, settings);
      expectCode(() => measure(packet, row), 'approval_invalid');
    }
  });

  it('rejects tampered contract, values, evidence alignment/order and server authority', () => {
    const { row, packet } = fixture();
    const changes: Array<(copy: StoryApprovedProfileDeliveryPacket) => void> = [
      copy => { (copy as unknown as { contract: string }).contract = 'synthetic-unconsumed-version'; },
      copy => { copy.authorData.sections.find(section => section.key === 'writing_style')!.value.summary = 'Synthetic replacement.'; },
      copy => { copy.approvalEvidence[0].key = 'writing_style'; },
      copy => { const items = copy.approvalEvidence.find(section => section.key === 'writing_style')!.items;
        [items[0], items[1]] = [items[1], items[0]]; },
      copy => { copy.authorData.sections.pop(); },
      copy => { copy.serverInterpretation.sections.find(section => section.key === 'writing_style')!.active = false; },
      copy => { Object.assign(copy.authorData.sections[0].value, { reader_history: true }); },
      copy => { Object.assign(copy, { extraAuthority: true }); },
    ];
    for (const change of changes) expectCode(() => measure(frozenClone(packet, change), row), 'approval_invalid');
  });

  it('allows bounded noncyclic aliases while counting every duplicate reference', () => {
    const shared = { z: '  same  ', a: [null, false, 0] };
    const { row, packet, settings } = fixture({ ...STYLE, unknownAliases: [shared, shared] });
    settings.sections.find(section => section.key === 'writing_style')!.value.unknownAliases = [shared, shared];
    const result = expectAccounting(packet, row);
    expect(result.writingStyleValueBytes).toBe(jsonBytes(packet.authorData.sections.find(section => section.key === 'writing_style')!.value));
    expect(settings.sections.find(section => section.key === 'writing_style')!.value.unknownAliases).toEqual([shared, shared]);
  });

  it('bounds a compact alias DAG and long escaped strings before decoder or JSON expansion', () => {
    const { row } = fixture();
    let tree: unknown = 0;
    for (let level = 0; level < 40; level++) tree = Object.freeze([tree, tree]);
    expect(STORY_APPROVED_PROFILE_SECTION_BYTE_WORK_BYTES).toBe(262144);
    for (const input of [Object.freeze({ tree }), Object.freeze({ text: '\u0000'.repeat(262144) })]) {
      expectCode(() => measure(input as unknown as StoryApprovedProfileDeliveryPacket, row), 'work_limit_exceeded');
    }
    const settings = Object.freeze({ text: 'x'.repeat(262144) });
    expectCode(() => measure(fixture().packet, { ...row, approvedSettings: settings }), 'work_limit_exceeded');
  });

  it('rejects a valid FULL factory packet over the work limit without partial section results', () => {
    const { row, settings } = fixture();
    for (const section of settings.sections) {
      section.value = { observations: Array.from({ length: 200 }, () => ({ sourceRef: SOURCE_REF })) };
      section.evidence = EVIDENCE;
    }
    row.approvedFingerprint = creatorGenerationProfileFingerprint(row.sourceFingerprint, settings);
    const pin: StoryApprovedProfileDeliveryPin = { id: row.id, profileVersion: row.profileVersion,
      reviewRevision: row.reviewRevision, sourceFingerprint: row.sourceFingerprint,
      approvedFingerprint: row.approvedFingerprint! };
    const built = buildStoryApprovedProfileDelivery(row, pin, profileObservationSource);
    const packet = decodeStoryApprovedProfileDelivery(built, row,
      STORY_APPROVED_PROFILE_DELIVERY_CONTRACT, profileObservationSource).packet;
    const before = JSON.stringify(packet);
    expect(jsonBytes(packet)).toBeGreaterThan(STORY_APPROVED_PROFILE_SECTION_BYTE_WORK_BYTES);
    expectCode(() => measure(packet, row), 'work_limit_exceeded');
    expect(JSON.stringify(packet)).toBe(before);
  });

  it('rejects lossy JSON values, hidden fields, symbols, sparse arrays, cycles and custom prototypes', () => {
    const { row } = fixture();
    const sparse = Object.freeze(new Array(1));
    const hidden = Object.freeze(Object.defineProperty({}, 'hidden', { value: 1 }));
    const symbol = Object.freeze({ [Symbol('synthetic')]: 1 });
    const cycle: { child?: unknown } = {}; cycle.child = cycle; Object.freeze(cycle);
    for (const input of [undefined, () => 0, 1n, NaN, Infinity, -0, sparse, hidden, symbol, cycle,
      Object.freeze(Object.create(null)), Object.freeze(new Date(0)), Object.freeze(Object.create({ inherited: 1 }))]) {
      expectCode(() => measure(input as unknown as StoryApprovedProfileDeliveryPacket, row), 'approval_invalid');
    }
  });

  it('rejects input getters and Proxy packet/row/resolver without invoking private-data traps', () => {
    const { row, packet } = fixture();
    let calls = 0;
    const trap = () => { calls++; throw new Error('Synthetic private trap'); };
    const getter = Object.freeze(Object.defineProperty({}, 'value', { enumerable: true, get: trap }));
    const proxy = new Proxy(packet, { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap, isExtensible: trap });
    const proxyRow = new Proxy(row, { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
    const proxyResolver = new Proxy(profileObservationSource, { apply: trap });
    expectCode(() => measure(getter as unknown as StoryApprovedProfileDeliveryPacket, row), 'approval_invalid');
    expectCode(() => measure(proxy, row), 'approval_invalid'); expectCode(() => measure(packet, proxyRow), 'approval_invalid');
    expectCode(() => measureStoryApprovedProfileSectionByteMetric(packet, row, proxyResolver), 'approval_invalid');
    const getterRow = { ...row };
    Object.defineProperty(getterRow, 'approvedSettings', { enumerable: true, get: trap });
    expectCode(() => measure(packet, getterRow), 'approval_invalid');
    expect(calls).toBe(0);
  });

  it('guards resolver output before accessing its properties and retains owned work-limit failures', () => {
    const { row, packet } = fixture();
    let calls = 0;
    const trap = () => { calls++; throw new Error('Synthetic private result'); };
    const result = new Proxy({ sourceRef: SOURCE_REF }, { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
    expectCode(() => measureStoryApprovedProfileSectionByteMetric(packet, row, () => result), 'approval_invalid');
    expect(calls).toBe(0);
    expectCode(() => measureStoryApprovedProfileSectionByteMetric(packet, row,
      () => ({ sourceRef: 'x'.repeat(262144) })), 'work_limit_exceeded');
  });

  it('rejects resolver-induced current-row changes and does not forward foreign error fields', () => {
    const { row, packet } = fixture();
    const changing: StoryApprovedProfileDeliverySourceResolver = (ref, evidence) => {
      row.reviewRevision++; return profileObservationSource(ref, evidence);
    };
    expectCode(() => measureStoryApprovedProfileSectionByteMetric(packet, row, changing), 'approval_invalid');
    const other = fixture();
    expectCode(() => measureStoryApprovedProfileSectionByteMetric(other.packet, other.row, () => {
      throw Object.freeze({ code: 'work_limit_exceeded', message: 'Synthetic private text', stack: 'Synthetic private stack' });
    }), 'approval_invalid');
  });

  it('closes foreign measurement failures without returning private payload, cause or stack', () => {
    const { row, packet } = fixture();
    const component = jest.spyOn(require('./story-approved-profile-delivery.policy') as
      typeof import('./story-approved-profile-delivery.policy'), 'measureStoryApprovedProfileDeliveryComponents').mockImplementation(() => {
      throw Object.freeze({ code: 'approval_invalid', message: 'Synthetic private text', stack: 'Synthetic private stack' });
    });
    try { expectCode(() => measure(packet, row), 'measurement_failed'); }
    finally { component.mockRestore(); }
    const error = new StoryApprovedProfileSectionByteMetricError('synthetic-foreign-code' as StoryApprovedProfileSectionByteMetricErrorCode);
    expect(error.code).toBe('measurement_failed'); expect(error.message).toBe('measurement_failed');
    expect(error.stack).toBeUndefined(); expect(Object.prototype.hasOwnProperty.call(error, 'cause')).toBe(false);
  });
});

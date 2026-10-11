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
  StoryApprovedProfileDeliveryError,
  buildStoryApprovedProfileDelivery,
  decodeStoryApprovedProfileDelivery,
  measureStoryApprovedProfileDelivery,
  type StoryApprovedProfileDeliveryErrorCode,
  type StoryApprovedProfileDeliveryPacket,
  type StoryApprovedProfileDeliveryPin,
  type StoryApprovedProfileDeliveryRow,
  type StoryApprovedProfileDeliverySourceResolver,
} from './story-approved-profile-delivery.policy';

const SOURCE_REF = 'analysis:11111111-1111-4111-8111-111111111111';
const STYLE = {
  summary: '  Synthetic voice with exact spacing.  ',
  observations: [{ title: 'Whole title.', detail: 'Complete rule and its final exception.', sourceRef: SOURCE_REF }],
  categories: [{ category: 'Synthetic category.', observations: ['Complete sample.', 'Complete sample.'] }],
};
const EVIDENCE: CreatorGenerationProfileEvidence[] = [
  { sourceType: 'manuscript', sourceRef: `${SOURCE_REF}:part-a:4`, summary: 'First distinct synthetic evidence.' },
  { sourceType: 'manuscript', sourceRef: `${SOURCE_REF}:part-a:4`, summary: 'Second distinct synthetic evidence.' },
  { sourceType: 'manuscript', sourceRef: `${SOURCE_REF}:part-a:4`, summary: 'First distinct synthetic evidence.' },
];

function fixture(style: Record<string, unknown> = STYLE, evidence = EVIDENCE) {
  const settings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
      key, decision: key === 'writing_style' ? 'edited' : 'accepted',
      value: key === 'writing_style' ? style : { summary: `Synthetic ${key}.` },
      evidence: key === 'writing_style' ? evidence : [
        { sourceType: 'metadata', sourceRef: `synthetic:${key}`, summary: `Synthetic ${key} evidence.` },
      ],
    })).reverse(),
  });
  const sourceFingerprint = 'a'.repeat(64);
  const row: StoryApprovedProfileDeliveryRow = {
    id: 'synthetic-approved-profile', status: 'approved', profileVersion: 1, reviewRevision: 3,
    sourceFingerprint, approvedSettings: settings,
    approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings),
  };
  return { row, settings };
}

function pin(row: StoryApprovedProfileDeliveryRow): StoryApprovedProfileDeliveryPin {
  return {
    id: row.id, profileVersion: row.profileVersion, reviewRevision: row.reviewRevision,
    sourceFingerprint: row.sourceFingerprint, approvedFingerprint: row.approvedFingerprint!,
  };
}

function refreshFingerprint(row: StoryApprovedProfileDeliveryRow) {
  row.approvedFingerprint = creatorGenerationProfileFingerprint(
    row.sourceFingerprint, normalizeCreatorGenerationProfile('story', row.approvedSettings),
  );
}

function build(row: StoryApprovedProfileDeliveryRow) {
  return buildStoryApprovedProfileDelivery(row, pin(row), profileObservationSource);
}

function decode(packet: unknown, row: StoryApprovedProfileDeliveryRow,
  version = STORY_APPROVED_PROFILE_DELIVERY_CONTRACT) {
  return decodeStoryApprovedProfileDelivery(packet, row, version, profileObservationSource);
}

function copy(packet: StoryApprovedProfileDeliveryPacket): StoryApprovedProfileDeliveryPacket {
  return JSON.parse(JSON.stringify(packet)) as StoryApprovedProfileDeliveryPacket;
}

function authorSection(packet: StoryApprovedProfileDeliveryPacket, key = 'writing_style') {
  return packet.authorData.sections.find(section => section.key === key)!;
}

function interpretation(packet: StoryApprovedProfileDeliveryPacket, key = 'writing_style') {
  return packet.serverInterpretation.sections.find(section => section.key === key)!;
}

function expectCode(action: () => unknown, code: StoryApprovedProfileDeliveryErrorCode) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(StoryApprovedProfileDeliveryError);
    expect(error).toMatchObject({ name: 'StoryApprovedProfileDeliveryError', code, message: code });
    return;
  }
  throw new Error(`Expected delivery error: ${code}`);
}

describe('story approved profile delivery codec', () => {
  it('preserves every normalized section, decision, value and parallel evidence in order', () => {
    const { row, settings } = fixture();
    const packet = build(row);
    expect(packet.contract).toBe('story-approved-profile-delivery-v1');
    expect(packet.pin).toEqual(pin(row));
    expect(packet.authorData.sections).toEqual(settings.sections.map(({ key, decision, value }) => ({ key, decision, value })));
    expect(packet.approvalEvidence).toEqual(settings.sections.map(({ key, evidence }) => ({ key, items: evidence })));
    expect(packet.authorData.sections.map(section => section.key)).toEqual(settings.sections.map(section => section.key));
    const decoded = decode(copy(packet), row);
    expect(decoded.packet).toEqual(packet);
    expect(decoded.settings).toEqual(settings);
    expect(decoded.normalizedApprovalPreserved).toBe(true);
    expect(decoded.structuralConnectionIsSemanticApproval).toBe(false);
  });

  it('preserves Unicode, whitespace, null, false, zero and unknown nested author fields', () => {
    // Escapes cover synthetic Korean, emoji, combining marks and whitespace without recording author text.
    const style = {
      summary: '  \uD55C\uAE00\n\u{1F600}\u0301\t  ',
      unknownAuthorField: [null, false, 0, [' x ', { anotherUnknown: true }]],
      observations: [null, false, 0, '  kept  ', { customOnly: ' retained ' }],
    };
    const { row, settings } = fixture(style);
    const packet = build(row);
    expect(authorSection(packet).value).toEqual(style);
    expect(decode(copy(packet), row).settings).toEqual(settings);
  });

  it('does not claim raw-input identity where existing normalization sorts sections and trims evidence', () => {
    const { row, settings } = fixture(STYLE, [{
      sourceType: 'manuscript', sourceRef: `  ${SOURCE_REF}:part-a:4  `, summary: '  Synthetic evidence.  ',
    }]);
    const rawSections = settings.sections.map(section => ({ ...section, key: ` ${section.key} ` })).reverse();
    row.approvedSettings = { ...settings, sections: rawSections, ignoredRawRoot: true };
    const packet = build(row);
    expect(packet.authorData.sections.map(section => section.key)).toEqual(settings.sections.map(section => section.key));
    expect(packet.approvalEvidence.find(section => section.key === 'writing_style')!.items[0]).toEqual({
      sourceType: 'manuscript', sourceRef: `${SOURCE_REF}:part-a:4`, summary: 'Synthetic evidence.',
    });
    expect(decode(packet, row).settings).toEqual(settings);
    expect(row.approvedSettings).toEqual({ ...settings, sections: rawSections, ignoredRawRoot: true });
  });

  it('preserves duplicate observations, categories, category strings and evidence without deduplication', () => {
    const { row, settings } = fixture({
      observations: [STYLE.observations[0], STYLE.observations[0]],
      categories: [STYLE.categories[0], STYLE.categories[0]],
    });
    const packet = build(row);
    expect(authorSection(packet).value.observations).toHaveLength(2);
    expect(authorSection(packet).value.categories).toHaveLength(2);
    expect(packet.approvalEvidence.find(section => section.key === 'writing_style')!.items).toEqual(EVIDENCE);
    expect(interpretation(packet).structuralSources.map(source => source.observationIndex)).toEqual([0, 1]);
    expect(decode(packet, row).settings).toEqual(settings);
  });

  it('separates author authority-like metadata from server-derived scope and structural indices', () => {
    const { row } = fixture({
      active: false, referenceScope: 'reader_history', dispatchAuthorized: true,
      observations: [{ detail: 'Synthetic rule.', sourceRef: SOURCE_REF,
        sourcePartKey: 'invented', sourceParagraphIndex: 999, referenceScope: 'reader_history', extra: 'retained' }],
    });
    const packet = build(row);
    expect(authorSection(packet).value.active).toBe(false);
    expect(authorSection(packet).value.referenceScope).toBe('reader_history');
    expect(authorSection(packet).value.dispatchAuthorized).toBe(true);
    expect(authorSection(packet).value.observations).toEqual([{
      detail: 'Synthetic rule.', sourceRef: SOURCE_REF, sourcePartKey: 'invented',
      sourceParagraphIndex: 999, referenceScope: 'reader_history', extra: 'retained',
    }]);
    expect(interpretation(packet)).toMatchObject({ active: true, scope: 'production_constraint', observationScope: 'writing_pattern' });
    expect(interpretation(packet).structuralSources).toEqual([{
      observationIndex: 0, source: { sourceRef: SOURCE_REF, sourcePartKey: 'part-a', sourceParagraphIndex: 4 },
    }]);
    expect(packet.serverInterpretation.evidenceIsReaderHistory).toBe(false);
    expect(packet.serverInterpretation.authorMetadataConfersAuthority).toBe(false);
    expect(interpretation(packet, 'canon').scope).toBe('author_plan_not_route_history');
    expect(interpretation(packet, 'scene_scale').scope).toBe('production_constraint');
    expect(interpretation(packet, 'branch_behavior').scope).toBe('production_constraint');
    expect(decode(packet, row).packet).toEqual(packet);
  });

  it('retains original observation indices across non-structural values and unsupported references', () => {
    const { row } = fixture({ observations: [
      null, { sourceRef: 'unsupported:synthetic', sourcePartKey: 'forged', sourceParagraphIndex: 9 },
      STYLE.observations[0], false, STYLE.observations[0],
    ] });
    const packet = build(row);
    expect(authorSection(packet).value.observations).toHaveLength(5);
    expect(interpretation(packet).structuralSources.map(source => source.observationIndex)).toEqual([2, 4]);
  });

  it('uses actual v6 ambiguity handling without treating evidence as semantic approval', () => {
    const { row } = fixture(STYLE, [EVIDENCE[0], { ...EVIDENCE[1], sourceRef: `${SOURCE_REF}:part-b:9` }]);
    const packet = build(row);
    expect(interpretation(packet).structuralSources).toEqual([{ observationIndex: 0, source: { sourceRef: SOURCE_REF } }]);
    expect(packet.approvalEvidence.find(section => section.key === 'writing_style')!.items).toHaveLength(2);
    expect(decode(packet, row).structuralConnectionIsSemanticApproval).toBe(false);
  });

  it.each(['removed', 'unknown'] as const)('preserves an optional %s section as inactive, including its value and evidence', decision => {
    const { row, settings } = fixture();
    const section = settings.sections.find(item => item.key === 'narrative_devices')!;
    section.decision = decision;
    section.value = { summary: 'Retained optional plan.', observations: [STYLE.observations[0]], unknown: false };
    section.evidence = EVIDENCE.map(item => ({ ...item }));
    refreshFingerprint(row);
    const packet = build(row);
    expect(authorSection(packet, section.key)).toEqual({ key: section.key, decision, value: section.value });
    expect(interpretation(packet, section.key).active).toBe(false);
    expect(packet.approvalEvidence.find(item => item.key === section.key)!.items).toEqual(section.evidence);
    expect(decode(packet, row).settings).toEqual(settings);
  });

  it.each(['draft', 'rejected', 'revoked', 'removed'])('rejects current row status %s in build and decode', status => {
    const { row } = fixture();
    const packet = build(row);
    const invalid = { ...row, status };
    expectCode(() => build(invalid), 'profile_not_approved');
    expectCode(() => decode(packet, invalid), 'profile_not_approved');
  });

  it('accepts nullable current-row DTOs but refuses missing approval', () => {
    const { row } = fixture();
    const packet = build(row);
    for (const invalid of [{ ...row, approvedFingerprint: null }, { ...row, approvedSettings: null }]) {
      expectCode(() => build(invalid), 'profile_not_approved');
      expectCode(() => decode(packet, invalid), 'profile_not_approved');
    }
  });

  it.each(['unknown', 'removed', 'proposed'] as const)('revalidates real approvability despite approved status: %s required section', decision => {
    const { row, settings } = fixture();
    const packet = build(row);
    settings.sections.find(section => section.key === 'writing_style')!.decision = decision;
    refreshFingerprint(row);
    expectCode(() => build(row), 'profile_review_incomplete');
    expectCode(() => decode(packet, row), 'profile_review_incomplete');
  });

  it('rejects missing required sections, proposed optional sections and invalid settings', () => {
    const missing = fixture();
    missing.settings.sections.pop();
    refreshFingerprint(missing.row);
    expectCode(() => build(missing.row), 'profile_review_incomplete');
    const proposed = fixture();
    proposed.settings.sections.find(section => section.key === 'narrative_devices')!.decision = 'proposed';
    refreshFingerprint(proposed.row);
    expectCode(() => build(proposed.row), 'profile_review_incomplete');
    const invalid = fixture();
    invalid.settings.sections[0].key = 'unknown_section';
    expectCode(() => build(invalid.row), 'profile_settings_invalid');
  });

  it('rejects source and approved fingerprint changes before accepting a current row', () => {
    const { row } = fixture();
    const packet = build(row);
    for (const invalid of [{ ...row, sourceFingerprint: 'b'.repeat(64) }, { ...row, approvedFingerprint: 'c'.repeat(64) }]) {
      expectCode(() => buildStoryApprovedProfileDelivery(invalid, pin(row), profileObservationSource), 'profile_fingerprint_changed');
      expectCode(() => decode(packet, invalid), 'profile_fingerprint_changed');
    }
  });

  it.each([
    ['id', { id: 'other-synthetic-profile' }],
    ['profileVersion', { profileVersion: 2 }],
    ['reviewRevision', { reviewRevision: 4 }],
    ['sourceFingerprint', { sourceFingerprint: 'b'.repeat(64) }],
    ['approvedFingerprint', { approvedFingerprint: 'c'.repeat(64) }],
  ] as const)('rejects a stale %s among all five expected and packet pins', (_key, changed) => {
    const { row } = fixture();
    expectCode(() => buildStoryApprovedProfileDelivery(row, { ...pin(row), ...changed }, profileObservationSource), 'profile_pin_stale');
    const packet = copy(build(row));
    packet.pin = { ...packet.pin, ...changed };
    expectCode(() => decode(packet, row), 'profile_pin_stale');
  });

  it('revalidates fresh current rows rather than accepting an internally consistent old packet', () => {
    const { row, settings } = fixture();
    const packet = build(row);
    for (const change of [{ id: 'fresh-synthetic-profile' }, { profileVersion: 2 }, { reviewRevision: 4 }]) {
      expectCode(() => decode(packet, { ...row, ...change }), 'profile_pin_stale');
    }
    const sourceChanged = { ...row, sourceFingerprint: 'b'.repeat(64) };
    refreshFingerprint(sourceChanged);
    expectCode(() => decode(packet, sourceChanged), 'profile_pin_stale');
    settings.sections.find(section => section.key === 'writing_style')!.value.summary = 'New synthetic approval.';
    refreshFingerprint(row);
    expectCode(() => decode(packet, row), 'profile_pin_stale');
  });

  it('rejects invalid pins and additional expected-pin authority', () => {
    const { row } = fixture();
    for (const changed of [
      { id: '' }, { id: ' ' }, { profileVersion: 0 }, { reviewRevision: 1.5 },
      { profileVersion: Number.MAX_SAFE_INTEGER + 1 }, { sourceFingerprint: 'not-a-fingerprint' },
      { approvedFingerprint: 'A'.repeat(64) }, { dispatchAuthorized: true },
    ]) {
      expectCode(() => buildStoryApprovedProfileDelivery(row, { ...pin(row), ...changed }, profileObservationSource), 'profile_pin_invalid');
    }
  });

  it('requires explicit consumer version agreement and rejects packet downgrade', () => {
    const { row } = fixture();
    const packet = build(row);
    expectCode(() => decodeStoryApprovedProfileDelivery(packet, row, 'story-profile-prompt-v6', profileObservationSource), 'delivery_version_unconsumed');
    for (const contract of ['story-profile-prompt-v6', 'story-approved-profile-delivery-v2', '']) {
      expectCode(() => decode({ ...copy(packet), contract }, row), 'delivery_version_unconsumed');
    }
  });

  it('rejects missing sections, values and evidence instead of restoring them through normalization', () => {
    const { row } = fixture();
    const missingSection = copy(build(row));
    missingSection.authorData.sections.pop();
    expectCode(() => decode(missingSection, row), 'profile_content_incomplete');
    const missingValue = copy(build(row));
    delete (authorSection(missingValue) as Partial<ReturnType<typeof authorSection>>).value;
    expectCode(() => decode(missingValue, row), 'profile_content_changed');
    const missingEvidence = copy(build(row));
    missingEvidence.approvalEvidence.find(section => section.key === 'writing_style')!.items.pop();
    expectCode(() => decode(missingEvidence, row), 'profile_content_changed');
  });

  it('rejects reordered or misaligned evidence and jointly reordered namespaces', () => {
    const { row } = fixture();
    const misaligned = copy(build(row));
    misaligned.approvalEvidence.reverse();
    expectCode(() => decode(misaligned, row), 'profile_evidence_misaligned');
    const reordered = copy(build(row));
    reordered.authorData.sections.reverse();
    reordered.approvalEvidence.reverse();
    expectCode(() => decode(reordered, row), 'profile_content_changed');
    const reorderedItems = copy(build(row));
    const items = reorderedItems.approvalEvidence.find(section => section.key === 'writing_style')!.items;
    [items[0], items[1]] = [items[1], items[0]];
    expectCode(() => decode(reorderedItems, row), 'profile_content_changed');
  });

  it('rejects changed author values, decisions and lost duplicate observations', () => {
    const { row } = fixture({ ...STYLE, observations: [STYLE.observations[0], STYLE.observations[0]] });
    const changedValue = copy(build(row));
    authorSection(changedValue).value.summary = 'Changed synthetic text.';
    expectCode(() => decode(changedValue, row), 'profile_content_changed');
    const changedDecision = copy(build(row));
    authorSection(changedDecision).decision = 'accepted';
    expectCode(() => decode(changedDecision, row), 'profile_content_changed');
    const deduplicated = copy(build(row));
    (authorSection(deduplicated).value.observations as unknown[]).pop();
    expectCode(() => decode(deduplicated, row), 'profile_content_changed');
  });

  it('rejects tampered server flags, scope, activity, source and observation index', () => {
    const { row } = fixture();
    const packet = build(row);
    const mutations: Array<(candidate: StoryApprovedProfileDeliveryPacket) => void> = [
      candidate => { Object.assign(candidate.serverInterpretation, { evidenceIsReaderHistory: true }); },
      candidate => { Object.assign(candidate.serverInterpretation, { authorMetadataConfersAuthority: true }); },
      candidate => { Object.assign(candidate.serverInterpretation, { contract: 'other-interpretation' }); },
      candidate => { interpretation(candidate).active = false; },
      candidate => { interpretation(candidate).scope = 'author_plan_not_route_history'; },
      candidate => { interpretation(candidate).observationScope = 'author_plan_not_route_history'; },
      candidate => { interpretation(candidate).structuralSources[0].source.sourceParagraphIndex = 99; },
      candidate => { interpretation(candidate).structuralSources[0].source.sourcePartKey = 'forged'; },
      candidate => { interpretation(candidate).structuralSources[0].observationIndex = 99; },
      candidate => { candidate.serverInterpretation.sections.reverse(); },
    ];
    for (const mutate of mutations) {
      const candidate = copy(packet);
      mutate(candidate);
      expectCode(() => decode(candidate, row), 'delivery_contract_changed');
    }
  });

  it('rejects extra authority outside author values in every delivery namespace', () => {
    const { row } = fixture();
    const packet = build(row);
    const mutations: Array<(candidate: StoryApprovedProfileDeliveryPacket) => void> = [
      candidate => { Object.assign(candidate, { publicationApproved: true }); },
      candidate => { Object.assign(candidate.authorData, { dispatchAuthorized: true }); },
      candidate => { Object.assign(authorSection(candidate), { active: true }); },
      candidate => { Object.assign(candidate.approvalEvidence[0], { evidenceIsReaderHistory: true }); },
      candidate => { Object.assign(candidate.serverInterpretation, { dispatchAuthorized: true }); },
      candidate => { Object.assign(interpretation(candidate), { approved: true }); },
    ];
    for (const mutate of mutations) {
      const candidate = copy(packet);
      mutate(candidate);
      expectCode(() => decode(candidate, row), 'delivery_contract_changed');
    }
  });

  it('rejects non-JSON authority, undefined-for-null substitution and sparse arrays', () => {
    const { row } = fixture({ nullable: null, observations: [STYLE.observations[0]] });
    const packet = build(row);
    const hidden = copy(packet);
    Object.defineProperty(hidden, 'dispatchAuthorized', { value: true, enumerable: false });
    expectCode(() => decode(hidden, row), 'delivery_contract_changed');
    const symbol = copy(packet);
    Object.assign(symbol, { [Symbol('authority')]: true });
    expectCode(() => decode(symbol, row), 'delivery_contract_changed');
    const accessor = copy(packet);
    const getter = jest.fn(() => true);
    Object.defineProperty(accessor.serverInterpretation, 'dispatchAuthorized', { get: getter, enumerable: true });
    expectCode(() => decode(accessor, row), 'delivery_contract_changed');
    expect(getter).not.toHaveBeenCalled();
    const undefinedValue = copy(packet);
    authorSection(undefinedValue).value.nullable = undefined;
    expectCode(() => decode(undefinedValue, row), 'delivery_contract_changed');
    const sparse = copy(packet);
    delete (authorSection(sparse).value.observations as unknown[])[0];
    expectCode(() => decode(sparse, row), 'delivery_contract_changed');
  });

  it('requires an explicit resolver and reports source failures without leaking resolver messages', () => {
    const { row } = fixture();
    expectCode(() => buildStoryApprovedProfileDelivery(row, pin(row), undefined as unknown as StoryApprovedProfileDeliverySourceResolver), 'profile_source_resolver_required');
    expectCode(() => buildStoryApprovedProfileDelivery(row, pin(row), () => { throw new Error('synthetic resolver detail'); }), 'profile_source_resolution_failed');
    expectCode(() => buildStoryApprovedProfileDelivery(row, pin(row), () => ({ sourceRef: SOURCE_REF, sourceParagraphIndex: 4 })), 'profile_structural_source_invalid');
    expectCode(() => buildStoryApprovedProfileDelivery(row, pin(row), () => ({ sourceRef: SOURCE_REF, dispatchAuthorized: true })), 'profile_structural_source_invalid');
    const packet = build(row);
    expectCode(() => decodeStoryApprovedProfileDelivery(packet, row, STORY_APPROVED_PROFILE_DELIVERY_CONTRACT, () => null), 'delivery_contract_changed');
  });

  it('measures UTF-8 bytes of the entire packet without asserting whole-input fit or model quality', () => {
    const { row } = fixture();
    const packet = build(row);
    const measured = measureStoryApprovedProfileDelivery(packet);
    expect(measured.byteCap).toBe(16384);
    expect(measured.wholeCandidateViewBytes).toBe(Buffer.byteLength(JSON.stringify(packet), 'utf8'));
    expect(measured.wholeCandidateViewBytes).toBeGreaterThan(Buffer.byteLength(JSON.stringify(packet.authorData), 'utf8'));
    expect(measured.candidateViewFits).toBe(true);
    expect(measured.refusal).toBeNull();
    expect(measured.wholeRequestInputFit).toBe('unmeasured');
    expect(measured.productionAdmissionVerified).toBe(false);
    expect(measured.authorSemanticApprovalVerified).toBe(false);
    expect(measured.actualModelQualityVerified).toBe(false);
  });

  it('reports exact fixed-cap boundaries without truncating or changing the supplied packet', () => {
    const { row } = fixture({ padding: '' });
    const packet = copy(build(row));
    const baseline = measureStoryApprovedProfileDelivery(packet).wholeCandidateViewBytes;
    authorSection(packet).value.padding = 'x'.repeat(16384 - baseline);
    const atCap = JSON.stringify(packet);
    expect(measureStoryApprovedProfileDelivery(packet)).toMatchObject({ wholeCandidateViewBytes: 16384, candidateViewFits: true, refusal: null });
    expect(JSON.stringify(packet)).toBe(atCap);
    authorSection(packet).value.padding = `${authorSection(packet).value.padding}x`;
    const aboveCap = JSON.stringify(packet);
    expect(measureStoryApprovedProfileDelivery(packet)).toMatchObject({ wholeCandidateViewBytes: 16385, candidateViewFits: false, refusal: 'profile_view_too_large' });
    expect(JSON.stringify(packet)).toBe(aboveCap);
  });

  it('preserves oversized approved Unicode and all evidence while reporting size refusal only', () => {
    const { row, settings } = fixture({
      summary: '\uD55C'.repeat(6000), custom: '\uAE00'.repeat(6000), observations: STYLE.observations,
    });
    const packet = build(row);
    const before = JSON.stringify(packet);
    expect(measureStoryApprovedProfileDelivery(packet)).toMatchObject({ candidateViewFits: false, refusal: 'profile_view_too_large' });
    expect(authorSection(packet).value.summary).toBe('\uD55C'.repeat(6000));
    expect(authorSection(packet).value.custom).toBe('\uAE00'.repeat(6000));
    expect(packet.approvalEvidence.find(section => section.key === 'writing_style')!.items).toEqual(EVIDENCE);
    expect(decode(copy(packet), row).settings).toEqual(settings);
    expect(JSON.stringify(packet)).toBe(before);
    expect(STORY_APPROVED_PROFILE_DELIVERY_LIMITS).toEqual({ viewBytes: 16384, inputTokens: 32768, outputTokens: 8192 });
  });

  it('freezes only fresh output and never freezes or mutates the current row or supplied packet', () => {
    const { row, settings } = fixture();
    const before = JSON.stringify(row);
    const packet = build(row);
    expect(Object.isFrozen(packet)).toBe(true);
    expect(Object.isFrozen(authorSection(packet).value.observations)).toBe(true);
    expect(Object.isFrozen(packet.approvalEvidence)).toBe(true);
    expect(Object.isFrozen(interpretation(packet).structuralSources[0].source)).toBe(true);
    expect(Object.isFrozen(row)).toBe(false);
    expect(Object.isFrozen(settings)).toBe(false);
    expect(JSON.stringify(row)).toBe(before);
    const supplied = copy(packet);
    const decoded = decode(supplied, row);
    expect(decoded.packet).not.toBe(supplied);
    expect(Object.isFrozen(supplied)).toBe(false);
    expect(Object.isFrozen(decoded.settings.sections)).toBe(true);
    expect(JSON.stringify(row)).toBe(before);
  });
});

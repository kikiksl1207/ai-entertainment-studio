import 'reflect-metadata';
import { gzipSync, gunzipSync } from 'node:zlib';
import {
  CREATOR_GENERATION_PROFILE_SCHEMA, STORY_PROFILE_SECTION_KEYS,
  creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile,
  type CreatorGenerationProfileEvidence,
} from '../generation-profile/creator-generation-profile.policy';
import { profileObservationSource } from './story-continuation-context.policy';
import {
  buildStoryApprovedProfileDelivery, decodeStoryApprovedProfileDelivery, measureStoryApprovedProfileDelivery,
  STORY_APPROVED_PROFILE_DELIVERY_CONTRACT, STORY_APPROVED_PROFILE_DELIVERY_LIMITS,
  type StoryApprovedProfileDeliveryRow, type StoryApprovedProfileDeliveryPin,
  type StoryApprovedProfileDeliverySourceResolver,
} from './story-approved-profile-delivery.policy';
import {
  measureStoryApprovedProfileWireMetric, StoryApprovedProfileWireMetricError,
  STORY_APPROVED_PROFILE_WIRE_METRIC_CONTRACT, STORY_APPROVED_PROFILE_WIRE_WORK_BYTES,
  type StoryApprovedProfileWireMetricErrorCode,
} from './story-approved-profile-wire-metric.policy';

const SOURCE_REF = 'analysis:11111111-1111-4111-8111-111111111111';
const EVIDENCE: CreatorGenerationProfileEvidence[] = [
  { sourceType: 'manuscript', sourceRef: `${SOURCE_REF}:part-a:4`, summary: 'Synthetic first evidence.' },
  { sourceType: 'manuscript', sourceRef: `${SOURCE_REF}:part-a:4`, summary: 'Synthetic second evidence.' },
  { sourceType: 'manuscript', sourceRef: `${SOURCE_REF}:part-a:4`, summary: 'Synthetic first evidence.' },
];
const STYLE = {
  summary: '  Synthetic \uD55C\uAE00\n\t\u{1F600}\u0301 " \\  ',
  observations: [
    { title: 'Synthetic rule.', detail: 'Complete synthetic exception.', sourceRef: SOURCE_REF },
    { title: 'Synthetic rule.', detail: 'Complete synthetic exception.', sourceRef: SOURCE_REF },
  ],
  categories: [{ category: 'Synthetic category.', observations: ['same', 'same'] }],
  unknownAuthorField: [null, false, 0, { z: ' retained ', a: false }],
};

function fixture(style: Record<string, unknown> = STYLE) {
  const settings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
      key, decision: key === 'writing_style' ? 'edited' : 'accepted',
      value: key === 'writing_style' ? style : { summary: `Synthetic ${key}.` },
      evidence: key === 'writing_style' ? EVIDENCE : [
        { sourceType: 'metadata', sourceRef: `synthetic:${key}`, summary: `Synthetic ${key} evidence.` },
      ],
    })).reverse(),
  });
  const sourceFingerprint = 'a'.repeat(64);
  const row: StoryApprovedProfileDeliveryRow = {
    id: 'synthetic-wire-profile', status: 'approved', profileVersion: 1, reviewRevision: 3,
    sourceFingerprint, approvedSettings: settings,
    approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings),
  };
  return { row, settings };
}
function pin(row: StoryApprovedProfileDeliveryRow): StoryApprovedProfileDeliveryPin {
  return { id: row.id, profileVersion: row.profileVersion, reviewRevision: row.reviewRevision,
    sourceFingerprint: row.sourceFingerprint, approvedFingerprint: row.approvedFingerprint! };
}
function packet(row: StoryApprovedProfileDeliveryRow) {
  const built = buildStoryApprovedProfileDelivery(row, pin(row), profileObservationSource);
  return decodeStoryApprovedProfileDelivery(built, row, STORY_APPROVED_PROFILE_DELIVERY_CONTRACT, profileObservationSource).packet;
}
function expectCode(action: () => unknown, code: StoryApprovedProfileWireMetricErrorCode) {
  try { action(); }
  catch (error) {
    expect(error).toBeInstanceOf(StoryApprovedProfileWireMetricError);
    const failure = error as StoryApprovedProfileWireMetricError;
    expect(failure.code).toBe(code);
    expect(failure.message).toBe(code);
    expect(failure.stack).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(failure, 'cause')).toBe(false);
    expect(Object.isFrozen(failure)).toBe(true);
    return;
  }
  throw new Error('Expected opaque wire metric failure');
}
function expectedMetric(row: StoryApprovedProfileDeliveryRow) {
  const full = packet(row), original = Buffer.from(JSON.stringify(full), 'utf8');
  const compressed = gzipSync(original, { level: 6 }), encoded = compressed.toString('base64');
  const restored = gunzipSync(Buffer.from(encoded, 'base64'), { maxOutputLength: original.length });
  expect(restored.equals(original)).toBe(true);
  const size = measureStoryApprovedProfileDelivery(full);
  return {
    contract: 'story-approved-profile-wire-metric-v1', byteCap: 16384,
    wholeCandidateViewBytes: size.wholeCandidateViewBytes, candidateViewFits: size.candidateViewFits,
    gzipBytes: compressed.length, base64Utf8Bytes: Buffer.byteLength(encoded, 'utf8'),
    wholeWireEnvelopeBytes: Buffer.byteLength(JSON.stringify({
      contract: 'story-approved-profile-wire-envelope-v1', encoding: 'gzip+base64', data: encoded,
    }), 'utf8'),
    normalizedApprovalPreserved: true, byteExactRoundTrip: true, modelInputFit: 'unmeasured',
    semanticQualityVerified: false, dispatchAuthorized: false, providerCalls: 0, operatingWrites: 0,
  };
}

describe('approved profile wire metric', () => {
  it('validates the actual factory/current row and returns only fresh frozen safe metrics', () => {
    const { row } = fixture();
    const result = measureStoryApprovedProfileWireMetric(row, pin(row), profileObservationSource);
    expect(result).toEqual(expectedMetric(row));
    expect(result.contract).toBe(STORY_APPROVED_PROFILE_WIRE_METRIC_CONTRACT);
    expect(Object.isFrozen(result)).toBe(true);
    expect(measureStoryApprovedProfileWireMetric(row, pin(row), profileObservationSource)).not.toBe(result);
    for (const key of ['wholeCandidateViewBytes', 'gzipBytes', 'base64Utf8Bytes', 'wholeWireEnvelopeBytes'] as const) {
      expect(Number.isSafeInteger(result[key]) && result[key] > 0).toBe(true);
    }
    for (const key of ['packet', 'data', 'base64', 'id', 'sourceFingerprint', 'approvedFingerprint', 'model']) {
      expect(Object.prototype.hasOwnProperty.call(result, key)).toBe(false);
    }
    expect(STORY_APPROVED_PROFILE_DELIVERY_LIMITS).toEqual({ viewBytes: 16384, inputTokens: 32768, outputTokens: 8192 });
  });

  it('preserves normalized FULL sections, Unicode, falsy unknown values, evidence order and duplicates', () => {
    const { row, settings } = fixture();
    const before = Buffer.from(JSON.stringify(row), 'utf8'), full = packet(row);
    const resolver = jest.fn(profileObservationSource);
    const result = measureStoryApprovedProfileWireMetric(row, pin(row), resolver);
    expect(result).toEqual(expectedMetric(row));
    expect(full.authorData.sections).toEqual(settings.sections.map(({ key, decision, value }) => ({ key, decision, value })));
    expect(full.approvalEvidence).toEqual(settings.sections.map(({ key, evidence }) => ({ key, items: evidence })));
    expect(full.pin).toEqual(pin(row));
    expect(full.authorData.sections).toHaveLength(8);
    expect(full.authorData.sections.find(item => item.key === 'writing_style')!.value).toEqual(STYLE);
    expect(full.approvalEvidence.find(item => item.key === 'writing_style')!.items).toEqual(EVIDENCE);
    expect(full.serverInterpretation.sections.find(item => item.key === 'writing_style')!.structuralSources.map(item => item.observationIndex)).toEqual([0, 1]);
    expect(resolver.mock.calls.some(([, evidence]) => JSON.stringify(evidence) === JSON.stringify(EVIDENCE))).toBe(true);
    expect(Buffer.from(JSON.stringify(row), 'utf8').equals(before)).toBe(true);
  });

  it('starts preservation at existing normalization rather than raw draft identity', () => {
    const { row, settings } = fixture();
    row.approvedSettings = { ...settings, ignoredRawRoot: true,
      sections: settings.sections.map(section => ({ ...section, key: ` ${section.key} `,
        evidence: section.evidence.map(item => ({ ...item, summary: ` ${item.summary} ` })) })).reverse() };
    const before = Buffer.from(JSON.stringify(row), 'utf8');
    expect(measureStoryApprovedProfileWireMetric(row, pin(row), profileObservationSource)).toEqual(expectedMetric(row));
    expect(packet(row).authorData.sections.map(item => item.key)).toEqual(settings.sections.map(item => item.key));
    expect(Buffer.from(JSON.stringify(row), 'utf8').equals(before)).toBe(true);
  });

  it('keeps raw overflow false even when repetitive wire data is small', () => {
    const { row } = fixture({ unknownPayload: Array.from({ length: 6 }, () => 'R'.repeat(7900)) });
    const result = measureStoryApprovedProfileWireMetric(row, pin(row), profileObservationSource);
    expect(result).toEqual(expectedMetric(row));
    expect(result.wholeCandidateViewBytes > 16384).toBe(true);
    expect(result.candidateViewFits).toBe(false);
    expect(result.gzipBytes < 16384).toBe(true);
    expect(result.modelInputFit).toBe('unmeasured');
    expect(result.semanticQualityVerified || result.dispatchAuthorized).toBe(false);
  });

  it('measures deterministic poorly compressible approved values without model fit claims', () => {
    let state = 0x13579bdf, text = '';
    for (let index = 0; index < 36000; index++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      text += String.fromCharCode(33 + ((state >>> 0) % 94));
    }
    const { row } = fixture({ unknownPayload: Array.from({ length: 6 }, (_, i) => text.slice(i * 6000, (i + 1) * 6000)) });
    const result = measureStoryApprovedProfileWireMetric(row, pin(row), profileObservationSource);
    expect(result).toEqual(expectedMetric(row));
    expect(result.candidateViewFits).toBe(false);
    expect(result.modelInputFit).toBe('unmeasured');
  });

  it.each(['draft', 'rejected', 'revoked', 'removed'])('rejects current status %s without measuring', status => {
    const { row } = fixture();
    expectCode(() => measureStoryApprovedProfileWireMetric({ ...row, status }, pin(row), profileObservationSource), 'approval_invalid');
  });

  it.each(['id', 'profileVersion', 'reviewRevision', 'sourceFingerprint', 'approvedFingerprint'] as const)('rejects stale pin %s', field => {
    const { row } = fixture(), stale = pin(row);
    if (field === 'id') stale.id = 'synthetic-other-profile';
    else if (field === 'profileVersion') stale.profileVersion++;
    else if (field === 'reviewRevision') stale.reviewRevision++;
    else if (field === 'sourceFingerprint') stale.sourceFingerprint = 'b'.repeat(64);
    else stale.approvedFingerprint = 'c'.repeat(64);
    expectCode(() => measureStoryApprovedProfileWireMetric(row, stale, profileObservationSource), 'approval_invalid');
  });

  it.each(['sourceFingerprint', 'approvedFingerprint'] as const)('rejects current-row fingerprint mismatch: %s', field => {
    const { row } = fixture();
    const current = { ...row, [field]: 'd'.repeat(64) };
    expectCode(() => measureStoryApprovedProfileWireMetric(current, pin(row), profileObservationSource), 'approval_invalid');
  });

  it('rejects missing approval and incomplete actual approvability', () => {
    const { row, settings } = fixture();
    expectCode(() => measureStoryApprovedProfileWireMetric({ ...row, approvedFingerprint: null }, pin(row), profileObservationSource), 'approval_invalid');
    settings.sections.find(item => item.key === 'writing_style')!.decision = 'unknown';
    row.approvedFingerprint = creatorGenerationProfileFingerprint(row.sourceFingerprint, settings);
    expectCode(() => measureStoryApprovedProfileWireMetric(row, pin(row), profileObservationSource), 'approval_invalid');
    const missing = fixture();
    missing.settings.sections.pop();
    missing.row.approvedFingerprint = creatorGenerationProfileFingerprint(missing.row.sourceFingerprint, missing.settings);
    expectCode(() => measureStoryApprovedProfileWireMetric(missing.row, pin(missing.row), profileObservationSource), 'approval_invalid');
  });

  it('maps the existing normalization 128KiB refusal to an opaque approval failure', () => {
    const { row, settings } = fixture();
    settings.sections.find(item => item.key === 'writing_style')!.value = {
      unknownPayload: Array.from({ length: 18 }, () => 'R'.repeat(7900)),
    };
    expectCode(() => measureStoryApprovedProfileWireMetric(row, pin(row), profileObservationSource), 'approval_invalid');
  });

  it('stops compact alias expansion before factory normalization with its owned work-limit code', () => {
    const { row } = fixture();
    let expansion: unknown = 0;
    for (let level = 0; level < 40; level++) expansion = Object.freeze([expansion, expansion]);
    row.approvedSettings = { expansion };
    expect(STORY_APPROVED_PROFILE_WIRE_WORK_BYTES).toBe(262144);
    expectCode(() => measureStoryApprovedProfileWireMetric(row, pin(row), profileObservationSource), 'work_limit_exceeded');
  });

  it('rejects a long escaped normalization input before JSON allocation', () => {
    const { row } = fixture();
    row.approvedSettings = { expansion: '\u0000'.repeat(262144) };
    expectCode(() => measureStoryApprovedProfileWireMetric(row, pin(row), profileObservationSource), 'work_limit_exceeded');
  });

  it('rejects getters and Proxy input without invoking private-data traps', () => {
    const { row } = fixture();
    let calls = 0;
    const accessor = { ...row };
    Object.defineProperty(accessor, 'approvedSettings', { enumerable: true, get() { calls++; return {}; } });
    expectCode(() => measureStoryApprovedProfileWireMetric(accessor, pin(row), profileObservationSource), 'approval_invalid');
    const trap = () => { calls++; throw new Error('Synthetic foreign failure'); };
    const proxy = new Proxy(row, { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap, isExtensible: trap });
    expectCode(() => measureStoryApprovedProfileWireMetric(proxy, pin(row), profileObservationSource), 'approval_invalid');
    expect(calls).toBe(0);
  });

  it('rejects lossy nested JSON values instead of dropping or normalizing them silently', () => {
    for (const value of [undefined, () => 0, Symbol('synthetic'), 1n, NaN, Infinity, -0]) {
      const { row, settings } = fixture();
      settings.sections.find(item => item.key === 'writing_style')!.value = { unknown: value };
      expectCode(() => measureStoryApprovedProfileWireMetric(row, pin(row), profileObservationSource), 'approval_invalid');
    }
  });

  it('revalidates the same current row after factory source resolution', () => {
    const { row } = fixture(), expected = pin(row);
    let changed = false;
    const resolver: StoryApprovedProfileDeliverySourceResolver = (ref, evidence) => {
      if (!changed) { row.reviewRevision++; changed = true; }
      return profileObservationSource(ref, evidence);
    };
    expectCode(() => measureStoryApprovedProfileWireMetric(row, expected, resolver), 'approval_invalid');
  });

  it('does not forward resolver exceptions or accept absent resolvers', () => {
    const { row } = fixture();
    const resolver: StoryApprovedProfileDeliverySourceResolver = () => {
      throw new StoryApprovedProfileWireMetricError('work_limit_exceeded');
    };
    expectCode(() => measureStoryApprovedProfileWireMetric(row, pin(row), resolver), 'approval_invalid');
    expectCode(() => measureStoryApprovedProfileWireMetric(row, pin(row), undefined as unknown as StoryApprovedProfileDeliverySourceResolver), 'approval_invalid');
  });

  it('maps a foreign gzip failure to the closed measurement code without forwarding fields', () => {
    const { row } = fixture();
    const compression = jest.spyOn(require('node:zlib') as typeof import('node:zlib'), 'gzipSync').mockImplementation(() => {
      throw Object.freeze({ code: 'approval_invalid', message: 'Synthetic foreign failure', stack: 'Synthetic foreign stack' });
    });
    try {
      expectCode(() => measureStoryApprovedProfileWireMetric(row, pin(row), profileObservationSource), 'measurement_failed');
    } finally { compression.mockRestore(); }
  });

  it('closes the public error-code allowlist without exposing a cause or stack', () => {
    const error = new StoryApprovedProfileWireMetricError('synthetic-foreign-code' as StoryApprovedProfileWireMetricErrorCode);
    expect(error.code).toBe('measurement_failed');
    expect(error.message).toBe('measurement_failed');
    expect(error.stack).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(error, 'cause')).toBe(false);
  });
});

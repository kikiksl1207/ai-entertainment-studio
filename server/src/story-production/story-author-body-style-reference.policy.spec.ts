import {
  inspectStoryAuthorBodyStyleReference,
  type StoryAuthorBodyStyleReferenceDiagnostic,
  type StoryAuthorBodyStyleReferenceInput,
} from './story-author-body-style-reference.policy';
import { parseContinuationGenerationProfilePin } from './story-continuation-context.policy';

const profileId = 'aaaaaaaa-0000-4000-8000-000000000001';
const sourceFingerprint = 'a'.repeat(64), approvedFingerprint = 'b'.repeat(64);
const privateText = 'SYNTHETIC_PRIVATE_BODY_AND_CONTEXT_NEVER_RETURNED';

function pin() {
  return { id: profileId, profileVersion: 4, reviewRevision: 3, sourceFingerprint, approvedFingerprint };
}

function direct(): StoryAuthorBodyStyleReferenceInput {
  return { bodyKind: 'generated', origin: { status: 'completed',
    contextReferences: { generationProfilePin: pin(), sharedResultReused: false } }, currentApprovedPin: pin() };
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}

function assertDiagnostic(
  value: StoryAuthorBodyStyleReferenceDiagnostic,
  comparison: StoryAuthorBodyStyleReferenceDiagnostic['comparison'],
  reason: StoryAuthorBodyStyleReferenceDiagnostic['reason'],
) {
  expect(value).toEqual({
    version: 'story-author-body-style-reference-v1',
    referenceScope: 'stored_completed_origin_request_pin', contextSource: 'caller_supplied_metadata',
    comparison, reason, readOnly: true,
    currentApprovalVerified: false, originalGenerationApprovalVerified: false,
    semanticQualityVerified: false, generatedBodyQualityVerified: false,
    bodySourceAligned: false, dispatchAuthorized: false, providerCalls: 0, operatingWrites: 0,
  });
  expect(Object.isFrozen(value)).toBe(true);
  const wire = JSON.stringify(value);
  expect(Buffer.byteLength(wire, 'utf8')).toBeLessThan(1024);
  for (const secret of [profileId, sourceFingerprint, approvedFingerprint, privateText]) {
    expect(wire).not.toContain(secret);
  }
  for (const key of ['id', 'profileVersion', 'reviewRevision', 'sourceFingerprint', 'approvedFingerprint',
    'origin', 'contextReferences', 'generationProfilePin', 'body', 'title']) {
    expect(value).not.toHaveProperty(key);
  }
}

describe('author body style reference (pure caller-supplied metadata only)', () => {
  it('AUTHOR-BODY-STYLE-REFERENCE: frozen direct completed origin exact pin matches without approval or quality claims', () => {
    const input = freeze(direct()), before = JSON.stringify(input);
    assertDiagnostic(inspectStoryAuthorBodyStyleReference(input), 'same_approval_pin', 'body_style_reference_same_approval_pin');
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.origin)).toBe(true);
    expect(Object.isFrozen(input.currentApprovedPin)).toBe(true);
  });

  it.each([
    ['id', 'aaaaaaaa-0000-4000-8000-000000000002'],
    ['profileVersion', 5], ['reviewRevision', 4],
    ['sourceFingerprint', 'c'.repeat(64)], ['approvedFingerprint', 'd'.repeat(64)],
  ] as const)('AUTHOR-BODY-STYLE-REFERENCE: a different %s is not the same approval pin', (field, changed) => {
    const current = { ...pin(), [field]: changed };
    const input = freeze({ ...direct(), currentApprovedPin: current }), before = JSON.stringify(input);
    assertDiagnostic(inspectStoryAuthorBodyStyleReference(input), 'different_approval_pin',
      'body_style_reference_different_approval_pin');
    expect(JSON.stringify(input)).toBe(before);
  });

  it('AUTHOR-BODY-STYLE-REFERENCE: identity is exact and never lowercased or coerced', () => {
    assertDiagnostic(inspectStoryAuthorBodyStyleReference({ ...direct(), currentApprovedPin: {
      ...pin(), id: profileId.toUpperCase(),
    } }), 'different_approval_pin', 'body_style_reference_different_approval_pin');
    assertDiagnostic(inspectStoryAuthorBodyStyleReference({ ...direct(), currentApprovedPin: {
      ...pin(), profileVersion: '4',
    } }), 'unavailable', 'body_style_reference_pin_unavailable');
  });

  it('AUTHOR-BODY-STYLE-REFERENCE: key order and unreferenced extra data do not affect the five existing pin fields', () => {
    const current = { approvedFingerprint, reviewRevision: 3, id: profileId, sourceFingerprint, profileVersion: 4 };
    const originPin = { ...pin(), rawBody: privateText };
    Object.defineProperty(originPin, 'apiKey', { get() { throw new Error(privateText); }, enumerable: true });
    const input = { ...direct(), currentApprovedPin: current, origin: { status: 'completed',
      rawBody: privateText, contextReferences: { generationProfilePin: originPin, sourceText: privateText } } };
    assertDiagnostic(inspectStoryAuthorBodyStyleReference(input), 'same_approval_pin', 'body_style_reference_same_approval_pin');
  });

  it.each(['none', 'canonical'] as const)('AUTHOR-BODY-STYLE-REFERENCE: %s body is unavailable without reading origin or current pin', bodyKind => {
    const input = { bodyKind } as StoryAuthorBodyStyleReferenceInput;
    const denied = jest.fn(() => { throw new Error(privateText); });
    Object.defineProperties(input, { origin: { get: denied }, currentApprovedPin: { get: denied } });
    assertDiagnostic(inspectStoryAuthorBodyStyleReference(input), 'unavailable',
      bodyKind === 'none' ? 'body_style_reference_no_saved_body' : 'body_style_reference_canonical_body');
    expect(denied).not.toHaveBeenCalled();
  });

  it('AUTHOR-BODY-STYLE-REFERENCE: absent or non-completed origin cannot compare approval', () => {
    for (const origin of [undefined, null, false, [], {}, ...['queued', 'processing', 'failed', 'timeout', 'cancelled']
      .map(status => ({ status, contextReferences: { generationProfilePin: pin() } }))]) {
      assertDiagnostic(inspectStoryAuthorBodyStyleReference({ ...direct(), origin }),
        'unavailable', 'body_style_reference_origin_unavailable');
    }
  });

  it('AUTHOR-BODY-STYLE-REFERENCE: malformed references or ambiguous reuse marker fail closed', () => {
    for (const contextReferences of [undefined, null, false, [], ...[null, 'false', 0, {}, []]
      .map(sharedResultReused => ({ generationProfilePin: pin(), sharedResultReused }))]) {
      assertDiagnostic(inspectStoryAuthorBodyStyleReference({ ...direct(), origin: { status: 'completed', contextReferences } }),
        'unavailable', 'body_style_reference_origin_unavailable');
    }
  });

  it('AUTHOR-BODY-STYLE-REFERENCE: a reused consumer is always unavailable even with identical valid pins', () => {
    const input = freeze({ ...direct(), origin: { status: 'completed',
      contextReferences: { generationProfilePin: pin(), sharedResultReused: true } } });
    assertDiagnostic(inspectStoryAuthorBodyStyleReference(input), 'unavailable',
      'body_style_reference_reused_origin_unavailable');
  });

  it('AUTHOR-BODY-STYLE-REFERENCE: reused origin never inspects either pin or original lineage', () => {
    const denied = jest.fn(() => { throw new Error(privateText); });
    const references = { sharedResultReused: true };
    Object.defineProperties(references, {
      generationProfilePin: { get: denied }, originalGenerationProfilePin: { get: denied },
    });
    const input: StoryAuthorBodyStyleReferenceInput = {
      bodyKind: 'generated', origin: { status: 'completed', contextReferences: references },
    };
    Object.defineProperty(input, 'currentApprovedPin', { get: denied });
    assertDiagnostic(inspectStoryAuthorBodyStyleReference(input), 'unavailable',
      'body_style_reference_reused_origin_unavailable');
    expect(denied).not.toHaveBeenCalled();
  });

  it('AUTHOR-BODY-STYLE-REFERENCE: missing origin or current pin never substitutes a default or older reference', () => {
    for (const missing of [undefined, null]) {
      assertDiagnostic(inspectStoryAuthorBodyStyleReference({ ...direct(), currentApprovedPin: missing }),
        'unavailable', 'body_style_reference_pin_unavailable');
      assertDiagnostic(inspectStoryAuthorBodyStyleReference({ ...direct(), origin: { status: 'completed',
        contextReferences: { generationProfilePin: missing, olderApprovedPin: pin() } } }),
      'unavailable', 'body_style_reference_pin_unavailable');
    }
  });

  it('AUTHOR-BODY-STYLE-REFERENCE: malformed pins reuse the existing parser and never echo failure input', () => {
    const invalid: unknown[] = [false, 0, privateText, [], {}, { ...pin(), id: '' },
      { ...pin(), profileVersion: 0 }, { ...pin(), profileVersion: 1.5 }, { ...pin(), reviewRevision: -1 },
      { ...pin(), reviewRevision: NaN }, { ...pin(), sourceFingerprint: privateText },
      { ...pin(), approvedFingerprint: approvedFingerprint.toUpperCase() }];
    for (const bad of invalid) {
      expect(() => parseContinuationGenerationProfilePin(bad as never)).toThrow('generation_profile_pin_invalid');
      assertDiagnostic(inspectStoryAuthorBodyStyleReference({ ...direct(), currentApprovedPin: bad }),
        'unavailable', 'body_style_reference_pin_unavailable');
      assertDiagnostic(inspectStoryAuthorBodyStyleReference({ ...direct(), origin: { status: 'completed',
        contextReferences: { generationProfilePin: bad } } }), 'unavailable', 'body_style_reference_pin_unavailable');
    }
  });

  it('AUTHOR-BODY-STYLE-REFERENCE: historical prompt version is not rewritten or advertised as current execution readiness', () => {
    const input = freeze({ ...direct(), origin: { status: 'completed', contextReferences: {
      generationProfilePin: pin(), generationProfileViewVersion: 'story-profile-prompt-v5',
    } } }), before = JSON.stringify(input);
    assertDiagnostic(inspectStoryAuthorBodyStyleReference(input), 'same_approval_pin', 'body_style_reference_same_approval_pin');
    expect(JSON.stringify(input)).toBe(before);
  });

  it('AUTHOR-BODY-STYLE-REFERENCE: invalid top-level candidate or body kind is unavailable without an exception', () => {
    for (const input of [undefined, null, false, 0, privateText, [], {}, { bodyKind: 'public' }]) {
      assertDiagnostic(inspectStoryAuthorBodyStyleReference(input as StoryAuthorBodyStyleReferenceInput),
        'unavailable', 'body_style_reference_unavailable');
    }
  });

  it('AUTHOR-BODY-STYLE-REFERENCE: untrusted accessor failures are sanitized without messages or codes', () => {
    const input = { ...direct() };
    Object.defineProperty(input, 'origin', { get() { throw Object.assign(new Error(privateText), { code: privateText }); } });
    assertDiagnostic(inspectStoryAuthorBodyStyleReference(input), 'unavailable', 'body_style_reference_unavailable');
    const badPin = { ...pin() };
    Object.defineProperty(badPin, 'approvedFingerprint', { get() { throw new Error(privateText); } });
    assertDiagnostic(inspectStoryAuthorBodyStyleReference({ ...direct(), currentApprovedPin: badPin }),
      'unavailable', 'body_style_reference_pin_unavailable');
  });

  it('AUTHOR-BODY-STYLE-REFERENCE: repeated comparisons are stateless and never log or dispatch callbacks', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const provider = jest.fn(() => { throw new Error(privateText); });
    try {
      const input = { ...direct(), provider, getOrCreate: provider, approve: provider, write: provider };
      assertDiagnostic(inspectStoryAuthorBodyStyleReference(input), 'same_approval_pin', 'body_style_reference_same_approval_pin');
      assertDiagnostic(inspectStoryAuthorBodyStyleReference({ ...input, currentApprovedPin: { ...pin(), reviewRevision: 5 } }),
        'different_approval_pin', 'body_style_reference_different_approval_pin');
      assertDiagnostic(inspectStoryAuthorBodyStyleReference(input), 'same_approval_pin', 'body_style_reference_same_approval_pin');
      expect(provider).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    } finally { log.mockRestore(); warn.mockRestore(); error.mockRestore(); }
  });
});

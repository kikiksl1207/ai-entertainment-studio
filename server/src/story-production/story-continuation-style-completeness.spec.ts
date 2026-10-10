import 'reflect-metadata';
import {
  CREATOR_GENERATION_PROFILE_SCHEMA,
  STORY_PROFILE_SECTION_KEYS,
  assertCreatorGenerationProfileApprovable,
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
  type CreatorGenerationProfileEvidence,
} from '../generation-profile/creator-generation-profile.policy';
import {
  STORY_CONTINUATION_PROFILE_VIEW_VERSION,
  StoryContinuationProfileViewContextTooLargeError,
  continuationGenerationProfileSnapshot,
} from './story-continuation-context.policy';

type ApprovedRow = Parameters<typeof continuationGenerationProfileSnapshot>[0];
type Snapshot = ReturnType<typeof continuationGenerationProfileSnapshot>;
const VIEW_CAP = 16_384;
const INCOMPLETE = 'generation_profile_style_projection_incomplete';
const SOURCE = 'analysis:11111111-1111-4111-8111-111111111111';
const LITERAL = ' \t\uac00\u{1f642} \u00e9 e\u0301 "quoted" \\\\path\nFINAL_EXCEPTION\r\n ';

// Synthetic approval consistency only: no owner, provider or semantic-quality proof.
function approvedFixture(
  style: Record<string, unknown> = {},
  decision: 'accepted' | 'edited' = 'edited',
  evidence: CreatorGenerationProfileEvidence[] = [],
) {
  const settings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
    kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
      key,
      decision: key === 'writing_style' ? decision : 'accepted',
      evidence: key === 'writing_style' ? evidence : [],
      value: key === 'writing_style'
        ? { summary: 'Synthetic approved style.', imitationBoundary: 'synthetic_work_only', ...style }
        : { summary: 'Synthetic ' + key + '.' },
    })),
  });
  assertCreatorGenerationProfileApprovable(settings);
  const sourceFingerprint = 'a'.repeat(64);
  const row: ApprovedRow = {
    id: 'synthetic-style-completeness-profile',
    status: 'approved',
    profileVersion: 1,
    reviewRevision: 2,
    sourceFingerprint,
    approvedSettings: settings as unknown as ApprovedRow['approvedSettings'],
    approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings),
  };
  return { row, settings };
}

type Fixture = ReturnType<typeof approvedFixture>;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const storedStyle = (input: Fixture) => input.settings.sections.find(row => row.key === 'writing_style')!.value;
const styleValue = (snapshot: Snapshot) => snapshot.approved.sections.find(row => row.key === 'writing_style')!.value;

function snapshot(input: Fixture) {
  const before = JSON.stringify(input.row);
  const result = continuationGenerationProfileSnapshot(input.row);
  expect(JSON.stringify(input.row)).toBe(before);
  return result;
}

function failure(input: Fixture): Error {
  const before = JSON.stringify(input.row);
  let error: unknown;
  try {
    continuationGenerationProfileSnapshot(input.row);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(Error);
  expect(JSON.stringify(input.row)).toBe(before);
  return error as Error;
}

function expectIncomplete(input: Fixture) {
  expect(failure(input).message).toBe(INCOMPLETE);
}

function capFixture(extraBytes = 0) {
  const style = {
    observations: [{ title: 'Synthetic cap rule', detail: LITERAL }],
    categories: [{ category: 'Synthetic cap category', observations: [LITERAL, LITERAL] }],
    syntheticPadding: ['', ''],
  };
  const empty = snapshot(approvedFixture(style));
  const remaining = VIEW_CAP - bytes(empty.approved) + extraBytes;
  expect(remaining).toBeGreaterThan(0);
  expect(remaining).toBeLessThan(16_000);
  return approvedFixture({
    ...style,
    syntheticPadding: [
      'P'.repeat(Math.floor(remaining / 2)),
      'P'.repeat(Math.ceil(remaining / 2)),
    ],
  });
}

describe('Style projection completeness (20 synthetic pure-policy cases)', () => {
  it('01 preserves whole accepted and edited known strings, Unicode, whitespace and escapes', () => {
    const summary = LITERAL.repeat(8) + 'SUMMARY_TAIL';
    const imitationBoundary = LITERAL.repeat(5) + 'SCALAR_TAIL';
    const title = LITERAL.repeat(4) + 'TITLE_TAIL';
    const detail = LITERAL.repeat(7) + 'DETAIL_TAIL';
    const category = LITERAL.repeat(4) + 'CATEGORY_TAIL';
    const observations = [LITERAL.repeat(6) + 'EXAMPLE_TAIL', LITERAL];
    expect(summary.length).toBeGreaterThan(240);
    expect(LITERAL.normalize('NFC')).not.toBe(LITERAL);
    for (const decision of ['accepted', 'edited'] as const) {
      const input = approvedFixture({
        summary, imitationBoundary,
        observations: [{ title, detail }],
        categories: [{ category, observations }],
      }, decision);
      const result = snapshot(input);
      expect(styleValue(result)).toEqual({
        summary, imitationBoundary, referenceScope: 'production_constraint',
        observations: [{ title, detail, referenceScope: 'writing_pattern' }],
        categories: [{ category, observations }],
      });
      expect(result.pin.approvedFingerprint).toBe(input.row.approvedFingerprint);
      expect(bytes(result.approved)).toBeLessThanOrEqual(VIEW_CAP);
    }
  });

  it('02 preserves duplicates and approved observation/category/example array order', () => {
    const repeated = { title: 'Repeated synthetic rule', detail: 'Repeated synthetic detail.' };
    const observations = [
      repeated, { title: 'Middle', detail: 'Synthetic middle exception.' }, repeated,
      { title: 'Last', detail: 'Synthetic final exception.' }, repeated,
    ];
    const categories = Array.from({ length: 7 }, (_, index) => ({
      category: 'Synthetic category ' + index,
      observations: [LITERAL, LITERAL, 'Synthetic final example ' + index],
    }));
    const reversed = categories.slice().reverse().map(row => ({
      ...row, observations: row.observations.slice().reverse(),
    }));
    const forward = approvedFixture({ observations, categories });
    const backward = approvedFixture({ observations: observations.slice().reverse(), categories: reversed });
    expect(backward.row.approvedFingerprint).not.toBe(forward.row.approvedFingerprint);
    expect(styleValue(snapshot(forward)).observations).toEqual(
      observations.map(row => ({ ...row, referenceScope: 'writing_pattern' })),
    );
    expect(styleValue(snapshot(forward)).categories).toEqual(categories);
    expect(styleValue(snapshot(backward)).observations).toEqual(
      observations.slice().reverse().map(row => ({ ...row, referenceScope: 'writing_pattern' })),
    );
    expect(styleValue(snapshot(backward)).categories).toEqual(reversed);
  });

  it('03 retains unknown top-level author fields in full, including supported generic JSON', () => {
    const authorFields = {
      authorException: LITERAL.repeat(10) + 'UNKNOWN_SCALAR_TAIL',
      intensity: 0.25,
      narratorMayChange: false,
      nullableRule: null,
      unknownExamples: [LITERAL, LITERAL],
      unknownStructuredRule: { text: LITERAL, conditions: ['Synthetic condition.'] },
    };
    const input = approvedFixture(authorFields);
    const actual = styleValue(snapshot(input));
    for (const [key, value] of Object.entries(authorFields)) expect(actual[key]).toEqual(value);
    expect(storedStyle(input).authorException).toBe(authorFields.authorException);
    expect(actual.referenceScope).toBe('production_constraint');
  });

  it('04 accepts missing or empty titles when detail is a nonblank complete string', () => {
    const input = approvedFixture({ observations: [
      { detail: LITERAL },
      { title: '', detail: 'Synthetic detail with explicitly empty title.' },
    ] });
    expect(styleValue(snapshot(input)).observations).toEqual([
      { title: '', detail: LITERAL, referenceScope: 'writing_pattern' },
      { title: '', detail: 'Synthetic detail with explicitly empty title.', referenceScope: 'writing_pattern' },
    ]);
  });

  it('05 allows absent or empty observation/category arrays with no semantic rules to discard', () => {
    for (const fields of [{}, { observations: [] }, { categories: [] }, { observations: [], categories: [] }]) {
      const input = approvedFixture(fields);
      expect(styleValue(snapshot(input))).toEqual({
        summary: 'Synthetic approved style.',
        imitationBoundary: 'synthetic_work_only',
        referenceScope: 'production_constraint',
      });
    }
  });

  it('06 permits provenance/scope fields but keeps trusted provenance distinct from route history', () => {
    const input = approvedFixture({
      referenceScope: 'reader_route_fact',
      observations: [
        { title: 'Valid source', detail: LITERAL, sourceRef: SOURCE,
          sourcePartKey: 'FORGED-PART', sourceParagraphIndex: 999, referenceScope: 'reader_route_fact' },
        { title: 'Invalid source', detail: 'Synthetic unvalidated reference.',
          sourceRef: 'analysis:invalid', sourcePartKey: 'FORGED-PART', sourceParagraphIndex: 999 },
      ],
    }, 'edited', [
      { sourceType: 'manuscript', sourceRef: SOURCE + ':PART-A:7', summary: 'Synthetic provenance.' },
      { sourceType: 'manuscript', sourceRef: SOURCE + ':PART-A:7', summary: 'Duplicate synthetic location.' },
    ]);
    const result = snapshot(input);
    expect(styleValue(result).referenceScope).toBe('production_constraint');
    expect(styleValue(result).observations).toEqual([
      { title: 'Valid source', detail: LITERAL, referenceScope: 'writing_pattern',
        sourceRef: SOURCE, sourcePartKey: 'PART-A', sourceParagraphIndex: 7 },
      { title: 'Invalid source', detail: 'Synthetic unvalidated reference.', referenceScope: 'writing_pattern' },
    ]);
    expect(result.approved.sections.find(row => row.key === 'canon')!.value.referenceScope)
      .toBe('author_plan_not_route_history');
    expect(JSON.stringify(result.approved)).not.toContain('reader_route_fact');
    expect(JSON.stringify(result.approved)).not.toContain('FORGED-PART');
    expect(JSON.stringify(result.approved)).not.toContain('analysis:invalid');
  });

  it('07 rejects approved extra observation author strings instead of silently discarding them', () => {
    for (const decision of ['accepted', 'edited'] as const) {
      const input = approvedFixture({ observations: [{
        title: 'Synthetic title', detail: 'Synthetic detail.',
        authorException: 'Synthetic approved exception that cannot be dropped.',
      }] }, decision);
      expect(storedStyle(input).observations).toEqual([{
        title: 'Synthetic title', detail: 'Synthetic detail.',
        authorException: 'Synthetic approved exception that cannot be dropped.',
      }]);
      expectIncomplete(input);
    }
  });

  it('08 rejects an own observations field that is not an array', () => {
    for (const observations of [null, 'Synthetic scalar rule.', 42, { detail: 'Synthetic object rule.' }]) {
      const input = approvedFixture({ observations });
      expect(storedStyle(input).observations).toEqual(observations);
      expectIncomplete(input);
    }
  });

  it('09 rejects non-object observation rows accepted by generic JSON storage', () => {
    for (const row of [null, 'Synthetic scalar row.', 42, ['Synthetic nested row.']]) {
      expectIncomplete(approvedFixture({ observations: [row] }));
    }
  });

  it('10 rejects title-only rules and missing, blank or non-string details', () => {
    for (const row of [
      { title: 'Synthetic title-only rule.' },
      { title: 'Synthetic blank-detail rule.', detail: '' },
      { title: 'Synthetic whitespace-detail rule.', detail: ' \t\n ' },
      { title: 'Synthetic numeric-detail rule.', detail: 42 },
      { title: 'Synthetic object-detail rule.', detail: { text: 'Synthetic object content.' } },
    ]) {
      const input = approvedFixture({ observations: [row] });
      expect(storedStyle(input).observations).toEqual([row]);
      expectIncomplete(input);
    }
  });

  it('11 rejects whitespace-only and non-string present titles, rather than changing them to empty', () => {
    for (const title of [' \t\n ', null, 42, false, { text: 'Synthetic object title.' }]) {
      const input = approvedFixture({ observations: [{ title, detail: 'Synthetic nonblank detail.' }] });
      expect(storedStyle(input).observations).toEqual([{ title, detail: 'Synthetic nonblank detail.' }]);
      expectIncomplete(input);
    }
  });

  it('12 rejects extra category example/exception strings instead of silently discarding them', () => {
    for (const decision of ['accepted', 'edited'] as const) {
      const category = {
        category: 'Synthetic category',
        observations: ['Synthetic supported example.'],
        example: 'Synthetic extra example that cannot be dropped.',
        authorException: 'Synthetic extra category exception.',
      };
      const input = approvedFixture({ categories: [category] }, decision);
      expect(storedStyle(input).categories).toEqual([category]);
      expectIncomplete(input);
    }
  });

  it('13 rejects an own categories field that is not an array', () => {
    for (const categories of [null, 'Synthetic scalar category.', 42, { category: 'Synthetic object category.' }]) {
      const input = approvedFixture({ categories });
      expect(storedStyle(input).categories).toEqual(categories);
      expectIncomplete(input);
    }
  });

  it('14 rejects non-object category rows accepted by generic JSON storage', () => {
    for (const row of [null, 'Synthetic scalar row.', 42, ['Synthetic nested category.']]) {
      expectIncomplete(approvedFixture({ categories: [row] }));
    }
  });

  it('15 rejects missing, blank and non-string category names instead of losing usable examples', () => {
    for (const row of [
      { observations: ['Synthetic usable example.'] },
      { category: '', observations: ['Synthetic usable example.'] },
      { category: ' \t\n ', observations: ['Synthetic usable example.'] },
      { category: 42, observations: ['Synthetic usable example.'] },
    ]) expectIncomplete(approvedFixture({ categories: [row] }));
  });

  it('16 rejects category-only rows and non-array, empty, blank or non-string examples', () => {
    const rows = [
      { category: 'Synthetic category-only rule.' },
      { category: 'Synthetic empty examples.', observations: [] },
      { category: 'Synthetic scalar example.', observations: 'Synthetic scalar example.' },
      { category: 'Synthetic object examples.', observations: { text: 'Synthetic example.' } },
      { category: 'Synthetic blank example.', observations: ['Synthetic usable example.', ' \t\n '] },
      { category: 'Synthetic numeric example.', observations: ['Synthetic usable example.', 42] },
      { category: 'Synthetic object example.', observations: [{ text: 'Synthetic example.' }] },
      { category: 'Synthetic nested example.', observations: [['Synthetic nested example.']] },
    ];
    for (const row of rows) {
      const input = approvedFixture({ categories: [row] });
      expect(storedStyle(input).categories).toEqual([row]);
      expectIncomplete(input);
    }
  });

  it('17 preserves the inclusive exact-byte cap, view version and original approval pin', () => {
    const input = capFixture();
    const result = snapshot(input);
    expect(bytes(result.approved)).toBe(VIEW_CAP);
    expect(STORY_CONTINUATION_PROFILE_VIEW_VERSION).toBe('story-profile-prompt-v6');
    expect(styleValue(result).syntheticPadding).toEqual(storedStyle(input).syntheticPadding);
    expect(styleValue(result).observations).toEqual([
      { title: 'Synthetic cap rule', detail: LITERAL, referenceScope: 'writing_pattern' },
    ]);
    expect(styleValue(result).categories).toEqual(storedStyle(input).categories);
    expect(result.pin).toEqual({
      id: input.row.id, profileVersion: input.row.profileVersion, reviewRevision: input.row.reviewRevision,
      sourceFingerprint: input.row.sourceFingerprint, approvedFingerprint: input.row.approvedFingerprint,
    });
  });

  it('18 retains typed oversize diagnostics before shape rejection and never truncates mandatory strings', () => {
    const longSummary = '\uac00'.repeat(6_000);
    const longDetails = Array.from({ length: 3 }, (_, index) => 'D'.repeat(6_000) + '_MANDATORY_TAIL_' + index);
    const vectors: Array<{ input: Fixture; scopeCount: number; exactBytes?: number }> = [
      { input: capFixture(1), scopeCount: 1, exactBytes: VIEW_CAP + 1 },
      { input: approvedFixture({ summary: longSummary }), scopeCount: 0 },
      { input: approvedFixture({ summary: longSummary, observations: [{
        title: 'Synthetic oversized malformed rule.', detail: LITERAL, authorException: 'Do not change error precedence.',
      }] }), scopeCount: 1 },
      { input: approvedFixture({ summary: longSummary, categories: 'Synthetic malformed categories.' }), scopeCount: 0 },
      { input: approvedFixture({ observations: longDetails.map((detail, index) => ({
        title: 'Synthetic oversized rule ' + index, detail,
      })) }), scopeCount: 3 },
      { input: approvedFixture({ categories: [{ category: 'Synthetic oversized category', observations: longDetails }] }),
        scopeCount: 0 },
    ];
    expect(longSummary.length).toBeLessThanOrEqual(8_000);
    expect(Buffer.byteLength(longSummary, 'utf8')).toBeGreaterThan(VIEW_CAP);
    for (const { input, scopeCount, exactBytes } of vectors) {
      expect(bytes(input.settings)).toBeLessThan(128 * 1024);
      const error = failure(input);
      expect(error).toBeInstanceOf(StoryContinuationProfileViewContextTooLargeError);
      expect(error.message).toBe('generation_profile_context_too_large');
      const diagnostic = (error as StoryContinuationProfileViewContextTooLargeError).profileViewDiagnostic;
      expect(diagnostic).toEqual(expect.objectContaining({
        contract: 'story-profile-view-byte-diagnostic-v1', byteCap: VIEW_CAP,
        projectionTiers: 3, scopeObservationCount: scopeCount, trustedRepeatedScopeBytes: scopeCount * 35,
        modelInputFit: 'unmeasured', compactViewFit: 'unmeasured', semanticQualityVerified: false,
      }));
      expect(diagnostic.minimumProjectedViewBytes).toBeGreaterThan(VIEW_CAP);
      if (exactBytes !== undefined) expect(diagnostic.minimumProjectedViewBytes).toBe(exactBytes);
    }
  });

  it('19 retains stale fingerprint precedence over both completeness and oversize errors', () => {
    const changedApproval = approvedFixture({ observations: [{
      title: 'Synthetic title', detail: LITERAL, authorException: 'Synthetic unsupported extra.',
    }] });
    changedApproval.row.approvedFingerprint = 'b'.repeat(64);
    const changedSource = capFixture(1);
    changedSource.row.sourceFingerprint = 'b'.repeat(64);
    const changedContent = approvedFixture({ observations: [{ title: 'Synthetic title', detail: LITERAL }] });
    storedStyle(changedContent).observations = [{
      title: 'Synthetic title', detail: LITERAL, authorException: 'Synthetic unapproved added exception.',
    }];
    for (const input of [changedApproval, changedSource, changedContent]) {
      expect(failure(input).message).toBe('generation_profile_fingerprint_changed');
    }
  });

  it('20 retains unapproved/missing-approval precedence over malformed and oversized style', () => {
    const invalidStyle = {
      summary: '\uac00'.repeat(6_000),
      observations: [{ title: 'Synthetic title-only rule.' }],
    };
    const status = approvedFixture(invalidStyle);
    status.row.status = 'needs_review';
    const missingFingerprint = approvedFixture(invalidStyle);
    missingFingerprint.row.approvedFingerprint = null;
    const missingSettings = approvedFixture(invalidStyle);
    missingSettings.row.approvedSettings = null;
    for (const input of [status, missingFingerprint, missingSettings]) {
      expect(failure(input).message).toBe('generation_profile_not_approved');
    }
  });
});

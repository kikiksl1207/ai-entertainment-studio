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
  continuationGenerationProfileSnapshot,
  continuationGenerationProfileVisualSnapshot,
} from './story-continuation-context.policy';
import { StoryContinuationContextAssembler } from './story-continuation-context.assembler';
import {
  buildStoryContinuationOpenAiRequest,
  preflightStoryContinuationOpenAiRequest,
} from './story-continuation-openai.prompt';
import type { StoryContinuationOpenAiConfig } from './story-continuation-openai.config';
import {
  STORY_CONTINUATION_PROMPT_VERSION,
  STORY_CONTINUATION_SCHEMA_VERSION,
} from './story-continuation-openai.schema';
import type { StoryContinuationProviderRequest } from './story-continuation.provider';

type ApprovedRow = Parameters<typeof continuationGenerationProfileSnapshot>[0];
type ApprovedView = ReturnType<typeof continuationGenerationProfileSnapshot>['approved'];
type Observation = { title: string; detail: string };
type Category = { category: string; observations: string[] };
const VIEW_CAP = 16_384;
const MIDDLE_RULE = 'Never change first-person viewpoint during testimony.';
const DETAIL_TAIL = 'DETAIL_TAIL: Retain every word in witness quotations.';
const sourceRef = 'analysis:11111111-1111-4111-8111-111111111111';

// These pins are local serializer fixtures; no adapter, credentials, or runtime is loaded.
const config: StoryContinuationOpenAiConfig = {
  enabled: true, provider: 'openai', model: 'gpt-5.4-mini-2026-03-17',
  rateCardId: 'synthetic-card', rateCardVersion: 'v1', apiKey: 'synthetic-not-a-key',
  timeoutMs: 100, maxInputTokens: 32_768, maxOutputTokens: 8_192,
  maxResponseBytes: 200_000, visualAssetPath: '/assets/story/neutral-placeholder.webp',
};

function approvedProfile(style: Record<string, unknown>, decision: 'accepted' | 'edited' = 'edited',
  evidence: CreatorGenerationProfileEvidence[] = []) {
  const settings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
      key, decision: key === 'writing_style' ? decision : 'accepted',
      evidence: key === 'writing_style' ? evidence : [],
      value: key === 'writing_style'
        ? { summary: 'Approved synthetic voice.', imitationBoundary: 'approved_work_only', ...style }
        : { summary: `Approved synthetic ${key}.` },
    })),
  });
  assertCreatorGenerationProfileApprovable(settings);
  const sourceFingerprint = 'a'.repeat(64);
  const row: ApprovedRow = {
    id: 'synthetic-style-fields-profile', status: 'approved', profileVersion: 1, reviewRevision: 2,
    sourceFingerprint, approvedSettings: settings as unknown as ApprovedRow['approvedSettings'],
    approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings),
  };
  return { row, settings };
}

function styleValue(approved: ApprovedView) {
  return approved.sections.find(section => section.key === 'writing_style')!.value;
}

function projectedObservations(rows: Observation[]) {
  return rows.map(row => ({ ...row, referenceScope: 'writing_pattern' }));
}

function shortRules(): Observation[] {
  return Array.from({ length: 5 }, (_, index) => ({
    title: `Rule ${index + 1}`,
    detail: index === 2 ? MIDDLE_RULE : `Keep approved rhythm ${index + 1}.`,
  }));
}

function requestFor(approved: ApprovedView): StoryContinuationProviderRequest {
  return {
    operationId: 'synthetic-style-fields', locale: 'en', contextFingerprint: 'synthetic-context',
    promptVersion: STORY_CONTINUATION_PROMPT_VERSION, outputSchemaVersion: STORY_CONTINUATION_SCHEMA_VERSION,
    inputTokenLimit: 32_768, outputTokenLimit: 8_192,
    provider: config.provider, model: config.model, rateCardId: config.rateCardId, rateCardVersion: config.rateCardVersion,
    approvedContext: {
      sourceScene: { title: 'Synthetic testimony', beats: [{
        beatType: 'paragraph', content: 'The witness opens the ledger and reads the first entry.',
      }] },
      selectedChoice: { label: 'Question the witness' }, path: [], memories: [], generationProfile: approved,
    },
  };
}

describe('Approved writing style fields (synthetic, no runtime)', () => {
  it('STYLE-FIELDS preserves all approved observation rules and their detail tails', () => {
    const rows = shortRules();
    rows[0] = {
      title: `${'Approved testimony title. '.repeat(4)}TITLE_TAIL`,
      detail: `${'Keep measured narration. '.repeat(9)}${DETAIL_TAIL}`,
    };
    const { row, settings } = approvedProfile({ observations: rows });
    const before = JSON.stringify(settings);
    const { approved, pin } = continuationGenerationProfileSnapshot(row);
    expect(styleValue(approved).observations).toEqual(projectedObservations(rows));
    expect(JSON.stringify(approved)).toContain(MIDDLE_RULE);
    expect(JSON.stringify(approved)).toContain(DETAIL_TAIL);
    expect(JSON.stringify(approved)).toContain('TITLE_TAIL');
    expect(Buffer.byteLength(JSON.stringify(approved), 'utf8')).toBeLessThanOrEqual(VIEW_CAP);
    expect(pin.approvedFingerprint).toBe(row.approvedFingerprint);
    expect(JSON.stringify(settings)).toBe(before);
  });

  it.each(['accepted', 'edited'] as const)('preserves five %s rules when every detail is below 120 characters', decision => {
    const rows = shortRules();
    expect(rows.every(row => row.detail.length < 120)).toBe(true);
    const { row } = approvedProfile({ observations: rows }, decision);
    expect(styleValue(continuationGenerationProfileSnapshot(row).approved).observations)
      .toEqual(projectedObservations(rows));
  });

  it('keeps full category names and every example, including later exceptions', () => {
    const categories: Category[] = [{
      category: `narrative_voice_${'approved_'.repeat(6)}CATEGORY_TAIL`,
      observations: [
        `${'Use measured narration. '.repeat(7)}EXAMPLE_TAIL`,
        'For testimony, retain full sentences and never clip quotations.',
        'Keep the approved final exception.',
      ],
    }];
    const { row } = approvedProfile({ categories });
    const style = styleValue(continuationGenerationProfileSnapshot(row).approved);
    expect(style.categories).toEqual(categories);
    expect(JSON.stringify(style.categories)).not.toContain('"example":');
  });

  it('preserves reversed category and example order and their distinct approved fingerprint', () => {
    const categories: Category[] = [
      { category: 'dialogue', observations: ['Keep full quotations.', 'Never omit the exception.'] },
      { category: 'narrative_voice', observations: ['Keep first person.', 'Retain testimony clauses.'] },
    ];
    const reversed = [...categories].reverse().map(category => ({
      ...category, observations: [...category.observations].reverse(),
    }));
    const forward = approvedProfile({ categories });
    const backward = approvedProfile({ categories: reversed });
    expect(backward.row.approvedFingerprint).not.toBe(forward.row.approvedFingerprint);
    expect(styleValue(continuationGenerationProfileSnapshot(forward.row).approved).categories).toEqual(categories);
    expect(styleValue(continuationGenerationProfileSnapshot(backward.row).approved).categories).toEqual(reversed);
  });

  it('retains seven legal edited category rows rather than limiting them to six', () => {
    const categories = Array.from({ length: 7 }, (_, index) => ({
      category: `edited-style-${index + 1}`, observations: [`Approved condition ${index + 1}.`],
    }));
    const { row } = approvedProfile({ categories });
    expect(styleValue(continuationGenerationProfileSnapshot(row).approved).categories).toEqual(categories);
  });

  it('ignores blank and invalid rows without transmitting unknown properties or unvalidated sources', () => {
    const { row } = approvedProfile({
      observations: [
        null, [], 'not-an-object', { title: 'Blank', detail: ' \t ' },
        { title: 'Missing detail' },
        { title: 'Validated', detail: MIDDLE_RULE, sourceRef,
          sourcePartKey: 'forged-part', sourceParagraphIndex: 1, referenceScope: 'reader_route_fact', secret: 'DROP_ME' },
        { title: 'Unvalidated', detail: DETAIL_TAIL, sourceRef: 'analysis:invalid', secret: 'DROP_ME' },
      ],
      categories: [
        null, [], { category: ' ', observations: ['Ignored.'] },
        { category: 'empty', observations: [' ', null, 42] },
        { category: 'dialogue', observations: [' ', 'Keep quotations.', null, 42, 'Retain exceptions.'],
          example: 'DROP_ME', secret: 'DROP_ME' },
      ],
    }, 'edited', [{ sourceType: 'manuscript', sourceRef: `${sourceRef}:PART-LATE:17`, summary: 'Synthetic provenance.' }]);
    const style = styleValue(continuationGenerationProfileSnapshot(row).approved);
    expect(style.referenceScope).toBe('production_constraint');
    expect(style.observations).toEqual([
      { title: 'Validated', detail: MIDDLE_RULE, referenceScope: 'writing_pattern',
        sourceRef, sourcePartKey: 'PART-LATE', sourceParagraphIndex: 17 },
      { title: 'Unvalidated', detail: DETAIL_TAIL, referenceScope: 'writing_pattern' },
    ]);
    expect(style.categories).toEqual([{ category: 'dialogue', observations: ['Keep quotations.', 'Retain exceptions.'] }]);
    expect(JSON.stringify(style)).not.toContain('DROP_ME');
    expect(JSON.stringify(style)).not.toContain('forged-part');
    expect(JSON.stringify(style)).not.toContain('analysis:invalid');
  });

  it('serializes a small complete style view without changing input or output allowances', () => {
    const rows = shortRules();
    rows[0].detail = `${'Keep measured narration. '.repeat(9)}${DETAIL_TAIL}`;
    const categories = [{ category: 'narrative_voice', observations: [MIDDLE_RULE, DETAIL_TAIL] }];
    const { row } = approvedProfile({ observations: rows, categories });
    const { approved } = continuationGenerationProfileSnapshot(row);
    const request = requestFor(approved);
    const body = buildStoryContinuationOpenAiRequest(request, config);
    const serialized = JSON.parse(body.input[0].content[0].text);
    expect(serialized.generationProfile).toEqual(approved);
    expect(styleValue(serialized.generationProfile).observations).toEqual(projectedObservations(rows));
    expect(styleValue(serialized.generationProfile).categories).toEqual(categories);
    expect(body.truncation).toBe('disabled');
    expect(body.max_output_tokens).toBe(8_192);
    const preflight = preflightStoryContinuationOpenAiRequest(request, config);
    expect(preflight.supported).toBe(true);
    expect(preflight.inputTokenLimit).toBe(32_768);
    expect(preflight.inputTokenUpperBound).toBeGreaterThan(0);
    expect(preflight.inputTokenUpperBound).toBeLessThanOrEqual(32_768);
    expect(request.inputTokenLimit).toBe(config.maxInputTokens);
    expect(request.outputTokenLimit).toBe(config.maxOutputTokens);
  });

  it.each(['observations', 'categories'] as const)('rejects complete %s overflow before request serialization', field => {
    const longDetails = Array.from({ length: 3 }, (_, index) => `${'A'.repeat(6_000)}RULE_TAIL_${index}`);
    const style = field === 'observations'
      ? { observations: longDetails.map((detail, index) => ({ title: `Rule ${index}`, detail })) }
      : { categories: [{ category: 'narrative_voice', observations: longDetails }] };
    const { row, settings } = approvedProfile(style);
    expect(Buffer.byteLength(JSON.stringify(settings), 'utf8')).toBeGreaterThan(VIEW_CAP);
    expect(Buffer.byteLength(JSON.stringify(settings), 'utf8')).toBeLessThan(128 * 1024);
    const before = JSON.stringify(row);
    const serialize = jest.fn((approved: ApprovedView) => buildStoryContinuationOpenAiRequest(requestFor(approved), config));
    expect(() => serialize(continuationGenerationProfileSnapshot(row).approved))
      .toThrow('generation_profile_context_too_large');
    expect(serialize).not.toHaveBeenCalled();
    expect(JSON.stringify(row)).toBe(before);
  });

  it('rejects changed style fields when the approved fingerprint was not renewed', () => {
    const { row, settings } = approvedProfile({ observations: shortRules() });
    const style = settings.sections.find(section => section.key === 'writing_style')!.value;
    style.observations = [{ title: 'Unapproved replacement', detail: 'Never authorize this replacement.' }];
    expect(() => continuationGenerationProfileSnapshot(row)).toThrow('generation_profile_fingerprint_changed');
  });

  it('uses narrative view v6 and rejects a queued v5 pin without rewriting it or doing further lookups', async () => {
    expect(STORY_CONTINUATION_PROFILE_VIEW_VERSION).toBe('story-profile-prompt-v6');
    const { row } = approvedProfile({ observations: shortRules() });
    const { pin } = continuationGenerationProfileSnapshot(row);
    const contextReferences = { memoryPins: [], generationProfilePin: pin, generationProfileViewVersion: 'story-profile-prompt-v5' };
    const before = JSON.stringify(contextReferences);
    const findUnique = jest.fn().mockResolvedValue({ leaseToken: 'synthetic-lease', contextReferences });
    const forbidden = jest.fn(() => { throw new Error('No further synthetic lookup or write is allowed'); });
    const readOnlyFacade = new Proxy({ storyAiContinuation: { findUnique } }, {
      get(target, key) { return key === 'storyAiContinuation' ? target.storyAiContinuation : forbidden(); },
    });
    const assembler = new StoryContinuationContextAssembler(readOnlyFacade as never);
    await expect(assembler.assemble({ continuationId: 'synthetic-queued-v5', leaseToken: 'synthetic-lease' } as never))
      .rejects.toMatchObject({ code: 'pinned_context_changed' });
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(forbidden).not.toHaveBeenCalled();
    expect(JSON.stringify(contextReferences)).toBe(before);
  });

  it('leaves visual-only projection independent of narrative style-field overflow', () => {
    const { row } = approvedProfile({ observations: Array.from({ length: 3 }, (_, index) => ({
      title: `Rule ${index}`, detail: `${'A'.repeat(6_000)}${DETAIL_TAIL}`,
    })) });
    const visual = continuationGenerationProfileVisualSnapshot(row);
    expect(visual.approved.sections.map(section => section.key)).toEqual(['visual_cast', 'visual_direction']);
    expect(visual.pin.approvedFingerprint).toBe(row.approvedFingerprint);
    expect(JSON.stringify(visual.approved)).not.toContain(DETAIL_TAIL);
    expect(Buffer.byteLength(JSON.stringify(visual.approved), 'utf8')).toBeLessThanOrEqual(VIEW_CAP);
  });
});

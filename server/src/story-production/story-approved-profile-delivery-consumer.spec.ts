import { STORY_PROFILE_SECTION_KEYS, CREATOR_GENERATION_PROFILE_SCHEMA,
  normalizeCreatorGenerationProfile, creatorGenerationProfileFingerprint } from '../generation-profile/creator-generation-profile.policy';
import { buildStoryApprovedProfileDelivery, createStoryApprovedProfileDiagnosticView,
  type StoryApprovedProfileDeliveryRow } from './story-approved-profile-delivery.policy';
import { continuationGenerationProfileSnapshot, profileObservationSource } from './story-continuation-context.policy';
import { buildStoryContinuationOpenAiRequest, prepareStoryContinuationOpenAiRequestForDiagnostics,
  preflightStoryContinuationOpenAiRequest } from './story-continuation-openai.prompt';
import { inspectStoryContinuationFixedCapFit } from './story-continuation-fixed-cap-fit';
import { STORY_CONTINUATION_PROMPT_VERSION, STORY_CONTINUATION_SCHEMA_VERSION } from './story-continuation-openai.schema';
import type { StoryContinuationProviderRequest } from './story-continuation.provider';
import type { StoryContinuationOpenAiConfig } from './story-continuation-openai.config';
import { storyContinuationInputTokenBudget } from './story-continuation-tokenizer';

const PRIVATE = 'SYNTHETIC_APPROVED_STYLE_AND_EVIDENCE';
const ref = 'analysis:00000000-0000-4000-8000-000000000003';
function fixture(locale = 'en') {
  const settings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story', sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
      key, decision: key === 'narrative_devices' ? 'removed' : 'accepted',
      value: key === 'writing_style' ? { summary: `  ${PRIVATE}  `,
        observations: [{ title: 'Keep pauses', detail: 'Retain the final exception.', sourceRef: ref }],
        categories: [{ category: 'voice', observations: ['Keep pauses.', 'Keep pauses.'] }] }
        : { summary: `synthetic ${key}`, reader_history: 'not an established event' },
      evidence: [{ sourceType: 'manuscript', sourceRef: `${ref}:PART:7`, summary: PRIVATE },
        { sourceType: 'manuscript', sourceRef: `${ref}:PART:7`, summary: PRIVATE }],
    })),
  });
  const currentRow: StoryApprovedProfileDeliveryRow = { id: 'synthetic-profile', status: 'approved',
    profileVersion: 1, reviewRevision: 2, sourceFingerprint: 'a'.repeat(64), approvedSettings: settings,
    approvedFingerprint: creatorGenerationProfileFingerprint('a'.repeat(64), settings) };
  const { id, profileVersion, reviewRevision, sourceFingerprint, approvedFingerprint } = currentRow;
  const packet = buildStoryApprovedProfileDelivery(currentRow,
    { id, profileVersion, reviewRevision, sourceFingerprint, approvedFingerprint: approvedFingerprint! }, profileObservationSource);
  const config: StoryContinuationOpenAiConfig = { enabled: true, provider: 'openai', model: 'gpt-4.1-2025-04-14',
    apiKey: 'synthetic-not-a-key', rateCardId: 'synthetic-rate', rateCardVersion: 'v1', timeoutMs: 100,
    maxInputTokens: 32768, maxOutputTokens: 8192, maxResponseBytes: 200000,
    visualAssetPath: '/assets/story/neutral-placeholder.webp' };
  const request: StoryContinuationProviderRequest = { operationId: 'synthetic_free_delivery', locale,
    contextFingerprint: 'synthetic-only', promptVersion: STORY_CONTINUATION_PROMPT_VERSION,
    outputSchemaVersion: STORY_CONTINUATION_SCHEMA_VERSION, inputTokenLimit: 32768, outputTokenLimit: 8192,
    provider: config.provider, model: config.model, rateCardId: config.rateCardId, rateCardVersion: config.rateCardVersion,
    approvedContext: { sourceScene: { title: 'Synthetic scene', beats: [{ beatType: 'paragraph', content: 'Synthetic prose. '.repeat(100) }] },
      selectedChoice: { label: 'Choose the unvisited door' }, path: [], memories: [],
      generationProfile: createStoryApprovedProfileDiagnosticView(settings) } };
  return { request, config, binding: { packet, currentRow }, settings };
}

describe('lossless approved profile in the actual free request consumer', () => {
  it.each(['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'])('measures the complete preserved delivery in %s', locale => {
    const f = fixture(locale), before = JSON.stringify(f);
    const body = prepareStoryContinuationOpenAiRequestForDiagnostics(f.request, f.config, f.binding);
    const delivered = JSON.parse(body.input[0].content[0].text).generationProfile;
    expect(delivered).toEqual(f.binding.packet);
    expect(delivered.authorData.sections).toHaveLength(8);
    expect(delivered.approvalEvidence.every((e: { items: unknown[] }) => e.items.length === 2)).toBe(true);
    expect(delivered.authorData.sections.find((s: { key: string }) => s.key === 'writing_style').value.summary).toBe(`  ${PRIVATE}  `);
    expect(delivered.serverInterpretation.sections.find((s: { key: string }) => s.key === 'narrative_devices').active).toBe(false);
    expect(body.instructions).toContain('Inactive sections');
    expect(body.instructions).toContain('never semantic approval');
    expect(body.max_output_tokens).toBe(8192);
    expect(body.truncation).toBe('disabled');
    const diagnostic = inspectStoryContinuationFixedCapFit(f.request, f.config, f.binding);
    expect(diagnostic).toMatchObject({ writingStylePresent: true, providerCalls: 0,
      outputFit: 'unmeasured', dispatchAuthorized: false, semanticQualityVerified: false,
      inputTokenBudget: storyContinuationInputTokenBudget(body), requestBytes: Buffer.byteLength(JSON.stringify(body), 'utf8') });
    expect(JSON.stringify(diagnostic)).not.toContain(PRIVATE);
    expect(JSON.stringify(f)).toBe(before);
  });

  it.each(['id', 'profileVersion', 'reviewRevision', 'sourceFingerprint', 'approvedFingerprint'] as const)
    ('rejects a stale current %s before preparing input', key => {
      const f = fixture();
      const changed = { ...f.binding.currentRow,
        [key]: typeof f.binding.currentRow[key] === 'number' ? Number(f.binding.currentRow[key]) + 1 : 'b'.repeat(64) };
      const result = inspectStoryContinuationFixedCapFit(f.request, f.config, { ...f.binding, currentRow: changed });
      expect(result).toMatchObject({ inputFit: 'unmeasured', inputTokenBudget: null, requestBytes: null,
        reason: 'provider_context_invalid', providerCalls: 0 });
    });

  it.each(['authority', 'evidence', 'inactive', 'version', 'history'])('rejects tampered %s data without a legacy fallback', kind => {
    const f = fixture(), packet = JSON.parse(JSON.stringify(f.binding.packet));
    if (kind === 'authority') packet.serverInterpretation.authorMetadataConfersAuthority = true;
    if (kind === 'evidence') packet.approvalEvidence[0].items.pop();
    if (kind === 'inactive') packet.serverInterpretation.sections.find((s: { key: string }) => s.key === 'narrative_devices').active = true;
    if (kind === 'version') packet.contract = 'story-profile-prompt-v6';
    if (kind === 'history') packet.serverInterpretation.evidenceIsReaderHistory = true;
    expect(inspectStoryContinuationFixedCapFit(f.request, f.config, { ...f.binding, packet }))
      .toMatchObject({ inputFit: 'unmeasured', requestBytes: null, reason: 'provider_context_invalid' });
  });

  it.each(['omitted', 'undefined', 'null'])('rejects a %s binding in diagnostics and in paid admission', kind => {
    const f = fixture();
    const prepare = () => kind === 'omitted'
      ? prepareStoryContinuationOpenAiRequestForDiagnostics(f.request, f.config)
      : prepareStoryContinuationOpenAiRequestForDiagnostics(f.request, f.config,
        (kind === 'null' ? null : undefined) as never);
    expect(prepare).toThrow('provider_context_invalid');
    expect(() => buildStoryContinuationOpenAiRequest(f.request, f.config)).toThrow('provider_context_invalid');
    expect(() => Reflect.apply(buildStoryContinuationOpenAiRequest, undefined, [f.request, f.config, f.binding]))
      .toThrow('provider_context_invalid');
    expect(preflightStoryContinuationOpenAiRequest(f.request, f.config))
      .toMatchObject({ supported: false, reason: 'provider_context_invalid' });
    expect(inspectStoryContinuationFixedCapFit(f.request, f.config))
      .toMatchObject({ inputFit: 'unmeasured', requestBytes: null, inputTokenBudget: null });
  });

  it.each(['missing', 'clone', 'reordered', 'omitted', 'changed', 'foreign', 'marker'])
    ('rejects a %s context paired with an otherwise valid binding', kind => {
      const f = fixture(), raw = JSON.parse(JSON.stringify(f.settings));
      if (kind === 'reordered') raw.sections.reverse();
      if (kind === 'omitted') raw.sections.pop();
      if (kind === 'changed' || kind === 'foreign') raw.sections[0].value.summary = 'different approved value';
      const context = f.request.approvedContext!;
      if (kind === 'missing') delete context.generationProfile;
      else if (kind === 'clone' || kind === 'marker') {
        const clone = JSON.parse(JSON.stringify(context.generationProfile));
        if (kind === 'marker') clone.diagnosticDeliveryContract = 'unknown-version';
        context.generationProfile = clone;
      } else context.generationProfile = createStoryApprovedProfileDiagnosticView(raw);
      expect(inspectStoryContinuationFixedCapFit(f.request, f.config, f.binding))
        .toMatchObject({ inputFit: 'unmeasured', requestBytes: null, reason: 'provider_context_invalid' });
    });

  it('freezes fresh marked views without freezing the approved input or permitting marker removal', () => {
    const f = fixture(), view = f.request.approvedContext!.generationProfile!;
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.sections[0].value)).toBe(true);
    expect(Object.isFrozen(f.settings)).toBe(false);
    expect(() => { delete (view as any).diagnosticDeliveryContract; }).toThrow();
    expect(() => buildStoryContinuationOpenAiRequest(f.request, f.config)).toThrow('provider_context_invalid');
  });

  it.each([16383, 16384, 16385])('applies the complete-packet %i-byte boundary in the real consumer', target => {
    const f = fixture(), settings = JSON.parse(JSON.stringify(f.settings));
    settings.sections[0].value.paddingParts = ['', ''];
    const bind = () => {
      const currentRow = { ...f.binding.currentRow, approvedSettings: settings,
        approvedFingerprint: creatorGenerationProfileFingerprint(f.binding.currentRow.sourceFingerprint, settings) };
      const packet = buildStoryApprovedProfileDelivery(currentRow, { ...f.binding.packet.pin,
        approvedFingerprint: currentRow.approvedFingerprint }, profileObservationSource);
      return { currentRow, packet };
    };
    const padding = target - Buffer.byteLength(JSON.stringify(bind().packet), 'utf8');
    expect(padding).toBeGreaterThanOrEqual(0); expect(padding).toBeLessThanOrEqual(16000);
    settings.sections[0].value.paddingParts = ['x'.repeat(Math.min(padding, 8000)), 'x'.repeat(Math.max(padding - 8000, 0))];
    const binding = bind();
    f.request.approvedContext!.generationProfile = createStoryApprovedProfileDiagnosticView(settings);
    expect(Buffer.byteLength(JSON.stringify(binding.packet), 'utf8')).toBe(target);
    if (target > 16384) expect(inspectStoryContinuationFixedCapFit(f.request, f.config, binding))
      .toMatchObject({ inputFit: 'unmeasured', requestBytes: null, reason: 'provider_context_invalid' });
    else expect(JSON.parse(prepareStoryContinuationOpenAiRequestForDiagnostics(f.request, f.config, binding)
      .input[0].content[0].text).generationProfile).toEqual(binding.packet);
  });

  it('keeps oversized full evidence intact and refuses before whole-request measurement', () => {
    const f = fixture(), raw = JSON.parse(JSON.stringify(f.settings));
    raw.sections.find((s: { key: string }) => s.key === 'writing_style').value.summary = '\uac00'.repeat(7900);
    const currentRow = { ...f.binding.currentRow, approvedSettings: raw,
      approvedFingerprint: creatorGenerationProfileFingerprint(f.binding.currentRow.sourceFingerprint, raw) };
    const packet = buildStoryApprovedProfileDelivery(currentRow, { ...f.binding.packet.pin,
      approvedFingerprint: currentRow.approvedFingerprint }, profileObservationSource);
    f.request.approvedContext!.generationProfile = createStoryApprovedProfileDiagnosticView(raw);
    const before = JSON.stringify(packet);
    expect(inspectStoryContinuationFixedCapFit(f.request, f.config, { packet, currentRow }))
      .toMatchObject({ inputFit: 'unmeasured', requestBytes: null, reason: 'provider_context_invalid' });
    expect(JSON.stringify(packet)).toBe(before);
    expect(Buffer.byteLength(before, 'utf8')).toBeGreaterThan(16384);
  });

  it('preserves the old paid v6 path and refuses the new packet in its legacy slot', () => {
    const f = fixture();
    const legacy = continuationGenerationProfileSnapshot(f.binding.currentRow as never).approved;
    f.request.approvedContext!.generationProfile = legacy;
    const paid = buildStoryContinuationOpenAiRequest(f.request, f.config);
    expect(paid).toEqual(prepareStoryContinuationOpenAiRequestForDiagnostics(f.request, f.config));
    expect(paid.instructions).not.toContain('story-approved-profile-delivery-v1');
    expect(JSON.parse(paid.input[0].content[0].text).generationProfile).toEqual(legacy);
    f.request.approvedContext!.generationProfile = f.binding.packet as never;
    expect(() => buildStoryContinuationOpenAiRequest(f.request, f.config)).toThrow('provider_context_invalid');
  });
});

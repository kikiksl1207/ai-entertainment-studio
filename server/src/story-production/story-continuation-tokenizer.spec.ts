import { getEncoding } from 'js-tiktoken';
import { storyContinuationInputTokenBudget, storyContinuationModelEncoding } from './story-continuation-tokenizer';
import { readStoryContinuationOpenAiConfig, storyContinuationConfigFailure } from './story-continuation-openai.config';
import { koreanContinuationContext } from './story-continuation-korean-context.fixture';
import { buildStoryContinuationOpenAiRequest, preflightStoryContinuationOpenAiRequest } from './story-continuation-openai.prompt';

describe('offline pinned story tokenizer', () => {
  it.each(['gpt-4.1-2025-04-14', 'gpt-4o-2024-08-06', 'gpt-5-mini-2025-08-07', 'gpt-5.4-mini-2026-03-17'])('uses a pinned o200k model mapping: %s', (model) => {
    expect(storyContinuationModelEncoding(model)).toBe('o200k_base');
  });
  it.each(['gpt-4.1', 'gpt-4.1-2099-01-01', 'future-2026-09-22', 'gpt-4-turbo-2024-04-09'])('fails closed for unknown/unsupported encodings: %s', (model) => {
    expect(storyContinuationModelEncoding(model)).toBeUndefined();
    expect(() => storyContinuationInputTokenBudget({ model })).toThrow('provider_model_encoding_unknown');
  });
  it('matches the proven library plus a 10% and 256-token framing reserve', () => {
    const body = { model: 'gpt-4.1-2025-04-14', instructions: 'Preserve approved voice.',
      text: { format: { schema: { type: 'object', properties: { title: { type: 'string' } } } } },
      input: '<|endoftext|> is literal untrusted story text, not a special token.' };
    const tokens = getEncoding('o200k_base').encode(JSON.stringify(body), [], []).length;
    expect(storyContinuationInputTokenBudget(body)).toBe(Math.ceil(tokens * 1.1) + 256);
  });
  it('does not count via network or read an API key', () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network prohibited'));
    try {
      expect(storyContinuationInputTokenBudget({ model: 'gpt-4.1-2025-04-14' })).toBeGreaterThan(256);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it('readiness rejects an otherwise configured model absent from the pinned encoding table', () => {
    const config = readStoryContinuationOpenAiConfig({ get: () => undefined });
    expect(storyContinuationConfigFailure({ ...config, enabled: true, provider: 'openai', model: 'future-2026-09-22' }))
      .toBe('provider_model_encoding_unknown');
  });

  it('reuses the server OpenAI key when no continuation-specific key is configured', () => {
    const config = readStoryContinuationOpenAiConfig({
      get: <T = string>(key: string) => key === 'OPENAI_API_KEY' ? 'shared-server-key' as T
        : key === 'STORY_CONTINUATION_PROVIDER_ENABLED' ? 'true' as T : undefined,
    });
    expect(config.apiKey).toBe('shared-server-key');
  });

  it('preserves a varied 10k Korean scene, author style, material choice and semantic path under 32768 tokens', () => {
    const model = 'gpt-4.1-2025-04-14';
    const approvedContext = koreanContinuationContext();
    const config = { ...readStoryContinuationOpenAiConfig({ get: () => undefined }), enabled: true,
      provider: 'openai', model, rateCardId: 'qa-card', rateCardVersion: 'qa-v1', apiKey: 'fake-test-key',
      visualAssetPath: '/assets/story/placeholder.webp' };
    const request = { provider: 'openai', model, rateCardId: 'qa-card', rateCardVersion: 'qa-v1',
      operationId: 'qa-operation', locale: 'ko', contextFingerprint: 'qa',
      promptVersion: 'story-continuation-v2', outputSchemaVersion: 'story-continuation-output-v1',
      inputTokenLimit: 32768, outputTokenLimit: 500, approvedContext };
    expect(approvedContext.sourceScene.beats.reduce((sum, beat) => sum + beat.content.length, 0)).toBe(10_000);
    expect(approvedContext.sourceScene.beats.length).toBeLessThanOrEqual(40);
    const before = JSON.stringify(approvedContext);
    const preflight = preflightStoryContinuationOpenAiRequest(request, config);
    expect(preflight).toMatchObject({ supported: true, reason: 'provider_preflight_ready' });
    expect(preflight.inputTokenUpperBound).toBeLessThanOrEqual(32768);
    const body = buildStoryContinuationOpenAiRequest(request, config);
    expect(JSON.parse(body.input[0].content[0].text)).toMatchObject(approvedContext);
    expect(JSON.parse(body.input[0].content[0].text).narrativeLength).toMatchObject({
      measurement: 'narrative-nonwhite-codepoints-v1',
      minimumUnits: expect.any(Number),
      targetUnits: expect.any(Number),
      maximumUnits: expect.any(Number),
    });
    expect(JSON.stringify(approvedContext)).toBe(before);
    const alternate = buildStoryContinuationOpenAiRequest({ ...request, approvedContext: {
      ...approvedContext, selectedChoice: { label: '\ub9c8\uc744\uc744 \ub5a0\ub098 \ub3c4\ud604\uc5d0\uac8c \ub2e4\ub9ac\ub97c \ub9e1\uae34\ub2e4' },
    } }, config);
    expect(alternate.input[0].content[0].text).not.toBe(body.input[0].content[0].text);
    expect(body.instructions).toContain('Do not force convergence');
    expect(body.instructions).toContain('fresh scene title');
    expect(body.instructions).toContain('mandatory bounds');
    expect(preflightStoryContinuationOpenAiRequest({ ...request, inputTokenLimit: 1000 }, config))
      .toMatchObject({ supported: false, reason: 'provider_input_bound_exceeded' });
  });

  it('preserves canonical 7500-unit Korean beats while retaining byte and total-token bounds', () => {
    const model = 'gpt-5-mini-2025-08-07';
    const config = { ...readStoryContinuationOpenAiConfig({ get: () => undefined }), enabled: true,
      provider: 'openai', model, rateCardId: 'qa-card', rateCardVersion: 'qa-v1', apiKey: 'fake-test-key',
      visualAssetPath: '/assets/story/fallback.webp' };
    const approvedContext = koreanContinuationContext();
    approvedContext.sourceScene.beats = [{ beatType: 'narration', content: '한글 원문 그대로 유지. '.repeat(600).slice(0, 7500) }];
    const request = { provider: 'openai', model, rateCardId: 'qa-card', rateCardVersion: 'qa-v1',
      operationId: 'qa-operation', locale: 'ko', contextFingerprint: 'qa',
      promptVersion: 'story-continuation-v2', outputSchemaVersion: 'story-continuation-output-v1',
      inputTokenLimit: 32768, outputTokenLimit: 500, approvedContext };
    expect(Buffer.byteLength(approvedContext.sourceScene.beats[0].content)).toBeGreaterThan(16000);
    expect(JSON.parse(buildStoryContinuationOpenAiRequest(request, config).input[0].content[0].text))
      .toMatchObject(approvedContext);
    expect(preflightStoryContinuationOpenAiRequest({ ...request, inputTokenLimit: 1000 }, config).supported).toBe(false);
    approvedContext.sourceScene.beats[0].content = '한'.repeat(10667);
    expect(preflightStoryContinuationOpenAiRequest(request, config))
      .toMatchObject({ supported: false, reason: 'provider_context_invalid' });
  });
});

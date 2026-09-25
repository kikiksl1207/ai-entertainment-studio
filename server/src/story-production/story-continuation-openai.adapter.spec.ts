import { OpenAiStoryContinuationProvider, type StoryContinuationFetch } from './story-continuation-openai.adapter';
import { readStoryContinuationOpenAiConfig, type StoryContinuationOpenAiConfig } from './story-continuation-openai.config';
import { buildStoryContinuationOpenAiRequest, preflightStoryContinuationOpenAiRequest } from './story-continuation-openai.prompt';
import { storyContinuationInputTokenBudget } from './story-continuation-tokenizer';
import { DisabledStoryContinuationProvider, type StoryContinuationProviderRequest } from './story-continuation.provider';

const config: StoryContinuationOpenAiConfig = {
  enabled: true, provider: 'openai', model: 'gpt-4.1-2025-04-14',
  rateCardId: 'card-1', rateCardVersion: 'v1', apiKey: 'fake-test-key',
  timeoutMs: 100, maxInputTokens: 32_768, maxOutputTokens: 8_192,
  maxResponseBytes: 200_000, visualAssetPath: '/assets/story/neutral-placeholder.webp',
};

function request(): StoryContinuationProviderRequest {
  return {
    operationId: 'operation-1', locale: 'en', contextFingerprint: 'fingerprint',
    provider: config.provider, model: config.model, rateCardId: config.rateCardId, rateCardVersion: config.rateCardVersion,
    promptVersion: 'story-continuation-v2', outputSchemaVersion: 'story-continuation-output-v1',
    inputTokenLimit: 8_192, outputTokenLimit: 500,
    approvedContext: {
      sourceScene: { title: 'Crossroads', beats: [{ beatType: 'paragraph', content: 'Two paths diverge.' }] },
      selectedChoice: { label: 'Take the left path' }, path: [], memories: [],
    },
  };
}

function output() {
  return {
    title: { en: 'The Left Path' }, beats: [{ beatType: 'paragraph', content: { en: 'The path leads to a gate.' } }],
    nextChoices: [
      { choiceKey: 'open-gate', label: { en: 'Open the gate' } },
      { choiceKey: 'ask-guard', label: { en: 'Question the guard' } },
      { choiceKey: 'turn-back', label: { en: 'Turn back' } },
    ], ending: null as { endingKey: string } | null,
  };
}

function envelope(value: unknown = output()) {
  return {
    model: config.model, status: 'completed',
    output: [{ type: 'reasoning' }, { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
    usage: { input_tokens: 120, input_tokens_details: { cached_tokens: 30 }, output_tokens: 100, output_tokens_details: { reasoning_tokens: 70 }, total_tokens: 220 },
  };
}

function fixture(options: Partial<StoryContinuationOpenAiConfig> = {}) {
  const transport = jest.fn<ReturnType<StoryContinuationFetch>, Parameters<StoryContinuationFetch>>()
    .mockImplementation(async () => new Response(JSON.stringify(envelope())));
  return { transport, provider: new OpenAiStoryContinuationProvider({ ...config, ...options }, transport) };
}

describe('OpenAiStoryContinuationProvider (fake transport only)', () => {
  let network: jest.SpyInstance;
  beforeEach(() => { network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network prohibited')); });
  afterEach(() => { expect(network).not.toHaveBeenCalled(); network.mockRestore(); });

  it('defaults OFF without looking up or using a general chat key', async () => {
    const reader = { get: jest.fn().mockReturnValue(undefined) };
    const c = readStoryContinuationOpenAiConfig(reader);
    expect(c.maxOutputTokens).toBe(32_768);
    const f = fixture(c);
    await expect(f.provider.readiness()).resolves.toEqual({ enabled: false, reason: 'provider_disabled' });
    await expect(f.provider.generate(request(), new AbortController().signal)).rejects.toMatchObject({ code: 'provider_disabled', retryable: false });
    expect(reader.get).not.toHaveBeenCalledWith('OPENAI_API_KEY');
    expect(f.transport).not.toHaveBeenCalled();
  });

  it('exposes provider preflight with safe diagnostics and no transport or secret-config dependency', async () => {
    const f = fixture();
    await expect(f.provider.preflight(request())).resolves.toMatchObject({ supported: true, budgetMethod: 'js_tiktoken_o200k_base_v1' });
    await expect(f.provider.preflight({ ...request(), rateCardVersion: undefined })).resolves.toMatchObject({ supported: false, reason: 'provider_pin_mismatch' });
    await expect(new DisabledStoryContinuationProvider().preflight()).resolves.toMatchObject({ supported: false });
    expect(JSON.stringify(await f.provider.preflight(request()))).not.toContain(config.apiKey);
    expect(f.transport).not.toHaveBeenCalled();
  });

  it.each([
    { provider: 'other' }, { model: 'gpt-4.1' }, { apiKey: '' }, { rateCardId: '' }, { rateCardVersion: '' },
    { visualAssetPath: 'https://external.invalid/image.png' }, { visualAssetPath: '//external/image.png' },
    { visualAssetPath: '/assets/../private.png' }, { timeoutMs: 90_001 }, { maxResponseBytes: NaN },
  ])('fails closed for invalid config %#', async (options) => {
    const f = fixture(options);
    expect((await f.provider.readiness()).enabled).toBe(false);
    await expect(f.provider.generate(request(), new AbortController().signal)).rejects.toBeDefined();
    expect(f.transport).not.toHaveBeenCalled();
  });

  it.each(['provider', 'model', 'rateCardId', 'rateCardVersion'] as const)('requires exact %s pin', async (key) => {
    const f = fixture();
    for (const value of [undefined, 'mismatch']) {
      await expect(f.provider.generate({ ...request(), [key]: value }, new AbortController().signal))
        .rejects.toMatchObject({ code: 'provider_pin_mismatch', retryable: false });
    }
    expect(f.transport).not.toHaveBeenCalled();
  });

  it('uses strict Responses format, explicit fallback visual and subset token accounting', async () => {
    const f = fixture();
    const result = await f.provider.generate(request(), new AbortController().signal);
    expect(result.usage).toEqual({ inputTokens: 120, cachedInputTokens: 30, outputTokens: 100, imageUnits: 0 });
    expect(result.visualManifest).toEqual({
      sceneKey: 'ai-operation-1', background: { publicAssetPath: config.visualAssetPath, altKey: 'story.visual.fallback', state: 'fallback' },
      characters: [], fallback: { publicAssetPath: config.visualAssetPath, altKey: 'story.visual.fallback' },
    });
    const [url, init] = f.transport.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init.redirect).toBe('error');
    expect(body).toMatchObject({ model: config.model, store: false, stream: false, background: false, truncation: 'disabled', max_output_tokens: 500,
      text: { format: { type: 'json_schema', strict: true, schema: { additionalProperties: false, properties: { nextChoices: { maxItems: 3 } } } } } });
    expect(body.instructions).toContain('exactly 3 distinct nextChoices');
    expect(body.instructions).toContain('mandatory bounds');
    expect(JSON.parse(body.input[0].content[0].text).narrativeLength).toMatchObject({
      sourceUnits: 16, minimumUnits: 13, targetUnits: 16, maximumUnits: 19,
    });
    expect(body).not.toHaveProperty('tools');
    expect(body.text.format.schema.properties).not.toHaveProperty('visualManifest');
    expect(f.transport).toHaveBeenCalledTimes(1);
  });

  it('projects only approved context and does not send request ids, pins, raw manuscript or secret extra fields', async () => {
    const f = fixture();
    const req = request();
    Object.assign(req, { rawManuscript: 'secret-manuscript', apiKey: 'private-key' });
    Object.assign(req.approvedContext!, { manuscript: 'secret-manuscript', privateNotes: 'private-notes' });
    Object.assign(req.approvedContext!.sourceScene, { rawStorageKey: 'private-storage' });
    await f.provider.generate(req, new AbortController().signal);
    const body = f.transport.mock.calls[0][1].body as string;
    for (const secret of ['secret-manuscript', 'private-key', 'private-notes', 'private-storage', 'operation-1', 'fingerprint', 'card-1']) expect(body).not.toContain(secret);
    expect(body).toContain('untrusted story data');
  });

  it('sends only creator-approved generation settings as production constraints', async () => {
    const f = fixture();
    const req = request();
    req.approvedContext!.generationProfile = {
      schemaVersion: 'creator-generation-profile-v1',
      sections: [
        { key: 'writing_style', value: { summary: 'Measured first-person prose' } },
        { key: 'visual_direction', value: { era: 'Joseon', palette: 'smoke and sea blue' } },
      ],
    };
    await f.provider.generate(req, new AbortController().signal);
    const body = JSON.parse(f.transport.mock.calls[0][1].body as string);
    const outbound = JSON.parse(body.input[0].content[0].text);
    expect(outbound.generationProfile.sections).toEqual(req.approvedContext!.generationProfile.sections);
    expect(body.instructions).toContain('creator-approved production constraint');
  });

  it('sends the selected artist as a fixed participant without leaking reference assets', async () => {
    const f = fixture();
    const req = request();
    req.approvedContext!.participantArtist = {
      artistId: 'artist-1',
      slug: 'seo-rin',
      displayName: 'Seo Rin',
      visualIdentityReady: true,
      identityProfile: {
        schemaVersion: 'creator-generation-profile-v1',
        sections: [
          { key: 'fixed_identity', value: { hair: 'black', eyes: 'brown' } },
          { key: 'adaptable_presentation', value: { wardrobe: 'story-era clothing' } },
        ],
      },
    };
    await f.provider.generate(req, new AbortController().signal);
    const body = JSON.parse(f.transport.mock.calls[0][1].body as string);
    const outbound = JSON.parse(body.input[0].content[0].text);
    expect(outbound.participantArtist).toEqual(req.approvedContext!.participantArtist);
    expect(body.instructions).toContain('must participate naturally');
    expect(JSON.stringify(outbound)).not.toContain('referenceAssetIds');
  });

  it('counts serialized instructions/schema and framing, not only context length', async () => {
    const req = request();
    const body = buildStoryContinuationOpenAiRequest(req, config);
    const total = storyContinuationInputTokenBudget(body);
    expect(total).toBeGreaterThan(storyContinuationInputTokenBudget({ model: config.model, context: req.approvedContext } as never));
    const f = fixture();
    await expect(f.provider.generate({ ...req, inputTokenLimit: total - 1 }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'provider_input_bound_exceeded' });
    expect(f.transport).not.toHaveBeenCalled();
    expect(() => buildStoryContinuationOpenAiRequest({ ...req, inputTokenLimit: total }, config)).not.toThrow();
  });

  it('fits a synthetic 10k-character Korean scene and its length contract into the release input cap', () => {
    const req = request();
    req.locale = 'ko';
    req.inputTokenLimit = 32_768;
    const sentence = '\uc131\ubb38 \uc55e\uc5d0 \uc120 \uadf8\ub294 \uc57d\uc18d\uc744 \ub5a0\uc62c\ub838\ub2e4. \ub3d9\ub8cc\uc758 \uc120\ud0dd\uc744 \uc874\uc911\ud558\uba70 \ub2e4\ub978 \uae38\uc744 \ud0dd\ud588\ub2e4. ';
    const text = sentence.repeat(300).slice(0, 10_000);
    req.approvedContext!.sourceScene.beats = Array.from({ length: 10 }, (_, i) => ({ beatType: 'paragraph', content: text.slice(i * 1_000, (i + 1) * 1_000) }));
    const original = JSON.stringify(req.approvedContext);
    const result = preflightStoryContinuationOpenAiRequest(req, config);
    expect(result).toMatchObject({ supported: true, reason: 'provider_preflight_ready', budgetMethod: 'js_tiktoken_o200k_base_v1', inputTokenLimit: 32_768 });
    expect(result.inputTokenUpperBound).toBeLessThanOrEqual(32_768);
    expect(JSON.stringify(req.approvedContext)).toBe(original);
    expect(buildStoryContinuationOpenAiRequest({ ...req, inputTokenLimit: 32_768 }, config).instructions)
      .toContain('Preserve the supplied approved author/style memories');
  });

  it.each([
    { locale: 'en-US' }, { locale: 'zh-CN' }, { approvedContext: undefined },
    { promptVersion: 'other' }, { outputSchemaVersion: 'other' }, { outputTokenLimit: 0 },
  ])('rejects request contract violation %#', async (change) => {
    const f = fixture();
    await expect(f.provider.generate({ ...request(), ...change }, new AbortController().signal)).rejects.toBeDefined();
    expect(f.transport).not.toHaveBeenCalled();
  });

  it.each(['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'])('pins exact locale %s in schema', (locale) => {
    const body = buildStoryContinuationOpenAiRequest({ ...request(), locale }, config);
    expect(body.text.format.schema.properties.title).toEqual({
      type: 'object', additionalProperties: false, required: [locale],
      properties: { [locale]: { type: 'string', minLength: 1, maxLength: 160 } },
    });
  });

  it('pins provider-enforceable bounds for prose and route keys', () => {
    const schema = buildStoryContinuationOpenAiRequest(request(), config).text.format.schema;
    const serialized = JSON.stringify(schema);
    expect(serialized).toContain('"maxLength":10000');
    expect(serialized).toContain('^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$');
    expect(serialized).toContain('^ai-[a-zA-Z0-9][a-zA-Z0-9_-]{0,116}$');
  });

  it.each([
    { title: { ko: 'wrong locale' } }, { title: { en: 'right', ko: 'extra' } },
    { nextChoices: Array.from({ length: 4 }, (_, i) => ({ choiceKey: `c${i}`, label: { en: `Choice ${i}` } })) },
    { nextChoices: output().nextChoices.slice(0, 1) },
    { nextChoices: output().nextChoices.slice(0, 2) },
    { nextChoices: [], ending: null },
    { nextChoices: [], ending: { endingKey: '' } },
    { visualManifest: { background: { publicAssetPath: 'https://invented.invalid/image.png' } } },
    { beats: [] }, { beats: [{ beatType: 'image', content: { en: 'bad' } }] },
    { title: { en: 'x'.repeat(501) } },
  ])('rejects invalid output without fallback %#', async (change) => {
    const f = fixture();
    f.transport.mockResolvedValue(new Response(JSON.stringify(envelope({ ...output(), ...change }))));
    await expect(f.provider.generate(request(), new AbortController().signal)).rejects.toMatchObject({
      code: expect.stringMatching(/^provider_(?:output_|malformed_output$)/), retryable: false,
    });
    expect(f.transport).toHaveBeenCalledTimes(1);
  });

  it('returns a safe punctuation-artifact code for a standalone closing bracket', async () => {
    const f = fixture();
    f.transport.mockResolvedValue(new Response(JSON.stringify(envelope({
      ...output(), beats: [{ beatType: 'paragraph', content: { en: 'She waited.\n]\nThen left.' } }],
    }))));
    await expect(f.provider.generate(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'provider_output_punctuation_artifact', retryable: false,
    });
  });

  it('accepts an ending only with no choices', async () => {
    const f = fixture();
    f.transport.mockResolvedValue(new Response(JSON.stringify(envelope({ ...output(), nextChoices: [], ending: { endingKey: 'ai-end' } }))));
    const result = await f.provider.generate(request(), new AbortController().signal);
    expect(result.ending).toEqual({ endingKey: 'ai-end' });
    expect(result.nextChoices).toBeUndefined();
  });

  it('keeps choices when structured output redundantly includes an ending', async () => {
    const f = fixture();
    f.transport.mockResolvedValue(new Response(JSON.stringify(envelope({
      ...output(), ending: { endingKey: 'ai-end' },
    }))));
    const result = await f.provider.generate(request(), new AbortController().signal);
    expect(result.nextChoices).toEqual(output().nextChoices);
    expect(result.ending).toBeUndefined();
  });

  it.each([
    { model: 'different-model' }, { status: 'incomplete' }, { usage: undefined },
    { usage: { ...envelope().usage, output_tokens_details: { reasoning_tokens: 101 } } },
    { usage: { ...envelope().usage, input_tokens_details: { cached_tokens: 121 } } },
    { usage: { ...envelope().usage, total_tokens: 999 } },
    { usage: { ...envelope().usage, input_tokens: -1 } },
    { usage: { ...envelope().usage, input_tokens_details: {} } },
    { output: [{ type: 'function_call', arguments: 'secret' }] },
  ])('rejects malformed envelope or usage %#', async (change) => {
    const f = fixture();
    f.transport.mockResolvedValue(new Response(JSON.stringify({ ...envelope(), ...change })));
    await expect(f.provider.generate(request(), new AbortController().signal)).rejects.toMatchObject({ retryable: false });
  });

  it('classifies refusal without logging or retaining refusal payload', async () => {
    const f = fixture();
    const e = envelope();
    e.output = [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'private-refusal' } as never] }];
    f.transport.mockResolvedValue(new Response(JSON.stringify(e)));
    await expect(f.provider.generate(request(), new AbortController().signal)).rejects.toMatchObject({ message: 'provider_refusal', code: 'provider_refusal', retryable: false });
  });

  it.each([[400, false], [401, false], [403, false], [408, false], [409, false], [429, true], [500, false], [503, false]])('classifies HTTP %s retryability without retrying transport', async (status, retryable) => {
    const f = fixture();
    f.transport.mockResolvedValue(new Response('secret-error-body', { status: status as number }));
    await expect(f.provider.generate(request(), new AbortController().signal)).rejects.toMatchObject({
      code: status === 429 ? 'provider_rate_limited' : status === 408 || (status as number) >= 500 ? 'provider_outcome_unknown' : `provider_http_${status}`, retryable,
    });
    expect(f.transport).toHaveBeenCalledTimes(1);
  });

  it('scrubs transport exceptions', async () => {
    const f = fixture();
    f.transport.mockRejectedValue(new Error('Authorization: private-key, private-manuscript'));
    await expect(f.provider.generate(request(), new AbortController().signal)).rejects.toMatchObject({ message: 'provider_outcome_unknown', retryable: false });
  });

  it.each(['not-json', JSON.stringify({ ...envelope(), output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{bad' }] }] })])('rejects malformed JSON %#', async (body) => {
    const f = fixture();
    f.transport.mockResolvedValue(new Response(body));
    await expect(f.provider.generate(request(), new AbortController().signal)).rejects.toMatchObject({ retryable: false });
  });

  it('bounds chunked bytes without trusting content-length and cancels the reader', async () => {
    const f = fixture({ maxResponseBytes: 1_024 });
    const cancel = jest.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1_025)); }, cancel });
    f.transport.mockResolvedValue(new Response(stream));
    await expect(f.provider.generate(request(), new AbortController().signal)).rejects.toMatchObject({ code: 'provider_response_too_large', retryable: false });
    expect(cancel).toHaveBeenCalled();
  });

  it('bounds structured output independently of the envelope', async () => {
    const f = fixture();
    f.transport.mockResolvedValue(new Response(JSON.stringify(envelope({ ...output(), title: { en: 'x'.repeat(100_001) } }))));
    await expect(f.provider.generate(request(), new AbortController().signal)).rejects.toMatchObject({ code: 'provider_output_size_invalid' });
  });

  it('pre-cancellation makes zero transport calls', async () => {
    const f = fixture();
    const controller = new AbortController(); controller.abort();
    await expect(f.provider.generate(request(), controller.signal)).rejects.toMatchObject({ code: 'provider_cancelled', retryable: true });
    expect(f.transport).not.toHaveBeenCalled();
  });

  it.each(['timeout', 'cancel'])('aborts a stuck transport on %s even when it ignores signal', async (mode) => {
    jest.useFakeTimers();
    try {
      const f = fixture();
      f.transport.mockImplementation(() => new Promise(() => undefined));
      const controller = new AbortController();
      const pending = f.provider.generate(request(), controller.signal);
      const assertion = expect(pending).rejects.toMatchObject({ code: 'provider_outcome_unknown', retryable: false });
      await Promise.resolve();
      if (mode === 'cancel') controller.abort(); else await jest.advanceTimersByTimeAsync(100);
      await assertion;
      expect((f.transport.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
  });
});

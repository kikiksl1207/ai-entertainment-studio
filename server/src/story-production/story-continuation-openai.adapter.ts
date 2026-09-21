import { validateStoryContinuationProviderResult } from './story-continuation-output.policy';
import { StoryContinuationProvider, StoryContinuationProviderError, type StoryContinuationProviderRequest, type StoryContinuationProviderResult } from './story-continuation.provider';
import { storyContinuationConfigFailure, type StoryContinuationOpenAiConfig } from './story-continuation-openai.config';
import { buildStoryContinuationOpenAiRequest, preflightStoryContinuationOpenAiRequest } from './story-continuation-openai.prompt';

export type StoryContinuationFetch = (url: string, init: RequestInit) => Promise<Response>;
const RESPONSES_URL = 'https://api.openai.com/v1/responses';

export class OpenAiStoryContinuationProvider extends StoryContinuationProvider {
  private readonly config: Readonly<StoryContinuationOpenAiConfig>;

  constructor(config: StoryContinuationOpenAiConfig, private readonly transport: StoryContinuationFetch = (url, init) => fetch(url, init)) {
    super();
    this.config = Object.freeze({ ...config });
  }

  async readiness() {
    const reason = storyContinuationConfigFailure(this.config);
    return reason ? { enabled: false, reason } : { enabled: true };
  }

  preflight = async (request: StoryContinuationProviderRequest) =>
    preflightStoryContinuationOpenAiRequest(request, this.config);

  async generate(request: StoryContinuationProviderRequest, signal: AbortSignal): Promise<StoryContinuationProviderResult> {
    const readiness = await this.readiness();
    if (!readiness.enabled) fail(readiness.reason ?? 'provider_not_ready');
    if (signal.aborted) fail('provider_cancelled', true);
    let body: ReturnType<typeof buildStoryContinuationOpenAiRequest>;
    try { body = buildStoryContinuationOpenAiRequest(request, this.config); }
    catch (error) {
      if (error instanceof StoryContinuationProviderError) throw error;
      fail('provider_context_invalid');
    }
    const controller = new AbortController();
    let abortError: StoryContinuationProviderError | undefined;
    let rejectAbort!: (reason: Error) => void;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const abort = () => {
      if (abortError) return;
      abortError = new StoryContinuationProviderError('provider_outcome_unknown', false);
      rejectAbort(abortError);
      controller.abort();
    };
    const onCancel = () => abort();
    signal.addEventListener('abort', onCancel, { once: true });
    const timer = setTimeout(abort, this.config.timeoutMs);
    try {
      const result = await Promise.race([
        this.send(body!, request, controller.signal),
        aborted,
      ]);
      if (abortError) throw abortError;
      return result;
    } catch (error) {
      if (abortError) throw abortError;
      if (error instanceof StoryContinuationProviderError) throw error;
      // Never propagate transport messages, response bodies, request headers or causes.
      fail('provider_outcome_unknown');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onCancel);
      controller.abort();
    }
  }

  private async send(body: unknown, request: StoryContinuationProviderRequest, signal: AbortSignal) {
    const response = await this.transport(RESPONSES_URL, {
      method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      // Error content is not needed for classification and may contain private input.
      void response.body?.cancel().catch(() => undefined);
      const status = response.status;
      if (status === 408 || (status >= 500 && status <= 599)) fail('provider_outcome_unknown');
      fail(status === 429 ? 'provider_rate_limited' : `provider_http_${status}`,
        status === 429);
    }
    const raw = await readBoundedResponse(response, this.config.maxResponseBytes, signal);
    let envelope: Record<string, unknown>;
    try { envelope = record(JSON.parse(raw)); } catch { fail('provider_malformed_response'); }
    if (envelope!.model !== this.config.model) fail('provider_response_model_mismatch');
    if (!Array.isArray(envelope!.output)) fail('provider_malformed_response');
    const texts: string[] = [];
    for (const item of envelope!.output as unknown[]) {
      const output = record(item);
      if (output.type === 'reasoning') continue;
      if (output.type !== 'message' || output.role !== 'assistant' || !Array.isArray(output.content)) fail('provider_malformed_response');
      for (const part of output.content as unknown[]) {
        const content = record(part);
        if (content.type === 'refusal') fail('provider_refusal');
        if (content.type !== 'output_text' || typeof content.text !== 'string') fail('provider_malformed_response');
        texts.push(content.text as string);
      }
      if (output.status !== 'completed') fail('provider_incomplete_output');
    }
    if (envelope!.status !== 'completed') fail('provider_incomplete_output');
    if (texts.length !== 1 || Buffer.byteLength(texts[0], 'utf8') > 100_000) fail('provider_output_size_invalid');
    let value: Record<string, unknown>;
    try { value = record(JSON.parse(texts[0])); } catch { fail('provider_malformed_output'); }
    exactKeys(value!, ['title', 'beats', 'nextChoices', 'ending']);
    if (!Array.isArray(value!.beats) || !Array.isArray(value!.nextChoices)) fail('provider_malformed_output');
    for (const beat of value!.beats as unknown[]) exactKeys(record(beat), ['beatType', 'content']);
    for (const choice of value!.nextChoices as unknown[]) exactKeys(record(choice), ['choiceKey', 'label']);
    if (value!.ending !== null) {
      const ending = record(value!.ending);
      exactKeys(ending, ['endingKey']);
      if (typeof ending.endingKey !== 'string' || !/^ai-[a-z0-9][a-z0-9_-]{0,116}$/i.test(ending.endingKey)) fail('provider_malformed_output');
    }
    const usage = parseUsage(envelope!.usage);
    const sceneKey = `ai-${request.operationId}`;
    const visual = { publicAssetPath: this.config.visualAssetPath, altKey: 'story.visual.fallback' };
    try {
      return validateStoryContinuationProviderResult({
        title: value!.title, beats: value!.beats, nextChoices: value!.nextChoices,
        ...(value!.ending === null ? {} : { ending: value!.ending }),
        visualManifest: { sceneKey, background: { ...visual, state: 'fallback' }, characters: [], fallback: visual },
        usage,
      } as StoryContinuationProviderResult, {
        locale: request.locale, sceneKey,
        inputTokenLimit: request.inputTokenLimit, outputTokenLimit: request.outputTokenLimit,
      });
    } catch { fail('provider_output_invalid'); }
  }
}

async function readBoundedResponse(response: Response, limit: number, signal: AbortSignal): Promise<string> {
  if (!response.body) fail('provider_malformed_response');
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (Number(response.headers.get('content-length')) > limit) fail('provider_response_too_large');
    while (true) {
      if (signal.aborted) fail('provider_cancelled', true);
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) fail('provider_response_too_large');
      chunks.push(value);
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
    catch { fail('provider_malformed_response'); }
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
  }
}

function parseUsage(value: unknown): StoryContinuationProviderResult['usage'] {
  const usage = record(value);
  const inputTokens = count(usage.input_tokens);
  const outputTokens = count(usage.output_tokens);
  const cachedInputTokens = count(record(usage.input_tokens_details).cached_tokens);
  const reasoningTokens = count(record(usage.output_tokens_details).reasoning_tokens);
  if (cachedInputTokens > inputTokens || reasoningTokens > outputTokens ||
      count(usage.total_tokens) !== inputTokens + outputTokens) fail('provider_usage_invalid');
  // cached input is a subset of input; reasoning is ALREADY included in output_tokens.
  return { inputTokens, outputTokens, cachedInputTokens, imageUnits: 0 };
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail('provider_usage_invalid');
  return value as number;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('provider_malformed_response');
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) fail('provider_malformed_output');
}

function fail(code: string, retryable = false): never { throw new StoryContinuationProviderError(code, retryable); }

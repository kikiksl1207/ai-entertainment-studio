import { createHash } from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';
import { STORY_CONTINUATION_TOKEN_BUDGET_METHOD, storyContinuationInputTokenBudget } from './story-continuation-tokenizer';
import { StoryContinuationProviderError } from './story-continuation.provider';
import type { OfflineTokenBudgetReason, OfflineTokenBudgetWireInput } from './story-continuation-tokenizer.offline';

const PROTOCOL = 'story-offline-token-budget-v1';
const BYTE_LIMIT = 256_000;
const allowedCodes = new Set(['provider_model_encoding_unknown', 'provider_input_bound_exceeded']);

function calculate(): void {
  if (!parentPort) throw new Error('OFFLINE_WORKER_PARENT_REQUIRED');
  const port = parentPort, input: unknown = workerData;
  if (!input || typeof input !== 'object' || Array.isArray(input)) { port.close(); return; }
  const data = input as OfflineTokenBudgetWireInput;
  if (Object.keys(data).sort().join(',') !== 'attempt,bytes,digest,model,protocol,requestJson' ||
    data.protocol !== PROTOCOL || typeof data.attempt !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(data.attempt) || typeof data.digest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(data.digest) || !Number.isSafeInteger(data.bytes) ||
    data.bytes < 1 || data.bytes > BYTE_LIMIT || typeof data.model !== 'string' ||
    typeof data.requestJson !== 'string' || data.requestJson.length > BYTE_LIMIT ||
    Buffer.byteLength(data.requestJson, 'utf8') !== data.bytes ||
    createHash('sha256').update(data.requestJson).digest('hex') !== data.digest) { port.close(); return; }
  const binding = { protocol: PROTOCOL, attempt: data.attempt, digest: data.digest,
    bytes: data.bytes, model: data.model };
  const fail = (code: OfflineTokenBudgetReason) => port.postMessage({ ...binding,
    kind: 'error', code, retryable: false });
  try {
    let body: unknown;
    try { body = JSON.parse(data.requestJson); }
    catch { fail('offline_invalid_transport'); return; }
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      JSON.stringify(body) !== data.requestJson) { fail('offline_invalid_transport'); return; }
    const request = body as Record<string, unknown>;
    if (typeof request.model !== 'string' || request.model !== data.model) {
      fail('offline_model_pin_mismatch'); return;
    }
    if (request.max_output_tokens !== 8192) { fail('offline_request_policy_mismatch'); return; }
    const budget = storyContinuationInputTokenBudget(request as { model: string });
    if (!Number.isSafeInteger(budget) || budget < 256) { fail('offline_worker_failed'); return; }
    port.postMessage({ ...binding, kind: 'ok', method: STORY_CONTINUATION_TOKEN_BUDGET_METHOD, budget });
  } catch (error) {
    fail(error instanceof StoryContinuationProviderError && !error.retryable && allowedCodes.has(error.code)
      ? error.code as OfflineTokenBudgetReason : 'offline_worker_failed');
  } finally { port.close(); }
}

calculate();

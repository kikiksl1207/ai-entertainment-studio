import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';

export const OFFLINE_TOKEN_BUDGET_PROTOCOL = 'story-offline-token-budget-v1';
export const OFFLINE_TOKEN_BUDGET_METHOD = 'js_tiktoken_o200k_base_v1';
const BYTE_LIMIT = 256_000;
const TIMER_LIMIT = 2_147_483_647;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
const nativeAddListener = EventTarget.prototype.addEventListener;
const nativeRemoveListener = EventTarget.prototype.removeEventListener;

function isAborted(signal: AbortSignal): boolean {
  if (!nativeAborted) throw new Error('OFFLINE_NATIVE_SIGNAL_REQUIRED');
  const value: unknown = Reflect.apply(nativeAborted, signal, []);
  if (typeof value !== 'boolean') throw new Error('OFFLINE_NATIVE_SIGNAL_REQUIRED');
  return value;
}

export type OfflineTokenBudgetControls = {
  deadlineMs: number;
  joinGraceMs: number;
  workerHeapMiB: number;
  signal?: AbortSignal;
};

export type OfflineTokenBudgetReason =
  | 'offline_invalid_controls' | 'offline_invalid_transport' | 'offline_host_heap_override'
  | 'offline_busy' | 'offline_aborted' | 'offline_deadline' | 'offline_worker_failed'
  | 'offline_worker_memory_limit' | 'offline_protocol_invalid' | 'offline_worker_output'
  | 'offline_model_pin_mismatch' | 'offline_request_policy_mismatch'
  | 'provider_model_encoding_unknown' | 'provider_input_bound_exceeded';

export type OfflineTokenBudgetResult = {
  status: 'measured' | 'unmeasured';
  reason: OfflineTokenBudgetReason | null;
  inputTokenUpperBound: number | null;
  inputFits: boolean | null;
  inputTokenLimit: 32768;
  outputTokenLimit: 8192;
  outputFits: null;
  budgetMethod: typeof OFFLINE_TOKEN_BUDGET_METHOD;
  workerStarted: boolean;
  workerClosed: boolean;
  cleanupConfirmed: boolean;
  retryable: false;
  dispatchAllowed: false;
};

export type OfflineTokenBudgetWireInput = {
  protocol: typeof OFFLINE_TOKEN_BUDGET_PROTOCOL;
  attempt: string;
  digest: string;
  bytes: number;
  model: string;
  requestJson: string;
};

type Job = {
  worker?: Worker;
  done: Promise<void>;
  finish: () => void;
};

const reasons = new Set<OfflineTokenBudgetReason>([
  'offline_invalid_transport', 'offline_worker_failed', 'offline_model_pin_mismatch',
  'offline_request_policy_mismatch', 'provider_model_encoding_unknown', 'provider_input_bound_exceeded',
]);

function result(reason: OfflineTokenBudgetReason | null, started: boolean, closed: boolean,
  budget: number | null = null, cleanupConfirmed = true): OfflineTokenBudgetResult {
  const value: OfflineTokenBudgetResult = { status: budget === null ? 'unmeasured' : 'measured', reason,
    inputTokenUpperBound: budget, inputFits: budget === null ? null : budget <= 32768,
    inputTokenLimit: 32768, outputTokenLimit: 8192, outputFits: null,
    budgetMethod: OFFLINE_TOKEN_BUDGET_METHOD, workerStarted: started, workerClosed: closed, cleanupConfirmed,
    retryable: false, dispatchAllowed: false };
  return Object.freeze(value);
}

function readControls(value: OfflineTokenBudgetControls): OfflineTokenBudgetControls | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' ||
    !['deadlineMs','joinGraceMs','workerHeapMiB','signal'].includes(key))) return undefined;
  if (Object.values(descriptors).some(descriptor => !('value' in descriptor) || !descriptor.enumerable)) return undefined;
  const integer = (number: unknown, minimum: number, maximum: number) =>
    typeof number === 'number' && Number.isSafeInteger(number) && number >= minimum && number <= maximum;
  if (!integer(descriptors.deadlineMs?.value, 1, TIMER_LIMIT) ||
    !integer(descriptors.joinGraceMs?.value, 1, TIMER_LIMIT) ||
    !integer(descriptors.workerHeapMiB?.value, 16, 1024)) return undefined;
  const signal: unknown = descriptors.signal?.value;
  if (signal !== undefined && (!(signal instanceof AbortSignal) || typeof isAborted(signal) !== 'boolean')) return undefined;
  return { deadlineMs: descriptors.deadlineMs.value as number, joinGraceMs: descriptors.joinGraceMs.value as number,
    workerHeapMiB: descriptors.workerHeapMiB.value as number, signal: signal as AbortSignal | undefined };
}

/** Offline diagnostic only. An unconfirmed exit keeps this instance busy and drainable. */
export class OfflineStoryTokenBudget {
  private active?: Job;

  get busy(): boolean { return this.active !== undefined; }
  drain(): Promise<void> { return this.active?.done ?? Promise.resolve(); }

  calculate(requestJson: string, expectedModel: string,
    controls: OfflineTokenBudgetControls): Promise<OfflineTokenBudgetResult> {
    let captured: OfflineTokenBudgetControls | undefined;
    try {
      captured = readControls(controls);
    } catch { return Promise.resolve(result('offline_invalid_controls', false, true)); }
    if (!captured) return Promise.resolve(result('offline_invalid_controls', false, true));
    if (this.active) return Promise.resolve(result('offline_busy', false, true));
    if (process.env.NODE_OPTIONS !== undefined || process.execArgv.some(argument =>
      /^--max-(old-space-size|semi-space-size)(?:=|$)/.test(argument.replace(/_/g, '-')))) {
      return Promise.resolve(result('offline_host_heap_override', false, true));
    }
    if (typeof requestJson !== 'string' || typeof expectedModel !== 'string' || !expectedModel ||
      expectedModel.length > requestJson.length) return Promise.resolve(result('offline_invalid_transport', false, true));
    if (requestJson.length > BYTE_LIMIT || Buffer.byteLength(requestJson, 'utf8') > BYTE_LIMIT) {
      return Promise.resolve(result('provider_input_bound_exceeded', false, true));
    }
    const { deadlineMs, joinGraceMs, workerHeapMiB, signal } = captured;
    try {
      if (signal && isAborted(signal)) return Promise.resolve(result('offline_aborted', false, true));
    } catch { return Promise.resolve(result('offline_invalid_controls', false, true)); }
    const deadline = performance.now() + deadlineMs;
    const input: OfflineTokenBudgetWireInput = { protocol: OFFLINE_TOKEN_BUDGET_PROTOCOL,
      attempt: randomUUID(), digest: createHash('sha256').update(requestJson).digest('hex'),
      bytes: Buffer.byteLength(requestJson, 'utf8'), model: expectedModel, requestJson };
    let finish!: () => void;
    const job: Job = { done: new Promise<void>(resolve => { finish = resolve; }), finish: () => finish() };
    this.active = job;

    return new Promise<OfflineTokenBudgetResult>(resolve => {
      let outcomeDelivered = false, exited = false, terminateRequested = false, terminationSettled = false;
      let terminationRejected = false, candidateSeen = false;
      let abortAttached = false, listenerCleanupFailed = false;
      let reason: OfflineTokenBudgetReason | null = null, reportedReason: OfflineTokenBudgetReason | null = null;
      let budget: number | null = null;
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
      let joinTimer: ReturnType<typeof setTimeout> | undefined;
      const deliver = (closed: boolean, cleaned = true) => {
        if (outcomeDelivered) return;
        outcomeDelivered = true;
        resolve(result(reason, !!job.worker, closed, reason === null && closed && cleaned ? budget : null, cleaned));
      };
      const clearRequest = () => {
        if (deadlineTimer) clearTimeout(deadlineTimer);
        deadlineTimer = undefined;
        if (signal && abortAttached) {
          try { Reflect.apply(nativeRemoveListener, signal, ['abort', onAbort]); }
          catch {
            listenerCleanupFailed = true;
            if (reason === null) { reason = 'offline_worker_failed'; budget = null; }
          } finally { abortAttached = false; }
        }
      };
      const retire = () => {
        clearRequest(); if (joinTimer) clearTimeout(joinTimer); joinTimer = undefined;
        if (this.active === job) this.active = undefined;
        job.finish();
      };
      const finishAfterExit = () => {
        if (!exited || (terminateRequested && !terminationSettled)) return;
        retire(); deliver(true, !terminationRejected && !listenerCleanupFailed);
      };
      const seal = (next: OfflineTokenBudgetReason) => {
        if (exited || outcomeDelivered || reason !== null) return;
        reason = next; budget = null; clearRequest();
        if (!job.worker) return;
        joinTimer = setTimeout(() => { joinTimer = undefined; deliver(exited, false); }, joinGraceMs);
        if (!terminateRequested) {
          terminateRequested = true;
          try {
            void job.worker.terminate().then(() => { terminationSettled = true; finishAfterExit(); },
              () => { terminationSettled = true; terminationRejected = true; finishAfterExit(); });
          } catch { terminationSettled = true; terminationRejected = true; finishAfterExit(); }
        }
      };
      const onAbort = () => seal('offline_aborted');
      const expired = () => performance.now() >= deadline;
      const onMessage = (value: unknown) => {
        if (reason !== null || exited || outcomeDelivered) return;
        if (expired()) { seal('offline_deadline'); return; }
        if (candidateSeen || !value || typeof value !== 'object' || Array.isArray(value)) {
          seal('offline_protocol_invalid'); return;
        }
        const message = value as Record<string, unknown>;
        const keys = Object.keys(message).sort().join(',');
        if (message.protocol !== input.protocol || message.attempt !== input.attempt ||
          message.digest !== input.digest || message.bytes !== input.bytes || message.model !== input.model) {
          seal('offline_protocol_invalid'); return;
        }
        if (message.kind === 'ok' && keys === 'attempt,budget,bytes,digest,kind,method,model,protocol' &&
          message.method === OFFLINE_TOKEN_BUDGET_METHOD && typeof message.budget === 'number' &&
          Number.isSafeInteger(message.budget) && message.budget >= 256) {
          candidateSeen = true; budget = message.budget;
        } else if (message.kind === 'error' && keys === 'attempt,bytes,code,digest,kind,model,protocol,retryable' &&
          message.retryable === false && reasons.has(message.code as OfflineTokenBudgetReason)) {
          candidateSeen = true; reportedReason = message.code as OfflineTokenBudgetReason;
          // A posted error also needs normal exit; keep the original operation deadline.
        } else seal('offline_protocol_invalid');
      };
      const onError = (error: Error & { code?: string }) => {
        if (reason === null) seal(error.code === 'ERR_WORKER_OUT_OF_MEMORY'
          ? 'offline_worker_memory_limit' : 'offline_worker_failed');
      };
      const onOutput = () => seal('offline_worker_output');
      const onExit = (code: number) => {
        if (exited) return;
        exited = true;
        if (!outcomeDelivered) {
          if (reason === null && expired()) reason = 'offline_deadline';
          if (reason === null && (code !== 0 || !candidateSeen)) reason = 'offline_worker_failed';
          if (reason === null && reportedReason !== null) reason = reportedReason;
          if (reason === null && budget === null) reason = 'offline_worker_failed';
          if (reason !== null) budget = null;
        }
        clearRequest();
        const worker = job.worker;
        if (worker) {
          worker.off('message', onMessage); worker.off('messageerror', onMessageError);
          worker.off('error', onError); worker.off('exit', onExit);
          for (const stream of [worker.stdout, worker.stderr]) {
            stream.off('data', onOutput);
            stream.destroy();
          }
        }
        finishAfterExit();
      };
      const onMessageError = () => seal('offline_protocol_invalid');
      try {
        job.worker = new Worker(join(__dirname, 'story-continuation-tokenizer.offline-worker.js'), {
          workerData: input, env: {}, execArgv: [], argv: [], stdout: true, stderr: true,
          resourceLimits: { maxOldGenerationSizeMb: workerHeapMiB }, trackUnmanagedFds: true,
        });
        const worker = job.worker;
        worker.on('message', onMessage); worker.on('messageerror', onMessageError);
        worker.on('error', onError); worker.once('exit', onExit);
        for (const stream of [worker.stdout, worker.stderr]) {
          stream.on('data', onOutput); stream.on('error', onOutput);
        }
        if (signal) {
          abortAttached = true;
          Reflect.apply(nativeAddListener, signal, ['abort', onAbort, { once: true }]);
        }
        deadlineTimer = setTimeout(() => seal('offline_deadline'), Math.max(1, Math.ceil(deadline - performance.now())));
        if (worker.resourceLimits?.maxOldGenerationSizeMb !== workerHeapMiB) seal('offline_invalid_controls');
        else if (signal && isAborted(signal)) onAbort();
        else if (expired()) seal('offline_deadline');
      } catch {
        if (job.worker) seal('offline_worker_failed');
        else { reason = 'offline_worker_failed'; retire(); deliver(true); }
      }
    });
  }
}

import { Injectable } from '@nestjs/common';
import { ModerationService } from '../moderation/moderation.service';
import { StoryEconomicsService } from './story-economics.service';
import {
  StoryContinuationProvider,
  StoryContinuationProviderError,
} from './story-continuation.provider';
import {
  StoryContinuationQueueRepository,
} from './story-continuation.repository';
import { StoryContinuationContextAssembler } from './story-continuation-context.assembler';
import { StoryContinuationContextError } from './story-continuation-context.assembler';
import { validateStoryContinuationProviderResult } from './story-continuation-output.policy';

const PROVIDER_TIMEOUT_MS = 30_000;
const LEASE_MS = 60_000;

@Injectable()
export class StoryContinuationExecutor {
  constructor(
    private readonly queue: StoryContinuationQueueRepository,
    private readonly provider: StoryContinuationProvider,
    private readonly economics: StoryEconomicsService,
    private readonly contextAssembler: StoryContinuationContextAssembler,
    private readonly moderation: ModerationService,
  ) {}

  async executeOne(workerId: string, signal?: AbortSignal) {
    if (signal?.aborted) return { status: 'cancelled' as const };
    const expired = await this.queue.claimExpiredTerminal(workerId, LEASE_MS);
    if (expired) {
      await this.economics.failClaimedContinuation(expired, 'provider_timeout', 'timeout');
      return { status: 'recovered_timeout' as const, continuationId: expired.continuationId };
    }
    const readiness = await this.provider.readiness();
    if (signal?.aborted) return { status: 'cancelled' as const };
    if (!readiness.enabled) {
      return { status: 'disabled' as const, reason: readiness.reason ?? 'provider_not_ready' };
    }
    const claim = await this.queue.claimNext(workerId, LEASE_MS);
    if (!claim) return { status: 'idle' as const };
    let providerStarted = false;
    try {
      throwIfCancelled(signal);
      const authorization = await this.economics.continuationExecutionAuthorization(claim);
      if (!authorization.allowed) {
        await this.economics.failClaimedContinuation(
          claim,
          authorization.code,
          'failed',
        );
        return { status: 'failed' as const, continuationId: claim.continuationId };
      }
      const approvedContext = await this.contextAssembler.assemble(claim);
      throwIfCancelled(signal);
      providerStarted = true;
      const providerResult = await runWithAbortTimeout(
        (signal) => this.provider.generate(
          { ...claim.request, approvedContext },
          signal,
        ),
        PROVIDER_TIMEOUT_MS,
        signal,
      );
      if (signal?.aborted) throw new StoryContinuationProviderError('provider_outcome_unknown', false);
      const result = validateStoryContinuationProviderResult(providerResult, {
        locale: claim.request.locale,
        sceneKey: `ai-${claim.continuationId}`,
        inputTokenLimit: claim.request.inputTokenLimit,
        outputTokenLimit: claim.request.outputTokenLimit,
      });
      const moderation = this.moderation.preview({
        surface: 'story_ai_continuation',
        body: [
          ...Object.values(result.title),
          ...result.beats.flatMap((beat) => Object.values(beat.content)),
          ...(result.nextChoices ?? []).flatMap((choice) => Object.values(choice.label)),
        ].join('\n'),
      });
      if (moderation.decision !== 'allow') {
        throw new StoryContinuationProviderError('server_moderation_rejected', false);
      }
      await this.economics.settleClaimedContinuation(claim, result);
      return { status: 'completed' as const, continuationId: claim.continuationId };
    } catch (error) {
      let providerError = normalizeProviderError(error);
      // A settlement/database error after generation must not replay a potentially paid call.
      if (providerStarted && providerError.retryable &&
          !['provider_rate_limited', 'provider_cancelled'].includes(providerError.code)) {
        providerError = new StoryContinuationProviderError('provider_outcome_unknown', false);
      }
      if (providerError.retryable && claim.attemptCount < claim.maxAttempts) {
        const retryAt = new Date(Date.now() + Math.min(60_000, 1_000 * 2 ** claim.attemptCount));
        await this.queue.releaseForRetry(claim, providerError.code, retryAt);
        return { status: 'retry_wait' as const, continuationId: claim.continuationId };
      }
      await this.economics.failClaimedContinuation(
        claim,
        providerError.code,
        providerError.code === 'provider_timeout' ? 'timeout' : 'failed',
      );
      return { status: 'failed' as const, continuationId: claim.continuationId };
    }
  }
}

export async function runWithAbortTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<T> {
  throwIfCancelled(parentSignal);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const interrupted = new Promise<T>((_, reject) => {
        onAbort = () => {
          reject(new StoryContinuationProviderError('provider_outcome_unknown', false));
          controller.abort();
        };
        parentSignal?.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => {
          reject(new StoryContinuationProviderError('provider_outcome_unknown', false));
          controller.abort();
        }, timeoutMs);
    });
    return await Promise.race([operation(controller.signal), interrupted]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) parentSignal?.removeEventListener('abort', onAbort);
  }
}

function throwIfCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new StoryContinuationProviderError('provider_cancelled', true);
}

function normalizeProviderError(error: unknown) {
  if (error instanceof StoryContinuationContextError) {
    return new StoryContinuationProviderError(error.code, false);
  }
  if (error instanceof StoryContinuationProviderError) {
    return error;
  }
  const code = error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : '';
  const transientDatabaseCodes = new Set([
    'P1001', 'P1002', 'P1008', 'P1017', 'P2024', '40001', '40P01',
  ]);
  return new StoryContinuationProviderError(
    transientDatabaseCodes.has(code) ? 'transient_database_failure' : 'continuation_execution_failed',
    transientDatabaseCodes.has(code),
  );
}

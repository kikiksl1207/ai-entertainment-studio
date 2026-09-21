import { runWithAbortTimeout, StoryContinuationExecutor } from './story-continuation.executor';

function fixture() {
  const claim = { continuationId: 'test', leaseToken: 'lease', attemptCount: 1, maxAttempts: 3,
    request: { operationId: 'test', locale: 'en', inputTokenLimit: 100, outputTokenLimit: 100 } };
  const queue = { claimExpiredTerminal: jest.fn().mockResolvedValue(null), claimNext: jest.fn().mockResolvedValue(claim), releaseForRetry: jest.fn() };
  const provider = { readiness: jest.fn().mockResolvedValue({ enabled: true }), generate: jest.fn() };
  const economics = { continuationExecutionAuthorization: jest.fn().mockResolvedValue({ allowed: true }), failClaimedContinuation: jest.fn(), settleClaimedContinuation: jest.fn() };
  const assembler = { assemble: jest.fn().mockResolvedValue({}) };
  const executor = new StoryContinuationExecutor(queue as never, provider as never, economics as never, assembler as never, {} as never);
  return { executor, queue, provider, economics, assembler, claim };
}

describe('worker cancellation through executor', () => {
  it('does not claim or recover anything after pre-cancellation', async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort();
    await expect(f.executor.executeOne('worker', controller.signal)).resolves.toEqual({ status: 'cancelled' });
    expect(f.queue.claimExpiredTerminal).not.toHaveBeenCalled();
    expect(f.queue.claimNext).not.toHaveBeenCalled();
  });

  it('propagates parent cancellation to a stuck operation and cleans timers', async () => {
    jest.useFakeTimers();
    try {
      const controller = new AbortController();
      let observed!: AbortSignal;
      const pending = runWithAbortTimeout((signal) => { observed = signal; return new Promise(() => undefined); }, 30_000, controller.signal);
      const assertion = expect(pending).rejects.toMatchObject({ code: 'provider_outcome_unknown', retryable: false });
      controller.abort(); await assertion;
      expect(observed.aborted).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
  });

  it('cancels after claim without calling provider and releases via existing retry policy', async () => {
    const f = fixture(); const controller = new AbortController();
    f.queue.claimNext.mockImplementation(async () => { controller.abort(); return f.claim; });
    await expect(f.executor.executeOne('worker', controller.signal)).resolves.toMatchObject({ status: 'retry_wait' });
    expect(f.provider.generate).not.toHaveBeenCalled();
    expect(f.queue.releaseForRetry).toHaveBeenCalledWith(f.claim, 'provider_cancelled', expect.any(Date));
    expect(f.economics.settleClaimedContinuation).not.toHaveBeenCalled();
  });

  it('does not settle output that races with shutdown', async () => {
    const f = fixture(); const controller = new AbortController();
    f.provider.generate.mockImplementation(async () => { controller.abort(); return {}; });
    await expect(f.executor.executeOne('worker', controller.signal)).resolves.toMatchObject({ status: 'failed' });
    expect(f.economics.settleClaimedContinuation).not.toHaveBeenCalled();
    expect(f.queue.releaseForRetry).not.toHaveBeenCalled();
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(f.claim, 'provider_outcome_unknown', 'failed');
  });
});

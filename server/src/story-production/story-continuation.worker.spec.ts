import { readStoryContinuationWorkerConfig, StoryContinuationWorker, type StoryContinuationWorkerConfig } from './story-continuation.worker';

const config: StoryContinuationWorkerConfig = { enabled: true, pollMs: 100, maxBackoffMs: 800, drainMs: 500 };
function fixture(options: Partial<StoryContinuationWorkerConfig> = {}) {
  const executor = { executeOne: jest.fn().mockResolvedValue({ status: 'idle' }) };
  const provider = { readiness: jest.fn().mockResolvedValue({ enabled: true }) };
  const worker = new StoryContinuationWorker(executor, provider, { ...config, ...options });
  return { worker, executor, provider };
}
async function flush() { for (let i = 0; i < 6; i++) await Promise.resolve(); }

describe('StoryContinuationWorker serial lifecycle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('defaults OFF and never probes provider or queue', async () => {
    const c = readStoryContinuationWorkerConfig({ get: () => undefined });
    const f = fixture(c);
    f.worker.onApplicationBootstrap(); await flush();
    expect(f.worker.readiness()).toMatchObject({ enabled: false, ready: false, reason: 'worker_disabled' });
    expect(f.provider.readiness).not.toHaveBeenCalled();
    expect(f.executor.executeOne).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    await f.worker.beforeApplicationShutdown();
  });

  it.each([{ pollMs: 0 }, { maxBackoffMs: 99 }, { drainMs: NaN }])('fails closed on invalid timing config %#', async (options) => {
    const f = fixture(options);
    f.worker.onApplicationBootstrap();
    expect(f.worker.readiness().reason).toBe('worker_configuration_invalid');
    expect(f.executor.executeOne).not.toHaveBeenCalled();
    await f.worker.beforeApplicationShutdown();
  });

  it('gates every claim on readiness and recovers with bounded backoff', async () => {
    const f = fixture();
    f.provider.readiness.mockResolvedValue({ enabled: false });
    f.worker.onApplicationBootstrap(); await flush();
    expect(f.worker.readiness()).toMatchObject({ ready: false, reason: 'provider_not_ready' });
    await jest.advanceTimersByTimeAsync(199);
    expect(f.provider.readiness).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(f.provider.readiness).toHaveBeenCalledTimes(2);
    expect(f.executor.executeOne).not.toHaveBeenCalled();
    f.provider.readiness.mockResolvedValue({ enabled: true });
    await jest.advanceTimersByTimeAsync(400);
    expect(f.executor.executeOne).toHaveBeenCalledTimes(1);
    expect(f.worker.readiness().ready).toBe(true);
    await f.worker.beforeApplicationShutdown();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('never overlaps jobs or starts duplicate loops and always waits between successful ticks', async () => {
    const f = fixture();
    let finish!: (value: { status: string }) => void;
    f.executor.executeOne.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    f.worker.onApplicationBootstrap(); f.worker.onApplicationBootstrap(); await flush();
    expect(f.worker.readiness().active).toBe(true);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(f.executor.executeOne).toHaveBeenCalledTimes(1);
    finish({ status: 'completed' }); await flush();
    await jest.advanceTimersByTimeAsync(99);
    expect(f.executor.executeOne).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(f.executor.executeOne).toHaveBeenCalledTimes(2);
    await f.worker.beforeApplicationShutdown();
  });

  it('cancels and drains the active job before resolving shutdown; cannot restart', async () => {
    const f = fixture();
    let finish!: (value: { status: string }) => void;
    f.executor.executeOne.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    f.worker.onApplicationBootstrap(); await flush();
    const signal = f.executor.executeOne.mock.calls[0][1] as AbortSignal;
    let drained = false;
    const shutdown = f.worker.beforeApplicationShutdown().then(() => { drained = true; });
    await flush();
    expect(signal.aborted).toBe(true);
    expect(drained).toBe(false);
    finish({ status: 'retry_wait' }); await shutdown;
    f.worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(f.executor.executeOne).toHaveBeenCalledTimes(1);
    expect(f.worker.readiness()).toMatchObject({ active: false, stopping: true, ready: false, reason: 'worker_stopped' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reports bounded drain timeout without starting another job', async () => {
    const f = fixture();
    let finish!: (value: { status: string }) => void;
    f.executor.executeOne.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    f.worker.onApplicationBootstrap(); await flush();
    const assertion = expect(f.worker.beforeApplicationShutdown()).rejects.toThrow('story_worker_drain_timeout');
    await jest.advanceTimersByTimeAsync(500); await assertion;
    expect(f.worker.readiness()).toMatchObject({ stopping: true, ready: false });
    finish({ status: 'completed' }); await flush();
    expect(f.executor.executeOne).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('handles tick exceptions with capped backoff and no payload in health', async () => {
    const f = fixture();
    f.executor.executeOne.mockRejectedValue(new Error('secret-payload'));
    f.worker.onApplicationBootstrap(); await flush();
    await jest.advanceTimersByTimeAsync(200 + 400 + 800 + 800);
    expect(f.executor.executeOne).toHaveBeenCalledTimes(5);
    expect(f.worker.readiness().reason).toBe('worker_tick_failed');
    expect(JSON.stringify(f.worker.readiness())).not.toContain('secret');
    await f.worker.beforeApplicationShutdown();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(f.executor.executeOne).toHaveBeenCalledTimes(5);
  });

  it('shutdown while readiness is pending prevents claiming', async () => {
    const f = fixture();
    let ready!: (value: { enabled: boolean }) => void;
    f.provider.readiness.mockImplementationOnce(() => new Promise((resolve) => { ready = resolve; }));
    f.worker.onApplicationBootstrap();
    const shutdown = f.worker.beforeApplicationShutdown();
    ready({ enabled: true }); await shutdown;
    expect(f.executor.executeOne).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});

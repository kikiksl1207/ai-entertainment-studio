import { StoryVisualGenerationWorker } from './story-visual-generation.worker';

function config(values: Record<string, string> = {}) {
  return { get: jest.fn((key: string) => values[key]) } as never;
}

async function flush() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

describe('StoryVisualGenerationWorker', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('defaults off and cannot generate an image or incur provider cost', async () => {
    const executor = { executeOne: jest.fn() };
    const worker = new StoryVisualGenerationWorker(executor, config());
    worker.onApplicationBootstrap();
    await flush();
    expect(worker.readiness()).toMatchObject({ enabled: false, ready: false, reason: 'worker_disabled' });
    expect(executor.executeOne).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    await worker.beforeApplicationShutdown();
  });

  it('processes strictly one item at a time and drains on shutdown', async () => {
    let finish!: (value: { status: 'completed' }) => void;
    const executor = { executeOne: jest.fn().mockImplementationOnce(() =>
      new Promise(resolve => { finish = resolve; })).mockResolvedValue({ status: 'idle' }) };
    const worker = new StoryVisualGenerationWorker(executor, config({
      STORY_IMAGE_QUEUE_WORKER_ENABLED: 'true',
      STORY_IMAGE_QUEUE_WORKER_POLL_MS: '250',
      STORY_IMAGE_QUEUE_WORKER_MAX_BACKOFF_MS: '1000',
      STORY_IMAGE_QUEUE_WORKER_DRAIN_MS: '1000',
    }));
    worker.onApplicationBootstrap();
    await flush();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(executor.executeOne).toHaveBeenCalledTimes(1);
    finish({ status: 'completed' });
    await flush();
    await jest.advanceTimersByTimeAsync(249);
    expect(executor.executeOne).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(executor.executeOne).toHaveBeenCalledTimes(2);
    await worker.beforeApplicationShutdown();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('fails closed when worker timing configuration is invalid', async () => {
    const executor = { executeOne: jest.fn() };
    const worker = new StoryVisualGenerationWorker(executor, config({
      STORY_IMAGE_QUEUE_WORKER_ENABLED: 'true',
      STORY_IMAGE_QUEUE_WORKER_POLL_MS: '0',
    }));
    worker.onApplicationBootstrap();
    expect(worker.readiness()).toMatchObject({ enabled: false, ready: false, reason: 'worker_configuration_invalid' });
    expect(executor.executeOne).not.toHaveBeenCalled();
    await worker.beforeApplicationShutdown();
  });
});

import type { BeforeApplicationShutdown, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { StoryContinuationProvider } from './story-continuation.provider';
import { configInteger, inRange, type StoryContinuationConfigReader } from './story-continuation-openai.config';

export type StoryContinuationWorkerConfig = {
  enabled: boolean;
  pollMs: number;
  maxBackoffMs: number;
  drainMs: number;
};

export function readStoryContinuationWorkerConfig(reader: StoryContinuationConfigReader): StoryContinuationWorkerConfig {
  return {
    enabled: reader.get('STORY_CONTINUATION_WORKER_ENABLED') === 'true',
    pollMs: configInteger(reader, 'STORY_CONTINUATION_WORKER_POLL_MS', 1_000),
    maxBackoffMs: configInteger(reader, 'STORY_CONTINUATION_WORKER_MAX_BACKOFF_MS', 30_000),
    drainMs: configInteger(reader, 'STORY_CONTINUATION_WORKER_DRAIN_MS', 35_000),
  };
}

export interface StoryContinuationWorkerExecutor {
  executeOne(workerId: string, signal?: AbortSignal): Promise<{ status: string }>;
}

export class StoryContinuationWorker implements OnApplicationBootstrap, OnModuleDestroy, BeforeApplicationShutdown {
  private readonly config: Readonly<StoryContinuationWorkerConfig>;
  private readonly workerId = `story-worker:${randomUUID()}`;
  private readonly controller = new AbortController();
  private loop?: Promise<void>;
  private wake?: () => void;
  private stopping = false;
  private active = false;
  private shutdown?: Promise<void>;
  private state = { enabled: false, ready: false, reason: 'worker_not_started' };

  constructor(
    private readonly executor: StoryContinuationWorkerExecutor,
    private readonly provider: Pick<StoryContinuationProvider, 'readiness'>,
    config: StoryContinuationWorkerConfig,
  ) { this.config = Object.freeze({ ...config }); }

  readiness() { return { ...this.state, active: this.active, stopping: this.stopping }; }

  onApplicationBootstrap(): void {
    if (this.loop || this.stopping) return;
    if (!this.config.enabled) {
      this.state = { enabled: false, ready: false, reason: 'worker_disabled' };
      return;
    }
    if (!inRange(this.config.pollMs, 100, 60_000) ||
        !inRange(this.config.maxBackoffMs, this.config.pollMs, 300_000) ||
        !inRange(this.config.drainMs, 100, 120_000)) {
      this.state = { enabled: false, ready: false, reason: 'worker_configuration_invalid' };
      return;
    }
    this.state = { enabled: true, ready: false, reason: 'provider_readiness_pending' };
    this.loop = this.run();
  }

  onModuleDestroy(): Promise<void> {
    return this.shutdown ??= this.stopAndDrain();
  }

  beforeApplicationShutdown(): Promise<void> { return this.onModuleDestroy(); }

  private async stopAndDrain(): Promise<void> {
    this.stopping = true;
    this.state = { enabled: false, ready: false, reason: 'worker_stopping' };
    this.controller.abort();
    this.wake?.();
    if (!this.loop) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.loop,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('story_worker_drain_timeout')), this.config.drainMs);
        }),
      ]);
      this.state = { enabled: false, ready: false, reason: 'worker_stopped' };
    } finally { if (timer) clearTimeout(timer); }
  }

  private async run() {
    let delay = this.config.pollMs;
    while (!this.stopping) {
      try {
        const readiness = await this.provider.readiness();
        if (this.stopping) break;
        if (!readiness.enabled) {
          this.state = { enabled: true, ready: false, reason: 'provider_not_ready' };
          delay = Math.min(this.config.maxBackoffMs, delay * 2);
        } else {
          this.state = { enabled: true, ready: true, reason: 'worker_ready' };
          this.active = true;
          const result = await this.executor.executeOne(this.workerId, this.controller.signal);
          this.active = false;
          if (this.stopping) break;
          const backedOff = ['idle', 'disabled', 'retry_wait', 'failed'].includes(result.status);
          delay = backedOff ? Math.min(this.config.maxBackoffMs, delay * 2) : this.config.pollMs;
          if (result.status === 'disabled') this.state = { enabled: true, ready: false, reason: 'provider_not_ready' };
        }
      } catch {
        // No exception messages or job/provider payloads in health output or logs.
        this.active = false;
        if (this.stopping) break;
        this.state = { enabled: true, ready: false, reason: 'worker_tick_failed' };
        delay = Math.min(this.config.maxBackoffMs, delay * 2);
      }
      if (!this.stopping) await this.wait(delay);
    }
  }

  private wait(ms: number) {
    return new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timer); this.wake = undefined; resolve(); };
      const timer = setTimeout(done, ms);
      this.wake = done;
    });
  }
}

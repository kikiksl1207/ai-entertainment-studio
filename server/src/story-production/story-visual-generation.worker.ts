import type { BeforeApplicationShutdown, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type StoryVisualWorkerResult = {
  status: 'completed' | 'idle' | 'disabled' | 'limit_reached' | 'failed';
};

export interface StoryVisualWorkerExecutor {
  executeOne(signal?: AbortSignal): Promise<StoryVisualWorkerResult>;
}

export class StoryVisualGenerationWorker implements OnApplicationBootstrap, OnModuleDestroy, BeforeApplicationShutdown {
  private readonly enabled: boolean;
  private readonly pollMs: number;
  private readonly maxBackoffMs: number;
  private readonly drainMs: number;
  private invalidConfig = false;
  private readonly controller = new AbortController();
  private loop?: Promise<void>;
  private wake?: () => void;
  private stopping = false;
  private active = false;
  private shutdown?: Promise<void>;
  private state = { enabled: false, ready: false, reason: 'worker_not_started' };

  constructor(private readonly executor: StoryVisualWorkerExecutor, config: ConfigService) {
    this.enabled = config.get<string>('STORY_IMAGE_QUEUE_WORKER_ENABLED') === 'true';
    this.pollMs = this.integer(config, 'STORY_IMAGE_QUEUE_WORKER_POLL_MS', 2_000, 250, 60_000);
    this.maxBackoffMs = this.integer(config, 'STORY_IMAGE_QUEUE_WORKER_MAX_BACKOFF_MS', 60_000, this.pollMs, 300_000);
    this.drainMs = this.integer(config, 'STORY_IMAGE_QUEUE_WORKER_DRAIN_MS', 130_000, 1_000, 180_000);
  }

  readiness() {
    return { ...this.state, active: this.active, stopping: this.stopping };
  }

  onApplicationBootstrap() {
    if (this.loop || this.stopping) return;
    if (!this.enabled) {
      this.state = { enabled: false, ready: false, reason: 'worker_disabled' };
      return;
    }
    if (this.invalidConfig) {
      this.state = { enabled: false, ready: false, reason: 'worker_configuration_invalid' };
      return;
    }
    this.state = { enabled: true, ready: true, reason: 'worker_ready' };
    this.loop = this.run();
  }

  onModuleDestroy() {
    return this.shutdown ??= this.stopAndDrain();
  }

  beforeApplicationShutdown() {
    return this.onModuleDestroy();
  }

  private async run() {
    let delay = this.pollMs;
    while (!this.stopping) {
      try {
        this.active = true;
        const result = await this.executor.executeOne(this.controller.signal);
        this.active = false;
        if (this.stopping) break;
        const backoff = ['idle', 'disabled', 'limit_reached', 'failed'].includes(result.status);
        delay = backoff ? Math.min(this.maxBackoffMs, delay * 2) : this.pollMs;
        this.state = result.status === 'disabled'
          ? { enabled: true, ready: false, reason: 'generation_disabled' }
          : { enabled: true, ready: true, reason: result.status === 'limit_reached' ? 'generation_limit_reached' : 'worker_ready' };
      } catch {
        this.active = false;
        if (this.stopping) break;
        this.state = { enabled: true, ready: false, reason: 'worker_tick_failed' };
        delay = Math.min(this.maxBackoffMs, delay * 2);
      }
      if (!this.stopping) await this.wait(delay);
    }
  }

  private async stopAndDrain() {
    this.stopping = true;
    this.state = { enabled: false, ready: false, reason: 'worker_stopping' };
    this.controller.abort();
    this.wake?.();
    if (!this.loop) {
      this.state = { enabled: false, ready: false, reason: 'worker_stopped' };
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.loop,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('story_visual_worker_drain_timeout')), this.drainMs);
        }),
      ]);
      this.state = { enabled: false, ready: false, reason: 'worker_stopped' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private wait(ms: number) {
    return new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); this.wake = undefined; resolve(); };
      const timer = setTimeout(done, ms);
      this.wake = done;
    });
  }

  private integer(config: ConfigService, key: string, fallback: number, min: number, max: number) {
    const raw = config.get<string>(key);
    if (raw == null || raw === '') return fallback;
    const value = Number(raw);
    if (Number.isInteger(value) && value >= min && value <= max) return value;
    this.invalidConfig = true;
    return fallback;
  }
}

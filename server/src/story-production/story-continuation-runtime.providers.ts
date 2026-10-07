import type { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StoryContinuationProvider } from './story-continuation.provider';
import { StoryContinuationExecutor } from './story-continuation.executor';
import { OpenAiStoryContinuationProvider } from './story-continuation-openai.adapter';
import { readStoryContinuationOpenAiConfig } from './story-continuation-openai.config';
import { readStoryContinuationWorkerConfig, StoryContinuationWorker } from './story-continuation.worker';
import { readStoryContinuationTimingPolicy, STORY_CONTINUATION_TIMING_POLICY } from './story-continuation-timing.config';
import { createStoryContinuationTimingPolicy, StoryContinuationTimingPolicyError,
  type StoryContinuationTimingPolicy } from './story-continuation-timing.policy';

export const STORY_CONTINUATION_TIMING_PROVIDER: FactoryProvider<StoryContinuationTimingPolicy> = {
  provide: STORY_CONTINUATION_TIMING_POLICY,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => readStoryContinuationTimingPolicy(config),
};

export const STORY_CONTINUATION_OPENAI_PROVIDER: FactoryProvider<StoryContinuationProvider> = {
  provide: StoryContinuationProvider,
  inject: [ConfigService, { token: STORY_CONTINUATION_TIMING_POLICY, optional: true }],
  useFactory: (config: ConfigService, timing: StoryContinuationTimingPolicy = createStoryContinuationTimingPolicy()) => {
    const providerConfig = readStoryContinuationOpenAiConfig(config, timing);
    if (config.get('STORY_CONTINUATION_TIMING_PRESET') !== undefined &&
        providerConfig.timeoutMs !== timing.providerDeadlineMs) throw new StoryContinuationTimingPolicyError();
    return new OpenAiStoryContinuationProvider(providerConfig);
  },
};

export const STORY_CONTINUATION_WORKER_PROVIDER: FactoryProvider<StoryContinuationWorker> = {
  provide: StoryContinuationWorker,
  inject: [StoryContinuationExecutor, StoryContinuationProvider, ConfigService,
    { token: STORY_CONTINUATION_TIMING_POLICY, optional: true }],
  useFactory: (executor: StoryContinuationExecutor, provider: StoryContinuationProvider, config: ConfigService,
    timing: StoryContinuationTimingPolicy = createStoryContinuationTimingPolicy()) => {
    const workerConfig = readStoryContinuationWorkerConfig(config, timing);
    if (workerConfig.drainMs !== timing.drainMs) throw new StoryContinuationTimingPolicyError();
    return new StoryContinuationWorker(executor, provider, workerConfig);
  },
};

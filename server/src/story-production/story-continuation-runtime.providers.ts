import type { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StoryContinuationProvider } from './story-continuation.provider';
import { StoryContinuationExecutor } from './story-continuation.executor';
import { OpenAiStoryContinuationProvider } from './story-continuation-openai.adapter';
import { readStoryContinuationOpenAiConfig } from './story-continuation-openai.config';
import { readStoryContinuationWorkerConfig, StoryContinuationWorker } from './story-continuation.worker';

export const STORY_CONTINUATION_OPENAI_PROVIDER: FactoryProvider<StoryContinuationProvider> = {
  provide: StoryContinuationProvider,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => new OpenAiStoryContinuationProvider(readStoryContinuationOpenAiConfig(config)),
};

export const STORY_CONTINUATION_WORKER_PROVIDER: FactoryProvider<StoryContinuationWorker> = {
  provide: StoryContinuationWorker,
  inject: [StoryContinuationExecutor, StoryContinuationProvider, ConfigService],
  useFactory: (executor: StoryContinuationExecutor, provider: StoryContinuationProvider, config: ConfigService) =>
    new StoryContinuationWorker(executor, provider, readStoryContinuationWorkerConfig(config)),
};

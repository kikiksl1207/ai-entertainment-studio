import { ConfigService } from '@nestjs/config';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { StoryProductionModule } from './story-production.module';
import { StoryContinuationProvider } from './story-continuation.provider';
import { StoryContinuationExecutor } from './story-continuation.executor';
import { StoryContinuationWorker } from './story-continuation.worker';
import {
  STORY_CONTINUATION_OPENAI_PROVIDER,
  STORY_CONTINUATION_WORKER_PROVIDER,
} from './story-continuation-runtime.providers';

describe('story continuation runtime factory wiring', () => {
  it('registers the opt-in factories in the production module', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, StoryProductionModule);
    expect(providers).toContain(STORY_CONTINUATION_OPENAI_PROVIDER);
    expect(providers).toContain(STORY_CONTINUATION_WORKER_PROVIDER);
    expect(providers.filter((entry: any) => entry.provide === StoryContinuationProvider)).toHaveLength(1);
  });

  it('boots and closes with absent configuration without dispatching or contacting a provider', async () => {
    const executor = { executeOne: jest.fn() };
    const module = await Test.createTestingModule({ providers: [
      { provide: ConfigService, useValue: { get: () => undefined } },
      { provide: StoryContinuationExecutor, useValue: executor },
      STORY_CONTINUATION_OPENAI_PROVIDER,
      STORY_CONTINUATION_WORKER_PROVIDER,
    ] }).compile();
    await module.init();
    expect((await module.get(StoryContinuationProvider).readiness()).enabled).toBe(false);
    expect(module.get(StoryContinuationWorker).readiness().enabled).toBe(false);
    expect(executor.executeOne).not.toHaveBeenCalled();
    await module.close();
  });
});

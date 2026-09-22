import { BadRequestException } from '@nestjs/common';
import {
  STORY_PUBLIC_BETA_AI_RUNTIME,
  StoryPublicBetaAiActivationService,
} from './story-public-beta-ai-activation.service';

describe('StoryPublicBetaAiActivationService', () => {
  const service = new StoryPublicBetaAiActivationService({} as never, {} as never);

  it('pins the runtime model, rate card and Korean public-test scope', () => {
    expect(STORY_PUBLIC_BETA_AI_RUNTIME).toEqual({
      model: 'gpt-5.4-mini-2026-03-17',
      rateCardId: 'ed9b8bf1-df49-4f2d-9f62-6aeb9c5ed4f6',
      rateCardVersion: 'story-openai-gpt-5.4-mini-2026-03-17-krw-v1',
      locale: 'ko',
      region: 'KR',
    });
  });

  it('fails before database access when any explicit confirmation is missing', async () => {
    await expect(service.activate('operator', 'imjin', {
      aiBranchGenerationConfirmed: true,
      authorStyleReferenceConfirmed: true,
      generatedResultReuseConfirmed: true,
      imageTransformationConfirmed: false,
    } as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects works outside the two approved public beta publications', async () => {
    await expect(service.status('unapproved-work')).rejects.toBeInstanceOf(BadRequestException);
  });
});

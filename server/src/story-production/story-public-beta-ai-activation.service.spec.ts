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

  it('accepts all four approved public beta publications and rejects unknown works', async () => {
    const prisma = { storyWork: { findUnique: jest.fn().mockResolvedValue(null) } };
    const scoped = new StoryPublicBetaAiActivationService(prisma as never, {} as never);
    await expect(scoped.status('monster')).resolves.toMatchObject({ storyKey: 'monster', status: 'unavailable' });
    await expect(scoped.status('rebellion')).resolves.toMatchObject({ storyKey: 'rebellion', status: 'unavailable' });
    await expect(service.status('unapproved-work')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('adds two generated choices beside the existing writer route for fixed publications', async () => {
    const storyChoice = {
      findFirst: jest.fn().mockResolvedValue({ id: 'writer-choice' }),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
    };
    const tx = {
      storyScene: { findMany: jest.fn().mockResolvedValue([
        { id: 'scene-1', partId: 'part-1' },
        { id: 'scene-2', partId: 'part-2' },
      ]) },
      storyChoice,
    };
    const added = await (service as any).ensureFixedRouteSuggestedChoices(tx, 'monster', [
      { id: 'part-1', position: 1, title: { ko: '첫 파도' } },
      { id: 'part-2', position: 2, title: { ko: '마지막 이름' } },
    ]);

    expect(added).toBe(4);
    expect(storyChoice.upsert).toHaveBeenCalledTimes(4);
    expect(storyChoice.upsert.mock.calls.map((call) => call[0].create.routeKind))
      .toEqual(['generation_required', 'generation_required', 'generation_required', 'generation_required']);
    expect(storyChoice.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ label: { ko: '원작의 흐름대로 다음 장으로 간다' } }),
    }));
    expect(storyChoice.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ label: { ko: '작가가 정한 결말을 선택한다' } }),
    }));
  });

  it('does not report an AI release as active when readers still have one choice', async () => {
    const prisma = {
      storyWork: { findUnique: jest.fn().mockResolvedValue({ id: 'work', activeReleaseId: 'release', status: 'published' }) },
      storyPart: { findMany: jest.fn().mockResolvedValue([{ id: 'part' }]) },
      storyScene: { findMany: jest.fn().mockResolvedValue([{ id: 'scene', partId: 'part' }]) },
      storyChoice: { groupBy: jest.fn().mockResolvedValue([{ sceneId: 'scene', _count: { _all: 1 } }]) },
    };
    const scoped = new StoryPublicBetaAiActivationService(prisma as never, {} as never);
    jest.spyOn(scoped as any, 'latestValidActivation').mockResolvedValue({ locale: 'ko', region: 'KR' });

    await expect(scoped.status('monster')).resolves.toMatchObject({ status: 'inactive', active: false });
    prisma.storyChoice.groupBy.mockResolvedValue([{ sceneId: 'scene', _count: { _all: 3 } }]);
    await expect(scoped.status('monster')).resolves.toMatchObject({ status: 'active', active: true });
  });

  it('prepares all choices before enabling the legal AI activation', async () => {
    const order: string[] = [];
    const tx = {
      storyWork: { findUnique: jest.fn().mockResolvedValue({ id: 'work', status: 'published', activeReleaseId: 'release', ownerUserId: 'owner' }) },
      storyRelease: { findFirst: jest.fn().mockResolvedValue({ id: 'release', checksum: 'checksum' }) },
      storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue({ id: 'manuscript' }) },
      storyPart: { findMany: jest.fn().mockResolvedValue([{ id: 'part', position: 1, title: { ko: '시작' } }]) },
      storyReaderProgress: { updateMany: jest.fn() },
      storyAiAllowanceBucket: { updateMany: jest.fn() },
      auditEvent: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) };
    const legalActivation = { createActivation: jest.fn(() => { order.push('legal'); return Promise.resolve({ id: 'activation' }); }) };
    const scoped = new StoryPublicBetaAiActivationService(prisma as never, legalActivation as never);
    jest.spyOn(scoped as any, 'ensureRateCard').mockResolvedValue({ id: 'rate', version: 'rate-v1' });
    jest.spyOn(scoped as any, 'ensureStyleSnapshot').mockResolvedValue({ id: 'analysis' });
    jest.spyOn(scoped as any, 'ensureConsent').mockResolvedValue({ id: 'consent', revision: 1 });
    jest.spyOn(scoped as any, 'ensureRights').mockResolvedValue({ id: 'rights' });
    jest.spyOn(scoped as any, 'ensureCapability').mockResolvedValue({ revision: 1, includedAiRouteCount: 3 });
    jest.spyOn(scoped as any, 'fixedRouteChoicesReady').mockResolvedValue(true);
    const choices = jest.spyOn(scoped as any, 'ensureFixedRouteSuggestedChoices').mockImplementation(async () => {
      order.push('choices');
      throw new Error('choice preparation failed');
    });
    const confirmations = {
      aiBranchGenerationConfirmed: true,
      authorStyleReferenceConfirmed: true,
      generatedResultReuseConfirmed: true,
      imageTransformationConfirmed: true,
    } as const;
    await expect(scoped.activate('operator', 'monster', confirmations)).rejects.toThrow('choice preparation failed');
    expect(order).toEqual(['choices']);
    expect(legalActivation.createActivation).not.toHaveBeenCalled();

    choices.mockImplementation(async () => { order.push('choices'); return 2; });
    jest.spyOn(scoped as any, 'latestValidActivation').mockResolvedValue(null);
    await expect(scoped.activate('operator', 'monster', confirmations)).resolves.toMatchObject({ active: true });
    expect(order).toEqual(['choices', 'choices', 'legal']);
  });
});

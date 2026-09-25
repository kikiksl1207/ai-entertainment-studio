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
    await expect(service.activate('operator', 'inheritor', {} as never))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.activate('operator', 'inheritor', {
      aiBranchGenerationConfirmed: true,
      authorStyleReferenceConfirmed: true,
      generatedResultReuseConfirmed: true,
    } as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts all five approved public beta publications and rejects unknown works', async () => {
    const prisma = { storyWork: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    } };
    const scoped = new StoryPublicBetaAiActivationService(prisma as never, {} as never);
    await expect(scoped.status('monster')).resolves.toMatchObject({ storyKey: 'monster', status: 'unavailable' });
    await expect(scoped.status('rebellion')).resolves.toMatchObject({ storyKey: 'rebellion', status: 'unavailable' });
    await expect(scoped.status('inheritor')).resolves.toMatchObject({ storyKey: 'inheritor', status: 'unavailable' });
    expect(prisma.storyWork.findMany).toHaveBeenCalledWith({
      where: {
        slug: { startsWith: 'the-killer-inherits-the-dead-' },
        status: 'published',
        fixtureSource: false,
      },
      take: 2,
    });
    await expect(service.status('unapproved-work')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports the unique dynamic inheritor release only after all choices are ready', async () => {
    const prisma = { storyWork: { findMany: jest.fn().mockResolvedValue([{
      id: 'work', activeReleaseId: 'release', status: 'published', fixtureSource: false,
    }]) } };
    const scoped = new StoryPublicBetaAiActivationService(prisma as never, {} as never);
    jest.spyOn(scoped as any, 'latestValidActivation').mockResolvedValue({ locale: 'ko', region: 'KR' });
    const choicesReady = jest.spyOn(scoped as any, 'fixedRouteChoicesReady').mockResolvedValue(true);

    await expect(scoped.status('inheritor')).resolves.toMatchObject({ storyKey: 'inheritor', active: true });
    expect(choicesReady).toHaveBeenCalled();

    prisma.storyWork.findMany.mockResolvedValueOnce([
      { id: 'work-1', activeReleaseId: 'release-1', status: 'published' },
      { id: 'work-2', activeReleaseId: 'release-2', status: 'published' },
    ]);
    await expect(scoped.status('inheritor')).rejects.toThrow('Multiple published inheritor works match');
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

  it('activates inheritor once, then replays the same legal grant without fixed-route repair', async () => {
    const tx = {
      storyWork: { findMany: jest.fn().mockResolvedValue([{
        id: 'work', status: 'published', fixtureSource: false,
        activeReleaseId: 'release', ownerUserId: 'owner',
      }]) },
      storyRelease: { findFirst: jest.fn().mockResolvedValue({ id: 'release', checksum: 'checksum' }) },
      storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue({ id: 'manuscript' }) },
      storyPart: { findMany: jest.fn().mockResolvedValue([{ id: 'part', position: 1, title: { ko: '시작' } }]) },
      storyReaderProgress: { updateMany: jest.fn() },
      storyAiAllowanceBucket: { updateMany: jest.fn() },
      auditEvent: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) };
    const legalActivation = { createActivation: jest.fn().mockResolvedValue({ id: 'activation' }) };
    const scoped = new StoryPublicBetaAiActivationService(prisma as never, legalActivation as never);
    jest.spyOn(scoped as any, 'ensureRateCard').mockResolvedValue({ id: 'rate', version: 'rate-v1' });
    jest.spyOn(scoped as any, 'ensureStyleSnapshot').mockResolvedValue({ id: 'analysis' });
    jest.spyOn(scoped as any, 'ensureConsent').mockResolvedValue({ id: 'consent', revision: 1 });
    jest.spyOn(scoped as any, 'ensureRights').mockResolvedValue({ id: 'rights' });
    jest.spyOn(scoped as any, 'ensureCapability').mockResolvedValue({ revision: 1, includedAiRouteCount: 3 });
    jest.spyOn(scoped as any, 'fixedRouteChoicesReady').mockResolvedValue(true);
    const existing = jest.spyOn(scoped as any, 'latestValidActivation')
      .mockResolvedValueOnce(null).mockResolvedValue({ id: 'activation' });
    const repair = jest.spyOn(scoped as any, 'ensureFixedRouteSuggestedChoices');
    const confirmations = {
      aiBranchGenerationConfirmed: true,
      authorStyleReferenceConfirmed: true,
      generatedResultReuseConfirmed: true,
      imageTransformationConfirmed: true,
    } as const;

    await expect(scoped.activate('operator', 'inheritor', confirmations))
      .resolves.toMatchObject({ active: true, idempotentReplay: false, activationId: 'activation' });
    await expect(scoped.activate('operator', 'inheritor', confirmations))
      .resolves.toMatchObject({ active: true, idempotentReplay: true, activationId: 'activation' });
    expect(tx.storyWork.findMany).toHaveBeenCalledTimes(2);
    expect(existing).toHaveBeenCalledWith(prisma, 'work', 'release', 'rights', 'consent', 1);
    expect(repair).not.toHaveBeenCalled();
    expect(legalActivation.createActivation).toHaveBeenCalledTimes(1);
    expect(legalActivation.createActivation).toHaveBeenCalledWith('operator', expect.objectContaining({
      rightsContractVersionId: 'rights',
      consentId: 'consent',
      consentRevision: 1,
      legalActivationConfirmed: true,
    }));
  });
});

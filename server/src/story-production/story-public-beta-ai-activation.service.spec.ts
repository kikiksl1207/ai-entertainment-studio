import { BadRequestException } from '@nestjs/common';
import {
  STORY_PUBLIC_BETA_AI_RUNTIME,
  StoryPublicBetaAiActivationService,
} from './story-public-beta-ai-activation.service';
import { StoryFixedRouteChoiceRefreshService } from './story-fixed-route-choice-refresh.service';

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

  it('upgrades the release output ceiling for full authored-part continuations', async () => {
    const tx = {
      storyReleaseCapability: {
        findUnique: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
          id: 'capability', rateCardId: 'rate', fixedChoiceCount: 3,
          customChoiceEnabled: false, includedAiRouteCount: 275,
          aiInputTokenLimit: 32_768, aiOutputTokenLimit: 8_192,
          fullResetLimit: 1, actResetLimit: 3,
          warningBudgetKrw: 100, hardBudgetKrw: 300, status: 'active',
        }),
        create: jest.fn().mockImplementation(async ({ data }) => data),
        update: jest.fn().mockImplementation(async ({ data }) => data),
      },
    };
    await (service as any).ensureCapability(tx, 'operator', 'work', 'release', 'rate', 265);
    expect(tx.storyReleaseCapability.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ aiInputTokenLimit: 32_768, aiOutputTokenLimit: 32_768 }),
    }));
    await (service as any).ensureCapability(tx, 'operator', 'work', 'release', 'rate', 265);
    expect(tx.storyReleaseCapability.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'capability' },
      data: expect.objectContaining({ aiOutputTokenLimit: 32_768, revision: { increment: 1 } }),
    }));
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

  it('reports a legal activation independently of whether a legacy part has one public choice', async () => {
    const prisma = {
      storyWork: { findUnique: jest.fn().mockResolvedValue({ id: 'work', activeReleaseId: 'release', status: 'published' }) },
      storyPart: { findMany: jest.fn().mockResolvedValue([{ id: 'part', position: 1, title: { ko: '시작' } }]) },
      storyScene: { findMany: jest.fn().mockResolvedValue([{ id: 'scene', partId: 'part' }]) },
      storyChoice: { findMany: jest.fn().mockResolvedValue([{
        id: 'original', sceneId: 'scene', choiceKey: 'finish', position: 1,
        label: { ko: '원작 결말' }, routeKind: 'writer_original', targetSceneId: null,
        targetEndingKey: 'author_main', declaredRejoinSceneId: null,
      }]) },
    };
    const scoped = new StoryPublicBetaAiActivationService(prisma as never, {} as never);
    jest.spyOn(scoped as any, 'latestValidActivation').mockResolvedValue({ locale: 'ko', region: 'KR' });

    await expect(scoped.status('monster')).resolves.toMatchObject({
      status: 'active', active: true,
      choicePreparation: { phase: 'preparing', remainingParts: 1, publicChoiceSet: 'legacy' },
    });
    prisma.storyChoice.findMany.mockResolvedValue([
      { id: 'original', sceneId: 'scene', choiceKey: 'finish', position: 1,
        label: { ko: '원작 결말' }, routeKind: 'writer_original', targetSceneId: null,
        targetEndingKey: 'author_main', declaredRejoinSceneId: null },
      { id: 'b', sceneId: 'scene', choiceKey: 'ai-branch-b-v1', position: 2,
        label: { ko: '증거를 공개한다' }, routeKind: 'generation_required', targetSceneId: null,
        targetEndingKey: null, declaredRejoinSceneId: null },
      { id: 'c', sceneId: 'scene', choiceKey: 'ai-branch-c-v1', position: 3,
        label: { ko: '기록을 숨긴다' }, routeKind: 'generation_required', targetSceneId: null,
        targetEndingKey: null, declaredRejoinSceneId: null },
    ]);
    await expect(scoped.status('monster')).resolves.toMatchObject({ status: 'active', active: true });
  });

  it('reports an existing legal activation as active while legacy choices are staged', async () => {
    const prisma = { storyWork: { findUnique: jest.fn().mockResolvedValue({
      id: 'work', status: 'published', activeReleaseId: 'release',
    }) } };
    const scoped = new StoryPublicBetaAiActivationService(prisma as never, {} as never);
    const activation = jest.spyOn(scoped as any, 'latestValidActivation').mockResolvedValue({
      id: 'live-grant', locale: 'ko', region: 'KR', expiresAt: new Date('2027-01-01'),
    });
    const preparation = jest.spyOn(StoryFixedRouteChoiceRefreshService.prototype, 'status')
      .mockResolvedValue({ totalParts: 32, preparedParts: 8, remainingParts: 24,
        ready: false, phase: 'preparing', publicChoiceSet: 'legacy' });
    try {
      await expect(scoped.status('monster')).resolves.toMatchObject({
        status: 'active', active: true,
        choicePreparation: { ready: false, phase: 'preparing', publicChoiceSet: 'legacy' },
      });
      expect(activation).toHaveBeenCalledWith(prisma, 'work', 'release');
    } finally {
      preparation.mockRestore();
      activation.mockRestore();
    }
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
    const choices = jest.spyOn(StoryFixedRouteChoiceRefreshService.prototype, 'refreshBatch').mockImplementation(async () => {
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

      choices.mockImplementationOnce(async () => { order.push('choices'); return {
        totalParts: 2, preparedParts: 1, remainingParts: 1, ready: false,
        phase: 'preparing', publicChoiceSet: 'legacy',
      }; }).mockImplementation(async () => { order.push('choices'); return {
        totalParts: 2, preparedParts: 2, remainingParts: 0, ready: true,
        phase: 'ready', publicChoiceSet: 'prepared',
    }; });
    jest.spyOn(scoped as any, 'latestValidActivation').mockResolvedValue(null);
    await expect(scoped.activate('operator', 'monster', confirmations)).resolves.toMatchObject({
      status: 'preparing_choices', active: false, remainingParts: 1,
    });
    expect(legalActivation.createActivation).not.toHaveBeenCalled();
    await expect(scoped.activate('operator', 'monster', confirmations)).resolves.toMatchObject({ active: true });
    expect(order).toEqual(['choices', 'choices', 'choices', 'legal']);
    choices.mockRestore();
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
    const repair = jest.spyOn(StoryFixedRouteChoiceRefreshService.prototype, 'refreshBatch');
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

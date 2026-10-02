import { StoryVisualGenerationService } from './story-visual-generation.service';
import { Prisma } from '@prisma/client';
import { ConflictException, NotFoundException } from '@nestjs/common';
import * as sharp from 'sharp';
import { createHash } from 'crypto';
import { StoryUploadStorageService } from '../story-upload/story-upload-storage.service';
import {
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
  stableJson,
  STORY_PROFILE_SECTION_KEYS,
} from '../generation-profile/creator-generation-profile.policy';
import { continuationGenerationProfileSnapshot } from './story-continuation-context.policy';

describe('StoryVisualGenerationService', () => {
  const workId = '00000000-0000-4000-8000-000000000001';
  const releaseId = '00000000-0000-4000-8000-000000000002';
  const progressId = '00000000-0000-4000-8000-000000000003';
  const sceneId = '00000000-0000-4000-8000-000000000004';
  const partId = '00000000-0000-4000-8000-000000000005';
  const assetId = '00000000-0000-4000-8000-000000000006';
  const sourceSceneKey = 'part-001-scene-001';
  const checksum = 'a'.repeat(64);
  const promptSha256 = 'b'.repeat(64);
  const objectStorageKey = `lumina-stage/story-visuals/${workId}/${releaseId}/${sourceSceneKey}/scene.webp`;

  function fixture(enabled = true, participants?: any) {
    let generation: any = null;
    const prisma: any = {
      storyReaderProgress: { findFirst: jest.fn().mockResolvedValue({
        workId, currentSceneId: sceneId, currentGeneratedSceneId: null, activeReleaseId: releaseId,
      }) },
      storyScene: {
        findFirst: jest.fn().mockResolvedValue({ id: sceneId, sceneKey: 'part-001-main', partId }),
        findMany: jest.fn().mockResolvedValue([{ id: sceneId, title: { ko: '새벽 바다' } }]),
      },
      storyPart: {
        findFirst: jest.fn().mockResolvedValue({ id: partId }),
        findMany: jest.fn().mockResolvedValue([{ id: partId, title: { ko: '전란의 시작' } }]),
      },
      storyWork: { findFirst: jest.fn().mockResolvedValue({ id: workId, activeReleaseId: releaseId,
        title: { ko: '불타는 바다의 기록자' }, summary: { ko: '임진왜란 역사 서사' } }) },
      storyRelease: { findFirst: jest.fn().mockResolvedValue({ id: releaseId, checksum,
        localizedDisplaySnapshot: { ko: { title: '불타는 바다의 기록자', summary: '임진왜란 역사 서사' } },
        sceneAssetManifest: { state: 'prompt_backed' } }) },
      storyAiContinuation: { findFirst: jest.fn() },
      storyAiGeneratedBeat: { findMany: jest.fn() },
      storyWorkGenerationProfile: { findFirst: jest.fn() },
      storyAnalysisJob: { findFirst: jest.fn().mockResolvedValue(null) },
      storyManuscriptVersion: { findFirst: jest.fn() },
      storyStyleProfileConsent: { findUnique: jest.fn() },
      storyBeat: { findFirst: jest.fn().mockResolvedValue({ id: 'beat-id' }),
        findMany: jest.fn().mockResolvedValue([{ content: { ko: '이순신은 늘 같은 검은 수염과 붉은 철릭 차림으로 갑판에 섰다.' } }]) },
      storyVisualPrompt: {
        findUnique: jest.fn().mockResolvedValue({ workId, releaseId, releaseChecksum: checksum,
          sourceSceneKey, promptSha256, promptText: 'A sufficiently detailed private scene image direction.' }),
        findMany: jest.fn(async (args: any) => args?.select?.sourceSceneKey && args?.select?.promptText
          ? [{ sourceSceneKey, releaseChecksum: checksum, promptSha256,
            promptText: 'A sufficiently detailed private scene image direction.' }]
          : args?.select?.promptText
            ? [{ promptText: 'Joseon naval historical drama, restrained sea-blue and ember palette. Recurring officers keep identical faces and uniforms.' }]
            : [{ sourceSceneKey }]),
        create: jest.fn(),
      },
      storyAiGeneratedScene: { findFirst: jest.fn() },
      storyProgressArtistParticipant: { findFirst: jest.fn() },
      storyVisualGeneration: {
        findUnique: jest.fn(async () => generation),
        findUniqueOrThrow: jest.fn(async () => generation),
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(async ({ data }: any) => (generation = { id: 'generation-id', status: 'pending',
          attemptCount: 0, updatedAt: new Date(), assetId: null, ...data })),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (generation && where?.bookingIdentity && JSON.stringify(generation.bookingIdentity ?? null) !==
              JSON.stringify(where.bookingIdentity.equals === Prisma.DbNull ? null : where.bookingIdentity.equals)) return { count: 0 };
          if (generation && typeof where?.status === 'string' && generation.status !== where.status) return { count: 0 };
          if (generation && where?.status?.in && !where.status.in.includes(generation.status)) return { count: 0 };
          if (generation && where?.OR && !where.OR.some((condition: any) =>
            (typeof condition.status === 'string' ? generation.status === condition.status : condition.status?.in?.includes(generation.status)) &&
            (!condition.updatedAt?.lt || generation.updatedAt < condition.updatedAt.lt))) return { count: 0 };
          if (generation && ['pending', 'failed'].includes(generation.status) && data.status === 'failed') {
            generation = { ...generation, ...data }; return { count: 1 };
          }
          if (generation?.status === 'ready' && !data.status &&
              String(data.lastErrorCode).startsWith('STALE_REPLACEMENT_')) {
            generation = { ...generation, ...data };
            return { count: 1 };
          }
          if (generation?.status === 'ready' && data.status === 'ready') {
            generation = { ...generation, ...data };
            return { count: 1 };
          }
          if (generation && ['pending', 'failed'].includes(generation.status) && data.status === 'generating') {
            generation = { ...generation, ...data, status: data.status,
              attemptCount: data.attemptCount ? generation.attemptCount + 1 : generation.attemptCount,
              updatedAt: data.updatedAt };
            return { count: 1 };
          }
          if (generation?.status === 'ready' && data.status === 'generating') {
            generation = { ...generation, ...data,
              attemptCount: data.attemptCount ? generation.attemptCount + 1 : generation.attemptCount };
            return { count: 1 };
          }
          if (generation?.status === 'generating' && ['pending', 'failed', 'ready'].includes(data.status)) {
            const attemptCount = data.attemptCount?.decrement ? generation.attemptCount - data.attemptCount.decrement : generation.attemptCount;
            generation = { ...generation, ...data, attemptCount };
            return { count: 1 };
          }
          return { count: 0 };
        }),
        update: jest.fn(async ({ data }: any) => (generation = { ...generation, ...data })),
      },
      asset: {
        create: jest.fn().mockResolvedValue({ id: assetId }),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (run: any) => run(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const values: Record<string, string> = {
      STORY_IMAGE_GENERATION_ENABLED: enabled ? 'true' : 'false',
      OPENAI_API_KEY: 'test-key',
      OPENAI_IMAGE_MODEL: 'gpt-image-2',
      OPENAI_IMAGE_QUALITY: 'medium',
      OPENAI_STORY_SCENE_IMAGE_SIZE: '1536x1024',
      OBJECT_STORAGE_PROVIDER: 'r2',
      OBJECT_STORAGE_ENDPOINT: 'https://storage.example.test',
      OBJECT_STORAGE_BUCKET: 'bucket',
      OBJECT_STORAGE_REGION: 'auto',
      OBJECT_STORAGE_ACCESS_KEY_ID: 'access-key',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
      OBJECT_STORAGE_KEY_PREFIX: 'lumina-stage',
      STORY_IMAGE_DATABASE_FALLBACK_ENABLED: 'true',
    };
    const config = { get: jest.fn((key: string) => values[key]) };
    const visualReviews = { approvedForPublishedSource: jest.fn().mockResolvedValue(null) };
    const service = new StoryVisualGenerationService(prisma, config as never, undefined, participants, undefined, visualReviews as never);
    jest.spyOn(Reflect.get(service, 'logger'), 'log').mockImplementation();
    jest.spyOn(Reflect.get(service, 'logger'), 'warn').mockImplementation();
    return { prisma, config, visualReviews, service,
      generation: () => generation, setGeneration: (value: any) => { generation = value; },
      setConfig: (key: string, value: string) => { values[key] = value; } };
  }

  function reviewedVisualFixture() {
    const f = fixture();
    f.setConfig('OPENAI_STORY_SCENE_IMAGE_SIZE', '1024x1536');
    const owner = '00000000-0000-4000-8000-000000000008';
    const manuscript = { id: '00000000-0000-4000-8000-000000000009', contentHash: 'c'.repeat(64) };
    const analysis = { id: '00000000-0000-4000-8000-000000000010', manuscriptVersionId: manuscript.id,
      sourceContentHash: manuscript.contentHash, analysisVersion: 1, configHash: 'd'.repeat(64), totalParagraphs: 1, completedParagraphs: 1 };
    const settings = normalizeCreatorGenerationProfile('story', { schemaVersion: 'creator-generation-profile-v1', kind: 'story',
      sections: STORY_PROFILE_SECTION_KEYS.map(key => ({ key, decision: 'accepted', evidence: [], value: { summary: key,
        ...(key === 'visual_direction' ? { visualBible: { era: 'Modern archive', artStyle: 'Charcoal illustration', palette: 'Green and gray', prohibited: [] } }
          : key === 'visual_cast' ? { characters: [{ name: 'Archivist', appearance: 'Adult woman, black hair, green jacket' }] } : {}) } })) });
    const sourceFingerprint = createHash('sha256').update(stableJson({ workId, manuscriptVersionId: manuscript.id,
      contentHash: manuscript.contentHash, analysisJobId: analysis.id, analysisVersion: 1, analysisConfigHash: analysis.configHash })).digest('hex');
    const profile = { id: '00000000-0000-4000-8000-000000000011', workId, ownerUserId: owner, approvedByUserId: owner,
      manuscriptVersionId: manuscript.id, analysisJobId: analysis.id, status: 'approved', profileVersion: 1, reviewRevision: 1,
      approvedAt: new Date(), sourceFingerprint, approvedSettings: settings,
      approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings) };
    f.prisma.storyWork.findFirst.mockResolvedValue({ id: workId, ownerUserId: owner, activeReleaseId: releaseId,
      title: { ko: 'The archive' }, summary: { ko: 'The ledger story' } });
    f.prisma.storyRelease.findFirst.mockResolvedValue({ id: releaseId, checksum, manuscriptVersionId: manuscript.id,
      sceneAssetManifest: { visualBible: { artStyle: 'OLD STYLE', characters: [{ name: 'OLD FACE', appearance: 'OLD FACE' }] } } });
    f.prisma.storyWorkGenerationProfile.findFirst.mockResolvedValue(profile);
    f.prisma.storyAnalysisJob.findFirst.mockResolvedValue(analysis);
    f.prisma.storyManuscriptVersion.findFirst.mockResolvedValue(manuscript);
    f.prisma.storyStyleProfileConsent.findUnique.mockResolvedValue({ id: 'consent-id', ownerUserId: owner,
      manuscriptVersionId: manuscript.id, status: 'active', rightsConfirmed: true, aiBranchAllowed: true,
      imageTransformationAllowed: true, allowedLocales: ['ko'], revision: 1, startsAt: new Date(0), expiresAt: null });
    f.prisma.$queryRaw = jest.fn().mockResolvedValue([]);
    return { ...f, profile };
  }

  function storedBranchFixture(f = fixture()) {
    const continuationId = '00000000-0000-4000-8000-000000000008';
    const generatedSceneId = '00000000-0000-4000-8000-000000000007';
    const result = { title: { ko: '불길 속의 선택' },
      beats: [{ beatType: 'paragraph' as const, content: { ko: '그는 불타는 갑판으로 돌아섰다.' } }] };
    const continuation = { id: continuationId, userId: 'reader-id', workId, releaseId,
      releaseChecksum: checksum, progressId, sourcePartId: partId, locale: 'ko',
      resultGeneratedSceneId: generatedSceneId, contextReferences: {} as Record<string, unknown> };
    const scene = { id: generatedSceneId, sceneKey: `ai-${continuationId}`, title: result.title, resultChecksum: 'c'.repeat(64) };
    f.prisma.storyAiContinuation.findFirst.mockResolvedValue(continuation);
    f.prisma.storyAiGeneratedScene.findFirst.mockResolvedValue(scene);
    f.prisma.storyAiGeneratedBeat.findMany.mockResolvedValue(result.beats.map((beat, index) => ({ ...beat, position: index + 1 })));
    return { ...f, continuationId, generatedSceneId, result, continuation, scene };
  }

  async function publicAssetBinding(f: ReturnType<typeof fixture>, variantKey = 'default') {
    const effective = await (f.service as any).effectiveVisualPrompt(workId, releaseId, checksum,
      'A sufficiently detailed private scene image direction.', sourceSceneKey);
    return {
      lifecycle: { status: 'active' },
      storyVisual: {
        workId, releaseId, releaseChecksum: checksum, sourceSceneKey, variantKey,
        participantFingerprint: variantKey.startsWith('artist:') ? variantKey.slice(7) : null,
        promptSha256, visualBibleVersion: effective.bible.version,
        visualBibleFingerprint: effective.bible.fingerprint,
        effectivePromptSha256: effective.sha256,
        provider: 'openai', model: 'gpt-image-2', quality: 'medium', size: '1536x1024',
        requestContractVersion: 'openai-image-request-v5',
      },
    };
  }

  afterEach(() => jest.restoreAllMocks());

  it('projects only prompt keys and never private prompt text', async () => {
    const f = fixture();
    await expect(f.service.promptKeys(workId, releaseId, [sourceSceneKey, sourceSceneKey, '../private']))
      .resolves.toEqual(new Set([sourceSceneKey]));
    expect(f.prisma.storyVisualPrompt.findMany).toHaveBeenCalledWith({
      where: { workId, releaseId, sourceSceneKey: { in: [sourceSceneKey] } },
      select: { sourceSceneKey: true, promptText: true, sourceKind: true },
    });
  });

  it('returns unavailable without calling a provider when generation is disabled', async () => {
    const f = fixture(false);
    const provider = jest.spyOn(global, 'fetch');
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey))
      .resolves.toEqual({ status: 'unavailable', reason: 'generation_disabled' });
    expect(provider).not.toHaveBeenCalled();
  });

  it.each(['ai-', 'ai-reuse-'])('recovers a %s scene prompt on the first scene read after settlement', async prefix => {
    const f = fixture();
    const continuationId = '00000000-0000-4000-8000-000000000008';
    const generatedSceneKey = `${prefix}${continuationId}`;
    const generatedSceneId = '00000000-0000-4000-8000-000000000007';
    f.prisma.storyVisualPrompt.findMany.mockResolvedValue([]);
    f.prisma.storyVisualPrompt.findUnique.mockResolvedValue({ id: 'prompt-id' });
    f.prisma.storyAiGeneratedScene.findFirst.mockResolvedValue({ id: generatedSceneId, continuationId: 'continuation-id',
      workId, releaseId, userId: 'user-id' });
    f.prisma.storyAiContinuation.findFirst.mockResolvedValue({ contextReferences: {} });
    const recover = jest.spyOn(f.service, 'registerGeneratedContinuationPrompt')
      .mockResolvedValue({ created: true } as never);
    f.prisma.storyAiGeneratedScene.findFirst.mockResolvedValueOnce({ id: generatedSceneId });
    f.prisma.storyAiGeneratedBeat.findMany.mockResolvedValue([
      { beatType: 'paragraph', content: { ko: '새 장면이 시작됐다.' } },
    ]);
    f.prisma.storyAiGeneratedScene.findFirst.mockResolvedValueOnce({
      id: generatedSceneId, continuationId, title: { ko: '갈림길' },
    });

    await expect(f.service.promptKeys(workId, releaseId, [generatedSceneKey]))
      .resolves.toEqual(new Set([generatedSceneKey]));
    expect(recover).toHaveBeenCalledWith(continuationId, {
      title: { ko: '갈림길' },
      beats: [{ beatType: 'paragraph', content: { ko: '새 장면이 시작됐다.' } }],
    });
    expect(f.prisma.storyVisualPrompt.findUnique).toHaveBeenCalledWith({
      where: { workId_releaseId_sourceSceneKey: { workId, releaseId, sourceSceneKey: generatedSceneKey } },
      select: { id: true, promptText: true, sourceKind: true },
    });
    expect(f.prisma.storyAiGeneratedBeat.findMany).toHaveBeenCalledWith({ where: { sceneId: generatedSceneId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { beatType: true, content: true }, take: 41 });
  });

  it('does not claim a generated prompt is ready when its recovery fails', async () => {
    const f = fixture();
    const generatedSceneKey = 'ai-00000000-0000-4000-8000-000000000008';
    const warn = jest.spyOn(Reflect.get(f.service, 'logger'), 'warn').mockImplementation();
    f.prisma.storyVisualPrompt.findMany.mockResolvedValue([]);
    f.prisma.storyAiGeneratedScene.findFirst.mockResolvedValue({ id: sceneId });
    jest.spyOn(f.service, 'registerGeneratedContinuationPrompt').mockRejectedValue(new Error('private detail'));
    f.prisma.storyAiGeneratedScene.findFirst.mockResolvedValueOnce({ id: sceneId });
    f.prisma.storyAiGeneratedScene.findFirst.mockResolvedValueOnce({
      id: sceneId, continuationId: generatedSceneKey.slice(3), title: { ko: '갈림길' },
    });
    f.prisma.storyAiGeneratedBeat.findMany.mockResolvedValue([]);

    await expect(f.service.promptKeys(workId, releaseId, [generatedSceneKey]))
      .resolves.toEqual(new Set());
    expect(f.prisma.storyVisualPrompt.findUnique).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith({
      event: 'story_visual_prompt_recovery_failed', workId,
      sourceSceneKey: generatedSceneKey, code: 'PROMPT_REGISTRATION_FAILED',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private detail');
  });

  it('keeps a transient recovery lookup error from breaking the scene read', async () => {
    const f = fixture();
    const generatedSceneKey = 'ai-00000000-0000-4000-8000-000000000008';
    const warn = jest.spyOn(Reflect.get(f.service, 'logger'), 'warn').mockImplementation();
    f.prisma.storyVisualPrompt.findMany.mockResolvedValue([]);
    f.prisma.storyAiGeneratedScene.findFirst.mockRejectedValue(new Error('private database detail'));

    await expect(f.service.promptKeys(workId, releaseId, [generatedSceneKey]))
      .resolves.toEqual(new Set());
    expect(warn).toHaveBeenCalledWith({
      event: 'story_visual_prompt_recovery_failed', workId,
      sourceSceneKey: generatedSceneKey, code: 'PROMPT_REGISTRATION_FAILED',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private database detail');
  });

  it('generates an exact admin sample without requiring reader progress', async () => {
    const f = fixture(false);
    const provider = jest.spyOn(global, 'fetch');

    await expect(f.service.generateSample(workId, {
      releaseId,
      releaseChecksum: checksum,
      sourceSceneKey,
    })).resolves.toEqual({ status: 'unavailable', reason: 'generation_disabled' });

    expect(f.prisma.storyReaderProgress.findFirst).not.toHaveBeenCalled();
    expect(f.prisma.storyVisualPrompt.findUnique).toHaveBeenCalledWith({
      where: { workId_releaseId_sourceSceneKey: { workId, releaseId, sourceSceneKey } },
    });
    expect(provider).not.toHaveBeenCalled();
  });

  it('authorizes the exact generated scene owned by the active reader progress', async () => {
    const f = fixture(false);
    const generatedSceneId = '00000000-0000-4000-8000-000000000007';
    const generatedSceneKey = 'ai-reader-route-0001';
    f.prisma.storyReaderProgress.findFirst.mockResolvedValue({
      workId,
      currentSceneId: null,
      currentGeneratedSceneId: generatedSceneId,
      activeReleaseId: releaseId,
    });
    f.prisma.storyAiGeneratedScene.findFirst.mockResolvedValue({ id: generatedSceneId, continuationId: 'continuation-id',
      workId, releaseId, userId: 'user-id' });
    f.prisma.storyAiContinuation.findFirst.mockResolvedValue({ contextReferences: {} });

    await expect(f.service.requestForProgress('user-id', progressId, generatedSceneKey))
      .resolves.toEqual({ status: 'unavailable', reason: 'generation_disabled' });
    expect(f.prisma.storyAiGeneratedScene.findFirst).toHaveBeenCalledWith({
      where: {
        id: generatedSceneId,
        progressId,
        userId: 'user-id',
        workId,
        releaseId,
        sceneKey: generatedSceneKey,
        status: 'ready',
      },
      select: { id: true },
    });
  });

  it('recovers a missing prompt from an already stored generated scene without regenerating prose', async () => {
    const f = fixture(false);
    const generatedSceneId = '00000000-0000-4000-8000-000000000007';
    const continuationId = '00000000-0000-4000-8000-000000000008';
    const generatedSceneKey = 'ai-reader-route-0001';
    f.prisma.storyReaderProgress.findFirst.mockResolvedValue({
      workId, currentSceneId: null, currentGeneratedSceneId: generatedSceneId, activeReleaseId: releaseId,
    });
    f.prisma.storyAiGeneratedScene.findFirst
      .mockResolvedValueOnce({ id: generatedSceneId })
      .mockResolvedValueOnce({ id: generatedSceneId, continuationId, title: { ko: '다른 길' } })
      .mockResolvedValue({ id: generatedSceneId, continuationId, workId, releaseId, userId: 'user-id' });
    f.prisma.storyAiContinuation.findFirst.mockResolvedValue({ contextReferences: {} });
    f.prisma.storyAiGeneratedBeat.findMany.mockResolvedValue([
      { beatType: 'paragraph', content: { ko: '새 이야기가 시작됐다.' } },
    ]);
    f.prisma.storyVisualPrompt.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ workId, releaseId, releaseChecksum: checksum,
        sourceSceneKey: generatedSceneKey, promptSha256,
        promptText: 'A sufficiently detailed private scene image direction.' });
    const register = jest.spyOn(f.service, 'registerGeneratedContinuationPrompt')
      .mockResolvedValue({ created: true } as never);

    await expect(f.service.requestForProgress('user-id', progressId, generatedSceneKey))
      .resolves.toEqual({ status: 'unavailable', reason: 'generation_disabled' });
    expect(register).toHaveBeenCalledWith(continuationId, {
      title: { ko: '다른 길' },
      beats: [{ beatType: 'paragraph', content: { ko: '새 이야기가 시작됐다.' } }],
    });
  });

  it('separates participant visuals and sends the cover plus approved artist references', async () => {
    const f = fixture();
    f.prisma.storyWork.findFirst.mockResolvedValue({
      id: workId,
      activeReleaseId: releaseId,
      slug: 'the-monster-that-did-not-eat-my-name',
      title: { ko: '내 이름을 먹지 않은 괴물' },
      summary: { ko: '기억과 이름을 되찾는 이야기' },
    });
    const participantFingerprint = 'c'.repeat(64);
    const reference = await sharp({
      create: { width: 96, height: 96, channels: 3, background: { r: 24, g: 48, b: 72 } },
    }).webp().toBuffer();
    const generated = await sharp({
      create: { width: 1536, height: 1024, channels: 3, background: { r: 12, g: 18, b: 30 } },
    }).webp().toBuffer();
    const referenceChecksum = createHash('sha256').update(reference).digest('hex');
    const participants = {
      visualReferences: jest.fn().mockResolvedValue({
        participantFingerprint,
        artistId: 'artist-id',
        references: [{
          assetId: 'reference-id',
          checksum: referenceChecksum,
          storageProvider: 'r2',
          storageKey: 'artists/reference.webp',
          mimeType: 'image/webp',
          fileSizeBytes: reference.length,
        }],
      }),
    };
    const storage = { getObject: jest.fn().mockResolvedValue(reference) };
    const service = new StoryVisualGenerationService(
      f.prisma,
      f.config as never,
      undefined,
      participants as never,
      storage as never,
    );
    const provider = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ b64_json: generated.toString('base64') }] }),
      } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);

    await expect(service.requestForProgress('user-id', progressId, sourceSceneKey))
      .resolves.toMatchObject({ status: 'ready', sourceSceneKey });

    expect(participants.visualReferences).toHaveBeenCalledWith(progressId);
    expect(storage.getObject).toHaveBeenCalledWith({
      storageProvider: 'r2',
      storageKey: 'artists/reference.webp',
      expectedBytes: reference.length,
    });
    expect(provider.mock.calls[0][0]).toBe('https://api.openai.com/v1/images/edits');
    const form = provider.mock.calls[0][1]?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.getAll('image[]')).toHaveLength(2);
    expect(String(form.get('prompt'))).toContain('approved published story cover');
    expect(String(form.get('prompt'))).toContain('approved identity references');
    const variantKey = `artist:${participantFingerprint}`;
    const variantPathKey = createHash('sha256').update(variantKey).digest('hex').slice(0, 16);
    expect(String(provider.mock.calls[1][0])).toContain(`/${variantPathKey}-`);
    expect(f.prisma.storyVisualGeneration.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ variantKey }),
    });
    expect(f.prisma.asset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          storyVisual: expect.objectContaining({
            variantKey: `artist:${participantFingerprint}`,
            participantFingerprint,
          }),
        }),
      }),
    });
  });

  it('uses the published fixed-route cover as the master visual reference', async () => {
    const f = fixture();
    f.prisma.storyWork.findFirst.mockResolvedValue({
      id: workId,
      activeReleaseId: releaseId,
      slug: 'the-monster-that-did-not-eat-my-name',
      title: { ko: '내 이름을 먹지 않은 괴물' },
      summary: { ko: '기억과 이름을 되찾는 이야기' },
    });
    const generated = await sharp({
      create: { width: 1536, height: 1024, channels: 3, background: '#17232f' },
    }).webp().toBuffer();
    const provider = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ b64_json: generated.toString('base64') }] }),
      } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);

    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey))
      .resolves.toMatchObject({ status: 'ready', sourceSceneKey });

    expect(provider.mock.calls[0][0]).toBe('https://api.openai.com/v1/images/edits');
    const form = provider.mock.calls[0][1]?.body as FormData;
    expect(form.getAll('image[]')).toHaveLength(1);
    expect(form.get('model')).toBe('gpt-image-2');
    expect(form.get('quality')).toBe('high');
    expect(form.has('n')).toBe(false);
    expect(form.has('input_fidelity')).toBe(false);
    expect(String(form.get('prompt'))).toContain('approved published story cover');
    expect(String(form.get('prompt'))).toContain('Match the published cover identity');
    expect((form.get('image[]') as File).type).toBe('image/png');
    expect(f.prisma.asset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          storyVisual: expect.objectContaining({
            workVisualReferenceChecksum: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        }),
      }),
    });
  });

  it('calls the provider once, persists the result, and reuses it on the next request', async () => {
    const f = fixture();
    const image = await sharp({
      create: { width: 1536, height: 1024, channels: 3, background: '#334455' },
    }).webp().toBuffer();
    const provider = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ b64_json: image.toString('base64') }] }) } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);

    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toEqual({
      status: 'ready', sourceSceneKey,
      publicAssetPath: `/api/v1/story-visual-assets/${assetId}`, reused: false,
    });
    const storedMetadata = f.prisma.asset.create.mock.calls[0][0].data.metadata;
    f.prisma.asset.findFirst.mockResolvedValue({ id: assetId, metadata: storedMetadata });
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toEqual({
      status: 'ready', sourceSceneKey,
      publicAssetPath: `/api/v1/story-visual-assets/${assetId}`, reused: true,
    });
    expect(provider).toHaveBeenCalledTimes(2);
    const providerBody = JSON.parse(String((provider.mock.calls[0][1] as RequestInit).body));
    expect(providerBody.prompt).toContain('[PRIVATE VISUAL BIBLE story-visual-bible-v5]');
    expect(providerBody.prompt).toContain('[RECURRING CHARACTER APPEARANCE LOCK]');
    expect(providerBody.prompt).toContain('Joseon naval historical drama');
    expect(providerBody.prompt).toContain('이순신은 늘 같은 검은 수염과 붉은 철릭');
    expect(providerBody.prompt).toContain('A sufficiently detailed private scene image direction.');
    expect(f.prisma.storyVisualGeneration.create).toHaveBeenCalledTimes(1);
    expect(f.prisma.asset.create).toHaveBeenCalledTimes(1);
    expect(storedMetadata.storyVisual).toMatchObject({
      visualBibleVersion: 'story-visual-bible-v5',
      visualBibleFingerprint: expect.stringMatching(/^[a-f0-9]{20}$/),
      effectivePromptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(storedMetadata)).not.toContain('A sufficiently detailed private scene image direction.');
    expect(JSON.stringify(storedMetadata)).not.toContain('Joseon naval historical drama');
    expect(f.generation()).toMatchObject({ status: 'ready', attemptCount: 1, assetId });

    storedMetadata.storyVisual.visualBibleFingerprint = '0'.repeat(20);
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toEqual({
      status: 'unavailable', reason: 'visual_identity_changed',
    });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('transmits the current visual approval once, reuses it, and refuses images from a later approval identity', async () => {
    const f = reviewedVisualFixture();
    const image = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#456745' } }).webp().toBuffer();
    const provider = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ b64_json: image.toString('base64') }] }) } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'ready', reused: false });
    const body = JSON.parse(String(provider.mock.calls[0][1]?.body));
    expect(body.prompt).toContain('Charcoal illustration'); expect(body.prompt).toContain('Archivist: Adult woman');
    expect(body.prompt).not.toMatch(/OLD STYLE|OLD FACE|Joseon naval historical drama/);
    const metadata = f.prisma.asset.create.mock.calls[0][0].data.metadata;
    f.prisma.asset.findFirst.mockResolvedValue({ id: assetId, metadata });
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'ready', reused: true });
    f.profile.reviewRevision++;
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({
      status: 'unavailable', reason: 'visual_identity_changed' });
    expect(provider).toHaveBeenCalledTimes(2); expect(f.prisma.asset.create).toHaveBeenCalledTimes(1);
  });

  function sceneGuidanceFixture() {
    const f = reviewedVisualFixture();
    f.setConfig('STORY_IMAGE_QUEUE_RELEASES', JSON.stringify([{ workId, releaseId, releaseChecksum: checksum }]));
    const originalPrompt = 'A sufficiently detailed private scene image direction.';
    const guide = { batchId: '00000000-0000-4000-8000-000000000012', batchChecksum: 'a'.repeat(64),
      profilePinHash: 'c'.repeat(64), manuscriptVersionId: f.profile.manuscriptVersionId, manuscriptHash: 'c'.repeat(64),
      sourceChecksum: 'e'.repeat(64), referenceIndex: 0, sourceSceneKey,
      originalPromptSha256: createHash('sha256').update(originalPrompt).digest('hex'),
      promptText: 'SCENE_GUIDANCE_APPROVED_ONLY: the archivist closes the green ledger before dawn.',
      promptSha256: 'd'.repeat(64), bindingSha256: 'f'.repeat(64), approvedAt: new Date(0).toISOString() };
    f.visualReviews.approvedForPublishedSource.mockImplementation(async () => structuredClone(guide));
    const image = Buffer.from('synthetic-image-provider-result-not-a-quality-verification');
    const draw = jest.spyOn(f.service as any, 'generateImage').mockImplementation(async (...args: any[]) => {
      await args[6]?.(async () => ({ ok: true }) as Response, new AbortController().signal); return image;
    });
    const upload = jest.spyOn(f.service as any, 'uploadImage').mockResolvedValue({ provider: 'r2', key: objectStorageKey });
    return { ...f, guide, originalPrompt, draw, upload, image };
  }

  async function reserveGuidance(f: ReturnType<typeof sceneGuidanceFixture>) {
    const candidate = { workId, releaseId, releaseChecksum: checksum, sourceSceneKey, promptSha256, priority: 'authored_remaining' };
    const identity = await (f.service as any).bookQueuedVisual(candidate, f.prisma);
    expect(identity).not.toBeNull();
    f.setGeneration({ id: 'generation-id', workId, releaseId, releaseChecksum: checksum, sourceSceneKey,
      promptSha256, variantKey: 'default', status: 'pending', attemptCount: 0, updatedAt: new Date(), assetId: null,
      bookingIdentity: identity });
    return identity;
  }

  it('does not let a reader holding an old unbound row consume a newly recovered booking', async () => {
    const f = sceneGuidanceFixture(), booking = await reserveGuidance(f);
    f.setGeneration({ ...f.generation(), bookingIdentity: null });
    const ensure = (f.service as any).ensureGeneration.bind(f.service);
    jest.spyOn(f.service as any, 'ensureGeneration').mockImplementationOnce(async (...args: any[]) => {
      const old = { ...await ensure(...args) };
      f.setGeneration({ ...f.generation(), bookingIdentity: booking, updatedAt: new Date() });
      return old;
    });
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'processing' });
    expect(f.generation()).toMatchObject({ status: 'pending', attemptCount: 0, bookingIdentity: booking });
    expect(f.draw).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled(); expect(f.prisma.asset.create).not.toHaveBeenCalled();
  });

  it('binds queue admission to exact current approval and reuses a matching ready image without regenerating', async () => {
    const f = sceneGuidanceFixture(), booking = await reserveGuidance(f);
    expect(JSON.stringify(booking)).not.toContain(f.guide.promptText);
    expect(f.draw).not.toHaveBeenCalled();
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'ready', reused: false });
    const metadata = f.prisma.asset.create.mock.calls[0][0].data.metadata;
    expect(metadata.storyVisual.bookingIdentitySha256).toBe(booking.identitySha256);
    f.prisma.asset.findFirst.mockResolvedValue({ id: assetId, metadata });
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'ready', reused: true });
    expect(f.draw).toHaveBeenCalledTimes(1);
    expect(f.generation().bookingIdentity).toEqual(booking);
  });

  it('pauses a booked added release withdrawn before claim, without spending or changing its frozen identity', async () => {
    const f = sceneGuidanceFixture(), booking = await reserveGuidance(f), before = structuredClone(f.generation());
    f.setConfig('STORY_IMAGE_QUEUE_RELEASES', '[]');
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toEqual({
      status: 'unavailable', reason: 'visual_queue_scope_unavailable' });
    expect(f.generation()).toEqual(before); expect(f.draw).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
    f.setConfig('STORY_IMAGE_QUEUE_RELEASES', JSON.stringify([{ workId, releaseId, releaseChecksum: checksum }]));
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'ready' });
    expect(f.generation().bookingIdentity).toEqual(booking);
  });

  it.each(['dispatch', 'storage'])('rechecks exact added scope during %s and never promotes a withdrawn reservation', async when => {
    const f = sceneGuidanceFixture(); await reserveGuidance(f);
    const withdraw = () => f.setConfig('STORY_IMAGE_QUEUE_RELEASES', '[]');
    if (when === 'dispatch') {
      const update = f.prisma.storyVisualGeneration.updateMany.getMockImplementation()!;
      f.prisma.storyVisualGeneration.updateMany.mockImplementationOnce(async (args: any) => { const result = await update(args); withdraw(); return result; });
    } else f.upload.mockImplementation(async () => { withdraw(); return { provider: 'r2', key: objectStorageKey }; });
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({
      status: 'failed', retryable: when === 'dispatch' });
    expect(f.generation()).toMatchObject({ status: when === 'dispatch' ? 'pending' : 'failed',
      lastErrorCode: when === 'dispatch' ? null : 'STORY_VISUAL_QUEUE_SCOPE_UNAVAILABLE',
      attemptCount: when === 'dispatch' ? 0 : 1, assetId: null });
    if (when === 'dispatch') expect(f.generation()).toMatchObject({ provider: null, model: null, quality: null, size: null });
    expect(f.prisma.asset.create).not.toHaveBeenCalled(); expect(f.upload).toHaveBeenCalledTimes(when === 'dispatch' ? 0 : 1);
  });

  it.each(['dispatch', 'promotion'])('checks target withdrawal after the %s claim-lock wait', async when => {
    const f = sceneGuidanceFixture(), booking = await reserveGuidance(f);
    let locks = 0;
    f.prisma.$queryRaw.mockImplementation(async (query: any) => {
      if (query.strings.join('').includes('story_visual_generations') && ++locks === (when === 'dispatch' ? 1 : 2)) {
        f.setConfig('STORY_IMAGE_QUEUE_RELEASES', '[]');
      }
      return [];
    });
    const dispatch = jest.fn(async () => ({ ok: true }) as Response);
    f.draw.mockImplementation(async (...args: any[]) => { await args[6](dispatch, new AbortController().signal); return f.image; });
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'failed' });
    expect(dispatch).toHaveBeenCalledTimes(when === 'dispatch' ? 0 : 1); expect(f.prisma.asset.create).not.toHaveBeenCalled();
    expect(f.generation()).toMatchObject({ status: when === 'dispatch' ? 'pending' : 'failed',
      attemptCount: when === 'dispatch' ? 0 : 1, bookingIdentity: booking });
    if (when === 'dispatch') {
      f.setConfig('STORY_IMAGE_QUEUE_RELEASES', JSON.stringify([{ workId, releaseId, releaseChecksum: checksum }]));
      await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'ready' });
      expect(dispatch).toHaveBeenCalledTimes(1); expect(f.generation().attemptCount).toBe(1);
    }
  });

  it('rechecks target eligibility after asset writes before the promotion transaction commits', async () => {
    const f = sceneGuidanceFixture(); await reserveGuidance(f);
    f.prisma.asset.create.mockImplementation(async () => {
      f.setConfig('STORY_IMAGE_QUEUE_RELEASES', '[]'); return { id: assetId };
    });
    // A real transaction rollback is covered by PostgreSQL; this fixture only checks the final guard.
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'failed', retryable: false });
    expect(f.draw).toHaveBeenCalledTimes(1);
  });

  it.each(['historical-provider', ''])('never clears a pre-existing provider footprint when pausing scope: %j', async provider => {
    const f = sceneGuidanceFixture(); await reserveGuidance(f); f.setGeneration({ ...f.generation(), provider });
    const update = f.prisma.storyVisualGeneration.updateMany.getMockImplementation()!;
    f.prisma.storyVisualGeneration.updateMany.mockImplementationOnce(async (args: any) => {
      const result = await update(args); f.setConfig('STORY_IMAGE_QUEUE_RELEASES', '[]'); return result;
    });
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'failed' });
    expect(f.generation()).toMatchObject({ status: 'failed', provider: 'openai', lastErrorCode: 'STORY_VISUAL_QUEUE_SCOPE_UNAVAILABLE' });
    expect(f.upload).not.toHaveBeenCalled();
  });

  it('keeps a valid completed image reusable after queue target withdrawal without paying again', async () => {
    const f = sceneGuidanceFixture(); await reserveGuidance(f);
    await f.service.requestForProgress('user-id', progressId, sourceSceneKey);
    const metadata = f.prisma.asset.create.mock.calls[0][0].data.metadata;
    f.prisma.asset.findFirst.mockResolvedValue({ id: assetId, metadata }); f.setConfig('STORY_IMAGE_QUEUE_RELEASES', '[]');
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'ready', reused: true });
    expect(f.draw).toHaveBeenCalledTimes(1); expect(f.upload).toHaveBeenCalledTimes(1);
  });

  it('does not let queue target configuration bypass the separate public-beta gate', async () => {
    const f = sceneGuidanceFixture(), booking = await reserveGuidance(f);
    Reflect.set(f.service, 'publicBeta', { allows: () => false });
    const candidate = { workId, releaseId, releaseChecksum: checksum, sourceSceneKey, promptSha256, priority: 'authored_remaining' };
    await expect((f.service as any).bookQueuedVisual(candidate, f.prisma)).resolves.toBeNull();
    await expect((f.service as any).generate(workId, releaseId, checksum, sourceSceneKey, undefined, false, undefined, booking))
      .resolves.toMatchObject({ status: 'unavailable', reason: 'visual_queue_scope_unavailable' });
    expect(f.draw).not.toHaveBeenCalled(); expect(f.prisma.asset.create).not.toHaveBeenCalled();
  });

  it.each(['author', 'guide', 'representative', 'model', 'cover'])('will not silently rebind a queued image when its %s changes', async kind => {
    const f = sceneGuidanceFixture();
    const representative = { id: '00000000-0000-4000-8000-000000000014', selectionVersion: 1,
      selectionChecksum: '9'.repeat(64), partKey: 'part-001', targetSceneKey: 'part-001-main' };
    Object.assign(f.guide, { partSelection: representative });
    const booking = await reserveGuidance(f);
    if (kind === 'author') f.profile.reviewRevision++;
    if (kind === 'guide') f.guide.batchId = '00000000-0000-4000-8000-000000000015';
    if (kind === 'representative') representative.selectionVersion++;
    if (kind === 'model') f.setConfig('OPENAI_IMAGE_MODEL', 'gpt-image-1.5');
    if (kind === 'cover') {
      const current = await f.prisma.storyWork.findFirst();
      f.prisma.storyWork.findFirst.mockResolvedValue({ ...current, coverManifest: { changed: true } });
    }
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toEqual({ status: 'unavailable', reason: 'visual_booking_changed' });
    expect(f.generation()).toMatchObject({ status: 'failed', attemptCount: 0, bookingIdentity: booking, lastErrorCode: 'STORY_VISUAL_BOOKING_CHANGED' });
    expect(f.draw).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
  });

  it('does not turn a spent storage failure into a new paid operation under a later author approval', async () => {
    const f = sceneGuidanceFixture(); await reserveGuidance(f);
    f.setGeneration({ ...f.generation(), status: 'failed', attemptCount: 1, lastErrorCode: 'OBJECT_STORAGE_403' });
    f.profile.reviewRevision++;
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'unavailable', reason: 'visual_booking_changed' });
    expect(f.generation().attemptCount).toBe(1); expect(f.draw).not.toHaveBeenCalled();
  });

  it('refuses a tampered booking on ready returns, reader projection and direct asset delivery', async () => {
    const f = sceneGuidanceFixture(); await reserveGuidance(f);
    await f.service.requestForProgress('user-id', progressId, sourceSceneKey);
    const metadata = f.prisma.asset.create.mock.calls[0][0].data.metadata;
    f.prisma.asset.findFirst.mockResolvedValue({ id: assetId, metadata, storageProvider: 'r2', storageKey: objectStorageKey,
      mimeType: 'image/webp', checksum: createHash('sha256').update(f.image).digest('hex') });
    f.generation().bookingIdentity.sceneGuidanceApprovalSha256 = 'f'.repeat(64);
    f.prisma.storyVisualGeneration.findMany.mockResolvedValue([f.generation()]);
    f.prisma.asset.findMany.mockResolvedValue([{ id: assetId, metadata }]);
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'unavailable', reason: 'visual_identity_changed' });
    await expect(f.service.readyVisuals(workId, releaseId, [sourceSceneKey])).resolves.toEqual(new Map());
    await expect(f.service.publicVisualAsset(assetId)).rejects.toBeInstanceOf(NotFoundException);
    expect(f.draw).toHaveBeenCalledTimes(1);
  });

  it('does not promote a late provider completion after another worker marks its claim uncertain', async () => {
    const f = sceneGuidanceFixture(); await reserveGuidance(f);
    f.upload.mockImplementation(async () => {
      f.setGeneration({ ...f.generation(), status: 'failed', lastErrorCode: 'PROVIDER_OUTCOME_UNKNOWN', startedAt: null });
      return { provider: 'r2', key: objectStorageKey };
    });
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'failed', retryable: false });
    expect(f.generation()).toMatchObject({ status: 'failed', lastErrorCode: 'PROVIDER_OUTCOME_UNKNOWN', attemptCount: 1, assetId: null });
    expect(f.prisma.asset.create).not.toHaveBeenCalled(); expect(f.draw).toHaveBeenCalledTimes(1);
  });

  it('requires matching generation binding even when a concurrent creator wins the unique row', async () => {
    const f = fixture();
    const conflict = new Prisma.PrismaClientKnownRequestError('collision', { code: 'P2002', clientVersion: '6' });
    f.prisma.storyVisualGeneration.create.mockRejectedValue(conflict);
    f.prisma.storyVisualGeneration.findUniqueOrThrow.mockResolvedValue({ promptSha256, releaseChecksum: 'f'.repeat(64) });
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).rejects.toMatchObject({
      response: { code: 'STORY_VISUAL_PROMPT_GENERATION_MISMATCH' } });
  });

  it.each([false, true])('retires an obsolete booking only if its generating claim has expired: %s', async expired => {
    const f = sceneGuidanceFixture(), booking = await reserveGuidance(f);
    f.setGeneration({ ...f.generation(), status: 'generating', attemptCount: 1,
      startedAt: new Date(0), updatedAt: expired ? new Date(0) : new Date() });
    f.profile.reviewRevision++;
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'unavailable', reason: 'visual_booking_changed' });
    expect(f.generation()).toMatchObject({ status: expired ? 'failed' : 'generating', attemptCount: 1, bookingIdentity: booking });
    expect(f.draw).not.toHaveBeenCalled();
  });

  it.each(['dispatch', 'storage'])('rejects a booking row changed during %s without promoting or dispatching a different reservation', async when => {
    const f = sceneGuidanceFixture(), booking = await reserveGuidance(f);
    const tamper = () => f.setGeneration({ ...f.generation(), bookingIdentity: { ...booking, quality: 'low' } });
    if (when === 'dispatch') {
      const update = f.prisma.storyVisualGeneration.updateMany.getMockImplementation()!;
      f.prisma.storyVisualGeneration.updateMany.mockImplementationOnce(async (args: any) => { const result = await update(args); tamper(); return result; });
    } else f.upload.mockImplementation(async () => { tamper(); return { provider: 'r2', key: objectStorageKey }; });
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'failed', retryable: when === 'dispatch' });
    expect(f.prisma.asset.create).not.toHaveBeenCalled();
    expect(f.generation().attemptCount).toBe(when === 'dispatch' ? 0 : 1);
  });

  it('recovers the old result booking after a crashed explicit replacement and reuses it when its approval is restored', async () => {
    const f = sceneGuidanceFixture(), originalBooking = await reserveGuidance(f);
    await f.service.requestForProgress('user-id', progressId, sourceSceneKey);
    const metadata = f.prisma.asset.create.mock.calls[0][0].data.metadata;
    expect(metadata.storyVisual.bookingIdentity).toEqual(originalBooking);
    f.prisma.asset.findFirst.mockResolvedValue({ id: assetId, metadata });
    f.profile.reviewRevision++;
    const effective = await (f.service as any).effectiveVisualPrompt(workId, releaseId, checksum, f.originalPrompt, sourceSceneKey);
    const newBooking = (f.service as any).bookingBasis(await f.prisma.storyVisualPrompt.findUnique(), effective);
    f.setGeneration({ ...f.generation(), bookingIdentity: newBooking, updatedAt: new Date(0), startedAt: new Date(0),
      lastErrorCode: 'STALE_REPLACEMENT_IN_PROGRESS_' + 'f'.repeat(40) });
    await expect(f.service.replaceStale(workId, { releaseId, releaseChecksum: checksum, sourceSceneKey }))
      .resolves.toMatchObject({ status: 'failed', retryable: false });
    expect(f.generation().bookingIdentity).toEqual(originalBooking);
    f.profile.reviewRevision--;
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'ready', reused: true });
    expect(f.draw).toHaveBeenCalledTimes(1);
  });

  it('uses only the exact author-approved scene guide, retains immutable canonical prompts and reuses a current image without another provider call', async () => {
    const f = sceneGuidanceFixture();
    const original = JSON.stringify(await f.prisma.storyVisualPrompt.findUnique());
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'ready', reused: false });
    expect(f.draw.mock.calls[0][0]).toContain(f.guide.promptText);
    expect(f.draw.mock.calls[0][0]).not.toContain(f.originalPrompt);
    const metadata = f.prisma.asset.create.mock.calls[0][0].data.metadata;
    expect(metadata.storyVisual.sceneGuidanceApproval).toMatchObject({ batchId: f.guide.batchId,
      originalPromptSha256: f.guide.originalPromptSha256, profilePinHash: f.guide.profilePinHash });
    expect(metadata.storyVisual.sceneGuidanceApprovalSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(metadata)).not.toContain(f.guide.promptText);
    expect(JSON.stringify(await f.prisma.storyVisualPrompt.findUnique())).toBe(original);
    expect(f.prisma.storyVisualPrompt.create).not.toHaveBeenCalled();
    f.prisma.asset.findFirst.mockResolvedValue({ id: assetId, metadata });
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'ready', reused: true });
    expect(f.draw).toHaveBeenCalledTimes(1); expect(f.upload).toHaveBeenCalledTimes(1);
    expect(f.visualReviews.approvedForPublishedSource).toHaveBeenCalledWith(f.prisma, workId, releaseId, checksum,
      sourceSceneKey, f.guide.originalPromptSha256);
    f.guide.batchId = '00000000-0000-4000-8000-000000000013';
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({
      status: 'unavailable', reason: 'visual_identity_changed' });
    expect(f.draw).toHaveBeenCalledTimes(1);
  });

  it('withholds ready image and paid-image controls for a newer unapproved scene draft while preserving prose delivery', async () => {
    const f = sceneGuidanceFixture();
    await f.service.requestForProgress('user-id', progressId, sourceSceneKey);
    const metadata = f.prisma.asset.create.mock.calls[0][0].data.metadata;
    f.prisma.storyVisualGeneration.findMany.mockResolvedValue([{ sourceSceneKey, assetId, releaseChecksum: checksum, promptSha256 }]);
    f.prisma.asset.findMany.mockResolvedValue([{ id: assetId, metadata }]);
    f.visualReviews.approvedForPublishedSource.mockRejectedValue(new ConflictException({ code: 'STUDIO_VISUAL_REVIEW_APPROVAL_REQUIRED' }));
    await expect(f.service.readyVisuals(workId, releaseId, [sourceSceneKey])).resolves.toEqual(new Map());
    await expect(f.service.promptKeys(workId, releaseId, [sourceSceneKey])).resolves.toEqual(new Set());
    expect(f.draw).toHaveBeenCalledTimes(1); expect(f.upload).toHaveBeenCalledTimes(1);
  });

  it('rechecks scene approval on direct asset delivery instead of redirecting an obsolete image', async () => {
    const f = sceneGuidanceFixture();
    await f.service.requestForProgress('user-id', progressId, sourceSceneKey);
    const metadata = f.prisma.asset.create.mock.calls[0][0].data.metadata;
    f.prisma.asset.findFirst.mockResolvedValue({ id: assetId, metadata, storageProvider: 'r2', storageKey: objectStorageKey,
      mimeType: 'image/webp', checksum: createHash('sha256').update(f.image).digest('hex') });
    await expect(f.service.publicVisualAsset(assetId)).resolves.toMatchObject({ kind: 'redirect' });
    f.guide.batchId = '00000000-0000-4000-8000-000000000013';
    await expect(f.service.publicVisualAsset(assetId)).rejects.toBeInstanceOf(NotFoundException);
    expect(f.draw).toHaveBeenCalledTimes(1);
  });

  it('binds part representative identity to cache reuse even when the chosen guide and prompt remain identical', async () => {
    const f = sceneGuidanceFixture();
    const partSelection = { id: '00000000-0000-4000-8000-000000000014', selectionVersion: 1,
      selectionChecksum: '9'.repeat(64), partKey: 'part-001', targetSceneKey: 'part-001-main' };
    Object.assign(f.guide, { partSelection });
    await f.service.requestForProgress('user-id', progressId, sourceSceneKey);
    const metadata = f.prisma.asset.create.mock.calls[0][0].data.metadata;
    expect(metadata.storyVisual.sceneGuidanceApproval.partSelection).toEqual(partSelection);
    f.prisma.asset.findFirst.mockResolvedValue({ id: assetId, metadata });
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'ready', reused: true });
    partSelection.selectionVersion++; partSelection.selectionChecksum = '8'.repeat(64);
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'unavailable', reason: 'visual_identity_changed' });
    expect(f.draw).toHaveBeenCalledTimes(1);
  });

  it('does not publish an image if part representative selection changes during storage', async () => {
    const f = sceneGuidanceFixture();
    const partSelection = { id: '00000000-0000-4000-8000-000000000014', selectionVersion: 1,
      selectionChecksum: '9'.repeat(64), partKey: 'part-001', targetSceneKey: 'part-001-main' };
    Object.assign(f.guide, { partSelection });
    f.upload.mockImplementationOnce(async () => {
      partSelection.selectionVersion++; partSelection.selectionChecksum = '8'.repeat(64);
      return { provider: 'r2', key: objectStorageKey };
    });
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'failed', retryable: false });
    expect(f.generation().attemptCount).toBe(1); expect(f.prisma.asset.create).not.toHaveBeenCalled();
    expect(f.draw).toHaveBeenCalledTimes(1);
  });

  it('initiates provider dispatch under the shared work lock but releases it before waiting for the response', async () => {
    const f = sceneGuidanceFixture();
    let locked = false, dispatchStarted = false;
    let finishResponse!: (response: Response) => void, reachedDispatch!: () => void;
    const response = new Promise<Response>(resolve => { finishResponse = resolve; });
    const started = new Promise<void>(resolve => { reachedDispatch = resolve; });
    f.prisma.$transaction.mockImplementation(async (run: any) => {
      try { return await run(f.prisma); } finally { locked = false; }
    });
    f.prisma.$queryRaw.mockImplementation(async (query: Prisma.Sql) => {
      if (query.sql.includes('story_works') && query.sql.includes('FOR SHARE')) locked = true;
      return [];
    });
    f.draw.mockImplementationOnce(async (...args: any[]) => {
      await args[6](async () => {
        expect(locked).toBe(true); dispatchStarted = true; reachedDispatch(); return response;
      }, new AbortController().signal);
      return f.image;
    });
    const pending = f.service.requestForProgress('user-id', progressId, sourceSceneKey);
    await started;
    await new Promise(resolve => setImmediate(resolve));
    expect(dispatchStarted).toBe(true); expect(locked).toBe(false);
    finishResponse({ ok: true } as Response);
    await expect(pending).resolves.toMatchObject({ status: 'ready' });
  });

  it('rechecks the selection inside the dispatch lock after unlocked preflight reads have completed', async () => {
    const f = sceneGuidanceFixture();
    let dispatched = false;
    f.draw.mockImplementationOnce(async (...args: any[]) => {
      f.guide.batchId = '00000000-0000-4000-8000-000000000013';
      await args[6](async () => { dispatched = true; return { ok: true } as Response; }, new AbortController().signal);
      return f.image;
    });
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'failed', retryable: true });
    expect(dispatched).toBe(false); expect(f.generation().attemptCount).toBe(0);
    expect(f.prisma.asset.create).not.toHaveBeenCalled();
  });

  it.each(['before_provider', 'during_provider', 'during_storage'])('does not publish an image when the scene approval changes %s', async when => {
    const f = sceneGuidanceFixture();
    const change = () => { f.guide.batchId = '00000000-0000-4000-8000-000000000013'; };
    if (when === 'before_provider') {
      const claim = f.prisma.storyVisualGeneration.updateMany.getMockImplementation();
      f.prisma.storyVisualGeneration.updateMany.mockImplementationOnce(async (args: unknown) => {
        const result = await claim(args); change(); return result;
      });
    }
    if (when === 'during_provider') f.draw.mockImplementationOnce(async (...args: any[]) => {
      await args[6]?.(async () => ({ ok: true }) as Response, new AbortController().signal); change(); return f.image;
    });
    if (when === 'during_storage') f.upload.mockImplementationOnce(async () => { change(); return { provider: 'r2', key: objectStorageKey }; });
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({
      status: 'failed', retryable: when === 'before_provider' });
    expect(f.prisma.asset.create).not.toHaveBeenCalled();
    expect(f.generation().attemptCount).toBe(when === 'before_provider' ? 0 : 1);
    expect(f.draw).toHaveBeenCalledTimes(when === 'before_provider' ? 0 : 1);
    expect(f.upload).toHaveBeenCalledTimes(when === 'during_storage' ? 1 : 0);
  });

  it('rechecks scene approval after artist-reference downloads before making a paid request', async () => {
    const f = sceneGuidanceFixture();
    f.draw.mockRestore();
    const reference = Buffer.from('synthetic-reference-for-preflight-only');
    const references = [{ assetId: assetId, checksum: createHash('sha256').update(reference).digest('hex'),
      storageProvider: 'r2', storageKey: 'artists/fixture.webp', mimeType: 'image/webp', fileSizeBytes: reference.length }];
    const getObject = jest.fn(async () => {
      f.guide.batchId = '00000000-0000-4000-8000-000000000013'; return reference;
    });
    (f.service as any).storage = { getObject };
    (f.service as any).storyParticipants = { visualReferences: jest.fn().mockResolvedValue({
      participantFingerprint: 'c'.repeat(64), references }) };
    const provider = jest.spyOn(global, 'fetch');
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'failed', retryable: true });
    expect(getObject).toHaveBeenCalledTimes(1); expect(provider).not.toHaveBeenCalled();
    expect(f.generation().attemptCount).toBe(0); expect(f.upload).not.toHaveBeenCalled();
    expect(f.prisma.asset.create).not.toHaveBeenCalled();
  });

  it('blocks promotion if the cover manifest changes while the completed image is being uploaded', async () => {
    const f = sceneGuidanceFixture();
    const work = await f.prisma.storyWork.findFirst();
    f.upload.mockImplementationOnce(async () => {
      work.coverManifest = { assetId: '00000000-0000-4000-8000-000000000014' };
      return { provider: 'r2', key: objectStorageKey };
    });
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'failed', retryable: false });
    expect(f.draw).toHaveBeenCalledTimes(1); expect(f.upload).toHaveBeenCalledTimes(1);
    expect(f.generation().attemptCount).toBe(1); expect(f.prisma.asset.create).not.toHaveBeenCalled();
  });

  it('does not assemble a prompt from different cover-manifest revisions', async () => {
    const f = sceneGuidanceFixture();
    const work = await f.prisma.storyWork.findFirst();
    jest.spyOn(f.service as any, 'approvedStoryCoverReference').mockImplementationOnce(async () => {
      work.coverManifest = { assetId: '00000000-0000-4000-8000-000000000014' }; return null;
    });
    await expect((f.service as any).effectiveVisualPrompt(workId, releaseId, checksum, f.originalPrompt, sourceSceneKey))
      .rejects.toThrow('STORY_VISUAL_PROFILE_CHANGED');
    expect(f.draw).not.toHaveBeenCalled(); expect(f.prisma.asset.create).not.toHaveBeenCalled();
  });

  it.each(['before_provider', 'during_provider', 'during_storage'])('does not publish a visual when approval changes %s', async when => {
    const f = reviewedVisualFixture();
    const image = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#456745' } }).webp().toBuffer();
    const provider = jest.spyOn(global, 'fetch').mockImplementationOnce(async () => {
      if (when === 'during_provider') f.profile.reviewRevision++;
      return { ok: true, json: async () => ({ data: [{ b64_json: image.toString('base64') }] }) } as Response;
    }).mockImplementationOnce(async () => {
      if (when === 'during_storage') f.profile.reviewRevision++;
      return { ok: true } as Response;
    });
    if (when === 'before_provider') {
      const claim = f.prisma.storyVisualGeneration.updateMany.getMockImplementation();
      f.prisma.storyVisualGeneration.updateMany.mockImplementationOnce(async (args: unknown) => {
        const result = await claim(args); f.profile.reviewRevision++; return result;
      });
    }
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'failed', retryable: when === 'before_provider' });
    expect(f.prisma.asset.create).not.toHaveBeenCalled();
    expect(f.generation()).toMatchObject({ status: 'failed', lastErrorCode: 'STORY_VISUAL_PROFILE_CHANGED' });
    expect(f.generation().attemptCount).toBe(when === 'before_provider' ? 0 : 1);
    expect(provider).toHaveBeenCalledTimes(when === 'before_provider' ? 0 : when === 'during_provider' ? 1 : 2);
  });

  it('allows a zero-provider approval race to retry under the next valid author approval', async () => {
    const f = reviewedVisualFixture();
    const claim = f.prisma.storyVisualGeneration.updateMany.getMockImplementation();
    f.prisma.storyVisualGeneration.updateMany.mockImplementationOnce(async (args: unknown) => {
      const result = await claim(args); f.profile.reviewRevision++; return result;
    });
    const image = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#456745' } }).webp().toBuffer();
    const provider = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ b64_json: image.toString('base64') }] }) } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'failed', retryable: true });
    expect(provider).not.toHaveBeenCalled(); expect(f.generation().attemptCount).toBe(0);
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'ready', reused: false });
    expect(provider).toHaveBeenCalledTimes(2); expect(f.generation().attemptCount).toBe(1);
  });

  it('blocks an analysed-profile transition that starts during a legacy provider call', async () => {
    const f = fixture();
    f.setConfig('OPENAI_STORY_SCENE_IMAGE_SIZE', '1024x1536');
    const image = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#456745' } }).webp().toBuffer();
    const provider = jest.spyOn(global, 'fetch').mockImplementationOnce(async () => {
      f.prisma.storyWorkGenerationProfile.findFirst.mockResolvedValue({ status: 'needs_review' });
      return { ok: true, json: async () => ({ data: [{ b64_json: image.toString('base64') }] }) } as Response;
    });
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toMatchObject({ status: 'failed' });
    expect(provider).toHaveBeenCalledTimes(1); expect(f.prisma.asset.create).not.toHaveBeenCalled();
  });

  it('does not transmit a historical branch visual snapshot after the author changes or removes its cast', async () => {
    const f = reviewedVisualFixture();
    f.prisma.storyVisualPrompt.findUnique.mockResolvedValue({ workId, releaseId, releaseChecksum: checksum,
      sourceSceneKey, promptSha256, promptText: 'Historical appearance constraints from approval A', sourceKind: 'ai_branch' });
    f.prisma.storyAiGeneratedScene.findFirst.mockResolvedValue({ id: sceneId, continuationId: 'continuation-id' });
    f.prisma.storyAiContinuation.findFirst.mockResolvedValue({ contextReferences: { generationProfilePin: {
      id: f.profile.id, profileVersion: 1, reviewRevision: 1, sourceFingerprint: f.profile.sourceFingerprint,
      approvedFingerprint: f.profile.approvedFingerprint } } });
    f.profile.reviewRevision++;
    const provider = jest.spyOn(global, 'fetch');
    await expect((f.service as any).generate(workId, releaseId, checksum, sourceSceneKey))
      .rejects.toMatchObject({ response: { code: 'STORY_VISUAL_PROFILE_CHANGED' } });
    expect(provider).not.toHaveBeenCalled(); expect(f.generation().attemptCount).toBe(0);
  });

  it('hides paid-image controls for an AI branch bound to an old author approval', async () => {
    const f = reviewedVisualFixture();
    const generatedKey = 'ai-00000000-0000-4000-8000-000000000008';
    f.prisma.storyVisualPrompt.findMany.mockResolvedValue([{ sourceSceneKey: generatedKey, promptText: 'Old author cast', sourceKind: 'ai_branch' }]);
    f.prisma.storyVisualPrompt.findUnique.mockResolvedValue({ id: 'prompt-id', promptText: 'Old author cast', sourceKind: 'ai_branch' });
    f.prisma.storyAiGeneratedScene.findFirst.mockResolvedValue({ id: sceneId, continuationId: generatedKey.slice(3) });
    const snapshot = continuationGenerationProfileSnapshot(f.profile as never);
    f.prisma.storyAiContinuation.findFirst.mockResolvedValue({ contextReferences: { generationProfilePin: snapshot.pin } });
    const recover = jest.spyOn(f.service as any, 'recoverGeneratedContinuationPrompt').mockResolvedValue(undefined);
    await expect(f.service.promptKeys(workId, releaseId, [generatedKey])).resolves.toEqual(new Set([generatedKey]));
    f.profile.reviewRevision++;
    await expect(f.service.promptKeys(workId, releaseId, [generatedKey])).resolves.toEqual(new Set());
    expect(recover).toHaveBeenCalledTimes(1);
    expect(f.prisma.asset.create).not.toHaveBeenCalled();
  });

  it.each(['catalog', 'direct_asset', 'generation_cache'])('checks the branch author pin on a ready-image %s read', async entry => {
    const f = reviewedVisualFixture();
    const snapshot = continuationGenerationProfileSnapshot(f.profile as never);
    const references = { generationProfilePin: { ...snapshot.pin } };
    const promptText = 'A sufficiently detailed private scene image direction.';
    const prompt = { workId, releaseId, releaseChecksum: checksum, sourceSceneKey, promptText, promptSha256, sourceKind: 'ai_branch' };
    f.prisma.storyVisualPrompt.findUnique.mockResolvedValue(prompt);
    f.prisma.storyVisualPrompt.findMany.mockResolvedValue([prompt]);
    f.prisma.storyAiGeneratedScene.findFirst.mockResolvedValue({ id: sceneId, continuationId: 'continuation-id' });
    f.prisma.storyAiContinuation.findFirst.mockResolvedValue({ contextReferences: references, progressId });
    const metadata = await publicAssetBinding(f);
    metadata.storyVisual.size = '1024x1536';
    const asset = { id: assetId, storageProvider: 'r2', storageKey: objectStorageKey, mimeType: 'image/webp',
      fileSizeBytes: 128n, checksum: 'c'.repeat(64), metadata };
    f.prisma.asset.findFirst.mockResolvedValue(asset);
    f.prisma.asset.findMany.mockResolvedValue([asset]);
    const generation = { id: 'generation-id', workId, releaseId, releaseChecksum: checksum, sourceSceneKey,
      promptSha256, status: 'ready', attemptCount: 1, updatedAt: new Date(), assetId, checksumSha256: asset.checksum };
    f.setGeneration(generation);
    f.prisma.storyVisualGeneration.findMany.mockResolvedValue([generation]);
    const provider = jest.spyOn(global, 'fetch');
    if (entry === 'catalog') {
      expect((await f.service.readyVisuals(workId, releaseId, [sourceSceneKey])).size).toBe(1);
      references.generationProfilePin.reviewRevision++;
      expect((await f.service.readyVisuals(workId, releaseId, [sourceSceneKey])).size).toBe(0);
    } else if (entry === 'direct_asset') {
      await expect(f.service.publicVisualAsset(assetId)).resolves.toMatchObject({ kind: 'redirect' });
      references.generationProfilePin.reviewRevision++;
      await expect(f.service.publicVisualAsset(assetId)).rejects.toBeInstanceOf(NotFoundException);
    } else {
      await expect((f.service as any).generate(workId, releaseId, checksum, sourceSceneKey)).resolves.toMatchObject({ status: 'ready', reused: true });
      references.generationProfilePin.reviewRevision++;
      await expect((f.service as any).generate(workId, releaseId, checksum, sourceSceneKey))
        .rejects.toMatchObject({ response: { code: 'STORY_VISUAL_PROFILE_CHANGED' } });
    }
    expect(provider).not.toHaveBeenCalled();
    expect(f.prisma.storyVisualGeneration.updateMany).not.toHaveBeenCalled();
    expect(f.prisma.asset.create).not.toHaveBeenCalled();
  });

  it.each(['initial_ready', 'ordinary_claim', 'replacement_claim'])('does not return stale ready artwork after a concurrent branch pin change (%s)', async timing => {
    const f = reviewedVisualFixture();
    const references = { generationProfilePin: { ...continuationGenerationProfileSnapshot(f.profile as never).pin } };
    const prompt = { workId, releaseId, releaseChecksum: checksum, sourceSceneKey, promptSha256,
      promptText: 'A sufficiently detailed private scene image direction.', sourceKind: 'ai_branch' };
    f.prisma.storyVisualPrompt.findUnique.mockResolvedValue(prompt);
    f.prisma.storyAiGeneratedScene.findFirst.mockResolvedValue({ id: sceneId, continuationId: 'continuation-id' });
    f.prisma.storyAiContinuation.findFirst.mockResolvedValue({ contextReferences: references, progressId });
    const metadata = await publicAssetBinding(f);
    metadata.storyVisual.size = '1024x1536';
    const pending = { id: 'generation-id', workId, releaseId, releaseChecksum: checksum, sourceSceneKey,
      promptSha256, status: 'pending', attemptCount: 0, updatedAt: new Date(), assetId: null, lastErrorCode: null };
    const ready = { ...pending, status: 'ready', attemptCount: 1, assetId };
    f.setGeneration(timing === 'ordinary_claim' ? pending : ready);
    if (timing === 'initial_ready') {
      f.prisma.asset.findFirst.mockImplementation(async () => {
        references.generationProfilePin.reviewRevision++;
        return { id: assetId, metadata };
      });
    } else {
      f.prisma.asset.findFirst.mockResolvedValue({ id: assetId, metadata });
      if (timing === 'replacement_claim') f.prisma.asset.findFirst.mockResolvedValueOnce({ id: assetId, metadata: {} });
      f.prisma.storyVisualGeneration.updateMany.mockImplementationOnce(async () => {
        f.setGeneration(ready);
        references.generationProfilePin.reviewRevision++;
        return { count: 0 };
      });
    }
    const provider = jest.spyOn(global, 'fetch');
    await expect((f.service as any).generate(workId, releaseId, checksum, sourceSceneKey, undefined,
      timing === 'replacement_claim')).rejects.toMatchObject({ response: { code: 'STORY_VISUAL_PROFILE_CHANGED' } });
    expect(provider).not.toHaveBeenCalled();
    expect(f.prisma.asset.create).not.toHaveBeenCalled();
    expect(f.generation()).toMatchObject({ status: 'ready', assetId, attemptCount: 1 });
  });

  it('gives reviewed author corrections precedence over a conflicting cover image in reference requests', async () => {
    const f = fixture(); const provider = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    await (f.service as any).generateImageFromReferences('Current approved style: charcoal, gray and green', [], 'medium',
      new AbortController().signal, { image: Buffer.from('synthetic-reference'), mimeType: 'image/webp', filename: 'cover.webp' }, true);
    const prompt = (provider.mock.calls[0][1]?.body as FormData).get('prompt');
    expect(prompt).toContain('current author-approved visual bible overrides this cover');
    expect(prompt).not.toContain('Preserve its rendering medium, palette, recurring-character identity');
  });

  it('keeps reader prose available while approval is missing instead of failing the entire scene or offering paid images', async () => {
    const f = reviewedVisualFixture(); f.profile.status = 'needs_review';
    f.prisma.storyVisualGeneration.findMany.mockResolvedValue([{ sourceSceneKey, assetId, releaseChecksum: checksum, promptSha256 }]);
    f.prisma.asset.findMany.mockResolvedValue([{ id: assetId, metadata: {} }]);
    await expect(f.service.readyVisuals(workId, releaseId, [sourceSceneKey])).resolves.toEqual(new Map());
    await expect(f.service.promptKeys(workId, releaseId, [sourceSceneKey])).resolves.toEqual(new Set());
  });

  it('checks approval before a failing cover read so an unapproved image cannot take prose offline', async () => {
    const f = reviewedVisualFixture();
    f.prisma.storyVisualGeneration.findMany.mockResolvedValue([{ sourceSceneKey, assetId, releaseChecksum: checksum, promptSha256 }]);
    f.prisma.asset.findMany.mockResolvedValue([{ id: assetId, metadata: {} }]);
    jest.spyOn(f.service as any, 'visualBible').mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      throw new ConflictException({ code: 'STORY_VISUAL_PROFILE_CHANGED' });
    });
    const cover = jest.spyOn(f.service as any, 'approvedStoryCoverReference').mockRejectedValue(new Error('Storage unavailable'));
    await expect(f.service.readyVisuals(workId, releaseId, [sourceSceneKey])).resolves.toEqual(new Map());
    expect(cover).not.toHaveBeenCalled();
  });

  it('keeps prose available when approved-cover storage is unavailable without logging private errors', async () => {
    const f = reviewedVisualFixture();
    f.prisma.storyVisualGeneration.findMany.mockResolvedValue([{ sourceSceneKey, assetId, releaseChecksum: checksum, promptSha256 }]);
    f.prisma.asset.findMany.mockResolvedValue([{ id: assetId, metadata: {} }]);
    const warn = jest.spyOn((f.service as any).logger, 'warn').mockImplementation();
    jest.spyOn(f.service as any, 'approvedStoryCoverReference').mockRejectedValue(new Error('Private storage failure detail'));
    await expect(f.service.readyVisuals(workId, releaseId, [sourceSceneKey])).resolves.toEqual(new Map());
    expect(warn).toHaveBeenCalledWith({ event: 'story_visual_cover_read_unavailable', workId, releaseId, code: 'GENERATION_FAILED' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Private storage failure detail');
  });

  it('applies the same work bible to an AI branch scene without exposing its prose', async () => {
    const f = fixture();
    const generatedSceneId = '00000000-0000-4000-8000-000000000007';
    const generatedSceneKey = 'ai-reader-route-0001';
    const branchPrompt = 'Private generated branch prose and scene direction.';
    f.prisma.storyReaderProgress.findFirst.mockResolvedValue({
      workId, currentSceneId: null, currentGeneratedSceneId: generatedSceneId, activeReleaseId: releaseId,
    });
    f.prisma.storyAiGeneratedScene.findFirst.mockResolvedValue({ id: generatedSceneId, continuationId: 'continuation-id',
      workId, releaseId, userId: 'user-id' });
    f.prisma.storyAiContinuation.findFirst.mockResolvedValue({ contextReferences: {} });
    f.prisma.storyVisualPrompt.findUnique.mockResolvedValue({
      workId, releaseId, releaseChecksum: checksum, sourceSceneKey: generatedSceneKey,
      promptSha256, promptText: branchPrompt, sourceKind: 'ai_branch',
    });
    const image = await sharp({
      create: { width: 1536, height: 1024, channels: 3, background: '#203040' },
    }).webp().toBuffer();
    const provider = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ b64_json: image.toString('base64') }] }) } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);

    await expect(f.service.requestForProgress('user-id', progressId, generatedSceneKey)).resolves.toEqual({
      status: 'ready', sourceSceneKey: generatedSceneKey,
      publicAssetPath: `/api/v1/story-visual-assets/${assetId}`, reused: false,
    });

    const providerBody = JSON.parse(String((provider.mock.calls[0][1] as RequestInit).body));
    expect(providerBody.prompt).toContain('Work title: 불타는 바다의 기록자');
    expect(providerBody.prompt).toContain('Joseon naval historical drama');
    expect(providerBody.prompt).toContain(branchPrompt);
    const storedMetadata = f.prisma.asset.create.mock.calls[0][0].data.metadata;
    expect(JSON.stringify(storedMetadata)).not.toContain(branchPrompt);
  });

  it('does not reuse or regenerate a legacy ready asset from the reader endpoint', async () => {
    const f = fixture();
    f.setGeneration({ id: 'generation-id', workId, releaseId, releaseChecksum: checksum, sourceSceneKey,
      promptSha256, status: 'ready', attemptCount: 1, updatedAt: new Date(), assetId });
    const provider = jest.spyOn(global, 'fetch');

    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toEqual({
      status: 'unavailable', reason: 'visual_identity_changed',
    });

    expect(provider).not.toHaveBeenCalled();
    expect(f.prisma.asset.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: assetId }),
    }));
    expect(f.generation()).toMatchObject({ status: 'ready', assetId, attemptCount: 1 });
  });

  it('omits ready images whose asset belongs to another artist or branch', async () => {
    const f = fixture();
    const effective = await (f.service as any).effectiveVisualPrompt(workId, releaseId, checksum,
      'A sufficiently detailed private scene image direction.');
    const storyVisual = {
      workId, releaseId, releaseChecksum: checksum, sourceSceneKey,
      variantKey: 'artist:artist-one', participantFingerprint: 'artist-one', promptSha256,
      visualBibleVersion: effective.bible.version,
      visualBibleFingerprint: effective.bible.fingerprint,
      effectivePromptSha256: effective.sha256,
      provider: 'openai', model: 'gpt-image-2', quality: 'medium', size: '1536x1024',
      requestContractVersion: 'openai-image-request-v5',
    };
    f.prisma.storyVisualGeneration.findMany.mockResolvedValue([{
      sourceSceneKey, assetId, releaseChecksum: checksum, promptSha256,
    }]);
    f.prisma.asset.findMany.mockResolvedValue([{
      id: assetId, metadata: { lifecycle: { status: 'active' }, storyVisual },
    }]);

    await expect(f.service.readyVisuals(workId, releaseId, [sourceSceneKey], 'artist:artist-two'))
      .resolves.toEqual(new Map());
    await expect(f.service.readyVisuals(workId, releaseId, [sourceSceneKey], 'artist:artist-one'))
      .resolves.toEqual(new Map([[sourceSceneKey, {
        sourceSceneKey, publicAssetPath: `/api/v1/story-visual-assets/${assetId}`,
      }]]));
    f.prisma.asset.findMany.mockResolvedValue([{
      id: assetId, metadata: { lifecycle: { status: 'active' },
        storyVisual: { ...storyVisual, visualBibleFingerprint: '0'.repeat(20) } },
    }]);
    await expect(f.service.readyVisuals(workId, releaseId, [sourceSceneKey], 'artist:artist-one'))
      .resolves.toEqual(new Map());
    f.prisma.asset.findMany.mockResolvedValue([{
      id: assetId, metadata: { lifecycle: { status: 'active' },
        storyVisual: { ...storyVisual, sourceSceneKey: 'ai-other-branch' } },
    }]);
    await expect(f.service.readyVisuals(workId, releaseId, [sourceSceneKey], 'artist:artist-one'))
      .resolves.toEqual(new Map());
    f.prisma.asset.findMany.mockResolvedValue([{
      id: assetId, metadata: { lifecycle: { status: 'archived' }, storyVisual },
    }]);
    await expect(f.service.readyVisuals(workId, releaseId, [sourceSceneKey], 'artist:artist-one'))
      .resolves.toEqual(new Map());
  });

  it('replaces a stale ready asset once through the admin-only service path and reuses the effective identity', async () => {
    const f = fixture();
    const replacementAssetId = '00000000-0000-4000-8000-000000000009';
    f.setGeneration({ id: 'generation-id', workId, releaseId, releaseChecksum: checksum, sourceSceneKey,
      promptSha256, status: 'ready', attemptCount: 1, updatedAt: new Date(), assetId, lastErrorCode: null });
    f.prisma.asset.findFirst.mockResolvedValue({ id: assetId, metadata: {
      storyVisual: { workId, releaseId, sourceSceneKey, promptSha256 },
    } });
    f.prisma.asset.create.mockResolvedValue({ id: replacementAssetId });
    const image = await sharp({
      create: { width: 1536, height: 1024, channels: 3, background: '#304050' },
    }).webp().toBuffer();
    const provider = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ b64_json: image.toString('base64') }] }) } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);
    const input = { releaseId, releaseChecksum: checksum, sourceSceneKey };

    await expect(f.service.replaceStale(workId, input)).resolves.toEqual({
      status: 'ready', sourceSceneKey, workId, releaseId, releaseChecksum: checksum,
      publicAssetPath: `/api/v1/story-visual-assets/${replacementAssetId}`, reused: false,
    });

    expect(provider).toHaveBeenCalledTimes(2);
    expect(f.generation()).toMatchObject({ status: 'ready', assetId: replacementAssetId, attemptCount: 1 });
    expect(f.prisma.storyVisualGeneration.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ lastErrorCode: null }),
      data: expect.objectContaining({
        lastErrorCode: expect.stringMatching(/^STALE_REPLACEMENT_IN_PROGRESS_[a-f0-9]{40}$/),
      }),
    }));
    expect(f.prisma.storyVisualGeneration.updateMany.mock.calls[0][0].data).not.toHaveProperty('attemptCount');
    expect(f.prisma.asset.updateMany).toHaveBeenCalledWith({
      where: { id: assetId, visibility: 'public' }, data: { visibility: 'private' },
    });
    const createdMetadata = f.prisma.asset.create.mock.calls[0][0].data.metadata;
    expect(createdMetadata.storyVisual).toMatchObject({
      replacesAssetId: assetId,
      visualBibleVersion: 'story-visual-bible-v5',
      effectivePromptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      requestContractVersion: 'openai-image-request-v5',
    });
    const effectivePromptSha256 = createdMetadata.storyVisual.effectivePromptSha256;
    expect(String(provider.mock.calls[1][0])).toContain(effectivePromptSha256);

    f.prisma.asset.findFirst.mockResolvedValue({ id: replacementAssetId, metadata: createdMetadata });
    await expect(f.service.replaceStale(workId, input)).resolves.toEqual({
      status: 'ready', sourceSceneKey, workId, releaseId, releaseChecksum: checksum,
      publicAssetPath: `/api/v1/story-visual-assets/${replacementAssetId}`, reused: true,
    });
    expect(provider).toHaveBeenCalledTimes(2);
    expect(f.prisma.asset.create).toHaveBeenCalledTimes(1);
    expect(f.generation()).toMatchObject({ attemptCount: 1 });

    const highQualityAssetId = '00000000-0000-4000-8000-000000000010';
    f.setConfig('OPENAI_IMAGE_QUALITY', 'high');
    f.prisma.asset.create.mockResolvedValue({ id: highQualityAssetId });
    provider
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ b64_json: image.toString('base64') }] }) } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);

    await expect(f.service.replaceStale(workId, input)).resolves.toEqual({
      status: 'ready', sourceSceneKey, workId, releaseId, releaseChecksum: checksum,
      publicAssetPath: `/api/v1/story-visual-assets/${highQualityAssetId}`, reused: false,
    });
    expect(provider).toHaveBeenCalledTimes(4);
    expect(f.prisma.asset.create.mock.calls[1][0].data.metadata.storyVisual).toMatchObject({
      replacesAssetId: replacementAssetId,
      quality: 'high',
    });
  });

  it('lists only ready visuals that no longer match the current work identity', async () => {
    const f = fixture();
    const updatedAt = new Date('2026-09-23T00:00:00.000Z');
    f.prisma.storyVisualGeneration.findMany.mockResolvedValue([
      { sourceSceneKey, assetId, updatedAt },
    ]);
    f.prisma.asset.findFirst.mockResolvedValue({ id: assetId, metadata: {
      storyVisual: { workId, releaseId, sourceSceneKey, promptSha256,
        visualBibleVersion: 'story-visual-bible-v3' },
    } });

    await expect(f.service.replacementStatus(workId)).resolves.toEqual({
      workId,
      releaseId,
      releaseChecksum: checksum,
      readyCount: 1,
      staleCount: 1,
      items: [{ sourceSceneKey, assetId, updatedAt }],
    });
    expect(f.prisma.storyVisualGeneration.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ variantKey: 'default', status: 'ready', assetId: { not: null } }),
      take: 80,
    }));
  });

  it('keeps the prior ready asset and blocks another paid attempt after replacement failure for the same identity', async () => {
    const f = fixture();
    f.setGeneration({ id: 'generation-id', workId, releaseId, releaseChecksum: checksum, sourceSceneKey,
      promptSha256, status: 'ready', attemptCount: 1, updatedAt: new Date(), assetId, lastErrorCode: null });
    f.prisma.asset.findFirst.mockResolvedValue({ id: assetId, metadata: {
      storyVisual: { workId, releaseId, sourceSceneKey, promptSha256 },
    } });
    const provider = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);
    const input = { releaseId, releaseChecksum: checksum, sourceSceneKey };

    await expect(f.service.replaceStale(workId, input)).resolves.toEqual({
      status: 'failed', sourceSceneKey, retryable: false, workId, releaseId, releaseChecksum: checksum,
    });
    expect(f.generation()).toMatchObject({
      status: 'ready', assetId, attemptCount: 1,
      lastErrorCode: expect.stringMatching(/^STALE_REPLACEMENT_FAILED_[a-f0-9]{40}$/),
    });

    await expect(f.service.replaceStale(workId, input)).resolves.toEqual({
      status: 'failed', sourceSceneKey, retryable: false, workId, releaseId, releaseChecksum: checksum,
    });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(f.prisma.asset.create).not.toHaveBeenCalled();
    expect(f.generation()).toMatchObject({ status: 'ready', assetId, attemptCount: 1 });
  });

  it('rejects an old branch approval before persisting an image replacement claim', async () => {
    const f = reviewedVisualFixture();
    f.setGeneration({ id: 'generation-id', workId, releaseId, releaseChecksum: checksum, sourceSceneKey,
      promptSha256, status: 'ready', attemptCount: 1, updatedAt: new Date(), assetId, lastErrorCode: null });
    f.prisma.asset.findFirst.mockResolvedValue({ id: assetId, metadata: {} });
    f.prisma.storyVisualPrompt.findUnique.mockResolvedValue({ workId, releaseId, releaseChecksum: checksum,
      sourceSceneKey, promptSha256, promptText: 'Old branch appearance', sourceKind: 'ai_branch' });
    f.prisma.storyAiGeneratedScene.findFirst.mockResolvedValue({ id: sceneId, continuationId: 'continuation-id' });
    f.prisma.storyAiContinuation.findFirst.mockResolvedValue({ contextReferences: { generationProfilePin: {
      id: f.profile.id, profileVersion: 1, reviewRevision: 1, sourceFingerprint: f.profile.sourceFingerprint,
      approvedFingerprint: f.profile.approvedFingerprint } } });
    f.profile.reviewRevision++;
    const provider = jest.spyOn(global, 'fetch');
    await expect(f.service.replaceStale(workId, { releaseId, releaseChecksum: checksum, sourceSceneKey }))
      .rejects.toMatchObject({ response: { code: 'STORY_VISUAL_PROFILE_CHANGED' } });
    expect(f.generation()).toMatchObject({ status: 'ready', assetId, lastErrorCode: null, attemptCount: 1 });
    expect(f.prisma.storyVisualGeneration.updateMany).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([null, 'OLDER_REPLACEMENT_FAILURE'])('restores a zero-provider replacement claim to its prior error state (%s)', async previousError => {
    const f = reviewedVisualFixture();
    f.setGeneration({ id: 'generation-id', workId, releaseId, releaseChecksum: checksum, sourceSceneKey,
      promptSha256, status: 'ready', attemptCount: 1, updatedAt: new Date(), assetId, lastErrorCode: previousError });
    f.prisma.asset.findFirst.mockResolvedValue({ id: assetId, metadata: {} });
    jest.spyOn(f.service as any, 'assertEffectiveVisualCurrent').mockRejectedValueOnce(new Error('Transient preflight error'));
    const image = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#456745' } }).webp().toBuffer();
    const provider = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ b64_json: image.toString('base64') }] }) } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);
    const input = { releaseId, releaseChecksum: checksum, sourceSceneKey };
    await expect(f.service.replaceStale(workId, input)).resolves.toMatchObject({ status: 'failed', retryable: true });
    expect(provider).not.toHaveBeenCalled();
    expect(f.generation()).toMatchObject({ status: 'ready', assetId, lastErrorCode: previousError, startedAt: null, attemptCount: 1 });
    await expect(f.service.replaceStale(workId, input)).resolves.toMatchObject({ status: 'ready', reused: false });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('serves the prior ready asset while the same admin replacement is already in progress', async () => {
    const f = fixture();
    f.setGeneration({ id: 'generation-id', workId, releaseId, releaseChecksum: checksum, sourceSceneKey,
      promptSha256, status: 'ready', attemptCount: 1, updatedAt: new Date(), assetId, lastErrorCode: null });
    f.prisma.asset.findFirst.mockResolvedValue({ id: assetId, metadata: {
      storyVisual: { workId, releaseId, sourceSceneKey, promptSha256 },
    } });
    const provider = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);
    const input = { releaseId, releaseChecksum: checksum, sourceSceneKey };

    await f.service.replaceStale(workId, input);
    const claimCode = f.prisma.storyVisualGeneration.updateMany.mock.calls[0][0].data.lastErrorCode;
    f.setGeneration({ id: 'generation-id', workId, releaseId, releaseChecksum: checksum, sourceSceneKey,
      promptSha256, status: 'ready', attemptCount: 1, updatedAt: new Date(), assetId, lastErrorCode: claimCode });
    provider.mockClear();

    await expect(f.service.replaceStale(workId, input))
      .resolves.toEqual({ status: 'processing', sourceSceneKey, workId, releaseId, releaseChecksum: checksum });
    expect(provider).not.toHaveBeenCalled();
    expect(f.generation()).toMatchObject({ status: 'ready', assetId, attemptCount: 1 });
  });

  it('rejects admin replacement unless the target already has a ready asset', async () => {
    const f = fixture();
    f.setGeneration({ id: 'generation-id', workId, releaseId, releaseChecksum: checksum, sourceSceneKey,
      promptSha256, status: 'pending', attemptCount: 0, updatedAt: new Date(), assetId: null });
    const provider = jest.spyOn(global, 'fetch');

    await expect(f.service.replaceStale(workId, { releaseId, releaseChecksum: checksum, sourceSceneKey }))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'STORY_VISUAL_REPLACEMENT_NOT_READY' }) });
    expect(provider).not.toHaveBeenCalled();
  });

  it.each(['ready', 'failed', 'processing', 'unavailable'])('binds an admin %s response to the exact validated source', async status => {
    const f = fixture();
    f.setGeneration({ status: 'ready', assetId });
    const generate = jest.spyOn(f.service as any, 'generate').mockResolvedValue({ status });
    const input = { releaseId, releaseChecksum: checksum, sourceSceneKey };
    await expect(f.service.replaceStale(workId, input)).resolves.toEqual({
      status, workId, releaseId, releaseChecksum: checksum, sourceSceneKey,
    });
    expect(generate).toHaveBeenCalledWith(workId, releaseId, checksum, sourceSceneKey, undefined, true);
    expect(f.prisma.storyWork.findFirst).toHaveBeenCalledWith({ where: {
      id: workId, status: 'published', fixtureSource: false, activeReleaseId: releaseId,
    }, select: { id: true } });
    f.prisma.storyWork.findFirst.mockResolvedValueOnce(null);
    await expect(f.service.replaceStale(workId, input)).rejects.toBeInstanceOf(NotFoundException);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it.each(['hidden_work', 'changed_release', 'changed_checksum'])('rejects a ready replacement response after %s', async change => {
    const f = fixture();
    f.setGeneration({ status: 'ready', assetId });
    const generate = jest.spyOn(f.service as any, 'generate').mockImplementation(async () => {
      if (change === 'changed_checksum') f.prisma.storyRelease.findFirst.mockResolvedValueOnce(null);
      else f.prisma.storyWork.findFirst.mockResolvedValueOnce(null);
      return { status: 'ready', publicAssetPath: `/api/v1/story-visual-assets/${assetId}`, reused: true };
    });
    await expect(f.service.replaceStale(workId, { releaseId, releaseChecksum: checksum, sourceSceneKey }))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'STORY_VISUAL_REPLACEMENT_SOURCE_CHANGED' }) });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(f.generation()).toMatchObject({ status: 'ready', assetId });
    expect(f.prisma.storyWork.findFirst).toHaveBeenLastCalledWith({ where: {
      id: workId, status: 'published', fixtureSource: false, activeReleaseId: releaseId,
    }, select: { id: true } });
    if (change === 'changed_checksum') expect(f.prisma.storyRelease.findFirst).toHaveBeenLastCalledWith({ where: {
      id: releaseId, workId, status: 'active', checksum,
    }, select: { id: true } });
  });

  it('keeps a generated beta image in the database when object storage rejects the upload', async () => {
    const f = fixture();
    const warning = jest.spyOn((f.service as any).logger, 'warn').mockImplementation();
    const image = await sharp({
      create: { width: 1536, height: 1024, channels: 3, background: '#556677' },
    }).webp().toBuffer();
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ b64_json: image.toString('base64') }] }) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 403,
        text: async () => '<Error><Code>AccessDenied</Code><Message>private account details</Message></Error>',
      } as Response);

    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toEqual({
      status: 'ready', sourceSceneKey,
      publicAssetPath: `/api/v1/story-visual-assets/${assetId}`, reused: false,
    });
    expect(f.prisma.asset.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      storageProvider: 'database',
      metadata: expect.objectContaining({
        storyVisual: expect.objectContaining({
          inlineImage: { encoding: 'base64', data: expect.any(String) },
        }),
      }),
    }) });
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({
      event: 'story_visual_database_fallback', objectStorageStatus: 403, objectStorageCode: 'AccessDenied',
    }));
    expect(JSON.stringify(warning.mock.calls)).not.toContain('private account details');
  });

  it('serves a verified database fallback image from the public story endpoint', async () => {
    const f = fixture();
    const image = await sharp({
      create: { width: 1536, height: 1024, channels: 3, background: '#778899' },
    }).webp().toBuffer();
    const imageChecksum = createHash('sha256').update(image).digest('hex');
    const metadata = await publicAssetBinding(f);
    f.setGeneration({ status: 'ready', assetId, releaseChecksum: checksum,
      promptSha256, checksumSha256: imageChecksum });
    f.prisma.asset.findFirst = jest.fn().mockResolvedValue({
      id: assetId,
      storageProvider: 'database',
      mimeType: 'image/webp',
      fileSizeBytes: BigInt(image.length),
      checksum: imageChecksum,
      metadata: {
        ...metadata,
        storyVisual: { ...metadata.storyVisual,
          inlineImage: { encoding: 'base64', data: image.toString('base64') } },
      },
    });
    const provider = jest.spyOn(global, 'fetch');

    await expect(f.service.publicVisualAsset(assetId)).resolves.toEqual({
      kind: 'inline', mimeType: 'image/webp', image,
    });
    expect(provider).not.toHaveBeenCalled();
  });

  it('returns 404 for a stale direct asset URL without requesting a new image', async () => {
    const f = fixture();
    const metadata = await publicAssetBinding(f);
    const imageChecksum = 'c'.repeat(64);
    const asset = { id: assetId, storageProvider: 'r2', storageKey: objectStorageKey, mimeType: 'image/webp',
      checksum: imageChecksum, metadata };
    f.prisma.asset.findFirst.mockResolvedValue(asset);
    f.setGeneration({ status: 'ready', assetId, releaseChecksum: checksum,
      promptSha256, checksumSha256: imageChecksum });
    const provider = jest.spyOn(global, 'fetch');

    const delivery = await f.service.publicVisualAsset(assetId);
    expect(delivery.kind).toBe('redirect');
    if (delivery.kind !== 'redirect') throw new Error('Expected signed object redirect');
    const signedUrl = new URL(delivery.url);
    expect(signedUrl.origin).toBe('https://storage.example.test');
    expect(signedUrl.pathname).toBe(`/bucket/${objectStorageKey}`);
    expect(signedUrl.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(signedUrl.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(signedUrl.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(delivery.url).not.toContain('/api/v1/assets/public/');
    const storage = new StoryUploadStorageService(f.config as never);
    const signedAt = signedUrl.searchParams.get('X-Amz-Date')!;
    const timestamp = `${signedAt.slice(0, 4)}-${signedAt.slice(4, 6)}-${signedAt.slice(6, 8)}` +
      `T${signedAt.slice(9, 11)}:${signedAt.slice(11, 13)}:${signedAt.slice(13, 15)}Z`;
    jest.useFakeTimers().setSystemTime(new Date(timestamp));
    try {
      expect(delivery.url).toBe((storage as any).buildSignedUrl('r2', objectStorageKey,
        'GET', undefined, 60));
    } finally {
      jest.useRealTimers();
    }
    f.prisma.asset.findFirst.mockResolvedValueOnce({ ...asset,
      storageKey: `unrelated/${objectStorageKey}` });
    await expect(f.service.publicVisualAsset(assetId)).rejects.toBeInstanceOf(NotFoundException);
    f.prisma.storyVisualPrompt.findUnique.mockResolvedValueOnce({
      releaseChecksum: checksum, promptSha256: 'd'.repeat(64), promptText: 'Changed scene.',
    });
    await expect(f.service.publicVisualAsset(assetId)).rejects.toBeInstanceOf(NotFoundException);
    f.prisma.storyWork.findFirst.mockResolvedValueOnce(null);
    await expect(f.service.publicVisualAsset(assetId)).rejects.toBeInstanceOf(NotFoundException);
    f.prisma.storyRelease.findFirst.mockResolvedValueOnce(null);
    await expect(f.service.publicVisualAsset(assetId)).rejects.toBeInstanceOf(NotFoundException);
    f.setGeneration({ status: 'ready', assetId: '00000000-0000-4000-8000-000000000009',
      releaseChecksum: checksum, promptSha256, checksumSha256: imageChecksum });
    await expect(f.service.publicVisualAsset(assetId)).rejects.toBeInstanceOf(NotFoundException);
    f.setGeneration({ status: 'ready', assetId, releaseChecksum: checksum,
      promptSha256, checksumSha256: imageChecksum });
    f.prisma.asset.findFirst.mockResolvedValueOnce({ ...asset, metadata: {
      ...metadata, lifecycle: { status: 'archived' },
    } });
    await expect(f.service.publicVisualAsset(assetId)).rejects.toBeInstanceOf(NotFoundException);
    f.prisma.asset.findFirst.mockResolvedValueOnce({ ...asset, metadata: {
      ...metadata, storyVisual: { ...metadata.storyVisual, participantFingerprint: 'e'.repeat(64) },
    } });
    await expect(f.service.publicVisualAsset(assetId)).rejects.toBeInstanceOf(NotFoundException);
    f.prisma.asset.findFirst.mockResolvedValueOnce({ ...asset, metadata: {
      ...metadata, storyVisual: { ...metadata.storyVisual,
        variantKey: `artist:${'e'.repeat(64)}`, participantFingerprint: 'e'.repeat(64) },
    } });
    f.prisma.storyVisualGeneration.findUnique.mockResolvedValueOnce(null);
    await expect(f.service.publicVisualAsset(assetId)).rejects.toBeInstanceOf(NotFoundException);
    f.prisma.asset.findFirst.mockResolvedValueOnce({ ...asset, metadata: {
      ...metadata, storyVisual: { ...metadata.storyVisual, visualBibleFingerprint: '0'.repeat(20) },
    } });
    await expect(f.service.publicVisualAsset(assetId)).rejects.toBeInstanceOf(NotFoundException);
    expect(provider).not.toHaveBeenCalled();
  });

  it('returns 404 when an artist identity approval is revoked after image creation', async () => {
    const f = fixture();
    const fingerprint = 'c'.repeat(64);
    const metadata = await publicAssetBinding(f, `artist:${fingerprint}`);
    const imageChecksum = 'd'.repeat(64);
    f.prisma.asset.findFirst.mockResolvedValue({ id: assetId, storageProvider: 'r2',
      storageKey: objectStorageKey,
      mimeType: 'image/webp', checksum: imageChecksum, metadata });
    f.setGeneration({ status: 'ready', assetId, releaseChecksum: checksum,
      promptSha256, checksumSha256: imageChecksum });
    f.prisma.storyProgressArtistParticipant.findFirst.mockResolvedValue({ progressId });
    const participants = { visualReferences: jest.fn().mockResolvedValue({
      participantFingerprint: fingerprint, references: [{ assetId: 'reference-id' }],
    }) };
    const service = new StoryVisualGenerationService(f.prisma, f.config as never,
      undefined, participants as never);
    const provider = jest.spyOn(global, 'fetch');

    const delivery = await service.publicVisualAsset(assetId);
    expect(delivery.kind).toBe('redirect');
    if (delivery.kind !== 'redirect') throw new Error('Expected signed object redirect');
    expect(delivery.url).toContain(`/${objectStorageKey}?`);
    expect(delivery.url).not.toContain('/api/v1/assets/public/');
    expect(f.prisma.storyProgressArtistParticipant.findFirst).toHaveBeenCalledWith({
      where: { workId, participantFingerprint: fingerprint, artist: { status: 'active' } },
      select: { progressId: true },
    });
    participants.visualReferences.mockRejectedValue(new ConflictException('PROFILE_CHANGED'));
    await expect(service.publicVisualAsset(assetId)).rejects.toBeInstanceOf(NotFoundException);
    expect(provider).not.toHaveBeenCalled();
  });

  it('retries once when the prior paid generation only failed at object storage', async () => {
    const f = fixture();
    f.setGeneration({ id: 'generation-id', workId, releaseId, releaseChecksum: checksum, sourceSceneKey,
      promptSha256, status: 'failed', attemptCount: 1, lastErrorCode: 'OBJECT_STORAGE_403',
      updatedAt: new Date(), assetId: null });
    const image = await sharp({
      create: { width: 1536, height: 1024, channels: 3, background: '#99aabb' },
    }).webp().toBuffer();
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ b64_json: image.toString('base64') }] }) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 403 } as Response);

    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toEqual({
      status: 'ready', sourceSceneKey,
      publicAssetPath: `/api/v1/story-visual-assets/${assetId}`, reused: false,
    });
    expect(f.generation()).toMatchObject({ status: 'ready', attemptCount: 1, assetId });
  });

  it('rejects a malformed or wrong-sized provider image without uploading it', async () => {
    const f = fixture();
    const image = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: '#334455' },
    }).webp().toBuffer();
    const provider = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ b64_json: image.toString('base64') }] }) } as Response);

    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toEqual({
      status: 'failed', sourceSceneKey, retryable: false,
    });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(f.prisma.asset.create).not.toHaveBeenCalled();
    expect(f.generation()).toMatchObject({ status: 'failed', attemptCount: 1, lastErrorCode: 'OPENAI_IMAGE_INVALID' });
  });

  it('records only sanitized provider error fields for diagnosis', async () => {
    const f = fixture();
    const provider = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: 'secret provider message that must not be persisted',
          param: 'n',
          code: 'unknown_parameter',
          type: 'invalid_request_error',
        },
      }),
    } as Response);

    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toEqual({
      status: 'failed', sourceSceneKey, retryable: false,
    });

    expect(provider).toHaveBeenCalledTimes(1);
    expect(f.generation()).toMatchObject({
      status: 'failed',
      lastErrorCode: 'OPENAI_400_PARAM_n_CODE_unknown_parameter_TYPE_invalid_request_error',
    });
    expect(JSON.stringify(f.generation())).not.toContain('secret provider message');
  });

  it('never retries an ambiguous provider attempt automatically', async () => {
    const f = fixture();
    f.prisma.storyVisualGeneration.findUnique.mockResolvedValue({ id: 'generation-id', workId, releaseId,
      releaseChecksum: checksum, sourceSceneKey, promptSha256, status: 'failed', attemptCount: 1,
      updatedAt: new Date(), assetId: null });
    const provider = jest.spyOn(global, 'fetch');
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey))
      .resolves.toMatchObject({ status: 'failed', sourceSceneKey });
    expect(provider).not.toHaveBeenCalled();
  });

  it('stops before the provider when the paid-attempt budget is exhausted', async () => {
    const f = fixture();
    f.setConfig('STORY_IMAGE_GENERATION_EMERGENCY_MAX_PER_WORK', '80');
    f.prisma.storyVisualGeneration.count.mockResolvedValue(80);
    const provider = jest.spyOn(global, 'fetch');

    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toEqual({
      status: 'unavailable', reason: 'beta_generation_limit_reached',
    });
    expect(provider).not.toHaveBeenCalled();
  });

  it('defaults to portrait scenes without a fixed work or catalog attempt cap', async () => {
    const f = fixture();
    f.setConfig('OPENAI_STORY_SCENE_IMAGE_SIZE', '');
    f.prisma.storyVisualGeneration.count.mockResolvedValue(10_000);
    expect((f.service as any).size()).toBe('1024x1536');
    await expect((f.service as any).overBudget(workId, releaseId, false)).resolves.toBe(false);
    expect(f.prisma.storyVisualGeneration.count).not.toHaveBeenCalled();
  });

  it('uses the approved Norse cover as a visual identity reference', async () => {
    const f = fixture();
    f.prisma.storyWork.findFirst.mockResolvedValue({ slug: 'norse-myth-loki-crossroads' });
    const reference = await (f.service as any).approvedStoryCoverReference(workId);
    expect(reference).toMatchObject({ mimeType: 'image/webp', filename: 'norse-myth-cover.webp' });
    expect(reference.image.length).toBeGreaterThan(1_024);
  });

  it('uses the current registered local cover even when a fixed story cover changed', async () => {
    const f = fixture();
    f.prisma.storyWork.findFirst.mockResolvedValueOnce({ slug: 'norse-myth-loki-crossroads',
      coverManifest: { publicAssetPath: '/assets/story/norse-myth-cover-portrait.webp' } })
      .mockResolvedValueOnce({ slug: 'norse-myth-loki-crossroads',
        coverManifest: { publicAssetPath: '/assets/story/norse-myth-cover.webp' } });
    const first = await (f.service as any).approvedStoryCoverReference(workId);
    const second = await (f.service as any).approvedStoryCoverReference(workId);
    expect(first.filename).toBe('norse-myth-cover-portrait.webp');
    expect(second.filename).toBe('norse-myth-cover.webp');
    expect(first.checksum).not.toBe(second.checksum);
  });

  it('shares concurrent cover reads but checks the source again on a later request', async () => {
    const f = fixture();
    f.prisma.storyWork.findFirst.mockResolvedValue({ slug: 'norse-myth-loki-crossroads',
      coverManifest: { publicAssetPath: '/assets/story/norse-myth-cover.webp' } });
    const references = await Promise.all(Array.from({ length: 8 }, () =>
      (f.service as any).approvedStoryCoverReference(workId)));
    expect(references.every(reference => reference.checksum === references[0].checksum)).toBe(true);
    expect(f.prisma.storyWork.findFirst).toHaveBeenCalledTimes(1);
    await (f.service as any).approvedStoryCoverReference(workId);
    expect(f.prisma.storyWork.findFirst).toHaveBeenCalledTimes(2);
  });

  it('accepts a new work cover but rejects a traversal path from its manifest', async () => {
    const f = fixture();
    f.prisma.storyWork.findFirst.mockResolvedValueOnce({ slug: 'new-author-story',
      coverManifest: { publicAssetPath: '/assets/story/monster-name-cover.png' } })
      .mockResolvedValueOnce({ slug: 'new-author-story',
        coverManifest: { publicAssetPath: '/assets/story/../private/key.png' } });
    await expect((f.service as any).approvedStoryCoverReference(workId))
      .resolves.toMatchObject({ filename: 'monster-name-cover.png' });
    await expect((f.service as any).approvedStoryCoverReference(workId))
      .rejects.toThrow('STORY_VISUAL_COVER_REFERENCE_UNSUPPORTED');
  });

  it('does not silently use an old fixed cover when the current cover is external', async () => {
    const f = fixture();
    f.prisma.storyWork.findFirst.mockResolvedValue({ slug: 'norse-myth-loki-crossroads',
      coverManifest: { publicAssetPath: 'https://example.test/new-cover.png' } });
    await expect((f.service as any).approvedStoryCoverReference(workId))
      .rejects.toThrow('STORY_VISUAL_COVER_REFERENCE_UNSUPPORTED');
  });

  async function uploadedCoverFixture() {
    const f = fixture();
    const ownerUserId = '00000000-0000-4000-8000-000000000011';
    const image = await sharp({
      create: { width: 800, height: 1200, channels: 3, background: '#667788' },
    }).png().toBuffer();
    const asset = {
      id: assetId, storageProvider: 'r2', storageKey: 'uploads/cover-original.png',
      mimeType: 'image/png', fileSizeBytes: BigInt(image.length),
      checksum: createHash('sha256').update(image).digest('hex'),
      metadata: {
        uploadIntent: { createdByUserId: ownerUserId, status: 'uploaded' },
        lifecycle: { status: 'active' },
        derivatives: { display: { storageProvider: 'r2', storageKey: 'uploads/cover-display.png',
          mimeType: 'image/png', fileSizeBytes: image.length } },
      },
    };
    const work = { id: workId, activeReleaseId: releaseId, slug: 'new-author-story', ownerUserId,
      title: { ko: '새 작가 작품' }, summary: { ko: '작가가 올린 작품 소개' },
      coverManifest: { assetId, url: `/api/v1/assets/public/${assetId}/display` } };
    f.prisma.storyWork.findFirst.mockResolvedValue(work);
    f.prisma.asset.findFirst.mockResolvedValue(asset);
    const storage = { getObject: jest.fn().mockResolvedValue(image) };
    const service = new StoryVisualGenerationService(f.prisma, f.config as never,
      undefined, undefined, storage as never);
    return { ...f, service, work, asset, image, storage };
  }

  it('uses the uploaded display cover of a new author work without an external URL fetch', async () => {
    const f = await uploadedCoverFixture();
    const provider = jest.spyOn(global, 'fetch');
    const reference = await (f.service as any).approvedStoryCoverReference(workId);
    expect(reference).toEqual({ image: f.image, checksum: f.asset.checksum,
      mimeType: 'image/png', filename: `story-cover-${assetId}.png` });
    expect(f.storage.getObject).toHaveBeenCalledWith({ storageProvider: 'r2',
      storageKey: 'uploads/cover-display.png', expectedBytes: f.image.length });
    expect(f.prisma.asset.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: assetId, assetType: 'image', visibility: 'public' },
    }));
    expect(provider).not.toHaveBeenCalled();
  });

  it('sends the uploaded author cover as the first image reference and records its checksum', async () => {
    const f = await uploadedCoverFixture();
    const generated = await sharp({
      create: { width: 1536, height: 1024, channels: 3, background: '#334455' },
    }).webp().toBuffer();
    const provider = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true,
        json: async () => ({ data: [{ b64_json: generated.toString('base64') }] }),
      } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey))
      .resolves.toMatchObject({ status: 'ready', sourceSceneKey });
    expect(provider.mock.calls[0][0]).toBe('https://api.openai.com/v1/images/edits');
    const form = provider.mock.calls[0][1]?.body as FormData;
    const uploaded = form.get('image[]') as File;
    expect(form.getAll('image[]')).toHaveLength(1);
    expect(Buffer.from(await uploaded.arrayBuffer())).toEqual(f.image);
    expect(f.prisma.asset.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      metadata: expect.objectContaining({ storyVisual: expect.objectContaining({
        workVisualReferenceChecksum: f.asset.checksum,
      }) }),
    }) });
  });

  it('verifies an uploaded original checksum when there is no display derivative', async () => {
    const f = await uploadedCoverFixture();
    f.asset.metadata.derivatives = {} as never;
    await expect((f.service as any).approvedStoryCoverReference(workId))
      .resolves.toMatchObject({ image: f.image, checksum: f.asset.checksum });
    expect(f.storage.getObject).toHaveBeenCalledWith({ storageProvider: 'r2',
      storageKey: 'uploads/cover-original.png', expectedBytes: f.image.length });
    f.asset.checksum = '0'.repeat(64);
    await expect((f.service as any).approvedStoryCoverReference(workId))
      .rejects.toThrow('STORY_VISUAL_COVER_REFERENCE_CHANGED');
  });

  it.each(['missing', 'other-owner', 'pending-upload', 'archived'])
  ('blocks an unavailable uploaded cover before storage or image provider calls: %s', async condition => {
    const f = await uploadedCoverFixture();
    if (condition === 'missing') f.prisma.asset.findFirst.mockResolvedValue(null);
    if (condition === 'other-owner') f.asset.metadata.uploadIntent.createdByUserId = 'other-user';
    if (condition === 'pending-upload') f.asset.metadata.uploadIntent.status = 'pending_upload';
    if (condition === 'archived') f.asset.metadata.lifecycle.status = 'archived';
    const provider = jest.spyOn(global, 'fetch');
    await expect((f.service as any).approvedStoryCoverReference(workId))
      .rejects.toThrow('STORY_VISUAL_COVER_REFERENCE_UNAVAILABLE');
    expect(f.storage.getObject).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it('rejects mismatched upload manifests and oversized references before downloading', async () => {
    const f = await uploadedCoverFixture();
    f.work.coverManifest.url = `/api/v1/assets/public/${progressId}/display`;
    await expect((f.service as any).approvedStoryCoverReference(workId))
      .rejects.toThrow('STORY_VISUAL_COVER_REFERENCE_UNSUPPORTED');
    f.work.coverManifest.url = `/api/v1/assets/public/${assetId}/display`;
    f.asset.metadata.derivatives.display.fileSizeBytes = 16 * 1024 * 1024 + 1;
    await expect((f.service as any).approvedStoryCoverReference(workId))
      .rejects.toThrow('STORY_VISUAL_COVER_REFERENCE_INVALID');
    expect(f.storage.getObject).not.toHaveBeenCalled();
  });

  it('rejects downloaded references with a different byte count or image format', async () => {
    const f = await uploadedCoverFixture();
    f.storage.getObject.mockResolvedValueOnce(f.image.subarray(1));
    await expect((f.service as any).approvedStoryCoverReference(workId))
      .rejects.toThrow('STORY_VISUAL_COVER_REFERENCE_CHANGED');
    f.asset.metadata.derivatives.display.mimeType = 'image/jpeg';
    await expect((f.service as any).approvedStoryCoverReference(workId))
      .rejects.toThrow('STORY_VISUAL_COVER_REFERENCE_INVALID');
  });

  it('shares simultaneous uploaded-cover reads and refreshes identity on a later request', async () => {
    const f = await uploadedCoverFixture();
    const first = await Promise.all(Array.from({ length: 4 }, () =>
      (f.service as any).approvedStoryCoverReference(workId)));
    expect(f.storage.getObject).toHaveBeenCalledTimes(1);
    const changed = await sharp({
      create: { width: 800, height: 1200, channels: 3, background: '#887766' },
    }).png().toBuffer();
    f.asset.metadata.derivatives.display.fileSizeBytes = changed.length;
    f.storage.getObject.mockResolvedValue(changed);
    const next = await (f.service as any).approvedStoryCoverReference(workId);
    expect(next.checksum).not.toBe(first[0].checksum);
    expect(f.storage.getObject).toHaveBeenCalledTimes(2);
  });

  it('registers an immutable prompt connection for a generated AI branch without calling the image provider', async () => {
    const f = fixture();
    const generatedSceneId = '00000000-0000-4000-8000-000000000007';
    f.prisma.storyVisualPrompt.findUnique.mockResolvedValue(null);
    f.prisma.storyAiGeneratedScene.findFirst.mockResolvedValue({
      id: generatedSceneId,
      sceneKey: 'ai-route-0001',
      resultChecksum: 'c'.repeat(64),
    });
    const provider = jest.spyOn(global, 'fetch');

    await expect(f.service.registerAiBranchPrompt(workId, generatedSceneId, {
      releaseId,
      releaseChecksum: checksum,
      promptText: 'A verified branch scene direction with consistent character and setting details.',
    })).resolves.toMatchObject({ sourceSceneKey: 'ai-route-0001', created: true });
    expect(f.prisma.storyVisualPrompt.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      workId,
      releaseId,
      sourceSceneKey: 'ai-route-0001',
      sourceKind: 'ai_branch',
      sourceBindingSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }) });
    expect(provider).not.toHaveBeenCalled();
  });

  it('derives a bounded visual prompt after a generated continuation is stored', async () => {
    const f = storedBranchFixture();
    const provider = jest.spyOn(global, 'fetch');
    const continuationId = '00000000-0000-4000-8000-000000000008';
    const generatedSceneId = '00000000-0000-4000-8000-000000000007';
    const register = jest.spyOn(f.service, 'registerAiBranchPrompt').mockResolvedValue({
      workId,
      releaseId,
      generatedSceneId,
      sourceSceneKey: 'ai-route-0001',
      created: true,
    });
    const title = { ko: '민간 구조를 향해' };
    const beats = [{ beatType: 'paragraph' as const, content: { ko: `첫 장면 ${'가'.repeat(3_000)}` } },
      { beatType: 'paragraph' as const, content: { ko: '가'.repeat(3_100) } }];
    f.scene.title = title;
    f.prisma.storyAiGeneratedBeat.findMany.mockResolvedValue(beats.map((beat, index) => ({ ...beat, position: index + 1 })));

    await expect(f.service.registerGeneratedContinuationPrompt(continuationId, {
      title,
      beats,
      visualManifest: {
        sceneKey: 'ai-route-0001',
        background: { state: 'fallback', altKey: 'story.visual.fallback' },
        characters: [],
        fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' },
      },
      nextChoices: [],
      usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, imageUnits: 0 },
    })).resolves.toMatchObject({ created: true });

    expect(register).toHaveBeenCalledWith(workId, generatedSceneId, expect.objectContaining({
      releaseId,
      releaseChecksum: checksum,
      promptText: expect.stringContaining('Scene title: 민간 구조를 향해'),
    }));
    const promptText = register.mock.calls[0][2].promptText;
    expect(Array.from(promptText.split('Scene text: ')[1])).toHaveLength(6_000);
    expect(provider).not.toHaveBeenCalled();
  });

  it('binds the exact approved visual direction and cast to an AI branch image prompt', async () => {
    const f = storedBranchFixture();
    const continuationId = '00000000-0000-4000-8000-000000000008';
    const generatedSceneId = '00000000-0000-4000-8000-000000000007';
    const approvedSettings = {
      schemaVersion: 'creator-generation-profile-v1' as const,
      kind: 'story' as const,
      sections: [
        { key: 'visual_direction', decision: 'accepted' as const,
          value: { era: 'Joseon naval war', palette: 'sea blue and ember' }, evidence: [] },
        { key: 'visual_cast', decision: 'edited' as const,
          value: { admiral: 'fixed face, black beard, red military robe' }, evidence: [] },
      ],
    };
    const normalizedSettings = normalizeCreatorGenerationProfile('story', approvedSettings);
    const sourceFingerprint = 'a'.repeat(64);
    const profile = {
      id: 'profile-id', status: 'approved', profileVersion: 1, reviewRevision: 2,
      sourceFingerprint, approvedSettings: normalizedSettings,
      approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, normalizedSettings),
    };
    const snapshot = continuationGenerationProfileSnapshot(profile as never);
    f.prisma.storyAiContinuation.findFirst.mockResolvedValue({
      ...f.continuation,
      manuscriptVersionId: 'manuscript-id', analysisJobId: 'analysis-id',
      contextReferences: { generationProfilePin: snapshot.pin },
    });
    f.prisma.storyWorkGenerationProfile.findFirst.mockResolvedValue(profile);
    const register = jest.spyOn(f.service, 'registerAiBranchPrompt').mockResolvedValue({
      workId, releaseId, generatedSceneId, sourceSceneKey: 'ai-route-0001', created: true,
    });

    await f.service.registerGeneratedContinuationPrompt(continuationId, {
      title: { ko: '불길 속의 선택' },
      beats: [{ beatType: 'paragraph', content: { ko: '그는 불타는 갑판으로 돌아섰다.' } }],
      visualManifest: {}, nextChoices: [],
      usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, imageUnits: 0 },
    });

    const promptText = register.mock.calls[0][2].promptText;
    expect(promptText).toContain('exact creator-approved visual identity');
    expect(promptText).toContain('Joseon naval war');
    expect(promptText).toContain('fixed face, black beard, red military robe');
    expect(promptText).not.toContain('writing_style');
  });

  it.each(['title', 'prose', 'late_prose'])('does not register another narrative as the stored branch (%s)', async change => {
    const f = storedBranchFixture();
    const result = structuredClone(f.result);
    if (change === 'title') result.title.ko = 'Another branch';
    else if (change === 'prose') result.beats[0].content.ko = 'Another outcome';
    else {
      const long = [{ beatType: 'paragraph' as const, content: { ko: 'A'.repeat(7000) } }];
      f.prisma.storyAiGeneratedBeat.findMany.mockResolvedValue([{ ...long[0], position: 1 }]);
      result.beats = [{ ...long[0], content: { ko: `${'A'.repeat(6999)}B` } }];
    }
    await expect(f.service.registerGeneratedContinuationPrompt(f.continuationId, result))
      .rejects.toMatchObject({ response: { code: 'STORY_VISUAL_BRANCH_SOURCE_CHANGED' } });
    expect(f.prisma.storyVisualPrompt.create).not.toHaveBeenCalled();
  });

  it.each(['missing_scene', 'wrong_scene_key', 'missing_result_checksum', 'changed_release'])('fails closed before prompt registration for %s', async change => {
    const f = storedBranchFixture();
    if (change === 'missing_scene') f.prisma.storyAiGeneratedScene.findFirst.mockResolvedValue(null);
    else if (change === 'wrong_scene_key') f.scene.sceneKey = 'ai-another-scene';
    else if (change === 'missing_result_checksum') f.scene.resultChecksum = '';
    else f.continuation.releaseChecksum = 'e'.repeat(64);
    await expect(f.service.registerGeneratedContinuationPrompt(f.continuationId, f.result))
      .rejects.toMatchObject({ response: { code: 'STORY_VISUAL_BRANCH_SOURCE_CHANGED' } });
    expect(f.prisma.storyVisualPrompt.create).not.toHaveBeenCalled();
  });

  it('queries only the exact stored continuation scope and bounds the beat read', async () => {
    const f = storedBranchFixture();
    jest.spyOn(f.service, 'registerAiBranchPrompt').mockResolvedValue({ created: true } as never);
    await f.service.registerGeneratedContinuationPrompt(f.continuationId, f.result);
    expect(f.prisma.storyAiGeneratedScene.findFirst).toHaveBeenCalledWith({ where: {
      id: f.generatedSceneId, continuationId: f.continuationId, workId, releaseId, userId: 'reader-id',
      progressId, sourcePartId: partId, status: 'ready',
    }, select: { id: true, sceneKey: true, title: true, resultChecksum: true } });
    expect(f.prisma.storyAiGeneratedBeat.findMany).toHaveBeenCalledWith({ where: { sceneId: f.generatedSceneId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }], take: 41, select: { position: true, beatType: true, content: true } });
  });

  it('does not inject a newly selected artist when the continuation had no participant pin', async () => {
    const participants = { pinnedContext: jest.fn().mockResolvedValue({ approved: { displayName: 'Other route artist' } }) };
    const f = storedBranchFixture(fixture(true, participants));
    const register = jest.spyOn(f.service, 'registerAiBranchPrompt').mockResolvedValue({ created: true } as never);
    await f.service.registerGeneratedContinuationPrompt(f.continuationId, f.result);
    expect(participants.pinnedContext).not.toHaveBeenCalled();
    expect(register.mock.calls[0][2].promptText).not.toContain('Other route artist');
  });

  it('does not transmit current artist reference images for a branch with no original participant pin', async () => {
    const participants = { pinnedContext: jest.fn(), visualReferences: jest.fn().mockResolvedValue({
      participantFingerprint: 'd'.repeat(64), references: [{ assetId: 'new-route-asset', checksum: 'e'.repeat(64) }],
    }) };
    const f = storedBranchFixture(fixture(false, participants));
    f.prisma.storyReaderProgress.findFirst.mockResolvedValue({ workId, currentSceneId: null,
      currentGeneratedSceneId: f.generatedSceneId, activeReleaseId: releaseId });
    f.prisma.storyAiGeneratedScene.findFirst.mockResolvedValue({ ...f.scene, continuationId: f.continuationId,
      workId, releaseId, userId: 'reader-id' });
    const generate = jest.spyOn(f.service as any, 'generate').mockResolvedValue({ status: 'unavailable' });
    await f.service.requestForProgress('reader-id', progressId, f.scene.sceneKey);
    expect(generate).toHaveBeenCalledWith(workId, releaseId, checksum, f.scene.sceneKey, undefined, false,
      { key: 'default', participantFingerprint: null, references: [] });
    await expect(f.service.variantKeyForProgress(progressId)).resolves.toBe('default');
    expect(participants.pinnedContext).not.toHaveBeenCalled();
    expect(participants.visualReferences).not.toHaveBeenCalled();
  });

  it.each(['same', 'changed_reference', 'changed_pin'])('uses the frozen branch artist reference variant (%s)', async change => {
    const pin = { identityProfileId: 'profile-id', participantFingerprint: 'd'.repeat(64),
      referenceAssetIds: ['asset-id'], referenceChecksums: ['e'.repeat(64)] };
    const participants = {
      pinnedContext: jest.fn().mockResolvedValue({ pin: { ...pin, ...(change === 'changed_pin' ? { identityProfileId: 'other-profile' } : {}) },
        approved: { visualIdentityReady: true } }),
      visualReferences: jest.fn().mockResolvedValue({ participantFingerprint: pin.participantFingerprint,
        references: [{ assetId: 'asset-id', checksum: change === 'changed_reference' ? 'f'.repeat(64) : pin.referenceChecksums[0] }] }),
    };
    const f = storedBranchFixture(fixture(false, participants));
    f.continuation.contextReferences.participantPin = pin;
    f.prisma.storyReaderProgress.findFirst.mockResolvedValue({ currentGeneratedSceneId: f.generatedSceneId });
    f.prisma.storyAiGeneratedScene.findFirst.mockResolvedValue({ ...f.scene, continuationId: f.continuationId,
      workId, releaseId, userId: 'reader-id' });
    if (change === 'same') await expect(f.service.variantKeyForProgress(progressId)).resolves.toBe(`artist:${pin.participantFingerprint}`);
    else {
      await expect(f.service.variantKeyForProgress(progressId)).resolves.toBeNull();
      f.prisma.storyReaderProgress.findFirst.mockResolvedValue({ workId, currentGeneratedSceneId: f.generatedSceneId,
        activeReleaseId: releaseId });
      await expect(f.service.requestForProgress('reader-id', progressId, f.scene.sceneKey))
        .rejects.toMatchObject({ response: { code: 'STORY_VISUAL_PROFILE_CHANGED' } });
    }
    expect(f.prisma.asset.create).not.toHaveBeenCalled();
  });

  it('does not hide an infrastructure failure while resolving reader artwork', async () => {
    const f = fixture(false);
    f.prisma.storyReaderProgress.findFirst.mockRejectedValue(new Error('Database unavailable'));
    await expect(f.service.variantKeyForProgress(progressId)).rejects.toThrow('Database unavailable');
  });

  it('does not skip a fixed branch participant check when there is no author profile pin', async () => {
    const expectedPin = { identityProfileId: 'original-profile' };
    const participants = { pinnedContext: jest.fn().mockResolvedValue({ pin: { identityProfileId: 'other-profile' },
      approved: { visualIdentityReady: true } }) };
    const f = storedBranchFixture(fixture(false, participants));
    f.continuation.contextReferences.participantPin = expectedPin;
    f.prisma.storyAiGeneratedScene.findFirst.mockResolvedValue({ id: f.generatedSceneId, continuationId: f.continuationId });
    await expect((f.service as any).assertPromptApprovalCurrent(f.prisma, workId, releaseId,
      { sourceKind: 'ai_branch', sourceSceneKey: f.scene.sceneKey }, {}))
      .rejects.toMatchObject({ response: { code: 'STORY_VISUAL_PROFILE_CHANGED' } });
    expect(participants.pinnedContext).toHaveBeenCalledWith(f.prisma, progressId);
  });

  it.each(['participant_lookup', 'continuation_lookup', 'missing_continuation'])('distinguishes infrastructure failures from stale branch approval (%s)', async failure => {
    const error = new Error('Synthetic database unavailable');
    const participants = { pinnedContext: jest.fn().mockRejectedValue(error) };
    const f = storedBranchFixture(fixture(false, participants));
    f.continuation.contextReferences.participantPin = { identityProfileId: 'original-profile' };
    if (failure === 'continuation_lookup') f.prisma.storyAiContinuation.findFirst.mockRejectedValue(error);
    if (failure === 'missing_continuation') f.prisma.storyAiContinuation.findFirst.mockResolvedValue(null);
    const approval = (f.service as any).assertPromptApprovalCurrent(f.prisma, workId, releaseId,
      { sourceKind: 'ai_branch', sourceSceneKey: f.scene.sceneKey }, {});
    if (failure === 'missing_continuation') {
      await expect(approval).rejects.toMatchObject({ response: { code: 'STORY_VISUAL_PROFILE_CHANGED' } });
    } else await expect(approval).rejects.toBe(error);
    expect(f.prisma.asset.create).not.toHaveBeenCalled();
  });

  it('does not report an existing branch prompt as stale approval after a participant database error', async () => {
    const error = new Error('Synthetic database unavailable');
    const participants = { pinnedContext: jest.fn().mockRejectedValue(error) };
    const f = storedBranchFixture(fixture(false, participants));
    f.continuation.contextReferences.participantPin = { identityProfileId: 'original-profile' };
    f.prisma.storyVisualPrompt.findMany.mockResolvedValue([{ sourceSceneKey: f.scene.sceneKey,
      sourceKind: 'ai_branch', promptText: 'Stored private branch direction' }]);
    await expect(f.service.promptKeys(workId, releaseId, [f.scene.sceneKey])).rejects.toBe(error);
    expect(f.prisma.storyVisualPrompt.create).not.toHaveBeenCalled();
  });

  it('does not misclassify a participant database error as changed approval during prompt registration', async () => {
    const error = new Error('Synthetic database unavailable');
    const participants = { pinnedContext: jest.fn().mockRejectedValue(error) };
    const f = storedBranchFixture(fixture(false, participants));
    f.continuation.contextReferences.participantPin = { identityProfileId: 'original-profile' };
    await expect(f.service.registerGeneratedContinuationPrompt(f.continuationId, f.result)).rejects.toBe(error);
    expect(f.prisma.storyVisualPrompt.create).not.toHaveBeenCalled();
  });

  it.each(['same', 'changed', 'missing', 'unready', 'oversized'])('uses only the original fixed participant identity (%s)', async change => {
    const pin = { id: 'participant-id', artistId: 'artist-id', participantFingerprint: 'd'.repeat(64),
      identityProfileId: 'identity-id', identityProfileVersion: 1, identityReviewRevision: 2,
      identitySourceFingerprint: 'e'.repeat(64), identityApprovedFingerprint: 'f'.repeat(64),
      referenceAssetIds: ['asset-id'], referenceChecksums: ['a'.repeat(64)] };
    const current = { pin: { ...pin }, approved: { visualIdentityReady: true, displayName: 'Fixed artist',
      identityProfile: { bodyProportions: 'An adult with consistent fixed proportions' } } };
    if (change === 'changed') current.pin.identityReviewRevision++;
    if (change === 'unready') current.approved.visualIdentityReady = false;
    if (change === 'oversized') current.approved.identityProfile.bodyProportions = 'x'.repeat(12001);
    const participants = { pinnedContext: jest.fn().mockResolvedValue(change === 'missing' ? null : current) };
    const f = storedBranchFixture(fixture(true, participants));
    f.continuation.contextReferences.participantPin = pin;
    const register = jest.spyOn(f.service, 'registerAiBranchPrompt').mockResolvedValue({ created: true } as never);
    if (change === 'same') {
      await f.service.registerGeneratedContinuationPrompt(f.continuationId, f.result);
      expect(register.mock.calls[0][2].promptText).toContain('consistent fixed proportions');
    } else {
      await expect(f.service.registerGeneratedContinuationPrompt(f.continuationId, f.result))
        .rejects.toMatchObject({ response: { code: 'STORY_VISUAL_PROFILE_CHANGED' } });
      expect(register).not.toHaveBeenCalled();
    }
  });
});

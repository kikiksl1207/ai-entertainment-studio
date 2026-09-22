import { StoryVisualGenerationService } from './story-visual-generation.service';
import * as sharp from 'sharp';
import { createHash } from 'crypto';

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

  function fixture(enabled = true) {
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
      storyBeat: { findFirst: jest.fn().mockResolvedValue({ id: 'beat-id' }),
        findMany: jest.fn().mockResolvedValue([{ content: { ko: '이순신은 늘 같은 검은 수염과 붉은 철릭 차림으로 갑판에 섰다.' } }]) },
      storyVisualPrompt: {
        findUnique: jest.fn().mockResolvedValue({ workId, releaseId, releaseChecksum: checksum,
          sourceSceneKey, promptSha256, promptText: 'A sufficiently detailed private scene image direction.' }),
        findMany: jest.fn(async (args: any) => args?.select?.promptText
          ? [{ promptText: 'Joseon naval historical drama, restrained sea-blue and ember palette. Recurring officers keep identical faces and uniforms.' }]
          : [{ sourceSceneKey }]),
        create: jest.fn(),
      },
      storyAiGeneratedScene: { findFirst: jest.fn() },
      storyVisualGeneration: {
        findUnique: jest.fn(async () => generation),
        findUniqueOrThrow: jest.fn(async () => generation),
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(async ({ data }: any) => (generation = { id: 'generation-id', status: 'pending',
          attemptCount: 0, updatedAt: new Date(), assetId: null, ...data })),
        updateMany: jest.fn(async ({ data }: any) => {
          if (generation?.status === 'ready' && !data.status &&
              String(data.lastErrorCode).startsWith('STALE_REPLACEMENT_IN_PROGRESS_')) {
            generation = { ...generation, ...data };
            return { count: 1 };
          }
          if (generation?.status === 'ready' && data.status === 'ready') {
            generation = { ...generation, ...data };
            return { count: 1 };
          }
          if (generation && ['pending', 'failed'].includes(generation.status) && data.status === 'generating') {
            generation = { ...generation, status: data.status,
              attemptCount: data.attemptCount ? generation.attemptCount + 1 : generation.attemptCount,
              updatedAt: data.updatedAt };
            return { count: 1 };
          }
          if (generation?.status === 'ready' && data.status === 'generating') {
            generation = { ...generation, ...data,
              attemptCount: data.attemptCount ? generation.attemptCount + 1 : generation.attemptCount };
            return { count: 1 };
          }
          if (generation?.status === 'generating' && ['failed', 'ready'].includes(data.status)) {
            generation = { ...generation, ...data };
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
    };
    const values: Record<string, string> = {
      STORY_IMAGE_GENERATION_ENABLED: enabled ? 'true' : 'false',
      OPENAI_API_KEY: 'test-key',
      OPENAI_IMAGE_MODEL: 'gpt-image-2',
      OPENAI_IMAGE_QUALITY: 'medium',
      OPENAI_IMAGE_SIZE: '1536x1024',
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
    return { prisma, config, service: new StoryVisualGenerationService(prisma, config as never),
      generation: () => generation, setGeneration: (value: any) => { generation = value; },
      setConfig: (key: string, value: string) => { values[key] = value; } };
  }

  afterEach(() => jest.restoreAllMocks());

  it('projects only prompt keys and never private prompt text', async () => {
    const f = fixture();
    await expect(f.service.promptKeys(workId, releaseId, [sourceSceneKey, sourceSceneKey, '../private']))
      .resolves.toEqual(new Set([sourceSceneKey]));
    expect(f.prisma.storyVisualPrompt.findMany).toHaveBeenCalledWith({
      where: { workId, releaseId, sourceSceneKey: { in: [sourceSceneKey] } },
      select: { sourceSceneKey: true },
    });
  });

  it('returns unavailable without calling a provider when generation is disabled', async () => {
    const f = fixture(false);
    const provider = jest.spyOn(global, 'fetch');
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey))
      .resolves.toEqual({ status: 'unavailable', reason: 'generation_disabled' });
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
    f.prisma.storyAiGeneratedScene.findFirst.mockResolvedValue({ id: generatedSceneId });

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
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toEqual({
      status: 'ready', sourceSceneKey,
      publicAssetPath: `/api/v1/story-visual-assets/${assetId}`, reused: true,
    });
    expect(provider).toHaveBeenCalledTimes(2);
    const providerBody = JSON.parse(String((provider.mock.calls[0][1] as RequestInit).body));
    expect(providerBody.prompt).toContain('[PRIVATE VISUAL BIBLE story-visual-bible-v1]');
    expect(providerBody.prompt).toContain('[RECURRING CHARACTER APPEARANCE LOCK]');
    expect(providerBody.prompt).toContain('Joseon naval historical drama');
    expect(providerBody.prompt).toContain('이순신은 늘 같은 검은 수염과 붉은 철릭');
    expect(providerBody.prompt).toContain('A sufficiently detailed private scene image direction.');
    expect(f.prisma.storyVisualGeneration.create).toHaveBeenCalledTimes(1);
    expect(f.prisma.asset.create).toHaveBeenCalledTimes(1);
    const storedMetadata = f.prisma.asset.create.mock.calls[0][0].data.metadata;
    expect(storedMetadata.storyVisual).toMatchObject({
      visualBibleVersion: 'story-visual-bible-v1',
      visualBibleFingerprint: expect.stringMatching(/^[a-f0-9]{20}$/),
      effectivePromptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(storedMetadata)).not.toContain('A sufficiently detailed private scene image direction.');
    expect(JSON.stringify(storedMetadata)).not.toContain('Joseon naval historical drama');
    expect(f.generation()).toMatchObject({ status: 'ready', attemptCount: 1, assetId });
  });

  it('applies the same work bible to an AI branch scene without exposing its prose', async () => {
    const f = fixture();
    const generatedSceneId = '00000000-0000-4000-8000-000000000007';
    const generatedSceneKey = 'ai-reader-route-0001';
    const branchPrompt = 'Private generated branch prose and scene direction.';
    f.prisma.storyReaderProgress.findFirst.mockResolvedValue({
      workId, currentSceneId: null, currentGeneratedSceneId: generatedSceneId, activeReleaseId: releaseId,
    });
    f.prisma.storyAiGeneratedScene.findFirst.mockResolvedValue({ id: generatedSceneId });
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

  it('never replaces a legacy ready asset from the reader endpoint or automatic path', async () => {
    const f = fixture();
    f.setGeneration({ id: 'generation-id', workId, releaseId, releaseChecksum: checksum, sourceSceneKey,
      promptSha256, status: 'ready', attemptCount: 1, updatedAt: new Date(), assetId });
    const provider = jest.spyOn(global, 'fetch');

    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toEqual({
      status: 'ready', sourceSceneKey, publicAssetPath: `/api/v1/story-visual-assets/${assetId}`, reused: true,
    });

    expect(provider).not.toHaveBeenCalled();
    expect(f.prisma.asset.findFirst).not.toHaveBeenCalled();
    expect(f.generation()).toMatchObject({ status: 'ready', assetId, attemptCount: 1 });
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
      status: 'ready', sourceSceneKey,
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
      visualBibleVersion: 'story-visual-bible-v1',
      effectivePromptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const effectivePromptSha256 = createdMetadata.storyVisual.effectivePromptSha256;
    expect(String(provider.mock.calls[1][0])).toContain(effectivePromptSha256);

    f.prisma.asset.findFirst.mockResolvedValue({ id: replacementAssetId, metadata: createdMetadata });
    await expect(f.service.replaceStale(workId, input)).resolves.toEqual({
      status: 'ready', sourceSceneKey,
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
      status: 'ready', sourceSceneKey,
      publicAssetPath: `/api/v1/story-visual-assets/${highQualityAssetId}`, reused: false,
    });
    expect(provider).toHaveBeenCalledTimes(4);
    expect(f.prisma.asset.create.mock.calls[1][0].data.metadata.storyVisual).toMatchObject({
      replacesAssetId: replacementAssetId,
      quality: 'high',
    });
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
      status: 'failed', sourceSceneKey, retryable: false,
    });
    expect(f.generation()).toMatchObject({
      status: 'ready', assetId, attemptCount: 1,
      lastErrorCode: expect.stringMatching(/^STALE_REPLACEMENT_FAILED_[a-f0-9]{40}$/),
    });

    await expect(f.service.replaceStale(workId, input)).resolves.toEqual({
      status: 'failed', sourceSceneKey, retryable: false,
    });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(f.prisma.asset.create).not.toHaveBeenCalled();
    expect(f.generation()).toMatchObject({ status: 'ready', assetId, attemptCount: 1 });
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
      .resolves.toEqual({ status: 'processing', sourceSceneKey });
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

  it('keeps a generated beta image in the database when object storage rejects the upload', async () => {
    const f = fixture();
    const image = await sharp({
      create: { width: 1536, height: 1024, channels: 3, background: '#556677' },
    }).webp().toBuffer();
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ b64_json: image.toString('base64') }] }) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 403 } as Response);

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
  });

  it('serves a verified database fallback image from the public story endpoint', async () => {
    const f = fixture();
    const image = await sharp({
      create: { width: 1536, height: 1024, channels: 3, background: '#778899' },
    }).webp().toBuffer();
    f.prisma.asset.findFirst = jest.fn().mockResolvedValue({
      id: assetId,
      storageProvider: 'database',
      mimeType: 'image/webp',
      fileSizeBytes: BigInt(image.length),
      checksum: createHash('sha256').update(image).digest('hex'),
      metadata: {
        storyVisual: { workId, sourceSceneKey, inlineImage: { encoding: 'base64', data: image.toString('base64') } },
      },
    });

    await expect(f.service.publicVisualAsset(assetId)).resolves.toEqual({
      kind: 'inline', mimeType: 'image/webp', image,
    });
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
    f.prisma.storyVisualGeneration.count.mockResolvedValue(80);
    const provider = jest.spyOn(global, 'fetch');

    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toEqual({
      status: 'unavailable', reason: 'beta_generation_limit_reached',
    });
    expect(provider).not.toHaveBeenCalled();
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
    const f = fixture();
    const provider = jest.spyOn(global, 'fetch');
    const continuationId = '00000000-0000-4000-8000-000000000008';
    const generatedSceneId = '00000000-0000-4000-8000-000000000007';
    f.prisma.storyAiContinuation.findFirst.mockResolvedValue({
      workId,
      releaseId,
      resultGeneratedSceneId: generatedSceneId,
    });
    const register = jest.spyOn(f.service, 'registerAiBranchPrompt').mockResolvedValue({
      workId,
      releaseId,
      generatedSceneId,
      sourceSceneKey: 'ai-route-0001',
      created: true,
    });
    const longTail = '가'.repeat(6_100);

    await expect(f.service.registerGeneratedContinuationPrompt(continuationId, {
      title: { ko: '민간 구조를 향해' },
      beats: [{ beatType: 'paragraph', content: { ko: `첫 장면 ${longTail}` } }],
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
});

import { StoryVisualGenerationService } from './story-visual-generation.service';
import * as sharp from 'sharp';

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
      storyReaderProgress: { findFirst: jest.fn().mockResolvedValue({ workId, currentSceneId: sceneId, activeReleaseId: releaseId }) },
      storyScene: { findFirst: jest.fn().mockResolvedValue({ id: sceneId, sceneKey: 'part-001-main', partId }) },
      storyPart: { findFirst: jest.fn().mockResolvedValue({ id: partId }), findMany: jest.fn() },
      storyWork: { findFirst: jest.fn().mockResolvedValue({ id: workId, activeReleaseId: releaseId }) },
      storyRelease: { findFirst: jest.fn().mockResolvedValue({ id: releaseId, checksum }) },
      storyBeat: { findFirst: jest.fn().mockResolvedValue({ id: 'beat-id' }), findMany: jest.fn() },
      storyVisualPrompt: {
        findUnique: jest.fn().mockResolvedValue({ workId, releaseId, releaseChecksum: checksum,
          sourceSceneKey, promptSha256, promptText: 'A sufficiently detailed private scene image direction.' }),
        findMany: jest.fn().mockResolvedValue([{ sourceSceneKey }]),
      },
      storyVisualGeneration: {
        findUnique: jest.fn(async () => generation),
        findUniqueOrThrow: jest.fn(async () => generation),
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(async ({ data }: any) => (generation = { id: 'generation-id', status: 'pending',
          attemptCount: 0, updatedAt: new Date(), assetId: null, ...data })),
        updateMany: jest.fn(async ({ data }: any) => {
          if (generation?.status === 'pending') {
            generation = { ...generation, status: data.status, attemptCount: generation.attemptCount + 1,
              updatedAt: data.updatedAt };
            return { count: 1 };
          }
          if (generation?.status === 'generating' && data.status === 'failed') {
            generation = { ...generation, ...data };
            return { count: 1 };
          }
          return { count: 0 };
        }),
        update: jest.fn(async ({ data }: any) => (generation = { ...generation, ...data })),
      },
      asset: {
        create: jest.fn().mockResolvedValue({ id: assetId }),
        findMany: jest.fn().mockResolvedValue([]),
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
    };
    const config = { get: jest.fn((key: string) => values[key]) };
    return { prisma, config, service: new StoryVisualGenerationService(prisma, config as never),
      generation: () => generation };
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
      publicAssetPath: `/api/v1/assets/public/${assetId}/original`, reused: false,
    });
    await expect(f.service.requestForProgress('user-id', progressId, sourceSceneKey)).resolves.toEqual({
      status: 'ready', sourceSceneKey,
      publicAssetPath: `/api/v1/assets/public/${assetId}/original`, reused: true,
    });
    expect(provider).toHaveBeenCalledTimes(2);
    expect(f.prisma.storyVisualGeneration.create).toHaveBeenCalledTimes(1);
    expect(f.prisma.asset.create).toHaveBeenCalledTimes(1);
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
});

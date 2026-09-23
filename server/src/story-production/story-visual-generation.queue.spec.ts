import { StoryVisualGenerationQueue } from './story-visual-generation.queue';

describe('StoryVisualGenerationQueue', () => {
  const workId = '00000000-0000-4000-8000-000000000001';
  const releaseId = '00000000-0000-4000-8000-000000000002';
  const checksum = 'a'.repeat(64);
  const now = new Date('2026-09-22T00:00:00.000Z');

  function fixture(overrides: Record<string, string> = {}) {
    const generations: any[] = [];
    const prompts = [
      { sourceSceneKey: 'reached-scene', sourceKind: 'authored_import', createdAt: now },
      { sourceSceneKey: 'key-scene', sourceKind: 'authored_import', createdAt: now },
      { sourceSceneKey: 'branch-scene', sourceKind: 'ai_branch', createdAt: now },
      { sourceSceneKey: 'remaining-scene', sourceKind: 'authored_import', createdAt: now },
    ].map((row, index) => ({ workId, releaseId, releaseChecksum: checksum,
      promptSha256: String(index + 1).repeat(64), ...row }));
    const prisma: any = {
      storyWork: { findMany: jest.fn().mockResolvedValue([{ id: workId,
        slug: 'records-of-the-burning-sea-imjin-war', activeReleaseId: releaseId }]) },
      storyRelease: { findFirst: jest.fn().mockResolvedValue({ id: releaseId, checksum }) },
      storyVisualPrompt: {
        findMany: jest.fn().mockResolvedValue(prompts),
        count: jest.fn().mockResolvedValue(prompts.length),
      },
      storyVisualGeneration: {
        findMany: jest.fn(async ({ where, select }: any) => {
          if (where?.status === 'failed') return [];
          if (where?.OR) return generations.filter(row => row.status === 'pending').map(row => ({ ...row, updatedAt: now }));
          return generations.map(row => {
            const projected: Record<string, unknown> = {};
            for (const key of Object.keys(select ?? row)) projected[key] = row[key];
            return projected;
          });
        }),
        count: jest.fn(async ({ where }: any) => where?.attemptCount ?
          generations.filter(row => row.attemptCount >= 1).length : generations.length),
        createMany: jest.fn(async ({ data }: any) => {
          for (const row of data) {
            if (!generations.some(existing => existing.sourceSceneKey === row.sourceSceneKey)) {
              generations.push({ ...row, status: 'pending', attemptCount: 0 });
            }
          }
          return { count: data.length };
        }),
      },
      storyReaderProgress: { findMany: jest.fn().mockResolvedValue([{ currentSceneId: 'current-scene-id',
        currentGeneratedSceneId: null }]) },
      storyScene: { findMany: jest.fn(async ({ where }: any) => where.id
        ? [{ id: 'current-scene-id', sceneKey: 'reached-scene' }]
        : [{ id: 'key-scene-id', partId: 'part-id', sceneKey: 'canonical', position: 1 }]) },
      storyBeat: { findMany: jest.fn(async ({ where }: any) => where.sceneId.in.includes('current-scene-id')
        ? [{ sourceSceneKey: 'reached-scene' }]
        : [{ sceneId: 'key-scene-id', position: 1, sourceSceneKey: 'key-scene' }]) },
      storyAiGeneratedScene: { findMany: jest.fn().mockResolvedValue([]) },
      storyPart: { findMany: jest.fn().mockResolvedValue([{ id: 'part-id', position: 1 }]) },
    };
    const values = { STORY_IMAGE_GENERATION_EMERGENCY_MAX_PER_WORK: '3', STORY_IMAGE_GENERATION_EMERGENCY_MAX_TOTAL: '3',
      STORY_IMAGE_DATABASE_FALLBACK_ENABLED: 'true', ...overrides };
    const config = { get: jest.fn((key: string) => values[key as keyof typeof values]) };
    return { queue: new StoryVisualGenerationQueue(prisma, config as never), prisma, generations };
  }

  it('queues reached, authored key, then AI branch scenes within both limits and is idempotent', async () => {
    const f = fixture();
    await expect(f.queue.sync()).resolves.toMatchObject({
      queuedCount: 3,
      priorities: { readerReached: 1, authoredKey: 1, aiBranch: 1, authoredRemaining: 0 },
    });
    expect(f.generations.map(row => row.sourceSceneKey)).toEqual(['reached-scene', 'key-scene', 'branch-scene']);

    await expect(f.queue.sync()).resolves.toMatchObject({ queuedCount: 0, limitReached: true });
    expect(f.prisma.storyVisualGeneration.createMany).toHaveBeenCalledTimes(1);
  });

  it('reserves no work after the global queue/generation limit is reached', async () => {
    const f = fixture({ STORY_IMAGE_GENERATION_EMERGENCY_MAX_TOTAL: '1' });
    f.prisma.storyVisualGeneration.count.mockResolvedValue(1);
    await expect(f.queue.sync()).resolves.toMatchObject({ queuedCount: 0, limitReached: true });
    expect(f.prisma.storyVisualGeneration.createMany).not.toHaveBeenCalled();
  });

  it('selects the highest-priority pending scene without exposing prompt text', async () => {
    const f = fixture();
    await f.queue.sync();
    await expect(f.queue.next()).resolves.toMatchObject({ sourceSceneKey: 'reached-scene', priority: 'reader_reached' });
    const status = await f.queue.status();
    expect(status.totals).toMatchObject({ prompts: 4, queued: 3 });
    expect(JSON.stringify(status)).not.toContain('promptText');
  });

  it('queues every distinct scene when no emergency limit is configured', async () => {
    const f = fixture({ STORY_IMAGE_GENERATION_EMERGENCY_MAX_PER_WORK: '',
      STORY_IMAGE_GENERATION_EMERGENCY_MAX_TOTAL: '' });
    await expect(f.queue.sync()).resolves.toMatchObject({ queuedCount: 4,
      limits: { perWork: null, total: null }, limitReached: false });
    await expect(f.queue.sync()).resolves.toMatchObject({ queuedCount: 0, limitReached: false });
    expect(f.generations).toHaveLength(4);
  });
});

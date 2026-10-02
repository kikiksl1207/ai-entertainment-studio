import { StoryVisualGenerationQueue } from './story-visual-generation.queue';
import { storyVisualBookingIdentity } from './story-visual-booking.policy';

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
      $transaction: jest.fn(async (run: any) => run(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([]),
      storyWork: { findMany: jest.fn().mockResolvedValue([{ id: workId,
        slug: 'records-of-the-burning-sea-imjin-war', activeReleaseId: releaseId }]),
        findFirst: jest.fn().mockResolvedValue({ id: workId, slug: 'records-of-the-burning-sea-imjin-war', activeReleaseId: releaseId }) },
      storyRelease: { findFirst: jest.fn().mockResolvedValue({ id: releaseId, checksum }) },
      storyVisualPrompt: {
        findMany: jest.fn().mockResolvedValue(prompts),
        count: jest.fn().mockResolvedValue(prompts.length),
      },
      storyVisualGeneration: {
        findMany: jest.fn(async ({ where, select }: any) => {
          if (where?.status === 'failed') return [];
          const scoped = generations.filter(row => !where.variantKey || (row.variantKey ?? 'default') === where.variantKey);
          if (where?.OR?.some((condition: any) => condition.status)) return scoped.filter(row => row.status === 'pending').map(row => ({ ...row, updatedAt: now }));
          const current = where?.OR ? scoped.filter(row => where.OR.some((binding: any) =>
            row.workId === binding.workId && row.releaseId === binding.releaseId && row.releaseChecksum === binding.releaseChecksum)) : scoped;
          return current.map(row => {
            const projected: Record<string, unknown> = {};
            for (const key of Object.keys(select ?? row)) projected[key] = row[key];
            return projected;
          });
        }),
        count: jest.fn(async ({ where }: any) => where?.attemptCount ?
          generations.filter(row => row.attemptCount >= 1).length : generations.length),
        createMany: jest.fn(async ({ data }: any) => {
          let count = 0;
          for (const row of data) {
            if (!generations.some(existing => existing.sourceSceneKey === row.sourceSceneKey &&
                (existing.variantKey ?? 'default') === row.variantKey)) {
              generations.push({ ...row, status: 'pending', attemptCount: 0 });
              count += 1;
            }
          }
          return { count };
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
    const values: Record<string, string> = { STORY_IMAGE_GENERATION_EMERGENCY_MAX_PER_WORK: '3', STORY_IMAGE_GENERATION_EMERGENCY_MAX_TOTAL: '3',
      STORY_IMAGE_DATABASE_FALLBACK_ENABLED: 'true', ...overrides };
    const config = { get: jest.fn((key: string) => values[key as keyof typeof values]) };
    const book = jest.fn(async (candidate: any) => storyVisualBookingIdentity({
      workId: candidate.workId, releaseId: candidate.releaseId, releaseChecksum: candidate.releaseChecksum,
      sourceSceneKey: candidate.sourceSceneKey, promptSha256: candidate.promptSha256, variantKey: 'default',
      sourceKind: 'authored_import', sourceBindingSha256: 'a'.repeat(64), visualBibleVersion: 'v1',
      visualBibleFingerprint: 'b'.repeat(64), authorApprovalIdentitySha256: null, sceneGuidanceApprovalSha256: null,
      coverSourceFingerprint: 'c'.repeat(64), workVisualReferenceChecksum: null, effectivePromptSha256: 'd'.repeat(64),
      provider: 'openai', model: 'gpt-image-2', quality: 'high', size: '1024x1536', requestContractVersion: 'v5',
    }));
    return { queue: new StoryVisualGenerationQueue(prisma, config as never, book), prisma, generations, book, values, prompts };
  }

  it('queues reached, authored key, then AI branch scenes within both limits and is idempotent', async () => {
    const f = fixture();
    await expect(f.queue.sync()).resolves.toMatchObject({
      queuedCount: 3,
      priorities: { readerReached: 1, authoredKey: 1, aiBranch: 1, authoredRemaining: 0 },
    });
    expect(f.generations.map(row => row.sourceSceneKey)).toEqual(['reached-scene', 'key-scene', 'branch-scene']);

    await expect(f.queue.sync()).resolves.toMatchObject({ queuedCount: 0, limitReached: true });
    expect(f.prisma.storyVisualGeneration.createMany).toHaveBeenCalledTimes(3);
  });

  it('does not admit new shared clone reservations but preserves the canonical candidate and legacy jobs', async () => {
    const f = fixture({ STORY_SHARED_BRANCH_VISUAL_REUSE_ENABLED: 'true',
      STORY_IMAGE_GENERATION_EMERGENCY_MAX_PER_WORK: '', STORY_IMAGE_GENERATION_EMERGENCY_MAX_TOTAL: '' });
    const cloneKey = 'ai-reuse-00000000-0000-4000-8000-000000000003';
    f.prompts[2].sourceSceneKey = cloneKey;
    await expect(f.queue.sync()).resolves.toMatchObject({ queuedCount: 3 });
    expect(f.generations.some(row => row.sourceSceneKey === cloneKey)).toBe(false);
    expect(f.book.mock.calls.some(([candidate]) => candidate.sourceSceneKey === cloneKey)).toBe(false);
    f.values.STORY_SHARED_BRANCH_VISUAL_REUSE_ENABLED = 'false';
    await expect(f.queue.sync()).resolves.toMatchObject({ queuedCount: 1 });
    const old = structuredClone(f.generations.find(row => row.sourceSceneKey === cloneKey));
    f.values.STORY_SHARED_BRANCH_VISUAL_REUSE_ENABLED = 'true';
    await f.queue.sync();
    expect(f.generations.find(row => row.sourceSceneKey === cloneKey)).toEqual(old);
  });

  it('rechecks shared routing inside admission after a flag changes while candidates are being collected', async () => {
    const f = fixture({ STORY_IMAGE_GENERATION_EMERGENCY_MAX_PER_WORK: '', STORY_IMAGE_GENERATION_EMERGENCY_MAX_TOTAL: '' });
    const cloneKey = 'ai-reuse-00000000-0000-4000-8000-000000000003';
    f.prompts[2].sourceSceneKey = cloneKey;
    f.prisma.$transaction.mockImplementation(async (run: any) => {
      f.values.STORY_SHARED_BRANCH_VISUAL_REUSE_ENABLED = 'true';
      return run(f.prisma);
    });
    await expect(f.queue.sync()).resolves.toMatchObject({ queuedCount: 3, blockedCount: 1 });
    expect(f.generations.some(row => row.sourceSceneKey === cloneKey)).toBe(false);
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

  it('stores immutable booking evidence once, and next uses the saved identity rather than reading a new approval', async () => {
    const f = fixture(); await f.queue.sync();
    const first = structuredClone(f.generations[0].bookingIdentity);
    f.book.mockRejectedValue(new Error('must not refresh existing reservations'));
    await f.queue.sync();
    expect((await f.queue.next())?.bookingIdentity).toEqual(first);
    expect(f.book).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(await f.queue.status())).not.toContain('identitySha256');
  });

  it('does not run missing, tampered, cross-release or cross-scene booking evidence', async () => {
    const f = fixture(); await f.queue.sync();
    f.generations[0].bookingIdentity = null;
    f.generations[1].bookingIdentity.effectivePromptSha256 = 'f'.repeat(64);
    f.generations[2].releaseChecksum = 'f'.repeat(64);
    f.generations[2].bookingIdentity = storyVisualBookingIdentity({ ...f.generations[2].bookingIdentity,
      sourceSceneKey: 'another-scene' });
    await expect(f.queue.next()).resolves.toBeNull();
    expect((await f.queue.status()).totals.unboundPending).toBe(1);
  });

  it('does not let a participating-artist variant consume the default scene reservation', async () => {
    const f = fixture(); f.generations.push({ workId, releaseId, sourceSceneKey: 'reached-scene',
      variantKey: 'artist:other', status: 'ready', attemptCount: 1 });
    f.prisma.storyVisualGeneration.count.mockResolvedValue(1);
    await f.queue.sync();
    expect(f.generations.some(row => row.variantKey === 'default' && row.sourceSceneKey === 'reached-scene')).toBe(true);
    expect((await f.queue.next())?.sourceSceneKey).toBe('reached-scene');
  });

  it('does not enqueue unapproved candidates or count concurrent duplicate admissions as new bookings', async () => {
    const f = fixture(); f.book.mockResolvedValue(null as never);
    await expect(f.queue.sync()).resolves.toMatchObject({ queuedCount: 0, blockedCount: 4, limitReached: false });
    expect(f.generations).toHaveLength(0);
    expect(f.prisma.storyVisualGeneration.createMany).not.toHaveBeenCalled();
    const collision = fixture(); collision.prisma.storyVisualGeneration.createMany.mockResolvedValue({ count: 0 });
    await expect(collision.queue.sync()).resolves.toMatchObject({ queuedCount: 0, blockedCount: 0 });
  });

  it('does not let blocked high-priority directions starve a later approved scene', async () => {
    const f = fixture({ STORY_IMAGE_GENERATION_EMERGENCY_MAX_TOTAL: '1' });
    const original = f.book.getMockImplementation()!;
    f.book.mockImplementation(async (candidate: any) => candidate.sourceSceneKey === 'remaining-scene'
      ? original(candidate) : null as never);
    await expect(f.queue.sync()).resolves.toMatchObject({ queuedCount: 1, blockedCount: 3 });
    expect(f.generations[0].sourceSceneKey).toBe('remaining-scene');
  });

  function generalWork(f: ReturnType<typeof fixture>, approved = true) {
    const work = { id: workId, slug: 'ordinary-author-story', activeReleaseId: releaseId };
    f.prisma.storyWork.findMany.mockResolvedValue([work]); f.prisma.storyWork.findFirst.mockResolvedValue(work);
    f.values.STORY_IMAGE_QUEUE_RELEASES = JSON.stringify([{ workId, releaseId, releaseChecksum: checksum }]);
    if (approved) {
      const original = f.book.getMockImplementation()!;
      f.book.mockImplementation(async (candidate: any) => storyVisualBookingIdentity({ ...await original(candidate),
        authorApprovalIdentitySha256: 'e'.repeat(64), sceneGuidanceApprovalSha256: 'f'.repeat(64) }));
    }
  }

  it('admits a specifically configured nonlegacy release only with author and scene approval evidence', async () => {
    const f = fixture(); generalWork(f);
    await expect(f.queue.sync()).resolves.toMatchObject({ eligibleWorkCount: 1, queuedCount: 3 });
    expect(f.generations[0].bookingIdentity.authorApprovalIdentitySha256).toBe('e'.repeat(64));
    expect((await f.queue.next())?.sourceSceneKey).toBe('reached-scene');
    expect(f.prisma.storyWork.findMany.mock.calls[0][0].where).toMatchObject({ fixtureSource: false, status: 'published',
      OR: expect.arrayContaining([{ id: workId, activeReleaseId: releaseId }]) });
    expect(f.prisma.storyWork.findFirst.mock.calls[0][0].where).toEqual({ id: workId, status: 'published', fixtureSource: false,
      activeReleaseId: releaseId });
  });

  it.each(['authorApprovalIdentitySha256', 'sceneGuidanceApprovalSha256'])('blocks an added release with missing %s', async field => {
    const f = fixture(); generalWork(f);
    const original = f.book.getMockImplementation()!;
    f.book.mockImplementation(async (candidate: any) => storyVisualBookingIdentity({ ...await original(candidate), [field]: null }));
    await expect(f.queue.sync()).resolves.toMatchObject({ queuedCount: 0, blockedCount: 4 });
    expect(f.prisma.storyVisualGeneration.createMany).not.toHaveBeenCalled();
  });

  it.each(['workId', 'releaseId', 'releaseChecksum'])('does not admit, select or summarize a configured %s mismatch', async field => {
    const f = fixture(); generalWork(f);
    f.values.STORY_IMAGE_QUEUE_RELEASES = JSON.stringify([{ workId, releaseId, releaseChecksum: checksum,
      [field]: field === 'releaseChecksum' ? 'f'.repeat(64) : '00000000-0000-4000-8000-000000000009' }]);
    await expect(f.queue.sync()).resolves.toMatchObject({ eligibleWorkCount: 0, queuedCount: 0 });
    await expect(f.queue.next()).resolves.toBeNull(); expect((await f.queue.status()).works).toEqual([]);
    expect(f.book).not.toHaveBeenCalled();
  });

  it('rechecks current DB scope and withdrawn configuration during admission without changing any existing booking', async () => {
    const moved = fixture(); generalWork(moved);
    moved.prisma.storyWork.findFirst.mockResolvedValue(null);
    await expect(moved.queue.sync()).resolves.toMatchObject({ queuedCount: 0, blockedCount: 4 });
    expect(moved.book).not.toHaveBeenCalled();
    const f = fixture(); generalWork(f);
    const original = f.book.getMockImplementation()!;
    f.book.mockImplementationOnce(async (candidate: any) => {
      f.values.STORY_IMAGE_QUEUE_RELEASES = '[]'; return original(candidate);
    });
    await expect(f.queue.sync()).resolves.toMatchObject({ queuedCount: 0, blockedCount: 4 });
    expect(f.prisma.storyVisualGeneration.createMany).not.toHaveBeenCalled();
  });

  it('withdraws added pending reservations without rebinding them and keeps legacy defaults without additions', async () => {
    const f = fixture(); generalWork(f); await f.queue.sync();
    const before = structuredClone(f.generations); f.values.STORY_IMAGE_QUEUE_RELEASES = '[]';
    await expect(f.queue.next()).resolves.toBeNull(); await expect(f.queue.sync()).resolves.toMatchObject({ queuedCount: 0 });
    expect(f.generations).toEqual(before); expect(f.book).toHaveBeenCalledTimes(3);
    const legacy = fixture(); expect((await legacy.queue.sync()).queuedCount).toBe(3);
  });

  it('will not execute a valid but unreviewed legacy booking transplanted into an added scope', async () => {
    const f = fixture(); generalWork(f); await f.queue.sync();
    for (const row of f.generations) row.bookingIdentity = storyVisualBookingIdentity({ ...row.bookingIdentity,
      authorApprovalIdentitySha256: null, sceneGuidanceApprovalSha256: null });
    await expect(f.queue.next()).resolves.toBeNull();
    await expect(f.queue.allowsCandidate(f.generations[0], f.prisma, f.generations[0].bookingIdentity)).resolves.toBe(false);
  });

  it('summarizes only exact active release rows, not stale work-wide images', async () => {
    const f = fixture(); generalWork(f); await f.queue.sync(); f.generations[0].status = 'ready';
    f.generations.push({ workId, releaseId: workId, releaseChecksum: checksum, status: 'ready', attemptCount: 1 });
    f.generations.push({ workId, releaseId, releaseChecksum: 'f'.repeat(64), status: 'pending', attemptCount: 0 });
    expect((await f.queue.status()).totals).toMatchObject({ ready: 1, queued: 2 });
    expect(f.prisma.storyVisualPrompt.count).toHaveBeenCalledWith({ where: { OR: [{ workId, releaseId, releaseChecksum: checksum }] } });
  });
});

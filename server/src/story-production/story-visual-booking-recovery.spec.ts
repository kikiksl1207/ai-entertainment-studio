import { StoryVisualGenerationQueue } from './story-visual-generation.queue';
import { storyVisualBookingIdentity } from './story-visual-booking.policy';
import { ReprepareStoryVisualBookingDto } from './dto/story-visual-generation.dto';
import { validate } from 'class-validator';

describe('Explicit unspent visual booking recovery', () => {
  const workId = '00000000-0000-4000-8000-000000000001';
  const releaseId = '00000000-0000-4000-8000-000000000002';
  const owner = '00000000-0000-4000-8000-000000000003';
  const id = '00000000-0000-4000-8000-000000000004';
  const checksum = 'a'.repeat(64), promptSha256 = 'b'.repeat(64);
  function fixture() {
    const rows: any[] = [{ id, workId, releaseId, releaseChecksum: checksum, sourceSceneKey: 'part-1-main',
      promptSha256, variantKey: 'default', bookingIdentity: null, status: 'pending', attemptCount: 0,
      assetId: null, startedAt: null, completedAt: null, lastErrorCode: null, updatedAt: new Date(0) }];
    const values: Record<string, string> = {};
    const book = jest.fn(async (candidate: any) => storyVisualBookingIdentity({
      ...candidate, variantKey: 'default', sourceKind: 'studio_reviewed', sourceBindingSha256: 'c'.repeat(64),
      visualBibleVersion: 'v1', visualBibleFingerprint: 'd'.repeat(20), authorApprovalIdentitySha256: 'e'.repeat(64),
      sceneGuidanceApprovalSha256: 'f'.repeat(64), coverSourceFingerprint: 'a'.repeat(64), workVisualReferenceChecksum: null,
      effectivePromptSha256: 'b'.repeat(64), provider: 'openai', model: 'gpt-image-2', quality: 'high', size: '1024x1536', requestContractVersion: 'v5',
    }));
    const prisma: any = {
      $transaction: jest.fn(async (action: any) => action(prisma)), $queryRaw: jest.fn().mockResolvedValue([]),
      storyWork: { findFirst: jest.fn(async ({ where }: any) => where.ownerUserId && where.ownerUserId !== owner ? null
        : { id: workId, slug: 'records-of-the-burning-sea-imjin-war', activeReleaseId: releaseId }) },
      storyRelease: { findFirst: jest.fn().mockResolvedValue({ id: releaseId, checksum }) },
      storyVisualGeneration: {
        findMany: jest.fn(async ({ where, take }: any) => rows.filter(row => row.workId === where.workId && row.releaseId === where.releaseId &&
          row.variantKey === where.variantKey && (!where.id?.gt || row.id > where.id.gt)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, take)),
        findUnique: jest.fn(async ({ where }: any) => rows.find(row => row.id === where.id) ?? null),
        count: jest.fn(async ({ where }: any) => rows.filter(row => (!where.workId || row.workId === where.workId) &&
          (!where.releaseId || row.releaseId === where.releaseId) && (row.attemptCount >= 1 || ['pending', 'generating'].includes(row.status))).length),
        update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find(row => row.id === where.id), data)),
      }, auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit' }) },
    };
    const queue = new StoryVisualGenerationQueue(prisma, { get: (key: string) => values[key] } as never, book);
    const input = async () => {
      const review = (await queue.bookingReview(workId)).items[0];
      return { generationId: review.generationId, releaseId, releaseChecksum: checksum, sourceSceneKey: review.sourceSceneKey,
        promptSha256, expectedReviewSha256: review.reviewSha256!, expectedCurrentBookingIdentitySha256: review.currentBookingIdentitySha256!,
        confirmedResume: true as const };
    };
    return { rows, prisma, values, queue, book, input };
  }

  it('reviews without mutation or private prompt/row data, then rebinds only the selected old unbound reservation', async () => {
    const f = fixture(); const review = await f.queue.bookingReview(workId);
    expect(review.items[0]).toMatchObject({ reason: 'unbound', canReprepare: true });
    expect(f.prisma.storyVisualGeneration.update).not.toHaveBeenCalled(); expect(f.prisma.auditEvent.create).not.toHaveBeenCalled();
    expect(JSON.stringify(review)).not.toMatch(/bookingIdentity"|promptText|ownerUserId|startedAt/);
    const input = await f.input();
    await expect(f.queue.reprepareBooking(owner, workId, input)).resolves.toMatchObject({ status: 'pending', generationStarted: false });
    expect(f.rows[0]).toMatchObject({ attemptCount: 0, assetId: null, startedAt: null, bookingIdentity: { contract: 'story-visual-booking-v1' } });
    expect(f.prisma.auditEvent.create.mock.calls[0][0].data).toMatchObject({ actorUserId: owner, actorType: 'admin',
      metadata: { generationStarted: false, rightsGranted: false, published: false } });
    await expect(f.queue.reprepareBooking(owner, workId, input)).rejects.toMatchObject({ response: { code: 'STORY_VISUAL_BOOKING_REPREPARE_UNAVAILABLE' } });
    expect(f.prisma.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('allows an owner only on the owned work and takes the actor/owner from server authentication', async () => {
    const f = fixture(), input = await f.input();
    await expect(f.queue.bookingReview(workId, undefined, id)).rejects.toMatchObject({ status: 404 });
    await expect(f.queue.reprepareBooking(id, workId, input, true)).rejects.toMatchObject({ status: 404 });
    await f.queue.reprepareBooking(owner, workId, input, true);
    expect(f.prisma.auditEvent.create.mock.calls[0][0].data.actorType).toBe('user');
  });

  it('does not expand the two-work automatic queue scope even for a valid current published work', async () => {
    const f = fixture(); const input = await f.input();
    f.prisma.storyWork.findFirst.mockResolvedValue({ id: workId, slug: 'another-story', activeReleaseId: releaseId });
    expect(await f.queue.bookingReview(workId)).toMatchObject({ eligible: false, items: [], nextAfterId: null });
    await expect(f.queue.reprepareBooking(owner, workId, input)).rejects.toMatchObject({ response: { code: 'STORY_VISUAL_BOOKING_SCOPE_UNAVAILABLE' } });
    expect(f.prisma.storyVisualGeneration.update).not.toHaveBeenCalled();
  });

  it('supports owner review and explicit recovery of an exact additional release without granting rights', async () => {
    const f = fixture(); f.prisma.storyWork.findFirst.mockResolvedValue({ id: workId, slug: 'ordinary-story', activeReleaseId: releaseId });
    f.values.STORY_IMAGE_QUEUE_RELEASES = JSON.stringify([{ workId, releaseId, releaseChecksum: checksum }]);
    expect((await f.queue.bookingReview(workId, undefined, owner)).items[0]).toMatchObject({ reason: 'unbound', canReprepare: true });
    const input = await f.input();
    await expect(f.queue.reprepareBooking(owner, workId, input, true)).resolves.toMatchObject({ generationStarted: false, status: 'pending' });
    expect(f.prisma.auditEvent.create.mock.calls[0][0].data.metadata).toMatchObject({ rightsGranted: false, published: false });
  });

  it('withdraws a new release before confirm and quarantines old reviews after release/checksum or approval changes', async () => {
    const f = fixture(); f.prisma.storyWork.findFirst.mockResolvedValue({ id: workId, slug: 'ordinary-story', activeReleaseId: releaseId });
    f.values.STORY_IMAGE_QUEUE_RELEASES = JSON.stringify([{ workId, releaseId, releaseChecksum: checksum }]);
    const input = await f.input(); f.values.STORY_IMAGE_QUEUE_RELEASES = '[]';
    await expect(f.queue.reprepareBooking(owner, workId, input, true)).rejects.toMatchObject({ response: { code: 'STORY_VISUAL_BOOKING_SCOPE_UNAVAILABLE' } });
    f.values.STORY_IMAGE_QUEUE_RELEASES = JSON.stringify([{ workId, releaseId, releaseChecksum: checksum }]);
    f.prisma.storyRelease.findFirst.mockResolvedValue({ id: releaseId, checksum: 'f'.repeat(64) });
    expect(await f.queue.bookingReview(workId)).toMatchObject({ eligible: false, items: [] });
    expect(f.prisma.storyVisualGeneration.update).not.toHaveBeenCalled(); expect(f.prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'failed', attemptCount: 1, lastErrorCode: 'STORY_VISUAL_BOOKING_CHANGED' },
    { status: 'failed', lastErrorCode: 'PROVIDER_OUTCOME_UNKNOWN' },
    { status: 'generating', updatedAt: new Date(0) },
    { startedAt: new Date(0) },
    { status: 'ready' },
    { assetId: id },
    { status: 'canceled' },
    { provider: 'openai' },
    { completedAt: new Date(0) },
    { checksumSha256: 'a'.repeat(64) },
  ])('never resets spent, unknown, active, expired, or asset-bearing work: %j', async change => {
    const f = fixture(), input = await f.input(); Object.assign(f.rows[0], change);
    expect((await f.queue.bookingReview(workId)).items[0].canReprepare).toBe(false);
    await expect(f.queue.reprepareBooking(owner, workId, input)).rejects.toMatchObject({ response: { code: 'STORY_VISUAL_BOOKING_REPREPARE_UNAVAILABLE' } });
    expect(f.prisma.storyVisualGeneration.update).not.toHaveBeenCalled(); expect(f.prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('requires a new review of changed author/guide/cover/request basis, even without changed source text', async () => {
    const f = fixture(), input = await f.input(), first = await f.book(f.rows[0]);
    f.book.mockImplementation(async () => storyVisualBookingIdentity({ ...first, sceneGuidanceApprovalSha256: 'a'.repeat(64) }));
    await expect(f.queue.reprepareBooking(owner, workId, input)).rejects.toMatchObject({ response: { code: 'STORY_VISUAL_BOOKING_REVIEW_CHANGED' } });
    const refreshed = await f.input(); await f.queue.reprepareBooking(owner, workId, refreshed);
    expect(f.rows[0].bookingIdentity.sceneGuidanceApprovalSha256).toBe('a'.repeat(64));
  });

  it('explicitly resumes a BOOKING_CHANGED failure with zero attempts even if the current identity was restored', async () => {
    const f = fixture(); f.rows[0].bookingIdentity = await f.book(f.rows[0]);
    f.rows[0].status = 'failed'; f.rows[0].lastErrorCode = 'STORY_VISUAL_BOOKING_CHANGED';
    expect((await f.queue.bookingReview(workId)).items[0]).toMatchObject({ reason: 'changed', canReprepare: true });
    await f.queue.reprepareBooking(owner, workId, await f.input()); expect(f.rows[0].lastErrorCode).toBeNull();
  });

  it('fails closed when current approval is absent or the callback returns another scene binding', async () => {
    const f = fixture(), input = await f.input(); f.book.mockResolvedValue(null as never);
    await expect(f.queue.reprepareBooking(owner, workId, input)).rejects.toMatchObject({ response: { code: 'STORY_VISUAL_BOOKING_REPREPARE_UNAVAILABLE' } });
    const other = fixture(), otherInput = await other.input(), identity = await other.book(other.rows[0]);
    other.book.mockResolvedValue(storyVisualBookingIdentity({ ...identity, sourceSceneKey: 'other-scene' }));
    expect((await other.queue.bookingReview(workId)).items[0].canReprepare).toBe(false);
    await expect(other.queue.reprepareBooking(owner, workId, otherInput)).rejects.toMatchObject({ status: 409 });
  });

  it.each(['sourceSceneKey', 'promptSha256', 'releaseChecksum', 'generationId', 'releaseId'] as const)('rejects mismatched %s', async field => {
    const f = fixture(), input = await f.input();
    (input as any)[field] = field.endsWith('Id') ? owner : field === 'sourceSceneKey' ? 'other-scene' : 'f'.repeat(64);
    await expect(f.queue.reprepareBooking(owner, workId, input)).rejects.toThrow();
    expect(f.prisma.storyVisualGeneration.update).not.toHaveBeenCalled();
  });

  it('invalidates a review when row state changes and rejects an approval change during final recheck', async () => {
    const f = fixture(), input = await f.input(); f.rows[0].updatedAt = new Date(1);
    await expect(f.queue.reprepareBooking(owner, workId, input)).rejects.toMatchObject({ response: { code: 'STORY_VISUAL_BOOKING_REVIEW_CHANGED' } });
    const next = await f.input(), current = await f.book(f.rows[0]);
    f.book.mockResolvedValueOnce(current).mockResolvedValueOnce(null as never);
    await expect(f.queue.reprepareBooking(owner, workId, next)).rejects.toMatchObject({ response: { code: 'STORY_VISUAL_BOOKING_REVIEW_CHANGED' } });
    expect(f.prisma.storyVisualGeneration.update).not.toHaveBeenCalled();
  });

  it('respects global and work emergency limits and does not double count an already pending reservation', async () => {
    const f = fixture(); f.values.STORY_IMAGE_GENERATION_EMERGENCY_MAX_TOTAL = '1';
    await f.queue.reprepareBooking(owner, workId, await f.input());
    const other = fixture(); other.rows[0].status = 'failed'; other.rows[0].lastErrorCode = 'STORY_VISUAL_BOOKING_CHANGED';
    other.prisma.storyVisualGeneration.count.mockResolvedValue(1); other.values.STORY_IMAGE_GENERATION_EMERGENCY_MAX_PER_WORK = '1';
    await expect(other.queue.reprepareBooking(owner, workId, await other.input())).rejects.toMatchObject({ response: { code: 'STORY_VISUAL_BOOKING_LIMIT_REACHED' } });
    expect(other.prisma.storyVisualGeneration.update).not.toHaveBeenCalled();
  });

  it('returns at most eight rows and paginates scoped UUID rows without including artist variants', async () => {
    const f = fixture(); for (let n = 5; n < 15; n++) f.rows.push({ ...f.rows[0], id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` });
    f.rows.push({ ...f.rows[0], id: owner, variantKey: 'artist:other' });
    const page = await f.queue.bookingReview(workId); expect(page.items).toHaveLength(8);
    const next = await f.queue.bookingReview(workId, page.nextAfterId!); expect(next.items).toHaveLength(3); expect(next.nextAfterId).toBeNull();
    expect(new Set([...page.items, ...next.items].map(row => row.generationId)).size).toBe(11);
    await expect(f.queue.bookingReview(workId, 'bad')).rejects.toMatchObject({ status: 400 });
  });

  it('validates explicit true and all exact hashes/UUIDs without accepting a coerced confirmation', async () => {
    const f = fixture(), input = await f.input();
    expect(await validate(Object.assign(new ReprepareStoryVisualBookingDto(), input))).toHaveLength(0);
    for (const confirmedResume of [false, 'true', 1, null, undefined]) {
      expect((await validate(Object.assign(new ReprepareStoryVisualBookingDto(), { ...input, confirmedResume }))).length).toBeGreaterThan(0);
      await expect(f.queue.reprepareBooking(owner, workId, { ...input, confirmedResume } as never)).rejects.toMatchObject({ status: 400 });
    }
    for (const hash of ['f'.repeat(63), 'G'.repeat(64), 'a'.repeat(65)]) {
      expect((await validate(Object.assign(new ReprepareStoryVisualBookingDto(), { ...input, expectedReviewSha256: hash }))).length).toBeGreaterThan(0);
    }
  });
});

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, StoryVisualGeneration } from '@prisma/client';
import { createHash } from 'crypto';
import { parsedStoryVisualBooking, storyVisualBookingMatches, type StoryVisualBookingIdentity } from './story-visual-booking.policy';
import { stableContinuationJson } from './story-continuation-context.policy';
import type { ReprepareStoryVisualBookingDto } from './dto/story-visual-generation.dto';
import { STORY_VISUAL_QUEUE_LEGACY_SLUGS, StoryVisualQueueScope } from './story-visual-queue-scope.policy';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type QueueWork = {
  id: string;
  slug: string;
  activeReleaseId: string;
  releaseChecksum: string;
};

export type StoryVisualQueueCandidate = {
  workId: string;
  releaseId: string;
  releaseChecksum: string;
  sourceSceneKey: string;
  promptSha256: string;
  priority: 'reader_reached' | 'authored_key' | 'ai_branch' | 'authored_remaining';
  bookingIdentity?: StoryVisualBookingIdentity;
};

type PromptRow = Omit<StoryVisualQueueCandidate, 'priority'> & {
  sourceKind: string;
  createdAt: Date;
};

export class StoryVisualGenerationQueue {
  private readonly scope: StoryVisualQueueScope;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly bookingIdentity: (candidate: StoryVisualQueueCandidate, tx: Prisma.TransactionClient) => Promise<StoryVisualBookingIdentity | null>,
  ) { this.scope = new StoryVisualQueueScope(config); }

  async bookingReview(workId: string, afterId?: string, ownerUserId?: string) {
    this.assertWorkId(workId);
    if (afterId && !UUID_PATTERN.test(afterId)) throw new BadRequestException('afterId must be a UUID');
    return this.prisma.$transaction(async tx => {
      const scope = await this.bookingScope(tx, workId, ownerUserId);
      const envelope = { workId, releaseId: scope.release.id, releaseChecksum: scope.release.checksum,
        eligible: this.scope.allows(scope.work, scope.release) };
      if (!envelope.eligible) return { ...envelope, items: [], nextAfterId: null };
      const rows = await tx.storyVisualGeneration.findMany({ where: { workId, releaseId: scope.release.id,
        variantKey: 'default', ...(afterId ? { id: { gt: afterId } } : {}) }, orderBy: { id: 'asc' }, take: 9 });
      const items = [];
      for (const row of rows.slice(0, 8)) items.push(await this.bookingReviewItem(row, tx, scope.release.checksum));
      return { ...envelope, items, nextAfterId: rows.length > 8 ? rows[7].id : null };
    }, { maxWait: 5000, timeout: 30000 });
  }

  async reprepareBooking(actorUserId: string, workId: string, input: ReprepareStoryVisualBookingDto, asOwner = false) {
    this.assertWorkId(workId);
    if (!UUID_PATTERN.test(actorUserId) || !UUID_PATTERN.test(input.generationId) ||
        !UUID_PATTERN.test(input.releaseId) || input.confirmedResume !== true ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(input.sourceSceneKey) ||
        [input.releaseChecksum, input.promptSha256, input.expectedReviewSha256,
          input.expectedCurrentBookingIdentitySha256].some(value => !/^[a-f0-9]{64}$/.test(value))) {
      throw new BadRequestException('Exact booking review and explicit confirmation required');
    }
    return this.prisma.$transaction(async tx => {
      // Rebooking shares admission serialization and never resets a started request.
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(719283601)::text`);
      const scope = await this.bookingScope(tx, workId, asOwner ? actorUserId : undefined);
      if (!this.scope.allows(scope.work, scope.release)) this.bookingConflict('SCOPE_UNAVAILABLE');
      if (scope.release.id !== input.releaseId || scope.release.checksum !== input.releaseChecksum) this.bookingConflict('SOURCE_CHANGED');
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_visual_generations WHERE id = ${input.generationId}::uuid FOR UPDATE`);
      const row = await tx.storyVisualGeneration.findUnique({ where: { id: input.generationId } });
      if (!row || row.workId !== workId || row.releaseId !== input.releaseId || row.variantKey !== 'default') {
        throw new NotFoundException('Story visual booking not found');
      }
      if (row.sourceSceneKey !== input.sourceSceneKey || row.promptSha256 !== input.promptSha256) this.bookingConflict('SOURCE_CHANGED');
      const item = await this.bookingReviewItem(row, tx, scope.release.checksum);
      if (!item.canReprepare || !item.currentBookingIdentitySha256) this.bookingConflict('REPREPARE_UNAVAILABLE');
      if (item.reviewSha256 !== input.expectedReviewSha256 ||
          item.currentBookingIdentitySha256 !== input.expectedCurrentBookingIdentitySha256) this.bookingConflict('REVIEW_CHANGED');
      const limits = this.limits();
      const reserved = { OR: [{ attemptCount: { gte: 1 } }, { status: { in: ['pending', 'generating'] } }] };
      const alreadyReserved = row.status === 'pending';
      if ((limits.total !== null && await tx.storyVisualGeneration.count({ where: reserved }) + (alreadyReserved ? 0 : 1) > limits.total) ||
          (limits.perWork !== null && await tx.storyVisualGeneration.count({ where: { ...reserved, workId, releaseId: row.releaseId } }) +
            (alreadyReserved ? 0 : 1) > limits.perWork)) this.bookingConflict('LIMIT_REACHED');
      // Compute again while the work/consent locks are held; no approval is granted here.
      const current = await this.currentBooking({ ...candidateBinding(row), priority: 'authored_remaining' }, tx);
      if (!current || !storyVisualBookingMatches(current, row) || current.identitySha256 !== item.currentBookingIdentitySha256) this.bookingConflict('REVIEW_CHANGED');
      await tx.storyVisualGeneration.update({ where: { id: row.id }, data: { bookingIdentity: current,
        status: 'pending', lastErrorCode: null, updatedAt: new Date() } });
      await tx.auditEvent.create({ data: { actorUserId, actorType: asOwner ? 'user' : 'admin',
        action: 'story_visual_booking.reprepared', targetType: 'story_visual_generation', targetId: row.id,
        metadata: { workId, releaseId: row.releaseId, releaseChecksum: row.releaseChecksum, sourceSceneKey: row.sourceSceneKey,
          priorBookingSnapshotSha256: this.bookingHash(row.bookingIdentity), priorBookingIdentity: parsedStoryVisualBooking(row.bookingIdentity), priorStatus: row.status,
          reviewedSnapshotSha256: input.expectedReviewSha256, bookingIdentity: current, attemptCount: row.attemptCount,
          generationStarted: false, rightsGranted: false, published: false } } });
      return { workId, releaseId: row.releaseId, releaseChecksum: row.releaseChecksum, generationId: row.id,
        sourceSceneKey: row.sourceSceneKey, status: 'pending' as const, bookingIdentitySha256: current.identitySha256, generationStarted: false };
    }, { maxWait: 5000, timeout: 30000 });
  }

  private async bookingScope(tx: Prisma.TransactionClient, workId: string, ownerUserId?: string) {
    if (ownerUserId && !UUID_PATTERN.test(ownerUserId)) throw new BadRequestException('ownerUserId must be a UUID');
    await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${workId}::uuid FOR SHARE`);
    const work = await tx.storyWork.findFirst({ where: { id: workId, status: 'published', fixtureSource: false,
      activeReleaseId: { not: null }, ...(ownerUserId ? { ownerUserId } : {}) }, select: { id: true, slug: true, activeReleaseId: true } });
    const release = work?.activeReleaseId ? await tx.storyRelease.findFirst({ where: { id: work.activeReleaseId, workId,
      status: 'active' }, select: { id: true, checksum: true } }) : null;
    if (!work || !release) throw new NotFoundException('Active story release not found');
    return { work, release };
  }

  private async bookingReviewItem(row: StoryVisualGeneration, tx: Prisma.TransactionClient, releaseChecksum: string) {
    const old = parsedStoryVisualBooking(row.bookingIdentity);
    const base = { generationId: row.id, sourceSceneKey: row.sourceSceneKey, status: row.status, attemptCount: row.attemptCount,
      promptSha256: row.promptSha256, bookedIdentitySha256: old?.identitySha256 ?? null };
    let reason: string | null = row.attemptCount !== 0 || row.provider || row.model || row.quality || row.size || row.checksumSha256 || row.completedAt
      ? 'attempted' : row.assetId || row.status === 'ready' ? 'asset_present'
      : row.startedAt || row.status === 'generating' ? 'in_progress'
        : !['pending', 'failed'].includes(row.status) || (row.status === 'failed' && row.lastErrorCode !== 'STORY_VISUAL_BOOKING_CHANGED') ? 'blocked'
          : row.releaseChecksum !== releaseChecksum ? 'source_changed' : null;
    const candidate = { ...candidateBinding(row), priority: 'authored_remaining' as const };
    const computed = reason ? null : await this.currentBooking(candidate, tx);
    const current = computed ? storyVisualBookingMatches(computed, candidate) : null;
    if (!reason) reason = !current ? 'blocked' : !old ? 'unbound'
      : old.identitySha256 === current.identitySha256 && row.status === 'pending' ? 'current' : 'changed';
    const canReprepare = ['unbound', 'changed'].includes(reason!);
    return { ...base, reason, canReprepare, currentBookingIdentitySha256: current?.identitySha256 ?? null,
      reviewSha256: canReprepare ? this.bookingHash({ contract: 'story-visual-booking-review-v1', row,
        currentBookingIdentitySha256: current!.identitySha256 }) : null };
  }

  private bookingHash(value: unknown) {
    // Canonicalize timestamps too; raw Prisma rows must not be exposed to the UI.
    return createHash('sha256').update(stableContinuationJson(JSON.parse(JSON.stringify(value ?? null)))).digest('hex');
  }

  private bookingConflict(suffix: string): never {
    throw new ConflictException({ code: `STORY_VISUAL_BOOKING_${suffix}`, message: 'Reload the booking review before resuming' });
  }

  async sync(workId?: string) {
    this.assertWorkId(workId);
    const works = await this.eligibleWorks(workId);
    const limits = this.limits();
    const existingRows = works.length ? await this.prisma.storyVisualGeneration.findMany({
      where: { workId: { in: works.map(work => work.id) } },
      select: { workId: true, releaseId: true, sourceSceneKey: true, variantKey: true, status: true, attemptCount: true },
    }) : [];
    const globalReserved = limits.total === null ? 0 : await this.prisma.storyVisualGeneration.count({
      where: { OR: [{ attemptCount: { gte: 1 } }, { status: { in: ['pending', 'generating'] } }] },
    });
    let totalRemaining = limits.total === null ? Infinity : Math.max(0, limits.total - globalReserved);
    const candidates: StoryVisualQueueCandidate[] = [];
    const workCapacity = new Map<string, number>();

    for (const work of works) {
      if (!totalRemaining) break;
      const currentRows = existingRows.filter(row => row.workId === work.id && row.releaseId === work.activeReleaseId);
      const existingKeys = new Set(currentRows.filter(row => row.variantKey === 'default').map(row => row.sourceSceneKey));
      const workReserved = currentRows.filter(row => row.attemptCount >= 1 ||
        ['pending', 'generating'].includes(row.status)).length;
      const workRemaining = limits.perWork === null ? Infinity : Math.max(0, limits.perWork - workReserved);
      workCapacity.set(work.id, workRemaining);
      if (!workRemaining) continue;
      const ranked = await this.rankedPrompts(work);
      for (const candidate of ranked) {
        if (!workRemaining || !totalRemaining) break;
        if (existingKeys.has(candidate.sourceSceneKey)) continue;
        if (this.sharedCloneAdmission(candidate.sourceSceneKey)) continue;
        candidates.push(candidate);
        existingKeys.add(candidate.sourceSceneKey);
      }
    }

    const booked: StoryVisualQueueCandidate[] = [];
    let blockedCount = 0;
    let admissionLimitReached = false;
    for (const candidate of candidates) {
      if (!totalRemaining) break;
      if (!workCapacity.get(candidate.workId)) continue;
      const count = await this.prisma.$transaction(async tx => {
        // Serialize automatic admissions; all variants consume emergency capacity.
        await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(719283601)::text`);
        const reserved = { OR: [{ attemptCount: { gte: 1 } }, { status: { in: ['pending', 'generating'] } }] };
        if ((limits.total !== null && await tx.storyVisualGeneration.count({ where: reserved }) >= limits.total) ||
            (limits.perWork !== null && await tx.storyVisualGeneration.count({
              where: { ...reserved, workId: candidate.workId, releaseId: candidate.releaseId } }) >= limits.perWork)) return -1;
        await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${candidate.workId}::uuid FOR SHARE`);
        if (this.sharedCloneAdmission(candidate.sourceSceneKey)) return null;
        const identity = await this.currentBooking(candidate, tx);
        if (!identity || !storyVisualBookingMatches(identity, candidateBinding(candidate))) return null;
        return (await tx.storyVisualGeneration.createMany({ data: [{
          ...candidateBinding(candidate), variantKey: 'default', bookingIdentity: identity,
        }], skipDuplicates: true })).count;
      }, { maxWait: 5000, timeout: 30000 });
      if (count === null) blockedCount += 1;
      else if (count === -1) admissionLimitReached = true;
      else if (count) {
        booked.push(candidate);
        totalRemaining -= 1;
        workCapacity.set(candidate.workId, workCapacity.get(candidate.workId)! - 1);
      }
    }

    return {
      eligibleWorkCount: works.length,
      queuedCount: booked.length,
      blockedCount,
      limits,
      priorities: this.priorityCounts(booked),
      limitReached: admissionLimitReached || totalRemaining === 0 || (limits.perWork !== null && works.some(work => {
        return workCapacity.get(work.id) === 0;
      })),
    };
  }

  async next(workId?: string): Promise<StoryVisualQueueCandidate | null> {
    this.assertWorkId(workId);
    const works = await this.eligibleWorks(workId);
    const ranked = (await Promise.all(works.map(work => this.rankedPrompts(work)))).flat();
    if (!ranked.length) return null;
    const ranking = new Map(ranked.map((candidate, index) => [
      `${candidate.workId}:${candidate.releaseId}:${candidate.sourceSceneKey}`,
      { candidate, index },
    ]));
    const staleBefore = new Date(Date.now() - this.integer('STORY_IMAGE_GENERATION_STALE_SECONDS', 180, 30, 3600) * 1000);
    const rows = await this.prisma.storyVisualGeneration.findMany({
      where: {
        workId: { in: works.map(work => work.id) },
        variantKey: 'default',
        OR: [
          { status: 'pending' },
          { status: 'generating', updatedAt: { lt: staleBefore } },
          ...(this.databaseFallbackEnabled()
            ? [{ status: 'failed', lastErrorCode: { startsWith: 'OBJECT_STORAGE_' } }]
            : []),
        ],
      },
      select: {
        workId: true, releaseId: true, releaseChecksum: true, sourceSceneKey: true,
        promptSha256: true, status: true, attemptCount: true, updatedAt: true, bookingIdentity: true,
      },
    });
    const eligible = rows.flatMap(row => {
      const item = ranking.get(`${row.workId}:${row.releaseId}:${row.sourceSceneKey}`);
      const identity = item ? storyVisualBookingMatches(row.bookingIdentity, candidateBinding(item.candidate)) : null;
      const work = works.find(work => work.id === row.workId);
      const reviewed = work && (STORY_VISUAL_QUEUE_LEGACY_SLUGS.includes(work.slug) ||
        Boolean(identity?.authorApprovalIdentitySha256 && identity.sceneGuidanceApprovalSha256));
      return item && identity && reviewed && item.candidate.promptSha256 === row.promptSha256 && item.candidate.releaseChecksum === row.releaseChecksum
        ? [{ ...item, candidate: { ...item.candidate, bookingIdentity: identity }, requestedAt: row.updatedAt }]
        : [];
    });
    eligible.sort((left, right) => left.index - right.index ||
      left.requestedAt.getTime() - right.requestedAt.getTime());
    return eligible[0]?.candidate ?? null;
  }

  async status(workId?: string) {
    this.assertWorkId(workId);
    const works = await this.eligibleWorks(workId);
    const activeScope = { OR: works.map(work => ({ workId: work.id, releaseId: work.activeReleaseId,
      releaseChecksum: work.releaseChecksum })) };
    const [promptCount, rows, failures, globalAttempted] = await Promise.all([
      works.length ? this.prisma.storyVisualPrompt.count({ where: activeScope }) : Promise.resolve(0),
      works.length ? this.prisma.storyVisualGeneration.findMany({
        where: activeScope,
        select: { workId: true, releaseId: true, status: true, attemptCount: true, bookingIdentity: true },
      }) : Promise.resolve([]),
      works.length ? this.prisma.storyVisualGeneration.findMany({
        where: { ...activeScope, status: 'failed' },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        select: { workId: true, releaseId: true, sourceSceneKey: true, lastErrorCode: true, updatedAt: true },
      }) : Promise.resolve([]),
      this.prisma.storyVisualGeneration.count({ where: { attemptCount: { gte: 1 } } }),
    ]);
    const summarize = (items: Array<{ status: string; attemptCount: number; bookingIdentity?: unknown }>) => ({
      queued: items.filter(item => item.status === 'pending').length,
      generating: items.filter(item => item.status === 'generating').length,
      ready: items.filter(item => item.status === 'ready').length,
      failed: items.filter(item => item.status === 'failed').length,
      attempted: items.filter(item => item.attemptCount >= 1).length,
      unboundPending: items.filter(item => ['pending', 'generating'].includes(item.status) && !item.bookingIdentity).length,
    });
    return {
      limits: this.limits(),
      totals: { prompts: promptCount, ...summarize(rows), globalAttempted },
      works: works.map(work => ({
        workId: work.id,
        slug: work.slug,
        releaseId: work.activeReleaseId,
        ...summarize(rows.filter(row => row.workId === work.id && row.releaseId === work.activeReleaseId)),
      })),
      failures,
    };
  }

  limits() {
    return {
      perWork: this.optionalLimit('STORY_IMAGE_GENERATION_EMERGENCY_MAX_PER_WORK'),
      total: this.optionalLimit('STORY_IMAGE_GENERATION_EMERGENCY_MAX_TOTAL'),
    };
  }

  private optionalLimit(key: string): number | null {
    const raw = this.config.get<string>(key);
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1) throw new BadRequestException(`${key} is invalid`);
    return value;
  }

  private async eligibleWorks(workId?: string): Promise<QueueWork[]> {
    const rows = await this.prisma.storyWork.findMany({
      where: {
        ...(workId ? { id: workId } : {}),
        ...this.scope.workFilter(),
        status: 'published',
        fixtureSource: false,
        activeReleaseId: { not: null },
      },
      orderBy: { publishedAt: 'asc' },
      select: { id: true, slug: true, activeReleaseId: true },
    });
    const works: QueueWork[] = [];
    for (const row of rows) {
      if (!row.activeReleaseId) continue;
      const release = await this.prisma.storyRelease.findFirst({ where: { id: row.activeReleaseId, workId: row.id, status: 'active' },
        select: { id: true, checksum: true } });
      if (release && this.scope.allows(row, release)) works.push({ ...row, activeReleaseId: release.id, releaseChecksum: release.checksum });
    }
    return works;
  }

  private async rankedPrompts(work: QueueWork): Promise<StoryVisualQueueCandidate[]> {
    const release = await this.prisma.storyRelease.findFirst({
      where: { id: work.activeReleaseId, workId: work.id, status: 'active' },
      select: { id: true, checksum: true },
    });
    if (!release || release.checksum !== work.releaseChecksum) return [];
    if (!this.scope.allows(work, release)) return [];
    const prompts = await this.prisma.storyVisualPrompt.findMany({
      where: { workId: work.id, releaseId: release.id, releaseChecksum: release.checksum },
      orderBy: { createdAt: 'asc' },
      select: {
        workId: true, releaseId: true, releaseChecksum: true, sourceSceneKey: true,
        promptSha256: true, sourceKind: true, createdAt: true,
      },
    }) as PromptRow[];
    const [reached, authoredKeys] = await Promise.all([
      this.reachedKeys(work.id, release.id),
      this.authoredKeyScenes(work.id),
    ]);
    const priority = (prompt: PromptRow): StoryVisualQueueCandidate['priority'] => {
      if (reached.has(prompt.sourceSceneKey)) return 'reader_reached';
      if (authoredKeys.has(prompt.sourceSceneKey)) return 'authored_key';
      if (prompt.sourceKind === 'ai_branch') return 'ai_branch';
      return 'authored_remaining';
    };
    const rank = { reader_reached: 0, authored_key: 1, ai_branch: 2, authored_remaining: 3 };
    return prompts.map(prompt => ({
      workId: prompt.workId,
      releaseId: prompt.releaseId,
      releaseChecksum: prompt.releaseChecksum,
      sourceSceneKey: prompt.sourceSceneKey,
      promptSha256: prompt.promptSha256,
      priority: priority(prompt),
      createdAt: prompt.createdAt,
    })).sort((left, right) => rank[left.priority] - rank[right.priority] ||
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.sourceSceneKey.localeCompare(right.sourceSceneKey))
      .map(({ createdAt: _createdAt, ...candidate }) => candidate);
  }

  private sharedCloneAdmission(sourceSceneKey: string) {
    return this.config.get<string>('STORY_SHARED_BRANCH_VISUAL_REUSE_ENABLED') === 'true' && sourceSceneKey.startsWith('ai-reuse-');
  }

  private async reachedKeys(workId: string, releaseId: string) {
    const progress = await this.prisma.storyReaderProgress.findMany({
      where: { workId, activeReleaseId: releaseId, status: 'active' },
      select: { currentSceneId: true, currentGeneratedSceneId: true },
    });
    const canonicalIds = [...new Set(progress.map(row => row.currentSceneId).filter((id): id is string => Boolean(id)))];
    const generatedIds = [...new Set(progress.map(row => row.currentGeneratedSceneId).filter((id): id is string => Boolean(id)))];
    const [scenes, beats, generated] = await Promise.all([
      canonicalIds.length ? this.prisma.storyScene.findMany({
        where: { id: { in: canonicalIds }, status: 'published', fixtureSource: false },
        select: { id: true, sceneKey: true },
      }) : Promise.resolve([]),
      canonicalIds.length ? this.prisma.storyBeat.findMany({
        where: { sceneId: { in: canonicalIds }, sourceSceneKey: { not: null } },
        select: { sourceSceneKey: true },
      }) : Promise.resolve([]),
      generatedIds.length ? this.prisma.storyAiGeneratedScene.findMany({
        where: { id: { in: generatedIds }, workId, releaseId, status: 'ready' },
        select: { sceneKey: true },
      }) : Promise.resolve([]),
    ]);
    return new Set([
      ...scenes.map(scene => scene.sceneKey),
      ...beats.map(beat => beat.sourceSceneKey).filter((key): key is string => Boolean(key)),
      ...generated.map(scene => scene.sceneKey),
    ]);
  }

  private async authoredKeyScenes(workId: string) {
    const parts = await this.prisma.storyPart.findMany({
      where: { workId, status: 'published', fixtureSource: false },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });
    if (!parts.length) return new Set<string>();
    const scenes = await this.prisma.storyScene.findMany({
      where: { partId: { in: parts.map(part => part.id) }, status: 'published', fixtureSource: false },
      select: { id: true, partId: true, sceneKey: true, position: true },
    });
    const beats = scenes.length ? await this.prisma.storyBeat.findMany({
      where: { sceneId: { in: scenes.map(scene => scene.id) }, sourceSceneKey: { not: null } },
      select: { sceneId: true, position: true, sourceSceneKey: true },
    }) : [];
    const partPosition = new Map(parts.map(part => [part.id, part.position]));
    const sceneById = new Map(scenes.map(scene => [scene.id, scene]));
    const ordered = beats.filter(beat => beat.sourceSceneKey).sort((left, right) => {
      const leftScene = sceneById.get(left.sceneId)!;
      const rightScene = sceneById.get(right.sceneId)!;
      return (partPosition.get(leftScene.partId)! - partPosition.get(rightScene.partId)!) ||
        (leftScene.position - rightScene.position) || (left.position - right.position);
    });
    const firstByPart = new Map<string, string>();
    for (const beat of ordered) {
      const partId = sceneById.get(beat.sceneId)!.partId;
      if (!firstByPart.has(partId)) firstByPart.set(partId, beat.sourceSceneKey!);
    }
    return new Set(firstByPart.values());
  }

  private priorityCounts(candidates: StoryVisualQueueCandidate[]) {
    return {
      readerReached: candidates.filter(candidate => candidate.priority === 'reader_reached').length,
      authoredKey: candidates.filter(candidate => candidate.priority === 'authored_key').length,
      aiBranch: candidates.filter(candidate => candidate.priority === 'ai_branch').length,
      authoredRemaining: candidates.filter(candidate => candidate.priority === 'authored_remaining').length,
    };
  }

  private assertWorkId(workId?: string) {
    if (workId && !UUID_PATTERN.test(workId)) throw new BadRequestException('workId must be a UUID');
  }

  async allowsCandidate(candidate: Pick<StoryVisualQueueCandidate, 'workId' | 'releaseId' | 'releaseChecksum'>,
    db: PrismaService | Prisma.TransactionClient = this.prisma, booking?: unknown) {
    const scope = await this.candidateScope(candidate, db);
    if (!scope) return false;
    if (booking !== undefined && !STORY_VISUAL_QUEUE_LEGACY_SLUGS.includes(scope.work.slug)) {
      const identity = parsedStoryVisualBooking(booking);
      return Boolean(identity && identity.workId === candidate.workId && identity.releaseId === candidate.releaseId &&
        identity.releaseChecksum === candidate.releaseChecksum && identity.authorApprovalIdentitySha256 && identity.sceneGuidanceApprovalSha256);
    }
    return true;
  }

  private async candidateScope(candidate: Pick<StoryVisualQueueCandidate, 'workId' | 'releaseId' | 'releaseChecksum'>,
    db: PrismaService | Prisma.TransactionClient) {
    const work = await db.storyWork.findFirst({ where: { id: candidate.workId, status: 'published', fixtureSource: false,
      activeReleaseId: candidate.releaseId }, select: { id: true, slug: true, activeReleaseId: true } });
    if (!work) return null;
    const release = await db.storyRelease.findFirst({ where: { id: candidate.releaseId, workId: candidate.workId,
      checksum: candidate.releaseChecksum, status: 'active' }, select: { id: true, checksum: true } });
    return release && this.scope.allows(work, release) ? { work, release } : null;
  }

  private async currentBooking(candidate: StoryVisualQueueCandidate, tx: Prisma.TransactionClient) {
    const scope = await this.candidateScope(candidate, tx);
    if (!scope) return null;
    const computed = await this.bookingIdentity(candidate, tx);
    const identity = computed ? storyVisualBookingMatches(computed, candidateBinding(candidate)) : null;
    // Additional releases must have explicit current author and scene approvals, not a legacy fallback.
    if (!identity || (!STORY_VISUAL_QUEUE_LEGACY_SLUGS.includes(scope.work.slug) &&
        (!identity.authorApprovalIdentitySha256 || !identity.sceneGuidanceApprovalSha256))) return null;
    return this.scope.allows(scope.work, scope.release) ? identity : null;
  }

  private databaseFallbackEnabled() {
    return this.config.get<string>('STORY_IMAGE_DATABASE_FALLBACK_ENABLED') === 'true';
  }

  private integer(key: string, fallback: number, min: number, max: number) {
    const raw = this.config.get<string>(key);
    if (raw == null || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new BadRequestException(`${key} is invalid`);
    }
    return value;
  }
}

function candidateBinding(candidate: Pick<StoryVisualQueueCandidate, 'workId' | 'releaseId' | 'releaseChecksum' | 'sourceSceneKey' | 'promptSha256'>) {
  return { workId: candidate.workId, releaseId: candidate.releaseId, releaseChecksum: candidate.releaseChecksum,
    sourceSceneKey: candidate.sourceSceneKey, promptSha256: candidate.promptSha256 };
}

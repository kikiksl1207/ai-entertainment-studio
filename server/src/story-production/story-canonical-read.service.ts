import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StoryCanonicalReadReceipt } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { ConfirmStoryCanonicalReadDto, StoryCanonicalReadQueryDto } from './dto/story-canonical-read.dto';
import { canonicalReadScopeChecksum, canonicalReadTextHash, StoryCanonicalReadIdentity } from './story-canonical-read.policy';
import { canonicalStorySourceChecksum, validCanonicalStoryText } from './story-canonical-source.policy';
import { isPublicStorySourceSafe, STORY_LOCALES } from './story-production.policy';

const HASH = /^[a-f0-9]{64}$/;

// This is a reader's explicit confirmation, not proof of attention or an approved character memory.
@Injectable()
export class StoryCanonicalReadService {
  constructor(private readonly prisma: PrismaService) {}

  private ids(...values: string[]) {
    if (!values.every(value => typeof value === 'string' && isUUID(value))) {
      throw new BadRequestException({ code: 'STORY_CANONICAL_READ_ID_INVALID' });
    }
  }

  private changed(code = 'STORY_CANONICAL_READ_SCOPE_CHANGED'): never {
    throw new ConflictException({ code });
  }

  private async source(db: Prisma.TransactionClient, userId: string, progressId: string, beatId: string,
    query: StoryCanonicalReadQueryDto, lock: boolean) {
    this.ids(userId, progressId, beatId);
    if (!STORY_LOCALES.includes(query?.locale as typeof STORY_LOCALES[number])) {
      throw new BadRequestException({ code: 'STORY_CANONICAL_READ_LOCALE_INVALID' });
    }
    if (lock) await db.$queryRaw(Prisma.sql`SELECT id FROM story_reader_progress
      WHERE id = ${progressId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`);
    const progress = await db.storyReaderProgress.findFirst({ where: { id: progressId, userId } });
    if (!progress) throw new NotFoundException({ code: 'STORY_CANONICAL_READ_PROGRESS_UNAVAILABLE' });
    if (!['active', 'completed'].includes(progress.status) || !progress.currentSceneId ||
      progress.currentGeneratedSceneId || !progress.activeReleaseId || !progress.routeNodeId) this.changed();
    if (lock) await db.$queryRaw(Prisma.sql`SELECT w.id FROM story_works w
      JOIN story_releases r ON r.id = w.active_release_id
      JOIN story_manuscript_versions m ON m.id = r.manuscript_version_id
      WHERE w.id = ${progress.workId}::uuid FOR SHARE OF w, r, m`);
    const work = await db.storyWork.findFirst({ where: { id: progress.workId, status: 'published', fixtureSource: false } });
    if (!work || !isPublicStorySourceSafe({ fixtureSource: work.fixtureSource, slug: work.slug, manifest: work.coverManifest }) ||
      work.activeReleaseId !== progress.activeReleaseId || work.publishedVersion !== progress.storyVersion) this.changed();
    const release = await db.storyRelease.findFirst({ where: { id: progress.activeReleaseId!, workId: work.id, status: 'active' } });
    const manuscript = release && await db.storyManuscriptVersion.findFirst({ where: {
      id: release.manuscriptVersionId, workId: work.id, ownerUserId: work.ownerUserId,
    } });
    if (!release || !manuscript || !HASH.test(release.checksum) || !HASH.test(manuscript.contentHash) ||
      release.version !== progress.storyVersion) this.changed();
    if (lock) await db.$queryRaw(Prisma.sql`SELECT b.id FROM story_beats b
      JOIN story_scenes s ON s.id = b.scene_id JOIN story_parts p ON p.id = s.part_id
      WHERE b.id = ${beatId}::uuid AND s.id = ${progress.currentSceneId!}::uuid
        AND p.work_id = ${work.id}::uuid FOR SHARE OF b, s, p`);
    const scene = await db.storyScene.findFirst({ where: { id: progress.currentSceneId!, status: 'published', fixtureSource: false } });
    const part = scene && await db.storyPart.findFirst({ where: { id: scene.partId, workId: work.id, status: 'published', fixtureSource: false } });
    const beat = scene && await db.storyBeat.findFirst({ where: { id: beatId, sceneId: scene.id } });
    if (!scene || !part || !beat || !['paragraph', 'narration', 'dialogue'].includes(beat.beatType) ||
      !Number.isSafeInteger(beat.position) || beat.position < 1 || beat.position > 40 ||
      part.actNumber !== progress.currentAct || !isPublicStorySourceSafe({ manifest: scene.visualManifest })) {
      throw new NotFoundException({ code: 'STORY_CANONICAL_READ_BEAT_UNAVAILABLE' });
    }
    if (!work.priceLumina.isZero() || !part.priceLumina.isZero()) {
      if (lock) await db.$queryRaw(Prisma.sql`SELECT id FROM user_entitlements
        WHERE user_id = ${userId}::uuid AND reference_id IN (${work.id}::uuid, ${part.id}::uuid)
          AND entitlement_type IN ('story_work', 'story_season', 'story_part') FOR SHARE`);
      const now = new Date();
      const entitlement = await db.userEntitlement.findFirst({ where: { userId,
        entitlementType: { in: ['story_work', 'story_season', 'story_part'] }, referenceId: { in: [work.id, part.id] },
        revokedAt: null, startsAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      }, select: { id: true } });
      if (!entitlement) throw new ForbiddenException({ code: 'STORY_CANONICAL_READ_ACCESS_REQUIRED' });
    }
    if (lock) await db.$queryRaw(Prisma.sql`SELECT id FROM story_progress_route_nodes
      WHERE id = ${progress.routeNodeId!}::uuid AND progress_id = ${progress.id}::uuid FOR SHARE`);
    const route = await db.storyProgressRouteNode.findFirst({ where: { id: progress.routeNodeId!, progressId: progress.id,
      workId: work.id, releaseId: release.id, targetSceneId: scene.id } });
    if (!route?.routeHash || !HASH.test(route.routeHash)) this.changed();
    const content = beat.content && typeof beat.content === 'object' && !Array.isArray(beat.content) ? beat.content : {};
    const sourceText = content[query.locale];
    if (!validCanonicalStoryText(sourceText)) this.changed('STORY_CANONICAL_READ_TRANSLATION_UNAVAILABLE');
    const sourceChecksum = canonicalStorySourceChecksum({ workId: work.id, ownerUserId: work.ownerUserId,
      releaseId: release.id, releaseChecksum: release.checksum, manuscriptVersionId: manuscript.id,
      manuscriptHash: manuscript.contentHash, partId: part.id, partPosition: part.position,
      sceneId: scene.id, sceneKey: scene.sceneKey, scenePosition: scene.position, beatId: beat.id,
      beatPosition: beat.position, beatType: beat.beatType, sourceSceneKey: beat.sourceSceneKey,
      locale: query.locale, sourceText });
    const identity: StoryCanonicalReadIdentity = { userId: progress.userId, progressId: progress.id, workId: work.id,
      ownerUserId: work.ownerUserId, releaseId: release.id, releaseChecksum: release.checksum,
      manuscriptVersionId: manuscript.id, manuscriptHash: manuscript.contentHash, partId: part.id,
      sceneId: scene.id, beatId: beat.id, beatPosition: beat.position, actNumber: part.actNumber,
      locale: query.locale, sourceChecksum, sourceTextHash: canonicalReadTextHash(sourceText),
      routeNodeId: route.id, routeHash: route.routeHash, storyVersion: progress.storyVersion,
      progressRevision: progress.progressRevision };
    return { identity, sourceChecksum, sourceTextHash: identity.sourceTextHash,
      scopeChecksum: canonicalReadScopeChecksum(identity), expectedRevision: identity.progressRevision };
  }

  async preview(userId: string, progressId: string, beatId: string, query: StoryCanonicalReadQueryDto) {
    return this.prisma.$transaction(async db => {
      await db.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
      return { contract: 'story-canonical-read-review-v1' as const,
        ...await this.source(db, userId, progressId, beatId, query, false),
        confirmationRecorded: false as const, readerMemoryApplied: false as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private project(row: StoryCanonicalReadReceipt, idempotentReplay: boolean) {
    return { contract: 'story-canonical-read-receipt-v1' as const, receiptId: row.id,
      progressId: row.progressId, workId: row.workId, sceneId: row.sceneId, beatId: row.beatId,
      sourceChecksum: row.sourceChecksum, sourceTextHash: row.sourceTextHash, scopeChecksum: row.scopeChecksum,
      locale: row.locale, routeNodeId: row.routeNodeId, progressRevision: row.progressRevision,
      invalidatedAt: row.invalidatedAt?.toISOString() ?? null, confirmedAt: row.confirmedAt.toISOString(),
      readerMemoryApplied: false as const, idempotentReplay };
  }

  async confirm(userId: string, progressId: string, beatId: string, input: ConfirmStoryCanonicalReadDto) {
    this.ids(input?.idempotencyKey);
    if (input.displayedAndRead !== true || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 ||
      ![input.expectedScopeChecksum, input.expectedSourceTextHash].every(value => typeof value === 'string' && HASH.test(value))) {
      throw new BadRequestException({ code: 'STORY_CANONICAL_READ_CONFIRMATION_INVALID' });
    }
    return this.prisma.$transaction(async db => {
      const source = await this.source(db, userId, progressId, beatId, input, true);
      if (source.expectedRevision !== input.expectedRevision || source.scopeChecksum !== input.expectedScopeChecksum ||
        source.sourceTextHash !== input.expectedSourceTextHash) this.changed();
      const idempotencyKey = input.idempotencyKey.toLowerCase();
      const existing = await db.storyCanonicalReadReceipt.findUnique({ where: { userId_progressId_idempotencyKey: {
        userId: source.identity.userId, progressId: source.identity.progressId, idempotencyKey,
      } } });
      if (existing) {
        if (existing.invalidatedAt || existing.resetCommandId || existing.scopeChecksum !== source.scopeChecksum ||
          Object.entries(source.identity).some(([key, value]) => existing[key as keyof StoryCanonicalReadReceipt] !== value)) {
          this.changed('STORY_CANONICAL_READ_IDEMPOTENCY_CONFLICT');
        }
        return this.project(existing, true);
      }
      const row = await db.storyCanonicalReadReceipt.create({ data: { ...source.identity, scopeChecksum: source.scopeChecksum, idempotencyKey } });
      await db.auditEvent.create({ data: { actorUserId: source.identity.userId, actorType: 'user',
        action: 'story_canonical_read.confirmed', targetType: 'story_canonical_read_receipt', targetId: row.id,
        metadata: { progressId: row.progressId, beatId: row.beatId, routeNodeId: row.routeNodeId,
          locale: row.locale, sourceChecksum: row.sourceChecksum, scopeChecksum: row.scopeChecksum } } });
      return this.project(row, false);
    }, { timeout: 15000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') this.changed();
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') this.changed('STORY_CANONICAL_READ_IDEMPOTENCY_CONFLICT');
      throw error;
    });
  }
}

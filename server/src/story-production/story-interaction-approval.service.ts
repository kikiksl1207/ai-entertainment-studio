import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StoryInteractionApproval } from '@prisma/client';
import { isUUID } from 'class-validator';
import { assertCreatorGenerationProfileApprovable, creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile } from '../generation-profile/creator-generation-profile.policy';
import { PrismaService } from '../prisma/prisma.service';
import { ApproveStoryInteractionDto, RevokeStoryInteractionDto, StoryInteractionCatalogQueryDto, StoryInteractionReviewQueryDto } from './dto/story-interaction-approval.dto';
import { releaseChecksum } from './story-lifecycle.policy';
import { STORY_LOCALES } from './story-production.policy';
import { STORY_INTERACTION_APPROVAL_CONTRACT, storyInteractionApprovalChecksum, validateStoryInteractionEvidence } from './story-interaction-approval.policy';
import { canonicalStorySourceChecksum, validCanonicalStoryText } from './story-canonical-source.policy';

const HASH = /^[a-f0-9]{64}$/;

type CatalogPosition = { beatId: string; sceneId: string; partId: string;
  partPosition: number; scenePosition: number; beatPosition: number };
type CatalogBeat = CatalogPosition & { beatType: 'paragraph' | 'narration' | 'dialogue'; sourceText: string | null };

// Canonical author review only. This record alone is never evidence that a reader experienced an event.
@Injectable()
export class StoryInteractionApprovalService {
  constructor(private readonly prisma: PrismaService) {}

  private ids(...values: string[]) {
    if (!values.every(value => typeof value === 'string' && isUUID(value))) {
      throw new BadRequestException({ code: 'STORY_INTERACTION_ID_INVALID' });
    }
  }

  private changed(code = 'STORY_INTERACTION_SOURCE_CHANGED'): never { throw new ConflictException({ code }); }

  private locale(value: unknown) {
    if (!STORY_LOCALES.includes(value as typeof STORY_LOCALES[number])) {
      throw new BadRequestException({ code: 'STORY_INTERACTION_LOCALE_INVALID' });
    }
  }

  private sourceText(value: unknown): string | null {
    return validCanonicalStoryText(value) ? value : null;
  }

  private async work(db: Prisma.TransactionClient, ownerUserId: string, workId: string, lock: boolean) {
    this.ids(ownerUserId, workId);
    if (lock) await db.$queryRaw(Prisma.sql`SELECT id FROM story_works
      WHERE id = ${workId}::uuid AND owner_user_id = ${ownerUserId}::uuid FOR UPDATE`);
    const work = await db.storyWork.findFirst({ where: { id: workId, ownerUserId, status: 'published', fixtureSource: false } });
    if (!work?.activeReleaseId) throw new NotFoundException({ code: 'STORY_INTERACTION_WORK_UNAVAILABLE' });
    return work;
  }

  private async source(db: Prisma.TransactionClient, ownerUserId: string, workId: string, beatId: string,
    query: StoryInteractionReviewQueryDto, lock: boolean) {
    this.ids(beatId, query?.artistId);
    this.locale(query?.locale);
    const work = await this.work(db, ownerUserId, workId, lock);
    const release = await db.storyRelease.findFirst({ where: { id: work.activeReleaseId!, workId: work.id, status: 'active' } });
    const manuscript = release && await db.storyManuscriptVersion.findFirst({ where: {
      id: release.manuscriptVersionId, workId: work.id, ownerUserId: work.ownerUserId,
    } });
    if (!release || !manuscript || !HASH.test(release.checksum) || !HASH.test(manuscript.contentHash)) this.changed();
    if (lock) await db.$queryRaw(Prisma.sql`SELECT b.id FROM story_beats b
      JOIN story_scenes s ON s.id = b.scene_id JOIN story_parts p ON p.id = s.part_id
      WHERE b.id = ${beatId}::uuid AND p.work_id = ${work.id}::uuid FOR SHARE OF b, s, p`);
    const beat = await db.storyBeat.findUnique({ where: { id: beatId } });
    const scene = beat && await db.storyScene.findFirst({ where: { id: beat.sceneId, status: 'published', fixtureSource: false } });
    const part = scene && await db.storyPart.findFirst({ where: { id: scene.partId, workId: work.id, status: 'published', fixtureSource: false } });
    if (!beat || !scene || !part || !['paragraph', 'narration', 'dialogue'].includes(beat.beatType)) {
      throw new NotFoundException({ code: 'STORY_INTERACTION_BEAT_UNAVAILABLE' });
    }
    const content = beat.content && typeof beat.content === 'object' && !Array.isArray(beat.content) ? beat.content : {};
    const sourceText = this.sourceText(content[query.locale]);
    if (sourceText === null) {
      this.changed('STORY_INTERACTION_TRANSLATION_UNAVAILABLE');
    }
    if (lock) await db.$queryRaw(Prisma.sql`SELECT id FROM artists WHERE id = ${query.artistId}::uuid FOR SHARE`);
    const artist = await db.artist.findFirst({ where: { id: query.artistId, status: 'active' } });
    if (lock && artist) await db.$queryRaw(Prisma.sql`SELECT id FROM artist_story_identity_profiles
      WHERE artist_id = ${artist.id}::uuid ORDER BY profile_version DESC FOR SHARE`);
    const profile = artist && await db.artistStoryIdentityProfile.findFirst({ where: { artistId: artist.id }, orderBy: { profileVersion: 'desc' } });
    if (!artist || !profile || profile.status !== 'approved' || !profile.approvedAt || !profile.approvedByUserId || !profile.approvedSettings ||
      !profile.approvedFingerprint || !HASH.test(profile.approvedFingerprint) || !HASH.test(profile.sourceFingerprint) || profile.reviewRevision < 1) {
      this.changed('STORY_INTERACTION_ARTIST_APPROVAL_REQUIRED');
    }
    let normalized: ReturnType<typeof normalizeCreatorGenerationProfile>;
    try { normalized = normalizeCreatorGenerationProfile('artist', profile.approvedSettings); assertCreatorGenerationProfileApprovable(normalized); }
    catch { this.changed('STORY_INTERACTION_ARTIST_APPROVAL_REQUIRED'); }
    if (creatorGenerationProfileFingerprint(profile.sourceFingerprint, normalized) !== profile.approvedFingerprint) {
      this.changed('STORY_INTERACTION_ARTIST_APPROVAL_REQUIRED');
    }
    const identityPinHash = releaseChecksum({ artistId: artist.id, displayName: artist.displayName,
      identityProfileId: profile.id, profileVersion: profile.profileVersion, reviewRevision: profile.reviewRevision,
      sourceFingerprint: profile.sourceFingerprint, approvedFingerprint: profile.approvedFingerprint });
    const sourceChecksum = canonicalStorySourceChecksum({ workId: work.id,
      ownerUserId: work.ownerUserId, releaseId: release.id, releaseChecksum: release.checksum,
      manuscriptVersionId: manuscript.id, manuscriptHash: manuscript.contentHash, partId: part.id,
      partPosition: part.position, sceneId: scene.id, sceneKey: scene.sceneKey, scenePosition: scene.position,
      beatId: beat.id, beatPosition: beat.position, beatType: beat.beatType, sourceSceneKey: beat.sourceSceneKey,
      locale: query.locale, sourceText });
    return { identity: { ownerUserId: work.ownerUserId, workId: work.id, releaseId: release.id,
      releaseChecksum: release.checksum, manuscriptVersionId: manuscript.id, manuscriptHash: manuscript.contentHash,
      partId: part.id, sceneId: scene.id, beatId: beat.id, artistId: artist.id, identityProfileId: profile.id,
      identityPinHash, locale: query.locale, sourceChecksum }, sourceText, artistDisplayName: artist.displayName };
  }

  private project(row: StoryInteractionApproval) {
    return { contract: STORY_INTERACTION_APPROVAL_CONTRACT, approvalId: row.id, workId: row.workId,
      beatId: row.beatId, artistId: row.artistId, locale: row.locale, sourceChecksum: row.sourceChecksum,
      identityPinHash: row.identityPinHash, approvalChecksum: row.approvalChecksum, interactionKind: row.interactionKind,
      evidenceStart: row.evidenceStart, evidenceText: row.evidenceText, memoryText: row.memoryText,
      status: row.status, revision: row.revision, approvedAt: row.approvedAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null, readerMemoryApplied: false };
  }

  private verify(source: Awaited<ReturnType<StoryInteractionApprovalService['source']>>, row: StoryInteractionApproval) {
    if (Object.entries(source.identity).some(([key, value]) => row[key as keyof StoryInteractionApproval] !== value) ||
      (row.status === 'approved' ? row.revision !== 1 || row.revokedAt !== null
        : row.status !== 'revoked' || row.revision !== 2 || row.revokedAt === null)) {
      this.changed('STORY_INTERACTION_APPROVAL_CHANGED');
    }
    const evidence = validateStoryInteractionEvidence(source.sourceText, { ...row,
      interactionKind: row.interactionKind as 'action' | 'dialogue', interactionReviewed: true });
    if (storyInteractionApprovalChecksum(source.identity, evidence) !== row.approvalChecksum) {
      this.changed('STORY_INTERACTION_APPROVAL_CHANGED');
    }
    return this.project(row);
  }

  async catalog(ownerUserId: string, workId: string, query: StoryInteractionCatalogQueryDto) {
    this.ids(ownerUserId, workId);
    this.locale(query?.locale);
    if (query.afterBeatId !== undefined) this.ids(query.afterBeatId, query.expectedReleaseId!);
    else if (query.expectedReleaseId !== undefined) this.ids(query.expectedReleaseId);
    if ((query.afterBeatId !== undefined || query.expectedReleaseChecksum !== undefined) &&
      (typeof query.expectedReleaseChecksum !== 'string' || !HASH.test(query.expectedReleaseChecksum))) {
      throw new BadRequestException({ code: 'STORY_INTERACTION_CHECKSUM_INVALID' });
    }
    return this.prisma.$transaction(async db => {
      await db.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
      const work = await this.work(db, ownerUserId, workId, false);
      const release = await db.storyRelease.findFirst({ where: { id: work.activeReleaseId!, workId: work.id, status: 'active' },
        select: { id: true, checksum: true, manuscriptVersionId: true } });
      const manuscript = release && await db.storyManuscriptVersion.findFirst({ where: {
        id: release.manuscriptVersionId, workId: work.id, ownerUserId: work.ownerUserId,
      }, select: { id: true, contentHash: true } });
      if (!release || !manuscript || !HASH.test(release.checksum) || !HASH.test(manuscript.contentHash)) this.changed();
      let cursor: CatalogPosition | undefined;
      if (query.afterBeatId !== undefined) {
        // Resolve only scoped ordering metadata before any localized text is queried.
        [cursor] = await db.$queryRaw<CatalogPosition[]>(Prisma.sql`
          SELECT b.id AS "beatId", s.id AS "sceneId", p.id AS "partId",
            p.position AS "partPosition", s.position AS "scenePosition", b.position AS "beatPosition"
          FROM story_beats b JOIN story_scenes s ON s.id = b.scene_id JOIN story_parts p ON p.id = s.part_id
          WHERE b.id = ${query.afterBeatId}::uuid AND p.work_id = ${work.id}::uuid
            AND p.status = 'published' AND p.fixture_source = false
            AND s.status = 'published' AND s.fixture_source = false
            AND b.beat_type IN ('paragraph', 'narration', 'dialogue') LIMIT 1`);
        if (!cursor) throw new NotFoundException({ code: 'STORY_INTERACTION_BEAT_UNAVAILABLE' });
      }
      if ((query.expectedReleaseId !== undefined && query.expectedReleaseId.toLowerCase() !== release.id) ||
        (query.expectedReleaseChecksum !== undefined && query.expectedReleaseChecksum !== release.checksum)) this.changed();
      const after = cursor ? Prisma.sql`AND (p.position, s.position, b.position, b.id) >
        (${cursor.partPosition}, ${cursor.scenePosition}, ${cursor.beatPosition}, ${cursor.beatId}::uuid)` : Prisma.empty;
      const rows = await db.$queryRaw<CatalogBeat[]>(Prisma.sql`
        SELECT b.id AS "beatId", s.id AS "sceneId", p.id AS "partId",
          p.position AS "partPosition", s.position AS "scenePosition", b.position AS "beatPosition", b.beat_type AS "beatType",
          CASE WHEN jsonb_typeof(b.content -> ${query.locale}) = 'string'
            THEN b.content ->> ${query.locale} ELSE NULL END AS "sourceText"
        FROM story_beats b JOIN story_scenes s ON s.id = b.scene_id JOIN story_parts p ON p.id = s.part_id
        WHERE p.work_id = ${work.id}::uuid AND p.status = 'published' AND p.fixture_source = false
          AND s.status = 'published' AND s.fixture_source = false
          AND b.beat_type IN ('paragraph', 'narration', 'dialogue') ${after}
        ORDER BY p.position, s.position, b.position, b.id LIMIT 9`);
      const items = rows.slice(0, 8).map(row => {
        const sourceText = this.sourceText(row.sourceText);
        return { beatId: row.beatId, sceneId: row.sceneId, partId: row.partId, partPosition: row.partPosition,
          scenePosition: row.scenePosition, beatPosition: row.beatPosition, beatType: row.beatType,
          sourceText, sourceAvailable: sourceText !== null };
      });
      return { contract: 'story-canonical-interaction-catalog-v1' as const, ownerUserId: work.ownerUserId, workId: work.id,
        releaseId: release.id, releaseChecksum: release.checksum, manuscriptVersionId: manuscript.id,
        manuscriptHash: manuscript.contentHash, locale: query.locale, items,
        nextAfterBeatId: rows.length > 8 ? items[items.length - 1].beatId : null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async review(ownerUserId: string, workId: string, beatId: string, query: StoryInteractionReviewQueryDto) {
    return this.prisma.$transaction(async db => {
      const source = await this.source(db, ownerUserId, workId, beatId, query, false);
      const rows = await db.storyInteractionApproval.findMany({ where: { workId: source.identity.workId,
        beatId: source.identity.beatId, artistId: source.identity.artistId, locale: source.identity.locale,
        sourceChecksum: source.identity.sourceChecksum, identityPinHash: source.identity.identityPinHash },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51 });
      return { contract: 'story-canonical-interaction-review-v1', ...source,
        approvals: rows.slice(0, 50).map(row => this.verify(source, row)), moreApprovals: rows.length > 50,
        proposalApproved: false, readerMemoryApplied: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async approve(ownerUserId: string, workId: string, beatId: string, input: ApproveStoryInteractionDto) {
    this.ids(input?.idempotencyKey);
    if (![input.expectedSourceChecksum, input.expectedIdentityPinHash].every(value => typeof value === 'string' && HASH.test(value))) {
      throw new BadRequestException({ code: 'STORY_INTERACTION_CHECKSUM_INVALID' });
    }
    return this.prisma.$transaction(async db => {
      const source = await this.source(db, ownerUserId, workId, beatId, input, true);
      if (input.expectedSourceChecksum !== source.identity.sourceChecksum || input.expectedIdentityPinHash !== source.identity.identityPinHash) this.changed();
      const evidence = validateStoryInteractionEvidence(source.sourceText, input);
      const approvalChecksum = storyInteractionApprovalChecksum(source.identity, evidence);
      const idempotencyKey = input.idempotencyKey.toLowerCase();
      const existing = await db.storyInteractionApproval.findUnique({ where: { ownerUserId_workId_idempotencyKey: {
        ownerUserId: source.identity.ownerUserId, workId: source.identity.workId, idempotencyKey,
      } } });
      if (existing) {
        if (existing.approvalChecksum !== approvalChecksum) this.changed('STORY_INTERACTION_IDEMPOTENCY_CONFLICT');
        return this.verify(source, existing);
      }
      const row = await db.storyInteractionApproval.create({ data: { ...source.identity, ...evidence, approvalChecksum, idempotencyKey } });
      await db.auditEvent.create({ data: { actorUserId: row.ownerUserId, actorType: 'user',
        action: 'story_interaction.approved', targetType: 'story_interaction_approval', targetId: row.id,
        metadata: { workId: row.workId, beatId: row.beatId, artistId: row.artistId, locale: row.locale,
          sourceChecksum: row.sourceChecksum, approvalChecksum: row.approvalChecksum } } });
      return this.project(row);
    }, { timeout: 15000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        this.changed('STORY_INTERACTION_SOURCE_CHANGED');
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.changed('STORY_INTERACTION_IDEMPOTENCY_CONFLICT');
      }
      throw error;
    });
  }

  async revoke(ownerUserId: string, workId: string, approvalId: string, input: RevokeStoryInteractionDto) {
    this.ids(ownerUserId, workId, approvalId);
    if (!input || input.expectedRevision !== 1 || typeof input.expectedApprovalChecksum !== 'string' || !HASH.test(input.expectedApprovalChecksum)) {
      throw new BadRequestException({ code: 'STORY_INTERACTION_REVISION_INVALID' });
    }
    return this.prisma.$transaction(async db => {
      // Withdrawal must still work for an unpublished or superseded source.
      await db.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${workId}::uuid AND owner_user_id = ${ownerUserId}::uuid FOR UPDATE`);
      const work = await db.storyWork.findFirst({ where: { id: workId, ownerUserId } });
      if (!work) throw new NotFoundException({ code: 'STORY_INTERACTION_WORK_UNAVAILABLE' });
      const row = await db.storyInteractionApproval.findFirst({ where: { id: approvalId, workId: work.id, ownerUserId: work.ownerUserId } });
      if (!row) throw new NotFoundException({ code: 'STORY_INTERACTION_APPROVAL_UNAVAILABLE' });
      if (row.approvalChecksum !== input.expectedApprovalChecksum) this.changed('STORY_INTERACTION_APPROVAL_CHANGED');
      if (row.status === 'revoked' && row.revision === 2) return this.project(row);
      const updated = await db.storyInteractionApproval.updateMany({ where: { id: row.id, status: 'approved', revision: 1 },
        data: { status: 'revoked', revision: 2, revokedAt: new Date() } });
      if (updated.count !== 1) this.changed('STORY_INTERACTION_APPROVAL_CHANGED');
      await db.auditEvent.create({ data: { actorUserId: row.ownerUserId, actorType: 'user',
        action: 'story_interaction.revoked', targetType: 'story_interaction_approval', targetId: row.id,
        metadata: { workId: row.workId, approvalChecksum: row.approvalChecksum } } });
      return this.project(await db.storyInteractionApproval.findUniqueOrThrow({ where: { id: row.id } }));
    });
  }
}

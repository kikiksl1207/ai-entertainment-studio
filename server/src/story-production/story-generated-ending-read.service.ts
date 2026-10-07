import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditEvent, Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ConfirmStoryGeneratedEndingReadDto, StoryGeneratedEndingReadQueryDto } from './dto/story-generated-ending-read.dto';
import { StoryProductionService } from './story-production.service';
import { isPublicStorySourceSafe, STORY_LOCALES } from './story-production.policy';
import { validCanonicalStoryText } from './story-canonical-source.policy';
import { currentApprovedStoryVisual } from './story-approved-visual-context.policy';
import { parseContinuationGenerationProfilePin } from './story-continuation-context.policy';

const HASH = /^[a-f0-9]{64}$/;
const ACTION = 'story.generated_ending_read.confirmed';
const RECEIPT = 'story-generated-ending-read-receipt-v1';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const record = (value: unknown): Prisma.JsonObject => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Prisma.JsonObject : {};

// This records an explicit last-page confirmation, not attention, approval, or publication.
@Injectable()
export class StoryGeneratedEndingReadService {
  constructor(private readonly prisma: PrismaService, private readonly stories: StoryProductionService) {}

  private changed(code = 'STORY_GENERATED_ENDING_READ_SCOPE_CHANGED'): never {
    throw new ConflictException({ code });
  }

  private validate(userId: string, progressId: string, query: StoryGeneratedEndingReadQueryDto) {
    if (![userId, progressId].every(id => typeof id === 'string' && isUUID(id)) ||
      !STORY_LOCALES.includes(query?.locale as typeof STORY_LOCALES[number]) ||
      !Number.isSafeInteger(query?.fromPosition) || query.fromPosition < 1 || query.fromPosition > 40) {
      throw new BadRequestException({ code: 'STORY_GENERATED_ENDING_READ_INPUT_INVALID' });
    }
  }

  private async delivery(userId: string, progressId: string, locale: string) {
    const page = await this.stories.currentProgress(userId, progressId, locale, false);
    const scene = page.scene;
    if (page.progressId !== progressId || page.status !== 'completed' || !scene ||
      !('isGenerated' in scene) || scene.isGenerated !== true || !('deliveryState' in scene) ||
      scene.deliveryState !== 'ready' || scene.endingType !== 'ai_generated' || page.choices.length) {
      this.changed('STORY_GENERATED_ENDING_READ_DELIVERY_UNAVAILABLE');
    }
    return { ...page, scene };
  }

  private async artwork(db: Prisma.TransactionClient,
    page: Awaited<ReturnType<StoryGeneratedEndingReadService['delivery']>>, lock: boolean) {
    const background = record(record(page.scene.visualManifest).background);
    const path = typeof background.publicAssetPath === 'string' ? background.publicAssetPath : '';
    const id = path.startsWith('/api/v1/story-visual-assets/') ? path.slice('/api/v1/story-visual-assets/'.length) : '';
    if (background.state !== 'ready' || id.length !== 36 || !isUUID(id)) this.changed('STORY_GENERATED_ENDING_READ_ARTWORK_CHANGED');
    // A ready projection is not enough: the asset can be withdrawn before receipt persistence.
    if (lock) await db.$queryRaw(Prisma.sql`SELECT id FROM assets WHERE id = ${id}::uuid FOR SHARE`);
    const asset = await db.asset.findFirst({ where: { id, assetType: 'image', visibility: 'public',
      mimeType: 'image/webp', checksum: { not: null } },
      select: { id: true, checksum: true, storageProvider: true, storageKey: true, metadata: true } });
    const lifecycle = record(asset?.metadata).lifecycle;
    if (!asset || !HASH.test(asset.checksum!) ||
      (lifecycle !== undefined && record(lifecycle).status !== 'active')) this.changed('STORY_GENERATED_ENDING_READ_ARTWORK_CHANGED');
    return hash([asset!.id, asset!.checksum, asset!.storageProvider, asset!.storageKey, asset!.metadata]);
  }

  private async source(db: Prisma.TransactionClient, userId: string, progressId: string,
    query: StoryGeneratedEndingReadQueryDto, page: Awaited<ReturnType<StoryGeneratedEndingReadService['delivery']>>, lock: boolean) {
    if (lock) await db.$queryRaw(Prisma.sql`SELECT id FROM story_reader_progress
      WHERE id = ${progressId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`);
    const progress = await db.storyReaderProgress.findFirst({ where: { id: progressId, userId } });
    if (!progress) throw new NotFoundException({ code: 'STORY_GENERATED_ENDING_READ_PROGRESS_UNAVAILABLE' });
    if (progress.status !== 'completed' || progress.currentSceneId || !progress.currentGeneratedSceneId ||
      !progress.activeReleaseId || !progress.routeNodeId || !Number.isSafeInteger(progress.progressRevision) ||
      progress.progressRevision < 1 || page.revision !== progress.progressRevision ||
      page.scene?.id !== progress.currentGeneratedSceneId || page.workId !== progress.workId ||
      page.storyVersion !== progress.storyVersion) this.changed();
    if (lock) await db.$queryRaw(Prisma.sql`SELECT w.id FROM story_works w
      JOIN story_releases r ON r.id = w.active_release_id
      JOIN story_manuscript_versions m ON m.id = r.manuscript_version_id
      WHERE w.id = ${progress.workId}::uuid FOR SHARE OF w, r, m`);
    const work = await db.storyWork.findFirst({ where: { id: progress.workId, status: 'published', fixtureSource: false } });
    if (!work || work.activeReleaseId !== progress.activeReleaseId || work.publishedVersion !== progress.storyVersion ||
      !isPublicStorySourceSafe({ fixtureSource: work.fixtureSource, slug: work.slug, manifest: work.coverManifest })) this.changed();
    const release = await db.storyRelease.findFirst({ where: { id: progress.activeReleaseId, workId: work!.id,
      status: 'active', version: progress.storyVersion } });
    const manuscript = release && await db.storyManuscriptVersion.findFirst({ where: { id: release.manuscriptVersionId,
      workId: work!.id, ownerUserId: work!.ownerUserId } });
    if (!release || !manuscript || !HASH.test(release.checksum) || !HASH.test(manuscript.contentHash)) this.changed();
    if (lock) await db.$queryRaw(Prisma.sql`SELECT s.id FROM story_ai_generated_scenes s
      JOIN story_ai_continuations c ON c.id = s.continuation_id JOIN story_parts p ON p.id = s.source_part_id
      WHERE s.id = ${progress.currentGeneratedSceneId!}::uuid FOR SHARE OF s, c, p`);
    const scene = await db.storyAiGeneratedScene.findFirst({ where: { id: progress.currentGeneratedSceneId!,
      userId, progressId, workId: work!.id, releaseId: release!.id, status: 'ready', endingType: 'ai_generated' } });
    const part = scene && await db.storyPart.findFirst({ where: { id: scene.sourcePartId, workId: work!.id,
      status: 'published', fixtureSource: false } });
    const origin = scene && await db.storyAiContinuation.findFirst({ where: { id: scene.continuationId,
      userId, progressId, workId: work!.id, releaseId: release!.id, status: 'completed', resultGeneratedSceneId: scene.id } });
    if (!scene || !part || !origin || origin.sourcePartId !== scene.sourcePartId || !HASH.test(scene.resultChecksum) || origin.releaseChecksum !== release!.checksum ||
      origin.manuscriptVersionId !== manuscript!.id || part.actNumber !== progress.currentAct ||
      !['ai_generated', 'ai_reused'].includes(scene.provenance)) this.changed();
    // Approval reads made before this transaction cannot protect a later consent withdrawal.
    if (lock) await db.$queryRaw(Prisma.sql`SELECT id FROM story_style_profile_consents
      WHERE work_id = ${work!.id}::uuid FOR SHARE`);
    const approval = await currentApprovedStoryVisual(db, work!, manuscript!.id).catch(error => {
      if (error instanceof ConflictException) this.changed('STORY_GENERATED_ENDING_READ_ARTWORK_CHANGED');
      throw error;
    });
    let boundPin, currentPin;
    try {
      boundPin = parseContinuationGenerationProfilePin(record(origin!.contextReferences).generationProfilePin);
      currentPin = parseContinuationGenerationProfilePin(approval?.approvalIdentity as Prisma.JsonValue | undefined);
    } catch { this.changed('STORY_GENERATED_ENDING_READ_ARTWORK_CHANGED'); }
    if (hash(boundPin ?? null) !== hash(currentPin ?? null)) this.changed('STORY_GENERATED_ENDING_READ_ARTWORK_CHANGED');
    if (await db.storyAiGeneratedChoice.count({ where: { sceneId: scene!.id } })) this.changed();
    if (lock) await db.$queryRaw(Prisma.sql`SELECT id FROM story_progress_route_nodes
      WHERE id = ${progress.routeNodeId!}::uuid AND progress_id = ${progressId}::uuid FOR SHARE`);
    const route = await db.storyProgressRouteNode.findFirst({ where: { id: progress.routeNodeId!, progressId,
      workId: work!.id, releaseId: release!.id } });
    const arrival = record(route?.narrativeStep);
    if (!route || route.parentId !== origin!.sourceRouteNodeId || arrival.generatedSceneId !== scene!.id ||
      arrival.provenance !== scene!.provenance || arrival.sourceSceneId !== origin!.sourceSceneId ||
      arrival.sourceGeneratedSceneId !== origin!.sourceGeneratedSceneId) this.changed();
    if (!work!.priceLumina.isZero() || !part!.priceLumina.isZero()) {
      if (lock) await db.$queryRaw(Prisma.sql`SELECT id FROM user_entitlements
        WHERE user_id = ${userId}::uuid AND reference_id IN (${work!.id}::uuid, ${part!.id}::uuid)
          AND entitlement_type IN ('story_work', 'story_season', 'story_part') FOR SHARE`);
      const now = new Date();
      const access = await db.userEntitlement.findFirst({ where: { userId,
        entitlementType: { in: ['story_work', 'story_season', 'story_part'] }, referenceId: { in: [work!.id, part!.id] },
        revokedAt: null, startsAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { id: true } });
      if (!access) throw new ForbiddenException({ code: 'STORY_GENERATED_ENDING_READ_ACCESS_REQUIRED' });
    }
    if (lock) await db.$queryRaw(Prisma.sql`SELECT id FROM story_ai_generated_beats
      WHERE scene_id = ${scene!.id}::uuid ORDER BY position, id FOR SHARE`);
    const beats = await db.storyAiGeneratedBeat.findMany({ where: { sceneId: scene!.id },
      orderBy: [{ position: 'asc' }, { id: 'asc' }], take: 41 });
    if (!beats.length || beats.length > 40 || new Set(beats.map(beat => beat.id)).size !== beats.length ||
      beats.some((beat, index) => !isUUID(beat.id) || !Number.isSafeInteger(beat.position) || beat.position < 1 || beat.position > 40 ||
        (index > 0 && beat.position <= beats[index - 1].position) || !validCanonicalStoryText(record(beat.content)[query.locale])) ||
      !beats.some(beat => beat.position === query.fromPosition)) this.changed();
    const throughPosition = beats.at(-1)!.position;
    const firstPageSentinel = progress.currentBeatPosition === 0 && query.fromPosition === beats[0].position;
    if (!Number.isSafeInteger(progress.currentBeatPosition) || (!firstPageSentinel && progress.currentBeatPosition < query.fromPosition) ||
      progress.currentBeatPosition > throughPosition) this.changed('STORY_GENERATED_ENDING_READ_PAGE_UNAVAILABLE');
    const projected = page.scene?.beats;
    if (!Array.isArray(projected) || projected.length !== beats.length || projected.some((beat, index) =>
      beat.id !== beats[index].id || beat.position !== beats[index].position ||
      (typeof beat.content === 'string' ? beat.content : record(beat.content).value) !== record(beats[index].content)[query.locale])) this.changed();
    const sourceTextHash = hash(beats.filter(beat => beat.position >= query.fromPosition).map(beat => [beat.id, beat.position,
      (record(beat.content)[query.locale] as string).replace(/\\r\\n|\\n|\\r/gu, '\n')]));
    const artworkHash = await this.artwork(db, page, lock);
    // Cursor revisions gate the command, but ordinary pagination must not erase an unchanged read receipt.
    const scopeChecksum = hash({ contract: 'story-generated-ending-read-scope-v1', userId, progressId,
      workId: work!.id, ownerUserId: work!.ownerUserId, releaseId: release!.id, releaseChecksum: release!.checksum,
      storyVersion: progress.storyVersion, manuscriptId: manuscript!.id, manuscriptHash: manuscript!.contentHash,
      sceneId: scene!.id, partId: part!.id, actNumber: part!.actNumber, sceneChecksum: scene!.resultChecksum, originId: origin!.id,
      routeId: route!.id, routeHash: route!.routeHash, arrivalHash: hash(arrival), pathHash: hash(progress.pathSummary),
      bodyHash: hash(beats.map(beat => [beat.id, beat.position, beat.beatType, beat.content])),
      visualHash: hash(page.scene!.visualManifest), artworkHash, authorVisualApprovalHash: approval?.fingerprint ?? null,
      locale: query.locale, fromPosition: query.fromPosition,
      throughPosition, sourceTextHash });
    return { userId, progressId, workId: work!.id, sceneId: scene!.id, locale: query.locale, fromPosition: query.fromPosition,
      throughPosition, expectedRevision: progress.progressRevision, scopeChecksum, sourceTextHash };
  }

  private receipt(row: AuditEvent, source: Awaited<ReturnType<StoryGeneratedEndingReadService['source']>>, replay: boolean) {
    const metadata = record(row.metadata), receipt = record(metadata.receipt);
    if (row.actorType !== 'user' || row.actorUserId !== source.userId || row.action !== ACTION ||
      row.targetType !== 'story_reader_progress' || row.targetId !== source.progressId ||
      metadata.explicitRead !== true || metadata.meaningApproved !== false || metadata.qualityApproved !== false ||
      metadata.publicationStarted !== false || receipt.contract !== RECEIPT ||
      ['progressId', 'workId', 'sceneId', 'locale', 'fromPosition', 'throughPosition', 'scopeChecksum', 'sourceTextHash']
        .some(key => receipt[key] !== source[key as keyof typeof source]) ||
      !Number.isSafeInteger(receipt.progressRevision) || Number(receipt.progressRevision) < 1 ||
      Number(receipt.progressRevision) > source.expectedRevision || typeof receipt.confirmedAt !== 'string' ||
      !Number.isFinite(Date.parse(receipt.confirmedAt)) || receipt.progressMutated !== false || receipt.generationStarted !== false ||
      receipt.imageGenerationStarted !== false || receipt.meaningApproved !== false || receipt.qualityApproved !== false ||
      receipt.publicationStarted !== false) this.changed('STORY_GENERATED_ENDING_READ_EVIDENCE_INVALID');
    return { ...receipt, receiptId: row.id, idempotentReplay: replay };
  }

  async preview(userId: string, progressId: string, query: StoryGeneratedEndingReadQueryDto) {
    this.validate(userId, progressId, query); userId = userId.toLowerCase(); progressId = progressId.toLowerCase();
    const page = await this.delivery(userId, progressId, query.locale);
    return this.prisma.$transaction(async db => {
      await db.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
      const source = await this.source(db, userId, progressId, query, page, false);
      const rows = await db.auditEvent.findMany({ where: { actorType: 'user', actorUserId: userId, action: ACTION,
        targetType: 'story_reader_progress', targetId: progressId,
        metadata: { path: ['scopeChecksum'], equals: source.scopeChecksum } }, take: 2 });
      if (rows.length > 1) this.changed('STORY_GENERATED_ENDING_READ_EVIDENCE_INVALID');
      return { contract: 'story-generated-ending-read-review-v1', ...source,
        confirmation: rows.length ? this.receipt(rows[0], source, false) : null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async confirm(userId: string, progressId: string, input: ConfirmStoryGeneratedEndingReadDto) {
    this.validate(userId, progressId, input);
    if (input.displayedAndRead !== true || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 ||
      input.expectedRevision > 2147483646 || !isUUID(input.idempotencyKey) ||
      ![input.expectedScopeChecksum, input.expectedSourceTextHash].every(value => typeof value === 'string' && HASH.test(value))) {
      throw new BadRequestException({ code: 'STORY_GENERATED_ENDING_READ_INPUT_INVALID' });
    }
    userId = userId.toLowerCase(); progressId = progressId.toLowerCase();
    const page = await this.delivery(userId, progressId, input.locale);
    const commandHash = hash([ACTION, userId, input.idempotencyKey.toLowerCase()]);
    const fingerprint = hash([progressId, input.locale, input.fromPosition, input.expectedRevision,
      input.expectedScopeChecksum, input.expectedSourceTextHash]);
    return this.prisma.$transaction(async db => {
      const source = await this.source(db, userId, progressId, input, page, true);
      if (source.expectedRevision !== input.expectedRevision || source.scopeChecksum !== input.expectedScopeChecksum ||
        source.sourceTextHash !== input.expectedSourceTextHash) this.changed();
      await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`story-ending-read:${commandHash}`}, 2060))`);
      const sameKey = await db.auditEvent.findMany({ where: { actorType: 'user', actorUserId: userId, action: ACTION,
        metadata: { path: ['commandHash'], equals: commandHash } }, take: 2 });
      if (sameKey.length > 1) this.changed('STORY_GENERATED_ENDING_READ_EVIDENCE_INVALID');
      if (sameKey.length) {
        if (record(sameKey[0].metadata).fingerprint !== fingerprint) this.changed('STORY_GENERATED_ENDING_READ_IDEMPOTENCY_CONFLICT');
        return this.receipt(sameKey[0], source, true);
      }
      const existing = await db.auditEvent.findMany({ where: { actorType: 'user', actorUserId: userId, action: ACTION,
        targetType: 'story_reader_progress', targetId: progressId,
        metadata: { path: ['scopeChecksum'], equals: source.scopeChecksum } }, take: 2 });
      if (existing.length) this.changed('STORY_GENERATED_ENDING_READ_ALREADY_RECORDED');
      const { expectedRevision, ...identity } = source;
      const receipt = { contract: RECEIPT, ...identity, progressRevision: expectedRevision,
        confirmedAt: new Date().toISOString(), progressMutated: false, generationStarted: false,
        imageGenerationStarted: false, meaningApproved: false, qualityApproved: false, publicationStarted: false };
      const row = await db.auditEvent.create({ data: { actorType: 'user', actorUserId: userId, action: ACTION,
        targetType: 'story_reader_progress', targetId: progressId, metadata: { commandHash, fingerprint,
          scopeChecksum: source.scopeChecksum, explicitRead: true, meaningApproved: false, qualityApproved: false,
          publicationStarted: false, receipt } } });
      return this.receipt(row, source, false);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) this.changed();
      throw error;
    });
  }
}

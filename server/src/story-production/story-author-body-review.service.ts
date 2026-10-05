import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { StoryArtistParticipantService } from './story-artist-participant.service';
import { storyAiResultChecksum } from './story-ai-result-checksum';
import { continuationGenerationProfileSnapshot, continuationMemoryPins, parseContinuationGenerationProfilePin } from './story-continuation-context.policy';
import {
  AUTHOR_BODY_REVIEW_CONTRACT, COMPANY_BODY_DELEGATION_CONTRACT, AuthorBodyReviewInput, bodyReviewHash, bodyReviewKey,
  bodyReviewScope, normalizeBodyReviewInput, privateBodyReviewFlags,
} from './story-author-body-review.policy';
import { BodyReviewRow, bodyReviewById, bodyReviewByKey, bodyReviewBlocksCompanyDelegation, insertBodyReview, latestBodyReview } from './story-author-body-review.store';
import { resolveCompanyPublishedSource } from './story-company-source.policy';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
type Target = { progressId: string; progressRevision: number; sceneId: string; sourceBindingHash: string;
  bodyChecksum: string; ending: boolean };
type Snapshot = { state: 'reviewable' | 'not_generated' | 'generation_pending' | 'source_changed';
  target: Target | null; binding?: Record<string, unknown>; continuationId?: string; delegation?: Record<string, unknown> | null };

@Injectable()
export class StoryAuthorBodyReviewService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(StoryAuthorBodyReviewService.name);
  private readonly approvalRetries = new Map<string, number>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private backgroundApproval: Promise<void> | null = null;
  private recoveryScanPending = false;
  private recoveryScanFailures = 0;
  private recoveryCursor: string | null = null;
  private stopping = false;
  constructor(private readonly prisma: PrismaService, private readonly participants: StoryArtistParticipantService) {}

  onApplicationBootstrap() {
    this.backgroundApproval = this.recoverCompanyApprovalsSafely()
      .finally(() => { this.backgroundApproval = null; this.scheduleApprovalRetries(); });
  }

  async onApplicationShutdown() {
    this.stopping = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    await this.backgroundApproval;
    this.approvalRetries.clear();
    this.recoveryScanPending = false;
  }

  deferCompanyContinuationApproval(continuationId: string) {
    if (this.stopping || !isUUID(continuationId)) return;
    if (!this.approvalRetries.has(continuationId)) this.approvalRetries.set(continuationId, 0);
    this.scheduleApprovalRetries();
  }

  private scheduleApprovalRetries() {
    if (this.stopping || this.retryTimer || this.backgroundApproval ||
        (!this.recoveryScanPending && !this.approvalRetries.size)) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.backgroundApproval = (async () => {
        if (this.recoveryScanPending) await this.recoverCompanyApprovalsSafely();
        await this.retryCompanyApprovals();
      })()
        .catch(() => this.logger.warn('Company body approval retry deferred'))
        .finally(() => { this.backgroundApproval = null; this.scheduleApprovalRetries(); });
    }, 60_000);
    this.retryTimer.unref();
  }

  private async retryCompanyApprovals() {
    // Only approval writes are retried. The completed continuation is the durable recovery source.
    for (const [id, attempts] of [...this.approvalRetries].slice(0, 25)) {
      if (this.stopping) return;
      try { await this.autoApproveCompanyContinuation(id); this.approvalRetries.delete(id); }
      catch (error) {
        if (error instanceof ConflictException || error instanceof BadRequestException ||
            error instanceof NotFoundException || attempts + 1 >= 5) this.approvalRetries.delete(id);
        else this.approvalRetries.set(id, attempts + 1);
      }
    }
  }

  private async recoverCompanyApprovalsSafely() {
    try {
      await this.recoverCompanyApprovals();
      this.recoveryScanPending = false;
      this.recoveryScanFailures = 0;
    } catch {
      this.recoveryScanPending = ++this.recoveryScanFailures <= 5;
      this.logger.warn('Company body approval recovery scan deferred');
    }
  }

  private async recoverCompanyApprovals() {
    while (true) {
      if (this.stopping) return;
      const after = this.recoveryCursor;
      const rows: Array<{ id: string; continuationId: string }> = await this.prisma.$queryRaw(Prisma.sql`
        SELECT p.id, s.continuation_id AS "continuationId" FROM story_reader_progress p
        JOIN story_works w ON w.id = p.work_id AND w.owner_user_id = p.user_id
        JOIN story_ai_generated_scenes s ON s.id = p.current_generated_scene_id
        WHERE w.author_display_name = ${'루미나'} AND w.fixture_source = false AND w.status = 'published'
          AND p.status IN ('active','completed') AND (${after}::uuid IS NULL OR p.id > ${after}::uuid)
        ORDER BY p.id LIMIT 100`);
      if (!rows.length) return;
      for (const row of rows) {
        if (this.stopping) return;
        try { await this.autoApproveCompanyContinuation(row.continuationId); }
        catch (error) {
          if (!(error instanceof ConflictException || error instanceof BadRequestException || error instanceof NotFoundException))
            this.deferCompanyContinuationApproval(row.continuationId);
          this.logger.warn('Company body approval recovery deferred');
        }
      }
      this.recoveryCursor = rows[rows.length - 1].id;
    }
  }

  async autoApproveCompanyContinuation(continuationId: string) {
    if (!isUUID(continuationId)) return null;
    const origin = await this.prisma.storyAiContinuation.findFirst({ where: { id: continuationId, status: 'completed' },
      select: { userId: true, workId: true, locale: true } });
    if (!origin) return null;
    return this.write(async db => {
      const work = await db.storyWork.findFirst({ where: { id: origin.workId, ownerUserId: origin.userId,
        fixtureSource: false, authorDisplayName: '루미나', status: 'published' }, select: { id: true } });
      if (!work) return null;
      await this.owner(db, origin.userId, origin.workId, true);
      const snapshot = await this.snapshot(db, origin.userId, origin.workId, origin.locale, true);
      if (!snapshot.target || !snapshot.binding || !snapshot.delegation || snapshot.continuationId !== continuationId) return null;
      const head = await latestBodyReview(db, origin.userId, origin.workId);
      // Revisiting a scene must not undo even a superseded human decision or withdrawal.
      if (await bodyReviewBlocksCompanyDelegation(db, origin.userId, origin.workId, snapshot.target.sceneId)) return null;
      const requestHash = bodyReviewHash({ sourceBindingHash: snapshot.target.sourceBindingHash, delegation: snapshot.delegation });
      const key = `company-body:${requestHash}`;
      const previous = await bodyReviewByKey(db, origin.userId, origin.workId, key);
      if (previous) return this.project(previous, head, snapshot);
      const body: AuthorBodyReviewInput = { locale: origin.locale, sourceBindingHash: snapshot.target.sourceBindingHash,
        expectedProgressRevision: snapshot.target.progressRevision, expectedReviewId: head?.id ?? null,
        decision: 'approve', styleReviewed: false, charactersReviewed: false, timelineReviewed: false };
      const row = await insertBodyReview(db, { id: randomUUID(), owner: origin.userId, work: origin.workId,
        progress: snapshot.target.progressId, scene: snapshot.target.sceneId, continuation: continuationId,
        binding: snapshot.binding, delegation: snapshot.delegation, body, version: (head?.version ?? 0) + 1, key, requestHash });
      await db.auditEvent.create({ data: { actorType: 'system', action: 'story.author_body_review.company_delegated',
        targetType: 'story_author_body_review', targetId: row.id, metadata: {
          sourceBindingHash: body.sourceBindingHash, version: row.version, approvalBasis: 'company_delegation',
          humanSemanticReview: false, publicationStarted: false, sharedReuseAuthorized: false } } });
      return this.project(row, row, snapshot);
    });
  }

  private changed(): never { throw new ConflictException({ code: 'STORY_AUTHOR_BODY_REVIEW_SOURCE_CHANGED' }); }

  private async owner(db: Prisma.TransactionClient, userId: string, workId: string, lock = false) {
    if (lock) await db.$queryRaw(Prisma.sql`SELECT id FROM story_works
      WHERE id = ${workId}::uuid AND owner_user_id = ${userId}::uuid FOR UPDATE`);
    const work = await db.storyWork.findFirst({ where: { id: workId, ownerUserId: userId, fixtureSource: false },
      select: { id: true, status: true, activeReleaseId: true, publishedVersion: true, releaseRevision: true, authorDisplayName: true } });
    if (!work) throw new NotFoundException({ code: 'STORY_AUTHOR_BODY_REVIEW_UNAVAILABLE' });
    return work;
  }

  private async snapshot(db: Prisma.TransactionClient, userId: string, workId: string, locale: string, lock = false): Promise<Snapshot> {
    const work = await this.owner(db, userId, workId);
    if (lock) await db.$queryRaw(Prisma.sql`SELECT id FROM story_reader_progress
      WHERE user_id = ${userId}::uuid AND work_id = ${workId}::uuid FOR UPDATE`);
    const progress = await db.storyReaderProgress.findUnique({ where: { userId_workId: { userId, workId } } });
    if (work.status !== 'published') return { state: 'source_changed', target: null };
    if (!progress) return { state: 'not_generated', target: null };
    if (progress.status === 'ai_pending') return { state: 'generation_pending', target: null };
    if (!['active', 'completed'].includes(progress.status) || progress.userId !== userId || progress.workId !== workId ||
        progress.activeReleaseId !== work.activeReleaseId || progress.storyVersion !== work.publishedVersion ||
        !work.activeReleaseId || (progress.currentSceneId && progress.currentGeneratedSceneId)) this.changed();
    if (!progress.currentGeneratedSceneId) return { state: 'not_generated', target: null };
    if (lock) {
      // Match writer order: work, progress, then immutable result and mutable source pins.
      await db.$queryRaw(Prisma.sql`SELECT id FROM story_releases WHERE id = ${work.activeReleaseId}::uuid FOR SHARE`);
      await db.$queryRaw(Prisma.sql`SELECT id FROM story_ai_generated_scenes WHERE id = ${progress.currentGeneratedSceneId}::uuid FOR SHARE`);
      await db.$queryRaw(Prisma.sql`SELECT id FROM story_manuscript_versions WHERE work_id = ${workId}::uuid ORDER BY version DESC LIMIT 1 FOR SHARE`);
      await db.$queryRaw(Prisma.sql`SELECT id FROM story_work_generation_profiles WHERE work_id = ${workId}::uuid ORDER BY profile_version DESC LIMIT 1 FOR SHARE`);
      await db.$queryRaw(Prisma.sql`SELECT id FROM story_style_profile_consents WHERE work_id = ${workId}::uuid FOR SHARE`);
      await db.$queryRaw(Prisma.sql`SELECT id FROM story_release_capabilities WHERE release_id = ${work.activeReleaseId}::uuid FOR SHARE`);
    }
    const release = await db.storyRelease.findFirst({ where: { id: work.activeReleaseId, workId, status: 'active' } });
    const manuscript = await db.storyManuscriptVersion.findFirst({ where: { workId, ownerUserId: userId }, orderBy: { version: 'desc' },
      select: { id: true, contentHash: true, locale: true } });
    const scene = await db.storyAiGeneratedScene.findFirst({ where: { id: progress.currentGeneratedSceneId,
      userId, workId, progressId: progress.id, releaseId: work.activeReleaseId, status: 'ready', provenance: 'ai_generated' } });
    if (!release || !manuscript || !scene || release.version !== progress.storyVersion ||
        release.manuscriptVersionId !== manuscript.id || !/^[a-f0-9]{64}$/.test(manuscript.contentHash) ||
        !/^[a-f0-9]{64}$/.test(release.checksum)) this.changed();
    if (lock) {
      await db.$queryRaw(Prisma.sql`SELECT id FROM story_ai_continuations WHERE id = ${scene.continuationId}::uuid FOR SHARE`);
      await db.$queryRaw(Prisma.sql`SELECT id FROM story_parts WHERE id = ${scene.sourcePartId}::uuid FOR SHARE`);
      await db.$queryRaw(Prisma.sql`SELECT id FROM story_ai_generated_beats WHERE scene_id = ${scene.id}::uuid ORDER BY position FOR SHARE`);
      await db.$queryRaw(Prisma.sql`SELECT id FROM story_ai_generated_choices WHERE scene_id = ${scene.id}::uuid ORDER BY position FOR SHARE`);
      await db.$queryRaw(Prisma.sql`SELECT id FROM story_progress_route_nodes WHERE id = ${progress.routeNodeId}::uuid FOR SHARE`);
    }
    const origin = await db.storyAiContinuation.findFirst({ where: { id: scene.continuationId,
      userId, workId, progressId: progress.id, releaseId: release.id, resultGeneratedSceneId: scene.id, status: 'completed' } });
    const part = await db.storyPart.findFirst({ where: { id: scene.sourcePartId, workId, status: 'published', fixtureSource: false } });
    const route = progress.routeNodeId ? await db.storyProgressRouteNode.findFirst({ where: {
      id: progress.routeNodeId, progressId: progress.id, workId, releaseId: release.id } }) : null;
    if (!origin || !part || !route || origin.sourcePartId !== part.id || origin.manuscriptVersionId !== manuscript.id ||
        origin.releaseChecksum !== release.checksum || origin.locale !== locale || !/^[a-f0-9]{64}$/.test(origin.contextFingerprint) ||
        origin.sourceRouteNodeId !== route.parentId || record(route.narrativeStep).generatedSceneId !== scene.id ||
        progress.progressRevision < origin.sourceProgressRevision + 2) this.changed();
    const references = record(origin.contextReferences);
    if (Buffer.byteLength(JSON.stringify(references), 'utf8') > 256 * 1024) this.changed();
    if (!Array.isArray(references.memoryPins)) this.changed();
    const memoryPins = references.memoryPins.map(record);
    if (memoryPins.some(pin => typeof pin.id !== 'string' || !isUUID(pin.id) ||
        !Number.isInteger(pin.revision) || Number(pin.revision) < 1 ||
        typeof pin.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(pin.contentHash)) ||
        new Set(memoryPins.map(pin => pin.id)).size !== memoryPins.length) this.changed();
    if (memoryPins.length) {
      const ids = memoryPins.map(pin => pin.id as string);
      if (lock) await db.$queryRaw(Prisma.sql`SELECT id FROM story_memory_records
        WHERE work_id = ${workId}::uuid AND id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})
        ORDER BY id FOR SHARE`);
      const memories = await db.storyMemoryRecord.findMany({ where: { id: { in: ids }, workId,
        manuscriptVersionId: manuscript.id, analysisJobId: origin.analysisJobId!, status: 'approved' },
        select: { id: true, revision: true, content: true } });
      const currentPins = new Map(continuationMemoryPins(memories).map(pin => [pin.id, pin]));
      if (currentPins.size !== memoryPins.length || memoryPins.some(pin =>
          bodyReviewHash(currentPins.get(pin.id as string)) !== bodyReviewHash(pin))) this.changed();
    }
    const consent = await db.storyStyleProfileConsent.findFirst({ where: { id: origin.styleConsentId,
      workId, ownerUserId: userId, manuscriptVersionId: manuscript.id, status: 'active', revision: origin.styleConsentRevision } });
    const capability = await db.storyReleaseCapability.findFirst({ where: { workId, releaseId: release.id,
      status: 'active', revision: origin.capabilityRevision } });
    const now = new Date();
    if (!consent || !capability || !consent.rightsConfirmed || !consent.aiBranchAllowed ||
        consent.withdrawnAt || consent.deletionRequestedAt || consent.deletedAt || consent.startsAt > now ||
        (consent.expiresAt && consent.expiresAt <= now) || !Array.isArray(consent.allowedLocales) ||
        !consent.allowedLocales.includes(locale)) this.changed();
    if (lock) await db.$queryRaw(Prisma.sql`SELECT id FROM story_analysis_jobs
      WHERE work_id = ${workId}::uuid AND manuscript_version_id = ${manuscript.id}::uuid
      ORDER BY analysis_version DESC LIMIT 1 FOR SHARE`);
    const analysis = await db.storyAnalysisJob.findFirst({ where: { workId, manuscriptVersionId: manuscript.id },
      orderBy: { analysisVersion: 'desc' }, select: { id: true, analysisVersion: true, status: true, pipeline: true } });
    if (!analysis || analysis.status !== 'completed' || analysis.id !== origin.analysisJobId ||
        analysis.analysisVersion !== origin.analysisVersion) this.changed();
    const profile = await db.storyWorkGenerationProfile.findFirst({ where: { workId }, orderBy: { profileVersion: 'desc' } });
    let profilePin;
    try {
      profilePin = parseContinuationGenerationProfilePin(references.generationProfilePin as Prisma.JsonValue | undefined);
      if (profilePin) {
        if (!profile || profile.ownerUserId !== userId || profile.manuscriptVersionId !== manuscript.id ||
            profile.analysisJobId !== analysis.id || bodyReviewHash(continuationGenerationProfileSnapshot(profile).pin) !== bodyReviewHash(profilePin)) this.changed();
      } else if (profile || analysis.pipeline === 'semantic_extraction_v1') this.changed();
    } catch { this.changed(); }
    if (lock) {
      await db.$queryRaw(Prisma.sql`SELECT id FROM story_progress_artist_participants WHERE progress_id = ${progress.id}::uuid FOR SHARE`);
      await db.$queryRaw(Prisma.sql`SELECT a.id FROM artists a JOIN story_progress_artist_participants p ON p.artist_id = a.id
        WHERE p.progress_id = ${progress.id}::uuid FOR SHARE OF a`);
      await db.$queryRaw(Prisma.sql`SELECT a.id FROM artist_story_identity_profiles a JOIN story_progress_artist_participants p
        ON p.identity_profile_id = a.id WHERE p.progress_id = ${progress.id}::uuid FOR SHARE OF a`);
      await db.$queryRaw(Prisma.sql`SELECT a.id FROM assets a JOIN artist_assets aa ON aa.asset_id = a.id
        JOIN story_progress_artist_participants p ON p.artist_id = aa.artist_id WHERE p.progress_id = ${progress.id}::uuid FOR SHARE OF a, aa`);
    }
    let participant;
    try { participant = await this.participants.pinnedContext(db, progress.id); } catch { this.changed(); }
    if (bodyReviewHash(participant?.pin ?? null) !== bodyReviewHash(references.participantPin ?? null)) this.changed();
    const beats = await db.storyAiGeneratedBeat.findMany({ where: { sceneId: scene.id }, orderBy: [{ position: 'asc' }, { id: 'asc' }], take: 41 });
    const choices = await db.storyAiGeneratedChoice.findMany({ where: { sceneId: scene.id, position: { gt: 0 } },
      orderBy: [{ position: 'asc' }, { id: 'asc' }], take: 4 });
    if (!beats.length || beats.length > 40 || choices.length > 3 ||
        beats.some((beat, index) => beat.position !== index + 1 || !beat.beatType) ||
        choices.some((choice, index) => choice.position !== index + 1 || !choice.choiceKey.trim()) ||
        new Set(choices.map(choice => choice.choiceKey.trim())).size !== choices.length) this.changed();
    const texts = [scene.title, ...beats.map(beat => beat.content), ...choices.map(choice => choice.label)];
    if (texts.some(value => typeof record(value)[locale] !== 'string' || !(record(value)[locale] as string).trim()) ||
        Buffer.byteLength(JSON.stringify(texts), 'utf8') > 256 * 1024) this.changed();
    let endingKey: string | null = null;
    if (scene.endingType) {
      if (scene.endingType !== 'ai_generated' || progress.status !== 'completed' || choices.length) this.changed();
      const discoveries = await db.storyEndingDiscovery.findMany({ where: { userId, workId, releaseId: release.id,
        pathSignature: bodyReviewHash(progress.pathSummary), endingKind: 'ai_generated', provenance: 'ai_generated' }, take: 2 });
      if (discoveries.length !== 1 || !discoveries[0].endingKey) this.changed();
      endingKey = discoveries[0].endingKey;
    } else if (progress.status === 'completed' || !choices.length) this.changed();
    const checksum = storyAiResultChecksum({ title: scene.title, beats, visualManifest: scene.visualManifest,
      nextChoices: choices, ending: endingKey ? { endingKey } : null });
    if (checksum !== scene.resultChecksum) this.changed();
    // Only hashes and immutable pins are persisted. Neither manuscript nor generated text enters this ledger.
    const binding = { version: AUTHOR_BODY_REVIEW_CONTRACT, ownerUserId: userId, workId,
      releaseId: release.id, releaseChecksum: release.checksum, releaseVersion: release.version, releaseRevision: work.releaseRevision,
      manuscriptVersionId: manuscript.id, manuscriptHash: manuscript.contentHash, progressId: progress.id,
      progressRevision: progress.progressRevision, progressStatus: progress.status, sceneId: scene.id,
      continuationId: origin.id, bodyChecksum: checksum, materializedHash: bodyReviewHash({ title: scene.title, beats, choices }),
      routeNodeId: route.id, routeHash: route.routeHash, routeStepHash: bodyReviewHash(route.narrativeStep),
      sourceRouteNodeId: origin.sourceRouteNodeId, sourceRouteHash: origin.sourceRouteHash,
      contextFingerprint: origin.contextFingerprint, contextReferencesHash: bodyReviewHash(references),
      analysisId: analysis.id, analysisVersion: analysis.analysisVersion, profilePin: profilePin ?? null,
      participantPin: participant?.pin ?? null, styleConsentId: consent.id, styleConsentRevision: consent.revision,
      capabilityRevision: capability.revision, endingKey, locale };
    const companySource = work.authorDisplayName === '루미나'
      ? await resolveCompanyPublishedSource(db, userId, workId, manuscript, release.id) : null;
    const delegation = companySource ? { contract: COMPANY_BODY_DELEGATION_CONTRACT, ...companySource } : null;
    return { state: 'reviewable', binding, delegation, continuationId: origin.id, target: { progressId: progress.id,
      progressRevision: progress.progressRevision, sceneId: scene.id, sourceBindingHash: bodyReviewHash(binding), bodyChecksum: checksum, ending: Boolean(endingKey) } };
  }

  private async safeSnapshot(db: Prisma.TransactionClient, userId: string, workId: string, locale: string) {
    try { return await this.snapshot(db, userId, workId, locale); }
    catch (error) {
      if (error instanceof ConflictException) return { state: 'source_changed' as const, target: null };
      throw error;
    }
  }

  private project(row: BodyReviewRow, head: BodyReviewRow | null, snapshot: Snapshot) {
    const authorityCurrent = row.approvalBasis !== 'company_delegation' ||
      (snapshot.delegation && bodyReviewHash(row.delegationSnapshot) === bodyReviewHash(snapshot.delegation));
    return { id: row.id, locale: row.locale, version: row.version, decision: row.decision, approvalBasis: row.approvalBasis,
      styleReviewed: row.styleReviewed,
      charactersReviewed: row.charactersReviewed, timelineReviewed: row.timelineReviewed,
      createdAt: row.createdAt.toISOString(), withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
      applicability: row.withdrawnAt ? 'withdrawn' : row.id !== head?.id ? 'superseded' :
        authorityCurrent && row.sourceBindingHash === snapshot.target?.sourceBindingHash ? 'current' : 'stale' };
  }

  async current(user: string, work: string, locale: string) {
    const { userId, workId } = bodyReviewScope(user, work, locale);
    return this.prisma.$transaction(async db => {
      await db.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
      await this.owner(db, userId, workId);
      const snapshot = await this.safeSnapshot(db, userId, workId, locale);
      const head = await latestBodyReview(db, userId, workId);
      return { contract: AUTHOR_BODY_REVIEW_CONTRACT, ...privateBodyReviewFlags, workId, locale, readOnly: true,
        state: snapshot.state, target: snapshot.target, latestReview: head ? this.project(head, head, snapshot) : null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private async write<T>(action: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.prisma.$transaction(action, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code) && attempt < 2) continue;
        if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof NotFoundException) throw error;
        throw new ServiceUnavailableException({ code: 'STORY_AUTHOR_BODY_REVIEW_OUTCOME_UNCONFIRMED' });
      }
    }
  }

  async review(user: string, work: string, input: AuthorBodyReviewInput, key: string) {
    const body = normalizeBodyReviewInput(input);
    const { userId, workId } = bodyReviewScope(user, work, body.locale); bodyReviewKey(key);
    const requestHash = bodyReviewHash(body);
    return this.write(async db => {
      await this.owner(db, userId, workId, true);
      const previous = await bodyReviewByKey(db, userId, workId, key);
      const head = await latestBodyReview(db, userId, workId);
      if (previous) {
        if (previous.requestHash !== requestHash) throw new ConflictException({ code: 'STORY_AUTHOR_BODY_REVIEW_IDEMPOTENCY_CONFLICT' });
        const snapshot = await this.safeSnapshot(db, userId, workId, body.locale);
        return { contract: AUTHOR_BODY_REVIEW_CONTRACT, ...privateBodyReviewFlags, workId, locale: body.locale,
          idempotentReplay: true, review: this.project(previous, head, snapshot) };
      }
      if ((head?.id ?? null) !== body.expectedReviewId) throw new ConflictException({ code: 'STORY_AUTHOR_BODY_REVIEW_HEAD_CHANGED' });
      const snapshot = await this.snapshot(db, userId, workId, body.locale, true);
      if (!snapshot.target || !snapshot.binding || !snapshot.continuationId ||
          snapshot.target.sourceBindingHash !== body.sourceBindingHash ||
          snapshot.target.progressRevision !== body.expectedProgressRevision) this.changed();
      const row = await insertBodyReview(db, { id: randomUUID(), owner: userId, work: workId,
        progress: snapshot.target.progressId, scene: snapshot.target.sceneId, continuation: snapshot.continuationId,
        binding: snapshot.binding, body, version: (head?.version ?? 0) + 1, key, requestHash });
      await db.auditEvent.create({ data: { actorType: 'user', actorUserId: userId, action: 'story.author_body_review.recorded',
        targetType: 'story_author_body_review', targetId: row.id,
        metadata: { decision: body.decision, sourceBindingHash: body.sourceBindingHash, version: row.version,
          publicationStarted: false, sharedReuseAuthorized: false } } });
      return { contract: AUTHOR_BODY_REVIEW_CONTRACT, ...privateBodyReviewFlags, workId, locale: body.locale,
        idempotentReplay: false, review: this.project(row, row, snapshot) };
    });
  }

  async withdraw(user: string, work: string, reviewId: string, key: string) {
    const { userId, workId } = bodyReviewScope(user, work); bodyReviewKey(key);
    if (!isUUID(reviewId)) throw new BadRequestException({ code: 'STORY_AUTHOR_BODY_REVIEW_INPUT_INVALID' });
    reviewId = reviewId.toLowerCase();
    return this.write(async db => {
      await this.owner(db, userId, workId, true);
      const prior = await db.$queryRaw<Array<{ reviewId: string }>>(Prisma.sql`SELECT review_id AS "reviewId"
        FROM story_author_body_review_withdrawals WHERE owner_user_id = ${userId}::uuid
        AND work_id = ${workId}::uuid AND idempotency_key = ${key}`);
      if (prior[0] && prior[0].reviewId !== reviewId) throw new ConflictException({ code: 'STORY_AUTHOR_BODY_REVIEW_IDEMPOTENCY_CONFLICT' });
      const row = await bodyReviewById(db, userId, workId, reviewId);
      if (!row) throw new NotFoundException({ code: 'STORY_AUTHOR_BODY_REVIEW_UNAVAILABLE' });
      if (row.withdrawnAt && !prior[0]) throw new ConflictException({ code: 'STORY_AUTHOR_BODY_REVIEW_ALREADY_WITHDRAWN' });
      const replay = Boolean(row.withdrawnAt);
      if (!replay) {
        await db.$executeRaw(Prisma.sql`INSERT INTO story_author_body_review_withdrawals
          (review_id,owner_user_id,work_id,idempotency_key) VALUES (${reviewId}::uuid,${userId}::uuid,${workId}::uuid,${key})`);
        await db.auditEvent.create({ data: { actorType: 'user', actorUserId: userId, action: 'story.author_body_review.withdrawn',
          targetType: 'story_author_body_review', targetId: reviewId, metadata: { sourceBindingHash: row.sourceBindingHash } } });
      }
      const head = await latestBodyReview(db, userId, workId);
      const snapshot = await this.safeSnapshot(db, userId, workId, row.locale);
      const updated = await bodyReviewById(db, userId, workId, reviewId);
      return { contract: AUTHOR_BODY_REVIEW_CONTRACT, ...privateBodyReviewFlags, workId, locale: row.locale,
        idempotentReplay: replay, review: this.project(updated!, head, snapshot) };
    });
  }
}

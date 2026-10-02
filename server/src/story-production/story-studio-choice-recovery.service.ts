import { ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, StoryChoice } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { stableJson } from '../generation-profile/creator-generation-profile.policy';
import { ReapproveStudioChoicesDto, ResetStudioChoicesDto } from './dto/story-studio-linear.dto';
import { releaseChecksum } from './story-lifecycle.policy';
import { sourceOf } from './story-studio-linear.service';
import { publicationReaderText } from './story-publication-reader-projection.policy';
import { choiceDigest, sceneDigest, StoryStudioChoicePreparationService } from './story-studio-choice-preparation.service';
import { CHOICE_CONSENT_APPROVAL_TYPE, CHOICE_CONSENT_REAPPROVED, choiceConsentReceiptValid, olderConsentRevision } from './story-studio-choice-consent.policy';

type Db = PrismaService | Prisma.TransactionClient;
type Proof = { id: string; targetId: string; metadata: Prisma.JsonValue };
type SceneReview = { partKey: string; sceneId: string; choices: StoryChoice[]; originalLabel: string | null;
  stale: boolean; consentChanged: boolean; proof?: Proof; receipt?: Prisma.JsonValue };
const RESET_READY = 'STUDIO_CHOICES_REPREPARATION_READY';
const HASH = /^[a-f0-9]{64}$/;

function fail(code: string): never { throw new ConflictException({ code }); }
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function ko(value: unknown): string | null {
  const label = object(value).ko;
  return typeof label === 'string' && label.trim() ? label : null;
}

@Injectable()
export class StoryStudioChoiceRecoveryService {
  constructor(private readonly prisma: PrismaService,
    private readonly choices: StoryStudioChoicePreparationService) {}

  async review(ownerUserId: string, workId: string, releaseId: string) {
    this.ids(workId, releaseId);
    try {
      const snapshot = await this.snapshot(this.prisma, ownerUserId, workId, releaseId, false, true);
      const stale = snapshot.scenes.filter(scene => scene.stale).length;
      const consentChanged = snapshot.scenes.some(scene => scene.consentChanged);
      const resetRequired = stale ? snapshot.scenes.filter(scene => scene.stale || scene.consentChanged).length : 0;
      const inactive = ['failed', 'completed'].includes(snapshot.job.status) &&
        !snapshot.job.leaseToken && !snapshot.job.leaseExpiresAt;
      return { releaseId, status: stale ? 'settings_changed' : consentChanged ? 'consent_changed' :
        snapshot.job.status === 'failed' && snapshot.job.errorCode === RESET_READY ? 'reset_ready' : 'current',
        code: stale && !inactive ? 'STUDIO_CHOICES_RESET_JOB_ACTIVE' : null,
        canReset: stale > 0 && inactive,
        expectedManuscriptHash: snapshot.manuscript.contentHash,
        expectedApprovedFingerprint: snapshot.profile.pin.approvedFingerprint,
        expectedProfilePinHash: this.profilePinHash(snapshot.profile),
        expectedReleaseChecksum: snapshot.release.checksum,
        resetRequiredScenes: resetRequired,
        preparedScenes: snapshot.scenes.filter(scene => scene.choices.length === 3).length,
        generationStarted: false as const,
        ...(consentChanged && stale ? { resetConsentReview: { consentId: snapshot.consent.id,
          consentRevision: snapshot.consent.revision, batchHash: this.consentBatchHash(snapshot) } } : {}),
        ...(consentChanged && !stale ? { consentReview: {
          canReapprove: inactive && !stale && snapshot.scenes.every(scene => scene.choices.length === 3),
          consentId: snapshot.consent.id, consentRevision: snapshot.consent.revision,
          batchHash: this.consentBatchHash(snapshot), scenes: snapshot.scenes.map(scene => ({
            partKey: scene.partKey, sceneId: scene.sceneId, choices: scene.choices.map(choice => ({
              position: choice.position, label: ko(choice.label), routeKind: choice.routeKind })) })) } } : {}) };
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      const code = object(error.getResponse()).code as string;
      return { releaseId, status: code?.startsWith('STUDIO_CHOICES_GENERATION_PROFILE_') ? 'approval_required' : 'blocked',
        code, canReset: false, expectedManuscriptHash: null, expectedApprovedFingerprint: null, expectedProfilePinHash: null,
        expectedReleaseChecksum: null, resetRequiredScenes: 0, preparedScenes: 0, generationStarted: false as const,
        consentReview: undefined, resetConsentReview: undefined };
    }
  }

  async reapprove(ownerUserId: string, workId: string, releaseId: string, body: ReapproveStudioChoicesDto) {
    this.ids(workId, releaseId);
    if (body?.choicesReviewed !== true || body?.currentConsentConfirmed !== true ||
        !isUUID(body?.expectedConsentId) || !Number.isSafeInteger(body?.expectedConsentRevision) || body.expectedConsentRevision < 1 ||
        ![body.expectedManuscriptHash, body.expectedApprovedFingerprint, body.expectedProfilePinHash,
          body.expectedReleaseChecksum, body.expectedBatchHash].every(value => typeof value === 'string' && HASH.test(value))) {
      fail('STUDIO_CHOICES_CONSENT_REVIEW_CONFIRMATION_REQUIRED');
    }
    try {
      return await this.prisma.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${workId}::uuid FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM story_releases WHERE id = ${releaseId}::uuid FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM story_studio_choice_jobs WHERE release_id = ${releaseId}::uuid FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM story_style_profile_consents WHERE work_id = ${workId}::uuid FOR SHARE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM story_work_generation_profiles WHERE work_id = ${workId}::uuid FOR SHARE`);
        const snapshot = await this.snapshot(tx, ownerUserId, workId, releaseId, true, true);
        const { manuscript, release, job, profile, consent, scenes } = snapshot;
        const batchHash = this.consentBatchHash(snapshot);
        if (manuscript.contentHash !== body.expectedManuscriptHash || profile.pin.approvedFingerprint !== body.expectedApprovedFingerprint ||
            this.profilePinHash(profile) !== body.expectedProfilePinHash || release.checksum !== body.expectedReleaseChecksum ||
            consent.id !== body.expectedConsentId || consent.revision !== body.expectedConsentRevision || batchHash !== body.expectedBatchHash) {
          fail('STUDIO_CHOICES_CONSENT_REVIEW_SOURCE_CHANGED');
        }
        if (!['failed', 'completed'].includes(job.status) || job.leaseToken || job.leaseExpiresAt) fail('STUDIO_CHOICES_RESET_JOB_ACTIVE');
        if (scenes.some(scene => scene.stale || scene.choices.length !== 3)) fail('STUDIO_CHOICES_CONSENT_REVIEW_SETTINGS_CHANGED');
        const pending = scenes.filter(scene => scene.consentChanged);
        if (!pending.length && !scenes.some(scene => object(scene.receipt).batchHash === batchHash)) {
          fail('STUDIO_CHOICES_CONSENT_REVIEW_NOT_REQUIRED');
        }
        // Keep generation evidence immutable; the author's new approval references that exact evidence.
        for (const scene of pending) {
          const metadata = object(scene.proof!.metadata);
          await tx.auditEvent.create({ data: { actorUserId: ownerUserId, actorType: 'user',
            action: CHOICE_CONSENT_REAPPROVED, targetType: 'story_scene', targetId: scene.sceneId,
            metadata: { approvalType: CHOICE_CONSENT_APPROVAL_TYPE, sourceProofId: scene.proof!.id,
              workId, releaseId, manuscriptHash: manuscript.contentHash,
              sceneDigest: metadata.sceneDigest as string, choiceDigest: metadata.choiceDigest as string,
              generationProfilePin: profile.pin, generationProfileViewVersion: profile.viewVersion,
              analysisJobId: profile.analysisJobId, consentId: consent.id, consentRevision: consent.revision,
              choicesReviewed: true, currentConsentConfirmed: true, batchHash } } });
        }
        await this.choices.assertPublishableTx(tx, workId, ownerUserId, manuscript.id, releaseId);
        if (pending.length) {
          await tx.storyStudioChoiceJob.update({ where: { id: job.id }, data: {
            status: 'completed', completedParts: scenes.length, errorCode: null, leaseToken: null, leaseExpiresAt: null } });
          await tx.storyRelease.update({ where: { id: releaseId }, data: { validationSummary: {
            ready: true, blockingIssueCount: 0, source: 'studio-reviewed-linear-choices-v1' } } });
        }
        return { releaseId, status: 'current', reapprovedScenes: pending.length,
          generationStarted: false, idempotentReplay: pending.length === 0 };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 60000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({ code: 'STUDIO_CHOICES_CONSENT_REVIEW_UNCONFIRMED' });
    }
  }

  private consentBatchHash(snapshot: { manuscript: { contentHash: string }; release: { id: string; checksum: string };
    consent: { id: string; revision: number }; profile: { pin: unknown; viewVersion: string }; scenes: SceneReview[] }) {
    return releaseChecksum({ manuscriptHash: snapshot.manuscript.contentHash, releaseId: snapshot.release.id,
      releaseChecksum: snapshot.release.checksum, consentId: snapshot.consent.id, consentRevision: snapshot.consent.revision,
      profilePinHash: this.profilePinHash(snapshot.profile), scenes: snapshot.scenes.map(scene => ({
        partKey: scene.partKey, sceneId: scene.sceneId, proofId: scene.proof?.id ?? null,
        choiceDigest: choiceDigest(scene.choices, 'ko'), sceneDigest: object(scene.proof?.metadata).sceneDigest ?? null })) });
  }

  async reset(ownerUserId: string, workId: string, releaseId: string, body: ResetStudioChoicesDto) {
    this.ids(workId, releaseId);
    if (body?.resetConfirmed !== true || ![body.expectedManuscriptHash, body.expectedApprovedFingerprint, body.expectedProfilePinHash,
      body.expectedReleaseChecksum].every(value => typeof value === 'string' && HASH.test(value))) {
      fail('STUDIO_CHOICES_RESET_CONFIRMATION_REQUIRED');
    }
    const hasConsentBinding = (['expectedConsentId', 'expectedConsentRevision', 'expectedBatchHash', 'consentChangeConfirmed'] as const)
      .some(key => body[key] !== undefined);
    if (hasConsentBinding && (!isUUID(body.expectedConsentId) || !Number.isSafeInteger(body.expectedConsentRevision) ||
        body.expectedConsentRevision! < 1 || typeof body.expectedBatchHash !== 'string' || !HASH.test(body.expectedBatchHash) ||
        body.consentChangeConfirmed !== true)) fail('STUDIO_CHOICES_RESET_CONSENT_CONFIRMATION_REQUIRED');
    try {
      return await this.prisma.$transaction(async tx => {
        // Lock the job before any derived choices are removed; queued/in-flight jobs cannot be reset.
        await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${workId}::uuid FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM story_releases WHERE id = ${releaseId}::uuid FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM story_studio_choice_jobs WHERE release_id = ${releaseId}::uuid FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM story_style_profile_consents WHERE work_id = ${workId}::uuid FOR SHARE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM story_work_generation_profiles WHERE work_id = ${workId}::uuid FOR SHARE`);
        const snapshot = await this.snapshot(tx, ownerUserId, workId, releaseId, true, true);
        const { job, profile, manuscript, release, consent } = snapshot;
        const batchHash = this.consentBatchHash(snapshot);
        if (manuscript.contentHash !== body.expectedManuscriptHash ||
            profile.pin.approvedFingerprint !== body.expectedApprovedFingerprint ||
            this.profilePinHash(profile) !== body.expectedProfilePinHash ||
            release.checksum !== body.expectedReleaseChecksum) fail('STUDIO_CHOICES_RESET_SOURCE_CHANGED');
        if (!['failed', 'completed'].includes(job.status) || job.leaseToken || job.leaseExpiresAt) {
          fail('STUDIO_CHOICES_RESET_JOB_ACTIVE');
        }
        const settingsChanged = snapshot.scenes.some(scene => scene.stale);
        const consentChanged = snapshot.scenes.some(scene => scene.consentChanged);
        if (consentChanged && !settingsChanged) fail('STUDIO_CHOICES_RESET_CONSENT_REAPPROVAL_REQUIRED');
        if (consentChanged && !hasConsentBinding) fail('STUDIO_CHOICES_RESET_CONSENT_CONFIRMATION_REQUIRED');
        if (hasConsentBinding && (body.expectedConsentId !== consent.id || body.expectedConsentRevision !== consent.revision)) {
          fail('STUDIO_CHOICES_RESET_SOURCE_CHANGED');
        }
        const stale = settingsChanged ? snapshot.scenes.filter(scene => scene.stale || scene.consentChanged) : [];
        if (!stale.length) {
          const previous = await tx.auditEvent.findFirst({ where: { actorUserId: ownerUserId,
            action: 'story_studio_choices.reset_reviewed', targetType: 'story_release', targetId: releaseId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { metadata: true } });
          const metadata = object(previous?.metadata);
          if (job.status === 'failed' && job.errorCode === RESET_READY &&
              stableJson(metadata.generationProfilePin) === stableJson(profile.pin) &&
              metadata.generationProfileViewVersion === profile.viewVersion &&
              metadata.manuscriptHash === manuscript.contentHash && metadata.releaseChecksum === release.checksum &&
              metadata.consentId === consent.id && metadata.consentRevision === consent.revision &&
              (metadata.consentChangeConfirmed === true ? hasConsentBinding && metadata.reviewedBatchHash === body.expectedBatchHash
                : !hasConsentBinding)) {
            return this.resetResult(releaseId, 0, true);
          }
          fail('STUDIO_CHOICES_RESET_NOT_REQUIRED');
        }
        if (hasConsentBinding && (!consentChanged || body.expectedBatchHash !== batchHash)) {
          fail('STUDIO_CHOICES_RESET_SOURCE_CHANGED');
        }
        for (const scene of stale) {
          const original = scene.choices[0];
          const alternatives = scene.choices.slice(1);
          await tx.auditEvent.create({ data: { actorUserId: ownerUserId, actorType: 'user',
            action: 'story_studio_choices.reset_archive', targetType: 'story_scene', targetId: scene.sceneId,
            beforeData: scene.choices.map(choice => ({ id: choice.id, sceneId: choice.sceneId, choiceKey: choice.choiceKey,
              position: choice.position, label: choice.label, routeKind: choice.routeKind,
              targetSceneId: choice.targetSceneId, targetEndingKey: choice.targetEndingKey,
              declaredRejoinSceneId: choice.declaredRejoinSceneId, createdAt: choice.createdAt.toISOString() })),
            metadata: { workId, releaseId, manuscriptHash: manuscript.contentHash,
              releaseChecksum: release.checksum, previousProofId: scene.proof!.id,
              previousGenerationProfilePin: object(scene.proof!.metadata).generationProfilePin ?? null,
              previousConsentId: object(scene.proof!.metadata).consentId as string,
              previousConsentRevision: object(scene.proof!.metadata).consentRevision as number,
              consentId: consent.id, consentRevision: consent.revision,
              generationProfilePin: profile.pin, generationProfileViewVersion: profile.viewVersion } } });
          const removed = await tx.storyChoice.deleteMany({ where: { sceneId: scene.sceneId,
            id: { in: alternatives.map(choice => choice.id) }, routeKind: 'generation_required', position: { in: [2, 3] } } });
          if (removed.count !== 2) fail('STUDIO_CHOICES_RESET_GRAPH_CHANGED');
          if (scene.originalLabel === null) {
            await tx.storyChoice.update({ where: { id: original.id }, data: { label: { ko: null } } });
          }
          await this.choices.assertOriginalSceneReadyTx(tx, ownerUserId, workId, releaseId, scene.sceneId);
        }
        await tx.storyRelease.update({ where: { id: releaseId }, data: {
          validationSummary: { ready: false, blockingIssueCount: 1, reason: 'approved_settings_changed',
            source: 'studio-reviewed-linear-choices-v1' } } });
        // This paused marker is not claimable. A separate explicit retry is required to spend on generation.
        await tx.storyStudioChoiceJob.update({ where: { id: job.id }, data: { status: 'failed',
          errorCode: RESET_READY, completedParts: snapshot.scenes.filter(scene => scene.choices.length === 3 && !scene.stale && !scene.consentChanged).length,
          leaseToken: null, leaseExpiresAt: null } });
        await tx.auditEvent.create({ data: { actorUserId: ownerUserId, actorType: 'user',
          action: 'story_studio_choices.reset_reviewed', targetType: 'story_release', targetId: releaseId,
          metadata: { workId, manuscriptHash: manuscript.contentHash, releaseChecksum: release.checksum,
            generationProfilePin: profile.pin, generationProfileViewVersion: profile.viewVersion,
            consentId: consent.id, consentRevision: consent.revision, consentChangeConfirmed: consentChanged,
            reviewedBatchHash: batchHash,
            resetSceneCount: stale.length, generationStarted: false } } });
        return this.resetResult(releaseId, stale.length, false);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 60000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({ code: 'STUDIO_CHOICES_RESET_UNCONFIRMED',
        message: 'Reset was not confirmed; reload the private candidate before retrying' });
    }
  }

  private resetResult(releaseId: string, resetScenes: number, idempotentReplay: boolean) {
    return { releaseId, status: 'reset_ready', resetScenes, generationStarted: false,
      nextAction: 'explicit_retry_required', idempotentReplay };
  }

  private profilePinHash(profile: { pin: unknown; viewVersion: string }) {
    return releaseChecksum({ pin: profile.pin, viewVersion: profile.viewVersion });
  }

  private ids(workId: string, releaseId: string) {
    if (![workId, releaseId].every(id => isUUID(id))) fail('STUDIO_CHOICES_INVALID_ID');
  }

  private async snapshot(db: Db, ownerUserId: string, workId: string, releaseId: string, lockScenes = false, allowConsentReview = false) {
    const work = await db.storyWork.findFirst({ where: { id: workId, ownerUserId } });
    if (!work) throw new NotFoundException('Story work not found');
    if (work.status !== 'draft' || work.activeReleaseId || work.publishedAt || work.fixtureSource ||
        await db.storyAuthoredImport.findUnique({ where: { workId } }) ||
        await db.storyPublicationTransition.findFirst({ where: { workId, toStatus: 'published' }, select: { id: true } })) {
      fail('STUDIO_CHOICES_RESET_PRIVATE_UNUSED_REQUIRED');
    }
    const release = await db.storyRelease.findFirst({ where: { id: releaseId, workId, status: 'candidate' } });
    if (!release || release.activatedAt || release.retiredAt ||
        await db.storyRelease.findFirst({ where: { workId, OR: [
          { id: { not: releaseId } }, { activatedAt: { not: null } },
          { retiredAt: { not: null } }, { status: { not: 'candidate' } },
        ] }, select: { id: true } })) fail('STUDIO_CHOICES_RESET_PRIVATE_UNUSED_REQUIRED');
    const manuscript = await db.storyManuscriptVersion.findFirst({ where: {
      id: release.manuscriptVersionId, workId, ownerUserId } });
    if (!manuscript) fail('STUDIO_CHOICES_MANUSCRIPT_REQUIRED');
    const latestManuscript = await db.storyManuscriptVersion.findFirst({ where: { workId, ownerUserId },
      orderBy: { version: 'desc' }, select: { id: true } });
    if (latestManuscript?.id !== manuscript.id) fail('STUDIO_CHOICES_RESET_SOURCE_CHANGED');
    const source = sourceOf(manuscript);
    const graph = object(release.branchGraphSnapshot);
    const graphParts = Array.isArray(graph.parts) ? graph.parts.map(object) : [];
    if (graph.contract !== 'studio-linear-v1' || graphParts.length !== source.parts.length ||
        graphParts.length < 1 || graphParts.length > 1000 ||
        releaseChecksum({ manuscriptVersionId: release.manuscriptVersionId,
          branchGraphSnapshot: release.branchGraphSnapshot, endingSetSnapshot: release.endingSetSnapshot,
          sceneAssetManifest: release.sceneAssetManifest, localizedDisplaySnapshot: release.localizedDisplaySnapshot }) !== release.checksum) {
      fail('STUDIO_CHOICES_RESET_GRAPH_CHANGED');
    }
    const job = await db.storyStudioChoiceJob.findUnique({ where: { releaseId } });
    if (!job || job.ownerUserId !== ownerUserId || job.workId !== workId ||
        job.manuscriptVersionId !== manuscript.id || job.totalParts !== source.parts.length) fail('STUDIO_CHOICES_RESET_JOB_REQUIRED');
    const review = await db.storyWriterReview.findFirst({ where: { workId, ownerUserId,
      manuscriptVersionId: manuscript.id }, orderBy: { updatedAt: 'desc' } });
    if (review?.state !== 'submitted') fail('STUDIO_CHOICES_FINAL_REVIEW_REQUIRED');
    const submission = await db.storyFinalSubmission.findUnique({ where: { reviewId: review.id } });
    if (!submission || submission.status !== 'submitted' || submission.manuscriptVersionId !== manuscript.id ||
        submission.checksum !== manuscript.contentHash) fail('STUDIO_CHOICES_FINAL_REVIEW_REQUIRED');
    const consent = await db.storyStyleProfileConsent.findUnique({ where: { workId } });
    if (!consent || consent.ownerUserId !== ownerUserId || consent.manuscriptVersionId !== manuscript.id ||
        consent.status !== 'active' || !consent.rightsConfirmed || !consent.aiBranchAllowed ||
        consent.startsAt > new Date() || (consent.expiresAt && consent.expiresAt <= new Date()) ||
        !Number.isSafeInteger(consent.revision) || consent.revision < 1 ||
        !Array.isArray(consent.allowedLocales) || !consent.allowedLocales.includes('ko')) {
      fail('STUDIO_CHOICES_AI_RIGHTS_CONSENT_REQUIRED');
    }
    const profile = await this.choices.approvedGenerationProfile(db, ownerUserId, workId, manuscript, review.analysisJobId);
    if (!profile) fail('STUDIO_CHOICES_GENERATION_PROFILE_APPROVAL_REQUIRED');
    const analysis = await db.storyAnalysisJob.findUnique({ where: { id: profile.analysisJobId } });
    if (!analysis || analysis.totalParagraphs !== source.paragraphCount ||
        analysis.completedParagraphs !== analysis.totalParagraphs || analysis.sourceLocale !== 'ko') {
      fail('STUDIO_CHOICES_FINAL_REVIEW_REQUIRED');
    }
    const issues = await db.storyContinuityIssue.findMany({ where: { workId, analysisJobId: profile.analysisJobId,
      pathScope: 'author_original', pathKey: 'author_original', status: 'open' },
      select: { severity: true }, take: 1001 });
    if (issues.length > 1000 || issues.some(issue => issue.severity === 'critical') ||
        (issues.some(issue => issue.severity === 'warning') && object(review.decisions).warningAcknowledged !== true)) {
      fail('STUDIO_CHOICES_RESET_CONTINUITY_REVIEW_REQUIRED');
    }
    const parts = await db.storyPart.findMany({ where: { workId }, orderBy: { position: 'asc' }, take: 1001 });
    if (parts.length !== source.parts.length || parts.some((part, index) =>
      part.status !== 'draft' || part.fixtureSource || part.position !== index + 1 ||
      ko(part.title) !== source.parts[index].title)) fail('STUDIO_CHOICES_RESET_GRAPH_CHANGED');
    const scenes = await db.storyScene.findMany({ where: { partId: { in: parts.map(part => part.id) } },
      orderBy: [{ partId: 'asc' }, { position: 'asc' }], take: 1001 });
    const byPart = new Map(scenes.map(scene => [scene.partId, scene]));
    if (scenes.length !== parts.length || byPart.size !== parts.length ||
        scenes.some(scene => scene.status !== 'draft' || scene.fixtureSource)) fail('STUDIO_CHOICES_RESET_GRAPH_CHANGED');
    const ordered = parts.map(part => byPart.get(part.id)!);
    const sceneIds = ordered.map(scene => scene.id);
    if (lockScenes) await db.$queryRaw(Prisma.sql`SELECT id FROM story_scenes
      WHERE id IN (${Prisma.join(sceneIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
    const used = await db.storyReaderProgress.findFirst({ where: { workId }, select: { id: true } }) ||
      await db.storyAiContinuation.findFirst({ where: { workId }, select: { id: true } }) ||
      await db.storyAiGeneratedScene.findFirst({ where: { workId }, select: { id: true } }) ||
      await db.storyAiReusableResult.findFirst({ where: { workId }, select: { id: true } }) ||
      await db.storyEndingDiscovery.findFirst({ where: { workId }, select: { id: true } }) ||
      await db.storyChoiceEvent.findFirst({ where: { sceneId: { in: sceneIds } }, select: { id: true } });
    if (used) fail('STUDIO_CHOICES_RESET_PRIVATE_UNUSED_REQUIRED');
    const choices = await db.storyChoice.findMany({ where: { sceneId: { in: sceneIds } },
      orderBy: [{ position: 'asc' }, { id: 'asc' }], take: 3001 });
    const proofs = await db.$queryRaw<Proof[]>(Prisma.sql`SELECT DISTINCT ON (target_id)
      id, target_id AS "targetId", metadata FROM audit_events
      WHERE actor_user_id = ${ownerUserId}::uuid AND action = 'story_studio_choices.prepared'
        AND target_type = 'story_scene' AND target_id IN (${Prisma.join(sceneIds.map(id => Prisma.sql`${id}::uuid`))})
      ORDER BY target_id, created_at DESC, id DESC`);
    const proofByScene = new Map(proofs.map(proof => [proof.targetId, proof]));
    const receipts = proofs.some(proof => object(proof.metadata).consentRevision !== consent.revision)
      ? await db.auditEvent.findMany({ where: { actorUserId: ownerUserId, action: CHOICE_CONSENT_REAPPROVED,
        targetType: 'story_scene', targetId: { in: sceneIds } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { targetId: true, metadata: true } }) : [];
    const receiptByScene = new Map<string, Prisma.JsonValue>();
    for (const receipt of receipts) if (receipt.targetId && !receiptByScene.has(receipt.targetId)) receiptByScene.set(receipt.targetId, receipt.metadata!);
    const byScene = new Map<string, StoryChoice[]>();
    for (const choice of choices) byScene.set(choice.sceneId, [...(byScene.get(choice.sceneId) ?? []), choice]);
    const reviewed = ordered.map((scene, index): SceneReview => {
      const plan = graphParts[index];
      const rows = byScene.get(scene.id) ?? [];
      const original = rows[0];
      const label = ko(original?.label);
      if (scene.sceneKey !== `${source.parts[index].partKey}-main` || plan.partKey !== source.parts[index].partKey ||
          plan.nextPartKey !== (source.parts[index + 1]?.partKey ?? null) ||
          !(plan.originalLabel === null || typeof plan.originalLabel === 'string') ||
          ![1, 3].includes(rows.length) || !original || original.choiceKey !== 'author-original' ||
          original.position !== 1 || original.routeKind !== 'writer_original' ||
          original.targetSceneId !== (ordered[index + 1]?.id ?? null) ||
          original.targetEndingKey !== (index === ordered.length - 1 ? 'author_main' : null) || original.declaredRejoinSceneId ||
          (typeof plan.originalLabel === 'string' && plan.originalLabel !== label) ||
          (rows.length === 1 && plan.originalLabel === null && label !== null)) fail('STUDIO_CHOICES_RESET_GRAPH_CHANGED');
      if (rows.length === 1) return { partKey: source.parts[index].partKey, sceneId: scene.id, choices: rows,
        originalLabel: plan.originalLabel as string | null, stale: false, consentChanged: false };
      const labels = rows.map(choice => ko(choice.label));
      if (labels.some(value => !value || value.length > 120) || new Set(labels).size !== 3 ||
          rows.slice(1).some((choice, offset) => choice.position !== offset + 2 ||
            choice.choiceKey !== (offset === 0 ? 'branch-b' : 'branch-c') ||
            choice.routeKind !== 'generation_required' || choice.targetSceneId || choice.targetEndingKey || choice.declaredRejoinSceneId)) {
        fail('STUDIO_CHOICES_RESET_GRAPH_CHANGED');
      }
      const proof = proofByScene.get(scene.id);
      const metadata = object(proof?.metadata);
      const receipt = receiptByScene.get(scene.id);
      const consentChanged = metadata.consentRevision !== consent.revision && !choiceConsentReceiptValid(proof, receipt, consent);
      if (!proof || metadata.workId !== workId || metadata.releaseId !== releaseId ||
          metadata.manuscriptHash !== manuscript.contentHash || metadata.choiceDigest !== choiceDigest(rows, 'ko') ||
          metadata.consentId !== consent.id || (consentChanged &&
            (!allowConsentReview || !olderConsentRevision(metadata.consentRevision, consent.revision)))) fail('STUDIO_CHOICES_RESET_PROOF_REQUIRED');
      return { partKey: source.parts[index].partKey, sceneId: scene.id, choices: rows,
        originalLabel: plan.originalLabel as string | null, proof, receipt, consentChanged,
        stale: metadata.generationProfileViewVersion !== profile.viewVersion ||
          stableJson(metadata.generationProfilePin) !== stableJson(profile.pin) || metadata.analysisJobId !== profile.analysisJobId };
    });
    // Use the same reader text convention as materialization; no manuscript content is changed here.
    const beats = await db.storyBeat.findMany({ where: { sceneId: { in: sceneIds } },
      orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { sceneId: true, content: true } });
    const textByScene = new Map<string, string>();
    for (const beat of beats) textByScene.set(beat.sceneId, (textByScene.get(beat.sceneId) ?? '') + (ko(beat.content) ?? ''));
    for (const [index, scene] of reviewed.entries()) {
      const part = source.parts[index];
      const expectedDigest = sceneDigest(publicationReaderText(manuscript.structuredBody, part, manuscript.contentHash));
      if (sceneDigest(textByScene.get(scene.sceneId) ?? '') !== expectedDigest ||
          (scene.proof && object(scene.proof.metadata).sceneDigest !== expectedDigest)) {
        fail('STUDIO_CHOICES_RESET_PROOF_REQUIRED');
      }
    }
    return { manuscript, release, job, profile, consent, scenes: reviewed };
  }
}

import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, StoryBranchVisualReviewBatch } from '@prisma/client';
import { createHash } from 'crypto';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { StoryReusableResultApprovalGate } from './story-reusable-result-approval.gate';
import { currentApprovedStoryVisual } from './story-approved-visual-context.policy';
import { studioSceneVisualPrompt } from './story-approved-visual.policy';
import { verifiedStoredBranchVisualNarrative } from './story-branch-visual-narrative.policy';
import { storyAiResultChecksum } from './story-ai-result-checksum';
import { parseContinuationGenerationProfilePin, stableContinuationJson } from './story-continuation-context.policy';
import { releaseChecksum } from './story-lifecycle.policy';
import { StoryArtistParticipantService } from './story-artist-participant.service';
import type { StoryContinuationProviderResult } from './story-continuation.provider';

type Db = PrismaService | Prisma.TransactionClient;
type Expected = { expectedSourceChecksum: string; expectedProfilePinHash: string };
type Save = Expected & { idempotencyKey: string; promptText: string };
type Approve = Expected & { expectedBatchChecksum: string; expectedRevision: number; sceneReviewed: boolean };
const HASH = /^[a-f0-9]{64}$/;

// Only already-authorized shared results are reviewable; private reader context is never projected.
@Injectable()
export class StoryBranchVisualReviewService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService,
    private readonly reuse: StoryReusableResultApprovalGate, private readonly participants: StoryArtistParticipantService) {}

  enabled() { return this.config.get<string>('STORY_BRANCH_VISUAL_REVIEW_ENABLED') === 'true'; }

  private available() {
    if (!this.enabled()) throw new ServiceUnavailableException({ code: 'STORY_BRANCH_VISUAL_REVIEW_DISABLED' });
  }

  private ids(...ids: string[]) {
    if (!ids.every(id => isUUID(id))) throw new BadRequestException({ code: 'STORY_BRANCH_VISUAL_REVIEW_ID_INVALID' });
  }

  private changed(code = 'STORY_BRANCH_VISUAL_REVIEW_SOURCE_CHANGED'): never {
    throw new ConflictException({ code });
  }

  private record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private eligibilityFailure(error: unknown) {
    const code = error instanceof HttpException ? this.record(error.getResponse()).code : null;
    return typeof code === 'string' && [
      'STORY_BRANCH_VISUAL_REVIEW_WORK_UNAVAILABLE', 'STORY_BRANCH_VISUAL_REVIEW_RESULT_UNAVAILABLE',
      'STORY_BRANCH_VISUAL_REVIEW_SOURCE_CHANGED', 'STORY_BRANCH_VISUAL_REVIEW_PROFILE_REQUIRED',
      'STORY_BRANCH_VISUAL_REVIEW_PROFILE_CHANGED', 'STORY_BRANCH_VISUAL_REVIEW_PARTICIPANT_CHANGED',
      'STORY_BRANCH_VISUAL_REVIEW_BATCH_CHANGED', 'STORY_VISUAL_PROFILE_CHANGED',
      'STORY_VISUAL_BRANCH_SOURCE_CHANGED', 'STORY_PARTICIPANT_IDENTITY_CHANGED',
    ].includes(code);
  }

  private prompt(text: string) {
    if (typeof text !== 'string' || !text.trim() || text.length > 32000 || text.includes('\0') ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) {
      throw new BadRequestException({ code: 'STORY_BRANCH_VISUAL_REVIEW_PROMPT_INVALID' });
    }
    return { promptText: text, promptSha256: createHash('sha256').update(text, 'utf8').digest('hex') };
  }

  private async current(db: Db, ownerUserId: string, workId: string, sharedResultId: string, expected?: Expected) {
    this.ids(ownerUserId, workId, sharedResultId);
    if (expected && ![expected.expectedSourceChecksum, expected.expectedProfilePinHash].every(hash => typeof hash === 'string' && HASH.test(hash))) {
      throw new BadRequestException({ code: 'STORY_BRANCH_VISUAL_REVIEW_ID_INVALID' });
    }
    const work = await db.storyWork.findFirst({ where: { id: workId, ownerUserId, status: 'published', fixtureSource: false },
      select: { id: true, ownerUserId: true, activeReleaseId: true } });
    if (!work || !work.activeReleaseId) throw new NotFoundException({ code: 'STORY_BRANCH_VISUAL_REVIEW_WORK_UNAVAILABLE' });
    // PostgreSQL UUIDs are canonical; caller letter casing must not change approval identity.
    workId = work.id; ownerUserId = work.ownerUserId;
    const result = await db.storyAiReusableResult.findFirst({ where: { id: sharedResultId, workId,
      releaseId: work.activeReleaseId, status: 'approved' } });
    // Do not reveal whether another reader has an unapproved/private result.
    if (!result?.originGeneratedSceneId || !result.manuscriptVersionId || !result.resultChecksum) {
      throw new NotFoundException({ code: 'STORY_BRANCH_VISUAL_REVIEW_RESULT_UNAVAILABLE' });
    }
    sharedResultId = result.id;
    const release = await db.storyRelease.findFirst({ where: { id: result.releaseId, workId, status: 'active',
      checksum: result.releaseChecksum, manuscriptVersionId: result.manuscriptVersionId } });
    const activation = await db.storyAiLegalActivation.findUnique({ where: { id: result.rightsActivationKey },
      select: { rightsContractVersionId: true } });
    if (!release || !activation || !await this.reuse.authorizeResult({ workId, releaseId: release.id,
      releaseChecksum: release.checksum, manuscriptVersionId: release.manuscriptVersionId,
      rightsContractVersionId: activation.rightsContractVersionId, resultId: result.id,
      resultChecksum: result.resultChecksum, locale: result.locale }, db)) this.changed();
    const approved = await currentApprovedStoryVisual(db, work, result.manuscriptVersionId);
    if (!approved) this.changed('STORY_BRANCH_VISUAL_REVIEW_PROFILE_REQUIRED');
    const profilePinHash = releaseChecksum(approved.approvalIdentity);
    const manuscript = await db.storyManuscriptVersion.findUniqueOrThrow({ where: { id: result.manuscriptVersionId } });
    const scene = await db.storyAiGeneratedScene.findFirst({ where: { id: result.originGeneratedSceneId, workId,
      releaseId: release.id, sharedResultId: result.id, status: 'ready', resultChecksum: result.resultChecksum } });
    const continuation = scene ? await db.storyAiContinuation.findFirst({ where: { id: scene.continuationId,
      workId, releaseId: release.id, releaseChecksum: release.checksum, status: 'completed', requestKind: 'recommended_choice',
      userId: scene.userId, progressId: scene.progressId, sourcePartId: scene.sourcePartId, resultGeneratedSceneId: scene.id,
      sharedResultId: result.id, manuscriptVersionId: manuscript.id } }) : null;
    if (!scene || !continuation || scene.sceneKey !== `ai-${continuation.id}` || continuation.locale !== result.locale) this.changed();
    const references = this.record(continuation.contextReferences);
    let pin: ReturnType<typeof parseContinuationGenerationProfilePin>;
    let currentPin: ReturnType<typeof parseContinuationGenerationProfilePin>;
    try {
      pin = parseContinuationGenerationProfilePin(references.generationProfilePin as Prisma.JsonValue);
      currentPin = parseContinuationGenerationProfilePin(approved.approvalIdentity as Prisma.JsonValue);
    } catch { this.changed('STORY_BRANCH_VISUAL_REVIEW_PROFILE_CHANGED'); }
    if (!pin || !currentPin || stableContinuationJson(pin) !== stableContinuationJson(currentPin)) {
      this.changed('STORY_BRANCH_VISUAL_REVIEW_PROFILE_CHANGED');
    }
    if (references.participantPin !== undefined && references.participantPin !== null) {
      const participant = await this.participants.pinnedContext(db, continuation.progressId);
      if (!participant || stableContinuationJson(participant.pin) !== stableContinuationJson(references.participantPin)) {
        this.changed('STORY_BRANCH_VISUAL_REVIEW_PARTICIPANT_CHANGED');
      }
    }
    const beats = await db.storyAiReusableBeat.findMany({ where: { sharedResultId }, orderBy: { position: 'asc' }, take: 41 });
    const choices = await db.storyAiReusableChoice.findMany({ where: { sharedResultId }, orderBy: { position: 'asc' }, take: 4 });
    const originalBeats = await db.storyAiGeneratedBeat.findMany({ where: { sceneId: scene.id }, orderBy: { position: 'asc' }, take: 41 });
    const originalChoices = await db.storyAiGeneratedChoice.findMany({ where: { sceneId: scene.id }, orderBy: { position: 'asc' }, take: 4 });
    const narrative = verifiedStoredBranchVisualNarrative(result.locale, result.title, beats, {
      title: scene.title as Record<string, string>, beats: originalBeats.map(beat => ({
        beatType: beat.beatType as StoryContinuationProviderResult['beats'][number]['beatType'], content: beat.content as Record<string, string>,
      })),
    });
    if (originalBeats.some((beat, index) => beat.position !== index + 1) ||
      choices.length > 3 || choices.some((choice, index) => choice.position !== index + 1) ||
      originalChoices.some((choice, index) => choice.position !== index + 1) ||
      stableContinuationJson(choices.map(({ choiceKey, label }) => ({ choiceKey, label }))) !==
      stableContinuationJson(originalChoices.map(({ choiceKey, label }) => ({ choiceKey, label }))) ||
      stableContinuationJson(result.visualManifest) !== stableContinuationJson(scene.visualManifest) ||
      ((choices.length > 0) === Boolean(result.endingKey)) ||
      storyAiResultChecksum({ title: result.title, beats, visualManifest: result.visualManifest,
        nextChoices: choices, ending: result.endingKey ? { endingKey: result.endingKey } : null }) !== result.resultChecksum) this.changed();
    const sourceChecksum = releaseChecksum({ contract: 'story-shared-branch-visual-source-v1', sharedResultId,
      resultChecksum: result.resultChecksum, releaseId: release.id, releaseChecksum: release.checksum,
      manuscriptVersionId: manuscript.id, manuscriptHash: manuscript.contentHash, originSceneId: scene.id,
      continuationId: continuation.id, contextFingerprint: result.contextFingerprint,
      semanticPathFingerprint: result.semanticPathFingerprint, profilePinHash, participantPin: references.participantPin ?? null,
      locale: result.locale, title: result.title, beats: beats.map(({ position, beatType, content }) => ({ position, beatType, content })),
      choices: choices.map(({ position, choiceKey, label }) => ({ position, choiceKey, label })),
      visualManifest: result.visualManifest, endingKey: result.endingKey });
    if (expected && (expected.expectedSourceChecksum !== sourceChecksum || expected.expectedProfilePinHash !== profilePinHash)) this.changed();
    return { identity: { ownerUserId, workId, sharedResultId, releaseId: release.id, releaseChecksum: release.checksum,
      manuscriptVersionId: manuscript.id, manuscriptHash: manuscript.contentHash, sourceChecksum, profilePinHash },
      title: narrative.title, prose: narrative.prose, locale: result.locale,
      proposedPrompt: studioSceneVisualPrompt(narrative.title, narrative.prose), participantPin: references.participantPin ?? null,
      generationProfilePin: pin, resultChecksum: result.resultChecksum, endingKey: result.endingKey,
      projectionOrigin: { sceneKey: scene.sceneKey, visualManifest: scene.visualManifest },
      narrative: { title: result.title as Record<string, string>, beats: beats.map(beat => ({
        beatType: beat.beatType as StoryContinuationProviderResult['beats'][number]['beatType'], content: beat.content as Record<string, string>,
      })) } };
  }

  private latest(db: Db, workId: string, sharedResultId: string) {
    return db.storyBranchVisualReviewBatch.findFirst({ where: { workId, sharedResultId }, orderBy: { batchVersion: 'desc' } });
  }

  private checksum(identity: Awaited<ReturnType<StoryBranchVisualReviewService['current']>>['identity'], prompt: { promptText: string; promptSha256: string }) {
    return releaseChecksum({ contract: 'story-branch-visual-review-batch-v1', ...identity, ...prompt });
  }

  private verified(context: Awaited<ReturnType<StoryBranchVisualReviewService['current']>>, batch: StoryBranchVisualReviewBatch) {
    if (Object.entries(context.identity).some(([key, value]) => batch[key as keyof StoryBranchVisualReviewBatch] !== value) ||
      batch.batchVersion < 1 || batch.batchChecksum !== this.checksum(context.identity, this.prompt(batch.promptText)) ||
      batch.promptSha256 !== this.prompt(batch.promptText).promptSha256 ||
      (batch.status === 'draft' ? batch.revision !== 1 || batch.approvedByUserId !== null || batch.approvedAt !== null
        : batch.status !== 'approved' || batch.revision !== 2 || batch.approvedByUserId !== context.identity.ownerUserId || !batch.approvedAt)) {
      this.changed('STORY_BRANCH_VISUAL_REVIEW_BATCH_CHANGED');
    }
  }

  private project(batch: StoryBranchVisualReviewBatch) {
    return { contract: 'story-branch-visual-review-batch-v1', batchId: batch.id, sharedResultId: batch.sharedResultId,
      workId: batch.workId, sourceChecksum: batch.sourceChecksum, profilePinHash: batch.profilePinHash,
      batchChecksum: batch.batchChecksum, batchVersion: batch.batchVersion, revision: batch.revision, status: batch.status,
      promptText: batch.promptText, promptSha256: batch.promptSha256, approvedAt: batch.approvedAt?.toISOString() ?? null,
      generationStarted: false, published: false };
  }

  async review(ownerUserId: string, workId: string, sharedResultId: string) {
    this.available();
    return this.prisma.$transaction(async db => {
      const context = await this.current(db, ownerUserId, workId, sharedResultId);
      const batch = await this.latest(db, workId, sharedResultId);
      const current = batch && batch.sourceChecksum === context.identity.sourceChecksum && batch.profilePinHash === context.identity.profilePinHash ? batch : null;
      if (current) this.verified(context, current);
      return { contract: 'story-shared-branch-visual-review-v1', workId: context.identity.workId,
        sharedResultId: context.identity.sharedResultId, locale: context.locale,
        sourceChecksum: context.identity.sourceChecksum, profilePinHash: context.identity.profilePinHash,
        title: context.title, prose: context.prose, proposedPrompt: context.proposedPrompt,
        proposalApproved: false, currentBatch: current ? this.project(current) : null, generationStarted: false, published: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
  }

  async list(ownerUserId: string, workId: string, query: { limit?: number; cursor?: string }) {
    this.available(); this.ids(ownerUserId, workId, ...(query.cursor ? [query.cursor] : []));
    const limit = query.limit ?? 8;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 8) throw new BadRequestException({ code: 'STORY_BRANCH_VISUAL_REVIEW_PAGE_INVALID' });
    return this.prisma.$transaction(async db => {
      const work = await db.storyWork.findFirst({ where: { id: workId, ownerUserId, status: 'published', fixtureSource: false } });
      if (!work?.activeReleaseId) throw new NotFoundException('Story work not found');
      const release = await db.storyRelease.findFirst({ where: { id: work.activeReleaseId, workId, status: 'active' } });
      if (!release) throw new NotFoundException('Story release not found');
      const candidates = await db.storyAiReusableResult.findMany({ where: { workId, releaseId: release.id, status: 'approved',
        ...(query.cursor ? { id: { gt: query.cursor } } : {}) }, orderBy: { id: 'asc' }, take: limit + 1, select: { id: true } });
      const page = candidates.slice(0, limit);
      const items: Array<{ sharedResultId: string; title: string; locale: string; sourceChecksum: string; profilePinHash: string;
        status: 'unreviewed' | 'draft' | 'approved' }> = [];
      for (const candidate of page) {
        try {
          const context = await this.current(db, ownerUserId, workId, candidate.id);
          const batch = await this.latest(db, workId, candidate.id);
          const current = batch && batch.sourceChecksum === context.identity.sourceChecksum && batch.profilePinHash === context.identity.profilePinHash ? batch : null;
          if (current) this.verified(context, current);
          items.push({ sharedResultId: candidate.id, title: context.title, locale: context.locale,
            sourceChecksum: context.identity.sourceChecksum, profilePinHash: context.identity.profilePinHash, status: current?.status as 'draft' | 'approved' ?? 'unreviewed' });
        } catch (error) {
          if (!this.eligibilityFailure(error)) throw error;
        }
      }
      return { contract: 'story-shared-branch-visual-list-v1', workId: work.id, releaseId: release.id, releaseChecksum: release.checksum,
        items, nextCursor: candidates.length > limit ? page.at(-1)!.id : null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
  }

  private async mutation<T>(ownerUserId: string, workId: string, action: (db: Prisma.TransactionClient) => Promise<T>) {
    this.available(); this.ids(ownerUserId, workId);
    try {
      return await this.prisma.$transaction(async db => {
        const owned = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM story_works WHERE id=${workId}::uuid AND owner_user_id=${ownerUserId}::uuid FOR UPDATE`);
        if (!owned.length) throw new NotFoundException('Story work not found');
        await db.$queryRaw(Prisma.sql`SELECT id FROM story_style_profile_consents WHERE work_id=${workId}::uuid FOR SHARE`);
        return action(db);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 30000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({ code: 'STORY_BRANCH_VISUAL_REVIEW_SAVE_UNCONFIRMED' });
    }
  }

  async save(ownerUserId: string, workId: string, sharedResultId: string, input: Save) {
    this.ids(sharedResultId, input.idempotencyKey);
    const prompt = this.prompt(input.promptText);
    return this.mutation(ownerUserId, workId, async db => {
      const context = await this.current(db, ownerUserId, workId, sharedResultId, input);
      const batchChecksum = this.checksum(context.identity, prompt);
      const existing = await db.storyBranchVisualReviewBatch.findFirst({ where: { ownerUserId, workId, idempotencyKey: input.idempotencyKey } });
      if (existing) {
        this.verified(context, existing);
        if (existing.batchChecksum !== batchChecksum) this.changed('STORY_BRANCH_VISUAL_REVIEW_IDEMPOTENCY_CONFLICT');
        return this.project(existing);
      }
      const previous = await this.latest(db, workId, sharedResultId);
      const batch = await db.storyBranchVisualReviewBatch.create({ data: { ...context.identity, ...prompt, batchChecksum,
        idempotencyKey: input.idempotencyKey, batchVersion: (previous?.batchVersion ?? 0) + 1 } });
      await db.auditEvent.create({ data: { actorUserId: ownerUserId, actorType: 'user', action: 'story_branch_visual_review.draft_saved',
        targetType: 'story_branch_visual_review_batch', targetId: batch.id,
        metadata: { workId, sharedResultId, sourceChecksum: batch.sourceChecksum, batchChecksum, generationStarted: false, published: false } } });
      return this.project(batch);
    });
  }

  async approve(ownerUserId: string, workId: string, sharedResultId: string, batchId: string, input: Approve) {
    this.ids(sharedResultId, batchId);
    if (input.sceneReviewed !== true || !HASH.test(input.expectedBatchChecksum) || ![1, 2].includes(input.expectedRevision)) {
      throw new BadRequestException({ code: 'STORY_BRANCH_VISUAL_REVIEW_EXPLICIT_APPROVAL_REQUIRED' });
    }
    return this.mutation(ownerUserId, workId, async db => {
      const context = await this.current(db, ownerUserId, workId, sharedResultId, input);
      const batch = await db.storyBranchVisualReviewBatch.findFirst({ where: { id: batchId, ownerUserId, workId, sharedResultId } });
      if (!batch) throw new NotFoundException('Branch visual review batch not found');
      this.verified(context, batch);
      if ((await this.latest(db, workId, sharedResultId))?.id !== batch.id) this.changed('STORY_BRANCH_VISUAL_REVIEW_BATCH_SUPERSEDED');
      if (batch.batchChecksum !== input.expectedBatchChecksum || (batch.status === 'draft' && batch.revision !== input.expectedRevision)) {
        this.changed('STORY_BRANCH_VISUAL_REVIEW_BATCH_CHANGED');
      }
      if (batch.status === 'approved') return this.project(batch);
      const changed = await db.storyBranchVisualReviewBatch.updateMany({ where: { id: batch.id, status: 'draft', revision: 1 },
        data: { status: 'approved', revision: 2, approvedByUserId: ownerUserId, approvedAt: new Date(), updatedAt: new Date() } });
      if (changed.count !== 1) this.changed('STORY_BRANCH_VISUAL_REVIEW_BATCH_CHANGED');
      await db.auditEvent.create({ data: { actorUserId: ownerUserId, actorType: 'user', action: 'story_branch_visual_review.explicitly_approved',
        targetType: 'story_branch_visual_review_batch', targetId: batch.id,
        metadata: { workId, sharedResultId, sourceChecksum: batch.sourceChecksum, batchChecksum: batch.batchChecksum,
          explicitAuthorReview: true, generationStarted: false, published: false } } });
      return this.project(await db.storyBranchVisualReviewBatch.findUniqueOrThrow({ where: { id: batch.id } }));
    });
  }

  private async verifiedGeneratedSource(db: Db, workId: string, releaseId: string, checksum: string,
    sourceSceneKey: string, originalPromptSha256: string | null) {
    this.available(); this.ids(workId, releaseId);
    const scene = await db.storyAiGeneratedScene.findFirst({ where: { workId, releaseId, sceneKey: sourceSceneKey, status: 'ready' } });
    const work = await db.storyWork.findFirst({ where: { id: workId, activeReleaseId: releaseId, status: 'published', fixtureSource: false } });
    if (!scene?.sharedResultId || !work?.ownerUserId) this.changed('STORY_BRANCH_VISUAL_REVIEW_APPROVAL_REQUIRED');
    let context: Awaited<ReturnType<StoryBranchVisualReviewService['current']>>;
    try {
      context = await this.current(db, work.ownerUserId, workId, scene.sharedResultId);
    } catch (error) {
      if (error instanceof NotFoundException && this.eligibilityFailure(error)) this.changed('STORY_BRANCH_VISUAL_REVIEW_APPROVAL_REQUIRED');
      throw error;
    }
    if (context.identity.releaseChecksum !== checksum) this.changed();
    const continuation = await db.storyAiContinuation.findFirst({ where: { id: scene.continuationId, workId, releaseId,
      releaseChecksum: checksum, progressId: scene.progressId, userId: scene.userId, sourcePartId: scene.sourcePartId,
      status: 'completed', resultGeneratedSceneId: scene.id, sharedResultId: scene.sharedResultId } });
    const prompt = originalPromptSha256 === null ? null : await db.storyVisualPrompt.findUnique({
      where: { workId_releaseId_sourceSceneKey: { workId, releaseId, sourceSceneKey } } });
    if (!continuation || ![`ai-${continuation.id}`, `ai-reuse-${continuation.id}`].includes(scene.sceneKey) ||
      continuation.locale !== context.locale || continuation.manuscriptVersionId !== context.identity.manuscriptVersionId ||
      (originalPromptSha256 !== null && (!prompt || prompt.sourceKind !== 'ai_branch' || prompt.promptSha256 !== originalPromptSha256 ||
      prompt.releaseChecksum !== checksum || prompt.promptSha256 !== createHash('sha256').update(prompt.promptText, 'utf8').digest('hex') ||
      prompt.sourceBindingSha256 !== createHash('sha256').update(JSON.stringify({ generatedSceneId: scene.id,
        resultChecksum: scene.resultChecksum, promptSha256: originalPromptSha256 })).digest('hex'))) ||
      stableContinuationJson(this.record(continuation.contextReferences).participantPin ?? null) !== stableContinuationJson(context.participantPin)) this.changed();
    try {
      const pin = parseContinuationGenerationProfilePin(this.record(continuation.contextReferences).generationProfilePin as Prisma.JsonValue);
      if (stableContinuationJson(pin) !== stableContinuationJson(context.generationProfilePin)) this.changed();
    } catch { this.changed('STORY_BRANCH_VISUAL_REVIEW_PROFILE_CHANGED'); }
    const beats = await db.storyAiGeneratedBeat.findMany({ where: { sceneId: scene.id }, orderBy: { position: 'asc' }, take: 41 });
    const choices = await db.storyAiGeneratedChoice.findMany({ where: { sceneId: scene.id }, orderBy: { position: 'asc' }, take: 4 });
    if (scene.resultChecksum !== context.resultChecksum || choices.length > 3 ||
      choices.some((choice, index) => choice.position !== index + 1) ||
      storyAiResultChecksum({ title: scene.title, beats, visualManifest: scene.visualManifest, nextChoices: choices,
        ending: context.endingKey ? { endingKey: context.endingKey } : null }) !== context.resultChecksum) this.changed();
    verifiedStoredBranchVisualNarrative(context.locale, scene.title, beats, context.narrative);
    return { context, scene };
  }

  async projectionForGeneratedSource(db: Db, workId: string, releaseId: string, checksum: string, sourceSceneKey: string) {
    const { context } = await this.verifiedGeneratedSource(db, workId, releaseId, checksum, sourceSceneKey, null);
    // This is structural reader metadata, never image approval or permission to generate.
    return context.projectionOrigin;
  }

  async approvedForGeneratedSource(db: Db, workId: string, releaseId: string, checksum: string,
    sourceSceneKey: string, originalPromptSha256: string) {
    const { context } = await this.verifiedGeneratedSource(db, workId, releaseId, checksum, sourceSceneKey, originalPromptSha256);
    const batch = await this.latest(db, workId, context.identity.sharedResultId);
    if (!batch || batch.status !== 'approved') this.changed('STORY_BRANCH_VISUAL_REVIEW_APPROVAL_REQUIRED');
    this.verified(context, batch);
    return { referenceIndex: 0, sourceSceneKey, originalPromptSha256, promptText: batch.promptText,
      promptSha256: batch.promptSha256, bindingSha256: context.identity.sourceChecksum, partKey: '', partTitle: context.title,
      batchId: batch.id, batchChecksum: batch.batchChecksum, profilePinHash: batch.profilePinHash,
      manuscriptVersionId: batch.manuscriptVersionId, manuscriptHash: batch.manuscriptHash,
      sourceChecksum: batch.sourceChecksum, approvedByUserId: batch.approvedByUserId,
      approvedAt: batch.approvedAt!.toISOString(), generationStarted: false,
      partSelection: null as { id: string; selectionVersion: number; selectionChecksum: string; partKey: string; targetSceneKey: string } | null };
  }
}

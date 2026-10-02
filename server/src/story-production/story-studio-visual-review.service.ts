import { BadRequestException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, StoryPartVisualSelection, StorySceneVisualReviewBatch } from '@prisma/client';
import { createHash } from 'crypto';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { StudioVisualReferenceIdentityDto } from './dto/story-studio-linear.dto';
import { ApproveStudioVisualReviewBatchDto, SaveStudioVisualReviewBatchDto, SelectStudioPartVisualDto, StudioVisualReviewIdentityDto } from './dto/story-studio-visual-review.dto';
import { publicationVisualReferenceData, studioSceneVisualPrompt } from './story-approved-visual.policy';
import { releaseChecksum } from './story-lifecycle.policy';
import { SEMANTIC_PIPELINE } from './story-semantic-analysis.types';
import { StoryStudioChoicePreparationService } from './story-studio-choice-preparation.service';
import { linearPartPlan, sourceOf } from './story-studio-linear.service';
import { studioVisualReferenceReaderRange } from './story-studio-visual-reference.policy';
import { studioVisualReviewBatchChecksum, studioVisualReviewEntries, visualReviewConflict } from './story-studio-visual-review.policy';
import { studioManuscriptVisualReviewSource } from './story-studio-visual-source.policy';

type Db = PrismaService | Prisma.TransactionClient;
const hashPattern = /^[a-f0-9]{64}$/;

@Injectable()
export class StoryStudioVisualReviewService {
  constructor(private readonly prisma: PrismaService, private readonly choices: StoryStudioChoicePreparationService) {}

  private ids(workId: string, manuscriptVersionId: string, batchId?: string) {
    if (![workId, manuscriptVersionId, ...(batchId === undefined ? [] : [batchId])].every(id => isUUID(id))) {
      throw new BadRequestException({ code: 'STUDIO_VISUAL_REVIEW_ID_INVALID' });
    }
  }

  private expectedPin(expected: StudioVisualReviewIdentityDto) {
    if (typeof expected.expectedProfilePinHash !== 'string' || !hashPattern.test(expected.expectedProfilePinHash)) {
      throw new BadRequestException({ code: 'STUDIO_VISUAL_REVIEW_PROFILE_PIN_REQUIRED' });
    }
  }

  private async current(db: Db, ownerUserId: string, workId: string, manuscriptVersionId: string,
    expected: StudioVisualReferenceIdentityDto & { expectedProfilePinHash?: string }) {
    this.ids(workId, manuscriptVersionId);
    if (![expected.expectedManuscriptHash, expected.expectedSourceChecksum].every(hash => typeof hash === 'string' && hashPattern.test(hash)) ||
        (expected.expectedProfilePinHash !== undefined && !hashPattern.test(expected.expectedProfilePinHash))) {
      throw new BadRequestException({ code: 'STUDIO_VISUAL_REVIEW_ID_INVALID' });
    }
    const work = await db.storyWork.findFirst({ where: { id: workId, ownerUserId }, select: { id: true } });
    if (!work) throw new NotFoundException('Story work not found');
    const manuscript = await db.storyManuscriptVersion.findFirst({ where: { workId, ownerUserId }, orderBy: { version: 'desc' } });
    if (!manuscript || manuscript.id !== manuscriptVersionId || manuscript.contentHash !== expected.expectedManuscriptHash) {
      visualReviewConflict('STUDIO_VISUAL_REVIEW_SOURCE_CHANGED');
    }
    const prepared = sourceOf(manuscript);
    const visualView = studioManuscriptVisualReviewSource(manuscript.structuredBody, manuscript.contentHash, prepared);
    const reference = visualView.reference;
    if (reference.checksum !== expected.expectedSourceChecksum) visualReviewConflict('STUDIO_VISUAL_REVIEW_SOURCE_CHANGED');
    if (!reference.bindings) visualReviewConflict('STUDIO_VISUAL_REVIEW_MAPPING_REQUIRED');
    const analysis = await db.storyAnalysisJob.findFirst({ where: { workId, manuscriptVersionId,
      status: 'completed', pipeline: SEMANTIC_PIPELINE }, orderBy: { analysisVersion: 'desc' } });
    if (!analysis) visualReviewConflict('STUDIO_VISUAL_REVIEW_PROFILE_REQUIRED');
    const profile = await this.choices.approvedGenerationProfile(db, ownerUserId, workId, manuscript, analysis.id);
    if (!profile) visualReviewConflict('STUDIO_VISUAL_REVIEW_PROFILE_REQUIRED');
    const profilePin = { pin: profile.pin, viewVersion: profile.viewVersion };
    const profilePinHash = releaseChecksum(profilePin);
    if (expected.expectedProfilePinHash !== undefined && expected.expectedProfilePinHash !== profilePinHash) {
      visualReviewConflict('STUDIO_VISUAL_REVIEW_PROFILE_CHANGED');
    }
    return { manuscript, prepared, reference, reviewBody: visualView.body, guidanceOrigin: visualView.guidanceOrigin,
      profilePin, identity: { ownerUserId, workId, manuscriptVersionId,
      manuscriptHash: manuscript.contentHash, sourceChecksum: reference.checksum, analysisJobId: analysis.id, profilePinHash } };
  }

  private validateIndex(context: Awaited<ReturnType<StoryStudioVisualReviewService['current']>>, referenceIndex: number) {
    if (!Number.isSafeInteger(referenceIndex) || referenceIndex < 0 || referenceIndex >= context.reference.promptCount) {
      throw new BadRequestException({ code: 'STUDIO_VISUAL_REVIEW_REFERENCE_INVALID' });
    }
    const binding = context.reference.bindings![referenceIndex];
    if (!studioVisualReferenceReaderRange(context.reviewBody, binding).trim()) {
      visualReviewConflict('STUDIO_VISUAL_REVIEW_PROSE_REQUIRED');
    }
    return binding;
  }

  private latestForIndex(db: Db, identity: Awaited<ReturnType<StoryStudioVisualReviewService['current']>>['identity'], referenceIndex: number) {
    return db.storySceneVisualReviewBatch.findFirst({ where: { ...identity, referenceIndexes: { has: referenceIndex } },
      orderBy: { batchVersion: 'desc' } });
  }

  private verifiedBatch(context: Awaited<ReturnType<StoryStudioVisualReviewService['current']>>, batch: StorySceneVisualReviewBatch) {
    for (const [key, value] of Object.entries(context.identity)) {
      if (batch[key as keyof StorySceneVisualReviewBatch] !== value) visualReviewConflict('STUDIO_VISUAL_REVIEW_BATCH_CHANGED');
    }
    if (releaseChecksum(batch.profilePin) !== context.identity.profilePinHash || batch.batchVersion < 1 ||
        !['draft', 'approved'].includes(batch.status) ||
        (batch.status === 'draft' && (batch.revision !== 1 || batch.approvedByUserId !== null || batch.approvedAt !== null)) ||
        (batch.status === 'approved' && (batch.revision !== 2 || batch.approvedByUserId !== context.identity.ownerUserId || !batch.approvedAt))) {
      visualReviewConflict('STUDIO_VISUAL_REVIEW_BATCH_CHANGED');
    }
    const entries = studioVisualReviewEntries(context.reviewBody, context.identity.manuscriptHash,
      context.identity.sourceChecksum, batch.entries as unknown as SaveStudioVisualReviewBatchDto['entries']);
    if (releaseChecksum(batch.entries) !== releaseChecksum(entries) ||
        releaseChecksum(batch.referenceIndexes) !== releaseChecksum(entries.map(entry => entry.referenceIndex)) ||
        batch.batchChecksum !== studioVisualReviewBatchChecksum(context.identity, entries)) {
      visualReviewConflict('STUDIO_VISUAL_REVIEW_BATCH_CHANGED');
    }
    return entries;
  }

  private project(batch: StorySceneVisualReviewBatch) {
    return { contract: 'story-visual-review-batch-v1' as const, batchId: batch.id, workId: batch.workId,
      manuscriptVersionId: batch.manuscriptVersionId, manuscriptHash: batch.manuscriptHash,
      sourceChecksum: batch.sourceChecksum, analysisJobId: batch.analysisJobId, profilePinHash: batch.profilePinHash,
      batchVersion: batch.batchVersion, revision: batch.revision, status: batch.status, batchChecksum: batch.batchChecksum,
      entries: batch.entries, approvedAt: batch.approvedAt?.toISOString() ?? null, generationStarted: false, published: false };
  }

  async review(ownerUserId: string, workId: string, manuscriptVersionId: string, referenceIndex: number,
    expected: StudioVisualReferenceIdentityDto) {
    return this.prisma.$transaction(async db => {
      const context = await this.current(db, ownerUserId, workId, manuscriptVersionId, expected);
      const binding = this.validateIndex(context, referenceIndex);
      const batch = await this.latestForIndex(db, context.identity, referenceIndex);
      if (batch) this.verifiedBatch(context, batch);
      const { ownerUserId: _owner, ...identity } = context.identity;
      return { contract: 'story-visual-review-context-v1' as const, ...identity, guidanceOrigin: context.guidanceOrigin, referenceIndex,
        sourceSceneKey: binding.sourceSceneKey, originalPromptSha256: binding.promptSha256,
        batch: batch ? this.project(batch) : null,
        representative: await this.representativeContext(db, context, referenceIndex) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 30000 });
  }

  private latestSelection(db: Db, workId: string, partKey: string) {
    return db.storyPartVisualSelection.findFirst({ where: { workId, partKey }, orderBy: { selectionVersion: 'desc' } });
  }

  private selectionChecksum(selection: Pick<StoryPartVisualSelection, 'ownerUserId' | 'workId' | 'manuscriptVersionId' |
    'manuscriptHash' | 'sourceChecksum' | 'analysisJobId' | 'profilePinHash' | 'partKey' | 'targetSceneKey' |
    'selectionVersion' | 'status' | 'referenceIndex' | 'sourceSceneKey' | 'batchId' | 'batchChecksum' | 'idempotencyKey'>) {
    const { ownerUserId, workId, manuscriptVersionId, manuscriptHash, sourceChecksum, analysisJobId, profilePinHash,
      partKey, targetSceneKey, selectionVersion, status, referenceIndex, sourceSceneKey, batchId, batchChecksum, idempotencyKey } = selection;
    return releaseChecksum({ contract: 'story-part-visual-selection-v1', ownerUserId, workId, manuscriptVersionId,
      manuscriptHash, sourceChecksum, analysisJobId, profilePinHash, partKey, targetSceneKey, selectionVersion,
      status, referenceIndex, sourceSceneKey, batchId, batchChecksum, idempotencyKey });
  }

  private verifiedSelection(context: Awaited<ReturnType<StoryStudioVisualReviewService['current']>>, selection: StoryPartVisualSelection,
    partKey: string) {
    if (selection.partKey !== partKey || selection.targetSceneKey !== `${partKey}-main` ||
        !Number.isSafeInteger(selection.selectionVersion) || selection.selectionVersion < 1 ||
        !['selected', 'cleared'].includes(selection.status) || selection.selectionChecksum !== this.selectionChecksum(selection) ||
        (selection.status === 'selected' && (!Number.isSafeInteger(selection.referenceIndex) || selection.referenceIndex! < 0 ||
          !selection.batchId || !selection.batchChecksum || !selection.sourceSceneKey)) ||
        (selection.status === 'cleared' && [selection.referenceIndex, selection.sourceSceneKey, selection.batchId, selection.batchChecksum].some(value => value !== null))) {
      visualReviewConflict('STUDIO_VISUAL_REVIEW_REPRESENTATIVE_CHANGED');
    }
    return Object.entries(context.identity).every(([key, value]) => selection[key as keyof StoryPartVisualSelection] === value);
  }

  private async selectedEntry(db: Db, context: Awaited<ReturnType<StoryStudioVisualReviewService['current']>>,
    selection: StoryPartVisualSelection, partKey: string) {
    if (!this.verifiedSelection(context, selection, partKey) || selection.status !== 'selected') {
      visualReviewConflict('STUDIO_VISUAL_REVIEW_REPRESENTATIVE_REQUIRED');
    }
    const approved = await this.approvedEntry(db, context, selection.referenceIndex!);
    if (approved.partKey !== partKey || approved.sourceSceneKey !== selection.sourceSceneKey ||
        approved.batchId !== selection.batchId || approved.batchChecksum !== selection.batchChecksum) {
      visualReviewConflict('STUDIO_VISUAL_REVIEW_REPRESENTATIVE_CHANGED');
    }
    return { ...approved, partSelection: { id: selection.id, selectionVersion: selection.selectionVersion,
      selectionChecksum: selection.selectionChecksum, partKey, targetSceneKey: selection.targetSceneKey } };
  }

  private async representativeContext(db: Db, context: Awaited<ReturnType<StoryStudioVisualReviewService['current']>>, referenceIndex: number) {
    const binding = this.validateIndex(context, referenceIndex);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(binding.partKey)) return null;
    const selection = await this.latestSelection(db, context.identity.workId, binding.partKey);
    let current = false;
    if (selection) {
      current = this.verifiedSelection(context, selection, binding.partKey);
      if (current && selection.status === 'selected') {
        try { await this.selectedEntry(db, context, selection, binding.partKey); }
        catch (error) {
          if (!(error instanceof HttpException) || ![404, 409].includes(error.getStatus())) throw error;
          current = false;
        }
      }
    }
    return { contract: 'story-part-visual-selection-context-v1' as const, partKey: binding.partKey, partTitle: binding.partTitle,
      targetSceneKey: `${binding.partKey}-main`, selectionVersion: selection?.selectionVersion ?? 0,
      selection: selection ? { contract: 'story-part-visual-selection-v1' as const, id: selection.id,
        workId: selection.workId, manuscriptVersionId: selection.manuscriptVersionId, manuscriptHash: selection.manuscriptHash,
        sourceChecksum: selection.sourceChecksum, analysisJobId: selection.analysisJobId, profilePinHash: selection.profilePinHash,
        partKey: selection.partKey, targetSceneKey: selection.targetSceneKey, selectionVersion: selection.selectionVersion,
        status: selection.status, referenceIndex: selection.referenceIndex, sourceSceneKey: selection.sourceSceneKey,
        batchId: selection.batchId, batchChecksum: selection.batchChecksum, selectionChecksum: selection.selectionChecksum,
        createdAt: selection.createdAt.toISOString(), current } : null };
  }

  async selectRepresentative(ownerUserId: string, workId: string, manuscriptVersionId: string, referenceIndex: number,
    input: SelectStudioPartVisualDto) {
    this.ids(workId, manuscriptVersionId, input.idempotencyKey);
    this.expectedPin(input);
    if (!['select', 'clear'].includes(input.mode) || !Number.isSafeInteger(input.expectedSelectionVersion) ||
        input.expectedSelectionVersion < 0 || input.expectedSelectionVersion > 2147483646 ||
        (input.mode === 'select' && (!isUUID(input.batchId) || !hashPattern.test(input.expectedBatchChecksum ?? '') || input.representativeReviewed !== true)) ||
        (input.mode === 'clear' && [input.batchId, input.expectedBatchChecksum, input.representativeReviewed].some(value => value !== undefined))) {
      throw new BadRequestException({ code: 'STUDIO_VISUAL_REVIEW_REPRESENTATIVE_CONFIRMATION_REQUIRED' });
    }
    return this.mutation(ownerUserId, workId, async db => {
      const context = await this.current(db, ownerUserId, workId, manuscriptVersionId, input);
      const binding = this.validateIndex(context, referenceIndex);
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(binding.partKey)) visualReviewConflict('STUDIO_VISUAL_REVIEW_REPRESENTATIVE_REQUIRED');
      const previous = await this.latestSelection(db, workId, binding.partKey);
      const entry = input.mode === 'select' ? await this.approvedEntry(db, context, referenceIndex) : null;
      if (entry && (entry.batchId !== input.batchId || entry.batchChecksum !== input.expectedBatchChecksum)) {
        visualReviewConflict('STUDIO_VISUAL_REVIEW_REPRESENTATIVE_CHANGED');
      }
      const data = { ...context.identity, partKey: binding.partKey, targetSceneKey: `${binding.partKey}-main`,
        selectionVersion: input.expectedSelectionVersion + 1, status: input.mode === 'select' ? 'selected' : 'cleared',
        referenceIndex: entry?.referenceIndex ?? null, sourceSceneKey: entry?.sourceSceneKey ?? null,
        batchId: entry?.batchId ?? null, batchChecksum: entry?.batchChecksum ?? null, idempotencyKey: input.idempotencyKey };
      const selectionChecksum = this.selectionChecksum(data);
      const existing = await db.storyPartVisualSelection.findFirst({ where: { ownerUserId, workId, idempotencyKey: input.idempotencyKey } });
      if (existing) {
        if (!this.verifiedSelection(context, existing, binding.partKey) || existing.selectionChecksum !== selectionChecksum) {
          visualReviewConflict('STUDIO_VISUAL_REVIEW_IDEMPOTENCY_CONFLICT');
        }
        if (previous?.id !== existing.id) visualReviewConflict('STUDIO_VISUAL_REVIEW_REPRESENTATIVE_CHANGED');
        return this.representativeContext(db, context, referenceIndex);
      }
      if (input.expectedSelectionVersion !== (previous?.selectionVersion ?? 0)) {
        visualReviewConflict('STUDIO_VISUAL_REVIEW_REPRESENTATIVE_CHANGED');
      }
      const selected = await db.storyPartVisualSelection.create({ data: { ...data, selectionChecksum } });
      await db.auditEvent.create({ data: { actorUserId: ownerUserId, actorType: 'user', action: `story_part_visual.${input.mode}`,
        targetType: 'story_part_visual_selection', targetId: selected.id, metadata: { workId, manuscriptVersionId,
          partKey: binding.partKey, selectionVersion: selected.selectionVersion, selectionChecksum, generationStarted: false, published: false } } });
      return this.representativeContext(db, context, referenceIndex);
    });
  }

  private async mutation<T>(ownerUserId: string, workId: string, action: (db: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await this.prisma.$transaction(async db => {
        const owned = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM story_works WHERE id = ${workId}::uuid AND owner_user_id = ${ownerUserId}::uuid FOR UPDATE`);
        if (!owned.length) throw new NotFoundException('Story work not found');
        return action(db);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 30000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({ code: 'STUDIO_VISUAL_REVIEW_SAVE_UNCONFIRMED',
        message: 'Reopen the saved guidance before trying again' });
    }
  }

  async save(ownerUserId: string, workId: string, manuscriptVersionId: string, input: SaveStudioVisualReviewBatchDto) {
    this.ids(workId, manuscriptVersionId, input.idempotencyKey);
    this.expectedPin(input);
    return this.mutation(ownerUserId, workId, async db => {
      const context = await this.current(db, ownerUserId, workId, manuscriptVersionId, input);
      const entries = studioVisualReviewEntries(context.reviewBody, context.identity.manuscriptHash,
        context.identity.sourceChecksum, input.entries);
      const batchChecksum = studioVisualReviewBatchChecksum(context.identity, entries);
      const existing = await db.storySceneVisualReviewBatch.findFirst({ where: { ownerUserId, workId, idempotencyKey: input.idempotencyKey } });
      if (existing) {
        this.verifiedBatch(context, existing);
        if (existing.batchChecksum !== batchChecksum) visualReviewConflict('STUDIO_VISUAL_REVIEW_IDEMPOTENCY_CONFLICT');
        return this.project(existing);
      }
      const previous = await db.storySceneVisualReviewBatch.findFirst({ where: { workId }, orderBy: { batchVersion: 'desc' }, select: { batchVersion: true } });
      const batch = await db.storySceneVisualReviewBatch.create({ data: { ...context.identity,
        profilePin: context.profilePin as unknown as Prisma.InputJsonValue, referenceIndexes: entries.map(entry => entry.referenceIndex),
        entries: entries as unknown as Prisma.InputJsonValue, batchChecksum, idempotencyKey: input.idempotencyKey,
        batchVersion: (previous?.batchVersion ?? 0) + 1 } });
      await db.auditEvent.create({ data: { actorUserId: ownerUserId, actorType: 'user',
        action: 'story_scene_visual_review.draft_saved', targetType: 'story_scene_visual_review_batch', targetId: batch.id,
        metadata: { workId, manuscriptVersionId, batchChecksum, entryCount: entries.length, generationStarted: false, published: false } } });
      return this.project(batch);
    });
  }

  async approve(ownerUserId: string, workId: string, manuscriptVersionId: string, batchId: string, input: ApproveStudioVisualReviewBatchDto) {
    this.ids(workId, manuscriptVersionId, batchId);
    this.expectedPin(input);
    if (input.scenesReviewed !== true || ![1, 2].includes(input.expectedRevision) || !hashPattern.test(input.expectedBatchChecksum)) {
      throw new BadRequestException({ code: 'STUDIO_VISUAL_REVIEW_EXPLICIT_APPROVAL_REQUIRED' });
    }
    return this.mutation(ownerUserId, workId, async db => {
      const context = await this.current(db, ownerUserId, workId, manuscriptVersionId, input);
      const batch = await db.storySceneVisualReviewBatch.findFirst({ where: { id: batchId, ownerUserId, workId, manuscriptVersionId } });
      if (!batch) throw new NotFoundException('Visual review batch not found');
      const entries = this.verifiedBatch(context, batch);
      if (batch.batchChecksum !== input.expectedBatchChecksum ||
          (batch.status === 'draft' && batch.revision !== input.expectedRevision)) visualReviewConflict('STUDIO_VISUAL_REVIEW_BATCH_CHANGED');
      const later = await db.storySceneVisualReviewBatch.findFirst({ where: { ...context.identity,
        batchVersion: { gt: batch.batchVersion }, referenceIndexes: { hasSome: entries.map(entry => entry.referenceIndex) } }, select: { id: true } });
      if (later) visualReviewConflict('STUDIO_VISUAL_REVIEW_BATCH_SUPERSEDED');
      if (batch.status === 'approved') return this.project(batch);
      const changed = await db.storySceneVisualReviewBatch.updateMany({ where: { id: batch.id, status: 'draft', revision: input.expectedRevision,
        batchChecksum: input.expectedBatchChecksum }, data: { status: 'approved', revision: 2, approvedByUserId: ownerUserId,
        approvedAt: new Date(), updatedAt: new Date() } });
      if (changed.count !== 1) visualReviewConflict('STUDIO_VISUAL_REVIEW_BATCH_CHANGED');
      const approved = await db.storySceneVisualReviewBatch.findUniqueOrThrow({ where: { id: batch.id } });
      await db.auditEvent.create({ data: { actorUserId: ownerUserId, actorType: 'user',
        action: 'story_scene_visual_review.explicitly_approved', targetType: 'story_scene_visual_review_batch', targetId: batch.id,
        metadata: { workId, manuscriptVersionId, batchChecksum: batch.batchChecksum,
          profilePinHash: batch.profilePinHash, entryCount: entries.length, generationStarted: false, published: false } } });
      return this.project(approved);
    });
  }

  async approvedForReference(ownerUserId: string, workId: string, manuscriptVersionId: string, referenceIndex: number,
    expected: StudioVisualReviewIdentityDto) {
    this.expectedPin(expected);
    return this.prisma.$transaction(async db => {
      const context = await this.current(db, ownerUserId, workId, manuscriptVersionId, expected);
      return this.approvedEntry(db, context, referenceIndex);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 30000 });
  }

  private async approvedEntry(db: Db, context: Awaited<ReturnType<StoryStudioVisualReviewService['current']>>, referenceIndex: number) {
    this.validateIndex(context, referenceIndex);
    const batch = await this.latestForIndex(db, context.identity, referenceIndex);
    if (!batch || batch.status !== 'approved') visualReviewConflict('STUDIO_VISUAL_REVIEW_APPROVAL_REQUIRED');
    const entries = this.verifiedBatch(context, batch);
    const entry = entries.find(item => item.referenceIndex === referenceIndex)!;
    return { ...entry, batchId: batch.id, batchChecksum: batch.batchChecksum, profilePinHash: batch.profilePinHash,
      manuscriptVersionId: batch.manuscriptVersionId, manuscriptHash: batch.manuscriptHash,
      sourceChecksum: batch.sourceChecksum, approvedByUserId: batch.approvedByUserId,
      approvedAt: batch.approvedAt!.toISOString(), generationStarted: false,
      partSelection: null as { id: string; selectionVersion: number; selectionChecksum: string; partKey: string; targetSceneKey: string } | null };
  }

  // Use the caller's transaction so publication cannot race a newly saved guidance batch.
  async approvedForPublishedSource(db: Db, workId: string, releaseId: string, checksum: string,
    sourceSceneKey: string, originalPromptSha256: string) {
    this.ids(workId, releaseId);
    if (!hashPattern.test(checksum) || !hashPattern.test(originalPromptSha256) ||
        typeof sourceSceneKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(sourceSceneKey)) {
      throw new BadRequestException({ code: 'STUDIO_VISUAL_REVIEW_ID_INVALID' });
    }
    const work = await db.storyWork.findFirst({ where: { id: workId, status: 'published', fixtureSource: false,
      activeReleaseId: releaseId }, select: { id: true, ownerUserId: true } });
    const release = work ? await db.storyRelease.findFirst({ where: { id: releaseId, workId, status: 'active',
      checksum }, select: { manuscriptVersionId: true, branchGraphSnapshot: true } }) : null;
    if (!work?.ownerUserId || !release) visualReviewConflict('STUDIO_VISUAL_REVIEW_SOURCE_CHANGED');
    const manuscript = await db.storyManuscriptVersion.findFirst({ where: { id: release.manuscriptVersionId,
      workId, ownerUserId: work.ownerUserId } });
    if (!manuscript) visualReviewConflict('STUDIO_VISUAL_REVIEW_SOURCE_CHANGED');
    const imported = publicationVisualReferenceData(manuscript.structuredBody, manuscript.contentHash);
    const graph = release.branchGraphSnapshot as { contract?: unknown; parts?: unknown } | null;
    if (!imported && graph?.contract !== 'studio-linear-v1') {
      const canonical = await db.storyVisualPrompt.findUnique({ where: { workId_releaseId_sourceSceneKey: { workId, releaseId, sourceSceneKey } } });
      if (canonical?.sourceKind === 'studio_reviewed') visualReviewConflict('STUDIO_VISUAL_REVIEW_SOURCE_CHANGED');
      return null;
    }
    const visualView = studioManuscriptVisualReviewSource(manuscript.structuredBody, manuscript.contentHash, sourceOf(manuscript));
    const reference = visualView.reference;
    const source = (visualView.body as { publicationVisualSource: {
      prompts: Array<{ sourceSceneKey: string; promptSha256: string }> } }).publicationVisualSource;
    const referenceIndex = source.prompts.findIndex(prompt => prompt.sourceSceneKey === sourceSceneKey);
    if (sourceSceneKey.endsWith('-main')) {
      const studioTarget = graph?.contract === 'studio-linear-v1';
      const prompt = await db.storyVisualPrompt.findUnique({ where: { workId_releaseId_sourceSceneKey: { workId, releaseId, sourceSceneKey } } });
      if (studioTarget || prompt?.sourceKind === 'studio_reviewed') {
        if (!studioTarget || prompt?.sourceKind !== 'studio_reviewed' || !Array.isArray(graph?.parts)) {
          visualReviewConflict('STUDIO_VISUAL_REVIEW_SOURCE_CHANGED');
        }
        const context = await this.current(db, work.ownerUserId, workId, manuscript.id, {
          expectedManuscriptHash: manuscript.contentHash, expectedSourceChecksum: reference.checksum });
        const parts = linearPartPlan(context.prepared, context.prepared.parts.map(part => ({ partKey: part.partKey })));
        const part = parts.find(part => `${part.partKey}-main` === sourceSceneKey);
        if (!part || graph.parts.filter(row => row && typeof row === 'object' && !Array.isArray(row) &&
          (row as { partKey?: unknown }).partKey === part.partKey).length !== 1) visualReviewConflict('STUDIO_VISUAL_REVIEW_SOURCE_CHANGED');
        const planned = studioSceneVisualPrompt(part.title, part.text);
        const sha = (text: string) => createHash('sha256').update(text).digest('hex');
        if (prompt.releaseChecksum !== checksum || prompt.promptText !== planned || prompt.promptSha256 !== sha(planned) ||
            originalPromptSha256 !== prompt.promptSha256 || prompt.sourceBindingSha256 !== releaseChecksum({
              manuscriptId: manuscript.id, manuscriptHash: manuscript.contentHash, partKey: part.partKey, textSha256: sha(part.text) })) {
          visualReviewConflict('STUDIO_VISUAL_REVIEW_SOURCE_CHANGED');
        }
        const selection = await this.latestSelection(db, workId, part.partKey);
        if (!selection) visualReviewConflict('STUDIO_VISUAL_REVIEW_REPRESENTATIVE_REQUIRED');
        return this.selectedEntry(db, context, selection, part.partKey);
      }
    }
    if (referenceIndex < 0) return null;
    if (source.prompts[referenceIndex].promptSha256 !== originalPromptSha256) {
      visualReviewConflict('STUDIO_VISUAL_REVIEW_SOURCE_CHANGED');
    }
    const context = await this.current(db, work.ownerUserId, workId, manuscript.id, {
      expectedManuscriptHash: manuscript.contentHash, expectedSourceChecksum: reference.checksum });
    return this.approvedEntry(db, context, referenceIndex);
  }
}

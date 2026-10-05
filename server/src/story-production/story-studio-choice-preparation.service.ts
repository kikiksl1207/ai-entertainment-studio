import { ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { isUUID } from 'class-validator';
import { StoryChoicePreparationError, StoryChoicePreparationProvider,
  type StoryChoiceUsage } from './story-choice-preparation.provider';
import { readerPartText } from './story-studio-reader-text.policy';
import { publicationReaderText } from './story-publication-reader-projection.policy';
import { stableJson } from '../generation-profile/creator-generation-profile.policy';
import { continuationGenerationProfileSnapshot, STORY_CONTINUATION_PROFILE_VIEW_VERSION } from './story-continuation-context.policy';
import { SEMANTIC_PIPELINE } from './story-semantic-analysis.types';
import { ManuscriptPart } from './story-production.policy';
import { CHOICE_CONSENT_REAPPROVED, choiceConsentReceiptValid } from './story-studio-choice-consent.policy';
import { assertCompanyFinalSubmissionCurrent } from './story-company-final-submission.policy';

function fail(code: string): never {
  throw new ConflictException({ code, message: 'The reviewed manuscript and original route must be ready before choices are prepared' });
}

function localized(value: unknown, locale: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const text = (value as Record<string, unknown>)[locale];
  return typeof text === 'string' && text.trim() ? text : null;
}

type BoundChoice = {
  choiceKey: string; position: number; label: unknown; routeKind: string;
  targetSceneId?: string | null; targetEndingKey?: string | null; declaredRejoinSceneId?: string | null;
};

export function choiceDigest(choices: BoundChoice[], locale: string): string {
  return createHash('sha256').update(JSON.stringify(choices.map(choice => ({
    choiceKey: choice.choiceKey, position: choice.position, label: localized(choice.label, locale),
    routeKind: choice.routeKind, targetSceneId: choice.targetSceneId ?? null,
    targetEndingKey: choice.targetEndingKey ?? null,
    declaredRejoinSceneId: choice.declaredRejoinSceneId ?? null,
  })))).digest('hex');
}

export function sceneDigest(text: string): string {
  return createHash('sha256').update(text.replace(/\s+/gu, '')).digest('hex');
}

type PreparationSnapshot = {
  workTitle: string;
  partKey: string;
  partTitle: string;
  endingExcerpt: string;
  context: string;
  originalLabel: string | null;
  nextPartTitle: string | null;
  nextPartExcerpt: string | null;
  consentId: string;
  consentRevision: number;
  manuscriptHash: string;
  sceneDigest: string;
  generationProfile: (ReturnType<typeof continuationGenerationProfileSnapshot> & {
    manuscriptVersionId: string;
    analysisJobId: string;
    analysisVersion: number;
    approvedByUserId: string;
    approvedAt: string;
    viewVersion: string;
  }) | null;
};

@Injectable()
export class StoryStudioChoicePreparationService {
  constructor(private readonly prisma: PrismaService) {}

  async assertPublishableTx(tx: Prisma.TransactionClient, workId: string, ownerUserId: string,
    manuscriptVersionId: string, releaseId: string) {
    return this.assertPreparedChoicesTx(tx, workId, ownerUserId, manuscriptVersionId, releaseId);
  }

  async assertPreparedScenesTx(tx: Prisma.TransactionClient, workId: string, ownerUserId: string,
    manuscriptVersionId: string, releaseId: string, sceneIds: string[]) {
    await this.assertPreparedChoicesTx(tx, workId, ownerUserId, manuscriptVersionId, releaseId, sceneIds);
  }

  private async assertPreparedChoicesTx(tx: Prisma.TransactionClient, workId: string, ownerUserId: string,
    manuscriptVersionId: string, releaseId: string, preparedSceneIds?: string[]) {
    const manuscript = await tx.storyManuscriptVersion.findUnique({ where: { id: manuscriptVersionId } });
    const body = manuscript?.structuredBody as Record<string, unknown> | undefined;
    const intake = body?.intake as Record<string, unknown> | undefined;
    if (intake?.format !== 'story-manuscript-intake-v1') return;
    const review = await tx.storyWriterReview.findFirst({ where: {
      workId, ownerUserId, manuscriptVersionId, state: 'submitted',
    } });
    if (!review) fail('STUDIO_CHOICES_FINAL_REVIEW_REQUIRED');
    const [submission, consent, parts] = await Promise.all([
      tx.storyFinalSubmission.findUnique({ where: { reviewId: review.id } }),
      tx.storyStyleProfileConsent.findUnique({ where: { workId } }),
      tx.storyPart.findMany({ where: { workId, fixtureSource: false }, orderBy: { position: 'asc' } }),
    ]);
    const now = new Date();
    if (!manuscript || manuscript.workId !== workId || manuscript.ownerUserId !== ownerUserId ||
        manuscript.locale !== 'ko' || !submission || submission.status !== 'submitted' ||
        submission.checksum !== manuscript.contentHash ||
        !consent || consent.ownerUserId !== ownerUserId || consent.manuscriptVersionId !== manuscriptVersionId ||
        consent.status !== 'active' || !consent.rightsConfirmed || !consent.aiBranchAllowed ||
        !Number.isSafeInteger(consent.revision) || consent.revision < 1 ||
        consent.startsAt > now || (consent.expiresAt && consent.expiresAt <= now) ||
        !Array.isArray(consent.allowedLocales) || !consent.allowedLocales.includes('ko')) {
      fail('STUDIO_CHOICES_PUBLICATION_CONSENT_REQUIRED');
    }
    await assertCompanyFinalSubmissionCurrent(tx, { ownerUserId, workId, review, manuscript, submission });
    if (tx.storyWorkGenerationProfile) {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_work_generation_profiles WHERE work_id = ${workId}::uuid FOR SHARE`);
    }
    const generationProfile = await this.approvedGenerationProfile(tx, ownerUserId, workId,
      manuscript, review.analysisJobId);
    const authoredParts = Array.isArray(body?.parts) ? body.parts : [];
    if (!authoredParts.length || parts.length !== authoredParts.length ||
        parts.some((part, index) => part.position !== index + 1 || !['draft', 'published'].includes(part.status)) ||
        new Set(parts.map(part => part.status)).size !== 1) {
      fail('STUDIO_CHOICES_PUBLICATION_PARTS_INCOMPLETE');
    }
    const scenes = await tx.storyScene.findMany({ where: { partId: { in: parts.map(part => part.id) },
      fixtureSource: false }, select: { id: true, partId: true, status: true } });
    const scenesByPart = new Map<string, typeof scenes>();
    for (const scene of scenes) {
      const rows = scenesByPart.get(scene.partId) ?? [];
      rows.push(scene);
      scenesByPart.set(scene.partId, rows);
    }
    const preparedScenes = preparedSceneIds ? new Set(preparedSceneIds) : null;
    const sceneIds = scenes.filter(scene => !preparedScenes || preparedScenes.has(scene.id)).map(scene => scene.id);
    if (preparedScenes && (!preparedScenes.size || preparedScenes.size !== sceneIds.length)) {
      fail('STUDIO_CHOICES_PUBLICATION_SCENES_INCOMPLETE');
    }
    const [choices, proofs, beats] = await Promise.all([
      tx.storyChoice.findMany({ where: { sceneId: { in: sceneIds } },
        orderBy: [{ position: 'asc' }, { id: 'asc' }] }),
      tx.auditEvent.findMany({ where: { actorUserId: ownerUserId, action: 'story_studio_choices.prepared',
        targetType: 'story_scene', targetId: { in: sceneIds } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, targetId: true, metadata: true } }),
      tx.storyBeat.findMany({ where: { sceneId: { in: sceneIds } },
        orderBy: [{ sceneId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
        select: { sceneId: true, content: true } }),
    ]);
    const choicesByScene = new Map<string, typeof choices>();
    for (const choice of choices) {
      const rows = choicesByScene.get(choice.sceneId) ?? [];
      rows.push(choice);
      choicesByScene.set(choice.sceneId, rows);
    }
    const proofByScene = new Map<string, (typeof proofs)[number]>();
    for (const proof of proofs) {
      if (proof.targetId && !proofByScene.has(proof.targetId)) proofByScene.set(proof.targetId, proof);
    }
    const receipts = [...proofByScene.values()].some(proof =>
      (proof.metadata as Record<string, unknown> | null)?.consentRevision !== consent.revision)
      ? await tx.auditEvent.findMany({ where: { actorUserId: ownerUserId, action: CHOICE_CONSENT_REAPPROVED,
        targetType: 'story_scene', targetId: { in: sceneIds } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { targetId: true, metadata: true } }) : [];
    const receiptByScene = new Map<string, unknown>();
    for (const receipt of receipts) if (receipt.targetId && !receiptByScene.has(receipt.targetId)) receiptByScene.set(receipt.targetId, receipt.metadata);
    const beatsByScene = new Map<string, typeof beats>();
    for (const beat of beats) {
      const rows = beatsByScene.get(beat.sceneId) ?? [];
      rows.push(beat);
      beatsByScene.set(beat.sceneId, rows);
    }
    const orderedSceneIds: string[] = [];
    for (const part of parts) {
      const partScenes = scenesByPart.get(part.id) ?? [];
      if (partScenes.length !== 1 || partScenes[0].status !== part.status) fail('STUDIO_CHOICES_PUBLICATION_SCENES_INCOMPLETE');
      const sceneId = partScenes[0].id;
      orderedSceneIds.push(sceneId);
      if (preparedScenes && !preparedScenes.has(sceneId)) continue;
      const sceneChoices = choicesByScene.get(sceneId) ?? [];
      const labels = sceneChoices.map(choice => localized(choice.label, manuscript.locale));
      if (sceneChoices.length !== 3 || sceneChoices.some((choice, index) => choice.position !== index + 1) ||
          sceneChoices[0].routeKind !== 'writer_original' ||
          Boolean(sceneChoices[0].targetSceneId) === Boolean(sceneChoices[0].targetEndingKey) ||
          sceneChoices.slice(1).some(choice => choice.routeKind !== 'generation_required' ||
            choice.targetSceneId || choice.targetEndingKey || choice.declaredRejoinSceneId) ||
          labels.some(label => !label) || new Set(labels).size !== 3) {
        fail('STUDIO_CHOICES_PUBLICATION_CHOICES_INCOMPLETE');
      }
      const evidence = proofByScene.get(sceneId);
      const metadata = evidence?.metadata as Record<string, unknown> | undefined;
      const sceneBeats = beatsByScene.get(sceneId) ?? [];
      if (body && Object.prototype.hasOwnProperty.call(body, 'publicationReaderProjection')) {
        const source = authoredParts[part.position - 1] as unknown as ManuscriptPart;
        const expectedText = publicationReaderText(manuscript.structuredBody, source, manuscript.contentHash);
        if (expectedText.replace(/\s+/gu, '') !== sceneBeats.map(beat =>
          localized(beat.content, manuscript.locale) ?? '').join('').replace(/\s+/gu, '')) {
          fail('STUDIO_CHOICES_MANUSCRIPT_SCENE_MISMATCH');
        }
      }
      const currentSceneDigest = sceneDigest(sceneBeats.map(beat => localized(beat.content, manuscript.locale) ?? '').join(''));
      if (metadata?.workId !== workId || metadata?.releaseId !== releaseId ||
          metadata?.consentId !== consent.id || (metadata?.consentRevision !== consent.revision &&
            !choiceConsentReceiptValid(evidence, receiptByScene.get(sceneId), consent)) ||
          metadata?.manuscriptHash !== manuscript.contentHash ||
          (generationProfile
            ? metadata?.generationProfileViewVersion !== generationProfile.viewVersion ||
              stableJson(metadata?.generationProfilePin) !== stableJson(generationProfile.pin) ||
              metadata?.analysisJobId !== generationProfile.analysisJobId
            : metadata?.generationProfilePin !== undefined || metadata?.generationProfileViewVersion !== undefined) ||
          metadata?.sceneDigest !== currentSceneDigest ||
          metadata?.choiceDigest !== choiceDigest(sceneChoices, manuscript.locale)) {
        fail('STUDIO_CHOICES_GENERATION_PROOF_REQUIRED');
      }
    }
    return !preparedScenes && parts[0].status === 'draft'
      ? { partIds: parts.map(part => part.id), sceneIds: orderedSceneIds } : undefined;
  }

  async prepare(ownerUserId: string, workId: string, releaseId: string, sceneId: string,
    jobLeaseToken?: string) {
    if (![workId, releaseId, sceneId].every(id => isUUID(id))) fail('STUDIO_CHOICES_INVALID_ID');
    await this.assertJobLease(this.prisma, releaseId, jobLeaseToken);
    const snapshot = await this.readiness(this.prisma, ownerUserId, workId, releaseId, sceneId);
    const provider = this.provider();
    let alternatives: [string, string];
    let originalLabel: string;
    let providerUsage: StoryChoiceUsage | null = null;
    let providerOutcome: 'accepted' | 'rejected' = 'rejected';
    try {
      const generated = await provider.generate({ workTitle: snapshot.workTitle,
        ...(snapshot.generationProfile ? { generationProfile: snapshot.generationProfile.approved } : {}), parts: [{
        partKey: snapshot.partKey, title: snapshot.partTitle, endingExcerpt: snapshot.endingExcerpt,
        ...(snapshot.originalLabel ? { originalChoiceLabel: snapshot.originalLabel } : {
          nextPartTitle: snapshot.nextPartTitle, nextPartExcerpt: snapshot.nextPartExcerpt,
        }), context: snapshot.context,
      }] }, (usage) => { providerUsage = usage; });
      if (generated.length !== 1 || generated[0].partKey !== snapshot.partKey) fail('STUDIO_CHOICES_GENERATION_INVALID');
      alternatives = generated[0].alternatives;
      originalLabel = snapshot.originalLabel ?? generated[0].originalChoiceLabel;
      if (!originalLabel || originalLabel.length > 120) fail('STUDIO_CHOICES_GENERATION_INVALID');
      providerOutcome = 'accepted';
    } catch (error) {
      if (error instanceof StoryChoicePreparationError) throw new ServiceUnavailableException({
        code: 'STUDIO_CHOICES_GENERATION_FAILED', reason: error.code,
        message: 'Choice preparation did not complete; this scene remains unpublished',
      });
      throw error;
    } finally {
      await this.prisma.auditEvent.create({ data: {
        actorUserId: ownerUserId, actorType: 'user',
        action: 'story_studio_choices.provider_usage', targetType: 'story_scene', targetId: sceneId,
        metadata: {
          workId, releaseId, model: provider.modelName, outcome: providerOutcome,
          usageStatus: providerUsage ? 'reported' : 'unavailable', providerUsage,
        },
      } });
    }
    try {
      return await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_studio_choice_jobs WHERE release_id = ${releaseId}::uuid FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_scenes WHERE id = ${sceneId}::uuid FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_style_profile_consents WHERE work_id = ${workId}::uuid FOR SHARE`);
      if (tx.storyWorkGenerationProfile) {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM story_work_generation_profiles WHERE work_id = ${workId}::uuid FOR SHARE`);
      }
      await this.assertJobLease(tx, releaseId, jobLeaseToken);
      const current = await this.readiness(tx, ownerUserId, workId, releaseId, sceneId);
      if (JSON.stringify(current) !== JSON.stringify(snapshot)) fail('STUDIO_CHOICES_SOURCE_CHANGED');
      const choices = await tx.storyChoice.findMany({ where: { sceneId }, orderBy: { position: 'asc' } });
      if (choices.length !== 1 || choices[0].position !== 1 || choices[0].routeKind !== 'writer_original' ||
          localized(choices[0].label, 'ko') !== snapshot.originalLabel) fail('STUDIO_CHOICES_ORIGINAL_CHANGED');
      if (snapshot.originalLabel === null) {
        await tx.storyChoice.update({ where: { id: choices[0].id }, data: { label: { ko: originalLabel } } });
      }
      const generated = alternatives.map((label, index) => ({
        sceneId, choiceKey: index === 0 ? 'branch-b' : 'branch-c', position: index + 2,
        label: { ko: label }, routeKind: 'generation_required',
      }));
      await tx.storyChoice.createMany({ data: generated });
      await tx.auditEvent.create({ data: { actorUserId: ownerUserId, actorType: 'user',
        action: 'story_studio_choices.prepared', targetType: 'story_scene', targetId: sceneId,
        metadata: { workId, releaseId, manuscriptHash: snapshot.manuscriptHash,
          consentId: snapshot.consentId, consentRevision: snapshot.consentRevision, choiceCount: 3,
          sceneDigest: snapshot.sceneDigest,
          ...(snapshot.generationProfile ? { generationProfilePin: snapshot.generationProfile.pin,
            generationProfileViewVersion: snapshot.generationProfile.viewVersion,
            analysisJobId: snapshot.generationProfile.analysisJobId } : {}),
          choiceDigest: choiceDigest([{ ...choices[0], label: { ko: originalLabel } }, ...generated], 'ko'),
          originalLabelGenerated: snapshot.originalLabel === null } } });
      return { sceneId, choiceCount: 3, originalRoutePreserved: true };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 10000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({ code: 'STUDIO_CHOICES_STORE_FAILED',
        message: 'Choice storage could not be confirmed; retry after checking the scene' });
    }
  }

  private provider() {
    const apiKey = process.env.STORY_CONTINUATION_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new ServiceUnavailableException({ code: 'STUDIO_CHOICES_PROVIDER_NOT_CONFIGURED' });
    return new StoryChoicePreparationProvider({ apiKey,
      model: process.env.STORY_CONTINUATION_OPENAI_MODEL || 'gpt-5.4-mini-2026-03-17' });
  }

  private async assertJobLease(db: PrismaService | Prisma.TransactionClient,
    releaseId: string, leaseToken?: string) {
    const job = await db.storyStudioChoiceJob.findUnique({ where: { releaseId },
      select: { status: true, leaseToken: true, leaseExpiresAt: true } });
    if ((!job && leaseToken) || (job && (job.status !== 'processing' || !leaseToken || job.leaseToken !== leaseToken ||
        !job.leaseExpiresAt || job.leaseExpiresAt <= new Date()))) {
      fail('STUDIO_CHOICES_BACKGROUND_JOB_ACTIVE');
    }
  }

  private async readiness(db: PrismaService | Prisma.TransactionClient, ownerUserId: string,
    workId: string, releaseId: string, sceneId: string): Promise<PreparationSnapshot> {
    const work = await db.storyWork.findFirst({ where: { id: workId, ownerUserId } });
    if (!work) throw new NotFoundException('Story work not found');
    if (work.status === 'published' || work.activeReleaseId || work.publishedAt || work.fixtureSource) fail('STUDIO_CHOICES_PRIVATE_DRAFT_REQUIRED');
    if (await db.storyAuthoredImport.findUnique({ where: { workId } })) fail('STUDIO_CHOICES_IMPORTED_WORK_UNSUPPORTED');
    const release = await db.storyRelease.findFirst({ where: { id: releaseId, workId, status: 'candidate' } });
    if (!release) fail('STUDIO_CHOICES_CANDIDATE_REQUIRED');
    const manuscript = await db.storyManuscriptVersion.findFirst({ where: {
      id: release.manuscriptVersionId, workId, ownerUserId,
    } });
    if (!manuscript || manuscript.locale !== 'ko') fail('STUDIO_CHOICES_MANUSCRIPT_REQUIRED');
    const review = await db.storyWriterReview.findFirst({ where: {
      workId, ownerUserId, manuscriptVersionId: manuscript.id, state: 'submitted',
    } });
    const submission = review ? await db.storyFinalSubmission.findUnique({ where: { reviewId: review.id } }) : null;
    if (!submission || submission.status !== 'submitted' || submission.checksum !== manuscript.contentHash ||
        submission.manuscriptVersionId !== manuscript.id) fail('STUDIO_CHOICES_FINAL_REVIEW_REQUIRED');
    await assertCompanyFinalSubmissionCurrent(db, { ownerUserId, workId, review: review!, manuscript, submission });
    const consent = await db.storyStyleProfileConsent.findUnique({ where: { workId } });
    const now = new Date();
    if (!consent || consent.ownerUserId !== ownerUserId || consent.manuscriptVersionId !== manuscript.id ||
        consent.status !== 'active' || !consent.rightsConfirmed || !consent.aiBranchAllowed ||
        consent.startsAt > now || (consent.expiresAt && consent.expiresAt <= now) ||
        !Array.isArray(consent.allowedLocales) || !consent.allowedLocales.includes('ko')) {
      fail('STUDIO_CHOICES_AI_RIGHTS_CONSENT_REQUIRED');
    }
    const generationProfile = await this.approvedGenerationProfile(db, ownerUserId, workId,
      manuscript, review!.analysisJobId);
    const scene = await db.storyScene.findFirst({ where: { id: sceneId, status: 'draft' } });
    const part = scene ? await db.storyPart.findFirst({ where: { id: scene.partId, workId, status: 'draft' } }) : null;
    if (!scene || !part) fail('STUDIO_CHOICES_DRAFT_SCENE_REQUIRED');
    const body = manuscript.structuredBody as Record<string, unknown>;
    if ((body?.intake as Record<string, unknown> | undefined)?.format !== 'story-manuscript-intake-v1') {
      fail('STUDIO_CHOICES_MANUSCRIPT_REQUIRED');
    }
    const parts = body && Array.isArray(body.parts) ? body.parts : [];
    const source = parts[part.position - 1] as Record<string, unknown> | undefined;
    const paragraphs = source && Array.isArray(source.paragraphs) ? source.paragraphs : [];
    const sourceText = paragraphs.filter((item): item is { kind: string; text: string } =>
      Boolean(item && typeof item === 'object' &&
        ['title', 'scene_break', 'paragraph', 'dialogue'].includes(item.kind) && typeof item.text === 'string'))
      .map(item => item.text).join('');
    const readerText = typeof source?.title === 'string' ? publicationReaderText(manuscript.structuredBody,
      source as unknown as ManuscriptPart, manuscript.contentHash) : sourceText;
    const beats = await db.storyBeat.findMany({ where: { sceneId }, orderBy: { position: 'asc' } });
    const sceneText = beats.map(beat => localized(beat.content, 'ko') ?? '').join('');
    const compact = (value: string) => value.replace(/\s+/gu, '');
    if (!source || typeof source.partKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(source.partKey) ||
        typeof source.title !== 'string' || source.title !== localized(part.title, 'ko') ||
        !readerText.trim() || compact(readerText) !== compact(sceneText)) {
      fail('STUDIO_CHOICES_MANUSCRIPT_SCENE_MISMATCH');
    }
    const choices = await db.storyChoice.findMany({ where: { sceneId }, orderBy: { position: 'asc' } });
    const originalLabel = choices[0] ? localized(choices[0].label, 'ko') : null;
    const graph = release.branchGraphSnapshot as Record<string, unknown> | undefined;
    const graphParts = Array.isArray(graph?.parts) ? graph.parts : [];
    const plannedRoute = graphParts.find((row): row is Record<string, unknown> =>
      Boolean(row && typeof row === 'object' && !Array.isArray(row) &&
        (row as Record<string, unknown>).partKey === source?.partKey));
    if (plannedRoute && (plannedRoute.originalLabel === null ? originalLabel !== null :
        typeof plannedRoute.originalLabel !== 'string' || plannedRoute.originalLabel !== originalLabel)) {
      fail('STUDIO_CHOICES_ORIGINAL_ROUTE_REQUIRED');
    }
    const generatedOriginalPending = !originalLabel && plannedRoute?.originalLabel === null;
    if (choices.length !== 1 || choices[0].position !== 1 || choices[0].routeKind !== 'writer_original' ||
        Boolean(choices[0].targetSceneId) === Boolean(choices[0].targetEndingKey) ||
        (!originalLabel && !generatedOriginalPending)) fail('STUDIO_CHOICES_ORIGINAL_ROUTE_REQUIRED');
    if (choices[0].targetSceneId) {
      const target = await db.storyScene.findUnique({ where: { id: choices[0].targetSceneId } });
      const targetPart = target ? await db.storyPart.findFirst({ where: { id: target.partId, workId } }) : null;
      if (!targetPart || targetPart.position !== part.position + 1) fail('STUDIO_CHOICES_ORIGINAL_ROUTE_REQUIRED');
    }
    const workTitle = localized(work.title, 'ko');
    if (!workTitle) fail('STUDIO_CHOICES_TITLE_REQUIRED');
    const next = parts[part.position] as Record<string, unknown> | undefined;
    if (generatedOriginalPending && (Boolean(choices[0].targetSceneId) !== Boolean(next) ||
        (!next && choices[0].targetEndingKey !== 'author_main'))) {
      fail('STUDIO_CHOICES_ORIGINAL_ROUTE_REQUIRED');
    }
    if (plannedRoute && plannedRoute.nextPartKey !== (next?.partKey ?? null)) {
      fail('STUDIO_CHOICES_ORIGINAL_ROUTE_REQUIRED');
    }
    const nextParagraphs = next && Array.isArray(next.paragraphs) ? next.paragraphs : [];
    const nextPartText = nextParagraphs.filter((item): item is { text: string } =>
      Boolean(item && typeof item === 'object' && typeof item.text === 'string'))
      .map(item => item.text).join('');
    const nextPartExcerpt = (typeof next?.title === 'string'
      ? publicationReaderText(manuscript.structuredBody,
        next as unknown as ManuscriptPart, manuscript.contentHash)
      : readerPartText(nextPartText, '')).trim().slice(0, 500);
    if (generatedOriginalPending && choices[0].targetSceneId &&
        (typeof next?.title !== 'string' || !nextPartExcerpt)) fail('STUDIO_CHOICES_ORIGINAL_ROUTE_REQUIRED');
    return { workTitle, partKey: source.partKey, partTitle: source.title,
      endingExcerpt: readerText.trim().slice(-1200), context: readerText.trim().slice(0, 350),
      originalLabel, nextPartTitle: generatedOriginalPending && next ? String(next.title) : null,
      nextPartExcerpt: generatedOriginalPending && next ? nextPartExcerpt : null,
      consentId: consent.id,
      consentRevision: consent.revision, manuscriptHash: manuscript.contentHash, sceneDigest: sceneDigest(sceneText),
      generationProfile };
  }

  async assertOriginalSceneReadyTx(tx: Prisma.TransactionClient, ownerUserId: string,
    workId: string, releaseId: string, sceneId: string) {
    await this.readiness(tx, ownerUserId, workId, releaseId, sceneId);
  }

  async approvedGenerationProfile(db: PrismaService | Prisma.TransactionClient, ownerUserId: string,
    workId: string, manuscript: { id: string; contentHash: string }, reviewAnalysisJobId: string) {
    // Legacy clients/works without profiles retain their existing choice preparation contract.
    if (!db.storyWorkGenerationProfile) return null;
    const profile = await db.storyWorkGenerationProfile.findFirst({ where: { workId },
      orderBy: { profileVersion: 'desc' } });
    const analysis = await db.storyAnalysisJob.findFirst({ where: { workId,
      manuscriptVersionId: manuscript.id, pipeline: SEMANTIC_PIPELINE },
      orderBy: { analysisVersion: 'desc' } });
    if (!profile) {
      if (analysis) fail('STUDIO_CHOICES_GENERATION_PROFILE_APPROVAL_REQUIRED');
      return null;
    }
    if (profile.workId !== workId || profile.ownerUserId !== ownerUserId ||
        profile.approvedByUserId !== ownerUserId || !profile.approvedAt ||
        profile.status !== 'approved' || profile.profileVersion < 1 || profile.reviewRevision < 1) {
      fail('STUDIO_CHOICES_GENERATION_PROFILE_APPROVAL_REQUIRED');
    }
    if (profile.manuscriptVersionId !== manuscript.id || !analysis ||
        analysis.workId !== workId || analysis.manuscriptVersionId !== manuscript.id ||
        analysis.status !== 'completed' || analysis.pipeline !== SEMANTIC_PIPELINE ||
        analysis.sourceLocale !== 'ko' || analysis.totalParagraphs < 1 ||
        analysis.plannedParagraphs !== analysis.totalParagraphs ||
        analysis.completedParagraphs !== analysis.totalParagraphs ||
        analysis.sourceContentHash !== manuscript.contentHash || profile.analysisJobId !== analysis.id ||
        reviewAnalysisJobId !== analysis.id) {
      fail('STUDIO_CHOICES_GENERATION_PROFILE_SOURCE_MISMATCH');
    }
    const sourceFingerprint = createHash('sha256').update(stableJson({ workId,
      manuscriptVersionId: manuscript.id, contentHash: manuscript.contentHash,
      analysisJobId: analysis.id, analysisVersion: analysis.analysisVersion,
      analysisConfigHash: analysis.configHash })).digest('hex');
    if (profile.sourceFingerprint !== sourceFingerprint) fail('STUDIO_CHOICES_GENERATION_PROFILE_SOURCE_MISMATCH');
    try {
      const snapshot = continuationGenerationProfileSnapshot(profile);
      const binding = { manuscriptVersionId: manuscript.id,
        analysisJobId: analysis.id, analysisVersion: analysis.analysisVersion,
        approvedByUserId: profile.approvedByUserId, approvedAt: profile.approvedAt.toISOString() };
      return { ...snapshot, ...binding, pin: { ...snapshot.pin, ...binding },
        viewVersion: STORY_CONTINUATION_PROFILE_VIEW_VERSION };
    } catch {
      fail('STUDIO_CHOICES_GENERATION_PROFILE_INVALID');
    }
  }
}

import { ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { isUUID } from 'class-validator';
import { StoryChoicePreparationError, StoryChoicePreparationProvider } from './story-choice-preparation.provider';

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

function choiceDigest(choices: BoundChoice[], locale: string): string {
  return createHash('sha256').update(JSON.stringify(choices.map(choice => ({
    choiceKey: choice.choiceKey, position: choice.position, label: localized(choice.label, locale),
    routeKind: choice.routeKind, targetSceneId: choice.targetSceneId ?? null,
    targetEndingKey: choice.targetEndingKey ?? null,
    declaredRejoinSceneId: choice.declaredRejoinSceneId ?? null,
  })))).digest('hex');
}

function sceneDigest(text: string): string {
  return createHash('sha256').update(text.replace(/\s+/gu, '')).digest('hex');
}

type PreparationSnapshot = {
  workTitle: string;
  partKey: string;
  partTitle: string;
  endingExcerpt: string;
  context: string;
  originalLabel: string;
  consentId: string;
  consentRevision: number;
  manuscriptHash: string;
  sceneDigest: string;
};

@Injectable()
export class StoryStudioChoicePreparationService {
  constructor(private readonly prisma: PrismaService) {}

  async assertPublishableTx(tx: Prisma.TransactionClient, workId: string, ownerUserId: string,
    manuscriptVersionId: string, releaseId: string) {
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
    if (!manuscript || manuscript.locale !== 'ko' || !submission || submission.status !== 'submitted' ||
        submission.checksum !== manuscript.contentHash ||
        !consent || consent.ownerUserId !== ownerUserId || consent.manuscriptVersionId !== manuscriptVersionId ||
        consent.status !== 'active' || !consent.rightsConfirmed || !consent.aiBranchAllowed ||
        consent.startsAt > now || (consent.expiresAt && consent.expiresAt <= now) ||
        !Array.isArray(consent.allowedLocales) || !consent.allowedLocales.includes('ko')) {
      fail('STUDIO_CHOICES_PUBLICATION_CONSENT_REQUIRED');
    }
    const authoredParts = Array.isArray(body?.parts) ? body.parts : [];
    if (!authoredParts.length || parts.length !== authoredParts.length ||
        parts.some((part, index) => part.position !== index + 1 || !['draft', 'published'].includes(part.status)) ||
        new Set(parts.map(part => part.status)).size !== 1) {
      fail('STUDIO_CHOICES_PUBLICATION_PARTS_INCOMPLETE');
    }
    const sceneIds: string[] = [];
    for (const part of parts) {
      const scenes = await tx.storyScene.findMany({ where: { partId: part.id, fixtureSource: false } });
      if (scenes.length !== 1 || scenes[0].status !== part.status) fail('STUDIO_CHOICES_PUBLICATION_SCENES_INCOMPLETE');
      sceneIds.push(scenes[0].id);
      const choices = await tx.storyChoice.findMany({ where: { sceneId: scenes[0].id }, orderBy: { position: 'asc' } });
      const labels = choices.map(choice => localized(choice.label, manuscript.locale));
      if (choices.length !== 3 || choices.some((choice, index) => choice.position !== index + 1) ||
          choices[0].routeKind !== 'writer_original' ||
          Boolean(choices[0].targetSceneId) === Boolean(choices[0].targetEndingKey) ||
          choices.slice(1).some(choice => choice.routeKind !== 'generation_required' ||
            choice.targetSceneId || choice.targetEndingKey || choice.declaredRejoinSceneId) ||
          labels.some(label => !label) || new Set(labels).size !== 3) {
        fail('STUDIO_CHOICES_PUBLICATION_CHOICES_INCOMPLETE');
      }
      const evidence = await tx.auditEvent.findFirst({ where: {
        actorUserId: ownerUserId, action: 'story_studio_choices.prepared',
        targetType: 'story_scene', targetId: scenes[0].id,
      }, orderBy: { createdAt: 'desc' } });
      const metadata = evidence?.metadata as Record<string, unknown> | undefined;
      const beats = await tx.storyBeat.findMany({ where: { sceneId: scenes[0].id }, orderBy: { position: 'asc' } });
      const currentSceneDigest = sceneDigest(beats.map(beat => localized(beat.content, manuscript.locale) ?? '').join(''));
      if (metadata?.workId !== workId || metadata?.releaseId !== releaseId ||
          metadata?.consentId !== consent.id || metadata?.manuscriptHash !== manuscript.contentHash ||
          metadata?.sceneDigest !== currentSceneDigest ||
          metadata?.choiceDigest !== choiceDigest(choices, manuscript.locale)) {
        fail('STUDIO_CHOICES_GENERATION_PROOF_REQUIRED');
      }
    }
    return parts[0].status === 'draft' ? { partIds: parts.map(part => part.id), sceneIds } : undefined;
  }

  async prepare(ownerUserId: string, workId: string, releaseId: string, sceneId: string) {
    if (![workId, releaseId, sceneId].every(id => isUUID(id))) fail('STUDIO_CHOICES_INVALID_ID');
    const snapshot = await this.readiness(this.prisma, ownerUserId, workId, releaseId, sceneId);
    const provider = this.provider();
    let alternatives: [string, string];
    try {
      const generated = await provider.generate({ workTitle: snapshot.workTitle, parts: [{
        partKey: snapshot.partKey, title: snapshot.partTitle, endingExcerpt: snapshot.endingExcerpt,
        originalChoiceLabel: snapshot.originalLabel, context: snapshot.context,
      }] });
      if (generated.length !== 1 || generated[0].partKey !== snapshot.partKey) fail('STUDIO_CHOICES_GENERATION_INVALID');
      alternatives = generated[0].alternatives;
    } catch (error) {
      if (error instanceof StoryChoicePreparationError) throw new ServiceUnavailableException({
        code: 'STUDIO_CHOICES_GENERATION_FAILED', reason: error.code,
        message: 'Choice preparation did not complete; this scene remains unpublished',
      });
      throw error;
    }
    try {
      return await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_scenes WHERE id = ${sceneId}::uuid FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_style_profile_consents WHERE work_id = ${workId}::uuid FOR SHARE`);
      const current = await this.readiness(tx, ownerUserId, workId, releaseId, sceneId);
      if (JSON.stringify(current) !== JSON.stringify(snapshot)) fail('STUDIO_CHOICES_SOURCE_CHANGED');
      const choices = await tx.storyChoice.findMany({ where: { sceneId }, orderBy: { position: 'asc' } });
      if (choices.length !== 1 || choices[0].position !== 1 || choices[0].routeKind !== 'writer_original' ||
          localized(choices[0].label, 'ko') !== snapshot.originalLabel) fail('STUDIO_CHOICES_ORIGINAL_CHANGED');
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
          choiceDigest: choiceDigest([choices[0], ...generated], 'ko') } } });
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
    const consent = await db.storyStyleProfileConsent.findUnique({ where: { workId } });
    const now = new Date();
    if (!consent || consent.ownerUserId !== ownerUserId || consent.manuscriptVersionId !== manuscript.id ||
        consent.status !== 'active' || !consent.rightsConfirmed || !consent.aiBranchAllowed ||
        consent.startsAt > now || (consent.expiresAt && consent.expiresAt <= now) ||
        !Array.isArray(consent.allowedLocales) || !consent.allowedLocales.includes('ko')) {
      fail('STUDIO_CHOICES_AI_RIGHTS_CONSENT_REQUIRED');
    }
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
      Boolean(item && typeof item === 'object' && ['paragraph', 'dialogue'].includes(item.kind) && typeof item.text === 'string'))
      .map(item => item.text).join('');
    const beats = await db.storyBeat.findMany({ where: { sceneId }, orderBy: { position: 'asc' } });
    const sceneText = beats.map(beat => localized(beat.content, 'ko') ?? '').join('');
    const compact = (value: string) => value.replace(/\s+/gu, '');
    if (!source || typeof source.partKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(source.partKey) ||
        typeof source.title !== 'string' || source.title !== localized(part.title, 'ko') ||
        !sourceText.trim() || compact(sourceText) !== compact(sceneText)) fail('STUDIO_CHOICES_MANUSCRIPT_SCENE_MISMATCH');
    const choices = await db.storyChoice.findMany({ where: { sceneId }, orderBy: { position: 'asc' } });
    if (choices.length !== 1 || choices[0].position !== 1 || choices[0].routeKind !== 'writer_original' ||
        Boolean(choices[0].targetSceneId) === Boolean(choices[0].targetEndingKey) ||
        !localized(choices[0].label, 'ko')) fail('STUDIO_CHOICES_ORIGINAL_ROUTE_REQUIRED');
    if (choices[0].targetSceneId) {
      const target = await db.storyScene.findUnique({ where: { id: choices[0].targetSceneId } });
      const targetPart = target ? await db.storyPart.findFirst({ where: { id: target.partId, workId } }) : null;
      if (!targetPart || targetPart.position !== part.position + 1) fail('STUDIO_CHOICES_ORIGINAL_ROUTE_REQUIRED');
    }
    const workTitle = localized(work.title, 'ko');
    if (!workTitle) fail('STUDIO_CHOICES_TITLE_REQUIRED');
    return { workTitle, partKey: source.partKey, partTitle: source.title,
      endingExcerpt: sourceText.trim().slice(-1200), context: sourceText.trim().slice(0, 350),
      originalLabel: localized(choices[0].label, 'ko')!, consentId: consent.id,
      consentRevision: consent.revision, manuscriptHash: manuscript.contentHash, sceneDigest: sceneDigest(sceneText) };
  }
}

import { ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { MaterializeStudioLinearDto, StudioVisualReferenceDetailDto, StudioVisualReferencePageDto } from './dto/story-studio-linear.dto';
import { missingAuthoredSceneVisual } from './story-authored-beat-visual.policy';
import { releaseChecksum } from './story-lifecycle.policy';
import { PreparedManuscript, prepareManuscript, preparePastedManuscript } from './story-manuscript-file.policy';
import { StoryStudioChoicePreparationService } from './story-studio-choice-preparation.service';
import { readerPartText } from './story-studio-reader-text.policy';
import { publicationReaderText } from './story-publication-reader-projection.policy';
import { studioSceneVisualPrompt } from './story-approved-visual.policy';
import { publicationVisualReferencePreview } from './story-publication-visual-binding.policy';
import { studioVisualReferenceDetail, studioVisualReferencePage } from './story-studio-visual-reference.policy';
import { studioManuscriptVisualReviewSource } from './story-studio-visual-source.policy';

function reject(code: string): never {
  throw new ConflictException({ code, message: 'The private manuscript is not ready for Studio choice preparation' });
}

export function sourceOf(manuscript: { locale: string; contentHash: string; structuredBody: Prisma.JsonValue }): PreparedManuscript {
  const body = manuscript.structuredBody as Record<string, unknown>;
  const intake = body?.intake as Record<string, unknown> | undefined;
  const source = intake?.source as Record<string, unknown> | undefined;
  if (intake?.format !== 'story-manuscript-intake-v1' || manuscript.locale !== 'ko' ||
      intake.locale !== 'ko' ||
      !source || typeof source.rawText !== 'string' || !['utf8_paste', 'utf8_json_file'].includes(String(source.kind))) {
    reject('STUDIO_LINEAR_SOURCE_REQUIRED');
  }
  if ((source.kind === 'utf8_paste' && (intake.identityVersion !== 4 || !Array.isArray(intake.confirmedBoundaries))) ||
      (source.kind === 'utf8_json_file' && intake.identityVersion !== 2)) reject('STUDIO_LINEAR_SOURCE_REQUIRED');
  const bytes = Buffer.from(source.rawText, 'utf8');
  if (source.byteLength !== bytes.length || source.sha256 !== createHash('sha256').update(bytes).digest('hex')) {
    reject('STUDIO_LINEAR_SOURCE_CHANGED');
  }
  const prepared = source.kind === 'utf8_paste'
    ? preparePastedManuscript(bytes, JSON.stringify({ locale: 'ko', confirmed: true,
      parts: intake.confirmedBoundaries,
      ...(intake.confirmedPreface ? { preface: intake.confirmedPreface } : {}) }))
    : prepareManuscript(bytes);
  if (prepared.contentHash !== manuscript.contentHash ||
      releaseChecksum(prepared.parts) !== releaseChecksum(body.parts)) reject('STUDIO_LINEAR_SOURCE_CHANGED');
  return { ...prepared, readerPartTexts: new Map(prepared.parts.map(part =>
    [part.partKey, publicationReaderText(manuscript.structuredBody, part, manuscript.contentHash)])) };
}

export function linearPartPlan(prepared: PreparedManuscript, routes: Array<{ partKey: string; label?: string }>) {
  if (prepared.locale !== 'ko' || routes.length !== prepared.parts.length) reject('STUDIO_LINEAR_ROUTE_REVIEW_REQUIRED');
  return prepared.parts.map((part, index) => {
    const route = routes[index];
    if (route?.label !== undefined && typeof route.label !== 'string') reject('STUDIO_LINEAR_ROUTE_REVIEW_REQUIRED');
    const label = route?.label?.trim() || null;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(part.partKey) || route?.partKey !== part.partKey ||
        (label !== null && (label.length > 120 || label.includes('\0') ||
        /^(다음|계속|next|continue)(\s*(장|파트|으로|part))?$/iu.test(label)))) {
      reject('STUDIO_LINEAR_ROUTE_REVIEW_REQUIRED');
    }
    const text = prepared.readerPartTexts?.get(part.partKey) ?? readerPartText(part.paragraphs.map(row => row.text).join(''), part.title);
    if (!text.trim()) reject('STUDIO_LINEAR_EMPTY_PART');
    return { partKey: part.partKey, title: part.title, text, label,
      nextPartKey: prepared.parts[index + 1]?.partKey ?? null };
  });
}

export function splitStudioLinearBeats(text: string): string[] {
  const chunks: string[] = [];
  const limit = 2_400;
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + limit, text.length);
    if (end < text.length) {
      const floor = offset + Math.floor(limit / 2);
      for (let cursor = end; cursor >= floor; cursor--) {
        if (/\s/u.test(text[cursor - 1])) { end = cursor; break; }
      }
      if (/[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
    }
    if (end <= offset) reject('STUDIO_LINEAR_PART_TOO_LONG');
    chunks.push(text.slice(offset, end));
    if (chunks.length > 1_000) reject('STUDIO_LINEAR_PART_TOO_LONG');
    offset = end;
  }
  return chunks;
}

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class StoryStudioLinearService {
  constructor(private readonly prisma: PrismaService,
    private readonly choices: StoryStudioChoicePreparationService) {}

  private async visualReferenceContext(ownerUserId: string, workId: string, manuscriptVersionId: string) {
    if (![workId, manuscriptVersionId].every(id => isUUID(id))) reject('STUDIO_LINEAR_INVALID_ID');
    const work = await this.prisma.storyWork.findFirst({ where: { id: workId, ownerUserId }, select: { id: true } });
    if (!work) throw new NotFoundException('Story work not found');
    const manuscript = await this.prisma.storyManuscriptVersion.findFirst({ where: {
      id: manuscriptVersionId, workId, ownerUserId } });
    if (!manuscript) throw new NotFoundException('Manuscript version not found');
    const prepared = sourceOf(manuscript);
    const source = studioManuscriptVisualReviewSource(manuscript.structuredBody, manuscript.contentHash, prepared);
    return { body: source.body, guidanceOrigin: source.guidanceOrigin,
      identity: { workId, manuscriptVersionId, manuscriptHash: manuscript.contentHash } };
  }

  async visualReferencePage(ownerUserId: string, workId: string, manuscriptVersionId: string, query: StudioVisualReferencePageDto) {
    const { body, identity, guidanceOrigin } = await this.visualReferenceContext(ownerUserId, workId, manuscriptVersionId);
    return { ...studioVisualReferencePage(body, identity, query.expectedManuscriptHash, query.expectedSourceChecksum, query.offset), guidanceOrigin };
  }

  async visualReferenceDetail(ownerUserId: string, workId: string, manuscriptVersionId: string,
    referenceIndex: number, query: StudioVisualReferenceDetailDto) {
    const { body, identity, guidanceOrigin } = await this.visualReferenceContext(ownerUserId, workId, manuscriptVersionId);
    return { ...studioVisualReferenceDetail(body, identity, query.expectedManuscriptHash, query.expectedSourceChecksum, referenceIndex, query.textOffset), guidanceOrigin };
  }

  async preview(ownerUserId: string, workId: string, manuscriptVersionId: string) {
    if (![workId, manuscriptVersionId].every(id => isUUID(id))) reject('STUDIO_LINEAR_INVALID_ID');
    const { manuscript, prepared, analysis, review, consent } = await this.context(this.prisma, ownerUserId, workId, manuscriptVersionId);
    const issues = analysis ? await this.prisma.storyContinuityIssue.findMany({ where: { workId,
      analysisJobId: analysis.id, pathScope: 'author_original', pathKey: 'author_original', status: 'open' },
      select: { severity: true, summary: true }, orderBy: { createdAt: 'asc' }, take: 1001 }) : [];
    const release = await this.prisma.storyRelease.findFirst({ where: { workId, manuscriptVersionId,
      status: 'candidate' }, orderBy: { version: 'desc' } });
    const scenes = release ? await this.scenes(this.prisma, workId) : [];
    const choiceJob = release ? await this.prisma.storyStudioChoiceJob.findUnique({ where: { releaseId: release.id },
      select: { status: true, totalParts: true, completedParts: true, errorCode: true } }) : null;
    const choiceWorkerAvailable = process.env.NODE_ENV !== 'test' &&
      process.env.STORY_STUDIO_CHOICE_WORKER_ENABLED === 'true' &&
      Boolean((process.env.STORY_CONTINUATION_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '').trim());
    const visualView = studioManuscriptVisualReviewSource(manuscript.structuredBody, manuscript.contentHash, prepared);
    const visualReference = visualView.reference;
    const visualSource = (visualView.body as Record<string, unknown>).publicationVisualSource as {
      prompts: Array<{ sourceSceneKey: string; promptText: string; promptSha256: string }>; sceneBindings?: unknown };
    return { manuscriptVersionId, manuscriptHash: manuscript.contentHash, analysisJobId: analysis?.id ?? null,
      importedVisualReferences: { ...publicationVisualReferencePreview(
        visualView.body, manuscript.contentHash, visualReference.checksum, visualSource.prompts,
        visualSource.sceneBindings), guidanceOrigin: visualView.guidanceOrigin },
      review: review ? { reviewId: review.id, state: review.state, revision: review.revision } : null,
      consent: consent ? { revision: consent.revision, active: consent.status === 'active' && consent.rightsConfirmed &&
        consent.aiBranchAllowed && consent.manuscriptVersionId === manuscriptVersionId &&
        consent.startsAt <= new Date() && (!consent.expiresAt || consent.expiresAt > new Date()) &&
        Array.isArray(consent.allowedLocales) && consent.allowedLocales.includes('ko') } : null,
      issues: issues.slice(0, 1000), issuesTruncated: issues.length > 1000,
      parts: prepared.parts.map((part, index) => ({ partKey: part.partKey, title: part.title,
        endingExcerpt: part.paragraphs.map(row => row.text).join('').trim().slice(-300),
        nextPartTitle: prepared.parts[index + 1]?.title ?? null })),
      releaseId: release?.id ?? null, ready: (release?.validationSummary as Record<string, unknown> | undefined)?.ready === true,
      scenes, choiceJob, choiceWorkerAvailable };
  }

  async materialize(ownerUserId: string, workId: string, body: MaterializeStudioLinearDto) {
    if (!isUUID(workId) || !isUUID(body.manuscriptVersionId)) reject('STUDIO_LINEAR_INVALID_ID');
    if (body.originalRoutesReviewed !== true) reject('STUDIO_LINEAR_ROUTE_REVIEW_REQUIRED');
    const { manuscript, prepared } = await this.context(this.prisma, ownerUserId, workId, body.manuscriptVersionId);
    if (body.expectedManuscriptHash !== manuscript.contentHash) reject('STUDIO_LINEAR_SOURCE_CHANGED');
    const plan = linearPartPlan(prepared, body.originalRoutes);
    const snapshot = { manuscriptVersionId: manuscript.id,
      branchGraphSnapshot: { contract: 'studio-linear-v1', parts: plan.map(part => ({
        partKey: part.partKey, originalLabel: part.label, nextPartKey: part.nextPartKey })) },
      endingSetSnapshot: { authorMain: 'author_main' },
      sceneAssetManifest: { contract: 'studio-linear-v1', visualState: 'missing' },
      localizedDisplaySnapshot: { locale: 'ko', titles: plan.map(part => part.title) } };
    const checksum = releaseChecksum(snapshot);
    try {
      return await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${workId}::uuid FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_style_profile_consents WHERE work_id = ${workId}::uuid FOR SHARE`);
      const reviewed = await this.assertReady(tx, ownerUserId, workId, manuscript.id, manuscript.contentHash);
      if (tx.storyWorkGenerationProfile) await this.choices.approvedGenerationProfile(tx, ownerUserId, workId,
        reviewed.manuscript, reviewed.analysis.id);
      const existing = await tx.storyRelease.findFirst({ where: { workId } });
      if (existing) {
        if (existing.status !== 'candidate' || existing.checksum !== checksum ||
            existing.manuscriptVersionId !== manuscript.id) reject('STUDIO_LINEAR_EXISTING_RELEASE_CONFLICT');
        const scenes = await this.scenes(tx, workId);
        if (scenes.length !== plan.length || scenes.some((scene, index) => scene.partKey !== plan[index].partKey)) {
          reject('STUDIO_LINEAR_EXISTING_GRAPH_CHANGED');
        }
        await this.prepareVisualPrompts(tx, workId, existing.id, checksum, manuscript.id, manuscript.contentHash, plan);
        await tx.storyStudioChoiceJob.upsert({ where: { releaseId: existing.id }, update: {}, create: {
          ownerUserId, workId, releaseId: existing.id, manuscriptVersionId: manuscript.id,
          totalParts: plan.length,
        } });
        return { releaseId: existing.id, scenes, idempotentReplay: true };
      }
      if (await tx.storyPart.count({ where: { workId } }) ||
          await tx.storyReaderProgress.count({ where: { workId } })) reject('STUDIO_LINEAR_EXISTING_GRAPH_CONFLICT');
      const release = await tx.storyRelease.create({ data: {
        workId, version: 1, manuscriptVersionId: manuscript.id, status: 'candidate',
        branchGraphSnapshot: snapshot.branchGraphSnapshot,
        endingSetSnapshot: snapshot.endingSetSnapshot,
        sceneAssetManifest: snapshot.sceneAssetManifest,
        localizedDisplaySnapshot: snapshot.localizedDisplaySnapshot,
        checksum, validationSummary: { ready: false, blockingIssueCount: 1,
          reason: 'studio_choices_not_prepared' }, createdByUserId: ownerUserId,
      } });
      const partRows = plan.map((part, index) => ({ id: randomUUID(), workId, position: index + 1,
        status: 'draft', title: { ko: part.title }, fixtureSource: false }));
      const sceneRows = plan.map((part, index) => ({ id: randomUUID(), partId: partRows[index].id,
        sceneKey: `${part.partKey}-main`, position: 1, status: 'draft', title: { ko: part.title },
        fixtureSource: false, visualManifest: missingAuthoredSceneVisual(`${part.partKey}-main`) }));
      await tx.storyPart.createMany({ data: partRows });
      await tx.storyScene.createMany({ data: sceneRows });
      await this.prepareVisualPrompts(tx, workId, release.id, checksum, manuscript.id, manuscript.contentHash, plan);
      const beats = plan.flatMap((part, index) => {
        const rows = [] as Array<{ sceneId: string; position: number; beatType: string; content: { ko: string } }>;
        for (const text of splitStudioLinearBeats(part.text)) rows.push({
          sceneId: sceneRows[index].id, position: rows.length + 1,
          beatType: 'narration', content: { ko: text },
        });
        return rows;
      });
      for (let index = 0; index < beats.length; index += 256) {
        await tx.storyBeat.createMany({ data: beats.slice(index, index + 256) });
      }
      await tx.storyChoice.createMany({ data: plan.map((part, index) => ({
        sceneId: sceneRows[index].id, choiceKey: 'author-original', position: 1, label: { ko: part.label },
        routeKind: 'writer_original', targetSceneId: sceneRows[index + 1]?.id ?? null,
        targetEndingKey: index === plan.length - 1 ? 'author_main' : null,
      })) });
      await tx.storyStudioChoiceJob.create({ data: { ownerUserId, workId, releaseId: release.id,
        manuscriptVersionId: manuscript.id, totalParts: plan.length } });
      await tx.auditEvent.create({ data: { actorUserId: ownerUserId, actorType: 'user',
        action: 'story_studio_linear.private_materialized', targetType: 'story_work', targetId: workId,
        metadata: { releaseId: release.id, manuscriptHash: manuscript.contentHash,
          partCount: plan.length, publishReady: false } } });
      return { releaseId: release.id, scenes: plan.map((part, index) => ({
        partKey: part.partKey, sceneId: sceneRows[index].id, choiceCount: 1,
        originalLabel: part.label })), idempotentReplay: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 60000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({ code: 'STUDIO_LINEAR_MATERIALIZATION_FAILED',
        message: 'Private manuscript materialization could not be confirmed' });
    }
  }

  async finish(ownerUserId: string, workId: string, releaseId: string) {
    if (![workId, releaseId].every(id => isUUID(id))) reject('STUDIO_LINEAR_INVALID_ID');
    try {
      return await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${workId}::uuid FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_style_profile_consents WHERE work_id = ${workId}::uuid FOR SHARE`);
      const release = await tx.storyRelease.findFirst({ where: { id: releaseId, workId, status: 'candidate' } });
      if (!release) reject('STUDIO_LINEAR_CANDIDATE_REQUIRED');
      await this.assertReady(tx, ownerUserId, workId, release.manuscriptVersionId);
      await this.choices.assertPublishableTx(tx, workId, ownerUserId, release.manuscriptVersionId, releaseId);
      await tx.storyRelease.update({ where: { id: releaseId },
        data: { validationSummary: { ready: true, blockingIssueCount: 0,
          source: 'studio-reviewed-linear-choices-v1' } } });
      return { releaseId, ready: true, published: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 60000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({ code: 'STUDIO_LINEAR_FINAL_VALIDATION_FAILED',
        message: 'Choice validation could not be confirmed; the release remains private' });
    }
  }

  private async context(db: Db, ownerUserId: string, workId: string, manuscriptVersionId: string) {
    const work = await db.storyWork.findFirst({ where: { id: workId, ownerUserId } });
    if (!work) throw new NotFoundException('Story work not found');
    const manuscript = await db.storyManuscriptVersion.findFirst({ where: {
      id: manuscriptVersionId, workId, ownerUserId } });
    if (!manuscript) throw new NotFoundException('Manuscript version not found');
    const prepared = sourceOf(manuscript);
    const [analysis, review, consent] = await Promise.all([
      db.storyAnalysisJob.findFirst({ where: { workId, manuscriptVersionId, status: 'completed',
        pipeline: 'semantic_extraction_v1' },
        orderBy: { analysisVersion: 'desc' } }),
      db.storyWriterReview.findFirst({ where: { workId, ownerUserId, manuscriptVersionId },
        orderBy: { updatedAt: 'desc' } }),
      db.storyStyleProfileConsent.findUnique({ where: { workId } }),
    ]);
    return { work, manuscript, prepared, analysis, review, consent };
  }

  private async assertReady(db: Db, ownerUserId: string, workId: string, manuscriptVersionId: string,
    contentHash?: string) {
    const { work, manuscript, analysis, review, consent } = await this.context(db, ownerUserId, workId, manuscriptVersionId);
    if (work.status === 'published' || work.activeReleaseId || work.publishedAt || work.fixtureSource ||
        await db.storyAuthoredImport.findUnique({ where: { workId } })) reject('STUDIO_LINEAR_PRIVATE_WORK_REQUIRED');
    const submission = review ? await db.storyFinalSubmission.findUnique({ where: { reviewId: review.id } }) : null;
    if (!analysis || analysis.sourceContentHash !== manuscript.contentHash || analysis.sourceLocale !== 'ko' ||
        analysis.totalParagraphs < 1 || analysis.completedParagraphs !== analysis.totalParagraphs ||
        !review || review.state !== 'submitted' || review.analysisJobId !== analysis.id ||
        !submission || submission.status !== 'submitted' || submission.checksum !== manuscript.contentHash ||
        (contentHash && contentHash !== manuscript.contentHash)) reject('STUDIO_LINEAR_FINAL_REVIEW_REQUIRED');
    const issues = await db.storyContinuityIssue.findMany({ where: { workId, analysisJobId: analysis.id,
      pathScope: 'author_original', pathKey: 'author_original', status: 'open' }, select: { severity: true } });
    const decisions = review.decisions as Record<string, unknown>;
    if (issues.length > 1000 || issues.some(issue => issue.severity === 'critical') ||
        (issues.some(issue => issue.severity === 'warning') && decisions?.warningAcknowledged !== true)) {
      reject('STUDIO_LINEAR_CONTINUITY_REVIEW_REQUIRED');
    }
    const now = new Date();
    if (!consent || consent.ownerUserId !== ownerUserId || consent.manuscriptVersionId !== manuscriptVersionId ||
        consent.status !== 'active' || !consent.rightsConfirmed || !consent.aiBranchAllowed ||
        consent.startsAt > now || (consent.expiresAt && consent.expiresAt <= now) ||
        !Array.isArray(consent.allowedLocales) || !consent.allowedLocales.includes('ko')) {
      reject('STUDIO_LINEAR_AI_RIGHTS_CONSENT_REQUIRED');
    }
    return { manuscript, analysis };
  }

  private async prepareVisualPrompts(tx: Prisma.TransactionClient, workId: string, releaseId: string,
    checksum: string, manuscriptId: string, manuscriptHash: string, parts: ReturnType<typeof linearPartPlan>) {
    const planned = parts.map(part => {
      const promptText = studioSceneVisualPrompt(part.title, part.text);
      return { workId, releaseId, releaseChecksum: checksum, sourceSceneKey: `${part.partKey}-main`,
        promptText, promptSha256: createHash('sha256').update(promptText).digest('hex'), sourceKind: 'studio_reviewed',
        sourceBindingSha256: releaseChecksum({ manuscriptId, manuscriptHash, partKey: part.partKey,
          textSha256: createHash('sha256').update(part.text).digest('hex') }) };
    });
    const stored = await tx.storyVisualPrompt.findMany({ where: { workId, releaseId,
      sourceSceneKey: { in: planned.map(item => item.sourceSceneKey) } } });
    const byKey = new Map(stored.map(item => [item.sourceSceneKey, item]));
    for (const item of planned) {
      const previous = byKey.get(item.sourceSceneKey);
      if (previous && (previous.releaseChecksum !== item.releaseChecksum || previous.promptSha256 !== item.promptSha256 ||
          previous.promptText !== item.promptText || previous.sourceKind !== item.sourceKind ||
          previous.sourceBindingSha256 !== item.sourceBindingSha256)) reject('STUDIO_LINEAR_VISUAL_SOURCE_CHANGED');
    }
    const missing = planned.filter(item => !byKey.has(item.sourceSceneKey));
    for (let index = 0; index < missing.length; index += 128) {
      await tx.storyVisualPrompt.createMany({ data: missing.slice(index, index + 128) });
    }
  }

  private async scenes(db: Db, workId: string) {
    const parts = await db.storyPart.findMany({ where: { workId, fixtureSource: false }, orderBy: { position: 'asc' } });
    if (!parts.length) return [];
    const scenes = await db.storyScene.findMany({ where: { partId: { in: parts.map(part => part.id) },
      status: 'draft', fixtureSource: false },
      select: { id: true, partId: true, sceneKey: true }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
    const choices = await db.storyChoice.findMany({ where: { sceneId: { in: scenes.map(scene => scene.id) } },
      select: { sceneId: true, position: true, label: true }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
    const sceneByPart = new Map<string, (typeof scenes)[number]>();
    for (const scene of scenes) {
      if (sceneByPart.has(scene.partId) || !scene.sceneKey.endsWith('-main'))
        reject('STUDIO_LINEAR_EXISTING_GRAPH_CHANGED');
      sceneByPart.set(scene.partId, scene);
    }
    const choicesByScene = new Map<string, (typeof choices)>();
    for (const choice of choices) {
      const rows = choicesByScene.get(choice.sceneId) ?? [];
      rows.push(choice);
      choicesByScene.set(choice.sceneId, rows);
    }
    const result = [] as Array<{ partKey: string; sceneId: string; choiceCount: number; originalLabel: string | null }>;
    for (const part of parts) {
      const scene = sceneByPart.get(part.id);
      if (!scene) reject('STUDIO_LINEAR_EXISTING_GRAPH_CHANGED');
      const sceneChoices = choicesByScene.get(scene.id) ?? [];
      const label = sceneChoices.find(choice => choice.position === 1)?.label as Record<string, unknown> | undefined;
      result.push({ partKey: scene.sceneKey.slice(0, -5), sceneId: scene.id,
        choiceCount: sceneChoices.length, originalLabel: typeof label?.ko === 'string' ? label.ko : null });
    }
    return result;
  }
}

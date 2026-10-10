import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { StoryLocaleQueryDto } from './dto/story-production.dto';
import { STORY_LOCALES } from './story-production.policy';
import { canonicalEndingPosition } from './story-canonical-ending.store';
import { authoredPartContinuationLengthBounds } from './story-continuation-author-length.store';
import { inspectStoryContinuationFixedCapNarrative } from './story-continuation-fixed-cap-narrative-check';

type AuthorBodyPreview = {
  contract: 'story-author-body-preview-v1'; workId: string; locale: string;
  readOnly: true; imageGenerationStarted: false;
  progress: {
    progressId: string; revision: number; status: string; storyVersion: number;
    currentBeatPosition: number;
    scene: { id: string; isGenerated: boolean; title: string; endingType: string | null;
      beats: Array<{ id: string; position: number; type: string; content: string }> } | null;
    choices: Array<{ id: string; label: string; routeKind: string }>;
  } | null;
};

const MAX_RESPONSE_BYTES = 256 * 1024;
const beatSelect = { id: true, position: true, beatType: true, content: true } as const;
const choiceSelect = { id: true, position: true, label: true, routeKind: true } as const;

@Injectable()
export class StoryAuthorBodyPreviewService {
  constructor(private readonly prisma: PrismaService) {}

  private changed(code = 'STORY_AUTHOR_BODY_PREVIEW_CHANGED'): never {
    throw new ConflictException({ code });
  }

  private text(value: unknown, locale: string, maxLength: number) {
    const record: Record<string, unknown> = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : {};
    const text: unknown = record[locale];
    if (text === undefined) this.changed('STORY_AUTHOR_BODY_PREVIEW_TRANSLATION_UNAVAILABLE');
    if (typeof text !== 'string' || !text.trim() || text.length > maxLength || text.includes('\0') ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) this.changed();
    return text;
  }

  private orderedRows(rows: Array<{ id: string; position: number }>, limit: number, required: boolean) {
    if ((required && !rows.length) || rows.length > limit ||
      new Set(rows.map(row => row.id)).size !== rows.length ||
      rows.some((row, index) => !isUUID(row.id) || !Number.isSafeInteger(row.position) ||
        row.position < 1 || row.position > limit || (index > 0 && row.position <= rows[index - 1].position))) {
      this.changed();
    }
  }

  async preview(userId: string, workId: string, query: StoryLocaleQueryDto) {
    return this.readCurrentSnapshot(userId, workId, query, async (_db, body) => body);
  }

  async lengthDiagnostic(userId: string, workId: string, query: StoryLocaleQueryDto) {
    return this.readCurrentSnapshot(userId, workId, query, async (db, body, partId) => {
      if (body.progress && (!Number.isSafeInteger(body.progress.revision) || body.progress.revision < 0)) {
        this.changed();
      }
      const envelope = {
        contract: 'story-author-body-length-v1' as const, locale: body.locale,
        readOnly: true as const, referenceScope: 'current_published_original_part' as const,
        progressRevision: body.progress?.revision ?? null,
        currentApprovalVerified: false as const, semanticQualityVerified: false as const,
        dispatchAuthorized: false as const, providerCalls: 0 as const, operatingWrites: 0 as const,
      };
      if (!body.progress?.scene) {
        return { ...envelope, outcome: 'no_saved_body' as const, diagnostic: null };
      }
      if (!body.progress.scene.isGenerated || !partId) {
        return { ...envelope, outcome: 'canonical_body_only' as const, diagnostic: null };
      }
      let bounds;
      try {
        bounds = await authoredPartContinuationLengthBounds(db, partId, body.locale);
      } catch {
        return { ...envelope, outcome: 'original_reference_unavailable' as const, diagnostic: null };
      }
      const diagnostic = inspectStoryContinuationFixedCapNarrative({
        locale: body.locale,
        beats: body.progress.scene.beats.map(beat => ({
          beatType: beat.type, content: { [body.locale]: beat.content },
        })),
      }, bounds);
      return { ...envelope, outcome: 'generated_body_checked' as const, diagnostic };
    });
  }

  private async readCurrentSnapshot<T>(userId: string, workId: string, query: StoryLocaleQueryDto,
    project: (db: Prisma.TransactionClient, body: AuthorBodyPreview, partId: string | null) => Promise<T>) {
    const locale = query?.locale;
    if (!isUUID(userId) || !isUUID(workId) || !STORY_LOCALES.includes(locale as typeof STORY_LOCALES[number])) {
      throw new BadRequestException({ code: 'STORY_AUTHOR_BODY_PREVIEW_INPUT_INVALID' });
    }
    userId = userId.toLowerCase();
    workId = workId.toLowerCase();
    // Public projections can repair image prompts. This separate read-only transaction cannot do so.
    return this.prisma.$transaction(async db => {
      await db.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
      const work = await db.storyWork.findFirst({ where: { id: workId, ownerUserId: userId,
        status: 'published', fixtureSource: false },
      select: { id: true, ownerUserId: true, activeReleaseId: true, publishedVersion: true } });
      if (!work) throw new NotFoundException({ code: 'STORY_AUTHOR_BODY_PREVIEW_UNAVAILABLE' });
      const progress = await db.storyReaderProgress.findUnique({ where: { userId_workId: { userId, workId } },
        select: { id: true, userId: true, workId: true, activeReleaseId: true, storyVersion: true,
          progressRevision: true, status: true, currentSceneId: true, currentGeneratedSceneId: true,
          routeNodeId: true, pathSummary: true, currentBeatPosition: true } });
      const envelope = { contract: 'story-author-body-preview-v1' as const, workId, locale,
        readOnly: true as const, imageGenerationStarted: false as const };
      if (!progress) return project(db, { ...envelope, progress: null }, null);
      if (work.ownerUserId !== userId || progress.userId !== userId || progress.workId !== workId ||
        !work.activeReleaseId || progress.activeReleaseId !== work.activeReleaseId ||
        progress.storyVersion !== work.publishedVersion || !['active', 'ai_pending', 'completed'].includes(progress.status) ||
        (progress.currentSceneId && progress.currentGeneratedSceneId)) this.changed();
      const release = await db.storyRelease.findFirst({ where: { id: work.activeReleaseId!, workId, status: 'active' },
        select: { id: true, version: true } });
      if (!release || release.version !== progress.storyVersion) this.changed();
      const state = { progressId: progress.id, revision: progress.progressRevision, status: progress.status,
        storyVersion: progress.storyVersion, currentBeatPosition: progress.currentBeatPosition };
      let currentSceneId = progress.currentSceneId;
      if (!currentSceneId && !progress.currentGeneratedSceneId) {
        currentSceneId = (await canonicalEndingPosition(db, progress, true))?.sceneId ?? null;
      }
      if (!currentSceneId && !progress.currentGeneratedSceneId) {
        return project(db, { ...envelope, progress: { ...state, scene: null, choices: [] } }, null);
      }
      const generated = Boolean(progress.currentGeneratedSceneId);
      const scene = generated
        ? await db.storyAiGeneratedScene.findFirst({ where: { id: progress.currentGeneratedSceneId!,
          userId, workId, progressId: progress.id, releaseId: release.id, status: 'ready' },
        select: { id: true, sourcePartId: true, continuationId: true, title: true, endingType: true } })
        : await db.storyScene.findFirst({ where: { id: currentSceneId!, status: 'published', fixtureSource: false },
          select: { id: true, partId: true, title: true, endingType: true } });
      if (!scene) this.changed();
      const partId = 'sourcePartId' in scene ? scene.sourcePartId : scene.partId;
      const part = await db.storyPart.findFirst({ where: { id: partId, workId, status: 'published', fixtureSource: false },
        select: { id: true } });
      if (!part) this.changed();
      if ('continuationId' in scene) {
        const origin = await db.storyAiContinuation.findFirst({ where: { id: scene.continuationId,
          userId, workId, progressId: progress.id, releaseId: release.id, status: 'completed', resultGeneratedSceneId: scene.id },
        select: { id: true } });
        if (!origin) this.changed();
      }
      const beats = generated
        ? await db.storyAiGeneratedBeat.findMany({ where: { sceneId: scene.id }, orderBy: [{ position: 'asc' }, { id: 'asc' }],
          take: 41, select: beatSelect })
        : await db.storyBeat.findMany({ where: { sceneId: scene.id }, orderBy: [{ position: 'asc' }, { id: 'asc' }],
          take: 41, select: beatSelect });
      const choices = progress.status === 'completed' ? [] : generated
        ? await db.storyAiGeneratedChoice.findMany({ where: { sceneId: scene.id, position: { gt: 0 } },
          orderBy: [{ position: 'asc' }, { id: 'asc' }], take: 4, select: choiceSelect })
        : await db.storyChoice.findMany({ where: { sceneId: scene.id, position: { gt: 0 } },
          orderBy: [{ position: 'asc' }, { id: 'asc' }], take: 4, select: choiceSelect });
      this.orderedRows(beats, 40, true);
      this.orderedRows(choices, 3, false);
      const response = { ...envelope, progress: { ...state,
        scene: { id: scene.id, isGenerated: generated, title: this.text(scene.title, locale, 1000),
          endingType: scene.endingType,
          beats: beats.map(beat => {
            if (!beat.beatType || beat.beatType.length > 64) this.changed();
            return { id: beat.id, position: beat.position, type: beat.beatType,
              content: this.text(beat.content, locale, 64000) };
          }) },
        choices: choices.map(choice => {
          if (!choice.routeKind || choice.routeKind.length > 64) this.changed();
          return { id: choice.id, label: this.text(choice.label, locale, 1000), routeKind: choice.routeKind };
        }) } };
      if (Buffer.byteLength(JSON.stringify(response), 'utf8') > MAX_RESPONSE_BYTES) this.changed();
      return project(db, response, partId);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}

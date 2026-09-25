import {
  BadRequestException,
  BeforeApplicationShutdown,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, createHmac } from 'crypto';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import * as sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { StoryUploadStorageService } from '../story-upload/story-upload-storage.service';
import type {
  RegisterStoryVisualAiBranchPromptDto,
  RegisterStoryVisualPromptsDto,
  ReplaceStaleStoryVisualDto,
} from './dto/story-visual-generation.dto';
import { StoryPublicBetaPolicy } from './story-public-beta.policy';
import type { StoryContinuationProviderResult } from './story-continuation.provider';
import { buildStoryVisualBible, composeStoryVisualPrompt, type StoryVisualBible } from './story-visual-bible';
import { FIXED_ROUTE_STORIES } from './story-fixed-route-markdown.policy';
import {
  continuationGenerationProfileSnapshot,
  parseContinuationGenerationProfilePin,
  stableContinuationJson,
} from './story-continuation-context.policy';
import { StoryVisualGenerationQueue } from './story-visual-generation.queue';
import { StoryVisualGenerationWorker } from './story-visual-generation.worker';
import {
  StoryArtistParticipantService,
  type StoryParticipantVisualReference,
} from './story-artist-participant.service';

const SOURCE_SCENE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_GENERATION_ATTEMPTS = 1;
const IMAGE_REQUEST_CONTRACT_VERSION = 'openai-image-request-v5';
const IMAGE_MODELS = new Set(['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1-mini']);
const IMAGE_QUALITIES = new Set(['low', 'medium', 'high']);
const IMAGE_SIZES = new Map([
  ['1024x1024', { width: 1024, height: 1024 }],
  ['1536x1024', { width: 1536, height: 1024 }],
  ['1024x1536', { width: 1024, height: 1536 }],
]);

type ReadyVisual = {
  sourceSceneKey: string;
  publicAssetPath: string;
};

type StoryVisualVariant = {
  key: string;
  participantFingerprint: string | null;
  references: StoryParticipantVisualReference[];
};

type StoryWorkVisualReference = {
  image: Buffer;
  checksum: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  filename: string;
};

const DEFAULT_VISUAL_VARIANT: StoryVisualVariant = {
  key: 'default',
  participantFingerprint: null,
  references: [],
};

const APPROVED_STORY_COVERS = new Map<string, string>([
  ['records-of-the-burning-sea-imjin-war', '/assets/story/imjin-war-cover.webp'],
  ['norse-myth-loki-crossroads', '/assets/story/norse-myth-cover.webp'],
  ...Object.values(FIXED_ROUTE_STORIES).map((story): [string, string] => [story.slug, story.coverPath]),
]);

@Injectable()
export class StoryVisualGenerationService implements OnApplicationBootstrap, OnModuleDestroy, BeforeApplicationShutdown {
  private readonly logger = new Logger(StoryVisualGenerationService.name);
  private readonly queue: StoryVisualGenerationQueue;
  private readonly worker: StoryVisualGenerationWorker;
  private readonly visualBibleCache = new Map<string, StoryVisualBible>();
  private readonly workVisualReferenceCache = new Map<string, StoryWorkVisualReference | null>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Optional() private readonly publicBeta?: StoryPublicBetaPolicy,
    @Optional() private readonly storyParticipants?: StoryArtistParticipantService,
    @Optional() private readonly storage?: StoryUploadStorageService,
  ) {
    this.queue = new StoryVisualGenerationQueue(prisma, config);
    this.worker = new StoryVisualGenerationWorker({ executeOne: signal => this.executeQueuedVisual(signal) }, config);
  }

  onApplicationBootstrap() {
    this.worker.onApplicationBootstrap();
  }

  onModuleDestroy() {
    return this.worker.onModuleDestroy();
  }

  beforeApplicationShutdown() {
    return this.worker.beforeApplicationShutdown();
  }

  async readyVisuals(
    workId: string,
    releaseId: string,
    sourceSceneKeys: string[],
    variantKey = DEFAULT_VISUAL_VARIANT.key,
  ) {
    const keys = [...new Set(sourceSceneKeys.filter(key => SOURCE_SCENE_KEY.test(key)))];
    if (!keys.length) return new Map<string, ReadyVisual>();
    const rows = await this.prisma.storyVisualGeneration.findMany({
      where: { workId, releaseId, sourceSceneKey: { in: keys }, variantKey, status: 'ready', assetId: { not: null } },
      select: { sourceSceneKey: true, assetId: true },
    });
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: rows.map(row => row.assetId).filter((id): id is string => Boolean(id)) },
        assetType: 'image', visibility: 'public', mimeType: 'image/webp', checksum: { not: null } },
      select: { id: true, metadata: true },
    });
    const activeAssetIds = new Set(assets.filter(asset => {
      const metadata = this.record(asset.metadata);
      const lifecycle = this.record(metadata.lifecycle);
      return lifecycle.status !== 'archived';
    }).map(asset => asset.id));
    return new Map(rows.flatMap(row => row.assetId && activeAssetIds.has(row.assetId) ? [[row.sourceSceneKey, {
      sourceSceneKey: row.sourceSceneKey,
      publicAssetPath: this.publicAssetPath(row.assetId),
    }] as const] : []));
  }

  async variantKeyForProgress(progressId: string) {
    return (await this.visualVariantForProgress(progressId)).key;
  }

  async publicVisualAsset(assetId: string) {
    if (!UUID_PATTERN.test(assetId)) throw new BadRequestException('assetId must be a UUID');
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, assetType: 'image', visibility: 'public', mimeType: 'image/webp' },
      select: { id: true, storageProvider: true, mimeType: true, fileSizeBytes: true, checksum: true, metadata: true },
    });
    if (!asset) throw new NotFoundException('Story visual not found');
    const metadata = this.record(asset.metadata);
    const storyVisual = this.record(metadata.storyVisual);
    if (!storyVisual.workId || !storyVisual.sourceSceneKey) throw new NotFoundException('Story visual not found');
    if (asset.storageProvider !== 'database') {
      return { kind: 'redirect', url: `/api/v1/assets/public/${asset.id}/original` } as const;
    }
    const inlineImage = this.record(storyVisual.inlineImage);
    if (inlineImage.encoding !== 'base64' || typeof inlineImage.data !== 'string' ||
        inlineImage.data.length > 24 * 1024 * 1024) throw new NotFoundException('Story visual not found');
    const image = Buffer.from(inlineImage.data, 'base64');
    if (image.length < 1024 || image.length > 16 * 1024 * 1024 ||
        image.toString('ascii', 0, 4) !== 'RIFF' || image.toString('ascii', 8, 12) !== 'WEBP' ||
        !asset.checksum || this.sha256Hex(image) !== asset.checksum) {
      throw new NotFoundException('Story visual not found');
    }
    return { kind: 'inline', mimeType: asset.mimeType, image } as const;
  }

  async promptKeys(workId: string, releaseId: string, sourceSceneKeys: string[]) {
    const keys = [...new Set(sourceSceneKeys.filter(key => SOURCE_SCENE_KEY.test(key)))];
    if (!keys.length) return new Set<string>();
    const rows = await this.prisma.storyVisualPrompt.findMany({
      where: { workId, releaseId, sourceSceneKey: { in: keys } },
      select: { sourceSceneKey: true },
    });
    const present = new Set(rows.map(row => row.sourceSceneKey));
    for (const sourceSceneKey of keys) {
      if (present.has(sourceSceneKey) || !sourceSceneKey.startsWith('ai-') ||
          !UUID_PATTERN.test(sourceSceneKey.slice(3))) continue;
      try {
        const scene = await this.prisma.storyAiGeneratedScene.findFirst({
          where: { workId, releaseId, sceneKey: sourceSceneKey, status: 'ready' },
          select: { id: true },
        });
        if (!scene) continue;
        await this.recoverGeneratedContinuationPrompt(scene.id);
        const prompt = await this.prisma.storyVisualPrompt.findUnique({
          where: { workId_releaseId_sourceSceneKey: { workId, releaseId, sourceSceneKey } },
          select: { id: true },
        });
        if (prompt) present.add(sourceSceneKey);
        else this.logger.warn({ event: 'story_visual_prompt_recovery_failed', workId, sourceSceneKey,
          code: 'PROMPT_STILL_MISSING' });
      } catch (error) {
        this.logger.warn({ event: 'story_visual_prompt_recovery_failed', workId, sourceSceneKey,
          code: this.promptRegistrationErrorCode(error) });
      }
    }
    return present;
  }

  async requestForProgress(userId: string, progressId: string, sourceSceneKey: string) {
    if (!SOURCE_SCENE_KEY.test(sourceSceneKey)) throw new BadRequestException('Invalid story visual key');
    const progress = await this.prisma.storyReaderProgress.findFirst({
      where: { id: progressId, userId, status: 'active' },
      select: { workId: true, currentSceneId: true, currentGeneratedSceneId: true, activeReleaseId: true },
    });
    if (!progress?.activeReleaseId || (!progress.currentSceneId && !progress.currentGeneratedSceneId)) {
      throw new NotFoundException('Active story progress not found');
    }
    const work = await this.prisma.storyWork.findFirst({
      where: { id: progress.workId, status: 'published', fixtureSource: false, activeReleaseId: progress.activeReleaseId },
      select: { id: true, activeReleaseId: true },
    });
    if (!work) throw new NotFoundException('Published story scene not found');
    let generatedSceneId: string | null = null;
    if (progress.currentGeneratedSceneId) {
      const generatedScene = await this.prisma.storyAiGeneratedScene.findFirst({
        where: {
          id: progress.currentGeneratedSceneId,
          progressId,
          userId,
          workId: progress.workId,
          releaseId: progress.activeReleaseId,
          sceneKey: sourceSceneKey,
          status: 'ready',
        },
        select: { id: true },
      });
      if (!generatedScene) throw new NotFoundException('Story visual is outside current scene');
      generatedSceneId = generatedScene.id;
    } else {
      const scene = await this.prisma.storyScene.findFirst({
        where: { id: progress.currentSceneId!, status: 'published', fixtureSource: false },
        select: { id: true, sceneKey: true, partId: true },
      });
      const part = scene ? await this.prisma.storyPart.findFirst({
        where: { id: scene.partId, workId: progress.workId, status: 'published', fixtureSource: false },
        select: { id: true },
      }) : null;
      if (!scene || !part) throw new NotFoundException('Published story scene not found');
      const isCanonicalScene = scene.sceneKey === sourceSceneKey;
      const authoredBeat = isCanonicalScene ? null : await this.prisma.storyBeat.findFirst({
        where: { sceneId: scene.id, sourceSceneKey },
        select: { id: true },
      });
      if (!isCanonicalScene && !authoredBeat) throw new NotFoundException('Story visual is outside current scene');
    }
    const release = await this.prisma.storyRelease.findFirst({
      where: { id: progress.activeReleaseId, workId: progress.workId, status: 'active' },
      select: { id: true, checksum: true },
    });
    if (!release) throw new NotFoundException('Active story release not found');
    this.publicBeta?.assertAllowed(progress.workId, release.id, release.checksum);
    if (generatedSceneId) {
      const prompt = await this.prisma.storyVisualPrompt.findUnique({
        where: { workId_releaseId_sourceSceneKey: {
          workId: progress.workId, releaseId: release.id, sourceSceneKey,
        } },
        select: { id: true },
      });
      if (!prompt) {
        try {
          await this.recoverGeneratedContinuationPrompt(generatedSceneId);
        } catch (error) {
          this.logger.warn({ event: 'story_visual_prompt_recovery_failed',
            workId: progress.workId, sourceSceneKey,
            code: error instanceof ConflictException ? 'PROFILE_OR_RELEASE_CHANGED' : 'PROMPT_RECOVERY_FAILED' });
          return { status: 'unavailable', reason: 'prompt_recovery_failed' } as const;
        }
      }
    }
    const variant = await this.visualVariantForProgress(progressId);
    return this.generate(progress.workId, release.id, release.checksum, sourceSceneKey, undefined, false, variant);
  }

  private async recoverGeneratedContinuationPrompt(generatedSceneId: string) {
    const scene = await this.prisma.storyAiGeneratedScene.findFirst({
      where: { id: generatedSceneId, status: 'ready' },
      select: { id: true, continuationId: true, title: true },
    });
    if (!scene) throw new NotFoundException('Generated story scene not found');
    const beats = await this.prisma.storyAiGeneratedBeat.findMany({
      where: { sceneId: scene.id }, orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { beatType: true, content: true },
    });
    return this.registerGeneratedContinuationPrompt(scene.continuationId, {
      title: scene.title as Record<string, string>,
      beats: beats as Array<{ beatType: 'paragraph' | 'dialogue' | 'scene_break'; content: Record<string, string> }>,
    });
  }

  async replaceStale(workId: string, input: ReplaceStaleStoryVisualDto) {
    if (!UUID_PATTERN.test(workId)) throw new BadRequestException('workId must be a UUID');
    const work = await this.prisma.storyWork.findFirst({
      where: { id: workId, status: 'published', fixtureSource: false, activeReleaseId: input.releaseId },
      select: { id: true },
    });
    const release = work ? await this.prisma.storyRelease.findFirst({
      where: { id: input.releaseId, workId, status: 'active', checksum: input.releaseChecksum },
      select: { id: true, checksum: true },
    }) : null;
    if (!work || !release) throw new NotFoundException('Active story release not found');
    this.publicBeta?.assertAllowed(workId, release.id, release.checksum);
    const existing = await this.prisma.storyVisualGeneration.findUnique({
      where: { workId_releaseId_sourceSceneKey_variantKey: {
        workId, releaseId: release.id, sourceSceneKey: input.sourceSceneKey, variantKey: DEFAULT_VISUAL_VARIANT.key,
      } },
      select: { status: true, assetId: true },
    });
    if (existing?.status !== 'ready' || !existing.assetId) {
      throw new ConflictException({
        code: 'STORY_VISUAL_REPLACEMENT_NOT_READY',
        message: 'Only an existing ready story visual can be replaced',
      });
    }
    return this.generate(workId, release.id, release.checksum, input.sourceSceneKey, undefined, true);
  }

  async replacementStatus(workId: string) {
    if (!UUID_PATTERN.test(workId)) throw new BadRequestException('workId must be a UUID');
    const work = await this.prisma.storyWork.findFirst({
      where: { id: workId, status: 'published', fixtureSource: false, activeReleaseId: { not: null } },
      select: { id: true, activeReleaseId: true },
    });
    const release = work?.activeReleaseId ? await this.prisma.storyRelease.findFirst({
      where: { id: work.activeReleaseId, workId, status: 'active' },
      select: { id: true, checksum: true },
    }) : null;
    if (!work || !release) throw new NotFoundException('Active story release not found');
    this.publicBeta?.assertAllowed(workId, release.id, release.checksum);

    const ready = await this.prisma.storyVisualGeneration.findMany({
      where: {
        workId,
        releaseId: release.id,
        variantKey: DEFAULT_VISUAL_VARIANT.key,
        status: 'ready',
        assetId: { not: null },
      },
      orderBy: [{ updatedAt: 'desc' }, { sourceSceneKey: 'asc' }],
      take: 80,
      select: { sourceSceneKey: true, assetId: true, updatedAt: true },
    });
    const stale: Array<{ sourceSceneKey: string; updatedAt: Date }> = [];
    for (const row of ready) {
      if (!row.assetId) continue;
      const prompt = await this.prisma.storyVisualPrompt.findUnique({
        where: { workId_releaseId_sourceSceneKey: {
          workId, releaseId: release.id, sourceSceneKey: row.sourceSceneKey,
        } },
      });
      if (!prompt || prompt.releaseChecksum !== release.checksum) continue;
      const effective = await this.effectiveVisualPrompt(workId, release.id, release.checksum, prompt.promptText);
      const identity = await this.readyAssetIdentity(row.assetId);
      if (!this.visualIdentityCurrent(identity, effective)) {
        stale.push({ sourceSceneKey: row.sourceSceneKey, updatedAt: row.updatedAt });
      }
    }
    return {
      workId,
      releaseId: release.id,
      releaseChecksum: release.checksum,
      readyCount: ready.length,
      staleCount: stale.length,
      items: stale,
    };
  }

  async generateSample(workId: string, input: ReplaceStaleStoryVisualDto) {
    if (!UUID_PATTERN.test(workId)) throw new BadRequestException('workId must be a UUID');
    const work = await this.prisma.storyWork.findFirst({
      where: { id: workId, status: 'published', fixtureSource: false, activeReleaseId: input.releaseId },
      select: { id: true },
    });
    const release = work ? await this.prisma.storyRelease.findFirst({
      where: { id: input.releaseId, workId, status: 'active', checksum: input.releaseChecksum },
      select: { id: true, checksum: true },
    }) : null;
    if (!work || !release) throw new NotFoundException('Active story release not found');
    this.publicBeta?.assertAllowed(workId, release.id, release.checksum);
    return this.generate(workId, release.id, release.checksum, input.sourceSceneKey);
  }

  async registerVerifiedPrompts(workId: string, input: RegisterStoryVisualPromptsDto) {
    const work = await this.prisma.storyWork.findFirst({
      where: { id: workId, fixtureSource: false },
      select: { id: true },
    });
    if (!work) throw new NotFoundException('Story work not found');
    const release = await this.prisma.storyRelease.findFirst({
      where: { id: input.releaseId, workId },
      select: { id: true, checksum: true },
    });
    if (!release || release.checksum !== input.releaseChecksum) {
      throw new ConflictException({ code: 'STORY_VISUAL_RELEASE_CHANGED', message: 'Story release binding changed' });
    }
    const normalized = input.prompts.map(item => ({
      sourceSceneKey: item.sourceSceneKey,
      promptText: item.promptText.trim(),
      promptSha256: this.sha256Hex(item.promptText.trim()),
    })).sort((left, right) => left.sourceSceneKey.localeCompare(right.sourceSceneKey));
    if (new Set(normalized.map(item => item.sourceSceneKey)).size !== normalized.length) {
      throw new ConflictException({ code: 'STORY_VISUAL_PROMPT_DUPLICATE', message: 'Duplicate visual prompt key' });
    }
    const promptSetSha256 = this.sha256Hex(JSON.stringify(normalized.map(item => [item.sourceSceneKey, item.promptSha256])));
    if (promptSetSha256 !== input.expectedPromptSetSha256) {
      throw new ConflictException({ code: 'STORY_VISUAL_PROMPT_SET_CHANGED', message: 'Visual prompt set checksum changed' });
    }
    const partIds = (await this.prisma.storyPart.findMany({ where: { workId }, select: { id: true } })).map(row => row.id);
    const scenes = partIds.length ? await this.prisma.storyScene.findMany({
      where: { partId: { in: partIds } }, select: { id: true, sceneKey: true },
    }) : [];
    const beatKeys = scenes.length ? await this.prisma.storyBeat.findMany({
      where: { sceneId: { in: scenes.map(scene => scene.id) }, sourceSceneKey: { not: null } },
      select: { sourceSceneKey: true },
    }) : [];
    const known = new Set([...scenes.map(scene => scene.sceneKey),
      ...beatKeys.map(beat => beat.sourceSceneKey).filter((key): key is string => Boolean(key))]);
    if (normalized.some(item => !known.has(item.sourceSceneKey))) {
      throw new ConflictException({ code: 'STORY_VISUAL_PROMPT_SCENE_UNKNOWN', message: 'Visual prompt scene key is not materialized' });
    }
    const existing = await this.prisma.storyVisualPrompt.findMany({
      where: { workId, releaseId: release.id, sourceSceneKey: { in: normalized.map(item => item.sourceSceneKey) } },
      select: { sourceSceneKey: true, promptSha256: true, sourceBindingSha256: true, releaseChecksum: true },
    });
    const existingByKey = new Map(existing.map(row => [row.sourceSceneKey, row]));
    if (normalized.some(item => {
      const row = existingByKey.get(item.sourceSceneKey);
      return row && (row.promptSha256 !== item.promptSha256 || row.sourceBindingSha256 !== input.sourceBindingSha256 ||
        row.releaseChecksum !== release.checksum);
    })) {
      throw new ConflictException({ code: 'STORY_VISUAL_PROMPT_IMMUTABLE', message: 'Existing visual prompt cannot be replaced' });
    }
    const missing = normalized.filter(item => !existingByKey.has(item.sourceSceneKey));
    if (missing.length) await this.prisma.storyVisualPrompt.createMany({ data: missing.map(item => ({
      workId,
      releaseId: release.id,
      releaseChecksum: release.checksum,
      ...item,
      sourceKind: 'admin_verified',
      sourceBindingSha256: input.sourceBindingSha256,
    })) });
    return { workId, promptCount: normalized.length, createdCount: missing.length, promptSetSha256 };
  }

  async registerAiBranchPrompt(
    workId: string,
    generatedSceneId: string,
    input: RegisterStoryVisualAiBranchPromptDto,
  ) {
    if (!UUID_PATTERN.test(workId) || !UUID_PATTERN.test(generatedSceneId)) {
      throw new BadRequestException('workId and generatedSceneId must be UUIDs');
    }
    const release = await this.prisma.storyRelease.findFirst({
      where: { id: input.releaseId, workId, status: 'active' },
      select: { id: true, checksum: true },
    });
    if (!release || release.checksum !== input.releaseChecksum) {
      throw new ConflictException({ code: 'STORY_VISUAL_RELEASE_CHANGED', message: 'Story release binding changed' });
    }
    const scene = await this.prisma.storyAiGeneratedScene.findFirst({
      where: { id: generatedSceneId, workId, releaseId: release.id, status: 'ready' },
      select: { id: true, sceneKey: true, resultChecksum: true },
    });
    if (!scene || !SOURCE_SCENE_KEY.test(scene.sceneKey)) {
      throw new NotFoundException('Generated story scene not found');
    }
    const promptText = input.promptText.trim();
    const promptSha256 = this.sha256Hex(promptText);
    const sourceBindingSha256 = this.sha256Hex(JSON.stringify({
      generatedSceneId: scene.id,
      resultChecksum: scene.resultChecksum,
      promptSha256,
    }));
    const existing = await this.prisma.storyVisualPrompt.findUnique({
      where: { workId_releaseId_sourceSceneKey: { workId, releaseId: release.id, sourceSceneKey: scene.sceneKey } },
    });
    if (existing) {
      if (existing.promptSha256 !== promptSha256 || existing.releaseChecksum !== release.checksum ||
          existing.sourceBindingSha256 !== sourceBindingSha256 || existing.sourceKind !== 'ai_branch') {
        throw new ConflictException({
          code: 'STORY_VISUAL_PROMPT_IMMUTABLE',
          message: 'Existing visual prompt cannot be replaced',
        });
      }
      return { workId, releaseId: release.id, generatedSceneId, sourceSceneKey: scene.sceneKey, created: false };
    }
    try {
      await this.prisma.storyVisualPrompt.create({ data: {
        workId,
        releaseId: release.id,
        releaseChecksum: release.checksum,
        sourceSceneKey: scene.sceneKey,
        promptText,
        promptSha256,
        sourceKind: 'ai_branch',
        sourceBindingSha256,
      } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const concurrent = await this.prisma.storyVisualPrompt.findUnique({
        where: { workId_releaseId_sourceSceneKey: { workId, releaseId: release.id, sourceSceneKey: scene.sceneKey } },
      });
      if (!concurrent || concurrent.promptSha256 !== promptSha256 ||
          concurrent.sourceBindingSha256 !== sourceBindingSha256 || concurrent.sourceKind !== 'ai_branch') {
        throw new ConflictException({
          code: 'STORY_VISUAL_PROMPT_IMMUTABLE',
          message: 'Existing visual prompt cannot be replaced',
        });
      }
      return { workId, releaseId: release.id, generatedSceneId, sourceSceneKey: scene.sceneKey, created: false };
    }
    return { workId, releaseId: release.id, generatedSceneId, sourceSceneKey: scene.sceneKey, created: true };
  }

  async registerGeneratedContinuationPrompt(
    continuationId: string,
    result: Pick<StoryContinuationProviderResult, 'title' | 'beats'> & Partial<StoryContinuationProviderResult>,
  ) {
    if (!UUID_PATTERN.test(continuationId)) throw new BadRequestException('continuationId must be a UUID');
    const continuation = await this.prisma.storyAiContinuation.findFirst({
      where: { id: continuationId, status: 'completed', resultGeneratedSceneId: { not: null } },
      select: {
        workId: true,
        releaseId: true,
        progressId: true,
        resultGeneratedSceneId: true,
        manuscriptVersionId: true,
        analysisJobId: true,
        contextReferences: true,
      },
    });
    if (!continuation?.resultGeneratedSceneId) {
      return { created: false, reason: 'generated_scene_not_ready' } as const;
    }
    const release = await this.prisma.storyRelease.findFirst({
      where: { id: continuation.releaseId, workId: continuation.workId, status: 'active' },
      select: { checksum: true },
    });
    if (!release) return { created: false, reason: 'release_not_active' } as const;
    const title = Object.values(result.title).find((value): value is string => typeof value === 'string') ?? '';
    const prose = result.beats.flatMap(beat => Object.values(beat.content))
      .filter((value): value is string => typeof value === 'string')
      .join('\n');
    const excerpt = Array.from(prose).slice(0, 6_000).join('');
    const references = this.record(continuation.contextReferences);
    let visualProfile = '';
    let participantProfile = '';
    try {
      const pin = parseContinuationGenerationProfilePin(
        references.generationProfilePin as Prisma.JsonValue | undefined,
      );
      if (pin) {
        const profile = await this.prisma.storyWorkGenerationProfile.findFirst({
          where: {
            id: pin.id,
            workId: continuation.workId,
            manuscriptVersionId: continuation.manuscriptVersionId ?? undefined,
            analysisJobId: continuation.analysisJobId ?? undefined,
            profileVersion: pin.profileVersion,
            reviewRevision: pin.reviewRevision,
            sourceFingerprint: pin.sourceFingerprint,
            approvedFingerprint: pin.approvedFingerprint,
            status: 'approved',
          },
          select: {
            id: true,
            status: true,
            profileVersion: true,
            reviewRevision: true,
            sourceFingerprint: true,
            approvedFingerprint: true,
            approvedSettings: true,
          },
        });
        if (!profile) throw new Error('profile_missing');
        const snapshot = continuationGenerationProfileSnapshot(profile);
        if (stableContinuationJson(snapshot.pin) !== stableContinuationJson(pin)) {
          throw new Error('profile_changed');
        }
        const sections = snapshot.approved.sections.filter((section) =>
          section.key === 'visual_direction' || section.key === 'visual_cast',
        );
        visualProfile = Array.from(JSON.stringify({
          schemaVersion: snapshot.approved.schemaVersion,
          sections,
        })).slice(0, 12_000).join('');
      }
      const participant = this.storyParticipants
        ? await this.storyParticipants.pinnedContext(this.prisma, continuation.progressId)
        : null;
      if (participant) {
        participantProfile = Array.from(JSON.stringify(participant.approved)).slice(0, 12_000).join('');
      }
    } catch (error) {
      this.logger.warn({ event: 'story_visual_profile_resolution_failed', continuationId,
        code: error instanceof Error && error.message === 'profile_missing' ? 'PROFILE_MISSING'
          : error instanceof Error && error.message === 'profile_changed' ? 'PROFILE_CHANGED'
            : 'PROFILE_LOOKUP_FAILED' });
      throw new ConflictException({
        code: 'STORY_VISUAL_PROFILE_CHANGED',
        message: 'The creator-approved visual profile changed before prompt registration',
      });
    }
    const promptText = [
      'Create one cinematic portrait 2:3 illustration for this interactive story scene.',
      'Preserve the characters, setting, period details, mood, and consequences stated in the scene.',
      'Do not render captions, letters, logos, watermarks, interface elements, or modern objects not present in the scene.',
      ...(visualProfile
        ? [
            'The following JSON is the exact creator-approved visual identity for this branch. Treat it as production constraints, not as text to render:',
            visualProfile,
          ]
        : []),
      ...(participantProfile
        ? [
            'The following JSON is the exact selected participating artist identity. Preserve fixed identity while adapting presentation to this scene:',
            participantProfile,
          ]
        : []),
      `Scene title: ${title}`,
      `Scene text: ${excerpt}`,
    ].join('\n');
    try {
      return await this.registerAiBranchPrompt(
        continuation.workId,
        continuation.resultGeneratedSceneId,
        { releaseId: continuation.releaseId, releaseChecksum: release.checksum, promptText },
      );
    } catch (error) {
      this.logger.warn({ event: 'story_visual_prompt_registration_failed', continuationId,
        code: this.promptRegistrationErrorCode(error) });
      throw error;
    }
  }

  private promptRegistrationErrorCode(error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return /^P\d{4}$/.test(error.code) ? `PRISMA_${error.code}` : 'PRISMA_ERROR';
    }
    if (error instanceof ConflictException) {
      const response = error.getResponse();
      if (typeof response === 'object' && response !== null && 'code' in response &&
          typeof response.code === 'string' && /^STORY_VISUAL_[A-Z_]+$/.test(response.code)) {
        return response.code;
      }
      return 'PROMPT_CONFLICT';
    }
    if (error instanceof NotFoundException) return 'SOURCE_NOT_FOUND';
    return 'PROMPT_REGISTRATION_FAILED';
  }

  async syncQueue(workId?: string) {
    return this.queue.sync(workId);
  }

  async queueStatus(workId?: string) {
    return {
      worker: this.worker.readiness(),
      ...await this.queue.status(workId),
    };
  }

  private async executeQueuedVisual(signal?: AbortSignal) {
    const sync = await this.queue.sync();
    const candidate = await this.queue.next();
    if (!candidate) return { status: sync.limitReached ? 'limit_reached' : 'idle' } as const;
    if (signal?.aborted) return { status: 'failed' } as const;
    const result = await this.generate(candidate.workId, candidate.releaseId, candidate.releaseChecksum,
      candidate.sourceSceneKey, signal);
    if (result.status === 'ready') return { status: 'completed' } as const;
    if (result.status === 'unavailable' && result.reason === 'generation_disabled') return { status: 'disabled' } as const;
    if (result.status === 'unavailable' && result.reason === 'beta_generation_limit_reached') {
      return { status: 'limit_reached' } as const;
    }
    return { status: result.status === 'processing' ? 'idle' : 'failed' } as const;
  }

  private async generate(
    workId: string,
    releaseId: string,
    releaseChecksum: string,
    sourceSceneKey: string,
    signal?: AbortSignal,
    replaceStale = false,
    variant: StoryVisualVariant = DEFAULT_VISUAL_VARIANT,
  ) {
    const prompt = await this.prisma.storyVisualPrompt.findUnique({
      where: { workId_releaseId_sourceSceneKey: { workId, releaseId, sourceSceneKey } },
    });
    if (!prompt || prompt.releaseChecksum !== releaseChecksum) return { status: 'unavailable', reason: 'prompt_missing' } as const;
    let existing = await this.ensureGeneration(prompt, variant.key);
    let effective: Awaited<ReturnType<StoryVisualGenerationService['effectiveVisualPrompt']>> | null = null;
    let replacedAssetId: string | null = null;
    let replacementFailureCode: string | null = null;
    let replacementClaimCode: string | null = null;
    if (existing.status === 'ready' && existing.assetId) {
      if (!replaceStale) return this.readyResult(sourceSceneKey, existing.assetId, true);
      effective = await this.effectiveVisualPrompt(workId, releaseId, releaseChecksum, prompt.promptText);
      const identity = await this.readyAssetIdentity(existing.assetId);
      const requestedIdentity = this.requestedVisualIdentity(effective.quality);
      if (this.visualIdentityCurrent(identity, effective)) {
        return this.readyResult(sourceSceneKey, existing.assetId, true);
      }
      const replacementIdentitySha256 = this.sha256Hex(JSON.stringify({
        effectivePromptSha256: effective.sha256,
        visualBibleFingerprint: effective.bible.fingerprint,
        visualBibleVersion: effective.bible.version,
        ...requestedIdentity,
      }));
      const failureCode = this.staleReplacementFailureCode(replacementIdentitySha256);
      const claimCode = this.staleReplacementClaimCode(replacementIdentitySha256);
      replacementFailureCode = failureCode;
      replacementClaimCode = claimCode;
      if (existing.lastErrorCode === failureCode) {
        return { status: 'failed', sourceSceneKey, retryable: false } as const;
      }
      if (existing.lastErrorCode === claimCode) {
        const staleBefore = new Date(Date.now() - this.numberFromEnv('STORY_IMAGE_GENERATION_STALE_SECONDS', 180) * 1000);
        if (existing.updatedAt >= staleBefore) return { status: 'processing', sourceSceneKey } as const;
        const expired = await this.prisma.storyVisualGeneration.updateMany({
          where: { id: existing.id, status: 'ready', assetId: existing.assetId,
            lastErrorCode: claimCode, updatedAt: { lt: staleBefore } },
          data: { lastErrorCode: failureCode, startedAt: null, updatedAt: new Date() },
        });
        return expired.count
          ? { status: 'failed', sourceSceneKey, retryable: false } as const
          : { status: 'processing', sourceSceneKey } as const;
      }
      if (!this.enabled()) return { status: 'unavailable', reason: 'generation_disabled' } as const;
      const replacementPreflight = this.providerPreflight();
      if (replacementPreflight) return { status: 'unavailable', reason: replacementPreflight } as const;
      if (await this.overBudget(workId, releaseId, false)) {
        return { status: 'unavailable', reason: 'beta_generation_limit_reached' } as const;
      }
      const replacementClaim = await this.prisma.storyVisualGeneration.updateMany({
        where: {
          id: existing.id,
          status: 'ready',
          assetId: existing.assetId,
          promptSha256: prompt.promptSha256,
          lastErrorCode: existing.lastErrorCode,
        },
        data: {
          provider: 'openai',
          model: this.model(),
          quality: effective.quality,
          size: this.size(),
          lastErrorCode: claimCode,
          startedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      if (!replacementClaim.count) {
        const current = await this.prisma.storyVisualGeneration.findUnique({ where: { id: existing.id } });
        if (current?.status === 'ready' && current.lastErrorCode === failureCode) {
          return { status: 'failed', sourceSceneKey, retryable: false } as const;
        }
        if (current?.status === 'ready' && current.assetId) return this.readyResult(sourceSceneKey, current.assetId, true);
        return { status: current?.status === 'failed' ? 'failed' : 'processing', sourceSceneKey } as const;
      }
      replacedAssetId = existing.assetId;
      existing = { ...existing, status: 'generating',
        lastErrorCode: claimCode, startedAt: new Date(), updatedAt: new Date() };
    }
    if (!this.enabled()) return { status: 'unavailable', reason: 'generation_disabled' } as const;
    const preflight = this.providerPreflight();
    if (preflight) return { status: 'unavailable', reason: preflight } as const;
    if (await this.overBudget(workId, releaseId, existing.status === 'generating')) {
      return { status: 'unavailable', reason: 'beta_generation_limit_reached' } as const;
    }
    const staleBefore = new Date(Date.now() - this.numberFromEnv('STORY_IMAGE_GENERATION_STALE_SECONDS', 180) * 1000);
    if (existing.status === 'generating' && existing.attemptCount >= MAX_GENERATION_ATTEMPTS &&
        existing.updatedAt < staleBefore) {
      await this.prisma.storyVisualGeneration.updateMany({
        where: { id: existing.id, status: 'generating', updatedAt: { lt: staleBefore } },
        data: { status: 'failed', lastErrorCode: 'PROVIDER_OUTCOME_UNKNOWN', startedAt: null, updatedAt: new Date() },
      });
      return { status: 'failed', sourceSceneKey, retryable: false } as const;
    }
    const storageRecovery = this.isStorageRecovery(existing);
    effective ??= await this.effectiveVisualPrompt(workId, releaseId, releaseChecksum, prompt.promptText);
    const claimed = replacedAssetId ? { count: 1 } : await this.prisma.storyVisualGeneration.updateMany({
      where: {
        id: existing.id,
        promptSha256: prompt.promptSha256,
        attemptCount: storageRecovery ? MAX_GENERATION_ATTEMPTS : { lt: MAX_GENERATION_ATTEMPTS },
        OR: [
          { status: { in: ['pending', 'failed'] } },
          { status: 'generating', updatedAt: { lt: staleBefore } },
        ],
      },
      data: {
        status: 'generating',
        provider: 'openai',
        model: this.model(),
        quality: effective.quality,
        size: this.size(),
        ...(storageRecovery ? {} : { attemptCount: { increment: 1 } }),
        lastErrorCode: null,
        startedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    if (!claimed.count) {
      const current = await this.prisma.storyVisualGeneration.findUnique({ where: { id: existing.id } });
      if (current?.status === 'ready' && current.assetId) return this.readyResult(sourceSceneKey, current.assetId, true);
      return { status: current?.status === 'failed' ? 'failed' : 'processing', sourceSceneKey } as const;
    }

    try {
      const image = await this.generateImage(
        effective.prompt,
        variant.references,
        effective.quality,
        signal,
        effective.workReference,
      );
      const checksumSha256 = this.sha256Hex(image);
      const storage = await this.uploadImage(
        workId,
        releaseId,
        sourceSceneKey,
        variant.key,
        effective.sha256,
        effective.quality,
        image,
      );
      const asset = await this.prisma.$transaction(async tx => {
        const inlineImage = storage.inlineBase64 ? {
          inlineImage: { encoding: 'base64', data: storage.inlineBase64 },
        } : {};
        const created = await tx.asset.create({ data: {
          assetType: 'image',
          visibility: 'public',
          storageProvider: storage.provider,
          storageKey: storage.key,
          mimeType: 'image/webp',
          fileSizeBytes: BigInt(image.length),
          checksum: checksumSha256,
          metadata: {
            lifecycle: { status: 'active' },
            storyVisual: { workId, releaseId, releaseChecksum, sourceSceneKey, variantKey: variant.key,
              participantFingerprint: variant.participantFingerprint, promptSha256: prompt.promptSha256,
              visualBibleVersion: effective!.bible.version, visualBibleFingerprint: effective!.bible.fingerprint,
              effectivePromptSha256: effective!.sha256,
              ...(effective!.workReference ? { workVisualReferenceChecksum: effective!.workReference.checksum } : {}),
              ...(replacedAssetId ? { replacesAssetId: replacedAssetId } : {}),
              provider: 'openai', model: this.model(), quality: effective!.quality, size: this.size(),
              requestContractVersion: IMAGE_REQUEST_CONTRACT_VERSION, ...inlineImage },
          },
        } });
        if (replacedAssetId) {
          await tx.asset.updateMany({
            where: { id: replacedAssetId, visibility: 'public' },
            data: { visibility: 'private' },
          });
        }
        await tx.storyVisualGeneration.update({ where: { id: existing.id }, data: {
          status: 'ready', assetId: created.id, checksumSha256, lastErrorCode: null,
          completedAt: new Date(), updatedAt: new Date(),
        } });
        return created;
      });
      this.logger.log({ event: 'story_visual_generated', workId, sourceSceneKey,
        promptSha256: prompt.promptSha256, model: this.model(), quality: effective.quality, bytes: image.length });
      return this.readyResult(sourceSceneKey, asset.id, false);
    } catch (error) {
      const code = signal?.aborted ? 'PROVIDER_OUTCOME_UNKNOWN' : this.safeGenerationError(error);
      await this.prisma.storyVisualGeneration.updateMany({
        where: replacedAssetId && replacementClaimCode
          ? { id: existing.id, status: 'ready', assetId: replacedAssetId, lastErrorCode: replacementClaimCode }
          : { id: existing.id, status: 'generating' },
        data: replacedAssetId && replacementFailureCode
          ? { status: 'ready', assetId: replacedAssetId, lastErrorCode: replacementFailureCode,
            startedAt: null, updatedAt: new Date() }
          : { status: 'failed', lastErrorCode: code, startedAt: null, updatedAt: new Date() } });
      this.logger.warn({ event: 'story_visual_generation_failed', workId, sourceSceneKey,
        promptSha256: prompt.promptSha256, code });
      return { status: 'failed', sourceSceneKey, retryable: false } as const;
    }
  }

  private async effectiveVisualPrompt(
    workId: string,
    releaseId: string,
    releaseChecksum: string,
    scenePrompt: string,
  ) {
    const [bible, workReference] = await Promise.all([
      this.visualBible(workId, releaseId, releaseChecksum),
      this.approvedStoryCoverReference(workId),
    ]);
    const prompt = composeStoryVisualPrompt(bible, scenePrompt);
    const quality = workReference ? this.fixedStoryQuality() : this.quality();
    return { bible, prompt, workReference, quality,
      sha256: this.sha256Hex(JSON.stringify([prompt, workReference?.checksum ?? null])) };
  }

  private requestedVisualIdentity(quality: string) {
    return {
      provider: 'openai',
      model: this.model(),
      quality,
      size: this.size(),
      requestContractVersion: IMAGE_REQUEST_CONTRACT_VERSION,
    };
  }

  private visualIdentityCurrent(
    identity: Awaited<ReturnType<StoryVisualGenerationService['readyAssetIdentity']>>,
    effective: Awaited<ReturnType<StoryVisualGenerationService['effectiveVisualPrompt']>>,
  ) {
    const requested = this.requestedVisualIdentity(effective.quality);
    return identity.effectivePromptSha256 === effective.sha256 &&
      identity.visualBibleFingerprint === effective.bible.fingerprint &&
      identity.visualBibleVersion === effective.bible.version &&
      identity.provider === requested.provider &&
      identity.model === requested.model &&
      identity.quality === requested.quality &&
      identity.size === requested.size &&
      identity.requestContractVersion === requested.requestContractVersion;
  }

  private async readyAssetIdentity(assetId: string) {
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, assetType: 'image', visibility: 'public', mimeType: 'image/webp' },
      select: { metadata: true },
    });
    const storyVisual = this.record(this.record(asset?.metadata).storyVisual);
    return {
      effectivePromptSha256: typeof storyVisual.effectivePromptSha256 === 'string'
        ? storyVisual.effectivePromptSha256 : null,
      visualBibleFingerprint: typeof storyVisual.visualBibleFingerprint === 'string'
        ? storyVisual.visualBibleFingerprint : null,
      visualBibleVersion: typeof storyVisual.visualBibleVersion === 'string'
        ? storyVisual.visualBibleVersion : null,
      provider: typeof storyVisual.provider === 'string' ? storyVisual.provider : null,
      model: typeof storyVisual.model === 'string' ? storyVisual.model : null,
      quality: typeof storyVisual.quality === 'string' ? storyVisual.quality : null,
      size: typeof storyVisual.size === 'string' ? storyVisual.size : null,
      requestContractVersion: typeof storyVisual.requestContractVersion === 'string'
        ? storyVisual.requestContractVersion : null,
    };
  }

  private staleReplacementFailureCode(effectivePromptSha256: string) {
    return `STALE_REPLACEMENT_FAILED_${effectivePromptSha256.slice(0, 40)}`;
  }

  private staleReplacementClaimCode(effectivePromptSha256: string) {
    return `STALE_REPLACEMENT_IN_PROGRESS_${effectivePromptSha256.slice(0, 40)}`;
  }

  private async ensureGeneration(prompt: { workId: string; releaseId: string; releaseChecksum: string;
    sourceSceneKey: string; promptSha256: string }, variantKey: string) {
    const existing = await this.prisma.storyVisualGeneration.findUnique({
      where: { workId_releaseId_sourceSceneKey_variantKey: { workId: prompt.workId, releaseId: prompt.releaseId,
        sourceSceneKey: prompt.sourceSceneKey, variantKey } },
    });
    if (existing) {
      if (existing.promptSha256 !== prompt.promptSha256) {
        throw new ConflictException({ code: 'STORY_VISUAL_PROMPT_GENERATION_MISMATCH', message: 'Visual generation binding changed' });
      }
      return existing;
    }
    try {
      return await this.prisma.storyVisualGeneration.create({ data: {
        workId: prompt.workId,
        releaseId: prompt.releaseId,
        releaseChecksum: prompt.releaseChecksum,
        sourceSceneKey: prompt.sourceSceneKey,
        variantKey,
        promptSha256: prompt.promptSha256,
      } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      return this.prisma.storyVisualGeneration.findUniqueOrThrow({
        where: { workId_releaseId_sourceSceneKey_variantKey: { workId: prompt.workId, releaseId: prompt.releaseId,
          sourceSceneKey: prompt.sourceSceneKey, variantKey } },
      });
    }
  }

  private async visualBible(workId: string, releaseId: string, releaseChecksum: string) {
    const cacheKey = `${workId}:${releaseId}:${releaseChecksum}`;
    const cached = this.visualBibleCache.get(cacheKey);
    if (cached) return cached;
    const [work, release, canonicalPrompts] = await Promise.all([
      this.prisma.storyWork.findFirst({
        where: { id: workId, fixtureSource: false },
        select: { slug: true, title: true, summary: true },
      }),
      this.prisma.storyRelease.findFirst({
        where: { id: releaseId, workId, checksum: releaseChecksum },
        select: { localizedDisplaySnapshot: true, sceneAssetManifest: true },
      }),
      this.prisma.storyVisualPrompt.findMany({
        where: { workId, releaseId, releaseChecksum, sourceKind: { not: 'ai_branch' } },
        orderBy: [{ sourceSceneKey: 'asc' }, { createdAt: 'asc' }],
        take: 12,
        select: { promptText: true },
      }),
    ]);
    if (!work || !release) throw new Error('STORY_VISUAL_BIBLE_SOURCE_MISSING');
    const parts = await this.prisma.storyPart.findMany({
      where: { workId, status: 'published', fixtureSource: false },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      take: 6,
      select: { id: true, title: true },
    });
    const scenes = parts.length ? await this.prisma.storyScene.findMany({
      where: { partId: { in: parts.map(part => part.id) }, status: 'published', fixtureSource: false },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      take: 8,
      select: { id: true, title: true },
    }) : [];
    const beats = scenes.length ? await this.prisma.storyBeat.findMany({
      where: { sceneId: { in: scenes.map(scene => scene.id) } },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      take: 8,
      select: { content: true },
    }) : [];
    const releaseManifest = this.record(release.sceneAssetManifest);
    const releaseVisualBible = this.record(releaseManifest.visualBible);
    const fixedVisualBible = Object.values(FIXED_ROUTE_STORIES)
      .find(config => config.slug === work.slug)?.visualBible;
    const bible = buildStoryVisualBible({
      workTitle: work.title,
      workSummary: work.summary,
      localizedDisplaySnapshot: release.localizedDisplaySnapshot,
      sceneAssetManifest: Object.keys(releaseVisualBible).length || !fixedVisualBible
        ? release.sceneAssetManifest
        : { ...releaseManifest, visualBible: fixedVisualBible },
      canonicalPrompts: canonicalPrompts.map(item => item.promptText),
      canonicalStoryExcerpts: [
        ...parts.map(part => part.title),
        ...scenes.map(scene => scene.title),
        ...beats.map(beat => beat.content),
      ],
    });
    if (this.visualBibleCache.size >= 100) this.visualBibleCache.delete(this.visualBibleCache.keys().next().value!);
    this.visualBibleCache.set(cacheKey, bible);
    return bible;
  }

  private async overBudget(workId: string, releaseId: string, alreadyGenerating: boolean) {
    if (alreadyGenerating) return false;
    const perWork = this.emergencyLimit('STORY_IMAGE_GENERATION_EMERGENCY_MAX_PER_WORK');
    const total = this.emergencyLimit('STORY_IMAGE_GENERATION_EMERGENCY_MAX_TOTAL');
    if (perWork === null && total === null) return false;
    const [workCount, totalCount] = await Promise.all([
      this.prisma.storyVisualGeneration.count({ where: { workId, releaseId, attemptCount: { gte: 1 } } }),
      this.prisma.storyVisualGeneration.count({ where: { attemptCount: { gte: 1 } } }),
    ]);
    return (perWork !== null && workCount >= perWork) || (total !== null && totalCount >= total);
  }

  private emergencyLimit(key: string): number | null {
    const raw = this.config.get<string>(key);
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1) throw new BadRequestException(`${key} must be positive`);
    return value;
  }

  private async visualVariantForProgress(progressId: string): Promise<StoryVisualVariant> {
    if (!this.storyParticipants) return DEFAULT_VISUAL_VARIANT;
    const participant = await this.storyParticipants.visualReferences(progressId);
    if (!participant) return DEFAULT_VISUAL_VARIANT;
    return {
      key: `artist:${participant.participantFingerprint}`,
      participantFingerprint: participant.participantFingerprint,
      references: participant.references,
    };
  }

  private async generateImage(
    prompt: string,
    references: StoryParticipantVisualReference[],
    quality: string,
    signal?: AbortSignal,
    workReference?: StoryWorkVisualReference | null,
  ) {
    const timeout = AbortSignal.timeout(this.numberFromEnv('STORY_IMAGE_GENERATION_TIMEOUT_MS', 120_000));
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = references.length || workReference
      ? await this.generateImageFromReferences(prompt, references, quality, requestSignal, workReference)
      : await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: { authorization: `Bearer ${this.requiredEnv('OPENAI_API_KEY')}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: this.model(), prompt, n: 1, size: this.size(), quality,
            output_format: 'webp', output_compression: 86, moderation: 'auto' }),
          signal: requestSignal,
        });
    if (!response.ok) throw new Error(await this.openAiErrorCode(response));
    const payload = await response.json() as { data?: Array<{ b64_json?: unknown }> };
    const encoded = payload.data?.[0]?.b64_json;
    if (typeof encoded !== 'string' || encoded.length > 24 * 1024 * 1024) throw new Error('OPENAI_IMAGE_INVALID');
    const image = Buffer.from(encoded, 'base64');
    if (image.length < 1024 || image.length > 16 * 1024 * 1024 || image.toString('ascii', 0, 4) !== 'RIFF' ||
        image.toString('ascii', 8, 12) !== 'WEBP') throw new Error('OPENAI_IMAGE_INVALID');
    return this.validateAndSanitizeImage(image);
  }

  private async generateImageFromReferences(
    prompt: string,
    references: StoryParticipantVisualReference[],
    quality: string,
    signal: AbortSignal,
    workReference?: StoryWorkVisualReference | null,
  ) {
    const storage = this.storage;
    if (references.length && !storage) throw new Error('STORY_VISUAL_REFERENCE_STORAGE_UNAVAILABLE');
    const form = new FormData();
    const model = this.model();
    form.set('model', model);
    form.set('prompt', [
      prompt,
      ...(workReference ? [
        'The first attached image is the approved published story cover and the master reference for this work.',
        'Preserve its rendering medium, palette, recurring-character identity, age, face, hair, costume anchors, and overall world design. Do not copy its poster composition or any text.',
      ] : []),
      ...(references.length ? [
        'The remaining attached images are approved identity references for the participating artist character.',
        'Preserve the same recognizable face, hair, body proportions, and signature traits. Adapt only costume, pose, lighting, and rendering medium to the story scene.',
      ] : []),
    ].join('\n'));
    form.set('size', this.size());
    form.set('quality', quality);
    form.set('output_format', 'webp');
    form.set('output_compression', '86');
    if (workReference) {
      form.append('image[]', new Blob([Uint8Array.from(workReference.image)], { type: workReference.mimeType }),
        workReference.filename);
    }
    for (const [index, reference] of references.slice(0, workReference ? 7 : 8).entries()) {
      const image = await storage!.getObject({
        storageProvider: reference.storageProvider,
        storageKey: reference.storageKey,
        expectedBytes: reference.fileSizeBytes,
      });
      if (this.sha256Hex(image) !== reference.checksum) {
        throw new Error('STORY_VISUAL_REFERENCE_CHANGED');
      }
      const extension = reference.mimeType === 'image/jpeg' ? 'jpg'
        : reference.mimeType === 'image/png' ? 'png' : 'webp';
      form.append('image[]', new Blob([Uint8Array.from(image)], { type: reference.mimeType }),
        `artist-reference-${index + 1}.${extension}`);
    }
    return fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.requiredEnv('OPENAI_API_KEY')}` },
      body: form,
      signal,
    });
  }

  private async approvedStoryCoverReference(workId: string): Promise<StoryWorkVisualReference | null> {
    if (this.workVisualReferenceCache.has(workId)) return this.workVisualReferenceCache.get(workId)!;
    const work = await this.prisma.storyWork.findFirst({
      where: { id: workId, fixtureSource: false },
      select: { slug: true },
    });
    const coverPath = APPROVED_STORY_COVERS.get(work?.slug ?? '');
    if (!coverPath) {
      this.workVisualReferenceCache.set(workId, null);
      return null;
    }
    const pathSegments = coverPath.split('/').filter(Boolean);
    const candidates = [resolve(process.cwd(), ...pathSegments), resolve(process.cwd(), '..', ...pathSegments)];
    let image: Buffer | null = null;
    for (const candidate of candidates) {
      try {
        image = await readFile(candidate);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    if (!image || image.length < 1_024 || image.length > 16 * 1024 * 1024) {
      throw new Error('STORY_VISUAL_COVER_REFERENCE_MISSING');
    }
    const metadata = await sharp(image, { animated: false, failOn: 'error', limitInputPixels: 24_000_000 }).metadata();
    const mimeType = metadata.format === 'png' ? 'image/png'
      : metadata.format === 'jpeg' ? 'image/jpeg'
        : metadata.format === 'webp' ? 'image/webp' : null;
    if (!mimeType || !metadata.width || !metadata.height || metadata.width < 512 || metadata.height < 288 ||
        (metadata.pages ?? 1) !== 1) throw new Error('STORY_VISUAL_COVER_REFERENCE_INVALID');
    const reference: StoryWorkVisualReference = {
      image,
      checksum: this.sha256Hex(image),
      mimeType,
      filename: coverPath.split('/').at(-1) || `${work?.slug}-cover.png`,
    };
    this.workVisualReferenceCache.set(workId, reference);
    return reference;
  }

  private async validateAndSanitizeImage(image: Buffer) {
    const expected = IMAGE_SIZES.get(this.size())!;
    try {
      const pipeline = sharp(image, { animated: false, failOn: 'error', limitInputPixels: 24_000_000 });
      const metadata = await pipeline.metadata();
      if (metadata.format !== 'webp' || metadata.width !== expected.width || metadata.height !== expected.height ||
          (metadata.pages ?? 1) !== 1) throw new Error('OPENAI_IMAGE_INVALID');
      const sanitized = await pipeline.webp({ quality: 86, effort: 4 }).toBuffer();
      if (sanitized.length < 1024 || sanitized.length > 16 * 1024 * 1024) throw new Error('OPENAI_IMAGE_INVALID');
      return sanitized;
    } catch (error) {
      if (error instanceof Error && error.message === 'OPENAI_IMAGE_INVALID') throw error;
      throw new Error('OPENAI_IMAGE_INVALID');
    }
  }

  private async uploadImage(
    workId: string,
    releaseId: string,
    sourceSceneKey: string,
    variantKey: string,
    promptSha256: string,
    quality: string,
    image: Buffer,
  ) {
    const provider = this.requiredEnv('OBJECT_STORAGE_PROVIDER');
    if (!['s3', 'r2'].includes(provider)) throw new Error('OBJECT_STORAGE_UNAVAILABLE');
    const prefix = this.storageKeyPrefix();
    const safeModel = this.model().replace(/[^a-zA-Z0-9._-]/g, '-');
    const variantSha256 = this.sha256Hex(variantKey).slice(0, 16);
    const key = [prefix, 'story-visuals', workId, releaseId, sourceSceneKey,
      `${variantSha256}-${promptSha256}-${safeModel}-${quality}-${this.size()}.webp`].filter(Boolean).join('/');
    const url = this.presignedPutUrl(provider, key, 'image/webp');
    const response = await fetch(url, { method: 'PUT', headers: { 'content-type': 'image/webp' },
      body: image as unknown as BodyInit });
    if (!response.ok) {
      if (this.databaseFallbackEnabled()) {
        this.logger.warn({ event: 'story_visual_database_fallback', workId, sourceSceneKey,
          objectStorageStatus: response.status });
        return { provider: 'database', key, inlineBase64: image.toString('base64') };
      }
      throw new Error(`OBJECT_STORAGE_${response.status}`);
    }
    return { provider, key };
  }

  private readyResult(sourceSceneKey: string, assetId: string, reused: boolean) {
    return { status: 'ready', sourceSceneKey, publicAssetPath: this.publicAssetPath(assetId), reused } as const;
  }

  private publicAssetPath(assetId: string) {
    return `/api/v1/story-visual-assets/${assetId}`;
  }

  private databaseFallbackEnabled() {
    return this.config.get<string>('STORY_IMAGE_DATABASE_FALLBACK_ENABLED') === 'true';
  }

  private isStorageRecovery(generation: { status: string; attemptCount: number; lastErrorCode?: string | null }) {
    if (this.databaseFallbackEnabled() && generation.status === 'failed' &&
        generation.attemptCount === MAX_GENERATION_ATTEMPTS &&
        generation.lastErrorCode?.startsWith('OBJECT_STORAGE_')) return true;
    return false;
  }

  private providerPreflight() {
    if (!this.config.get<string>('OPENAI_API_KEY')) return 'openai_key_missing';
    const provider = this.config.get<string>('OBJECT_STORAGE_PROVIDER');
    if (!['s3', 'r2'].includes(String(provider))) return 'durable_storage_required';
    for (const key of ['OBJECT_STORAGE_BUCKET', 'OBJECT_STORAGE_ACCESS_KEY_ID', 'OBJECT_STORAGE_SECRET_ACCESS_KEY']) {
      if (!this.config.get<string>(key)) return 'durable_storage_incomplete';
    }
    if (provider === 'r2' && !this.config.get<string>('OBJECT_STORAGE_ENDPOINT')) return 'durable_storage_incomplete';
    return null;
  }

  private enabled() {
    return this.config.get<string>('STORY_IMAGE_GENERATION_ENABLED') === 'true';
  }

  private model() {
    const value = this.config.get<string>('OPENAI_IMAGE_MODEL') || 'gpt-image-2';
    if (!IMAGE_MODELS.has(value)) throw new BadRequestException('OPENAI_IMAGE_MODEL is not allowed');
    return value;
  }

  private quality() {
    const value = this.config.get<string>('OPENAI_IMAGE_QUALITY') || 'medium';
    if (!IMAGE_QUALITIES.has(value)) throw new BadRequestException('OPENAI_IMAGE_QUALITY is not allowed');
    return value;
  }

  private fixedStoryQuality() {
    const value = this.config.get<string>('OPENAI_FIXED_STORY_IMAGE_QUALITY') || 'high';
    if (!IMAGE_QUALITIES.has(value)) {
      throw new BadRequestException('OPENAI_FIXED_STORY_IMAGE_QUALITY is not allowed');
    }
    return value;
  }

  private size() {
    const value = this.config.get<string>('OPENAI_STORY_SCENE_IMAGE_SIZE') || '1024x1536';
    if (!IMAGE_SIZES.has(value)) throw new BadRequestException('OPENAI_STORY_SCENE_IMAGE_SIZE is not allowed');
    return value;
  }

  private safeGenerationError(error: unknown) {
    const message = error instanceof Error ? error.message : 'UNKNOWN';
    if (message.startsWith('OPENAI_')) return message.slice(0, 80);
    if (message.startsWith('OBJECT_STORAGE_')) return message.slice(0, 80);
    if (message === 'STORY_VISUAL_REFERENCE_CHANGED') return message;
    if (message === 'STORY_VISUAL_REFERENCE_STORAGE_UNAVAILABLE') return message;
    if (message === 'TimeoutError' || message.includes('timeout')) return 'GENERATION_TIMEOUT';
    return 'GENERATION_FAILED';
  }

  private async openAiErrorCode(response: Response) {
    const parts = [`OPENAI_${response.status}`];
    try {
      const payload = await response.json() as {
        error?: { param?: unknown; code?: unknown; type?: unknown };
      };
      const safePart = (value: unknown) => typeof value === 'string'
        ? value.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 28)
        : '';
      const param = safePart(payload.error?.param);
      const code = safePart(payload.error?.code);
      const type = safePart(payload.error?.type);
      if (param) parts.push(`PARAM_${param}`);
      if (code) parts.push(`CODE_${code}`);
      if (type) parts.push(`TYPE_${type}`);
    } catch {
      // The status code is enough when the provider does not return JSON.
    }
    return parts.join('_').slice(0, 80);
  }

  private presignedPutUrl(storageProvider: string, storageKey: string, mimeType: string) {
    const bucket = this.requiredEnv('OBJECT_STORAGE_BUCKET');
    const region = this.config.get<string>('OBJECT_STORAGE_REGION') || 'auto';
    const accessKeyId = this.requiredEnv('OBJECT_STORAGE_ACCESS_KEY_ID');
    const secretAccessKey = this.requiredEnv('OBJECT_STORAGE_SECRET_ACCESS_KEY');
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const endpoint = this.objectStorageEndpoint(storageProvider, bucket, region);
    const url = new URL(this.joinUrlPath(endpoint, storageKey));
    const signedHeaders = 'content-type;host';
    const query: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${accessKeyId}/${scope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': '900',
      'X-Amz-SignedHeaders': signedHeaders,
    };
    const canonicalQuery = this.canonicalQueryString(query);
    const canonicalRequest = ['PUT', this.canonicalUri(url.pathname), canonicalQuery,
      `content-type:${mimeType}\nhost:${url.host}\n`, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, this.sha256Hex(canonicalRequest)].join('\n');
    const signature = createHmac('sha256', this.signingKey(secretAccessKey, dateStamp, region))
      .update(stringToSign).digest('hex');
    url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;
    return url.toString();
  }

  private objectStorageEndpoint(provider: string, bucket: string, region: string) {
    const configured = this.config.get<string>('OBJECT_STORAGE_ENDPOINT');
    if (configured) return `${configured.replace(/\/+$/, '')}/${bucket}`;
    if (provider === 's3') return `https://${bucket}.s3.${region}.amazonaws.com`;
    throw new Error('OBJECT_STORAGE_UNAVAILABLE');
  }

  private joinUrlPath(baseUrl: string, storageKey: string) {
    return `${baseUrl.replace(/\/+$/, '')}/${storageKey.split('/').map(part => this.rfc3986(part)).join('/')}`;
  }

  private canonicalUri(pathname: string) {
    return pathname.split('/').map(part => this.rfc3986(decodeURIComponent(part))).join('/');
  }

  private canonicalQueryString(query: Record<string, string>) {
    return Object.entries(query).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${this.rfc3986(key)}=${this.rfc3986(value)}`).join('&');
  }

  private rfc3986(value: string) {
    return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  }

  private signingKey(secret: string, dateStamp: string, region: string) {
    const date = createHmac('sha256', `AWS4${secret}`).update(dateStamp).digest();
    const dateRegion = createHmac('sha256', date).update(region).digest();
    const dateRegionService = createHmac('sha256', dateRegion).update('s3').digest();
    return createHmac('sha256', dateRegionService).update('aws4_request').digest();
  }

  private storageKeyPrefix() {
    return (this.config.get<string>('OBJECT_STORAGE_KEY_PREFIX') || '').trim().replace(/^\/+|\/+$/g, '')
      .replace(/\/+/g, '/').split('/').map(part => part.normalize('NFKD').replace(/[^\w.\-]+/g, '-')
        .replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').toLowerCase()).filter(Boolean).join('/');
  }

  private requiredEnv(key: string) {
    const value = this.config.get<string>(key);
    if (!value) throw new Error(`${key}_MISSING`);
    return value;
  }

  private numberFromEnv(key: string, fallback: number) {
    const parsed = Number(this.config.get<string>(key) || fallback);
    if (!Number.isFinite(parsed) || parsed < 1) throw new BadRequestException(`${key} must be positive`);
    return parsed;
  }

  private sha256Hex(value: string | Buffer) {
    return createHash('sha256').update(value).digest('hex');
  }

  private record(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
  }
}

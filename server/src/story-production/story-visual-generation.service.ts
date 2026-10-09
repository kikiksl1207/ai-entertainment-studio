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
import { currentApprovedStoryVisual } from './story-approved-visual-context.policy';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import * as sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { StoryUploadStorageService } from '../story-upload/story-upload-storage.service';
import type {
  RegisterStoryVisualAiBranchPromptDto,
  RegisterStoryVisualPromptsDto,
  ReplaceStaleStoryVisualDto,
  ReprepareStoryVisualBookingDto,
} from './dto/story-visual-generation.dto';
import { StoryPublicBetaPolicy } from './story-public-beta.policy';
import type { StoryContinuationProviderResult } from './story-continuation.provider';
import { buildStoryVisualBible, composeStoryVisualPrompt, type StoryVisualBible } from './story-visual-bible';
import { FIXED_ROUTE_STORIES } from './story-fixed-route-markdown.policy';
import {
  continuationGenerationProfileVisualSnapshot,
  parseContinuationGenerationProfilePin,
  stableContinuationJson,
} from './story-continuation-context.policy';
import { StoryVisualGenerationQueue, type StoryVisualQueueCandidate } from './story-visual-generation.queue';
import { parsedStoryVisualBooking, storyVisualBookingIdentity, storyVisualBookingMatches, type StoryVisualBookingIdentity } from './story-visual-booking.policy';
import { StoryVisualGenerationWorker } from './story-visual-generation.worker';
import { StoryStudioVisualReviewService } from './story-studio-visual-review.service';
import { verifiedStoredBranchVisualNarrative } from './story-branch-visual-narrative.policy';
import { StoryBranchVisualReviewService } from './story-branch-visual-review.service';
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

type StoryVisualGenerationResult =
  | { status: 'ready'; sourceSceneKey: string; publicAssetPath: string; reused: boolean }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed' | 'processing'; sourceSceneKey: string; retryable?: boolean };

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
  private readonly workVisualReferenceInFlight = new Map<string, Promise<StoryWorkVisualReference | null>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Optional() private readonly publicBeta?: StoryPublicBetaPolicy,
    @Optional() private readonly storyParticipants?: StoryArtistParticipantService,
    @Optional() private readonly storage?: StoryUploadStorageService,
    @Optional() private readonly visualReviews?: StoryStudioVisualReviewService,
    @Optional() private readonly branchVisualReviews?: StoryBranchVisualReviewService,
  ) {
    this.queue = new StoryVisualGenerationQueue(prisma, config, (candidate, tx) => this.bookQueuedVisual(candidate, tx));
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
    const ready = await this.readyBoundVisuals(workId, releaseId, sourceSceneKeys, variantKey);
    if (!this.sharedBranchVisualReuseEnabled()) return ready;
    const keys = [...new Set(sourceSceneKeys.filter(key => SOURCE_SCENE_KEY.test(key) && key.startsWith('ai-reuse-')))];
    if (!keys.length) return ready;
    const release = await this.prisma.storyRelease.findFirst({ where: { id: releaseId, workId, status: 'active' }, select: { checksum: true } });
    if (!release) return ready;
    for (const key of keys) {
      if (ready.has(key)) continue;
      try {
        const origin = await this.sharedBranchVisualOrigin(workId, releaseId, release.checksum, key, variantKey);
        if (!origin) continue;
        const shared = (await this.readyBoundVisuals(workId, releaseId, [origin.sourceSceneKey], variantKey)).get(origin.sourceSceneKey);
        if (!shared) continue;
        const current = await this.sharedBranchVisualOrigin(workId, releaseId, release.checksum, key, variantKey);
        if (current?.identity !== origin.identity) continue;
        ready.set(key, { sourceSceneKey: key, publicAssetPath: shared.publicAssetPath });
      } catch (error) {
        if (!this.visualApprovalChanged(error)) throw error;
      }
    }
    return ready;
  }

  private async readyBoundVisuals(
    workId: string,
    releaseId: string,
    sourceSceneKeys: string[],
    variantKey: string,
  ) {
    const keys = [...new Set(sourceSceneKeys.filter(key => SOURCE_SCENE_KEY.test(key)))];
    if (!keys.length) return new Map<string, ReadyVisual>();
    const rows = await this.prisma.storyVisualGeneration.findMany({
      where: { workId, releaseId, sourceSceneKey: { in: keys }, variantKey, status: 'ready', assetId: { not: null } },
      select: { sourceSceneKey: true, assetId: true, releaseChecksum: true, promptSha256: true, bookingIdentity: true },
    });
    if (!rows.length) return new Map<string, ReadyVisual>();
    const [release, prompts, assets] = await Promise.all([
      this.prisma.storyRelease.findFirst({
        where: { id: releaseId, workId, status: 'active' }, select: { checksum: true },
      }),
      this.prisma.storyVisualPrompt.findMany({
        where: { workId, releaseId, sourceSceneKey: { in: rows.map(row => row.sourceSceneKey) } },
        select: { sourceSceneKey: true, releaseChecksum: true, promptSha256: true, promptText: true, sourceKind: true, sourceBindingSha256: true },
      }),
      this.prisma.asset.findMany({
        where: { id: { in: rows.map(row => row.assetId).filter((id): id is string => Boolean(id)) },
          assetType: 'image', visibility: 'public', mimeType: 'image/webp', checksum: { not: null } },
        select: { id: true, metadata: true },
      }),
    ]);
    if (!release) return new Map<string, ReadyVisual>();
    const promptsByKey = new Map(prompts.map(prompt => [prompt.sourceSceneKey, prompt]));
    const assetsById = new Map(assets.map(asset => [asset.id, asset]));
    const candidates = rows.flatMap(row => {
      const prompt = promptsByKey.get(row.sourceSceneKey);
      const asset = row.assetId ? assetsById.get(row.assetId) : null;
      return prompt && asset && row.releaseChecksum === release.checksum &&
        prompt.releaseChecksum === release.checksum && row.promptSha256 === prompt.promptSha256
        ? [{ row, prompt, asset }] : [];
    });
    if (!candidates.length) return new Map<string, ReadyVisual>();
    let bible: StoryVisualBible;
    try {
      bible = await this.visualBible(workId, releaseId, release.checksum);
    } catch (error) {
      if (this.visualApprovalChanged(error)) return new Map<string, ReadyVisual>();
      throw error;
    }
    let workReference: StoryWorkVisualReference | null;
    try {
      workReference = await this.approvedStoryCoverReference(workId);
    } catch (error) {
      this.logger.warn({ event: 'story_visual_cover_read_unavailable', workId, releaseId,
        code: this.safeGenerationError(error) });
      return new Map<string, ReadyVisual>();
    }
    const ready: Array<readonly [string, ReadyVisual]> = [];
    const coverSourceFingerprint = candidates.some(item => item.row.bookingIdentity)
      ? await this.currentCoverSourceFingerprint(workId) : null;
    for (const { row, prompt, asset } of candidates) {
      let review: Awaited<ReturnType<StoryVisualGenerationService['reviewedScenePrompt']>>;
      try {
        await this.assertPromptApprovalCurrent(this.prisma, workId, releaseId, prompt, bible);
        review = await this.reviewedScenePrompt(this.prisma, workId, releaseId, release.checksum,
          row.sourceSceneKey, prompt.promptText, bible);
      } catch (error) {
        if (this.visualApprovalChanged(error)) continue;
        throw error;
      }
      const effective = this.composeEffectiveVisualPrompt(bible, workReference, review?.promptText ?? prompt.promptText, review);
      effective.coverSourceFingerprint = coverSourceFingerprint;
      const identity = this.assetIdentity(asset.metadata);
      if (!this.visualBookingAssetCurrent(row.bookingIdentity, { ...prompt, workId, releaseId }, effective, identity)) continue;
      if (this.visualIdentityCurrent(identity, effective, {
        workId, releaseId, releaseChecksum: release.checksum, sourceSceneKey: row.sourceSceneKey,
        variantKey, promptSha256: prompt.promptSha256,
      })) ready.push([row.sourceSceneKey, {
        sourceSceneKey: row.sourceSceneKey, publicAssetPath: this.publicAssetPath(asset.id),
      }]);
    }
    return new Map(ready);
  }

  async variantKeyForProgress(progressId: string): Promise<string | null> {
    try {
      const progress = await this.prisma.storyReaderProgress.findFirst({ where: { id: progressId },
        select: { currentGeneratedSceneId: true } });
      if (progress?.currentGeneratedSceneId) {
        return (await this.visualVariantForGeneratedScene(progress.currentGeneratedSceneId, progressId)).key;
      }
      return (await this.visualVariantForProgress(progressId)).key;
    } catch (error) {
      const code = error instanceof ConflictException ? this.record(error.getResponse()).code : null;
      // Reading may show unavailable artwork, but must never substitute a new identity.
      if (this.visualApprovalChanged(error) || code === 'STORY_VISUAL_BRANCH_SOURCE_CHANGED' ||
          code === 'STORY_PARTICIPANT_IDENTITY_CHANGED') return null;
      throw error;
    }
  }

  async publicVisualAsset(assetId: string) {
    if (!UUID_PATTERN.test(assetId)) throw new BadRequestException('assetId must be a UUID');
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, assetType: 'image', visibility: 'public', mimeType: 'image/webp', checksum: { not: null } },
      select: { id: true, storageProvider: true, storageKey: true, mimeType: true,
        fileSizeBytes: true, checksum: true, metadata: true },
    });
    if (!asset) throw new NotFoundException('Story visual not found');
    const metadata = this.record(asset.metadata);
    const storyVisual = this.record(metadata.storyVisual);
    const identity = this.assetIdentity(asset.metadata);
    if (this.record(metadata.lifecycle).status !== 'active' ||
        typeof identity.workId !== 'string' || !UUID_PATTERN.test(identity.workId) ||
        typeof identity.releaseId !== 'string' || !UUID_PATTERN.test(identity.releaseId) ||
        typeof identity.releaseChecksum !== 'string' || !identity.releaseChecksum ||
        typeof identity.sourceSceneKey !== 'string' || !SOURCE_SCENE_KEY.test(identity.sourceSceneKey) ||
        typeof identity.variantKey !== 'string' ||
        (identity.variantKey !== DEFAULT_VISUAL_VARIANT.key &&
          !/^artist:[a-f0-9]{64}$/.test(identity.variantKey)) ||
        typeof identity.promptSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(identity.promptSha256)) {
      throw new NotFoundException('Story visual not found');
    }
    const participantFingerprint = identity.variantKey === DEFAULT_VISUAL_VARIANT.key
      ? null : identity.variantKey.slice('artist:'.length);
    if (identity.participantFingerprint !== participantFingerprint) {
      throw new NotFoundException('Story visual not found');
    }
    const generation = await this.prisma.storyVisualGeneration.findUnique({
      where: { workId_releaseId_sourceSceneKey_variantKey: {
        workId: identity.workId, releaseId: identity.releaseId,
        sourceSceneKey: identity.sourceSceneKey, variantKey: identity.variantKey,
      } },
      select: { status: true, assetId: true, releaseChecksum: true, promptSha256: true, checksumSha256: true, bookingIdentity: true },
    });
    if (generation?.status !== 'ready' || generation.assetId !== asset.id ||
        generation.releaseChecksum !== identity.releaseChecksum ||
        generation.promptSha256 !== identity.promptSha256 ||
        generation.checksumSha256 !== asset.checksum) {
      throw new NotFoundException('Story visual not found');
    }
    const [work, release, prompt] = await Promise.all([
      this.prisma.storyWork.findFirst({
        where: { id: identity.workId, status: 'published', fixtureSource: false,
          activeReleaseId: identity.releaseId }, select: { id: true },
      }),
      this.prisma.storyRelease.findFirst({
        where: { id: identity.releaseId, workId: identity.workId, status: 'active',
          checksum: identity.releaseChecksum }, select: { id: true },
      }),
      this.prisma.storyVisualPrompt.findUnique({
        where: { workId_releaseId_sourceSceneKey: {
          workId: identity.workId, releaseId: identity.releaseId, sourceSceneKey: identity.sourceSceneKey,
        } },
        select: { releaseChecksum: true, promptSha256: true, promptText: true, sourceKind: true, sourceBindingSha256: true },
      }),
    ]);
    if (!work || !release || !prompt || prompt.releaseChecksum !== identity.releaseChecksum ||
        prompt.promptSha256 !== identity.promptSha256) {
      throw new NotFoundException('Story visual not found');
    }
    if (participantFingerprint) {
      if (!this.storyParticipants) throw new NotFoundException('Story visual not found');
      const participant = await this.prisma.storyProgressArtistParticipant.findFirst({
        where: { workId: identity.workId, participantFingerprint,
          artist: { status: 'active' } },
        select: { progressId: true },
      });
      if (!participant) throw new NotFoundException('Story visual not found');
      try {
        const current = await this.storyParticipants.visualReferences(participant.progressId);
        if (!current || current.participantFingerprint !== identity.participantFingerprint ||
            !current.references.length) {
          throw new NotFoundException('Story visual not found');
        }
      } catch (error) {
        if (error instanceof ConflictException || error instanceof NotFoundException) {
          throw new NotFoundException('Story visual not found');
        }
        throw error;
      }
    }
    let effective: Awaited<ReturnType<StoryVisualGenerationService['effectiveVisualPrompt']>>;
    try {
      effective = await this.effectiveVisualPrompt(identity.workId, identity.releaseId,
        identity.releaseChecksum, prompt.promptText, identity.sourceSceneKey);
      await this.assertPromptApprovalCurrent(this.prisma, identity.workId, identity.releaseId,
        { ...prompt, sourceSceneKey: identity.sourceSceneKey }, effective.bible);
    } catch (error) {
      if (this.visualApprovalChanged(error)) throw new NotFoundException('Story visual not found');
      throw error;
    }
    if (!this.visualIdentityCurrent(identity, effective, {
      workId: identity.workId, releaseId: identity.releaseId,
      releaseChecksum: identity.releaseChecksum, sourceSceneKey: identity.sourceSceneKey,
      variantKey: identity.variantKey, promptSha256: identity.promptSha256,
    })) throw new NotFoundException('Story visual not found');
    if (!this.visualBookingAssetCurrent(generation.bookingIdentity, { ...prompt, workId: identity.workId,
      releaseId: identity.releaseId, sourceSceneKey: identity.sourceSceneKey }, effective, identity)) throw new NotFoundException('Story visual not found');
    if (asset.storageProvider !== 'database') {
      const provider = asset.storageProvider;
      const key = asset.storageKey;
      const scenePath = [this.storageKeyPrefix(), 'story-visuals', identity.workId,
        identity.releaseId, identity.sourceSceneKey].filter(Boolean).join('/') + '/';
      if ((provider !== 's3' && provider !== 'r2') ||
          provider !== this.config.get<string>('OBJECT_STORAGE_PROVIDER') ||
          typeof key !== 'string' || !key.startsWith(scenePath) || !key.endsWith('.webp') ||
          !/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes('..')) {
        throw new NotFoundException('Story visual not found');
      }
      return { kind: 'redirect', url: this.presignedGetUrl(provider, key) } as const;
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
    const work = await this.prisma.storyWork.findFirst({ where: { id: workId, status: 'published',
      fixtureSource: false, activeReleaseId: releaseId }, select: { id: true, ownerUserId: true } });
    const release = await this.prisma.storyRelease.findFirst({ where: { id: releaseId, workId, status: 'active' },
      select: { manuscriptVersionId: true, checksum: true } });
    if (!work || !release) return new Set<string>();
    let approved: Awaited<ReturnType<typeof currentApprovedStoryVisual>>;
    try { approved = await currentApprovedStoryVisual(this.prisma, work, release.manuscriptVersionId); }
    catch (error) {
      if (this.visualApprovalChanged(error)) return new Set<string>();
      throw error;
    }
    const rows = await this.prisma.storyVisualPrompt.findMany({
      where: { workId, releaseId, sourceSceneKey: { in: keys } },
      select: { sourceSceneKey: true, promptText: true, sourceKind: true },
    });
    const present = new Set<string>();
    for (const row of rows) {
      try {
        await this.assertPromptApprovalCurrent(this.prisma, workId, releaseId, row,
          { approvalFingerprint: approved?.fingerprint, approvalIdentity: approved?.approvalIdentity });
        await this.reviewedScenePrompt(this.prisma, workId, releaseId, release.checksum,
          row.sourceSceneKey, row.promptText, { approvalFingerprint: approved?.fingerprint });
        present.add(row.sourceSceneKey);
      } catch (error) {
        if (this.visualApprovalChanged(error)) continue;
        throw error;
      }
    }
    for (const sourceSceneKey of keys) {
      const continuationKey = sourceSceneKey.startsWith('ai-reuse-') ? sourceSceneKey.slice(9)
        : sourceSceneKey.startsWith('ai-') ? sourceSceneKey.slice(3) : '';
      if (present.has(sourceSceneKey) || !UUID_PATTERN.test(continuationKey)) continue;
      try {
        const scene = await this.prisma.storyAiGeneratedScene.findFirst({
          where: { workId, releaseId, sceneKey: sourceSceneKey, status: 'ready' },
          select: { id: true },
        });
        if (!scene) continue;
        await this.recoverGeneratedContinuationPrompt(scene.id);
        const prompt = await this.prisma.storyVisualPrompt.findUnique({
          where: { workId_releaseId_sourceSceneKey: { workId, releaseId, sourceSceneKey } },
          select: { id: true, promptText: true, sourceKind: true },
        });
        if (prompt) {
          await this.assertPromptApprovalCurrent(this.prisma, workId, releaseId, { ...prompt, sourceSceneKey },
            { approvalFingerprint: approved?.fingerprint, approvalIdentity: approved?.approvalIdentity });
          await this.reviewedScenePrompt(this.prisma, workId, releaseId, release.checksum,
            sourceSceneKey, prompt.promptText, { approvalFingerprint: approved?.fingerprint });
          present.add(sourceSceneKey);
        }
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
    const variant = generatedSceneId ? await this.visualVariantForGeneratedScene(generatedSceneId, progressId)
      : await this.visualVariantForProgress(progressId);
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
      select: { beatType: true, content: true }, take: 41,
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
    const result = await this.generate(workId, release.id, release.checksum, input.sourceSceneKey, undefined, true);
    if (result.status === 'ready') {
      const currentWork = await this.prisma.storyWork.findFirst({
        where: { id: workId, status: 'published', fixtureSource: false, activeReleaseId: release.id },
        select: { id: true },
      });
      const currentRelease = currentWork ? await this.prisma.storyRelease.findFirst({
        where: { id: release.id, workId, status: 'active', checksum: release.checksum },
        select: { id: true },
      }) : null;
      if (!currentWork || !currentRelease) {
        throw new ConflictException({
          code: 'STORY_VISUAL_REPLACEMENT_SOURCE_CHANGED',
          message: 'The published source changed before the replacement result was returned',
        });
      }
    }
    return { ...result, workId, releaseId: release.id, releaseChecksum: release.checksum,
      sourceSceneKey: input.sourceSceneKey };
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
    const stale: Array<{ sourceSceneKey: string; assetId: string; updatedAt: Date }> = [];
    for (const row of ready) {
      if (!row.assetId) continue;
      const prompt = await this.prisma.storyVisualPrompt.findUnique({
        where: { workId_releaseId_sourceSceneKey: {
          workId, releaseId: release.id, sourceSceneKey: row.sourceSceneKey,
        } },
      });
      if (!prompt || prompt.releaseChecksum !== release.checksum) continue;
      const effective = await this.effectiveVisualPrompt(workId, release.id, release.checksum, prompt.promptText, row.sourceSceneKey);
      const identity = await this.readyAssetIdentity(row.assetId);
      if (!this.visualIdentityCurrent(identity, effective, {
        workId, releaseId: release.id, releaseChecksum: release.checksum,
        sourceSceneKey: row.sourceSceneKey, variantKey: DEFAULT_VISUAL_VARIANT.key,
        promptSha256: prompt.promptSha256,
      })) {
        stale.push({ sourceSceneKey: row.sourceSceneKey, assetId: row.assetId, updatedAt: row.updatedAt });
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
        id: true,
        userId: true,
        workId: true,
        releaseId: true,
        releaseChecksum: true,
        progressId: true,
        sourcePartId: true,
        locale: true,
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
    if (continuation.releaseChecksum !== release.checksum) {
      throw new ConflictException({ code: 'STORY_VISUAL_BRANCH_SOURCE_CHANGED' });
    }
    const scene = await this.prisma.storyAiGeneratedScene.findFirst({
      where: { id: continuation.resultGeneratedSceneId, continuationId, workId: continuation.workId,
        releaseId: continuation.releaseId, userId: continuation.userId, progressId: continuation.progressId,
        sourcePartId: continuation.sourcePartId, status: 'ready' },
      select: { id: true, sceneKey: true, title: true, resultChecksum: true },
    });
    if (!scene || ![`ai-${continuationId}`, `ai-reuse-${continuationId}`].includes(scene.sceneKey) ||
        !/^[a-f0-9]{64}$/.test(scene.resultChecksum)) {
      throw new ConflictException({ code: 'STORY_VISUAL_BRANCH_SOURCE_CHANGED' });
    }
    const storedBeats = await this.prisma.storyAiGeneratedBeat.findMany({
      where: { sceneId: scene.id }, orderBy: [{ position: 'asc' }, { id: 'asc' }], take: 41,
      select: { position: true, beatType: true, content: true },
    });
    // Provider arguments are not the source of truth after the continuation has been stored.
    const { title, prose } = verifiedStoredBranchVisualNarrative(continuation.locale, scene.title, storedBeats, result);
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
        const snapshot = continuationGenerationProfileVisualSnapshot(profile);
        if (stableContinuationJson(snapshot.pin) !== stableContinuationJson(pin)) {
          throw new Error('profile_changed');
        }
        visualProfile = JSON.stringify({
          schemaVersion: snapshot.approved.schemaVersion,
          sections: snapshot.approved.sections,
        });
        if (visualProfile.length > 12_000) throw new Error('profile_changed');
      }
      const participant = references.participantPin === undefined || references.participantPin === null
        ? null : await this.branchParticipantContext(this.prisma, continuation.progressId, references.participantPin);
      if (participant) {
        participantProfile = JSON.stringify(participant.approved);
        if (participantProfile.length > 12_000) throw new Error('profile_changed');
      }
    } catch (error) {
      this.logger.warn({ event: 'story_visual_profile_resolution_failed', continuationId,
        code: error instanceof Error && error.message === 'profile_missing' ? 'PROFILE_MISSING'
          : error instanceof Error && error.message === 'profile_changed' ? 'PROFILE_CHANGED'
            : 'PROFILE_LOOKUP_FAILED' });
      if (!this.visualApprovalChanged(error) && !(error instanceof BadRequestException) &&
          !(error instanceof Error && ['profile_missing', 'profile_changed', 'generation_profile_pin_invalid',
            'generation_profile_not_approved', 'generation_profile_fingerprint_changed',
            'generation_profile_context_too_large'].includes(error.message))) throw error;
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
    if (promptText.length > 32_000) throw new ConflictException({ code: 'STORY_VISUAL_PROFILE_CHANGED' });
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

  private async branchParticipantContext(db: PrismaService | Prisma.TransactionClient, progressId: string, expectedPin: unknown) {
    let participant: Awaited<ReturnType<StoryArtistParticipantService['pinnedContext']>>;
    try {
      participant = this.storyParticipants ? await this.storyParticipants.pinnedContext(db, progressId) : null;
    } catch (error) {
      if (error instanceof ConflictException && this.record(error.getResponse()).code === 'STORY_PARTICIPANT_IDENTITY_CHANGED') {
        throw new ConflictException({ code: 'STORY_VISUAL_PROFILE_CHANGED' });
      }
      throw error;
    }
    if (!participant?.approved.visualIdentityReady || !participant.pin.identityProfileId ||
        stableContinuationJson(participant.pin) !== stableContinuationJson(expectedPin)) {
      throw new ConflictException({ code: 'STORY_VISUAL_PROFILE_CHANGED' });
    }
    return participant;
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

  async bookingReview(workId: string, afterId?: string, ownerUserId?: string) {
    return this.queue.bookingReview(workId, afterId, ownerUserId);
  }

  async reprepareBooking(actorUserId: string, workId: string, input: ReprepareStoryVisualBookingDto, asOwner = false) {
    return this.queue.reprepareBooking(actorUserId, workId, input, asOwner);
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
      candidate.sourceSceneKey, signal, false, DEFAULT_VISUAL_VARIANT, candidate.bookingIdentity);
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
    queuedIdentity?: StoryVisualBookingIdentity,
  ): Promise<StoryVisualGenerationResult> {
    if (!queuedIdentity) {
      const origin = await this.sharedBranchVisualOrigin(workId, releaseId, releaseChecksum, sourceSceneKey, variant.key, { repairMissingOrigin: true });
      if (origin) {
        // Exact shared clones use one canonical generation claim, not a reader-specific image job.
        const result = await this.generate(workId, releaseId, releaseChecksum, origin.sourceSceneKey, signal, replaceStale, variant);
        const current = await this.sharedBranchVisualOrigin(workId, releaseId, releaseChecksum, sourceSceneKey, variant.key);
        if (current?.identity !== origin.identity) throw new ConflictException({ code: 'STORY_BRANCH_VISUAL_REVIEW_SOURCE_CHANGED' });
        return { ...result, ...('sourceSceneKey' in result ? { sourceSceneKey } : {}) };
      }
    }
    const prompt = await this.prisma.storyVisualPrompt.findUnique({
      where: { workId_releaseId_sourceSceneKey: { workId, releaseId, sourceSceneKey } },
    });
    if (!prompt || prompt.releaseChecksum !== releaseChecksum) return { status: 'unavailable', reason: 'prompt_missing' } as const;
    const binding = { workId, releaseId, releaseChecksum, sourceSceneKey, variantKey: variant.key,
      promptSha256: prompt.promptSha256 };
    let existing = await this.ensureGeneration(prompt, variant.key);
    let effective: Awaited<ReturnType<StoryVisualGenerationService['effectiveVisualPrompt']>> | null = null;
    let replacedAssetId: string | null = null;
    let previousReplacementErrorCode: string | null = null;
    let replacementFailureCode: string | null = null;
    let replacementClaimCode: string | null = null;
    let claimStartedAt: Date | null = null;
    let booking = existing.bookingIdentity ?? null;
    const previousBooking = existing.bookingIdentity;
    if ((booking || queuedIdentity) && existing.status !== 'ready' &&
        (!await this.queue.allowsCandidate(binding, this.prisma, booking ?? queuedIdentity) ||
          (this.publicBeta && !this.publicBeta.allows(workId, releaseId, releaseChecksum)))) {
      return { status: 'unavailable', reason: 'visual_queue_scope_unavailable' } as const;
    }
    if ((booking || queuedIdentity) && existing.status !== 'ready') {
      try {
        effective = await this.effectiveVisualPrompt(workId, releaseId, releaseChecksum, prompt.promptText, sourceSceneKey);
        const identity = storyVisualBookingMatches(booking, binding);
        const expected = this.bookingBasis(prompt, effective);
        if (!identity || identity.identitySha256 !== expected.identitySha256 ||
            (queuedIdentity && identity.identitySha256 !== queuedIdentity.identitySha256)) throw new Error('STORY_VISUAL_BOOKING_CHANGED');
      } catch (error) {
        if (!this.visualApprovalChanged(error) && !(error instanceof Error &&
            ['STORY_VISUAL_BOOKING_CHANGED', 'STORY_VISUAL_PROFILE_CHANGED', 'STORY_VISUAL_BIBLE_SOURCE_MISSING'].includes(error.message))) throw error;
        const staleBefore = new Date(Date.now() - this.numberFromEnv('STORY_IMAGE_GENERATION_STALE_SECONDS', 180) * 1000);
        await this.prisma.storyVisualGeneration.updateMany({ where: { id: existing.id,
          bookingIdentity: { equals: existing.bookingIdentity ?? Prisma.DbNull },
          OR: [{ status: { in: ['pending', 'failed'] } },
            { status: 'generating', updatedAt: { lt: staleBefore }, startedAt: existing.startedAt }] },
          data: { status: 'failed', lastErrorCode: 'STORY_VISUAL_BOOKING_CHANGED', startedAt: null, updatedAt: new Date() } });
        return { status: 'unavailable', reason: 'visual_booking_changed' } as const;
      }
    }
    if (existing.status === 'ready' && existing.assetId) {
      effective = await this.effectiveVisualPrompt(workId, releaseId, releaseChecksum, prompt.promptText, sourceSceneKey);
      await this.assertPromptApprovalCurrent(this.prisma, workId, releaseId, prompt, effective.bible);
      const identity = await this.readyAssetIdentity(existing.assetId);
      effective = await this.effectiveVisualPrompt(workId, releaseId, releaseChecksum, prompt.promptText, sourceSceneKey);
      await this.assertPromptApprovalCurrent(this.prisma, workId, releaseId, prompt, effective.bible);
      const requestedIdentity = this.requestedVisualIdentity(effective.quality);
      if (queuedIdentity && storyVisualBookingMatches(existing.bookingIdentity, binding)?.identitySha256 !== queuedIdentity.identitySha256) {
        return { status: 'unavailable', reason: 'visual_booking_changed' } as const;
      }
      const identityCurrent = existing.releaseChecksum === releaseChecksum &&
        this.visualIdentityCurrent(identity, effective, binding) &&
        this.visualBookingAssetCurrent(existing.bookingIdentity, prompt, effective, identity);
      if (!replaceStale) {
        return identityCurrent ? this.readyResult(sourceSceneKey, existing.assetId, true)
          : { status: 'unavailable', reason: 'visual_identity_changed' } as const;
      }
      if (identityCurrent) {
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
      if (existing.lastErrorCode?.startsWith('STALE_REPLACEMENT_IN_PROGRESS_')) {
        const staleBefore = new Date(Date.now() - this.numberFromEnv('STORY_IMAGE_GENERATION_STALE_SECONDS', 180) * 1000);
        if (existing.updatedAt >= staleBefore) return { status: 'processing', sourceSceneKey } as const;
        const originalAsset = await this.prisma.asset.findFirst({ where: { id: existing.assetId }, select: { metadata: true } });
        const originalBooking = parsedStoryVisualBooking(this.record(this.record(originalAsset?.metadata).storyVisual).bookingIdentity);
        const expiredCode = existing.lastErrorCode.replace('STALE_REPLACEMENT_IN_PROGRESS_', 'STALE_REPLACEMENT_FAILED_');
        const expired = await this.prisma.storyVisualGeneration.updateMany({
          where: { id: existing.id, status: 'ready', assetId: existing.assetId,
            lastErrorCode: existing.lastErrorCode, updatedAt: { lt: staleBefore } },
          data: { lastErrorCode: expiredCode, startedAt: null, updatedAt: new Date(),
            ...(previousBooking ? { bookingIdentity: originalBooking ?? Prisma.DbNull } : {}) },
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
      await this.assertPromptApprovalCurrent(this.prisma, workId, releaseId, prompt, effective.bible);
      previousReplacementErrorCode = existing.lastErrorCode;
      booking = previousBooking ? this.bookingBasis(prompt, effective) : null;
      claimStartedAt = new Date();
      const replacementClaim = await this.prisma.storyVisualGeneration.updateMany({
        where: {
          id: existing.id,
          status: 'ready',
          assetId: existing.assetId,
          promptSha256: prompt.promptSha256,
          lastErrorCode: existing.lastErrorCode,
          bookingIdentity: { equals: existing.bookingIdentity ?? Prisma.DbNull },
        },
        data: {
          provider: 'openai',
          model: this.model(),
          quality: effective.quality,
          size: this.size(),
          lastErrorCode: claimCode,
          startedAt: claimStartedAt,
          updatedAt: new Date(),
          ...(booking ? { bookingIdentity: booking } : {}),
        },
      });
      if (!replacementClaim.count) {
        const current = await this.prisma.storyVisualGeneration.findUnique({ where: { id: existing.id } });
        if (current?.status === 'ready' && current.lastErrorCode === failureCode) {
          return { status: 'failed', sourceSceneKey, retryable: false } as const;
        }
        if (current?.status === 'ready' && current.assetId) {
          const currentIdentity = await this.readyAssetIdentity(current.assetId);
          effective = await this.effectiveVisualPrompt(workId, releaseId, releaseChecksum, prompt.promptText, sourceSceneKey);
          await this.assertPromptApprovalCurrent(this.prisma, workId, releaseId, prompt, effective.bible);
          return current.releaseChecksum === releaseChecksum &&
            this.visualIdentityCurrent(currentIdentity, effective, binding) &&
            this.visualBookingAssetCurrent(current.bookingIdentity, prompt, effective, currentIdentity)
            ? this.readyResult(sourceSceneKey, current.assetId, true)
            : { status: 'processing', sourceSceneKey } as const;
        }
        return { status: current?.status === 'failed' ? 'failed' : 'processing', sourceSceneKey } as const;
      }
      replacedAssetId = existing.assetId;
      existing = { ...existing, status: 'generating',
        lastErrorCode: claimCode, startedAt: claimStartedAt, updatedAt: new Date() };
    }
    if (!replacedAssetId) {
      if (!this.enabled()) return { status: 'unavailable', reason: 'generation_disabled' } as const;
      const preflight = this.providerPreflight();
      if (preflight) return { status: 'unavailable', reason: preflight } as const;
      if (await this.overBudget(workId, releaseId, existing.status === 'generating')) {
        return { status: 'unavailable', reason: 'beta_generation_limit_reached' } as const;
      }
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
    effective ??= await this.effectiveVisualPrompt(workId, releaseId, releaseChecksum, prompt.promptText, sourceSceneKey);
    if (!replacedAssetId) await this.assertPromptApprovalCurrent(this.prisma, workId, releaseId, prompt, effective.bible);
    claimStartedAt ??= new Date();
    const claimed = replacedAssetId ? { count: 1 } : await this.prisma.storyVisualGeneration.updateMany({
      where: {
        id: existing.id,
        promptSha256: prompt.promptSha256,
        bookingIdentity: { equals: existing.bookingIdentity ?? Prisma.DbNull },
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
        startedAt: claimStartedAt,
        updatedAt: new Date(),
      },
    });
    if (!claimed.count) {
      const current = await this.prisma.storyVisualGeneration.findUnique({ where: { id: existing.id } });
      if (current?.status === 'ready' && current.assetId) {
        const currentIdentity = await this.readyAssetIdentity(current.assetId);
        effective = await this.effectiveVisualPrompt(workId, releaseId, releaseChecksum, prompt.promptText, sourceSceneKey);
        await this.assertPromptApprovalCurrent(this.prisma, workId, releaseId, prompt, effective.bible);
        return current.releaseChecksum === releaseChecksum &&
          this.visualIdentityCurrent(currentIdentity, effective, binding) &&
          this.visualBookingAssetCurrent(current.bookingIdentity, prompt, effective, currentIdentity)
          ? this.readyResult(sourceSceneKey, current.assetId, true)
          : { status: 'unavailable', reason: 'visual_identity_changed' } as const;
      }
      return { status: current?.status === 'failed' ? 'failed' : 'processing', sourceSceneKey } as const;
    }

    let providerStarted = false;
    try {
      await this.assertEffectiveVisualCurrent(workId, releaseId, releaseChecksum, prompt.promptText, effective, sourceSceneKey);
      await this.assertPromptApprovalCurrent(this.prisma, workId, releaseId, prompt, effective.bible);
      const image = await this.generateImage(
        effective.prompt,
        variant.references,
        effective.quality,
        signal,
        effective.workReference,
        Boolean(effective.bible.approvalFingerprint),
        async (dispatch, requestSignal) => {
          let response: Promise<Response> | undefined;
          // Initiate dispatch under the approval lock, then wait for the provider outside it.
          await this.prisma.$transaction(async tx => {
            await this.assertLockedVisualCurrent(tx, workId, releaseId, releaseChecksum, sourceSceneKey, prompt, effective!);
            await this.assertBookingUnchanged(tx, existing.id, booking);
            await this.assertGenerationClaim(tx, existing.id, claimStartedAt!, replacedAssetId, replacementClaimCode);
            await this.assertQueuedScopeCurrent(booking, binding, tx);
            requestSignal.throwIfAborted();
            response = dispatch();
            providerStarted = true;
            void response.catch(() => {});
          }, { maxWait: 5000, timeout: 30000 });
          if (!response) throw new Error('STORY_VISUAL_PROFILE_CHANGED');
          return response;
        },
      );
      await this.assertEffectiveVisualCurrent(workId, releaseId, releaseChecksum, prompt.promptText, effective, sourceSceneKey);
      await this.assertPromptApprovalCurrent(this.prisma, workId, releaseId, prompt, effective.bible);
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
        await this.assertLockedVisualCurrent(tx, workId, releaseId, releaseChecksum, sourceSceneKey, prompt, effective!);
        await this.assertBookingUnchanged(tx, existing.id, booking);
        await this.assertGenerationClaim(tx, existing.id, claimStartedAt!, replacedAssetId, replacementClaimCode);
        await this.assertQueuedScopeCurrent(booking, binding, tx);
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
              ...(booking ? { bookingIdentity: booking, bookingIdentitySha256: storyVisualBookingMatches(booking, binding)!.identitySha256 } : {}),
              ...(effective!.review ? { sceneGuidanceApproval: this.sceneReviewIdentity(effective!.review),
                sceneGuidanceApprovalSha256: this.sha256Hex(JSON.stringify(this.sceneReviewIdentity(effective!.review))) } : {}),
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
        await this.assertQueuedScopeCurrent(booking, binding, tx);
        return created;
      });
      this.logger.log({ event: 'story_visual_generated', workId, sourceSceneKey,
        promptSha256: prompt.promptSha256, model: this.model(), quality: effective.quality, bytes: image.length });
      return this.readyResult(sourceSceneKey, asset.id, false);
    } catch (error) {
      const code = signal?.aborted ? 'PROVIDER_OUTCOME_UNKNOWN' : this.safeGenerationError(error);
      const pausedUnspent = code === 'STORY_VISUAL_QUEUE_SCOPE_UNAVAILABLE' && !providerStarted && !storageRecovery &&
        !replacedAssetId && existing.status === 'pending' && existing.attemptCount === 0 &&
        existing.provider == null && existing.model == null && existing.quality == null && existing.size == null && existing.assetId == null &&
        existing.checksumSha256 == null && existing.completedAt == null && existing.startedAt == null;
      await this.prisma.storyVisualGeneration.updateMany({
        where: replacedAssetId && replacementClaimCode
          ? { id: existing.id, status: 'ready', assetId: replacedAssetId, lastErrorCode: replacementClaimCode, startedAt: claimStartedAt }
          : { id: existing.id, status: 'generating', startedAt: claimStartedAt },
        data: replacedAssetId && replacementFailureCode
          ? { status: 'ready', assetId: replacedAssetId,
            lastErrorCode: providerStarted ? replacementFailureCode : previousReplacementErrorCode,
            ...(previousBooking ? { bookingIdentity: previousBooking } : {}),
            startedAt: null, updatedAt: new Date() }
          : { status: pausedUnspent ? 'pending' : 'failed', lastErrorCode: pausedUnspent ? (existing.lastErrorCode ?? null) : code,
            startedAt: null, updatedAt: new Date(),
            ...(pausedUnspent ? { provider: null, model: null, quality: null, size: null } : {}),
            ...(!providerStarted && !storageRecovery ? { attemptCount: { decrement: 1 } } : {}) } });
      this.logger.warn({ event: 'story_visual_generation_failed', workId, sourceSceneKey,
        promptSha256: prompt.promptSha256, code });
      return { status: 'failed', sourceSceneKey, retryable: !providerStarted } as const;
    }
  }

  private bookingBasis(prompt: { workId: string; releaseId: string; releaseChecksum: string; sourceSceneKey: string;
    promptSha256: string; sourceKind?: string; sourceBindingSha256?: string },
    effective: ReturnType<StoryVisualGenerationService['composeEffectiveVisualPrompt']>) {
    return storyVisualBookingIdentity({ workId: prompt.workId, releaseId: prompt.releaseId,
      releaseChecksum: prompt.releaseChecksum, sourceSceneKey: prompt.sourceSceneKey, promptSha256: prompt.promptSha256,
      variantKey: 'default', sourceKind: prompt.sourceKind ?? null, sourceBindingSha256: prompt.sourceBindingSha256 ?? null,
      visualBibleVersion: effective.bible.version, visualBibleFingerprint: effective.bible.fingerprint,
      authorApprovalIdentitySha256: effective.bible.approvalIdentity
        ? this.sha256Hex(stableContinuationJson(effective.bible.approvalIdentity)) : null,
      sceneGuidanceApprovalSha256: effective.review ? this.sha256Hex(stableContinuationJson(this.sceneReviewIdentity(effective.review))) : null,
      coverSourceFingerprint: effective.coverSourceFingerprint, workVisualReferenceChecksum: effective.workReference?.checksum ?? null,
      effectivePromptSha256: effective.sha256, ...this.requestedVisualIdentity(effective.quality) });
  }

  private visualBookingAssetCurrent(booking: unknown,
    prompt: Parameters<StoryVisualGenerationService['bookingBasis']>[0],
    effective: Parameters<StoryVisualGenerationService['bookingBasis']>[1],
    asset: ReturnType<StoryVisualGenerationService['assetIdentity']>) {
    if (booking == null) return asset.bookingIdentitySha256 === null;
    const identity = storyVisualBookingMatches(booking, prompt);
    return Boolean(identity && identity.identitySha256 === this.bookingBasis(prompt, effective).identitySha256 &&
      asset.bookingIdentitySha256 === identity.identitySha256);
  }

  private async bookQueuedVisual(candidate: StoryVisualQueueCandidate, tx: Prisma.TransactionClient) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${candidate.workId}::uuid FOR SHARE`);
    const prompt = await tx.storyVisualPrompt.findUnique({ where: { workId_releaseId_sourceSceneKey: {
      workId: candidate.workId, releaseId: candidate.releaseId, sourceSceneKey: candidate.sourceSceneKey } } });
    if (!prompt || prompt.releaseChecksum !== candidate.releaseChecksum || prompt.promptSha256 !== candidate.promptSha256) return null;
    try {
      if (this.publicBeta && !this.publicBeta.allows(candidate.workId, candidate.releaseId, candidate.releaseChecksum)) return null;
      const effective = await this.effectiveVisualPrompt(candidate.workId, candidate.releaseId, candidate.releaseChecksum,
        prompt.promptText, candidate.sourceSceneKey);
      await this.assertLockedVisualCurrent(tx, candidate.workId, candidate.releaseId, candidate.releaseChecksum,
        candidate.sourceSceneKey, prompt, effective);
      return this.bookingBasis(prompt, effective);
    } catch (error) {
      if (this.visualApprovalChanged(error) || (error instanceof Error &&
          ['STORY_VISUAL_PROFILE_CHANGED', 'STORY_VISUAL_BIBLE_SOURCE_MISSING'].includes(error.message))) return null;
      throw error;
    }
  }

  private sharedBranchVisualReuseEnabled() {
    return this.config.get<string>('STORY_SHARED_BRANCH_VISUAL_REUSE_ENABLED') === 'true';
  }

  async sharedBranchManifest(workId: string, releaseId: string, sourceSceneKey: string, manifest: Prisma.JsonValue) {
    if (!this.sharedBranchVisualReuseEnabled() || !sourceSceneKey.startsWith('ai-reuse-')) return null;
    if (this.config.get<string>('STORY_BRANCH_VISUAL_REVIEW_ENABLED') !== 'true' || !this.branchVisualReviews) return null;
    const release = await this.prisma.storyRelease.findFirst({ where: { id: releaseId, workId, status: 'active' }, select: { checksum: true } });
    if (!release) return null;
    try {
      const origin = await this.branchVisualReviews.projectionForGeneratedSource(this.prisma, workId, releaseId, release.checksum, sourceSceneKey);
      const stored = this.record(manifest);
      // Approved snapshots stay immutable; only the reader-facing scene key is rebound.
      return stored.sceneKey === origin.sceneKey &&
        stableContinuationJson(manifest) === stableContinuationJson(origin.visualManifest)
        ? { ...stored, sceneKey: sourceSceneKey } : null;
    } catch (error) {
      if (this.visualApprovalChanged(error)) return null;
      throw error;
    }
  }

  private async sharedBranchVisualOrigin(workId: string, releaseId: string, checksum: string, sourceSceneKey: string, variantKey: string,
    options: { repairMissingOrigin?: boolean } = {}) {
    if (!this.sharedBranchVisualReuseEnabled() || !sourceSceneKey.startsWith('ai-reuse-')) return null;
    if (this.config.get<string>('STORY_BRANCH_VISUAL_REVIEW_ENABLED') !== 'true' || !this.branchVisualReviews) {
      throw new ConflictException({ code: 'STORY_BRANCH_VISUAL_REVIEW_APPROVAL_REQUIRED' });
    }
    const existing = await this.prisma.storyVisualGeneration.findUnique({ where: {
      workId_releaseId_sourceSceneKey_variantKey: { workId, releaseId, sourceSceneKey, variantKey } },
    select: { status: true, attemptCount: true, bookingIdentity: true } });
    // Never reinterpret an existing reservation or an attempted paid request.
    if (existing && (existing.status === 'ready' || existing.status === 'generating' || existing.attemptCount > 0 || existing.bookingIdentity)) return null;
    const scene = await this.prisma.storyAiGeneratedScene.findFirst({ where: { workId, releaseId, sceneKey: sourceSceneKey, status: 'ready' },
      select: { sharedResultId: true, resultChecksum: true } });
    if (!scene?.sharedResultId) throw new ConflictException({ code: 'STORY_BRANCH_VISUAL_REVIEW_SOURCE_CHANGED' });
    const result = await this.prisma.storyAiReusableResult.findFirst({ where: { id: scene.sharedResultId, workId, releaseId,
      releaseChecksum: checksum, resultChecksum: scene.resultChecksum, status: 'approved' },
    select: { originGeneratedSceneId: true, resultChecksum: true } });
    if (!result?.resultChecksum) throw new ConflictException({ code: 'STORY_BRANCH_VISUAL_REVIEW_SOURCE_CHANGED' });
    const origin = result.originGeneratedSceneId ? await this.prisma.storyAiGeneratedScene.findFirst({ where: {
      id: result.originGeneratedSceneId, workId, releaseId, status: 'ready', sharedResultId: scene.sharedResultId,
      resultChecksum: result.resultChecksum }, select: { id: true, sceneKey: true, continuationId: true, visualManifest: true } }) : null;
    if (!origin || origin.sceneKey !== `ai-${origin.continuationId}`) throw new ConflictException({ code: 'STORY_BRANCH_VISUAL_REVIEW_SOURCE_CHANGED' });
    const prompts = await this.prisma.storyVisualPrompt.findMany({ where: { workId, releaseId,
      sourceSceneKey: { in: [sourceSceneKey, origin.sceneKey] }, releaseChecksum: checksum, sourceKind: 'ai_branch' },
    select: { sourceSceneKey: true, promptSha256: true } });
    const targetPrompt = prompts.find(prompt => prompt.sourceSceneKey === sourceSceneKey);
    let originPrompt = prompts.find(prompt => prompt.sourceSceneKey === origin.sceneKey);
    if (!originPrompt && options.repairMissingOrigin) {
      await this.recoverGeneratedContinuationPrompt(origin.id);
      originPrompt = await this.prisma.storyVisualPrompt.findUnique({ where: {
        workId_releaseId_sourceSceneKey: { workId, releaseId, sourceSceneKey: origin.sceneKey } },
      select: { sourceSceneKey: true, promptSha256: true } }) ?? undefined;
    }
    if (!targetPrompt || !originPrompt) throw new ConflictException({ code: 'STORY_BRANCH_VISUAL_REVIEW_SOURCE_CHANGED' });
    const targetReview = await this.branchVisualReviews.approvedForGeneratedSource(this.prisma, workId, releaseId,
      checksum, sourceSceneKey, targetPrompt.promptSha256);
    const originReview = await this.branchVisualReviews.approvedForGeneratedSource(this.prisma, workId, releaseId,
      checksum, origin.sceneKey, originPrompt.promptSha256);
    const sharedIdentity = (review: typeof targetReview) => stableContinuationJson({ batchId: review.batchId,
      batchChecksum: review.batchChecksum, sourceChecksum: review.sourceChecksum, profilePinHash: review.profilePinHash,
      manuscriptVersionId: review.manuscriptVersionId, manuscriptHash: review.manuscriptHash,
      promptSha256: review.promptSha256, approvedByUserId: review.approvedByUserId, approvedAt: review.approvedAt });
    const identity = sharedIdentity(targetReview);
    if (identity !== sharedIdentity(originReview)) throw new ConflictException({ code: 'STORY_BRANCH_VISUAL_REVIEW_SOURCE_CHANGED' });
    return { sourceSceneKey: origin.sceneKey, identity, visualManifest: origin.visualManifest };
  }

  private async assertBookingUnchanged(tx: Prisma.TransactionClient, id: string, expected: Prisma.JsonValue) {
    const row = await tx.storyVisualGeneration.findUnique({ where: { id }, select: { bookingIdentity: true } });
    if (!row || stableContinuationJson(row.bookingIdentity ?? null) !== stableContinuationJson(expected)) throw new Error('STORY_VISUAL_BOOKING_CHANGED');
  }

  private async assertQueuedScopeCurrent(booking: Prisma.JsonValue | null,
    binding: Pick<StoryVisualQueueCandidate, 'workId' | 'releaseId' | 'releaseChecksum'>, tx: Prisma.TransactionClient) {
    if (booking && (!await this.queue.allowsCandidate(binding, tx, booking) || (this.publicBeta &&
        !this.publicBeta.allows(binding.workId, binding.releaseId, binding.releaseChecksum)))) {
      throw new Error('STORY_VISUAL_QUEUE_SCOPE_UNAVAILABLE');
    }
  }

  private async assertGenerationClaim(tx: Prisma.TransactionClient, id: string, startedAt: Date,
    replacedAssetId: string | null, claimCode: string | null) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM story_visual_generations WHERE id = ${id}::uuid FOR UPDATE`);
    const row = await tx.storyVisualGeneration.findUnique({ where: { id },
      select: { status: true, startedAt: true, assetId: true, lastErrorCode: true } });
    if (!row || row.startedAt?.getTime() !== startedAt.getTime() || (replacedAssetId
      ? row.status !== 'ready' || row.assetId !== replacedAssetId || row.lastErrorCode !== claimCode
      : row.status !== 'generating')) throw new Error('STORY_VISUAL_CLAIM_LOST');
  }

  private async effectiveVisualPrompt(
    workId: string,
    releaseId: string,
    releaseChecksum: string,
    scenePrompt: string,
    sourceSceneKey?: string,
  ) {
    const coverSourceFingerprint = await this.currentCoverSourceFingerprint(workId);
    const [bible, workReference] = await Promise.all([
      this.visualBible(workId, releaseId, releaseChecksum),
      this.approvedStoryCoverReference(workId),
    ]);
    const review = await this.reviewedScenePrompt(this.prisma, workId, releaseId, releaseChecksum, sourceSceneKey, scenePrompt, bible);
    if (coverSourceFingerprint !== await this.currentCoverSourceFingerprint(workId)) throw new Error('STORY_VISUAL_PROFILE_CHANGED');
    return { ...this.composeEffectiveVisualPrompt(bible, workReference, review?.promptText ?? scenePrompt, review), coverSourceFingerprint };
  }

  private coverSourceFingerprint(work: { ownerUserId?: string | null; slug?: string; coverManifest?: Prisma.JsonValue } | null) {
    return this.sha256Hex(stableContinuationJson({ ownerUserId: work?.ownerUserId ?? null,
      slug: work?.slug ?? null, coverManifest: work?.coverManifest ?? null }));
  }

  private async currentCoverSourceFingerprint(workId: string) {
    const work = await this.prisma.storyWork.findFirst({ where: { id: workId, fixtureSource: false },
      select: { ownerUserId: true, slug: true, coverManifest: true } });
    return this.coverSourceFingerprint(work);
  }

  private async assertEffectiveVisualCurrent(workId: string, releaseId: string, checksum: string,
    promptText: string, expected: Awaited<ReturnType<StoryVisualGenerationService['effectiveVisualPrompt']>>, sourceSceneKey?: string) {
    const bible = await this.visualBible(workId, releaseId, checksum);
    if (bible.approvalFingerprint !== expected.bible.approvalFingerprint) throw new Error('STORY_VISUAL_PROFILE_CHANGED');
    if (await this.currentCoverSourceFingerprint(workId) !== expected.coverSourceFingerprint) throw new Error('STORY_VISUAL_PROFILE_CHANGED');
    if (bible.approvalFingerprint) {
      const current = await this.effectiveVisualPrompt(workId, releaseId, checksum, promptText, sourceSceneKey);
      if (current.sha256 !== expected.sha256) throw new Error('STORY_VISUAL_PROFILE_CHANGED');
    }
  }

  private async reviewedScenePrompt(db: PrismaService | Prisma.TransactionClient, workId: string, releaseId: string,
    checksum: string, sourceSceneKey: string | undefined, originalPrompt: string, bible: Pick<StoryVisualBible, 'approvalFingerprint'>) {
    if (sourceSceneKey?.startsWith('ai-') && this.config.get<string>('STORY_BRANCH_VISUAL_REVIEW_ENABLED') === 'true') {
      if (!this.branchVisualReviews) throw new ConflictException({ code: 'STORY_BRANCH_VISUAL_REVIEW_APPROVAL_REQUIRED' });
      return this.branchVisualReviews.approvedForGeneratedSource(db, workId, releaseId, checksum, sourceSceneKey, this.sha256Hex(originalPrompt));
    }
    if (!bible.approvalFingerprint) return null;
    if (!this.visualReviews || !sourceSceneKey) throw new ConflictException({ code: 'STUDIO_VISUAL_REVIEW_SOURCE_CHANGED' });
    return this.visualReviews.approvedForPublishedSource(db, workId, releaseId, checksum, sourceSceneKey, this.sha256Hex(originalPrompt));
  }

  private sceneReviewIdentity(review: NonNullable<Awaited<ReturnType<StoryVisualGenerationService['reviewedScenePrompt']>>>) {
    return { contract: 'story-visual-review-generation-v1', batchId: review.batchId, batchChecksum: review.batchChecksum,
      profilePinHash: review.profilePinHash, manuscriptVersionId: review.manuscriptVersionId, manuscriptHash: review.manuscriptHash,
      sourceChecksum: review.sourceChecksum, referenceIndex: review.referenceIndex, sourceSceneKey: review.sourceSceneKey,
      originalPromptSha256: review.originalPromptSha256, promptSha256: review.promptSha256, bindingSha256: review.bindingSha256,
      approvedAt: review.approvedAt, ...(review.partSelection ? { partSelection: review.partSelection } : {}) };
  }

  private async assertReviewedSceneCurrent(db: PrismaService | Prisma.TransactionClient, workId: string, releaseId: string,
    checksum: string, sourceSceneKey: string, originalPrompt: string,
    expected: Awaited<ReturnType<StoryVisualGenerationService['effectiveVisualPrompt']>>) {
    const review = await this.reviewedScenePrompt(db, workId, releaseId, checksum, sourceSceneKey, originalPrompt, expected.bible);
    if (JSON.stringify(review ? this.sceneReviewIdentity(review) : null) !==
        JSON.stringify(expected.review ? this.sceneReviewIdentity(expected.review) : null)) {
      throw new Error('STORY_VISUAL_PROFILE_CHANGED');
    }
  }

  private async assertLockedVisualCurrent(tx: Prisma.TransactionClient, workId: string, releaseId: string, checksum: string,
    sourceSceneKey: string, prompt: { promptText: string; sourceKind: string; sourceSceneKey: string },
    expected: Awaited<ReturnType<StoryVisualGenerationService['effectiveVisualPrompt']>>) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${workId}::uuid FOR SHARE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM story_style_profile_consents WHERE work_id = ${workId}::uuid FOR SHARE`);
    const work = await tx.storyWork.findFirst({ where: { id: workId, status: 'published', activeReleaseId: releaseId,
      fixtureSource: false }, select: { id: true, ownerUserId: true, slug: true, coverManifest: true } });
    const release = await tx.storyRelease.findFirst({ where: { id: releaseId, workId, checksum, status: 'active' },
      select: { manuscriptVersionId: true } });
    if (!work || !release || this.coverSourceFingerprint(work) !== expected.coverSourceFingerprint) throw new Error('STORY_VISUAL_PROFILE_CHANGED');
    const current = await currentApprovedStoryVisual(tx, work, release.manuscriptVersionId);
    if (current?.fingerprint !== expected.bible.approvalFingerprint) throw new Error('STORY_VISUAL_PROFILE_CHANGED');
    await this.assertPromptApprovalCurrent(tx, workId, releaseId, prompt, expected.bible);
    await this.assertReviewedSceneCurrent(tx, workId, releaseId, checksum, sourceSceneKey, prompt.promptText, expected);
  }

  private async assertPromptApprovalCurrent(db: PrismaService | Prisma.TransactionClient,
    workId: string, releaseId: string, prompt: { sourceKind: string; sourceSceneKey: string },
    bible: Pick<StoryVisualBible, 'approvalFingerprint' | 'approvalIdentity'>) {
    if (prompt.sourceKind !== 'ai_branch') return;
    const scene = await db.storyAiGeneratedScene.findFirst({ where: { workId, releaseId, sceneKey: prompt.sourceSceneKey, status: 'ready' },
      select: { id: true, continuationId: true } });
    const continuation = scene ? await db.storyAiContinuation.findFirst({ where: { id: scene.continuationId, workId, releaseId,
      resultGeneratedSceneId: scene.id, status: 'completed' }, select: { contextReferences: true, progressId: true } }) : null;
    if (!continuation) throw new ConflictException({ code: 'STORY_VISUAL_PROFILE_CHANGED' });
    const references = this.record(continuation.contextReferences);
    if (bible.approvalFingerprint) {
      try {
        const bound = parseContinuationGenerationProfilePin(references.generationProfilePin as Prisma.JsonValue);
        const current = parseContinuationGenerationProfilePin(bible.approvalIdentity as Prisma.JsonValue);
        if (!bound || !current || stableContinuationJson(bound) !== stableContinuationJson(current)) throw new Error('changed');
      } catch {
        throw new ConflictException({ code: 'STORY_VISUAL_PROFILE_CHANGED',
          message: 'This branch image direction belongs to a different author approval' });
      }
    }
    if (references.participantPin !== undefined && references.participantPin !== null) {
      await this.branchParticipantContext(db, continuation.progressId, references.participantPin);
    }
  }

  private composeEffectiveVisualPrompt(
    bible: StoryVisualBible,
    workReference: StoryWorkVisualReference | null,
    scenePrompt: string,
    review: Awaited<ReturnType<StoryVisualGenerationService['reviewedScenePrompt']>> = null,
  ) {
    const prompt = composeStoryVisualPrompt(bible, scenePrompt);
    const quality = workReference ? this.fixedStoryQuality() : this.quality();
    const identity = review ? this.sceneReviewIdentity(review) : null;
    return { bible, prompt, workReference, quality, review, coverSourceFingerprint: null as string | null,
      sha256: this.sha256Hex(JSON.stringify([prompt, workReference?.checksum ?? null, ...(identity ? [identity] : [])])) };
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
    effective: ReturnType<StoryVisualGenerationService['composeEffectiveVisualPrompt']>,
    binding: { workId: string; releaseId: string; releaseChecksum: string; sourceSceneKey: string;
      variantKey: string; promptSha256: string },
  ) {
    const requested = this.requestedVisualIdentity(effective.quality);
    return identity.active &&
      identity.workId === binding.workId && identity.releaseId === binding.releaseId &&
      identity.releaseChecksum === binding.releaseChecksum && identity.sourceSceneKey === binding.sourceSceneKey &&
      identity.variantKey === binding.variantKey && identity.promptSha256 === binding.promptSha256 &&
      identity.participantFingerprint === (binding.variantKey.startsWith('artist:')
        ? binding.variantKey.slice('artist:'.length) : null) &&
      identity.effectivePromptSha256 === effective.sha256 &&
      identity.sceneGuidanceApprovalSha256 === (effective.review ? this.sha256Hex(JSON.stringify(this.sceneReviewIdentity(effective.review))) : null) &&
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
    return this.assetIdentity(asset?.metadata);
  }

  private assetIdentity(metadata: unknown) {
    const source = this.record(metadata);
    const storyVisual = this.record(source.storyVisual);
    return {
      active: source.lifecycle === undefined || this.record(source.lifecycle).status === 'active',
      workId: storyVisual.workId,
      releaseId: storyVisual.releaseId,
      releaseChecksum: storyVisual.releaseChecksum,
      sourceSceneKey: storyVisual.sourceSceneKey,
      variantKey: storyVisual.variantKey,
      participantFingerprint: storyVisual.participantFingerprint ?? null,
      promptSha256: storyVisual.promptSha256,
      effectivePromptSha256: typeof storyVisual.effectivePromptSha256 === 'string'
        ? storyVisual.effectivePromptSha256 : null,
      sceneGuidanceApprovalSha256: typeof storyVisual.sceneGuidanceApprovalSha256 === 'string'
        ? storyVisual.sceneGuidanceApprovalSha256 : null,
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
      bookingIdentitySha256: typeof storyVisual.bookingIdentitySha256 === 'string' ? storyVisual.bookingIdentitySha256 : null,
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
      if (existing.promptSha256 !== prompt.promptSha256 || existing.releaseChecksum !== prompt.releaseChecksum) {
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
      const winner = await this.prisma.storyVisualGeneration.findUniqueOrThrow({
        where: { workId_releaseId_sourceSceneKey_variantKey: { workId: prompt.workId, releaseId: prompt.releaseId,
          sourceSceneKey: prompt.sourceSceneKey, variantKey } },
      });
      if (winner.promptSha256 !== prompt.promptSha256 || winner.releaseChecksum !== prompt.releaseChecksum) {
        throw new ConflictException({ code: 'STORY_VISUAL_PROMPT_GENERATION_MISMATCH', message: 'Visual generation binding changed' });
      }
      return winner;
    }
  }

  private async visualBible(workId: string, releaseId: string, releaseChecksum: string) {
    const [work, release, canonicalPrompts] = await Promise.all([
      this.prisma.storyWork.findFirst({
        where: { id: workId, fixtureSource: false, status: 'published', activeReleaseId: releaseId },
        select: { id: true, ownerUserId: true, slug: true, title: true, summary: true },
      }),
      this.prisma.storyRelease.findFirst({
        where: { id: releaseId, workId, checksum: releaseChecksum, status: 'active' },
        select: { manuscriptVersionId: true, localizedDisplaySnapshot: true, sceneAssetManifest: true },
      }),
      this.prisma.storyVisualPrompt.findMany({
        where: { workId, releaseId, releaseChecksum, sourceKind: { not: 'ai_branch' } },
        orderBy: [{ sourceSceneKey: 'asc' }, { createdAt: 'asc' }],
        take: 12,
        select: { promptText: true },
      }),
    ]);
    if (!work || !release) throw new Error('STORY_VISUAL_BIBLE_SOURCE_MISSING');
    const approved = await currentApprovedStoryVisual(this.prisma, work, release.manuscriptVersionId);
    const cacheKey = `${workId}:${releaseId}:${releaseChecksum}:${approved?.fingerprint ?? 'legacy'}`;
    const cached = this.visualBibleCache.get(cacheKey);
    if (cached) return cached;
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
      approvedVisualSettings: approved,
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

  private async visualVariantForGeneratedScene(generatedSceneId: string, progressId: string): Promise<StoryVisualVariant> {
    const scene = await this.prisma.storyAiGeneratedScene.findFirst({ where: { id: generatedSceneId, progressId, status: 'ready' },
      select: { id: true, continuationId: true, workId: true, releaseId: true, userId: true } });
    const continuation = scene ? await this.prisma.storyAiContinuation.findFirst({ where: { id: scene.continuationId,
      resultGeneratedSceneId: scene.id, progressId, workId: scene.workId, releaseId: scene.releaseId,
      userId: scene.userId, status: 'completed' }, select: { contextReferences: true } }) : null;
    if (!continuation) throw new ConflictException({ code: 'STORY_VISUAL_BRANCH_SOURCE_CHANGED' });
    const expected = this.record(continuation.contextReferences).participantPin;
    if (expected === undefined || expected === null) return DEFAULT_VISUAL_VARIANT;
    const participant = await this.branchParticipantContext(this.prisma, progressId, expected);
    const variant = await this.visualVariantForProgress(progressId);
    if (variant.participantFingerprint !== participant.pin.participantFingerprint ||
        variant.references.length !== participant.pin.referenceAssetIds.length ||
        variant.references.some((reference, index) => reference.assetId !== participant.pin.referenceAssetIds[index] ||
          reference.checksum !== participant.pin.referenceChecksums[index])) {
      throw new ConflictException({ code: 'STORY_VISUAL_PROFILE_CHANGED' });
    }
    return variant;
  }

  private async generateImage(
    prompt: string,
    references: StoryParticipantVisualReference[],
    quality: string,
    signal?: AbortSignal,
    workReference?: StoryWorkVisualReference | null,
    reviewedVisual = false,
    dispatchRequest?: (dispatch: () => Promise<Response>, signal: AbortSignal) => Promise<Response>,
  ) {
    const timeout = AbortSignal.timeout(this.numberFromEnv('STORY_IMAGE_GENERATION_TIMEOUT_MS', 120_000));
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    if (references.length || workReference) {
      response = await this.generateImageFromReferences(prompt, references, quality, requestSignal, workReference, reviewedVisual, dispatchRequest);
    } else {
      const request = {
          method: 'POST',
          headers: { authorization: `Bearer ${this.requiredEnv('OPENAI_API_KEY')}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: this.model(), prompt, n: 1, size: this.size(), quality,
            output_format: 'webp', output_compression: 86, moderation: 'auto' }),
          signal: requestSignal,
      };
      requestSignal.throwIfAborted();
      const dispatch = () => fetch('https://api.openai.com/v1/images/generations', request);
      response = await (dispatchRequest ? dispatchRequest(dispatch, requestSignal) : dispatch());
    }
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
    reviewedVisual = false,
    dispatchRequest?: (dispatch: () => Promise<Response>, signal: AbortSignal) => Promise<Response>,
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
        reviewedVisual ? 'For explicitly revised era, medium, palette, appearance, or costume, the current author-approved visual bible overrides this cover. Preserve only unchanged cover traits. Do not copy its poster composition or any text.'
          : 'Preserve its rendering medium, palette, recurring-character identity, age, face, hair, costume anchors, and overall world design. Do not copy its poster composition or any text.',
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
    const request = {
      method: 'POST',
      headers: { authorization: `Bearer ${this.requiredEnv('OPENAI_API_KEY')}` },
      body: form,
      signal,
    };
    signal.throwIfAborted();
    const dispatch = () => fetch('https://api.openai.com/v1/images/edits', request);
    return dispatchRequest ? dispatchRequest(dispatch, signal) : dispatch();
  }

  private async approvedStoryCoverReference(workId: string): Promise<StoryWorkVisualReference | null> {
    const inFlight = this.workVisualReferenceInFlight.get(workId);
    if (inFlight) return inFlight;
    const read = this.readApprovedStoryCoverReference(workId);
    this.workVisualReferenceInFlight.set(workId, read);
    try {
      return await read;
    } finally {
      if (this.workVisualReferenceInFlight.get(workId) === read) {
        this.workVisualReferenceInFlight.delete(workId);
      }
    }
  }

  private async readApprovedStoryCoverReference(workId: string): Promise<StoryWorkVisualReference | null> {
    const work = await this.prisma.storyWork.findFirst({
      where: { id: workId, fixtureSource: false },
      select: { slug: true, ownerUserId: true, coverManifest: true },
    });
    const manifest = this.record(work?.coverManifest);
    if (manifest.assetId !== undefined) {
      return this.readUploadedStoryCoverReference(manifest, work?.ownerUserId);
    }
    const registeredPath = typeof manifest.publicAssetPath === 'string' ? manifest.publicAssetPath : '';
    if (registeredPath && !this.localStoryCoverPath(registeredPath)) {
      throw new Error('STORY_VISUAL_COVER_REFERENCE_UNSUPPORTED');
    }
    const coverPath = registeredPath || APPROVED_STORY_COVERS.get(work?.slug ?? '');
    if (!coverPath) return null;
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
    if (!image) {
      throw new Error('STORY_VISUAL_COVER_REFERENCE_MISSING');
    }
    return this.validateStoryCoverReference(image,
      coverPath.split('/').at(-1) || `${work?.slug}-cover.png`);
  }

  private async readUploadedStoryCoverReference(
    manifest: Record<string, unknown>,
    ownerUserId: string | null | undefined,
  ): Promise<StoryWorkVisualReference> {
    const assetId = typeof manifest.assetId === 'string' ? manifest.assetId : '';
    if (!UUID_PATTERN.test(assetId) || manifest.url !== `/api/v1/assets/public/${assetId}/display`) {
      throw new Error('STORY_VISUAL_COVER_REFERENCE_UNSUPPORTED');
    }
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, assetType: 'image', visibility: 'public' },
      select: { id: true, storageProvider: true, storageKey: true, mimeType: true,
        fileSizeBytes: true, checksum: true, metadata: true },
    });
    const metadata = this.record(asset?.metadata);
    const upload = this.record(metadata.uploadIntent);
    const lifecycle = this.record(metadata.lifecycle);
    if (!asset || !ownerUserId || upload.createdByUserId !== ownerUserId ||
        upload.status !== 'uploaded' || (lifecycle.status !== undefined && lifecycle.status !== 'active')) {
      throw new Error('STORY_VISUAL_COVER_REFERENCE_UNAVAILABLE');
    }
    if (!this.storage) throw new Error('STORY_VISUAL_REFERENCE_STORAGE_UNAVAILABLE');
    const display = this.record(this.record(metadata.derivatives).display);
    const source = Object.keys(display).length ? display : asset;
    const storageProvider = source.storageProvider;
    const storageKey = source.storageKey;
    const mimeType = source.mimeType;
    const expectedBytes = Number(source.fileSizeBytes);
    if ((storageProvider !== 's3' && storageProvider !== 'r2') ||
        storageProvider !== asset.storageProvider || typeof storageKey !== 'string' ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(String(mimeType)) ||
        !Number.isSafeInteger(expectedBytes) || expectedBytes < 1_024 || expectedBytes > 16 * 1024 * 1024) {
      throw new Error('STORY_VISUAL_COVER_REFERENCE_INVALID');
    }
    const image = await this.storage.getObject({ storageProvider, storageKey, expectedBytes });
    if (image.length !== expectedBytes || (source === asset && asset.checksum &&
        this.sha256Hex(image) !== asset.checksum)) {
      throw new Error('STORY_VISUAL_COVER_REFERENCE_CHANGED');
    }
    const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'webp';
    return this.validateStoryCoverReference(image, `story-cover-${assetId}.${extension}`, String(mimeType));
  }

  private async validateStoryCoverReference(
    image: Buffer,
    filename: string,
    expectedMimeType?: string,
  ): Promise<StoryWorkVisualReference> {
    if (image.length < 1_024 || image.length > 16 * 1024 * 1024) {
      throw new Error('STORY_VISUAL_COVER_REFERENCE_INVALID');
    }
    const metadata = await sharp(image, { animated: false, failOn: 'error', limitInputPixels: 24_000_000 }).metadata();
    const mimeType = metadata.format === 'png' ? 'image/png'
      : metadata.format === 'jpeg' ? 'image/jpeg'
        : metadata.format === 'webp' ? 'image/webp' : null;
    if (!mimeType || (expectedMimeType && mimeType !== expectedMimeType) ||
        !metadata.width || !metadata.height || metadata.width < 512 || metadata.height < 288 ||
        (metadata.pages ?? 1) !== 1) throw new Error('STORY_VISUAL_COVER_REFERENCE_INVALID');
    const reference: StoryWorkVisualReference = {
      image,
      checksum: this.sha256Hex(image),
      mimeType,
      filename,
    };
    return reference;
  }

  private localStoryCoverPath(path: string): boolean {
    if (!/^\/assets\/story\/[a-zA-Z0-9._/-]+\.(?:png|jpe?g|webp)$/.test(path)) return false;
    return path.slice('/assets/story/'.length).split('/').every(segment => segment !== '.' && segment !== '..');
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
      let objectStorageCode = 'unknown';
      try {
        const errorBody = await response.text();
        objectStorageCode = errorBody.match(/<Code>([A-Za-z][A-Za-z0-9]{0,63})<\/Code>/)?.[1] ?? 'unknown';
      } catch {
        // The HTTP status remains enough when object storage omits an XML error body.
      }
      if (this.databaseFallbackEnabled()) {
        this.logger.warn({ event: 'story_visual_database_fallback', workId, sourceSceneKey,
          objectStorageStatus: response.status, objectStorageCode });
        return { provider: 'database', key, inlineBase64: image.toString('base64') };
      }
      this.logger.warn({ event: 'story_visual_object_storage_rejected', workId, sourceSceneKey,
        objectStorageStatus: response.status, objectStorageCode });
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
    if (message === 'STORY_VISUAL_PROFILE_CHANGED') return message;
    if (message === 'STORY_VISUAL_BOOKING_CHANGED') return message;
    if (message === 'STORY_VISUAL_QUEUE_SCOPE_UNAVAILABLE') return message;
    if (message === 'STORY_VISUAL_CLAIM_LOST') return message;
    if (error instanceof ConflictException && this.record(error.getResponse()).code === 'STORY_VISUAL_PROFILE_CHANGED') return 'STORY_VISUAL_PROFILE_CHANGED';
    if (message === 'STORY_VISUAL_REFERENCE_STORAGE_UNAVAILABLE') return message;
    if (message === 'TimeoutError' || message.includes('timeout')) return 'GENERATION_TIMEOUT';
    return 'GENERATION_FAILED';
  }

  private visualApprovalChanged(error: unknown) {
    const code = error instanceof ConflictException ? this.record(error.getResponse()).code : null;
    return code === 'STORY_VISUAL_PROFILE_CHANGED' || code === 'STORY_VISUAL_SOURCE_REFERENCE_CHANGED' ||
      (typeof code === 'string' && (code.startsWith('STUDIO_VISUAL_REVIEW_') || code.startsWith('STORY_BRANCH_VISUAL_REVIEW_')));
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
    return this.presignedObjectUrl(storageProvider, storageKey, 'PUT', mimeType);
  }

  private presignedGetUrl(storageProvider: string, storageKey: string) {
    return this.presignedObjectUrl(storageProvider, storageKey, 'GET');
  }

  private presignedObjectUrl(storageProvider: string, storageKey: string,
    method: 'PUT' | 'GET', mimeType?: string) {
    const bucket = this.requiredEnv('OBJECT_STORAGE_BUCKET');
    const region = this.config.get<string>('OBJECT_STORAGE_REGION') || 'auto';
    const accessKeyId = this.requiredEnv('OBJECT_STORAGE_ACCESS_KEY_ID');
    const secretAccessKey = this.requiredEnv('OBJECT_STORAGE_SECRET_ACCESS_KEY');
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const endpoint = this.objectStorageEndpoint(storageProvider, bucket, region);
    const url = new URL(this.joinUrlPath(endpoint, storageKey));
    const signedHeaders = method === 'PUT' ? 'content-type;host' : 'host';
    const query: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${accessKeyId}/${scope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': method === 'PUT' ? '900' : '60',
      'X-Amz-SignedHeaders': signedHeaders,
    };
    const canonicalQuery = this.canonicalQueryString(query);
    const headers = method === 'PUT' ? `content-type:${mimeType}\nhost:${url.host}\n` : `host:${url.host}\n`;
    const canonicalRequest = [method, this.canonicalUri(url.pathname), canonicalQuery,
      headers, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
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

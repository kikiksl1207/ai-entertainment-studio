import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import {
  brotliCompressSync,
  brotliDecompressSync,
  constants as zlibConstants,
  gunzipSync,
} from 'zlib';
import { PrismaService } from '../prisma/prisma.service';
import { StoryUploadStorageService } from '../story-upload/story-upload-storage.service';
import {
  StoryUploadFile,
  StoryUploadFileFields,
} from '../story-upload/story-upload.types';
import { PromoteStoryUploadDto, ReviewPublishedChoiceBatchDto } from './dto/story-publication-intake.dto';
import { missingAuthoredSceneVisual } from './story-authored-beat-visual.policy';
import {
  authoredHash,
  prepareAuthoredSourceMap,
} from './story-authored-source-map.policy';
import {
  IMJIN_RELEASE_SOURCE,
  prepareImjinReleasePlan,
} from './story-imjin-release-bridge.policy';
import {
  FIXED_ROUTE_STORIES,
  FixedRouteVisualBible,
  FixedRouteStoryKey,
  fixedRouteStoryKeyFromChecksums,
  prepareFixedRoutePublicationSource,
} from './story-fixed-route-markdown.policy';
import {
  INHERITOR_STORY,
  prepareInheritorPublicationSource,
} from './story-inheritor-publication.policy';
import {
  PreparedManuscript,
  prepareManuscript,
  storedManuscriptBody,
} from './story-manuscript-file.policy';
import { releaseChecksum } from './story-lifecycle.policy';
import {
  buildStorySearchText,
  labelsForStoryHashtags,
} from './story-hashtag.policy';
import {
  StoryChoicePreparationError,
  StoryChoicePreparationProvider,
  StoryChoicePreparationInput,
} from './story-choice-preparation.provider';
import { hasPreparedOriginalAndAlternatives, hasValidWriterOriginalChoice } from './story-three-choice-readiness.policy';
import { PublicationChoiceProfileBinding, StoryPublicationChoiceProfileService } from './story-publication-choice-profile.service';
import { assertSamePublishedChoicePreparationContext, PublishedChoicePreparationContext,
  readPublishedChoicePreparationContext } from './story-publication-choice-context.policy';
import { comparePublicationPlanStorage } from './story-publication-persisted-plan.policy';
import { StoryStudioChoicePreparationService } from './story-studio-choice-preparation.service';
import { assertPrivatePublicationSource, createPrivatePublicationIntake,
  PrivatePublicationSource, PUBLICATION_AUTHOR_REVIEW_STATUS,
  publicationAuthorReviewReceipt } from './story-publication-private-intake.policy';

const NORSE_ANALYSIS_SHA256 =
  '74462e693982cbb72733b3db465e435c008309dbcb76c603b908ed1369cb37f8';
const NORSE_SOURCE_MAP_SHA256 =
  'f6482c710acbc7b63f98783f3ca7f06ebc37d22f5566deb51e719f438eae6bc5';
const DISABLED_RATE_CARD_VERSION = 'story-public-beta-disabled-ai-2026-09-22';
const NORSE_BUNDLE_MAGIC = Buffer.from('LUMINA_NORSE_BUNDLE_V1\0', 'ascii');
const INHERITOR_BUNDLE_MAGIC = Buffer.from('LUMINA_INHERITOR_BUNDLE_V1\0', 'ascii');
const NORSE_BUNDLE_MAX_BYTES = 40 * 1024 * 1024;
const NORSE_APPROVED_PART_COUNT = 216;
const APPROVED_SOURCE_CHUNK_MAX_BYTES = 768 * 1024;
const APPROVED_SOURCE_MAX_CHUNKS = 64;
const APPROVED_SOURCE_COMPRESSED_MAX_BYTES = 8 * 1024 * 1024;
const PUBLICATION_PLAN_MAX_BYTES = 64 * 1024 * 1024;
const PUBLICATION_PLAN_STORAGE_CONTRACT = 'story-publication-plan-br-base64-v1';
const SOURCE_UPLOAD_MARKER = 'source_upload_chunks_v1';
const PLAN_STORAGE_MARKER = 'plan_br_v1';
const APPROVED_STORY_KEYS = ['imjin', 'norse', 'monster', 'rebellion', 'inheritor'] as const;
const COMPANY_AUTHOR_DISPLAY_NAME = '루미나';
const CHOICE_PREPARATION_VERSION = 'authored-context-two-alternatives-v1';
const CHOICE_PREPARATION_BATCH_SIZE = 8;
const CHOICE_PREPARATION_IN_FLIGHT = 'choice_preparing:';
const CHOICE_PREPARATION_REVIEW_REQUIRED = 'choice_review_required:';
const IMPORT_JOB_RECEIPT_SELECT = {
  id: true,
  status: true,
  batchCursor: true,
  workId: true,
  releaseId: true,
  errorCode: true,
} as const;
type ApprovedStoryKey = typeof APPROVED_STORY_KEYS[number];
const STORY_HASHTAG_KEYS: Record<ApprovedStoryKey, readonly string[]> = {
  imjin: ['history', 'imjin-war', 'yi-sun-sin', 'war', 'choice-fiction'],
  norse: ['norse-mythology', 'mythology', 'fantasy', 'loki', 'choice-fiction'],
  monster: ['romance', 'mystery', 'fantasy', 'modern-korea', 'complete'],
  rebellion: ['romance', 'political-fantasy', 'mystery', 'court-intrigue', 'complete'],
  inheritor: ['fantasy', 'modern-korea', 'mystery', 'thriller', 'complete'],
};

type PublicationPart = {
  partKey: string;
  title: string;
  actNumber: number;
  position: number;
  beats: Array<{ text: string; sourceSceneKey: string }>;
  choices: Array<{
    choiceKey: string;
    label: string;
    position: number;
    routeKind: string;
    targetPartKey: string | null;
    targetEndingKey: string | null;
  }>;
};

type PublicationPrompt = {
  sourceSceneKey: string;
  promptText: string;
  promptSha256: string;
};

type PublicationPlan = {
  storyKey: ApprovedStoryKey;
  slug: string;
  title: string;
  summary: string;
  hashtagKeys?: string[];
  coverPath: string;
  manuscript: PreparedManuscript;
  sourceBindingSha256: string;
  parts: PublicationPart[];
  prompts: PublicationPrompt[];
  visualBible?: FixedRouteVisualBible;
  contentRating?: 'adults_only';
  catalogVisibility?: 'unlisted' | 'public_test';
  choicePreparation?: { version: string; preparedPartKeys: string[];
    profileBinding?: PublicationChoiceProfileBinding | null };
  submissionId?: string;
  writerIntakeWorkflow?: 'writer_review_before_choices_v1';
};

type PublicationPlanSnapshot = Omit<PublicationPlan, 'manuscript'> & {
  manuscript: {
    locale: string;
    contentHash: string;
    structuredBody: Prisma.JsonValue;
  };
};

@Injectable()
export class StoryPublicationIntakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StoryUploadStorageService,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly choiceProfiles?: StoryPublicationChoiceProfileService,
  ) {}

  private profilePolicy() {
    return this.choiceProfiles ?? new StoryPublicationChoiceProfileService(this.prisma);
  }

  private async assertChoiceProfileTx(tx: Prisma.TransactionClient, plan: Pick<PublicationPlan, 'slug' | 'choicePreparation'> & {
    manuscript: { contentHash: string };
  }) {
    const profile = await this.profilePolicy().forPlan(tx, plan, true);
    this.profilePolicy().assertSame(plan.choicePreparation?.profileBinding, profile?.binding);
  }

  private async assertStoredPublicationTx(tx: Prisma.TransactionClient, workId: string,
    plan: Pick<PublicationPlan, 'parts'>) {
    const parts = await tx.storyPart.findMany({ where: { workId }, take: plan.parts.length + 1,
      select: { id: true, position: true, actNumber: true, title: true, status: true, fixtureSource: true } });
    const scenes = await tx.storyScene.findMany({ where: { partId: { in: parts.map(part => part.id) } },
      take: plan.parts.length + 1,
      select: { id: true, partId: true, sceneKey: true, position: true, status: true, fixtureSource: true } });
    if (parts.length !== plan.parts.length || scenes.length !== plan.parts.length ||
        parts.some(part => part.status !== 'published' || part.fixtureSource) ||
        scenes.some(scene => scene.status !== 'published' || scene.fixtureSource) ||
        new Set(parts.map(part => part.position)).size !== parts.length ||
        new Set(scenes.map(scene => scene.partId)).size !== scenes.length) {
      throw new ConflictException({ code: 'STORY_PUBLICATION_STORED_PLAN_MISMATCH',
        message: 'Stored publication parts or scenes do not match the approved plan' });
    }
    const partByPosition = new Map(parts.map(part => [part.position, part]));
    const sceneByPartId = new Map(scenes.map(scene => [scene.partId, scene]));
    const routing = new Map(plan.parts.map(part => {
      const storedPart = partByPosition.get(part.position);
      const scene = storedPart && sceneByPartId.get(storedPart.id);
      if (!scene) throw new ConflictException({ code: 'STORY_PUBLICATION_STORED_PLAN_MISMATCH',
        message: 'The approved part is missing its stored scene' });
      return [part.partKey, scene.id] as const;
    }));
    // Read long-form prose in small batches instead of loading the entire novel again.
    for (let cursor = 0; cursor < plan.parts.length; cursor += 6) {
      const batch = plan.parts.slice(cursor, cursor + 6);
      const sceneIds = batch.map(part => routing.get(part.partKey)!);
      const batchParts = batch.map(part => partByPosition.get(part.position)!);
      const batchScenes = batchParts.map(part => sceneByPartId.get(part.id)!);
      const [beats, choices] = await Promise.all([
        tx.storyBeat.findMany({ where: { sceneId: { in: sceneIds } },
          take: batch.reduce((sum, part) => sum + part.beats.length, 0) + 1,
          select: { sceneId: true, position: true, content: true, sourceSceneKey: true } }),
        tx.storyChoice.findMany({ where: { sceneId: { in: sceneIds } }, take: batch.length * 3 + 1,
          select: { sceneId: true, choiceKey: true, position: true, label: true, routeKind: true,
            targetSceneId: true, targetEndingKey: true, declaredRejoinSceneId: true } }),
      ]);
      comparePublicationPlanStorage({ parts: batch }, { parts: batchParts, scenes: batchScenes, beats, choices }, routing);
    }
  }

  async submissions() {
    const [rows, publishedWorks] = await Promise.all([
      this.prisma.storyUploadSubmission.findMany({
        include: {
          files: {
            orderBy: [{ category: 'asc' }, { position: 'asc' }],
            select: {
              category: true,
              position: true,
              extension: true,
              fileSizeBytes: true,
              checksumSha256: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
      }),
      this.prisma.storyWork.findMany({
        where: {
          OR: [{ slug: {
            in: [
              'records-of-the-burning-sea-imjin-war',
              'norse-myth-loki-crossroads',
              FIXED_ROUTE_STORIES.monster.slug,
              FIXED_ROUTE_STORIES.rebellion.slug,
            ],
          } }, { slug: { startsWith: `${INHERITOR_STORY.slug}-` } }],
          status: 'published',
        },
        select: { id: true, slug: true, title: true, activeReleaseId: true, status: true },
      }),
    ]);
    return {
      publishedWorks,
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status === 'author_review' ? PUBLICATION_AUTHOR_REVIEW_STATUS : row.status,
        originalLocale: row.originalLocale,
        sourceClass: row.sourceClass,
        totalBytes: Number(row.totalBytes),
        createdAt: row.createdAt,
        promotedWorkId: row.promotedWorkId,
        detectedStoryKey: this.detectStoryKey(row.files),
        files: row.files.map((file) => ({
          category: file.category,
          position: file.position,
          extension: file.extension,
          fileSizeBytes: Number(file.fileSizeBytes),
          checksumSha256: file.checksumSha256,
        })),
      })),
    };
  }

  async publishApproved(
    actorUserId: string,
    input: PromoteStoryUploadDto,
    fileFields: StoryUploadFileFields,
    submissionId?: string,
  ) {
    const files = fileFields.manuscripts ?? [];
    const expectedCount = input.storyKey === 'imjin' ? 1 : 2;
    const sourceBuffers = input.storyKey === 'norse' && files.length === 1
      ? this.unpackNorseBundle(files[0].buffer)
      : files.map((file) => file.buffer);
    if (sourceBuffers.length !== expectedCount || files.some(
      (file) => !file.buffer?.length || file.size !== file.buffer.length,
    )) {
      throw new ConflictException({
        code: 'STORY_PUBLICATION_APPROVED_FILE_COUNT_MISMATCH',
        message: `Exactly ${expectedCount} approved source file(s) are required`,
      });
    }
    const buffers = new Map<string, Buffer>();
    for (const buffer of sourceBuffers) {
      buffers.set(this.sha256(buffer), buffer);
    }
    if (buffers.size !== expectedCount || this.detectStoryKey(
      [...buffers.keys()].map((checksumSha256) => ({ checksumSha256 })),
    ) !== input.storyKey) {
      throw new ConflictException({
        code: 'STORY_PUBLICATION_SOURCE_IDENTITY_MISMATCH',
        message: 'The selected files do not match the approved manuscript',
      });
    }
    const plan = this.approvedPlan(input.storyKey, buffers);
    plan.submissionId = submissionId;
    plan.writerIntakeWorkflow = 'writer_review_before_choices_v1';
    this.assertPublicRatingReady(plan);
    const existing = await this.prisma.storyPublicationImportJob.findUnique({
      where: {
        actorUserId_storyKey_sourceBindingSha256: {
          actorUserId,
          storyKey: plan.storyKey,
          sourceBindingSha256: plan.sourceBindingSha256,
        },
      },
      select: IMPORT_JOB_RECEIPT_SELECT,
    });
    if (existing?.status === PUBLICATION_AUTHOR_REVIEW_STATUS) {
      return this.stagePrivateIntake(actorUserId, existing.id, submissionId);
    }
    if (existing && (existing.status !== 'queued' || existing.workId ||
        existing.errorCode?.startsWith(CHOICE_PREPARATION_IN_FLIGHT) ||
        existing.errorCode?.startsWith(CHOICE_PREPARATION_REVIEW_REQUIRED))) {
      return this.importJobReceipt(existing, plan.parts.length);
    }
    const planSnapshot = this.storedPlan(plan);
    const sourceChunks = plan.storyKey === 'inheritor'
      ? this.inheritorSourceChunks(buffers)
      : [];
    if (existing) {
      if (existing.status === 'queued' && !existing.workId && (plan.storyKey === 'inheritor' || submissionId)) {
        const current = await this.prisma.storyPublicationImportJob.findUnique({
          where: { id: existing.id }, select: { planSnapshot: true, updatedAt: true,
            status: true, errorCode: true, workId: true },
        });
        if (!current || current.status !== 'queued' || current.workId ||
            current.errorCode?.startsWith(CHOICE_PREPARATION_IN_FLIGHT) ||
            current.errorCode?.startsWith(CHOICE_PREPARATION_REVIEW_REQUIRED)) {
          throw new ConflictException({ code: 'STORY_CHOICE_PREPARATION_CONCURRENT_UPDATE',
            message: 'The import changed while re-uploading; reload before attaching a submission' });
        }
        const stored = current && this.hasStoredPlan(current.planSnapshot)
          ? this.readStoredPlan(current.planSnapshot) : plan;
        if (submissionId) stored.submissionId = submissionId;
        await this.prisma.$transaction(async tx => {
          const updated = await tx.storyPublicationImportJob.updateMany({
            where: { id: existing.id, actorUserId, status: 'queued', workId: null,
              errorCode: current.errorCode, updatedAt: current.updatedAt },
            data: { planSnapshot: this.storedPlan(stored) },
          });
          if (updated.count !== 1) throw new ConflictException({ code: 'STORY_CHOICE_PREPARATION_CONCURRENT_UPDATE',
            message: 'The choice preparation changed while re-uploading; no stored results were replaced' });
          await tx.storyPublicationSourceChunk.createMany({
            data: sourceChunks.map((chunk) => ({ jobId: existing.id, ...chunk })),
            skipDuplicates: true,
          });
        });
        return this.importJobReceipt(existing, plan.parts.length);
      }
      return this.importJobReceipt(existing, plan.parts.length);
    }
    const created = await this.prisma.storyPublicationImportJob.create({
      data: {
        actorUserId,
        storyKey: plan.storyKey,
        sourceBindingSha256: plan.sourceBindingSha256,
        status: 'queued',
        planSnapshot,
        ...(sourceChunks.length ? { sourceChunks: { createMany: { data: sourceChunks } } } : {}),
      },
      select: IMPORT_JOB_RECEIPT_SELECT,
    });
    return this.importJobReceipt(created, plan.parts.length);
  }

  private inheritorSourceChunks(buffers: Map<string, Buffer>) {
    const sources = [
      this.requiredBuffer(buffers, INHERITOR_STORY.manuscriptSha256),
      this.requiredBuffer(buffers, INHERITOR_STORY.promptSha256),
    ];
    const entries = sources.flatMap((source) => {
      const length = Buffer.allocUnsafe(4);
      length.writeUInt32BE(source.length);
      return [length, source];
    });
    const compressed = brotliCompressSync(Buffer.concat([INHERITOR_BUNDLE_MAGIC, ...entries]), {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 },
    });
    if (compressed.length > APPROVED_SOURCE_COMPRESSED_MAX_BYTES) {
      throw new ConflictException('Approved source bundle is too large');
    }
    const totalChunks = Math.ceil(compressed.length / APPROVED_SOURCE_CHUNK_MAX_BYTES);
    return Array.from({ length: totalChunks }, (_, position) => {
      const payload = Uint8Array.from(compressed.subarray(
        position * APPROVED_SOURCE_CHUNK_MAX_BYTES,
        (position + 1) * APPROVED_SOURCE_CHUNK_MAX_BYTES,
      ));
      return {
        position,
        totalChunks,
        payload,
        checksumSha256: this.sha256(Buffer.from(payload)),
      };
    });
  }

  async startApprovedUpload(
    actorUserId: string,
    input: PromoteStoryUploadDto,
  ) {
    if (input.storyKey !== 'norse') {
      throw new BadRequestException('Chunked approved upload is only required for Norse');
    }
    const identity = {
      actorUserId_storyKey_sourceBindingSha256: {
        actorUserId,
        storyKey: input.storyKey,
        sourceBindingSha256: NORSE_SOURCE_MAP_SHA256,
      },
    } as const;
    const existing = await this.prisma.storyPublicationImportJob.findUnique({
      where: identity,
      select: {
        id: true,
        status: true,
        batchCursor: true,
        workId: true,
        releaseId: true,
        errorCode: true,
      },
    });
    if (existing) {
      if (existing.status === 'published' || existing.workId) {
        return this.importJobReceipt(existing, NORSE_APPROVED_PART_COUNT);
      }
      if (existing.errorCode === PLAN_STORAGE_MARKER) {
        return this.importJobReceipt(existing, NORSE_APPROVED_PART_COUNT);
      }
      if (existing.errorCode === SOURCE_UPLOAD_MARKER) {
        const uploadedChunks = await this.prisma.storyPublicationSourceChunk.count({
          where: { jobId: existing.id },
        });
        return this.sourceUploadReceipt(existing.id, uploadedChunks);
      }
      await this.prisma.storyPublicationImportJob.delete({ where: { id: existing.id } });
    }
    const created = await this.prisma.storyPublicationImportJob.create({
      data: {
        actorUserId,
        storyKey: input.storyKey,
        sourceBindingSha256: NORSE_SOURCE_MAP_SHA256,
        status: 'queued',
        errorCode: SOURCE_UPLOAD_MARKER,
        planSnapshot: {
          sourceUpload: { contract: 'norse-approved-bundle-chunks-v1' },
        },
      },
    });
    return this.sourceUploadReceipt(created.id, 0);
  }

  async uploadApprovedSourceChunk(
    actorUserId: string,
    jobId: string,
    positionValue: string,
    totalChunksValue: string | undefined,
    chunk: StoryUploadFile | undefined,
  ) {
    const position = Number(positionValue);
    const totalChunks = Number(totalChunksValue);
    if (
      !Number.isInteger(position) ||
      !Number.isInteger(totalChunks) ||
      position < 0 ||
      totalChunks < 1 ||
      totalChunks > APPROVED_SOURCE_MAX_CHUNKS ||
      position >= totalChunks
    ) {
      throw new BadRequestException('Approved source chunk position is invalid');
    }
    if (!chunk?.buffer?.length || chunk.size !== chunk.buffer.length) {
      throw new BadRequestException('Approved source chunk is missing');
    }
    if (chunk.size > APPROVED_SOURCE_CHUNK_MAX_BYTES) {
      throw new BadRequestException('Approved source chunk is too large');
    }
    const job = await this.prisma.storyPublicationImportJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.actorUserId !== actorUserId || job.storyKey !== 'norse') {
      throw new NotFoundException('Story publication job not found');
    }
    if (job.status === 'published' || this.hasStoredPlan(job.planSnapshot)) {
      return this.importJobReceipt(job, NORSE_APPROVED_PART_COUNT);
    }
    const checksumSha256 = this.sha256(chunk.buffer);
    const existing = await this.prisma.storyPublicationSourceChunk.findUnique({
      where: { jobId_position: { jobId, position } },
    });
    if (
      existing &&
      (existing.totalChunks !== totalChunks || existing.checksumSha256 !== checksumSha256)
    ) {
      throw new ConflictException('Approved source chunk does not match the existing upload');
    }
    if (!existing) {
      await this.prisma.storyPublicationSourceChunk.create({
        data: {
          jobId,
          position,
          totalChunks,
          payload: Uint8Array.from(chunk.buffer),
          checksumSha256,
        },
      });
    }
    const uploadedChunks = await this.prisma.storyPublicationSourceChunk.count({
      where: { jobId },
    });
    return this.sourceUploadReceipt(jobId, uploadedChunks, totalChunks);
  }

  async prepareApprovedSourceChunks(actorUserId: string, jobId: string) {
    const job = await this.prisma.storyPublicationImportJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.actorUserId !== actorUserId || job.storyKey !== 'norse') {
      throw new NotFoundException('Story publication job not found');
    }
    if (job.status === 'published' || this.hasStoredPlan(job.planSnapshot)) {
      return this.importJobReceipt(job, NORSE_APPROVED_PART_COUNT);
    }
    const chunks = await this.prisma.storyPublicationSourceChunk.findMany({
      where: { jobId },
      orderBy: { position: 'asc' },
    });
    const totalChunks = chunks[0]?.totalChunks ?? 0;
    if (
      !totalChunks ||
      chunks.length !== totalChunks ||
      chunks.some((chunk, index) =>
        chunk.position !== index || chunk.totalChunks !== totalChunks)
    ) {
      throw new ConflictException('Approved source chunks are incomplete');
    }
    const compressedBytes = chunks.reduce(
      (total, chunk) => total + chunk.payload.length,
      0,
    );
    if (compressedBytes > APPROVED_SOURCE_COMPRESSED_MAX_BYTES) {
      throw new ConflictException('Approved source bundle is too large');
    }
    const sourceBuffers = this.unpackNorseBundle(Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk.payload)),
    ));
    const buffers = new Map<string, Buffer>();
    for (const buffer of sourceBuffers) buffers.set(this.sha256(buffer), buffer);
    if (
      buffers.size !== 2 ||
      this.detectStoryKey([...buffers.keys()].map((checksumSha256) => ({ checksumSha256 }))) !== 'norse'
    ) {
      throw new ConflictException({
        code: 'STORY_PUBLICATION_SOURCE_IDENTITY_MISMATCH',
        message: 'The selected files do not match the approved manuscript',
      });
    }
    const plan = this.norsePlan(
      this.requiredBuffer(buffers, NORSE_ANALYSIS_SHA256),
      this.requiredBuffer(buffers, NORSE_SOURCE_MAP_SHA256),
    );
    if (plan.sourceBindingSha256 !== job.sourceBindingSha256) {
      throw new ConflictException('Approved source binding changed during upload');
    }
    const [updated] = await this.prisma.$transaction([
      this.prisma.storyPublicationImportJob.update({
        where: { id: jobId },
        data: {
          status: 'queued',
          batchCursor: 0,
          planSnapshot: this.storedPlan(plan),
          errorCode: PLAN_STORAGE_MARKER,
        },
      }),
    ]);
    return this.importJobReceipt(updated, plan.parts.length);
  }

  private unpackNorseBundle(compressed: Buffer) {
    let bundle: Buffer;
    try {
      bundle = gunzipSync(compressed, { maxOutputLength: NORSE_BUNDLE_MAX_BYTES });
    } catch {
      try {
        bundle = brotliDecompressSync(compressed, {
          maxOutputLength: NORSE_BUNDLE_MAX_BYTES,
        });
      } catch {
        throw new ConflictException({
          code: 'STORY_PUBLICATION_BUNDLE_INVALID',
          message: 'The approved Norse source bundle is invalid',
        });
      }
    }
    if (!bundle.subarray(0, NORSE_BUNDLE_MAGIC.length).equals(NORSE_BUNDLE_MAGIC)) {
      throw new ConflictException('The approved Norse source bundle identity is invalid');
    }
    let cursor = NORSE_BUNDLE_MAGIC.length;
    const sources: Buffer[] = [];
    for (let index = 0; index < 2; index += 1) {
      if (cursor + 4 > bundle.length) {
        throw new ConflictException('The approved Norse source bundle is truncated');
      }
      const length = bundle.readUInt32BE(cursor);
      cursor += 4;
      if (length < 1 || cursor + length > bundle.length) {
        throw new ConflictException('The approved Norse source bundle length is invalid');
      }
      sources.push(bundle.subarray(cursor, cursor + length));
      cursor += length;
    }
    if (cursor !== bundle.length) {
      throw new ConflictException('The approved Norse source bundle has trailing data');
    }
    return sources;
  }

  async processApprovedJob(actorUserId: string, jobId: string) {
    let stage = 'lock_job';
    try {
      const choicePreparation = await this.prepareApprovedChoices(actorUserId, jobId);
      if (choicePreparation) return choicePreparation;
      return await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "story_publication_import_jobs"
        WHERE "id" = ${jobId}::uuid FOR UPDATE
      `);
      if (!locked.length) throw new NotFoundException('Story publication job not found');
      const job = await tx.storyPublicationImportJob.findUnique({ where: { id: jobId } });
      if (!job || job.actorUserId !== actorUserId) {
        throw new NotFoundException('Story publication job not found');
      }
      if (job.status === 'published') return this.importJobReceipt(job, job.batchCursor);
      if (job.status === 'failed') {
        throw new ConflictException(job.errorCode || 'Story publication job failed');
      }
      const plan = this.readStoredPlan(job.planSnapshot);
      this.assertPublicRatingReady(plan);

      if (job.status === 'queued') {
        stage = 'prepare_release';
        const publishedSource = plan.storyKey === 'inheritor'
          ? await this.publishedInheritorWorkForSource(tx, plan.sourceBindingSha256) : null;
        if (publishedSource) {
          const completed = await tx.storyPublicationImportJob.update({
            where: { id: job.id },
            data: {
              status: 'published', batchCursor: plan.parts.length,
              workId: publishedSource.id, releaseId: publishedSource.activeReleaseId,
              planSnapshot: Prisma.DbNull,
            },
            select: IMPORT_JOB_RECEIPT_SELECT,
          });
          return this.importJobReceipt(completed, plan.parts.length, publishedSource);
        }
        const existingWork = await tx.storyWork.findUnique({
          where: { slug: plan.slug },
          select: { id: true, slug: true, activeReleaseId: true, status: true },
        });
        if (existingWork?.status === 'published') {
          const completed = await tx.storyPublicationImportJob.update({
            where: { id: job.id },
            data: {
              status: 'published',
              batchCursor: plan.parts.length,
              workId: existingWork.id,
              releaseId: existingWork.activeReleaseId,
              planSnapshot: Prisma.DbNull,
            },
            select: IMPORT_JOB_RECEIPT_SELECT,
          });
          return this.importJobReceipt(completed, plan.parts.length, existingWork);
        }
        if (existingWork) throw new ConflictException('Story slug is already preparing');

        this.assertThreeChoicePlan(plan);
        await this.assertChoiceProfileTx(tx, plan);

        const workId = randomUUID();
        const manuscriptVersionId = randomUUID();
        const releaseId = randomUUID();
        const releaseSnapshot = this.releaseSnapshot(plan, manuscriptVersionId);
        const checksum = releaseChecksum(releaseSnapshot);
        const hashtagKeys = plan.hashtagKeys?.length
          ? plan.hashtagKeys
          : [...STORY_HASHTAG_KEYS[plan.storyKey]];
        const hashtagLabels = labelsForStoryHashtags(hashtagKeys);
        await tx.storyWork.create({
          data: {
            id: workId,
            ownerUserId: actorUserId,
            slug: plan.slug,
            status: 'release_ready',
            defaultLocale: 'ko',
            supportedLocales: ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'],
            title: { ko: plan.title },
            summary: { ko: plan.summary },
            authorDisplayName: COMPANY_AUTHOR_DISPLAY_NAME,
            hashtagKeys,
            hashtagLabels,
            searchText: buildStorySearchText(plan.title, plan.summary, hashtagLabels, COMPANY_AUTHOR_DISPLAY_NAME),
            coverManifest: {
              publicAssetPath: plan.coverPath,
              altKey: `story.cover.${plan.storyKey}`,
              ...(plan.contentRating ? { contentRating: plan.contentRating } : {}),
              ...(plan.catalogVisibility ? { catalogVisibility: plan.catalogVisibility } : {}),
            },
            priceLumina: 0,
            fixtureSource: false,
            publishedVersion: 1,
            customChoiceEnabled: false,
            activeReleaseId: null,
            releaseRevision: 1,
            publishedAt: null,
          },
        });
        await tx.storyManuscriptVersion.create({
          data: {
            id: manuscriptVersionId,
            workId,
            ownerUserId: actorUserId,
            version: 1,
            locale: plan.manuscript.locale,
            contentHash: plan.manuscript.contentHash,
            structuredBody: this.archivedManuscriptBody(plan, job.id),
          },
        });
        await tx.storyRelease.create({
          data: {
            id: releaseId,
            workId,
            version: 1,
            status: 'active',
            ...releaseSnapshot,
            checksum,
            validationSummary: {
              ready: true,
              blockingIssueCount: 0,
              sourceIdentityVerified: true,
              publicBetaScope: 'authored_route_only',
            },
            diffSummary: {
              sourceBindingSha256: plan.sourceBindingSha256,
              sourceRawTextIncluded: false,
            },
            createdByUserId: actorUserId,
            activatedAt: new Date(),
          },
        });
        const prepared = await tx.storyPublicationImportJob.update({
          where: { id: job.id },
          data: {
            status: 'structuring',
            batchCursor: 0,
            workId,
            releaseId,
          },
          select: IMPORT_JOB_RECEIPT_SELECT,
        });
        return this.importJobReceipt(prepared, plan.parts.length);
      }

      if (!job.workId || !job.releaseId) {
        throw new ConflictException('Story publication job bindings are missing');
      }
      this.assertThreeChoicePlan(plan);
      await this.assertChoiceProfileTx(tx, plan);
      if (job.status === 'structuring') {
        const end = Math.min(job.batchCursor + 12, plan.parts.length);
        const batch = plan.parts.slice(job.batchCursor, end);
        stage = `structure_parts_${job.batchCursor}_${end}`;
        await tx.storyPart.createMany({
          data: batch.map((part) => ({
            id: randomUUID(),
            workId: job.workId!,
            seasonKey: 'season-1',
            actNumber: part.actNumber,
            position: part.position,
            status: 'published',
            title: { ko: part.title },
            priceLumina: 0,
            fixtureSource: false,
            publishedAt: new Date(),
          })),
          skipDuplicates: true,
        });
        const storedParts = await tx.storyPart.findMany({
          where: { workId: job.workId, position: { gte: job.batchCursor + 1, lte: end } },
          select: { id: true, position: true },
        });
        const partByPosition = new Map(storedParts.map((part) => [part.position, part.id]));
        stage = `structure_scenes_${job.batchCursor}_${end}`;
        await tx.storyScene.createMany({
          data: batch.map((part) => ({
            id: randomUUID(),
            partId: this.requiredId(partByPosition, part.position),
            sceneKey: `${part.partKey}-main`,
            position: 1,
            status: 'published',
            title: { ko: part.title },
            visualManifest: this.authoredVisual(plan, `${part.partKey}-main`, part.position),
            endingType: null,
            fixtureSource: false,
          })),
          skipDuplicates: true,
        });
        const next = await tx.storyPublicationImportJob.update({
          where: { id: job.id },
          data: {
            status: end === plan.parts.length ? 'materializing' : 'structuring',
            batchCursor: end === plan.parts.length ? 0 : end,
          },
          select: IMPORT_JOB_RECEIPT_SELECT,
        });
        return this.importJobReceipt(next, plan.parts.length);
      }

      if (job.status === 'materializing') {
        const end = Math.min(job.batchCursor + 6, plan.parts.length);
        const batch = plan.parts.slice(job.batchCursor, end);
        stage = `materialize_bindings_${job.batchCursor}_${end}`;
        const storedParts = await tx.storyPart.findMany({
          where: { workId: job.workId },
          select: { id: true, position: true },
        });
        const partByPosition = new Map(storedParts.map((part) => [part.position, part.id]));
        const storedScenes = await tx.storyScene.findMany({
          where: { partId: { in: storedParts.map((part) => part.id) } },
          select: { id: true, partId: true },
        });
        const sceneByPartId = new Map(storedScenes.map((scene) => [scene.partId, scene.id]));
        const sceneByPartKey = new Map(plan.parts.map((part) => {
          const partId = this.requiredId(partByPosition, part.position);
          return [part.partKey, this.requiredId(sceneByPartId, partId)] as const;
        }));
        const batchSceneKeys = new Set<string>();
        const beatRows = batch.flatMap((part) => {
          const sceneId = this.requiredId(sceneByPartKey, part.partKey);
          return part.beats.map((beat, index) => {
            batchSceneKeys.add(beat.sourceSceneKey);
            return {
              sceneId,
              position: index + 1,
              beatType: 'narration',
              content: { ko: beat.text },
              sourceSceneKey: beat.sourceSceneKey,
              visualManifest: this.authoredVisual(plan, beat.sourceSceneKey, part.position),
            };
          });
        });
        stage = `materialize_beats_${job.batchCursor}_${end}`;
        await tx.storyBeat.createMany({ data: beatRows, skipDuplicates: true });
        stage = `materialize_choices_${job.batchCursor}_${end}`;
        await tx.storyChoice.createMany({
          data: batch.flatMap((part) => {
            const sceneId = this.requiredId(sceneByPartKey, part.partKey);
            return part.choices.map((choice) => ({
              sceneId,
              choiceKey: choice.choiceKey,
              position: choice.position,
              label: { ko: choice.label },
              routeKind: choice.routeKind,
              targetSceneId: choice.targetPartKey
                ? this.requiredId(sceneByPartKey, choice.targetPartKey)
                : null,
              targetEndingKey: choice.targetEndingKey,
              declaredRejoinSceneId: null,
            }));
          }),
          skipDuplicates: true,
        });
        const release = await tx.storyRelease.findUniqueOrThrow({
          where: { id: job.releaseId },
          select: { checksum: true },
        });
        stage = `materialize_prompts_${job.batchCursor}_${end}`;
        await tx.storyVisualPrompt.createMany({
          data: plan.prompts
            .filter((prompt) => batchSceneKeys.has(prompt.sourceSceneKey))
            .map((prompt) => ({
              workId: job.workId!,
              releaseId: job.releaseId!,
              releaseChecksum: release.checksum,
              ...prompt,
              sourceKind: 'admin_verified',
              sourceBindingSha256: plan.sourceBindingSha256,
            })),
          skipDuplicates: true,
        });
        const next = await tx.storyPublicationImportJob.update({
          where: { id: job.id },
          data: {
            status: end === plan.parts.length ? 'finalizing' : 'materializing',
            batchCursor: end,
          },
          select: IMPORT_JOB_RECEIPT_SELECT,
        });
        return this.importJobReceipt(next, plan.parts.length);
      }

      if (job.status !== 'finalizing') {
        throw new ConflictException('Story publication job status is invalid');
      }
      stage = 'finalize_release';
      const release = await tx.storyRelease.findUniqueOrThrow({
        where: { id: job.releaseId },
        select: { checksum: true, workId: true, manuscriptVersionId: true },
      });
      const boundWork = await tx.storyWork.findFirst({ where: { id: job.workId, slug: plan.slug,
        ownerUserId: actorUserId, status: 'release_ready', activeReleaseId: null, fixtureSource: false },
        select: { id: true } });
      const boundManuscript = await tx.storyManuscriptVersion.findFirst({ where: {
        id: release.manuscriptVersionId, workId: job.workId, ownerUserId: actorUserId,
        contentHash: plan.manuscript.contentHash }, select: { id: true } });
      if (!boundWork || !boundManuscript || release.workId !== job.workId ||
          release.checksum !== releaseChecksum(this.releaseSnapshot(plan, release.manuscriptVersionId))) {
        throw new ConflictException({ code: 'STORY_PUBLICATION_STORED_PLAN_MISMATCH',
          message: 'The publication work, manuscript or release no longer matches its approved plan' });
      }
      stage = 'validate_stored_publication';
      await this.assertStoredPublicationTx(tx, job.workId, plan);
      stage = 'finalize_rate_card';
      const rateCard = await tx.storyAiRateCard.upsert({
        where: { version: DISABLED_RATE_CARD_VERSION },
        create: {
          version: DISABLED_RATE_CARD_VERSION,
          provider: 'disabled',
          model: 'not_activated',
          status: 'active',
          currencyCode: 'KRW',
          inputCostPerMillion: 0,
          outputCostPerMillion: 0,
          cachedInputCostPerMillion: 0,
          imageUnitCost: 0,
          createdByUserId: actorUserId,
          effectiveAt: new Date(),
        },
        update: {},
      });
      stage = 'finalize_capability';
      await tx.storyReleaseCapability.upsert({
        where: { releaseId: job.releaseId },
        create: {
          workId: job.workId,
          releaseId: job.releaseId,
          rateCardId: rateCard.id,
          fixedChoiceCount: 3,
          customChoiceEnabled: false,
          customChoiceMaxLength: 200,
          fullResetLimit: 1,
          actResetLimit: 3,
          includedAiRouteCount: 0,
          aiInputTokenLimit: 0,
          aiOutputTokenLimit: 0,
          warningBudgetKrw: 0,
          hardBudgetKrw: 0,
          status: 'active',
          validationErrors: [],
          revision: 1,
          updatedByUserId: actorUserId,
        },
        update: {},
      });
      stage = 'finalize_transition';
      await tx.storyPublicationTransition.upsert({
        where: { idempotencyKey: `story-approved-publication:${plan.sourceBindingSha256}` },
        create: {
          workId: job.workId,
          releaseId: job.releaseId,
          actorUserId,
          idempotencyKey: `story-approved-publication:${plan.sourceBindingSha256}`,
          fromStatus: 'release_ready',
          toStatus: 'published',
          beforeRevision: 1,
          afterRevision: 2,
          publicSummary: {
            sourceIdentityVerified: true,
            scope: 'authored_route_only',
            aiGeneratedBranchesActivated: false,
          },
        },
        update: {},
      });
      const publishedAt = new Date();
      stage = 'finalize_work';
      const work = await tx.storyWork.update({
        where: { id: job.workId },
        data: {
          status: 'published',
          activeReleaseId: job.releaseId,
          releaseRevision: 2,
          publishedAt,
        },
        select: { id: true, slug: true, activeReleaseId: true, status: true },
      });
      stage = 'finalize_audit';
      await tx.auditEvent.create({
        data: {
          actorUserId,
          actorType: 'admin',
          action: 'story_approved_source.public_beta_published',
          targetType: 'story_work',
          targetId: job.workId,
          afterData: {
            workId: job.workId,
            releaseId: job.releaseId,
            status: 'published',
            storyKey: plan.storyKey,
          },
          metadata: {
            sourceBindingSha256: plan.sourceBindingSha256,
            partCount: plan.parts.length,
            promptCount: plan.prompts.length,
            releaseChecksum: release.checksum,
            aiGeneratedBranchesActivated: false,
            choicePreparationVersion: plan.choicePreparation?.version ?? null,
            generationProfileBinding: plan.choicePreparation?.profileBinding ?? null,
            choicePlanDigest: releaseChecksum(plan.parts.map(part => ({ partKey: part.partKey, choices: part.choices }))),
          },
        },
      });
      stage = 'finalize_job';
      if (plan.submissionId) {
        await tx.storyUploadSubmission.update({
          where: { id: plan.submissionId },
          data: { status: 'published', promotedWorkId: job.workId },
        });
      }
      const completed = await tx.storyPublicationImportJob.update({
        where: { id: job.id },
        data: {
          status: 'published',
          batchCursor: plan.parts.length,
          planSnapshot: Prisma.DbNull,
          errorCode: null,
        },
        select: IMPORT_JOB_RECEIPT_SELECT,
      });
      return this.importJobReceipt(completed, plan.parts.length, work);
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 30_000,
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException ||
          error instanceof ServiceUnavailableException) {
        throw error;
      }
      const prismaCode = error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code
        : 'UNKNOWN';
      const errorKind = error instanceof Error
        ? error.constructor.name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 60)
        : 'UnknownError';
      throw new ConflictException({
        code: 'STORY_PUBLICATION_JOB_STAGE_FAILED',
        message: `Story publication failed at ${stage} (${prismaCode}:${errorKind})`,
      });
    }
  }

  private async privateSourceTx(tx: Prisma.TransactionClient, jobId: string,
    plan: PublicationPlanSnapshot): Promise<PrivatePublicationSource> {
    const body = plan.manuscript.structuredBody as Record<string, unknown>;
    if (body?.format !== 'approved-source-plan-reference-v1') {
      assertPrivatePublicationSource(plan);
      return plan;
    }
    if (plan.storyKey !== 'inheritor') throw new ConflictException({ code: 'STORY_PUBLICATION_PRIVATE_SOURCE_MISMATCH' });
    const chunks = await tx.storyPublicationSourceChunk.findMany({ where: { jobId },
      orderBy: { position: 'asc' }, take: APPROVED_SOURCE_MAX_CHUNKS + 1 });
    if (!chunks.length || chunks.length > APPROVED_SOURCE_MAX_CHUNKS ||
        chunks.some((chunk, index) => chunk.position !== index || chunk.totalChunks !== chunks.length ||
          !chunk.payload.length || chunk.payload.length > APPROVED_SOURCE_CHUNK_MAX_BYTES ||
          this.sha256(Buffer.from(chunk.payload)) !== chunk.checksumSha256) ||
        chunks.reduce((sum, chunk) => sum + chunk.payload.length, 0) > APPROVED_SOURCE_COMPRESSED_MAX_BYTES) {
      throw new ConflictException({ code: 'STORY_PUBLICATION_PRIVATE_ARCHIVE_INVALID' });
    }
    let restored: PublicationPlan;
    try {
      const bundle = brotliDecompressSync(Buffer.concat(chunks.map(chunk => Buffer.from(chunk.payload))),
        { maxOutputLength: NORSE_BUNDLE_MAX_BYTES });
      if (!bundle.subarray(0, INHERITOR_BUNDLE_MAGIC.length).equals(INHERITOR_BUNDLE_MAGIC)) throw new Error();
      let cursor = INHERITOR_BUNDLE_MAGIC.length;
      const buffers = new Map<string, Buffer>();
      for (let index = 0; index < 2; index++) {
        if (cursor + 4 > bundle.length) throw new Error();
        const length = bundle.readUInt32BE(cursor);
        cursor += 4;
        if (!length || cursor + length > bundle.length) throw new Error();
        const source = bundle.subarray(cursor, cursor + length);
        buffers.set(this.sha256(source), source);
        cursor += length;
      }
      if (cursor !== bundle.length || buffers.size !== 2) throw new Error();
      restored = this.inheritorPlan(buffers);
    } catch {
      throw new ConflictException({ code: 'STORY_PUBLICATION_PRIVATE_ARCHIVE_INVALID' });
    }
    if (restored.sourceBindingSha256 !== plan.sourceBindingSha256 ||
        restored.manuscript.contentHash !== plan.manuscript.contentHash ||
        releaseChecksum(restored.parts) !== releaseChecksum(plan.parts)) {
      throw new ConflictException({ code: 'STORY_PUBLICATION_PRIVATE_SOURCE_MISMATCH' });
    }
    const source = { ...plan, manuscript: { locale: restored.manuscript.locale,
      contentHash: restored.manuscript.contentHash,
      structuredBody: storedManuscriptBody(restored.manuscript) as unknown as Prisma.JsonValue } };
    assertPrivatePublicationSource(source);
    return source;
  }

  private async stagePrivateIntake(actorUserId: string, jobId: string, submissionId?: string) {
    return this.prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM story_publication_import_jobs WHERE id=${jobId}::uuid FOR UPDATE
      `);
      if (!locked.length) throw new NotFoundException('Story publication job not found');
      const job = await tx.storyPublicationImportJob.findUnique({ where: { id: jobId } });
      if (!job || job.actorUserId !== actorUserId) throw new NotFoundException('Story publication job not found');
      if (job.status === PUBLICATION_AUTHOR_REVIEW_STATUS) {
        if (submissionId) {
          const plan = this.readStoredPlan(job.planSnapshot);
          if (plan.submissionId && plan.submissionId !== submissionId) {
            throw new ConflictException({ code: 'STORY_PUBLICATION_SUBMISSION_CHANGED' });
          }
          if (!plan.submissionId) {
            const submission = await tx.storyUploadSubmission.findUnique({ where: { id: submissionId },
              include: { files: { select: { category: true, checksumSha256: true } } } });
            if (!job.workId || !submission || submission.userId !== actorUserId ||
                submission.status !== 'received' || submission.promotedWorkId ||
                this.detectStoryKey(submission.files.filter(file => file.category === 'manuscript')) !== job.storyKey) {
              throw new ConflictException({ code: 'STORY_PUBLICATION_SUBMISSION_CHANGED' });
            }
            const attached = await tx.storyUploadSubmission.updateMany({ where: { id: submissionId,
              userId: actorUserId, status: 'received', promotedWorkId: null },
              data: { status: 'author_review', promotedWorkId: job.workId } });
            if (attached.count !== 1) throw new ConflictException({ code: 'STORY_PUBLICATION_SUBMISSION_CHANGED' });
            plan.submissionId = submissionId;
            job.planSnapshot = this.storedPlan(plan) as Prisma.JsonValue;
            await tx.storyPublicationImportJob.update({ where: { id: job.id },
              data: { planSnapshot: job.planSnapshot as Prisma.InputJsonValue } });
            await tx.auditEvent.create({ data: { actorUserId, actorType: 'admin',
              action: 'story_publication.private_submission_attached', targetType: 'story_work', targetId: job.workId,
              metadata: { jobId: job.id, submissionId, sourceBindingSha256: job.sourceBindingSha256,
                providerCalled: false, published: false } } });
          }
        }
        return this.privateReviewReceiptTx(tx, job);
      }
      if (job.status !== 'queued' || job.workId || job.releaseId || job.batchCursor !== 0 ||
          (job.errorCode && job.errorCode !== PLAN_STORAGE_MARKER)) {
        throw new ConflictException({ code: 'STORY_PUBLICATION_PRIVATE_INTAKE_CHANGED' });
      }
      const plan = this.readStoredPlan(job.planSnapshot);
      if (job.storyKey !== plan.storyKey || job.sourceBindingSha256 !== plan.sourceBindingSha256 ||
          plan.writerIntakeWorkflow !== 'writer_review_before_choices_v1' ||
          plan.choicePreparation?.preparedPartKeys.length || !this.choicePartsToPrepare(plan).length) {
        throw new ConflictException({ code: 'STORY_PUBLICATION_PRIVATE_INTAKE_CHANGED' });
      }
      const publishedSource = plan.storyKey === 'inheritor'
        ? await this.publishedInheritorWorkForSource(tx, plan.sourceBindingSha256) : null;
      const existing = publishedSource ?? await tx.storyWork.findUnique({ where: { slug: plan.slug },
        select: { id: true, status: true } });
      if (existing?.status === 'published') return null;
      if (existing) throw new ConflictException({ code: 'STORY_PUBLICATION_SOURCE_ALREADY_PREPARING' });
      const source = await this.privateSourceTx(tx, job.id, plan);
      const created = await createPrivatePublicationIntake(tx, actorUserId, job.id, source);
      return publicationAuthorReviewReceipt(job.id, created.workId, created.manuscriptId,
        source.manuscript.contentHash, source.parts.length);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 30000 });
  }

  private async privateReviewReceiptTx(tx: Prisma.TransactionClient, job: {
    id: string; actorUserId: string; workId: string | null; planSnapshot: Prisma.JsonValue | null;
    storyKey: string; sourceBindingSha256: string;
  }) {
    if (!job.workId) throw new ConflictException({ code: 'STORY_PUBLICATION_PRIVATE_BINDING_INVALID' });
    const plan = this.readStoredPlan(job.planSnapshot);
    if (job.storyKey !== plan.storyKey || job.sourceBindingSha256 !== plan.sourceBindingSha256 ||
        plan.writerIntakeWorkflow !== 'writer_review_before_choices_v1') {
      throw new ConflictException({ code: 'STORY_PUBLICATION_PRIVATE_BINDING_INVALID' });
    }
    await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id=${job.workId}::uuid FOR SHARE`);
    const work = await tx.storyWork.findFirst({ where: { id: job.workId,
      ownerUserId: job.actorUserId, slug: plan.slug, fixtureSource: false },
      select: { id: true, status: true, activeReleaseId: true, publishedAt: true } });
    const manuscript = await tx.storyManuscriptVersion.findFirst({ where: { workId: job.workId,
      ownerUserId: job.actorUserId }, orderBy: { version: 'desc' },
      select: { id: true, contentHash: true } });
    if (!work || !manuscript || manuscript.contentHash !== plan.manuscript.contentHash) {
      throw new ConflictException({ code: 'STORY_PUBLICATION_PRIVATE_BINDING_INVALID' });
    }
    if (work.status === 'published' || work.activeReleaseId || work.publishedAt) {
      const release = work.activeReleaseId && work.status === 'published' && work.publishedAt
        ? await tx.storyRelease.findFirst({ where: { id: work.activeReleaseId, workId: work.id,
          manuscriptVersionId: manuscript.id, status: 'active' } }) : null;
      const validation = release?.validationSummary as Record<string, unknown> | undefined;
      const graph = release?.branchGraphSnapshot as Record<string, unknown> | undefined;
      const transition = release ? await tx.storyPublicationTransition.findFirst({ where: {
        workId: work.id, releaseId: release.id, toStatus: 'published',
      }, select: { id: true } }) : null;
      if (!release || !transition || validation?.ready !== true ||
          graph?.contract !== 'studio-linear-v1' || release.checksum !== releaseChecksum({
            manuscriptVersionId: manuscript.id, branchGraphSnapshot: release.branchGraphSnapshot,
            endingSetSnapshot: release.endingSetSnapshot, sceneAssetManifest: release.sceneAssetManifest,
            localizedDisplaySnapshot: release.localizedDisplaySnapshot,
          })) {
        throw new ConflictException({ code: 'STORY_PUBLICATION_WRITER_FLOW_NOT_CONFIRMED' });
      }
      await new StoryStudioChoicePreparationService(this.prisma).assertPublishableTx(tx, work.id,
        job.actorUserId, manuscript.id, release.id);
      if (plan.submissionId) {
        const updated = await tx.storyUploadSubmission.updateMany({ where: { id: plan.submissionId,
          userId: job.actorUserId, promotedWorkId: work.id, status: 'author_review' }, data: { status: 'published' } });
        if (updated.count !== 1) throw new ConflictException({ code: 'STORY_PUBLICATION_SUBMISSION_CHANGED' });
      }
      const completed = await tx.storyPublicationImportJob.update({ where: { id: job.id }, data: {
        status: 'published', releaseId: release.id, batchCursor: plan.parts.length, planSnapshot: Prisma.DbNull,
      }, select: IMPORT_JOB_RECEIPT_SELECT });
      await tx.auditEvent.create({ data: { actorUserId: job.actorUserId, actorType: 'admin',
        action: 'story_publication.writer_flow_linked', targetType: 'story_work', targetId: work.id,
        metadata: { jobId: job.id, releaseId: release.id, manuscriptHash: manuscript.contentHash,
          sourceBindingSha256: plan.sourceBindingSha256, publicationTransitionId: transition.id,
          releaseChecksum: release.checksum, providerCalled: false },
      } });
      return this.importJobReceipt(completed, plan.parts.length, { ...work, slug: plan.slug });
    }
    return publicationAuthorReviewReceipt(job.id, work.id, manuscript.id,
      manuscript.contentHash, plan.parts.length);
  }

  async promote(
    actorUserId: string,
    submissionId: string,
    input: PromoteStoryUploadDto,
  ) {
    const submission = await this.prisma.storyUploadSubmission.findUnique({
      where: { id: submissionId },
      include: { files: true },
    });
    if (!submission) throw new NotFoundException('Story upload submission not found');
    if (submission.promotedWorkId) {
      const work = await this.prisma.storyWork.findUnique({
        where: { id: submission.promotedWorkId },
        select: { id: true, slug: true, activeReleaseId: true, status: true },
      });
      if (!work) throw new ConflictException('Promoted story work is missing');
      if (work.status !== 'published') {
        const job = await this.prisma.storyPublicationImportJob.findFirst({ where: {
          actorUserId, workId: work.id, status: PUBLICATION_AUTHOR_REVIEW_STATUS,
        }, select: { id: true } });
        if (job) return this.stagePrivateIntake(actorUserId, job.id);
        throw new ConflictException({ code: 'STORY_PUBLICATION_AUTHOR_REVIEW_REQUIRED' });
      }
      return { work, idempotentReplay: true };
    }
    if (submission.userId !== actorUserId) {
      throw new ConflictException({
        code: 'STORY_OWNER_CONFIRMATION_REQUIRED',
        message: 'The uploading owner must confirm this public release',
      });
    }
    const detectedStoryKey = this.detectStoryKey(submission.files);
    if (detectedStoryKey !== input.storyKey) {
      throw new ConflictException({
        code: 'STORY_PUBLICATION_SOURCE_IDENTITY_MISMATCH',
        message: 'The uploaded files do not match the selected approved manuscript',
      });
    }

    const buffers = new Map<string, Buffer>();
    for (const file of submission.files) {
      const buffer = await this.storage.getObject({
        storageProvider: this.storageProvider(file.storageProvider),
        storageKey: file.storageKey,
        expectedBytes: Number(file.fileSizeBytes),
      });
      if (this.sha256(buffer) !== file.checksumSha256) {
        throw new ConflictException({
          code: 'STORY_PUBLICATION_STORED_FILE_CHANGED',
          message: 'The stored upload no longer matches its receipt',
        });
      }
      buffers.set(file.checksumSha256, buffer);
    }
    const plan = this.approvedPlan(input.storyKey, buffers);
    this.assertPublicRatingReady(plan);
    if (this.choicePartsToPrepare(plan).length) {
      const manuscripts = [...buffers.values()].map((buffer, index) => ({
        fieldname: 'manuscripts', originalname: `approved-source-${index + 1}`,
        encoding: '7bit', mimetype: 'application/octet-stream', size: buffer.length, buffer,
      }));
      return this.publishApproved(actorUserId, input, { manuscripts }, submissionId);
    }
    return this.publish(actorUserId, submissionId, plan, input);
  }

  private choicePartsToPrepare(plan: Pick<PublicationPlan, 'storyKey' | 'parts' | 'choicePreparation'>): PublicationPart[] {
    const prepared = new Set(plan.choicePreparation?.version === CHOICE_PREPARATION_VERSION
      ? plan.choicePreparation.preparedPartKeys : []);
    return plan.parts.filter((part) =>
      !prepared.has(part.partKey) && (
        part.choices.length < 3 || plan.storyKey === 'monster' || plan.storyKey === 'rebellion'
      ));
  }

  private assertThreeChoicePlan(plan: Pick<PublicationPlan, 'storyKey' | 'parts' | 'choicePreparation'>) {
    if (this.choicePartsToPrepare(plan).length || plan.parts.some((part) =>
      part.choices.length !== 3 ||
      part.choices[0].routeKind !== 'writer_original' ||
      part.choices.slice(1).some((choice) => choice.routeKind !== 'generation_required' ||
        choice.targetPartKey !== null || choice.targetEndingKey !== null) ||
      new Set(part.choices.map((choice) => choice.label.trim())).size !== 3)) {
      throw new ConflictException({
        code: 'STORY_PUBLICATION_CHOICES_NOT_READY',
        message: 'Every published part must have one original and two distinct AI route choices',
      });
    }
  }

  private choiceProvider() {
    const get = (key: string) => this.config?.get<string>(key) ?? process.env[key];
    const apiKey = get('STORY_CONTINUATION_OPENAI_API_KEY') || get('OPENAI_API_KEY');
    if (!apiKey) throw new ServiceUnavailableException({
      code: 'STORY_CHOICE_PREPARATION_NOT_CONFIGURED',
      message: 'Choice preparation is unavailable until the AI provider is configured',
    });
    return new StoryChoicePreparationProvider({
      apiKey,
      model: get('STORY_CONTINUATION_OPENAI_MODEL') || 'gpt-5.4-mini-2026-03-17',
      timeoutMs: 45_000,
    });
  }

  private async generateChoiceBatch(input: StoryChoicePreparationInput) {
    try {
      return await this.choiceProvider().generate(input);
    } catch (error) {
      if (error instanceof StoryChoicePreparationError) {
        throw new ServiceUnavailableException({
          code: 'STORY_CHOICE_PREPARATION_RETRYABLE',
          details: { reason: error.code },
          message: 'AI choice preparation did not complete; retry to continue from the saved batch',
        });
      }
      throw error;
    }
  }

  private async prepareApprovedChoices(actorUserId: string, jobId: string) {
    const job = await this.prisma.storyPublicationImportJob.findUnique({
      where: { id: jobId },
      select: { ...IMPORT_JOB_RECEIPT_SELECT, actorUserId: true, planSnapshot: true, updatedAt: true },
    });
    if (!job || job.actorUserId !== actorUserId) throw new NotFoundException('Story publication job not found');
    if (job.errorCode?.startsWith(CHOICE_PREPARATION_IN_FLIGHT) ||
        job.errorCode?.startsWith(CHOICE_PREPARATION_REVIEW_REQUIRED)) {
      throw new ConflictException({
        code: job.errorCode.startsWith(CHOICE_PREPARATION_IN_FLIGHT)
          ? 'STORY_CHOICE_PREPARATION_IN_PROGRESS' : 'STORY_CHOICE_PREPARATION_REVIEW_REQUIRED',
        message: 'Choice preparation is already running or requires provider outcome review',
      });
    }
    if (job.status === PUBLICATION_AUTHOR_REVIEW_STATUS) return this.stagePrivateIntake(actorUserId, jobId);
    if (job.status !== 'queued' || !this.hasStoredPlan(job.planSnapshot)) return null;
    const plan = this.readStoredPlan(job.planSnapshot);
    if (plan.writerIntakeWorkflow === 'writer_review_before_choices_v1' &&
        (job.workId || plan.choicePreparation?.preparedPartKeys.length)) throw new ConflictException({
      code: 'STORY_PUBLICATION_PRIVATE_INTAKE_CHANGED',
      message: 'Continue the reviewed private manuscript instead of the legacy choice generator',
    });
    const pending = this.choicePartsToPrepare(plan);
    if (!pending.length) return null;
    // Re-uploading an already public source never starts a new paid choice batch.
    if (this.prisma.storyWork && this.prisma.storyRelease) {
      const publishedSource = plan.storyKey === 'inheritor'
        ? await this.publishedInheritorWorkForSource(this.prisma, plan.sourceBindingSha256) : null;
      const existing = publishedSource ?? await this.prisma.storyWork.findUnique({ where: { slug: plan.slug },
        select: { id: true, status: true } });
      if (existing?.status === 'published') return null;
      if (existing && existing.id !== job.workId) throw new ConflictException({
        code: 'STORY_PUBLICATION_SOURCE_ALREADY_PREPARING',
        message: 'The source is already preparing; continue its existing author review instead of duplicating it',
      });
    }
    if (plan.writerIntakeWorkflow === 'writer_review_before_choices_v1') {
      return this.stagePrivateIntake(actorUserId, jobId);
    }
    const generationProfile = await this.profilePolicy().forPlan(this.prisma, plan);
    if (plan.choicePreparation?.preparedPartKeys.length) {
      this.profilePolicy().assertSame(plan.choicePreparation.profileBinding, generationProfile?.binding);
    }
    const batch = pending.slice(0, CHOICE_PREPARATION_BATCH_SIZE);
    const provider = this.choiceProvider();
    const claim = `${CHOICE_PREPARATION_IN_FLIGHT}${randomUUID()}`;
    const claimed = await this.prisma.storyPublicationImportJob.updateMany({
      where: { id: jobId, actorUserId, status: 'queued', updatedAt: job.updatedAt,
        errorCode: job.errorCode },
      data: { errorCode: claim },
    });
    if (claimed.count !== 1) throw new ConflictException({
      code: 'STORY_CHOICE_PREPARATION_CONCURRENT_UPDATE',
      message: 'Choice preparation changed concurrently; reload the job',
    });
    try {
      const result = await provider.generate({
        workTitle: plan.title,
        ...(generationProfile ? { generationProfile: generationProfile.approved } : {}),
        parts: batch.map((part) => ({
          partKey: part.partKey,
          title: part.title,
          endingExcerpt: part.beats.at(-1)?.text.slice(-1200) ?? '',
          originalChoiceLabel: part.choices[0]?.label ?? '',
          context: part.beats[0]?.text.slice(0, 350) ?? '',
        })),
      });
      const byKey = new Map(result.map((item) => [item.partKey, item.alternatives]));
      if (byKey.size !== batch.length) throw new ServiceUnavailableException('Choice preparation returned an incomplete batch');
      for (const part of batch) {
        const alternatives = byKey.get(part.partKey);
        if (!alternatives || part.choices[0]?.routeKind !== 'writer_original') {
          throw new ServiceUnavailableException('Choice preparation returned an invalid part');
        }
        const original = part.choices[0];
        const authored = plan.storyKey === 'monster' || plan.storyKey === 'rebellion'
          ? [] : part.choices.slice(1);
        const suggested = alternatives.filter((label) =>
          ![original, ...authored].some((choice) => choice.label.trim() === label.trim()));
        const labels = [...authored.map((choice) => choice.label), ...suggested].slice(0, 2);
        if (labels.length !== 2 || new Set([original.label, ...labels].map((label) => label.trim())).size !== 3) {
          throw new ServiceUnavailableException('Choice preparation did not produce distinct routes');
        }
        part.choices = [original, ...labels.map((label, index) => ({
          choiceKey: plan.storyKey === 'monster' || plan.storyKey === 'rebellion'
            ? index === 0 ? 'ai-branch-b-v1' : 'ai-branch-c-v1'
            : index === 0 ? 'branch-b' : 'branch-c',
          label,
          position: index + 2,
          routeKind: 'generation_required',
          targetPartKey: null,
          targetEndingKey: null,
        }))];
      }
      const prepared = new Set(plan.choicePreparation?.preparedPartKeys ?? []);
      for (const part of batch) prepared.add(part.partKey);
      plan.choicePreparation = { version: CHOICE_PREPARATION_VERSION, preparedPartKeys: [...prepared],
        profileBinding: generationProfile?.binding ?? null };
      const persist = async (db: PrismaService | Prisma.TransactionClient) => {
        const currentProfile = await this.profilePolicy().forPlan(db, plan, true);
        this.profilePolicy().assertSame(generationProfile?.binding, currentProfile?.binding);
        const updated = await db.storyPublicationImportJob.updateMany({
          where: { id: jobId, actorUserId, status: 'queued', errorCode: claim },
          data: { planSnapshot: this.storedPlan(plan), errorCode: job.errorCode },
        });
        if (updated.count === 1 && db.auditEvent) await db.auditEvent.create({ data: {
          actorUserId, actorType: 'admin', action: 'story_public_beta.import_choices.prepared',
          targetType: 'story_publication_import_job', targetId: jobId,
          metadata: { sourceBindingSha256: plan.sourceBindingSha256, manuscriptHash: plan.manuscript.contentHash,
            partKeys: batch.map(part => part.partKey), generationProfileBinding: generationProfile?.binding ?? null,
            policyVersion: CHOICE_PREPARATION_VERSION,
            choicePlanDigest: releaseChecksum(batch.map(part => ({ partKey: part.partKey, choices: part.choices }))) },
        } });
        return updated;
      };
      const updated = this.prisma.$transaction
        ? await this.prisma.$transaction(persist, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000, timeout: 30000 }) : await persist(this.prisma);
      if (updated.count !== 1) {
        throw new ConflictException({
          code: 'STORY_CHOICE_PREPARATION_CONCURRENT_UPDATE',
          message: 'Choice preparation changed concurrently; review the provider outcome',
        });
      }
      return {
        ...this.importJobReceipt(job, plan.parts.length),
        status: 'preparing_choices',
        processedParts: prepared.size,
      };
    } catch (error) {
      await this.prisma.storyPublicationImportJob.updateMany({
        where: { id: jobId, actorUserId, status: 'queued', errorCode: claim },
        data: { errorCode: `${CHOICE_PREPARATION_REVIEW_REQUIRED}${claim.slice(CHOICE_PREPARATION_IN_FLIGHT.length)}` },
      });
      if (error instanceof StoryChoicePreparationError) {
        throw new ServiceUnavailableException({
          code: 'STORY_CHOICE_PREPARATION_REVIEW_REQUIRED',
          details: { reason: error.code },
          message: 'Provider outcome must be reviewed before this batch is retried',
        });
      }
      throw error;
    }
  }

  async publishedInheritorChoiceStatus(expected?: { workId: string; releaseId: string }) {
    if (!expected && this.prisma.storyWorkGenerationProfile) {
      const candidates = await this.prisma.storyWork.findMany({ where: {
        slug: { startsWith: `${INHERITOR_STORY.slug}-` }, status: 'published',
        fixtureSource: false, publishedAt: { not: null },
      }, select: { id: true }, take: 2 });
      if (candidates.length > 1) throw new ConflictException({
        code: 'STORY_PUBLICATION_SOURCE_SELECTION_REQUIRED',
        message: 'Multiple published copies exist; identify the source before preparing alternatives',
      });
    }
    const work = await this.prisma.storyWork.findFirst({
      where: { ...(expected ? { id: expected.workId } : {}),
        slug: { startsWith: `${INHERITOR_STORY.slug}-` }, status: 'published',
        fixtureSource: false, publishedAt: { not: null } },
      orderBy: { publishedAt: 'desc' },
      select: { id: true, slug: true, activeReleaseId: true },
    });
    if (!work?.activeReleaseId) throw new NotFoundException('Published story work not found');
    if (expected && work.activeReleaseId !== expected.releaseId) throw new ConflictException({
      code: 'STORY_PUBLICATION_CHOICE_SOURCE_CHANGED', message: 'The published source changed during preparation',
    });
    const parts = await this.prisma.storyPart.findMany({
      where: { workId: work.id, status: 'published', fixtureSource: false },
      orderBy: { position: 'asc' },
      select: { id: true, position: true, title: true },
    });
    const scenes = await this.prisma.storyScene.findMany({
      where: { partId: { in: parts.map((part) => part.id) }, status: 'published', fixtureSource: false },
      select: { id: true, partId: true },
    });
    if (scenes.length !== parts.length ||
        new Set(scenes.map((scene) => scene.partId)).size !== parts.length ||
        parts.length !== INHERITOR_STORY.partCount ||
        parts.some((part, index) => part.position !== index + 1)) {
      throw new ConflictException('Published story parts are incomplete');
    }
    const sceneByPart = new Map(scenes.map((scene) => [scene.partId, scene.id]));
    const counts = await this.prisma.storyChoice.groupBy({
      by: ['sceneId'],
      where: { sceneId: { in: scenes.map((scene) => scene.id) }, position: { gt: 0 } },
      _count: { _all: true },
    });
    const countByScene = new Map(counts.map((item) => [item.sceneId, item._count._all]));
    const threeChoiceSceneIds = scenes.filter((scene) => countByScene.get(scene.id) === 3)
      .map((scene) => scene.id);
    const threeChoices = threeChoiceSceneIds.length ? await this.prisma.storyChoice.findMany({
      where: { sceneId: { in: threeChoiceSceneIds }, position: { gt: 0 } },
      select: { sceneId: true, position: true, label: true, routeKind: true,
        targetSceneId: true, targetEndingKey: true },
    }) : [];
    const choicesByScene = new Map<string, typeof threeChoices>();
    for (const choice of threeChoices) {
      const rows = choicesByScene.get(choice.sceneId) ?? [];
      rows.push(choice);
      choicesByScene.set(choice.sceneId, rows);
    }
    const pending = parts.filter((part) => {
      const sceneId = this.requiredId(sceneByPart, part.id);
      return !hasPreparedOriginalAndAlternatives(choicesByScene.get(sceneId) ?? []);
    });
    const preparationBatch = await this.prisma.storyPublicationChoiceBatch.findFirst({
      where: { workId: work.id, releaseId: work.activeReleaseId,
        status: { in: ['in_progress', 'review_required', 'retry_authorized'] } },
      select: { id: true, status: true, firstPartPosition: true, updatedAt: true,
        workId: true, releaseId: true, preparationContext: true, preparationContextSha256: true },
    });
    let reviewContextReady = false;
    let partKeys: string[] = [];
    if (preparationBatch) {
      try {
        partKeys = readPublishedChoicePreparationContext(preparationBatch).parts.map(part => part.partKey);
        reviewContextReady = true;
      } catch { /* Old attempts have no provable scope; do not infer one from their first part. */ }
    }
    return {
      workId: work.id,
      slug: work.slug,
      releaseId: work.activeReleaseId,
      totalParts: parts.length,
      preparedParts: parts.length - pending.length,
      status: pending.length ? 'preparing_choices' : 'ready',
      preparationBatch: preparationBatch ? { id: preparationBatch.id, status: preparationBatch.status,
        firstPartPosition: preparationBatch.firstPartPosition, updatedAt: preparationBatch.updatedAt,
        reviewContextReady, partKeys } : null,
      pending: pending.slice(0, CHOICE_PREPARATION_BATCH_SIZE).map((part) => ({
        partId: part.id,
        partKey: `part-${part.position}`,
        sceneId: this.requiredId(sceneByPart, part.id),
        title: String((part.title as Record<string, unknown>)?.ko ?? ''),
        choiceCount: countByScene.get(this.requiredId(sceneByPart, part.id)) ?? 0,
      })),
    };
  }

  async preparePublishedInheritorChoices(actorUserId: string, expected?: { workId: string; releaseId: string }) {
    const status = await this.publishedInheritorChoiceStatus(expected);
    if (status.status === 'ready') return status;
    const generationProfile = await this.profilePolicy().forWork(this.prisma, status.workId,
      { releaseId: status.releaseId });
    if (status.pending.some((part) => part.choiceCount !== 1)) {
      throw new ConflictException({
        code: 'STORY_CHOICE_PREPARATION_REVIEW_REQUIRED',
        message: 'A published part has an unexpected choice count; review it before AI preparation',
      });
    }
    const sceneIds = status.pending.map((item) => item.sceneId);
    const [beats, choices] = await Promise.all([
      this.prisma.storyBeat.findMany({
        where: { sceneId: { in: sceneIds } },
        orderBy: [{ sceneId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
        select: { sceneId: true, content: true },
      }),
      this.prisma.storyChoice.findMany({
        where: { sceneId: { in: sceneIds }, routeKind: 'writer_original' },
        orderBy: [{ sceneId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
        select: { id: true, choiceKey: true, sceneId: true, position: true, label: true, routeKind: true,
          targetSceneId: true, targetEndingKey: true, declaredRejoinSceneId: true },
      }),
    ]);
    const sourceDigest = releaseChecksum({ beats, choices });
    const textByScene = new Map<string, string>();
    for (const beat of beats) {
      const text = String((beat.content as Record<string, unknown>)?.ko ?? '');
      textByScene.set(beat.sceneId, `${textByScene.get(beat.sceneId) ?? ''}\n${text}`);
    }
    if (sceneIds.some((sceneId) => !textByScene.get(sceneId)?.trim())) {
      throw new ConflictException({
        code: 'STORY_CHOICE_PREPARATION_REVIEW_REQUIRED',
        message: 'A published part has no Korean manuscript text for choice preparation',
      });
    }
    const originalByScene = new Map(choices.map((choice) => [
      choice.sceneId,
      String((choice.label as Record<string, unknown>)?.ko ?? ''),
    ]));
    if (originalByScene.size !== sceneIds.length || choices.length !== sceneIds.length ||
        choices.some((choice) => !hasValidWriterOriginalChoice(choice) || choice.declaredRejoinSceneId)) {
      throw new ConflictException({
        code: 'STORY_CHOICE_PREPARATION_REVIEW_REQUIRED',
        message: 'A published part is missing its unique authored choice',
      });
    }
    this.choiceProvider();
    const claimToken = randomUUID();
    let batchId: string | undefined;
    const firstPartPosition = Number(status.pending[0].partKey.slice('part-'.length));
    const preparationContext: PublishedChoicePreparationContext = {
      version: 'published-choice-exact-scope-v1', workId: status.workId, releaseId: status.releaseId,
      parts: status.pending.map(({ partId, partKey, sceneId, title }) => ({ partId, partKey, sceneId, title })),
      sourceDigest, generationProfileBinding: generationProfile?.binding ?? null,
    };
    const preparationContextSha256 = releaseChecksum(preparationContext);
    try {
      const batch = await this.prisma.storyPublicationChoiceBatch.create({ data: {
        workId: status.workId,
        releaseId: status.releaseId,
        firstPartPosition,
        status: 'in_progress',
        claimToken,
        preparationContext,
        preparationContextSha256,
      } });
      batchId = batch.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const previous = await this.prisma.storyPublicationChoiceBatch.findFirst({
          where: { workId: status.workId, releaseId: status.releaseId, firstPartPosition },
          select: { id: true, status: true, claimToken: true, updatedAt: true,
            workId: true, releaseId: true, firstPartPosition: true,
            preparationContext: true, preparationContextSha256: true },
        });
        if (previous?.status === 'retry_authorized') {
          assertSamePublishedChoicePreparationContext(previous, preparationContext);
          const resume = async (tx: Prisma.TransactionClient) => {
            if (tx.storyWorkGenerationProfile) {
              await this.assertPublishedChoiceContextTx(tx, preparationContext);
              const counts = await tx.storyChoice.groupBy({ by: ['sceneId'],
                where: { sceneId: { in: sceneIds }, position: { gt: 0 } }, _count: { _all: true } });
              if (counts.length !== sceneIds.length || counts.some(count => count._count._all !== 1)) {
                throw new ConflictException({ code: 'STORY_CHOICE_PREPARATION_CONCURRENT_UPDATE',
                  message: 'Choices changed before acquiring the reviewed retry claim' });
              }
            }
            return tx.storyPublicationChoiceBatch.updateMany({
              where: { id: previous.id, status: 'retry_authorized', claimToken: previous.claimToken,
                updatedAt: previous.updatedAt, preparationContextSha256 },
              data: { status: 'in_progress', claimToken, errorCode: null },
            });
          };
          const resumed = this.prisma.storyWorkGenerationProfile ? await this.prisma.$transaction(resume,
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 30000 })
            : await resume(this.prisma);
          if (resumed.count === 1) batchId = previous.id;
        }
        if (!batchId) throw new ConflictException({
          code: 'STORY_CHOICE_PREPARATION_IN_PROGRESS_OR_REVIEW',
          message: 'This published choice batch was already attempted; review its outcome before retrying',
        });
      } else {
        throw error;
      }
    }
    if (!batchId) throw new ConflictException('Choice preparation claim was not acquired');
    try {
    if (this.prisma.storyWorkGenerationProfile) {
      await this.prisma.$transaction(async tx => {
        await this.assertPublishedChoiceContextTx(tx, preparationContext);
        const claimed = await tx.storyPublicationChoiceBatch.findFirst({ where: { id: batchId,
          claimToken, status: 'in_progress', preparationContextSha256 }, select: { id: true } });
        const counts = await tx.storyChoice.groupBy({ by: ['sceneId'],
          where: { sceneId: { in: sceneIds }, position: { gt: 0 } }, _count: { _all: true } });
        if (!claimed || counts.length !== sceneIds.length || counts.some(count => count._count._all !== 1)) {
          throw new ConflictException({ code: 'STORY_CHOICE_PREPARATION_CONCURRENT_UPDATE',
            message: 'The reviewed claim or choices changed before provider dispatch' });
        }
      },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 30000 });
    }
    const result = await this.generateChoiceBatch({
      workTitle: INHERITOR_STORY.title,
      ...(generationProfile ? { generationProfile: generationProfile.approved } : {}),
      parts: status.pending.map((part) => {
        const text = textByScene.get(part.sceneId) ?? '';
        return {
          partKey: part.partKey,
          title: part.title,
          endingExcerpt: text.slice(-1200),
          originalChoiceLabel: originalByScene.get(part.sceneId) ?? '',
          context: text.slice(0, 350),
        };
      }),
    });
    const byKey = new Map(result.map((item) => [item.partKey, item.alternatives]));
    if (byKey.size !== status.pending.length) {
      throw new ServiceUnavailableException('Choice preparation returned an incomplete batch');
    }
    await this.prisma.$transaction(async (tx) => {
      if (tx.storyWorkGenerationProfile) {
        await this.assertPublishedChoiceContextTx(tx, preparationContext);
      } else {
        const currentProfile = await this.profilePolicy().forWork(tx, status.workId,
          { releaseId: status.releaseId, lock: true });
        this.profilePolicy().assertSame(generationProfile?.binding, currentProfile?.binding);
      }
      const generatedChoices = status.pending.flatMap((part) => {
          const alternatives = byKey.get(part.partKey);
          if (!alternatives || !originalByScene.get(part.sceneId)) {
            throw new ServiceUnavailableException('Choice preparation returned an invalid part');
          }
          return alternatives.map((label, index) => ({
            sceneId: part.sceneId,
            choiceKey: index === 0 ? 'branch-b' : 'branch-c',
            position: index + 2,
            label: { ko: label },
            routeKind: 'generation_required',
            targetSceneId: null,
            targetEndingKey: null,
            declaredRejoinSceneId: null,
          }));
        });
      const inserted = await tx.storyChoice.createMany({ data: generatedChoices, skipDuplicates: true });
      const persisted = await tx.storyChoice.findMany({
        where: { sceneId: { in: sceneIds }, position: { gt: 0 } },
        select: { choiceKey: true, sceneId: true, position: true, label: true, routeKind: true,
          targetSceneId: true, targetEndingKey: true, declaredRejoinSceneId: true },
      });
      if ((tx.storyWorkGenerationProfile && inserted.count !== generatedChoices.length) ||
          status.pending.some((part) => !hasPreparedOriginalAndAlternatives(
            persisted.filter((choice) => choice.sceneId === part.sceneId))) ||
          generatedChoices.some(expected => !persisted.some(actual => actual.sceneId === expected.sceneId &&
            actual.position === expected.position && actual.choiceKey === expected.choiceKey &&
            releaseChecksum(actual.label) === releaseChecksum(expected.label) && actual.routeKind === expected.routeKind &&
            actual.targetSceneId === null && actual.targetEndingKey === null && !actual.declaredRejoinSceneId))) {
        throw new ConflictException({
          code: 'STORY_CHOICE_PREPARATION_CONCURRENT_UPDATE',
          message: 'Stored choices changed during preparation; review before retrying',
        });
      }
      const claimed = await tx.storyPublicationChoiceBatch.updateMany({
        where: { id: batchId, claimToken, status: 'in_progress' },
        data: { status: 'completed' },
      });
      if (claimed.count !== 1) throw new ConflictException({
        code: 'STORY_CHOICE_PREPARATION_CONCURRENT_UPDATE',
        message: 'Choice preparation changed concurrently; review the provider outcome',
      });
      await tx.auditEvent.create({ data: {
        actorUserId,
        actorType: 'admin',
        action: 'story_public_beta.ai_choices.prepared',
        targetType: 'story_work',
        targetId: status.workId,
        metadata: {
          releaseId: status.releaseId,
          partKeys: status.pending.map((part) => part.partKey),
          policyVersion: CHOICE_PREPARATION_VERSION,
          generationProfileBinding: generationProfile?.binding ?? null,
          sourceDigest,
          preparationContextSha256,
        },
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 30000 });
    } catch (error) {
      await this.prisma.storyPublicationChoiceBatch.updateMany({
        where: { id: batchId, claimToken, status: 'in_progress' },
        data: { status: 'review_required', errorCode: 'PROVIDER_OUTCOME_UNCERTAIN' },
      });
      throw error;
    }
    return this.publishedInheritorChoiceStatus({ workId: status.workId, releaseId: status.releaseId });
  }

  private async assertPublishedChoiceContextTx(tx: Prisma.TransactionClient,
    context: PublishedChoicePreparationContext) {
    const currentProfile = await this.profilePolicy().forWork(tx, context.workId,
      { releaseId: context.releaseId, lock: true });
    this.profilePolicy().assertSame(context.generationProfileBinding, currentProfile?.binding);
    const work = await tx.storyWork.findFirst({ where: { id: context.workId,
      activeReleaseId: context.releaseId, status: 'published', fixtureSource: false }, select: { id: true } });
    if (!work) throw new ConflictException({ code: 'STORY_PUBLICATION_CHOICE_SOURCE_CHANGED',
      message: 'The published release changed before choice preparation or review' });
    const partIds = context.parts.map(part => part.partId);
    const sceneIds = context.parts.map(part => part.sceneId);
    if (tx.storyWorkGenerationProfile) {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_parts
        WHERE id IN (${Prisma.join(partIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_scenes
        WHERE part_id IN (${Prisma.join(partIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_beats
        WHERE scene_id IN (${Prisma.join(sceneIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_choices
        WHERE scene_id IN (${Prisma.join(sceneIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`);
    }
    const [parts, scenes, beats, choices] = await Promise.all([
      tx.storyPart.findMany({ where: { id: { in: partIds }, workId: context.workId,
        status: 'published', fixtureSource: false }, select: { id: true, position: true, title: true } }),
      tx.storyScene.findMany({ where: { partId: { in: partIds }, status: 'published', fixtureSource: false },
        select: { id: true, partId: true } }),
      tx.storyBeat.findMany({ where: { sceneId: { in: sceneIds } },
        orderBy: [{ sceneId: 'asc' }, { position: 'asc' }, { id: 'asc' }], select: { sceneId: true, content: true } }),
      tx.storyChoice.findMany({ where: { sceneId: { in: sceneIds }, routeKind: 'writer_original' },
        orderBy: [{ sceneId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
        select: { id: true, choiceKey: true, sceneId: true, position: true, label: true, routeKind: true,
          targetSceneId: true, targetEndingKey: true, declaredRejoinSceneId: true } }),
    ]);
    if (parts.length !== context.parts.length || scenes.length !== context.parts.length ||
        context.parts.some(part => !parts.some(current => current.id === part.partId &&
          `part-${current.position}` === part.partKey &&
          String((current.title as Record<string, unknown>)?.ko ?? '') === part.title) ||
          !scenes.some(current => current.id === part.sceneId && current.partId === part.partId)) ||
        releaseChecksum({ beats, choices }) !== context.sourceDigest) {
      throw new ConflictException({ code: 'STORY_PUBLICATION_CHOICE_SOURCE_CHANGED',
        message: 'The exact batch manuscript, scene mapping or original route changed' });
    }
  }

  async reviewPublishedInheritorChoiceBatch(
    actorUserId: string,
    batchId: string,
    review: ReviewPublishedChoiceBatchDto,
  ) {
    return this.prisma.$transaction(async tx => {
      const batch = await tx.storyPublicationChoiceBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new NotFoundException('Choice preparation batch not found');
      if (!['in_progress', 'review_required'].includes(batch.status)) throw new ConflictException({
        code: 'STORY_CHOICE_PREPARATION_NOT_REVIEWABLE',
        message: 'This choice batch is not awaiting operator review',
      });
      if (batch.status === 'in_progress' && Date.now() - batch.updatedAt.getTime() < 10 * 60_000) {
        throw new ConflictException({
          code: 'STORY_CHOICE_PREPARATION_STILL_RUNNING',
          message: 'Wait for the provider timeout before reviewing an interrupted batch',
        });
      }
      const context = readPublishedChoicePreparationContext(batch);
      await this.assertPublishedChoiceContextTx(tx, context);
      const sceneIds = context.parts.map(part => part.sceneId);
      const choices = await tx.storyChoice.findMany({
        where: { sceneId: { in: sceneIds }, position: { gt: 0 } },
        select: { sceneId: true, position: true, label: true, routeKind: true,
          targetSceneId: true, targetEndingKey: true, declaredRejoinSceneId: true },
      });
      const sceneCounts = sceneIds.map(sceneId => choices.filter(choice => choice.sceneId === sceneId).length);
      const completed = sceneCounts.every((count) => count === 3);
      if (completed && sceneIds.some(sceneId => !hasPreparedOriginalAndAlternatives(
        choices.filter(choice => choice.sceneId === sceneId)))) {
        throw new ConflictException('Choice batch has three entries but invalid routes');
      }
      if (!completed && !sceneCounts.every((count) => count === 1)) {
        throw new ConflictException({
          code: 'STORY_CHOICE_PREPARATION_PARTIAL_RESULT',
          message: 'Choice counts must be reconciled before a retry can be authorized',
        });
      }
      if (choices.some(choice => choice.declaredRejoinSceneId) || (!completed &&
          choices.some(choice => !hasValidWriterOriginalChoice(choice)))) {
        throw new ConflictException({ code: 'STORY_CHOICE_PREPARATION_PARTIAL_RESULT',
          message: 'Choice routes must be reconciled before a retry can be authorized' });
      }
      const nextStatus = completed ? 'completed' : 'retry_authorized';
      const updated = await tx.storyPublicationChoiceBatch.updateMany({
        where: { id: batch.id, status: batch.status, claimToken: batch.claimToken,
          updatedAt: batch.updatedAt, preparationContextSha256: batch.preparationContextSha256 },
        data: { status: nextStatus, errorCode: null },
      });
      if (updated.count !== 1) throw new ConflictException({
        code: 'STORY_CHOICE_PREPARATION_CONCURRENT_UPDATE',
        message: 'Choice preparation changed during operator review',
      });
      await tx.auditEvent.create({ data: {
        actorUserId, actorType: 'admin', action: 'story_public_beta.ai_choices.reviewed',
        targetType: 'story_work', targetId: batch.workId,
        metadata: { batchId: batch.id, releaseId: batch.releaseId,
          firstPartPosition: batch.firstPartPosition, previousStatus: batch.status,
          partKeys: context.parts.map(part => part.partKey),
          preparationContextSha256: batch.preparationContextSha256,
          sourceDigest: context.sourceDigest, generationProfileBinding: context.generationProfileBinding,
          nextStatus, reviewOutcome: review.outcome, reviewNote: review.reviewNote.trim() },
      } });
      return { batchId: batch.id, status: nextStatus, retryRequiresSeparateRequest: !completed };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 30000 })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
          throw new ConflictException({ code: 'STORY_CHOICE_PREPARATION_CONCURRENT_UPDATE',
            message: 'Choice preparation changed during operator review; reload its state' });
        }
        throw error;
      });
  }

  private assertPublicRatingReady(
    plan: Pick<PublicationPlan, 'storyKey' | 'contentRating' | 'catalogVisibility'>,
  ) {
    const approvedPublicTest = plan.storyKey === 'inheritor' && plan.catalogVisibility === 'public_test';
    if (plan.contentRating === 'adults_only' && plan.catalogVisibility !== 'unlisted' && !approvedPublicTest) {
      throw new ConflictException({
        code: 'STORY_ADULT_VERIFICATION_REQUIRED',
        message: 'Adult identity verification must be enforced before a listed release can be published',
      });
    }
  }

  private async publish(
    actorUserId: string,
    submissionId: string | null,
    plan: PublicationPlan,
    confirmation: PromoteStoryUploadDto,
  ) {
    this.assertThreeChoicePlan(plan);
    const workId = randomUUID();
    const manuscriptVersionId = randomUUID();
    const releaseId = randomUUID();
    const publishedAt = new Date();
    const releaseSnapshot = {
      manuscriptVersionId,
      branchGraphSnapshot: {
        contract: 'story-public-beta-exact-source-v1',
        fixedChoiceCount: 3,
        customChoiceEnabled: false,
        aiGeneratedBranchesActivated: false,
      },
      endingSetSnapshot: {
        authorMain: true,
        generatedEndingsActivated: false,
      },
      sceneAssetManifest: {
        state: 'prompt_backed',
        promptCount: plan.prompts.length,
        ...(plan.visualBible ? { visualBible: plan.visualBible } : {}),
      },
      localizedDisplaySnapshot: {
        ko: { title: plan.title, summary: plan.summary },
      },
    };
    const checksum = releaseChecksum(releaseSnapshot);
    const hashtagKeys = plan.hashtagKeys?.length
      ? plan.hashtagKeys
      : [...STORY_HASHTAG_KEYS[plan.storyKey]];
    const hashtagLabels = labelsForStoryHashtags(hashtagKeys);
    return this.prisma.$transaction(async (tx) => {
      if (submissionId) {
        const locked = await tx.$queryRaw<Array<{
          id: string;
          promoted_work_id: string | null;
        }>>(Prisma.sql`
          SELECT "id", "promoted_work_id"
          FROM "story_upload_submissions"
          WHERE "id" = ${submissionId}::uuid
          FOR UPDATE
        `);
        if (!locked.length) throw new NotFoundException('Story upload submission not found');
        if (locked[0].promoted_work_id) {
          const existing = await tx.storyWork.findUnique({
            where: { id: locked[0].promoted_work_id },
            select: { id: true, slug: true, activeReleaseId: true, status: true },
          });
          if (!existing) throw new ConflictException('Promoted story work is missing');
          return { work: existing, idempotentReplay: true };
        }
      }
      const existingSlug = await tx.storyWork.findUnique({
        where: { slug: plan.slug },
        select: { id: true, slug: true, activeReleaseId: true, status: true },
      });
      if (existingSlug) {
        if (!submissionId && existingSlug.status === 'published') {
          return { work: existingSlug, idempotentReplay: true };
        }
        throw new ConflictException({
          code: 'STORY_PUBLICATION_SLUG_ALREADY_EXISTS',
          message: 'This approved story is already registered from another upload',
        });
      }

      await tx.storyWork.create({
        data: {
          id: workId,
          ownerUserId: actorUserId,
          slug: plan.slug,
          status: 'release_ready',
          defaultLocale: 'ko',
          supportedLocales: ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'],
          title: { ko: plan.title },
          summary: { ko: plan.summary },
          authorDisplayName: COMPANY_AUTHOR_DISPLAY_NAME,
          hashtagKeys,
          hashtagLabels,
          searchText: buildStorySearchText(plan.title, plan.summary, hashtagLabels, COMPANY_AUTHOR_DISPLAY_NAME),
          coverManifest: {
            publicAssetPath: plan.coverPath,
            altKey: `story.cover.${plan.storyKey}`,
            ...(plan.contentRating ? { contentRating: plan.contentRating } : {}),
            ...(plan.catalogVisibility ? { catalogVisibility: plan.catalogVisibility } : {}),
          },
          priceLumina: 0,
          fixtureSource: false,
          publishedVersion: 1,
          customChoiceEnabled: false,
          activeReleaseId: null,
          releaseRevision: 1,
          publishedAt: null,
        },
      });
      await tx.storyManuscriptVersion.create({
        data: {
          id: manuscriptVersionId,
          workId,
          ownerUserId: actorUserId,
          version: 1,
          locale: plan.manuscript.locale,
          contentHash: plan.manuscript.contentHash,
          structuredBody: storedManuscriptBody(plan.manuscript) as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.storyRelease.create({
        data: {
          id: releaseId,
          workId,
          version: 1,
          status: 'active',
          ...releaseSnapshot,
          checksum,
          validationSummary: {
            ready: true,
            blockingIssueCount: 0,
            sourceIdentityVerified: true,
            publicBetaScope: 'authored_route_only',
          },
          diffSummary: {
            sourceBindingSha256: plan.sourceBindingSha256,
            sourceRawTextIncluded: false,
          },
          createdByUserId: actorUserId,
          activatedAt: publishedAt,
        },
      });

      const partRows = plan.parts.map((part) => ({
        id: randomUUID(),
        workId,
        seasonKey: 'season-1',
        actNumber: part.actNumber,
        position: part.position,
        status: 'published',
        title: { ko: part.title },
        priceLumina: 0,
        fixtureSource: false,
        publishedAt,
      }));
      const sceneRows = plan.parts.map((part, index) => ({
        id: randomUUID(),
        partId: partRows[index].id,
        sceneKey: `${part.partKey}-main`,
        position: 1,
        status: 'published',
        title: { ko: part.title },
        visualManifest: this.authoredVisual(plan, `${part.partKey}-main`, part.position),
        endingType: null,
        fixtureSource: false,
      }));
      const sceneByPartKey = new Map(
        plan.parts.map((part, index) => [part.partKey, sceneRows[index].id]),
      );
      await tx.storyPart.createMany({ data: partRows });
      await tx.storyScene.createMany({ data: sceneRows });

      const beatRows = plan.parts.flatMap((part, index) =>
        part.beats.map((beat, beatIndex) => ({
          sceneId: sceneRows[index].id,
          position: beatIndex + 1,
          beatType: 'narration',
          content: { ko: beat.text },
          sourceSceneKey: beat.sourceSceneKey,
          visualManifest: this.authoredVisual(plan, beat.sourceSceneKey, part.position),
        })),
      );
      for (let index = 0; index < beatRows.length; index += 256) {
        await tx.storyBeat.createMany({ data: beatRows.slice(index, index + 256) });
      }
      const choiceRows = plan.parts.flatMap((part, index) =>
        part.choices.map((choice) => ({
          sceneId: sceneRows[index].id,
          choiceKey: choice.choiceKey,
          position: choice.position,
          label: { ko: choice.label },
          routeKind: choice.routeKind,
          targetSceneId: choice.targetPartKey
            ? sceneByPartKey.get(choice.targetPartKey) ?? null
            : null,
          targetEndingKey: choice.targetEndingKey,
          declaredRejoinSceneId: null,
        })),
      );
      for (let index = 0; index < choiceRows.length; index += 256) {
        await tx.storyChoice.createMany({ data: choiceRows.slice(index, index + 256) });
      }
      await this.assertChoiceProfileTx(tx, plan);
      await this.assertStoredPublicationTx(tx, workId, plan);
      const promptRows = plan.prompts.map((prompt) => ({
        workId,
        releaseId,
        releaseChecksum: checksum,
        ...prompt,
        sourceKind: 'admin_verified',
        sourceBindingSha256: plan.sourceBindingSha256,
      }));
      for (let index = 0; index < promptRows.length; index += 256) {
        await tx.storyVisualPrompt.createMany({ data: promptRows.slice(index, index + 256) });
      }

      const rateCard = await tx.storyAiRateCard.upsert({
        where: { version: DISABLED_RATE_CARD_VERSION },
        create: {
          version: DISABLED_RATE_CARD_VERSION,
          provider: 'disabled',
          model: 'not_activated',
          status: 'active',
          currencyCode: 'KRW',
          inputCostPerMillion: 0,
          outputCostPerMillion: 0,
          cachedInputCostPerMillion: 0,
          imageUnitCost: 0,
          createdByUserId: actorUserId,
          effectiveAt: publishedAt,
        },
        update: {},
      });
      await tx.storyReleaseCapability.create({
        data: {
          workId,
          releaseId,
          rateCardId: rateCard.id,
          fixedChoiceCount: 3,
          customChoiceEnabled: false,
          customChoiceMaxLength: 200,
          fullResetLimit: 1,
          actResetLimit: 3,
          includedAiRouteCount: 0,
          aiInputTokenLimit: 0,
          aiOutputTokenLimit: 0,
          warningBudgetKrw: 0,
          hardBudgetKrw: 0,
          status: 'active',
          validationErrors: [],
          revision: 1,
          updatedByUserId: actorUserId,
        },
      });
      await tx.storyPublicationTransition.create({
        data: {
          workId,
          releaseId,
          actorUserId,
          idempotencyKey: submissionId
            ? `story-upload-publication:${submissionId}`
            : `story-approved-publication:${plan.sourceBindingSha256}`,
          fromStatus: 'release_ready',
          toStatus: 'published',
          beforeRevision: 1,
          afterRevision: 2,
          publicSummary: {
            sourceIdentityVerified: true,
            scope: 'authored_route_only',
            aiGeneratedBranchesActivated: false,
          },
        },
      });
      await tx.storyWork.update({
        where: { id: workId },
        data: {
          status: 'published',
          activeReleaseId: releaseId,
          releaseRevision: 2,
          publishedAt,
        },
      });
      if (submissionId) {
        await tx.storyUploadSubmission.update({
          where: { id: submissionId },
          data: { status: 'published', promotedWorkId: workId },
        });
      }
      await tx.auditEvent.create({
        data: {
          actorUserId,
          actorType: 'admin',
          action: submissionId
            ? 'story_upload.public_beta_published'
            : 'story_approved_source.public_beta_published',
          targetType: submissionId ? 'story_upload_submission' : 'story_work',
          targetId: submissionId ?? workId,
          afterData: {
            workId,
            releaseId,
            status: 'published',
            storyKey: plan.storyKey,
          },
          metadata: {
            finalManuscriptConfirmed: confirmation.finalManuscriptConfirmed,
            rightsConfirmed: confirmation.rightsConfirmed,
            publicReleaseConfirmed: confirmation.publicReleaseConfirmed,
            sourceBindingSha256: plan.sourceBindingSha256,
            partCount: plan.parts.length,
            promptCount: plan.prompts.length,
            aiGeneratedBranchesActivated: false,
          },
        },
      });
      return {
        work: {
          id: workId,
          slug: plan.slug,
          activeReleaseId: releaseId,
          status: 'published',
        },
        idempotentReplay: false,
        scope: 'authored_route_only',
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 60_000,
    });
  }

  private approvedPlan(storyKey: ApprovedStoryKey, buffers: Map<string, Buffer>): PublicationPlan {
    if (storyKey === 'imjin') {
      return this.imjinPlan(this.requiredBuffer(buffers, IMJIN_RELEASE_SOURCE.sha256));
    }
    if (storyKey === 'norse') {
      return this.norsePlan(
        this.requiredBuffer(buffers, NORSE_ANALYSIS_SHA256),
        this.requiredBuffer(buffers, NORSE_SOURCE_MAP_SHA256),
      );
    }
    if (storyKey === 'inheritor') {
      return this.inheritorPlan(buffers);
    }
    return this.fixedRoutePlan(storyKey, buffers);
  }

  private inheritorPlan(buffers: Map<string, Buffer>): PublicationPlan {
    const source = prepareInheritorPublicationSource(
      this.requiredBuffer(buffers, INHERITOR_STORY.manuscriptSha256),
      this.requiredBuffer(buffers, INHERITOR_STORY.promptSha256),
    );
    return {
      storyKey: 'inheritor',
      slug: `${INHERITOR_STORY.slug}-${source.sourceBindingSha256.slice(0, 32)}`,
      title: INHERITOR_STORY.title,
      summary: INHERITOR_STORY.summary,
      hashtagKeys: [...STORY_HASHTAG_KEYS.inheritor],
      coverPath: INHERITOR_STORY.coverPath,
      manuscript: source.manuscript,
      sourceBindingSha256: source.sourceBindingSha256,
      parts: source.parts,
      prompts: source.prompts,
      contentRating: 'adults_only',
      catalogVisibility: 'public_test',
    };
  }

  private async publishedInheritorWorkForSource(tx: Prisma.TransactionClient, sourceBindingSha256: string) {
    const releases = await tx.storyRelease.findMany({
      where: { diffSummary: { path: ['sourceBindingSha256'], equals: sourceBindingSha256 } },
      select: { id: true, workId: true },
    });
    if (!releases.length) return null;
    const works = await tx.storyWork.findMany({
      where: { id: { in: releases.map((release) => release.workId) },
        slug: { startsWith: `${INHERITOR_STORY.slug}-` }, status: 'published' },
      select: { id: true, slug: true, activeReleaseId: true, status: true },
    });
    const matching = works.filter((work) => releases.some((release) =>
      release.workId === work.id && release.id === work.activeReleaseId));
    if (matching.length > 1) throw new ConflictException({
      code: 'STORY_PUBLICATION_DUPLICATE_SOURCE',
      message: 'Multiple published works share the approved source; review them before publishing again',
    });
    return matching[0] ?? null;
  }

  private fixedRoutePlan(storyKey: FixedRouteStoryKey, buffers: Map<string, Buffer>): PublicationPlan {
    const config = FIXED_ROUTE_STORIES[storyKey];
    const source = prepareFixedRoutePublicationSource(
      config,
      this.requiredBuffer(buffers, config.manuscriptSha256),
      this.requiredBuffer(buffers, config.promptSha256),
    );
    return {
      storyKey,
      slug: config.slug,
      title: config.title,
      summary: config.summary,
      hashtagKeys: [...STORY_HASHTAG_KEYS[storyKey]],
      coverPath: config.coverPath,
      manuscript: source.manuscript,
      sourceBindingSha256: source.sourceBindingSha256,
      parts: source.parts,
      prompts: source.prompts,
      visualBible: config.visualBible,
    };
  }

  private imjinPlan(buffer: Buffer): PublicationPlan {
    const source = prepareImjinReleasePlan(buffer);
    const manuscript = prepareManuscript(Buffer.from(JSON.stringify({
      locale: 'ko',
      parts: source.parts.map((part) => ({
        partKey: part.partKey,
        title: part.title,
        paragraphs: part.beats.map((text) => ({ kind: 'paragraph', text })),
      })),
    }), 'utf8'));
    const prompts = source.parts.map((part) => {
      const direction = part.privateDirectives
        .filter((item) => item.type === 'background' || item.type === 'background_image')
        .map((item) => item.value)
        .filter((value): value is string => Boolean(value))
        .join(', ');
      const promptText = `임진왜란 역사극 장면. ${part.title}. ${direction}. 인물과 배경의 시대 고증을 유지하고 글자는 넣지 않는다.`;
      return {
        sourceSceneKey: part.sceneKey,
        promptText,
        promptSha256: authoredHash(promptText),
      };
    });
    return {
      storyKey: 'imjin',
      slug: 'records-of-the-burning-sea-imjin-war',
      title: '불타는 바다의 기록자',
      summary: '이순신 장군 곁에서 임진왜란의 선택과 결과를 기록하는 75파트 역사 서사.',
      hashtagKeys: [...STORY_HASHTAG_KEYS.imjin],
      coverPath: '/assets/story/imjin-war-cover.webp',
      manuscript,
      sourceBindingSha256: source.source.sha256,
      parts: source.parts.map((part, index) => ({
        partKey: part.partKey,
        title: part.title,
        actNumber: Math.floor(index / 15) + 1,
        position: index + 1,
        beats: part.beats.map((text) => ({ text, sourceSceneKey: part.sceneKey })),
        choices: part.choices.map((choice, choiceIndex) => ({
          choiceKey: choice.choiceKey,
          label: choice.label,
          position: choiceIndex + 1,
          routeKind: choice.routeKind,
          targetPartKey: choice.targetPartKey,
          targetEndingKey: choice.targetEndingKey,
        })),
      })),
      prompts,
    };
  }

  private norsePlan(analysisBuffer: Buffer, sourceMapBuffer: Buffer): PublicationPlan {
    const manuscript = prepareManuscript(analysisBuffer);
    const root = JSON.parse(sourceMapBuffer.toString('utf8')) as Record<string, any>;
    const lastPart = Array.isArray(root.parts) ? root.parts.at(-1) : null;
    const finalA = Array.isArray(lastPart?.choices) ? lastPart.choices[0] : null;
    const evidence = Array.isArray(root.endingEvidence)
      ? root.endingEvidence.find((item: any) =>
          item?.part === root.parts.length &&
          Array.isArray(finalA?.evidenceSegments) &&
          finalA.evidenceSegments.includes(item?.source?.segment) &&
          Array.isArray(item?.provenanceClaims) &&
          item.provenanceClaims.includes('author_default'))
      : null;
    if (!evidence) {
      throw new ConflictException({
        code: 'STORY_NORSE_ENDING_EVIDENCE_REQUIRED',
        message: 'The approved authored ending evidence is missing',
      });
    }
    const source = prepareAuthoredSourceMap(sourceMapBuffer, manuscript, {
      endingKey: 'author_main',
      evidenceSegment: evidence.source.segment,
    });
    return {
      storyKey: 'norse',
      slug: 'norse-myth-loki-crossroads',
      title: '북유럽 신화: 로키의 선택',
      summary: '신들의 운명과 라그나로크의 갈림길을 따라가는 216파트 북유럽 신화 서사.',
      hashtagKeys: [...STORY_HASHTAG_KEYS.norse],
      coverPath: '/assets/story/norse-myth-cover.webp',
      manuscript,
      sourceBindingSha256: source.sourceMapSha256,
      parts: source.parts.map((part) => ({
        partKey: part.partKey,
        title: part.title,
        actNumber: part.actNumber,
        position: part.position,
        beats: part.packing.beats.map((beat) => ({
          text: beat.text,
          sourceSceneKey: beat.sourceSceneKey,
        })),
        choices: part.choices.map((choice) => ({
          choiceKey: choice.choiceKey,
          label: choice.label,
          position: choice.readerOrdinal,
          routeKind: choice.routeKind,
          targetPartKey: choice.destination?.kind === 'part'
            ? choice.destination.partKey
            : null,
          targetEndingKey: choice.destination?.kind === 'ending'
            ? choice.destination.endingKey
            : null,
        })),
      })),
      prompts: source.parts.flatMap((part) => part.visualPrompts),
    };
  }

  private storedPlan(plan: PublicationPlan | PublicationPlanSnapshot): Prisma.InputJsonValue {
    const stored = {
      storyKey: plan.storyKey,
      slug: plan.slug,
      title: plan.title,
      summary: plan.summary,
      hashtagKeys: plan.hashtagKeys,
      coverPath: plan.coverPath,
      manuscript: {
        locale: plan.manuscript.locale,
        contentHash: plan.manuscript.contentHash,
        structuredBody: plan.storyKey === 'inheritor'
          ? {
              format: 'approved-source-plan-reference-v1',
              sourceSha256: {
                manuscript: INHERITOR_STORY.manuscriptSha256,
                imageDirections: INHERITOR_STORY.promptSha256,
              },
            }
          : 'structuredBody' in plan.manuscript
            ? plan.manuscript.structuredBody
            : storedManuscriptBody(plan.manuscript),
      },
      sourceBindingSha256: plan.sourceBindingSha256,
      parts: plan.parts,
      prompts: plan.prompts,
      visualBible: plan.visualBible,
      contentRating: plan.contentRating,
      catalogVisibility: plan.catalogVisibility,
      choicePreparation: plan.choicePreparation,
      submissionId: plan.submissionId,
      writerIntakeWorkflow: plan.writerIntakeWorkflow,
    };
    const serialized = Buffer.from(JSON.stringify(stored), 'utf8');
    const compressed = brotliCompressSync(serialized, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 6,
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: serialized.length,
      },
    });
    return {
      storageContract: PUBLICATION_PLAN_STORAGE_CONTRACT,
      data: compressed.toString('base64'),
    } as Prisma.InputJsonValue;
  }

  private hasStoredPlan(value: Prisma.JsonValue | null) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const plan = value as Record<string, unknown>;
    if (
      plan.storageContract === PUBLICATION_PLAN_STORAGE_CONTRACT &&
      typeof plan.data === 'string' &&
      plan.data.length > 0
    ) {
      return true;
    }
    const manuscript = plan.manuscript;
    return (
      APPROVED_STORY_KEYS.includes(String(plan.storyKey) as ApprovedStoryKey) &&
      typeof plan.slug === 'string' &&
      manuscript !== null &&
      typeof manuscript === 'object' &&
      !Array.isArray(manuscript) &&
      Array.isArray(plan.parts) &&
      Array.isArray(plan.prompts)
    );
  }

  private sourceUploadReceipt(
    jobId: string,
    uploadedChunks: number,
    totalChunks: number | null = null,
  ) {
    return {
      jobId,
      status: 'uploading',
      processedParts: 0,
      totalParts: NORSE_APPROVED_PART_COUNT,
      uploadedChunks,
      totalChunks,
    };
  }

  private readStoredPlan(value: Prisma.JsonValue | null): PublicationPlanSnapshot {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ConflictException('Story publication plan is missing');
    }
    const stored = value as Record<string, unknown>;
    let plan: PublicationPlanSnapshot;
    if (
      stored.storageContract === PUBLICATION_PLAN_STORAGE_CONTRACT &&
      typeof stored.data === 'string'
    ) {
      try {
        const serialized = brotliDecompressSync(
          Buffer.from(stored.data, 'base64'),
          { maxOutputLength: PUBLICATION_PLAN_MAX_BYTES },
        );
        plan = JSON.parse(serialized.toString('utf8')) as PublicationPlanSnapshot;
      } catch {
        throw new ConflictException('Story publication plan compression is invalid');
      }
    } else {
      plan = value as unknown as PublicationPlanSnapshot;
    }
    if (
      !APPROVED_STORY_KEYS.includes(plan.storyKey) ||
      !plan.slug ||
      !plan.manuscript?.contentHash ||
      !Array.isArray(plan.parts) ||
      !Array.isArray(plan.prompts)
    ) {
      throw new ConflictException('Story publication plan is invalid');
    }
    return plan;
  }

  private releaseSnapshot(
    plan: PublicationPlanSnapshot,
    manuscriptVersionId: string,
  ) {
    return {
      manuscriptVersionId,
      branchGraphSnapshot: {
        contract: 'story-public-beta-exact-source-v1',
        fixedChoiceCount: 3,
        customChoiceEnabled: false,
        aiGeneratedBranchesActivated: false,
      },
      endingSetSnapshot: {
        authorMain: true,
        generatedEndingsActivated: false,
      },
      sceneAssetManifest: {
        state: 'prompt_backed',
        promptCount: plan.prompts.length,
        ...(plan.visualBible ? { visualBible: plan.visualBible } : {}),
      },
      localizedDisplaySnapshot: {
        ko: { title: plan.title, summary: plan.summary },
      },
    };
  }

  private archivedManuscriptBody(
    plan: PublicationPlanSnapshot,
    publicationJobId: string,
  ): Prisma.InputJsonValue {
    if (plan.storyKey !== 'norse' && plan.storyKey !== 'inheritor') {
      return plan.manuscript.structuredBody as Prisma.InputJsonValue;
    }
    return {
      format: 'approved-source-archive-reference-v1',
      locale: plan.manuscript.locale,
      contentHash: plan.manuscript.contentHash,
      sourceBindingSha256: plan.sourceBindingSha256,
      archive: {
        storage: 'story_publication_source_chunks',
        publicationJobId,
        bundleContract: plan.storyKey === 'norse'
          ? 'norse-approved-bundle-v1'
          : 'inheritor-approved-bundle-v1',
        compression: 'brotli',
        sourceSha256: plan.storyKey === 'norse'
          ? { analysis: NORSE_ANALYSIS_SHA256, authoredSourceMap: NORSE_SOURCE_MAP_SHA256 }
          : { manuscript: INHERITOR_STORY.manuscriptSha256, imageDirections: INHERITOR_STORY.promptSha256 },
      },
      materialized: {
        partCount: plan.parts.length,
        promptCount: plan.prompts.length,
        readerContentStoredInStoryTables: true,
      },
    } as Prisma.InputJsonValue;
  }

  private importJobReceipt(
    job: {
      id: string;
      status: string;
      batchCursor: number;
      workId: string | null;
      releaseId: string | null;
      errorCode?: string | null;
    },
    totalParts: number,
    work?: {
      id: string;
      slug: string;
      activeReleaseId: string | null;
      status: string;
    },
  ) {
    return {
      jobId: job.id,
      status: job.status,
      processedParts: job.batchCursor,
      totalParts,
      workId: job.workId,
      releaseId: job.releaseId,
      errorCode: job.errorCode ?? null,
      work: work ?? null,
    };
  }

  private requiredId<Key>(map: ReadonlyMap<Key, string>, key: Key) {
    const value = map.get(key);
    if (!value) throw new ConflictException('Story publication materialization binding is missing');
    return value;
  }

  private authoredVisual(
    plan: PublicationPlan | PublicationPlanSnapshot,
    sourceSceneKey: string,
    position: number,
  ) {
    const manifest = missingAuthoredSceneVisual(sourceSceneKey);
    if (plan.storyKey !== 'inheritor' || position !== 1) return manifest;
    return {
      ...manifest,
      background: {
        ...manifest.background,
        state: 'ready',
        publicAssetPath: plan.coverPath,
      },
    };
  }

  private detectStoryKey(files: Array<{ checksumSha256: string }>) {
    const checksums = new Set(files.map((file) => file.checksumSha256));
    if (checksums.has(IMJIN_RELEASE_SOURCE.sha256)) return 'imjin' as const;
    if (
      checksums.has(NORSE_ANALYSIS_SHA256) &&
      checksums.has(NORSE_SOURCE_MAP_SHA256)
    ) {
      return 'norse' as const;
    }
    if (checksums.has(INHERITOR_STORY.manuscriptSha256) &&
        checksums.has(INHERITOR_STORY.promptSha256)) return 'inheritor' as const;
    return fixedRouteStoryKeyFromChecksums(checksums);
  }

  private requiredBuffer(buffers: Map<string, Buffer>, checksum: string) {
    const buffer = buffers.get(checksum);
    if (!buffer) throw new ConflictException('Approved story source is missing');
    return buffer;
  }

  private storageProvider(value: string) {
    if (value === 'local' || value === 'r2' || value === 's3') return value;
    throw new ConflictException('Story upload storage provider is invalid');
  }

  private sha256(value: Buffer) {
    return createHash('sha256').update(value).digest('hex');
  }
}

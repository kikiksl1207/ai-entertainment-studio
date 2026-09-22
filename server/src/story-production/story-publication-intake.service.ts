import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StoryUploadStorageService } from '../story-upload/story-upload-storage.service';
import { StoryUploadFileFields } from '../story-upload/story-upload.types';
import { PromoteStoryUploadDto } from './dto/story-publication-intake.dto';
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
  PreparedManuscript,
  prepareManuscript,
  storedManuscriptBody,
} from './story-manuscript-file.policy';
import { releaseChecksum } from './story-lifecycle.policy';

const NORSE_ANALYSIS_SHA256 =
  '74462e693982cbb72733b3db465e435c008309dbcb76c603b908ed1369cb37f8';
const NORSE_SOURCE_MAP_SHA256 =
  'f6482c710acbc7b63f98783f3ca7f06ebc37d22f5566deb51e719f438eae6bc5';
const DISABLED_RATE_CARD_VERSION = 'story-public-beta-disabled-ai-2026-09-22';

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
  storyKey: 'imjin' | 'norse';
  slug: string;
  title: string;
  summary: string;
  coverPath: string;
  manuscript: PreparedManuscript;
  sourceBindingSha256: string;
  parts: PublicationPart[];
  prompts: PublicationPrompt[];
};

@Injectable()
export class StoryPublicationIntakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StoryUploadStorageService,
  ) {}

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
          slug: {
            in: [
              'records-of-the-burning-sea-imjin-war',
              'norse-myth-loki-crossroads',
            ],
          },
          status: 'published',
        },
        select: { id: true, slug: true, activeReleaseId: true, status: true },
      }),
    ]);
    return {
      publishedWorks,
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
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
  ) {
    const files = fileFields.manuscripts ?? [];
    const expectedCount = input.storyKey === 'imjin' ? 1 : 2;
    if (files.length !== expectedCount) {
      throw new ConflictException({
        code: 'STORY_PUBLICATION_APPROVED_FILE_COUNT_MISMATCH',
        message: `Exactly ${expectedCount} approved source file(s) are required`,
      });
    }
    const buffers = new Map<string, Buffer>();
    for (const file of files) {
      if (!file.buffer?.length || file.size !== file.buffer.length) {
        throw new ConflictException('Approved story source file is invalid');
      }
      buffers.set(this.sha256(file.buffer), file.buffer);
    }
    if (buffers.size !== expectedCount || this.detectStoryKey(
      [...buffers.keys()].map((checksumSha256) => ({ checksumSha256 })),
    ) !== input.storyKey) {
      throw new ConflictException({
        code: 'STORY_PUBLICATION_SOURCE_IDENTITY_MISMATCH',
        message: 'The selected files do not match the approved manuscript',
      });
    }
    const plan = input.storyKey === 'imjin'
      ? this.imjinPlan(this.requiredBuffer(buffers, IMJIN_RELEASE_SOURCE.sha256))
      : this.norsePlan(
          this.requiredBuffer(buffers, NORSE_ANALYSIS_SHA256),
          this.requiredBuffer(buffers, NORSE_SOURCE_MAP_SHA256),
        );
    return this.publish(actorUserId, null, plan, input);
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
    const plan = input.storyKey === 'imjin'
      ? this.imjinPlan(this.requiredBuffer(buffers, IMJIN_RELEASE_SOURCE.sha256))
      : this.norsePlan(
          this.requiredBuffer(buffers, NORSE_ANALYSIS_SHA256),
          this.requiredBuffer(buffers, NORSE_SOURCE_MAP_SHA256),
        );
    return this.publish(actorUserId, submissionId, plan, input);
  }

  private async publish(
    actorUserId: string,
    submissionId: string | null,
    plan: PublicationPlan,
    confirmation: PromoteStoryUploadDto,
  ) {
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
      },
      localizedDisplaySnapshot: {
        ko: { title: plan.title, summary: plan.summary },
      },
    };
    const checksum = releaseChecksum(releaseSnapshot);
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
          status: 'published',
          defaultLocale: 'ko',
          supportedLocales: ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'],
          title: { ko: plan.title },
          summary: { ko: plan.summary },
          coverManifest: {
            publicAssetPath: plan.coverPath,
            altKey: `story.cover.${plan.storyKey}`,
          },
          priceLumina: 0,
          fixtureSource: false,
          publishedVersion: 1,
          customChoiceEnabled: false,
          activeReleaseId: releaseId,
          releaseRevision: 2,
          publishedAt,
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
        visualManifest: missingAuthoredSceneVisual(`${part.partKey}-main`),
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
          visualManifest: missingAuthoredSceneVisual(beat.sourceSceneKey),
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
      const promptRows = plan.prompts.map((prompt) => ({
        workId,
        releaseId,
        releaseChecksum: checksum,
        ...prompt,
        sourceKind: 'approved_public_beta_import',
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
      if (submissionId) {
        await tx.storyUploadSubmission.update({
          where: { id: submissionId },
          data: { status: 'published', promotedWorkId: workId },
        });
      }
      await tx.auditEvent.create({
        data: {
          actorUserId,
          actorType: 'admin_owner',
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

  private detectStoryKey(files: Array<{ checksumSha256: string }>) {
    const checksums = new Set(files.map((file) => file.checksumSha256));
    if (checksums.has(IMJIN_RELEASE_SOURCE.sha256)) return 'imjin' as const;
    if (
      checksums.has(NORSE_ANALYSIS_SHA256) &&
      checksums.has(NORSE_SOURCE_MAP_SHA256)
    ) {
      return 'norse' as const;
    }
    return null;
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

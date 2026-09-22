import { createHash } from 'crypto';
import { extname } from 'path';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  assertCreatorGenerationProfileApprovable,
  creatorGenerationProfileFingerprint,
  creatorGenerationProfileProjection,
  normalizeCreatorGenerationProfile,
} from '../generation-profile/creator-generation-profile.policy';
import {
  ApproveCreatorGenerationProfileDto,
  UpdateStoryGenerationProfileDto,
} from '../generation-profile/dto/creator-generation-profile.dto';
import { PrismaService } from '../prisma/prisma.service';
import { StoryUploadIntakeDto } from './dto/story-upload-intake.dto';
import { StoryUploadStorageService } from './story-upload-storage.service';
import {
  StoryUploadFile,
  StoryUploadFileCategory,
  StoryUploadFileFields,
  StoryUploadStoredFile,
} from './story-upload.types';

export const STORY_UPLOAD_TOTAL_MAX_BYTES = 150 * 1024 * 1024;

const CATEGORY_MAX_BYTES: Record<StoryUploadFileCategory, number> = {
  manuscript: 50 * 1024 * 1024,
  metadata: 10 * 1024 * 1024,
  visual: 25 * 1024 * 1024,
};

const ALLOWED_MIME_TYPES: Record<string, ReadonlySet<string>> = {
  '.md': new Set(['text/markdown', 'text/plain', 'application/octet-stream']),
  '.txt': new Set(['text/plain', 'application/octet-stream']),
  '.docx': new Set([
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream',
  ]),
  '.pdf': new Set(['application/pdf', 'application/octet-stream']),
  '.json': new Set([
    'application/json',
    'text/json',
    'text/plain',
    'application/octet-stream',
  ]),
  '.csv': new Set([
    'text/csv',
    'application/csv',
    'text/plain',
    'application/octet-stream',
  ]),
  '.jpg': new Set(['image/jpeg']),
  '.jpeg': new Set(['image/jpeg']),
  '.png': new Set(['image/png']),
  '.webp': new Set(['image/webp']),
};

const CATEGORY_EXTENSIONS: Record<
  StoryUploadFileCategory,
  ReadonlySet<string>
> = {
  manuscript: new Set(['.md', '.txt', '.docx', '.pdf', '.json']),
  metadata: new Set(['.json', '.csv']),
  visual: new Set(['.jpg', '.jpeg', '.png', '.webp']),
};

type ReceiptRow = {
  id: string;
  status: string;
  submissionType: string;
  totalBytes: bigint;
  createdAt: Date;
  _count: { files: number };
  generationProfiles?: Array<{
    status: string;
    profileVersion: number;
    reviewRevision: number;
  }>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertStoryUploadTotalBytes(
  files: readonly Pick<StoryUploadFile, 'size'>[],
) {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > STORY_UPLOAD_TOTAL_MAX_BYTES) {
    throw new PayloadTooLargeException({
      code: 'STORY_UPLOAD_TOTAL_SIZE_EXCEEDED',
      messageKey: 'storyUpload.intake.totalSizeExceeded',
      maxBytes: STORY_UPLOAD_TOTAL_MAX_BYTES,
    });
  }
  return totalBytes;
}

@Injectable()
export class StoryUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StoryUploadStorageService,
  ) {}

  async intake(
    userId: string,
    input: StoryUploadIntakeDto,
    fileFields: StoryUploadFileFields,
    idempotencyKey?: string,
  ) {
    this.assertRightsReference(input);
    const files = this.prepareFiles(fileFields);
    const totalBytes = assertStoryUploadTotalBytes(
      files.map((file) => ({ size: file.fileSizeBytes })),
    );
    const fingerprint = this.requestFingerprint(input, files);
    const requestKeyHash = this.requestKeyHash(
      userId,
      fingerprint,
      idempotencyKey,
    );

    const existing = await this.findReceipt(userId, requestKeyHash);
    if (existing) {
      this.assertReplayFingerprint(existing.requestFingerprint, fingerprint);
      return this.receipt(existing, true);
    }

    const storageProvider = this.storage.provider();
    const userRef = this.sha256(userId).slice(0, 16);
    const storedFiles: StoryUploadStoredFile[] = [];

    for (const file of files) {
      const storageKey = [
        'private',
        'story-upload',
        userRef,
        fingerprint,
        file.category,
        `${String(file.position).padStart(2, '0')}${file.extension}`,
      ].join('/');
      await this.storage.putObject({
        storageKey,
        mimeType: file.mimeType,
        buffer: file.buffer,
      });
      storedFiles.push({ ...file, storageProvider, storageKey });
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const submission = await tx.storyUploadSubmission.create({
          data: {
            userId,
            requestKeyHash,
            requestFingerprint: fingerprint,
            submissionType: 'final',
            title: input.title.trim(),
            originalLocale: input.originalLocale,
            sourceClass: input.sourceClass,
            rightsReference: input.rightsReference?.trim() || null,
            status: 'received',
            totalBytes: BigInt(totalBytes),
            files: {
              create: storedFiles.map(({ buffer: _buffer, ...file }) => ({
                category: file.category,
                position: file.position,
                extension: file.extension,
                clientFileNameHash: file.clientFileNameHash,
                mimeType: file.mimeType,
                fileSizeBytes: BigInt(file.fileSizeBytes),
                checksumSha256: file.checksumSha256,
                storageProvider: file.storageProvider,
                storageKey: file.storageKey,
              })),
            },
            generationProfiles: {
              create: {
                ownerUserId: userId,
                sourceFingerprint: fingerprint,
                status: 'pending_analysis',
              },
            },
          },
          include: {
            _count: { select: { files: true } },
            generationProfiles: {
              orderBy: { profileVersion: 'desc' },
              take: 1,
              select: { status: true, profileVersion: true, reviewRevision: true },
            },
          },
        });

        await tx.auditEvent.create({
          data: {
            actorUserId: userId,
            actorType: 'user',
            action: 'story_upload_intake_received',
            targetType: 'story_upload_submission',
            targetId: submission.id,
            afterData: {
              status: submission.status,
              submissionType: submission.submissionType,
            },
            metadata: {
              fileCount: storedFiles.length,
              totalBytes,
              storageProvider,
            },
          },
        });

        return submission;
      });

      return this.receipt(created, false);
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const replay = await this.findReceipt(userId, requestKeyHash);
      if (!replay) throw error;
      this.assertReplayFingerprint(replay.requestFingerprint, fingerprint);
      return this.receipt(replay, true);
    }
  }

  async getGenerationProfile(userId: string, submissionId: string) {
    this.assertUuid(submissionId, 'submissionId');
    const submission = await this.prisma.storyUploadSubmission.findFirst({
      where: { id: submissionId, userId },
      include: {
        generationProfiles: {
          orderBy: { profileVersion: 'desc' },
          take: 1,
        },
      },
    });
    const profile = submission?.generationProfiles[0];
    if (!submission || !profile) throw new NotFoundException('Story upload generation profile not found');
    return {
      submissionId: submission.id,
      title: submission.title,
      profile: creatorGenerationProfileProjection(profile),
    };
  }

  async updateGenerationProfile(
    userId: string,
    submissionId: string,
    input: UpdateStoryGenerationProfileDto,
  ) {
    this.assertUuid(submissionId, 'submissionId');
    const settings = normalizeCreatorGenerationProfile('story', input.settings);
    return this.prisma.$transaction(async (tx) => {
      const submission = await tx.storyUploadSubmission.findFirst({
        where: { id: submissionId, userId },
        include: {
          generationProfiles: {
            orderBy: { profileVersion: 'desc' },
            take: 1,
          },
        },
      });
      if (!submission) throw new NotFoundException('Story upload generation profile not found');
      const current = submission.generationProfiles[0];
      const sourceFingerprint = current?.sourceFingerprint ?? submission.requestFingerprint;
      const draftFingerprint = creatorGenerationProfileFingerprint(sourceFingerprint, settings);
      const data = {
        ownerUserId: userId,
        sourceFingerprint,
        status: 'needs_review',
        draftSettings: settings as unknown as Prisma.InputJsonValue,
        draftFingerprint,
        approvedSettings: Prisma.DbNull,
        approvedFingerprint: null,
        approvedByUserId: null,
        approvedAt: null,
        analysisErrorCode: null,
        updatedAt: new Date(),
      };
      const profile = !current || current.status === 'approved'
        ? await tx.storyUploadGenerationProfile.create({
            data: {
              submissionId: submission.id,
              profileVersion: (current?.profileVersion ?? 0) + 1,
              ...data,
            },
          })
        : await tx.storyUploadGenerationProfile.update({
            where: { id: current.id },
            data,
          });
      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          actorType: 'creator',
          action: 'story_generation_profile.draft_saved',
          targetType: 'story_upload_generation_profile',
          targetId: profile.id,
          beforeData: current ? {
            status: current.status,
            profileVersion: current.profileVersion,
            draftFingerprint: current.draftFingerprint,
          } : Prisma.JsonNull,
          afterData: {
            status: profile.status,
            profileVersion: profile.profileVersion,
            draftFingerprint: profile.draftFingerprint,
          },
          metadata: { submissionId: submission.id, sourceFingerprint },
        },
      });
      return { submissionId: submission.id, profile: creatorGenerationProfileProjection(profile) };
    });
  }

  async approveGenerationProfile(
    userId: string,
    submissionId: string,
    input: ApproveCreatorGenerationProfileDto,
  ) {
    this.assertUuid(submissionId, 'submissionId');
    return this.prisma.$transaction(async (tx) => {
      const submission = await tx.storyUploadSubmission.findFirst({
        where: { id: submissionId, userId },
        include: {
          generationProfiles: {
            orderBy: { profileVersion: 'desc' },
            take: 1,
          },
        },
      });
      const current = submission?.generationProfiles[0];
      if (!submission || !current) throw new NotFoundException('Story upload generation profile not found');
      if (current.status !== 'needs_review' || current.draftFingerprint !== input.expectedDraftFingerprint) {
        throw new ConflictException({
          code: 'GENERATION_PROFILE_DRAFT_CHANGED',
          message: 'Review the latest generation profile before approval',
        });
      }
      const settings = normalizeCreatorGenerationProfile('story', current.draftSettings);
      assertCreatorGenerationProfileApprovable(settings);
      const updated = await tx.storyUploadGenerationProfile.updateMany({
        where: {
          id: current.id,
          status: 'needs_review',
          draftFingerprint: input.expectedDraftFingerprint,
          sourceFingerprint: submission.requestFingerprint,
        },
        data: {
          status: 'approved',
          approvedSettings: settings as unknown as Prisma.InputJsonValue,
          approvedFingerprint: current.draftFingerprint,
          approvedByUserId: userId,
          approvedAt: new Date(),
          reviewRevision: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({
          code: 'GENERATION_PROFILE_DRAFT_CHANGED',
          message: 'Review the latest generation profile before approval',
        });
      }
      const profile = await tx.storyUploadGenerationProfile.findUniqueOrThrow({ where: { id: current.id } });
      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          actorType: 'creator',
          action: 'story_generation_profile.approved',
          targetType: 'story_upload_generation_profile',
          targetId: profile.id,
          beforeData: { status: current.status, reviewRevision: current.reviewRevision },
          afterData: {
            status: profile.status,
            profileVersion: profile.profileVersion,
            reviewRevision: profile.reviewRevision,
            approvedFingerprint: profile.approvedFingerprint,
          },
          metadata: { submissionId: submission.id, sourceFingerprint: submission.requestFingerprint },
        },
      });
      return { submissionId: submission.id, profile: creatorGenerationProfileProjection(profile) };
    });
  }

  private prepareFiles(fileFields: StoryUploadFileFields) {
    const groups: Array<{
      category: StoryUploadFileCategory;
      files: StoryUploadFile[];
    }> = [
      { category: 'manuscript', files: fileFields.manuscripts ?? [] },
      { category: 'metadata', files: fileFields.metadata ?? [] },
      { category: 'visual', files: fileFields.visuals ?? [] },
    ];
    if (!groups[0].files.length) {
      throw this.badRequest(
        'STORY_UPLOAD_MANUSCRIPT_REQUIRED',
        'storyUpload.intake.manuscriptRequired',
      );
    }

    return groups.flatMap(({ category, files }) =>
      files.map((file, position) => this.prepareFile(category, position, file)),
    );
  }

  private prepareFile(
    category: StoryUploadFileCategory,
    position: number,
    file: StoryUploadFile,
  ) {
    const extension = extname(file.originalname).toLowerCase();
    if (!CATEGORY_EXTENSIONS[category].has(extension)) {
      throw this.badRequest(
        'STORY_UPLOAD_FILE_EXTENSION_NOT_ALLOWED',
        'storyUpload.intake.extensionNotAllowed',
      );
    }
    if (!ALLOWED_MIME_TYPES[extension]?.has(file.mimetype.toLowerCase())) {
      throw this.badRequest(
        'STORY_UPLOAD_FILE_TYPE_MISMATCH',
        'storyUpload.intake.fileTypeMismatch',
      );
    }
    if (file.size < 1 || file.size !== file.buffer.length) {
      throw this.badRequest(
        'STORY_UPLOAD_FILE_SIZE_INVALID',
        'storyUpload.intake.fileSizeInvalid',
      );
    }
    if (file.size > CATEGORY_MAX_BYTES[category]) {
      throw new PayloadTooLargeException({
        code: 'STORY_UPLOAD_FILE_SIZE_EXCEEDED',
        messageKey: 'storyUpload.intake.fileSizeExceeded',
        category,
        maxBytes: CATEGORY_MAX_BYTES[category],
      });
    }
    this.assertFileSignature(extension, file.buffer);

    return {
      category,
      position,
      extension,
      clientFileNameHash: this.sha256(file.originalname.normalize('NFKC')),
      mimeType: file.mimetype.toLowerCase(),
      fileSizeBytes: file.size,
      checksumSha256: this.sha256(file.buffer),
      buffer: file.buffer,
    };
  }

  private assertFileSignature(extension: string, buffer: Buffer) {
    let valid = true;
    if (extension === '.pdf') {
      valid = buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    } else if (extension === '.docx') {
      valid = buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    } else if (extension === '.png') {
      valid = buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    } else if (extension === '.jpg' || extension === '.jpeg') {
      valid = buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    } else if (extension === '.webp') {
      valid =
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    } else if (extension === '.json') {
      try {
        JSON.parse(buffer.toString('utf8'));
      } catch {
        valid = false;
      }
    } else {
      valid = !buffer.includes(0);
    }

    if (!valid) {
      throw this.badRequest(
        'STORY_UPLOAD_FILE_SIGNATURE_INVALID',
        'storyUpload.intake.fileSignatureInvalid',
      );
    }
  }

  private requestFingerprint(
    input: StoryUploadIntakeDto,
    files: Array<{
      category: StoryUploadFileCategory;
      position: number;
      extension: string;
      checksumSha256: string;
      fileSizeBytes: number;
    }>,
  ) {
    return this.sha256(
      JSON.stringify({
        submissionType: 'final',
        title: input.title.trim(),
        originalLocale: input.originalLocale,
        sourceClass: input.sourceClass,
        rightsReference: input.rightsReference?.trim() || null,
        files: files.map((file) => ({
          category: file.category,
          position: file.position,
          extension: file.extension,
          checksumSha256: file.checksumSha256,
          fileSizeBytes: file.fileSizeBytes,
        })),
      }),
    );
  }

  private requestKeyHash(
    userId: string,
    fingerprint: string,
    idempotencyKey?: string,
  ) {
    const key = idempotencyKey?.trim();
    if (key && (key.length < 8 || key.length > 200)) {
      throw this.badRequest(
        'STORY_UPLOAD_IDEMPOTENCY_KEY_INVALID',
        'storyUpload.intake.idempotencyKeyInvalid',
      );
    }
    return this.sha256(`${userId}:${key || fingerprint}`);
  }

  private assertRightsReference(input: StoryUploadIntakeDto) {
    if (input.sourceClass === 'licensed_ip' && !input.rightsReference?.trim()) {
      throw this.badRequest(
        'STORY_UPLOAD_RIGHTS_REFERENCE_REQUIRED',
        'storyUpload.intake.rightsReferenceRequired',
      );
    }
  }

  private async findReceipt(userId: string, requestKeyHash: string) {
    return this.prisma.storyUploadSubmission.findUnique({
      where: { userId_requestKeyHash: { userId, requestKeyHash } },
      include: {
        _count: { select: { files: true } },
        generationProfiles: {
          orderBy: { profileVersion: 'desc' },
          take: 1,
          select: { status: true, profileVersion: true, reviewRevision: true },
        },
      },
    });
  }

  private assertReplayFingerprint(existing: string, incoming: string) {
    if (existing !== incoming) {
      throw new ConflictException({
        code: 'STORY_UPLOAD_IDEMPOTENCY_CONFLICT',
        messageKey: 'storyUpload.intake.idempotencyConflict',
      });
    }
  }

  private receipt(row: ReceiptRow, replayed: boolean) {
    const profile = row.generationProfiles?.[0];
    return {
      submissionId: row.id,
      status: row.status,
      submissionType: row.submissionType,
      fileCount: row._count.files,
      totalBytes: Number(row.totalBytes),
      replayed,
      receivedAt: row.createdAt.toISOString(),
      generationProfile: {
        status: profile?.status ?? 'pending_analysis',
        profileVersion: profile?.profileVersion ?? 1,
        reviewRevision: profile?.reviewRevision ?? 0,
        reviewRequired: true,
      },
    };
  }

  private assertUuid(value: string, field: string) {
    if (!UUID_PATTERN.test(value)) {
      throw this.badRequest('STORY_UPLOAD_ID_INVALID', `storyUpload.${field}.invalid`);
    }
  }

  private isUniqueViolation(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private sha256(value: string | Buffer) {
    return createHash('sha256').update(value).digest('hex');
  }

  private badRequest(code: string, messageKey: string) {
    return new BadRequestException({ code, messageKey });
  }
}

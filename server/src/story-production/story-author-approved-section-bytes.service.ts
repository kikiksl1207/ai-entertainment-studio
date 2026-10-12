import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { StoryAuthorApprovedSectionBytesQueryDto } from './dto/story-author-approved-section-bytes.dto';
import { readCurrentApprovedStoryStyleSnapshot } from './story-author-approved-style.snapshot';
import { profileObservationSource } from './story-continuation-context.policy';
import {
  buildStoryApprovedProfileDelivery, StoryApprovedProfileDeliveryError,
  STORY_APPROVED_PROFILE_DELIVERY_LIMITS,
} from './story-approved-profile-delivery.policy';
import {
  measureStoryApprovedProfileSectionByteMetric, StoryApprovedProfileSectionByteMetricError,
} from './story-approved-profile-section-byte-metric.policy';

@Injectable()
export class StoryAuthorApprovedSectionBytesService {
  constructor(private readonly prisma: PrismaService) {}

  async inspect(userId: string, workId: string, query: StoryAuthorApprovedSectionBytesQueryDto) {
    if (!isUUID(userId) || !isUUID(workId) || query?.measurement !== 'json-utf8-v1'
      || Object.keys(query).length !== 1) {
      throw new BadRequestException({ code: 'STORY_AUTHOR_APPROVED_SECTION_BYTES_INPUT_INVALID' });
    }
    userId = userId.toLowerCase();
    workId = workId.toLowerCase();
    try {
      const snapshot = await this.prisma.$transaction(async db => {
        await db.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
        const work = await db.storyWork.findFirst({
          where: { id: workId, ownerUserId: userId, fixtureSource: false },
          select: { id: true, ownerUserId: true, fixtureSource: true },
        });
        if (!work || work.id !== workId || work.ownerUserId !== userId || work.fixtureSource !== false) {
          throw new NotFoundException({ code: 'STORY_AUTHOR_APPROVED_SECTION_BYTES_NOT_FOUND' });
        }
        const approval = await readCurrentApprovedStoryStyleSnapshot(db, userId, workId);
        const pin = approval.approvalPin;
        const row = await db.storyWorkGenerationProfile.findUnique({
          where: { id: pin.id },
          select: { id: true, workId: true, ownerUserId: true, status: true, profileVersion: true,
            reviewRevision: true, sourceFingerprint: true, approvedSettings: true, approvedFingerprint: true },
        });
        if (!row || row.id !== pin.id || row.workId !== workId || row.ownerUserId !== userId
          || row.status !== 'approved' || row.profileVersion !== pin.profileVersion
          || row.reviewRevision !== pin.reviewRevision || row.sourceFingerprint !== pin.sourceFingerprint
          || row.approvedFingerprint !== pin.approvedFingerprint) {
          throw new ConflictException({ code: 'STORY_AUTHOR_APPROVED_SECTION_BYTES_SOURCE_UNAVAILABLE' });
        }
        return { row, pin, metadata: {
          locale: approval.projection.locale,
          manuscriptVersion: approval.projection.manuscriptVersion,
          analysisVersion: approval.projection.analysisVersion,
          profileVersion: approval.projection.profileVersion,
          reviewRevision: approval.projection.reviewRevision,
        } };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

      // Factory and numeric CPU work follow the completed snapshot; no DB read follows them.
      // The metric budget does not retroactively bound DB JSON materialization or this factory.
      const packet = buildStoryApprovedProfileDelivery(snapshot.row, snapshot.pin, profileObservationSource);
      const diagnostic = measureStoryApprovedProfileSectionByteMetric(packet, snapshot.row, profileObservationSource);
      return Object.freeze({
        contract: 'story-author-approved-section-bytes-v1' as const,
        sourceScope: 'latest_owner_approved_profile_section_bytes_only' as const,
        ...snapshot.metadata,
        readOnly: true as const,
        providerCalls: 0 as const,
        operatingWrites: 0 as const,
        dispatchAuthorized: false as const,
        semanticQualityVerified: false as const,
        legalAuthorization: 'not_evaluated' as const,
        paidApproval: 'not_evaluated' as const,
        fixedInputTokenLimit: STORY_APPROVED_PROFILE_DELIVERY_LIMITS.inputTokens,
        fixedOutputTokenLimit: STORY_APPROVED_PROFILE_DELIVERY_LIMITS.outputTokens,
        diagnostic,
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new NotFoundException({ code: 'STORY_AUTHOR_APPROVED_SECTION_BYTES_NOT_FOUND' });
      }
      if (error instanceof ConflictException) {
        throw new ConflictException({ code: 'STORY_AUTHOR_APPROVED_SECTION_BYTES_SOURCE_UNAVAILABLE' });
      }
      if (error instanceof StoryApprovedProfileDeliveryError) {
        throw new ServiceUnavailableException({ code: 'STORY_AUTHOR_APPROVED_SECTION_BYTES_UNAVAILABLE', reason: 'approval_unavailable' });
      }
      if (error instanceof StoryApprovedProfileSectionByteMetricError) {
        const reason = error.code === 'work_limit_exceeded' ? 'work_limit_exceeded'
          : error.code === 'approval_invalid' ? 'approval_unavailable' : 'measurement_unavailable';
        throw new ServiceUnavailableException({ code: 'STORY_AUTHOR_APPROVED_SECTION_BYTES_UNAVAILABLE', reason });
      }
      throw new ServiceUnavailableException({ code: 'STORY_AUTHOR_APPROVED_SECTION_BYTES_UNAVAILABLE', reason: 'source_unavailable' });
    }
  }
}

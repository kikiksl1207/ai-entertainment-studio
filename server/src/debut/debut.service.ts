import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminUpdateDebutApplicationDto,
  CreateDebutApplicationDto,
  DebutApplicationListQueryDto,
} from './dto/debut.dto';

const APPLICATION_STATUSES = new Set([
  'submitted',
  'reviewing',
  'under_review',
  'needs_more_info',
  'approved',
  'rejected',
  'withdrawn',
]);

@Injectable()
export class DebutService {
  constructor(private readonly prisma: PrismaService) {}

  async createApplication(userId: string, input: CreateDebutApplicationDto) {
    if (!input.isAdult) {
      throw new BadRequestException('isAdult must be true for MVP debut applications');
    }

    this.assertRequiredConsents(input);

    const application = await this.prisma.debutApplication.create({
      data: {
        userId,
        applicantName: input.applicantName,
        displayName: input.displayName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        isAdult: input.isAdult,
        participationType: input.participationType,
        shareTierRequested: input.shareTierRequested,
        intro: input.intro,
        portfolioUrl: input.portfolioUrl,
        consentAppearance: true,
        consentVoice: input.consentVoice,
        consentRevenuePolicy: true,
        consentPrivacy: true,
        metadata: this.toJson(input.metadata ?? {}),
      },
      include: this.applicationInclude(),
    });

    return {
      application,
      message: 'Debut application submitted',
    };
  }

  getMyApplications(userId: string) {
    return this.prisma.debutApplication.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMyLatestApplication(userId: string) {
    const application = await this.prisma.debutApplication.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return {
      application,
      ctaState: application ? 'status' : 'apply',
    };
  }

  async withdrawMyApplication(userId: string, applicationId: string) {
    const application = await this.prisma.debutApplication.findFirst({
      where: { id: applicationId, userId },
    });

    if (!application) {
      throw new NotFoundException('Debut application not found');
    }

    if (application.status === 'withdrawn') {
      return { application, ok: true, alreadyWithdrawn: true };
    }

    if (!['submitted', 'reviewing', 'needs_more_info'].includes(application.status)) {
      throw new BadRequestException(
        'Only submitted, reviewing, or needs_more_info applications can be withdrawn',
      );
    }

    const withdrawn = await this.prisma.debutApplication.update({
      where: { id: application.id },
      data: {
        status: 'withdrawn',
        updatedAt: new Date(),
        metadata: this.mergeMetadata(application.metadata, {
          withdrawnBy: 'applicant',
          withdrawnAt: new Date().toISOString(),
        }),
      },
    });

    await this.recordAudit(
      { id: userId, email: null },
      withdrawn.id,
      application,
      withdrawn,
      'user',
      'debut_application.withdraw',
    );

    return { application: withdrawn, ok: true, alreadyWithdrawn: false };
  }

  getApplications(query: DebutApplicationListQueryDto) {
    const take = query.take ?? 50;
    const status = query.status ? this.status(query.status) : undefined;

    return this.prisma.debutApplication.findMany({
      where: this.clean({ status }),
      take,
      include: this.applicationInclude(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateApplication(
    user: AuthUser,
    applicationId: string,
    input: AdminUpdateDebutApplicationDto,
  ) {
    const before = await this.prisma.debutApplication.findUnique({
      where: { id: applicationId },
      include: this.applicationInclude(),
    });

    if (!before) {
      throw new NotFoundException('Debut application not found');
    }

    if (
      input.status === undefined &&
      input.shareTierApproved === undefined &&
      input.reviewNote === undefined
    ) {
      throw new BadRequestException(
        'At least one of status, shareTierApproved, or reviewNote is required',
      );
    }

    const application = await this.prisma.debutApplication.update({
      where: { id: applicationId },
      data: this.clean({
        status: input.status === undefined ? undefined : this.status(input.status),
        shareTierApproved: input.shareTierApproved,
        reviewNote: input.reviewNote,
        updatedAt: new Date(),
      }),
      include: this.applicationInclude(),
    });

    await this.recordAudit(user, application.id, before, application);
    return application;
  }

  private assertRequiredConsents(input: CreateDebutApplicationDto) {
    const required = ['consentAppearance', 'consentRevenuePolicy', 'consentPrivacy'];
    for (const key of required) {
      if (input[key as keyof CreateDebutApplicationDto] !== true) {
        throw new BadRequestException(`${key} must be true`);
      }
    }
  }

  private applicationInclude() {
    return {
      user: {
        select: {
          id: true,
          email: true,
          status: true,
          profile: {
            select: { displayName: true },
          },
        },
      },
    } satisfies Prisma.DebutApplicationInclude;
  }

  private status(value: string) {
    const normalized = value.trim() === 'under_review' ? 'reviewing' : value.trim();
    if (!APPLICATION_STATUSES.has(normalized)) {
      throw new BadRequestException(
        'status must be submitted, reviewing, needs_more_info, approved, rejected, or withdrawn',
      );
    }

    return normalized;
  }

  private clean<T extends Record<string, unknown>>(input: T) {
    return Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ) as T;
  }

  private recordAudit(
    user: AuthUser,
    targetId: string,
    beforeData: unknown,
    afterData: unknown,
    actorType = 'admin',
    action = 'debut_application.update',
  ) {
    return this.prisma.auditEvent.create({
      data: {
        actorUserId: user.id,
        actorType,
        action,
        targetType: 'debut_application',
        targetId,
        beforeData: this.toJson(beforeData),
        afterData: this.toJson(afterData),
        metadata: Prisma.JsonNull,
      },
    });
  }

  private toJson(value: unknown) {
    if (value === null || value === undefined) {
      return Prisma.JsonNull;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private mergeMetadata(current: Prisma.JsonValue, patch: Record<string, unknown>) {
    const base =
      current && typeof current === 'object' && !Array.isArray(current)
        ? (current as Record<string, unknown>)
        : {};

    return this.toJson({
      ...base,
      ...patch,
    });
  }
}

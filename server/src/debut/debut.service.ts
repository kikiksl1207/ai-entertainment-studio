import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

type DebutPayload = Record<string, unknown>;
type DebutQuery = Record<string, string | undefined>;

const APPLICATION_STATUSES = new Set([
  'submitted',
  'reviewing',
  'needs_more_info',
  'approved',
  'rejected',
  'withdrawn',
]);

const PARTICIPATION_TYPES = new Set([
  'appearance_only',
  'voice_or_song',
  'performance',
  'co_creator',
]);

@Injectable()
export class DebutService {
  constructor(private readonly prisma: PrismaService) {}

  async createApplication(userId: string, input: DebutPayload) {
    this.assertRequiredConsents(input);
    const shareTierRequested = this.optionalShareTier(input, 'shareTierRequested');

    const application = await this.prisma.debutApplication.create({
      data: {
        userId,
        applicantName: this.string(input, 'applicantName'),
        displayName: this.optionalString(input, 'displayName'),
        contactEmail: this.email(input, 'contactEmail'),
        contactPhone: this.optionalString(input, 'contactPhone'),
        isAdult: this.boolean(input, 'isAdult'),
        participationType: this.participationType(input, 'participationType'),
        shareTierRequested,
        intro: this.string(input, 'intro'),
        portfolioUrl: this.optionalString(input, 'portfolioUrl'),
        consentAppearance: true,
        consentVoice: this.boolean(input, 'consentVoice'),
        consentRevenuePolicy: true,
        consentPrivacy: true,
        metadata: this.toJson(this.object(input, 'metadata') ?? {}),
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

  getApplications(query: DebutQuery) {
    const take = Math.max(1, Math.min(this.optionalNumber(query.take) ?? 50, 100));
    const status = query.status ? this.status(query.status) : undefined;

    return this.prisma.debutApplication.findMany({
      where: this.clean({ status }),
      take,
      include: this.applicationInclude(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateApplication(user: AuthUser, applicationId: string, input: DebutPayload) {
    const before = await this.prisma.debutApplication.findUnique({
      where: { id: applicationId },
      include: this.applicationInclude(),
    });

    if (!before) {
      throw new NotFoundException('Debut application not found');
    }

    const application = await this.prisma.debutApplication.update({
      where: { id: applicationId },
      data: this.clean({
        status: input.status === undefined ? undefined : this.status(String(input.status)),
        shareTierApproved: this.optionalShareTier(input, 'shareTierApproved'),
        reviewNote: this.optionalString(input, 'reviewNote'),
        updatedAt: new Date(),
      }),
      include: this.applicationInclude(),
    });

    await this.recordAudit(user, application.id, before, application);
    return application;
  }

  private assertRequiredConsents(input: DebutPayload) {
    const required = ['consentAppearance', 'consentRevenuePolicy', 'consentPrivacy'];
    for (const key of required) {
      if (input[key] !== true) {
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
    const normalized = value.trim();
    if (!APPLICATION_STATUSES.has(normalized)) {
      throw new BadRequestException(
        'status must be submitted, reviewing, needs_more_info, approved, rejected, or withdrawn',
      );
    }

    return normalized;
  }

  private participationType(input: DebutPayload, key: string) {
    const value = this.string(input, key);
    if (!PARTICIPATION_TYPES.has(value)) {
      throw new BadRequestException(
        'participationType must be appearance_only, voice_or_song, performance, or co_creator',
      );
    }

    return value;
  }

  private optionalShareTier(input: DebutPayload, key: string) {
    if (input[key] === undefined || input[key] === null || input[key] === '') {
      return undefined;
    }

    const value = this.number(input, key);
    if (!Number.isInteger(value) || value < 0 || value > 70) {
      throw new BadRequestException(`${key} must be an integer between 0 and 70`);
    }

    return value;
  }

  private string(input: DebutPayload, key: string) {
    const value = input[key];
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${key} must be a non-empty string`);
    }

    return value.trim();
  }

  private optionalString(input: DebutPayload, key: string) {
    const value = input[key];
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException(`${key} must be a string`);
    }

    return value.trim() || undefined;
  }

  private email(input: DebutPayload, key: string) {
    const value = this.string(input, key).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw new BadRequestException(`${key} must be a valid email`);
    }

    return value;
  }

  private boolean(input: DebutPayload, key: string) {
    const value = input[key];
    if (typeof value !== 'boolean') {
      throw new BadRequestException(`${key} must be a boolean`);
    }

    return value;
  }

  private number(input: DebutPayload, key: string) {
    const parsed = Number(input[key]);
    if (!Number.isFinite(parsed)) {
      throw new BadRequestException(`${key} must be a number`);
    }

    return parsed;
  }

  private optionalNumber(value: string | undefined) {
    if (!value) {
      return undefined;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      throw new BadRequestException('take must be an integer');
    }

    return parsed;
  }

  private object(input: DebutPayload, key: string) {
    const value = input[key];
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
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
  ) {
    return this.prisma.auditEvent.create({
      data: {
        actorUserId: user.id,
        actorType: 'admin',
        action: 'debut_application.update',
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
}

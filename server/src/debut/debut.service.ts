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

const DEFAULT_APPLICATION_TYPE = 'personal_unaffiliated';

@Injectable()
export class DebutService {
  constructor(private readonly prisma: PrismaService) {}

  getPolicy() {
    return {
      product: 'ai_debut',
      policyVersion: '2026-05-03.applicant-types',
      minApplicantAgePolicy: {
        adultOnly: true,
        isAdultRequired: true,
        minorApplicationStatus: 'not_open',
      },
      applicantTypes: [
        {
          value: 'personal_unaffiliated',
          label: 'Personal / unaffiliated applicant',
          description:
            'Default low-friction path for individuals who are not under an agency or exclusive contract.',
          rightsReviewRequired: false,
          partnerReviewRequired: false,
          recommended: true,
        },
        {
          value: 'represented_artist',
          label: 'Represented artist / trainee / entertainment contact',
          description:
            'Use this when an applicant may have an agency, management, trainee, or other rights relationship. Operators must review rights before moving forward.',
          rightsReviewRequired: true,
          partnerReviewRequired: false,
        },
        {
          value: 'ai_creator_partner',
          label: 'AI creator partner',
          description:
            'Use this for image, video, SD, ComfyUI, Flux, LoRA, or shortform creators who want to support production as partners.',
          rightsReviewRequired: false,
          partnerReviewRequired: true,
        },
        {
          value: 'partnership_other',
          label: 'Other partnership inquiry',
          description:
            'Use this for inquiries that do not fit the main debut or AI creator partner paths.',
          rightsReviewRequired: false,
          partnerReviewRequired: true,
        },
      ],
      applicationChannels: [
        {
          value: 'phone_consultation',
          label: 'Phone consultation',
          description:
            'Low-friction MVP application. Collect basic contact, story, and preferred call time; the operator confirms details by phone.',
          uploadEnabled: false,
          recommended: true,
        },
        {
          value: 'online_review',
          label: 'Online review',
          description:
            'Future review mode for applicants who want to submit images or portfolio materials online.',
          uploadEnabled: false,
          status: 'planned',
        },
      ],
      participationTypes: [
        {
          value: 'appearance_only',
          label: 'Appearance only',
          labelKo: '외모/이미지 제공',
          description:
            'Applicant provides appearance, reference images, or visual identity direction.',
          draftShareRange: { min: 20, max: 30 },
        },
        {
          value: 'voice_or_song',
          label: 'Voice or song',
          labelKo: '외모 + 목소리/노래',
          description:
            'Applicant provides appearance plus voice sample, vocal recording, or song material.',
          draftShareRange: { min: 30, max: 45 },
        },
        {
          value: 'performance',
          label: 'Performance',
          labelKo: '외모 + 퍼포먼스',
          description:
            'Applicant provides singing, dance, acting, choreography, or performance material.',
          draftShareRange: { min: 45, max: 60 },
        },
        {
          value: 'co_creator',
          label: 'Co-creator',
          labelKo: '공동 창작/운영 참여',
          description:
            'Applicant contributes ongoing planning, concept writing, content ideas, or fan communication.',
          draftShareRange: { min: 0, max: 70 },
        },
      ],
      statuses: [
        { value: 'submitted', labelKo: '접수 완료', userVisible: true },
        { value: 'reviewing', labelKo: '검토 중', userVisible: true },
        { value: 'needs_more_info', labelKo: '추가 정보 필요', userVisible: true },
        { value: 'approved', labelKo: '승인', userVisible: true },
        { value: 'rejected', labelKo: '반려', userVisible: true },
        { value: 'withdrawn', labelKo: '철회', userVisible: true },
      ],
      consentKeys: [
        {
          key: 'consentAppearance',
          required: true,
          labelKo: '본인 자료 또는 사용 권한이 있는 자료만 제출합니다.',
        },
        {
          key: 'consentRevenuePolicy',
          required: true,
          labelKo: '수익배분은 심사와 계약 단계에서 최종 확정됨을 확인합니다.',
        },
        {
          key: 'consentPrivacy',
          required: true,
          labelKo: '신청 검토를 위한 개인정보 처리에 동의합니다.',
        },
        {
          key: 'consentVoice',
          required: false,
          labelKo: '목소리/노래/퍼포먼스 자료를 제출하는 경우 검토 사용에 동의합니다.',
        },
      ],
      fieldPolicy: {
        intro: { minLength: 20, maxLength: 4000 },
        applicantName: { minLength: 2, maxLength: 80 },
        displayName: { minLength: 2, maxLength: 80, required: false },
        preferredContactTime: { maxLength: 120, required: false },
        applicationType: {
          default: DEFAULT_APPLICATION_TYPE,
          values: [
            'personal_unaffiliated',
            'represented_artist',
            'ai_creator_partner',
            'partnership_other',
          ],
        },
        affiliatedOrgName: { maxLength: 120, required: false },
        rightsRelationshipNote: { maxLength: 1000, required: false },
        creatorExperienceNote: { maxLength: 1000, required: false },
        shareTierRequested: { min: 0, max: 70, required: false },
        metadata:
          'Use only non-sensitive structured details. Do not include IDs, bank accounts, contracts, secrets, or raw identity documents.',
      },
      materialSubmissionPolicy: {
        currentMvpMode: 'no_file_upload',
        phoneConsultation:
          'Do not ask for files. The operator confirms details by phone after application submission.',
        onlineReview:
          'Image or portfolio upload can be opened later through a separate secure upload flow.',
        allowedLater: ['self_photos', 'portfolio_images', 'voice_sample', 'song_demo'],
      },
      restrictedCollection: [
        'resident_registration_number',
        'id_card_image',
        'bank_account',
        'final_contract_file',
        'api_key_or_secret',
      ],
    };
  }

  async createApplication(userId: string, input: CreateDebutApplicationDto) {
    if (!input.isAdult) {
      throw new BadRequestException('isAdult must be true for MVP debut applications');
    }

    this.assertRequiredConsents(input);
    this.assertApplicationChannel(input);
    const metadata = this.applicationMetadata(input);

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
        metadata,
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
    const where = this.debutApplicationWhere({
      status,
      applicationChannel: query.applicationChannel,
      applicationType: query.applicationType,
      rightsReviewRequired: query.rightsReviewRequired,
      partnerReviewRequired: query.partnerReviewRequired,
      consultationStatus: query.consultationStatus,
      query: query.query,
    });

    return this.prisma.debutApplication
      .findMany({
      where,
      take: take + 1,
      ...(query.cursor
        ? {
            cursor: { id: query.cursor },
            skip: 1,
          }
        : {}),
      include: this.applicationInclude(),
      orderBy: { createdAt: 'desc' },
      })
      .then((rows) => this.paginated(rows, take));
  }

  async getApplication(applicationId: string) {
    const application = await this.prisma.debutApplication.findUnique({
      where: { id: applicationId },
      include: this.applicationInclude(),
    });

    if (!application) {
      throw new NotFoundException('Debut application not found');
    }

    return application;
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
      input.reviewNote === undefined &&
      input.consultationStatus === undefined &&
      input.consultationScheduledAt === undefined &&
      input.consultationNote === undefined &&
      input.rightsReviewStatus === undefined &&
      input.rightsReviewNote === undefined &&
      input.partnerReviewStatus === undefined &&
      input.partnerReviewNote === undefined
    ) {
      throw new BadRequestException(
        'At least one admin update field is required',
      );
    }

    const application = await this.prisma.debutApplication.update({
      where: { id: applicationId },
      data: this.clean({
        status: input.status === undefined ? undefined : this.status(input.status),
        shareTierApproved: input.shareTierApproved,
        reviewNote: input.reviewNote,
        updatedAt: new Date(),
        metadata: this.mergeAdminReviewMetadata(before.metadata, input, user),
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

  private assertApplicationChannel(input: CreateDebutApplicationDto) {
    const channel = input.applicationChannel ?? 'phone_consultation';
    if (channel === 'phone_consultation' && !input.contactPhone) {
      throw new BadRequestException('contactPhone is required for phone_consultation');
    }

    if (channel === 'phone_consultation' && input.consultationConsent !== true) {
      throw new BadRequestException('consultationConsent must be true for phone_consultation');
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

  private applicationMetadata(input: CreateDebutApplicationDto) {
    const applicationType = input.applicationType ?? DEFAULT_APPLICATION_TYPE;
    const rightsReviewRequired = applicationType === 'represented_artist';
    const partnerReviewRequired =
      applicationType === 'ai_creator_partner' || applicationType === 'partnership_other';

    return this.toJson({
      ...(input.metadata ?? {}),
      applicationChannel: input.applicationChannel ?? 'phone_consultation',
      applicationType,
      applicantSegment: applicationType,
      affiliatedOrgName: input.affiliatedOrgName ?? null,
      rightsRelationshipNote: input.rightsRelationshipNote ?? null,
      creatorExperienceNote: input.creatorExperienceNote ?? null,
      rightsReviewRequired,
      rightsReviewStatus: rightsReviewRequired ? 'pending' : 'not_required',
      partnerReviewRequired,
      partnerReviewStatus: partnerReviewRequired ? 'pending' : 'not_applicable',
      preferredContactTime: input.preferredContactTime ?? null,
      consultationConsent: input.consultationConsent ?? null,
      consultationStatus: 'pending',
      materialSubmissionMode: 'no_file_upload_mvp',
    });
  }

  private debutApplicationWhere(input: {
    status?: string;
    applicationChannel?: string;
    applicationType?: string;
    rightsReviewRequired?: boolean;
    partnerReviewRequired?: boolean;
    consultationStatus?: string;
    query?: string;
  }) {
    const filters: Prisma.DebutApplicationWhereInput[] = [];

    if (input.status) {
      filters.push({ status: input.status });
    }

    if (input.applicationChannel) {
      filters.push({
        metadata: {
          path: ['applicationChannel'],
          equals: input.applicationChannel,
        },
      });
    }

    if (input.applicationType) {
      filters.push({
        metadata: {
          path: ['applicationType'],
          equals: input.applicationType,
        },
      });
    }

    if (input.rightsReviewRequired !== undefined) {
      filters.push({
        metadata: {
          path: ['rightsReviewRequired'],
          equals: input.rightsReviewRequired,
        },
      });
    }

    if (input.partnerReviewRequired !== undefined) {
      filters.push({
        metadata: {
          path: ['partnerReviewRequired'],
          equals: input.partnerReviewRequired,
        },
      });
    }

    if (input.consultationStatus) {
      filters.push({
        metadata: {
          path: ['consultationStatus'],
          equals: input.consultationStatus,
        },
      });
    }

    if (input.query) {
      filters.push({
        OR: [
          { applicantName: { contains: input.query, mode: 'insensitive' } },
          { displayName: { contains: input.query, mode: 'insensitive' } },
          { contactEmail: { contains: input.query, mode: 'insensitive' } },
          { contactPhone: { contains: input.query, mode: 'insensitive' } },
          { intro: { contains: input.query, mode: 'insensitive' } },
          { user: { email: { contains: input.query, mode: 'insensitive' } } },
        ],
      });
    }

    return filters.length ? { AND: filters } : {};
  }

  private paginated<T extends { id: string }>(rows: T[], take: number) {
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const lastItem = items.at(-1);

    return {
      items,
      count: items.length,
      hasMore,
      nextCursor: hasMore && lastItem ? lastItem.id : null,
    };
  }

  private mergeAdminReviewMetadata(
    current: Prisma.JsonValue,
    input: AdminUpdateDebutApplicationDto,
    user: AuthUser,
  ) {
    if (
      input.consultationStatus === undefined &&
      input.consultationScheduledAt === undefined &&
      input.consultationNote === undefined &&
      input.rightsReviewStatus === undefined &&
      input.rightsReviewNote === undefined &&
      input.partnerReviewStatus === undefined &&
      input.partnerReviewNote === undefined
    ) {
      return undefined;
    }

    return this.mergeMetadata(current, {
      ...(input.consultationStatus === undefined
        ? {}
        : { consultationStatus: input.consultationStatus }),
      ...(input.consultationScheduledAt === undefined
        ? {}
        : { consultationScheduledAt: input.consultationScheduledAt }),
      ...(input.consultationNote === undefined
        ? {}
        : { consultationNote: input.consultationNote }),
      ...(input.rightsReviewStatus === undefined
        ? {}
        : { rightsReviewStatus: input.rightsReviewStatus }),
      ...(input.rightsReviewNote === undefined
        ? {}
        : { rightsReviewNote: input.rightsReviewNote }),
      ...(input.partnerReviewStatus === undefined
        ? {}
        : { partnerReviewStatus: input.partnerReviewStatus }),
      ...(input.partnerReviewNote === undefined
        ? {}
        : { partnerReviewNote: input.partnerReviewNote }),
      consultationUpdatedByUserId: user.id,
      consultationUpdatedAt: new Date().toISOString(),
      adminReviewUpdatedByUserId: user.id,
      adminReviewUpdatedAt: new Date().toISOString(),
    });
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

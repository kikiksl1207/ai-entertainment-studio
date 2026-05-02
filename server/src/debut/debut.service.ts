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

  getPolicy() {
    return {
      product: 'ai_debut',
      policyVersion: '2026-05-02.mvp-draft',
      minApplicantAgePolicy: {
        adultOnly: true,
        isAdultRequired: true,
        minorApplicationStatus: 'not_open',
      },
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
        shareTierRequested: { min: 0, max: 70, required: false },
        metadata:
          'Use only non-sensitive structured details. Do not include IDs, bank accounts, contracts, secrets, or raw identity documents.',
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

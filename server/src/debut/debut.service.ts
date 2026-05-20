import { createHash, createHmac, randomUUID } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminUpdateDebutApplicationDto,
  ConfirmDebutMaterialUploadDto,
  CreateDebutApplicationDto,
  CreateDebutMaterialUploadIntentDto,
  DebutApplicationListQueryDto,
  ResubmitDebutApplicationDto,
  DEBUT_OPERATION_SEGMENTS,
  DEBUT_MATERIAL_CATEGORIES,
} from './dto/debut.dto';

const APPLICATION_STATUSES = new Set([
  'submitted',
  'reviewing',
  'under_review',
  'needs_more_info',
  'approved_for_contact',
  'approved',
  'rejected',
  'archived',
  'withdrawn',
]);
const ADMIN_DEBUT_APPLICATION_STATUS_CANDIDATES = [
  'submitted',
  'reviewing',
  'needs_more_info',
  'approved_for_contact',
  'rejected',
  'archived',
] as const;
type AdminDebutApplicationStatus =
  (typeof ADMIN_DEBUT_APPLICATION_STATUS_CANDIDATES)[number];
const ADMIN_APPLICATION_STATUS_ALIASES: Record<string, AdminDebutApplicationStatus> = {
  under_review: 'reviewing',
  approved: 'approved_for_contact',
  withdrawn: 'archived',
};
const USER_DEBUT_APPLICATION_STATUS_CANDIDATES = [
  'submitted',
  'reviewing',
  'needs_more_info',
  'approved',
  'rejected',
  'canceled',
] as const;
type UserDebutApplicationStatus =
  (typeof USER_DEBUT_APPLICATION_STATUS_CANDIDATES)[number];
const USER_APPLICATION_STATUS_ALIASES: Record<string, UserDebutApplicationStatus> = {
  under_review: 'reviewing',
  approved_for_contact: 'approved',
  archived: 'canceled',
  withdrawn: 'canceled',
};
const USER_APPLICATION_CTA_BLOCKED_MUTATIONS = [
  'debut_finalization',
  'contract',
  'settlement',
  'payout',
  'wallet',
  'lumina',
  'notification_dispatch',
] as const;
const USER_APPLICATION_STATUS_COPY: Record<
  UserDebutApplicationStatus,
  { labelKo: string; messageKey: string; defaultMessageKo: string }
> = {
  submitted: {
    labelKo: '신청 접수 완료',
    messageKey: 'debut.application.status.submitted',
    defaultMessageKo: '데뷔 신청이 접수됐어요. 운영팀이 순서대로 확인합니다.',
  },
  reviewing: {
    labelKo: '심사 중',
    messageKey: 'debut.application.status.reviewing',
    defaultMessageKo: '제출 내용을 검토하고 있어요. 결과가 정리되면 알려드릴게요.',
  },
  needs_more_info: {
    labelKo: '보완 요청',
    messageKey: 'debut.application.status.needsMoreInfo',
    defaultMessageKo: '추가 확인이 필요한 항목이 있어요. 안내를 확인해 주세요.',
  },
  approved: {
    labelKo: '연락 준비 중',
    messageKey: 'debut.application.status.approved',
    defaultMessageKo: '상담 또는 다음 안내를 드릴 수 있는 상태예요. 데뷔 확정은 별도 계약 이후 결정됩니다.',
  },
  rejected: {
    labelKo: '심사 종료',
    messageKey: 'debut.application.status.rejected',
    defaultMessageKo: '이번 신청 검토가 종료됐어요. 공개 가능한 사유만 안내됩니다.',
  },
  canceled: {
    labelKo: '신청 취소',
    messageKey: 'debut.application.status.canceled',
    defaultMessageKo: '사용자 요청 또는 운영 기준에 따라 신청이 종료됐어요.',
  },
};
const USER_APPLICATION_STATUS_CTA: Record<
  UserDebutApplicationStatus,
  { key: string; labelKo: string; enabled: boolean }
> = {
  submitted: { key: 'view_status', labelKo: '상태 확인', enabled: false },
  reviewing: { key: 'view_status', labelKo: '상태 확인', enabled: false },
  needs_more_info: { key: 'resubmit', labelKo: '보완 제출', enabled: true },
  approved: { key: 'check_result', labelKo: '결과 안내 확인', enabled: false },
  rejected: { key: 'check_result', labelKo: '결과 안내 확인', enabled: false },
  canceled: { key: 'view_status', labelKo: '상태 확인', enabled: false },
};

const DEFAULT_APPLICATION_TYPE = 'personal_unaffiliated';
const DEFAULT_PARTICIPATION_TYPE = 'appearance_only';
const DEBUT_MATERIAL_SCOPE = 'debut_application_material';
const DEBUT_RESUBMISSION_ENDPOINT =
  '/api/v1/me/debut-applications/:applicationId/resubmit';
const DEBUT_OPERATION_SEGMENT_CONTRACT = [
  {
    value: 'individual',
    labelKo: '\uAC1C\uC778',
    applicationTypes: ['personal_unaffiliated'],
    adminFilter: { operationSegment: 'individual' },
  },
  {
    value: 'entertainment_agency',
    labelKo: '\uC5D4\uD130/\uC18C\uC18D\uC0AC',
    applicationTypes: ['represented_artist'],
    adminFilter: { operationSegment: 'entertainment_agency' },
    reviewFlags: { rightsReviewRequired: true },
  },
  {
    value: 'partner',
    labelKo: '\uD30C\uD2B8\uB108/\uC81C\uD734',
    applicationTypes: ['ai_creator_partner', 'partnership_other'],
    adminFilter: { operationSegment: 'partner' },
    reviewFlags: { partnerReviewRequired: true },
  },
] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MATERIAL_CATEGORY_MIME_PREFIXES: Record<
  (typeof DEBUT_MATERIAL_CATEGORIES)[number],
  string[]
> = {
  face_photo: ['image/'],
  body_motion_reference: ['image/', 'video/'],
  voice_sample: ['audio/'],
  dance_video_reference: ['video/'],
  portfolio_attachment: ['image/', 'video/', 'application/pdf'],
};
const MATERIAL_CATEGORY_ASSET_FIELD: Record<
  (typeof DEBUT_MATERIAL_CATEGORIES)[number],
  keyof Pick<
    CreateDebutApplicationDto,
    | 'facePhotoAssetIds'
    | 'bodyMotionReferenceAssetIds'
    | 'voiceSampleAssetIds'
    | 'danceVideoReferenceAssetIds'
    | 'portfolioAttachmentAssetIds'
  > | null
> = {
  face_photo: 'facePhotoAssetIds',
  body_motion_reference: 'bodyMotionReferenceAssetIds',
  voice_sample: 'voiceSampleAssetIds',
  dance_video_reference: 'danceVideoReferenceAssetIds',
  portfolio_attachment: 'portfolioAttachmentAssetIds',
};

type NormalizedCreateDebutApplicationInput = CreateDebutApplicationDto & {
  contactEmail: string;
  intro: string;
  participationType: NonNullable<CreateDebutApplicationDto['participationType']>;
  consentVoice: boolean;
  applicationType: NonNullable<CreateDebutApplicationDto['applicationType']>;
};

type DebutApplicationAdminAttachmentRecord = {
  id: string;
  category: string;
  sortOrder: number;
  status: string;
  metadata: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
  asset: {
    id: string;
    assetType: string;
    visibility: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    createdAt: Date;
    updatedAt: Date;
  };
};

type DebutApplicationAdminRecord = {
  id: string;
  userId: string;
  applicantName: string;
  displayName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  isAdult: boolean;
  participationType: string;
  shareTierRequested: number | null;
  shareTierApproved: number | null;
  intro: string;
  portfolioUrl: string | null;
  status: string;
  reviewNote: string | null;
  consentAppearance: boolean;
  consentVoice: boolean;
  consentRevenuePolicy: boolean;
  consentPrivacy: boolean;
  consentMarketing: boolean;
  metadata: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    email: string | null;
    status: string;
    profile: { displayName: string | null } | null;
  };
  attachments: DebutApplicationAdminAttachmentRecord[];
};

type DebutApplicationUserAttachmentRecord = {
  id: string;
  category: string;
  sortOrder: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  asset?: {
    id: string;
    assetType: string;
    visibility: string;
    mimeType: string;
    width: number | null;
    height: number | null;
  } | null;
};

type DebutApplicationUserRecord = {
  id: string;
  userId: string;
  displayName: string | null;
  status: string;
  participationType: string;
  shareTierRequested: number | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
  attachments?: DebutApplicationUserAttachmentRecord[];
};

@Injectable()
export class DebutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

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
      operationSegments: DEBUT_OPERATION_SEGMENT_CONTRACT,
      applicationChannels: [
        {
          value: 'phone_consultation',
          label: 'Phone consultation',
          labelKey: 'debut.applicationChannel.phoneConsultation.label',
          description:
            'Low-friction MVP application. Collect basic contact, story, and preferred call time; the operator confirms details by phone.',
          descriptionKey: 'debut.applicationChannel.phoneConsultation.description',
          uploadEnabled: false,
          recommended: true,
          operations: this.phoneConsultationOperationsContract(),
        },
        {
          value: 'online_review',
          label: 'Online review',
          labelKey: 'debut.applicationChannel.onlineReview.label',
          description:
            'Private review mode for applicants who want to submit images, voice, video, or portfolio materials online.',
          descriptionKey: 'debut.applicationChannel.onlineReview.description',
          uploadEnabled: true,
          status: 'available_private_material_flow',
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
          labelKo: '\uBCF8\uC778 \uC790\uB8CC \uB610\uB294 \uC0AC\uC6A9 \uAD8C\uD55C\uC774 \uC788\uB294 \uC790\uB8CC\uB9CC \uC81C\uCD9C\uD569\uB2C8\uB2E4.',
        },
        {
          key: 'consentRevenuePolicy',
          required: true,
          labelKo: '\uC218\uC775\uBC30\uBD84\uC740 \uC2EC\uC0AC\uC640 \uACC4\uC57D \uB2E8\uACC4\uC5D0\uC11C \uCD5C\uC885 \uD655\uC815\uB428\uC744 \uD655\uC778\uD569\uB2C8\uB2E4.',
        },
        {
          key: 'consentPrivacy',
          required: true,
          labelKo: '\uC2E0\uCCAD \uAC80\uD1A0\uB97C \uC704\uD55C \uAC1C\uC778\uC815\uBCF4 \uCC98\uB9AC\uC5D0 \uB3D9\uC758\uD569\uB2C8\uB2E4.',
        },
        {
          key: 'consentVoice',
          required: false,
          labelKo: '\uBAA9\uC18C\uB9AC/\uB178\uB798/\uD37C\uD3EC\uBA3C\uC2A4 \uC790\uB8CC \uC81C\uCD9C \uC2DC \uAC80\uD1A0\uC640 \uC0AC\uC6A9\uC5D0 \uB3D9\uC758\uD569\uB2C8\uB2E4.',
        },
        {
          key: 'consentMarketing',
          required: false,
          labelKo: '\uB9C8\uCF00\uD305 \uC815\uBCF4 \uC218\uC2E0\uC5D0 \uC120\uD0DD \uB3D9\uC758\uD569\uB2C8\uB2E4.',
        },
      ],
      fieldPolicy: {
        intro: { minLength: 20, maxLength: 4000 },
        partnershipOtherIntro: { minLength: 10, maxLength: 4000 },
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
        operationSegment: {
          values: [...DEBUT_OPERATION_SEGMENTS],
          adminFilterOnly: true,
        },
        affiliatedOrgName: { maxLength: 120, required: false },
        rightsRelationshipNote: { maxLength: 1000, required: false },
        creatorExperienceNote: { maxLength: 1000, required: false },
        shareTierRequested: { min: 0, max: 70, required: false },
        metadata:
          'Use only non-sensitive structured details. Do not include IDs, bank accounts, contracts, secrets, or raw identity documents.',
      },
      materialSubmissionPolicy: {
        currentMvpMode: 'private_applicant_material_upload',
        phoneConsultation:
          'Do not ask for files. The operator confirms details by phone after application submission.',
        phoneConsultationOperations: this.phoneConsultationOperationsContract(),
        onlineReview:
          'Use private debut application material upload intents. Do not use public user image uploads.',
        uploadIntentEndpoint: '/api/v1/debut/application-materials/upload-intents',
        confirmUploadEndpoint:
          '/api/v1/debut/application-materials/:assetId/confirm-upload',
        visibility: 'private',
        publicUrlReturned: false,
        allowedCategories: DEBUT_MATERIAL_CATEGORIES,
        acceptedMaterialFields: [
          'facePhotoAssetIds',
          'bodyMotionReferenceAssetIds',
          'voiceSampleAssetIds',
          'danceVideoReferenceAssetIds',
          'portfolioAttachmentAssetIds',
          'portfolioUrls',
        ],
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

  async createMaterialUploadIntent(
    userId: string,
    input: CreateDebutMaterialUploadIntentDto,
  ) {
    const category = this.materialCategory(input.category);
    const mimeType = this.materialMimeType(category, input.mimeType);
    const assetType = this.assetTypeFromMimeType(mimeType);
    const fileName = this.safeFileName(input.fileName);
    const fileSizeBytes = this.materialFileSizeBytes(input.fileSizeBytes, assetType);
    const storageProvider = this.configService.get<string>('OBJECT_STORAGE_PROVIDER') ?? 'local';
    const storageKey = this.buildStorageKey(assetType, fileName);
    const expiresInSeconds = this.numberFromEnv('OBJECT_UPLOAD_INTENT_TTL_SECONDS', 900);
    const uploadUrl = this.buildUploadUrl(
      storageProvider,
      storageKey,
      expiresInSeconds,
      mimeType,
    );

    const asset = await this.prisma.asset.create({
      data: {
        assetType,
        visibility: 'private',
        storageProvider,
        storageKey,
        mimeType,
        fileSizeBytes,
        width: input.width,
        height: input.height,
        durationSeconds: input.durationSeconds,
        checksum: input.checksum,
        metadata: this.toJson({
          uploadIntent: {
            status: 'pending_upload',
            scope: DEBUT_MATERIAL_SCOPE,
            category,
            createdByUserId: userId,
            fileName,
            createdAt: new Date().toISOString(),
          },
          privacy: {
            publicUrlReturned: false,
            applicantMaterial: true,
          },
        }),
      },
    });

    return {
      asset: this.presentPrivateMaterialAsset(asset),
      upload: {
        method: 'PUT',
        url: uploadUrl,
        storageProvider,
        requiredHeaders: {
          'content-type': mimeType,
        },
        expiresInSeconds,
        mode: storageProvider === 'local' ? 'metadata_only' : 'direct_upload_ready',
      },
      policy: this.materialUploadPolicy(),
    };
  }

  async confirmMaterialUpload(
    userId: string,
    assetId: string,
    input: ConfirmDebutMaterialUploadDto,
  ) {
    const asset = await this.findOwnedDebutMaterialAsset(userId, assetId);
    const metadata = this.metadataObject(asset.metadata);
    const uploadIntent = this.metadataObject(metadata.uploadIntent);
    const category = this.materialCategory(String(uploadIntent.category ?? ''));
    const mimeType = this.materialMimeType(category, asset.mimeType);
    const assetType = this.assetTypeFromMimeType(mimeType);

    if (asset.visibility !== 'private') {
      throw this.badRequest(
        'DEBUT_MATERIAL_NOT_PRIVATE',
        'Debut material asset must be private.',
        'debut.material.notPrivate',
      );
    }

    if (input.fileSizeBytes !== undefined) {
      this.materialFileSizeBytes(input.fileSizeBytes, assetType);
    }

    await this.assertObjectUploaded(
      asset.storageProvider,
      asset.storageKey,
      mimeType,
      this.maxMaterialFileSizeBytes(assetType),
    );

    const confirmedAt = new Date().toISOString();
    const updatedAsset = await this.prisma.asset.update({
      where: { id: asset.id },
      data: {
        checksum: input.checksum ?? asset.checksum,
        metadata: this.toJson({
          ...metadata,
          uploadIntent: {
            ...uploadIntent,
            status: 'uploaded',
            confirmedByUserId: userId,
            confirmedAt,
            objectETag: input.objectETag ?? null,
          },
        }),
        updatedAt: new Date(),
      },
    });

    return {
      asset: this.presentPrivateMaterialAsset(updatedAsset),
      upload: {
        status: 'uploaded',
        confirmedAt,
      },
      policy: this.materialUploadPolicy(),
    };
  }

  async createApplication(userId: string, input: CreateDebutApplicationDto) {
    const normalized = this.normalizeCreateApplication(input);

    if (!normalized.isAdult) {
      throw this.badRequest(
        'DEBUT_APPLICANT_ADULT_CONFIRMATION_REQUIRED',
        'isAdult must be true for MVP debut applications.',
        'debut.applicant.adultConfirmationRequired',
      );
    }

    await this.assertVerifiedApplicantIsAdult(userId);
    this.assertRequiredConsents(normalized);
    this.assertApplicationChannel(normalized);
    this.assertIntroPolicy(normalized);
    this.assertGenderPolicy(normalized);
    const attachmentInputs = await this.validatedApplicationAttachments(
      userId,
      normalized,
    );
    const metadata = this.applicationMetadata(normalized);

    const application = await this.prisma.$transaction(async (tx) => {
      return tx.debutApplication.create({
        data: {
          userId,
          applicantName: normalized.applicantName,
          displayName: normalized.displayName,
          contactEmail: normalized.contactEmail,
          contactPhone: normalized.contactPhone,
          isAdult: normalized.isAdult,
          participationType: normalized.participationType,
          shareTierRequested: normalized.shareTierRequested,
          intro: normalized.intro,
          portfolioUrl: normalized.portfolioUrl,
          consentAppearance: normalized.consentAppearance === true,
          consentVoice: normalized.consentVoice,
          consentRevenuePolicy: normalized.consentRevenuePolicy === true,
          consentPrivacy: true,
          consentMarketing: this.optionalConsentMarketing(normalized),
          metadata,
          attachments: attachmentInputs.length
            ? {
                create: attachmentInputs,
              }
            : undefined,
        },
        include: this.applicationInclude(),
      });
    });

    return {
      application,
      message: 'Debut application submitted',
    };
  }

  private normalizeCreateApplication(
    input: CreateDebutApplicationDto,
  ): NormalizedCreateDebutApplicationInput {
    const contactEmail = input.contactEmail ?? input.applicantEmail;
    if (!contactEmail) {
      throw this.badRequest(
        'DEBUT_CONTACT_EMAIL_REQUIRED',
        'contactEmail is required.',
        'debut.contactEmail.required',
      );
    }

    const intro = input.intro ?? input.selfIntroduction;
    if (!intro) {
      throw this.badRequest(
        'DEBUT_INTRO_REQUIRED',
        'intro is required.',
        'debut.intro.required',
      );
    }

    const contactPhone = input.contactPhone ?? input.applicantPhone;

    return {
      ...input,
      contactEmail,
      contactPhone,
      intro,
      applicationType: input.applicationType ?? DEFAULT_APPLICATION_TYPE,
      participationType: input.participationType ?? DEFAULT_PARTICIPATION_TYPE,
      consentVoice: input.consentVoice ?? false,
    };
  }

  getMyApplications(userId: string) {
    return this.prisma.debutApplication.findMany({
      where: { userId },
      select: this.userApplicationSelect(),
      orderBy: { createdAt: 'desc' },
    }).then((applications) => ({
      ...this.userDebutApplicationReadOnlyContract(),
      items: applications.map((application) =>
        this.presentUserDebutApplication(application),
      ),
      count: applications.length,
      ctaState: applications.length ? 'status' : 'apply',
    }));
  }

  async getMyApplicationStatus(userId: string, applicationId: string) {
    const application = await this.prisma.debutApplication.findFirst({
      where: { id: applicationId, userId },
      select: this.userApplicationSelect(),
    });

    if (!application) {
      throw new NotFoundException('Debut application not found');
    }

    return {
      ...this.userDebutApplicationReadOnlyContract(),
      application: this.presentUserDebutApplication(application),
    };
  }

  async getMyLatestApplication(userId: string) {
    const application = await this.prisma.debutApplication.findFirst({
      where: { userId },
      select: this.userApplicationSelect(),
      orderBy: { createdAt: 'desc' },
    });

    return {
      ...this.userDebutApplicationReadOnlyContract(),
      application: application ? this.presentUserDebutApplication(application) : null,
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
      return {
        application: this.presentUserDebutApplication(application),
        ok: true,
        alreadyWithdrawn: true,
      };
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

    return {
      application: this.presentUserDebutApplication(withdrawn),
      ok: true,
      alreadyWithdrawn: false,
    };
  }

  async resubmitMyApplication(
    userId: string,
    applicationId: string,
    input: ResubmitDebutApplicationDto,
  ) {
    const before = await this.prisma.debutApplication.findFirst({
      where: { id: applicationId, userId },
      include: this.applicationInclude(),
    });

    if (!before) {
      throw this.notFound(
        'DEBUT_APPLICATION_NOT_FOUND',
        'Debut application was not found.',
        'debut.application.notFound',
      );
    }

    if (before.status !== 'needs_more_info') {
      throw this.badRequest(
        'DEBUT_RESUBMIT_STATUS_NOT_OPEN',
        'Only needs_more_info debut applications can be resubmitted.',
        'debut.resubmit.statusNotOpen',
        {
          currentStatus: this.userReviewStatus(before.status),
          allowedStatus: 'needs_more_info',
        },
      );
    }

    const normalized = this.normalizeCreateApplication(input);

    if (!normalized.isAdult) {
      throw this.badRequest(
        'DEBUT_APPLICANT_ADULT_CONFIRMATION_REQUIRED',
        'isAdult must be true for MVP debut applications.',
        'debut.applicant.adultConfirmationRequired',
      );
    }

    await this.assertVerifiedApplicantIsAdult(userId);
    this.assertRequiredConsents(normalized);
    this.assertApplicationChannel(normalized);
    this.assertIntroPolicy(normalized);
    this.assertGenderPolicy(normalized);
    const attachmentInputs = await this.validatedApplicationAttachments(
      userId,
      normalized,
    );
    const now = new Date();
    const resubmittedAt = now.toISOString();
    const metadata = this.resubmissionMetadata(
      before.metadata,
      normalized,
      resubmittedAt,
    );

    const application = await this.prisma.debutApplication.update({
      where: { id: before.id },
      data: {
        status: 'submitted',
        applicantName: normalized.applicantName,
        displayName: normalized.displayName,
        contactEmail: normalized.contactEmail,
        contactPhone: normalized.contactPhone,
        isAdult: normalized.isAdult,
        participationType: normalized.participationType,
        shareTierRequested: normalized.shareTierRequested,
        intro: normalized.intro,
        portfolioUrl: normalized.portfolioUrl,
        consentAppearance: normalized.consentAppearance === true,
        consentVoice: normalized.consentVoice,
        consentRevenuePolicy: normalized.consentRevenuePolicy === true,
        consentPrivacy: true,
        consentMarketing: this.optionalConsentMarketing(normalized),
        metadata,
        updatedAt: now,
        attachments: {
          deleteMany: {},
          ...(attachmentInputs.length ? { create: attachmentInputs } : {}),
        },
      },
      include: this.applicationInclude(),
    });

    const auditEvent = await this.recordAudit(
      { id: userId, email: null },
      application.id,
      before,
      application,
      'user',
      'debut_application.resubmit',
    );
    const auditEventId = this.safeString(this.metadataObject(auditEvent).id);

    return {
      ok: true,
      action: 'debut_application.resubmit',
      application: this.presentUserDebutApplication(application),
      resubmission: {
        accepted: true,
        endpoint: DEBUT_RESUBMISSION_ENDPOINT,
        method: 'POST',
        previousStatus: 'needs_more_info',
        nextStatus: 'submitted',
        createsNewApplication: false,
        replacementMode: 'full_application',
        resubmittedAt,
      },
      audit: {
        recorded: true,
        eventId: auditEventId,
        sensitiveFieldsStored: false,
        internalNotesStored: false,
        privateMaterialUrlsStored: false,
        storageKeysStored: false,
      },
      mutationPolicy: {
        finalDebutMutation: false,
        contractMutation: false,
        settlementMutation: false,
        payoutMutation: false,
        walletMutation: false,
        luminaMutation: false,
      },
    };
  }

  async getApplications(query: DebutApplicationListQueryDto) {
    const take = query.take ?? 50;
    const status = query.status ? this.status(query.status) : undefined;
    const where = this.debutApplicationWhere({
      status,
      applicationChannel: query.applicationChannel,
      applicationType: query.applicationType,
      operationSegment: query.operationSegment,
      rightsReviewRequired: query.rightsReviewRequired,
      partnerReviewRequired: query.partnerReviewRequired,
      consultationStatus: query.consultationStatus,
      query: query.query,
    });

    const rows = await this.prisma.debutApplication.findMany({
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
    });
    const page = this.paginated(rows, take);

    return {
      ...page,
      ...this.adminDebutApplicationReadOnlyContract(),
      items: page.items.map((application) =>
        this.presentAdminDebutApplicationListItem(application),
      ),
    };
  }

  async getApplication(applicationId: string) {
    const application = await this.prisma.debutApplication.findUnique({
      where: { id: applicationId },
      include: this.applicationInclude(),
    });

    if (!application) {
      throw new NotFoundException('Debut application not found');
    }

    return {
      ...this.adminDebutApplicationReadOnlyContract(),
      application: this.presentAdminDebutApplicationDetail(application),
    };
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

    this.assertAdminUpdateContract(input);

    if (
      input.status === undefined &&
      input.publicStatusReason === undefined &&
      input.requestedActionKey === undefined &&
      input.reviewNote === undefined &&
      input.consultationStatus === undefined &&
      input.consultationScheduledAt === undefined &&
      input.consultationNote === undefined &&
      input.rightsReviewStatus === undefined &&
      input.rightsReviewNote === undefined &&
      input.partnerReviewStatus === undefined &&
      input.partnerReviewNote === undefined
    ) {
      throw this.badRequest(
        'DEBUT_ADMIN_UPDATE_EMPTY',
        'At least one admin update field is required.',
        'debut.admin.update.empty',
      );
    }

    const application = await this.prisma.debutApplication.update({
      where: { id: applicationId },
      data: this.clean({
        status:
          input.status === undefined
            ? undefined
            : this.adminWritableStatus(input.status),
        reviewNote: input.reviewNote,
        updatedAt: new Date(),
        metadata: this.mergeAdminReviewMetadata(before.metadata, input, user),
      }),
      include: this.applicationInclude(),
    });

    const auditSummary = this.debutApplicationAuditSummary(before, application);
    const auditEvent = await this.recordAudit(
      user,
      application.id,
      before,
      application,
      'admin',
      'debut_application.review_update',
      auditSummary,
    );
    const auditEventId = this.safeString(this.metadataObject(auditEvent).id);

    return {
      ok: true,
      action: 'debut_application.review_update',
      application: this.presentAdminDebutApplicationListItem(application),
      audit: {
        recorded: true,
        eventId: auditEventId,
        contractVersion: auditSummary.metadata.contractVersion,
        changedFields: auditSummary.metadata.changedFields,
        sensitiveFieldsStored: false,
        internalNotesStored: false,
        privateMaterialUrlsStored: false,
        storageKeysStored: false,
      },
      mutationPolicy: {
        finalDebutMutation: false,
        contractMutation: false,
        settlementMutation: false,
        payoutMutation: false,
        walletMutation: false,
        luminaMutation: false,
      },
    };
  }

  private assertRequiredConsents(input: CreateDebutApplicationDto) {
    const applicationType = input.applicationType ?? DEFAULT_APPLICATION_TYPE;
    const required =
      applicationType === 'partnership_other'
        ? ['consentPrivacy']
        : ['consentAppearance', 'consentRevenuePolicy', 'consentPrivacy'];

    for (const key of required) {
      if (input[key as keyof CreateDebutApplicationDto] !== true) {
        throw this.badRequest(
          'DEBUT_REQUIRED_CONSENT_MISSING',
          `${key} must be true.`,
          'debut.consent.required',
          { consentKey: key },
        );
      }
    }
  }

  private assertApplicationChannel(input: CreateDebutApplicationDto) {
    const channel = input.applicationChannel ?? 'phone_consultation';
    if (channel === 'phone_consultation' && !input.contactPhone) {
      throw this.badRequest(
        'DEBUT_CONTACT_PHONE_REQUIRED',
        'contactPhone is required for phone_consultation.',
        'debut.contactPhone.requiredForPhoneConsultation',
      );
    }

    if (channel === 'phone_consultation' && input.consultationConsent !== true) {
      throw this.badRequest(
        'DEBUT_CONSULTATION_CONSENT_REQUIRED',
        'consultationConsent must be true for phone_consultation.',
        'debut.consultationConsent.requiredForPhoneConsultation',
      );
    }
  }

  private assertIntroPolicy(input: CreateDebutApplicationDto) {
    const intro = input.intro ?? input.selfIntroduction ?? '';
    const minLength =
      (input.applicationType ?? DEFAULT_APPLICATION_TYPE) === 'partnership_other' ? 10 : 20;

    if (intro.trim().length < minLength) {
      throw this.badRequest(
        'DEBUT_INTRO_TOO_SHORT',
        `intro must be at least ${minLength} characters.`,
        'debut.intro.tooShort',
        { minLength },
      );
    }
  }

  private assertGenderPolicy(input: CreateDebutApplicationDto) {
    if (input.genderSwapRequested === true) {
      throw this.badRequest(
        'DEBUT_GENDER_SWAP_UNSUPPORTED',
        'genderSwapRequested must be false or omitted.',
        'debut.genderSwap.unsupported',
      );
    }
  }

  private async assertVerifiedApplicantIsAdult(userId: string) {
    const verification = await this.prisma.userIdentityVerification.findUnique({
      where: { userId },
      select: { status: true, birthDate: true },
    });

    if (
      verification?.status === 'verified' &&
      verification.birthDate &&
      this.ageYears(verification.birthDate) < 19
    ) {
      throw this.badRequest(
        'DEBUT_APPLICANT_MINOR_NOT_ALLOWED',
        'Verified minor accounts cannot submit MVP debut applications.',
        'debut.applicant.minorNotAllowed',
      );
    }
  }

  private ageYears(birthDate: Date) {
    const now = new Date();
    let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
    const birthMonth = birthDate.getUTCMonth();
    const birthDay = birthDate.getUTCDate();
    const birthdayPassed =
      now.getUTCMonth() > birthMonth ||
      (now.getUTCMonth() === birthMonth && now.getUTCDate() >= birthDay);

    if (!birthdayPassed) {
      age -= 1;
    }

    return age;
  }

  private async validatedApplicationAttachments(
    userId: string,
    input: CreateDebutApplicationDto,
  ) {
    const requested = this.attachmentRequests(input);
    if (requested.length === 0) {
      return [];
    }

    const ids = requested.map((item) => item.assetId);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      throw this.badRequest(
        'DEBUT_ATTACHMENT_DUPLICATE_ASSET',
        'Debut application attachments must not repeat the same asset.',
        'debut.attachment.duplicateAsset',
      );
    }

    const assets = await this.prisma.asset.findMany({
      where: { id: { in: ids } },
    });
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

    return requested.map((item) => {
      const asset = assetsById.get(item.assetId);
      if (!asset) {
        throw this.badRequest(
          'DEBUT_ATTACHMENT_ASSET_NOT_FOUND',
          'Debut application attachment asset was not found.',
          'debut.attachment.notFound',
          { assetId: item.assetId, category: item.category },
        );
      }

      this.assertAttachableMaterialAsset(userId, asset, item.category);

      return {
        assetId: asset.id,
        category: item.category,
        sortOrder: item.sortOrder,
        status: 'attached',
        metadata: this.toJson({
          linkedFrom: item.field,
          linkedAt: new Date().toISOString(),
        }),
      };
    });
  }

  private attachmentRequests(input: CreateDebutApplicationDto) {
    return DEBUT_MATERIAL_CATEGORIES.flatMap((category) => {
      const field = MATERIAL_CATEGORY_ASSET_FIELD[category];
      if (!field) {
        return [];
      }

      const values = input[field] ?? [];
      return values.map((assetId, index) => {
        if (!UUID_PATTERN.test(assetId)) {
          throw this.badRequest(
            'DEBUT_ATTACHMENT_INVALID_ASSET_ID',
            'Debut attachment asset id must be a UUID.',
            'debut.attachment.invalidAssetId',
            { field, category },
          );
        }

        return { assetId, category, field, sortOrder: index };
      });
    });
  }

  private assertAttachableMaterialAsset(
    userId: string,
    asset: {
      id: string;
      assetType: string;
      visibility: string;
      mimeType: string;
      metadata: Prisma.JsonValue;
    },
    category: (typeof DEBUT_MATERIAL_CATEGORIES)[number],
  ) {
    const metadata = this.metadataObject(asset.metadata);
    const uploadIntent = this.metadataObject(metadata.uploadIntent);
    const lifecycle = this.metadataObject(metadata.lifecycle);

    if (asset.visibility !== 'private') {
      throw this.badRequest(
        'DEBUT_ATTACHMENT_NOT_PRIVATE',
        'Debut application attachments must be private assets.',
        'debut.attachment.notPrivate',
        { assetId: asset.id, category },
      );
    }

    if (
      uploadIntent.scope !== DEBUT_MATERIAL_SCOPE ||
      uploadIntent.createdByUserId !== userId ||
      uploadIntent.category !== category
    ) {
      throw this.badRequest(
        'DEBUT_ATTACHMENT_INVALID_SCOPE',
        'Debut application attachment asset does not belong to this material category.',
        'debut.attachment.invalidScope',
        { assetId: asset.id, category },
      );
    }

    if (uploadIntent.status !== 'uploaded') {
      throw this.badRequest(
        'DEBUT_ATTACHMENT_UPLOAD_NOT_CONFIRMED',
        'Debut application attachment upload must be confirmed first.',
        'debut.attachment.uploadNotConfirmed',
        { assetId: asset.id, category },
      );
    }

    if (lifecycle.status === 'archived') {
      throw this.badRequest(
        'DEBUT_ATTACHMENT_ARCHIVED',
        'Debut application attachment asset is archived.',
        'debut.attachment.archived',
        { assetId: asset.id, category },
      );
    }

    this.materialMimeType(category, asset.mimeType);
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
      attachments: {
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          category: true,
          sortOrder: true,
          status: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
          asset: {
            select: {
              id: true,
              assetType: true,
              visibility: true,
              mimeType: true,
              width: true,
              height: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      },
    } satisfies Prisma.DebutApplicationInclude;
  }

  private userApplicationSelect() {
    return {
      id: true,
      userId: true,
      displayName: true,
      status: true,
      participationType: true,
      shareTierRequested: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
      attachments: {
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          category: true,
          sortOrder: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          asset: {
            select: {
              id: true,
              assetType: true,
              visibility: true,
              mimeType: true,
              width: true,
              height: true,
            },
          },
        },
      },
    } satisfies Prisma.DebutApplicationSelect;
  }

  private userDebutApplicationReadOnlyContract() {
    return {
      readOnly: true,
      ownerOnly: true,
      statusCandidates: [...USER_DEBUT_APPLICATION_STATUS_CANDIDATES],
      statusCopy: USER_APPLICATION_STATUS_COPY,
      notificationContract: this.debutApplicationNotificationContract(),
      privateMaterialPolicy: {
        metadataOnly: true,
        publicUrlReturned: false,
        signedReadUrlReturned: false,
        originalFileUrlReturned: false,
        storageKeyReturned: false,
      },
      resubmissionPolicy: this.debutApplicationResubmissionPolicy(),
    };
  }

  private presentUserDebutApplication(application: DebutApplicationUserRecord) {
    const metadata = this.metadataObject(application.metadata);
    const status = this.userReviewStatus(application.status);
    const copy = USER_APPLICATION_STATUS_COPY[status];
    const attachments = application.attachments ?? [];
    const categories = [...new Set(attachments.map((attachment) => attachment.category))];
    const applicationChannel =
      this.safeString(metadata.applicationChannel) ?? 'phone_consultation';
    const applicationType =
      this.safeString(metadata.applicationType) ?? DEFAULT_APPLICATION_TYPE;

    return {
      id: application.id,
      status,
      statusLabelKo: copy.labelKo,
      messageKey: copy.messageKey,
      defaultMessageKo: copy.defaultMessageKo,
      cta: this.userDebutApplicationCta(status),
      displayName: application.displayName,
      participationType: application.participationType,
      applicationChannel,
      applicationType,
      submittedAt: application.createdAt,
      updatedAt: application.updatedAt,
      requestedShareRate: application.shareTierRequested,
      materialSummary: {
        count: attachments.length,
        categories,
        materialTypes: categories,
        hasPrivateMaterials: attachments.length > 0,
        metadataOnly: true,
      },
      finalization: this.debutApplicationFinalizationContract(
        metadata,
        applicationType,
      ),
      publicNotice: this.publicDebutApplicationNotice(status, metadata),
      statusHistory: this.userDebutApplicationStatusHistory(application, status),
      privacy: {
        contactReturned: false,
        introReturned: false,
        adminReviewNoteReturned: false,
        internalMetadataReturned: false,
        privateMaterialUrlReturned: false,
      },
    };
  }

  private userDebutApplicationStatusHistory(
    application: DebutApplicationUserRecord,
    currentStatus: UserDebutApplicationStatus,
  ) {
    const metadata = this.metadataObject(application.metadata);
    const submittedCopy = USER_APPLICATION_STATUS_COPY.submitted;
    const history: Array<{
      status: UserDebutApplicationStatus;
      labelKo: string;
      messageKey: string;
      occurredAt: Date;
      source: string;
    }> = [
      {
        status: 'submitted',
        labelKo: submittedCopy.labelKo,
        messageKey: submittedCopy.messageKey,
        occurredAt: application.createdAt,
        source: 'application.createdAt',
      },
    ];

    const resubmittedAt = this.safeDateString(metadata.lastResubmittedAt);

    if (resubmittedAt) {
      history.push({
        status: 'submitted',
        labelKo: submittedCopy.labelKo,
        messageKey: submittedCopy.messageKey,
        occurredAt: resubmittedAt,
        source: 'application.resubmittedAt',
      });
    } else if (currentStatus !== 'submitted') {
      const copy = USER_APPLICATION_STATUS_COPY[currentStatus];
      history.push({
        status: currentStatus,
        labelKo: copy.labelKo,
        messageKey: copy.messageKey,
        occurredAt:
          this.safeDateString(metadata.withdrawnAt) ??
          this.safeDateString(metadata.adminReviewUpdatedAt) ??
          application.updatedAt,
        source: 'application.updatedAt',
      });
    }

    return history;
  }

  private userDebutApplicationCta(status: UserDebutApplicationStatus) {
    const cta = USER_APPLICATION_STATUS_CTA[status];
    const resubmissionOpen = status === 'needs_more_info';

    return {
      ...cta,
      messageKey: this.debutApplicationCtaMessageKey(cta.key),
      defaultLabelKo: this.debutApplicationCtaDefaultLabel(cta.key),
      actionAllowed: resubmissionOpen,
      mutationAllowed: resubmissionOpen,
      contractOnly: !resubmissionOpen,
      endpoint: resubmissionOpen ? DEBUT_RESUBMISSION_ENDPOINT : null,
      method: resubmissionOpen ? 'POST' : null,
      bodyContractKey: resubmissionOpen
        ? 'debut.application.resubmission.body.fullApplication'
        : null,
      disabledReasonKey: resubmissionOpen
        ? null
        : 'debut.application.cta.disabled.contractOnly',
      defaultDisabledReasonKo: resubmissionOpen
        ? null
        : this.debutApplicationCtaDisabledReason(status),
      blockedMutations: [...USER_APPLICATION_CTA_BLOCKED_MUTATIONS],
    };
  }

  private publicDebutApplicationCta(status: UserDebutApplicationStatus) {
    const cta = this.userDebutApplicationCta(status);

    return {
      enabled: cta.enabled,
      messageKey: cta.messageKey,
      actionAllowed: cta.actionAllowed,
      mutationAllowed: cta.mutationAllowed,
      contractOnly: cta.contractOnly,
      endpoint: cta.endpoint,
      method: cta.method,
      bodyContractKey: cta.bodyContractKey,
      disabledReasonKey: cta.disabledReasonKey,
      blockedMutations: cta.blockedMutations,
    };
  }

  private debutApplicationResubmissionPolicy() {
    return {
      enabledStatuses: ['needs_more_info'],
      endpoint: DEBUT_RESUBMISSION_ENDPOINT,
      method: 'POST',
      bodyContract: 'CreateDebutApplicationDto',
      bodyContractKey: 'debut.application.resubmission.body.fullApplication',
      createsNewApplication: false,
      statusAfterSuccess: 'submitted',
      replacesPrivateMaterialLinks: true,
      clearsPreviousPublicRequest: true,
      ownerOnly: true,
      finalDebutMutation: false,
      contractMutation: false,
      settlementMutation: false,
      payoutMutation: false,
      walletMutation: false,
      luminaMutation: false,
    };
  }

  private debutApplicationCtaMessageKey(key: string) {
    if (key === 'resubmit') {
      return 'debut.application.cta.resubmit';
    }

    if (key === 'check_request') {
      return 'debut.application.cta.checkRequest';
    }

    if (key === 'check_result') {
      return 'debut.application.cta.checkResult';
    }

    return 'debut.application.cta.viewStatus';
  }

  private debutApplicationCtaDefaultLabel(key: string) {
    if (key === 'resubmit') {
      return '보완 제출하기';
    }

    if (key === 'check_request') {
      return '\uBCF4\uC644 \uC548\uB0B4 \uD655\uC778';
    }

    if (key === 'check_result') {
      return '\uACB0\uACFC \uC548\uB0B4 \uD655\uC778';
    }

    return '\uC0C1\uD0DC \uD655\uC778';
  }

  private debutApplicationCtaDisabledReason(status: UserDebutApplicationStatus) {
    if (status === 'needs_more_info') {
      return '\uBCF4\uC644 \uC694\uCCAD\uC740 \uC548\uB0B4 \uD655\uC778\uC6A9\uC774\uBA70, \uC81C\uCD9C\u00B7\uC218\uC815 \uACBD\uB85C\uB294 \uBCC4\uB3C4 \uC548\uB0B4 \uC804\uAE4C\uC9C0 \uC5F4\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.';
    }

    if (status === 'approved') {
      return '\uC5F0\uB77D \uC900\uBE44 \uC0C1\uD0DC\uC774\uBA70, \uACC4\uC57D\u00B7\uC815\uC0B0\u00B7\uCD5C\uC885 \uB370\uBDD4 \uD655\uC815 \uC804\uAE4C\uC9C0 CTA\uB294 \uC5F4\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.';
    }

    if (status === 'rejected') {
      return '\uC2EC\uC0AC \uACB0\uACFC \uC548\uB0B4\uB9CC \uC81C\uACF5\uD558\uBA70, \uCD94\uAC00 \uC9C4\uD589 CTA\uB294 \uC5F4\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.';
    }

    if (status === 'canceled') {
      return '\uC885\uB8CC\uB41C \uC2E0\uCCAD\uC740 \uC0C1\uD0DC \uD655\uC778\uB9CC \uAC00\uB2A5\uD569\uB2C8\uB2E4.';
    }

    return '\uD604\uC7AC \uD654\uBA74\uC740 \uC2EC\uC0AC \uC0C1\uD0DC \uD655\uC778\uC6A9\uC785\uB2C8\uB2E4.';
  }

  private publicDebutApplicationNotice(
    status: UserDebutApplicationStatus,
    metadata: Record<string, unknown>,
  ) {
    const copy = USER_APPLICATION_STATUS_COPY[status];
    const cta = this.publicDebutApplicationCta(status);
    const publicReason =
      this.safeString(metadata.publicStatusReason) ??
      this.safeString(metadata.userVisibleReason) ??
      null;
    const requestedActionKey =
      status === 'needs_more_info'
        ? this.safeString(metadata.requestedActionKey) ?? 'debut.application.action.provideMoreInfo'
        : null;

    return {
      status,
      titleKey: `${copy.messageKey}.title`,
      bodyKey: `${copy.messageKey}.body`,
      defaultTitleKo: copy.labelKo,
      defaultBodyKo: copy.defaultMessageKo,
      publicReason,
      requestedActionKey,
      cta,
      channelsPlanned: ['in_app', 'email'],
      dispatch: {
        inAppSent: false,
        emailSent: false,
        contractOnly: true,
      },
      internalAdminNoteReturned: false,
      settlementOrContractFinalized: false,
    };
  }

  private debutApplicationNotificationContract() {
    return {
      dispatchEnabled: false,
      contractOnly: true,
      channelsPlanned: ['in_app', 'email'],
      events: [
        {
          status: 'needs_more_info',
          titleKey: 'debut.application.status.needsMoreInfo.title',
          bodyKey: 'debut.application.status.needsMoreInfo.body',
        },
        {
          status: 'approved',
          titleKey: 'debut.application.status.approved.title',
          bodyKey: 'debut.application.status.approved.body',
        },
        {
          status: 'rejected',
          titleKey: 'debut.application.status.rejected.title',
          bodyKey: 'debut.application.status.rejected.body',
        },
      ],
      internalFieldsExcluded: [
        'reviewNote',
        'consultationNote',
        'rightsReviewNote',
        'partnerReviewNote',
      ],
    };
  }

  private adminDebutApplicationReadOnlyContract() {
    return {
      readOnly: true,
      statusCandidates: [...ADMIN_DEBUT_APPLICATION_STATUS_CANDIDATES],
      privateMaterialPolicy: {
        metadataOnly: true,
        publicUrlReturned: false,
        signedReadUrlReturned: false,
        originalFileUrlReturned: false,
        storageKeyReturned: false,
      },
      operationSegments: DEBUT_OPERATION_SEGMENT_CONTRACT,
      routingContract: {
        emailDispatchEnabled: false,
        inAppDispatchEnabled: false,
        smsDispatchEnabled: false,
        phoneCallAutomationEnabled: false,
        operatorPhoneNumberReturned: false,
        contractOnly: true,
      },
      phoneConsultationOperations: this.phoneConsultationOperationsContract(),
    };
  }

  private presentAdminDebutApplicationListItem(
    application: DebutApplicationAdminRecord,
  ) {
    const metadata = this.metadataObject(application.metadata);
    const attachments = application.attachments ?? [];
    const materialCategories = [...new Set(attachments.map((item) => item.category))];
    const applicationChannel =
      this.safeString(metadata.applicationChannel) ?? 'phone_consultation';
    const applicationType =
      this.safeString(metadata.applicationType) ?? DEFAULT_APPLICATION_TYPE;

    return {
      id: application.id,
      userId: application.userId,
      applicant: {
        name: application.applicantName,
        displayName: application.displayName,
        userDisplayName: application.user.profile?.displayName ?? null,
      },
      status: this.adminReviewStatus(application.status),
      applicationChannel,
      applicationType,
      operationSegment: this.debutOperationSegment(applicationType, metadata),
      participationType: application.participationType,
      submittedAt: application.createdAt,
      updatedAt: application.updatedAt,
      contact: {
        emailMasked: this.maskEmail(application.contactEmail),
        phoneMasked: this.maskPhone(application.contactPhone),
        emailPresent: Boolean(this.safeString(application.contactEmail)),
        phonePresent: Boolean(this.safeString(application.contactPhone)),
        preferredContactTime: this.safeString(metadata.preferredContactTime),
      },
      user: {
        id: application.user.id,
        status: application.user.status,
        emailMasked: this.maskEmail(application.user.email),
      },
      materialSummary: {
        count: attachments.length,
        categories: materialCategories,
        materialTypes: materialCategories,
        hasPrivateMaterials: attachments.length > 0,
        submissionMode:
          this.safeString(metadata.materialSubmissionMode) ??
          (attachments.length > 0
            ? 'private_applicant_material_upload'
            : applicationChannel),
        portfolioUrlPresent: Boolean(this.safeString(application.portfolioUrl)),
        portfolioUrlCount: this.safeStringList(metadata.portfolioUrls).length,
      },
      review: {
        status: this.adminReviewStatus(application.status),
        consultationStatus: this.safeString(metadata.consultationStatus),
        consultationScheduledAt: this.safeString(metadata.consultationScheduledAt),
        rightsReviewRequired: this.safeBoolean(
          metadata.rightsReviewRequired,
          false,
        ),
        rightsReviewStatus: this.safeString(metadata.rightsReviewStatus),
        partnerReviewRequired: this.safeBoolean(
          metadata.partnerReviewRequired,
          false,
        ),
        partnerReviewStatus: this.safeString(metadata.partnerReviewStatus),
      },
      finalization: this.debutApplicationFinalizationContract(
        metadata,
        applicationType,
      ),
      organization: {
        entertainmentAgencyInquiry:
          this.debutOperationSegment(applicationType, metadata) ===
          'entertainment_agency',
        affiliatedOrgNamePresent: Boolean(this.safeString(metadata.affiliatedOrgName)),
        rightsRelationshipNotePresent: Boolean(
          this.safeString(metadata.rightsRelationshipNote),
        ),
        creatorExperienceNotePresent: Boolean(
          this.safeString(metadata.creatorExperienceNote),
        ),
      },
      operatorRouting: this.adminOperatorRouting(
        application,
        metadata,
        applicationChannel,
      ),
    };
  }

  private presentAdminDebutApplicationDetail(
    application: DebutApplicationAdminRecord,
  ) {
    const metadata = this.metadataObject(application.metadata);

    return {
      ...this.presentAdminDebutApplicationListItem(application),
      intro: application.intro,
      reviewNote: application.reviewNote,
      consents: {
        isAdult: application.isAdult,
        appearance: application.consentAppearance,
        voice: application.consentVoice,
        revenuePolicy: application.consentRevenuePolicy,
        privacy: application.consentPrivacy,
        marketing: application.consentMarketing,
      },
      portfolio: {
        urlPresent: Boolean(this.safeString(application.portfolioUrl)),
        urlCount: this.safeStringList(metadata.portfolioUrls).length,
      },
      attachments: application.attachments.map((attachment) =>
        this.presentAdminDebutApplicationAttachment(attachment),
      ),
    };
  }

  private presentAdminDebutApplicationAttachment(
    attachment: DebutApplicationAdminAttachmentRecord,
  ) {
    const metadata = this.metadataObject(attachment.metadata);
    const uploadIntent = this.metadataObject(metadata.uploadIntent);
    const lifecycle = this.metadataObject(metadata.lifecycle);

    return {
      id: attachment.id,
      category: attachment.category,
      materialType: attachment.category,
      sortOrder: attachment.sortOrder,
      status: attachment.status,
      privateMaterial: true,
      asset: {
        id: attachment.asset.id,
        assetType: attachment.asset.assetType,
        visibility: attachment.asset.visibility,
        mimeType: attachment.asset.mimeType,
        width: attachment.asset.width,
        height: attachment.asset.height,
        createdAt: attachment.asset.createdAt,
        updatedAt: attachment.asset.updatedAt,
      },
      upload: {
        status: this.safeString(uploadIntent.status),
        scope: this.safeString(uploadIntent.scope),
        category: this.safeString(uploadIntent.category),
      },
      lifecycle: {
        status: this.safeString(lifecycle.status),
      },
      privacy: {
        publicUrlReturned: false,
        signedReadUrlReturned: false,
        originalFileUrlReturned: false,
        storageKeyReturned: false,
      },
      createdAt: attachment.createdAt,
      updatedAt: attachment.updatedAt,
    };
  }

  private materialUploadPolicy() {
    return {
      visibility: 'private',
      scope: DEBUT_MATERIAL_SCOPE,
      publicUrlReturned: false,
      signedReadUrlReturned: false,
      categories: DEBUT_MATERIAL_CATEGORIES,
      maxBytes: {
        image: this.numberFromEnv('MAX_DEBUT_MATERIAL_IMAGE_BYTES', 20_971_520),
        audio: this.numberFromEnv('MAX_DEBUT_MATERIAL_AUDIO_BYTES', 52_428_800),
        video: this.numberFromEnv('MAX_DEBUT_MATERIAL_VIDEO_BYTES', 536_870_912),
        document: this.numberFromEnv('MAX_DEBUT_MATERIAL_DOCUMENT_BYTES', 20_971_520),
      },
    };
  }

  private phoneConsultationOperationsContract() {
    const operatorPhoneConfigured = Boolean(
      this.safeString(
        this.configService.get<string>('DEBUT_OPERATOR_PHONE_NUMBER'),
      ),
    );

    return {
      mode: 'operator_queue',
      operatorPhone: {
        configured: operatorPhoneConfigured,
        numberReturned: false,
        publicDisplayAllowed: false,
        fallbackWhenMissing: 'hide_public_phone',
      },
      sla: {
        messageKey: 'debut.phoneConsultation.sla.businessDayReview',
        labelKo:
          '\uC601\uC5C5\uC77C \uAE30\uC900 \uAC80\uD1A0 \uD6C4 \uC5F0\uB77D \uAC00\uB2A5 \uC2DC \uC5F0\uB77D',
        guaranteed: false,
        finalDebutOrContractGuaranteed: false,
      },
      dispatch: {
        externalSmsEnabled: false,
        externalEmailEnabled: false,
        autoPhoneCallEnabled: false,
        contractOnly: true,
      },
    };
  }

  private adminOperatorRouting(
    application: DebutApplicationAdminRecord,
    metadata: Record<string, unknown>,
    applicationChannel: string,
  ) {
    const applicationType =
      this.safeString(metadata.applicationType) ?? DEFAULT_APPLICATION_TYPE;
    const operationSegment = this.debutOperationSegment(applicationType, metadata);
    const finalization = this.debutApplicationFinalizationContract(
      metadata,
      applicationType,
    );
    const operations = this.phoneConsultationOperationsContract();
    const consultationStatus =
      this.safeString(metadata.consultationStatus) ?? 'pending';
    const emailPresent = Boolean(this.safeString(application.contactEmail));
    const phonePresent = Boolean(this.safeString(application.contactPhone));
    const preferredContactTimePresent = Boolean(
      this.safeString(metadata.preferredContactTime),
    );
    const consultationConsent = this.safeBoolean(
      metadata.consultationConsent,
      false,
    );
    const operatorAssigned = Boolean(
      this.safeString(metadata.operatorAssignedToUserId) ??
        this.safeString(metadata.operatorAssignedAt),
    );
    const phoneConsultation = applicationChannel === 'phone_consultation';
    const contactable =
      emailPresent || (phonePresent && (!phoneConsultation || consultationConsent));
    const status = this.adminReviewStatus(application.status);
    const notificationNeeded =
      phoneConsultation &&
      consultationStatus === 'pending' &&
      ['submitted', 'reviewing'].includes(status);

    return {
      queue:
        applicationChannel === 'online_review'
          ? 'online_review'
          : 'phone_consultation',
      queueSegment: operationSegment,
      reviewQueues: this.adminOperatorReviewQueues(
        applicationChannel,
        operationSegment,
        finalization,
      ),
      applicationChannel,
      contactAvailability: {
        contactable,
        phonePresent,
        emailPresent,
        preferredContactTimePresent,
        consultationConsent,
      },
      operatorAssignment: {
        assigned: operatorAssigned,
        assignedUserIdReturned: false,
        assignedDisplayNameReturned: false,
        assignedAtPresent: Boolean(this.safeString(metadata.operatorAssignedAt)),
        guidanceKey: operatorAssigned
          ? 'debut.operator.assignment.assigned'
          : 'debut.operator.assignment.missing',
      },
      consultation: {
        status: consultationStatus,
        pendingOperatorContact: phoneConsultation && consultationStatus === 'pending',
      },
      notification: {
        needed: notificationNeeded,
        reasonKey: notificationNeeded
          ? 'debut.operator.notification.phoneConsultation.pendingContact'
          : 'debut.operator.notification.none',
        channelsPlanned: ['admin_queue'],
        externalDispatch: {
          smsSent: false,
          emailSent: false,
          phoneCallPlaced: false,
          contractOnly: true,
        },
      },
      guidance: {
        operatorAssignmentMissing: !operatorAssigned,
        preferredContactTimeMissing:
          phoneConsultation && !preferredContactTimePresent,
        operatorPhoneMissing:
          phoneConsultation && !operations.operatorPhone.configured,
        rightsReviewPending: finalization.rightsReview.pending,
        partnerReviewPending: finalization.partnerReview.pending,
        messageKeys: [
          ...(!operatorAssigned ? ['debut.operator.assignment.missing'] : []),
          ...(phoneConsultation && !preferredContactTimePresent
            ? ['debut.operator.consultation.preferredTimeMissing']
            : []),
          ...(phoneConsultation && !operations.operatorPhone.configured
            ? ['debut.operator.phone.missing']
            : []),
          ...(finalization.rightsReview.pending
            ? ['debut.operator.rightsReview.pending']
            : []),
          ...(finalization.partnerReview.pending
            ? ['debut.operator.partnerReview.pending']
            : []),
        ],
      },
      finalization,
      phoneConsultationOperations: operations,
    };
  }

  private adminOperatorReviewQueues(
    applicationChannel: string,
    operationSegment: string,
    finalization: {
      rightsReview: { required: boolean };
      partnerReview: { required: boolean };
    },
  ) {
    return [
      applicationChannel === 'online_review'
        ? 'online_review'
        : 'phone_consultation',
      operationSegment,
      ...(finalization.rightsReview.required ? ['rights_review'] : []),
      ...(finalization.partnerReview.required ? ['partner_review'] : []),
    ];
  }

  private debutApplicationFinalizationContract(
    metadata: Record<string, unknown>,
    applicationType: string,
  ) {
    const rightsReviewRequired = this.safeBoolean(
      metadata.rightsReviewRequired,
      applicationType === 'represented_artist',
    );
    const rightsReviewStatus =
      this.safeString(metadata.rightsReviewStatus) ??
      (rightsReviewRequired ? 'pending' : 'not_required');
    const partnerReviewRequired = this.safeBoolean(
      metadata.partnerReviewRequired,
      applicationType === 'ai_creator_partner' ||
        applicationType === 'partnership_other',
    );
    const partnerReviewStatus =
      this.safeString(metadata.partnerReviewStatus) ??
      (partnerReviewRequired ? 'pending' : 'not_applicable');

    return {
      messageKey: 'debut.application.finalization.preContractReview',
      contractOnly: true,
      finalDebutConfirmed: false,
      contractFinalized: false,
      settlementFinalized: false,
      payoutEligible: false,
      walletMutationAllowed: false,
      luminaMutationAllowed: false,
      rightsReview: {
        required: rightsReviewRequired,
        status: rightsReviewStatus,
        pending:
          rightsReviewRequired &&
          !['cleared', 'not_required'].includes(rightsReviewStatus),
      },
      partnerReview: {
        required: partnerReviewRequired,
        status: partnerReviewStatus,
        pending:
          partnerReviewRequired &&
          !['accepted', 'not_applicable'].includes(partnerReviewStatus),
      },
    };
  }

  private presentPrivateMaterialAsset(asset: {
    id: string;
    assetType: string;
    visibility: string;
    mimeType: string;
    fileSizeBytes: bigint | null;
    width: number | null;
    height: number | null;
    metadata: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const metadata = this.metadataObject(asset.metadata);
    const uploadIntent = this.metadataObject(metadata.uploadIntent);
    const lifecycle = this.metadataObject(metadata.lifecycle);

    return {
      id: asset.id,
      category:
        typeof uploadIntent.category === 'string' ? uploadIntent.category : null,
      assetType: asset.assetType,
      visibility: asset.visibility,
      mimeType: asset.mimeType,
      fileSizeBytes: asset.fileSizeBytes?.toString() ?? null,
      width: asset.width,
      height: asset.height,
      uploadStatus:
        typeof uploadIntent.status === 'string' ? uploadIntent.status : 'ready',
      lifecycleStatus:
        typeof lifecycle.status === 'string' ? lifecycle.status : 'active',
      publicUrl: null,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    };
  }

  private async findOwnedDebutMaterialAsset(userId: string, assetId: string) {
    if (!UUID_PATTERN.test(assetId)) {
      throw this.badRequest(
        'DEBUT_MATERIAL_INVALID_ASSET_ID',
        'assetId must be a UUID.',
        'debut.material.invalidAssetId',
      );
    }

    const asset = await this.prisma.asset.findFirst({
      where: {
        id: assetId,
        metadata: {
          path: ['uploadIntent', 'createdByUserId'],
          equals: userId,
        },
      },
    });

    if (!asset) {
      throw new NotFoundException({
        code: 'DEBUT_MATERIAL_NOT_FOUND',
        message: 'Debut material asset not found.',
        messageKey: 'debut.material.notFound',
      });
    }

    const metadata = this.metadataObject(asset.metadata);
    const uploadIntent = this.metadataObject(metadata.uploadIntent);

    if (uploadIntent.scope !== DEBUT_MATERIAL_SCOPE) {
      throw this.badRequest(
        'DEBUT_MATERIAL_INVALID_SCOPE',
        'Asset is not a debut application material.',
        'debut.material.invalidScope',
      );
    }

    return asset;
  }

  private materialCategory(value: string) {
    if (
      !DEBUT_MATERIAL_CATEGORIES.includes(
        value as (typeof DEBUT_MATERIAL_CATEGORIES)[number],
      )
    ) {
      throw this.badRequest(
        'DEBUT_MATERIAL_CATEGORY_INVALID',
        'Debut material category is not supported.',
        'debut.material.categoryInvalid',
      );
    }

    return value as (typeof DEBUT_MATERIAL_CATEGORIES)[number];
  }

  private materialMimeType(
    category: (typeof DEBUT_MATERIAL_CATEGORIES)[number],
    rawMimeType: string,
  ) {
    const mimeType = rawMimeType.trim().toLowerCase();
    const allowed = MATERIAL_CATEGORY_MIME_PREFIXES[category];
    const matches = allowed.some((prefix) =>
      prefix.endsWith('/') ? mimeType.startsWith(prefix) : mimeType === prefix,
    );

    if (!matches) {
      throw this.badRequest(
        'DEBUT_MATERIAL_MIME_TYPE_INVALID',
        'Debut material mimeType is not allowed for this category.',
        'debut.material.mimeTypeInvalid',
        { category },
      );
    }

    return mimeType;
  }

  private assetTypeFromMimeType(mimeType: string) {
    if (mimeType.startsWith('image/')) {
      return 'image';
    }

    if (mimeType.startsWith('audio/')) {
      return 'audio';
    }

    if (mimeType.startsWith('video/')) {
      return 'video';
    }

    if (mimeType === 'application/pdf') {
      return 'document';
    }

    throw this.badRequest(
      'DEBUT_MATERIAL_MIME_TYPE_INVALID',
      'Debut material mimeType is not allowed.',
      'debut.material.mimeTypeInvalid',
    );
  }

  private materialFileSizeBytes(value: number, assetType: string) {
    const size = Number(value);
    const max = this.maxMaterialFileSizeBytes(assetType);

    if (!Number.isInteger(size) || size < 1) {
      throw this.badRequest(
        'DEBUT_MATERIAL_FILE_SIZE_INVALID',
        'fileSizeBytes must be a positive integer.',
        'debut.material.fileSizeInvalid',
      );
    }

    if (size > max) {
      throw this.badRequest(
        'DEBUT_MATERIAL_FILE_TOO_LARGE',
        'Debut material file is too large.',
        'debut.material.fileTooLarge',
        { maxBytes: max },
      );
    }

    return BigInt(size);
  }

  private maxMaterialFileSizeBytes(assetType: string) {
    return assetType === 'video'
      ? this.numberFromEnv('MAX_DEBUT_MATERIAL_VIDEO_BYTES', 536_870_912)
      : assetType === 'audio'
        ? this.numberFromEnv('MAX_DEBUT_MATERIAL_AUDIO_BYTES', 52_428_800)
        : assetType === 'document'
          ? this.numberFromEnv('MAX_DEBUT_MATERIAL_DOCUMENT_BYTES', 20_971_520)
          : this.numberFromEnv('MAX_DEBUT_MATERIAL_IMAGE_BYTES', 20_971_520);
  }

  private safeFileName(fileName: string) {
    const cleaned = fileName
      .normalize('NFKD')
      .replace(/[^\w.\-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .toLowerCase();

    if (!cleaned || !cleaned.includes('.')) {
      throw this.badRequest(
        'DEBUT_MATERIAL_FILE_NAME_INVALID',
        'fileName must include a safe extension.',
        'debut.material.fileNameInvalid',
      );
    }

    return cleaned.slice(0, 120);
  }

  private buildStorageKey(assetType: string, fileName: string) {
    const date = new Date();
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const prefix = this.storageKeyPrefix();
    const path = `uploads/user-images/${yyyy}/${mm}/${dd}/${randomUUID()}-debut-material-${assetType}-${fileName}`;

    return prefix ? `${prefix}/${path}` : path;
  }

  private buildUploadUrl(
    storageProvider: string,
    storageKey: string,
    expiresInSeconds: number,
    mimeType: string,
  ) {
    if (storageProvider === 'r2' || storageProvider === 's3') {
      return this.buildS3CompatiblePresignedPutUrl(
        storageProvider,
        storageKey,
        expiresInSeconds,
        mimeType,
      );
    }

    if (storageProvider !== 'local') {
      throw this.badRequest(
        'DEBUT_MATERIAL_STORAGE_PROVIDER_INVALID',
        'OBJECT_STORAGE_PROVIDER must be local, r2, or s3.',
        'debut.material.storageProviderInvalid',
      );
    }

    return `/pending-local-upload/${storageKey}`;
  }

  private async assertObjectUploaded(
    storageProvider: string,
    storageKey: string,
    expectedMimeType: string,
    maxBytes: number,
  ) {
    if (storageProvider === 'local') {
      return;
    }

    if (storageProvider === 'r2' || storageProvider === 's3') {
      const response = await fetch(
        this.buildS3CompatibleSignedHeadUrl(storageProvider, storageKey),
        { method: 'HEAD' },
      );

      if (response.status === 404) {
        throw this.badRequest(
          'DEBUT_MATERIAL_OBJECT_NOT_FOUND',
          'Uploaded object was not found in storage.',
          'debut.material.objectNotFound',
        );
      }

      if (!response.ok) {
        throw this.badRequest(
          'DEBUT_MATERIAL_OBJECT_VERIFY_FAILED',
          'Could not verify uploaded object.',
          'debut.material.objectVerifyFailed',
        );
      }

      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw this.badRequest(
          'DEBUT_MATERIAL_FILE_TOO_LARGE',
          'Debut material file is too large.',
          'debut.material.fileTooLarge',
          { maxBytes },
        );
      }

      const objectMimeType = response.headers
        .get('content-type')
        ?.split(';')[0]
        .trim()
        .toLowerCase();
      if (objectMimeType && objectMimeType !== expectedMimeType) {
        throw this.badRequest(
          'DEBUT_MATERIAL_OBJECT_MIME_TYPE_INVALID',
          'Uploaded object content type does not match the upload intent.',
          'debut.material.objectMimeTypeInvalid',
        );
      }

      return;
    }

    throw this.badRequest(
      'DEBUT_MATERIAL_STORAGE_PROVIDER_INVALID',
      'OBJECT_STORAGE_PROVIDER must be local, r2, or s3.',
      'debut.material.storageProviderInvalid',
    );
  }

  private status(value: string) {
    const normalized = value.trim() === 'under_review' ? 'reviewing' : value.trim();
    if (!APPLICATION_STATUSES.has(normalized)) {
      throw new BadRequestException(
        'status must be submitted, reviewing, needs_more_info, approved_for_contact, rejected, or archived',
      );
    }

    return normalized;
  }

  private adminReviewStatus(status: string): AdminDebutApplicationStatus {
    return ADMIN_APPLICATION_STATUS_ALIASES[status] ?? this.adminStatusOrDefault(status);
  }

  private adminWritableStatus(status: string): AdminDebutApplicationStatus {
    if (!APPLICATION_STATUSES.has(status)) {
      throw this.badRequest(
        'DEBUT_ADMIN_STATUS_INVALID',
        'Invalid debut application admin status.',
        'debut.admin.status.invalid',
        { status },
      );
    }

    return this.adminReviewStatus(status);
  }

  private userReviewStatus(status: string): UserDebutApplicationStatus {
    return USER_APPLICATION_STATUS_ALIASES[status] ?? this.userStatusOrDefault(status);
  }

  private adminStatusOrDefault(status: string): AdminDebutApplicationStatus {
    return ADMIN_DEBUT_APPLICATION_STATUS_CANDIDATES.includes(
      status as AdminDebutApplicationStatus,
    )
      ? (status as AdminDebutApplicationStatus)
      : 'submitted';
  }

  private userStatusOrDefault(status: string): UserDebutApplicationStatus {
    return USER_DEBUT_APPLICATION_STATUS_CANDIDATES.includes(
      status as UserDebutApplicationStatus,
    )
      ? (status as UserDebutApplicationStatus)
      : 'submitted';
  }

  private clean<T extends Record<string, unknown>>(input: T) {
    return Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ) as T;
  }

  private metadataObject(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private safeString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private safeStringList(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => this.safeString(item))
      .filter((item): item is string => item !== null);
  }

  private safeDateString(value: unknown) {
    const text = this.safeString(value);
    if (!text) {
      return null;
    }

    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private safeBoolean(value: unknown, fallback: boolean) {
    return typeof value === 'boolean' ? value : fallback;
  }

  private maskEmail(value: unknown) {
    const email = this.safeString(value);
    if (!email) {
      return null;
    }

    const [local, domain] = email.split('@');
    if (!domain) {
      return this.maskText(email);
    }

    return `${local.slice(0, 1)}${'*'.repeat(Math.max(local.length - 1, 3))}@${domain}`;
  }

  private maskPhone(value: unknown) {
    const phone = this.safeString(value);
    if (!phone) {
      return null;
    }

    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7) {
      return this.maskText(phone);
    }

    return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
  }

  private maskText(value: string) {
    if (value.length <= 2) {
      return '*'.repeat(value.length);
    }

    return `${value.slice(0, 1)}${'*'.repeat(value.length - 2)}${value.slice(-1)}`;
  }

  private assertAdminUpdateContract(input: AdminUpdateDebutApplicationDto) {
    if (input.shareTierApproved !== undefined) {
      throw this.badRequest(
        'DEBUT_ADMIN_FINAL_SHARE_UPDATE_NOT_OPEN',
        'Final debut share updates are not open in this operations review contract.',
        'debut.admin.finalShareUpdateNotOpen',
        {
          contractOnly: true,
          settlementMutation: false,
          payoutMutation: false,
          walletMutation: false,
          luminaMutation: false,
        },
      );
    }
  }

  private badRequest(
    code: string,
    message: string,
    messageKey: string,
    details?: unknown,
  ) {
    return new BadRequestException({ code, message, messageKey, details });
  }

  private notFound(
    code: string,
    message: string,
    messageKey: string,
    details?: unknown,
  ) {
    return new NotFoundException({ code, message, messageKey, details });
  }

  private recordAudit(
    user: AuthUser,
    targetId: string,
    beforeData: unknown,
    afterData: unknown,
    actorType = 'admin',
    action = 'debut_application.update',
    auditSummary = this.debutApplicationAuditSummary(beforeData, afterData),
  ) {
    return this.prisma.auditEvent.create({
      data: {
        actorUserId: user.id,
        actorType,
        action,
        targetType: 'debut_application',
        targetId,
        beforeData: this.toJson(auditSummary.beforeData),
        afterData: this.toJson(auditSummary.afterData),
        metadata: this.toJson(auditSummary.metadata),
      },
    });
  }

  private debutApplicationAuditSummary(beforeData: unknown, afterData: unknown) {
    const beforeSnapshot = this.debutApplicationAuditSnapshot(beforeData);
    const afterSnapshot = this.debutApplicationAuditSnapshot(afterData);

    return {
      beforeData: beforeSnapshot,
      afterData: afterSnapshot,
      metadata: {
        contractVersion: '2026-05-19.debut-ops-audit-v1',
        changedFields: this.debutApplicationAuditChangedFields(
          beforeSnapshot,
          afterSnapshot,
        ),
        redaction: {
          contactStored: false,
          introStored: false,
          internalAdminNotesStored: false,
          privateMaterialUrlsStored: false,
          storageKeysStored: false,
          objectETagsStored: false,
          rawTokenStored: false,
          secretStored: false,
        },
        mutationPolicy: {
          finalDebutMutation: false,
          contractMutation: false,
          settlementMutation: false,
          payoutMutation: false,
          walletMutation: false,
          luminaMutation: false,
        },
      },
    };
  }

  private debutApplicationAuditSnapshot(value: unknown) {
    const record = this.metadataObject(value);
    const metadata = this.metadataObject(record.metadata);
    const attachments = Array.isArray(record.attachments) ? record.attachments : [];
    const status = this.safeString(record.status) ?? 'submitted';
    const applicationType =
      this.safeString(metadata.applicationType) ?? DEFAULT_APPLICATION_TYPE;
    const materialCategories = [
      ...new Set(
        attachments
          .map((attachment) => this.safeString(this.metadataObject(attachment).category))
          .filter((category): category is string => category !== null),
      ),
    ];

    return {
      id: this.safeString(record.id),
      status: this.adminReviewStatus(status),
      userStatus: this.userReviewStatus(status),
      applicationChannel:
        this.safeString(metadata.applicationChannel) ?? 'phone_consultation',
      applicationType,
      operationSegment: this.debutOperationSegment(applicationType, metadata),
      consultationStatus: this.safeString(metadata.consultationStatus),
      rightsReviewRequired: this.safeBoolean(metadata.rightsReviewRequired, false),
      rightsReviewStatus: this.safeString(metadata.rightsReviewStatus),
      partnerReviewRequired: this.safeBoolean(metadata.partnerReviewRequired, false),
      partnerReviewStatus: this.safeString(metadata.partnerReviewStatus),
      publicNotice: {
        publicReasonPresent: Boolean(this.safeString(metadata.publicStatusReason)),
        requestedActionKey: this.safeString(metadata.requestedActionKey),
      },
      internalNotes: {
        reviewNotePresent: Boolean(this.safeString(record.reviewNote)),
        consultationNotePresent: Boolean(this.safeString(metadata.consultationNote)),
        rightsReviewNotePresent: Boolean(this.safeString(metadata.rightsReviewNote)),
        partnerReviewNotePresent: Boolean(this.safeString(metadata.partnerReviewNote)),
      },
      privateMaterials: {
        count: attachments.length,
        categories: materialCategories,
        metadataOnly: true,
        publicUrlReturned: false,
        signedReadUrlReturned: false,
        originalFileUrlReturned: false,
        storageKeyReturned: false,
        objectETagReturned: false,
      },
      finalization: this.debutApplicationFinalizationContract(
        metadata,
        applicationType,
      ),
    };
  }

  private debutApplicationAuditChangedFields(
    beforeSnapshot: Record<string, unknown>,
    afterSnapshot: Record<string, unknown>,
  ) {
    const fields = [
      'status',
      'userStatus',
      'applicationChannel',
      'applicationType',
      'operationSegment',
      'consultationStatus',
      'rightsReviewRequired',
      'rightsReviewStatus',
      'partnerReviewRequired',
      'partnerReviewStatus',
      'publicNotice',
      'internalNotes',
      'privateMaterials',
      'finalization',
    ];

    return fields.filter(
      (field) =>
        JSON.stringify(beforeSnapshot[field]) !== JSON.stringify(afterSnapshot[field]),
    );
  }

  private toJson(value: unknown) {
    if (value === null || value === undefined) {
      return Prisma.JsonNull;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private buildS3CompatiblePresignedPutUrl(
    storageProvider: string,
    storageKey: string,
    expiresInSeconds: number,
    mimeType: string,
  ) {
    const bucket = this.envString('OBJECT_STORAGE_BUCKET');
    const region = this.configService.get<string>('OBJECT_STORAGE_REGION') ?? 'auto';
    const accessKeyId = this.envString('OBJECT_STORAGE_ACCESS_KEY_ID');
    const secretAccessKey = this.envString('OBJECT_STORAGE_SECRET_ACCESS_KEY');
    const now = new Date();
    const amzDate = this.amzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const endpoint = this.buildObjectStorageEndpoint(storageProvider, bucket, region);
    const url = new URL(this.joinUrlPath(endpoint, storageKey));
    const credential = `${accessKeyId}/${scope}`;
    const signedHeaders = 'content-type;host';
    const query: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresInSeconds),
      'X-Amz-SignedHeaders': signedHeaders,
    };
    const canonicalQuery = this.canonicalQueryString(query);
    const canonicalRequest = [
      'PUT',
      this.canonicalUri(url.pathname),
      canonicalQuery,
      `content-type:${mimeType}\n` + `host:${url.host}\n`,
      signedHeaders,
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      this.sha256Hex(canonicalRequest),
    ].join('\n');
    const signature = this.hmacHex(
      this.signingKey(secretAccessKey, dateStamp, region, 's3'),
      stringToSign,
    );

    url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;
    return url.toString();
  }

  private buildS3CompatibleSignedHeadUrl(storageProvider: string, storageKey: string) {
    const bucket = this.envString('OBJECT_STORAGE_BUCKET');
    const region = this.configService.get<string>('OBJECT_STORAGE_REGION') ?? 'auto';
    const accessKeyId = this.envString('OBJECT_STORAGE_ACCESS_KEY_ID');
    const secretAccessKey = this.envString('OBJECT_STORAGE_SECRET_ACCESS_KEY');
    const now = new Date();
    const amzDate = this.amzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const endpoint = this.buildObjectStorageEndpoint(storageProvider, bucket, region);
    const url = new URL(this.joinUrlPath(endpoint, storageKey));
    const credential = `${accessKeyId}/${scope}`;
    const signedHeaders = 'host';
    const query: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': '60',
      'X-Amz-SignedHeaders': signedHeaders,
    };
    const canonicalQuery = this.canonicalQueryString(query);
    const canonicalRequest = [
      'HEAD',
      this.canonicalUri(url.pathname),
      canonicalQuery,
      `host:${url.host}\n`,
      signedHeaders,
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      this.sha256Hex(canonicalRequest),
    ].join('\n');
    const signature = this.hmacHex(
      this.signingKey(secretAccessKey, dateStamp, region, 's3'),
      stringToSign,
    );

    url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;
    return url.toString();
  }

  private buildObjectStorageEndpoint(
    storageProvider: string,
    bucket: string,
    region: string,
  ) {
    if (storageProvider === 's3') {
      return `https://${bucket}.s3.${region}.amazonaws.com`;
    }

    const configuredEndpoint = this.configService.get<string>('OBJECT_STORAGE_ENDPOINT');

    if (configuredEndpoint) {
      const endpoint = configuredEndpoint.replace(/\/+$/g, '');
      return endpoint.includes(bucket) ? endpoint : `${endpoint}/${bucket}`;
    }

    throw this.badRequest(
      'DEBUT_MATERIAL_OBJECT_STORAGE_ENDPOINT_REQUIRED',
      'OBJECT_STORAGE_ENDPOINT is required for r2 storage.',
      'debut.material.objectStorageEndpointRequired',
    );
  }

  private joinUrlPath(base: string, path: string) {
    return `${base.replace(/\/+$/g, '')}/${path
      .split('/')
      .map((part) => this.rfc3986Encode(part))
      .join('/')}`;
  }

  private canonicalUri(pathname: string) {
    return pathname
      .split('/')
      .map((part) => this.rfc3986Encode(decodeURIComponent(part)))
      .join('/');
  }

  private canonicalQueryString(query: Record<string, string>) {
    return Object.entries(query)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${this.rfc3986Encode(key)}=${this.rfc3986Encode(value)}`)
      .join('&');
  }

  private rfc3986Encode(value: string) {
    return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  }

  private amzDate(date: Date) {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  }

  private sha256Hex(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private signingKey(secretAccessKey: string, dateStamp: string, region: string, service: string) {
    const dateKey = this.hmacBuffer(`AWS4${secretAccessKey}`, dateStamp);
    const dateRegionKey = this.hmacBuffer(dateKey, region);
    const dateRegionServiceKey = this.hmacBuffer(dateRegionKey, service);
    return this.hmacBuffer(dateRegionServiceKey, 'aws4_request');
  }

  private hmacBuffer(key: string | Buffer, value: string) {
    return createHmac('sha256', key).update(value).digest();
  }

  private hmacHex(key: string | Buffer, value: string) {
    return createHmac('sha256', key).update(value).digest('hex');
  }

  private envString(key: string) {
    const value = this.configService.get<string>(key);

    if (!value) {
      throw this.badRequest(
        'DEBUT_MATERIAL_STORAGE_ENV_REQUIRED',
        `${key} environment variable is required.`,
        'debut.material.storageEnvRequired',
        { key },
      );
    }

    return value;
  }

  private storageKeyPrefix() {
    const value = this.configService.get<string>('OBJECT_STORAGE_KEY_PREFIX');

    if (!value) {
      return '';
    }

    return value
      .trim()
      .replace(/^\/+|\/+$/g, '')
      .replace(/\/+/g, '/')
      .split('/')
      .map((part) =>
        part
          .normalize('NFKD')
          .replace(/[^\w.\-]+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^[-.]+|[-.]+$/g, '')
          .toLowerCase(),
      )
      .filter(Boolean)
      .join('/');
  }

  private numberFromEnv(key: string, fallback: number) {
    const value = this.configService.get<string>(key);

    if (!value) {
      return fallback;
    }

    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed < 1) {
      throw this.badRequest(
        'DEBUT_MATERIAL_STORAGE_ENV_INVALID',
        `${key} must be a positive number.`,
        'debut.material.storageEnvInvalid',
        { key },
      );
    }

    return parsed;
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
      operationSegment: this.debutOperationSegmentFromApplicationType(applicationType),
      affiliatedOrgName: input.affiliatedOrgName ?? null,
      rightsRelationshipNote: input.rightsRelationshipNote ?? null,
      creatorExperienceNote: input.creatorExperienceNote ?? null,
      rightsReviewRequired,
      rightsReviewStatus: rightsReviewRequired ? 'pending' : 'not_required',
      partnerReviewRequired,
      partnerReviewStatus: partnerReviewRequired ? 'pending' : 'not_applicable',
      preferredContactTime: input.preferredContactTime ?? null,
      consultationConsent: input.consultationConsent ?? null,
      consentMarketing: this.optionalConsentMarketing(input),
      consultationStatus: 'pending',
      materialSubmissionMode: this.attachmentRequests(input).length
        ? 'private_applicant_material_upload'
        : 'no_file_upload_mvp',
      artistDebutMode: input.artistDebutMode ?? null,
      contribution: {
        providesAppearance: input.providesAppearance ?? false,
        providesBodyOrMotion: input.providesBodyOrMotion ?? false,
        providesSinging: input.providesSinging ?? false,
        providesVoice: input.providesVoice ?? false,
        providesDance: input.providesDance ?? false,
        providesWorldview: input.providesWorldview ?? false,
        canCommunicateWithFans: input.canCommunicateWithFans ?? false,
        canCreateContent: input.canCreateContent ?? false,
        otherContributionText: input.otherContributionText ?? null,
      },
      policyAcceptances: {
        genderSwapRequested: input.genderSwapRequested ?? false,
        genderPolicyAccepted: input.genderPolicyAccepted ?? false,
        revenueShareNoticeAccepted: input.revenueShareNoticeAccepted ?? false,
        portraitVoiceMotionRightsAccepted:
          input.portraitVoiceMotionRightsAccepted ?? false,
        privacyReviewNoticeAccepted: input.privacyReviewNoticeAccepted ?? false,
      },
      portfolioUrls: this.portfolioUrls(input),
      shareRate: {
        estimatedShareRate: input.shareTierRequested ?? null,
        finalShareRate: null,
        autoFinalization: false,
      },
    });
  }

  private resubmissionMetadata(
    current: Prisma.JsonValue,
    input: CreateDebutApplicationDto,
    resubmittedAt: string,
  ) {
    const currentMetadata = this.metadataObject(current);
    const nextMetadata = this.metadataObject(
      this.applicationMetadata(input) as unknown as Prisma.JsonValue,
    );
    const resubmissionCount =
      Number(currentMetadata.resubmissionCount ?? 0) >= 0
        ? Number(currentMetadata.resubmissionCount ?? 0) + 1
        : 1;

    return this.toJson({
      ...nextMetadata,
      publicStatusReason: null,
      requestedActionKey: null,
      lastResubmittedAt: resubmittedAt,
      resubmissionCount,
      resubmissionPolicyVersion: '2026-05-20.debut-resubmission-v1',
      lastResubmission: {
        source: 'applicant',
        at: resubmittedAt,
        endpoint: DEBUT_RESUBMISSION_ENDPOINT,
        replacementMode: 'full_application',
        createsNewApplication: false,
        previousPublicReasonPresent: Boolean(
          this.safeString(currentMetadata.publicStatusReason),
        ),
        previousRequestedActionKey:
          this.safeString(currentMetadata.requestedActionKey) ?? null,
      },
    });
  }

  private portfolioUrls(input: CreateDebutApplicationDto) {
    const values = [
      ...(input.portfolioUrl ? [input.portfolioUrl] : []),
      ...(input.portfolioUrls ?? []),
    ];
    const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];

    return unique.map((value) => {
      let url: URL;

      try {
        url = new URL(value);
      } catch {
        throw this.badRequest(
          'DEBUT_PORTFOLIO_URL_INVALID',
          'portfolioUrls must contain valid HTTPS URLs.',
          'debut.portfolioUrl.invalid',
        );
      }

      if (url.protocol !== 'https:') {
        throw this.badRequest(
          'DEBUT_PORTFOLIO_URL_INVALID',
          'portfolioUrls must contain valid HTTPS URLs.',
          'debut.portfolioUrl.invalid',
        );
      }

      url.hash = '';
      return url.toString();
    });
  }

  private optionalConsentMarketing(input: CreateDebutApplicationDto) {
    if (input.consentMarketing !== undefined) {
      return input.consentMarketing;
    }

    const metadataConsent = input.metadata?.consentMarketing;
    return typeof metadataConsent === 'boolean' ? metadataConsent : false;
  }

  private debutOperationSegment(applicationType: string, metadata: Record<string, unknown>) {
    const storedSegment = this.safeString(metadata.operationSegment);
    if (
      storedSegment &&
      DEBUT_OPERATION_SEGMENTS.includes(
        storedSegment as (typeof DEBUT_OPERATION_SEGMENTS)[number],
      )
    ) {
      return storedSegment;
    }

    return this.debutOperationSegmentFromApplicationType(applicationType);
  }

  private debutOperationSegmentFromApplicationType(applicationType: string) {
    if (applicationType === 'represented_artist') {
      return 'entertainment_agency';
    }

    if (
      applicationType === 'ai_creator_partner' ||
      applicationType === 'partnership_other'
    ) {
      return 'partner';
    }

    return 'individual';
  }

  private debutOperationSegmentWhere(segment: string): Prisma.DebutApplicationWhereInput {
    switch (segment) {
      case 'entertainment_agency':
        return {
          OR: [
            { metadata: { path: ['operationSegment'], equals: 'entertainment_agency' } },
            { metadata: { path: ['applicationType'], equals: 'represented_artist' } },
            { metadata: { path: ['rightsReviewRequired'], equals: true } },
          ],
        };
      case 'partner':
        return {
          OR: [
            { metadata: { path: ['operationSegment'], equals: 'partner' } },
            { metadata: { path: ['applicationType'], equals: 'ai_creator_partner' } },
            { metadata: { path: ['applicationType'], equals: 'partnership_other' } },
            { metadata: { path: ['partnerReviewRequired'], equals: true } },
          ],
        };
      case 'individual':
      default:
        return {
          OR: [
            { metadata: { path: ['operationSegment'], equals: 'individual' } },
            { metadata: { path: ['applicationType'], equals: 'personal_unaffiliated' } },
          ],
        };
    }
  }

  private debutApplicationWhere(input: {
    status?: string;
    applicationChannel?: string;
    applicationType?: string;
    operationSegment?: string;
    rightsReviewRequired?: boolean;
    partnerReviewRequired?: boolean;
    consultationStatus?: string;
    query?: string;
  }) {
    const filters: Prisma.DebutApplicationWhereInput[] = [];

    if (input.status) {
      const statusValues = this.debutApplicationStatusValues(input.status);
      filters.push(
        statusValues.length === 1
          ? { status: statusValues[0] }
          : { OR: statusValues.map((status) => ({ status })) },
      );
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

    if (input.operationSegment) {
      filters.push(this.debutOperationSegmentWhere(input.operationSegment));
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

  private debutApplicationStatusValues(status: string) {
    switch (status) {
      case 'reviewing':
      case 'under_review':
        return ['reviewing', 'under_review'];
      case 'approved_for_contact':
      case 'approved':
        return ['approved_for_contact', 'approved'];
      case 'archived':
      case 'withdrawn':
        return ['archived', 'withdrawn'];
      default:
        return [status];
    }
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
      input.partnerReviewNote === undefined &&
      input.publicStatusReason === undefined &&
      input.requestedActionKey === undefined
    ) {
      return undefined;
    }

    return this.mergeMetadata(current, {
      ...(input.publicStatusReason === undefined
        ? {}
        : { publicStatusReason: input.publicStatusReason }),
      ...(input.requestedActionKey === undefined
        ? {}
        : { requestedActionKey: input.requestedActionKey }),
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

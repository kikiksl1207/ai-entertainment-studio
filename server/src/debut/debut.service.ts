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
  DEBUT_MATERIAL_CATEGORIES,
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
const DEFAULT_PARTICIPATION_TYPE = 'appearance_only';
const DEBUT_MATERIAL_SCOPE = 'debut_application_material';
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
            'Private review mode for applicants who want to submit images, voice, video, or portfolio materials online.',
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
      throw new BadRequestException('isAdult must be true for MVP debut applications');
    }

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
      throw new BadRequestException('contactEmail is required');
    }

    const intro = input.intro ?? input.selfIntroduction;
    if (!intro) {
      throw new BadRequestException('intro is required');
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
    const applicationType = input.applicationType ?? DEFAULT_APPLICATION_TYPE;
    const required =
      applicationType === 'partnership_other'
        ? ['consentPrivacy']
        : ['consentAppearance', 'consentRevenuePolicy', 'consentPrivacy'];

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

  private assertIntroPolicy(input: CreateDebutApplicationDto) {
    const intro = input.intro ?? input.selfIntroduction ?? '';
    const minLength =
      (input.applicationType ?? DEFAULT_APPLICATION_TYPE) === 'partnership_other' ? 10 : 20;

    if (intro.trim().length < minLength) {
      throw new BadRequestException(`intro must be at least ${minLength} characters`);
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

  private metadataObject(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private badRequest(
    code: string,
    message: string,
    messageKey: string,
    details?: unknown,
  ) {
    return new BadRequestException({ code, message, messageKey, details });
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

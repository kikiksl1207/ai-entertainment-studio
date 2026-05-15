import { DebutService } from './debut.service';

const userId = '00000000-0000-4000-8000-000000000001';
const assetId = '00000000-0000-4000-8000-000000000101';
const createdAt = new Date('2026-05-13T00:00:00.000Z');

type PrismaMock = {
  asset: {
    create: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
  debutApplication: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  auditEvent: {
    create: jest.Mock;
  };
  $transaction: jest.Mock;
};

function createPrismaMock(): PrismaMock {
  const prisma: PrismaMock = {
    asset: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    debutApplication: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    auditEvent: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (tx: PrismaMock) => Promise<unknown>) => callback(prisma),
  );
  prisma.asset.create.mockImplementation(({ data }) => ({
    id: assetId,
    ...data,
    createdAt,
    updatedAt: createdAt,
  }));
  prisma.asset.update.mockImplementation(({ data }) => ({
    id: assetId,
    assetType: 'image',
    visibility: 'private',
    storageProvider: 'local',
    storageKey: 'uploads/user-images/2026/05/13/test-debut-material-image.png',
    mimeType: 'image/png',
    fileSizeBytes: BigInt(1024),
    width: null,
    height: null,
    metadata: data.metadata,
    createdAt,
    updatedAt: data.updatedAt,
  }));
  prisma.debutApplication.create.mockImplementation(({ data }) => ({
    id: '00000000-0000-4000-8000-000000000201',
    ...data,
    attachments: data.attachments?.create ?? [],
    createdAt,
    updatedAt: createdAt,
  }));

  return prisma;
}

function serviceWith(prisma: PrismaMock) {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'OBJECT_STORAGE_PROVIDER') {
        return 'local';
      }

      return undefined;
    }),
  };

  return new DebutService(prisma as never, config as never);
}

function materialAsset(status = 'uploaded', category = 'face_photo') {
  return {
    id: assetId,
    assetType: 'image',
    visibility: 'private',
    storageProvider: 'local',
    storageKey: 'uploads/user-images/2026/05/13/test-debut-material-image.png',
    mimeType: 'image/png',
    fileSizeBytes: BigInt(1024),
    width: null,
    height: null,
    durationSeconds: null,
    checksum: null,
    metadata: {
      uploadIntent: {
        status,
        scope: 'debut_application_material',
        category,
        createdByUserId: userId,
      },
    },
    createdAt,
    updatedAt: createdAt,
  };
}

function validApplicationInput(overrides: Record<string, unknown> = {}) {
  return {
    applicationChannel: 'online_review',
    applicationType: 'personal_unaffiliated',
    applicantName: 'Applicant',
    contactEmail: 'applicant@example.com',
    contactPhone: '010-0000-0000',
    consultationConsent: true,
    isAdult: true,
    participationType: 'appearance_only',
    intro: 'This is a long enough debut application introduction.',
    consentAppearance: true,
    consentRevenuePolicy: true,
    consentPrivacy: true,
    genderSwapRequested: false,
    facePhotoAssetIds: [assetId],
    portfolioUrls: ['https://example.com/portfolio#private-fragment'],
    ...overrides,
  };
}

function adminApplication(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000301',
    userId,
    applicantName: 'Applicant',
    displayName: 'Stage Name',
    contactEmail: 'applicant@example.com',
    contactPhone: '010-1234-5678',
    isAdult: true,
    participationType: 'appearance_only',
    shareTierRequested: null,
    shareTierApproved: null,
    intro: 'This is a private debut application introduction.',
    portfolioUrl: 'https://example.com/private-portfolio',
    status: 'approved',
    reviewNote: 'Internal review note',
    consentAppearance: true,
    consentVoice: false,
    consentRevenuePolicy: true,
    consentPrivacy: true,
    consentMarketing: false,
    metadata: {
      applicationChannel: 'online_review',
      applicationType: 'personal_unaffiliated',
      materialSubmissionMode: 'private_applicant_material_upload',
      portfolioUrls: ['https://example.com/private-portfolio'],
      preferredContactTime: 'weekday afternoon',
      rightsReviewRequired: false,
      partnerReviewRequired: false,
      storageKey: 'private/storage-key-must-not-leak',
    },
    user: {
      id: userId,
      email: 'user@example.com',
      status: 'active',
      profile: { displayName: 'User Profile' },
    },
    attachments: [
      {
        id: '00000000-0000-4000-8000-000000000401',
        category: 'face_photo',
        sortOrder: 0,
        status: 'attached',
        metadata: {
          uploadIntent: {
            status: 'uploaded',
            scope: 'debut_application_material',
            category: 'face_photo',
            storageKey: 'private/attachment-key-must-not-leak',
            objectETag: 'blocked-etag-sample',
          },
          lifecycle: { status: 'active' },
        },
        createdAt,
        updatedAt: createdAt,
        asset: {
          id: assetId,
          assetType: 'image',
          visibility: 'private',
          mimeType: 'image/png',
          width: 1024,
          height: 1024,
          storageKey: 'private/asset-key-must-not-leak',
          publicUrl: 'https://storage.example.com/private.png',
          createdAt,
          updatedAt: createdAt,
        },
      },
    ],
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

describe('DebutService private material flow', () => {
  it('creates a private material upload intent without public delivery fields', async () => {
    const prisma = createPrismaMock();
    const service = serviceWith(prisma);

    const result = await service.createMaterialUploadIntent(userId, {
      category: 'face_photo',
      fileName: 'Face Photo.png',
      mimeType: 'image/png',
      fileSizeBytes: 1024,
    });

    expect(prisma.asset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assetType: 'image',
        visibility: 'private',
        storageKey: expect.stringContaining('debut-material-image-face-photo.png'),
        mimeType: 'image/png',
        fileSizeBytes: BigInt(1024),
        metadata: expect.objectContaining({
          uploadIntent: expect.objectContaining({
            scope: 'debut_application_material',
            category: 'face_photo',
            createdByUserId: userId,
            status: 'pending_upload',
          }),
        }),
      }),
    });
    expect(result.asset).toMatchObject({
      id: assetId,
      visibility: 'private',
      publicUrl: null,
      uploadStatus: 'pending_upload',
    });
    expect(result.upload).toMatchObject({
      method: 'PUT',
      url: expect.stringContaining('/pending-local-upload/'),
    });
    expect(result.upload).not.toHaveProperty('publicUrl');
  });

  it('confirms an owned private material upload', async () => {
    const prisma = createPrismaMock();
    const service = serviceWith(prisma);
    prisma.asset.findFirst.mockResolvedValue(materialAsset('pending_upload'));

    const result = await service.confirmMaterialUpload(userId, assetId, {
      objectETag: 'etag',
    });

    expect(prisma.asset.update).toHaveBeenCalledWith({
      where: { id: assetId },
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          uploadIntent: expect.objectContaining({
            status: 'uploaded',
            confirmedByUserId: userId,
          }),
        }),
      }),
    });
    expect(result.upload.status).toBe('uploaded');
    expect(result.asset.publicUrl).toBeNull();
  });

  it('rejects application attachments until upload is confirmed', async () => {
    const prisma = createPrismaMock();
    const service = serviceWith(prisma);
    prisma.asset.findMany.mockResolvedValue([materialAsset('pending_upload')]);

    await expect(
      service.createApplication(userId, validApplicationInput() as never),
    ).rejects.toMatchObject({
      response: {
        code: 'DEBUT_ATTACHMENT_UPLOAD_NOT_CONFIRMED',
        messageKey: 'debut.attachment.uploadNotConfirmed',
      },
    });
  });

  it('links confirmed private material assets when creating an application', async () => {
    const prisma = createPrismaMock();
    const service = serviceWith(prisma);
    prisma.asset.findMany.mockResolvedValue([materialAsset('uploaded')]);

    const result = await service.createApplication(
      userId,
      validApplicationInput() as never,
    );

    expect(prisma.debutApplication.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId,
        attachments: {
          create: [
            expect.objectContaining({
              assetId,
              category: 'face_photo',
              status: 'attached',
            }),
          ],
        },
        metadata: expect.objectContaining({
          materialSubmissionMode: 'private_applicant_material_upload',
          portfolioUrls: ['https://example.com/portfolio'],
          shareRate: {
            estimatedShareRate: null,
            finalShareRate: null,
            autoFinalization: false,
          },
        }),
      }),
      include: expect.any(Object),
    });
    expect(result.application.attachments).toHaveLength(1);
  });

  it('fails closed when genderSwapRequested is true', async () => {
    const prisma = createPrismaMock();
    const service = serviceWith(prisma);

    await expect(
      service.createApplication(
        userId,
        validApplicationInput({ genderSwapRequested: true }) as never,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'DEBUT_GENDER_SWAP_UNSUPPORTED',
        messageKey: 'debut.genderSwap.unsupported',
      },
    });
    expect(prisma.debutApplication.create).not.toHaveBeenCalled();
  });

  it('returns masked admin application list items without private material URLs', async () => {
    const prisma = createPrismaMock();
    const service = serviceWith(prisma);
    prisma.debutApplication.findMany.mockResolvedValue([adminApplication()]);

    const result = await service.getApplications({ take: 1 } as never);
    const payload = JSON.stringify(result);

    expect(result.readOnly).toBe(true);
    expect(result.statusCandidates).toEqual([
      'submitted',
      'reviewing',
      'needs_more_info',
      'approved_for_contact',
      'rejected',
      'archived',
    ]);
    expect(result.items[0]).toMatchObject({
      status: 'approved_for_contact',
      applicationChannel: 'online_review',
      contact: {
        emailPresent: true,
        phonePresent: true,
      },
      materialSummary: {
        count: 1,
        categories: ['face_photo'],
        hasPrivateMaterials: true,
      },
    });
    expect(payload).not.toContain('applicant@example.com');
    expect(payload).not.toContain('010-1234-5678');
    expect(payload).not.toContain('private/storage-key-must-not-leak');
    expect(payload).not.toContain('private/attachment-key-must-not-leak');
    expect(payload).not.toContain('https://storage.example.com/private.png');
  });

  it('returns admin application detail with attachment metadata only', async () => {
    const prisma = createPrismaMock();
    const service = serviceWith(prisma);
    prisma.debutApplication.findUnique.mockResolvedValue(adminApplication());

    const result = await service.getApplication(
      '00000000-0000-4000-8000-000000000301',
    );
    const payload = JSON.stringify(result);

    expect(result.application).toMatchObject({
      status: 'approved_for_contact',
      portfolio: {
        urlPresent: true,
        urlCount: 1,
      },
    });
    expect(result.application.attachments[0]).toMatchObject({
      materialType: 'face_photo',
      privateMaterial: true,
      asset: {
        id: assetId,
        assetType: 'image',
        visibility: 'private',
        mimeType: 'image/png',
      },
      upload: {
        status: 'uploaded',
        scope: 'debut_application_material',
        category: 'face_photo',
      },
      privacy: {
        publicUrlReturned: false,
        signedReadUrlReturned: false,
        originalFileUrlReturned: false,
        storageKeyReturned: false,
      },
    });
    expect(payload).not.toContain('applicant@example.com');
    expect(payload).not.toContain('010-1234-5678');
    expect(payload).not.toContain('private/asset-key-must-not-leak');
    expect(payload).not.toContain('blocked-etag-sample');
    expect(payload).not.toContain('https://storage.example.com/private.png');
  });
});

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
    storageKey: 'uploads/debut-materials/images/test.png',
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
    storageKey: 'uploads/debut-materials/images/test.png',
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
});

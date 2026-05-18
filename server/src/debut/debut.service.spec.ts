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

function serviceWith(prisma: PrismaMock, configValues: Record<string, string> = {}) {
  const config = {
    get: jest.fn((key: string) => {
      if (key in configValues) {
        return configValues[key];
      }

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
  it('returns a fail-closed phone consultation operations policy without operator phone exposure', () => {
    const prisma = createPrismaMock();
    const service = serviceWith(prisma);

    const result = service.getPolicy();
    const payload = JSON.stringify(result);

    expect(result.applicationChannels[0]).toMatchObject({
      value: 'phone_consultation',
      labelKey: 'debut.applicationChannel.phoneConsultation.label',
      descriptionKey: 'debut.applicationChannel.phoneConsultation.description',
      operations: {
        mode: 'operator_queue',
        operatorPhone: {
          configured: false,
          numberReturned: false,
          publicDisplayAllowed: false,
          fallbackWhenMissing: 'hide_public_phone',
        },
        sla: {
          messageKey: 'debut.phoneConsultation.sla.businessDayReview',
          guaranteed: false,
          finalDebutOrContractGuaranteed: false,
        },
        dispatch: {
          externalSmsEnabled: false,
          externalEmailEnabled: false,
          autoPhoneCallEnabled: false,
          contractOnly: true,
        },
      },
    });
    expect(result.materialSubmissionPolicy.phoneConsultationOperations).toMatchObject(
      result.applicationChannels[0].operations!,
    );
    expect(payload).not.toContain('DEBUT_OPERATOR_PHONE_NUMBER');
  });

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

  it('classifies represented artist applications for entertainment agency operations', async () => {
    const prisma = createPrismaMock();
    const service = serviceWith(prisma);

    await service.createApplication(
      userId,
      validApplicationInput({
        applicationChannel: 'phone_consultation',
        applicationType: 'represented_artist',
        affiliatedOrgName: 'QA Entertainment',
        rightsRelationshipNote: 'Non-sensitive rights relationship summary.',
        facePhotoAssetIds: [],
        contactPhone: '010-0000-0000',
        consultationConsent: true,
      }) as never,
    );

    expect(prisma.debutApplication.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          applicationChannel: 'phone_consultation',
          applicationType: 'represented_artist',
          applicantSegment: 'represented_artist',
          operationSegment: 'entertainment_agency',
          affiliatedOrgName: 'QA Entertainment',
          rightsReviewRequired: true,
          rightsReviewStatus: 'pending',
          partnerReviewRequired: false,
          partnerReviewStatus: 'not_applicable',
          consultationStatus: 'pending',
        }),
      }),
      include: expect.any(Object),
    });
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

  it('filters admin applications by entertainment agency operation segment', async () => {
    const prisma = createPrismaMock();
    const service = serviceWith(prisma);
    prisma.debutApplication.findMany.mockResolvedValue([
      adminApplication({
        metadata: {
          applicationChannel: 'phone_consultation',
          applicationType: 'represented_artist',
          operationSegment: 'entertainment_agency',
          applicantSegment: 'represented_artist',
          affiliatedOrgName: 'QA Entertainment',
          rightsRelationshipNote: 'Internal relationship note',
          rightsReviewRequired: true,
          rightsReviewStatus: 'pending',
          partnerReviewRequired: false,
          partnerReviewStatus: 'not_applicable',
        },
      }),
    ]);

    const result = await service.getApplications({
      take: 1,
      operationSegment: 'entertainment_agency',
    } as never);
    const payload = JSON.stringify(result);

    expect(prisma.debutApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                {
                  metadata: {
                    path: ['operationSegment'],
                    equals: 'entertainment_agency',
                  },
                },
                {
                  metadata: {
                    path: ['applicationType'],
                    equals: 'represented_artist',
                  },
                },
                {
                  metadata: {
                    path: ['rightsReviewRequired'],
                    equals: true,
                  },
                },
              ],
            },
          ],
        },
      }),
    );
    expect(result.operationSegments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 'entertainment_agency',
          adminFilter: { operationSegment: 'entertainment_agency' },
        }),
      ]),
    );
    expect(result.routingContract).toMatchObject({
      emailDispatchEnabled: false,
      inAppDispatchEnabled: false,
      smsDispatchEnabled: false,
      phoneCallAutomationEnabled: false,
      operatorPhoneNumberReturned: false,
      contractOnly: true,
    });
    expect(result.items[0]).toMatchObject({
      applicationType: 'represented_artist',
      operationSegment: 'entertainment_agency',
      review: {
        rightsReviewRequired: true,
        rightsReviewStatus: 'pending',
      },
      organization: {
        entertainmentAgencyInquiry: true,
        affiliatedOrgNamePresent: true,
        rightsRelationshipNotePresent: true,
      },
      operatorRouting: {
        queue: 'phone_consultation',
        queueSegment: 'entertainment_agency',
        reviewQueues: [
          'phone_consultation',
          'entertainment_agency',
          'rights_review',
        ],
        applicationChannel: 'phone_consultation',
        contactAvailability: {
          contactable: true,
          phonePresent: true,
          emailPresent: true,
          preferredContactTimePresent: false,
          consultationConsent: false,
        },
        operatorAssignment: {
          assigned: false,
          assignedUserIdReturned: false,
          assignedDisplayNameReturned: false,
          assignedAtPresent: false,
          guidanceKey: 'debut.operator.assignment.missing',
        },
        consultation: {
          status: 'pending',
          pendingOperatorContact: true,
        },
        notification: {
          needed: false,
          reasonKey: 'debut.operator.notification.none',
          channelsPlanned: ['admin_queue'],
          externalDispatch: {
            smsSent: false,
            emailSent: false,
            phoneCallPlaced: false,
            contractOnly: true,
          },
        },
        guidance: {
          operatorAssignmentMissing: true,
          preferredContactTimeMissing: true,
          operatorPhoneMissing: true,
          rightsReviewPending: true,
          partnerReviewPending: false,
          messageKeys: [
            'debut.operator.assignment.missing',
            'debut.operator.consultation.preferredTimeMissing',
            'debut.operator.phone.missing',
            'debut.operator.rightsReview.pending',
          ],
        },
        finalization: {
          messageKey: 'debut.application.finalization.preContractReview',
          contractOnly: true,
          finalDebutConfirmed: false,
          contractFinalized: false,
          settlementFinalized: false,
          payoutEligible: false,
          walletMutationAllowed: false,
          luminaMutationAllowed: false,
          rightsReview: {
            required: true,
            status: 'pending',
            pending: true,
          },
        },
        phoneConsultationOperations: {
          operatorPhone: {
            configured: false,
            numberReturned: false,
          },
          sla: {
            messageKey: 'debut.phoneConsultation.sla.businessDayReview',
            guaranteed: false,
          },
        },
      },
    });
    expect(payload).not.toContain('applicant@example.com');
    expect(payload).not.toContain('010-1234-5678');
    expect(payload).not.toContain('Internal relationship note');
    expect(payload).not.toContain('private/storage-key-must-not-leak');
  });

  it('marks pending phone consultation rows as admin-queue notification needed without dispatching externally', async () => {
    const prisma = createPrismaMock();
    const service = serviceWith(prisma, {
      DEBUT_OPERATOR_PHONE_NUMBER: 'configured-test-value',
    });
    prisma.debutApplication.findMany.mockResolvedValue([
      adminApplication({
        status: 'submitted',
        metadata: {
          applicationChannel: 'phone_consultation',
          applicationType: 'personal_unaffiliated',
          operationSegment: 'individual',
          consultationConsent: true,
          consultationStatus: 'pending',
          preferredContactTime: 'weekday afternoon',
        },
      }),
    ]);

    const result = await service.getApplications({
      take: 1,
      applicationChannel: 'phone_consultation',
      consultationStatus: 'pending',
    } as never);
    const payload = JSON.stringify(result);

    expect(result.phoneConsultationOperations).toMatchObject({
      operatorPhone: {
        configured: true,
        numberReturned: false,
        publicDisplayAllowed: false,
      },
      dispatch: {
        externalSmsEnabled: false,
        externalEmailEnabled: false,
        autoPhoneCallEnabled: false,
      },
    });
    expect(result.items[0]).toMatchObject({
      operatorRouting: {
        contactAvailability: {
          contactable: true,
          phonePresent: true,
          emailPresent: true,
          preferredContactTimePresent: true,
          consultationConsent: true,
        },
        operatorAssignment: {
          assigned: false,
          assignedUserIdReturned: false,
          assignedDisplayNameReturned: false,
          assignedAtPresent: false,
        },
        notification: {
          needed: true,
          reasonKey:
            'debut.operator.notification.phoneConsultation.pendingContact',
          externalDispatch: {
            smsSent: false,
            emailSent: false,
            phoneCallPlaced: false,
            contractOnly: true,
          },
        },
        guidance: {
          operatorAssignmentMissing: true,
          preferredContactTimeMissing: false,
          operatorPhoneMissing: false,
        },
      },
    });
    expect(payload).not.toContain('configured-test-value');
    expect(payload).not.toContain('applicant@example.com');
    expect(payload).not.toContain('010-1234-5678');
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

  it('updates admin review status with a redacted audit payload and no finalization mutation', async () => {
    const prisma = createPrismaMock();
    const service = serviceWith(prisma);
    const before = adminApplication({
      status: 'submitted',
      reviewNote: 'Internal before note must not leak to audit',
      metadata: {
        applicationChannel: 'phone_consultation',
        applicationType: 'represented_artist',
        rightsReviewRequired: true,
        rightsReviewStatus: 'pending',
        consultationStatus: 'pending',
        consultationNote: 'Internal before call memo must not leak to audit',
        storageKey: 'private/audit-before-key-must-not-leak',
      },
    });
    const after = adminApplication({
      status: 'needs_more_info',
      reviewNote: 'Internal status change note must not leak to audit',
      metadata: {
        applicationChannel: 'phone_consultation',
        applicationType: 'represented_artist',
        rightsReviewRequired: true,
        rightsReviewStatus: 'reviewing',
        consultationStatus: 'scheduled',
        consultationNote: 'Internal after call memo must not leak to audit',
        publicStatusReason: '보완 가능한 공개 안내만 노출',
        requestedActionKey: 'debut.application.action.qaOnly',
        storageKey: 'private/audit-after-key-must-not-leak',
      },
    });
    prisma.debutApplication.findUnique.mockResolvedValue(before);
    prisma.debutApplication.update.mockResolvedValue(after);
    prisma.auditEvent.create.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000501',
    });

    const result = await service.updateApplication(
      { id: '00000000-0000-4000-8000-000000000901', email: null },
      '00000000-0000-4000-8000-000000000301',
      {
        status: 'needs_more_info',
        reviewNote: 'Internal status change note must not leak to audit',
        consultationStatus: 'scheduled',
        rightsReviewStatus: 'reviewing',
        publicStatusReason: '보완 가능한 공개 안내만 노출',
        requestedActionKey: 'debut.application.action.qaOnly',
      },
    );
    const auditCall = prisma.auditEvent.create.mock.calls[0][0];
    const auditPayload = JSON.stringify(auditCall.data);
    const responsePayload = JSON.stringify(result);

    expect(prisma.debutApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: '00000000-0000-4000-8000-000000000301' },
        data: expect.objectContaining({
          status: 'needs_more_info',
          reviewNote: 'Internal status change note must not leak to audit',
          metadata: expect.objectContaining({
            publicStatusReason: '보완 가능한 공개 안내만 노출',
            requestedActionKey: 'debut.application.action.qaOnly',
            consultationStatus: 'scheduled',
            rightsReviewStatus: 'reviewing',
          }),
        }),
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      action: 'debut_application.review_update',
      application: {
        status: 'needs_more_info',
        review: {
          consultationStatus: 'scheduled',
          rightsReviewStatus: 'reviewing',
        },
      },
      audit: {
        recorded: true,
        eventId: '00000000-0000-4000-8000-000000000501',
        contractVersion: '2026-05-19.debut-ops-audit-v1',
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
    });
    expect(result.audit.changedFields).toEqual(
      expect.arrayContaining([
        'status',
        'userStatus',
        'consultationStatus',
        'rightsReviewStatus',
        'publicNotice',
      ]),
    );
    expect(auditCall.data).toMatchObject({
      actorUserId: '00000000-0000-4000-8000-000000000901',
      actorType: 'admin',
      action: 'debut_application.review_update',
      targetType: 'debut_application',
      targetId: '00000000-0000-4000-8000-000000000301',
      beforeData: {
        status: 'submitted',
        privateMaterials: {
          metadataOnly: true,
          storageKeyReturned: false,
          objectETagReturned: false,
        },
      },
      afterData: {
        status: 'needs_more_info',
        publicNotice: {
          publicReasonPresent: true,
          requestedActionKey: 'debut.application.action.qaOnly',
        },
      },
      metadata: {
        contractVersion: '2026-05-19.debut-ops-audit-v1',
        redaction: {
          internalAdminNotesStored: false,
          privateMaterialUrlsStored: false,
          storageKeysStored: false,
          objectETagsStored: false,
        },
        mutationPolicy: {
          finalDebutMutation: false,
          settlementMutation: false,
          payoutMutation: false,
          walletMutation: false,
          luminaMutation: false,
        },
      },
    });
    expect(responsePayload).not.toContain('Internal status change note');
    expect(auditPayload).not.toContain('Internal before note');
    expect(auditPayload).not.toContain('Internal status change note');
    expect(auditPayload).not.toContain('Internal before call memo');
    expect(auditPayload).not.toContain('Internal after call memo');
    expect(auditPayload).not.toContain('applicant@example.com');
    expect(auditPayload).not.toContain('010-1234-5678');
    expect(auditPayload).not.toContain('private/audit-before-key-must-not-leak');
    expect(auditPayload).not.toContain('private/audit-after-key-must-not-leak');
    expect(auditPayload).not.toContain('private/attachment-key-must-not-leak');
    expect(auditPayload).not.toContain('blocked-etag-sample');
    expect(auditPayload).not.toContain('https://storage.example.com/private.png');
  });

  it('rejects final share updates in the admin review contract', async () => {
    const prisma = createPrismaMock();
    const service = serviceWith(prisma);
    prisma.debutApplication.findUnique.mockResolvedValue(adminApplication());

    await expect(
      service.updateApplication(
        { id: '00000000-0000-4000-8000-000000000901', email: null },
        '00000000-0000-4000-8000-000000000301',
        { shareTierApproved: 50 },
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'DEBUT_ADMIN_FINAL_SHARE_UPDATE_NOT_OPEN',
        messageKey: 'debut.admin.finalShareUpdateNotOpen',
      },
    });
    expect(prisma.debutApplication.update).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('returns owner-only application status with safe history and copy keys', async () => {
    const prisma = createPrismaMock();
    const service = serviceWith(prisma);
    prisma.debutApplication.findFirst.mockResolvedValue(
      adminApplication({
        status: 'needs_more_info',
        metadata: {
          applicationChannel: 'online_review',
          applicationType: 'represented_artist',
          publicStatusReason: '자료 확인이 더 필요합니다.',
          consultationNote: 'Internal call memo must not leak',
          rightsReviewNote: 'Internal rights note must not leak',
          storageKey: 'private/status-key-must-not-leak',
        },
      }),
    );

    const result = await service.getMyApplicationStatus(
      userId,
      '00000000-0000-4000-8000-000000000301',
    );
    const payload = JSON.stringify(result);

    expect(prisma.debutApplication.findFirst).toHaveBeenCalledWith({
      where: {
        id: '00000000-0000-4000-8000-000000000301',
        userId,
      },
      select: expect.any(Object),
    });
    expect(result).toMatchObject({
      readOnly: true,
      ownerOnly: true,
      application: {
        status: 'needs_more_info',
        statusLabelKo: '보완 요청',
        messageKey: 'debut.application.status.needsMoreInfo',
        materialSummary: {
          count: 1,
          categories: ['face_photo'],
          metadataOnly: true,
        },
        finalization: {
          messageKey: 'debut.application.finalization.preContractReview',
          contractOnly: true,
          finalDebutConfirmed: false,
          contractFinalized: false,
          settlementFinalized: false,
          payoutEligible: false,
          walletMutationAllowed: false,
          luminaMutationAllowed: false,
          rightsReview: {
            required: true,
            status: 'pending',
            pending: true,
          },
        },
        publicNotice: {
          publicReason: '자료 확인이 더 필요합니다.',
          dispatch: {
            inAppSent: false,
            emailSent: false,
            contractOnly: true,
          },
          internalAdminNoteReturned: false,
          settlementOrContractFinalized: false,
        },
      },
    });
    expect(result.application.statusHistory).toHaveLength(2);
    expect(payload).not.toContain('applicant@example.com');
    expect(payload).not.toContain('010-1234-5678');
    expect(payload).not.toContain('Internal call memo must not leak');
    expect(payload).not.toContain('Internal rights note must not leak');
    expect(payload).not.toContain('private/status-key-must-not-leak');
    expect(payload).not.toContain('Internal review note');
  });

  it.each([
    {
      rawStatus: 'needs_more_info',
      expectedStatus: 'needs_more_info',
      expectedMessageKey: 'debut.application.status.needsMoreInfo',
      expectedCtaMessageKey: 'debut.application.cta.checkRequest',
      publicReason: 'QA needs an additional consent confirmation.',
    },
    {
      rawStatus: 'approved_for_contact',
      expectedStatus: 'approved',
      expectedMessageKey: 'debut.application.status.approved',
      expectedCtaMessageKey: 'debut.application.cta.checkResult',
      publicReason: 'QA contact handoff is being prepared.',
    },
    {
      rawStatus: 'rejected',
      expectedStatus: 'rejected',
      expectedMessageKey: 'debut.application.status.rejected',
      expectedCtaMessageKey: 'debut.application.cta.checkResult',
      publicReason: 'QA review ended without proceeding.',
    },
  ])(
    'projects $rawStatus as a safe owner-only QA fixture',
    async ({
      rawStatus,
      expectedStatus,
      expectedMessageKey,
      expectedCtaMessageKey,
      publicReason,
    }) => {
      const prisma = createPrismaMock();
      const service = serviceWith(prisma);
      prisma.debutApplication.findFirst.mockResolvedValue(
        adminApplication({
          status: rawStatus,
          reviewNote: `Internal ${rawStatus} review note must not leak`,
          metadata: {
            applicationChannel: 'online_review',
            applicationType: 'represented_artist',
            publicStatusReason: publicReason,
            requestedActionKey: 'debut.application.action.qaOnly',
            consultationNote: `Internal ${rawStatus} call memo must not leak`,
            rightsReviewNote: `Internal ${rawStatus} rights note must not leak`,
            partnerReviewNote: `Internal ${rawStatus} partner note must not leak`,
            storageKey: `private/${rawStatus}-status-key-must-not-leak`,
            privateMaterialUrl: `https://storage.example.com/private/${rawStatus}.png`,
          },
        }),
      );

      const result = await service.getMyApplicationStatus(
        userId,
        '00000000-0000-4000-8000-000000000301',
      );
      const payload = JSON.stringify(result);
      const latestHistory =
        result.application.statusHistory[result.application.statusHistory.length - 1];

      expect(result).toMatchObject({
        readOnly: true,
        ownerOnly: true,
        application: {
          status: expectedStatus,
          messageKey: expectedMessageKey,
          cta: {
            enabled: false,
            messageKey: expectedCtaMessageKey,
            actionAllowed: false,
            mutationAllowed: false,
            contractOnly: true,
            disabledReasonKey: 'debut.application.cta.disabled.contractOnly',
            blockedMutations: [
              'debut_finalization',
              'contract',
              'settlement',
              'payout',
              'wallet',
              'lumina',
              'notification_dispatch',
            ],
          },
          materialSummary: {
            metadataOnly: true,
          },
          finalization: {
            messageKey: 'debut.application.finalization.preContractReview',
            contractOnly: true,
            finalDebutConfirmed: false,
            contractFinalized: false,
            settlementFinalized: false,
            payoutEligible: false,
            walletMutationAllowed: false,
            luminaMutationAllowed: false,
          },
          publicNotice: {
            status: expectedStatus,
            titleKey: `${expectedMessageKey}.title`,
            bodyKey: `${expectedMessageKey}.body`,
            publicReason,
            channelsPlanned: ['in_app', 'email'],
            dispatch: {
              inAppSent: false,
              emailSent: false,
              contractOnly: true,
            },
            internalAdminNoteReturned: false,
            settlementOrContractFinalized: false,
            cta: {
              enabled: false,
              messageKey: expectedCtaMessageKey,
              actionAllowed: false,
              mutationAllowed: false,
              contractOnly: true,
              disabledReasonKey: 'debut.application.cta.disabled.contractOnly',
            },
          },
          privacy: {
            contactReturned: false,
            introReturned: false,
            adminReviewNoteReturned: false,
            internalMetadataReturned: false,
            privateMaterialUrlReturned: false,
          },
        },
      });
      expect(result.application.cta.enabled).toBe(false);
      expect(latestHistory).toMatchObject({
        status: expectedStatus,
        messageKey: expectedMessageKey,
        source: 'application.updatedAt',
      });
      expect(payload).not.toContain('applicant@example.com');
      expect(payload).not.toContain('010-1234-5678');
      expect(payload).not.toContain(`Internal ${rawStatus}`);
      expect(payload).not.toContain(`private/${rawStatus}-status-key-must-not-leak`);
      expect(payload).not.toContain(`https://storage.example.com/private/${rawStatus}.png`);
      expect(payload).not.toContain('blocked-etag-sample');
    },
  );

  it('returns latest owner application in the safe status envelope', async () => {
    const prisma = createPrismaMock();
    const service = serviceWith(prisma);
    prisma.debutApplication.findFirst.mockResolvedValue(adminApplication());

    const result = await service.getMyLatestApplication(userId);
    const payload = JSON.stringify(result);

    expect(result).toMatchObject({
      readOnly: true,
      ownerOnly: true,
      ctaState: 'status',
      application: {
        status: 'approved',
        statusLabelKo: '연락 준비 중',
        messageKey: 'debut.application.status.approved',
      },
    });
    expect(payload).not.toContain('applicant@example.com');
    expect(payload).not.toContain('Internal review note');
    expect(payload).not.toContain('private/storage-key-must-not-leak');
  });
});

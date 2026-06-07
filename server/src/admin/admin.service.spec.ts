import { BadRequestException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

type PrismaMock = {
  userActionToken: {
    findMany: jest.Mock;
    count: jest.Mock;
  };
};

function createService() {
  const prisma: PrismaMock = {
    userActionToken: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };
  const config = {
    get: jest.fn(),
  };
  const service = new AdminService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
  );

  return { service, prisma };
}

async function expectHttpError(
  promise: Promise<unknown>,
  expected: Record<string, unknown>,
) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getResponse()).toMatchObject(expected);
    return;
  }

  throw new Error('Expected promise to reject');
}

describe('AdminService wallet daily ledger reconcile read model', () => {
  it('aggregates daily Lumina ledger movement without exposing payment secrets', async () => {
    const prisma = {
      walletLedger: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: '00000000-0000-4000-8000-000000000701',
            walletAccountId: '00000000-0000-4000-8000-000000000601',
            direction: 'credit',
            amount: new Decimal(100),
            ledgerType: 'purchase',
            referenceType: 'payment_order',
            referenceId: '00000000-0000-4000-8000-000000000801',
            idempotencyKey: 'payment-secret-key',
            memo: 'provider receipt and token must not leak',
            createdAt: new Date('2026-06-05T01:00:00.000Z'),
            walletAccount: {
              id: '00000000-0000-4000-8000-000000000601',
              userId: '00000000-0000-4000-8000-000000000501',
              currencyCode: 'LUMINA',
              status: 'active',
              cachedBalance: new Decimal(70),
            },
          },
          {
            id: '00000000-0000-4000-8000-000000000702',
            walletAccountId: '00000000-0000-4000-8000-000000000601',
            direction: 'debit',
            amount: new Decimal(30),
            ledgerType: 'gift_spend',
            referenceType: 'gift_order',
            referenceId: '00000000-0000-4000-8000-000000000802',
            idempotencyKey: 'gift-secret-key',
            memo: 'gift memo must not leak',
            createdAt: new Date('2026-06-05T03:00:00.000Z'),
            walletAccount: {
              id: '00000000-0000-4000-8000-000000000601',
              userId: '00000000-0000-4000-8000-000000000501',
              currencyCode: 'LUMINA',
              status: 'active',
              cachedBalance: new Decimal(70),
            },
          },
        ]),
      },
    };
    const service = new AdminService(
      prisma as unknown as PrismaService,
      { get: jest.fn() } as unknown as ConfigService,
    );

    const result = await service.getBackstageWalletLedgerDailyReconcile({
      serviceDate: '2026-06-05',
      userId: '00000000-0000-4000-8000-000000000501',
    });

    expect(prisma.walletLedger.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          createdAt: {
            gte: new Date('2026-06-05T00:00:00.000Z'),
            lt: new Date('2026-06-06T00:00:00.000Z'),
          },
          walletAccount: {
            currencyCode: 'LUMINA',
            userId: '00000000-0000-4000-8000-000000000501',
          },
        },
      }),
    );
    expect(result).toMatchObject({
      serviceDate: '2026-06-05',
      currencyCode: 'LUMINA',
      totals: {
        walletAccountCount: 1,
        ledgerEntryCount: 2,
        creditLumina: '100',
        debitLumina: '30',
        netLumina: '70',
      },
      items: [
        {
          walletAccountId: '00000000-0000-4000-8000-000000000601',
          userId: '00000000-0000-4000-8000-000000000501',
          cachedBalanceLumina: '70',
          ledgerEntryCount: 2,
          creditLumina: '100',
          debitLumina: '30',
          netLumina: '70',
          byLedgerType: expect.arrayContaining([
            expect.objectContaining({
              ledgerType: 'purchase',
              creditLumina: '100',
            }),
            expect.objectContaining({
              ledgerType: 'gift_spend',
              debitLumina: '30',
            }),
          ]),
          reconciliation: {
            cachedBalanceSource: 'wallet_accounts.cached_balance',
            ledgerSource: 'wallet_ledger',
            currentBalanceSnapshotOnly: true,
            openingBalanceRequiredForExactDailyBalance: true,
          },
        },
      ],
      policy: {
        permission: 'payments:read',
        mutation: false,
        sourceOfTruth: 'wallet_ledger',
        clientDisplayedBalanceTrusted: false,
        rawPaymentIdentifierReturned: false,
        rawReceiptReturned: false,
        providerTokenReturned: false,
        idempotencyKeyReturned: false,
        memoReturned: false,
      },
    });
    const payload = JSON.stringify(result);
    expect(payload).not.toContain('payment-secret-key');
    expect(payload).not.toContain('gift-secret-key');
    expect(payload).not.toContain('provider receipt');
    expect(payload).not.toContain('gift memo');
    expect(payload).not.toContain('00000000-0000-4000-8000-000000000801');
  });

  it('rejects invalid wallet daily reconcile filters with stable codes', async () => {
    const service = new AdminService(
      { walletLedger: { findMany: jest.fn() } } as unknown as PrismaService,
      { get: jest.fn() } as unknown as ConfigService,
    );

    await expectHttpError(
      service.getBackstageWalletLedgerDailyReconcile({
        serviceDate: '2026/06/05',
      }),
      {
        code: 'WALLET_DAILY_RECONCILE_INVALID_SERVICE_DATE',
        messageKey: 'admin.walletDailyReconcile.invalidServiceDate',
      },
    );
    await expectHttpError(
      service.getBackstageWalletLedgerDailyReconcile({
        serviceDate: '2026-06-05',
        currencyCode: 'USD',
      }),
      {
        code: 'WALLET_DAILY_RECONCILE_INVALID_CURRENCY',
        messageKey: 'admin.walletDailyReconcile.invalidCurrency',
      },
    );
  });
});

describe('AdminService auth action token audit', () => {
  it('returns masked target and omits sensitive token fields', async () => {
    const { service, prisma } = createService();
    const createdAt = new Date('2026-05-14T00:00:00.000Z');
    const expiresAt = new Date('2099-01-01T00:00:00.000Z');
    const attemptedAt = new Date('2026-05-14T00:01:00.000Z');
    const acceptedAt = new Date('2026-05-14T00:01:01.000Z');

    prisma.userActionToken.findMany.mockResolvedValue([
      {
        id: '00000000-0000-4000-8000-000000000101',
        userId: '00000000-0000-4000-8000-000000000001',
        purpose: 'email_verification',
        tokenHash: 'hash-value-must-not-leak',
        createdAt,
        expiresAt,
        consumedAt: null,
        deliveryStatus: 'accepted',
        deliveryChannel: 'email',
        deliveryProvider: 'resend',
        deliveryAttemptedAt: attemptedAt,
        deliveryAcceptedAt: acceptedAt,
        deliveryFailedAt: null,
        targetEmailMasked: 'qa***@example.com',
        user: {
          id: '00000000-0000-4000-8000-000000000001',
          email: 'qa@example.com',
          status: 'active',
          deletedAt: null,
          emailVerifiedAt: null,
        },
      },
    ]);
    prisma.userActionToken.count.mockResolvedValue(1);

    const result = await service.getAuthActionTokens({
      purpose: 'email_verification',
      status: 'pending',
      deliveryStatus: 'accepted',
      deliveryProvider: 'resend',
    });

    expect(prisma.userActionToken.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          purpose: 'email_verification',
          consumedAt: null,
          expiresAt: { gt: expect.any(Date) },
          deliveryStatus: 'accepted',
          deliveryProvider: { equals: 'resend', mode: 'insensitive' },
        }),
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      purpose: 'email_verification',
      status: 'pending',
      delivery: {
        status: 'accepted',
        channel: 'email',
        provider: 'resend',
        persisted: true,
        attemptedAt,
        acceptedAt,
        failedAt: null,
      },
      target: {
        userId: '00000000-0000-4000-8000-000000000001',
        emailMasked: 'qa***@example.com',
        userStatus: 'active',
        emailVerified: false,
        deleted: false,
      },
      sensitiveFields: {
        rawTokenReturned: false,
        tokenHashReturned: false,
        rawEmailReturned: false,
        mailBodyReturned: false,
      },
    });
    expect(result.filters).toMatchObject({
      purpose: 'email_verification',
      status: 'pending',
      deliveryStatus: 'accepted',
      deliveryProvider: 'resend',
      email: null,
    });
    expect(result.policy).toMatchObject({
      supportedDeliveryStatuses: expect.arrayContaining(['accepted', 'failed']),
      supportedDeliveryProviders: expect.arrayContaining(['resend', 'sendgrid', 'none']),
      requestCooldownSeconds: 60,
      duplicatePendingTokenPolicy:
        'reuse_recent_pending_token_within_cooldown_else_consume_previous',
      cooldownDuplicateRequestsCreateNewRow: false,
    });
    expect(JSON.stringify(result)).not.toContain('hash-value-must-not-leak');
    expect(JSON.stringify(result)).not.toContain('qa@example.com');
  });

  it('supports filtering delivery rows without a provider', async () => {
    const { service, prisma } = createService();

    prisma.userActionToken.findMany.mockResolvedValue([]);
    prisma.userActionToken.count.mockResolvedValue(0);

    const result = await service.getAuthActionTokens({
      deliveryStatus: 'not_configured',
      deliveryProvider: 'none',
    });

    expect(prisma.userActionToken.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deliveryStatus: 'not_configured',
          deliveryProvider: null,
        }),
      }),
    );
    expect(result.filters).toMatchObject({
      deliveryStatus: 'not_configured',
      deliveryProvider: 'none',
    });
  });

  it('rejects unsupported purposes with a stable admin error', async () => {
    const { service } = createService();

    try {
      await service.getAuthActionTokens({ purpose: 'magic_link' });
      throw new Error('Expected invalid purpose to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'AUTH_ACTION_TOKEN_INVALID_PURPOSE',
        messageKey: 'admin.authActionTokens.invalidPurpose',
      });
    }
  });

  it('rejects unsupported delivery filters with stable admin errors', async () => {
    const { service } = createService();

    await expect(service.getAuthActionTokens({ deliveryStatus: 'sent' })).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AUTH_ACTION_TOKEN_INVALID_DELIVERY_STATUS',
        messageKey: 'admin.authActionTokens.invalidDeliveryStatus',
      }),
    });

    await expect(service.getAuthActionTokens({ deliveryProvider: 'smtp' })).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AUTH_ACTION_TOKEN_INVALID_DELIVERY_PROVIDER',
        messageKey: 'admin.authActionTokens.invalidDeliveryProvider',
      }),
    });
  });
});

describe('AdminService community feed cleanup audit guard', () => {
  const adminUser = {
    id: '00000000-0000-4000-8000-000000000609',
    email: 'admin@example.com',
  };
  const postId = '00000000-0000-4000-8000-000000006090';
  const unsafePostBody =
    'testtest private customer note and raw personal text that must not enter audit';
  const unsafeAuthorEmail = 'feed-author@example.com';
  const unsafeModerationNote = 'raw moderation note with private context';
  const basePost = {
    id: postId,
    status: 'published',
    visibility: 'public',
    postType: 'user_post',
    body: unsafePostBody,
    authorUserId: '00000000-0000-4000-8000-000000006091',
    artistId: null,
    reportCount: 0,
    publishedAt: new Date('2026-06-03T00:00:00.000Z'),
    deletedAt: null,
    createdAt: new Date('2026-06-03T00:00:00.000Z'),
    updatedAt: new Date('2026-06-03T00:00:00.000Z'),
    metadata: {},
    author: {
      id: '00000000-0000-4000-8000-000000006091',
      email: unsafeAuthorEmail,
      status: 'active',
      profile: {
        displayName: 'Feed Author',
        avatarAssetId: null,
      },
    },
    artist: null,
  };

  function createCommunityAdminService() {
    const prisma = {
      communityPost: {
        findUnique: jest.fn().mockResolvedValue(basePost),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            ...basePost,
            ...data,
            metadata: data.metadata,
          }),
        ),
      },
      auditEvent: {
        create: jest.fn().mockResolvedValue({ id: 'audit-609' }),
      },
    };
    const config = { get: jest.fn() };
    const service = new AdminService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );

    return { service, prisma };
  }

  it('records sanitized audit snapshots when hiding public feed posts', async () => {
    const { service, prisma } = createCommunityAdminService();

    await service.hideCommunityPost(adminUser as never, postId, {
      reason: 'qa_fixture_cleanup',
      note: unsafeModerationNote,
    });

    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'community_post.hide',
          targetType: 'community_post',
          targetId: postId,
          beforeData: expect.objectContaining({
            id: postId,
            bodyPresent: true,
            bodyLength: unsafePostBody.length,
            auditRawBodyStored: false,
            auditRawEmailStored: false,
          }),
          afterData: expect.objectContaining({
            status: 'hidden',
            moderation: expect.objectContaining({
              status: 'hidden',
              notePresent: true,
            }),
            auditRawModerationNoteStored: false,
          }),
          metadata: expect.objectContaining({
            reason: 'qa_fixture_cleanup',
            notePresent: true,
            rawBodyStored: false,
            rawEmailStored: false,
            rawModerationNoteStored: false,
            tokenCookiePasswordStored: false,
            dbUrlStored: false,
          }),
        }),
      }),
    );
    const auditPayload = JSON.stringify(prisma.auditEvent.create.mock.calls[0][0]);
    expect(auditPayload).not.toContain(unsafePostBody);
    expect(auditPayload).not.toContain(unsafeAuthorEmail);
    expect(auditPayload).not.toContain(unsafeModerationNote);
    expect(auditPayload).toContain('fe***@example.com');
  });

  it('records sanitized audit snapshots when restoring public feed posts', async () => {
    const { service, prisma } = createCommunityAdminService();

    await service.restoreCommunityPost(adminUser as never, postId, {
      reason: 'qa_fixture_restored',
      note: unsafeModerationNote,
    });

    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'community_post.restore',
          beforeData: expect.objectContaining({
            auditRawBodyStored: false,
            auditRawEmailStored: false,
          }),
          afterData: expect.objectContaining({
            status: 'published',
            moderation: expect.objectContaining({
              status: 'restored',
              notePresent: true,
            }),
          }),
          metadata: expect.objectContaining({
            rawBodyStored: false,
            rawEmailStored: false,
            rawModerationNoteStored: false,
          }),
        }),
      }),
    );
    const auditPayload = JSON.stringify(prisma.auditEvent.create.mock.calls[0][0]);
    expect(auditPayload).not.toContain(unsafePostBody);
    expect(auditPayload).not.toContain(unsafeAuthorEmail);
    expect(auditPayload).not.toContain(unsafeModerationNote);
  });
});

describe('AdminService wallet ledger audit read model', () => {
  const userId = '00000000-0000-4000-8000-000000000689';
  const walletAccount = {
    userId,
    currencyCode: 'LUMINA',
    status: 'active',
    cachedBalance: new Decimal(12500),
  };
  const baseLedger = {
    id: '00000000-0000-4000-8000-000000006890',
    walletAccountId: '00000000-0000-4000-8000-000000006891',
    direction: 'credit',
    amount: new Decimal(0),
    ledgerType: 'purchase',
    referenceType: 'payment_order',
    referenceId: '00000000-0000-4000-8000-000000006892',
    createdAt: new Date('2026-06-05T00:00:00.000Z'),
    walletAccount,
    memo: 'raw memo must not be returned',
    idempotencyKey: 'payment:provider:must-not-return',
  };

  function createWalletLedgerAuditService() {
    const prisma = {
      walletLedger: {
        findMany: jest.fn().mockResolvedValue([
          {
            ...baseLedger,
            amount: new Decimal(12000),
            ledgerType: 'purchase',
            referenceType: 'payment_order',
          },
          {
            ...baseLedger,
            id: '00000000-0000-4000-8000-000000006893',
            amount: new Decimal(500),
            ledgerType: 'first_charge_bonus',
            referenceType: 'payment_order',
            idempotencyKey: 'first_charge_bonus:user-must-not-return',
          },
          {
            ...baseLedger,
            id: '00000000-0000-4000-8000-000000006894',
            amount: new Decimal(7000),
            ledgerType: 'refund',
            referenceType: 'premium_chat_room',
          },
          {
            ...baseLedger,
            id: '00000000-0000-4000-8000-000000006895',
            amount: new Decimal(1000),
            ledgerType: 'premium_chat_room_artist_compensation',
            referenceType: 'premium_chat_room_refund_decision',
          },
        ]),
      },
    };
    const config = { get: jest.fn() };
    const service = new AdminService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );

    return { service, prisma };
  }

  it('separates purchase, first charge bonus, and premium chat refund ledger rows without mutation', async () => {
    const { service, prisma } = createWalletLedgerAuditService();

    const result = await service.getBackstageWalletLedgerAudit({ userId });

    expect(prisma.walletLedger.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          walletAccount: { userId },
        },
        select: {
          id: true,
          walletAccountId: true,
          direction: true,
          amount: true,
          ledgerType: true,
          referenceType: true,
          referenceId: true,
          createdAt: true,
          walletAccount: {
            select: {
              userId: true,
              currencyCode: true,
              status: true,
              cachedBalance: true,
            },
          },
        },
      }),
    );
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ledgerType: 'purchase',
          auditCategory: 'purchase_credit_base_and_package_bonus_combined',
        }),
        expect.objectContaining({
          ledgerType: 'first_charge_bonus',
          auditCategory: 'first_charge_bonus_10_percent_once',
        }),
        expect.objectContaining({
          ledgerType: 'refund',
          auditCategory: 'premium_chat_room_refund_credit',
        }),
        expect.objectContaining({
          ledgerType: 'premium_chat_room_artist_compensation',
          auditCategory: 'premium_chat_refund_restriction_artist_compensation',
        }),
      ]),
    );
    expect(result.policy).toMatchObject({
      permission: 'payments:read',
      mutation: false,
      sourceOfTruth: 'wallet_ledger',
      clientDisplayedBalanceTrusted: false,
      firstChargeBonusLedgerType: 'first_charge_bonus',
      firstChargeBonusPolicy: 'one_time_user_scoped_10_percent_bonus',
      firstChargeBonusAuditGuard: {
        ledgerType: 'first_charge_bonus',
        referenceType: 'payment_order',
        idempotencyKeyPattern: 'first_charge_bonus:<userId>',
        duplicateReplayBehavior:
          'wallet_ledger_upsert_replay_without_second_bonus_credit',
        retrySafe: true,
        failedProviderEventLocksEligibility: false,
        accountScope: 'userId',
        bonusBasis: 'lumina_products.lumina_amount',
        packageBonusIncluded: false,
        idempotencyKeyReturned: false,
      },
      packageBonusLedgerMode: 'combined_in_purchase_ledger_amount',
      paymentTokenReturned: false,
      rawReceiptReturned: false,
      providerTransactionIdReturned: false,
      idempotencyKeyReturned: false,
      memoReturned: false,
      walletMutation: false,
      settlementMutation: false,
      payoutMutation: false,
    });
    expect(result.summary).toMatchObject({
      returnedCount: 4,
      totalAmountLumina: '20500',
      byCategory: {
        purchase_credit_base_and_package_bonus_combined: 1,
        first_charge_bonus_10_percent_once: 1,
        premium_chat_room_refund_credit: 1,
        premium_chat_refund_restriction_artist_compensation: 1,
      },
    });
    const payload = JSON.stringify(result);
    expect(payload).not.toContain('raw memo must not be returned');
    expect(payload).not.toContain('payment:provider:must-not-return');
    expect(payload).not.toContain('first_charge_bonus:user-must-not-return');
  });

  it('returns stable wallet ledger audit validation errors', async () => {
    const { service } = createWalletLedgerAuditService();

    await expectHttpError(service.getBackstageWalletLedgerAudit({ userId: 'bad-id' }), {
      code: 'WALLET_LEDGER_AUDIT_INVALID_USER_ID',
      messageKey: 'admin.walletLedgerAudit.invalidUserId',
    });
    await expectHttpError(service.getBackstageWalletLedgerAudit({ direction: 'sideways' }), {
      code: 'WALLET_LEDGER_AUDIT_INVALID_DIRECTION',
      messageKey: 'admin.walletLedgerAudit.invalidDirection',
    });
  });
});

describe('AdminService artist knowledge URL operations', () => {
  const adminUser = {
    id: '00000000-0000-4000-8000-000000000900',
    email: 'admin@example.com',
    role: 'admin',
    adminPermissions: ['artists:write'],
  };
  const row = {
    id: '00000000-0000-4000-8000-000000000230',
    artistId: '00000000-0000-4000-8000-000000000221',
    submittedByUserId: '00000000-0000-4000-8000-000000000220',
    reviewedByUserId: null,
    status: 'pending',
    sourceType: 'youtube',
    url: 'https://www.youtube.com/watch?v=abc',
    canonicalUrl: 'https://www.youtube.com/watch?v=abc',
    artistDescription: 'Behind the scenes rehearsal update.',
    summary: 'Behind the scenes rehearsal update.',
    allowChatReference: true,
    rejectionReason: null,
    metadata: {},
    createdAt: new Date('2026-05-22T00:00:00.000Z'),
    updatedAt: new Date('2026-05-22T00:00:00.000Z'),
    reviewedAt: null,
    archivedAt: null,
    artist: {
      id: '00000000-0000-4000-8000-000000000221',
      slug: 'test-creator',
      displayName: 'Test Creator',
      status: 'active',
    },
    submittedBy: {
      id: '00000000-0000-4000-8000-000000000220',
      email: 'creator@example.com',
    },
    reviewedBy: null,
  };

  function createKnowledgeService(overrides: Record<string, unknown> = {}) {
    const prisma = {
      artistKnowledgeUrl: {
        findMany: jest.fn().mockResolvedValue([row]),
        findUnique: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue({
          ...row,
          status: 'approved',
          reviewedByUserId: adminUser.id,
          reviewedBy: { id: adminUser.id, email: adminUser.email },
          reviewedAt: new Date('2026-05-22T01:00:00.000Z'),
        }),
      },
      auditEvent: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      ...overrides,
    };
    const config = { get: jest.fn() };
    const service = new AdminService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );

    return { service, prisma };
  }

  it('approves pending artist knowledge URLs and makes them chat eligible', async () => {
    const { service, prisma } = createKnowledgeService();

    const result = await service.approveBackstageArtistKnowledgeUrl(
      adminUser as never,
      row.id,
      { summary: 'Approved artist-provided summary.' },
    );

    expect(prisma.artistKnowledgeUrl.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: row.id },
        data: expect.objectContaining({
          status: 'approved',
          summary: 'Approved artist-provided summary.',
          rejectionReason: null,
          reviewedByUserId: adminUser.id,
        }),
      }),
    );
    expect(prisma.auditEvent.create).toHaveBeenCalled();
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: adminUser.id,
          actorType: 'admin',
          action: 'artist_knowledge_url.approve',
          targetType: 'artist_knowledge_url',
          targetId: row.id,
          beforeData: expect.objectContaining({
            status: 'pending',
            artistId: row.artistId,
            summaryPresent: true,
          }),
          afterData: expect.objectContaining({
            status: 'approved',
            artistId: row.artistId,
            summaryPresent: true,
          }),
          metadata: expect.objectContaining({
            statusTransition: { from: 'pending', to: 'approved' },
            rawUrlStored: false,
            rawPageBodyStored: false,
            tokenCookiePasswordStored: false,
            providerPayloadStored: false,
            dbUrlStored: false,
          }),
        }),
      }),
    );
    const auditPayload = JSON.stringify(prisma.auditEvent.create.mock.calls[0][0]);
    expect(auditPayload).not.toContain('https://www.youtube.com/watch?v=abc');
    expect(auditPayload).not.toContain('Approved artist-provided summary.');
    expect(auditPayload).not.toContain('Behind the scenes rehearsal update.');
    expect(result).toMatchObject({
      item: {
        status: 'approved',
        chatReference: {
          eligible: true,
          approvedOnly: true,
          rawUrlIncludedInPrompt: false,
        },
      },
      contract: {
        resultingStatus: 'approved',
        chatEligibleAfterApprove: true,
      },
    });
  });

  it('returns stable user-facing errors for invalid filters and missing rejection reason', async () => {
    const { service } = createKnowledgeService();

    await expectHttpError(service.getBackstageArtistKnowledgeUrls({ status: 'draft' }), {
      code: 'ARTIST_KNOWLEDGE_URL_STATUS_INVALID',
      messageKey: 'artistKnowledgeUrl.error.statusInvalid',
    });

    await expectHttpError(
      service.rejectBackstageArtistKnowledgeUrl(adminUser as never, row.id, {}),
      {
        code: 'ARTIST_KNOWLEDGE_URL_REJECTION_REASON_REQUIRED',
        messageKey: 'artistKnowledgeUrl.error.rejectionReasonRequired',
      },
    );
  });

  it('returns redacted artist knowledge audit events through the dedicated read model', async () => {
    const rawUrl = 'https://artist.example/watch?token=unsafe-url-token';
    const rawSummary = 'Approved raw summary must not be returned.';
    const rawReason = 'Private rejection reason must not be returned.';
    const auditRow = {
      id: '00000000-0000-4000-8000-000000000777',
      actorUserId: adminUser.id,
      action: 'artist_knowledge_url.reject',
      targetType: 'artist_knowledge_url',
      targetId: row.id,
      beforeData: {
        contractVersion: '2026-05-24.artist-url-knowledge-audit.v1',
        id: row.id,
        artistId: row.artistId,
        submittedByUserId: row.submittedByUserId,
        reviewedByUserId: null,
        status: 'pending',
        sourceType: 'youtube',
        allowChatReference: true,
        summaryPresent: true,
        rejectionReasonPresent: false,
        reviewedAt: null,
        archivedAt: null,
        url: rawUrl,
        rawUrl,
        summary: rawSummary,
      },
      afterData: {
        contractVersion: '2026-05-24.artist-url-knowledge-audit.v1',
        id: row.id,
        artistId: row.artistId,
        submittedByUserId: row.submittedByUserId,
        reviewedByUserId: adminUser.id,
        status: 'rejected',
        sourceType: 'youtube',
        allowChatReference: false,
        summaryPresent: true,
        rejectionReasonPresent: true,
        reviewedAt: '2026-05-22T02:00:00.000Z',
        archivedAt: null,
        rejectionReason: rawReason,
      },
      metadata: {
        statusTransition: { from: 'pending', to: 'rejected' },
        changedFields: ['status', 'reviewedByUserId', 'rawUrl', 'summary', 'rejectionReason'],
        token: 'unsafe-token',
        cookie: 'unsafe-cookie',
      },
      createdAt: new Date('2026-05-22T02:00:00.000Z'),
    };
    const { service, prisma } = createKnowledgeService({
      auditEvent: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
        findMany: jest.fn().mockResolvedValue([auditRow]),
      },
    });

    const result = await service.getBackstageArtistKnowledgeUrlAuditEvents({
      action: 'artist_knowledge_url.reject',
      artistId: row.artistId,
    });
    const auditEvent = prisma.auditEvent as typeof prisma.auditEvent & {
      findMany: jest.Mock;
    };

    expect(auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          action: 'artist_knowledge_url.reject',
          targetType: 'artist_knowledge_url',
          targetId: { not: null },
          OR: [
            { beforeData: { path: ['artistId'], equals: row.artistId } },
            { afterData: { path: ['artistId'], equals: row.artistId } },
          ],
        }),
        orderBy: [{ createdAt: 'desc' }],
        select: expect.objectContaining({
          beforeData: true,
          afterData: true,
          metadata: true,
        }),
      }),
    );
    expect(result).toMatchObject({
      items: [
        {
          action: 'artist_knowledge_url.reject',
          targetType: 'artist_knowledge_url',
          targetId: row.id,
          afterData: {
            status: 'rejected',
            reviewedByUserId: adminUser.id,
            rejectionReasonPresent: true,
          },
          metadata: {
            changedFields: ['status', 'reviewedByUserId'],
            sensitiveDataStored: false,
            rawUrlStored: false,
            rawUrlQueryStored: false,
            rawEmailStored: false,
            tokenCookiePasswordStored: false,
            providerPayloadStored: false,
            dbUrlStored: false,
          },
        },
      ],
      contract: expect.objectContaining({
        permission: 'audit:read',
        mutation: false,
        rawUrlReturned: false,
        rawUrlQueryReturned: false,
        rawEmailReturned: false,
        providerPayloadReturned: false,
      }),
      policy: expect.objectContaining({
        permission: 'audit:read',
        mutation: false,
        rawUrlReturned: false,
      }),
    });
    const payload = JSON.stringify(result);
    expect(payload).not.toContain(rawUrl);
    expect(payload).not.toContain(rawSummary);
    expect(payload).not.toContain(rawReason);
    expect(payload).not.toContain('unsafe-token');
    expect(payload).not.toContain('unsafe-cookie');
  });
});

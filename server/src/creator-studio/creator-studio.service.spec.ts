import { HttpException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { CreatorStudioService } from './creator-studio.service';

const userId = '00000000-0000-4000-8000-000000000220';
const artistId = '00000000-0000-4000-8000-000000000221';

function serviceWithPreview(preview: Record<string, unknown>) {
  const service = new CreatorStudioService({} as never, { get: jest.fn() } as never);
  jest.spyOn(service, 'getSettlementPreview').mockResolvedValue(preview as never);

  return service;
}

function preview(overrides: Record<string, unknown> = {}) {
  const base = {
    period: {
      label: '2026-05',
      start: new Date('2026-05-01T00:00:00.000Z'),
      end: new Date('2026-06-01T00:00:00.000Z'),
    },
    policy: {
      unitPriceKrw: new Decimal(10),
      vatRateBps: 1000,
      pgFeeRateBps: 250,
      pgFeeVatRateBps: 1000,
      aiCostRateBps: 0,
      directCostRateBps: 0,
      settlementRateBps: 8000,
      platformMinimumMarginBps: 1000,
      status: 'preview_only',
    },
    items: [
      {
        artist: {
          id: artistId,
          slug: 'test-creator',
          displayName: 'Test Creator',
          status: 'active',
          sortOrder: 1,
        },
        operator: {
          id: '00000000-0000-4000-8000-000000000222',
          role: 'owner',
          permissions: [],
        },
        eventCount: 2,
        grossLumina: new Decimal(100),
        productBreakdown: {},
        financials: {
          grossRevenueKrw: new Decimal(1000),
          vatKrw: new Decimal('90.90909090909090909091'),
          vatExcludedRevenueKrw: new Decimal('909.09090909090909091'),
          pgFeeKrw: new Decimal(25),
          pgFeeVatKrw: new Decimal('2.5'),
          aiCostKrw: new Decimal(0),
          directCostKrw: new Decimal(0),
          netRevenueKrw: new Decimal('881.59090909090909091'),
          settlementRateBps: 8000,
          creatorShareKrw: new Decimal(720),
          platformShareKrw: new Decimal('88.159090909090909091'),
          riskReserveKrw: new Decimal('73.431818181818181819'),
        },
        status: 'estimated',
      },
    ],
    totals: {
      eventCount: 2,
      grossLumina: new Decimal(100),
      grossRevenueKrw: new Decimal(1000),
      netRevenueKrw: new Decimal('881.59090909090909091'),
      creatorShareKrw: new Decimal(720),
      platformShareKrw: new Decimal('88.159090909090909091'),
      riskReserveKrw: new Decimal('73.431818181818181819'),
    },
    policyNotes: {
      payoutUnit: 'operator_user',
      previewOnly: true,
      includedSources: ['chat'],
      excludedSources: ['free_like'],
    },
    notice: 'preview only',
  };

  return { ...base, ...overrides };
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

describe('CreatorStudioService.getPayoutSummary', () => {
  it('returns creator-facing five-card payout summary without source breakdown', async () => {
    const service = serviceWithPreview(preview());

    const result = await service.getPayoutSummary(userId, { period: '2026-05' });

    expect(result.cards.map((card) => card.id)).toEqual([
      'grossLumina',
      'eligibleLumina',
      'grossAmount',
      'taxAmount',
      'netAmount',
    ]);
    expect(result.totals).toMatchObject({
      grossLumina: '100',
      eligibleLumina: '100',
      grossAmount: { amount: '720.00', currency: 'KRW' },
      taxAmount: { amount: '23.76', currency: 'KRW' },
      netAmount: { amount: '696.24', currency: 'KRW' },
      currency: 'KRW',
      shareRate: { bps: 8000, percent: '80' },
      settlementTier: 'general',
    });
    expect(result.fxSnapshot).toMatchObject({
      settlementCurrency: 'KRW',
      snapshotStatus: 'krw_base_no_fx',
      safeMarginRangeBps: { min: 300, max: 500 },
    });
    expect(result.artists[0]).toMatchObject({
      grossLumina: '100',
      eligibleLumina: '100',
      settlementTier: 'general',
      policy: { hidePayoutRow: false },
    });
    expect(result.artists[0]).not.toHaveProperty('productBreakdown');
    expect(result.policy).toMatchObject({
      readOnly: true,
      payoutMutationOpen: false,
      walletMutation: false,
      settlementConfirmationOpen: false,
      sourceBreakdownVisibleToCreator: false,
      internalSourceVisibility: 'backstage_only',
    });
  });

  it('hides payout row when no active creator operator revenue scope exists', async () => {
    const service = serviceWithPreview(
      preview({
        items: [],
        totals: {
          eventCount: 0,
          grossLumina: new Decimal(0),
          grossRevenueKrw: new Decimal(0),
          netRevenueKrw: new Decimal(0),
          creatorShareKrw: new Decimal(0),
          platformShareKrw: new Decimal(0),
          riskReserveKrw: new Decimal(0),
        },
      }),
    );

    const result = await service.getPayoutSummary(userId, { period: '2026-05' });

    expect(result.policy).toMatchObject({
      hidePayoutRow: true,
      hideReason: 'no_active_artist_operator',
    });
    expect(result.totals).toMatchObject({
      grossLumina: '0',
      grossAmount: { amount: '0.00', currency: 'KRW' },
      taxAmount: { amount: '0.00', currency: 'KRW' },
      netAmount: { amount: '0.00', currency: 'KRW' },
    });
  });
});

describe('CreatorStudioService artist knowledge URLs', () => {
  const authUser = {
    id: userId,
    email: 'creator@example.com',
    role: 'user',
  };
  const row = {
    id: '00000000-0000-4000-8000-000000000230',
    artistId,
    submittedByUserId: userId,
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
  };

  function serviceWithKnowledgePrisma(overrides: Record<string, unknown> = {}) {
    const prisma = {
      artistOperator: {
        findFirst: jest.fn().mockResolvedValue({ id: 'operator-1' }),
        findMany: jest.fn().mockResolvedValue([{ artistId }]),
      },
      artistKnowledgeUrl: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([row]),
        findUnique: jest.fn().mockResolvedValue(row),
        create: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue(row),
      },
      ...overrides,
    };
    const service = new CreatorStudioService(
      prisma as never,
      { get: jest.fn() } as never,
    );

    return { service, prisma };
  }

  it('creates artist-submitted URLs as pending and keeps chat reference blocked before approval', async () => {
    const { service, prisma } = serviceWithKnowledgePrisma();

    const result = await service.createKnowledgeUrl(authUser as never, {
      artistId,
      type: 'youtube',
      url: 'https://www.youtube.com/watch?v=abc',
      description: 'Behind the scenes rehearsal update.',
      allowChatRef: true,
    });

    expect(prisma.artistOperator.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId,
          artistId,
          status: 'active',
          revokedAt: null,
        }),
      }),
    );
    expect(prisma.artistKnowledgeUrl.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          artistId,
          submittedByUserId: userId,
          status: 'pending',
          sourceType: 'youtube',
          canonicalUrl: 'https://www.youtube.com/watch?v=abc',
          summary: 'Behind the scenes rehearsal update.',
          allowChatReference: true,
        }),
      }),
    );
    expect(result).toMatchObject({
      item: {
        status: 'pending',
        allowChatRef: true,
        chatReference: {
          eligible: false,
          approvedOnly: true,
          rawUrlIncludedInPrompt: false,
        },
      },
      contract: {
        resultingStatus: 'pending',
        chatEligibleAfterCreate: false,
      },
    });
  });

  it('returns a stable user-facing error when the artist is not managed by the creator', async () => {
    const { service } = serviceWithKnowledgePrisma({
      artistOperator: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });

    await expectHttpError(
      service.createKnowledgeUrl(authUser as never, {
        artistId,
        type: 'youtube',
        url: 'https://www.youtube.com/watch?v=abc',
        description: 'Behind the scenes rehearsal update.',
        allowChatRef: true,
      }),
      {
        code: 'ARTIST_KNOWLEDGE_URL_ACCESS_REQUIRED',
        messageKey: 'artistKnowledgeUrl.error.accessRequired',
      },
    );
  });

  it('returns stable validation errors for malformed artist knowledge URL input', async () => {
    const { service } = serviceWithKnowledgePrisma();

    await expectHttpError(
      service.createKnowledgeUrl(authUser as never, {
        artistId,
        type: 'video',
        url: 'https://www.youtube.com/watch?v=abc',
        description: 'Behind the scenes rehearsal update.',
        allowChatRef: true,
      }),
      {
        code: 'ARTIST_KNOWLEDGE_URL_TYPE_INVALID',
        messageKey: 'artistKnowledgeUrl.error.typeInvalid',
      },
    );

    await expectHttpError(
      service.createKnowledgeUrl(authUser as never, {
        artistId,
        type: 'youtube',
        url: 'javascript:alert(1)',
        description: 'Behind the scenes rehearsal update.',
        allowChatRef: true,
      }),
      {
        code: 'ARTIST_KNOWLEDGE_URL_INVALID_URL',
        messageKey: 'artistKnowledgeUrl.error.invalidUrl',
      },
    );

    await expectHttpError(
      service.createKnowledgeUrl(authUser as never, {
        artistId,
        type: 'youtube',
        url: 'https://www.youtube.com/watch?v=abc',
        description: '   ',
        allowChatRef: true,
      }),
      {
        code: 'ARTIST_KNOWLEDGE_URL_DESCRIPTION_REQUIRED',
        messageKey: 'artistKnowledgeUrl.error.descriptionRequired',
      },
    );
  });

  it('reopens approved URL edits as pending and clears review fields', async () => {
    const approved = {
      ...row,
      status: 'approved',
      reviewedByUserId: '00000000-0000-4000-8000-000000000240',
      reviewedAt: new Date('2026-05-22T01:00:00.000Z'),
    };
    const { service, prisma } = serviceWithKnowledgePrisma({
      artistKnowledgeUrl: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(approved),
        update: jest.fn().mockResolvedValue({ ...approved, status: 'pending' }),
      },
    });

    await service.updateKnowledgeUrl(authUser as never, approved.id, {
      description: 'Updated artist-provided summary.',
    });

    expect(prisma.artistKnowledgeUrl.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: approved.id },
        data: expect.objectContaining({
          status: 'pending',
          reviewedByUserId: null,
          reviewedAt: null,
          rejectionReason: null,
          summary: 'Updated artist-provided summary.',
        }),
      }),
    );
  });
});

import { ChatService } from './chat.service';

describe('ChatService.getStarterPrompts', () => {
  it('returns readable Korean default starter prompt copy', async () => {
    const prisma = {
      artist: {
        findFirst: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000206',
          slug: 'yoon-serin',
          displayName: '윤세린',
          publicProfile: {
            publicMetadata: {},
            tagline: '무대 위의 첫 인사',
            personalityKeywords: ['다정함'],
          },
          contentProfile: {
            contentTone: 'warm',
          },
        }),
      },
    };
    const llmProvider = {
      readiness: jest.fn().mockReturnValue({
        provider: 'not_configured',
        configured: false,
        status: 'provider_not_configured',
        messageKey: 'chat.generation.providerNotConfigured',
      }),
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    const result = await service.getStarterPrompts({ artistSlug: 'yoon-serin' });

    expect(result.source).toBe('default');
    expect(result.sets).toHaveLength(1);
    expect(result.sets[0]).toMatchObject({
      id: 'yoon-serin-soft-start-1',
      guideText: '처음이라 조금 어색하죠? 윤세린에게 이렇게 말을 걸어볼까요?',
      directInput: {
        key: 'C',
        label: '직접 입력하기',
      },
    });
    expect(result.sets[0].options).toEqual([
      {
        key: 'A',
        label: '오늘 어땠는지 물어보기',
        message: '오늘 하루 어땠어? 괜히 윤세린 생각이 나서 들렀어.',
      },
      {
        key: 'B',
        label: '조용히 응원하기',
        message: '오늘도 윤세린의 무대를 기다리고 있어. 천천히 와도 괜찮아.',
      },
    ]);
    expect(JSON.stringify(result.sets[0])).not.toMatch(/[�泥怨嫄]/);
  });
});

describe('ChatService persona and catalog policy', () => {
  const llmProvider = {
    readiness: jest.fn().mockReturnValue({
      provider: 'not_configured',
      configured: false,
      status: 'provider_not_configured',
      messageKey: 'chat.generation.providerNotConfigured',
    }),
  };

  it('returns read-only persona seed policy with tag conflicts and examples', () => {
    const service = new ChatService({} as never, llmProvider as never);

    const result = service.getPersonaSeedPolicy();

    expect(result.schemaMigrationRequired).toBe(false);
    expect(result.tagCatalog.length).toBeGreaterThanOrEqual(20);
    expect(result.conflictRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'block',
          tags: ['introverted', 'very_extroverted'],
        }),
      ]),
    );
    expect(result.seedExamples.length).toBeGreaterThanOrEqual(2);
    expect(result.safety).toMatchObject({
      readOnly: true,
      llmCall: false,
      walletMutation: false,
      secretsReturned: false,
    });
  });

  it('returns character-specific greeting catalog without request mutations', async () => {
    const prisma = {
      artist: {
        findFirst: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000206',
          slug: 'yoon-serin',
          displayName: '윤세린',
          publicProfile: {
            publicMetadata: {
              chatCatalog: {
                greetingText: '세린이 조용히 손을 흔들며 인사를 건네요.',
                statusLabelKo: '세린 대화 준비됨',
              },
            },
            tagline: '무대 위의 첫 인사',
            personalityKeywords: ['다정함', '우아함'],
          },
          contentProfile: {
            contentTone: 'warm',
          },
        }),
      },
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    const result = await service.getCharacterChatCatalog({
      artistSlug: 'yoon-serin',
    });

    expect(result.artist).toMatchObject({
      slug: 'yoon-serin',
      displayName: '윤세린',
    });
    expect(result.status).toMatchObject({
      key: 'chat_ready',
      labelKo: '세린 대화 준비됨',
    });
    expect(result.greeting).toMatchObject({
      text: '세린이 조용히 손을 흔들며 인사를 건네요.',
      source: 'artist_metadata',
    });
    expect(result.starterOptions.length).toBeGreaterThanOrEqual(3);
    expect(result.directInput).toMatchObject({
      enabled: true,
      key: 'C',
    });
    expect(result.policy.gallery).toMatchObject({
      mode: 'conversation_archive',
      externalPublicGalleryLink: false,
      requestMutationEnabled: false,
    });
    expect(result.policy.shortVideoRequest).toMatchObject({
      visibleInMvp: false,
      enabled: false,
      requestMutationEnabled: false,
    });
    expect(result.policy.safety).toMatchObject({
      readOnly: true,
      llmCall: false,
      walletMutation: false,
      imageRequestMutation: false,
      videoRequestMutation: false,
    });
  });
});

describe('ChatService character-chat skeleton', () => {
  const llmProvider = {
    readiness: jest.fn().mockReturnValue({
      provider: 'not_configured',
      configured: false,
      status: 'provider_not_configured',
      messageKey: 'chat.generation.providerNotConfigured',
    }),
    generate: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a character-chat session after active artist validation', async () => {
    const prisma = {
      artist: {
        findFirst: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000231',
          slug: 'yoon-serin',
          displayName: '윤세린',
          publicProfile: null,
          contentProfile: null,
        }),
      },
      chatSession: {
        create: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000001',
          userId: '00000000-0000-4000-8000-000000000002',
          artistId: '00000000-0000-4000-8000-000000000231',
          chatPersonaId: null,
          status: 'active',
        }),
      },
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    const result = await service.createCharacterChatSession(
      '00000000-0000-4000-8000-000000000002',
      { artistId: '00000000-0000-4000-8000-000000000231' },
    );

    expect(prisma.artist.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: '00000000-0000-4000-8000-000000000231',
          status: 'active',
        }),
      }),
    );
    expect(prisma.chatSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: '00000000-0000-4000-8000-000000000002',
          artistId: '00000000-0000-4000-8000-000000000231',
          status: 'active',
        }),
      }),
    );
    expect(result.policy).toMatchObject({
      requiresAuth: true,
      ownSessionOnly: true,
      llmCall: false,
      walletMutation: false,
    });
  });

  it('stores only the user message and returns pending AI reply without wallet or LLM mutation', async () => {
    const tx = {
      chatMessage: {
        create: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000003',
          chatSessionId: '00000000-0000-4000-8000-000000000231',
          senderType: 'user',
          messageType: 'text',
          body: '오늘은 어떤 이야기를 해볼까?',
        }),
      },
      chatSession: {
        update: jest.fn().mockResolvedValue({}),
      },
      walletAccount: {
        updateMany: jest.fn(),
      },
      walletLedger: {
        create: jest.fn(),
      },
    };
    const prisma = {
      chatSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000231',
          userId: '00000000-0000-4000-8000-000000000002',
          artistId: '00000000-0000-4000-8000-000000000001',
          chatPersonaId: null,
          status: 'active',
        }),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    const result = await service.createCharacterChatUserMessage(
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000231',
      { body: '오늘은 어떤 이야기를 해볼까?' },
    );

    expect(tx.chatMessage.create).toHaveBeenCalledTimes(1);
    expect(tx.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          senderType: 'user',
          body: '오늘은 어떤 이야기를 해볼까?',
          modelMetadata: expect.objectContaining({
            generationStatus: 'not_requested',
            provider: 'not_called',
          }),
          safetyMetadata: expect.objectContaining({
            llmCall: false,
            walletMutation: false,
          }),
        }),
      }),
    );
    expect(tx.walletAccount.updateMany).not.toHaveBeenCalled();
    expect(tx.walletLedger.create).not.toHaveBeenCalled();
    expect(llmProvider.generate).not.toHaveBeenCalled();
    expect(result.aiReply).toMatchObject({
      status: 'pending_provider',
      llmCall: false,
      walletMutation: false,
    });
  });

  it('returns read-only monetization and ledger policy without user-facing paid/free split', () => {
    const service = new ChatService({} as never, llmProvider as never);

    const result = service.getCharacterChatMonetizationPolicy();

    expect(result.currency).toMatchObject({
      userBalancePresentation: 'single_balance',
      doNotSplitPaidAndFreeInUserUi: true,
    });
    expect(result.products.fanLetters.map((item) => item.priceLumina)).toEqual([
      30, 50, 100,
    ]);
    expect(result.products.characterChatReplies.map((item) => item.priceLumina)).toEqual([
      2, 5, 10,
    ]);
    expect(result.ledgerContract.creditSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'ad_reward' }),
        expect.objectContaining({ source: 'promotion_reward' }),
      ]),
    );
    expect(result.safety).toMatchObject({
      readOnly: true,
      walletMutation: false,
      settlementMutation: false,
      paymentMutation: false,
    });
  });
});

describe('ChatService.preflightMessage', () => {
  const llmProvider = {
    readiness: jest.fn().mockReturnValue({
      provider: 'not_configured',
      configured: false,
      status: 'provider_not_configured',
      messageKey: 'chat.generation.providerNotConfigured',
    }),
  };

  it('returns provider-not-configured without wallet mutation', async () => {
    const prisma = {
      chatSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000214',
          artistId: '00000000-0000-4000-8000-000000000001',
          status: 'active',
        }),
      },
      chatMessage: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    const result = await service.preflightMessage(
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000214',
      { mode: 'daily_talk', body: '오늘은 어떤 하루였어?' },
    );

    expect(result).toMatchObject({
      canSend: false,
      canGenerate: false,
      mode: 'daily_talk',
      provider: {
        configured: false,
        status: 'provider_not_configured',
      },
      disabledReason: 'provider_not_configured',
      messageKey: 'chat.generation.providerNotConfigured',
      walletMutation: false,
      settlementEligible: false,
    });
    expect(result.limits).toMatchObject({
      cooldownSeconds: 30,
      dailyLimit: 50,
      dailyUsed: 0,
      dailyRemaining: 50,
      maxInputChars: 1000,
    });
  });

  it('returns cooldown state before provider readiness wins', async () => {
    const prisma = {
      chatSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000214',
          artistId: '00000000-0000-4000-8000-000000000001',
          status: 'active',
        }),
      },
      chatMessage: {
        findFirst: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000003',
          createdAt: new Date(),
        }),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    const result = await service.preflightMessage(
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000214',
      { body: '방금 다시 말 걸어도 돼?' },
    );

    expect(result).toMatchObject({
      canSend: false,
      canGenerate: false,
      disabledReason: 'cooldown_active',
      messageKey: 'chat.generation.cooldownActive',
      walletMutation: false,
    });
    expect(result.limits.cooldownRemainingSeconds).toBeGreaterThan(0);
  });

  it('returns daily limit state before provider readiness wins', async () => {
    const prisma = {
      chatSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000214',
          artistId: '00000000-0000-4000-8000-000000000001',
          status: 'active',
        }),
      },
      chatMessage: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(50),
      },
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    const result = await service.preflightMessage(
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000214',
      { body: '오늘 마지막으로 한 번만 더 말 걸게.' },
    );

    expect(result).toMatchObject({
      canSend: false,
      canGenerate: false,
      disabledReason: 'daily_limit_reached',
      messageKey: 'chat.generation.dailyLimitReached',
      walletMutation: false,
    });
    expect(result.limits).toMatchObject({
      dailyLimit: 50,
      dailyUsed: 50,
      dailyRemaining: 0,
    });
  });

  it('counts daily usage from the Asia/Seoul service day boundary', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-12T01:30:00.000Z'));

    try {
      const count = jest.fn().mockResolvedValue(0);
      const prisma = {
        chatSession: {
          findFirst: jest.fn().mockResolvedValue({
            id: '00000000-0000-4000-8000-000000000214',
            artistId: '00000000-0000-4000-8000-000000000001',
            status: 'active',
          }),
        },
        chatMessage: {
          findFirst: jest.fn().mockResolvedValue(null),
          count,
        },
      };
      const service = new ChatService(prisma as never, llmProvider as never);

      const result = await service.preflightMessage(
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000214',
        { body: 'KST boundary check' },
      );

      expect(count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: new Date('2026-05-11T15:00:00.000Z') },
          }),
        }),
      );
      expect(result.limits).toMatchObject({
        serviceDayTimeZone: 'Asia/Seoul',
        serviceDayStartAt: '2026-05-11T15:00:00.000Z',
      });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('ChatService.createMessage safety', () => {
  const llmProvider = {
    readiness: jest.fn().mockReturnValue({
      provider: 'not_configured',
      configured: false,
      status: 'provider_not_configured',
      messageKey: 'chat.generation.providerNotConfigured',
    }),
  };

  it('fails closed before creating a free message when provider is not configured', async () => {
    const prisma = {
      chatSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000214',
          artistId: '00000000-0000-4000-8000-000000000001',
          status: 'active',
        }),
      },
      chatMessage: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn(),
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    await expect(
      service.createMessage(
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000214',
        { body: 'provider missing should block storage too' },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'CHAT_LLM_PROVIDER_NOT_CONFIGURED',
        messageKey: 'chat.generation.providerNotConfigured',
        walletMutation: false,
      }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects oversized free messages before creating chat_messages rows', async () => {
    const prisma = {
      chatSession: { findFirst: jest.fn() },
      chatMessage: {
        findFirst: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    await expect(
      service.createMessage(
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000214',
        { body: 'x'.repeat(1001) },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'CHAT_GENERATION_INVALID_BODY',
        messageKey: 'chat.generation.invalidBody',
      }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.chatMessage.findFirst).not.toHaveBeenCalled();
    expect(prisma.chatMessage.count).not.toHaveBeenCalled();
  });
});

describe('ChatService.createFeatureOrder safety', () => {
  const llmProvider = {
    readiness: jest.fn().mockReturnValue({
      provider: 'not_configured',
      configured: false,
      status: 'provider_not_configured',
      messageKey: 'chat.generation.providerNotConfigured',
    }),
  };
  const product = {
    id: '00000000-0000-4000-8000-000000000004',
    sku: 'CHAT_DEEP_REPLY',
    name: 'Deep Reply',
    featureType: 'deep_reply',
    priceLumina: 2,
    status: 'active',
    metadata: {},
  };

  it('requires idempotency before opening a wallet-affecting transaction', async () => {
    const prisma = {
      chatSession: { findFirst: jest.fn() },
      chatFeatureProduct: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    await expect(
      service.createFeatureOrder('00000000-0000-4000-8000-000000000002', {
        chatSessionId: '00000000-0000-4000-8000-000000000214',
        chatFeatureProductId: product.id,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'CHAT_FEATURE_ORDER_IDEMPOTENCY_REQUIRED',
        messageKey: 'chat.order.idempotencyRequired',
      }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails closed before wallet lookup when provider is not configured', async () => {
    const tx = {
      chatFeatureOrder: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      walletAccount: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      walletLedger: {
        create: jest.fn(),
      },
    };
    const prisma = {
      chatSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000214',
          artistId: '00000000-0000-4000-8000-000000000001',
          status: 'active',
        }),
      },
      chatFeatureProduct: {
        findFirst: jest.fn().mockResolvedValue(product),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    await expect(
      service.createFeatureOrder('00000000-0000-4000-8000-000000000002', {
        chatSessionId: '00000000-0000-4000-8000-000000000214',
        chatFeatureProductId: product.id,
        idempotencyKey: 'chat-order-214',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'CHAT_LLM_PROVIDER_NOT_CONFIGURED',
        messageKey: 'chat.generation.providerNotConfigured',
        walletMutation: false,
      }),
    });
    expect(tx.walletAccount.findUnique).not.toHaveBeenCalled();
    expect(tx.walletAccount.updateMany).not.toHaveBeenCalled();
    expect(tx.walletLedger.create).not.toHaveBeenCalled();
  });
});

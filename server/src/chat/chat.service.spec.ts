import { ChatService } from './chat.service';
import { ChatLlmProviderRequestError } from './llm-provider.adapter';

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

  it('returns static persona trait catalog with custom-field contract', () => {
    const service = new ChatService({} as never, llmProvider as never);

    const result = service.getPersonaTraitCatalog();

    expect(result).toMatchObject({
      catalogVersion: '2026-05-14.chat-persona-trait-catalog-v1',
      source: 'static',
      readOnly: true,
      customFieldContract: {
        enabled: true,
        reviewRequired: true,
      },
      starterPromptReference: {
        enabled: true,
      },
      safety: {
        readOnly: true,
        llmCall: false,
        walletMutation: false,
        settlementMutation: false,
        secretsReturned: false,
      },
    });
    expect(result.traits.length).toBeGreaterThanOrEqual(20);
    expect(result.traits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'introverted',
          labelKo: '내성적인',
          conflictsWith: ['very_extroverted'],
        }),
        expect.objectContaining({
          id: 'very_extroverted',
          labelKo: '매우 외향적인',
          conflictsWith: ['introverted'],
        }),
      ]),
    );
    expect(result.conflictRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'introvert_extrovert_block',
          severity: 'block',
          traitIds: ['introverted', 'very_extroverted'],
        }),
      ]),
    );
    expect(result.customFieldContract.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'customTraitsKo',
          type: 'string_list',
        }),
        expect.objectContaining({
          id: 'fanNicknameKo',
          type: 'short_text',
        }),
      ]),
    );
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

  it('returns starter prompt persona references from artist metadata', async () => {
    const prisma = {
      artist: {
        findFirst: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000239',
          slug: 'han-bora',
          displayName: '한보라',
          publicProfile: {
            publicMetadata: {
              chatPersonaSeed: {
                selectedTraitIds: [
                  'warm',
                  'quiet_comfort',
                  'introverted',
                  'not-in-catalog',
                ],
                customTraitsKo: ['새벽 감성', '무심한 응원'],
                fanNicknameKo: '별빛이',
                relationshipToneKo: '무대 뒤에서 조용히 응원받는 거리감',
                favoriteTopicsKo: ['무대 준비', '밤 산책'],
                openingMoodKo: '조심스럽게',
              },
            },
            tagline: '새벽의 보컬',
            personalityKeywords: ['다정함'],
          },
          contentProfile: {
            contentTone: 'warm',
          },
        }),
      },
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    const result = await service.getStarterPrompts({ artistSlug: 'han-bora' });

    expect(result.personaReference).toMatchObject({
      catalogVersion: '2026-05-14.chat-persona-trait-catalog-v1',
      selectedTraitIds: ['warm', 'quiet_comfort', 'introverted'],
      customFields: {
        customTraitsKo: ['새벽 감성', '무심한 응원'],
        fanNicknameKo: '별빛이',
        relationshipToneKo: '무대 뒤에서 조용히 응원받는 거리감',
        favoriteTopicsKo: ['무대 준비', '밤 산책'],
        openingMoodKo: '조심스럽게',
      },
      source: 'artist_metadata',
      readOnly: true,
      mutationEnabled: false,
    });
    expect(result.personaReference.selectedTraits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'warm',
          labelKo: '다정한',
        }),
        expect.objectContaining({
          id: 'quiet_comfort',
          labelKo: '조용한 위로',
        }),
      ]),
    );
  });
});

describe('ChatService provider ops guard', () => {
  const userId = '00000000-0000-4000-8000-000000000242';
  const readyState = {
    provider: 'openai',
    configured: true,
    status: 'provider_ready',
    messageKey: 'chat.generation.ready',
  };

  it('returns read-only provider usage status without exposing secrets or mutations', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-14T04:00:00.000Z'));

    try {
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: userId,
            email: 'ops@example.com',
          }),
        },
        chatMessage: {
          findMany: jest.fn().mockResolvedValue([
            {
              modelMetadata: {
                provider: 'openai',
                model: 'gpt-5-mini',
                usage: {
                  inputTokens: 12,
                  outputTokens: 24,
                  estimatedCostKrw: '0.04',
                },
                estimatedCostKrw: '0.04',
              },
              safetyMetadata: {
                provider: 'openai',
                generationStatus: 'completed',
              },
            },
            {
              modelMetadata: {
                provider: 'openai',
                model: 'fallback',
                usage: {
                  inputTokens: 0,
                  outputTokens: 0,
                  estimatedCostKrw: '0.00',
                },
                estimatedCostKrw: '0.00',
              },
              safetyMetadata: {
                provider: 'openai',
                generationStatus: 'fallback',
                reason: 'provider_timeout',
              },
            },
          ]),
        },
      };
      const llmProvider = {
        readiness: jest.fn().mockReturnValue(readyState),
      };
      const service = new ChatService(prisma as never, llmProvider as never);

      const result = await service.getProviderOpsStatus(userId);

      expect(llmProvider.readiness).toHaveBeenCalledWith({
        userId,
        userEmail: 'ops@example.com',
      });
      expect(result).toMatchObject({
        serviceDay: {
          timeZone: 'Asia/Seoul',
          startedAt: '2026-05-13T15:00:00.000Z',
        },
        provider: {
          name: 'openai',
          configured: true,
          status: 'provider_ready',
        },
        guard: {
          providerDailyRequestLimit: 50,
          providerDailyFailureLimit: 5,
          requestRemaining: 48,
          failureRemaining: 4,
          canAttemptProvider: true,
          walletMutation: false,
          settlementMutation: false,
        },
        usage: {
          totalResponses: 2,
          failureCount: 1,
          fallbackCount: 1,
          estimatedCostKrw: '0.04',
        },
        walletMutation: false,
        settlementMutation: false,
        secretsReturned: false,
      });
      expect(result.usage.usageByModel).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            provider: 'openai',
            model: 'gpt-5-mini',
            responses: 1,
            inputTokens: 12,
            outputTokens: 24,
            estimatedCostKrw: '0.04',
          }),
          expect.objectContaining({
            provider: 'openai',
            model: 'fallback',
            responses: 1,
            estimatedCostKrw: '0.00',
          }),
        ]),
      );
    } finally {
      jest.useRealTimers();
    }
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
        findMany: jest.fn().mockResolvedValue([]),
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
        findMany: jest.fn().mockResolvedValue([]),
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
        findMany: jest.fn().mockResolvedValue([]),
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

  it('blocks provider calls after the daily provider failure limit', async () => {
    const llmProvider = {
      readiness: jest.fn().mockReturnValue({
        provider: 'openai',
        configured: true,
        status: 'provider_ready',
        messageKey: 'chat.generation.ready',
      }),
    };
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
        findMany: jest.fn().mockResolvedValue(
          Array.from({ length: 5 }, () => ({
            modelMetadata: {
              provider: 'openai',
              model: 'fallback',
              usage: {
                inputTokens: 0,
                outputTokens: 0,
                estimatedCostKrw: '0.00',
              },
              estimatedCostKrw: '0.00',
            },
            safetyMetadata: {
              provider: 'openai',
              generationStatus: 'fallback',
              reason: 'provider_timeout',
            },
          })),
        ),
      },
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    const result = await service.preflightMessage(
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000214',
      { body: 'provider failures should fail closed' },
    );

    expect(result).toMatchObject({
      canSend: false,
      canGenerate: false,
      disabledReason: 'provider_failure_limit_reached',
      messageKey: 'chat.generation.providerFailureLimitReached',
      walletMutation: false,
    });
    expect(result.limits).toMatchObject({
      providerDailyFailureLimit: 5,
      providerDailyFailureCount: 5,
      providerDailyFailureRemaining: 0,
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
          findMany: jest.fn().mockResolvedValue([]),
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
        findMany: jest.fn().mockResolvedValue([]),
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

describe('ChatService.generateMessage provider beta', () => {
  const userId = '00000000-0000-4000-8000-000000000002';
  const sessionId = '00000000-0000-4000-8000-000000000214';
  const session = {
    id: sessionId,
    artistId: '00000000-0000-4000-8000-000000000001',
    chatPersonaId: '00000000-0000-4000-8000-000000000003',
    status: 'active',
    artist: {
      id: '00000000-0000-4000-8000-000000000001',
      slug: 'yoon-serin',
      displayName: '윤세린',
    },
    chatPersona: {
      id: '00000000-0000-4000-8000-000000000003',
      name: 'soft-dm',
      systemPrompt: '짧고 따뜻하게 답한다.',
      safetyRules: {},
      modelConfig: {},
    },
  };
  const readyState = {
    provider: 'openai',
    configured: true,
    status: 'provider_ready',
    messageKey: 'chat.generation.ready',
  };

  function prismaForGenerate(tx: Record<string, unknown>) {
    return {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: userId,
          email: 'beta@example.com',
        }),
      },
      chatSession: {
        findFirst: jest.fn().mockResolvedValue(session),
      },
      chatMessage: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      walletAccount: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      walletLedger: {
        create: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
  }

  function persistTx(aiBody: string) {
    return {
      chatMessage: {
        create: jest
          .fn()
          .mockResolvedValueOnce({
            id: '00000000-0000-4000-8000-000000000010',
            senderType: 'user',
            body: '오늘 조금 지쳤어.',
          })
          .mockResolvedValueOnce({
            id: '00000000-0000-4000-8000-000000000011',
            senderType: 'artist',
            body: aiBody,
            modelMetadata: {},
          }),
      },
      chatSession: {
        update: jest.fn().mockResolvedValue({ id: sessionId }),
      },
    };
  }

  it('passes allowlisted user context to the provider without wallet mutation', async () => {
    const tx = persistTx('조금 쉬어도 괜찮아. 오늘은 천천히 가자.');
    const prisma = prismaForGenerate(tx);
    const llmProvider = {
      readiness: jest.fn().mockReturnValue(readyState),
      generate: jest.fn().mockResolvedValue({
        body: '조금 쉬어도 괜찮아. 오늘은 천천히 가자.',
        usage: {
          provider: 'openai',
          model: 'gpt-5-mini',
          inputTokens: 11,
          outputTokens: 12,
          estimatedCostKrw: '0.00',
        },
        safetyMetadata: {
          requestId: 'req_237_service',
        },
      }),
      fallbackResult: jest.fn(),
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    const result = await service.generateMessage(userId, sessionId, {
      body: '오늘 조금 지쳤어.',
    });

    expect(result).toMatchObject({
      generationStatus: 'completed',
      usage: {
        provider: 'openai',
        model: 'gpt-5-mini',
      },
    });
    expect(llmProvider.readiness).toHaveBeenCalledWith({
      userId,
      userEmail: 'beta@example.com',
    });
    expect(llmProvider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        userEmail: 'beta@example.com',
        userMessage: '오늘 조금 지쳤어.',
      }),
    );
    expect(prisma.walletAccount.findUnique).not.toHaveBeenCalled();
    expect(prisma.walletAccount.updateMany).not.toHaveBeenCalled();
    expect(prisma.walletLedger.create).not.toHaveBeenCalled();
    expect(tx.chatMessage.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          senderType: 'artist',
          modelMetadata: expect.objectContaining({
            usageSchemaVersion: '2026-05-14.chat-provider-usage-v1',
            provider: 'openai',
            model: 'gpt-5-mini',
            usage: expect.objectContaining({
              inputTokens: 11,
              outputTokens: 12,
            }),
            opsGuard: expect.objectContaining({
              policyVersion: '2026-05-14.chat-llm-ops-guard-v1',
              serviceDayTimeZone: 'Asia/Seoul',
              countedForDailyLimit: true,
            }),
          }),
        }),
      }),
    );
  });

  it('stores a safe fallback reply instead of throwing on provider request errors', async () => {
    const tx = persistTx('지금은 답장을 준비하는 중이에요. 잠시 후 다시 말을 걸어주세요.');
    const prisma = prismaForGenerate(tx);
    const providerError = new ChatLlmProviderRequestError(
      'request failed',
      'provider_timeout',
      'req_237_timeout',
    );
    const llmProvider = {
      readiness: jest.fn().mockReturnValue(readyState),
      generate: jest.fn().mockRejectedValue(providerError),
      fallbackResult: jest.fn().mockReturnValue({
        body: '지금은 답장을 준비하는 중이에요. 잠시 후 다시 말을 걸어주세요.',
        usage: {
          provider: 'openai',
          model: 'fallback',
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostKrw: '0.00',
        },
        safetyMetadata: {
          generationStatus: 'fallback',
          reason: 'provider_timeout',
          requestId: 'req_237_timeout',
        },
      }),
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    const result = await service.generateMessage(userId, sessionId, {
      body: '오늘 조금 지쳤어.',
    });

    expect(result).toMatchObject({
      generationStatus: 'fallback',
      requestId: 'req_237_timeout',
      message: {
        senderType: 'artist',
        body: '지금은 답장을 준비하는 중이에요. 잠시 후 다시 말을 걸어주세요.',
      },
    });
    expect(llmProvider.fallbackResult).toHaveBeenCalledWith(providerError);
    expect(prisma.walletAccount.findUnique).not.toHaveBeenCalled();
    expect(prisma.walletAccount.updateMany).not.toHaveBeenCalled();
    expect(prisma.walletLedger.create).not.toHaveBeenCalled();
  });
});

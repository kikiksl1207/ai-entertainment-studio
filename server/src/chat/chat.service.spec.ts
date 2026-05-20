import { ChatService } from './chat.service';
import { ChatLlmProviderRequestError } from './llm-provider.adapter';

describe('ChatService.getStarterPrompts', () => {
  it('returns readable Korean default starter prompt copy', async () => {
    const prisma = {
      artist: {
        findFirst: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000206',
          slug: 'oh-hyerin',
          displayName: '오혜린',
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

    const result = await service.getStarterPrompts({ artistSlug: 'oh-hyerin' });

    expect(result.source).toBe('legacy_artist_profile');
    expect(result.sets).toHaveLength(1);
    expect(result.sets[0]).toMatchObject({
      id: 'oh-hyerin-soft-start-1',
      guideText: '처음이라 조금 어색하죠? 오혜린에게 이렇게 말을 걸어볼까요?',
      directInput: {
        key: 'C',
        label: '직접 입력하기',
      },
    });
    expect(result.sets[0].options).toEqual([
      {
        key: 'A',
        label: '오늘 어땠는지 물어보기',
        message: '오늘 하루 어땠어? 괜히 오혜린 생각이 나서 들렀어.',
      },
      {
        key: 'B',
        label: '조용히 응원하기',
        message: '오늘도 오혜린의 무대를 기다리고 있어. 천천히 와도 괜찮아.',
      },
    ]);
    expect(JSON.stringify(result.sets[0])).not.toMatch(/[�泥怨嫄]/);
  });
});

describe('ChatService.getConversationList', () => {
  const userId = '00000000-0000-4000-8000-000000000270';
  const llmProvider = {
    readiness: jest.fn(),
  };

  beforeEach(() => {
    llmProvider.readiness.mockReset();
  });

  it('returns owner-only recent conversation summaries without LLM or wallet mutation', async () => {
    const prisma = {
      chatSession: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: '00000000-0000-4000-8000-000000000271',
            userId,
            artistId: '00000000-0000-4000-8000-000000000272',
            chatPersonaId: null,
            status: 'active',
            createdAt: new Date('2026-05-16T00:00:00.000Z'),
            updatedAt: new Date('2026-05-16T00:05:00.000Z'),
            artist: {
              id: '00000000-0000-4000-8000-000000000272',
              slug: 'yoon-serin',
              displayName: 'Yoon Serin',
            },
            chatPersona: null,
            messages: [
              {
                id: '00000000-0000-4000-8000-000000000273',
                senderType: 'artist',
                messageType: 'text',
                body: '오늘도 조용히 곁에 있을게요.',
                chatFeatureOrderId: null,
                modelMetadata: { providerSecret: 'must-not-return' },
                safetyMetadata: { internal: 'must-not-return' },
                createdAt: new Date('2026-05-16T00:06:00.000Z'),
              },
            ],
            _count: {
              messages: 3,
            },
          },
        ]),
      },
      chatMessage: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      walletAccount: {
        updateMany: jest.fn(),
      },
      walletLedger: {
        create: jest.fn(),
      },
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    const result = await service.getConversationList(userId, {
      box: 'recent',
      take: 10,
    });
    const payload = JSON.stringify(result);

    expect(prisma.chatSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId, status: 'active' },
        take: 11,
        include: expect.objectContaining({
          messages: expect.objectContaining({
            take: 1,
            orderBy: { createdAt: 'desc' },
          }),
        }),
      }),
    );
    expect(result).toMatchObject({
      readOnly: true,
      ownerOnly: true,
      box: 'recent',
      count: 1,
      hasMore: false,
      nextCursor: null,
      paginationContract: {
        defaultTake: 20,
        maxTake: 50,
        appliedTake: 10,
        cursor: null,
        cursorField: 'chat_sessions.id',
      },
      boxContract: {
        recentStatus: 'active',
        archiveStatus: 'archived',
        allStatuses: ['active', 'archived'],
      },
      itemShapeContract: {
        itemsAlwaysArray: true,
        emptyItemsAllowed: true,
        lastMessagePreviewMaxChars: 120,
        lastMessageRawBodyReturned: false,
        modelMetadataReturned: false,
        safetyMetadataReturned: false,
      },
      readStateContract: {
        supported: false,
        status: 'not_tracked',
        hasUnread: false,
        unreadCount: null,
        lastReadAt: null,
        badgeVisible: false,
        source: 'not_persisted',
        messageKey: 'chat.conversations.readStateNotAvailable',
      },
      latestMessageContract: {
        aliasOf: 'lastMessage',
        previewField: 'bodyPreview',
        previewRawBodyReturned: false,
        pendingProviderMessageKey:
          'chat.conversations.latestMessage.pendingProvider',
        providerFailureMessageKey:
          'chat.conversations.latestMessage.providerFailed',
        emptyMessageKey: 'chat.conversations.latestMessage.empty',
      },
      archiveContract: {
        supported: true,
        mutationEnabled: true,
        actions: ['archive', 'restore'],
        archivePathTemplate: '/api/v1/chat/conversations/:sessionId/archive',
        restorePathTemplate: '/api/v1/chat/conversations/:sessionId/restore',
      },
      safety: {
        llmCall: false,
        walletMutation: false,
        messageMutation: false,
        orderMutation: false,
      },
    });
    expect(result.items[0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000271',
      box: 'recent',
      artist: {
        slug: 'yoon-serin',
        displayName: 'Yoon Serin',
      },
      messageCount: 3,
      lastMessage: {
        id: '00000000-0000-4000-8000-000000000273',
        senderType: 'artist',
        messageType: 'text',
        bodyPreview: '오늘도 조용히 곁에 있을게요.',
        previewMessageKey: null,
        previewAvailable: true,
        paidFeatureOrderPresent: false,
      },
      latestMessage: {
        id: '00000000-0000-4000-8000-000000000273',
        bodyPreview: '오늘도 조용히 곁에 있을게요.',
        previewMessageKey: null,
        previewAvailable: true,
        paidFeatureOrderPresent: false,
      },
      latestAt: new Date('2026-05-16T00:06:00.000Z'),
      readState: {
        supported: false,
        status: 'not_tracked',
        hasUnread: false,
        unreadCount: null,
        lastReadAt: null,
        badgeVisible: false,
        source: 'not_persisted',
        messageKey: 'chat.conversations.readStateNotAvailable',
      },
    });
    expect(llmProvider.readiness).not.toHaveBeenCalled();
    expect(prisma.chatMessage.create).not.toHaveBeenCalled();
    expect(prisma.chatMessage.findMany).not.toHaveBeenCalled();
    expect(prisma.walletAccount.updateMany).not.toHaveBeenCalled();
    expect(prisma.walletLedger.create).not.toHaveBeenCalled();
    expect(payload).not.toContain('must-not-return');
  });

  it('returns stable latest message keys for pending provider previews without provider calls', async () => {
    const prisma = {
      chatSession: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: '00000000-0000-4000-8000-000000000281',
            userId,
            artistId: '00000000-0000-4000-8000-000000000282',
            chatPersonaId: null,
            status: 'active',
            createdAt: new Date('2026-05-17T00:00:00.000Z'),
            updatedAt: new Date('2026-05-17T00:03:00.000Z'),
            artist: {
              id: '00000000-0000-4000-8000-000000000282',
              slug: 'seo-yuan',
              displayName: 'Seo Yuan',
            },
            chatPersona: null,
            messages: [
              {
                id: '00000000-0000-4000-8000-000000000283',
                senderType: 'artist',
                messageType: 'pending_provider',
                body: null,
                chatFeatureOrderId: null,
                createdAt: new Date('2026-05-17T00:04:00.000Z'),
              },
            ],
            _count: {
              messages: 1,
            },
          },
        ]),
      },
      chatMessage: {
        create: jest.fn(),
      },
      walletAccount: {
        updateMany: jest.fn(),
      },
      walletLedger: {
        create: jest.fn(),
      },
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    const result = await service.getConversationList(userId, { box: 'recent' });

    expect(result.items[0]).toMatchObject({
      lastMessage: {
        messageType: 'pending_provider',
        bodyPreview: null,
        previewAvailable: false,
        previewMessageKey: 'chat.conversations.latestMessage.pendingProvider',
      },
      latestMessage: {
        messageType: 'pending_provider',
        bodyPreview: null,
        previewMessageKey: 'chat.conversations.latestMessage.pendingProvider',
      },
      readState: {
        status: 'not_tracked',
        hasUnread: false,
        badgeVisible: false,
      },
    });
    expect(llmProvider.readiness).not.toHaveBeenCalled();
    expect(prisma.chatMessage.create).not.toHaveBeenCalled();
    expect(prisma.walletAccount.updateMany).not.toHaveBeenCalled();
    expect(prisma.walletLedger.create).not.toHaveBeenCalled();
  });

  it('filters the archive box with no generation side effects', async () => {
    const prisma = {
      chatSession: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    const result = await service.getConversationList(userId, { box: 'archive' });

    expect(prisma.chatSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId, status: 'archived' },
        take: 21,
      }),
    );
    expect(result).toMatchObject({
      box: 'archive',
      items: [],
      emptyState: {
        messageKey: 'chat.conversations.emptyArchive',
      },
      safety: {
        llmCall: false,
        walletMutation: false,
        messageMutation: false,
      },
    });
    expect(llmProvider.readiness).not.toHaveBeenCalled();
  });

  it('returns an explicit all-box empty state with the default limit contract', async () => {
    const prisma = {
      chatSession: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    const result = await service.getConversationList(userId, { box: 'all' });

    expect(prisma.chatSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId, status: { in: ['active', 'archived'] } },
        take: 21,
      }),
    );
    expect(result).toMatchObject({
      readOnly: true,
      ownerOnly: true,
      box: 'all',
      items: [],
      count: 0,
      hasMore: false,
      nextCursor: null,
      paginationContract: {
        defaultTake: 20,
        maxTake: 50,
        appliedTake: 20,
        cursor: null,
      },
      emptyState: {
        messageKey: 'chat.conversations.emptyAll',
      },
      safety: {
        llmCall: false,
        walletMutation: false,
        messageMutation: false,
        orderMutation: false,
        settlementMutation: false,
      },
    });
    expect(Array.isArray(result.items)).toBe(true);
    expect(llmProvider.readiness).not.toHaveBeenCalled();
  });

  it('returns populated archive summaries with pagination metadata', async () => {
    const prisma = {
      chatSession: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: '00000000-0000-4000-8000-000000000274',
            status: 'archived',
            createdAt: new Date('2026-05-15T00:00:00.000Z'),
            updatedAt: new Date('2026-05-15T00:10:00.000Z'),
            artist: {
              id: '00000000-0000-4000-8000-000000000275',
              slug: 'han-seoyul',
              displayName: 'Han Seoyul',
            },
            chatPersona: {
              id: '00000000-0000-4000-8000-000000000276',
              name: 'Soft Talk',
              status: 'active',
            },
            messages: [
              {
                id: '00000000-0000-4000-8000-000000000277',
                senderType: 'user',
                messageType: 'text',
                body: 'QA populated archive preview',
                chatFeatureOrderId: null,
                createdAt: new Date('2026-05-15T00:11:00.000Z'),
              },
            ],
            _count: {
              messages: 2,
            },
          },
          {
            id: '00000000-0000-4000-8000-000000000278',
            status: 'archived',
            createdAt: new Date('2026-05-14T00:00:00.000Z'),
            updatedAt: new Date('2026-05-14T00:10:00.000Z'),
            artist: {
              id: '00000000-0000-4000-8000-000000000279',
              slug: 'park-doa',
              displayName: 'Park Doa',
            },
            chatPersona: null,
            messages: [
              {
                id: '00000000-0000-4000-8000-000000000280',
                senderType: 'artist',
                messageType: 'text',
                body: 'Second archived item for cursor check',
                chatFeatureOrderId: null,
                createdAt: new Date('2026-05-14T00:11:00.000Z'),
              },
            ],
            _count: {
              messages: 1,
            },
          },
        ]),
      },
      chatMessage: {
        create: jest.fn(),
      },
      walletAccount: {
        updateMany: jest.fn(),
      },
      walletLedger: {
        create: jest.fn(),
      },
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    const result = await service.getConversationList(userId, {
      box: 'archive',
      take: 1,
    });

    expect(prisma.chatSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId, status: 'archived' },
        take: 2,
      }),
    );
    expect(result).toMatchObject({
      box: 'archive',
      count: 1,
      hasMore: true,
      nextCursor: '00000000-0000-4000-8000-000000000274',
      safety: {
        llmCall: false,
        walletMutation: false,
        messageMutation: false,
      },
    });
    expect(result.items[0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000274',
      box: 'archive',
      status: 'archived',
      messageCount: 2,
      lastMessage: {
        bodyPreview: 'QA populated archive preview',
        paidFeatureOrderPresent: false,
      },
      persona: {
        name: 'Soft Talk',
        status: 'active',
      },
    });
    expect(llmProvider.readiness).not.toHaveBeenCalled();
    expect(prisma.chatMessage.create).not.toHaveBeenCalled();
    expect(prisma.walletAccount.updateMany).not.toHaveBeenCalled();
    expect(prisma.walletLedger.create).not.toHaveBeenCalled();
  });

  it('rejects invalid conversation boxes before querying', async () => {
    const prisma = {
      chatSession: {
        findMany: jest.fn(),
      },
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    await expect(
      service.getConversationList(userId, { box: 'raw_active' }),
    ).rejects.toMatchObject({
      response: {
        code: 'CHAT_CONVERSATION_BOX_INVALID',
        messageKey: 'chat.conversations.invalidBox',
      },
    });
    expect(prisma.chatSession.findMany).not.toHaveBeenCalled();
  });

  it('rejects invalid take values before querying and caps oversized take', async () => {
    const prisma = {
      chatSession: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    await expect(
      service.getConversationList(userId, { take: 0 }),
    ).rejects.toMatchObject({
      response: {
        code: 'CHAT_CONVERSATION_TAKE_INVALID',
        messageKey: 'chat.conversations.invalidTake',
      },
    });
    expect(prisma.chatSession.findMany).not.toHaveBeenCalled();

    const result = await service.getConversationList(userId, { take: 99 });

    expect(prisma.chatSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 51,
      }),
    );
    expect(result.paginationContract).toMatchObject({
      maxTake: 50,
      appliedTake: 50,
    });
  });
});

describe('ChatService conversation archive/restore', () => {
  const userId = '00000000-0000-4000-8000-000000000290';
  const sessionId = '00000000-0000-4000-8000-000000000291';
  const llmProvider = {
    readiness: jest.fn(),
  };

  beforeEach(() => {
    llmProvider.readiness.mockReset();
  });

  function conversationRecord(status: string) {
    return {
      id: sessionId,
      status,
      createdAt: new Date('2026-05-18T00:00:00.000Z'),
      updatedAt: new Date('2026-05-18T00:01:00.000Z'),
      artist: {
        id: '00000000-0000-4000-8000-000000000292',
        slug: 'yoon-serin',
        displayName: 'Yoon Serin',
      },
      chatPersona: null,
      messages: [
        {
          id: '00000000-0000-4000-8000-000000000293',
          senderType: 'artist',
          messageType: 'text',
          body: 'Archive guard preview',
          chatFeatureOrderId: null,
          createdAt: new Date('2026-05-18T00:02:00.000Z'),
        },
      ],
      _count: {
        messages: 1,
      },
    };
  }

  it('archives an owned active conversation without LLM, message, wallet, or order mutation', async () => {
    const prisma = {
      chatSession: {
        findFirst: jest.fn().mockResolvedValue(conversationRecord('active')),
        update: jest.fn().mockResolvedValue(conversationRecord('archived')),
      },
      chatMessage: {
        create: jest.fn(),
      },
      chatFeatureOrder: {
        create: jest.fn(),
      },
      walletAccount: {
        updateMany: jest.fn(),
      },
      walletLedger: {
        create: jest.fn(),
      },
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    const result = await service.archiveConversation(userId, sessionId);

    expect(prisma.chatSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: sessionId, userId },
      }),
    );
    expect(prisma.chatSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: sessionId },
        data: { status: 'archived' },
      }),
    );
    expect(result).toMatchObject({
      ownerOnly: true,
      idempotent: true,
      action: 'archive',
      changed: true,
      targetStatus: 'archived',
      targetBox: 'archive',
      conversation: {
        id: sessionId,
        box: 'archive',
        status: 'archived',
        lastMessage: {
          bodyPreview: 'Archive guard preview',
        },
      },
      listImpact: {
        recent: false,
        archive: true,
        all: true,
      },
      safety: {
        llmCall: false,
        walletMutation: false,
        messageMutation: false,
        orderMutation: false,
        settlementMutation: false,
      },
    });
    expect(llmProvider.readiness).not.toHaveBeenCalled();
    expect(prisma.chatMessage.create).not.toHaveBeenCalled();
    expect(prisma.chatFeatureOrder.create).not.toHaveBeenCalled();
    expect(prisma.walletAccount.updateMany).not.toHaveBeenCalled();
    expect(prisma.walletLedger.create).not.toHaveBeenCalled();
  });

  it('treats archiving an already archived conversation as idempotent', async () => {
    const prisma = {
      chatSession: {
        findFirst: jest.fn().mockResolvedValue(conversationRecord('archived')),
        update: jest.fn(),
      },
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    const result = await service.archiveConversation(userId, sessionId);

    expect(prisma.chatSession.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      action: 'archive',
      changed: false,
      targetStatus: 'archived',
      targetBox: 'archive',
      conversation: {
        box: 'archive',
        status: 'archived',
      },
    });
  });

  it('restores an archived conversation and leaves active restore idempotent', async () => {
    const prisma = {
      chatSession: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(conversationRecord('archived'))
          .mockResolvedValueOnce(conversationRecord('active')),
        update: jest.fn().mockResolvedValue(conversationRecord('active')),
      },
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    const restored = await service.restoreConversation(userId, sessionId);
    const alreadyActive = await service.restoreConversation(userId, sessionId);

    expect(prisma.chatSession.update).toHaveBeenCalledTimes(1);
    expect(restored).toMatchObject({
      action: 'restore',
      changed: true,
      targetStatus: 'active',
      targetBox: 'recent',
      conversation: {
        box: 'recent',
        status: 'active',
      },
    });
    expect(alreadyActive).toMatchObject({
      action: 'restore',
      changed: false,
      targetStatus: 'active',
      targetBox: 'recent',
    });
    expect(llmProvider.readiness).not.toHaveBeenCalled();
  });

  it('does not expose another user conversation and rejects invalid status transitions', async () => {
    const prisma = {
      chatSession: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(conversationRecord('deleted')),
        update: jest.fn(),
      },
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    await expect(service.archiveConversation(userId, sessionId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.archiveConversation(userId, sessionId)).rejects.toMatchObject({
      response: {
        code: 'CHAT_CONVERSATION_STATUS_TRANSITION_INVALID',
        messageKey: 'chat.conversations.invalidStatusTransition',
      },
    });
    await expect(
      service.restoreConversation(userId, 'not-a-conversation-id'),
    ).rejects.toMatchObject({
      response: {
        code: 'CHAT_CONVERSATION_ID_INVALID',
        messageKey: 'chat.conversations.invalidConversationId',
      },
    });
    expect(prisma.chatSession.update).not.toHaveBeenCalled();
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

  it('returns distinct runtime persona contexts without provider calls', async () => {
    const artists = {
      'yoon-serin': {
        id: '00000000-0000-4000-8000-000000000314',
        slug: 'yoon-serin',
        displayName: '윤세린',
        publicProfile: {
          publicMetadata: {
            chatCatalog: {
              greetingText: '세린이 조용히 손을 흔들며 인사해요.',
              safetyNoteKo: '부드럽게 응원하되 현실 연예인처럼 말하지 않아요.',
            },
            chatStarterPromptSets: [
              {
                guideText: '세린에게 조용히 말을 걸어보세요.',
                options: [
                  {
                    key: 'A',
                    label: '오늘 기분 묻기',
                    message: '세린아, 오늘은 어떤 하루였어?',
                  },
                ],
              },
            ],
            chatPersonaSeed: {
              selectedTraitIds: ['warm', 'quiet_comfort', 'artist_pride'],
              customTraitsKo: ['따뜻한 응원'],
              blockedExpressionsKo: ['실존 인물 사칭'],
            },
          },
          tagline: '무대 앞의 첫 인사',
          personalityKeywords: ['다정함'],
        },
        contentProfile: {
          contentTone: 'warm',
        },
      },
      'cha-dohyun': {
        id: '00000000-0000-4000-8000-000000000315',
        slug: 'cha-dohyun',
        displayName: '차도현',
        publicProfile: {
          publicMetadata: {
            chatCatalog: {
              greetingText: '도현이 짧게 고개를 끄덕이며 기다려요.',
              safetyNoteKo: '거리를 지키고 과한 집착 표현을 피합니다.',
            },
            chatStarterPromptSets: [
              {
                guideText: '도현에게 낮은 목소리로 말을 걸어보세요.',
                options: [
                  {
                    key: 'A',
                    label: '조용히 안부 묻기',
                    message: '도현아, 지금 잠깐 이야기해도 돼?',
                  },
                ],
              },
            ],
            chatPersonaSeed: {
              selectedTraitIds: ['calm', 'mysterious', 'sharp_tension'],
              customTraitsKo: ['차분한 거리감'],
              blockedExpressionsKo: ['외부 연락처 교환'],
            },
          },
          tagline: '낮은 조명의 시선',
          personalityKeywords: ['차분함'],
        },
        contentProfile: {
          contentTone: 'calm',
        },
      },
      'ria-somi': {
        id: '00000000-0000-4000-8000-000000000316',
        slug: 'ria-somi',
        displayName: '리아소미',
        publicProfile: {
          publicMetadata: {
            chatCatalog: {
              greetingText: '소미가 먼저 밝게 손을 흔들어요.',
              safetyNoteKo: '장난스럽더라도 위험한 유도는 피합니다.',
            },
            chatStarterPromptSets: [
              {
                guideText: '소미에게 가볍게 말을 걸어보세요.',
                options: [
                  {
                    key: 'A',
                    label: '오늘 에너지 묻기',
                    message: '소미야, 오늘 텐션은 어때?',
                  },
                ],
              },
            ],
            chatPersonaSeed: {
              selectedTraitIds: ['playful', 'high_energy', 'daily_friend'],
              customTraitsKo: ['밝은 장난'],
              blockedExpressionsKo: ['성인/위험 대화 유도'],
            },
          },
          tagline: '밝은 리듬',
          personalityKeywords: ['활발함'],
        },
        contentProfile: {
          contentTone: 'high_energy',
        },
      },
    };
    const prisma = {
      artist: {
        findFirst: jest.fn(({ where }: { where: { slug: keyof typeof artists } }) =>
          Promise.resolve(artists[where.slug]),
        ),
      },
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    const results = await Promise.all(
      Object.keys(artists).map((artistSlug) =>
        service.getCharacterChatCatalog({ artistSlug }),
      ),
    );

    expect(new Set(results.map((result) => result.runtimePersona.welcome.text)).size).toBe(3);
    expect(results[0].runtimePersona.tone.toneTags).toEqual(
      expect.arrayContaining(['따뜻한 응원', '다정함']),
    );
    expect(results[1].runtimePersona.tone.toneTags).toEqual(
      expect.arrayContaining(['차분한 거리감', '차분함']),
    );
    expect(results[2].runtimePersona.tone.toneTags).toEqual(
      expect.arrayContaining(['밝은 장난', '활발함']),
    );
    expect(results[0].runtimePersona.forbiddenTone).toEqual(
      expect.arrayContaining(['실존 인물 사칭']),
    );
    expect(results[1].runtimePersona.safetyNote).toMatchObject({
      text: '거리를 지키고 과한 집착 표현을 피합니다.',
      source: 'artist_metadata',
    });
    expect(llmProvider.readiness).not.toHaveBeenCalled();
  });

  it('returns character-specific starter fallback copy when metadata has no starter sets', async () => {
    const artists = [
      ['yoon-serin', '윤세린'],
      ['han-seoyul', '한서율'],
      ['park-doa', '박도아'],
      ['choi-seojin', '최서진'],
      ['min-chaeon', '민채온'],
    ].map(([slug, displayName]) => ({
      id: `00000000-0000-4000-8000-${slug.replace(/-/g, '').slice(0, 12).padEnd(12, '0')}`,
      slug,
      displayName,
      publicProfile: {
        publicMetadata: {},
        tagline: null,
        personalityKeywords: [],
      },
      contentProfile: {
        contentTone: null,
      },
    }));
    const artistsBySlug = Object.fromEntries(
      artists.map((artist) => [artist.slug, artist]),
    );
    const prisma = {
      artist: {
        findFirst: jest.fn(({ where }: { where: { slug: string } }) =>
          Promise.resolve(artistsBySlug[where.slug]),
        ),
      },
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    const catalogs = await Promise.all(
      artists.map((artist) =>
        service.getCharacterChatCatalog({ artistSlug: artist.slug }),
      ),
    );
    const promptSets = await Promise.all(
      artists.map((artist) => service.getStarterPrompts({ artistSlug: artist.slug })),
    );

    expect(new Set(catalogs.map((catalog) => catalog.greeting.text)).size).toBe(5);
    expect(new Set(catalogs.map((catalog) => catalog.starterOptions[0].label)).size).toBe(5);
    expect(new Set(catalogs.map((catalog) => catalog.starterOptions[1].label)).size).toBe(5);
    expect(
      catalogs.every((catalog) => catalog.runtimePersona.source === 'character_fallback'),
    ).toBe(true);
    expect(promptSets.map((promptSet) => promptSet.sets[0].id)).toEqual([
      'yoon-serin-character-start-1',
      'han-seoyul-character-start-1',
      'park-doa-character-start-1',
      'choi-seojin-character-start-1',
      'min-chaeon-character-start-1',
    ]);
    expect(new Set(promptSets.map((promptSet) => promptSet.sets[0].options[0].label)).size).toBe(5);
    expect(llmProvider.readiness).not.toHaveBeenCalled();
  });

  it('returns read-only fallback catalog and starters when a public fallback artist row is absent', async () => {
    const prisma = {
      artist: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    const catalog = await service.getCharacterChatCatalog({
      artistSlug: 'min-chaeon',
    });
    const prompts = await service.getStarterPrompts({
      artistSlug: 'min-chaeon',
    });

    expect(prisma.artist.findFirst).toHaveBeenCalledTimes(2);
    expect(catalog.artist).toMatchObject({
      id: '00000000-0000-4000-8000-000000000605',
      slug: 'min-chaeon',
      displayName: '\uBBFC\uCC44\uC628',
    });
    expect(catalog.source).toBe('character_fallback');
    expect(catalog.runtimePersona.source).toBe('character_fallback');
    expect(catalog.greeting.source).toBe('character_fallback');
    expect(catalog.starterSets[0].id).toBe('min-chaeon-character-start-1');
    expect(prompts.source).toBe('character_fallback');
    expect(prompts.sets[0].id).toBe('min-chaeon-character-start-1');
    expect(prompts.sets[0].options[0].label).toBe(
      catalog.starterOptions[0].label,
    );
    expect(llmProvider.readiness).not.toHaveBeenCalled();
  });

  it('keeps unknown missing artist slugs blocked instead of using fallback copy', async () => {
    const prisma = {
      artist: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    await expect(
      service.getCharacterChatCatalog({ artistSlug: 'unknown-artist' }),
    ).rejects.toMatchObject({
      message: 'Artist not found',
    });
    await expect(
      service.getStarterPrompts({ artistSlug: 'unknown-artist' }),
    ).rejects.toMatchObject({
      message: 'Artist not found',
    });
    expect(llmProvider.readiness).not.toHaveBeenCalled();
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

describe('ChatService.getUsageSummary', () => {
  it('returns read-only chat usage limits without messages, wallet, or provider calls', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-14T04:00:00.000Z'));

    try {
      const prisma = {
        artist: {
          findFirst: jest.fn().mockResolvedValue({
            id: '00000000-0000-4000-8000-000000000001',
            slug: 'yoon-serin',
            displayName: 'Yoon Serin',
          }),
        },
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: '00000000-0000-4000-8000-000000000002',
            email: 'usage@example.com',
          }),
        },
        chatMessage: {
          findFirst: jest.fn().mockResolvedValue(null),
          count: jest.fn().mockResolvedValue(7),
          findMany: jest.fn().mockResolvedValue([]),
        },
      };
      const llmProvider = {
        readiness: jest.fn().mockReturnValue({
          provider: 'not_configured',
          configured: false,
          status: 'provider_not_configured',
          messageKey: 'chat.generation.providerNotConfigured',
        }),
        generate: jest.fn(),
      };
      const service = new ChatService(prisma as never, llmProvider as never);

      const result = await service.getUsageSummary(
        '00000000-0000-4000-8000-000000000002',
        { artistId: '00000000-0000-4000-8000-000000000001' },
      );

      expect(result).toMatchObject({
        artist: {
          id: '00000000-0000-4000-8000-000000000001',
          slug: 'yoon-serin',
        },
        canSend: false,
        canGenerate: false,
        disabledReason: 'provider_not_configured',
        cooldownSeconds: 30,
        cooldownRemainingSeconds: 0,
        dailyLimit: 50,
        dailyUsed: 7,
        dailyRemaining: 43,
        providerDailyLimit: 50,
        providerDailyUsed: 0,
        providerDailyRemaining: 50,
        serviceDayTimeZone: 'Asia/Seoul',
        serviceDayStartAt: '2026-05-13T15:00:00.000Z',
        maxInputChars: 1000,
        provider: {
          configured: false,
          status: 'provider_not_configured',
        },
        walletMutation: false,
        settlementEligible: false,
        providerCall: false,
        rawMessagesExposed: false,
      });
      expect(llmProvider.readiness).toHaveBeenCalledWith({
        userId: '00000000-0000-4000-8000-000000000002',
        userEmail: 'usage@example.com',
      });
      expect(llmProvider.generate).not.toHaveBeenCalled();
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

  it('uses user-scoped provider readiness before wallet lookup', async () => {
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
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000002',
          email: 'blocked@example.com',
        }),
      },
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
    const llmProvider = {
      readiness: jest.fn().mockReturnValue({
        provider: 'openai',
        configured: false,
        status: 'provider_not_allowed',
        messageKey: 'chat.generation.providerNotAllowed',
      }),
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    await expect(
      service.createFeatureOrder('00000000-0000-4000-8000-000000000002', {
        chatSessionId: '00000000-0000-4000-8000-000000000214',
        chatFeatureProductId: product.id,
        idempotencyKey: 'chat-order-denied',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'CHAT_LLM_PROVIDER_NOT_CONFIGURED',
        walletMutation: false,
      }),
    });
    expect(llmProvider.readiness).toHaveBeenCalledWith({
      userId: '00000000-0000-4000-8000-000000000002',
      userEmail: 'blocked@example.com',
    });
    expect(tx.walletAccount.findUnique).not.toHaveBeenCalled();
    expect(tx.walletAccount.updateMany).not.toHaveBeenCalled();
    expect(tx.walletLedger.create).not.toHaveBeenCalled();
  });

  it('blocks mvp-locked products before wallet lookup', async () => {
    const lockedProduct = {
      id: '00000000-0000-4000-8000-000000000024',
      sku: 'CHAT_IMAGE_REPLY',
      name: 'Image Reply',
      featureType: 'image_reply',
      priceLumina: 20,
      status: 'active',
      metadata: {},
    };
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
        findFirst: jest.fn().mockResolvedValue(lockedProduct),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const llmProvider = {
      readiness: jest.fn().mockReturnValue({
        provider: 'openai',
        configured: true,
        status: 'provider_ready',
        messageKey: 'chat.generation.ready',
      }),
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    await expect(
      service.createFeatureOrder('00000000-0000-4000-8000-000000000002', {
        chatSessionId: '00000000-0000-4000-8000-000000000214',
        chatFeatureProductId: lockedProduct.id,
        idempotencyKey: 'chat-order-locked',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'CHAT_FEATURE_PRODUCT_LOCKED',
        walletMutation: false,
      }),
    });
    expect(tx.walletAccount.findUnique).not.toHaveBeenCalled();
    expect(tx.walletAccount.updateMany).not.toHaveBeenCalled();
    expect(tx.walletLedger.create).not.toHaveBeenCalled();
  });

  it('rejects idempotency replay conflicts without wallet mutation', async () => {
    const tx = {
      chatFeatureOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000400',
          userId: '00000000-0000-4000-8000-000000000999',
          chatSessionId: '00000000-0000-4000-8000-000000000214',
          chatFeatureProductId: product.id,
          walletLedger: null,
          chatFeatureProduct: product,
        }),
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
    const llmProvider = {
      readiness: jest.fn().mockReturnValue({
        provider: 'openai',
        configured: true,
        status: 'provider_ready',
        messageKey: 'chat.generation.ready',
      }),
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    await expect(
      service.createFeatureOrder('00000000-0000-4000-8000-000000000002', {
        chatSessionId: '00000000-0000-4000-8000-000000000214',
        chatFeatureProductId: product.id,
        idempotencyKey: 'chat-order-conflict',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'CHAT_FEATURE_ORDER_IDEMPOTENCY_CONFLICT',
        walletMutation: false,
      }),
    });
    expect(tx.walletAccount.findUnique).not.toHaveBeenCalled();
    expect(tx.walletAccount.updateMany).not.toHaveBeenCalled();
    expect(tx.walletLedger.create).not.toHaveBeenCalled();
  });
});

describe('ChatService premium chat support contract', () => {
  it('returns a fail-closed donation and ranking contract without wallet mutation', () => {
    const prisma = {
      walletAccount: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      walletLedger: {
        create: jest.fn(),
      },
      chatFeatureOrder: {
        create: jest.fn(),
      },
      chatMessage: {
        create: jest.fn(),
      },
    };
    const service = new ChatService(prisma as never, {} as never);

    const contract = service.getPremiumSupportContract();

    expect(contract.donation.fixedAmountsLumina).toEqual([
      10,
      50,
      100,
      500,
      1000,
      5000,
      10000,
      50000,
    ]);
    expect(contract.policy.walletMutationEnabled).toBe(false);
    expect(contract.endpoints.donationCreate.enabled).toBe(false);
    expect(contract.donation.ledger.sources).toEqual([
      'premium_chat_open',
      'premium_chat_message',
      'premium_chat_donation',
    ]);
    expect(contract.rankings.like.excludes).toContain('premium_chat_donation');
    expect(contract.rankings.communication.scoreInputs).toContain(
      'premium_chat_donation',
    );
    expect(contract.rankings.donation.scoreInputs).toEqual([
      'premium_chat_donation',
    ]);
    expect(prisma.walletAccount.findUnique).not.toHaveBeenCalled();
    expect(prisma.walletAccount.updateMany).not.toHaveBeenCalled();
    expect(prisma.walletLedger.create).not.toHaveBeenCalled();
    expect(prisma.chatFeatureOrder.create).not.toHaveBeenCalled();
    expect(prisma.chatMessage.create).not.toHaveBeenCalled();
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
      publicProfile: {
        publicMetadata: {
          chatCatalog: {
            greetingText: '세린 런타임 인사',
            safetyNoteKo: '세린은 부드럽게 응원하고 fictional boundary를 지켜요.',
          },
          chatStarterPromptSets: [
            {
              guideText: '세린에게 조용히 말을 걸어보세요.',
              options: [
                {
                  key: 'A',
                  label: '오늘 기분 묻기',
                  message: '세린아, 오늘은 어떤 하루였어?',
                },
              ],
            },
          ],
          chatPersonaSeed: {
            selectedTraitIds: ['warm', 'quiet_comfort'],
            customTraitsKo: ['따뜻한 런타임'],
            blockedExpressionsKo: ['실존 인물 사칭'],
          },
        },
        tagline: '무대 앞의 첫 인사',
        personalityKeywords: ['다정함'],
      },
      contentProfile: {
        contentTone: 'warm',
      },
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
    expect(prisma.chatSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          artist: expect.objectContaining({
            select: expect.objectContaining({
              publicProfile: expect.objectContaining({
                select: expect.objectContaining({
                  publicMetadata: true,
                  tagline: true,
                  personalityKeywords: true,
                }),
              }),
              contentProfile: expect.objectContaining({
                select: expect.objectContaining({
                  contentTone: true,
                }),
              }),
            }),
          }),
        }),
      }),
    );
    expect(llmProvider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        userEmail: 'beta@example.com',
        userMessage: '오늘 조금 지쳤어.',
        runtimePersona: expect.objectContaining({
          welcome: expect.objectContaining({
            text: '세린 런타임 인사',
            source: 'artist_metadata',
          }),
          starterOptions: expect.arrayContaining([
            expect.objectContaining({
              label: '오늘 기분 묻기',
              message: '세린아, 오늘은 어떤 하루였어?',
            }),
          ]),
          tone: expect.objectContaining({
            toneTags: expect.arrayContaining(['따뜻한 런타임', '다정함']),
          }),
          forbiddenTone: expect.arrayContaining(['실존 인물 사칭']),
          safetyNote: expect.objectContaining({
            text: '세린은 부드럽게 응원하고 fictional boundary를 지켜요.',
            source: 'artist_metadata',
          }),
        }),
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

  it('refunds a paid order before provider calls when provider is unavailable', async () => {
    const paidProduct = {
      id: '00000000-0000-4000-8000-000000000004',
      sku: 'CHAT_DEEP_REPLY',
      name: 'Deep Reply',
      featureType: 'deep_reply',
      priceLumina: 2,
      status: 'active',
      metadata: {},
    };
    const paidOrder = {
      id: '00000000-0000-4000-8000-000000000777',
      userId,
      artistId: session.artistId,
      chatSessionId: session.id,
      chatFeatureProductId: paidProduct.id,
      status: 'completed',
      walletLedger: {
        id: '00000000-0000-4000-8000-000000000778',
        walletAccountId: '00000000-0000-4000-8000-000000000779',
        amount: 2,
      },
      chatFeatureProduct: paidProduct,
      messages: [],
    };
    const tx = {
      chatFeatureOrder: {
        findFirst: jest.fn().mockResolvedValue(paidOrder),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      walletLedger: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000780',
        }),
      },
      walletAccount: {
        update: jest.fn().mockResolvedValue({ id: paidOrder.walletLedger.walletAccountId }),
      },
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: userId,
          email: 'blocked@example.com',
        }),
      },
      chatSession: {
        findFirst: jest.fn().mockResolvedValue(session),
      },
      chatFeatureOrder: {
        findFirst: jest.fn().mockResolvedValue(paidOrder),
      },
      chatMessage: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const llmProvider = {
      readiness: jest.fn().mockReturnValue({
        provider: 'openai',
        configured: false,
        status: 'provider_not_allowed',
        messageKey: 'chat.generation.providerNotAllowed',
      }),
      generate: jest.fn(),
      fallbackResult: jest.fn(),
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    await expect(
      service.generateMessage(userId, sessionId, {
        body: 'paid reply please',
        chatFeatureOrderId: paidOrder.id,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'CHAT_LLM_PROVIDER_NOT_CONFIGURED',
        walletMutation: false,
      }),
    });
    expect(llmProvider.generate).not.toHaveBeenCalled();
    expect(prisma.chatMessage.findMany).not.toHaveBeenCalled();
    expect(tx.chatFeatureOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: paidOrder.id,
          status: { not: 'failed' },
        }),
      }),
    );
    expect(tx.walletLedger.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: `chat-feature-refund:${paidOrder.id}` },
    });
    expect(tx.walletAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: paidOrder.walletLedger.walletAccountId },
      }),
    );
    expect(tx.walletLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          direction: 'credit',
          ledgerType: 'refund',
          referenceId: paidOrder.id,
          idempotencyKey: `chat-feature-refund:${paidOrder.id}`,
        }),
      }),
    );
  });

  it('does not create a duplicate refund ledger for repeated paid generation failures', async () => {
    const paidProduct = {
      id: '00000000-0000-4000-8000-000000000004',
      sku: 'CHAT_DEEP_REPLY',
      name: 'Deep Reply',
      featureType: 'deep_reply',
      priceLumina: 2,
      status: 'active',
      metadata: {},
    };
    const paidOrder = {
      id: '00000000-0000-4000-8000-000000000781',
      userId,
      artistId: session.artistId,
      chatSessionId: session.id,
      chatFeatureProductId: paidProduct.id,
      status: 'completed',
      walletLedger: {
        id: '00000000-0000-4000-8000-000000000782',
        walletAccountId: '00000000-0000-4000-8000-000000000783',
        amount: 2,
      },
      chatFeatureProduct: paidProduct,
      messages: [],
    };
    const tx = {
      chatFeatureOrder: {
        findFirst: jest.fn().mockResolvedValue(paidOrder),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      walletLedger: {
        findUnique: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000784',
        }),
        create: jest.fn(),
      },
      walletAccount: {
        update: jest.fn(),
      },
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: userId,
          email: 'beta@example.com',
        }),
      },
      chatSession: {
        findFirst: jest.fn().mockResolvedValue(session),
      },
      chatFeatureOrder: {
        findFirst: jest.fn().mockResolvedValue(paidOrder),
      },
      chatMessage: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const llmProvider = {
      readiness: jest.fn().mockReturnValue(readyState),
      generate: jest.fn().mockRejectedValue(new Error('paid generation failed')),
      fallbackResult: jest.fn(),
    };
    const service = new ChatService(prisma as never, llmProvider as never);

    await expect(
      service.generateMessage(userId, sessionId, {
        body: 'paid reply please',
        chatFeatureOrderId: paidOrder.id,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'CHAT_LLM_GENERATION_FAILED',
      }),
    });
    expect(tx.walletLedger.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: `chat-feature-refund:${paidOrder.id}` },
    });
    expect(tx.walletAccount.update).not.toHaveBeenCalled();
    expect(tx.walletLedger.create).not.toHaveBeenCalled();
  });
});

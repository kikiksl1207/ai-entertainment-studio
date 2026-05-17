import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ChatGenerationResult,
  ChatLlmProviderAdapter,
  ChatLlmProviderNotConfiguredError,
  ChatLlmProviderRequestError,
  ChatLlmProviderReadiness,
} from './llm-provider.adapter';
import {
  CHAT_GENERATION_DISABLED_REASONS,
  PUBLIC_CHAT_FEATURE_TYPES,
  findChatFeatureProductPolicy,
} from './chat-feature-policy';
import {
  CHARACTER_CHAT_CATALOG_POLICY,
  CHAT_PERSONA_SEED_POLICY,
  CHAT_PERSONA_TRAIT_CATALOG,
  defaultCharacterGreeting,
  defaultCharacterStarterOptions,
  defaultCharacterStatus,
} from './chat-persona-catalog';

const DEFAULT_CURRENCY = 'LUMINA';
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const STARTER_PROMPT_POLICY = {
  showForFirstSession: true,
  hideAfterFirstMessage: true,
  allowDismiss: true,
  maxVisibleOptions: 2,
  directInputEnabled: true,
};
const DEFAULT_STARTER_PROMPT_COPY = {
  guideText: (artistDisplayName: string) =>
    `처음이라 조금 어색하죠? ${artistDisplayName}에게 이렇게 말을 걸어볼까요?`,
  options: [
    {
      key: 'A',
      label: '오늘 어땠는지 물어보기',
      message: (artistDisplayName: string) =>
        `오늘 하루 어땠어? 괜히 ${artistDisplayName} 생각이 나서 들렀어.`,
    },
    {
      key: 'B',
      label: '조용히 응원하기',
      message: (artistDisplayName: string) =>
        `오늘도 ${artistDisplayName}의 무대를 기다리고 있어. 천천히 와도 괜찮아.`,
    },
  ],
  directInputLabel: '직접 입력하기',
};

type StarterPromptOption = {
  key: string;
  label: string;
  message: string;
};

type StarterPromptSet = {
  id: string;
  guideText: string;
  options: StarterPromptOption[];
  directInput: {
    key: string;
    label: string;
  };
};
type ChatFeatureProductRecord = {
  id: string;
  sku: string;
  name: string;
  featureType: string;
  priceLumina: unknown;
  status: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};
type ChatProviderUserContext = {
  userId: string;
  userEmail: string | null;
};
type ChatProviderOpsStats = {
  totalResponses: number;
  failureCount: number;
  fallbackCount: number;
  usageByModel: Array<{
    provider: string;
    model: string;
    responses: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostKrw: string;
  }>;
  estimatedCostKrw: string;
};
type ChatConversationBox = 'recent' | 'archive' | 'all';
const BASIC_CHAT_POLICY = {
  mode: 'daily_talk',
  priceLumina: 0,
  modelTier: 'nano',
  cooldownSeconds: 30,
  dailyLimit: 50,
  maxInputChars: 1000,
  estimatedCostCeilingKrw: '0.20',
};
const CHAT_LLM_OPS_GUARD_POLICY = {
  policyVersion: '2026-05-14.chat-llm-ops-guard-v1',
  providerDailyRequestLimit: BASIC_CHAT_POLICY.dailyLimit,
  providerDailyFailureLimit: 5,
  cooldownSeconds: BASIC_CHAT_POLICY.cooldownSeconds,
  failClosed: true,
  usageMetadataPath: 'chat_messages.model_metadata.usage',
  safetyMetadataPath: 'chat_messages.safety_metadata',
  walletMutation: false,
  settlementMutation: false,
};
const KOREA_SERVICE_DAY_TIME_ZONE = 'Asia/Seoul';
const KOREA_SERVICE_DAY_OFFSET_MS = 9 * 60 * 60 * 1000;
const BASIC_CHAT_BLOCK_REASONS = {
  invalidMode: {
    reason: 'invalid_mode',
    code: 'CHAT_GENERATION_INVALID_MODE',
    messageKey: 'chat.generation.invalidMode',
    fallbackCopyKo: '지원하지 않는 대화 모드입니다.',
  },
  invalidBody: {
    reason: 'invalid_body',
    code: 'CHAT_GENERATION_INVALID_BODY',
    messageKey: 'chat.generation.invalidBody',
    fallbackCopyKo: '메시지는 1,000자 이하로 입력해주세요.',
  },
  cooldownActive: {
    reason: 'cooldown_active',
    code: 'CHAT_GENERATION_COOLDOWN_ACTIVE',
    messageKey: 'chat.generation.cooldownActive',
    fallbackCopyKo: '잠시 후 다시 말을 걸어주세요.',
  },
  dailyLimitReached: {
    reason: 'daily_limit_reached',
    code: 'CHAT_GENERATION_DAILY_LIMIT_REACHED',
    messageKey: 'chat.generation.dailyLimitReached',
    fallbackCopyKo: '오늘의 무료 대화 한도에 도달했어요.',
  },
  providerFailureLimitReached: {
    reason: 'provider_failure_limit_reached',
    code: 'CHAT_GENERATION_PROVIDER_FAILURE_LIMIT_REACHED',
    messageKey: 'chat.generation.providerFailureLimitReached',
    fallbackCopyKo:
      '\uc751\ub2f5\uc774 \uc548\uc815\ub420 \ub54c\uae4c\uc9c0 \uc7a0\uc2dc \ud6c4 \ub2e4\uc2dc \uc2dc\ub3c4\ud574 \uc8fc\uc138\uc694.',
  },
} as const;
const CHAT_FEATURE_ORDER_IDEMPOTENCY_REQUIRED = {
  code: 'CHAT_FEATURE_ORDER_IDEMPOTENCY_REQUIRED',
  messageKey: 'chat.order.idempotencyRequired',
  fallbackCopyKo: '주문을 안전하게 처리하려면 다시 시도해주세요.',
};
const CHAT_FEATURE_ORDER_CONFLICT = {
  code: 'CHAT_FEATURE_ORDER_IDEMPOTENCY_CONFLICT',
  messageKey: 'chat.order.idempotencyConflict',
  fallbackCopyKo:
    '\uc774\ubbf8 \ub2e4\ub978 \uc8fc\ubb38\uc5d0 \uc0ac\uc6a9\ub41c \uc694\uccad\uc774\uc5d0\uc694. \uc0c8\ub85c \uc2dc\ub3c4\ud574 \uc8fc\uc138\uc694.',
};
const CHAT_FEATURE_PRODUCT_LOCKED = {
  code: 'CHAT_FEATURE_PRODUCT_LOCKED',
  messageKey: CHAT_GENERATION_DISABLED_REASONS.mvpLocked.messageKey,
  fallbackCopyKo: CHAT_GENERATION_DISABLED_REASONS.mvpLocked.displayMessageKo,
};
const PAID_GENERATION_FEATURE_TYPES = new Set([
  'deep_reply',
  'story_reply',
  'premium_reply',
  'fan_letter',
  'special_reply',
  'image_reply',
  'voice_reply',
]);
const GENERATION_FAILURE_POLICY = {
  refundOnGenerationFailure: true,
  orderFailureStatus: 'failed',
  walletRecoveryLedgerType: 'refund',
  walletRecoveryReferenceType: 'chat_feature_order',
};

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmProvider: ChatLlmProviderAdapter,
  ) {}

  async createSession(
    userId: string,
    input: {
      artistId: string;
      chatPersonaId?: string;
    },
  ) {
    const artist = await this.prisma.artist.findFirst({
      where: { id: input.artistId, status: 'active' },
      select: { id: true },
    });

    if (!artist) {
      throw new NotFoundException('Artist not found');
    }

    if (input.chatPersonaId) {
      const persona = await this.prisma.chatPersona.findFirst({
        where: {
          id: input.chatPersonaId,
          artistId: input.artistId,
          status: 'active',
        },
      });

      if (!persona) {
        throw new NotFoundException('Chat persona not found');
      }
    }

    return this.prisma.chatSession.create({
      data: {
        userId,
        artistId: input.artistId,
        chatPersonaId: input.chatPersonaId,
        status: 'active',
      },
      include: {
        artist: {
          select: { id: true, slug: true, displayName: true },
        },
        chatPersona: true,
      },
    });
  }

  getSessions(userId: string) {
    return this.prisma.chatSession.findMany({
      where: { userId },
      include: {
        artist: {
          select: { id: true, slug: true, displayName: true },
        },
        chatPersona: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getConversationList(
    userId: string,
    input: {
      box?: string;
      take?: number;
      cursor?: string;
    } = {},
  ) {
    const box = this.normalizeConversationBox(input.box);
    const take = Math.min(input.take ?? 20, 50);
    const rows = await this.prisma.chatSession.findMany({
      where: this.conversationListWhere(userId, box),
      take: take + 1,
      ...(input.cursor
        ? {
            cursor: { id: this.validateCursor(input.cursor) },
            skip: 1,
          }
        : {}),
      include: {
        artist: {
          select: { id: true, slug: true, displayName: true },
        },
        chatPersona: {
          select: { id: true, name: true, status: true },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            senderType: true,
            messageType: true,
            body: true,
            chatFeatureOrderId: true,
            createdAt: true,
          },
        },
        _count: {
          select: { messages: true },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    const page = this.paginate(rows, take);

    return {
      readOnly: true,
      ownerOnly: true,
      box,
      items: page.items.map((session) => this.presentConversationListItem(session)),
      count: page.items.length,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      emptyState: this.conversationEmptyState(box),
      readStateContract: {
        supported: false,
        unreadCount: null,
        lastReadAt: null,
        reason: 'read_receipts_not_implemented',
        messageKey: 'chat.conversations.readStateNotAvailable',
      },
      archiveContract: {
        supported: true,
        mutationEnabled: false,
        statusField: 'chat_sessions.status',
        activeStatus: 'active',
        archivedStatus: 'archived',
      },
      safety: {
        llmCall: false,
        walletMutation: false,
        messageMutation: false,
        orderMutation: false,
        settlementMutation: false,
        secretsReturned: false,
      },
    };
  }

  getPersonaSeedPolicy() {
    return CHAT_PERSONA_SEED_POLICY;
  }

  getPersonaTraitCatalog() {
    return CHAT_PERSONA_TRAIT_CATALOG;
  }

  async getProviderOpsStatus(userId: string) {
    const now = new Date();
    const todayStart = this.koreaServiceDayStartUtc(now);
    const [providerUserContext, opsStats] = await Promise.all([
      this.getProviderUserContext(userId),
      this.providerOpsStatsForUser(userId, todayStart),
    ]);
    const readiness = this.llmProvider.readiness({
      userId: providerUserContext.userId,
      userEmail: providerUserContext.userEmail,
    });
    const requestRemaining = Math.max(
      0,
      CHAT_LLM_OPS_GUARD_POLICY.providerDailyRequestLimit -
        opsStats.totalResponses,
    );
    const failureRemaining = Math.max(
      0,
      CHAT_LLM_OPS_GUARD_POLICY.providerDailyFailureLimit -
        opsStats.failureCount,
    );

    return {
      serviceDay: {
        timeZone: KOREA_SERVICE_DAY_TIME_ZONE,
        startedAt: todayStart.toISOString(),
        checkedAt: now.toISOString(),
      },
      provider: this.providerDetails(readiness),
      guard: {
        ...CHAT_LLM_OPS_GUARD_POLICY,
        requestRemaining,
        failureRemaining,
        canAttemptProvider:
          readiness.configured && requestRemaining > 0 && failureRemaining > 0,
      },
      usage: {
        totalResponses: opsStats.totalResponses,
        failureCount: opsStats.failureCount,
        fallbackCount: opsStats.fallbackCount,
        usageByModel: opsStats.usageByModel,
        estimatedCostKrw: opsStats.estimatedCostKrw,
      },
      walletMutation: false,
      settlementMutation: false,
      secretsReturned: false,
    };
  }

  async getUsageSummary(
    userId: string,
    input: {
      artistId: string;
    },
  ) {
    const artist = await this.prisma.artist.findFirst({
      where: { id: input.artistId, status: 'active' },
      select: { id: true, slug: true, displayName: true },
    });

    if (!artist) {
      throw new NotFoundException('Artist not found');
    }

    const providerUserContext = await this.getProviderUserContext(userId);
    const preflight = await this.buildBasicChatPreflight(
      userId,
      { id: 'usage-summary', artistId: artist.id },
      '',
      BASIC_CHAT_POLICY.mode,
      providerUserContext,
    );

    return {
      artist,
      canSend: preflight.canSend,
      canGenerate: preflight.canGenerate,
      disabledReason: preflight.disabledReason,
      messageKey: preflight.messageKey,
      fallbackCopyKo: preflight.fallbackCopyKo,
      cooldownSeconds: preflight.limits.cooldownSeconds,
      cooldownRemainingSeconds: preflight.limits.cooldownRemainingSeconds,
      dailyLimit: preflight.limits.dailyLimit,
      dailyUsed: preflight.limits.dailyUsed,
      dailyRemaining: preflight.limits.dailyRemaining,
      providerDailyLimit: preflight.limits.providerDailyLimit,
      providerDailyUsed: preflight.limits.providerDailyUsed,
      providerDailyRemaining: preflight.limits.providerDailyRemaining,
      providerDailyFailureLimit: preflight.limits.providerDailyFailureLimit,
      providerDailyFailureCount: preflight.limits.providerDailyFailureCount,
      providerDailyFailureRemaining:
        preflight.limits.providerDailyFailureRemaining,
      serviceDayTimeZone: preflight.limits.serviceDayTimeZone,
      serviceDayStartAt: preflight.limits.serviceDayStartAt,
      maxInputChars: preflight.limits.maxInputChars,
      provider: preflight.provider,
      providerOps: preflight.providerOps,
      policy: preflight.policy,
      walletMutation: false,
      settlementEligible: false,
      providerCall: false,
      rawMessagesExposed: false,
    };
  }

  async getCharacterChatCatalog(input: { artistId?: string; artistSlug?: string }) {
    const artist = await this.findActiveChatArtist(input);
    const metadata = this.recordOrEmpty(artist.publicProfile?.publicMetadata);
    const catalogMetadata = this.recordOrEmpty(metadata.chatCatalog);
    const configuredSets = this.normalizeStarterPromptSets(
      metadata.chatStarterPromptSets,
    );
    const starterSet =
      configuredSets[0] ?? this.defaultStarterPromptSet(artist.slug, artist.displayName);
    const metadataGreeting = this.stringFromUnknown(catalogMetadata.greetingText);
    const statusLabelKo = this.stringFromUnknown(catalogMetadata.statusLabelKo);
    const statusDescriptionKo = this.stringFromUnknown(
      catalogMetadata.statusDescriptionKo,
    );
    const defaultStatus = defaultCharacterStatus();

    return {
      artist: {
        id: artist.id,
        slug: artist.slug,
        displayName: artist.displayName,
      },
      status: {
        key: defaultStatus.key,
        labelKo: statusLabelKo ?? defaultStatus.labelKo,
        descriptionKo: statusDescriptionKo ?? defaultStatus.descriptionKo,
      },
      greeting: {
        text: metadataGreeting ?? defaultCharacterGreeting(artist.displayName),
        source: metadataGreeting ? 'artist_metadata' : 'default',
      },
      starterOptions:
        starterSet.options.length > 0
          ? [
              ...starterSet.options,
              {
                key: starterSet.directInput.key,
                label: starterSet.directInput.label,
                message: '',
                directInput: true,
              },
            ].slice(0, CHARACTER_CHAT_CATALOG_POLICY.beginner.starterOptionMax)
          : defaultCharacterStarterOptions(artist.displayName),
      starterSets: configuredSets.length ? configuredSets : [starterSet],
      directInput: {
        enabled: CHARACTER_CHAT_CATALOG_POLICY.beginner.directInputEnabled,
        ...starterSet.directInput,
      },
      tone: {
        tagline: artist.publicProfile?.tagline ?? null,
        contentTone: artist.contentProfile?.contentTone ?? null,
        personalityKeywords: artist.publicProfile?.personalityKeywords ?? [],
      },
      personaReference: this.personaReferenceFromMetadata({
        metadata,
        contentTone: artist.contentProfile?.contentTone ?? null,
        personalityKeywords: artist.publicProfile?.personalityKeywords ?? [],
      }),
      policy: CHARACTER_CHAT_CATALOG_POLICY,
      source: configuredSets.length || metadataGreeting ? 'artist_metadata' : 'default',
    };
  }

  async getStarterPrompts(input: { artistId?: string; artistSlug?: string }) {
    const artist = await this.findActiveChatArtist(input);
    const metadata = this.recordOrEmpty(artist.publicProfile?.publicMetadata);
    const configuredSets = this.normalizeStarterPromptSets(
      metadata.chatStarterPromptSets,
    );

    return {
      artist: {
        id: artist.id,
        slug: artist.slug,
        displayName: artist.displayName,
      },
      policy: STARTER_PROMPT_POLICY,
      tone: {
        tagline: artist.publicProfile?.tagline ?? null,
        contentTone: artist.contentProfile?.contentTone ?? null,
        personalityKeywords: artist.publicProfile?.personalityKeywords ?? [],
      },
      personaReference: this.personaReferenceFromMetadata({
        metadata,
        contentTone: artist.contentProfile?.contentTone ?? null,
        personalityKeywords: artist.publicProfile?.personalityKeywords ?? [],
      }),
      sets: configuredSets.length
        ? configuredSets
        : [this.defaultStarterPromptSet(artist.slug, artist.displayName)],
      source: configuredSets.length ? 'artist_metadata' : 'default',
    };
  }

  async getMessages(userId: string, sessionId: string) {
    await this.getOwnedSession(userId, sessionId);

    return this.prisma.chatMessage.findMany({
      where: { chatSessionId: sessionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async preflightMessage(
    userId: string,
    sessionId: string,
    input: {
      body?: string;
      mode?: string;
    },
  ) {
    const mode = this.normalizeBasicChatMode(input.mode);
    const body = this.normalizeBasicChatBody(input.body);
    const session = await this.getOwnedSession(userId, sessionId);

    return this.buildBasicChatPreflight(userId, session, body, mode);
  }

  async createMessage(
    userId: string,
    sessionId: string,
    input: {
      body: string;
      messageType?: string;
      chatFeatureOrderId?: string;
    },
  ) {
    const body = input.chatFeatureOrderId
      ? input.body
      : this.normalizeBasicChatBody(input.body);
    const session = await this.getOwnedSession(userId, sessionId);

    if (input.chatFeatureOrderId) {
      const order = await this.prisma.chatFeatureOrder.findFirst({
        where: {
          id: input.chatFeatureOrderId,
          userId,
          chatSessionId: session.id,
          status: 'completed',
        },
      });

      if (!order) {
        throw new BadRequestException('Completed chat feature order not found');
      }
    } else {
      const preflight = await this.buildBasicChatPreflight(
        userId,
        session,
        body,
        BASIC_CHAT_POLICY.mode,
      );

      if (!preflight.canSend) {
        throw this.basicChatPreflightException(preflight);
      }
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const message = await tx.chatMessage.create({
        data: {
          chatSessionId: session.id,
          senderType: 'user',
          messageType: input.messageType ?? 'text',
          body,
          chatFeatureOrderId: input.chatFeatureOrderId,
        },
      });

      await tx.chatSession.update({
        where: { id: session.id },
        data: { updatedAt: new Date() },
      });

      return message;
    });
  }

  async getFeatureProducts() {
    const products = await this.prisma.chatFeatureProduct.findMany({
      where: {
        status: 'active',
        featureType: { in: [...PUBLIC_CHAT_FEATURE_TYPES] },
      },
      orderBy: [{ priceLumina: 'asc' }, { name: 'asc' }],
    });

    return products.map((product: ChatFeatureProductRecord) =>
      this.chatFeatureProductResponse(product),
    );
  }

  async previewFeatureOrder(
    userId: string,
    input: {
      chatSessionId: string;
      chatFeatureProductId: string;
    },
  ) {
    const [session, product, wallet, providerUserContext] = await Promise.all([
      this.getOwnedSession(userId, input.chatSessionId),
      this.prisma.chatFeatureProduct.findFirst({
        where: { id: input.chatFeatureProductId, status: 'active' },
      }),
      this.prisma.walletAccount.findUnique({
        where: {
          userId_currencyCode: { userId, currencyCode: DEFAULT_CURRENCY },
        },
      }),
      this.getProviderUserContext(userId),
    ]);

    if (!product) {
      throw new NotFoundException('Chat feature product not found');
    }

    if (!wallet || wallet.status !== 'active') {
      throw new BadRequestException('Active wallet not found');
    }

    const productPolicy = this.chatFeatureProductPolicy(product);
    const readiness = await this.providerReadinessForUser(
      userId,
      providerUserContext,
    );
    const generationPolicy = this.chatGenerationPolicy(product, readiness);
    const afterBalanceLumina = wallet.cachedBalance.minus(product.priceLumina);
    const sufficientBalance = wallet.cachedBalance.comparedTo(product.priceLumina) >= 0;

    return {
      session: {
        id: session.id,
        artistId: session.artistId,
        chatPersonaId: session.chatPersonaId,
      },
      product: {
        id: product.id,
        sku: product.sku,
        name: product.name,
        displayName: productPolicy.displayName,
        description: productPolicy.description,
        featureType: product.featureType,
        priceLumina: product.priceLumina,
        status: product.status,
        modelTier: productPolicy.modelTier,
      },
      wallet: {
        id: wallet.id,
        currencyCode: wallet.currencyCode,
        balanceLumina: wallet.cachedBalance,
        afterBalanceLumina,
        sufficientBalance,
      },
      policy: {
        idempotencyRequired: true,
        settlementEligible: productPolicy.settlementEligible,
        refundOnGenerationFailure: productPolicy.refundOnGenerationFailure,
        mvpLocked: productPolicy.mvpLocked,
        requiresIdentityVerification: false,
        generationStatus: generationPolicy.generationStatus,
        product: productPolicy,
        settlement: this.chatSettlementPolicy(product),
        generation: generationPolicy,
        failure: GENERATION_FAILURE_POLICY,
      },
    };
  }

  async createFeatureOrder(
    userId: string,
    input: {
      chatSessionId: string;
      chatFeatureProductId: string;
      idempotencyKey?: string;
    },
  ) {
    const idempotencyKey = input.idempotencyKey?.trim();

    if (!idempotencyKey) {
      throw new BadRequestException({
        ...CHAT_FEATURE_ORDER_IDEMPOTENCY_REQUIRED,
        message: CHAT_FEATURE_ORDER_IDEMPOTENCY_REQUIRED.fallbackCopyKo,
      });
    }

    const [session, product, providerUserContext] = await Promise.all([
      this.getOwnedSession(userId, input.chatSessionId),
      this.prisma.chatFeatureProduct.findFirst({
        where: { id: input.chatFeatureProductId, status: 'active' },
      }),
      this.getProviderUserContext(userId),
    ]);

    if (!product) {
      throw new NotFoundException('Chat feature product not found');
    }

    const readiness = await this.providerReadinessForUser(
      userId,
      providerUserContext,
    );

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existingOrder = await tx.chatFeatureOrder.findUnique({
        where: { idempotencyKey },
        include: { walletLedger: true, chatFeatureProduct: true },
      });

      if (existingOrder) {
        this.assertIdempotentFeatureOrderReplay(existingOrder, {
          userId,
          chatSessionId: session.id,
          chatFeatureProductId: product.id,
        });

        return {
          order: existingOrder,
          idempotentReplay: true,
          policy: {
            generation: this.chatGenerationPolicy(
              existingOrder.chatFeatureProduct,
              readiness,
            ),
            settlement: this.chatSettlementPolicy(existingOrder.chatFeatureProduct),
            failure: GENERATION_FAILURE_POLICY,
          },
        };
      }

      this.assertCanCreateFeatureOrder(product, readiness);

      const wallet = await tx.walletAccount.findUnique({
        where: {
          userId_currencyCode: { userId, currencyCode: DEFAULT_CURRENCY },
        },
      });

      if (!wallet || wallet.status !== 'active') {
        throw new BadRequestException('Active wallet not found');
      }

      const updatedWallet = await tx.walletAccount.updateMany({
        where: { id: wallet.id, cachedBalance: { gte: product.priceLumina } },
        data: { cachedBalance: { decrement: product.priceLumina } },
      });

      if (updatedWallet.count !== 1) {
        throw new BadRequestException('Insufficient Lumina balance');
      }

      const ledger = await tx.walletLedger.create({
        data: {
          walletAccountId: wallet.id,
          direction: 'debit',
          amount: product.priceLumina,
          ledgerType: 'chat_feature_spend',
          referenceType: 'chat_feature_product',
          referenceId: product.id,
          idempotencyKey: `chat-feature:${idempotencyKey}`,
          memo: `Chat feature order: ${product.name}`,
        },
      });

      const order = await tx.chatFeatureOrder.create({
        data: {
          userId,
          artistId: session.artistId,
          chatSessionId: session.id,
          chatFeatureProductId: product.id,
          walletLedgerId: ledger.id,
          status: 'completed',
          idempotencyKey,
        },
        include: { walletLedger: true, chatFeatureProduct: true },
      });

      return {
        order,
        idempotentReplay: false,
        policy: {
          generation: this.chatGenerationPolicy(product, readiness),
          settlement: this.chatSettlementPolicy(product),
          failure: GENERATION_FAILURE_POLICY,
        },
      };
    });
  }

  async generateMessage(
    userId: string,
    sessionId: string,
    input: {
      body: string;
      chatFeatureOrderId?: string;
    },
  ) {
    const session = await this.getOwnedSessionForGeneration(userId, sessionId);
    const order = input.chatFeatureOrderId
      ? await this.getFeatureOrderForGeneration(userId, session.id, input.chatFeatureOrderId)
      : null;
    const body = order
      ? this.normalizeGenerationBody(input.body)
      : this.normalizeBasicChatBody(input.body);
    const providerUserContext = await this.getProviderUserContext(userId);

    if (!order) {
      const preflight = await this.buildBasicChatPreflight(
        userId,
        session,
        body,
        BASIC_CHAT_POLICY.mode,
        providerUserContext ?? undefined,
      );

      if (!preflight.canGenerate) {
        throw this.basicChatPreflightException(preflight);
      }
    }

    const existingGenerated = order?.messages.find(
      (message: { senderType: string }) => message.senderType === 'artist',
    );

    if (order && existingGenerated) {
      return {
        generationStatus: 'completed',
        order: this.orderSummary(order),
        message: existingGenerated,
        usage: this.recordOrEmpty(existingGenerated.modelMetadata).usage ?? null,
        policy: {
          generation: this.chatGenerationPolicy(order.chatFeatureProduct),
          failure: GENERATION_FAILURE_POLICY,
        },
      };
    }

    if (order) {
      const readiness = await this.providerReadinessForUser(
        userId,
        providerUserContext,
      );
      const generationPolicy = this.chatGenerationPolicy(
        order.chatFeatureProduct,
        readiness,
      );

      if (!generationPolicy.canGenerate) {
        await this.failFeatureOrderAndRestoreLumina(
          userId,
          order.id,
          generationPolicy.disabledReason ?? 'generation_unavailable',
        );

        if (this.isProviderUnavailableReason(generationPolicy.disabledReason)) {
          throw this.providerUnavailableException(
            order.chatFeatureProduct,
            undefined,
            readiness,
          );
        }

        throw this.chatFeatureProductLockedException(
          order.chatFeatureProduct,
          readiness,
        );
      }
    }

    const recentMessages = await this.prisma.chatMessage.findMany({
      where: { chatSessionId: session.id },
      take: 20,
      orderBy: { createdAt: 'desc' },
      select: {
        senderType: true,
        messageType: true,
        body: true,
      },
    });

    try {
      const generated = await this.llmProvider.generate({
        sessionId: session.id,
        userId,
        userEmail: providerUserContext.userEmail,
        artist: session.artist,
        persona: session.chatPersona
          ? {
              id: session.chatPersona.id,
              name: session.chatPersona.name,
              systemPrompt: session.chatPersona.systemPrompt,
              safetyRules: session.chatPersona.safetyRules,
              modelConfig: session.chatPersona.modelConfig,
            }
          : null,
        mode: order?.chatFeatureProduct.featureType ?? BASIC_CHAT_POLICY.mode,
        userMessage: body,
        recentMessages: recentMessages.reverse(),
        order: order
          ? {
              id: order.id,
              sku: order.chatFeatureProduct.sku,
              featureType: order.chatFeatureProduct.featureType,
              priceLumina: order.chatFeatureProduct.priceLumina,
            }
          : null,
      });

      return this.persistGeneratedMessage(userId, session.id, body, order?.id, generated);
    } catch (error) {
      if (order) {
        await this.failFeatureOrderAndRestoreLumina(
          userId,
          order.id,
          error instanceof ChatLlmProviderNotConfiguredError
            ? 'provider_not_configured'
            : 'generation_failed',
        );
      }

      if (error instanceof ChatLlmProviderNotConfiguredError) {
        throw this.providerUnavailableException(order?.chatFeatureProduct ?? null);
      }

      if (!order && error instanceof ChatLlmProviderRequestError) {
        const fallback = await this.persistGeneratedMessage(
          userId,
          session.id,
          body,
          undefined,
          this.llmProvider.fallbackResult(error),
        );

        return {
          ...fallback,
          generationStatus: 'fallback',
          requestId: error.requestId ?? null,
        };
      }

      throw new ServiceUnavailableException({
        code: 'CHAT_LLM_GENERATION_FAILED',
        message: 'Character chat generation failed',
        messageKey: 'chat.generation.failed',
        details: {
          generationStatus: 'failed',
          order: order ? this.orderSummary({ ...order, status: 'failed' }) : null,
          policy: {
            generation: this.chatGenerationPolicy(order?.chatFeatureProduct),
            failure: GENERATION_FAILURE_POLICY,
          },
        },
      });
    }
  }

  private async getOwnedSession(userId: string, sessionId: string) {
    const session = await this.prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        userId,
        status: 'active',
      },
    });

    if (!session) {
      throw new NotFoundException('Active chat session not found');
    }

    return session;
  }

  private normalizeConversationBox(value: string | undefined): ChatConversationBox {
    if (!value) {
      return 'recent';
    }

    if (value === 'recent' || value === 'archive' || value === 'all') {
      return value;
    }

    throw new BadRequestException({
      code: 'CHAT_CONVERSATION_BOX_INVALID',
      message: 'box must be recent, archive, or all',
      messageKey: 'chat.conversations.invalidBox',
    });
  }

  private conversationListWhere(userId: string, box: ChatConversationBox) {
    const where: {
      userId: string;
      status?: string | { in: string[] };
    } = { userId };

    if (box === 'recent') {
      where.status = 'active';
    } else if (box === 'archive') {
      where.status = 'archived';
    } else {
      where.status = { in: ['active', 'archived'] };
    }

    return where;
  }

  private presentConversationListItem(session: {
    id: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    artist: {
      id: string;
      slug: string;
      displayName: string;
    };
    chatPersona: {
      id: string;
      name: string;
      status: string;
    } | null;
    messages: Array<{
      id: string;
      senderType: string;
      messageType: string;
      body: string | null;
      chatFeatureOrderId: string | null;
      createdAt: Date;
    }>;
    _count: {
      messages: number;
    };
  }) {
    const lastMessage = session.messages[0] ?? null;

    return {
      id: session.id,
      box: session.status === 'archived' ? 'archive' : 'recent',
      status: session.status,
      artist: session.artist,
      persona: session.chatPersona
        ? {
            id: session.chatPersona.id,
            name: session.chatPersona.name,
            status: session.chatPersona.status,
          }
        : null,
      messageCount: session._count.messages,
      lastMessage: lastMessage
        ? {
            id: lastMessage.id,
            senderType: lastMessage.senderType,
            messageType: lastMessage.messageType,
            bodyPreview: this.bodyPreview(lastMessage.body),
            createdAt: lastMessage.createdAt,
            paidFeatureOrderPresent: Boolean(lastMessage.chatFeatureOrderId),
          }
        : null,
      lastMessageAt: lastMessage?.createdAt ?? null,
      lastActivityAt: lastMessage?.createdAt ?? session.updatedAt,
      updatedAt: session.updatedAt,
      createdAt: session.createdAt,
      readState: {
        supported: false,
        unreadCount: null,
        messageKey: 'chat.conversations.readStateNotAvailable',
      },
    };
  }

  private bodyPreview(value: string | null) {
    if (!value) {
      return null;
    }

    const collapsed = value.replace(/\s+/g, ' ').trim();
    return collapsed.length > 120 ? `${collapsed.slice(0, 117)}...` : collapsed;
  }

  private conversationEmptyState(box: ChatConversationBox) {
    return {
      messageKey:
        box === 'archive'
          ? 'chat.conversations.emptyArchive'
          : 'chat.conversations.emptyRecent',
      defaultMessageKo:
        box === 'archive'
          ? '\uBCF4\uAD00\uD55C \uB300\uD654\uAC00 \uC5C6\uC5B4\uC694.'
          : '\uC544\uC9C1 \uC2DC\uC791\uD55C \uB300\uD654\uAC00 \uC5C6\uC5B4\uC694.',
    };
  }

  private paginate<T extends { id: string }>(rows: T[], take: number) {
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const lastItem = items.at(-1);

    return {
      items,
      hasMore,
      nextCursor: hasMore && lastItem ? lastItem.id : null,
    };
  }

  private validateCursor(value: string) {
    if (!UUID_V4_PATTERN.test(value)) {
      throw new BadRequestException({
        code: 'CHAT_CONVERSATION_CURSOR_INVALID',
        message: 'cursor must be a UUID v4',
        messageKey: 'chat.conversations.invalidCursor',
      });
    }

    return value;
  }

  private async getOwnedSessionForGeneration(userId: string, sessionId: string) {
    const session = await this.prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        userId,
        status: 'active',
      },
      include: {
        artist: {
          select: { id: true, slug: true, displayName: true },
        },
        chatPersona: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Active chat session not found');
    }

    return session;
  }

  private async getFeatureOrderForGeneration(
    userId: string,
    sessionId: string,
    orderId: string,
  ) {
    const order = await this.prisma.chatFeatureOrder.findFirst({
      where: {
        id: orderId,
        userId,
        chatSessionId: sessionId,
      },
      include: {
        walletLedger: true,
        chatFeatureProduct: true,
        messages: {
          where: { senderType: 'artist' },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!order) {
      throw new BadRequestException('Chat feature order not found for this session');
    }

    if (order.status === 'failed') {
      throw new BadRequestException('Chat feature order is already failed');
    }

    if (order.status !== 'completed') {
      throw new BadRequestException('Completed chat feature order is required');
    }

    return order;
  }

  private async buildBasicChatPreflight(
    userId: string,
    session: { id: string; artistId: string },
    body: string,
    mode: string,
    providerUserContext?: ChatProviderUserContext,
  ) {
    const now = new Date();
    const todayStart = this.koreaServiceDayStartUtc(now);
    const cooldownCutoff = new Date(
      now.getTime() - BASIC_CHAT_POLICY.cooldownSeconds * 1000,
    );
    const [lastFreeMessage, dailyUsed, providerOpsStats, readiness] =
      await Promise.all([
        this.prisma.chatMessage.findFirst({
          where: {
            senderType: 'user',
            chatFeatureOrderId: null,
            createdAt: { gte: cooldownCutoff },
            chatSession: {
              userId,
              artistId: session.artistId,
            },
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true, createdAt: true },
        }),
        this.prisma.chatMessage.count({
          where: {
            senderType: 'user',
            chatFeatureOrderId: null,
            createdAt: { gte: todayStart },
            chatSession: {
              userId,
              artistId: session.artistId,
            },
          },
        }),
        this.providerOpsStatsForUser(userId, todayStart),
        this.providerReadinessForUser(userId, providerUserContext),
      ]);
    const cooldownRemainingSeconds = lastFreeMessage
      ? Math.max(
          0,
          Math.ceil(
            (BASIC_CHAT_POLICY.cooldownSeconds * 1000 -
              (now.getTime() - lastFreeMessage.createdAt.getTime())) /
              1000,
          ),
        )
      : 0;
    const dailyRemaining = Math.max(0, BASIC_CHAT_POLICY.dailyLimit - dailyUsed);
    const blockReason =
      cooldownRemainingSeconds > 0
        ? BASIC_CHAT_BLOCK_REASONS.cooldownActive
        : dailyUsed >= BASIC_CHAT_POLICY.dailyLimit
          ? BASIC_CHAT_BLOCK_REASONS.dailyLimitReached
          : providerOpsStats.totalResponses >=
              CHAT_LLM_OPS_GUARD_POLICY.providerDailyRequestLimit
            ? BASIC_CHAT_BLOCK_REASONS.dailyLimitReached
            : providerOpsStats.failureCount >=
                CHAT_LLM_OPS_GUARD_POLICY.providerDailyFailureLimit
              ? BASIC_CHAT_BLOCK_REASONS.providerFailureLimitReached
              : !readiness.configured
                ? {
                    reason: readiness.status,
                    code: 'CHAT_LLM_PROVIDER_NOT_CONFIGURED',
                    messageKey: readiness.messageKey,
                    fallbackCopyKo:
                      CHAT_GENERATION_DISABLED_REASONS.providerNotConfigured
                        .displayMessageKo,
                  }
                : null;
    const generationPolicy = this.chatGenerationPolicy(null, readiness);
    const providerDailyRemaining = Math.max(
      0,
      CHAT_LLM_OPS_GUARD_POLICY.providerDailyRequestLimit -
        providerOpsStats.totalResponses,
    );
    const providerFailureRemaining = Math.max(
      0,
      CHAT_LLM_OPS_GUARD_POLICY.providerDailyFailureLimit -
        providerOpsStats.failureCount,
    );

    return {
      canSend: !blockReason,
      canGenerate: !blockReason,
      mode,
      bodyLength: body.length,
      limits: {
        cooldownSeconds: BASIC_CHAT_POLICY.cooldownSeconds,
        cooldownRemainingSeconds,
        dailyLimit: BASIC_CHAT_POLICY.dailyLimit,
        dailyUsed,
        dailyRemaining,
        providerDailyLimit: CHAT_LLM_OPS_GUARD_POLICY.providerDailyRequestLimit,
        providerDailyUsed: providerOpsStats.totalResponses,
        providerDailyRemaining,
        providerDailyFailureLimit:
          CHAT_LLM_OPS_GUARD_POLICY.providerDailyFailureLimit,
        providerDailyFailureCount: providerOpsStats.failureCount,
        providerDailyFailureRemaining: providerFailureRemaining,
        serviceDayTimeZone: KOREA_SERVICE_DAY_TIME_ZONE,
        serviceDayStartAt: todayStart.toISOString(),
        maxInputChars: BASIC_CHAT_POLICY.maxInputChars,
        estimatedCostCeilingKrw: BASIC_CHAT_POLICY.estimatedCostCeilingKrw,
      },
      provider: this.providerDetails(readiness),
      providerOps: {
        policy: CHAT_LLM_OPS_GUARD_POLICY,
        usageByModel: providerOpsStats.usageByModel,
        fallbackCount: providerOpsStats.fallbackCount,
        estimatedCostKrw: providerOpsStats.estimatedCostKrw,
      },
      disabledReason: blockReason?.reason ?? null,
      messageKey: blockReason?.messageKey ?? null,
      fallbackCopyKo: blockReason?.fallbackCopyKo ?? null,
      walletMutation: false,
      settlementEligible: false,
      policy: {
        generation: generationPolicy,
        settlement: null,
        failure: GENERATION_FAILURE_POLICY,
      },
    };
  }

  private koreaServiceDayStartUtc(now: Date) {
    const koreaTime = new Date(now.getTime() + KOREA_SERVICE_DAY_OFFSET_MS);
    koreaTime.setUTCHours(0, 0, 0, 0);

    return new Date(koreaTime.getTime() - KOREA_SERVICE_DAY_OFFSET_MS);
  }

  private isProviderUnavailableReason(reason: string | null) {
    return (
      reason === 'provider_disabled' ||
      reason === 'provider_not_configured' ||
      reason === 'provider_not_allowed'
    );
  }

  private basicChatPreflightException(
    preflight: Awaited<ReturnType<ChatService['buildBasicChatPreflight']>>,
  ) {
    if (this.isProviderUnavailableReason(preflight.disabledReason)) {
      return this.providerUnavailableException(null, preflight);
    }

    const blockReason =
      preflight.disabledReason === BASIC_CHAT_BLOCK_REASONS.cooldownActive.reason
        ? BASIC_CHAT_BLOCK_REASONS.cooldownActive
        : preflight.disabledReason ===
            BASIC_CHAT_BLOCK_REASONS.dailyLimitReached.reason
          ? BASIC_CHAT_BLOCK_REASONS.dailyLimitReached
          : preflight.disabledReason ===
              BASIC_CHAT_BLOCK_REASONS.providerFailureLimitReached.reason
            ? BASIC_CHAT_BLOCK_REASONS.providerFailureLimitReached
            : BASIC_CHAT_BLOCK_REASONS.invalidBody;

    return new BadRequestException({
      code: blockReason.code,
      message: blockReason.fallbackCopyKo,
      messageKey: blockReason.messageKey,
      fallbackCopyKo: blockReason.fallbackCopyKo,
      details: {
        preflight,
      },
    });
  }

  private async persistGeneratedMessage(
    userId: string,
    sessionId: string,
    userMessageBody: string,
    chatFeatureOrderId: string | undefined,
    generated: ChatGenerationResult,
  ) {
    const usageRecordedAt = new Date().toISOString();

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const userMessage = await tx.chatMessage.create({
        data: {
          chatSessionId: sessionId,
          senderType: 'user',
          messageType: 'text',
          body: userMessageBody,
          chatFeatureOrderId,
        },
      });
      const aiMessage = await tx.chatMessage.create({
        data: {
          chatSessionId: sessionId,
          senderType: 'artist',
          messageType: 'text',
          body: generated.body,
          chatFeatureOrderId,
          modelMetadata: this.inputJson({
            usageSchemaVersion: '2026-05-14.chat-provider-usage-v1',
            provider: generated.usage.provider,
            model: generated.usage.model,
            usage: generated.usage,
            estimatedCostKrw: generated.usage.estimatedCostKrw,
            usageRecordedAt,
            opsGuard: {
              policyVersion: CHAT_LLM_OPS_GUARD_POLICY.policyVersion,
              serviceDayTimeZone: KOREA_SERVICE_DAY_TIME_ZONE,
              countedForDailyLimit: !chatFeatureOrderId,
            },
          }),
          safetyMetadata: this.inputJson(generated.safetyMetadata),
        },
      });

      await tx.chatSession.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() },
      });

      return {
        generationStatus: 'completed',
        order: chatFeatureOrderId ? { id: chatFeatureOrderId, status: 'completed' } : null,
        userMessage,
        message: aiMessage,
        usage: generated.usage,
      };
    });
  }

  private async failFeatureOrderAndRestoreLumina(
    userId: string,
    orderId: string,
    reason: string,
  ) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const order = await tx.chatFeatureOrder.findFirst({
        where: { id: orderId, userId },
        include: { walletLedger: true },
      });

      if (!order || order.status === 'failed') {
        return order;
      }

      const failedOrderUpdate = await tx.chatFeatureOrder.updateMany({
        where: {
          id: order.id,
          userId,
          status: { not: GENERATION_FAILURE_POLICY.orderFailureStatus },
        },
        data: {
          status: GENERATION_FAILURE_POLICY.orderFailureStatus,
          updatedAt: new Date(),
        },
      });

      if (failedOrderUpdate.count !== 1) {
        return order;
      }

      const failedOrder = {
        ...order,
        status: GENERATION_FAILURE_POLICY.orderFailureStatus,
      };

      if (!order.walletLedger) {
        return failedOrder;
      }

      const refundIdempotencyKey = `chat-feature-refund:${order.id}`;
      const existingRefund = await tx.walletLedger.findUnique({
        where: { idempotencyKey: refundIdempotencyKey },
      });

      if (!existingRefund) {
        await tx.walletAccount.update({
          where: { id: order.walletLedger.walletAccountId },
          data: { cachedBalance: { increment: order.walletLedger.amount } },
        });
        await tx.walletLedger.create({
          data: {
            walletAccountId: order.walletLedger.walletAccountId,
            direction: 'credit',
            amount: order.walletLedger.amount,
            ledgerType: GENERATION_FAILURE_POLICY.walletRecoveryLedgerType,
            referenceType: GENERATION_FAILURE_POLICY.walletRecoveryReferenceType,
            referenceId: order.id,
            idempotencyKey: refundIdempotencyKey,
            memo: `Chat feature generation failed: ${reason}`,
          },
        });
      }

      return failedOrder;
    });
  }

  private assertIdempotentFeatureOrderReplay(
    order: {
      userId: string;
      chatSessionId: string;
      chatFeatureProductId: string;
    },
    expected: {
      userId: string;
      chatSessionId: string;
      chatFeatureProductId: string;
    },
  ) {
    if (
      order.userId === expected.userId &&
      order.chatSessionId === expected.chatSessionId &&
      order.chatFeatureProductId === expected.chatFeatureProductId
    ) {
      return;
    }

    throw new BadRequestException({
      ...CHAT_FEATURE_ORDER_CONFLICT,
      message: CHAT_FEATURE_ORDER_CONFLICT.fallbackCopyKo,
      walletMutation: false,
    });
  }

  private assertCanCreateFeatureOrder(
    product: {
      id: string;
      sku: string;
      featureType: string;
      metadata: unknown;
      status?: string;
    },
    readiness: ChatLlmProviderReadiness,
  ) {
    const generationPolicy = this.chatGenerationPolicy(product, readiness);

    if (generationPolicy.canCreatePaidOrder) {
      return;
    }

    if (this.isProviderUnavailableReason(generationPolicy.disabledReason)) {
      throw this.providerUnavailableException(product, undefined, readiness);
    }

    throw this.chatFeatureProductLockedException(product, readiness);
  }

  private chatFeatureProductLockedException(
    product: {
      id: string;
      sku: string;
      featureType: string;
      metadata: unknown;
      status?: string;
    },
    readiness: ChatLlmProviderReadiness,
  ) {
    return new BadRequestException({
      ...CHAT_FEATURE_PRODUCT_LOCKED,
      message: CHAT_FEATURE_PRODUCT_LOCKED.fallbackCopyKo,
      walletMutation: false,
      details: {
        product: this.productSummary(product),
        policy: {
          generation: this.chatGenerationPolicy(product, readiness),
          settlement: this.chatSettlementPolicy(product),
          failure: GENERATION_FAILURE_POLICY,
        },
      },
    });
  }

  private providerUnavailableException(
    product: {
      id: string;
      sku: string;
      featureType: string;
      metadata: unknown;
    } | null,
    preflight?: Awaited<ReturnType<ChatService['buildBasicChatPreflight']>>,
    readinessOverride?: ChatLlmProviderReadiness,
  ) {
    const readiness = preflight
      ? ({
          provider: preflight.provider.name,
          configured: preflight.provider.configured,
          status: preflight.provider.status,
          messageKey:
            preflight.messageKey ??
            CHAT_GENERATION_DISABLED_REASONS.providerNotConfigured.messageKey,
        } satisfies ChatLlmProviderReadiness)
      : (readinessOverride ?? this.llmProvider.readiness());

    return new ServiceUnavailableException({
      code: 'CHAT_LLM_PROVIDER_NOT_CONFIGURED',
      message: 'Character chat generation provider is not configured',
      messageKey: readiness.messageKey,
      fallbackCopyKo:
        CHAT_GENERATION_DISABLED_REASONS.providerNotConfigured.displayMessageKo,
      walletMutation: false,
      details: {
        generationStatus: readiness.status,
        provider: this.providerDetails(readiness),
        product: product ? this.productSummary(product) : null,
        preflight: preflight ?? null,
        policy: {
          generation: this.chatGenerationPolicy(product),
          settlement: product ? this.chatSettlementPolicy(product) : null,
          failure: GENERATION_FAILURE_POLICY,
        },
      },
    });
  }

  private chatGenerationPolicy(product?: {
    sku?: string;
    featureType: string;
    metadata: unknown;
    status?: string;
  } | null, readinessOverride?: ChatLlmProviderReadiness) {
    const readiness = readinessOverride ?? this.llmProvider.readiness();
    const productPolicy = product ? this.chatFeatureProductPolicy(product) : null;
    const providerRequired = product
      ? productPolicy?.providerRequired ?? this.requiresLlmGeneration(product)
      : true;
    const mvpLocked = productPolicy?.mvpLocked ?? false;
    const providerUnavailable = providerRequired && !readiness.configured;
    const disabledReason = mvpLocked
      ? CHAT_GENERATION_DISABLED_REASONS.mvpLocked
      : providerUnavailable
        ? CHAT_GENERATION_DISABLED_REASONS.providerNotConfigured
        : null;
    const canGenerate = !mvpLocked && !providerUnavailable;
    const canCreatePaidOrder = product ? canGenerate : false;
    const modelTier = productPolicy?.modelTier ?? BASIC_CHAT_POLICY.modelTier;

    return {
      mode: product?.featureType ?? BASIC_CHAT_POLICY.mode,
      provider: this.providerDetails(readiness),
      canGenerate,
      canCreatePaidOrder,
      disabledReason: disabledReason?.reason ?? null,
      disabledMessageKey: disabledReason?.messageKey ?? null,
      disabledDisplayMessageKo: disabledReason?.displayMessageKo ?? null,
      generationStatus: canGenerate ? 'ready' : disabledReason?.reason ?? readiness.status,
      modelTier,
      orderFlow: productPolicy?.orderFlow ?? 'basic_chat',
      generationMode: productPolicy?.generationMode ?? BASIC_CHAT_POLICY.mode,
      providerRequired,
      requiresPreview: product ? productPolicy?.requiresPreview ?? true : false,
      maxInputChars: productPolicy?.maxInputChars ?? BASIC_CHAT_POLICY.maxInputChars,
      cooldownSeconds:
        productPolicy?.cooldownSeconds ?? BASIC_CHAT_POLICY.cooldownSeconds,
      dailyLimit: productPolicy?.dailyLimit ?? BASIC_CHAT_POLICY.dailyLimit,
      estimatedCostCeilingKrw:
        productPolicy?.estimatedCostCeilingKrw ??
        BASIC_CHAT_POLICY.estimatedCostCeilingKrw,
      usageMetadataPath: 'chat_messages.model_metadata',
      safetyMetadataPath: 'chat_messages.safety_metadata',
    };
  }

  private productSummary(product: {
    id: string;
    sku: string;
    name?: string;
    featureType: string;
    priceLumina?: unknown;
    status?: string;
    metadata: unknown;
  }) {
    const productPolicy = this.chatFeatureProductPolicy(product);

    return {
      id: product.id,
      sku: product.sku,
      featureType: product.featureType,
      displayName: productPolicy.displayName,
      modelTier: productPolicy.modelTier,
      orderFlow: productPolicy.orderFlow,
      generationMode: productPolicy.generationMode,
    };
  }

  private chatFeatureProductResponse(product: {
    id: string;
    sku: string;
    name: string;
    featureType: string;
    priceLumina: unknown;
    status: string;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const productPolicy = this.chatFeatureProductPolicy(product);

    return {
      ...product,
      displayName: productPolicy.displayName,
      description: productPolicy.description,
      modelTier: productPolicy.modelTier,
      policy: {
        product: productPolicy,
        settlement: this.chatSettlementPolicy(product),
        generation: this.chatGenerationPolicy(product),
        failure: GENERATION_FAILURE_POLICY,
      },
    };
  }

  private chatFeatureProductPolicy(product: {
    sku?: string;
    name?: string;
    featureType: string;
    priceLumina?: unknown;
    status?: string;
    metadata: unknown;
  }) {
    const metadata = this.recordOrEmpty(product.metadata);
    const configuredPolicy = findChatFeatureProductPolicy({
      sku: product.sku,
      featureType: product.featureType,
    });
    const metadataMvpLocked = metadata.mvpLocked === true;
    const policyStatus = configuredPolicy?.status ?? product.status ?? 'active';
    const mvpLocked =
      metadataMvpLocked || configuredPolicy?.mvpLocked === true || policyStatus !== 'active';
    const displayName =
      this.stringFromUnknown(metadata.displayNameKo) ??
      configuredPolicy?.displayNameKo ??
      product.name ??
      product.featureType;
    const description =
      this.stringFromUnknown(metadata.descriptionKo) ??
      configuredPolicy?.descriptionKo ??
      null;
    const settlementEligible =
      metadata.settlementEligible === false
        ? false
        : configuredPolicy?.settlementEligible ?? true;
    const creatorShareEligible =
      metadata.creatorShareEligible === false
        ? false
        : configuredPolicy?.creatorShareEligible ?? settlementEligible;
    const modelTier =
      this.stringFromUnknown(metadata.modelTier) ??
      configuredPolicy?.modelTier ??
      'mini';

    return {
      sku: product.sku ?? configuredPolicy?.sku ?? null,
      featureType: product.featureType,
      displayName,
      description,
      priceLumina: product.priceLumina ?? configuredPolicy?.priceLumina ?? null,
      status: product.status ?? configuredPolicy?.status ?? 'active',
      modelTier,
      orderFlow: configuredPolicy?.orderFlow ?? 'paid_generation',
      generationMode: configuredPolicy?.generationMode ?? 'inline_reply',
      providerRequired:
        configuredPolicy?.providerRequired ?? this.requiresLlmGeneration(product),
      requiresPreview: configuredPolicy?.requiresPreview ?? true,
      mvpLocked,
      settlementEligible,
      creatorShareEligible,
      settlementSource:
        this.stringFromUnknown(metadata.settlementSource) ??
        configuredPolicy?.settlementSource ??
        'chat',
      maxInputChars: configuredPolicy?.maxInputChars ?? 2000,
      cooldownSeconds: configuredPolicy?.cooldownSeconds ?? 0,
      dailyLimit: configuredPolicy?.dailyLimit ?? null,
      estimatedCostCeilingKrw:
        configuredPolicy?.estimatedCostCeilingKrw ??
        this.estimatedPaidCostCeiling(modelTier),
      refundOnGenerationFailure:
        configuredPolicy?.refundOnGenerationFailure ??
        GENERATION_FAILURE_POLICY.refundOnGenerationFailure,
    };
  }

  private chatSettlementPolicy(product: {
    sku?: string;
    featureType: string;
    metadata: unknown;
  }) {
    const productPolicy = this.chatFeatureProductPolicy(product);

    return {
      eligible: productPolicy.settlementEligible,
      creatorShareEligible: productPolicy.creatorShareEligible,
      source: productPolicy.settlementSource,
      eventType: productPolicy.creatorShareEligible
        ? productPolicy.settlementSource ?? 'chat'
        : null,
      freeBasicExcluded: true,
      finalPayoutRequiresSettlementRun: true,
    };
  }

  private orderSummary(order: {
    id: string;
    status: string;
    chatFeatureProduct?: {
      sku: string;
      featureType: string;
    };
  }) {
    return {
      id: order.id,
      status: order.status,
      sku: order.chatFeatureProduct?.sku,
      featureType: order.chatFeatureProduct?.featureType,
    };
  }

  private async providerReadinessForUser(
    userId: string,
    providerUserContext?: ChatProviderUserContext,
  ) {
    const context = providerUserContext ?? (await this.getProviderUserContext(userId));

    return this.llmProvider.readiness({
      userId: context.userId,
      userEmail: context.userEmail,
    });
  }

  private async providerOpsStatsForUser(
    userId: string,
    todayStart: Date,
  ): Promise<ChatProviderOpsStats> {
    const rows = await this.prisma.chatMessage.findMany({
      where: {
        senderType: 'artist',
        chatFeatureOrderId: null,
        createdAt: { gte: todayStart },
        chatSession: {
          userId,
        },
      },
      select: {
        modelMetadata: true,
        safetyMetadata: true,
      },
    });

    return this.aggregateProviderOpsStats(rows);
  }

  private aggregateProviderOpsStats(
    rows: Array<{
      modelMetadata: unknown;
      safetyMetadata: unknown;
    }>,
  ): ChatProviderOpsStats {
    const usageByModel = new Map<
      string,
      {
        provider: string;
        model: string;
        responses: number;
        inputTokens: number;
        outputTokens: number;
        estimatedCostKrw: number;
      }
    >();
    let totalResponses = 0;
    let failureCount = 0;
    let fallbackCount = 0;

    for (const row of rows) {
      const modelMetadata = this.recordOrEmpty(row.modelMetadata);
      const safetyMetadata = this.recordOrEmpty(row.safetyMetadata);
      const usage = this.recordOrEmpty(modelMetadata.usage);
      const provider =
        this.stringFromUnknown(modelMetadata.provider) ??
        this.stringFromUnknown(usage.provider) ??
        this.stringFromUnknown(safetyMetadata.provider);
      const model =
        this.stringFromUnknown(modelMetadata.model) ??
        this.stringFromUnknown(usage.model) ??
        'unknown';
      const isProviderTracked = Boolean(
        provider ||
          modelMetadata.usage ||
          safetyMetadata.generationStatus ||
          safetyMetadata.reason,
      );

      if (!isProviderTracked) {
        continue;
      }

      const normalizedProvider = provider ?? 'unknown';
      const generationStatus = this.stringFromUnknown(
        safetyMetadata.generationStatus,
      );
      const failureReason = this.stringFromUnknown(safetyMetadata.reason);
      const isFallback = generationStatus === 'fallback' || model === 'fallback';
      const isFailure =
        isFallback ||
        generationStatus === 'failed' ||
        Boolean(failureReason?.startsWith('provider_'));

      totalResponses += 1;
      fallbackCount += isFallback ? 1 : 0;
      failureCount += isFailure ? 1 : 0;

      const key = `${normalizedProvider}:${model}`;
      const current =
        usageByModel.get(key) ??
        {
          provider: normalizedProvider,
          model,
          responses: 0,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostKrw: 0,
        };

      current.responses += 1;
      current.inputTokens += this.numberFromUnknown(
        usage.inputTokens ?? usage.input_tokens,
      );
      current.outputTokens += this.numberFromUnknown(
        usage.outputTokens ?? usage.output_tokens,
      );
      current.estimatedCostKrw += this.numberFromUnknown(
        modelMetadata.estimatedCostKrw ?? usage.estimatedCostKrw,
      );
      usageByModel.set(key, current);
    }

    const usageRows = [...usageByModel.values()].map((row) => ({
      ...row,
      estimatedCostKrw: row.estimatedCostKrw.toFixed(2),
    }));
    const estimatedCostKrw = usageRows
      .reduce((sum, row) => sum + this.numberFromUnknown(row.estimatedCostKrw), 0)
      .toFixed(2);

    return {
      totalResponses,
      failureCount,
      fallbackCount,
      usageByModel: usageRows,
      estimatedCostKrw,
    };
  }

  private async getProviderUserContext(
    userId: string,
  ): Promise<ChatProviderUserContext> {
    const userDelegate = (
      this.prisma as unknown as {
        user?: {
          findUnique?: (args: {
            where: { id: string };
            select: { id: true; email: true };
          }) => Promise<{ id: string; email: string | null } | null>;
        };
      }
    ).user;

    if (!userDelegate?.findUnique) {
      return { userId, userEmail: null };
    }

    const user = await userDelegate.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    return {
      userId,
      userEmail: user?.email ?? null,
    };
  }

  private providerDetails(readiness: ChatLlmProviderReadiness) {
    return {
      name: readiness.provider,
      configured: readiness.configured,
      status: readiness.status,
    };
  }

  private requiresLlmGeneration(product: { featureType: string }) {
    const configuredPolicy = findChatFeatureProductPolicy({
      featureType: product.featureType,
    });

    return configuredPolicy?.providerRequired ?? PAID_GENERATION_FEATURE_TYPES.has(product.featureType);
  }

  private normalizeBasicChatMode(value?: string) {
    const mode = value?.trim() || BASIC_CHAT_POLICY.mode;

    if (mode !== BASIC_CHAT_POLICY.mode) {
      throw new BadRequestException({
        code: BASIC_CHAT_BLOCK_REASONS.invalidMode.code,
        message: BASIC_CHAT_BLOCK_REASONS.invalidMode.fallbackCopyKo,
        messageKey: BASIC_CHAT_BLOCK_REASONS.invalidMode.messageKey,
        fallbackCopyKo: BASIC_CHAT_BLOCK_REASONS.invalidMode.fallbackCopyKo,
      });
    }

    return mode;
  }

  private normalizeBasicChatBody(value?: string) {
    const body = value?.trim() ?? '';

    if (!body || body.length > BASIC_CHAT_POLICY.maxInputChars) {
      throw new BadRequestException({
        code: BASIC_CHAT_BLOCK_REASONS.invalidBody.code,
        message: BASIC_CHAT_BLOCK_REASONS.invalidBody.fallbackCopyKo,
        messageKey: BASIC_CHAT_BLOCK_REASONS.invalidBody.messageKey,
        fallbackCopyKo: BASIC_CHAT_BLOCK_REASONS.invalidBody.fallbackCopyKo,
        details: {
          limits: {
            maxInputChars: BASIC_CHAT_POLICY.maxInputChars,
          },
        },
      });
    }

    return body;
  }

  private normalizeGenerationBody(value: string) {
    const body = value.trim();

    if (!body) {
      throw new BadRequestException('body is required');
    }

    if (body.length > 2000) {
      throw new BadRequestException('body must be 2000 characters or fewer');
    }

    return body;
  }

  private estimatedPaidCostCeiling(modelTier: string) {
    return modelTier === 'premium'
      ? '3.00'
      : modelTier === 'async_special'
        ? '5.00'
        : '1.00';
  }

  private recordOrEmpty(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private inputJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private personaReferenceFromMetadata(input: {
    metadata: Record<string, unknown>;
    contentTone: string | null;
    personalityKeywords: string[];
  }) {
    const personaSeed = this.recordOrEmpty(input.metadata.chatPersonaSeed);
    const selectedTraitIds = this.normalizePersonaTraitIds(
      personaSeed.selectedTraitIds ??
        personaSeed.traitIds ??
        personaSeed.tags ??
        input.metadata.personaTraitIds,
    );
    const selectedTraits = CHAT_PERSONA_TRAIT_CATALOG.traits
      .filter((trait) => selectedTraitIds.includes(trait.id))
      .map((trait) => ({
        id: trait.id,
        group: trait.group,
        labelKo: trait.labelKo,
        i18nKey: trait.i18nKey,
        conflictsWith: [...trait.conflictsWith],
      }));
    const customFields = {
      customTraitsKo: this.normalizeStringList(
        personaSeed.customTraitsKo ?? personaSeed.customTraits,
        6,
        30,
      ),
      fanNicknameKo: this.stringFromUnknown(personaSeed.fanNicknameKo),
      relationshipToneKo: this.stringFromUnknown(personaSeed.relationshipToneKo),
      favoriteTopicsKo: this.normalizeStringList(
        personaSeed.favoriteTopicsKo ?? personaSeed.favoriteTopics,
        8,
        30,
      ),
      openingMoodKo: this.stringFromUnknown(personaSeed.openingMoodKo),
    };
    const hasCustomFields = Boolean(
      customFields.customTraitsKo.length ||
        customFields.fanNicknameKo ||
        customFields.relationshipToneKo ||
        customFields.favoriteTopicsKo.length ||
        customFields.openingMoodKo,
    );
    const legacyToneSignals = {
      contentTone: input.contentTone,
      personalityKeywords: input.personalityKeywords,
    };

    return {
      catalogVersion: CHAT_PERSONA_TRAIT_CATALOG.catalogVersion,
      selectedTraitIds,
      selectedTraits,
      customFields,
      legacyToneSignals,
      source:
        selectedTraitIds.length || hasCustomFields
          ? 'artist_metadata'
          : input.contentTone || input.personalityKeywords.length
            ? 'legacy_artist_profile'
            : 'default',
      readOnly: true,
      mutationEnabled: false,
    };
  }

  private normalizePersonaTraitIds(value: unknown) {
    const allowed = new Set<string>(
      CHAT_PERSONA_TRAIT_CATALOG.traits.map((trait) => trait.id),
    );
    const rawItems = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',')
        : [];
    const ids = rawItems
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => allowed.has(item));

    return [...new Set(ids)];
  }

  private normalizeStringList(value: unknown, maxItems: number, maxLength: number) {
    const rawItems = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',')
        : [];

    return [
      ...new Set(
        rawItems
          .map((item) => this.stringFromUnknown(item))
          .filter((item): item is string => Boolean(item))
          .map((item) => item.slice(0, maxLength)),
      ),
    ].slice(0, maxItems);
  }

  private stringFromUnknown(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private numberFromUnknown(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);

      return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
  }

  private async findActiveChatArtist(input: { artistId?: string; artistSlug?: string }) {
    const artistId = input.artistId?.trim();
    const artistSlug = input.artistSlug?.trim();

    if (!artistId && !artistSlug) {
      throw new BadRequestException('artistId or artistSlug is required');
    }

    if (artistId && !UUID_V4_PATTERN.test(artistId)) {
      throw new BadRequestException('artistId must be a UUID v4');
    }

    const artist = await this.prisma.artist.findFirst({
      where: {
        status: 'active',
        ...(artistId ? { id: artistId } : { slug: artistSlug }),
      },
      select: {
        id: true,
        slug: true,
        displayName: true,
        publicProfile: {
          select: {
            publicMetadata: true,
            tagline: true,
            personalityKeywords: true,
          },
        },
        contentProfile: {
          select: {
            contentTone: true,
          },
        },
      },
    });

    if (!artist) {
      throw new NotFoundException('Artist not found');
    }

    return artist;
  }

  private normalizeStarterPromptSets(value: unknown): StarterPromptSet[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((set, index) => this.normalizeStarterPromptSet(set, index))
      .filter((set): set is StarterPromptSet => Boolean(set));
  }

  private normalizeStarterPromptSet(value: unknown, index: number) {
    const record = this.recordOrEmpty(value);
    const guideText = this.stringFromUnknown(record.guideText);
    const options = this.normalizeStarterPromptOptions(record.options);

    if (!guideText || options.length === 0) {
      return null;
    }

    return {
      id: this.stringFromUnknown(record.id) ?? `starter-${index + 1}`,
      guideText,
      options: options.slice(0, STARTER_PROMPT_POLICY.maxVisibleOptions),
      directInput: this.normalizeDirectInput(record.directInput),
    };
  }

  private normalizeStarterPromptOptions(value: unknown): StarterPromptOption[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((option, index) => {
        const record = this.recordOrEmpty(option);
        const label = this.stringFromUnknown(record.label);
        const message = this.stringFromUnknown(record.message);

        if (!label || !message) {
          return null;
        }

        return {
          key: this.stringFromUnknown(record.key) ?? String.fromCharCode(65 + index),
          label,
          message,
        };
      })
      .filter((option): option is StarterPromptOption => Boolean(option));
  }

  private normalizeDirectInput(value: unknown) {
    const record = this.recordOrEmpty(value);

    return {
      key: this.stringFromUnknown(record.key) ?? 'C',
      label:
        this.stringFromUnknown(record.label) ??
        DEFAULT_STARTER_PROMPT_COPY.directInputLabel,
    };
  }

  private defaultStarterPromptSet(
    artistSlug: string,
    artistDisplayName: string,
  ): StarterPromptSet {
    return {
      id: `${artistSlug}-soft-start-1`,
      guideText: DEFAULT_STARTER_PROMPT_COPY.guideText(artistDisplayName),
      options: DEFAULT_STARTER_PROMPT_COPY.options.map((option) => ({
        key: option.key,
        label: option.label,
        message: option.message(artistDisplayName),
      })),
      directInput: {
        key: 'C',
        label: DEFAULT_STARTER_PROMPT_COPY.directInputLabel,
      },
    };
  }
}

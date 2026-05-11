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
  ChatLlmProviderReadiness,
} from './llm-provider.adapter';

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
const BASIC_CHAT_POLICY = {
  mode: 'daily_talk',
  priceLumina: 0,
  modelTier: 'nano',
  cooldownSeconds: 30,
  dailyLimit: 50,
  maxInputChars: 1000,
  estimatedCostCeilingKrw: '0.20',
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

  async getStarterPrompts(input: { artistId?: string; artistSlug?: string }) {
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

  async createMessage(
    userId: string,
    sessionId: string,
    input: {
      body: string;
      messageType?: string;
      chatFeatureOrderId?: string;
    },
  ) {
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
    }

    return this.prisma.$transaction(async (tx) => {
      const message = await tx.chatMessage.create({
        data: {
          chatSessionId: session.id,
          senderType: 'user',
          messageType: input.messageType ?? 'text',
          body: input.body,
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

  getFeatureProducts() {
    return this.prisma.chatFeatureProduct.findMany({
      where: { status: 'active' },
      orderBy: [{ priceLumina: 'asc' }, { name: 'asc' }],
    });
  }

  async previewFeatureOrder(
    userId: string,
    input: {
      chatSessionId: string;
      chatFeatureProductId: string;
    },
  ) {
    const [session, product, wallet] = await Promise.all([
      this.getOwnedSession(userId, input.chatSessionId),
      this.prisma.chatFeatureProduct.findFirst({
        where: { id: input.chatFeatureProductId, status: 'active' },
      }),
      this.prisma.walletAccount.findUnique({
        where: {
          userId_currencyCode: { userId, currencyCode: DEFAULT_CURRENCY },
        },
      }),
    ]);

    if (!product) {
      throw new NotFoundException('Chat feature product not found');
    }

    if (!wallet || wallet.status !== 'active') {
      throw new BadRequestException('Active wallet not found');
    }

    const metadata = this.recordOrEmpty(product.metadata);
    const generationPolicy = this.chatGenerationPolicy(product);
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
        displayName: this.stringFromUnknown(metadata.displayNameKo) ?? product.name,
        featureType: product.featureType,
        priceLumina: product.priceLumina,
        status: product.status,
        modelTier: this.stringFromUnknown(metadata.modelTier) ?? 'mini',
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
        settlementEligible: metadata.settlementEligible !== false,
        refundOnGenerationFailure: true,
        mvpLocked: metadata.mvpLocked === true,
        requiresIdentityVerification: false,
        generationStatus: generationPolicy.generationStatus,
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
    const [session, product] = await Promise.all([
      this.getOwnedSession(userId, input.chatSessionId),
      this.prisma.chatFeatureProduct.findFirst({
        where: { id: input.chatFeatureProductId, status: 'active' },
      }),
    ]);

    if (!product) {
      throw new NotFoundException('Chat feature product not found');
    }

    return this.prisma.$transaction(async (tx) => {
      if (input.idempotencyKey) {
        const existingOrder = await tx.chatFeatureOrder.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: { walletLedger: true, chatFeatureProduct: true },
        });

        if (existingOrder) {
          return {
            order: existingOrder,
            idempotentReplay: true,
            policy: {
              generation: this.chatGenerationPolicy(existingOrder.chatFeatureProduct),
              failure: GENERATION_FAILURE_POLICY,
            },
          };
        }
      }

      if (this.requiresLlmGeneration(product) && !this.llmProvider.readiness().configured) {
        throw this.providerUnavailableException(product);
      }

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
          idempotencyKey: input.idempotencyKey
            ? `chat-feature:${input.idempotencyKey}`
            : undefined,
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
          idempotencyKey: input.idempotencyKey,
        },
        include: { walletLedger: true, chatFeatureProduct: true },
      });

      return {
        order,
        idempotentReplay: false,
        policy: {
          generation: this.chatGenerationPolicy(product),
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
    const body = this.normalizeGenerationBody(input.body);
    const session = await this.getOwnedSessionForGeneration(userId, sessionId);
    const order = input.chatFeatureOrderId
      ? await this.getFeatureOrderForGeneration(userId, session.id, input.chatFeatureOrderId)
      : null;
    const existingGenerated = order?.messages.find(
      (message) => message.senderType === 'artist_ai',
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
          where: { senderType: 'artist_ai' },
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

  private async persistGeneratedMessage(
    userId: string,
    sessionId: string,
    userMessageBody: string,
    chatFeatureOrderId: string | undefined,
    generated: ChatGenerationResult,
  ) {
    return this.prisma.$transaction(async (tx) => {
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
          senderType: 'artist_ai',
          messageType: 'text',
          body: generated.body,
          chatFeatureOrderId,
          modelMetadata: {
            provider: generated.usage.provider,
            model: generated.usage.model,
            usage: generated.usage,
            estimatedCostKrw: generated.usage.estimatedCostKrw,
          } satisfies Prisma.InputJsonObject,
          safetyMetadata: generated.safetyMetadata as Prisma.InputJsonObject,
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
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.chatFeatureOrder.findFirst({
        where: { id: orderId, userId },
        include: { walletLedger: true },
      });

      if (!order || order.status === 'failed') {
        return order;
      }

      const failedOrder = await tx.chatFeatureOrder.update({
        where: { id: order.id },
        data: {
          status: 'failed',
          updatedAt: new Date(),
        },
      });

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

  private providerUnavailableException(
    product: {
      id: string;
      sku: string;
      featureType: string;
      metadata: unknown;
    } | null,
  ) {
    const readiness = this.llmProvider.readiness();

    return new ServiceUnavailableException({
      code: 'CHAT_LLM_PROVIDER_NOT_CONFIGURED',
      message: 'Character chat generation provider is not configured',
      messageKey: readiness.messageKey,
      details: {
        generationStatus: readiness.status,
        provider: this.providerDetails(readiness),
        product: product ? this.productSummary(product) : null,
        policy: {
          generation: this.chatGenerationPolicy(product),
          failure: GENERATION_FAILURE_POLICY,
        },
      },
    });
  }

  private chatGenerationPolicy(product?: {
    featureType: string;
    metadata: unknown;
  } | null) {
    const metadata = this.recordOrEmpty(product?.metadata);
    const readiness = this.llmProvider.readiness();
    const modelTier =
      this.stringFromUnknown(metadata.modelTier) ??
      (product ? 'mini' : BASIC_CHAT_POLICY.modelTier);

    return {
      mode: product?.featureType ?? BASIC_CHAT_POLICY.mode,
      provider: this.providerDetails(readiness),
      canGenerate: readiness.configured,
      canCreatePaidOrder: product
        ? readiness.configured || !this.requiresLlmGeneration(product)
        : false,
      generationStatus: readiness.configured ? 'ready' : readiness.status,
      modelTier,
      maxInputChars: product ? 2000 : BASIC_CHAT_POLICY.maxInputChars,
      cooldownSeconds: product ? 0 : BASIC_CHAT_POLICY.cooldownSeconds,
      dailyLimit: product ? null : BASIC_CHAT_POLICY.dailyLimit,
      estimatedCostCeilingKrw: product
        ? this.estimatedPaidCostCeiling(modelTier)
        : BASIC_CHAT_POLICY.estimatedCostCeilingKrw,
      usageMetadataPath: 'chat_messages.model_metadata',
      safetyMetadataPath: 'chat_messages.safety_metadata',
    };
  }

  private productSummary(product: {
    id: string;
    sku: string;
    featureType: string;
    metadata: unknown;
  }) {
    const metadata = this.recordOrEmpty(product.metadata);

    return {
      id: product.id,
      sku: product.sku,
      featureType: product.featureType,
      modelTier: this.stringFromUnknown(metadata.modelTier) ?? 'mini',
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

  private providerDetails(readiness: ChatLlmProviderReadiness) {
    return {
      name: readiness.provider,
      configured: readiness.configured,
      status: readiness.status,
    };
  }

  private requiresLlmGeneration(product: { featureType: string }) {
    return PAID_GENERATION_FEATURE_TYPES.has(product.featureType);
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

  private stringFromUnknown(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
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
      label: this.stringFromUnknown(record.label) ?? '직접 입력하기',
    };
  }

  private defaultStarterPromptSet(
    artistSlug: string,
    artistDisplayName: string,
  ): StarterPromptSet {
    return {
      id: `${artistSlug}-soft-start-1`,
      guideText: `처음이라 조금 어색하죠? ${artistDisplayName}에게 이렇게 말을 걸어볼까요?`,
      options: [
        {
          key: 'A',
          label: '오늘 어땠는지 물어보기',
          message: `오늘 하루 어땠어? 괜히 ${artistDisplayName} 생각이 나서 들렀어.`,
        },
        {
          key: 'B',
          label: '조용히 응원하기',
          message: `오늘도 ${artistDisplayName}의 무대를 기다리고 있어. 천천히 와도 괜찮아.`,
        },
      ],
      directInput: {
        key: 'C',
        label: '직접 입력하기',
      },
    };
  }
}

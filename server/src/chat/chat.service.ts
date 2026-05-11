import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

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
        generationStatus: 'not_started',
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
          return { order: existingOrder, idempotentReplay: true };
        }
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

      return { order, idempotentReplay: false };
    });
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

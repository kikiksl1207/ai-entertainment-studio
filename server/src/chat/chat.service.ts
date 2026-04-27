import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_CURRENCY = 'LUMINA';

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
}

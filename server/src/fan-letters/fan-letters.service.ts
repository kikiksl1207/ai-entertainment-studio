import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  assertAtomicWalletDebitSucceeded,
  requireWalletMutationIdempotencyKey,
  throwWalletMutationIdempotencyConflict,
} from '../common/wallet-mutation-safety';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

type FanLetterQuery = Record<string, string | undefined>;

const DEFAULT_CURRENCY = 'LUMINA';
const FAN_LETTER_PRICE_LUMINA = new Decimal(30);
const FAN_LETTER_STATUSES = new Set(['submitted', 'seen', 'replied', 'archived']);
const FAN_LETTER_BODY_MIN_LENGTH = 10;
const FAN_LETTER_BODY_MAX_LENGTH = 1000;
const FAN_LETTER_REPLY_MAX_LENGTH = 1000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class FanLettersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  getPolicy() {
    return {
      product: 'fan_letter',
      policyVersion: '2026-05-05.fan-letter-mvp',
      priceLumina: FAN_LETTER_PRICE_LUMINA,
      priceKrwEquivalent: 300,
      currencyCode: DEFAULT_CURRENCY,
      settlement: {
        freeLetters: 'not_settlement_eligible',
        paidLetters: 'settlement_candidate_after_fee_cost_tax_policy',
        creatorVisibleEstimate: 'later_settlement_dashboard',
      },
      limits: {
        titleMaxLength: 80,
        bodyMinLength: FAN_LETTER_BODY_MIN_LENGTH,
        bodyMaxLength: FAN_LETTER_BODY_MAX_LENGTH,
        replyMaxLength: FAN_LETTER_REPLY_MAX_LENGTH,
      },
      safety: {
        moderationStatus: 'pending',
        adultContent: 'not_allowed',
        directDm: 'not_supported_mvp',
        artistReply: 'operator_optional_reply',
      },
      endpoints: {
        preview: '/api/v1/fan-letters/preview',
        create: '/api/v1/fan-letters',
        sent: '/api/v1/me/fan-letters/sent',
        received: '/api/v1/me/fan-letters/received',
      },
    };
  }

  async previewFanLetter(userId: string, input: { artistId: string }) {
    const [artist, wallet] = await Promise.all([
      this.activeArtist(input.artistId),
      this.prisma.walletAccount.findUnique({
        where: {
          userId_currencyCode: { userId, currencyCode: DEFAULT_CURRENCY },
        },
      }),
    ]);

    if (!wallet || wallet.status !== 'active') {
      throw new BadRequestException('Active wallet not found');
    }

    return {
      artist,
      product: this.productView(),
      wallet: {
        id: wallet.id,
        currencyCode: wallet.currencyCode,
        balanceLumina: wallet.cachedBalance,
        afterBalanceLumina: wallet.cachedBalance.minus(FAN_LETTER_PRICE_LUMINA),
        sufficientBalance: wallet.cachedBalance.gte(FAN_LETTER_PRICE_LUMINA),
      },
      policy: this.getPolicy(),
    };
  }

  async createFanLetter(
    userId: string,
    input: {
      artistId: string;
      title?: string;
      body: string;
      idempotencyKey?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    const artist = await this.activeArtist(input.artistId);
    const body = this.fanLetterBody(input.body);
    const title = this.optionalTitle(input.title) ?? null;
    const idempotencyKey = requireWalletMutationIdempotencyKey(input.idempotencyKey);

    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existingLetter = await tx.fanLetter.findUnique({
        where: { idempotencyKey },
        include: this.fanLetterInclude(),
      });

      if (existingLetter) {
        this.assertFanLetterIdempotentReplay(existingLetter, {
          senderUserId: userId,
          artistId: artist.id,
          title,
          body,
        });

        return {
          fanLetter: this.toFanLetterView(existingLetter),
          idempotentReplay: true,
        };
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
        where: { id: wallet.id, cachedBalance: { gte: FAN_LETTER_PRICE_LUMINA } },
        data: {
          cachedBalance: { decrement: FAN_LETTER_PRICE_LUMINA },
          updatedAt: new Date(),
        },
      });

      assertAtomicWalletDebitSucceeded(updatedWallet);

      const ledger = await tx.walletLedger.create({
        data: {
          walletAccountId: wallet.id,
          direction: 'debit',
          amount: FAN_LETTER_PRICE_LUMINA,
          ledgerType: 'fan_letter_spend',
          referenceType: 'fan_letter',
          idempotencyKey: `fan-letter:${idempotencyKey}`,
          memo: `Fan letter to ${artist.displayName}`,
        },
      });

      const fanLetter = await tx.fanLetter.create({
        data: {
          senderUserId: userId,
          artistId: artist.id,
          walletLedgerId: ledger.id,
          amountLumina: FAN_LETTER_PRICE_LUMINA,
          title,
          body,
          idempotencyKey,
          metadata: this.toJson({
            ...(input.metadata ?? {}),
            priceLumina: FAN_LETTER_PRICE_LUMINA.toString(),
            productSku: 'FAN_LETTER_BASIC_30L',
            settlementCandidate: true,
          }),
        },
        include: this.fanLetterInclude(),
      });

      await tx.walletLedger.update({
        where: { id: ledger.id },
        data: { referenceId: fanLetter.id },
      });

      return {
        fanLetter: this.toFanLetterView(fanLetter),
        idempotentReplay: false,
      };
    });

    if (!result.idempotentReplay) {
      await this.notifyArtistOperatorsSafely(artist.id, userId, result.fanLetter.id, body);
    }

    return result;
  }

  async getSentLetters(userId: string, query: FanLetterQuery) {
    const take = this.take(query.take);
    const cursor = this.cursor(query.cursor);

    const rows = await this.prisma.fanLetter.findMany({
      where: { senderUserId: userId },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: this.fanLetterInclude(),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return this.paginated(rows, take);
  }

  async getReceivedLetters(userId: string, query: FanLetterQuery) {
    const take = this.take(query.take);
    const cursor = this.cursor(query.cursor);
    const artistId = this.optionalString(query.artistId);
    const status = this.optionalString(query.status);
    const operatedArtistIds = await this.operatedArtistIds(userId);

    if (!operatedArtistIds.length) {
      return { items: [], count: 0, hasMore: false, nextCursor: null };
    }

    if (artistId && !operatedArtistIds.includes(artistId)) {
      throw new ForbiddenException('Artist operator access is required');
    }

    if (status && !FAN_LETTER_STATUSES.has(status)) {
      throw new BadRequestException('status is invalid');
    }

    const rows = await this.prisma.fanLetter.findMany({
      where: {
        artistId: artistId ?? { in: operatedArtistIds },
        ...(status ? { status } : {}),
      },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: this.fanLetterInclude(),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return this.paginated(rows, take);
  }

  async updateReceivedLetterStatus(
    userId: string,
    fanLetterId: string,
    input: {
      status: string;
      replyBody?: string;
    },
  ) {
    if (!UUID_PATTERN.test(fanLetterId)) {
      throw new BadRequestException('fanLetterId must be a UUID');
    }

    if (!FAN_LETTER_STATUSES.has(input.status)) {
      throw new BadRequestException('status is invalid');
    }

    const before = await this.prisma.fanLetter.findUnique({
      where: { id: fanLetterId },
      include: this.fanLetterInclude(),
    });

    if (!before) {
      throw new NotFoundException('Fan letter not found');
    }

    await this.assertArtistOperator(userId, before.artistId);

    const replyBody =
      input.status === 'replied' ? this.fanLetterReplyBody(input.replyBody) : undefined;
    const updated = await this.prisma.fanLetter.update({
      where: { id: before.id },
      data: {
        status: input.status,
        replyBody,
        repliedAt: input.status === 'replied' ? new Date() : undefined,
        repliedByUserId: input.status === 'replied' ? userId : undefined,
        updatedAt: new Date(),
      },
      include: this.fanLetterInclude(),
    });

    if (input.status === 'replied') {
      await this.notificationsService.createNotification({
        userId: updated.senderUserId,
        type: 'fan_letter.reply',
        title: 'Fan letter reply arrived',
        body: this.truncate(replyBody ?? '', 120),
        actorUserId: userId,
        artistId: updated.artistId,
        targetType: 'fan_letter',
        targetId: updated.id,
      });
    }

    return { fanLetter: this.toFanLetterView(updated) };
  }

  private async activeArtist(artistIdOrSlug: string) {
    const artist = await this.prisma.artist.findFirst({
      where: {
        status: 'active',
        ...(UUID_PATTERN.test(artistIdOrSlug)
          ? { id: artistIdOrSlug }
          : { slug: artistIdOrSlug }),
      },
      select: { id: true, slug: true, displayName: true, status: true },
    });

    if (!artist) {
      throw new NotFoundException('Artist not found');
    }

    return artist;
  }

  private async operatedArtistIds(userId: string) {
    const rows = await this.prisma.artistOperator.findMany({
      where: {
        userId,
        status: 'active',
        revokedAt: null,
      },
      select: { artistId: true },
    });

    return rows.map((row) => row.artistId);
  }

  private async assertArtistOperator(userId: string, artistId: string) {
    const operator = await this.prisma.artistOperator.findFirst({
      where: {
        userId,
        artistId,
        status: 'active',
        revokedAt: null,
      },
      select: { id: true },
    });

    if (!operator) {
      throw new ForbiddenException('Artist operator access is required');
    }
  }

  private async notifyArtistOperatorsSafely(
    artistId: string,
    senderUserId: string,
    fanLetterId: string,
    body: string,
  ) {
    const operators = await this.prisma.artistOperator.findMany({
      where: {
        artistId,
        status: 'active',
        revokedAt: null,
      },
      select: { userId: true },
      take: 20,
    });

    await Promise.all(
      operators.map((operator) =>
        this.notificationsService.createNotification({
          userId: operator.userId,
          type: 'fan_letter.received',
          title: 'New fan letter',
          body: this.truncate(body, 120),
          actorUserId: senderUserId,
          artistId,
          targetType: 'fan_letter',
          targetId: fanLetterId,
        }),
      ),
    );
  }

  private fanLetterInclude() {
    return {
      artist: {
        select: { id: true, slug: true, displayName: true, status: true },
      },
      sender: {
        select: {
          id: true,
          email: true,
          profile: {
            select: { displayName: true, publicHandle: true },
          },
        },
      },
      walletLedger: true,
    } satisfies Prisma.FanLetterInclude;
  }

  private toFanLetterView(
    fanLetter: Prisma.FanLetterGetPayload<{
      include: ReturnType<FanLettersService['fanLetterInclude']>;
    }>,
  ) {
    return {
      id: fanLetter.id,
      status: fanLetter.status,
      moderationStatus: fanLetter.moderationStatus,
      amountLumina: fanLetter.amountLumina,
      title: fanLetter.title,
      body: fanLetter.body,
      replyBody: fanLetter.replyBody,
      repliedAt: fanLetter.repliedAt,
      createdAt: fanLetter.createdAt,
      updatedAt: fanLetter.updatedAt,
      artist: fanLetter.artist,
      sender: {
        id: fanLetter.sender.id,
        displayName:
          fanLetter.sender.profile?.displayName ??
          fanLetter.sender.profile?.publicHandle ??
          'Lumina User',
        publicHandle: fanLetter.sender.profile?.publicHandle ?? null,
      },
      walletLedgerId: fanLetter.walletLedgerId,
      settlement: {
        candidate: fanLetter.amountLumina.gt(0),
        source: 'paid_fan_letter',
        grossLumina: fanLetter.amountLumina,
      },
    };
  }

  private assertFanLetterIdempotentReplay(
    letter: {
      senderUserId: string;
      artistId: string;
      title: string | null;
      body: string;
    },
    expected: {
      senderUserId: string;
      artistId: string;
      title: string | null;
      body: string;
    },
  ) {
    if (
      letter.senderUserId === expected.senderUserId &&
      letter.artistId === expected.artistId &&
      letter.title === expected.title &&
      letter.body === expected.body
    ) {
      return;
    }

    throwWalletMutationIdempotencyConflict();
  }

  private productView() {
    return {
      sku: 'FAN_LETTER_BASIC_30L',
      name: 'Fan Letter',
      priceLumina: FAN_LETTER_PRICE_LUMINA,
      status: 'active',
    };
  }

  private fanLetterBody(value: string) {
    const normalized = value.trim();

    if (
      normalized.length < FAN_LETTER_BODY_MIN_LENGTH ||
      normalized.length > FAN_LETTER_BODY_MAX_LENGTH
    ) {
      throw new BadRequestException(
        `body must be ${FAN_LETTER_BODY_MIN_LENGTH}-${FAN_LETTER_BODY_MAX_LENGTH} characters`,
      );
    }

    return normalized;
  }

  private fanLetterReplyBody(value?: string) {
    const normalized = value?.trim();

    if (!normalized) {
      throw new BadRequestException('replyBody is required when status is replied');
    }

    if (normalized.length > FAN_LETTER_REPLY_MAX_LENGTH) {
      throw new BadRequestException(
        `replyBody must be shorter than or equal to ${FAN_LETTER_REPLY_MAX_LENGTH} characters`,
      );
    }

    return normalized;
  }

  private optionalTitle(value?: string) {
    if (!value?.trim()) {
      return undefined;
    }

    const normalized = value.trim();

    if (normalized.length > 80) {
      throw new BadRequestException('title must be shorter than or equal to 80 characters');
    }

    return normalized;
  }

  private paginated(
    rows: Prisma.FanLetterGetPayload<{
      include: ReturnType<FanLettersService['fanLetterInclude']>;
    }>[],
    take: number,
  ) {
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const lastItem = items.at(-1);

    return {
      items: items.map((item) => this.toFanLetterView(item)),
      count: items.length,
      hasMore,
      nextCursor: hasMore && lastItem ? lastItem.id : null,
    };
  }

  private take(value?: string) {
    const parsed = Number(value ?? 30);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      throw new BadRequestException('take must be an integer between 1 and 100');
    }

    return parsed;
  }

  private cursor(value?: string) {
    const cursor = this.optionalString(value);

    if (cursor && !UUID_PATTERN.test(cursor)) {
      throw new BadRequestException('cursor must be a UUID');
    }

    return cursor;
  }

  private optionalString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private toJson(value: Record<string, unknown>) {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private truncate(value: string, maxLength: number) {
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
  }
}

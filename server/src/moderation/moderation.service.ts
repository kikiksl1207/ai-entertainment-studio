import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

type ModerationMatch = {
  type: string;
  severity: 'block' | 'watch';
};

type ModerationReportBody = Record<string, unknown>;
type ModerationReportQuery = Record<string, string | undefined>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REPORT_TARGET_TYPES = new Set([
  'feed_post',
  'community_post',
  'reply',
  'community_reply',
  'user',
  'artist',
]);

const REPORT_REASONS = new Set([
  'sexual_content',
  'harassment',
  'hate',
  'impersonation',
  'spam',
  'external_contact',
  'external_payment',
  'rights_violation',
  'other',
]);

const REPORT_STATUSES = new Set([
  'submitted',
  'reviewing',
  'resolved',
  'dismissed',
  'archived',
]);

const BLOCK_PATTERNS: Array<{ type: string; regex: RegExp }> = [
  { type: 'email', regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
  { type: 'phone_number', regex: /(?:\+?82[-.\s]?)?0?1[016789][-\s.]?\d{3,4}[-.\s.]?\d{4}/ },
  { type: 'external_payment', regex: /(bank account|wire transfer|paypal|venmo|cashapp|deposit|계좌|입금|송금|후원계좌)/i },
  { type: 'external_contact', regex: /(openchat|telegram|discord|line|kakaotalk|instagram|dm me|오픈채팅|카카오톡|카톡|텔레그램|라인|디스코드|인스타)/i },
];

const WATCH_PATTERNS: Array<{ type: string; regex: RegExp }> = [
  { type: 'offline_meeting', regex: /(meet offline|meet in person|private meeting|hotel|address|오프라인|직접 만나|호텔|주소)/i },
  { type: 'adult_boundary', regex: /(adult only|explicit|nsfw|sexual)/i },
  { type: 'settlement_risk', regex: /(refund outside|direct sponsor|cash sponsor)/i },
];

@Injectable()
export class ModerationService {
  constructor(private readonly prisma: PrismaService) {}

  preview(input: { surface?: string; body: string }) {
    const body = input.body.trim();
    const matches = this.findMatches(body);
    const hasBlock = matches.some((match) => match.severity === 'block');
    const hasWatch = matches.some((match) => match.severity === 'watch');
    const decision = hasBlock ? 'block' : hasWatch ? 'watch' : 'allow';

    return {
      decision,
      riskLevel: hasBlock ? 'high' : hasWatch ? 'medium' : 'low',
      matchedTypes: matches.map((match) => match.type),
      userMessage:
        decision === 'allow'
          ? null
          : decision === 'block'
            ? 'This message contains content that cannot be posted or sent.'
            : 'This message may need additional review before publishing.',
      surface: input.surface ?? 'generic',
      policy: {
        mode: 'keyword_preview_mvp',
        hardBlockTypes: BLOCK_PATTERNS.map((pattern) => pattern.type),
        reviewTypes: WATCH_PATTERNS.map((pattern) => pattern.type),
        note: 'Preview only. Persisted moderation queues can be added with a later schema migration.',
      },
    };
  }

  async createReport(userId: string, input: ModerationReportBody) {
    const targetType = this.targetType(input.targetType);
    const targetId = this.uuid(input.targetId, 'targetId');
    const reason = this.reason(input.reason);
    const detail = this.optionalText(input.detail, 500);

    await this.assertTargetExists(targetType, targetId);

    const report = await this.prisma.$transaction(async (tx) => {
      const created = await tx.moderationReport.create({
        data: {
          reporterUserId: userId,
          targetType,
          targetId,
          reason,
          detail,
          metadata: this.toJson(this.object(input.metadata) ?? {}),
        },
        include: this.reportInclude(),
      });

      if (targetType === 'feed_post' || targetType === 'community_post') {
        await tx.communityPost.update({
          where: { id: targetId },
          data: { reportCount: { increment: 1 }, updatedAt: new Date() },
        });
      }

      return created;
    });

    return {
      report: this.presentReport(report),
      message: 'Report submitted',
    };
  }

  listReports(query: ModerationReportQuery) {
    const take = this.take(query.take, 50);
    const filters: Prisma.ModerationReportWhereInput[] = [];

    if (query.targetType) {
      filters.push({ targetType: this.targetType(query.targetType) });
    }

    if (query.targetId) {
      filters.push({ targetId: this.uuid(query.targetId, 'targetId') });
    }

    if (query.status) {
      filters.push({ status: this.status(query.status) });
    }

    if (query.reason) {
      filters.push({ reason: this.reason(query.reason) });
    }

    if (query.query?.trim()) {
      const text = query.query.trim();
      filters.push({
        OR: [
          { detail: { contains: text, mode: 'insensitive' } },
          { reason: { contains: text, mode: 'insensitive' } },
          { reporter: { email: { contains: text, mode: 'insensitive' } } },
          {
            reporter: {
              profile: { displayName: { contains: text, mode: 'insensitive' } },
            },
          },
        ],
      });
    }

    return this.findPaginated(filters.length ? { AND: filters } : {}, take, query.cursor);
  }

  async getReport(reportId: string) {
    const report = await this.prisma.moderationReport.findUnique({
      where: { id: this.uuid(reportId, 'reportId') },
      include: this.reportInclude(),
    });

    if (!report) {
      throw new NotFoundException('Moderation report not found');
    }

    return this.presentReport(report);
  }

  async updateReport(user: AuthUser, reportId: string, input: ModerationReportBody) {
    const before = await this.prisma.moderationReport.findUnique({
      where: { id: this.uuid(reportId, 'reportId') },
      include: this.reportInclude(),
    });

    if (!before) {
      throw new NotFoundException('Moderation report not found');
    }

    if (
      input.status === undefined &&
      input.detail === undefined &&
      input.metadata === undefined
    ) {
      throw new BadRequestException('At least one update field is required');
    }

    const report = await this.prisma.moderationReport.update({
      where: { id: before.id },
      data: this.clean({
        status: input.status === undefined ? undefined : this.status(input.status),
        detail: input.detail === undefined ? undefined : this.optionalText(input.detail, 500),
        metadata:
          input.metadata === undefined
            ? undefined
            : this.mergeMetadata(before.metadata, {
                ...this.object(input.metadata),
                adminUpdatedByUserId: user.id,
                adminUpdatedAt: new Date().toISOString(),
              }),
        updatedAt: new Date(),
      }),
      include: this.reportInclude(),
    });

    await this.recordAudit(user, report.id, before, report);

    return {
      report: this.presentReport(report),
      message: 'Moderation report updated',
    };
  }

  private findMatches(body: string): ModerationMatch[] {
    const matches: ModerationMatch[] = [];

    for (const pattern of BLOCK_PATTERNS) {
      if (pattern.regex.test(body)) {
        matches.push({ type: pattern.type, severity: 'block' });
      }
    }

    for (const pattern of WATCH_PATTERNS) {
      if (pattern.regex.test(body)) {
        matches.push({ type: pattern.type, severity: 'watch' });
      }
    }

    return matches;
  }

  private async findPaginated(
    where: Prisma.ModerationReportWhereInput,
    take: number,
    cursor?: string,
  ) {
    const rows = await this.prisma.moderationReport.findMany({
      where,
      take: take + 1,
      ...(cursor
        ? {
            cursor: { id: this.uuid(cursor, 'cursor') },
            skip: 1,
          }
        : {}),
      include: this.reportInclude(),
      orderBy: { createdAt: 'desc' },
    });

    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const lastItem = items.at(-1);

    return {
      items: items.map((report) => this.presentReport(report)),
      count: items.length,
      hasMore,
      nextCursor: hasMore && lastItem ? lastItem.id : null,
    };
  }

  private async assertTargetExists(targetType: string, targetId: string) {
    if (targetType === 'feed_post' || targetType === 'community_post') {
      const post = await this.prisma.communityPost.findFirst({
        where: { id: targetId, deletedAt: null },
        select: { id: true },
      });

      if (!post) {
        throw new NotFoundException('Reported feed post not found');
      }

      return;
    }

    if (targetType === 'reply' || targetType === 'community_reply') {
      const reply = await this.prisma.communityReply.findFirst({
        where: { id: targetId, deletedAt: null },
        select: { id: true },
      });

      if (!reply) {
        throw new NotFoundException('Reported reply not found');
      }

      return;
    }

    if (targetType === 'user') {
      const user = await this.prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true },
      });

      if (!user) {
        throw new NotFoundException('Reported user not found');
      }

      return;
    }

    if (targetType === 'artist') {
      const artist = await this.prisma.artist.findUnique({
        where: { id: targetId },
        select: { id: true },
      });

      if (!artist) {
        throw new NotFoundException('Reported artist not found');
      }
    }
  }

  private reportInclude() {
    return {
      reporter: {
        select: {
          id: true,
          email: true,
          status: true,
          profile: {
            select: {
              displayName: true,
              publicHandle: true,
              avatarAssetId: true,
            },
          },
        },
      },
    } satisfies Prisma.ModerationReportInclude;
  }

  private presentReport(
    report: Prisma.ModerationReportGetPayload<{
      include: ReturnType<ModerationService['reportInclude']>;
    }>,
  ) {
    return report;
  }

  private targetType(value: unknown) {
    const normalized = this.requiredString(value, 'targetType');

    if (!REPORT_TARGET_TYPES.has(normalized)) {
      throw new BadRequestException(
        'targetType must be feed_post, community_post, reply, community_reply, user, or artist',
      );
    }

    return normalized;
  }

  private reason(value: unknown) {
    const normalized = this.requiredString(value, 'reason');

    if (!REPORT_REASONS.has(normalized)) {
      throw new BadRequestException(
        'reason must be sexual_content, harassment, hate, impersonation, spam, external_contact, external_payment, rights_violation, or other',
      );
    }

    return normalized;
  }

  private status(value: unknown) {
    const normalized = this.requiredString(value, 'status');

    if (!REPORT_STATUSES.has(normalized)) {
      throw new BadRequestException(
        'status must be submitted, reviewing, resolved, dismissed, or archived',
      );
    }

    return normalized;
  }

  private uuid(value: unknown, field: string) {
    const normalized = this.requiredString(value, field);

    if (!UUID_PATTERN.test(normalized)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }

    return normalized;
  }

  private take(value: unknown, fallback: number) {
    const parsed = value === undefined ? fallback : Number(value);

    if (!Number.isInteger(parsed)) {
      throw new BadRequestException('take must be an integer');
    }

    return Math.max(1, Math.min(parsed, 100));
  }

  private requiredString(value: unknown, field: string) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${field} is required`);
    }

    return value.trim();
  }

  private optionalText(value: unknown, maxLength: number) {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('detail must be a string');
    }

    const normalized = value.trim();

    if (!normalized) {
      return undefined;
    }

    if (normalized.length > maxLength) {
      throw new BadRequestException(`detail must be ${maxLength} characters or fewer`);
    }

    return normalized;
  }

  private object(value: unknown) {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('metadata must be an object');
    }

    return value as Record<string, unknown>;
  }

  private mergeMetadata(current: Prisma.JsonValue, patch: Record<string, unknown>) {
    const base =
      current && typeof current === 'object' && !Array.isArray(current)
        ? (current as Record<string, unknown>)
        : {};

    return this.toJson({ ...base, ...patch });
  }

  private clean<T extends Record<string, unknown>>(input: T) {
    return Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ) as T;
  }

  private recordAudit(
    user: AuthUser,
    targetId: string,
    beforeData: unknown,
    afterData: unknown,
  ) {
    return this.prisma.auditEvent.create({
      data: {
        actorUserId: user.id,
        actorType: 'admin',
        action: 'moderation_report.update',
        targetType: 'moderation_report',
        targetId,
        beforeData: this.toJson(beforeData),
        afterData: this.toJson(afterData),
        metadata: Prisma.JsonNull,
      },
    });
  }

  private toJson(value: unknown) {
    if (value === null || value === undefined) {
      return Prisma.JsonNull;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}

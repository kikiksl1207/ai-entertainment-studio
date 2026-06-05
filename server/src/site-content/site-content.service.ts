import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

type SiteContentQuery = Record<string, string | undefined>;
type SiteContentBody = Record<string, unknown>;
type JsonRecord = Record<string, unknown>;
type SiteContentEntryRecord = {
  id: string;
  contentKey: string;
  scope: string;
  pageKey: string | null;
  characterSlug: string | null;
  modelSlug: string | null;
  locale: string;
  title: string | null;
  body: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  content: Prisma.JsonValue;
  status: string;
  version: number;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  publishedByUserId: string | null;
  archivedByUserId: string | null;
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  auditLogs?: SiteContentAuditLogRecord[];
};
type SiteContentAuditLogRecord = {
  id: string;
  entryId: string;
  action: string;
  actorUserId: string | null;
  before: Prisma.JsonValue;
  after: Prisma.JsonValue;
  metadata: Prisma.JsonValue;
  createdAt: Date;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_SCOPES = new Set(['global', 'page', 'character', 'feature', 'notice']);
const VALID_STATUSES = new Set(['draft', 'published', 'archived']);
const SAFE_KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,158}[a-z0-9]$/;
const SAFE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/;
const SAFE_LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/;
const HTML_LIKE_PATTERN = /<\s*\/?\s*[a-zA-Z][^>]*>/;
const SCRIPT_LIKE_PATTERN = /(?:<\s*script\b|javascript:|data:text\/html)/i;
const VALID_RESTORE_TARGET_STATUSES = new Set(['draft', 'published']);
const PUBLIC_TAKE_MAX = 500;
const ADMIN_TAKE_MAX = 100;
const MAX_TITLE_LENGTH = 180;
const MAX_BODY_LENGTH = 5000;
const MAX_CTA_LABEL_LENGTH = 80;
const MAX_CTA_HREF_LENGTH = 500;
const MAX_CONTENT_STRING_LENGTH = 5000;
const ALLOWED_CTA_HOSTS = new Set(['lumina-stage.com', 'www.lumina-stage.com']);
const RESERVED_NAVIGATION_CONTENT_KEYS = new Set([
  'home.nav.label',
  'artists.nav.label',
  'lumina-pick.nav.label',
  'navigation.home.label',
  'navigation.artists.label',
  'navigation.lumina-pick.label',
  'main-nav.home.label',
  'main-nav.artists.label',
  'main-nav.lumina-pick.label',
]);

@Injectable()
export class SiteContentService {
  constructor(private readonly prisma: PrismaService) {}

  async getBootstrap(query: SiteContentQuery) {
    const locale = this.locale(query.locale);
    const where: Prisma.SiteContentEntryWhereInput = {
      status: 'published',
      locale,
      ...this.optionalFilter('scope', query.scope),
      ...this.optionalFilter('pageKey', query.pageKey),
      ...this.optionalFilter('characterSlug', query.characterSlug),
      ...this.optionalFilter('modelSlug', query.modelSlug),
    };

    const items = await this.prisma.siteContentEntry.findMany({
      where,
      orderBy: [{ scope: 'asc' }, { pageKey: 'asc' }, { contentKey: 'asc' }],
      take: this.take(query.take, 200, PUBLIC_TAKE_MAX),
    });
    const presentedItems = items.map((item) => this.presentPublicEntry(item));
    const content = Object.fromEntries(
      presentedItems.map((item) => [item.contentKey, item]),
    );

    return {
      generatedAt: new Date().toISOString(),
      locale,
      filters: this.presentFilters(query),
      items: presentedItems,
      content,
      policy: {
        publishedOnly: true,
        fallbackRequired: true,
        rawHtmlAllowed: false,
        editableNavigation: false,
      },
    };
  }

  async listAdmin(user: AuthUser, query: SiteContentQuery) {
    this.assertSuperAdmin(user);
    const where = this.adminWhere(query);
    const take = this.take(query.take, 50, ADMIN_TAKE_MAX);
    const items = await this.prisma.siteContentEntry.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { contentKey: 'asc' }],
      take,
    });
    const total = await this.prisma.siteContentEntry.count({ where });

    return {
      generatedAt: new Date().toISOString(),
      items: items.map((item) => this.presentAdminEntry(item)),
      pagination: {
        take,
        total,
      },
      policy: this.adminPolicy(),
    };
  }

  async getAdmin(user: AuthUser, id: string) {
    this.assertSuperAdmin(user);
    this.assertUuid(id, 'id');
    const entry = await this.prisma.siteContentEntry.findUnique({
      where: { id },
      include: {
        auditLogs: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!entry) {
      throw this.notFoundError(id);
    }

    return {
      item: this.presentAdminEntry(entry),
      auditLogs: entry.auditLogs.map((log) => this.presentAuditLog(log)),
      policy: this.adminPolicy(),
    };
  }

  async createAdmin(user: AuthUser, input: SiteContentBody) {
    this.assertSuperAdmin(user);
    const data = this.createData(user, input);
    const existing = await this.prisma.siteContentEntry.findFirst({
      where: { contentKey: data.contentKey, locale: data.locale },
    });

    if (existing) {
      throw this.keyExistsError(data.contentKey, data.locale, existing);
    }

    try {
      const entry = await this.prisma.$transaction(async (tx) => {
        const created = await tx.siteContentEntry.create({ data });
        await this.recordAudit(tx, {
          entryId: created.id,
          actorUserId: user.id,
          action: 'create',
          before: {},
          after: this.auditSnapshot(created),
          metadata: { changedFields: Object.keys(this.auditSnapshot(created)) },
        });
        return created;
      });

      return {
        item: this.presentAdminEntry(entry),
        policy: this.adminPolicy(),
      };
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw this.keyExistsError(data.contentKey, data.locale);
      }

      throw error;
    }
  }

  async updateAdmin(user: AuthUser, id: string, input: SiteContentBody) {
    this.assertSuperAdmin(user);
    this.assertUuid(id, 'id');
    if (this.hasOwn(input, 'status')) {
      throw this.badRequestError({
        code: 'SITE_CONTENT_STATUS_ENDPOINT_REQUIRED',
        message: 'Use publish or archive endpoints to change status',
        messageKey: 'siteContent.error.statusEndpointRequired',
      });
    }

    const existing = await this.findAdminEntry(id);
    if (existing.status === 'archived') {
      throw this.badRequestError({
        code: 'SITE_CONTENT_ARCHIVED',
        message: 'Archived site content cannot be edited',
        messageKey: 'siteContent.error.archived',
        details: { id },
      });
    }

    const update = this.updateData(user, input);
    if (!update.changed) {
      throw this.badRequestError({
        code: 'SITE_CONTENT_NO_CHANGES',
        message: 'No editable fields were provided',
        messageKey: 'siteContent.error.noChanges',
      });
    }

    const entry = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.siteContentEntry.update({
        where: { id },
        data: update.data,
      });
      await this.recordAudit(tx, {
        entryId: id,
        actorUserId: user.id,
        action: 'update',
        before: this.auditSnapshot(existing),
        after: this.auditSnapshot(updated),
        metadata: this.auditDiff(existing, updated),
      });
      return updated;
    });

    return {
      item: this.presentAdminEntry(entry),
      policy: this.adminPolicy(),
    };
  }

  async publishAdmin(user: AuthUser, id: string) {
    this.assertSuperAdmin(user);
    this.assertUuid(id, 'id');
    const existing = await this.findAdminEntry(id);
    this.assertPublishable(existing);
    if (existing.status === 'published') {
      return {
        item: this.presentAdminEntry(existing),
        alreadyPublished: true,
        policy: this.adminPolicy(),
      };
    }

    const now = new Date();
    const entry = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.siteContentEntry.update({
        where: { id },
        data: {
          status: 'published',
          publishedAt: now,
          archivedAt: null,
          archivedByUserId: null,
          publishedByUserId: user.id,
          updatedByUserId: user.id,
          version: { increment: 1 },
        },
      });
      await this.recordAudit(tx, {
        entryId: id,
        actorUserId: user.id,
        action: 'publish',
        before: this.auditSnapshot(existing),
        after: this.auditSnapshot(updated),
        metadata: this.auditDiff(existing, updated),
      });
      return updated;
    });

    return {
      item: this.presentAdminEntry(entry),
      policy: this.adminPolicy(),
    };
  }

  async archiveAdmin(user: AuthUser, id: string) {
    this.assertSuperAdmin(user);
    this.assertUuid(id, 'id');
    const existing = await this.findAdminEntry(id);
    if (existing.status === 'archived') {
      return {
        item: this.presentAdminEntry(existing),
        alreadyArchived: true,
        policy: this.adminPolicy(),
      };
    }

    const now = new Date();
    const entry = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.siteContentEntry.update({
        where: { id },
        data: {
          status: 'archived',
          archivedAt: now,
          archivedByUserId: user.id,
          updatedByUserId: user.id,
          version: { increment: 1 },
        },
      });
      await this.recordAudit(tx, {
        entryId: id,
        actorUserId: user.id,
        action: 'archive',
        before: this.auditSnapshot(existing),
        after: this.auditSnapshot(updated),
        metadata: this.auditDiff(existing, updated),
      });
      return updated;
    });

    return {
      item: this.presentAdminEntry(entry),
      policy: this.adminPolicy(),
    };
  }

  async restoreAdmin(user: AuthUser, id: string, input: SiteContentBody = {}) {
    this.assertSuperAdmin(user);
    this.assertUuid(id, 'id');
    const targetStatus = this.restoreTargetStatus(input.status);
    const existing = await this.findAdminEntry(id);

    if (existing.status !== 'archived') {
      return {
        item: this.presentAdminEntry(existing),
        alreadyRestored: true,
        restored: false,
        targetStatus: existing.status,
        policy: this.adminPolicy(),
      };
    }

    if (targetStatus === 'published') {
      this.assertHasPublishableContent(existing);
    }

    const now = new Date();
    const entry = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.siteContentEntry.update({
        where: { id },
        data: {
          status: targetStatus,
          archivedAt: null,
          archivedByUserId: null,
          publishedAt: targetStatus === 'published' ? now : null,
          publishedByUserId: targetStatus === 'published' ? user.id : null,
          updatedByUserId: user.id,
          version: { increment: 1 },
        },
      });
      await this.recordAudit(tx, {
        entryId: id,
        actorUserId: user.id,
        action: 'restore',
        before: this.auditSnapshot(existing),
        after: this.auditSnapshot(updated),
        metadata: {
          ...this.auditDiff(existing, updated),
          targetStatus,
        },
      });
      return updated;
    });

    return {
      item: this.presentAdminEntry(entry),
      restored: true,
      targetStatus,
      policy: this.adminPolicy(),
    };
  }

  private createData(user: AuthUser, input: SiteContentBody) {
    const status = this.status(input.status, 'draft');
    if (status !== 'draft') {
      throw this.badRequestError({
        code: 'SITE_CONTENT_CREATE_DRAFT_ONLY',
        message: 'Create site content as draft, then publish it',
        messageKey: 'siteContent.error.createDraftOnly',
      });
    }

    const contentKey = this.safePatternString(
      input.contentKey,
      'contentKey',
      SAFE_KEY_PATTERN,
      160,
    );
    this.assertEditableContentKey(contentKey);
    const scope = this.scope(input.scope);
    const pageKey = this.optionalSlug(input.pageKey, 'pageKey');
    const characterSlug = this.optionalSlug(input.characterSlug, 'characterSlug');
    const modelSlug = this.optionalSlug(input.modelSlug, 'modelSlug');
    const locale = this.locale(this.optionalString(input.locale) ?? undefined);
    const content = this.contentObject(input.content);

    return {
      contentKey,
      scope,
      pageKey,
      characterSlug,
      modelSlug,
      locale,
      title: this.optionalSafeText(input.title, 'title', MAX_TITLE_LENGTH),
      body: this.optionalSafeText(input.body, 'body', MAX_BODY_LENGTH),
      ctaLabel: this.optionalSafeText(
        input.ctaLabel,
        'ctaLabel',
        MAX_CTA_LABEL_LENGTH,
      ),
      ctaHref: this.optionalCtaHref(input.ctaHref),
      content: content as Prisma.InputJsonValue,
      status,
      createdByUserId: user.id,
      updatedByUserId: user.id,
    } satisfies Prisma.SiteContentEntryCreateInput;
  }

  private updateData(user: AuthUser, input: SiteContentBody) {
    const data: Prisma.SiteContentEntryUpdateInput = {
      updatedByUserId: user.id,
      version: { increment: 1 },
    };
    let changed = false;

    if (this.hasOwn(input, 'scope')) {
      data.scope = this.scope(input.scope);
      changed = true;
    }
    if (this.hasOwn(input, 'pageKey')) {
      data.pageKey = this.optionalSlug(input.pageKey, 'pageKey');
      changed = true;
    }
    if (this.hasOwn(input, 'characterSlug')) {
      data.characterSlug = this.optionalSlug(input.characterSlug, 'characterSlug');
      changed = true;
    }
    if (this.hasOwn(input, 'modelSlug')) {
      data.modelSlug = this.optionalSlug(input.modelSlug, 'modelSlug');
      changed = true;
    }
    if (this.hasOwn(input, 'title')) {
      data.title = this.optionalSafeText(input.title, 'title', MAX_TITLE_LENGTH);
      changed = true;
    }
    if (this.hasOwn(input, 'body')) {
      data.body = this.optionalSafeText(input.body, 'body', MAX_BODY_LENGTH);
      changed = true;
    }
    if (this.hasOwn(input, 'ctaLabel')) {
      data.ctaLabel = this.optionalSafeText(
        input.ctaLabel,
        'ctaLabel',
        MAX_CTA_LABEL_LENGTH,
      );
      changed = true;
    }
    if (this.hasOwn(input, 'ctaHref')) {
      data.ctaHref = this.optionalCtaHref(input.ctaHref);
      changed = true;
    }
    if (this.hasOwn(input, 'content')) {
      data.content = this.contentObject(input.content) as Prisma.InputJsonValue;
      changed = true;
    }

    return { data, changed };
  }

  private async findAdminEntry(id: string) {
    const entry = await this.prisma.siteContentEntry.findUnique({ where: { id } });
    if (!entry) {
      throw this.notFoundError(id);
    }

    return entry;
  }

  private adminWhere(query: SiteContentQuery) {
    const where: Prisma.SiteContentEntryWhereInput = {
      ...this.optionalFilter('status', query.status),
      ...this.optionalFilter('scope', query.scope),
      ...this.optionalFilter('pageKey', query.pageKey),
      ...this.optionalFilter('characterSlug', query.characterSlug),
      ...this.optionalFilter('modelSlug', query.modelSlug),
      ...this.optionalFilter('locale', query.locale),
    };
    const search = this.optionalString(query.search);
    if (search) {
      where.OR = [
        { contentKey: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { body: { contains: search, mode: 'insensitive' } },
        { ctaLabel: { contains: search, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  private optionalFilter(
    key: 'status' | 'scope' | 'pageKey' | 'characterSlug' | 'modelSlug' | 'locale',
    rawValue?: string,
  ) {
    const value = this.optionalString(rawValue);
    if (!value) {
      return {};
    }
    if (key === 'status') {
      return { [key]: this.status(value) };
    }
    if (key === 'scope') {
      return { [key]: this.scope(value) };
    }
    if (key === 'locale') {
      return { [key]: this.locale(value) };
    }

    return { [key]: this.optionalSlug(value, key) };
  }

  private assertSuperAdmin(user: AuthUser) {
    if (user.adminRole !== 'super_admin') {
      throw new ForbiddenException({
        code: 'SITE_CONTENT_SUPER_ADMIN_REQUIRED',
        message: 'Super admin access is required',
        messageKey: 'siteContent.error.superAdminRequired',
      });
    }
  }

  private assertEditableContentKey(contentKey: string) {
    if (RESERVED_NAVIGATION_CONTENT_KEYS.has(contentKey)) {
      throw this.badRequestError({
        code: 'SITE_CONTENT_RESERVED_NAVIGATION_KEY',
        message: 'Fixed navigation labels are not editable site content',
        messageKey: 'siteContent.error.reservedNavigationKey',
        details: {
          contentKey,
          editable: false,
          fixedNavigation: true,
        },
      });
    }
  }

  private assertPublishable(entry: SiteContentEntryRecord) {
    if (entry.status === 'archived') {
      throw this.badRequestError({
        code: 'SITE_CONTENT_ARCHIVED',
        message: 'Archived site content cannot be published',
        messageKey: 'siteContent.error.archived',
        details: { id: entry.id },
      });
    }
    this.assertHasPublishableContent(entry);
  }

  private assertHasPublishableContent(entry: SiteContentEntryRecord) {
    if (!this.hasPublishableContent(entry)) {
      throw this.badRequestError({
        code: 'SITE_CONTENT_EMPTY_CONTENT',
        message: 'Published site content must include non-empty content',
        messageKey: 'siteContent.error.emptyContent',
        details: { id: entry.id },
      });
    }
  }

  private hasPublishableContent(entry: SiteContentEntryRecord) {
    return Boolean(
      entry.title?.trim() ||
        entry.body?.trim() ||
        entry.ctaLabel?.trim() ||
        this.jsonHasText(entry.content),
    );
  }

  private jsonHasText(value: Prisma.JsonValue): boolean {
    if (typeof value === 'string') {
      return value.trim().length > 0;
    }
    if (Array.isArray(value)) {
      return value.some((item) => this.jsonHasText(item));
    }
    if (value && typeof value === 'object') {
      return Object.values(value).some((item) =>
        this.jsonHasText(item as Prisma.JsonValue),
      );
    }

    return false;
  }

  private presentPublicEntry(entry: SiteContentEntryRecord) {
    return {
      id: entry.id,
      contentKey: entry.contentKey,
      scope: entry.scope,
      pageKey: entry.pageKey,
      characterSlug: entry.characterSlug,
      modelSlug: entry.modelSlug,
      locale: entry.locale,
      title: entry.title,
      body: entry.body,
      ctaLabel: entry.ctaLabel,
      ctaHref: entry.ctaHref,
      content: entry.content,
      status: 'published',
      version: entry.version,
      publishedAt: entry.publishedAt?.toISOString() ?? null,
      updatedAt: entry.updatedAt.toISOString(),
    };
  }

  private presentAdminEntry(entry: SiteContentEntryRecord) {
    return {
      ...this.presentPublicEntry(entry),
      status: entry.status,
      createdByUserId: entry.createdByUserId,
      updatedByUserId: entry.updatedByUserId,
      publishedByUserId: entry.publishedByUserId,
      archivedByUserId: entry.archivedByUserId,
      archivedAt: entry.archivedAt?.toISOString() ?? null,
      createdAt: entry.createdAt.toISOString(),
      policy: {
        rawHtmlAllowed: false,
        navigationKeyEditable: false,
        publishRequiresContent: true,
        canEdit: entry.status !== 'archived',
        canPublish: entry.status !== 'archived',
        canArchive: entry.status !== 'archived',
        canRestore: entry.status === 'archived',
      },
    };
  }

  private presentAuditLog(log: SiteContentAuditLogRecord) {
    return {
      id: log.id,
      entryId: log.entryId,
      action: log.action,
      actorUserId: log.actorUserId,
      before: log.before,
      after: log.after,
      metadata: log.metadata,
      createdAt: log.createdAt.toISOString(),
      policy: {
        rawContentStored: false,
      },
    };
  }

  private auditSnapshot(entry: SiteContentEntryRecord) {
    return {
      contentKey: entry.contentKey,
      scope: entry.scope,
      pageKey: entry.pageKey,
      characterSlug: entry.characterSlug,
      modelSlug: entry.modelSlug,
      locale: entry.locale,
      status: entry.status,
      version: entry.version,
      titleLength: entry.title?.length ?? 0,
      bodyLength: entry.body?.length ?? 0,
      ctaLabelLength: entry.ctaLabel?.length ?? 0,
      ctaHrefKind: this.hrefKind(entry.ctaHref),
      contentKeys: this.contentKeys(entry.content),
      publishedAt: entry.publishedAt?.toISOString() ?? null,
      archivedAt: entry.archivedAt?.toISOString() ?? null,
    };
  }

  private auditDiff(
    beforeEntry: SiteContentEntryRecord,
    afterEntry: SiteContentEntryRecord,
  ) {
    const before = this.auditSnapshot(beforeEntry);
    const after = this.auditSnapshot(afterEntry);
    const changedFields = Object.keys(after).filter(
      (key) =>
        JSON.stringify(before[key as keyof typeof before]) !==
        JSON.stringify(after[key as keyof typeof after]),
    );

    return { changedFields };
  }

  private async recordAudit(
    tx: Prisma.TransactionClient,
    input: {
      entryId: string;
      action: string;
      actorUserId: string;
      before: JsonRecord;
      after: JsonRecord;
      metadata: JsonRecord;
    },
  ) {
    await tx.siteContentAuditLog.create({
      data: {
        entryId: input.entryId,
        action: input.action,
        actorUserId: input.actorUserId,
        before: input.before as Prisma.InputJsonValue,
        after: input.after as Prisma.InputJsonValue,
        metadata: input.metadata as Prisma.InputJsonValue,
      },
    });
  }

  private contentKeys(value: Prisma.JsonValue) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.keys(value).sort()
      : [];
  }

  private hrefKind(href?: string | null) {
    if (!href) {
      return 'none';
    }
    if (href.startsWith('#')) {
      return 'anchor';
    }
    if (href.startsWith('./') || href.startsWith('/')) {
      return 'internal';
    }

    return 'allowed_external';
  }

  private presentFilters(query: SiteContentQuery) {
    return {
      scope: query.scope ?? null,
      pageKey: query.pageKey ?? null,
      characterSlug: query.characterSlug ?? null,
      modelSlug: query.modelSlug ?? null,
    };
  }

  private adminPolicy() {
    return {
      superAdminOnly: true,
      rawHtmlAllowed: false,
      publicReadPublishedOnly: true,
      auditRawContentStored: false,
      auditRawPersonalDataStored: false,
      walletMutationAllowed: false,
      settlementMutationAllowed: false,
      fixedNavigationKeysEditable: false,
      commonAndCharacterCopySeparated: true,
      archivedKeyRecoverable: true,
      restoreTargetStatuses: [...VALID_RESTORE_TARGET_STATUSES],
    };
  }

  private contentObject(value: unknown) {
    if (value === undefined || value === null) {
      return {};
    }
    if (!this.isRecord(value)) {
      throw this.badRequestError({
        code: 'SITE_CONTENT_INVALID_CONTENT',
        message: 'content must be an object',
        messageKey: 'siteContent.error.invalidContent',
        details: { field: 'content' },
      });
    }
    this.assertSafeJsonValue(value, 'content');
    return value;
  }

  private assertSafeJsonValue(value: unknown, path: string) {
    if (typeof value === 'string') {
      this.assertSafeTextValue(value, path, MAX_CONTENT_STRING_LENGTH, true);
      return;
    }
    if (
      value === null ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        this.assertSafeJsonValue(item, `${path}.${index}`),
      );
      return;
    }
    if (this.isRecord(value)) {
      Object.entries(value).forEach(([key, item]) => {
        if (!SAFE_KEY_PATTERN.test(key) && !SAFE_SLUG_PATTERN.test(key)) {
          throw this.badRequestError({
            code: 'SITE_CONTENT_INVALID_CONTENT_KEY',
            message: 'content contains an unsafe key',
            messageKey: 'siteContent.error.invalidContentKey',
            details: { field: `${path}.${key}` },
          });
        }
        this.assertSafeJsonValue(item, `${path}.${key}`);
      });
      return;
    }

    throw this.badRequestError({
      code: 'SITE_CONTENT_INVALID_CONTENT',
      message: 'content contains an unsupported value',
      messageKey: 'siteContent.error.invalidContent',
      details: { field: path },
    });
  }

  private optionalSafeText(
    value: unknown,
    field: string,
    maxLength: number,
  ) {
    if (value === undefined || value === null) {
      return null;
    }

    return this.assertSafeTextValue(value, field, maxLength, false);
  }

  private assertSafeTextValue(
    value: unknown,
    field: string,
    maxLength: number,
    allowEmpty: boolean,
  ) {
    if (typeof value !== 'string') {
      throw this.badRequestError({
        code: 'SITE_CONTENT_INVALID_FIELD',
        message: `${field} must be a string`,
        messageKey: 'siteContent.error.invalidField',
        details: { field },
      });
    }
    const trimmed = value.trim();
    if (!allowEmpty && !trimmed) {
      throw this.badRequestError({
        code: 'SITE_CONTENT_EMPTY_FIELD',
        message: `${field} cannot be empty`,
        messageKey: 'siteContent.error.emptyField',
        details: { field },
      });
    }
    if (trimmed.length > maxLength) {
      throw this.badRequestError({
        code: 'SITE_CONTENT_FIELD_TOO_LONG',
        message: `${field} is too long`,
        messageKey: 'siteContent.error.fieldTooLong',
        details: { field, maxLength },
      });
    }
    if (SCRIPT_LIKE_PATTERN.test(trimmed) || HTML_LIKE_PATTERN.test(trimmed)) {
      throw this.badRequestError({
        code: 'SITE_CONTENT_UNSAFE_TEXT',
        message: `${field} cannot contain HTML or script`,
        messageKey: 'siteContent.error.unsafeText',
        details: { field },
      });
    }

    return trimmed;
  }

  private optionalCtaHref(value: unknown) {
    if (value === undefined || value === null) {
      return null;
    }
    const href = this.assertSafeTextValue(
      value,
      'ctaHref',
      MAX_CTA_HREF_LENGTH,
      false,
    );

    if (href.startsWith('//')) {
      throw this.invalidHrefError();
    }
    if (href.startsWith('/') || href.startsWith('./') || href.startsWith('#')) {
      return href;
    }
    try {
      const parsed = new URL(href);
      if (parsed.protocol === 'https:' && ALLOWED_CTA_HOSTS.has(parsed.hostname)) {
        return href;
      }
    } catch {
      throw this.invalidHrefError();
    }

    throw this.invalidHrefError();
  }

  private invalidHrefError() {
    return this.badRequestError({
      code: 'SITE_CONTENT_INVALID_CTA_HREF',
      message: 'ctaHref must be an internal URL or an allowed Lumina URL',
      messageKey: 'siteContent.error.invalidCtaHref',
      details: { field: 'ctaHref' },
    });
  }

  private scope(value: unknown) {
    const scope = this.safePatternString(value, 'scope', SAFE_SLUG_PATTERN, 80);
    if (!VALID_SCOPES.has(scope)) {
      throw this.badRequestError({
        code: 'SITE_CONTENT_INVALID_SCOPE',
        message: 'Invalid site content scope',
        messageKey: 'siteContent.error.invalidScope',
        details: { scope, allowed: [...VALID_SCOPES] },
      });
    }

    return scope;
  }

  private status(value: unknown, fallback?: string) {
    const raw = value === undefined || value === null ? fallback : value;
    const status = this.safePatternString(raw, 'status', SAFE_SLUG_PATTERN, 32);
    if (!VALID_STATUSES.has(status)) {
      throw this.badRequestError({
        code: 'SITE_CONTENT_INVALID_STATUS',
        message: 'Invalid site content status',
        messageKey: 'siteContent.error.invalidStatus',
        details: { status, allowed: [...VALID_STATUSES] },
      });
    }

    return status;
  }

  private restoreTargetStatus(value: unknown) {
    const status = this.status(value, 'draft');
    if (!VALID_RESTORE_TARGET_STATUSES.has(status)) {
      throw this.badRequestError({
        code: 'SITE_CONTENT_INVALID_RESTORE_STATUS',
        message: 'Restore status must be draft or published',
        messageKey: 'siteContent.error.invalidRestoreStatus',
        details: { status, allowed: [...VALID_RESTORE_TARGET_STATUSES] },
      });
    }

    return status;
  }

  private locale(value?: string) {
    const locale = (value ?? 'ko-KR').trim();
    if (!SAFE_LOCALE_PATTERN.test(locale)) {
      throw this.badRequestError({
        code: 'SITE_CONTENT_INVALID_LOCALE',
        message: 'Invalid locale',
        messageKey: 'siteContent.error.invalidLocale',
        details: { locale },
      });
    }

    return locale;
  }

  private optionalSlug(value: unknown, field: string) {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    return this.safePatternString(value, field, SAFE_SLUG_PATTERN, 80);
  }

  private safePatternString(
    value: unknown,
    field: string,
    pattern: RegExp,
    maxLength: number,
  ) {
    const text = this.assertSafeTextValue(value, field, maxLength, false);
    if (!pattern.test(text)) {
      throw this.badRequestError({
        code: 'SITE_CONTENT_INVALID_FIELD',
        message: `${field} is not a safe key`,
        messageKey: 'siteContent.error.invalidField',
        details: { field },
      });
    }

    return text;
  }

  private optionalString(value: unknown) {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  private take(raw: unknown, fallback: number, max: number) {
    const value = Number(raw ?? fallback);
    if (!Number.isInteger(value) || value < 1) {
      throw this.badRequestError({
        code: 'SITE_CONTENT_INVALID_TAKE',
        message: 'take must be a positive integer',
        messageKey: 'siteContent.error.invalidTake',
      });
    }

    return Math.min(value, max);
  }

  private assertUuid(value: string, field: string) {
    if (!UUID_PATTERN.test(value)) {
      throw this.badRequestError({
        code: 'SITE_CONTENT_INVALID_ID',
        message: `${field} must be a UUID`,
        messageKey: 'siteContent.error.invalidId',
        details: { field },
      });
    }
  }

  private badRequestError(input: {
    code: string;
    message: string;
    messageKey: string;
    details?: JsonRecord;
  }) {
    return new BadRequestException(input);
  }

  private notFoundError(id: string) {
    return new NotFoundException({
      code: 'SITE_CONTENT_NOT_FOUND',
      message: 'Site content entry not found',
      messageKey: 'siteContent.error.notFound',
      details: { id },
    });
  }

  private keyExistsError(
    contentKey: string,
    locale: string,
    existing?: SiteContentEntryRecord,
  ) {
    return this.badRequestError({
      code: 'SITE_CONTENT_KEY_EXISTS',
      message: 'Site content key already exists for this locale',
      messageKey: 'siteContent.error.keyExists',
      details: {
        contentKey,
        locale,
        existingEntryId: existing?.id,
        existingStatus: existing?.status,
        recoverable: existing?.status === 'archived',
        restorePathTemplate: existing
          ? '/api/v1/admin/api/v1/backstage/site-content/:id/restore'
          : undefined,
      },
    });
  }

  private hasOwn(input: SiteContentBody, key: string) {
    return Object.prototype.hasOwnProperty.call(input, key);
  }

  private isRecord(value: unknown): value is JsonRecord {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  private isUniqueConstraintError(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}

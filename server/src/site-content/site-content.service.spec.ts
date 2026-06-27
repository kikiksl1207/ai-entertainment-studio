import { PrismaService } from '../prisma/prisma.service';
import { SiteContentService } from './site-content.service';

type PrismaMock = {
  siteContentEntry: {
    findMany: jest.Mock;
    count: jest.Mock;
    findUnique: jest.Mock;
    findFirst: jest.Mock;
  };
  $transaction: jest.Mock;
};

const superAdmin = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'admin@example.test',
  adminRole: 'super_admin',
  adminPermissions: ['*'],
};

function entry(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-05-19T00:00:00.000Z');

  return {
    id: '00000000-0000-4000-8000-000000000101',
    contentKey: 'artists.hero.title',
    scope: 'page',
    pageKey: 'artists',
    characterSlug: null,
    modelSlug: null,
    locale: 'ko-KR',
    title: '?꾪떚?ㅽ듃 ?뚭컻',
    body: null,
    ctaLabel: null,
    ctaHref: null,
    content: {},
    status: 'published',
    version: 2,
    createdByUserId: superAdmin.id,
    updatedByUserId: superAdmin.id,
    publishedByUserId: superAdmin.id,
    archivedByUserId: null,
    publishedAt: now,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createService() {
  const prisma: PrismaMock = {
    siteContentEntry: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const service = new SiteContentService(prisma as unknown as PrismaService);

  return { service, prisma };
}

describe('SiteContentService', () => {
  it('returns only published content through public bootstrap', async () => {
    const { service, prisma } = createService();
    prisma.siteContentEntry.findMany.mockResolvedValue([entry()]);

    const result = await service.getBootstrap({
      locale: 'ko-KR',
      pageKey: 'artists',
    });

    expect(prisma.siteContentEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'published',
          locale: 'ko-KR',
          pageKey: 'artists',
        }),
      }),
    );
    expect(result.content['artists.hero.title']).toMatchObject({
      contentKey: 'artists.hero.title',
      status: 'published',
      title: '?꾪떚?ㅽ듃 ?뚭컻',
    });
    expect(result.policy).toMatchObject({
      publishedOnly: true,
      fallbackRequired: true,
      rawHtmlAllowed: false,
    });
  });

  it('requires super admin for management APIs', async () => {
    const { service } = createService();

    await expect(
      service.listAdmin(
        {
          ...superAdmin,
          adminRole: 'content_admin',
        },
        {},
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'SITE_CONTENT_SUPER_ADMIN_REQUIRED',
        messageKey: 'siteContent.error.superAdminRequired',
      },
    });
  });

  it('blocks unsafe text before creating draft content', async () => {
    const { service } = createService();

    await expect(
      service.createAdmin(superAdmin, {
        contentKey: 'artists.hero.title',
        scope: 'page',
        pageKey: 'artists',
        title: '<script>alert(1)</script>',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'SITE_CONTENT_UNSAFE_TEXT',
        messageKey: 'siteContent.error.unsafeText',
      },
    });
  });

  it('keeps fixed navigation labels outside editable site content', async () => {
    const { service, prisma } = createService();

    await expect(
      service.createAdmin(superAdmin, {
        contentKey: 'navigation.home.label',
        scope: 'global',
        title: 'Home',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'SITE_CONTENT_RESERVED_NAVIGATION_KEY',
        messageKey: 'siteContent.error.reservedNavigationKey',
        details: expect.objectContaining({
          contentKey: 'navigation.home.label',
          editable: false,
          fixedNavigation: true,
        }),
      },
    });
    expect(prisma.siteContentEntry.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('records audit metadata without raw body text on create', async () => {
    const { service, prisma } = createService();
    prisma.siteContentEntry.findFirst.mockResolvedValue(null);
    const tx = {
      siteContentEntry: {
        create: jest.fn().mockResolvedValue(
          entry({
            status: 'draft',
            version: 1,
            body: '?댁쁺?먭? ?섏젙?섎뒗 怨듦컻 ?덈궡臾몄엯?덈떎.',
            publishedAt: null,
            publishedByUserId: null,
          }),
        ),
      },
      siteContentAuditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    await service.createAdmin(superAdmin, {
      contentKey: 'artists.hero.body',
      scope: 'page',
      pageKey: 'artists',
      body: '?댁쁺?먭? ?섏젙?섎뒗 怨듦컻 ?덈궡臾몄엯?덈떎.',
    });

    expect(tx.siteContentAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'create',
          before: {},
          after: expect.not.objectContaining({
            body: '?댁쁺?먭? ?섏젙?섎뒗 怨듦컻 ?덈궡臾몄엯?덈떎.',
          }),
          metadata: expect.any(Object),
        }),
      }),
    );
  });

  it('separates common and character copy and keeps audit logs key-only', async () => {
    const { service, prisma } = createService();
    const tx = {
      siteContentEntry: {
        update: jest.fn().mockResolvedValue(
          entry({
            scope: 'character',
            pageKey: 'character-detail',
            characterSlug: 'seo-yuan',
            body: 'Updated character line with fan@example.test and token-secret',
            content: {
              public_line: 'Updated public line',
              password_hint: 'must-not-be-audit-body',
            },
            version: 3,
          }),
        ),
      },
      siteContentAuditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    prisma.siteContentEntry.findUnique.mockResolvedValue(
      entry({
        status: 'draft',
        scope: 'character',
        pageKey: 'character-detail',
        characterSlug: 'seo-yuan',
        body: 'Original character line',
        content: { public_line: 'Original public line' },
      }),
    );
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const result = await service.updateAdmin(superAdmin, entry().id, {
      body: 'Updated character line with fan@example.test and token-secret',
      content: {
        public_line: 'Updated public line',
        password_hint: 'must-not-be-audit-body',
      },
    });

    expect(result).toMatchObject({
      item: {
        scope: 'character',
        pageKey: 'character-detail',
        characterSlug: 'seo-yuan',
      },
      policy: expect.objectContaining({
        commonAndCharacterCopySeparated: true,
        auditRawPersonalDataStored: false,
        fixedNavigationKeysEditable: false,
        draftEditOnly: true,
      }),
    });
    const auditCall = tx.siteContentAuditLog.create.mock.calls[0][0];
    const serializedAudit = JSON.stringify(auditCall.data);

    expect(auditCall.data).toMatchObject({
      action: 'update',
      actorUserId: superAdmin.id,
      metadata: {
        changedFields: expect.arrayContaining(['bodyLength', 'contentKeys']),
      },
    });
    expect(serializedAudit).not.toContain('fan@example.test');
    expect(serializedAudit).not.toContain('token-secret');
    expect(serializedAudit).not.toContain('must-not-be-audit-body');
  });

  it('fails closed when editing published content before a draft is prepared', async () => {
    const { service, prisma } = createService();
    const published = entry({ status: 'published', version: 4 });
    prisma.siteContentEntry.findUnique.mockResolvedValue(published);

    await expect(
      service.updateAdmin(superAdmin, published.id, {
        body: 'Publish 전에는 live 문구가 바뀌면 안 됩니다.',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'SITE_CONTENT_PUBLISHED_EDIT_REQUIRES_DRAFT',
        messageKey: 'siteContent.error.publishedEditRequiresDraft',
        details: expect.objectContaining({
          currentStatus: 'published',
          currentVersion: 4,
        }),
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('updates draft content with a version increment and audit before publish', async () => {
    const { service, prisma } = createService();
    const draft = entry({
      status: 'draft',
      version: 4,
      publishedAt: null,
      publishedByUserId: null,
    });
    const updatedDraft = entry({
      status: 'draft',
      version: 5,
      body: '새 draft 문구',
      publishedAt: null,
      publishedByUserId: null,
    });
    const tx = {
      siteContentEntry: {
        update: jest.fn().mockResolvedValue(updatedDraft),
      },
      siteContentAuditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    prisma.siteContentEntry.findUnique.mockResolvedValue(draft);
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const result = await service.updateAdmin(superAdmin, draft.id, {
      body: '새 draft 문구',
    });

    expect(tx.siteContentEntry.update).toHaveBeenCalledWith({
      where: { id: draft.id },
      data: expect.objectContaining({
        body: '새 draft 문구',
        updatedByUserId: superAdmin.id,
        version: { increment: 1 },
      }),
    });
    expect(tx.siteContentAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'update',
          before: expect.objectContaining({ version: 4, status: 'draft' }),
          after: expect.objectContaining({ version: 5, status: 'draft' }),
          metadata: expect.objectContaining({
            changedFields: expect.arrayContaining(['version', 'bodyLength']),
          }),
        }),
      }),
    );
    expect(result).toMatchObject({
      item: {
        status: 'draft',
        version: 5,
        policy: expect.objectContaining({
          canEdit: true,
          canPublish: true,
          publishedEditRequiresDraft: true,
          draftVersionRequiredBeforePublish: true,
        }),
      },
      policy: expect.objectContaining({
        draftEditOnly: true,
        publishedEditRequiresDraft: true,
      }),
    });
  });

  it('returns a recoverable key-exists error when an archived key is recreated', async () => {
    const { service, prisma } = createService();
    prisma.siteContentEntry.findFirst.mockResolvedValue(
      entry({
        status: 'archived',
        archivedAt: new Date('2026-05-20T00:00:00.000Z'),
        archivedByUserId: superAdmin.id,
      }),
    );

    await expect(
      service.createAdmin(superAdmin, {
        contentKey: 'artists.hero.title',
        scope: 'page',
        pageKey: 'artists',
        title: 'Recoverable archived copy',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'SITE_CONTENT_KEY_EXISTS',
        messageKey: 'siteContent.error.keyExists',
        details: expect.objectContaining({
          contentKey: 'artists.hero.title',
          locale: 'ko-KR',
          existingStatus: 'archived',
          recoverable: true,
          restorePathTemplate:
            '/api/v1/admin/api/v1/backstage/site-content/:id/restore',
        }),
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('restores archived content to draft with audit and keeps public bootstrap published-only', async () => {
    const { service, prisma } = createService();
    const archived = entry({
      status: 'archived',
      archivedAt: new Date('2026-05-20T00:00:00.000Z'),
      archivedByUserId: superAdmin.id,
      publishedAt: new Date('2026-05-19T00:00:00.000Z'),
      publishedByUserId: superAdmin.id,
    });
    const restored = entry({
      status: 'draft',
      version: 3,
      archivedAt: null,
      archivedByUserId: null,
      publishedAt: null,
      publishedByUserId: null,
    });
    const tx = {
      siteContentEntry: {
        update: jest.fn().mockResolvedValue(restored),
      },
      siteContentAuditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    prisma.siteContentEntry.findUnique.mockResolvedValue(archived);
    prisma.siteContentEntry.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const result = await service.restoreAdmin(superAdmin, archived.id, {});

    expect(tx.siteContentEntry.update).toHaveBeenCalledWith({
      where: { id: archived.id },
      data: expect.objectContaining({
        status: 'draft',
        archivedAt: null,
        archivedByUserId: null,
        publishedAt: null,
        publishedByUserId: null,
        updatedByUserId: superAdmin.id,
        version: { increment: 1 },
      }),
    });
    expect(tx.siteContentAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'restore',
          metadata: expect.objectContaining({
            targetStatus: 'draft',
          }),
        }),
      }),
    );
    expect(result).toMatchObject({
      restored: true,
      targetStatus: 'draft',
      item: {
        status: 'draft',
        policy: expect.objectContaining({
          canRestore: false,
          canEdit: true,
          canPublish: true,
          publishedEditRequiresDraft: true,
          draftVersionRequiredBeforePublish: true,
        }),
      },
      policy: expect.objectContaining({
        archivedKeyRecoverable: true,
        draftEditOnly: true,
      }),
    });

    await service.getBootstrap({ locale: 'ko-KR', pageKey: 'artists' });
    expect(prisma.siteContentEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'published',
          locale: 'ko-KR',
          pageKey: 'artists',
        }),
      }),
    );
  });

  it('can restore archived content directly to published when content is present', async () => {
    const { service, prisma } = createService();
    const archived = entry({
      status: 'archived',
      archivedAt: new Date('2026-05-20T00:00:00.000Z'),
      archivedByUserId: superAdmin.id,
    });
    const tx = {
      siteContentEntry: {
        update: jest.fn().mockResolvedValue(
          entry({
            status: 'published',
            version: 3,
            archivedAt: null,
            archivedByUserId: null,
            publishedAt: new Date('2026-05-20T00:00:00.000Z'),
            publishedByUserId: superAdmin.id,
          }),
        ),
      },
      siteContentAuditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    prisma.siteContentEntry.findUnique.mockResolvedValue(archived);
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const result = await service.restoreAdmin(superAdmin, archived.id, {
      status: 'published',
    });

    expect(tx.siteContentEntry.update).toHaveBeenCalledWith({
      where: { id: archived.id },
      data: expect.objectContaining({
        status: 'published',
        archivedAt: null,
        archivedByUserId: null,
        publishedByUserId: superAdmin.id,
        updatedByUserId: superAdmin.id,
        version: { increment: 1 },
      }),
    });
    expect(result).toMatchObject({
      restored: true,
      targetStatus: 'published',
      item: { status: 'published' },
    });
  });

  it('keeps restore idempotent for non-archived content without audit mutation', async () => {
    const { service, prisma } = createService();
    const published = entry();
    prisma.siteContentEntry.findUnique.mockResolvedValue(published);

    const result = await service.restoreAdmin(superAdmin, published.id, {});

    expect(result).toMatchObject({
      alreadyRestored: true,
      restored: false,
      targetStatus: 'published',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

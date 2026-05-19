import { PrismaService } from '../prisma/prisma.service';
import { SiteContentService } from './site-content.service';

type PrismaMock = {
  siteContentEntry: {
    findMany: jest.Mock;
    count: jest.Mock;
    findUnique: jest.Mock;
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
    title: '아티스트 소개',
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
      title: '아티스트 소개',
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

  it('records audit metadata without raw body text on create', async () => {
    const { service, prisma } = createService();
    const tx = {
      siteContentEntry: {
        create: jest.fn().mockResolvedValue(
          entry({
            status: 'draft',
            version: 1,
            body: '운영자가 수정하는 공개 안내문입니다.',
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
      body: '운영자가 수정하는 공개 안내문입니다.',
    });

    expect(tx.siteContentAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'create',
          before: {},
          after: expect.not.objectContaining({
            body: '운영자가 수정하는 공개 안내문입니다.',
          }),
          metadata: expect.any(Object),
        }),
      }),
    );
  });
});

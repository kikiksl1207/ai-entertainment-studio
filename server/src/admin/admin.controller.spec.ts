import 'reflect-metadata';
import { ConflictException, RequestMethod } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ADMIN_PERMISSIONS_KEY } from '../auth/decorators/admin-permissions.decorator';
import { AdminController } from './admin.controller';
import { AdminUsersReadService } from './admin-users-read.service';

type ControllerRoute = {
  handlerName: string;
  method: RequestMethod;
  path: string;
  permissions: string[];
};

function mountedAdminControllerRoutes(): ControllerRoute[] {
  return Object.getOwnPropertyNames(AdminController.prototype)
    .filter((handlerName) => handlerName !== 'constructor')
    .flatMap((handlerName) => {
      const handler = AdminController.prototype[
        handlerName as keyof AdminController
      ] as unknown;

      if (typeof handler !== 'function') {
        return [];
      }

      const method = Reflect.getMetadata(METHOD_METADATA, handler) as
        | RequestMethod
        | undefined;
      const routePath = Reflect.getMetadata(PATH_METADATA, handler) as
        | string
        | string[]
        | undefined;

      if (method === undefined || routePath === undefined) {
        return [];
      }

      const paths = Array.isArray(routePath) ? routePath : [routePath];
      const permissions =
        (Reflect.getMetadata(ADMIN_PERMISSIONS_KEY, handler) as string[]) ?? [];

      return paths.map((path) => ({
        handlerName,
        method,
        path,
        permissions,
      }));
    });
}

describe('AdminController account overview', () => {
  it('routes users:read to the dedicated persisted-account read service', async () => {
    const users = { getBackstageUsersOverview: jest.fn().mockResolvedValue({ totalAccounts: 87 }) };
    const controller = new AdminController({} as ConstructorParameters<typeof AdminController>[0]);
    Object.assign(controller, { adminUsersReadService: users as unknown as AdminUsersReadService });
    const query = { take: '20', query: 'handle' };
    await expect(controller.getBackstageUsersOverview(query)).resolves.toEqual({ totalAccounts: 87 });
    expect(users.getBackstageUsersOverview).toHaveBeenCalledWith(query);
    expect(mountedAdminControllerRoutes()).toContainEqual({
      handlerName: 'getBackstageUsersOverview', method: RequestMethod.GET,
      path: 'backstage/operations/users-overview', permissions: ['users:read'],
    });
  });
});

describe('AdminController launch readiness response', () => {
  it('does not report ready while a category still has a blocker', async () => {
    const readiness = {
      overall: { score: 100, status: 'ready_candidate' },
      categories: [{ blockers: ['no_paid_payment_order_verified_yet'] }],
    };
    const service = { getBackstageLaunchReadiness: jest.fn().mockResolvedValue(readiness) };
    const controller = new AdminController(service as unknown as ConstructorParameters<typeof AdminController>[0]);

    await expect(controller.getBackstageLaunchReadiness()).resolves.toEqual({
      ...readiness,
      overall: { ...readiness.overall, status: 'score_ready_with_blockers' },
    });
    expect(readiness.overall.status).toBe('ready_candidate');
  });

  it('preserves ready status when no category is blocked', async () => {
    const readiness = {
      overall: { score: 100, status: 'ready_candidate' },
      categories: [{ blockers: [] }],
    };
    const service = { getBackstageLaunchReadiness: jest.fn().mockResolvedValue(readiness) };
    const controller = new AdminController(service as unknown as ConstructorParameters<typeof AdminController>[0]);

    await expect(controller.getBackstageLaunchReadiness()).resolves.toBe(readiness);
  });
});

describe('AdminController published story cover archive', () => {
  it('returns a conflict instead of exposing the database error', async () => {
    const failure = new Prisma.PrismaClientUnknownRequestError(
      'Published story cover cannot be archived', { clientVersion: 'test' });
    const service = { archiveAsset: jest.fn().mockRejectedValue(failure) };
    const controller = new AdminController(service as unknown as ConstructorParameters<typeof AdminController>[0]);

    await expect(controller.archiveAsset({ id: 'admin' } as never, 'asset-id', { force: true }))
      .rejects.toMatchObject({ response: { code: 'STORY_PUBLISHED_COVER_ARCHIVE_BLOCKED' } });
    expect(service.archiveAsset).toHaveBeenCalledWith({ id: 'admin' }, 'asset-id', { force: true });
  });

  it('does not mask unrelated archive failures', async () => {
    const failure = new Error('Storage unavailable');
    const service = { archiveAsset: jest.fn().mockRejectedValue(failure) };
    const controller = new AdminController(service as unknown as ConstructorParameters<typeof AdminController>[0]);

    await expect(controller.archiveAsset({ id: 'admin' } as never, 'asset-id', {}))
      .rejects.toBe(failure);
    expect(failure).not.toBeInstanceOf(ConflictException);
  });
});

describe('AdminController artist knowledge URL permissions', () => {
  it('keeps approval mutations behind artists:write and audit reads behind audit:read', () => {
    const routes = mountedAdminControllerRoutes();

    expect(routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: RequestMethod.GET,
          path: 'backstage/operations/artist-knowledge-urls',
          permissions: ['artists:read'],
        }),
        expect.objectContaining({
          method: RequestMethod.POST,
          path: 'backstage/operations/artist-knowledge-urls/:knowledgeUrlId/approve',
          permissions: ['artists:write'],
        }),
        expect.objectContaining({
          method: RequestMethod.POST,
          path: 'backstage/operations/artist-knowledge-urls/:knowledgeUrlId/reject',
          permissions: ['artists:write'],
        }),
        expect.objectContaining({
          method: RequestMethod.POST,
          path: 'backstage/operations/artist-knowledge-urls/:knowledgeUrlId/archive',
          permissions: ['artists:write'],
        }),
        expect.objectContaining({
          method: RequestMethod.GET,
          path: 'backstage/operations/artist-knowledge-url-audit-events',
          permissions: ['audit:read'],
        }),
      ]),
    );
  });
});

describe('AdminController wallet ledger audit permissions', () => {
  it('keeps wallet ledger audit read model behind payments:read', () => {
    expect(mountedAdminControllerRoutes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: RequestMethod.GET,
          path: 'backstage/operations/wallet-ledger-audit',
          permissions: ['payments:read'],
        }),
      ]),
    );
  });
});

describe('AdminController indexing readiness permissions', () => {
  it('mounts robots noindex readiness as a read-only backstage operations route', () => {
    expect(mountedAdminControllerRoutes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: RequestMethod.GET,
          path: 'backstage/operations/indexing-readiness',
          permissions: ['*'],
        }),
      ]),
    );
  });
});

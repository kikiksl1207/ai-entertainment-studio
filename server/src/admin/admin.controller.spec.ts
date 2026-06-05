import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ADMIN_PERMISSIONS_KEY } from '../auth/decorators/admin-permissions.decorator';
import { AdminController } from './admin.controller';

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

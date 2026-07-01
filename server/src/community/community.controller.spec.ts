import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CommunityController } from './community.controller';

type ControllerRoute = {
  handlerName: string;
  method: RequestMethod;
  path: string;
};

function mountedCommunityRoutes(): ControllerRoute[] {
  return Object.getOwnPropertyNames(CommunityController.prototype)
    .filter((handlerName) => handlerName !== 'constructor')
    .flatMap((handlerName) => {
      const handler = CommunityController.prototype[
        handlerName as keyof CommunityController
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

      return paths.map((path) => ({ handlerName, method, path }));
    });
}

describe('CommunityController public follow list routes', () => {
  it('mounts handle and UUID public following-artist read routes', () => {
    expect(mountedCommunityRoutes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: RequestMethod.GET,
          path: 'users/:userId/following-artists',
        }),
        expect.objectContaining({
          method: RequestMethod.GET,
          path: 'users/handle/:publicHandle/following-artists',
        }),
      ]),
    );
  });
});

describe('CommunityController user block routes', () => {
  it('keeps block and unblock mounted as normal authenticated user routes', () => {
    const blockHandlers = [
      'blockUser',
      'blockUserByHandle',
      'unblockUser',
      'unblockUserByHandle',
    ];

    for (const handlerName of blockHandlers) {
      const handler = CommunityController.prototype[
        handlerName as keyof CommunityController
      ] as unknown as object;
      const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];

      expect(guards).toContain(JwtAuthGuard);
      expect(guards.map((guard) => (guard as { name?: string }).name)).not.toEqual(
        expect.arrayContaining(['AdminAuthGuard', 'AdminPermissionGuard']),
      );
    }

    expect(mountedCommunityRoutes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: RequestMethod.POST,
          path: 'users/:userId/block',
        }),
        expect.objectContaining({
          method: RequestMethod.POST,
          path: 'users/handle/:publicHandle/block',
        }),
        expect.objectContaining({
          method: RequestMethod.DELETE,
          path: 'users/:userId/block',
        }),
        expect.objectContaining({
          method: RequestMethod.DELETE,
          path: 'users/handle/:publicHandle/block',
        }),
      ]),
    );
  });

  it('mounts handle block preview as a read-only optional-auth route', () => {
    const handler = CommunityController.prototype
      .getUserBlockPreviewByHandle as unknown as object;
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];

    expect(guards).toContain(OptionalJwtAuthGuard);
    expect(guards).not.toContain(JwtAuthGuard);
    expect(mountedCommunityRoutes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: RequestMethod.GET,
          path: 'users/handle/:publicHandle/block',
        }),
      ]),
    );
  });
});

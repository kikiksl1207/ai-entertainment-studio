import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
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

import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ChatController } from './chat.controller';

type ControllerRoute = {
  handlerName: string;
  method: RequestMethod;
  path: string;
};

function mountedChatControllerRoutes(): ControllerRoute[] {
  return Object.getOwnPropertyNames(ChatController.prototype)
    .filter((handlerName) => handlerName !== 'constructor')
    .flatMap((handlerName) => {
      const handler = ChatController.prototype[
        handlerName as keyof ChatController
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

describe('ChatController premium chat fail-closed routes', () => {
  it('does not mount premium chat room, donation, refund, or report write endpoints', () => {
    const routes = mountedChatControllerRoutes();
    const postPaths = routes
      .filter((route) => route.method === RequestMethod.POST)
      .map((route) => route.path);
    const premiumChatWritePaths = postPaths.filter((path) =>
      [
        'premium-room',
        'premium-rooms',
        'donation',
        'donations',
        'refund',
        'refunds',
        'report',
        'reports',
        'force-close',
        'operator-close',
      ].some((fragment) => path.includes(fragment)),
    );

    expect(premiumChatWritePaths).toEqual([]);
    expect(postPaths).not.toEqual(
      expect.arrayContaining([
        'chat/premium-rooms',
        'chat/sessions/:sessionId/donations/preview',
        'chat/sessions/:sessionId/donations',
        'chat/premium-rooms/:roomId/reports',
        'chat/me/premium-rooms/:roomId/refunds',
        'creator-studio/premium-chat/rooms/:roomId/force-close',
      ]),
    );
  });

  it('mounts only the read-only premium support contract surface', () => {
    const routes = mountedChatControllerRoutes();

    expect(routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: RequestMethod.GET,
          path: 'chat/premium-support-contract',
        }),
      ]),
    );
  });
});

import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PremiumChatRoomsReadController } from './premium-chat-rooms-read.controller';

type ControllerRoute = {
  handlerName: string;
  method: RequestMethod;
  path: string;
};

function mountedPremiumRoomReadRoutes(): ControllerRoute[] {
  return Object.getOwnPropertyNames(PremiumChatRoomsReadController.prototype)
    .filter((handlerName) => handlerName !== 'constructor')
    .flatMap((handlerName) => {
      const handler = PremiumChatRoomsReadController.prototype[
        handlerName as keyof PremiumChatRoomsReadController
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

describe('PremiumChatRoomsReadController', () => {
  it('mounts only read-only premium room endpoints', () => {
    const routes = mountedPremiumRoomReadRoutes();

    expect(routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: RequestMethod.GET,
          path: 'chat/premium-rooms',
        }),
        expect.objectContaining({
          method: RequestMethod.GET,
          path: 'chat/me/premium-rooms/:roomId/status',
        }),
        expect.objectContaining({
          method: RequestMethod.GET,
          path: 'creator-studio/premium-chat/rooms/:roomId/status',
        }),
      ]),
    );
    expect(routes.some((route) => route.method !== RequestMethod.GET)).toBe(false);
  });

  it('returns stable error metadata for invalid list take values', () => {
    const controller = new PremiumChatRoomsReadController({
      getPremiumRoomList: jest.fn(),
    } as never);

    try {
      controller.getPremiumRooms({ take: 'abc' });
      throw new Error('expected invalid take to throw');
    } catch (error) {
      expect(error).toMatchObject({
        response: {
          code: 'PREMIUM_CHAT_ROOM_TAKE_INVALID',
          messageKey: 'chat.premiumRoom.invalidTake',
        },
      });
    }
  });
});

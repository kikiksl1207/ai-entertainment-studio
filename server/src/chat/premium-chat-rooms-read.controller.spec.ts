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
          path: 'chat/premium-rooms/refund-status-preview-fixture',
        }),
        expect.objectContaining({
          method: RequestMethod.GET,
          path: 'chat/premium-rooms',
        }),
        expect.objectContaining({
          method: RequestMethod.GET,
          path: 'chat/me/premium-rooms',
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

  it('returns a public read-only refund status preview fixture without mutations', () => {
    const controller = new PremiumChatRoomsReadController({} as never);
    const response = controller.getPremiumRoomRefundStatusPreviewFixture();

    expect(response).toMatchObject({
      feature: 'premium_chat_refund_status_preview_fixture',
      status: 'read_only_fixture_ready',
      readOnly: true,
      authRequired: false,
      endpoint: {
        method: 'GET',
        path: '/api/v1/chat/premium-rooms/refund-status-preview-fixture',
        mounted: true,
      },
      noMutation: {
        messageMutation: false,
        supportDonationMutation: false,
        walletDebitMutation: false,
        walletCreditMutation: false,
        refundMutation: false,
        settlementMutation: false,
        payoutMutation: false,
      },
      privacy: {
        rawChatBodyReturned: false,
        rawReportReasonReturned: false,
        rawWalletLedgerIdReturned: false,
        providerRefundIdReturned: false,
        tokenCookieSecretDbUrlReturned: false,
      },
    });
    expect(response.items.map((item) => item.qaBucket)).toEqual([
      'unanswered_24h_refund_candidate',
      'refund_limited_70_artist_10',
      'refund_limited_50_artist_10',
      'artist_forced_close_full_refund',
    ]);
    expect(response.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          refundStatus: expect.objectContaining({
            refundRatePercent: 70,
            artistCompensationRatePercent: 10,
          }),
        }),
        expect.objectContaining({
          refundStatus: expect.objectContaining({
            refundRatePercent: 50,
            artistCompensationRatePercent: 10,
          }),
        }),
      ]),
    );
    expect(
      response.items.every((item) =>
        Object.values(item.noMutation).every((enabled) => enabled === false),
      ),
    ).toBe(true);
    expect(
      response.items.every(
        (item) =>
          item.copySafety.rawStatusAsCopy === false &&
          item.copySafety.rawEnumCopyReturned === false,
      ),
    ).toBe(true);
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

  it('delegates my premium room list as an authenticated read-only list', () => {
    const getMyPremiumRoomList = jest.fn();
    const controller = new PremiumChatRoomsReadController({
      getMyPremiumRoomList,
    } as never);

    controller.getMyPremiumRooms(
      { id: '00000000-0000-4000-8000-000000000001' } as never,
      { status: 'paused_by_report', take: '10' },
    );

    expect(getMyPremiumRoomList).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      {
        artistSlug: undefined,
        status: 'paused_by_report',
        take: 10,
        cursor: undefined,
      },
    );
  });
});

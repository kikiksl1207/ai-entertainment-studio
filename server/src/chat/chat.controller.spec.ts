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
        expect.objectContaining({
          method: RequestMethod.GET,
          path: 'chat/artist-url-knowledge-preview-fixture',
        }),
      ]),
    );
  });

  it('returns artist URL knowledge preview states without mutation affordances', () => {
    const controller = new ChatController({} as never);
    const response = controller.getArtistUrlKnowledgePreviewFixture();

    expect(response).toMatchObject({
      feature: 'artist_url_knowledge_preview_fixture',
      status: 'read_only_fixture_ready',
      readOnly: true,
      authRequired: false,
      endpoint: {
        method: 'GET',
        path: '/api/v1/chat/artist-url-knowledge-preview-fixture',
        mounted: true,
      },
      noMutation: {
        urlCrawl: false,
        providerTraining: false,
        providerCall: false,
        chatResponseGeneration: false,
        approvalMutation: false,
      },
      privacy: {
        rawUrlReturned: false,
        rawPageBodyReturned: false,
        tokenCookiePasswordReturned: false,
        providerPayloadReturned: false,
        dbUrlReturned: false,
      },
    });
    expect(response.items.map((item) => item.qaBucket)).toEqual([
      'pending_review',
      'approved_safe_chat_candidate',
      'rejected',
      'archived',
      'approved_chat_reference_disabled',
      'approved_bounded_summary_missing',
    ]);
    expect(
      response.items.find((item) => item.qaBucket === 'approved_safe_chat_candidate')
        ?.chatContextCandidate,
    ).toMatchObject({
      eligible: true,
      handoffReady: true,
      ineligibleReasonKeys: [],
    });
    expect(
      response.items
        .filter((item) => item.qaBucket !== 'approved_safe_chat_candidate')
        .every((item) => item.chatContextCandidate.eligible === false),
    ).toBe(true);
    expect(
      response.items.every((item) =>
        Object.values(item.noMutation).every((enabled) => enabled === false),
      ),
    ).toBe(true);
  });
});

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
          path: 'chat/artist-url-knowledge-preview-fixture',
        }),
        expect.objectContaining({
          method: RequestMethod.GET,
          path: 'chat/opening-greeting/session-preview-fixture',
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

  it('returns public artist URL knowledge preview states without mutations', () => {
    const controller = new PremiumChatRoomsReadController({} as never);
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

  it('returns a public opening greeting session preview fixture without mutations', () => {
    const controller = new PremiumChatRoomsReadController({} as never);
    const response = controller.getOpeningGreetingSessionPreviewFixture();
    const sameSessionReads = response.scenarios.sameSessionReplay.repeatedReads;
    const newSessionReads = response.scenarios.newSessionVariant.sessions;
    const boundaryReads =
      response.scenarios.differentCharacterBoundary.comparisons;

    expect(response).toMatchObject({
      feature: 'character_chat_opening_greeting_session_preview_fixture',
      status: 'read_only_fixture_ready',
      readOnly: true,
      authRequired: false,
      fixtureOnly: true,
      endpoint: {
        method: 'GET',
        path: '/api/v1/chat/opening-greeting/session-preview-fixture',
        mounted: true,
      },
      noMutation: {
        createSession: false,
        createMessage: false,
        providerCall: false,
        walletMutation: false,
        orderMutation: false,
        settlementMutation: false,
      },
      privacy: {
        rawSessionIdReturned: false,
        rawSeedReturned: false,
        rawPromptReturned: false,
        rawProviderPayloadReturned: false,
        tokenReturned: false,
        cookieReturned: false,
        passwordReturned: false,
        apiKeyReturned: false,
        dbUrlReturned: false,
      },
    });
    expect(sameSessionReads).toHaveLength(2);
    expect(sameSessionReads[0].sessionKey).toBe('fixture-session-a');
    expect(sameSessionReads[1].sessionKey).toBe('fixture-session-a');
    expect(sameSessionReads[0].openingGreeting.text).toBe(
      sameSessionReads[1].openingGreeting.text,
    );
    expect(sameSessionReads[0].openingGreeting.cache.hit).toBe(false);
    expect(sameSessionReads[1].openingGreeting.cache.hit).toBe(true);
    expect(newSessionReads.map((read) => read.sessionKey)).toEqual([
      'fixture-session-a',
      'fixture-session-b',
    ]);
    expect(newSessionReads[0].openingGreeting.text).not.toBe(
      newSessionReads[1].openingGreeting.text,
    );
    expect(boundaryReads.map((read) => read.characterSlug)).toEqual([
      'yoon-serin',
      'seo-yuan',
    ]);
    expect(boundaryReads[0].openingGreeting.text).not.toBe(
      boundaryReads[1].openingGreeting.text,
    );
    expect(
      boundaryReads.every(
        (read) =>
          read.openingGreeting.toneCandidate.characterSlug ===
          read.characterSlug,
      ),
    ).toBe(true);
    expect(
      boundaryReads.every(
        (read) =>
          read.openingGreeting.generation.variantPolicy.readModel
            .characterSlug === read.characterSlug,
      ),
    ).toBe(true);
    expect(
      boundaryReads.every(
        (read) =>
          read.openingGreeting.generation.variantPolicy.readModel
            .personaScope === 'character_slug_locked' &&
          read.openingGreeting.generation.variantPolicy.readModel
            .crossCharacterFallbackReuseAllowed === false &&
          read.openingGreeting.toneCandidate.personaScope ===
            'character_slug_locked' &&
          read.openingGreeting.toneCandidate.crossCharacterReuseAllowed ===
            false,
      ),
    ).toBe(true);
    expect(
      response.scenarios.differentCharacterBoundary,
    ).toMatchObject({
      expectedCharacterSlugsDifferent: true,
      expectedTextDifferent: true,
      characterToneMustRemainScoped: true,
      readModelCharacterSlugMustMatchReadCharacterSlug: true,
      personaScopeMustRemainCharacterLocked: true,
      fallbackCopySharedAcrossCharacters: false,
      providerCall: false,
    });
    expect(
      [...sameSessionReads, ...newSessionReads, ...boundaryReads].every(
        (read) => read.openingGreeting.generation.providerCall === false,
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

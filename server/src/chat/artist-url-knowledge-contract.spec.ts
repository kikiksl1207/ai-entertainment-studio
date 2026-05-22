import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

describe('artist URL knowledge chat reference contract', () => {
  function service() {
    return new ChatService({} as never, {} as never);
  }

  it('publishes the approved-only chat reference contract', () => {
    const contract = service().getArtistKnowledgeContract();

    expect(contract).toMatchObject({
      contractVersion: '2026-05-22.artist-knowledge-chat-reference.v1',
      storage: {
        table: 'artist_knowledge_sources',
        statuses: ['pending', 'approved', 'rejected', 'archived'],
        firstPassShape: expect.arrayContaining([
          'artistId',
          'sourceUrl',
          'artistDescription',
          'summary',
          'visibility',
          'status',
        ]),
      },
      endpoints: {
        contract: 'GET /api/v1/chat/artist-url-knowledge-contract',
        legacyContract: 'GET /api/v1/chat/artist-knowledge-contract',
        list: 'GET /api/v1/me/creator-studio/knowledge-urls?artistId=&status=',
        create: 'POST /api/v1/me/creator-studio/knowledge-urls',
        approve: 'POST /api/v1/me/creator-studio/knowledge-urls/:sourceId/approve',
        reject: 'POST /api/v1/me/creator-studio/knowledge-urls/:sourceId/reject',
        archive: 'POST /api/v1/me/creator-studio/knowledge-urls/:sourceId/archive',
      },
      chatReference: {
        acceptedStatuses: ['approved'],
        excludedStatuses: ['pending', 'rejected', 'archived'],
        requiredVisibility: ['chat_reference', 'public'],
        maxSnippetsPerGeneration: 3,
        providerRuntimeFields: ['domain', 'platform', 'title', 'summary'],
        fullUrlInjected: false,
        rawSourceInjected: false,
        promptInjectionTreatment: 'facts_only_never_instruction',
      },
      crawling: {
        automaticCrawling: false,
        externalAccountRequired: false,
        socialPasswordRequired: false,
        apiKeyOrTokenRequired: false,
      },
      mutations: {
        wallet: false,
        lumina: false,
        order: false,
        settlement: false,
        payout: false,
      },
    });
  });

  it('keeps the URL-named route as the public contract alias', () => {
    const chatService = {
      getArtistKnowledgeContract: jest.fn().mockReturnValue({
        contractVersion: '2026-05-22.artist-knowledge-chat-reference.v1',
      }),
    } as unknown as ChatService;
    const controller = new ChatController(chatService);

    expect(controller.getArtistUrlKnowledgeContract()).toEqual({
      contractVersion: '2026-05-22.artist-knowledge-chat-reference.v1',
    });
    expect(chatService.getArtistKnowledgeContract).toHaveBeenCalledTimes(1);
  });
});

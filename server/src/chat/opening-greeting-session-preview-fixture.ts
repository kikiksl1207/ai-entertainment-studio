const PREVIEW_ENDPOINT =
  '/api/v1/chat/opening-greeting/session-preview-fixture';

const noMutationPolicy = {
  createSession: false,
  createMessage: false,
  providerCall: false,
  messageSendMutation: false,
  walletMutation: false,
  orderMutation: false,
  settlementMutation: false,
  payoutMutation: false,
} as const;

const privacyPolicy = {
  rawSessionIdReturned: false,
  rawSeedReturned: false,
  rawPromptReturned: false,
  rawProviderPayloadReturned: false,
  tokenReturned: false,
  cookieReturned: false,
  passwordReturned: false,
  apiKeyReturned: false,
  dbUrlReturned: false,
  userPrivateDataReturned: false,
} as const;

function openingGreeting(
  text: string,
  options: {
    cacheHit: boolean;
    characterSlug: string;
    variantKey: string;
  },
) {
  return {
    text,
    cache: {
      scope: 'chat_session',
      hit: options.cacheHit,
    },
    generation: {
      providerCall: false,
      source: 'fallback_fixture',
      variantPolicy: {
        sameSessionStable: true,
        sameCharacterSameUserNewSessionCanVary: true,
        clientSeedAccepted: false,
        rawSeedReturned: false,
        conversationRecord: 'fixture_only_no_db_record',
      },
    },
    toneCandidate: {
      characterSlug: options.characterSlug,
      guideKo: 'Character-scoped tone guide fixture',
      toneTags: ['warm', 'character_scoped'],
      personaTags: [options.variantKey],
      displaySafe: true,
      rawPersonaPromptStored: false,
    },
    safety: {
      rawPromptStored: false,
      rawProviderPayloadStored: false,
    },
  } as const;
}

export function buildOpeningGreetingSessionPreviewFixture() {
  return {
    version:
      '2026-06-22.character-chat-opening-greeting-session-preview-fixture.v1',
    feature: 'character_chat_opening_greeting_session_preview_fixture',
    status: 'read_only_fixture_ready',
    readOnly: true,
    authRequired: false,
    fixtureOnly: true,
    endpoint: {
      method: 'GET',
      path: PREVIEW_ENDPOINT,
      mounted: true,
    },
    scenarios: {
      sameSessionReplay: {
        labelKey: 'characterChat.openingGreeting.preview.sameSessionReplay',
        repeatedReads: [
          {
            characterSlug: 'yoon-serin',
            sessionKey: 'fixture-session-a',
            readIndex: 1,
            openingGreeting: openingGreeting(
              'Serin starts this fixture session with the same quiet greeting.',
              {
                cacheHit: false,
                characterSlug: 'yoon-serin',
                variantKey: 'fixture-session-a',
              },
            ),
          },
          {
            characterSlug: 'yoon-serin',
            sessionKey: 'fixture-session-a',
            readIndex: 2,
            openingGreeting: openingGreeting(
              'Serin starts this fixture session with the same quiet greeting.',
              {
                cacheHit: true,
                characterSlug: 'yoon-serin',
                variantKey: 'fixture-session-a',
              },
            ),
          },
        ],
        expectedTextStable: true,
        createsNewGreeting: false,
        providerCall: false,
      },
      newSessionVariant: {
        labelKey: 'characterChat.openingGreeting.preview.newSessionVariant',
        sessions: [
          {
            characterSlug: 'yoon-serin',
            sessionKey: 'fixture-session-a',
            openingGreeting: openingGreeting(
              'Serin starts this fixture session with the same quiet greeting.',
              {
                cacheHit: false,
                characterSlug: 'yoon-serin',
                variantKey: 'fixture-session-a',
              },
            ),
          },
          {
            characterSlug: 'yoon-serin',
            sessionKey: 'fixture-session-b',
            openingGreeting: openingGreeting(
              'Serin opens the next fixture session with a brighter greeting.',
              {
                cacheHit: false,
                characterSlug: 'yoon-serin',
                variantKey: 'fixture-session-b',
              },
            ),
          },
        ],
        sameCharacter: true,
        sameUser: true,
        mayVaryBySessionSeed: true,
        clientSeedAccepted: false,
        rawSeedReturned: false,
        providerCall: false,
      },
    },
    noMutation: noMutationPolicy,
    privacy: privacyPolicy,
  } as const;
}

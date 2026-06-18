# Character Chat Dynamic Greeting Cache Contract

Updated: 2026-06-05
Owner: Luffy
Task: Notion #388, #397 regression contract, #402 tone candidate contract, #454
greeting/recommended-reply diversity contract, #468 random tone selection contract,
#618 opening greeting variant contract, workboard #1028 runtime handoff contract

This contract makes the first character-chat greeting dynamic per chat session
without generating a new greeting on every page refresh. It keeps raw prompts,
provider payloads, tokens, API keys, user private data, wallet/order/settlement,
and payout details out of public responses and documentation.

## Runtime Shape

`POST /api/v1/chat/sessions` still creates an authenticated chat session. The
response now includes an additive `openingGreeting` projection:

```json
{
  "id": "<chat session id>",
  "artist": { "id": "<artist id>", "slug": "<artist slug>", "displayName": "<name>" },
  "openingGreeting": {
    "id": "<chat message id>",
    "text": "<short display-safe greeting>",
    "messageType": "opening_greeting",
    "cache": {
      "scope": "chat_session",
      "key": "opening_greeting",
      "hit": false,
      "reloadCreatesNewGreeting": false
    },
    "generation": {
      "contractVersion": "2026-06-05.character-chat-opening-greeting-variants.v1",
      "providerCall": true,
      "maxOutputChars": 180,
      "maxOutputTokens": 120
    },
    "toneCandidate": {
      "contractVersion": "2026-05-21.character-chat-greeting-tone.v1",
      "characterSlug": "<artist slug>",
      "guideKo": "<display-safe tone guide>",
      "guideSource": "site_content|artist_metadata|character_fallback|default",
      "toneTags": ["<display-safe tone tag>"],
      "personaTags": ["<display-safe persona tag>"],
      "displaySafe": true,
      "rawPersonaPromptStored": false
    }
  }
}
```

The greeting is stored as a `chat_messages` row with:

- `senderType=artist`
- `messageType=opening_greeting`
- `chatSessionId=<session id>`

`GET /api/v1/chat/sessions/:sessionId/messages` checks for that row before
returning the message list. If the row already exists, it returns the cached
message and does not call the provider.

Concurrent requests for the same session must serialize before provider
generation. The backend locks the `chat_sessions` row inside the greeting
transaction, checks again for an existing `opening_greeting`, and only then
generates provider or fallback text. This keeps refresh races from creating two
provider requests or two opening-greeting rows for one session.

## Generation Policy

- Cache scope: one greeting per `chat_sessions.id`.
- Same session reload: return cached `opening_greeting`.
- Same character, different sessions: wording can vary through provider output
  or deterministic fallback variant seed from the session id.
- Fallback keeps a bounded 5 to 10 candidate pool. Sparse character data still
  receives at least five display-safe template variants before session-based
  selection, while richer persona/starter/tone data can supply character-specific
  candidates up to the ten-candidate cap.
- Fallback variation uses a deterministic session variant index, not a fresh
  random draw on every render. Candidate inputs are character-specific:
  `runtimePersona.welcome.text`, `runtimePersona.starterOptions[].message`,
  `runtimePersona.tone.guideKo`, and `runtimePersona.personaTags[]`.
- Same session stability is required: once `opening_greeting` is stored, later
  reads return the cached row even if the page is refreshed.
- Recommended reply candidates stay read-only and zero-cost. They are exposed
  through `openingPrompt.options[]`, `starterOptions[]`, and
  `sets[].options[]`; selecting one only pre-fills/sends user text through the
  normal chat flow and does not create a provider request by itself.
- The `openingGreeting.toneCandidate` projection snapshots the public
  character tone guide/tags used for the session. It is display-safe contract
  data, not a raw prompt or provider payload.
- Provider output is limited to a short greeting:
  `maxOutputTokens=120`, `maxOutputChars=180`.
- Provider generation is attempted only when the provider is ready and the
  existing daily provider guard has remaining request/failure capacity.
- If provider readiness, guard, or request fails, the backend stores a
  character-specific fallback greeting.
- Fallback uses the same character runtime persona source order:
  site-content copy, artist metadata, character fallback, then default copy.
- Provider generation remains optional. Refreshes and cached reads do not call
  the provider; provider attempts are separated from cache/template fallback and
  remain under the daily provider guard.

## Runtime Handoff Skeleton (#1028)

`dynamicGreetingContract.runtimeHandoff` is an API skeleton for frontend and QA
handoff. It does not add provider calls or message writes by itself.

- Session create surface: `POST /api/v1/chat/sessions`.
- Message replay surface: `GET /api/v1/chat/sessions/:sessionId/messages`.
- Response field: `openingGreeting`.
- Same-session replay first checks
  `chat_messages.messageType=opening_greeting` in the same `chat_session` and
  returns the cached row without a new greeting or provider call.
- New sessions use `chat_sessions.id` as the server-derived seed. Client seeds
  are not accepted, raw seeds are not returned, and the same character/user can
  receive a different display-safe first greeting in a new session.
- Fallback selection is deterministic per session and uses the same source order:
  site-content, artist metadata, character fallback, then default copy.
- Cost controls stay explicit: provider readiness, daily provider guard,
  `maxOutputTokens=120`, `maxOutputChars=180`, and zero-cost fallback.
- The skeleton does not add message-send mutation, wallet/order/settlement/payout
  mutation, raw prompt storage, provider payload return, token return, API key
  return, or user-private-data return.

## Safety

The opening greeting metadata records only safe operational facts:

- contract version
- purpose `opening_greeting`
- cache scope
- provider/model/usage only when a provider response was actually used
- fallback reason when fallback was used

It does not store or return:

- raw prompt
- provider payload
- token
- API key
- user private data
- raw provider secret
- wallet/order/settlement/payout ids

Forbidden-tone and minor-clean standards remain part of the display contract:
first greetings must stay inside the character boundary, avoid real-person
contact/relationship/payment prompts, and expose only display-safe tone/persona
candidate fields.

## Frontend Notes

- Prefer `openingGreeting.text` from `POST /chat/sessions` when present.
- When loading messages, render the `opening_greeting` message as the first
  artist-side greeting if it appears in the message list.
- Do not request a new greeting on refresh. Reloading the same session should
  use `GET /chat/sessions/:sessionId/messages` and the cached row.
- Treat `openingPrompt.options[]`, `starterOptions[]`, and `sets[].options[]`
  as the first-screen recommended replies. They are character-specific copy,
  not raw enum values, and should show Korean `label`/`message` only.
- `dynamicGreetingContract.fallback` exposes the display-safe selection
  contract: `candidateInputs`, `selectionStrategy =
  deterministic_session_variant_index`, `sessionVariantSeed =
  chat_sessions.id`, and `sameSessionStable = true`.
- Do not display raw source/metadata enum values as user copy.
- #968 conversation record contract: first-greeting variant selection is recorded
  with the created `opening_greeting` message in `chat_messages`, scoped to the
  `chat_session`. The response exposes only safe policy metadata under
  `openingGreeting.generation.variantPolicy.conversationRecord`: record table,
  message type, scope, same-conversation replay behavior, and raw seed/prompt/
  provider-payload exclusion flags. The raw session seed, raw prompt, provider
  payload, wallet, settlement, payout, and order fields must not be returned.

## Test Baseline

The backend test fixes:

- provider-generated opening greeting is stored once as `opening_greeting`
- cached message reads do not call the provider
- provider-unavailable fallback still returns character-specific text
- provider-unavailable fallback is checked across at least three character
  fixtures and ten sessions per character, so same-character greetings cannot
  silently regress to one fixed sentence
- `dynamicGreetingContract.fallback` exposes the candidate inputs and stable
  deterministic session selection strategy, including the 5 to 10 bounded
  candidate policy
- the opening greeting response and stored metadata carry character-specific
  display-safe tone/persona candidate fields
- exhausted daily provider guard stores a zero-cost fallback and skips provider
  generation
- concurrent same-session requests produce one stored opening greeting and one
  provider attempt
- provider request errors store a fallback greeting instead of throwing
- same character can produce different fallback greetings for different session
  ids
- opening greeting variant metadata records the conversation-level persistence
  contract without returning raw seeds, prompts, provider payloads, wallet,
  settlement, payout, or order fields
- raw prompt/provider payload/user private data flags remain false

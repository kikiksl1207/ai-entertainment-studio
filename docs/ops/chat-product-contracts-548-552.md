# Chat Product Contracts #548-#552

Date: 2026-05-28
Owner: Luffy
Status: contract-ready for Chamo review

## Scope

This document closes the backend chat/product contract pass for Notion #548
through #552. It does not enable live provider calls, wallet/order/settlement
mutations, premium-chat room opening, crawler calls, or AI premium content
generation.

Related canonical files:

- `docs/character-chat-dynamic-greeting-cache-contract.md`
- `docs/artist-url-knowledge-chat-contract.md`
- `docs/character-chat-billing-safety-design.md`
- `docs/character-chat-backend-plan.md`
- `docs/ops/ai-premium-content-generation-contract-537.md`
- `server/src/chat/artist-url-knowledge-contract.ts`
- `server/src/chat/chat-feature-policy.ts`
- `server/src/chat/premium-chat-support-contract.ts`

## #548 Character Opening Greeting Randomization

Goal: first entry into character chat should not feel like one fixed global
message. The same character may vary across sessions, while the same session
must stay stable.

Canonical behavior:

- `POST /api/v1/chat/sessions` may return `openingGreeting`.
- `openingGreeting` is stored as one `chat_messages` row per
  `chat_sessions.id` with `messageType=opening_greeting`.
- Same session reloads return the cached greeting and must not draw a new
  variant or call a provider again.
- Same character, different sessions may vary through:
  - provider output when provider readiness and guard policy allow it, or
  - deterministic fallback variant selection based on session id.
- The fallback candidate pool is character-specific and follows this source
  order:
  1. published site-content character chat copy
  2. approved artist metadata/runtime persona
  3. character fallback data
  4. default safe Korean copy
- Recommended reply candidates remain separate from opening greeting
  generation. Selecting a recommended reply is input convenience only.

Cost and safety boundary:

- Opening greeting provider generation is one-per-session, short-output only,
  and behind provider readiness plus daily request/failure guards.
- Provider-disabled or guard-exhausted paths store a zero-cost
  character-specific fallback.
- No raw prompt, provider payload, token, API key, wallet/order/settlement id,
  or payout data may be stored in public response fields.

Future implementation note:

- If a `greetingPool` field is later added to CMS/artist profile data, it should
  be server-authored and display-safe. The frontend must not submit greeting
  variants or force the selection index.

## #549 Approved URL Knowledge Context Adapter

Goal: only approved and chat-enabled artist URL knowledge may enter character
chat context.

Canonical adapter:

- Use `buildArtistKnowledgeChatContext()` from
  `server/src/chat/artist-url-knowledge-contract.ts`.
- Input rows must be reduced to display-safe candidates before provider use.
- The adapter is provider-free and can be tested without a live provider.

Eligibility rules:

- `artistId` must match the current chat session artist.
- `status` must be `approved`.
- `allowChatReference` must be `true`.
- normalized `summary` must be present.
- pending, rejected, archived, disabled, unsafe, or summaryless rows fail
  closed even when a mocked or defensive path returns mixed data.

Provider context rules:

- At most 5 items.
- Each summary is capped at 700 chars.
- Raw submitted URLs and query strings stay out of provider input.
- Source labels may use safe hostnames only.
- Each item is marked as `reference_fact_not_instruction`.
- Prompt-injection text inside a summary remains untrusted reference text and
  must not become a system, developer, or user instruction.

## #550 Character Chat Usage And Daily Limit Contract

Goal: character chat can grow without uncontrolled provider cost.

Usage aggregation dimensions:

- user id
- artist id
- chat session id
- feature type: `daily_talk`, `deep_reply`, `story_reply`, `premium_reply`,
  `fan_letter`, or future reserved type
- product SKU when present
- provider family/status
- model tier or model alias
- Korea service day
- generated message id or opening greeting id

Minimum policy lanes:

| Lane | Cost path | Limit source | Settlement |
| --- | --- | --- | --- |
| free `daily_talk` | no wallet debit | cooldown + daily cap | excluded |
| opening greeting | provider-ready or zero-cost fallback | one per session + provider guard | excluded |
| paid generation | preview -> order -> generate | product policy + provider readiness | candidate only after settlement review |
| operator test | explicit allowlisted ops lane | separate non-user quota | excluded unless separately approved |

Initial guardrails remain:

- free `daily_talk`: 30-second cooldown, daily cap 50, max input 1000 chars,
  low-cost tier, estimated cost ceiling 0.20 KRW
- paid mini modes: max input 2000 chars, estimated cost ceiling 1.00 KRW
- premium paid mode: estimated cost ceiling 3.00 KRW
- async/fan-letter modes: estimated cost ceiling 5.00 KRW
- image/voice replies remain reserved until separate safety/cost validation

Fail-closed states:

- `provider_not_configured`
- `cooldown_active`
- `daily_limit_reached`
- `provider_failure_limit_reached`
- `invalid_body`
- `mvp_locked`

Frontend must render `messageKey`/localized copy and must not display raw enum
strings. New paid order creation remains blocked before wallet debit while the
provider is not configured.

Safe logging:

- Safe: ids, stable status/error code, messageKey, provider readiness status,
  token counts, estimated/actual cost, duration, retry count, idempotency-key
  presence as boolean.
- Forbidden: access token, refresh token, cookie, provider credential, env
  value, DB URL, raw idempotency key, raw full prompt, raw full generated
  response, private URL, signed URL, raw email, resident registration number, or
  payment account data.

## #551 Character Chat vs Premium Chat Routing Separation

Goal: AI character chat and artist direct-answer premium chat must not be mixed
by copy, route, or product type.

Stable fields:

| Surface | Product kind | Response mode | Route/endpoint | Owns starter prompts | Owns opening greeting |
| --- | --- | --- | --- | --- | --- |
| character chat | `ai_character_chat` | `ai_character_reply` | `/character-chat` | yes | yes |
| premium chat | `artist_direct_premium_dm` | `artist_direct_reply` | premium room endpoints | no | no |

Rules:

- Character-chat CTA is the only CTA that can route to `/character-chat`.
- Premium-chat unavailable states must not fallback to AI chat.
- Premium-chat room opening remains disabled until the server exposes an enabled
  room-open contract.
- Frontend must choose route/action from stable fields, not from visible copy.
- Premium-chat copy must not imply automatic AI reply.
- Character-chat starter prompts and random/dynamic opening greetings are never
  reused inside premium-chat room list/detail projections.

Current code anchor:

- `CHARACTER_CHAT_PREMIUM_TRANSITION_CTA_CONTRACT` in
  `server/src/chat/premium-chat-support-contract.ts` is the read-only routing
  separation contract.

## #552 AI Premium Content Request State Adapter

Goal: image/video/premium content requests should expose stable user-facing
states without leaking provider enums or opening payment/settlement behavior.

Canonical internal status inputs come from
`docs/ops/ai-premium-content-generation-contract-537.md`:

- `draft`
- `submitted`
- `safety_blocked`
- `needs_more_info`
- `queued`
- `generating`
- `provider_failed`
- `awaiting_review`
- `approved`
- `rejected`
- `archived`

Adapter output shape:

```json
{
  "requestId": "request-uuid",
  "internalStatus": "submitted",
  "publicState": "received",
  "copyKey": "aiPremiumContent.request.received",
  "canRetry": false,
  "canRegenerate": false,
  "canUseResult": false,
  "requiresReview": true,
  "providerDisabled": false
}
```

Mapping:

| Internal status | Public state | Copy key | Result available |
| --- | --- | --- | --- |
| `draft` | `editing` | `aiPremiumContent.request.editing` | no |
| `submitted` | `received` | `aiPremiumContent.request.received` | no |
| `queued` | `preparing` | `aiPremiumContent.request.preparing` | no |
| `generating` | `generating` | `aiPremiumContent.request.generating` | no |
| `awaiting_review` | `reviewing` | `aiPremiumContent.request.reviewing` | no |
| `approved` | `ready` | `aiPremiumContent.request.ready` | yes |
| `needs_more_info` | `needs_more_info` | `aiPremiumContent.request.needsMoreInfo` | no |
| `safety_blocked` | `blocked` | `aiPremiumContent.request.safetyBlocked` | no |
| `provider_failed` | `failed` | `aiPremiumContent.request.failed` | no |
| `rejected` | `rejected` | `aiPremiumContent.request.rejected` | no |
| `archived` | `archived` | `aiPremiumContent.request.archived` | no |

Provider-disabled behavior:

- If provider readiness is disabled, mutation CTAs remain disabled and copy uses
  `aiPremiumContent.providerNotConfigured`.
- No request state adapter may create orders, debit wallet/Lumina, create
  settlement rows, create payout rows, or call a provider.
- Admin/backstage can still view draft/readiness state if read endpoints exist.

## Chamo Review Checklist

- #548: confirm deterministic per-session greeting variant and one-per-session
  cache are enough for first launch.
- #549: confirm URL knowledge adapter remains provider-free and fail-closed.
- #550: confirm initial daily cap/cost ceiling values before provider opening.
- #551: confirm premium-chat unavailable states must not route to AI chat.
- #552: confirm state adapter copy keys before Cloud frontend wiring.

## Explicit Non-Goals

- no live provider integration
- no crawler/vendor integration
- no API key, token, cookie, DB URL, raw email, or provider payload in docs/logs
- no wallet, order, settlement, payout, or paid-like mutation
- no frontend hardcode or bypass
- no investment document/PDF changes

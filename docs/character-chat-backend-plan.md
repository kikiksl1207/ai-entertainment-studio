# Character Chat Backend Plan

Updated: 2026-05-11

This document fixes the backend direction for Notion tasks #094-#096.
It covers character chat products, fan letters, settlement eligibility, and
frontend handoff rules. It does not connect a live LLM provider yet.

Related safety design: `docs/character-chat-billing-safety-design.md`.

## Product Modes

`1L = 10 KRW`.

| Code | Product SKU | User label | Price | Settlement | MVP state |
| --- | --- | --- | ---: | --- | --- |
| `daily_talk` | none | 데일리톡 | 0L | excluded | free basic chat |
| `deep_reply` | `CHAT_DEEP_REPLY` | 딥리플 | 2L | eligible | active seed |
| `story_reply` | `CHAT_STORY_REPLY` | 스토리 리플 | 5L | eligible | active seed |
| `premium_reply` | `CHAT_PREMIUM_REPLY` | 프리미엄 리플 | 10L | eligible | active seed |
| `fan_letter` | `CHAT_FANLETTER_30` | 스페셜 팬레터 30 | 30L | eligible | active seed |
| `fan_letter` | `CHAT_FANLETTER_50` | 스페셜 팬레터 50 | 50L | eligible | active seed |
| `fan_letter` | `CHAT_FANLETTER_100` | 스페셜 팬레터 100 | 100L | eligible | active seed |
| `image_reply` | `CHAT_IMAGE_REPLY` | 이미지 답장 | 20L+ | eligible | draft, later |
| `voice_reply` | `CHAT_VOICE_REPLY` | 음성 답장 | 20L+ | eligible | draft, later |

The seed archives the old `CHAT_SPECIAL_REPLY` product and replaces it with
fan-letter tiers. `CHAT_IMAGE_REPLY` and `CHAT_VOICE_REPLY` stay draft because
model cost and safety rules need separate validation.

Canonical #203 policy skeleton:

| SKU | Feature type | Korean fallback label | Price | Order flow | Model tier | Creator share |
| --- | --- | --- | ---: | --- | --- | --- |
| none | `daily_talk` | 데일리 톡 | 0L | free basic chat | nano | excluded |
| `CHAT_DEEP_REPLY` | `deep_reply` | 딥 리플 | 2L | paid generation preview -> order -> generate | mini | eligible |
| `CHAT_STORY_REPLY` | `story_reply` | 스토리 리플 | 5L | paid generation preview -> order -> generate | mini | eligible |
| `CHAT_PREMIUM_REPLY` | `premium_reply` | 프리미엄 리플 | 10L | paid generation preview -> order -> generate | premium | eligible |
| `CHAT_FANLETTER_30` | `fan_letter` | 스페셜 팬레터 30 | 30L | async reviewed fan-letter response | async_special | eligible |
| `CHAT_FANLETTER_50` | `fan_letter` | 스페셜 팬레터 50 | 50L | async reviewed fan-letter response | async_special | eligible |
| `CHAT_FANLETTER_100` | `fan_letter` | 스페셜 팬레터 100 | 100L | async reviewed fan-letter response | async_special | eligible |
| `CHAT_IMAGE_REPLY` | `image_reply` | 이미지 답장 | 20L | draft reserved | image_later | not yet eligible |
| `CHAT_VOICE_REPLY` | `voice_reply` | 음성 답장 | 20L | draft reserved | voice_later | not yet eligible |

The runtime policy lives in `server/src/chat/chat-feature-policy.ts`. Seed data
uses that policy to keep product labels, price, draft/active status,
`creatorShareEligible`, `settlementSource`, `providerRequired`, `orderFlow`,
`generationMode`, and cost-ceiling metadata in one place. This is a skeleton
contract only: it does not connect a real provider, API key, PG adapter, or
settlement payout run.

## Existing Backend Fit

Existing tables already cover the MVP paid-chat path:

- `chat_feature_products`
- `chat_feature_orders`
- `chat_messages`
- `wallet_ledger`

The current feature-order path debits the wallet and writes a completed
`chat_feature_orders` row. Future LLM generation must not spend again; it should
attach generated output to the completed order.

## Required Next API Contracts

Current implemented:

```http
GET /api/v1/chat-feature-products
POST /api/v1/chat/sessions
GET /api/v1/chat/sessions
GET /api/v1/chat/conversations?box=recent|archive|all&take=20&cursor=<nextCursor>
GET /api/v1/chat/starter-prompts?artistSlug=<artistSlug>
GET /api/v1/chat/persona-seed-policy
GET /api/v1/chat/character-catalog?artistSlug=<artistSlug>
GET /api/v1/chat/sessions/:sessionId/messages
POST /api/v1/chat/sessions/:sessionId/messages
POST /api/v1/chat-feature-orders/preview
POST /api/v1/chat-feature-orders
```

Starter prompts are a first-session UX helper for new users. They return up to
two suggested opening messages plus a direct-input option and do not debit Lumina.
Artist-specific copy can be supplied through
`artist.publicProfile.publicMetadata.chatStarterPromptSets`; otherwise the API
uses safe default Korean copy based on the artist display name.

#270 adds the read-only DM conversation list/archive contract:

```http
GET /api/v1/chat/conversations?box=recent|archive|all&take=20&cursor=<nextCursor>
```

This endpoint filters by the signed-in user id and returns session rows with
artist/persona summary, last message preview, last activity time, pagination, and
empty-state copy. It does not create `chat_messages`, call the LLM provider,
create feature orders, debit wallet, or create settlement events. `box=recent`
maps to active sessions, `box=archive` maps to archived sessions, and archive
mutation remains closed. Read receipts are not implemented yet, so unread fields
return `supported=false` and `unreadCount=null`.

#276 adds a read-only populated conversation-list QA verifier:

```bash
npm run qa:chat-conversation-list
```

The verifier is for an approved local/staging disposable owner account that
already has populated `chat_sessions` rows. It expects at least one active
session with messages and, for archive coverage, at least one archived session
with messages. It performs DB reads plus authenticated
`GET /api/v1/chat/conversations` calls for `recent`, `archive`, and `all`.
It does not seed data, create chat messages, call LLM, create feature orders,
debit wallet/Lumina, touch settlement, or print raw token/cookie/password/DB
URL/raw email/owner UUID/raw message body. If populated rows do not exist, the
QA state is `BLOCKED` until the environment owner approves a safe disposable
seeded state.

#225 adds a read-only persona seed contract endpoint:

```http
GET /api/v1/chat/persona-seed-policy
```

The endpoint returns no secrets, performs no LLM call, and writes no wallet or
chat data. It confirms that the current Prisma schema is enough for MVP persona
seed storage: `chat_personas.system_prompt`, `chat_personas.safety_rules`,
`chat_personas.model_config`, and optional
`artist_public_profiles.public_metadata.chatPersonaSeed`. It includes more than
20 Korean personality tags, conflict rules such as `introverted` versus
`very_extroverted`, creator-editable fields, operator-locked fields, random
assignment policy, and at least two seed examples.

#226 adds the read-only character chat catalog endpoint:

```http
GET /api/v1/chat/character-catalog?artistSlug=<artistSlug>
GET /api/v1/chat/character-catalog?artistId=<artistId>
```

Response shape:

```json
{
  "artist": {
    "id": "<artist uuid>",
    "slug": "yoon-serin",
    "displayName": "윤세린"
  },
  "status": {
    "key": "chat_ready",
    "labelKo": "대화 준비됨",
    "descriptionKo": "아직 실제 생성 요청 전이며, 인사말과 선택지만 미리 보여줍니다."
  },
  "greeting": {
    "text": "윤세린 캐릭터와 처음 대화를 시작해요. 가볍게 안부를 묻거나, 오늘의 기분을 전해보세요.",
    "source": "default"
  },
  "starterOptions": [
    {
      "key": "A",
      "label": "오늘 기분 묻기",
      "message": "윤세린, 오늘은 어떤 하루를 보내고 있어?"
    },
    {
      "key": "B",
      "label": "가볍게 응원하기",
      "message": "윤세린, 오늘도 조용히 응원하고 있어."
    },
    {
      "key": "C",
      "label": "직접 입력하기",
      "message": "",
      "directInput": true
    }
  ],
  "policy": {
    "gallery": {
      "mode": "conversation_archive",
      "labelKo": "대화 중 얻은 이미지 보관함",
      "externalPublicGalleryLink": false,
      "requestMutationEnabled": false
    },
    "shortVideoRequest": {
      "visibleInMvp": false,
      "enabled": false,
      "disabledMessageKo": "짧은 영상 요청은 1차 오픈 이후 준비돼요.",
      "requestMutationEnabled": false
    },
    "safety": {
      "readOnly": true,
      "llmCall": false,
      "walletMutation": false,
      "imageRequestMutation": false,
      "videoRequestMutation": false
    }
  }
}
```

Frontend must render Korean labels/copy and never expose machine keys such as
`chat_ready`, `conversation_archive`, or `mvp_not_open` as user-facing text.
Gallery means a conversation-earned image archive, not a public gallery link.
Short video request remains hidden or disabled for first launch.

Implemented readiness contracts before real LLM generation:

```http
POST /api/v1/chat/sessions/:sessionId/generate
```

Existing global endpoints remain the canonical order flow:

```http
POST /api/v1/chat-feature-orders/preview
POST /api/v1/chat-feature-orders
```

Until a real provider adapter is implemented, `preview` returns
`policy.generation.canGenerate = false` and `POST /chat-feature-orders` fails
closed with `CHAT_LLM_PROVIDER_NOT_CONFIGURED` before a wallet debit for LLM
generation products. `generate` also fails closed with the same code.

Preview response draft:

```json
{
  "product": {
    "id": "<product uuid>",
    "sku": "CHAT_STORY_REPLY",
    "featureType": "story_reply",
    "name": "Story Reply",
    "displayName": "스토리 리플",
    "priceLumina": "5"
  },
  "wallet": {
    "balanceLumina": "300",
    "afterBalanceLumina": "295"
  },
  "policy": {
    "settlementEligible": true,
    "requiresIdentityVerification": false,
    "idempotencyRequired": true,
    "refundOnGenerationFailure": true
  }
}
```

#203 adds an additive policy payload so the frontend can avoid guessing product
state or showing raw enum values:

```json
{
  "product": {
    "displayName": "스토리 리플",
    "description": "캐릭터 세계관과 상황을 반영한 긴 응답입니다.",
    "modelTier": "mini"
  },
  "policy": {
    "product": {
      "orderFlow": "paid_generation",
      "generationMode": "inline_reply",
      "providerRequired": true,
      "requiresPreview": true,
      "mvpLocked": false,
      "settlementEligible": true,
      "creatorShareEligible": true,
      "settlementSource": "chat",
      "estimatedCostCeilingKrw": "1.00"
    },
    "generation": {
      "canGenerate": false,
      "canCreatePaidOrder": false,
      "disabledReason": "provider_not_configured",
      "disabledMessageKey": "chat.generation.providerNotConfigured",
      "disabledDisplayMessageKo": "응답 생성 준비 중입니다."
    },
    "settlement": {
      "eligible": true,
      "creatorShareEligible": true,
      "source": "chat",
      "eventType": "chat",
      "finalPayoutRequiresSettlementRun": true
    }
  }
}
```

Frontend should use `displayName`, `description`, `disabledMessageKey`, or
`disabledDisplayMessageKo` for copy. It must not show raw values such as
`deep_reply`, `provider_not_configured`, or `async_reviewed_fan_letter` directly
to users.

Generation response draft:

```json
{
  "generationStatus": "completed",
  "order": {
    "id": "<order uuid>",
    "status": "completed",
    "featureType": "story_reply"
  },
  "message": {
    "id": "<message uuid>",
    "senderType": "artist_ai",
    "messageType": "text",
    "body": "..."
  },
  "usage": {
    "model": "gpt-4.1-mini",
    "inputTokens": 1200,
    "outputTokens": 500,
    "estimatedCostKrw": "2.10"
  }
}
```

Provider-not-configured response:

```json
{
  "success": false,
  "error": {
    "code": "CHAT_LLM_PROVIDER_NOT_CONFIGURED",
    "messageKey": "chat.generation.providerNotConfigured",
    "statusCode": 503,
    "details": {
      "generationStatus": "provider_not_configured",
      "provider": {
        "name": "not_configured",
        "configured": false,
        "status": "provider_not_configured"
      },
      "policy": {
        "generation": {
          "canGenerate": false,
          "canCreatePaidOrder": false,
          "usageMetadataPath": "chat_messages.model_metadata",
          "safetyMetadataPath": "chat_messages.safety_metadata"
        }
      }
    }
  }
}
```

Generation request draft:

```json
{
  "body": "user message",
  "chatFeatureOrderId": "<optional paid order uuid>"
}
```

If `chatFeatureOrderId` is omitted, the request is treated as basic
`daily_talk`. Basic chat remains free, settlement-excluded, and subject to a
30-second cooldown, daily cap, and low model tier before any live provider is
enabled.

## LLM Adapter Boundary

Current code introduces a `ChatLlmProvider` interface and a fail-closed
`ChatLlmProviderAdapter`. The adapter does not call OpenAI or any other
provider yet and does not read or expose secrets in responses. Future provider
implementations should return:

- generated text body
- provider and model name
- input/output token counts
- estimated KRW cost
- safety metadata

Successful generated assistant messages store usage and model cost metadata in
`chat_messages.model_metadata` and safety details in
`chat_messages.safety_metadata`.

Cost guardrails before enabling a real provider:

- Free `daily_talk`: nano/lowest-cost tier, 30-second cooldown, daily cap 50,
  input max 1000 chars, estimated per-message ceiling 0.20 KRW.
- Paid mini modes: input max 2000 chars, estimated cost ceiling 1.00 KRW.
- Premium paid mode: estimated cost ceiling 3.00 KRW.
- Async special/fan-letter style mode: estimated cost ceiling 5.00 KRW.
- Image and voice replies stay draft until separate cost and safety validation.

## Failure And Wallet Rules

- Idempotency is required for every paid action.
- Wallet debit and order creation must remain in one DB transaction.
- If LLM generation fails after a debit, mark the order `failed` and create a
  compensating wallet ledger, or keep the order in a recoverable status before
  final completion.
- The current readiness implementation blocks new paid chat feature orders while
  the provider is not configured, so no new wallet debit happens in that state.
- If an old completed paid order reaches `generate` and generation fails, the
  service marks the order `failed` and restores Lumina with a `refund` ledger
  using idempotency key `chat-feature-refund:<orderId>`.
- User-facing copy should say the answer was not generated and Lumina was not
  charged or will be restored.
- Do not promise refunds for preference mismatch. Only technical failure,
  duplicate debit, policy-blocked generation, or admin-approved cases should be
  reversible.

## Settlement Hooks

For settlement implementation, each completed paid action should create a
`creator_revenue_event` linked to:

- `chat_feature_orders.id`
- `wallet_ledger.id`
- `artist_id`
- creator / artist owner user id

Free `daily_talk` is never settlement eligible.

Promotional Lumina spent on paid products remains settlement eligible for the
creator and becomes internal marketing cost for Lumina Stage.

## Role Split

Chamo:

- product codes, wallet debit, idempotency, settlement event hooks
- model usage/cost metadata
- preview and generation API contracts

Cloud:

- mode tabs/buttons
- debit confirmation modal
- balance shortage and charge-station CTA
- loading/failure/regenerate states

Emily:

- mode names and short labels
- debit confirmation copy
- failure and regeneration copy
- character-specific tone variants


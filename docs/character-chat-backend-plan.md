# Character Chat Backend Plan

Updated: 2026-05-03

This document fixes the backend direction for Notion tasks #094-#096.
It covers character chat products, fan letters, settlement eligibility, and
frontend handoff rules. It does not connect a live LLM provider yet.

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
GET /api/v1/chat/starter-prompts?artistSlug=<artistSlug>
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

Recommended next contracts before real LLM generation:

```http
POST /api/v1/chat/sessions/:sessionId/feature-orders/preview
POST /api/v1/chat/sessions/:sessionId/generate
POST /api/v1/chat/feature-orders/:orderId/mark-failed
```

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

Generation response draft:

```json
{
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

## Failure And Wallet Rules

- Idempotency is required for every paid action.
- Wallet debit and order creation must remain in one DB transaction.
- If LLM generation fails after a debit, mark the order `failed` and create a
  compensating wallet ledger, or keep the order in a recoverable status before
  final completion.
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


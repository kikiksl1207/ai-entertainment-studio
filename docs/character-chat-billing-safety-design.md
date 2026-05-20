# Character Chat Billing And Safety Design

Updated: 2026-05-12
Owner: 루피
Task: Notion #212

This document is the backend pre-implementation checklist for opening character
chat generation safely. It does not enable a live LLM provider, paid order
creation, wallet debit, or settlement payout.

## Scope

In scope:

- Basic chat free-use limits.
- Starter prompt to message/generation preflight.
- Provider-not-configured fail-closed response contract.
- Wallet pre-check and debit timing.
- Idempotency requirements.
- Paid mode settlement eligibility metadata.
- Abuse controls for signup/free-token farming.
- Safe logging rules.
- Frontend disabled reason and fallback copy contract.

Out of scope:

- Real OpenAI or other LLM provider integration.
- API keys, provider secrets, signed URLs, cookies, or tokens.
- Real PG adapter changes.
- NICE identity provider activation.
- Creator payout finalization.
- Image or voice reply launch.

## Backend Implementation Checklist

Before opening any generation path:

1. Keep `ChatLlmProviderAdapter.readiness().configured=false` until a real
   provider task explicitly enables it.
2. Confirm every user-facing product uses `displayName`, `description`,
   `disabledMessageKey`, or `disabledDisplayMessageKo`, never raw enums.
3. Add a basic-chat preflight that runs before generation and returns policy
   state without wallet mutation.
4. Enforce `daily_talk` cooldown and daily count on the server, not in frontend
   only.
5. Require owned active chat session for every message, preflight, preview,
   order, and generation call.
6. Keep starter prompt selection free. Selecting A/B/C must not create a paid
   order or wallet ledger.
7. Require order preview before every paid chat feature order.
8. Require idempotency for every wallet-affecting mutation.
9. Debit wallet and create `chat_feature_orders` in one DB transaction.
10. Block paid generation order creation before debit while provider is not
    configured.
11. Attach generated assistant messages to the completed order through
    `chat_messages.chat_feature_order_id`; do not charge again during
    generation.
12. On generation failure after an existing completed paid order, mark the order
    failed and write one compensating refund ledger using
    `chat-feature-refund:<orderId>`.
13. Store provider/model/token/cost metadata only in
    `chat_messages.model_metadata` and safety state in
    `chat_messages.safety_metadata`.
14. Keep free `daily_talk` settlement excluded.
15. Keep image and voice replies draft/reserved until separate cost and safety
    validation exists.

## Product Safety Matrix

| Mode | Price | Provider required | Wallet debit | Settlement | Open state |
| --- | ---: | --- | --- | --- | --- |
| `daily_talk` | 0L | yes, for generated response | no | excluded | preflight only until provider ready |
| `deep_reply` | 2L | yes | preview -> order debit -> generate | creator-share candidate | disabled while provider missing |
| `story_reply` | 5L | yes | preview -> order debit -> generate | creator-share candidate | disabled while provider missing |
| `premium_reply` | 10L | yes | preview -> order debit -> generate | creator-share candidate | disabled while provider missing |
| `fan_letter` 30/50/100 | 30L/50L/100L | yes | preview -> order debit -> async reviewed response | creator-share candidate | disabled while provider missing |
| `premium_chat_donation` | TBD | yes | preview -> donation debit -> reviewed chat response | creator-share candidate | reserved; must use `premium_chat_donation` ledger/source |
| `image_reply` | draft | yes | no public debit | not open | closed |
| `voice_reply` | draft | yes | no public debit | not open | closed |

Creator-share candidate means backend may later create settlement events after
fees, tax, refunds, holds, abuse review, and admin confirmation. It is not a
final payout promise.

## API Contract Draft

### Basic Chat Preflight

```http
POST /api/v1/chat/sessions/:sessionId/preflight
Authorization: Bearer <accessToken>
```

Request:

```json
{
  "mode": "daily_talk",
  "body": "user message or selected starter prompt message"
}
```

Response while provider is missing:

```json
{
  "canSend": false,
  "canGenerate": false,
  "mode": "daily_talk",
  "limits": {
    "cooldownSeconds": 30,
    "dailyLimit": 50,
    "maxInputChars": 1000,
    "estimatedCostCeilingKrw": "0.20"
  },
  "provider": {
    "configured": false,
    "status": "provider_not_configured"
  },
  "disabledReason": "provider_not_configured",
  "messageKey": "chat.generation.providerNotConfigured",
  "fallbackCopyKo": "응답 생성 준비 중입니다.",
  "walletMutation": false,
  "settlementEligible": false
}
```

Server rules:

- Validate body length before calling provider.
- Check cooldown and daily count before provider call.
- Return `AUTH_REQUIRED` for logged-out users.
- Return stable `messageKey` for cooldown, daily limit, invalid body, inactive
  session, and provider missing.

### Starter Prompt Flow

Existing:

```http
GET /api/v1/chat/starter-prompts?artistSlug=<artistSlug>
```

Rules:

- Selecting a starter prompt is a frontend state change only.
- The selected prompt message must enter the same preflight path as typed input.
- Starter prompt selection must not create `chat_messages` by itself.
- Starter prompt selection must not create `chat_feature_orders` or
  `wallet_ledger` rows.

### Paid Feature Preview

Existing:

```http
POST /api/v1/chat-feature-orders/preview
Authorization: Bearer <accessToken>
```

Response must include:

```json
{
  "product": {
    "displayName": "스토리 리플",
    "priceLumina": "5",
    "modelTier": "mini"
  },
  "wallet": {
    "balanceLumina": "300",
    "afterBalanceLumina": "295",
    "sufficientBalance": true
  },
  "policy": {
    "idempotencyRequired": true,
    "product": {
      "requiresPreview": true,
      "providerRequired": true,
      "orderFlow": "paid_generation",
      "generationMode": "inline_reply",
      "creatorShareEligible": true,
      "settlementSource": "chat"
    },
    "generation": {
      "canGenerate": false,
      "canCreatePaidOrder": false,
      "disabledReason": "provider_not_configured",
      "disabledMessageKey": "chat.generation.providerNotConfigured",
      "disabledDisplayMessageKo": "응답 생성 준비 중입니다."
    }
  }
}
```

### Paid Feature Order

Existing:

```http
POST /api/v1/chat-feature-orders
Authorization: Bearer <accessToken>
Idempotency-Key: <client-generated-key>
```

Server rules:

- Reject missing idempotency key before wallet lookup.
- Replaying the same idempotency key must return the existing order.
- Reusing the same idempotency key for a different request must fail after a
  request fingerprint is introduced.
- While provider is not configured, generation products must return
  `CHAT_LLM_PROVIDER_NOT_CONFIGURED` before wallet debit.
- When provider is configured later, debit wallet and create order in the same
  transaction with non-negative balance enforcement.

### Generate

Existing:

```http
POST /api/v1/chat/sessions/:sessionId/generate
Authorization: Bearer <accessToken>
```

Free request:

```json
{
  "body": "message"
}
```

Paid request:

```json
{
  "body": "message",
  "chatFeatureOrderId": "<completed order uuid>"
}
```

Server rules:

- Omitted `chatFeatureOrderId` means `daily_talk` and must remain free.
- Present `chatFeatureOrderId` must belong to the user and session and be
  `completed`.
- If the order already has an `artist_ai` message, return the existing generated
  message instead of calling provider again.
- On provider failure for a paid order, mark order `failed` and write one refund
  ledger. Do not double-refund.

## Closed Mutations Until Separate Approval

Do not open these mutations in the first backend safety phase:

- Public mutation to grant free chat tokens.
- Public mutation to bypass cooldown or daily caps.
- Public mutation to manually mark provider ready.
- Public mutation to create paid generation orders while provider is missing.
- Public mutation to create fan-letter async responses.
- Public mutation to create image or voice reply orders.
- Public mutation to create creator revenue events directly from frontend.
- Public mutation to adjust wallet balance for chat outside the order
  transaction.
- Public mutation to force settlement eligibility or creator-share flags.
- Any endpoint that accepts client-supplied provider/model/cost/token counts.

## Idempotency Requirements

Required immediately:

- `POST /chat-feature-orders`: client idempotency key.
- `POST /fan-letters`: client idempotency key.
- Wallet refund after failed generation: server idempotency key
  `chat-feature-refund:<orderId>`.

Required before public paid launch:

- Request fingerprint on paid order idempotency keys.
- One completed generated message per paid order.
- Unique or guarded refund ledger per failed paid order.
- Future async fan-letter response creation idempotency key.

Recommended request fingerprint fields:

- user id
- chat session id
- artist id
- chat feature product id
- price Lumina snapshot
- request body hash, if body is part of the order step
- idempotency key

Do not store raw message text inside an idempotency fingerprint if a stable hash
is enough.

## Rate Limit And Abuse Controls

Basic chat minimum guardrails:

- 30-second cooldown per user and artist/session.
- 50 generated messages per Korea service day.
- 1,000 character input limit.
- Low-cost `nano` model tier only.
- Generated message cost ceiling `0.20 KRW` per message.

Paid chat minimum guardrails:

- Preview required before debit.
- Active wallet required.
- Server-side non-negative balance update.
- Trust/identity gate before settlement-generating paid support opens publicly.
- Velocity review for repeated paid support on one artist from fresh accounts.

Signup/free-token farming controls:

- New or unverified accounts may browse, follow, and select starter prompts.
- New or unverified accounts may not create unlimited provider calls.
- Referral, birthday, achievement, and other free Lumina grants remain under the
  3,000L free promo cap.
- Promotional Lumina spend that creates settlement liability may enter risk hold
  or delayed settlement review.
- Same IP/device/account-group bursts should create risk events, not direct
  user-facing raw errors.

## Wallet Debit And Recovery Policy

Debit timing:

1. Preview reads wallet and policy only. No mutation.
2. Order creation validates provider readiness for generation products.
3. Order creation validates wallet balance.
4. Wallet debit, wallet ledger, and `chat_feature_orders` row are written in one
   transaction.
5. Generation attaches output to the completed order. It must not debit again.

Recovery:

- If provider is missing before debit, return fail-closed response and do not
  create wallet ledger.
- If provider fails after a completed historical paid order, set order `failed`
  and credit a refund ledger once.
- Refund user-facing copy should say the answer was not generated and Lumina was
  restored or was not charged.
- Do not promise refunds for preference mismatch. Refund only technical failure,
  duplicate debit, policy-blocked generation, or admin-approved cases.

## Creator Share Metadata

Required metadata on product policy:

- `settlementEligible`
- `creatorShareEligible`
- `settlementSource`: `chat`, `fan_letter`, or null
- `orderFlow`
- `generationMode`
- `mvpLocked`
- `providerRequired`

Settlement source mapping:

| Product | settlementSource | creatorShareEligible |
| --- | --- | --- |
| free `daily_talk` | null | false |
| `deep_reply` | `chat` | true |
| `story_reply` | `chat` | true |
| `premium_reply` | `chat` | true |
| `fan_letter` | `fan_letter` | true |
| draft image/voice reply | null | false until separate approval |

Settlement event creation remains a later backend task. The frontend should show
only backend-provided estimate data, never raw gross Lumina as payout.

## Logging Rules

Safe to log:

- request id
- user id
- session id
- artist id
- product id or SKU
- order id
- status code
- stable error code and messageKey
- provider readiness status
- token counts and estimated cost after provider returns them
- idempotency key presence as boolean

Never log:

- access tokens
- refresh tokens
- cookies
- provider API keys
- env values
- signed URLs
- raw idempotency key values
- raw full prompt body or full generated response in general logs
- resident registration numbers or raw identity provider payloads
- full payment account numbers

For debugging text quality, store only sampled, redacted, access-controlled
records in an explicit moderation/audit workflow, not normal application logs.

## Frontend Disabled Copy Contract

Frontend should prefer:

1. `disabledMessageKey`
2. `disabledDisplayMessageKo`
3. neutral fallback Korean copy

Stable initial keys:

| Reason | messageKey | Korean fallback |
| --- | --- | --- |
| `provider_not_configured` | `chat.generation.providerNotConfigured` | 응답 생성 준비 중입니다. |
| `cooldown_active` | `chat.generation.cooldownActive` | 잠시 후 다시 말을 걸어주세요. |
| `daily_limit_reached` | `chat.generation.dailyLimitReached` | 오늘의 무료 대화 한도에 도달했어요. |
| `insufficient_balance` | `wallet.error.insufficientBalance` | 루미나 잔액이 부족해요. |
| `identity_verification_required` | `identity.error.verificationRequired` | 본인확인 후 이용할 수 있어요. |
| `mvp_locked` | `chat.generation.mvpLocked` | 아직 준비 중인 상품입니다. |

Do not expose raw enum strings such as `provider_not_configured`,
`async_reviewed_fan_letter`, `deep_reply`, or `daily_talk` as visible copy.

## Open Phases

Phase 0, current:

- Keep provider fail-closed.
- Keep paid order creation blocked while provider is missing.
- Keep starter prompt selection free.
- Keep fan-letter async response generation closed.
- Use this document as implementation checklist.

Phase 1, backend safety:

- Add basic chat preflight endpoint.
- Add cooldown/daily limit storage and enforcement.
- Add paid order idempotency request fingerprint.
- Add stable messageKey coverage for cooldown/limit/trust/wallet errors.
- Add focused tests for preflight, order fail-closed, idempotency, and refund.

Phase 2, provider dry-run:

- Add provider adapter behind environment readiness.
- Keep public generation disabled until QA approves.
- Run non-production smoke with safe test artist and no secrets in logs.
- Verify token/cost metadata persistence.

Phase 3, limited public opening:

- Open free `daily_talk` for verified low-risk scope first.
- Keep paid generation disabled until wallet/refund QA passes.
- Add abuse/risk monitoring dashboard or admin report.

Phase 4, paid modes:

- Open `deep_reply`, then `story_reply`, then `premium_reply`.
- Keep fan-letter async reviewed response separate.
- Add creator revenue event creation only after settlement review signs off.

## Suggested Task Split

For Chamo:

- Confirm rate limit numbers and trust gates.
- Decide whether free `daily_talk` opens to all logged-in users or only verified
  users during beta.
- Confirm whether fan-letter 50/100 tiers remain visible or hidden until async
  moderation workflow is ready.

For Kaido:

- Review auth/trust/identity gates.
- Ensure this does not collide with email verification/password reset work.

For 루피:

- Implement preflight endpoint and cooldown/daily limits after approval.
- Add idempotency request fingerprint for chat feature orders.
- Add tests for provider missing, wallet no-debit, refund, and copy keys.

For Cloud:

- Wire frontend CTAs to disabled reason/messageKey only after backend contract is
  approved.
- Do not enable POST/order/generate buttons from frontend while provider status
  is not ready.

For QR:

- Smoke provider-not-configured, cooldown, daily limit, insufficient balance,
  idempotency replay, and no-debit cases.
- Verify no token/cookie/API key/signed URL/raw prompt appears in logs or Notion.

# AI Premium Content Generation Pipeline Contract Draft

Task: #537
Owner: Luffy
Status: draft contract for review

## Purpose

This draft defines a provider-neutral contract for AI artist premium content
generation. Image generation, video generation, and premium content packs should
enter the same server-owned flow instead of becoming separate one-off features.

This document is a product/backend contract only. It does not enable live vendor
calls, payments, wallet mutations, settlement changes, or provider credentials.

## Relationship To Existing Creator Image Requests

`creator_image_requests` remains the current image queue for Creator Studio
profile/content/feed/thumbnail/concept image requests. The contract below is the
future umbrella flow that can absorb image and video generation while preserving:

- active artist/operator authorization
- artist and request id preservation
- server-side safety review
- admin/backstage visibility
- asset-based result linking
- provider-neutral routing

Existing image request endpoints do not need to be removed for the first
implementation. A backend migration can either map `creator_image_requests` into
this flow or create the new tables/endpoints first and bridge image requests
later.

## Request Type Draft

All request types use the same envelope. The request type only selects product
policy, safety requirements, routing capabilities, and UI state copy.

| Type | Purpose | Output class | First surface |
| --- | --- | --- | --- |
| `image_single` | One approved image for profile, feed, or content use. | image | Creator Studio / Backstage |
| `image_variation` | Regenerate or vary an approved image direction. | image | Creator Studio / Backstage |
| `image_reference` | Concept/reference image for later manual or AI work. | image | Creator Studio |
| `video_clip` | Short premium AI video clip for unlockable content. | video | Backstage first |
| `video_loop` | Looping motion asset or teaser. | video | Backstage first |
| `premium_pack` | Bundled premium image/video result set under one review. | mixed | Backstage first |

Recommended common request envelope:

```json
{
  "requestType": "image_single",
  "surface": "creator_studio",
  "artistId": "artist-uuid",
  "sourceRequestId": "optional-existing-request-id",
  "brief": {
    "title": "Short operator-facing title",
    "intent": "profile_image",
    "userPrompt": "Operator-safe prompt text",
    "locale": "ko-KR"
  },
  "referenceAssetIds": ["asset-uuid"],
  "idempotencyKey": "client-generated-safe-key"
}
```

Server rules:

- `artistId` is required.
- request creator, target artist, and original request id must be preserved.
- mutation endpoints require auth and server-side authorization.
- `idempotencyKey` is required for create/regenerate/approve/reject mutations.
- request type enums are internal API values; frontend must show localized copy.
- billing, wallet debit, settlement, or payout side effects are not part of this
  draft.

## Context Schema Draft

Generation context is a server-built snapshot. Clients may submit a brief and
reference asset ids, but the server owns the final prompt context.

```json
{
  "contextVersion": 1,
  "artist": {
    "id": "artist-uuid",
    "slug": "artist-slug",
    "displayName": "Artist display name",
    "status": "active"
  },
  "persona": {
    "summary": "Approved character summary",
    "tone": ["bright", "confident"],
    "worldview": "Approved worldview fragment",
    "speechStyle": "Approved speech style"
  },
  "visualProfile": {
    "styleTags": ["stage", "neon", "idol"],
    "colorPalette": ["pink", "black"],
    "outfitRules": ["approved outfit direction"],
    "referenceAssetIds": ["asset-uuid"]
  },
  "safetyPolicy": {
    "minorPolicy": "block_or_escalate",
    "realPersonSimilarityPolicy": "block_or_review",
    "sexualContentPolicy": "block",
    "copyrightPolicy": "review",
    "platformPolicy": "review",
    "forbiddenExpressions": ["server-owned policy phrase"]
  },
  "brief": {
    "intent": "profile_image",
    "userPrompt": "Operator-safe prompt text",
    "locale": "ko-KR"
  },
  "snapshot": {
    "source": "server",
    "createdAt": "2026-05-27T00:00:00.000Z",
    "hash": "context-snapshot-hash"
  }
}
```

Do not store raw vendor payloads, private credentials, signed URLs, raw emails,
or sensitive identity material inside the context snapshot. If a prompt or
reference must be audited, store a sanitized policy-safe excerpt plus asset ids.

## Model Routing Layer Draft

The routing layer should choose a provider by capability, product policy, safety
state, and cost ceiling. It must not be hard-coupled to one vendor.

Provider capability examples:

| Capability | Example provider family | Notes |
| --- | --- | --- |
| `text_to_image` | GPT Image, Stable Diffusion | profile/content/reference images |
| `image_to_image` | GPT Image, Stable Diffusion | variations and corrections |
| `text_to_video` | Seedance or equivalent | video drafts |
| `image_to_video` | Seedance or equivalent | motion from approved stills |

Router input:

```json
{
  "requestType": "video_clip",
  "capabilities": ["text_to_video"],
  "artistId": "artist-uuid",
  "safetyTier": "review_required",
  "qualityTier": "premium",
  "maxEstimatedCost": {
    "amount": "0.00",
    "currency": "USD"
  }
}
```

Router output:

```json
{
  "routeStatus": "planned",
  "providerFamily": "seedance",
  "capability": "text_to_video",
  "modelAlias": "premium_video_default",
  "requiresHumanReview": true,
  "estimatedCost": {
    "amount": "0.00",
    "currency": "USD"
  }
}
```

Routing rules:

- Fail closed when provider readiness, policy state, or safety state is unknown.
- Store `providerFamily` and `modelAlias`, not private vendor credentials.
- Public/frontend responses should receive product state and localized copy keys,
  not raw vendor model names unless explicitly approved for operator surfaces.
- Regeneration must be a new attempt under the same request or a linked child
  request, never an untracked provider call.

## Safety Gate

Every request runs through the same safety gate before any generated result can
be reused or published.

Recommended pipeline:

1. `intake_validation`: validate auth, artist access, request type, brief length,
   reference assets, idempotency, and product policy.
2. `context_snapshot`: build immutable artist/persona/visual/safety context.
3. `preflight_safety`: block or escalate unsafe brief/reference combinations.
4. `provider_route`: select a provider capability only after preflight passes.
5. `provider_attempt`: call provider only in an implementation phase where
   provider readiness is approved.
6. `output_safety`: moderate generated asset metadata and thumbnails before
   linking results.
7. `human_review`: require admin/backstage review for premium, reusable, or
   sensitive outputs.
8. `delivery_link`: attach approved assets to the request; publishing/equipping
   stays a separate product decision.

Safety categories:

- minor or minor-coded character risk
- real person likeness or celebrity resemblance
- sexualized, exploitative, or fetishized output
- violence, self-harm, hateful, or harassment content
- copyrighted character, brand, style, or logo misuse
- platform policy violations
- prompt injection or request to bypass safety/context rules
- unsafe private reference material

Recommended status enum:

| Status | Meaning |
| --- | --- |
| `draft` | Server accepted a draft but has not queued generation. |
| `submitted` | User/operator submitted a request. |
| `safety_blocked` | Preflight blocked the request. |
| `needs_more_info` | Operator must revise the brief or references. |
| `queued` | Ready for routing/generation. |
| `generating` | Provider attempt is running. |
| `provider_failed` | Provider attempt failed without usable output. |
| `awaiting_review` | Output exists and requires review. |
| `approved` | Output passed review and may be linked by product surfaces. |
| `rejected` | Reviewer rejected the request or output. |
| `archived` | Hidden from active queues without deleting audit history. |

## Cost And Usage Logging

Cost/usage logging is required before paid or premium generation can open. The
first implementation may log zero-cost placeholders while provider calls remain
disabled.

Track per request:

- `estimatedCostAmount`, `estimatedCostCurrency`
- `actualCostAmount`, `actualCostCurrency`
- provider family, model alias, capability
- provider attempt count
- regeneration count and parent/child request linkage
- latency and queue wait time
- failure category and retryability
- output asset ids and storage class
- result reuse flag and reuse target
- human review state, reviewer id, and timestamps
- safety decision categories and sanitized notes

Do not log private vendor credentials, full signed URLs, raw provider responses,
raw private prompts with sensitive data, cookies, tokens, DB URLs, or raw emails.

## Draft API Shape

These endpoints are draft contracts only. They should stay disabled or return
closed/readiness states until backend implementation and QA approve them.

```http
POST /api/v1/ai-premium-content/requests
GET /api/v1/me/ai-premium-content/requests?artistId=<artistId>&status=submitted&take=30&cursor=<nextCursor>
GET /api/v1/ai-premium-content/requests/:requestId
POST /api/v1/ai-premium-content/requests/:requestId/regenerations
GET /admin/api/v1/ai-premium-content/requests?status=awaiting_review&requestType=video_clip&take=50&cursor=<nextCursor>
GET /admin/api/v1/ai-premium-content/requests/:requestId
PATCH /admin/api/v1/ai-premium-content/requests/:requestId
```

Create request response:

```json
{
  "request": {
    "id": "request-uuid",
    "requestType": "image_single",
    "artistId": "artist-uuid",
    "status": "submitted",
    "moderationStatus": "pending",
    "createdAt": "2026-05-27T00:00:00.000Z",
    "resultAssetIds": []
  },
  "policy": {
    "canGenerate": false,
    "disabledReason": "provider_not_configured",
    "messageKey": "aiPremiumContent.providerNotConfigured"
  }
}
```

Admin update allowed fields:

- `status`
- `moderationStatus`
- `adminNote`
- `rejectionReason`
- `resultAssetIds`
- `routingOverrideAlias`
- `reviewDecision`

Admin update must be idempotent when approving/rejecting the same request with
the same key. Result assets must already exist in the asset library and must pass
the output safety gate before linking.

## Admin Tracking Fields

Backstage/admin lists should keep product, review, and operations concerns
separate:

- request id, request type, source surface
- creator/user id, artist id, artist slug/display name
- current status and moderation status
- safety gate decision categories
- provider family, model alias, and capability
- estimated and actual cost
- attempt count, regeneration count, failure category
- result asset ids, output class, reuse targets
- review required flag, reviewer id, review timestamps
- sanitized operator brief excerpt
- created/updated/submitted/completed timestamps

## User-Facing State Copy

Frontend surfaces should not display raw enums such as `provider_failed`,
`text_to_video`, or provider family names by default. Use localized copy maps.

Suggested Korean fallback copy:

| Internal state | User copy |
| --- | --- |
| `draft` | 작성 중 |
| `submitted` | 요청이 접수됐어요 |
| `queued` | 생성 준비 중이에요 |
| `generating` | 콘텐츠를 만들고 있어요 |
| `awaiting_review` | 검수 중이에요 |
| `approved` | 콘텐츠가 준비됐어요 |
| `needs_more_info` | 추가 정보가 필요해요 |
| `safety_blocked` | 안전 기준 때문에 진행할 수 없어요 |
| `provider_failed` | 생성에 실패했어요 |
| `rejected` | 요청이 승인되지 않았어요 |
| `archived` | 보관된 요청이에요 |

User screens should separate:

- request status
- review status
- result availability
- retry/regeneration availability
- publish/equip availability

Do not mix this UI with Lumina wallet, settlement, payout, paid-like, or order
mutation flows until a separate billing contract is approved.

## Implementation Split

Suggested handoff after Chamo review:

- Kaido/backend:
  - schema and migration draft
  - request create/list/detail/admin endpoints
  - idempotency and authorization tests
  - safety gate state machine
  - provider router interface with closed readiness by default
  - cost/usage log tables
- Cloud/frontend:
  - localized status/copy adapter
  - Creator Studio and Backstage queue surfaces
  - disabled/readiness states before live provider opening
  - result asset preview states without provider/vendor leakage
- Reviewer/QA:
  - safety category coverage
  - repeated mutation/idempotency checks
  - no secret/provider payload leakage checks
  - wallet/settlement isolation checks

## Explicit Exclusions

- no live provider integration
- no vendor credential storage in docs or UI
- no wallet, order, settlement, payout, or paid-like mutation
- no public publishing/equipping side effect
- no investor document or PDF edits
- no hard-coupling to a single model or vendor

## Open Questions

- Should `creator_image_requests` be migrated into the new table or bridged as a
  legacy request source?
- Which request types require mandatory human review before delivery?
- Which premium outputs are reusable across fan surfaces versus single-use?
- Which cost currency and precision should finance use for provider usage?
- What is the minimum sanitized prompt/audit excerpt needed for operations
  without storing sensitive text?

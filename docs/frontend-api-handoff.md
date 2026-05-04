# Lumina Stage Frontend API Handoff

## Base URL

Production backend:

```txt
https://api.lumina-stage.com/api/v1
```

Local backend:

```txt
http://localhost:3001/api/v1
```

Render fallback backend:

```txt
https://lumina-stage-api.onrender.com/api/v1
```

## Health Check

```http
GET /health
```

Expected:

```json
{
  "status": "ok",
  "service": "lumina-stage-api",
  "timestamp": "2026-04-28T00:00:00.000Z"
}
```

## Public Content

### Artists

```http
GET /artists
GET /artists/roadmap
GET /artists/:slug
```

Initial public slugs:

```txt
yoon-serin
han-seoyul
park-doa
choi-seojin
oh-hyerin
cha-dohyun
seo-yuan
kwon-taejun
```

Frontend fields to use:

```txt
slug
displayName
category
displayCategory
profile.tagline
profile.summary
profile.personalityKeywords
visual.primaryColor
visual.secondaryColor
coverImage.url
thumbnailImage.url
assets[]
```

Image usage:

- `coverImage.url` is the primary large image.
- `thumbnailImage.url` is the card/list image.
- `assets[]` includes all public artist assets.
- `GET /artists` and `GET /artists/:slug` only expose public-ready artists that have both `coverImage` and `thumbnailImage`.
- `GET /artists/roadmap` exposes planned/candidate artists only. These are preparation records and are not returned by the public artist list until they become `active`.
- `category` and `displayCategory` are the same user-facing type label. Use this for `characters.html` category filters.
- Do not use `main`, `premium`, `sub`, or `candidate` as user-facing category filters. Those are internal tier/status concepts.
- Detail galleries should use `assets.filter((asset) => asset.usageType === "gallery")`.
- Gallery assets are seeded from current operation-pack folders where available:
  - `assets/characters/yoon-serin/reference-final/*`
  - `assets/characters/han-seoyul/reference/*`
  - `assets/characters/park-doa/reference-final/*`
  - `assets/characters/kwon-taejun/reference-final-01.png` through `reference-final-20.png`
- `reference`, `reference-final`, and `reference-rebuild` folders are not all automatically public. Only assets returned by the API should be shown in the frontend.
- Image URLs may be relative repo/storage keys until object storage is configured. If the URL starts with `assets/`, resolve it from the frontend site origin.
- After a seed deploy, stale local seed assets that are no longer in the current operation pack are archived and removed from public artist API responses.

Roadmap response for launch-prep cards:

```http
GET /api/v1/artists/roadmap
```

```json
{
  "items": [
    {
      "slug": "ha-yuna",
      "displayName": "Ha Yuna",
      "status": "planned",
      "launchPhase": "planned",
      "operationRole": "shortform_growth_candidate",
      "publicTagline": "Vivid street beauty candidate built for quick reactions and bold color.",
      "fandomCandidate": "HAVIBE",
      "gender": "female",
      "thumbnailUrl": null,
      "thumbUrl": null,
      "coverUrl": null,
      "galleryCount": 0,
      "imageBaselineNote": "Keep cat-like eyes, vivid makeup, street styling, and strong color separation from Han Seoyul."
    }
  ],
  "policy": {
    "visibility": "planned_candidate_only",
    "publicLaunchRule": "Roadmap artists are not returned by GET /api/v1/artists until status becomes active and cover/thumb assets are ready."
  }
}
```

Current planned seed slugs:

```txt
ha-yuna
```

Character category taxonomy:

```txt
Filter buttons:
전체
아티스트
모델
배우
엔터테이너
스포츠
기타
```

```txt
아티스트: yoon-serin, han-seoyul, oh-hyerin, min-chaeon, baek-ria, oh-yuna, cha-dohyun
모델: kang-sia, ha-yuna, seo-yuan
배우: choi-seojin, lee-jiwon, kwon-taejun
엔터테이너: park-doa, seo-hamin
스포츠: ryu-taeo
기타: temporary fallback for uncategorized or category-test characters
```

If a character has no explicit mapping and no `profile.publicMetadata.profileFacts.displayCategory`,
the backend returns `category/displayCategory = "기타"`. Use this as an operational holding bucket
until a new stable category is approved.

Current seeded artist category values:

```txt
yoon-serin -> 아티스트
han-seoyul -> 아티스트
park-doa -> 엔터테이너
choi-seojin -> 배우
oh-hyerin -> 아티스트
cha-dohyun -> 아티스트
seo-yuan -> 모델
ha-yuna -> 모델
kwon-taejun -> 배우
```

### Artist Detail Profile Box

The character detail profile box should no longer use hardcoded frontend-only values.
Use:

```txt
profile.publicMetadata.profileFacts
```

Recommended visible fields for the current detail profile box:

```txt
displayBirthDate
hometown
height
bloodType
position
debut
fanPoint
adCategory
mbti
hobbies
```

Additional optional fields are available for later UI:

```txt
characterType
fandomNameCandidate
fandomNameStatus
speechKeywords
favoriteGifts
signatureItems
representativeContent
premiumPoint
unlockItem
boostPoint
representativeColors
relationshipPosition
publicOneLiner
```

Example shape:

```json
{
  "profile": {
    "publicMetadata": {
      "profileFacts": {
        "displayBirthDate": "2001년 3월 14일",
        "hometown": "서울 강남구",
        "height": "169cm",
        "bloodType": "A형",
        "position": "메인 비주얼 / 퍼포먼스 센터",
        "debut": "2024년 Lumina Stage 1기",
        "fanPoint": "차가운 시선, 절제된 표정, 무대 위 집중력",
        "adCategory": "뷰티 · 향수 · 패션 필름",
        "mbti": "INTJ",
        "hobbies": ["영화 감상", "향수 수집", "새벽 드라이브"]
      }
    }
  }
}
```

Keep real company, brand, and celebrity names out of frontend copy. Use only category names or fictional brand names until a real partnership is signed.

### Shortforms

```http
GET /shortforms
GET /shortforms/:slug
```

Frontend fields to use:

```txt
slug
title
description
artist.slug
artist.displayName
thumbnail.url
assets[]
```

## Auth

```http
GET /app/bootstrap
POST /auth/register
POST /auth/login
GET /auth/social/providers
POST /auth/social/login
POST /auth/refresh
POST /auth/logout
POST /auth/email-verifications
POST /auth/email-verifications/confirm
POST /auth/password-resets
POST /auth/password-resets/confirm
GET /me
GET /me/summary
GET /me/trust
GET /me/activity-ledger?type=all&take=50
PATCH /me/profile
GET /me/settings
PATCH /me/settings
GET /localization/policy
POST /me/assets/upload-intents
POST /me/assets/:assetId/confirm-upload
GET /me/notifications?status=all&take=20
GET /me/notifications/unread-count
PATCH /me/notifications/:notificationId/read
PATCH /me/notifications/read-all
PATCH /me/password
PATCH /me/password/setup
DELETE /me
GET /me/sessions
DELETE /me/sessions
DELETE /me/sessions/:sessionId
```

Use `Authorization: Bearer <accessToken>` for authenticated requests.

Auth responses:

- `GET /app/bootstrap` is public and can be used as a first-load configuration endpoint. It returns localization policy, social provider status, Lumina currency constants, feature flags, lightweight product policies, artist category filter labels, and important endpoint hints. It does not include secrets or user-specific data.
- `GET /app/bootstrap` returns `policy.artistCategories.filterLabels = ["전체", "아티스트", "모델", "배우", "엔터테이너", "스포츠", "기타"]`. Build category filter UI from this list when possible, and read each artist card's `category/displayCategory` for the selected value.
- `GET /app/bootstrap` returns `policy.userImageUpload.maxBytes = 8388608` by default. Use this as the frontend source of truth for avatar/feed image file-size validation when possible.
- `GET /app/bootstrap` returns `policy.luminaFeed`: image attachments are capped at 4, feed video upload is not allowed in MVP, and external links are HTTPS metadata-only cards with remote fetching disabled.
- Email-password signup uses email only. Password policy: 8-128 characters, at least one letter and one number. If `displayName` is omitted, the backend assigns a temporary display name such as `민트별빛4827`; do not derive a public name from the email prefix on the frontend.
- `POST /auth/register` and `POST /auth/login` return `{ user, tokens }`.
- `tokens` contains `accessToken`, `refreshToken`, and `tokenType: "Bearer"`.
- For compatibility with the current frontend, auth responses also include top-level `accessToken`, `refreshToken`, and `tokenType` aliases.
- Access token TTL is controlled by `JWT_ACCESS_EXPIRES_IN`; the repo default is `15m`. MVP frontend should implement `401 -> POST /auth/refresh -> retry original request once` instead of assuming the access token is long-lived.
- Refresh endpoint: `POST /auth/refresh` with body `{ "refreshToken": "<refreshToken>" }`. Do not send an Authorization header for refresh. Success returns the same auth response shape with rotated `accessToken` and `refreshToken`; persist both. Invalid/expired/revoked refresh tokens return `401`, and the frontend should clear auth state and show a login-required message.
- Refresh token TTL is controlled by `JWT_REFRESH_EXPIRES_IN`; the repo default is `30d`. Refresh tokens are stored server-side as hashes and rotated on every refresh. `POST /auth/logout`, password change, account deletion, session revoke, and admin suspend/delete revoke server-side refresh sessions.
- `POST /auth/social/login` accepts `{ "provider": "google" | "kakao" | "naver", "token": "<provider-token>" }`; `accessToken` is also accepted as an alias for `token`.
- Authorization-code handoff is also accepted as `{ "provider": "kakao", "code": "<code>", "redirectUri": "<same-redirect-uri>" }`. The `redirectUri` value must exactly match the URI registered in Kakao Developers and used when the code was issued. The backend may override it with `KAKAO_REDIRECT_URI` in Render to avoid `www`/non-`www` drift.
- Google can send either a Google ID token or OAuth access token. Kakao and Naver should send access tokens when using the token handoff.
- `GET /me` returns the current user plus profile convenience fields: `displayName`, `publicHandle`, `avatarUrl`, `avatarAsset`, `provider`, `providers`, `hasPassword`, `isSocialOnly`, `nicknameLastChangedAt`, `nicknameNextChangeAt`, and `canChangeNickname`. `emailVerifiedAt` is intentionally omitted for now; email verification remains a backend skeleton until the production DB rollout is explicitly confirmed.
- `PATCH /me/profile` body: `{ "displayName": "닉네임", "bio": "optional", "avatarAssetId": "<asset uuid>" }`. New accounts receive an auto-assigned temporary `displayName`; users can change it from My Page. `displayName` is 2-20 characters and can be changed once every 30 days after a user change. The server returns the updated `GET /me` shape. If the nickname cooldown is active, expect `429 Nickname can be changed once every 30 days`.
- Avatar upload policy for 1차: reuse the asset upload flow and then pass the confirmed image asset id as `avatarAssetId`. A dedicated user-facing avatar upload intent can be split out later if needed.
- `GET /me/summary` is the recommended My Page bootstrap endpoint. It returns `{ user, wallet, recentLedger, recentPaymentOrders, activity, recentActivities, debut, policy }` so the frontend does not need to call every history endpoint on first render. `activity` now includes `followingArtists`, `followingUsers`, `followers`, `followCounts`, and `feedCounts`. `activity.followingArtists[]` uses the same My Page card shape as `GET /me/following-artists`.
- `GET /me/trust` returns the current user's trust/role gate state for abuse-sensitive actions. Use this to decide whether to show "identity verification required" messaging before referral rewards, paid support, fan letters, and future creator settlement surfaces. MVP identity verification is advisory and based on phone-number presence until a real identity provider is connected.
- `GET /me/settings` returns `{ settings, policy }`.
- `PATCH /me/settings` accepts either flat fields or the My Page nested notification shape. Flat body: `{ "locale": "ko-KR", "timezone": "Asia/Seoul", "marketingOptIn": false, "pushOptIn": false, "activityNotifications": true, "feedNotifications": true, "emailNotifications": false }`. Nested body: `{ "locale": "ko-KR", "timezone": "Asia/Seoul", "notifications": { "activityNotifications": true, "marketingOptIn": false, "feedNotifications": true, "emailNotifications": false } }`. Send at least one effective field. Supported `locale` values are `ko-KR`, `ja-JP`, `en-US`, and `zh-CN`; unsupported values return validation `400`. The response is the same `{ settings, policy }` shape.
- `GET /localization/policy` is public. It reads the request `Accept-Language` header and returns `{ defaultLocale, supportedLocales, detectedLocale, source, fallbackRule, storageEndpoints }`. Use it for anonymous first-load language detection. For logged-in users, prefer `GET /me/settings.settings.locale` first.
- User image upload flow for avatars/feed: `POST /me/assets/upload-intents` then upload the file with the returned `upload.method/url/requiredHeaders`, then `POST /me/assets/:assetId/confirm-upload`. The confirmed `asset.id` can be passed to `PATCH /me/profile.avatarAssetId` or `POST /lumina-feed/posts.assetIds`.
- `GET /me/notifications?status=all&take=20` returns `{ notifications, unreadCount, nextCursor }`. `status` can be `all`, `unread`, or `read`; `type` can optionally filter a single notification type; `cursor` accepts the previous `nextCursor`.
- Notification item shape: `{ id, type, title, body, i18n, targetType, targetId, metadata, readAt, createdAt, actor, artist }`. `actor` is `{ id, displayName, avatarUrl } | null`; `artist` is `{ id, slug, displayName } | null`.
- Notification `i18n` is for frontend translation dictionaries and returns `{ messageKey, titleKey, bodyKey, defaultTitle, defaultBody, params }`. Current keys include `notification.feed.reply.title`, `notification.feed.like.title`, and `notification.user.follow.title`. Use `title`/`body` as fallback display text if a locale key is missing.
- `GET /me/notifications/unread-count` returns `{ unreadCount }`.
- `PATCH /me/notifications/:notificationId/read` marks one notification read and returns `{ notification }`.
- `PATCH /me/notifications/read-all` marks all unread notifications read and returns `{ ok: true, updatedCount }`.
- `PATCH /me/password/setup` is for logged-in social-only users with an email. Body: `{ "newPassword": "abc12345" }`. It creates the email-password auth account and returns `{ "ok": true, "user": <GET /me shape> }`. If `hasPassword` is already true, use `PATCH /me/password` instead.
- `GET /me/activity-ledger?type=all&take=50` returns a unified recent activity list for My Page. `type` can be `all`, `charge`, `boost`, `unlock`, `gift`, or `free_like`. Each item has `id`, `type`, `title`, `description`, `amountLumina`, `status`, `createdAt`, `relatedArtist`, and `relatedContent`.

My Page scope notes for 2026-05-02:

- Covered now: profile fields, avatar asset display data, nickname cooldown, password/social-only flags, wallet Lumina/Stella display hints, payment order history, unified activity ledger, premium unlocks, boost/free-like activity, following artists, following users, followers, feed counts, debut application card data, notification/settings API, and account deletion/session safety signals.
- Later split if needed: dedicated avatar upload intent for normal users, thumbnail resizing, social-only password setup, blocked users, hidden feed posts, and refund/reversal display details.
- `POST /auth/email-verifications` body: `{ "email": "user@example.com" }`.
- `POST /auth/email-verifications/confirm` body: `{ "token": "<email-token>" }`.
- `POST /auth/password-resets` body: `{ "email": "user@example.com" }`.
- `POST /auth/password-resets/confirm` body: `{ "token": "<reset-token>", "newPassword": "<new-password>" }`.

Email delivery is not connected yet. The two request endpoints currently return `delivery.status = "not_configured"` and never reveal whether the email exists. Once a mail provider is added, the frontend contract can stay the same.

For local/staging QA only, the backend can expose the generated action token when `ACTION_TOKEN_DEBUG_ENABLED=true` and `NODE_ENV` is not `production`. Production must keep this disabled. If enabled and the email belongs to an active account, request responses include:

```json
{
  "ok": true,
  "delivery": { "status": "not_configured", "channel": "email" },
  "debug": {
    "actionToken": "<confirm-token>",
    "expiresAt": "2026-05-02T12:00:00.000Z",
    "warning": "Debug only. Never enable in production or share tokens publicly."
  }
}
```

If the email does not exist, the response still returns `ok: true` and omits `debug`, so production clients must not rely on this field.

Account deletion:

```http
DELETE /me
```

Email-password accounts must send:

```json
{ "currentPassword": "abc12345", "reason": "optional user-entered reason" }
```

Social-only accounts may omit `currentPassword`. On success, the backend soft-deletes the user, revokes all refresh-token sessions, consumes outstanding email/password action tokens, deactivates the user's referral code, and writes a `user.self_delete` audit event. The frontend must clear local access/refresh tokens and send the user back to a logged-out state immediately. Wallet ledgers, payments, gifts, and audit history are retained server-side.

If an admin suspends/deletes a user, existing access tokens also stop passing protected API guards. The frontend should treat `401` after a previously valid login as a forced logout and clear local tokens.

### Referral Code On Signup

Signup and social signup can include an optional referral code.

Email signup body:

```json
{
  "email": "user@example.com",
  "password": "abc12345",
  "displayName": "닉네임",
  "referralCode": "ABC12345"
}
```

Social signup/login body:

```json
{
  "provider": "google",
  "token": "<provider-token>",
  "referralCode": "ABC12345"
}
```

Frontend rules:

- Referral code input is optional.
- Show it only on signup/social first-entry UI, not normal email login.
- Trim whitespace and convert to uppercase before sending.
- Allowed characters: uppercase English letters, numbers, underscore, hyphen.
- Length: 6-24 characters.
- If the user leaves it blank, omit `referralCode` from the request body.
- If the code is invalid, backend returns `400` with message `Referral code is not valid`.

Reward behavior:

- New user always receives 300 Lumina signup bonus.
- Valid referral code grants 500 Lumina to the referrer and 500 Lumina to the new user.
- Self-referral is blocked by backend.

## Commerce/Public Products

```http
GET /lumina-station?take=5
GET /lumina-products
GET /payments/orders?take=20
POST /payments/orders
GET /payments/orders/:orderId
GET /boost-campaigns/current
GET /boost-products
GET /premium-videos
GET /chat-feature-products
GET /artists/:artistId/gift-products
```

### Lumina Station

`GET /lumina-station?take=5` requires `Authorization: Bearer <accessToken>` and is the recommended bootstrap endpoint for the Lumina charge screen. It returns the user's wallet, active charge products, recent orders, payment status hints, and display policy in one call.

### Creator Revenue / Settlement

Backend policy draft:

- `docs/creator-revenue-settlement-spec.md`
- `docs/character-chat-backend-plan.md`
- `docs/trust-identity-abuse-policy.md`

Planned creator-facing settlement surfaces:

```http
GET /me/creator/settlements/current
GET /me/creator/settlements?take=20
GET /me/creator/revenue-events?period=2026-05&take=50
```

These endpoints are not implemented yet. The product requirement is that
creators should see an estimated payout such as `현재까지 약 207,000원 정산 예정`
and admins should be able to review/confirm/mark payouts as paid.

Implemented MVP support endpoints:

```http
GET /me/trust
GET /chat-feature-products
POST /chat-feature-orders/preview
POST /chat-feature-orders
POST /moderation/preview
Authorization: Bearer <accessToken>
```

Important frontend rule for later:

- Do not show raw gross Lumina usage as payout.
- Show estimated payout only after the backend returns a settlement estimate.
- Do not split creator-facing payout by paid/free Lumina. Promotional Lumina
  spent on paid creator products is treated as Lumina Stage marketing cost.
- Paid votes, fan letters, and paid chat modes are settlement candidates when
  the backend marks them settlement eligible.
- Final payout may change after PG fees, VAT, AI cost, refunds, holds, and admin
  confirmation.

Draft price policy:

- Basic character chat: free, settlement excluded.
- Deep reply: 2L, seeded as `CHAT_DEEP_REPLY`.
- Story reply: 5L, seeded as `CHAT_STORY_REPLY`.
- Premium story: 10L, seeded as `CHAT_PREMIUM_REPLY`.
- Fan letter: 30L / 50L / 100L, seeded as `CHAT_FANLETTER_30`,
  `CHAT_FANLETTER_50`, and `CHAT_FANLETTER_100`.
- Paid vote / Lumina boost: 10L.
- Image / voice replies are reserved as draft products until model-cost and
  safety validation are complete.

Chat feature order preview:

```http
POST /chat-feature-orders/preview
Authorization: Bearer <accessToken>
```

Request:

```json
{
  "chatSessionId": "<chat session uuid>",
  "chatFeatureProductId": "<chat feature product uuid>"
}
```

Response:

```json
{
  "session": {
    "id": "<chat session uuid>",
    "artistId": "<artist uuid>",
    "chatPersonaId": null
  },
  "product": {
    "id": "<product uuid>",
    "sku": "CHAT_DEEP_REPLY",
    "name": "Deep reply",
    "displayName": "딥리플",
    "featureType": "deep_reply",
    "priceLumina": "2",
    "status": "active",
    "modelTier": "mini"
  },
  "wallet": {
    "id": "<wallet uuid>",
    "currencyCode": "LUMINA",
    "balanceLumina": "300",
    "afterBalanceLumina": "298",
    "sufficientBalance": true
  },
  "policy": {
    "idempotencyRequired": true,
    "settlementEligible": true,
    "refundOnGenerationFailure": true,
    "mvpLocked": true,
    "requiresIdentityVerification": false,
    "generationStatus": "not_started"
  }
}
```

Use preview before `POST /chat-feature-orders` so the frontend can show balance,
product price, and settlement hints before the wallet debit. `POST
/chat-feature-orders` still performs the real wallet debit and must use an
`Idempotency-Key` header or `idempotencyKey` body value.

Text moderation preview:

```http
POST /moderation/preview
Authorization: Bearer <accessToken>
```

Request:

```json
{
  "surface": "character_chat",
  "body": "message to check"
}
```

Response:

```json
{
  "decision": "allow",
  "riskLevel": "low",
  "matchedTypes": [],
  "userMessage": null,
  "surface": "character_chat",
  "policy": {
    "mode": "keyword_preview_mvp",
    "hardBlockTypes": ["email", "phone_number", "external_payment", "external_contact"],
    "reviewTypes": ["offline_meeting", "adult_boundary", "settlement_risk"],
    "note": "Preview only. Persisted moderation queues can be added with a later schema migration."
  }
}
```

For MVP this is a preflight helper, not a persisted moderation queue. Feed,
fan-letter, creator DM-like flows, and character-chat inputs can call it before
submit to show block/review messaging consistently.

Response shape:

```json
{
  "wallet": {
    "id": "<wallet uuid>",
    "currencyCode": "LUMINA",
    "cachedBalance": "300"
  },
  "products": [
    {
      "id": "<product uuid>",
      "sku": "LUMINA_1000",
      "name": "루미나 1,000",
      "luminaAmount": "1000",
      "bonusAmount": "0",
      "totalLumina": "1000",
      "priceAmount": "10000",
      "priceCurrency": "KRW",
      "unitPriceKrw": "10",
      "bonusRate": "0",
      "discountAmount": "0",
      "isBestValue": false
    }
  ],
  "recentOrders": [],
  "payment": {
    "provider": "mock",
    "status": "pg_pending",
    "createOrderEndpoint": "/api/v1/payments/orders",
    "orderHistoryEndpoint": "/api/v1/payments/orders"
  },
  "policy": {
    "currencyCode": "LUMINA",
    "displayName": "Lumina",
    "unitPriceKrw": "10",
    "signupBonusLumina": 300,
    "referralBonusLumina": 500,
    "paidLikeUnitPriceLumina": 10,
    "paidLikeDailyLimit": 20
  }
}
```

Charge flow:

1. Load `GET /lumina-station` when opening the charge screen.
2. User selects one `products[].id`.
3. Create an order with `POST /payments/orders` body `{ "luminaProductId": "<product id>" }` and an `Idempotency-Key`.
4. Use `checkout` from the order response when a real PG adapter is connected.
5. Do not credit Lumina on the frontend. Lumina is credited only after the backend receives a paid provider transaction/webhook.
6. Refresh `GET /lumina-station` or `GET /wallet` after payment completion.

Current MVP note: PG approval/provider is still pending, so `payment.status = "pg_pending"` is expected. The frontend can show the charge station UI and product cards now, but real payment completion depends on future PG adapter setup.

### Boost Campaign / Free Like

```http
GET /boost-campaigns/current
GET /boost-campaigns/:campaignId/rankings
POST /boost-campaigns/:campaignId/free-like
POST /boost-campaigns/:campaignId/paid-like
```

`POST /boost-campaigns/:campaignId/free-like` requires `Authorization: Bearer <accessToken>`.

Recommended body:

```json
{ "artistId": "<artist UUID>" }
```

Compatibility body:

```json
{ "artistSlug": "yoon-serin" }
```

The backend also accepts a slug-like `artistId` for current frontend compatibility. After a successful like, refresh rankings with `GET /boost-campaigns/:campaignId/rankings`. Daily free-like limit failures currently return `400 Daily free like limit exceeded`.

`POST /boost-campaigns/:campaignId/paid-like` requires `Authorization: Bearer <accessToken>`.

Policy:

- Free like: 1 per day, no Lumina spend. It is a ranking/fan-temperature signal
  only and is not settlement eligible.
- Paid like: 1 like unit = 10L. The backend uses the active `BOOST_BASIC_VOTE`
  boost product internally, debits the wallet, writes `wallet_ledger`, and
  creates a `lumina_boost` ranking event in one DB transaction. Paid likes are
  settlement candidates when the future creator-settlement event marks them
  eligible.
- Paid like daily limit: 20 units per user per service day. This is the MVP
  launch policy chosen to balance revenue testing and ranking fairness.
- `quantity` defaults to `1` and must be an integer between `1` and `20`.
- If the user exceeds the daily paid-like limit, expect `400 Daily paid like
  limit exceeded`.
- Send `Idempotency-Key` header or `idempotencyKey` in the body to avoid
  double spending on retries.
- Future identity/trust rule: signup remains open, but paid support, referral
  rewards, fan letters, bonus-Lumina settlement spend, and creator settlement
  actions may return `IDENTITY_VERIFICATION_REQUIRED`. See
  `docs/trust-identity-abuse-policy.md`.

Recommended body:

```json
{
  "artistSlug": "yoon-serin",
  "quantity": 1
}
```

Compatibility body:

```json
{
  "artistId": "<artist UUID or artist slug>",
  "quantity": 5,
  "idempotencyKey": "paid-like-unique-client-key"
}
```

Success response:

```json
{
  "event": {
    "id": "event-uuid",
    "campaignId": "campaign-uuid",
    "artistId": "artist-uuid",
    "boostType": "lumina_boost",
    "rawAmount": "10",
    "weightedScore": "10",
    "metadata": {
      "source": "paid_like",
      "quantity": 1,
      "artistSlug": "yoon-serin",
      "unitPriceLumina": "10",
      "totalPriceLumina": "10"
    }
  },
  "idempotentReplay": false,
  "paidLike": {
    "quantity": 1,
    "unitPriceLumina": "10",
    "totalPriceLumina": "10",
    "unitBoostAmount": "10",
    "totalBoostAmount": "10",
    "dailyLimit": 20,
    "usedToday": 1,
    "remainingToday": 19,
    "resetsAt": "2026-05-03T00:00:00.000Z"
  },
  "wallet": {
    "cachedBalance": "290"
  }
}
```

After a successful paid like, refresh rankings with
`GET /boost-campaigns/:campaignId/rankings`.

### Lumina Pick

`루미나 픽` is the renamed popular vote surface. It owns voting, rankings,
monthly main pick, and hall of fame.

```http
GET /popular-vote/main-pick
GET /popular-vote/hall-of-fame/monthly-picks?year=2026
GET /popular-vote/hall-of-fame/year-champion?year=2026
```

`GET /popular-vote/main-pick` returns:

```json
{
  "campaign": {},
  "leader": {},
  "rankings": []
}
```

Use this for the `Main Pick / 이달의 1위` tab. `leader` is the first ranking row, or `null` when there is no active campaign or no votes yet.

`GET /popular-vote/hall-of-fame/monthly-picks` returns monthly winner records from `monthly_pick_winners`. The backend finalizes these through admin operation after a month closes.

`GET /popular-vote/hall-of-fame/year-champion` uses the current draft rule: annual total weighted score sum. The response shape is `{ year, champion, rankings, rule: "annual_weighted_score_sum" }`.

### Debut Applications

`데뷔하기` form submission requires login.

```http
GET /debut/policy
POST /debut/applications
GET /me/debut-applications
GET /me/debut-applications/latest
POST /me/debut-applications/:applicationId/withdraw
```

Detailed product/policy draft:

- `docs/ai-debut-policy-and-application-spec.md`

Use `GET /debut/policy` to bootstrap static form options and guardrail hints.
It is public and does not include personal data.

Response highlights:

```json
{
  "product": "ai_debut",
  "policyVersion": "2026-05-03.applicant-types",
  "minApplicantAgePolicy": {
    "adultOnly": true,
    "isAdultRequired": true,
    "minorApplicationStatus": "not_open"
  },
  "applicantTypes": [
    {
      "value": "personal_unaffiliated",
      "label": "Personal / unaffiliated applicant",
      "rightsReviewRequired": false,
      "partnerReviewRequired": false,
      "recommended": true
    },
    {
      "value": "represented_artist",
      "label": "Represented artist / trainee / entertainment contact",
      "rightsReviewRequired": true,
      "partnerReviewRequired": false
    },
    {
      "value": "ai_creator_partner",
      "label": "AI creator partner",
      "rightsReviewRequired": false,
      "partnerReviewRequired": true
    },
    {
      "value": "partnership_other",
      "label": "Other partnership inquiry",
      "rightsReviewRequired": false,
      "partnerReviewRequired": true
    }
  ],
  "applicationChannels": [
    {
      "value": "phone_consultation",
      "label": "Phone consultation",
      "uploadEnabled": false,
      "recommended": true
    },
    {
      "value": "online_review",
      "label": "Online review",
      "uploadEnabled": false,
      "status": "planned"
    }
  ],
  "participationTypes": [
    {
      "value": "appearance_only",
      "labelKo": "외모/이미지 제공",
      "draftShareRange": { "min": 20, "max": 30 }
    }
  ],
  "statuses": [
    { "value": "submitted", "labelKo": "접수 완료", "userVisible": true }
  ],
  "consentKeys": [
    { "key": "consentAppearance", "required": true }
  ],
  "fieldPolicy": {
    "intro": { "minLength": 20, "maxLength": 4000 },
    "applicationType": {
      "default": "personal_unaffiliated",
      "values": [
        "personal_unaffiliated",
        "represented_artist",
        "ai_creator_partner",
        "partnership_other"
      ]
    },
    "preferredContactTime": { "maxLength": 120, "required": false },
    "shareTierRequested": { "min": 0, "max": 70, "required": false }
  },
  "materialSubmissionPolicy": {
    "currentMvpMode": "no_file_upload",
    "onlineReview": "Image or portfolio upload can be opened later through a separate secure upload flow."
  }
}
```

Body:

```json
{
  "applicationChannel": "phone_consultation",
  "applicationType": "personal_unaffiliated",
  "applicantName": "Applicant legal/name for review",
  "displayName": "Optional public stage/name idea",
  "contactEmail": "user@example.com",
  "contactPhone": "010-0000-0000",
  "preferredContactTime": "Weekdays after 7 PM",
  "isAdult": true,
  "participationType": "appearance_only",
  "shareTierRequested": 30,
  "intro": "Short motivation and concept note",
  "portfolioUrl": "https://example.com/portfolio",
  "affiliatedOrgName": null,
  "rightsRelationshipNote": null,
  "creatorExperienceNote": null,
  "consentAppearance": true,
  "consentVoice": false,
  "consentRevenuePolicy": true,
  "consentPrivacy": true,
  "consultationConsent": true
}
```

MVP application channel policy:

- Recommended default: `applicationChannel: "phone_consultation"`.
- `phone_consultation` is the low-friction MVP path. It requires `contactPhone` and `consultationConsent: true`; the operator confirms details by phone after submission.
- `online_review` is reserved for a later richer path. The current backend does not accept file uploads through the debut form.
- The backend stores `applicationChannel`, `preferredContactTime`, `consultationConsent`, and `materialSubmissionMode: "no_file_upload_mvp"` in application metadata.

Allowed `applicationType` values:

- `personal_unaffiliated`: default path for individual or unaffiliated applicants.
- `represented_artist`: affiliated artist, trainee, agency, management, or entertainment-company inquiry. The backend stores `rightsReviewRequired: true` and `rightsReviewStatus: "pending"` in metadata.
- `ai_creator_partner`: AI image/video/shortform production partner inquiry. The backend stores `partnerReviewRequired: true` and `partnerReviewStatus: "pending"` in metadata.
- `partnership_other`: other partnership inquiry. The backend stores `partnerReviewRequired: true` and `partnerReviewStatus: "pending"` in metadata.

Optional application-type fields:

- `affiliatedOrgName`: agency/company/team name when relevant, max 120 chars.
- `rightsRelationshipNote`: short non-sensitive rights/contract relationship memo, max 1000 chars.
- `creatorExperienceNote`: AI creator tool/work experience memo, max 1000 chars.

Do not imply that Lumina Stage can bypass an existing contract. If `applicationType` is `represented_artist`, show a rights-confirmation notice before submission.

Allowed `participationType` values:

- `appearance_only`: appearance/image rights only, draft share range 20-30%.
- `voice_or_song`: appearance plus voice or song, draft share range 30-45%.
- `performance`: appearance plus singing/dance/acting performance, draft share range 45-60%.
- `co_creator`: ongoing planning/content/fandom participation, up to 70%.

Required consents: `consentAppearance`, `consentRevenuePolicy`, `consentPrivacy`. Keep real IDs, contracts, and sensitive files outside Notion/Git/chat until the final secure upload/contract process is defined.

Validation notes:

- `isAdult` must be `true` for MVP. Minor applicant flow is not open yet.
- `intro` must be 20-4000 characters.
- `shareTierRequested` is optional but must be an integer from 0 to 70 when sent.
- `metadata` may hold non-sensitive structured details such as `stageConcept`, `preferredGenres`, `providedMaterials`, `prohibitedUses`, `socialLinks`, and `expectedRole`.
- Do not send resident registration numbers, ID images, bank accounts, final contracts, API keys, or secrets.

`GET /me/debut-applications/latest` returns:

```json
{
  "application": null,
  "ctaState": "apply"
}
```

If an application exists, `application` is the latest submitted record and `ctaState` is `"status"`.

Applicants may withdraw only applications in `submitted`, `reviewing`, or `needs_more_info`:

```http
POST /me/debut-applications/:applicationId/withdraw
```

Success:

```json
{
  "application": {
    "id": "application-uuid",
    "status": "withdrawn"
  },
  "ok": true,
  "alreadyWithdrawn": false
}
```

Admin statuses are `submitted`, `reviewing`, `needs_more_info`, `approved`, `rejected`, and `withdrawn`. The backend also accepts `under_review` as a compatibility alias and stores it as `reviewing`.

Admin/operations endpoints for phone consultation queue:

```http
GET /admin/api/v1/debut/applications?status=submitted&applicationChannel=phone_consultation&applicationType=represented_artist&rightsReviewRequired=true&consultationStatus=pending&query=seo&take=50&cursor=<nextCursor>
GET /admin/api/v1/debut/applications/:applicationId
PATCH /admin/api/v1/debut/applications/:applicationId
```

List response:

```json
{
  "items": [],
  "count": 0,
  "hasMore": false,
  "nextCursor": null
}
```

Use `nextCursor` as the next request's `cursor`. `query` searches applicant
name, display name, contact email/phone, intro, and linked user email.

Admin PATCH can update review and consultation metadata together:

```json
{
  "status": "reviewing",
  "consultationStatus": "scheduled",
  "consultationScheduledAt": "2026-05-03T10:00:00.000Z",
  "consultationNote": "Requested evening call. First contact scheduled.",
  "rightsReviewStatus": "reviewing",
  "rightsReviewNote": "Agency relationship should be confirmed before production review.",
  "partnerReviewStatus": "not_applicable",
  "reviewNote": "Phone consultation queue"
}
```

Allowed `consultationStatus`: `pending`, `scheduled`, `contacted`, `no_answer`, `completed`.
Allowed `rightsReviewStatus`: `not_required`, `pending`, `reviewing`, `cleared`, `blocked`.
Allowed `partnerReviewStatus`: `not_applicable`, `pending`, `reviewing`, `accepted`, `declined`.
The consultation, applicant-type, rights-review, and partner-review fields are stored in `application.metadata` until operations volume proves which fields deserve real DB columns.

Frontend first form sections:

- application type selection: `personal_unaffiliated`, `represented_artist`, `ai_creator_partner`, `partnership_other`
- debut type selection: `appearance_only`, `voice_or_song`, `performance`, `co_creator`
- applicant story/concept
- contact email and optional phone
- preferred contact time for phone consultation
- requested revenue share, 0-70, with "final share is reviewed separately" notice
- required consent checkboxes
- optional voice/song/performance consent when relevant
- optional marketing/public promotion consent, not required for application review

Do not collect ID card images, resident registration numbers, bank accounts, final contract files, API keys, secrets, or raw file uploads in the MVP phone-consultation form.

### Free Like Quota

Use this endpoint for a logged-in user's daily free-like remaining count.

```http
GET /me/free-like-quota
Authorization: Bearer <accessToken>
```

Response:

```json
{
  "campaign": {
    "id": "campaign-uuid",
    "slug": "mvp-launch-main-pick",
    "name": "루미나 픽 메인 캠페인"
  },
  "dailyLimit": 1,
  "usedToday": 0,
  "remaining": 1,
  "resetsAt": "2026-05-03T00:00:00.000Z"
}
```

If there is no active campaign, `campaign` is `null` and quota fields are `0`.

### Paid Like Quota

Use this endpoint before showing a paid-like purchase modal.

```http
GET /me/paid-like-quota
Authorization: Bearer <accessToken>
```

Response:

```json
{
  "campaign": {
    "id": "campaign-uuid",
    "slug": "mvp-launch-main-pick",
    "name": "루미나 픽 메인 캠페인"
  },
  "dailyLimit": 20,
  "usedToday": 0,
  "remaining": 20,
  "resetsAt": "2026-05-03T00:00:00.000Z",
  "unitPriceLumina": "10"
}
```

Frontend policy:

- Show paid-like options as `1`, `5`, `10`, or `20` units within the remaining
  daily quota.
- Do not show a `30` unit option for MVP launch.
- Suggested copy: `추가 응원은 하루 최대 20개까지 보낼 수 있어요.`

### Lumina Feed

`루미나 피드` is the X-style fan/artist timeline. It is separate from Shortform:

- `루미나 픽`: vote/ranking/main pick/hall of fame.
- `루미나 피드`: text-first artist, AI artist, and fan timeline.
- `숏폼`: video/performance/challenge/teaser/clips.

Backend draft spec:

- `docs/lumina-feed-backend-spec.md`

Public feed:

```http
GET /lumina-feed?mode=all&take=20
GET /lumina-feed?mode=artists&take=20
GET /lumina-feed?mode=fans&take=20
GET /lumina-feed?artistSlug=choi-seojin
GET /me/lumina-feed?mode=all&take=20
GET /me/lumina-feed?mode=following&take=20
GET /lumina-feed/samples?mode=all&take=20
GET /artists/:slug/posts
```

`GET /me/lumina-feed` uses the same query and post shape as the public feed, but requires `Authorization: Bearer <accessToken>`. It excludes posts hidden by the current user and posts from users who are in an active block relationship with the current user.
`mode=following` is only supported on `GET /me/lumina-feed`. It returns posts from followed artists and followed normal users. If the viewer follows nobody, the response is `[]`.

Sample posts:

```http
GET /lumina-feed/samples?mode=all&take=20
GET /lumina-feed/samples?mode=artists&artistSlug=choi-seojin
GET /lumina-feed/samples?mode=debut
```

Use this when the real feed is empty or while the UI is still in prototype mode.
It exposes the #019 Notion sample-post pack through the backend and does not
read or write the database.

Response:

```json
{
  "source": "notion_019_sample_posts",
  "total": 30,
  "items": [
    {
      "id": "sample-001",
      "postType": "artist_post",
      "artistSlug": "yoon-serin",
      "authorType": "ai_artist",
      "body": "리허설이 끝났습니다. 조명이 꺼진 뒤에도 남는 시선이 있다면, 오늘의 무대는 성공에 가까웠다고 생각해요.",
      "intention": "윤세린의 절제된 무대 후 감정",
      "frontendNote": "아티스트 공식 피드 예시"
    }
  ]
}
```

Query: `mode=all|artists|fans|debut`, optional `artistSlug`, `take=1..50`.

Create/delete post:

```http
POST /lumina-feed/posts
DELETE /lumina-feed/posts/:postId
Authorization: Bearer <accessToken>
```

Fan post body:

```json
{ "body": "오늘 최서진 무드 너무 좋다." }
```

Artist post body:

```json
{
  "artistSlug": "choi-seojin",
  "body": "무대는 끝나도 시선은 오래 남아.",
  "visibility": "public"
}
```

If `artistId` or `artistSlug` is provided, the backend requires an active
`artist_operators` row. Normal users can post without an artist field.
`assetIds` is optional on `POST /lumina-feed/posts` and accepts 0-4 unique public image asset UUIDs:

```json
{
  "body": "feed text",
  "assetIds": ["asset-uuid-1", "asset-uuid-2"]
}
```

Assets must already be uploaded/confirmed through the existing asset flow. Pending, archived, private, non-image, duplicate, or unknown assets return `400`.
Feed video upload is not open in MVP. Route video/performance/challenge content to Shortform, not Lumina Feed.

External URL posts use lightweight metadata only:

```http
POST /lumina-feed/link-preview
Authorization: Bearer <accessToken>
```

```json
{ "url": "https://example.com/interview" }
```

The backend validates HTTPS URLs, strips fragments, blocks local/private hostnames, and returns a domain-only preview. It does not crawl remote pages or copy article/media content in MVP:

```json
{
  "preview": {
    "source": "metadata_only",
    "canonicalUrl": "https://example.com/interview",
    "hostname": "example.com",
    "siteName": "example.com",
    "title": null,
    "description": null,
    "imageUrl": null,
    "fetchStatus": "not_fetched_mvp",
    "remoteFetch": "disabled_for_mvp"
  }
}
```

To create a post with a link, send the same URL as `externalUrl`:

```json
{
  "body": "feed text",
  "externalUrl": "https://example.com/interview"
}
```

Post responses include top-level `linkPreview` when an external URL is attached. Frontend should render it as a simple domain/link card for now.
For normal logged-in users, use this image upload flow before creating a feed post:

```http
POST /me/assets/upload-intents
POST /me/assets/:assetId/confirm-upload
Authorization: Bearer <accessToken>
```

Upload intent body:

```json
{
  "fileName": "feed-image.png",
  "mimeType": "image/png",
  "fileSizeBytes": 123456,
  "width": 1024,
  "height": 1024
}
```

Allowed user image MIME types: `image/jpeg`, `image/png`, `image/webp`, `image/gif`.
Default user image max size is `8MB` (`8388608` bytes). If `fileSizeBytes` exceeds the backend limit, expect `413 PAYLOAD_TOO_LARGE` with a user-facing Korean message and `error.details.maxBytes`.
The upload response includes `{ asset, upload }`; send the file with `upload.method`, `upload.url`, and `upload.requiredHeaders`, then confirm. On `local` storage, `upload.mode` is `metadata_only`; on `s3`/`r2`, it is `direct_upload_ready`.
Post responses include `assets` when images are linked:

```json
{
  "assets": [
    {
      "id": "post-asset-link-uuid",
      "role": "attachment",
      "sortOrder": 0,
      "asset": {
        "id": "asset-uuid",
        "assetType": "image",
        "mimeType": "image/png",
        "width": 1024,
        "height": 1024,
        "url": "https://...",
        "thumbnailUrl": "https://...",
        "status": "ready",
        "createdAt": "2026-05-02T00:00:00.000Z"
      }
    }
  ]
}
```
`DELETE /lumina-feed/posts/:postId` soft-deletes the current user's own post and returns `{ "ok": true }`. Artist operators can also delete posts for artists they operate. It does not hard-delete content.

Replies:

```http
GET /lumina-feed/posts/:postId/replies
POST /lumina-feed/posts/:postId/replies
DELETE /lumina-feed/replies/:replyId
Authorization: Bearer <accessToken>
```

`DELETE /lumina-feed/replies/:replyId` soft-deletes the current user's own reply and returns `{ "ok": true }`. Artist operators can also delete replies on their operated artist posts.

Reactions/reports:

```http
POST /lumina-feed/posts/:postId/like
DELETE /lumina-feed/posts/:postId/like
POST /lumina-feed/posts/:postId/report
POST /lumina-feed/posts/:postId/hide
DELETE /lumina-feed/posts/:postId/hide
GET /me/hidden-posts?take=20
Authorization: Bearer <accessToken>
```

`POST /lumina-feed/posts/:postId/hide` is idempotent and returns `{ hiddenPost }`. `DELETE /lumina-feed/posts/:postId/hide` soft-deletes the hidden row and returns `{ ok: true }`. `GET /me/hidden-posts` returns the active hidden rows with each included `post`.

Follows:

```http
POST /artists/:artistId/follow
DELETE /artists/:artistId/follow
POST /users/:userId/follow
DELETE /users/:userId/follow
GET /me/following
GET /me/following-artists?take=20&cursor=<followId>
GET /me/following-users
GET /me/followers
GET /users/:userId/profile
GET /users/handle/:publicHandle/profile
POST /users/handle/:publicHandle/follow
DELETE /users/handle/:publicHandle/follow
POST /users/handle/:publicHandle/block
DELETE /users/handle/:publicHandle/block
POST /users/:userId/block
DELETE /users/:userId/block
GET /me/blocked-users?take=20
Authorization: Bearer <accessToken>
```

`artistId` can be a UUID or slug.
`userId` must be a user UUID and cannot be the current user's own id. `GET /me/following` returns `{ artists, users }`.

`GET /me/following-artists?take=20&cursor=<followId>` returns a My Page card-friendly wrapper:

```json
{
  "items": [
    {
      "id": "<artist uuid>",
      "followId": "<follow row uuid>",
      "slug": "yoon-serin",
      "displayName": "윤세린",
      "name": "윤세린",
      "thumbnailUrl": "https://...",
      "thumbUrl": "https://...",
      "status": "active",
      "type": "시크 퍼포먼스형",
      "followedAt": "2026-05-03T00:00:00.000Z",
      "latestFeedAt": "2026-05-03T00:00:00.000Z",
      "isFollowing": true
    }
  ],
  "artists": [],
  "count": 1,
  "total": 1,
  "nextCursor": null,
  "policy": {
    "hiddenArtistRule": "Only active public artists are returned; draft, archived, deleted, or suspended artists are hidden from My Page follow cards."
  }
}
```

Use `items` as the canonical list. `artists` is provided as a compatibility alias with the same array. If there are no followed active artists, both arrays are empty. User follow rows return `{ id, status, followedAt, updatedAt, user: { id, displayName, publicHandle, avatarUrl } }`.

`GET /users/:userId/profile` is public and returns `{ user, stats, recentPosts }` for active users only. It does not expose email. `user` includes `id`, `displayName`, `publicHandle`, `avatarUrl`, `bio`, and `createdAt`; `stats` includes `followers`, `followingUsers`, `followingArtists`, `posts`, and `replies`. `recentPosts` contains up to 5 public posts by that user.

`GET /users/handle/:publicHandle/profile` returns the same shape as `GET /users/:userId/profile`, but resolves the user by stable unique `publicHandle`. Prefer this endpoint for shareable profile links; keep the UUID endpoint for internal compatibility.

Handle-based follow/block endpoints are also available for shareable profile screens:

```http
POST /users/handle/:publicHandle/follow
DELETE /users/handle/:publicHandle/follow
POST /users/handle/:publicHandle/block
DELETE /users/handle/:publicHandle/block
```

They behave the same as the UUID endpoints, resolving the active user by `publicHandle` first. Use them when the screen URL is already based on `publicHandle`.

Blocking is idempotent. `POST /users/:userId/block` optionally accepts `{ "reason": "spam" }`, unfollows both directions if an active follow exists, and returns `{ block: { id, status, reason, blockedAt, updatedAt, user: { id, displayName, avatarUrl } } }`. `GET /me/blocked-users` returns the same block row shape as a list.

Feed notification triggers:

- `feed.reply`: created when another user replies to the user's post.
- `feed.like`: created when another user likes the user's post for the first time.
- `user.follow`: created when another user follows or re-follows the user.
- Self-actions do not create notifications.
- `PATCH /me/settings` controls delivery: `feedNotifications=false` suppresses `feed.*`; `activityNotifications=false` suppresses `user.follow`.
- Notification rows now include translation metadata and response `i18n` keys so the frontend can render locale-specific titles without changing stored DB text.

Admin/community moderation:

```http
GET /admin/api/v1/backstage/summary
GET /admin/api/v1/backstage/operations/creators?query=&status=&take=20&cursor=<nextCursor>
GET /admin/api/v1/backstage/operations/ai-content-health?query=&status=&take=20&cursor=<nextCursor>
GET /admin/api/v1/backstage/operations/users-overview?query=&email=&status=&take=20&cursor=<nextCursor>
GET /admin/api/v1/backstage/operations/settlement-preview?period=2026-05&query=&status=&take=20&cursor=<nextCursor>
GET /admin/api/v1/community/summary?take=10
GET /admin/api/v1/community/reports?status=submitted&query=abuse&take=50&cursor=<nextCursor>
GET /admin/api/v1/community/posts?status=published&minReports=1&sort=reports&query=keyword&take=50&cursor=<nextCursor>
PATCH /admin/api/v1/community/reports/:reportId
POST /admin/api/v1/community/posts/:postId/hide
POST /admin/api/v1/community/posts/:postId/restore
```

These require admin auth plus `community:read` or `community:write` permission.
They are for admin/operations screens, not public user UI.

`GET /admin/api/v1/backstage/summary` requires admin auth. It is the recommended
Backstage dashboard bootstrap endpoint. It returns:

- `kpis[]`: today signups, today charge orders, open reports, debut applications.
- `alerts[]`: moderation, debut, and payment queues.
- `users`: active/suspended/today counts.
- `payments`: today order count, pending orders, paid count, paid amount.
- `queues`: debut, community report, and hidden post counts.
- `tables.recentDebutApplications`: up to 5 open debut applications.
- `tables.highRiskPosts`: up to 5 reported posts.
- `tables.recentAuditEvents`: up to 8 recent admin audit rows.
- `policy`: Backstage layout hints.

Use this endpoint for the first Backstage screen: left sidebar + KPI cards +
alert bar + two table panels. It is desktop-first and intentionally operational,
not a marketing-style page.

`GET /admin/api/v1/backstage/operations/creators` is the first creator
operations bootstrap endpoint for Backstage. It returns:

- `summary`: open application count, application status counts, active artist
  operator count, AI artist count.
- `applications`: paginated debut application envelope. `items[]` include
  `realName`, `stageName`, `participationType`, `shareTierRequested`,
  `applicationChannel`, `applicationType`, `contactEmail`, `contactPhone`,
  `contactMasked`, `contactAccessAllowed`, `payoutAccountMasked`,
  `payoutAccessAllowed`, `loginType`, `lastSeenAt`, `inactive30Days`,
  `needsFollowUp`, `isNew`, and lightweight `user`.
- `activeCreators`: recent active artist operator rows with masked user email
  unless the admin role can view contact data.
- `aiArtists`: lightweight AI artist rows with counts and `missing[]`.
- `permissions`: current admin's contact/payout visibility flags.
- `policy`: UI hints for masking and future payout model state.

Contact raw values are only for `super_admin`-class access and sales-style
roles. Payout values remain masked until the settlement/payout model lands.

`GET /admin/api/v1/backstage/operations/ai-content-health` is for the AI
content/admin tab. It returns the same page envelope plus `summary` and
`policy`. Each `items[]` row includes:

- `id`, `slug`, `displayName`, `status`, `sortOrder`, `launchedAt`, `updatedAt`.
- `healthStatus`: `ok`, `needs_review`, or `needs_action`.
- `missing[]`: `public_profile`, `visual_profile`, `content_profile`,
  `cover_asset`, `thumbnail_asset`, `gallery_assets`, `shortforms`,
  `chat_persona`.
- `profiles`: public/visual/content readiness booleans.
- `slots.cover`, `slots.thumbnail`, `slots.gallery`: count, primary asset id,
  and primary public URL when available.
- `counts`: assets, shortforms, premium videos, chat personas, gift products,
  followers, community posts.
- `recent`: latest shortforms, premium videos, chat personas, gift products.
- `nextActions[]`: operator-facing action labels for missing items.

MVP policy is slot selection first. Automatic content classification is deferred.

`GET /admin/api/v1/backstage/operations/users-overview` is a Backstage user
operations list. It is richer than `GET /admin/api/v1/users` and is better for
the admin table. It returns the normal page envelope plus `summary` and
`policy`. Each `items[]` row includes:

- identity: `id`, `userId`, `email`, `phoneNumber`, `status`, `displayName`,
  `publicHandle`, `createdAt`, `updatedAt`, `deletedAt`.
- auth/session: `loginType`, `loginTypes[]`, `lastSeenAt`,
  `activeSessionCount`.
- wallet/payment: `walletBalanceLumina`, `walletStatus`, `paymentCount`,
  `paidOrderCount`, `paidAmountKrw`, `lastPaymentOrder`.
- moderation: `authoredPostCount`, `reportSubmittedCount`, `reportCount`,
  `openReportCount`, `latestReportReason`, `latestReportAt`, `sanctionCount`,
  `recentAction`.
- social: `followingArtistCount`, `followingUserCount`, `followerCount`.

Use this for the Backstage user-management table when the UI needs reporting,
wallet, session, and recent action signals in one call. Dangerous actions still
use the existing user mutation endpoints.

`GET /admin/api/v1/backstage/operations/settlement-preview` is an estimated
settlement preview for Backstage. It does not finalize payout and must be
displayed as a preview/estimate. Supported query:

- `period`: `YYYY-MM`, defaults to the current UTC month.
- `query`: artist display name or slug.
- `status`: artist status.
- `take`, `cursor`: normal pagination.
- optional policy overrides for finance testing:
  `unitPriceKrw`, `vatRateBps`, `pgFeeRateBps`, `pgFeeVatRateBps`,
  `aiCostRateBps`, `directCostRateBps`, `settlementRateBps`,
  `platformMinimumMarginBps`.

Each `items[]` row includes:

- `artist`: id, slug, display name, status.
- `creators`: masked operator emails and profile names.
- `eventCount`, `grossLumina`, `productBreakdown`.
- `financials`: gross revenue, VAT, PG fee, PG fee VAT, AI/direct cost,
  net revenue, settlement rate, creator share, platform share, risk reserve.
- `status`: `estimated` or `no_revenue`.
- `holdReason`: currently null.

Included eligible sources for preview:

- completed chat feature orders.
- completed gift orders.
- paid Lumina boost / paid-like events.
- premium video unlocks.

Free likes are intentionally excluded. The response `notice` must be shown in
admin UI or represented with a clear "estimated only" badge. Final payout still
requires normalized creator revenue events, refund/chargeback checks, tax/accounting
review, and admin confirmation.

`GET /admin/api/v1/community/summary` returns grouped report/post counts and
`posts.highRisk` with the most-reported published/hidden posts.

`GET /admin/api/v1/community/posts` supports `status`, `postType`, `artistSlug`,
`authorUserId`, `minReports`, `sort=reports`, `query`, `take`, and `cursor`.

Backstage admin list pagination/search:

```http
GET /admin/api/v1/users?query=&email=&status=&take=20&cursor=<nextCursor>
POST /admin/api/v1/users/:userId/revoke-sessions
GET /admin/api/v1/payment-orders?query=&status=&provider=&userId=&orderNo=&take=20&cursor=<nextCursor>
GET /admin/api/v1/refund-transactions?query=&status=&paymentOrderId=&providerRefundId=&take=20&cursor=<nextCursor>
GET /admin/api/v1/audit-events?query=&actorUserId=&action=&targetType=&targetId=&take=20&cursor=<nextCursor>
```

These list endpoints now return the same page envelope:

```json
{
  "items": [],
  "count": 0,
  "hasMore": false,
  "nextCursor": null
}
```

The frontend should render `items` first. Older fallback code can still tolerate
legacy array responses, but new Backstage code should expect the envelope.
`take` is clamped to 1-100. `cursor` must be a UUID and should be the previous
response's `nextCursor`.

Search support:

- `backstage/operations/creators.query`: applicant name, stage name, contact
  email, user email.
- `backstage/operations/ai-content-health.query`: artist display name or slug.
- `backstage/operations/users-overview.query`: email, phone, display name,
  public handle.
- `backstage/operations/settlement-preview.query`: artist display name or slug.
- `users.query`: email, phone number, profile display name, public handle.
- `payment-orders.query`: order number, provider, user email.
- `refund-transactions.query`: provider refund id, reason, payment order number,
  user email.
- `audit-events.query`: action and target type.
- `community/reports.query`: reason, detail, reported post body, reporter email.
- `community/posts.query`: post body, author email, artist name, artist slug.

`POST /admin/api/v1/users/:userId/revoke-sessions` revokes only active refresh
sessions without changing the user's account status. Body can include
`{ "reason": "operator note" }`. It writes a `user.sessions.revoke` audit event.
Admin suspend/delete still revoke active refresh sessions automatically.

`PATCH /admin/api/v1/community/reports/:reportId` accepts:

```json
{
  "status": "resolved",
  "action": "hide_post",
  "resolveMatchingReports": true,
  "reason": "policy_violation",
  "note": "Hidden after review"
}
```

`action` can be `none`, `hide_post`, or `restore_post`. `resolveMatchingReports:
true` closes other submitted/reviewing reports on the same post as `resolved` or
`dismissed`, according to the selected report status. All mutations write audit
events. If `action` is `hide_post` or `restore_post` and `status` is omitted, the
selected report defaults to `resolved`.

Admin artist operator draft:

```http
GET /admin/api/v1/artists/:artistId/operators
POST /admin/api/v1/artists/:artistId/operators
PATCH /admin/api/v1/artist-operators/:operatorId
```

These require admin auth plus `artists:write`. Artist feed posting only works
when the current user has an active `artist_operators` row for that artist. The
create body accepts `{ "email": "operator@example.com", "role": "owner",
"permissions": ["feed:post", "feed:reply"] }` or `userId` instead of `email`.

## Notes For Claude

- Do not hardcode local-only URLs in production frontend.
- Use the base URL as a single config value.
- Public image URLs return repo/storage keys until `OBJECT_STORAGE_PUBLIC_BASE_URL` is configured. After object storage is configured, the API returns full public asset URLs.
- Backend already has seed data in Render Postgres.
- Initial public seed lineup is 6 characters: `yoon-serin`, `han-seoyul`, `park-doa`, `choi-seojin`, `cha-dohyun`, `seo-yuan`.
- Public gallery assets are seed-driven. After Render runs `npm run render:start:seed`, the current fixed gallery counts should be:
  - `yoon-serin`: 20 gallery images from `reference-final/`
  - `han-seoyul`: 20 gallery images from root `reference-final-01.png` through `reference-final-20.png`
  - `park-doa`: 18 gallery images from `reference-final/`
  - `seo-yuan`: 20 gallery images from root `reference-final-01.png` through `reference-final-20.png`
  - `choi-seojin`: 20 gallery images from root `reference-final-01.png` through `reference-final-20.png`
  - `cha-dohyun`: 20 gallery images from root `reference-final-01.png` through `reference-final-20.png`
- Detail profile facts live under `profile.publicMetadata.profileFacts`.
- If an API returns `401`, the access token is missing or expired.
- If Render is slow on first load, retry once after the service wakes up.

## Human TODO

- Rotate Render Postgres credential because the old database URL was exposed in chat.
- Later configure real object storage, then set `OBJECT_STORAGE_PUBLIC_BASE_URL`.

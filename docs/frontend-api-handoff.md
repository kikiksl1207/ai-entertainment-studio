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

`GET /artists/:slug` is public, but it also accepts an optional
`Authorization: Bearer <accessToken>` header. If the user is signed in, the
detail response includes viewer follow state so the character detail page can
render the follow button without an extra lookup:

```json
{
  "id": "artist-uuid",
  "slug": "yoon-serin",
  "displayName": "Yoon Serin",
  "stats": {
    "followerCount": 123
  },
  "viewer": {
    "isAuthenticated": true,
    "isFollowing": false,
    "canFollow": true,
    "canUnfollow": false
  },
  "policy": {
    "followTarget": "artist_id",
    "followEndpoint": "POST /api/v1/artists/:artistId/follow",
    "unfollowEndpoint": "DELETE /api/v1/artists/:artistId/follow"
  }
}
```

For anonymous users, `viewer.isAuthenticated` is `false` and follow buttons
should route to login. For signed-in users, call the follow endpoints with the
artist `id`, not the slug.

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
- `GET /me` returns the current user plus profile convenience fields: `displayName`, `publicHandle`, `avatarUrl`, `avatarAsset`, `coverImageUrl`, `coverAsset`, `provider`, `providers`, `hasPassword`, `isSocialOnly`, `emailVerified`, `emailVerifiedAt`, `nicknameLastChangedAt`, `nicknameNextChangeAt`, and `canChangeNickname`.
- `PATCH /me/profile` body: `{ "displayName": "닉네임", "bio": "optional", "avatarAssetId": "<asset uuid>", "coverAssetId": "<asset uuid or null>" }`. New accounts receive an auto-assigned temporary `displayName`; users can change it from My Page. `displayName` is 2-20 characters, must be unique, and can be changed once every 30 days after a user change. `coverAssetId: null` resets the public profile cover to the default gradient. The server returns the updated `GET /me` shape. If the nickname cooldown is active, expect `429 Nickname can be changed once every 30 days`. If the nickname is taken, expect `409 DISPLAY_NAME_ALREADY_TAKEN`.
- Display-name availability checks: unauthenticated signup can call `GET /auth/display-name-availability?displayName=닉네임`; signed-in My Page can call `GET /me/profile/display-name-availability?displayName=닉네임`. Both return `{ displayName, available, reason, isCurrentUser, policy }`. On the signed-in endpoint, the current user's existing nickname returns `available: true` with `isCurrentUser: true`.
- Avatar upload policy for 1차: reuse the asset upload flow and then pass the confirmed image asset id as `avatarAssetId`. A dedicated user-facing avatar upload intent can be split out later if needed.
- `GET /me/summary` is the recommended My Page bootstrap endpoint. It returns `{ user, wallet, recentLedger, recentPaymentOrders, activity, recentActivities, debut, policy }` so the frontend does not need to call every history endpoint on first render. `activity` now includes `followingArtists`, `followingUsers`, `followers`, `followCounts`, and `feedCounts`. `activity.followingArtists[]` uses the same My Page card shape as `GET /me/following-artists`.
- `GET /me/trust` returns the current user's trust/role gate state for abuse-sensitive actions. Use this to decide whether to show "identity verification required" messaging before referral rewards, paid support, fan letters, and future creator settlement surfaces. MVP identity verification is advisory and based on phone-number presence until a real identity provider is connected. The response now also includes `settlement.identityVerification`, `settlement.payoutAccount`, and `settlement.payoutException`.
- `GET /rewards/activation-policy` returns the launch reward policy contract: free promotional reward cap 3000L, paid bonus cap 20%, daily attendance schedule, identity/birthday/achievement reward candidates, and abuse notes.
- `GET /rewards/activation-progress` returns the signed-in user's reward progress and cap usage. Use this for My Page/Charge Station reward cards.
- `GET /rewards/ledger-policy` returns the read-only reward ledger skeleton for free Lumina achievements/titles. It includes stable codes, planned grant endpoints, reward amounts, cap scopes, and safety flags; the frontend must not treat it as a client-side grant API.
- `POST /rewards/activation-quests/:code/claim` claims low-risk one-time activation quests after the condition is complete. Claimable MVP codes are `profile_basic_setup`, `first_feed_post`, `first_feed_like`, `first_follow`, and `first_reply`.
- `GET /me/settlement-profile` returns the signed-in creator/artist operator's settlement readiness profile. Use this in Creator Studio before exposing settlement expectation cards. It returns `{ settlementProfile, policy }` with masked identity and payout fields only.
- `PATCH /me/settlement-profile` stores payout readiness fields without storing full account numbers. Body may include `{ "bankName": "은행명", "accountHolderName": "예금주", "accountLast4": "1234", "holderMatchesIdentity": true, "payoutExceptionReason": "optional" }`. The backend stores only `bankName`, masked account holder name, and `accountLast4`. Full bank account numbers, resident numbers, and document files must not be sent to this endpoint.
- `GET /me/settings` returns `{ settings, policy }`.
- `PATCH /me/settings` accepts either flat fields or the My Page nested notification shape. Flat body: `{ "locale": "ko-KR", "timezone": "Asia/Seoul", "marketingOptIn": false, "pushOptIn": false, "activityNotifications": true, "feedNotifications": true, "emailNotifications": false }`. Nested body: `{ "locale": "ko-KR", "timezone": "Asia/Seoul", "notifications": { "activityNotifications": true, "marketingOptIn": false, "feedNotifications": true, "emailNotifications": false } }`. Send at least one effective field. Supported `locale` values are `ko-KR`, `ja-JP`, `en-US`, and `zh-CN`; unsupported values return validation `400`. The response is the same `{ settings, policy }` shape.
- `GET /localization/policy` is public. It reads the request `Accept-Language` header and returns `{ defaultLocale, supportedLocales, detectedLocale, source, fallbackRule, storageEndpoints }`. Use it for anonymous first-load language detection. For logged-in users, prefer `GET /me/settings.settings.locale` first.
- User image upload flow for avatars/profile covers/feed: `POST /me/assets/upload-intents` then upload the file with the returned `upload.method/url/requiredHeaders`, then `POST /me/assets/:assetId/confirm-upload`. The confirmed `asset.id` can be passed to `PATCH /me/profile.avatarAssetId`, `PATCH /me/profile.coverAssetId`, or `POST /lumina-feed/posts.assetIds`.
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
- `GET /me` includes `emailVerified` and `emailVerifiedAt`; successful email verification persists `users.email_verified_at`.

Email delivery contract:

- If no backend mail provider is configured, the two request endpoints return `success: true`, `ok: true`, and `delivery.status = "not_configured"` without revealing whether the email exists.
- If `EMAIL_DELIVERY_PROVIDER` is configured to `resend` or `sendgrid`, the backend attempts to send a one-time verification/reset link using the configured action URL base and returns `success: true`, `ok: true`, and `delivery.status = "accepted"`. Provider delivery failures are also kept neutral on request endpoints so account existence is not exposed.
- Frontend should show the same neutral success copy for both request endpoints, for example "If this email can receive account mail, check your inbox." Do not branch UI on account existence.
- Confirmation endpoints still receive the token from the emailed URL: `POST /auth/email-verifications/confirm` with `{ "token": "<email-token>" }` and `POST /auth/password-resets/confirm` with `{ "token": "<reset-token>", "newPassword": "<new-password>" }`.
- Password reset confirmation revokes active refresh-token sessions, so clients should clear local tokens and send the user back through login after a successful reset.
- Confirmation error responses include stable `error.code` and `error.messageKey` values for frontend copy mapping:
  - `AUTH_EMAIL_VERIFICATION_TOKEN_INVALID_OR_EXPIRED` / `auth.emailVerification.tokenInvalidOrExpired`
  - `AUTH_PASSWORD_RESET_TOKEN_INVALID_OR_EXPIRED` / `auth.passwordReset.tokenInvalidOrExpired`
  - `AUTH_EMAIL_PASSWORD_NOT_CONFIGURED` / `auth.password.emailNotConfigured`
  - `AUTH_USER_NOT_ACTIVE` / `auth.user.notActive`
- Provider API keys, raw tokens, cookies, and environment values must never be rendered, logged, or recorded by the frontend.

For local/staging QA only, the backend can expose the generated action token when `ACTION_TOKEN_DEBUG_ENABLED=true` and `NODE_ENV` is not `production`. Production must keep this disabled. If enabled and the email belongs to an active account, request responses include:

```json
{
  "success": true,
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
GET /lumina-station/charge-policy
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

`GET /lumina-station/charge-policy` is a public read-only policy endpoint for
charge UI copy and package rendering. It does not create payment orders, does
not call an ad SDK, and does not mutate wallets.

Response sample:

```json
{
  "policyVersion": "2026-05-13.charge-policy-v1",
  "currency": {
    "code": "LUMINA",
    "displayNameKo": "루미나",
    "unitPriceKrw": 10,
    "unitLabelKo": "1L = 10원"
  },
  "webCharge": {
    "baseUnitPriceKrw": 10,
    "paidBonusMaxPercent": 20,
    "paymentProviderStatus": "pg_pending",
    "walletMutation": false,
    "orderMutationEnabled": false
  },
  "appCharge": {
    "storePaymentStatus": "iap_pending",
    "mutationEnabled": false,
    "packages": [
      { "sku": "APP_LUMINA_70", "priceKrw": 1000, "luminaAmount": 70, "labelKo": "1,000원 = 70L" },
      { "sku": "APP_LUMINA_350", "priceKrw": 5000, "luminaAmount": 350, "labelKo": "5,000원 = 350L" },
      { "sku": "APP_LUMINA_700", "priceKrw": 10000, "luminaAmount": 700, "labelKo": "10,000원 = 700L" },
      { "sku": "APP_LUMINA_1400", "priceKrw": 20000, "luminaAmount": 1400, "labelKo": "20,000원 = 1,400L" },
      { "sku": "APP_LUMINA_3750", "priceKrw": 50000, "luminaAmount": 3750, "labelKo": "50,000원 = 3,750L" },
      { "sku": "APP_LUMINA_8000", "priceKrw": 100000, "luminaAmount": 8000, "labelKo": "100,000원 = 8,000L" }
    ],
    "deferredPackages": [
      { "priceKrw": 30000, "status": "deferred_after_launch" },
      { "priceKrw": 70000, "status": "deferred_after_launch" }
    ]
  },
  "freeAdCharge": {
    "status": "planned",
    "userFacingLabelKo": "오늘의 무료 루미나 받기",
    "maxRevenueSharePercent": 50,
    "dailyLimit": 50,
    "ledgerSourcePlanned": "ad_reward",
    "sdkConfigured": false,
    "walletMutation": false,
    "claimMutationEnabled": false
  },
  "creatorRequests": {
    "walletMutation": false,
    "orderMutationEnabled": false,
    "products": [
      { "requestType": "gallery_view", "displayNameKo": "공식 갤러리 보기", "priceLumina": 0 },
      { "requestType": "basic_image", "displayNameKo": "기본 이미지 요청", "priceLumina": 30 },
      { "requestType": "premium_image", "displayNameKo": "고급 이미지 요청", "priceLumina": 100 },
      { "requestType": "short_video", "displayNameKo": "짧은 영상 요청", "priceLumina": 300 }
    ],
    "videoPolicy": {
      "durationSeconds": { "min": 3, "max": 5 },
      "characterCount": 1,
      "conceptCount": 1
    }
  },
  "safety": {
    "readOnly": true,
    "secretsReturned": false,
    "walletMutation": false,
    "paymentOrderMutation": false,
    "adSdkMutation": false
  }
}
```

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
GET /me/identity-verifications/policy
POST /me/identity-verifications
POST /me/identity-verifications/self/confirm
GET /chat/starter-prompts?artistSlug=<artistSlug>
GET /chat/persona-seed-policy
GET /chat/character-catalog?artistSlug=<artistSlug>
GET /chat-feature-products
POST /chat-feature-orders/preview
POST /chat-feature-orders
POST /moderation/preview
Authorization: Bearer <accessToken>
```

`GET /chat/starter-prompts` returns the beginner character-chat opening card
contract for an active artist. Pass either `artistSlug` or `artistId`. The
response includes `{ artist, policy, tone, sets, source }`; `sets[].options`
contains the A/B suggested messages and `directInput` is the C/free-text path.
Selecting a starter prompt is free and does not create a chat message by itself.
The frontend sends the chosen `message` through the normal chat message or later
generation flow.

`GET /chat/persona-seed-policy` returns the read-only persona seed/admin contract
for character chat. It includes 20+ Korean personality tags, conflict rules,
random assignment guidance, creator-editable fields, operator-locked fields, and
seed examples. It does not call LLM, does not mutate wallet/chat state, and does
not return secrets.

`GET /chat/character-catalog` returns the read-only DM entry catalog for one
artist. Pass either `artistSlug` or `artistId`. The response includes
`artist`, Korean `status`, `greeting`, `starterOptions`, `directInput`, `tone`,
and `policy`. The policy states that the gallery surface is a conversation-earned
image archive, not a public gallery link, and that short video request remains
hidden/disabled for first launch. Frontend must show Korean copy such as
`labelKo`, `descriptionKo`, `disabledMessageKo`, and must not expose machine keys
such as `chat_ready`, `conversation_archive`, or `mvp_not_open` directly.

Identity verification is a fail-closed NICE-first skeleton for now. The policy
endpoint exposes supported methods (`mobile_phone`, `ipin`), non-secret provider
readiness flags, and account policy flags. `GET /me/trust.accountState` exposes
`signupAllowedWithoutIdentityVerification: true`,
`identityVerificationBeforeSignupRequired: false`, derived `identityVerified`,
`ageBand`, `minor`, `cleanModeRequired`, `ageGate`, and a `cleanMode` flag.
Requesting a verification fails closed with
`IDENTITY_VERIFICATION_PROVIDER_NOT_CONNECTED` and `requestStarted: false` when
the NICE provider is not configured; after provider credentials are configured,
the skeleton request can create or update only an `unverified` marker.
Confirmation returns
`IDENTITY_VERIFICATION_PROVIDER_NOT_CONNECTED` until the real NICE adapter is
contracted and wired. The provider-not-connected response includes
`messageKey = identityVerification.providerNotConnected`; invalid confirmation
paths use `IDENTITY_VERIFICATION_INVALID_ID` with
`messageKey = identityVerification.invalidId`. Frontend copy may show
"본인확인 준비중" or route users to a disabled/coming-soon state, but must not
collect 주민등록번호, raw identity files, NICE raw names/phone numbers, provider
tokens, or API keys. Signup remains open before identity verification; minor
clean mode should be treated as enforced only when the backend reports a verified
provider birth-date minor. Account identity count limits are currently policy
flags only (`enabled: false`, `enforced: false`) and are not connected to wallet,
Lumina, settlement, payout, or paid-like reward mutations.

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
- Fan letter MVP: 30L through the dedicated fan-letter API. Larger 50L/100L
  tiers remain later product-policy candidates, not current frontend contract.
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

Character chat generation readiness:

```http
POST /chat/sessions/:sessionId/generate
Authorization: Bearer <accessToken>
```

Request:

```json
{
  "body": "user message",
  "chatFeatureOrderId": "<optional completed paid order uuid>"
}
```

Response when a provider is not connected:

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
      }
    }
  }
}
```

Preview and order policy now include `policy.generation`. While
`policy.generation.canGenerate` is `false`, the frontend must keep paid chat
generation CTAs disabled. The backend also fails closed before wallet debit for
new LLM-generation orders when the provider is not configured. Usage and model
cost metadata will be stored on generated assistant messages at
`chat_messages.model_metadata`; safety metadata will be stored at
`chat_messages.safety_metadata`.

#203 chat product policy skeleton:

- `GET /chat-feature-products` returns active public chat products only:
  `deep_reply`, `story_reply`, `premium_reply`, and `fan_letter` tiers.
- Each product includes additive `displayName`, `description`, `modelTier`, and
  `policy` fields. Existing IDs, SKU, feature type, price, status, timestamps,
  and metadata remain available.
- `policy.product` describes order/generation flow, preview requirement,
  provider requirement, cost ceiling, input limit, and settlement hints.
- `policy.generation.disabledReason`, `disabledMessageKey`, and
  `disabledDisplayMessageKo` explain disabled states. Do not show raw enum
  values or English keys directly in UI.
- `policy.settlement.creatorShareEligible` is the backend hint for whether the
  completed paid action can later become creator-share input. It is not a final
  payout amount and still requires settlement calculation, fees, taxes, holds,
  refunds, and admin confirmation.
- When the provider is not configured, paid generation/fan-letter order CTAs
  must stay disabled and `POST /chat-feature-orders` remains fail-closed before
  wallet debit.

Canonical product skeleton:

| SKU | Label | Price | Frontend state while provider is missing |
| --- | --- | ---: | --- |
| `CHAT_DEEP_REPLY` | 딥 리플 | 2L | disabled, `chat.generation.providerNotConfigured` |
| `CHAT_STORY_REPLY` | 스토리 리플 | 5L | disabled, `chat.generation.providerNotConfigured` |
| `CHAT_PREMIUM_REPLY` | 프리미엄 리플 | 10L | disabled, `chat.generation.providerNotConfigured` |
| `CHAT_FANLETTER_30` | 스페셜 팬레터 30 | 30L | disabled, async reviewed fan-letter policy |
| `CHAT_FANLETTER_50` | 스페셜 팬레터 50 | 50L | disabled, async reviewed fan-letter policy |
| `CHAT_FANLETTER_100` | 스페셜 팬레터 100 | 100L | disabled, async reviewed fan-letter policy |

Fan letter MVP:

```http
GET /fan-letters/policy
POST /fan-letters/preview
POST /fan-letters
GET /me/fan-letters/sent
GET /me/fan-letters/received
PATCH /me/fan-letters/received/:fanLetterId/status
Authorization: Bearer <accessToken>
```

Create body:

```json
{
  "artistId": "artist-uuid-or-slug",
  "title": "optional title",
  "body": "10-1000 character fan letter",
  "idempotencyKey": "client-generated-key"
}
```

- Current fan-letter price is 30L, equivalent to 300 KRW at 1L = 10 KRW.
- `POST /fan-letters/preview` returns artist, product, wallet balance, and policy.
- `POST /fan-letters` deducts 30L and returns `{ fanLetter, idempotentReplay }`.
- Artist operators use `GET /me/fan-letters/received` in Creator Studio.
- Operator status update supports `submitted`, `seen`, `replied`, and `archived`.
  When setting `replied`, send `replyBody`.
- This is not full direct DM or character chat. Treat it as paid fan-letter inbox
  with optional operator reply.

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

Ranking rows from `GET /popular-vote/main-pick` and
`GET /popular-vote/hall-of-fame/year-champion` now include
`totalPaidLikes`. Use this field for paid-like unit display. Do not derive paid
like count by dividing `totalLuminaBoosts`, because paid-like pricing/discounts
can change separately from the displayed vote-unit count.

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
  "consentMarketing": false,
  "consultationConsent": true
}
```

MVP application channel policy:

- Recommended default: `applicationChannel: "phone_consultation"`.
- `phone_consultation` is the low-friction MVP path. It requires `contactPhone` and `consultationConsent: true`; the operator confirms details by phone after submission.
- `online_review` is available only through the private debut material upload
  contract below. Do not call public feed/profile image upload APIs for debut
  applicant materials.
- The backend stores `applicationChannel`, `preferredContactTime`,
  `consultationConsent`, and `materialSubmissionMode` in application metadata.

Private material upload:

- `POST /api/v1/debut/application-materials/upload-intents`
- `POST /api/v1/debut/application-materials/:assetId/confirm-upload`
- Both endpoints require logged-in user auth and create private
  `debut_application_material` assets. The response intentionally has no public
  URL or signed read URL.
- Supported categories: `face_photo`, `body_motion_reference`, `voice_sample`,
  `dance_video_reference`, `portfolio_attachment`.
- Confirm upload before submitting the application. Unconfirmed asset ids are
  rejected.
- Submit confirmed asset ids with `POST /api/v1/debut/applications` using:
  `facePhotoAssetIds`, `bodyMotionReferenceAssetIds`, `voiceSampleAssetIds`,
  `danceVideoReferenceAssetIds`, and `portfolioAttachmentAssetIds`.
- Richer form fields are `artistDebutMode`, contribution booleans, gender
  policy acceptance flags, categorized asset id arrays, and `portfolioUrls[]`.
  `genderSwapRequested` must be absent or `false`.
- Store and render only returned asset ids/statuses in frontend state. Do not
  persist or display real upload target URLs, signed URLs, tokens, cookies, or
  credentials.
- Share-rate copy must remain estimated. Backend `shareTierRequested` is the
  applicant estimate/request; `shareTierApproved` is the later admin final value.

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

Required consents: `consentAppearance`, `consentRevenuePolicy`, `consentPrivacy`. Optional consents: `consentVoice`, `consentMarketing`.

`consentMarketing` is a top-level optional boolean. Prefer sending it at the top level with the other consent fields. For temporary compatibility, the backend also accepts `metadata.consentMarketing`, but the top-level field is the confirmed frontend contract. Keep real IDs, contracts, and sensitive files outside Notion/Git/chat until the final secure upload/contract process is defined.

Transitional frontend compatibility:

- Canonical field names remain `contactEmail`, `contactPhone`, and `intro`.
- The backend also accepts temporary aliases `applicantEmail`, `applicantPhone`, and `selfIntroduction` so existing static-page wiring does not fail with 400 while the UI is being aligned.
- If `participationType` is omitted, the backend defaults to `appearance_only`.
- If `consentVoice` is omitted, the backend defaults to `false`.
- The frontend should still migrate to the canonical names above; aliases are only a compatibility guard.

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

Admin read-only status candidates are `submitted`, `reviewing`,
`needs_more_info`, `approved_for_contact`, `rejected`, and `archived`. Legacy
`under_review`, `approved`, and `withdrawn` records are normalized in read-only
responses as `reviewing`, `approved_for_contact`, and `archived`.

Admin/operations endpoints for phone consultation queue:

```http
GET /admin/api/v1/debut/applications?status=submitted&applicationChannel=phone_consultation&applicationType=represented_artist&rightsReviewRequired=true&consultationStatus=pending&query=seo&take=50&cursor=<nextCursor>
GET /admin/api/v1/debut/applications/:applicationId
```

Do not hardcode host-root `/admin/api/v1/...` for deployed calls unless the API
base URL already includes `/api/v1`. With the deployed host root as base, the
current external paths are:

```http
GET /api/v1/admin/api/v1/debut/applications?status=submitted&take=50
GET /api/v1/admin/api/v1/debut/applications/:applicationId
```

Backstage/frontends should prefer the shared admin path helper/base convention
for `/admin/api/v1/debut/...`.

List response:

```json
{
  "readOnly": true,
  "statusCandidates": [
    "submitted",
    "reviewing",
    "needs_more_info",
    "approved_for_contact",
    "rejected",
    "archived"
  ],
  "privateMaterialPolicy": {
    "metadataOnly": true,
    "publicUrlReturned": false,
    "signedReadUrlReturned": false,
    "originalFileUrlReturned": false,
    "storageKeyReturned": false
  },
  "items": [],
  "count": 0,
  "hasMore": false,
  "nextCursor": null
}
```

Use `nextCursor` as the next request's `cursor`. `query` searches applicant
name, display name, contact email/phone, intro, and linked user email.

List/detail responses expose masked contact fields plus submitted date,
application channel, application type, material categories, and private material
metadata only. They must not expose private signed URLs, original file URLs,
storage keys, object ETags, secrets, or tokens.

Admin PATCH/status mutation is not open in this contract. If review state
changes are needed, treat them as a separate backend-first mutation contract.

Allowed `consultationStatus`: `pending`, `scheduled`, `contacted`, `no_answer`, `completed`.
Allowed `rightsReviewStatus`: `not_required`, `pending`, `reviewing`, `cleared`, `blocked`.
Allowed `partnerReviewStatus`: `not_applicable`, `pending`, `reviewing`, `accepted`, `declined`.
The consultation, applicant-type, rights-review, and partner-review fields are
stored in `application.metadata` until operations volume proves which fields
deserve real DB columns.

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

### Creator Image Requests

1차 오픈 필수 범위입니다. 승인된 유저 아티스트가 활동용 이미지를 요청하고, 운영자가 Backstage에서 상태를 관리합니다. 자동 이미지 생성은 나중에 붙일 수 있지만, 요청/검수/결과 전달 흐름은 1차에 열어야 합니다.

Creator Studio bootstrap:

```http
GET /me/creator-studio
GET /me/creator-studio/payout-summary?period=2026-05
GET /me/creator-studio/settlement-preview?period=2026-05
PATCH /me/creator-studio/artists/:artistId/profile
Authorization: Bearer <accessToken>
```

Use this as the first call for the creator-studio screen. It returns active artist operator access, public/content/visual profile snapshots, cover/thumb/assets, creator image request counters, and recent image requests.

Account dropdown rule: call this endpoint after login when the UI needs to decide
whether to show `스튜디오 스테이지`. Show that menu item when
`access.enabled === true`. Do not infer creator access from email or admin role.

Creator Studio payout summary:

```http
GET /me/creator-studio/payout-summary?period=2026-05
Authorization: Bearer <accessToken>
```

Use this for the Creator Studio five-card payout UI. It is read-only and does
not open payout, settlement confirmation, wallet debit, wallet credit, PG, IAP,
or NICE flows. Do not show paid/free Lumina separation in this creator-facing
surface.

Response shape:

```json
{
  "period": {
    "label": "2026-05",
    "start": "2026-05-01T00:00:00.000Z",
    "end": "2026-06-01T00:00:00.000Z"
  },
  "currency": "KRW",
  "cards": [
    {
      "id": "grossLumina",
      "labelKey": "creatorStudio.payoutSummary.grossLumina.label",
      "descriptionKey": "creatorStudio.payoutSummary.grossLumina.description",
      "value": "90",
      "unit": "LUMINA",
      "amountLumina": "90",
      "amount": null,
      "currency": null
    },
    {
      "id": "netAmount",
      "labelKey": "creatorStudio.payoutSummary.netAmount.label",
      "descriptionKey": "creatorStudio.payoutSummary.netAmount.description",
      "value": "613.80",
      "unit": "KRW",
      "amountLumina": null,
      "amount": { "amount": "613.80", "currency": "KRW" },
      "currency": "KRW"
    }
  ],
  "totals": {
    "grossLumina": "90",
    "eligibleLumina": "90",
    "grossAmount": { "amount": "634.75", "currency": "KRW" },
    "taxAmount": { "amount": "20.95", "currency": "KRW" },
    "netAmount": { "amount": "613.80", "currency": "KRW" },
    "currency": "KRW",
    "shareRate": { "bps": 8000, "percent": "80" },
    "settlementTier": "general",
    "fxSnapshot": {
      "baseCurrency": "KRW",
      "settlementCurrency": "KRW",
      "snapshotStatus": "krw_base_no_fx",
      "weeklyRefresh": true,
      "rateSource": "weekly_reference_rate_placeholder",
      "baseRate": "1",
      "appliedRate": "1",
      "safeMarginRangeBps": { "min": 300, "max": 500 },
      "appliedSafeMarginBps": 0,
      "capturedAt": null,
      "nextRefreshAt": null
    }
  },
  "artists": [
    {
      "artist": {
        "id": "artist-uuid",
        "slug": "creator-slug",
        "displayName": "Creator Name",
        "status": "active",
        "sortOrder": 100
      },
      "grossLumina": "90",
      "eligibleLumina": "90",
      "grossAmount": { "amount": "634.75", "currency": "KRW" },
      "taxAmount": { "amount": "20.95", "currency": "KRW" },
      "netAmount": { "amount": "613.80", "currency": "KRW" },
      "shareRate": { "bps": 8000, "percent": "80" },
      "settlementTier": "general",
      "policy": { "hidePayoutRow": false, "hideReason": null },
      "status": "estimated"
    }
  ],
  "policy": {
    "readOnly": true,
    "previewOnly": true,
    "payoutMutationOpen": false,
    "walletMutation": false,
    "settlementConfirmationOpen": false,
    "hidePayoutRow": false,
    "sourceBreakdownVisibleToCreator": false,
    "creatorFacingPaidFreeSplit": false,
    "internalSourceVisibility": "backstage_only",
    "defaultCurrency": "KRW"
  },
  "notice": "Estimated read-only payout summary..."
}
```

The five expected card ids are `grossLumina`, `eligibleLumina`, `grossAmount`,
`taxAmount`, and `netAmount`. `settlementTier` is one of `internal`, `staff`,
`general`, or `special`. If `policy.hidePayoutRow === true`, hide the payout
row/card cluster and use `hideReason` for a non-raw UI state.

Creator Studio settlement preview:

```http
GET /me/creator-studio/settlement-preview?period=2026-05
Authorization: Bearer <accessToken>
```

This is the creator-facing earnings estimate. It only returns artists where the
signed-in user has an active `artist_operators` row. It is preview-only and must
not be shown as final payable money.

Included revenue sources:

- `chat`: completed chat feature orders.
- `gift`: completed gift orders.
- `paid_like`: paid Lumina boost / paid-like events.
- `premium_video`: premium video unlocks.
- `fan_letter`: paid fan letters.

Excluded sources:

- free likes.
- refunded fan letters.
- anything outside the selected `period`.

Response shape:

```json
{
  "period": {
    "label": "2026-05",
    "start": "2026-05-01T00:00:00.000Z",
    "end": "2026-06-01T00:00:00.000Z"
  },
  "policy": {
    "unitPriceKrw": "10",
    "vatRateBps": 1000,
    "pgFeeRateBps": 250,
    "pgFeeVatRateBps": 1000,
    "aiCostRateBps": 0,
    "directCostRateBps": 0,
    "settlementRateBps": 8000,
    "platformMinimumMarginBps": 1000,
    "status": "preview_only"
  },
  "items": [
    {
      "artist": {
        "id": "artist-uuid",
        "slug": "creator-slug",
        "displayName": "Creator Name",
        "status": "active",
        "sortOrder": 100
      },
      "operator": {
        "id": "operator-uuid",
        "role": "owner",
        "permissions": []
      },
      "eventCount": 3,
      "grossLumina": "90",
      "productBreakdown": {
        "chat": { "type": "chat", "eventCount": 0, "grossLumina": "0", "grossRevenueKrw": "0" },
        "gift": { "type": "gift", "eventCount": 0, "grossLumina": "0", "grossRevenueKrw": "0" },
        "paid_like": { "type": "paid_like", "eventCount": 0, "grossLumina": "0", "grossRevenueKrw": "0" },
        "premium_video": { "type": "premium_video", "eventCount": 0, "grossLumina": "0", "grossRevenueKrw": "0" },
        "fan_letter": { "type": "fan_letter", "eventCount": 3, "grossLumina": "90", "grossRevenueKrw": "900" }
      },
      "financials": {
        "grossRevenueKrw": "900",
        "vatKrw": "81.81818181818181818182",
        "pgFeeKrw": "22.5",
        "pgFeeVatKrw": "2.25",
        "netRevenueKrw": "793.43181818181818181818",
        "settlementRateBps": 8000,
        "creatorShareKrw": "634.74545454545454545454",
        "platformShareKrw": "79.34318181818181818182",
        "riskReserveKrw": "79.34318181818181818182"
      },
      "status": "estimated"
    }
  ],
  "totals": {
    "eventCount": 3,
    "grossLumina": "90",
    "grossRevenueKrw": "900",
    "netRevenueKrw": "793.43181818181818181818",
    "creatorShareKrw": "634.74545454545454545454",
    "platformShareKrw": "79.34318181818181818182",
    "riskReserveKrw": "79.34318181818181818182"
  },
  "policyNotes": {
    "payoutUnit": "operator_user",
    "previewOnly": true,
    "includedSources": ["chat", "gift", "paid_like", "premium_video", "fan_letter"],
    "excludedSources": ["free_like", "refunded_fan_letter"]
  },
  "notice": "Estimated only..."
}
```

Creator Studio settlement money charge request:

```http
GET /me/creator-studio/settlement-conversions?period=2026-05&status=requested
POST /me/creator-studio/settlement-conversions
Authorization: Bearer <accessToken>
```

Use this for the creator-facing "정산금으로 충전" action. Do not call it "환전" in
the UI. This is request-only: creating a request does not immediately increase
the user's wallet balance. Admin/accounting approval is required before Lumina
is credited.

Request body:

```json
{
  "settlementKey": "artist:<artistId>:2026-05",
  "amountKrw": "1000",
  "note": "optional memo",
  "idempotencyKey": "optional-client-generated-key"
}
```

`settlementKey` must come from the settlement preview surface. For a single
artist card use `artist:<artistId>:YYYY-MM`. For the partner-account aggregate
view use `partner:<partnerUserId>:YYYY-MM`. Minimum `amountKrw` is 1000. Lumina
is calculated as `amountKrw / 10` because the current service policy is 1L = 10
KRW. Existing requests in `requested`, `approved`, or `credited` status reserve
that amount and reduce the remaining requestable estimate.

Create response:

```json
{
  "conversion": {
    "id": "conversion-request-id",
    "settlementKey": "artist:<artistId>:2026-05",
    "settlementType": "artist",
    "period": "2026-05",
    "targetArtistId": "artist-id-or-null",
    "amountKrw": "1000",
    "requestedLumina": "100",
    "status": "requested",
    "note": "optional memo",
    "adminNote": null,
    "walletLedgerId": null,
    "processedByUserId": null,
    "processedAt": null,
    "createdAt": "2026-05-05T00:00:00.000Z",
    "updatedAt": "2026-05-05T00:00:00.000Z",
    "metadata": {
      "source": "creator_studio",
      "previewOnly": true,
      "walletCredit": "admin_approval_required"
    }
  },
  "idempotentReplay": false,
  "policy": {
    "status": "request_only",
    "unitPriceKrw": "10",
    "minAmountKrw": "1000",
    "statuses": ["requested", "approved", "rejected", "credited", "cancelled"],
    "walletCreditTiming": "admin_approval_required",
    "settlementDeductionTiming": "credited_status_only",
    "userFacingName": "정산금으로 충전",
    "forbiddenTerms": ["환전"]
  },
  "notice": "Request received only. Lumina is credited after admin/accounting approval; no wallet balance changed yet."
}
```

If `amountKrw` exceeds the current estimated creator share minus reserved
conversion requests, the backend returns `400` with
`SETTLEMENT_CONVERSION_AMOUNT_EXCEEDS_PREVIEW` and includes
`estimatedAvailableKrw`, `reservedKrw`, and `remainingKrw`.

Frontend display rule: show this as "정산 예상" or "예상 수익" only. Do not label
it as confirmed payout. For zero revenue, show `status: "no_revenue"` rows as
0원 with an empty-state hint.

Response shape:

```json
{
  "access": {
    "enabled": true,
    "type": "personal_creator",
    "status": "approved",
    "entryUrl": "/creator-studio.html"
  },
  "summary": {
    "ownedArtistCount": 1,
    "activeArtistCount": 1,
    "needsAttentionCount": 0,
    "openImageRequestCount": 0,
    "deliveredImageRequestCount": 0,
    "slotLimit": 10,
    "usedSlots": 1,
    "remainingSlots": 9
  },
  "artists": [
    {
      "operator": {
        "id": "operator-uuid",
        "role": "owner",
        "permissions": [],
        "status": "active",
        "createdAt": "2026-05-04T00:00:00.000Z"
      },
      "artist": {
        "id": "artist-uuid",
        "slug": "creator-slug",
        "displayName": "Creator Name",
        "status": "active",
        "publicProfile": {},
        "visualProfile": {},
        "contentProfile": {},
        "coverImage": null,
        "thumbnailImage": null,
        "assets": []
      },
      "imageRequests": {
        "total": 0,
        "open": 0,
        "delivered": 0,
        "rejected": 0,
        "byStatus": {}
      }
    }
  ],
  "imageRequests": {
    "summary": {
      "total": 0,
      "open": 0,
      "delivered": 0,
      "rejected": 0,
      "byStatus": {}
    },
    "recent": []
  },
  "policy": {
    "mode": "creator_studio_bootstrap_v1",
    "canCreateImageRequests": true,
    "slotPolicy": {
      "initialSlotLimit": 10,
      "usedSlots": 1,
      "remainingSlots": 9,
      "canRequestAdditionalArtist": false,
      "additionalArtistRequestMode": "debut_application_or_admin_review",
      "paidSlotExpansionStatus": "planned_not_open"
    },
    "imageRequestTypes": ["profile_image", "content_image"],
    "endpoints": {
      "createImageRequest": "/api/v1/creator-image-requests",
      "imageRequests": "/api/v1/me/creator-image-requests",
      "settlementPreview": "/api/v1/me/creator-studio/settlement-preview",
      "settlementConversions": "/api/v1/me/creator-studio/settlement-conversions",
      "uploadIntent": "/api/v1/me/assets/upload-intents",
      "confirmUpload": "/api/v1/me/assets/:assetId/confirm-upload"
    }
  }
}
```

Creator Studio profile update:

```http
PATCH /me/creator-studio/artists/:artistId/profile
Authorization: Bearer <accessToken>
```

This endpoint is intentionally limited. It requires active artist-operator access and lets a creator update profile/tone fields only. It does not change `displayName`, `slug`, `status`, revenue terms, ownership, public launch state, or assets.

Body can include one or more sections:

```json
{
  "publicProfile": {
    "tagline": "Short public tagline",
    "summary": "Public creator profile summary",
    "personalityKeywords": ["bright", "calm"],
    "publicStory": "Longer public story",
    "publicMetadata": {
      "creatorNote": "non-sensitive metadata only"
    }
  },
  "visualProfile": {
    "visualKeywords": ["clean", "studio"],
    "styleNotes": "Visual direction notes",
    "primaryColor": "#ffffff",
    "secondaryColor": "#111111"
  },
  "contentProfile": {
    "contentTone": "Warm, direct, fan-friendly",
    "allowedTopics": ["daily update", "behind the scenes"],
    "blockedTopics": ["private contact", "external payment"],
    "operatingNotes": "Internal operating tone memo"
  }
}
```

Response:

```json
{
  "artist": {
    "id": "artist-uuid",
    "slug": "creator-slug",
    "displayName": "Creator Name",
    "publicProfile": {},
    "visualProfile": {},
    "contentProfile": {},
    "coverImage": null,
    "thumbnailImage": null,
    "assets": []
  },
  "message": "Creator studio artist profile updated"
}
```

User artist endpoints:

```http
POST /creator-image-requests
GET /me/creator-image-requests?artistId=<artistId>&status=submitted&requestType=profile_image&take=30&cursor=<nextCursor>
GET /creator-image-requests/:requestId
```

Admin endpoints:

```http
GET /admin/api/v1/creator-image-requests?status=submitted&requestType=content_image&query=keyword&take=50&cursor=<nextCursor>
GET /admin/api/v1/creator-image-requests/:requestId
PATCH /admin/api/v1/creator-image-requests/:requestId
```

Rules:

- All user endpoints require login.
- `POST /creator-image-requests` requires the current user to be an active operator of the target `artistId`.
- `referenceAssetIds` should come from the existing user image upload flow: `POST /me/assets/upload-intents` then `POST /me/assets/:assetId/confirm-upload`.
- Do not ask for resident registration numbers, contracts, API keys, or raw identity documents in this flow.
- Admin list/detail require `assets:read`; admin update requires `assets:write`.

Create body:

```json
{
  "artistId": "artist-uuid",
  "requestType": "profile_image",
  "title": "May profile refresh",
  "brief": "Need a clean profile image for the creator studio card.",
  "prompt": "Optional generation prompt or visual direction",
  "referenceAssetIds": ["asset-uuid-1"],
  "metadata": {
    "usage": "creator_profile",
    "preferredMood": "bright"
  }
}
```

Allowed `requestType`: `profile_image`, `content_image`, `feed_image`, `shortform_thumbnail`, `concept_reference`.

Request response shape:

```json
{
  "request": {
    "id": "request-uuid",
    "artistId": "artist-uuid",
    "requesterUserId": "user-uuid",
    "requestType": "profile_image",
    "title": "May profile refresh",
    "brief": "Need a clean profile image for the creator studio card.",
    "prompt": "Optional generation prompt or visual direction",
    "referenceAssetIds": ["asset-uuid-1"],
    "resultAssetIds": [],
    "status": "submitted",
    "moderationStatus": "pending",
    "adminNote": null,
    "rejectionReason": null,
    "metadata": {},
    "artist": {
      "id": "artist-uuid",
      "slug": "creator-slug",
      "displayName": "Creator Name",
      "status": "active"
    },
    "requester": {
      "id": "user-uuid",
      "email": "user@example.com",
      "profile": {
        "displayName": "User nickname",
        "publicHandle": "mint-star-1234",
        "avatarAssetId": null
      }
    },
    "createdAt": "2026-05-04T00:00:00.000Z",
    "updatedAt": "2026-05-04T00:00:00.000Z"
  }
}
```

List response uses the standard cursor envelope: `{ "items": [], "count": 0, "hasMore": false, "nextCursor": null }`.

Admin PATCH body:

```json
{
  "status": "delivered",
  "moderationStatus": "cleared",
  "resultAssetIds": ["asset-uuid-2"],
  "adminNote": "Delivered first profile candidate.",
  "rejectionReason": null,
  "metadata": {
    "operatorMemo": "Use for creator studio profile preview"
  }
}
```

Allowed `status`: `submitted`, `reviewing`, `generating`, `needs_more_info`, `delivered`, `approved`, `rejected`, `archived`.
Allowed `moderationStatus`: `pending`, `cleared`, `blocked`, `needs_review`.

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
GET /lumina-feed/search?q=최서진&type=text&language=ko&take=20
GET /lumina-feed/search?q=%23seojin&type=hashtag&language=all&take=20
GET /lumina-feed/search-suggestions?q=seo&language=all&window=24h&take=8
GET /lumina-feed/trending-searches?language=all&type=all&window=1h&take=10
GET /lumina-feed/trending-searches?language=ko&type=hashtag&window=24h&take=10
GET /lumina-feed/hashtags?language=all&window=24h&take=20
GET /me/lumina-feed?mode=all&take=20
GET /me/lumina-feed?mode=following&take=20
GET /lumina-feed/samples?mode=all&take=20
GET /artists/:slug/posts
```

`GET /me/lumina-feed` uses the same query and post shape as the public feed, but requires `Authorization: Bearer <accessToken>`. It excludes posts hidden by the current user and posts from users who are in an active block relationship with the current user.
`mode=following` is only supported on `GET /me/lumina-feed`. It returns posts from followed artists and followed normal users. If the viewer follows nobody, the response is `[]`.

Feed search:

- `GET /lumina-feed/search` searches public published posts. It returns `{ items, posts, count, nextCursor, query, policy }`, where each item uses the normal feed post shape.
- Query `q` is required. `type` can be `text` or `hashtag`; if omitted, `q` starting with `#` is treated as `hashtag`.
- For `type=hashtag`, send the visible hashtag form in `q`, for example `q=#seojin` or `q=#최서진`. The backend normalizes and searches post bodies for the hashtag.
- `language` accepts `ko`, `ja`, `en`, `zh`, `unknown`, `all`, or locale-like values such as `ko-KR`, `ja-JP`, `en-US`, `zh-CN`. Search events are stored as `ko|ja|en|zh|unknown`; `all` means auto-detect for event storage.
- Optional bearer auth is supported. If the viewer is signed in, returned posts include viewer hints such as `viewer.hasLiked`.
- Each search records a lightweight `feed_search_events` row for trending search aggregation. Same user/session + same keyword/type/language is deduped for 10 minutes.

Search suggestions:

- `GET /lumina-feed/search-suggestions?q=seo&language=all&window=24h&take=8` returns grouped suggestions for the search box.
- `q` is optional. Without `q`, `recentQueries` and `hashtags` can still return discovery chips; `artists` and `users` are empty.
- Response shape: `{ sections: { recentQueries, hashtags, artists, users }, items, query, policy }`.
- `recentQueries[]`: `{ type: "query", keyword, normalizedKeyword, searchType, language, searchCount, lastSearchedAt, searchUrl }`.
- `hashtags[]`: `{ type: "hashtag", keyword, normalizedKeyword, language, postCount, latestPublishedAt, searchUrl }`.
- `artists[]`: `{ type: "artist", id, keyword, slug, displayName, searchUrl }`.
- `users[]`: `{ type: "user", id, keyword, displayName, publicHandle, profileUrl }`.
- `items[]` is the flattened list with a `section` field. Use `sections` for grouped UI and `items` for a single dropdown.

Trending searches:

- `GET /lumina-feed/trending-searches` returns current popular feed search terms from recorded search events.
- `language=all` returns all languages combined. `language=ko|ja|en|zh|unknown` returns that language only.
- `type=all|text|hashtag`; default is all.
- `window=15m|1h|6h|24h|7d`; default is `1h`.
- Response items: `{ rank, keyword, normalizedKeyword, type, language, searchCount, lastSearchedAt }`.
- Recommended 1차 UI: show `language=all` first, then the user's current language tab. Early traffic can make per-language rankings look empty, especially hashtags.

Trending hashtags from posts:

- `GET /lumina-feed/hashtags?language=all&window=24h&take=20` parses hashtags from recent public feed posts. It works even before enough users have searched.
- Response items: `{ rank, keyword, normalizedKeyword, type: "hashtag", language, postCount, latestPublishedAt, searchUrl }`.
- Use this for hashtag chips below the search box or in the right rail. On click, call `GET /lumina-feed/search` with `type=hashtag` and the returned `keyword`.
- This endpoint samples up to the latest 500 public posts in the selected window. It is a lightweight MVP discovery endpoint, not a permanent analytics warehouse.

Backstage feed search analytics:

```http
GET /admin/api/v1/backstage/operations/feed-search-analytics?language=all&type=all&window=1h&take=20
```

- Backstage-only endpoint for search/trending operations monitoring.
- Query: `language=all|ko|ja|en|zh|unknown`, `type=all|text|hashtag`, `window=15m|1h|6h|24h|7d`, optional `query`, `take=1..50`.
- Response includes `summary.totalEvents`, `summary.zeroResultCount`, `summary.zeroResultRate`, grouped `items[]`, and `recentEvents[]`.
- `items[]`: `{ rank, keyword, normalizedKeyword, type, language, searchCount, totalResultCount, averageResultCount, lastSearchedAt }`.
- `recentEvents[]` hides visitor hashes and only exposes userId when signed-in search created the event.

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
GET /me/assets?status=uploaded&take=30
GET /me/assets/:assetId
POST /me/assets/upload-intents
POST /me/assets/:assetId/confirm-upload
POST /me/assets/:assetId/archive
POST /me/assets/:assetId/restore
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
Asset library endpoints:

- `GET /me/assets` lists the signed-in user's uploaded image assets. Query: `status=all|pending_upload|uploaded|ready`, `lifecycleStatus=active|archived`, `take`, `cursor`.
- `GET /me/assets/:assetId` returns `{ asset, usage, policy }`.
- `POST /me/assets/:assetId/archive` marks a user asset archived in metadata. It does not delete the object storage file. If the asset is used as an avatar, published feed image, or creator-image request reference/result, the backend returns `400 ASSET_IN_USE` unless body includes `{ "force": true }`.
- `POST /me/assets/:assetId/restore` returns an archived user asset to active.
- Use confirmed `asset.id` values from this library when building avatar, feed, or creator-image request pickers.

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
`PATCH /lumina-feed/posts/:postId` edits the post body for the current user's own post and returns `{ post, policy }`. MVP edit scope is body-only; image replacement/removal is not supported yet. Body must be 1-500 characters.
Signed-in feed responses from `GET /me/lumina-feed` include `post.viewer` and `post.permissions` hints: `hasLiked`, `isAuthor`, `isFollowingArtist`, `isFollowingAuthor`, `canFollowArtist`, `canUnfollowArtist`, `canFollowAuthor`, `canUnfollowAuthor`, `canEdit`, `canDelete`, and `editScope`. Use these to decide whether to show like, follow, edit, and delete actions. Public `GET /lumina-feed` cannot include viewer-specific state.

Replies:

```http
GET /lumina-feed/posts/:postId/replies
POST /lumina-feed/posts/:postId/replies
DELETE /lumina-feed/replies/:replyId
Authorization: Bearer <accessToken>
```

`DELETE /lumina-feed/replies/:replyId` soft-deletes the current user's own reply and returns `{ "ok": true }`. Artist operators can also delete replies on their operated artist posts.
Reply create responses include `reply.viewer.canDelete` for the signed-in author. Public reply lists are still readable without auth and do not include viewer-specific delete state.

Reactions/reports:

```http
POST /lumina-feed/posts/:postId/like
DELETE /lumina-feed/posts/:postId/like
POST /lumina-feed/posts/:postId/report
POST /moderation/reports
POST /lumina-feed/posts/:postId/hide
DELETE /lumina-feed/posts/:postId/hide
GET /me/hidden-posts?take=20
Authorization: Bearer <accessToken>
```

`POST /lumina-feed/posts/:postId/like` returns `{ reaction, post, idempotentReplay, idempotencyKey }`. `DELETE /lumina-feed/posts/:postId/like` returns `{ ok, removed, post }`. Use the returned `post.viewer.hasLiked` and `post.likeCount` for immediate UI updates.

`POST /lumina-feed/posts/:postId/report` remains the legacy feed-post report endpoint. New UI can use the broader `POST /moderation/reports` endpoint for feed posts, replies, users, and artists:

```json
{
  "targetType": "user",
  "targetId": "target-uuid",
  "reason": "spam",
  "detail": "Optional reporter note, max 500 chars",
  "metadata": {
    "surface": "user_profile"
  }
}
```

Allowed `targetType`: `feed_post`, `community_post`, `reply`, `community_reply`, `user`, `artist`.
Allowed `reason`: `sexual_content`, `harassment`, `hate`, `impersonation`, `spam`, `external_contact`, `external_payment`, `rights_violation`, `other`.
Successful report response: `{ "report": {}, "message": "Report submitted" }`.

`POST /lumina-feed/posts/:postId/hide` is idempotent and returns `{ hiddenPost }`. `DELETE /lumina-feed/posts/:postId/hide` soft-deletes the hidden row and returns `{ ok: true }`. `GET /me/hidden-posts` returns the active hidden rows with each included `post`.

Feed image-only posts are allowed. When `assetIds` contains at least one confirmed public image asset, `POST /lumina-feed/posts` may send `body: ""`. Text-only posts still require a non-empty `body`.

Follows:

```http
POST /artists/:artistId/follow
DELETE /artists/:artistId/follow
POST /users/:userId/follow
DELETE /users/:userId/follow
GET /me/following
GET /me/following-artists?take=20&cursor=<followId>
GET /me/following-users?take=20&cursor=<followId>
GET /me/followers?take=20&cursor=<followId>
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

Follow/unfollow action responses now include UI refresh hints. After a button
click, frontend can update the button and counts from the response without
waiting for a full page reload.

Artist follow response:

```json
{
  "follow": {},
  "artist": {
    "id": "artist-uuid",
    "slug": "yoon-serin",
    "displayName": "Yoon Serin",
    "thumbnailUrl": "https://..."
  },
  "stats": {
    "followerCount": 124
  },
  "viewer": {
    "isAuthenticated": true,
    "isFollowing": true,
    "canFollow": false,
    "canUnfollow": true
  }
}
```

Artist unfollow response:

```json
{
  "ok": true,
  "artist": {
    "id": "artist-uuid",
    "slug": "yoon-serin",
    "displayName": "Yoon Serin"
  },
  "stats": {
    "followerCount": 123
  },
  "viewer": {
    "isAuthenticated": true,
    "isFollowing": false,
    "canFollow": true,
    "canUnfollow": false
  }
}
```

User follow/unfollow responses use the same shape with `user`, `stats`, and
`viewer`. User stats include `followerCount` and `followingCount`.

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

`GET /me/following-users` and `GET /me/followers` now use the same wrapper shape as `GET /me/following-artists`:

```json
{
  "items": [
    {
      "id": "<follow row uuid>",
      "status": "active",
      "followedAt": "2026-05-05T00:00:00.000Z",
      "updatedAt": "2026-05-05T00:00:00.000Z",
      "user": {
        "id": "user-uuid",
        "displayName": "Lumina User",
        "publicHandle": "blue-chair-1234",
        "avatarUrl": "https://..."
      }
    }
  ],
  "users": [],
  "count": 1,
  "total": 1,
  "nextCursor": null
}
```

Use `items` as canonical. `users` is a compatibility alias with the same array.
Cursor is the follow row `id`, not the target user id.

`GET /users/:userId/profile` is public and returns `{ user, stats, recentPosts }` for active users only. It does not expose email. `user` includes `id`, `displayName`, `publicHandle`, `avatarUrl`, `coverImageUrl`, `bio`, and `createdAt`; `stats` includes `followers`, `followingUsers`, `followingArtists`, `posts`, and `replies`. `recentPosts` contains up to 5 public posts by that user. If `coverImageUrl` is `null`, render the local/default gradient cover.

`GET /users/handle/:publicHandle/profile` returns the same shape as `GET /users/:userId/profile`, but resolves the user by stable unique `publicHandle`. Prefer this endpoint for shareable profile links; keep the UUID endpoint for internal compatibility.

User profile pages should use the handle route when possible:

```http
GET /users/handle/:publicHandle/profile
GET /users/handle/:publicHandle/lumina-feed?take=20&cursor=<postId>
Authorization: Bearer <accessToken>  // optional
```

UUID routes are also available:

```http
GET /users/:userId/profile
GET /users/:userId/lumina-feed?take=20&cursor=<postId>
Authorization: Bearer <accessToken>  // optional
```

Profile response additions:

```json
{
  "user": {
    "id": "user-uuid",
    "displayName": "Lumina User",
    "publicHandle": "blue-chair-1234",
    "avatarUrl": "https://...",
    "coverImageUrl": "https://...",
    "bio": "hello",
    "createdAt": "2026-05-05T00:00:00.000Z"
  },
  "stats": {
    "followerCount": 10,
    "followingCount": 5,
    "followingArtistCount": 2,
    "postCount": 12,
    "replyCount": 3,
    "followers": 10,
    "followingUsers": 5,
    "followingArtists": 2,
    "posts": 12,
    "replies": 3
  },
  "viewer": {
    "isAuthenticated": true,
    "isSelf": false,
    "isFollowing": false,
    "canFollow": true,
    "canUnfollow": false,
    "canEditProfile": false
  },
  "recentPosts": []
}
```

`/lumina-feed` user post list response:

```json
{
  "user": {
    "id": "user-uuid",
    "displayName": "Lumina User",
    "publicHandle": "blue-chair-1234",
    "avatarUrl": "https://..."
  },
  "items": [],
  "count": 0,
  "nextCursor": null,
  "viewer": {
    "isAuthenticated": true,
    "isSelf": false,
    "isFollowing": true,
    "canFollow": false,
    "canUnfollow": true
  }
}
```

Rules:

- Public profile and public user posts are readable without login.
- If logged in, pass Authorization so `viewer` can show self/follow state.
- Use `viewer.isSelf` to show "profile edit" linking to My Page.
- Public profile pages must never show email or private account data.
- Block relationship with the viewer returns `403 User profile is not available`.
- User post list returns public, published, non-deleted posts only.
- Cursor pagination uses the post `id` from the last item as `cursor`.

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
GET /admin/api/v1/me
GET /admin/api/v1/backstage/summary
GET /admin/api/v1/backstage/operations/creators?query=&status=&take=20&cursor=<nextCursor>
GET /admin/api/v1/backstage/operations/ai-content-health?query=&status=&take=20&cursor=<nextCursor>
GET /admin/api/v1/backstage/operations/users-overview?query=&email=&status=&take=20&cursor=<nextCursor>
GET /admin/api/v1/backstage/operations/creator-access?query=&email=&artistSlug=&status=&take=20&cursor=<nextCursor>
GET /admin/api/v1/backstage/operations/creator-access/diagnostics?email=<user-email>
POST /admin/api/v1/backstage/operations/creator-access
PATCH /admin/api/v1/backstage/operations/creator-access/:operatorId
GET /admin/api/v1/backstage/operations/settlement-preview?period=2026-05&query=&status=&take=20&cursor=<nextCursor>
GET /admin/api/v1/backstage/operations/partner-settlement-preview?period=2026-05&query=&status=&artistStatus=&take=20&cursor=<nextCursor>
GET /admin/api/v1/community/summary?take=10
GET /admin/api/v1/community/reports?status=submitted&query=abuse&take=50&cursor=<nextCursor>
GET /admin/api/v1/community/posts?status=published&minReports=1&sort=reports&query=keyword&take=50&cursor=<nextCursor>
PATCH /admin/api/v1/community/reports/:reportId
POST /admin/api/v1/community/posts/:postId/hide
POST /admin/api/v1/community/posts/:postId/restore
```

These require admin auth plus `community:read` or `community:write` permission.
They are for admin/operations screens, not public user UI.

`GET /admin/api/v1/me` is the Backstage admin-session check. Call it after
Backstage login to display the current admin role/permissions and to debug
"permission denied" cases without guessing from the UI.

Current seeded admin roles:

- `super_admin`: all permissions.
- `accounting_admin`: payment read, refund write, settlement write, audit read.
- `sales_admin`: creator/debut application read, user read, audit read.
- `cs_admin`: user read, community write, audit read.
- `ai_artist_admin`: artist/assets/shortform/creator-access write, audit read.
- `content_admin`: artist/assets/shortform write, creator read, audit read.
- `commerce_admin`: commerce write, payment read, settlement write, audit read.

Permission rule: `*:write` for the same resource grants read routes too. For
example, `creators:write` can call `creators:read` routes.

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

`GET /admin/api/v1/backstage/operations/creator-access` is the Backstage shortcut
for Creator Studio access. Use it instead of the low-level
`/artists/:artistId/operators` routes when an operator only knows a creator email
and selected artist.

Grant / restore body:

```json
{
  "email": "creator@example.com",
  "artistId": "artist-uuid",
  "role": "owner",
  "status": "active",
  "permissions": [
    "feed:post",
    "feed:reply",
    "image:request",
    "profile:update",
    "settlement:read"
  ],
  "note": "Backstage grant"
}
```

Response item includes `operatorId`, `user`, `artist`, `permissions`,
`canEnterCreatorStudio`, and `creatorStudioUrl`. A creator can enter
`/creator-studio.html` when the user-facing check
`GET /api/v1/me/creator-studio` returns `access.enabled === true`. Direct
artist operation still needs `canEnterCreatorStudio === true`; approved debut
applications can also unlock the studio while they are pending artist-operator
linkage.

If Creator Studio still blocks after granting access, call:

```http
GET /admin/api/v1/backstage/operations/creator-access/diagnostics?email=<user-email>
```

The diagnostics response explains why access is blocked:

- `user_not_found_or_email_mismatch`: the email does not match a real account.
- `user_not_active_or_deleted`: the account cannot enter until restored.
- `no_artist_operator_rows`: grant access first.
- `artist_operator_exists_but_not_active`: patch the operator row to active.
- `approved_debut_application_access_ready`: the user can enter Creator Studio
  because an approved debut application exists, but artist-operator linkage is
  still pending.
- `creator_studio_access_ready`: backend access is ready; if the page still
  blocks, the frontend is likely calling `GET /api/v1/me/creator-studio` without
  the signed-in user's Bearer token or the user needs to sign out/in.

`GET /api/v1/me/creator-studio` also returns `viewer.userId`, `viewer.email`,
`access.reason`, `access.source`, and `access.approvedApplication` to help
compare the signed-in user with the diagnostics row.

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
- `creators`: masked operator emails, profile names, and masked
  `settlementCompliance` hints.
- `eventCount`, `grossLumina`, `productBreakdown`.
- `financials`: gross revenue, VAT, PG fee, PG fee VAT, AI/direct cost,
  net revenue, settlement rate, creator share, platform share, risk reserve.
- `settlementKey`: `artist:<artistId>:YYYY-MM`.
- `status`: `estimated`, `no_revenue`, or the latest manual settlement status.
- `holdReason`: latest manual status reason when present.
- `manualSettlement`: null or the saved manual accounting status record.
- `payoutEligibility`: preview eligibility hints for the Backstage UI. It now
  blocks "mark paid" when revenue exists but no attached creator has a verified
  identity plus registered payout account or approved payout exception.

Included eligible sources for preview:

- completed chat feature orders.
- completed gift orders.
- paid Lumina boost / paid-like events.
- premium video unlocks.
- paid fan letters (`fan_letter`, MVP default 30L each).

Free likes are intentionally excluded. The response `notice` must be shown in
admin UI or represented with a clear "estimated only" badge. Final payout still
requires normalized creator revenue events, refund/chargeback checks, tax/accounting
review, and admin confirmation.

`GET /admin/api/v1/backstage/operations/partner-settlement-preview` is the
partner-account view of the same estimated settlement model. Use it when one
creator/operator account manages multiple AI artists. It groups artist-level
revenue details under the partner account and does not finalize payout.

Supported query:

- `period`: `YYYY-MM`, defaults to the current UTC month.
- `query`: partner email, display name, public handle, artist display name, or slug.
- `status`: partner user status.
- `artistStatus`: optional artist status filter.
- `take`, `cursor`: normal pagination.
- the same optional policy overrides as `settlement-preview`.

Each `items[]` row includes:

- `partner`: masked email, display name, public handle, user status, created date.
- `settlementCompliance`: masked identity, payout account, payout exception,
  and eligibility hints for the partner account.
- `operatedArtistCount`, `approvedArtistCount`,
  `pendingArtistApplicationCount`.
- `artists[]`: artist identity, operator role, event count, gross Lumina,
  product breakdown, financials, preview status, and hold reason.
- `totals`: partner-level total event count, Lumina, gross/net revenue,
  creator share, platform share, and risk reserve.
- `settlementKey`: `partner:<partnerUserId>:YYYY-MM`.
- `payoutStatus`, `payoutHoldReason`, `lastSettlementAt`.
- `manualSettlement`: null or the saved manual accounting status record.
- `payoutEligibility`: preview eligibility hints for the Backstage UI. It uses
  the partner account's masked settlement compliance fields.

The response includes `policyNotes` with `payoutUnit: "partner_user"` and
`detailUnit: "artist"`. Initial candidate slots are 10 and future paid slot
expansion is planned in 5-slot units. UI must show this as preview-only.
The same eligible source list as artist settlement preview is used, including
paid fan letters under `artists[].productBreakdown.fan_letter`.

Settlement money charge admin processing:

```http
GET /admin/api/v1/backstage/settlement-conversions?period=2026-05&type=artist&status=requested&query=&take=20&cursor=<nextCursor>
POST /admin/api/v1/backstage/settlement-conversions/:conversionId/status
```

Use this in Backstage for creator requests created by
`POST /me/creator-studio/settlement-conversions`.

List response:

```json
{
  "items": [
    {
      "id": "conversion-request-id",
      "requesterUserId": "user-id",
      "requester": {
        "id": "user-id",
        "email": "creator@example.com",
        "status": "active",
        "displayName": "Creator",
        "publicHandle": "creator",
        "avatarAssetId": null
      },
      "settlementKey": "artist:<artistId>:2026-05",
      "settlementType": "artist",
      "period": "2026-05",
      "amountKrw": "1000",
      "requestedLumina": "100",
      "status": "requested",
      "note": "creator memo",
      "adminNote": null,
      "walletLedgerId": null,
      "processedByUserId": null,
      "processedAt": null,
      "createdAt": "2026-05-05T00:00:00.000Z",
      "updatedAt": "2026-05-05T00:00:00.000Z"
    }
  ],
  "summary": {
    "period": "2026-05",
    "type": "artist",
    "statusCounts": { "requested": 1 },
    "totalAmountKrw": "1000",
    "totalRequestedLumina": "100"
  }
}
```

Status update body:

```json
{
  "status": "credited",
  "adminNote": "Accounting approved; wallet credited"
}
```

Allowed status updates: `approved`, `rejected`, `credited`, `cancelled`.
`credited` is the only status that creates a Lumina wallet credit. The backend
creates `wallet_ledger.ledgerType = settlement_lumina_conversion`, increments
the user's wallet balance, stores `walletLedgerId`, and writes an audit event.
`approved` only means accounting/operator approval; it does not move Lumina.
`rejected`, `cancelled`, and `credited` are terminal states in the current API.

Manual settlement status update:

```http
GET /admin/api/v1/backstage/settlements?period=2026-05&type=partner&status=paid&query=&take=20&cursor=<nextCursor>
```

Returns manually saved settlement status records. Use this for Backstage
accounting history, "recent settlement actions", and QA after pressing
ready/hold/paid/recheck/cancelled buttons.

Supported query:

- `period`: optional `YYYY-MM`.
- `type`: optional `artist` or `partner`.
- `status`: optional `estimated`, `ready`, `hold`, `paid`, `recheck`, `cancelled`.
- `query`: searches `settlementKey`, `reason`, `note`, and `payoutReference`.
- `take`, `cursor`: normal pagination.

Response shape:

```json
{
  "items": [
    {
      "settlementKey": "partner:<partnerUserId>:2026-05",
      "settlementType": "partner",
      "period": "2026-05",
      "status": "paid",
      "amountKrw": "50000",
      "reason": "manual bank transfer completed",
      "updatedByUserId": "admin-user-id",
      "updatedAt": "2026-05-04T09:00:00.000Z"
    }
  ],
  "summary": {
    "statusCounts": {
      "paid": 1
    }
  }
}
```

Manual settlement detail:

```http
GET /admin/api/v1/backstage/settlements/:settlementKey
```

Use this when the operator opens a settlement-history/detail modal. It returns
the saved record, non-sensitive metadata, and up to 20 recent audit events for
that settlement record.

```json
{
  "record": {
    "settlementKey": "partner:<partnerUserId>:2026-05",
    "status": "paid",
    "amountKrw": "50000",
    "reason": "manual bank transfer completed"
  },
  "metadata": {
    "eligibilityOverrideConfirmed": true
  },
  "auditEvents": [
    {
      "action": "settlement.status.update",
      "actorUserId": "admin-user-id",
      "createdAt": "2026-05-04T09:00:00.000Z"
    }
  ],
  "policy": {
    "manualOnly": true,
    "moneyTransfer": false,
    "auditEventLimit": 20
  }
}
```

```http
POST /admin/api/v1/backstage/settlements/:settlementKey/status
```

Use the `settlementKey` returned by `settlement-preview` or
`partner-settlement-preview`. This endpoint does not transfer money. It records
that an accounting/admin operator manually marked the settlement state after
external review or bank transfer.

Body:

```json
{
  "status": "paid",
  "reason": "2026-05 manual bank transfer completed",
  "note": "Accounting memo",
  "paidAt": "2026-05-04T09:00:00.000Z",
  "paymentMethod": "bank_transfer",
  "payoutReference": "external transfer memo",
  "amountKrw": 50000,
  "eligibilityOverrideConfirmed": true
}
```

Allowed `status`: `ready`, `hold`, `paid`, `recheck`, `cancelled`.
`reason` is required. `amountKrw` is required when status is `paid`.
Until identity verification and payout-account models are connected,
`paid` also requires `eligibilityOverrideConfirmed: true`; the UI should show
this as a manual accounting confirmation, not as automated eligibility.

Success response:

```json
{
  "ok": true,
  "record": {
    "settlementKey": "partner:<partnerUserId>:2026-05",
    "status": "paid",
    "amountKrw": "50000",
    "reason": "2026-05 manual bank transfer completed",
    "updatedAt": "2026-05-04T09:00:00.000Z"
  },
  "policy": {
    "manualOnly": true,
    "moneyTransfer": false,
    "requiresExternalAccountingAction": true
  }
}
```

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
- `backstage/operations/creator-access.query`: creator email/display name/public
  handle, artist display name/slug, or operator role.
- `backstage/operations/settlement-preview.query`: artist display name or slug.
- `backstage/operations/partner-settlement-preview.query`: partner email,
  display name, public handle, artist display name, or artist slug.
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

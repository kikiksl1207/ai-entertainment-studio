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
```

Frontend fields to use:

```txt
slug
displayName
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
- Detail galleries should use `assets.filter((asset) => asset.usageType === "gallery")`.
- Gallery assets are seeded from current operation-pack folders where available:
  - `assets/characters/yoon-serin/reference-final/*`
  - `assets/characters/han-seoyul/reference/*`
  - `assets/characters/park-doa/reference-final/*`
- `reference`, `reference-final`, and `reference-rebuild` folders are not all automatically public. Only assets returned by the API should be shown in the frontend.
- Image URLs may be relative repo/storage keys until object storage is configured. If the URL starts with `assets/`, resolve it from the frontend site origin.

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
GET /me/activity-ledger?type=all&take=50
PATCH /me/profile
GET /me/settings
PATCH /me/settings
PATCH /me/password
DELETE /me
GET /me/sessions
DELETE /me/sessions
DELETE /me/sessions/:sessionId
```

Use `Authorization: Bearer <accessToken>` for authenticated requests.

Auth responses:

- Email-password signup uses email only. Password policy: 8-128 characters, at least one letter and one number.
- `POST /auth/register` and `POST /auth/login` return `{ user, tokens }`.
- `tokens` contains `accessToken`, `refreshToken`, and `tokenType: "Bearer"`.
- For compatibility with the current frontend, auth responses also include top-level `accessToken`, `refreshToken`, and `tokenType` aliases.
- `POST /auth/social/login` accepts `{ "provider": "google" | "kakao" | "naver", "token": "<provider-token>" }`; `accessToken` is also accepted as an alias for `token`.
- Authorization-code handoff is also accepted as `{ "provider": "kakao", "code": "<code>", "redirectUri": "<same-redirect-uri>" }`. The `redirectUri` value must exactly match the URI registered in Kakao Developers and used when the code was issued. The backend may override it with `KAKAO_REDIRECT_URI` in Render to avoid `www`/non-`www` drift.
- Google can send either a Google ID token or OAuth access token. Kakao and Naver should send access tokens when using the token handoff.
- `GET /me` returns the current user plus profile convenience fields: `displayName`, `avatarUrl`, `avatarAsset`, `provider`, `providers`, `hasPassword`, `isSocialOnly`, `nicknameLastChangedAt`, `nicknameNextChangeAt`, and `canChangeNickname`. `emailVerifiedAt` is intentionally omitted for now; email verification remains a backend skeleton until the production DB rollout is explicitly confirmed.
- `PATCH /me/profile` body: `{ "displayName": "닉네임", "bio": "optional", "avatarAssetId": "<asset uuid>" }`. `displayName` can be changed once every 30 days. The server returns the updated `GET /me` shape. If the nickname cooldown is active, expect `400 Nickname can be changed once every 30 days`.
- Avatar upload policy for 1차: reuse the asset upload flow and then pass the confirmed image asset id as `avatarAssetId`. A dedicated user-facing avatar upload intent can be split out later if needed.
- `GET /me/summary` is the recommended My Page bootstrap endpoint. It returns `{ user, wallet, recentLedger, recentPaymentOrders, activity, recentActivities, debut, policy }` so the frontend does not need to call every history endpoint on first render. `activity` now includes `followingArtists`, `followingUsers`, `followers`, `followCounts`, and `feedCounts`.
- `GET /me/settings` returns `{ settings, policy }`.
- `PATCH /me/settings` accepts any subset of `{ "locale": "ko-KR", "timezone": "Asia/Seoul", "marketingOptIn": false, "pushOptIn": false, "activityNotifications": true, "feedNotifications": true, "emailNotifications": false }`. Send at least one field. The response is the same `{ settings, policy }` shape.
- `GET /me/activity-ledger?type=all&take=50` returns a unified recent activity list for My Page. `type` can be `all`, `charge`, `boost`, `unlock`, `gift`, or `free_like`. Each item has `id`, `type`, `title`, `description`, `amountLumina`, `status`, `createdAt`, `relatedArtist`, and `relatedContent`.

My Page scope notes for 2026-05-02:

- Covered now: profile fields, avatar asset display data, nickname cooldown, password/social-only flags, wallet Lumina/Stella display hints, payment order history, unified activity ledger, premium unlocks, boost/free-like activity, following artists, following users, followers, feed counts, debut application card data, notification/settings API, and account deletion/session safety signals.
- Later split if needed: dedicated avatar upload intent for normal users, thumbnail resizing, social-only password setup, blocked users, hidden feed posts, and refund/reversal display details.
- `POST /auth/email-verifications` body: `{ "email": "user@example.com" }`.
- `POST /auth/email-verifications/confirm` body: `{ "token": "<email-token>" }`.
- `POST /auth/password-resets` body: `{ "email": "user@example.com" }`.
- `POST /auth/password-resets/confirm` body: `{ "token": "<reset-token>", "newPassword": "<new-password>" }`.

Email delivery is not connected yet. The two request endpoints currently return `delivery.status = "not_configured"` and never reveal whether the email exists. Once a mail provider is added, the frontend contract can stay the same.

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

- Free like: 1 per day, no Lumina spend.
- Paid like: 1 like unit = 10L. The backend uses the active `BOOST_BASIC_VOTE`
  boost product internally, debits the wallet, writes `wallet_ledger`, and
  creates a `lumina_boost` ranking event in one DB transaction.
- `quantity` defaults to `1` and must be an integer between `1` and `100`.
- Send `Idempotency-Key` header or `idempotencyKey` in the body to avoid
  double spending on retries.

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
    "totalBoostAmount": "10"
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
POST /debut/applications
GET /me/debut-applications
```

Detailed product/policy draft:

- `docs/ai-debut-policy-and-application-spec.md`

Body:

```json
{
  "applicantName": "Applicant legal/name for review",
  "displayName": "Optional public stage/name idea",
  "contactEmail": "user@example.com",
  "contactPhone": "010-0000-0000",
  "isAdult": true,
  "participationType": "appearance_only",
  "shareTierRequested": 30,
  "intro": "Short motivation and concept note",
  "portfolioUrl": "https://example.com/portfolio",
  "consentAppearance": true,
  "consentVoice": false,
  "consentRevenuePolicy": true,
  "consentPrivacy": true
}
```

Allowed `participationType` values:

- `appearance_only`: appearance/image rights only, draft share range 20-30%.
- `voice_or_song`: appearance plus voice or song, draft share range 30-45%.
- `performance`: appearance plus singing/dance/acting performance, draft share range 45-60%.
- `co_creator`: ongoing planning/content/fandom participation, up to 70%.

Required consents: `consentAppearance`, `consentRevenuePolicy`, `consentPrivacy`. Keep real IDs, contracts, and sensitive files outside Notion/Git/chat until the final secure upload/contract process is defined.

Frontend first form sections:

- debut type selection: `appearance_only`, `voice_or_song`, `performance`, `co_creator`
- applicant story/concept
- contact email and optional phone
- requested revenue share, 0-70, with "final share is reviewed separately" notice
- required consent checkboxes
- optional voice/song/performance consent when relevant
- optional marketing/public promotion consent, not required for application review

Do not collect ID card images, resident registration numbers, bank accounts, final contract files, API keys, or secrets in this form.

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
GET /lumina-feed/samples?mode=all&take=20
GET /artists/:slug/posts
```

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
      "body": "리허설이 끝났습니다...",
      "intention": "윤세린의 절제된 무대 후 감정",
      "frontendNote": "아티스트 공식 피드 예시"
    }
  ]
}
```

Query: `mode=all|artists|fans|debut`, optional `artistSlug`, `take=1..50`.

Create post:

```http
POST /lumina-feed/posts
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
  "body": "무대는 짧고, 시선은 오래 남아.",
  "visibility": "public"
}
```

If `artistId` or `artistSlug` is provided, the backend requires an active
`artist_operators` row. Normal users can post without an artist field.

Replies:

```http
GET /lumina-feed/posts/:postId/replies
POST /lumina-feed/posts/:postId/replies
Authorization: Bearer <accessToken>
```

Reactions/reports:

```http
POST /lumina-feed/posts/:postId/like
DELETE /lumina-feed/posts/:postId/like
POST /lumina-feed/posts/:postId/report
Authorization: Bearer <accessToken>
```

Follows:

```http
POST /artists/:artistId/follow
DELETE /artists/:artistId/follow
POST /users/:userId/follow
DELETE /users/:userId/follow
GET /me/following
GET /me/following-artists
GET /me/following-users
GET /me/followers
Authorization: Bearer <accessToken>
```

`artistId` can be a UUID or slug.
`userId` must be a user UUID and cannot be the current user's own id. `GET /me/following` returns `{ artists, users }`; the split endpoints return only that list. User follow rows return `{ id, status, followedAt, updatedAt, user: { id, displayName, avatarUrl } }`.

Admin/community moderation draft:

```http
GET /admin/api/v1/community/reports?status=submitted&take=50
GET /admin/api/v1/community/posts?status=published&take=50
PATCH /admin/api/v1/community/reports/:reportId
POST /admin/api/v1/community/posts/:postId/hide
POST /admin/api/v1/community/posts/:postId/restore
```

These require admin auth plus `community:read` or `community:write` permission.
They are for a later admin/operations screen, not public user UI.

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
- Initial seed lineup is 7 characters after the Seo Yuan asset pack connection: `yoon-serin`, `han-seoyul`, `park-doa`, `choi-seojin`, `oh-hyerin`, `cha-dohyun`, `seo-yuan`.
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

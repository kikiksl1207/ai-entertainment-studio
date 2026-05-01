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
PATCH /me/password
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
- `GET /me` returns the current user. `emailVerifiedAt` is intentionally omitted for now; email verification remains a backend skeleton until the production DB rollout is explicitly confirmed.
- `POST /auth/email-verifications` body: `{ "email": "user@example.com" }`.
- `POST /auth/email-verifications/confirm` body: `{ "token": "<email-token>" }`.
- `POST /auth/password-resets` body: `{ "email": "user@example.com" }`.
- `POST /auth/password-resets/confirm` body: `{ "token": "<reset-token>", "newPassword": "<new-password>" }`.

Email delivery is not connected yet. The two request endpoints currently return `delivery.status = "not_configured"` and never reveal whether the email exists. Once a mail provider is added, the frontend contract can stay the same.

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
GET /boost-campaigns/current
GET /boost-products
GET /premium-videos
GET /chat-feature-products
GET /artists/:artistId/gift-products
```

## Notes For Claude

- Do not hardcode local-only URLs in production frontend.
- Use the base URL as a single config value.
- Public image URLs return repo/storage keys until `OBJECT_STORAGE_PUBLIC_BASE_URL` is configured. After object storage is configured, the API returns full public asset URLs.
- Backend already has seed data in Render Postgres.
- Initial public lineup is 6 characters, not 4.
- Detail profile facts live under `profile.publicMetadata.profileFacts`.
- If an API returns `401`, the access token is missing or expired.
- If Render is slow on first load, retry once after the service wakes up.

## Human TODO

- Rotate Render Postgres credential because the old database URL was exposed in chat.
- Later configure real object storage, then set `OBJECT_STORAGE_PUBLIC_BASE_URL`.

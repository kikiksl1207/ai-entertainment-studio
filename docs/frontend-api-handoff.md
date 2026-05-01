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
POST /auth/refresh
POST /auth/logout
GET /me
```

Use `Authorization: Bearer <accessToken>` for authenticated requests.

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

# Lumina Stage Frontend API Handoff

## Base URL

Production backend:

```txt
https://lumina-stage-api.onrender.com/api/v1
```

Local backend:

```txt
http://localhost:3001/api/v1
```

Render free instances can sleep. The first request after inactivity may take 30-60 seconds.

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

Known MVP slugs:

```txt
yoon-serin
han-seoyul
park-doa
choi-seojin
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
- Public image URLs currently return repo/storage keys until a real object storage public base URL is configured.
- Backend already has seed data in Render Postgres.
- If an API returns `401`, the access token is missing or expired.
- If Render is slow on first load, retry once after the service wakes up.

## Human TODO

- Rotate Render Postgres credential because the old database URL was exposed in chat.
- Later configure real object storage, then set `ASSET_PUBLIC_BASE_URL`.

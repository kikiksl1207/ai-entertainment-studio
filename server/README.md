# Lumina Stage Server

NestJS + PostgreSQL + Prisma backend for Lumina Stage.

## Stack

- Node.js 22+
- NestJS
- PostgreSQL
- Prisma

## Local Setup

1. Install dependencies.

```bash
cd server
npm install
```

2. Create `.env` from the sample and edit the database URL.

```bash
cp .env.example .env
```

3. Set strong local secrets in `.env`.

```bash
JWT_ACCESS_SECRET="<at-least-32-random-characters>"
JWT_REFRESH_SECRET="<different-at-least-32-random-characters>"
```

Never commit real secrets, API keys, database passwords, JWT secrets, or PG webhook secrets.

4. Create a local PostgreSQL database named `lumina_stage`.

5. Apply the initial migration.

```bash
npm run prisma:deploy
```

6. Generate Prisma Client.

```bash
npm run prisma:generate
```

7. Start the API server.

```bash
npm run start:dev
```

The server listens on `http://localhost:3001` by default.

## Public API Skeleton

- `GET /api/v1/artists`
- `GET /api/v1/artists/:slug`
- `GET /api/v1/shortforms`
- `GET /api/v1/lumina-products`

## Wallet API Skeleton

User-scoped endpoints require an access token from `POST /api/v1/auth/login` or `POST /api/v1/auth/register`.

Auth endpoints:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/me`

- `GET /api/v1/wallet`
- `GET /api/v1/wallet/ledger?take=50`
- `POST /api/v1/wallet/test-grant`

Local test grant example:

```bash
curl -X POST http://localhost:3001/api/v1/wallet/test-grant \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access-token>" \
  -H "Idempotency-Key: local-test-001" \
  -d "{\"amount\":100,\"memo\":\"local seed grant\"}"
```

## Gift And Boost MVP APIs

Gift endpoints:

- `GET /api/v1/artists/:artistId/gift-products`
- `POST /api/v1/gift-orders`
- `GET /api/v1/artists/:artistId/gift-progress`
- `GET /api/v1/artists/:artistId/reaction-events`
- `GET /api/v1/artists/:artistId/equipped-items`

Boost endpoints:

- `GET /api/v1/boost-campaigns/current`
- `GET /api/v1/boost-campaigns/:campaignId/rankings`
- `POST /api/v1/boost-campaigns/:campaignId/free-like`
- `GET /api/v1/boost-products`
- `POST /api/v1/boost-orders`
- `GET /api/v1/me/boost-events`

Gift orders and paid boost orders debit `wallet_accounts.cached_balance` and create `wallet_ledger` entries inside the same transaction. Free likes and paid boost events are stored in `artist_boost_events`; rankings read the latest snapshot when present and otherwise aggregate live events.

All user-scoped gift and boost mutation APIs use `Authorization: Bearer <access-token>`. API secrets and payment provider secrets must stay in environment variables only.

## Premium Video And Chat MVP APIs

Premium video endpoints:

- `GET /api/v1/premium-videos`
- `GET /api/v1/premium-videos/:productId`
- `POST /api/v1/premium-videos/:productId/unlock`
- `GET /api/v1/me/premium-video-unlocks`

Chat endpoints:

- `POST /api/v1/chat/sessions`
- `GET /api/v1/chat/sessions`
- `GET /api/v1/chat/sessions/:sessionId/messages`
- `POST /api/v1/chat/sessions/:sessionId/messages`
- `GET /api/v1/chat-feature-products`
- `POST /api/v1/chat-feature-orders`

Premium video unlocks and paid chat feature orders debit `wallet_accounts.cached_balance` and write `wallet_ledger` records in the same transaction. Premium video access is also recorded in `user_premium_video_unlocks` and `user_entitlements`.

## Database Notes

The first Prisma migration is copied from `../docs/postgresql-schema.sql` so the implementation stays aligned with the current backend/DB design document. The Prisma schema currently maps the public read models needed for the first API slice: artists, artist profiles, assets, artist assets, shortforms, and shortform assets. Commerce, wallet, gift, boost, premium video, and chat models remain in the SQL migration and can be added to `schema.prisma` as their API modules are implemented.

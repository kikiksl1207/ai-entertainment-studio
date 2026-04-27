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

7. Seed MVP content and products.

```bash
npm run prisma:seed
```

The seed script inserts the first 4 public artists, local image asset references, shortforms, Lumina products, gift products, the launch boost campaign, premium video products, and chat feature products. The script is idempotent and can be rerun after changing seed values.

8. Start the API server.

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
- `POST /api/v1/auth/social/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/me`

Social login accepts `{ "provider": "google" | "kakao" | "apple", "token": "<provider-token>" }`.
Google and Apple expect identity tokens; Kakao expects an access token. The server verifies the provider token before creating or linking a `user_auth_accounts` row, and only verified provider emails can be used to link an existing email account. Configure `GOOGLE_OAUTH_CLIENT_ID`, `KAKAO_REST_API_KEY`, and `APPLE_CLIENT_ID` in `.env`; if a provider is not configured, its login endpoint fails closed.

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

## Payment Order MVP APIs

Payment endpoints:

- `POST /api/v1/payments/orders`
- `GET /api/v1/payments/orders/:orderId`
- `POST /api/v1/payments/webhooks/:provider`

Payment flow:

1. The client calls `POST /api/v1/payments/orders` with a `luminaProductId`.
2. The server creates a `payment_orders` row and returns provider checkout payload data.
3. The client opens the PG checkout using provider data.
4. Lumina is not credited from a client-side success claim.
5. The server credits Lumina only after `POST /api/v1/payments/webhooks/:provider` verifies and parses a provider event.
6. A successful provider event writes `payment_transactions`, marks the order `paid`, credits `wallet_accounts.cached_balance`, and records a `wallet_ledger` purchase entry in one transaction.

The current provider adapter is `mock`, which is safe for local development and keeps the production integration seam ready for Toss Payments, PortOne, or another PG later. Provider secrets must remain in environment variables such as `MOCK_PAYMENT_WEBHOOK_SECRET`; real provider keys should never be committed.

## Admin MVP APIs

Admin endpoints use `Authorization: Bearer <access-token>` and require the user's email to be listed in `ADMIN_EMAILS`.

- `GET /admin/api/v1/audit-events`
- `POST /admin/api/v1/assets`
- `POST /admin/api/v1/artists`
- `PATCH /admin/api/v1/artists/:artistId`
- `POST /admin/api/v1/shortforms`
- `PATCH /admin/api/v1/shortforms/:shortformId`
- `POST /admin/api/v1/lumina-products`
- `PATCH /admin/api/v1/lumina-products/:productId`
- `POST /admin/api/v1/gift-products`
- `PATCH /admin/api/v1/gift-products/:productId`
- `POST /admin/api/v1/boost-products`
- `PATCH /admin/api/v1/boost-products/:productId`
- `POST /admin/api/v1/boost-campaigns`
- `PATCH /admin/api/v1/boost-campaigns/:campaignId`
- `POST /admin/api/v1/boost-campaigns/:campaignId/snapshot`
- `POST /admin/api/v1/premium-video-products`
- `PATCH /admin/api/v1/premium-video-products/:productId`
- `POST /admin/api/v1/chat-feature-products`
- `PATCH /admin/api/v1/chat-feature-products/:productId`

Admin create/update/snapshot mutations write `audit_events` rows with actor, action, target, before data, and after data. `GET /admin/api/v1/audit-events` can filter by `actorUserId`, `action`, `targetType`, and `targetId`; `take` defaults to 50 and is capped at 100.

The current admin guard is intentionally simple: it checks JWT identity against `ADMIN_EMAILS`. A future hardening pass should replace this with `admin_users` / `admin_roles` tables and richer role permissions.

## Database Notes

The first Prisma migration is copied from `../docs/postgresql-schema.sql` so the implementation stays aligned with the current backend/DB design document. The Prisma schema currently maps the public read models needed for the first API slice: artists, artist profiles, assets, artist assets, shortforms, and shortform assets. Commerce, wallet, gift, boost, premium video, and chat models remain in the SQL migration and can be added to `schema.prisma` as their API modules are implemented.

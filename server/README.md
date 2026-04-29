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

Refresh tokens are stored as SHA-256 hashes in `user_refresh_tokens`. `POST /api/v1/auth/refresh` rotates the refresh token and revokes the previous one; `POST /api/v1/auth/logout` accepts `{ "refreshToken": "..." }` and revokes that token server-side. Access tokens remain short-lived and are not individually revoked.

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
2. The server creates a `payment_orders` row with the selected `provider` and returns provider checkout payload data.
3. The client opens the PG checkout using provider data.
4. Lumina is not credited from a client-side success claim.
5. The server credits Lumina only after `POST /api/v1/payments/webhooks/:provider` verifies and parses a provider event.
6. A successful provider event writes `payment_transactions`, marks the order `paid`, credits `wallet_accounts.cached_balance`, and records a `wallet_ledger` purchase entry in one transaction.

The order's stored provider must match the webhook provider before any wallet credit is created. The current provider adapter is `mock`, which is safe for local development and keeps the production integration path ready for Toss Payments, PortOne, or another PG later. Provider secrets must remain in environment variables such as `MOCK_PAYMENT_WEBHOOK_SECRET`; real provider keys should never be committed.

Payment webhook handlers preserve the raw request body so real PG adapters can verify provider signatures against the exact payload received from the provider.

Paid webhook handling uses an atomic order-status transition before crediting Lumina. If the order is already `paid`, repeated or competing webhooks are treated as idempotent replays and do not create another wallet credit.

## Admin MVP APIs

Admin endpoints use `Authorization: Bearer <access-token>`.

Admin access is now DB-backed through `admin_users` and `admin_roles`. `ADMIN_EMAILS` remains as a bootstrap fallback so the first trusted operator can log in and create DB admin users.

- `GET /admin/api/v1/admin-roles`
- `GET /admin/api/v1/admin-users`
- `POST /admin/api/v1/admin-users`
- `PATCH /admin/api/v1/admin-users/:adminUserId`
- `GET /admin/api/v1/audit-events`
- `GET /admin/api/v1/payment-orders`
- `GET /admin/api/v1/payment-orders/:orderId`
- `POST /admin/api/v1/payment-orders/:orderId/refunds`
- `GET /admin/api/v1/refund-transactions`
- `PATCH /admin/api/v1/refund-transactions/:refundId`
- `GET /admin/api/v1/assets`
- `GET /admin/api/v1/assets/:assetId`
- `POST /admin/api/v1/assets`
- `POST /admin/api/v1/assets/upload-intents`
- `POST /admin/api/v1/assets/:assetId/confirm-upload`
- `POST /admin/api/v1/assets/:assetId/archive`
- `POST /admin/api/v1/assets/:assetId/restore`
- `POST /admin/api/v1/artists`
- `PATCH /admin/api/v1/artists/:artistId`
- `POST /admin/api/v1/artists/:artistId/assets`
- `DELETE /admin/api/v1/artists/:artistId/assets/:artistAssetId`
- `POST /admin/api/v1/shortforms`
- `PATCH /admin/api/v1/shortforms/:shortformId`
- `POST /admin/api/v1/shortforms/:shortformId/assets`
- `DELETE /admin/api/v1/shortforms/:shortformId/assets/:shortformAssetId`
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
- `POST /admin/api/v1/premium-video-products/:productId/assets`
- `DELETE /admin/api/v1/premium-video-products/:productId/assets/:premiumVideoAssetId`
- `POST /admin/api/v1/chat-feature-products`
- `PATCH /admin/api/v1/chat-feature-products/:productId`

Admin create/update/snapshot mutations write `audit_events` rows with actor, action, target, before data, and after data. `GET /admin/api/v1/audit-events` can filter by `actorUserId`, `action`, `targetType`, and `targetId`; `take` defaults to 50 and is capped at 100.

Asset archive/restore is metadata-based. Archive does not delete object storage files; it marks `metadata.lifecycle.status` as `archived`, blocks future linking, and removes the asset from public artist/shortform responses.

Seeded roles:

- `super_admin`: full admin access, can create/update admin users.
- `content_admin`: content and artist operations.
- `commerce_admin`: product, payment, gift, boost, premium video operations.

Admin refund APIs create and track refund records only. Actual PG refund execution should be implemented in the provider adapter after the production PG is selected.

For the first admin:

1. Add the trusted account email to `ADMIN_EMAILS`.
2. Log in and call `POST /admin/api/v1/admin-users` with that user's `email` or `userId` and `roleName`.
3. Remove or narrow `ADMIN_EMAILS` once DB admin users are configured.

## Object Storage Verification

After `OBJECT_STORAGE_*` environment variables are configured, verify S3/R2 upload flow with:

```powershell
$env:API_BASE_URL="https://lumina-stage-api.onrender.com"
$env:ADMIN_ACCESS_TOKEN="<admin access token>"
npm.cmd run verify:object-storage
```

The script creates an upload intent, uploads a generated 1x1 PNG to the presigned URL, confirms the upload, and reads back the asset.

## Database Notes

The first Prisma migration is copied from `../docs/postgresql-schema.sql` so the implementation stays aligned with the current backend/DB design document. The Prisma schema currently maps the public read models needed for the first API slice: artists, artist profiles, assets, artist assets, shortforms, and shortform assets. Commerce, wallet, gift, boost, premium video, and chat models remain in the SQL migration and can be added to `schema.prisma` as their API modules are implemented.

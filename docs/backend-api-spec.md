# Lumina Stage Backend API Spec

## Recommended Stack

1차 상용 백엔드는 다음 조합을 추천한다.

- Runtime: Node.js
- Framework: NestJS
- DB: PostgreSQL
- ORM / migration: Prisma 또는 Drizzle
- Auth: JWT + refresh token, 추후 OAuth provider 연결
- Storage: S3 호환 스토리지, 초기 로컬 개발은 local adapter
- Payment: PG provider adapter를 별도 모듈로 분리

NestJS를 추천하는 이유는 도메인 분리가 명확하고, 결제/지갑/선물/챗처럼 트랜잭션 경계가 중요한 서비스에서 모듈 단위 관리가 쉽기 때문이다.

## API Principles

- 공개 조회 API와 사용자 인증 API를 분리한다.
- 루미나 증감은 반드시 wallet service를 통해서만 처리한다.
- 결제, 선물, 부스트, 프리미엄 해금, 챗 특수 기능 주문은 `Idempotency-Key` 헤더를 받는다.
- 클라이언트가 결제 성공을 주장해도 서버는 PG transaction/webhook으로만 확정한다.
- 관리자/운영 API는 `/admin` namespace로 분리한다.

## Public APIs

### Characters

```http
GET /api/v1/artists
GET /api/v1/artists/:artistSlug
GET /api/v1/artists/:artistSlug/assets
```

Frontend-friendly response fields:

- `slug`, `displayName`, `profile`, `visual`
- `coverImage.url`, `thumbnailImage.url`
- `assets[].url`, `assets[].usageType`
- Public responses only expose uploaded/ready assets.
- Public responses do not expose internal asset `metadata`, `storageKey`, or `storageProvider`.

용도:

- 캐릭터 목록
- 캐릭터 상세
- 공개 이미지/썸네일/갤러리 조회

### Shortforms

```http
GET /api/v1/shortforms
GET /api/v1/shortforms/:shortformSlug
POST /api/v1/shortforms/:shortformId/view
```

Frontend-friendly response fields:

- `slug`, `title`, `description`, `artist`
- `thumbnail.url`
- `assets[].url`, `assets[].role`
- Public responses only expose uploaded/ready assets.
- Public responses do not expose internal asset `metadata`, `storageKey`, or `storageProvider`.

용도:

- 일반 무료 숏폼 조회
- 조회수/시청 이벤트 기록

### Rankings / Main Picks

```http
GET /api/v1/boost-campaigns/current
GET /api/v1/boost-campaigns/:campaignId/rankings
GET /api/v1/main-picks/current
GET /api/v1/unlock-campaigns
```

용도:

- 현재 진행 중인 좋아요/부스트 캠페인 조회
- 캐릭터 랭킹 조회
- 메인에 걸릴 캐릭터 조회
- 회사 차원의 특별 해금 이벤트 조회

## User APIs

### Auth / Me

```http
POST /api/v1/auth/register
POST /api/v1/auth/login
GET /api/v1/auth/social/providers
POST /api/v1/auth/social/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
POST /api/v1/auth/email-verifications
POST /api/v1/auth/email-verifications/confirm
POST /api/v1/auth/password-resets
POST /api/v1/auth/password-resets/confirm
GET /api/v1/me
PATCH /api/v1/me/password
DELETE /api/v1/me
GET /api/v1/me/sessions
DELETE /api/v1/me/sessions
DELETE /api/v1/me/sessions/:sessionId
PATCH /api/v1/me/profile
PATCH /api/v1/me/settings
```

이메일/비밀번호 가입 정책:

- 이메일 기반 가입만 지원한다.
- 비밀번호는 8-128자, 영문 1개 이상, 숫자 1개 이상이어야 한다.

이메일 인증/비밀번호 재설정:

- `user_action_tokens`에 원문 토큰 대신 SHA-256 해시만 저장한다.
- 이메일 인증 토큰 만료는 24시간, 비밀번호 재설정 토큰 만료는 1시간이다.
- 요청 API는 계정 존재 여부를 노출하지 않기 위해 항상 `ok: true` 형태로 응답한다.
- 현재는 메일 발송 adapter가 없는 skeleton 상태이며 `delivery.status = "not_configured"`를 반환한다.
- 실제 메일 provider 연결 전까지 raw token을 로그, Git, Notion, 채팅에 남기지 않는다.

Account deletion / moderation policy:

- `DELETE /api/v1/me` soft-deletes the current account. Email-password accounts must send `currentPassword`; social-only accounts may omit it.
- Account deletion sets `users.status = deleted`, sets `deleted_at`, revokes all refresh-token sessions, consumes outstanding user action tokens, deactivates the user's referral code, and writes a `user.self_delete` audit event.
- Wallet ledgers, payment orders, gift records, and audit history are retained.
- Admin moderation endpoints are available under `/admin/api/v1/users`: list/detail/suspend/restore/delete.
- Suspension sets `users.status = suspended` and revokes sessions. Restore sets `users.status = active` and clears `deleted_at`; it does not restore old refresh tokens.
- `JwtAuthGuard` checks the current DB user status on protected requests, so suspended/deleted accounts cannot continue using old access tokens.

### Wallet / Lumina

```http
GET /api/v1/wallet
GET /api/v1/wallet/ledger
GET /api/v1/lumina-products
POST /api/v1/payments/orders
GET /api/v1/payments/orders/:orderId
POST /api/v1/payments/webhooks/:provider
```

중요:

- `POST /payments/orders`는 결제 주문만 만든다.
- `payment_orders.provider`에 주문 생성 시점의 PG provider를 저장한다.
- 실제 루미나 지급은 결제 성공 transaction이 확정된 뒤 `wallet_ledger`에 credit으로 기록한다.
- 웹훅은 provider별 signature 검증이 필수다.
- 웹훅 signature 검증은 파싱된 JSON이 아니라 raw request body를 기준으로 처리할 수 있어야 한다.
- 웹훅 provider와 주문 provider가 다르면 결제를 확정하지 않는다.
- 결제 성공 웹훅은 주문 row의 상태를 조건부로 `paid` 전환한 요청만 루미나 지급까지 진행한다.
- 이미 `paid`인 주문에 대한 웹훅 재전송이나 중복 이벤트는 idempotent replay로 처리하고 추가 지급하지 않는다.
- Payment and refund state transitions are documented in `docs/payment-refund-state-policy.md`.

### Gifts

```http
GET /api/v1/artists/:artistId/gift-products
POST /api/v1/gift-orders
GET /api/v1/artists/:artistId/gift-progress
GET /api/v1/artists/:artistId/reaction-events
GET /api/v1/artists/:artistId/equipped-items
```

주문 흐름:

1. 클라이언트가 선물 상품과 수량을 선택한다.
2. 서버가 지갑 잔액을 확인한다.
3. `wallet_ledger`에 `gift_spend` debit을 기록한다.
4. `gift_orders`를 completed로 만든다.
5. 일반 선물은 `artist_reaction_events`를 생성한다.
6. 프리미엄 선물은 `artist_gift_progress`를 증가시키고, 목표치 도달 시 해금/장착 처리를 한다.

### Boosts

```http
POST /api/v1/boost-campaigns/:campaignId/free-like
GET /api/v1/boost-products
POST /api/v1/boost-orders
GET /api/v1/me/boost-events
```

무료 좋아요:

- 하루 제한은 `boost_campaigns.daily_free_like_limit`로 제어한다.
- `artist_boost_events.boost_type = 'free_like'`로 기록한다.

유료 부스트:

- 루미나로 구매한다.
- `wallet_ledger.ledger_type = 'boost_spend'` debit을 만든다.
- `artist_boost_events.boost_type = 'lumina_boost'`로 기록한다.
- 랭킹 점수는 `raw_amount * campaign weight`로 계산한다.

서비스 표현:

- 무료: 좋아요
- 유료: 루미나 부스트 또는 스테이지 부스트
- 랭킹 결과: 메인픽
- 보상: 회사 차원의 특별 해금

### Premium Videos

```http
GET /api/v1/premium-videos
GET /api/v1/premium-videos/:productId
POST /api/v1/premium-videos/:productId/unlock
GET /api/v1/me/premium-video-unlocks
```

정책:

- 기본 이미지는 무료.
- 프리미엄 영상만 유료.
- 해금 이력은 `user_premium_video_unlocks`와 `user_entitlements`에 남긴다.

### Character Chat

```http
POST /api/v1/chat/sessions
GET /api/v1/chat/sessions
GET /api/v1/chat/sessions/:sessionId/messages
POST /api/v1/chat/sessions/:sessionId/messages
GET /api/v1/chat-feature-products
POST /api/v1/chat-feature-orders
```

정책:

- 일반 캐릭터챗 전체를 유료로 잠그지 않는다.
- 특별 답변, 음성 답장, 이미지형 응답, 특별 대사만 유료 특수 기능으로 처리한다.
- 유료 기능으로 생성된 메시지는 `chat_feature_order_id`와 연결한다.

## Admin APIs

관리자 API는 `admin_users` + `admin_roles.permissions` 기반으로 route-level permission을 검사한다.

- `*`: 전체 관리자 권한
- `assets:write`, `artists:write`, `shortforms:write`: 콘텐츠 운영
- `products:write`: 루미나/선물 상품 운영
- `boosts:write`: 부스트 상품/캠페인/스냅샷 운영
- `premium_videos:write`: 프리미엄 영상 상품 운영
- `chat_products:write`: 유료 챗 기능 상품 운영
- `refunds:write`: 환불 추적 운영
- `payments:read`: 결제/환불 조회
- `audit:read`: 감사로그 조회
- `*:write` 권한은 같은 리소스의 `*:read`도 허용한다.

### Content / Assets

```http
GET /admin/api/v1/assets
GET /admin/api/v1/assets/:assetId
POST /admin/api/v1/assets
POST /admin/api/v1/assets/upload-intents
POST /admin/api/v1/assets/:assetId/confirm-upload
POST /admin/api/v1/assets/:assetId/archive
POST /admin/api/v1/assets/:assetId/restore
POST /admin/api/v1/assets/:assetId/versions
POST /admin/api/v1/artists
PATCH /admin/api/v1/artists/:artistId
POST /admin/api/v1/artists/:artistId/assets
DELETE /admin/api/v1/artists/:artistId/assets/:artistAssetId
POST /admin/api/v1/shortforms
PATCH /admin/api/v1/shortforms/:shortformId
POST /admin/api/v1/shortforms/:shortformId/assets
DELETE /admin/api/v1/shortforms/:shortformId/assets/:shortformAssetId
POST /admin/api/v1/premium-video-products/:productId/assets
DELETE /admin/api/v1/premium-video-products/:productId/assets/:premiumVideoAssetId
```

`GET /admin/api/v1/assets` lists assets for operations. Query filters:

- `assetType`
- `visibility`
- `storageProvider`
- `uploadStatus`
- `lifecycleStatus`
- `take` capped at 100

The response includes public URL, upload status, and current links to artists,
shortforms, and premium video products.

`POST /admin/api/v1/assets/upload-intents` creates an asset row and returns upload
instructions. It is the storage-provider boundary for S3/R2 integration. In
`r2` or `s3` mode, the response contains a presigned `PUT` URL.

Request body:

```json
{
  "assetType": "image",
  "fileName": "serin-cover.png",
  "mimeType": "image/png",
  "fileSizeBytes": 1024000,
  "visibility": "public",
  "width": 1024,
  "height": 1024,
  "metadata": {
    "usage": "artist_cover"
  }
}
```

`POST /admin/api/v1/assets/:assetId/confirm-upload` verifies the uploaded object
and marks `metadata.uploadIntent.status` as `uploaded`. In S3/R2 mode the server
uses a signed `HEAD` request before updating metadata.

Optional request body:

```json
{
  "objectETag": "\"etag-from-provider\""
}
```

`POST /admin/api/v1/assets/:assetId/archive` marks an asset as archived through
`metadata.lifecycle.status`. It does not delete the database row or object
storage file. If the asset is still linked to artists, shortforms, or premium
videos, the request fails unless `force` is true.

Request body:

```json
{
  "reason": "replaced by final retouched image",
  "force": false
}
```

`POST /admin/api/v1/assets/:assetId/restore` marks an archived asset as active
again. Archived assets cannot be linked to content and are filtered from public
artist/shortform responses.

Asset linking endpoints attach an existing uploaded asset to content records:

```json
{
  "assetId": "asset-id",
  "usageType": "cover",
  "isPrimary": true,
  "sortOrder": 10
}
```

- Artist assets use `usageType` such as `cover`, `thumb`, or `profile`.
- Shortform and premium video assets use `role` such as `thumbnail`, `video`, or `preview`.
- Assets with `metadata.uploadIntent.status = pending_upload` cannot be linked until confirmed.
- `DELETE` asset link endpoints remove only the relation row, not the underlying asset file or metadata.

Related environment variables:

- `OBJECT_STORAGE_PROVIDER`: `local`, `r2`, or `s3`; defaults to `local`
- `OBJECT_STORAGE_ENDPOINT`: required for R2, optional custom S3-compatible endpoint
- `OBJECT_STORAGE_BUCKET`: required for R2/S3
- `OBJECT_STORAGE_REGION`: defaults to `auto`; use an AWS region for S3
- `OBJECT_STORAGE_KEY_PREFIX`: optional folder prefix; recommended `lumina-stage`
- `OBJECT_STORAGE_ACCESS_KEY_ID`: required for R2/S3
- `OBJECT_STORAGE_SECRET_ACCESS_KEY`: required for R2/S3
- `OBJECT_STORAGE_PUBLIC_BASE_URL`: optional public CDN/base URL for object URLs
- `OBJECT_UPLOAD_INTENT_TTL_SECONDS`: defaults to `900`
- `MAX_IMAGE_UPLOAD_BYTES`: defaults to `20971520`
- `MAX_VIDEO_UPLOAD_BYTES`: defaults to `524288000`

Response shape:

```json
{
  "asset": {
    "id": "asset-id",
    "assetType": "image",
    "storageProvider": "r2",
    "storageKey": "uploads/images/2026/04/28/uuid-serin-cover.png"
  },
  "upload": {
    "method": "PUT",
    "url": "https://...",
    "publicUrl": "https://cdn.example.com/uploads/images/2026/04/28/uuid-serin-cover.png",
    "storageProvider": "r2",
    "storageKey": "uploads/images/2026/04/28/uuid-serin-cover.png",
    "requiredHeaders": {
      "content-type": "image/png"
    },
    "expiresInSeconds": 900,
    "mode": "direct_upload_ready"
  }
}
```

### Commerce / Operations

```http
GET /admin/api/v1/payment-orders
GET /admin/api/v1/payment-orders/:orderId
POST /admin/api/v1/payment-orders/:orderId/refunds
GET /admin/api/v1/refund-transactions
PATCH /admin/api/v1/refund-transactions/:refundId
POST /admin/api/v1/lumina-products
PATCH /admin/api/v1/lumina-products/:productId
POST /admin/api/v1/gift-products
PATCH /admin/api/v1/gift-products/:productId
POST /admin/api/v1/premium-video-products
PATCH /admin/api/v1/premium-video-products/:productId
POST /admin/api/v1/chat-feature-products
PATCH /admin/api/v1/chat-feature-products/:productId
```

`GET /admin/api/v1/payment-orders`는 결제/루미나 지급 운영 확인용이다. Query filter:

- `status`
- `provider`
- `userId`
- `orderNo`
- `take` capped at 100

상세 응답은 사용자, 루미나 상품, PG transaction, refund transaction을 함께 포함한다.

환불 운영 API는 실제 PG 환불 실행 전 단계의 기록/추적용이다.

- `POST /admin/api/v1/payment-orders/:orderId/refunds`는 paid 주문에 대해서만 환불 요청 row를 만든다.
- 기존 `requested`, `processing`, `succeeded` 환불 금액을 차감해 과환불 요청을 막는다.
- `PATCH /admin/api/v1/refund-transactions/:refundId`는 provider refund id, 사유, 상태를 갱신한다.
- 실제 PG 환불 호출은 Toss/PortOne 등 provider adapter가 확정된 뒤 별도 구현한다.

### Boost / Ranking Operations

```http
POST /admin/api/v1/boost-campaigns
PATCH /admin/api/v1/boost-campaigns/:campaignId
POST /admin/api/v1/boost-campaigns/:campaignId/snapshot
POST /admin/api/v1/main-picks
POST /admin/api/v1/unlock-campaigns
PATCH /admin/api/v1/unlock-campaigns/:unlockCampaignId
POST /admin/api/v1/unlock-campaigns/:unlockCampaignId/rewards
```

운영 흐름:

1. 운영자가 주간/월간 부스트 캠페인을 만든다.
2. 유저가 무료 좋아요 또는 유료 부스트를 보낸다.
3. 서버가 일정 주기로 랭킹 스냅샷을 만든다.
4. 운영자가 랭킹 기준 또는 편집 기준으로 메인픽을 확정한다.
5. 필요하면 회사 차원의 특별 해금 캠페인을 열고 보상을 연결한다.

## MVP Build Order

1. Public characters / shortforms API
2. Auth / me
3. Wallet ledger foundation
4. Lumina products and payment order skeleton
5. Gift products and gift order
6. Boost campaign, free like, lumina boost, ranking read API
7. Premium video unlock
8. Chat session and paid chat feature order
9. Admin APIs
## 2026-05-02 Popular Vote / Debut Addendum

The `인기투표실` frontend decision is split into three tabs:

- `Main Pick`: current month first-place view.
- `Debut Race`: ongoing vote room, backed by boost campaign rankings for now.
- `Hall of Fame`: yearly champion and monthly pick archive.

Public endpoints:

```http
GET /api/v1/popular-vote/main-pick
GET /api/v1/popular-vote/hall-of-fame/monthly-picks?year=2026
GET /api/v1/popular-vote/hall-of-fame/year-champion?year=2026
```

Admin operation endpoint:

```http
POST /admin/api/v1/popular-vote/monthly-picks/finalize
```

`monthly_pick_winners` stores the finalized monthly winner. Year Champion currently follows option A from Notion: annual weighted score sum.

Debut application endpoints:

```http
POST /api/v1/debut/applications
GET /api/v1/me/debut-applications
GET /admin/api/v1/debut/applications?status=submitted&take=50
PATCH /admin/api/v1/debut/applications/:applicationId
```

`debut_applications` stores an operations-review application only. Sensitive identity documents and final contracts must use a later secure upload/contract process, not chat, Notion, or Git.

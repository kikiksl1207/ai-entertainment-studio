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

Public API traffic is rate limited in-memory by the Nest throttler. The default policy is 120 requests per minute per client IP, with stricter limits on auth mutation endpoints:

- `POST /api/v1/auth/register`: 5 requests/minute
- `POST /api/v1/auth/login`: 10 requests/minute
- `POST /api/v1/auth/social/login`: 10 requests/minute
- `POST /api/v1/auth/refresh`: 30 requests/minute
- `POST /api/v1/auth/logout`: 30 requests/minute
- `POST /api/v1/auth/email-verifications`: 5 requests/minute
- `POST /api/v1/auth/email-verifications/confirm`: 10 requests/minute
- `POST /api/v1/auth/password-resets`: 5 requests/minute
- `POST /api/v1/auth/password-resets/confirm`: 5 requests/minute

Render should run behind trusted proxy mode so rate limiting uses the original client IP instead of the proxy address.

The server also applies Helmet security headers. `Cross-Origin-Resource-Policy` is set to `cross-origin` so public API and asset URL responses can still be consumed by the Vercel/frontend domains.

Every response includes an `x-request-id` header. Clients may send their own `x-request-id`; otherwise the server generates one. Error responses also include `error.requestId` so frontend bug reports, Render logs, and future observability tools can be correlated.

4. Create a local PostgreSQL database named `lumina_stage`.

5. Apply the initial migration.

```bash
npm run prisma:deploy
```

6. Generate Prisma Client.

```bash
npm run prisma:generate
```

7. Seed starter content and products.

```bash
npm run prisma:seed
```

The seed script inserts the first public artists, local image asset references, shortforms, Lumina products, gift products, the launch boost campaign, premium video products, and chat feature products. The script is idempotent and can be rerun after changing seed values.

The seed also keeps launch-prep artists as `planned` until image QA and frontend QA are complete. Planned artists are available through `GET /api/v1/artists/roadmap`, but they do not appear in `GET /api/v1/artists` until their status becomes `active` and both cover/thumb assets are ready. Current planned seed records include `seo-yuan`, `ha-yuna`, and `kwon-taejun`.

Current fixed gallery seed sources:

- `yoon-serin`: `assets/characters/yoon-serin/reference-final/*` (20)
- `han-seoyul`: `assets/characters/han-seoyul/reference-final-01.png` through `reference-final-20.png` (20)
- `park-doa`: `assets/characters/park-doa/reference-final/*` (18)
- `seo-yuan`: `assets/characters/seo-yuan/reference-final-01.png` through `reference-final-20.png` (20)
- `choi-seojin`: `assets/characters/choi-seojin/reference-final-01.png` through `reference-final-20.png` (20)
- `cha-dohyun`: `assets/characters/cha-dohyun/reference-final-01.png` through `reference-final-20.png` (20)
- `kwon-taejun`: `assets/characters/kwon-taejun/reference-final-01.png` through `reference-final-20.png` (20)

Current seed image packs include gallery assets for `yoon-serin`, `han-seoyul`, `park-doa`, `seo-yuan`, `choi-seojin`, `cha-dohyun`, and `kwon-taejun`. The seed skips missing image files so public APIs do not emit broken asset URLs. When an old local seed asset is no longer present in the current operation pack, the seed marks it archived through `metadata.lifecycle.status = archived` so public artist responses stop returning stale images.

8. Start the API server.

```bash
npm run start:dev
```

The server listens on `http://localhost:3001` by default.

## Public API Skeleton

- `GET /api/v1/artists`
- `GET /api/v1/artists/roadmap`
- `GET /api/v1/artists/:slug`
- `GET /api/v1/shortforms`
- `GET /api/v1/lumina-products`

Public artist responses only expose public-ready artists that have both `coverImage` and `thumbnailImage`, so draft or legacy rows without operation-pack images do not appear on the frontend.

Public artist and roadmap responses include `category` and `displayCategory` for frontend filters. These are user-facing labels, not internal tiers. The current category taxonomy is `아티스트`, `모델`, `배우`, `엔터테이너`, `스포츠`, and `기타`. Use `전체`, then those six labels for the character filter UI; do not expose main/premium/sub/candidate as category filters. `기타` is the fallback for uncategorized or category-test characters until operations approves a new stable category.

## Wallet API Skeleton

User-scoped endpoints require an access token from `POST /api/v1/auth/login` or `POST /api/v1/auth/register`.

New users receive a 300 Lumina signup bonus when their wallet is created. The grant is written to `wallet_ledger` with `ledgerType = event_grant` and a `signup_bonus:*` idempotency key for compatibility with the production ledger constraint; balances are never stored directly on `users`.

Email-password signup requires a password between 8 and 128 characters. Letter/number composition is not required by the server.
Email and social signup auto-assign a temporary display name and unique `publicHandle` like `민트별빛4827` when `displayName` is omitted, so public UI never needs to derive a name from the email prefix. The generator uses color + object + four digits and retries when an existing profile already has the same generated handle. Display names can change; `publicHandle` is the stable unique public id.
Signup and social signup may include optional `referralCode` (6-24 uppercase letters, numbers, `_`, or `-`). Blank referral inputs should be omitted from the request body. A valid referral code grants 500 Lumina to the referrer and 500 Lumina to the new user in addition to the 300 Lumina signup bonus.

Auth endpoints:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/social/providers`
- `POST /api/v1/auth/social/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/email-verifications`
- `POST /api/v1/auth/email-verifications/confirm`
- `POST /api/v1/auth/password-resets`
- `POST /api/v1/auth/password-resets/confirm`
- `GET /api/v1/me`
- `GET /api/v1/me/summary`
- `GET /api/v1/me/activity-ledger?type=all&take=50`
- `PATCH /api/v1/me/profile`
- `GET /api/v1/me/settings`
- `PATCH /api/v1/me/settings`
- `POST /api/v1/me/assets/upload-intents`
- `POST /api/v1/me/assets/:assetId/confirm-upload`
- `GET /api/v1/me/notifications?status=all&take=20`
- `GET /api/v1/me/notifications/unread-count`
- `PATCH /api/v1/me/notifications/:notificationId/read`
- `PATCH /api/v1/me/notifications/read-all`
- `PATCH /api/v1/me/password`
- `PATCH /api/v1/me/password/setup`
- `DELETE /api/v1/me`
- `GET /api/v1/me/sessions`
- `DELETE /api/v1/me/sessions`
- `DELETE /api/v1/me/sessions/:sessionId`

`GET /api/v1/app/bootstrap` is a public first-load configuration endpoint. It returns non-secret localization policy, social provider status, Lumina currency constants, feature flags, lightweight product policies, artist category filter labels, and endpoint hints so the frontend can bootstrap common settings with one request.

Social login accepts `{ "provider": "google" | "kakao" | "naver", "token": "<provider-token>" }`. For current frontend compatibility, `accessToken` is also accepted as an alias for `token`, and `{ "code": "...", "redirectUri": "..." }` is accepted for authorization-code handoff flows.
Google accepts either an identity token or an OAuth access token; Kakao and Naver expect access tokens. The server can exchange a Kakao authorization code with `KAKAO_REST_API_KEY`; set `KAKAO_CLIENT_SECRET` only if the Kakao app has client-secret mode enabled. `KAKAO_REDIRECT_URI` can be set to force the exact redirect URI registered in Kakao Developers, such as `https://lumina-stage.com`, instead of trusting the frontend payload. Google and Naver authorization-code exchange additionally require `GOOGLE_OAUTH_CLIENT_SECRET` and `NAVER_CLIENT_SECRET`, but token handoff does not. The server verifies the provider token before creating or linking a `user_auth_accounts` row, and only verified provider emails can be used to link an existing email account. Configure `GOOGLE_OAUTH_CLIENT_ID`, `KAKAO_REST_API_KEY`, and `NAVER_CLIENT_ID` in `.env`; if a provider is not configured, its login endpoint fails closed. Apple login is intentionally out of scope for the initial launch.

Auth responses include both the canonical nested token object and flat token aliases for older frontend code: `{ "user": {}, "tokens": { "accessToken": "...", "refreshToken": "...", "tokenType": "Bearer" }, "accessToken": "...", "refreshToken": "...", "tokenType": "Bearer" }`.

`GET /api/v1/auth/social/providers` returns the supported provider list with `enabled` flags based on server environment variables. Frontend clients should use this endpoint to decide which social login buttons are active.

Refresh tokens are stored as SHA-256 hashes in `user_refresh_tokens`. `POST /api/v1/auth/refresh` rotates the refresh token and revokes the previous one; `POST /api/v1/auth/logout` accepts `{ "refreshToken": "..." }` and revokes that token server-side. Access tokens remain short-lived and are not individually revoked.

`GET /api/v1/me` returns profile convenience fields for My Page, including `displayName`, `publicHandle`, `avatarUrl`, `avatarAsset`, `provider`, `providers`, `hasPassword`, `isSocialOnly`, `emailVerified`, `emailVerifiedAt`, `emailVerification`, `nicknameLastChangedAt`, `nicknameNextChangeAt`, and `canChangeNickname`. `emailVerification` is the email-signup gate contract; unverified email accounts return `code=AUTH_EMAIL_VERIFICATION_REQUIRED`, `messageKey=auth.emailVerification.required`, and `gates.coreFeaturesBlockedUntilVerified=true`. `PATCH /api/v1/me/profile` accepts `displayName`, `bio`, and `avatarAssetId`; display names can be changed once every 30 days. `GET /api/v1/me/settings` and `PATCH /api/v1/me/settings` manage locale, timezone, marketing, push, activity, feed, and email notification flags. Supported locales are `ko-KR`, `ja-JP`, `en-US`, and `zh-CN`; `GET /api/v1/localization/policy` is public and exposes the default locale plus `Accept-Language` detection for anonymous first-load language selection. `POST /api/v1/me/assets/upload-intents` and `POST /api/v1/me/assets/:assetId/confirm-upload` let logged-in users create public image assets for avatar/feed use. User images default to an 8MB limit (`MAX_IMAGE_UPLOAD_BYTES=8388608`); over-limit requests return `413 PAYLOAD_TOO_LARGE` with a Korean user-facing message. `GET /api/v1/app/bootstrap` exposes the same value at `policy.userImageUpload.maxBytes` so the frontend can avoid hardcoded limits. `GET /api/v1/me/notifications` returns the notification center list with unread count and cursor pagination; `GET /api/v1/me/notifications/unread-count`, `PATCH /api/v1/me/notifications/:notificationId/read`, and `PATCH /api/v1/me/notifications/read-all` support badge and read-state UI. `GET /api/v1/me/summary` returns the My Page bootstrap payload with user, wallet, recent ledger, payment orders, activity counts, unlocks, artist follows, user follows, followers, feed counts, recent activities, and debut status. `activity.followingArtists[]` uses the same card-ready row shape as `GET /api/v1/me/following-artists`. `GET /api/v1/me/activity-ledger` supports `type=all|charge|boost|unlock|gift|free_like`.

`GET /api/v1/me/sessions` lists active refresh-token sessions for the current user without exposing token hashes. The response includes minimal session metadata such as `userAgent`, `ipAddress`, `createdAt`, `lastUsedAt`, and `expiresAt`. `DELETE /api/v1/me/sessions/:sessionId` revokes a selected session. `DELETE /api/v1/me/sessions` revokes all active sessions for the current user, including the current device, so clients must clear local access and refresh tokens immediately after calling it.

`PATCH /api/v1/me/password` changes the password for email-password accounts after verifying the current password. It revokes all active refresh-token sessions on success, so clients must clear local access and refresh tokens and send the user back to login. Social-only accounts without an email password cannot use this endpoint until a password setup flow is added.

`PATCH /api/v1/me/password/setup` lets a logged-in social-only user with an email create their first email password. It accepts `{ "newPassword": "abc12345" }`, uses the same 8-128 character length-only password rule, and returns `{ "ok": true, "user": <GET /me shape> }`. If the user already has an email password, it returns `409 Email password is already configured`; use `PATCH /api/v1/me/password` for later changes.

`DELETE /api/v1/me` soft-deletes the current user account by setting `users.status = deleted` and `users.deleted_at = now()`. It revokes all active refresh-token sessions, consumes outstanding user action tokens, deactivates the user's referral code, and writes a `user.self_delete` audit event. Email-password accounts must include `{ "currentPassword": "..." }`; social-only accounts may omit it. Clients must clear local tokens immediately after success. Existing wallet ledgers, payment orders, gifts, and audit trails are retained for accounting and abuse-response history.

Email verification and password reset use one-time action tokens. Request endpoints always return a neutral `{ "success": true, "ok": true, "delivery": ..., "policy": ... }` shape so clients do not learn whether an account exists; provider delivery failures on request endpoints are also kept neutral. The `policy` object exposes rate-limit/cooldown hints, token TTL, and duplicate pending token behavior without exposing raw token material. Confirmation endpoints accept `{ "token": "..." }`; password reset confirmation also accepts `newPassword`. Tokens are stored only as SHA-256 hashes in `user_action_tokens`, expire after 24 hours for email verification and 1 hour for password reset, and are single-use. Email verification confirmation stores `users.email_verified_at`; password reset confirmation updates the email password hash and revokes active refresh-token sessions. Raw tokens must never be logged, committed, or pasted into Notion or chat.

Identity verification is wired as a NICE-first provider skeleton. `GET /api/v1/me/identity-verifications/policy` returns supported methods (`mobile_phone`, `ipin`), non-secret env readiness flags, account policy flags, and the current fail-closed next action. `GET /api/v1/me/trust` returns `accountState` with `signupAllowedWithoutIdentityVerification: true`, `identityVerificationBeforeSignupRequired: false`, derived `ageGate`, and a `cleanMode` flag. Minor clean mode is only enforced when a verified provider birth date proves the account is a minor; signup remains allowed before identity verification. `POST /api/v1/me/identity-verifications` records an `unverified` request marker in `user_identity_verifications` without storing resident registration numbers, raw identity documents, NICE raw names, NICE raw phone numbers, raw provider tokens, or provider secrets. `POST /api/v1/me/identity-verifications/self/confirm` intentionally returns `IDENTITY_VERIFICATION_PROVIDER_NOT_CONNECTED` until the real NICE adapter/callback contract is implemented.

For local/staging QA before a mail provider is connected, set `ACTION_TOKEN_DEBUG_ENABLED="true"` with `NODE_ENV` not equal to `production`. When the target active account exists, the request endpoints include `debug.actionToken` and `debug.expiresAt` so testers can call the confirm endpoint. Keep this disabled on Render production and never share debug tokens in chat, Git, or Notion.

- `GET /api/v1/wallet`
- `GET /api/v1/wallet/ledger?take=50`
- `POST /api/v1/wallet/test-grant`
- `GET /api/v1/lumina-station?take=5`
- `GET /api/v1/rewards/referral-code`
- `GET /api/v1/rewards/referrals`
- `POST /api/v1/rewards/daily-attendance`
- `GET /api/v1/rewards/daily-attendance`
- `GET /api/v1/rewards/birthday`
- `POST /api/v1/rewards/birthday/claim`
- `POST /api/v1/user-gifts`
- `GET /api/v1/user-gifts/sent`
- `GET /api/v1/user-gifts/received`

Local test grant example:

```bash
curl -X POST http://localhost:3001/api/v1/wallet/test-grant \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access-token>" \
  -H "Idempotency-Key: local-test-001" \
  -d "{\"amount\":100,\"memo\":\"local seed grant\"}"
```

`GET /api/v1/lumina-station?take=5` is the preferred Lumina charge screen bootstrap endpoint. It returns the current wallet, active Lumina products, recent payment orders, payment provider status hints, and display policy. The endpoint does not create an order or grant Lumina; clients still use `POST /api/v1/payments/orders` with an `Idempotency-Key` to start a charge order. Real Lumina credit happens only after a paid provider transaction/webhook.
When the user has no prior paid order, Lumina Station marks `policy.firstChargeBonus.eligible = true` and each product includes `firstChargeBonusLumina` plus `firstChargeTotalLumina`. The first paid webhook grants this 10% bonus once with `wallet_ledger.ledgerType = first_charge_bonus`.

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
- `POST /api/v1/boost-campaigns/:campaignId/paid-like`
- `GET /api/v1/me/paid-like-quota`
- `GET /api/v1/popular-vote/main-pick`
- `GET /api/v1/popular-vote/hall-of-fame/monthly-picks?year=2026`
- `GET /api/v1/popular-vote/hall-of-fame/year-champion?year=2026`
- `GET /api/v1/boost-products`
- `POST /api/v1/boost-orders`
- `GET /api/v1/me/boost-events`

`POST /api/v1/boost-campaigns/:campaignId/free-like` accepts `{ "artistId": "<artist uuid>" }`. For frontend compatibility it also accepts `{ "artistSlug": "yoon-serin" }` or a slug-like `artistId`; the backend resolves the active artist before writing `artist_boost_events`. Daily free-like limit failures currently return `400 Daily free like limit exceeded`.

`POST /api/v1/boost-campaigns/:campaignId/paid-like` accepts `{ "artistSlug": "yoon-serin", "quantity": 1 }`. One paid like unit costs 10L through `BOOST_BASIC_VOTE`; the backend debits the wallet, writes `wallet_ledger`, and creates a `lumina_boost` event in one transaction. `quantity` defaults to 1 and accepts 1-20. The MVP daily paid-like limit is 20 units per user; failures return `400 Daily paid like limit exceeded`. `GET /api/v1/me/paid-like-quota` returns remaining paid-like quota for purchase UI.

Gift orders and paid boost orders debit `wallet_accounts.cached_balance` and create `wallet_ledger` entries inside the same transaction. Free likes and paid boost events are stored in `artist_boost_events`; rankings read the latest snapshot when present and otherwise aggregate live events.

Popular vote room APIs map to the 3-tab frontend decision: Main Pick uses the current boost campaign and rankings, Hall of Fame reads finalized `monthly_pick_winners`, and Year Champion uses the draft rule `annual_weighted_score_sum`. Monthly winners are finalized manually through `POST /admin/api/v1/popular-vote/monthly-picks/finalize`; this can later move to a scheduled job after monthly operations are stable.

All user-scoped gift and boost mutation APIs use `Authorization: Bearer <access-token>`. API secrets and payment provider secrets must stay in environment variables only.

Lumina Feed follow endpoints:

- `POST /api/v1/artists/:artistId/follow`
- `DELETE /api/v1/artists/:artistId/follow`
- `POST /api/v1/users/:userId/follow`
- `DELETE /api/v1/users/:userId/follow`
- `GET /api/v1/users/:userId/profile`
- `GET /api/v1/users/handle/:publicHandle/profile`
- `POST /api/v1/users/handle/:publicHandle/follow`
- `DELETE /api/v1/users/handle/:publicHandle/follow`
- `POST /api/v1/users/handle/:publicHandle/block`
- `DELETE /api/v1/users/handle/:publicHandle/block`
- `GET /api/v1/me/following`
- `GET /api/v1/me/following-artists?take=20&cursor=<followId>`
- `GET /api/v1/me/following-users`
- `GET /api/v1/me/followers`
- `GET /api/v1/me/lumina-feed`
- `POST /api/v1/lumina-feed/posts/:postId/hide`
- `DELETE /api/v1/lumina-feed/posts/:postId/hide`
- `GET /api/v1/me/hidden-posts`
- `POST /api/v1/users/:userId/block`
- `DELETE /api/v1/users/:userId/block`
- `GET /api/v1/me/blocked-users`

Normal users are follow targets as well as artists. `GET /api/v1/me/following` returns `{ artists, users }`; user rows include `publicHandle` as the stable unique public id. The split endpoints are available for screens that only need one list.
`GET /api/v1/me/following-artists` returns `{ items, artists, count, total, nextCursor, policy }` for My Page artist cards. Each row includes `id`, `followId`, `slug`, `displayName`, `name`, `thumbnailUrl`, `thumbUrl`, `status`, `type`, `followedAt`, `latestFeedAt`, and `isFollowing`. Only active public artists are returned; draft, archived, deleted, or suspended artists are hidden from My Page follow cards.
`GET /api/v1/users/:userId/profile` is public and returns an active user's display profile, follow/feed counts, and up to 5 recent public posts without exposing email. `GET /api/v1/users/handle/:publicHandle/profile` returns the same shape by stable unique public handle and is the preferred profile endpoint for shareable links.
Handle-based follow/block endpoints are available for public-handle profile screens and reuse the same UUID endpoint behavior after resolving the target active user.
`GET /api/v1/me/lumina-feed` keeps the public feed shape but excludes posts hidden by the current user and posts from active block relationships. Blocking a user also soft-deletes active follows in both directions.
Feed actions now create notification-center rows: `feed.reply`, `feed.like`, and `user.follow`. Self-actions do not create notifications. `feedNotifications=false` suppresses `feed.*`; `activityNotifications=false` suppresses `user.follow`. Notification responses include an `i18n` block with translation keys and fallback text for frontend locale dictionaries.
Feed posts can link up to 4 existing public image assets through `assetIds` on `POST /api/v1/lumina-feed/posts`. Assets must be uploaded/confirmed and not archived; post responses expose linked image URLs through `assets[]`.

## Debut Application APIs

User endpoints:

- `POST /api/v1/debut/applications`
- `GET /api/v1/me/debut-applications`

Admin endpoints:

- `GET /admin/api/v1/debut/applications?status=submitted&operationSegment=entertainment_agency&take=50`
- `GET /admin/api/v1/debut/applications/:applicationId`
- `PATCH /admin/api/v1/debut/applications/:applicationId/review`

Backstage should build these calls through `adminApiPath('/debut/applications...')`.
With the deployed host-root API base, the helper expands to
`/api/v1/admin/api/v1/debut/...`; if the configured base already includes
`/api/v1`, the relative admin path stays `/admin/api/v1/debut/...`.

`POST /api/v1/debut/applications` requires login and stores an operations-review application, not a final contract. Supported `applicationType` values are `personal_unaffiliated`, `represented_artist`, `ai_creator_partner`, and `partnership_other`; the default is `personal_unaffiliated`. `represented_artist` is flagged in metadata with `rightsReviewRequired: true`, while `ai_creator_partner` and `partnership_other` are flagged with `partnerReviewRequired: true`. Supported `participationType` values are `appearance_only`, `voice_or_song`, `performance`, and `co_creator`; requested/approved revenue share percentages are capped at 70. Required consent flags are `consentAppearance`, `consentRevenuePolicy`, and `consentPrivacy`. Real identity documents, signed contracts, API keys, and other sensitive files must not be committed or pasted into chat/Notion. Admin list filters include `applicationType`, `operationSegment`, `rightsReviewRequired`, `partnerReviewRequired`, and `consultationStatus`. Admin list/detail expose masked contact fields and private material metadata only; they must not expose signed read URLs, original file URLs, storage keys, object ETags, secrets, or tokens. Admin review mutation is separated at `PATCH /admin/api/v1/debut/applications/:applicationId/review`; it writes a redacted audit summary only and does not confirm final debut, contract, settlement, payout, wallet, or Lumina state. `shareTierApproved` remains blocked in that action contract.

Phone-consultation operations are contract-only. `GET /api/v1/debut/policy` and
admin debut list/detail expose `phoneConsultationOperations` with
`operatorPhone.numberReturned=false`; if the operations number is not
configured, `operatorPhone.configured=false` and clients must hide the public
number surface. The raw operations phone number is never returned in this
phase. SLA copy uses `debut.phoneConsultation.sla.businessDayReview` with
`guaranteed=false`, so it must read as business-day review / contact-if-available
guidance, not a guaranteed call, approval, contract, settlement, payout, or
debut promise. Admin rows include `operatorRouting` for queue triage and
contact availability; it does not send SMS, external email, or automated phone
calls.
`operatorRouting` also includes safe queue guidance: `queueSegment`,
`reviewQueues`, assignment booleans without operator ids/names, and guidance
keys for missing operator assignment, missing preferred contact time, missing
operations phone configuration, pending rights review, and pending partner
review. Admin and owner projections include `finalization` with final debut,
contract, settlement, payout, wallet, and Lumina mutation flags all false.

## Premium Video And Chat MVP APIs

Premium video endpoints:

- `GET /api/v1/premium-videos`
- `GET /api/v1/premium-videos/:productId`
- `POST /api/v1/premium-videos/:productId/unlock`
- `GET /api/v1/me/premium-video-unlocks`

Chat endpoints:

- `POST /api/v1/chat/sessions`
- `GET /api/v1/chat/sessions`
- `GET /api/v1/chat/conversations?box=recent|archive|all&take=20&cursor=<nextCursor>`
- `POST /api/v1/chat/conversations/:sessionId/archive`
- `POST /api/v1/chat/conversations/:sessionId/restore`
- `GET /api/v1/chat/starter-prompts?artistSlug=<artistSlug>`
- `GET /api/v1/chat/sessions/:sessionId/messages`
- `POST /api/v1/chat/sessions/:sessionId/messages`
- `GET /api/v1/chat-feature-products`
- `POST /api/v1/chat-feature-orders`

Starter prompts return beginner-friendly A/B opening message suggestions and a
direct-input option for the selected active artist. The endpoint is authenticated,
does not debit Lumina, and falls back to safe default Korean copy when artist
metadata does not define `chatStarterPromptSets`.

Conversation list is authenticated, owner-only, and read-only. It returns
`latestMessage`/`latestAt` alongside `lastMessage`, keeps archived conversations
separate from recent conversations through the `box` contract, and reports
read-state as `not_tracked` with `chat.conversations.readStateNotAvailable` until
read receipts exist. Pending provider, provider failure, and empty previews use
stable `chat.conversations.latestMessage.*` keys instead of raw user-facing copy.
The list path does not call LLM, create messages, debit wallet/Lumina, touch
settlement, or return secrets/raw message bodies.

Premium video unlocks and paid chat feature orders debit `wallet_accounts.cached_balance` and write `wallet_ledger` records in the same transaction. Premium video access is also recorded in `user_premium_video_unlocks` and `user_entitlements`.

## Payment Order MVP APIs

Payment endpoints:

- `POST /api/v1/payments/orders`
- `GET /api/v1/payments/orders?take=20`
- `GET /api/v1/payments/orders/:orderId`
- `POST /api/v1/payments/webhooks/:provider`

Payment flow:

1. The client calls `POST /api/v1/payments/orders` with a `luminaProductId`.
2. The server creates a `payment_orders` row with the selected `provider` and returns provider checkout payload data.
3. The client opens the PG checkout using provider data.
4. Lumina is not credited from a client-side success claim.
5. The server credits Lumina only after `POST /api/v1/payments/webhooks/:provider` verifies and parses a provider event.
6. A successful provider event writes `payment_transactions`, marks the order `paid`, credits `wallet_accounts.cached_balance`, and records a `wallet_ledger` purchase entry in one transaction.

The order's stored provider must match the webhook provider before any wallet credit is created. Provider adapters currently registered are `mock`, `payletter`, and `tosspayments`. `mock` is safe for local development. `payletter` and `tosspayments` expose non-secret checkout metadata so the frontend can prepare provider-specific UI, but live credit still requires verified provider callbacks/webhooks. Provider secrets must remain in environment variables such as `MOCK_PAYMENT_WEBHOOK_SECRET`, `PAYLETTER_PAYMENT_API_KEY`, or `TOSSPAYMENTS_SECRET_KEY`; real provider keys should never be committed.

Payletter notes:

- Set `PAYMENT_PROVIDER=payletter`.
- Required production env: `PAYLETTER_CLIENT_ID`, `PAYLETTER_PAYMENT_API_KEY`, `PAYMENT_SUCCESS_URL`, `PAYMENT_FAIL_URL`, and `PAYMENT_CALLBACK_URL`.
- Optional env: `PAYLETTER_ENDPOINT`, `PAYLETTER_PGCODE`, `PAYLETTER_SERVICE_NAME`, `PAYMENT_CANCEL_URL`, `PAYLETTER_CALLBACK_SECRET`.
- The checkout payload uses `mode: "server_request"` and describes the server-side `/v1.0/payments/request` handoff. Lumina must be credited only after the callback path is verified and parsed.

TossPayments notes:

- Set `PAYMENT_PROVIDER=tosspayments`.
- Required production env: `TOSSPAYMENTS_SECRET_KEY`, `PAYMENT_SUCCESS_URL`, `PAYMENT_FAIL_URL`, and either `TOSSPAYMENTS_WIDGET_CLIENT_KEY` or `TOSSPAYMENTS_CLIENT_KEY`.
- Optional env: `TOSSPAYMENTS_WIDGET_SECRET_KEY`, `TOSSPAYMENTS_CONFIRM_ENDPOINT`, `TOSSPAYMENTS_WEBHOOK_SECRET`.
- The checkout payload uses `mode: "payment_widget"` and includes the configured public client key for frontend checkout setup.

Payment webhook handlers preserve the raw request body so real PG adapters can verify provider signatures against the exact payload received from the provider.

Paid webhook handling uses an atomic order-status transition before crediting Lumina. If the order is already `paid`, repeated or competing webhooks are treated as idempotent replays and do not create another wallet credit.

See `../docs/payment-refund-state-policy.md` for the payment and refund state
transition policy that real PG adapters must follow.

## Admin MVP APIs

Admin endpoints use `Authorization: Bearer <access-token>`.

Admin access is now DB-backed through `admin_users` and `admin_roles`. `ADMIN_EMAILS` remains as a bootstrap fallback so the first trusted operator can log in and create DB admin users. Admin endpoints also enforce route-level permissions from `admin_roles.permissions`.

- `GET /admin/api/v1/admin-roles`
- `GET /admin/api/v1/admin-users`
- `POST /admin/api/v1/admin-users`
- `PATCH /admin/api/v1/admin-users/:adminUserId`
- `GET /admin/api/v1/audit-events`
- `GET /admin/api/v1/auth/action-tokens?purpose=email_verification&status=pending&take=50`
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
- `GET /admin/api/v1/users?status=active&email=user@example.com&take=50`
- `GET /admin/api/v1/users/:userId`
- `POST /admin/api/v1/users/:userId/suspend`
- `POST /admin/api/v1/users/:userId/restore`
- `POST /admin/api/v1/users/:userId/delete`
- `POST /admin/api/v1/artists`
- `PATCH /admin/api/v1/artists/:artistId`
- `GET /admin/api/v1/artists/:artistId/operators`
- `POST /admin/api/v1/artists/:artistId/operators`
- `PATCH /admin/api/v1/artist-operators/:operatorId`
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
- `GET /admin/api/v1/community/summary?take=10`
- `GET /admin/api/v1/community/reports?status=submitted&take=50`
- `GET /admin/api/v1/community/posts?status=published&minReports=1&sort=reports&take=50`
- `PATCH /admin/api/v1/community/reports/:reportId`
- `POST /admin/api/v1/community/posts/:postId/hide`
- `POST /admin/api/v1/community/posts/:postId/restore`
- `POST /admin/api/v1/popular-vote/monthly-picks/finalize`
- `GET /admin/api/v1/debut/applications?status=submitted&take=50`
- `GET /admin/api/v1/debut/applications/:applicationId`
- `POST /admin/api/v1/premium-video-products`
- `PATCH /admin/api/v1/premium-video-products/:productId`
- `POST /admin/api/v1/premium-video-products/:productId/assets`
- `DELETE /admin/api/v1/premium-video-products/:productId/assets/:premiumVideoAssetId`
- `POST /admin/api/v1/chat-feature-products`
- `PATCH /admin/api/v1/chat-feature-products/:productId`

Admin create/update/snapshot mutations write `audit_events` rows with actor, action, target, before data, and after data. `GET /admin/api/v1/audit-events` can filter by `actorUserId`, `action`, `targetType`, and `targetId`; `take` defaults to 50 and is capped at 100.

`GET /admin/api/v1/auth/action-tokens` requires `audit:read` and gives operators a read-only trace of email verification and password reset action-token state. It supports `purpose=email_verification|password_reset`, `status=all|pending|consumed|expired`, `deliveryStatus=all|not_recorded|pending|accepted|not_configured|failed`, `deliveryProvider=all|none|resend|sendgrid` (or `provider` as an alias), `userId`, masked `email`, `take`, and `cursor`. Rows expose token purpose, created/expires/consumed timestamps, derived status, masked target email, and delivery audit fields persisted on `user_action_tokens`: `delivery.status`, `delivery.channel`, `delivery.provider`, `delivery.attemptedAt`, `delivery.acceptedAt`, and `delivery.failedAt`. The endpoint never returns raw token values, token hashes, mail bodies, raw target email, provider raw responses, provider secrets, or environment values.

User moderation endpoints are super-admin-only in the initial policy. `POST /admin/api/v1/users/:userId/suspend` sets `users.status = suspended` and revokes all active refresh-token sessions. `POST /admin/api/v1/users/:userId/delete` soft-deletes the account with `users.status = deleted`, sets `deleted_at`, revokes sessions, consumes outstanding user action tokens, and deactivates referral codes. `POST /admin/api/v1/users/:userId/restore` returns the account to `active` and clears `deleted_at`; it does not restore old refresh tokens. Admins cannot suspend or delete their own account through these endpoints.

Community moderation endpoints require `community:read` or `community:write`
unless the admin role has `*`. `GET /admin/api/v1/community/summary` returns
grouped report/post counts and high-risk posts sorted by report count.
`PATCH /admin/api/v1/community/reports/:reportId` can also take
`action=hide_post|restore_post` and `resolveMatchingReports=true` to process a
report and its post in one operation. Post hide/restore writes moderation
metadata and audit events; it does not hard-delete feed content.

Artist operator endpoints require `artists:write`. Operators are the bridge
between normal user accounts and artist-account posting in Lumina Feed. Creating
an operator with `email` or `userId` grants or reactivates that user's access to
post for the artist; setting status to `inactive` or `revoked` blocks future
artist posts and records `revokedAt`.

Asset archive/restore is metadata-based. Archive does not delete object storage files; it marks `metadata.lifecycle.status` as `archived`, blocks future linking, and removes the asset from public artist/shortform responses.

Seeded roles:

- `super_admin`: full admin access, can create/update admin users.
- `content_admin`: content and artist operations.
- `commerce_admin`: product, payment, gift, boost, premium video operations.

Permission notes:

- `*`: full access.
- `assets:write`, `artists:write`, `shortforms:write`: content operations.
- `products:write`: Lumina and gift product operations.
- `boosts:write`: boost product, boost campaign, and ranking snapshot operations.
- `premium_videos:write`: premium video product operations.
- `chat_products:write`: paid chat feature product operations.
- `refunds:write`: refund tracking operations.
- `payments:read`: payment and refund lookup.
- `audit:read`: audit event lookup.
- A `*:write` permission also allows the matching `*:read` permission.

See `../docs/admin-permission-matrix.md` for the full route permission matrix
and recommended future operator roles.

Admin refund APIs create and track refund records only. Actual PG refund execution should be implemented in the provider adapter after the production PG is selected.

Auth email copy:

- Email verification and password reset provider templates are Korean-first for v1.
- Verification subject: `이메일 주소를 한 번만 확인해 주세요`.
- Password reset subject: `비밀번호 재설정 링크가 도착했어요`.
- Expiry text is rendered by the backend as `YYYY-MM-DD HH:mm KST`.
- Do not log or document provider secrets, raw action tokens, or real recipient addresses while testing the templates.

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

See `../docs/lumina-economy-policy.md` for Lumina/Stella pricing, signup/referral/attendance rewards, gift participation minimums, and accounting rules.

Reward endpoints grant Lumina through `wallet_ledger` only. `POST /api/v1/rewards/daily-attendance` grants the current 7-day promo schedule once per Korea service date (`10, 10, 20, 20, 20, 20, 50` Lumina) and is included in the 3,000 Lumina free promotional reward cap. Referral codes are created with `GET /api/v1/rewards/referral-code`; passing `referralCode` to email or social signup grants 500 Lumina to the referrer and 500 Lumina to the new user through `referral_reward` ledger entries.
Birthday rewards are exposed through `GET /api/v1/rewards/birthday` and `POST /api/v1/rewards/birthday/claim`. The claim endpoint grants 1,000 Lumina only when verified identity data includes provider-sourced `birthDate` and `identitySubjectHash`, today is the user's birthday in the Korea service timezone, and the same identity has not claimed in the current year.

User-to-user gift transfers move Lumina between two active wallets in one transaction. The sender receives a `user_gift_send` debit ledger, the recipient receives a `user_gift_receive` credit ledger, and `user_gift_transfers` stores the visible transfer record. Minimum transfer amount is 10 Lumina. Sender limits are 20 transfers per Korea service day, 100,000 Lumina per day, and 1,000,000 Lumina per month.

The script creates an upload intent, uploads a generated 1x1 PNG to the presigned URL, confirms the upload, and reads back the asset.

## Database Notes

The first Prisma migration is copied from `../docs/postgresql-schema.sql` so the implementation stays aligned with the current backend/DB design document. The Prisma schema currently maps the public read models needed for the first API slice: artists, artist profiles, assets, artist assets, shortforms, and shortform assets. Commerce, wallet, gift, boost, premium video, and chat models remain in the SQL migration and can be added to `schema.prisma` as their API modules are implemented.

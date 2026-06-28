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
- Wallet-debit endpoints must receive either an `Idempotency-Key` header or a
  body `idempotencyKey` before any wallet mutation. Missing keys return
  `WALLET_MUTATION_IDEMPOTENCY_REQUIRED` or a domain-specific equivalent with
  `walletMutation: false`. Reusing the same key with a different request body
  returns `WALLET_MUTATION_IDEMPOTENCY_CONFLICT` or a domain-specific
  equivalent and must not debit the wallet again. Debit transactions update
  `wallet_accounts.cached_balance` only with a `cachedBalance >= amount`
  condition, then write the ledger/event/order in the same DB transaction.
- App and web clients must treat local Lumina balance, price, purchase,
  refund, and settlement values as display-only. The server-authority contract
  is documented in `docs/server-authority-ledger-contract.md`; provider
  purchase verification, wallet ledger idempotency, fail-closed debits, and
  advisory-only app integrity signals are mandatory before any app-store or
  premium-chat paid flow is opened.
- App tamper defense follows the #404 server trust contract: client-submitted
  `balanceLumina`, payment success, bonus display, amount, SKU, refund rate,
  settlement share, and wallet ledger ids are never authority. Safe retries use
  user/action-scoped idempotency plus a request fingerprint; changed-body
  replays fail before wallet lookup or provider checkout creation. Risk logs
  may store sanitized request/decision context only, never raw purchase tokens,
  cookies, provider payloads, signed URLs, DB URLs, or provider secrets.
- 클라이언트가 결제 성공을 주장해도 서버는 PG transaction/webhook으로만 확정한다.
- 관리자/운영 API는 `/admin` namespace로 분리한다.

## Public APIs

### Characters

```http
GET /api/v1/artists
GET /api/v1/artists/roadmap
GET /api/v1/artists/:artistSlug
GET /api/v1/artists/:artistSlug/assets
```

Frontend-friendly response fields:

- `slug`, `displayName`, `profile`, `visual`
- `category`, `displayCategory`
- `coverImage.url`, `thumbnailImage.url`
- `assets[].url`, `assets[].usageType`
- Public responses only expose uploaded/ready assets.
- Public artist responses only expose artist rows that have both a cover image and thumbnail image.
- Public responses do not expose internal asset `metadata`, `storageKey`, or `storageProvider`.
- The seed archives stale local seed assets that are no longer present in the current operation pack, so old gallery files stop appearing after seed deploy.
- `GET /api/v1/artists/roadmap` returns planned/candidate launch-prep artists only. It does not make them public in the main artist list.
- Planned roadmap items expose launch-prep fields such as `gender`, `launchPhase`, `operationRole`, `publicTagline`, `fandomCandidate`, `thumbnailUrl`, `coverUrl`, `galleryCount`, `imageBaselineNote`, and lightweight `metadata`.
- Current planned seed records include `seo-yuan`, `ha-yuna`, and `kwon-taejun`. `ha-yuna` and `kwon-taejun` stay hidden from `GET /artists` until image QA is complete and their status is changed to `active`.
- User-facing character type taxonomy is fixed to six labels: `아티스트`, `모델`, `배우`, `엔터테이너`, `스포츠`, `기타`.
- `category` and `displayCategory` are the same frontend filter label. Internal tiers such as main/premium/sub/candidate should not be used as public category filters.
- Full 16-slot taxonomy: `아티스트` = yoon-serin, han-seoyul, oh-hyerin, min-chaeon, baek-ria, oh-yuna, cha-dohyun; `모델` = kang-sia, ha-yuna, seo-yuan; `배우` = choi-seojin, lee-jiwon, kwon-taejun; `엔터테이너` = park-doa, seo-hamin; `스포츠` = ryu-taeo; `기타` = temporary fallback for uncategorized or category-test characters.
- If a character has no explicit slug mapping and no `profile.publicMetadata.profileFacts.displayCategory`, the backend returns `기타` so operations can hold ambiguous concepts before approving a new category.
- `GET /api/v1/artists/:artistSlug` accepts an optional bearer access token. When present and valid, the detail response includes `stats.followerCount` and `viewer` follow-button hints (`isAuthenticated`, `isFollowing`, `canFollow`, `canUnfollow`). Anonymous detail responses keep working and return `viewer.isAuthenticated = false`.
- Artist follow/unfollow endpoints still use the artist UUID: `POST /api/v1/artists/:artistId/follow` and `DELETE /api/v1/artists/:artistId/follow`.

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

### Story Stage

Story stage backend contract skeleton (#988):

The exported `STORY_STAGE_PACK_CHAPTER_SESSION_CONTRACT` defines disabled
backend contract shapes for StoryPack, StoryChapter, StorySession, and
StoryChoice. This is not a live API implementation and keeps
`enabled=false`/`publicMutationEnabled=false` until storage, entitlement, and QA
fixtures are ready.

Planned endpoints:

```http
GET /api/v1/story-packs
GET /api/v1/story-packs/:packSlug
GET /api/v1/story-packs/:packSlug/chapters/:chapterNo
POST /api/v1/story-packs/:packSlug/sessions
GET /api/v1/story-sessions/:sessionId/choices
```

- StoryPack pricing modes are `free`, `paid`, and `mixed`; lifecycle statuses
  separate `serializing`, `completed`, `hiatus`, and `season_ended`.
- StoryChapter pricing modes are `free` and `paid`. Locked paid chapters may
  expose only preview fields such as chapter number, title, summary,
  `pricingMode`, `priceLumina`, and `locked`; chapter body stays hidden until
  entitlement is confirmed.
- StorySession creation is future-authenticated and idempotent, scoped by
  user, pack slug, and client idempotency key. Replays with the same
  fingerprint return the same projection; changed fingerprints conflict before
  any mutation.
- StoryChoice projections default to three choices and may expand to five.
  Choice types are display-safe action categories only and do not expose raw
  model prompts or provider payloads.
- This skeleton does not create payment orders, debit wallet/Lumina, grant
  entitlements, create story sessions, submit choices, call AI providers,
  generate image/video assets, create notifications, touch settlement, or touch
  payout.
- #1081 adds `STORY_STAGE_AUTHOR_REVENUE_READ_MODEL_CONTRACT` for read-only
  author revenue preview. It separates chapter gross revenue, season bundle
  discount allocation, AI artist companion participation cost, and story author
  share into distinct buckets. The projection is not payout authority, trusts no
  client-submitted revenue/discount/share values, and does not create payment,
  refund, wallet, settlement, or payout mutations.
- #1117 adds the author revenue bucket allocation skeleton. Calculation order is
  completed chapter purchase revenue, season bundle revenue allocated per
  chapter, refund/chargeback adjustment, AI character companion participation
  cost reserve, then story author share preview. Chapter direct revenue, season
  allocation, AI companion cost, and author preview fields remain separate and
  do not expose provider cost payloads or create settlement, payout, wallet, or
  payment mutation.
- #1187 adds `STORY_STAGE_AUTHOR_SETTLEMENT_REFUND_READ_MODEL` for the author-
  scoped settlement/refund preview. It separates granted story revenue,
  refund/chargeback adjustment, AI companion cost, author share basis, and
  author share preview into distinct fields. The read model is author-only,
  may return 403 or safe 404 for non-owners, and must not expose buyer ids,
  payment ledger ids, wallet ledger ids, raw refund reasons, private author
  notes, or admin memos. It does not create settlement, payout, refund, wallet,
  or wallet-ledger mutations.

### Story Stage Choices and Timeline

Story choice and major-event timeline read model (#989):

`STORY_CHOICE_TIMELINE_READ_MODEL_CONTRACT` defines a disabled read-model
contract for session choices and major timeline events. It does not submit a
choice, mutate story state, call an AI provider, write notifications, or touch
wallet/Lumina/payment/settlement/payout.

- Choice projections default to three choices and may expand to five only when
  scene complexity requires it. Clients cannot submit a replacement choice set.
- Choice rows expose display-safe fields under `story.choices[]`, including
  `choiceNo`, `titleKey`, `body`, `choiceType`, `availability`,
  `disabledReasonKey`, `scenePresence`, and `expectedTimelineEffect`; raw model
  prompts and provider payloads are never returned.
- When the user is present in the scene, choices may include direct
  intervention such as dialogue, physical action, investigation, travel, or
  waiting. When the user is nearby, choices are limited to delayed/limited
  intervention. When the user is far away, the scene is exposed through
  letters, rumors, reports, waiting, or travel rather than direct intervention.
- Major events are projected under `story.timeline.majorEvents[]` with
  display-safe event kind, chapter number, player knowledge state, and story
  time fields. Unknown future/private spoiler bodies and author notes remain
  hidden.

### Story Stage AI Companion Context

Story AI companion context boundary (#990):

`STORY_AI_COMPANION_CONTEXT_BOUNDARY_CONTRACT` defines a disabled context
boundary for bringing AI artists into story sessions. It is not a provider
execution path and does not create chat messages, mutate story state, debit
wallet/Lumina, or touch settlement/payout.

- A story session may select up to five companion artists, but each scene may
  use only two to three active speakers. Remaining companions must be projected
  as cameo, background, or offscreen references.
- Context is layered in priority order: world canon, current scene state,
  approved artist persona/tone profile, then player state. Player choices and
  companion dialogue cannot override world canon or the current scene objective.
- Active speakers may speak and influence choice text. Cameo companions may
  speak briefly but cannot solve the scene. Background/offscreen companions do
  not drive choices.
- #1073 adds `participationBudget`: the target session budget is the player plus
  up to five AI companion artists. Free prologue mode allows solo play or one AI
  companion only, with no paid expansion. Paid story mode may allow up to five
  AI companions, but add/swap cost must come from server story product policy;
  client-submitted cost is never accepted. Overflow companions must be
  summarized or downgraded to cameo/background/offscreen reference before any
  provider context is composed.
- #1134 adds `participationBudget.readModelSelectionProjection`: free prologue
  selection remains capped at one AI companion with no paid expansion, while
  paid story selection may show up to five AI companions. Add/swap cost is a
  server story product policy preview only, client-submitted cost is not
  trusted, and companion changes must preserve existing chapter and season
  entitlements. The previous chapter roster remains immutable, the next chapter
  uses the latest confirmed roster, and selection submit, payment, refund,
  wallet, settlement, payout, and story-progress mutation remain disabled.
- The projection must not expose raw persona prompts, raw world bible text,
  provider payloads, private artist notes, or admin memos.
- #1169 exports `STORY_STAGE_COMPANION_BILLING_PROJECTION_CONTRACT` as the
  backend read model for story entry cost vs AI companion roster cost. Free
  prologue allows at most one AI companion with no paid expansion; paid story
  mode may show up to five AI companions with the first companion free and
  add/swap cost sourced only from server story product policy. Leaving a
  companion costs `0L` and preserves purchased story access. Story entry cost,
  companion roster cost, free companion count, paid companion count, and total
  preview remain separate fields. This does not create story purchase, story
  progress, companion roster, wallet, settlement, payout, or provider mutation.
- #1218 adds `STORY_STAGE_COMPANION_SWAP_COST_PROJECTION_CONTRACT` for
  companion change preview states after a story session exists. It separates
  `keep_existing_companion`, `add_companion`, `swap_companion`, and
  `leave_companion`, keeps companion-change cost separate from story entry
  cost, treats client-submitted roster/cost as untrusted, and preserves
  purchased story/chapter/season access. Leaving does not refund wallet, keeping
  does not create a ledger, and swapping does not revoke existing entitlements.
  The read model does not mutate companion roster, story progress,
  entitlement, payment, wallet, settlement, payout, or provider state.

### Story Stage Direct Action Validation

Story direct action validation policy (#991):

`STORY_DIRECT_ACTION_VALIDATION_CONTRACT` defines a disabled validation
skeleton for user-entered direct story actions. It validates text shape,
timeline continuity, reachable location, world rules, age/safety policy,
author-forbidden outcomes, and character persona integrity before any future
provider or story mutation path.

- Direct action input is plain text, trimmed, 1-500 characters, and rejected
  when empty after trim.
- Fail-closed categories include impossible time jumps, remote intervention
  without an in-world channel, world-rule breaking powers/items, adult sexual
  content, graphic exploitation, self-harm instruction, protected-class hate,
  author-forbidden outcomes, and character/persona-breaking control.
- Rejected responses expose only safe `code`, `messageKey`,
  `safeSuggestionKey`, and `retryAllowed`; raw internal reasons, safety
  classifier payloads, author private rules, prompts, provider payloads, and
  admin memos are not returned.
- This skeleton does not call providers, store direct actions, mutate story or
  timeline state, create notifications, debit wallet/Lumina, or touch
  payment/settlement/payout.

### Story Stage Comments Ratings and Reader Badge

Story comments, ratings, and completed-reader projection (#992):

`STORY_REVIEW_READER_PROJECTION_CONTRACT` defines disabled projections for
story-pack comments/ratings, chapter comments/ratings, and completed-reader
badges. It does not create comments, ratings, reports, notifications, payment,
wallet/Lumina, settlement, or payout rows.

- Story-pack comments and ratings are limited to paid or otherwise entitled
  readers. Chapter comments and ratings are limited to readers entitled to that
  chapter.
- #1099 fixes future submit readiness as auth + confirmed purchase/entitlement
  only. Pack-level comments/ratings require a confirmed pack, season, or paid
  reader entitlement; chapter-level comments/ratings require entitlement to that
  chapter. Authors cannot self-review their own work through this contract, and
  locked or preview-only chapters cannot accept comment/rating submissions.
- #1099 keeps all-pack threads, chapter threads, and rating summaries as
  separate read scopes. Pack threads do not pretend to be chapter comments;
  chapter threads include chapter context; public rating aggregates stay
  anonymous while `viewer.rating` is returned only to that viewer.
- #1099 lets authors read only their own story-pack review summary: pack
  aggregates, chapter breakdown, safe comment previews, rating buckets, and
  completed-reader counts. It must not expose reader lists, reader user ids,
  payment ledger detail, entitlement ids, raw read history, moderation notes, or
  raw report reasons.
- Ratings use a 1-5 integer scale and allow one rating per user per scope in
  the future write contract. The current contract keeps rating mutation
  disabled.
- Completed-reader badge is display-only. It means the viewer completed every
  currently published readable chapter and may appear on comments/ratings, but
  it is not payment authority and does not expose raw read history.
- Comment/rating projections must not expose raw user email, payment ledger id,
  raw read history, raw report reason, or moderation notes.
- #1204 adds a display-safe completed-reader badge projection. Comment/rating
  items may expose `readerBadges.completedReader` with stable label,
  description, and icon keys only. Badge evidence is boolean-only; raw chapter
  progress, entitlement ids, payment ledger ids, and reader private data are
  not returned. The badge remains display-only and does not create comments,
  ratings, badge grants, notifications, wallet, settlement, or payout mutation.

## User APIs

### Auth / Me

```http
GET /api/v1/app/bootstrap
POST /api/v1/auth/register
POST /api/v1/auth/login
GET /api/v1/auth/display-name-availability?displayName=<name>
GET /api/v1/auth/social/providers
POST /api/v1/auth/social/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
POST /api/v1/auth/email-verifications
POST /api/v1/auth/email-verifications/confirm
POST /api/v1/auth/password-resets
POST /api/v1/auth/password-resets/inspect
POST /api/v1/auth/password-resets/confirm
GET /api/v1/me
GET /api/v1/me/summary
GET /api/v1/me/activity-ledger
PATCH /api/v1/me/profile
GET /api/v1/me/profile/display-name-availability?displayName=<name>
GET /api/v1/me/settings
PATCH /api/v1/me/password
PATCH /api/v1/me/password/setup
GET /api/v1/me/assets
GET /api/v1/me/assets/:assetId
POST /api/v1/me/assets/upload-intents
POST /api/v1/me/assets/:assetId/confirm-upload
POST /api/v1/me/assets/:assetId/archive
POST /api/v1/me/assets/:assetId/restore
GET /api/v1/me/notifications
GET /api/v1/me/notifications/unread-count
PATCH /api/v1/me/notifications/:notificationId/read
PATCH /api/v1/me/notifications/read-all
DELETE /api/v1/me
GET /api/v1/me/sessions
DELETE /api/v1/me/sessions
DELETE /api/v1/me/sessions/:sessionId
PATCH /api/v1/me/settings
```

My Page contract:

- `GET /api/v1/app/bootstrap` is public and returns non-secret first-load configuration: localization policy, social provider status, Lumina currency constants, feature flags, lightweight product policies, artist category filter labels, and important endpoint hints.
- `GET /api/v1/auth/social/providers` and `auth.social.providers[]` in bootstrap
  expose only non-secret provider readiness fields for Google/Kakao/Naver:
  `enabled`, `configured`, `status` (`configured` or `not_configured`),
  `statusKey`, `tokenLoginConfigured`, and
  `authorizationCodeLoginConfigured`. They do not return client secrets,
  redirect URI values, provider tokens, or raw provider responses.
- `GET /api/v1/app/bootstrap` includes `policy.artistCategories` with `filterLabels`, `categoryLabels`, `fallbackCategory`, `sourceField`, and response field hints so the frontend can render category filters without hardcoding the taxonomy.
- `GET /api/v1/me` returns `id`, `email`, `status`, `provider`, `providers`, `hasPassword`, `isSocialOnly`, `createdAt`, `displayName`, `publicHandle`, `avatarUrl`, `avatarAsset`, `coverImageUrl`, `coverAsset`, `bio`, `nicknameLastChangedAt`, `nicknameNextChangeAt`, `canChangeNickname`, `profile`, `settings`, and `walletAccounts`. Email and social signup auto-assign a temporary display name and unique public handle like `민트별빛4827` when the request does not include `displayName`; the server checks existing profile handles and retries generation to avoid duplicate auto-assigned handles.
- `GET /api/v1/auth/display-name-availability?displayName=<name>` is public and checks nickname availability before signup.
- `GET /api/v1/me/profile/display-name-availability?displayName=<name>` is authenticated and checks nickname availability for My Page; the current user's own nickname returns `available: true` and `isCurrentUser: true`.
- `PATCH /api/v1/me/profile` accepts `displayName`, `bio`, `avatarAssetId`, and `coverAssetId`. `displayName` is 2-20 characters, must be unique, and is server-limited to one change every 30 days through `user_profiles.nickname_changed_at`; active cooldown returns `429`, duplicate nickname returns `409 DISPLAY_NAME_ALREADY_TAKEN`. Send `{ "coverAssetId": null }` to reset the public profile cover to the frontend default.
- Avatar/cover policy for the first version is asset-based: create/confirm an image asset through the existing upload flow, then set `avatarAssetId` or `coverAssetId`.
- `GET /api/v1/me/summary` is a My Page bootstrap endpoint. It returns `user`, `wallet`, `recentLedger`, `recentPaymentOrders`, `activity.boostEventCounts`, `activity.premiumUnlocks`, `activity.followingArtists`, `activity.followingUsers`, `activity.followers`, `activity.followCounts`, `activity.feedCounts`, `recentActivities`, `debut.latestApplication`, `debut.applications`, and policy hints.
- `GET /api/v1/me/activity-ledger?type=all&take=50` returns a unified My Page activity list. `type` can be `all`, `charge`, `boost`, `unlock`, `gift`, or `free_like`.
- `GET /api/v1/me/settings` returns `{ settings, policy }`.
- `PATCH /api/v1/me/settings` accepts any subset of `locale`, `timezone`, `marketingOptIn`, `pushOptIn`, `activityNotifications`, `feedNotifications`, and `emailNotifications`, or the frontend nested shape `{ notifications: { activityNotifications, marketingOptIn, feedNotifications, emailNotifications, pushOptIn } }`. Empty bodies return `400`. Supported `locale` values are `ko-KR`, `ja-JP`, `en-US`, and `zh-CN`.
- `GET /api/v1/localization/policy` is public and returns localization defaults, supported locales, and the locale detected from `Accept-Language`. Clients should prefer signed-in `settings.locale`, then local storage, then the detected locale, then `ko-KR`.
- `GET /api/v1/me/notifications?status=all&take=20` returns `{ notifications, unreadCount, nextCursor }`. Notification items include `i18n: { messageKey, titleKey, bodyKey, defaultTitle, defaultBody, params }` so clients can map server-created events to locale dictionaries while keeping stored title/body as fallback text. Feed replies, feed likes, and user follows create notification-center rows; read state is managed with the two PATCH endpoints.
- #844 adds the feed notification projection contract for future count lanes:
  feed comments use `feed.reply`, thread continuations use
  `feed.thread_continuation`, and reposts use `feed.repost`. Their unread count
  lanes must stay separate, and deleted, hidden, private, missing, or
  relationship-blocked feed targets are excluded from list/count projections
  without identity leakage. This contract is read-only and does not create feed
  posts, comments, reposts, notifications, wallet, settlement, or payout
  mutations.
- `POST /api/v1/me/assets/upload-intents` creates image-only upload intents for logged-in users. Confirmed assets can be used as avatar images, profile cover images, or feed post `assetIds`.
- `GET /api/v1/me/assets` is the signed-in user's image asset library. Query supports `status=all|pending_upload|uploaded|ready`, `lifecycleStatus=active|archived`, `take`, and `cursor`. It returns `{ items, count, hasMore, nextCursor, policy }`.
- `GET /api/v1/me/assets/:assetId` returns one owned asset plus usage hints. Ownership is checked through `asset.metadata.uploadIntent.createdByUserId`.
- `POST /api/v1/me/assets/:assetId/archive` marks the owned asset as archived in metadata without deleting object storage. It blocks active avatar, active profile cover, published feed, and creator-image request usage unless `{ "force": true }` is explicitly sent.
- `POST /api/v1/me/assets/:assetId/restore` returns an owned archived asset to active.
- `POST /api/v1/lumina-feed/posts` accepts optional `assetIds` with up to 4 existing public image asset UUIDs. The response exposes linked images through post `assets[]` with public URLs.
- #951 exports `LUMINA_FEED_MULTI_IMAGE_ATTACHMENT_CONTRACT` for feed multi-image attachment metadata. Two, three, and four image layouts use `post.assets` sorted by `sortOrder`, and each item exposes only safe attachment metadata: link id, role, sort order, asset id/type/mime/dimensions, display/public URL, and thumbnail URL. Because upload/create remains capped at 4 images, a `+N` overflow badge is not required and overflow count is `0`. This contract does not add image upload, feed create, repost, wallet, Lumina, settlement, or payout mutation.
- `POST /api/v1/lumina-feed/posts/thread` creates a legacy manual Lumina Feed multi-piece post. Canonical "이어쓰기" uses `POST /api/v1/lumina-feed/posts/:postId/thread-continuations` against an existing post instead.
- `GET /api/v1/lumina-feed/posts/:postId/thread-continuations` and `POST /api/v1/lumina-feed/posts/:postId/thread-continuations` keep continuation posts separate from normal comments/replies. Continuation create is login-required and root-author only.
- `POST /api/v1/lumina-feed/posts/:postId/reposts` creates a user-owned repost or quote repost with an original post reference. `POST /api/v1/lumina-feed/posts/:postId/share` returns a share URL/Web Share contract only and does not mutate wallet, Lumina, settlement, payout, order, or paid-like state.
- `PATCH /api/v1/lumina-feed/posts/:postId` edits the current user's own post body. MVP edit scope is body-only; image replacement/removal is not supported yet.
- `PATCH /api/v1/lumina-feed/posts/:postId/thread-items/:itemId` and `DELETE /api/v1/lumina-feed/posts/:postId/thread-items/:itemId` are author-only for non-root thread items. Likes, comments, and images remain root-post based.
- Signed-in `GET /api/v1/me/lumina-feed` post rows include `viewer` and `permissions` hints (`hasLiked`, `isAuthor`, `isFollowingArtist`, `isFollowingAuthor`, `canFollowArtist`, `canUnfollowArtist`, `canFollowAuthor`, `canUnfollowAuthor`, `canEdit`, `canDelete`) for frontend action rendering.
- #743 fixes the feed follow/block interaction contract: feed reads filter active `user_blocks` relationships in either direction, feed writes such as like, reply, repost, and thread continuation fail closed with `403 USER_FOLLOW_BLOCKED` before community/notification mutation, and premium-chat room/message/donation/status surfaces must check the same relationship before wallet, order, settlement, payout, or paid-like work.

이메일/비밀번호 가입 정책:

- 이메일 기반 가입만 지원한다.
- 비밀번호는 8-128자 기준이다. 영문/숫자 조합은 서버 필수 조건으로 강제하지 않는다.

이메일 인증/비밀번호 재설정:

- `user_action_tokens`에 원문 토큰 대신 SHA-256 해시만 저장한다.
- 이메일 인증 토큰 만료는 24시간, 비밀번호 재설정 토큰 만료는 1시간이다.
- 요청 API는 계정 존재 여부를 노출하지 않기 위해 항상 `ok: true` 형태로 응답한다.
- 현재는 메일 발송 adapter가 없는 skeleton 상태이며 `delivery.status = "not_configured"`를 반환한다.
- 실제 메일 provider 연결 전까지 raw token을 로그, Git, Notion, 채팅에 남기지 않는다.

Password setup note:

- `PATCH /api/v1/me/password/setup` lets a logged-in social-only account with an email add its first email password. Existing email-password accounts must use `PATCH /api/v1/me/password`.

Account deletion / moderation policy:

Local/staging QA note:

- `ACTION_TOKEN_DEBUG_ENABLED=true` exposes `debug.actionToken` and `debug.expiresAt` on email verification/password reset request responses only when `NODE_ENV !== production`.
- Production must keep this disabled. The debug field is omitted when the target active account is not found and must not be used by production UI logic.

Email delivery adapter:

- No provider configured: request endpoints keep returning `success: true`, `ok: true`, and `delivery.status = "not_configured"`.
- Provider configured: supported values are `EMAIL_DELIVERY_PROVIDER=resend` or `sendgrid`. The server creates a one-time action token, builds the configured verification/reset URL, and attempts to send it by email. Request endpoint responses stay existence-neutral and return `success: true`, `ok: true`, and the configured delivery status even if provider delivery fails.
- Required non-secret handles: `AUTH_EMAIL_FROM` or `EMAIL_FROM`, plus either explicit action URL bases (`AUTH_EMAIL_VERIFICATION_URL_BASE`, `AUTH_PASSWORD_RESET_URL_BASE`) or a frontend base URL (`FRONTEND_PUBLIC_BASE_URL` or `WEB_PUBLIC_BASE_URL`).
- Provider API keys stay only in environment variables (`RESEND_API_KEY` or `SENDGRID_API_KEY`). Do not record values in docs, Git, Notion, logs, or chat.
- Normal production responses never include the raw action token. Local/staging debug token exposure is still gated by `ACTION_TOKEN_DEBUG_ENABLED=true` and `NODE_ENV !== production`.
- Provider email templates are Korean-first for v1. Email verification subject is `이메일 주소를 한 번만 확인해 주세요`; password reset subject is `비밀번호 재설정 링크가 도착했어요`. Body copy avoids user-facing technical wording such as provider/API/token labels, while the action link still carries the opaque action token in the URL contract.
- Email expiry copy uses a human-readable KST timestamp generated by the backend: `YYYY-MM-DD HH:mm KST`.
- `POST /api/v1/auth/email-verifications/confirm` stores `users.email_verified_at` and `GET /api/v1/me` returns both `emailVerified` and `emailVerifiedAt`.
- `GET /api/v1/me` also returns `emailVerification` so clients can gate core
  account features with stable keys. Unverified email accounts return
  `emailVerification.status = "required"`,
  `emailVerification.code = "AUTH_EMAIL_VERIFICATION_REQUIRED"`,
  `emailVerification.messageKey = "auth.emailVerification.required"`, and
  `emailVerification.gates.coreFeaturesBlockedUntilVerified = true`. Verified
  accounts return `status = "verified"` and
  `messageKey = "auth.emailVerification.verified"`.
- `POST /api/v1/auth/email-verifications` and
  `POST /api/v1/auth/password-resets` include a neutral `policy` object with
  request rate-limit/cooldown hints, token TTL, and duplicate pending token
  behavior. If a still-pending token for the same user/purpose was created
  within the 60 second server cooldown, the request returns the same neutral
  accepted shape without creating a new token or sending another email. Outside
  that cooldown, existing pending tokens for the same user/purpose are consumed
  before a new token is created. Request responses remain existence-neutral and
  never return raw tokens or token hashes outside the existing local/staging
  debug-only gate.
- `POST /api/v1/auth/password-resets/inspect` accepts `{ "token": "<reset-token>" }`
  and returns read-only reset-link state without consuming the token. Response
  shape: `{ success, ok, purpose: "password_reset", status, statusKey,
  canReset, email: { masked, returned }, policy }`. `status` is one of
  `valid`, `invalid`, `expired`, `already_used`, or `user_not_active`. Only
  `valid` may return a stored masked email hint; raw token, token hash, full
  email, and password are never returned. The endpoint exists so reset screens
  can avoid asking the user to re-enter email.
- `POST /api/v1/auth/password-resets/confirm` updates only the email-password account password hash and revokes active refresh-token sessions.
- Password reset, password setup, password change, and email signup all use the
  same 8-128 character length-only password policy. Validation failures return
  `VALIDATION_FAILED` with `messageKey = validation.failed`, and password
  length issues include stable detail messages such as
  `auth.password.minLength`.
- Confirmation endpoints return stable frontend-mappable errors:
  - `AUTH_EMAIL_VERIFICATION_TOKEN_INVALID_OR_EXPIRED` / `auth.emailVerification.tokenInvalidOrExpired`
  - `AUTH_PASSWORD_RESET_TOKEN_INVALID_OR_EXPIRED` / `auth.passwordReset.tokenInvalidOrExpired`
  - `AUTH_EMAIL_PASSWORD_NOT_CONFIGURED` / `auth.password.emailNotConfigured`
  - `AUTH_USER_NOT_ACTIVE` / `auth.user.notActive`
- Invalid/expired/reused verification and reset links keep the same stable
  HTTP status and error code above, but include safe `details.state` as
  `invalid`, `expired`, or `already_used` plus a `details.statusKey` such as
  `auth.emailVerification.expired`. `details.rawTokenReturned=false` and
  `details.tokenHashReturned=false`.

Admin action-token trace:

```http
GET /admin/api/v1/auth/action-tokens?purpose=email_verification&status=pending&deliveryStatus=accepted&deliveryProvider=resend&take=50
```

- Requires `audit:read`.
- Query filters: `purpose=email_verification|password_reset`, `status=all|pending|consumed|expired`, `deliveryStatus=all|not_recorded|pending|accepted|not_configured|failed`, `deliveryProvider=all|none|resend|sendgrid` (or `provider` alias), `userId`, `email`, `take`, and `cursor`.
- Response rows expose only operationally safe fields: `id`, `purpose`, derived `status`, `statusKey`, `createdAt`, `expiresAt`, `consumedAt`, masked `target.emailMasked`, `target.userId`, `target.userStatus`, `target.emailVerified`, and `target.deleted`.
- Delivery fields are persisted on `user_action_tokens` for rows created after this migration: `delivery.status` (`pending`, `accepted`, `not_configured`, `failed`, or historical `not_recorded`), `delivery.channel`, `delivery.provider`, `delivery.attemptedAt`, `delivery.acceptedAt`, and `delivery.failedAt`.
- Request responses stay existence-neutral. If provider delivery throws, the request response still returns the neutral configured delivery status while admin audit stores `delivery.status = "failed"` without raw provider response bodies.
- Cooldown-suppressed duplicate requests do not create a new audit row and do
  not send another provider request. Operators should inspect the existing
  pending token row for `createdAt`, `expiresAt`, and delivery status. The admin
  policy reports `requestCooldownSeconds=60`,
  `duplicatePendingTokenPolicy="reuse_recent_pending_token_within_cooldown_else_consume_previous"`,
  and `cooldownDuplicateRequestsCreateNewRow=false`.
- The response policy explicitly keeps `rawEmailReturned`, `rawTokenReturned`, `tokenHashReturned`, `mailBodyReturned`, and raw provider responses false. Token hashes, raw tokens, mail bodies, provider secrets, signed/provider URLs, and environment values must not be returned or documented.

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
GET /api/v1/lumina-station/charge-policy
GET /api/v1/lumina-station
GET /api/v1/lumina-products
POST /api/v1/payments/orders
GET /api/v1/payments/orders
GET /api/v1/payments/orders/:orderId
POST /api/v1/payments/webhooks/:provider
GET /api/v1/rewards/activation-policy
GET /api/v1/rewards/activation-progress
GET /api/v1/rewards/ledger-policy
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

Provider adapter baseline:

- Registered payment providers are `mock`, `payletter`, and `tosspayments`.
- `payletter` checkout payload uses `mode = "server_request"` and returns non-secret metadata for the server-side Payletter payment request handoff. Required live secrets stay in env only.
- `tosspayments` checkout payload uses `mode = "payment_widget"` and returns the configured public client key plus order metadata for TossPayments checkout setup.
- Client-side success URLs never credit Lumina. Wallet credit still requires a verified provider webhook/callback and matching `payment_orders.provider`.
- Provider keys, webhook secrets, signed payloads, and raw callback tokens must not be written to Git, Notion, or chat.

Lumina Station:

- `GET /api/v1/lumina-station/charge-policy` is public and read-only. It returns
  charge-screen policy copy and package constants only: web `1L = 10 KRW`,
  web paid bonus cap 20%, app launch package prices, free ad-charge display
  policy, and creator image/video request prices.
- `charge-policy.safety.walletMutation = false`,
  `charge-policy.safety.paymentOrderMutation = false`, and
  `charge-policy.safety.adSdkMutation = false`; clients must treat the response
  as display policy only.
- App launch packages are 1,000 KRW = 70L, 3,000 KRW = 210L,
  5,000 KRW = 350L, 10,000 KRW = 700L, 50,000 KRW = 3,750L,
  and 100,000 KRW = 8,000L. 20,000 KRW and 30,000 KRW packages are not part
  of the first charge-policy response.
- Product package bonus and first-charge bonus are separate. Package bonus is
  `lumina_products.bonus_amount` and is repeatable on every purchase.
  First-charge bonus is once per account on the first paid order only, uses 10%
  of `lumina_products.lumina_amount`, and excludes `bonusAmount`. The
  first-charge ledger uses `ledgerType = first_charge_bonus` and
  `idempotencyKey = first_charge_bonus:<userId>`. Fulfillment upserts this
  user-scoped bonus ledger key, so webhook retry, provider replay, or parallel
  first-payment races cannot duplicate the bonus.
- First paid purchase examples: 50,000 KRW = base 5,000L + package bonus 800L +
  first-charge bonus 500L = 6,300L total; 100,000 KRW = base 10,000L + package
  bonus 2,000L + first-charge bonus 1,000L = 13,000L total.
- Free ad charge is labeled `오늘의 무료 루미나 받기`, has a planned daily limit
  of 50, and reserves future ledger source `ad_reward`; no ad SDK or wallet
  grant endpoint is opened by this policy.
- Creator request policy prices are gallery view 0L, basic image 30L, premium
  image 100L, and short video 300L. Short video copy is 3-5 seconds, one
  character, one concept.
- #1217 adds `AI_PREMIUM_CONTENT_ARTIST_CONTEXT_READ_MODEL` for safe
  provider-agnostic artist context reads before image/video request wiring. The
  disabled read endpoint shape is
  `GET /api/v1/ai-premium-content/artists/:artistSlug/context`; it may expose
  safe artist display fields, world/style/safety/forbidden-expression keys,
  allowed request types, and provider route aliases only. It must not return
  provider-ready prompts, provider payloads, model keys, private artist notes,
  admin memos, signed URLs, tokens, cookies, API keys, DB URLs, or raw safety
  payloads. It does not create requests, call OpenAI/GPT Image/Stable
  Diffusion/Seedance providers, debit wallet, create orders, or touch
  settlement/payout/paid-like state.
- `GET /api/v1/lumina-station?take=5` is an authenticated charge-screen bootstrap endpoint.
- It returns the user's Lumina wallet, active six-tier `lumina_products`, recent `payment_orders`, payment provider status, and client display policy. Only canonical server products matching SKU, KRW price, base Lumina, package bonus, and KRW currency are returned; 20,000 KRW, 30,000 KRW, and same-price tampered active rows are filtered out.
- It does not create a payment order and does not grant Lumina.
- The frontend still creates charge orders with `POST /api/v1/payments/orders`. Order creation accepts active products only when they match the server canonical charge packages: `LUMINA_100` 1,000 KRW = 100L, `LUMINA_300` 3,000 KRW = 300L, `LUMINA_500` 5,000 KRW = 500L, `LUMINA_1000` 10,000 KRW = 1,000L, `LUMINA_5800` 50,000 KRW = 5,000L + 800L bonus, and `LUMINA_12000` 100,000 KRW = 10,000L + 2,000L bonus.
- Client-submitted economic fields such as `priceAmount`, `luminaAmount`, `bonusAmount`, or `totalLumina` are ignored for order creation and fulfillment. The order amount, checkout payload, wallet purchase ledger, and first-charge bonus are derived from the matched server product row only.
- `payment.status = "pg_pending"` means the UI may show products but real checkout is pending PG provider approval/integration.
- `products[]` includes frontend convenience fields: `totalLumina`, `unitPriceKrw`, `bonusRate`, `discountAmount`, and `isBestValue`.
- `POST /api/v1/payments/orders` idempotency replay is valid only for the same
  user, Lumina product, and provider. Reusing a key for a different body returns
  `PAYMENT_ORDER_IDEMPOTENCY_CONFLICT` / `payments.order.idempotencyConflict`
  before a new order or checkout payload is created.
- Payment webhook storage keeps a sanitized audit projection only. Raw provider
  payloads, payment tokens, cookies, signed payloads, card data, and secrets
  must not be stored or copied to docs/Notion.
- `GET /api/v1/rewards/activation-policy` returns the current launch reward policy contract: free promo reward cap 3000L, paid bonus cap 20%, daily attendance schedule, planned identity/birthday/profile/social milestones, and anti-abuse notes.
- `GET /api/v1/rewards/activation-progress` returns the signed-in user's cap usage, paid-bonus usage, attendance state, first-charge state, and milestone progress. Planned milestones are display-only until a future grant endpoint is opened.
- `GET /api/v1/rewards/ledger-policy` returns the fail-closed free Lumina reward ledger skeleton for achievements, titles, birthday, identity completion, attendance, profile, and first-action grants. It is read-only, does not open arbitrary reward grants, and states the 3000L lifetime free promo cap plus non-settlement policy.

Artist URL knowledge audit skeleton:

```http
GET /api/v1/chat/artist-url-knowledge-contract
GET /api/v1/me/creator-studio/knowledge-urls
POST /api/v1/me/creator-studio/knowledge-urls
GET /api/v1/admin/api/v1/backstage/operations/artist-knowledge-url-audit-events
```

- `artist-url-knowledge` contract version is
  `2026-06-05.artist-url-knowledge-registration-skeleton.v1`.
- #619 keeps registration fields separated: optional `title`, safe `source`,
  lifecycle `approvalStatus`, bounded `summary`, and `safetyStatus`.
- `safetyStatus` values are `unreviewed`, `needs_review`, `safe`, and `blocked`.
  Only approved rows with `safetyStatus=safe`, `allowChatReference=true`, and a
  non-empty summary may enter character-chat context.
- Raw submitted URL is review material, not chat knowledge. Character-chat
  provider context uses a hostname-only source label and bounded approved
  summary, never the raw URL or full page body.
- #660 fixes the chat context connection shape. The chat service queries only
  approved, chat-enabled rows for the session artist and selects safe summary
  fields only. Raw URL, URL query, raw page body, private body, artist
  description, admin notes, token/cookie/password/API key/provider payload,
  signed/private URL, and DB URL fields are forbidden from provider context
  projection.
- #677 fixes the admin-to-chat handoff fields. Backstage approval may hand off
  only `approvalStatus=approved`, `artistSlug`, bounded `contextSummary`, and
  `safetyFlag=safe` into the character-chat context candidate path. This
  contract is separate from site-content/admin copy editing and does not expose
  raw URL, URL query, raw page body, private material, admin notes, token,
  cookie, password, API key, provider payload, signed/private URL, or DB URL.
- #676 fixes the empty-knowledge fallback contract. If there are no eligible URL
  knowledge rows, character-chat continues with persona, tone-and-manner, and
  opening-greeting variant context. Empty URL knowledge does not block provider
  generation and does not expose unapproved URLs, raw private material, or admin
  notes.
- #712 fixes the chat-context refresh contract. Creator create/update/archive and
  Backstage approve/reject/archive events cause a server-side requery by
  `artistId`; pending, rejected, archived, `unreviewed`, `needs_review`, and
  `blocked` rows stay excluded. Only approved safe rows with
  `allowChatReference=true` and a bounded summary become character-chat context
  candidates. Refresh does not call providers and does not mutate wallet,
  settlement, payout, or paid-like state.
- #745 fixes the approved URL knowledge reuse/cache contract. Character-chat may
  reuse only approved, safe, chat-enabled bounded summaries under the cache key
  `artist-url-knowledge:<artistId>:approved-safe-v1` with `ttlSeconds=300` and
  at most 60 seconds of read-only stale fallback. Creator create/update/archive
  and Backstage approve/reject/archive events invalidate the cache. Raw URLs,
  token-like query strings, private notes, provider payloads, and admin material
  must not be cached or sent to the provider.
- #802 fixes prompt context selection scoring. Scoring runs only after the
  approved/safe/chat-enabled/summary-present gate. Eligible rows are ordered by
  score, then review timestamp, then id. The score includes approved status,
  safe status, chat reference permission, summary presence, review freshness,
  and source priority. Pending, rejected, archived, processing, unsafe,
  disabled, and summaryless rows are excluded before scoring and do not enter
  prompt context.
- #870 fixes the character-chat context bridge contract. Approved URL knowledge
  enters provider context only as lower-priority untrusted reference facts after
  system safety, runtime persona, tone-and-manner, and opening-greeting variant.
  If a URL summary conflicts with character persona or world setting, the
  persona/tone contract wins and the URL item must be dropped or phrased as
  uncertain external reference. Pending, rejected, archived, AI-processing,
  safety-review, blocked, or summaryless rows stay out of provider payloads.
- #969 fixes the approved URL knowledge to character-chat bridge boundary:
  context items expose only display-safe id/title/status/source/summary,
  hostname-only source label, review timestamp, selection metadata, safety flag,
  and `instructionRole=reference_fact_not_instruction`. The bridge excludes
  `canonicalUrl`, private URL query data, admin/review notes, internal metadata,
  provider payloads, auth material, wallet, Lumina, settlement, and payout
  fields, and it performs no external URL fetch or provider call.
- #1016 exports `ARTIST_URL_KNOWLEDGE_APPROVAL_STATE_PROJECTION` for the
  approval lifecycle read model. It separates `pending`, `approved`, `rejected`,
  and `archived` status rows from character-chat eligibility. Only approved
  rows with `allowChatReference=true`, a bounded summary, `safetyStatus=safe`,
  and no `ai_processing` ingest state can become chat context candidates.
  Pending, rejected, archived, unsafe, disabled, processing, and summaryless
  rows stay status-only and excluded from provider context. The projection does
  not crawl external URLs, train providers, generate chat responses, create chat
  messages, approve/reject/archive rows, or mutate wallet, Lumina, settlement,
  payout, or paid-like state.
- #884 adds the future chat-context refresh queue contract. Approval, rejection,
  or archive events may enqueue a deduped server refresh key for the artist, but
  the worker remains disabled and may only requery approved/safe/chat-enabled
  bounded summaries for the same artist. Pending, review, archived, blocked,
  disabled, summaryless, or AI-processing rows remain excluded. The refresh
  queue must not fetch external URLs, call a provider, create chat messages, or
  touch wallet, settlement, or payout state.
- #906 adds `chatContextRefresh.freshnessReadModel` for the future read-only
  freshness API: `GET /api/v1/chat/artists/:artistId/url-knowledge/freshness`.
  It separates approved-for-chat, processing, failed, archived, and pending
  review buckets so UI/QA can see whether approved URL knowledge has entered the
  character-chat context candidate path.
- The #906 read model remains disabled and read-only. Only approved, safe,
  chat-enabled rows with a bounded summary are eligible for context; processing,
  failed, archived, pending, unsafe, disabled, and summaryless rows stay out.
  It does not crawl URLs, call providers, approve/reject/archive rows, mutate
  chat context, or touch wallet, settlement, or payout state.
- #1031 adds
  `ARTIST_URL_KNOWLEDGE_CHAT_CONTEXT_CANDIDATE_API_SKELETON` for the future
  read-only candidate endpoint
  `GET /api/v1/chat/artists/:artistId/url-knowledge/context-candidates`. It
  remains `enabled=false` and `mutation=false`.
- The #1031 candidate endpoint is scoped to the current chat session artist and
  may return only `status=approved`, `allowChatReference=true`,
  `safetyStatus=safe`, bounded-summary rows. `submitted`, `pending_review`,
  `ai_processing`, `rejected`, and `archived` ingest states are excluded before
  scoring or projection.
- The #1031 response projection may expose display-safe id, title, status key,
  source type, approved summary, hostname-only source label, review timestamp,
  selection metadata, `safetyFlag=approved_reference_fact_not_instruction`, and
  `instructionRole=reference_fact_not_instruction`. It must not expose raw or
  canonical URLs, URL query strings, raw page bodies, private bodies, artist
  descriptions, admin/review notes, metadata, provider payloads, auth material,
  API keys, or DB URLs. The endpoint must not fetch external URLs, train/call a
  provider, generate chat replies, create chat messages, approve/reject/archive
  rows, or mutate wallet, Lumina, settlement, or payout state.
- #1047 mounts `GET /api/v1/chat/artist-url-knowledge-preview-fixture` as a
  public read-only preview for live QA when creator/operator sessions are not
  available. It returns inert pending, approved, rejected, archived,
  approved-but-chat-disabled, and approved-but-summary-missing examples so QA
  can verify that only approved, safe, `allowChatReference=true`,
  bounded-summary rows become character-chat context candidates. The preview
  does not crawl external URLs, train or call providers, generate chat replies,
  mutate approval/archive rows, or touch wallet, settlement, payout, tokens,
  cookies, raw emails, raw page bodies, provider payloads, or DB URLs.
- #1097 adds `ARTIST_URL_KNOWLEDGE_INGESTION_STATUS_CONTRACT` to separate URL
  review material, approval lifecycle, chat-context handoff, and safe failure
  reasons. The raw submitted URL remains review material only and cannot enter
  character-chat/provider context. `status` controls approval, `metadata.ingest`
  controls submitted/pending/processing/approved-for-chat/rejected/failed/
  archived visibility, and `context_ready` is derived only when the row is
  approved, safe, `allowChatReference=true`, has a bounded summary, and belongs
  to the same artist. Failure reasons are safe reason keys only; raw exceptions,
  raw page bodies, provider payloads, tokens, cookies, passwords, API keys, DB
  URLs, wallet, settlement, and payout data stay hidden. The contract does not
  fetch external URLs, train/call providers, generate chat replies, create chat
  messages, approve/reject/archive rows, or mutate wallet/settlement/payout.
- #780 fixes the ingest moderation handoff guard. Rows with
  `ingestStatus=ai_processing` stay excluded from character-chat context until
  review marks them `approved_for_chat`; raw URL query strings, private URLs,
  reviewer/admin notes, raw page bodies, and provider payloads stay out of
  provider context.
- The admin audit list endpoint is a read-only skeleton guarded by `audit:read`.
  It returns redacted artist knowledge URL audit event list items only.
- Query shape: `action`, `targetId`, `artistId`, `take`, and opaque `cursor`.
- Projection includes event id, action, `targetType = artist_knowledge_url`,
  target id, actor user id, created timestamp, redacted before/after snapshots,
  changed fields, and status transition.
- Snapshots may expose ids, lifecycle status, source type, allow-chat boolean,
  summary/rejection presence booleans, reviewed timestamp, and archived
  timestamp.
- The projection must not return raw submitted URL, raw URL query, canonical URL,
  artist description text, summary text, rejection reason text, raw page body,
  raw email, token, cookie, password, provider payload, API key, or DB URL.
- The read endpoint does not approve, reject, archive, fetch external pages,
  mutate chat context, call providers, or alter wallet/settlement/payout state.

Identity verification skeleton:

- `GET /api/v1/me/identity-verifications/policy` returns the NICE-first provider
  skeleton contract, supported methods (`mobile_phone`, `ipin`), non-secret env
  readiness flags, and account policy flags. Signup is not blocked before
  identity verification.
- `GET /api/v1/me/trust` returns `accountState` with
  `signupAllowedWithoutIdentityVerification`, `identityVerificationBeforeSignupRequired`,
  derived `identityVerified`, `ageBand`, `minor`, `cleanModeRequired`,
  `ageGate`, `cleanMode`, and non-sensitive identity storage policy.
  Minor clean mode is enforced only when a verified provider birth date proves
  the user is under the configured adult threshold.
- `POST /api/v1/me/identity-verifications` accepts `{ "provider": "nice",
  "method": "mobile_phone" | "phone" | "ipin" }`. When the NICE provider is not
  configured, the endpoint fails closed with
  `IDENTITY_VERIFICATION_PROVIDER_NOT_CONNECTED`, `requestStarted: false`, and
  `messageKey = identityVerification.providerNotConnected` without creating a
  verification marker. Because API errors are wrapped under `error.details`,
  the fail-closed response also includes `details.requestStarted: false`. When
  provider credentials are configured but the adapter is still a skeleton, the
  endpoint may record only an `unverified` request marker and must not report a
  successful identity verification.
- `POST /api/v1/me/identity-verifications/self/confirm` accepts `{ "token":
  "<provider-token>" }` but currently fails closed with
  `IDENTITY_VERIFICATION_PROVIDER_NOT_CONNECTED` and
  `messageKey = identityVerification.providerNotConnected`.
- Invalid confirmation paths return `IDENTITY_VERIFICATION_INVALID_ID` with
  `messageKey = identityVerification.invalidId`.
- Account identity count limits are exposed only as policy flags
  (`enabled: false`, `enforced: false`, `enforcement: policy_flag_only`) until a
  real provider supplies a stable identity subject hash. They are not connected
  to wallet, Lumina, settlement, payout, or reward payout mutations.
- Resident registration numbers, raw identity documents, raw provider tokens,
  NICE raw names, NICE raw phone numbers, and provider secrets must not be
  stored in Git, Notion, chat, or database application metadata.

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
POST /api/v1/boost-campaigns/:campaignId/paid-like
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

Paid like API:

- `POST /api/v1/boost-campaigns/:campaignId/paid-like`
- Auth required.
- Body: `{ "artistSlug": "yoon-serin", "quantity": 1 }`
- Policy: 1 paid like unit costs 10L through the active `BOOST_BASIC_VOTE` product.
- The transaction debits the Lumina wallet, writes `wallet_ledger`, and creates a `lumina_boost` event with `metadata.source = "paid_like"`.
- Daily paid-like limit is 20 units per user per service day.
- `quantity` defaults to 1 and accepts 1-20.
- Limit failures return `400 Daily paid like limit exceeded`.
- Requires `Idempotency-Key` header or body `idempotencyKey` before wallet
  debit.
- `GET /api/v1/me/paid-like-quota` returns the active campaign, daily limit,
  used count, remaining count, reset time, and unit price.

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
GET /api/v1/chat/conversations?box=recent|archive|all&take=20&cursor=<nextCursor>
POST /api/v1/chat/conversations/:sessionId/archive
POST /api/v1/chat/conversations/:sessionId/restore
GET /api/v1/chat/starter-prompts?artistSlug=<artistSlug>
GET /api/v1/chat/starter-prompts?artistId=<artistId>
GET /api/v1/chat/persona-seed-policy
GET /api/v1/chat/character-catalog?artistSlug=<artistSlug>
GET /api/v1/chat/character-catalog?artistId=<artistId>
GET /api/v1/chat/sessions/:sessionId/messages
POST /api/v1/chat/sessions/:sessionId/messages
POST /api/v1/chat/sessions/:sessionId/generate
GET /api/v1/chat-feature-products
POST /api/v1/chat-feature-orders/preview
POST /api/v1/chat-feature-orders
```

정책:

- 일반 캐릭터챗 전체를 유료로 잠그지 않는다.
- 특별 답변, 음성 답장, 이미지형 응답, 특별 대사만 유료 특수 기능으로 처리한다.
- 유료 기능으로 생성된 메시지는 `chat_feature_order_id`와 연결한다.

Starter prompts are authenticated and return beginner-friendly opening message
suggestions before the first character-chat message. The selection itself is free
and only returns copy/policy data; real message sending and generation still
follow the character chat wallet and LLM policy. Artist metadata can override the
default copy with `publicMetadata.chatStarterPromptSets`.

Conversation list is authenticated/read-only and owner-only. It powers the DM
recent conversation and archive surfaces without creating chat messages, calling
the LLM provider, creating feature orders, debiting wallet, or touching
settlement state. Query `box=recent` returns active sessions, `box=archive`
returns archived sessions, and `box=all` returns both. Response:

#909 adds the `CHAT_CONVERSATION_READ_SEPARATION_CONTRACT` read contract so
free AI character-chat conversations and paid premium-chat rooms cannot share a
list/detail source. `/api/v1/chat/conversations` reads only `chat_sessions` with
`productType: "ai_character_chat"`, `billingType:
"free_character_conversation"`, and `respondentType: "ai_character_reply"`.
Premium room lists/details read only `premium_chat_rooms` with `productType:
"artist_direct_premium_dm"`, `billingType: "premium_room_lumina"`, and
`respondentType: "artist_direct_reply"`. Neither surface falls back to the
other, and this contract adds no message send, provider call, premium room open,
wallet, settlement, or payout mutation.

```json
{
  "readOnly": true,
  "ownerOnly": true,
  "box": "recent",
  "items": [
    {
      "id": "chat-session-uuid",
      "box": "recent",
      "status": "active",
      "artist": {
        "id": "artist-uuid",
        "slug": "yoon-serin",
        "displayName": "Yoon Serin"
      },
      "persona": null,
      "messageCount": 3,
      "lastMessage": {
        "id": "message-uuid",
        "senderType": "artist",
        "messageType": "text",
        "bodyPreview": "마지막 메시지 미리보기",
        "previewMessageKey": null,
        "previewAvailable": true,
        "createdAt": "2026-05-17T00:00:00.000Z",
        "paidFeatureOrderPresent": false
      },
      "lastMessageAt": "2026-05-17T00:00:00.000Z",
      "latestMessage": {
        "id": "message-uuid",
        "senderType": "artist",
        "messageType": "text",
        "bodyPreview": "마지막 메시지 미리보기",
        "previewMessageKey": null,
        "previewAvailable": true,
        "createdAt": "2026-05-17T00:00:00.000Z",
        "paidFeatureOrderPresent": false
      },
      "latestAt": "2026-05-17T00:00:00.000Z",
      "lastActivityAt": "2026-05-17T00:00:00.000Z",
      "readState": {
        "supported": false,
        "status": "not_tracked",
        "hasUnread": false,
        "unreadCount": null,
        "lastReadAt": null,
        "badgeVisible": false,
        "source": "not_persisted",
        "messageKey": "chat.conversations.readStateNotAvailable"
      }
    }
  ],
  "count": 1,
  "hasMore": false,
  "nextCursor": null,
  "paginationContract": {
    "defaultTake": 20,
    "maxTake": 50,
    "appliedTake": 20,
    "cursor": null,
    "cursorField": "chat_sessions.id"
  },
  "emptyState": {
    "messageKey": "chat.conversations.emptyRecent",
    "defaultMessageKo": "아직 시작한 대화가 없어요."
  },
  "boxContract": {
    "recentStatus": "active",
    "archiveStatus": "archived",
    "allStatuses": ["active", "archived"]
  },
  "itemShapeContract": {
    "requiredFields": [
      "id",
      "box",
      "status",
      "artist",
      "persona",
      "messageCount",
      "lastMessage",
      "lastMessageAt",
      "latestMessage",
      "latestAt",
      "lastActivityAt",
      "updatedAt",
      "createdAt",
      "readState"
    ],
    "itemsAlwaysArray": true,
    "emptyItemsAllowed": true,
    "lastMessagePreviewMaxChars": 120,
    "lastMessageRawBodyReturned": false,
    "modelMetadataReturned": false,
    "safetyMetadataReturned": false
  },
  "readStateContract": {
    "supported": false,
    "status": "not_tracked",
    "hasUnread": false,
    "unreadCount": null,
    "lastReadAt": null,
    "badgeVisible": false,
    "source": "not_persisted",
    "reason": "read_receipts_not_implemented",
    "messageKey": "chat.conversations.readStateNotAvailable"
  },
  "latestMessageContract": {
    "aliasOf": "lastMessage",
    "previewField": "bodyPreview",
    "previewRawBodyReturned": false,
    "pendingProviderMessageKey": "chat.conversations.latestMessage.pendingProvider",
    "providerFailureMessageKey": "chat.conversations.latestMessage.providerFailed",
    "emptyMessageKey": "chat.conversations.latestMessage.empty"
  },
  "archiveContract": {
    "supported": true,
    "mutationEnabled": true,
    "actions": ["archive", "restore"],
    "archivePathTemplate": "/api/v1/chat/conversations/:sessionId/archive",
    "restorePathTemplate": "/api/v1/chat/conversations/:sessionId/restore",
    "statusField": "chat_sessions.status",
    "activeStatus": "active",
    "archivedStatus": "archived"
  },
  "safety": {
    "llmCall": false,
    "walletMutation": false,
    "messageMutation": false,
    "orderMutation": false,
    "settlementMutation": false,
    "secretsReturned": false
  }
}
```

`latestMessage` is a stable alias of `lastMessage` for DM list clients, and
`latestAt` falls back to the session `updatedAt` when a conversation has no
messages. Preview strings are capped at 120 characters and raw message bodies are
not returned. Pending provider, provider failure, and empty preview states use
`chat.conversations.latestMessage.pendingProvider`,
`chat.conversations.latestMessage.providerFailed`, and
`chat.conversations.latestMessage.empty`.

Unread counts are not opened in this contract because read receipts do not exist
yet. The list returns `readState.status=not_tracked`, `hasUnread=false`,
`unreadCount=null`, and `badgeVisible=false`; frontend should show neutral
read-state copy from `messageKey` instead of inventing unread numbers.

Empty states are explicit by box: `recent` uses
`chat.conversations.emptyRecent`, `archive` uses
`chat.conversations.emptyArchive`, and `all` uses
`chat.conversations.emptyAll`. `take` defaults to 20, is capped at 50, and
invalid non-positive values are rejected before querying.

Conversation archive/restore is authenticated, owner-only, and idempotent:

```http
POST /api/v1/chat/conversations/:sessionId/archive
POST /api/v1/chat/conversations/:sessionId/restore
```

`archive` moves an owned `active` session to `archived`; calling it again for an
already archived session returns `changed=false`. `restore` moves an owned
`archived` session back to `active`; calling it again for an active session also
returns `changed=false`. Unknown sessions, sessions owned by another user, and
states outside `active|archived` fail closed. The endpoints do not create chat
messages, call LLM, create feature orders, debit wallet/Lumina, touch settlement,
or return secrets/raw message body. Response:

```json
{
  "ownerOnly": true,
  "idempotent": true,
  "action": "archive",
  "changed": true,
  "targetStatus": "archived",
  "targetBox": "archive",
  "conversation": {
    "id": "chat-session-uuid",
    "box": "archive",
    "status": "archived",
    "artist": {
      "id": "artist-uuid",
      "slug": "yoon-serin",
      "displayName": "Yoon Serin"
    },
    "persona": null,
    "messageCount": 3,
    "lastMessage": {
      "id": "message-uuid",
      "senderType": "artist",
      "messageType": "text",
      "bodyPreview": "마지막 메시지 미리보기",
      "previewMessageKey": null,
      "previewAvailable": true,
      "createdAt": "2026-05-17T00:00:00.000Z",
      "paidFeatureOrderPresent": false
    },
    "lastMessageAt": "2026-05-17T00:00:00.000Z",
    "latestMessage": {
      "id": "message-uuid",
      "senderType": "artist",
      "messageType": "text",
      "bodyPreview": "마지막 메시지 미리보기",
      "previewMessageKey": null,
      "previewAvailable": true,
      "createdAt": "2026-05-17T00:00:00.000Z",
      "paidFeatureOrderPresent": false
    },
    "latestAt": "2026-05-17T00:00:00.000Z",
    "lastActivityAt": "2026-05-17T00:00:00.000Z",
    "readState": {
      "supported": false,
      "status": "not_tracked",
      "hasUnread": false,
      "unreadCount": null,
      "lastReadAt": null,
      "badgeVisible": false,
      "source": "not_persisted",
      "messageKey": "chat.conversations.readStateNotAvailable"
    }
  },
  "listImpact": {
    "recent": false,
    "archive": true,
    "all": true
  },
  "safety": {
    "llmCall": false,
    "walletMutation": false,
    "messageMutation": false,
    "orderMutation": false,
    "settlementMutation": false,
    "secretsReturned": false
  }
}
```

QA populated verification for #276 is read-only. Use an already approved
disposable owner account that has at least one active chat session with messages
and, for archive QA, at least one archived chat session with messages. Then run
from `server/`:

```bash
npm run qa:chat-conversation-list
```

Required runtime values are `CHARACTER_CHAT_QA_USER_ID` and
`JWT_ACCESS_SECRET`; optional values are `CHARACTER_CHAT_QA_API_BASE`,
`CHARACTER_CHAT_QA_TAKE`, and `CHARACTER_CHAT_QA_ALLOW_MISSING_ARCHIVE`. The
verifier signs a short-lived owner token, calls only
`GET /api/v1/chat/conversations` for `recent`, `archive`, and `all`, and prints
only safe booleans/counts. It does not create chat sessions, create chat
messages, call LLM, create feature orders, debit wallet/Lumina, touch
settlement, or print raw token, cookie, password, DB URL, raw email, owner UUID,
or raw message body. If the populated owner rows are missing, treat the result as
`BLOCKED` until a staging/local disposable seeded state is approved.

Archive populated preparation for #276 is intentionally separate from the
read-only verifier. If an approved disposable owner has recent populated
sessions but no archive populated session, an operator can run:

```bash
npm run qa:chat-archive-fixture
```

The preparation script requires `CHARACTER_CHAT_ARCHIVE_QA_CONFIRM` with the
documented confirmation phrase and `CHARACTER_CHAT_ARCHIVE_QA_USER_ID`. It
defaults to local/staging safety and blocks production-like targets unless
`CHARACTER_CHAT_ARCHIVE_QA_ALLOW_PRODUCTION=true` is explicitly provided for an
approved live-safe disposable owner. It does not create chat sessions, create
chat messages, call LLM, create feature orders, debit wallet/Lumina, touch
settlement, or print raw token, cookie, password, DB URL, raw email, owner UUID,
session UUID, or raw message body. The only write it can perform is changing one
existing populated `chat_sessions.status` from `active` to `archived`; restore
mode can change that same approved session back to `active` when a raw session
id is supplied through the runtime environment.

Persona seed policy is authenticated/read-only and returns the MVP character
persona contract. It does not call LLM, does not debit wallet, and does not write
chat data. The current schema is enough for MVP: `chat_personas.system_prompt`,
`chat_personas.safety_rules`, `chat_personas.model_config`, and optional
`artist_public_profiles.public_metadata.chatPersonaSeed`. Response includes
20+ Korean personality tag candidates, conflict rules, random assignment
settings, creator-editable fields, operator-locked fields, and at least two seed
examples.

Character catalog is authenticated/read-only and returns character-specific
greeting/status/starter option copy for the DM entry UI. It includes policy flags
for beginner display, direct input, gallery as a conversation-earned image
archive, and short video request as hidden/disabled for first launch. It performs
no image/video request mutation, no wallet mutation, and no LLM call. Frontend
must render Korean labels/copy and must not expose machine keys such as
`chat_ready`, `conversation_archive`, or `mvp_not_open` directly to users.

Character-chat copy CMS contract (#335):

- Published `site_content_entries` can override character DM copy with
  `scope=character`, `pageKey=character-chat`,
  `characterSlug=<artistSlug>`, `locale=ko-KR`, and
  `contentKey=character-chat.copy.<artistSlug>`.
- Editable CMS fields are limited to `welcome.text`, starter guide/options,
  direct-input label, `emptyState.text`, `premiumChat.text`,
  `premiumChat.ctaLabel`, `status.labelKo`, and `status.descriptionKo`.
- Fixed product UI labels such as send/archive/report buttons, conversation
  tabs, and provider-state labels remain outside CMS editing.
- Read-only endpoints `GET /api/v1/chat/character-catalog` and
  `GET /api/v1/chat/starter-prompts` use this order:
  published site-content copy, artist metadata, character fallback, default
  safe Korean copy.
- Responses include `copyContract` with the expected content key, editable
  fields, fixed labels, fallback order, and safety flags
  (`rawPersonaPromptExposed=false`, `rawLlmPayloadExposed=false`,
  `mutation=false`, `llmCall=false`, `walletMutation=false`).
- `emptyState` and `premiumChat` are display copy projections only. They do not
  create chat messages, orders, wallet ledger rows, settlement rows, or provider
  calls.
- Character fallback rows also provide character-specific `emptyState.text`,
  `premiumChat.text`, `premiumChat.ctaLabel`, `tone.guideKo`, and
  `personaTags`. Only the final Korean copy/tag arrays should be rendered in UI;
  raw source enums and internal persona/provider prompts remain non-display
  diagnostics.

Character-chat copy isolation check (#342):

- `GET /api/v1/chat/character-catalog` and
  `GET /api/v1/chat/starter-prompts` resolve CMS copy by the requested artist
  slug and expected `contentKey=character-chat.copy.<artistSlug>`.
- The catalog/starter response for one character must not reuse another
  character's welcome text, starter guide, starter option label/message,
  direct-input label, status copy, empty-state copy, or premium-chat copy.
- `copyContract.characterSlug`, `copyContract.contentKey`, and
  `copyContract.source` are the response contract fields frontend/QA should use
  to verify the projected copy source.
- `runtimePersona` and `personaReference` stay read-only public context. Raw
  persona prompts, provider payloads, model names, tokens, keys, wallet/order
  ids, settlement rows, and payout internals are not response fields.

Character-chat greeting and tone contract (#381):

- `GET /api/v1/chat/character-catalog` and
  `GET /api/v1/chat/starter-prompts` expose the first-screen character copy as
  a read-only contract with `greeting`, `openingPrompt`, `tone`, `personaTags`,
  `forbiddenTone`, and `greetingToneContract`.
- `greetingToneContract.version` is
  `2026-05-21.character-chat-greeting-tone.v1`. It is read-only and has
  `providerCall=false`, `mutation=false`, `walletMutation=false`,
  `orderMutation=false`, and `settlementMutation=false`.
- `openingPrompt` contains the first guide text, visible suggested options, and
  direct-input label. It does not create a chat message or call the provider.
- #454 fixes the recommended-reply contract on the existing fields:
  `openingPrompt.options[]`, `starterOptions[]`, and `sets[].options[]` are the
  first-screen recommended reply candidates. They must expose 1 to 3
  display-safe Korean `label`/`message` candidates when character copy exists,
  may use the current two-candidate default plus direct input, and must follow
  the same source order as greetings: published site-content, artist metadata,
  character fallback, default Korean copy.
- Selecting a recommended reply is an input convenience only. It must not create
  a chat message, call the provider, create an order, debit wallet/Lumina, touch
  settlement, or create payout state until the user submits through the normal
  chat message/generation flow.
- `forbiddenTone.items` is a display-safe blocked tone/expression list. It must
  not expose raw persona prompts, provider payloads, model names, tokens, keys,
  or internal prompt secrets.
- The response must support at least two characters with different
  `greeting.text`, `openingPrompt.guideText`, prompt labels/messages,
  `tone.guideKo`, `personaTags`, and `forbiddenTone.items`.
- Frontend/QA should use `copyContract.characterSlug`,
  `copyContract.contentKey`, and `greetingToneContract.characterSlug` to verify
  that one character's first greeting/tone contract is not reused for another.

Character-chat dynamic opening greeting cache (#388):

- `POST /api/v1/chat/sessions` returns an additive `openingGreeting` projection
  after creating the session.
- The opening greeting is stored as a `chat_messages` row with
  `senderType=artist`, `messageType=opening_greeting`, and the new
  `chatSessionId`.
- `GET /api/v1/chat/sessions/:sessionId/messages` checks for the cached
  `opening_greeting` row first. If it exists, the backend returns the cached
  message list without another provider call.
- The cache scope is one greeting per chat session. Refreshing the same session
  must not create or generate a new greeting.
- Same-session concurrent requests are serialized by locking the
  `chat_sessions` row inside the greeting transaction, rechecking the cached
  `opening_greeting`, and generating only when the cached row is still absent.
- #402 adds `openingGreeting.toneCandidate` to the session response and stored
  `opening_greeting` metadata. It snapshots display-safe character tone guide,
  tone tags, and persona tags from the runtime persona contract so QA can verify
  that one character's tone candidate is not reused for another.
- The same character can still produce different first greetings across
  different sessions through provider output or deterministic fallback variant
  seed from `chat_sessions.id`.
- #618 fixes the fallback variant contract at a bounded 5 to 10 display-safe
  greeting candidates. Sparse character data receives at least five template
  candidates, while richer persona/starter/tone data can fill the pool up to the
  ten-candidate cap before deterministic session selection.
- #710 keeps first-greeting variants scoped to character-chat sessions. Variant
  selection uses the session seed, runtime persona tone, persona tags, starter
  messages, and provider cost guard, while provider-failure fallback remains
  character-toned and does not expose raw prompts, provider payloads, wallet,
  settlement, payout, or order fields.
- #778 fixes the operational seed/cache policy: variant selection uses
  `chat_sessions.id` as a derived session seed, never accepts a client-submitted
  seed, and caches exactly one `opening_greeting` per chat session. Same-session
  reloads return the cached greeting, while new sessions for the same character
  can vary for the same user or for different users without provider calls.
- #843 fixes the runtime selection contract: first-greeting variant selection is
  a character-chat-only operation at `opening_greeting_create`, uses a missing
  cached `opening_greeting` as the first-conversation signal, reads tone/persona
  and starter candidates from `runtimePersona`, and records provider usage only
  when a provider call actually happens. Catalog/starter projections remain
  read-only and must not mutate chat messages, wallet, order, settlement, or
  payout state.
- #897 adds `dynamicGreetingContract.selectionContract` for the first-greeting
  variant server contract. Selection uses runtime welcome/starter/tone/persona
  and forbidden-tone catalog inputs, with a user/session-scoped deterministic
  seed based on `chat_sessions.id`. The same session stays stable, while a new
  session may vary without accepting a client seed.
- #1028 adds `dynamicGreetingContract.runtimeHandoff` as the user-facing API
  skeleton for first-greeting variant handoff. `POST /api/v1/chat/sessions`
  exposes `openingGreeting`, while
  `GET /api/v1/chat/sessions/:sessionId/messages` replays the cached
  `opening_greeting` row for the same session without another provider call.
  New sessions use server-derived `chat_sessions.id` variation; client seeds and
  raw seeds are rejected/hidden. Fallback remains deterministic and zero-cost,
  while provider attempts stay behind readiness, daily provider guard,
  `maxOutputTokens=120`, and `maxOutputChars=180`. This skeleton does not add
  provider calls, message sends, wallet, order, settlement, or payout mutation.
- #1043 adds `dynamicGreetingContract.readOnlySessionPreviewFixture` for a
  disabled QA preview surface:
  `GET /api/v1/chat/opening-greeting/session-preview-fixture`. It lets QA
  compare same-session replay, new-session variant, and different-character
  boundary behavior without requesting account credentials and without creating
  live sessions or messages. The fixture may expose display-safe opening
  greeting text, fixture session key, cache booleans, provider-call=false, and
  safe variant policy flags only. It must not return raw session ids, raw seeds,
  raw prompts, provider payloads, tokens, cookies, passwords, API keys, DB URLs,
  or user private data, and it must not call a provider, send messages, create
  sessions/messages, or mutate wallet, order, settlement, or payout state.
  The live fixture response must include `sameSessionReplay`,
  `newSessionVariant`, and `differentCharacterBoundary` scenarios so QA can
  verify cache replay, same-character session variation, and character-scoped
  tone boundaries from one read-only endpoint.
- The #897 safety boundary requires the selected greeting to stay within
  character settings, forbidden tone, and minor-clean rules. It explicitly
  blocks real-person relationship, external contact, and external payment
  prompts. Provider generation, message send, wallet, order, settlement, and
  payout mutations remain unavailable for this contract.
- #968 fixes the conversation-level record contract for opening greeting
  variants. The selected first-greeting text is persisted only as the
  `opening_greeting` message body for that `chat_session`, and
  `openingGreeting.generation.variantPolicy.conversationRecord` exposes only
  safe policy fields: record table, message type, scope, replay behavior, and
  raw seed/prompt/provider-payload exclusion flags. The raw seed, prompt,
  provider payload, wallet, Lumina, settlement, payout, and order fields are not
  returned.
- #1012 adds `dynamicGreetingContract.perSessionVariantReadModel` to make the
  per-user/per-session variant boundary explicit. A character-chat session gets
  exactly one opening greeting; the same session replays the cached greeting,
  while a new session for the same character/user or a different user may select
  a different variant from persona, tone tag, forbidden-tone, welcome, and
  `chat_sessions.id` inputs. The boundary keeps provider generation optional,
  applies persona/tone/forbidden rules, caps output at 120 tokens and 180
  characters, and does not create wallet, order, settlement, payout, or extra
  message-send mutations.
- #1070 adds `dynamicGreetingContract.variantPolicy.sameCharacterVariantPolicy`
  and mirrors it on `openingGreeting.generation.variantPolicy`. The same
  character may show a different display-safe greeting variant for a new user or
  a new chat session, but the same session must replay the cached
  `opening_greeting`. The policy never accepts a client-submitted seed and never
  returns raw seeds, raw prompts, provider payloads, or wallet/order/settlement/
  payout data. It also keeps provider calls optional and does not open message
  send mutation.
- #1166 tightens the read model for the opening greeting preview fixture. The
  fixture exposes a display-safe `variantPolicy.readModel` and
  `toneCandidate` scope that must stay locked to the requested character slug.
  Different-character boundary reads must not reuse cross-character fallback
  copy or persona scope, and the response still does not return raw prompts,
  provider payloads, seeds, tokens, cookies, passwords, API keys, DB URLs, or
  wallet/order/settlement/payout data.
- #1096 adds `dynamicGreetingContract.rotationContract` to prevent a global
  fixed first-greeting sentence across all users. Rotation is scoped to the
  character/user/chat-session boundary, draws from a character-scoped 5 to 10
  candidate pool, and uses `chat_sessions.id` as the server-side deterministic
  conversation seed. The same session still replays the cached
  `opening_greeting`; new sessions or different users may rotate. The contract
  does not accept client rotation overrides, does not expose/store raw seed or
  raw prompt data, and does not add provider, message-send, wallet, order,
  settlement, or payout mutation.
- Provider generation is short and low-cost by contract:
  `maxOutputTokens=120`, `maxOutputChars=180`, lightweight model preferred.
- Provider generation remains optional and separated from cache/template
  fallback. Cached reads and refreshes do not create another provider request.
- If provider readiness, daily guard, or request fails, the backend stores a
  character-specific fallback greeting from site-content copy, artist metadata,
  character fallback, or default copy.
- Cost guard for #454: recommended reply candidates are read-only projection
  data and always zero-provider-call. Dynamic first greeting is the only
  first-entry provider candidate, and it remains behind provider readiness,
  daily request/failure guards, one-per-session cache, and short-output limits.
- `dynamicGreetingContract.version` is
  `2026-06-05.character-chat-opening-greeting-variants.v1` and is exposed on
  `GET /api/v1/chat/character-catalog` and
  `GET /api/v1/chat/starter-prompts`.
- Opening greeting metadata must not store or return raw prompts, provider
  payloads, tokens, API keys, user private data, wallet/order/settlement ids, or
  payout internals.
- Forbidden-tone and minor-clean standards stay display-only and character
  scoped: first greetings must avoid real-person contact/relationship/payment
  prompts and expose only safe tone/persona candidate fields.
- `openingGreeting.toneCandidate` is display-safe contract data only. Do not
  treat it as an editable system prompt or expose raw metadata keys as user copy.
- #874 adds `greetingSelectionAnalyticsContract` to
  `GET /api/v1/chat/character-catalog` and
  `GET /api/v1/chat/starter-prompts`. It defines the future
  `character_chat.greeting_option_selected` event as write-blocked for now and
  allows only safe aggregate dimensions such as character slug, candidate
  key/index/source, tone/persona tags, locale, and selected date.
- #874 analytics must not store or return selected message body, full chat
  transcript, freeform user input, raw persona prompts, raw provider payloads,
  email, token, cookie, password, API key, or DB URL. Candidate selection does
  not create chat messages, call providers, create orders, debit wallet/Lumina,
  or touch settlement/payout state.

Character-chat premium transition CTA contract (#500/#511):

- `GET /api/v1/chat/character-catalog` and
  `GET /api/v1/chat/starter-prompts` include
  `premiumChat.transitionCta.version =
  2026-05-27.character-chat-premium-routing-product-separation.v1`.
- The transition CTA is read-only and submit-blocked:
  `enabled=false`, `roomOpenCta.submitEnabled=false`,
  `walletDebitEnabled=false`, and `roomOpenOrderEnabled=false`.
- #511 fixes the routing/product separation contract:
  `characterDetailCtaProjection.aiChatCta` is the only CTA that points to
  `/character-chat?slug={artistSlug}` and is explicitly `ai_character_chat` /
  `ai_character_reply`.
- `characterDetailCtaProjection.premiumChatCta` is explicitly
  `artist_direct_premium_dm` / `artist_direct_reply`, disabled while room-open
  is not enabled, and has `hrefTemplate=null` plus `fallbackHrefTemplate=null`.
  Premium unavailable states must not route users to `/character-chat` as a
  substitute.
- `routingSeparation` keeps starter prompts and random/dynamic opening
  greetings scoped to character chat only. Premium room list/detail projections
  are artist direct-reply DM surfaces and must not reuse character-chat starter
  prompt or random greeting behavior.
- The visible copy separates normal character chat from artist direct-reply
  premium chat. It must not imply an automatic AI reply for premium chat.
- #744 adds an explicit route/state guard: premium-chat CTAs must not route to
  `/character-chat`, must not use `ai_character_chat`/`ai_character_reply`,
  and must not reuse character starter prompts or opening greetings. Character
  chat must not create premium rooms, and premium-chat room open remains
  submit/wallet/provider disabled until the room contract is opened.
- #881 adds `productFlowGuard` to make the split auditable before UI/API QA:
  character chat is the only flow that can create an AI character
  conversation, while the premium chat CTA is an artist-direct DM flow with
  `disabled=true`, `disabledReasonKey =
  premium_chat_room_open_contract_pending`, and no room-open submit.
  Entering from an artist detail premium CTA must not create a character-chat
  conversation, must not fall back to `/character-chat`, and must not trigger
  provider, room-open, payment, wallet, settlement, or payout side effects.
- #950 adds `chatEntryAvailabilityProjection` for the character detail surface.
  It separates AI character chat, premium chat, support, and follow availability
  in one read projection. AI character chat may route to
  `/character-chat?slug={artistSlug}`; premium chat remains disabled with no
  href/fallback while room-open is contract-pending; support remains disabled
  unless a premium room can exist; follow uses the existing artist viewer/follow
  hints. Disabled premium chat must not fallback to AI chat, open a paid room,
  send a message, create payment, debit wallet, touch settlement, or touch
  payout.
- #1078 adds `characterDetailRoutingContract` as the stable routing table for
  the same surface. `destinations.characterChat` is the only enabled destination
  with `/character-chat?slug={artistSlug}` and remains `ai_character_chat` /
  `ai_character_reply`. `destinations.premiumChat` remains disabled with
  `destinationPathTemplate=null`,
  `premiumAvailabilityState="room_open_contract_pending"`, and
  `disabledReasonKey="premium_chat_room_open_contract_pending"`. These state
  keys are contract values only and must not be rendered as raw UI copy.
- `roomStateReasons` provides Korean user-facing reasons for available,
  artist-resting, under-review, expired, and unavailable states. Frontend must
  render those Korean messages instead of raw state keys.
- `priceSummary` is summary-only copy for room-open/support display. It must not
  expose internal formulas, ledgers, provider payloads, prompts, tokens, or
  settlement/payout internals.
- #1029 adds
  `characterDetailChatChoiceStateProjection` for the character detail chat
  selector. It exposes separate entries for AI character chat and artist-direct
  premium chat with explicit `productKind`, `responseMode`, availability, route,
  CTA label key, price copy key, duration copy key, and respondent copy key. AI
  chat may create an AI character-chat conversation through
  `/character-chat?slug={artistSlug}`. Premium artist chat remains disabled
  while room-open is pending, must not fall back to AI chat, and must use
  server-owned price/duration copy keys. The projection does not open premium
  rooms, send messages, call providers, create payments/orders, or mutate
  wallet, settlement, or payout state.
- The same CTA contract is also referenced from
  `GET /api/v1/chat/premium-support-contract` as
  `productProjection.characterChatTransitionCta` so product QA can verify the
  character-chat entry point and premium-chat product copy together.

LLM generation readiness:

- Generation is fail-closed until a provider adapter is configured:
  `CHAT_LLM_PROVIDER_NOT_CONFIGURED` with `messageKey =
  chat.generation.providerNotConfigured`.
- `policy.generation.canGenerate=false` means frontend must keep paid
  generation CTAs disabled. New paid chat feature orders are blocked before
  wallet debit while the provider is not configured.
- Generated assistant usage metadata is stored in `chat_messages.model_metadata`;
  safety metadata is stored in `chat_messages.safety_metadata`.
- #203 product policy skeleton keeps public paid chat products explicit:
  `CHAT_DEEP_REPLY` 2L, `CHAT_STORY_REPLY` 5L, `CHAT_PREMIUM_REPLY` 10L, and
  `CHAT_FANLETTER_30/50/100` 30L/50L/100L. Preview/product responses include
  Korean fallback copy, `disabledReason`, `disabledMessageKey`,
  `disabledDisplayMessageKo`, order flow, generation mode, cost ceiling,
  `creatorShareEligible`, and `settlementSource`. Frontend must not display raw
  enum values such as `provider_not_configured` or `async_reviewed_fan_letter`
  directly.

Premium chat support and ranking contract (#328/#348/#349/#372/#376):

```http
GET /api/v1/chat/premium-support-contract
Authorization: Bearer <accessToken>
```

This is an authenticated, read-only contract endpoint for the premium-chat
support UI. It returns fixed support amounts, future donation endpoint shapes,
premium room-open policy, ledger source names, idempotency rules, refund/report
policy, and separated ranking projection lanes. It does not create chat
messages, create rooms, create orders, debit wallet/Lumina, touch settlement,
touch payout, or write ledger rows.

Current response status is `contract_ready_mutation_blocked`. Frontend may use
the contract for copy, button layout, and disabled-state wiring, but must keep
room-open and donation submit disabled until the server exposes the planned
create endpoints as enabled.

Premium chat room refund status read model (#1267):

- `PREMIUM_CHAT_ROOM_REFUND_STATUS_READ_MODEL_CONTRACT` exposes disabled
  contract metadata for `GET /api/v1/chat/me/premium-rooms/:roomId/status`.
- The projection separates active, `closed_by_artist`, `refund_pending`,
  70% user-fault limitation, 50% operator-sanction limitation, and terminal
  refunded states for UI/API QA without writing room status or refund rows.
- Calculated policy fields are display/read-model only: unanswered refund
  threshold is 24 hours, artist forced close returns 100% to the user, the
  artist exception compensation field is 10%, and user-fault limitations are
  70% or 50% user refund basis.
- The projection must not expose raw chat body, support message, report reason,
  admin note, wallet/accounting ledger ids, or private user email. Refund,
  wallet debit/credit, settlement, payout, room status write, and ledger write
  mutations remain disabled.

Fixed support amounts:

```json
[10, 50, 100, 500, 1000, 5000, 10000, 50000]
```

Planned donation preview and create endpoints:

```http
POST /api/v1/chat/sessions/:sessionId/donations/preview
POST /api/v1/chat/sessions/:sessionId/donations
Authorization: Bearer <accessToken>
Idempotency-Key: <client-generated-key>
```

Create body contract:

```json
{
  "amountLumina": "100",
  "message": "optional short support message",
  "idempotencyKey": "client-generated-key"
}
```

Before the create endpoint can be enabled, the backend must add the required DB
event/projection storage and update the wallet ledger type check to include:

- `premium_chat_open`
- `premium_chat_message`
- `premium_chat_donation`

Donation order and ledger contract (#348):

- Planned donation create returns both an `order` projection and a safe
  `donation` event projection. The order type is `premium_chat_donation`; the
  order status flow is `pending`, `confirmed`, `failed`, `refunded`,
  `chargeback_review`, `cancelled`.
- After confirmation, the server treats `id`, `userId`, `artistId`,
  `sessionId`, `amountLumina`, and `idempotencyKey` as immutable order fields.
- No client-submitted field is trusted for wallet debit authority. The server
  normalizes amount, validates ownership and room state, then reads
  `wallet_accounts.cached_balance` inside the DB transaction.
- The ledger write uses `ledgerType=premium_chat_donation`,
  `referenceType=premium_chat_donation`, `direction=debit`, and
  `referenceId` from the premium-chat donation order id.
- Validation order is auth, session ownership, supportable room state, amount,
  message length, idempotency key, idempotency fingerprint, active/sufficient
  wallet, then trust/identity gate for high-value support.
- Failed auth, missing/other-user session, blocked room state, invalid amount,
  or invalid idempotency key must return before wallet lookup or mutation.

Premium chat donation and ranking API contract (#376):

The following shapes are exposed through
`GET /api/v1/chat/premium-support-contract` as disabled API contracts. They are
for frontend/backend wiring alignment only and do not make the endpoints live.

```http
POST /api/v1/chat/sessions/:sessionId/donations
GET /api/v1/chat/rankings?type=communication&period=weekly&take=20
GET /api/v1/chat/rankings?type=donation&period=weekly&take=20
GET /api/v1/chat/me/premium-donations?period=monthly&status=confirmed&take=20
```

- `apiContracts.donationCreate.enabled=false` and
  `publicMutationEnabled=false`. Future wallet debit remains server-authority
  only and requires storage, wallet ledger allowlist, moderation guard,
  idempotency replay projection, and ranking read-model refresh work.
- Donation presets are 10L, 50L, 100L, 500L, 1,000L, 5,000L, 10,000L, and
  50,000L. Custom donation is 1L through 50,000L, integer only.
- Donation create accepts an optional message up to 200 chars and requires an
  idempotency key from the header or body.
- The optional donation `message` is a premium-chat support message only. It is
  not a Lumina Pick like event, not a client-submitted ranking score, and must
  never feed `/api/v1/boost-campaigns/:campaignId/rankings` or a chat
  `type=like` alias. After storage exists, it may affect only the premium-chat
  communication/support and donation projections, and ranking projections must
  not return the raw message body.
- #478 adds `productProjection.supportMessageProjection` as the display-only
  chat/product projection for the support sheet and room system event. It
  exposes the same fixed amount list
  `10/50/100/500/1000/5000/10000/50000L`, the custom 1L-50,000L policy, and
  separate `userVisibleCopy` / `artistVisibleCopy` keys. It does not create an
  AI reply, chat message, wallet debit, ranking row, settlement, or payout.
- Donation amount is normalized by the server. Client balance, local price,
  support score, ranking refresh, and remaining-room meter values are not
  authority. A same idempotency key with the same fingerprint replays the
  existing projection; a same key with a different `sessionId`, `amountLumina`,
  or `message` returns `PREMIUM_CHAT_DONATION_IDEMPOTENCY_CONFLICT` before
  wallet lookup or ledger mutation.
- Future donation debit must read `wallet_accounts.cached_balance` in the
  transaction and use an atomic `cached_balance >= server_amount` guard. If the
  guard fails, no donation order, donation event, wallet ledger,
  support-point row, or ranking row is written.
- Donation create is blocked before wallet lookup for reported, blind,
  suspended, refund-pending, refunded, admin-review, expired, or closed rooms.
- Ranking list is read-only and disabled. The frontend cannot submit scores or
  request score refresh mutation.
- Donation ranking uses confirmed net premium-chat donation only. It excludes
  free likes, Lumina boosts, room-open rows, message rows, reported/blinded
  rows, refunded rows, chargeback rows, and cancelled rows.
- Communication ranking remains a separate server-weighted lane for room open,
  safe visible message activity, confirmed net donation, and safe artist reply
  activity.
- #972 exports
  `PREMIUM_CHAT_COMMUNICATION_DONATION_RANKING_READ_MODEL_CONTRACT` as a
  disabled read-model contract for premium-chat rankings. The communication
  lane uses confirmed room opens, safe visible message activity, confirmed net
  donation as a weighted factor, and safe artist reply activity; the donation
  lane uses only confirmed net premium-chat donation after refund or chargeback
  filtering. Both lanes exclude free likes, Lumina boosts, reported/blinded
  rows, refunded or chargeback rows, cancelled donation rows, suspended rooms,
  and admin-review rows until operator-safe. The response must use label and
  summary keys, must not expose raw chat/support bodies, report reasons, wallet
  ledger ids, support-point ledger ids, message ids, raw user ids, or internal
  score formulas, and must not alias premium-chat rankings to Lumina Pick/boost
  rankings.
- #1072 fixes the support amount projection for ranking contracts. Confirmed
  net donations from fixed presets `10/50/100/500/1000/5000/10000/50000L` and
  server-normalized direct input from `1L` through `50000L` may feed only the
  premium-chat communication lane as a weighted support factor and the donation
  lane as confirmed net donation. Gross donation amounts, refunded/chargeback/
  cancelled rows, reported/blinded/suspended/admin-review rows, room-open rows,
  message rows, free likes, and Lumina boosts are excluded from donation
  ranking. This remains a disabled read-model contract and does not create
  support, wallet, settlement, payout, ranking snapshot, or client score-refresh
  mutation.
- #1133 keeps the premium-chat support ranking projection separated from like
  rankings. The support contract exposes display-only amount authority for the
  fixed `10/50/100/500/1000/5000/10000/50000L` presets and server-normalized
  custom `1L`-`50000L` support, but client-submitted ranking amounts, wallet
  balance, settlement amount, and payout amount are not projection authority.
  Communication ranking may use confirmed support only as a weighted factor,
  donation ranking uses confirmed net support amount only, and neither lane may
  consume Lumina Pick likes or Lumina boosts. Ranking refresh, support-point
  ledger writes, wallet, settlement, and payout mutation remain disabled.
- My donation history is owner-only and disabled. It returns safe donation
  projection fields plus filtered summary totals only. Other-user access must be
  safe 404 or 403 without identity leakage.
- Donation, ranking, and history projections must not expose raw chat bodies,
  raw report reasons, wallet ledger ids, support point ledger ids, conversation
  meter ledger ids, internal admin notes, raw payloads, counterparty user ids,
  or message ids.

Premium room-open/refund/moderation contract (#331/#383/#395):

- Room tiers are 300L, 500L, 1,000L, and 3,000L.
- The server evaluates all follower unlock gates. Clients cannot unlock a tier
  by submitting a follower count, local balance, price, or paid amount.
- Initial artists are limited to the 300L tier until the server unlocks 500L,
  1,000L, or 3,000L by stored artist policy. 3,000L is the current maximum tier;
  5,000L or higher room tiers are invalid until a later server policy adds them.
- Base room duration is 3 days. Artist setting can extend the room up to a
  10-day total, and server-calculated expiry is authoritative.
- Future room-open create requires an idempotency key and a server wallet debit
  key scoped as `premium-chat-room-open:<artistId>:<client-idempotency-key>`.
- Room-open retry uses the same replay rule: same key and same
  `artistId/tierKey/amountLumina` fingerprint returns the existing projection;
  a mismatch returns `PREMIUM_CHAT_ROOM_IDEMPOTENCY_CONFLICT` before wallet
  lookup. Future room-open debit must use server tier amount plus an atomic
  `wallet_accounts.cached_balance >= server_amount` guard.
- 24-hour no-answer refund is a server-generated 100% refund path.
- Artist forced close outside a normal answered/expired close moves through
  `refund_pending` and is a server-generated 100% refund candidate.
- User-fault partial refund allows 70% or 50% user refund only by server/admin
  decision; client-submitted `refundRate` is ignored or rejected.
- The 70% user-fault outcome records planned entries for 70% user refund, 20%
  company retention, and 10% artist compensation. The 50% outcome records 50%
  user refund, 40% company retention, and 10% artist compensation. The
  restricted portion is split as 10% artist / remainder company, and there is
  no policy-hold row in the #395 room contract.
- Room-open policy responses expose only public reason fields (`reasonKey`,
  `messageKey`, optional localized `labels`) and must not expose internal admin
  notes, wallet ledger ids, provider payloads, raw user email, tokens, cookies,
  or DB URLs.
- Artist compensation is only a future accounting candidate; settlement and
  payout mutation stay disabled until a later settlement task.
- Report intake uses reported/blind/suspended/admin-review processing and no
  wallet action before admin decision.
- `closed`, `artist_closed`, `expired`, `reported`, `blind`, `suspended`,
  `refund_pending`, `refunded`, and `admin_review` fail closed before support,
  debit, message, conversation-meter, support-point, settlement, or payout
  mutation.

Premium room status read API contract (#384):

The following read-only API shapes are exposed through
`GET /api/v1/chat/premium-support-contract` under
`apiContracts.userRoomStatus`, `apiContracts.artistRoomStatus`, and
`roomStatusRead`. #532 mounts the owner and artist-operator status endpoints as
read-only projections backed by the `premium_chat_rooms` read model. Report,
refund, wallet, settlement, payout, support, and conversation mutations remain
disabled.

```http
GET /api/v1/chat/me/premium-rooms/:roomId/status
GET /api/v1/creator-studio/premium-chat/rooms/:roomId/status
Authorization: Bearer <accessToken>
```

- Both endpoints are authenticated, owner/operator-only, read-only projections.
- Owner users may read their own room status, safe refund state, and safe report
  processing state.
- Artist owners may read rooms opened to their own artist profile, safe report
  pending state, safe refund state, and display-only force-close availability.
- Unauthenticated access returns `401 auth_required`.
- Non-owner user or artist access returns `403` or safe `404` without identity
  leakage.
- Status keys currently covered are `opened`, `active`, `artist_answered`,
  `reported`, `blind`, `blinded`, `suspended`, `admin_review`,
  `refund_pending`, `refunded`, `closed`, `artist_closed`, and `expired`,
  always paired with stable Korean-copy label keys. Clients must not display
  raw status enums as the only user-facing copy.
- Response projections are `premiumRoomStatus`, `premiumRoomRefundStatus`,
  `premiumRoomReportStatus`, and `premiumRoomMutationAvailability`.
- The projections must not include raw chat bodies, raw report reasons,
  reporter user ids, counterparty private user ids, wallet ledger ids, support
  point ledger ids, conversation meter ledger ids, internal admin notes,
  provider refund ids, raw payloads, tokens, cookies, or DB URLs.
- `closed`, `reported`, `refund_pending`, `refunded`, `admin_review`,
  `suspended`, `blind`, `expired`, and `artist_closed` remain fail-closed for
  message, support, donation, refund, wallet, settlement, and payout mutation.
- Repeated refund or report status reads must replay the existing projection and
  must not create duplicate refund ledger or moderation rows.

Premium room admin report/refund read-only contract (#516):

`GET /api/v1/chat/premium-support-contract` exposes
`adminReportRefundReadOnly` as a planned Backstage/operator read contract. The
planned endpoints remain `enabled=false` and read-only until premium-chat room,
report, refund decision, and accounting storage exists.

```http
GET /admin/api/v1/backstage/premium-chat/report-refund-rooms
GET /admin/api/v1/backstage/premium-chat/report-refund-rooms/:roomId
Authorization: Bearer <adminAccessToken>
```

- The list/detail projections are admin-only and read-only. They do not change
  room status, report state, refund decision, wallet credit/debit, provider
  refund, accounting ledger, settlement, or payout state.
- Query/status keys cover `reported`, `blinded`, `suspended`, `admin_review`,
  `refund_pending`, `refund_limited_70`, `refund_limited_50`, `refunded`,
  `closed_by_artist`, and `closed_by_operator`.
- The admin detail projection may show safe refund restriction metadata for
  user-fault decisions: 70% user refund with 20% company retention and 10%
  artist compensation, or 50% user refund with 40% company retention and 10%
  artist compensation. These are display-only until a separate write endpoint is
  approved.
- The projection may return stable report/refund reason keys and status label
  keys, but not raw chat bodies, raw report bodies/reasons, internal admin
  notes, reporter/counterparty user ids, email, phone, private profile fields,
  wallet ledger ids, provider refund ids, tokens, cookies, secrets, or DB URLs.

Premium room interaction status matrix (#473):

`GET /api/v1/chat/premium-support-contract` exposes
`roomStatusRead.interactionStatusMatrix` and
`roomStatusRead.unansweredRefundTransition` so frontend and later backend
implementation can separate normal rooms from 24-hour unanswered refund
candidates before mutation routes are enabled.

- `opened`, `active`, and `artist_answered` use `safe_conversation` read mode
  and allow future user send, artist reply, donation, message-meter, and
  premium-chat communication/donation ranking eligibility.
- `reported`, `blind`, `suspended`, `admin_review`, and `refund_pending` use
  `safe_status_only` read mode and disable user send, artist reply, donation,
  message-meter, support-point grant, ranking eligibility, wallet, settlement,
  and payout mutation.
- `refunded`, `expired`, `closed`, and `artist_closed` use `safe_archive` read
  mode and keep user send, artist reply, and donation disabled.
- 24-hour no-answer handling is a candidate transition only. The eligible
  source statuses are exactly `opened` and `active`; `artist_answered`,
  `reported`, `blind`, `suspended`, `admin_review`, `refund_pending`,
  `refunded`, `expired`, `closed`, and `artist_closed` are not eligible for the
  simple unanswered path.
- The first artist answer is server evidence, not client copy: a room with
  `room.status=artist_answered`, a stored first artist reply timestamp, or a
  server-computed `hasArtistAnswer=true` must not become an unanswered refund
  candidate even if it is older than 24 hours.
- An eligible room with no artist answer at or after 24 hours resolves to
  `refund_pending` with reason key `unanswered_24h_full_refund` and action key
  `unanswered_24h_refund_candidate`; this is not a completed refund. Actual
  wallet/PG refund credit, settlement, payout, and revenue-sharing mutation stay
  disabled until a later approved operator/server decision.
- Excluded status reason keys are separated so user-fault/report review does
  not mix with simple unanswered protection: `artist_answered`,
  `report_or_admin_review_not_unanswered`, `terminal_status_not_unanswered`,
  and `not_yet_24h`.
- The accounting contract for this candidate is ratio/state-only:
  `userRefundBps=10000`, company revenue `0`, artist compensation `0`,
  automatic refund credit `false`, settlement mutation `false`, payout mutation
  `false`.
- After a room is in `refund_pending`, send/reply/donation stay disabled and
  repeated candidate evaluation replays the existing safe projection without a
  second refund, wallet ledger, settlement, payout, or status-event mutation.
- Unknown future room statuses fail closed as `safe_status_only`.
- #1014 adds `PREMIUM_CHAT_UNANSWERED_REFUND_STATUS_PROJECTION` for the 24-hour
  no-artist-answer read model. Active/opened rooms with no artist answer after
  24 hours can project `refund_pending` with reason
  `unanswered_24h_full_refund`, but this remains a candidate state and never a
  completed refund. User-fault/report/sanction paths stay separate:
  `refund_limited_70` means 70% user refund, 20% company retention, and 10%
  artist compensation; `refund_limited_50` means 50% user refund, 40% company
  retention, and 10% artist compensation. The projection returns status and
  rate keys only and does not create refunds, wallet credits/debits, accounting
  ledger rows, settlement, payout, notifications, or room status mutation.

Premium chat hub status matrix projection (#933):

`GET /api/v1/chat/premium-support-contract` exposes
`hubStatusMatrixProjection` for `/premium-chat-hub` read wiring. The hub matrix
covers `active`, `paused_by_report`, `admin_review`, `refund_pending`,
`closed_by_artist`, and `expired`. Public room cards read only
`/api/v1/chat/premium-rooms` public-list projection and expose only public CTA
state; owner cards read `/api/v1/chat/me/premium-rooms`; artist management cards
read `/api/v1/creator-studio/premium-chat/rooms`. Owner CTA, artist-management
CTA, and public CTA sources must not be mixed across these surfaces. The hub
projection is read-only and does not open rooms, submit reports, create refunds,
process payment, debit wallet, settlement, or payout mutation.

Premium chat live QA fixture readiness (#520):

`GET /api/v1/chat/premium-support-contract` exposes
`liveQaFixtureReadiness` so QA can tell whether the premium room status matrix
can be safely checked on live without opening payment, support, wallet, refund,
report, settlement, or payout mutation paths.

- Current status is `blocked_until_room_storage_and_safe_session_fixture` and
  `liveQaReady=false` because premium room storage/read endpoints are not
  mounted and there is no approved safe login/session fixture for the room
  matrix.
- Required fixture buckets are baseline active room, reported room, admin review
  room, unanswered refund candidate, near-expiry active room, closed room, and
  expired room.
- Once storage exists, fixtures must be dedicated inert read-model rows or
  admin-prepared QA rows for safe QA accounts. They must not be created through
  actual payment, support donation, wallet debit/credit, report, refund,
  settlement, payout, or production customer data flows.
- #1045 mounts
  `GET /api/v1/chat/premium-rooms/refund-status-preview-fixture` as an
  unauthenticated read-only preview for live QA when safe room rows or sessions
  are unavailable. It returns inert examples for 24-hour unanswered 100% refund
  candidate, 70% limited refund with 10% artist compensation, 50% limited refund
  with 10% artist compensation, and artist-forced-close 100% refund. The
  endpoint does not create rooms, reports, refunds, wallet ledger rows,
  settlement, payout, donation/support rows, or payment mutations, and does not
  expose raw chat bodies, raw report reasons, wallet ledger ids, provider refund
  ids, tokens, cookies, secrets, or DB URLs.
- Repeated verification must return the existing read-only projection and must
  not create duplicate wallet ledger, refund, report, moderation, settlement, or
  payout rows.
- Session handoff must use normal login or an approved secure QA session source.
  Raw passwords, tokens, cookies, DB URLs, and raw emails must not be requested
  or recorded in Notion, Git, logs, or QA reports.

Premium chat artist inbox/count projection contract (#517):

`GET /api/v1/chat/premium-support-contract` exposes
`artistInboxProjection`, `endpoints.artistRoomInbox`, and
`apiContracts.artistRoomInbox` for the future Creator Studio premium-chat
artist inbox. The planned read API remains `enabled=false` and submit-blocked.

```http
GET /api/v1/creator-studio/premium-chat/rooms?answerState=needs_reply&take=20
Authorization: Bearer <accessToken>
```

- The projection is authenticated, artist-owner-only, and read-only. Owner
  users must use their own user room status endpoint; non-owner artists return
  `403` or safe `404` without identity leakage.
- Supported answer filters are `all`, `needs_reply`, `due_soon_24h`,
  `overdue_24h`, and `replied`. Supported message-kind filters are `all`,
  `conversation`, and `support_message`.
- Counts include `total`, `needsReply`, `dueSoon24h`, `overdue24h`, `replied`,
  and `supportMessages`.
- Each item exposes only safe projection fields such as `roomId`, `artist`,
  `userSafeDisplay`, `roomStatus`, `answerState`, `unansweredState`,
  `replySla`, `lastUserMessageAt`, `lastArtistReplyAt`, and `lastMessageKind`.
- The unanswered SLA uses the same 24-hour no-answer window as the room
  lifecycle contract and a 4-hour due-soon projection window for UI sorting.
- #799 fixes `replySla` as the shared read-model clock for owner status,
  artist inbox/status, and admin status views. The clock source is
  `room.openedAt + 24h`; only `opened` and `active` rooms without artist answer
  evidence can become `overdue_24h` refund candidates. `artist_answered`,
  `lastArtistReplyAt`, or `hasArtistAnswer=true` must resolve to `replied` and
  must not mix with the 24-hour refund-candidate state.
- Support messages are separated from normal conversation messages. They do not
  create chat replies, answer requirements, or AI replies, and they are counted
  separately from conversation activity.
- #827 product separation: the artist inbox is
  `artist_direct_premium_dm` / `artist_direct_reply` from
  `premium_chat_rooms` and must not reuse `/api/v1/chat/conversations`,
  character-chat sessions, starter prompts, or AI reply routes. Owner users use
  `/api/v1/chat/me/premium-rooms/:roomId/status`; the artist inbox never falls
  back to the user conversation list.
- #1077 artist direct-reply contract keeps the premium room type, participant
  roles, artist reply states, and user-visible copy keys separate from
  character chat. The room remains `premium_chat_rooms` /
  `artist_direct_premium_dm` / `artist_direct_reply`; user participants are
  owner users, responder participants are artist operators, and AI/provider
  responder roles are not allowed. `needs_artist_reply` and `artist_answered`
  are state keys only; clients must use `chat.premiumRoom.artistDirect.*` copy
  keys or Korean fallback copy instead of showing raw enums.
- #1098 participant projection contract separates room list/detail visibility
  by viewer role. Public list readers see only safe artist/tier/status/read CTA
  fields. Owner users see their own room, safe artist summary, report/refund
  state, and mutation availability. Artist operators see requester safe summary,
  reply state/SLA, and artist action availability for artists they operate.
  Review operators see admin-safe moderation/refund state with redacted message
  preview only. Unauthorized owner/artist access must return 403 or safe 404
  without leaking room identity.
- #1098 also fixes `roomType=artist_direct_premium_dm`,
  `responseMode=artist_direct_reply`, and participant roles so premium rooms do
  not fall back to character-chat sessions, starter prompts, provider
  responders, or AI auto-reply lanes.
- Raw room status, answer state, and message-kind enums must not be used as
  user-facing copy. Clients should use label keys or Korean fallback copy.
- The projection must not expose raw chat bodies, raw support-message bodies,
  raw user email or phone, private user profiles, counterparty private user ids,
  message ids, wallet ledger ids, support-point ledger ids, conversation-meter
  ledger ids, admin notes, raw report reasons, tokens, cookies, or DB URLs.
- Artist reply creation, user message creation, donation creation,
  support-point ledger mutation, conversation-meter debit, refund creation,
  wallet debit, settlement, and payout remain disabled.

Premium room report/refund limitation API contract (#477):

The following planned mutation shapes are exposed through
`GET /api/v1/chat/premium-support-contract` as disabled API contracts. They do
not open live report, refund, wallet, settlement, payout, or accounting-ledger
mutation.

```http
POST /api/v1/chat/premium-rooms/:roomId/reports
POST /api/v1/creator-studio/premium-chat/rooms/:roomId/force-close
POST /admin/api/v1/backstage/premium-chat/rooms/:roomId/operator-close
Idempotency-Key: <client-or-admin-generated-key>
```

- API-safe room status keys are `active`, `paused_by_report`,
  `refund_pending`, `refunded`, `closed_by_artist`, and
  `closed_by_operator`.
- Report submit returns a `paused_by_report` projection and disables message
  send and donation while the detailed report state moves through `reported`,
  `blinded`, `suspended`, or `admin_review`.
- Artist force-close returns a `refund_pending` projection with
  `artist_forced_close_full_refund`, refund rate 100%, and artist compensation
  0%.
- Operator close supports 100%, 70%, and 50% refund outcomes. The 70% and 50%
  user-fault outcomes keep 10% artist compensation as a planned accounting
  candidate, while settlement and payout remain disabled.
- Repeating the same idempotency key with the same safe fingerprint returns the
  existing projection without a second status, refund, wallet, accounting,
  settlement, or payout mutation.
- Reusing the same idempotency key with a different fingerprint returns
  `409 PREMIUM_CHAT_REPORT_REFUND_IDEMPOTENCY_CONFLICT` before wallet lookup or
  mutation.
- Responses and logs must not include raw report text, raw chat body, raw
  payload, token, cookie, password, DB URL, or raw idempotency key.

Premium room projection copy contract (#478):

`GET /api/v1/chat/premium-support-contract` also exposes
`productProjection`, a read-only product/chat copy contract.

- `productProjection.unansweredRefundCandidate` provides separate user and
  artist copy keys for the 24-hour unanswered refund candidate state. It must
  not imply that the room is AI auto-answered or that a provider retry is in
  progress.
- #485 adds `productProjection.copyStatusConsistency`. 24-hour unanswered copy
  must match server status `refund_pending`: it can describe a 100% refund
  candidate, but must not say refund is already completed before the server
  refund decision/credit path runs.
- User-fault copy must describe 70%/50% as possible server/admin decisions,
  not as client-selected values. The contract fixes
  `allowedRefundRatePercents=[70,50]` and
  `artistCompensationRatePercent=10`.
- Report/blind/admin-review copy must keep message send, artist reply, support
  donation, message-meter, support-point, wallet, settlement, and payout
  affordances disabled.
- `productProjection.conversationMeterNotice` lets user UI summarize that
  Lumina can be deducted by conversation amount, while preventing per-line
  amount display and internal formula exposure. Artist UI may show a creator
  revenue hint, but not internal settlement rates or payout math.
- `productProjection.lockedRoomMessages` fixes user/artist copy keys for
  reported, blinded, suspended, admin-review, and refund-pending rooms.
- `productProjection` has `aiAutoReplyCopyAllowed=false` and must not expose raw
  prompts, provider payloads, raw chat bodies, raw support messages in rankings,
  wallet ledger ids, support-point ledger ids, internal settlement formulas,
  settlement rates, or admin-only memos.
- #486 fixes `productProjection.roomGuidanceCopy` as Korean service-tone copy:
  user copy says the room is answered directly by the artist, summarizes
  conversation-based Lumina deduction without per-line prices, explains 24-hour
  unanswered refund review, pauses conversation/support during report or
  operator review, and says support messages are reflected in support/
  communication ranking separately from likes. Artist copy may say conversation
  and support can help creator revenue, but must not expose settlement rates,
  ledger math, payout internals, provider/prompt terms, mutation/projection
  terms, admin notes, or raw chat bodies.

Premium room list/detail projection contract (#490):

`GET /api/v1/chat/premium-support-contract` exposes `roomProjection` and the
`premiumRoomDetail` projection for Home/Feed/Studio UI wiring. These remain
read-only contract shapes; `apiContracts.roomList`,
`apiContracts.userRoomStatus`, and `apiContracts.artistRoomStatus` are
`enabled=true` for read-only storage/status verification only.

- The room list response must include only artist-safe fields for artist,
  remaining period, room status, last response status, and donation/support
  availability.
- The room detail response composes `premiumRoomStatus`,
  `premiumRoomRefundStatus`, `premiumRoomReportStatus`, and
  `premiumRoomMutationAvailability`, plus the `premiumRoomDetail` shape for
  user-visible status copy, artist-visible status copy, review/lock state, and
  donation button state.
- Donation button disabled reasons are public reason/message keys only. Raw
  room enums or internal decision reasons must not be used as UI copy.
- Artist-facing detail copy may show reply activity and a creator revenue
  possibility hint, but must not expose settlement rates, internal calculation
  rules, admin notes, raw chat bodies, wallet ledger ids, support-point ledger
  ids, or conversation-meter ledger ids.
- The contract forbids AI auto-reply wording and internal implementation terms
  from user-visible room copy.
- This contract does not enable room open, donation create, wallet debit,
  settlement, payout, support-point writes, conversation-meter writes, or
  report/refund mutation routes.

Premium chat room storage/read endpoint contract (#532):

#532 adds the `premium_chat_rooms` Prisma read model and migration for live
room list/detail matrix QA. The model is storage-only in this PR: it has no
service path for payment, support, donation, report, refund, settlement, payout,
wallet debit, wallet credit, or room-open mutation. It stores safe room
lifecycle fields such as `owner_user_id`, `artist_id`, `tier_key`, `status`,
`amount_lumina`, `remaining_units`, `opened_at`, `expires_at`,
`last_user_message_at`, `last_artist_reply_at`, `last_support_at`,
`reported_at`, `admin_review_at`, `refund_candidate_at`, `closed_at`, and
`metadata`.

```http
GET /api/v1/chat/premium-rooms?artistSlug=:slug&status=:status&take=:take&cursor=:roomId
GET /api/v1/chat/me/premium-rooms?artistSlug=:slug&status=:status&take=:take&cursor=:roomId
GET /api/v1/chat/me/premium-rooms/:roomId/status
GET /api/v1/creator-studio/premium-chat/rooms/:roomId/status
Authorization: Bearer <accessToken> # owner/artist endpoints only
```

- Public room list returns `premium_room_list_item_v1` projection with
  `roomId`, safe `artist` summary, `tier`, `roomStatus`, `statusKey`,
  `statusLabelKey`, `readMode`, timestamps, remaining/near-expiry state,
  read-only viewer CTA, donation availability, and read-only policy.
- List status filters are limited to public list states `opened`, `active`, and
  `artist_answered`; omitted status returns the same public set.
- #880 adds the owner room list skeleton at `GET /api/v1/chat/me/premium-rooms`.
  It is authenticated and owner-only, uses
  `premium_room_owner_list_read_model`, and may include safe detail states such
  as `active`, `paused_by_report`, `admin_review`, `refund_pending`,
  `closed_by_artist`, and `expired`. It must not fall back to the character-chat
  conversation list or return `chat_sessions` rows.
- #1215 adds `PREMIUM_CHAT_ROOM_ACCESS_PROJECTION_CONTRACT` for the signed-in
  user's opened premium-room access list/detail projection. It exposes room id,
  safe artist summary, `artist.profileHref`, stable room status label keys,
  unread count, and safe latest-message summary only. It is owner-only, returns
  safe 403/404 for non-owners, and does not expose private chat body, raw user
  contact, wallet/payment ledger ids, refund reasons, or artist internal memos.
  The projection does not open rooms, send messages, debit wallet, create
  payments, create refunds, or touch settlement/payout state.
- Owner status returns `premiumRoomStatus`, `premiumRoomRefundStatus`,
  `premiumRoomReportStatus`, `premiumRoomMutationAvailability`, and the
  read-only policy for the authenticated room owner.
- Creator Studio status returns the same safe detail projection only when the
  caller is an active artist operator for the room artist. Unauthorized
  operator access uses safe not-found behavior to avoid identity leakage.
- Matrix QA states supported by storage/projection are active baseline,
  reported, admin review, unanswered refund candidate, near expiry, closed,
  artist closed, refunded, and expired.
- Stable error bodies use `code` and `messageKey`: invalid `take` returns
  `PREMIUM_CHAT_ROOM_TAKE_INVALID` / `chat.premiumRoom.invalidTake`; invalid
  list status returns `PREMIUM_CHAT_ROOM_STATUS_INVALID` /
  `chat.premiumRoom.invalidStatus`; invalid cursor returns
  `PREMIUM_CHAT_ROOM_CURSOR_INVALID` / `chat.premiumRoom.invalidCursor`;
  invalid room id returns `PREMIUM_CHAT_ROOM_INVALID_ID` /
  `chat.premiumRoom.invalidId`; missing or unauthorized room returns
  `PREMIUM_CHAT_ROOM_NOT_FOUND` / `chat.premiumRoom.notFound`.
- Safe QA fixture/session setup must use approved QA-only fixture rows or local
  staging data. Do not request or record raw password, token, cookie, email,
  direct DB URL, object URL, payment id, wallet ledger id, settlement id, or
  payout id in Notion or docs.
- #534 provides the guarded fixture procedure in
  `docs/ops/premium-chat-live-qa-fixture-session-534.md` and
  `npm run qa:premium-chat-live-fixtures`. The script supports `dry-run`,
  `prepare`, `verify`, and `cleanup` modes, creates only tagged
  `premium_chat_rooms` read-model rows, and never creates users, artists,
  artist operators, wallet rows, reports, refunds, settlement rows, payout rows,
  or chat messages.
- Until a later mutation PR exists, QA may verify only read projections and
  matrix visibility. Any attempt to use this storage as a payment/support/
  wallet/report/refund/settlement/payout mutation path must fail closed.
- #880 keeps premium room public list, owner room list, owner detail, and artist
  detail as separate read models. Public list is
  `premium_room_public_list_read_model`; owner list is
  `premium_room_owner_list_read_model`; owner detail is
  `premium_room_owner_detail_read_model`; artist detail is
  `premium_room_artist_detail_read_model`.
- #1098 adds `participantProjection` to the support contract as a read-only
  projection split for public, owner, artist-operator, and review-operator
  surfaces. It does not enable user message send, artist direct reply,
  character-chat AI reply, support message creation, donation, room open,
  wallet credit/debit, payment, refund, settlement, payout, or operator
  decision mutation.
- #905 adds `roomProjection.tierRoomProjection` so public room list, owner room
  list, and artist management list use the same `premiumRoomTierProjection`
  shape. The only valid room tiers remain 300L, 500L, 1,000L, and 3,000L.
- 500L, 1,000L, and 3,000L availability is split into server-counted follower
  unlock gates and artist-selectable state. Client-submitted follower counts,
  local prices, balances, or paid amounts are not trusted. The projection does
  not open rooms, debit wallet, or change settlement/payout state.

Premium chat support message and ranking projection contract (#496):

`GET /api/v1/chat/premium-support-contract` exposes
`supportRankingProjection` and updates `productProjection.supportMessageProjection`
for display-only support-message/ranking UI wiring. The contract remains
read-only and all donation/wallet/ranking-refresh mutations stay disabled.

- Support-message amount UI must use stable copy keys for fixed amounts and
  custom amount ("내맘대로 후원") labels. Raw amount enums must not be used as UI
  copy.
- Support messages may affect only the premium-chat communication/support and
  donation ranking lanes. They must never feed Lumina Pick likes or
  `/api/v1/boost-campaigns/:campaignId/rankings`.
- #845 fixes projection separation between premium room messages, support
  messages, donation events/ledger, and ranking lanes. `donation.message` is the
  support-message source field, but it must not create a normal room message or
  AI reply. Donation ledger references stay `premium_chat_donation`;
  communication ranking may later consume safe support-message activity, while
  donation ranking uses confirmed net donation only. Premium-chat support still
  never feeds Lumina Pick/boost rankings.
- Communication ranking copy is summary-only: room open, safe conversation
  activity, support, and artist reply activity may contribute, but clients must
  not show raw scoring formulas or internal source names.
- Donation ranking copy is summary-only and based on confirmed net support.
  Raw support-message bodies are not returned in ranking items.
- Reported, blinded, suspended, admin-review, refund-pending, closed, or
  expired rooms must keep support-message creation disabled before wallet lookup
  or any donation event/order write.
- #871 fixes support-message moderation separation. Unsafe, reported, blinded,
  or blocked support-message text must not be promoted into normal room
  messages. Artist inbox projections show only a safe moderation state or
  placeholder, while admin review uses a separate review projection. Reported
  rooms stay in safe status-only pause until operator review resumes or closes
  the room.
- The #871 contract remains read-only: it does not enable support submission,
  report creation, wallet debit, refund, settlement, payout, or admin mutation
  paths.
- User-visible support/ranking copy must not contain provider, prompt, ledger,
  mutation, projection, AI auto-reply wording, raw prompt/provider payloads,
  tokens, cookies, DB URLs, wallet ledger ids, support-point ids,
  conversation-meter ids, admin notes, or raw chat bodies.

Premium chat support backend skeleton (#588):

- `GET /api/v1/chat/premium-support-contract` now includes
  `backendSkeleton.version =
  2026-05-28.premium-chat-support-backend-skeleton.v1`.
- The skeleton fixes support units as the existing fixed amounts
  `10/50/100/500/1000/5000/10000/50000L` plus custom integer support from
  `1L` to `50000L`. Amount, balance, ranking score, and client-local price are
  not trusted.
- Planned storage is named without enabling writes:
  `premium_chat_donation_orders`, `premium_chat_donation_events`,
  `premium_chat_support_point_ledger`, and
  `premium_chat_ranking_snapshots`.
- The future validation order is auth, session ownership, supportable room
  state, amount policy, idempotency, wallet balance, and trust/identity gate.
- Donation preview/create, wallet mutation, support-point ledger mutation,
  ranking refresh by client, settlement, and payout remain disabled.
- Ranking lanes stay separated: Lumina Pick likes remain on
  `/api/v1/boost-campaigns/:campaignId/rankings`, while premium-chat
  communication and donation lanes remain on planned `/api/v1/chat/rankings`
  queries. Premium-chat support must not feed like rankings.
- #895 adds `backendSkeleton.supportMessageRequest` for the future in-room
  support message request contract. The planned endpoint remains disabled and
  uses the existing fixed support units `10/50/100/500/1000/5000/10000/50000L`
  plus custom integer support from `1L` to `50000L`.
- The support message skeleton separates event and projection keys:
  `premium_chat_support_message_requested`,
  `premiumChatSupportMessageProjection`,
  `premiumChatCommunicationRankingProjection`, and
  `premiumChatDonationRankingProjection`. It does not feed Lumina Pick like
  rankings.
- The #895 skeleton is contract-only. It does not write support messages,
  donation orders/events, wallet movement, settlement, payout, or ranking
  refreshes.

Premium chat support submit readiness (#616):

- `GET /api/v1/chat/premium-support-contract` now exposes
  `submitReadiness` with contract version
  `2026-06-05.premium-chat-support-submit-readiness.v1`.
- The allowed fixed support units are `10L`, `50L`, `100L`, `500L`,
  `1,000L`, `5,000L`, `10,000L`, and `50,000L`. Custom support uses copy key
  `chat.donation.amount.custom` / Korean fallback `내맘대로 후원`, accepts
  integer-only `1L` through `50,000L`, and is server-normalized.
- Current activation remains disabled:
  `donationPreviewEnabled=false`, `donationCreateEnabled=false`,
  `walletDebitEnabled=false`, `supportPointLedgerMutationEnabled=false`,
  `settlementMutationEnabled=false`, `payoutMutationEnabled=false`, and
  `rankingRefreshByClientEnabled=false`.
- Ranking lanes stay separated. Lumina Pick/like ranking does not receive
  premium-chat support. Communication ranking may later consume safe room-open,
  message, support, and artist reply activity. Donation ranking may later
  consume confirmed net premium-chat support only.
- Activation blockers remain storage and accounting work: donation order/event
  storage, support-point ledger storage, wallet ledger type allowlist,
  idempotent wallet debit transaction, ranking read-model refresh worker, and
  settlement/payout accounting contract.
- The contract must not expose raw token, cookie, DB URL, wallet ledger id, or
  support-point ledger id.

Premium room list read-only contract (#372):

```http
GET /api/v1/chat/premium-rooms?artistSlug=<artist-slug>&take=20
```

- This is a planned read-only contract shape exposed through
  `GET /api/v1/chat/premium-support-contract` as
  `apiContracts.roomList`. It remains `enabled=false`.
- The public room list returns only minimal artist-safe projection fields:
  public room id, safe artist id/slug/display name/avatar, server tier summary,
  status label key, duration timestamps, viewer CTA state, and public metrics.
- Tier amounts must come from the same room-open policy as create:
  300L, 500L, 1,000L, and 3,000L. Local price labels or client-submitted
  amounts are not authoritative.
- Visible room statuses are `opened`, `active`, and `artist_answered`.
  `reported`, `blind`, `suspended`, `refund_pending`, `refunded`, and
  `admin_review` rooms are excluded from list projections.
- The projection must not include wallet ledger ids, support point ledger ids,
  conversation meter ledger ids, raw admin notes, raw report reasons, raw
  payloads, raw chat bodies, or raw user ids.
- Calling the room list must not open a room, create a donation, debit wallet,
  touch settlement, touch payout, or write ledger rows.
- #948 adds the planned premium chat message read projection under
  `apiContracts.premiumRoomMessages` and `projections.premiumRoomMessageItem`.
  Image messages in the room conversation flow expose only safe message fields:
  message id, sender role/display fields, createdAt, image asset id, safe
  thumbnail URL, dimensions, and moderation status/key. Original private object
  URLs, signed URLs, storage keys, raw asset metadata, raw chat bodies, wallet
  ledger ids, support-point ids, conversation-meter ids, and private user ids
  must not be returned. This does not enable image upload, message send,
  payment, wallet, settlement, payout, or donation mutation.
- #949 adds the planned premium chat `+` action menu capability projection under
  `productProjection.plusActionMenu` and `apiContracts.plusActionMenu`. The
  input bar actions are separated as image attachment, emoticon, and support
  capabilities with stable label/capability keys; raw action keys must not be
  used as user copy. Selecting an action is read-only and does not upload an
  image, send an emoticon, create support, debit wallet, touch payment,
  settlement, payout, or ledger rows. The support action must open a
  confirmation/preview step first; wallet mutation before confirmation remains
  disabled.
- #970 adds the planned premium chat message send skeleton under
  `apiContracts.premiumRoomMessageSend` and
  `projections.premiumRoomMessageSendSkeleton`. The future endpoint is
  `POST /api/v1/chat/premium-rooms/:roomId/messages` with explicit
  `messageKind=text|image`, idempotency, room-state, report/blind guard, and
  image-asset validation ordering. Image send uses an existing confirmed image
  asset id and does not upload inside the send endpoint. Text/image messages are
  separated from support/donation messages and report/blind state flows. This
  skeleton remains disabled and does not create messages, upload images, create
  support/donation/report rows, notify users, debit wallet, touch payment,
  settlement, or payout state.
- #1203 tightens the premium-chat image message read projection for chat-bubble
  UI wiring. `GET /api/v1/chat/premium-rooms/:roomId/messages` may expose only
  safe image fields such as asset id, safe display URL, safe thumbnail URL,
  moderation status key, blocked placeholder key, sender, created time, and
  bubble direction (`sent`, `received`, or `system`). Blocked or review-pending
  images must render as a placeholder instead of returning private/original
  URLs. The projection must not return storage keys, signed URLs, raw metadata,
  raw asset URLs, wallet/payment/settlement/payout fields, or enable image
  upload/message send/support/donation/report mutation.

Premium chat room status projection split (#617):

- `GET /api/v1/chat/premium-rooms` is an implemented read-only public list. It
  accepts only public-visible statuses: `opened`, `active`, and
  `artist_answered`.
- Public room list status filters for owner/operator states such as
  `paused_by_report`, `refund_pending`, `closed_by_artist`, or `expired` are
  rejected with `PREMIUM_CHAT_ROOM_STATUS_INVALID` before any wallet, donation,
  settlement, payout, or message mutation path can run.
- Owner/user detail status remains on
  `GET /api/v1/chat/me/premium-rooms/:roomId/status`; artist/operator detail
  status remains on
  `GET /api/v1/creator-studio/premium-chat/rooms/:roomId/status`.
- Detail projections may show safe status-only/archive states such as
  `paused_by_report`, `refund_pending`, `closed_by_artist`, and `expired`, but
  must keep message send, artist reply, donation, refund, wallet, settlement,
  and payout mutations disabled.
- Room list and detail policy expose `visiblePublicStatuses`,
  `ownerArtistStatusOnlyStatuses`, `archiveStatuses`, and
  `publicListExcludesOwnerArtistStates` so frontend/QA can verify state
  separation without reading raw chat bodies, raw report reasons, admin notes,
  wallet ledger ids, support point ledger ids, conversation meter ids, raw user
  ids, token, cookie, or DB URL.

Donation idempotency:

- The key is accepted from the `Idempotency-Key` header or body
  `idempotencyKey`.
- The wallet ledger idempotency scope is
  `premium-chat-donation:<sessionId>:<client-idempotency-key>`.
- Safe replay of the same session, amount, and message returns the existing
  donation projection without a second debit.
- Reusing the key with a different session, amount, or message returns `409`
  with `messageKey = chat.donation.idempotencyConflict` before wallet lookup.

Donation fail-closed states:

- Missing/invalid idempotency key, invalid amount, insufficient balance,
  inactive wallet, missing/other-user session, reported room, blinded room,
  suspended room, refund-pending room, refunded donation, chargeback review, or
  high-value account review blocks before wallet mutation.
- High-value support starts at `10000L`; daily support is capped at `50000L`
  until account trust and identity checks are finalized.
- Blocked states return safe message keys such as
  `chat.donation.blockedRoomState` or
  `chat.donation.identityVerificationRequired`; raw policy enum values are not
  user-facing copy.

Ranking lanes are deliberately separated (#341/#349):

```http
GET /api/v1/chat/rankings?type=communication&period=weekly&take=20
GET /api/v1/chat/rankings?type=donation&period=weekly&take=20
```

- Like ranking remains on `GET /api/v1/boost-campaigns/:campaignId/rankings`
  and includes only `free_like` and `lumina_boost`. It must not include
  `premium_chat_donation`.
- `GET /api/v1/chat/rankings` accepts only `type=communication` or
  `type=donation`. Do not add a `type=like` alias to the chat ranking lane.
- #777 requires the response `type` to mirror the requested lane and forbids
  mixed-lane items. The chat ranking projection must reject or omit `like`,
  `free_like`, `lumina_pick`, and `boost` as chat ranking types or score sources.
- Communication ranking uses `premium_chat_open`, `premium_chat_message`,
  `premium_chat_donation`, and artist reply activity as a separate score lane.
- Donation ranking uses confirmed net `premium_chat_donation` only. Refunded,
  blinded, reported, chargeback, cancelled, or moderation-held rows are excluded
  by projection policy.
- Ranking item shape uses safe artist projection fields, `rankNo`, decimal
  string `score`, and `scoreLabelKey`. It must not expose raw wallet ledger ids.
- Ranking windows are `daily`, `weekly`, `monthly`, and `all`, calculated in
  `Asia/Seoul`. Responses include a `window` object with `startsAt`, `endsAt`,
  and `timezone`.
- Pagination uses an opaque cursor. Default `take` is 20 and max `take` is 50.
- Communication ranking score candidates are confirmed premium-chat opens, safe
  non-blinded message activity, confirmed net donation contribution, and safe
  artist-side replies. The final formula is server-side only.
- Donation ranking is based on confirmed net Lumina from
  `premium_chat_donation` only.
- Reported rows are excluded until admin-safe, blinded/suspended rooms are
  excluded, and refunded/chargeback rows are excluded according to ranking lane
  policy.
- Ranking responses must not include raw chat bodies, raw report reasons,
  wallet ledger ids, user ids, or message ids.

The current implementation exposes these shapes through read-only
`GET /api/v1/chat/premium-support-contract` under `apiContracts`; the room list,
donation, and ranking mutations/read models remain disabled until storage,
ledger, and moderation integration are added.

Premium chat ranking backend projection readiness (#592):

`GET /api/v1/chat/premium-support-contract` exposes
`rankings.backendProjection` as a disabled backend read-model contract. It is
for reviewer/QA alignment only and does not enable the public ranking read
endpoint, donation creation, frontend score submit, or client-triggered refresh.

- Planned read models are `premium_chat_ranking_snapshots`,
  `premium_chat_support_point_ledger`, `premium_chat_conversation_meter_ledger`,
  and `premium_chat_rooms`.
- Communication ranking reads only server-side room-open support points, safe
  message activity support points, confirmed net donation support points, and
  safe artist reply activity. The final score formula remains server-side only.
- Donation ranking reads only confirmed net premium-chat donation support
  points. It excludes Lumina Pick likes/boosts, room-open rows, message rows,
  reported/blinded rows, refunded rows, chargeback rows, and cancelled rows.
- Chat rankings accept only `communication` and `donation`. Like ranking stays
  on `/api/v1/boost-campaigns/:campaignId/rankings`, and premium-chat support
  must not feed that lane.
- Duplicate projection refresh is a server-side replay concern only. It must not
  create a second mutation, and clients cannot request refresh or submit scores.
- Ranking projection privacy blocks raw chat bodies, support-message bodies,
  report reasons, wallet/support/conversation ledger identifiers, raw user
  identifiers, message identifiers, internal formulas, and private connection
  material.
- Current readiness is disabled: ranking endpoint, read-model storage, snapshot
  job, support-point storage, frontend submit, and donation create are all
  `false`.
- #1079 adds `donation.supportMessageLedgerSkeleton` for the future premium-chat
  support-message ledger. It fixes server-normalized donation amount tiers,
  safe donor display policy, communication/donation ranking ledger lanes, an
  artist-share read-model placeholder, and a no-settlement placeholder. It does
  not create donation rows, debit or credit wallet/Lumina, write support-point
  ledgers, write settlement or payout queues, or expose raw donor ids, raw
  contact fields, wallet balances, settlement ledger ids, payout ledger ids, or
  support-message bodies in rankings.
- #803 adds the daily aggregate contract under
  `rankings.backendProjection.dailyAggregate`. It aggregates
  `artist_per_day_per_lane` in `Asia/Seoul` and keeps communication and donation
  lanes separate. Communication daily aggregates include confirmed room opens,
  safe visible message activity, confirmed net donation as a weighted factor,
  and safe artist reply activity. Donation daily aggregates include confirmed
  net donation only. Cancelled, refunded, chargeback, reported, blinded,
  suspended, and operator-sanctioned unsafe rows are excluded before aggregate
  output. Daily aggregate support-point, snapshot, wallet, settlement, and
  payout mutations remain disabled.
- #896 adds `rankings.backendProjection.responseProjection` as the read-model
  shape for future chat ranking responses. It allows only `communication` and
  `donation`, fixes the window fields to `type/startsAt/endsAt/timezone` in
  `Asia/Seoul`, and keeps mixed-lane items disabled.
- The #896 response projection separates rank sources:
  communication reads `premium_chat_support_point_ledger.communication_lane`,
  while donation reads `premium_chat_support_point_ledger.donation_lane`.
  Ranking windows come from
  `premium_chat_ranking_snapshots.window_start_end_asia_seoul`.
- Ranking items expose only `type`, `rankNo`, decimal string `score`,
  `scoreLabelKey`, a safe artist projection, and a safe viewer summary. Artist
  owner, settlement, payout, user raw identifier, support history, payment
  state, score submit, support-point write, snapshot write, wallet, settlement,
  and payout mutations remain unavailable.
- #1167 tightens the support ranking backend projection authority. The
  `donation` lane rank score source is fixed to confirmed net premium-chat
  donation support points only. Like ranking scores, communication activity
  scores, and client-submitted scores are rejected by the contract, refunded or
  chargeback rows are excluded before ranking, duplicate snapshot refresh is
  replay-only, and raw donation ledger rows remain hidden. This does not enable
  the ranking endpoint, support submission, wallet, settlement, payout, or
  ranking refresh mutation.

Premium chat support point ledger contract (#363):

- The support-point ledger sub-contract version is
  `2026-05-21.premium-chat-support-point-ledger.v1` and keeps room-open,
  donation, conversation-meter, support-point, settlement, and payout writes
  disabled.
- `conversationMetering` defines the planned server-only message activity meter:
  table `premium_chat_conversation_meter_ledger`,
  `ledgerType=premium_chat_message`, unit `message_activity_unit`, idempotency
  key `premium-chat-message-meter:<messageId>`, and no wallet mutation.
- `supportPointLedger` defines the planned non-cash ranking point table
  `premium_chat_support_point_ledger`. It is not shared with `wallet_ledger` or
  `fan_engagement_point_ledger`, is not transferable, and is not settlement or
  payout eligible.
- Support point ledger types are
  `premium_chat_room_open_support_point`,
  `premium_chat_message_activity_support_point`, and
  `premium_chat_donation_support_point`. Donation points default to one point
  per confirmed net Lumina; room-open and message weights remain server policy
  only.
- Communication ranking can read the three premium-chat support point ledger
  types after storage exists. Donation ranking can read only
  `premium_chat_donation_support_point`. The final score formula stays
  server-side only and must not expose wallet ledger ids, raw user ids, raw
  message ids, raw chat bodies, or report reasons.
- #1266 adds the disabled support ledger read projection contract
  `PREMIUM_CHAT_SUPPORT_LEDGER_PROJECTION_CONTRACT`. It separates room support
  summaries from donation ranking input, uses confirmed net premium-chat support
  only, and keeps like/boost rankings out of the donation lane. The projection
  hides raw donation order ids, wallet ledger ids, support point ledger ids,
  raw support messages, private user identifiers, and provider payloads.
  Donation creation, support point writes, wallet debit/credit, ranking snapshot
  writes, settlement, and payout remain disabled.

Donation preview error contract:

| Status | Code |
| --- | --- |
| 401 | `auth_required` |
| 400 | `invalid_amount` |
| 400 | `message_too_long` |
| 403 | `session_not_owned` |
| 404 | `session_not_found` |
| 409 | `blocked_room_state` |

Donation create error contract:

| Status | Code |
| --- | --- |
| 401 | `auth_required` |
| 400 | `idempotency_key_required` |
| 400 | `invalid_amount` |
| 400 | `message_too_long` |
| 402 | `insufficient_lumina_balance` |
| 403 | `session_not_owned` |
| 403 | `identity_verification_required` |
| 404 | `session_not_found` |
| 409 | `blocked_room_state` |
| 409 | `idempotency_conflict` |

Chat ranking error contract:

| Status | Code |
| --- | --- |
| 401 | `auth_required` |
| 400 | `invalid_ranking_type` |
| 400 | `invalid_period` |
| 400 | `invalid_take` |

Idempotency and server authority:

- The client may send `Idempotency-Key` or `body.idempotencyKey`, but the server
  owns the final wallet debit decision.
- The server trusts only the wallet account balance read inside the DB
  transaction; client balance, local price display, or UI selected amount cannot
  authorize a debit.
- Replaying the same key with the same session, amount, and message returns the
  existing donation projection without a second wallet debit.
- Reusing the key with a different fingerprint returns `409
  idempotency_conflict` before wallet lookup.
- Ranking projections refresh from server-side donation/message/open events
  only; the frontend must not submit ranking scores.

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

### Backstage Site Content CMS

```http
GET /api/v1/site-content/bootstrap?locale=ko-KR&pageKey=characters
GET /api/v1/admin/api/v1/backstage/site-content?status=archived&take=100
GET /api/v1/admin/api/v1/backstage/site-content/:id
POST /api/v1/admin/api/v1/backstage/site-content
PATCH /api/v1/admin/api/v1/backstage/site-content/:id
POST /api/v1/admin/api/v1/backstage/site-content/:id/publish
POST /api/v1/admin/api/v1/backstage/site-content/:id/archive
POST /api/v1/admin/api/v1/backstage/site-content/:id/restore
```

Backstage site-content writes are `super_admin` only. Public bootstrap returns
`status=published` rows only, never draft or archived rows. Navigation keys and
fixed menu labels remain outside CMS editing.

Create is draft-only. `contentKey + locale` is unique, so a duplicate archived
row returns `SITE_CONTENT_KEY_EXISTS` with `details.recoverable=true`,
`existingEntryId`, `existingStatus`, and the restore path template. Operators
must restore the archived row instead of creating a second row with the same
key.

Restore request:

```json
{
  "status": "draft"
}
```

- Omitted `status` defaults to `draft`.
- `draft` clears `archivedAt`, `archivedByUserId`, `publishedAt`, and
  `publishedByUserId`, then lets the operator edit and publish again.
- `published` restores directly to public only when the row has non-empty safe
  content.
- Repeating restore on a non-archived row is idempotent and does not create a
  new audit entry.
- `publish`, `archive`, and `restore` all write `site_content_audit_logs`.
- HTML/script-like text is still blocked with `SITE_CONTENT_UNSAFE_TEXT`.
- No wallet, Lumina, order, settlement, or payout mutation is performed.

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

- #937 fixes the public artist ranking projection rule across like, vote,
  premium-chat donation, and premium-chat communication lanes. Ranking
  projections include artists only after they are public `active` characters,
  including already-public characters such as Oh Hyerin and gallery-ready
  characters after they are promoted to active public release. Pending, hidden,
  archived, and deleted artists are excluded before ranking output, even if
  legacy ranking events exist. This rule does not execute like, vote, support,
  wallet, settlement, payout, or paid-like mutation.

Admin operation endpoint:

```http
POST /admin/api/v1/popular-vote/monthly-picks/finalize
```

`monthly_pick_winners` stores the finalized monthly winner. Year Champion currently follows option A from Notion: annual weighted score sum.

Debut application endpoints:

```http
GET /api/v1/debut/policy
POST /api/v1/debut/applications
GET /api/v1/me/debut-applications
GET /api/v1/me/debut-applications/latest
GET /api/v1/me/debut-applications/:applicationId/status
POST /api/v1/me/debut-applications/:applicationId/withdraw
POST /api/v1/me/debut-applications/:applicationId/resubmit
GET /admin/api/v1/debut/applications?status=submitted&take=50
GET /admin/api/v1/debut/applications/:applicationId
PATCH /admin/api/v1/debut/applications/:applicationId/review
```

`debut_applications` stores an operations-review application only. Sensitive identity documents and final contracts must use a later secure upload/contract process, not chat, Notion, or Git.

Admin debut endpoints are read-only for the first operations contract. The
canonical Backstage call site is `adminApiPath('/debut/applications...')`, and
the helper resolves the executable path from the configured API base. When the
API base URL is the deployed host root, the current external paths are:

```http
GET /api/v1/admin/api/v1/debut/applications?status=submitted&take=50
GET /api/v1/admin/api/v1/debut/applications/:applicationId
PATCH /api/v1/admin/api/v1/debut/applications/:applicationId/review
```

If a client helper/base URL already includes `/api/v1`, the relative admin path
stays `/admin/api/v1/debut/...`. Do not hardcode host-root
`/admin/api/v1/debut/...` for deployed calls. Admin read projections and the
review action endpoint are separate contracts: use GET for queue/detail display
and PATCH only for explicit operations review/status changes.

Current validation and workflow:

- `GET /api/v1/debut/policy` is public and returns form option/policy hints, including applicant types, participation types, status labels, consent keys, field limits, and restricted collection types.
- MVP default channel is `phone_consultation`, which requires `contactPhone` and `consultationConsent: true`. The operator confirms details by phone after submission.
- `GET /api/v1/debut/policy` includes `phoneConsultationOperations`. If the
  operations phone number is not configured, the API stays fail-closed:
  `operatorPhone.configured=false`, `operatorPhone.numberReturned=false`, and
  `operatorPhone.publicDisplayAllowed=false`. Even when configured, this
  contract does not return the raw phone number.
- Phone-consultation SLA copy is non-guaranteed and key-based:
  `debut.phoneConsultation.sla.businessDayReview`, with `guaranteed=false` and
  `finalDebutOrContractGuaranteed=false`. It must be rendered as business-day
  review / contact-if-available guidance, not a guaranteed call, acceptance, or
  debut promise.
- `online_review` uses the private applicant-material upload flow. Do not reuse the public feed/profile image upload APIs for debut applicant materials.
- MVP applications require `isAdult: true`. If a verified identity record has a
  known minor birth date, the backend rejects submit with
  `DEBUT_APPLICANT_MINOR_NOT_ALLOWED` and
  `debut.applicant.minorNotAllowed`.
- Email verification, password setup, and NICE real-provider connection are not
  hard submit gates in this MVP. Active social-only accounts can submit without
  first setting a password. The account-state matrix is tracked in
  `docs/debut-auth-account-gap-check.md`.
- Required consent fields are `consentAppearance`, `consentRevenuePolicy`, and `consentPrivacy`.
- `applicationType` is optional and defaults to `personal_unaffiliated`. Allowed values are `personal_unaffiliated`, `represented_artist`, `ai_creator_partner`, and `partnership_other`.
- `represented_artist` applications automatically store `rightsReviewRequired: true` and `rightsReviewStatus: "pending"` in metadata. This is for affiliated artists, trainees, agencies, management, or entertainment-company inquiries.
- `ai_creator_partner` and `partnership_other` applications automatically store `partnerReviewRequired: true` and `partnerReviewStatus: "pending"` in metadata.
- `participationType` is one of `appearance_only`, `voice_or_song`, `performance`, or `co_creator`. If omitted, the backend defaults to `appearance_only`.
- The canonical submit fields are `contactEmail`, `contactPhone`, and `intro`. For temporary frontend compatibility, the backend also accepts aliases `applicantEmail`, `applicantPhone`, and `selfIntroduction`.
- `consentVoice` is optional and defaults to `false`.
- `shareTierRequested` and `shareTierApproved` are integers from 0 to 70.
- Applicant withdrawal is available before final decision for `submitted`, `reviewing`, or `needs_more_info` applications.
- User-facing read-only status candidates are `submitted`, `reviewing`,
  `needs_more_info`, `approved`, `rejected`, and `canceled`. Existing
  `approved_for_contact`, `approved`, `archived`, and `withdrawn` records are
  normalized for user display without implying debut, contract, or settlement
  finalization.
- `GET /api/v1/me/debut-applications`,
  `GET /api/v1/me/debut-applications/latest`, and
  `GET /api/v1/me/debut-applications/:applicationId/status` return owner-only
  status projections. They include Korean display copy keys, a derived
  read-only status history, submitted/updated dates, application channel/type,
  material category summary, and a notification contract preview. They do not
  expose contact values, intro text, admin review notes, internal metadata,
  private signed URLs, original file URLs, storage keys, object ETags, secrets,
  or tokens.
- User-facing status projections include an explicit `cta` contract on the
  application and a mirrored `publicNotice.cta` summary. For `needs_more_info`,
  the CTA opens owner-only resubmission with
  `endpoint=/api/v1/me/debut-applications/:applicationId/resubmit`,
  `method=POST`, `messageKey=debut.application.cta.resubmit`,
  `actionAllowed=true`, and `mutationAllowed=true`. Other statuses keep
  `enabled=false`, `actionAllowed=false`, `mutationAllowed=false`, and
  `contractOnly=true`. All responses keep stable `messageKey`,
  `disabledReasonKey`, and `blockedMutations` fields and never open debut
  finalization, contract, settlement, payout, wallet, Lumina, or notification
  dispatch actions.
- `POST /api/v1/me/debut-applications/:applicationId/resubmit` is authenticated
  and owner-only. It is allowed only from raw status `needs_more_info`, reuses
  the same application id, treats the request body as a full
  `CreateDebutApplicationDto` replacement, resets status to `submitted`,
  replaces private material links, clears the previous public request fields,
  and records a redacted audit event. Stable errors include
  `DEBUT_APPLICATION_NOT_FOUND`, `DEBUT_RESUBMIT_STATUS_NOT_OPEN`,
  `DEBUT_CONTACT_EMAIL_REQUIRED`, `DEBUT_INTRO_REQUIRED`,
  `DEBUT_REQUIRED_CONSENT_MISSING`, `DEBUT_CONTACT_PHONE_REQUIRED`,
  `DEBUT_CONSULTATION_CONSENT_REQUIRED`, and `DEBUT_INTRO_TOO_SHORT`.
- Debut review notification dispatch is not enabled in this contract. The
  response only defines planned in-app/email copy keys for `needs_more_info`,
  `approved`, and `rejected` states. Actual email/in-app senders require a
  separate mutation/delivery implementation.
- Admin read-only status candidates are `submitted`, `reviewing`,
  `needs_more_info`, `approved_for_contact`, `rejected`, and `archived`.
  Existing `under_review`, `approved`, and `withdrawn` records are normalized in
  the read-only response as `reviewing`, `approved_for_contact`, and `archived`.
- `applicationChannel`, `applicationType`, `affiliatedOrgName`, `rightsRelationshipNote`, `creatorExperienceNote`, `preferredContactTime`, `consultationConsent`, and `materialSubmissionMode` are stored in `debut_applications.metadata` for now. Promote them to columns only after operations data proves the shape.
- Admin list supports `applicationChannel`, `applicationType`,
  `operationSegment`, `rightsReviewRequired`, `partnerReviewRequired`, and
  `consultationStatus` query filters using metadata JSON path filters.
  `operationSegment=entertainment_agency` is the read-only queue alias for
  entertainment-company, agency, management, trainee, or represented-artist
  applications. It maps to `applicationType=represented_artist` and the
  rights-review queue without opening any mail, contract, settlement, debut
  finalization, wallet, or Lumina mutation.
- Admin list/detail rows include `operatorRouting` for read-only operations
  triage. It separates `applicationChannel`, contact availability booleans,
  `consultation.status`, and whether the row needs admin-queue notification.
  `operatorRouting.notification` never means an SMS/email/call was sent; its
  `externalDispatch.smsSent`, `externalDispatch.emailSent`, and
  `externalDispatch.phoneCallPlaced` fields remain `false`.
- `operatorRouting` also exposes safe queue guidance for operations:
  `queueSegment`, `reviewQueues`, `operatorAssignment.assigned`,
  `operatorAssignment.assignedUserIdReturned=false`, and guidance booleans for
  missing operator assignment, missing preferred contact time, missing
  operations phone configuration, pending rights review, and pending partner
  review. It never returns an operator user id, operator display name, raw
  phone, raw email, intro text, internal memo, or private material URL.
- Admin and owner status projections include a `finalization` guard:
  `finalDebutConfirmed=false`, `contractFinalized=false`,
  `settlementFinalized=false`, `payoutEligible=false`,
  `walletMutationAllowed=false`, and `luminaMutationAllowed=false`. For
  `represented_artist`, pending rights review is shown as pre-contract review
  only; it must not be interpreted as approval, contract execution, settlement,
  or payout readiness.
- Admin detail returns masked contact fields and private applicant material
  metadata only. It must not return private signed URLs, original file URLs,
  storage keys, object ETags, secrets, or tokens.
- Admin review mutation is open only through
  `PATCH /admin/api/v1/debut/applications/:applicationId/review`. The action can
  update review status, public status reason/requested action key, consultation
  status/schedule, and rights/partner review status or internal notes. It returns
  a list-row projection plus an audit summary, not the admin detail projection.
  The endpoint does not create final debut, contract, settlement, payout, wallet,
  or Lumina mutations; `shareTierApproved` remains blocked here with
  `DEBUT_ADMIN_FINAL_SHARE_UPDATE_NOT_OPEN`.
- The review action records an audit event using
  `2026-05-19.debut-ops-audit-v1`. Audit before/after payloads store only safe
  status/routing/public-notice/material-summary booleans. They must not store
  contact values, intro text, review notes, consultation/rights/partner note
  bodies, private material URLs, storage keys, object ETags, raw tokens, secrets,
  settlement values, or payout data.
- Allowed consultation statuses: `pending`, `scheduled`, `contacted`, `no_answer`, `completed`.
- Allowed rights review statuses: `not_required`, `pending`, `reviewing`, `cleared`, `blocked`.
- Allowed partner review statuses: `not_applicable`, `pending`, `reviewing`, `accepted`, `declined`.
- Additional richer form fields are accepted and stored in application metadata:
  `artistDebutMode`, contribution booleans, gender policy acceptance flags,
  `portfolioUrls[]`, and categorized confirmed material asset id arrays.
- `genderSwapRequested` must be absent or `false`; sending `true` returns
  `DEBUT_GENDER_SWAP_UNSUPPORTED`.
- Revenue share remains non-final: `shareTierRequested` is the applicant-facing
  estimate/request, and `shareTierApproved` is the later admin final value.
  Applicant submission never auto-confirms final share.

Debut private material upload:

```http
POST /api/v1/debut/application-materials/upload-intents
POST /api/v1/debut/application-materials/:assetId/confirm-upload
```

Both endpoints require JWT auth and fail closed to the authenticated owner. The
upload intent body is:

```json
{
  "category": "face_photo",
  "fileName": "material.png",
  "mimeType": "image/png",
  "fileSizeBytes": 1048576,
  "width": 1024,
  "height": 1024,
  "durationSeconds": null,
  "checksum": "optional-client-checksum"
}
```

Allowed `category` values are `face_photo`, `body_motion_reference`,
`voice_sample`, `dance_video_reference`, and `portfolio_attachment`. The backend
validates MIME family and size by asset type. Responses return the private asset
id, upload status, upload method/header policy, and private material policy; they
do not return public URLs or signed read URLs. Do not paste real upload target
URLs, signed URLs, tokens, cookies, secrets, or credentials into docs, logs,
Notion, or PR text.

Confirm upload validates the asset id, owner, `debut_application_material` scope,
private visibility, category, MIME family, file size, and object existence before
marking the asset uploaded. Local development uses a metadata-only placeholder;
object storage deployments verify the private object without exposing a read URL.
The storage key uses the existing direct-upload-authorized object prefix while
keeping `visibility = private` and `debut_application_material` scope, so this
remains separate from the public feed/profile upload API and public delivery
flow.

`POST /api/v1/debut/applications` may link only confirmed private materials owned
by the current user. Supported fields:

- `facePhotoAssetIds`
- `bodyMotionReferenceAssetIds`
- `voiceSampleAssetIds`
- `danceVideoReferenceAssetIds`
- `portfolioAttachmentAssetIds`

Linked materials are stored through `debut_application_attachments` with
`applicationId`, `assetId`, `category`, `sortOrder`, `status`, metadata, and
timestamps. Application payloads and metadata keep asset ids/relation data only;
they must not store public original URLs, signed URLs, upload target URLs,
tokens, or credentials.

Creator image request endpoints:

```http
GET /api/v1/me/creator-studio
GET /api/v1/me/creator-studio/payout-summary?period=2026-05
GET /api/v1/me/creator-studio/settlement-preview?period=2026-05
GET /api/v1/me/creator-studio/settlement-conversions?period=2026-05&status=requested
POST /api/v1/me/creator-studio/settlement-conversions
PATCH /api/v1/me/creator-studio/artists/:artistId/profile
POST /api/v1/creator-image-requests
GET /api/v1/me/creator-image-requests?artistId=<artistId>&status=submitted&requestType=profile_image&take=30&cursor=<nextCursor>
GET /api/v1/creator-image-requests/:requestId
GET /admin/api/v1/creator-image-requests?status=submitted&requestType=content_image&query=keyword&take=50&cursor=<nextCursor>
GET /admin/api/v1/creator-image-requests/:requestId
PATCH /admin/api/v1/creator-image-requests/:requestId
```

`creator_image_requests` stores the 1차 오픈 user-artist image production queue. It is for approved creator/artist operators who need profile images, content images, feed images, shortform thumbnails, or concept references.

Current workflow:

- `GET /api/v1/me/creator-studio` is the authenticated creator-studio bootstrap endpoint. It returns active artist operator rows, operated artist profile/assets, image request counters by artist/status, recent image requests, and frontend endpoint hints.
- The bootstrap response includes `viewer.userId`, `viewer.email`, `access.reason`, `access.source`, and `access.approvedApplication` for access debugging. Access is enabled for an active artist operator row or an approved debut application pending artist-operator linkage.
- The creator-studio bootstrap response now includes `access`, `summary`, and `policy.slotPolicy`. Frontend should show the account dropdown `스튜디오 스테이지` entry only when `access.enabled === true`.
- Initial creator studio slot policy is preview-only: `slotLimit = 10`, used/remaining slots are derived from active operator artist count, and paid slot expansion is `planned_not_open`.
- `GET /api/v1/me/creator-studio/payout-summary` is the creator-facing five-card payout summary projection for Creator Studio. Query `period=YYYY-MM` is optional and defaults to the current UTC month. It reuses settlement-preview calculations but returns only UI-safe fields: `grossLumina`, `eligibleLumina`, `grossAmount`, `taxAmount`, `netAmount`, `currency`, `fxSnapshot`, `shareRate`, `settlementTier`, and `policy.hidePayoutRow`.
- Payout summary is read-only. It does not create settlement records, does not confirm payouts, does not debit or credit wallets, does not split creator-facing amounts by paid/free Lumina, and does not expose raw internal sources such as `admin_grant`, `bonus`, or `ad_reward`.
- The first settlement currency is KRW. `fxSnapshot` is included as a future-safe placeholder for weekly reference FX rates plus a 3-5% safety margin when non-KRW display is opened later.
- `GET /api/v1/me/creator-studio/settlement-preview` is the creator-facing earnings estimate for active operated artists only. Query `period=YYYY-MM` is optional and defaults to the current UTC month.
- Creator Studio settlement preview includes completed chat orders, completed gift orders, paid-like boost events, premium video unlocks, and non-refunded paid fan letters. It excludes free likes and is preview-only, not a final payout record.
- `GET /api/v1/me/creator-studio/settlement-conversions` lists creator requests to convert estimated settlement money into Lumina. Query `period=YYYY-MM` and `status=requested|approved|rejected|credited|cancelled` are optional.
- `POST /api/v1/me/creator-studio/settlement-conversions` creates a request-only "settlement money charge" record. It does not move wallet balance. Body: `{ "settlementKey": "artist:<artistId>:YYYY-MM" | "partner:<userId>:YYYY-MM", "amountKrw": "1000", "note": "optional", "idempotencyKey": "optional" }`. Minimum amount is 1000 KRW; 1L is calculated as 10 KRW.
- Settlement conversion requests reserve against the current settlement preview balance for the same `settlementKey`; existing `requested`, `approved`, and `credited` conversion requests reduce the available request amount.
- `GET /admin/api/v1/backstage/settlement-conversions` lists creator settlement-to-Lumina requests for Backstage. Query supports `period`, `type=artist|partner`, `status=requested|approved|rejected|credited|cancelled`, `query`, `take`, and `cursor`.
- `POST /admin/api/v1/backstage/settlement-conversions/:conversionId/status` changes a request status. Body: `{ "status": "approved" | "rejected" | "credited" | "cancelled", "adminNote": "optional" }`. Only `credited` creates a Lumina wallet credit, increments `wallet_accounts.cached_balance`, stores `walletLedgerId`, and writes `wallet_ledger.ledger_type = settlement_lumina_conversion` with an idempotency key.
- `PATCH /api/v1/me/creator-studio/artists/:artistId/profile` is the limited creator-facing profile save endpoint. It requires active operator access and updates only `artist_public_profiles`, `artist_visual_profiles`, and `artist_content_profiles`.
- Creator-facing profile updates do not change artist `displayName`, `slug`, `status`, revenue share, ownership, launch state, or asset links. Those remain admin/operations responsibilities.
- Creator profile updates write `audit_events` with `actorType = "creator"` and action `creator_studio.artist_profile.update`.
- `POST /api/v1/creator-image-requests` requires an active `artist_operators` row for the current user and target `artistId`.
- `referenceAssetIds` can contain up to 8 confirmed image asset UUIDs from the existing user asset upload flow.
- User list/detail responses include requests created by the user and requests for artists the user actively operates.
- Admin list/detail require `assets:read`; admin update requires `assets:write`.
- Admin updates can set `status`, `moderationStatus`, `adminNote`, `rejectionReason`, `resultAssetIds`, and metadata.
- Allowed `requestType`: `profile_image`, `content_image`, `feed_image`, `shortform_thumbnail`, `concept_reference`.
- Allowed `status`: `submitted`, `reviewing`, `generating`, `needs_more_info`, `delivered`, `approved`, `rejected`, `archived`.
- Allowed `moderationStatus`: `pending`, `cleared`, `blocked`, `needs_review`.
- Final generated images are attached as existing `assets` through `resultAssetIds`; linking to public artist/profile/feed surfaces remains a separate product decision.
- The request flow must not store resident registration numbers, contracts, API keys, raw identity documents, or secrets.

AI premium content generation pipeline draft:

- `docs/ops/ai-premium-content-generation-contract-537.md` is the draft
  provider-neutral contract for combining image generation, video generation,
  and premium content packs under one server-owned flow.
- The draft keeps `creator_image_requests` as the current image queue while
  defining future request types, context snapshots, model routing, safety gates,
  cost/usage logs, admin tracking fields, and user-facing status separation.
- The draft does not enable live provider calls, wallet/order/settlement
  mutations, paid-like behavior, public publishing, or vendor-specific coupling.
- #597 adds a backend usage ledger guard skeleton at
  `server/src/creator-image-requests/ai-content-usage-ledger.contract.ts`.
  It records only provider-neutral usage fields: `requestId`, `providerFamily`,
  `modelAlias`, `capability`, `attempt`, `regenerationCount`,
  `estimatedCostMicros`, `actualCostMicros`, `inputUnits`, `outputUnits`,
  `failureCode`, and server timestamp.
- #746 extends that skeleton for the AI Middleware Pipeline by recording
  `requestType`, server-owned `modelRouteAlias`, and `safetyStatus` before any
  future provider attempt. The model route is a server alias such as
  `ai_premium_content.image.text_to_image`; vendor-specific provider/model
  identifiers are not part of this log contract.
- Safety-blocked requests may create only the sanitized skeleton log row and
  must not continue into provider execution, wallet/order work, settlement,
  payout, paid-like behavior, or public publishing.
- #851 adds a provider-free safety precheck contract before image/video
  generation. The precheck resolves `safe`, `review_required`, or `blocked`
  before any GPT Image, Stable Diffusion, Seedance, OpenAI, or other provider
  call. Risk categories are minor, real-person similarity, sexual content,
  copyright, and platform policy. Blocked/review decisions remain server-owned
  and must not mutate wallet, order, settlement, payout, paid-like, image
  generation, or video generation state.
- Usage summaries may calculate total attempts, failed attempts, failure rate,
  estimated/actual cost totals, input/output unit totals, and maximum
  regeneration count. These summaries are reporting guards only.
- The usage guard must not store or log vendor credentials, raw provider
  payloads, raw prompts, raw asset bytes, token, cookie, password, API key, or
  DB URL.
- AI content usage rows do not mutate wallet, payment order, settlement, payout,
  revenue-share, or paid-like state. Future duplicate protection should use
  `ai-content-usage:<requestId>:<attempt>` or an equivalent server-scoped key.

AI premium content request state API skeleton (#591):

- `AI_PREMIUM_CONTENT_STATE_API_CONTRACT.version` is
  `2026-06-02.ai-premium-content-request-state-api-skeleton.v1` and remains
  `skeleton_ready_mutation_blocked`.
- This contract defines image/video/mixed request state only. It does not
  enable live provider calls, wallet/order mutation, settlement, payout,
  paid-like behavior, public publishing, or profile/feed equip side effects.
- Request types are `image_single`, `image_variation`, `image_reference`,
  `video_clip`, `video_loop`, and `premium_pack`. Output classes are `image`,
  `video`, and `mixed`.
- Planned state endpoints remain disabled:
  - `GET /api/v1/me/ai-premium-content/requests`
  - `GET /api/v1/ai-premium-content/requests/:requestId`
  - `GET /admin/api/v1/ai-premium-content/requests`
  - `GET /admin/api/v1/ai-premium-content/requests/:requestId`
  - `POST /api/v1/ai-premium-content/requests`
  - `POST /api/v1/ai-premium-content/requests/:requestId/regenerations`
  - `PATCH /admin/api/v1/ai-premium-content/requests/:requestId`
- `creator_image_requests` remains the current image queue bridge candidate.

AI premium content request brief API skeleton (#662):

- `server/src/ai-premium-content/ai-premium-content-state-contract.ts` exports
  `AI_PREMIUM_CONTENT_BRIEF_API_SKELETON` version
  `2026-06-05.ai-premium-content-brief-api-skeleton.v1`.
- The planned endpoint is `POST /api/v1/ai-premium-content/requests`, but it
  remains `enabled: false`, `submitEnabled: false`, and `mutation: false` until
  backend implementation and QA explicitly open it.
- The skeleton tracks only request type, artist slug/server-resolved artist id,
  sanitized brief shape, server-owned safety status, and server-owned estimated
  cost fields.
- #711 keeps provider routing abstract through server aliases such as
  `ai_premium_content.image.text_to_image`. The contract may expose only the
  route alias and capability alias; it must not expose vendor provider keys,
  model keys, raw prompts, provider payloads, wallet fields, settlement fields,
  payout fields, or paid-like mutation state.
- Provider calls, wallet debit, order creation, settlement accrual, payout
  accrual, paid-like mutation, public publish, and profile/feed equip side
  effects are all blocked by contract.
  `premium_video_products` remains an unlock catalog, not a generation request
  queue. Future unified storage requires `ai_premium_content_requests`.
- Public request state projection separates request status, moderation status,
  result availability, retry availability, and publish/equip availability.
- #779 separates owner and admin projections before the API is enabled. Owner
  list/detail projections may show user-facing status, moderation status, result
  availability, retry/publish availability, safe brief/reference previews, and
  user-facing safety summaries. Admin projections may additionally show safe
  review summaries, moderation reason keys, cost policy summaries, and generation
  attempt summaries.
- #801 adds `AI_PREMIUM_CONTENT_REQUEST_QUEUE_SKELETON` as the provider-neutral
  queue shape for future image, video, and mixed generation requests. It keeps
  `creator_image_requests` as the current image bridge and
  `ai_premium_content_requests` as future storage while `enabled`,
  `storageEnabled`, `providerCallEnabled`, and all paid/public mutation gates
  remain false. The normalized queue fields are request type, artist slug,
  server-owned safety status, server-policy estimated cost, and server provider
  route alias. Vendor provider keys, model keys, raw prompts, provider payloads,
  signed URLs, sensitive auth material, and database connection material must
  not be returned or logged by this skeleton.
- #883 adds `AI_PREMIUM_CONTENT_CREATE_STATUS_API_SKELETON` for the future
  create/status API surface. It keeps `POST /api/v1/ai-premium-content/requests`
  and `GET /api/v1/ai-premium-content/requests/:requestId/status` disabled with
  `enabled=false`, `submitEnabled=false`, and `mutation=false`. The canonical
  status projection for this surface is `pending`, `safety_review`, `blocked`,
  `queued`, `generating`, `ready`, and `failed`.
- The #883 create shape is provider-neutral and stores request type, artist
  slug, sanitized user intent summary, server-owned safety status, server
  provider route alias, and server-policy estimated cost. Client-submitted
  provider status, model/vendor ids, cost, wallet balance, result URLs, and
  publish/equip decisions are not trusted.
- #898 extends the create/status skeleton with separate canonical status axes:
  request type, safety status, routing status, and result status. Raw enum
  values are not user copy; responses must use stable localized message keys.
- #898 keeps image, video, and mixed premium content under one request status
  model. Provider routing is server-selected through adapter keys such as
  `image_generation_primary`, `image_generation_diffusion`,
  `video_generation_primary`, and `mixed_generation_pack`, plus
  `ai_premium_content.*` route aliases. Vendor/provider/model names remain
  non-contract implementation details.
- #1013 adds `AI_PREMIUM_CONTENT_MODEL_ROUTING_API_SKELETON` for the future
  middleware route selection surface
  `POST /api/v1/ai-premium-content/requests/model-routing`. It separates
  request type, server-resolved artist context, server-owned safety state,
  selected route alias/adapter family, and server cost policy. The skeleton is
  disabled and must not call GPT Image, Stable Diffusion, Seedance, OpenAI, or
  any provider; it also must not create queue/request rows, debit wallet/Lumina,
  create payment orders, or touch settlement/payout. Selected vendor model ids,
  provider payloads, raw prompts, safety payloads, and provider secrets are not
  returned.
- #1135 adds `AI_PREMIUM_CONTENT_COST_ESTIMATE_PROJECTION_CONTRACT` as a
  disabled read-only projection for request cost UI wiring. It combines request
  type, output class, route alias/class, server-policy estimated cost,
  free/paid request state, required Lumina preview, and video consent state into
  one provider-agnostic projection. Provider/model vendor names, provider
  quotes, raw provider payloads, and client-submitted cost or required Lumina
  are not authority. Video and mixed output require explicit video consent before
  generation, and estimate reads must not call providers, create requests/orders,
  debit wallet/Lumina, or touch settlement/payout.
- #907 adds the future result archive read projection at
  `GET /api/v1/me/ai-premium-content/results`. It remains disabled and
  read-only, but defines one owner-facing archive for image, video, and mixed
  AI premium content results.
- The #907 archive item separates completed, reviewing, blocked, failed, and
  regeneratable states from raw enums and uses stable copy keys. It may expose
  safe result asset ids and a user-facing price label, but not original provider
  result URLs, signed URLs, raw prompts, provider payloads, internal cost
  breakdowns, settlement cost, payout cost, or wallet/order mutation state.
- #934 adds `AI_PREMIUM_CONTENT_STATUS_PREVIEW_FIXTURE_CONTRACT` for a future
  public, read-only QA status sheet preview at
  `GET /api/v1/ai-premium-content/status-preview-fixture`. It remains
  `enabled=false`, `authRequired=false`, and `mutation=false`; fixture states
  cover Korean display copy for reviewing, generating, completed, blocked,
  failed, and regeneratable. Raw request/result/provider enums are never user
  copy, provider payloads/prompts/signed URLs are not returned, and the preview
  must not create requests, call GPT Image, Stable Diffusion, Seedance,
  OpenAI/provider routes, debit wallet, create orders, settlement, payout,
  paid-like, or publish/equip content.
- #1044 mounts the #934 status preview fixture route as a read-only,
  unauthenticated QA projection so no-provider live smoke can receive a stable
  200 response instead of a missing route. The response exposes Korean display
  labels and message keys only, keeps raw enum values out of UI copy, and
  reports provider, prompt, safety payload, signed URL, internal cost, request,
  wallet, order, settlement, payout, paid-like, and publish/equip side effects
  as disabled. This does not enable submit, generation, provider routing, or
  owner-facing status APIs.
- #1030 adds
  `AI_PREMIUM_CONTENT_USER_FACING_REQUEST_STATUS_API_SKELETON` for future
  owner-facing read status at `GET /api/v1/me/ai-premium-content/requests`,
  `GET /api/v1/ai-premium-content/requests/:requestId`, and
  `GET /api/v1/me/ai-premium-content/results`. It remains
  `enabled=false`, `readOnly=true`, and `mutation=false`.
- The #1030 user-facing status buckets are received, reviewing, producing,
  completed, blocked, failed, and regeneratable. Responses must use stable
  localized keys plus Korean fallback copy such as "접수되었어요",
  "검수 중이에요", "제작 중이에요", "완료되었어요", "진행할 수 없어요",
  "제작에 실패했어요", and "재생성을 요청할 수 있어요"; raw enums or
  English keys such as `active`, `accepted`, `provider_failed`, or
  `not_started` must not be shown as UI copy.
- #1030 is projection-only. It must not return provider internal state, raw
  prompts, provider payloads, safety payloads, internal/provider cost values,
  signed URLs, wallet ledger ids, settlement ids, payout ids, or sensitive auth
  material. It also does not enable GPT Image, Stable Diffusion, Seedance,
  OpenAI/provider calls, request creation, regeneration submission, payment,
  wallet, settlement, payout, paid-like, feed publish, or profile equip
  mutation.
- #1170 adds `AI_PREMIUM_CONTENT_REUSE_COST_CACHE_SKELETON` for provider-
  agnostic reuse/cost cache readiness. Cache keys are server-derived from
  request fingerprint, artist scope, output class, and policy version; clients
  cannot force cache hit or regeneration. Cache hits may avoid provider calls
  only when server/human policy allows reuse and must disclose reuse instead of
  claiming a fresh generation. Cost projection exposes only safe buckets such
  as estimated cost bucket, failure-rate bucket, and regeneration count; raw
  prompts, provider payloads, provider costs, internal cost micros, provider
  credentials, cache keys, tokens, cookies, API keys, and DB URLs are not
  returned. This remains read-only and does not enable provider, wallet, order,
  settlement, payout, request submit, or regeneration mutation.
- #1053 adds `AI_PREMIUM_CONTENT_VIDEO_CONSENT_EXCEPTION_CONTRACT` for the
  video-only cost-consent exception state. It remains disabled/read-only and
  does not submit requests, call providers, create payment orders, debit wallet,
  or touch settlement/payout. If a user declines video cost consent, video
  results stay hidden while existing text/image request flow and safe previews
  continue; the whole request is not cancelled by this state. UI copy must use
  Korean fallback labels such as "영상 제작 비용 동의가 필요해요" and
  "영상 제작은 진행하지 않아요" rather than raw state/provider enums. The
  disabled read-only state API exposes only safe UI fields, including
  `videoResultVisible`, `textResultVisible`, `imageResultVisible`, and
  `requestContinues`.
- #883 does not enable GPT Image, Stable Diffusion, Seedance, OpenAI/provider
  calls, image/video generation, wallet debit, order creation, settlement,
  payout, paid-like mutation, profile equip, or feed publish side effects.
- #873 adds `CHARACTER_CHAT_AI_PREMIUM_CONTENT_HANDOFF_CONTRACT` for the future
  character-chat-to-AI-content request bridge. It is adapter-only and disabled:
  normal character chat remains `ai_character_chat` / `ai_character_reply`,
  artist direct premium DM remains `artist_direct_premium_dm` /
  `artist_direct_reply`, and image/video/mixed content requests remain
  `ai_premium_content_request` / `async_ai_content_generation_request`.
- The #873 handoff may carry only a source message reference, server-resolved
  artist slug, server-classified request type, and sanitized user-intent
  summary. It must not copy the full chat transcript as a provider prompt or
  expose raw request enums as user copy.
- #873 does not enable `POST /api/v1/ai-premium-content/requests`, GPT Image,
  Stable Diffusion, Seedance, OpenAI/provider calls, wallet/order mutation,
  settlement, payout, paid-like mutation, notification creation, premium DM room
  creation, or character-chat AI reply creation.
- Raw state enums such as `provider_failed` must not be shown directly. Use the
  Korean fallback map: `draft` = `작성 중`, `submitted` = `요청이 접수됐어요`,
  `queued` = `생성 준비 중이에요`, `generating` = `콘텐츠를 만들고 있어요`,
  `awaiting_review` = `검수 중이에요`, and `approved` =
  `콘텐츠가 준비됐어요`.
- The server owns request status, moderation status, provider state, cost, result
  asset ids, context snapshots, and safety gates. Client-submitted status,
  provider status, cost, result URLs, wallet balance, and publish/equip decisions
  are not trusted.
- The projection must not return raw provider payloads, raw prompts, private
  reference material, signed URLs, sensitive auth material, private connection
  material, raw emails, wallet ledger ids, settlement internals, or payout
  internals.
- Both owner and admin projections must keep provider keys, model keys, raw
  prompts, raw provider payloads, raw moderation notes, internal cost breakdowns,
  wallet ledger ids, settlement ids, and payout ids out of response bodies.

Free-like quota endpoint:

```http
GET /api/v1/me/free-like-quota
Authorization: Bearer <accessToken>
```

Response:

```json
{
  "campaign": {
    "id": "campaign-uuid",
    "slug": "mvp-launch-main-pick",
    "name": "루미나 메인픽"
  },
  "dailyLimit": 1,
  "usedToday": 0,
  "remaining": 1,
  "resetsAt": "2026-05-03T00:00:00.000Z"
}
```

Fan engagement endpoints:

```http
GET /api/v1/fan-engagement/missions?surface=home&scope=today&take=20
GET /api/v1/fan-engagement/concept-votes?artistId=<artistId>&status=active
POST /api/v1/fan-engagement/concept-votes/:voteId/ballots
POST /api/v1/fan-engagement/missions/:missionId/participations
GET /api/v1/me/fan-engagement/summary
PATCH /api/v1/me/fan-engagement/title
GET /api/v1/users/:userId/fan-engagement/public-summary
```

- Mission and concept vote list endpoints support optional auth and return viewer
  participation hints when a user token is present.
- Mission participation and concept vote ballots require auth and use
  `idempotencyKey` for safe replay.
- Fan engagement points, achievements, and titles are not cash-like, not
  transferable, not settlement eligible, and not convertible to Lumina.
- `PATCH /me/fan-engagement/title` equips an already-owned active fan title.
- `GET /users/:userId/fan-engagement/public-summary` exposes only public title
  and public badge data. It does not expose private participation history or
  point ledger rows.

Fan letter endpoints:

```http
GET /api/v1/fan-letters/policy
POST /api/v1/fan-letters/preview
POST /api/v1/fan-letters
GET /api/v1/me/fan-letters/sent?take=30
GET /api/v1/me/fan-letters/received?artistId=<artistId>&status=submitted
PATCH /api/v1/me/fan-letters/received/:fanLetterId/status
Authorization: Bearer <accessToken>
```

MVP fan letters are the low-cost paid communication layer before full character chat.
The default fan-letter product is `FAN_LETTER_BASIC_30L`, priced at `30L`
(300 KRW equivalent at the current 1L = 10 KRW policy).

Create body:

```json
{
  "artistId": "artist-uuid-or-slug",
  "title": "optional title",
  "body": "10-1000 character fan letter",
  "idempotencyKey": "client-generated-key"
}
```

- Create deducts 30L from the sender wallet and writes `wallet_ledger.ledger_type = fan_letter_spend`.
- Create requires `Idempotency-Key` header or body `idempotencyKey` before the
  wallet debit.
- `fan_letters` are included in Backstage settlement preview as `productBreakdown.fan_letter`, but final settlement must still apply VAT, PG fees, refund/chargeback risk, and creator contract terms.
- Artist operators can read received letters for artists they operate through `GET /me/fan-letters/received`.
- Operator status update accepts `submitted`, `seen`, `replied`, or `archived`. `replied` requires `replyBody` and notifies the sender.
- `moderationStatus` starts as `pending`; adult/direct DM behavior is not open in this MVP.

## 2026-05-05 Backstage Launch Readiness

```http
GET /admin/api/v1/backstage/launch-readiness
Authorization: Bearer <admin accessToken>
```

This is an operations signal for the "1차 오픈 최소 80%" discussion. It does
not replace the user's final launch decision. It groups backend/database signals
into categories:

- `public_content`
- `lumina_commerce`
- `social_feed`
- `creator_studio`
- `ops_safety`

Response shape:

```json
{
  "target": {
    "minimumCategoryScore": 80,
    "minimumOverallScore": 80
  },
  "overall": {
    "score": 82,
    "status": "ready_candidate",
    "belowTargetCategories": []
  },
  "categories": [
    {
      "key": "social_feed",
      "label": "Lumina Feed/SNS flow",
      "score": 80,
      "targetScore": 80,
      "status": "ready_candidate",
      "metrics": {},
      "blockers": [],
      "nextActions": []
    }
  ]
}
```

## 2026-05-02 Lumina Feed / Follow Addendum

Lumina Feed supports artist posts, AI artist posts, and normal user posts. Normal users are first-class follow targets so creator/fan acquisition is not limited to artist accounts.

Follow endpoints:

```http
POST /api/v1/artists/:artistId/follow
DELETE /api/v1/artists/:artistId/follow
POST /api/v1/users/:userId/follow
DELETE /api/v1/users/:userId/follow
GET /api/v1/me/following
GET /api/v1/me/following-artists
GET /api/v1/me/following-users
GET /api/v1/me/followers
GET /api/v1/users/:userId/followers
GET /api/v1/users/:userId/following-users
GET /api/v1/users/:userId/following-artists
GET /api/v1/users/handle/:publicHandle/followers
GET /api/v1/users/handle/:publicHandle/following-users
GET /api/v1/users/handle/:publicHandle/following-artists
GET /api/v1/users/handle/:publicHandle/profile
POST /api/v1/users/handle/:publicHandle/follow
DELETE /api/v1/users/handle/:publicHandle/follow
POST /api/v1/users/handle/:publicHandle/block
DELETE /api/v1/users/handle/:publicHandle/block
Authorization: Bearer <accessToken>
```

- `artistId` can be an artist UUID or slug.
- `userId` must be a user UUID and cannot equal the current user id.
- `GET /api/v1/me/following` returns `{ artists, users }`.
- `GET /api/v1/me/following-users?take=20&cursor=<followId>` and `GET /api/v1/me/followers?take=20&cursor=<followId>` return wrapped lists with `{ items, users, count, total, nextCursor }`. Cursor is the follow row id.
- Public follow-list endpoints are optional-auth reads for another active public user profile:
  - `GET /api/v1/users/:userId/followers?take=20&cursor=<followId>`
  - `GET /api/v1/users/:userId/following-users?take=20&cursor=<followId>`
  - `GET /api/v1/users/:userId/following-artists?take=20&cursor=<followId>`
  - `GET /api/v1/users/handle/:publicHandle/followers?take=20&cursor=<followId>`
  - `GET /api/v1/users/handle/:publicHandle/following-users?take=20&cursor=<followId>`
  - `GET /api/v1/users/handle/:publicHandle/following-artists?take=20&cursor=<followId>`
- Public profile stats use the same authenticated viewer block filter as the
  follow-list read model. If the viewer has an active `user_blocks` relationship
  with a follower/following user in either direction, that row is excluded from
  `stats.followerCount`, `stats.followingCount`, `stats.followers`, and
  `stats.followingUsers`. A block relationship with the target profile itself
  still fails closed with `403 USER_PROFILE_BLOCKED`; empty follow lists return
  `{ items: [], count: 0, total: 0, nextCursor: null }`.
- #935 fixes the public user follow-list projection contract as
  `USER_SOCIAL_ACCOUNT_CONTRACT.profileFollowLists.publicListProjection`.
  Follower and following-user endpoints by id or handle must use the same
  visibility filter for list rows and counts: active target profile,
  non-deleted follow row, active non-deleted source/target users, and no active
  block relationship in either direction for authenticated viewers. Deleted,
  suspended, inactive, or private users are hidden before counting so `items`,
  `count`, `total`, and profile stats do not drift. The projection is read-only
  and does not run follow, unfollow, or block mutations.
- #936 adds `USER_SOCIAL_ACCOUNT_CONTRACT.followerBlockProjectionGuard` so
  blocking a follower uses one fail-closed read policy across feed, profile, and
  follow-list projections. Active `user_blocks` rows in either direction hide
  blocked users' feed rows and follower/following rows before pagination and
  count, and direct profile reads fail with `USER_PROFILE_BLOCKED`. Viewer hints
  must not leak blocked users' private fields. This guard does not add block,
  follow, unfollow, feed, wallet, Lumina, settlement, or payout mutation.
- Public user follow-list responses use the existing My Page pagination contract and add a safe target/viewer/policy envelope:

```json
{
  "items": [
    {
      "id": "follow-row-uuid",
      "status": "active",
      "followedAt": "2026-05-27T00:00:00.000Z",
      "updatedAt": "2026-05-27T00:00:00.000Z",
      "user": {
        "id": "public-user-uuid",
        "displayName": "public display name",
        "publicHandle": "public-handle",
        "avatarUrl": "public asset url or null"
      },
      "viewer": {
        "isAuthenticated": true,
        "isSelf": false,
        "isFollowing": true,
        "canFollow": false,
        "canUnfollow": true,
        "canEditProfile": false,
        "blockedByMe": false,
        "hasBlockedMe": false
      }
    }
  ],
  "users": [
    {
      "id": "follow-row-uuid",
      "status": "active",
      "followedAt": "2026-05-27T00:00:00.000Z",
      "updatedAt": "2026-05-27T00:00:00.000Z",
      "user": {
        "id": "public-user-uuid",
        "displayName": "public display name",
        "publicHandle": "public-handle",
        "avatarUrl": "public asset url or null"
      },
      "viewer": {
        "isAuthenticated": true,
        "isSelf": false,
        "isFollowing": true,
        "canFollow": false,
        "canUnfollow": true,
        "canEditProfile": false,
        "blockedByMe": false,
        "hasBlockedMe": false
      }
    }
  ],
  "count": 1,
  "total": 1,
  "nextCursor": null,
  "target": {
    "id": "target-user-uuid",
    "displayName": "target display name",
    "publicHandle": "target-handle",
    "avatarUrl": "public asset url or null"
  },
  "viewer": {
    "isAuthenticated": true,
    "isSelf": false,
    "canViewList": true,
    "blockedByMe": false,
    "hasBlockedMe": false
  },
  "policy": {
    "projection": "public_user_follow_summary_v1",
    "visibility": "public_active_profiles_only",
    "hiddenUserRule": "Only active non-deleted users and public active artists are returned.",
    "blockedUserRule": "Authenticated viewers do not receive list rows for users in an active block relationship; a block relationship with the target profile returns 403.",
    "viewerHints": [
      "isAuthenticated",
      "isSelf",
      "isFollowing",
      "canFollow",
      "canUnfollow",
      "blockedByMe",
      "hasBlockedMe"
    ],
    "privateFieldsExcluded": [
      "email",
      "phone",
      "providerIds",
      "walletAccounts",
      "walletLedger",
      "paymentOrders",
      "privateProfile",
      "moderationNotes"
    ]
  }
}
```

- `following-artists` rows replace `user` with the existing compact public artist projection and return `artists` as the list alias. They must not expose internal artist ownership, settlement, payout, or operator fields.
- Implementation status: public follow-list routes are live for
  `GET /api/v1/users/:userId/followers`,
  `GET /api/v1/users/:userId/following-users`,
  `GET /api/v1/users/:userId/following-artists`,
  `GET /api/v1/users/handle/:publicHandle/followers`, and
  `GET /api/v1/users/handle/:publicHandle/following-users`,
  `GET /api/v1/users/handle/:publicHandle/following-artists`. Existing follow,
  unfollow, block, unblock, remove-follower, public profile, and My Page
  follow-list routes are live under the current addendum.
- Public follow-list endpoints accept optional bearer auth. Anonymous callers can read public active profiles; authenticated callers receive viewer hints and block filtering. If the viewer has an active block relationship with the target profile in either direction, the endpoint returns `403 USER_PROFILE_BLOCKED` with `messageKey: "social.profile.blocked"`.
- Public follow-list item projection is limited to public profile fields plus viewer-safe relationship hints: ids needed for routing, display name, public handle/slug, public avatar URL, follow row timestamps, status, `viewer.isFollowing`, `viewer.canFollow`, `viewer.canUnfollow`, `viewer.blockedByMe`, and `viewer.hasBlockedMe`. It must not expose email, social provider ids, phone, private bio metadata, wallet/Lumina balances, payment/refund/order rows, settlement/payout state, or admin/moderation notes.
- Public follow-list item visibility is fail-closed for active blocks. Authenticated viewers do not receive rows for listed users in an active block relationship with them; if the block relationship is with the target profile itself, the whole list read returns `403 USER_PROFILE_BLOCKED`.
- `GET /api/v1/users/handle/:publicHandle/profile` is public and returns the same shape as `GET /api/v1/users/:userId/profile`, resolving by the unique `user_profiles.public_handle`.
- Public user profile responses include `user.coverImageUrl`; render the frontend default cover when it is `null`.
- Public user profile routes accept optional bearer auth. When present and valid, responses include `viewer.isSelf`, `viewer.isFollowing`, `viewer.canFollow`, `viewer.canUnfollow`, and `viewer.canEditProfile`.
- User profile post lists are available at `GET /api/v1/users/:userId/lumina-feed` and `GET /api/v1/users/handle/:publicHandle/lumina-feed`. They return public, published, non-deleted posts only, with cursor pagination by post id.
- Handle-based follow/block endpoints resolve active users by `publicHandle` and then reuse the UUID follow/block policy, including self-action checks, idempotent unfollow/unblock, and block-triggered mutual unfollow.
- User follow rows return `{ id, status, followedAt, updatedAt, user: { id, displayName, publicHandle, avatarUrl } }`.
- Follow/unfollow action responses include UI refresh hints. Artist actions return `artist`, `stats.followerCount`, and `viewer.isFollowing/canFollow/canUnfollow`. User actions return `user`, `stats.followerCount/followingCount`, and the same viewer flags.
- `user_follows` uses soft delete/reactivation with unique `(follower_user_id, following_user_id)`.

Personalized feed safety endpoints:

```http
GET /api/v1/me/lumina-feed?mode=all&take=20
GET /api/v1/me/lumina-feed?mode=following&take=20
GET /api/v1/lumina-feed/search?q=최서진&type=text&language=ko&take=20
GET /api/v1/lumina-feed/search?q=%23seojin&type=hashtag&language=all&take=20
GET /api/v1/lumina-feed/search-suggestions?q=seo&language=all&window=24h&take=8
GET /api/v1/lumina-feed/trending-searches?language=all&type=all&window=1h&take=10
GET /api/v1/lumina-feed/hashtags?language=all&window=24h&take=20
GET /api/v1/lumina-feed/posts/:postId
POST /api/v1/lumina-feed/posts/thread
GET /api/v1/lumina-feed/posts/:postId/thread-continuations
POST /api/v1/lumina-feed/posts/:postId/thread-continuations
POST /api/v1/lumina-feed/posts/:postId/reposts
POST /api/v1/lumina-feed/posts/:postId/share
PATCH /api/v1/lumina-feed/posts/:postId/thread-items/:itemId
DELETE /api/v1/lumina-feed/posts/:postId/thread-items/:itemId
DELETE /api/v1/lumina-feed/posts/:postId
DELETE /api/v1/lumina-feed/replies/:replyId
POST /api/v1/lumina-feed/posts/:postId/hide
DELETE /api/v1/lumina-feed/posts/:postId/hide
GET /api/v1/me/hidden-posts?take=20
POST /api/v1/users/:userId/block
DELETE /api/v1/users/:userId/block
DELETE /api/v1/me/followers/:userId
GET /api/v1/me/blocked-users?take=20
Authorization: Bearer <accessToken>
```

- `GET /api/v1/me/lumina-feed` matches the public feed query/response shape, but filters out active `community_hidden_posts` for the current user and posts authored by users in an active block relationship.
- `mode=following` on `GET /api/v1/me/lumina-feed` returns posts from active followed artists and followed normal users. If the viewer follows nobody, it returns `[]`.
- Signed-in post rows include follow button hints in `viewer`: `isFollowingArtist`, `isFollowingAuthor`, `canFollowArtist`, `canUnfollowArtist`, `canFollowAuthor`, and `canUnfollowAuthor`. Public `GET /api/v1/lumina-feed` remains viewer-agnostic.
- Public and signed-in feed post `author` projections expose only routing-safe
  public profile fields. They must not include `author.email`, phone, social
  provider ids, wallet/Lumina balances, payment/refund/order rows,
  settlement/payout state, or admin/moderation notes.
- `GET /api/v1/lumina-feed/search` searches public published feed posts by text or hashtag and records deduped `feed_search_events` for trending aggregation. Optional bearer auth adds viewer hints to post rows.
- `GET /api/v1/lumina-feed/search-suggestions` returns grouped search-box suggestions from recent search events, recent post hashtags, active artists, and active user profiles.
- `GET /api/v1/lumina-feed/trending-searches` returns grouped popular search terms. `language=all|ko|ja|en|zh|unknown`, `type=all|text|hashtag`, and `window=15m|1h|6h|24h|7d` are supported. Use `language=all` plus viewer locale language for the 1차 UI because early per-language search volume can be sparse.
- `GET /api/v1/lumina-feed/hashtags` parses hashtags from up to the latest 500 public feed posts in the selected window. Use it for search chips before search-event volume is high enough.
- `GET /admin/api/v1/backstage/operations/feed-search-analytics` returns Backstage-only search analytics from `feed_search_events`, including grouped keywords, recent events, zero-result counts, and language/type/window filters.
- `POST /api/v1/lumina-feed/posts` accepts regular feed `body` up to 2200 characters and allows image-only posts. If `assetIds` contains at least one confirmed public image asset, `body` may be an empty string. Text-only posts still require non-empty `body`.
- `POST /api/v1/lumina-feed/posts/thread` remains the legacy manual multi-piece post contract. It accepts `body` for a one-piece post or `items`/`threadItems`/`pieces` arrays for a manual thread. Every piece is trimmed and limited to 500 characters; 11 or more pieces return `400`. The backend does not auto-split text.
- Thread post rows include `thread`: `{ isThread, rootPostId, itemCount, threadCount, maxItems, previewText, items, autoSplit, rootOnlyEngagement, engagementTarget, assetTarget }`. List rows can render `thread.isThread`, `thread.itemCount`, and `thread.previewText`; detail can use `thread.items` ordered by `position`.
- `GET /api/v1/lumina-feed/posts/:postId` returns `{ post, policy }` for public published non-deleted posts and includes the ordered thread projection.
- `PATCH /api/v1/lumina-feed/posts/:postId/thread-items/:itemId` edits a non-root thread item body for the root author only. Root body edits continue to use `PATCH /api/v1/lumina-feed/posts/:postId`.
- `DELETE /api/v1/lumina-feed/posts/:postId/thread-items/:itemId` soft-deletes a non-root thread item for the root author only and is idempotent after the item is already deleted.
- Thread likes, comments, reports, hides, and image assets remain root-post based in this phase. There is no wallet, Lumina, settlement, payout, or order mutation in thread create/edit/delete.
- Canonical feed "이어쓰기" is `thread_continuation`, not automatic long-text splitting. Use `POST /api/v1/lumina-feed/posts/:postId/thread-continuations` to add a new continuation post under an existing public published root post. The caller must be the root post author; non-authors receive `403`, and missing/deleted/private roots are safe `404`.
- #620 contract note: the canonical continuation button means "append to an already-created post." It is not the legacy manual multi-piece thread composer and it never auto-splits an overlong draft.
- Thread continuation body is required and limited to 500 characters. The created post is a normal `community_posts` row with `metadata.threadContinuation`: `{ type: "thread_continuation", rootPostId, parentPostId, source: "existing_post", displayPlacement: "under_root_post", commentRelation: false, replyRelation: false, autoSplit: false }`.
- `GET /api/v1/lumina-feed/posts/:postId/thread-continuations?take=20&cursor=<postId>` lists continuation posts only. It does not return normal comments/replies. Rows include `post.threadContinuation` so the UI can place them under the root post without confusing them with reply/comment projections.
- #872 state contract: thread continuation uses `actionKey: "feed_thread_continue"` and `stateKey: "thread_continuation"`. Its count target is the continuation list, not the root manual `threadCount`, repost count, share count, or reply count.
- Use `POST /api/v1/lumina-feed/posts/:postId/reposts` for repost and quote repost. It requires login, accepts optional `{ "body": "quote text, max 2200 chars" }`, creates a user-owned public repost row, and preserves `metadata.repost.originalPostId` plus original author/artist ids. Empty body creates `repost`; non-empty body creates `quote_repost`. Hidden/deleted/private source posts return safe `404`.
- Repost rows include `post.repost`: `{ isRepost, type, hasQuote, parentPostId, threadRootPostId, commentRelation, replyRelation, threadRelation, originalPostId, originalAuthorUserId, originalArtistId, quoteBody, originalState, tombstone, unavailableReason, originalPost, policy }`. Repost projection must not be treated as a thread/comment/reply relation. If the original becomes deleted/hidden/private/blocked, or the current viewer has hidden the original or has an active block relationship with the original author, render the embedded original as unavailable/tombstone and do not expose the original body. Quote repost detail reads keep `post.repost.quoteBody` separate from `post.repost.originalPost.body`; the quote body may remain visible while the original is tombstoned, but the original body is returned only when the original is visible to the viewer.
- #1032 fixes the quote body validation policy for reposts. The backend trims
  `body` before validation, allows empty or whitespace-only body as a simple
  `repost`, treats non-empty body as `quote_repost`, and caps quote body at
  2200 characters. Over-limit body returns a validation error before creating a
  feed row. Missing, deleted, hidden, private, reported/moderation-review,
  viewer-hidden, or blocked source posts are safe not-found/tombstone cases and
  must not expose the original body. Repost/quote repost projection stays
  separate from thread, continuation, comment, reply, and share projections.
  Share remains a read-only URL/Web Share contract and does not create feed
  rows, notifications, repost counts, wallet, Lumina, settlement, payout, order,
  or paid-like state.
- #872 state contract: simple repost uses `actionKey: "feed_repost"` / `stateKey: "repost"` and quote repost uses `actionKey: "feed_quote_repost"` / `stateKey: "quote_repost"`. Repost count is separate from manual thread count, continuation list count, share count, and reply/comment count.
- Use `POST /api/v1/lumina-feed/posts/:postId/share` to request the public share contract for a public published post, including another user's post. It returns `relation: "share"`, `createsFeedRow: false`, `repostRelation: false`, `threadRelation: false`, `commentRelation: false`, `replyRelation: false`, `share.publicPath`, `share.webShare`, and `share.countStrategy: "not_mutated_by_share_contract"`. It does not require author ownership and does not create a repost, feed row, share ledger, wallet, Lumina, settlement, payout, order, or paid-like mutation.
- #800 count projection: repost and quote repost are the only rows included in repost/profile repost counters and repost notifications. The share contract remains a read-only URL projection and does not mutate repost count, quote repost count, share count, profile repost tabs, notification rows, or unread notification counters. Blocked relationships fail closed before repost creation/notification mutation and blocked relationship rows are excluded or tombstoned in read/count projections.
- #872 state contract: share uses `actionKey: "feed_share"` / `stateKey: "share_contract"` with `countTarget: null`. Deleted, hidden, private, or blocked source posts fail closed as safe not-found/tombstone projections, and share does not mutate thread, repost, reply, wallet, Lumina, settlement, payout, order, or paid-like state.
- #899 exports `LUMINA_FEED_THREAD_REPOST_COUNT_PROJECTION_CONTRACT` as the
  backend read-model contract for these lanes. Thread continuation is an
  existing-post child post flow with count source
  `community_posts.metadata.threadContinuation.rootPostId`; it is not automatic
  long-text splitting and is excluded from manual thread, repost, share, reply,
  and comment counts.
- #899 keeps repost and quote repost counters tied only to
  `community_posts.metadata.repost.originalPostId`, with quote text separate
  from the original post projection. Share remains a URL/Web Share projection
  with `countTarget: null`; it creates no feed row, notification row, unread
  count, wallet, Lumina, settlement, payout, order, or paid-like mutation.
- #1015 exports `LUMINA_FEED_THREAD_REPOST_SHARE_PM_PROJECTION_CONTRACT` as a
  follow-up read-model boundary for PM wording. Thread continuation means
  "append after publish" against an already-created root post; it is not a long
  draft composer, automatic text split, or legacy manual thread authoring flow.
  Repost means bringing the original post into the viewer-owned feed context,
  with quote text stored separately from the original body and with no thread,
  comment, reply, or share relation. Share remains a read action for public
  share URL/Web Share projection, including another user's post; it requires no
  author ownership and creates no feed row, repost row, share ledger,
  notification, unread count, wallet, Lumina, settlement, payout, order, or
  paid-like mutation.
- #908 exports `LUMINA_FEED_REPOST_PERMISSION_GUARD_CONTRACT` to keep simple
  repost, quote repost, and share URL guards separate. Repost uses
  `feed_repost`/`repost`, quote repost uses `feed_quote_repost`/`quote_repost`,
  and share uses `feed_share`/`share_contract` with `createsFeedRow: false`.
  Guard order is auth for repost or quote repost, source id validation, public
  published source lookup, deleted/hidden/private/moderation-review rejection,
  block relationship check in either direction, quote body validation, then the
  relation-specific projection. Missing, deleted, hidden, private, or
  moderation-review sources fail closed as safe not-found; active blocks fail
  closed with `USER_FOLLOW_BLOCKED`; later unavailable originals render as a
  tombstone without exposing the original body. The contract adds no real post,
  repost, share, notification, wallet, Lumina, settlement, payout, order, or
  paid-like mutation.
- #971 exports `LUMINA_FEED_QUOTE_REPOST_CONTENT_READ_MODEL_CONTRACT` for the
  X-style quote repost card read model. The quote text stays in
  `post.repost.quoteBody`, while the original card stays in
  `post.repost.originalPost`; quote text never overwrites
  `post.repost.originalPost.body`. If the original is missing, deleted, hidden,
  private, moderation-review only, viewer-hidden, or blocked by relationship,
  reads return a safe tombstone with `originalPost: null`,
  `originalState: "unavailable"`, and no original/private body or internal
  metadata. This is projection/API contract only and adds no repost create,
  quote repost create, notification, unread count, share, wallet, Lumina,
  settlement, payout, order, or paid-like mutation.
- #1080 exports `LUMINA_FEED_REPOST_SHARE_DISPLAY_PROJECTION_CONTRACT` for feed
  card display. Repost/quote repost display uses `post.repost.originalPostId`
  for the original reference, keeps the viewer's quote in
  `post.repost.quoteBody`, counts only `repost` and `quote_repost` rows in
  `repostCount`, and renders missing/deleted/hidden/private/viewer-hidden/
  blocked originals as tombstones without original body or private author
  fields. Share remains `share_contract` URL/Web Share projection only with
  `shareCount=null` and `countStrategy="not_mutated_by_share_contract"`.
- #1136 exports `LUMINA_FEED_REPOST_TOMBSTONE_READ_PROJECTION_CONTRACT` for
  list, detail, user-profile post, and repost-tab reads after an original post
  becomes missing, deleted, hidden, private, viewer-hidden, or blocked by
  relationship. Repost and quote repost rows may remain visible with
  `post.repost.tombstone` and `originalPost=null`; quote text may remain
  visible, but the original body, original assets, and private author fields are
  not returned. Tombstone reads do not mutate repost count, share count,
  notification count, wallet, Lumina, settlement, or payout state.
- #1100 exports `LUMINA_FEED_REPOST_QUOTE_PROJECTION_CONTRACT` as the canonical
  quote projection contract. Quote repost creates a viewer-owned feed context
  with `post.repost.quoteBody` kept separate from
  `post.repost.originalPost.body`; simple repost keeps `quoteBody=null`.
  Missing, deleted, hidden, private, reported, moderation-review,
  viewer-hidden, or blocked original posts render as an unavailable tombstone
  and must not expose the original body. Share stays a separate
  `share_contract` read projection and never creates a repost row, feed row,
  notification, count mutation, wallet/Lumina, settlement, payout, order, or
  paid-like mutation.
- #1168 tightens the backend projection buckets for thread continuation,
  simple repost, quote repost, and share. Thread continuation reads from
  `metadata.threadContinuation.rootPostId` and renders only in the continuation
  list, while repost and quote repost read from
  `metadata.repost.originalPostId` under `post.repost`. Quote body remains
  separate from the embedded original body, share remains a no-feed-row URL/Web
  Share projection, and tombstoned originals can return safe 404 or
  `originalPost=null` without exposing the original body/assets/private author
  fields. This adds no post, repost, share, notification, wallet, Lumina,
  settlement, payout, order, or paid-like mutation.
- `DELETE /api/v1/lumina-feed/posts/:postId` soft-deletes the current user's own root post. Deleting the root hides the full thread from feed lists.
- `DELETE /api/v1/lumina-feed/replies/:replyId` soft-deletes the current user's own reply. Artist operators can delete replies on operated artist posts.
- Hidden posts use soft delete/reactivation with unique `(user_id, post_id)`.
- `POST /api/v1/users/:userId/block` and `POST /api/v1/users/handle/:publicHandle/block` accept optional `{ "reason": "..." }`, reject self-block, soft-delete active follows in both directions, and return `{ block, effects, policy }`.
- `DELETE /api/v1/me/followers/:userId` is the remove-follower-without-block contract. It requires login, treats the current user as the profile owner, soft-deletes an active `user_follows` row where `follower_user_id = :userId` and `following_user_id = currentUser.id`, and returns `{ ok, removed, user, stats, viewer, policy }`. It does not create a `user_blocks` row and does not prevent the removed user from following again.
- Remove-follower response shape:

```json
{
  "ok": true,
  "removed": true,
  "user": {
    "id": "removed-follower-user-uuid",
    "displayName": "public display name",
    "publicHandle": "public-handle",
    "avatarUrl": "public asset url or null"
  },
  "stats": {
    "followerCount": 12,
    "followingCount": 3
  },
  "viewer": {
    "isAuthenticated": true,
    "isSelf": false,
    "isFollowing": false,
    "canFollow": true,
    "canUnfollow": false
  },
  "policy": {
    "blockCreated": false,
    "refollowAllowed": true,
    "walletMutation": false,
    "luminaMutation": false,
    "paymentMutation": false,
    "refundMutation": false,
    "payoutMutation": false,
    "revenueSharingMutation": false,
    "settlementMutation": false
  }
}
```

- User-block response shape:

```json
{
  "block": {
    "id": "block-row-uuid",
    "status": "active",
    "reason": "optional trimmed reason or null",
    "blockedAt": "2026-05-27T00:00:00.000Z",
    "updatedAt": "2026-05-27T00:00:00.000Z",
    "user": {
      "id": "blocked-user-uuid",
      "displayName": "public display name",
      "publicHandle": "public-handle",
      "avatarUrl": "public asset url or null"
    }
  },
  "effects": {
    "viewerToTargetFollowRemoved": true,
    "targetToViewerFollowRemoved": true,
    "refollowBlocked": true,
    "feedHiddenForViewer": true,
    "commentsHiddenForViewer": true,
    "premiumChatBlockedBeforeWallet": true,
    "supportBlockedBeforeWallet": true
  },
  "policy": {
    "relationship": "user_block",
    "scope": "viewer_target_pair",
    "walletMutation": false,
    "luminaMutation": false,
    "paymentMutation": false,
    "refundMutation": false,
    "payoutMutation": false,
    "revenueSharingMutation": false,
    "settlementMutation": false
  }
}
```

- Block expectations:
  - Active follows in both directions are soft-deleted in the same server operation that activates the block.
  - A user blocked by the profile owner cannot refollow that owner while the block is active. Follow attempts in either blocked direction fail before creating/reactivating `user_follows`.
  - Authenticated feed, user profile post lists, repost embeds, and comments/replies hide rows authored by users in an active block relationship with the viewer. Anonymous public reads cannot apply relationship filtering because there is no viewer identity.
  - Premium chat, fan support, donation, gift, paid unlock, and any cash-like interaction between blocked users must fail closed before wallet, Lumina, payment, refund, payout, settlement, or revenue-sharing lookup/mutation.
  - Unblock only soft-deletes the `user_blocks` row. It does not restore removed follow rows; either user must follow again explicitly after unblock.
- `user_blocks` uses soft delete/reactivation with unique `(blocker_user_id, blocked_user_id)`.
- Follow/block error states use stable codes and message keys:

| Status | Code | Message key | Applies to |
| --- | --- | --- | --- |
| 400 | `INVALID_USER_ID` | `social.user.invalidId` | Invalid UUID user id. |
| 400 | `INVALID_CURSOR` | `social.followList.invalidCursor` | Invalid follow-list cursor. |
| 400 | `INVALID_PUBLIC_HANDLE` | `social.profile.invalidHandle` | Invalid handle syntax. |
| 401 | `AUTH_REQUIRED` | `auth.required` | Mutations without login. |
| 403 | `USER_PROFILE_BLOCKED` | `social.profile.blocked` | Active block relationship prevents viewing the profile or follow list. |
| 403 | `USER_FOLLOW_BLOCKED` | `social.follow.blocked` | Follow/refollow blocked by an active user block. |
| 403 | `USER_GIFT_BLOCKED` | `social.gift.blocked` | User gift transfer blocked before wallet lookup by an active user block. |
| 404 | `USER_NOT_FOUND` | `social.user.notFound` | Target is missing, deleted, suspended, or inactive. |
| 409 | `SELF_FOLLOW_NOT_ALLOWED` | `social.follow.selfNotAllowed` | User tries to follow self. |
| 409 | `SELF_BLOCK_NOT_ALLOWED` | `social.block.selfNotAllowed` | User tries to block self. |

Generic moderation report endpoints:

```http
POST /api/v1/moderation/reports
GET /admin/api/v1/moderation/reports?targetType=user&status=submitted&reason=spam&query=&take=50&cursor=<nextCursor>
GET /admin/api/v1/moderation/reports/:reportId
PATCH /admin/api/v1/moderation/reports/:reportId
```

- `POST /api/v1/moderation/reports` requires login and stores a `moderation_reports` row.
- It supports `targetType`: `feed_post`, `community_post`, `reply`, `community_reply`, `user`, `artist`.
- It validates that the target row exists before accepting a report.
- It supports `reason`: `sexual_content`, `harassment`, `hate`, `impersonation`, `spam`, `external_contact`, `external_payment`, `rights_violation`, `other`.
- `detail` is optional and limited to 500 characters.
- Feed-post reports increment `community_posts.report_count`.
- Admin list/detail require `community:read`; admin update requires `community:write`.
- Admin update accepts `status`, `detail`, and `metadata`. Allowed statuses are `submitted`, `reviewing`, `resolved`, `dismissed`, and `archived`.

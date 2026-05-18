# Builder A Inbox

Use the standard completion note from `docs/ops/agents.md`.

status: completed
task: #238 email verification and password reset API first implementation
branch/commit: team2-backend/auth-email-reset-238 / this commit
changed_files:
- server/src/auth/auth.service.ts
- server/src/auth/auth.service.spec.ts
- server/README.md
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/builder-a.md
tests:
- PASS: npm.cmd test -- auth.service.spec.ts --runInBand
- PASS: npm.cmd run lint
- PASS: npm.cmd run build
- PASS: git diff --check
migration:
- none in this branch; latest main already has `users.email_verified_at` and `user_action_tokens`.
result:
- Confirmed email verification/password reset API skeleton exists: `POST /api/v1/auth/email-verifications`, `POST /api/v1/auth/email-verifications/confirm`, `POST /api/v1/auth/password-resets`, and `POST /api/v1/auth/password-resets/confirm`.
- Kept one-time tokens hashed in DB only through `user_action_tokens.tokenHash`; raw token values are never stored.
- Added `success: true` as a success-response alias while preserving existing `ok: true` response shape.
- Hardened request endpoints so provider delivery failures remain neutral and do not reveal whether the submitted email belongs to an active account.
- Confirm endpoints still use stable error codes/message keys for invalid/expired/reused tokens, inactive users, and missing email-password accounts.
- Password reset keeps the 8+ character letter+number policy, updates only the email auth password hash, and revokes active refresh-token sessions.
- Local/staging debug token exposure remains gated by `ACTION_TOKEN_DEBUG_ENABLED=true` and `NODE_ENV != production`; production omits raw action tokens.
- No frontend runtime files, social login flow, normal login, refresh-token rotation, production seed/data, provider secret, token value, cookie, password value, or env value was recorded.
blocked_by:
- Real email delivery requires provider env configuration outside Git/Notion/chat.
next_needed:
- 뷰어 review, then 큐알 QA for neutral request responses, local/staging debug confirm path, reset confirm session revoke, and no account-existence leak on delivery failure.
민감값 기록 여부: 없음

---

status: completed
task: #229 follow-up direct PUT AccessDenied fix
branch/commit: team2-backend/debut-private-upload-storage-229 / this commit
changed_files:
- server/src/debut/debut.service.ts
- server/src/debut/debut.service.spec.ts
- docs/backend-api-spec.md
- docs/ops/inbox/builder-a.md
tests:
- PASS: npm.cmd test -- debut.service.spec.ts --runInBand
- PASS: npm.cmd run lint
- PASS: npm.cmd run build
- PASS: git diff --check
result:
- QA live smoke showed private material upload-intent/auth/unconfirmed rejection/gender policy checks passing, but direct PUT failed with provider 403 AccessDenied before confirm-upload.
- Compared debut material presigned PUT with the existing user asset presigned PUT. Signing logic is equivalent; the material flow used a new object prefix that was not covered by live direct-upload authorization.
- Updated private debut material storage keys to use the existing direct-upload-authorized object prefix while preserving `visibility: private`, `debut_application_material` scope, private API endpoints, and no public/signed read URL exposure.
- This does not switch to the public `/me/assets` API or public asset delivery flow; application linking still requires confirmed private scoped assets.
- No frontend files, production seed/data, wallet/Lumina/settlement/payout/paid-like flow, public original URL exposure, signed URL value, direct upload target value, token, secret, DB credential, object key full value, or asset id full value was recorded.
blocked_by:
- Needs deploy and QA repeat of direct PUT, confirm-upload, confirmed attachment application submit, attachment relation, and estimated/final share separation.
next_needed:
- 조로 review/deploy, then 큐알 live smoke reQA.
민감값 기록 여부: 없음

---

status: completed
task: #229 debut application private material upload API implementation
branch/commit: team2-backend/debut-private-material-upload-229 / this commit
changed_files:
- server/prisma/schema.prisma
- server/prisma/migrations/0039_debut_application_attachments/migration.sql
- server/src/debut/debut.controller.ts
- server/src/debut/debut.service.ts
- server/src/debut/debut.service.spec.ts
- server/src/debut/dto/debut.dto.ts
- docs/ai-debut-policy-and-application-spec.md
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/builder-a.md
tests:
- PASS: npx.cmd prisma generate
- PASS: npm.cmd test -- debut.service.spec.ts --runInBand
- PASS: npm.cmd run lint
- PASS: npm.cmd run build
- PASS: git diff --check
result:
- Added `debut_application_attachments` relation to link confirmed private applicant material assets to debut applications with `applicationId`, `assetId`, `category`, `sortOrder`, `status`, metadata, and timestamps.
- Added authenticated private material APIs: `POST /api/v1/debut/application-materials/upload-intents` and `POST /api/v1/debut/application-materials/:assetId/confirm-upload`.
- Upload intents create private `debut_application_material` assets for `face_photo`, `body_motion_reference`, `voice_sample`, `dance_video_reference`, and `portfolio_attachment`; responses do not expose public or signed read URLs.
- Confirm upload verifies owner, scope, visibility, category, MIME family, size policy, object existence, and object-store HEAD content length/type before marking the asset uploaded.
- `POST /api/v1/debut/applications` now links only confirmed private materials through asset id arrays: `facePhotoAssetIds`, `bodyMotionReferenceAssetIds`, `voiceSampleAssetIds`, `danceVideoReferenceAssetIds`, and `portfolioAttachmentAssetIds`.
- Unconfirmed, duplicate, wrong-owner/scope/category, public, archived, or invalid-MIME assets are rejected before application creation.
- `genderSwapRequested: true` is rejected; absent/false remains the only allowed path.
- `shareTierRequested` remains estimated/applicant-requested and `shareTierApproved` remains later admin-final; no automatic final share rate is created.
- No frontend files, production seed/data, wallet/Lumina/settlement/payout/paid-like flow, public original URL exposure, signed URL value, direct upload target value, token, secret, or DB credential was changed or recorded.
blocked_by:
- Deploy migration before opening the private material upload UI beyond QA/staging.
next_needed:
- 조로/차모 review, then deploy migration/API and QA upload-intent -> private object upload -> confirm-upload -> application submit flow with QA-only materials.
민감값 기록 여부: 없음

---

status: completed
task: #228 debut application photo/material upload and application-data API contract check
branch/commit: team2-backend/debut-application-upload-contract-228 / this commit
changed_files:
- docs/ai-debut-policy-and-application-spec.md
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/builder-a.md
tests:
- PASS: git diff --check
- not run: npm.cmd run lint (docs-only contract check)
- not run: npm.cmd run build (docs-only contract check)
result:
- Current `POST /api/v1/debut/applications` is safe for the existing text/contact `phone_consultation` path, but it is not ready for photo/audio/video applicant materials.
- Existing user asset upload intent cannot be reused as-is because it is image-only, public-visibility oriented, returns public delivery URLs, and confirms through the feed-image derivative path.
- Admin asset upload can create private image/video assets, but it is admin-only and not an applicant material upload path.
- Additional backend API is required before frontend opens `online_review` material upload: private applicant-material upload intent/confirm with no public URL, signed URL, token, or direct upload target recorded in docs/logs.
- Recommended DB direction: add `debut_application_attachments` relation (`applicationId`, `assetId`, `category`, `sortOrder`, `status`, metadata) when uploads open; metadata arrays are only acceptable for a narrow internal prototype.
- Existing application data covers `applicationType`, contact fields, participation type, requested/admin share, basic consents, and non-sensitive metadata. Missing canonical fields are `artistDebutMode`, contribution booleans, gender policy flags, categorized asset id arrays, and `portfolioUrls[]`.
- `genderSwapRequested` must be absent or `false`; do not expose a supported gender-swap production capability.
- Revenue share remains non-final: `shareTierRequested` maps to estimate/request, and `shareTierApproved` maps to later admin final value after review/contract. No automatic final share confirmation.
- No frontend files, server runtime code, Prisma migration, production seed/data, wallet/Lumina/settlement/payout flow, secrets, tokens, signed URLs, or DB credentials were changed or recorded.
blocked_by:
- Material upload cannot open until a private applicant-material upload API and validation/linking contract is implemented.
next_needed:
- 조로/차모 review of contract direction, then create a separate implementation task for private debut material upload if `online_review` should open.
민감값 기록 여부: 없음

---

status: completed
task: #223 email verification/password reset API first implementation; #224 identity/minor clean-mode account flags
branch/commit: team2-backend/auth-identity-flags-223-224 / this commit
changed_files:
- server/prisma/schema.prisma
- server/prisma/migrations/0038_user_email_verified_at/migration.sql
- server/src/auth/auth.service.ts
- server/src/auth/auth.service.spec.ts
- server/README.md
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/trust-identity-abuse-policy.md
- docs/ops/inbox/builder-a.md
tests:
- PASS: npx.cmd prisma generate
- PASS: npm.cmd test -- auth.service.spec.ts --runInBand
- PASS: npm.cmd run lint
- PASS: npm.cmd run build
- PASS: git diff --check
- INFO: npm.cmd test -- --runInBand also run; existing fan-engagement spec has a date-window failure unrelated to #223/#224.
result:
- Email verification confirm now persists `users.email_verified_at`; `GET /api/v1/me` returns `emailVerified` and `emailVerifiedAt`.
- Email verification/password reset request endpoints keep existence-neutral responses; action tokens remain SHA-256 hashed, expiring, and single-use.
- Password reset confirm keeps the existing password policy, updates only the email auth password hash, and revokes active refresh-token sessions.
- Identity/account trust responses now expose stable account flags for signup-not-blocked-before-verification, derived age gate, and clean-mode state.
- Minor clean mode is derived only from a verified provider birth date; NICE raw name/phone/resident-number/provider-token storage remains forbidden.
- No frontend files, wallet/Lumina/settlement/payout/paid-like flow, production seed, or secrets/env values were changed or recorded.
blocked_by:
- none for #223/#224 implementation.
next_needed:
- Reviewer/Integrator can review API shape and deploy migration before frontend binds to `emailVerifiedAt` or `accountState`.
민감값 기록 여부: 없음

---

status: done
task: BA-001 - Backstage / Creator Studio Backend Contract Check
branch/commit: builder-a-backend/ba-001-contract-check / df6995b84147
changed_files:
- docs/ops/inbox/builder-a.md
tests:
- npm.cmd run lint
- npm.cmd run build
result:
- Confirmed `GET /admin/api/v1/backstage/operations/object-storage/diagnostics` exists and returns booleans/config status only; no raw object storage secrets are returned.
- Confirmed `GET /admin/api/v1/backstage/settlement-conversions` and `POST /admin/api/v1/backstage/settlement-conversions/:conversionId/status` exist, include pagination/summary/policy, validate status/type/period, write audit events, and credit Lumina only on `credited`.
- Confirmed `GET /api/v1/me/creator-studio/settlement-conversions` and `POST /api/v1/me/creator-studio/settlement-conversions` exist behind JWT auth, enforce active Creator Studio/artist operator access, return policy, support idempotency, and provide safe structured details when requested amount exceeds preview balance.
- Confirmed `GET /api/v1/me/creator-studio` remains stable and advertises Creator Studio policy/endpoints.
- No backend API gap found for today's Backstage / Creator Studio frontend connection work; no `server/` or `server/prisma/` changes made.
blocked_by: none
next_needed:
- Builder B can wire the current endpoints.
- Reviewer can verify frontend usage against the confirmed response shapes.

---

status: done
task: BA-002 - 1st Fan Engagement Loop Backend Contract
branch/commit: builder-a-backend/ba-002-fan-engagement-contract / 1bec1c4224b2
changed_files:
- docs/ops/inbox/builder-a.md
tests:
- npm.cmd run lint
- npm.cmd run build
result:

## BA-002 Backend Contract Proposal

### Scope

Design only for the 1st fan engagement loop:

- one-tap missions
- concept votes
- fan one-line proposals
- AI feed/comment draft reactions
- Creator Studio today tasks
- achievements / points / titles

Explicitly out of scope:

- dance/video uploads
- cash-like wallet rewards, settlement, revenue sharing, trading, payout
- automatic public AI posting

### Existing Table Reuse

Reusable as references:

- `Artist`, `ArtistOperator`: artist identity and Creator Studio access.
- `ArtistFollow`: signal for fan affinity and mission eligibility.
- `CommunityPost`, `CommunityReply`, `CommunityReaction`: final public feed/comment targets after approval. Do not store unmoderated fan proposals or AI drafts here first.
- `ModerationReport`, `CommunityReport`: reusable reporting surface after something becomes public; not enough for pre-public moderation queues.
- `UserNotification`: notify creators/fans when proposal/draft/mission status changes.
- `UserEntitlement`: can represent active title/effect ownership, but should not be the only achievement ledger.
- `WalletAccount`, `WalletLedger`, `RewardsService`: existing Lumina reward system. For BA-002, do not reuse for rewards except read-only awareness. New points must be non-cash and separate.
- `AuditEvent`: admin/creator approval and mission config changes should write audit events.

New models are needed because the existing schema has no safe place for one-tap mission definitions, concept vote options, one-line proposal moderation, AI draft approval state, non-cash fan points, or achievement progress.

### Proposed Tables / Models

`FanMission`

- `id`
- `slug` unique
- `artistId` nullable, null means global mission
- `missionType`: `daily_checkin`, `follow_artist`, `vote_concept`, `submit_proposal`, `react_feed`, `share_prompt`
- `title`, `description`, `ctaLabel`
- `status`: `draft`, `scheduled`, `active`, `paused`, `ended`, `archived`
- `startsAt`, `endsAt`
- `resetRule`: `once`, `daily`, `weekly`, `season`
- `rewardPolicy` json: `{ points, achievementCode, titleCode, exposureBoost }`
- `eligibilityPolicy` json: age/content rating, locale, required artist follow, max participations
- `metadata`
- `createdByUserId`, `updatedByUserId`, `createdAt`, `updatedAt`

`FanMissionParticipation`

- `id`
- `missionId`, `userId`, `artistId` nullable
- `participationType`: copied from mission for analytics
- `status`: `submitted`, `accepted`, `rejected`, `cancelled`
- `moderationStatus`: `not_required`, `pending`, `approved`, `rejected`, `blocked`
- `idempotencyKey` unique nullable
- `sourceType`, `sourceId` nullable: proposal/vote/reaction/etc.
- `rewardGrantId` nullable
- `metadata`
- `createdAt`, `updatedAt`
- unique index for `missionId + userId + serviceDate` when reset is daily; `missionId + userId` for once missions.

`ConceptVote`

- `id`
- `artistId`
- `missionId` nullable
- `title`, `summary`
- `status`: `draft`, `active`, `closed`, `archived`
- `visibility`: `public`, `followers`, `creator_studio_only`
- `moderationRating`: `general`, `teen`, `restricted_placeholder`
- `startsAt`, `endsAt`
- `metadata`

`ConceptVoteOption`

- `id`, `voteId`
- `label`, `description`, `sortOrder`
- `status`: `active`, `hidden`, `archived`
- `metadata`

`ConceptVoteBallot`

- `id`, `voteId`, `optionId`, `userId`
- `weight`: default `1`; no paid weighting in this loop
- `sourceMissionParticipationId` nullable
- `createdAt`
- unique `voteId + userId`

`FanProposal`

- `id`
- `artistId`, `authorUserId`
- `missionId` nullable
- `proposalType`: `concept`, `outfit`, `catchphrase`, `feed_prompt`, `reply_prompt`, `event_idea`
- `body`: one-line text, max 140 chars for v1
- `locale`
- `status`: `submitted`, `under_review`, `shortlisted`, `selected`, `rejected`, `archived`
- `moderationStatus`: `pending`, `approved`, `rejected`, `blocked`
- `visibility`: `private_until_approved`, `creator_only`, `public_after_selected`
- `creatorNote`, `adminNote`, `rejectionReason`
- `selectedByUserId`, `selectedAt`
- `metadata`
- `createdAt`, `updatedAt`

`ArtistReactionDraft`

- `id`
- `artistId`
- `sourceType`: `fan_proposal`, `concept_vote`, `community_post`, `community_reply`, `fan_mission`
- `sourceId`
- `draftType`: `feed_post`, `comment_reply`, `creator_note`
- `promptVersion`
- `draftBody`
- `status`: `drafted`, `needs_creator_review`, `approved`, `rejected`, `published`, `expired`
- `moderationStatus`: `pending`, `approved`, `rejected`, `blocked`
- `reviewedByUserId`, `reviewedAt`
- `publishedPostId`, `publishedReplyId`
- `expiresAt`
- `metadata`: model name, safety scores, regeneration count, source snippets without secrets
- `createdAt`, `updatedAt`

Important: AI drafts never become public until both `status=approved` and `moderationStatus=approved`; publish creates/updates `CommunityPost` or `CommunityReply`.

`FanPointLedger`

- `id`
- `userId`, `artistId` nullable
- `direction`: `earn`, `spend`, `expire`, `adjust`
- `points`: integer
- `ledgerType`: `mission_reward`, `vote_reward`, `proposal_selected`, `achievement_bonus`, `admin_adjustment`
- `referenceType`, `referenceId`
- `idempotencyKey` unique
- `expiresAt` nullable
- `metadata`
- `createdAt`

This must be separate from `WalletLedger`. It has no KRW/Lumina equivalent and cannot be withdrawn, settled, transferred, or refunded.

`FanAchievement`

- `id`
- `code` unique
- `title`, `description`, `badgeIconKey`
- `category`: `mission`, `vote`, `proposal`, `creator_support`, `streak`
- `status`: `active`, `paused`, `archived`
- `criteria` json
- `rewardPolicy` json: optional points/title/exposure priority
- `metadata`

`UserAchievement`

- `id`
- `userId`, `achievementId`
- `status`: `in_progress`, `earned`, `revoked`
- `progressCurrent`, `progressTarget`
- `earnedAt`, `revokedAt`
- `sourceType`, `sourceId`
- `metadata`
- unique `userId + achievementId`

`FanTitle`

- `id`
- `code` unique
- `displayName`
- `description`
- `status`: `active`, `paused`, `archived`
- `rarity`: `common`, `rare`, `seasonal`, `creator_pick`
- `artistId` nullable
- `metadata`

`UserFanTitle`

- `id`
- `userId`, `titleId`
- `status`: `active`, `revoked`, `expired`
- `sourceType`, `sourceId`
- `startsAt`, `expiresAt`, `equippedAt`
- unique `userId + titleId`

Optional later: title ownership could mirror into `UserEntitlement(entitlementType='fan_title')`, but v1 still needs `UserFanTitle` for display/equip state.

### Public/User API Contract

`GET /api/v1/fan-engagement/missions?artistId=&scope=today&take=20`

Response:

```json
{
  "generatedAt": "2026-05-07T00:00:00.000Z",
  "items": [
    {
      "id": "uuid",
      "slug": "daily-concept-vote",
      "missionType": "vote_concept",
      "artist": {"id": "uuid", "slug": "artist-slug", "displayName": "Artist"},
      "title": "Pick today's concept",
      "description": "One tap vote for tomorrow's feed concept.",
      "ctaLabel": "Vote",
      "status": "active",
      "startsAt": "2026-05-07T00:00:00.000Z",
      "endsAt": "2026-05-08T00:00:00.000Z",
      "participation": {
        "status": "not_started",
        "participatedAt": null,
        "remainingCount": 1
      },
      "rewardPreview": {
        "points": 5,
        "achievementCodes": ["first_vote"],
        "titleCodes": [],
        "cashLike": false
      },
      "action": {
        "type": "concept_vote",
        "endpoint": "/api/v1/fan-engagement/concept-votes/uuid/ballots"
      }
    }
  ],
  "summary": {"availableCount": 3, "completedTodayCount": 1},
  "policy": {
    "serviceTimezone": "Asia/Seoul",
    "rewardsAreCashLike": false,
    "excludedFeatures": ["video_upload", "revenue_sharing"]
  }
}
```

`POST /api/v1/fan-engagement/missions/:missionId/participations`

Body:

```json
{
  "idempotencyKey": "client-generated-key",
  "action": "complete",
  "sourceType": "concept_vote",
  "sourceId": "uuid"
}
```

Response:

```json
{
  "participation": {
    "id": "uuid",
    "missionId": "uuid",
    "status": "accepted",
    "moderationStatus": "not_required",
    "createdAt": "2026-05-07T00:00:00.000Z"
  },
  "rewards": {
    "pointsGranted": 5,
    "achievementsGranted": [],
    "titlesGranted": [],
    "cashLike": false
  },
  "idempotentReplay": false
}
```

`GET /api/v1/fan-engagement/concept-votes?artistId=&status=active`

Return active votes with options and viewer ballot.

`POST /api/v1/fan-engagement/concept-votes/:voteId/ballots`

Body: `{ "optionId": "uuid", "idempotencyKey": "..." }`

Response includes vote totals only if PM wants visible social proof:

```json
{
  "ballot": {"id": "uuid", "voteId": "uuid", "optionId": "uuid"},
  "viewer": {"hasVoted": true, "selectedOptionId": "uuid"},
  "resultsPreview": {
    "totalBallots": 120,
    "options": [{"id": "uuid", "ballotCount": 55, "ratio": 45.8}]
  },
  "missionParticipation": {"id": "uuid", "status": "accepted"},
  "rewards": {"pointsGranted": 5, "cashLike": false}
}
```

`POST /api/v1/artists/:artistId/fan-proposals`

Body:

```json
{
  "proposalType": "feed_prompt",
  "body": "Try a rainy-day cafe concept",
  "missionId": "uuid",
  "idempotencyKey": "client-key"
}
```

Response:

```json
{
  "proposal": {
    "id": "uuid",
    "artistId": "uuid",
    "proposalType": "feed_prompt",
    "body": "Try a rainy-day cafe concept",
    "status": "submitted",
    "moderationStatus": "pending",
    "visibility": "private_until_approved",
    "createdAt": "2026-05-07T00:00:00.000Z"
  },
  "missionParticipation": {
    "id": "uuid",
    "status": "submitted",
    "moderationStatus": "pending"
  },
  "rewards": {
    "pointsPending": 5,
    "grantTiming": "after_moderation_approved",
    "cashLike": false
  }
}
```

`GET /api/v1/me/achievements`

Response:

```json
{
  "points": {
    "balance": 320,
    "lifetimeEarned": 540,
    "cashLike": false,
    "transferable": false,
    "settlementEligible": false
  },
  "achievements": [
    {
      "code": "first_vote",
      "title": "First Signal",
      "status": "earned",
      "progress": {"current": 1, "target": 1},
      "earnedAt": "2026-05-07T00:00:00.000Z"
    }
  ],
  "titles": {
    "equipped": {"code": "concept_scout", "displayName": "Concept Scout"},
    "items": [
      {"code": "concept_scout", "displayName": "Concept Scout", "status": "active"}
    ]
  },
  "recentLedger": [
    {
      "id": "uuid",
      "points": 5,
      "ledgerType": "mission_reward",
      "referenceType": "fan_mission_participation",
      "createdAt": "2026-05-07T00:00:00.000Z"
    }
  ]
}
```

### Creator Studio API Contract

`GET /api/v1/me/creator-studio/today-tasks?artistId=&take=20`

Gather pending items per accessible artist:

- `fan_proposals`: submitted/under_review proposals with `moderationStatus=approved` or creator-reviewable pending state.
- `reaction_drafts`: AI drafts with `status=needs_creator_review` and safe moderation state.
- `concept_votes`: active votes needing creator attention, plus recently closed votes needing selection/reaction.
- `mission_signals`: mission participation spikes, top options, top proposals.
- `content_queue`: selected fan proposal waiting for AI draft generation or manual creator response.
- `profile_followups`: optional low priority, e.g. no Creator Studio profile cover; not part of fan loop core.

Response:

```json
{
  "generatedAt": "2026-05-07T00:00:00.000Z",
  "summary": {
    "totalOpen": 12,
    "needsReview": 5,
    "canApproveNow": 3,
    "blockedByModeration": 2
  },
  "artists": [
    {
      "artist": {"id": "uuid", "slug": "artist-slug", "displayName": "Artist"},
      "counts": {
        "fanProposals": 4,
        "reactionDrafts": 2,
        "conceptVotesClosingSoon": 1,
        "missionSignals": 3
      },
      "tasks": [
        {
          "id": "fan_proposal:uuid",
          "type": "fan_proposal_review",
          "priority": "high",
          "title": "Review one-line fan idea",
          "bodyPreview": "Try a rainy-day cafe concept",
          "status": "submitted",
          "moderationStatus": "approved",
          "source": {
            "type": "fan_proposal",
            "id": "uuid",
            "author": {"id": "uuid", "displayName": "Fan"}
          },
          "actions": [
            {"key": "shortlist", "method": "POST", "endpoint": "/api/v1/me/creator-studio/fan-proposals/uuid/shortlist"},
            {"key": "request_ai_draft", "method": "POST", "endpoint": "/api/v1/me/creator-studio/reaction-drafts"}
          ]
        }
      ]
    }
  ],
  "policy": {
    "aiDraftsAutoPublish": false,
    "textPublicExposureRequiresModeration": true,
    "rewardsAreCashLike": false
  }
}
```

`POST /api/v1/me/creator-studio/reaction-drafts/:draftId/approve`

Body:

```json
{
  "editedBody": "Optional creator-edited final text",
  "publishTarget": "feed_post",
  "idempotencyKey": "client-key"
}
```

Response:

```json
{
  "draft": {
    "id": "uuid",
    "status": "published",
    "moderationStatus": "approved",
    "publishedPostId": "uuid",
    "publishedReplyId": null,
    "reviewedAt": "2026-05-07T00:00:00.000Z"
  },
  "published": {
    "type": "community_post",
    "id": "uuid",
    "url": "/lumina-feed/posts/uuid"
  }
}
```

`POST /api/v1/me/creator-studio/reaction-drafts/:draftId/reject`

Body: `{ "reason": "off_tone", "note": "Too formal" }`

Response: `{ "draft": {"id": "uuid", "status": "rejected", "reviewedAt": "..." } }`

Recommended extra creator endpoints:

- `GET /api/v1/me/creator-studio/fan-proposals?artistId=&status=&moderationStatus=`
- `POST /api/v1/me/creator-studio/fan-proposals/:proposalId/shortlist`
- `POST /api/v1/me/creator-studio/fan-proposals/:proposalId/reject`
- `POST /api/v1/me/creator-studio/reaction-drafts` to generate/request a draft from an approved source. This can be stubbed as `manual_pending` before AI provider wiring.

### Admin / Backstage API Contract

`GET /admin/api/v1/backstage/fan-engagement/overview?period=YYYY-MM&artistId=`

Response:

```json
{
  "generatedAt": "2026-05-07T00:00:00.000Z",
  "summary": {
    "activeMissions": 4,
    "participationsToday": 1200,
    "pendingModeration": 42,
    "aiDraftsAwaitingApproval": 17,
    "pointsGrantedToday": 5300
  },
  "queues": {
    "fanProposalsPendingModeration": {"count": 30},
    "reactionDraftsBlocked": {"count": 4},
    "missionsEndingSoon": {"count": 2}
  },
  "topSignals": {
    "missions": [],
    "conceptVotes": [],
    "fanProposals": []
  },
  "policy": {
    "cashLikeRewards": false,
    "aiAutoPublish": false,
    "requiresModerationBeforePublicExposure": true
  }
}
```

`POST /admin/api/v1/backstage/fan-engagement/missions`

Create mission. Require `creators:write` or `community:write`; for global/high impact use `*`.

`PATCH /admin/api/v1/backstage/fan-engagement/missions/:missionId`

Update status/timing/reward preview. Write `AuditEvent`.

Recommended extra admin endpoints:

- `GET /admin/api/v1/backstage/fan-engagement/proposals?status=&moderationStatus=`
- `PATCH /admin/api/v1/backstage/fan-engagement/proposals/:proposalId/moderation`
- `GET /admin/api/v1/backstage/fan-engagement/reaction-drafts?status=&moderationStatus=`
- `PATCH /admin/api/v1/backstage/fan-engagement/reaction-drafts/:draftId/moderation`
- `GET /admin/api/v1/backstage/fan-engagement/point-ledger?userId=&artistId=`

### Moderation / Status Flow

One-tap mission without text:

1. `FanMissionParticipation.status=submitted`
2. `moderationStatus=not_required`
3. accept immediately if mission is active and idempotency passes
4. grant non-cash points/achievement/title

Concept vote:

1. vote options are admin/creator-created and already approved
2. ballot is accepted immediately
3. no public free text involved
4. vote results can be public or delayed according to `ConceptVote.visibility`

Fan one-line proposal:

1. create `FanProposal.status=submitted`, `moderationStatus=pending`
2. no public exposure and no creator public action until moderation passes
3. if rejected/blocked, mark `status=rejected`, record reason, no public reward except optional participation attempt point if PM wants
4. if approved, creator can shortlist/select/reject
5. selected proposal can trigger achievement/title/visibility priority

AI reaction draft:

1. source must be moderation-approved or internal safe source
2. create `ArtistReactionDraft.status=needs_creator_review`, `moderationStatus=pending`
3. moderation must approve draft text
4. creator approves/rejects; creator edit can re-open moderation if materially changed
5. only publish when `status=approved` and `moderationStatus=approved`
6. publish creates `CommunityPost(postType=artist_reaction)` or `CommunityReply`; draft status becomes `published`

### Points / Achievements / Titles Structure

- Points are `FanPointLedger`, not `WalletLedger`.
- Points have no KRW/Lumina conversion, no refund, no transfer, no settlement.
- Use idempotency keys like `fan_mission:<missionId>:<userId>:<serviceDate>` and `achievement:<achievementCode>:<userId>`.
- A reward service can run in the same transaction after participation/moderation approval.
- `FanAchievement` defines criteria; `UserAchievement` tracks progress and earned state.
- `FanTitle` defines display titles; `UserFanTitle` grants/equips/revokes titles.
- Exposure priority should be policy metadata, e.g. proposal sorting boost or fan profile badge, not a financial asset.
- Admin adjustments to points/titles require audit events and should be restricted like community/admin operations, not wallet super-admin operations.

Suggested v1 reward rules:

- first one-tap mission: 5 points, achievement `first_signal`
- first concept vote: 5 points, achievement `first_vote`
- first approved proposal: 10 points, achievement `idea_scout`
- proposal selected by creator: 50 points, title `concept_scout`
- 7-day mission streak: achievement `steady_signal`, seasonal title
- creator-approved AI reaction sourced from proposal: title or profile badge, not money

### Builder B UI Data Needs

Builder B needs these stable fields:

- mission cards: `id`, `missionType`, `title`, `description`, `ctaLabel`, `artist`, `endsAt`, `participation.status`, `rewardPreview`, `action`.
- concept vote: `id`, `title`, `options[]`, `viewer.selectedOptionId`, `viewer.hasVoted`, optional `resultsPreview`.
- proposal form: `proposalType` enum, max length, placeholder, moderation notice, pending reward copy.
- achievements page: point balance, non-cash policy, achievements list, title inventory, equipped title.
- Creator Studio today tasks: grouped by artist, `type`, `priority`, `bodyPreview`, `moderationStatus`, `source`, `actions[]`.
- AI draft review: source summary, draft body, moderation state, approve/reject endpoints, edited body field, warning that approval publishes only after moderation.

### Migration Risk

Low-to-medium if shipped as additive tables only.

Main risks:

- Reward confusion with Lumina wallet. Mitigation: separate `FanPointLedger`, explicit `cashLike=false` in every response.
- Moderation bypass. Mitigation: proposals and AI drafts must not write directly to public community tables.
- Duplicate rewards from repeated taps. Mitigation: strict idempotency keys and unique constraints.
- Creator Studio query cost. Mitigation: index by `artistId,status,moderationStatus,updatedAt` and cap today-tasks result size.
- Future adult-brand compatibility. Mitigation: keep content rating/moderation fields generic; do not add adult-specific states now.
- Existing `CommunityPost.status` defaults to `published`; publishing from drafts must explicitly create only after final approval.

### Implementation Order

1. Add Prisma models and additive migration for missions, votes, proposals, reaction drafts, fan points, achievements, titles.
2. Add `FanEngagementModule` with public mission/vote/proposal APIs and non-cash reward helper.
3. Add moderation-safe proposal creation and admin moderation endpoints.
4. Add Creator Studio `today-tasks` read endpoint from pending proposals, active/closed votes, mission signals, and reaction drafts.
5. Add AI reaction draft approve/reject endpoints; initial draft creation can be manual/stubbed before AI provider integration.
6. Add achievements endpoint and title equip endpoint.
7. Add Backstage overview and mission management.
8. Add focused tests for idempotency, moderation gates, non-cash reward separation, and Creator Studio access.
9. Let Builder B wire UI to the stable response shapes before adding richer automation.

blocked_by: none
next_needed:
- Leader should confirm whether v1 points are purely fan reputation or also used for feed/profile exposure ranking.
- Builder B can map UI using the response shapes above without waiting for implementation.
- Backend implementation should start with additive schema + read/list endpoints before AI generation.

---

status: reconciled
task: BA-002 contract reconciliation follow-up
branch/commit: team2-qa/backstage-wallet-adjustment-qa / this reconciliation commit
changed_files:
- docs/ops/fan-engagement-reconciled-contract.md
result:
- Leader reconciled BA-002 with BB-002 in `docs/ops/fan-engagement-reconciled-contract.md`.
- Canonical mission list endpoint remains `GET /api/v1/fan-engagement/missions`, with `surface`, `artistId`, and `scope` query filters.
- Canonical mission completion endpoint remains `POST /api/v1/fan-engagement/missions/:missionId/participations`; `complete` is a body action, not a URL.
- Canonical concept vote submit endpoint is `POST /api/v1/fan-engagement/concept-votes/:voteId/ballots` with `optionId` in the body.
- MyPage rewards summary uses `GET /api/v1/me/fan-engagement/summary`, not `GET /api/v1/me/achievements` in V1.
- User-facing copy must use stable keys plus optional localized labels; do not return English-only `title`, `description`, or `ctaLabel` as the only display source.
next_needed:
- Use the reconciled contract as the source of truth before any backend implementation or schema migration.

---

status: completed
task: BA-004 fan engagement error message keys
branch: team2-backend/ba-004-fan-engagement-error-message-keys
changed_files:
- server/src/fan-engagement/fan-engagement.service.ts
- docs/ops/inbox/builder-a.md
result:
- Added stable `messageKey` coverage to fan engagement mission, concept vote, ballot, duplicate/idempotency, inactive/expired, not-found, and validation errors.
- Preserved existing HTTP statuses and existing error `code` values.
- Added only a narrow fan engagement error response helper; no frontend, Prisma schema, migration, wallet, Lumina, settlement, payout, or revenue behavior changes.
- Fan proposal/moderation endpoints are not present in the current fan-engagement implementation, so there were no proposal-specific API errors to update in this PR.
tests:
- PASS: npm.cmd run lint
- PASS: npm.cmd run build
- PASS: git diff --check

---

status: completed
task: BA-005 fan engagement submit readiness backend check
branch/commit: team2-backend/ba-005-submit-readiness / this readiness commit
changed_files:
- docs/ops/inbox/builder-a.md
tests:
- PASS: git diff --check
- not run: npm.cmd run lint (doc-only readiness check; no backend code or local service mutation performed)
- not run: npm.cmd run build (doc-only readiness check; no backend code or local service mutation performed)
result:
- Latest main was already up to date before inspection.
- Backend readiness for `POST /api/v1/fan-engagement/missions/:missionId/participations` is partially ready by code path, but Phase 3B frontend submit mutation should remain blocked until the items below are resolved.
- Safe mission/test data status: no repo-backed safe active fan mission fixture or production-safe seed was found. Search found only model/migration definitions for `fan_missions`, not `fanMission.create`, `fanMission.createMany`, or mission INSERT data. I did not run live mutation because no dedicated safe QA user/mission was available.
- Logged-out requests are rejected by `JwtAuthGuard` on the participation endpoint (`server/src/fan-engagement/fan-engagement.controller.ts:53`, `server/src/fan-engagement/fan-engagement.controller.ts:54`; guard token checks in `server/src/auth/guards/jwt-auth.guard.ts:28`-`31`).
- Invalid mission IDs are rejected before DB lookup (`server/src/fan-engagement/fan-engagement.service.ts:248`, `server/src/fan-engagement/fan-engagement.service.ts:1008`-`1014`).
- Missing missions return fan-engagement not-found handling (`server/src/fan-engagement/fan-engagement.service.ts:575`-`583`).
- Inactive/expired missions are blocked by status/time window checks with `MISSION_NOT_ACTIVE` and `fanEngagement.mission.notActive` (`server/src/fan-engagement/fan-engagement.service.ts:777`-`793`).
- Duplicate participation for the same reset bucket is protected by both service pre-check and DB uniqueness (`server/src/fan-engagement/fan-engagement.service.ts:288`-`300`, `server/prisma/schema.prisma:1099`), with transaction race fallback (`server/src/fan-engagement/fan-engagement.service.ts:306`-`324`).
- Successful participation creates at most one participation row because `resetBucket` is required and `missionId,userId,resetBucket` is unique (`server/prisma/schema.prisma:1088`, `server/prisma/schema.prisma:1099`).
- Successful participation grants fan points at most once through `FanEngagementPointLedger` unique reference protection (`server/src/fan-engagement/fan-engagement.service.ts:620`-`659`, `server/prisma/schema.prisma:1159`-`1173`).
- Fan points remain isolated from wallet/Lumina/settlement: the fan-engagement service writes only `fanEngagementPointLedger`, and response metadata/policy stays non-cash (`server/src/fan-engagement/fan-engagement.service.ts:646`-`657`, `server/src/fan-engagement/fan-engagement.service.ts:861`-`883`). No `WalletAccount`, `WalletLedger`, Lumina, payout, or settlement reference was found under `server/src/fan-engagement`.
- Non-cash flags are present in rewards/policy: `cashLike:false`, `luminaAmount:0`, `settlementEligible:false`, `transferable:false` (`server/src/fan-engagement/fan-engagement.service.ts:861`-`883`).
blocked_by:
- No confirmed safe active mission/test data. Live mutation QA requires a dedicated safe QA user and safe active QA mission; do not use production user data or ad hoc production seed.
- Logged-out rejection currently comes from shared `JwtAuthGuard`, which returns raw UnauthorizedException messages without fan-engagement `code`/`messageKey` (`server/src/auth/guards/jwt-auth.guard.ts:30`, `server/src/auth/guards/jwt-auth.guard.ts:65`). If frontend submit error rendering requires stable localized keys for logged-out submit, add a scoped auth error mapping before enabling mutation.
- Some validation/not-found submit errors now have stable `messageKey` but no stable application `code`, for example invalid UUID and mission not found (`server/src/fan-engagement/fan-engagement.service.ts:575`-`583`, `server/src/fan-engagement/fan-engagement.service.ts:1008`-`1014`). BA-005 acceptance asks for stable `code` and `messageKey`.
- Idempotency replay rejects reused keys only when they point to a different mission (`server/src/fan-engagement/fan-engagement.service.ts:260`-`281`). Same mission + same idempotency key with different `sourceType`/`sourceId` is treated as replay, not mismatched-body rejection. If Phase 3B depends on body mismatch rejection, store/compare an idempotency request fingerprint first.
next_needed:
- Keep Phase 3B frontend submit mutation gated.
- Provision an explicit safe QA mission and safe QA user, or add dev/test-only fixture tooling outside production seed paths.
- Decide whether submit error contract must require application `code` for auth, validation, and not-found cases before frontend mutation wiring starts.

---

status: completed
task: BA-006 fan engagement mission submit hardening
branch/commit: team2-backend/ba-006-fan-engagement-submit-hardening / this hardening commit
changed_files:
- server/src/fan-engagement/fan-engagement-auth.guard.ts
- server/src/fan-engagement/fan-engagement.controller.ts
- server/src/fan-engagement/fan-engagement.module.ts
- server/src/fan-engagement/fan-engagement.service.ts
- docs/ops/inbox/builder-a.md
tests:
- PASS: npm.cmd run lint
- PASS: npm.cmd run build
- PASS: git diff --check
result:
- Added a fan-engagement scoped auth guard for mission participation submit. Logged-out/invalid auth now returns a stable fan-engagement response shape on `POST /api/v1/fan-engagement/missions/:missionId/participations`: `code=AUTH_REQUIRED`, `messageKey=fanEngagement.auth.required`. Global auth behavior is unchanged for other routes.
- Added a mission participation idempotency request fingerprint over normalized `action`, `sourceType`, and `sourceId`. Reusing the same `idempotencyKey` for the same mission with a different request body now returns `code=IDEMPOTENCY_BODY_MISMATCH`, `messageKey=fanEngagement.error.idempotencyBodyMismatch` instead of replaying.
- Preserved same-body idempotent replay behavior: same user, same mission, same idempotency key, and same normalized body returns the original participation with `idempotentReplay:true` and no extra points.
- Added stable application `code` values to fan-engagement validation/not-found errors that previously had `messageKey` only, including `INVALID_UUID`, `MISSION_NOT_FOUND`, `CONCEPT_VOTE_NOT_FOUND`, `INVALID_TAKE`, `INVALID_SURFACE`, `INVALID_MISSION_SCOPE`, `INVALID_VOTE_STATUS`, and `REQUIRED_STRING`.
- Confirmed successful mission participation still relies on required `resetBucket` plus unique `missionId,userId,resetBucket`, so at most one participation row can be created per reset bucket.
- Confirmed fan point grant remains one-time through `FanEngagementPointLedger` unique `userId,referenceType,referenceId,ledgerType`; rewards/policy still expose `cashLike:false`, `luminaAmount:0`, `settlementEligible:false`, and `transferable:false`.
- Confirmed fan engagement points remain isolated from `WalletAccount`, `WalletLedger`, Lumina, settlement, payout, revenue, and paid-like flows. No wallet/Lumina/settlement references were added under `server/src/fan-engagement`.
- No frontend files, schema, migration, concept vote ballot submit logic, Creator Studio mutation, Backstage mutation, production seed, or auto seed behavior was added.
safe_qa_runbook:
- Use staging or local QA only. Do not create or mutate production user data for this smoke.
- Create or select one dedicated QA user through normal auth flow. Do not record token/cookie/password values in docs or PR.
- Create one explicit QA-only active fan mission manually through a controlled staging/local DB operation or future admin path; do not add automatic production seed data. Recommended values: unique slug such as `qa-home-submit-YYYYMMDD-runN`, `status=active`, `surfaces=['home']`, `resetPolicy=season:qa-YYYYMMDD-runN` for isolated reset buckets, `rewardPolicy={"points":1}`, stable copy keys, and a short `startsAt`/`endsAt` QA window.
- Verify read-only first: `GET /api/v1/fan-engagement/missions?surface=home&scope=today&take=3` should return the QA mission for the QA user.
- Smoke submit cases with the QA user only: logged-out submit returns `AUTH_REQUIRED`; first logged-in submit returns one accepted participation; same key/body replay returns `idempotentReplay:true`; same key with changed `sourceType` or `sourceId` returns `IDEMPOTENCY_BODY_MISMATCH`; new key in the same reset bucket returns `ALREADY_PARTICIPATED`; invalid UUID returns `INVALID_UUID`; inactive/expired QA mission returns `MISSION_NOT_ACTIVE`.
- Verify fan points by checking only `fan_engagement_point_ledger`; do not compare or mutate Lumina wallet balance, settlement, payout, boost, or paid-like tables.
- Reset by creating a new QA mission with a new `season:qa-*` reset bucket or by deactivating the staging/local QA mission after the run. Do not delete or rewrite production rows.
blocked_by:
- Phase 3B frontend submit should remain gated until QA2-004 performs the live mutation smoke with the safe QA mission/user above.
next_needed:
- QA2-004 can run after this branch is merged and safe staging/local QA mission/user/reset conditions are provisioned.

---

status: completed
task: BA-007 safe QA user and mission reset runbook for QA2-004
branch/commit: team2-backend/ba-007-safe-qa-mission-runbook / this runbook commit
changed_files:
- docs/ops/inbox/builder-a.md
tests:
- PASS: git diff --check
- not run: npm.cmd run lint (doc-only QA data runbook; no backend code changed)
- not run: npm.cmd run build (doc-only QA data runbook; no backend code changed)
result:
- Prepared a QA-only runbook for `QA2-004` logged-in mission submit smoke.
- No production auto seed, frontend change, schema change, wallet/Lumina/settlement/paid-like integration, or live mutation was performed.
- Safe data path is staging/local only unless Leader explicitly approves a dedicated production QA environment and QA-only user/mission.
safe_qa_user:
- Use a dedicated QA account created through the normal auth flow in staging/local. Do not use a real customer/user account.
- The account must be active and disposable for this smoke. Record only a non-secret handle in QA notes, never password/token/cookie values.
- Before mutation, QA should capture the user id from a safe authenticated `/api/v1/auth/me` or equivalent account endpoint response, without recording auth secrets.
safe_qa_mission:
- Create exactly one QA-only active mission in staging/local. Do not add an automatic seed and do not insert into production as part of deploy.
- Recommended mission values:
  - `slug`: `qa-home-submit-YYYYMMDD-runN`
  - `mission_type`: `daily_signal`
  - `status`: `active`
  - `surfaces`: `ARRAY['home']`
  - `reset_policy`: `season:qa-YYYYMMDD-runN`
  - `reward_policy`: `{"points":1}`
  - `copy`: stable keys only, e.g. `fanMission.qaHomeSubmit.title`, `fanMission.qaHomeSubmit.description`, `fanMission.qaHomeSubmit.cta`
  - `starts_at`: a recent timestamp before the smoke
  - `ends_at`: a short QA window after the smoke
- `artist_id`, `action_type`, and `action_target_id` can remain null for this one-tap submit smoke.
manual_staging_local_sql_template:
```sql
-- Staging/local only. Replace RUN_ID with a unique value such as 20260510-r1.
-- Do not run as a production migration or production auto seed.
INSERT INTO fan_missions (
  slug,
  mission_type,
  status,
  surfaces,
  reset_policy,
  reward_policy,
  copy,
  starts_at,
  ends_at
) VALUES (
  'qa-home-submit-RUN_ID',
  'daily_signal',
  'active',
  ARRAY['home']::text[],
  'season:qa-RUN_ID',
  '{"points":1}'::jsonb,
  '{
    "titleKey":"fanMission.qaHomeSubmit.title",
    "descriptionKey":"fanMission.qaHomeSubmit.description",
    "ctaKey":"fanMission.qaHomeSubmit.cta",
    "statusKey":"fanMission.status.active",
    "labels":{"ko":{"title":"QA 미션","description":"QA 전용 제출 검증","cta":"QA 제출"}}
  }'::jsonb,
  now() - interval '5 minutes',
  now() + interval '2 hours'
)
ON CONFLICT (slug) DO UPDATE SET
  status = 'active',
  surfaces = ARRAY['home']::text[],
  reset_policy = EXCLUDED.reset_policy,
  reward_policy = EXCLUDED.reward_policy,
  copy = EXCLUDED.copy,
  starts_at = EXCLUDED.starts_at,
  ends_at = EXCLUDED.ends_at,
  updated_at = now()
RETURNING id, slug, reset_policy;
```
visibility_check:
- Run `GET /api/v1/fan-engagement/missions?surface=home&scope=today&take=3`.
- PASS condition: the returned `items` include `slug=qa-home-submit-RUN_ID`, `status=active`, `rewardPreview.points=1`, and policy flags remain non-cash.
- If the QA mission is not in the first 3 items, do not alter real missions. In staging/local, first deactivate only older QA-only `qa-home-submit-*` missions or use an isolated staging/local DB with no competing active `home` missions, then repeat the visibility check.
- If production has real active home missions crowding `take=3`, this runbook is a blocker for production smoke; use staging/local or request a dedicated QA-only environment instead.
submit_smoke_matrix:
- Logged-out submit: `POST /api/v1/fan-engagement/missions/:missionId/participations` should return `AUTH_REQUIRED` and must not create a row.
- First logged-in submit body: `{"action":"complete","sourceType":"qa_smoke","sourceId":"00000000-0000-4000-8000-000000000001","idempotencyKey":"qa-submit-RUN_ID-a"}`. Expected: accepted participation, `idempotentReplay:false`, `rewards.pointsGranted:1`.
- Same key and same body: expected safe replay with `idempotentReplay:true`, no extra fan point ledger row.
- Same key and changed body, for example `sourceId=00000000-0000-4000-8000-000000000002`: expected `IDEMPOTENCY_BODY_MISMATCH`.
- New idempotency key in same `season:qa-RUN_ID` reset bucket: expected `ALREADY_PARTICIPATED`.
- Verify fan points only in `fan_engagement_point_ledger` with `ledger_type=mission_reward` and `reference_type=fan_mission_participation`. Do not inspect or mutate wallet, Lumina, settlement, payout, boost, or paid-like tables except to confirm no change if QA has a safe read-only comparison path.
reset_and_cleanup:
- Preferred reset is to create a new QA mission with a new `RUN_ID` and `reset_policy=season:qa-RUN_ID`; this avoids deleting participation history.
- After QA, mark only the QA mission inactive in staging/local:
```sql
UPDATE fan_missions
SET status = 'archived', updated_at = now()
WHERE slug = 'qa-home-submit-RUN_ID'
  AND slug LIKE 'qa-home-submit-%';
```
- Do not delete production records. Do not delete or edit non-QA rows. Do not run cleanup against real user data.
blocked_by:
- QA2-004 live mutation remains blocked until BA-006 is deployed and this runbook is executed in staging/local with a dedicated QA user and visible QA mission.
next_needed:
- QA or Integrator should provision the staging/local QA user and mission using this runbook, then run QA2-004 against the deployed BA-006+ commit.

---

status: blocked
task: BA-007 runbook execution for QA2-005 live submit smoke
branch/commit: team2-backend/ba-007-runbook-execution-blocked / this blocker commit
changed_files:
- docs/ops/inbox/builder-a.md
tests:
- PASS: git diff --check
- not run: npm.cmd run lint (doc-only blocker note; no backend code changed)
- not run: npm.cmd run build (doc-only blocker note; no backend code changed)
result:
- Pulled latest `main`; it was already up to date.
- Read `docs/ops/inbox/builder-a.md`, `docs/ops/tasks/closed/BA-007-fan-engagement-safe-qa-data-prep.md`, and `docs/ops/board.md`.
- Attempted to execute the BA-007 runbook only against safe local/staging conditions.
- Local API was not running on `localhost:3001`.
- Local PostgreSQL was not reachable on `localhost:5432`.
- No local PostgreSQL service, `psql`, Docker, or Podman execution path was available in this session.
- Required non-secret environment handles for safe execution were absent: `DATABASE_URL`, `QA_USER_EMAIL`, `QA_USER_PASSWORD`, `API_BASE_URL`, and `STAGING_API_BASE_URL` were not present. Values were not read or recorded.
- Because there was no safe local/staging DB/API and no QA-only credential handoff, no QA user was created, no QA mission was created, and no live mutation or read visibility check was executed.
safe_qa_user_path:
- blocked: no QA-only account credential source was available in the session.
qa_mission:
- not created.
- mission id: none
- mission slug: none
- reset bucket: none
visibility_check:
- not run because no safe local/staging API or DB was available.
blocked_by:
- Provide one safe execution target: either a running local PostgreSQL + local API, or a staging API base URL plus QA-only credentials, or a staging/local DB connection explicitly approved for QA-only mutation.
- Values must be provided through a private/local mechanism such as environment variables; do not write passwords, tokens, cookies, or DB secrets into docs, Git, or chat.
- Confirm the target is not production, or explicitly designate a dedicated production QA environment with QA-only user/mission approval before any mutation.
next_needed:
- Re-run this task after safe local/staging execution handles are available.
- QA2-005 live submit smoke remains blocked until a QA mission is created and `GET /api/v1/fan-engagement/missions?surface=home&scope=today&take=3` returns the QA mission.

---

status: completed
task: BA-008 backstage fan mission management API
branch/commit: team2-backend/ba-008-backstage-fan-mission-management-api / this commit
changed_files:
- server/src/admin/admin.controller.ts
- server/src/admin/admin.service.ts
- docs/ops/inbox/builder-a.md
tests:
- PASS: npm.cmd run lint
- PASS: npm.cmd run build
- PASS: git diff --check
result:
- Added super-admin-only Backstage fan mission management endpoints:
  - GET /admin/api/v1/backstage/fan-engagement/missions
  - POST /admin/api/v1/backstage/fan-engagement/missions
  - POST /admin/api/v1/backstage/fan-engagement/missions/:missionId/archive
- Permission model: routes require `@RequireAdminPermissions('*')`, and service methods also call `assertSuperAdmin(user)`.
- Create validates slug/status/surface/resetPolicy/date window/copy/rewardPolicy with stable `code` and `messageKey` errors.
- Duplicate slug returns stable `FAN_MISSION_SLUG_EXISTS` with `admin.fanEngagement.mission.slugExists`.
- Reward policy remains fan engagement only: integer `points`, no WalletAccount/WalletLedger/Lumina/settlement/payout/revenue/paid-like coupling, and responses include `cashLike:false`, `luminaAmount:0`, `settlementEligible:false`, `transferable:false`.
- No frontend files changed. No schema or migration added. No seed/data injection added.
sample_non_secret_create_body:
```json
{
  "slug": "qa-home-submit-20260510-run1",
  "missionType": "qa_submit_smoke",
  "status": "active",
  "surfaces": ["home"],
  "resetPolicy": "season:qa-20260510-run1",
  "rewardPolicy": { "points": 1 },
  "copy": {
    "titleKey": "fanMission.qaSubmit.title",
    "descriptionKey": "fanMission.qaSubmit.description",
    "ctaKey": "fanMission.qaSubmit.cta",
    "statusKey": "fanMission.status.active"
  },
  "startsAt": "set to now minus 5 minutes",
  "endsAt": "set to now plus 2 hours"
}
```
archive_or_deactivate:
- Archive: POST /admin/api/v1/backstage/fan-engagement/missions/:missionId/archive with `{ "status": "archived", "reason": "qa-smoke-complete" }`.
- Deactivate without archive: POST the same endpoint with `{ "status": "inactive", "reason": "qa-smoke-paused" }`.
qa2_005_gate:
- QA2-005 can open after deploy once a super-admin creates a QA mission through this API and confirms it appears in `GET /api/v1/fan-engagement/missions?surface=home&scope=today&take=3`.
- If more than three active home missions crowd the public list, archive/deactivate only older QA-only missions; do not alter real missions.
blocked_by:
- none for backend implementation.
next_needed:
- Merge/deploy BA-008.
- Create one QA-only mission through the admin API.
- Record mission id, slug, and reset policy only; do not record secrets/tokens/cookies.
- Re-run QA2-005 live submit smoke.

---

status: completed
task: #12 fan mission submit error messageKey propagation
branch/commit: team2-backend/preserve-error-message-key / this commit
changed_files:
- server/src/common/http-exception.filter.ts
- docs/ops/inbox/builder-a.md
tests:
- PASS: npm.cmd run lint
- PASS: npm.cmd run build
- PASS: git diff --check
result:
- Preserved safe `messageKey` from thrown `HttpException` response bodies into the final global error response under `error.messageKey`.
- Kept existing `code`, `message`, `statusCode`, `details`, `path`, `requestId`, and `timestamp` behavior unchanged.
- This lets fan engagement submit/admin validation errors expose `code`, `messageKey`, and `requestId` together for QA/operator troubleshooting.
- No live mutation, Render secret/env lookup, production data creation, wallet/Lumina/settlement/payout/paid-like change, or route behavior change was performed.
blocked_by:
- none.
next_needed:
- 큐알 참고 after merge/deploy; collect `error.code`, `error.messageKey`, and `error.requestId` on failures.
민감값 기록 여부: 없음

---

status: completed
task: #5 Backstage admin route contract docs
branch/commit: team2-backend/ba-009-admin-route-contract-docs / this commit
changed_files:
- docs/ops/fan-engagement-reconciled-contract.md
- docs/ops/tasks/open/BA-008-backstage-fan-mission-management-api.md
- docs/ops/inbox/builder-a.md
tests:
- PASS: git diff --check
- not run: npm.cmd run lint (docs-only change)
- not run: npm.cmd run build (docs-only change)
result:
- Clarified that Backstage frontend must call `adminApiPath('/backstage/fan-engagement/missions')` instead of hardcoding host-root `/admin/api/v1/...`.
- Documented the current deployed external route shape for host-root API base URLs:
  - `GET /api/v1/admin/api/v1/backstage/fan-engagement/missions`
  - `POST /api/v1/admin/api/v1/backstage/fan-engagement/missions`
  - `POST /api/v1/admin/api/v1/backstage/fan-engagement/missions/:missionId/archive`
- Recorded that `/admin/api/v1/...` can be correct only relative to an API base URL that already includes `/api/v1`, and may 404 when called at host root.
- No product code, API route code, frontend submit state, seed data, or production data was changed.
blocked_by:
- none for document cleanup.
next_needed:
- 뷰어 리뷰.
민감값 기록 여부: 없음

---

status: completed
task: #11 fan mission submit API test case hardening plan
branch/commit: team2-backend/fan-mission-submit-api-tests-plan / this commit
changed_files:
- server/jest.config.js
- server/src/fan-engagement/fan-engagement.service.spec.ts
- docs/ops/inbox/builder-a.md
tests:
- PASS: npm.cmd test -- fan-engagement.service.spec.ts --runInBand
- PASS: npm.cmd run lint
- PASS: npm.cmd run build
- PASS: git diff --check
test_cases:
- first submit creates one participation and one non-cash point grant
- same idempotency key/body replays without a new grant
- same idempotency key with different source body returns `IDEMPOTENCY_BODY_MISMATCH`
- duplicate reset bucket returns `ALREADY_PARTICIPATED`
- missing mission returns `MISSION_NOT_FOUND`
- inactive mission returns `MISSION_NOT_ACTIVE`
- invalid mission id returns `INVALID_UUID`
- logged-out submit guard returns `AUTH_REQUIRED`
result:
- Added a focused Jest unit spec around `FanEngagementService.createMissionParticipation` and `FanEngagementJwtAuthGuard`.
- Added minimal Jest config so existing `npm.cmd test` can run TypeScript specs.
- Did not change service/controller behavior.
- Did not run live mutation, create production data, or touch wallet/Lumina/settlement/payout/paid-like flows.
blocked_by:
- none.
next_needed:
- 차모 완료확인 after merge/test/build.
민감값 기록 여부: 없음

---

status: completed
task: #241 auth email Korean copy template implementation
branch/commit: team2-backend/auth-mail-copy-241 / this commit
changed_files:
- server/src/auth/auth-email-delivery.service.ts
- server/src/auth/auth-email-delivery.service.spec.ts
- server/README.md
- docs/backend-api-spec.md
- docs/ops/inbox/builder-a.md
tests:
- PASS: npm.cmd test -- auth-email-delivery.service.spec.ts --runInBand
- PASS: npm.cmd run lint
- PASS: npm.cmd run build
- PASS: git diff --check
result:
- Replaced provider email subject/body copy for email verification and password reset with the approved Korean-first Lumina Stage tone.
- Added backend-generated human-readable expiry text in `YYYY-MM-DD HH:mm KST` format.
- Kept the existing action URL contract, provider config, request neutrality, and debug-token production guard unchanged.
- Added focused tests for verification/reset Korean copy and KST expiry rendering.
- Did not modify frontend screen files; `/verify-email` and `/reset-password` screen copy remains a separate #240/cloud task.
sensitive_data:
- none recorded.
blocked_by:
- none for backend mail template implementation.
next_needed:
- Viewer review, then QR QA with real email delivery in a safe environment.

---

status: completed
task: #243 mail delivery status and audit-log admin lookup contract check
branch/commit: team2-backend/mail-audit-admin-243 / this commit
changed_files:
- server/src/admin/admin.controller.ts
- server/src/admin/admin.service.ts
- server/src/admin/admin.service.spec.ts
- server/README.md
- docs/backend-api-spec.md
- docs/admin-permission-matrix.md
- docs/ops/inbox/builder-a.md
tests:
- PASS: npm.cmd test -- admin.service.spec.ts --runInBand
- PASS: npm.cmd run lint
- PASS: npm.cmd run build
- PASS: git diff --check
result:
- Confirmed current `user_action_tokens` supports ops tracing for `purpose`, `createdAt`, `expiresAt`, and `consumedAt` only.
- Confirmed target email can be derived from the related user row, but admin responses must mask it first.
- Confirmed delivery provider/status is not persisted today, so historical delivery acceptance/failure cannot be proven from DB rows.
- Added read-only admin endpoint `GET /admin/api/v1/auth/action-tokens` with `audit:read` permission.
- Endpoint supports `purpose`, `status`, `userId`, masked `email`, `take`, and `cursor` filters.
- Endpoint returns derived token state plus `delivery.status=not_recorded`, `delivery.provider=null`, and policy flags showing raw token/hash/mail body/raw email are not returned.
sensitive_data:
- none recorded.
blocked_by:
- true delivery audit requires a later persistence design/table; current PR intentionally does not store provider delivery events.
next_needed:
- Reviewer check after lint/build.

---

status: completed
task: #243 mail delivery status persistence hardening
branch/commit: team2-backend/mail-audit-admin-243 / this commit
changed_files:
- server/prisma/schema.prisma
- server/prisma/migrations/0040_user_action_token_delivery_audit/migration.sql
- server/src/auth/auth.service.ts
- server/src/auth/auth.service.spec.ts
- server/src/admin/admin.service.ts
- server/src/admin/admin.service.spec.ts
- server/README.md
- docs/backend-api-spec.md
- docs/admin-permission-matrix.md
- docs/ops/inbox/builder-a.md
tests:
- PASS: npx.cmd prisma generate
- PASS: npm.cmd test -- auth.service.spec.ts admin.service.spec.ts --runInBand
- PASS: npm.cmd run lint
- PASS: npm.cmd run build
- PASS: git diff --check
result:
- Added delivery audit fields to `user_action_tokens` without storing raw token, token hash, raw email, mail body, provider raw response, provider secret, or env values.
- Auth request flow now creates action tokens with `deliveryStatus=pending`, `deliveryChannel=email`, and masked target email.
- Successful delivery writes `accepted` or `not_configured`; provider send exceptions keep the public neutral response while persisting `deliveryStatus=failed`.
- Admin read-only endpoint now returns persisted `delivery.status`, `channel`, `provider`, `attemptedAt`, `acceptedAt`, and `failedAt` while preserving masked target email only.
- Historical rows before migration remain represented by `deliveryStatus=not_recorded`.
sensitive_data:
- none recorded.
blocked_by:
- live smoke still requires merge/deploy plus a safe `audit:read` admin account.
next_needed:
- QR QA after branch update: check pending/consumed/expired token state and delivery status/provider timestamps on safe data.

---

status: completed
task: #243 mail delivery audit filter hardening
branch/commit: team2-backend/mail-audit-admin-243 / this commit
changed_files:
- server/src/admin/admin.controller.ts
- server/src/admin/admin.service.ts
- server/src/admin/admin.service.spec.ts
- server/README.md
- docs/backend-api-spec.md
- docs/admin-permission-matrix.md
- docs/ops/inbox/builder-a.md
tests:
- PASS: npx.cmd prisma generate
- PASS: npm.cmd test -- auth.service.spec.ts admin.service.spec.ts --runInBand
- PASS: npm.cmd run lint
- PASS: npm.cmd run build
- PASS: git diff --check origin/main...HEAD
result:
- Added action-token audit query support for `deliveryStatus=all|not_recorded|pending|accepted|not_configured|failed`.
- Added action-token audit query support for `deliveryProvider=all|none|resend|sendgrid`, with `provider` accepted as an alias.
- Added stable admin errors for unsupported delivery status/provider filters.
- Extended response `filters` and `policy` metadata so operators can see the supported delivery lookup contract.
- Kept raw token, token hash, raw email, mail body, provider raw response, provider secret, action URL, and env values out of responses/docs.
sensitive_data:
- none recorded.
blocked_by:
- none for branch-level validation.
next_needed:
- QR QA delivery status/provider filter contract, then Chamo final completion/archive judgment.

---

status: completed
task: #249 identity verification and account trust skeleton
branch/commit: team2-backend/identity-trust-skeleton-249 / this commit
changed_files:
- server/src/auth/auth.service.ts
- server/src/auth/auth.service.spec.ts
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/trust-identity-abuse-policy.md
- docs/ops/inbox/builder-a.md
tests:
- PASS: npx.cmd prisma generate
- PASS: npm.cmd test -- auth.service.spec.ts --runInBand
- PASS: npm.cmd run lint
- PASS: npm.cmd run build
- PASS: git diff --check
result:
- Identity verification request now fails closed before creating a request marker when the NICE provider is not configured.
- Confirm remains fail-closed until the real provider adapter/callback/signature verification is connected.
- Account trust now exposes non-secret derived fields: identityVerified, ageBand, minor, and cleanModeRequired.
- Account identity count limit is documented and returned as a policy-only flag, not an enforced mutation path.
- No wallet, Lumina, settlement, payout, or paid-like reward mutation integration was added.
sensitive_data:
- none recorded.
blocked_by:
- real NICE provider contract/keys/adapter are still required before successful verification can be opened.
next_needed:
- Viewer review, then QR QA on fail-closed request/confirm and read-only trust contract.

---

status: completed
task: #249 identity verification fail-closed wrapper detail follow-up
branch/commit: team2-backend/identity-trust-skeleton-249 / this commit
changed_files:
- server/src/auth/auth.service.ts
- server/src/auth/auth.service.spec.ts
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/trust-identity-abuse-policy.md
- docs/ops/inbox/builder-a.md
tests:
- PASS: npm.cmd test -- auth.service.spec.ts --runInBand
- PASS: npm.cmd run lint
- PASS: npm.cmd run build
- PASS: git diff --check
result:
- Kept provider-not-connected identity verification request/confirm fail-closed behavior unchanged.
- Added `details.requestStarted=false` to the provider-not-connected error payload so the global error wrapper exposes the QA contract in live responses.
- Confirm fail-closed details still include only safe diagnostic fields, including tokenReceived and requestStarted.
- No frontend, wallet, Lumina, settlement, payout, reward mutation, seed, or schema changes.
sensitive_data:
- none recorded.
blocked_by:
- none for branch validation.
next_needed:
- Viewer review, then QR live QA after merge/deploy: request/confirm 501 should expose `error.details.requestStarted=false`.

---

status: completed
task: #254 email verification gate contract; #256 password policy reset safety
branch/commit: team2-backend/auth-email-password-254-256 / this commit
changed_files:
- server/src/auth/auth.service.ts
- server/src/auth/dto/auth.dto.ts
- server/src/auth/auth.service.spec.ts
- server/src/common/validation-exception.factory.ts
- server/README.md
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/builder-a.md
checked_api:
- GET /api/v1/app/bootstrap
- POST /api/v1/auth/email-verifications
- POST /api/v1/auth/email-verifications/confirm
- POST /api/v1/auth/password-resets
- POST /api/v1/auth/password-resets/confirm
- GET /api/v1/me
tests:
- PASS: npx.cmd prisma generate
- PASS: npm.cmd test -- auth.service.spec.ts auth-email-delivery.service.spec.ts --runInBand
- PASS: npm.cmd run lint
- PASS: npm.cmd run build
- PASS: git diff --check
result:
- Added `user.emailVerification` gate state with stable `code`, `messageKey`, `requiredActions`, and `coreFeaturesBlockedUntilVerified` so frontend can distinguish verified/unverified email accounts without raw copy.
- Added public bootstrap email verification policy with stable request/confirm endpoint hints and message keys.
- Email verification/password reset request responses now include neutral `policy` metadata for rate-limit/cooldown hints, token TTL, duplicate pending token behavior, and no raw token/token hash exposure.
- Kept action-token behavior safe: request responses remain existence-neutral, existing pending tokens are consumed before new token creation, confirm consumes tokens once, and reset revokes active refresh-token sessions.
- Simplified password creation/reset policy to 8-128 characters only; letter/number composition is no longer server-required.
- Validation failures now include stable `messageKey=validation.failed`, and password length details use `auth.password.minLength` / `auth.password.maxLength`.
sensitive_data:
- none recorded. No raw token, action link, token hash, cookie, password, or env value recorded.
blocked_by:
- live QA requires merge/deploy.
next_needed:
- Viewer review, then QR QA: verify unconfirmed vs confirmed `GET /me.emailVerification`, neutral resend policy, 7-char validation failure, 8-char password acceptance, single-use reset token reuse rejection.

---

status: completed
task: #259 debut status owner projection fixture follow-up
branch/commit: team2-backend/debut-status-fixtures-259 / this commit
changed_files:
- server/src/debut/debut.service.spec.ts
- docs/ops/qa-debut-status-owner-projection-259.md
- docs/ops/inbox/builder-a.md
checked_api:
- GET /api/v1/me/debut-applications
- GET /api/v1/me/debut-applications/latest
- GET /api/v1/me/debut-applications/:applicationId/status
tests:
- PASS: npm.cmd run prisma:generate
- PASS: npm.cmd test -- debut.service.spec.ts --runInBand
- PASS: npm.cmd run lint -- --quiet src/debut/debut.service.spec.ts
- PASS: npm.cmd run build
- PASS: git diff --check
result:
- Added executable safe owner QA fixtures for `needs_more_info`, `approved_for_contact`, and `rejected` debut application statuses.
- Verified `approved_for_contact` projects to the user-facing `approved` state without implying debut, settlement, contract, payout, or final share completion.
- Verified public notice remains contract-only and disabled for in-app/email dispatch.
- Verified contact values, intro text, internal review notes, internal metadata hints, private material URLs, storage keys, and object ETags are not exposed by the owner projection fixtures.
- Added QR runbook for disposable staging/local owner fixtures and response checks.
sensitive_data:
- none recorded. No credential, cookie, JWT, signed URL, storage key, password, secret, or env value recorded.
blocked_by:
- none for branch-level validation.
next_needed:
- Merge/deploy this follow-up, then QR reQA with disposable `needs_more_info`, `approved_for_contact`, and `rejected` owner fixture records.

---

status: completed
task: #259 debut status owner projection executable fixture script follow-up
branch/commit: team2-backend/debut-status-live-fixtures-259 / this commit
changed_files:
- server/scripts/create-debut-status-owner-fixtures.mjs
- server/package.json
- docs/ops/qa-debut-status-owner-projection-259.md
- docs/ops/inbox/builder-a.md
checked_api:
- GET /api/v1/me/debut-applications/:applicationId/status after fixture creation
tests:
- PASS: node --check server/scripts/create-debut-status-owner-fixtures.mjs
- PASS: npm.cmd run qa:debut-status-fixtures with DEBUT_STATUS_QA_FIXTURE_DRY_RUN=true
- PASS: npm.cmd test -- debut.service.spec.ts --runInBand
- PASS: npm.cmd run build
- PASS: git diff --check
result:
- Added a guarded QA-only script that creates disposable owner fixture rows for `needs_more_info`, `approved_for_contact`, and `rejected`.
- Script requires explicit confirmation, an existing disposable owner user id, and blocks production-like targets unless an approved live-safe override is set.
- Script writes only `debut_applications` QA fixture rows and does not send notifications or touch wallet, Lumina, settlement, payout, paid-like, contract, or artist operator state.
- Runbook now includes exact PowerShell commands, dry-run mode, safety gates, and expected QR response checks.
sensitive_data:
- none recorded. No credential, cookie, JWT, signed URL, storage key, password, secret, DB URL, or env value recorded.
blocked_by:
- none for branch-level validation.
next_needed:
- Merge/deploy this follow-up. Operator/QR can run the guarded fixture script with a disposable owner user, then QR reQA the three owner status endpoints.

---

status: completed
task: #265 debut entertainment/agency application classification and admin filter contract
branch/commit: team2-backend/debut-org-filter-265 / this commit
changed_files:
- server/src/debut/dto/debut.dto.ts
- server/src/debut/debut.service.ts
- server/src/debut/debut.service.spec.ts
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/builder-a.md
checked_api:
- GET /api/v1/debut/policy
- GET /admin/api/v1/debut/applications?operationSegment=entertainment_agency
- GET /admin/api/v1/debut/applications/:applicationId
tests:
- PASS: npm.cmd run prisma:generate
- PASS: npm.cmd test -- debut.service.spec.ts --runInBand
- PASS: npm.cmd run lint -- --quiet src/debut/debut.service.ts src/debut/debut.service.spec.ts src/debut/dto/debut.dto.ts
- PASS: npm.cmd run build
- PASS: git diff --check
result:
- Added the admin/read-only `operationSegment` contract with `entertainment_agency`, `individual`, and `partner` values.
- Added `operationSegment=entertainment_agency` admin list filtering for represented artist, agency, management, and trainee style applications.
- New application metadata now stores `operationSegment` derived from `applicationType` while keeping the existing submit flow and metadata shape.
- Admin list items expose `operationSegment` and organization booleans so operators can identify entertainment/agency inquiries without exposing raw contact values or private material data.
- Admin read-only contract now declares operation segments and keeps mail routing as contract-only with dispatch disabled.
- Docs now describe the Backstage/operations filter path and explicitly state that no mail, contract, settlement, debut finalization, wallet, or Lumina mutation is opened.
sensitive_data:
- none recorded. No contact raw value, private material URL, storage key, object ETag, credential, token, secret, DB URL, or env value recorded.
blocked_by:
- none for branch-level validation.
next_needed:
- Viewer review, then QR/backstage regression QA for `operationSegment=entertainment_agency` list filtering and existing applicationType filter non-regression.

---

status: completed
task: #270 character chat recent conversation and archive API contract
branch/commit: team2-backend/chat-recent-archive-contract-270 / this commit
changed_files:
- server/src/chat/chat.controller.ts
- server/src/chat/chat.service.ts
- server/src/chat/chat.service.spec.ts
- docs/backend-api-spec.md
- docs/character-chat-backend-plan.md
- docs/ops/inbox/builder-a.md
checked_api:
- GET /api/v1/chat/conversations?box=recent|archive|all&take=20&cursor=<nextCursor>
tests:
- PASS: npm.cmd run prisma:generate
- PASS: npm.cmd test -- chat.service.spec.ts --runInBand
- PASS: npm.cmd run lint -- --quiet src/chat/chat.controller.ts src/chat/chat.service.ts src/chat/chat.service.spec.ts
- PASS: npm.cmd run build
- PASS: git diff --check
result:
- Added a new owner-only read-only conversation list endpoint for the character chat DM surface.
- `box=recent` reads active sessions, `box=archive` reads archived sessions, and `box=all` reads both without opening archive/unarchive mutation.
- Response includes artist/persona summary, message count, last message preview, last activity time, pagination, empty-state copy, archive contract, and read-state capability.
- Read receipts are explicitly not implemented yet, so unread fields return `supported=false` and `unreadCount=null`.
- Tests verify no LLM readiness call, no chat message write, no wallet update, and no wallet ledger creation.
sensitive_data:
- none recorded. No token, cookie, session secret, provider secret, wallet ledger id, model metadata, safety metadata, DB URL, or env value recorded.
blocked_by:
- none for branch-level validation.
next_needed:
- Viewer review, then QR/front-end contract smoke for recent/empty/archive DM list states.

---

task: #276 character chat populated conversation list QA fixture
status: completed
owner: 루피
branch/commit: team2-backend/chat-conversation-fixture-276 / this commit
push: pending
changed_files:
- server/package.json
- server/scripts/verify-chat-conversation-list-fixture.mjs
- server/src/chat/chat.service.spec.ts
- docs/backend-api-spec.md
- docs/character-chat-backend-plan.md
- docs/ops/inbox/builder-a.md
checked_api:
- GET /api/v1/chat/conversations?box=recent|archive|all&take=20&cursor=<nextCursor>
fixture_seed_method:
- Added `npm run qa:chat-conversation-list` as a read-only populated-state verifier.
- The verifier expects an approved disposable owner user with existing populated active and archived chat sessions.
- It signs a short-lived owner token and calls only authenticated GET endpoints.
- It does not create chat sessions, create chat messages, call LLM, create feature orders, debit wallet/Lumina, touch settlement, or print raw token, cookie, password, DB URL, raw email, owner UUID, or raw message body.
- If populated rows are missing, the script reports BLOCKED until a safe local/staging disposable seeded state is approved.
result:
- Added archive populated + pagination unit coverage for `getConversationList`.
- Confirmed frontend DM list minimum fields remain available: session id, box, status, artist, persona, message count, last message preview, timestamps, read state contract, archive contract, and safety flags.
sensitive_data:
- none recorded. No raw token, cookie, password, DB URL, raw email, owner UUID, raw message body, model metadata, safety metadata, provider secret, or env value recorded.
blocked_by:
- Live/staging populated execution still needs an approved disposable owner account and environment-provided secrets; no sensitive values were recorded.
next_needed:
- Viewer review.
- QR/front-end can run the verifier only in an approved environment with a disposable populated owner.

---

task: #276 character chat populated verifier P1 follow-up
status: completed
owner: 루피
branch/commit: team2-backend/chat-conversation-fixture-276 / follow-up commit
push: pending
changed_files:
- server/scripts/verify-chat-conversation-list-fixture.mjs
- docs/ops/inbox/builder-a.md
fix_summary:
- Tightened verifier PASS conditions for populated `recent`, `archive`, and `all` boxes.
- When populated rows are expected, returned items must now include `messageCount > 0`, `lastMessage`, non-empty `lastMessage.bodyPreview`, and both `lastMessageAt` and `lastActivityAt`.
- Output remains boolean/count based through `populatedShape`; raw message body, token, cookie, DB URL, owner UUID, secret, and raw email are not printed.
sensitive_data:
- none recorded.
next_needed:
- Viewer re-review.

---

task: #287 character chat conversation list archive/populated contract
status: completed
owner: 루피
branch/commit: team2-backend/chat-list-contract-287 / this commit
push: pending
changed_files:
- server/src/chat/chat.service.ts
- server/src/chat/chat.service.spec.ts
- server/scripts/verify-chat-conversation-list-fixture.mjs
- docs/backend-api-spec.md
- docs/character-chat-backend-plan.md
- docs/ops/inbox/builder-a.md
contract_summary:
- Strengthened `GET /api/v1/chat/conversations` with explicit `paginationContract`, `boxContract`, and `itemShapeContract`.
- Kept `recent` mapped to active sessions, `archive` mapped to archived sessions, and `all` mapped to both.
- Added explicit `chat.conversations.emptyAll` for all-box empty state while keeping recent/archive empty keys stable.
- `take` now defaults to 20, caps at 50, and invalid non-positive values fail before querying.
- The read-only fixture verifier now checks the new contract fields plus populated message count, last message preview, activity timestamps, and safety flags.
response_shape_summary:
- Empty list: `items: []`, stable `emptyState.messageKey`, count/hasMore/nextCursor, read-only safety flags, no mutation.
- Populated list: item includes id, box, status, artist, persona, messageCount, lastMessage preview, lastMessageAt, lastActivityAt, readState.
- Archive list: only `status=archived`; recent list: only `status=active`; all list: active and archived.
sensitive_data:
- none recorded. No raw token, cookie, DB URL, raw email, provider raw response, raw message body, model metadata, safety metadata, password, or secret was recorded.
tests:
- `npm.cmd ci` PASS
- `npm.cmd run lint -- --quiet src/chat/chat.service.ts src/chat/chat.service.spec.ts` PASS
- `node --check scripts/verify-chat-conversation-list-fixture.mjs` PASS
- `npm.cmd test -- chat.service.spec.ts --runInBand` PASS
- `npm.cmd run build` PASS
- `git diff --check` PASS
next_needed:
- Viewer review, then QR/front-end can smoke recent/archive/all empty and populated states.

---

task: #276 character chat archive populated fixture preparation
status: completed
owner: 루피
branch/commit: team2-backend/chat-archive-fixture-276 / this commit
push: pending
changed_files:
- server/package.json
- server/scripts/prepare-chat-archive-conversation-fixture.mjs
- docs/backend-api-spec.md
- docs/character-chat-backend-plan.md
- docs/ops/inbox/builder-a.md
prepared_command:
- `npm run qa:chat-archive-fixture`
fixture_seed_method:
- Guarded script for approved disposable owner only.
- If archive populated already exists, script no-ops by default.
- If archive populated is missing, script can move one existing populated active `chat_sessions` row to `archived`.
- Dry-run and restore modes are supported.
- Production-like targets are blocked unless a one-run live-safe override is explicitly provided.
result:
- This prepares the missing archive populated condition for QR read-only verifier execution.
- The script does not create chat sessions, create chat messages, call LLM, create feature orders, debit wallet/Lumina, touch settlement, or print raw token/cookie/password/DB URL/raw email/owner UUID/session UUID/raw message body.
blocked_by:
- Actual live/staging execution still requires an approved disposable owner and runtime env values held by the operator/QR environment.
next_needed:
- Viewer review, then QR can prepare archive fixture in an approved environment and rerun `npm run qa:chat-conversation-list`.

---

task: #284 debut review status notice and CTA contract
status: completed
owner: 루피
branch/commit: team2-backend/debut-status-notice-cta-284 / this commit
push: pending
changed_files:
- server/src/debut/debut.service.ts
- server/src/debut/debut.service.spec.ts
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/builder-a.md
contract_summary:
- Added an explicit read-only `cta` contract to owner debut application status projection and `publicNotice.cta`.
- `needs_more_info`, `approved_for_contact`/owner `approved`, and `rejected` now expose stable CTA `messageKey` values for Korean fallback rendering.
- CTA is contract-only and disabled in this phase with `enabled=false`, `actionAllowed=false`, `mutationAllowed=false`, and `contractOnly=true`.
- Blocked mutation hints cover debut finalization, contract, settlement, payout, wallet, Lumina, and notification dispatch.
privacy_safety:
- Owner/public status projection still does not expose contact values, intro text, internal admin notes, private material URLs, storage keys, object ETags, raw token, raw email, password, DB URL, or secrets.
- No wallet, Lumina, settlement, contract, payout, notification dispatch, or debut finalization mutation was added.
tests:
- `npm.cmd run lint -- --quiet src/debut/debut.service.ts src/debut/debut.service.spec.ts` PASS
- `npm.cmd test -- debut.service.spec.ts --runInBand` PASS
- `npm.cmd run build` PASS
- `git diff --check` PASS
next_needed:
- Viewer review, then frontend can wire disabled status CTA copy from `application.cta.messageKey` / `defaultLabelKo` without enabling submit or mutation flows.

---

task: #284 debut review status notice and CTA contract P2 doc fix
status: completed
owner: 루피
branch/commit: team2-backend/debut-status-notice-cta-284 / this follow-up commit
push: pending
changed_files:
- docs/frontend-api-handoff.md
- docs/ops/inbox/builder-a.md
fix_summary:
- Fixed the broken Korean `application.cta.labelKo` example in `docs/frontend-api-handoff.md`.
- Runtime contract, API code, submit flows, wallet/Lumina/settlement/contract/payout, and notification dispatch behavior were not changed.
sensitive_data:
- none recorded.
tests:
- `git diff --check` PASS
next_needed:
- Viewer re-review.
민감값 기록 여부: 없음

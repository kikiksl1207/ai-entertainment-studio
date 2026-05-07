# Builder A Inbox

Use the standard completion note from `docs/ops/agents.md`.

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
branch/commit: builder-a-backend/ba-002-fan-engagement-contract / pending
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

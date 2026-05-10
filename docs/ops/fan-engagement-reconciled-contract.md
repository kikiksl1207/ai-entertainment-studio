# Fan Engagement V1 Reconciled Contract

Updated: 2026-05-10
Owner: Chamo / Leader
Status: reconciled contract, implementation not started

## Scope

This document reconciles BA-002 backend contract and BB-002 frontend UI map for the first fan engagement loop.

In scope:

- one-tap missions
- concept votes
- fan one-line proposals
- AI feed/comment draft reactions
- Creator Studio today tasks
- achievements, non-cash points, and public titles

Out of scope:

- dance/video uploads
- Lumina wallet rewards
- settlement, payout, trading, marketplace, or revenue sharing
- auto-publishing AI output
- adult-brand specific behavior

## Canonical Endpoint Table

| Surface | Canonical endpoint | Supersedes | Decision |
| --- | --- | --- | --- |
| Mission list | `GET /api/v1/fan-engagement/missions?surface=&artistId=&scope=today&take=20` | `GET /api/v1/fan-engagement/daily-missions?surface=home`, `GET /api/v1/artists/:artistId/fan-engagement` | Use one mission collection endpoint. `surface=home`, `surface=artist_detail`, or `surface=mypage` controls UI-specific filtering. |
| Mission completion | `POST /api/v1/fan-engagement/missions/:missionId/participations` | `POST /api/v1/fan-engagement/missions/:missionId/complete` | Participation is the backend record. `action=complete` belongs in the body, not in the URL. |
| Concept vote list | `GET /api/v1/fan-engagement/concept-votes?artistId=&status=active&surface=` | page-specific vote fetches | Public fan surfaces use the same vote collection with filters. |
| Concept vote submit | `POST /api/v1/fan-engagement/concept-votes/:voteId/ballots` | `POST /api/v1/fan-engagement/concept-votes/:voteId/options/:optionId` | Ballot is the canonical mutation. `optionId` belongs in the body. |
| Fan one-line proposal | `POST /api/v1/artists/:artistId/fan-proposals` | none | Keep artist-scoped because proposals belong to an artist. |
| My fan engagement summary | `GET /api/v1/me/fan-engagement/summary` | `GET /api/v1/me/achievements` | Use the broader summary because MyPage needs points, achievements, titles, and recent participation together. |
| Equip public title | `PATCH /api/v1/me/fan-engagement/title` | none | Only changes equipped public title, not ownership. |
| Public fan profile summary | `GET /api/v1/users/:userId/fan-engagement/public-summary` | profile-specific ad hoc fields | Returns public title and public badges only. No private participation history. |
| Creator Studio today tasks | `GET /api/v1/me/creator-studio/today-tasks?artistId=&take=20` | `GET /api/v1/me/creator-studio/fan-engagement/tasks?status=pending` | Today tasks is an aggregate queue. Mutations target proposals/drafts, not task IDs. |
| Creator Studio fan proposal action | `POST /api/v1/me/creator-studio/fan-proposals/:proposalId/shortlist`, `POST /api/v1/me/creator-studio/fan-proposals/:proposalId/reject` | task approve/hold endpoints | Keep actions on the real source object. |
| Creator Studio draft action | `POST /api/v1/me/creator-studio/reaction-drafts`, `POST /api/v1/me/creator-studio/reaction-drafts/:draftId/approve`, `POST /api/v1/me/creator-studio/reaction-drafts/:draftId/reject` | task approve/hold endpoints | Drafts never publish without creator approval and moderation approval. |
| Backstage overview | Use `adminApiPath('/backstage/fan-engagement/overview?period=&artistId=')`; deployed external path is `/api/v1/admin/api/v1/backstage/fan-engagement/overview?period=&artistId=` when the API base URL has no `/api/v1` suffix. | none | Admin summary only; no wallet/settlement controls. |
| Backstage mission management | Use `adminApiPath('/backstage/fan-engagement/missions')`; deployed external paths are `GET/POST /api/v1/admin/api/v1/backstage/fan-engagement/missions` and `POST /api/v1/admin/api/v1/backstage/fan-engagement/missions/:missionId/archive` when the API base URL has no `/api/v1` suffix. | none | Mission config requires admin audit events. |

## I18n Policy

Backend must not return English-only user-facing copy as the only source of truth.

V1 policy:

- Backend returns stable keys for every user-facing label: `titleKey`, `descriptionKey`, `ctaKey`, `statusKey`, `optionKey`, and `emptyStateKey` where relevant.
- Backend may return localized labels for the requested locale, but labels are optional convenience data, not the only contract.
- Frontend owns the fallback label map for static V1 surfaces and must map keys to Korean copy before rendering.
- If labels are returned, default locale is `ko`. English labels may be present only as additional locale data.
- API enum/status values stay stable English machine keys, for example `active`, `accepted`, `pending`, `earned`, `needs_creator_review`.
- UI must not show raw enum keys when a localized label is missing. It should use local fallback copy or a neutral Korean fallback.

Recommended copy object:

```json
{
  "copy": {
    "titleKey": "fanMission.dailySignal.title",
    "descriptionKey": "fanMission.dailySignal.description",
    "ctaKey": "fanMission.dailySignal.cta",
    "labels": {
      "ko": {
        "title": "오늘의 응원 미션",
        "description": "한 번 눌러 아티스트에게 응원 신호를 보내요.",
        "cta": "응원하기"
      }
    }
  }
}
```

## Mission List

`GET /api/v1/fan-engagement/missions?surface=home&artistId=&scope=today&take=20`

Query:

- `surface`: `home`, `artist_detail`, `feed`, `mypage`, `creator_studio_hint`
- `artistId`: optional UUID
- `scope`: `today`, `active`, `available`, default `today`
- `take`: max 20 for public surfaces
- `locale`: optional; default from request locale or `ko`

Response:

```json
{
  "generatedAt": "2026-05-10T00:00:00.000Z",
  "locale": "ko",
  "surface": "home",
  "items": [
    {
      "id": "uuid",
      "slug": "daily-concept-vote",
      "missionType": "vote_concept",
      "artist": {
        "id": "uuid",
        "slug": "artist-slug",
        "displayName": "루미나"
      },
      "copy": {
        "titleKey": "fanMission.dailyConceptVote.title",
        "descriptionKey": "fanMission.dailyConceptVote.description",
        "ctaKey": "fanMission.dailyConceptVote.cta",
        "labels": {
          "ko": {
            "title": "오늘의 콘셉트 투표",
            "description": "내일 보고 싶은 무드를 골라주세요.",
            "cta": "투표하기"
          }
        }
      },
      "status": "active",
      "startsAt": "2026-05-10T00:00:00.000Z",
      "endsAt": "2026-05-11T00:00:00.000Z",
      "participation": {
        "status": "not_started",
        "participatedAt": null,
        "remainingCount": 1
      },
      "rewardPreview": {
        "points": 5,
        "achievementCodes": ["first_vote"],
        "titleCodes": [],
        "cashLike": false,
        "luminaAmount": 0
      },
      "action": {
        "type": "concept_vote",
        "method": "POST",
        "endpoint": "/api/v1/fan-engagement/concept-votes/uuid/ballots",
        "requiresAuth": true,
        "bodyHint": {
          "optionId": "uuid",
          "missionId": "uuid",
          "idempotencyKey": "client-generated-key"
        }
      }
    }
  ],
  "summary": {
    "availableCount": 3,
    "completedTodayCount": 1
  },
  "policy": {
    "serviceTimezone": "Asia/Seoul",
    "rewardsAreCashLike": false,
    "pointsTransferable": false,
    "settlementEligible": false,
    "aiDraftsAutoPublish": false
  }
}
```

## Mission Completion

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
    "createdAt": "2026-05-10T00:00:00.000Z"
  },
  "rewards": {
    "pointsGranted": 5,
    "achievementsGranted": ["first_signal"],
    "titlesGranted": [],
    "cashLike": false,
    "luminaAmount": 0
  },
  "idempotentReplay": false
}
```

## Concept Votes

`GET /api/v1/fan-engagement/concept-votes?artistId=&status=active&surface=artist_detail`

Response:

```json
{
  "generatedAt": "2026-05-10T00:00:00.000Z",
  "locale": "ko",
  "items": [
    {
      "id": "uuid",
      "artist": {
        "id": "uuid",
        "slug": "artist-slug",
        "displayName": "루미나"
      },
      "status": "active",
      "visibility": "public",
      "copy": {
        "titleKey": "conceptVote.nextMood.title",
        "summaryKey": "conceptVote.nextMood.summary",
        "labels": {
          "ko": {
            "title": "다음 콘셉트 고르기",
            "summary": "팬들이 보고 싶은 무드를 골라주세요."
          }
        }
      },
      "options": [
        {
          "id": "uuid",
          "optionKey": "conceptVote.option.snowyStage",
          "labels": {
            "ko": {
              "label": "눈 내리는 무대",
              "description": "차분하고 몽환적인 무드"
            }
          },
          "sortOrder": 1
        }
      ],
      "viewer": {
        "hasVoted": false,
        "selectedOptionId": null
      },
      "resultsPreview": null,
      "mission": {
        "id": "uuid",
        "participationStatus": "not_started"
      }
    }
  ]
}
```

`POST /api/v1/fan-engagement/concept-votes/:voteId/ballots`

Body:

```json
{
  "optionId": "uuid",
  "missionId": "uuid",
  "idempotencyKey": "client-generated-key"
}
```

Response:

```json
{
  "ballot": {
    "id": "uuid",
    "voteId": "uuid",
    "optionId": "uuid",
    "createdAt": "2026-05-10T00:00:00.000Z"
  },
  "viewer": {
    "hasVoted": true,
    "selectedOptionId": "uuid"
  },
  "resultsPreview": {
    "visible": true,
    "totalBallots": 120,
    "options": [
      {
        "id": "uuid",
        "ballotCount": 55,
        "ratio": 45.8
      }
    ]
  },
  "missionParticipation": {
    "id": "uuid",
    "status": "accepted"
  },
  "rewards": {
    "pointsGranted": 5,
    "cashLike": false,
    "luminaAmount": 0
  },
  "idempotentReplay": false
}
```

## Fan One-Line Proposal

`POST /api/v1/artists/:artistId/fan-proposals`

Body:

```json
{
  "proposalType": "feed_prompt",
  "body": "비 오는 날 카페 무드로 보고 싶어요",
  "missionId": "uuid",
  "idempotencyKey": "client-generated-key",
  "locale": "ko"
}
```

Response:

```json
{
  "proposal": {
    "id": "uuid",
    "artistId": "uuid",
    "proposalType": "feed_prompt",
    "body": "비 오는 날 카페 무드로 보고 싶어요",
    "status": "submitted",
    "moderationStatus": "pending",
    "visibility": "private_until_approved",
    "createdAt": "2026-05-10T00:00:00.000Z"
  },
  "missionParticipation": {
    "id": "uuid",
    "status": "submitted",
    "moderationStatus": "pending"
  },
  "rewards": {
    "pointsPending": 5,
    "grantTiming": "after_moderation_approved",
    "cashLike": false,
    "luminaAmount": 0
  }
}
```

## Achievements, Points, Titles

`GET /api/v1/me/fan-engagement/summary`

Response:

```json
{
  "generatedAt": "2026-05-10T00:00:00.000Z",
  "locale": "ko",
  "points": {
    "balance": 320,
    "lifetimeEarned": 540,
    "cashLike": false,
    "transferable": false,
    "settlementEligible": false,
    "luminaConvertible": false
  },
  "participationSummary": {
    "completedTodayCount": 1,
    "currentStreakDays": 3,
    "totalAcceptedCount": 24
  },
  "achievements": [
    {
      "code": "first_vote",
      "status": "earned",
      "category": "vote",
      "copy": {
        "titleKey": "achievement.firstVote.title",
        "descriptionKey": "achievement.firstVote.description",
        "labels": {
          "ko": {
            "title": "첫 투표",
            "description": "처음으로 콘셉트 투표에 참여했어요."
          }
        }
      },
      "badgeIconKey": "vote-star",
      "progress": {
        "current": 1,
        "target": 1
      },
      "earnedAt": "2026-05-10T00:00:00.000Z"
    }
  ],
  "titles": {
    "equipped": {
      "code": "concept_scout",
      "copy": {
        "displayNameKey": "fanTitle.conceptScout.name",
        "labels": {
          "ko": {
            "displayName": "콘셉트 스카우트"
          }
        }
      }
    },
    "items": [
      {
        "code": "concept_scout",
        "status": "active",
        "rarity": "creator_pick",
        "copy": {
          "displayNameKey": "fanTitle.conceptScout.name",
          "descriptionKey": "fanTitle.conceptScout.description",
          "labels": {
            "ko": {
              "displayName": "콘셉트 스카우트",
              "description": "아티스트가 선택한 아이디어를 낸 팬"
            }
          }
        }
      }
    ]
  },
  "recentLedger": [
    {
      "id": "uuid",
      "points": 5,
      "direction": "earn",
      "ledgerType": "mission_reward",
      "referenceType": "fan_mission_participation",
      "createdAt": "2026-05-10T00:00:00.000Z"
    }
  ],
  "policy": {
    "rewardsAreCashLike": false,
    "pointsTransferable": false,
    "settlementEligible": false
  }
}
```

`PATCH /api/v1/me/fan-engagement/title`

Body:

```json
{
  "titleCode": "concept_scout"
}
```

Response:

```json
{
  "equipped": {
    "code": "concept_scout",
    "equippedAt": "2026-05-10T00:00:00.000Z"
  }
}
```

`GET /api/v1/users/:userId/fan-engagement/public-summary`

Response:

```json
{
  "userId": "uuid",
  "publicTitle": {
    "code": "concept_scout",
    "copy": {
      "displayNameKey": "fanTitle.conceptScout.name",
      "labels": {
        "ko": {
          "displayName": "콘셉트 스카우트"
        }
      }
    }
  },
  "publicBadges": [
    {
      "code": "first_vote",
      "badgeIconKey": "vote-star",
      "copy": {
        "titleKey": "achievement.firstVote.title",
        "labels": {
          "ko": {
            "title": "첫 투표"
          }
        }
      }
    }
  ],
  "privacy": {
    "participationHistoryPublic": false
  }
}
```

## Creator Studio Today Tasks

`GET /api/v1/me/creator-studio/today-tasks?artistId=&take=20`

Response:

```json
{
  "generatedAt": "2026-05-10T00:00:00.000Z",
  "locale": "ko",
  "summary": {
    "totalOpen": 12,
    "needsReview": 5,
    "canApproveNow": 3,
    "blockedByModeration": 2
  },
  "artists": [
    {
      "artist": {
        "id": "uuid",
        "slug": "artist-slug",
        "displayName": "루미나"
      },
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
          "copy": {
            "titleKey": "creatorTask.fanProposalReview.title",
            "labels": {
              "ko": {
                "title": "팬 제안 확인"
              }
            }
          },
          "bodyPreview": "비 오는 날 카페 무드로 보고 싶어요",
          "status": "submitted",
          "moderationStatus": "approved",
          "source": {
            "type": "fan_proposal",
            "id": "uuid",
            "author": {
              "id": "uuid",
              "displayName": "팬"
            }
          },
          "actions": [
            {
              "key": "shortlist",
              "method": "POST",
              "endpoint": "/api/v1/me/creator-studio/fan-proposals/uuid/shortlist"
            },
            {
              "key": "request_ai_draft",
              "method": "POST",
              "endpoint": "/api/v1/me/creator-studio/reaction-drafts"
            }
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

## Backstage / Admin

Backstage frontend code must not hardcode the external deployed admin path. Use the
existing `adminApiPath('/...')` helper:

- If the configured API base already ends in `/api/v1`, the helper emits
  `/admin/api/v1/...`.
- If the configured API base is the host root such as `https://api.lumina-stage.com`,
  the helper emits `/api/v1/admin/api/v1/...`.
- Current production route checks showed `/api/v1/admin/api/v1/...` reaches the
  deployed admin route, while `/admin/api/v1/...` at host root may return 404.

Backstage admin endpoint intentions:

- `GET adminApiPath('/backstage/fan-engagement/overview?period=YYYY-MM&artistId=')`
- `GET adminApiPath('/backstage/fan-engagement/missions')`
- `POST adminApiPath('/backstage/fan-engagement/missions')`
- `POST adminApiPath('/backstage/fan-engagement/missions/:missionId/archive')`
- `GET adminApiPath('/backstage/fan-engagement/proposals?status=&moderationStatus=')`
- `PATCH adminApiPath('/backstage/fan-engagement/proposals/:proposalId/moderation')`
- `GET adminApiPath('/backstage/fan-engagement/reaction-drafts?status=&moderationStatus=')`
- `PATCH adminApiPath('/backstage/fan-engagement/reaction-drafts/:draftId/moderation')`
- `GET adminApiPath('/backstage/fan-engagement/point-ledger?userId=&artistId=')`

Admin policy:

- Mission create/update writes `AuditEvent`.
- Point/title admin adjustment is not a wallet operation, but still requires admin permission and audit.
- Fan engagement admin UI must not include Lumina wallet, payout, settlement, or revenue controls.

## Frontend Surface Mapping

| Page | Use endpoint |
| --- | --- |
| `index.html` | `GET /api/v1/fan-engagement/missions?surface=home&scope=today&take=3` |
| `character-detail.html` | `GET /api/v1/fan-engagement/missions?surface=artist_detail&artistId=...`, `GET /api/v1/fan-engagement/concept-votes?artistId=...`, `POST /api/v1/artists/:artistId/fan-proposals` |
| `lumina-feed.html` | show only approved/published fan proposal or artist reaction content from existing feed API or later `type=fan_engagement`; do not expose pending drafts |
| `mypage.html` | `GET /api/v1/me/fan-engagement/summary`, `PATCH /api/v1/me/fan-engagement/title` |
| `user-profile.html` | `GET /api/v1/users/:userId/fan-engagement/public-summary` or same fields embedded into profile response |
| `creator-studio.html` | `GET /api/v1/me/creator-studio/today-tasks`, proposal/draft source-object action endpoints |
| `backstage.html` | Backstage fan engagement overview and mission/moderation endpoints |

## Unresolved Questions

| Owner | Decision needed | Default until decided |
| --- | --- | --- |
| Leader / PM | Should fan points affect feed/profile exposure ranking in V1? | Store `exposureBoost` policy metadata, but do not apply ranking changes in V1. |
| Builder A | Should localized labels be stored in DB JSON or served from frontend maps first? | V1 backend returns stable keys and optional `labels.ko`; frontend keeps fallback maps. |
| Builder B | Which surfaces ship first if implementation must be cut smaller? | `character-detail.html` mission/vote/proposal first, then `mypage.html` summary, then `index.html` teaser. |
| Reviewer | What is the acceptance test for "no English copy leak"? | Check representative Korean UI states and verify missing label fallback does not render raw enum keys. |
| Integrator | Should `GET /api/v1/me/achievements` exist as alias? | No alias in V1 unless an existing page already depends on it. Use `/me/fan-engagement/summary`. |

## Final Notes

- This is documentation and contract reconciliation only.
- No code implementation, DB migration, or PR was created by this task.
- BA-002 and BB-002 should treat this document as the canonical V1 contract unless Leader updates it.

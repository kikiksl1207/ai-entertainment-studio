# BA-002 - 1st Fan Engagement Loop Backend Contract

Owner: Builder A / Backend
Status: open
Priority: P1

## Context

Chamo PM reviewed the 20 expansion items and cut the 1st product loop down to:

- one-tap missions
- concept votes
- fan one-line proposals
- AI feed/comment draft reactions
- Creator Studio today tasks
- achievements / points / titles

Users are assumed to be lazy. The product should collect useful fan signals from
click-level actions before asking for uploads, long writing, dance videos, or
revenue-sharing flows.

## Backend Goal

Design the smallest backend contract for this 1st loop. Prefer a contract/spec
and schema plan first. Implement code only if the shape is obvious and narrow.

## Required Design

Propose models or reuse strategy for:

- `FanMission` or equivalent one-tap daily/season missions.
- `FanMissionParticipation` or equivalent participation logs.
- `FanProposal` / `ContentRequest` for one-line fan suggestions.
- `ArtistReactionDraft` for AI-generated replies/feed/comment drafts awaiting approval.
- `UserAchievement` / points / title grants.
- Creator Studio "today tasks" query that gathers pending fan signals and AI drafts.

## API Contract To Consider

Public/user side:

- `GET /api/v1/fan-engagement/missions`
- `POST /api/v1/fan-engagement/missions/:missionId/participations`
- `POST /api/v1/artists/:artistId/fan-proposals`
- `GET /api/v1/me/achievements`

Creator Studio side:

- `GET /api/v1/me/creator-studio/today-tasks`
- `POST /api/v1/me/creator-studio/reaction-drafts/:draftId/approve`
- `POST /api/v1/me/creator-studio/reaction-drafts/:draftId/reject`

Admin/Backstage side:

- `GET /admin/api/v1/backstage/fan-engagement/overview`
- `POST /admin/api/v1/backstage/fan-engagement/missions`
- `PATCH /admin/api/v1/backstage/fan-engagement/missions/:missionId`

## PM Constraints

- Do not start dance/video upload features yet.
- Do not start revenue-sharing or user IP settlement yet.
- Initial rewards are non-cash: points, achievements, titles, profile exposure.
- All fan text must have moderation status before public exposure.
- AI drafts must be approval-based, not auto-published.
- Keep this compatible with possible future separate adult brand by keeping content rating / moderation concepts clean, but do not implement adult-specific features.

## Deliverable

Either:

1. A backend design note under `docs/ops/inbox/builder-a.md`, or
2. A small backend patch plus design note if the implementation is straightforward.

Include:

- Proposed tables/models.
- Proposed endpoints and response shape.
- Migration risk.
- What Builder B needs from backend.
- Tests run.

## Leader Reconciliation

Use `docs/ops/fan-engagement-reconciled-contract.md` as the canonical V1 contract before implementation.

Key decisions:

- Mission list: `GET /api/v1/fan-engagement/missions?surface=&artistId=&scope=today&take=20`.
- Mission completion: `POST /api/v1/fan-engagement/missions/:missionId/participations`.
- Concept vote submit: `POST /api/v1/fan-engagement/concept-votes/:voteId/ballots` with `optionId` in the body.
- MyPage reward summary: `GET /api/v1/me/fan-engagement/summary`.
- Creator Studio queue: `GET /api/v1/me/creator-studio/today-tasks`.
- I18n: backend returns stable display keys plus optional localized labels; do not rely on English-only user-facing copy.

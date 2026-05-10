# BB-003 - Fan Engagement Frontend Implementation Map

Owner: Builder B / Frontend
Status: open
Priority: P1

## Context

BA-002 and BB-002 have been reconciled by Leader in:

- `docs/ops/fan-engagement-reconciled-contract.md`

This task is not frontend implementation yet. It is the frontend implementation map that turns the reconciled contract into screen-by-screen UI work.

## Read First

Read only:

- `docs/ops/agents.md`
- `docs/ops/board.md`
- `docs/ops/fan-engagement-reconciled-contract.md`
- this task file

Then inspect only frontend-relevant existing surfaces:

- `index.html`
- `character-detail.html`
- `lumina-feed.html`
- `mypage.html`
- `user-profile.html`
- `creator-studio.html`
- `backstage.html`
- related CSS/JS sections only when needed to map placement and responsive behavior

## Goal

Produce a frontend implementation map for the first fan engagement loop:

- where each block appears
- what minimal component states are needed
- which canonical endpoint each block consumes
- how mobile layout behaves
- how Korean/i18n fallback is handled
- what can ship first without making users do heavy work

## Approved First Slice Lock

Leader approval is limited to:

- `index.html` Home read-only/mock teaser planning first.
- No real submit behavior.
- No API mutation wiring.
- No mission completion, concept vote ballot, fan proposal submit, title equip, Creator Studio approval, or Backstage mission mutation until the Backend First PR is complete and reviewed.

Allowed before Backend First PR:

- Read-only/mock Home teaser placement plan.
- Static/mock data shape for layout planning.
- Loading/empty/error visual state plan without live mutation.
- Korean/i18n fallback key plan.
- Mobile/responsive QA checklist.

Not allowed before Backend First PR:

- Calling `POST /api/v1/fan-engagement/missions/:missionId/participations`.
- Calling `POST /api/v1/fan-engagement/concept-votes/:voteId/ballots`.
- Calling `POST /api/v1/artists/:artistId/fan-proposals`.
- Calling `PATCH /api/v1/me/fan-engagement/title`.
- Calling Creator Studio proposal/draft approval/reject/request endpoints.
- Calling Backstage fan engagement create/update/moderation endpoints.
- Adding enabled submit buttons that imply a real mutation is available.

## Required Output

Write the map to `docs/ops/inbox/builder-b.md`.

Include:

- Page-by-page implementation order.
- Component/block names and exact placement recommendation.
- Data dependencies per block using the canonical endpoints.
- Loading/empty/error/success/submitted states.
- Auth gate behavior for logged-out users.
- Mobile layout notes for narrow mobile, mobile large, tablet, and desktop.
- i18n plan: local fallback labels for stable backend keys and no raw enum/English leakage.
- Accessibility notes: tap target size, submitted state, aria labels where needed.
- Risk list: layout collision, duplicate submit, stale auth, Creator Studio access gate, moderation display, mojibake.
- First UI slice recommendation.
- What backend fields are blocking UI wiring.
- Explicit confirmation that the first frontend slice is Home read-only/mock teaser only until Backend First PR lands.

## Canonical Decisions To Preserve

- `index.html`: `GET /api/v1/fan-engagement/missions?surface=home&scope=today&take=3`.
- `character-detail.html`: `GET /api/v1/fan-engagement/missions?surface=artist_detail&artistId=...`, `GET /api/v1/fan-engagement/concept-votes?artistId=...`, `POST /api/v1/artists/:artistId/fan-proposals`.
- Mission completion: `POST /api/v1/fan-engagement/missions/:missionId/participations`.
- Concept vote submit: `POST /api/v1/fan-engagement/concept-votes/:voteId/ballots`.
- `mypage.html`: `GET /api/v1/me/fan-engagement/summary`, `PATCH /api/v1/me/fan-engagement/title`.
- `user-profile.html`: `GET /api/v1/users/:userId/fan-engagement/public-summary` or embedded equivalent.
- `creator-studio.html`: `GET /api/v1/me/creator-studio/today-tasks`, then source-object proposal/draft actions.
- `backstage.html`: fan engagement overview, mission management, moderation queues only.

## Do Not

- Do not implement UI code.
- Do not edit backend files.
- Do not change canonical endpoint names without writing a blocker.
- Do not attach submit/API mutation behavior before Backend First PR is complete and reviewed.
- Do not add wallet, payout, settlement, trading, adult-brand, or revenue-sharing UI.
- Do not make a landing page or marketing hero.
- Do not expose raw enum keys, English-only backend copy, or mojibake to users.

## Completion Note

Use the standard completion note from `docs/ops/agents.md`.

Required `tests` entry:

- `git diff --check`

If you only inspect and write docs, browser QA is not required yet. Include the future browser QA checklist in the map.

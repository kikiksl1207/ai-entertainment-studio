# BB-005 - Fan Engagement Home Teaser Phase 2 Real GET

Owner: Builder B / Frontend
Status: closed
Priority: P1

## Context

Fan engagement Home teaser Phase 1 mock/read-only UI passed QA on main `f94ffd2`.

Backend First PR and BA-004 messageKey follow-up are merged. The next frontend step should be read-only API wiring only.

## Goal

Connect the Home teaser to the real read-only mission list endpoint without enabling any submit or mutation behavior.

Canonical endpoint:

- `GET /api/v1/fan-engagement/missions?surface=home&scope=today&take=3`

## Allowed

- Read-only `GET` fetch for Home teaser data.
- Keep mock fallback when API fails or returns empty.
- Preserve Korean fallback copy from stable keys.
- Preserve disabled CTA behavior.
- Loading/empty/error display states.
- Desktop/mobile/narrow layout QA.
- Safe auth-aware visual state only, without performing participation.

## Not Allowed

- No `POST /api/v1/fan-engagement/missions/:missionId/participations`.
- No `POST /api/v1/fan-engagement/concept-votes/:voteId/ballots`.
- No `POST /api/v1/artists/:artistId/fan-proposals`.
- No `PATCH /api/v1/me/fan-engagement/title`.
- No Creator Studio proposal/draft mutation.
- No Backstage fan engagement mutation.
- No enabled submit buttons.
- No wallet, payout, settlement, trading, adult-brand, or revenue-sharing UI.

## Acceptance Criteria

- Home teaser uses real `GET` when available.
- If the API fails, teaser falls back to safe mock/empty state.
- Raw enum keys and English-only backend copy are not shown to users.
- CTA remains disabled or visibly "coming soon"; it must not submit.
- No mutation request is sent during page load or CTA clicks.
- Existing Home hero, artists, shortform, and debut carousel still render.
- Layout passes desktop, mobile large, and narrow mobile checks.

## Required Checks

- `node --check pages/fan-engagement.js`
- `node --check data/fan-engagement-copy.js`
- `git diff --check`

If inline script in `index.html` is changed, parse/check the changed script as well.

## Completion Note

Write result to `docs/ops/inbox/builder-b.md`.

## Closure

Closed on 2026-05-10 after merge and QA2-002 PASS.

Merged:

- source branch `origin/team2-frontend/fan-engagement-home-teaser-phase-2`
- source commit `ce013fea79c8e44c23c7018c260c1ea84642ffd2`
- merge commit `b23f44e Merge fan engagement home teaser real GET`

Verified:

- `node --check pages/fan-engagement.js`
- `node --check data/fan-engagement-copy.js`
- `git diff --check`
- QA2-002 PASS via `origin/team2-qa/QA2-002-fan-engagement-real-get-smoke`

Mutation gate remains active. This task does not authorize submit or mutation wiring.

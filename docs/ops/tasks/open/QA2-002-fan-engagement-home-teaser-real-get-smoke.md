# QA2-002 - Fan Engagement Home Teaser Real GET Smoke

Owner: Team2 QA
Status: open
Priority: P1

## Context

Phase 2 Home fan engagement teaser real GET connection has been merged into main.

Merge target:

- `origin/team2-frontend/fan-engagement-home-teaser-phase-2`
- source commit `ce013fea79c8e44c23c7018c260c1ea84642ffd2`
- merge commit `b23f44e Merge fan engagement home teaser real GET`

## Scope

Smoke-test the Home fan mission teaser after real read-only GET wiring.

Endpoint expected:

- `GET /api/v1/fan-engagement/missions?surface=home&scope=today&take=3`

## Must Confirm

- Home page still renders.
- Fan mission teaser section appears.
- Teaser calls only the read-only GET endpoint above.
- If API returns missions, cards render from API response.
- If API fails or returns empty, safe fallback/loading/empty/error state appears.
- Korean fallback copy is readable.
- Raw enum keys, message keys, or English-only backend copy are not exposed.
- CTA remains disabled or clearly non-submitting.
- Clicking CTA sends no mutation request.
- Existing Home hero, artists, shortform, and debut carousel still render.
- Desktop, mobile large, and narrow mobile layouts do not overlap or overflow.

## Must Not Happen

- No `POST /api/v1/fan-engagement/missions/:missionId/participations`.
- No `POST /api/v1/fan-engagement/concept-votes/:voteId/ballots`.
- No `POST /api/v1/artists/:artistId/fan-proposals`.
- No `PATCH /api/v1/me/fan-engagement/title`.
- No Creator Studio or Backstage mutation.
- No wallet, settlement, paid-like, payout, or cash-like connection.

## Suggested Checks

- Browser network filter: `fan-engagement`.
- Verify zero mutation calls after page load and forced CTA clicks.
- Check desktop around 1365px.
- Check mobile large around 390px.
- Check narrow mobile around 320px.

## Completion Note

Write result to `docs/ops/inbox/team2-qa.md`.

Include:

- main commit tested
- page URL
- observed network calls
- responsive viewports
- PASS/FAIL
- blockers
- screenshots only if useful

# BB-006 - Fan Engagement Submit Readiness Frontend Check

Owner: Builder B / Frontend
Status: open
Priority: P1

## Context

Home fan engagement teaser Phase 2 is read-only and has passed QA. The CTA is
still disabled. This task prepares the next UI slice, but does not enable any
real mutation.

## Read First

Read only:

- `docs/ops/agents.md`
- `docs/ops/board.md`
- `docs/ops/fan-engagement-reconciled-contract.md`
- `docs/ops/tasks/open/BA-005-fan-engagement-submit-readiness-backend.md`
- this task file

Then inspect only:

- `index.html`
- `data/fan-engagement-copy.js`
- `pages/fan-engagement.js`
- `styles/home.css`

## Goal

Prepare the frontend plan for Mission Participation submit, while keeping the
current product read-only until Backend readiness and QA data are confirmed.

## Check

- Current Home teaser still performs only read-only GET.
- CTA remains disabled in main until a later implementation task explicitly
  enables submit.
- Proposed submit UI can handle:
  - logged-out user -> existing auth modal
  - loading/submitting state
  - accepted/success state
  - already participated state
  - idempotent replay state
  - backend validation error with `messageKey`
  - network/error fallback without raw English or enum leakage
- Korean fallback copy exists or is specified for every visible submit state.
- No raw enum/status/key is displayed to users.
- No wallet/Lumina/settlement/paid-like copy or behavior is introduced.
- Mobile/narrow layout has enough space for enabled CTA and state messages.

## Required Output

Write a readiness note to `docs/ops/inbox/builder-b.md`.

Include:

- whether the current Phase 2 code is still mutation-free
- exact UI states needed for Phase 3B
- copy keys/fallback Korean labels needed
- proposed files for Phase 3B
- blockers waiting on BA-005 or QA2-003

## Do Not

- Do not implement submit.
- Do not call `POST /api/v1/fan-engagement/missions/:missionId/participations`.
- Do not call concept vote ballot submit.
- Do not enable CTA buttons.
- Do not edit backend files.
- Do not edit `app.js`.
- Do not connect wallet, settlement, payout, Lumina, or paid-like behavior.

## Tests

Always run:

- `node --check pages/fan-engagement.js`
- `node --check data/fan-engagement-copy.js`
- `git diff --check`

If only docs are changed, note that no browser QA was required yet.

## Completion Note

Use the standard completion note from `docs/ops/agents.md`.

# BA-004 - Fan Engagement Error Message Keys

Owner: Builder A / Backend
Status: open
Priority: P2

## Context

RV-003 passed the Backend First PR with no P0/P1 blockers, but left one P2 follow-up:

- fan-engagement error responses need stable `messageKey` coverage before frontend relies on API error rendering.

## Goal

Make fan engagement API errors safe for frontend rendering and localization.

## Scope

Review fan engagement backend errors from:

- `server/src/fan-engagement/fan-engagement.controller.ts`
- `server/src/fan-engagement/fan-engagement.service.ts`

Ensure user-facing or frontend-consumed errors include stable machine-readable message keys.

## Expected Shape

Use the existing backend error/exception conventions where available. If there is no shared helper, propose or add a narrow fan engagement helper that returns safe structured details such as:

```json
{
  "message": "Mission is not available.",
  "messageKey": "fanEngagement.mission.notAvailable",
  "details": {
    "reason": "inactive_or_expired"
  }
}
```

Do not expose secrets, raw SQL errors, stack traces, provider responses, or production data.

## Acceptance Criteria

- Mission errors have stable keys.
- Concept vote/ballot errors have stable keys.
- Fan proposal validation/moderation errors have stable keys.
- Duplicate/idempotency conflicts have stable keys.
- Not-found, unauthorized, forbidden, inactive/expired, and already-participated cases are covered.
- English message text is not the only frontend contract.
- Frontend can map `messageKey` to Korean copy without parsing raw text.

## Do Not

- Do not change endpoint names.
- Do not add frontend mutation wiring.
- Do not change wallet, settlement, payout, trading, adult-brand, or revenue behavior.
- Do not broaden the feature beyond error response coverage.

## Completion Note

Write result to `docs/ops/inbox/builder-a.md`.

Run:

- `npm.cmd run lint` in `server/`
- `npm.cmd run build` in `server/`
- `git diff --check`

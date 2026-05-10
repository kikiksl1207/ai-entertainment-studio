# BA-006 - Fan Engagement Mission Submit Hardening

Owner: Builder A / Backend
Status: closed
Priority: P1

## Context

Phase 3A readiness returned a NO-GO for frontend submit enablement.

BA-005 found that mission participation submit is not ready to open because:

- there is no confirmed safe active QA mission/test fixture for live mutation QA
- logged-out requests are blocked by `JwtAuthGuard`, but the auth error is not a
  fan-engagement `code`/`messageKey` response
- invalid UUID / not-found cases have `messageKey` coverage but not always a
  stable application `code`
- reusing the same idempotency key with a different `sourceType`/`sourceId` can
  replay instead of returning a mismatch error

QA2-003 also found the live read-only endpoints return `items: 0`, so no live
submit QA can run yet.

## Read First

Read:

- `docs/ops/agents.md`
- `docs/ops/board.md`
- `docs/ops/fan-engagement-reconciled-contract.md`
- `docs/ops/tasks/closed/BA-005-fan-engagement-submit-readiness-backend.md`
- `docs/ops/tasks/closed/QA2-003-fan-engagement-submit-readiness.md`
- this task file

Then inspect:

- `server/prisma/schema.prisma`
- `server/src/fan-engagement/**`
- existing auth error patterns only if needed for a consistent response plan

## Goal

Make mission participation submit safe enough for a later frontend Phase 3B task
to enable the Home teaser CTA.

## Required Work

- Fix idempotency replay behavior so the same idempotency key with a different
  request body is rejected with a stable error instead of silently replaying.
- Ensure invalid UUID, not-found, inactive/expired, duplicate participation,
  invalid action, idempotency mismatch, and other fan-engagement submit errors
  expose stable `code` and `messageKey` where the frontend may render them.
- Decide and document the logged-out/auth error contract:
  - either use the existing global auth error shape and state that Builder B
    should map it to the auth modal, or
  - add a stable auth-related response shape without breaking global auth.
- Confirm successful mission participation still creates at most one
  participation and grants fan points at most once.
- Confirm fan points remain isolated from `WalletAccount`, `WalletLedger`,
  Lumina, settlement, payout, paid-like, and revenue sharing.
- Provide a safe QA data/runbook plan for one active QA mission. This must not
  auto-seed production data.

## QA Data Rule

Do not silently create production seed data.

Acceptable outputs:

- a staging/local-only seed or script that is not run automatically in
  production
- a documented manual runbook for creating a safe QA mission/user/reset bucket
- a clear blocker if no safe QA data path can be provided yet

## Not Allowed

- Do not edit frontend files.
- Do not enable submit UI.
- Do not add concept vote ballot submit changes.
- Do not add Creator Studio today tasks.
- Do not add Backstage fan engagement mutation.
- Do not connect fan points to wallet, settlement, payout, Lumina, paid-like,
  trading, or revenue sharing.
- Do not hide errors behind generic `INTERNAL_SERVER_ERROR` responses.

## Required Checks

Run when code changes are made:

- `npx.cmd prisma generate` if schema or generated client assumptions change
- `npm.cmd run lint`
- `npm.cmd run build`
- `git diff --check`

If the task is docs-only because a blocker remains, run:

- `git diff --check`

## Required Output

Write result to `docs/ops/inbox/builder-a.md`.

Include:

- branch and commit
- exact changes made
- whether Phase 3B frontend submit can open after this task
- safe QA mission/test data status
- remaining blockers, if any

## Completion Note

Use the standard completion note from `docs/ops/agents.md`.

## Closure

Closed on 2026-05-10 after backend hardening merge and deploy verification.

Merged:

- source branch `origin/team2-backend/ba-006-fan-engagement-submit-hardening`
- source commit `a2c378d271169d64a860d611493e12337ae7a11a`
- merge commit `8c24969 Merge fan engagement submit hardening`

Verified:

- `git diff --check HEAD~1 HEAD`
- `server > npm.cmd run lint`
- `server > npm.cmd run build`
- `/health` on both API domains returned `8c24969a750a6fa765c56c3b570bdb92da16b0a8`

Result:

- Mission submit auth errors now return stable `AUTH_REQUIRED` + `messageKey`.
- Idempotency body mismatch handling is added.
- Validation and not-found errors have stable `code` + `messageKey` coverage.
- No frontend, schema, migration, seed, wallet, Lumina, settlement, payout, or paid-like changes were included.

Remaining gate:

- Phase 3B frontend submit remains blocked until safe QA user, safe active QA mission, and isolated reset bucket are prepared and verified.

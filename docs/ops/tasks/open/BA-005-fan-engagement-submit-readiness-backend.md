# BA-005 - Fan Engagement Submit Readiness Backend Check

Owner: Builder A / Backend
Status: open
Priority: P1

## Context

Fan engagement backend first PR, BA-004 message keys, Home teaser Phase 1, and Home
real GET Phase 2 have landed. The next risky step is enabling user actions. Do
not implement new behavior in this task. This is a readiness check before any
frontend submit wiring is allowed.

## Read First

Read only:

- `docs/ops/agents.md`
- `docs/ops/board.md`
- `docs/ops/fan-engagement-reconciled-contract.md`
- this task file

Then inspect only:

- `server/prisma/schema.prisma`
- `server/src/fan-engagement/**`
- relevant auth/idempotency helper patterns if needed

## Goal

Confirm whether mission participation submit can safely move to a frontend
implementation task.

## Check

- There is a safe way to test at least one active mission on stage or local QA.
- `POST /api/v1/fan-engagement/missions/:missionId/participations` rejects:
  - logged-out requests
  - invalid mission IDs
  - inactive/expired missions
  - duplicate participation for the same reset bucket
  - idempotency key replay with mismatched body, if applicable
- Successful participation creates at most one participation record.
- Successful participation grants fan points at most once.
- Fan points remain isolated from `WalletAccount`, `WalletLedger`, Lumina,
  settlement, payout, and revenue sharing.
- Error responses include stable `code` and `messageKey`.
- Response policy continues to expose non-cash flags:
  - `cashLike: false`
  - `luminaAmount: 0`
  - `settlementEligible: false`
  - `transferable: false`

## Required Output

Write a readiness note to `docs/ops/inbox/builder-a.md`.

Include:

- available safe mission/test data status
- exact endpoint cases verified or blocked
- whether Phase 3B frontend submit wiring is safe to start
- any blocker with file/line references
- whether live mutation QA requires a dedicated safe QA user/mission

## Do Not

- Do not edit frontend files.
- Do not add production seed data.
- Do not create or mutate production user data.
- Do not add Creator Studio today tasks.
- Do not add concept vote ballot submit changes in this task.
- Do not connect anything to wallet, settlement, payout, or Lumina.
- Do not hide blockers with broad try/catch or generic messages.

## Tests

Run if code or local service checks are performed:

- `npm.cmd run lint`
- `npm.cmd run build`

Always run:

- `git diff --check`

## Completion Note

Use the standard completion note from `docs/ops/agents.md`.

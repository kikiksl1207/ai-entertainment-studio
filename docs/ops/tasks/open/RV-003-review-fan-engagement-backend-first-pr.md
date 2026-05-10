# RV-003 - Review Fan Engagement Backend First PR

Owner: Reviewer
Status: open
Priority: P0

## Context

Fan engagement Backend First PR is ready for review.

Review target:

- Branch: `origin/team2-backend/fan-engagement-first-pr`
- Commit: `cec520d Implement fan engagement backend first PR`
- Base: `origin/main`

Do not merge this branch until Reviewer returns PASS.

## Changed Files

- `server/prisma/migrations/0037_fan_engagement_core/migration.sql`
- `server/prisma/schema.prisma`
- `server/src/app.module.ts`
- `server/src/fan-engagement/fan-engagement.controller.ts`
- `server/src/fan-engagement/fan-engagement.module.ts`
- `server/src/fan-engagement/fan-engagement.service.ts`

## Read First

- `docs/ops/agents.md`
- `docs/ops/board.md`
- `docs/ops/fan-engagement-reconciled-contract.md`
- this task file

## Review Scope

Review against the reconciled contract:

- Canonical endpoint names and response shape alignment.
- Prisma migration scope and whether it is additive/safe.
- Model indexes, unique constraints, and idempotency keys.
- Mission participation idempotency and duplicate reward prevention.
- Concept vote ballot uniqueness and replay behavior.
- Fan proposal moderation gates before public exposure.
- AI reaction draft approval/moderation gates and no auto-publish.
- Non-cash reward separation from `WalletAccount` / `WalletLedger`.
- Auth/access control for public user, Creator Studio, and Backstage/admin surfaces.
- Stable copy keys / i18n behavior; no English-only user-facing copy as the only source.
- No settlement, payout, wallet reward, trading, adult-brand, or revenue-sharing behavior.
- No secrets, tokens, raw credentials, or production data.

## Required Checks

Run from a clean checkout of `origin/team2-backend/fan-engagement-first-pr`:

- `git diff --check origin/main...HEAD`
- `npm.cmd run lint` in `server/`
- `npm.cmd run build` in `server/`

If local dependencies are missing, install safely with `npm.cmd ci` inside `server/` and note that in the result.

## Findings Format

Findings first, ordered by severity:

- P0: must block merge.
- P1: should block merge unless Leader explicitly waives.
- P2: should fix soon, may not block if contained.
- P3: polish/documentation.

For every finding, include file/line and why it violates the contract or safety rule.

## PASS Criteria

Reviewer PASS requires:

- No P0/P1 blockers.
- Required checks pass.
- Migration scope reviewed.
- Endpoint names match `docs/ops/fan-engagement-reconciled-contract.md`.
- Rewards remain non-cash and separate from Lumina wallet.
- Moderation and no-auto-publish rules are intact.

## Completion Note

Write the result to `docs/ops/inbox/reviewer.md` using the standard completion note from `docs/ops/agents.md`.

Do not merge.
Do not edit feature code unless Leader explicitly asks.

# BA-007 - Fan Engagement Safe QA Data Prep

Owner: Builder A / Backend
Status: closed
Priority: P1

## Context

BA-006 hardening is merged and deployed, but IN-004 closed Phase 3B with a NO-GO
because QA2-004 could not run logged-in live mission submit smoke.

QA2-004 blockers:

- safe QA user credential source was not available in the workspace/session
- `QA_USER_EMAIL` / `QA_USER_PASSWORD` were not available
- safe active QA mission was not available
- live mission list returned `items: 0`
- first submit, idempotency, duplicate, and fan point ledger smoke were not run

## Goal

Prepare a safe, explicit QA data path so QA can later run mission participation
submit smoke without using real user data or ad hoc production seed behavior.

## Required Work

- Define the safe QA user requirement without recording secrets in Git, Notion,
  or chat.
- Define how the QA credential source should be provided to a local session
  without exposing values, for example local-only environment variables or a
  private operator handoff.
- Prepare one QA-only active fan mission or a controlled runbook for creating
  one.
- The QA mission should use an isolated reset bucket such as
  `season:qa-YYYYMMDD-runN`.
- The QA mission should have a short QA window, small non-cash reward policy,
  and clear cleanup/deactivation steps.
- Confirm the read-only mission endpoint can expose the QA mission to the QA
  user before any logged-in submit smoke.
- Document exactly how QA should reset or isolate a second run without deleting
  or rewriting production rows.

## Acceptance Criteria

- QA has a safe user/account path, with no secret values written to docs or Git.
- QA has one safe active mission or an approved manual setup runbook.
- The mission reset bucket is isolated and named explicitly.
- The reward remains non-cash and does not touch WalletAccount, WalletLedger,
  Lumina, settlement, payout, revenue, boost, paid-like, or trading tables.
- The live read-only mission list can return the QA mission for the QA user, or
  a precise blocker is recorded.
- QA can re-open a new live smoke task only after the above is true.

## Not Allowed

- Do not commit secrets, tokens, passwords, cookies, signed URLs, direct upload
  URLs, DB passwords, or API keys.
- Do not add automatic production seed data.
- Do not use real user data for mutation smoke.
- Do not edit frontend files.
- Do not enable frontend submit UI.
- Do not add concept vote ballot submit, fan proposal submit, title equip,
  Creator Studio mutation, Backstage mutation, wallet, Lumina, settlement,
  payout, paid-like, revenue-sharing, or trading behavior.

## Required Checks

If docs/runbook only:

- `git diff --check`

If backend code/tooling changes are needed:

- `npm.cmd run lint`
- `npm.cmd run build`
- `git diff --check`

## Required Output

Write result to `docs/ops/inbox/builder-a.md`.

Include:

- branch and commit
- whether a safe QA user path exists
- whether a safe active QA mission exists
- reset bucket value or naming rule, without secrets
- cleanup/deactivation procedure
- whether QA may open the next live submit smoke task
- remaining blockers, if any

## Completion Note

Use the standard completion note from `docs/ops/agents.md`.

## Closure

Closed on 2026-05-10 after docs/runbook merge.

Merged:

- source branch `origin/team2-backend/ba-007-safe-qa-mission-runbook`
- source commit `ca539f618e19636b8415161b0fcca386ed12c458`
- merge commit `bae721d Merge fan engagement safe QA data runbook`

Verified:

- changed file from source branch was `docs/ops/inbox/builder-a.md` only
- no product code changes
- no frontend, schema, migration, or seed changes
- `git diff --check`

Result:

- Safe QA user and QA-only mission/reset bucket runbook is documented in `docs/ops/inbox/builder-a.md`.
- Runbook is staging/local only unless Leader explicitly approves a dedicated production QA environment and QA-only user/mission.
- No secrets or live mutation were recorded.

Remaining gate:

- Phase 3B frontend submit remains blocked until the runbook is executed, a safe QA mission is visible, and logged-in submit smoke passes.

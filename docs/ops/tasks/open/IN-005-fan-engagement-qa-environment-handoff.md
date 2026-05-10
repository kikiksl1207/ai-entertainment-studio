# IN-005 - Fan Engagement QA Environment Handoff

Owner: Integrator / Operator
Status: blocked
Priority: P1

## Context

BA-006 backend hardening is merged and deployed.

BA-007 documented a safe staging/local runbook for a QA-only active fan mission,
but the execution attempt was blocked because the current session has no safe
execution handle:

- local API `localhost:3001` is not running
- local PostgreSQL `localhost:5432` is not reachable
- `psql`, Docker, and Podman command paths are unavailable
- `DATABASE_URL`, `QA_USER_EMAIL`, `QA_USER_PASSWORD`, `API_BASE_URL`, and
  `STAGING_API_BASE_URL` are not available in the session
- no QA user, QA mission, mission id, slug, or reset bucket was created

Frontend Phase 3B remains blocked.

## Goal

Provide a safe, non-secret handoff so QA can run the logged-in mission submit
smoke without using real user data or polluting production.

## Acceptable Paths

Choose one:

### Option A - Local/Staging DB Runbook

- Provide a safe local or staging `DATABASE_URL` to the operator session through
  a private/local environment mechanism, not chat or Git.
- Ensure a DB client path is available, such as `psql`, a managed SQL console,
  or another approved local tool.
- Create a dedicated QA user through the normal auth flow or confirm an existing
  disposable QA user.
- Create one QA-only active fan mission using the BA-007 runbook.
- Confirm the QA mission appears in:
  `GET /api/v1/fan-engagement/missions?surface=home&scope=today&take=3`

### Option B - Staging API Handoff

- Provide `STAGING_API_BASE_URL` or `API_BASE_URL` privately/local-only.
- Provide a QA-only auth method privately/local-only.
- Provide an approved API/admin path or operator action to create the QA mission.
- Confirm the QA mission appears in the read-only mission list.

### Option C - Manual Operator Setup

- Operator creates the QA user and QA mission outside Codex.
- Operator gives QA only non-secret values:
  - API base URL
  - QA mission id
  - QA mission slug
  - reset bucket
  - non-secret QA user handle
- Do not share password, token, cookie, DB URL, or secrets in docs or chat.

## QA Mission Requirements

- `surface=home`
- `status=active`
- isolated reset bucket such as `season:qa-YYYYMMDD-runN`
- `rewardPolicy={"points":1}`
- short QA window
- copy uses stable keys and optional Korean labels
- visible in `GET /api/v1/fan-engagement/missions?surface=home&scope=today&take=3`

## Do Not

- Do not write secrets to Git, Notion, docs, or chat.
- Do not use real customer/user accounts for mutation smoke.
- Do not add automatic production seed data.
- Do not enable frontend submit UI.
- Do not run concept vote ballot submit.
- Do not touch wallet, Lumina, settlement, payout, paid-like, trading, or
  revenue-sharing data.

## Required Output

Write a handoff note to `docs/ops/inbox/integrator.md`.

Include only non-secret values:

- which acceptable path was used
- tested API base URL host, without credentials
- QA mission id
- QA mission slug
- reset bucket
- QA user handle, without credentials
- visibility check result
- whether QA2-005 can open

## Next Step

If this task succeeds, open QA2-005 for logged-in mission submit live smoke.

If this task remains blocked, record the blocker and keep Phase 3B closed.

## Required Checks

For docs-only work:

- `git diff --check`

## Completion Note

Use the standard completion note from `docs/ops/agents.md`.

## Attempt Note

Attempted on 2026-05-10.

Result:

- Blocked. No safe QA environment handoff could be completed in this session.

Checked without recording secret values:

- `DATABASE_URL`: not present.
- `QA_USER_EMAIL`: not present.
- `QA_USER_PASSWORD`: not present.
- `API_BASE_URL`: not present.
- `STAGING_API_BASE_URL`: not present.
- `psql`: unavailable.
- Docker: unavailable.
- Podman: unavailable.
- `localhost:3001` health: unavailable.
- `localhost:5432`: unavailable.
- production API health: reachable at `api.lumina-stage.com`, commit `8c24969a750a6fa765c56c3b570bdb92da16b0a8`.
- production read-only mission list: `GET /api/v1/fan-engagement/missions?surface=home&scope=today&take=3` returned `items: []`.

Non-secret handoff values:

- API host: `api.lumina-stage.com`
- QA mission id: none
- QA mission slug: none
- reset bucket: none
- QA user handle: none
- visibility check result: failed / no QA mission visible
- QA2-005 can open: no

No QA user was created. No QA mission was created. No live mutation was executed.
No secrets were read, printed, or recorded.

Next required input:

- Provide a private/local safe execution target: local/staging API + DB path, or
  staging API/admin path + QA-only credentials, or manual operator setup with
  only non-secret mission/user handoff values.

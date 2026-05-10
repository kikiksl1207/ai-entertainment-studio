# OP-001 - Fan Engagement QA Private Handoff

Owner: Leader / Operator
Status: open
Priority: P1

## Context

Fan engagement mission submit is implemented and hardened on the backend, but
the logged-in live smoke cannot run yet.

The current Codex session cannot create or verify a safe QA mission because it
does not have:

- a local/staging API process
- local/staging DB access
- a DB client path
- QA-only credentials
- an already-created QA mission visible in the read-only mission list

This task asks the Leader/Operator to provide one safe handoff path without
exposing secrets in Git, Notion, or chat.

## Goal

Enable IN-005 and then QA2-005 by providing a safe QA user and QA-only active
mission path.

## Choose One Path

### Path A - Private Local/Staging Environment Variables

Set these values privately on the QA/Integrator machine, not in Git or chat:

- `STAGING_API_BASE_URL` or `API_BASE_URL`
- `QA_USER_EMAIL`
- `QA_USER_PASSWORD`

Optional, only if the operator will create the mission through DB access:

- `DATABASE_URL`

Also ensure a DB execution path exists if DB setup is needed:

- `psql`, managed SQL console, or another approved operator-only DB tool

### Path B - Manual Operator Setup

Operator creates the QA-only user and mission outside Codex, then provides only
these non-secret values:

- API host
- QA mission id
- QA mission slug
- reset bucket
- QA user handle
- visibility check result

Do not provide password, token, cookie, DB URL, or API keys in text.

### Path C - Staging Admin/API Setup

Operator provides a private staging admin path that can create the QA mission
without exposing secrets.

After creation, provide only non-secret confirmation values listed in Path B.

## QA Mission Requirements

- `surface=home`
- `status=active`
- reset bucket like `season:qa-YYYYMMDD-runN`
- `rewardPolicy={"points":1}`
- short QA window
- stable copy keys, optional Korean labels
- visible through:
  `GET /api/v1/fan-engagement/missions?surface=home&scope=today&take=3`

## Non-Secret Confirmation Format

When ready, provide:

```text
Fan engagement QA handoff ready.

API host: <host only>
QA user handle: <non-secret handle only>
QA mission id: <uuid>
QA mission slug: <slug>
Reset bucket: season:qa-YYYYMMDD-runN
Visibility check: PASS, mission appears in GET /api/v1/fan-engagement/missions?surface=home&scope=today&take=3
Secret delivery: local env / private operator session / manual setup completed
```

## Do Not

- Do not paste secrets into chat, Notion, docs, or Git.
- Do not use real customer/user accounts.
- Do not add production auto seed data.
- Do not enable frontend submit UI.
- Do not run concept vote ballot submit.
- Do not touch wallet, Lumina, settlement, payout, paid-like, trading, or
  revenue-sharing data.

## Next Step

After this handoff is ready:

1. IN-005 records the non-secret handoff result.
2. QA2-005 opens for logged-in mission submit smoke.
3. Frontend Phase 3B remains blocked until QA2-005 and the following gate pass.

## Required Output

Write a short handoff note to `docs/ops/inbox/integrator.md` or provide the
non-secret confirmation text to the Integrator.

## Completion Note

Use the standard completion note from `docs/ops/agents.md`.

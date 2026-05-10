# QA2-004 - Fan Engagement Mission Submit Live Smoke

Owner: Team2 QA
Status: closed
Priority: P1

## Context

QA2-003 could not run live submit mutation because there was no safe active QA
mission/vote/reset condition. This task must wait until BA-006 is complete and a
safe QA data path is explicitly available.

## Wait For

- BA-006 merged or otherwise approved by Integrator.
- A safe QA user/account is available.
- A safe active QA mission exists or can be created by an approved staging/local
  runbook.
- Reset/isolation rules are clear enough to test duplicate and idempotency
  behavior without polluting real user data.

## Goal

Verify that mission participation submit can be safely opened to the frontend in
a later Phase 3B implementation.

## Required Smoke Matrix

If safe QA data is available, verify:

- logged-out CTA behavior can be tested without mutation
- logged-in first submit creates one participation
- duplicate submit in the same reset bucket returns stable already participated
  behavior
- same idempotency key and same body replays safely
- same idempotency key and different body returns stable mismatch behavior, if
  supported by BA-006
- fan point ledger changes are non-cash and do not change Lumina wallet balance
- response includes or implies:
  - `cashLike: false`
  - `luminaAmount: 0`
  - `settlementEligible: false`
  - `transferable: false`
- desktop/mobile/narrow layout expectations for the later enabled CTA remain
  feasible

## Do Not

- Do not run live mutation unless the safe QA data conditions above are met.
- Do not run concept vote ballot submit.
- Do not alter wallet, settlement, payout, Lumina, paid-like, trading, or
  revenue-sharing data.
- Do not record tokens, cookies, passwords, env values, signed URLs, direct
  upload URLs, or other secrets.

## Required Output

Write result to `docs/ops/inbox/team2-qa.md`.

Include:

- tested backend commit
- safe QA data used, without secrets
- mutation cases run or explicitly blocked
- pass/fail for duplicate/idempotency/fan-points isolation
- whether Phase 3B frontend submit can open

## Required Checks

- `git diff --check`

If browser automation is used, note viewport sizes and keep screenshots free of
secrets.

## Completion Note

Use the standard completion note from `docs/ops/agents.md`.

## Closure

Closed on 2026-05-10 as partial pass / blocked.

QA branch:

- `origin/team2-qa/QA2-004-fan-engagement-submit-live-smoke`
- commit `da45831 docs: record QA2-004 submit smoke`

Backend deploy verified:

- `/health` returned `8c24969a750a6fa765c56c3b570bdb92da16b0a8`

PASS:

- Logged-out submit probe returned HTTP 401 with `code=AUTH_REQUIRED`.
- No auth token, cookie, password, env value, or secret was recorded.
- No logged-in live mission mutation was executed.
- No wallet, Lumina, settlement, payout, paid-like, Creator Studio, Backstage, title equip, fan proposal, or concept vote ballot mutation was executed.

Blocked:

- No safe QA user credential source was available in the workspace/session.
- `QA_USER_EMAIL` / `QA_USER_PASSWORD` were not available.
- No safe active QA mission was available.
- Live mission list returned `items: 0`.
- First submit, idempotency replay, duplicate submit, and fan point ledger smoke were not run.

Decision:

- Phase 3B frontend submit implementation remains blocked.

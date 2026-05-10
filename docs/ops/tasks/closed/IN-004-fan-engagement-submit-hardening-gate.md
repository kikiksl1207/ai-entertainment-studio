# IN-004 - Fan Engagement Submit Hardening Gate

Owner: Integrator
Status: closed
Priority: P1

## Context

IN-003 closed Phase 3A with a NO-GO decision for Phase 3B.

The next gate is smaller:

- BA-006 must harden backend mission participation submit.
- QA2-004 must confirm live submit smoke is possible and safe, or identify the
  remaining blocker.
- Builder B should not implement or enable submit until this gate is green.

## Wait For

- BA-006 backend result in `docs/ops/inbox/builder-a.md`.
- QA2-004 result in `docs/ops/inbox/team2-qa.md`.

## Go Criteria

Phase 3B frontend submit implementation may open only if all are true:

- BA-006 confirms idempotency mismatch no longer silently replays.
- BA-006 confirms frontend-renderable errors have stable `code` and
  `messageKey`, or documents the global auth error mapping for logged-out cases.
- BA-006 confirms duplicate participation and duplicate point grant protection.
- QA2-004 confirms a safe QA mission/user/reset path exists.
- QA2-004 confirms first submit, duplicate submit, and idempotency smoke pass, or
  clearly states any remaining blocker.
- No wallet/Lumina/settlement/paid-like/revenue-sharing behavior is introduced.

## No-Go Criteria

Keep Phase 3B blocked if any are true:

- no safe QA mission/user/reset path exists
- idempotency mismatch still replays incorrectly
- duplicate fan point grant protection is unverified
- backend error shape is too unstable for frontend rendering
- any wallet/Lumina/settlement coupling appears

## Required Output

Write a gate note to `docs/ops/inbox/integrator.md`.

Include:

- go/no-go decision
- exact blockers if no-go
- exact next owner/task if go
- whether Builder B may open a Phase 3B submit implementation task

## Do Not

- Do not merge frontend submit implementation under this gate.
- Do not open concept vote ballot submit.
- Do not broaden scope to MyPage, Creator Studio, Backstage, title equip, fan
  proposals, or admin tooling.

## Required Checks

For docs-only gate work:

- `git diff --check`

For any code merge later, require the task-specific checks.

## Completion Note

Use the standard completion note from `docs/ops/agents.md`.

## Closure

Closed on 2026-05-10 with a NO-GO decision for Phase 3B.

Decision:

- NO-GO. Do not open frontend submit implementation yet.

Evidence:

- BA-006 backend hardening is merged and deployed at `8c24969`.
- QA2-004 confirmed logged-out submit returns HTTP 401 with `code=AUTH_REQUIRED`.
- QA2-004 did not run logged-in live mutation because safe QA prerequisites were missing.
- Live read-only mission list returned `items: 0`.
- No logged-in mission participation, idempotency, duplicate, or fan point ledger smoke was executed.
- No wallet, Lumina, settlement, payout, paid-like, Creator Studio, Backstage, title equip, fan proposal, or concept vote ballot mutation was executed.

Blocked by:

- Missing safe QA user credential source in the current workspace/session.
- Missing safe active QA mission.
- Missing isolated reset bucket evidence for a live QA mission.

Next task:

- Open BA-007 to prepare a safe QA user, active QA mission, and reset bucket for submit smoke.

Still forbidden:

- Frontend Phase 3B submit implementation.
- Mission participation submit UI enablement.
- Concept vote ballot submit.
- Fan proposal submit.
- Title equip.
- Creator Studio / Backstage mutation.
- Wallet / Lumina / settlement / payout / paid-like connection.

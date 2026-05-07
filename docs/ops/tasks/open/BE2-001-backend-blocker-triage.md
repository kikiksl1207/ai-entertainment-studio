# BE2-001 - Backend/API Blocker Triage

Owner: Team2 Backend
Status: open
Priority: P1

## Goal

Investigate backend/API causes for current QA blockers without overlapping with
Team1 BA-002 fan engagement loop design.

## Allowed Scope

- `server/src/`
- `server/prisma/`
- `docs/ops/inbox/team2-backend.md`

## Focus

- Creator Studio access and `/api/v1/me/creator-studio` regressions.
- Object storage diagnostics and upload intent/API blockers.
- Wallet adjustment API safety issues found by QA or Reviewer.
- Any API response shape that blocks existing Backstage/Creator Studio screens.

## Do Not

- Do not design or implement the new fan engagement loop. Team1 BA-002 owns it.
- Do not edit frontend files.
- Do not change secrets, `.env`, Render settings, or production DB directly.
- Do not create production test data without explicit approval.

## Output

Write to `docs/ops/inbox/team2-backend.md`:

```text
status:
task:
branch/commit:
changed_files:
tests:
result:
blocked_by:
next_needed:
```

If code changes are made, keep them narrow and run:

- `npm.cmd run lint`
- `npm.cmd run build`

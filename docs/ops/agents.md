# Lumina Stage Parallel Agent Rules

Updated: 2026-05-07
Leader workspace: `C:\Users\하마다랩스\Documents\New project\workspace-core`

## Roles

- Leader / Chamo: PM, task split, backend architecture, Git/Notion summary, final priority.
- Builder A / Backend: `server/`, `server/prisma/`, backend docs. Avoid frontend files unless Leader explicitly assigns it.
- Builder B / Frontend: user-facing static files, Backstage, Creator Studio, browser QA notes. Do not change backend contracts without asking Leader.
- Reviewer: review diffs and acceptance criteria. Prefer findings, risks, missing tests, and exact file references.
- Integrator: merge/pull coordination, lint/build verification, final release notes. Do not start feature work unless Leader assigns it.

## Operating Rules

- Do not read Notion unless Leader explicitly asks.
- Read only this file, `docs/ops/board.md`, and the assigned task file.
- Do not reveal or write secrets, API keys, DB passwords, tokens, auth codes, or raw credentials.
- Work in your own clone/folder only.
- Pull latest `main` before starting.
- Keep write scope narrow.
- If blocked, write a concise status to your inbox file and stop.
- After finishing, write result, changed files, tests, and commit hash to your inbox file.

## Always-On Product Checks

- Mobile is part of the default acceptance criteria for any user-facing UI work. Check narrow mobile widths, normal desktop width, and make sure text/buttons do not overlap or overflow.
- Localization is part of the default acceptance criteria. Korean copy must not be mojibake, English-only strings should not be added casually, and existing locale/i18n response fields must be preserved.
- For backend/API work that touches user-facing text, include stable keys or safe fallback text so the frontend can translate later.
- For review work, call out missing mobile checks or missing localization/i18n handling as findings, even when the feature works on desktop Korean only.

## Inbox Files

- Builder A: `docs/ops/inbox/builder-a.md`
- Builder B: `docs/ops/inbox/builder-b.md`
- Reviewer: `docs/ops/inbox/reviewer.md`
- Integrator: `docs/ops/inbox/integrator.md`

## Standard Completion Note

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

# Lumina Stage Task Markdown Workflow

Updated: 2026-05-15
Owner: Chamo

## Why This Exists

Notion remains the source of truth for current owner, status, color, and
completion/archive decisions. Markdown task files are the fast handoff layer
for developers, reviewers, and QA.

Use this split:

- Notion: current owner, color, one-line status, done/archive state.
- Markdown: exact scope, file ownership, API contract, QA checklist, forbidden
  actions, completion report format.

## File Rule

Create one markdown file per active Notion task when the task needs code, QA, or
cross-agent handoff detail.

Recommended path:

```text
docs/ops/tasks/open/LS-<notion-number>-short-title.md
```

Move to `docs/ops/tasks/closed/` only after Chamo marks the Notion task
complete/archive.

## Required Sections

Each task file should stay short and include:

- Owner and status.
- Goal.
- Allowed scope.
- Acceptance criteria.
- QA checklist.
- Do not.
- Completion report format.

## Status Handoff Rule

Before changing a Notion title or color:

1. Read the task page body and the markdown file if it exists.
2. Trust the newest dated implementation or QA note.
3. Change Notion only when the next owner is clear from evidence.
4. Never revert another worker's newer status just because an older summary
   says something different.

## Secret Rule

Never write raw tokens, API keys, passwords, cookies, signed URLs, provider raw
responses, or private credential values in Notion, Markdown, Git, or chat.

Mask personal email addresses unless the user explicitly gives one for a test
flow. Even then, do not repeat it in task files unless truly necessary.

## Completion Report

```text
status:
task:
owner:
branch/commit:
changed_files:
tests:
qa:
result:
blocked_by:
next_needed:
sensitive_values_written: none
```


# R2-001 - Review Team2 Output

Owner: Team2 Reviewer
Status: open
Priority: P1

## Goal

Review Team2 QA and bugfix outputs before Integrator touches them.

## Inputs

- `docs/ops/inbox/team2-qa.md`
- `docs/ops/inbox/team2-backend.md`
- `docs/ops/inbox/team2-frontend.md`
- Any Team2 pushed branches.

## Review Focus

- Are QA blockers reproducible and assigned to the right owner?
- Are backend fixes narrow and safe?
- Are frontend fixes narrow and free of layout/copy regressions?
- Did anyone overlap with Team1 BA-002/BB-002 fan engagement design?
- Do changes need Integrator now, or should they wait?

## Output

Write findings to `docs/ops/inbox/team2-reviewer.md`:

```text
status:
task:
branches_reviewed:
findings:
tests:
result:
blocked_by:
next_needed:
```

Findings should lead, ordered by severity with file/line references when code is
available.

## Do Not

- Do not merge branches.
- Do not edit production data.
- Do not rewrite Team1 task outputs.

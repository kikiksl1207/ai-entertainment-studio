# IN-001 - Integrate Backstage / Creator Studio Work

Owner: Integrator
Status: waiting
Area: Integration

## Goal

After Builder A/B finish and Reviewer signs off, integrate the work, run final verification, and prepare the release summary.

## Read

- `docs/ops/agents.md`
- `docs/ops/board.md`
- Builder inbox files
- Reviewer inbox file
- relevant task files

## Integration Checklist

- Pull latest `main`.
- Inspect Builder commits/diffs.
- Resolve conflicts without reverting unrelated user or Builder work.
- Run from `server/`:
  - `npm.cmd run lint`
  - `npm.cmd run build`
- For frontend-only work, confirm no backend build regression.
- Summarize changed files, tests, and commit hash.

## Output

Write result to `docs/ops/inbox/integrator.md`.

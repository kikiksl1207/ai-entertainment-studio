# RV-001 - Review Backstage / Creator Studio Work

Owner: Reviewer
Status: waiting
Area: Review

## Goal

Review Builder A/B work for regressions, missing tests, secrets exposure, and acceptance criteria.

## Read

- `docs/ops/agents.md`
- `docs/ops/board.md`
- relevant Builder task files
- Builder inbox notes
- git diffs or commits provided by Leader/Integrator

## Review Focus

- Creator Studio access gate must not regress.
- Settlement conversion UI must not imply instant exchange or immediate wallet credit.
- Backstage diagnostics must not expose secrets.
- API calls must use IDs/settlement keys, not hand-typed slugs.
- Korean labels should not be mojibake or broken.
- Existing `npm.cmd run lint` and `npm.cmd run build` should pass.

## Output

Write findings to `docs/ops/inbox/reviewer.md`.

If there are no issues, say so clearly and list any residual QA risk.

# IN-002 - Integrate Wallet Review And Fan Engagement Loop Outputs

Owner: Integrator
Status: waiting
Priority: P1

## Wait For

- RV-002 review result for wallet adjustment controls.
- BA-002 backend contract/design branch or inbox result.
- BB-002 UI map branch or inbox result.
- RV-003 Reviewer PASS for `origin/team2-backend/fan-engagement-first-pr`.

## Integration Goals

- Do not merge fan engagement implementation until Backend and Frontend agree on
  endpoint names, states, and reward vocabulary.
- Do not merge `origin/team2-backend/fan-engagement-first-pr` until RV-003 returns Reviewer PASS.
- If RV-002 finds a wallet adjustment blocker, prioritize that fix before new
  feature integration.
- Keep `main` deployable.

## Required Final Checks

- `prisma generate` in `server/`
- `npm.cmd run lint` in `server/`
- `npm.cmd run build` in `server/`
- `node --check backstage.js` if Backstage changed
- `git diff --check`

## Backend First PR Merge Gate

After Reviewer PASS only:

1. Pull `origin/team2-backend/fan-engagement-first-pr`.
2. Run `prisma generate` in `server/`.
3. Run `npm.cmd run lint` in `server/`.
4. Run `npm.cmd run build` in `server/`.
5. Inspect migration scope:
   - additive migration only
   - no destructive table/column drops
   - no wallet/settlement schema coupling
   - no production data/secrets
6. Merge only if no blocker remains.

## Result Note

Write result to `docs/ops/inbox/integrator.md` with:

- branches merged
- commits
- changed files
- tests
- residual risks
- next PM decision needed

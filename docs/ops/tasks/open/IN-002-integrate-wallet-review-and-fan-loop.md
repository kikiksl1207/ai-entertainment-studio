# IN-002 - Integrate Wallet Review And Fan Engagement Loop Outputs

Owner: Integrator
Status: waiting
Priority: P1

## Wait For

- RV-002 review result for wallet adjustment controls.
- BA-002 backend contract/design branch or inbox result.
- BB-002 UI map branch or inbox result.

## Integration Goals

- Do not merge fan engagement implementation until Backend and Frontend agree on
  endpoint names, states, and reward vocabulary.
- If RV-002 finds a wallet adjustment blocker, prioritize that fix before new
  feature integration.
- Keep `main` deployable.

## Required Final Checks

- `npm.cmd run lint` in `server/`
- `npm.cmd run build` in `server/`
- `node --check backstage.js` if Backstage changed
- `git diff --check`

## Result Note

Write result to `docs/ops/inbox/integrator.md` with:

- branches merged
- commits
- changed files
- tests
- residual risks
- next PM decision needed

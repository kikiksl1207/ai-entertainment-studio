# Integrator Inbox

Use the standard completion note from `docs/ops/agents.md`.

status: done
task: IN-001 - Integrate Backstage / Creator Studio work
branch/commit: integrator/in-001-backstage-creator-studio / this integration result commit
changed_files:
- backstage.css
- backstage.html
- backstage.js
- creator-studio.html
- docs/ops/inbox/builder-a.md
- docs/ops/inbox/builder-b.md
- docs/ops/inbox/reviewer.md
- docs/ops/inbox/integrator.md
tests:
- git fetch --all --prune
- merged origin/builder-a-backend/ba-001-contract-check
- merged origin/builder-b-frontend
- merged origin/reviewer/rv-001-review
- server: npm.cmd run lint
- server: npm.cmd run build
result:
- Integrated Builder A backend contract note, Builder B Backstage / Creator Studio frontend work, and Reviewer RV-001 review notes on top of latest main.
- Merge completed without conflicts.
- Reviewer's P2 R2 endpoint diagnostics finding is included as resolved in origin/builder-b-frontend before integration.
- server lint passed.
- server build passed and generated Prisma Client successfully.
- Build emitted the existing Prisma warning that package.json#prisma is deprecated for Prisma 7 migration; no build failure.
blocked_by:
- none
next_needed:
- Open integration PR / merge review for integrator/in-001-backstage-creator-studio.
- Browser QA still needed with authorized Backstage and Creator Studio accounts against the deployed API.

---

status: done
task: Fan engagement BA/BB contract reconciliation
branch/commit: team2-qa/backstage-wallet-adjustment-qa / this reconciliation commit
changed_files:
- docs/ops/fan-engagement-reconciled-contract.md
- docs/ops/inbox/integrator.md
- docs/ops/inbox/builder-a.md
- docs/ops/inbox/builder-b.md
- docs/ops/tasks/open/BA-002-fan-engagement-loop-backend-contract.md
- docs/ops/tasks/open/BB-002-fan-engagement-loop-ui-map.md
tests:
- git diff --check
result:
- Reconciled BA-002 and BB-002 endpoint naming, request/response shapes, achievements/points/title summary, Creator Studio task aggregation, and i18n policy.
- Canonical contract is `docs/ops/fan-engagement-reconciled-contract.md`.
- Mission list uses `GET /api/v1/fan-engagement/missions?surface=&artistId=&scope=today&take=20`.
- Mission completion uses `POST /api/v1/fan-engagement/missions/:missionId/participations`.
- Concept vote submission uses `POST /api/v1/fan-engagement/concept-votes/:voteId/ballots` with `optionId` in the body.
- MyPage fan rewards use `GET /api/v1/me/fan-engagement/summary`; public profile uses `GET /api/v1/users/:userId/fan-engagement/public-summary`.
- Backend must provide stable label keys and may provide localized Korean labels; frontend must not render raw English enum/user-facing copy.
blocked_by:
- none for contract reconciliation.
next_needed:
- Builder A can use the canonical contract for backend design/implementation planning.
- Builder B can update UI map/skeleton assumptions against the canonical endpoints.
- Reviewer should verify i18n fallback and non-cash reward wording before implementation rollout.

---

status: issued
task: Split fan engagement implementation planning into BA-003 and BB-003
branch/commit: team2-qa/backstage-wallet-adjustment-qa / this task split commit
changed_files:
- docs/ops/board.md
- docs/ops/tasks/open/BA-003-fan-engagement-backend-implementation-plan.md
- docs/ops/tasks/open/BB-003-fan-engagement-frontend-implementation-map.md
- docs/ops/tasks/closed/BA-002-fan-engagement-loop-backend-contract.md
- docs/ops/tasks/closed/BB-002-fan-engagement-loop-ui-map.md
- docs/ops/inbox/integrator.md
tests:
- git diff --check
result:
- BA-002 and BB-002 are closed as contract/map tasks.
- BA-003 now owns backend implementation planning only.
- BB-003 now owns frontend implementation mapping only.
- Both tasks preserve the reconciled contract and explicitly forbid code implementation, DB migration, endpoint renaming, wallet/settlement/revenue UI, and secret recording.
blocked_by:
- none
next_needed:
- Send BA-003 to Builder A and BB-003 to Builder B.

---

status: locked
task: BB-003 Home read-only/mock teaser first
branch/commit: team2-qa/backstage-wallet-adjustment-qa / this lock commit
changed_files:
- docs/ops/tasks/open/BB-003-fan-engagement-frontend-implementation-map.md
- docs/ops/board.md
- docs/ops/inbox/builder-b.md
- docs/ops/inbox/integrator.md
tests:
- git diff --check
result:
- Builder B plan is approved only if the first frontend slice is `index.html` Home read-only/mock teaser.
- Frontend submit/API mutation wiring is locked until Backend First PR is complete and reviewed.
- Disallowed before Backend First PR: mission completion, concept vote ballot, fan proposal submit, title equip, Creator Studio approval/reject/request, and Backstage fan engagement mutation calls.
blocked_by:
- Backend First PR.
next_needed:
- Builder B can proceed with planning under the read-only/mock lock.

---

status: waiting
task: Backend First PR merge gate
branch/commit: team2-qa/backstage-wallet-adjustment-qa / this review-gate commit
changed_files:
- docs/ops/board.md
- docs/ops/tasks/open/RV-003-review-fan-engagement-backend-first-pr.md
- docs/ops/tasks/open/IN-002-integrate-wallet-review-and-fan-loop.md
- docs/ops/inbox/integrator.md
tests:
- git diff --check
result:
- Fan engagement Backend First PR is ready for Reviewer review at `origin/team2-backend/fan-engagement-first-pr` commit `cec520d`.
- Merge is locked until RV-003 returns Reviewer PASS.
- After PASS, Integrator must pull the branch, run `prisma generate`, `npm.cmd run lint`, `npm.cmd run build`, inspect migration scope, and merge only if no blocker remains.
blocked_by:
- RV-003 Reviewer PASS.
next_needed:
- Send RV-003 review task to Reviewer.

---

status: ready
task: RV-003 PASS received - proceed with Backend First merge gate
branch/commit: origin/team2-backend/fan-engagement-first-pr / cec520d0ed14af8132ac1204636f48c45d90ff15
changed_files:
- docs/ops/board.md
- docs/ops/tasks/closed/RV-003-review-fan-engagement-backend-first-pr.md
- docs/ops/tasks/open/BA-004-fan-engagement-error-message-keys.md
- docs/ops/inbox/reviewer.md
- docs/ops/inbox/integrator.md
tests:
- git diff --check
result:
- Reviewer PASS received for Backend First PR.
- No P0/P1 blockers.
- Merge decision: YES.
- P2 follow-up opened as BA-004 for stable fan-engagement error `messageKey` coverage before frontend relies on API error rendering.
blocked_by:
- none
next_needed:
- Merge Backend First PR into main.
- Run `npx.cmd prisma generate`, `npm.cmd run lint`, `npm.cmd run build`, and `git diff --check`.

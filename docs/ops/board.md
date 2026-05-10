# Lumina Stage Ops Board

Updated: 2026-05-10
Leader: Chamo

## Today Focus

Move forward through team work, not one-person rushes. Wallet/cash-like features must be reviewed before we treat them as done. The next product direction is the 1st fan engagement loop from the 20-item PM review: one-tap missions, concept votes, fan one-line proposals, AI draft reactions, Creator Studio today tasks, and achievements/points/titles.

## Active Tasks

| ID | Owner | Status | Task |
| --- | --- | --- | --- |
| IN-005 | Integrator / Operator | open | Provide safe QA environment handoff for fan engagement submit smoke |
| BA-003 | Builder A | open | Prepare backend implementation plan for the reconciled fan engagement contract |
| BB-003 | Builder B | open | Prepare frontend implementation map; Home read-only/mock teaser first, no mutations before Backend First PR |
| IN-002 | Integrator | waiting | Integrate BA/BB/RV outputs after branches are ready |
| QA2-001 | Team2 QA | open | Smoke-test live product flows and report reproducible blockers |
| BE2-001 | Team2 Backend | open | Investigate backend/API causes for QA blockers without touching fan loop design |
| FE2-001 | Team2 Frontend | open | Fix small existing UI/copy bugs from QA without touching new fan loop design |
| R2-001 | Team2 Reviewer | open | Review Team2 QA/bugfix outputs before integration |

## Current Open Product Work From Notion

- #135 Feed image upload real browser retest.
- #140 Settlement profile screen flow confirmation.
- #150 Artist detail follow button label encoding/copy issue.
- #152 Public user profile + feed author mini profile modal.
- #158 S3 upload real retest.
- #164 Public profile cover change UI.
- #165 Creator Studio settlement-to-Lumina request UI.
- PM-20 Fan engagement expansion item review.

## Priority Today

1. Split the reconciled fan engagement contract into backend and frontend implementation plans.
2. Team2 checks current product QA blockers while Team1 plans the next loop.
3. Keep image upload/R2 diagnostics and Creator Studio access from regressing.
4. Run lint/build on any branch that changes backend contracts.
5. Treat mobile layout and localization/mojibake checks as always-on acceptance criteria.
6. Run one safe live wallet adjustment smoke after a safe Backstage admin account and safe QA wallet are available.

## Implementation Locks

- Builder B first frontend slice `index.html` Home read-only/mock teaser passed QA and is closed.
- Home teaser real read-only GET passed QA2-002 and is closed.
- Backend First PR and BA-004 messageKey follow-up are merged.
- Frontend submit/API mutation wiring is still blocked. Phase 3A readiness must
  finish before opening any Phase 3B submit implementation.
- Phase 3A readiness completed with a NO-GO decision for Phase 3B. BA-005 found
  backend hardening gaps and QA2-003 found no safe active QA mission/vote data.
- BA-006 mission submit hardening is merged and deployed at `8c24969`.
- QA2-004 returned partial pass: logged-out `AUTH_REQUIRED` passed, but logged-in
  live mutation was blocked because no safe QA user, active QA mission, or reset
  bucket was available.
- IN-004 closed with a NO-GO decision for Phase 3B and opened BA-007 for safe QA
  user + safe active QA mission/reset bucket preparation.
- BA-007 runbook is merged and closed. It is staging/local only unless Leader
  explicitly approves a dedicated production QA environment; Phase 3B remains
  blocked until the runbook is executed and a logged-in smoke passes.
- BA-007 runbook execution was attempted and blocked because no local/staging
  API, DB access, CLI path, QA credentials, or safe QA mission source was
  available in the session. IN-005 is now required before another logged-in
  submit smoke attempt.
- BB-006 confirmed the frontend plan is ready, but Builder B must wait. Do not
  enable mission participation submit, concept vote ballot submit, fan proposal
  submit, title equip, Creator Studio mutation, Backstage mutation, or
  wallet/settlement/paid-like behavior until a later Phase 3B task explicitly
  opens.
- RV-003 returned Reviewer PASS for `origin/team2-backend/fan-engagement-first-pr`; Integrator may merge only after the required gate checks pass.

## Do Not Do Today

- Do not redesign the whole Backstage.
- Do not start Lumina Red or adult-version work.
- Do not read long Notion pages from Builder tabs.
- Do not change secrets or create `.env` files on shared/borrowed computers.
- Do not open cash-like wallet adjustment to non-super-admin roles.

# Lumina Stage Ops Board

Updated: 2026-05-10
Leader: Chamo

## Today Focus

Move forward through team work, not one-person rushes. Wallet/cash-like features must be reviewed before we treat them as done. The next product direction is the 1st fan engagement loop from the 20-item PM review: one-tap missions, concept votes, fan one-line proposals, AI draft reactions, Creator Studio today tasks, and achievements/points/titles.

## Active Tasks

| ID | Owner | Status | Task |
| --- | --- | --- | --- |
| BA-003 | Builder A | open | Prepare backend implementation plan for the reconciled fan engagement contract |
| BA-004 | Builder A | open | Add stable messageKey coverage for fan engagement error responses |
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

- Builder B may plan the first frontend slice as `index.html` Home read-only/mock teaser only.
- Frontend submit/API mutation wiring is locked until the Backend First PR is complete and reviewed.
- RV-003 returned Reviewer PASS for `origin/team2-backend/fan-engagement-first-pr`; Integrator may merge only after the required gate checks pass.

## Do Not Do Today

- Do not redesign the whole Backstage.
- Do not start Lumina Red or adult-version work.
- Do not read long Notion pages from Builder tabs.
- Do not change secrets or create `.env` files on shared/borrowed computers.
- Do not open cash-like wallet adjustment to non-super-admin roles.

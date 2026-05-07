# Lumina Stage Ops Board

Updated: 2026-05-07
Leader: Chamo

## Today Focus

Move forward through team work, not one-person rushes. Wallet/cash-like features must be reviewed before we treat them as done. The next product direction is the 1st fan engagement loop from the 20-item PM review: one-tap missions, concept votes, fan one-line proposals, AI draft reactions, Creator Studio today tasks, and achievements/points/titles.

## Active Tasks

| ID | Owner | Status | Task |
| --- | --- | --- | --- |
| RV-002 | Reviewer | open | Review wallet adjustment controls already on main (`6e1c720`) before rollout confidence |
| BA-002 | Builder A | open | Design backend contract for the 1st fan engagement loop |
| BB-002 | Builder B | open | Map the 1st fan engagement loop to existing pages and minimal UI surfaces |
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

1. Review wallet adjustment safety before relying on it in production operations.
2. Split the 20-item PM review into an implementable 1st fan engagement loop.
3. Team2 checks current product QA blockers while Team1 designs the next loop.
4. Keep image upload/R2 diagnostics and Creator Studio access from regressing.
5. Run lint/build on any branch that changes backend contracts.

## Do Not Do Today

- Do not redesign the whole Backstage.
- Do not start Lumina Red or adult-version work.
- Do not read long Notion pages from Builder tabs.
- Do not change secrets or create `.env` files on shared/borrowed computers.
- Do not open cash-like wallet adjustment to non-super-admin roles.

# Lumina Stage Ops Board

Updated: 2026-05-07
Leader: Chamo

## Today Focus

Backstage and Creator Studio should move forward without repeating the Creator Studio access blocker pattern. One worker may debug a blocker while others continue independent tasks.

## Active Tasks

| ID | Owner | Status | Task |
| --- | --- | --- | --- |
| BS-001 | Builder B | ready | Connect Backstage object storage diagnostics panel |
| CS-001 | Builder B | ready | Connect Creator Studio settlement conversion request UI |
| BA-001 | Builder A | ready | Verify Backstage/Creator Studio backend contracts and add missing backend notes only if needed |
| RV-001 | Reviewer | waiting | Review Builder A/B diffs against acceptance criteria |
| IN-001 | Integrator | waiting | Integrate finished Builder work and run final verification |

## Current Open Product Work From Notion

- #135 Feed image upload real browser retest.
- #140 Settlement profile screen flow confirmation.
- #150 Artist detail follow button label encoding/copy issue.
- #152 Public user profile + feed author mini profile modal.
- #158 S3 upload real retest.
- #164 Public profile cover change UI.
- #165 Creator Studio settlement-to-Lumina request UI.

## Priority Today

1. Creator Studio settlement conversion request UI (#165).
2. Backstage object storage diagnostics visibility for upload blockers (#135/#158).
3. Regression check that Creator Studio access gate still opens for authorized users.
4. Reviewer/Integrator final lint/build.

## Do Not Do Today

- Do not redesign the whole Backstage.
- Do not start Lumina Red or adult-version work.
- Do not read long Notion pages from Builder tabs.
- Do not change secrets or create `.env` files on shared/borrowed computers.

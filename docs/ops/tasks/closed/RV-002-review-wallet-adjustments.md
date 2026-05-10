# RV-002 - Review Backstage Wallet Adjustment Controls

Owner: Reviewer
Status: closed
Priority: P0

## Context

Commit `6e1c720 Add backstage wallet adjustment controls` is already on `main`.
This was implemented too quickly by Leader, so the team review must be strict.
Treat this as a cash-like operational feature.

## Scope

Review:

- `server/src/admin/admin.controller.ts`
- `server/src/admin/admin.service.ts`
- `backstage.html`
- `backstage.js`
- `backstage.css`

## Acceptance Criteria

- Only super admin / `*` permissions can create wallet adjustments.
- Single adjustment accepts exactly one target.
- Bulk adjustment accepts up to 100 targets.
- Credit creates or uses an active `LUMINA` wallet.
- Debit requires an active wallet and cannot produce negative balance.
- Each adjustment creates a `wallet_ledger` row with `ledgerType = admin_wallet_adjustment`.
- Each adjustment writes an audit event with batch id, direction, amount, reason type, note, and target count.
- Bulk operation is transactional: partial success must not leave mixed balances if one target fails.
- No secrets, tokens, raw credentials, or payment provider data are exposed.
- Backstage confirmation modal clearly shows direction, Lumina amount, target count, and note before execution.
- Empty target / empty note / invalid amount cannot execute successfully.

## Review Output

Write findings first, ordered by severity. Include file/line references.
If no blocking findings, say that clearly and list residual rollout risks.

## Required Checks

- `npm.cmd run lint` in `server/`
- `npm.cmd run build` in `server/`
- `node --check backstage.js`
- `git diff --check origin/main~1..origin/main`

## Closure

Closed on 2026-05-10 after RV-002 re-review.

Resolved:

- P0 wallet debit concurrency: resolved.
- P1 empty-note wallet adjustment execution: resolved.
- Backstage confirmation UI desktop/mobile/narrow: PASS.
- Empty note state does not call the API: PASS.

Caveat:

- Live server mutation and insufficient-balance debit smoke were not executed because this session did not have a safe Backstage admin account and safe QA wallet.
- Before production reliance, run one live smoke with a safe QA wallet: direct note credit/debit, insufficient-balance debit failure, and no negative balance.

No secrets or sensitive values were recorded. No real wallet adjustment was executed during review.

## Do Not

- Do not change code unless the finding is tiny and safe to patch.
- Do not add test data to production.
- Do not modify `.env` or secrets.

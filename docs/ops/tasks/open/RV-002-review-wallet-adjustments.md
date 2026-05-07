# RV-002 - Review Backstage Wallet Adjustment Controls

Owner: Reviewer
Status: open
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

## Do Not

- Do not change code unless the finding is tiny and safe to patch.
- Do not add test data to production.
- Do not modify `.env` or secrets.

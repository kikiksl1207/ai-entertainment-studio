# Story Work Purchase Correctness (#1837)

Scope: purchase/access projection only. No route, economics, provider activation,
payment gateway, module wiring, or production deployment changes. This does not
activate paid AI generation. The earlier provider candidate/dependencies remain
frozen separately.

## Frontend contract (#1841)

`GET /me/stories/:workId/access` returns `access.purchaseConfirmation` for a paid,
unowned work. Work-level catalog/detail access projections expose the same object.
Free/owned access has `purchaseConfirmation: null`; part projections do not quote
a work purchase. `releaseRevision` means **StoryWork.releaseRevision**, not the
release's version. Decimal values are strings, never floating-point numbers.

```json
{
  "priceLumina": "120.5",
  "releaseId": "00000000-0000-4000-8000-000000000030",
  "releaseRevision": 3
}
```

After displaying the quote and receiving purchase consent, send
`POST /stories/:workId/purchase` with the existing `Idempotency-Key` header:

```json
{
  "confirmedPriceLumina": "120.5",
  "expectedReleaseId": "00000000-0000-4000-8000-000000000030",
  "expectedReleaseRevision": 3
}
```

- New paid debit without all three fields: HTTP 409,
  `STORY_PURCHASE_CONFIRMATION_REQUIRED`, `walletMutation: false`.
- Changed price, release ID/revision, offline/future publication, unsafe fixture,
  or inactive release: HTTP 409, `STORY_PURCHASE_CONFIRMATION_STALE`,
  `walletMutation: false`. Refresh access and obtain consent again; do not
  automatically confirm the replacement price. Unknown work remains HTTP 404.
- DTO rejects malformed supplied fields with HTTP 400; an omitted body is valid
  for the no-charge paths. Idempotency-Key is still required for every request.
- Free/currently owned/valid original-key replay needs no body and no debit.
- Existing `entitled`, `charged`, `idempotentReplay` fields remain. For compatibility,
  free/already-owned results also keep `idempotentReplay: true`.
- `chargedAmountLumina` is the debit **in this request**, or `"0"` on every
  no-charge path. An actual ledger replay additionally has
  `originalPurchaseAmountLumina` from the saved ledger, unaffected by current price.
- `outcome`: `purchased`, `already_entitled`, `free`, `replayed`, or
  `entitlement_inactive`. Expired/revoked/future/missing grants on an old key return
  `entitled: false`, `charged: false`, `outcome: entitlement_inactive`. They do not
  silently regrant or charge. A fresh key plus fresh confirmation can purchase
  again. A valid active grant determines ownership, not mere existence of a row.

## Transaction boundary

All purchase checks use the transaction, with this lock order:

1. Transaction advisory lock on the global namespaced idempotency key.
2. Buyer user row `FOR NO KEY UPDATE` (must be active, not deleted).
3. Work row `FOR SHARE`; then any matching work-entitlement row `FOR UPDATE`.
4. For a new purchase, active release row `FOR SHARE`.
5. For a new paid debit, buyer LUMINA wallet row `FOR UPDATE`.

The buyer lock serializes different keys, including when no entitlement exists.
Work/release locks prevent price/publication changes during debit validation.
The global key lock lets foreign-owner collisions return the existing idempotency
conflict rather than a unique-key error. Replay verifies wallet owner/currency,
debit direction, story purchase/reference type, work ID, and a positive saved
amount. It does not compare today's price or the supplied replacement quote.
The wallet debit also requires active status and sufficient balance atomically.
Debit, immutable ledger insertion, and grant upsert commit or roll back together.
The implementation does not retry a failed transaction automatically.

No-charge replay can return the historical claim while a work is offline;
`entitled` is ownership, not a promise of public availability. Reader access still
applies publication availability checks. No balance/key/payload logging is added.

## Migration and verification

Apply `20260922170000_story_purchase_check_types` before enabling this purchase
contract. It extends the **existing** CHECK expressions with `story_purchase`
(wallet ledger) and `story_work` (entitlements), preserving all previous accepted
types and unrelated CHECK/FK constraints. Missing expected constraints fail the
migration instead of silently installing a permissive replacement. No Prisma
model change or new ledger fields.

Tests require an explicitly supplied `STORY_PURCHASE_TEST_DATABASE_URL` and refuse
anything except the isolated loopback purchase QA database. Do not point tests at
the activation/provider database. All users, works, balances, and grants are
synthetic. Real FK/CHECK triggers remain active throughout tests. The FK rollback
case temporarily installs a test-only trigger, removed in `finally`.

Run one bounded suite at a time with own generated Prisma client:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/story-production/story-purchase-contract.spec.ts
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/story-production/story-production.service.spec.ts
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/story-production/story-purchase.postgres.spec.ts
```

The PG suite uses two independent service connections and an observed lock barrier
for simultaneous same-key/different-key requests. It covers stale price/release/
offline state, active/free access, expired/revoked/future/missing grants, foreign
key ownership and debit/reference binding, wallet balance/status, transactional
FK failure rollback, and all historical CHECK types. No live wallets or API calls.

Remaining integration: PM applies migration/reviews shared service hunks; frontend
#1841 consumes the confirmation contract. Independent QA and full integration
checks remain required. No push/deploy was performed by this slice.

## Candidate verification (2026-09-22)

- Own physical dependencies: `npm ci --ignore-scripts --no-audit --no-fund`, exit 0.
  Frozen provider dependencies were not modified.
- Own Prisma client v6.19.3: generate exit 0. Fresh isolated purchase QA database:
  all 59 migrations (including the new CHECK migration) deployed, exit 0.
- Contract suite: 12/12 passed, 60.963 seconds.
- Existing story production service suite: 15/15 passed, 13.225 seconds.
- Actual PostgreSQL purchase suite: 33/33 passed, 23.636 seconds.
- Total: 60 passed, 0 failed, 0 skipped; suites run sequentially with `--runInBand`.
  No full build/tsc or broad suite run in this slice; PM owns integration checks.

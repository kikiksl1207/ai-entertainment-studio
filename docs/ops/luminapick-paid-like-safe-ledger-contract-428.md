# #428 Lumina Pick Paid-Like Safe Ledger QA Contract

Date: 2026-05-24
Owner: Kaido
Scope: Lumina Pick free-like, paid-like, wallet debit, ledger, settlement/refund QA readiness.

## Decision

Paid-like live QA remains NO-GO until Leader provides a dedicated safe QA user,
minimal disposable Lumina balance, an active campaign/product/artist target, and
explicit approval to execute one wallet debit.

The server contract can be verified read-only or with local/staging fixtures
before live mutation:

- Free-like and paid-like are separated by `artist_boost_events.boost_type`.
- Free-like is `free_like` and must not create a wallet ledger.
- Paid-like is `lumina_boost` with `metadata.source = "paid_like"` and must be
  linked to one `wallet_ledger` debit.
- Paid-like price is server-derived from the active `BOOST_BASIC_VOTE` product.
- Client price, balance, settlement, refund, or wallet ledger ids are not trusted.
- Payment provider orders are not created by paid-like submit. A prior Lumina
  charge order may have funded the wallet, but the paid-like action itself is a
  wallet spend plus boost event.

## Server Sources Checked

- `server/src/boosts/boosts.controller.ts`
- `server/src/boosts/boosts.service.ts`
- `server/src/boosts/boosts.service.spec.ts`
- `server/prisma/schema.prisma`
- `server/src/wallet/wallet-server-authority-policy.ts`
- `docs/frontend-api-handoff.md`
- `docs/backend-api-spec.md`
- `docs/app-web-lumina-tamper-defense-checklist.md`
- `docs/backend-db-erd-review.md`
- Notion #418 and #420 QA records

## Free-Like Contract

Endpoint:

- `POST /api/v1/boost-campaigns/:campaignId/free-like`

Required conditions:

- Authenticated user.
- Active boost campaign by `campaignId`.
- Active artist resolved by `artistId` or `artistSlug`.
- Daily free-like limit is controlled by `boost_campaigns.daily_free_like_limit`.

Expected mutation:

- Create one `artist_boost_events` row.
- `boost_type = "free_like"`.
- `raw_amount = 1`.
- `weighted_score = campaign.free_like_weight`.
- `boost_product_id = null`.
- `wallet_ledger_id = null`.
- No `wallet_accounts.cached_balance` change.
- No `wallet_ledger` row.
- No payment order, settlement, payout, or refund mutation.

QA state separation:

- Free-like consumed state is read from free-like events/quota, not from paid-like
  events.
- A user who has consumed free-like for the day may still open paid-like if the
  paid-like quota, wallet, campaign, artist, and product checks pass.

Known response caveat:

- Some free-like failures still use legacy raw messages, for example daily limit
  failure. This task does not change responses; it only defines safe QA criteria.

## Paid-Like Contract

Endpoint:

- `POST /api/v1/boost-campaigns/:campaignId/paid-like`

Required conditions:

- Authenticated user.
- `Idempotency-Key` header or body `idempotencyKey`.
- Active boost campaign by `campaignId`.
- Active artist resolved by `artistId` or `artistSlug`.
- Active `BOOST_BASIC_VOTE` boost product.
- `quantity` integer from 1 to 20.
- Daily paid-like usage plus requested quantity must be at most 20.
- Active `LUMINA` wallet with sufficient server balance.

Server authority:

- Unit price comes from `boost_products.price_lumina`.
- Unit boost amount comes from `boost_products.boost_amount`.
- Total wallet debit is `price_lumina * quantity`.
- Client-submitted price, balance, discount, settlement share, refund amount, or
  wallet ledger id must be ignored.

Expected mutation in one DB transaction:

- Atomic wallet debit through `walletAccount.updateMany`.
- Balance guard: `cachedBalance >= totalPriceLumina`.
- Create one `wallet_ledger` row:
  - `direction = "debit"`
  - `ledger_type = "boost_spend"`
  - `reference_type = "boost_product"`
  - `reference_id = BOOST_BASIC_VOTE product id`
  - `idempotency_key = "wallet:boost-paid-like:<client-key>"`
- Create one `artist_boost_events` row:
  - `boost_type = "lumina_boost"`
  - `boost_product_id = BOOST_BASIC_VOTE product id`
  - `wallet_ledger_id = created ledger id`
  - `metadata.source = "paid_like"`
  - `metadata.quantity = requested quantity`
  - `raw_amount = total boost amount`
  - `weighted_score = total boost amount * campaign.lumina_boost_weight`

Idempotency:

- Missing idempotency key fails before wallet lookup or wallet mutation.
- Same key and same body replays the existing event without another wallet debit.
- Same key and different user/campaign/artist/product/quantity/source fails with
  `BOOST_IDEMPOTENCY_CONFLICT` and no wallet mutation.

Race-condition guard:

- Concurrent debit safety depends on `walletAccount.updateMany` with
  `cachedBalance >= totalPriceLumina`.
- If the guard updates zero rows, the request fails and no ledger/event should be
  created.

## Order, Settlement, Refund Boundaries

Order:

- Paid-like submit does not create `payment_orders`.
- `payment_orders` are charge/provider order records for Lumina top-up.
- QA should not expect a new payment order from paid-like.

Settlement:

- Free-like is not settlement eligible.
- Paid-like boost events may be included in settlement previews as a creator
  revenue candidate.
- Settlement preview is read-only and not final payout.
- Final settlement/payout mutation is outside this task and must not be executed
  during paid-like QA.

Refund:

- No paid-like refund path is approved by this task.
- Do not execute wallet credit, refund, settlement reversal, or payout mutation
  without a separate approved refund policy task.
- If a future refund path is approved, it must be server-side, idempotent, ledger
  backed, and must update settlement eligibility consistently.

## Read-Only QA Matrix

Allowed without live wallet mutation:

- `GET /api/v1/boost-campaigns/current`
- `GET /api/v1/boost-campaigns/:campaignId/rankings`
- `GET /api/v1/boost-products`
- `GET /api/v1/me/free-like-quota`
- `GET /api/v1/me/paid-like-quota`
- `GET /api/v1/me/boost-events`
- Static code/spec checks for the transaction and idempotency rules above.

Read-only PASS criteria:

- Active campaign is visible.
- `BOOST_BASIC_VOTE` is active and has a server price.
- Quota endpoints show remaining values without trusting local storage.
- Ranking rows keep free-like and Lumina boost totals separated.
- Existing user boost events distinguish `free_like` from
  `lumina_boost`/`metadata.source = "paid_like"`.

## Approved Live Smoke Preconditions

Do not run live mutation until all are true:

- Leader explicitly approves one paid-like debit smoke.
- Dedicated QA user is used; no real user account.
- QA wallet is active and has only minimal disposable Lumina balance.
- Active campaign id/slug is provided.
- Active artist id/slug is provided.
- Active `BOOST_BASIC_VOTE` product is confirmed.
- Test quantity is `1`.
- A unique idempotency key plan is prepared but not written into public docs.
- Pre-check snapshots can be captured without exposing token, cookie, DB URL,
  raw response body, signed URL, or credential values.

Minimal live smoke:

1. Read free-like quota and paid-like quota.
2. Submit free-like once for the QA artist, if free-like quota allows it.
3. Confirm free-like event exists and wallet balance/ledger did not change.
4. Submit paid-like once with quantity `1`.
5. Confirm exactly one wallet debit ledger and exactly one paid-like boost event.
6. Replay the same idempotency key/body.
7. Confirm no second debit and no second event.
8. Try same idempotency key with a different body only if approved.
9. Confirm conflict and no wallet mutation.
10. Refresh rankings and quota.

Live smoke PASS criteria:

- Free-like remains recorded as `free_like`.
- Paid-like is recorded as `lumina_boost` with `metadata.source = "paid_like"`.
- Paid-like creates exactly one wallet debit ledger for the first submit.
- Idempotent replay creates no duplicate debit/event.
- Conflict path creates no debit/event.
- Wallet balance decreases only by server product price times quantity.
- No payment order is created by paid-like submit.
- Settlement and refund mutation count is zero.

## External Operator Steps

If Leader wants live QA, the operator should provide only non-secret handles:

1. Pick or create a dedicated QA account and confirm it is not a real user.
2. Confirm the QA wallet is active and funded with minimal disposable Lumina.
3. Confirm the campaign, artist, and `BOOST_BASIC_VOTE` product are active.
4. Confirm the maximum allowed mutation is one quantity-1 paid-like debit plus
   approved idempotency replay checks.
5. Record only sanitized ids/slugs, statuses, HTTP statuses, stable codes, and
   ledger/event counts.

## Blockers Before Treating Paid-Like QA as Done

- No safe QA user, wallet balance, campaign, artist, and approval were provided
  in this session.
- No live wallet debit, settlement, refund, or payment order mutation was run.
- Refund criteria remain policy-only until a dedicated refund task exists.
- Free-like legacy error response copy may need a later stable `code/messageKey`
  hardening task before frontend error rendering depends on it.

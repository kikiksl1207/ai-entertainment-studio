# App And Web Lumina Tamper Defense Checklist

Updated: 2026-05-20
Owner: Kaido
Task: Notion #334

This checklist verifies the server-authority rule for modified apps, browser
console edits, offline replays, and client-side Lumina display manipulation.
Any Lumina that is not backed by the server wallet ledger is fake and cannot be
spent, refunded, donated, settled, or converted.

## Rule

- Clients never submit authoritative `balanceLumina`, `cachedBalance`,
  `priceLumina`, `paidAmount`, `amountLumina`, `refundRate`,
  `settlementShare`, `walletLedgerId`, or provider success state.
- Paid mutations resolve price, ownership, wallet, policy, provider
  verification, refund rate, and settlement eligibility on the backend.
- Every enabled wallet debit must require an idempotency key before wallet
  mutation and use an atomic non-negative wallet update.
- Every purchase credit must be based on a server-verified provider transaction
  id, not app/web success redirects.
- App integrity signals can raise or lower risk, but never credit Lumina by
  themselves.

## Surface Review

| Surface | Active mutation | Server authority | Double-spend guard | Status |
| --- | --- | --- | --- | --- |
| Wallet balance read | No | `wallet_accounts.cached_balance` | Read-only | OK |
| Paid like / boost | Yes | Server campaign/product + wallet balance | Idempotency + conditional wallet debit | OK |
| Chat feature order | Yes | `chat_feature_products.price_lumina` + wallet balance | `chat_feature_orders.idempotency_key` + ledger key | OK |
| Premium chat room/support | No | Server contract only | Mutation blocked until storage/migration | OK blocked |
| Premium video unlock | Yes | `premium_video_products.price_lumina` + wallet balance | Unlock uniqueness + ledger idempotency | OK |
| Gifts / fan letters / user gifts | Yes | Server product/transfer policy + wallet balance | Domain idempotency + conditional wallet debit | OK |
| Charge purchase credit | Yes | Server product table + provider verification | Provider transaction dedupe | OK |
| Refund/reversal | Server-only | Existing order/ledger + refund policy | Server refund key | OK |

## Endpoint Notes

- `POST /api/v1/chat-feature-orders` reads `chat_feature_products` for price and
  writes `wallet_ledger` inside a transaction. Reusing an idempotency key for a
  different session/product fails before wallet mutation.
- Premium chat room open and support donation endpoints remain disabled. The
  read-only contract explicitly says `walletMutationEnabled=false` for current
  state.
- Premium chat conversation meter and support point ledger sections are also
  disabled contract hints. App/web clients cannot submit authoritative message
  counts, remaining units, point amounts, or ranking scores, and support points
  must not be displayed as Lumina or fan engagement points.
- Provider checkout/webhook flows must keep provider tokens, signed payloads,
  secrets, and raw callback data out of docs, Notion, and application logs.
- Offline or replayed app/web paid actions must be treated as display-only until
  the online backend mutation confirms an idempotent server result.

## Required Regression Coverage

- Wallet policy test covers all reviewed app/web tamper surfaces with
  `clientEconomicFieldsTrusted=false`.
- Wallet policy test reserves premium chat room open/refund ledger sources.
- Chat premium support contract test confirms room-open tiers, disabled
  mutation state, 3-day base duration, 10-day artist extension cap, 24-hour
  no-answer refund, user-fault partial refund rates, report/blind pending
  review behavior, disabled conversation metering, and non-cash support point
  ledger separation.

## Remaining Open Work

- Add real premium chat room storage and mutation tests before opening room
  creation.
- Add ledger type migration for future premium chat room open ledger writes.
- Add premium chat conversation meter and support point ledger storage before
  enabling message activity or ranking materialization.
- Run live QA only with safe test wallets and no production balance mutation
  unless explicitly approved.

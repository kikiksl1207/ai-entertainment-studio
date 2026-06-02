# App And Web Lumina Tamper Defense Checklist

Updated: 2026-06-02
Owner: Kaido
Task: Notion #365, #377, #404, pm-board #594

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
- Local test wallet grants are blocked in production and require an idempotency
  key before wallet creation or credit even when non-production explicitly
  enables them.
- App integrity signals can raise or lower risk, but never credit Lumina by
  themselves.

## #404 Threat Model

| Threat | Tampered client claim | Server gate | Required outcome |
| --- | --- | --- | --- |
| Local Lumina display/cache tamper | `balanceLumina`, `cachedBalance`, fake bonus badge | `wallet_accounts.cached_balance` + `wallet_ledger` | Ignore client value; spend/refund/settlement uses server ledger only. |
| Fake app payment success | success redirect, `providerResult`, local receipt flag | Server-verified provider transaction | No Lumina credit until provider verification creates or replays a server transaction. |
| Offline replay / duplicate retry | queued paid action, same key changed body | user-scoped idempotency key + request fingerprint | Same fingerprint replays; mismatch returns a stable conflict before wallet lookup. |
| Amount or SKU tamper | `priceLumina=0`, altered `amountLumina`, rogue `sku`/`productSku` | server product catalog and domain policy | Reject or normalize from server policy; never use client amount as authority. |
| Refund / settlement tamper | client `refundRate`, `settlementShare`, `walletLedgerId` | existing order, ledger, refund policy, moderation outcome | Ignore client rate/share/id; server decides any credit/accounting entry. |

## Risk Log Contract

Risk logs and audit projections may record sanitized decision context only:

- required: request id, user id, session/action id, surface, idempotency scope,
  request fingerprint hash, server amount, decision, and reason code.
- optional: provider name, provider transaction id, server product id, and
  coarse risk signals.
- forbidden: raw idempotency key, raw purchase token, raw provider payload, raw
  app integrity payload, cookie, password, DB URL, signed URL, provider secret,
  or full provider callback body.
- Client-submitted economic fields are never stored as authority in logs,
  ledger rows, or replay decisions.

## Surface Review

| Surface | Active mutation | Server authority | Double-spend guard | Status |
| --- | --- | --- | --- | --- |
| Wallet balance read | No | `wallet_accounts.cached_balance` | Read-only | OK |
| Paid like / boost | Yes | Server campaign/product + wallet balance | Idempotency + conditional wallet debit | OK |
| Chat feature order | Yes | `chat_feature_products.price_lumina` + wallet balance | `chat_feature_orders.idempotency_key` + ledger key | OK |
| Premium chat room/support | No | Server contract only | Mutation blocked until storage/migration | OK blocked |
| Premium video unlock | Yes | `premium_video_products.price_lumina` + wallet balance | Unlock uniqueness + ledger idempotency | OK |
| Gifts / fan letters / user gifts | Yes | Server product/transfer policy + wallet balance | Domain idempotency + conditional wallet debit | OK |
| Charge purchase credit | Yes | Server product table + provider verification | Payment-order replay scope + provider transaction dedupe | OK |
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
- Payment order idempotency replay is valid only for the same user, Lumina
  product, and provider. Reusing the same idempotency key for a different body
  returns a stable conflict before a new order or checkout payload is created.
- Payment webhook persistence stores a sanitized audit projection containing
  provider, order number, provider transaction id, status, and amount only. Raw
  provider webhook payloads, tokens, cookies, signed payloads, card data, and
  secrets must not be stored or copied to Notion.
- Offline or replayed app/web paid actions must be treated as display-only until
  the online backend mutation confirms an idempotent server result.
- Gift order regression coverage now sends fake client `balanceLumina`,
  `cachedBalance`, `priceLumina`, and `amountLumina` fields and verifies the
  debit still uses the server gift product price plus the server wallet balance
  condition.

## Required Regression Coverage

- Wallet policy test covers all reviewed app/web tamper surfaces with
  `clientEconomicFieldsTrusted=false`.
- Wallet policy test requires every active wallet mutation surface to declare a
  server authority source, an idempotency or provider transaction key, and a
  double-spend guard. Read-only surfaces remain explicitly non-mutating.
- Wallet policy test covers the #404 threat model, risk log forbidden fields,
  and provider-secret-free minimum test matrix.
- Wallet paid-action tests cover ignored client economic fields, insufficient
  balance fail-closed behavior, and same-key gift order replay without another
  debit.
- Wallet service tests cover production-disabled local grants, required
  idempotency before wallet creation, same-key replay, and amount-mismatch
  conflict for local test grants.
- Wallet policy test reserves premium chat room open/refund ledger sources.
- Chat premium support contract test confirms room-open tiers, disabled
  mutation state, 3-day base duration, 10-day artist extension cap, 24-hour
  no-answer refund, user-fault partial refund rates, report/blind pending
  review behavior, disabled conversation metering, and non-cash support point
  ledger separation.
- Payment tests cover canonical SKU/product filtering, same idempotency key
  mismatch, sanitized provider audit payloads, duplicate webhook replay, and
  no wallet credit for non-canonical charge products.

## Minimum Provider-Free Test Matrix

| Case | Input shape | Expected server behavior |
| --- | --- | --- |
| client balance tamper | high `balanceLumina` / `cachedBalance` | Debit path still uses server wallet row and conditional balance update. |
| fake payment success | client success flag or forged provider result | No credit without provider adapter verification and provider transaction id. |
| same-key same-body retry | same user/action/idempotency fingerprint | Return stored projection with no duplicate ledger. |
| same-key changed-body retry | same idempotency key with changed amount/product/session | Stable conflict before wallet lookup or provider checkout creation. |
| SKU / amount tamper | rogue SKU, price zero, oversized amount | Reject or use canonical server product/policy amount only. |

## Remaining Open Work

- Add real premium chat room storage and mutation tests before opening room
  creation.
- Add ledger type migration for future premium chat room open ledger writes.
- Add premium chat conversation meter and support point ledger storage before
  enabling message activity or ranking materialization.
- Run live QA only with safe test wallets and no production balance mutation
  unless explicitly approved.

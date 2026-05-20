# Server Authority Ledger Contract

Updated: 2026-05-20
Owner: Kaido
Task: Notion #327

This contract exists to keep Lumina balances, paid actions, purchase credits,
refunds, and creator-facing revenue signals server-authoritative. A modified
client or black-market app can change local display values, but it must not be
able to spend, charge, vote, donate, refund, or settle Lumina unless the backend
has verified and written the corresponding server ledger state.

## Non-Negotiable Rules

1. Clients never submit authoritative balance, price, refund, or settlement
   amounts.
2. Every wallet-affecting mutation reads the server wallet account and writes
   `wallet_ledger` inside a backend transaction.
3. Every debit must fail closed unless the DB update can enforce
   `cached_balance >= amount` atomically.
4. Every wallet-affecting mutation requires an idempotency key, provider
   transaction id, or server-generated transaction key before mutation.
5. Replaying the same idempotency key with the same request returns the original
   result. Reusing it with a different body fails before wallet mutation.
6. Purchase credits are granted only after server-side provider verification.
7. Play Integrity, App Attest, and DeviceCheck are advisory risk signals. They
   never replace ledger checks or provider purchase verification.
8. Offline paid actions are not allowed. Queueing is display-only until the
   server confirms a mutation online.
9. High-value charge, donation, and transfer flows must pass account trust,
   identity, daily/monthly limits, and risk review gates before ledger mutation.
10. Logs, docs, audit events, and Notion updates must not contain raw purchase
    tokens, signed transactions, cookies, passwords, DB URLs, API keys, or full
    app integrity payloads.

## Server Ledger Sources

| Source | Direction | Ledger type | Authority | Idempotency |
| --- | --- | --- | --- | --- |
| Payment purchase credit | credit | `purchase` | provider-verified purchase | provider transaction id |
| First charge bonus | credit | `first_charge_bonus` | server-derived bonus rule | user-scoped once key |
| Gift order | debit | `gift_spend` | server wallet balance | client idempotency key |
| Paid like / boost | debit | `boost_spend` | server wallet balance | client idempotency key |
| Premium video unlock | debit | `premium_video_spend` | server wallet balance | client idempotency key |
| Character chat paid feature | debit | `chat_feature_spend` | server wallet balance | client idempotency key |
| Premium chat donation | debit | `premium_chat_donation` | server wallet balance | client idempotency key |
| Fan letter | debit | `fan_letter_spend` | server wallet balance | client idempotency key |
| User gift send | debit | `user_gift_send` | server wallet balance | client idempotency key |
| User gift receive | credit | `user_gift_receive` | paired server transfer | same transfer key |
| Generation failure reversal | credit | `refund` | server failure recovery | server order refund key |
| Admin wallet adjustment | credit/debit | `admin_wallet_adjustment` | super-admin audited operation | server batch key |

`premium_chat_donation` is reserved as the ledger/source name for future
premium chat donations. It must follow the same debit rules as other paid
actions before any UI is opened.

## Paid Action Debit Pattern

Required backend order:

1. Authenticate the user and resolve server-owned product/action records.
2. Normalize and require the idempotency key before product lookup or wallet
   mutation where possible.
3. Check existing order/event/ledger by idempotency key.
4. If found, compare the stored request fingerprint with the new request.
5. Reject mismatches before wallet mutation.
6. Fetch active `wallet_accounts` row for `user_id + LUMINA`.
7. Perform conditional DB update:
   `UPDATE wallet_accounts SET cached_balance = cached_balance - amount WHERE id = ... AND status = active AND cached_balance >= amount`.
8. If the affected row count is not 1, return insufficient balance and write no
   order/event/ledger.
9. Create `wallet_ledger` and domain order/event in the same transaction.
10. Return only server-derived balances and policy hints.

Existing backend examples:

- `server/src/gifts/gifts.service.ts`
- `server/src/boosts/boosts.service.ts`
- `server/src/premium-videos/premium-videos.service.ts`
- `server/src/chat/chat.service.ts`
- `server/src/fan-letters/fan-letters.service.ts`
- `server/src/user-gifts/user-gifts.service.ts`
- `server/src/admin/admin.service.ts`

## Purchase Credit Verification

### Google Play

The app may send a Google Play purchase token to the backend, but the backend
must verify it through a server-side Google Play Developer API adapter before
crediting Lumina. The provider transaction id is the idempotency authority for
`payment_transactions` and the purchase ledger.

Play Integrity can increase trust or trigger review, but a positive integrity
verdict does not grant Lumina by itself.

### Apple App Store

The app may send a signed transaction or server notification reference to the
backend, but the backend must validate it using App Store Server API or Apple
signed transaction verification before crediting Lumina. The verified
transaction id is the idempotency authority.

App Attest and DeviceCheck are risk signals only. They do not replace purchase
verification or wallet ledger checks.

## Refunds And Reversals

- Provider refunds are tracked separately from wallet refund ledgers.
- Refund-tracking rows do not automatically alter Lumina unless a dedicated
  reversal flow is implemented.
- Technical failure reversals, such as paid chat generation failure, use a
  server-generated refund idempotency key and must credit at most once.
- Chargeback/reversal policy must not rely on client state.

## High-Value Risk Gates

High-value charge, donation, transfer, premium chat, or paid boost flows should
apply:

- account age and email/phone/social trust checks,
- identity verification where required,
- daily and monthly amount limits,
- unusual velocity checks,
- refund/chargeback history checks,
- manual review or delayed settlement when risk is elevated.

These gates can block or hold an action, but passing them does not bypass the
server ledger transaction.

## Test Baseline

The minimum backend test baseline:

- missing idempotency key rejects before wallet lookup or wallet mutation,
- same key + same body replays without a second debit/credit,
- same key + different body rejects before wallet mutation,
- insufficient balance returns fail-closed and creates no domain order/event,
- concurrent debit safety uses an atomic non-negative balance update,
- purchase webhook/provider event is deduped by provider transaction id,
- generation failure refund/reversal is credited at most once,
- premium chat donation source remains explicitly reserved as
  `premium_chat_donation`,
- app integrity signals are advisory and do not grant ledger credit alone.

## Official References

- Google Play Integrity API:
  https://developer.android.com/google/play/integrity/overview
- Google Play Billing security:
  https://developer.android.com/google/play/billing/security
- Google Play Developer API `purchases.products.get`:
  https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/get
- Apple App Attest / DeviceCheck server validation:
  https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server
- Apple App Store Server API:
  https://developer.apple.com/documentation/appstoreserverapi

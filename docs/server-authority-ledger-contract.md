# Server Authority Ledger Contract

Updated: 2026-05-21
Owner: Kaido
Task: Notion #327, #331, #334, #377, #383

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
| Premium chat room open | debit | `premium_chat_open` | server room tier policy + wallet balance | client idempotency key |
| Premium chat donation | debit | `premium_chat_donation` | server wallet balance | client idempotency key |
| Premium chat room refund | credit | `refund` | server refund/moderation outcome | server room refund key |
| Premium chat room company retention | credit | `premium_chat_room_company_revenue` | server refund restriction outcome | server admin decision key |
| Premium chat room artist compensation | credit | `premium_chat_room_artist_compensation` | server refund restriction outcome | server admin decision key |
| Premium chat room policy hold | hold | `premium_chat_room_policy_hold` | unresolved 50% refund restriction remainder | server admin decision key |
| Fan letter | debit | `fan_letter_spend` | server wallet balance | client idempotency key |
| User gift send | debit | `user_gift_send` | server wallet balance | client idempotency key |
| User gift receive | credit | `user_gift_receive` | paired server transfer | same transfer key |
| Generation failure reversal | credit | `refund` | server failure recovery | server order refund key |
| Admin wallet adjustment | credit/debit | `admin_wallet_adjustment` | super-admin audited operation | server batch key |
| Local test grant | credit | `event_grant` | non-production env gate + server amount | required client idempotency key |

`premium_chat_donation` is reserved as the ledger/source name for future
premium chat donations. It must follow the same debit rules as other paid
actions before any UI is opened.

`premium_chat_open` is reserved for future premium chat room open debits. It is
not enabled by default; the DB ledger type migration and room storage must land
before any public mutation can write it.

Premium chat support points are deliberately separate from Lumina wallet ledger
rows and from fan engagement points. The planned
`premium_chat_support_point_ledger` table is non-cash, non-transferable, not
settlement eligible, and not payout eligible. It can later feed premium-chat
communication/donation rankings, but it cannot credit or debit wallet balance.

Premium chat room company retention, artist compensation, and policy hold rows
are planned premium-chat accounting ledgers, not `wallet_ledger` rows. They must
not mutate user wallet balance, settlement, or payout state until a separate
admin-reviewed revenue workflow is implemented.

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

The shared `server/src/common/wallet-mutation-safety.ts` helper owns the
common wallet mutation error contracts for missing idempotency, idempotency
conflict, and insufficient balance. Gift orders, fan letters, premium video
unlocks, and user gifts use the shared insufficient-balance guard after the
atomic `cachedBalance >= amount` update. Boosts, chat feature orders, and admin
wallet adjustments keep equivalent conditional-update guards in their service
paths.

Local test grants are non-production only, must be explicitly enabled by env,
and require an idempotency key before `getOrCreateWallet` can create or mutate
a wallet. Replaying the same local grant key with a different amount is a
conflict and must not create another credit.

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

## Premium Chat Room Open, Refund, And Report Contract

The read-only premium chat contract is documented in
`docs/premium-chat-room-ledger-contract.md` and exposed through
`GET /api/v1/chat/premium-support-contract` under `room`.

Current state:

- `walletMutationEnabled=false`, `settlementMutationEnabled=false`, and
  `payoutMutationEnabled=false`.
- Room-open tiers are 300L, 500L, 1,000L, and 3,000L. The server evaluates any
  follower-based unlock gate; clients cannot unlock a tier by submitting a
  price or follower count.
- Base room duration is 3 days. Artist extension is capped at 10 additional
  days and server-calculated expiry is authoritative.
- If the artist does not answer within 24 hours, the server refund policy can
  credit a 100% refund with a server-generated refund key.
- If the artist force-closes the room outside a normal answered/expired close,
  the server refund policy can move the room through `refund_pending` and credit
  a 100% user refund with a server-generated refund key.
- User-fault closure can restrict the user refund to 70% or 50%. The client
  cannot submit the refund rate, and at least 10% of gross room Lumina remains
  as artist compensation candidate from the non-refunded portion.
- The 70% user-fault outcome records planned accounting entries as 70% user
  refund, 20% company revenue retention, and 10% artist compensation retention.
  The 50% outcome records 50% user refund, 20% company retention, 10% artist
  compensation, and a 20% `premium_chat_room_policy_hold` until PM/admin policy
  resolves the remainder.
- Report intake moves the room into reported/blind/suspended/admin-review
  processing with no wallet action before an admin decision.
- `closed`, `artist_closed`, `expired`, `reported`, `blind`, `suspended`,
  `refund_pending`, `refunded`, and `admin_review` must fail closed before
  message, support, debit, conversation-meter, support-point, settlement, or
  payout mutation.

Before any live room-open mutation is enabled, the backend must add room/report
storage, idempotency replay storage, the `premium_chat_open` ledger type
migration, atomic non-negative wallet debit, duplicate refund protection,
refund restriction accounting storage, and moderation/audit handling.

Before any premium-chat support point or conversation-meter write is enabled,
the backend must add `premium_chat_conversation_meter_ledger` and
`premium_chat_support_point_ledger` storage. Message activity decrements are
server-visible-message events only, and support points are server-derived from
confirmed room open, safe message activity, or confirmed net donation events.
Clients never submit authoritative message counts, remaining units, point
amounts, or ranking scores.

## App And Web Tamper Defense Review

The app/web checklist is documented in
`docs/app-web-lumina-tamper-defense-checklist.md` and mirrored in
`APP_WEB_LUMINA_TAMPER_DEFENSE_CHECKLIST`.

Reviewed surfaces:

- wallet balance reads,
- paid like / boost,
- chat feature products,
- premium chat room/support,
- premium video unlocks,
- gifts, fan letters, and user gifts,
- charge purchase credits,
- refunds and technical reversals.

The common rule is `clientEconomicFieldsTrusted=false`: a modified app or web
client can change local display values, but the server ignores or rejects
client-supplied balance, price, paid amount, refund rate, settlement share,
wallet ledger id, and provider success state. Enabled debit paths still need
idempotency and an atomic non-negative wallet update. Purchase credits still
need provider verification.

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

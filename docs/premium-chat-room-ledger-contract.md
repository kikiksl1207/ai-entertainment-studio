# Premium Chat Room Ledger Contract

Updated: 2026-05-21
Owner: Kaido
Task: Notion #331, #383

This contract fixes the backend authority rules for premium chat room opening,
artist closure, report/blind handling, and refund outcomes. It does not open a
live debit, refund, settlement, or payout mutation.

## Launch State

- Public room-open, donation-create, report, refund, settlement, and payout
  mutations remain disabled until a later implementation task.
- Public PG refund calls and premium-chat accounting ledger writes remain
  disabled. This document only fixes the server contract and test baseline.
- The read-only contract is exposed through
  `GET /api/v1/chat/premium-support-contract` under `room`.
- Clients may render disabled UI from stable keys, but they must not calculate
  or submit authoritative Lumina price, balance, refund rate, room expiry, fee,
  settlement share, or payout values.
- Any future enabled mutation must authenticate the user, resolve the room tier
  and artist unlock state on the server, require an idempotency key before
  wallet lookup, and write room/event/ledger state in one transaction.

## Room Tiers

| Tier key | Amount | Unlock authority |
| --- | ---: | --- |
| `premium_chat_room_300` | 300L | Always server-evaluated, no follower gate. |
| `premium_chat_room_500` | 500L | Server follower policy `premiumChat.roomUnlock.500`. |
| `premium_chat_room_1000` | 1,000L | Server follower policy `premiumChat.roomUnlock.1000`. |
| `premium_chat_room_3000` | 3,000L | Server follower policy `premiumChat.roomUnlock.3000`. |

Follower thresholds are not client input. If thresholds become configurable,
they must live in server policy/admin storage and be returned as display hints
only after the backend has evaluated eligibility.

## Duration

- Base room duration: 3 days.
- Artist extension: max 10 additional days.
- The server calculates `expiresAt`; client-submitted expiry is ignored or
  rejected.
- Repeated extension requests must be idempotent or guarded by a server event
  key so retries cannot extend beyond the allowed cap.

## Ledger And Idempotency

| Flow | Direction | Ledger type | Reference | Idempotency |
| --- | --- | --- | --- | --- |
| Room open | debit | `premium_chat_open` | `premium_chat_room` | client key scoped as `premium-chat-room-open:<artistId>:<client-key>` |
| 24h no-answer refund | credit | `refund` | `premium_chat_room` | server key `premium-chat-room-refund:<roomId>:<reasonKey>` |
| Artist forced close refund | credit | `refund` | `premium_chat_room` | server key `premium-chat-room-refund:<roomId>:<reasonKey>` |
| User-fault partial refund | credit | `refund` | `premium_chat_room` | server admin decision key |
| User-fault company retention | credit | `premium_chat_room_company_revenue` | `premium_chat_room` | server admin decision key |
| User-fault artist compensation | credit | `premium_chat_room_artist_compensation` | `premium_chat_room` | server admin decision key |
| 50% policy remainder hold | hold | `premium_chat_room_policy_hold` | `premium_chat_room` | server admin decision key |
| Report/blind pending review | none | none | report/moderation record | no wallet action before admin decision |

`premium_chat_open` is a reserved future ledger type and still needs a wallet
ledger type migration before the room-open mutation can be enabled. The current
PR only fixes the contract and tests.

## Refund Policy

- If the artist does not answer within 24 hours, the user receives a 100%
  Lumina refund through a server-generated refund key.
- If the artist force-closes the room outside a normal answered/expired close,
  the room moves to `refund_pending` and the base room open cost is a 100%
  user refund candidate. The refund can only be credited through the server
  refund key after the policy decision is recorded.
- If the user is at fault, allowed refund outcomes are 70% or 50%. The client
  cannot submit or override the refund rate.
- For a 70% user-fault refund, the planned accounting split is 70% user Lumina
  refund, 20% company revenue retention, and 10% artist compensation
  retention. Settlement and payout mutation still remain disabled.
- For a 50% user-fault refund, the planned accounting split is 50% user Lumina
  refund, 20% company revenue retention, 10% artist compensation retention,
  and 20% `premium_chat_room_policy_hold`. The hold must stay in admin review
  until PM/admin policy explicitly resolves it; do not turn it into settlement
  or payout by default.
- Artist compensation is a later settlement event candidate only. This contract
  does not create settlement, payout, or revenue-share mutation.
- Duplicate refund attempts must reuse the original refund projection and must
  not create a second credit ledger.

## Closure And Moderation States

| Case | State | Wallet action |
| --- | --- | --- |
| Normal close after answer/expiry | `closed` (`artist_closed` legacy alias) | No automatic refund. |
| Artist forced close | `refund_pending` -> `refunded` | Server policy decides 100% user refund. |
| User-fault 70% close | `refund_pending` -> `refunded` | User refund plus company/artist accounting entries. |
| User-fault 50% close | `refund_pending` -> `admin_review` | User refund plus company/artist accounting entries and policy hold. |
| Operator sanction close | `admin_review` | No artist compensation until review completes. |
| User report | `reported`, `blind`, `suspended`, `admin_review` | No wallet action before admin decision. |

Report intake must blind/suspend the room or mark it processing until admin
review. User-facing responses use stable message keys such as
`chat.premiumRoom.report.processing`; raw internal status strings are not the
only UI copy source.

The following room states fail closed before message, support, debit,
conversation-meter, support-point, settlement, or payout mutation:
`closed`, `artist_closed`, `expired`, `reported`, `blind`, `suspended`,
`refund_pending`, `refunded`, and `admin_review`.

## Open Blockers

- Add DB tables for premium chat rooms, reports, room events, and donation
  projections.
- Add wallet ledger type migration for `premium_chat_open` and any future
  donation/room ledger types.
- Implement room-open preview/create with server tier lookup and atomic
  non-negative wallet debit.
- Implement refund/admin decision workflow with duplicate refund protection.
- Add moderation queue and audit log entries before public reporting is opened.
- Resolve the 50% user-fault remainder policy before settlement or payout is
  enabled. The current v2 contract keeps the remainder in
  `premium_chat_room_policy_hold`.

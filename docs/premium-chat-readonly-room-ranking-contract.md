# Premium Chat Room List and Ranking Read-only Contract

Task: #372, #490

Status: contract ready, read-only models disabled.

## Scope

This contract prepares the premium-chat room list and support ranking surfaces
without opening room creation, donation creation, wallet debit, settlement, or
payout mutation.

The canonical source is
`GET /api/v1/chat/premium-support-contract`.

## Room List

Planned endpoint:

```http
GET /api/v1/chat/premium-rooms?artistSlug=<artist-slug>&take=20
```

Current contract path:

```text
apiContracts.roomList
```

Rules:

- `enabled=false`
- `walletMutation=false`
- `settlementMutation=false`
- `payoutMutation=false`
- public/auth-optional read projection only
- tier amounts must match the room-open contract exactly:
  300L, 500L, 1000L, 3000L
- visible statuses are `opened`, `active`, and `artist_answered`
- reported, blind, suspended, refund-pending, refunded, and admin-review rooms
  are excluded

Allowed projection fields:

- public room id
- safe artist id, slug, display name, and avatar URL
- tier key and amount from server policy
- status label key for UI copy mapping
- opened/expires timestamps and remaining-period summary
- last response status label/message keys
- donation/support availability with public disabled reason/message keys
- viewer CTA state
- public metrics only

Forbidden projection fields:

- wallet ledger id
- support point ledger id
- conversation meter ledger id
- internal admin note
- raw report reason
- raw payload
- raw chat body
- raw user id
- raw room enum strings as display copy
- internal disabled reasons or decision notes

The room detail/status surfaces are exposed through `roomProjection`,
`projections.premiumRoomStatus`, `projections.premiumRoomDetail`, and
`projections.premiumRoomMutationAvailability`. They provide user-visible status
message keys, artist-visible status message keys, lock state, and donation
button state without enabling room, donation, wallet, settlement, payout,
support-point, conversation-meter, report, or refund mutation.

## Rankings

Planned endpoint:

```http
GET /api/v1/chat/rankings?type=communication&period=weekly&take=20
GET /api/v1/chat/rankings?type=donation&period=weekly&take=20
```

Rules:

- `enabled=false`
- `walletMutation=false`
- `type=communication` and `type=donation` only
- no `type=like` alias
- like ranking stays on the Lumina Pick boost lane
- donation ranking uses confirmed net premium-chat donation only
- donation ranking excludes free likes, Lumina boosts, room-open rows,
  message rows, reported room rows, blinded rows, refunded donation rows,
  chargeback donation rows, and cancelled donation rows

Forbidden ranking fields:

- raw chat body
- raw report reason
- wallet ledger id
- user id
- message id

## Mutation Block

This task does not enable:

- room open
- donation create
- wallet debit
- settlement
- payout
- support point ledger writes
- conversation meter writes

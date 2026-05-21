# Premium Chat Support Point Ledger Contract

Updated: 2026-05-21
Owner: Luffy
Task: Notion #363

This contract fixes the v1 server shape for premium chat room entry fees,
conversation activity metering, support points, and communication/donation
rankings. It is read-only contract work. It does not enable room open,
donation, support point, wallet, settlement, or payout mutations.

## Launch State

- `GET /api/v1/chat/premium-support-contract` exposes the contract.
- `walletMutationEnabled=false`, `supportPointLedgerMutationEnabled=false`,
  `conversationMeterMutationEnabled=false`, `settlementMutationEnabled=false`,
  and `payoutMutationEnabled=false`.
- Room-open, donation-create, conversation metering, support point grant,
  ranking materialization, refund, settlement, and payout writes remain blocked
  until storage/migration tasks land.
- Clients may render disabled-state UI from stable message keys, but must not
  submit authoritative price, balance, message count, remaining units, point
  amount, ranking score, refund rate, settlement share, or payout values.

## Room Entry Fee Contract

| Tier key | Amount | Server authority |
| --- | ---: | --- |
| `premium_chat_room_300` | 300L | Base tier, no follower gate. |
| `premium_chat_room_500` | 500L | Server follower policy `premiumChat.roomUnlock.500`. |
| `premium_chat_room_1000` | 1,000L | Server follower policy `premiumChat.roomUnlock.1000`. |
| `premium_chat_room_3000` | 3,000L | Server follower policy `premiumChat.roomUnlock.3000`. |

Future room-open create must require an idempotency key before wallet lookup and
write the room, order/event, and wallet ledger in one transaction. The reserved
wallet ledger type is `premium_chat_open`.

## Conversation Metering Contract

Conversation activity uses a separate planned meter ledger. It is not a Lumina
wallet debit and is not a settlement or payout event.

- Planned table: `premium_chat_conversation_meter_ledger`
- Ledger type: `premium_chat_message`
- Unit: `message_activity_unit`
- Authority: server visible-message events only.
- Idempotency key: `premium-chat-message-meter:<messageId>`
- Duplicate message event: ignore without a second decrement.
- Blinded, suspended, reported, or admin-held rooms: hold or zero-weight until
  admin-safe.
- Remaining units source: `premium_chat_rooms.remaining_message_units`.
- Client-submitted message count or remaining units are never trusted.

## Support Point Ledger

Support points are a premium-chat ranking signal, not Lumina and not fan
engagement points.

- Planned table: `premium_chat_support_point_ledger`
- `cashLike=false`
- `transferable=false`
- `settlementEligible=false`
- `payoutEligible=false`
- `luminaWalletShared=false`
- `fanEngagementPointLedgerShared=false`

Ledger types:

| Ledger type | Direction | Reference | Source |
| --- | --- | --- | --- |
| `premium_chat_room_open_support_point` | credit | `premium_chat_room` | confirmed room open |
| `premium_chat_message_activity_support_point` | credit | `chat_message` | safe visible premium chat message |
| `premium_chat_donation_support_point` | credit | `premium_chat_donation` | confirmed net donation |

Donation support point default scale is one point per confirmed net Lumina.
Room-open and message activity weights remain server policy only. Clients cannot
submit or override point values.

Idempotency uniqueness must include user, artist, reference type, reference id,
and ledger type. Duplicate references replay the existing projection and must
not grant a second point row.

## Ranking Contract

Like ranking remains separate on the boost/Lumina Pick lane.

- Communication ranking:
  `GET /api/v1/chat/rankings?type=communication&period=weekly&take=20`
- Donation ranking:
  `GET /api/v1/chat/rankings?type=donation&period=weekly&take=20`

Communication ranking can read room-open, message-activity, and donation support
point ledger rows after storage exists. Donation ranking can read only
`premium_chat_donation_support_point` rows. Reported, blinded, suspended,
refunded, or chargeback rows are excluded or zero-weighted by moderation policy.

Ranking responses must not expose raw chat bodies, report reasons, wallet ledger
ids, user ids, message ids, or raw score internals. The final score formula is
server-side only.

## Blockers Before Enabling Writes

- Add premium chat room, room event, report, conversation meter, donation order,
  donation event, and support point ledger storage.
- Add wallet ledger type migration for `premium_chat_open` and
  `premium_chat_donation`.
- Add idempotent room-open and donation-create transactions with atomic
  non-negative wallet debits.
- Add server-only refund/admin decision flow with duplicate refund protection.
- Add ranking materialization from server-side support point ledgers only.
- Run QA with safe test wallets before any production-facing mutation.

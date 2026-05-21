# Premium Chat Status Read API Contract

Updated: 2026-05-21
Owner: Luffy
Task: Notion #384

This contract prepares read-only user and artist lookups for premium-chat room
report/refund/closure state. It does not enable room-open, message, donation,
refund, wallet, settlement, payout, or accounting-ledger mutations.

The canonical contract is exposed through:

```http
GET /api/v1/chat/premium-support-contract
```

Current contract paths:

- `apiContracts.userRoomStatus`
- `apiContracts.artistRoomStatus`
- `roomStatusRead`
- `projections.premiumRoomStatus`
- `projections.premiumRoomRefundStatus`
- `projections.premiumRoomReportStatus`
- `projections.premiumRoomMutationAvailability`

## Planned Read Endpoints

User-owned room status:

```http
GET /api/v1/chat/me/premium-rooms/:roomId/status
Authorization: Bearer <accessToken>
```

Artist-owned room status:

```http
GET /api/v1/creator-studio/premium-chat/rooms/:roomId/status
Authorization: Bearer <accessToken>
```

Both endpoints remain `enabled=false` until premium-chat room/report/refund
storage is available. The current backend exposes only the read-only contract
shape through `GET /api/v1/chat/premium-support-contract`.

## Access Rules

| Viewer | User endpoint | Artist endpoint | Result |
| --- | --- | --- | --- |
| Unauthenticated | denied | denied | `401 auth_required` |
| Owner user | allowed | denied | Safe room/refund/report state projection |
| Artist owner | denied | allowed | Safe room/report/force-close availability projection |
| Non-owner user or artist | denied | denied | `403` or safe `404` without identity leakage |

The response must not reveal whether another user's room exists. It must not
return raw internal user ids, reporter ids, admin notes, report reasons, raw
payloads, raw chat bodies, wallet ledger ids, support-point ledger ids,
conversation-meter ledger ids, provider refund ids, tokens, cookies, or DB URLs.

## Status Keys

The read projection currently fixes these safe status keys:

- `active`
- `reported`
- `admin_review`
- `refund_pending`
- `refunded`
- `closed`
- `expired`
- `suspended`

Each status must include a stable Korean-copy label key. Clients must not use
raw status strings as the only user-facing copy.

## Response Shape

```json
{
  "room": "premiumRoomStatus projection",
  "refund": "premiumRoomRefundStatus projection",
  "report": "premiumRoomReportStatus projection",
  "mutationAvailability": "premiumRoomMutationAvailability projection",
  "generatedAt": "<ISO datetime>"
}
```

`premiumRoomStatus` includes only public room id, viewer role, safe artist
projection, server tier summary, status key/label key, and duration timestamps.

`premiumRoomRefundStatus` exposes display-safe refund state, label key,
policy key, amount if safe for the viewer, timestamps, and duplicate replay
behavior. Repeated refund reads must return the same projection and never create
a second credit ledger.

`premiumRoomReportStatus` exposes display-safe report processing state, label
key, timestamps, and duplicate replay behavior. Repeated report reads must
return the same projection and never create another moderation mutation.

`premiumRoomMutationAvailability` is display-only. It reports whether the UI
should keep message, donation, artist-force-close, or refund request affordances
disabled. It does not make any mutation endpoint live.

## Fail-Closed Mutation Policy

The following states keep message/support/donation/refund-related UI disabled
and must block any future mutation before wallet lookup or message acceptance:

- `closed`
- `artist_closed`
- `expired`
- `reported`
- `blind`
- `suspended`
- `refund_pending`
- `refunded`
- `admin_review`

For #384 specifically, `closed`, `reported`, and `refund_pending` were checked
as required examples. They remain fail-closed for support and message mutation.

## Still Blocked

This task does not enable:

- premium room open
- premium room report submit
- artist force-close mutation
- refund create or PG refund call
- premium chat message mutation through this status API
- donation preview or donation create
- wallet debit or wallet refund
- settlement or payout
- premium-chat accounting ledger write

Before enabling the planned read endpoints, the backend still needs premium-chat
room/report/refund storage, safe owner/artist ownership joins, and live
projection tests against seeded disposable data.

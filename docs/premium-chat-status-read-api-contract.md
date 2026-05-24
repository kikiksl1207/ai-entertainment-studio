# Premium Chat Status Read API Contract

Updated: 2026-05-21
Owner: Luffy
Task: Notion #384, #473 room interaction status contract

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
- `roomStatusRead.interactionStatusMatrix`
- `roomStatusRead.unansweredRefundTransition`

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

## Room Interaction Matrix

#473 fixes the read/send/donation availability matrix before live room storage
exists. This matrix is exposed as `roomStatusRead.interactionStatusMatrix`.

| Room status | Read mode | User send | Artist reply | Donation | Ranking/meter |
| --- | --- | --- | --- | --- | --- |
| `opened` | `safe_conversation` | yes | yes | yes | eligible |
| `active` | `safe_conversation` | yes | yes | yes | eligible |
| `artist_answered` | `safe_conversation` | yes | yes | yes | eligible |
| `reported` | `safe_status_only` | no | no | no | excluded |
| `blind` | `safe_status_only` | no | no | no | excluded |
| `suspended` | `safe_status_only` | no | no | no | excluded |
| `admin_review` | `safe_status_only` | no | no | no | excluded |
| `refund_pending` | `safe_status_only` | no | no | no | excluded |
| `refunded` | `safe_archive` | no | no | no | excluded |
| `expired` | `safe_archive` | no | no | no | excluded |
| `closed` | `safe_archive` | no | no | no | excluded |
| `artist_closed` | `safe_archive` | no | no | no | excluded |

The 24-hour no-answer path is represented by
`roomStatusRead.unansweredRefundTransition`: if an `opened` or `active` room has
no artist answer for 24 hours, the future storage layer moves it to
`refund_pending` with `unanswered_24h_full_refund`. After that transition,
user send, artist reply, donation, message metering, support-point grant, and
ranking eligibility are all disabled.

Reported, blinded, suspended, admin-review, refund-pending, and refunded rooms
remain readable only through safe status/refund/report projections. They must
not expose raw chat bodies or raw report reasons.

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

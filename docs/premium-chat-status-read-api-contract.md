# Premium Chat Status Read API Contract

Updated: 2026-05-25
Owner: Luffy / Kaido
Task: Notion #384, #472, #473 room interaction status contract, #477,
#478 projection copy contract, #486 room guidance tone

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
- `productProjection`

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
- `blinded`
- `admin_review`
- `refund_pending`
- `refund_limited_70`
- `refund_limited_50`
- `refunded`
- `closed`
- `expired`
- `suspended`

Each status must include a stable Korean-copy label key. Clients must not use
raw status strings as the only user-facing copy.

`blinded` is the public status key for user/artist-facing projections. Existing
storage or older contracts may still use `blind`; readers must normalize it to
`blinded` before returning a public projection.

Report/review reason keys are stable:

| Status key | Reason key | Message key |
| --- | --- | --- |
| `reported` | `user_report_received` | `chat.premiumRoom.report.reported` |
| `blinded` | `room_blinded_pending_admin_review` | `chat.premiumRoom.report.blinded` |
| `admin_review` | `admin_review_pending_decision` | `chat.premiumRoom.report.adminReview` |
| `suspended` | `room_suspended_pending_admin_review` | `chat.premiumRoom.report.suspended` |
| `refund_limited_70` | `user_fault_report_refund_70` | `chat.premiumRoom.refund.limited70` |
| `refund_limited_50` | `operator_sanction_user_fault_refund_50` | `chat.premiumRoom.refund.limited50` |

For `refund_limited_70` and `refund_limited_50`, the read projection may show
the stable status/reason/message keys and display-safe percentages, but must not
perform or imply wallet, PG, settlement, or payout mutation.

For #477, read projections also recognize API aggregate status keys that future
mutations will return:

- `paused_by_report`: aggregate for reported/blinded/suspended/admin-review.
- `closed_by_artist`: artist close or artist force-close path.
- `closed_by_operator`: operator/admin close path.

These aggregate keys do not replace the detailed report/refund reason keys.
They give clients a stable room-level state while detailed report/refund
projections carry `reasonKey`, `refundRatePercent`, and
`artistCompensationRatePercent`.

## Planned Report/Close Mutation Contracts

The following endpoint shapes remain disabled and are exposed only as a backend
contract through `GET /api/v1/chat/premium-support-contract`:

```http
POST /api/v1/chat/premium-rooms/:roomId/reports
POST /api/v1/creator-studio/premium-chat/rooms/:roomId/force-close
POST /admin/api/v1/backstage/premium-chat/rooms/:roomId/operator-close
Idempotency-Key: <client-or-admin-generated-key>
```

Required behavior before these routes can be enabled:

- report submit moves the public room projection to `paused_by_report`, blinds
  or pauses the room for review, and disables message/donation affordances.
- artist force-close moves the public refund projection to `refund_pending`
  with `artist_forced_close_full_refund`, refund rate 100%, and artist
  compensation 0%.
- operator close can produce 100%, 70%, or 50% refund outcomes; user-fault 70%
  and 50% outcomes keep 10% artist compensation as an accounting candidate.
- repeated same-key/same-body calls return the existing projection.
- same key with a different safe fingerprint returns a stable idempotency
  conflict before wallet, refund, settlement, payout, or accounting mutation.
- raw report text, raw chat body, token, cookie, password, DB URL, and raw
  payload are not returned or documented.

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
- `blinded`
- `suspended`
- `refund_pending`
- `refund_limited_70`
- `refund_limited_50`
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

## Product Projection Copy

#478 fixes the product/chat copy projection used inside premium-chat rooms. The
projection is exposed as `productProjection` and remains read-only.

- User and artist copy are separated by `userVisibleCopy` and
  `artistVisibleCopy`; clients must not reuse one side as the other side.
- 24-hour unanswered refund candidate copy uses
  `productProjection.unansweredRefundCandidate`. It explains the pending refund
  candidate state through stable copy keys and does not imply AI or provider
  retry.
- #485 adds `productProjection.copyStatusConsistency` so visible refund copy
  cannot drift from server state. The 24-hour no-answer path must be described
  as a `refund_pending` candidate awaiting server refund decision, not as an
  already-completed automatic refund. It may show the 100% user refund policy
  only together with pending/candidate semantics.
- User-fault refund limitation copy must stay conditional because only a
  server/admin decision can choose 70% or 50%. The contract fixes
  `allowedRefundRatePercents=[70,50]`,
  `artistCompensationRatePercent=10`, and the matching reason keys; clients
  must not calculate or override those rates.
- Report/review copy must map reported, blinded, suspended, admin-review, and
  `paused_by_report` states to disabled message send, artist reply, donation,
  message-meter, support-point, and wallet mutation affordances.
- Conversation-meter copy uses `conversationMeterNotice`. User copy is summary
  only: it may say that Lumina can be deducted by conversation amount, but must
  not show a per-line amount or internal calculation formula. Artist copy may
  say active conversation can contribute to creator revenue, but must not expose
  settlement formulas, rates, or payout internals.
- Locked room copy is fixed under `lockedRoomMessages` for reported, blinded,
  suspended, admin-review, and refund-pending states. These states keep user
  send, artist reply, donation, and ranking/meter eligibility disabled.
- Support-message projection uses fixed amounts
  `10/50/100/500/1000/5000/10000/50000L` plus the custom amount policy. It is a
  premium-chat support message, not an AI response and not a Lumina Pick like
  signal.
- Projections must not expose raw chat bodies, raw support messages in
  rankings, raw prompts, provider payloads, wallet ledger ids, support-point
  ledger ids, internal settlement formulas/rates, or admin-only memos.

## Room Guidance Tone

#486 fixes the Korean service tone for premium-chat room guidance. The visible
copy is exposed through `productProjection.roomGuidanceCopy`.

- User copy says the room is answered directly by the artist, not by an AI
  auto-reply.
- User copy summarizes that Lumina may be deducted by conversation amount,
  without showing per-line prices.
- User copy explains that no artist answer for 24 hours may become a refund
  review candidate.
- Reported, blinded, suspended, admin-review, and refund-pending copy says
  conversation and support are temporarily paused during review.
- Artist copy may say active conversation and support can help creator revenue,
  but must not expose settlement rates, ledger math, payout internals, or admin
  notes.
- Support-message copy says support messages affect support/communication
  rankings separately from likes.
- UI-visible copy must not contain internal terms such as `provider`, `prompt`,
  `ledger`, `mutation`, `projection`, `원장`, `정산율`, `관리자 메모`, or
  `내부 계산식`.

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

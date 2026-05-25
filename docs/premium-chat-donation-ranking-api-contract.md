# Premium Chat Donation and Ranking API Contract

Task: #376, #473 support message routing, #478 support message projection, #495 support amount/lock guard

Status: contract ready, endpoints disabled.

## Scope

This contract fixes the API shapes for premium-chat donation creation,
communication/support rankings, and the viewer's own donation history before
public mutation is enabled.

The canonical source is:

```http
GET /api/v1/chat/premium-support-contract
```

## Donation Create

Planned endpoint:

```http
POST /api/v1/chat/sessions/:sessionId/donations
Authorization: Bearer <accessToken>
Idempotency-Key: <client-generated-key>
```

Current contract path:

```text
apiContracts.donationCreate
```

Rules:

- `enabled=false`
- `publicMutationEnabled=false`
- fixed preset amounts are 10L, 50L, 100L, 500L, 1000L, 5000L, 10000L,
  and 50000L
- custom amount is supported from 1L through 50000L, integer only
- amount is normalized by the server before any future wallet lookup; client
  balance, local price text, local ranking score, and custom decimal values are
  never trusted
- message is optional and capped at 200 chars
- idempotency key is required
- wallet debit is future server authority only
- replaying the same idempotency key with the same safe fingerprint returns the
  existing projection without another debit; replaying it with a different
  `sessionId`, `amountLumina`, or `message` returns
  `PREMIUM_CHAT_DONATION_IDEMPOTENCY_CONFLICT` before wallet lookup

Request body shape:

```json
{
  "amountLumina": "100",
  "message": "optional support message",
  "idempotencyKey": "client-generated-key"
}
```

Success projection shape:

```json
{
  "order": {
    "id": "<premium chat donation order id>",
    "status": "confirmed",
    "type": "premium_chat_donation",
    "sessionId": "<session id>",
    "artistId": "<artist id>",
    "amountLumina": "<decimal string>"
  },
  "donation": {
    "id": "<donation event id>",
    "sessionId": "<session id>",
    "amountLumina": "<decimal string>",
    "status": "confirmed",
    "createdAt": "<ISO datetime>"
  },
  "wallet": {
    "balanceLumina": "<decimal string after debit>"
  },
  "rankingRefresh": {
    "endpoints": [
      "/api/v1/chat/rankings?type=communication",
      "/api/v1/chat/rankings?type=donation"
    ],
    "clientSubmittedScoreTrusted": false
  }
}
```

Donation is blocked before wallet lookup when the room/session is reported,
paused by report, blind/blinded, suspended, refund-pending, refund-limited,
refunded, admin-review, expired, closed, artist-closed, or operator-closed.
The donation button projection must use stable reason keys and message keys,
not raw status copy.

| Room status | Donation reason key | Message key source |
| --- | --- | --- |
| `reported`, `paused_by_report` | `room_reported` | `chat.premiumRoom.report.processing` |
| `blind`, `blinded` | `room_blinded` | `chat.premiumRoom.report.blinded` |
| `suspended` | `room_suspended` | `chat.premiumRoom.suspended` |
| `admin_review` | `room_admin_review` | `chat.premiumRoom.adminReview` |
| `refund_pending` | `room_refund_pending` | `chat.premiumRoom.refund.pending` |
| `refund_limited_70`, `refund_limited_50` | `room_refund_limited` | matching refund-limited message key |
| `refunded` | `room_refunded` | `chat.premiumRoom.refund.completed` |
| `expired` | `room_expired` | `chat.premiumRoom.expired` |
| `closed`, `artist_closed`, `closed_by_artist`, `closed_by_operator` | `room_closed` | matching closed message key |

Amount guard results:

| Case | Stable code | Message key |
| --- | --- | --- |
| integer preset or integer custom amount in range | `PREMIUM_CHAT_DONATION_ALLOWED` | `chat.donation.amountAccepted` |
| decimal, NaN, empty, or non-integer amount | `PREMIUM_CHAT_DONATION_AMOUNT_INVALID` | `chat.donation.invalidAmount` |
| integer below 1L or above 50,000L | `PREMIUM_CHAT_DONATION_AMOUNT_OUT_OF_RANGE` | `chat.donation.amountOutOfRange` |
| locked room status | `PREMIUM_CHAT_DONATION_ROOM_LOCKED` | status-specific room lock message key |

Donation support-message routing is fixed by #473:

- `message` is a premium-chat donation/support message field, not a Lumina Pick
  like event and not a client-submitted ranking score.
- It may feed only the premium chat communication/support projections and the
  donation projection after server storage exists.
- It must not be copied into `/api/v1/boost-campaigns/:campaignId/rankings` or
  any `type=like` chat ranking alias.
- Ranking projections must not return the raw support message body.
- The current contract keeps donation create disabled, so no support message,
  wallet debit, chat message, ranking row, settlement, or payout mutation is
  created.

The #478 product projection adds display-only support-message copy:

- `productProjection.supportMessageProjection.fixedAmountsLumina` is the same
  fixed amount list: 10L, 50L, 100L, 500L, 1,000L, 5,000L, 10,000L, 50,000L.
- `productProjection.supportMessageProjection.customAmount` carries the same
  custom amount policy as donation create: 1L through 50,000L, integer only.
- The projection has separate `userVisibleCopy` and `artistVisibleCopy` keys.
  It must not be rendered as an AI-generated reply.
- The projection must not return raw support message bodies in rankings, raw
  wallet ledger ids, support-point ledger ids, admin memos, internal settlement
  formulas, or payout details.

## Rankings

Planned endpoint:

```http
GET /api/v1/chat/rankings?type=communication&period=weekly&take=20
GET /api/v1/chat/rankings?type=donation&period=weekly&take=20
```

Current contract path:

```text
apiContracts.rankingsList
```

Rules:

- `enabled=false`
- `walletMutation=false`
- `type=communication` and `type=donation` only
- no `type=like` alias
- frontend cannot submit ranking scores or refresh mutations
- like rankings stay on the Lumina Pick boost lane
- donation ranking uses confirmed net premium-chat donation only
- donation support messages may affect only premium chat communication/support
  projections, never the Lumina Pick like ranking lane
- communication ranking can later combine server-weighted room open, safe
  visible message activity, confirmed net donation, and safe artist reply
  activity

Ranking projections must not expose raw chat body, raw report reason, wallet
ledger id, support point ledger id, conversation meter ledger id, raw user id,
or message ids.

## My Donation History

Planned endpoint:

```http
GET /api/v1/chat/me/premium-donations?period=monthly&status=confirmed&take=20
Authorization: Bearer <accessToken>
```

Current contract path:

```text
apiContracts.myDonationHistory
```

Rules:

- `enabled=false`
- owner-only read projection
- other-user access returns safe 404 or 403 without identity leakage
- no wallet, settlement, or payout mutation
- reported/blinded rooms hide raw room/chat content and expose only safe
  donation status fields

Response shape:

```json
{
  "items": ["myDonationHistoryItem projection"],
  "summary": {
    "totalConfirmedLumina": "<decimal string for filtered window>",
    "refundedLumina": "<decimal string for filtered window>",
    "donationCount": "<number>"
  },
  "nextCursor": "<opaque cursor or null>",
  "generatedAt": "<ISO datetime>"
}
```

Forbidden fields:

- wallet ledger id
- support point ledger id
- conversation meter ledger id
- internal admin note
- raw report reason
- raw payload
- raw chat body
- counterparty user id

## Mutation Block

This task does not enable:

- room open
- donation create
- wallet debit
- settlement
- payout
- score refresh mutation
- support point ledger writes
- conversation meter writes

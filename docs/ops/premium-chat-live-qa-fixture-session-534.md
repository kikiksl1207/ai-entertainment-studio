# Premium Chat Live QA Fixture/Session Runbook (#534)

## Purpose

Prepare safe premium chat room rows so QA can verify the live room list/detail
status matrix through read-only endpoints after #520 and #532.

This runbook does not open premium rooms through a payment path. It does not
create support donations, wallet debit/credit rows, reports, refunds,
settlement rows, payout rows, users, artists, or artist operators.

## Required Matrix

| Bucket | Stored room status | Primary check |
| --- | --- | --- |
| `baseline_active_room` | `active` | Public list + owner/artist detail |
| `reported_room` | `paused_by_report` | Owner/artist detail locked state |
| `admin_review_room` | `admin_review` | Owner/artist detail review state |
| `unanswered_refund_candidate` | `refund_pending` | Owner/artist detail refund candidate state |
| `near_expiry_room` | `active` | Public list/detail `nearExpiry=true` |
| `closed_room` | `closed_by_artist` | Owner/artist detail archive state |
| `expired_room` | `expired` | Owner/artist detail archive state |

`near_expiry_room` must be generated with an `expires_at` value that is still in
the future and no more than 24 hours from the QA verification time. If the row
has already expired, or if `expires_at` is more than 24 hours away, the public
projection correctly returns `remaining.nearExpiry=false`; refresh the fixture
instead of treating the active-only filter as failed.

## Safe Inputs

The operator must obtain these through the approved private QA channel. Do not
paste raw passwords, tokens, cookies, direct DB URLs, or raw email addresses
into Notion, Git, chat, or QA reports.

- `DATABASE_URL`: available only in the secure runtime environment.
- `PREMIUM_CHAT_QA_OWNER_USER_ID`: approved QA owner user UUID.
- `PREMIUM_CHAT_QA_ARTIST_SLUG`: active artist slug used for the matrix.
- `PREMIUM_CHAT_QA_ARTIST_OPERATOR_USER_ID`: optional active creator/operator
  user UUID for artist status endpoint checks.
- `PREMIUM_CHAT_QA_FIXTURE_RUN_ID`: stable run id, for example
  `qa534-YYYYMMDD-runN`.

## Commands

Run from `server`.

Dry run, no DB connection or writes:

```powershell
npm.cmd run qa:premium-chat-live-fixtures
```

Prepare tagged premium room fixture rows:

```powershell
$env:PREMIUM_CHAT_QA_FIXTURE_MODE="prepare"
$env:PREMIUM_CHAT_QA_FIXTURE_CONFIRM="PREPARE_PREMIUM_CHAT_LIVE_QA_FIXTURES"
$env:PREMIUM_CHAT_QA_OWNER_USER_ID="<approved QA owner UUID>"
$env:PREMIUM_CHAT_QA_ARTIST_SLUG="<active artist slug>"
$env:PREMIUM_CHAT_QA_FIXTURE_RUN_ID="qa534-YYYYMMDD-runN"
npm.cmd run qa:premium-chat-live-fixtures
```

Production-like environments are blocked by default. Use staging/local whenever
possible. If the owner approves a live-safe run, set this for that one run:

```powershell
$env:PREMIUM_CHAT_QA_FIXTURE_ALLOW_PRODUCTION="true"
```

Verify the tagged rows without changing data:

```powershell
$env:PREMIUM_CHAT_QA_FIXTURE_MODE="verify"
$env:PREMIUM_CHAT_QA_FIXTURE_CONFIRM="VERIFY_PREMIUM_CHAT_LIVE_QA_FIXTURES"
npm.cmd run qa:premium-chat-live-fixtures
```

Cleanup only the tagged `#534` premium room rows for the selected run id:

```powershell
$env:PREMIUM_CHAT_QA_FIXTURE_MODE="cleanup"
$env:PREMIUM_CHAT_QA_FIXTURE_CONFIRM="CLEANUP_PREMIUM_CHAT_LIVE_QA_FIXTURES"
npm.cmd run qa:premium-chat-live-fixtures
```

## QA Read Endpoints

The script prints room IDs and endpoint paths. Record only the bucket, room
status, path, PASS/FAIL, and blocker. Do not record raw session values.

```http
GET /api/v1/chat/premium-rooms?status=active&take=20
GET /api/v1/chat/me/premium-rooms/:roomId/status
GET /api/v1/creator-studio/premium-chat/rooms/:roomId/status
Authorization: Bearer <approved QA session>
```

Expected safety:

- Public list shows only active public rows.
- Owner detail works only for the approved owner session.
- Artist detail works only for an active artist operator of the fixture artist.
- Non-owner access returns safe not-found behavior.
- Detail projections keep send/reply/donation/report/refund/wallet/settlement/
  payout mutation flags disabled.

## Cleanup / Rollback

- Cleanup uses only `premium_chat_rooms` rows tagged with
  `metadata.qaFixture.task="#534"` and the selected run id.
- It must not delete users, artists, artist operators, wallet rows, reports,
  refund rows, settlement rows, payout rows, or chat messages.
- If cleanup cannot run, leave the task blocked and record only the run id,
  bucket names, and suspected owner. Do not record credentials or private
  identifiers.

## Handoff

After prepare and verify pass, set the Notion task back to QA with:

`[큐알2 현재차례] #534 - 프리미엄챗 live 상태 매트릭스 QA 재개`

큐알2 should then run the matrix in read-only mode and report PASS/FAIL by
bucket.

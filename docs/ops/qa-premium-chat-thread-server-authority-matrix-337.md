# #337 Premium Chat / Feed Thread / Server Authority QA Matrix

Updated: 2026-05-20
Owner: Team2 QA
Basis: `origin/main` `e369d5b74663e98e75d02c28fb4a3dbc588ed9bf`

## Status Labels

| Status | Use when |
| --- | --- |
| PASS | The item was exercised on the intended environment, with expected result and no sensitive values recorded. |
| FAIL | A reproducible product or contract bug exists and needs an owner before completion. |
| PARTIAL | The happy path or read-only path works, but an edge case, role, device width, or integration is still unverified. |
| BLOCKED | Required environment, safe account, test data, deployment, or contract is missing. |

## Global Rules

- Do not create real production payment, refund, chargeback, payout, settlement, or balance-changing operations unless Chamo explicitly approves a safe test environment.
- Do not record tokens, passwords, API keys, raw cookies, DB URLs, bearer values, provider transaction tokens, purchase tokens, or full integrity payloads.
- For any wallet-affecting flow, QA must verify server-derived amount/balance and idempotency behavior. Client-provided balance, price, refund, or settlement values are never authoritative.
- For UI completion, test at 390px, 768px, and 1280px. Record overflow, overlapping controls, truncated Korean copy, mojibake, and raw enum leakage.
- For user-facing errors, verify stable Korean fallback copy or `messageKey`; raw internal enums are not acceptable visible copy.

## Premium Chat Matrix

| Area | Case | Expected | Status |
| --- | --- | --- | --- |
| Contract endpoint | `GET /api/v1/chat/premium-support-contract` with auth | 200, read-only contract, `status=contract_ready_mutation_blocked`, no wallet/order/ledger writes | PENDING |
| Auth gate | Same endpoint without auth | 401/403 safe error, no contract leak beyond public-safe policy if any | PENDING |
| Room open | Open premium chat room with eligible user/artist | Room projection uses server state, duration/expiry visible, no client-chosen paid amount accepted | PENDING |
| Room duration | Existing active room reload | Remaining time/expiry is server-derived and consistent after reload/back/refresh | PENDING |
| Extension | Extend room before expiry | Requires server product/price, idempotency key, one ledger debit, updated expiry | PENDING |
| Expired room | Send/extend after expiry | Fail-closed or extension-only path; no message or debit unless server allows | PENDING |
| Reported room | Donation/message in reported room | Blocks before wallet lookup/mutation with safe message key | PENDING |
| Blinded room | Donation/message in blinded room | Blocks or hides per moderation policy; rankings exclude or zero-weight held rows | PENDING |
| Refund pending | Donation during refund-pending room/order | Blocks before wallet mutation | PENDING |
| Donation amounts | Fixed amounts `10,50,100,500,1000,5000,10000,50000L` | UI shows fixed amounts; backend rejects unsupported or non-integer values | PENDING |
| Custom donation | 1L min, 50000L max | Backend enforces integer range; UI copy matches server policy | PENDING |
| High value | Donation at/above `10000L` | Trust/identity/daily-limit gate appears; no debit if gate not satisfied | PENDING |
| Idempotent replay | Same key + same session/amount/message | Returns existing projection without second debit/ledger row | PENDING |
| Idempotency conflict | Same key + different session/amount/message | 409 `chat.donation.idempotencyConflict` before wallet lookup/mutation | PENDING |
| Insufficient balance | Donate more than server wallet balance | Fail-closed, no order/event/ledger, safe copy | PENDING |
| Offline/retry | Simulate offline submit then reconnect | Client does not spend offline; retry requires server confirmation and idempotency | PENDING |
| Artist compensation | Confirm donation settlement signal | Artist-facing compensation uses confirmed net eligible source only; no refunded/chargeback rows | PENDING |
| Refund ratio | Refund/chargeback after donation | Donation ranking and artist revenue projection exclude or hold affected amount | PENDING |
| Ranking split | Like ranking vs communication vs donation | Like lane excludes `premium_chat_donation`; donation lane uses confirmed net donation only; communication lane stays separate | PENDING |
| Raw IDs | Donation event/ranking projection | No raw wallet ledger ids exposed to client UI | PENDING |

## Lumina Feed Thread Matrix

| Area | Case | Expected | Status |
| --- | --- | --- | --- |
| Create one-piece | `POST /api/v1/lumina-feed/posts/thread` with one body | Creates normal root post with thread metadata; no wallet/order mutation | PENDING |
| Create multi-piece | `items`/`threadItems`/`pieces` array | Root piece included, ordered projection, max 10 pieces including root | PENDING |
| 500 char limit | Piece at 500 chars | Accepted, trimmed only as specified | PENDING |
| Over 500 chars | Piece at 501 chars | 400 safe error, no post created | PENDING |
| 11 pieces | 11 or more pieces | 400 safe error, no partial thread created | PENDING |
| Empty piece | Empty non-image text piece | 400 safe error unless image-only root policy explicitly applies | PENDING |
| Author-only edit | Root author edits non-root item | PATCH succeeds, ordered detail projection updates | PENDING |
| Non-author edit | Other user / artist operator edits item | 403/404 safe error, no mutation | PENDING |
| Root edit separation | Edit root post body | Uses root post edit path, not thread item path | PENDING |
| Delete item | Author deletes non-root item | Soft delete; list/detail projection updates item count/preview | PENDING |
| Delete item replay | Repeat same delete | Idempotent success/projection, no duplicate side effects | PENDING |
| Delete root | Author deletes root post | Full thread hidden from list/detail | PENDING |
| Hide projection | Viewer hides root post | Hidden from that viewer's `me/lumina-feed`; public state unchanged | PENDING |
| Block projection | Viewer blocks author | Author's thread posts hidden from viewer; active follows removed per block contract | PENDING |
| Report projection | Report root/thread | Moderation target remains root post; thread visibility follows moderation policy | PENDING |
| List exposure | Feed list row | Shows `thread.isThread`, `itemCount`, `previewText`; does not dump all long items if UI design limits preview | PENDING |
| Detail exposure | Feed detail row | Shows ordered `thread.items`; deleted/hidden items follow policy | PENDING |
| Engagement target | Likes/comments/images | Remain root-post based; no per-item wallet, settlement, payout, or order mutation | PENDING |
| Search/hashtags | Thread text search and hashtag parsing | Search behavior matches backend contract; no duplicate/hidden blocked rows in viewer feeds | PENDING |

## Server Authority Matrix

| Area | Case | Expected | Status |
| --- | --- | --- | --- |
| Client balance tamper | Submit mutated displayed balance | Backend ignores it and reads server wallet only | PENDING |
| Client price tamper | Submit lower/higher price than product | Backend resolves server product/action price; tampered value ignored/rejected | PENDING |
| Missing idempotency | Wallet-affecting mutation without key | Rejects before wallet lookup/mutation | PENDING |
| Same replay | Same idempotency key + same body | Returns original result; no second debit/credit | PENDING |
| Conflict replay | Same idempotency key + different body | Rejects before wallet mutation | PENDING |
| Concurrent debit | Two requests racing same balance | Atomic non-negative update; at most valid debits succeed | PENDING |
| Insufficient balance | Balance below amount | No domain order/event/ledger created | PENDING |
| Inactive wallet | Suspended/inactive wallet account | Fail-closed before mutation | PENDING |
| Offline queue | Client queues paid action offline | Display-only until server confirms; no local authoritative spend | PENDING |
| Provider purchase | App purchase credit | Lumina credit only after server provider verification; provider transaction id dedupes | PENDING |
| Integrity signal | Play Integrity/App Attest/DeviceCheck present | Treated as risk signal only; never grants Lumina alone | PENDING |
| Refund reversal | Technical failure refund | Server-generated refund key credits at most once | PENDING |
| Admin adjustment | Backstage manual wallet adjustment | Super-admin only, confirmation modal, audit trail, no raw sensitive values | PENDING |
| Mutation closed | Planned premium chat donation before backend enablement | UI disabled and API absent/disabled; no ledger write possible | PENDING |

## Screen QA Matrix

| Screen | Widths | Expected | Status |
| --- | --- | --- | --- |
| Premium chat room | 390 / 768 / 1280 | No overflow/overlap; room expiry, report/blind/refund state copy visible and Korean-safe | PENDING |
| Premium support modal | 390 / 768 / 1280 | Amount buttons stable, custom amount fits, disabled state clear, no real debit unless safe env | PENDING |
| Chat rankings | 390 / 768 / 1280 | Like/communication/donation lanes visibly distinct; score labels localized | PENDING |
| Feed thread composer | 390 / 768 / 1280 | Piece counter, 500-char state, add/remove item controls usable | PENDING |
| Feed list/detail thread | 390 / 768 / 1280 | Preview/detail layout does not overlap; deleted/hidden/blocked state copy safe | PENDING |
| Backstage/review screens | 390 / 768 / 1280 | Report/blind/refund/ranking/admin controls gated by role and visibly safe | PENDING |

## Completion Report Template

```text
status: PASS / FAIL / PARTIAL / BLOCKED
task:
branch/commit:
environment:
- live/staging/local:
- backend health or commit:
- safe accounts/data used:
matrix_summary:
- premium_chat:
- feed_thread:
- server_authority:
- screen_qa:
blockers:
repro_steps:
evidence:
changed_files:
tests:
 민감값 기록 여부: 없음
```

## Minimum Gate Before Final PASS

- Premium chat donation or extension must not be marked PASS until a safe environment proves idempotency, fail-closed balance behavior, blocked moderation states, and ranking separation.
- Feed thread must not be marked PASS until author-only edit/delete, 500-char limits, delete replay, and hide/block projections are exercised.
- Server authority must not be marked PASS if any paid mutation accepts client amount/balance or can replay without idempotency conflict checks.
- UI must not be marked PASS if 390px layout, Korean copy, or raw enum/error visibility is untested.

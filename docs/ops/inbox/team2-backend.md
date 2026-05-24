# Team2 Backend Inbox

status: reviewed_for_main
task: "#459 artist URL knowledge character chat safety gate"
source_branch: team2-backend/artist-url-chat-safety-gate-459
source_commit: f49c9f4
main_commit: e137c82
push: yes after viewer validation
main_reflected: yes after viewer validation and merge
worktree_cleanup: yes after Notion completion report
changed_files:
- server/src/chat/llm-provider.adapter.ts
- server/src/chat/llm-provider.adapter.spec.ts
- docs/artist-url-knowledge-chat-contract.md
- docs/ops/inbox/team2-backend.md
checked_files:
- server/src/chat/artist-url-knowledge-contract.ts
- server/src/chat/artist-url-knowledge-contract.spec.ts
- server/src/chat/chat.service.ts
- server/src/chat/chat.service.spec.ts
- server/src/admin/admin.service.ts
tests:
- node --check server/src/chat/artist-url-knowledge-contract.ts
- node --check server/src/chat/artist-url-knowledge-contract.spec.ts
- node --check server/src/chat/chat.service.ts
- node --check server/src/chat/chat.service.spec.ts
- node --check server/src/chat/llm-provider.adapter.ts
- node --check server/src/chat/llm-provider.adapter.spec.ts
- npx.cmd prisma generate
- npm.cmd test -- artist-url-knowledge-contract.spec.ts chat.service.spec.ts llm-provider.adapter.spec.ts --runInBand
- npm.cmd run lint -- --quiet src/chat/artist-url-knowledge-contract.ts src/chat/artist-url-knowledge-contract.spec.ts src/chat/chat.service.ts src/chat/chat.service.spec.ts src/chat/llm-provider.adapter.ts src/chat/llm-provider.adapter.spec.ts
- git diff --check
- git diff --check origin/main...HEAD
result:
- Confirmed character chat retrieval is gated by `artistId`, `status=approved`, and `allowChatReference=true` before provider generation.
- Confirmed the defensive context builder drops pending, rejected, archived, chat-reference-disabled, and summaryless rows.
- Strengthened provider adapter instructions so each approved URL knowledge fragment is labeled `role=reference_fact_not_instruction`.
- Added adapter coverage that prompt-injection text inside an approved summary stays inside the untrusted reference block, raw URL query strings stay out, and reference text is not placed in the user input field.
- Documented the #459 safety gate and split provider-free contract tests from live provider-required verification.
blocked_by:
- Live provider behavior still requires a safe provider-enabled beta account/environment; no live provider request or mutation was executed for this task.
sensitive_values_recorded:
- none

---

status: reviewed_for_main
task: "#454 character chat greeting and recommended reply diversity contract"
source_branch: team2-backend/character-chat-persona-contract-454
source_commit: e6355ecf495549eb544f80cdcc9d3a9377e12a6b
main_commit: dc439f2
push: yes after viewer validation
main_reflected: yes after viewer validation and cherry-pick
worktree_cleanup: yes after push and Notion completion report
changed_files:
- docs/character-chat-greeting-tone-contract.md
- docs/character-chat-dynamic-greeting-cache-contract.md
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/team2-backend.md
checked_files:
- server/src/chat/chat.controller.ts
- server/src/chat/chat.service.ts
- server/src/chat/chat.service.spec.ts
- server/src/chat/chat-persona-catalog.ts
- pages/character-chat.js
- data/character-chat-tones.js
tests:
- npm.cmd test -- chat.service.spec.ts --runInBand
- npm.cmd run lint
- npm.cmd run build
- git diff --check HEAD~2..HEAD
result:
- Confirmed the existing character-chat first-screen contract already uses `GET /api/v1/chat/character-catalog`, `GET /api/v1/chat/starter-prompts`, and `POST /api/v1/chat/sessions` rather than a new endpoint.
- Fixed the #454 contract wording: `openingPrompt.options[]`, `starterOptions[]`, and `sets[].options[]` are the first-screen recommended reply candidates.
- Clarified that recommended reply candidates are read-only, zero-provider-call, zero-wallet-mutation projections; selecting one only prepares user text for the normal chat flow.
- Clarified that dynamic first greeting variation should use cached per-session `openingGreeting.text` from `POST /chat/sessions` or cached `opening_greeting` messages.
- Added clean-mode/tone guardrails for minors, prohibited expression categories, external contact/payment, and excessive intimacy.
blocked_by:
- Live DM UI verification still needs a deployed environment and safe authenticated account; no provider call or live mutation was executed for this contract task.
sensitive_values_recorded:
- none

---

status: reviewed_for_main
task: "#439 artist URL approved knowledge character chat reference contract"
source_branch: team2-backend/artist-url-chat-reference-439
source_commit: 7e661a26e301ba11368d126487c73ff0a5518f50
review_branch: main
main_reflected: yes after viewer validation and cherry-pick
worktree_cleanup: yes; source worktree removed by 루피, no viewer worktree created
changed_files:
- server/src/chat/artist-url-knowledge-contract.spec.ts
- server/src/chat/chat.service.spec.ts
- docs/ops/inbox/team2-backend.md
checked_files:
- server/src/chat/artist-url-knowledge-contract.ts
- server/src/chat/chat.service.ts
- server/src/chat/llm-provider.adapter.ts
- server/src/creator-studio/creator-studio.service.ts
- server/src/admin/admin.service.ts
- docs/ops/inbox/team2-qa.md
source_tests:
- npm.cmd ci
- npx.cmd prisma generate
- node --check server/src/chat/artist-url-knowledge-contract.ts
- node --check server/src/chat/artist-url-knowledge-contract.spec.ts
- node --check server/src/chat/chat.service.ts
- node --check server/src/chat/chat.service.spec.ts
- node --check server/src/chat/llm-provider.adapter.ts
- npm.cmd test -- artist-url-knowledge-contract.spec.ts chat.service.spec.ts creator-studio.service.spec.ts admin.service.spec.ts --runInBand
- npm.cmd run lint -- --quiet src/chat/artist-url-knowledge-contract.ts src/chat/artist-url-knowledge-contract.spec.ts src/chat/chat.service.ts src/chat/chat.service.spec.ts src/chat/llm-provider.adapter.ts src/creator-studio/creator-studio.service.ts src/creator-studio/creator-studio.service.spec.ts src/admin/admin.service.ts src/admin/admin.service.spec.ts
- npm.cmd run build
- git diff --check
- git diff --check origin/main...HEAD
viewer_tests:
- node --check server/src/chat/artist-url-knowledge-contract.ts
- node --check server/src/chat/artist-url-knowledge-contract.spec.ts
- node --check server/src/chat/chat.service.ts
- node --check server/src/chat/chat.service.spec.ts
- node --check server/src/chat/llm-provider.adapter.ts
- npm.cmd test -- artist-url-knowledge-contract.spec.ts chat.service.spec.ts creator-studio.service.spec.ts admin.service.spec.ts --runInBand
- npm.cmd run lint -- --quiet src/chat/artist-url-knowledge-contract.ts src/chat/artist-url-knowledge-contract.spec.ts src/chat/chat.service.ts src/chat/chat.service.spec.ts src/chat/llm-provider.adapter.ts src/creator-studio/creator-studio.service.ts src/creator-studio/creator-studio.service.spec.ts src/admin/admin.service.ts src/admin/admin.service.spec.ts
- npm.cmd run build
- git diff --check
- git diff --check origin/main...HEAD
viewer_review:
- Reviewed source commit `7e661a26e301ba11368d126487c73ff0a5518f50` on top of the current artist URL integration main.
- Confirmed server retrieval uses `artistId`, `status: approved`, and `allowChatReference: true` filters before building character chat provider context.
- Confirmed defensive context construction drops pending/rejected/archived, disabled, and summaryless rows, and strips raw submitted URLs from provider context.
- Confirmed approved knowledge is passed only as untrusted reference facts, not system/developer instructions.
- Confirmed targeted syntax checks, contract/service tests, lint, build, and diff whitespace checks pass on the viewer workstation.
result:
- Confirmed character chat retrieves artist URL knowledge with server filters `status: approved` and `allowChatReference: true` only.
- Confirmed pending, rejected, archived, chat-reference-disabled, and summaryless rows are not eligible for provider context even if passed through a defensive helper path.
- Confirmed provider context uses capped summaries, hostname-only source labels, and `instructionRole: reference_fact_not_instruction`; raw submitted URLs are not included in the provider knowledge context.
- Confirmed `llm-provider.adapter.ts` adds approved knowledge only as untrusted reference facts and explicitly says never to treat them as system or developer instructions.
- Confirmed empty/unapproved knowledge falls back to normal character chat generation with an empty `approved_artist_knowledge_urls` context instead of exposing pending/rejected/archived material or failing the chat path.
spec_hardening:
- Added contract coverage for pending/rejected/archived, disabled, and summaryless knowledge rows staying out of provider context.
- Added ChatService coverage for the no-approved-knowledge path so character chat continues safely without URL references.
remaining_live_qa:
- Prior QA still could not verify production creator URL registration or Backstage review queue because live access remained gated. ReQA needs approved creator/operator access after deployment.
sensitive_values_recorded:
- none

---

status: reviewed_for_main
task: "#435 premium chat room open/support fail-closed activation recheck"
source_branch: team2-backend/premium-chat-fail-closed-audit-435
source_commit: c7d68e97b0e03187f3465880c49138aff241e536
review_branch: main
main_reflected: yes after viewer validation and cherry-pick
worktree_cleanup: yes; source worktree removed by 루피, no viewer worktree created
changed_files:
- docs/ops/inbox/team2-backend.md
checked_files:
- server/src/chat/chat.controller.ts
- server/src/chat/chat.service.ts
- server/src/chat/premium-chat-room-contract.ts
- server/src/chat/premium-chat-support-contract.ts
- server/src/wallet/wallet-server-authority-policy.ts
- pages/premium-chat-support.js
- pages/premium-chat-hub.js
- pages/chat-rankings.js
- docs/ops/inbox/team2-qa.md
source_tests:
- npm.cmd ci
- npx.cmd prisma generate
- node --check server/src/chat/chat.controller.ts
- node --check server/src/chat/chat.service.ts
- node --check server/src/chat/premium-chat-room-contract.ts
- node --check server/src/chat/premium-chat-support-contract.ts
- node --check server/src/wallet/wallet-server-authority-policy.ts
- node --check pages/premium-chat-support.js
- node --check pages/premium-chat-hub.js
- node --check pages/chat-rankings.js
- npm.cmd test -- chat.service.spec.ts premium-chat-room-contract.spec.ts wallet-server-authority-policy.spec.ts --runInBand
- npm.cmd run lint -- --quiet src/chat/chat.controller.ts src/chat/chat.service.ts src/chat/chat.service.spec.ts src/chat/premium-chat-room-contract.ts src/chat/premium-chat-room-contract.spec.ts src/chat/premium-chat-support-contract.ts src/wallet/wallet-server-authority-policy.ts src/wallet/wallet-server-authority-policy.spec.ts
- npm.cmd run build
- git diff --check
- git diff --check origin/main...HEAD
viewer_tests:
- node --check pages/premium-chat-support.js
- node --check pages/premium-chat-hub.js
- node --check pages/chat-rankings.js
- npm.cmd test -- chat.service.spec.ts premium-chat-room-contract.spec.ts wallet-server-authority-policy.spec.ts --runInBand
- npm.cmd run lint -- --quiet src/chat/chat.controller.ts src/chat/chat.service.ts src/chat/chat.service.spec.ts src/chat/premium-chat-room-contract.ts src/chat/premium-chat-room-contract.spec.ts src/chat/premium-chat-support-contract.ts src/wallet/wallet-server-authority-policy.ts src/wallet/wallet-server-authority-policy.spec.ts
- npm.cmd run build
- git diff --check
- git diff --check origin/main...HEAD
viewer_review:
- Reviewed source commit `c7d68e97b0e03187f3465880c49138aff241e536` against latest main `e0e379e` before integration.
- Confirmed the controller exposes only read-only `GET /api/v1/chat/premium-support-contract`; no premium room open, donation preview/create, rankings, report, force-close, refund, settlement, or payout mutation route is mounted.
- Confirmed frontend support/hub/rankings scripts keep mutation and ranking fetches gated by `walletMutationEnabled=false` and planned/disabled ranking contract status.
- Confirmed targeted syntax checks, contract tests, lint, build, and diff whitespace checks pass on the viewer workstation.
result:
- Rechecked current main `e0e379e` after the #433 integration and prior #429 merge. The premium chat room open and donation contract remains fail-closed for live mutation activation.
- Confirmed room open tiers are still server-authored as 300/500/1000/3000L. Default accessible tier is 300L, higher tiers remain server-unlocked follower/support tiers, and client-submitted amount, balance, duration, follower state, price, refund rate, or settlement share is not trusted.
- Confirmed the public chat controller still does not mount live premium room open, donation preview/create, chat ranking, report, force-close, refund, settlement, or payout mutation routes. The premium support contract endpoint remains read-only `GET /api/v1/chat/premium-support-contract`.
- Confirmed frontend premium chat support/hub/ranking scripts stay contract-gated: donation confirmation remains disabled while `walletMutationEnabled=false`, rankings are not fetched while the ranking endpoint is planned/disabled, and no room-open/donation/wallet/refund/settlement/payout POST is wired.
- Confirmed donation ranking and like ranking remain separate. Lumina Pick/boost rankings exclude premium chat donation, and planned chat communication/donation rankings exclude free-like/lumina-boost rows plus unsafe refunded/blinded/reported rows.
safe_fixture_verifiable:
- Contract specs cover tier lock/unlock behavior, server amount authority, disabled endpoint flags, blocked room states, idempotency expectations, ranking lane separation, privacy-safe projections, and no wallet/order/message mutation during read-only contract access.
- UI/read-only fixture checks can verify 300/500/1000/3000L copy, locked donation confirmation, and separated ranking copy without executing live mutation.
not_open_before_activation:
- POST room open, donation preview/create, wallet debit/refund, conversation meter decrement, support point grants, settlement/payout accrual, report/force-close mutation, and ranking read-model refresh.
activation_checklist:
- Add storage/migrations for premium chat rooms, donation orders, support point ledger, conversation meter ledger, accounting ledger, refund decisions, moderation decisions, and ranking read models.
- Implement server-only mutation endpoints with auth, idempotency fingerprints, duplicate replay handling, atomic nonnegative wallet guards, and server-normalized amounts.
- Add QA fixtures for user, artist, follower-tier unlocks, insufficient balance, blocked room states, repeated room/donation/refund-like replay, and rollback/ops runbook.
- Keep frontend submit disabled until backend storage, ledger, moderation, refund, ranking read models, and explicit activation flags are live.
- ReQA user-facing refund policy copy before public activation: prior QA flagged the 24-hour unanswered full refund and 70%/50% user-fault refund limits as not sufficiently visible.
blocked_by:
- Backend storage/mutation implementation and explicit activation approval. No live payment, donation, room-open, wallet debit, refund, settlement, or payout mutation should run before that approval.
sensitive_values_recorded:
- none

---

status: reviewed_for_main
task: "#429 premium chat room open/support fail-closed activation audit"
source_branch: team2-backend/premium-chat-fail-closed-audit-429
source_commit: 64c27902e90e9f9efeae6f46cc0787263629f185
review_branch: viewer/429-premium-chat-fail-closed-review
push: yes after viewer validation
main_reflected: yes after viewer validation and fast-forward
worktree_cleanup: yes after push and Notion completion report
changed_files:
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- npx.cmd prisma generate
- node --check server/src/chat/chat.controller.ts
- node --check server/src/chat/chat.service.ts
- node --check server/src/chat/premium-chat-room-contract.ts
- node --check server/src/chat/premium-chat-support-contract.ts
- node --check server/src/wallet/wallet-server-authority-policy.ts
- node --check pages/premium-chat-support.js
- node --check pages/premium-chat-hub.js
- node --check pages/chat-rankings.js
- npm.cmd test -- chat.service.spec.ts premium-chat-room-contract.spec.ts wallet-server-authority-policy.spec.ts --runInBand
- npm.cmd run lint -- --quiet src/chat/chat.controller.ts src/chat/chat.service.ts src/chat/chat.service.spec.ts src/chat/premium-chat-room-contract.ts src/chat/premium-chat-room-contract.spec.ts src/chat/premium-chat-support-contract.ts src/wallet/wallet-server-authority-policy.ts src/wallet/wallet-server-authority-policy.spec.ts
- npm.cmd run build
- git diff --check
viewer_review:
- Reviewed the source audit against current main `6c7532a9e28bea738e19e49aa7127ec15374e85f` before merge.
- Verified the public server controller exposes only the read-only premium support contract and does not mount premium room open, donation, report, force-close, refund, settlement, payout, or ranking mutation routes.
- Verified frontend premium chat support/hub/ranking scripts pass syntax checks and keep mutation paths gated by the read-only contract.
result:
- Confirmed premium chat room tiers are server-authored as 300/500/1000/3000L. The default accessible tier is 300L, higher tiers remain server-unlocked follower/support tiers, and client-submitted amount, balance, duration, price, follower state, refund rate, or settlement share is not trusted.
- Confirmed actual room open, donation preview/create, room status, donation history, rankings list, report, force-close, refund, settlement, payout, and support/conversation ledger mutations are absent, planned disabled, or fail-closed by contract. The exposed premium support endpoint remains read-only `GET /api/v1/chat/premium-support-contract`.
- Confirmed frontend premium chat support/hub/ranking pages consume the read-only contract, keep donation/room-open paths locked while `walletMutationEnabled=false`, and do not send donation, room-open, wallet debit, refund, settlement, payout, or ranking refresh POSTs.
- Confirmed room open, message/conversation metering, donation, refund, report/force-close, and repeated/invalid attempts require server ledger authority, idempotency, atomic wallet guards, and blocked-state checks before activation. No client-only debit or temporary hardcoding is permitted.
- Confirmed donation ranking and like ranking remain separate: Lumina Pick/boost rankings exclude premium chat donation, while planned chat communication/donation rankings exclude free-like/lumina-boost lanes and unsafe refunded/blinded/reported rows.
safe_fixture_verifiable:
- Contract helpers and specs verify tier locks, server amount authority, disabled endpoint flags, blocked room states, ranking lane separation, privacy-safe projections, and no wallet/order/message mutation during read-only contract access.
- UI fixture/read-only checks can verify 300/500/1000/3000L copy, locked donation confirmation, and separated ranking copy without executing mutations.
not_open_before_activation:
- POST room open, donation preview/create, wallet debit/refund, conversation meter decrement, support point grants, settlement/payout accrual, report/force-close mutation, and ranking read-model refresh.
activation_checklist:
- Add storage/migrations for premium chat rooms, donation orders, support point ledger, conversation meter ledger, accounting ledger, refund decisions, moderation decisions, and ranking read models.
- Implement server-only mutation endpoints with auth, idempotency fingerprints, duplicate replay behavior, atomic nonnegative wallet guards, and server-normalized amounts.
- Add QA fixtures for user, artist, follower-tier unlocks, insufficient balance, repeated delete/close/refund-like replay, blocked room states, and rollback/ops runbook.
- Gate activation with contract flags so frontend submit stays disabled until backend storage, ledger, moderation, refund, and ranking read models are live.
- Surface refund policy copy before public activation: 24-hour unanswered full refund and 70%/50% user-fault refund limits were previously flagged as a user-facing QA blocker.
blocked_by:
- Backend storage/mutation implementation and explicit activation approval. No live payment, donation, room-open, wallet debit, refund, settlement, or payout mutation should run before that approval.
sensitive_values_recorded:
- none

---

status: ready_for_review
task: "#422 Lumina Feed 2200-character live API blocker fix"
branch: team2-backend/lumina-feed-2200-live-blocker-422
commit: final hash recorded in Notion completion report
push: yes after final validation
main_reflected: no, review/merge pending
worktree_cleanup: yes after push and Notion completion report
changed_files:
- server/src/community/community.service.ts
- server/src/community/community.service.spec.ts
- docs/backend-api-spec.md
- docs/lumina-feed-backend-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- npx.cmd prisma generate
- node --check server/src/community/community.service.ts
- node --check server/src/community/community.service.spec.ts
- npm.cmd test -- community.service.spec.ts --runInBand
- npm.cmd run lint -- --quiet src/community/community.service.ts src/community/community.service.spec.ts
- npm.cmd run build
- git diff --check
result:
- Reapplied the live API blocker fix on latest main so regular Lumina Feed post body, post body edit, and quote repost body validation allow 2200 characters.
- Split shared limits so manual thread items and thread continuations remain capped at 500 characters, while replies remain capped at 300 characters.
- Preserved image-only feed post empty body support when a confirmed public image asset is attached.
- Added regression tests for 2200/2201 create, edit, and quote repost behavior plus existing 501 thread continuation and 301 reply blocking.
blocked_by:
- Review/merge and #423 live reQA after deployment.
sensitive_values_recorded:
- none

---

status: ready_for_review
task: "#402 character chat tone and opening greeting session variation contract"
branch: team2-backend/character-chat-tone-greeting-contract-402
commit: final hash recorded in Notion completion report
push: yes after final validation
main_reflected: no, review/merge pending
worktree_cleanup: yes after push and Notion completion report
changed_files:
- server/src/chat/chat.service.ts
- server/src/chat/chat.service.spec.ts
- docs/character-chat-dynamic-greeting-cache-contract.md
- docs/character-chat-greeting-tone-contract.md
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- node --check server/src/chat/chat.service.ts
- node --check server/src/chat/chat.service.spec.ts
- npm.cmd test -- chat.service.spec.ts --runInBand
- npx.cmd prisma generate
- npm.cmd run lint -- --quiet src/chat/chat.service.ts src/chat/chat.service.spec.ts src/chat/llm-provider.adapter.ts
- npm.cmd run build
- git diff --check
- git diff --check origin/main...HEAD
result:
- Added `openingGreeting.toneCandidate` as display-safe session response and stored metadata contract.
- Snapshotted runtime persona tone guide, tone tags, persona tags, and character slug without storing raw persona prompts or provider payloads.
- Strengthened the 3 character x 10 session regression fixture to assert that opening greeting responses carry the expected character-specific tone candidate.
- Kept same-session cache and daily provider guard behavior unchanged.
blocked_by:
- none for contract/test coverage; live provider QA still depends on configured provider environment.
sensitive_values_recorded:
- none

---

status: ready_for_review
task: "#397 character chat dynamic opening greeting session regression contract"
branch: team2-backend/character-chat-greeting-regression-397
commit: final hash recorded in Notion completion report
push: yes after final validation
main_reflected: no, review/merge pending
worktree_cleanup: yes after push and Notion completion report
changed_files:
- server/src/chat/chat.service.spec.ts
- docs/character-chat-dynamic-greeting-cache-contract.md
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- node --check server/src/chat/chat.service.ts
- node --check server/src/chat/chat.service.spec.ts
- npm.cmd test -- chat.service.spec.ts --runInBand
- npx.cmd prisma generate
- npm.cmd run lint -- --quiet src/chat/chat.service.ts src/chat/chat.service.spec.ts src/chat/llm-provider.adapter.ts
- npm.cmd run build
- git diff --check
- git diff --check origin/main...HEAD
result:
- Added regression coverage for provider-unavailable fallback variation across 3 character fixtures and 10 sessions per character.
- Added regression coverage for exhausted daily provider guard skipping opening greeting provider generation and storing zero-cost fallback metadata.
- Kept raw prompt, token, provider payload, user private data, wallet/order/settlement/payout details out of docs and assertions.
blocked_by:
- none for contract test coverage; live provider QA still depends on configured provider environment.
sensitive_values_recorded:
- none

---

status: ready_for_review
task: "#388 character chat dynamic opening greeting and session cache"
branch: team2-backend/character-chat-dynamic-greeting-cache-388
commit: final hash recorded in Notion completion report
push: yes after final validation
main_reflected: no, review/merge pending
worktree_cleanup: yes after push and Notion completion report
changed_files:
- server/src/chat/chat.service.ts
- server/src/chat/chat.service.spec.ts
- server/src/chat/llm-provider.adapter.ts
- docs/character-chat-dynamic-greeting-cache-contract.md
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- npm.cmd test -- chat.service.spec.ts --runInBand
- npx.cmd prisma generate
- npm.cmd run lint -- --quiet src/chat/chat.service.ts src/chat/chat.service.spec.ts src/chat/llm-provider.adapter.ts
- npm.cmd run build
- git diff --check origin/main...HEAD
result:
- Added `opening_greeting` session cache stored in `chat_messages`.
- `POST /chat/sessions` now returns additive `openingGreeting`; `GET /chat/sessions/:sessionId/messages` reuses the cached row instead of calling the provider on refresh.
- Added `dynamicGreetingContract` to character catalog and starter prompt projections.
- Added provider-ready short greeting generation with `maxOutputTokens=120` and `maxOutputChars=180`.
- Added provider-unavailable/guard/error fallback using character runtime persona copy, with deterministic session-based variation.
- Added tests for provider generation, cache replay without provider call, and same-character fallback variation across sessions.
blocked_by:
- Live provider QA still requires an approved allowlisted disposable account and configured provider environment.
sensitive_values_recorded:
- none

---

status: ready_for_review
task: "#384 premium chat report/refund status read API contract"
branch: team2-backend/premium-chat-status-readonly-384
commit: final hash recorded in Notion completion report
push: yes after final validation
main_reflected: no, review/merge pending
worktree_cleanup: yes after push and Notion completion report
changed_files:
- server/src/chat/premium-chat-support-contract.ts
- server/src/chat/chat.service.spec.ts
- docs/premium-chat-status-read-api-contract.md
- docs/backend-api-spec.md
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- npm.cmd test -- chat.service.spec.ts --runInBand
- npx.cmd prisma generate
- npm.cmd run lint -- --quiet src/chat/chat.service.ts src/chat/chat.service.spec.ts src/chat/premium-chat-support-contract.ts src/chat/premium-chat-room-contract.ts
- npm.cmd run build
- git diff --check origin/main...HEAD
result:
- Added disabled/read-only user and artist premium-room status API contracts for safe report/refund/closure state lookup.
- Fixed owner-user, artist-owner, non-owner, and unauthenticated access matrix in the contract response.
- Added safe projections for room status, refund status, report status, and mutation availability.
- Kept closed/reported/refund_pending and related moderation states fail-closed for message/support/donation/refund/wallet/settlement/payout mutation.
- Documented that repeated refund/report status reads replay existing projections and must not create duplicate refund or moderation mutations.
blocked_by:
- Actual premium-chat room/report/refund storage is still required before enabling the planned read endpoints.
sensitive_values_recorded:
- none

---

status: ready_for_review
task: "#381 character chat greeting and tone contract"
branch: team2-backend/character-chat-greeting-tone-contract-381
commit: final hash recorded in Notion completion report
push: yes after final validation
main_reflected: no, review/merge pending
worktree_cleanup: yes after push and Notion completion report
changed_files:
- server/src/chat/chat.service.ts
- server/src/chat/chat.service.spec.ts
- docs/character-chat-greeting-tone-contract.md
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- npm.cmd test -- chat.service.spec.ts --runInBand
- npx.cmd prisma generate
- npm.cmd run lint -- --quiet src/chat/chat.service.ts src/chat/chat.service.spec.ts src/chat/llm-provider.adapter.ts
- npm.cmd run build
- git diff --check origin/main...HEAD
result:
- Added additive read-only `openingPrompt`, `forbiddenTone`, and `greetingToneContract` fields to character catalog and starter prompt responses.
- Fixed contract version `2026-05-21.character-chat-greeting-tone.v1` for first-screen greeting/tone wiring.
- Extended copy contract required fields to include opening prompt guide/options and forbidden tone items.
- Added regression coverage for CMS copy, per-character isolation, fallback copy, and missing-row fallback without provider calls or wallet/order/chat message mutations.
blocked_by:
- Viewer review, then frontend can wire #382 first-screen greeting/tone UI from the explicit response fields.
sensitive_values_recorded:
- none

---

status: ready_for_review
task: "#376 premium chat donation and communication ranking API contract"
branch: team2-backend/premium-chat-ranking-api-contract-376
commit: final hash recorded in Notion completion report
push: yes after final validation
main_reflected: no, review/merge pending
worktree_cleanup: yes after push and Notion completion report
changed_files:
- server/src/chat/premium-chat-support-contract.ts
- server/src/chat/chat.service.spec.ts
- docs/premium-chat-donation-ranking-api-contract.md
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- npm.cmd test -- chat.service.spec.ts --runInBand
- npx.cmd prisma generate
- npm.cmd run lint -- --quiet src/chat/chat.service.ts src/chat/chat.service.spec.ts src/chat/premium-chat-support-contract.ts src/chat/premium-chat-room-contract.ts
- npm.cmd run build
- git diff --check origin/main...HEAD
result:
- Bumped premium support contract to `2026-05-21.premium-chat-donation-ranking-api.v1`.
- Added disabled owner-only `apiContracts.myDonationHistory` for `GET /api/v1/chat/me/premium-donations`.
- Kept donation create disabled with `publicMutationEnabled=false`, idempotency required, and future server-authority wallet debit prerequisites documented.
- Fixed donation availability by room status: reported/blind/suspended/refund-pending/refunded/admin-review/expired/closed rooms cannot accept donations.
- Kept communication and donation rankings disabled, read-only, separated from likes/boosts, and blocked client-submitted score refresh.
blocked_by:
- Viewer review. Later implementation still needs storage/read-model/wallet-ledger integration before donation create, ranking list, or my-donation history endpoints can be enabled.
sensitive_values_recorded:
- none

---

status: ready_for_review
task: "#372 premium chat room list and donation ranking read-only contract"
branch: team2-backend/premium-chat-readonly-contract-372
commit: final hash recorded in Notion completion report
push: yes after final validation
main_reflected: no, review/merge pending
worktree_cleanup: yes after push and Notion completion report
changed_files:
- server/src/chat/premium-chat-support-contract.ts
- server/src/chat/chat.service.spec.ts
- docs/premium-chat-readonly-room-ranking-contract.md
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- npm.cmd test -- chat.service.spec.ts --runInBand
- npx.cmd prisma generate
- npm.cmd run lint -- --quiet src/chat/chat.service.ts src/chat/chat.service.spec.ts src/chat/premium-chat-support-contract.ts src/chat/premium-chat-room-contract.ts
- npm.cmd run build
- git diff --check
result:
- Added disabled read-only `apiContracts.roomList` for `GET /api/v1/chat/premium-rooms` with public artist-safe projection fields only.
- Kept premium room tiers tied to the existing 300L/500L/1000L/3000L room-open contract and marked client price/balance authority as untrusted.
- Documented room list exclusions for reported/blind/suspended/refund-pending/refunded/admin-review rooms.
- Tightened ranking read-only source filters so donation ranking uses confirmed net premium-chat donation only and stays separate from free likes/Lumina boosts.
- Asserted no wallet/order/message mutation calls in the premium support contract spec.
blocked_by:
- Viewer review. Later implementation still needs storage/read-model integration before room list or ranking endpoints can be enabled.
sensitive_values_recorded:
- none

---

status: ready_for_review
task: "#363 premium chat support point ledger contract v1"
branch: team2-backend/premium-chat-ledger-contract-363
commit: final hash recorded in Notion completion report
push: yes after final validation
main_reflected: no, review/merge pending
worktree_cleanup: yes after push and Notion completion report
changed_files:
- server/src/chat/premium-chat-support-contract.ts
- server/src/chat/chat.service.spec.ts
- docs/premium-chat-support-point-ledger-contract.md
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/server-authority-ledger-contract.md
- docs/app-web-lumina-tamper-defense-checklist.md
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- npm.cmd test -- chat.service.spec.ts --runInBand
- npx.cmd prisma generate
- npm.cmd run lint -- --quiet src/chat/chat.service.ts src/chat/chat.service.spec.ts src/chat/premium-chat-support-contract.ts src/chat/premium-chat-room-contract.ts
- npm.cmd run build
- git diff --check origin/main...HEAD
result:
- Bumped premium support contract to `2026-05-21.premium-chat-support-ledger.v1`.
- Added disabled conversation metering contract for premium chat message activity units with server-only visible-message authority and no wallet/settlement mutation.
- Added disabled non-cash `premium_chat_support_point_ledger` contract, separate from `wallet_ledger` and `fan_engagement_point_ledger`, for room-open/message/donation support points.
- Kept room tiers 300L/500L/1000L/3000L, 3-day base duration, 10-day artist extension cap, 24h no-answer refund, 70%/50% user-fault refund policy, and separated communication/donation ranking lanes.
blocked_by:
- Viewer review. Later implementation still needs storage/migrations before room-open, donation, meter, support point, ranking, settlement, or payout writes can be enabled.
sensitive_values_recorded:
- none

---

status: ready_for_review
task: "#360 character chat character-specific greeting/tone copy contract"
branch: team2-backend/character-chat-persona-copy-360
commit: final hash recorded in Notion completion report
push: yes after final validation
main_reflected: no, review/merge pending
worktree_cleanup: yes after push and Notion completion report
changed_files:
- server/src/chat/chat.service.ts
- server/src/chat/chat.service.spec.ts
- server/src/chat/llm-provider.adapter.ts
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- npm.cmd test -- chat.service.spec.ts --runInBand
- npx.cmd prisma generate
- npm.cmd run lint -- --quiet src/chat/chat.service.ts src/chat/chat.service.spec.ts src/chat/llm-provider.adapter.ts
- npm.cmd run build
- git diff --check
result:
- Extended character-chat fallback copy as a complete per-character UI copy set: greeting, empty state, premium CTA copy, tone guide, and persona tags.
- Catalog/starter projections now expose `tone.guideKo`, `tone.guideSource`, and `personaTags` while keeping `copyContract` read-only and mutation-disabled.
- Added tests for per-character fallback greeting/empty/CTA/tone/persona isolation, CMS override safety, and provider runtime persona compatibility without wallet/order/provider-readiness side effects in read-only projections.
blocked_by:
- Viewer review, then frontend can render Korean fallback copy/tags without surfacing raw source enums or internal prompt/provider fields.
sensitive_values_recorded:
- none

---

status: ready_for_review
task: "#355 repost projection hidden/block tombstone hardening"
branch: team2-backend/feed-repost-tombstone-355
commit: final hash recorded in Notion completion report
push: yes after final validation
main_reflected: no, review/merge pending
worktree_cleanup: yes after push and Notion completion report
changed_files:
- server/src/community/community.service.ts
- server/src/community/community.service.spec.ts
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- npx.cmd prisma generate
- npm.cmd test -- community.service.spec.ts --runInBand
- npm.cmd run lint -- --quiet src/community/community.controller.ts src/community/community.service.ts src/community/community.service.spec.ts
- npm.cmd run build
- git diff --check origin/team2-backend/feed-thread-repost-share-contract-355...HEAD
result:
- Hardened repost embedded-original projection with viewer-aware hidden and active block relationship checks.
- If the viewer hid the original post or either side has an active block relationship with the original author, `post.repost.originalState` becomes `unavailable`, `tombstone` is `true`, and `originalPost` is `null`.
- Added tests for normal visible repost projection, viewer-hidden original tombstone, blocked author tombstone, and existing share no-mutation behavior.
- Kept source create rules public/published/non-deleted only, and did not open wallet, Lumina, order, settlement, payout, or paid-like mutations.
blocked_by:
- Viewer re-review, then Zoro merge.
sensitive_values_recorded:
- none

---

status: ready_for_review
task: "#355 lumina feed thread continuation/repost/share backend contract"
branch: team2-backend/feed-thread-repost-share-contract-355
commit: final hash recorded in Notion completion report
push: yes after final validation
main_reflected: no, review/merge pending
worktree_cleanup: yes after push and Notion completion report
changed_files:
- server/src/community/community.controller.ts
- server/src/community/community.service.ts
- server/src/community/community.service.spec.ts
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- npx.cmd prisma generate
- npm.cmd test -- community.service.spec.ts --runInBand
- npm.cmd run lint -- --quiet src/community/community.controller.ts src/community/community.service.ts src/community/community.service.spec.ts
- npm.cmd run build
- git diff --check
result:
- Added canonical `thread_continuation` endpoints for adding/listing continuation posts under an existing public root post. This is separate from normal comments/replies and separate from the legacy manual multi-piece thread path.
- Thread continuation create is login-required, root-author only, body-limited to 500 chars, and returns safe `404` for missing/deleted/private roots plus `403` for non-authors.
- Added login-required repost/quote repost contract with original post reference metadata and tombstone/unavailable projection policy for deleted/hidden/private/blocked originals.
- Added share URL/Web Share contract that returns a public path and count strategy without creating feed rows or wallet/Lumina/settlement/payout/order/paid-like mutations.
blocked_by:
- UI/API connection and QR/Cloud QA remain next; no frontend hardcode or wallet-linked behavior was opened.
next_needed:
- Viewer review, then Cloud UI can wire disabled/QA-safe controls against the separated thread continuation, repost, and share contracts.
sensitive_values_recorded:
- none

---

status: ready_for_review
task: "#348 premium chat donation order and ledger API contract"
branch: team2-backend/premium-chat-support-ranking-contract-348-349
commit: final hash recorded in Notion completion report
push: yes after final validation
main_reflected: no, review/merge pending
worktree_cleanup: yes after push and Notion completion report
changed_files:
- server/src/chat/premium-chat-support-contract.ts
- server/src/chat/chat.service.spec.ts
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- npm.cmd test -- chat.service.spec.ts --runInBand
- npm.cmd run lint -- --quiet src/chat/chat.controller.ts src/chat/chat.service.ts src/chat/chat.service.spec.ts src/chat/premium-chat-support-contract.ts
- npm.cmd run build
- git diff --check
result:
- Tightened the read-only premium chat support contract to version `2026-05-20.premium-chat-support.v3`.
- Added planned donation order projection details to donation create response and a `donationOrderLedger` contract for order status flow, immutable fields, ledger type, reference type, idempotency key scope, duplicate replay, and conflict replay.
- Kept donation create disabled. No POST donation, wallet debit, payment/order mutation, settlement, payout, chat message, or LLM mutation was opened.
- Documented validation order and no-mutation-before gates for auth, session ownership, room state, amount, and idempotency.
blocked_by:
- Actual donation create remains blocked until DB order/projection storage, wallet ledger type migration, moderation/refund projection, trust/identity limits, and settlement handling are implemented.
next_needed:
- Viewer review, then Cloud/frontend can use the read-only contract for disabled UI wiring only. Mutation buttons must remain disabled.
sensitive_values_recorded:
- none

---

status: ready_for_review
task: "#349 premium chat communication ranking API contract"
branch: team2-backend/premium-chat-support-ranking-contract-348-349
commit: final hash recorded in Notion completion report
push: yes after final validation
main_reflected: no, review/merge pending
worktree_cleanup: yes after push and Notion completion report
changed_files:
- server/src/chat/premium-chat-support-contract.ts
- server/src/chat/chat.service.spec.ts
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- npm.cmd test -- chat.service.spec.ts --runInBand
- npm.cmd run lint -- --quiet src/chat/chat.controller.ts src/chat/chat.service.ts src/chat/chat.service.spec.ts src/chat/premium-chat-support-contract.ts
- npm.cmd run build
- git diff --check
result:
- Added explicit ranking periods `daily`, `weekly`, `monthly`, and `all` to the read-only contract.
- Added response window, opaque cursor pagination, default/max take, communication score candidates, donation score basis, moderation filtering, and privacy guards.
- Ranking API remains disabled/planned and separate from Lumina Pick likes. No raw chat body, report reason, wallet ledger id, user id, or message id is exposed by the ranking contract.
blocked_by:
- Actual ranking read model remains blocked until server-side aggregation storage and moderation/refund filtering are implemented.
next_needed:
- Viewer review, then Cloud/frontend can wire ranking UI against disabled/read-only contract only.
sensitive_values_recorded:
- none

---

status: ready_for_review
task: "#342 Character chat per-character copy isolation follow-up"
branch: team2-backend/chat-copy-isolation-contract-342
commit: final hash recorded in Notion completion report
push: yes after final validation
main_reflected: no, review/merge pending
worktree_cleanup: yes after push and Notion completion report
changed_files:
- server/src/chat/chat.service.spec.ts
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- npm.cmd test -- chat.service.spec.ts --runInBand
- npm.cmd run lint -- --quiet src/chat/chat.controller.ts src/chat/chat.service.ts src/chat/chat.service.spec.ts
- npm.cmd run build
- git diff --check
result:
- Added regression coverage that calls `GET /api/v1/chat/character-catalog` and `GET /api/v1/chat/starter-prompts` service paths for two different character slugs in sequence.
- The test fixes the contract that CMS rows are resolved by `characterSlug` and `contentKey=character-chat.copy.<artistSlug>`, and that one character's welcome/starter copy does not leak into another character's response.
- The test also checks `copyContract.characterSlug`, `copyContract.contentKey`, `source=site_content`, raw persona prompt non-exposure, and no LLM/wallet/order/chat message mutation.
- Documented the #342 copy isolation rule for backend and frontend handoff.
blocked_by:
- none
next_needed:
- Viewer review, then merge. Frontend should use `copyContract` to verify projected copy source and must not display raw persona/provider/internal fields.
sensitive_values_recorded:
- none

---

status: ready_for_review
task: "#341 premium chat support and communication ranking API contract"
branch: team2-backend/premium-chat-ranking-api-contract-341
commit: final hash recorded in Notion completion report
push: yes after final validation
main_reflected: no, review/merge pending
worktree_cleanup: yes after push and Notion completion report
changed_files:
- server/src/chat/premium-chat-support-contract.ts
- server/src/chat/chat.service.spec.ts
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- npm.cmd test -- chat.service.spec.ts --runInBand
- npm.cmd run lint -- --quiet src/chat/chat.controller.ts src/chat/chat.service.ts src/chat/chat.service.spec.ts src/chat/premium-chat-support-contract.ts
- npm.cmd run build
- git diff --check
result:
- Tightened the read-only premium chat support contract to version `2026-05-20.premium-chat-support.v2`.
- Added explicit `apiContracts.donationPreview`, `apiContracts.donationCreate`, and `apiContracts.rankingsList` shapes with request, response, and error-code contracts.
- Kept donation/ranking endpoints disabled. No POST donation, wallet debit, order, settlement, payout, chat message, or LLM mutation was opened.
- Fixed the chat ranking contract to allow only `communication` and `donation`; like rankings remain on the Lumina Pick boost ranking lane.
- Documented server-authoritative wallet debit and idempotency behavior: same key/fingerprint replays the existing projection, different fingerprint returns `409` before wallet lookup.
blocked_by:
- Actual donation POST and live chat ranking read models remain blocked until DB event/projection storage, wallet ledger type migration, moderation/refund projection, trust/identity limits, and settlement handling are implemented.
next_needed:
- Viewer review, then frontend can wire disabled UI/read-only teaser states from the contract only. Mutation buttons must remain disabled.
sensitive_values_recorded:
- none

---

status: done
task: "#335 Character chat per-character copy CMS contract"
branch/commit: team2-backend/chat-copy-cms-contract-335 / pending push commit
changed_files:
- server/src/chat/chat.service.ts
- server/src/chat/chat.service.spec.ts
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- npx.cmd prisma generate
- npm.cmd test -- chat.service.spec.ts --runInBand
- npm.cmd run lint -- --quiet src/chat/chat.controller.ts src/chat/chat.service.ts src/chat/chat.service.spec.ts
- npm.cmd run build
- git diff --check
result:
- Added a read-only character-chat copy CMS adapter on top of existing `site_content_entries`.
- Published CMS rows use `scope=character`, `pageKey=character-chat`, `characterSlug=<artistSlug>`, `locale=ko-KR`, and `contentKey=character-chat.copy.<artistSlug>`.
- `GET /api/v1/chat/character-catalog` and `GET /api/v1/chat/starter-prompts` now prefer published site-content copy, then artist metadata, then character fallback, then default Korean copy.
- The response includes `copyContract`, `emptyState`, and `premiumChat` projections. Editable CMS fields are welcome/starter/empty/premium/status copy only; fixed UI labels remain outside CMS editing.
- Added regression coverage proving CMS copy overrides metadata, fallback remains available, and read-only catalog/starter projection performs no wallet, order, chat message, or LLM mutation.
- Persona source data, secret prompts, raw LLM payloads, wallet, order, settlement, and payout flows were not changed.
blocked_by:
- none
next_needed:
- Viewer review. Frontend can read `copyContract`/`emptyState`/`premiumChat` but must not display raw source enums or enable premium/wallet/order mutations from this projection.
sensitive_values_recorded:
- none

---

status: ready_for_review
task: Team2 Backend / Lumina Feed post edit-delete author-only contract
base: origin/main 11806cd
branch/commit: team2-backend/lumina-feed-edit-delete-contract / final hash in completion report
changed_files:
- server/src/community/community.service.ts
- server/src/community/community.service.spec.ts
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- npm.cmd run prisma:generate
- npm.cmd test -- community.service.spec.ts --runInBand
- npm.cmd run lint -- --quiet src/community/community.service.ts src/community/community.service.spec.ts
- npm.cmd run build
- git diff --check
contract_result:
- PATCH /lumina-feed/posts/:postId and DELETE /lumina-feed/posts/:postId remain login-required through JwtAuthGuard.
- Update/delete authorization is now author-only. Artist operator access no longer falls through for non-author feed edit/delete.
- Update keeps post id and authorUserId unchanged and only writes the body edit metadata scope.
- Delete remains a soft delete and repeated delete by the same author returns the same safe success shape without a second mutation.
- Non-author access returns 403 while deleted/non-visible post access can safely resolve as 404.
- Feed list and reply/detail visibility paths keep status=published and deletedAt=null projection filters.
- Invalid id, missing post, empty body, and >500 character body validation are covered by service specs.
blocked_by:
- Live UI/API connection QA still needs deployed endpoint smoke.
- Notion MCP client failed in this thread, so Notion status could not be updated from here.
sensitive_values:
- none recorded.
next_needed:
- Reviewer/QA should run API smoke for owner edit/delete, non-owner denial, and repeated delete after deploy.

---

status: ready_for_deploy
task: Team2 Backend / Preserve Metadata Diagnostic Error
branch/commit: pending commit
changed_files:
- server/src/assets/user-assets.service.ts
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd run lint
- npm.cmd run build
result:
- Rechecked the P0 confirm-upload failure after `/health` commit `4c2dee7de0086321b05dfd56b80b27cb58a68dc3`.
- Confirmed code intent: `readSourceMetadata()` throws `FEED_IMAGE_SOURCE_METADATA_FAILED` with source diagnostics, Sharp/libvips diagnostics, and sanitized reason.
- Root cause for losing that diagnostic: `runDerivativeStage()` only preserved `error instanceof BadRequestException`. In production/runtime module-boundary cases, that check can fail and wrap the original safe diagnostic as generic `FEED_IMAGE_DERIVATIVE_FAILED`.
- Patched `runDerivativeStage()`, `safeErrorMessage()`, and `safeErrorDetails()` to preserve any `HttpException`, plus duck-typed objects with `getStatus()` and `getResponse()`.
- Expected after deploy: read-source-metadata failures preserve response code `FEED_IMAGE_SOURCE_METADATA_FAILED` and include `details.source`, `details.sharp`, and sanitized `details.reason`.
- No signed URL, object URL, token, cookie, password, or env values were recorded.
blocked_by:
- Live verification requires deployment and rerunning the same PNG confirm-upload flow.
next_needed:
- Deploy this commit and confirm the failing PNG now returns `FEED_IMAGE_SOURCE_METADATA_FAILED` if Sharp metadata read still fails.
- Use the preserved diagnostics to decide between signed GET/body mismatch and Render Sharp/libvips runtime issue.

---

status: ready_for_deploy
task: Team2 Backend / Feed Image Metadata Failure Still Repro
branch/commit: pending commit
changed_files:
- server/src/assets/user-assets.controller.ts
- server/src/assets/user-assets.service.ts
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd run lint
- npm.cmd run build
- local Node sharp metadata probe with 1x1 PNG buffer and `failOn: none`
result:
- Render logs for requestId `be5ee0d9-3215-49a9-b2f9-201941bde4b3` could not be fetched from this workspace: no Render CLI/log cache is available locally, and no token/env values were read.
- The existing derivative logs did not include requestId, so Render-side filtering by requestId would not reliably correlate the source diagnostics with the failed confirm-upload request.
- Patched confirm-upload to pass `x-request-id` into derivative logging.
- Patched `read-source-metadata` failures to return/log `FEED_IMAGE_SOURCE_METADATA_FAILED` with safe source diagnostics and Sharp/libvips codec versions.
- Safe source diagnostics include only content type, content length, downloaded body length, detected magic-byte MIME, and first 16 bytes as hex. No storage keys, object URLs, signed URLs, tokens, cookies, passwords, or env values are recorded.
- If the downloaded buffer is a valid PNG by magic bytes but Render Sharp still fails metadata read, the next response/log will show `source.detectedMimeType=image/png`, PNG prefix hex, and Render Sharp/libvips/png versions for runtime diagnosis.
- Local Node can load Sharp and read a 1x1 PNG buffer with `failOn: none`.
blocked_by:
- RequestId-specific Render log verification requires Render log access outside this workspace.
next_needed:
- Deploy this commit and rerun the same PNG confirm-upload flow with a client-provided `x-request-id`.
- If it fails, inspect the safe error details/logs for `source.detectedMimeType`, `source.prefixHex`, body length, and `sharp` diagnostics.
- If `source.detectedMimeType` is `image/png` and prefix starts with PNG magic bytes but metadata still fails, treat it as Render Sharp/libvips runtime or unsupported PNG variant; otherwise treat it as signed GET/body mismatch.

---

status: ready_for_deploy
task: Team2 Backend / Feed Image Derivative Metadata Failure
branch/commit: pending commit
changed_files:
- server/src/assets/user-assets.service.ts
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd run lint
- npm.cmd run build
- local Node sharp metadata probe with a 1x1 PNG buffer
result:
- Follow-up deployment changed confirm-upload from 500 to safe 400, but QA still sees `FEED_IMAGE_DERIVATIVE_FAILED` at `read-source-metadata`.
- Code-level likely cause is that the S3 signed GET can return HTTP 200 with a non-image body, empty body, or unexpected error/document body; the previous code only checked `response.ok` before passing bytes to Sharp.
- Patched source download to record safe diagnostics only: response content type, content length, downloaded body length, detected image MIME from magic bytes, and first 16 bytes as hex.
- Added magic-byte validation for JPEG, PNG, WebP, and GIF before Sharp metadata read. Non-image bytes now fail at `download-source` with `FEED_IMAGE_SOURCE_NOT_IMAGE` instead of surfacing later as a generic Sharp metadata failure.
- Added a safe success log for source download diagnostics without storage keys, object URLs, signed URLs, tokens, cookies, passwords, or env values.
- Local Node runtime can load Sharp and read a 1x1 PNG buffer successfully. Render runtime still needs deploy-time confirmation from the new diagnostics.
blocked_by:
- Live root cause confirmation requires deploying this patch and rerunning the 1MB PNG confirm-upload flow.
next_needed:
- Deploy this commit and rerun the 1MB PNG reproduction.
- If confirm-upload still fails, use the safe response/log diagnostics to determine whether the body is XML/HTML/empty/non-image or whether Sharp fails despite valid PNG magic bytes.
- After 1MB PASS, rerun the 14MB image upload-intent, S3 PUT, confirm-upload, display URL, thumbnail URL, Feed card, and lightbox checks.

---

status: ready_for_deploy
task: Team2 Backend / Feed Image Pipeline Confirm Upload 500
branch/commit: pending commit
changed_files:
- server/src/assets/user-assets.service.ts
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd run lint
- npm.cmd run build
result:
- Rechecked the confirm-upload derivative path after Render applied the 20MB upload policy.
- Code root cause for the 500 class: derivative processing had unhandled failure paths around source metadata reads, Sharp transforms, and derivative uploads. Those could escape Nest's intended 4xx diagnostics as an internal error.
- Patched derivative processing with stage-scoped safe handling for source-key resolution, source download, source metadata read, display build, thumbnail build, and derivative upload.
- Added safe server logs for derivative failure stage, asset id, and sanitized reason only. Signed URLs, object URLs, tokens, cookies, passwords, and env values are not logged.
- Source download failures now return `FEED_IMAGE_SOURCE_READ_FAILED` with provider/status diagnostics only.
- Derivative upload failures now return `FEED_IMAGE_DERIVATIVE_UPLOAD_FAILED` with provider/status/mime diagnostics only.
- Unexpected Sharp/processing failures now return `FEED_IMAGE_DERIVATIVE_FAILED` with the failed stage instead of leaking as a generic 500.
- Display/thumbnail generation still prefers WebP, but now falls back to JPEG if WebP encoding fails in the runtime. This keeps the policy aligned with WebP/JPEG delivery and gives Render/libvips codec issues a recovery path.
blocked_by:
- Live PASS for 1MB and 14MB upload-intent -> S3 PUT -> confirm-upload requires deploying this patch.
next_needed:
- Deploy this commit and rerun the 1MB confirm-upload reproduction. Expected result is PASS, or a safe 4xx with a stage code if storage/runtime still blocks derivatives.
- Rerun the 14MB image upload flow and confirm display/thumbnail derivative objects are created.
- Recheck Feed card image, lightbox, display URL, and thumbnail URL after deploy.

---

status: ready_for_deploy
task: Team2 Backend / Media Upload Policy: feed image derivatives and 20MB limit
branch/commit: pending commit
changed_files:
- server/package.json
- server/package-lock.json
- server/src/assets/user-assets.controller.ts
- server/src/assets/user-assets.service.ts
- server/src/community/community.service.ts
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd run lint
- npm.cmd run build
policy:
- Lumina Feed image upload is image-only and remains separate from Shortform/Video asset handling.
- Accepted feed image MIME types remain `image/jpeg`, `image/png`, `image/webp`, and `image/gif`.
- Feed image upload max is 20MB. Server default is 20MB and `MAX_IMAGE_UPLOAD_BYTES` can override it for deployment. Oversized uploads return `PAYLOAD_TOO_LARGE` with `fileSizeBytes`, `maxBytes`, and `maxMegabytes` details.
- The server validates declared upload size at upload-intent time and validates actual uploaded object size from object-storage HEAD at confirm-upload time, so UI bypass with an oversized PUT is blocked before derivative processing.
- Original feed image preservation is explicit policy metadata: `originalPreserved: true` for v1. Delivery should prefer processed display/thumbnail derivatives; original remains available as a separate variant.
- Display derivative policy: WebP output, auto-rotate, no enlargement, long edge <= 2048px.
- Thumbnail derivative policy: WebP output, auto-rotate, no enlargement, long edge <= 768px.
- Video upload is out of feed image scope and should stay on a separate Shortform/Video asset pipeline. Lumina v1 recommendation is 512MB max for video, despite larger platform limits elsewhere.
result:
- Added `sharp` to the server so confirm-upload can generate feed image derivatives after the original object is present.
- Confirm-upload now reads the uploaded source object from S3/R2-compatible storage, creates display and thumbnail WebP objects under a derivative key path, uploads those derivative objects, and records non-secret derivative metadata on the asset row.
- Added public delivery variants: `/api/v1/assets/public/:assetId/original`, `/display`, and `/thumbnail`. Variant delivery still validates the asset is public, image type, not pending upload, and not archived before issuing a signed-read redirect.
- Feed API assets now return `url` as the display variant and also include `displayUrl` and `thumbnailUrl`, using absolute API-origin delivery URLs instead of raw object-storage URLs.
- Existing assets without derivative metadata fall back to original delivery, so old feed rows remain renderable while new uploads use optimized derivatives.
- No secret/token/password/env values or full signed URLs were recorded.
blocked_by:
- Live acceptance still requires deploy plus QA upload of a ~14MB image and browser verification that feed card and lightbox load through the API-origin variant URLs.
next_needed:
- Set/confirm the deployment upload-size env setting for the 20MB policy without recording secret values.
- Deploy this branch and verify upload-intent -> S3 PUT -> confirm-upload creates original, display, and thumbnail objects.
- Verify `/api/v1/assets/public/:assetId/display` and `/thumbnail` return 302 to signed read targets that resolve HTTP 200.
- Team2 QA should recheck `lumina-feed.html` card image and lightbox after deploy.

---

status: done
task: Storage/backend ops: signed asset delivery recheck
branch/commit: pending commit
changed_files:
- server/src/assets/user-assets.controller.ts
- server/src/assets/user-assets.module.ts
- server/src/assets/user-assets.service.ts
- server/src/community/community.service.ts
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd run lint
- npm.cmd run build
result:
- Rechecked the deployed signed delivery behavior reported by QA. Feed API was returning relative asset URLs (`/api/v1/assets/public/:assetId`), causing `lumina-feed.html` on the frontend origin to request the frontend host and receive 404.
- Patched `CommunityService.publicFeedAssetUrl()` so feed asset `url` and `thumbnailUrl` fall back to absolute API origin `https://api.lumina-stage.com` when no API public base env is configured. This keeps browser image requests on the backend API origin.
- Rechecked the API-origin 302 without recording the signed token. The deployed endpoint was redirecting to a raw S3 object URL without a signature, then S3 returned 403.
- Root cause from code path: existing uploaded asset rows can have a non-`s3/r2` `storageProvider`, so `getPublicAssetDeliveryUrl()` fell back to `buildPublicAssetUrl()` instead of generating a signed read URL.
- Patched `UserAssetsService.getPublicAssetDeliveryUrl()` to use the row provider when it is `s3/r2`, otherwise fall back to the currently configured object storage provider when that provider is `s3/r2`. This covers older user-image rows while keeping public-read closed.
- The public asset endpoint still validates `visibility=public`, image type, not pending upload, and not archived before redirecting.
- Signed URL/token/cookie/secret values were not recorded.
blocked_by:
- Live verification of `lumina-feed.html` card image and lightbox requires deploying this follow-up backend change.
- Direct provider-side checks for bucket policy, object ACL, Block Public Access, and CORS require AWS/S3 console or equivalent credentials.
next_needed:
- Deploy this backend change and verify Feed API returns absolute `https://api.lumina-stage.com/api/v1/assets/public/:assetId` URLs.
- Verify `/api/v1/assets/public/:assetId` returns 302 to a signed read target and following the redirect returns HTTP 200.
- Team2 QA should recheck Lumina Feed card image and lightbox image after deploy.
- Ops should still decide long-term delivery mode: public CDN/read policy for public assets, or keep signed read redirect/proxy as the official delivery path.

---

status: done
task: Storage/backend ops: signed read target 403 follow-up
branch/commit: pending commit
changed_files:
- server/src/assets/user-assets.service.ts
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd run lint
- npm.cmd run build
result:
- Rechecked the deployed signed redirect without recording signed query values. The API public asset endpoint returns 302, but the signed target returns 403 with an S3 `AccessDenied` response that mentions missing `s3:ListBucket`.
- That S3 response can happen when the signed request is valid but the object key does not resolve and the IAM user is not allowed to reveal object absence via bucket listing.
- Added public delivery key resolution for object storage assets. Before returning a signed GET redirect, the server now probes signed HEAD candidates for the stored key plus `OBJECT_STORAGE_KEY_PREFIX` added/removed variants, then signs the first readable key.
- Kept public read closed and did not record signed URL/token/cookie/secret values.
- Fixed signed read URL TTL handling to honor `OBJECT_PUBLIC_READ_URL_TTL_SECONDS` instead of a hardcoded 60 seconds.
blocked_by:
- Live verification requires deploying this backend change.
next_needed:
- Deploy this backend change and verify `/api/v1/assets/public/:assetId` 302 redirect target returns HTTP 200.
- Team2 QA should recheck Lumina Feed card image, lightbox image, and fallback state after deploy.

---

status: blocked
task: Storage/backend ops: signed target 403 after 467f4dc
branch/commit: main deploy `467f4dc`, live `/health` reported `37735de718f0e6605248fb7903f636d33ae6ae75`
changed_files:
- docs/ops/inbox/team2-backend.md
tests:
- not run; documentation/ops triage only
result:
- QA confirmed the public asset endpoint returns 302 and the signed target host/path points at the expected S3 bucket/key shape.
- Signed target still returns 403 `AccessDenied`, with an S3 message that the IAM user is not authorized to perform `s3:ListBucket`.
- This is not the same failure mode as a malformed signature. A bad SigV4 URL would normally produce a signature/authorization mismatch error. The current message is consistent with S3 being unable to reveal whether the object key exists because the principal lacks bucket listing permission.
- Most likely current root cause: the DB `storageKey` and all server fallback key candidates do not match an existing object key in the bucket. Without `s3:ListBucket`, S3 returns 403 instead of a clear not-found signal for missing keys.
- Secondary thing to confirm: the IAM principal used by the backend has `s3:GetObject` for the relevant object prefix. If object exists and `GetObject` is missing, signed reads will also fail, but the reported `ListBucket` action points first at key-existence/list diagnostics.
- Existing feed asset rows may be pointing at objects that were never uploaded, were uploaded under a different key/prefix, or were deleted/moved after the DB row was marked uploaded.
- Public read remains closed; no secret/token/password/env values or full signed URLs were recorded.
blocked_by:
- Bucket contents, object ACLs, IAM policy, Block Public Access, and CORS require S3/provider console or CLI access. They cannot be proven from the repo without credentials.
next_needed:
- In S3/provider console, check whether the exact object key for the failing feed asset exists in the bucket.
- Compare the DB `assets.storageKey` value with the actual object key. If the object is under a prefix variant, update either object location or DB rows consistently.
- Confirm the backend IAM principal has `s3:GetObject` on the user-image object prefix used by feed assets.
- For diagnostics, grant narrowly scoped `s3:ListBucket` only on the bucket with a prefix condition for the feed/user-image prefix, so missing-key cases return clear diagnostics instead of ambiguous 403. This can be temporary or kept as an ops-only diagnostic permission.
- If the object is missing, treat affected feed asset rows as broken uploads: re-upload the object, relink the feed asset to an existing object, or mark/archive the asset row so feed does not render a broken image.
- CORS is still worth checking for browser rendering, but it is not the first blocker while direct signed URL access returns 403.

---

status: done
task: "#314 character chat persona/starter runtime application"
branch/commit: team2-backend/character-chat-persona-runtime-314 / pending push commit
changed_files:
- server/src/chat/chat.service.ts
- server/src/chat/llm-provider.adapter.ts
- server/src/chat/chat.service.spec.ts
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- npm.cmd test -- chat.service.spec.ts --runInBand
- npm.cmd run lint -- --quiet src/chat/chat.service.ts src/chat/chat.service.spec.ts src/chat/llm-provider.adapter.ts
- npm.cmd run build
- git diff --check
result:
- Character chat catalog and starter prompt projections now include `runtimePersona`, preserving character-specific welcome text, starter options, tone tags, forbidden tone/blocked-expression notes, and safety note without LLM, wallet, order, settlement, or payout mutation.
- Generation now loads the active artist profile metadata for the owned session and sends the runtime persona context to the provider request before generation, while leaving preflight/cooldown/daily/provider failure guards intact.
- Provider instructions now incorporate the runtime persona summary internally; raw prompt, API key, token, provider raw response, and full generated text are not returned or recorded.
- Provider disabled/failure fallback paths remain fail-closed or safe fallback as before; read-only welcome/starter projections remain character-specific because they do not depend on provider readiness.
- Minimum three-character verification covered distinct warm/quiet, calm/distant, and playful/high-energy runtime tone summaries without recording generated response bodies.
blocked_by:
- none
next_needed:
- Viewer review, then deploy/smoke against staging with provider enabled using summary-only tone checks.
sensitive_values_recorded:
- none

---

status: done
task: "#330 site-content CMS archived key restore"
branch/commit: team2-backend/site-content-restore-330 / pending push commit
changed_files:
- server/src/site-content/site-content.controller.ts
- server/src/site-content/site-content.service.ts
- server/src/site-content/site-content.service.spec.ts
- backstage-site-content.js
- backstage/index.html
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- npx.cmd prisma generate
- npm.cmd test -- site-content.service.spec.ts --runInBand
- npm.cmd run lint -- --quiet src/site-content/site-content.controller.ts src/site-content/site-content.service.ts src/site-content/site-content.service.spec.ts
- npm.cmd run build
- node --check backstage-site-content.js
- git diff --check
result:
- Added super-admin-only `POST /api/v1/admin/api/v1/backstage/site-content/:id/restore`.
- Archived CMS rows can now be restored to `draft` by default, or directly to `published` when safe non-empty content is present.
- Restore clears archived metadata, updates version/updatedBy, and writes a `restore` audit log. Repeated restore on non-archived rows is idempotent and does not create another audit row.
- Duplicate create for an archived `contentKey + locale` now returns `SITE_CONTENT_KEY_EXISTS` with `recoverable=true`, `existingEntryId`, and restore path details instead of leaving the key as a dead end.
- Backstage site-content editor shows a Restore button for archived rows and keeps save/publish/archive disabled until restore.
- Public bootstrap remains published-only; draft and archived rows remain hidden. HTML/script validation remains unchanged.
- Wallet, Lumina, order, settlement, and payout mutations were not touched.
blocked_by:
- none
next_needed:
- Viewer review, then #325 QR1 live reQA can restore the archived `characters.hero.body` safe test row or verify the restore flow before rerunning draft/publish/archive/public bootstrap checks.
sensitive_values_recorded:
- none

---

status: done
task: "#328 premium chat support and ranking API contract"
branch/commit: team2-backend/premium-chat-ranking-contract-328 / pending push commit
changed_files:
- server/src/chat/premium-chat-support-contract.ts
- server/src/chat/chat.controller.ts
- server/src/chat/chat.service.ts
- server/src/chat/chat.service.spec.ts
- docs/backend-api-spec.md
- docs/frontend-api-handoff.md
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- npm.cmd test -- chat.service.spec.ts --runInBand
- npm.cmd run lint -- --quiet src/chat/chat.controller.ts src/chat/chat.service.ts src/chat/chat.service.spec.ts src/chat/premium-chat-support-contract.ts
- npm.cmd run build
- git diff --check
result:
- Added authenticated read-only `GET /api/v1/chat/premium-support-contract` so frontend can wire premium-chat support UI policy without opening wallet mutation.
- Contract includes fixed support amounts `10/50/100/500/1000/5000/10000/50000L`, custom support bounds, idempotency rules, blocked-room fail-closed states, high-value review policy, and future preview/create endpoint templates.
- Contract keeps donation create disabled with `walletMutationEnabled=false` and `endpoints.donationCreate.enabled=false`.
- Documented ledger sources `premium_chat_open`, `premium_chat_message`, `premium_chat_donation` and the required future ledger type/storage migration before POST donation can be enabled.
- Documented ranking separation: Lumina Pick/like ranking excludes premium chat donations; communication ranking and donation ranking use separate planned `/chat/rankings` lanes.
- Added regression coverage proving the contract returns without wallet, ledger, order, chat message, settlement, or payout mutation calls.
blocked_by:
- Actual donation POST remains blocked until DB event/projection storage, wallet ledger type migration, trust/identity limits, refund/moderation policy, and settlement run handling are implemented.
next_needed:
- Viewer review, then Cloud/frontend can use the read-only contract for disabled UI wiring only. POST donation, settlement, payout, and wallet mutation must remain disconnected.
sensitive_values_recorded:
- none

---

status: done
task: "#314 QA FAIL follow-up: character-specific starter fallback"
branch/commit: team2-backend/character-chat-starter-projection-314 / pending push commit
changed_files:
- server/src/chat/chat.service.ts
- server/src/chat/chat.service.spec.ts
- server/prisma/seed.ts
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd test -- chat.service.spec.ts --runInBand
- npm.cmd run lint -- --quiet src/chat/chat.service.ts src/chat/chat.service.spec.ts src/chat/llm-provider.adapter.ts
- npm.cmd run build
- npx.cmd tsc --noEmit --skipLibCheck --module commonjs --target ES2021 --moduleResolution node prisma/seed.ts
- git diff --check
result:
- Fixed the QA FAIL where live character chat catalog/starter fallback labels were identical across characters when artist metadata had no `chatStarterPromptSets`.
- Added backend slug-specific read-only fallback welcome/starter copy for yoon-serin, han-seoyul, park-doa, choi-seojin, and min-chaeon.
- `getCharacterChatCatalog()` and `getStarterPrompts()` now report and reuse the character fallback through the same runtime persona path when metadata is empty.
- Added regression coverage proving 5 fallback characters return distinct greeting text and distinct starter labels without provider calls or mutations.
- Added min-chaeon to the seed public active slug source via `site-selected` assets so chat catalog/starter endpoints can resolve it after seed/deploy instead of returning 404 for a static exposed character.
- Wallet, order, settlement, payout, provider generation, prompt logging, and raw provider response behavior were not changed.
blocked_by:
- Live min-chaeon 404 fix requires deploy/seed to update the DB row status.
next_needed:
- Viewer review, then live QA should recheck authenticated yoon-serin/han-seoyul/park-doa/choi-seojin starter labels and min-chaeon catalog/starter status after deploy/seed.
sensitive_values_recorded:
- none

---

status: done
task: "#332 Lumina Feed thread API contract verification"
branch/commit: team2-backend/feed-thread-contract-332 / pending push commit
changed_files:
- docs/ops/inbox/team2-backend.md
verified_contract:
- `POST /api/v1/lumina-feed/posts/thread` creates a manual thread with the root body stored on the normal feed post and each item capped at 500 characters.
- The thread max is 10 pieces including the root. The backend rejects 11 pieces and overlong piece bodies before mutation.
- `PATCH /api/v1/lumina-feed/posts/:postId/thread-items/:itemId` and `DELETE /api/v1/lumina-feed/posts/:postId/thread-items/:itemId` are login-required and author-only for non-root thread items.
- Root post edit/delete remains author-only and preserves post id/author id.
- Feed list, detail, and replies stay scoped to `status=published` and `deletedAt=null`; deleting a root post hides the full thread from public projections.
- Repeated delete on both root posts and thread items is idempotent and does not perform a second mutation after the deleted state is reached.
tests:
- npm.cmd ci
- npx.cmd prisma generate
- npm.cmd test -- community.service.spec.ts --runInBand
- npm.cmd run lint -- --quiet src/community/community.controller.ts src/community/community.service.ts src/community/community.service.spec.ts
result:
- PASS. The current main already contains the thread API contract and service-level tests for parent/root projection, child item projection, owner-only edit/delete, validation, and delete idempotency.
- No wallet, Lumina, order, settlement, payout, provider, token, cookie, or raw DB value behavior was touched.
blocked_by:
- none
next_needed:
- Viewer review, then Cloud can continue #333 UI wiring against the fixed contract. POST/UI wiring must keep root-only likes/comments/images semantics.
sensitive_values_recorded:
- none

---

status: done
task: "#314 reviewer P1 fix: generation runtime persona select"
branch/commit: team2-backend/character-chat-persona-runtime-314 / pending push follow-up commit
changed_files:
- server/src/chat/chat.service.ts
- server/src/chat/chat.service.spec.ts
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd test -- chat.service.spec.ts --runInBand
- npm.cmd run lint -- --quiet src/chat/chat.service.ts src/chat/chat.service.spec.ts src/chat/llm-provider.adapter.ts
- npm.cmd run build
- git diff --check
result:
- Fixed the reviewer P1: `getOwnedSessionForGeneration()` now selects the artist public metadata, tagline, personality keywords, and content tone needed by `buildCharacterRuntimePersonaContext()` before provider generation.
- Reverted the accidental broader artist include on `createSession()`, keeping the expanded select scoped to the generation path.
- Strengthened the provider beta test so the actual Prisma generation-session select shape must include `publicProfile` and `contentProfile` before asserting runtime persona injection.
- Wallet, order, settlement, payout, API endpoint, provider readiness, cooldown, and daily-limit guard behavior were not changed.
blocked_by:
- none
next_needed:
- Viewer re-review on updated branch.
sensitive_values_recorded:
- none

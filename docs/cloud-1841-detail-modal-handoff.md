# Cloud #1841 Catalog Detail Candidate

Date: 2026-09-14 KST. Cloud-role subagent for Chamo, not the pinned Cloud task.
Branch: `codex/cloud-1841-detail-modal-20260914`.
Base: `d2bfe7021d8a2d4ccb25652ee5885a098beacf48`, fetched before branching.
Final commit/tree identifiers are reported with the frozen candidate to PM.

## Scope

Reused clean `E:/CodexMovedCache/worktrees/restart-baseline-1888-20260913` after checking status, E ancestors and applicable source directories for AGENTS.md (none found). Read the PM restart instructions/current #1841/#1870 records and `docs/cloud-1870-first-release-ui-handoff.md`. Previous HEAD `7d38470` and old reference `79a11d6` were not merged/reset/cherry-picked.

Only these files belong to the candidate:

- `pages/story-stage.js`
- `styles/story-stage.css`
- `story-stage/index.html`
- `tests/story-stage-first-release.test.mjs`
- `tests/story-stage-catalog.test-support.mjs`
- `tests/story-stage-server-contract.mjs` (completed-reentry follow-up)
- This document.

No server/API/schema/package, story-upload, artist/profile/shared app, board or Notion edits. No installation, build, main integration or deployment. Luffy's separate offline converter worktree was not modified.

## Actual Contract

Source is the base server, not an invented UI DTO:

- `StoryCatalogQueryDto` supports only `locale`, UUID `cursor`, and `limit` (max 30). The UI sends limit 12, follows `nextCursor`, and applies an explicitly local price filter to the loaded cards. The count is visible loaded items / all loaded items, not a fabricated server total. No search/category/availability filter is sent to the backend.
- `catalog()` returns `items` with `id`, `slug`, localized `{value, locale, fallback}` title/summary, `cover`, `publishedAt`, `access`, `releaseCapability`. Its source query already excludes unpublished/private fixtures and requires an active published release. The UI calls only this public collection; it has no fallback story dataset.
- Catalog has no part count, lifecycle label, author or genre projection. Those fields are omitted. Detail `parts.length`, part position/title/pricing are displayed from actual published part projections. There is no author field in current detail either; the UI does not guess from owner/account IDs.
- Both public catalog and detail use OptionalJwtAuthGuard. Detail is a public GET without `auth:true`, so anonymous viewers can open the modal without an owner fetch or forced refresh. The shared `apiFetch` only supplies Bearer auth when requested. Personalized information is read separately from `GET /me/stories/:workId/access?locale=...` using the existing `isLoggedIn`/`apiFetch` conventions.
- `access.pricing.amountLumina`, `currencyCode: LUMINA`, `free`, `accessible`, `status`, and explicit `actions` are authoritative. Compatibility `entitled` means accessible in the service, not necessarily purchased. Anonymous free access still has primary `sign_in` and cannot start. Missing/contradictory legacy action data never enables a start.
- Reader access returns `workId`, `slug`, `access`, `replay`, and `aiCapability`, but no session ID. A further owner `GET /me/stories/:workId/progress-state` checks resumability/version status and release capability before start/continue. This endpoint takes no locale query. Missing, stale, unknown, and version-mismatch states remain unavailable with a read retry. The original completed-state block was a defect corrected in the follow-up below. Release policy requires active configured capability, first-release max-three/custom-false, and consistent capability revisions.
- Neither detail nor reader access/progress-state supplies a session ID. Allowed Start and Continue use the existing `POST /stories/:workId/progress` with `{mode:"continue", locale}`. Only its actual UUID `progressId`, positive revision and valid max-three choices projection authorize navigation to the existing reader URL with the known work ID. No stored-session scan, guessed ID, `id` fallback, restart mutation or invented `afterRevision` query.
- The existing #1870 reader/choice/reset/current-scene/graph implementation remains in place. Full=1/act=3 reset policy, disabled custom input, completed scene:null, revision floors and locale-only current-scene reads retain their regression tests.

## Purchase Boundary: #1837

The backend **does have** `POST /stories/:workId/purchase` with `Idempotency-Key`. `purchaseWork()` checks entitlement/idempotent ledger state and debits the then-current `work.priceLumina` before granting the entitlement. This is not a missing backend endpoint.

However, the detail/access projections provide no checkout URL, and the controller accepts no displayed-price/release/quote confirmation DTO. `pages/charge.js` operates on payment product IDs and payment orders for wallet charging; it is not an existing work-specific story checkout or a safe substitute. The UI cannot guarantee that a price displayed before a concurrent price change is the price that this purchase endpoint would debit.

Accordingly this candidate shows the actual price and, where server actions require purchase, a disabled Purchase button with a localized unavailability reason. It does not call purchase, charge the wallet, link to invented checkout/charge URLs, grant entitlement, invent free access, or suggest a custom-choice upsell. No uncertain purchase retries exist because no purchase command is issued. PM has routed the missing approved purchase confirmation/integration to #1837 Luffy; that work is outside this candidate.

## Modal and Async Behavior

- Native modal dialog lives over the existing catalog DOM, with the browser top layer making surrounding navigation inert. Close and Escape invalidate reads immediately and restore focus/scroll; card opens push history, closes return to the prior catalog entry, direct-slug closes remove only slug/pack, Back/Forward remain supported.
- Detail header/close and action footer remain outside the scrollable synopsis/parts body. No manuscript, author IDs, QA status, working-copy panel or speculative AI controls are rendered. The source header/empty copy no longer promises completed works or narrates publication QA.
- Catalog failure differs from a valid empty list; detail failure never substitutes a catalog card. Owner access/read failure keeps public information but blocks mutations. Localized errors replace backend message keys/diagnostics and provide explicit GET retry.
- Epoch/slug/locale and work-ID checks reject stale detail/access results. Start is single-flight across closing/reopening and locale changes; old completion cannot navigate a newer modal. Auth-expired events invalidate personalized actions. Network/lost/invalid start responses do not automatically replay a POST.
- Opening/reloading detail does not submit anything. Browser navigation to the reader occurs only after the explicit enabled action and a valid server response.

## Verification

All functional tests run actual page HTML/CSS/JS and handlers. The new fixture extracts the actual shared `apiFetch` from app.js; only login/token/refresh helpers are synthetic. It does not initialize the rest of shared app/auth UI. Every browser request is fulfilled from an explicit local/API fixture whitelist or aborted; no route continues/falls back to network. Service workers are blocked, DNS/background networking disabled, auth cookies absent. No provider/DB/payment/publishing/story-progress mutation occurred live.

One existing Chrome process is shared serially by the new suite and the original 79 reader tests. C Chrome is an existing read-only executable; profiles/TEMP/TMP/dependencies/results/captures are E-only. PM explicitly granted and received launch/exit notices for the exclusive heavy slot. No server is required or started. The intercepted `http://127.0.0.1:18700` address is NOT a usable preview URL.

Evidence directory: `E:/CodexMovedCache/tmp/restart-baseline-1888-20260913/cloud-1841-ui/`.

- `first-results.tap`: 122/139 PASS; all original 79 PASS. New tests exposed initial dialog focus, direct-link focus, and smooth-scroll restoration/test setup issues. Initial failed assertions emitted no detail screenshots.
- `focus-results.tap`: 16/17 PASS after focus fixes. All 15 locale/viewport dialog focus/hit tests passed and produced the required screenshots. The remaining scroll assertion was affected by shared smooth scrolling.
- `scroll-results.tap`: 1/1 PASS after explicit instant restoration and deterministic initial scroll. No third recurrence of that scroll failure.
- `final-results.tap`: original `e16e9a6` **140/140 PASS**, 165.8 seconds: 61 catalog/detail cases plus all original 79 reader/reset cases. This predates QR1's completed-reentry finding and is not a full run of the corrected candidate. The only runtime change after screenshot generation at that point was instant catalog scroll restoration; no layout code changed. All contexts and Chrome closed, and PM received the heavy-slot release before lightweight checks/commit.
- `raw-key-results.tap`: **46/46 PASS**; current copy guard **7/7 checks PASS** (including five-locale ACCESS_COPY). All three JS files pass Node syntax checks; `git diff --check` passes. No backend build/Jest or live API verification is claimed.
- `{ko,en,ja,zh-Hans,zh-Hant}-{390,400,1280}-detail.png`: 15 captures, once only. They are deliberately private synthetic QA with an existing local brand bitmap substituted by the private test router, not real uploaded story covers or manuscript evidence. Visual review covered all five locales. Tests check actual image load, footer/close hit targets, Tab/Shift-Tab containment, scroll overflow and buttons after scrolling to the bottom.

The reader screenshot-write flag disables duplicate capture generation only; all original reader layout/focus/hit-test assertions still execute. No broad unrelated browser reruns or new 30-image reader batches.

Reproduce from the E worktree, after reserving a browser slot:

```powershell
$env:TEMP='E:/CodexMovedCache/tmp/restart-baseline-1888-20260913'
$env:TMP=$env:TEMP
$env:NODE_PATH='E:/CodexMovedCache/tmp/restart-baseline-1888-20260913/qa-parser/node_modules'
$env:STORY_UI_PLAYWRIGHT='E:/CodexMovedCache/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:STORY_UI_BROWSER='C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:STORY_UI_ARTIFACTS='E:/CodexMovedCache/tmp/restart-baseline-1888-20260913/cloud-1841-ui'
$env:STORY_UI_READER_CAPTURES='0'
$env:STORY_UI_DETAIL_CAPTURES='0'
& 'E:/Program Files/nodejs/node.exe' --test --test-concurrency=1 tests/story-stage-first-release.test.mjs
& 'E:/Program Files/nodejs/node.exe' --test server/scripts/verify-story-stage-no-raw-key.test.mjs
& 'E:/Program Files/nodejs/node.exe' server/scripts/verify-story-stage-no-raw-key.mjs
& 'E:/Program Files/nodejs/node.exe' --check pages/story-stage.js
& 'E:/Program Files/nodejs/node.exe' --check tests/story-stage-catalog.test-support.mjs
git diff --check
```

## Emily and Remaining Checks

Emily review required in all five locales for seven new `ACCESS_COPY` keys: `filterLabel`, `all`, `loadMore`, `purchase`, `purchaseUnavailable`, `detailUnavailable`, `accessFailed`. Also review the two revised `COPY` keys `description` and `emptyBody`; the Korean heading description is synchronized in HTML. No copy approval is claimed. Existing #1870 seven-key review is separate and preserved.

### Emily Follow-Up (2026-09-14)

PM reported Emily's completed review of `e16e9a6dddf0c2d5b2d124cca46d4556048dabfe`: eight keys PASS; only `ACCESS_COPY.purchaseUnavailable` required replacement in all five locales to describe this page's missing checkout integration, not a temporary story outage. This follow-up applies exactly the supplied values: ko `이 화면에서는 작품을 구매할 수 없습니다.`, en `Stories cannot be purchased on this page.`, ja `この画面では作品を購入できません。`, zh-Hans `无法在此页面购买作品。`, zh-Hant `無法在此頁面購買作品。`. No runtime logic or other copy changes; existing tests contain no matching literal assertion to update.

The original `e16e9a6` 140/140 browser evidence, 15 images and evidence manifest remain unchanged. This follow-up uses lightweight raw-key/copy/syntax/diff checks only; it does not claim a new browser run. QR1 owns the reserved browser slot and will run the final candidate independently. The earlier pending-review paragraph records the initial candidate state and is superseded by this note for these nine keys only.

PM separately assigns independent QR1/QR2 and small integration. Remaining gaps: actual published catalog is known to have zero works (not re-uploaded or fabricated here); authorized real-content/cover/author projections, real live auth and account transitions, real entitlement expiry/revocation and persistence/concurrency, screen-reader acceptance, approved checkout/price-confirmation integration (#1837), and production deployment. Synthetic expired/revoked cases exercise the actual resulting purchase-required projection, not live entitlement-clock or DB behavior. Catalog version-mismatch is safely blocked, but current read DTOs expose no session ID with which to open a reset for that work; no discovery mutation is invented. This candidate is not ticket-wide completion or approval to integrate main.

## Completed Reentry Correction (After 84f87ac)

QR1 independently executed actual server method bodies and found two failures despite the earlier synthetic 140/140 result. Original evidence remains at `E:/CodexMovedCache/tmp/qr1-modal-84f87ac/initial-evidence/independent-20.tap` (18 PASS / 2 FAIL), with explanation in `QR1-REPORT.md`. This was a UI contract error, not a requested policy change or a reason to weaken the guard.

Actual source contract:

- `story-production.service.ts` `readerAccess` uses `Boolean(progress.currentSceneId)` for access primary/canContinue/replay.continue, but `Boolean(progress)` for `replay.reset`. Thus completed-with-scene returns primary continue, whereas completed-null returns primary start/canStart true/replay.continue false. Both have an existing progress, proven by replay.reset true.
- `story-progress-control.service.ts` `publicState.canResume` is false for completed progress because it describes an active scene. It does not forbid reading an ending. `storyProgressStatusKey` gives version mismatch priority, then reset quota exhaustion, then completed. Therefore a completed ending with both reset quotas exhausted has quotaExhausted, not completed.
- `startProgress` with mode continue returns `currentProgress` for the same existing ID after its access/version checks; it does not create a progress, reset, grant entitlement, or charge. `currentProgress` explicitly returns status completed with scene:null. A first-ever free read emits noProgress (not_started is a test scenario name, not a wire value).

The runtime change is limited to `detailAction`. With all existing price/access/release/revision/part checks intact, an owner projection proving existing progress and allowing the matching start/continue action can reopen completed or quota-exhausted progress even when canResume is false. The CTA says Continue and submits the unchanged `{mode:"continue", locale}` to the existing work route. It navigates only using the returned progressId. No new route, DTO, payment, reset, server implementation or copy change.

The former `completed existing progress ... blocked` synthetic test supplied an owner with `replay.reset:false`, meaning no existing progress. It is now explicitly named as contradictory state/owner data and remains blocked. Positive regressions instead derive detail/access/state/start/current from actual server method bodies using `tests/story-stage-server-contract.mjs`. TypeScript AST extraction and policy execution follow QR1's approach; storage/entitlement/scene assembly are local doubles, and no server or DB is started. Seventeen new tests cover both ending shapes, free/owned, exhausted quotas, no-write same-ID/revision navigation, first-ever free start, real version/access denial, malformed projections, and duplicate/late completion. Full suite now contains 157 cases; independent QR1 owns the final full run.

Targeted results on the corrected runtime (no full-suite rerun or new captures by Cloud):

- `completed-qr1-target.tap`: **7/7 PASS**, 13.0s. Unmodified QR1 two failed cases plus first-ever free, active exhausted quota, direct completed-null reader, auth expiry and duplicate/locale race. QR1's own harness refreshed top-level JSON summaries as documented; both private source scripts and the archived original 18/20 TAP retain identical SHA256 hashes.
- `completed-author-target.tap`: **28/28 PASS**, 36.4s. All 17 actual-server regressions plus 11 adjacent critical cases, including reset revision-floor and prior-session race checks.
- Both runs used one Chrome at a time, known local fulfillment/abort only, E profiles/cache/logs, no images, install/build/live requests. All browser contexts/processes exited and PM received heavy-slot release before freeze.

Reproduce the author's targeted run with the earlier E environment and these additions:

```powershell
$env:STORY_UI_SERVER_DEPS='E:/Codex/LuminaStage/ai-entertainment-studio-git/server/node_modules'
$env:STORY_UI_READER_CAPTURES='0'
$env:STORY_UI_DETAIL_CAPTURES='0'
& 'E:/Program Files/nodejs/node.exe' --test --test-concurrency=1 --test-name-pattern='catalog server:|catalog: (completed state|version mismatch|release revision race|pending start|lost start|invalid id|missing revision)|reset receipt minimum revision|late prior-session' tests/story-stage-first-release.test.mjs
```

## Raw-Key Discrepancy Triage

QR1's optional guard run was **45/46**, failing the synthetic `controlTr allows filtered lookups with literal and conditional fallbacks` case. QR1's separate seven-check CLI was **not run** and must not be included in their PASS count. The checked-in-page test passed. Original QR1 results remain intact.

Cloud set the exact approved `NODE_PATH=E:/CodexMovedCache/tmp/restart-baseline-1888-20260913/qa-parser/node_modules` and reran the unchanged guard/tests with E Node v22.14.0. The single failed-name target passed **1/1** (`qr1-raw-key-target.tap`); the full guard passed **46/46** (`qr1-raw-key-full.tap`). This failed synthetic case does not use the changed modal condition. No guard source or guard test expectation was changed.

Actual `createRequire` resolution from the guard is `E:/CodexMovedCache/worktrees/restart-baseline-1888-20260913/server/node_modules/typescript/lib/typescript.js`, TypeScript **5.9.3**, both with the approved NODE_PATH and with it unset. Local module resolution wins over NODE_PATH, so the evidence does **not** establish a parser-path/environment cause. The guard catches VM errors, including a 100ms execution timeout, as false; a timing explanation remains unproven. Classification: not reproduced in the prescribed serial environment, original discrepancy still unexplained, no claimed repair or new runtime copy defect.

Exact lightweight reproduction from the E worktree:

```powershell
$env:TEMP='E:/CodexMovedCache/tmp/restart-baseline-1888-20260913'
$env:TMP=$env:TEMP
$env:NODE_PATH='E:/CodexMovedCache/tmp/restart-baseline-1888-20260913/qa-parser/node_modules'
& 'E:/Program Files/nodejs/node.exe' --test --test-name-pattern='controlTr allows filtered lookups with literal and conditional fallbacks' server/scripts/verify-story-stage-no-raw-key.test.mjs
& 'E:/Program Files/nodejs/node.exe' --test server/scripts/verify-story-stage-no-raw-key.test.mjs
```

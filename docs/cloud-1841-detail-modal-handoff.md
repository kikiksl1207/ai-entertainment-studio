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
- This document.

No server/API/schema/package, story-upload, artist/profile/shared app, board or Notion edits. No installation, build, main integration or deployment. Luffy's separate offline converter worktree was not modified.

## Actual Contract

Source is the base server, not an invented UI DTO:

- `StoryCatalogQueryDto` supports only `locale`, UUID `cursor`, and `limit` (max 30). The UI sends limit 12, follows `nextCursor`, and applies an explicitly local price filter to the loaded cards. The count is visible loaded items / all loaded items, not a fabricated server total. No search/category/availability filter is sent to the backend.
- `catalog()` returns `items` with `id`, `slug`, localized `{value, locale, fallback}` title/summary, `cover`, `publishedAt`, `access`, `releaseCapability`. Its source query already excludes unpublished/private fixtures and requires an active published release. The UI calls only this public collection; it has no fallback story dataset.
- Catalog has no part count, lifecycle label, author or genre projection. Those fields are omitted. Detail `parts.length`, part position/title/pricing are displayed from actual published part projections. There is no author field in current detail either; the UI does not guess from owner/account IDs.
- Both public catalog and detail use OptionalJwtAuthGuard. Detail is a public GET without `auth:true`, so anonymous viewers can open the modal without an owner fetch or forced refresh. The shared `apiFetch` only supplies Bearer auth when requested. Personalized information is read separately from `GET /me/stories/:workId/access?locale=...` using the existing `isLoggedIn`/`apiFetch` conventions.
- `access.pricing.amountLumina`, `currencyCode: LUMINA`, `free`, `accessible`, `status`, and explicit `actions` are authoritative. Compatibility `entitled` means accessible in the service, not necessarily purchased. Anonymous free access still has primary `sign_in` and cannot start. Missing/contradictory legacy action data never enables a start.
- Reader access returns `workId`, `slug`, `access`, `replay`, and `aiCapability`, but no session ID. A further owner `GET /me/stories/:workId/progress-state` checks resumability/version status and release capability before start/continue. This endpoint takes no locale query. Missing, stale, completed/unknown, and version-mismatch states remain unavailable with a read retry. Release policy requires active configured capability, first-release max-three/custom-false, and consistent capability revisions.
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
- `final-results.tap`: **140/140 PASS**, 165.8 seconds: 61 catalog/detail cases plus all original 79 reader/reset cases on the final runtime code. The only runtime change after screenshot generation was instant catalog scroll restoration; no layout code changed. All contexts and Chrome closed, and PM received the heavy-slot release before lightweight checks/commit.
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

PM separately assigns independent QR1/QR2 and small integration. Remaining gaps: actual published catalog is known to have zero works (not re-uploaded or fabricated here); authorized real-content/cover/author projections, real live auth and account transitions, real entitlement expiry/revocation and persistence/concurrency, screen-reader acceptance, approved checkout/price-confirmation integration (#1837), and production deployment. Synthetic expired/revoked cases exercise the actual resulting purchase-required projection, not live entitlement-clock or DB behavior. Catalog version-mismatch is safely blocked, but current read DTOs expose no session ID with which to open a reset for that work; no discovery mutation is invented. This candidate is not ticket-wide completion or approval to integrate main.

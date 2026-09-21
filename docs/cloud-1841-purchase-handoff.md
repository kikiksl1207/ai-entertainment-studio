# Cloud #1841 Confirmed Story Purchase

## Candidate Scope

- Worktree: `E:/CodexMovedCache/worktrees/cloud-1841-purchase-20260922`
- Branch: `codex/cloud-1841-purchase-20260922`
- Base: `d62fb7ee4c4db912396f8498ba70b7b741849ff9`
- Server contract baseline: `c9b5438` (clean cherry-pick of
  `cdf4e9a9ccd6ce9baba018617f25b97292646b6e`). No server runtime source,
  schema, migration, dependencies, or generated client changes after that baseline.
- Frontend implementation: `pages/story-stage.js`, `styles/story-stage.css`.
  No HTML or root framework/package changes. Existing AI pending/revision,
  authored-choice, privacy, and completed-ending behavior retained.
- Direct test support: `tests/story-stage-*.mjs` and the existing raw-key copy
  guard in `server/scripts/verify-story-stage-no-raw-key.mjs`.
- PM frozen integration tree and original product checkout were not edited.
  No new visible task, install, junction, push, deployment, Notion edit, public
  story upload, live API mutation, generation call, or live wallet operation.

## Behavior

The existing native detail dialog contains the purchase confirmation; there is
no nested modal or new card. Purchase opens an exact-price confirmation, and
only its explicit confirmation sends the purchase POST. Cancel, Escape, close,
and back never purchase. Free/owned stories retain their no-charge start/continue
path. Missing/invalid quotes disable purchase. Decimal strings are validated to
the server's 16-integer/2-fraction-digit contract without Number conversion or
floating-point price arithmetic.

Before transmission, a random idempotency key and the exact confirmed price,
release ID, and work release revision are saved in sessionStorage for the
user/work. The in-memory single-flight operation prevents duplicate clicks and
close/reopen duplicates. The saved operation retains the original quote/key
across reload, navigation, locale change, and an uncertain result. Storage failure
blocks a new debit. Corrupt saved records fail closed instead of minting a key.

The bounded 15-second POST uses the existing direct signal-aware request path,
with no automatic authentication retry. An unknown response triggers fresh
access/progress reads; if access remains unresolved, only an explicit same-key
retry is offered. A stale/required confirmation with `walletMutation:false`
refreshes access and resets consent. It never automatically confirms a replacement
price or release. Explicit no-mutation errors can release the old operation;
ambiguous authentication/transport errors retain it.

Purchased, free, already-entitled, replayed, and inactive-entitlement results are
distinguished. Replay never presents the original amount as a new debit.
Purchase responses never fabricate reader access: fresh access/progress must
pass the existing capability checks before an explicit start/continue appears.
User, work, locale, and view epochs fence stale completions. Account storage
changes clear/reload private detail projections. A late purchase response can
only cause a fresh read for the same current user/work, never navigate.

Five locale dictionaries cover consent, price confirmation, pending/retry,
stale quote, inactive grant, insufficient balance, storage failure, and access
errors. Raw server diagnostics, identifiers, and translation keys are not shown.
Human copy approval and assistive-technology acceptance remain separate QA.

## Verification

Evidence root: `E:/CodexMovedCache/tmp/cloud-1841-purchase-20260922`.

- `targeted.tap`: first targeted pass 36/37. The account-switch fixture initially
  shared one token/global grant for both users. Corrected to independent tokens
  and per-token grant state; the production identity fence was already present.
- `targeted-final.tap`: 46/46 functional browser cases passed, 52.765 seconds.
- `reconcile.tap`: 1/1 final unknown-result message cleanup regression passed.
- `source.tap`: 57/57 source, copy, AI-pending preservation, and actual server
  method contract tests passed. Raw-key verifier: all nine checks passed.
- `full.tap`: full existing reader/catalog suite plus purchase coverage, run once:
  220/235 passed, 240.192 seconds. The only 15 failures were the new confirmation
  focus assertion selecting Close by DOM order; capture followed that assertion,
  so no failed-case screenshots were emitted. All existing reader/AI/catalog
  regressions and purchase functional cases passed.
- Corrected the fallback to explicitly choose enabled Confirm, Purchase, or Start
  before Close. `focus-final.tap`: final affected coverage 78/78 passed,
  79.097 seconds. Includes all purchase functional/server integration cases, all
  15 purchase visual cases, existing 15 detail bounds/focus cases, and catalog
  focus/scroll/back restoration. No second broad sweep was run per PM sequencing.
- Exactly 15 PNGs: `artifacts/{ko,en,ja,zh-Hans,zh-Hant}-{390,400,1280}-purchase.png`.
  Each is 844px tall. Visible confirmation is focused; enabled controls have
  at least 44px hit targets inside the viewport, button/dialog horizontal
  overflow is absent, and the scroll body ends above the fixed action footer.
  Images for all five mobile locales and desktop were visually inspected.
- Syntax and `git diff --check` passed. No full server build, database test,
  production purchase, or deployment run is claimed by this frontend slice.

All browser routes are intercepted: local checked-in HTML/CSS/JS and explicit
private synthetic fixtures only. No route calls continue/fallback. Unknown
transport is blocked; service workers and background networking are disabled.
Tests count mutation requests, inspect headers/body/keys, check text privacy,
and assert actual hit targets and overlay bounds. Screenshots are private test
fixtures, not representations of newly published Imjin/Norse catalog content.

`story-stage-server-contract.mjs` executes the actual purchaseWork,
assertPurchaseReplay, accessProjection, readerAccess, publicState, and reader
reentry source methods with local storage doubles and Decimal. This verifies
frontend/server DTO integration, not locks, transactions, real authentication,
or database rollback. PM/independent QA retain those responsibilities.

## Reproduce

Reserve the serialized browser slot first. No install or server bootstrap:

```powershell
$env:TEMP='E:/CodexMovedCache/tmp/cloud-1841-purchase-20260922'
$env:TMP=$env:TEMP
$env:NODE_PATH='E:/CodexMovedCache/worktrees/story-ai-shared-integration-20260922/server/node_modules'
$env:STORY_UI_SERVER_DEPS=$env:NODE_PATH
$env:STORY_UI_PLAYWRIGHT='E:/CodexMovedCache/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:STORY_UI_BROWSER='C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:STORY_UI_ARTIFACTS='E:/CodexMovedCache/tmp/cloud-1841-purchase-20260922/artifacts'
$env:STORY_UI_READER_CAPTURES='0'
$env:STORY_UI_DETAIL_CAPTURES='0'
& 'E:/Program Files/nodejs/node.exe' --test --test-concurrency=1 tests/story-stage-first-release.test.mjs
& 'E:/Program Files/nodejs/node.exe' --test --test-concurrency=1 tests/story-stage-ai-wait-source.test.mjs tests/story-stage-purchase-source.test.mjs server/scripts/verify-story-stage-no-raw-key.test.mjs
& 'E:/Program Files/nodejs/node.exe' server/scripts/verify-story-stage-no-raw-key.mjs
git diff --check
```

The installed Chrome executable is read from C: only. All task writes, browser
profiles, logs, and screenshots are on E:. Donor node_modules is read-only;
no client generation or modifications were performed there. Session persistence
is tab-scoped, not a cross-device purchase-history service. Real deployment must
apply the server baseline migration and receive independent QA approval first.

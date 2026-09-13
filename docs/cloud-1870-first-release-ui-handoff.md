# Cloud #1870 Candidate Handoff

Date: 2026-09-14 KST. Implementer: Cloud-role Chamo subagent, not the pinned Cloud task.
Branch: `codex/cloud-1870-first-release-ui-20260913`.
Base: `f750c39e5d8630e9c764321809467e76e8f1b711`; initial and final fetch both confirmed this origin/main.
The final delivery SHA is reported to PM after commit/push. This document belongs to that candidate commit.

## Scope and Outcome

- Reused the clean `E:/CodexMovedCache/worktrees/restart-baseline-1888-20260913` worktree. No copy, dependency install, main checkout move/reset, broad cherry-pick, board edit, main push or deployment.
- Read the PM restart document and latest #1870/#1841 sections. No applicable AGENTS.md found in E ancestors or relevant product directories.
- Changed only `pages/story-stage.js`, `styles/story-stage.css`, `story-stage/index.html`, `tests/story-stage-first-release.test.mjs`, and this handoff. Server, Prisma and backend service files are unchanged.
- Readers can choose any returned authored option (one, two or three), see completed/ending projections including `scene:null`, and preview/confirm full or current-act resets from the reader. Overflow blocks the scene, not just its fourth choice. Choice IDs are preserved and sent in the URL, with only `expectedRevision` in the choice body.
- Free, paid and legacy custom=true data cannot open or submit custom input. The retained future implementation uses `input`, `expectedRevision`, and `Idempotency-Key`; the source-owned first-release gate cannot be enabled by payload flags. No upgrade CTA or public development-status explanation is added.
- Reset preview uses server counts, target act, eligibility and expected revision. Confirmation sends the preview revision, `target`, current-act `actNumber` when applicable, locale and a unique idempotency key. Full=1/act=3 are server-owned quota baselines, not invented browser allowances. Failed quota reads display unknown/disabled instead of pretending zero uses remain.
- Choice/reset handlers stay busy through progress refetch; duplicate clicks are ignored. Lost/error responses never automatically replay POSTs. Late locale/session responses and old operation completion cannot overwrite the new reader state. A reset replay receipt never replaces a newer progress projection.
- Keyboard focus moves to the new scene; reset dialog starts on Cancel, traps Tab, handles Escape, restores trigger focus, and disables actions while pending. Its backdrop is above the mobile tab bar; long scene text remains inside an expanding stage, and long choices wrap.

## Contract Clarification for PM

Please correct the ambiguous phrase "refetch using afterRevision" in board/Notion summaries. **Do not add an `afterRevision` URL parameter.**

Evidence at the verified base:

- `server/src/story-production/dto/story-production.dto.ts:35`: `StoryLocaleQueryDto` permits only optional `locale`.
- `server/src/story-production/story-production.controller.ts:113` and `:123`: both current-progress aliases consume that DTO and pass only `query.locale` to `currentProgress`.
- `server/src/main.ts:47`: `forbidNonWhitelisted: true`; an invented query parameter is rejected rather than used for freshness.
- `server/src/story-production/story-progress-control.service.ts:913` and `:930`: reset command projection returns `afterRevision` **in the receipt body**.
- `server/src/story-production/dto/story-production.dto.ts:84` and `:100`: reset preview accepts `target`, optional `actNumber` and locale; reset command additionally requires `expectedRevision`.
- `server/src/story-production/story-progress-control.service.ts:286`: preview returns `remainingBefore`, `remainingAfter`, `canExecute`, `targetAct`, `invalidatedEventCount`, and `expectedRevision`, not a localized summary/path DTO.
- `server/src/story-production/story-production.service.ts:513`: completed progress can return `scene:null`, top-level `choices:[]`, revision and release capability. A null scene is not necessarily a fetch failure.

Implemented interpretation: after reset, retain a client minimum revision equal to the maximum of the last accepted revision and receipt `afterRevision`. Issue the ordinary locale-only current-scene GET. Accept only the same progress ID and a revision at least that minimum, then replace the entire top-level progress/capability and refetch reset controls. Older results block actions and permit an explicit read retry; they never trigger a reset replay. A newer preview revision also advances this floor.

### Legacy Session Links

The actual current-scene projection does not identify the work, and the work public-state projection does not identify the session. Existing sessionId-only links are retained without scanning works, guessing identity, reading browser session storage or secrets, or invoking a start mutation to discover it. They use read-only **session-scoped** full/act previews to obtain reset information. New start URLs preserve their already-known work ID and use that work's public progress-state projection. Commands always address the actual session and remain server-authoritative.

Legacy preview `canExecute` is not a promise of final authorization: the base server rechecks version/release/access on execution. This UI does not repair the previously documented server read-authorization gaps or create new DTO fields.

## Verification and Artifacts

No live login, choice/reset, payment, DB, provider, real manuscript, upload, entitlement or publishing operation was run. All browser API activity is synthetic fixture transport inside `tests/`. The router never calls network continue/fallback: it fulfills known local resources/API fixtures and aborts everything else. Service workers are blocked; Chrome background networking and DNS resolution are disabled. No fixtures were added to public content or API services.

All runs used existing E Node/dependencies. There is no root package.json. The test loads the real page HTML/CSS/JS, runs actual DOM handlers, and also exercises the existing shared `apiFetch` function extracted from app.js with empty test auth helpers. Other app initialization is intentionally not run. The test is not a whole-app auth/catalog or independent browser acceptance test.

Results:

- Full sequential browser suite: **79/79 PASS**, 89 seconds, one Chrome process tree. Includes all five locales x free/paid x 0/1/2/3 choices, overfull 4/7, distinct targets, inactive/completed state, null-scene ending, errors, preview/DTO/quota/refetch/replay, locale/session races, pending lock and focus.
- Final three-line preview revision/context guard was added after that full run; targeted `preview|prior-session` rerun on final UI source: **6/6 PASS**, 11 seconds. The full 79 suite was not rerun after that narrow guard. Independent QR1 should run the full suite against the frozen candidate.
- Existing raw-key regression: **46/46 PASS**. Current copy guard: **5/5 PASS**.
- Six other unchanged read-only guards: player read APIs 10, progress controls 6, AI economics 10, production release 5, lifecycle release 6, access projections 8 checks PASS. Total seven guards: **50 checks PASS**.
- JS syntax checks and `git diff --check` PASS. No server build/lint/Jest rerun: backend sources unchanged and shared heavy-job coordination respected for the approved final browser slot.
- First pre-slot-notification browser run was 68/68 PASS; PM then required explicit slot approval. The final 79 and targeted 6 runs occurred after PM approved the single-browser slot. No further execution after candidate freeze without coordination.

Evidence directory: `E:/CodexMovedCache/tmp/restart-baseline-1888-20260913/cloud-1870-ui/`.

- `results.tap`: complete 79-test output.
- `preview-final.tap`: final 6-test boundary output.
- `{ko,en,ja,zh-Hans,zh-Hant}-{390,400,1280}-{choices,reset}.png`: 30 screenshots. Choices are full-page extreme-text stress captures; reset captures are viewport images with actual confirm-button hit testing. These deliberately synthetic scenes have no manuscript or real scene assets.
- Direct visual inspection included ko/en/ja/zh-Hans/zh-Hant screenshots. Initial capture exposed mobile tabbar overlap; final z-index and hit-test regression fixed it. Current reset screenshots show the confirmation button unobscured.

The virtual test URL `http://127.0.0.1:18700/story-stage?...` is intercepted inside Playwright, **not a running preview server** and not a usable post-test demo URL. No static/dev server was needed or started. All test contexts and the browser are closed by the runner; no intentional preview process remains.

### Reproduction (Coordinate Browser Slot First)

Run from the reused E worktree in PowerShell:

```powershell
$env:TEMP='E:/CodexMovedCache/tmp/restart-baseline-1888-20260913'
$env:TMP=$env:TEMP
$env:npm_config_cache='E:/CodexMovedCache/npm-cache/restart-baseline-1888-20260913'
$env:NODE_PATH='E:/CodexMovedCache/tmp/restart-baseline-1888-20260913/qa-parser/node_modules'
$env:STORY_UI_PLAYWRIGHT='E:/CodexMovedCache/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:STORY_UI_BROWSER='C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:STORY_UI_ARTIFACTS='E:/CodexMovedCache/tmp/restart-baseline-1888-20260913/cloud-1870-ui'
& 'E:/Program Files/nodejs/node.exe' --test --test-concurrency=1 tests/story-stage-first-release.test.mjs
& 'E:/Program Files/nodejs/node.exe' --test --test-concurrency=1 --test-name-pattern='preview|prior-session' tests/story-stage-first-release.test.mjs
& 'E:/Program Files/nodejs/node.exe' --test server/scripts/verify-story-stage-no-raw-key.test.mjs
& 'E:/Program Files/nodejs/node.exe' server/scripts/verify-story-stage-no-raw-key.mjs
& 'E:/Program Files/nodejs/node.exe' server/scripts/verify-story-player-read-apis.mjs
& 'E:/Program Files/nodejs/node.exe' server/scripts/verify-story-progress-controls.mjs
& 'E:/Program Files/nodejs/node.exe' server/scripts/verify-story-ai-economics.mjs
& 'E:/Program Files/nodejs/node.exe' server/scripts/verify-story-production-release-guard.mjs
& 'E:/Program Files/nodejs/node.exe' server/scripts/verify-story-lifecycle-release.mjs
& 'E:/Program Files/nodejs/node.exe' server/scripts/verify-story-access-projections.mjs
& 'E:/Program Files/nodejs/node.exe' --check pages/story-stage.js
& 'E:/Program Files/nodejs/node.exe' --check tests/story-stage-first-release.test.mjs
git diff --check
```

Chrome's C path is an existing read-only executable, not an installation/profile/cache destination. TEMP/TMP, screenshots and test outputs are E-only.

## Emily and Independent Review

Review all five `STORY_CONTROL_COPY` entries for the seven added keys: `sceneUnavailable`, `accessRequired`, `progressChanged`, `resetFailed`, `resetSummary`, `resetDestination`, `remainingAfter`. The actual source contains complete ko/en/ja/zh-Hans/zh-Hant drafts. In particular check natural reset/act terminology and the choice-record count wording. Drafts deliberately replace the old suggested "first release/development/update required" phrasing with ordinary user-facing availability language. Do not add deferred-custom upsell text. Emily approval is pending.

QR1/QR2 should independently verify the exact candidate, final preview floor, same-session locale changes during a pending POST, cross-session pending-operation lock, completed-without-scene, access/release failures, and mobile focus/scroll. Source/browser tests are not real DB concurrency evidence.

Remaining: #1841 catalog/detail/purchase-modal recovery and stale-release session discovery from the catalog; complete end-to-end authorization projections; authorized real-content branch audit; live free/paid ownership/access expiry/revocation; real assets and screen readers; actual provider-generated recommended continuation (#1879); authorized live persistence/concurrency; integration and deployment. The UI follows stored authored choices and does not claim that runtime AI is implemented. No ticket is declared fully complete or main-approved by this handoff.

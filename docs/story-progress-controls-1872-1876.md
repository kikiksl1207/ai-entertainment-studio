# Story Progress Controls #1872-#1876

The first public release permits suggested choices only for BOTH free and paid stories, at most three per scene. This supersedes the earlier paid-custom launch requirement. Custom-choice storage, moderation, economics and continuation code remain future functionality; they are not removed or enabled by request flags.

## APIs

- `POST /api/v1/me/story-progress/:progressId/custom-choice` denies first-release custom requests after ownership, paid access and revision checks, before processing input or looking up an old receipt. Both legacy and economics paths are gated; direct economics prepare/request/replay calls also deny before side effects.
- `GET|POST /api/v1/me/story-progress/:progressId/checkpoint` reads or confirms the last stable scene and beat through optimistic progress revisions.
- `GET /api/v1/me/story-progress/:progressId/reset-preview` returns the target scene, invalidated event count, and remaining quota without mutation.
- `POST /api/v1/me/story-progress/:progressId/reset` atomically consumes one quota unit, invalidates applicable choice events, updates progress, creates a checkpoint, and writes sanitized audit metadata.
- `GET /api/v1/me/stories/:workId/progress-state` returns capability booleans, numeric quotas, checkpoint labels, and message keys without internal identifiers or custom choice history.
- `POST /admin/api/v1/story-progress/reset-quota-adjustments` is wildcard-admin-only and records idempotent operational compensation in a separate immutable adjustment ledger.

## Persistence and authority

- Full reset has one bucket per user and work. Each act has an independent three-use bucket.
- Quota buckets are not keyed by story version, so publishing a new version does not restore usage. A full reset may reconcile progress to the new published version; an act reset may not cross a version mismatch.
- Reset preserves entitlements and visited ending keys. Choice events are retained for audit and marked invalid instead of deleted.
- Fixed choices and beat writes use optimistic progress revisions. Existing sessions cannot use the legacy start route to bypass reset or checkpoint commands.
- First-release custom denial creates no private choice, continuation, allowance reservation, usage ledger, quality event or progress write. Future custom input remains confined to the private choice table and existing privacy guards.

## Cloud #1870 Wire Contract

All paths below are relative to `/api/v1`. Successful responses are ordinary JSON (no success/data wrapper).

- `GET /me/story-progress/:progressId` and alias `GET /story-sessions/:sessionId/current-scene` use the same projection. `choices` and `releaseCapability` are TOP-LEVEL, not inside `scene`. `revision` is the current optimistic progress revision. Render returned suggested choices without synthesizing a fourth or custom option. Zero choices is valid for an ending; one and two are also valid.
- `POST /me/story-progress/:progressId/choices/:choiceId` body is `{ "expectedRevision": 3 }`; the choice ID belongs in the URL. The server checks owner, active status, revision, published work/scene/part, live entitlement, story version, active release, configured capability revision and source choice count before any event/progress write. The response is the refreshed progress projection. Distinct authored target IDs and route/rejoin metadata are preserved.
- `GET /stories` catalog item and `GET /stories/:slug` detail expose `releaseCapability`; `GET /me/stories/:workId/access` exposes `aiCapability`; `GET /me/stories/:workId/ai-capability` returns the capability itself. `GET /me/stories/:workId/progress-state` exposes `customChoiceCapability: false`, `customChoiceUnavailableReason`, and `releaseCapability`. No legacy work custom flag may override these values.
- Every choice capability includes the following server-owned fields, including missing-config/legacy and completed-progress projections. Existing reset/budget/revision/source fields remain where previously available:

```json
{
  "choicePolicy": "first_public_release",
  "fixedChoices": 3,
  "customChoiceEnabled": false,
  "customChoiceMaxLength": 0,
  "customChoiceUnavailableReason": {
    "code": "STORY_CUSTOM_CHOICE_DEFERRED",
    "messageKey": "story.progress.customChoice.firstReleaseDeferred",
    "message": "Custom choices are not available in the first release. Choose a suggested option.",
    "retryable": false
  }
}
```

`fixedChoices` means a maximum, not required cardinality. Hide/disable free-text entry for all first-release readers; do not show an upgrade/pay CTA for this denial. The retained custom DTO is `{ "input": "...", "expectedRevision": 3 }` with an `Idempotency-Key` header (8-200 trimmed characters), NOT `{ "customChoice": "..." }`. Do not submit it in first release. Invalid DTO/header, authentication, ownership, entitlement or stale revision can fail earlier with their existing 400/401/404/403/409 response.

For an otherwise authorized, current custom request, HTTP 403 uses the existing global exception envelope:

```json
{
  "success": false,
  "error": {
    "code": "STORY_CUSTOM_CHOICE_DEFERRED",
    "messageKey": "story.progress.customChoice.firstReleaseDeferred",
    "message": "Custom choices are not available in the first release. Choose a suggested option.",
    "statusCode": 403,
    "details": { "retryable": false },
    "path": "/api/v1/me/story-progress/<progressId>/custom-choice",
    "timestamp": "<ISO timestamp>"
  }
}
```

`requestId` is also present when supplied by request context. Top-level exception `retryable` and `currentRevision` are not forwarded by the existing filter; fetch current progress after stale-revision errors. No submitted text is returned or logged by these denials. Resolve known message keys through i18n; never render raw keys. The safe English `message` is available as a fallback until Cloud supplies the translations below.

Overfull authored scenes return HTTP 409 with the same envelope, code `STORY_SUGGESTED_CHOICE_LIMIT_EXCEEDED`, key `story.progress.error.suggestedChoiceLimitExceeded`, message `This scene needs an update before it can be played. Please try again later.`, and `details: { retryable: false, maxSuggestedChoices: 3 }`. Block the scene without retry loops, truncation, payment prompts or guessing a route.

### Five-Locale Copy Handoff (No UI Files Edited)

| Locale | `story.progress.customChoice.firstReleaseDeferred` | `story.progress.error.suggestedChoiceLimitExceeded` |
| --- | --- | --- |
| ko | 첫 공개 버전에서는 직접 입력을 사용할 수 없습니다. 추천 선택지 중에서 골라 주세요. | 이 장면은 업데이트 후 플레이할 수 있습니다. 나중에 다시 시도해 주세요. |
| en | Custom choices are not available in the first release. Choose a suggested option. | This scene needs an update before it can be played. Please try again later. |
| ja | 初回公開版では自由入力は利用できません。おすすめの選択肢から選んでください。 | このシーンをプレイするには更新が必要です。しばらくしてからもう一度お試しください。 |
| zh-Hans | 首次公开版本暂不支持自由输入。请选择推荐选项。 | 此场景需要更新后才能游玩。请稍后重试。 |
| zh-Hant | 首次公開版本暫不支援自由輸入。請選擇推薦選項。 | 此場景需要更新後才能遊玩。請稍後再試。 |

Cloud owns mobile layout, translations and fixing the observed scene-level capability / custom request-body mismatch. These strings require its five-locale UI review; no UI implementation or visual verification is claimed here.

## Data Policy and Scope

- The server reads up to FOUR source choices as overflow detection, not as an allowed fourth option. More than three blocks the entire scene on both GET aliases and POST, including direct submission of a hidden fourth ID. It does not return the first three as a silently changed story.
- Publication activation checks choice counts for the work's non-fixture published parts/scenes within the publication transaction, even without the optional economics service. Draft manuscripts, branch snapshots and source rows are not altered. Unpublished/draft content may retain additional branches; a content owner must explicitly revise/select an approved <=3-choice release graph before publishing it. Subsequent source changes are still caught by reader/mutation guards. No data migration or production repair was run.
- Capability configuration continues to require `fixedChoiceCount: 3` (the ceiling), full reset 1 and act reset 3. Setting `customChoiceEnabled: true` is rejected for new free AND paid configurations/activation; existing true metadata is projected as deferred, not treated as an invalid whole capability. Reset quotas, budget fields, allowances and session pins are preserved.
- `aiGenerationEnabled` on the economics capability is configured generation-budget readiness (active config and positive input/output limits), independent of custom input. Detail `replay.newAiPathGeneration.enabled` uses it. It is NOT proof of provider runtime, consent, allowance or per-action authorization. Existing `aiBudget`, `aiAllowanceRemaining`, reset limits and revisions retain their semantics.
- Pre-existing gap: suggested-choice `selectChoice` follows stored authored targets and records divergence/rejoin events; it does not request a provider-generated suggested continuation. This patch does not implement that runtime or fake provider calls. Existing continuation status/settlement, compensation and future custom processing are retained.
- Selection previously lacked version/release/access checks; the touched mutation now checks these before writes. Broader current-progress/beat/checkpoint/read authorization consistency remains outside this policy change. The pre-existing continuation status controller still ignores URL `progressId` and scopes by authenticated user plus continuation ID; track that separately. No controller redesign is included.
- Existing provider settlement of historical continuations is unchanged, not a new custom request route. First-release custom receipt replay cannot reach its usage-ledger upsert.

## Verification

Run existing story-production/economics/progress/lifecycle Jest suites serially, including `story-first-release-policy.spec.ts`; use an E-only Jest cache. New tests execute actual service/controller/filter code with isolated fixture storage, not public fake content. Future receipt privacy coverage explicitly mocks only the release gate in a test; no runtime feature flag or injected policy bypass was added.

Server build, lint and existing read-only QA scripts should also run. Do NOT use `render:start`, migrate, seed, staging fixtures or live provider operations for this patch. Original #1872 release/live QA remains: independent review, authorized real-content <=3-branch audit, free/paid live flows, entitlement expiry/revocation checks, reset/checkpoint/continuation persistence and concurrency, and Cloud's five-locale mobile validation. No deployment, main push, DB execution, browser verification or live AI verification is part of this delivery.

### Initial Candidate Verification (2026-09-13)

Base: fresh `origin/main` at `a54fee3be6dfe4e3d7fd30ea275a7e516fc923c7`; clean reused E worktree, no applicable AGENTS found. Branch: `codex/luffy-1872-first-release-policy-20260913`. Dependencies installed from the existing lockfile with `npm ci --ignore-scripts --no-audit --no-fund`, then explicit Prisma client generation (no DB connection/migration).

Initial candidate results: 10 Jest suites / 94 tests passed; full-source ESLint passed; `npm run build` passed (Prisma generate + Nest compile); all seven QA guards below passed; `git diff --check` passed. These results did not cover the release-switch/reset/choice sequence identified in review return 1 below. No pre-existing test/build failure was encountered. Earlier new-test fixture failures were corrected, not suppressed. Existing package deprecation warnings were left unchanged.

Run serially in PowerShell from the retained E worktree's `server` directory:

```powershell
Set-Location 'E:/CodexMovedCache/worktrees/restart-baseline-1888-20260913/server'
$env:PATH='E:/Program Files/nodejs;'+$env:PATH
$env:TEMP='E:/CodexMovedCache/tmp/restart-baseline-1888-20260913'
$env:TMP=$env:TEMP
$env:npm_config_cache='E:/CodexMovedCache/npm-cache/restart-baseline-1888-20260913'
$env:NODE_PATH='E:/CodexMovedCache/tmp/restart-baseline-1888-20260913/qa-parser/node_modules'
node node_modules/jest/bin/jest.js --runInBand --cacheDirectory=E:/CodexMovedCache/tmp/restart-baseline-1888-20260913/jest-cache --testPathPattern=story-production --json --outputFile=E:/CodexMovedCache/tmp/restart-baseline-1888-20260913/luffy-1872-jest.json
node node_modules/eslint/bin/eslint.js 'src/**/*.ts'
npm.cmd run build
node scripts/verify-story-player-read-apis.mjs
node scripts/verify-story-progress-controls.mjs
node scripts/verify-story-ai-economics.mjs
node scripts/verify-story-production-release-guard.mjs
node scripts/verify-story-lifecycle-release.mjs
node scripts/verify-story-access-projections.mjs
node scripts/verify-story-stage-no-raw-key.mjs
```

The Jest JSON report, ignored dependencies/build output and E caches remain available for independent QR1 review. The last guard checks existing UI source only; it does not verify Cloud's forthcoming UI changes or the new translation handoff visually.

### Review Return 1: Release-Switch Full Reset (2026-09-13)

QR1 found an introduced P1 in `d218da2f0486036f6867a4e66c78c12894cd5da4`: a full reset after release switch updated `storyVersion` and consumed quota but retained the old release/capability/rate-card pins. The new selection guard then rejected a valid recommended choice for both free and paid readers. The initial candidate was not approved for main. Correction began only after the PM released the review write lock.

- Full reset now resolves the work's current active release and matching published version, active capability and active rate card inside the reset transaction, before quota upsert/consumption. Missing/unavailable publication, configuration, rate card or reset target is rejected; no defaults, stale-release fallback or manuscript changes are used. Capability reset limits must still be full=1/act=3; existing custom=true metadata does not reopen custom input or disable otherwise valid reset configuration.
- Successful full reset writes `activeReleaseId`, `capabilityRevision`, `aiRateCardId` and `storyVersion` with the existing progress revision increment and reset state. Its checkpoint has the new story version/target; the quality event references the new release. Target selection still uses the existing non-fixture published work/part/scene reset rules; this correction does not invent a snapshot format or republish source content.
- Full-reset preview resolves current-release configuration rather than the obsolete progress pin. Public `canFullReset` no longer requires the old capability revision to match the current one; execution revalidates publication/configuration/access. Act reset remains version-bound and does not repin. The selection/version/entitlement guard and first-release custom denial are unchanged.
- The work-scoped full quota is not replenished on release changes; act quotas are unchanged. Existing events are invalidated, not deleted; discovered endings and entitlement remain intact. No AI request, allowance reservation/transfer/reset or usage ledger write occurs. After repinning, allowance reads use the existing new-release bucket/policy; reset does not grant new allowance.
- Reset runs at serializable transaction isolation; act capability reads also occur within that transaction. Existing reset idempotency replay returns its receipt without another quota debit or modifying subsequently advanced progress. Paid transactional access uses the same story entitlement types as the non-transactional access check.
- HTTP reset request/receipt and Cloud's custom-choice denial contract are unchanged. After success, refetch progress using `afterRevision`; do not keep a cached old release capability. Missing reset configuration uses the existing `STORY_RELEASE_CAPABILITY_REQUIRED` / `story.progress.reset.capabilityRequired` contract with a safe message and `error.details.retryable=false`.

Final correction verification: **10 suites / 103 tests passed**, full-source ESLint passed, `npm run build` passed, and all seven unchanged QA guards listed above passed. The added stateful free/paid tests run actual full-reset then recommended-choice services through the returned reader projection; they verify all pins, revision/checkpoint, history, allowance, entitlement, quota and idempotent replay. Invalid release/config/rate-card/target/revision cases verify no quota upsert or writes; expired/revoked/foreign/wrong-type paid access and exhausted quota are also covered. An initial fixture visual-manifest mismatch was corrected, not bypassed.

Use the same E-only environment and serial commands above, changing the Jest report destination to retain both review artifacts:

```powershell
node node_modules/jest/bin/jest.js --runInBand --cacheDirectory=E:/CodexMovedCache/tmp/restart-baseline-1888-20260913/jest-cache --testPathPattern=story-production --json --outputFile=E:/CodexMovedCache/tmp/restart-baseline-1888-20260913/luffy-1872-review-return1-jest.json
```

These are executable fixture-storage tests, not live DB/concurrency proof. No dependencies were installed, no DB/live provider/deployment/main operation ran, and the existing E worktree/cache remain for QR1 rereview. Independent acceptance and the original release/live QA remain outstanding; the branch is frozen again after the correction push.

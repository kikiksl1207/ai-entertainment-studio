# Reviewer Inbox

Use the standard completion note from `docs/ops/agents.md`.

status: done
task: RV-001 - Review Backstage / Creator Studio Work
branch/commit: reviewer/rv-001-review / this review commit
changed_files:
- docs/ops/inbox/reviewer.md
tests:
- git fetch --all --prune
- git diff --stat origin/main...origin/builder-a-backend/ba-001-contract-check
- git diff --stat origin/main...origin/builder-b-frontend
- git diff --check origin/main...origin/builder-b-frontend
- git grep / targeted contract checks against server/src and branch diffs
result:
- Reviewed origin/builder-a-backend/ba-001-contract-check against BA-001 and RV-001. Builder A changed only docs/ops/inbox/builder-a.md and reported backend contract verification; no backend code diff to reject.
- Reviewed origin/builder-b-frontend against BS-001, CS-001, and RV-001.
- Finding [P2]: origin/builder-b-frontend:backstage.js:2997 should not mark R2 diagnostics as "direct upload ready" before checking endpointConfigured / R2 endpoint state. The backend diagnostics response includes environment.endpointConfigured and missingR2Env can drive reason = r2_endpoint_missing, but objectStorageSignal returns ready whenever directUploadMode, bucket, public URL, access key, and secret key are present. For an R2 deployment with OBJECT_STORAGE_ENDPOINT missing, the panel can show "direct upload ready" instead of the required "R2 endpoint missing", which fails BS-001 acceptance criteria for distinguishing upload blocker causes. Recommend requiring endpointConfigured when storageProvider === "r2", or checking the R2 endpoint missing branch before the ready branch.
- Creator Studio conversion UI uses settlementKey from settlement preview items and posts settlementKey/amountKrw, not hand-typed slugs. Copy consistently says this is a request and no wallet credit occurs before admin/accounting confirmation.
- Backstage diagnostics rendering escapes dynamic text and displays configured/missing flags rather than raw secret values.
- Korean labels in reviewed branch diff are readable; no mojibake found in changed UI copy.
blocked_by:
- P2 finding above should be fixed before accepting Builder B diagnostics work.
next_needed:
- Builder B fix the R2 endpoint readiness classification, then Reviewer/Integrator should run browser QA with authorized Backstage and Creator Studio accounts.
- Integrator should run final npm.cmd run lint and npm.cmd run build after merge/integration.

---

status: done
task: RV-001 re-review - Builder B R2 endpoint diagnostics fix
branch/commit: reviewer/rv-001-review / this re-review commit
changed_files:
- docs/ops/inbox/reviewer.md
tests:
- git fetch --all --prune
- git diff --stat origin/main...origin/builder-b-frontend
- git diff --check origin/main...origin/builder-b-frontend
- targeted review of origin/builder-b-frontend:backstage.js objectStorageSignal
result:
- Re-reviewed origin/builder-b-frontend at b36cb25 after Builder B's P2 fix.
- Previous P2 is resolved. objectStorageSignal now checks storageProvider === "r2" with environment.endpointConfigured === false, or endpoint-related reason text, before the ready branch.
- The direct upload ready branch now requires endpointReady, so R2 can only show "direct upload ready" when endpointConfigured is true.
- This satisfies the BS-001 requirement to distinguish R2 endpoint missing from direct upload ready.
blocked_by:
- none
next_needed:
- Integrator can proceed with merge verification and browser QA for authorized Backstage / Creator Studio accounts.
- Run final npm.cmd run lint and npm.cmd run build after integration.

---

status: done
task: RV-002 wallet adjustment safety review; BA-002 backend contract review; BB-002 UI map review
branch/commit: reviewer/rv-002-team1-review / this review commit
findings:
- [P0] `server/src/admin/admin.service.ts:6451` checks debit sufficiency against `existingWallet.cachedBalance` that was read earlier in `walletAdjustmentTargets` (`server/src/admin/admin.service.ts:6397`). The later balance mutation is an unconditional decrement (`server/src/admin/admin.service.ts:6479`). There is no DB non-negative check on `WalletAccount.cachedBalance` (`server/prisma/schema.prisma:417`) and no conditional update/row lock. Two concurrent admin debits can both pass the stale balance check and drive the wallet negative, violating the RV-002 requirement that debit cannot produce negative balance. Fix with an in-transaction conditional update such as `where id + cachedBalance >= amount`, row lock/serializable transaction, or equivalent DB constraint plus retry-safe handling.
- [P1] Empty wallet adjustment notes can execute through the Backstage UI because `buildActionRequest` replaces an empty memo with the default string `백스테이지 운영 처리` (`backstage.js:2177`, `backstage.js:2178`) and sends it as `note` for both single and bulk wallet adjustment requests (`backstage.js:2218`, `backstage.js:2232`). The backend only rejects a missing/blank note after this substitution (`server/src/admin/admin.service.ts:6290`). This fails the acceptance criterion "empty note cannot execute successfully" and weakens audit quality for a cash-like operation. Require an operator-entered non-empty note before enabling the confirmation action, and do not synthesize a note for wallet adjustments.
- [P2] BA-002 and BB-002 contract names are not aligned. Builder A proposes `GET /api/v1/fan-engagement/missions` and `POST /api/v1/fan-engagement/missions/:missionId/participations` (`origin/builder-a-backend/ba-002-fan-engagement-contract:docs/ops/inbox/builder-a.md:217`, `origin/builder-a-backend/ba-002-fan-engagement-contract:docs/ops/inbox/builder-a.md:269`), while Builder B maps `GET /api/v1/fan-engagement/daily-missions?surface=home` and `POST /api/v1/fan-engagement/missions/:missionId/complete` (`origin/builder-b-frontend:docs/ops/inbox/builder-b.md:63`). The same mismatch appears for concept vote submission (`origin/builder-a-backend/ba-002-fan-engagement-contract:docs/ops/inbox/builder-a.md:307` vs `origin/builder-b-frontend:docs/ops/inbox/builder-b.md:70`). Integrator should not treat BA/BB as implementation-ready until endpoint names and response shapes are reconciled.
- [P2] BA-002 response examples still expose user-facing English copy without stable localization keys or localized label fields: mission `title`, `description`, and `ctaLabel` are English-only in the proposed API (`origin/builder-a-backend/ba-002-fan-engagement-contract:docs/ops/inbox/builder-a.md:237`). Given the always-on localization rule, backend contracts should return stable status/type keys plus either locale-aware labels or fields that the frontend can map safely, so Korean UI does not leak English strings or require ad hoc hard-coded translations.
- [P3] Mobile QA for the wallet adjustment confirmation flow is still unverified. The modal summary adds wallet-specific rows for direction, amount, target count, and note (`backstage.js:2760`) but this review only ran static checks and did not exercise narrow-width Backstage UI. Because wallet adjustment is cash-like and confirmation clarity is an acceptance criterion, browser QA should include mobile/narrow width before rollout confidence.
tests:
- git pull origin main
- git fetch --all --prune
- reviewed docs/ops/agents.md
- reviewed docs/ops/board.md
- reviewed docs/ops/tasks/open/RV-002-review-wallet-adjustments.md
- reviewed docs/ops/tasks/open/BA-002-fan-engagement-loop-backend-contract.md
- reviewed docs/ops/tasks/open/BB-002-fan-engagement-loop-ui-map.md
- reviewed docs/ops/inbox/builder-a.md and origin/builder-a-backend/ba-002-fan-engagement-contract:docs/ops/inbox/builder-a.md
- reviewed docs/ops/inbox/builder-b.md and origin/builder-b-frontend:docs/ops/inbox/builder-b.md
- git diff --stat origin/main...origin/builder-a-backend/ba-002-fan-engagement-contract
- git diff --stat origin/main...origin/builder-b-frontend
- git diff --check origin/main...origin/builder-a-backend/ba-002-fan-engagement-contract
- git diff --check origin/main...origin/builder-b-frontend
- server: npm.cmd run lint
- server: npm.cmd run build
- node --check backstage.js
- git diff --check origin/main~1..origin/main
- git diff --check 6e1c720^..6e1c720
result:
- RV-002 is not rollout-ready because of the P0 concurrent debit/negative-balance risk and P1 empty-note audit risk.
- Wallet adjustment permission is correctly restricted at the controller and service level via `@RequireAdminPermissions('*')` and `assertSuperAdmin`.
- Single target, bulk target cap, ledger type, audit metadata, credit wallet creation, and basic debit insufficient-balance checks are present, but the debit check must be made concurrency-safe.
- BA-002 keeps fan points/achievements/titles separate from Lumina wallet and explicitly marks rewards non-cash, which is directionally good. It needs endpoint/i18n cleanup before implementation.
- BB-002 result is present on `origin/builder-b-frontend`; it is documentation-only, includes mobile/i18n notes, and correctly avoids settlement/revenue-sharing UI. It must be reconciled with BA endpoint names.
blocked_by:
- P0 wallet debit race condition and P1 empty-note execution path should be fixed before production rollout confidence for wallet adjustment controls.
- BA/BB endpoint mismatch blocks implementation-ready fan engagement integration.
next_needed:
- Backend owner should patch wallet debit to use an atomic/locked non-negative balance update and reject UI-generated placeholder notes for wallet adjustments.
- Builder A and Builder B should settle one endpoint contract for missions, participations, concept votes, achievements, public titles, and Creator Studio today tasks.
- Run browser QA for Backstage wallet adjustment confirmation at mobile/narrow and desktop widths after fixes.

---

status: done
task: RV-002 re-review close - Wallet adjustment safety
branch/commit: main / origin/main 8f66064
changed_files:
- docs/ops/board.md
- docs/ops/tasks/closed/RV-002-review-wallet-adjustments.md
- docs/ops/inbox/reviewer.md
tests:
- npm.cmd run lint
- npm.cmd run build
- node --check backstage.js
- git diff --check
result:
- P0 wallet debit concurrency: resolved.
- P1 empty-note wallet adjustment execution: resolved.
- Backstage confirmation UI desktop/mobile/narrow: PASS.
- Empty note state does not call the API: PASS.
- RV-002 removed from Active Tasks and closed.
caveat:
- Safe Backstage admin account and safe QA wallet were not available in this session, so live server mutation and insufficient-balance debit smoke were not executed.
- Before production reliance, run one live smoke with a safe QA wallet: direct note credit/debit, insufficient-balance debit failure, and no negative balance.
safety:
- No secrets or sensitive values recorded.
- No real wallet adjustment executed.

# Team2 QA Inbox

status: pass
task: Fan engagement Home teaser smoke QA
environment:
- branch: team2-qa/fan-engagement-home-teaser-smoke
- local main after pull: origin/main
- basis commit: f94ffd2ae1aee3c0d100a07d9aa508a702a5a79b
- page: https://www.lumina-stage.com/index.html
- No token, cookie, password, env value, or credential was recorded.
- No API submit, mission participation, or ballot mutation was executed.

tested_flows:
- PASS: `index.html` renders the fan mission teaser section.
- PASS: teaser renders exactly 3 mission cards.
- PASS: Korean copy is displayed normally in the browser.
- PASS: raw enum / English key strings were not exposed in the teaser UI.
- PASS: all 3 CTA buttons are disabled.
- PASS: clicking disabled CTAs did not create any mission API request, submit, participation mutation, or ballot mutation.
- PASS: desktop 1365px layout has no card or text overlap.
- PASS: mobile 390px layout has no card or text overlap.
- PASS: narrow 320px layout has no card or text overlap.
- PASS: existing Home hero is present.
- PASS: existing main artists section is present.
- PASS: existing shortform section is present and populated.
- PASS: existing debut line carousel is present and populated.

observed_copy:
- Section heading: `팬 미션`, `오늘의 팬 참여`.
- Card copy included `오늘의 응원 미션`, `오늘의 콘셉트 투표`, `한 줄 제안`.
- Card metadata included Korean labels such as `응원 미션`, `콘셉트 투표`, `팬 제안`, `진행 중`, `참여 가능`, `확인 중`, and `팬 포인트 +5`.

network_check:
- PASS: click delta after forcing clicks on the 3 disabled CTAs was 0 mission-related requests.
- PASS: no `mission_participation` mutation was observed.
- PASS: no `ballot` mutation was observed.
- Note: page load emitted a third-party analytics POST unrelated to mission participation or ballot submission.

responsive_check:
- desktop 1365x900: 3 cards visible, no card overlap, no text overflow.
- mobile 390x844: 3 cards visible, no card overlap, no text overflow.
- narrow 320x740: 3 cards visible, no card overlap, no text overflow.

repro_steps:
1. Run `git pull origin main`.
2. Confirm local `HEAD` is `f94ffd2ae1aee3c0d100a07d9aa508a702a5a79b`.
3. Open `https://www.lumina-stage.com/index.html`.
4. Inspect `#fan-missions` and `#homeMissionTeaser`.
5. Confirm exactly 3 `.fan-mission-card` elements render.
6. Confirm `.fan-mission-cta` buttons are disabled.
7. Force-click each disabled CTA while monitoring network requests.
8. Confirm no mission participation, ballot, submit, or mutation request is sent.
9. Repeat visual checks at 1365px, 390px, and 320px widths.
10. Confirm Home hero, main artists, shortform, and debut line carousel still render.

blockers:
- None found.

security_check:
- PASS: no sensitive values were recorded.
- PASS: no submit or mutation was executed.

---

status: partial pass
task: QA2-001 scoped smoke - #241, #244, #245 only
environment:
- branch: qa/team2-241-244-245-smoke
- local main after pull: origin/main
- basis commit: 09ea0afb54c8620943d26f3602e3d63f4ffe85da
- observed API health commit: 09ea0afb54c8620943d26f3602e3d63f4ffe85da
- API: https://api.lumina-stage.com
- Web static pages checked by headers: GitHub Pages `character-chat.html`, `reset-password.html`, `verify-email.html`, all HTTP 200.
- Scope limited by user request to issues 241, 244, and 245. Full QA2-001 surface such as Creator Studio, Backstage, image upload, artist follow copy, and feed mini modal was not run in this pass.
- No token, cookie, password, auth code, provider secret, raw credential, or mailbox content was recorded.

tested_flows:
- PASS: `git pull origin main` was run in the clean QA worktree and returned already up to date. Initial pull in `workspace-core` was blocked by pre-existing unrelated local changes, so a separate worktree from `origin/main` was used.
- PASS: live API `/health` reports commit `09ea0afb54c8620943d26f3602e3d63f4ffe85da`, matching latest pulled main for #244/#245.
- PASS: disposable QA email signup returned active email user, access/refresh tokens, `emailVerified:false`, and an active LUMINA wallet balance of `300`.
- PASS: `GET /api/v1/me` returned the current user after signup.
- PASS: `POST /api/v1/auth/logout` returned `{ ok: true }`.
- PASS #241: `POST /api/v1/auth/password-resets` for the QA account returned HTTP 201, `success:true`, `ok:true`, delivery `accepted`, provider `resend`, and no debug token.
- PASS #241: `POST /api/v1/auth/email-verifications` for the QA account returned HTTP 201, `success:true`, `ok:true`, delivery `accepted`, provider `resend`, and no debug token.
- PASS #244/#245: unauthenticated chat product/provider/usage endpoints return HTTP 401 with `UNAUTHORIZED`.
- PASS #244/#245: authenticated `GET /api/v1/chat-feature-products` returned 6 active products. First product `CHAT_DEEP_REPLY` had generation disabled with provider not configured/not allowed and `canCreatePaidOrder:false`.
- PASS #244/#245: authenticated chat session creation for `seo-yuan` returned HTTP 201.
- PASS #245: authenticated `GET /api/v1/chat/usage-summary` returned daily/provider counters, `walletMutation:false`, `settlementEligible:false`, `providerCall:false`, and `rawMessagesExposed:false`.
- PASS #245: authenticated `GET /api/v1/chat/provider-ops-status` returned provider configured `false`, `canAttemptProvider:false`, `walletMutation:false`, `settlementMutation:false`, and `secretsReturned:false`.
- PASS #244: authenticated `POST /api/v1/chat-feature-orders/preview` returned read-only preview with wallet before/after estimate only; no balance mutation was observed.
- PASS #244: `POST /api/v1/chat-feature-orders` without idempotency key returned HTTP 400 `CHAT_FEATURE_ORDER_IDEMPOTENCY_REQUIRED`.
- PASS #244: `POST /api/v1/chat-feature-orders` with idempotency key while provider is unavailable returned HTTP 503 before debit. Wallet balance before and after remained `300`.

blockers:
- None confirmed in the scoped live API smoke.

repro_steps:
1. Run `git pull origin main` in a clean worktree at `origin/main`.
2. Confirm `curl https://api.lumina-stage.com/health` reports commit `09ea0afb54c8620943d26f3602e3d63f4ffe85da`.
3. Create a disposable QA email user through `POST /api/v1/auth/register`; do not record the password or tokens.
4. Call `GET /api/v1/me` with the access token and confirm current-user identity.
5. Call `GET /api/v1/chat-feature-products` with the access token.
6. Create a chat session for active artist `seo-yuan`.
7. Call `GET /api/v1/chat/usage-summary?artistId=<seo-yuan id>`.
8. Call `GET /api/v1/chat/provider-ops-status`.
9. Call `POST /api/v1/chat-feature-orders/preview` with the session/product pair.
10. Call `POST /api/v1/chat-feature-orders` once without idempotency key and confirm `CHAT_FEATURE_ORDER_IDEMPOTENCY_REQUIRED`.
11. Call `POST /api/v1/chat-feature-orders` with an idempotency key while provider is unavailable and confirm HTTP 503 plus unchanged wallet balance.
12. Request password reset and email verification for the QA account; verify accepted provider delivery response and absence of debug token.
13. Logout with the refresh token.

screenshots_or_notes:
- No screenshots captured in this pass.
- Real email subject/body copy for #241 could not be visually verified because no safe mailbox or received email content was available in this session. Only provider acceptance and no-debug-token behavior were verified live.
- Focused Jest checks could not run because this fresh worktree has no installed `server/node_modules`; `npm.cmd test -- auth-email-delivery.service.spec.ts --runInBand` and `npm.cmd test -- chat.service.spec.ts --runInBand` both failed with `jest is not recognized`.
- Minor consistency note for #244/#245: the order-create 503 uses error code `CHAT_LLM_PROVIDER_NOT_CONFIGURED` and backend message `Character chat generation provider is not configured`, while the response also includes `messageKey: chat.generation.privateBetaOnly` and nested policy `disabledMessageKey: chat.generation.providerNotConfigured`. If frontend renders `error.message` directly, this can become English-only UI; otherwise it is not a live blocker.

suspected_owner: backend

next_needed:
- Provide a safe mailbox or mail-capture environment to verify #241 Korean email subject/body and KST expiry text end to end.
- Install server dependencies in the QA worktree or provide CI output if focused spec rerun is required.
- Frontend follow-up should ensure chat errors render localized `messageKey`/fallback copy instead of raw English `error.message`.

security_check:
- PASS: no secrets, tokens, passwords, cookies, auth codes, provider keys, or raw credentials were recorded.
- PASS: no successful paid order, wallet debit, settlement mutation, payout mutation, Lumina manual adjustment, Creator Studio mutation, or Backstage mutation was executed.

---

status: partial pass; live logged-in mutation blocked
task: QA2-004 - Fan engagement mission submit live smoke
branch/commit:
- branch: team2-qa/QA2-004-fan-engagement-submit-live-smoke
- local main after pull: origin/main
- basis commit: 8c24969a750a6fa765c56c3b570bdb92da16b0a8
- tested backend health commit: 8c24969a750a6fa765c56c3b570bdb92da16b0a8
changed_files:
- docs/ops/inbox/team2-qa.md
tests:
- PASS: read `docs/ops/tasks/open/QA2-004-fan-engagement-submit-live-smoke.md`.
- PASS: read `docs/ops/fan-engagement-reconciled-contract.md`.
- PASS: read `docs/ops/board.md`.
- PASS: read `docs/ops/inbox/builder-a.md`.
- PASS: `/health` returned expected commit `8c24969a750a6fa765c56c3b570bdb92da16b0a8`.
- PASS: logged-out submit probe to `POST /api/v1/fan-engagement/missions/:missionId/participations` returned HTTP 401 with `code=AUTH_REQUIRED`; no auth token/cookie was sent.
- PASS: public read-only `GET /api/v1/fan-engagement/missions?surface=home&scope=today&take=20` returned HTTP 200 with `items: 0`; no safe QA mission was exposed publicly.
- PASS: repo scan found no production-safe QA mission creation endpoint or fixture; only BA-006 manual runbook exists.
- PASS: no concept vote ballot submit was executed.
- PASS: no frontend submit implementation was changed.
- PASS: `git diff --check`.
result:
- Logged-out/no-mutation smoke passed for `AUTH_REQUIRED`.
- Logged-in live mutation smoke was not executed because safe QA prerequisites were not available in this workspace/session.
- Safe QA account: blocked. `.env.local` was not present in repo root or parent workspace path, and the current process did not have `QA_USER_EMAIL` / `QA_USER_PASSWORD` environment variables. No password/token/cookie/env value was printed or recorded.
- Safe active QA mission: blocked. Live read-only mission list returned `items: 0`; no `qa-*`, smoke, or test mission slug was available to select.
- Reset bucket isolation: blocked. No live mission was available to confirm a `season:qa-*` isolated reset bucket.
- First submit accepted participation: not run.
- Same idempotency key + same body replay: not run.
- Same idempotency key + changed `sourceType`/`sourceId` mismatch: not run.
- New key in same reset bucket duplicate behavior: not run.
- Logged-in invalid UUID -> `INVALID_UUID`: not run because safe QA credentials were unavailable.
- Inactive/expired QA mission -> `MISSION_NOT_ACTIVE`: not run because no inactive/expired QA mission was provided.
- Fan points isolation: not mutated. Contract/BA-006 review still indicates fan points must use `fan_engagement_point_ledger` only, with non-cash flags.
- Lumina wallet / settlement / payout / paid-like: no mutation request was sent, and no related endpoint was called.
- Phase 3B frontend submit should remain closed until QA2-004 can run with an explicit safe QA account, safe active QA mission, and isolated reset bucket.
blocked_by:
- Missing `.env.local` / QA credential source in the current workspace/session.
- Missing safe active QA mission in live read-only mission list.
- Missing explicit reset bucket evidence for a live QA mission.
next_needed:
- Provide or provision a safe QA user credential source in the workspace/session without exposing secrets.
- Provide a QA-only active mission visible to that QA user, preferably with `resetPolicy=season:qa-YYYYMMDD-runN`, `rewardPolicy={"points":1}`, and a short QA window.
- Re-run QA2-004 logged-in mutation matrix after those prerequisites are available.
security_check:
- PASS: no token, cookie, password, env value, signed URL, or secret was recorded.
- PASS: no logged-in live mission mutation was executed.
- PASS: no wallet, settlement, payout, Lumina, paid-like, Creator Studio, Backstage, title equip, fan proposal, or concept vote ballot mutation was executed.

---

status: blocked for live mutation; readiness matrix complete
task: QA2-003 - Fan engagement submit readiness QA
branch/commit:
- branch: team2-qa/QA2-003-fan-engagement-submit-readiness
- local main after pull: origin/main
- basis commit: 15ec446d8eee391176a8f0d2d0ee9181182e238b
- observed API health commit: f94ffd2ae1aee3c0d100a07d9aa508a702a5a79b
changed_files:
- docs/ops/inbox/team2-qa.md
tests:
- PASS: read `docs/ops/tasks/open/QA2-003-fan-engagement-submit-readiness.md`.
- PASS: read `docs/ops/fan-engagement-reconciled-contract.md`.
- PASS: read `docs/ops/board.md`.
- PASS: read `docs/ops/agents.md` because QA2-003 listed it in Read First.
- PASS: read-only live GET `https://api.lumina-stage.com/api/v1/fan-engagement/missions?surface=home&scope=today&take=3` returned HTTP 200 with `items: 0`.
- PASS: read-only live GET `https://api.lumina-stage.com/api/v1/fan-engagement/concept-votes?status=active&surface=artist_detail&take=3` returned HTTP 200 with `items: 0`.
- PASS: frontend scan found Home teaser only calls the read-only mission GET from `pages/fan-engagement.js`.
- PASS: backend scan confirmed submit endpoints are JWT-protected but live mutation readiness still requires safe data.
- PASS: fan engagement policy and point ledger remain separate from Lumina wallet/settlement/paid-like surfaces in the contract and implementation scan.
result:
- Live mission submit QA is blocked for now.
- No safe active QA mission was available from live read-only GET; `items: 0`.
- No safe active concept vote was available from live read-only GET; `items: 0`.
- A safe QA user may exist operationally, but this task did not verify credentials and did not use secrets.
- No documented reset/isolation bucket or cleanup procedure for production QA participation was found in the required docs.
- Duplicate submit and idempotency replay cannot be safely verified on live production until a disposable QA mission/user/reset bucket is explicitly provided.
- Logged-out/no-mutation behavior should be verified in Phase 3B by clicking enabled CTA while logged out and confirming auth UI plus zero POST/PATCH/PUT/DELETE. In this readiness task, no logged-out POST was sent.
- Fan points can be verified separately from Lumina because contract and implementation expose `fan_engagement_point_ledger`, `cashLike: false`, `luminaAmount: 0`, `settlementEligible: false`, and `pointsTransferable: false`.
- No mission participation submit, concept vote ballot submit, fan proposal submit, title equip, Creator Studio mutation, Backstage mutation, wallet, settlement, paid-like, payout, or cash-like mutation was executed.

phase_3b_qa_matrix:
- logged-out CTA: open enabled CTA state, expect auth modal or auth-required state, zero mutation requests.
- logged-in first mission submit: safe QA user + safe QA mission only; expect `POST /api/v1/fan-engagement/missions/:missionId/participations`, `participation.status=accepted`, `idempotentReplay=false`, non-cash points only.
- duplicate mission submit same reset bucket: repeat with same QA user/mission after first accepted submit; expect stable already-participated response and no extra point ledger grant.
- idempotency replay same key/body: repeat same request with same idempotency key; expect `idempotentReplay=true` and no duplicate participation or point ledger.
- idempotency mismatch: reuse key against a different mission or payload if supported; expect stable validation error such as idempotency-key-reused and no mutation.
- concept vote ballot submit: safe QA vote/option only; expect ballot accepted, optional linked mission participation, no wallet/Lumina/settlement side effect.
- fan one-line proposal submit: safe QA artist/mission only; expect moderation/pending state, no public exposure before approval, no wallet/Lumina/settlement side effect.
- fan points separation: compare fan engagement summary before/after with wallet/Lumina balance unchanged; verify `cashLike=false`, `luminaAmount=0`, `settlementEligible=false`.
- mobile/narrow enabled CTA: verify enabled CTA, loading, success, duplicate, error, and auth-required states at desktop, 390px, and 320px without overlap/overflow.
- raw copy/i18n: verify Korean user-facing messages, no raw enum/message keys in visible UI.
- observability: record sanitized request path, HTTP status, code/messageKey only; no token/cookie/password/env/idempotency key body values.

blocked_by:
- Safe active QA mission is not available or not identified.
- Safe active QA concept vote/option is not available or not identified.
- Reset bucket cleanup/isolation procedure is not documented for production QA.
- Explicit Leader approval for a disposable QA user + QA mission + reset/cleanup plan was not provided in this task.

next_needed:
- Builder/Leader should provide a disposable QA user, a QA-only active mission/vote/proposal target, expected reset policy, and cleanup/reset instructions.
- Integrator should keep Phase 3B submit gate closed until BA-005, BB-006, QA2-003 readiness blockers are resolved.

security_check:
- PASS: no sensitive values were recorded.
- PASS: no live mutation request was sent.

next_needed:
- No follow-up required for this smoke scope.

---

status: pass
task: QA2-002 - Fan engagement Home teaser real GET read-only smoke
environment:
- branch: team2-qa/QA2-002-fan-engagement-real-get-smoke
- local main after pull: origin/main
- basis commit: 412dedbaee9fd92a1e60277b3f3332d50b954496
- requested main: 412dedb
- observed API health commit: f94ffd2ae1aee3c0d100a07d9aa508a702a5a79b
- page: https://www.lumina-stage.com/index.html
- No token, cookie, password, env value, signed URL, object URL, or credential was recorded.
- No mission participation submit, concept vote ballot submit, fan proposal submit, title equip, Creator Studio, Backstage, wallet, settlement, paid-like, payout, or cash-like mutation was executed.

tested_flows:
- PASS: `index.html` renders the fan mission teaser section at `#fan-missions`.
- PASS: page issued the expected read-only GET: `https://api.lumina-stage.com/api/v1/fan-engagement/missions?surface=home&scope=today&take=3`.
- PASS: live API returned HTTP 200 with contract top-level keys and `items: []`; Home rendered safe empty state.
- PASS: contract success response with 3 mission items rendered 3 cards from API response shape.
- PASS: forced API failure rendered safe fallback state with 3 fallback cards.
- PASS: Korean copy is readable in the browser for empty, fallback, and contract-card states.
- PASS: raw enum, backend status, message key, or English-only backend key text was not exposed in teaser UI.
- PASS: CTA buttons remained disabled in fallback and contract-card states.
- PASS: forced clicks on disabled CTAs produced 0 prohibited mutation requests.
- PASS: desktop 1365x900, mobile 390x844, and narrow 320x740 showed no teaser card/text/action overlap or overflow.
- PASS: existing Home hero, main artists, shortform, debut line, and debut carousel rendered after the teaser change.

network_check:
- Observed GET URL: `https://api.lumina-stage.com/api/v1/fan-engagement/missions?surface=home&scope=today&take=3`.
- PASS: mutation requests matching prohibited fan-engagement submit/title paths: 0.
- PASS: Creator Studio / Backstage mutation requests: 0.
- PASS: wallet / settlement / paid-like / payout requests: 0.
- PASS: click delta after forced CTA clicks: 0 prohibited mutation requests.

responsive_check:
- desktop 1365x900: teaser visible; live empty state visible; no overlap/overflow.
- mobile 390x844: teaser visible; live empty state visible; no overlap/overflow.
- narrow 320x740: teaser visible; live empty state visible; no overlap/overflow.
- contract-card success path at desktop: 3 cards visible; no overlap/overflow.
- forced failure path at desktop: fallback notice and 3 cards visible; no overlap/overflow.

repro_steps:
1. Run `git pull origin main`.
2. Confirm local `HEAD` is `412dedbaee9fd92a1e60277b3f3332d50b954496`.
3. Open `https://www.lumina-stage.com/index.html`.
4. Monitor `fan-engagement` network requests.
5. Confirm only `GET /api/v1/fan-engagement/missions?surface=home&scope=today&take=3` is called for the teaser.
6. Confirm live response renders the empty state when `items` is empty.
7. Intercept the same GET with a contract 3-item success body and confirm 3 cards render.
8. Intercept the same GET with a 503 response and confirm fallback state renders.
9. Force-click `.fan-mission-cta` buttons while monitoring network.
10. Repeat layout checks at 1365x900, 390x844, and 320x740.
11. Confirm Home hero, main artists, shortform, and debut line carousel still render.

blockers:
- None found.

caveats:
- Live production GET returned a valid empty response, so real live data did not include mission cards at test time. Card rendering was verified with the same GET endpoint intercepted to a contract-shaped 3-item success response.

security_check:
- PASS: no sensitive values were recorded.
- PASS: no submit or mutation was executed.

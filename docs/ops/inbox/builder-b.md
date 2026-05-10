# Builder B Inbox

Use the standard completion note from `docs/ops/agents.md`.

status: done
task: BS-001 Backstage object storage diagnostics panel; CS-001 Creator Studio settlement amount charge request UI
branch/commit: main / 55f1b8e47fb8959eafed4e77d6a101ff9c089cab
changed_files:
- backstage.html
- backstage.js
- backstage.css
- creator-studio.html
- docs/ops/inbox/builder-b.md
tests:
- node --check backstage.js
- parsed creator-studio.html inline scripts with Node Function constructor
- git diff --check
result:
- Backstage overview now fetches GET /admin/api/v1/backstage/operations/object-storage/diagnostics with existing Backstage auth and renders a safe diagnostics card.
- Diagnostics display reason, configured/missing labels, upload counts, warnings, next actions, and sensitive-value policy without showing raw env values or credentials.
- Creator Studio settlement area now shows request-only 정산금으로 충전 copy, lists requested conversion requests, posts with settlementKey and amountKrw, and refreshes the request list after success.
- Creator Studio copy states that wallet balance is not updated until administrator/accounting confirmation.
blocked_by:
- none
next_needed:
- Reviewer/Integrator browser QA with authorized Backstage and Creator Studio accounts against the deployed API.

status: fixed
task: Reviewer P2 - R2 endpoint diagnostics readiness signal
branch/commit: main / bf1bf4a52416d44e2b83a221158636c97b2e582e
changed_files:
- backstage.js
- docs/ops/inbox/builder-b.md
tests:
- node --check backstage.js
- git diff --check
result:
- Updated objectStorageSignal so storageProvider r2 with environment.endpointConfigured false returns R2 endpoint missing / warning before any ready check.
- Updated direct upload ready logic so R2 can only be ready when endpointConfigured is true.
blocked_by:
- none
next_needed:
- Reviewer re-check P2 on origin/builder-b-frontend.

status: mapped
task: BB-002 - 1st Fan Engagement Loop UI Map
branch/commit: main / e2a665642bd4011b4ed96e65ef34fe0145fde818
changed_files:
- docs/ops/inbox/builder-b.md
tests:
- git diff --check
result:
- UI map only. No product code changed.
- Scope excludes dance/video upload, trading, settlement, and revenue-sharing UI.
- First pass should favor one-tap or very short text participation. Rewards appear as achievements, points, titles, or exposure priority only.

## BB-002 UI Map

### index.html
1. Block: `오늘의 팬 참여 미션` compact strip near the existing home content entry area.
2. Minimum copy: `오늘 한 번만 눌러 참여하기`, `내가 응원한 아티스트에게 작은 신호를 보냅니다.`
3. States: empty `오늘 열려 있는 미션이 없습니다.`; loading `오늘의 미션을 불러오는 중입니다.`; error `미션을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.`
4. Builder A endpoint: `GET /api/v1/fan-engagement/daily-missions?surface=home`; `POST /api/v1/fan-engagement/missions/:missionId/complete`.
5. Frontend risk/dependency: needs auth-aware CTA. Logged-out users should open login, not lose the intended mission action. Keep it as a small product strip, not a landing hero.

### character-detail.html
1. Block: `아티스트 팬 액션` panel with one-tap mission, concept vote, and one-line proposal.
2. Minimum copy: `응원 클릭`, `다음 콘셉트 고르기`, `한 줄 제안 남기기`.
3. States: empty `지금 참여할 액션이 없습니다.`; loading `팬 액션을 불러오는 중입니다.`; error `참여 항목을 불러오지 못했습니다.`
4. Builder A endpoint: `GET /api/v1/artists/:artistId/fan-engagement`; `POST /api/v1/fan-engagement/missions/:missionId/complete`; `POST /api/v1/fan-engagement/concept-votes/:voteId/options/:optionId`; `POST /api/v1/artists/:artistId/fan-proposals`.
5. Frontend risk/dependency: must resolve artist id from current detail data, not slug-only if backend requires id. Proposal input should be one line with length cap and duplicate-submit guard.

### lumina-feed.html
1. Block: `팬 제안과 아티스트 반응` feed module/card type inside existing feed list.
2. Minimum copy: `팬 제안`, `아티스트 반응 준비 중`, `승인된 반응`.
3. States: empty `아직 공개된 팬 제안 반응이 없습니다.`; loading `팬 참여 피드를 불러오는 중입니다.`; error `팬 참여 피드를 불러오지 못했습니다.`
4. Builder A endpoint: `GET /api/v1/feed?type=fan_engagement`; optional `POST /api/v1/feed/:postId/reactions` for lightweight likes.
5. Frontend risk/dependency: AI reaction drafts must only appear after approval. Feed renderer needs a safe new content type that does not imply upload or long-form creation.

### mypage.html
1. Block: `내 팬 참여 기록` dashboard with points, achievements, title selector, and recent participation.
2. Minimum copy: `내 참여 포인트`, `획득한 배지`, `대표 타이틀`, `최근 참여`.
3. States: empty `아직 참여 기록이 없습니다.`; loading `참여 기록을 불러오는 중입니다.`; error `참여 기록을 불러오지 못했습니다.`
4. Builder A endpoint: `GET /api/v1/me/fan-engagement/summary`; `PATCH /api/v1/me/fan-engagement/title`.
5. Frontend risk/dependency: title selector needs optimistic UI rollback. Points must not look cash-like or withdrawable.

### user-profile.html
1. Block: `공개 팬 타이틀` compact badge row near profile identity and stats.
2. Minimum copy: `대표 타이틀`, `팬 참여 배지`.
3. States: empty `공개 중인 팬 타이틀이 없습니다.`; loading `팬 타이틀을 불러오는 중입니다.`; error `팬 타이틀을 표시하지 못했습니다.`
4. Builder A endpoint: `GET /api/v1/users/:userId/fan-engagement/public-summary` or include in existing public profile response.
5. Frontend risk/dependency: public profile currently has self/other states. Do not expose private participation history, only selected title and public badges.

### creator-studio.html
1. Block: `오늘의 팬 참여 작업` queue for approving fan proposals and AI draft reactions.
2. Minimum copy: `오늘 확인할 팬 제안`, `AI 반응 초안`, `승인 후 공개`, `보류`.
3. States: empty `오늘 확인할 팬 참여 작업이 없습니다.`; loading `오늘의 작업을 불러오는 중입니다.`; error `작업 목록을 불러오지 못했습니다.`
4. Builder A endpoint: `GET /api/v1/me/creator-studio/fan-engagement/tasks?status=pending`; `POST /api/v1/me/creator-studio/fan-engagement/tasks/:taskId/approve`; `POST /api/v1/me/creator-studio/fan-engagement/tasks/:taskId/hold`.
5. Frontend risk/dependency: Creator Studio access gate must remain the only entry. Draft reactions need clear approval state and no auto-publish on load.

### backstage.html
1. Block: `Fan engagement ops` admin overview for mission setup, active votes, proposal moderation, and draft reaction health.
2. Minimum copy: `활성 미션`, `콘셉트 투표`, `팬 제안 검토`, `AI 반응 승인 대기`.
3. States: empty `운영 중인 팬 참여 항목이 없습니다.`; loading `팬 참여 운영 현황을 불러오는 중입니다.`; error `팬 참여 운영 현황을 불러오지 못했습니다.`
4. Builder A endpoint: `GET /admin/api/v1/backstage/fan-engagement/overview`; `POST /admin/api/v1/backstage/fan-engagement/missions`; `PATCH /admin/api/v1/backstage/fan-engagement/missions/:missionId`; `GET /admin/api/v1/backstage/fan-engagement/moderation`.
5. Frontend risk/dependency: should follow existing Backstage auth helpers and role visibility. Do not attach wallet, payout, settlement, or revenue controls to this area.

blocked_by:
- Builder A endpoint contract names/response shapes are not final yet.
next_needed:
- Builder A to confirm response shapes for mission, vote, proposal, achievement, public title, and Creator Studio task objects.
- Integrator to decide whether first UI skeleton should be static placeholders or API-backed components after BA-002 lands.

status: updated
task: BB-002 - UI map visibility, mobile, and i18n follow-up
branch/commit: main / ace5811b329752f8bf7ff1b0ae16973e23ab500b
changed_files:
- docs/ops/inbox/builder-b.md
tests:
- git diff --check
result:
- Confirmed BB-002 task file and kept this as a documentation-only UI map.
- Added explicit mobile and language/i18n considerations below for the same first-pass fan engagement loop.

## BB-002 Mobile / i18n Notes

- Mobile layout: each fan action should collapse to a single-column card or compact strip with one primary tap target. Avoid multi-button toolbars wider than the viewport. On `character-detail.html`, stack mission, vote, and one-line proposal vertically under the artist summary so users can act without horizontal scrolling.
- Mobile tap behavior: mission completion and vote options should be 44px+ touch targets. Proposal submit should stay next to or below the one-line input depending on width, with disabled/loading state to prevent double submit.
- Mobile feed behavior: `lumina-feed.html` fan proposal/reaction cards should reuse the existing feed card rhythm and not add a new dense dashboard block. AI reaction approval labels should be visible without opening a modal.
- Mobile Creator Studio: `creator-studio.html` today tasks should use the existing table/card responsive pattern. If table columns overflow, prioritize `제안/초안`, `상태`, and one action button; move metadata into the detail modal.
- Mobile Backstage: `backstage.html` fan engagement ops should be an operations card or table section that follows existing Backstage stacked mobile layout. Admin actions must not crowd the overview header.
- Korean copy: keep all first-pass labels short and plain Korean, for example `오늘 참여`, `응원 완료`, `투표 완료`, `승인 대기`, `공개됨`. Avoid long explanatory text inside buttons.
- Encoding risk: several existing static pages have had mojibake history, so new Korean strings should be edited and verified as UTF-8. Any inline script edits should be parsed after change and visually spot-checked for broken Korean.
- i18n direction: if the surface already uses `data-i18n`, add keys instead of hard-coded strings. If the page is static-only for this pass, keep Korean literals grouped near the component renderer so later i18n extraction is simple.
- Locale fallback: Builder A responses should return status keys (`requested`, `approved`, `published`, `held`) plus optional Korean labels. Frontend should prefer local label maps so English/status keys never leak into Korean UI.
- Accessibility: one-tap mission and vote controls need `aria-pressed` or clear submitted state text. Public titles/badges should have text labels, not color-only meaning.
blocked_by:
- none for mapping; implementation still depends on Builder A response shapes.
next_needed:
- Push this branch and have Integrator/Builder A review endpoint names before UI skeleton work starts.

---

status: reconciled
task: BB-002 contract reconciliation follow-up
branch/commit: team2-qa/backstage-wallet-adjustment-qa / this reconciliation commit
changed_files:
- docs/ops/fan-engagement-reconciled-contract.md
result:
- Leader reconciled BB-002 with BA-002 in `docs/ops/fan-engagement-reconciled-contract.md`.
- Replace `GET /api/v1/fan-engagement/daily-missions?surface=home` with `GET /api/v1/fan-engagement/missions?surface=home&scope=today&take=3`.
- Replace `POST /api/v1/fan-engagement/missions/:missionId/complete` with `POST /api/v1/fan-engagement/missions/:missionId/participations`.
- Replace `POST /api/v1/fan-engagement/concept-votes/:voteId/options/:optionId` with `POST /api/v1/fan-engagement/concept-votes/:voteId/ballots`.
- Use `GET /api/v1/me/fan-engagement/summary` for MyPage points, achievements, titles, and recent participation.
- Use `GET /api/v1/me/creator-studio/today-tasks` for Creator Studio queues; actions mutate the source proposal/draft endpoints, not task IDs.
- Frontend must map stable label keys to Korean copy and must not render raw enum keys or English-only backend copy.
next_needed:
- Update any future UI skeleton against the reconciled endpoints before wiring API calls.

---

status: locked
task: BB-003 frontend implementation lock
branch/commit: team2-qa/backstage-wallet-adjustment-qa / this lock commit
changed_files:
- docs/ops/tasks/open/BB-003-fan-engagement-frontend-implementation-map.md
- docs/ops/board.md
- docs/ops/inbox/builder-b.md
- docs/ops/inbox/integrator.md
result:
- Leader approved Builder B planning only under the condition that the first slice is `index.html` Home read-only/mock teaser.
- Frontend must not wire submit behavior or API mutations until the Backend First PR is complete and reviewed.
- Before Backend First PR, Builder B may plan placement, static/mock data shape, loading/empty/error states, mobile behavior, and Korean/i18n fallback only.
blocked_by:
- Backend First PR is required before frontend mutation wiring.
next_needed:
- Builder B should keep BB-003 as a planning task and explicitly mark mutation wiring as blocked.

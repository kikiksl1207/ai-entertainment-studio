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

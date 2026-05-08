# Team2 QA Inbox

status: fail
task: QA2-001 - live QA recheck with prepared QA accounts
environment:
- branch: team2-qa/live-recheck-c6ba8fd
- local base after pull: origin/main @ c6ba8fdf6ecb4984897a55426da58da983b526ed
- Render/API health commit: 661731b92d572cf3554020eb77903ed3d6aaea33
- frontend: https://www.lumina-stage.com
- backend: https://api.lumina-stage.com
- QA credentials were read from local .env.local and used only for login input/session setup. No passwords, tokens, cookies, or raw secrets are recorded here.

tested_flows:
- PASS: `/health` responds 200 and reports requested deployed commit `661731b92d572cf3554020eb77903ed3d6aaea33`.
- PASS: `qa.user1@luminastudio.ai` login/current user. `/api/v1/me` returned 200, feed showed logged-in header, Lumina balance, logout, and compose UI.
- PASS: feed author/profile click opens mini profile modal with author handle, follow button, and profile link.
- PASS: artist detail follow/unfollow copy. `팔로우` -> `팔로잉 해제` -> `팔로우`; no `팔로잉해제` mojibake observed.
- PASS: Creator Studio access for `qa.creator@luminastudio.ai`. API returned `access.enabled=true`, `reason=active_artist_operator_found`, `source=artist_operator`, artist slug `yoon-serin`; UI entered Studio instead of access gate.
- PASS: Creator Studio mobile at 320px and 390px shows fixed bottom `.studio-nav`, no horizontal overflow, and after bottom scroll no visible text was covered by the nav.
- PASS: Backstage access for `qa.admin@luminastudio.ai`. UI entered Backstage, showed admin account, user management, and object storage diagnostics without exposing secret values.
- PASS: Backstage mobile at 320px and 390px shows fixed bottom `.sidebar-nav`, no horizontal overflow, and after bottom scroll no visible text was covered by the nav.
- PASS: Backstage > 유저 관리 > 루미나 수동 조정 단건 모달 opens.
- PASS: Lumina manual adjustment validation blocks before confirmation modal when target/amount are missing. `.confirm-modal` stayed hidden and no non-GET mutation request was sent.
- PASS: Lumina manual adjustment validation blocks before confirmation modal when reason is missing. `.confirm-modal` stayed hidden and no non-GET mutation request was sent.
- PASS: `debut.html` `partnership_other` browser submit after hotfix. Frontend POST returned 201; payload used `applicationType=partnership_other`, `applicationChannel=phone_consultation`, included `intro`, and did not send `partnershipInquiry`.
- PASS: logged-in feed mobile at 320px, 390px, and 768px has no horizontal overflow, feed cards stay single-column, and no feed button overlaps were detected. Edit/delete buttons were not visible because the current feed did not contain qa.user1-authored posts.
- FAIL: feed image cards and lightbox still fail due object storage public read. Feed image asset cards are `is-broken`, image elements are hidden with natural size 0x0, and direct HEAD requests to the feed asset object URLs return 403.
- FAIL: image lightbox opens from the broken asset area, but no usable image is displayed inside the lightbox, so lightbox image right-click blocking cannot be fully validated on a visible image.

blockers:
- P0 backend/storage: feed image object URLs are not publicly readable. Current production feed has two image assets, both returning HTTP 403 on direct HEAD, and browser image elements report `naturalWidth=0`, `naturalHeight=0`.
- P1 frontend/storage UX: broken feed image cards occupy large empty image areas with no visible fallback copy. The lightbox shell opens but displays no usable image/fallback.

repro_steps:
1. Open `https://api.lumina-stage.com/health`.
2. Confirm status 200 and commit `661731b92d572cf3554020eb77903ed3d6aaea33`.
3. Log in as the general QA user and open `https://www.lumina-stage.com/lumina-feed.html`.
4. Confirm logged-in header/compose UI is visible and guest login CTA is gone.
5. Click a feed author header; confirm mini profile modal opens.
6. Open `https://www.lumina-stage.com/character-detail.html?slug=yoon-serin`.
7. Click follow, then unfollow; observe copy `팔로우` -> `팔로잉 해제` -> `팔로우`.
8. Open `https://www.lumina-stage.com/creator-studio.html` as the creator QA account at 320px/390px; confirm Studio loads and bottom nav is visible.
9. Open `https://www.lumina-stage.com/backstage.html#users` as the admin QA account; confirm Backstage and user management load.
10. Click `단건 조정`; leave target/amount blank and press run. Confirm no `.confirm-modal`, inline validation says to enter target user, and no mutation request is sent.
11. Enter target and amount but leave reason blank and press run. Confirm no `.confirm-modal`, inline validation says to enter reason, and no mutation request is sent.
12. Open `debut.html`, select `partnership_other`, fill the form with QA test text, and submit. Confirm POST 201 and payload shape excludes `partnershipInquiry`.
13. Open `lumina-feed.html`; inspect `.feed-post-asset-item`. Observe `is-broken`, hidden `img`, natural size 0x0.
14. Direct HEAD the feed asset object URLs returned by `/api/v1/lumina-feed?take=10`; observe HTTP 403.
15. Click the broken asset area; observe lightbox shell opens but contains no visible usable image.

screenshots_or_notes:
- No passwords, tokens, cookies, or raw secrets were printed or written.
- No Lumina adjustment was executed; the test stopped at form validation before confirmation modal.
- One `partnership_other` debut QA application was submitted from the frontend as requested.
- Feed follow/unfollow was restored to the original state after the copy check.

suspected_owner: backend

next_needed:
- Fix S3/Object Storage public read or served asset URL policy for feed image assets.
- Add/verify visible broken-image fallback in feed cards and lightbox while storage is unavailable.
- Re-run image card/lightbox/right-click QA after image assets load successfully.

# Team2 Frontend Inbox

status: done
task: FE2-001 - Existing UI Bugfixes
branch/commit: team2-frontend/FE2-001-existing-ui-bugfixes / pushed branch HEAD
changed_files:
- app.js
- styles.css
- backstage.js
- backstage.css
- docs/ops/inbox/team2-frontend.md
tests:
- `node --check backstage.js`
- `node --check app.js`
- `git diff --check`
result:
- Fixed follow/unfollow visible copy from `팔로잉`/hover `팔로우 해제` to readable `팔로잉 해제` in feed follow controls, public user profile follow controls, and feed author mini profile modal.
- Feed image upload UI now refreshes submit disabled state immediately before each selected image upload starts, preventing post submit while upload is in progress.
- Backstage confirmation modal now uses clearer wallet adjustment CTA copy (`조정 실행`) and stacks summary/action controls on mobile to reduce overflow.
- Team1 BB-002 fan engagement loop UI was not touched, and backend contract/API paths were not changed.
blocked_by:
- Live product QA remains blocked by missing safe test environment/access inputs.
next_needed:
- Browser/mobile smoke on Lumina feed, user profile mini modal, image upload failure/success state, and Backstage confirmation modal once a safe test environment is provided.

---

status: done
task: Team2 Frontend review/hotfix for latest main feed/mobile/Backstage UX
branch/commit: team2-qa/QA2-001-live-product-smoke-qa @ 1c9e53e (includes origin/main 1c5d995 merge)
changed_files:
- backstage.js
- backstage.css
- creator-studio.html
- docs/ops/inbox/team2-frontend.md
tests:
- `node --check app.js` passed
- `node --check backstage.js` passed
- `creator-studio.html` inline scripts parsed with Node Function constructor: 2 scripts passed
- `git diff --check` passed; only CRLF conversion warnings were printed
review_result:
- Feed image URL fallback keeps existing `asset.url`, `publicUrl`, direct `entry.url`, and thumbnail fallbacks before storage keys, so existing feed data shape is preserved.
- Feed image lightbox click handling is scoped to `[data-feed-asset]`; card navigation ignores `a`/`button`, so normal card/link clicks are not blocked.
- Right-click/drag protection is scoped to content image selectors and lightbox surfaces, not the whole page.
- Feed one-column CSS is limited to `max-width: 1120px` and narrower breakpoints; desktop grid above that remains unchanged.
- Found and fixed a small mobile overlay bug: Creator Studio and Backstage modal z-index values now sit above the fixed bottom menus so modal body/actions are not covered.
- Found and fixed a wallet validation bug: Backstage wallet adjustment example text is now placeholder text, not prefilled value, so missing target/note validation and focus can work naturally.
blocked_by:
- No live browser/mobile environment or account was provided, so this is a code-level review and hotfix only.
next_needed:
- Run real mobile/browser smoke for feed image open/close, link clicks, Creator Studio modal actions, and Backstage wallet validation in a safe QA environment.

---

status: done
task: Team2 Frontend 403 feed image fallback hotfix
branch/commit: team2-frontend/feed-403-fallback @ HEAD (see final commit hash)
changed_files:
- app.js
- styles.css
- backstage.css
- backstage.js
- creator-studio.html
- docs/ops/inbox/team2-frontend.md
tests:
- `git pull --autostash origin main` completed; already up to date
- `node --check app.js` passed
- `node --check backstage.js` passed
- `git diff --check` passed; only CRLF conversion warnings were printed
result:
- Confirmed feed card broken-image fallback already shows `이미지를 불러올 수 없어요` instead of a native broken image box when thumbnail/full image fails.
- Confirmed storage 403 is not bypassed or retried beyond the existing thumbnail-to-full fallback; object storage permission remains a backend/storage issue.
- Fixed lightbox broken asset state so a 403 original image shows a small `이미지를 불러올 수 없어요` panel instead of a large empty black image area.
- Kept Frontend-only modal layering and wallet validation copy cleanup separate from Backend/Reviewer docs.
- Kept the change scoped to the feed image/lightbox fallback UI; no large UI redesign or object storage workaround was added.
blocked_by:
- Original object storage URLs still return 403 in QA, so visual verification of real images remains limited until storage permissions are fixed.
next_needed:
- Re-test feed images after object storage 403 is fixed; verify both card thumbnails and lightbox originals load from authorized URLs.

---

status: done
task: Team2 Frontend / Feed Upload UX
branch/commit: team2-frontend/feed-403-fallback @ HEAD (see final commit hash)
changed_files:
- app.js
- styles.css
- docs/ops/inbox/team2-frontend.md
tests:
- `git pull --autostash origin main` completed; already up to date
- `node --check app.js` passed
- `git diff --check` passed; only pre-existing server file CRLF warnings were printed
result:
- Aligned client-side feed image policy with the backend 20MB limit and added visible `이미지 · 20MB 이하` guidance in the composer.
- Added upload preflight validation for file type and file size before requesting upload intent.
- Added clear upload failure copy for 20MB+ files, unsupported formats, direct S3/network upload failures, and expired login.
- Added staged progress messages for upload preparation, S3/direct storage upload, confirm-upload, and upload completion.
- Stabilized uploaded thumbnail preview by preferring future backend display/thumbnail/image URLs and falling back to a local blob preview if the returned preview URL fails.
- Kept object storage behavior intact: no signed URL logging, no secret/env output, and no frontend workaround for storage permissions.
blocked_by:
- Final PASS for small image, 14MB image, posting/card display, and lightbox display requires browser QA with real files/accounts.
next_needed:
- QA should retest: small image upload, 14MB image upload, 20MB+ rejection message, post/card image display, and lightbox image display.

---

status: done
task: Team2 Frontend / Initial Render Flash Fix
branch/commit: team2-frontend/feed-403-fallback @ HEAD (see final commit hash)
changed_files:
- app.js
- styles.css
- backstage.css
- backstage.js
- backstage.html
- creator-studio.html
- mypage.html
- public HTML entry pages
- docs/ops/inbox/team2-frontend.md
tests:
- `node --check app.js` passed
- `node --check backstage.js` passed
- inline HTML scripts parsed for index/feed/mypage/creator-studio/backstage
- `git diff --check` passed; only CRLF conversion warnings were printed
result:
- Added a default `is-booting` body state on app entry pages and switched to `is-ready` after app/Backstage/Creator Studio bootstraps finish.
- Blocked initial FOUC for header auth buttons, wallet badge, feed compose/guest compose, and auth/permission dependent sections before JS confirms state.
- Added a small feed loading placeholder while the feed page is booting, without changing the mobile bottom tabbar layout.
- Set My Page auth/guest panels hidden in initial HTML so both states cannot flash before auth resolution.
- Added Backstage boot overlay and ready transition so saved-session checks do not briefly show the wrong login/dashboard surface.
blocked_by:
- Browser-level visual smoke was not run because no local browser automation dependency was available in this workspace.
next_needed:
- QA should verify first paint on feed, mypage, creator-studio, backstage, and mobile widths with both logged-in and logged-out states.

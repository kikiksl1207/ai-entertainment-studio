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

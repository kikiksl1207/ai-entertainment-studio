# Team2 QA Inbox

status: fail
task: QA2-001 - signed feed asset delivery follow-up recheck
environment:
- branch: team2-qa/signed-assets-followup-recheck
- commit 기준: a42ede593b256036077bd741590debd539192bda
- frontend: https://www.lumina-stage.com
- backend: https://api.lumina-stage.com
- signed URL full values, token, cookie, password, and env values were not recorded.

tested_flows:
- PASS: `/health` reports commit `a42ede593b256036077bd741590debd539192bda`.
- PASS: Feed API image URLs are absolute API-origin URLs in `https://api.lumina-stage.com/api/v1/assets/public/:assetId` shape.
- PASS: `/api/v1/assets/public/:assetId` returns 302 redirect with a signed read target location.
- FAIL: Following the 302 redirect still returns 403 from the signed read target, not 200.
- FAIL: `lumina-feed.html` feed card images still do not render. Cards remain `.feed-post-asset-item.is-broken`, images are hidden, and `naturalWidth/naturalHeight` are 0.
- FAIL: Clicking the broken image area opens the lightbox shell, but the original image still does not render; lightbox image natural size is 0x0.
- FAIL: Existing fallback UI is not visibly useful. The card area is large and blank, and the lightbox shows only the shell/close control.

blockers:
- P0 backend/storage: signed read target returns HTTP 403 after the public asset endpoint 302 redirect.
- P1 UX: broken-image fallback remains blank in feed cards and lightbox.

repro_steps:
1. Open `https://api.lumina-stage.com/health`.
2. Confirm commit `a42ede593b256036077bd741590debd539192bda`.
3. Request `https://api.lumina-stage.com/api/v1/lumina-feed?take=10`.
4. Confirm image `url` and `thumbnailUrl` use `https://api.lumina-stage.com/api/v1/assets/public/:assetId` shape.
5. Request the public asset URL with redirects disabled.
6. Confirm the first response is 302 and includes a redirect location.
7. Follow the redirect without recording the signed URL value.
8. Observe final response is 403, not 200.
9. Open `https://www.lumina-stage.com/lumina-feed.html`.
10. Observe image cards remain broken: `.feed-post-asset-item.is-broken`, hidden `img`, natural size 0x0.
11. Click the broken image area.
12. Observe lightbox shell opens, but original image is not visible and image natural size remains 0x0.

screenshots_or_notes:
- No signed URL full values were written.
- No auth secrets were used or recorded.
- No production data was modified.

suspected_owner: backend

next_needed:
- Fix signed read generation/storage permissions so the redirect target returns 200.
- Re-run feed card image, lightbox original image, and fallback QA after signed target returns 200.

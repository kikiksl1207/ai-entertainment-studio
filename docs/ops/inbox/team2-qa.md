# Team2 QA Inbox

status: fail
task: QA2-001 - signed feed asset delivery recheck
environment:
- branch: team2-qa/signed-assets-recheck
- local base after pull: origin/main @ 37735de718f0e6605248fb7903f636d33ae6ae75
- Render/API health commit: 37735de718f0e6605248fb7903f636d33ae6ae75
- frontend: https://www.lumina-stage.com
- backend: https://api.lumina-stage.com
- No passwords, tokens, cookies, or full signed read URLs were recorded.

tested_flows:
- PASS: `/health` responds 200 and reports commit `37735de718f0e6605248fb7903f636d33ae6ae75`.
- PASS: Feed API returns image asset URLs in `/api/v1/assets/public/:assetId` shape.
- PASS: Direct backend asset endpoint request to `https://api.lumina-stage.com/api/v1/assets/public/:assetId` returns 302 and includes a redirect location.
- FAIL: Following the redirect from the backend asset endpoint still ends at HTTP 403 from the signed read target.
- FAIL: `lumina-feed.html` image cards do not display images. Browser requests `/api/v1/assets/public/:assetId` on the frontend origin and receives 404; card elements remain `is-broken`, image elements are hidden, and natural size is 0x0.
- FAIL: Clicking the broken feed image area opens the lightbox shell, but the lightbox original image does not load; lightbox image natural size remains 0x0.
- FAIL: Existing fallback UI is not visibly useful. Broken image cards occupy a large empty area with no visible fallback message, and the lightbox shows only the shell/close control.

blockers:
- P0 frontend/backend integration: API returns relative asset URLs. The deployed frontend uses them as same-origin paths under `https://www.lumina-stage.com`, causing 404 instead of calling `https://api.lumina-stage.com`.
- P0 backend/storage: even when the public asset endpoint is called on the API origin, the 302 redirect target returns 403 instead of 200.
- P1 UX: fallback state is effectively blank in both card and lightbox.

repro_steps:
1. Open `https://api.lumina-stage.com/health`.
2. Confirm status 200 and commit `37735de718f0e6605248fb7903f636d33ae6ae75`.
3. Request `https://api.lumina-stage.com/api/v1/lumina-feed?take=10`.
4. Inspect feed assets; image `url` and `thumbnailUrl` are `/api/v1/assets/public/:assetId`.
5. Request the backend-origin public asset URL with redirects disabled.
6. Observe first response is 302 with a redirect location.
7. Follow redirects without recording the signed URL value.
8. Observe final response is 403, not 200.
9. Open `https://www.lumina-stage.com/lumina-feed.html` in a browser.
10. Observe two image cards remain broken: `.feed-post-asset-item.is-broken`, hidden `img`, `naturalWidth=0`, `naturalHeight=0`.
11. Observe browser asset requests to frontend-origin `/api/v1/assets/public/:assetId` return 404.
12. Click the broken image area.
13. Observe lightbox shell opens, but no original image is visible and the image natural size remains 0x0.

screenshots_or_notes:
- Signed URL full values were intentionally not logged or written.
- No auth secrets were used for this public feed asset check.
- No production data was modified.

suspected_owner: unclear

next_needed:
- Frontend should resolve relative `/api/v1/assets/public/:assetId` URLs against `API_BASE`, or backend should return absolute API-origin public asset URLs.
- Backend/storage should fix signed read redirect so the final signed target returns 200.
- Add or repair visible broken-image fallback copy in feed cards and lightbox.

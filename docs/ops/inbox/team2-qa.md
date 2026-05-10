# Team2 QA Inbox

status: pass
task: QA2-001 - feed image sharp runtime binding fix recheck
final_verdict: Feed image pipeline QA PASS. P0 resolved; okay to close.
environment:
- branch: team2-qa/feed-image-sharp-runtime-recheck
- local main after pull: origin/main
- health actual commit: 8f660647f9fee8960a0c7b3a824665e4c410345c
- frontend: https://www.lumina-stage.com
- backend: https://api.lumina-stage.com
- No signed URL, direct upload URL, object URL, token, cookie, password, env value, or S3 credential was recorded.

tested_flows:
- PASS: `/health` responds 200 and reports commit `8f660647f9fee8960a0c7b3a824665e4c410345c`.
- PASS: under 1MB image `upload-intent` returned 201.
- PASS: under 1MB image S3 PUT returned 200.
- PASS: under 1MB image `confirm-upload` returned 201.
- PASS: under 1MB feed post creation returned 201.
- PASS: under 1MB Feed API returned display/thumbnail variant public asset URLs.
- PASS: under 1MB feed card image displayed in browser.
- PASS: under 1MB image lightbox opened and displayed the image.
- PASS: near 14MB image `upload-intent` returned 201.
- PASS: near 14MB image S3 PUT returned 200.
- PASS: near 14MB image `confirm-upload` returned 201.
- PASS: near 14MB feed post creation returned 201.
- PASS: near 14MB Feed API returned display/thumbnail variant public asset URLs.
- PASS: near 14MB feed card image displayed in browser.
- PASS: near 14MB image lightbox opened and displayed the image.
- PASS: over 20MB frontend block remains active; the browser UI showed a 20MB limit message after file selection.
- PASS: over 20MB API block remains active; `upload-intent` returned 413.

observed_20mb_api_block:
- HTTP status: 413
- code: `PAYLOAD_TOO_LARGE`
- details.stage: null
- details.requestId: null
- details.reason: null

security_check:
- PASS: signed URL was not recorded.
- PASS: direct upload URL was not recorded.
- PASS: object URL was not recorded.
- PASS: token, cookie, password, env value, and S3 credential were not recorded.

repro_steps:
1. Run `git pull origin main`.
2. Open `/health`.
3. Confirm commit `8f660647f9fee8960a0c7b3a824665e4c410345c`.
4. Sign in with a regular QA user.
5. For an under 1MB JPEG, call `POST /api/v1/me/assets/upload-intents`.
6. Observe 201.
7. PUT the same image to the returned upload target without recording the target URL.
8. Observe S3 PUT 200.
9. Call `POST /api/v1/me/assets/:assetId/confirm-upload`.
10. Observe 201.
11. Create a feed post with the confirmed asset.
12. Observe feed post creation 201.
13. Open `lumina-feed.html` as the same user.
14. Observe the new feed card image is visible and loaded.
15. Click the image.
16. Observe the lightbox opens and the lightbox image is visible and loaded.
17. Repeat steps 5-16 with a near 14MB JPEG.
18. In the browser feed composer, select an over 20MB image file.
19. Observe the frontend blocks it and shows a 20MB limit message.
20. Call `POST /api/v1/me/assets/upload-intents` with the over 20MB file metadata.
21. Observe 413 with code `PAYLOAD_TOO_LARGE`.

notes:
- The under 1MB test file size was 422,924 bytes.
- The near 14MB test file size was 14,576,926 bytes.
- The over 20MB test file size was 22,020,608 bytes.
- Direct upload targets, signed delivery URLs, and object URLs were intentionally not logged or written.
- No production Lumina balance changes were performed.

suspected_owner: none

next_needed:
- No blocker found in the requested feed image pipeline scope.
- Feed image pipeline P0 is resolved and can be closed.

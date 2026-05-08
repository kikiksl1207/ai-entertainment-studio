# Team2 QA Inbox

status: fail
task: QA2-001 - feed image upload pipeline recheck
environment:
- branch: team2-qa/feed-image-pipeline-recheck
- commit 기준: 1d60b9d1458da139884ac9ff46ee085d2efe11a4
- frontend: https://www.lumina-stage.com
- backend: https://api.lumina-stage.com
- signed URL, token, cookie, password, and env values were not recorded.

tested_flows:
- PASS: `/health` reports commit `1d60b9d1458da139884ac9ff46ee085d2efe11a4`.
- FAIL: 1MB 이하 image upload pipeline. Upload intent returned 201 and S3 PUT returned 200, but `POST /api/v1/me/assets/:assetId/confirm-upload` returned 500, so no feed post could be created.
- FAIL: 14MB image upload. `POST /api/v1/me/assets/upload-intents` returned 413 before upload. The deployed `/api/v1/app/bootstrap` policy still reports `userImageUpload.maxBytes=8388608` and max 8MB, not the requested 20MB limit.
- PASS with policy mismatch: 20MB 초과 image is blocked in the browser compose UI with a clear 20MB-limit message.
- FAIL: 20MB 초과 API policy is inconsistent with UI. API rejects above 8MB, not above 20MB.
- BLOCKED by upload failure: 피드 게시 후 카드 이미지 표시 확인. No new QA image feed post was created because 1MB confirm failed and 14MB intent was rejected.
- BLOCKED by upload failure: 이미지 클릭 시 lightbox 표시 확인 for newly uploaded QA images.
- BLOCKED by upload failure: Feed API display/thumbnail variant URL verification for new QA posts.
- PASS: Existing small-image browser compose validation path is reachable and shows the compose UI, but the actual upload/post regression check is failing at backend confirm.

blockers:
- P0 backend: confirmed small image direct upload cannot complete. `upload-intent -> S3 PUT` succeeds, but `confirm-upload` returns 500.
- P0 backend/config: deployed upload policy is still 8MB. 14MB files are rejected with 413 despite the requested 20MB feed image limit.
- P1 frontend/backend consistency: browser over-limit message says 20MB, while backend policy/bootstrap says 8MB.

repro_steps:
1. Open `https://api.lumina-stage.com/health`.
2. Confirm commit `1d60b9d1458da139884ac9ff46ee085d2efe11a4`.
3. Log in as QA user.
4. Create a valid PNG under 1MB.
5. Call `POST /api/v1/me/assets/upload-intents` with file metadata.
6. Observe upload intent status 201.
7. Upload the image to the returned direct upload target without recording that target URL.
8. Observe S3 PUT status 200.
9. Call `POST /api/v1/me/assets/:assetId/confirm-upload`.
10. Observe confirm-upload status 500.
11. Create a valid PNG around 14MB.
12. Call `POST /api/v1/me/assets/upload-intents`.
13. Observe status 413 and max policy equivalent to 8MB.
14. Open `https://www.lumina-stage.com/lumina-feed.html` as QA user.
15. Attach a valid PNG over 20MB in the compose file input.
16. Observe a visible browser message telling the user to upload a 20MB-or-smaller image.

screenshots_or_notes:
- No signed URL, object URL, token, cookie, password, or env values were written.
- The direct upload target URL was used only for PUT and was not recorded.
- No new QA feed post was created because upload confirmation failed before posting.
- No production Lumina or wallet data was touched.

suspected_owner: backend

next_needed:
- Fix `confirm-upload` 500 after successful S3 PUT for small images.
- Update deployed backend/bootstrap upload policy to the intended 20MB limit.
- Re-run 1MB and 14MB upload/post/display/lightbox/variant checks after confirm and policy are fixed.

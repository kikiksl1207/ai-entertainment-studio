# Team2 QA Inbox

status: fail
task: QA2-001 - feed image pipeline backend fix recheck
environment:
- branch: team2-qa/feed-image-pipeline-backend-fix-recheck
- local main after pull: origin/main
- health actual commit: 8b2d36bce15ed6fd5465ae006c4c1b2be8176f9a
- frontend: https://www.lumina-stage.com
- backend: https://api.lumina-stage.com
- No signed URL, direct upload URL, object URL, token, cookie, password, env value, or S3 credential was recorded.

tested_flows:
- PASS: `/health` responds 200 and reports commit `8b2d36bce15ed6fd5465ae006c4c1b2be8176f9a`.
- FAIL: under 1MB image pipeline. `upload-intent` returned 201 and S3 PUT returned 200, but `confirm-upload` returned 500.
- FAIL: under 1MB feed post creation, card image display, and image lightbox could not be completed because `confirm-upload` failed before asset confirmation.
- FAIL: near 14MB image pipeline. `upload-intent` returned 201 and S3 PUT returned 200, but `confirm-upload` returned 500.
- FAIL: near 14MB feed post creation, card image display, and image lightbox could not be completed because `confirm-upload` failed before asset confirmation.
- PASS: over 20MB frontend block remains active; the browser UI showed a 20MB limit message after file selection.
- PASS: over 20MB API block remains active; `upload-intent` returned 413.

failure_details:
- under 1MB image:
  - code: `INTERNAL_SERVER_ERROR`
  - details.stage: null
  - details.requestId: null
  - details.reason: null
- near 14MB image:
  - code: `INTERNAL_SERVER_ERROR`
  - details.stage: null
  - details.requestId: null
  - details.reason: null

observed_20mb_api_block:
- code: `PAYLOAD_TOO_LARGE`
- details.stage: null
- details.requestId: null
- details.reason: null

repro_steps:
1. Run `git pull origin main`.
2. Open `/health`.
3. Confirm commit `8b2d36bce15ed6fd5465ae006c4c1b2be8176f9a`.
4. Sign in with a regular QA user.
5. For an under 1MB JPEG, call `POST /api/v1/me/assets/upload-intents`.
6. Observe 201.
7. PUT the same image to the returned upload target without recording the target URL.
8. Observe S3 PUT 200.
9. Call `POST /api/v1/me/assets/:assetId/confirm-upload`.
10. Observe 500 with code `INTERNAL_SERVER_ERROR`.
11. Repeat steps 5-10 with a near 14MB JPEG.
12. In the browser feed composer, select an over 20MB image file.
13. Observe the frontend blocks it and shows a 20MB limit message.
14. Call `POST /api/v1/me/assets/upload-intents` with the over 20MB file metadata.
15. Observe 413 with code `PAYLOAD_TOO_LARGE`.

blockers:
- P0 backend: valid feed image uploads still cannot complete because `confirm-upload` now returns 500 after successful upload-intent and S3 PUT.
- The previous `read-source-metadata` / `sharp.versions` diagnostic failure no longer appears in the response body, but the replacement failure is an opaque 500 with no `details.stage`, `details.requestId`, or `details.reason`.

notes:
- The under 1MB test file size was 422,924 bytes.
- The near 14MB test file size was 14,576,926 bytes.
- The over 20MB test file size was 22,020,608 bytes.
- Feed post creation, card image display, and image lightbox checks remain blocked until `confirm-upload` succeeds.
- Direct upload targets, signed delivery URLs, and object URLs were intentionally not logged or written.
- No production Lumina balance changes were performed.

suspected_owner: backend

next_needed:
- Inspect backend logs for the 500 during `confirm-upload` after successful S3 PUT.
- Restore structured diagnostic fields for this failure path if possible.
- Re-run post creation, feed card display, and lightbox checks after `confirm-upload` succeeds.

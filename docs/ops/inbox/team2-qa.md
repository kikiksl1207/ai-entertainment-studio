# Team2 QA Inbox

status: fail
task: QA2-001 - feed image confirm-upload stage guard recheck
environment:
- branch: team2-qa/feed-image-confirm-stage-guard-recheck
- local main after pull: origin/main
- health actual commit: 75535854bf20a9dd1faa16f8702a794e2df991bf
- frontend: https://www.lumina-stage.com
- backend: https://api.lumina-stage.com
- No signed URL, direct upload URL, object URL, token, cookie, password, env value, or S3 credential was recorded.

tested_flows:
- PASS: `/health` responds 200 and reports commit `75535854bf20a9dd1faa16f8702a794e2df991bf`.
- FAIL: under 1MB image pipeline. `upload-intent` returned 201 and S3 PUT returned 200, but `confirm-upload` returned 400.
- FAIL: under 1MB feed post creation, card image display, and image lightbox could not be completed because `confirm-upload` failed before asset confirmation.
- FAIL: near 14MB image pipeline. `upload-intent` returned 201 and S3 PUT returned 200, but `confirm-upload` returned 400.
- FAIL: near 14MB feed post creation, card image display, and image lightbox could not be completed because `confirm-upload` failed before asset confirmation.
- PASS: over 20MB frontend block remains active; the browser UI showed a 20MB limit message after file selection.
- PASS: over 20MB API block remains active; `upload-intent` returned 413.

failure_details:
- under 1MB image:
  - HTTP status: 400
  - code: `FEED_IMAGE_CONFIRM_UPLOAD_FAILED`
  - details.stage: `create-derivatives`
  - details.requestId: `0da339d1-585d-4701-b89c-eae3ea9ce720`
  - details.reason: `Cannot read properties of undefined (reading 'versions')`
- near 14MB image:
  - HTTP status: 400
  - code: `FEED_IMAGE_CONFIRM_UPLOAD_FAILED`
  - details.stage: `create-derivatives`
  - details.requestId: `24cc8b4a-1863-4675-adf6-5587e1750241`
  - details.reason: `Cannot read properties of undefined (reading 'versions')`

observed_20mb_api_block:
- HTTP status: 413
- code: `PAYLOAD_TOO_LARGE`
- details.stage: null
- details.requestId: null
- details.reason: null

repro_steps:
1. Run `git pull origin main`.
2. Open `/health`.
3. Confirm commit `75535854bf20a9dd1faa16f8702a794e2df991bf`.
4. Sign in with a regular QA user.
5. For an under 1MB JPEG, call `POST /api/v1/me/assets/upload-intents`.
6. Observe 201.
7. PUT the same image to the returned upload target without recording the target URL.
8. Observe S3 PUT 200.
9. Call `POST /api/v1/me/assets/:assetId/confirm-upload`.
10. Observe 400 with code `FEED_IMAGE_CONFIRM_UPLOAD_FAILED`, stage `create-derivatives`, and the requestId/reason above.
11. Repeat steps 5-10 with a near 14MB JPEG.
12. In the browser feed composer, select an over 20MB image file.
13. Observe the frontend blocks it and shows a 20MB limit message.
14. Call `POST /api/v1/me/assets/upload-intents` with the over 20MB file metadata.
15. Observe 413 with code `PAYLOAD_TOO_LARGE`.

blockers:
- P0 backend: valid feed image uploads still cannot complete because `confirm-upload` fails during `create-derivatives`.
- Stage guard behavior is now visible and structured, but the surfaced reason still points to `sharp.versions` being undefined.

notes:
- The under 1MB test file size was 422,924 bytes.
- The near 14MB test file size was 14,576,926 bytes.
- The over 20MB test file size was 22,020,608 bytes.
- Feed post creation, card image display, and image lightbox checks remain blocked until `confirm-upload` succeeds.
- Direct upload targets, signed delivery URLs, and object URLs were intentionally not logged or written.
- No production Lumina balance changes were performed.

suspected_owner: backend

next_needed:
- Fix the `sharp.versions` undefined path inside derivative creation or its diagnostics.
- Re-run post creation, feed card display, and lightbox checks after `confirm-upload` succeeds.

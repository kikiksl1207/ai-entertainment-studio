# Team2 QA Inbox

status: fail
task: QA2-001 - feed image pipeline diagnostic patch recheck
environment:
- branch: team2-qa/feed-image-pipeline-diagnostic-recheck
- local main after pull: origin/main
- health actual commit: 3daacf73b627a5dc90f24a70c3c51b2349452a5e
- included diagnostic commit: a019283ca3b83115bcec0840e0fd8d399b83b02e
- frontend: https://www.lumina-stage.com
- backend: https://api.lumina-stage.com
- No signed URL, direct upload URL, token, cookie, password, env value, or S3 credential was recorded.

tested_flows:
- PASS: `/health` responds 200 and reports commit `3daacf73b627a5dc90f24a70c3c51b2349452a5e`.
- FAIL: under 1MB image pipeline. `upload-intent` returned 201 and S3 PUT returned 200, but `confirm-upload` returned 400.
- FAIL: near 14MB image pipeline. `upload-intent` returned 201 and S3 PUT returned 200, but `confirm-upload` returned 400.
- PASS: over 20MB frontend block remains active; the browser UI showed a 20MB limit message after file selection.
- PASS: over 20MB API block remains active; `upload-intent` returned 413.

failure_details:
- under 1MB image:
  - error/code: `FEED_IMAGE_DERIVATIVE_FAILED`
  - details.stage: `read-source-metadata`
  - details.requestId: `0fdcd2e2-b1df-4e41-89ca-b5d2e0730bb6`
  - details.reason: `Cannot read properties of undefined (reading 'versions')`
- near 14MB image:
  - error/code: `FEED_IMAGE_DERIVATIVE_FAILED`
  - details.stage: `read-source-metadata`
  - details.requestId: `efd39aec-a5c5-4a12-ba6c-4154775d9a81`
  - details.reason: `Cannot read properties of undefined (reading 'versions')`

observed_20mb_api_block:
- error/code: `PAYLOAD_TOO_LARGE`
- details.stage: null
- details.requestId: null
- details.reason: null

repro_steps:
1. Run `git pull origin main`.
2. Open `https://api.lumina-stage.com/health`.
3. Confirm commit `3daacf73b627a5dc90f24a70c3c51b2349452a5e`.
4. Sign in with a regular QA user.
5. For an under 1MB JPEG, call `POST /api/v1/me/assets/upload-intents`.
6. Observe 201.
7. PUT the same image to the returned upload target without recording the target URL.
8. Observe S3 PUT 200.
9. Call `POST /api/v1/me/assets/:assetId/confirm-upload`.
10. Observe 400 with the sanitized diagnostic fields above.
11. Repeat steps 5-10 with a near 14MB JPEG.
12. In the browser feed composer, select an over 20MB image file.
13. Observe the frontend blocks it and shows a 20MB limit message.
14. Call `POST /api/v1/me/assets/upload-intents` with the over 20MB file metadata.
15. Observe 413 with `PAYLOAD_TOO_LARGE`.

blockers:
- P0 backend: valid feed image uploads still cannot complete because derivative generation fails during `confirm-upload`.
- Diagnostic signal now points to `read-source-metadata` and `sharp.versions` access: `Cannot read properties of undefined (reading 'versions')`.

notes:
- The near 14MB corrected test file size was 14,576,926 bytes.
- The under 1MB test file size was 422,924 bytes.
- The over 20MB test file size was 22,020,608 bytes.
- No production Lumina balance changes were performed.
- Direct upload targets and signed delivery URLs were intentionally not logged or written.

suspected_owner: backend

next_needed:
- Fix the `sharp.versions` diagnostic path or sharp import/runtime shape used by feed image derivative metadata.
- Re-run under 1MB and near 14MB image `confirm-upload`.

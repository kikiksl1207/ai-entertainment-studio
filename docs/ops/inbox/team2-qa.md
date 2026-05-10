# Team2 QA Inbox

status: fail
task: QA2-001 - feed image upload pipeline final recheck
environment:
- branch: team2-qa/feed-image-pipeline-final-recheck
- local main after pull: origin/main
- expected deployed commit from request: 1d60b9d1458da139884ac9ff46ee085d2efe11a4
- /health actual commit: 174854a3186d9f599780645da4b007229e3ebe5a
- frontend: https://www.lumina-stage.com
- backend: https://api.lumina-stage.com
- No passwords, tokens, cookies, signed URL full values, direct upload target URLs, or env values were recorded.

tested_flows:
- FAIL: `/health` responds, but reports commit `174854a3186d9f599780645da4b007229e3ebe5a` instead of requested commit `1d60b9d1458da139884ac9ff46ee085d2efe11a4`.
- PASS: `/api/v1/app/bootstrap` returns `userImageUpload.maxBytes = 20971520` and `userImageUpload.maxMegabytes = 20`.
- FAIL: 1MB 이하 image pipeline. `upload-intent` returned 201 and S3 PUT returned 200, but `confirm-upload` failed.
- FAIL: 14MB near image pipeline. `upload-intent` returned 201 and S3 PUT returned 200, but `confirm-upload` failed.
- PASS: 20MB 초과 image is blocked before upload completion with a clear UI message: `이미지가 너무 큽니다. 20MB 이하 이미지를 올려주세요.`
- PASS: 20MB 초과 API attempt is rejected at `upload-intent` with 413.
- FAIL: Feed post creation could not be completed for 1MB 이하 or 14MB image cases because `confirm-upload` failed before post submission.
- FAIL: Feed card image display for newly uploaded images could not be verified because no image post was created.
- FAIL: Image click lightbox for newly uploaded images could not be verified because no image post was created.
- FAIL: Feed API display/thumbnail variant URL for newly uploaded images could not be verified because no image post was created.

failures:
- 1MB 이하 image: stage `confirm-upload`, requestId `18457c9c-cf5c-4182-be2f-b22923fea481`, sanitized reason `FEED_IMAGE_DERIVATIVE_FAILED`.
- 14MB near image: stage `confirm-upload`, requestId `8b73b903-21b1-4aa0-bf5e-e111a8dea36a`, sanitized reason `FEED_IMAGE_DERIVATIVE_FAILED`.
- 20MB 초과 image: stage `upload-intent`, requestId `8e416d36-f49c-405d-9d06-5dc3530c3678`, sanitized reason `PAYLOAD_TOO_LARGE`.

blockers:
- P0 backend: `confirm-upload` fails after successful upload-intent and S3 PUT for valid feed images, so users cannot complete image feed post creation.
- P1 deployment verification: `/health` actual commit does not match the requested deployed commit for this recheck.

repro_steps:
1. Run `git pull origin main`.
2. Open `https://api.lumina-stage.com/health`.
3. Observe `/health` actual commit `174854a3186d9f599780645da4b007229e3ebe5a`, not requested commit `1d60b9d1458da139884ac9ff46ee085d2efe11a4`.
4. Log in to `https://www.lumina-stage.com/login.html` with the prepared regular QA user.
5. Request `https://api.lumina-stage.com/api/v1/app/bootstrap`.
6. Confirm `userImageUpload.maxBytes` is `20971520` and `userImageUpload.maxMegabytes` is `20`.
7. Open `https://www.lumina-stage.com/lumina-feed.html`.
8. Select a 1MB 이하 image and start feed image upload.
9. Observe `upload-intent` returns 201.
10. Observe S3 PUT returns 200.
11. Observe `confirm-upload` returns 400 with sanitized reason `FEED_IMAGE_DERIVATIVE_FAILED`.
12. Repeat steps 8-11 with a 14MB near image.
13. Select a 20MB 초과 image in the browser UI.
14. Observe the UI blocks the upload with the clear 20MB limit message.
15. Attempt the 20MB 초과 API path.
16. Observe `upload-intent` returns 413 with sanitized reason `PAYLOAD_TOO_LARGE`.

screenshots_or_notes:
- Signed URL full values were intentionally not logged or written.
- Direct upload target URLs were intentionally not logged or written.
- Passwords, tokens, cookies, and env values were intentionally not logged or written.
- No Lumina balance or other production data changes were performed.

suspected_owner: backend

next_needed:
- Confirm why stage `/health` is not reporting the requested commit.
- Fix derivative generation during `confirm-upload`.
- Re-run feed post creation, card image display, lightbox, and display/thumbnail variant URL checks after `confirm-upload` succeeds.

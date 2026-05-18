# Team2 Backend Inbox

status: ready_for_review
task: Team2 Backend / Lumina Feed post edit-delete author-only contract
base: origin/main 11806cd
branch/commit: team2-backend/lumina-feed-edit-delete-contract / final hash in completion report
changed_files:
- server/src/community/community.service.ts
- server/src/community/community.service.spec.ts
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd ci
- npm.cmd run prisma:generate
- npm.cmd test -- community.service.spec.ts --runInBand
- npm.cmd run lint -- --quiet src/community/community.service.ts src/community/community.service.spec.ts
- npm.cmd run build
- git diff --check
contract_result:
- PATCH /lumina-feed/posts/:postId and DELETE /lumina-feed/posts/:postId remain login-required through JwtAuthGuard.
- Update/delete authorization is now author-only. Artist operator access no longer falls through for non-author feed edit/delete.
- Update keeps post id and authorUserId unchanged and only writes the body edit metadata scope.
- Delete remains a soft delete and repeated delete by the same author returns the same safe success shape without a second mutation.
- Non-author access returns 403 while deleted/non-visible post access can safely resolve as 404.
- Feed list and reply/detail visibility paths keep status=published and deletedAt=null projection filters.
- Invalid id, missing post, empty body, and >500 character body validation are covered by service specs.
blocked_by:
- Live UI/API connection QA still needs deployed endpoint smoke.
- Notion MCP client failed in this thread, so Notion status could not be updated from here.
sensitive_values:
- none recorded.
next_needed:
- Reviewer/QA should run API smoke for owner edit/delete, non-owner denial, and repeated delete after deploy.

---

status: ready_for_deploy
task: Team2 Backend / Preserve Metadata Diagnostic Error
branch/commit: pending commit
changed_files:
- server/src/assets/user-assets.service.ts
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd run lint
- npm.cmd run build
result:
- Rechecked the P0 confirm-upload failure after `/health` commit `4c2dee7de0086321b05dfd56b80b27cb58a68dc3`.
- Confirmed code intent: `readSourceMetadata()` throws `FEED_IMAGE_SOURCE_METADATA_FAILED` with source diagnostics, Sharp/libvips diagnostics, and sanitized reason.
- Root cause for losing that diagnostic: `runDerivativeStage()` only preserved `error instanceof BadRequestException`. In production/runtime module-boundary cases, that check can fail and wrap the original safe diagnostic as generic `FEED_IMAGE_DERIVATIVE_FAILED`.
- Patched `runDerivativeStage()`, `safeErrorMessage()`, and `safeErrorDetails()` to preserve any `HttpException`, plus duck-typed objects with `getStatus()` and `getResponse()`.
- Expected after deploy: read-source-metadata failures preserve response code `FEED_IMAGE_SOURCE_METADATA_FAILED` and include `details.source`, `details.sharp`, and sanitized `details.reason`.
- No signed URL, object URL, token, cookie, password, or env values were recorded.
blocked_by:
- Live verification requires deployment and rerunning the same PNG confirm-upload flow.
next_needed:
- Deploy this commit and confirm the failing PNG now returns `FEED_IMAGE_SOURCE_METADATA_FAILED` if Sharp metadata read still fails.
- Use the preserved diagnostics to decide between signed GET/body mismatch and Render Sharp/libvips runtime issue.

---

status: ready_for_deploy
task: Team2 Backend / Feed Image Metadata Failure Still Repro
branch/commit: pending commit
changed_files:
- server/src/assets/user-assets.controller.ts
- server/src/assets/user-assets.service.ts
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd run lint
- npm.cmd run build
- local Node sharp metadata probe with 1x1 PNG buffer and `failOn: none`
result:
- Render logs for requestId `be5ee0d9-3215-49a9-b2f9-201941bde4b3` could not be fetched from this workspace: no Render CLI/log cache is available locally, and no token/env values were read.
- The existing derivative logs did not include requestId, so Render-side filtering by requestId would not reliably correlate the source diagnostics with the failed confirm-upload request.
- Patched confirm-upload to pass `x-request-id` into derivative logging.
- Patched `read-source-metadata` failures to return/log `FEED_IMAGE_SOURCE_METADATA_FAILED` with safe source diagnostics and Sharp/libvips codec versions.
- Safe source diagnostics include only content type, content length, downloaded body length, detected magic-byte MIME, and first 16 bytes as hex. No storage keys, object URLs, signed URLs, tokens, cookies, passwords, or env values are recorded.
- If the downloaded buffer is a valid PNG by magic bytes but Render Sharp still fails metadata read, the next response/log will show `source.detectedMimeType=image/png`, PNG prefix hex, and Render Sharp/libvips/png versions for runtime diagnosis.
- Local Node can load Sharp and read a 1x1 PNG buffer with `failOn: none`.
blocked_by:
- RequestId-specific Render log verification requires Render log access outside this workspace.
next_needed:
- Deploy this commit and rerun the same PNG confirm-upload flow with a client-provided `x-request-id`.
- If it fails, inspect the safe error details/logs for `source.detectedMimeType`, `source.prefixHex`, body length, and `sharp` diagnostics.
- If `source.detectedMimeType` is `image/png` and prefix starts with PNG magic bytes but metadata still fails, treat it as Render Sharp/libvips runtime or unsupported PNG variant; otherwise treat it as signed GET/body mismatch.

---

status: ready_for_deploy
task: Team2 Backend / Feed Image Derivative Metadata Failure
branch/commit: pending commit
changed_files:
- server/src/assets/user-assets.service.ts
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd run lint
- npm.cmd run build
- local Node sharp metadata probe with a 1x1 PNG buffer
result:
- Follow-up deployment changed confirm-upload from 500 to safe 400, but QA still sees `FEED_IMAGE_DERIVATIVE_FAILED` at `read-source-metadata`.
- Code-level likely cause is that the S3 signed GET can return HTTP 200 with a non-image body, empty body, or unexpected error/document body; the previous code only checked `response.ok` before passing bytes to Sharp.
- Patched source download to record safe diagnostics only: response content type, content length, downloaded body length, detected image MIME from magic bytes, and first 16 bytes as hex.
- Added magic-byte validation for JPEG, PNG, WebP, and GIF before Sharp metadata read. Non-image bytes now fail at `download-source` with `FEED_IMAGE_SOURCE_NOT_IMAGE` instead of surfacing later as a generic Sharp metadata failure.
- Added a safe success log for source download diagnostics without storage keys, object URLs, signed URLs, tokens, cookies, passwords, or env values.
- Local Node runtime can load Sharp and read a 1x1 PNG buffer successfully. Render runtime still needs deploy-time confirmation from the new diagnostics.
blocked_by:
- Live root cause confirmation requires deploying this patch and rerunning the 1MB PNG confirm-upload flow.
next_needed:
- Deploy this commit and rerun the 1MB PNG reproduction.
- If confirm-upload still fails, use the safe response/log diagnostics to determine whether the body is XML/HTML/empty/non-image or whether Sharp fails despite valid PNG magic bytes.
- After 1MB PASS, rerun the 14MB image upload-intent, S3 PUT, confirm-upload, display URL, thumbnail URL, Feed card, and lightbox checks.

---

status: ready_for_deploy
task: Team2 Backend / Feed Image Pipeline Confirm Upload 500
branch/commit: pending commit
changed_files:
- server/src/assets/user-assets.service.ts
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd run lint
- npm.cmd run build
result:
- Rechecked the confirm-upload derivative path after Render applied the 20MB upload policy.
- Code root cause for the 500 class: derivative processing had unhandled failure paths around source metadata reads, Sharp transforms, and derivative uploads. Those could escape Nest's intended 4xx diagnostics as an internal error.
- Patched derivative processing with stage-scoped safe handling for source-key resolution, source download, source metadata read, display build, thumbnail build, and derivative upload.
- Added safe server logs for derivative failure stage, asset id, and sanitized reason only. Signed URLs, object URLs, tokens, cookies, passwords, and env values are not logged.
- Source download failures now return `FEED_IMAGE_SOURCE_READ_FAILED` with provider/status diagnostics only.
- Derivative upload failures now return `FEED_IMAGE_DERIVATIVE_UPLOAD_FAILED` with provider/status/mime diagnostics only.
- Unexpected Sharp/processing failures now return `FEED_IMAGE_DERIVATIVE_FAILED` with the failed stage instead of leaking as a generic 500.
- Display/thumbnail generation still prefers WebP, but now falls back to JPEG if WebP encoding fails in the runtime. This keeps the policy aligned with WebP/JPEG delivery and gives Render/libvips codec issues a recovery path.
blocked_by:
- Live PASS for 1MB and 14MB upload-intent -> S3 PUT -> confirm-upload requires deploying this patch.
next_needed:
- Deploy this commit and rerun the 1MB confirm-upload reproduction. Expected result is PASS, or a safe 4xx with a stage code if storage/runtime still blocks derivatives.
- Rerun the 14MB image upload flow and confirm display/thumbnail derivative objects are created.
- Recheck Feed card image, lightbox, display URL, and thumbnail URL after deploy.

---

status: ready_for_deploy
task: Team2 Backend / Media Upload Policy: feed image derivatives and 20MB limit
branch/commit: pending commit
changed_files:
- server/package.json
- server/package-lock.json
- server/src/assets/user-assets.controller.ts
- server/src/assets/user-assets.service.ts
- server/src/community/community.service.ts
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd run lint
- npm.cmd run build
policy:
- Lumina Feed image upload is image-only and remains separate from Shortform/Video asset handling.
- Accepted feed image MIME types remain `image/jpeg`, `image/png`, `image/webp`, and `image/gif`.
- Feed image upload max is 20MB. Server default is 20MB and `MAX_IMAGE_UPLOAD_BYTES` can override it for deployment. Oversized uploads return `PAYLOAD_TOO_LARGE` with `fileSizeBytes`, `maxBytes`, and `maxMegabytes` details.
- The server validates declared upload size at upload-intent time and validates actual uploaded object size from object-storage HEAD at confirm-upload time, so UI bypass with an oversized PUT is blocked before derivative processing.
- Original feed image preservation is explicit policy metadata: `originalPreserved: true` for v1. Delivery should prefer processed display/thumbnail derivatives; original remains available as a separate variant.
- Display derivative policy: WebP output, auto-rotate, no enlargement, long edge <= 2048px.
- Thumbnail derivative policy: WebP output, auto-rotate, no enlargement, long edge <= 768px.
- Video upload is out of feed image scope and should stay on a separate Shortform/Video asset pipeline. Lumina v1 recommendation is 512MB max for video, despite larger platform limits elsewhere.
result:
- Added `sharp` to the server so confirm-upload can generate feed image derivatives after the original object is present.
- Confirm-upload now reads the uploaded source object from S3/R2-compatible storage, creates display and thumbnail WebP objects under a derivative key path, uploads those derivative objects, and records non-secret derivative metadata on the asset row.
- Added public delivery variants: `/api/v1/assets/public/:assetId/original`, `/display`, and `/thumbnail`. Variant delivery still validates the asset is public, image type, not pending upload, and not archived before issuing a signed-read redirect.
- Feed API assets now return `url` as the display variant and also include `displayUrl` and `thumbnailUrl`, using absolute API-origin delivery URLs instead of raw object-storage URLs.
- Existing assets without derivative metadata fall back to original delivery, so old feed rows remain renderable while new uploads use optimized derivatives.
- No secret/token/password/env values or full signed URLs were recorded.
blocked_by:
- Live acceptance still requires deploy plus QA upload of a ~14MB image and browser verification that feed card and lightbox load through the API-origin variant URLs.
next_needed:
- Set/confirm the deployment upload-size env setting for the 20MB policy without recording secret values.
- Deploy this branch and verify upload-intent -> S3 PUT -> confirm-upload creates original, display, and thumbnail objects.
- Verify `/api/v1/assets/public/:assetId/display` and `/thumbnail` return 302 to signed read targets that resolve HTTP 200.
- Team2 QA should recheck `lumina-feed.html` card image and lightbox after deploy.

---

status: done
task: Storage/backend ops: signed asset delivery recheck
branch/commit: pending commit
changed_files:
- server/src/assets/user-assets.controller.ts
- server/src/assets/user-assets.module.ts
- server/src/assets/user-assets.service.ts
- server/src/community/community.service.ts
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd run lint
- npm.cmd run build
result:
- Rechecked the deployed signed delivery behavior reported by QA. Feed API was returning relative asset URLs (`/api/v1/assets/public/:assetId`), causing `lumina-feed.html` on the frontend origin to request the frontend host and receive 404.
- Patched `CommunityService.publicFeedAssetUrl()` so feed asset `url` and `thumbnailUrl` fall back to absolute API origin `https://api.lumina-stage.com` when no API public base env is configured. This keeps browser image requests on the backend API origin.
- Rechecked the API-origin 302 without recording the signed token. The deployed endpoint was redirecting to a raw S3 object URL without a signature, then S3 returned 403.
- Root cause from code path: existing uploaded asset rows can have a non-`s3/r2` `storageProvider`, so `getPublicAssetDeliveryUrl()` fell back to `buildPublicAssetUrl()` instead of generating a signed read URL.
- Patched `UserAssetsService.getPublicAssetDeliveryUrl()` to use the row provider when it is `s3/r2`, otherwise fall back to the currently configured object storage provider when that provider is `s3/r2`. This covers older user-image rows while keeping public-read closed.
- The public asset endpoint still validates `visibility=public`, image type, not pending upload, and not archived before redirecting.
- Signed URL/token/cookie/secret values were not recorded.
blocked_by:
- Live verification of `lumina-feed.html` card image and lightbox requires deploying this follow-up backend change.
- Direct provider-side checks for bucket policy, object ACL, Block Public Access, and CORS require AWS/S3 console or equivalent credentials.
next_needed:
- Deploy this backend change and verify Feed API returns absolute `https://api.lumina-stage.com/api/v1/assets/public/:assetId` URLs.
- Verify `/api/v1/assets/public/:assetId` returns 302 to a signed read target and following the redirect returns HTTP 200.
- Team2 QA should recheck Lumina Feed card image and lightbox image after deploy.
- Ops should still decide long-term delivery mode: public CDN/read policy for public assets, or keep signed read redirect/proxy as the official delivery path.

---

status: done
task: Storage/backend ops: signed read target 403 follow-up
branch/commit: pending commit
changed_files:
- server/src/assets/user-assets.service.ts
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd run lint
- npm.cmd run build
result:
- Rechecked the deployed signed redirect without recording signed query values. The API public asset endpoint returns 302, but the signed target returns 403 with an S3 `AccessDenied` response that mentions missing `s3:ListBucket`.
- That S3 response can happen when the signed request is valid but the object key does not resolve and the IAM user is not allowed to reveal object absence via bucket listing.
- Added public delivery key resolution for object storage assets. Before returning a signed GET redirect, the server now probes signed HEAD candidates for the stored key plus `OBJECT_STORAGE_KEY_PREFIX` added/removed variants, then signs the first readable key.
- Kept public read closed and did not record signed URL/token/cookie/secret values.
- Fixed signed read URL TTL handling to honor `OBJECT_PUBLIC_READ_URL_TTL_SECONDS` instead of a hardcoded 60 seconds.
blocked_by:
- Live verification requires deploying this backend change.
next_needed:
- Deploy this backend change and verify `/api/v1/assets/public/:assetId` 302 redirect target returns HTTP 200.
- Team2 QA should recheck Lumina Feed card image, lightbox image, and fallback state after deploy.

---

status: blocked
task: Storage/backend ops: signed target 403 after 467f4dc
branch/commit: main deploy `467f4dc`, live `/health` reported `37735de718f0e6605248fb7903f636d33ae6ae75`
changed_files:
- docs/ops/inbox/team2-backend.md
tests:
- not run; documentation/ops triage only
result:
- QA confirmed the public asset endpoint returns 302 and the signed target host/path points at the expected S3 bucket/key shape.
- Signed target still returns 403 `AccessDenied`, with an S3 message that the IAM user is not authorized to perform `s3:ListBucket`.
- This is not the same failure mode as a malformed signature. A bad SigV4 URL would normally produce a signature/authorization mismatch error. The current message is consistent with S3 being unable to reveal whether the object key exists because the principal lacks bucket listing permission.
- Most likely current root cause: the DB `storageKey` and all server fallback key candidates do not match an existing object key in the bucket. Without `s3:ListBucket`, S3 returns 403 instead of a clear not-found signal for missing keys.
- Secondary thing to confirm: the IAM principal used by the backend has `s3:GetObject` for the relevant object prefix. If object exists and `GetObject` is missing, signed reads will also fail, but the reported `ListBucket` action points first at key-existence/list diagnostics.
- Existing feed asset rows may be pointing at objects that were never uploaded, were uploaded under a different key/prefix, or were deleted/moved after the DB row was marked uploaded.
- Public read remains closed; no secret/token/password/env values or full signed URLs were recorded.
blocked_by:
- Bucket contents, object ACLs, IAM policy, Block Public Access, and CORS require S3/provider console or CLI access. They cannot be proven from the repo without credentials.
next_needed:
- In S3/provider console, check whether the exact object key for the failing feed asset exists in the bucket.
- Compare the DB `assets.storageKey` value with the actual object key. If the object is under a prefix variant, update either object location or DB rows consistently.
- Confirm the backend IAM principal has `s3:GetObject` on the user-image object prefix used by feed assets.
- For diagnostics, grant narrowly scoped `s3:ListBucket` only on the bucket with a prefix condition for the feed/user-image prefix, so missing-key cases return clear diagnostics instead of ambiguous 403. This can be temporary or kept as an ops-only diagnostic permission.
- If the object is missing, treat affected feed asset rows as broken uploads: re-upload the object, relink the feed asset to an existing object, or mark/archive the asset row so feed does not render a broken image.
- CORS is still worth checking for browser rendering, but it is not the first blocker while direct signed URL access returns 403.

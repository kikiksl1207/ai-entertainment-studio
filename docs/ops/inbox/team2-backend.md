# Team2 Backend Inbox

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

# Team2 Backend Inbox

status: done
task: Storage/backend ops: feed image object URL 403
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
- Confirmed the remaining blocker is object delivery, not feed API shape. Feed API returns image asset records and URLs, but direct unauthenticated access to the current S3 object URL returns HTTP 403 `AccessDenied`.
- Bucket public-read settings, object ACLs, Block Public Access, and CORS cannot be inspected from this workspace without provider console/credentials. No secrets, tokens, passwords, or env values were read or recorded.
- Code cause: `CommunityService.toPostView()` previously returned `buildPublicAssetUrl(...)`, which assumes the configured public asset base is anonymously readable. With the current S3/public-origin policy returning 403, cards and lightbox fail even though the database asset and feed response are present.
- Implemented backend fallback delivery for feed assets: feed asset `url` and `thumbnailUrl` now point to the API public asset endpoint instead of the raw S3 public object URL.
- Added unauthenticated `GET /api/v1/assets/public/:assetId`. It validates that the asset is public, image type, not pending upload, and not archived, then returns a 302 redirect.
- For `s3`/`r2` assets, the redirect target is a short-lived signed read URL generated server-side. This avoids opening bucket-wide public read while still allowing public feed images to render.
- For non-S3/R2 assets, the endpoint falls back to the existing public asset URL builder.
- No provider setting was changed. If ops prefers public-read/CDN delivery, the bucket/CDN policy can still be fixed instead; this patch provides a safer backend delivery path when public read must stay closed.
blocked_by:
- Live verification of `lumina-feed.html` card image and lightbox requires deploying this branch/server change.
- Direct provider-side checks for bucket policy, object ACL, Block Public Access, and CORS require AWS/S3 console or equivalent credentials.
next_needed:
- Deploy this backend change and verify a feed asset URL returned by the API resolves through `/api/v1/assets/public/:assetId` to HTTP 200.
- Team2 QA should recheck Lumina Feed card image and lightbox image after deploy.
- Ops should still decide long-term delivery mode: public CDN/read policy for public assets, or keep signed read redirect/proxy as the official delivery path.

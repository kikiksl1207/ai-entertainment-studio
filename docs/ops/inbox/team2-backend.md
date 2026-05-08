# Team2 Backend Inbox

status: done
task: QA follow-up: Render deploy commit and feed image 403
branch/commit: local branch includes main `1c5d995`; live `/health` reports `eb7d15e38ec349383da0915a002aa394c361eeeb`
changed_files:
- docs/ops/inbox/team2-backend.md
tests:
- not run; documentation/triage only, no server code changed
result:
- Confirmed `origin/main` points to `1c5d995d2ae8a66c5271fceb31177ef23ea343a7`.
- Confirmed both production health URLs return the same older commit:
  - `https://api.lumina-stage.com/health` -> `eb7d15e38ec349383da0915a002aa394c361eeeb`
  - `https://lumina-stage-api.onrender.com/health` -> `eb7d15e38ec349383da0915a002aa394c361eeeb`
- Code check: `server/src/health.controller.ts` returns `process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? null`. Because Render normally injects `RENDER_GIT_COMMIT` per deploy, the public evidence means the running Render web service is still on the deploy built from `eb7d15e`, not from latest `main`.
- I could not verify the Render dashboard/deploy log from this workspace. No `render.yaml` or GitHub workflow file was found locally, so deploy branch/auto-deploy settings appear dashboard-managed. Most likely causes to check in Render: auto-deploy disabled, service pinned to another branch/commit, latest deploy failed before becoming live, or a manual deploy has not been triggered after `1c5d995`.
- If Render says a deploy for `1c5d995` completed but `/health` still returns `eb7d15e`, the likely causes are: traffic is still routed to the previous live deploy, the wrong Render service/domain was redeployed, or Render's commit metadata still comes from the old deploy. Since `/health` reads Render commit metadata at runtime, this is not a frontend cache issue.
- Feed image API check: `GET https://api.lumina-stage.com/api/v1/lumina-feed?take=3` returns asset URLs such as `https://lumina-stage-assets-2.s3.ap-northeast-2.amazonaws.com/uploads/user-images/.../lumina-stage-logo.png`.
- Direct `GET/HEAD` to that object URL returns HTTP 403 with S3 XML `AccessDenied`.
- Code check: feed assets are converted in `CommunityService.toPostView()` with `buildPublicAssetUrl(this.configService, link.asset.storageKey)`.
- Code check: `buildPublicAssetUrl()` returns `OBJECT_STORAGE_PUBLIC_BASE_URL` or `ASSET_PUBLIC_BASE_URL` plus the raw `storageKey`; it does not generate signed read URLs.
- Therefore the current backend contract assumes objects exposed in public feed are readable through the configured public base URL. The observed 403 is most consistent with S3 bucket/object public read policy or CDN/public origin policy not allowing anonymous reads.
- This does not look like a malformed URL path issue: the URL host/path matches the configured public-base style, and S3 returns `AccessDenied` rather than a backend-generated bad URL response.
- This also does not look like the backend returning the upload signed PUT URL as a public URL; the feed returns a plain S3 object URL, not an `X-Amz-*` signed URL.
blocked_by:
- Render dashboard/deploy logs were not available here, so exact deploy failure reason must be confirmed in Render.
- Secrets/env values were not read or recorded.
next_needed:
- In Render, trigger/retry deploy of `main` at `1c5d995` and verify `/health` after it becomes live.
- In Render, verify the web service is connected to the intended GitHub repo and branch `main`, and that the custom domain and `onrender.com` fallback point to the same service.
- For feed images, either make the configured public asset origin anonymously readable for public assets, or change backend delivery design to return a public CDN URL/proxy/signed-read URL appropriate for public feed images.
- After storage policy/CDN change, verify a feed asset URL with unauthenticated `HEAD` returns 200 before closing the lightbox blocker.

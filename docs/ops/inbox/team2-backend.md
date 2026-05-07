# Team2 Backend Inbox

status: done
task: BE2-001 backend/API blocker triage
branch/commit: team2-backend/BE2-001-wallet-safety / pushed branch HEAD
changed_files:
- server/src/wallet/wallet.service.ts
- docs/ops/inbox/team2-backend.md
tests:
- npm.cmd run lint
- npm.cmd run build
result:
- Pulled origin/main; repository was already up to date.
- QA inbox currently has no concrete blocker details beyond the task template pointer, so triage focused on BE2 scope: Creator Studio access, object storage/upload intent, and wallet safety.
- Creator Studio access check currently enables `/api/v1/me/creator-studio` for active artist operators, approved debut applications pending operator linkage, or active admin access. This matches the diagnostics/policy surfaced by Backstage and does not require backend change without a specific failing user/email.
- Object storage diagnostics and user upload-intent flow are present. Diagnostics returns missing env flags without exposing secrets. User upload intent signs PUT for r2/s3 and confirm-upload verifies object existence by signed HEAD. No backend blocker found from code inspection without live env details.
- Fixed wallet safety blocker: `/api/v1/wallet/test-grant` previously allowed any authenticated user to credit their wallet. It now returns 403 unless `ENABLE_LOCAL_WALLET_TEST_GRANT=true`, and remains disabled in `NODE_ENV=production`.
blocked_by:
- No reproducible Team2 QA blocker details are recorded in docs/ops/inbox/team2-qa.md yet.
- Production object storage/env state was not inspected by design; secrets, Render settings, and production DB were not touched.
next_needed:
- QA should add exact endpoint, account/email, request body, response status/body, and timestamp for any remaining Creator Studio or upload blocker.
- Reviewer should verify whether the route should remain in the deployable controller at all, but the default path is now closed unless an explicit local test flag is enabled.

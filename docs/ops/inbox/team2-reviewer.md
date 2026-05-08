# Team2 Reviewer Inbox

status: reviewed
task: Team2 QA/Backend/Frontend pushed result review
branch/commit: team2-frontend/feed-403-fallback @ 47cec0633ffebe31cb06b05f354d7d7efae2c159
branches_reviewed:
- QA: origin/team2-qa/reverify-main-1c5d995 @ af5f04eee44969aa3346ed193fe38592daa45e1e
- Backend triage: origin/team2-qa/QA2-001-live-product-smoke-qa @ ebb9cae34ce2dbbc3ae513a47583dd32c5f4c796
- Frontend: origin/team2-frontend/feed-403-fallback @ 47cec0633ffebe31cb06b05f354d7d7efae2c159

Findings:

P0:
- QA P0 findings are valid. `af5f04e:docs/ops/inbox/team2-qa.md` reports the live API `/health` commit as `eb7d15e38ec349383da0915a002aa394c361eeeb`, not expected `1c5d995`, on both `api.lumina-stage.com` and the Render URL. That means latest-main deploy verification failed.
- QA P0 feed image blocker is valid. The same QA report states public feed image asset URLs are returned by the API, but direct `HEAD` to the S3 object URLs returns HTTP 403 and browser images have `naturalWidth=0` / `naturalHeight=0`. This is a real product blocker, not just visual polish.

P1:
- Backend triage correctly separates the Render deploy mismatch from the object storage 403. `ebb9cae:docs/ops/inbox/team2-backend.md` explains `/health` reads `RENDER_GIT_COMMIT` / `GIT_COMMIT`, so the mismatch points to Render deploy/routing/branch state, not frontend cache. It separately traces feed assets through `CommunityService.toPostView()` and `buildPublicAssetUrl()`, concluding the 403 is public-read/CDN/origin policy or delivery-design related.
- Backend/storage remains blocked operationally. The triage is documentation-only and says Render dashboard/deploy logs were unavailable, and that S3/Object Storage must either expose public feed assets anonymously or return a proper CDN/proxy/signed-read URL. This cannot be closed by merging code/docs alone.
- Authenticated QA remains incomplete. QA could verify public logged-out mobile feed at 320/390/768px, but edit/delete, Backstage wallet adjustment modal, Creator Studio authorized flows, and authenticated mobile bottom menus remain blocked without safe normal/creator/operator accounts.

P2:
- Frontend did not force a 403 workaround. The `c549325` parent of `47cec06` adds a lightbox image `error` handler and `.lightbox-error` UI only; it does not rewrite storage URLs, add a proxy, ignore 403, or synthesize readable asset URLs.
- Frontend scope is acceptably narrow. `47cec06` changes modal layering z-index in `backstage.css` and `creator-studio.html`, converts wallet adjustment example text from prefilled values to placeholders in `backstage.js`, and updates frontend inbox notes. The branch diff versus `origin/main` is limited to `app.js`, `styles.css`, `backstage.css`, `backstage.js`, `creator-studio.html`, and the frontend inbox, all within fallback UI/modal layering/placeholder scope.
- No secrets/tokens/passwords/env values were recorded. Grep over the three reviewed inbox files found only statements that secrets/env values were not read or recorded and generic environment wording; no raw secret, token, password, cookie, or env value was present.

tests:
- `git fetch origin`
- Verified reviewed commit hashes with `git rev-parse`.
- Inspected `git show --stat` and diffs for `af5f04e`, `ebb9cae`, `47cec06`, and `c549325`.
- `node --check app.js` passed on the current `team2-frontend/feed-403-fallback` checkout.
- `node --check backstage.js` passed on the current `team2-frontend/feed-403-fallback` checkout.
- `git diff --check` passed; only the existing CRLF warning for this reviewer file was printed.

Merge decision: PARTIAL
- Merge YES: QA documentation branch `origin/team2-qa/reverify-main-1c5d995 @ af5f04eee44969aa3346ed193fe38592daa45e1e`.
- Merge YES: Backend triage documentation commit `origin/team2-qa/QA2-001-live-product-smoke-qa @ ebb9cae34ce2dbbc3ae513a47583dd32c5f4c796`.
- Merge YES: Frontend fallback branch `origin/team2-frontend/feed-403-fallback @ 47cec0633ffebe31cb06b05f354d7d7efae2c159`.
- Merge NO / Blocked as done: Backend deploy/storage issue itself. Render deploy mismatch and S3/Object Storage 403 require external Render/S3/CDN configuration or delivery-contract changes before the P0 can be closed.

additional_checks_needed:
- In Render dashboard: confirm the API service is connected to the intended GitHub repo and branch `main`; check whether auto-deploy is disabled, pinned to another branch/commit, failed on `1c5d995`, or traffic is still routed to the previous deploy.
- In Render dashboard: trigger or retry deploy of `main @ 1c5d995` or newer, then verify both `https://api.lumina-stage.com/health` and `https://lumina-stage-api.onrender.com/health` report the expected commit.
- In S3/Object Storage/CDN: confirm public feed asset objects under the configured public base URL allow anonymous read, or switch backend delivery to a public CDN/proxy/signed-read URL design appropriate for public feed images.
- After storage fix: unauthenticated `HEAD` on a feed asset URL should return 200, then re-test card image display and lightbox original image display.
- Provide safe QA identities for normal user, authorized creator, and Backstage operator to finish edit/delete, Creator Studio, Backstage mobile menu, and wallet adjustment modal checks.

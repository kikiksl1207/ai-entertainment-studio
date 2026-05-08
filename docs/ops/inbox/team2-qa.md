# Team2 QA Inbox

status: fail
task: QA2-001 - Live Product Smoke QA recheck after main 1c5d995 deploy
environment:
- repo: C:\Users\하마다랩스\Documents\New project\workspace-core-qa2-main
- branch: team2-qa/reverify-main-1c5d995
- local main target: origin/main @ 1c5d995d2ae8a66c5271fceb31177ef23ea343a7
- frontend: https://www.lumina-stage.com
- backend: https://api.lumina-stage.com
- note: initial `git pull origin main` in the original workspace was blocked by pre-existing local changes, so QA ran from a clean worktree created at origin/main 1c5d995.

tested_flows:
- FAIL: Render/API deployed commit check.
- FAIL: Feed image display and lightbox image display.
- PASS with blocker caveat: Feed image asset click opens a lightbox shell.
- PASS with blocker caveat: Context menu is prevented on the feed image asset container and on the lightbox image element, but the image itself is broken.
- PASS: Public/logged-out feed at 320px, 390px, and 768px has no horizontal page overflow and feed cards stay single-column; tablet 3-column compression was not observed.
- BLOCKED: Feed edit/delete overlap for the current user's own posts was not testable without a safe QA login.
- BLOCKED: Backstage user management and Lumina manual adjustment modal were not testable with real operator access because no safe Backstage account was provided.
- BLOCKED: Creator Studio and Backstage authenticated mobile bottom menu behavior was not testable because no authorized creator/operator account was provided.

blockers:
- P0: `/health` on both `https://api.lumina-stage.com` and `https://lumina-stage-api.onrender.com` reports commit `eb7d15e38ec349383da0915a002aa394c361eeeb`, not expected commit `1c5d995`.
- P0: Public feed image posts render broken images. The feed API returns image asset URLs, but direct HEAD requests to the S3 object URLs return 403, and the browser reports the image elements as `naturalWidth=0`, `naturalHeight=0`.
- P1: The lightbox opens from the broken feed asset, but the lightbox image is also 0x0 because the underlying object URL is forbidden.
- P1: Backstage/Creator Studio authenticated checks remain blocked without safe QA identities. Invalid/fake Backstage auth is rejected with a session-expired login gate, so the Lumina adjustment modal cannot be verified as a real operator.

repro_steps:
1. Open `https://api.lumina-stage.com/health`.
2. Observe `commit` is `eb7d15e38ec349383da0915a002aa394c361eeeb`, not `1c5d995`.
3. Open `https://www.lumina-stage.com/lumina-feed.html`.
4. Observe four public feed cards; two image-only cards have large empty image areas.
5. Inspect the image elements in those cards: the asset items have class `is-broken`, and image natural size is 0x0.
6. Directly request the two public feed image object URLs returned by the API; both return HTTP 403.
7. Click the broken feed asset area; a lightbox shell opens.
8. Inspect the lightbox image; it uses the same forbidden object URL and remains 0x0.
9. Dispatch `contextmenu` on the feed asset and lightbox image; both events are prevented, but this does not prove a usable image-save block because the image is not visible/loadable.
10. Resize the feed page to 320px, 390px, and 768px; no horizontal page overflow was observed, and feed cards remained one column.
11. Open `https://www.lumina-stage.com/backstage.html` and `https://www.lumina-stage.com/creator-studio.html` at 320px/390px without credentials; both stay on access/login gates, so authenticated bottom-menu and wallet-modal flows cannot be completed.

screenshots_or_notes:
- No secrets, tokens, passwords, or cookies were recorded.
- No Lumina adjustment was executed.
- No production data was intentionally modified.
- Frontend file hash comparison: live `app.js` matched local 1c5d995; live `backstage.js` and `creator-studio.html` matched local content when ignoring line endings.
- GitHub Pages README URL `https://kikiksl1207.github.io/ai-entertainment-studio/` returned 404; QA used the documented operations frontend domain `https://www.lumina-stage.com`.

suspected_owner: backend

next_needed:
- Deploy backend/API commit 1c5d995 or confirm why Render health is expected to report `eb7d15e`.
- Fix object storage public read/CDN policy for feed image assets, or make the frontend use signed/public URLs that load in the browser.
- Provide safe QA accounts for normal user, authorized creator, and Backstage operator so edit/delete, Creator Studio mobile menu, Backstage mobile menu, and Lumina manual adjustment validation can be verified without guessing credentials.

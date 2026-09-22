# Owner-Private Graph Player #1900

## Source Checkpoint

Base: `674cce9f74ed477eb65d9ce3bd4c3e6c1c6a8b9e`.
Branch: `codex/cloud-1900-ott-player-20260922`.
Worktree: `E:/CodexMovedCache/worktrees/cloud-1900-ott-player-20260922`.

Original `f21d5c8de8d144b3fc7c97d7089e8a8e2f7eb50d` author validation:
50/50 first executions PASS. A subsequent independent source finding and its
pending correction are recorded below; the original results are not results
for that correction. Independent acceptance is still pending. No tests or browser ran during the source-only
phase; execution began only after PM's explicit exclusive-slot grant. The
existing reader/visual candidate is unchanged.

## Scope

- `/ott-private-preview?manifestId=<uuid>` explicitly checks that immutable
  graph, pins the selected locale, and starts/resumes server progress.
- `/ott-private-preview?previewId=<uuid>` resumes that exact owner-private pin
  and its locale. Changing language explicitly pins the same manifest in the
  new locale. It never searches for or substitutes the newest graph.
- Exactly one `fileId`, `manifestId`, or `previewId` identity is allowed. The
  existing single-file `fileId` controller remains intact except for graph
  dispatch. No studio discovery or graph authoring editor is added.
- Native video uses authenticated POST to the returned file's existing
  playback-session path, then the strict cookie-based private delivery path.
  No bearer, token, storage key, or signed query string becomes a media URL.
- Source-file millisecond positions seek to the server clip and stop at its
  end. Up to three authored choices send only the server-defined choice key.
  Different branch files and explicit rejoin are resolved by the server.
- Completion is displayed only from acknowledged server `completed` status
  and its authored ending label. Replaying the current ending scene saves its
  clip start; it does not fabricate a graph restart/reset API.
- Confirmed source-relative subtitle cues become local VTT tracks. Absent or
  invalid tracks stay absent. No translated text or substitute film is invented.

## Concurrency And Lifecycle

One save/choice command is in flight at a time. Pause/seek saves coalesce;
ordinary time updates do not periodically write. Clip-end and visibility/close
saves are bounded. Close saves are best effort, not guaranteed delivery.

Unknown commands retain their original body and idempotency key. Minimal
receipt intent is retained in session storage, scoped by authenticated user ID
and preview ID; credentials and full progress snapshots are not stored there.
Explicit check/retry first reads current progress. If it is unchanged, only the
original key/body is retried. A newer server revision is accepted without
replaying the old action. Conflicts refetch without automatic new-revision
choice submission. Successful historical receipts also require a current read.

Epoch/owner/token guards cover requests, auth refresh, locale changes, and
page lifecycle. Source attachment uses a fresh video element, fencing events
from detached media. Subtitle object URLs are revoked on detach. No late
command or session reply can attach a different account/locale/node's media.

The existing single-file controller has no exported auth/session helpers.
Graph-specific lifecycle and revision handling is isolated in one additional
controller instead of altering that legacy behavior or extracting a framework.

## Executed Bounded Validation

1. `tests/ott-graph-preview.test.mjs`: 19 focused DOM/transport/source cases.
2. `tests/ott-private-preview.test.mjs`: existing single-file regressions.
3. `tests/ott-graph-preview.browser.test.mjs`, `browser functional` filter:
   six native-browser groups before any screenshots. Includes actual decoding
   of a retained local synthetic MP4, source-relative bounds, cookie/range
   request observation, branch files, ending, lost acknowledgement, locale,
   account switch, and denial.
4. Same browser file, `browser visual` filter: 15 captures plus JSON metrics,
   five locales at 390/400/1280. Check text wrapping, native decoded dimensions,
   non-overlap, choice hit targets, and full-page reachability. ko390, en400 and
   en1280 were visually inspected after capture.

All passed on their first execution, zero failures/skips/cancellations:

| Run | Passed | Actual Node test duration | Retained log |
| --- | ---: | ---: | --- |
| Graph + existing single-file | 29 | 0.786s | `vm-initial.tap` |
| Browser functional | 6 | 15.105s | `browser-functional-initial.tap` |
| Browser visual | 15 | 30.051s | `browser-visual-initial.tap` |

The only validation-phase edit added decoded frame/color/position fields to
the capture metrics before the visual run. No product fixes or redundant broad
reruns were needed. Actual process/tool overhead and visual inspection are not
included in the table's test durations.

All 15 captures have page width equal to viewport width, three untruncated
choices, decoded video dimensions 160x90, 188 distinct sampled RGBA colors in a
16x16 canvas, and native media position 0.700 seconds at the clip boundary.
Decoded frame counters were 26-27. All choices passed hit testing after
scroll-if-needed; this does not claim every long choice fits simultaneously
inside the initial mobile viewport. The full-page PNGs deliberately preserve
all long-label fixture content.

| Locale | Widths | Decoded dimensions / colors | Frame counters |
| --- | --- | --- | --- |
| ko | 390, 400, 1280 | 160x90 / 188 | 26, 26, 27 |
| en | 390, 400, 1280 | 160x90 / 188 | 26, 26, 26 |
| ja | 390, 400, 1280 | 160x90 / 188 | 27, 26, 27 |
| zh-Hans | 390, 400, 1280 | 160x90 / 188 | 26, 27, 26 |
| zh-Hant | 390, 400, 1280 | 160x90 / 188 | 26, 26, 26 |

Native video frame display can straddle the requested endpoint by frame
granularity even with currentTime at 0.700s; inspected burned-in fixture frame
timestamps included 0.667s and 0.750s. This is browser pause/seek containment,
not frame-exact editing, transcoded clipping, or a DRM boundary. The native
controls continue to describe the authorized whole two-second source file.

Runtime (existing, no install):
`E:/CodexMovedCache/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`.
Node: `E:/Program Files/nodejs/node.exe`.
Existing browser binary is read-only:
`C:/Program Files/Google/Chrome/Application/chrome.exe`.
Retained local fixture:
`E:/CodexMovedCache/tmp/qr1-ott-740a736/fixtures/normal.mp4`.
It is a synthetic two-second QA clip, not story art or a public/private authored
film. Browser routes are fully intercepted, including a clearly fake local
cookie issuer. Tests can observe native Range/cookie behavior, not establish
real Nest/JWT/PG authorization or production byte delivery. Prior backend
acceptance remains separately attributed to the #1898 report.

Used E-only TEMP/TMP:
`E:/CodexMovedCache/tmp/cloud-1900-ott-player-20260922`.
Artifact root (all three logs plus 15 PNGs and 15 JSON files in `visual-final`):
`E:/CodexMovedCache/qa-1900-ott-player-20260922`.
Browser variables: `STORY_UI_PLAYWRIGHT`, `STORY_UI_BROWSER`,
`OTT_UI_MEDIA_FIXTURE`, `STORY_UI_ARTIFACTS`.

Representative artifacts:

- `E:/CodexMovedCache/qa-1900-ott-player-20260922/visual-final/ko-390-ott-graph.png`
- `E:/CodexMovedCache/qa-1900-ott-player-20260922/visual-final/en-400-ott-graph.png`
- `E:/CodexMovedCache/qa-1900-ott-player-20260922/visual-final/en-1280-ott-graph.png`

Each JSON includes the explicit local-fixture caption. No screenshots were
created before the functional groups passed. Fixture SHA256 after the run
matches the retained independent report:
`5892d58c2e652717b1b16b2916effbd89330cd68033168b9b643232d154655c1`.

Commands ran sequentially from this worktree with the environment above:

```powershell
& 'E:/Program Files/nodejs/node.exe' --test tests/ott-graph-preview.test.mjs tests/ott-private-preview.test.mjs
& 'E:/Program Files/nodejs/node.exe' --test --test-name-pattern='browser functional' tests/ott-graph-preview.browser.test.mjs
& 'E:/Program Files/nodejs/node.exe' --test --test-name-pattern='browser visual' tests/ott-graph-preview.browser.test.mjs
```

Browser contexts and browsers closed through test cleanup hooks; every test
process exited 0. No HTTP testserver was started. A final process query found
no node/chrome command line matching this task/runtime profile. The exclusive
heavy slot was returned before documentation/Git handoff.

There are no current #1900 code/helper/dependency reads of the completed
`E:/CodexMovedCache/worktrees/cloud-1848-reader-20260922` worktree. No deletion
was performed here; PM retains cleanup ownership.

No first-failure evidence exists because every first execution passed. No raw MP4, private
manuscript, token, or screenshot is committed. No PM dependency/client is
borrowed or generated. No real paid/provider/wallet call, deployment, public
movie launch, long-film capacity, translation-quality approval, or creator
editor completion is claimed.

## First Independent Return: Nested HTTP Errors

After the original 50 passing fixture cases, QR1 identified a P2 by source
inspection of the actual `HttpExceptionFilter`. Its wire response is
`{success:false,error:{code,...}}`, but the original graph request handler read
only `data.code`. A real `OTT_CONFLICT` response therefore took the generic
blocking path instead of refetching current progress. Manual retry could recover;
this finding does not establish corrupted progress or unauthorized delivery.
It was source-confirmed, not an independently executed PG/browser reproduction.

The original helper's top-level error code masked the integration mismatch.
Original logs and all 15 PNG/JSON pairs remain untouched. Source plan/evidence:
`E:/CodexMovedCache/qa-1900-independent-source-plan.md`.

The narrow correction prefers the actual nested error code and retains a flat
code fallback, matching existing application error consumers. It never renders
raw diagnostics. The fixture helper now returns the global filter envelope.
No common application, backend, layout, copy, or single-file player change is
included in this correction.

Focused regressions cover nested stale choice and position errors, a failed
reconciliation read, nested-code precedence, direct flat-code compatibility,
and 400/401/403/404/409/410/500/503 behavior. A native-browser case checks one
stale choice request, one current read, the unchanged winning fixture branch,
and a later save using the fetched revision. Fixture-state persistence is not
real PostgreSQL evidence; QR1's separate actual Nest/JWT/PG/HTTPS run remains
authoritative for that boundary.

Correction validation passed on its first executions under a separate short
exclusive slot, sequentially using the same E runtime/TEMP and retained MP4:

- 23/23 graph VM/source cases, 0 failures/skips, 0.691 seconds:
  `E:/CodexMovedCache/qa-1900-ott-player-20260922/vm-envelope-followup-initial.tap`.
- 4/4 affected browser groups, 0 failures/skips, 8.308 seconds:
  `E:/CodexMovedCache/qa-1900-ott-player-20260922/browser-envelope-followup-initial.tap`.
  Selection: nested conflict, committed lost acknowledgment, missing
  acknowledgment/save-choice serialization, and owner revocation.

```powershell
& 'E:/Program Files/nodejs/node.exe' --test tests/ott-graph-preview.test.mjs
& 'E:/Program Files/nodejs/node.exe' --test --test-name-pattern='nested HTTP conflict|lost committed acknowledgement|missing acknowledgement|owner revocation' tests/ott-graph-preview.browser.test.mjs
```

No visual matrix was rerun and no new screenshots were created. Original f21
evidence is historical, not proof of the correction. Both processes exited 0;
browser cleanup completed, and a process query found no matching task or
Playwright-profile process. No HTTP testserver was started. The short heavy
slot was returned before documentation/commit/push. Real Nest/JWT/PG/HTTPS
independent validation remains separate and pending at this handoff.

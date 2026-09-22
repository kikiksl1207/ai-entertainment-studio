# Creator Analysis Review #1855: Partial Source Candidate

## Status And Base

BOUNDED LOCAL VALIDATION COMPLETE. VM and intercepted native-browser checks
ran under PM's exclusive slot. No provider, database, install, generation, or
build command ran. This remains a partial candidate, not an independently
accepted end-to-end writer approval or live product claim.

- Base: `849f963132ead271853c4544ac491b3d90fd41b9` (committed runtime65).
- Branch: `codex/cloud-1855-analysis-review-20260922`.
- Worktree: `E:/CodexMovedCache/worktrees/cloud-1855-analysis-review-20260922`.
- No backend/schema/package/PM dependency modification.
- The separate #1900 correction is frozen at
  `3ebd4208056121122c634455763bdf2109dd5e41`. Its original50 and correction27
  results are separate; neither is evidence for this candidate.

## Reuse Audit

The former `cloud-1881-beat-visual-20260922` worktree was reused with PM
authorization. Clean tracked/untracked/ignored state, remote674 identity,
no active process/current helper dependency, absent destination, resolved E
worktree parent bounds and non-reparse paths were checked before native
`git worktree move`. A new branch was checked out from849f963. No force,
permission bypass, dependency/artifact/original-data deletion was used.
The old674 branch/commit and separate QA artifacts remain retained. The old
visual worktree path is absent; #1900 and PM worktrees were not moved or edited.

## Scoped Files

- `pages/creator-studio.js`: retain the verified private manuscript receipt;
  reuse the studio API with narrow identity guards; fence paste refresh/retry.
- `pages/creator-analysis-review.js`: explicit start, status, cursor pages,
  source quotations and local retained-request recovery.
- `creator-studio/index.html`, `styles/creator-studio.css`: flat analysis
  section within the existing writer area, native controls, no second modal.
- `app.js`: five-language analysis keys and matching intake privacy copy only.
- `tests/writer-manuscript-submit.test.mjs`: receipt and identity regressions.
- `tests/creator-analysis-review.test-support.mjs`,
  `tests/creator-analysis-review.test.mjs`,
  `tests/creator-analysis-review.browser.test.mjs`: bounded local fixtures.
- This handoff.

## Actual Contract Used

Authority is committed `story-semantic-analysis.service.ts`, repository,
controller, and global HTTP exception filter, plus the accepted #1853 docs.
All paths below are under `/api/v1/me/creator-studio`:

1. Existing `POST /stories/:workId/manuscripts/paste` returns the private
   manuscript receipt. No analysis is automatically requested by receipt.
2. Explicit `POST /manuscripts/:manuscriptId/analyses` sends the retained
   `Idempotency-Key` and consumes a direct job projection, not `{job}`.
3. `GET /analyses/:analysisId?cursor=...` consumes the real job, evidence,
   `hasMore`, `nextCursor`, and `endCursor` envelope. Every page is reachable;
   the current DOM holds at most100 evidence items. Back history stores only
   cursors/offsets. Running results append in the server's sequence order.
4. `GET /analyses/:analysisId/evidence/:evidenceId/source` is explicit per
   item. Manuscript/job/source-locale and citation references must match.
   Returned text is rendered as text, never HTML. The backend verifies source
   hashes; the UI verifies scope/reference/length, not a second approval.

Semantic full coverage, structural-only results, incomplete coverage, and
failed/unknown usage are distinct. Completion never marks evidence fully
reviewed, memory approved, publication approved, or writer approved.
Failed jobs can be checked but are never automatically restarted/replanned.

## Identity And Recovery

The existing API helper supplies auth and refresh; no duplicate auth transport
or generic framework was extracted. Private callbacks are guarded by owner,
auth epoch, work, source locale, and view epoch. UI language changes invalidate
old requests/quotes without changing the manuscript's source language.
Account/work/source changes and page exit remove private evidence/quotes.

Only owner/work/source-scoped manuscript IDs and owner/version-scoped job IDs
plus the original request key are kept in `sessionStorage`. Source text,
citations, observations, receipts, hashes and tokens are not stored by the
analysis controller. No analysis `localStorage` is used. Request identifiers
must be retained before any enqueue POST; storage failure prevents that send.
Unknown acknowledgments offer explicit same-key checking, never a fresh-key
retry, reupload, automatic enqueue, or guessed job ID.

Session storage is a same-browser aid, not owned discovery or cross-device
save. If an old job ID is available, recovery uses GET only. Otherwise an
explicit replay with the original retained key can retrieve its receipt.

## Unresolved Backend Boundaries

- `ANALYSIS_VERSION_ALREADY_RESERVED` is thrown with top-level
  `analysisJobId`, but the global filter preserves only code/message/details.
  Actual409 has no recoverable job ID. The UI does not read or invent one.
- The owned work catalog has no manuscript/job discovery projection. Another
  device, a cleared browser, or a different reserved-version key cannot find
  that job through this slice. No reupload/new-key workaround is offered.
- No approved semantic evidence-decision mutation is available at this base.
  Legacy generic review decisions are not used as semantic proof.
- #1896 common proof/final confirmation integration awaits its frozen
  backend contract. No second approval flow, final modal action, publication,
  graph conversion or creator approval was introduced.

These are completion blockers for full #1855, not frontend success claims.

## Bounded Validation

The granted sequence ran in order, retaining first failures separately:

1. 16 new analysis VM/source groups plus8 affected paste/helper groups.
2. Four local browser functional groups using the actual writer HTML/scripts:
   receipt/explicit start/source;205-item cursor navigation;unknown-key and
   nested409 behavior;late private citation after identity change.
3. Only after functional pass:15 captures, five UI locales at390/400/1280,
   exact observation/quote content,16px regular text, horizontal bounds and
   actual control hit-testing after scroll-into-view.

Results (do not flatten the initial failures into later passing counts):

| Run | Result | Duration | Retained log |
| --- | --- | --- | --- |
| VM initial | 24/24 pass, zero skipped | 0.799s | `vm-initial.tap` |
| Browser functional initial | 0/4 pass; four setup failures | 127.914s | `browser-functional-initial.tap` |
| Browser functional fixture corrected | 4/4 pass, zero skipped | 13.204s | `browser-functional-fixture-corrected.tap` |
| Browser visual initial | 15/15 pass, zero skipped | 40.396s | `browser-visual-initial.tap` |

The initial browser fixture omitted the actual owned-catalog
`permissions.createManuscript` flag. The existing UI correctly left its
selector disabled; all four cases timed out there before reaching analysis.
The fixture was corrected to supply the real permission and the required
part title. Setup diagnostics and context cleanup were added. No product code
changed during validation. These setup failures are not analysis runtime
failures or evidence of passing functionality; the corrected run is separate.

No screenshots were created before the corrected functional run passed.
All15 PNG/JSON pairs are retained in `visual-initial`. Each JSON includes an
explicit local-fixture caption, not actual manuscript/provider/art proof.
All five locales (`ko-KR`, `en-US`, `ja-JP`, `zh-CN`, `zh-Hant`) share these
measured results at all three widths:

| Viewport/document width | Analysis width | Narrative font | Line height | Exact text |
| --- | --- | --- | --- | --- |
| 390/390 | 362px | 16px, weight400 | 27.2px | observation1040, quote61 characters |
| 400/400 | 372px | 16px, weight400 | 27.2px | observation1040, quote61 characters |
| 1280/1280 | 923.22px | 16px, weight400 | 27.2px | observation1040, quote61 characters |

No raw translation keys/diagnostic codes/IDs were visible in the analysis
panel. All visible controls passed center-point hit testing after native
scroll-into-view, including disabled boundary navigation. No unexpected
mutation or page error occurred in the passing browser runs. The screenshot
framing records the scrolled evidence/source end, not all long content or
the analysis heading simultaneously. Long text remains naturally scrollable.
Existing mixed-language global studio navigation/sample counters are outside
this slice; these captures are not new acceptance of that legacy surface.

Representative images inspected:

- `E:/CodexMovedCache/qa-1855-analysis-review-20260922/visual-initial/ko-KR-390-analysis.png`
- `E:/CodexMovedCache/qa-1855-analysis-review-20260922/visual-initial/en-US-400-analysis.png`
- `E:/CodexMovedCache/qa-1855-analysis-review-20260922/visual-initial/en-US-1280-analysis.png`

All test processes exited (initial browser exit1, corrected/VM/visual exit0).
Browser cleanup completed. Final process inspection found zero matching
task/Playwright-profile Node or Chrome processes. No HTTP testserver was
started. The heavy slot was returned before handoff/commit/push.

Native browser/runtime dependency paths (no PM Prisma/dependency borrowing):

- Node: `E:/Program Files/nodejs/node.exe`.
- Playwright: `E:/CodexMovedCache/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`.
- Browser binary: `C:/Program Files/Google/Chrome/Application/chrome.exe`
  read-only; profiles/TEMP/TMP/artifacts must be E.
- Used TEMP/TMP: `E:/CodexMovedCache/tmp/cloud-1855-analysis-review-20260922`.
- Artifact/log root: `E:/CodexMovedCache/qa-1855-analysis-review-20260922`.

The fixture intercepts all requests. Synthetic private manuscripts/evidence
are clearly test-only, not public stories or actual authored material. Static
images come only from existing checked-in assets; any brand image is not story
art. Unknown/external routes never reach production. This is not real
Nest/JWT/PG/provider proof. Global legacy studio/header rendering is not a
new acceptance claim. Browser contexts close in `finally`, browser in `after`.
No screenshot, fixture manuscript, raw artifact, or dependency belongs in Git.

```powershell
# Executed under the explicit grant, with E TEMP/TMP and STORY_UI_* configured.
& 'E:/Program Files/nodejs/node.exe' --test tests/creator-analysis-review.test.mjs tests/writer-manuscript-submit.test.mjs
& 'E:/Program Files/nodejs/node.exe' --test --test-name-pattern='analysis browser functional' tests/creator-analysis-review.browser.test.mjs
& 'E:/Program Files/nodejs/node.exe' --test --test-name-pattern='analysis browser visual' tests/creator-analysis-review.browser.test.mjs
```

# Reader Beat Visual Binding (#1881 / #1885)

Candidate branch: `codex/cloud-1881-beat-visual-20260922`.
Exact base: `edebaee6354bdd615683397e62c74539ec109507`.
This is frontend candidate evidence, not independent acceptance, publication,
production artwork completion, or a real PostgreSQL reader proof.

## Scope

- `pages/story-stage.js`: consume the active beat's optional `visualContext`;
  scope image load/error callbacks to the mounted stage, beat, session, identity,
  locale and view epoch; preserve public root-relative/HTTPS asset paths.
- `styles/story-stage.css`: enforce hidden image states, non-interactive visual
  layers, and unavailable-image label stacking. Reader dimensions, typography,
  pagination, choices, auth/header and purchase layouts are unchanged.
- `tests/story-stage-first-release.test.mjs`: register focused tests and extend
  the existing fully intercepted fixture with local asset responses.
- `tests/story-stage-reader-visual-source.test.mjs`: six dependency-free source
  and callback tests.
- `tests/story-stage-reader-visual.test-support.mjs`: 18 functional cases and
  15 locale/viewport cases with image pixels and geometry evidence.
- This handoff document.

No old Cloud worktree, PM checkout, backend implementation, schema, package,
Prisma client, manuscript, public story or asset file was changed.

## Binding and Failure Behavior

Absent/null beat context keeps existing scene-level visuals. A supplied context
uses only its own manifest, with matching `sourceSceneKey` / manifest `sceneKey`
and coherent readiness. Invalid bindings use the neutral stage instead of
borrowing the enclosing decision container's art. Same-key A/A beats retain
the same assets; entering source B switches both background and characters.

An image is hidden until it loads with positive `naturalWidth`. Cached success
and failure are checked immediately after listeners attach. A background error
removes that image and reveals the localized unavailable-image state; a
character error removes only that layer. `fallbackUsed` characters and offscreen
cast are never requested or shown. Explicit left placement remains left even
when it is not the first character. No logo is substituted for failed cast.

`/assets/story/fallback.webp` is not present in the repository. The UI does not
invent it or replace it with story artwork. Its 404 is handled like other image
failures. A successfully loaded fallback bitmap remains `fallback`, not `ready`,
and keeps the unavailable-image copy. Ready status requires the appropriate
server visual metadata plus an actually loaded background. This consumes the
public projection; it does not independently grant author/asset approval.

Settlement only changes the associated image/fallback layer, not the reader
DOM, reading scroll, focus, progress revision, choices, purchase or AI state.
Detached or stale callbacks cannot modify the replacement stage. There is no
forced-scroll receipt gate. Accepted 16px / weight 400 / line-height 1.7 text,
bounded full-text scrolling, server-saved active pagination and local completed
pagination are preserved.

## Executed Validation

All executions were serialized in the PM-granted exclusive browser slot.

| Execution | Result | Evidence log |
| --- | --- | --- |
| Built-in-only source tests | 6/6 PASS | `source-initial.tap` |
| Focused binding/failure/late-event browser cases | 18/18 PASS | `functional-initial.tap` |
| Enhanced decoded A/A/B pixel assertions, two affected cases | 2/2 PASS | `functional-pixels.tap` |
| Final localized layouts plus affected regressions | 20/20 PASS | `visual-regression-initial.tap` |

All four logs are under
`E:/CodexMovedCache/qa-1881-beat-visual-20260922/`.
There were no failing executions in this slice. Initial logs remain intact;
the two-case rerun added actual pixel evidence rather than masking a failure.
The final 20 comprise 15 new layouts and five existing regressions: canonical
initial-0 navigation/revisions, explicit purchase confirmation, stable AI wait
key/polling, full reset, and completed progress with a null scene. No broad
reader/purchase matrix or server test suite was run.

Functional cases cover legacy null/absent context, positions 1/2/3 and 0/1/2,
same-scene A/A and distinct B assets, imported missing fallback and ready-404,
failed versus valid character layers, offscreen/fallback cast, loaded fallback
honesty, malformed bindings, partial reading scroll/focus, and late load/error
events after next/previous, choice, reset, account, locale and session changes.
These include held local image responses and explicit detached-node events.

Syntax checks and `git diff --check` passed. Browser/test processes exited;
the worker-scoped Node/Chrome process check was empty after the final run.

## Pixels and Layouts

Final artifacts:
`E:/CodexMovedCache/qa-1881-beat-visual-20260922/visual-final/`.
There are exactly 15 PNGs and 15 corresponding JSON metric/caption files named
`<locale>-<width>-beat-visual.*`, using viewport height 844.

| Locale | Widths | Characters per supplied beat | Result |
| --- | --- | ---: | --- |
| ko | 390, 400, 1280 | 2499 | PASS |
| en | 390, 400, 1280 | 6891 | PASS |
| ja | 390, 400, 1280 | 2499 | PASS |
| zh-Hans | 390, 400, 1280 | 1923 | PASS |
| zh-Hant | 390, 400, 1280 | 1923 | PASS |

Every case first checks a missing source scene, then enters ready B/B beats.
Exact text is compared for all three beats. Scroll endpoints, no horizontal
overflow, contained text, unchanged 16px/400/27.2px computed typography, and
uncovered 44px-minimum pager/choice hit targets are asserted. Stage heights
are 540.15625px mobile and 557.03125px desktop; reading regions measure 300px
mobile and 371px desktop. Three choices remain reachable without mandatory
scrolling. Captures show the final beat at its scroll endpoint; earlier lines
remain accessible by scrolling, not truncated from the source.

Positive image checks include visible loaded elements, `naturalWidth` and
`naturalHeight`, and decoded 16x16 RGBA samples. Final background/character
fixtures are 1254x1254 with 256 nontransparent samples and 248 distinct sampled
colors. The A/A cases compare pixel fingerprints for equality; changing to B
requires a different background fingerprint. The sample fingerprint is test
evidence, not a cryptographic asset-approval or manuscript hash.

Representative captures personally inspected:

- `visual-final/ko-390-beat-visual.png`: Korean narrative, final-beat pager and
  three unobscured choices above the fixed tab bar.
- `visual-final/en-400-beat-visual.png`: English long text in the bounded region,
  current controls and all three choices visible.
- `visual-final/en-1280-beat-visual.png`: desktop text, current image layers,
  pager, choices and reset controls.

Caption and boundary: all text/API/images are private local fixtures. Existing
checked-in brand bitmaps are used ONLY as test images, never as public story
art or replacement character artwork. These captures do not approve global
auth/header behavior under the fixture app stub. The imported missing assets
remain missing; this change provides safe rendering and future approved-asset
binding, not new illustrations.

## Reproduction and Runtime

Worktree:
`E:/CodexMovedCache/worktrees/cloud-1881-beat-visual-20260922`.

Runtime environment:

```powershell
$env:TEMP='E:/CodexMovedCache/tmp/cloud-1881-beat-visual-20260922'
$env:TMP=$env:TEMP
$env:STORY_UI_PLAYWRIGHT='E:/CodexMovedCache/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:STORY_UI_BROWSER='C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:STORY_UI_ARTIFACTS='E:/CodexMovedCache/qa-1881-beat-visual-20260922/visual-final'
$env:STORY_UI_READER_CAPTURES='0'
$env:STORY_UI_DETAIL_CAPTURES='0'
```

Node: `E:/Program Files/nodejs/node.exe`. Chrome is the existing read-only
executable; all profiles, TEMP/TMP and generated evidence are on E:.

```powershell
& 'E:/Program Files/nodejs/node.exe' --test tests/story-stage-reader-visual-source.test.mjs
& 'E:/Program Files/nodejs/node.exe' --test --test-name-pattern='^beat visual:' tests/story-stage-first-release.test.mjs
& 'E:/Program Files/nodejs/node.exe' --test --test-name-pattern='^beat visual: positions' tests/story-stage-first-release.test.mjs
& 'E:/Program Files/nodejs/node.exe' --test --test-name-pattern='^beat visual layout:|^reader: canonical sentinel|^purchase: exact explicit|^AI continuation uses one stable key|^full reset:|^completed projection without' tests/story-stage-first-release.test.mjs
```

The current functional command includes the enhanced pixel checks. No
`NODE_PATH` / `STORY_UI_SERVER_DEPS`, donor modules or generated Prisma client
are required. There was no install, generation, DB, paid/provider call,
production mutation, new artwork, deployment or Notion edit. Browser requests
were intercepted locally or denied; mocks are not full-PG or public release
proof. No persistent development server is needed for this intercepted harness.

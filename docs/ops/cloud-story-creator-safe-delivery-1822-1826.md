# Cloud Story Creator and Safe Delivery Bridge #1822-#1826

Owner: Cloud
Date: 2026-07-11
Scope: writer-facing Creator Studio flow, branch read model, rights boundaries,
safe release QA, and scene asset delivery. This is a source-contract handoff;
it does not create a story, upload materials, publish, generate, charge, or
change a real account.

## Shared Delivery Rules

- The writer provides work basics, part manuscript, visible choices, ending
  intent, and public scene asset labels. The system validates, converts, and
  prepares internal route data after the writer-facing review step.
- Public UI receives localized display text and descriptive asset metadata.
  It must not render implementation identifiers, conversion details, private
  source links, contract text, or service responses.
- Every writer input and preview field has a `ko`, `en`, `ja`, `zh-Hans`, and
  `zh-Hant` value. A missing translation falls back to the work default before
  review; it is not silently published.
- The 390px and 400px layouts keep the active editor section, review status,
  and primary action reachable without horizontal page overflow. Tables may
  scroll inside their own container.

## #1822 Writer Intake Flow

### Writer Flow and System Boundary

| Step | Writer-facing responsibility | System responsibility | Exit condition |
| --- | --- | --- | --- |
| Work setup | Enter title, summary, genre, locale-ready display copy, and release intent. | Validate required fields and retain a private draft revision. | Work basics have no visible validation issue. |
| Part manuscript | Add ordered parts and body text. | Check part order, size limits, and missing localizations. | Each part has a readable title and body. |
| Choice marking | Add visible choice text, target scene intent, and optional rejoin intent. | Validate reachable targets and build route data after validation. | Every non-ending choice has a valid next intent. |
| Ending setup | Mark one main ending and optional sub or assisted-ending intent. | Check ending reachability; keep assisted preparation separate from writer content. | Ending intent is unambiguous to the reviewer. |
| Scene materials | Select approved background and character labels with localized descriptions. | Check asset availability, rights gate, rendition readiness, and fallback metadata. | Each scene has a usable visual or fallback. |
| Review preview | Inspect localized writer preview and issue list. | Produce a read-only review snapshot and comparison summary. | No blocking issue remains. |
| Publish confirmation | Confirm the reviewed version. | Re-run validation, rights gate, and release readiness before a separately authorized publish. | A later authorized owner may publish. |

### Draft, Revision, and Validation States

The editor exposes human-readable states: drafting, needs revision, structure
review, language review, screen review, ready for confirmation, and blocked.
Validation points to the visible field and localizes both its label and help
text. Re-upload replaces only the selected draft material after a new preview;
it never overwrites the reviewer snapshot in place.

Version comparison is limited to writer-visible differences: work basics,
affected parts, choice text, ending intent, and scene material labels. System
conversion output remains outside the writer comparison surface.

### Mobile Acceptance

- The part editor remains single-column at 390px and 400px.
- Long localized choice text wraps before the next-scene summary and action.
- Preview status and validation summary appear before the confirmation action.
- Import preview uses the existing contained scroll area, not page-level width.

## #1823 Branch Read Model

### Vocabulary

| Term | Meaning | Reader effect |
| --- | --- | --- |
| Scene | One readable unit with a localized body, visual metadata, and zero or more choices. | The player renders the current scene only. |
| Choice | A visible option from one scene to a next scene or an ending. | The player shows one action per choice. |
| Branch | The path created by successive reader choices. | The current path is retained as progress state. |
| Rejoin | A writer-declared convergence of two or more paths at a later scene. | The reader sees the declared destination as the next scene. |
| Ending | A terminal scene classified as main, sub, or assisted intent. | The player stops choices and shows the applicable ending UI. |

A rejoin is explicit data on the destination relationship. It is not inferred
when two choices happen to point to the same next scene. Multiple choices that
return immediately to the same scene therefore remain distinct from a declared
rejoin and can be flagged for writer review.

### Read Model Shape

The player receives a bounded scene projection:

- Current scene: localized title/body, accessible visual description, and
  localized visible choices.
- Current path summary: only enough stable progress data to resume the reader
  without reconstructing the entire graph in the browser.
- Next hints: direct next-scene visual and accessibility metadata for the
  visible choices, subject to asset readiness.
- Review metadata: public state such as unavailable visual fallback, without
  exposing source locations or conversion details.

For a long work, the initial read fetch returns the current scene and its
choices. Selecting a choice fetches only the selected next-scene projection.
Creator Studio graph preview uses paged neighbourhood reads around its selected
scene: parent context, current choices, direct destinations, and declared
rejoin badges. It requests more only when the editor moves the focus.

Backend contracts and the player/preview must use the vocabulary above. A
backend contract can retain opaque storage references internally, but browser
projections contain only localized display fields and safe relationship labels.

## #1824 Rights Scope Gate

### Per-work Rights Envelope

Each work owns a private rights envelope with only these decision attributes:

- work class: public-domain or licensed;
- allowed content categories: manuscript, setting, character, and image;
- active period, approved regions, and approved display languages;
- whether the relevant transformation class is permitted;
- review state and an opaque rights reference held outside the public UI.

The envelope never contains contract text or source material in browser data,
screenshots, reports, or this handoff.

### Gate Order

1. Editor selection validates work class and the material category.
2. Locale preparation verifies the requested display language is allowed.
3. Any transformation request checks its permission before work begins.
4. Preview shows a localized ready, review-needed, or unavailable state.
5. A separately authorized publish rechecks category, period, region,
   language, and transformation permission against the current envelope.

A blocked state gives the writer a plain explanation such as “This material
needs rights review before release.” It does not reveal the private reason,
agreement terms, or reference value. Public-domain work follows the same
material and locale validation, but skips licensed-only approval requirements.

## #1825 Safe QA Release Bridge

### Safe Session Boundary

One pre-provisioned disposable QA sign-in state is the only representative
action required from leadership. Its values stay in the approved private
credential channel. The release check records only surface name, read-only
result, sanitized status category, and next owner.

| Surface | Allowed verification | Explicitly excluded |
| --- | --- | --- |
| Sign-in and inbox | Session presence, protected-page redirect, and user-facing recovery state. | Account creation, recovery delivery, identity-provider action. |
| Protected areas | Read-only access decision and localized fallback UI. | Permission or role change. |
| Wallet | Balance/history preview and empty/error fallback in read-only mode. | Charge, debit, refund, settlement, or payout. |
| Debut | Read-only status projection and safe fixture state. | Application creation, resubmission, decision, provider action, or any release-changing operation. |

Use the latest safe fixture source contracts and owner-fixture runbook as the
single readiness source. A missing disposable session, missing fixture, or an
unexpected write affordance is `BLOCKED` and goes to ChaMo with the required
non-secret preparation described in plain language. It is not resolved by
substituting a personal account or recording session material.

### Release Checklist

- Confirm the fixture is read-only before opening each surface.
- Check logged-out, loading, empty, error, and ready fallback copy.
- At 390px and 400px, check wrapping, bottom navigation clearance, and no raw
  localization marker or private value on screen.
- Hand live/mobile execution to QR2 or Viewer. Hand main reflection or deploy
  work to Zoro.

## #1826 Scene Asset Delivery

### Manifest and Window

The desktop and mobile player consume one safe scene manifest. For the current
scene it supplies a background candidate, character candidates, localized
alternative text, aspect guidance, and fallback presentation metadata. For each
visible next choice it supplies only enough metadata to prepare the immediate
candidate scene.

The client keeps a small rolling window:

1. Render the current scene with its ready asset or fallback.
2. After current rendering settles, prepare direct next-choice candidates at
   low priority.
3. On choice selection, retain the current scene until the selected scene has
   a ready visual or a ready fallback.
4. Release assets outside the current plus direct-next window, except a brief
   transition hold needed to prevent a blank frame.

No full-work preload occurs. Slow connections prefer the fallback immediately
over an empty canvas. Failed image loading replaces the failed layer with the
same scene’s localized description and stable background treatment; it does not
reuse a previous scene visual as if it belonged to the new scene.

### Responsive and Accessibility Rules

| Area | Desktop and mobile rule |
| --- | --- |
| Background | Cover the scene stage while keeping text contrast treatment independent of image success. |
| Character | Preserve aspect ratio, avoid covering primary choice controls, and hide the layer cleanly when absent. |
| Text | Use localized alternative text from the manifest; never derive it from a storage name. |
| 390px/400px | Keep the active scene readable, choices above bottom navigation, and transition state within the stage. |
| Cache | Key only on the safe manifest rendition identity and revision; evict outside the rolling window. |

## Handoff and Verification

- #1822 implementation starts from the existing writer upload and Creator
  Studio surfaces, using the flow and validation boundaries above.
- #1823 implementation aligns scene/player and future graph preview wording
  with the shared vocabulary before adding graph rendering.
- #1824 requires rights-owner confirmation of permitted categories and policy
  values before a publish-capable implementation is enabled.
- #1825 is ready for QR2 or Viewer only after the private safe session and
  fixture are available; no live mutation belongs to this task.
- #1826 implementation starts with the existing story-stage background and
  character update points, then verifies 390px and 400px transitions.

Verification for this document: source/static review only. No forbidden
mutation was executed, and this document contains no credentials, private
values, internal references, or provider payloads.

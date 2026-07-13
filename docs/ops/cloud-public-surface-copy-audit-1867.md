# Cloud Public Surface Copy Audit #1867

Owner: Cloud
Date: 2026-07-13
Scope: source/static audit of public route copy and visible fallback surfaces.
No live sign-in, payment, support, refund, story generation, upload, publish,
or progress-changing action was performed.

## Findings and Routing

| Surface | Publicly visible concern | Action in this batch | Follow-up owner |
| --- | --- | --- | --- |
| Charge, logged out | The notice framed normal product information as a preview. | Changed it to a concise charge notice and retained the login action. | Cloud source/static complete; Viewer mobile check after main reflection. |
| Premium support | Disabled support states described internal readiness and preview-only behaviour. | Changed them to user-facing availability guidance while preserving the disabled state. | Cloud source/static complete; product policy owner when support opens. |
| Writer final manuscript form | The rights field and unavailable intake error exposed implementation-oriented wording. | Replaced them with plain user-facing material and retry guidance. | Cloud source/static complete; Kaido intake integration. |
| Story player | Fixed choices were rendered with manuscript labels and had no capability-safe custom-input or progress-control shell. | Added server-projection gated numeric choices, custom input, resume, and reset UI. | Kaido #1872-#1876 must provide the capability and progress projection. |
| Local-only fixtures | Feed, profile, charge, and chat fixture code remains source-only or local-path guarded. | No public route was changed to expose fixture data. | QR2 or Viewer verifies deployed routes only. |

## Visible DOM Rules

- Public fallback text must not claim that a service is unfinished, a preview,
  or an internal QA surface when a normal availability or retry message is
  sufficient.
- Local-only fixture indicators stay hidden outside local development. They are
  not treated as production content or release evidence.
- A missing i18n value, implementation marker, or local host marker is a QA
  failure on desktop, 390px, and 400px.

## Story Capability Boundary

- Fixed story choices show only 1, 2, and 3.
- Direct input is rendered only after the server provides an enabled,
  entitlement-confirmed custom-choice capability with a session-scoped path
  and a maximum length.
- Resume and reset controls are rendered only from the server progress
  projection. The UI does not infer ownership, remaining quota, or a reset
  target from local state.
- Reset confirmation displays only the server-provided public summary and
  remaining count. It does not show source manuscript or private reader input.

## Mobile and Locale Checkpoints

- At 390px and 400px, the custom-choice editor, reset buttons, and reset dialog
  must remain above the bottom navigation and contain long text without page
  overflow.
- The story control copy supplies `ko`, `en`, `ja`, `zh-Hans`, and `zh-Hant`.
- Live/mobile QA should verify the capability-off, capability-on, quota-empty,
  and long-text states after the matching backend work is reflected on main.

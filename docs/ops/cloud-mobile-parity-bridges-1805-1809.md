# Cloud Mobile Parity Bridges #1805-#1809

Owner: Cloud
Date: 2026-07-10
Scope: frontend bridge map, public copy parity, mobile QA checkpoints, and small common i18n slot completion.

## Work Items

| Board | Goal | Output | Blocker resolved |
| --- | --- | --- | --- |
| #1805 | Auth fixture mobile frontend bridge | Auth fixture-to-screen bridge below | Auth modal and verify/reset states share public copy keys and 390/400px checks. |
| #1806 | Story stage scene background responsive bridge | Story scene responsive bridge below | Choice-specific background, character, scene text, and next-scene markers have QA selectors. |
| #1807 | Story writer upload creator studio parity | Writer upload parity bridge below | Story upload fields map to future Creator Studio inputs without exposing internal conversion details. |
| #1808 | Premium support/wallet/debut public copy parity | Public copy parity table below | Fixture/localhost/raw state copy is routed to user-facing status copy candidates. |
| #1809 | Global mobile navigation i18n followup | Common i18n slot patch plus nav QA table below | Shared nav/tab/footer zh-Hant gaps are filled without changing key names. |

## #1805 Auth Fixture Mobile Frontend Bridge

| State | Existing public screen/key | 390/400px checkpoint | Must not show |
| --- | --- | --- | --- |
| login-required | `auth.loginRequired`, login/register tabs | Auth modal opens directly on the selected form and fits within the viewport; CTA remains reachable. Internal return intent stays non-visible and redirects only after successful login. | internal workflow guidance, raw key, fixture name, local dev host, token value, raw email. |
| expired reset | `resetPassword.expired.*` | Reset landing title/body/primary button wraps without horizontal scroll. | reset link, query token, raw backend detail. |
| invalid reset | `resetPassword.invalid.*` | Invalid state can route back to login without overlapping footer/tabbar. | action token, raw email, internal status. |
| social fallback | email login form and configured social login buttons | The email form remains the stable fallback without a development guidance panel above the form. | provider payload, provider raw error, account id, internal fallback guidance. |

The bridge uses the existing auth return behavior and `styles.css` modal sizing without exposing internal bridge or QA guidance in the user-facing modal. No live login, register, resend, reset, or social provider mutation is required for this source/static bridge.

## #1806 Story Stage Scene Background Responsive Bridge

| Player element | Source selector | Expected behavior |
| --- | --- | --- |
| Scene background | `[data-story-player-bg]`, `[data-choice-result-bg]` | Uses choice-specific background style with one default background per scene. |
| Character layer | `[data-story-player-character]` | Updates with the active choice character asset and can be hidden by CSS if absent. |
| Next scene marker | `[data-story-player-scene]`, `[data-choice-result-scene]` | Shows user-facing scene labels, not raw scene ids. |
| Choice controls | `[data-story-player-choice]`, `[data-story-branch-choice]` | A/B/C selection changes scene, background, character, bridge copy, and summary fields. |
| Mobile containment | `.story-player-overlay`, `.story-player-choices`, `.story-player-input` | At 390/400px, choices wrap and input/overlay stay above bottom navigation. |

QA route: `/story-stage?storySceneFixturePreview=1`. The follow-up check should click each choice and confirm background, character, scene pill, summary, and next-scene copy all change together.

## #1807 Story Writer Upload Creator Studio Parity

| Writer input group | Existing source | Creator Studio parity rule |
| --- | --- | --- |
| Work basics | Story upload overview cards | Keep writer-facing title/part/summary fields separate from system conversion details. |
| Part body | `textarea[name="body"]` | Writer uploads manuscript/body; system performs internal parsing later. |
| Branch points | `.su-choice-row`, `.su-branch-card` | Display choice text, next scene, state result, and rejoin copy as public labels. |
| Ending setup | `.su-ending-card`, `.su-main-route-badge` | Distinguish writer main ending, writer sub ending, and AI fallback candidate. |
| Background/cast | `[data-public-asset-id]`, `[data-safe-background-id]`, `[data-safe-character-id]` | Use public asset labels; no provider prompt or private asset URL. |
| Import preview | `.su-import-wrap`, `.su-import-preview` | Allow horizontal table scroll at 390/400px rather than page overflow. |

QA route: `/story-upload/`. The writer view should keep upload/import/publish disabled unless a later task explicitly opens those mutations.

## #1808 Premium Support Wallet Debut Public Copy Parity

| Surface | Public copy direction | Source reference | Forbidden action |
| --- | --- | --- | --- |
| Premium support | "Support is being prepared" / "Preview only" / "Refund review" copy should hide raw contract and provider details. | `pages/premium-chat-support.js`, read-only support contract. | donation, room open, refund, settlement, payout. |
| Charge/wallet | Logged-out or preview state should explain login/visual preview without showing fixture internals. | `pages/charge.js`, charge preview data. | payment provider call, wallet credit/debit, refund. |
| Debut | Submit/status/fixture copy should explain review flow and safe fixture need without exposing identity/provider detail. | `debut/index.html`, debut auth/account contracts. | identity provider call, real application submit, private personal data handling. |

Copy candidates should be promoted through normal i18n keys before visual QA. Until then, QA reports should record only user-visible wording problems and avoid raw response payloads.

## #1809 Global Mobile Navigation I18n Followup

This branch fills missing `zh-Hant` slots for shared nav/tab/footer/debut CTA keys in `app.js`. It does not rename keys or change locale resolution.

| Area | Keys touched | Mobile checkpoint |
| --- | --- | --- |
| Header nav | `nav.home`, `nav.artists`, `nav.luminaPick`, `nav.luminaFeed`, `nav.debut`, `nav.mypage` | Long translated labels should wrap or remain hidden according to existing responsive nav behavior. |
| Bottom tabbar | `tab.home`, `tab.artists`, `tab.pick`, `tab.feed` | At 390/400px, labels should not push icons/buttons outside the tabbar. |
| Footer/common CTA | `footer.*`, `brand.tagline`, `cta.debut` | Footer links and mobile debut CTA should not show raw keys in zh-Hant. |

## Verification Notes

- Source/static branch only.
- No payment, wallet, donation, refund, provider, upload, import, publish, debut submit, story write, or story progress mutation is executed by this bridge.
- Follow-up mobile QA should use 390px and 400px and report horizontal overflow, bottom navigation overlap, raw key exposure, and visible sensitive values separately.

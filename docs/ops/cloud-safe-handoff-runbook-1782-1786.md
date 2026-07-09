# Cloud Safe Handoff Runbook #1782-#1786

Owner: Cloud
Date: 2026-07-09
Scope: non-secret request pack, blocker tracker, route bridge map, release follow-up slice, and user handoff runbook.

## Work Items

| Board | Goal | Output | Blocker resolved |
| --- | --- | --- | --- |
| #1782 | Safe QA fixture request pack | Request table below | Repeated live QA blockers are grouped into one non-secret ask list. |
| #1783 | Blocked live QA dependency tracker | Dependency table below | QA can see whether each lane waits for fixture, route, main reflection, live deploy, or user input. |
| #1784 | Support/profile route bridge map | Route bridge below | Premium support route 404 and public profile fixture checks are separated by source file and QA URL. |
| #1785 | Release parity follow-up board slice | Parity slice below | #1713/#1720/#1723 have source/main/live/mobile checkpoints in one place. |
| #1786 | Non-secret user handoff runbook | User runbook below | The Leader can prepare or confirm values without copying secrets into board, Git, or chat. |

## #1782 Safe QA Fixture Request Pack

| QA lane | Non-secret request name | What the Leader confirms | Where to check | What to tell Chamo |
| --- | --- | --- | --- | --- |
| Auth login/register/logout | safe account | One disposable account exists and may be used for QA. | Site login screen or private credential handoff owner. | "Safe account ready" or "safe account not ready". |
| Auth email/reset | inspectable inbox | The QA inbox can receive and inspect verification/reset mails. | Mailbox chosen by Leader, outside public board notes. | "Inspectable inbox ready" or the inbox is not available. |
| Protected entry smoke | safe account with expected state | The account can reach story/creator/premium/debut/mypage gates as a QA user. | Live site after login. | Which account type is ready: normal, creator, debut-ready, or none. |
| Wallet/charge visual QA | wallet fixture | A QA wallet/balance state exists for visual smoke only. | Charge/wallet screen in approved QA context. | "Wallet fixture ready for visual smoke" or "not approved". |
| Debut application QA | debut status fixture | A QA debut status exists for read/status/resubmit views. | Debut page or admin-prepared fixture source. | Which status bucket is ready, using only display-safe bucket names. |
| Premium chat QA | premium room fixture | Safe room rows exist for active, blocked/review, refund, closed, and empty states. | Premium chat hub/support surfaces. | Which room status buckets are ready, without private room details. |

Do not paste credentials, private links, production configuration, personal contact values, or raw provider/debug payloads into board/Git/Notion. Only record the non-secret request name and ready/not-ready state.

## #1783 Blocked Live QA Dependency Tracker

| Lane | Current blocker type | Current blocker | Ping-pong flag | Next waiting action |
| --- | --- | --- | --- | --- |
| Story | awaiting live deploy / mobile QA | #1713 and #1723 need main/live reflection verification; #1720 already has a live/mobile PASS on the latest recorded main. | Yes, #1713/#1720/#1723 crossed the 3-run visual loop threshold. | Jo confirms main/live reflection, then QR2 checks the listed URLs below. |
| Auth | missing fixture | Safe account and inspectable inbox are still required for full live smoke. | Yes, account/inbox blockers recur across #1751/#1752/#1756. | Leader provides safe account/inbox readiness through private handoff. |
| Feed/profile | route/fixture plus mobile spacing | `/user-profile?handle=fan1004` is a source-supported route, but live QA reported bottom spacing overlap and fixture uncertainty. | Yes, profile/follow/upload issues recur from QA2/Viewer reports. | Luffy fixes spacing/fixture affordance if needed; Viewer/QR2 retest 390/400px. |
| Premium | route missing plus missing fixture | `/premium-chat-support` has support JS but no standalone route page; safe premium room/session fixtures also needed. | Yes, premium support route and fixture blockers recur. | Luffy chooses route/sheet/CTA target; Kaido/Chamo confirm safe room fixture. |
| Wallet | missing fixture / user input needed | Visual smoke can inspect charge states, but approved QA wallet state is still needed for any deeper live QA. | No direct Cloud action. | Chamo/Leader confirm visual-only wallet fixture; no real payment/refund path. |
| Debut | missing fixture / user input needed | Safe debut status fixture is required before submit/status/resubmit live smoke. | Recurring in #1778. | Chamo/Leader provide debut fixture bucket readiness. |

## #1784 Support/Profile Route Bridge Map

### Premium Support

| Question | Source/static finding | Luffy fix file | QA URL/check |
| --- | --- | --- | --- |
| Is `/premium-chat-support` a standalone page? | No standalone `premium-chat-support/index.html` exists in this source snapshot. | Create a page route if product wants a direct URL. | `/premium-chat-support` should return 200 if this path is promised. |
| Is support UI code present? | Yes. `pages/premium-chat-support.js` renders read-only donation/support preview and fetches the premium support contract. | Wire this module into a page, hub sheet, or character chat CTA target. | Confirm support/refund/donation preview is visible without executing paid actions. |
| Is the hub route a direct support hub? | `premium-chat-hub/index.html` currently redirects to `/character-chat`; `pages/premium-chat-hub.js` is the list/sheet module. | Decide whether hub should stay redirect-only or expose support state. | `/premium-chat-hub` and `/character-chat` should not disagree about support entry. |
| What must not happen? | No live room open, donation, refund, wallet, settlement, or payout action should run from route QA. | Keep CTA disabled/read-only until backend authority opens it. | Viewer/QR2 report only visible state and 390/400px layout. |

### Public Profile

| Question | Source/static finding | Luffy fix file | QA URL/check |
| --- | --- | --- | --- |
| Is user profile route present? | Yes. `user-profile/index.html` loads `pages/user-profile.js`. | `user-profile/index.html`, `pages/user-profile.js`, `styles/user-profile.css`. | `/user-profile?handle=fan1004` at 390/400px. |
| How is handle profile resolved? | Frontend calls handle-based public profile and feed endpoints; docs prefer handle routes for shareable profile links. | Keep handle route preferred; avoid requiring internal identifiers in QA URLs. | Profile should show public-safe fields or a read-only fixture fallback. |
| Does `fan1004` have a fixture path? | `pages/user-profile.js` can build read-only feed/profile fixture for handles matching `fan####` when live data is unavailable. | If live API returns a non-fixture state, add a deliberate QA flag or fixture route in a later UI task. | `/user-profile?handle=fan1004` and, if needed, a clearly documented fixture flag. |
| Known mobile issue | Viewer reported profile tabs overlapping the mobile tab bar around 390px. | `styles/user-profile.css`. | Check tab bottom and mobile tabbar top do not overlap. |

## #1785 Release Parity Follow-Up Board Slice

| Board | Source branch / commit | Main reflected | Live deployed | Mobile QA checkpoint | Next owner |
| --- | --- | --- | --- | --- | --- |
| #1713 creator main route badge UI | `codex/luffy-13-ui-followups-20260709` / `1a9877a` | Waiting for Jo confirmation. | Waiting after main reflection. | `/story-upload/` at 390/400px: creator main badge visible; internal route/scene/provider copy not visible; import preview does not overflow. | Jo, then QR2/Viewer. |
| #1720 free story mobile choice pacing QA | `codex/luffy-13-ui-followups-20260709` / `1a9877a`; live PASS also recorded on main `b4e7640`. | Reflected for the latest recorded PASS path. | Live PASS recorded for `/story-stage?storySceneFixturePreview=1`. | Choice result card, next-scene copy, ending mini-map, and bottom nav no-overlap at 390/400px. | QR2 can keep as PASS unless a newer deploy regresses. |
| #1723 creator story upload analysis visual QA | `codex/luffy-13-ui-followups-20260709` / `1a9877a` | Waiting for Jo confirmation. | Waiting after main reflection. | `/story-upload/` at 390/400px and desktop: analysis table uses public labels, AI draft is not shown as official, no horizontal overflow. | Jo, then QR2/Viewer. |

If any of these rows bounces again after Jo reflection, mark the row for Chamo instead of reopening broad UI work.

## #1786 Non-Secret User Handoff Runbook

Use this when asking the Leader for QA readiness. The Leader may type secrets into the official site/provider/mailbox, but should not copy those values into board, Git, Notion, screenshots, or chat.

| Request | Plain-language steps for Leader | Safe reply back to Chamo |
| --- | --- | --- |
| safe account | Open the live site, confirm a disposable QA account can sign in, and confirm whether it is normal, creator-capable, debut-ready, or premium-ready. | "Safe account ready: normal/creator/debut/premium" or "not ready". |
| inspectable inbox | Open the QA mailbox in the private tool chosen by the team, send/request a test mail if needed, and confirm that incoming messages can be inspected. | "Inspectable inbox ready" or "inbox not ready". |
| wallet fixture | Open the approved QA wallet/charge context and confirm that a visual-only state exists. Do not complete payment/refund actions. | "Wallet fixture ready for visual smoke" or "not approved". |
| debut status fixture | Open the debut status/admin-prepared QA area and confirm which display status bucket exists. Do not submit real personal data. | "Debut fixture ready: status bucket name" or "not ready". |
| premium room fixture | Open the premium chat QA context and confirm whether active, review/blocked, refund, closed, and empty buckets exist. Do not open paid rooms or send private messages. | "Premium room buckets ready: active/review/refund/closed/empty" or "not ready". |

Board-safe wording rule: record only the request name, readiness state, surface, and next owner. Anything that would let someone log in, contact a person directly, access storage, or mutate money/content stays out of public notes.

## Verification Scope

- Source/static only.
- No page UI, CSS, JavaScript runtime behavior, backend route, provider routing, upload, publish, payment, refund, wallet, support, debut, story write/progress, or fixture creation mutation is changed by this document.
- Mobile criterion is preserved as a QA handoff requirement: any follow-up visual/live check must include 390/400px and must report overlap/overflow separately.

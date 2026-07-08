# Cloud Bridge Gap Maps #1742-#1781

Owner: Cloud
Date: 2026-07-08
Scope: read-only contracts, fixture maps, and handoff inventories only.

## Work Items

| Board | Goal | Output | Blocker resolved |
| --- | --- | --- | --- |
| #1742 | Protected entry bridge contract | `AUTH_PROTECTED_ENTRY_BRIDGE_CONTRACT` | Shared split between public preview and login-gated mutation entries. |
| #1743 | Account state projection bridge | `AUTH_ACCOUNT_STATE_PROJECTION_BRIDGE` | Shared public projection for verification, social-only, identity, and settlement notices. |
| #1744 | Social provider fallback bridge | `AUTH_SOCIAL_PROVIDER_FALLBACK_BRIDGE` | Shared fallback states for disabled provider, SDK failure, account collision, and unsafe unlink. |
| #1745 | Auth live QA handoff package | `AUTH_LIVE_QA_HANDOFF_SCHEMA` | Safe blocked response when no approved QA account exists. |
| #1755 | Auth entry status dashboard bridge | `AUTH_ENTRY_STATUS_DASHBOARD_BRIDGE` | Common dashboard columns for story, creator, premium, debut, and mypage auth gates. |
| #1762 | Fan engagement stage gap inventory | This document | Phase 3A/3B GO/NO-GO status visible without opening mutation paths. |
| #1767 | Feed upload/profile/follow gap triage | This document | Feed/profile/image-upload bugs grouped by source, live QA, and owner handoff. |
| #1771 | Premium chat fixture handoff map | This document | Safe fixture/session requirements listed without private room or session details. |
| #1775 | AI premium content unlock map | This document | Read-only, queue, provider, storage, moderation, and admin review gates separated. |
| #1781 | Main/live parity release dashboard | This document | Product area release status can be tracked by source, main, live, and mobile QA. |

## #1762 Fan Engagement Stage Gap Inventory

Source references: `docs/ops/board.md`, `BA-003`, `BA-008`, `BB-003`, `IN-005`, `OP-001`.

| Area | Current safe state | Mutation state | Next gate |
| --- | --- | --- | --- |
| Mission list | Read-only public list can be checked when API returns rows. | Mission submit remains blocked. | Safe QA mission and reset bucket from OP-001 or Backstage mission management from BA-008. |
| Concept vote | Frontend map exists, but ballot submit is not open. | Vote submit remains blocked. | Backend authority, idempotency, moderation, and safe vote fixture. |
| One-line proposal | UI plan can show locked/read-only states. | Proposal submit remains blocked. | Fan text moderation and safe QA proposal fixture. |
| Points/title equip | Non-cash reward concept is documented. | Reward grant and title equip remain blocked. | Server-authority reward ledger, idempotency, and no wallet coupling. |
| Creator Studio today tasks | Planning only. | Creator task mutation remains blocked. | Creator auth, safe account, and Backstage API handoff. |

Phase 3B decision: NO-GO until a safe QA mission/user/reset source exists and the logged-in smoke passes. Opening submit/vote/proposal/title equip requires an explicit later task.

## #1767 Feed Upload Profile Follow Gap Triage

Source references: `QA2-001`, `FE2-001`, `BS-001`.

| Issue | Source/static check | Live check needed | Priority | Next owner |
| --- | --- | --- | --- | --- |
| Follow/unfollow copy mojibake | Search visible copy and locale fallback in feed/profile pages. | Confirm artist detail and public profile on 390/400px. | P0 | Luffy for small UI fix, Viewer for visual QA. |
| Feed author click | Confirm fixture links preserve public handle and read-only fixture flags. | Click feed author cards on live/mobile without follow mutation. | P1 | Luffy, then Viewer. |
| Mini profile modal | Confirm modal fallback hides private identifiers and signed URLs. | Check modal open/close and overflow on mobile. | P1 | Luffy, then Viewer. |
| Cover/avatar upload | Confirm broken/loading/error states do not reveal storage details. | Real upload retest only with approved safe path. | P0 | QR2 or Viewer; storage blocker to Kaido if API fails. |
| Feed image upload | Confirm client error copy is display-safe. | Retest live browser upload only with safe fixture and no private asset URL in notes. | P0 | QR2 after safe upload condition. |

No follow, block, upload, import, or publish mutation is opened by this inventory.

## #1771 Premium Chat Fixture Handoff Map

| Fixture need | Required safe value | Missing-value request |
| --- | --- | --- |
| Safe login/session | Approved QA account or secure session source with read-only scope. | Please provide an approved QA login/session source through the private credential channel. |
| Room status rows | Active, reported, refund-review, closed, and empty-room buckets tagged for QA. | Please confirm whether the existing premium chat fixture runbook can prepare these rows in the target environment. |
| Support/refund state | Non-secret status rows for support/refund views. | Please provide the target environment and approved fixture run id, not private messages. |
| Cleanup/reset | Run-scoped cleanup policy and owner. | Please confirm who can reset only QA-tagged rows after live smoke. |
| Mobile QA route | `/premium-chat-hub`, `/premium-chat-support`, and premium CTA entry. | Please hand to Viewer/QR2 after safe rows exist. |

The map does not contain private messages, room secrets, credentials, or direct session material.

## #1775 AI Premium Content Unlock Map

Source references: `server/src/ai-premium-content/*`, AI premium status preview fixture, premium video module, and creator request flows.

| Stage | User/creator state | Admin/provider state | Open condition |
| --- | --- | --- | --- |
| Read-only preview | Status preview fixture can show pending, review, ready, blocked, and failed states. | No provider call required. | Already safe as read-only fixture. |
| Queue request | Creator/user sees request CTA as gated or queued. | Queue write remains blocked until server validation and cost guard are confirmed. | Later task must explicitly open request mutation. |
| Provider routing | User sees provider-unavailable copy only. | Provider key, prompt body, and raw provider payload stay server-only. | Provider routing and failure policy reviewed by backend. |
| Storage | User sees public-safe asset status only. | Private asset URL and signed URL stay out of screen and reports. | Object storage access, retention, and moderation policy confirmed. |
| Moderation | User sees under-review or blocked copy. | Raw moderation payload stays server-only. | Moderation result projection and retry policy approved. |
| Admin review | Creator/admin sees review queue status. | Admin action audit and permission boundary required. | Backstage review contract and safe QA fixture ready. |

No image/video generation, provider call, upload, import, publish, wallet debit, or unlock mutation is enabled by this map.

## #1781 Main Live Parity Release Dashboard

| Axis | Source | Main | Live | Mobile QA | Flag |
| --- | --- | --- | --- | --- | --- |
| Story | Source/local PASS exists for recent story upload/stage bridges. | Reflected on main at current story merge line. | Needs deployment confirmation after next release. | 390/400px local PASS; live retest after deploy. | Handoff to Jo for deploy/reflection if live lags. |
| Auth | Bridge contracts added in this branch. | Pending merge. | Pending deploy. | Contract-only; visual QA belongs to Viewer/QR2 with safe account. | Safe QA account required for live login smoke. |
| Feed/profile | Gap inventory complete. | No code change in this branch. | Needs live/mobile triage. | Handoff to Viewer/QR2. | Known copy/upload/profile checks remain. |
| Creator | Auth gate dashboard includes creator entry. | Pending merge. | Pending deploy. | Needs protected entry smoke with approved creator account. | Safe creator account required. |
| Fan engagement | Stage gap inventory complete. | No mutation opened. | Phase 3B NO-GO remains. | Needs safe mission/user/reset source before logged-in smoke. | Handoff to Chamo/Kaido for missing safe source. |
| Premium chat | Fixture handoff map complete. | No mutation opened. | Needs safe fixture rows before live QA. | Handoff to Viewer/QR2 after fixture prep. | Safe session/room rows required. |
| Payment/wallet | Out of this branch except mutation guard notes. | No payment code change. | No live payment QA run. | Viewer can inspect visual state only. | Real payment/refund/wallet mutation remains prohibited. |
| Debut | Auth dashboard includes identity notice. | Pending merge. | Pending deploy. | Needs safe debut fixture and provider policy confirmation. | Identity provider call prohibited without explicit task. |

Ping-pong rule: if the same source/main/live/mobile mismatch repeats three times, Cloud should stop local patching and hand the parity row to Chamo for prioritization or Jo for reflection/deploy.

# Emily i18n Copy Sweep - Tasks 1776 and 1779

Date: 2026-07-08 KST
Owner: Emily
Scope: AI content status copy, global mojibake/i18n sweep
Languages: `ko`, `en`, `ja`, `zh-Hans`, `zh-Hant`

## Task 1776 - AI Content Status Copy Matrix

Source surfaces:
- `server/src/ai-premium-content/ai-premium-content-state-contract.ts`
- `docs/ops/ai-premium-content-generation-contract-537.md`
- Future owner/admin request list, status sheet, result archive, retry CTA, cost/safety precheck messages

Do not expose these as visible copy:
- raw enum: `provider_failed`, `safety_blocked`, `needs_more_info`, `costCapExceeded`, `provider_unavailable`
- provider/model keys, moderation keys, cost policy keys
- raw prompt, provider payload, wallet ledger id, or any sensitive auth/connection material

Recommended visible status table:

| i18n key | Raw source states | Use location | ko | en | ja | zh-Hans | zh-Hant | Mobile limit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `aiPremiumContent.status.received` | `draft`, `submitted`, `needs_more_info` | request card/status pill | 접수됐어요 | Received | 受付済み | 已收到 | 已收到 | pill 8-14 chars |
| `aiPremiumContent.status.reviewing` | `awaiting_review`, moderation `pending/needs_review` | status pill, detail header | 검토 중이에요 | Under review | 確認中です | 审核中 | 審核中 | pill 8-16 chars |
| `aiPremiumContent.status.producing` | `queued`, `generating` | status pill/progress sheet | 제작 중이에요 | Creating | 制作中です | 制作中 | 製作中 | pill 8-16 chars |
| `aiPremiumContent.status.completed` | `approved`, result `approved` | result card/status pill | 준비됐어요 | Ready | 準備できました | 已就绪 | 已就緒 | pill 8-14 chars |
| `aiPremiumContent.status.blocked` | `safety_blocked`, `rejected`, moderation/result `blocked` | blocked card, safety sheet | 진행할 수 없어요 | Cannot continue | 続行できません | 无法继续 | 無法繼續 | wrap at 2 lines |
| `aiPremiumContent.status.failed` | `provider_failed`, result `failed` | failure card, retry area | 제작에 실패했어요 | Creation failed | 制作に失敗しました | 制作失败 | 製作失敗 | wrap at 2 lines |
| `aiPremiumContent.status.regeneratable` | retry available after failed/blocked result | retry CTA helper | 다시 요청할 수 있어요 | You can request again | 再リクエストできます | 可再次请求 | 可再次要求 | helper 28 chars ko max |
| `aiPremiumContent.status.neutralFallback` | unknown safe fallback | skeleton/loading | 상태를 확인 중이에요 | Checking status | 状態を確認中です | 正在确认状态 | 正在確認狀態 | helper 24 chars ko max |

Recommended reason/detail copy:

| i18n key | Raw trigger | ko | en | ja | zh-Hans | zh-Hant | Length/use note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `aiPremiumContent.safetyPrecheck.safe` | `safe` | 기준을 통과했어요. | Passed the checks. | 基準を通過しました。 | 已通过检查。 | 已通過檢查。 | detail one line |
| `aiPremiumContent.safetyPrecheck.reviewRequired` | `review_required` | 확인 후 진행할게요. | We will review it first. | 確認後に進めます。 | 将先审核后继续。 | 將先審核後繼續。 | avoid "moderation" |
| `aiPremiumContent.safetyPrecheck.blocked` | `blocked` | 안전 기준상 진행할 수 없어요. | This cannot continue under safety rules. | 安全基準により続行できません。 | 因安全规则无法继续。 | 因安全規則無法繼續。 | 2 lines max |
| `aiPremiumContent.safetyPrecheck.realPersonReviewRequired` | real person similarity | 인물 유사성 확인이 필요해요. | Likeness review is needed. | 人物類似性の確認が必要です。 | 需要确认人物相似性。 | 需要確認人物相似性。 | no identity guess |
| `aiPremiumContent.safetyPrecheck.copyrightReviewRequired` | copyright risk | 권리 확인이 필요해요. | Rights review is needed. | 権利確認が必要です。 | 需要版权确认。 | 需要版權確認。 | no legal verdict |
| `aiPremiumContent.precheck.costCapExceeded` | cost cap denied | 예상 제작 범위를 넘었어요. | This exceeds the estimate range. | 想定制作範囲を超えています。 | 超出预计制作范围。 | 超出預計製作範圍。 | no internal cost key |
| `aiPremiumContent.precheck.insufficientBalance` | wallet precheck denied | 잔액 확인 후 다시 시도해 주세요. | Check your balance and try again. | 残高を確認して再試行してください。 | 请确认余额后重试。 | 請確認餘額後重試。 | CTA helper |
| `aiPremiumContent.error.providerUnavailable` | provider unavailable/routing blocked | 제작 경로를 준비 중이에요. | The creation route is being prepared. | 制作ルートを準備中です。 | 制作路径准备中。 | 製作路徑準備中。 | do not name provider |
| `aiPremiumContent.error.retryLimitReached` | regeneration limit | 다시 요청할 수 있는 횟수를 모두 사용했어요. | No more retry requests are available. | 再リクエスト回数を使い切りました。 | 已用完再次请求次数。 | 已用完再次要求次數。 | 2 lines max |
| `aiPremiumContent.videoConsent.required` | video consent required | 영상 제작 비용 동의가 필요해요. | Video creation cost consent is required. | 動画制作費用の同意が必要です。 | 需要同意视频制作费用。 | 需要同意影片製作費用。 | status sheet |

Button/CTA copy:

| i18n key | ko | en | ja | zh-Hans | zh-Hant | Width note |
| --- | --- | --- | --- | --- | --- | --- |
| `aiPremiumContent.cta.viewStatus` | 상태 보기 | View status | 状態を見る | 查看状态 | 查看狀態 | 96px min |
| `aiPremiumContent.cta.retry` | 다시 요청 | Request again | 再リクエスト | 再次请求 | 再次要求 | 112px min |
| `aiPremiumContent.cta.openResult` | 결과 보기 | View result | 結果を見る | 查看结果 | 查看結果 | 104px min |
| `aiPremiumContent.cta.reviewGuide` | 안내 확인 | View guide | 案内を見る | 查看指南 | 查看指南 | 104px min |

Mobile wrapping guidance:
- Status pills should stay under 16 English characters or allow 2-line wrap at `min-width: 0`.
- CTA labels should fit in 112px at 13px bold. If a surface uses two CTAs side by side at 390px, stack them.
- Avoid combining status + reason in one pill. Use pill for state, helper line for reason.

## Task 1779 - Global Mojibake/i18n Sweep

Scanned source groups:
- `app.js`
- `pages/*.js`
- root page HTML and route `index.html` files
- `docs/ops/ai-premium-content-generation-contract-537.md`
- `server/src/ai-premium-content/*`
- `server/src/debut/*`
- `data/fan-engagement-copy.js`

Result:
- No current primary-source matches for common mixed-encoding fragments, the Unicode replacement-character marker `U+FFFD`, or common UTF-8 double-encoding patterns in the scanned high-priority files.
- The active risk is hardcoded Korean, English-only API labels, and Korean-only fallback maps on surfaces that are expected to support `ko/en/ja/zh-Hans/zh-Hant`.

Priority findings:

| Priority | Location | Issue | Recommended key/work |
| --- | --- | --- | --- |
| P0 | `server/src/ai-premium-content/ai-premium-content-state-contract.ts` | `AI_PREMIUM_CONTENT_STATUS_COPY_KO`, preview `labelKo`, and user-facing status fallback are Korean-only. | Add `aiPremiumContent.status.*`, `aiPremiumContent.preview.*`, `aiPremiumContent.precheck.*` 5-locale maps using Task 1776 table. |
| P0 | `app.js` auth modal | Login/register/reset modal strings are hardcoded Korean. Long labels can wrap poorly on 390px when localized later. | Split into `auth.modal.*` keys: tab labels, headings, field labels, helper text, submit buttons, resend verification, consent sentence. |
| P1 | `app.js` `statusMeta` | Character status labels are hardcoded Korean: public/debut/pending/secret/candidate. | Add `character.status.public/debut/pending/private/candidate.label` and `.summary`. |
| P1 | `pages/character-catalog.js` | `statusLabelMap` repeats Korean labels independently from `statusMeta`. | Reuse the same `character.status.*` map or derive from i18n helper. |
| P1 | `server/src/debut/debut.service.ts` | Debut owner status has `labelKo/defaultMessageKo` only, although `messageKey` exists. | Add 5-locale default copy for `debut.application.status.*` and `debut.application.cta.*`. |
| P1 | `server/src/debut/debut.service.ts` | Application channel/participation labels mix English `label` and Korean `labelKo`. | Add `labelKey/defaultCopy.{locale}` for `debut.applicationChannel.*` and `debut.participationType.*`. |
| P2 | `app.js` feed/profile modals | Feed edit/comment/lightbox/follow modal labels are hardcoded Korean. | Add `feed.modal.*`, `feed.comment.*`, `miniProfile.*` keys. |
| P2 | `pages/charge.js`, `pages/premium-chat-support.js`, `pages/creator-studio.js` | Payment/premium/creator status and disabled copy require follow-up line-length QA. | Add per-surface copy table after #1776 pattern; keep CTA text under 112px at 390px. |

Suggested common i18n namespace order:
1. `auth.modal.*`
2. `aiPremiumContent.status.*`
3. `aiPremiumContent.precheck.*`
4. `character.status.*`
5. `debut.application.status.*`
6. `feed.modal.*`
7. `charge.status.*`
8. `premiumChat.status.*`
9. `creatorStudio.status.*`

Handoff notes:
- 루피: apply user-visible UI keys first on auth, character status, and any AI content preview surface.
- 뷰어: after UI keying, verify 390px and 400px widths for status pill, CTA rows, modal headings, and helper text.
- 조로/클라우드: when reflecting to main/live, verify that raw enum/provider/moderation/cost keys are API-only and not visible copy.

Image/graphic copy summary:
- No bitmap or vector assets changed.
- Graphic/card text risk is limited to visible status chips, badges, and preview cards listed above.

Sensitive data rule:
- This sweep did not record sensitive auth/connection material, private provider payloads, or account fixture values.

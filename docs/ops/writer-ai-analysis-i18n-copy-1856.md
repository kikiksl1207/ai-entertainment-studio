# Writer AI Analysis Review Copy Contract (#1856)

## Scope

- Use location: the writer manuscript analysis page and the four-step completion review dialog planned by #1855.
- Locale slots: `ko`, `en`, `ja`, `zh-Hans`, `zh-Hant`. The application dictionary maps these to `ko-KR`, `en-US`, `ja-JP`, `zh-CN`, and `zh-Hant`.
- The `writerReview.*` names below are the canonical dictionary candidates. Until the UI is wired, they are copy-contract keys rather than visible strings.
- Never describe an AI suggestion as an automatic edit to the writer's manuscript. Keep `suggestion`, `original`, and `approved` visibly distinct.

## Analysis Questions And Status

| Key | Use location / source intent | ko | en | ja | zh-Hans | zh-Hant | Mobile limit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `writerReview.analysis.summary.title` | Analysis summary section heading | 요약 확인 | Review summary | 要約を確認 | 确认摘要 | 確認摘要 | 16 ko chars / 24 en chars |
| `writerReview.analysis.summary.body` | Explain that the summary is a reading aid, not a rewrite | AI가 읽은 흐름을 요약했습니다. 원문은 바뀌지 않습니다. | This is an AI reading summary. Your manuscript is unchanged. | AIが読んだ流れの要約です。原稿本文は変わりません。 | 这是 AI 阅读后的摘要，原稿不会被更改。 | 這是 AI 閱讀後的摘要，原稿不會被更改。 | 2 lines; 54 ko / 96 en chars |
| `writerReview.analysis.background.title` | Scene and background proposal section | 배경 제안 | Background suggestions | 背景の提案 | 背景建议 | 背景建議 | 18 ko / 28 en chars |
| `writerReview.analysis.background.body` | Explain proposed context is optional | 장면 이해를 돕는 제안입니다. 적용 전 원문을 확인하세요. | Suggestions to support the scene. Review the original before applying. | 場面理解を助ける提案です。反映前に原文を確認してください。 | 这是帮助理解场景的建议，应用前请确认原文。 | 這是幫助理解場景的建議，套用前請確認原文。 | 2 lines; 58 ko / 98 en chars |
| `writerReview.analysis.branch.title` | Alternative branch proposal section | 분기 추가 제안 | Branch suggestions | 分岐の追加提案 | 分支建议 | 分支建議 | 18 ko / 28 en chars |
| `writerReview.analysis.branch.body` | Explain alternate routes do not change current story | 현재 원고를 바꾸지 않는 대안 경로 제안입니다. | Alternative paths that do not change your current manuscript. | 現在の原稿を変えない代替ルートの提案です。 | 不会更改当前原稿的替代路线建议。 | 不會更改目前原稿的替代路線建議。 | 2 lines; 54 ko / 94 en chars |
| `writerReview.analysis.foreshadow.title` | Foreshadow candidate and importance selector | 떡밥 중요도 | Foreshadow importance | 伏線の重要度 | 伏笔重要度 | 伏筆重要度 | 14 ko / 24 en chars |
| `writerReview.analysis.foreshadow.body` | Explain importance is writer-owned | 나중에 회수할 계획이라면 중요도를 정해 주세요. | Set importance when you plan to resolve this later. | 後で回収する予定なら重要度を設定してください。 | 若计划在后文回收，请设置重要度。 | 若計畫在後文回收，請設定重要度。 | 2 lines; 46 ko / 82 en chars |
| `writerReview.analysis.conflict.title` | Continuity conflict question | 설정 충돌 확인 | Check continuity conflict | 設定の矛盾を確認 | 确认设定冲突 | 確認設定衝突 | 18 ko / 30 en chars |
| `writerReview.analysis.conflict.previousEvidence` | Earlier source evidence label | 이전 근거 | Earlier evidence | 過去の根拠 | 先前依据 | 先前依據 | 14 ko / 22 en chars |
| `writerReview.analysis.conflict.currentEvidence` | Current source evidence label | 현재 근거 | Current evidence | 現在の根拠 | 当前依据 | 目前依據 | 14 ko / 22 en chars |
| `writerReview.analysis.exception.title` | Intentional exception question | 의도된 예외인가요? | Is this intentional? | 意図した例外ですか？ | 这是有意的例外吗？ | 這是刻意的例外嗎？ | 18 ko / 30 en chars |
| `writerReview.analysis.exception.body` | Explain exception records the writer decision | 의도된 예외로 남기면 이후 검수에서 같은 충돌로 다시 묻지 않습니다. | Marking this as intentional records your decision and prevents the same question later. | 意図した例外として残すと、以後の確認で同じ矛盾を繰り返し尋ねません。 | 标记为有意例外后，后续审核不会再次询问同一冲突。 | 標記為刻意例外後，後續審核不會再次詢問相同衝突。 | 3 lines; 72 ko / 124 en chars |
| `writerReview.analysis.publishBlocked.title` | Publish-blocking critical issue | 발행 전 확인이 필요합니다 | Review required before publishing | 公開前に確認が必要です | 发布前需要确认 | 發布前需要確認 | 24 ko / 38 en chars |
| `writerReview.analysis.publishBlocked.body` | Blocker explanation | 치명적 충돌을 확인하거나 예외로 기록한 뒤 최종본을 올릴 수 있습니다. | Resolve the critical conflict or record an exception before uploading the final version. | 重大な矛盾を確認するか例外として記録すると、最終版をアップロードできます。 | 确认严重冲突或记录例外后，才能上传最终稿。 | 確認嚴重衝突或記錄例外後，才能上傳最終稿。 | 3 lines; 78 ko / 132 en chars |
| `writerReview.issue.critical` | Severity badge for a publish blocker | 치명적 확인 필요 | Critical review required | 重大な確認が必要 | 需要严重确认 | 需要嚴重確認 | 16 ko / 28 en chars |
| `writerReview.issue.warning` | Severity badge for a non-blocking review item | 확인 권장 | Review recommended | 確認を推奨 | 建议确认 | 建議確認 | 14 ko / 24 en chars |
| `writerReview.source.original` | Label beside preserved writer text | 원문 | Original | 原文 | 原文 | 原文 | 8 ko / 14 en chars |
| `writerReview.source.suggestion` | Label beside AI proposal | AI 제안 | AI suggestion | AIの提案 | AI 建议 | AI 建議 | 10 ko / 18 en chars |
| `writerReview.source.approved` | Label after writer approval only | 승인 후 반영 | Applied after approval | 承認後に反映 | 批准后应用 | 核准後套用 | 16 ko / 28 en chars |

## Question Actions

| Key | ko | en | ja | zh-Hans | zh-Hant | Mobile limit |
| --- | --- | --- | --- | --- | --- | --- |
| `writerReview.action.confirm` | 확인 | Confirm | 確認 | 确认 | 確認 | 8 ko / 14 en chars |
| `writerReview.action.edit` | 수정 | Edit | 修正 | 修改 | 修改 | 8 ko / 14 en chars |
| `writerReview.action.delete` | 삭제 | Delete | 削除 | 删除 | 刪除 | 8 ko / 14 en chars |
| `writerReview.action.important` | 중요함 | Important | 重要 | 重要 | 重要 | 10 ko / 16 en chars |
| `writerReview.action.hold` | 보류 | Hold | 保留 | 暂缓 | 暫緩 | 8 ko / 14 en chars |
| `writerReview.action.intentionalException` | 의도된 예외로 기록 | Mark as intentional | 意図した例外として記録 | 记录为有意例外 | 記錄為刻意例外 | 18 ko / 30 en chars |
| `writerReview.action.aiMistake` | AI 오판으로 표시 | Mark as AI mistake | AIの誤判定として記録 | 标记为 AI 误判 | 標記為 AI 誤判 | 18 ko / 30 en chars |

## Completion Review Dialog

| Key | Use location / original | ko | en | ja | zh-Hans | zh-Hant | Mobile limit |
| --- | --- | --- | --- | --- | --- | --- |
| `writerReview.dialog.step.summary` | Step 1 heading: analysis summary | 분석 요약 | Analysis summary | 分析の要約 | 分析摘要 | 分析摘要 | 16 ko / 24 en chars |
| `writerReview.dialog.step.story` | Step 2 heading: story and branch suggestions | 이야기 제안 | Story suggestions | 物語の提案 | 故事建议 | 故事建議 | 16 ko / 24 en chars |
| `writerReview.dialog.step.continuity` | Step 3 heading: continuity review | 설정 검수 | Continuity review | 設定の確認 | 设定审核 | 設定審核 | 16 ko / 24 en chars |
| `writerReview.dialog.step.final` | Step 4 heading: final confirmation | 최종 확인 | Final confirmation | 最終確認 | 最终确认 | 最終確認 | 16 ko / 28 en chars |
| `writerReview.dialog.backToManuscript` | Return without upload | 원고로 돌아가기 | Back to manuscript | 原稿に戻る | 返回原稿 | 返回原稿 | 18 ko / 28 en chars |
| `writerReview.dialog.analyzeAgain` | Rerun analysis; does not upload | 다시 분석 | Analyze again | もう一度分析 | 再次分析 | 再次分析 | 14 ko / 22 en chars |
| `writerReview.dialog.noIssuesConfirm` | Confirm zero unresolved issues | 이상 없음, 최종 확인 | No issues, confirm final | 問題なし、最終確認 | 无问题，确认最终稿 | 無問題，確認最終稿 | 22 ko / 34 en chars |
| `writerReview.dialog.uploadFinal` | Final upload CTA after all gates clear | 최종본 올리기 | Upload final version | 最終版をアップロード | 上传最终稿 | 上傳最終稿 | 18 ko / 30 en chars |

## Wiring And QA Notes

- Map all keys to the existing dictionary locale slots only; do not invent a sixth locale or fall back from `zh-Hant` to `zh-Hans`.
- Keep action controls to a single line at 390px. For the two long exception actions, use a full-width secondary row rather than shrinking below the existing button typography.
- Render a critical issue before warnings and preserve both `previousEvidence` and `currentEvidence` labels with their source excerpts. Do not turn evidence into developer metadata or raw JSON.
- In the four-step dialog, 390px and 400px should use a full-screen dialog. The primary CTA stays pinned above the bottom safe area; the title and warning copy must scroll independently rather than overlap the CTA.
- No image or graphic asset is changed by this copy contract. Representative update summary: the review language now makes AI suggestions, original manuscript text, and writer-approved changes visibly different in all five locales.

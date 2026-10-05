(function initCreatorStoryFinalization() {
  "use strict";
  const api = window.LuminaCreatorStudioApi;
  const analysis = window.LuminaCreatorAnalysis;
  const entry = document.getElementById("writerFinalEntry");
  if (!api || !analysis || !entry) return;
  const root = "/api/v1/me/creator-studio";
  const modal = document.getElementById("writerFinalModal");
  const parts = document.getElementById("writerFinalParts");
  const issues = document.getElementById("writerFinalIssues");
  const summary = document.getElementById("writerFinalSummary");
  const proposals = document.getElementById("writerFinalProposals");
  const profileStatus = document.getElementById("writerFinalProfileStatus");
  const stage = document.getElementById("writerFinalStage");
  const state = document.getElementById("writerFinalState");
  const entryState = document.getElementById("writerFinalEntryState");
  const prepare = document.getElementById("writerFinalPrepare");
  const checks = ["Reviewed", "Rights", "Ai", "Warnings"].map(name => document.getElementById("writerFinal" + name));
  const stageChecks = ["SummaryReviewed", "ProposalReviewed", "ContinuityReviewed"].map(name => document.getElementById("writerFinal" + name));
  const profileKeys = ["writing_style", "scene_scale", "canon", "timeline", "visual_direction",
    "visual_cast", "narrative_devices", "branch_behavior"];
  const reviewSteps = {
    analysis_ready: { next: "summary_review", check: 0, label: "stepSummary", button: "confirmSummary" },
    summary_review: { next: "proposal_review", check: 1, label: "stepProposal", button: "confirmProposal" },
    proposal_review: { next: "continuity_review", check: 2, label: "stepContinuity", button: "confirmContinuity" },
    continuity_review: { next: "final_confirmation", label: "stepRights", button: "toFinal" }
  };
  const copy = {
    ko: {
      companySubmitted: "회사 위임 · 원고 제출 완료",
      entryTitle: "원고 최종 검토", entryIntro: "원래 이야기의 다음 경로와 AI 분기 권리를 확인하면 각 파트의 선택지 준비를 비공개로 요청합니다. 다시 열어 진행 상태를 확인할 수 있습니다.", open: "최종 검토 열기",
      eyebrow: "작가 확인", title: "원고와 원작 경로 최종 검토", close: "닫기", later: "나중에",
      intro: "분석 요약과 분기 제안, 설정 충돌을 차례로 검토해 주세요. 마지막 확정 후 선택지 3개를 서버에서 비공개로 준비합니다.",
      summaryTitle: "원고 분석 요약", proposalTitle: "분기 방향 제안과 원작 경로", continuityTitle: "설정 충돌", confirmationTitle: "최종 확인",
      summaryReviewed: "위 원고 분석 요약을 확인했습니다.", proposalReviewed: "위 분기 제안과 원작 경로를 확인했습니다.", warningsReviewed: "위 분석 경고를 확인했습니다.", continuityReviewed: "위 설정 충돌 검토 결과를 확인했습니다.",
      reviewed: "원고, 분석 결과와 모든 파트의 원작 경로를 검토했습니다.", rights: "이 원고의 권리를 보유하고 있으며 서비스 이용을 승인합니다.", ai: "원고 문체를 참고한 AI 분기 생성과 검수된 결과의 재사용을 승인합니다.",
      writing_style: "작가 문체", scene_scale: "장면 분량", canon: "세계관과 고정 설정", timeline: "시간 흐름", visual_direction: "배경과 그림 분위기", visual_cast: "등장인물 외형", narrative_devices: "복선과 회수", branch_behavior: "선택 후 전개",
      profileApproved: "이 원고에 적용된 생성 설정입니다.", profilePending: "아직 승인되지 않은 AI 분석 제안입니다. 이 화면을 닫고 생성 설정 검토에서 수정·승인해야 최종 확정할 수 있습니다.", removed: "작가가 제외한 항목입니다.", profileDetail: "세부 내용은 생성 설정 화면에서 확인해 주세요.", evidence: "분석 근거 보기", evidenceFallback: "원고 분석 근거",
      blocked: "차단", warning: "주의", noIssues: "현재 표시할 열린 설정 충돌이 없습니다.", originalRoute: "원작 경로: {title}", authoredEnding: "원작 경로: 작가가 쓴 엔딩", choiceLabel: "1번 선택 문구 (선택 입력)", choiceAria: "{title} 원작 경로 선택 문구",
      stepSummary: "1/5 원고 분석 요약 확인", stepProposal: "2/5 분기 제안과 원작 경로 확인", stepContinuity: "3/5 설정 충돌 확인", stepRights: "4/5 권리와 원고 최종 확인", stepFinal: "5/5 최종 확정", stepChoices: "선택지 준비", stepReady: "선택지 준비 완료",
      confirmSummary: "분석 요약 확인", confirmProposal: "분기 제안 확인", confirmContinuity: "설정 충돌 확인", toFinal: "최종 확인 단계로", prepare: "최종 확정하고 선택지 준비", retry: "선택지 준비 다시 시도",
      stepChoiceReview: "선택지 재검토", resetChoices: "선택지 초기화",
      choiceInterrupted: "서버 중단 후 {done} / {total}파트가 저장되어 있습니다. 이전 AI 요청의 결과와 비용을 확인할 수 없어 자동으로 다시 생성하지 않습니다. 확인 후 다시 시도하면 추가 비용이 발생할 수 있습니다.",
      choiceConsentChanged: "권리 승인 내용이 갱신되었습니다. 아래에서 저장된 선택지를 확인하고 현재 승인 기준으로 다시 승인해 주세요. AI 생성은 시작하지 않습니다.",
      choiceReviewUnavailable: "선택지와 현재 설정의 검토 상태를 확인할 수 없습니다. 준비 완료로 확정하거나 AI 생성을 다시 시도할 수 없습니다. 창을 다시 열어 확인해 주세요.",
      choiceSettingsChanged: "생성 설정이 변경되었습니다. 이전 설정의 AI 선택지가 있는 {count}개 장면을 초기화해야 합니다. 원고·원작 경로와 현재 설정의 선택지는 보존됩니다. 초기화만으로는 AI 생성이나 비용이 발생하지 않습니다.",
      choiceSettingsConsentChanged: "현재 권리 승인이 갱신되고 작가 문체가 변경되었습니다. {count}개 장면에서 이전 문체의 AI 선택지 또는 현재 권리 기준으로 재승인되지 않은 AI 선택지를 보관한 뒤 비웁니다. 원문과 원작 경로는 보존됩니다. AI 생성은 시작하지 않으며 비용이 발생하지 않습니다. 이후 AI 생성에는 별도의 비용 발생 가능성 확인이 필요합니다.",
      choiceConsentResetWaiting: "현재 권리 승인이 갱신되고 작가 문체가 변경되었지만 선택지 작업이 진행 중이어서 지금은 초기화할 수 없습니다. AI 생성이나 비용 발생을 시작하지 않습니다. 작업이 멈춘 뒤 창을 다시 열어 확인해 주세요.",
      resetConsentConfirm: "현재 권리 승인이 갱신되고 작가 문체가 변경되었습니다. 현재 권리 기준으로 {count}개 장면의 이전 문체 AI 선택지 또는 재승인되지 않은 AI 선택지를 보관한 뒤 비울까요? 원문과 원작 경로는 보존됩니다. AI 생성은 시작하지 않으며 비용이 발생하지 않습니다. 이후 생성하려면 다시 시도를 별도로 누르고 비용 발생 가능성을 따로 확인해야 합니다.",
      resettingConsentChoices: "이전 문체 또는 미재승인 AI 선택지를 보관한 뒤 비우고 있습니다. 원문과 원작 경로는 보존되며 AI 생성이나 비용 발생을 시작하지 않습니다.",
      choiceResetWaiting: "생성 설정이 변경되었지만 선택지 작업이 진행 중이어서 지금은 초기화할 수 없습니다. 작업이 멈춘 뒤 창을 다시 열어 확인해 주세요.",
      choiceApprovalRequired: "생성 설정을 먼저 수정·승인해 주세요. 이 창을 닫고 생성 설정 검토를 완료한 뒤 다시 열어 선택지를 재검토해 주세요.",
      choiceBlocked: "현재 선택지는 초기화하거나 다시 생성할 수 없습니다. 원고·권리·검토 상태를 확인하고, 문제가 계속되면 운영자에게 문의해 주세요.",
      choiceResetReady: "선택지 초기화가 완료되었으며 원고와 원작 경로는 보존되었습니다. AI 생성은 시작하지 않았습니다. 다음 ‘선택지 준비 다시 시도’를 별도로 눌러 확인하면 AI 생성 요청이 대기열에 등록될 수 있고 비용이 발생할 수 있습니다.",
      resetConfirm: "생성 설정이 변경되었습니다. 이전 설정의 AI 선택지가 있는 {count}개 장면을 초기화할까요? 원고·원작 경로와 현재 설정의 선택지는 보존됩니다. AI 생성은 시작하지 않으며 비용이 발생하지 않습니다. 생성하려면 이후 별도로 다시 시도해야 합니다.",
      retryConfirm: "선택지 준비를 다시 시도할까요? 이 확인 후 AI 생성 요청이 대기열에 등록될 수 있고 비용이 발생할 수 있습니다. 원고와 원작 경로는 보존됩니다.",
      resettingChoices: "이전 설정의 AI 선택지만 초기화하고 있습니다. AI 생성은 시작하지 않습니다.", resetUnconfirmed: "선택지 초기화 결과를 확인할 수 없습니다. AI 재시도는 시작하지 않았습니다. 창을 다시 열어 확인해 주세요.",
      choiceReady: "선택지 3개가 모두 준비되어 있습니다. 이 원고는 아직 비공개입니다.", choiceFailed: "AI 선택지 준비가 {done} / {total}파트에서 멈췄습니다. 확인 후 다시 시도할 수 있습니다.", choiceQueued: "AI 선택지 준비가 대기 중입니다: {done} / {total}. 계속 대기하면 운영자에게 문의해 주세요.", choiceWorking: "서버에서 AI 선택지를 처리 중입니다: {done} / {total}. 다시 열어 진행 상태를 확인할 수 있습니다.", choicePaused: "선택지 준비 작업이 대기 중입니다: {done} / {total}. 서버 작업자가 사용 불가하여 운영자 설정이 필요합니다.", choicePending: "원작 경로를 확인해 주세요. 1번 문구를 비워두면 원고를 바탕으로 AI가 제안합니다.", resumeSubmitted: "원고 제출이 저장되었습니다. 아래 권리와 AI 승인 항목을 확인하고 비공개 준비를 이어가세요.",
      loading: "원고와 검토 상태를 확인하고 있습니다.", analysisMissing: "현재 원고의 분석 결과를 확인할 수 없습니다.", profileMissing: "현재 원고의 생성 설정을 확인할 수 없습니다.", issuesTruncated: "분석 경고가 너무 많아 이 화면에서 모두 확인할 수 없습니다. 운영 검토가 필요합니다.", criticalIssues: "심각한 설정 충돌이 남아 있습니다. 분석 내용을 수정한 뒤 다시 검토해 주세요.", startReview: "분석 요약과 분기 제안을 확인한 뒤 단계별로 검토해 주세요.",
      invalidRoute: "직접 입력할 때는 다음/Continue 대신 해당 장면의 구체적인 선택을 적어주세요.", finalChecks: "원작 경로와 검토·권리·AI 승인 항목을 확인해 주세요.", reviewChanged: "검토 내용이 변경되었습니다. 창을 다시 열어 최신 내용을 확인해 주세요.", stepCheck: "현재 단계의 분석 내용을 확인한 뒤 확인란을 선택해 주세요.", warningCheck: "표시된 설정 경고를 먼저 확인해 주세요.", stepChanged: "검토 단계가 변경되었습니다. 다시 열어 확인해 주세요.", stepSaveFailed: "검토 단계 저장 결과를 확인할 수 없습니다.", finalStepSaved: "검토 내용이 저장되었습니다. 최종 확정 버튼을 다시 눌러 원고를 제출하고 선택지 준비를 시작해 주세요.", stepSaved: "현재 단계의 확인이 저장되었습니다. 다음 검토 내용을 확인해 주세요.",
      submitting: "작가의 최종 확정을 기록하고 있습니다.", submitUnconfirmed: "원고 제출 상태를 확인할 수 없습니다.", savingConsent: "원고 권리와 AI 분기 승인을 저장하고 있습니다.", materializing: "원고를 비공개 장면으로 정리하고 있습니다.", materializeUnconfirmed: "비공개 장면의 준비 상태를 확인할 수 없습니다.", jobUnconfirmed: "서버의 선택지 준비 작업을 확인할 수 없습니다. 아래 항목을 확인하고 다시 시도해 주세요.", choiceUnverified: "선택지 작업은 완료로 표시되지만 최종 준비 상태가 확인되지 않았습니다. 다시 열어 확인하고 계속되면 운영자에게 문의해 주세요.", failureRetain: "{reason} 준비된 파트는 보존됩니다. 다시 열어 이어서 진행해 주세요.", manuscriptChanged: "원고 또는 계정이 변경되었습니다.", requestFailed: "요청을 완료하지 못했습니다. 다시 시도해 주세요."
    },
    en: {
      companySubmitted: "Company delegation · Manuscript submitted",
      entryTitle: "Final manuscript review", entryIntro: "Confirm the original story path and AI branching rights to request private choice preparation. Reopen to check progress.", open: "Open final review",
      eyebrow: "Author confirmation", title: "Final review of manuscript and original path", close: "Close", later: "Later",
      intro: "Review the analysis summary, branch proposals, and continuity issues in order. After final confirmation, the server privately prepares all three choices.",
      summaryTitle: "Manuscript analysis summary", proposalTitle: "Branch proposals and original path", continuityTitle: "Continuity issues", confirmationTitle: "Final confirmation",
      summaryReviewed: "I reviewed the analysis summary above.", proposalReviewed: "I reviewed the branch proposals and original path above.", warningsReviewed: "I reviewed the analysis warnings above.", continuityReviewed: "I reviewed the continuity findings above.",
      reviewed: "I reviewed the manuscript, analysis, and original path for every part.", rights: "I hold the rights to this manuscript and authorize its use in the service.", ai: "I authorize AI branches based on this manuscript's style and reuse of reviewed results.",
      writing_style: "Writing style", scene_scale: "Scene length", canon: "Canon and world rules", timeline: "Timeline", visual_direction: "Background and visual mood", visual_cast: "Character appearance", narrative_devices: "Foreshadowing and payoff", branch_behavior: "Branch behavior",
      profileApproved: "Generation settings applied to this manuscript.", profilePending: "These AI analysis proposals are not approved yet. Close this screen and edit and approve them in Generation settings review before finalizing.", removed: "The author excluded this item.", profileDetail: "See Generation settings for details.", evidence: "View supporting analysis", evidenceFallback: "Manuscript analysis evidence",
      blocked: "Blocking", warning: "Warning", noIssues: "No open continuity issues to show.", originalRoute: "Original path: {title}", authoredEnding: "Original path: author's ending", choiceLabel: "Choice 1 wording (optional)", choiceAria: "{title} original-path choice wording",
      stepSummary: "1/5 Review analysis summary", stepProposal: "2/5 Review branch proposals and original path", stepContinuity: "3/5 Review continuity issues", stepRights: "4/5 Confirm rights and manuscript", stepFinal: "5/5 Final confirmation", stepChoices: "Preparing choices", stepReady: "Choices prepared",
      confirmSummary: "Confirm analysis summary", confirmProposal: "Confirm branch proposals", confirmContinuity: "Confirm continuity review", toFinal: "Continue to final confirmation", prepare: "Finalize and prepare choices", retry: "Retry choice preparation",
      stepChoiceReview: "Choice re-review", resetChoices: "Reset outdated choices",
      choiceInterrupted: "{done} / {total} parts are saved after a server interruption. The previous AI result and cost are unconfirmed, so generation will not retry automatically. Retrying after review may incur another cost.",
      choiceConsentChanged: "Rights approval was renewed. Review the saved choices below and approve them under the current consent. AI generation will not start.",
      choiceReviewUnavailable: "Could not verify choices against current settings. Readiness and AI retry are unavailable. Reopen this screen to check again.",
      choiceSettingsChanged: "Generation settings changed. Outdated AI choices in {count} scenes need resetting. The manuscript, original paths, and current-settings choices are preserved. Resetting alone does not start AI generation or incur a cost.",
      choiceSettingsConsentChanged: "Current rights approval was renewed and the writer style changed. Outdated-style AI choices or AI choices not reapproved under the current rights in {count} scenes will be archived and cleared. Original prose and original paths are preserved. No AI generation starts and no cost is incurred. Later AI generation requires a separate possible-cost confirmation.",
      choiceConsentResetWaiting: "Current rights approval was renewed and the writer style changed, but a choice job is active, so resetting is unavailable. No AI generation or cost starts. Reopen this screen after the job stops.",
      resetConsentConfirm: "Current rights approval was renewed and the writer style changed. Under the current rights, archive and clear outdated-style AI choices or AI choices not reapproved in {count} scenes? Original prose and original paths are preserved. No AI generation starts and no cost is incurred. Later generation requires another Retry click and a separate possible-cost confirmation.",
      resettingConsentChoices: "Archiving and clearing outdated-style or unapproved AI choices. Original prose and original paths are preserved. No AI generation or cost starts.",
      choiceResetWaiting: "Generation settings changed, but a choice job is active, so resetting is unavailable. Reopen this screen after the job stops.",
      choiceApprovalRequired: "Edit and approve generation settings first. Close this screen, complete Generation settings review, then reopen to re-review choices.",
      choiceBlocked: "Choices cannot be reset or regenerated right now. Check the manuscript, rights, and review status; contact an operator if this persists.",
      choiceResetReady: "Choices were reset; the manuscript and original paths are preserved. AI generation has not started. Separately click Retry choice preparation and confirm to request AI generation, which may be queued and may incur a cost.",
      resetConfirm: "Generation settings changed. Reset outdated AI choices in {count} scenes? The manuscript, original paths, and current-settings choices are preserved. No AI generation starts and no cost is incurred. Generation requires a separate retry afterwards.",
      retryConfirm: "Retry choice preparation? Confirming requests AI generation, which may be queued and may incur a cost. The manuscript and original paths are preserved.",
      resettingChoices: "Resetting only outdated AI choices. AI generation is not starting.", resetUnconfirmed: "Could not verify the reset result. AI retry has not started. Reopen this screen to check.",
      choiceReady: "All three choices are prepared. This manuscript is still private.", choiceFailed: "AI choice preparation stopped at part {done} / {total}. Review and retry when ready.", choiceQueued: "AI choice preparation is queued: {done} / {total}. Contact an operator if it stays queued.", choiceWorking: "The server is processing AI choices: {done} / {total}. Reopen to check progress.", choicePaused: "Choice preparation is waiting: {done} / {total}. The server worker is unavailable and needs operator setup.", choicePending: "Check the original path. Leave choice 1 blank for an AI suggestion based on the manuscript.", resumeSubmitted: "Manuscript submission is saved. Confirm the rights and AI consent items below to resume private preparation.",
      loading: "Checking the manuscript and review status.", analysisMissing: "Could not verify the analysis for this manuscript.", profileMissing: "Could not verify generation settings for this manuscript.", issuesTruncated: "There are too many analysis warnings to show here. An operations review is required.", criticalIssues: "Blocking continuity issues remain. Revise the analysis and review again.", startReview: "Review the analysis summary and branch proposals, then complete each step.",
      invalidRoute: "When entering a label, use a specific choice instead of Next or Continue.", finalChecks: "Confirm the original paths and all review, rights, and AI consent items.", reviewChanged: "The review content changed. Reopen this screen to see the latest version.", stepCheck: "Review this step's analysis and select its checkbox.", warningCheck: "Review the displayed continuity warnings first.", stepChanged: "The review step changed. Reopen this screen to check it.", stepSaveFailed: "Could not verify the saved review step.", finalStepSaved: "Review saved. Press Finalize again to submit the manuscript and start private choice preparation.", stepSaved: "This step was saved. Review the next step.",
      submitting: "Recording the author's final confirmation.", submitUnconfirmed: "Could not verify manuscript submission.", savingConsent: "Saving manuscript rights and AI branch consent.", materializing: "Preparing private scenes from the manuscript.", materializeUnconfirmed: "Could not verify private scene preparation.", jobUnconfirmed: "Could not verify the choice-preparation job. Confirm the items below and retry.", choiceUnverified: "The job reports completion, but final readiness is unverified. Reopen to check; contact an operator if it persists.", failureRetain: "{reason} Prepared parts are preserved. Reopen this screen to continue.", manuscriptChanged: "The manuscript or account changed.", requestFailed: "Could not complete the request. Please try again."
    },
    ja: {
      companySubmitted: "会社委任 · 原稿提出完了",
      entryTitle: "原稿の最終確認", entryIntro: "原作の次の経路とAI分岐の権利を確認し、非公開の選択肢準備を依頼します。再度開いて進行状況を確認できます。", open: "最終確認を開く",
      eyebrow: "作者の確認", title: "原稿と原作経路の最終確認", close: "閉じる", later: "あとで", intro: "分析概要、分岐案、設定の矛盾を順に確認してください。最終確定後、3つの選択肢をサーバーで非公開のまま準備します。",
      summaryTitle: "原稿分析の概要", proposalTitle: "分岐案と原作経路", continuityTitle: "設定の矛盾", confirmationTitle: "最終確認",
      summaryReviewed: "上記の分析概要を確認しました。", proposalReviewed: "上記の分岐案と原作経路を確認しました。", warningsReviewed: "上記の分析上の警告を確認しました。", continuityReviewed: "上記の設定の矛盾に関する確認結果を確認しました。",
      reviewed: "原稿、分析結果、全パートの原作経路を確認しました。", rights: "この原稿の権利を保有し、サービスでの利用を承認します。", ai: "原稿の文体を参考にしたAI分岐の生成と、確認済みの結果の再利用を承認します。",
      writing_style: "作家の文体", scene_scale: "場面の分量", canon: "世界観と固定設定", timeline: "時間の流れ", visual_direction: "背景と画面の雰囲気", visual_cast: "登場人物の外見", narrative_devices: "伏線と回収", branch_behavior: "選択後の展開",
      profileApproved: "この原稿に適用された生成設定です。", profilePending: "AI分析案はまだ承認されていません。この画面を閉じ、生成設定の確認画面で修正・承認してから最終確定してください。", removed: "作者が除外した項目です。", profileDetail: "詳細は生成設定画面で確認してください。", evidence: "分析根拠を見る", evidenceFallback: "原稿分析の根拠",
      blocked: "ブロック", warning: "注意", noIssues: "表示する未解決の設定の矛盾はありません。", originalRoute: "原作経路: {title}", authoredEnding: "原作経路: 作者が書いた結末", choiceLabel: "選択肢1の文言（任意）", choiceAria: "{title} 原作経路の選択肢の文言",
      stepSummary: "1/5 分析概要の確認", stepProposal: "2/5 分岐案と原作経路の確認", stepContinuity: "3/5 設定の矛盾の確認", stepRights: "4/5 権利と原稿の最終確認", stepFinal: "5/5 最終確定", stepChoices: "選択肢の準備", stepReady: "選択肢の準備完了",
      confirmSummary: "分析概要を確認", confirmProposal: "分岐案を確認", confirmContinuity: "設定の矛盾を確認", toFinal: "最終確認へ", prepare: "確定して選択肢を準備", retry: "選択肢の準備を再試行",
      stepChoiceReview: "選択肢の再確認", resetChoices: "旧設定の選択肢をリセット",
      choiceInterrupted: "サーバー中断後、{done} / {total} パートを保存済みです。前のAI結果と費用が未確認のため、自動再生成は行いません。確認後の再試行には追加費用が発生する場合があります。",
      choiceConsentChanged: "権利の承認内容が更新されました。保存済みの選択肢を下で確認し、現在の同意に基づいて再承認してください。AI生成は開始しません。",
      choiceReviewUnavailable: "現在の設定と選択肢の確認状態を検証できません。準備完了の確定やAI再試行はできません。画面を開き直してください。",
      choiceSettingsChanged: "生成設定が変更されました。旧設定のAI選択肢がある {count} 場面をリセットする必要があります。原稿・原作経路と現設定の選択肢は保持されます。リセットだけではAI生成や費用は発生しません。",
      choiceSettingsConsentChanged: "現在の権利承認が更新され、作家の文体が変更されました。{count} 場面の旧文体のAI選択肢、または現在の権利に基づいて再承認されていないAI選択肢をアーカイブして消去します。原文と原作経路は保持されます。AI生成は開始せず、費用も発生しません。その後のAI生成には費用が発生する可能性の別途確認が必要です。",
      choiceConsentResetWaiting: "現在の権利承認が更新され、作家の文体が変更されましたが、選択肢の処理中のためリセットできません。AI生成や費用は発生しません。処理が停止してから画面を開き直してください。",
      resetConsentConfirm: "現在の権利承認が更新され、作家の文体が変更されました。現在の権利に基づき、{count} 場面の旧文体のAI選択肢または未再承認のAI選択肢をアーカイブして消去しますか？原文と原作経路は保持されます。AI生成は開始せず、費用も発生しません。その後の生成には再試行を別途押し、費用が発生する可能性を個別に確認する必要があります。",
      resettingConsentChoices: "旧文体または未再承認のAI選択肢をアーカイブして消去しています。原文と原作経路は保持され、AI生成や費用は発生しません。",
      choiceResetWaiting: "生成設定が変更されましたが、選択肢の処理中のためリセットできません。処理が停止してから画面を開き直してください。",
      choiceApprovalRequired: "先に生成設定を修正・承認してください。この画面を閉じ、生成設定の確認を完了してから選択肢を再確認してください。",
      choiceBlocked: "現在、選択肢のリセットや再生成はできません。原稿・権利・確認状態を調べ、問題が続く場合は運営者にお問い合わせください。",
      choiceResetReady: "選択肢をリセットしました。原稿と原作経路は保持され、AI生成は開始していません。別途「選択肢の準備を再試行」を押して確認するとAI生成を依頼します。処理が待機になり、費用が発生する場合があります。",
      resetConfirm: "生成設定が変更されました。旧設定のAI選択肢がある {count} 場面をリセットしますか？原稿・原作経路と現設定の選択肢は保持されます。AI生成は開始せず、費用も発生しません。生成には別途再試行が必要です。",
      retryConfirm: "選択肢の準備を再試行しますか？確認するとAI生成を依頼します。処理が待機になり、費用が発生する場合があります。原稿と原作経路は保持されます。",
      resettingChoices: "旧設定のAI選択肢のみをリセットしています。AI生成は開始しません。", resetUnconfirmed: "リセット結果を確認できません。AI再試行は開始していません。画面を開き直してください。",
      choiceReady: "3つの選択肢がすべて準備できました。この原稿はまだ非公開です。", choiceFailed: "AI選択肢の準備が {done} / {total} パートで停止しました。確認後、再試行できます。", choiceQueued: "AI選択肢の準備は待機中です: {done} / {total}。待機が続く場合は運営者にお問い合わせください。", choiceWorking: "サーバーでAI選択肢を処理中です: {done} / {total}。再度開いて進行状況を確認できます。", choicePaused: "選択肢の準備は待機中です: {done} / {total}。サーバーの作業機能を運営者が設定する必要があります。", choicePending: "原作経路を確認してください。1番の文言を空欄にすると、原稿を基にAIが提案します。", resumeSubmitted: "原稿の提出は保存されています。下記の権利とAI承認を確認し、非公開の準備を続けてください。",
      loading: "原稿と確認状況を調べています。", analysisMissing: "現在の原稿の分析結果を確認できません。", profileMissing: "現在の原稿の生成設定を確認できません。", issuesTruncated: "分析上の警告が多すぎて、ここではすべて表示できません。運営側の確認が必要です。", criticalIssues: "重大な設定の矛盾が残っています。分析内容を修正して再確認してください。", startReview: "分析概要と分岐案を確認し、各段階を進めてください。",
      invalidRoute: "文言を入力する場合は、次へ/Continue ではなく場面に固有の選択にしてください。", finalChecks: "原作経路と確認・権利・AI承認項目をすべて確認してください。", reviewChanged: "確認内容が変更されました。画面を開き直して最新版を確認してください。", stepCheck: "この段階の分析内容を確認し、チェックを入れてください。", warningCheck: "表示された設定上の警告を先に確認してください。", stepChanged: "確認段階が変わりました。開き直して確認してください。", stepSaveFailed: "確認段階の保存結果を確認できません。", finalStepSaved: "確認内容を保存しました。もう一度確定ボタンを押すと、原稿を提出して非公開の選択肢の準備を始めます。", stepSaved: "この段階の確認を保存しました。次の内容を確認してください。",
      submitting: "作者の最終確定を記録しています。", submitUnconfirmed: "原稿の提出状態を確認できません。", savingConsent: "原稿の権利とAI分岐の承認を保存しています。", materializing: "原稿を非公開の場面として整理しています。", materializeUnconfirmed: "非公開の場面の準備状態を確認できません。", jobUnconfirmed: "選択肢準備ジョブを確認できません。下記の項目を確認して再試行してください。", choiceUnverified: "ジョブは完了と表示されていますが、最終準備状態を確認できません。再度開いて確認し、続く場合は運営者にお問い合わせください。", failureRetain: "{reason} 準備済みのパートは保持されます。開き直して続行してください。", manuscriptChanged: "原稿またはアカウントが変更されました。", requestFailed: "リクエストを完了できませんでした。もう一度お試しください。"
    },
    "zh-Hans": {
      companySubmitted: "公司委托 · 稿件已提交",
      entryTitle: "稿件最终核对", entryIntro: "确认原故事的后续路径和 AI 分支授权后，将提交非公开的选项准备请求。可重新打开查看进度。", open: "打开最终核对",
      eyebrow: "作者确认", title: "稿件与原作路径最终核对", close: "关闭", later: "稍后", intro: "请依次核对分析摘要、分支建议和设定冲突。最终确认后，服务器会私下准备三个选项。",
      summaryTitle: "稿件分析摘要", proposalTitle: "分支建议与原作路径", continuityTitle: "设定冲突", confirmationTitle: "最终确认",
      summaryReviewed: "我已核对上述分析摘要。", proposalReviewed: "我已核对上述分支建议与原作路径。", warningsReviewed: "我已核对上述分析警告。", continuityReviewed: "我已核对上述设定冲突的检查结果。",
      reviewed: "我已核对稿件、分析结果及所有部分的原作路径。", rights: "我拥有此稿件的权利，并授权在服务中使用。", ai: "我授权参考稿件文风生成 AI 分支，并复用经审核的结果。",
      writing_style: "作者文风", scene_scale: "场景篇幅", canon: "世界观与固定设定", timeline: "时间线", visual_direction: "背景与画面氛围", visual_cast: "人物外观", narrative_devices: "伏笔与回收", branch_behavior: "选择后的发展",
      profileApproved: "已应用到此稿件的生成设置。", profilePending: "这些 AI 分析建议尚未获批。请关闭此页面，在生成设置核对中修改并批准后再最终确认。", removed: "作者已排除此项。", profileDetail: "详情请在生成设置中查看。", evidence: "查看分析依据", evidenceFallback: "稿件分析依据",
      blocked: "阻止", warning: "注意", noIssues: "目前没有需要显示的未解决设定冲突。", originalRoute: "原作路径：{title}", authoredEnding: "原作路径：作者写的结局", choiceLabel: "选项 1 文案（可选）", choiceAria: "{title} 原作路径选项文案",
      stepSummary: "1/5 核对分析摘要", stepProposal: "2/5 核对分支建议与原作路径", stepContinuity: "3/5 核对设定冲突", stepRights: "4/5 确认权利与稿件", stepFinal: "5/5 最终确认", stepChoices: "正在准备选项", stepReady: "选项已准备好",
      confirmSummary: "确认分析摘要", confirmProposal: "确认分支建议", confirmContinuity: "确认设定冲突", toFinal: "进入最终确认", prepare: "最终确认并准备选项", retry: "重试选项准备",
      stepChoiceReview: "重新核对选项", resetChoices: "重置旧设定选项",
      choiceInterrupted: "服务器中断后已保存 {done} / {total} 部分。之前的 AI 结果及费用尚未确认，因此不会自动重新生成。确认后重试可能产生额外费用。",
      choiceConsentChanged: "权利批准已更新。请核对下方保存的选项，并按照当前同意重新批准。不会启动 AI 生成。",
      choiceReviewUnavailable: "无法核实选项与当前设定的核对状态。不能确认准备完成或重试 AI 生成。请重新打开此画面核对。",
      choiceSettingsChanged: "生成设定已变更。需要重置 {count} 个场景中的旧设定 AI 选项。稿件、原作路径及当前设定的选项会保留。仅重置不会启动 AI 生成，也不会产生费用。",
      choiceSettingsConsentChanged: "当前权利批准已更新，作者文风也已变更。将归档并清空 {count} 个场景中的旧文风 AI 选项或未按当前权利重新批准的 AI 选项。原文及原作路径会保留。不会启动 AI 生成，也不会产生费用。之后的 AI 生成需要单独确认可能产生费用。",
      choiceConsentResetWaiting: "当前权利批准已更新，作者文风也已变更，但选项任务正在运行，暂时无法重置。不会启动 AI 生成，也不会产生费用。请在任务停止后重新打开此画面。",
      resetConsentConfirm: "当前权利批准已更新，作者文风也已变更。要按当前权利归档并清空 {count} 个场景中的旧文风 AI 选项或未重新批准的 AI 选项吗？原文及原作路径会保留。不会启动 AI 生成，也不会产生费用。之后生成需要单独点击重试并另行确认可能产生费用。",
      resettingConsentChoices: "正在归档并清空旧文风或未重新批准的 AI 选项。原文及原作路径会保留，不会启动 AI 生成，也不会产生费用。",
      choiceResetWaiting: "生成设定已变更，但选项任务正在运行，暂时无法重置。请在任务停止后重新打开此画面。",
      choiceApprovalRequired: "请先修改并批准生成设定。关闭此画面，完成生成设定核对后，再重新核对选项。",
      choiceBlocked: "目前不能重置或重新生成选项。请检查稿件、权利及核对状态；若问题持续，请联系运营人员。",
      choiceResetReady: "选项已重置，稿件及原作路径已保留。AI 生成尚未启动。请单独点击“重试选项准备”并确认，之后才会请求 AI 生成，任务可能进入队列并产生费用。",
      resetConfirm: "生成设定已变更。要重置 {count} 个场景中的旧设定 AI 选项吗？稿件、原作路径及当前设定的选项会保留。不会启动 AI 生成，也不会产生费用。生成需要之后单独重试。",
      retryConfirm: "要重试选项准备吗？确认后将请求 AI 生成，任务可能进入队列并产生费用。稿件及原作路径会保留。",
      resettingChoices: "正在仅重置旧设定的 AI 选项。不会启动 AI 生成。", resetUnconfirmed: "无法确认重置结果。AI 重试尚未启动。请重新打开此画面核对。",
      choiceReady: "三个选项均已准备好。此稿件仍未公开。", choiceFailed: "AI 选项准备在第 {done} / {total} 部分停止。核对后可以重试。", choiceQueued: "AI 选项准备正在排队：{done} / {total}。如果持续排队，请联系运营人员。", choiceWorking: "服务器正在处理 AI 选项：{done} / {total}。可重新打开查看进度。", choicePaused: "选项准备正在等待：{done} / {total}。服务器工作程序不可用，需要运营人员设置。", choicePending: "请核对原作路径。选项 1 留空时，AI 会根据稿件提出建议。", resumeSubmitted: "稿件提交已保存。请确认下方权利和 AI 授权项目，以继续非公开准备。",
      loading: "正在检查稿件和核对状态。", analysisMissing: "无法确认当前稿件的分析结果。", profileMissing: "无法确认当前稿件的生成设置。", issuesTruncated: "分析警告过多，无法在此全部显示。需要运营人员核对。", criticalIssues: "仍存在严重设定冲突。请修改分析内容并重新核对。", startReview: "请核对分析摘要和分支建议，然后逐步完成核对。",
      invalidRoute: "手动填写时，请输入符合当前场景的具体选项，而非下一步/Continue。", finalChecks: "请确认原作路径及所有核对、权利和 AI 授权项目。", reviewChanged: "核对内容已改变。请重新打开页面查看最新内容。", stepCheck: "请核对当前步骤的分析内容并勾选确认框。", warningCheck: "请先核对显示的设定警告。", stepChanged: "核对步骤已改变。请重新打开查看。", stepSaveFailed: "无法确认核对步骤的保存结果。", finalStepSaved: "核对内容已保存。请再次点击最终确认以提交稿件并开始私下准备选项。", stepSaved: "当前步骤已保存。请核对下一步骤。",
      submitting: "正在记录作者的最终确认。", submitUnconfirmed: "无法确认稿件提交状态。", savingConsent: "正在保存稿件权利及 AI 分支授权。", materializing: "正在将稿件整理为非公开场景。", materializeUnconfirmed: "无法确认非公开场景的准备状态。", jobUnconfirmed: "无法确认选项准备任务。请确认下方项目后重试。", choiceUnverified: "任务显示已完成，但最终准备状态未经确认。请重新打开查看；若持续如此，请联系运营人员。", failureRetain: "{reason} 已准备的部分会保留。请重新打开以继续。", manuscriptChanged: "稿件或账号已改变。", requestFailed: "无法完成请求，请重试。"
    },
    "zh-Hant": {
      companySubmitted: "公司委託 · 稿件已提交",
      entryTitle: "稿件最終核對", entryIntro: "確認原故事的後續路徑與 AI 分支授權後，將提交非公開的選項準備請求。可重新開啟查看進度。", open: "開啟最終核對",
      eyebrow: "作者確認", title: "稿件與原作路徑最終核對", close: "關閉", later: "稍後", intro: "請依序核對分析摘要、分支建議與設定衝突。最終確認後，伺服器會私下準備三個選項。",
      summaryTitle: "稿件分析摘要", proposalTitle: "分支建議與原作路徑", continuityTitle: "設定衝突", confirmationTitle: "最終確認",
      summaryReviewed: "我已核對上述分析摘要。", proposalReviewed: "我已核對上述分支建議與原作路徑。", warningsReviewed: "我已核對上述分析警告。", continuityReviewed: "我已核對上述設定衝突的檢查結果。",
      reviewed: "我已核對稿件、分析結果及所有部分的原作路徑。", rights: "我擁有此稿件的權利，並授權在服務中使用。", ai: "我授權參考稿件文風生成 AI 分支，並重複使用經審核的結果。",
      writing_style: "作者文風", scene_scale: "場景篇幅", canon: "世界觀與固定設定", timeline: "時間線", visual_direction: "背景與畫面氛圍", visual_cast: "人物外觀", narrative_devices: "伏筆與回收", branch_behavior: "選擇後的發展",
      profileApproved: "已套用至此稿件的生成設定。", profilePending: "這些 AI 分析建議尚未核准。請關閉此畫面，在生成設定核對中修改並核准後再最終確認。", removed: "作者已排除此項。", profileDetail: "詳情請在生成設定中查看。", evidence: "查看分析依據", evidenceFallback: "稿件分析依據",
      blocked: "阻擋", warning: "注意", noIssues: "目前沒有需要顯示的未解決設定衝突。", originalRoute: "原作路徑：{title}", authoredEnding: "原作路徑：作者撰寫的結局", choiceLabel: "選項 1 文字（選填）", choiceAria: "{title} 原作路徑選項文字",
      stepSummary: "1/5 核對分析摘要", stepProposal: "2/5 核對分支建議與原作路徑", stepContinuity: "3/5 核對設定衝突", stepRights: "4/5 確認權利與稿件", stepFinal: "5/5 最終確認", stepChoices: "正在準備選項", stepReady: "選項已準備好",
      confirmSummary: "確認分析摘要", confirmProposal: "確認分支建議", confirmContinuity: "確認設定衝突", toFinal: "進入最終確認", prepare: "最終確認並準備選項", retry: "重試選項準備",
      stepChoiceReview: "重新核對選項", resetChoices: "重設舊設定選項",
      choiceInterrupted: "伺服器中斷後已儲存 {done} / {total} 部分。先前的 AI 結果及費用尚未確認，因此不會自動重新生成。確認後重試可能產生額外費用。",
      choiceConsentChanged: "權利批准已更新。請核對下方儲存的選項，並按照目前同意重新批准。不會啟動 AI 生成。",
      choiceReviewUnavailable: "無法核實選項與目前設定的核對狀態。不能確認準備完成或重試 AI 生成。請重新開啟此畫面核對。",
      choiceSettingsChanged: "生成設定已變更。需要重設 {count} 個場景中的舊設定 AI 選項。稿件、原作路徑及目前設定的選項會保留。僅重設不會啟動 AI 生成，也不會產生費用。",
      choiceSettingsConsentChanged: "目前權利批准已更新，作者文風也已變更。將封存並清空 {count} 個場景中的舊文風 AI 選項或未依目前權利重新批准的 AI 選項。原文及原作路徑會保留。不會啟動 AI 生成，也不會產生費用。之後的 AI 生成需要單獨確認可能產生費用。",
      choiceConsentResetWaiting: "目前權利批准已更新，作者文風也已變更，但選項工作正在執行，暫時無法重設。不會啟動 AI 生成，也不會產生費用。請在工作停止後重新開啟此畫面。",
      resetConsentConfirm: "目前權利批准已更新，作者文風也已變更。要依目前權利封存並清空 {count} 個場景中的舊文風 AI 選項或未重新批准的 AI 選項嗎？原文及原作路徑會保留。不會啟動 AI 生成，也不會產生費用。之後生成需要單獨點擊重試並另行確認可能產生費用。",
      resettingConsentChoices: "正在封存並清空舊文風或未重新批准的 AI 選項。原文及原作路徑會保留，不會啟動 AI 生成，也不會產生費用。",
      choiceResetWaiting: "生成設定已變更，但選項工作正在執行，暫時無法重設。請在工作停止後重新開啟此畫面。",
      choiceApprovalRequired: "請先修改並核准生成設定。關閉此畫面，完成生成設定核對後，再重新核對選項。",
      choiceBlocked: "目前不能重設或重新生成選項。請檢查稿件、權利及核對狀態；若問題持續，請聯絡營運人員。",
      choiceResetReady: "選項已重設，稿件及原作路徑已保留。AI 生成尚未啟動。請單獨點擊「重試選項準備」並確認，之後才會請求 AI 生成，工作可能進入佇列並產生費用。",
      resetConfirm: "生成設定已變更。要重設 {count} 個場景中的舊設定 AI 選項嗎？稿件、原作路徑及目前設定的選項會保留。不會啟動 AI 生成，也不會產生費用。生成需要之後單獨重試。",
      retryConfirm: "要重試選項準備嗎？確認後將請求 AI 生成，工作可能進入佇列並產生費用。稿件及原作路徑會保留。",
      resettingChoices: "正在僅重設舊設定的 AI 選項。不會啟動 AI 生成。", resetUnconfirmed: "無法確認重設結果。AI 重試尚未啟動。請重新開啟此畫面核對。",
      choiceReady: "三個選項都已準備好。此稿件仍未公開。", choiceFailed: "AI 選項準備在第 {done} / {total} 部分停止。核對後可重試。", choiceQueued: "AI 選項準備正在排隊：{done} / {total}。若持續排隊，請聯絡營運人員。", choiceWorking: "伺服器正在處理 AI 選項：{done} / {total}。可重新開啟查看進度。", choicePaused: "選項準備正在等待：{done} / {total}。伺服器工作程序無法使用，需要營運人員設定。", choicePending: "請核對原作路徑。選項 1 留空時，AI 會依稿件提出建議。", resumeSubmitted: "稿件提交已儲存。請確認下方權利與 AI 授權項目，以繼續非公開準備。",
      loading: "正在檢查稿件與核對狀態。", analysisMissing: "無法確認目前稿件的分析結果。", profileMissing: "無法確認目前稿件的生成設定。", issuesTruncated: "分析警告過多，無法在此全部顯示。需要營運人員核對。", criticalIssues: "仍有嚴重設定衝突。請修改分析內容後重新核對。", startReview: "請核對分析摘要與分支建議，然後逐步完成核對。",
      invalidRoute: "手動填寫時，請輸入符合目前場景的具體選項，而非下一步/Continue。", finalChecks: "請確認原作路徑及所有核對、權利和 AI 授權項目。", reviewChanged: "核對內容已變更。請重新開啟畫面查看最新內容。", stepCheck: "請核對目前步驟的分析內容並勾選確認框。", warningCheck: "請先核對顯示的設定警告。", stepChanged: "核對步驟已變更。請重新開啟查看。", stepSaveFailed: "無法確認核對步驟的儲存結果。", finalStepSaved: "核對內容已儲存。請再次點擊最終確認以提交稿件並開始私下準備選項。", stepSaved: "目前步驟已儲存。請核對下一步驟。",
      submitting: "正在記錄作者的最終確認。", submitUnconfirmed: "無法確認稿件提交狀態。", savingConsent: "正在儲存稿件權利與 AI 分支授權。", materializing: "正在將稿件整理為非公開場景。", materializeUnconfirmed: "無法確認非公開場景的準備狀態。", jobUnconfirmed: "無法確認選項準備工作。請確認下方項目後重試。", choiceUnverified: "工作顯示已完成，但最終準備狀態尚未確認。請重新開啟查看；若持續如此，請聯絡營運人員。", failureRetain: "{reason} 已準備的部分會保留。請重新開啟以繼續。", manuscriptChanged: "稿件或帳號已變更。", requestFailed: "無法完成請求，請重試。"
    }
  };
  const staticIds = { writerFinalEntryTitle: "entryTitle", writerFinalOpen: "open", writerFinalTitle: "title",
    writerFinalClose: "close", writerFinalCancel: "later", writerFinalSummaryTitle: "summaryTitle",
    writerFinalProposalTitle: "proposalTitle", writerFinalContinuityTitle: "continuityTitle",
    writerFinalConfirmationTitle: "confirmationTitle" };
  const checkboxCopy = { SummaryReviewed: "summaryReviewed", ProposalReviewed: "proposalReviewed",
    Warnings: "warningsReviewed", ContinuityReviewed: "continuityReviewed", Reviewed: "reviewed",
    Rights: "rights", Ai: "ai" };
  let snapshot = null;
  let profile = null;
  let choiceReview = null;
  // Receipt failures require reopening; a later background read cannot restore authority.
  let companyReceiptBlocked = false;
  let active = null;
  let sessionRevision = 0;
  let loading = false;
  let busy = false;
  let refreshing = false;
  let stateView = null;
  let previousFocus = null;
  let draftIdentity = null;
  let draftLabels = new Map();
  let draftStorageKey = null;

  function locale() {
    const language = window.luminaI18n?.getLocale?.() || "ko";
    return { "en-US": "en", "ja-JP": "ja", "zh-CN": "zh-Hans", "zh-TW": "zh-Hant" }[language] || language;
  }
  function t(key, values = {}) {
    const value = copy[locale()]?.[key] || copy.ko[key] || key;
    return value.replace(/\{(\w+)\}/g, (_, name) => String(name === "reason" ? t(values.reason || "requestFailed") : values[name] ?? ""));
  }
  function renderStaticCopy() {
    Object.entries(staticIds).forEach(([id, key]) => {
      const element = document.getElementById(id);
      if (element) element.textContent = t(key);
    });
    const entryIntro = entry.querySelector?.("p:not([id])");
    if (entryIntro) entryIntro.textContent = t("entryIntro");
    const eyebrow = modal.querySelector?.("header .eyebrow");
    if (eyebrow) eyebrow.textContent = t("eyebrow");
    const intro = modal.querySelector?.(".modal-card > p:not([id])");
    if (intro) intro.textContent = t("intro");
    Object.entries(checkboxCopy).forEach(([name, key]) => {
      const input = document.getElementById("writerFinal" + name);
      const label = input?.closest?.("label");
      if (label) label.replaceChildren(input, " " + t(key));
    });
  }
  function renderState() {
    if (!stateView) return;
    const companyStatus = !companyReceiptBlocked && snapshot && validCompanySubmission(snapshot.review, snapshot);
    const message = (companyStatus && !stateView.error && !["loading", "companySubmitted"].includes(stateView.key)
      ? t("companySubmitted") + "\n" : "") + t(stateView.key, stateView.values);
    state.textContent = message;
    entryState.textContent = message;
    state.classList.toggle("is-danger", stateView.error);
    entryState.classList.toggle("is-danger", stateView.error);
  }
  function setFailure(error, fallback, retain = false) {
    const reason = Object.hasOwn(copy.ko, error?.uiKey) ? error.uiKey : fallback;
    setState(retain ? "failureRetain" : reason, true, retain ? { reason } : {});
  }
  function uiError(key) { return Object.assign(new Error(key), { uiKey: key }); }
  function rejectCompanyReceipt(key = "reviewChanged") {
    companyReceiptBlocked = true;
    choiceReview = null;
    return uiError(key);
  }

  function candidateScenesCurrent() {
    const source = snapshot?.parts;
    const scenes = snapshot?.scenes;
    return Boolean(Array.isArray(source) && source.length && Array.isArray(scenes) && scenes.length === source.length &&
      new Set(source.map(part => part.partKey)).size === source.length &&
      new Set(scenes.map(scene => scene?.sceneId)).size === scenes.length &&
      scenes.every((scene, index) => typeof scene?.sceneId === "string" && scene.sceneId &&
        scene.partKey === source[index].partKey && [1, 3].includes(scene.choiceCount)));
  }
  function validChoiceJob() {
    const job = snapshot?.choiceJob;
    return Boolean(job && ["queued", "processing", "failed", "paused", "completed"].includes(job.status) &&
      Number.isSafeInteger(job.totalParts) && job.totalParts === snapshot.parts?.length && job.totalParts > 0 &&
      Number.isSafeInteger(job.completedParts) && job.completedParts >= 0 && job.completedParts <= job.totalParts);
  }
  function choicesReady() {
    const job = snapshot?.choiceJob;
    return Boolean(!companyReceiptBlocked && choiceReview?.status === "current" && reviewMatchesSettings() &&
      snapshot?.releaseId && snapshot.ready === true && validChoiceJob() && candidateScenesCurrent() &&
      snapshot.scenes.every(scene => scene.choiceCount === 3) && job?.status === "completed" &&
      choiceReview.preparedScenes === snapshot.parts?.length && choiceReview.resetRequiredScenes === 0 &&
      job.totalParts === snapshot.parts?.length && job.completedParts === job.totalParts);
  }
  function reviewMatchesSettings() {
    return Boolean(current() && choiceReview && choiceReview.releaseId === snapshot?.releaseId &&
      choiceReview.expectedManuscriptHash === snapshot.manuscriptHash &&
      profile?.profile.status === "approved" &&
      choiceReview.expectedApprovedFingerprint === profile.profile.approvedFingerprint);
  }
  function validResetConsentReview(review) {
    if (!Object.hasOwn(review, "resetConsentReview")) return true;
    const consent = review.resetConsentReview;
    return Boolean(review.status === "settings_changed" && consent && typeof consent === "object" &&
      !Array.isArray(consent) && Object.keys(consent).length === 3 &&
      typeof consent.consentId === "string" &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(consent.consentId) &&
      Number.isSafeInteger(consent.consentRevision) && consent.consentRevision > 0 &&
      typeof consent.batchHash === "string" && /^[a-f0-9]{64}$/.test(consent.batchHash));
  }
  function sameResetConsentReview(previous, latest) {
    const previousHasConsent = Object.hasOwn(previous, "resetConsentReview");
    if (previousHasConsent !== Object.hasOwn(latest, "resetConsentReview")) return false;
    if (!previousHasConsent) return true;
    const before = previous.resetConsentReview;
    const after = latest.resetConsentReview;
    return before.consentId === after.consentId && before.consentRevision === after.consentRevision &&
      before.batchHash === after.batchHash;
  }
  function choiceAction() {
    if (!reviewMatchesSettings() || !candidateScenesCurrent() ||
        (snapshot.choiceJob && !validChoiceJob())) return null;
    if (choiceReview.status === "settings_changed") return choiceReview.canReset &&
      !["queued", "processing"].includes(snapshot.choiceJob?.status) ? "reset" : null;
    if (["current", "reset_ready"].includes(choiceReview.status) &&
        ["failed", "paused"].includes(snapshot.choiceJob?.status)) return "retry";
    return null;
  }
  function setChoiceJobState() {
    if (companyReceiptBlocked) return setState("reviewChanged", true);
    const job = snapshot?.choiceJob;
    if (snapshot?.releaseId) {
      if (!candidateScenesCurrent() || (job && !validChoiceJob())) return setState("jobUnconfirmed", true);
      if (!choiceReview) return setState("choiceReviewUnavailable", true);
      if (choiceReview.status === "approval_required") return setState("choiceApprovalRequired", true);
      if (choiceReview.status === "blocked") return setState("choiceBlocked", true);
      if (!reviewMatchesSettings()) return setState("choiceReviewUnavailable", true);
      if (choiceReview.status === "settings_changed") {
        const mixed = Object.hasOwn(choiceReview, "resetConsentReview");
        return setState(choiceAction() === "reset" ?
          (mixed ? "choiceSettingsConsentChanged" : "choiceSettingsChanged") :
          (mixed ? "choiceConsentResetWaiting" : "choiceResetWaiting"), true,
        { count: choiceReview.resetRequiredScenes });
      }
      if (choiceReview.status === "reset_ready") return setState("choiceResetReady");
      if (choiceReview.status === "consent_changed") return setState("choiceConsentChanged", true);
    }
    if (choicesReady()) return setState("choiceReady");
    if (job?.status === "failed") return setState(
      job.errorCode === "STUDIO_CHOICES_INTERRUPTED_RETRY_REQUIRED" ? "choiceInterrupted" : "choiceFailed",
      true, { done: job.completedParts, total: job.totalParts });
    if (job?.status === "queued" || job?.status === "processing")
      return setState(snapshot.choiceWorkerAvailable === false ? "choicePaused" :
        job.status === "queued" ? "choiceQueued" : "choiceWorking", false,
      { done: job.completedParts, total: job.totalParts });
    if (job?.status === "completed") return setState("choiceUnverified", true);
    if (snapshot?.releaseId) return setState("jobUnconfirmed", true);
    return setState("choicePending");
  }
  function updatePrepareButton() {
    const action = choiceAction();
    const reviewState = snapshot?.review?.state || "analysis_ready";
    stage.textContent = t(choicesReady() ? "stepReady" : snapshot?.releaseId ? "stepChoices" :
      reviewSteps[reviewState]?.label || "stepFinal");
    if (snapshot?.releaseId && choiceReview?.status !== "current") stage.textContent = t("stepChoiceReview");
    prepare.textContent = t(action === "reset" ? "resetChoices" : action === "retry" ? "retry" :
      snapshot?.releaseId ? "prepare" : reviewSteps[reviewState]?.button || "prepare");
    prepare.disabled = busy || loading || refreshing || !current() || !snapshot || !profile || profile.profile.status !== "approved" ||
      companyReceiptBlocked || choicesReady() || snapshot.issuesTruncated ||
      (snapshot.issues || []).some(issue => issue.severity === "critical") ||
      (Boolean(snapshot.releaseId) && (!candidateScenesCurrent() || (snapshot.choiceJob && !validChoiceJob()) ||
        !choiceReview || !reviewMatchesSettings() ||
        (!action && (Boolean(snapshot.choiceJob) || choiceReview.status !== "current"))));
  }

  function current() {
    const completed = analysis.completed();
    return Boolean(completed && active && completed.manuscriptVersionId === active.manuscriptVersionId &&
      completed.workId === active.workId && completed.analysisJobId === active.analysisJobId &&
      completed.identity?.ownerId === active.identity?.ownerId && api.isCurrent(active.identity));
  }
  function updateEntry() {
    const completed = analysis.completed();
    entry.hidden = !completed;
    if (active && !current()) {
      invalidateSession();
      clearDraft();
      entryState.textContent = "";
      stateView = null;
    }
  }
  function invalidateSession() {
    window.LuminaCreatorVisualReferences?.reset();
    window.LuminaCreatorChoiceConsentReview?.reset();
    sessionRevision++;
    modal.classList.add("is-hidden");
    loading = false;
    busy = false;
    refreshing = false;
    active = null;
    snapshot = null;
    profile = null;
    choiceReview = null;
    companyReceiptBlocked = false;
    stateView = null;
    entryState.textContent = "";
    updatePrepareButton();
  }
  async function request(path, options = {}) {
    if (!current()) throw uiError("manuscriptChanged");
    const scope = active;
    const revision = sessionRevision;
    let response;
    try { response = await api.fetch(root + path, { ...options, identity: scope.identity }); }
    catch (error) {
      if (active !== scope || sessionRevision !== revision || !current()) throw uiError("manuscriptChanged");
      throw error;
    }
    const data = await response.json().catch(() => null);
    if (active !== scope || sessionRevision !== revision || !current()) throw uiError("manuscriptChanged");
    if (!response.ok) {
      const code = data?.code || data?.error?.code || "";
      throw Object.assign(code === "COMPANY_FINAL_SUBMISSION_CHANGED" ? rejectCompanyReceipt() : new Error("request"),
        { status: response.status, code });
    }
    return data;
  }
  function routePath(suffix = "") {
    return `/stories/${encodeURIComponent(active.workId)}/linear-draft${suffix}`;
  }
  async function loadSnapshot() {
    choiceReview = null;
    window.LuminaCreatorChoiceConsentReview?.reset();
    const loaded = await request(routePath(`/${encodeURIComponent(active.manuscriptVersionId)}`));
    if (loaded?.manuscriptVersionId !== active.manuscriptVersionId ||
        loaded.analysisJobId !== active.analysisJobId || !Array.isArray(loaded.parts) || !loaded.parts.length ||
        loaded.parts.some(part => typeof part?.partKey !== "string" || !part.partKey) ||
        new Set(loaded.parts.map(part => part.partKey)).size !== loaded.parts.length)
      throw hasCompanySubmission(loaded?.review) || hasCompanySubmission(snapshot?.review)
        ? rejectCompanyReceipt() : uiError("analysisMissing");
    if ((hasCompanySubmission(loaded.review) && !validCompanySubmission(loaded.review, loaded)) ||
        (hasCompanySubmission(snapshot?.review) && !sameCompanySubmission(snapshot.review, loaded.review)))
      throw rejectCompanyReceipt();
    snapshot = loaded;
    window.LuminaCreatorVisualReferences?.show(snapshot, active);
    if (!loaded.releaseId) return loaded;
    try {
      const review = await request(routePath(`/releases/${encodeURIComponent(loaded.releaseId)}/choice-review`));
      const nullableString = value => value === null || (typeof value === "string" && Boolean(value));
      if (review?.releaseId === loaded.releaseId && review.generationStarted === false &&
          ["current", "settings_changed", "approval_required", "blocked", "reset_ready", "consent_changed"].includes(review.status) &&
          typeof review.canReset === "boolean" && nullableString(review.code) && validResetConsentReview(review) &&
          [review.expectedManuscriptHash, review.expectedApprovedFingerprint,
            review.expectedProfilePinHash, review.expectedReleaseChecksum].every(nullableString) &&
          (review.expectedProfilePinHash === null || /^[a-f0-9]{64}$/.test(review.expectedProfilePinHash)) &&
          Number.isSafeInteger(review.resetRequiredScenes) && review.resetRequiredScenes >= 0 &&
          review.resetRequiredScenes <= loaded.parts.length &&
          Number.isSafeInteger(review.preparedScenes) && review.preparedScenes >= 0 &&
          review.preparedScenes <= loaded.parts.length &&
          (["approval_required", "blocked"].includes(review.status) ||
            (review.expectedManuscriptHash === loaded.manuscriptHash &&
              /^[a-f0-9]{64}$/.test(review.expectedProfilePinHash) &&
              Boolean(review.expectedApprovedFingerprint && review.expectedReleaseChecksum)))) choiceReview = review;
    } catch (error) {
      if (!current() || error.uiKey === "manuscriptChanged") throw error;
      // Missing or unverifiable review must never enable readiness, reset, or paid retry.
    }
    return loaded;
  }
  function validOriginalLabel(label) {
    return Boolean(!label || (label.length <= 120 && !label.includes("\0") &&
      !/^(다음|계속|next|continue)(\s*(장|파트|으로|part))?$/iu.test(label)));
  }
  function persistDraft() {
    if (!draftStorageKey) return;
    try { window.sessionStorage?.setItem(draftStorageKey, JSON.stringify([...draftLabels])); }
    catch (_) { /* Unavailable storage must not interrupt the review. */ }
  }
  function captureDraft() {
    if (!snapshot || snapshot.releaseId || !draftIdentity) return;
    draftLabels = new Map([...parts.querySelectorAll("input[data-part-key]")]
      .map(input => [input.dataset.partKey, input.value]));
    persistDraft();
  }
  function clearDraft() {
    try { if (draftStorageKey) window.sessionStorage?.removeItem(draftStorageKey); }
    catch (_) { /* Storage can be unavailable in a private browser context. */ }
    draftIdentity = null;
    draftStorageKey = null;
    draftLabels = new Map();
  }
  function restoreDraft() {
    if (!draftStorageKey) return new Map();
    try {
      const saved = JSON.parse(window.sessionStorage?.getItem(draftStorageKey) || "null");
      if (!Array.isArray(saved)) return new Map();
      const allowed = new Set(snapshot.parts.map(part => part.partKey));
      return new Map(saved.filter(item => Array.isArray(item) && allowed.has(item[0]) &&
        typeof item[1] === "string" && item[1].length <= 120));
    } catch (_) { return new Map(); }
  }
  function close() {
    if (busy || modal.classList.contains("is-hidden")) return;
    window.LuminaCreatorVisualReferences?.reset();
    window.LuminaCreatorChoiceConsentReview?.reset();
    captureDraft();
    sessionRevision++;
    loading = false;
    refreshing = false;
    choiceReview = null;
    modal.classList.add("is-hidden");
    if (previousFocus?.isConnected && !previousFocus.closest?.("[hidden]")) previousFocus.focus();
    previousFocus = null;
  }
  function keepFocusInModal(event) {
    if (event.key !== "Tab" || modal.classList.contains("is-hidden")) return;
    const controls = [...modal.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex='0'], summary, a[href]")]
      .filter(element => element.getClientRects().length);
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }
  function setState(key, error = false, values = {}) {
    stateView = { key, error, values };
    renderState();
    if (error && !modal.classList.contains("is-hidden")) state.scrollIntoView?.({ block: "nearest" });
  }
  function validProfile(value) {
    const details = value?.profile;
    const settings = details?.status === "approved" ? details.approvedSettings : details?.draftSettings;
    return value?.workId === active.workId && value.manuscript?.id === active.manuscriptVersionId &&
      value.analysis?.id === active.analysisJobId && settings?.schemaVersion === "creator-generation-profile-v1" &&
      settings.kind === "story" && Array.isArray(settings.sections) &&
      profileKeys.every(key => settings.sections.some(section => section.key === key &&
        section.value && typeof section.value === "object" && !Array.isArray(section.value)));
  }
  function validCompanySubmission(review, previous) {
    const receipt = review?.companySubmission;
    const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
    return review?.approvalBasis === "company_delegation" && review.state === "submitted" &&
      review.revision === 2 && uuid(review.reviewId) && uuid(receipt?.submissionId) &&
      receipt.contract === "story-company-final-submission-v1" && receipt.scope === "manuscript_submission" &&
      uuid(receipt.manuscriptVersionId) && uuid(receipt.analysisJobId) &&
      typeof receipt.manuscriptHash === "string" && /^[a-f0-9]{64}$/.test(receipt.manuscriptHash) &&
      receipt.manuscriptVersionId === active.manuscriptVersionId && receipt.manuscriptHash === previous.manuscriptHash &&
      receipt.analysisJobId === active.analysisJobId && receipt.reviewRevision === review.revision &&
      typeof receipt.bindingHash === "string" && /^[a-f0-9]{64}$/.test(receipt.bindingHash) &&
      receipt.humanSemanticReview === false && receipt.published === false && receipt.generationStarted === false;
  }
  function hasCompanySubmission(review) {
    return Boolean(review && (review.approvalBasis === "company_delegation" || Object.hasOwn(review, "companySubmission")));
  }
  function sameCompanySubmission(previous, latest) {
    return hasCompanySubmission(latest) && previous.reviewId === latest.reviewId &&
      previous.companySubmission?.submissionId === latest.companySubmission?.submissionId &&
      previous.companySubmission?.bindingHash === latest.companySubmission?.bindingHash;
  }
  async function acceptCompanySubmission(review, previous) {
    if (!validCompanySubmission(review, previous)) throw rejectCompanyReceipt("submitUnconfirmed");
    const latest = await loadSnapshot();
    const latestProfile = await request(`/stories/${encodeURIComponent(active.workId)}/generation-profile`);
    if (!validProfile(latestProfile) || latestProfile.profile.status !== "approved" ||
        latestProfile.profile.approvedFingerprint !== profile.profile.approvedFingerprint ||
        !validCompanySubmission(latest.review, latest) || !sameCompanySubmission(review, latest.review) ||
        latest.review?.reviewId !== review.reviewId || latest.review?.revision !== review.revision ||
        latest.review?.state !== "submitted" || latest.releaseId ||
        latest.manuscriptHash !== previous.manuscriptHash || latest.analysisJobId !== previous.analysisJobId ||
        JSON.stringify(latest.parts) !== JSON.stringify(previous.parts) ||
        JSON.stringify(latest.issues) !== JSON.stringify(previous.issues) ||
        latest.issuesTruncated !== previous.issuesTruncated) throw rejectCompanyReceipt();
    setState("companySubmitted");
    state.scrollIntoView?.({ block: "nearest" });
  }
  function renderProfile() {
    summary.replaceChildren();
    proposals.replaceChildren();
    const details = profile.profile;
    const settings = details.status === "approved" ? details.approvedSettings : details.draftSettings;
    profileStatus.textContent = t(details.status === "approved" ? "profileApproved" : "profilePending");
    for (const section of settings.sections) {
      const item = document.createElement("article");
      item.className = "writer-final-profile-item";
      const heading = document.createElement("h4");
      heading.textContent = t(section.key);
      const content = document.createElement("p");
      const observation = Array.isArray(section.value.observations)
        ? section.value.observations.find(item => typeof item?.detail === "string" && item.detail.trim()) : null;
      content.textContent = section.decision === "removed" ? t("removed") :
        section.value.summary || observation?.detail || t("profileDetail");
      item.append(heading, content);
      if (Array.isArray(section.evidence) && section.evidence.length) {
        const evidence = document.createElement("details");
        const title = document.createElement("summary");
        title.textContent = t("evidence");
        const list = document.createElement("ul");
        section.evidence.forEach(source => {
          const row = document.createElement("li");
          row.textContent = source.summary || t("evidenceFallback");
          list.append(row);
        });
        evidence.append(title, list);
        item.append(evidence);
      }
      (section.key === "branch_behavior" || section.key === "narrative_devices" ? proposals : summary).append(item);
    }
  }
  function renderChoiceConsentReview() {
    if (choiceReview?.status === "consent_changed")
      window.LuminaCreatorChoiceConsentReview?.show(snapshot, choiceReview, active);
    else window.LuminaCreatorChoiceConsentReview?.reset();
  }
  function renderParts(preserveValues = false) {
    const focusedPartKey = preserveValues ? document.activeElement?.dataset?.partKey : null;
    const focusedInput = focusedPartKey ? document.activeElement : null;
    const selectionStart = focusedInput?.selectionStart;
    const selectionEnd = focusedInput?.selectionEnd;
    const values = preserveValues ? new Map([...parts.querySelectorAll("input[data-part-key]")]
      .map(input => [input.dataset.partKey, input.value])) : new Map();
    parts.replaceChildren();
    issues.replaceChildren();
    (snapshot.issues || []).forEach(issue => {
      const item = document.createElement("p");
      item.className = issue.severity === "critical" ? "is-danger" : "";
      item.textContent = `${t(issue.severity === "critical" ? "blocked" : "warning")}: ${issue.summary}`;
      issues.append(item);
    });
    if (!(snapshot.issues || []).length) {
      const empty = document.createElement("p");
      empty.textContent = t("noIssues");
      issues.append(empty);
    }
    document.getElementById("writerFinalWarningsLabel").hidden =
      !(snapshot.issues || []).some(issue => issue.severity === "warning");
    snapshot.parts.forEach((part, index) => {
      const item = document.createElement("section");
      item.className = "writer-final-part";
      const heading = document.createElement("h3");
      heading.textContent = `${index + 1}. ${part.title}`;
      const excerpt = document.createElement("blockquote");
      excerpt.textContent = part.endingExcerpt;
      const destination = document.createElement("p");
      destination.textContent = part.nextPartTitle ? t("originalRoute", { title: part.nextPartTitle }) : t("authoredEnding");
      const label = document.createElement("label");
      label.textContent = t("choiceLabel");
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 120;
      input.required = false;
      input.dataset.partKey = part.partKey;
      input.value = snapshot.releaseId ? (snapshot.scenes[index]?.originalLabel ?? "") :
        (values.get(part.partKey) ?? draftLabels.get(part.partKey) ?? snapshot.scenes[index]?.originalLabel ?? "");
      input.readOnly = Boolean(snapshot.releaseId);
      input.setAttribute("aria-label", t("choiceAria", { title: part.title }));
      label.append(input);
      item.append(heading, excerpt, destination, label);
      parts.append(item);
    });
    renderChoiceConsentReview();
    if (focusedPartKey) {
      const input = [...parts.querySelectorAll("input[data-part-key]")].find(item => item.dataset.partKey === focusedPartKey);
      input?.focus();
      if (Number.isInteger(selectionStart) && Number.isInteger(selectionEnd))
        input?.setSelectionRange(selectionStart, selectionEnd);
    }
  }
  async function open() {
    if (busy || loading || refreshing) return;
    window.LuminaCreatorVisualReferences?.reset();
    window.LuminaCreatorChoiceConsentReview?.reset();
    const completed = analysis.completed();
    if (!completed) return;
    active = { ...completed, identity: completed.identity ? { ...completed.identity } : completed.identity };
    const revision = ++sessionRevision;
    loading = true;
    snapshot = null;
    choiceReview = null;
    companyReceiptBlocked = false;
    previousFocus = document.activeElement;
    modal.classList.remove("is-hidden");
    document.getElementById("writerFinalClose").focus();
    renderStaticCopy();
    setState("loading");
    prepare.disabled = true;
    parts.replaceChildren();
    summary.replaceChildren();
    proposals.replaceChildren();
    profile = null;
    try {
      await loadSnapshot();
      const identity = [active.identity?.ownerId || "", active.workId, active.manuscriptVersionId,
        active.analysisJobId, snapshot.manuscriptHash].join("|");
      if (draftIdentity !== identity) {
        clearDraft();
        draftIdentity = identity;
        draftStorageKey = active.identity?.ownerId ? `lumina:writer-final-route-draft:${identity}` : null;
        if (!snapshot.releaseId) draftLabels = restoreDraft();
      }
      if (snapshot.releaseId) clearDraft();
      const loadedProfile = await request(`/stories/${encodeURIComponent(active.workId)}/generation-profile`);
      if (!validProfile(loadedProfile)) throw uiError("profileMissing");
      profile = loadedProfile;
      renderProfile();
      renderParts();
      [...checks, ...stageChecks].forEach(check => { check.checked = false; });
      if (snapshot.issuesTruncated) setState("issuesTruncated", true);
      else if ((snapshot.issues || []).some(issue => issue.severity === "critical")) setState("criticalIssues", true);
      else if (snapshot.releaseId) setChoiceJobState();
      else if (profile.profile.status !== "approved") setState("profilePending");
      else if (snapshot.review?.state === "submitted") setState(hasCompanySubmission(snapshot.review) ? "companySubmitted" : "resumeSubmitted");
      else setState("startReview");
    } catch (error) {
      if (sessionRevision === revision) { window.LuminaCreatorVisualReferences?.reset(); snapshot = null; profile = null; choiceReview = null; setFailure(error, "requestFailed"); }
    } finally {
      if (sessionRevision === revision) { loading = false; updatePrepareButton(); }
    }
  }
  function originalRoutes() {
    const routeInputs = [...parts.querySelectorAll("input[data-part-key]")];
    const routes = routeInputs.map(input => ({
      partKey: input.dataset.partKey, label: input.value.trim()
    }));
    const invalidRoute = routes.findIndex(item => !validOriginalLabel(item.label));
    if (invalidRoute >= 0) {
      setState("invalidRoute", true);
      routeInputs[invalidRoute].focus();
      return null;
    }
    return routes.length === snapshot.parts.length ? routes : null;
  }
  function finalChecks() {
    if (!checks.slice(0, 3).every(check => check.checked) ||
        ((snapshot.issues || []).some(issue => issue.severity === "warning") && !checks[3].checked)) {
      setState("finalChecks", true);
      return false;
    }
    return true;
  }
  async function assertFreshReview(allowSubmitted = false) {
    const previous = snapshot;
    const previousChoiceReview = choiceReview;
    const latest = await loadSnapshot();
    const latestProfile = await request(`/stories/${encodeURIComponent(active.workId)}/generation-profile`);
    const submittedSinceLastRead = allowSubmitted && previous.review?.state === "final_confirmation" &&
      latest.review?.state === "submitted" && latest.review.reviewId === previous.review.reviewId;
    if (!validProfile(latestProfile) || latestProfile.profile.status !== "approved" ||
        latestProfile.profile.approvedFingerprint !== profile.profile.approvedFingerprint ||
        (previousChoiceReview && choiceReview &&
          (previousChoiceReview.expectedProfilePinHash !== choiceReview.expectedProfilePinHash ||
            !sameResetConsentReview(previousChoiceReview, choiceReview))) ||
        latest.manuscriptHash !== previous.manuscriptHash || latest.analysisJobId !== previous.analysisJobId ||
        JSON.stringify(latest.parts) !== JSON.stringify(previous.parts) ||
        JSON.stringify(latest.issues) !== JSON.stringify(previous.issues) ||
        latest.issuesTruncated !== previous.issuesTruncated ||
        (!submittedSinceLastRead && (latest.review?.revision !== previous.review?.revision ||
          latest.review?.state !== previous.review?.state))) {
      throw hasCompanySubmission(previous.review) || hasCompanySubmission(latest.review)
        ? rejectCompanyReceipt() : uiError("reviewChanged");
    }
    return latest;
  }
  async function advanceReview(reviewState, routes) {
    const step = reviewSteps[reviewState];
    if (!step) return;
    if (step.check !== undefined && !stageChecks[step.check].checked) {
      setState("stepCheck", true);
      return;
    }
    if ((reviewState === "summary_review" || reviewState === "continuity_review") && !routes) return;
    if ((reviewState === "proposal_review" || reviewState === "continuity_review") &&
        (snapshot.issues || []).some(issue => issue.severity === "warning") && !checks[3].checked) {
      setState("warningCheck", true);
      return;
    }
    if (reviewState === "continuity_review" && !finalChecks()) return;
    busy = true;
    const revision = sessionRevision;
    updatePrepareButton();
    try {
      await assertFreshReview();
      let review = snapshot.review;
      if (!review) {
        const previous = snapshot;
        review = await request(`/stories/${encodeURIComponent(active.workId)}/reviews`, {
          method: "POST", body: { manuscriptVersionId: active.manuscriptVersionId, analysisJobId: active.analysisJobId }
        });
        if (hasCompanySubmission(review)) {
          await acceptCompanySubmission(review, previous);
          return;
        }
        snapshot.review = review;
      }
      if (review.state !== reviewState) throw uiError("stepChanged");
      review = await request(`/reviews/${encodeURIComponent(review.reviewId)}/transition`, {
        method: "POST", body: { toState: step.next, expectedRevision: review.revision,
          ...(step.next === "final_confirmation" ? { decisions: { warningAcknowledged: checks[3].checked,
            originalRoutesReviewed: true }, finalSummary: { partCount: snapshot.parts.length,
            manuscriptHash: snapshot.manuscriptHash } } : {}) }
      });
      if (review.state !== step.next) throw uiError("stepSaveFailed");
      snapshot.review = review;
      setState(step.next === "final_confirmation" ? "finalStepSaved" : "stepSaved");
      state.scrollIntoView?.({ block: "nearest" });
    } catch (error) {
      if (sessionRevision !== revision || !current()) return;
      setFailure(error, "requestFailed");
      try { await loadSnapshot(); }
      catch (_) { /* Keep the failure visible until the author reopens. */ }
    } finally {
      if (sessionRevision === revision) { busy = false; updatePrepareButton(); }
    }
  }
  async function changeChoices(action) {
    busy = true;
    const revision = sessionRevision;
    const previous = snapshot;
    const previousReview = choiceReview;
    updatePrepareButton();
    try {
      await assertFreshReview(true);
      if (snapshot.releaseId !== previous.releaseId || !choiceReview ||
          choiceReview.expectedReleaseChecksum !== previousReview.expectedReleaseChecksum ||
          choiceReview.resetRequiredScenes !== previousReview.resetRequiredScenes ||
          choiceAction() !== action || snapshot.issuesTruncated ||
          (snapshot.issues || []).some(issue => issue.severity === "critical")) {
        setChoiceJobState();
        return;
      }
      setChoiceJobState();
      const consent = choiceReview.resetConsentReview;
      if (!window.confirm(t(action === "reset" ? (consent ? "resetConsentConfirm" : "resetConfirm") : "retryConfirm",
        { count: choiceReview.resetRequiredScenes }))) return;
      if (!current() || sessionRevision !== revision) throw uiError("manuscriptChanged");
      const releaseId = snapshot.releaseId;
      if (action === "reset") {
        const body = { expectedManuscriptHash: choiceReview.expectedManuscriptHash,
          expectedApprovedFingerprint: choiceReview.expectedApprovedFingerprint,
          expectedProfilePinHash: choiceReview.expectedProfilePinHash,
          expectedReleaseChecksum: choiceReview.expectedReleaseChecksum, resetConfirmed: true,
          ...(consent ? { expectedConsentId: consent.consentId, expectedConsentRevision: consent.consentRevision,
            expectedBatchHash: consent.batchHash, consentChangeConfirmed: true } : {}) };
        choiceReview = null;
        setState(consent ? "resettingConsentChoices" : "resettingChoices");
        const result = await request(routePath(`/releases/${encodeURIComponent(releaseId)}/reset-choices`),
          { method: "POST", body });
        if (result?.releaseId !== releaseId || result.status !== "reset_ready" || result.generationStarted !== false ||
            result.nextAction !== "explicit_retry_required" || !Number.isSafeInteger(result.resetScenes) ||
            result.resetScenes < 0 || typeof result.idempotentReplay !== "boolean") throw uiError("resetUnconfirmed");
      } else {
        choiceReview = null;
        await request(routePath(`/releases/${encodeURIComponent(releaseId)}/retry-choices`), { method: "POST" });
      }
      // Reset archives outdated or unapproved choices. Generation needs another click and confirmation.
      await loadSnapshot();
      renderParts();
      setChoiceJobState();
    } catch (error) {
      if (sessionRevision !== revision || !current()) return;
      choiceReview = null;
      try { await loadSnapshot(); } catch (_) { /* Reopen to verify an ambiguous response. */ }
      if (error.uiKey === "reviewChanged") choiceReview = null;
      if (sessionRevision === revision && current()) setFailure(error, "requestFailed");
    } finally {
      if (sessionRevision === revision) { busy = false; updatePrepareButton(); }
    }
  }
  async function finalize() {
    if (busy || loading || refreshing || companyReceiptBlocked || !snapshot || !profile || profile.profile.status !== "approved" || choicesReady() || !current() ||
        snapshot.issuesTruncated || (snapshot.issues || []).some(issue => issue.severity === "critical")) return;
    if (snapshot.releaseId) {
      if (!candidateScenesCurrent() || (snapshot.choiceJob && !validChoiceJob())) return;
      if (choiceAction()) return changeChoices(choiceAction());
      if (!reviewMatchesSettings() || choiceReview.status !== "current") return;
    }
    if (snapshot.releaseId && snapshot.choiceJob) return;
    const reviewState = snapshot.review?.state || "analysis_ready";
    const needsRoutes = ["summary_review", "continuity_review", "final_confirmation", "submission_failed", "submitted"].includes(reviewState);
    const routes = needsRoutes ? originalRoutes() : null;
    if (needsRoutes && !routes) return;
    if (reviewSteps[reviewState]) return advanceReview(reviewState, routes);
    if (!["final_confirmation", "submission_failed", "submitted"].includes(reviewState) || !finalChecks()) return;
    busy = true;
    const revision = sessionRevision;
    updatePrepareButton();
    try {
      snapshot = await assertFreshReview(true);
      if (snapshot.releaseId && (!reviewMatchesSettings() || choiceReview.status !== "current")) {
        setChoiceJobState();
        return;
      }
      if (snapshot.releaseId && snapshot.choiceJob) {
        clearDraft();
        renderParts();
        setChoiceJobState();
        return;
      }
      if (snapshot.review?.state !== "submitted") {
        setState("submitting");
        await request(`/reviews/${encodeURIComponent(snapshot.review.reviewId)}/submit`, { method: "POST",
          headers: { "Idempotency-Key": `studio-linear-final-${active.manuscriptVersionId}` } });
        await loadSnapshot();
        if (snapshot.review?.state !== "submitted") throw uiError("submitUnconfirmed");
      }
      if (snapshot.releaseId && (!reviewMatchesSettings() || choiceReview.status !== "current")) {
        setChoiceJobState();
        return;
      }
      if (!snapshot.consent?.active) {
        setState("savingConsent");
        await request(`/stories/${encodeURIComponent(active.workId)}/style-consent`, { method: "PUT",
          body: { manuscriptVersionId: active.manuscriptVersionId, rightsConfirmed: true,
            aiBranchAllowed: true, translationAllowed: false, imageTransformationAllowed: false,
            allowedLocales: ["ko"], allowedRegions: ["KR"], startsAt: new Date().toISOString(),
            ...(snapshot.consent ? { expectedRevision: snapshot.consent.revision } : {}) } });
        await loadSnapshot();
        if (!snapshot.consent?.active) throw uiError("requestFailed");
      }
      if (snapshot.releaseId && (!reviewMatchesSettings() || choiceReview.status !== "current")) {
        setChoiceJobState();
        return;
      }
      if (snapshot.releaseId && snapshot.choiceJob) {
        clearDraft();
        renderParts();
        setChoiceJobState();
        return;
      }
      setState("materializing");
      const result = await request(routePath("/materialize"), { method: "POST",
        body: { manuscriptVersionId: active.manuscriptVersionId, expectedManuscriptHash: snapshot.manuscriptHash,
          originalRoutesReviewed: true, originalRoutes: routes } });
      if (!result.releaseId || !Array.isArray(result.scenes) || result.scenes.length !== snapshot.parts.length)
        throw uiError("materializeUnconfirmed");
      await loadSnapshot();
      if (snapshot.choiceJob?.status !== "queued" && snapshot.choiceJob?.status !== "processing" && !choicesReady())
        throw uiError("jobUnconfirmed");
      clearDraft();
      renderParts();
      setChoiceJobState();
    } catch (error) {
      if (sessionRevision !== revision || !current()) return;
      setFailure(error, "requestFailed", true);
      try { await loadSnapshot(); }
      catch (_) { /* Keep the failure visible until the author retries. */ }
      if (error.uiKey === "reviewChanged") choiceReview = null;
    } finally {
      if (sessionRevision === revision) { busy = false; updatePrepareButton(); }
    }
  }
  async function refreshChoiceJob(force = false) {
    if (refreshing || busy || loading || modal.classList.contains("is-hidden") || !current() ||
        (!force && !["queued", "processing"].includes(snapshot?.choiceJob?.status))) return;
    refreshing = true;
    const revision = sessionRevision;
    updatePrepareButton();
    try {
      await loadSnapshot();
      if (candidateScenesCurrent()) {
        const scenes = new Map(snapshot.scenes.map(scene => [scene.partKey, scene]));
        for (const input of parts.querySelectorAll("input[data-part-key]")) {
          const label = scenes.get(input.dataset.partKey)?.originalLabel ?? "";
          if (!input.readOnly || input.value === label) continue;
          const focused = document.activeElement === input;
          const start = input.selectionStart;
          const end = input.selectionEnd;
          input.value = label;
          if (focused && Number.isInteger(start) && Number.isInteger(end))
            input.setSelectionRange(Math.min(start, label.length), Math.min(end, label.length));
        }
      }
      setChoiceJobState();
      renderChoiceConsentReview();
      updatePrepareButton();
    } catch (error) {
      if (sessionRevision === revision && current()) { choiceReview = null; setFailure(error, "choiceReviewUnavailable"); }
    }
    finally {
      if (sessionRevision === revision) { refreshing = false; updatePrepareButton(); }
    }
  }
  document.getElementById("writerFinalOpen").addEventListener("click", open);
  document.getElementById("writerFinalClose").addEventListener("click", close);
  document.getElementById("writerFinalCancel").addEventListener("click", close);
  prepare.addEventListener("click", finalize);
  parts.addEventListener("input", event => {
    if (!snapshot?.releaseId && event.target.matches?.("input[data-part-key]")) {
      draftLabels.set(event.target.dataset.partKey, event.target.value);
      persistDraft();
    }
  });
  modal.addEventListener("click", event => { if (event.target === modal) close(); });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") close();
    else keepFocusInModal(event);
  });
  window.addEventListener("lumina:auth-expired", () => {
    invalidateSession();
    clearDraft();
    updateEntry();
  });
  window.addEventListener("pagehide", captureDraft);
  window.addEventListener("lumina:story-choice-consent-reviewed", event => {
    if (current() && event.detail?.workId === active.workId && event.detail?.releaseId === snapshot?.releaseId)
      refreshChoiceJob(true);
  });
  window.addEventListener("lumina:localechange", () => {
    renderStaticCopy();
    if (profile) renderProfile();
    if (snapshot) renderParts(true);
    updatePrepareButton();
    renderState();
  });
  setInterval(updateEntry, 1000);
  setInterval(refreshChoiceJob, 3000);
  renderStaticCopy();
  updatePrepareButton();
  updateEntry();
})();

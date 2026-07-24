(function initStoryUploadPage() {
  "use strict";

  const root = document.getElementById("storyUploadRoot");
  if (!root) return;

  const API_ORIGIN = "https://api.lumina-stage.com";
  const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
  const LOCALES = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
  const COPY = {
    ko: {
      eyebrow: "작가 스튜디오",
      title: "최종 원고 업로드",
      description: "완성된 작품 원고와 공개에 필요한 자료를 제출합니다.",
      workInfo: "작품 정보",
      workTitle: "작품명",
      workTitlePlaceholder: "작품명을 입력해 주세요",
      originalLocale: "원문 언어",
      rightsType: "작품 권리",
      rightsOriginal: "작가 창작물",
      rightsPublic: "퍼블릭 도메인",
      rightsLicensed: "정식 계약 IP",
      rightsReference: "권리 확인 자료",
      rightsReferencePlaceholder: "권리 확인 자료의 이름을 입력해 주세요",
      manuscript: "최종 원고",
      manuscriptAccept: "MD, TXT, DOCX, PDF, JSON",
      metadata: "분기·엔딩 자료",
      metadataAccept: "JSON 또는 CSV",
      visuals: "표지·배경·캐릭터 자료",
      visualsAccept: "JPG, PNG, WEBP",
      choose: "파일 선택",
      noFiles: "선택된 파일 없음",
      remove: "제거",
      finalConfirm: "업로드할 파일이 최종본임을 확인했습니다.",
      submit: "최종본 제출",
      submitting: "제출 중입니다.",
      loginRequired: "로그인 후 제출할 수 있습니다.",
      requiredTitle: "작품명을 입력해 주세요.",
      requiredManuscript: "최종 원고 파일을 선택해 주세요.",
      requiredRights: "정식 계약 IP는 권리 확인 자료가 필요합니다.",
      requiredConfirm: "최종본 확인에 체크해 주세요.",
      tooLarge: "전체 파일 용량은 150MB 이하여야 합니다.",
      submitFailed: "제출하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      serviceUnavailable: "현재 최종 원고를 제출할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      submitted: "최종 원고가 접수되었습니다.",
      submittedBody: "검수 상태는 작가 스튜디오에서 확인할 수 있습니다.",
      uploadAnother: "다른 작품 제출",
    },
    en: {
      eyebrow: "Writer studio",
      title: "Upload final manuscript",
      description: "Submit a completed manuscript and its publication materials.",
      workInfo: "Work details",
      workTitle: "Title",
      workTitlePlaceholder: "Enter the work title",
      originalLocale: "Original language",
      rightsType: "Rights",
      rightsOriginal: "Original work",
      rightsPublic: "Public domain",
      rightsLicensed: "Licensed IP",
      rightsReference: "Rights reference",
      rightsReferencePlaceholder: "Enter the name of the rights confirmation material",
      manuscript: "Final manuscript",
      manuscriptAccept: "MD, TXT, DOCX, PDF, JSON",
      metadata: "Branches and endings",
      metadataAccept: "JSON or CSV",
      visuals: "Cover, backgrounds, characters",
      visualsAccept: "JPG, PNG, WEBP",
      choose: "Choose files",
      noFiles: "No files selected",
      remove: "Remove",
      finalConfirm: "I confirm these files are the final version.",
      submit: "Submit final version",
      submitting: "Submitting.",
      loginRequired: "Log in to submit.",
      requiredTitle: "Enter the work title.",
      requiredManuscript: "Choose at least one final manuscript file.",
      requiredRights: "Licensed IP requires a rights reference.",
      requiredConfirm: "Confirm that this is the final version.",
      tooLarge: "The total file size must be 150MB or less.",
      submitFailed: "Submission failed. Please try again shortly.",
      serviceUnavailable: "The final manuscript cannot be submitted right now. Please try again shortly.",
      submitted: "The final manuscript was submitted.",
      submittedBody: "Check its review status in Writer Studio.",
      uploadAnother: "Submit another work",
    },
    ja: {
      eyebrow: "作家スタジオ",
      title: "最終原稿アップロード",
      description: "完成した作品原稿と公開に必要な資料を提出します。",
      workInfo: "作品情報",
      workTitle: "作品名",
      workTitlePlaceholder: "作品名を入力してください",
      originalLocale: "原文言語",
      rightsType: "作品の権利",
      rightsOriginal: "作家オリジナル",
      rightsPublic: "パブリックドメイン",
      rightsLicensed: "正式契約IP",
      rightsReference: "権利確認資料",
      rightsReferencePlaceholder: "権利確認資料の名前を入力してください",
      manuscript: "最終原稿",
      manuscriptAccept: "MD, TXT, DOCX, PDF, JSON",
      metadata: "分岐・エンディング資料",
      metadataAccept: "JSONまたはCSV",
      visuals: "表紙・背景・キャラクター資料",
      visualsAccept: "JPG, PNG, WEBP",
      choose: "ファイル選択",
      noFiles: "ファイル未選択",
      remove: "削除",
      finalConfirm: "アップロードするファイルが最終版であることを確認しました。",
      submit: "最終版を提出",
      submitting: "提出しています。",
      loginRequired: "ログイン後に提出できます。",
      requiredTitle: "作品名を入力してください。",
      requiredManuscript: "最終原稿ファイルを選択してください。",
      requiredRights: "正式契約IPには権利確認資料が必要です。",
      requiredConfirm: "最終版の確認にチェックしてください。",
      tooLarge: "ファイル合計は150MB以下にしてください。",
      submitFailed: "提出できませんでした。しばらくしてからお試しください。",
      serviceUnavailable: "現在、最終原稿を提出できません。しばらくしてからお試しください。",
      submitted: "最終原稿を受け付けました。",
      submittedBody: "検収状況は作家スタジオで確認できます。",
      uploadAnother: "別の作品を提出",
    },
    "zh-Hans": {
      eyebrow: "作家工作室",
      title: "上传最终稿",
      description: "提交已完成的作品原稿及发布所需资料。",
      workInfo: "作品信息",
      workTitle: "作品名",
      workTitlePlaceholder: "请输入作品名",
      originalLocale: "原文语言",
      rightsType: "作品权利",
      rightsOriginal: "原创作品",
      rightsPublic: "公有领域",
      rightsLicensed: "正式授权IP",
      rightsReference: "权利证明资料",
      rightsReferencePlaceholder: "请输入权利证明资料的名称",
      manuscript: "最终原稿",
      manuscriptAccept: "MD, TXT, DOCX, PDF, JSON",
      metadata: "分支与结局资料",
      metadataAccept: "JSON或CSV",
      visuals: "封面、背景、角色资料",
      visualsAccept: "JPG, PNG, WEBP",
      choose: "选择文件",
      noFiles: "未选择文件",
      remove: "移除",
      finalConfirm: "我确认上传文件为最终版本。",
      submit: "提交最终版本",
      submitting: "正在提交。",
      loginRequired: "登录后即可提交。",
      requiredTitle: "请输入作品名。",
      requiredManuscript: "请选择最终原稿文件。",
      requiredRights: "正式授权IP需要权利证明资料。",
      requiredConfirm: "请确认这是最终版本。",
      tooLarge: "文件总大小不得超过150MB。",
      submitFailed: "提交失败，请稍后重试。",
      serviceUnavailable: "暂时无法提交最终原稿，请稍后重试。",
      submitted: "最终原稿已提交。",
      submittedBody: "可在作家工作室查看审核状态。",
      uploadAnother: "提交其他作品",
    },
    "zh-Hant": {
      eyebrow: "作家工作室",
      title: "上傳最終稿",
      description: "提交已完成的作品原稿及發布所需資料。",
      workInfo: "作品資訊",
      workTitle: "作品名",
      workTitlePlaceholder: "請輸入作品名",
      originalLocale: "原文語言",
      rightsType: "作品權利",
      rightsOriginal: "原創作品",
      rightsPublic: "公有領域",
      rightsLicensed: "正式授權IP",
      rightsReference: "權利證明資料",
      rightsReferencePlaceholder: "請輸入權利證明資料的名稱",
      manuscript: "最終原稿",
      manuscriptAccept: "MD, TXT, DOCX, PDF, JSON",
      metadata: "分支與結局資料",
      metadataAccept: "JSON或CSV",
      visuals: "封面、背景、角色資料",
      visualsAccept: "JPG, PNG, WEBP",
      choose: "選擇檔案",
      noFiles: "未選擇檔案",
      remove: "移除",
      finalConfirm: "我確認上傳檔案為最終版本。",
      submit: "提交最終版本",
      submitting: "正在提交。",
      loginRequired: "登入後即可提交。",
      requiredTitle: "請輸入作品名。",
      requiredManuscript: "請選擇最終原稿檔案。",
      requiredRights: "正式授權IP需要權利證明資料。",
      requiredConfirm: "請確認這是最終版本。",
      tooLarge: "檔案總大小不得超過150MB。",
      submitFailed: "提交失敗，請稍後重試。",
      serviceUnavailable: "暫時無法提交最終原稿，請稍後再試。",
      submitted: "最終原稿已提交。",
      submittedBody: "可在作家工作室查看審核狀態。",
      uploadAnother: "提交其他作品",
    },
  };

  const state = {
    locale: resolveLocale(),
    files: { manuscripts: [], metadata: [], visuals: [] },
    writerStories: [],
    writerReview: {
      workId: "",
      manuscriptId: "",
      analysisId: "",
      reviewId: "",
      revision: 0,
      analysis: null,
      continuity: null,
      review: null,
      dialogOpen: false,
    },
    busy: false,
    reviewBusy: false,
  };

  const WRITER_REVIEW_COPY = {
    ko: {
      sectionTitle: "원고 분석",
      sectionBody: "내 작품을 선택하고 원고를 붙여넣으면 실제 분석 응답으로 요약, 근거, 설정 검수를 확인합니다.",
      workLabel: "내 작품",
      workEmpty: "작품을 불러온 뒤 선택하세요",
      reloadWorks: "작품 새로고침",
      manuscriptLabel: "분석할 원고",
      manuscriptPlaceholder: "파트 제목과 원고를 붙여넣어 주세요. 원문은 보드나 로그에 기록하지 않습니다.",
      analyze: "원고 분석",
      openReview: "작성 완료 검수",
      loadingWorks: "내 작품을 불러오는 중입니다.",
      noWorks: "분석할 수 있는 내 작품이 없습니다.",
      loginRequired: "로그인 후 내 작품을 불러올 수 있습니다.",
      needWork: "작품을 선택해 주세요.",
      needManuscript: "분석할 원고를 입력해 주세요.",
      analyzing: "실제 분석을 요청하는 중입니다.",
      analysisReady: "분석 결과가 준비됐습니다.",
      analysisFailed: "분석을 완료하지 못했습니다.",
      continuityTitle: "설정 검수",
      evidenceTitle: "근거",
      gateClear: "발행 차단 없음",
      gateBlocked: "치명적 확인 필요",
      dialogTitle: "작성 완료 검수",
      dialogBody: "분석 요약, 스토리 제안, 설정 검수, 최종 확인 순서로 실제 review 상태를 확인합니다.",
      back: "원고로 돌아가기",
      next: "이상 없음, 최종 확인",
      finalDisabled: "최종본 올리기는 승인된 세션에서만 실행합니다.",
    },
    en: {
      sectionTitle: "Manuscript analysis",
      sectionBody: "Select one of your works and paste a manuscript to review summary, evidence, and continuity from real responses.",
      workLabel: "My work",
      workEmpty: "Load and choose a work",
      reloadWorks: "Reload works",
      manuscriptLabel: "Manuscript to analyze",
      manuscriptPlaceholder: "Paste a part title and manuscript. The raw text is not recorded on the board or logs.",
      analyze: "Analyze manuscript",
      openReview: "Completion review",
      loadingWorks: "Loading your works.",
      noWorks: "No owned works are available for analysis.",
      loginRequired: "Log in to load your works.",
      needWork: "Choose a work.",
      needManuscript: "Enter a manuscript to analyze.",
      analyzing: "Requesting the actual analysis.",
      analysisReady: "Analysis is ready.",
      analysisFailed: "Analysis could not be completed.",
      continuityTitle: "Continuity review",
      evidenceTitle: "Evidence",
      gateClear: "No publish blocker",
      gateBlocked: "Critical review required",
      dialogTitle: "Completion review",
      dialogBody: "Check the actual review state in summary, story proposal, continuity, and final confirmation order.",
      back: "Back to manuscript",
      next: "No issues, final confirmation",
      finalDisabled: "Final upload runs only in an approved session.",
    },
    ja: {
      sectionTitle: "原稿分析",
      sectionBody: "自分の作品を選び、原稿を貼り付けて実際の応答で要約、根拠、設定確認を確認します。",
      workLabel: "自分の作品",
      workEmpty: "作品を読み込んで選択",
      reloadWorks: "作品を再読み込み",
      manuscriptLabel: "分析する原稿",
      manuscriptPlaceholder: "パート題名と原稿を貼り付けてください。原文はボードやログに記録しません。",
      analyze: "原稿を分析",
      openReview: "完了レビュー",
      loadingWorks: "自分の作品を読み込んでいます。",
      noWorks: "分析できる自分の作品がありません。",
      loginRequired: "ログイン後に作品を読み込めます。",
      needWork: "作品を選択してください。",
      needManuscript: "分析する原稿を入力してください。",
      analyzing: "実際の分析を要求しています。",
      analysisReady: "分析結果の準備ができました。",
      analysisFailed: "分析を完了できませんでした。",
      continuityTitle: "設定確認",
      evidenceTitle: "根拠",
      gateClear: "公開ブロックなし",
      gateBlocked: "重大な確認が必要",
      dialogTitle: "完了レビュー",
      dialogBody: "要約、提案、設定確認、最終確認の順に実際のレビュー状態を確認します。",
      back: "原稿に戻る",
      next: "問題なし、最終確認",
      finalDisabled: "最終アップロードは承認されたセッションでのみ実行します。",
    },
    "zh-Hans": {
      sectionTitle: "稿件分析",
      sectionBody: "选择自己的作品并粘贴稿件，用实际响应查看摘要、依据和连续性检查。",
      workLabel: "我的作品",
      workEmpty: "加载并选择作品",
      reloadWorks: "重新加载作品",
      manuscriptLabel: "要分析的稿件",
      manuscriptPlaceholder: "粘贴分段标题和稿件。原文不会记录在看板或日志中。",
      analyze: "分析稿件",
      openReview: "完成审核",
      loadingWorks: "正在加载你的作品。",
      noWorks: "没有可分析的自有作品。",
      loginRequired: "登录后可加载作品。",
      needWork: "请选择作品。",
      needManuscript: "请输入要分析的稿件。",
      analyzing: "正在请求实际分析。",
      analysisReady: "分析结果已准备好。",
      analysisFailed: "未能完成分析。",
      continuityTitle: "连续性检查",
      evidenceTitle: "依据",
      gateClear: "无发布阻断",
      gateBlocked: "需要关键审核",
      dialogTitle: "完成审核",
      dialogBody: "按摘要、故事建议、连续性、最终确认顺序查看实际审核状态。",
      back: "返回稿件",
      next: "无问题，最终确认",
      finalDisabled: "最终上传仅在已批准会话中执行。",
    },
    "zh-Hant": {
      sectionTitle: "稿件分析",
      sectionBody: "選擇自己的作品並貼上稿件，用實際回應查看摘要、依據和連續性檢查。",
      workLabel: "我的作品",
      workEmpty: "載入並選擇作品",
      reloadWorks: "重新載入作品",
      manuscriptLabel: "要分析的稿件",
      manuscriptPlaceholder: "貼上分段標題和稿件。原文不會記錄在看板或日誌中。",
      analyze: "分析稿件",
      openReview: "完成審核",
      loadingWorks: "正在載入你的作品。",
      noWorks: "沒有可分析的自有作品。",
      loginRequired: "登入後可載入作品。",
      needWork: "請選擇作品。",
      needManuscript: "請輸入要分析的稿件。",
      analyzing: "正在請求實際分析。",
      analysisReady: "分析結果已準備好。",
      analysisFailed: "未能完成分析。",
      continuityTitle: "連續性檢查",
      evidenceTitle: "依據",
      gateClear: "無發布阻斷",
      gateBlocked: "需要關鍵審核",
      dialogTitle: "完成審核",
      dialogBody: "按摘要、故事建議、連續性、最終確認順序查看實際審核狀態。",
      back: "返回稿件",
      next: "無問題，最終確認",
      finalDisabled: "最終上傳僅在已核准工作階段中執行。",
    },
  };

  function resolveLocale() {
    const value = window.luminaI18n?.getLocale?.() || "ko";
    if (value === "zh-CN") return "zh-Hans";
    if (value === "zh-TW" || value === "zh-HK") return "zh-Hant";
    return COPY[value] ? value : "ko";
  }

  function tr(key) {
    return COPY[state.locale]?.[key] || COPY.ko[key] || key;
  }

  function writerTr(key) {
    return WRITER_REVIEW_COPY[state.locale]?.[key] || WRITER_REVIEW_COPY.ko[key] || "";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function textValue(value) {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return "";
    const regional = state.locale === "ko" ? "ko-KR" : state.locale === "en" ? "en-US" : state.locale === "ja" ? "ja-JP" : state.locale === "zh-Hans" ? "zh-CN" : "zh-Hant";
    return value[state.locale] || value[regional] || value.ko || value["ko-KR"] || value.en || value["en-US"] || "";
  }

  async function apiJson(path, options = {}) {
    if (typeof window.apiFetch === "function") {
      return window.apiFetch(path, { ...options, auth: true, throwOnError: true });
    }
    const token = getToken();
    const response = await fetch(`${API_ORIGIN}${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }

  function selectedWork() {
    return state.writerStories.find((story) => story.workId === state.writerReview.workId || story.id === state.writerReview.workId) || null;
  }

  function storyTitle(story) {
    return textValue(story?.title) || textValue(story?.displayTitle) || textValue(story?.summary) || "";
  }

  function parseManuscript(text) {
    const lines = String(text || "").split(/\r?\n/);
    const title = lines.find((line) => line.trim())?.trim().slice(0, 120) || "Part 1";
    const paragraphs = lines
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 5000)
      .map((line) => ({
        kind: /^#{1,6}\s+/.test(line) ? "title" : /^[-*]{3,}$/.test(line) ? "scene_break" : /^["“「]/.test(line) ? "dialogue" : "paragraph",
        text: line.replace(/^#{1,6}\s+/, "").slice(0, 10000),
      }));
    return [{ partKey: "part-1", title, paragraphs: paragraphs.length ? paragraphs : [{ kind: "paragraph", text: String(text || "").trim().slice(0, 10000) }] }];
  }

  function analysisCounts() {
    const result = state.writerReview.analysis?.job?.result || state.writerReview.analysis?.result || {};
    return Object.entries(result)
      .filter(([, value]) => typeof value === "number" || typeof value === "string")
      .slice(0, 8);
  }

  function renderWriterReviewResults() {
    const counts = analysisCounts();
    const evidence = Array.isArray(state.writerReview.analysis?.evidence) ? state.writerReview.analysis.evidence.slice(0, 8) : [];
    const continuity = state.writerReview.continuity || {};
    const issues = Array.isArray(continuity.issues) ? continuity.issues.slice(0, 6) : [];
    const entries = Array.isArray(continuity.entries) ? continuity.entries.slice(0, 6) : [];
    if (!counts.length && !evidence.length && !issues.length && !entries.length) return "";
    return `
      <section class="su-review-results">
        ${counts.length ? `<div class="su-review-card"><h3>${escapeHtml(window.luminaI18n?.t?.("writerReview.analysis.summary.title") || writerTr("sectionTitle"))}</h3><dl>${counts.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl></div>` : ""}
        ${evidence.length ? `<div class="su-review-card"><h3>${escapeHtml(writerTr("evidenceTitle"))}</h3><ul>${evidence.map((item) => `<li><strong>${escapeHtml(item.evidenceType || item.kind || "evidence")}</strong><span>${escapeHtml(item.sourcePartKey || "")}${Number.isInteger(item.sourceParagraphIndex) ? ` · ${item.sourceParagraphIndex + 1}` : ""}</span></li>`).join("")}</ul></div>` : ""}
        ${(issues.length || entries.length) ? `<div class="su-review-card"><h3>${escapeHtml(writerTr("continuityTitle"))}</h3><p>${escapeHtml(continuity.publishGate?.blocked ? writerTr("gateBlocked") : writerTr("gateClear"))}</p><ul>${issues.map((issue) => `<li><strong>${escapeHtml(issue.severity || "warning")}</strong><span>${escapeHtml(issue.issueType || issue.status || "")}</span></li>`).join("")}${entries.map((entry) => `<li><strong>${escapeHtml(entry.entryType || "entry")}</strong><span>${escapeHtml(entry.label || entry.status || "")}</span></li>`).join("")}</ul></div>` : ""}
      </section>`;
  }

  function renderWriterReviewDialog() {
    if (!state.writerReview.dialogOpen) return "";
    const review = state.writerReview.review || {};
    return `
      <div class="su-review-dialog" role="dialog" aria-modal="true" aria-labelledby="writerReviewDialogTitle">
        <div class="su-review-dialog-panel">
          <h2 id="writerReviewDialogTitle">${escapeHtml(writerTr("dialogTitle"))}</h2>
          <p>${escapeHtml(writerTr("dialogBody"))}</p>
          <ol>
            <li>${escapeHtml(window.luminaI18n?.t?.("writerReview.dialog.step.summary") || "Summary")}</li>
            <li>${escapeHtml(window.luminaI18n?.t?.("writerReview.dialog.step.story") || "Story proposal")}</li>
            <li>${escapeHtml(window.luminaI18n?.t?.("writerReview.dialog.step.continuity") || "Continuity review")}</li>
            <li>${escapeHtml(window.luminaI18n?.t?.("writerReview.dialog.step.final") || "Final confirmation")}</li>
          </ol>
          <p class="su-review-state">${escapeHtml(review.state || "")}</p>
          <div>
            <button type="button" class="su-file-button" data-close-review-dialog>${escapeHtml(writerTr("back"))}</button>
            <button type="button" class="su-submit" data-review-final-confirm ${review.reviewId && review.revision && nextReviewState(review.state) ? "" : "disabled"}>${escapeHtml(writerTr("next"))}</button>
            <button type="button" class="su-file-button" disabled>${escapeHtml(writerTr("finalDisabled"))}</button>
          </div>
        </div>
      </div>`;
  }

  function nextReviewState(current) {
    return {
      analysis_ready: "summary_review",
      summary_review: "proposal_review",
      proposal_review: "continuity_review",
      continuity_review: "final_confirmation",
      submission_failed: "submission_pending",
    }[current] || "";
  }

  function renderWriterReviewPanel() {
    const selected = selectedWork();
    return `
      <section class="su-section su-review-panel">
        <div class="su-review-heading">
          <div>
            <h2>${escapeHtml(writerTr("sectionTitle"))}</h2>
            <p>${escapeHtml(writerTr("sectionBody"))}</p>
          </div>
          <button type="button" class="su-file-button" data-load-writer-stories>${escapeHtml(writerTr("reloadWorks"))}</button>
        </div>
        <div class="su-grid">
          <label class="su-field">
            <span>${escapeHtml(writerTr("workLabel"))}</span>
            <select name="writerWorkId" data-writer-work>
              <option value="">${escapeHtml(writerTr("workEmpty"))}</option>
              ${state.writerStories.map((story) => {
                const id = story.workId || story.id || "";
                return id ? `<option value="${escapeHtml(id)}"${id === state.writerReview.workId ? " selected" : ""}>${escapeHtml(storyTitle(story) || id)}</option>` : "";
              }).join("")}
            </select>
          </label>
          <label class="su-field">
            <span>${escapeHtml(selected ? storyTitle(selected) : writerTr("workLabel"))}</span>
            <input value="${escapeHtml(selected?.permission?.role || selected?.publication?.status || "")}" readonly />
          </label>
        </div>
        <label class="su-field su-review-textarea">
          <span>${escapeHtml(writerTr("manuscriptLabel"))}</span>
          <textarea name="writerManuscript" data-writer-manuscript rows="10" maxlength="50000" placeholder="${escapeHtml(writerTr("manuscriptPlaceholder"))}"></textarea>
        </label>
        <div class="su-submit-row">
          <p class="su-form-status" data-review-status role="status"></p>
          <div class="su-review-actions">
            <button type="button" class="su-submit" data-run-writer-analysis ${state.reviewBusy ? "disabled" : ""}>${escapeHtml(writerTr("analyze"))}</button>
            <button type="button" class="su-file-button" data-open-review-dialog ${state.writerReview.analysisId ? "" : "disabled"}>${escapeHtml(writerTr("openReview"))}</button>
          </div>
        </div>
        ${renderWriterReviewResults()}
        ${renderWriterReviewDialog()}
      </section>`;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function localeOptions() {
    return [
      ["ko", "한국어"],
      ["en", "English"],
      ["ja", "日本語"],
      ["zh-Hans", "简体中文"],
      ["zh-Hant", "繁體中文"],
    ].map(([value, label]) => `<option value="${value}"${value === state.locale ? " selected" : ""}>${label}</option>`).join("");
  }

  function fileField(name, label, acceptLabel, accept, multiple = true) {
    return `
      <section class="su-file-field" data-file-group="${name}">
        <div class="su-file-heading">
          <span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(acceptLabel)}</small></span>
          <label class="su-file-button">
            ${escapeHtml(tr("choose"))}
            <input type="file" name="${name}" accept="${accept}"${multiple ? " multiple" : ""} />
          </label>
        </div>
        <div class="su-file-list" data-file-list="${name}">${renderFileList(name)}</div>
      </section>`;
  }

  function renderFileList(group) {
    const files = state.files[group];
    if (!files.length) return `<p class="su-no-files">${escapeHtml(tr("noFiles"))}</p>`;
    return `<ul>${files.map((file, index) => `
      <li>
        <span><strong>${escapeHtml(file.name)}</strong><small>${escapeHtml(formatBytes(file.size))}</small></span>
        <button type="button" data-remove-file="${group}" data-file-index="${index}" aria-label="${escapeHtml(`${tr("remove")} ${file.name}`)}">×</button>
      </li>`).join("")}</ul>`;
  }

  function renderForm() {
    root.innerHTML = `
      <div class="su-shell">
        <header class="su-header">
          <div>
            <p class="su-eyebrow">${escapeHtml(tr("eyebrow"))}</p>
            <h1>${escapeHtml(tr("title"))}</h1>
            <p>${escapeHtml(tr("description"))}</p>
          </div>
          <div class="su-locale" aria-label="Language">
            ${LOCALES.map((locale) => `<button type="button" data-locale="${locale}" aria-pressed="${locale === state.locale}">${locale === "zh-Hans" ? "简" : locale === "zh-Hant" ? "繁" : locale.toUpperCase()}</button>`).join("")}
          </div>
        </header>

        ${renderWriterReviewPanel()}

        <form class="su-final-form" data-final-upload-form novalidate>
          <section class="su-section">
            <h2>${escapeHtml(tr("workInfo"))}</h2>
            <div class="su-grid">
              <label class="su-field">
                <span>${escapeHtml(tr("workTitle"))}</span>
                <input name="title" maxlength="120" autocomplete="off" placeholder="${escapeHtml(tr("workTitlePlaceholder"))}" required />
              </label>
              <label class="su-field">
                <span>${escapeHtml(tr("originalLocale"))}</span>
                <select name="originalLocale">${localeOptions()}</select>
              </label>
              <label class="su-field">
                <span>${escapeHtml(tr("rightsType"))}</span>
                <select name="sourceClass" data-rights-type>
                  <option value="original">${escapeHtml(tr("rightsOriginal"))}</option>
                  <option value="public_domain">${escapeHtml(tr("rightsPublic"))}</option>
                  <option value="licensed_ip">${escapeHtml(tr("rightsLicensed"))}</option>
                </select>
              </label>
              <label class="su-field" data-rights-reference hidden>
                <span>${escapeHtml(tr("rightsReference"))}</span>
                <input name="rightsReference" maxlength="180" autocomplete="off" placeholder="${escapeHtml(tr("rightsReferencePlaceholder"))}" />
              </label>
            </div>
          </section>

          ${fileField("manuscripts", tr("manuscript"), tr("manuscriptAccept"), ".md,.txt,.docx,.pdf,.json")}
          ${fileField("metadata", tr("metadata"), tr("metadataAccept"), ".json,.csv")}
          ${fileField("visuals", tr("visuals"), tr("visualsAccept"), "image/jpeg,image/png,image/webp")}

          <label class="su-confirm">
            <input type="checkbox" name="finalConfirmed" />
            <span>${escapeHtml(tr("finalConfirm"))}</span>
          </label>

          <div class="su-submit-row">
            <p class="su-form-status" data-upload-status role="status"></p>
            <button type="submit" class="su-submit">${escapeHtml(tr("submit"))}</button>
          </div>
        </form>
      </div>`;
  }

  function refreshFileList(group) {
    const target = root.querySelector(`[data-file-list="${group}"]`);
    if (target) target.innerHTML = renderFileList(group);
  }

  function totalBytes() {
    return Object.values(state.files).flat().reduce((sum, file) => sum + file.size, 0);
  }

  function setStatus(message, kind = "") {
    const target = root.querySelector("[data-upload-status]");
    if (!target) return;
    target.textContent = message;
    target.dataset.kind = kind;
  }

  function setReviewStatus(message, kind = "") {
    const target = root.querySelector("[data-review-status]");
    if (!target) return;
    target.textContent = message;
    target.dataset.kind = kind;
  }

  function getToken() {
    if (typeof window.getAccessToken === "function") return window.getAccessToken();
    try {
      return JSON.parse(localStorage.getItem("lumina_auth") || "null")?.accessToken || "";
    } catch (_) {
      return "";
    }
  }

  function validate(form) {
    if (!form.elements.title.value.trim()) return tr("requiredTitle");
    if (!state.files.manuscripts.length) return tr("requiredManuscript");
    if (form.elements.sourceClass.value === "licensed_ip" && !form.elements.rightsReference.value.trim()) return tr("requiredRights");
    if (!form.elements.finalConfirmed.checked) return tr("requiredConfirm");
    if (totalBytes() > MAX_TOTAL_BYTES) return tr("tooLarge");
    return "";
  }

  async function loadWriterStories() {
    if (!getToken()) {
      setReviewStatus(writerTr("loginRequired"), "error");
      if (typeof window.openAuthModal === "function") window.openAuthModal("login", { returnTo: { href: "/story-upload", label: writerTr("sectionTitle") } });
      return;
    }
    setReviewStatus(writerTr("loadingWorks"));
    try {
      const payload = await apiJson("/api/v1/me/creator-studio/stories");
      const list = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.stories) ? payload.stories : [];
      state.writerStories = list;
      if (!state.writerReview.workId && list[0]) state.writerReview.workId = list[0].workId || list[0].id || "";
      renderForm();
      setReviewStatus(list.length ? "" : writerTr("noWorks"), list.length ? "" : "error");
    } catch (error) {
      setReviewStatus(error?.status === 401 ? writerTr("loginRequired") : writerTr("analysisFailed"), "error");
    }
  }

  async function runWriterAnalysis() {
    const text = root.querySelector("[data-writer-manuscript]")?.value || "";
    const workId = state.writerReview.workId;
    if (!workId) return setReviewStatus(writerTr("needWork"), "error");
    if (!text.trim()) return setReviewStatus(writerTr("needManuscript"), "error");
    if (!getToken()) return setReviewStatus(writerTr("loginRequired"), "error");
    state.reviewBusy = true;
    setReviewStatus(writerTr("analyzing"));
    try {
      const manuscriptPayload = await apiJson(`/api/v1/me/creator-studio/stories/${encodeURIComponent(workId)}/manuscripts`, {
        method: "POST",
        body: { locale: state.locale, parts: parseManuscript(text) },
      });
      const manuscriptId = manuscriptPayload?.manuscript?.id || manuscriptPayload?.id;
      if (!manuscriptId) throw new Error("Missing manuscript id");
      const analysisJob = await apiJson(`/api/v1/me/creator-studio/manuscripts/${encodeURIComponent(manuscriptId)}/analyses`, {
        method: "POST",
        headers: { "Idempotency-Key": `writer-analysis-${Date.now()}` },
      });
      const analysisId = analysisJob?.id || analysisJob?.job?.id;
      if (!analysisId) throw new Error("Missing analysis id");
      const [analysis, continuity] = await Promise.all([
        apiJson(`/api/v1/me/creator-studio/analyses/${encodeURIComponent(analysisId)}`),
        apiJson(`/api/v1/me/creator-studio/stories/${encodeURIComponent(workId)}/continuity`),
      ]);
      state.writerReview = {
        ...state.writerReview,
        manuscriptId,
        analysisId,
        analysis,
        continuity,
        review: null,
        reviewId: "",
        revision: 0,
      };
      renderForm();
      setReviewStatus(writerTr("analysisReady"));
    } catch (_) {
      setReviewStatus(writerTr("analysisFailed"), "error");
    } finally {
      state.reviewBusy = false;
    }
  }

  async function openWriterReviewDialog() {
    if (!state.writerReview.workId || !state.writerReview.manuscriptId || !state.writerReview.analysisId) {
      return setReviewStatus(writerTr("analysisFailed"), "error");
    }
    try {
      const review = await apiJson(`/api/v1/me/creator-studio/stories/${encodeURIComponent(state.writerReview.workId)}/reviews`, {
        method: "POST",
        body: {
          manuscriptVersionId: state.writerReview.manuscriptId,
          analysisJobId: state.writerReview.analysisId,
        },
      });
      state.writerReview = {
        ...state.writerReview,
        review,
        reviewId: review?.reviewId || "",
        revision: Number(review?.revision || 0),
        dialogOpen: true,
      };
      renderForm();
    } catch (_) {
      setReviewStatus(writerTr("analysisFailed"), "error");
    }
  }

  async function confirmWriterReviewFinal() {
    const review = state.writerReview.review;
    if (!review?.reviewId || !review?.revision) return;
    const toState = nextReviewState(review.state);
    if (!toState) return;
    try {
      const updated = await apiJson(`/api/v1/me/creator-studio/reviews/${encodeURIComponent(review.reviewId)}/transition`, {
        method: "POST",
        body: {
          toState,
          expectedRevision: review.revision,
          decisions: { warningAcknowledged: true },
        },
      });
      state.writerReview = {
        ...state.writerReview,
        review: updated,
        reviewId: updated?.reviewId || review.reviewId,
        revision: Number(updated?.revision || review.revision),
        dialogOpen: true,
      };
      renderForm();
    } catch (_) {
      setReviewStatus(writerTr("analysisFailed"), "error");
    }
  }

  function buildPayload(form) {
    const payload = new FormData();
    payload.append("title", form.elements.title.value.trim());
    payload.append("originalLocale", form.elements.originalLocale.value);
    payload.append("sourceClass", form.elements.sourceClass.value);
    payload.append("rightsReference", form.elements.rightsReference.value.trim());
    payload.append("submissionType", "final");
    state.files.manuscripts.forEach((file) => payload.append("manuscripts", file, file.name));
    state.files.metadata.forEach((file) => payload.append("metadata", file, file.name));
    state.files.visuals.forEach((file) => payload.append("visuals", file, file.name));
    return payload;
  }

  async function submit(form) {
    if (state.busy) return;
    const validationError = validate(form);
    if (validationError) return setStatus(validationError, "error");
    const token = getToken();
    if (!token) {
      setStatus(tr("loginRequired"), "error");
      if (typeof window.openAuthModal === "function") window.openAuthModal("login", { returnTo: { href: "/story-upload", label: tr("title") } });
      return;
    }

    state.busy = true;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    setStatus(tr("submitting"));
    try {
      const response = await fetch(`${API_ORIGIN}/api/v1/story-upload/intake`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: buildPayload(form),
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      renderSuccess();
    } catch (error) {
      setStatus(error?.status === 404 || error?.status === 501 ? tr("serviceUnavailable") : tr("submitFailed"), "error");
      button.disabled = false;
      state.busy = false;
    }
  }

  function renderSuccess() {
    root.innerHTML = `
      <section class="su-success">
        <span aria-hidden="true">✓</span>
        <h1>${escapeHtml(tr("submitted"))}</h1>
        <p>${escapeHtml(tr("submittedBody"))}</p>
        <button type="button" class="su-submit" data-upload-another>${escapeHtml(tr("uploadAnother"))}</button>
      </section>`;
  }

  root.addEventListener("change", (event) => {
    const input = event.target.closest("input[type=file]");
    if (input && state.files[input.name]) {
      state.files[input.name] = Array.from(input.files || []);
      refreshFileList(input.name);
      input.value = "";
      setStatus("");
      return;
    }
    if (event.target.matches("[data-rights-type]")) {
      const field = root.querySelector("[data-rights-reference]");
      field.hidden = event.target.value !== "licensed_ip";
      field.querySelector("input").required = event.target.value === "licensed_ip";
    }
    if (event.target.matches("[data-writer-work]")) {
      state.writerReview = { ...state.writerReview, workId: event.target.value };
      setReviewStatus("");
    }
  });

  root.addEventListener("click", async (event) => {
    if (event.target.closest("[data-load-writer-stories]")) return loadWriterStories();
    if (event.target.closest("[data-run-writer-analysis]")) return runWriterAnalysis();
    if (event.target.closest("[data-open-review-dialog]")) return openWriterReviewDialog();
    if (event.target.closest("[data-close-review-dialog]")) {
      state.writerReview.dialogOpen = false;
      renderForm();
      return;
    }
    if (event.target.closest("[data-review-final-confirm]")) return confirmWriterReviewFinal();
    const localeButton = event.target.closest("[data-locale]");
    if (localeButton) {
      const form = root.querySelector("[data-final-upload-form]");
      const manuscriptText = root.querySelector("[data-writer-manuscript]")?.value || "";
      const values = form ? {
        title: form.elements.title.value,
        originalLocale: form.elements.originalLocale.value,
        sourceClass: form.elements.sourceClass.value,
        rightsReference: form.elements.rightsReference.value,
        finalConfirmed: form.elements.finalConfirmed.checked,
      } : null;
      state.locale = localeButton.dataset.locale;
      if (window.luminaI18n?.setLocale) await window.luminaI18n.setLocale(state.locale);
      renderForm();
      const reviewInput = root.querySelector("[data-writer-manuscript]");
      if (reviewInput) reviewInput.value = manuscriptText;
      if (values) {
        const nextForm = root.querySelector("[data-final-upload-form]");
        Object.entries(values).forEach(([key, value]) => {
          if (nextForm.elements[key]?.type === "checkbox") nextForm.elements[key].checked = value;
          else if (nextForm.elements[key]) nextForm.elements[key].value = value;
        });
        nextForm.elements.sourceClass.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }
    const removeButton = event.target.closest("[data-remove-file]");
    if (removeButton) {
      const group = removeButton.dataset.removeFile;
      state.files[group].splice(Number(removeButton.dataset.fileIndex), 1);
      refreshFileList(group);
      setStatus("");
      return;
    }
    if (event.target.closest("[data-upload-another]")) {
      state.files = { manuscripts: [], metadata: [], visuals: [] };
      state.busy = false;
      renderForm();
    }
  });

  root.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-final-upload-form]");
    if (!form) return;
    event.preventDefault();
    submit(form);
  });

  renderForm();
})();

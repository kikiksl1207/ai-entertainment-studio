(function initCreatorVisualReview() {
  "use strict";
  const inspector = document.getElementById("writerVisualReferencesViewer");
  const parent = document.getElementById("writerVisualReferences");
  const modal = document.getElementById("writerFinalModal");
  if (!inspector || !parent || !modal) return;
  const hashPattern = /^[a-f0-9]{64}$/;
  const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  const keyPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
  const copy = {
    ko: {
      title: "원작 장면 시각 지시", prompt: "검토할 지시문", save: "초안 저장", approve: "장면 지시 승인",
      reviewed: "이 장면의 의미, 스타일, 등장인물과 시간을 원문과 대조하여 검토했습니다.",
      loading: "불러오는 중…", saving: "저장 중…", approving: "승인 중…", unsaved: "미저장 초안",
      saved: "초안 저장됨", approved: "장면 지시 승인됨", failed: "저장하지 못했습니다. 다시 시도해 주세요.",
      approveFailed: "승인을 확인하지 못했습니다. 다시 검토해 주세요.",
      changed: "원고 또는 스토리 설정이 달라졌습니다. 검토를 다시 열어 주세요.",
      discard: "이 장면의 저장하지 않은 변경을 버릴까요?",
      representativeTitle: "파트 대표 가이드", representativeReviewed: "이 가이드가 ‘{part}’ 파트 전체에 적합함을 확인했습니다.",
      selectRepresentative: "대표로 선택", clearRepresentative: "대표 선택 해제",
      representativeNone: "‘{part}’의 대표 가이드가 선택되지 않았습니다.",
      representativeSelected: "이 가이드가 ‘{part}’의 대표로 선택되었습니다.",
      representativeOther: "‘{part}’에는 다른 가이드가 대표로 선택되어 있습니다.",
      representativeStale: "‘{part}’의 이전 대표 선택은 더 이상 유효하지 않습니다.",
      representativeEdited: "편집 내용이 승인되지 않아 대표 선택을 확인할 수 없습니다.",
      selectingRepresentative: "대표 선택 확인 중…", clearingRepresentative: "대표 해제 확인 중…",
      selectRepresentativeFailed: "대표 선택을 확인하지 못했습니다. 다시 검토한 뒤 시도해 주세요.",
      clearRepresentativeFailed: "대표 해제를 확인하지 못했습니다. 다시 시도해 주세요.",
      unavailable: "이 장면은 지금 검토할 수 없습니다. 원문과 승인된 스토리 설정을 확인한 뒤 다시 열어 주세요.",
      proposal: {
        title: "제안된 장면 시각 가이드", prompt: "검토할 제안 가이드", approve: "제안된 장면 가이드 승인",
        reviewed: "이 제안 가이드의 의미, 스타일, 등장인물과 시간을 원문과 대조하여 검토했습니다.", approved: "제안된 장면 가이드 승인됨",
        representativeTitle: "파트 대표 제안 가이드", representativeReviewed: "이 제안 가이드가 ‘{part}’ 파트 전체에 적합함을 확인했습니다.",
        representativeNone: "‘{part}’의 대표 제안 가이드가 선택되지 않았습니다.",
        representativeSelected: "이 제안 가이드가 ‘{part}’의 대표로 선택되었습니다.",
        representativeOther: "‘{part}’에는 다른 제안 가이드가 대표로 선택되어 있습니다."
      }
    },
    en: {
      title: "Original Scene Visual Directive", prompt: "Directive to review", save: "Save Draft", approve: "Approve Scene Directive",
      reviewed: "I reviewed this scene's meaning, style, cast and time against the source.",
      loading: "Loading…", saving: "Saving…", approving: "Approving…", unsaved: "Unsaved draft",
      saved: "Draft saved", approved: "Scene directive approved", failed: "Could not save. Please retry.",
      approveFailed: "Approval could not be confirmed. Please review again.",
      changed: "The manuscript or story settings changed. Reopen the review.",
      discard: "Discard unsaved changes to this scene?",
      representativeTitle: "Part Representative Guide", representativeReviewed: "I confirm this guide fits the whole part, “{part}”.",
      selectRepresentative: "Select Representative", clearRepresentative: "Clear Representative",
      representativeNone: "No representative guide is selected for “{part}”.",
      representativeSelected: "This guide is selected to represent “{part}”.",
      representativeOther: "Another guide is selected to represent “{part}”.",
      representativeStale: "The previous representative selection for “{part}” is no longer current.",
      representativeEdited: "The edits are not approved; representative selection cannot be confirmed.",
      selectingRepresentative: "Confirming selection…", clearingRepresentative: "Confirming removal…",
      selectRepresentativeFailed: "Selection could not be confirmed. Review and retry.",
      clearRepresentativeFailed: "Removal could not be confirmed. Please retry.",
      unavailable: "This scene cannot be reviewed now. Check the source and approved story settings, then reopen the review.",
      proposal: {
        title: "Proposed Scene Visual Guidance", prompt: "Proposed guidance to review", approve: "Approve Proposed Scene Guidance",
        reviewed: "I reviewed this proposed guide's meaning, style, cast and time against the source.", approved: "Proposed scene guidance approved",
        representativeTitle: "Part Representative Proposed Guide", representativeReviewed: "I confirm this proposed guide fits the whole part, “{part}”.",
        representativeNone: "No representative proposed guide is selected for “{part}”.",
        representativeSelected: "This proposed guide is selected to represent “{part}”.",
        representativeOther: "Another proposed guide is selected to represent “{part}”."
      }
    },
    ja: {
      title: "原作シーンのビジュアル指示", prompt: "確認する指示文", save: "下書きを保存", approve: "シーン指示を承認",
      reviewed: "このシーンの意味、スタイル、登場人物と時間を原文と照合して確認しました。",
      loading: "読み込み中…", saving: "保存中…", approving: "承認中…", unsaved: "未保存の下書き",
      saved: "下書き保存済み", approved: "シーン指示承認済み", failed: "保存できませんでした。再試行してください。",
      approveFailed: "承認を確認できませんでした。もう一度確認してください。",
      changed: "原稿またはストーリー設定が変更されました。確認を開き直してください。",
      discard: "このシーンの未保存の変更を破棄しますか？",
      representativeTitle: "パートの代表ガイド", representativeReviewed: "このガイドが「{part}」のパート全体に適していることを確認しました。",
      selectRepresentative: "代表として選択", clearRepresentative: "代表の選択を解除",
      representativeNone: "「{part}」の代表ガイドは選択されていません。",
      representativeSelected: "このガイドが「{part}」の代表として選択されています。",
      representativeOther: "「{part}」には別のガイドが代表として選択されています。",
      representativeStale: "「{part}」の以前の代表選択は現在有効ではありません。",
      representativeEdited: "編集内容は未承認のため、代表選択を確認できません。",
      selectingRepresentative: "代表選択を確認中…", clearingRepresentative: "代表解除を確認中…",
      selectRepresentativeFailed: "代表選択を確認できませんでした。確認して再試行してください。",
      clearRepresentativeFailed: "代表解除を確認できませんでした。再試行してください。",
      unavailable: "現在このシーンは確認できません。原文と承認済みのストーリー設定を確認し、開き直してください。",
      proposal: {
        title: "提案されたシーンのビジュアルガイド", prompt: "確認する提案ガイド", approve: "提案されたシーンガイドを承認",
        reviewed: "この提案ガイドの意味、スタイル、登場人物と時間を原文と照合して確認しました。", approved: "提案されたシーンガイド承認済み",
        representativeTitle: "パートの代表提案ガイド", representativeReviewed: "この提案ガイドが「{part}」のパート全体に適していることを確認しました。",
        representativeNone: "「{part}」の代表提案ガイドは選択されていません。",
        representativeSelected: "この提案ガイドが「{part}」の代表として選択されています。",
        representativeOther: "「{part}」には別の提案ガイドが代表として選択されています。"
      }
    },
    "zh-Hans": {
      title: "原作场景视觉指示", prompt: "待审阅的指示", save: "保存草稿", approve: "批准场景指示",
      reviewed: "我已对照原文审阅此场景的含义、风格、登场人物和时间。",
      loading: "正在加载…", saving: "正在保存…", approving: "正在批准…", unsaved: "未保存的草稿",
      saved: "草稿已保存", approved: "场景指示已批准", failed: "无法保存。请重试。",
      approveFailed: "无法确认批准结果。请重新审阅。",
      changed: "稿件或故事设置已更改。请重新打开审阅。",
      discard: "要放弃此场景尚未保存的更改吗？",
      representativeTitle: "部分代表指南", representativeReviewed: "我确认此指南适用于“{part}”整个部分。",
      selectRepresentative: "选为代表", clearRepresentative: "清除代表选择",
      representativeNone: "尚未为“{part}”选择代表指南。",
      representativeSelected: "此指南已选为“{part}”的代表。",
      representativeOther: "“{part}”已选择其他指南作为代表。",
      representativeStale: "“{part}”之前的代表选择已不再有效。",
      representativeEdited: "编辑内容尚未批准，无法确认代表选择。",
      selectingRepresentative: "正在确认代表选择…", clearingRepresentative: "正在确认清除…",
      selectRepresentativeFailed: "无法确认代表选择。请重新审阅后重试。",
      clearRepresentativeFailed: "无法确认清除结果。请重试。",
      unavailable: "暂时无法审阅此场景。请检查原文及已批准的故事设置后重新打开。",
      proposal: {
        title: "建议的场景视觉指南", prompt: "待审阅的建议指南", approve: "批准建议的场景指南",
        reviewed: "我已对照原文审阅此建议指南的含义、风格、登场人物和时间。", approved: "建议的场景指南已批准",
        representativeTitle: "部分代表建议指南", representativeReviewed: "我确认此建议指南适用于“{part}”整个部分。",
        representativeNone: "尚未为“{part}”选择代表建议指南。",
        representativeSelected: "此建议指南已选为“{part}”的代表。",
        representativeOther: "“{part}”已选择其他建议指南作为代表。"
      }
    },
    "zh-Hant": {
      title: "原作場景視覺指示", prompt: "待審閱的指示", save: "儲存草稿", approve: "核准場景指示",
      reviewed: "我已對照原文審閱此場景的含義、風格、登場人物和時間。",
      loading: "正在載入…", saving: "正在儲存…", approving: "正在核准…", unsaved: "未儲存的草稿",
      saved: "草稿已儲存", approved: "場景指示已核准", failed: "無法儲存。請重試。",
      approveFailed: "無法確認核准結果。請重新審閱。",
      changed: "稿件或故事設定已變更。請重新開啟審閱。",
      discard: "要捨棄此場景尚未儲存的變更嗎？",
      representativeTitle: "部分代表指南", representativeReviewed: "我確認此指南適用於「{part}」整個部分。",
      selectRepresentative: "選為代表", clearRepresentative: "清除代表選擇",
      representativeNone: "尚未為「{part}」選擇代表指南。",
      representativeSelected: "此指南已選為「{part}」的代表。",
      representativeOther: "「{part}」已選擇其他指南作為代表。",
      representativeStale: "「{part}」之前的代表選擇已不再有效。",
      representativeEdited: "編輯內容尚未核准，無法確認代表選擇。",
      selectingRepresentative: "正在確認代表選擇…", clearingRepresentative: "正在確認清除…",
      selectRepresentativeFailed: "無法確認代表選擇。請重新審閱後重試。",
      clearRepresentativeFailed: "無法確認清除結果。請重試。",
      unavailable: "暫時無法審閱此場景。請檢查原文及已核准的故事設定後重新開啟。",
      proposal: {
        title: "建議的場景視覺指南", prompt: "待審閱的建議指南", approve: "核准建議的場景指南",
        reviewed: "我已對照原文審閱此建議指南的含義、風格、登場人物和時間。", approved: "建議的場景指南已核准",
        representativeTitle: "部分代表建議指南", representativeReviewed: "我確認此建議指南適用於「{part}」整個部分。",
        representativeNone: "尚未為「{part}」選擇代表建議指南。",
        representativeSelected: "此建議指南已選為「{part}」的代表。",
        representativeOther: "「{part}」已選擇其他建議指南作為代表。"
      }
    }
  };
  function element(tag, suffix, container) {
    const node = document.createElement(tag);
    node.id = "writerVisualReview" + suffix;
    container.append(node);
    return node;
  }
  const root = element("section", "", inspector);
  root.setAttribute("aria-labelledby", "writerVisualReviewTitle");
  const title = element("h4", "Title", root);
  const label = element("label", "Label", root);
  label.setAttribute("for", "writerVisualReviewPrompt");
  const prompt = element("textarea", "Prompt", root);
  prompt.maxLength = 32000;
  prompt.rows = 10;
  prompt.spellcheck = false;
  const status = element("p", "Status", root);
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const reviewLabel = element("label", "ReviewLabel", root);
  reviewLabel.className = "visual-review-confirm";
  const reviewed = element("input", "Reviewed", reviewLabel);
  reviewed.type = "checkbox";
  const reviewText = element("span", "ReviewText", reviewLabel);
  const actions = element("div", "Actions", root);
  actions.className = "visual-review-actions";
  const save = element("button", "Save", actions);
  const approve = element("button", "Approve", actions);
  save.type = approve.type = "button";
  save.className = "secondary-action";
  approve.className = "primary-action";
  const representativeRoot = element("section", "Representative", root);
  representativeRoot.setAttribute("aria-labelledby", "writerVisualReviewRepresentativeTitle");
  const representativeTitle = element("h5", "RepresentativeTitle", representativeRoot);
  const representativeStatus = element("p", "RepresentativeStatus", representativeRoot);
  representativeStatus.setAttribute("role", "status");
  representativeStatus.setAttribute("aria-live", "polite");
  const representativeLabel = element("label", "RepresentativeLabel", representativeRoot);
  representativeLabel.className = "visual-review-confirm";
  const representativeReviewed = element("input", "RepresentativeReviewed", representativeLabel);
  representativeReviewed.type = "checkbox";
  const representativeText = element("span", "RepresentativeText", representativeLabel);
  const representativeActions = element("div", "RepresentativeActions", representativeRoot);
  representativeActions.className = "visual-review-actions";
  const selectRepresentative = element("button", "SelectRepresentative", representativeActions);
  const clearRepresentative = element("button", "ClearRepresentative", representativeActions);
  selectRepresentative.type = clearRepresentative.type = "button";
  selectRepresentative.className = "primary-action";
  clearRepresentative.className = "secondary-action";

  let scope = null;
  let context = null;
  let saved = null;
  let representative = null;
  let representativeStatusKey = null;
  const representativeAttempts = new Map();
  const attempts = new Map();
  let controller = null;
  let revision = 0;
  let timer = null;
  let busy = false;
  let blocked = false;
  let edited = false;
  let statusKey = null;
  const validText = (value, limit) => typeof value === "string" && value.length > 0 && value.length <= limit && !value.includes("\0");
  const validPrompt = value => validText(value, 32000) && Boolean(value.trim());
  const validDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
  function boundSelection(value = representative) {
    const selection = value?.selection;
    return Boolean(selection?.status === "selected" && selection.referenceIndex === scope?.referenceIndex &&
      selection.sourceSceneKey === scope?.sourceSceneKey);
  }
  function approvedUnchanged() {
    return Boolean(!edited && saved?.status === "approved" && saved.entries.find(entry => entry.referenceIndex === scope?.referenceIndex)?.promptText === prompt.value);
  }
  function representativeCopyKey() {
    if (representativeStatusKey) return representativeStatusKey;
    const selection = representative?.selection;
    if (!selection || selection.status === "cleared") return "representativeNone";
    if (!selection.current) return "representativeStale";
    if (boundSelection() && edited) return "representativeEdited";
    if (boundSelection() && (!approvedUnchanged() || selection.batchId !== saved?.batchId || selection.batchChecksum !== saved?.batchChecksum)) return "representativeStale";
    return boundSelection() ? "representativeSelected" : "representativeOther";
  }
  function renderCopy() {
    const locale = window.luminaI18n?.getLocale?.() || document.documentElement.lang || "ko";
    const base = copy[locale] || copy.ko;
    const words = scope?.guidanceOrigin === "manuscript_proposal" ? { ...base, ...base.proposal } : base;
    title.textContent = words.title;
    label.textContent = words.prompt;
    save.textContent = words.save;
    approve.textContent = words.approve;
    reviewText.textContent = words.reviewed;
    status.textContent = statusKey ? words[statusKey] : "";
    const named = key => words[key].replace("{part}", () => representative?.partTitle || scope?.partTitle || "");
    representativeTitle.textContent = words.representativeTitle;
    representativeText.textContent = named("representativeReviewed");
    selectRepresentative.textContent = words.selectRepresentative;
    clearRepresentative.textContent = words.clearRepresentative;
    representativeStatus.textContent = representative ? named(representativeCopyKey()) : "";
  }
  function controls() {
    const ready = Boolean(scope && context && context.guidanceOrigin === scope.guidanceOrigin && !blocked);
    const unchanged = Boolean(saved && saved.entries.find(entry => entry.referenceIndex === scope?.referenceIndex)?.promptText === prompt.value);
    prompt.disabled = !ready || busy;
    save.disabled = !ready || busy || !validPrompt(prompt.value) || (unchanged && (saved.entries.length === 1 || saved.status === "approved"));
    reviewed.disabled = !ready || busy || !unchanged || saved?.status !== "draft" || saved.entries.length !== 1;
    approve.disabled = reviewed.disabled || !reviewed.checked;
    representativeRoot.hidden = !representative || (!representative.selection && saved?.status !== "approved");
    const selectedHere = representativeCopyKey() === "representativeSelected";
    representativeReviewed.disabled = !ready || busy || !representative || !approvedUnchanged() || selectedHere;
    selectRepresentative.disabled = representativeReviewed.disabled || !representativeReviewed.checked;
    clearRepresentative.disabled = !ready || busy || representative?.selection?.status !== "selected";
    root.setAttribute("aria-busy", String(busy));
    renderCopy();
  }
  function reset() {
    revision++;
    controller?.abort();
    controller = null;
    if (timer !== null) clearInterval(timer);
    timer = null;
    scope = context = saved = null;
    representative = null;
    representativeStatusKey = null;
    representativeAttempts.clear();
    attempts.clear();
    prompt.value = "";
    reviewed.checked = false;
    representativeReviewed.checked = false;
    busy = blocked = edited = false;
    statusKey = null;
    root.hidden = true;
    controls();
  }
  function validLocal(detail, snapshot, active) {
    const metadata = snapshot?.importedVisualReferences;
    return Boolean(detail && active && [active.workId, active.manuscriptVersionId, active.analysisJobId].every(id => idPattern.test(id || "")) &&
      validText(active.identity?.ownerId, 320) && Number.isSafeInteger(active.identity?.epoch) && active.identity.epoch >= 0 &&
      snapshot?.manuscriptVersionId === active.manuscriptVersionId && snapshot.analysisJobId === active.analysisJobId &&
      (snapshot.workId === undefined || snapshot.workId === active.workId) && hashPattern.test(snapshot.manuscriptHash || "") &&
      metadata?.contract === "publication-visual-reference-preview-v1" && metadata.approvalState === "reference_only" &&
      guidanceOrigin(metadata) !== null && guidanceOrigin(detail) === guidanceOrigin(metadata) &&
      metadata.requiresSceneReview === true && metadata.manuscriptHash === snapshot.manuscriptHash && hashPattern.test(metadata.checksum || "") &&
      Number.isSafeInteger(metadata.totalReferences) && metadata.totalReferences > 0 && metadata.totalReferences <= 2000 &&
      ["exact_source_segments", "unmapped_legacy"].includes(metadata.mappingState) &&
      metadata.mappedReferences === (metadata.mappingState === "exact_source_segments" ? metadata.totalReferences : 0) &&
      detail.contract === "publication-visual-reference-detail-v1" && detail.workId === active.workId &&
      detail.manuscriptVersionId === active.manuscriptVersionId && detail.manuscriptHash === snapshot.manuscriptHash &&
      detail.checksum === metadata.checksum && detail.approvalState === "reference_only" && detail.requiresSceneReview === true &&
      detail.mappingState === metadata.mappingState && Number.isSafeInteger(detail.referenceIndex) &&
      detail.referenceIndex >= 0 && detail.referenceIndex < metadata.totalReferences && typeof detail.sourceSceneKey === "string" && keyPattern.test(detail.sourceSceneKey) &&
      hashPattern.test(detail.promptSha256 || "") && validPrompt(detail.promptText));
  }
  function guidanceOrigin(value) {
    if (value?.guidanceOrigin === undefined) return "imported_reference";
    return ["imported_reference", "manuscript_proposal"].includes(value.guidanceOrigin) ? value.guidanceOrigin : null;
  }
  function hasMapping(detail, snapshot) {
    const reader = detail.reader;
    return Boolean(detail.mappingState === "exact_source_segments" && reader && validText(reader.partKey, 120) &&
      validText(reader.partTitle, 1000) && Number.isSafeInteger(reader.segmentCount) && reader.segmentCount > 0 && reader.segmentCount <= 1000 &&
      Number.isSafeInteger(reader.totalTextLength) && reader.totalTextLength > 0 && validText(reader.text, 6000) &&
      Array.isArray(snapshot.parts) && snapshot.parts.filter(part => part.partKey === reader.partKey && part.title === reader.partTitle).length === 1);
  }
  function current() {
    if (!scope) return false;
    const active = scope.active;
    const completed = window.LuminaCreatorAnalysis?.completed?.();
    const metadata = scope.snapshot.importedVisualReferences;
    const okay = !modal.hidden && !modal.classList.contains("is-hidden") && !parent.hidden && !inspector.hidden &&
      window.LuminaCreatorStudioApi?.isCurrent?.(active.identity) && completed &&
      ["workId", "manuscriptVersionId", "analysisJobId", "manuscriptHash", "contentHash", "sourceChecksum", "checksum", "sourceLocale"].every(key => completed[key] === active[key]) &&
      completed.identity?.ownerId === active.identity.ownerId && completed.identity?.epoch === active.identity.epoch &&
      validLocal(scope.detail, scope.snapshot, active) && scope.snapshot.manuscriptHash === scope.manuscriptHash &&
      guidanceOrigin(metadata) === scope.guidanceOrigin && (!context || context.guidanceOrigin === scope.guidanceOrigin) &&
      metadata.checksum === scope.sourceChecksum && metadata.totalReferences === scope.totalReferences && metadata.mappingState === scope.mappingState &&
      scope.detail.referenceIndex === scope.referenceIndex && scope.detail.sourceSceneKey === scope.sourceSceneKey &&
      scope.detail.promptSha256 === scope.originalPromptSha256 && scope.detail.promptText === scope.originalPrompt &&
      (blocked || (hasMapping(scope.detail, scope.snapshot) && scope.detail.reader.partKey === scope.partKey &&
        scope.detail.reader.partTitle === scope.partTitle && scope.detail.reader.text === scope.readerText &&
        scope.detail.reader.totalTextLength === scope.readerTotal && scope.detail.reader.segmentCount === scope.segmentCount)) &&
      ["manuscriptHash", "contentHash"].every(key => active[key] === undefined || active[key] === scope.manuscriptHash) &&
      ["sourceChecksum", "checksum"].every(key => active[key] === undefined || active[key] === scope.sourceChecksum);
    if (!okay) reset();
    return Boolean(okay);
  }
  async function sha(value) {
    const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }
  function common(value, captured) {
    return Boolean(value && value.workId === captured.active.workId && value.manuscriptVersionId === captured.active.manuscriptVersionId &&
      value.manuscriptHash === captured.manuscriptHash && value.sourceChecksum === captured.sourceChecksum &&
      value.analysisJobId === captured.active.analysisJobId && hashPattern.test(value.profilePinHash || ""));
  }
  async function validBatch(batch, captured, pin) {
    if (!common(batch, captured) || batch.contract !== "story-visual-review-batch-v1" || batch.profilePinHash !== pin ||
        !idPattern.test(batch.batchId || "") || !hashPattern.test(batch.batchChecksum || "") ||
        batch.generationStarted !== false || batch.published !== false ||
        !["draft", "approved"].includes(batch.status) || batch.revision !== (batch.status === "draft" ? 1 : 2) ||
        (batch.status === "draft" ? batch.approvedAt !== null :
          typeof batch.approvedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(batch.approvedAt) || !Number.isFinite(Date.parse(batch.approvedAt))) ||
        !Array.isArray(batch.entries) || batch.entries.length < 1 || batch.entries.length > 8) return false;
    const indices = new Set();
    const keys = new Set();
    let selected = 0;
    for (const entry of batch.entries) {
      if (!entry || !Number.isSafeInteger(entry.referenceIndex) || entry.referenceIndex < 0 || entry.referenceIndex >= captured.totalReferences ||
          indices.has(entry.referenceIndex) || typeof entry.sourceSceneKey !== "string" || !keyPattern.test(entry.sourceSceneKey) || keys.has(entry.sourceSceneKey) ||
          ![entry.originalPromptSha256, entry.promptSha256, entry.bindingSha256].every(value => typeof value === "string" && hashPattern.test(value)) ||
          !validPrompt(entry.promptText) || !validText(entry.partKey, 120) || !validText(entry.partTitle, 1000) ||
          captured.snapshot.parts.filter(part => part.partKey === entry.partKey && part.title === entry.partTitle).length !== 1) return false;
      indices.add(entry.referenceIndex);
      keys.add(entry.sourceSceneKey);
      if (entry.referenceIndex === captured.referenceIndex) {
        if (entry.sourceSceneKey !== captured.sourceSceneKey || entry.originalPromptSha256 !== captured.originalPromptSha256 ||
            entry.partKey !== captured.partKey || entry.partTitle !== captured.partTitle) return false;
        selected++;
      }
      if (await sha(entry.promptText) !== entry.promptSha256) return false;
    }
    return selected === 1;
  }
  async function validContext(value, captured) {
    return Boolean(common(value, captured) && value.contract === "story-visual-review-context-v1" &&
      (value.guidanceOrigin === undefined || guidanceOrigin(value) === captured.guidanceOrigin) &&
      value.referenceIndex === captured.referenceIndex && value.sourceSceneKey === captured.sourceSceneKey &&
      value.originalPromptSha256 === captured.originalPromptSha256 &&
      (value.batch === null || await validBatch(value.batch, captured, value.profilePinHash)) &&
      (value.representative == null || validRepresentative(value.representative, captured, value.profilePinHash, value.batch)));
  }
  function validRepresentative(value, captured, pin, batch) {
    if (!value || value.contract !== "story-part-visual-selection-context-v1" || typeof value.partKey !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.partKey) || value.partKey !== captured.partKey ||
        value.partTitle !== captured.partTitle || value.targetSceneKey !== `${captured.partKey}-main` ||
        !Number.isSafeInteger(value.selectionVersion) || value.selectionVersion < 0) return false;
    const selection = value.selection;
    if (selection === null) return true;
    if (!selection || selection.contract !== "story-part-visual-selection-v1" ||
        ![selection.id, selection.workId, selection.manuscriptVersionId, selection.analysisJobId].every(id => typeof id === "string" && idPattern.test(id)) ||
        selection.workId !== captured.active.workId || selection.partKey !== value.partKey || selection.targetSceneKey !== value.targetSceneKey ||
        ![selection.manuscriptHash, selection.sourceChecksum, selection.profilePinHash, selection.selectionChecksum].every(hash => typeof hash === "string" && hashPattern.test(hash)) ||
        selection.selectionVersion !== value.selectionVersion || selection.selectionVersion < 1 || !validDate(selection.createdAt) ||
        typeof selection.current !== "boolean" || !["selected", "cleared"].includes(selection.status)) return false;
    if (selection.current && (!common(selection, captured) || selection.profilePinHash !== pin)) return false;
    if (selection.status === "cleared") return [selection.referenceIndex, selection.sourceSceneKey, selection.batchId, selection.batchChecksum].every(field => field === null);
    if (!Number.isSafeInteger(selection.referenceIndex) || selection.referenceIndex < 0 || typeof selection.sourceSceneKey !== "string" ||
        !keyPattern.test(selection.sourceSceneKey) || typeof selection.batchId !== "string" || !idPattern.test(selection.batchId) ||
        typeof selection.batchChecksum !== "string" || !hashPattern.test(selection.batchChecksum)) return false;
    if (!selection.current) return true;
    if (selection.referenceIndex >= captured.totalReferences) return false;
    const entry = batch?.entries.find(item => item.referenceIndex === selection.referenceIndex);
    if (selection.referenceIndex !== captured.referenceIndex && !entry) return selection.sourceSceneKey !== captured.sourceSceneKey;
    return Boolean((selection.referenceIndex !== captured.referenceIndex || selection.sourceSceneKey === captured.sourceSceneKey) && batch?.status === "approved" &&
      selection.batchId === batch.batchId && selection.batchChecksum === batch.batchChecksum &&
      entry?.partKey === value.partKey && entry.partTitle === value.partTitle && entry.sourceSceneKey === selection.sourceSceneKey);
  }
  function sameRepresentative(left, right) {
    if (!left || !right) return left === right;
    const fields = ["contract", "partKey", "partTitle", "targetSceneKey", "selectionVersion"];
    const selectionFields = ["contract", "id", "workId", "manuscriptVersionId", "manuscriptHash", "sourceChecksum", "analysisJobId", "profilePinHash",
      "partKey", "targetSceneKey", "selectionVersion", "status", "referenceIndex", "sourceSceneKey", "batchId", "batchChecksum", "selectionChecksum", "createdAt", "current"];
    return fields.every(key => left[key] === right[key]) && (left.selection === null && right.selection === null ||
      Boolean(left.selection && right.selection && selectionFields.every(key => left.selection[key] === right.selection[key])));
  }
  function adoptRepresentative(value) {
    const selection = value.representative?.selection;
    if (selection?.current && boundSelection(value.representative) && (value.batch?.status !== "approved" ||
        value.batch.batchId !== selection.batchId || value.batch.batchChecksum !== selection.batchChecksum)) {
      value.representative = { ...value.representative, selection: { ...selection, current: false } };
    }
    representative = value.representative || null;
    representativeStatusKey = null;
    representativeReviewed.checked = false;
  }
  function failure(key, status, fatal = false) { return Object.assign(new Error("Visual review unavailable"), { uiKey: key, status, fatal }); }
  function block(key) {
    context = saved = null;
    representative = null;
    representativeStatusKey = null;
    prompt.value = "";
    reviewed.checked = false;
    representativeReviewed.checked = false;
    blocked = true;
    statusKey = key;
    controls();
  }
  function begin(key) {
    controller?.abort();
    const operation = { captured: scope, controller: new AbortController(), revision: ++revision };
    controller = operation.controller;
    busy = true;
    statusKey = key;
    controls();
    return operation;
  }
  function live(operation) {
    return operation.revision === revision && scope === operation.captured && !operation.controller.signal.aborted && current();
  }
  function base(captured) {
    return `/api/v1/me/creator-studio/stories/${encodeURIComponent(captured.active.workId)}/linear-draft/${encodeURIComponent(captured.active.manuscriptVersionId)}`;
  }
  async function request(operation, path, options = {}) {
    if (!live(operation)) return null;
    const response = await window.LuminaCreatorStudioApi.fetch(base(operation.captured) + path,
      { ...options, identity: operation.captured.active.identity, signal: operation.controller.signal });
    if (!live(operation)) return null;
    if (!response.ok) throw failure(response.status === 409 ? "changed" : "unavailable", response.status);
    const data = await response.json();
    return live(operation) ? data : null;
  }
  async function getContext(operation) {
    const captured = operation.captured;
    const query = new URLSearchParams({ expectedManuscriptHash: captured.manuscriptHash, expectedSourceChecksum: captured.sourceChecksum });
    const data = await request(operation, `/visual-review/${captured.referenceIndex}?${query}`, { method: "GET" });
    if (!live(operation)) return null;
    if (!await validContext(data, captured)) throw failure("unavailable", undefined, true);
    // Existing review contexts need not echo the origin of the verified guidance.
    return live(operation) ? { ...data, guidanceOrigin: captured.guidanceOrigin } : null;
  }
  function sameBatch(left, right) {
    return left === null && right === null || Boolean(left && right && left.batchId === right.batchId &&
      left.batchChecksum === right.batchChecksum && left.revision === right.revision && left.status === right.status && sameEntries(left, right));
  }
  function sameEntries(left, right) {
    const fields = ["referenceIndex", "sourceSceneKey", "originalPromptSha256", "promptText", "promptSha256", "partKey", "partTitle", "bindingSha256"];
    return left.entries.length === right.entries.length && left.entries.every((entry, index) => fields.every(key => entry[key] === right.entries[index][key]));
  }
  function finish(operation) {
    if (operation.revision === revision && scope === operation.captured) {
      controller = null;
      busy = false;
      controls();
    }
  }
  function handleFailure(operation, error, key, fatal = false) {
    if (!live(operation)) return;
    reviewed.checked = false;
    if (error.status === 401 || error.status === 403) reset();
    else if (fatal || error.fatal || [400, 404, 409, 422].includes(error.status)) block(error.uiKey || "unavailable");
    else { statusKey = key; controls(); }
  }
  function sameScene(detail, snapshot, active) {
    return validLocal(detail, snapshot, active) && hasMapping(detail, snapshot) &&
      ["workId", "manuscriptVersionId", "analysisJobId", "manuscriptHash", "contentHash", "sourceChecksum", "checksum", "sourceLocale"].every(key => active[key] === scope.active[key]) &&
      active.identity.ownerId === scope.active.identity.ownerId && active.identity.epoch === scope.active.identity.epoch &&
      snapshot.manuscriptHash === scope.manuscriptHash && snapshot.importedVisualReferences.checksum === scope.sourceChecksum &&
      snapshot.importedVisualReferences.totalReferences === scope.totalReferences && detail.mappingState === scope.mappingState &&
      guidanceOrigin(detail) === scope.guidanceOrigin &&
      detail.referenceIndex === scope.referenceIndex && detail.sourceSceneKey === scope.sourceSceneKey &&
      detail.promptSha256 === scope.originalPromptSha256 && detail.promptText === scope.originalPrompt &&
      detail.reader.partKey === scope.partKey && detail.reader.partTitle === scope.partTitle &&
      detail.reader.totalTextLength === scope.readerTotal && detail.reader.segmentCount === scope.segmentCount;
  }
  async function show(detail, snapshot, active) {
    if (scope && current() && sameScene(detail, snapshot, active)) {
      scope.detail = detail;
      scope.snapshot = snapshot;
      scope.readerText = detail.reader.text;
      controls();
      return;
    }
    reset();
    if (!validLocal(detail, snapshot, active)) return;
    scope = { detail, snapshot, active: { ...active, identity: { ...active.identity } },
      manuscriptHash: snapshot.manuscriptHash, sourceChecksum: snapshot.importedVisualReferences.checksum,
      totalReferences: snapshot.importedVisualReferences.totalReferences, mappingState: detail.mappingState,
      guidanceOrigin: guidanceOrigin(detail),
      referenceIndex: detail.referenceIndex, sourceSceneKey: detail.sourceSceneKey,
      originalPromptSha256: detail.promptSha256, originalPrompt: detail.promptText,
      partKey: detail.reader?.partKey, partTitle: detail.reader?.partTitle,
      readerText: detail.reader?.text, readerTotal: detail.reader?.totalTextLength, segmentCount: detail.reader?.segmentCount };
    blocked = !hasMapping(detail, snapshot) || !window.crypto?.subtle || !window.crypto?.randomUUID;
    if (!current()) return;
    root.hidden = false;
    timer = setInterval(current, 500);
    if (blocked) { block("unavailable"); return; }
    const operation = begin("loading");
    try {
      if (await sha(operation.captured.originalPrompt) !== operation.captured.originalPromptSha256) throw failure("unavailable");
      if (!live(operation)) return;
      const value = await getContext(operation);
      if (!value || !live(operation)) return;
      context = value;
      saved = value.batch;
      adoptRepresentative(value);
      prompt.value = saved ? saved.entries.find(entry => entry.referenceIndex === scope.referenceIndex).promptText : detail.promptText;
      statusKey = saved?.status === "approved" ? "approved" : saved ? "saved" : "unsaved";
    } catch (error) { handleFailure(operation, error, "unavailable", true); }
    finally { finish(operation); }
  }
  function expected(captured, pin) {
    return { expectedManuscriptHash: captured.manuscriptHash, expectedSourceChecksum: captured.sourceChecksum, expectedProfilePinHash: pin };
  }
  async function saveDraft() {
    if (!current() || save.disabled || busy || !context || blocked || !validPrompt(prompt.value)) return;
    const text = prompt.value;
    const previous = context;
    const operation = begin("saving");
    reviewed.checked = false;
    representativeReviewed.checked = false;
    saved = null;
    try {
      const digest = await sha(text);
      if (!live(operation)) return;
      const existingKey = attempts.get(digest);
      const fresh = await getContext(operation);
      if (!fresh || !live(operation)) return;
      // A lost save reply can leave the intended draft on the server already.
      const recovered = existingKey && fresh.batch?.status === "draft" && fresh.batch.entries.length === 1 && fresh.batch.entries[0].promptText === text;
      if (fresh.profilePinHash !== previous.profilePinHash || (!sameBatch(fresh.batch, previous.batch) && !recovered)) throw failure("changed", 409);
      if (!existingKey) attempts.set(digest, window.crypto.randomUUID());
      const idempotencyKey = attempts.get(digest);
      const data = await request(operation, "/visual-review-batches", { method: "POST", body: {
        ...expected(operation.captured, fresh.profilePinHash), idempotencyKey,
        entries: [{ referenceIndex: operation.captured.referenceIndex, sourceSceneKey: operation.captured.sourceSceneKey,
          originalPromptSha256: operation.captured.originalPromptSha256, promptText: text }]
      } });
      if (!live(operation)) return;
      if (!await validBatch(data, operation.captured, fresh.profilePinHash) || data.status !== "draft" || data.entries.length !== 1 ||
          data.entries[0].promptText !== text) throw failure("unavailable");
      if (!live(operation)) return;
      context = { ...fresh, batch: data };
      saved = data;
      adoptRepresentative(context);
      attempts.clear();
      edited = false;
      statusKey = "saved";
    } catch (error) { handleFailure(operation, error, "failed"); }
    finally { finish(operation); }
  }
  async function approveDraft() {
    if (!current() || approve.disabled || busy || blocked || !saved || saved.status !== "draft" || saved.entries.length !== 1 || !reviewed.checked) return;
    const draft = saved;
    const previous = context;
    const operation = begin("approving");
    representativeReviewed.checked = false;
    try {
      const fresh = await getContext(operation);
      if (!fresh || !live(operation)) return;
      if (fresh.profilePinHash !== previous.profilePinHash || !sameBatch(fresh.batch, draft)) throw failure("changed", 409);
      if (!reviewed.checked || prompt.value !== draft.entries.find(entry => entry.referenceIndex === scope.referenceIndex).promptText) { statusKey = "saved"; return; }
      const data = await request(operation, `/visual-review-batches/${encodeURIComponent(draft.batchId)}/approve`, { method: "POST", body: {
        ...expected(operation.captured, fresh.profilePinHash), expectedBatchChecksum: draft.batchChecksum,
        expectedRevision: draft.revision, scenesReviewed: true
      } });
      if (!live(operation)) return;
      if (!await validBatch(data, operation.captured, fresh.profilePinHash) || data.status !== "approved" || data.batchId !== draft.batchId ||
          !sameEntries(data, draft)) throw failure("unavailable");
      if (!live(operation)) return;
      context = { ...fresh, batch: data };
      saved = data;
      adoptRepresentative(context);
      reviewed.checked = false;
      statusKey = "approved";
    } catch (error) { handleFailure(operation, error, "approveFailed"); }
    finally { finish(operation); }
  }
  function intendedRepresentative(value, attempt, captured, pin) {
    const selection = value?.selection;
    return Boolean(selection && selection.current === true && value.selectionVersion === attempt.body.expectedSelectionVersion + 1 &&
      common(selection, captured) && selection.profilePinHash === pin &&
      (attempt.body.mode === "clear" ? selection.status === "cleared" :
        selection.status === "selected" && selection.referenceIndex === captured.referenceIndex &&
        selection.sourceSceneKey === captured.sourceSceneKey && selection.batchId === attempt.body.batchId && selection.batchChecksum === attempt.body.expectedBatchChecksum));
  }
  async function changeRepresentative(mode) {
    const command = mode === "select" ? selectRepresentative : clearRepresentative;
    if (!current() || command.disabled || busy || blocked || !context || !representative) return;
    if (mode === "select" && (!approvedUnchanged() || !representativeReviewed.checked)) return;
    if (mode === "clear" && representative.selection?.status !== "selected") return;
    const previous = context;
    const guide = saved;
    const key = JSON.stringify([mode, previous.profilePinHash, representative.selectionVersion,
      mode === "select" ? guide.batchId : representative.selection.id, mode === "select" ? guide.batchChecksum : representative.selection.selectionChecksum]);
    const operation = begin(statusKey);
    representativeStatusKey = mode === "select" ? "selectingRepresentative" : "clearingRepresentative";
    controls();
    try {
      const fresh = await getContext(operation);
      if (!fresh || !live(operation)) return;
      let attempt = representativeAttempts.get(key);
      const recovered = attempt && intendedRepresentative(fresh.representative, attempt, operation.captured, fresh.profilePinHash);
      if (fresh.profilePinHash !== previous.profilePinHash || !sameBatch(fresh.batch, previous.batch) || !fresh.representative ||
          (!sameRepresentative(fresh.representative, previous.representative) && !recovered)) throw failure("changed", 409);
      if (mode === "select" && (!representativeReviewed.checked || !approvedUnchanged() || !sameBatch(fresh.batch, guide))) throw failure("changed", 409);
      if (!attempt) {
        attempt = { body: { ...expected(operation.captured, fresh.profilePinHash), mode, idempotencyKey: window.crypto.randomUUID(),
          expectedSelectionVersion: fresh.representative.selectionVersion,
          ...(mode === "select" ? { batchId: guide.batchId, expectedBatchChecksum: guide.batchChecksum, representativeReviewed: true } : {}) } };
        representativeAttempts.set(key, attempt);
      }
      const data = await request(operation, `/visual-review/${operation.captured.referenceIndex}/representative`, { method: "POST", body: attempt.body });
      if (!live(operation)) return;
      if (!validRepresentative(data, operation.captured, fresh.profilePinHash, fresh.batch) ||
          !intendedRepresentative(data, attempt, operation.captured, fresh.profilePinHash)) throw failure("unavailable");
      // A receipt is not a freshness guarantee: reload before showing a current selection.
      const confirmed = await getContext(operation);
      if (!confirmed || !live(operation)) return;
      if (confirmed.profilePinHash !== fresh.profilePinHash || !sameBatch(confirmed.batch, fresh.batch) ||
          !sameRepresentative(confirmed.representative, data)) throw failure("changed", 409);
      if (mode === "select" && (!representativeReviewed.checked || !approvedUnchanged())) throw failure("changed", 409);
      context = confirmed;
      if (!edited) saved = confirmed.batch;
      adoptRepresentative(confirmed);
      representativeAttempts.clear();
    } catch (error) {
      if (!live(operation)) return;
      representativeReviewed.checked = false;
      representativeStatusKey = mode === "select" ? "selectRepresentativeFailed" : "clearRepresentativeFailed";
      handleFailure(operation, error, statusKey);
    } finally { finish(operation); }
  }
  prompt.addEventListener("input", () => {
    if (!current() || blocked || !context) return;
    revision++;
    controller?.abort();
    controller = null;
    busy = false;
    saved = null;
    reviewed.checked = false;
    representativeReviewed.checked = false;
    representativeStatusKey = null;
    edited = true;
    statusKey = "unsaved";
    controls();
  });
  reviewed.addEventListener("change", () => { if (current()) controls(); });
  save.addEventListener("click", saveDraft);
  approve.addEventListener("click", approveDraft);
  representativeReviewed.addEventListener("change", () => { if (current()) controls(); });
  selectRepresentative.addEventListener("click", () => changeRepresentative("select"));
  clearRepresentative.addEventListener("click", () => changeRepresentative("clear"));
  window.addEventListener("lumina:localechange", () => { if (current()) renderCopy(); });
  window.addEventListener("lumina:auth-expired", reset);
  window.addEventListener("pagehide", reset);
  window.addEventListener("storage", current);
  window.addEventListener("focus", current);
  document.addEventListener("input", current);
  document.addEventListener("change", current);
  if (typeof MutationObserver !== "undefined") new MutationObserver(() => {
    if (modal.classList.contains("is-hidden") || modal.hidden) reset();
  }).observe(modal, { attributes: true, attributeFilter: ["class", "hidden"] });
  function canLeave() {
    if (!current() || !edited) return true;
    const locale = window.luminaI18n?.getLocale?.() || document.documentElement.lang || "ko";
    return typeof window.confirm !== "function" || window.confirm((copy[locale] || copy.ko).discard);
  }
  window.LuminaCreatorVisualReview = { show, reset, canLeave };
  reset();
})();

(function initCreatorVisualReferences() {
  "use strict";
  const root = document.getElementById("writerVisualReferences");
  const modal = document.getElementById("writerFinalModal");
  if (!root || !modal) return;
  const pageSize = 8;
  const textSize = 6000;
  const hashPattern = /^[a-f0-9]{64}$/;
  const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  const keyPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
  const copy = {
    ko: {
      title: "원작 장면 시각 참고", open: "참고 열기", notice: "참고 자료만 제공됩니다. 장면 검토와 시각 승인은 아직 필요합니다.",
      exact: "{total}개 참고 · 원본 구간 일치", legacy: "{total}개 참고 · 원문 연결 없음",
      select: "장면 참고", row: "{number}. {title}", originalReference: "원작 참고", listPrev: "이전 참고", listNext: "다음 참고", listRange: "{start}–{end} / {total}개 참고",
      prompt: "원본 프롬프트 전체", prose: "일치하는 원문 구간", textPrev: "이전 원문", textNext: "다음 원문",
      textRange: "원문 {page}페이지", lastPage: "마지막 페이지", pageOnly: "원문 구간의 일부 페이지이며, 장면 전체가 아닙니다.",
      unmapped: "이전 자료에는 검증된 원문 연결이 없습니다. 원문을 추정하지 않습니다.",
      noProse: "일치하는 구간에 독자 원문이 없습니다. 장면 검토는 여전히 필요합니다.",
      loading: "참고를 불러오는 중…", empty: "이 원고에는 원작 시각 참고가 없습니다.",
      failed: "참고를 불러오지 못했습니다.", changed: "원고 또는 참고가 달라졌습니다. 최종 검토를 다시 열어 주세요.",
      invalid: "참고의 식별 정보나 범위를 검증할 수 없습니다.", retry: "다시 시도", segments: "{title} · {count}개 원본 구간",
      proposal: {
        title: "제안된 장면 시각 가이드", open: "제안 가이드 열기", notice: "제안 가이드만 제공됩니다. 장면 검토와 시각 승인은 아직 필요합니다.",
        exact: "{total}개 제안 가이드 · 원본 구간 일치", legacy: "{total}개 제안 가이드 · 원문 연결 없음",
        select: "제안된 장면 가이드", originalReference: "제안 가이드", listPrev: "이전 제안 가이드", listNext: "다음 제안 가이드",
        listRange: "{start}–{end} / {total}개 제안 가이드", prompt: "제안 가이드 전체",
        unmapped: "이 제안 가이드에는 검증된 원문 연결이 없습니다. 원문을 추정하지 않습니다.",
        loading: "제안 가이드를 불러오는 중…", empty: "이 원고에는 제안된 장면 가이드가 없습니다.",
        failed: "제안 가이드를 불러오지 못했습니다.", changed: "원고 또는 가이드가 달라졌습니다. 최종 검토를 다시 열어 주세요.",
        invalid: "제안 가이드의 식별 정보나 범위를 검증할 수 없습니다."
      }
    },
    en: {
      title: "Original Scene Visual References", open: "Open references", notice: "Reference only. Scene review and visual approval are still required.",
      exact: "{total} references · exact source segments", legacy: "{total} references · no prose mapping",
      select: "Scene reference", row: "{number}. {title}", originalReference: "Original reference", listPrev: "Previous references", listNext: "Next references", listRange: "References {start}–{end} of {total}",
      prompt: "Full original prompt", prose: "Matched source prose", textPrev: "Previous prose", textNext: "Next prose",
      textRange: "Prose page {page}", lastPage: "Last page", pageOnly: "A page of matched source segments, not the complete scene.",
      unmapped: "This legacy reference has no verified prose mapping. No prose is inferred.",
      noProse: "No reader prose in this matched range. Scene review is still required.",
      loading: "Loading references…", empty: "No original visual references for this manuscript.",
      failed: "References could not be loaded.", changed: "The manuscript or references changed. Reopen final review.",
      invalid: "Reference identity or bounds could not be verified.", retry: "Retry", segments: "{title} · {count} source segments",
      proposal: {
        title: "Proposed Scene Visual Guidance", open: "Open proposed guidance", notice: "Proposed guidance only. Scene review and visual approval are still required.",
        exact: "{total} proposed guides · exact source segments", legacy: "{total} proposed guides · no prose mapping",
        select: "Proposed scene guidance", originalReference: "Proposed guide", listPrev: "Previous proposed guides", listNext: "Next proposed guides",
        listRange: "Proposed guides {start}–{end} of {total}", prompt: "Full proposed guidance",
        unmapped: "This proposed guide has no verified prose mapping. No prose is inferred.",
        loading: "Loading proposed guidance…", empty: "No proposed scene guidance for this manuscript.",
        failed: "Proposed guidance could not be loaded.", changed: "The manuscript or guidance changed. Reopen final review.",
        invalid: "Proposed guidance identity or bounds could not be verified."
      }
    },
    ja: {
      title: "原作シーンのビジュアル参考", open: "参考を開く", notice: "参考資料のみです。シーンの確認とビジュアル承認は別途必要です。",
      exact: "参考 {total} 件 · 原文区間と一致", legacy: "参考 {total} 件 · 原文の対応なし",
      select: "シーン参考", row: "{number}. {title}", originalReference: "原作の参考", listPrev: "前の参考", listNext: "次の参考", listRange: "参考 {start}–{end} / {total} 件",
      prompt: "元のプロンプト全文", prose: "一致する原文区間", textPrev: "前の原文", textNext: "次の原文",
      textRange: "原文 {page} ページ目", lastPage: "最終ページ", pageOnly: "対応する原文区間の一部ページであり、シーン全体ではありません。",
      unmapped: "旧形式の参考には検証済みの原文対応がありません。原文は推測しません。",
      noProse: "対応する区間に読者向けの本文がありません。シーンの確認は引き続き必要です。",
      loading: "参考を読み込み中…", empty: "この原稿には原作のビジュアル参考がありません。",
      failed: "参考を読み込めませんでした。", changed: "原稿または参考が変更されました。最終確認を開き直してください。",
      invalid: "参考の識別情報または範囲を検証できません。", retry: "再試行", segments: "{title} · 原文区間 {count} 件",
      proposal: {
        title: "提案されたシーンのビジュアルガイド", open: "提案ガイドを開く", notice: "提案ガイドのみです。シーンの確認とビジュアル承認は別途必要です。",
        exact: "提案ガイド {total} 件 · 原文区間と一致", legacy: "提案ガイド {total} 件 · 原文の対応なし",
        select: "提案されたシーンガイド", originalReference: "提案ガイド", listPrev: "前の提案ガイド", listNext: "次の提案ガイド",
        listRange: "提案ガイド {start}–{end} / {total} 件", prompt: "提案ガイド全文",
        unmapped: "この提案ガイドには検証済みの原文対応がありません。原文は推測しません。",
        loading: "提案ガイドを読み込み中…", empty: "この原稿には提案されたシーンガイドがありません。",
        failed: "提案ガイドを読み込めませんでした。", changed: "原稿またはガイドが変更されました。最終確認を開き直してください。",
        invalid: "提案ガイドの識別情報または範囲を検証できません。"
      }
    },
    "zh-Hans": {
      title: "原作场景视觉参考", open: "打开参考", notice: "仅供参考。仍需场景审阅及视觉审批。",
      exact: "{total} 条参考 · 精确匹配原文片段", legacy: "{total} 条参考 · 无原文映射",
      select: "场景参考", row: "{number}. {title}", originalReference: "原作参考", listPrev: "上一页参考", listNext: "下一页参考", listRange: "参考 {start}–{end} / {total}",
      prompt: "原始提示词全文", prose: "匹配的原文片段", textPrev: "上一页原文", textNext: "下一页原文",
      textRange: "原文第 {page} 页", lastPage: "最后一页", pageOnly: "仅为匹配原文片段的一页，并非完整场景。",
      unmapped: "旧版参考没有经过验证的原文映射。不推测原文。",
      noProse: "此匹配片段没有读者正文。仍需场景审阅。",
      loading: "正在加载参考…", empty: "此稿件没有原作视觉参考。",
      failed: "无法加载参考。", changed: "稿件或参考已更改。请重新打开最终审阅。",
      invalid: "无法验证参考标识或范围。", retry: "重试", segments: "{title} · {count} 个原文片段",
      proposal: {
        title: "建议的场景视觉指南", open: "打开建议指南", notice: "仅为建议指南。仍需场景审阅及视觉审批。",
        exact: "{total} 条建议指南 · 精确匹配原文片段", legacy: "{total} 条建议指南 · 无原文映射",
        select: "建议的场景指南", originalReference: "建议指南", listPrev: "上一页建议指南", listNext: "下一页建议指南",
        listRange: "建议指南 {start}–{end} / {total}", prompt: "建议指南全文",
        unmapped: "此建议指南没有经过验证的原文映射。不推测原文。",
        loading: "正在加载建议指南…", empty: "此稿件没有建议的场景指南。",
        failed: "无法加载建议指南。", changed: "稿件或指南已更改。请重新打开最终审阅。",
        invalid: "无法验证建议指南标识或范围。"
      }
    },
    "zh-Hant": {
      title: "原作場景視覺參考", open: "開啟參考", notice: "僅供參考。仍需場景審閱及視覺核准。",
      exact: "{total} 條參考 · 精確匹配原文片段", legacy: "{total} 條參考 · 無原文對應",
      select: "場景參考", row: "{number}. {title}", originalReference: "原作參考", listPrev: "上一頁參考", listNext: "下一頁參考", listRange: "參考 {start}–{end} / {total}",
      prompt: "原始提示詞全文", prose: "匹配的原文片段", textPrev: "上一頁原文", textNext: "下一頁原文",
      textRange: "原文第 {page} 頁", lastPage: "最後一頁", pageOnly: "僅為匹配原文片段的一頁，並非完整場景。",
      unmapped: "舊版參考沒有經過驗證的原文對應。不推測原文。",
      noProse: "此匹配片段沒有讀者正文。仍需場景審閱。",
      loading: "正在載入參考…", empty: "此稿件沒有原作視覺參考。",
      failed: "無法載入參考。", changed: "稿件或參考已變更。請重新開啟最終審閱。",
      invalid: "無法驗證參考識別資訊或範圍。", retry: "重試", segments: "{title} · {count} 個原文片段",
      proposal: {
        title: "建議的場景視覺指南", open: "開啟建議指南", notice: "僅為建議指南。仍需場景審閱及視覺核准。",
        exact: "{total} 條建議指南 · 精確匹配原文片段", legacy: "{total} 條建議指南 · 無原文對應",
        select: "建議的場景指南", originalReference: "建議指南", listPrev: "上一頁建議指南", listNext: "下一頁建議指南",
        listRange: "建議指南 {start}–{end} / {total}", prompt: "建議指南全文",
        unmapped: "此建議指南沒有經過驗證的原文對應。不推測原文。",
        loading: "正在載入建議指南…", empty: "此稿件沒有建議的場景指南。",
        failed: "無法載入建議指南。", changed: "稿件或指南已變更。請重新開啟最終審閱。",
        invalid: "無法驗證建議指南識別資訊或範圍。"
      }
    }
  };
  let scope = null;
  let controller = null;
  let revision = 0;
  let timer = null;
  let page = null;
  let detail = null;
  let selected = null;
  let listOffsets = [0];
  let textOffsets = [0];
  let readerTotal = null;
  let busy = false;
  let opened = false;
  let statusKey = null;
  let retryAction = null;

  function element(tag, id, key, parent = root) {
    const node = document.createElement(tag);
    node.id = id;
    if (key) node.dataset.vrCopy = key;
    parent.append(node);
    return node;
  }
  const title = element("h3", "writerVisualReferencesTitle", "title");
  const metadata = element("p", "writerVisualReferencesMetadata");
  const notice = element("p", "writerVisualReferencesNotice", "notice");
  const openButton = element("button", "writerVisualReferencesOpen", "open");
  const status = element("p", "writerVisualReferencesStatus");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const retry = element("button", "writerVisualReferencesRetry", "retry");
  const viewer = element("div", "writerVisualReferencesViewer");
  const toolbar = element("div", "writerVisualReferencesToolbar", null, viewer);
  toolbar.className = "visual-reference-toolbar";
  const label = element("label", "writerVisualReferencesLabel", "select", toolbar);
  label.setAttribute("for", "writerVisualReferencesSelect");
  const select = element("select", "writerVisualReferencesSelect", null, toolbar);
  const listPager = element("div", "writerVisualReferencesListPager", null, viewer);
  listPager.className = "visual-reference-pager";
  const listPrev = element("button", "writerVisualReferencesListPrev", "listPrev", listPager);
  const listRange = element("span", "writerVisualReferencesListRange", null, listPager);
  const listNext = element("button", "writerVisualReferencesListNext", "listNext", listPager);
  const columns = element("div", "writerVisualReferencesColumns", null, viewer);
  columns.className = "visual-reference-columns";
  const promptColumn = element("div", "writerVisualReferencesPromptColumn", null, columns);
  const promptTitle = element("h4", "writerVisualReferencesPromptTitle", "prompt", promptColumn);
  const sceneKey = element("p", "writerVisualReferencesSceneKey", null, promptColumn);
  const prompt = element("pre", "writerVisualReferencesPrompt", null, promptColumn);
  prompt.tabIndex = 0;
  prompt.setAttribute("aria-labelledby", promptTitle.id);
  const readerColumn = element("div", "writerVisualReferencesReaderColumn", null, columns);
  const readerTitle = element("h4", "writerVisualReferencesReaderTitle", "prose", readerColumn);
  const readerPart = element("p", "writerVisualReferencesReaderPart", null, readerColumn);
  const pageNote = element("p", "writerVisualReferencesPageNote", "pageOnly", readerColumn);
  const reader = element("pre", "writerVisualReferencesReader", null, readerColumn);
  reader.tabIndex = 0;
  reader.setAttribute("aria-labelledby", readerTitle.id);
  reader.setAttribute("aria-describedby", pageNote.id + " writerVisualReferencesTextRange");
  const unmapped = element("p", "writerVisualReferencesUnmapped", "unmapped", readerColumn);
  const noProse = element("p", "writerVisualReferencesNoProse", "noProse", readerColumn);
  const textPager = element("div", "writerVisualReferencesTextPager", null, readerColumn);
  textPager.className = "visual-reference-pager";
  const textPrev = element("button", "writerVisualReferencesTextPrev", "textPrev", textPager);
  const textRange = element("span", "writerVisualReferencesTextRange", null, textPager);
  const textNext = element("button", "writerVisualReferencesTextNext", "textNext", textPager);
  root.querySelectorAll("button").forEach(button => { button.type = "button"; button.className = "secondary-action"; });

  function t(key, values = {}) {
    const locale = window.luminaI18n?.getLocale?.() || document.documentElement.lang || "ko";
    const words = copy[locale] || copy.ko;
    const value = (scope?.guidanceOrigin === "manuscript_proposal" ? words.proposal[key] : undefined) ?? words[key];
    return value.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
  }
  function renderCopy() {
    root.querySelectorAll("[data-vr-copy]").forEach(node => { node.textContent = t(node.dataset.vrCopy); });
    if (scope) metadata.textContent = t(scope.mappingState === "exact_source_segments" ? "exact" : "legacy", { total: scope.totalReferences });
    status.textContent = statusKey ? t(statusKey) : "";
    if (page) {
      [...select.options].forEach((option, index) => { option.textContent = rowLabel(page.items[index]); });
      listRange.textContent = t("listRange", { start: page.items.length ? page.offset + 1 : 0,
        end: page.offset + page.items.length, total: page.totalReferences });
    }
    if (detail?.reader) {
      const value = detail.reader;
      readerPart.textContent = t("segments", { title: value.partTitle, count: value.segmentCount });
      textRange.textContent = value.totalTextLength ? t("textRange", { page: textOffsets.length }) +
        (value.nextTextOffset === null ? " · " + t("lastPage") : "") : "";
    }
  }
  function rowLabel(row) { return t("row", { number: row.referenceIndex + 1, title: row.partTitle || t("originalReference") }); }
  function message(key, action = null) {
    statusKey = key;
    retryAction = action;
    retry.hidden = !action;
    renderCopy();
  }
  function clearDetail(preserveReview = false) {
    if (!preserveReview) window.LuminaCreatorVisualReview?.reset();
    detail = null;
    if (!preserveReview) {
      columns.hidden = true;
      prompt.textContent = "";
      sceneKey.textContent = "";
    }
    reader.textContent = "";
    readerPart.textContent = "";
    textRange.textContent = "";
  }
  function controls() {
    openButton.hidden = opened || scope?.totalReferences === 0;
    openButton.disabled = busy;
    select.disabled = busy || !page?.items.length;
    listPrev.disabled = busy || listOffsets.length < 2;
    listNext.disabled = busy || page?.nextOffset == null;
    textPrev.disabled = busy || textOffsets.length < 2;
    textNext.disabled = busy || detail?.reader?.nextTextOffset == null;
    retry.disabled = busy;
    viewer.setAttribute("aria-busy", String(busy));
  }
  function reset() {
    revision++;
    controller?.abort();
    controller = null;
    if (timer !== null) clearInterval(timer);
    timer = null;
    scope = null;
    page = null;
    selected = null;
    readerTotal = null;
    retryAction = null;
    listOffsets = [0];
    textOffsets = [0];
    busy = false;
    opened = false;
    statusKey = null;
    root.hidden = true;
    viewer.hidden = true;
    retry.hidden = true;
    select.replaceChildren();
    clearDetail();
    metadata.textContent = "";
    status.textContent = "";
    listRange.textContent = "";
    controls();
  }
  const validText = (value, limit) => typeof value === "string" && value.length > 0 && value.length <= limit && !value.includes("\0");
  function guidanceOrigin(value) {
    if (value?.guidanceOrigin === undefined) return "imported_reference";
    return ["imported_reference", "manuscript_proposal"].includes(value.guidanceOrigin) ? value.guidanceOrigin : null;
  }
  function validMetadata(snapshot, active) {
    const value = snapshot?.importedVisualReferences;
    return Boolean(active && [active.workId, active.manuscriptVersionId, active.analysisJobId].every(id => idPattern.test(id || "")) &&
      validText(active.identity?.ownerId, 320) && Number.isSafeInteger(active.identity?.epoch) && active.identity.epoch >= 0 &&
      snapshot?.manuscriptVersionId === active.manuscriptVersionId && snapshot.analysisJobId === active.analysisJobId &&
      (snapshot.workId === undefined || snapshot.workId === active.workId) && hashPattern.test(snapshot.manuscriptHash || "") &&
      value?.contract === "publication-visual-reference-preview-v1" && value.approvalState === "reference_only" &&
      guidanceOrigin(value) !== null &&
      value.requiresSceneReview === true && value.manuscriptHash === snapshot.manuscriptHash && hashPattern.test(value.checksum || "") &&
      Number.isSafeInteger(value.totalReferences) && value.totalReferences >= 0 && value.totalReferences <= 2000 &&
      ["exact_source_segments", "unmapped_legacy"].includes(value.mappingState) &&
      value.mappedReferences === (value.mappingState === "exact_source_segments" ? value.totalReferences : 0));
  }
  function completedMatches(active) {
    const completed = window.LuminaCreatorAnalysis?.completed?.();
    return Boolean(completed && window.LuminaCreatorStudioApi?.isCurrent?.(active.identity) &&
      completed.workId === active.workId && completed.manuscriptVersionId === active.manuscriptVersionId &&
      completed.analysisJobId === active.analysisJobId && completed.identity?.ownerId === active.identity.ownerId &&
      completed.identity?.epoch === active.identity.epoch &&
      ["manuscriptHash", "contentHash", "sourceChecksum", "checksum", "sourceLocale"].every(key => completed[key] === active[key]));
  }
  function current() {
    if (!scope) return false;
    const value = scope.snapshot.importedVisualReferences;
    const okay = !modal.classList.contains("is-hidden") && !modal.hidden && completedMatches(scope.active) &&
      validMetadata(scope.snapshot, scope.active) && value.manuscriptHash === scope.manuscriptHash &&
      guidanceOrigin(value) === scope.guidanceOrigin &&
      value.checksum === scope.checksum && value.totalReferences === scope.totalReferences && value.mappingState === scope.mappingState &&
      ["manuscriptHash", "contentHash"].every(key => scope.active[key] === undefined || scope.active[key] === scope.manuscriptHash) &&
      ["sourceChecksum", "checksum"].every(key => scope.active[key] === undefined || scope.active[key] === scope.checksum);
    if (!okay) reset();
    return okay;
  }
  function show(snapshot, active) {
    if (!validMetadata(snapshot, active) || !completedMatches(active) || modal.classList.contains("is-hidden") || modal.hidden) {
      reset();
      return;
    }
    const value = snapshot.importedVisualReferences;
    if (scope && current() && scope.manuscriptHash === value.manuscriptHash && scope.checksum === value.checksum &&
        scope.totalReferences === value.totalReferences && scope.mappingState === value.mappingState && guidanceOrigin(value) === scope.guidanceOrigin) {
      scope.snapshot = snapshot;
      renderCopy();
      return;
    }
    reset();
    scope = { snapshot, active: { ...active, identity: { ...active.identity } }, manuscriptHash: value.manuscriptHash,
      checksum: value.checksum, totalReferences: value.totalReferences, mappingState: value.mappingState, guidanceOrigin: guidanceOrigin(value) };
    if (!current()) return;
    root.hidden = false;
    message(value.totalReferences ? null : "empty");
    controls();
    timer = setInterval(current, 500);
  }
  function invalid() { return Object.assign(new Error("Unverifiable reference"), { uiKey: "invalid" }); }
  function common(data, contract) {
    return Boolean(data && scope && data.contract === contract && data.workId === scope.active.workId &&
      data.manuscriptVersionId === scope.active.manuscriptVersionId && data.manuscriptHash === scope.manuscriptHash &&
      data.checksum === scope.checksum && data.approvalState === "reference_only" && data.requiresSceneReview === true &&
      data.mappingState === scope.mappingState && guidanceOrigin(data) === scope.guidanceOrigin);
  }
  function validRow(row, index) {
    if (!row || row.referenceIndex !== index || typeof row.sourceSceneKey !== "string" || !keyPattern.test(row.sourceSceneKey) ||
        typeof row.promptSha256 !== "string" || !hashPattern.test(row.promptSha256)) return false;
    if (scope.mappingState === "unmapped_legacy") return row.partKey === null && row.partTitle === null && row.segmentCount === 0;
    return validText(row.partKey, 120) && validText(row.partTitle, 1000) && Number.isSafeInteger(row.segmentCount) &&
      row.segmentCount > 0 && row.segmentCount <= 1000 && Array.isArray(scope.snapshot.parts) &&
      scope.snapshot.parts.filter(part => part.partKey === row.partKey && part.title === row.partTitle).length === 1;
  }
  function validPage(data, offset) {
    const count = Math.min(pageSize, scope.totalReferences - offset);
    return common(data, "publication-visual-reference-page-v1") && data.totalReferences === scope.totalReferences &&
      data.offset === offset && Array.isArray(data.items) && data.items.length === count &&
      data.items.every((row, index) => validRow(row, offset + index)) &&
      new Set(data.items.map(row => row.sourceSceneKey)).size === count &&
      data.nextOffset === (offset + count < data.totalReferences ? offset + count : null);
  }
  async function validDetail(data, row, offset) {
    if (!common(data, "publication-visual-reference-detail-v1") || data.referenceIndex !== row.referenceIndex ||
        data.sourceSceneKey !== row.sourceSceneKey || data.promptSha256 !== row.promptSha256 ||
        !validText(data.promptText, 32000) || !data.promptText.trim() || !window.crypto?.subtle) return false;
    const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(data.promptText));
    const promptHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    if (promptHash !== row.promptSha256) return false;
    if (scope?.mappingState === "unmapped_legacy") return data.reader === null && offset === 0;
    const value = data.reader;
    if (!value || value.partKey !== row.partKey || value.partTitle !== row.partTitle || value.segmentCount !== row.segmentCount ||
        typeof value.text !== "string" || value.text.length > textSize || value.text.includes("\0") ||
        value.textOffset !== offset || !Number.isSafeInteger(value.totalTextLength) || value.totalTextLength < 0 ||
        (readerTotal !== null && value.totalTextLength !== readerTotal) ||
        /^[\uDC00-\uDFFF]/u.test(value.text) || /[\uD800-\uDBFF]$/u.test(value.text)) return false;
    if (value.totalTextLength === 0) return offset === 0 && value.text === "" && value.nextTextOffset === null;
    if (value.totalTextLength <= offset || !value.text.length) return false;
    const maximum = Math.min(textSize, value.totalTextLength - offset);
    // A server chunk can be one UTF-16 unit shorter to keep a surrogate pair intact.
    if (value.text.length !== maximum && !(maximum === textSize && value.totalTextLength - offset > textSize &&
        value.text.length === textSize - 1)) return false;
    return value.nextTextOffset === (offset + value.text.length < value.totalTextLength ? offset + value.text.length : null);
  }
  async function request(suffix, query, validate, preserveReview = false) {
    if (!current()) return null;
    controller?.abort();
    const requestController = controller = new AbortController();
    const stamp = ++revision;
    const captured = scope;
    const params = new URLSearchParams({ expectedManuscriptHash: scope.manuscriptHash, expectedSourceChecksum: scope.checksum, ...query });
    const path = `/api/v1/me/creator-studio/stories/${encodeURIComponent(scope.active.workId)}/linear-draft/${encodeURIComponent(scope.active.manuscriptVersionId)}/visual-references${suffix}?${params}`;
    const live = () => stamp === revision && scope === captured && !requestController.signal.aborted && current();
    busy = true;
    message("loading");
    controls();
    try {
      const response = await window.LuminaCreatorStudioApi.fetch(path, { method: "GET", identity: captured.active.identity, signal: requestController.signal });
      if (!live()) return null;
      if (!response.ok) throw Object.assign(new Error("Reference request failed"), { status: response.status });
      const data = await response.json();
      if (!live()) return null;
      const verified = await validate(data);
      if (!live()) return null;
      if (!verified) throw invalid();
      message(null);
      return data;
    } catch (error) {
      if (!live()) return null;
      if (error.status === 401 || error.status === 403) { reset(); return null; }
      clearDetail(preserveReview && error.status !== 404 && error.status !== 409 && error.uiKey !== "invalid");
      if (error.status === 404 || error.status === 409 || error.uiKey === "invalid") {
        page = null;
        selected = null;
        select.replaceChildren();
        listRange.textContent = "";
        viewer.hidden = true;
      }
      message(error.status === 404 ? "empty" : error.status === 409 ? "changed" : error.uiKey || "failed");
      return null;
    } finally {
      if (stamp === revision && scope === captured) { busy = false; controller = null; controls(); }
    }
  }
  async function loadList(offsets = [0]) {
    if (!current() || busy) return;
    if (opened && window.LuminaCreatorVisualReview?.canLeave?.() === false) return;
    const offset = offsets.at(-1);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset % pageSize !== 0 || (offset >= scope.totalReferences && offset !== 0)) return;
    opened = true;
    viewer.hidden = true;
    page = null;
    selected = null;
    readerTotal = null;
    select.replaceChildren();
    clearDetail();
    const data = await request("", { offset: String(offset) }, value => validPage(value, offset));
    if (!data || !current()) {
      if (scope && statusKey === "failed") { retryAction = () => loadList(offsets); retry.hidden = false; }
      return;
    }
    page = data;
    listOffsets = offsets;
    page.items.forEach(row => {
      const option = document.createElement("option");
      option.value = String(row.referenceIndex);
      option.textContent = rowLabel(row);
      select.append(option);
    });
    viewer.hidden = !data.items.length;
    renderCopy();
    controls();
    if (data.items.length) {
      select.value = String(data.items[0].referenceIndex);
      if (document.activeElement === openButton) select.focus();
      await choose();
    } else message("empty");
  }
  async function loadDetail(offsets = [0]) {
    if (!current() || busy || !selected) return;
    const row = selected;
    const offset = offsets.at(-1);
    if (!Number.isSafeInteger(offset) || offset < 0 ||
        (readerTotal !== null && offset >= readerTotal)) return;
    clearDetail(true);
    const data = await request(`/${row.referenceIndex}`, { textOffset: String(offset) }, value => validDetail(value, row, offset), true);
    if (!data || !current()) {
      if (scope && statusKey === "failed") { retryAction = () => loadDetail(offsets); retry.hidden = false; }
      return;
    }
    detail = data;
    textOffsets = offsets;
    prompt.textContent = data.promptText;
    sceneKey.textContent = data.sourceSceneKey;
    columns.hidden = false;
    const mapped = data.reader !== null;
    const hasProse = mapped && data.reader.totalTextLength > 0;
    unmapped.hidden = mapped;
    noProse.hidden = !mapped || hasProse;
    readerPart.hidden = !mapped;
    [pageNote, reader, textPager].forEach(node => { node.hidden = !hasProse; });
    if (mapped) {
      readerTotal = data.reader.totalTextLength;
      reader.textContent = data.reader.text;
    }
    prompt.scrollTop = 0;
    reader.scrollTop = 0;
    renderCopy();
    controls();
    await window.LuminaCreatorVisualReview?.show(data, scope.snapshot, scope.active);
  }
  async function choose() {
    if (!current() || busy) return;
    const next = page?.items.find(row => String(row.referenceIndex) === select.value) || null;
    if (next?.referenceIndex !== selected?.referenceIndex) {
      if (window.LuminaCreatorVisualReview?.canLeave?.() === false) { select.value = String(selected.referenceIndex); return; }
      clearDetail();
    }
    selected = next;
    readerTotal = null;
    textOffsets = [0];
    if (selected) await loadDetail();
  }
  openButton.addEventListener("click", () => loadList());
  select.addEventListener("change", choose);
  listPrev.addEventListener("click", () => { if (listOffsets.length > 1) return loadList(listOffsets.slice(0, -1)); });
  listNext.addEventListener("click", () => { if (page?.nextOffset != null) return loadList([...listOffsets, page.nextOffset]); });
  textPrev.addEventListener("click", () => { if (textOffsets.length > 1) return loadDetail(textOffsets.slice(0, -1)); });
  textNext.addEventListener("click", () => { if (detail?.reader?.nextTextOffset != null) return loadDetail([...textOffsets, detail.reader.nextTextOffset]); });
  retry.addEventListener("click", () => { if (current() && !busy) return retryAction?.(); });
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
  window.LuminaCreatorVisualReferences = { show, reset };
  reset();
  renderCopy();
})();

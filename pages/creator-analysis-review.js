(function initWriterAnalysis() {
  "use strict";
  const api = window.LuminaCreatorStudioApi;
  const manuscript = window.LuminaCreatorManuscript;
  const panel = document.getElementById("writerAnalysis");
  if (!api || !manuscript || !panel) return;
  const root = "/api/v1/me/creator-studio";
  const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  const locales = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
  const languageNames = { ko: "한국어", en: "English", ja: "日本語", "zh-Hans": "简体中文", "zh-Hant": "繁體中文" };
  const el = Object.fromEntries(["Version", "State", "Progress", "Counts", "Start", "Check", "Boundary", "Evidence", "Pages", "Previous", "Next", "PageCount"].map(name => [name, document.getElementById("writerAnalysis" + name)]));
  const generation = {
    entry: document.getElementById("writerGenerationEntry"),
    open: document.getElementById("writerGenerationReviewOpen"),
    entryState: document.getElementById("writerGenerationReviewState"),
    modal: document.getElementById("writerGenerationModal"),
    eyebrow: document.getElementById("writerGenerationEyebrow"),
    title: document.getElementById("writerGenerationTitle"),
    intro: document.getElementById("writerGenerationIntro"),
    status: document.getElementById("writerGenerationStatus"),
    sections: document.getElementById("writerGenerationSections"),
    close: document.getElementById("writerGenerationClose"),
    cancel: document.getElementById("writerGenerationCancel"),
    save: document.getElementById("writerGenerationSave"),
    approve: document.getElementById("writerGenerationApprove")
  };
  const generationSectionOrder = ["writing_style", "scene_scale", "canon", "timeline", "narrative_devices", "branch_behavior", "visual_direction", "visual_cast"];
  const generationOptional = new Set(["narrative_devices", "visual_cast"]);
  const generationCopy = {
    ko: {
      eyebrow: "AI 분석 결과", title: "스토리 생성 설정 검토", intro: "원고 전체에서 찾은 기준입니다. 각 항목을 확인하거나 필요한 부분만 고쳐주세요.",
      close: "닫기", later: "나중에", save: "임시 저장", approve: "확인 후 적용", open: "생성 설정 검토",
      loading: "원고 분석 결과를 생성 설정으로 정리하고 있습니다.", ready: "생성 전에 확인할 설정이 준비되었습니다.", approved: "이 원고의 생성 설정이 적용되었습니다.",
      saved: "수정 내용이 저장되었습니다.", saveFailed: "설정을 저장하지 못했습니다. 다시 시도해주세요.", approveFailed: "모든 필수 항목을 확인한 뒤 적용해주세요.",
      accept: "맞음", edit: "수정해서 사용", remove: "이 항목 제외", evidence: "판단 근거 보기", noEvidence: "직접 확인이 필요한 기본 기준입니다.",
      writing_style: "작가 문체", scene_scale: "장면 분량", canon: "세계관과 고정 설정", timeline: "시간 흐름", narrative_devices: "복선과 회수", branch_behavior: "선택 후 전개", visual_direction: "배경과 그림 분위기", visual_cast: "등장인물 외형"
    },
    en: {
      eyebrow: "AI analysis", title: "Review story generation settings", intro: "These settings were derived from the complete manuscript. Confirm or edit each item.",
      close: "Close", later: "Later", save: "Save draft", approve: "Approve and apply", open: "Review generation settings",
      loading: "Preparing generation settings from the manuscript analysis.", ready: "Generation settings are ready for review.", approved: "Generation settings are active for this manuscript.",
      saved: "Your changes were saved.", saveFailed: "Settings could not be saved. Try again.", approveFailed: "Confirm every required item before applying.",
      accept: "Confirm", edit: "Use my edit", remove: "Exclude item", evidence: "View supporting analysis", noEvidence: "This default needs your confirmation.",
      writing_style: "Writing style", scene_scale: "Scene length", canon: "Canon and world rules", timeline: "Timeline", narrative_devices: "Foreshadowing and payoff", branch_behavior: "Branch behavior", visual_direction: "Background and visual mood", visual_cast: "Character appearance"
    },
    ja: {
      eyebrow: "AI分析結果", title: "ストーリー生成設定の確認", intro: "原稿全体から抽出した基準です。各項目を確認または修正してください。",
      close: "閉じる", later: "あとで", save: "下書き保存", approve: "確認して適用", open: "生成設定を確認",
      loading: "原稿分析から生成設定を整理しています。", ready: "生成前に確認する設定が準備できました。", approved: "この原稿の生成設定を適用しました。",
      saved: "修正内容を保存しました。", saveFailed: "設定を保存できませんでした。もう一度お試しください。", approveFailed: "必須項目をすべて確認してから適用してください。",
      accept: "正しい", edit: "修正して使用", remove: "この項目を除外", evidence: "判断根拠を見る", noEvidence: "確認が必要な基本設定です。",
      writing_style: "作家の文体", scene_scale: "場面の分量", canon: "世界観と固定設定", timeline: "時間の流れ", narrative_devices: "伏線と回収", branch_behavior: "選択後の展開", visual_direction: "背景と画面の雰囲気", visual_cast: "登場人物の外見"
    },
    "zh-Hans": {
      eyebrow: "AI 分析结果", title: "核对故事生成设置", intro: "这些标准来自完整稿件。请逐项确认或修改。",
      close: "关闭", later: "稍后", save: "保存草稿", approve: "确认并应用", open: "核对生成设置",
      loading: "正在根据稿件分析整理生成设置。", ready: "生成设置已准备好，等待核对。", approved: "已应用此稿件的生成设置。",
      saved: "修改内容已保存。", saveFailed: "无法保存设置，请重试。", approveFailed: "请确认所有必填项后再应用。",
      accept: "正确", edit: "修改后使用", remove: "排除此项", evidence: "查看判断依据", noEvidence: "这是需要确认的默认标准。",
      writing_style: "作者文风", scene_scale: "场景篇幅", canon: "世界观与固定设定", timeline: "时间线", narrative_devices: "伏笔与回收", branch_behavior: "选择后的发展", visual_direction: "背景与画面氛围", visual_cast: "人物外观"
    },
    "zh-Hant": {
      eyebrow: "AI 分析結果", title: "核對故事生成設定", intro: "這些標準來自完整稿件。請逐項確認或修改。",
      close: "關閉", later: "稍後", save: "儲存草稿", approve: "確認並套用", open: "核對生成設定",
      loading: "正在根據稿件分析整理生成設定。", ready: "生成設定已準備好，等待核對。", approved: "已套用此稿件的生成設定。",
      saved: "修改內容已儲存。", saveFailed: "無法儲存設定，請重試。", approveFailed: "請確認所有必填項後再套用。",
      accept: "正確", edit: "修改後使用", remove: "排除此項", evidence: "查看判斷依據", noEvidence: "這是需要確認的預設標準。",
      writing_style: "作者文風", scene_scale: "場景篇幅", canon: "世界觀與固定設定", timeline: "時間線", narrative_devices: "伏筆與回收", branch_behavior: "選擇後的發展", visual_direction: "背景與畫面氛圍", visual_cast: "人物外觀"
    }
  };
  let scope = null;
  let receipt = null;
  let job = null;
  let requestKey = null;
  let analysisId = null;
  let epoch = 0;
  let busy = false;
  let starting = false;
  let phase = "ready";
  let page = emptyPage();
  let history = [];
  let poll = null;
  let pollDelay = 2500;
  let renderedIds = [];
  let renderedCursor;
  let renderedEpoch = -1;
  let generationResponse = null;
  let generationBusy = false;
  let generationLoadedFor = null;
  const controllers = new Set();

  function t(key, values = {}) {
    const value = window.luminaI18n.t("writerAnalysis." + key);
    return value.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
  }
  function gt(key) {
    const locale = window.luminaI18n?.getLocale?.() || "ko";
    return generationCopy[locale]?.[key] || generationCopy.ko[key] || key;
  }
  function emptyPage() { return { cursor: null, start: 0, rows: [], endCursor: null, hasMore: false, nextCursor: null }; }
  function context() { return { ...manuscript.context(), identity: api.identity() }; }
  function sameContext(left, right) {
    return Boolean(left && right && left.workId === right.workId && left.sourceLocale === right.sourceLocale &&
      left.identity.ownerId === right.identity.ownerId && left.identity.epoch === right.identity.epoch);
  }
  function current(stamp = epoch) {
    if (stamp !== epoch || !scope) return false;
    if (!api.isCurrent(scope.identity) || !sameContext(scope, context())) { invalidate(); return false; }
    return true;
  }
  function stopRequests() {
    epoch++;
    controllers.forEach(controller => controller.abort());
    controllers.clear();
    clearTimeout(poll);
    poll = null;
    busy = false;
  }
  function invalidate() {
    stopRequests();
    scope = null; receipt = null; job = null; analysisId = null; requestKey = null;
    starting = false; page = emptyPage(); history = [];
    panel.hidden = true;
    el.Evidence.replaceChildren();
    el.State.textContent = ""; el.Counts.textContent = ""; el.Version.textContent = "";
    generationResponse = null; generationBusy = false; generationLoadedFor = null;
    generation.entry.hidden = true; generation.sections.replaceChildren();
    closeGenerationModal();
  }
  function receiptKey() { return `lumina.writer.analysis:${scope.identity.ownerId}:${receipt.id}`; }
  function pointerKey() { return `lumina.writer.resume:${scope.identity.ownerId}:${scope.workId}:${scope.sourceLocale}`; }
  function remember() {
    // Store only scoped identifiers and the original request key, never source, quotes, or evidence.
    try {
      sessionStorage.setItem(receiptKey(), JSON.stringify({ requestKey, analysisId }));
      sessionStorage.setItem(pointerKey(), JSON.stringify({ manuscriptId: receipt.id }));
      return true;
    } catch (_) { return false; }
  }
  function savedRequest() {
    try {
      const value = JSON.parse(sessionStorage.getItem(receiptKey()) || "null");
      if (/^[A-Za-z0-9_-]{8,200}$/.test(value?.requestKey || "") && (!value.analysisId || uuid.test(value.analysisId))) return value;
    } catch (_) {}
    return null;
  }
  function receive(value) {
    invalidate();
    scope = context();
    if (!scope.identity.ownerId || !uuid.test(value?.id || "") || value.workId !== scope.workId ||
        value.sourceLocale !== scope.sourceLocale || !api.isCurrent(value.identity)) return invalidate();
    receipt = { ...value };
    const saved = savedRequest();
    requestKey = saved?.requestKey || null;
    analysisId = saved?.analysisId || null;
    phase = analysisId ? "loading" : requestKey ? "unknown" : "ready";
    render();
    if (analysisId) loadPage(null, 0);
  }
  function contextChanged() {
    const next = context();
    if (sameContext(scope, next)) return;
    invalidate();
    if (!next.identity.ownerId || !uuid.test(next.workId) || !locales.includes(next.sourceLocale)) return;
    const retained = manuscript.receipt();
    if (retained?.workId === next.workId && retained.sourceLocale === next.sourceLocale && api.isCurrent(retained.identity)) return receive(retained);
    if (document.getElementById("writerManuscriptBody")?.value) return;
    scope = next;
    try {
      const pointer = JSON.parse(sessionStorage.getItem(pointerKey()) || "null");
      if (!uuid.test(pointer?.manuscriptId || "")) return invalidate();
      receive({ id: pointer.manuscriptId, workId: next.workId, sourceLocale: next.sourceLocale, identity: next.identity });
    } catch (_) { invalidate(); }
  }
  async function request(path, options = {}, stamp = epoch) {
    if (!current(stamp)) throw new Error("stale");
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await api.fetch(root + path, { ...options, signal: controller.signal, identity: scope.identity });
      const data = await response.json().catch(() => null);
      if (!current(stamp)) throw new Error("stale");
      if (!response.ok) throw Object.assign(new Error("request"), { status: response.status, code: data?.error?.code || data?.code || "" });
      return data;
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  }
  function validJob(value) {
    const semantic = value?.kind === "semantic_extraction_v1";
    return value && uuid.test(value.id) && value.manuscriptVersionId === receipt.id &&
      (!analysisId || value.id === analysisId) && ["queued", "running", "completed", "failed"].includes(value.status) &&
      (semantic ? value.sourceLocale === scope.sourceLocale && /^[0-9a-f]{64}$/i.test(value.sourceContentHash || "") &&
        (!receipt.contentHash || value.sourceContentHash === receipt.contentHash) : value.kind === "structural_legacy") &&
      Number.isSafeInteger(value.evidenceCount) && value.evidenceCount >= 0;
  }
  function acceptJob(value) {
    if (!validJob(value)) throw new Error("projection");
    job = value; analysisId = value.id; remember();
    if (value.kind !== "semantic_extraction_v1") phase = "structural";
    else if (value.status === "completed") phase = value.semanticCompleted && value.progress?.coverageComplete ? "completed" : "incomplete";
    else if (value.status === "failed") phase = value.budget?.usageUnobserved ? "failedUnknown" : "failed";
    else phase = value.status === "queued" ? "queued" : ["planning", "extracting", "finalizing"].includes(value.phase) ? value.phase : "queued";
  }
  function handleError(error, isStart = false) {
    if ([401, 403, 404].includes(error.status)) { invalidate(); return; }
    if (isStart && error.code === "ANALYSIS_VERSION_ALREADY_RESERVED") phase = "reserved";
    else if (isStart && error.code === "SEMANTIC_ANALYSIS_UNAVAILABLE") phase = "unavailable";
    else phase = isStart ? "unknown" : "loadFailed";
    render();
  }
  async function start() {
    if (!receipt || analysisId || busy || phase === "reserved" || !current()) return;
    clearTimeout(poll);
    if (!requestKey) requestKey = crypto.randomUUID();
    if (!remember()) { phase = "storageUnavailable"; render(); return; }
    const stamp = epoch;
    busy = true; starting = true; phase = "starting"; render();
    try {
      acceptJob(await request(`/manuscripts/${receipt.id}/analyses`, { method: "POST", headers: { "Idempotency-Key": requestKey } }, stamp));
      if (current(stamp)) { busy = false; starting = false; await loadPage(null, 0); }
    } catch (error) { if (current(stamp)) handleError(error, true); }
    finally { if (current(stamp)) { busy = false; starting = false; render(); } }
  }
  function validEvidence(row) {
    if (!row || !uuid.test(row.id) || !["semantic_candidate", "structural_only", "structural_legacy"].includes(row.provenance)) return false;
    return row.provenance !== "semantic_candidate" || (row.interpretation === "model_inference" && row.factualTruthApproved === false &&
      row.sourceLocale === scope.sourceLocale && typeof row.title === "string" && row.title.length <= 120 &&
      typeof row.observation === "string" && row.observation.length <= 1200 && Array.isArray(row.citations) && row.citations.length > 0 && row.citations.length <= 4);
  }
  function validatePage(data, cursor) {
    if (!validJob(data?.job) || !Array.isArray(data.evidence) || data.evidence.length > 100 ||
        !data.evidence.every(validEvidence) || new Set(data.evidence.map(row => row.id)).size !== data.evidence.length ||
        typeof data.hasMore !== "boolean" || data.endCursor !== (data.evidence.at(-1)?.id || cursor) ||
        (data.hasMore ? !data.evidence.length || data.nextCursor !== data.endCursor : data.nextCursor !== null) ||
        data.evidence.some(row => row.id === cursor)) throw new Error("page");
    return data;
  }
  async function loadPage(cursor, startIndex, { append = false, pollOnly = false, navigation = null } = {}) {
    if (!analysisId || busy || !current()) return;
    clearTimeout(poll);
    const stamp = epoch;
    busy = true; renderControls();
    try {
      const query = cursor ? "?" + new URLSearchParams({ cursor }) : "";
      const data = validatePage(await request(`/analyses/${analysisId}${query}`, {}, stamp), cursor);
      if (!current(stamp)) return;
      acceptJob(data.job);
      if (!pollOnly) {
        const rows = append ? [...page.rows, ...data.evidence] : data.evidence;
        if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("duplicate evidence");
        const visible = rows.slice(0, 100);
        const more = rows.length > 100 || data.hasMore;
        if (navigation === "next") history.push({ cursor: page.cursor, start: page.start });
        if (navigation === "previous") history.pop();
        page = { cursor: append ? page.cursor : cursor, start: startIndex, rows: visible,
          endCursor: visible.at(-1)?.id || cursor, hasMore: more, nextCursor: more ? visible.at(-1)?.id : null };
      }
      pollDelay = 2500;
      render();
    } catch (error) { if (current(stamp)) { pollDelay = Math.min(pollDelay * 2, 15000); handleError(error); } }
    finally { if (current(stamp)) { busy = false; renderControls(); schedulePoll(); } }
  }
  function schedulePoll() {
    clearTimeout(poll);
    if (!current() || document.hidden || !["queued", "running"].includes(job?.status) || busy) return;
    poll = setTimeout(() => loadPage(page.endCursor, page.start, { append: !page.hasMore, pollOnly: page.hasMore }), pollDelay);
  }
  function renderControls() {
    panel.hidden = !receipt;
    el.Start.hidden = Boolean(job) || !["ready", "unavailable", "storageUnavailable"].includes(phase);
    el.Start.disabled = busy;
    el.Check.hidden = !analysisId && phase !== "unknown";
    el.Check.disabled = busy;
    el.Check.textContent = t(analysisId ? "check" : "checkRequest");
    el.Previous.disabled = busy || !history.length;
    el.Next.disabled = busy || !page.hasMore;
    el.Previous.title = t("previous"); el.Previous.setAttribute("aria-label", t("previous"));
    el.Next.title = t("next"); el.Next.setAttribute("aria-label", t("next"));
    el.Pages.setAttribute("aria-label", t("evidence"));
    el.Pages.hidden = !job || !page.rows.length;
  }
  function render() {
    if (!receipt) return;
    renderControls();
    el.Version.textContent = t(receipt.version ? "version" : "savedVersion", { version: receipt.version, language: languageNames[scope.sourceLocale] });
    el.State.textContent = t(phase);
    el.State.classList.toggle("is-danger", ["unknown", "failed", "failedUnknown", "unavailable", "loadFailed", "incomplete", "reserved", "storageUnavailable"].includes(phase));
    el.Boundary.hidden = !job;
    const counters = job?.progress;
    const total = counters?.totalParagraphs;
    const done = job?.phase === "planning" ? counters?.plannedParagraphs : counters?.completedParagraphs;
    el.Progress.hidden = !job || job.kind !== "semantic_extraction_v1";
    if (Number.isSafeInteger(total) && total > 0 && Number.isSafeInteger(done) && done >= 0 && done <= total) {
      el.Progress.max = total; el.Progress.value = done;
      el.Counts.textContent = t("counts", { done, total, evidence: job.evidenceCount });
    } else { el.Progress.removeAttribute("value"); el.Counts.textContent = ""; }
    el.Progress.setAttribute("aria-label", t("title"));
    generation.entry.hidden = phase !== "completed";
    generation.open.textContent = gt("open");
    if (phase === "completed" && generationLoadedFor !== analysisId && !generationBusy) {
      generationLoadedFor = analysisId;
      queueMicrotask(() => loadGenerationProfile(true));
    }
    el.PageCount.textContent = t("pageCount", { from: page.start + 1, to: page.start + page.rows.length, total: job?.evidenceCount || 0 });
    // Evidence is append-only on the server. Preserve open quotes and focus during status polling.
    if (renderedEpoch !== epoch || renderedCursor !== page.cursor || renderedIds.length > page.rows.length ||
        renderedIds.some((id, index) => id !== page.rows[index]?.id)) {
      el.Evidence.replaceChildren(); renderedIds = [];
    }
    el.Evidence.append(...page.rows.slice(renderedIds.length).map(evidenceElement));
    renderedIds = page.rows.map(row => row.id); renderedCursor = page.cursor; renderedEpoch = epoch;
  }
  function evidenceElement(row) {
    const item = document.createElement("article"); item.className = "writer-analysis-item";
    const heading = document.createElement("h3"); heading.textContent = row.title || t("structure");
    const text = document.createElement("p"); text.textContent = row.observation || t("structureNote");
    const provenance = document.createElement("p"); provenance.className = "writer-analysis-meta";
    provenance.textContent = t(row.provenance === "semantic_candidate" ? "inference" : "structure");
    item.append(heading, provenance, text);
    if (row.provenance === "semantic_candidate") {
      const button = document.createElement("button"); button.type = "button"; button.className = "secondary-action"; button.textContent = t("source");
      const quote = document.createElement("div"); quote.hidden = true;
      button.setAttribute("aria-expanded", "false");
      button.addEventListener("click", () => {
        if (!quote.hidden && !quote.dataset.failed) { quote.replaceChildren(); quote.hidden = true; button.setAttribute("aria-expanded", "false"); return; }
        loadQuote(row, quote, button);
      });
      item.append(button, quote);
    }
    return item;
  }
  async function loadQuote(row, target, button) {
    if (!current() || button.disabled) return;
    const stamp = epoch;
    delete target.dataset.failed;
    button.disabled = true; target.hidden = false; target.textContent = t("loading"); button.setAttribute("aria-expanded", "true");
    try {
      const data = await request(`/analyses/${analysisId}/evidence/${row.id}/source`, {}, stamp);
      if (!current(stamp) || !target.isConnected) return;
      if (data?.evidenceId !== row.id || data.manuscriptVersionId !== receipt.id || data.sourceLocale !== scope.sourceLocale ||
          !Array.isArray(data.citations) || data.citations.length !== row.citations.length || !data.citations.length || data.citations.length > 4) throw new Error("citation");
      const fragments = data.citations.map((citation, index) => {
        const expected = row.citations[index];
        if (!["partIndex", "partKey", "paragraphIndex", "start", "end", "quoteHash"].every(key => citation[key] === expected[key]) ||
            !Number.isSafeInteger(citation.partIndex) || !Number.isSafeInteger(citation.paragraphIndex) ||
            citation.partIndex < 0 || citation.paragraphIndex < 0 || !Number.isSafeInteger(citation.start) ||
            !Number.isSafeInteger(citation.end) || citation.start < 0 || citation.end <= citation.start ||
            !/^[a-f0-9]{64}$/.test(citation.quoteHash) || typeof citation.quote !== "string" ||
            citation.quote.length !== citation.end - citation.start || citation.quote.length > 512) throw new Error("citation");
        const fragment = document.createElement("div");
        const label = document.createElement("p"); label.className = "writer-analysis-meta";
        label.textContent = t("location", { part: citation.partIndex + 1, paragraph: citation.paragraphIndex + 1 });
        const quote = document.createElement("blockquote"); quote.textContent = citation.quote;
        fragment.append(label, quote); return fragment;
      });
      target.replaceChildren(...fragments);
    } catch (error) {
      if (current(stamp) && target.isConnected) {
        if ([401, 403, 404].includes(error.status)) { invalidate(); return; }
        target.textContent = t("quoteFailed"); target.dataset.failed = "true";
      }
    }
    finally { if (current(stamp) && target.isConnected) button.disabled = false; }
  }

  function validGenerationResponse(value) {
    const profile = value?.profile;
    const settings = profile?.status === "approved" ? profile.approvedSettings : profile?.draftSettings;
    return value?.workId === scope?.workId && value?.analysis?.id === analysisId && profile &&
      /^[0-9a-f-]{36}$/i.test(profile.id || "") && /^[a-f0-9]{64}$/i.test(profile.sourceFingerprint || "") &&
      settings?.schemaVersion === "creator-generation-profile-v1" && settings?.kind === "story" &&
      Array.isArray(settings.sections) && settings.sections.length === generationSectionOrder.length &&
      generationSectionOrder.every(key => settings.sections.some(section => section?.key === key));
  }

  function setGenerationCopy() {
    generation.eyebrow.textContent = gt("eyebrow"); generation.title.textContent = gt("title");
    generation.intro.textContent = gt("intro"); generation.close.textContent = gt("close");
    generation.cancel.textContent = gt("later"); generation.save.textContent = gt("save");
    generation.approve.textContent = gt("approve"); generation.open.textContent = gt("open");
  }

  async function loadGenerationProfile(autoOpen) {
    if (!analysisId || phase !== "completed" || generationBusy || !current()) return;
    const stamp = epoch;
    generationBusy = true; setGenerationCopy();
    generation.entryState.textContent = gt("loading");
    try {
      const value = await request(`/stories/${encodeURIComponent(scope.workId)}/generation-profile`, {}, stamp);
      if (!validGenerationResponse(value)) throw new Error("profile projection");
      generationResponse = value;
      generation.entryState.textContent = value.profile.status === "approved" ? gt("approved") : gt("ready");
      if (autoOpen && value.profile.status !== "approved") openGenerationModal();
      else if (!autoOpen) openGenerationModal();
    } catch (_) {
      if (current(stamp)) generation.entryState.textContent = gt("saveFailed");
    } finally {
      if (current(stamp)) generationBusy = false;
    }
  }

  function activeGenerationSettings() {
    const profile = generationResponse?.profile;
    return profile?.status === "approved" ? profile.approvedSettings : profile?.draftSettings;
  }

  function openGenerationModal() {
    if (!generationResponse) return;
    setGenerationCopy(); renderGenerationSections();
    generation.modal.classList.remove("is-hidden");
    document.body.style.overflow = "hidden";
    generation.close.focus();
  }

  function closeGenerationModal() {
    generation.modal?.classList.add("is-hidden");
    if (!document.querySelector(".studio-modal:not(.is-hidden)")) document.body.style.overflow = "";
  }

  function renderGenerationSections() {
    const settings = activeGenerationSettings();
    const approved = generationResponse.profile.status === "approved";
    generation.sections.replaceChildren(...generationSectionOrder.map(key => {
      const section = settings.sections.find(item => item.key === key);
      const article = document.createElement("article"); article.className = "writer-generation-section"; article.dataset.key = key;
      const header = document.createElement("header");
      const heading = document.createElement("h3"); heading.textContent = gt(key);
      const state = document.createElement("p"); state.textContent = section.decision === "proposed" ? gt("ready") : section.decision === "removed" ? gt("remove") : gt(section.decision === "edited" ? "edit" : "accept");
      header.append(heading, state);
      const textarea = document.createElement("textarea"); textarea.value = String(section.value?.summary || ""); textarea.maxLength = 8000; textarea.disabled = approved;
      textarea.addEventListener("input", () => selectGenerationDecision(article, section, "edited"));
      const controls = document.createElement("div"); controls.className = "writer-generation-decisions";
      controls.append(decisionButton(article, section, "accepted", "accept", approved), decisionButton(article, section, "edited", "edit", approved));
      if (generationOptional.has(key)) controls.append(decisionButton(article, section, "removed", "remove", approved));
      const details = document.createElement("details"); details.className = "writer-generation-evidence";
      const summary = document.createElement("summary"); summary.textContent = gt("evidence");
      const list = document.createElement("ul");
      const evidence = Array.isArray(section.evidence) ? section.evidence.slice(0, 20) : [];
      if (!evidence.length) { const item = document.createElement("li"); item.textContent = gt("noEvidence"); list.append(item); }
      else evidence.forEach(source => { const item = document.createElement("li"); item.textContent = source.summary || gt("noEvidence"); list.append(item); });
      details.append(summary, list); article.append(header, textarea, controls, details); return article;
    }));
    generation.status.textContent = approved ? gt("approved") : gt("ready");
    generation.save.disabled = approved; generation.approve.disabled = approved;
  }

  function decisionButton(article, section, decision, label, disabled) {
    const button = document.createElement("button"); button.type = "button"; button.className = "secondary-action";
    button.textContent = gt(label); button.disabled = disabled;
    button.classList.toggle("is-selected", section.decision === decision);
    button.addEventListener("click", () => {
      selectGenerationDecision(article, section, decision);
      if (decision === "edited") article.querySelector("textarea")?.focus();
    });
    return button;
  }

  function selectGenerationDecision(article, section, decision) {
    if (generationResponse?.profile?.status === "approved") return;
    section.decision = decision;
    article.querySelectorAll(".writer-generation-decisions button").forEach((button, index) => {
      const values = generationOptional.has(section.key) ? ["accepted", "edited", "removed"] : ["accepted", "edited"];
      button.classList.toggle("is-selected", values[index] === decision);
    });
    article.querySelector("header p").textContent = gt(decision === "removed" ? "remove" : decision === "edited" ? "edit" : "accept");
  }

  function collectGenerationSettings() {
    const settings = structuredClone(activeGenerationSettings());
    for (const section of settings.sections) {
      const article = generation.sections.querySelector(`[data-key="${section.key}"]`);
      section.value.summary = article?.querySelector("textarea")?.value.trim() || section.value.summary;
      const live = activeGenerationSettings().sections.find(item => item.key === section.key);
      section.decision = live.decision;
    }
    return settings;
  }

  async function saveGenerationProfile(approve) {
    if (!generationResponse || generationBusy || generationResponse.profile.status === "approved" || !current()) return;
    const stamp = epoch; generationBusy = true;
    generation.save.disabled = true; generation.approve.disabled = true; generation.status.textContent = gt("loading");
    try {
      const saved = await request(`/stories/${encodeURIComponent(scope.workId)}/generation-profile`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: collectGenerationSettings() })
      }, stamp);
      if (!validGenerationResponse(saved)) throw new Error("profile projection");
      generationResponse = saved;
      if (approve) {
        const approved = await request(`/stories/${encodeURIComponent(scope.workId)}/generation-profile/approve`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedDraftFingerprint: saved.profile.draftFingerprint })
        }, stamp);
        if (!validGenerationResponse(approved) || approved.profile.status !== "approved") throw new Error("approval projection");
        generationResponse = approved; generation.entryState.textContent = gt("approved"); renderGenerationSections();
      } else {
        generation.status.textContent = gt("saved"); renderGenerationSections();
      }
    } catch (_) {
      if (current(stamp)) generation.status.textContent = approve ? gt("approveFailed") : gt("saveFailed");
    } finally {
      if (current(stamp)) {
        generationBusy = false;
        const approved = generationResponse?.profile?.status === "approved";
        generation.save.disabled = approved; generation.approve.disabled = approved;
      }
    }
  }

  el.Start.addEventListener("click", start);
  el.Check.addEventListener("click", () => analysisId ? loadPage(page.cursor, page.start) : start());
  el.Next.addEventListener("click", () => {
    if (busy || !page.hasMore || !page.nextCursor || history.some(item => item.cursor === page.nextCursor)) return;
    loadPage(page.nextCursor, page.start + page.rows.length, { navigation: "next" });
  });
  el.Previous.addEventListener("click", () => {
    if (busy || !history.length) return;
    const previous = history.at(-1); loadPage(previous.cursor, previous.start, { navigation: "previous" });
  });
  generation.open.addEventListener("click", () => generationResponse ? openGenerationModal() : loadGenerationProfile(false));
  generation.close.addEventListener("click", closeGenerationModal);
  generation.cancel.addEventListener("click", closeGenerationModal);
  generation.save.addEventListener("click", () => saveGenerationProfile(false));
  generation.approve.addEventListener("click", () => saveGenerationProfile(true));
  generation.modal.addEventListener("click", event => { if (event.target === generation.modal) closeGenerationModal(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !generation.modal.classList.contains("is-hidden")) closeGenerationModal(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) clearTimeout(poll); else if (current()) schedulePoll(); });
  window.addEventListener("lumina:localechange", () => {
    if (!receipt) return;
    const wasStarting = starting;
    stopRequests(); starting = false;
    if (wasStarting) phase = "unknown";
    render();
    if (!generation.modal.classList.contains("is-hidden") && generationResponse) { setGenerationCopy(); renderGenerationSections(); }
    if (job) loadPage(page.cursor, page.start);
  });
  window.addEventListener("storage", event => { if (["lumina_auth", "lumina.session", null].includes(event.key)) current(); });
  window.addEventListener("lumina:auth-expired", invalidate);
  window.addEventListener("pagehide", invalidate);
  window.addEventListener("focus", () => current());
  setInterval(() => { if (scope) current(); }, 1000);
  window.LuminaCreatorAnalysis = { receive, invalidate, contextChanged };
  if (manuscript.receipt()) receive(manuscript.receipt()); else contextChanged();
})();
